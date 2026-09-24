'use strict';

const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');

const { directoryExists } = require('metautil');

const theme = require('./theme.js');
const { chrome, paint, OSC_POINTER, OSC_POINTER_RESET } = theme;
const keys = require('./keys.js');
const { decodeKey, sequenceLength } = keys;
const { detectLang, isJsLang, mapLang } = require('./detect.js');
const { render } = require('./render/index.js');
const { runSnippetStream } = require('./run.js');
const { buildCatalogMarkdown } = require('./catalog.js');
const blockUi = require('./render/block.js');
const { overlayControlButton, overlayCopyButton, isHot } = blockUi;
const { playHitCols, copyHitCols } = blockUi;
const wrap = require('./wrap.js');
const { stripAnsi, visibleWidth, sliceVisible, asText } = wrap;
const { hrefAtCol } = wrap;
const { copyText, textFromOrigins } = require('./clipboard.js');
const layout = require('./layout.js');
const { innerSize, withMargins, flushFrame } = layout;
const { enterInteractive, leaveInteractive } = layout;
const { MARGIN_X, MARGIN_Y_TOP } = layout;

const DRAG_THRESHOLD = 1;
const CONTROL_CLICK_SLOP = 2;

const HELP_MD = fsSync.readFileSync(path.join(__dirname, 'help.md'), 'utf8');

const KEYS = {
  space: 'toggleStatus',
  up: 'lineUp',
  down: 'lineDown',
  left: 'pageUp',
  pageup: 'pageUp',
  right: 'pageDown',
  pagedown: 'pageDown',
  home: 'goTop',
  end: 'goBottom',
  '/': 'startSearch',
  n: 'nextMatch',
  N: 'prevMatch',
  l: 'toggleLines',
  r: 'reload',
  '?': 'showHelp',
};

const visibleBlockRange = (block, viewStart, viewEnd) => {
  const visStart = Math.max(block.startLine, viewStart);
  const visEnd = Math.min(block.endLine - 1, viewEnd);
  if (visStart > visEnd) return null;
  return { visStart, visEnd };
};

class InteractiveSession {
  constructor(viewer) {
    this.viewer = viewer;
    this.stdin = process.stdin;
    this.seqBuf = '';
    this.escTimer = null;
    this.resolve = null;
    this.ac = null;
  }

