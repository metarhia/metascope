'use strict';

const ESC = '\\u001b';
const ANSI_RE = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');

const stripAnsi = (s) => String(s).replace(ANSI_RE, '');

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

const wrapLine = (line, width) => {
  if (width <= 0) return [line];
  if (visibleWidth(line) <= width) return [line];

  const chars = splitAnsiChars(line);
  const tokens = [];
  let buf = [];
  let bufSpace = null;

  for (const item of chars) {
    const sp = isSpaceChar(item.ch);
    if (buf.length === 0) {
      bufSpace = sp;
      buf.push(item);
      continue;
    }
    if (sp === bufSpace) {
      buf.push(item);
      continue;
    }
    tokens.push({ space: bufSpace, chars: buf });
    buf = [item];
    bufSpace = sp;
  }
  if (buf.length) tokens.push({ space: bufSpace, chars: buf });

  const rows = [];
  let row = [];
  let w = 0;

  const flush = () => {
    while (row.length && isSpaceChar(row[row.length - 1].ch)) row.pop();
    if (row.length) rows.push(joinStyled(row));
    row = [];
    w = 0;
  };

  for (const tok of tokens) {
    const tw = tok.chars.length;

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

    // Word longer than width: hard-break by characters
    if (tw > width) {
      if (w > 0) flush();
      for (let i = 0; i < tok.chars.length; i += width) {
        rows.push(joinStyled(tok.chars.slice(i, i + width)));
      }
      continue;
    }

    if (w > 0 && w + tw > width) flush();
    row.push(...tok.chars);
    w += tw;
  }

  flush();
  return rows.length ? rows : [''];
};

const wrapLines = (lines, width) => {
  const out = [];
  for (const line of lines) {
    out.push(...wrapLine(line, width));
  }
  return out;
};

const BREAK_AFTER = new Set([
  ',',
  ';',
  '{',
  '(',
  '[',
  '=',
  '?',
  ':',
  '+',
  '-',
  '*',
  '/',
  '%',
  '&',
  '|',
  '^',
  '<',
  '>',
  '!',
]);

const isIdentChar = (ch) => /[A-Za-z0-9_$#]/.test(ch);

/**
 * Wrap a highlighted code line like a formatter:
 * prefer breaks after , ; ( { [ operators and spaces; before `.`;
 * hang continuation with baseIndent + 2.
 */
const wrapCodeLine = (line, width) => {
  if (width <= 0) return [line];
  if (visibleWidth(line) <= width) return [line];

  const chars = splitAnsiChars(line);
  let baseIndent = 0;
  while (baseIndent < chars.length && chars[baseIndent].ch === ' ') {
    baseIndent++;
  }
  const hang =
    baseIndent > 0 ? Math.min(baseIndent + 2, Math.max(2, width - 4)) : 0;

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
    let best = -1;
    let bestScore = -1;

    for (let i = start + 1; i < limit; i++) {
      const prev = chars[i - 1].ch;
      const cur = chars[i].ch;
      let score = 0;

      // Never break inside an identifier / number
      if (isIdentChar(prev) && isIdentChar(cur)) continue;

      if (prev === ',' || prev === ';') score = 100;
      else if (cur === '.' && (prev === ')' || prev === ']')) score = 95;
      else if (prev === ' ') score = 70;
      else if (BREAK_AFTER.has(prev) && !isIdentChar(cur)) score = 55;
      else if (prev === '(' || prev === '{' || prev === '[') score = 40;
      else if (cur === ')' || cur === ']' || cur === '}') score = 15;
      else continue;

      // Prefer breaks closer to the end of the budget (fill the line)
      score += (i - start) / budget;
      if (score >= bestScore) {
        bestScore = score;
        best = cur === '.' ? i : i; // break at i (next line starts here)
        if (prev === ' ') best = i; // start after space
        if (prev === ',' || prev === ';') best = i;
      }
    }

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
  stripAnsi,
  visibleWidth,
  wrapLine,
  wrapLines,
  wrapCodeLine,
  wrapCodeLines,
  padEndVisible,
  sliceVisible,
};
