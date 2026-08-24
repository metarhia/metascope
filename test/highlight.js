'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const highlight = require('../lib/render/highlight.js');
const { highlightLines, highlight: paintSource } = highlight;
const { stripAnsi } = require('../lib/wrap.js');

const FIXTURES = path.join(__dirname, 'fixtures');

const readFixture = (name) =>
  fs.readFileSync(path.join(FIXTURES, name), 'utf8');

const assertHighlighted = (lang, source, token) => {
  const painted = paintSource(lang, source);
  assert.ok(painted.includes('\x1b'), `${lang} should emit ANSI`);
  const plain = stripAnsi(painted);
  assert.ok(plain.includes(token), `${lang} should keep ${token}`);
  const lines = highlightLines(lang, source);
  assert.ok(Array.isArray(lines));
  assert.ok(lines.length >= 1);
};

test('highlight paints js, json, css, html, csv, bash', () => {
  assertHighlighted('js', readFixture('sample.js'), 'const');
  assertHighlighted('mjs', readFixture('sample.mjs'), 'answer');
  assertHighlighted('ts', readFixture('sample.ts'), 'interface');
  assertHighlighted('dts', readFixture('sample.d.ts'), 'declare');
  assertHighlighted('json', readFixture('sample.json'), 'metascope');
  assertHighlighted('css', readFixture('sample.css'), 'header');
  assertHighlighted('html', readFixture('sample.html'), 'Title');
  assertHighlighted('csv', readFixture('sample.csv'), 'Ada');
  assertHighlighted('txt', readFixture('sample.txt'), 'metarhia.com');
});

test('highlight bash keywords and unknown langs as text', () => {
  assertHighlighted('bash', 'echo "hi"\n', 'echo');
  const painted = paintSource('nope', 'plain line');
  assert.ok(stripAnsi(painted).includes('plain line'));
});
