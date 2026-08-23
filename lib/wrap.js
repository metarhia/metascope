'use strict';

const ANSI_RE = /\x1b\[[0-9;]*m/g;

const asText = (value) => {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  return `${value}`;
};

const stripAnsi = (s) => asText(s).replace(ANSI_RE, '');

const visibleWidth = (s) => {
  const plain = stripAnsi(s);
  let width = 0;
  for (let i = 0; i < plain.length; i++) {
    const code = plain.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      i++;
      width += 1;
      continue;
    }
    width += 1;
  }
  return width;
};

const splitAnsiChars = (s) => {
  const chars = [];
  let i = 0;
  let open = '';
  while (i < s.length) {
    if (s[i] === '\x1b' && s[i + 1] === '[') {
      let j = i + 2;
      while (j < s.length && s[j] !== 'm') j++;
      const seq = s.slice(i, j + 1);
      if (seq.endsWith('m')) {
        // Accumulate stacked SGR (e.g. bg then fg for inline code).
        // Replacing with only the last seq dropped backgrounds on wrap.
        if (seq === '\x1b[0m') open = '';
        else open += seq;
        i = j + 1;
        continue;
      }
    }
    let ch = s[i];
    const code = s.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < s.length) {
      ch = s.slice(i, i + 2);
      i += 2;
    } else {
      i += 1;
    }
    chars.push({ ch, style: open });
  }
  return chars;
};

const joinStyled = (chars) => {
  if (chars.length === 0) return '';
  let out = '';
  let cur = null;
  for (const { ch, style } of chars) {
    if (style !== cur) {
      if (cur) out += '\x1b[0m';
      if (style) out += style;
      cur = style;
    }
    out += ch;
  }
  if (cur) out += '\x1b[0m';
  return out;
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
  for (let i = 0; i < chars.length; i += width) {
    const slice = chars.slice(i, i + width);
    rows.push(joinStyled(slice));
  }
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
    const tw = tok.chars.length;
    if (tok.space) {
      if (w === 0) continue;
      if (w + tw > width) { flush(); continue; }
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

const BREAK_AFTER = [
  ',', ';', '{', '(', '[', '=', '?', ':', '+', '-',
  '*', '/', '%', '&', '|', '^', '<', '>', '!',
];

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
  if (prev === ',' || prev === ';') return 100;
  if (cur === '.' && (prev === ')' || prev === ']')) return 95;
  if (prev === ' ') return 70;
  if (BREAK_AFTER.includes(prev) && !isIdentChar(cur)) return 55;
  if (prev === '(' || prev === '{' || prev === '[') return 40;
  if (cur === ')' || cur === ']' || cur === '}') return 15;
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
  let start = 0;

  while (start < chars.length) {
    const isCont = rows.length > 0;
    const budget = isCont ? Math.max(8, width - hang) : width;

    if (chars.length - start <= budget) {
      let chunk = chars.slice(start);
      while (chunk.length && chunk[0].ch === ' ') chunk = chunk.slice(1);
      const body = joinStyled(chunk);
      rows.push(isCont ? ' '.repeat(hang) + body : body);
      break;
    }

    const limit = Math.min(start + budget, chars.length);
    let best = findCodeBreak(chars, start, limit, budget);
    if (best <= start) best = limit;

    let chunk = chars.slice(start, best);
    while (chunk.length && chunk[chunk.length - 1].ch === ' ') chunk.pop();
    while (isCont && chunk.length && chunk[0].ch === ' ') {
      chunk = chunk.slice(1);
    }

    const body = joinStyled(chunk);
    rows.push(isCont ? ' '.repeat(hang) + body : body);

    start = best;
    while (start < chars.length && chars[start].ch === ' ') start++;
  }

  return rows.length ? rows : [''];
};

const wrapCodeLines = (lines, width) => {
  const out = [];
  for (const line of lines) {
    out.push(...wrapCodeLine(line, width));
  }
  return out;
};

const padEndVisible = (s, width) => {
  const n = visibleWidth(s);
  if (n >= width) return s;
  return s + ' '.repeat(width - n);
};

const sliceVisible = (s, start, len) => {
  const chars = splitAnsiChars(s);
  return joinStyled(chars.slice(start, start + len));
};

module.exports = {
  asText,
  stripAnsi,
  visibleWidth,
  wrapLine,
  wrapLines,
  wrapCodeLine,
  wrapCodeLines,
  padEndVisible,
  sliceVisible,
};
