'use strict';

const { visibleWidth, padEndVisible, sliceVisible } = require('./wrap.js');
const { screenLine } = require('./theme.js');

const MARGIN_Y_TOP = 1;
/**
 * Bottom gap: leave the last terminal row unused (do not paint a second
 * empty frame row — that showed up as a double margin).
 */
const MARGIN_Y_BOTTOM = 1;
const MARGIN_X = 2;

/** @deprecated use MARGIN_Y_TOP; kept for callers */
const MARGIN_Y = MARGIN_Y_TOP;

const CLEAR_EOL = '\x1b[K';
const SYNC_START = '\x1b[?2026h';
const SYNC_END = '\x1b[?2026l';
const WRAP_OFF = '\x1b[?7l';
const WRAP_ON = '\x1b[?7h';

const termSize = () => ({
  cols: process.stdout.columns || 80,
  rows: process.stdout.rows || 24,
});

const innerSize = () => {
  const { cols, rows } = termSize();
  const marginY = MARGIN_Y_TOP + MARGIN_Y_BOTTOM;
  const innerCols = Math.max(1, cols - MARGIN_X * 2);
  const innerRows = Math.max(1, rows - marginY);
  return { cols, rows, innerCols, innerRows };
};

const frameLine = (line, cols) => {
  const inner = Math.max(1, cols - MARGIN_X * 2);
  const overflow = visibleWidth(line) > inner;
  const clipped = overflow ? sliceVisible(line, 0, inner) : line;
  const padded = padEndVisible(clipped, inner);
  const full = ' '.repeat(MARGIN_X) + padded + ' '.repeat(MARGIN_X);
  return screenLine(full, cols) + CLEAR_EOL;
};

const emptyLine = (cols) => screenLine('', cols) + CLEAR_EOL;

/**
 * Top: one painted empty row.
 * Bottom: do not paint the last terminal row — it stays blank (1 gap).
 * Painting an explicit bottom empty row stacked with that gap → 2 lines.
 */
const withMargins = (innerRows, cols, rows) => {
  const painted = Math.max(1, rows - MARGIN_Y_BOTTOM);
  const frame = [emptyLine(cols)];
  const budget = Math.max(0, painted - MARGIN_Y_TOP);
  const lines = innerRows.slice(0, budget);
  for (const row of lines) frame.push(frameLine(row, cols));
  while (frame.length < painted) frame.push(frameLine('', cols));
  if (frame.length > painted) frame.length = painted;
  return frame;
};

/**
 * Paint frame with wrap disabled; absolute CUP per row (no \n scroll).
 */
const flushFrame = (lines) => {
  const parts = [SYNC_START, WRAP_OFF];
  for (let i = 0; i < lines.length; i++) {
    parts.push(`\x1b[${i + 1};1H`, lines[i]);
  }
  // Clear the reserved bottom margin row so it stays solid black.
  const { cols, rows } = termSize();
  if (MARGIN_Y_BOTTOM > 0 && rows > lines.length) {
    parts.push(`\x1b[${rows};1H`, emptyLine(cols));
  }
  parts.push(WRAP_ON, SYNC_END);
  process.stdout.write(parts.join(''));
};

module.exports = {
  MARGIN_X,
  MARGIN_Y,
  MARGIN_Y_TOP,
  MARGIN_Y_BOTTOM,
  CLEAR_EOL,
  termSize,
  innerSize,
  frameLine,
  emptyLine,
  withMargins,
  flushFrame,
};
