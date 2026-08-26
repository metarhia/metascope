'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const wrap = require('../lib/wrap.js');
const { asText, stripAnsi, visibleWidth } = wrap;
const { wrapLine, wrapLines, wrapCodeLine } = wrap;
const { padEndVisible, sliceVisible, hrefAtCol } = wrap;

test('asText coerces unknown values', () => {
  assert.strictEqual(asText('ok'), 'ok');
  assert.strictEqual(asText(''), '');
  assert.strictEqual(asText(null), '');
  assert.strictEqual(asText(undefined), '');
  assert.strictEqual(asText(0), '0');
  assert.strictEqual(asText(42), '42');
});

test('stripAnsi removes SGR and OSC sequences', () => {
  const painted = '\x1b[32mhi\x1b[0m';
  assert.strictEqual(stripAnsi(painted), 'hi');
  assert.strictEqual(stripAnsi('plain'), 'plain');
  assert.strictEqual(stripAnsi(null), '');
  const link = '\x1b]8;;https://x\x07click\x1b]8;;\x07';
  assert.strictEqual(stripAnsi(link), 'click');
  assert.strictEqual(visibleWidth(link), 5);
});

test('visibleWidth counts grapheme cells not UTF-16 units', () => {
  assert.strictEqual(visibleWidth('abc'), 3);
  assert.strictEqual(visibleWidth('\x1b[31mabc\x1b[0m'), 3);
  assert.strictEqual(visibleWidth('👍'), 1);
  assert.strictEqual(visibleWidth(''), 0);
});

test('wrapLine splits on spaces and keeps short lines', () => {
  assert.deepStrictEqual(wrapLine('hello', 10), ['hello']);
  assert.deepStrictEqual(wrapLine('hello world foo', 5), [
    'hello',
    'world',
    'foo',
  ]);
  assert.deepStrictEqual(wrapLine('hello', 0), ['hello']);
});

test('wrapLine preserves ANSI across a wrap', () => {
  const painted = '\x1b[32mhello world\x1b[0m';
  const rows = wrapLine(painted, 5);
  assert.ok(rows.length >= 2);
  assert.ok(rows[0].includes('\x1b'));
  assert.strictEqual(stripAnsi(rows[0]), 'hello');
  assert.strictEqual(stripAnsi(rows[1]), 'world');
});

test('wrapLines concatenates wrapped rows', () => {
  const rows = wrapLines(['ab cd', 'ef'], 2);
  assert.deepStrictEqual(rows, ['ab', 'cd', 'ef']);
});

test('wrapCodeLine breaks at punctuation not mid-ident', () => {
  const line = 'foo(bar, baz, qux, waldo);';
  const rows = wrapCodeLine(line, 14);
  assert.ok(rows.length > 1);
  const joined = rows.map(stripAnsi).join('');
  assert.ok(joined.includes('foo'));
  assert.ok(joined.includes('waldo'));
});

test('padEndVisible and sliceVisible respect ANSI width', () => {
  const painted = '\x1b[36mab\x1b[0m';
  const padded = padEndVisible(painted, 5);
  assert.strictEqual(visibleWidth(padded), 5);
  const sliced = sliceVisible(padded, 0, 2);
  assert.strictEqual(stripAnsi(sliced), 'ab');
});

test('hrefAtCol finds OSC 8 link columns', () => {
  const open = '\x1b]8;;https://x\x07';
  const close = '\x1b]8;;\x07';
  const line = `ab${open}cd${close}e`;
  assert.strictEqual(hrefAtCol(line, 0), null);
  assert.strictEqual(hrefAtCol(line, 1), null);
  assert.strictEqual(hrefAtCol(line, 2), 'https://x');
  assert.strictEqual(hrefAtCol(line, 3), 'https://x');
  assert.strictEqual(hrefAtCol(line, 4), null);
  assert.strictEqual(hrefAtCol(line, 99), null);
});

test('wrapLine keeps OSC 8 href on wrapped rows', () => {
  const painted = '\x1b]8;;https://x\x07hello world\x1b]8;;\x07';
  const rows = wrapLine(painted, 5);
  assert.ok(rows.length >= 2);
  assert.strictEqual(hrefAtCol(rows[0], 0), 'https://x');
  assert.strictEqual(hrefAtCol(rows[1], 0), 'https://x');
});
