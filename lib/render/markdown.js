'use strict';

const { paint, band, headingStyle, paintInlineCode } = require('../theme');
const { wrapLine } = require('../wrap');
const { frameCodeBlock, frameQuoteBlock, frameRunOutput } = require('./block');
const { consumeTable } = require('./table');

const FENCE_RE = /^(`{3,}|~{3,})\s*(.*)$/;
const HEADING_RE = /^(#{1,6})\s+(.+)$/;
const HR_RE = /^(\*{3,}|-{3,}|_{3,})\s*$/;
const UL_RE = /^(\s*)([-*+])\s+(.+)$/;
const OL_RE = /^(\s*)(\d+)[.)]\s+(.+)$/;
const QUOTE_RE = /^>\s?(.*)$/;

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

function styleInlineSpan(span) {
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
}

const pushWrapped = (out, line, width) => {
  // Same left pad on every visual row (no hanging +2 on continuations).
  const pad = ' '.repeat(2);
  if (width && width > 0) {
    const rows = wrapLine(line, Math.max(8, width - 2));
    for (const row of rows) out.push(pad + row);
  } else {
    out.push(pad + line);
  }
};

const pushBandWrapped = (out, style, text, width) => {
  if (!width || width <= 0) {
    out.push(band(style, text, 0));
    return;
  }
  const rows = wrapLine(String(text), width);
  for (const row of rows) {
    out.push(band(style, row, width));
  }
};

const renderMarkdown = (
  source,
  { width = 80, outputs = null, tick = 0, hover = null } = {},
) => {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  const blocks = [];
  /** @type {Record<string, string>} lang family → init source */
  const prelude = {};
  let i = 0;
  let fenceIndex = 0;
  let inFence = false;
  let fenceChar = '';
  let fenceLang = '';
  let fenceBody = [];
  let lastHeading = '';

  const flushFence = () => {
    const info = parseFenceInfo(fenceLang);
    const lang = mapFenceLang(info.lang);
    const rawLang = String(info.lang || '').toLowerCase();
    const runLang = ['bash', 'sh', 'shell', 'zsh'].includes(rawLang)
      ? 'bash'
      : lang;
    const id = `fence-${fenceIndex++}`;
    const body = fenceBody.join('\n');
    const result = outputs && outputs.get(id);
    const control = result && result.running ? 'stop' : 'play';
    const hotCopy = !!(hover && hover.blockId === id && hover.kind === 'copy');
    const hotPlay = !!(
      hover &&
      hover.blockId === id &&
      (hover.kind === 'play' || hover.kind === 'stop')
    );
    const framed = frameCodeBlock(runLang, body, {
      width,
      setup: info.setup,
      control,
      hotCopy,
      hotPlay,
    });
    const startLine = out.length;
    out.push(...framed.lines);
    const endLine = out.length;

    if (info.setup && ['js', 'mjs', 'ts'].includes(runLang)) {
      // One shared JS prelude for js / mjs / ts examples
      prelude.js = body;
      prelude.mjs = body;
      prelude.ts = body;
    }

    // Catalog uses `## file.js`; otherwise keep a generic Example label.
    const heading = lastHeading.trim();
    const label = /\.(?:js|mjs|cjs|ts|tsx|sh|bash|zsh)$/i.test(heading)
      ? heading
      : 'Example';

    const block = {
      id,
      lang: runLang,
      source: framed.source,
      label,
      startLine,
      endLine,
      play: framed.play,
      copy: framed.copy,
      close: null,
    };

    // All code fences get a block entry (copy); runnable also get ▶.
    blocks.push(block);

    if (result) {
      const hotClose = !!(
        hover &&
        hover.blockId === id &&
        (hover.kind === 'close' || hover.kind === 'spin')
      );
      const panel = frameRunOutput(result, { width, tick, hotClose });
      const outStart = out.length;
      out.push(...panel.lines);
      if (panel.close) {
        block.close = {
          lineIndex: outStart + panel.close.row,
          col0: panel.close.col0,
          col1: panel.close.col1,
        };
      }
    }
    fenceBody = [];
    inFence = false;
    fenceLang = '';
  };

  while (i < lines.length) {
    const raw = lines[i];

    if (inFence) {
      const m = raw.match(FENCE_RE);
      if (m && m[1][0] === fenceChar[0] && m[1].length >= fenceChar.length) {
        flushFence();
        i++;
        continue;
      }
      fenceBody.push(raw);
      i++;
      continue;
    }

    const fence = raw.match(FENCE_RE);
    if (fence) {
      inFence = true;
      fenceChar = fence[1];
      fenceLang = fence[2] || '';
      fenceBody = [];
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
      const title = ` ${heading[2]} `;
      lastHeading = String(heading[2] || '').trim();
      pushBandWrapped(out, style, title, width);
      i++;
      continue;
    }

    const quote = raw.match(QUOTE_RE);
    if (quote) {
      const texts = [];
      while (i < lines.length) {
        const q = lines[i].match(QUOTE_RE);
        if (!q) break;
        texts.push(q[1]);
        i++;
      }
      out.push(...frameQuoteBlock(texts, { width }));
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

    // Soft-wrapped plain paragraphs: join lines, then reflow to terminal width.
    // Lists, code, quotes, headings, etc. are handled above and stay as-is.
    const parts = [];
    while (i < lines.length) {
      const line = lines[i];
      if (isParagraphBreak(line) || looksLikeTableRow(line)) break;
      parts.push(line.trim());
      i++;
    }
    const joined = parts.filter(Boolean).join(' ');
    if (joined) pushWrapped(out, inline(joined), width);
  }

  if (inFence) flushFence();
  return { lines: out, blocks, prelude };
};

/** Blank or start of another markdown block — ends a plain paragraph. */
function isParagraphBreak(raw) {
  const s = String(raw ?? '');
  if (s.trim() === '') return true;
  if (FENCE_RE.test(s)) return true;
  if (HR_RE.test(s.trim())) return true;
  if (HEADING_RE.test(s)) return true;
  if (QUOTE_RE.test(s)) return true;
  if (UL_RE.test(s)) return true;
  if (OL_RE.test(s)) return true;
  return false;
}

function looksLikeTableRow(raw) {
  return /^\s*\|/.test(String(raw ?? ''));
}

/** Fence info: `js`, `js init`, … */
function parseFenceInfo(info) {
  const parts = String(info || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const lang = parts[0] || '';
  const flags = new Set(parts.slice(1).map((p) => p.toLowerCase()));
  return {
    lang,
    setup: flags.has('init'),
  };
}

function mapFenceLang(lang) {
  const l = String(lang || '').toLowerCase();
  if (['js', 'javascript'].includes(l)) return 'js';
  if (['mjs'].includes(l)) return 'mjs';
  if (['ts', 'typescript'].includes(l)) return 'ts';
  if (['json'].includes(l)) return 'json';
  if (['css'].includes(l)) return 'css';
  if (['html', 'htm'].includes(l)) return 'html';
  if (['csv'].includes(l)) return 'csv';
  if (['bash', 'sh', 'shell', 'zsh'].includes(l)) return 'bash';
  if (['txt', 'text', 'plain'].includes(l)) return 'txt';
  if (l) return 'txt';
  return 'txt';
}

module.exports = { renderMarkdown, inline };
