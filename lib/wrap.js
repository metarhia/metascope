'use strict';

const { charWidth } = require('./width.js');

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const OSC8_CLOSE = `${ESC}]8;;${BEL}`;

const BREAK_AFTER = ',;{([=?:+-*/%&|^<>!';

/** Prefer break after these chars (checked before generic BREAK_AFTER). */
const EARLY_PREV_SCORE = {
  ',': 100,
  ';': 100,
  ' ': 70,
};

/** Open brackets before an identifier (after BREAK_AFTER non-ident path). */
const OPEN_PREV_SCORE = {
  '(': 40,
  '{': 40,
  '[': 40,
};

const CUR_BREAK_SCORE = {
  ')': 15,
  ']': 15,
  '}': 15,
};

/** `).` / `].` method chains */
const DOT_AFTER_SCORE = {
  ')': 95,
  ']': 95,
};

const asText = (value) => {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return `${value}`;
};

const skipAnsi = (s, i) => {
  if (s[i] !== ESC || i + 1 >= s.length) return i;
  const kind = s[i + 1];
  if (kind === '[') {
    let j = i + 2;
    while (j < s.length && s[j] !== 'm') j++;
    if (s[j] === 'm') return j + 1;
    return i;
  }
  if (kind === ']') {
    let j = i + 2;
    while (j < s.length) {
      if (s[j] === BEL) return j + 1;
      if (s[j] === ESC && s[j + 1] === '\\') return j + 2;
      j++;
    }
    return s.length;
  }
  return i;
};

const osc8Href = (seq) => {
  const prefix = `${ESC}]8;`;
  if (!seq.startsWith(prefix)) return null;
  let body = seq.slice(prefix.length);
  if (body.endsWith(BEL)) body = body.slice(0, -1);
  else if (body.endsWith(`${ESC}\\`)) body = body.slice(0, -2);
  const sep = body.indexOf(';');
  if (sep < 0) return '';
  return body.slice(sep + 1);
};

const osc8Open = (href) => `${ESC}]8;;${href}${BEL}`;

const osc8Link = (href, label) => osc8Open(href) + label + OSC8_CLOSE;

const stripAnsi = (s) => {
  const text = asText(s);
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === ESC) {
      const end = skipAnsi(text, i);
      if (end > i) {
        i = end;
        continue;
      }
    }
    out += text[i];
    i++;
  }
  return out;
};

/** Terminal cells, not code points: wide CJK/emoji = 2, marks/VS16 = 0. */
const visibleWidth = (s) => {
  let width = 0;
  for (const ch of stripAnsi(s)) width += charWidth(ch.codePointAt(0));
  return width;
};

const charsWidth = (chars) => {
  let width = 0;
  for (const item of chars) width += item.w;
  return width;
};

const splitAnsiChars = (s) => {
  const chars = [];
  let i = 0;
  let open = '';
  let href = '';
  while (i < s.length) {
    if (s[i] === ESC) {
      const end = skipAnsi(s, i);
      if (end > i) {
        const seq = s.slice(i, end);
        if (s[i + 1] === '[' && seq.endsWith('m')) {
          // Accumulate stacked SGR (e.g. bg then fg for inline code).
          // Replacing with only the last seq dropped backgrounds on wrap.
          if (seq === `${ESC}[0m`) open = '';
          else open += seq;
        } else {
          const next = osc8Href(seq);
          if (next !== null) href = next;
        }
        i = end;
        continue;
      }
    }
    const cp = s.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    i += ch.length;
    const w = charWidth(cp);
    // Zero-width marks (VS16, ZWJ, combining) stay glued to their base cell.
    const prev = chars[chars.length - 1];
    if (w === 0 && prev) prev.ch += ch;
    else chars.push({ ch, style: open, href, w });
  }
  return chars;
};

const joinStyled = (chars) => {
  if (chars.length === 0) return '';
  let out = '';
  let cur = null;
  let curHref = '';
  for (const item of chars) {
    const style = item.style;
    const href = item.href || '';
    if (style !== cur) {
      if (cur) out += '\x1b[0m';
      if (style) out += style;
      cur = style;
    }
    if (href !== curHref) {
      if (curHref) out += OSC8_CLOSE;
      if (href) out += osc8Open(href);
      curHref = href;
    }
    out += item.ch;
  }
  if (curHref) out += OSC8_CLOSE;
  if (cur) out += '\x1b[0m';
  return out;
};

const hrefAtCol = (line, col) => {
  if (col < 0) return null;
  let at = 0;
  for (const cell of splitAnsiChars(line)) {
    at += cell.w;
    if (col < at) return cell.href || null;
  }
  return null;
};

const isSpaceChar = (ch) => /\s/.test(ch);

const tokenizeWrap = (chars) => {
  const tokens = [];
  let buf = [];
  let space = null;
  for (const item of chars) {
    const sp = isSpaceChar(item.ch);
    if (buf.length === 0) {
      space = sp;
      buf.push(item);
      continue;
    }
    if (sp === space) {
      buf.push(item);
      continue;
    }
    tokens.push({ space, chars: buf });
    buf = [item];
    space = sp;
  }
  if (buf.length) tokens.push({ space, chars: buf });
  return tokens;
};

const trimTrailSpace = (row) => {
  while (row.length && isSpaceChar(row[row.length - 1].ch)) row.pop();
};

const hardBreakWord = (chars, width, rows) => {
  let row = [];
  let w = 0;
  for (const item of chars) {
    if (row.length && w + item.w > width) {
      rows.push(joinStyled(row));
      row = [];
      w = 0;
    }
    row.push(item);
    w += item.w;
  }
  if (row.length) rows.push(joinStyled(row));
};

