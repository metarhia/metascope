'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { inline, renderMarkdown } = require('../lib/render/markdown.js');
const { stripAnsi, hrefAtCol } = require('../lib/wrap.js');

const FIXTURES = path.join(__dirname, 'fixtures');

test('inline paints emphasis, code, and links', () => {
  const text = '**bold** _italic_ `code` [n](https://x)';
  const painted = inline(text);
  const plain = stripAnsi(painted);
  assert.ok(plain.includes('bold'));
  assert.ok(plain.includes('italic'));
  assert.ok(plain.includes('code'));
  assert.ok(plain.includes('n'));
  assert.ok(!plain.includes('https://x'));
  assert.ok(painted.includes('\x1b]8;;https://x'));
  const linkCol = stripAnsi(painted).indexOf('n');
  assert.strictEqual(hrefAtCol(painted, linkCol), 'https://x');
});

test('renderMarkdown extracts fences, lists, quotes, and tables', () => {
  const src = fs.readFileSync(path.join(FIXTURES, 'sample.md'), 'utf8');
  const { lines, blocks, prelude } = renderMarkdown(src, { width: 80 });
  assert.ok(lines.length > 0);
  assert.strictEqual(blocks.length, 1);
  assert.strictEqual(blocks[0].lang, 'js');
  assert.ok(blocks[0].source.includes('const x = 1'));
  assert.ok(blocks[0].play);
  assert.ok(blocks[0].copy);
  assert.deepStrictEqual(prelude, {});
  const plain = lines.map(stripAnsi).join('\n');
  assert.ok(plain.includes('Hello metascope'));
  assert.ok(plain.includes('item one'));
  assert.ok(plain.includes('link'));
  assert.ok(!plain.includes('https://metarhia.com'));
});

test('renderMarkdown records js init as shared prelude', () => {
  const src = [
    '```js init',
    `'use strict';`,
    'const DEMO = 1;',
    '```',
    '',
    '```js',
    'console.log(DEMO);',
    '```',
  ].join('\n');
  const { blocks, prelude } = renderMarkdown(src, { width: 60 });
  assert.strictEqual(blocks.length, 2);
  assert.ok(prelude.js.includes('const DEMO = 1'));
  assert.strictEqual(prelude.mjs, prelude.js);
  assert.strictEqual(prelude.ts, prelude.js);
  assert.strictEqual(blocks[0].play, null);
  assert.ok(blocks[1].play);
});

test('renderMarkdown uses file heading as run label', () => {
  const src = ['## demo.js', '', '```js', '1;', '```'].join('\n');
  const { blocks } = renderMarkdown(src, { width: 40 });
  assert.strictEqual(blocks[0].label, 'demo.js');
});
