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
  const { lines, blocks, prelude, origins } = renderMarkdown(src, {
    width: 80,
  });
  assert.ok(lines.length > 0);
  assert.strictEqual(origins.length, lines.length);
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

test('orphan pipe lines that are not tables still render', () => {
  const src = [
    'Qt.WindowType.Window',
    '            | Qt.WindowType.FramelessWindowHint',
    '            | Qt.WindowType.WindowStaysOnTopHint',
    '',
  ].join('\n');
  const { lines } = renderMarkdown(src, { width: 80 });
  assert.ok(lines.length > 0);
  const plain = lines.map(stripAnsi).join('\n');
  assert.ok(plain.includes('FramelessWindowHint'));
  assert.ok(plain.includes('WindowStaysOnTopHint'));
});

test('long nested list items keep indent with hanging wrap', () => {
  const src = [
    '- Data access patterns:',
    '  - Transaction Script - a procedural pattern where each business ' +
      'operation is implemented as a function',
    '- Next top level',
  ].join('\n');
  const { lines, origins } = renderMarkdown(src, { width: 40 });
  const plain = lines.map(stripAnsi);
  assert.strictEqual(plain[0], '• Data access patterns:');
  assert.ok(plain[1].startsWith('  • Transaction Script'));
  const last = plain.indexOf('• Next top level');
  assert.ok(last > 2);
  for (const row of plain.slice(2, last)) {
    assert.ok(row.startsWith('    '), `continuation not hung: ${row}`);
    assert.ok(row.length <= 40);
  }
  assert.deepStrictEqual(origins[2], { first: 1, last: 1 });
});

test('list item joins indented source continuation lines', () => {
  const src = [
    '1. first line',
    '   second line',
    '   - nested',
    '     more nested',
    '',
    'Para',
  ].join('\n');
  const { lines, origins } = renderMarkdown(src, { width: 80 });
  const plain = lines.map(stripAnsi);
  assert.strictEqual(plain[0], '1. first line second line');
  assert.strictEqual(plain[1], '   • nested more nested');
  assert.strictEqual(plain[2], '');
  assert.strictEqual(plain[3], 'Para');
  assert.deepStrictEqual(origins[0], { first: 0, last: 1 });
  assert.deepStrictEqual(origins[1], { first: 2, last: 3 });
});

test('quote lines reflow into paragraphs like plain text', () => {
  const src = ['> one two', '> three four', '>', '> - item', '> five'].join(
    '\n',
  );
  const { lines, origins } = renderMarkdown(src, { width: 80 });
  const rows = lines.map((l) => stripAnsi(l).trim()).filter((l) => l);
  assert.deepStrictEqual(rows, ['│ one two three four', '│', '│ - item five']);
  const at = (text) =>
    origins[lines.findIndex((l) => stripAnsi(l).includes(text))];
  assert.deepStrictEqual(at('one two'), { first: 0, last: 1 });
  assert.deepStrictEqual(at('- item'), { first: 3, last: 4 });
});

test('VS16 emoji get a spacer in text but fences keep their source', () => {
  const src = ['⚠️ ABC', '', '```js', '// ⚠️ x', '```'].join('\n');
  const { lines, blocks } = renderMarkdown(src, { width: 40 });
  assert.ok(lines.some((l) => stripAnsi(l).includes('⚠️  ABC')));
  assert.strictEqual(blocks[0].source, '// ⚠️ x');
});

test('inline styles work in quotes, headings and table headers', () => {
  const src = [
    '# Title with **bold** and `code`',
    '',
    '> quote with **bold**, _italic_ and [link](https://x.y)',
    '',
    '| **Head** | plain |',
    '|---|---|',
    '| a | b |',
  ].join('\n');
  const { lines } = renderMarkdown(src, { width: 80 });
  const find = (s) => lines.find((l) => stripAnsi(l).includes(s));
  // band() re-opens its bg after each reset; compare spans without them.
  const ESC = String.fromCharCode(0x1b);
  const resets = new RegExp(`${ESC}\\[(?:0|48;2;[\\d;]+)m`, 'g');
  const bare = (s) => s.replace(resets, '');
  const has = (line, md) => bare(line).includes(bare(inline(md)));
  const heading = find('Title with');
  const quote = find('quote with');
  const head = find('Head');
  assert.ok(has(heading, '**bold**'));
  assert.ok(has(heading, '`code`'));
  assert.ok(stripAnsi(heading).includes('Title with bold and  code '));
  assert.ok(has(quote, '**bold**'));
  assert.ok(has(quote, '_italic_'));
  assert.ok(quote.includes('\x1b]8;;https://x.y\x07'));
  assert.ok(stripAnsi(quote).includes('quote with bold, italic and link'));
  assert.ok(has(head, '**Head**'));
});
