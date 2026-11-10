'use strict';

const { frameRunnable, closeTarget } = require('./block.js');
const { renderMarkdown } = require('./markdown.js');

const render = (lang, source, options = {}) => {
  const width = options.width ?? 80;
  const wrap = options.wrap ?? true;
  const outputs = options.outputs ?? null;
  const tick = options.tick ?? 0;
  const hover = options.hover ?? null;
  const wrapWidth = wrap ? width : 0;
  // Markdown and plain .txt: paragraph reflow (not a code frame).
  if (lang === 'md' || lang === 'txt') {
    const mdOpts = { width: wrapWidth, outputs, tick, hover };
    return renderMarkdown(source, mdOpts);
  }

  const id = 'file-0';
  const frameOpts = { width: wrapWidth, outputs, tick, hover };
  const { framed, panel } = frameRunnable(id, lang, source, frameOpts);
  const lines = [...framed.lines];
  const origins = [...framed.origins];
  const block = {
    id,
    lang,
    source: framed.source,
    label: null,
    startLine: 0,
    endLine: framed.lines.length,
    play: framed.play,
    copy: framed.copy,
    close: null,
  };
  const blocks = [block];
  if (panel) {
    block.close = closeTarget(panel, lines.length);
    lines.push(...panel.lines);
    while (origins.length < lines.length) origins.push(null);
  }
  return { lines, origins, blocks, prelude: {} };
};

module.exports = { render };
