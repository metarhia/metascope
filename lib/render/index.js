'use strict';

const { frameCodeBlock, frameRunOutput } = require('./block');
const { renderMarkdown } = require('./markdown');

const render = (
  lang,
  source,
  { width = 80, wrap = true, outputs = null, tick = 0, hover = null } = {},
) => {
  // Markdown and plain .txt: paragraph reflow (not a code frame).
  if (lang === 'md' || lang === 'txt') {
    return renderMarkdown(source, {
      width: wrap ? width : 0,
      outputs,
      tick,
      hover,
    });
  }

  const id = 'file-0';
  const result = outputs && outputs.get(id);
  const control = result && result.running ? 'stop' : 'play';
  const hotCopy = !!(hover && hover.blockId === id && hover.kind === 'copy');
  const hotPlay = !!(
    hover &&
    hover.blockId === id &&
    (hover.kind === 'play' || hover.kind === 'stop')
  );
  const framed = frameCodeBlock(lang, source, {
    width: wrap && width > 0 ? width : 0,
    control,
    hotCopy,
    hotPlay,
  });
  const lines = [...framed.lines];
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
    const hotClose = !!(
      hover &&
      hover.blockId === id &&
      (hover.kind === 'close' || hover.kind === 'spin')
    );
    const panel = frameRunOutput(result, {
      width: wrap && width > 0 ? width : 0,
      tick,
      hotClose,
    });
    const outStart = lines.length;
    lines.push(...panel.lines);
    if (panel.close) {
      block.close = {
        lineIndex: outStart + panel.close.row,
        col0: panel.close.col0,
        col1: panel.close.col1,
      };
    }
  }
  return { lines, blocks, prelude: {} };
};

module.exports = { render };
