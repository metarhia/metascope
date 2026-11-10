'use strict';

const { paint, band, headingStyle, paintInlineCode } = require('../theme.js');
const wrap = require('../wrap.js');
const { wrapPrefixed, asText, visibleWidth, osc8Link, padEmoji } = wrap;
const block = require('./block.js');
const { frameRunnable, frameQuoteBlock, closeTarget, PAD_X } = block;
const { consumeTable, startsTable } = require('./table.js');
const { mapLang, isJsLang } = require('../detect.js');

const FENCE_RE = /^(`{3,}|~{3,})\s*(.*)$/;
const HEADING_RE = /^(#{1,6})\s+(.+)$/;
const HR_RE = /^(\*{3,}|-{3,}|_{3,})\s*$/;
const UL_RE = /^(\s*)([-*+])\s+(.+)$/;
const OL_RE = /^(\s*)(\d+)[.)]\s+(.+)$/;
const QUOTE_RE = /^>\s?(.*)$/;
const EXAMPLE_FILE_RE = /\.(?:js|mjs|cjs|ts|tsx|sh|bash|zsh)$/i;

const safeHref = (raw) => {
  let href = '';
  for (const ch of asText(raw)) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code === 127) continue;
    href += ch;
  }
  return href;
};

const styleInlineSpan = (span) => {
  if (span.startsWith('`')) {
    return paintInlineCode(span.slice(1, -1));
  }
  const link = span.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
  if (link) {
    const label = paint('link', link[1]);
    const href = safeHref(link[2]);
    if (!href) return label;
    return osc8Link(href, label);
  }
  if (span.startsWith('**') || span.startsWith('__')) {
    return paint('bold', span.slice(2, -2));
  }
  if (span.startsWith('*') || span.startsWith('_')) {
    return paint('italic', span.slice(1, -1));
  }
  return paint('plain', span);
};

const INLINE_RE =
  /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\([^)]+\))/;

/**
 * Inline markdown (code, bold, italic, links). Text between spans takes the
 * enclosing block's `base` style: quote, heading, table head, or plain.
 */
const inline = (text, base = 'plain') =>
  asText(text)
    .split(INLINE_RE)
    .map((part, k) => (k % 2 ? styleInlineSpan(part) : paint(base, part)))
    .join('');

const pushMapped = (ctx, visualLines, first, last) => {
  const origin = { first, last };
  for (const line of visualLines) {
    ctx.out.push(line);
    ctx.origins.push(origin);
  }
};

const pushUnmapped = (ctx, visualLines) => {
  for (const line of visualLines) {
    ctx.out.push(line);
    ctx.origins.push(null);
  }
};

const pushWrapped = (ctx, line, width, first, last) => {
  pushMapped(ctx, wrapPrefixed(asText(line), width), first, last);
};

// Hanging indent: continuation rows align under the item text, not column 0.
const pushListItem = (ctx, prefix, text, width, first, last) => {
  const hang = ' '.repeat(visibleWidth(prefix));
  pushMapped(ctx, wrapPrefixed(text, width, prefix, hang), first, last);
};

const pushBandWrapped = (ctx, style, text, width, first, last) => {
  const rows = wrapPrefixed(inline(text, style), width, ' '.repeat(PAD_X));
  const banded = rows.map((row) => band(style, row, width || 0));
  pushMapped(ctx, banded, first, last);
};

const isParagraphBreak = (raw) => {
  const s = asText(raw);
  if (s.trim() === '') return true;
  if (FENCE_RE.test(s)) return true;
  if (HR_RE.test(s.trim())) return true;
  if (HEADING_RE.test(s)) return true;
  if (QUOTE_RE.test(s)) return true;
  if (UL_RE.test(s)) return true;
  if (OL_RE.test(s)) return true;
  return false;
};

const parseFenceInfo = (info) => {
  const parts = asText(info).trim().split(/\s+/).filter(Boolean);
  const lang = parts[0] || '';
  const flags = parts.slice(1).map((p) => p.toLowerCase());
  const setup = flags.includes('init');
  return { lang, setup };
};

// Quote lines reflow into paragraphs like plain text. A blank `>` line
// separates paragraphs; a list, heading, fence or nested quote starts one.
const takeQuoteParas = (lines, i) => {
  const paras = [];
  let para = null;
  while (i < lines.length) {
    const q = lines[i].match(QUOTE_RE);
    if (!q) break;
    const text = q[1].trimEnd();
    if (!text.trim()) {
      paras.push({ text: '', first: i, last: i });
      para = null;
    } else if (para && !isParagraphBreak(text)) {
      para.text += ` ${text.trim()}`;
      para.last = i;
    } else {
      para = { text, first: i, last: i };
      paras.push(para);
    }
    i++;
  }
  return { paras, next: i };
};

const takeParagraph = (lines, i) => {
  const parts = [];
  while (i < lines.length) {
    const line = lines[i];
    if (isParagraphBreak(line) || startsTable(lines, i)) break;
    parts.push(line.trim());
    i++;
  }
  const joined = parts.filter(Boolean).join(' ');
  return { joined, next: i };
};

