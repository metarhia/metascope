'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { Viewer } = require('../lib/viewer.js');
const { render } = require('../lib/render/index.js');
const { stripAnsi } = require('../lib/wrap.js');

const FIXTURES = path.join(__dirname, 'fixtures');

const viewerWith = (lang, source, width = 80, outputs = null) => {
  const result = render(lang, source, { width, wrap: true, outputs });
  const viewer = new Viewer('copy.js');
  viewer.lines = result.lines;
  viewer.origins = result.origins;
  viewer.blocks = result.blocks;
  viewer.source = source;
  viewer.lang = lang;
  return viewer;
};

const lineWith = (lines, snippet) =>
  lines.findIndex((line) => stripAnsi(line).includes(snippet));

const selectLines = (viewer, from, to = from) => {
  viewer.selection = {
    anchor: { lineIndex: from, innerCol: 0 },
    focus: { lineIndex: to, innerCol: 70 },
  };
  return viewer.getSelectedText();
};

test('drag on the pad of a short js line copies the source line', () => {
  const pragma = '\x27use strict\x27;';
  const viewer = viewerWith('js', `${pragma}\n`);
  const body = lineWith(viewer.lines, 'use strict');
  assert.ok(body >= 0);
  const screen = stripAnsi(viewer.lines[body]);
  assert.ok(screen.length > pragma.length);
  const payload = selectLines(viewer, body);
  assert.strictEqual(payload, pragma);
  assert.ok(!payload.includes('⧉'));
  assert.ok(!payload.includes('▶'));
});

test('drag on a small block pad copies the snippet source', () => {
  const pragma = '\x27use strict\x27;';
  const viewer = viewerWith('js', `${pragma}\n`);
  const block = viewer.blocks[0];
  const payload = selectLines(viewer, block.startLine);
  assert.ok(payload.includes('use strict'));
  assert.ok(!payload.includes('⧉'));
});

test('js init fence drag copies the fence including init', () => {
  const fence = [
    '```js init',
    '\x27use strict\x27;',
    '',
    '// Shared imports / helpers for examples below',
    'const assert = require(\x27node:assert\x27);',
    'const DEMO_NAME = \x27Metarhia\x27;',
    '```',
  ].join('\n');
  const viewer = viewerWith('md', `${fence}\n`);
  const body = lineWith(viewer.lines, 'use strict');
  assert.ok(body >= 0);
  assert.strictEqual(selectLines(viewer, body), fence);
  const block = viewer.blocks[0];
  assert.strictEqual(block.play, null);
  const pad = { lineIndex: block.startLine, innerCol: 10, viewCol: 10 };
  assert.deepStrictEqual(viewer.hitTestHover(pad), {
    blockId: block.id,
    kind: 'copy',
  });
});

test('copy button jitter on a small block is a control click', () => {
  const pragma = '\x27use strict\x27;';
  const viewer = viewerWith('js', `${pragma}\n`);
  const block = viewer.blocks[0];
  const lineIndex = block.startLine + block.copy.row;
  const pos = { lineIndex, innerCol: 10, viewCol: 10 };
  const dragged = {
    start: pos,
    last: { lineIndex, innerCol: 11, viewCol: 11 },
    selecting: true,
  };
  assert.deepStrictEqual(viewer.hitTestHover(pos), {
    blockId: block.id,
    kind: 'copy',
  });
  assert.strictEqual(viewer.isControlClick(dragged, dragged.last), true);
});

test('selecting a markdown heading copies the hashes', () => {
  const src = fs.readFileSync(path.join(FIXTURES, 'sample.md'), 'utf8');
  const viewer = viewerWith('md', src);
  const heading = lineWith(viewer.lines, 'Hello metascope');
  assert.ok(heading >= 0);
  assert.strictEqual(selectLines(viewer, heading), '# Hello metascope');
});

test('selecting a markdown fence copies the fence markers', () => {
  const fence = ['```js', 'const x = 1;', 'console.log(x);', '```'].join('\n');
  const viewer = viewerWith('md', `${fence}\n`);
  const body = lineWith(viewer.lines, 'const x = 1');
  assert.ok(body >= 0);
  const screen = stripAnsi(viewer.lines[body]);
  assert.ok(!screen.includes('```'));
  assert.ok(screen.includes('⧉') || screen.trimStart().startsWith('const'));
  assert.strictEqual(selectLines(viewer, body), fence);
  const block = viewer.blocks[0];
  assert.strictEqual(selectLines(viewer, block.startLine), fence);
});

test('selecting a quote copies the source marker, not the rule', () => {
  const src = '> quote line\n';
  const viewer = viewerWith('md', src);
  const row = lineWith(viewer.lines, 'quote line');
  assert.ok(row >= 0);
  assert.ok(stripAnsi(viewer.lines[row]).includes('│'));
  assert.strictEqual(selectLines(viewer, row), '> quote line');
});

test('selecting a list item copies the markdown bullet', () => {
  const src = '- item one\n';
  const viewer = viewerWith('md', src);
  const row = lineWith(viewer.lines, 'item one');
  assert.ok(row >= 0);
  assert.ok(stripAnsi(viewer.lines[row]).includes('•'));
  assert.strictEqual(selectLines(viewer, row), '- item one');
});

test('selecting a paragraph copies markdown markup', () => {
  const src =
    'This is **bold** and _italic_ with a [link](https://metarhia.com).\n';
  const viewer = viewerWith('md', src);
  const row = lineWith(viewer.lines, 'bold');
  assert.ok(row >= 0);
  const screen = stripAnsi(viewer.lines[row]);
  assert.ok(screen.includes('bold'));
  assert.ok(!screen.includes('**'));
  assert.ok(!screen.includes('https://metarhia.com'));
  assert.strictEqual(selectLines(viewer, row), src.trim());
});

test('selecting a table copies markdown, not the box', () => {
  const src = ['| A | B |', '| --- | --- |', '| 1 | 2 |'].join('\n');
  const viewer = viewerWith('md', `${src}\n`);
  const row = lineWith(viewer.lines, 'A');
  assert.ok(row >= 0);
  const screen = stripAnsi(viewer.lines[row]);
  assert.ok(screen.includes('┌') || screen.includes('│'));
  const payload = selectLines(viewer, row);
  assert.strictEqual(payload, src);
  assert.ok(!payload.includes('┌'));
});

test('selecting a rule copies the source hr', () => {
  const src = '---\n';
  const viewer = viewerWith('md', src);
  assert.ok(viewer.lines.length > 0);
  assert.strictEqual(selectLines(viewer, 0), '---');
});

test('selecting run output does not copy screen chrome', () => {
  const outputs = new Map([
    ['file-0', { ok: true, code: 0, text: 'ok\n', running: false }],
  ]);
  const viewer = viewerWith('js', '1;\n', 40, outputs);
  const exit = lineWith(viewer.lines, 'exit 0');
  assert.ok(exit >= 0);
  assert.strictEqual(selectLines(viewer, exit), '');
});
