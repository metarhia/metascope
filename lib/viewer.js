'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { chrome, paint, OSC_BG_BLACK, OSC_BG_RESET } = require('./theme.js');
const { decodeKey, isIncompleteSequence } = require('./keys.js');
const { detectLang } = require('./detect.js');
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

const HELP_LINES = [
  'metascope — keyboard',
  '',
  '↑/k          line up',
  '↓/j          line down',
  '←/b/PgUp     page up',
  '→/PgDn       page down',
  'Ctrl+U/D     half page',
  'g / Home     top',
  'G / End      bottom',
  'Space        toggle status',
  '/            search',
  'n / N        next / prev match',
  'l            toggle line numbers',
  'w            toggle soft wrap',
  'H / L        scroll left / right (no wrap)',
  'r            reload file / directory',
  '⧉ click      copy code block',
  '▶ click      run code block (js/ts/bash)',
  '■ click      stop running block',
  '✕ click      hide output panel',
  'drag        select text (copied on release)',
  'click       clear selection',
  'y           copy selection again',
  'Esc          stop run / clear selection / quit',
  'js init      shared prelude for JS runs',
  '?            this help',
  'Esc / q      back / quit',
];

const openViewer = async (filePath, options = {}) => {
  const abs = path.resolve(filePath);
  const state = {
    filePath: abs,
    isDir: false,
    source: '',
    lang: detectLang(abs),
    lines: [],
    blocks: [],
    outputs: new Map(),
    prelude: {},
    offset: 0,
    hOffset: 0,
    showLines: false,
    showStatus: false,
    wrap: true,
    mode: 'view',
    searchQuery: '',
    searchInput: '',
    matches: [],
    matchIndex: -1,
    onBack: options.onBack || null,
    running: true,
    dirty: true,
    runningBlock: null,
    runHandle: null,
    spinTick: 0,
    spinTimer: null,
    selection: null,
    drag: null,
    hover: null,
  };
  await loadFile(state);
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return void printStatic(state);
  }
  return runInteractive(state);
};

const loadFile = async (state) => {
  state.isDir = await directoryExists(state.filePath);
  if (state.isDir) {
    state.source = await buildCatalogMarkdown(state.filePath);
    state.lang = 'md';
  } else {
    state.source = await fs.readFile(state.filePath, 'utf8');
    state.lang = detectLang(state.filePath);
  }
  rebuild(state);
};

const runCwd = (state) =>
  state.isDir ? state.filePath : path.dirname(state.filePath);

const rebuild = (state) => {
  const { innerCols } = innerSize();
  const gutter = state.showLines
    ? `${state.source.split('\n').length}`.length + 2
    : 0;
  const bodyWidth = Math.max(20, innerCols - gutter);
  const contentWidth = state.wrap ? bodyWidth : 0;
  const result = render(state.lang, state.source, {
    width: contentWidth || 10000,
    wrap: state.wrap,
    outputs: state.outputs,
    tick: state.spinTick || 0,
    hover: state.hover,
  });
  state.lines = result.lines;
  state.blocks = result.blocks || [];
  state.prelude = result.prelude || {};
  if (state.searchQuery) updateMatches(state);
  clampOffset(state);
  state.dirty = true;
};

const statusVisible = (state) =>
  state.showStatus || state.mode === 'search';

const chromeHeight = (state) => (statusVisible(state) ? 1 : 0);

const bodyHeight = (state) =>
  Math.max(1, innerSize().innerRows - chromeHeight(state));

const clampOffset = (state) => {
  const max = Math.max(0, state.lines.length - bodyHeight(state));
  state.offset = Math.min(Math.max(0, state.offset), max);
  state.hOffset = Math.max(0, state.hOffset);
};

const updateMatches = (state) => {
  const q = state.searchQuery.toLowerCase();
  state.matches = [];
  if (!q) {
    state.matchIndex = -1;
    return;
  }
  for (let i = 0; i < state.lines.length; i++) {
    if (stripAnsi(state.lines[i]).toLowerCase().includes(q)) {
      state.matches.push(i);
    }
  }
  state.matchIndex = state.matches.length ? 0 : -1;
  if (state.matchIndex >= 0) state.offset = Math.max(0, state.matches[0] - 2);
};