// Item text plus indented source continuation lines (CommonMark-style).
const takeListItem = (lines, i, first) => {
  const parts = [first.trim()];
  let next = i + 1;
  while (next < lines.length) {
    const line = asText(lines[next]);
    if (!/^\s/.test(line)) break;
    if (isParagraphBreak(line) || startsTable(lines, next)) break;
    if (/^\s*(`{3,}|~{3,})/.test(line)) break;
    parts.push(line.trim());
    next++;
  }
  return { text: parts.join(' '), next };
};

const appendFence = (ctx) => {
  const info = parseFenceInfo(ctx.fenceLang);
  const lang = mapLang(info.lang);
  const id = `fence-${ctx.fenceIndex++}`;
  const body = ctx.fenceBody.join('\n');
  const { width, outputs, tick, hover } = ctx;
  const frameOpts = { width, setup: info.setup, outputs, tick, hover };
  const { framed, panel } = frameRunnable(id, lang, body, frameOpts);
  const startLine = ctx.out.length;
  pushMapped(ctx, framed.lines, ctx.fenceStart, ctx.fenceEnd);
  const endLine = ctx.out.length;

  if (info.setup && isJsLang(lang)) {
    // One shared JS prelude for js / mjs / ts examples
    ctx.prelude.js = body;
    ctx.prelude.mjs = body;
    ctx.prelude.ts = body;
  }

  // Catalog uses `## file.js`; otherwise keep a generic Example label.
  const heading = ctx.lastHeading.trim();
  const isFileHeading = EXAMPLE_FILE_RE.test(heading);
  const label = isFileHeading ? heading : 'Example';

  const entry = {
    id,
    lang,
    source: framed.source,
    label,
    startLine,
    endLine,
    play: framed.play,
    copy: framed.copy,
    close: null,
  };

  ctx.blocks.push(entry);

  if (panel) {
    entry.close = closeTarget(panel, ctx.out.length);
    pushUnmapped(ctx, panel.lines);
  }
  ctx.fenceBody = [];
  ctx.inFence = false;
  ctx.fenceLang = '';
};

const renderMarkdown = (source, options = {}) => {
  const width = options.width ?? 80;
  const outputs = options.outputs ?? null;
  const tick = options.tick ?? 0;
  const hover = options.hover ?? null;
  const src = asText(source).replace(/\r\n/g, '\n').split('\n');
  // Display text; fence bodies keep `src` (they are copied and run).
  const lines = src.map(padEmoji);
  const out = [];
  const origins = [];
  const blocks = [];
  const prelude = {};
  const ctx = {
    width,
    outputs,
    tick,
    hover,
    out,
    origins,
    blocks,
    prelude,
    fenceIndex: 0,
    inFence: false,
    fenceChar: '',
    fenceLang: '',
    fenceBody: [],
    fenceStart: 0,
    fenceEnd: 0,
    lastHeading: '',
  };
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    if (ctx.inFence) {
      const m = raw.match(FENCE_RE);
      const same = m && m[1][0] === ctx.fenceChar[0];
      const longEnough = m && m[1].length >= ctx.fenceChar.length;
      if (same && longEnough) {
        ctx.fenceEnd = i;
        appendFence(ctx);
        i++;
        continue;
      }
      ctx.fenceBody.push(src[i]);
      i++;
      continue;
    }

    const fence = raw.match(FENCE_RE);
    if (fence) {
      ctx.inFence = true;
      ctx.fenceChar = fence[1];
      ctx.fenceLang = fence[2] || '';
      ctx.fenceBody = [];
      ctx.fenceStart = i;
      i++;
      continue;
    }

    const table = consumeTable(lines, i, inline, width);
    if (table) {
      const last = table.next - 1;
      pushMapped(ctx, table.lines, i, last);
      i = table.next;
      continue;
    }

    if (HR_RE.test(raw.trim())) {
      pushMapped(ctx, [band('hr', ' ', width)], i, i);
      i++;
      continue;
    }

    const heading = raw.match(HEADING_RE);
    if (heading) {
      const level = heading[1].length;
      const style = headingStyle(level);
      ctx.lastHeading = asText(heading[2]).trim();
      pushBandWrapped(ctx, style, heading[2], width, i, i);
      i++;
      continue;
    }

    const quote = raw.match(QUOTE_RE);
    if (quote) {
      const taken = takeQuoteParas(lines, i);
      const last = taken.next - 1;
      const paintText = (text) => inline(text, 'quote');
      const quoteOpts = { width, first: i, last, paintText };
      const framed = frameQuoteBlock(taken.paras, quoteOpts);
      ctx.out.push(...framed.lines);
      ctx.origins.push(...framed.origins);
      i = taken.next;
      continue;
    }

    const ul = raw.match(UL_RE);
    const li = ul || raw.match(OL_RE);
    if (li) {
      const marker = ul ? '• ' : `${li[2]}. `;
      const prefix = ' '.repeat(li[1].length) + paint('list', marker);
      const item = takeListItem(lines, i, li[3]);
      pushListItem(ctx, prefix, inline(item.text), width, i, item.next - 1);
      i = item.next;
      continue;
    }

    if (raw.trim() === '') {
      pushMapped(ctx, [''], i, i);
      i++;
      continue;
    }

    const paraStart = i;
    const para = takeParagraph(lines, i);
    i = para.next;
    if (para.joined) {
      const paraLast = Math.max(paraStart, i - 1);
      pushWrapped(ctx, inline(para.joined), width, paraStart, paraLast);
    }
    if (i <= paraStart) i = paraStart + 1;
  }

  if (ctx.inFence) {
    ctx.fenceEnd = lines.length - 1;
    appendFence(ctx);
  }
  return { lines: out, origins, blocks, prelude };
};

module.exports = { inline, renderMarkdown };
