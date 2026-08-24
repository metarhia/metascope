'use strict';

const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { chrome, paint, OSC_BG_BLACK, OSC_BG_RESET } = require('./theme.js');
const { decodeKey, isIncompleteSequence } = require('./keys.js');
const { detectLang, isJsLang, mapLang } = require('./detect.js');
const { render } = require('./render/index.js');
const { runSnippetStream } = require('./run.js');
const { buildCatalogMarkdown } = require('./catalog.js');
const blockUi = require('./render/block.js');
const { overlayControlButton, overlayCopyButton, isHot } = blockUi;
const { playHitCols, copyHitCols } = blockUi;
const { stripAnsi, visibleWidth, sliceVisible, asText } = require('./wrap.js');
const { directoryExists } = require('metautil');
const { copyText } = require('./clipboard.js');
const layout = require('./layout.js');
const { innerSize, withMargins, flushFrame, MARGIN_X, MARGIN_Y_TOP } = layout;

const ENTER_ALT = '\x1b[?1049h';
const LEAVE_ALT = '\x1b[?1049l';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
/** 1000=click, 1002=drag, 1003=hover motion, 1006=SGR coords */
const MOUSE_ON = '\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h';
const MOUSE_OFF = '\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l';

const DRAG_THRESHOLD = 1;

const HELP_MD = fsSync.readFileSync(path.join(__dirname, 'help.md'), 'utf8');

const KEYS = {
  space: 'toggleStatus',
  up: 'lineUp',
  down: 'lineDown',
  left: 'pageUp',
  pageup: 'pageUp',
  right: 'pageDown',
  pagedown: 'pageDown',
  'ctrl-u': 'halfPageUp',
  'ctrl-d': 'halfPageDown',
  home: 'goTop',
  end: 'goBottom',
  '/': 'startSearch',
  n: 'nextMatch',
  N: 'prevMatch',
  l: 'toggleLines',
  w: 'toggleWrap',
  H: 'panLeft',
  L: 'panRight',
  r: 'reload',
  '?': 'showHelp',
};

class InteractiveSession {
  constructor(viewer) {
    this.viewer = viewer;
    this.stdin = process.stdin;
    this.seqBuf = '';
    this.escTimer = null;
    this.resolve = null;
  }

  start() {
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.stdin.setRawMode(true);
      this.stdin.resume();
      this.stdin.setEncoding('utf8');
      process.stdout.write(ENTER_ALT + OSC_BG_BLACK + HIDE_CURSOR + MOUSE_ON);
      this.ac = new AbortController();
      const { signal } = this.ac;
      process.on('SIGINT', () => this.finish('quit'), { signal });
      process.stdout.on('resize', () => this.handleResize(), { signal });
      this.stdin.on('data', (chunk) => this.handleData(chunk), { signal });
      this.viewer.paintScreen();
    });
  }

  cleanup() {
    if (this.escTimer) {
      clearTimeout(this.escTimer);
      this.escTimer = null;
    }
    this.viewer.stopSpinner();
    if (this.viewer.runHandle) {
      this.viewer.runHandle.kill();
      this.viewer.runHandle = null;
    }
    this.ac.abort();
    process.stdout.write(MOUSE_OFF + SHOW_CURSOR + OSC_BG_RESET + LEAVE_ALT);
    this.stdin.setRawMode(false);
    this.stdin.pause();
  }

  finish(action = 'quit') {
    if (!this.viewer.running) return;
    this.viewer.running = false;
    this.cleanup();
    this.resolve(action);
  }

  handleResize() {
    const viewer = this.viewer;
    const anchor = viewer.offset;
    const n = Math.max(1, viewer.lines.length);
    const ratio = viewer.lines.length > 0 ? anchor / n : 0;
    viewer.rebuild();
    viewer.offset = Math.floor(ratio * viewer.lines.length);
    viewer.clampOffset();
    viewer.paintScreen();
  }

  dispatch(key) {
    this.viewer.handleKey(key, (action) => this.finish(action));
    if (this.viewer.running && this.viewer.dirty) this.viewer.paintScreen();
  }

  flushSeqBuf() {
    while (this.seqBuf) {
      if (this.seqBuf === '\x1b') return; // wait for timeout or more bytes
      if (isIncompleteSequence(this.seqBuf)) return;

      let take;
      if (this.seqBuf.startsWith('\x1b')) {
        if (this.seqBuf.startsWith('\x1b[<')) {
          const mouseEnd = this.seqBuf.search(/[Mm]/);
          if (mouseEnd === -1) return;
          take = mouseEnd + 1;
        } else if (this.seqBuf.startsWith('\x1b[')) {
          const esc = '\u001b';
          const csi = new RegExp(`^${esc}\\[[0-9;]*[A-Za-z~]`);
          const m = this.seqBuf.match(csi);
          if (!m) return;
          take = m[0].length;
        } else if (this.seqBuf.startsWith('\x1bO')) {
          if (this.seqBuf.length < 3) return;
          take = 3;
        } else {
          // ESC + non-CSI (e.g. alt-key): take ESC alone as escape-ish
          take = 1;
        }
      } else {
        const esc = this.seqBuf.indexOf('\x1b');
        take = esc === -1 ? this.seqBuf.length : esc;
      }

      const piece = this.seqBuf.slice(0, take);
      this.seqBuf = this.seqBuf.slice(take);
      this.dispatch(decodeKey(piece));
    }
  }

  handleData(chunk) {
    if (this.escTimer) {
      clearTimeout(this.escTimer);
      this.escTimer = null;
    }
    this.seqBuf += chunk;
    this.flushSeqBuf();
    // Lone ESC: distinguish Escape key from start of CSI / mouse
    if (this.seqBuf === '\x1b') {
      this.escTimer = setTimeout(() => {
        this.escTimer = null;
        if (this.seqBuf === '\x1b') {
          this.seqBuf = '';
          this.dispatch({ name: 'escape' });
        }
      }, 35);
    }
  }
}

