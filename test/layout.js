'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const layout = require('../lib/layout.js');
const { innerSize, frameLine, emptyLine, withMargins } = layout;
const { CLEAR_EOL, MARGIN_X, MARGIN_Y_TOP } = layout;
const { MARGIN_Y_BOTTOM } = layout;

test('innerSize subtracts frame margins', (t) => {
  const prevCols = process.stdout.columns;
  const prevRows = process.stdout.rows;
  t.after(() => {
    process.stdout.columns = prevCols;
    process.stdout.rows = prevRows;
  });
  process.stdout.columns = 80;
  process.stdout.rows = 24;
  const size = innerSize();
  assert.strictEqual(size.cols, 80);
  assert.strictEqual(size.rows, 24);
  assert.strictEqual(size.innerCols, 80 - MARGIN_X * 2);
  const marginY = MARGIN_Y_TOP + MARGIN_Y_BOTTOM;
  assert.strictEqual(size.innerRows, 24 - marginY);
});

test('frameLine pads and appends CLEAR_EOL', () => {
  const line = frameLine('hi', 40);
  assert.ok(line.endsWith(CLEAR_EOL));
  assert.ok(line.includes('hi'));
});

test('emptyLine is a blank framed row', () => {
  const line = emptyLine(20);
  assert.ok(line.endsWith(CLEAR_EOL));
});

test('withMargins paints top gap and fills remaining rows', (t) => {
  const prevCols = process.stdout.columns;
  const prevRows = process.stdout.rows;
  t.after(() => {
    process.stdout.columns = prevCols;
    process.stdout.rows = prevRows;
  });
  process.stdout.columns = 40;
  process.stdout.rows = 10;
  const frame = withMargins(['a', 'b'], 40, 10);
  const painted = 10 - MARGIN_Y_BOTTOM;
  assert.strictEqual(frame.length, painted);
  assert.ok(frame[1].includes('a'));
  assert.ok(frame[2].includes('b'));
});