const packWrapRows = (tokens, width) => {
  const rows = [];
  let row = [];
  let w = 0;

  const flush = () => {
    trimTrailSpace(row);
    if (row.length) rows.push(joinStyled(row));
    row = [];
    w = 0;
  };

  for (const tok of tokens) {
    const tw = charsWidth(tok.chars);
    if (tok.space) {
      if (w === 0) continue;
      if (w + tw > width) {
        flush();
        continue;
      }
      row.push(...tok.chars);
      w += tw;
      continue;
    }
    if (tw > width) {
      if (w > 0) flush();
      hardBreakWord(tok.chars, width, rows);
      continue;
    }
    if (w > 0 && w + tw > width) flush();
    row.push(...tok.chars);
    w += tw;
  }

  flush();
  if (rows.length) return rows;
  return [''];
};

const wrapLine = (line, width) => {
  if (width <= 0) return [line];
  if (visibleWidth(line) <= width) return [line];
  const chars = splitAnsiChars(line);
  const tokens = tokenizeWrap(chars);
  return packWrapRows(tokens, width);
};

const wrapLines = (lines, width) => {
  const out = [];
  for (const line of lines) {
    out.push(...wrapLine(line, width));
  }
  return out;
};

const isIdentChar = (ch) => /[A-Za-z0-9_$#]/.test(ch);

const codeHang = (chars, width) => {
  let baseIndent = 0;
  while (baseIndent < chars.length && chars[baseIndent].ch === ' ') {
    baseIndent++;
  }
  const hangCap = Math.max(2, width - 4);
  if (baseIndent > 0) return Math.min(baseIndent + 2, hangCap);
  return 0;
};

const codeBreakScore = (prev, cur) => {
  if (isIdentChar(prev) && isIdentChar(cur)) return -1;
  if (EARLY_PREV_SCORE[prev] !== undefined) return EARLY_PREV_SCORE[prev];
  if (cur === '.' && DOT_AFTER_SCORE[prev] !== undefined) {
    return DOT_AFTER_SCORE[prev];
  }
  if (BREAK_AFTER.includes(prev) && !isIdentChar(cur)) return 55;
  if (OPEN_PREV_SCORE[prev] !== undefined) return OPEN_PREV_SCORE[prev];
  if (CUR_BREAK_SCORE[cur] !== undefined) return CUR_BREAK_SCORE[cur];
  return -1;
};

const findCodeBreak = (chars, start, limit, budget) => {
  let best = -1;
  let bestScore = -1;
  for (let i = start + 1; i < limit; i++) {
    const prev = chars[i - 1].ch;
    const cur = chars[i].ch;
    let score = codeBreakScore(prev, cur);
    if (score < 0) continue;
    score += (i - start) / budget;
    if (score >= bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
};

const wrapCodeLine = (line, width) => {
  if (width <= 0) return [line];
  if (visibleWidth(line) <= width) return [line];

  const chars = splitAnsiChars(line);
  const hang = codeHang(chars, width);
  const rows = [];
  // cols[i] = cells before chars[i]; lets budgets count wide chars as 2.
  const cols = [0];
  for (const item of chars) cols.push(cols[cols.length - 1] + item.w);
  const total = cols[chars.length];
  let start = 0;

  while (start < chars.length) {
    const isCont = rows.length > 0;
    const budget = isCont ? Math.max(8, width - hang) : width;

    if (total - cols[start] <= budget) {
      let chunk = chars.slice(start);
      while (chunk.length && chunk[0].ch === ' ') chunk = chunk.slice(1);
      const body = joinStyled(chunk);
      rows.push(isCont ? ' '.repeat(hang) + body : body);
      break;
    }

    let limit = start + 1;
    while (limit < chars.length && cols[limit + 1] - cols[start] <= budget) {
      limit++;
    }
    let best = findCodeBreak(chars, start, limit, budget);
    if (best <= start) best = limit;

    let chunk = chars.slice(start, best);
    while (chunk.length && chunk[chunk.length - 1].ch === ' ') chunk.pop();
    if (isCont) {
      while (chunk.length && chunk[0].ch === ' ') {
        chunk = chunk.slice(1);
      }
    }

    const body = joinStyled(chunk);
    rows.push(isCont ? ' '.repeat(hang) + body : body);

    start = best;
    while (start < chars.length && chars[start].ch === ' ') start++;
  }

  return rows.length ? rows : [''];
};

const MIN_WRAP_WIDTH = 8;

/**
 * Wrap text behind a prefix: `first` leads row 0, `rest` the continuations.
 * No positive width means no wrapping.
 */
const wrapPrefixed = (text, width, first = '', rest = first) => {
  if (!(width > 0)) return [first + text];
  const body = Math.max(MIN_WRAP_WIDTH, width - visibleWidth(first));
  return wrapLine(text, body).map((row, k) => (k === 0 ? first : rest) + row);
};

const padEndVisible = (s, width) => {
  const n = visibleWidth(s);
  if (n >= width) return s;
  return s + ' '.repeat(width - n);
};

/** Cells [start, start + len); a wide char cut by an edge becomes spaces. */
const sliceVisible = (s, start, len) => {
  const end = start + len;
  const out = [];
  let col = 0;
  for (const item of splitAnsiChars(s)) {
    if (col >= end) break;
    const next = col + item.w;
    if (col >= start && next <= end) {
      out.push(item);
    } else if (next > start) {
      const cut = Math.min(next, end) - Math.max(col, start);
      out.push({ ...item, ch: ' '.repeat(cut), w: cut });
    }
    col = next;
  }
  return joinStyled(out);
};

module.exports = {
  asText,
  stripAnsi,
  visibleWidth,
  wrapLine,
  wrapLines,
  wrapCodeLine,
  wrapPrefixed,
  padEndVisible,
  sliceVisible,
  hrefAtCol,
  osc8Link,
};
