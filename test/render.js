'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { render } = require('../lib/render/index.js');
const { detectLang } = require('../lib/detect.js');
const { stripAnsi } = require('../lib/wrap.js');

const FIXTURES = path.join(__dirname, 'fixtures');

test('render markdown reflows prose and finds fences', () => {
  const src = fs.readFileSync(path.join(FIXTURES, 'sample.md'), 'utf8');
  const { lines, blocks, origins } = render('md', src, {
    width: 72,
    wrap: true,
  });
  assert.ok(lines.length > 0);
  assert.strictEqual(origins.length, lines.length);
  assert.strictEqual(blocks.length, 1);
  assert.strictEqual(blocks[0].lang, 'js');
});

test('render js uses a single file-0 code frame', () => {
  const src = 'const x = 1;\nconsole.log(x);\n';
  const { lines, blocks, prelude } = render('js', src, { width: 50 });
  assert.strictEqual(blocks.length, 1);
  assert.strictEqual(blocks[0].id, 'file-0');
  assert.strictEqual(blocks[0].lang, 'js');
  assert.ok(blocks[0].play);
  assert.ok(blocks[0].copy);
  assert.deepStrictEqual(prelude, {});
  const plain = lines.map(stripAnsi).join('\n');
  assert.ok(plain.includes('const x = 1'));
});

test('render appends a run panel when outputs has file-0', () => {
  const outputs = new Map([
    ['file-0', { ok: true, code: 0, text: 'ok\n', running: false }],
  ]);
  const { lines, blocks, origins } = render('js', '1;\n', {
    width: 40,
    outputs,
  });
  assert.ok(blocks[0].close);
  assert.strictEqual(origins.length, lines.length);
  const plain = lines.map(stripAnsi).join('\n');
  assert.ok(plain.includes('ok'));
  assert.ok(plain.includes('exit 0'));
});

test('render does not throw on fixture files', () => {
  const names = fs.readdirSync(FIXTURES);
  for (const name of names) {
    const full = path.join(FIXTURES, name);
    const src = fs.readFileSync(full, 'utf8');
    const lang = detectLang(full);
    const out = render(lang, src, { width: 60, wrap: true });
    assert.ok(out.lines.length > 0, name);
    assert.strictEqual(out.origins.length, out.lines.length, name);
    assert.ok(Array.isArray(out.blocks), name);
  }
});
