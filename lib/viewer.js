'use strict';

const fs = require('node:fs/promises');
const fsSync = require('node:fs');
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

const HELP_MD = fsSync.readFileSync(path.join(__dirname, 'help.md'), 'utf8');

const viewer = {};

viewer.openViewer = async (filePath, options = {}) => {
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
  await viewer.loadFile(state);
  let action;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    viewer.printStatic(state);
  } else {
    action = await viewer.runInteractive(state);
  }
  return action;
};

viewer.loadFile = async (state) => {
  state.isDir = await directoryExists(state.filePath);
  if (state.isDir) {
    state.source = await buildCatalogMarkdown(state.filePath);
    state.lang = 'md';
  } else {
    state.source = await fs.readFile(state.filePath, 'utf8');
    state.lang = detectLang(state.filePath);
  }
  viewer.rebuild(state);
};

viewer.runCwd = (state) =>
  state.isDir ? state.filePath : path.dirname(state.filePath);

viewer.rebuild = (state) => {
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
  if (state.searchQuery) viewer.updateMatches(state);
  viewer.clampOffset(state);
  state.dirty = true;
};

viewer.statusVisible = (state) => state.showStatus || state.mode === 'search';

viewer.chromeHeight = (state) => (viewer.statusVisible(state) ? 1 : 0);

viewer.bodyHeight = (state) =>
  Math.max(1, innerSize().innerRows - viewer.chromeHeight(state));

viewer.clampOffset = (state) => {
  const max = Math.max(0, state.lines.length - viewer.bodyHeight(state));
  state.offset = Math.min(Math.max(0, state.offset), max);
  state.hOffset = Math.max(0, state.hOffset);
};

