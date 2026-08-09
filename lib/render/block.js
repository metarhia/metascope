'use strict';

const { bandAnsi, BG, band, paint } = require('../theme');
const {
  wrapLine,
  wrapCodeLine,
  visibleWidth,
  padEndVisible,
  sliceVisible,
  stripAnsi,
} = require('../wrap');
const { highlightLines } = require('./highlight');
const { isRunnable } = require('../run');

/** Inner padding inside code/quote blocks (cells). */
const PAD_X = 2;
const PAD_Y = 1;

const CODE_WRAP_LANGS = new Set([
  'js',
  'mjs',
  'ts',
  'dts',
  'css',
  'html',
  'json',
  'bash',
]);

/** Controls on code blocks. */
const PLAY_LABEL = ' ▶ ';
const STOP_LABEL = ' ■ ';
const CLOSE_LABEL = ' ✕ ';
const COPY_LABEL = ' ⧉ ';

/** Dim by default; bright + colored on hover. */
const ICON_DIM = [58, 58, 64];
const ICON_HOT = {
  copy: [170, 175, 190],
  play: [80, 210, 120],
  stop: [230, 90, 90],
  close: [210, 210, 220],
  spin: [150, 160, 180],
};

/** Braille spinner frames for the output header while running. */
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Code block: soft bg, ⧉ copy top-right, ▶ / ■ bottom-right if runnable.
 * Returns { lines, play, copy, runnable, setup }.
 */
const frameCodeBlock = (
  lang,
  source,
  {
    width = 80,
    setup = false,
    control = 'play',
    hotCopy = false,
    hotPlay = false,
  } = {},
) => {
  const padTo = width > 0 ? width : 0;
  const highlightLang = lang;
  const colored = highlightLines(highlightLang, source);
  const bodyWidth = padTo > 0 ? Math.max(8, padTo - PAD_X * 2) : 10000;
  const runnable = !setup && isRunnable(lang);
  const out = [];
  let play = null;
  let copy = null;
  const kind = control === 'stop' ? 'stop' : 'play';
  const playLabel = kind === 'stop' ? STOP_LABEL : PLAY_LABEL;
  // Code-like langs: hanging indent on wrap. Plain/logs/dot: flush wrap
  // (no +2).
  const wrapFn = CODE_WRAP_LANGS.has(String(lang || '').toLowerCase())
    ? wrapCodeLine
    : wrapLine;

  for (let y = 0; y < PAD_Y; y++) {
    if (y === 0 && padTo > 0) {
      const btnW = visibleWidth(COPY_LABEL);
      const leftW = Math.max(0, padTo - btnW);
      const row =
        bandAnsi(' '.repeat(leftW), BG.code, 0) +
        paintIcon(COPY_LABEL, BG.code, 'copy', hotCopy);
      out.push(bandAnsi(row, BG.code, padTo));
      copy = { row: 0, col0: leftW, col1: padTo };
    } else {
      out.push(bandAnsi('', BG.code, padTo));
    }
  }

  if (colored.length === 0) {
    out.push(bandAnsi(' '.repeat(PAD_X), BG.code, padTo));
  } else {
    for (const line of colored) {
      const wrapped = wrapFn(line, bodyWidth);
      for (const part of wrapped) {
        out.push(bandAnsi(' '.repeat(PAD_X) + part, BG.code, padTo));
      }
    }
  }

  for (let y = 0; y < PAD_Y; y++) {
    if (y === PAD_Y - 1 && padTo > 0 && runnable) {
      const btnW = visibleWidth(playLabel);
      const leftW = Math.max(0, padTo - btnW);
      const row =
        bandAnsi(' '.repeat(leftW), BG.code, 0) +
        paintIcon(playLabel, BG.code, kind, hotPlay);
      out.push(bandAnsi(row, BG.code, padTo));
      play = { row: out.length - 1, col0: leftW, col1: padTo, kind };
    } else {
      out.push(bandAnsi('', BG.code, padTo));
    }
  }

  return {
    lines: out,
    play,
    copy,
    runnable,
    setup,
    lang,
    source: String(source || ''),
  };
};

