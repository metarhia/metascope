'use strict';

const { paint, bandAnsi, BG } = require('../theme.js');
const { visibleWidth, sliceVisible } = require('../wrap.js');
const { PAD_X, PAD_Y } = require('./block.js');

const TABLE_BG = {
  head: BG.h2,
  row: BG.code,
  rowAlt: '48;2;26;26;32',
  rule: BG.codeHead,
};

/** Cell chrome: 1 outside bg + 1 inside bg on each side → +4 to text width. */
const CELL_PAD = 4;

const splitRawCells = (line) => {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  let inCode = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '`') {
      inCode = !inCode;
      cur += ch;
      continue;
    }
    if (ch === '|' && !inCode) {
      cells.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
};

const isTableSepLine = (line) => {
  if (!line.includes('|')) return false;
  const cells = splitRawCells(line);
  if (cells.length < 1) return false;
  return cells.every((c) => /^:?-{1,}:?$/.test(c.replace(/\s/g, '')));
};

const looksLikeTableRow = (line) => {
  const t = line.trim();
  if (!t.includes('|')) return false;
  if (/^[-*+] /.test(t) || /^\d+[.)] /.test(t)) return false;
  return splitRawCells(t).length >= 1;
};

const parseAlign = (cell) => {
  const t = cell.replace(/\s/g, '');
  const left = t.startsWith(':');
  const right = t.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  return 'left';
};

const parseAligns = (sepLine) => {
  const cells = splitRawCells(sepLine);
  return cells.map(parseAlign);
};

const padCell = (text, width, align) => {
  const n = visibleWidth(text);
  if (n > width) return sliceVisible(text, 0, width);
  const gap = width - n;
  if (align === 'right') return ' '.repeat(gap) + text;
  if (align === 'center') {
    const L = Math.floor(gap / 2);
    return ' '.repeat(L) + text + ' '.repeat(gap - L);
  }
  return text + ' '.repeat(gap);
};

const ruleLine = (widths, left, mid, right, fill = '─') => {
  let s = left;
  for (let i = 0; i < widths.length; i++) {
    s += fill.repeat(widths[i] + CELL_PAD);
    s += i < widths.length - 1 ? mid : right;
  }
  return s;
};

/** Body: 1 space from │; same width as header (content +2 vs head). */
const buildDataRow = (cells, widths, align, indent) => {
  let row = indent + paint('tableRule', '│');
  for (let c = 0; c < widths.length; c++) {
    const text = padCell(cells[c] || '', widths[c] + 2, align[c] || 'left');
    row += ` ${text} ${paint('tableRule', '│')}`;
  }
  return row;
};

/**
 * Header: bg only inside cells.
 * │[ ][bg][ ]TEXT…[ ][/bg][ ]│
 */
const buildHeaderRow = (cells, widths, align, indent) => {
  let row = indent + paint('tableRule', '│');
  for (let c = 0; c < widths.length; c++) {
    const text = padCell(cells[c] || '', widths[c], align[c] || 'left');
    const inner = ` ${text} `;
    const cellBg = bandAnsi(inner, TABLE_BG.head, 0);
    const bar = paint('tableRule', '│');
    row += ` ${cellBg} ${bar}`;
  }
  return row;
};

const frameTable = (headerCells, aligns, bodyRows, options = {}) => {
  const width = options.width ?? 80;
  const padTo = width > 0 ? width : 0;
  const cols = headerCells.length;
  let align = aligns.slice(0, cols);
  if (aligns.length < cols) {
    const missing = cols - aligns.length;
    const pad = Array(missing).fill('left');
    align = [...aligns, ...pad];
  }

  const widths = Array(cols).fill(3);
  for (let c = 0; c < cols; c++) {
    widths[c] = Math.max(widths[c], visibleWidth(headerCells[c]));
    for (const row of bodyRows) {
      widths[c] = Math.max(widths[c], visibleWidth(row[c] || ''));
    }
  }

  // │ + per cell (w + CELL_PAD + │) → 1 + sum(w) + (CELL_PAD+1)*cols
  const borderOverhead = 1 + (CELL_PAD + 1) * cols;
  const natural = widths.reduce((a, b) => a + b, 0);
  const innerAvail = padTo - PAD_X * 2 - borderOverhead;
  const avail = padTo > 0 ? Math.max(cols * 3, innerAvail) : natural;

  const total = widths.reduce((a, b) => a + b, 0);
  if (padTo > 0 && total > avail) {
    const scale = avail / total;
    let used = 0;
    for (let c = 0; c < cols - 1; c++) {
      widths[c] = Math.max(3, Math.floor(widths[c] * scale));
      used += widths[c];
    }
    widths[cols - 1] = Math.max(3, avail - used);
  }

  const out = [];
  const indent = ' '.repeat(PAD_X);
  const paintRule = (s) =>
    bandAnsi(paint('tableRule', s), TABLE_BG.rule, padTo);
  const rowBg = (alt) => (alt ? TABLE_BG.rowAlt : TABLE_BG.row);
  const paintRow = (s, alt) => bandAnsi(s, rowBg(alt), padTo);

  for (let y = 0; y < PAD_Y; y++) {
    out.push(bandAnsi('', TABLE_BG.row, padTo));
  }

  out.push(paintRule(indent + ruleLine(widths, '┌', '┬', '┐')));
  const head = buildHeaderRow(headerCells, widths, align, indent);
  out.push(paintRow(head, false));
  out.push(paintRule(indent + ruleLine(widths, '├', '┼', '┤')));

  bodyRows.forEach((cells, ri) => {
    const data = buildDataRow(cells, widths, align, indent);
    out.push(paintRow(data, ri % 2 === 1));
  });

  out.push(paintRule(indent + ruleLine(widths, '└', '┴', '┘')));

  for (let y = 0; y < PAD_Y; y++) {
    out.push(bandAnsi('', TABLE_BG.row, padTo));
  }

  return out;
};

const startsTable = (lines, i) => {
  if (i + 1 >= lines.length) return false;
  if (!looksLikeTableRow(lines[i])) return false;
  return isTableSepLine(lines[i + 1]);
};

const consumeTable = (lines, i, inline, width) => {
  if (!startsTable(lines, i)) return null;

  const rawHeader = splitRawCells(lines[i]);
  const paintHead = (c) => {
    if (/[`*_[]/.test(c)) return inline(c);
    return paint('tableHead', c);
  };
  const header = rawHeader.map(paintHead);
  const aligns = parseAligns(lines[i + 1]);
  const cols = header.length;
  const body = [];
  let j = i + 2;
  while (j < lines.length) {
    if (!looksLikeTableRow(lines[j])) break;
    if (isTableSepLine(lines[j])) break;
    const cells = splitRawCells(lines[j]);
    while (cells.length < cols) cells.push('');
    const row = cells.slice(0, cols).map((c) => inline(c));
    body.push(row);
    j++;
  }

  const framed = frameTable(header, aligns, body, { width });
  return { next: j, lines: framed };
};

module.exports = {
  isTableSepLine,
  looksLikeTableRow,
  startsTable,
  frameTable,
  consumeTable,
};