const printStatic = (state) => {
  const { innerCols } = innerSize();
  const result = render(state.lang, state.source, {
    width: innerCols,
    wrap: true,
  });
  const pad = '  ';
  process.stdout.write(result.lines.map((l) => pad + l).join('\n') + '\n');
};

const runInteractive = (state) => {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    process.stdout.write(ENTER_ALT + OSC_BG_BLACK + HIDE_CURSOR + MOUSE_ON);
    let seqBuf = '';
    let escTimer = null;
    const cleanup = () => {
      if (escTimer) {
        clearTimeout(escTimer);
        escTimer = null;
      }
      stopSpinner(state);
      if (state.runHandle) {
        state.runHandle.kill();
        state.runHandle = null;
      }
      process.stdout.write(
        MOUSE_OFF + SHOW_CURSOR + OSC_BG_RESET + LEAVE_ALT,
      );
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      process.stdout.removeListener('resize', onResize);
      process.removeListener('SIGINT', onSigInt);
    };

    const finish = (action = 'quit') => {
      if (!state.running) return;
      state.running = false;
      cleanup();
      resolve(action);
    };

    const onSigInt = () => finish('quit');

    const onResize = () => {
      const anchor = state.offset;
      const n = Math.max(1, state.lines.length);
      const ratio = state.lines.length > 0 ? anchor / n : 0;
      rebuild(state);
      state.offset = Math.floor(ratio * state.lines.length);
      clampOffset(state);
      paintScreen(state);
    };

    const dispatch = (key) => {
      handleKey(state, key, finish);
      if (state.running && state.dirty) paintScreen(state);
    };

    const flushSeqBuf = () => {
      while (seqBuf) {
        if (seqBuf === '\x1b') return; // wait for timeout or more bytes
        if (isIncompleteSequence(seqBuf)) return;

        let take = 1;
        if (seqBuf.startsWith('\x1b')) {
          if (seqBuf.startsWith('\x1b[<')) {
            const mouseEnd = seqBuf.search(/[Mm]/);
            if (mouseEnd === -1) return;
            take = mouseEnd + 1;
          } else if (seqBuf.startsWith('\x1b[')) {
            const m = seqBuf.match(/^\x1b\[[0-9;]*[A-Za-z~]/);
            if (!m) return;
            take = m[0].length;
          } else if (seqBuf.startsWith('\x1bO')) {
            if (seqBuf.length < 3) return;
            take = 3;
          } else {
            // ESC + non-CSI (e.g. alt-key): take ESC alone as escape-ish
            take = 1;
          }
        } else {
          const esc = seqBuf.indexOf('\x1b');
          take = esc === -1 ? seqBuf.length : esc;
        }

        const piece = seqBuf.slice(0, take);
        seqBuf = seqBuf.slice(take);
        dispatch(decodeKey(piece));
      }
    };

    const onData = (chunk) => {
      if (escTimer) {
        clearTimeout(escTimer);
        escTimer = null;
      }
      seqBuf += chunk;
      flushSeqBuf();
      // Lone ESC: distinguish Escape key from start of CSI / mouse
      if (seqBuf === '\x1b') {
        escTimer = setTimeout(() => {
          escTimer = null;
          if (seqBuf === '\x1b') {
            seqBuf = '';
            dispatch({ name: 'escape' });
          }
        }, 35);
      }
    };

    process.on('SIGINT', onSigInt);
    process.stdout.on('resize', onResize);
    stdin.on('data', onData);
    paintScreen(state);
  });
};

const viewKeyId = (key) => (key.name === 'char' ? key.ch : key.name);

const toggleWrap = (state) => {
  state.wrap = !state.wrap;
  state.hOffset = 0;
  rebuild(state);
};

const pan = (state, delta) => {
  if (state.wrap) return;
  state.hOffset = Math.max(0, state.hOffset + delta);
};

const reloadView = (state) => {
  const show = () => { if (state.running) paintScreen(state); };
  loadFile(state).then(show).catch(() => {});
  return true;
};

