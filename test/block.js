'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const block = require('../lib/render/block.js');
const { isHot, spinnerFrame, SPINNER } = block;
const { playHitCols, copyHitCols, LABELS } = block;
const { frameCodeBlock, frameQuoteBlock, frameRunOutput } = block;
const { stripAnsi, visibleWidth } = require('../lib/wrap.js');

test('isHot matches block id and kind', () => {
  const hover = { blockId: 'fence-0', kind: 'play' };
  assert.strictEqual(isHot(hover, 'fence-0', ['play', 'stop']), true);
  assert.strictEqual(isHot(hover, 'fence-0', ['copy']), false);
  assert.strictEqual(isHot(hover, 'fence-1', ['play']), false);
  assert.strictEqual(isHot(null, 'fence-0', ['play']), false);
});

test('spinnerFrame cycles the spinner glyphs', () => {
  assert.strictEqual(spinnerFrame(0), SPINNER[0]);
  assert.strictEqual(spinnerFrame(SPINNER.length), SPINNER[0]);
  assert.strictEqual(spinnerFrame(1), SPINNER[1]);
});

test('playHitCols and copyHitCols sit at the right edge', () => {
  const width = 40;
  const play = playHitCols(width, 'play');
  const copy = copyHitCols(width);
  const playW = visibleWidth(LABELS.play);
  const copyW = visibleWidth(LABELS.copy);
  assert.strictEqual(play.col1, width);
  assert.strictEqual(play.col0, width - playW);
  assert.strictEqual(copy.col1, width);
  assert.strictEqual(copy.col0, width - copyW);
});

test('frameCodeBlock adds copy and play for runnable js', () => {
  const framed = frameCodeBlock('js', 'const x = 1;\n', { width: 50 });
  assert.strictEqual(framed.runnable, true);
  assert.ok(framed.copy);
  assert.ok(framed.play);
  assert.strictEqual(framed.play.kind, 'play');
  assert.ok(framed.lines.length > 2);
  assert.strictEqual(framed.origins.length, framed.lines.length);
  const plain = framed.lines.map(stripAnsi).join('\n');
  assert.ok(plain.includes('const x = 1'));
});

test('frameCodeBlock skips play for init setup', () => {
  const framed = frameCodeBlock('js', `'use strict';\n`, {
    width: 40,
    setup: true,
  });
  assert.strictEqual(framed.runnable, false);
  assert.strictEqual(framed.play, null);
  assert.ok(framed.copy);
});

test('frameQuoteBlock prefixes wrapped rows with a rule', () => {
  const framed = frameQuoteBlock(['hello quote'], { width: 40 });
  const plain = framed.lines.map(stripAnsi).join('\n');
  assert.ok(plain.includes('│'));
  assert.ok(plain.includes('hello quote'));
  assert.strictEqual(framed.origins.length, framed.lines.length);
});

test('frameRunOutput shows exit status for finished runs', () => {
  const result = {
    ok: true,
    code: 0,
    text: 'done\n',
    stdout: 'done\n',
    stderr: '',
    running: false,
  };
  const panel = frameRunOutput(result, { width: 40 });
  assert.ok(panel.close);
  const plain = panel.lines.map(stripAnsi).join('\n');
  assert.ok(plain.includes('done'));
  assert.ok(plain.includes('exit 0'));
});
