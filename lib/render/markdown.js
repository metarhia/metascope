'use strict';

const { paint, band, headingStyle, paintInlineCode } = require('../theme.js');
const { wrapLine, asText } = require('../wrap.js');
const block = require('./block.js');
const { frameCodeBlock, frameQuoteBlock, frameRunOutput } = block;
const { PAD_X, isHot } = block;
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
    return `\x1b]8;;${href}\x07${label}\x1b]8;;\x07`;
  }
  if (span.startsWith('**') || span.startsWith('__')) {
    return paint('bold', span.slice(2, -2));
  }
  if (span.startsWith('*') || span.startsWith('_')) {
    return paint('italic', span.slice(1, -1));
  }
  return paint('plain', span);
};

const inline = (text) => {
  const re =
    /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\([^)]+\))/g;
  const parts = [];
  let last = 0;
  let m = re.exec(text);
  while (m !== null) {
    if (m.index > last) {
      parts.push(paint('plain', text.slice(last, m.index)));
    }
    parts.push(styleInlineSpan(m[0]));
    last = m.index + m[0].length;
    m = re.exec(text);
  }
  if (last < text.length) parts.push(paint('plain', text.slice(last)));
  return parts.length ? parts.join('') : paint('plain', text);
};

const padRows = (text, width, leftPad = 0) => {
  const pad = ' '.repeat(leftPad);
  const raw = asText(text);
  if (!width || width <= 0) return [pad + raw];
  const rows = wrapLine(raw, Math.max(8, width - leftPad));
  return rows.map((row) => pad + row);
};

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
  pushMapped(ctx, padRows(line, width, 0), first, last);
};

const pushBandWrapped = (ctx, style, text, width, first, last) => {
  const rows = [];
  for (const row of padRows(text, width, PAD_X)) {
    rows.push(band(style, row, width || 0));
  }
  pushMapped(ctx, rows, first, last);
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

const takeQuoteLines = (lines, i) => {
  const texts = [];
  while (i < lines.length) {
    const q = lines[i].match(QUOTE_RE);
    if (!q) break;
    texts.push(q[1]);
    i++;
  }
  return { texts, next: i };
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

const appendFence = (ctx) => {
  const info = parseFenceInfo(ctx.fenceLang);
  const lang = mapLang(info.lang);
  const id = `fence-${ctx.fenceIndex++}`;
  const body = ctx.fenceBody.join('\n');
  const result = ctx.outputs && ctx.outputs.get(id);
  const control = result && result.running ? 'stop' : 'play';
  const hotCopy = isHot(ctx.hover, id, ['copy']);
  const hotPlay = isHot(ctx.hover, id, ['play', 'stop']);
  const framed = frameCodeBlock(lang, body, {
    width: ctx.width,
    setup: info.setup,
    control,
    hotCopy,
    hotPlay,
  });
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

  if (result) {
    const hotClose = isHot(ctx.hover, id, ['close', 'spin']);
    const panelOpts = { width: ctx.width, tick: ctx.tick, hotClose };
    const panel = frameRunOutput(result, panelOpts);
    const outStart = ctx.out.length;
    pushUnmapped(ctx, panel.lines);
    if (panel.close) {
      entry.close = {
        lineIndex: outStart + panel.close.row,
        col0: panel.close.col0,
        col1: panel.close.col1,
      };
    }
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
  const lines = source.replace(/\r\n/g, '\n').split('\n');
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
      ctx.fenceBody.push(raw);
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
      const taken = takeQuoteLines(lines, i);
      const last = taken.next - 1;
      const framed = frameQuoteBlock(taken.texts, {
        width,
        first: i,
        last,
      });
      ctx.out.push(...framed.lines);
      ctx.origins.push(...framed.origins);
      i = taken.next;
      continue;
    }

    const ul = raw.match(UL_RE);
    if (ul) {
      const indent = ' '.repeat(ul[1].length);
      const bullet = paint('list', '• ');
      pushWrapped(ctx, indent + bullet + inline(ul[3]), width, i, i);
      i++;
      continue;
    }

    const ol = raw.match(OL_RE);
    if (ol) {
      const indent = ' '.repeat(ol[1].length);
      const num = paint('list', `${ol[2]}. `);
      pushWrapped(ctx, indent + num + inline(ol[3]), width, i, i);
      i++;
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