viewer.updateMatches = (state) => {
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

viewer.printStatic = (state) => {
  const { innerCols } = innerSize();
  const result = render(state.lang, state.source, {
    width: innerCols,
    wrap: true,
  });
  const pad = '  ';
  process.stdout.write(`${result.lines.map((l) => pad + l).join('\n')}\n`);
};

viewer.runInteractive = (state) =>
  new Promise((resolve) => {
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    process.stdout.write(ENTER_ALT + OSC_BG_BLACK + HIDE_CURSOR + MOUSE_ON);
    let seqBuf = '';
    let escTimer = null;

    const handlers = {};

    handlers.cleanup = () => {
      if (escTimer) {
        clearTimeout(escTimer);
        escTimer = null;
      }
      viewer.stopSpinner(state);
      if (state.runHandle) {
        state.runHandle.kill();
        state.runHandle = null;
      }
      process.stdout.write(MOUSE_OFF + SHOW_CURSOR + OSC_BG_RESET + LEAVE_ALT);
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', handlers.onData);
      process.stdout.removeListener('resize', handlers.onResize);
      process.removeListener('SIGINT', handlers.onSigInt);
    };

    handlers.finish = (action = 'quit') => {
      if (!state.running) return;
      state.running = false;
      handlers.cleanup();
      resolve(action);
    };

    handlers.onSigInt = () => {
      handlers.finish('quit');
    };

    handlers.onResize = () => {
      const anchor = state.offset;
      const n = Math.max(1, state.lines.length);
      const ratio = state.lines.length > 0 ? anchor / n : 0;
      viewer.rebuild(state);
      state.offset = Math.floor(ratio * state.lines.length);
      viewer.clampOffset(state);
      viewer.paintScreen(state);
    };

    handlers.dispatch = (key) => {
      viewer.handleKey(state, key, handlers.finish);
      if (state.running && state.dirty) viewer.paintScreen(state);
    };

    handlers.flushSeqBuf = () => {
      while (seqBuf) {
        if (seqBuf === '\x1b') return; // wait for timeout or more bytes
        if (isIncompleteSequence(seqBuf)) return;

        let take;
        if (seqBuf.startsWith('\x1b')) {
          if (seqBuf.startsWith('\x1b[<')) {
            const mouseEnd = seqBuf.search(/[Mm]/);
            if (mouseEnd === -1) return;
            take = mouseEnd + 1;
          } else if (seqBuf.startsWith('\x1b[')) {
            const esc = '\u001b';
            const csi = new RegExp(`^${esc}\\[[0-9;]*[A-Za-z~]`);
            const m = seqBuf.match(csi);
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
        handlers.dispatch(decodeKey(piece));
      }
    };

    handlers.onData = (chunk) => {
      if (escTimer) {
        clearTimeout(escTimer);
        escTimer = null;
      }
      seqBuf += chunk;
      handlers.flushSeqBuf();
      // Lone ESC: distinguish Escape key from start of CSI / mouse
      if (seqBuf === '\x1b') {
        escTimer = setTimeout(() => {
          escTimer = null;
          if (seqBuf === '\x1b') {
            seqBuf = '';
            handlers.dispatch({ name: 'escape' });
          }
        }, 35);
      }
    };

    process.on('SIGINT', handlers.onSigInt);
    process.stdout.on('resize', handlers.onResize);
    stdin.on('data', handlers.onData);
    viewer.paintScreen(state);
  });

viewer.viewKeyId = (key) => (key.name === 'char' ? key.ch : key.name);

viewer.toggleWrap = (state) => {
  state.wrap = !state.wrap;
  state.hOffset = 0;
  viewer.rebuild(state);
};

viewer.pan = (state, delta) => {
  if (state.wrap) return;
  state.hOffset = Math.max(0, state.hOffset + delta);
};

viewer.reloadView = (state) => {
  const show = () => {
    if (state.running) viewer.paintScreen(state);
  };
  viewer
    .loadFile(state)
    .then(show)
    .catch(() => {});
  return true;
};

viewer.ACTIONS = {
  toggleStatus: (state) => {
    state.showStatus = !state.showStatus;
  },
  lineUp: (state) => {
    state.offset -= 1;
  },
  lineDown: (state) => {
    state.offset += 1;
  },
  pageUp: (state, view) => {
    state.offset -= view.page;
  },
  pageDown: (state, view) => {
    state.offset += view.page;
  },
  halfPageUp: (state, view) => {
    state.offset -= view.half;
  },
  halfPageDown: (state, view) => {
    state.offset += view.half;
  },
  goTop: (state) => {
    state.offset = 0;
  },
  goBottom: (state) => {
    state.offset = state.lines.length;
  },
  startSearch: (state) => {
    state.mode = 'search';
    state.searchInput = '';
  },
  nextMatch: (state) => {
    viewer.jumpMatch(state, 1);
  },
  prevMatch: (state) => {
    viewer.jumpMatch(state, -1);
  },
  toggleLines: (state) => {
    state.showLines = !state.showLines;
    viewer.rebuild(state);
  },
  toggleWrap: (state) => viewer.toggleWrap(state),
  panLeft: (state) => {
    viewer.pan(state, -4);
  },
  panRight: (state) => {
    viewer.pan(state, 4);
  },
  reload: (state) => viewer.reloadView(state),
  showHelp: (state) => {
    state.mode = 'help';
  },
};

viewer.KEYS = {
  space: 'toggleStatus',
  up: 'lineUp',
  k: 'lineUp',
  down: 'lineDown',
  j: 'lineDown',
  left: 'pageUp',
  pageup: 'pageUp',
  b: 'pageUp',
  right: 'pageDown',
  pagedown: 'pageDown',
  'ctrl-u': 'halfPageUp',
  'ctrl-d': 'halfPageDown',
  home: 'goTop',
  g: 'goTop',
  end: 'goBottom',
  G: 'goBottom',
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

viewer.resolveViewKey = (id) => {
  const name = viewer.KEYS[id];
  const action = name ? viewer.ACTIONS[name] : null;
  return typeof action === 'function' ? action : null;
};

viewer.handleKey = (state, key, finish) => {
  if (key.name === 'mouse') return void viewer.handleMouse(state, key);

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

  if (state.mode === 'search') return void viewer.handleSearchInput(state, key);

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
    return void viewer.copySelection(state);
  }

  const page = viewer.bodyHeight(state);
  const half = Math.max(1, Math.floor(page / 2));
  const view = { page, half };
  const run = viewer.resolveViewKey(viewer.viewKeyId(key));
  if (!run) return;
  const stop = run(state, view);
  if (stop) return;

  viewer.clampOffset(state);
  state.dirty = true;
};

/**
 * Map screen click (1-based col/row) to document line + content column.
 */
viewer.screenToDoc = (state, col, row) => {
  const gutterW = state.showLines ? `${state.lines.length}`.length + 1 : 0;
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

viewer.normalizeSelection = (sel) => {
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

viewer.selectionMoved = (drag) => {
  if (!drag || !drag.start || !drag.last) return false;
  return (
    Math.abs(drag.last.lineIndex - drag.start.lineIndex) >= DRAG_THRESHOLD ||
    Math.abs(drag.last.innerCol - drag.start.innerCol) >= DRAG_THRESHOLD
  );
};

viewer.getSelectedText = (state) => {
  const norm = viewer.normalizeSelection(state.selection);
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

viewer.copySelection = (state) => {
  const text = viewer.getSelectedText(state);
  if (!text) return false;
  return copyText(text);
};

viewer.highlightSelection = (line, lineIndex, state) => {
  const norm = viewer.normalizeSelection(state.selection);
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

viewer.handleMouse = (state, key) => {
  const btn = key.button;
  const isWheel = btn === 64 || btn === 65;
  const isMove = btn === 35; // any-event tracking: motion, no buttons
  const isDrag = btn >= 32 && btn < 64 && !isMove;
  const baseBtn = isDrag ? btn - 32 : btn;

  if (isWheel) {
    if (btn === 64) state.offset -= 3;
    else state.offset += 3;
    viewer.clampOffset(state);
    state.dirty = true;
    return;
  }

  if (state.mode !== 'view') return;

  if (isMove) return void viewer.updateHover(state, key);

  if (isDrag && baseBtn === 0) {
    const pos = viewer.screenToDoc(state, key.col, key.row);
    if (!pos || !state.drag) return;
    state.drag.last = pos;
    if (viewer.selectionMoved(state.drag)) {
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
    const pos = viewer.screenToDoc(state, key.col, key.row);
    if (state.selection) {
      state.selection = null;
      viewer.paintScreen(state);
    }
    state.drag = pos ? { start: pos, last: pos, selecting: false } : null;
    return;
  }

  if (baseBtn === 0 && key.release) {
    const fallback = state.drag && state.drag.last;
    const pos = viewer.screenToDoc(state, key.col, key.row) || fallback;
    const drag = state.drag;
    state.drag = null;

    const moved = viewer.selectionMoved({ ...drag, last: pos || drag.last });
    if (drag && (drag.selecting || moved)) {
      const focus = pos || drag.last;
      state.selection = { anchor: drag.start, focus };
      viewer.copySelection(state);
      state.dirty = true;
      return;
    }

    if (!pos) return;
    return void viewer.handleMouseClick(state, pos);
  }
};

viewer.updateHover = (state, key) => {
  const pos = viewer.screenToDoc(state, key.col, key.row);
  const next = pos ? viewer.hitTestHover(state, pos) : null;
  const prev = state.hover;
  const sameId = prev && next && prev.blockId === next.blockId;
  const sameHit = sameId && prev.kind === next.kind;
  const same = (!prev && !next) || sameHit;
  if (same) return;
  state.hover = next;
  viewer.rebuild(state);
  viewer.paintScreen(state);
};

viewer.hitTestHover = (state, pos) => {
  const col = pos.viewCol;
  const w = viewer.contentWidth(state);

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
    const target = viewer.stickyCopyTarget(state, block, w);
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
    const target = viewer.stickyPlayTarget(state, block, w, kind);
    if (!target) continue;
    if (pos.lineIndex !== target.lineIndex) continue;
    if (col >= target.col0 && col < target.col1) {
      return { blockId: block.id, kind };
    }
  }

  return null;
};

viewer.handleMouseClick = (state, pos) => {
  // Controls are laid out in the visible content row (not h-scrolled doc cols).
  const col = pos.viewCol;

  for (const block of state.blocks) {
    if (!block.close) continue;
    if (pos.lineIndex !== block.close.lineIndex) continue;
    if (col >= block.close.col0 && col < block.close.col1) {
      const out = state.outputs.get(block.id);
      if (out && out.running) return; // spinner — not closable
      state.outputs.delete(block.id);
      viewer.rebuild(state);
      state.dirty = true;
      return;
    }
  }

  for (const block of state.blocks) {
    if (!block.copy) continue;
    const width = viewer.contentWidth(state);
    const target = viewer.stickyCopyTarget(state, block, width);
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
    const width = viewer.contentWidth(state);
    const target = viewer.stickyPlayTarget(state, block, width, kind);
    if (!target) continue;
    if (pos.lineIndex !== target.lineIndex) continue;
    if (col >= target.col0 && col < target.col1) {
      if (state.runningBlock === block.id) {
        return void state.runHandle?.kill();
      }
      if (state.runningBlock) return;
      return void viewer.runBlock(state, block);
    }
  }
};

viewer.contentWidth = (state) => {
  const { innerCols } = innerSize();
  const gutterW = state.showLines ? `${state.lines.length}`.length + 1 : 0;
  return Math.max(1, innerCols - (gutterW ? gutterW + 1 : 0));
};

viewer.stickyPlayTarget = (state, block, width, kind = 'play') => {
  if (!block.play) return null;
  const viewStart = state.offset;
  const last = viewStart + viewer.bodyHeight(state);
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

viewer.stickyCopyTarget = (state, block, width) => {
  if (!block.copy) return null;
  const viewStart = state.offset;
  const last = viewStart + viewer.bodyHeight(state);
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

viewer.startSpinner = (state) => {
  viewer.stopSpinner(state);
  state.spinTick = 0;
  state.spinTimer = setInterval(() => {
    if (!state.running || !state.runningBlock) {
      return void viewer.stopSpinner(state);
    }
    state.spinTick += 1;
    viewer.advanceTypewriter(state);
    viewer.rebuild(state);
    viewer.scrollFollowOutput(state, state.runningBlock);
    viewer.paintScreen(state);
  }, 50);
};

viewer.stopSpinner = (state) => {
  if (state.spinTimer) {
    clearInterval(state.spinTimer);
    state.spinTimer = null;
  }
};

viewer.advanceTypewriter = (state) => {
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
  let step = Math.min(2, lag);
  if (lag > 20) step = 4;
  if (lag > 60) step = Math.ceil(lag / 4);
  shown = full.slice(0, shown.length + step);
  state.outputs.set(id, { ...cur, shown });
};

viewer.composeRunSource = (prelude, source) => {
  if (!prelude) return { source, preludeLines: 0 };
  const head = prelude.replace(/\s*$/, '');
  const preludeLines = head.split('\n').length + 1; // blank separator
  return { source: `${head}\n\n${source}`, preludeLines };
};

viewer.pendingOutput = () => ({
  ok: true,
  stdout: '',
  stderr: '',
  text: '',
  shown: '',
  code: 0,
  running: true,
});

viewer.runBlock = (state, block) => {
  if (state.runningBlock) return;
  state.runningBlock = block.id;

  const prelude = viewer.pickPrelude(state.prelude, block.lang);
  const composed = viewer.composeRunSource(prelude, block.source);
  const source = composed.source;
  const preludeLines = composed.preludeLines;

  const fileLabel = path.basename(state.filePath);
  const fromFile = block.id === 'file-0' || state.lang !== 'md';
  const fallback = fromFile ? fileLabel : 'Example';
  const runLabel = block.label || fallback;

  state.outputs.set(block.id, viewer.pendingOutput());
  viewer.startSpinner(state);
  viewer.rebuild(state);
  // Don't jump the view on start — follow once output hits the bottom.
  viewer.paintScreen(state);

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
      viewer.rebuild(state);
      viewer.scrollFollowOutput(state, block.id);
      viewer.paintScreen(state);
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
      viewer.rebuild(state);
      if (latest !== paintGen) return;
      viewer.scrollFollowOutput(state, block.id);
      viewer.paintScreen(state);
    });
  };

  const handle = runSnippetStream(block.lang, source, {
    cwd: viewer.runCwd(state),
    onUpdate: flush,
    label: runLabel,
    preludeLines,
  });
  state.runHandle = handle;

  handle.promise.then((result) => {
    if (state.runHandle === handle) state.runHandle = null;
    state.runningBlock = null;
    viewer.stopSpinner(state);
    flush({ ...result, running: false });
  });
};

viewer.scrollFollowOutput = (state, blockId) => {
  const updated = state.blocks.find((b) => b.id === blockId);
  if (!updated) return;
  let outputEnd = state.lines.length;
  for (const b of state.blocks) {
    if (b.startLine > updated.endLine) {
      outputEnd = b.startLine;
      break;
    }
  }
  const height = viewer.bodyHeight(state);
  const viewBottom = state.offset + height;
  if (outputEnd > viewBottom) {
    state.offset = Math.max(0, outputEnd - height);
    viewer.clampOffset(state);
  }
};

viewer.pickPrelude = (prelude, lang) => {
  if (!prelude || typeof prelude !== 'object') return '';
  const l = asText(lang).toLowerCase();
  if (prelude[l]) return prelude[l];
  if (['js', 'mjs', 'ts'].includes(l) && prelude.js) return prelude.js;
  return '';
};

viewer.handleSearchInput = (state, key) => {
  if (key.name === 'escape') {
    state.mode = 'view';
    state.dirty = true;
    return;
  }
  if (key.name === 'enter') {
    state.searchQuery = state.searchInput;
    state.mode = 'view';
    viewer.updateMatches(state);
    viewer.clampOffset(state);
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

viewer.jumpMatch = (state, dir) => {
  if (!state.matches.length) return;
  if (state.matchIndex < 0) {
    state.matchIndex = 0;
  } else {
    state.matchIndex =
      (state.matchIndex + dir + state.matches.length) % state.matches.length;
  }
  state.offset = Math.max(0, state.matches[state.matchIndex] - 2);
};

viewer.stickyOverlays = (state, contentW) => {
  const play = new Map();
  const copy = new Map();
  for (const block of state.blocks) {
    const kind = state.runningBlock === block.id ? 'stop' : 'play';
    const target = viewer.stickyPlayTarget(state, block, contentW, kind);
    if (target && target.sticky) play.set(target.lineIndex, target);
    const copyTarget = viewer.stickyCopyTarget(state, block, contentW);
    if (copyTarget && copyTarget.sticky) {
      copy.set(copyTarget.lineIndex, copyTarget);
    }
  }
  return { play, copy };
};

viewer.paintContentLine = (state, i, contentW, gutterW, overlays) => {
  let line = state.lines[i];
  if (!state.wrap && state.hOffset > 0) {
    line = sliceVisible(line, state.hOffset, contentW);
  } else if (visibleWidth(line) > contentW) {
    line = sliceVisible(line, 0, contentW);
  }
  if (viewer.isMatchLine(state, i)) {
    line = viewer.highlightMatch(line, state.searchQuery);
  }
  line = viewer.highlightSelection(line, i, state);

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
    const num = paint('muted', `${`${i + 1}`.padStart(gutterW)} `);
    line = num + line;
  }
  return line;
};

viewer.paintScreen = (state) => {
  const { cols, rows, innerCols, innerRows } = innerSize();

  if (state.mode === 'help') {
    const help = viewer.buildHelpInner(innerCols, innerRows);
    flushFrame(withMargins(help, cols, rows));
    state.dirty = false;
    return;
  }

  const height = viewer.bodyHeight(state);
  const inner = [];

  const start = state.offset;
  const end = Math.min(state.lines.length, start + height);
  const gutterW = state.showLines ? `${state.lines.length}`.length + 1 : 0;
  const contentW = Math.max(1, innerCols - (gutterW ? gutterW + 1 : 0));
  const overlays = viewer.stickyOverlays(state, contentW);

  for (let i = start; i < end; i++) {
    inner.push(viewer.paintContentLine(state, i, contentW, gutterW, overlays));
  }

  if (viewer.statusVisible(state)) {
    while (inner.length < innerRows - 1) inner.push('');
    if (inner.length > innerRows - 1) inner.length = innerRows - 1;
    inner.push(viewer.buildFooter(state, innerCols));
  } else if (inner.length > innerRows) {
    inner.length = innerRows;
  }

  flushFrame(withMargins(inner, cols, rows));
  state.dirty = false;
};

viewer.isMatchLine = (state, i) =>
  Boolean(state.searchQuery && state.matches.includes(i));

viewer.highlightMatch = (line, query) => {
  if (!query) return line;
  const plain = stripAnsi(line);
  if (plain.toLowerCase().indexOf(query.toLowerCase()) === -1) return line;
  return paint('match', plain);
};

viewer.buildFooter = (state, cols) => {
  if (state.mode === 'search') {
    return chrome.footer(`🔍 /${state.searchInput}█`);
  }
  const pos = `${state.offset + 1}-${Math.min(
    state.lines.length,
    state.offset + viewer.bodyHeight(state),
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

viewer.buildHelpInner = (innerCols, innerRows) => {
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
};

module.exports = { openViewer: viewer.openViewer };
