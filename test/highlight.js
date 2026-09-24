'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const highlight = require('../lib/render/highlight.js');
const { highlightLines, highlight: paintSource } = highlight;
const { paintCode } = require('../lib/theme.js');
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

test('highlight lisp forms, strings, comments, and numbers', () => {
  const q = '\x27';
  const source = [
    '; comment',
    '(defun factorial (n)',
    '  #| nested #| note |# stays |#',
    '  (if (<= n 1)',
    '      nil',
    '      (* n (factorial (- n 1)))))',
    '(format t "hello ~a" :name)',
    '#\\newline',
    '#xFF',
    '1/2',
    '(define pi 3.14)',
    '(define (square x)',
    '  (* x x))',
    '(defn ^String greet [name]',
    '  (println name))',
    'cl:car',
    'clojure.string/join',
    `#${q}foo`,
    `${q}(a ,@b)`,
    '',
  ].join('\n');
  const painted = paintSource('lisp', source);
  assert.strictEqual(stripAnsi(painted), source);
  assert.ok(painted.includes(paintCode('comment', '; comment')));
  assert.ok(painted.includes(paintCode('storage', 'defun')));
  assert.ok(painted.includes(paintCode('function', 'factorial')));
  assert.ok(painted.includes(paintCode('operator', '<=')));
  assert.ok(painted.includes(paintCode('literal', 'nil')));
  assert.ok(painted.includes(paintCode('string', '"hello ~a"')));
  assert.ok(painted.includes(paintCode('constant', ':name')));
  assert.ok(painted.includes(paintCode('literal', '#\\newline')));
  assert.ok(painted.includes(paintCode('number', '#xFF')));
  assert.ok(painted.includes(paintCode('number', '1/2')));
  assert.ok(painted.includes(paintCode('variable', 'pi')));
  assert.ok(painted.includes(paintCode('function', 'square')));
  assert.ok(painted.includes(paintCode('type', 'String')));
  assert.ok(painted.includes(paintCode('function', 'greet')));
  assert.ok(painted.includes(paintCode('function', 'println')));
  assert.ok(painted.includes(paintCode('type', 'cl')));
  assert.ok(painted.includes(paintCode('function', 'car')));
  assert.ok(painted.includes(paintCode('type', 'clojure.string')));
  assert.ok(painted.includes(paintCode('variable', 'join')));
  assert.ok(painted.includes(paintCode('variable', 'n')));
  assert.ok(painted.includes(paintCode('operator', '*')));
  assert.ok(painted.includes(paintCode('literal', 't')));
  assert.ok(painted.includes(paintCode('operator', `#${q}`)));
  assert.ok(painted.includes(paintCode('operator', q)));
  assert.ok(painted.includes(paintCode('operator', ',@')));
  const comment = '#| nested #| note |# stays |#';
  assert.ok(painted.includes(paintCode('comment', comment)));
});

test('highlight lisp dialects and unclosed tokens', () => {
  const source = '(defun id (x) x)\n';
  for (const tag of ['lisp', 'clojure', 'clj', 'racket']) {
    const painted = paintSource(tag, source);
    assert.strictEqual(stripAnsi(painted), source, tag);
    assert.ok(painted.includes(paintCode('storage', 'defun')), tag);
  }
  const broken = '#| oops\n(defun "hi';
  assert.strictEqual(stripAnsi(paintSource('lisp', broken)), broken);
  const script = '#!/usr/bin/env bb\n(println "ok")\n';
  const shebang = paintSource('clojure', script);
  assert.strictEqual(stripAnsi(shebang), script);
  assert.ok(shebang.includes(paintCode('comment', '#!/usr/bin/env bb')));
  assert.ok(shebang.includes(paintCode('function', 'println')));
});

test('highlight bash keywords and unknown langs as text', () => {
  assertHighlighted('bash', 'echo "hi"\n', 'echo');
  const painted = paintSource('nope', 'plain line');
  assert.ok(stripAnsi(painted).includes('plain line'));
});
