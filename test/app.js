'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { resolveTarget } = require('../lib/app.js');

test('resolveTarget treats help flags as help', () => {
  assert.deepStrictEqual(resolveTarget(['-h']), { help: true });
  assert.deepStrictEqual(resolveTarget(['--help']), { help: true });
  assert.deepStrictEqual(resolveTarget(['file.js', '-h']), { help: true });
});

test('resolveTarget defaults to cwd', () => {
  const resolved = resolveTarget([]);
  assert.strictEqual(resolved.path, path.resolve(process.cwd()));
});

test('resolveTarget resolves the first path argument', () => {
  const resolved = resolveTarget(['lib/wrap.js']);
  assert.strictEqual(resolved.path, path.resolve('lib/wrap.js'));
});

test('resolveTarget drops less +LINE and unknown flags', () => {
  const resolved = resolveTarget(['+12', '--flag', 'README.md']);
  assert.strictEqual(resolved.path, path.resolve('README.md'));
});