  start() {
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.stdin.setRawMode(true);
      this.stdin.resume();
      this.stdin.setEncoding('utf8');
      enterInteractive({ blackBg: true, mouse: true });
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
    if (this.ac) this.ac.abort();
    leaveInteractive();
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
    const count = viewer.lines.length;
    const ratio = count > 0 ? viewer.offset / count : 0;
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
      if (this.seqBuf === '\x1b') return;
      const take = sequenceLength(this.seqBuf);
      if (!take) return;
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
    this.origins = [];
    this.blocks = [];
    this.outputs = new Map();
    this.prelude = {};
    this.offset = 0;
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
    this.pointerOn = false;
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
    this.origins = result.origins || [];
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

  reloadView() {
    this.loadFile()
      .then(() => {
        if (this.running) this.paintScreen();
      })
      .catch((error) => {
        console.error(error);
        if (this.running) this.paintScreen();
      });
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
    const view = { page };
    const name = KEYS[Viewer.viewKeyId(key)];
    if (!name || typeof this[name] !== 'function') return;
    const stop = this[name](view);
    if (stop) return;

    this.clampOffset();
    this.dirty = true;
  }

  screenToDoc(col, row) {
    const gutterW = this.showLines ? `${this.lines.length}`.length + 1 : 0;
    const gutterPad = gutterW ? gutterW + 1 : 0;
    const contentRow = row - MARGIN_Y_TOP - 1;
    if (contentRow < 0) return null;
    const lineIndex = this.offset + contentRow;
    if (lineIndex < 0 || lineIndex >= this.lines.length) return null;
    const viewCol = col - 1 - MARGIN_X - gutterPad;
    const innerCol = Math.max(0, viewCol);
    return { lineIndex, innerCol, viewCol: innerCol };
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

  isControlClick(drag, pos) {
    if (!drag || !drag.start) return false;
    const hit = this.hitTestHover(drag.start);
    if (!hit) return false;
    const end = pos || drag.last || drag.start;
    const dLine = Math.abs(end.lineIndex - drag.start.lineIndex);
    const dCol = Math.abs(end.innerCol - drag.start.innerCol);
    if (dLine > 0) return false;
    return dCol <= CONTROL_CLICK_SLOP;
  }

  getSelectedText() {
    const norm = Viewer.normalizeSelection(this.selection);
    if (!norm) return '';
    return textFromOrigins(
      this.source,
      this.origins,
      norm.a.lineIndex,
      norm.b.lineIndex,
    );
  }

  copySelection() {
    let text = this.getSelectedText();
    if (!asText(text).trim()) {
      const lineIndex = this.selection && this.selection.anchor.lineIndex;
      const block = this.blockAt(lineIndex);
      text = this.fenceSource(block);
    }
    if (!text) return false;
    return copyText(text);
  }

  highlightSelection(line, lineIndex) {
    const norm = Viewer.normalizeSelection(this.selection);
    if (!norm) return line;
    if (lineIndex < norm.a.lineIndex || lineIndex > norm.b.lineIndex) {
      return line;
    }

    const width = visibleWidth(line);
    let from = 0;
    let to = width;
    if (lineIndex === norm.a.lineIndex) from = Math.max(0, norm.a.innerCol);
    if (lineIndex === norm.b.lineIndex) {
      to = Math.min(width, Math.max(0, norm.b.innerCol + 1));
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

    if (this.mode !== 'view') {
      this.setPointer(false);
      return;
    }

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
      const drag = this.drag;
      this.drag = null;
      const fallback = drag && drag.last;
      const pos = this.screenToDoc(key.col, key.row) || fallback;
      if (!drag) {
        if (!pos) return;
        return void this.handleMouseClick(pos);
      }

      const focus = pos || drag.last;
      const moved = Viewer.selectionMoved({ ...drag, last: focus });
      if (this.isControlClick(drag, focus)) {
        this.selection = null;
        this.handleMouseClick(drag.start);
        this.dirty = true;
        return;
      }
      if (drag.selecting || moved) {
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
    this.syncPointer(pos, next);
    const prev = this.hover;
    const sameId = prev && next && prev.blockId === next.blockId;
    const sameHit = sameId && prev.kind === next.kind;
    const same = (!prev && !next) || sameHit;
    if (same) return;
    this.hover = next;
    this.rebuild();
    this.paintScreen();
    this.syncPointer(pos, next);
  }

  setPointer(pointer) {
    if (this.pointerOn === pointer) return;
    this.pointerOn = pointer;
    const seq = pointer ? OSC_POINTER : OSC_POINTER_RESET;
    process.stdout.write(seq);
  }

  syncPointer(pos, hover) {
    let pointer = Boolean(hover);
    if (!pointer && pos) {
      const line = this.lines[pos.lineIndex] || '';
      pointer = Boolean(hrefAtCol(line, pos.innerCol));
    }
    if (!pointer && pos) {
      const block = this.blockAt(pos.lineIndex);
      pointer = Boolean(this.fenceSource(block));
    }
    this.setPointer(pointer);
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

  handleControlHit(hit) {
    const block = this.blocks.find((entry) => entry.id === hit.blockId);
    if (!block) return;
    if (hit.kind === 'spin') return;
    if (hit.kind === 'close') {
      this.outputs.delete(block.id);
      this.rebuild();
      this.dirty = true;
      return;
    }
    if (hit.kind === 'copy') return void copyText(block.source || '');
    if (hit.kind === 'stop') return void this.runHandle?.kill();
    if (hit.kind === 'play') {
      if (this.runningBlock) return;
      return void this.runBlock(block);
    }
  }

  handleMouseClick(pos) {
    const hit = this.hitTestHover(pos);
    if (hit) return void this.handleControlHit(hit);
    const block = this.blockAt(pos.lineIndex);
    const text = this.fenceSource(block);
    if (text) return void copyText(text);
  }

  blockAt(lineIndex) {
    if (lineIndex === undefined || lineIndex === null) return null;
    for (const block of this.blocks) {
      if (lineIndex >= block.startLine && lineIndex < block.endLine) {
        return block;
      }
    }
    return null;
  }

  fenceSource(block) {
    if (!block || !String(block.id).startsWith('fence-')) return '';
    const from = block.startLine;
    const to = block.endLine - 1;
    const text = textFromOrigins(this.source, this.origins, from, to);
    if (text) return text;
    return block.source || '';
  }

  contentWidth() {
    const { innerCols } = innerSize();
    const gutterW = this.showLines ? `${this.lines.length}`.length + 1 : 0;
    return Math.max(1, innerCols - (gutterW ? gutterW + 1 : 0));
  }

  viewWindow() {
    const viewStart = this.offset;
    const last = viewStart + this.bodyHeight();
    const viewEnd = Math.min(this.lines.length, last) - 1;
    return { viewStart, viewEnd };
  }

  stickyPlayTarget(block, width, kind = 'play') {
    if (!block.play) return null;
    const { viewStart, viewEnd } = this.viewWindow();
    if (viewEnd < viewStart) return null;
    const visible = visibleBlockRange(block, viewStart, viewEnd);
    if (!visible) return null;

    const playLine = block.startLine + block.play.row;
    const playKind = block.play.kind || kind;
    const cols = playHitCols(width > 0 ? width : block.play.col1, kind);
    if (playLine >= viewStart && playLine <= viewEnd) {
      return {
        lineIndex: playLine,
        col0: block.play.col0,
        col1: block.play.col1,
        sticky: false,
        kind: playKind,
        blockId: block.id,
      };
    }
    if (playLine > viewEnd) {
      return {
        lineIndex: visible.visEnd,
        col0: cols.col0,
        col1: cols.col1,
        sticky: true,
        kind,
        blockId: block.id,
      };
    }
    return null;
  }

  stickyCopyTarget(block, width) {
    if (!block.copy) return null;
    const { viewStart, viewEnd } = this.viewWindow();
    if (viewEnd < viewStart) return null;
    const visible = visibleBlockRange(block, viewStart, viewEnd);
    if (!visible) return null;

    const copyLine = block.startLine + block.copy.row;
    const cols = copyHitCols(width > 0 ? width : block.copy.col1);
    if (copyLine >= viewStart && copyLine <= viewEnd) {
      return {
        lineIndex: copyLine,
        col0: block.copy.col0,
        col1: block.copy.col1,
        sticky: false,
        blockId: block.id,
      };
    }
    if (copyLine < viewStart) {
      return {
        lineIndex: visible.visStart,
        col0: cols.col0,
        col1: cols.col1,
        sticky: true,
        blockId: block.id,
      };
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
    const step = Viewer.typewriterStep(lag);
    shown = full.slice(0, shown.length + step);
    this.outputs.set(id, { ...cur, shown });
  }

  static typewriterStep(lag) {
    if (lag > 60) return Math.ceil(lag / 4);
    if (lag > 20) return 4;
    return Math.min(2, lag);
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

  static failOutput(message) {
    const text = asText(message);
    return {
      ok: false,
      stdout: '',
      stderr: text,
      text,
      shown: text,
      code: 1,
      running: false,
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

      if (!next.running) return void apply();
      if (scheduled) return;
      scheduled = true;
      setImmediate(() => {
        scheduled = false;
        const latest = paintGen;
        if (!this.running) return;
        this.rebuild();
        // A newer flush may have rebuilt during this turn.
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

    handle.promise
      .then((result) => {
        if (this.runHandle === handle) this.runHandle = null;
        this.runningBlock = null;
        this.stopSpinner();
        flush({ ...result, running: false });
      })
      .catch((error) => {
        if (this.runHandle === handle) this.runHandle = null;
        this.runningBlock = null;
        this.stopSpinner();
        const message = error.message || asText(error);
        flush(Viewer.failOutput(message));
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
    if (visibleWidth(line) > contentW) {
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
    const hints = '↑↓  ▶run  drag=copy  y  / ?  q';
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