const VIEW_KEY_BINDS = [
  [['space'], (state) => { state.showStatus = !state.showStatus; }],
  [['up', 'k'], (state) => { state.offset -= 1; }],
  [['down', 'j'], (state) => { state.offset += 1; }],
  [['left', 'pageup', 'b'], (state, view) => { state.offset -= view.page; }],
  [['right', 'pagedown'], (state, view) => { state.offset += view.page; }],
  [['ctrl-u'], (state, view) => { state.offset -= view.half; }],
  [['ctrl-d'], (state, view) => { state.offset += view.half; }],
  [['home', 'g'], (state) => { state.offset = 0; }],
  [['end', 'G'], (state) => { state.offset = state.lines.length; }],
  [['/'], (state) => { state.mode = 'search'; state.searchInput = ''; }],
  [['n'], (state) => { jumpMatch(state, 1); }],
  [['N'], (state) => { jumpMatch(state, -1); }],
  [['l'], (state) => { state.showLines = !state.showLines; rebuild(state); }],
  [['w'], toggleWrap],
  [['H'], (state) => { pan(state, -4); }],
  [['L'], (state) => { pan(state, 4); }],
  [['r'], reloadView],
  [['?'], (state) => { state.mode = 'help'; }],
];

const VIEW_KEYS = {};
for (const [ids, run] of VIEW_KEY_BINDS) {
  for (const id of ids) VIEW_KEYS[id] = run;
}

const handleKey = (state, key, finish) => {
  if (key.name === 'mouse') return void handleMouse(state, key);

  if (state.mode === 'help') {
    if (
      key.name === 'escape' ||
      (key.name === 'char' && (key.ch === 'q' || key.ch === '?'))
    ) {
      state.mode = 'view';
      state.dirty = true;
    }
    return;
  }

  if (state.mode === 'search') return void handleSearchInput(state, key);

  if (key.name === 'ctrl-c') return void finish('quit');
  if (key.name === 'char' && key.ch === 'q') return void finish('quit');
  if (key.name === 'escape') {
    if (state.runningBlock && state.runHandle) {
      return void state.runHandle.kill();
    }
    if (state.selection) {
      state.selection = null;
      state.dirty = true;
      return;
    }
    if (state.onBack) return void finish('back');
    return void finish('quit');
  }

  if (key.name === 'char' && key.ch === 'y' && state.selection) {
    return void copySelection(state);
  }

  const page = bodyHeight(state);
  const half = Math.max(1, Math.floor(page / 2));
  const view = { page, half };
  const id = viewKeyId(key);
  const run = VIEW_KEYS[id];
  if (!run) return;
  const stop = run(state, view);
  if (stop) return;

  clampOffset(state);
  state.dirty = true;
};

/**
 * Map screen click (1-based col/row) to document line + content column.
 */
const screenToDoc = (state, col, row) => {
  const { innerCols } = innerSize();
  const gutterW = state.showLines
    ? `${state.lines.length}`.length + 1
    : 0;
  const gutterPad = gutterW ? gutterW + 1 : 0;
  const contentRow = row - MARGIN_Y_TOP - 1;
  if (contentRow < 0) return null;
  const lineIndex = state.offset + contentRow;
  if (lineIndex < 0 || lineIndex >= state.lines.length) return null;
  const viewCol = col - 1 - MARGIN_X - gutterPad;
  const h = state.wrap ? 0 : state.hOffset;
  const innerCol = Math.max(0, viewCol) + h;
  return { lineIndex, innerCol, viewCol: Math.max(0, viewCol) };
};

const normalizeSelection = (sel) => {
  if (!sel || !sel.anchor || !sel.focus) return null;
  let a = sel.anchor;
  let b = sel.focus;
  const laterLine = a.lineIndex > b.lineIndex;
  const laterCol = a.lineIndex === b.lineIndex && a.innerCol > b.innerCol;
  if (laterLine || laterCol) {
    [a, b] = [b, a];
  }
  return { a, b };
};

const selectionMoved = (drag) => {
  if (!drag || !drag.start || !drag.last) return false;
  return (
    Math.abs(drag.last.lineIndex - drag.start.lineIndex) >= DRAG_THRESHOLD ||
    Math.abs(drag.last.innerCol - drag.start.innerCol) >= DRAG_THRESHOLD
  );
};