function paintIcon(label, bgCode, kind, hot = false) {
  const rgb = hot ? ICON_HOT[kind] || ICON_HOT.copy : ICON_DIM;
  const bold = hot ? '\x1b[1m' : '';
  return (
    `\x1b[${bgCode}m\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m` +
    `${bold}${label}\x1b[0m`
  );
}

/** Pin ▶/■ sticky when block bottom is off-screen. */
const overlayControlButton = (line, width, kind = 'play', hot = false) => {
  if (!width || width <= 0) return line;
  const label = kind === 'stop' ? STOP_LABEL : PLAY_LABEL;
  const btnW = visibleWidth(label);
  const leftW = Math.max(0, width - btnW);
  const left = sliceVisible(padEndVisible(String(line || ''), width), 0, leftW);
  return bandAnsi(left + paintIcon(label, BG.code, kind, hot), BG.code, width);
};

/** Pin ⧉ sticky when block top is off-screen. */
const overlayCopyButton = (line, width, hot = false) => {
  if (!width || width <= 0) return line;
  const btnW = visibleWidth(COPY_LABEL);
  const leftW = Math.max(0, width - btnW);
  const left = sliceVisible(padEndVisible(String(line || ''), width), 0, leftW);
  return bandAnsi(
    left + paintIcon(COPY_LABEL, BG.code, 'copy', hot),
    BG.code,
    width,
  );
};

const playHitCols = (width, kind = 'play') => {
  const label = kind === 'stop' ? STOP_LABEL : PLAY_LABEL;
  const btnW = visibleWidth(label);
  const col0 = Math.max(0, (width || 0) - btnW);
  return { col0, col1: width || btnW };
};

const copyHitCols = (width) => {
  const btnW = visibleWidth(COPY_LABEL);
  const col0 = Math.max(0, (width || 0) - btnW);
  return { col0, col1: width || btnW };
};

const spinnerFrame = (tick = 0) => SPINNER[Math.abs(tick) % SPINNER.length];

/**
 * Output panel under a code block.
 * Returns { lines, close }.
 */
const frameRunOutput = (
  result,
  { width = 80, tick = 0, hotClose = false } = {},
) => {
  const padTo = width > 0 ? width : 0;
  const running = !!result.running;
  // Output panel: near-black, slightly above pure screen black.
  const bg = '48;2;10;10;12';
  const out = [];
  let close = null;

  const spinLabel = ` ${spinnerFrame(tick)} `;
  const cornerPainted = running
    ? paintIcon(spinLabel, bg, 'spin', hotClose)
    : paintIcon(CLOSE_LABEL, bg, 'close', hotClose);
  const cornerW = visibleWidth(running ? spinLabel : CLOSE_LABEL);

  if (padTo > 0) {
    const leftW = Math.max(0, padTo - cornerW);
    const left = padEndVisible('', leftW);
    const row = bandAnsi(left, bg, 0) + cornerPainted;
    out.push(bandAnsi(row, bg, padTo));
    close = { row: 0, col0: leftW, col1: padTo };
  } else {
    out.push(bandAnsi(cornerPainted, bg, 0));
  }

  let raw;
  if (result.shown !== null && result.shown !== undefined) {
    raw = String(result.shown);
  } else if (result.text !== null && result.text !== undefined) {
    raw = String(result.text);
  } else {
    raw = [result.stdout, result.stderr].filter(Boolean).join('\n');
  }
  // Drop legacy status lines if present; status lives in the exit chip only.
  const text = raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/(?:^|\n)Interrupted\s*$/m, '')
    .replace(/(?:^|\n)Timed out after \d+ms\s*$/m, '');
  const body = text ? text.split('\n') : [''];
  // Avoid a trailing empty line from a final \n so the chip sits at the cursor.
  if (!running && body.length > 1 && body[body.length - 1] === '') {
    body.pop();
  }
  if (body.length === 0) body.push('');

  const style = 'plain';
  const bodyWidth = padTo > 0 ? Math.max(8, padTo - PAD_X * 2) : 10000;
  const cursorOn = running && Math.floor(tick / 12) % 2 === 0;
  const cursor = running && cursorOn ? paintCursor('█', bg) : '';
  const exitBadge =
    !running && result.code !== null && result.code !== undefined
      ? paintExitStatus(result)
      : '';

  for (let li = 0; li < body.length; li++) {
    const isLast = li === body.length - 1;
    const line = body[li];
    const painted = isErrorBodyLine(line)
      ? paintErrorText(line)
      : highlightRunLocs(line, style);
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

  // Status on its own line; chip bg must not bleed to EOL via bandAnsi.
  if (exitBadge) {
    out.push(frameStatusLine(exitBadge, bg, padTo));
  }

  out.push(bandAnsi('', bg, padTo));
  return { lines: out, close };
};

