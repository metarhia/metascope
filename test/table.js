'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const table = require('../lib/render/table.js');
const { isTableSepLine, looksLikeTableRow, startsTable } = table;
const { frameTable, consumeTable } = table;
const { stripAnsi } = require('../lib/wrap.js');

test('isTableSepLine accepts markdown alignment rows', () => {
  assert.strictEqual(isTableSepLine('| --- | :---: | ---: |'), true);
  assert.strictEqual(isTableSepLine('| --- |'), true);
  assert.strictEqual(isTableSepLine('| abc | def |'), false);
  assert.strictEqual(isTableSepLine('no pipes'), false);
});

test('looksLikeTableRow rejects lists that happen to have pipes', () => {
  assert.strictEqual(looksLikeTableRow('| a | b |'), true);
  assert.strictEqual(looksLikeTableRow('- item | x'), false);
  assert.strictEqual(looksLikeTableRow('1. item | x'), false);
});

test('startsTable requires a separator on the next line', () => {
  const rows = ['| A | B |', '| --- | --- |', '| 1 | 2 |'];
  assert.strictEqual(startsTable(rows, 0), true);
  assert.strictEqual(startsTable(['| not a table'], 0), false);
  const flags = ['            | Qt.WindowType.FramelessWindowHint'];
  assert.strictEqual(startsTable(flags, 0), false);
});

test('frameTable draws a box with header text', () => {
  const lines = frameTable(['Name', 'N'], ['left', 'right'], [['Ada', '1']], {
    width: 40,
  });
  const plain = lines.map(stripAnsi).join('\n');
  assert.ok(plain.includes('Name'));
  assert.ok(plain.includes('Ada'));
  assert.ok(plain.includes('┌'));
  assert.ok(plain.includes('└'));
});

test('consumeTable reads header, sep, and body', () => {
  const src = ['| A | B |', '| --- | --- |', '| 1 | 2 |', '', 'after'];
  const identity = (cell) => cell;
  const taken = consumeTable(src, 0, identity, 40);
  assert.ok(taken);
  assert.strictEqual(taken.next, 3);
  const plain = taken.lines.map(stripAnsi).join('\n');
  assert.ok(plain.includes('A'));
  assert.ok(plain.includes('1'));
});