const getSelectedText = (state) => {
  const norm = normalizeSelection(state.selection);
  if (!norm) return '';
  const parts = [];
  for (let i = norm.a.lineIndex; i <= norm.b.lineIndex; i++) {
    const plain = stripAnsi(state.lines[i] || '');
    let from = 0;
    let to = plain.length;
    if (i === norm.a.lineIndex) from = Math.min(norm.a.innerCol, plain.length);
    if (i === norm.b.lineIndex) {
      to = Math.min(norm.b.innerCol + 1, plain.length);
    }
    if (from > to) from = to;
    parts.push(plain.slice(from, to));
  }
  return parts.join('\n');
};

const copySelection = (state) => {
  const text = getSelectedText(state);
  if (!text) return false;
  return copyText(text);
};

const highlightSelection = (line, lineIndex, state) => {
  const norm = normalizeSelection(state.selection);
  if (!norm) return line;
  if (lineIndex < norm.a.lineIndex || lineIndex > norm.b.lineIndex) return line;

  const h = state.wrap ? 0 : state.hOffset;
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
};

const handleMouse = (state, key) => {
  const btn = key.button;
  const isWheel = btn === 64 || btn === 65;
  const isMove = btn === 35; // any-event tracking: motion, no buttons
  const isDrag = btn >= 32 && btn < 64 && !isMove;
  const baseBtn = isDrag ? btn - 32 : btn;

  if (isWheel) {
    if (btn === 64) state.offset -= 3;
    else state.offset += 3;
    clampOffset(state);
    state.dirty = true;
    return;
  }

  if (state.mode !== 'view') return;

  if (isMove) return void updateHover(state, key);

  if (isDrag && baseBtn === 0) {
    const pos = screenToDoc(state, key.col, key.row);
    if (!pos || !state.drag) return;
    state.drag.last = pos;
    if (selectionMoved(state.drag)) {
      state.selection = {
        anchor: state.drag.start,
        focus: pos,
      };
      state.drag.selecting = true;
      state.dirty = true;
    }
    return;
  }

  // Left press — clear selection immediately (don't wait for release)
  if (baseBtn === 0 && !key.release) {
    const pos = screenToDoc(state, key.col, key.row);
    if (state.selection) {
      state.selection = null;
      paintScreen(state);
    }
    state.drag = pos
      ? { start: pos, last: pos, selecting: false }
      : null;
    return;
  }

  if (baseBtn === 0 && key.release) {
    const pos =
      screenToDoc(state, key.col, key.row) || (state.drag && state.drag.last);
    const drag = state.drag;
    state.drag = null;

    const moved = selectionMoved({ ...drag, last: pos || drag.last });
    if (drag && (drag.selecting || moved)) {
      const focus = pos || drag.last;
      state.selection = { anchor: drag.start, focus };
      copySelection(state);
      state.dirty = true;
      return;
    }

    if (!pos) return;
    return void handleMouseClick(state, pos);
  }
};

const updateHover = (state, key) => {
  const pos = screenToDoc(state, key.col, key.row);
  const next = pos ? hitTestHover(state, pos) : null;
  const prev = state.hover;
  const sameId = prev && next && prev.blockId === next.blockId;
  const sameHit = sameId && prev.kind === next.kind;
  const same = (!prev && !next) || sameHit;
  if (same) return;
  state.hover = next;
  rebuild(state);
  paintScreen(state);
};

const hitTestHover = (state, pos) => {
  const col = pos.viewCol;
  const w = contentWidth(state);

  for (const block of state.blocks) {
    if (!block.close) continue;
    if (pos.lineIndex !== block.close.lineIndex) continue;
    if (col >= block.close.col0 && col < block.close.col1) {
      const out = state.outputs.get(block.id);
      const kind = out && out.running ? 'spin' : 'close';
      return { blockId: block.id, kind };
    }
  }

  for (const block of state.blocks) {
    if (!block.copy) continue;
    const target = stickyCopyTarget(state, block, w);
    if (!target) continue;
    if (pos.lineIndex !== target.lineIndex) continue;
    if (col >= target.col0 && col < target.col1) {
      return { blockId: block.id, kind: 'copy' };
    }
  }

  for (const block of state.blocks) {
    if (!block.play) continue;
    const running = state.runningBlock === block.id;
    const kind = running ? 'stop' : block.play.kind || 'play';
    const target = stickyPlayTarget(state, block, w, kind);
    if (!target) continue;
    if (pos.lineIndex !== target.lineIndex) continue;
    if (col >= target.col0 && col < target.col1) {
      return { blockId: block.id, kind };
    }
  }

  return null;
};

