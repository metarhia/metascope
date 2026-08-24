'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const stack = require('../lib/stack.js');
const { findPathRoots, isRunTemp, shortPath } = stack;
const { formatStackText } = stack;

test('isRunTemp detects generated snippet files', () => {
  assert.strictEqual(isRunTemp('.metascope-run-1.js'), true);
  const abs = path.join('/tmp', '.metascope-run-abc.ts');
  assert.strictEqual(isRunTemp(abs), true);
  assert.strictEqual(isRunTemp('lib/wrap.js'), false);
});

test('findPathRoots includes cwd and package root', () => {
  const roots = findPathRoots(process.cwd());
  assert.ok(roots.includes(path.resolve(process.cwd())));
  assert.ok(roots.some((root) => root.length > 0));
});

test('shortPath shortens under roots and labels temp runs', () => {
  const cwd = process.cwd();
  const file = path.join(cwd, 'lib', 'wrap.js');
  assert.strictEqual(shortPath(file, [cwd]), 'lib/wrap.js');
  const temp = path.join(cwd, '.metascope-run-x.js');
  assert.strictEqual(shortPath(temp, [cwd], 'demo.js'), 'demo.js');
  assert.strictEqual(shortPath(cwd, [cwd]), '.');
});

test('formatStackText drops internals and adjusts prelude', () => {
  const cwd = process.cwd();
  const temp = path.join(cwd, '.metascope-run-abc.js');
  const text = [
    'Error: fail',
    `    at Object.<anonymous> (${temp}:10:1)`,
    '    at Module._compile (node:internal/modules/cjs/loader:1:1)',
    `    at foo (${temp}:12:3)`,
  ].join('\n');
  const opts = { label: 'demo.js', preludeLines: 3 };
  const out = formatStackText(text, cwd, opts);
  assert.ok(out.includes('Error: fail'));
  assert.ok(out.includes('demo.js line:7:1'));
  assert.ok(out.includes('foo (demo.js line:9:3)'));
  assert.ok(!out.includes('node:internal'));
});

test('formatStackText leaves plain messages unchanged', () => {
  assert.strictEqual(formatStackText('boom', process.cwd()), 'boom');
});
