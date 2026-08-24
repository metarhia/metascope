'use strict';

const { paint, band, headingStyle, paintInlineCode } = require('../theme.js');
const { wrapLine, asText } = require('../wrap.js');
const block = require('./block.js');
const { frameCodeBlock, frameQuoteBlock, frameRunOutput } = block;
const { PAD_X, isHot } = block;
const { consumeTable } = require('./table.js');
const { mapLang, isJsLang } = require('../detect.js');

const FENCE_RE = /^(`{3,}|~{3,})\s*(.*)$/;
const HEADING_RE = /^(#{1,6})\s+(.+)$/;
const HR_RE = /^(\*{3,}|-{3,}|_{3,})\s*$/;
const UL_RE = /^(\s*)([-*+])\s+(.+)$/;
const OL_RE = /^(\s*)(\d+)[.)]\s+(.+)$/;
const QUOTE_RE = /^>\s?(.*)$/;
const EXAMPLE_FILE_RE = /\.(?:js|mjs|cjs|ts|tsx|sh|bash|zsh)$/i;

const styleInlineSpan = (span) => {
  if (span.startsWith('`')) {
    return paintInlineCode(span.slice(1, -1));
  }
  const link = span.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
  if (link) {
    return `${paint('link', link[1])}${paint('muted', ` (${link[2]})`)}`;
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

const pushWrapped = (out, line, width) => {
  out.push(...padRows(line, width, 0));
};

const pushBandWrapped = (out, style, text, width) => {
  for (const row of padRows(text, width, PAD_X)) {
    out.push(band(style, row, width || 0));
  }
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

const looksLikeTableRow = (raw) => /^\s*\|/.test(asText(raw));

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
    if (isParagraphBreak(line) || looksLikeTableRow(line)) break;
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
  ctx.out.push(...framed.lines);
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
    ctx.out.push(...panel.lines);
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
  const blocks = [];
  const prelude = {};
  const ctx = {
    width,
    outputs,
    tick,
    hover,
    out,
    blocks,
    prelude,
    fenceIndex: 0,
    inFence: false,
    fenceChar: '',
    fenceLang: '',
    fenceBody: [],
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
      i++;
      continue;
    }

    const table = consumeTable(lines, i, inline, width);
    if (table) {
      out.push(...table.lines);
      i = table.next;
      continue;
    }

    if (HR_RE.test(raw.trim())) {
      out.push(band('hr', ' ', width));
      i++;
      continue;
    }

    const heading = raw.match(HEADING_RE);
    if (heading) {
      const level = heading[1].length;
      const style = headingStyle(level);
      ctx.lastHeading = asText(heading[2]).trim();
      pushBandWrapped(out, style, heading[2], width);
      i++;
      continue;
    }

    const quote = raw.match(QUOTE_RE);
    if (quote) {
      const taken = takeQuoteLines(lines, i);
      out.push(...frameQuoteBlock(taken.texts, { width }));
      i = taken.next;
      continue;
    }

    const ul = raw.match(UL_RE);
    if (ul) {
      const indent = ' '.repeat(ul[1].length);
      const bullet = paint('list', '• ');
      pushWrapped(out, indent + bullet + inline(ul[3]), width);
      i++;
      continue;
    }

    const ol = raw.match(OL_RE);
    if (ol) {
      const indent = ' '.repeat(ol[1].length);
      const num = paint('list', `${ol[2]}. `);
      pushWrapped(out, indent + num + inline(ol[3]), width);
      i++;
      continue;
    }

    if (raw.trim() === '') {
      out.push('');
      i++;
      continue;
    }

    const para = takeParagraph(lines, i);
    i = para.next;
    if (para.joined) pushWrapped(out, inline(para.joined), width);
  }

  if (ctx.inFence) appendFence(ctx);
  return { lines: out, blocks, prelude };
};

module.exports = { inline, renderMarkdown };