const handleMouseClick = (state, pos) => {
  // Controls are laid out in the visible content row (not h-scrolled doc cols).
  const col = pos.viewCol;

  for (const block of state.blocks) {
    if (!block.close) continue;
    if (pos.lineIndex !== block.close.lineIndex) continue;
    if (col >= block.close.col0 && col < block.close.col1) {
      const out = state.outputs.get(block.id);
      if (out && out.running) return; // spinner — not closable
      state.outputs.delete(block.id);
      rebuild(state);
      state.dirty = true;
      return;
    }
  }

  for (const block of state.blocks) {
    if (!block.copy) continue;
    const target = stickyCopyTarget(state, block, contentWidth(state));
    if (!target) continue;
    if (pos.lineIndex !== target.lineIndex) continue;
    if (col >= target.col0 && col < target.col1) {
      return void copyText(block.source || '');
    }
  }

  for (const block of state.blocks) {
    if (!block.play) continue;
    const running = state.runningBlock === block.id;
    const kind = running ? 'stop' : block.play.kind || 'play';
    const target = stickyPlayTarget(state, block, contentWidth(state), kind);
    if (!target) continue;
    if (pos.lineIndex !== target.lineIndex) continue;
    if (col >= target.col0 && col < target.col1) {
      if (state.runningBlock === block.id) {
        return void state.runHandle?.kill();
      }
      if (state.runningBlock) return;
      return void runBlock(state, block);
    }
  }
};

const contentWidth = (state) => {
  const { innerCols } = innerSize();
  const gutterW = state.showLines
    ? `${state.lines.length}`.length + 1
    : 0;
  return Math.max(1, innerCols - (gutterW ? gutterW + 1 : 0));
};

const stickyPlayTarget = (state, block, width, kind = 'play') => {
  if (!block.play) return null;
  const viewStart = state.offset;
  const last = viewStart + bodyHeight(state);
  const viewEnd = Math.min(state.lines.length, last) - 1;
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
};

const stickyCopyTarget = (state, block, width) => {
  if (!block.copy) return null;
  const viewStart = state.offset;
  const last = viewStart + bodyHeight(state);
  const viewEnd = Math.min(state.lines.length, last) - 1;
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
};

const startSpinner = (state) => {
  stopSpinner(state);
  state.spinTick = 0;
  state.spinTimer = setInterval(() => {
    if (!state.running || !state.runningBlock) {
      return void stopSpinner(state);
    }
    state.spinTick += 1;
    advanceTypewriter(state);
    rebuild(state);
    scrollFollowOutput(state, state.runningBlock);
    paintScreen(state);
  }, 50);
};

const stopSpinner = (state) => {
  if (state.spinTimer) {
    clearInterval(state.spinTimer);
    state.spinTimer = null;
  }
};

const advanceTypewriter = (state) => {
  const id = state.runningBlock;
  if (!id) return;
  const cur = state.outputs.get(id);
  if (!cur || !cur.running) return;
  const full = asText(cur.text);
  let shown = asText(cur.shown);
  if (shown.length >= full.length) {
    if (shown !== full) {
      state.outputs.set(id, { ...cur, shown: full });
    }
    return;
  }
  const lag = full.length - shown.length;
  // Catch up if process dumps a lot; otherwise type a few chars per tick.
  const step = lag > 60 ? Math.ceil(lag / 4) : lag > 20 ? 4 : Math.min(2, lag);
  shown = full.slice(0, shown.length + step);
  state.outputs.set(id, { ...cur, shown });
};

const composeRunSource = (prelude, source) => {
  if (!prelude) return { source, preludeLines: 0 };
  const head = prelude.replace(/\s*$/, '');
  const preludeLines = head.split('\n').length + 1; // blank separator
  return { source: `${head}\n\n${source}`, preludeLines };
};

const pendingOutput = () => ({
  ok: true,
  stdout: '',
  stderr: '',
  text: '',
  shown: '',
  code: 0,
  running: true,
});