/**
 * Status chip only (not the whole line): `exit 0`, `Interrupted exit 1`, …
 * Success → green; failure / interrupt / timeout → red.
 */
function paintExitStatus(result) {
  const code = result.code;
  let label = `exit ${code}`;
  if (result.timedOut) label = `Timed out exit ${code}`;
  else if (result.interrupted) label = `Interrupted exit ${code}`;

  const ok =
    !!result.ok && !result.interrupted && !result.timedOut && code === 0;
  if (ok) {
    return `\x1b[48;2;20;140;55m\x1b[38;2;240;255;240m\x1b[1m ${label} \x1b[0m`;
  }
  return `\x1b[48;2;170;40;40m\x1b[38;2;255;235;235m\x1b[1m ${label} \x1b[0m`;
}

/** Soft gray chip on bare loc header: ` Example line:6 ` (line start). */
const BARE_RUN_LOC_RE = /^(\S+ line:\d+)\s*$/;

const paintRunLocChip = (loc) =>
  `\x1b[48;2;52;52;60m\x1b[38;2;235;235;240m\x1b[1m ${loc} \x1b[0m`;

/** Highlight only bare loc headers — not `at … line:6:17` stack frames. */
function highlightRunLocs(line, style = 'plain') {
  const text = String(line || '');
  const m = text.match(BARE_RUN_LOC_RE);
  if (!m) return paint(style, text);
  // Chip at line start only; bandAnsi pad keeps panel bg for the rest.
  return paintRunLocChip(m[1]);
}

/** `ReferenceError: …` and indented `at …` stack frames. */
function isErrorBodyLine(line) {
  const s = String(line || '');
  return /^(?:[A-Za-z]+)?(?:Error|Exception)\b/.test(s) || /^\s+at\s/.test(s);
}

function paintErrorText(text) {
  return `\x1b[38;2;230;90;90m${text}\x1b[0m`;
}

/** Left-padded status row: chip keeps its own bg; the rest uses panel bg. */
function frameStatusLine(badge, bgCode, width) {
  const open = `\x1b[${bgCode}m`;
  const padL = ' '.repeat(PAD_X);
  const chipW = visibleWidth(stripAnsi(badge));
  const padR = Math.max(0, (width || 0) - PAD_X - chipW);
  return `${open}${padL}\x1b[0m${badge}${open}${' '.repeat(padR)}\x1b[0m`;
}

function paintCursor(ch, bg) {
  const open = `\x1b[${bg}m\x1b[38;2;220;220;230m\x1b[1m`;
  return `${open}${ch}\x1b[0m`;
}

const frameQuoteBlock = (texts, { width = 80 } = {}) => {
  const padTo = width > 0 ? width : 0;
  const prefix = '│ ';
  const prefixW = 2;
  const bodyWidth =
    padTo > 0 ? Math.max(8, padTo - PAD_X * 2 - prefixW) : 10000;
  const out = [];

  for (let y = 0; y < PAD_Y; y++) {
    out.push(band('quote', ' ', padTo));
  }

  for (const text of texts) {
    // Wrap text only; repeat │ on every visual row (soft-wrap continuations).
    const rows = padTo > 0 ? wrapLine(String(text), bodyWidth) : [String(text)];
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
  frameCodeBlock,
  frameQuoteBlock,
  frameRunOutput,
  overlayPlayButton: (line, width, hot = false) =>
    overlayControlButton(line, width, 'play', hot),
  overlayControlButton,
  overlayCopyButton,
  playHitCols,
  copyHitCols,
  spinnerFrame,
  PAD_X,
  PAD_Y,
  PLAY_LABEL,
  STOP_LABEL,
  CLOSE_LABEL,
  COPY_LABEL,
  SPINNER,
};
