'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { decodeKey, isIncompleteSequence } = require('../lib/keys.js');

const ESC = String.fromCharCode(0x1b);

test('decodeKey maps simple control keys', () => {
  assert.deepStrictEqual(decodeKey(ESC), { name: 'escape' });
  assert.deepStrictEqual(decodeKey('\x03'), { name: 'ctrl-c' });
  assert.deepStrictEqual(decodeKey('\x04'), { name: 'ctrl-d' });
  assert.deepStrictEqual(decodeKey('\x15'), { name: 'ctrl-u' });
  assert.deepStrictEqual(decodeKey('\r'), { name: 'enter' });
  assert.deepStrictEqual(decodeKey('\n'), { name: 'enter' });
  assert.deepStrictEqual(decodeKey('\x7f'), { name: 'backspace' });
  assert.deepStrictEqual(decodeKey('\t'), { name: 'tab' });
  assert.deepStrictEqual(decodeKey(' '), { name: 'space', ch: ' ' });
});

test('decodeKey maps CSI and SS3 arrows', () => {
  assert.deepStrictEqual(decodeKey(`${ESC}[A`), { name: 'up' });
  assert.deepStrictEqual(decodeKey(`${ESC}[B`), { name: 'down' });
  assert.deepStrictEqual(decodeKey(`${ESC}[C`), { name: 'right' });
  assert.deepStrictEqual(decodeKey(`${ESC}[D`), { name: 'left' });
  assert.deepStrictEqual(decodeKey(`${ESC}[H`), { name: 'home' });
  assert.deepStrictEqual(decodeKey(`${ESC}[F`), { name: 'end' });
  assert.deepStrictEqual(decodeKey(`${ESC}[5~`), { name: 'pageup' });
  assert.deepStrictEqual(decodeKey(`${ESC}[6~`), { name: 'pagedown' });
  assert.deepStrictEqual(decodeKey(`${ESC}OA`), { name: 'up' });
});

test('decodeKey parses SGR mouse events', () => {
  const press = decodeKey(`${ESC}[<0;10;5M`);
  assert.strictEqual(press.name, 'mouse');
  assert.strictEqual(press.button, 0);
  assert.strictEqual(press.col, 10);
  assert.strictEqual(press.row, 5);
  assert.strictEqual(press.release, false);
  const release = decodeKey(`${ESC}[<0;10;5m`);
  assert.strictEqual(release.release, true);
});

test('decodeKey maps printable chars and buffers', () => {
  assert.deepStrictEqual(decodeKey('q'), { name: 'char', ch: 'q' });
  assert.deepStrictEqual(decodeKey(Buffer.from('k')), {
    name: 'char',
    ch: 'k',
  });
  const unknown = decodeKey(`${ESC}[999Z`);
  assert.strictEqual(unknown.name, 'unknown');
});

test('isIncompleteSequence waits for CSI and mouse tails', () => {
  assert.strictEqual(isIncompleteSequence('a'), false);
  assert.strictEqual(isIncompleteSequence(ESC), true);
  assert.strictEqual(isIncompleteSequence(`${ESC}[`), true);
  assert.strictEqual(isIncompleteSequence(`${ESC}[<0;1;2`), true);
  assert.strictEqual(isIncompleteSequence(`${ESC}[<0;1;2M`), false);
  assert.strictEqual(isIncompleteSequence(`${ESC}[A`), false);
  assert.strictEqual(isIncompleteSequence(`${ESC}O`), true);
  assert.strictEqual(isIncompleteSequence(`${ESC}OA`), false);
});