const runBlock = (state, block) => {
  if (state.runningBlock) return;
  state.runningBlock = block.id;

  const prelude = pickPrelude(state.prelude, block.lang);
  const composed = composeRunSource(prelude, block.source);
  const source = composed.source;
  const preludeLines = composed.preludeLines;

  const fileLabel = path.basename(state.filePath);
  const fromFile = block.id === 'file-0' || state.lang !== 'md';
  const fallback = fromFile ? fileLabel : 'Example';
  const runLabel = block.label || fallback;

  state.outputs.set(block.id, pendingOutput());
  startSpinner(state);
  rebuild(state);
  // Don't jump the view on start — follow once output hits the bottom.
  paintScreen(state);

  let scheduled = false;
  let paintGen = 0;
  const flush = (result) => {
    const prev = state.outputs.get(block.id) || {};
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
    state.outputs.set(block.id, next);

    const gen = ++paintGen;
    const apply = () => {
      if (gen !== paintGen) return;
      if (!state.running) return;
      rebuild(state);
      scrollFollowOutput(state, block.id);
      paintScreen(state);
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
      if (!state.running) return;
      rebuild(state);
      if (latest !== paintGen) return;
      scrollFollowOutput(state, block.id);
      paintScreen(state);
    });
  };

  const handle = runSnippetStream(block.lang, source, {
    cwd: runCwd(state),
    onUpdate: flush,
    label: runLabel,
    preludeLines,
  });
  state.runHandle = handle;

  handle.promise.then((result) => {
    if (state.runHandle === handle) state.runHandle = null;
    state.runningBlock = null;
    stopSpinner(state);
    flush({ ...result, running: false });
  });
};

const scrollFollowOutput = (state, blockId) => {
  const updated = state.blocks.find((b) => b.id === blockId);
  if (!updated) return;
  let outputEnd = state.lines.length;
  for (const b of state.blocks) {
    if (b.startLine > updated.endLine) {
      outputEnd = b.startLine;
      break;
    }
  }
  const height = bodyHeight(state);
  const viewBottom = state.offset + height;
  if (outputEnd > viewBottom) {
    state.offset = Math.max(0, outputEnd - height);
    clampOffset(state);
  }
};

const pickPrelude = (prelude, lang) => {
  if (!prelude || typeof prelude !== 'object') return '';
  const l = asText(lang).toLowerCase();
  if (prelude[l]) return prelude[l];
  if (['js', 'mjs', 'ts'].includes(l) && prelude.js) return prelude.js;
  return '';
};

const handleSearchInput = (state, key) => {
  if (key.name === 'escape') {
    state.mode = 'view';
    state.dirty = true;
    return;
  }
  if (key.name === 'enter') {
    state.searchQuery = state.searchInput;
    state.mode = 'view';
    updateMatches(state);
    clampOffset(state);
    state.dirty = true;
    return;
  }
  if (key.name === 'backspace') {
    state.searchInput = state.searchInput.slice(0, -1);
    state.dirty = true;
    return;
  }
  if (key.name === 'char' && key.ch && !key.ch.startsWith('\x1b')) {
    state.searchInput += key.ch;
    state.dirty = true;
  }
};

const jumpMatch = (state, dir) => {
  if (!state.matches.length) return;
  if (state.matchIndex < 0) state.matchIndex = 0;
  else {
    state.matchIndex =
      (state.matchIndex + dir + state.matches.length) % state.matches.length;
  }
  state.offset = Math.max(0, state.matches[state.matchIndex] - 2);
};

const stickyOverlays = (state, contentW) => {
  const play = new Map();
  const copy = new Map();
  for (const block of state.blocks) {
    const kind = state.runningBlock === block.id ? 'stop' : 'play';
    const target = stickyPlayTarget(state, block, contentW, kind);
    if (target && target.sticky) play.set(target.lineIndex, target);
    const copyTarget = stickyCopyTarget(state, block, contentW);
    if (copyTarget && copyTarget.sticky) {
      copy.set(copyTarget.lineIndex, copyTarget);
    }
  }
  return { play, copy };
};

