'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const theme = require('../lib/theme.js');
const { headingStyle, headingBg, paint, paintCode } = theme;
const { bandAnsi, screenLine, BG } = theme;
const { stripAnsi, visibleWidth } = require('../lib/wrap.js');

test('headingStyle and headingBg clamp to h1..h6', () => {
  assert.strictEqual(headingStyle(1), 'h1');
  assert.strictEqual(headingStyle(6), 'h6');
  assert.strictEqual(headingStyle(0), 'h1');
  assert.strictEqual(headingStyle(99), 'h6');
  assert.ok(headingBg(2).startsWith('48;2;'));
  assert.strictEqual(headingBg(3), BG.h3);
});

test('paint and paintCode wrap non-empty text', () => {
  assert.strictEqual(paint('plain', ''), '');
  const painted = paint('keyword', 'const');
  assert.ok(painted.includes('const'));
  assert.notStrictEqual(painted, 'const');
  const code = paintCode('keyword', 'const');
  assert.ok(code.includes('const'));
  assert.ok(code.includes('\x1b[38;2;'));
});

test('bandAnsi restores background after nested resets', () => {
  const inner = '\x1b[31mhi\x1b[0m';
  const band = bandAnsi(inner, BG.code, 10);
  assert.ok(band.includes(BG.code));
  assert.strictEqual(visibleWidth(stripAnsi(inner)), 2);
  assert.ok(band.includes('hi'));
});

test('screenLine pads on black screen background', () => {
  const line = screenLine('x', 8);
  assert.ok(line.includes('x'));
  assert.ok(line.includes(BG.screen));
});
