'use strict';

const { bandAnsi, BG, band, paint } = require('../theme.js');
const wrap = require('../wrap.js');
const { wrapLine, wrapCodeLine, visibleWidth } = wrap;
const { padEndVisible, sliceVisible, stripAnsi, asText } = wrap;
const { highlightLines } = require('./highlight.js');
const { isRunnable } = require('../run.js');

const PAD_X = 2;
const PAD_Y = 1;

const CODE_WRAP_LANGS = ['js', 'mjs', 'ts', 'css', 'html', 'json', 'bash'];

const LABELS = { play: ' ▶ ', stop: ' ■ ', close: ' ✕ ', copy: ' ⧉ ' };

const ICON_DIM = [58, 58, 64];
const ICON_HOT = {
  copy: [170, 175, 190],
  play: [80, 210, 120],
  stop: [230, 90, 90],
  close: [210, 210, 220],
  spin: [150, 160, 180],
};

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

const BARE_RUN_LOC_RE = /^(\S+ line:\d+)\s*$/;

const isHot = (hover, id, kinds) => {
  if (!hover) return false;
  if (hover.blockId !== id) return false;
  return kinds.includes(hover.kind);
};

const paintIcon = (label, bgCode, kind, hot = false) => {
  const rgb = hot ? ICON_HOT[kind] || ICON_HOT.copy : ICON_DIM;
  const bold = hot ? '\x1b[1m' : '';
  const fg = `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
  return `\x1b[${bgCode}m${fg}${bold}${label}\x1b[0m`;
};

const iconPadRow = (padTo, label, kind, hot, bg) => {
  const btnW = visibleWidth(label);
  const leftW = Math.max(0, padTo - btnW);
  const leftPad = bandAnsi(' '.repeat(leftW), bg, 0);
  const icon = paintIcon(label, bg, kind, hot);
  const row = leftPad + icon;
  const line = bandAnsi(row, bg, padTo);
  return { line, col0: leftW, col1: padTo };
};

const frameCodeBlock = (lang, source, options = {}) => {
  const width = options.width ?? 80;
  const setup = options.setup ?? false;
  const control = options.control ?? 'play';
  const hotCopy = options.hotCopy ?? false;
  const hotPlay = options.hotPlay ?? false;
  const padTo = width > 0 ? width : 0;
  const highlightLang = lang;
  const colored = highlightLines(highlightLang, source);
  const bodyWidth = padTo > 0 ? Math.max(8, padTo - PAD_X * 2) : 10000;
  const runnable = !setup && isRunnable(lang);
  const lines = [];
  let play = null;
  let copy = null;
  const kind = control === 'stop' ? 'stop' : 'play';
  const playLabel = LABELS[kind];
  // Code-like langs: hanging indent on wrap. Plain/logs/dot: flush.
  let langKey = asText(lang).toLowerCase();
  if (langKey === 'dts') langKey = 'ts';
  const wrapFn = CODE_WRAP_LANGS.includes(langKey) ? wrapCodeLine : wrapLine;

  for (let y = 0; y < PAD_Y; y++) {
    if (y === 0 && padTo > 0) {
      const row = iconPadRow(padTo, LABELS.copy, 'copy', hotCopy, BG.code);
      lines.push(row.line);
      copy = { row: 0, col0: row.col0, col1: row.col1 };
    } else {
      lines.push(bandAnsi('', BG.code, padTo));
    }
  }

  const left = ' '.repeat(PAD_X);
  if (colored.length === 0) {
    lines.push(bandAnsi(left, BG.code, padTo));
  } else {
    for (const line of colored) {
      const wrapped = wrapFn(line, bodyWidth);
      for (const part of wrapped) {
        lines.push(bandAnsi(left + part, BG.code, padTo));
      }
    }
  }

  for (let y = 0; y < PAD_Y; y++) {
    if (y === PAD_Y - 1 && padTo > 0 && runnable) {
      const row = iconPadRow(padTo, playLabel, kind, hotPlay, BG.code);
      lines.push(row.line);
      play = { row: lines.length - 1, col0: row.col0, col1: row.col1, kind };
    } else {
      lines.push(bandAnsi('', BG.code, padTo));
    }
  }

  source = asText(source);
  return { lines, play, copy, runnable, setup, lang, source };
};

const overlayControlButton = (line, width, kind = 'play', hot = false) => {
  if (!width || width <= 0) return line;
  const label = LABELS[kind] || LABELS.play;
  const btnW = visibleWidth(label);
  const leftW = Math.max(0, width - btnW);
  const left = sliceVisible(padEndVisible(asText(line), width), 0, leftW);
  return bandAnsi(left + paintIcon(label, BG.code, kind, hot), BG.code, width);
};

const overlayPlayButton = (line, width, hot = false) =>
  overlayControlButton(line, width, 'play', hot);

const overlayCopyButton = (line, width, hot = false) => {
  if (!width || width <= 0) return line;
  const btnW = visibleWidth(LABELS.copy);
  const leftW = Math.max(0, width - btnW);
  const left = sliceVisible(padEndVisible(asText(line), width), 0, leftW);
  const icon = paintIcon(LABELS.copy, BG.code, 'copy', hot);
  const row = left + icon;
  return bandAnsi(row, BG.code, width);
};

const playHitCols = (width, kind = 'play') => {
  const label = LABELS[kind] || LABELS.play;
  const btnW = visibleWidth(label);
  const col0 = Math.max(0, (width || 0) - btnW);
  return { col0, col1: width || btnW };
};

const copyHitCols = (width) => {
  const btnW = visibleWidth(LABELS.copy);
  const col0 = Math.max(0, (width || 0) - btnW);
  return { col0, col1: width || btnW };
};

const spinnerFrame = (tick = 0) => SPINNER[Math.abs(tick) % SPINNER.length];

const runBodyLines = (result) => {
  let raw;
  if (result.shown !== undefined && result.shown !== null) {
    raw = asText(result.shown);
  } else if (result.text !== undefined && result.text !== null) {
    raw = asText(result.text);
  } else {
    raw = [result.stdout, result.stderr].filter(Boolean).join('\n');
  }
  // Drop legacy status lines if present; status lives in the exit chip only.
  const text = raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/(?:^|\n)Interrupted\s*$/m, '')
    .replace(/(?:^|\n)Timed out after \d+ms\s*$/m, '');
  const running = !!result.running;
  const body = text ? text.split('\n') : [''];
  // Avoid a trailing empty line from a final \n so the chip sits at the cursor.
  if (!running && body.length > 1 && body[body.length - 1] === '') {
    body.pop();
  }
  if (body.length === 0) body.push('');
  return body;
};

const paintRunLocChip = (loc) => {
  const open = '\x1b[48;2;52;52;60m\x1b[38;2;235;235;240m\x1b[1m';
  return `${open} ${loc} \x1b[0m`;
};

/** Highlight only bare loc headers — not `at … line:6:17` stack frames. */
const highlightRunLocs = (line, style = 'plain') => {
  const text = asText(line);
  const m = text.match(BARE_RUN_LOC_RE);
  if (!m) return paint(style, text);
  return paintRunLocChip(m[1]);
};

const isErrorBodyLine = (line) => {
  const s = asText(line);
  return /^(?:[A-Za-z]+)?(?:Error|Exception)\b/.test(s) || /^\s+at\s/.test(s);
};

const paintErrorText = (text) => `\x1b[38;2;230;90;90m${text}\x1b[0m`;

const paintExitStatus = (result) => {
  const code = result.code;
  let label = `exit ${code}`;
  if (result.timedOut) label = `Timed out exit ${code}`;
  else if (result.interrupted) label = `Interrupted exit ${code}`;
  const timed = result.interrupted || result.timedOut;
  const ok = !!result.ok && !timed && code === 0;
  if (ok) {
    return `\x1b[48;2;20;140;55m\x1b[38;2;240;255;240m\x1b[1m ${label} \x1b[0m`;
  }
  return `\x1b[48;2;170;40;40m\x1b[38;2;255;235;235m\x1b[1m ${label} \x1b[0m`;
};

/** Left-padded status row: chip keeps its own bg; the rest uses panel bg. */
const frameStatusLine = (badge, bgCode, width) => {
  const open = `\x1b[${bgCode}m`;
  const padL = ' '.repeat(PAD_X);
  const chipW = visibleWidth(stripAnsi(badge));
  const padR = Math.max(0, (width || 0) - PAD_X - chipW);
  return `${open}${padL}\x1b[0m${badge}${open}${' '.repeat(padR)}\x1b[0m`;
};

const paintCursor = (ch, bg) => {
  const open = `\x1b[${bg}m\x1b[38;2;220;220;230m\x1b[1m`;
  return `${open}${ch}\x1b[0m`;
};

const pushRunBody = (out, body, opts) => {
  const { padTo, bodyWidth, bg, cursor } = opts;
  for (let li = 0; li < body.length; li++) {
    const isLast = li === body.length - 1;
    const line = body[li];
    const painted = isErrorBodyLine(line)
      ? paintErrorText(line)
      : highlightRunLocs(line, 'plain');
    const rows = padTo > 0 ? wrapLine(painted, bodyWidth) : [painted];

    for (let ri = 0; ri < rows.length; ri++) {
      let row = rows[ri];
      const lastRow = isLast && ri === rows.length - 1;
      if (lastRow && cursor) {
        if (padTo > 0 && visibleWidth(row) + 1 > bodyWidth) {
          out.push(bandAnsi(' '.repeat(PAD_X) + row, bg, padTo));
          row = cursor;
        } else {
          row += cursor;
        }
      }
      out.push(bandAnsi(' '.repeat(PAD_X) + row, bg, padTo));
    }
  }
};

const frameRunOutput = (result, options = {}) => {
  const width = options.width ?? 80;
  const tick = options.tick ?? 0;
  const hotClose = options.hotClose ?? false;
  const padTo = width > 0 ? width : 0;
  const running = !!result.running;
  const bg = '48;2;10;10;12';
  const out = [];
  let close = null;

  const spinLabel = ` ${spinnerFrame(tick)} `;
  const closeLabel = running ? spinLabel : LABELS.close;
  const closeKind = running ? 'spin' : 'close';
  if (padTo > 0) {
    const row = iconPadRow(padTo, closeLabel, closeKind, hotClose, bg);
    out.push(row.line);
    close = { row: 0, col0: row.col0, col1: row.col1 };
  } else {
    const painted = paintIcon(closeLabel, bg, closeKind, hotClose);
    out.push(bandAnsi(painted, bg, 0));
  }

  const body = runBodyLines(result);
  const bodyWidth = padTo > 0 ? Math.max(8, padTo - PAD_X * 2) : 10000;
  const cursorOn = running && Math.floor(tick / 12) % 2 === 0;
  const cursor = running && cursorOn ? paintCursor('█', bg) : '';
  const hasExit = !running && result.code !== undefined && result.code !== null;
  const exitBadge = hasExit ? paintExitStatus(result) : '';
  pushRunBody(out, body, { padTo, bodyWidth, bg, cursor });

  // Status on its own line; chip bg must not bleed to EOL via bandAnsi.
  if (exitBadge) {
    out.push(frameStatusLine(exitBadge, bg, padTo));
  }

  out.push(bandAnsi('', bg, padTo));
  return { lines: out, close };
};

const frameQuoteBlock = (texts, options = {}) => {
  const width = options.width ?? 80;
  const padTo = width > 0 ? width : 0;
  const prefix = '│ ';
  const prefixW = 2;
  const inner = padTo - PAD_X * 2 - prefixW;
  const bodyWidth = padTo > 0 ? Math.max(8, inner) : 10000;
  const out = [];

  for (let y = 0; y < PAD_Y; y++) {
    out.push(band('quote', ' ', padTo));
  }

  for (const text of texts) {
    // Wrap text only; repeat │ on every visual row (soft-wrap continuations).
    const rows = padTo > 0 ? wrapLine(asText(text), bodyWidth) : [asText(text)];
    for (const row of rows) {
      out.push(band('quote', ' '.repeat(PAD_X) + prefix + row, padTo));
    }
  }

  if (texts.length === 0) {
    out.push(band('quote', ' '.repeat(PAD_X) + prefix, padTo));
  }

  for (let y = 0; y < PAD_Y; y++) {
    out.push(band('quote', ' ', padTo));
  }

  return out;
};

module.exports = {
  PAD_X,
  PAD_Y,
  LABELS,
  SPINNER,
  isHot,
  frameCodeBlock,
  frameQuoteBlock,
  frameRunOutput,
  overlayPlayButton,
  overlayControlButton,
  overlayCopyButton,
  playHitCols,
  copyHitCols,
  spinnerFrame,
};