const paintContentLine = (state, i, contentW, gutterW, overlays) => {
  let line = state.lines[i];
  if (!state.wrap && state.hOffset > 0) {
    line = sliceVisible(line, state.hOffset, contentW);
  } else if (visibleWidth(line) > contentW) {
    line = sliceVisible(line, 0, contentW);
  }
  if (isMatchLine(state, i)) line = highlightMatch(line, state.searchQuery);
  line = highlightSelection(line, i, state);

  const stickyCopy = overlays.copy.get(i);
  if (stickyCopy) {
    const hot = isHot(state.hover, stickyCopy.blockId, ['copy']);
    line = overlayCopyButton(line, contentW, hot);
  }

  const sticky = overlays.play.get(i);
  if (sticky) {
    const hot = isHot(state.hover, sticky.blockId, ['play', 'stop']);
    line = overlayControlButton(line, contentW, sticky.kind || 'play', hot);
  }

  if (state.showLines) {
    const num = paint('muted', `${i + 1}`.padStart(gutterW) + ' ');
    line = num + line;
  }
  return line;
};

const paintScreen = (state) => {
  const { cols, rows, innerCols, innerRows } = innerSize();

  if (state.mode === 'help') {
    flushFrame(withMargins(buildHelpInner(innerCols, innerRows), cols, rows));
    state.dirty = false;
    return;
  }

  const height = bodyHeight(state);
  const inner = [];

  const start = state.offset;
  const end = Math.min(state.lines.length, start + height);
  const gutterW = state.showLines ? `${state.lines.length}`.length + 1 : 0;
  const contentW = Math.max(1, innerCols - (gutterW ? gutterW + 1 : 0));
  const overlays = stickyOverlays(state, contentW);

  for (let i = start; i < end; i++) {
    inner.push(paintContentLine(state, i, contentW, gutterW, overlays));
  }

  if (statusVisible(state)) {
    while (inner.length < innerRows - 1) inner.push('');
    if (inner.length > innerRows - 1) inner.length = innerRows - 1;
    inner.push(buildFooter(state, innerCols));
  } else if (inner.length > innerRows) {
    inner.length = innerRows;
  }

  flushFrame(withMargins(inner, cols, rows));
  state.dirty = false;
};

const isMatchLine = (state, i) =>
  state.searchQuery && state.matches.includes(i);

const highlightMatch = (line, query) => {
  if (!query) return line;
  const plain = stripAnsi(line);
  if (plain.toLowerCase().indexOf(query.toLowerCase()) === -1) return line;
  return paint('match', plain);
};

const buildFooter = (state, cols) => {
  if (state.mode === 'search') {
    return chrome.footer(`🔍 /${state.searchInput}█`);
  }
  const pos = `${state.offset + 1}-${Math.min(
    state.lines.length,
    state.offset + bodyHeight(state),
  )}/${state.lines.length}`;
  const hints = state.wrap
    ? '↑↓  ▶run  drag=copy  y  / ?  q'
    : '↑↓  H/L  ▶run  drag=copy  y  / ?  q';
  const left = chrome.footer(`↕ ${pos}`);
  const right = chrome.footer(hints);
  const pad = Math.max(1, cols - visibleWidth(left) - visibleWidth(right));
  let line = left + ' '.repeat(pad) + right;
  if (visibleWidth(line) > cols) line = sliceVisible(line, 0, cols);
  return line;
};

const buildHelpInner = (innerCols, innerRows) => {
  const box = HELP_LINES.map((l) => {
    if (!l) return '';
    if (l.startsWith('metascope')) return chrome.help(l);
    const parts = l.match(/^(\S+)\s+(.*)$/);
    if (parts) {
      return `${chrome.helpKey(parts[1].padEnd(14))}${chrome.footer(parts[2])}`;
    }
    return chrome.footer(l);
  });
  const tip = chrome.muted('Esc to close');
  const block = [...box, '', tip];
  const top = Math.max(0, Math.floor((innerRows - block.length) / 2));
  const inner = [];
  for (let i = 0; i < innerRows; i++) {
    const idx = i - top;
    if (idx >= 0 && idx < block.length) {
      const line = block[idx];
      const pad = Math.max(0, Math.floor((innerCols - visibleWidth(line)) / 2));
      inner.push(' '.repeat(pad) + line);
    } else {
      inner.push('');
    }
  }
  return inner;
};

module.exports = { openViewer };