class Viewer {
  constructor(filePath, options = {}) {
    this.filePath = path.resolve(filePath);
    this.isDir = false;
    this.source = '';
    this.lang = detectLang(this.filePath);
    this.lines = [];
    this.blocks = [];
    this.outputs = new Map();
    this.prelude = {};
    this.offset = 0;
    this.hOffset = 0;
    this.showLines = false;
    this.showStatus = false;
    this.wrap = true;
    this.mode = 'view';
    this.searchQuery = '';
    this.searchInput = '';
    this.matches = [];
    this.matchIndex = -1;
    this.onBack = options.onBack || null;
    this.running = true;
    this.dirty = true;
    this.runningBlock = null;
    this.runHandle = null;
    this.spinTick = 0;
    this.spinTimer = null;
    this.selection = null;
    this.drag = null;
    this.hover = null;
  }

  async open() {
    await this.loadFile();
    let action;
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      this.printStatic();
    } else {
      action = await this.runInteractive();
    }
    return action;
  }

  async loadFile() {
    this.isDir = await directoryExists(this.filePath);
    if (this.isDir) {
      this.source = await buildCatalogMarkdown(this.filePath);
      this.lang = 'md';
    } else {
      this.source = await fs.readFile(this.filePath, 'utf8');
      this.lang = detectLang(this.filePath);
    }
    this.rebuild();
  }

  runCwd() {
    return this.isDir ? this.filePath : path.dirname(this.filePath);
  }

  rebuild() {
    const { innerCols } = innerSize();
    const gutter = this.showLines
      ? `${this.source.split('\n').length}`.length + 2
      : 0;
    const bodyWidth = Math.max(20, innerCols - gutter);
    const contentWidth = this.wrap ? bodyWidth : 0;
    const result = render(this.lang, this.source, {
      width: contentWidth || 10000,
      wrap: this.wrap,
      outputs: this.outputs,
      tick: this.spinTick || 0,
      hover: this.hover,
    });
    this.lines = result.lines;
    this.blocks = result.blocks || [];
    this.prelude = result.prelude || {};
    if (this.searchQuery) this.updateMatches();
    this.clampOffset();
    this.dirty = true;
  }

  statusVisible() {
    return this.showStatus || this.mode === 'search';
  }

  chromeHeight() {
    return this.statusVisible() ? 1 : 0;
  }

  bodyHeight() {
    return Math.max(1, innerSize().innerRows - this.chromeHeight());
  }

  clampOffset() {
    const max = Math.max(0, this.lines.length - this.bodyHeight());
    this.offset = Math.min(Math.max(0, this.offset), max);
    this.hOffset = Math.max(0, this.hOffset);
  }

  updateMatches() {
    const q = this.searchQuery.toLowerCase();
    this.matches = [];
    if (!q) {
      this.matchIndex = -1;
      return;
    }
    for (let i = 0; i < this.lines.length; i++) {
      if (stripAnsi(this.lines[i]).toLowerCase().includes(q)) {
        this.matches.push(i);
      }
    }
    this.matchIndex = this.matches.length ? 0 : -1;
    if (this.matchIndex >= 0) this.offset = Math.max(0, this.matches[0] - 2);
  }

  printStatic() {
    const { innerCols } = innerSize();
    const result = render(this.lang, this.source, {
      width: innerCols,
      wrap: true,
    });
    const pad = '  ';
    process.stdout.write(`${result.lines.map((l) => pad + l).join('\n')}\n`);
  }

  runInteractive() {
    return new InteractiveSession(this).start();
  }

  static viewKeyId(key) {
    return key.name === 'char' ? key.ch : key.name;
  }

  toggleWrap() {
    this.wrap = !this.wrap;
    this.hOffset = 0;
    this.rebuild();
  }

  pan(delta) {
    if (this.wrap) return;
    this.hOffset = Math.max(0, this.hOffset + delta);
  }

  reloadView() {
    const show = () => {
      if (this.running) this.paintScreen();
    };
    this.loadFile()
      .then(show)
      .catch(() => {});
    return true;
  }

  toggleStatus() {
    this.showStatus = !this.showStatus;
  }

  lineUp() {
    this.offset -= 1;
  }

  lineDown() {
    this.offset += 1;
  }

  pageUp(view) {
    this.offset -= view.page;
  }

  pageDown(view) {
    this.offset += view.page;
  }

  halfPageUp(view) {
    this.offset -= view.half;
  }

  halfPageDown(view) {
    this.offset += view.half;
  }

  goTop() {
    this.offset = 0;
  }

  goBottom() {
    this.offset = this.lines.length;
  }

  startSearch() {
    this.mode = 'search';
    this.searchInput = '';
  }

  nextMatch() {
    this.jumpMatch(1);
  }

  prevMatch() {
    this.jumpMatch(-1);
  }

  toggleLines() {
    this.showLines = !this.showLines;
    this.rebuild();
  }

  panLeft() {
    this.pan(-4);
  }

  panRight() {
    this.pan(4);
  }

  reload() {
    return this.reloadView();
  }

  showHelp() {
    this.mode = 'help';
  }

  handleKey(key, finish) {
    if (key.name === 'mouse') return void this.handleMouse(key);

    if (this.mode === 'help') {
      if (
        key.name === 'escape' ||
        (key.name === 'char' && 'q?'.includes(key.ch))
      ) {
        this.mode = 'view';
        this.dirty = true;
      }
      return;
    }

    if (this.mode === 'search') return void this.handleSearchInput(key);

    if (key.name === 'ctrl-c') return void finish('quit');
    if (key.name === 'char' && key.ch === 'q') return void finish('quit');
    if (key.name === 'escape') {
      if (this.runningBlock && this.runHandle) {
        return void this.runHandle.kill();
      }
      if (this.selection) {
        this.selection = null;
        this.dirty = true;
        return;
      }
      if (this.onBack) return void finish('back');
      return void finish('quit');
    }

    if (key.name === 'char' && key.ch === 'y' && this.selection) {
      return void this.copySelection();
    }

    const page = this.bodyHeight();
    const half = Math.max(1, Math.floor(page / 2));
    const view = { page, half };
    const name = KEYS[Viewer.viewKeyId(key)];
    if (!name || typeof this[name] !== 'function') return;
    const stop = this[name](view);
    if (stop) return;

    this.clampOffset();
    this.dirty = true;
  }

  /**
   * Map screen click (1-based col/row) to document line + content column.
   */
  screenToDoc(col, row) {
    const gutterW = this.showLines ? `${this.lines.length}`.length + 1 : 0;
    const gutterPad = gutterW ? gutterW + 1 : 0;
    const contentRow = row - MARGIN_Y_TOP - 1;
    if (contentRow < 0) return null;
    const lineIndex = this.offset + contentRow;
    if (lineIndex < 0 || lineIndex >= this.lines.length) return null;
    const viewCol = col - 1 - MARGIN_X - gutterPad;
    const h = this.wrap ? 0 : this.hOffset;
    const innerCol = Math.max(0, viewCol) + h;
    return { lineIndex, innerCol, viewCol: Math.max(0, viewCol) };
  }

  static normalizeSelection(sel) {
    if (!sel || !sel.anchor || !sel.focus) return null;
    let a = sel.anchor;
    let b = sel.focus;
    const laterLine = a.lineIndex > b.lineIndex;
    const laterCol = a.lineIndex === b.lineIndex && a.innerCol > b.innerCol;
    if (laterLine || laterCol) {
      [a, b] = [b, a];
    }
    return { a, b };
  }

  static selectionMoved(drag) {
    if (!drag || !drag.start || !drag.last) return false;
    return (
      Math.abs(drag.last.lineIndex - drag.start.lineIndex) >= DRAG_THRESHOLD ||
      Math.abs(drag.last.innerCol - drag.start.innerCol) >= DRAG_THRESHOLD
    );
  }

  getSelectedText() {
    const norm = Viewer.normalizeSelection(this.selection);
    if (!norm) return '';
    const parts = [];
    for (let i = norm.a.lineIndex; i <= norm.b.lineIndex; i++) {
      const plain = stripAnsi(this.lines[i] || '');
      let from = 0;
      let to = plain.length;
      if (i === norm.a.lineIndex) {
        from = Math.min(norm.a.innerCol, plain.length);
      }
      if (i === norm.b.lineIndex) {
        to = Math.min(norm.b.innerCol + 1, plain.length);
      }
      if (from > to) from = to;
      parts.push(plain.slice(from, to));
    }
    return parts.join('\n');
  }

  copySelection() {
    const text = this.getSelectedText();
    if (!text) return false;
    return copyText(text);
  }

  highlightSelection(line, lineIndex) {
    const norm = Viewer.normalizeSelection(this.selection);
    if (!norm) return line;
    if (lineIndex < norm.a.lineIndex || lineIndex > norm.b.lineIndex) {
      return line;
    }

    const h = this.wrap ? 0 : this.hOffset;
    const width = visibleWidth(line);
    let from = 0;
    let to = width;
    if (lineIndex === norm.a.lineIndex) from = Math.max(0, norm.a.innerCol - h);
    if (lineIndex === norm.b.lineIndex) {
      to = Math.min(width, Math.max(0, norm.b.innerCol - h + 1));
    }
    from = Math.max(0, Math.min(from, width));
    to = Math.max(from, Math.min(to, width));
    if (from >= to) return line;

    const left = sliceVisible(line, 0, from);
    const mid = stripAnsi(sliceVisible(line, from, to - from));
    const right = sliceVisible(line, to, width - to);
    const sel = `\x1b[48;2;55;55;60m\x1b[38;2;200;200;205m${mid}\x1b[0m`;
    return `${left}${sel}${right}`;
  }

  handleMouse(key) {
    const btn = key.button;
    const isWheel = btn === 64 || btn === 65;
    const isMove = btn === 35; // any-event tracking: motion, no buttons
    const isDrag = btn >= 32 && btn < 64 && !isMove;
    const baseBtn = isDrag ? btn - 32 : btn;

    if (isWheel) {
      if (btn === 64) this.offset -= 3;
      else this.offset += 3;
      this.clampOffset();
      this.dirty = true;
      return;
    }

    if (this.mode !== 'view') return;

    if (isMove) return void this.updateHover(key);

    if (isDrag && baseBtn === 0) {
      const pos = this.screenToDoc(key.col, key.row);
      if (!pos || !this.drag) return;
      this.drag.last = pos;
      if (Viewer.selectionMoved(this.drag)) {
        this.selection = {
          anchor: this.drag.start,
          focus: pos,
        };
        this.drag.selecting = true;
        this.dirty = true;
      }
      return;
    }

    // Left press — clear selection immediately (don't wait for release)
    if (baseBtn === 0 && !key.release) {
      const pos = this.screenToDoc(key.col, key.row);
      if (this.selection) {
        this.selection = null;
        this.paintScreen();
      }
      this.drag = pos ? { start: pos, last: pos, selecting: false } : null;
      return;
    }

    if (baseBtn === 0 && key.release) {
      const fallback = this.drag && this.drag.last;
      const pos = this.screenToDoc(key.col, key.row) || fallback;
      const drag = this.drag;
      this.drag = null;

      const moved = Viewer.selectionMoved({ ...drag, last: pos || drag.last });
      if (drag && (drag.selecting || moved)) {
        const focus = pos || drag.last;
        this.selection = { anchor: drag.start, focus };
        this.copySelection();
        this.dirty = true;
        return;
      }

      if (!pos) return;
      return void this.handleMouseClick(pos);
    }
  }

  updateHover(key) {
    const pos = this.screenToDoc(key.col, key.row);
    const next = pos ? this.hitTestHover(pos) : null;
    const prev = this.hover;
    const sameId = prev && next && prev.blockId === next.blockId;
    const sameHit = sameId && prev.kind === next.kind;
    const same = (!prev && !next) || sameHit;
    if (same) return;
    this.hover = next;
    this.rebuild();
    this.paintScreen();
  }

  hitTestHover(pos) {
    const col = pos.viewCol;
    const w = this.contentWidth();

    for (const block of this.blocks) {
      if (!block.close) continue;
      if (pos.lineIndex !== block.close.lineIndex) continue;
      if (col >= block.close.col0 && col < block.close.col1) {
        const out = this.outputs.get(block.id);
        const kind = out && out.running ? 'spin' : 'close';
        return { blockId: block.id, kind };
      }
    }

    for (const block of this.blocks) {
      if (!block.copy) continue;
      const target = this.stickyCopyTarget(block, w);
      if (!target) continue;
      if (pos.lineIndex !== target.lineIndex) continue;
      if (col >= target.col0 && col < target.col1) {
        return { blockId: block.id, kind: 'copy' };
      }
    }

    for (const block of this.blocks) {
      if (!block.play) continue;
      const running = this.runningBlock === block.id;
      const kind = running ? 'stop' : block.play.kind || 'play';
      const target = this.stickyPlayTarget(block, w, kind);
      if (!target) continue;
      if (pos.lineIndex !== target.lineIndex) continue;
      if (col >= target.col0 && col < target.col1) {
        return { blockId: block.id, kind };
      }
    }

    return null;
  }

  handleMouseClick(pos) {
    // Controls sit in the visible content row (not h-scrolled doc cols).
    const col = pos.viewCol;

    for (const block of this.blocks) {
      if (!block.close) continue;
      if (pos.lineIndex !== block.close.lineIndex) continue;
      if (col >= block.close.col0 && col < block.close.col1) {
        const out = this.outputs.get(block.id);
        if (out && out.running) return; // spinner — not closable
        this.outputs.delete(block.id);
        this.rebuild();
        this.dirty = true;
        return;
      }
    }

    for (const block of this.blocks) {
      if (!block.copy) continue;
      const width = this.contentWidth();
      const target = this.stickyCopyTarget(block, width);
      if (!target) continue;
      if (pos.lineIndex !== target.lineIndex) continue;
      if (col >= target.col0 && col < target.col1) {
        return void copyText(block.source || '');
      }
    }

    for (const block of this.blocks) {
      if (!block.play) continue;
      const running = this.runningBlock === block.id;
      const kind = running ? 'stop' : block.play.kind || 'play';
      const width = this.contentWidth();
      const target = this.stickyPlayTarget(block, width, kind);
      if (!target) continue;
      if (pos.lineIndex !== target.lineIndex) continue;
      if (col >= target.col0 && col < target.col1) {
        if (this.runningBlock === block.id) {
          return void this.runHandle?.kill();
        }
        if (this.runningBlock) return;
        return void this.runBlock(block);
      }
    }
  }

  contentWidth() {
    const { innerCols } = innerSize();
    const gutterW = this.showLines ? `${this.lines.length}`.length + 1 : 0;
    return Math.max(1, innerCols - (gutterW ? gutterW + 1 : 0));
  }

  stickyPlayTarget(block, width, kind = 'play') {
    if (!block.play) return null;
    const viewStart = this.offset;
    const last = viewStart + this.bodyHeight();
    const viewEnd = Math.min(this.lines.length, last) - 1;
    if (viewEnd < viewStart) return null;

    const playLine = block.startLine + block.play.row;
    const blockLast = block.endLine - 1;
    const visStart = Math.max(block.startLine, viewStart);
    const visEnd = Math.min(blockLast, viewEnd);
    if (visStart > visEnd) return null;

    const cols = playHitCols(width > 0 ? width : block.play.col1, kind);
    if (playLine >= viewStart && playLine <= viewEnd) {
      const lineIndex = playLine;
      const col0 = block.play.col0;
      const col1 = block.play.col1;
      const sticky = false;
      const blockId = block.id;
      kind = block.play.kind || kind;
      return { lineIndex, col0, col1, sticky, kind, blockId };
    }
    if (playLine > viewEnd) {
      const lineIndex = visEnd;
      const col0 = cols.col0;
      const col1 = cols.col1;
      const sticky = true;
      const blockId = block.id;
      return { lineIndex, col0, col1, sticky, kind, blockId };
    }
    return null;
  }

  stickyCopyTarget(block, width) {
    if (!block.copy) return null;
    const viewStart = this.offset;
    const last = viewStart + this.bodyHeight();
    const viewEnd = Math.min(this.lines.length, last) - 1;
    if (viewEnd < viewStart) return null;

    const copyLine = block.startLine + block.copy.row;
    const blockLast = block.endLine - 1;
    const visStart = Math.max(block.startLine, viewStart);
    const visEnd = Math.min(blockLast, viewEnd);
    if (visStart > visEnd) return null;

    const cols = copyHitCols(width > 0 ? width : block.copy.col1);
    if (copyLine >= viewStart && copyLine <= viewEnd) {
      const lineIndex = copyLine;
      const col0 = block.copy.col0;
      const col1 = block.copy.col1;
      const sticky = false;
      const blockId = block.id;
      return { lineIndex, col0, col1, sticky, blockId };
    }
    if (copyLine < viewStart) {
      const lineIndex = visStart;
      const col0 = cols.col0;
      const col1 = cols.col1;
      const sticky = true;
      const blockId = block.id;
      return { lineIndex, col0, col1, sticky, blockId };
    }
    return null;
  }

  startSpinner() {
    this.stopSpinner();
    this.spinTick = 0;
    this.spinTimer = setInterval(() => {
      if (!this.running || !this.runningBlock) {
        return void this.stopSpinner();
      }
      this.spinTick += 1;
      this.advanceTypewriter();
      this.rebuild();
      this.scrollFollowOutput(this.runningBlock);
      this.paintScreen();
    }, 50);
  }

  stopSpinner() {
    if (this.spinTimer) {
      clearInterval(this.spinTimer);
      this.spinTimer = null;
    }
  }

  advanceTypewriter() {
    const id = this.runningBlock;
    if (!id) return;
    const cur = this.outputs.get(id);
    if (!cur || !cur.running) return;
    const full = asText(cur.text);
    let shown = asText(cur.shown);
    if (shown.length >= full.length) {
      if (shown !== full) {
        this.outputs.set(id, { ...cur, shown: full });
      }
      return;
    }
    const lag = full.length - shown.length;
    // Catch up if process dumps a lot; otherwise type a few chars per tick.
    let step = Math.min(2, lag);
    if (lag > 20) step = 4;
    if (lag > 60) step = Math.ceil(lag / 4);
    shown = full.slice(0, shown.length + step);
    this.outputs.set(id, { ...cur, shown });
  }

  static composeRunSource(prelude, source) {
    if (!prelude) return { source, preludeLines: 0 };
    const head = prelude.replace(/\s*$/, '');
    const preludeLines = head.split('\n').length + 1; // blank separator
    return { source: `${head}\n\n${source}`, preludeLines };
  }

  static pendingOutput() {
    return {
      ok: true,
      stdout: '',
      stderr: '',
      text: '',
      shown: '',
      code: 0,
      running: true,
    };
  }

  runBlock(block) {
    if (this.runningBlock) return;
    this.runningBlock = block.id;

    const prelude = Viewer.pickPrelude(this.prelude, block.lang);
    const composed = Viewer.composeRunSource(prelude, block.source);
    const source = composed.source;
    const preludeLines = composed.preludeLines;

    const fileLabel = path.basename(this.filePath);
    const fromFile = block.id === 'file-0' || this.lang !== 'md';
    const fallback = fromFile ? fileLabel : 'Example';
    const runLabel = block.label || fallback;

    this.outputs.set(block.id, Viewer.pendingOutput());
    this.startSpinner();
    this.rebuild();
    // Don't jump the view on start — follow once output hits the bottom.
    this.paintScreen();

    let scheduled = false;
    let paintGen = 0;
    const flush = (result) => {
      const prev = this.outputs.get(block.id) || {};
      const fullText = asText(result.text);
      const running = !!result.running;
      const shown = running ? asText(prev.shown) : fullText;
      const next = { ...result, running, shown };
      if (result.running && next.shown.length > fullText.length) {
        next.shown = fullText;
      }
      // Finished: always snap text and drop any typing state.
      if (!next.running) {
        next.shown = fullText;
      }
      this.outputs.set(block.id, next);

      const gen = ++paintGen;
      const apply = () => {
        if (gen !== paintGen) return;
        if (!this.running) return;
        this.rebuild();
        this.scrollFollowOutput(block.id);
        this.paintScreen();
      };

      if (!next.running) {
        // Sync final frame so a stale stream paint cannot leave the cursor.
        return void apply();
      }
      if (scheduled) return;
      scheduled = true;
      setImmediate(() => {
        scheduled = false;
        // Always paint the latest outputs, not this closure's gen alone.
        const latest = paintGen;
        if (!this.running) return;
        this.rebuild();
        if (latest !== paintGen) return;
        this.scrollFollowOutput(block.id);
        this.paintScreen();
      });
    };

    const handle = runSnippetStream(block.lang, source, {
      cwd: this.runCwd(),
      onUpdate: flush,
      label: runLabel,
      preludeLines,
    });
    this.runHandle = handle;

    handle.promise.then((result) => {
      if (this.runHandle === handle) this.runHandle = null;
      this.runningBlock = null;
      this.stopSpinner();
      flush({ ...result, running: false });
    });
  }

  scrollFollowOutput(blockId) {
    const updated = this.blocks.find((b) => b.id === blockId);
    if (!updated) return;
    let outputEnd = this.lines.length;
    for (const b of this.blocks) {
      if (b.startLine > updated.endLine) {
        outputEnd = b.startLine;
        break;
      }
    }
    const height = this.bodyHeight();
    const viewBottom = this.offset + height;
    if (outputEnd > viewBottom) {
      this.offset = Math.max(0, outputEnd - height);
      this.clampOffset();
    }
  }

  static pickPrelude(prelude, lang) {
    if (!prelude || typeof prelude !== 'object') return '';
    const l = mapLang(lang);
    if (prelude[l]) return prelude[l];
    if (isJsLang(l) && prelude.js) return prelude.js;
    return '';
  }

  handleSearchInput(key) {
    if (key.name === 'escape') {
      this.mode = 'view';
      this.dirty = true;
      return;
    }
    if (key.name === 'enter') {
      this.searchQuery = this.searchInput;
      this.mode = 'view';
      this.updateMatches();
      this.clampOffset();
      this.dirty = true;
      return;
    }
    if (key.name === 'backspace') {
      this.searchInput = this.searchInput.slice(0, -1);
      this.dirty = true;
      return;
    }
    if (key.name === 'char' && key.ch && !key.ch.startsWith('\x1b')) {
      this.searchInput += key.ch;
      this.dirty = true;
    }
  }

  jumpMatch(dir) {
    if (!this.matches.length) return;
    if (this.matchIndex < 0) {
      this.matchIndex = 0;
    } else {
      this.matchIndex =
        (this.matchIndex + dir + this.matches.length) % this.matches.length;
    }
    this.offset = Math.max(0, this.matches[this.matchIndex] - 2);
  }

  stickyOverlays(contentW) {
    const play = new Map();
    const copy = new Map();
    for (const block of this.blocks) {
      const kind = this.runningBlock === block.id ? 'stop' : 'play';
      const target = this.stickyPlayTarget(block, contentW, kind);
      if (target && target.sticky) play.set(target.lineIndex, target);
      const copyTarget = this.stickyCopyTarget(block, contentW);
      if (copyTarget && copyTarget.sticky) {
        copy.set(copyTarget.lineIndex, copyTarget);
      }
    }
    return { play, copy };
  }

  paintContentLine(i, contentW, gutterW, overlays) {
    let line = this.lines[i];
    if (!this.wrap && this.hOffset > 0) {
      line = sliceVisible(line, this.hOffset, contentW);
    } else if (visibleWidth(line) > contentW) {
      line = sliceVisible(line, 0, contentW);
    }
    if (this.isMatchLine(i)) {
      line = Viewer.highlightMatch(line, this.searchQuery);
    }
    line = this.highlightSelection(line, i);

    const stickyCopy = overlays.copy.get(i);
    if (stickyCopy) {
      const hot = isHot(this.hover, stickyCopy.blockId, ['copy']);
      line = overlayCopyButton(line, contentW, hot);
    }

    const sticky = overlays.play.get(i);
    if (sticky) {
      const hot = isHot(this.hover, sticky.blockId, ['play', 'stop']);
      line = overlayControlButton(line, contentW, sticky.kind || 'play', hot);
    }

    if (this.showLines) {
      const num = paint('muted', `${`${i + 1}`.padStart(gutterW)} `);
      line = num + line;
    }
    return line;
  }

  paintScreen() {
    const { cols, rows, innerCols, innerRows } = innerSize();

    if (this.mode === 'help') {
      const help = Viewer.buildHelpInner(innerCols, innerRows);
      flushFrame(withMargins(help, cols, rows));
      this.dirty = false;
      return;
    }

    const height = this.bodyHeight();
    const inner = [];

    const start = this.offset;
    const end = Math.min(this.lines.length, start + height);
    const gutterW = this.showLines ? `${this.lines.length}`.length + 1 : 0;
    const contentW = Math.max(1, innerCols - (gutterW ? gutterW + 1 : 0));
    const overlays = this.stickyOverlays(contentW);

    for (let i = start; i < end; i++) {
      inner.push(this.paintContentLine(i, contentW, gutterW, overlays));
    }

    if (this.statusVisible()) {
      while (inner.length < innerRows - 1) inner.push('');
      if (inner.length > innerRows - 1) inner.length = innerRows - 1;
      inner.push(this.buildFooter(innerCols));
    } else if (inner.length > innerRows) {
      inner.length = innerRows;
    }

    flushFrame(withMargins(inner, cols, rows));
    this.dirty = false;
  }

  isMatchLine(i) {
    return Boolean(this.searchQuery && this.matches.includes(i));
  }

  static highlightMatch(line, query) {
    if (!query) return line;
    const plain = stripAnsi(line);
    if (plain.toLowerCase().indexOf(query.toLowerCase()) === -1) return line;
    return paint('match', plain);
  }

  buildFooter(cols) {
    if (this.mode === 'search') {
      return chrome.footer(`🔍 /${this.searchInput}█`);
    }
    const pos = `${this.offset + 1}-${Math.min(
      this.lines.length,
      this.offset + this.bodyHeight(),
    )}/${this.lines.length}`;
    const hints = this.wrap
      ? '↑↓  ▶run  drag=copy  y  / ?  q'
      : '↑↓  H/L  ▶run  drag=copy  y  / ?  q';
    const left = chrome.footer(`↕ ${pos}`);
    const right = chrome.footer(hints);
    const pad = Math.max(1, cols - visibleWidth(left) - visibleWidth(right));
    let line = left + ' '.repeat(pad) + right;
    if (visibleWidth(line) > cols) line = sliceVisible(line, 0, cols);
    return line;
  }

  static buildHelpInner(innerCols, innerRows) {
    const { lines } = render('md', HELP_MD, { width: innerCols, wrap: true });
    const tip = chrome.muted('Esc to close');
    const block = [...lines, '', tip];
    const top = Math.max(0, Math.floor((innerRows - block.length) / 2));
    const blockWidth = block.reduce(
      (max, line) => Math.max(max, visibleWidth(line)),
      0,
    );
    const left = Math.max(0, Math.floor((innerCols - blockWidth) / 2));
    const pad = ' '.repeat(left);
    const inner = [];
    for (let i = 0; i < innerRows; i++) {
      const idx = i - top;
      if (idx >= 0 && idx < block.length) {
        inner.push(pad + block[idx]);
      } else {
        inner.push('');
      }
    }
    return inner;
  }
}

const openViewer = (filePath, options) => new Viewer(filePath, options).open();

module.exports = { Viewer, openViewer };
