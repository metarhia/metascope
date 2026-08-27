'use strict';

const { frameCodeBlock, frameRunOutput, isHot } = require('./block.js');
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
  const result = outputs && outputs.get(id);
  const control = result && result.running ? 'stop' : 'play';
  const hotCopy = isHot(hover, id, ['copy']);
  const hotPlay = isHot(hover, id, ['play', 'stop']);
  const frameOpts = { width: wrapWidth, control, hotCopy, hotPlay };
  const framed = frameCodeBlock(lang, source, frameOpts);
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
  if (result) {
    const hotClose = isHot(hover, id, ['close', 'spin']);
    const panelOpts = { width: wrapWidth, tick, hotClose };
    const panel = frameRunOutput(result, panelOpts);
    const outStart = lines.length;
    lines.push(...panel.lines);
    while (origins.length < lines.length) origins.push(null);
    if (panel.close) {
      block.close = {
        lineIndex: outStart + panel.close.row,
        col0: panel.close.col0,
        col1: panel.close.col1,
      };
    }
  }
  return { lines, origins, blocks, prelude: {} };
};

module.exports = { render };
