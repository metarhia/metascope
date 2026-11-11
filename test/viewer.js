'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { Viewer } = require('../lib/viewer.js');
const { render } = require('../lib/render/index.js');
const { stripAnsi, visibleWidth } = require('../lib/wrap.js');

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
  assert.strictEqual(viewer.hitTestHover(pad), null);
  assert.strictEqual(viewer.fenceSource(block), fence);
});

test('copy button jitter on a small block is a control click', () => {
  const pragma = '\x27use strict\x27;';
  const viewer = viewerWith('js', `${pragma}\n`);
  const block = viewer.blocks[0];
  const col = block.copy.col0;
  const lineIndex = block.startLine + block.copy.row;
  const pos = { lineIndex, innerCol: col, viewCol: col };
  const dragged = {
    start: pos,
    last: { lineIndex, innerCol: col + 1, viewCol: col + 1 },
    selecting: true,
  };
  assert.deepStrictEqual(viewer.hitTestHover(pos), {
    blockId: block.id,
    kind: 'copy',
  });
  assert.strictEqual(viewer.isControlClick(dragged, dragged.last), true);
});

test('click on js init body copies the example fence', () => {
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
  const pos = { lineIndex: body, innerCol: 5, viewCol: 5 };
  assert.strictEqual(viewer.hitTestHover(pos), null);
  const block = viewer.blockAt(body);
  assert.ok(block);
  assert.strictEqual(viewer.fenceSource(block), fence);
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

test('line-number gutter has a grey background and keeps its width', () => {
  const viewer = viewerWith('md', 'one\ntwo\n', 40);
  viewer.showLines = true;
  const overlays = { play: new Map(), copy: new Map() };
  const row = viewer.paintContentLine(0, 36, 3, overlays);
  assert.ok(row.startsWith('\x1b[48;2;17;17;19m'));
  assert.ok(stripAnsi(row).startsWith('  1 one'));
});

test('f toggles a centered file path header that shifts mouse rows', () => {
  const viewer = viewerWith('md', 'one\ntwo\n', 40);
  viewer.filePath = path.join(path.sep, 'tmp', 'docs', 'note.md');
  const before = viewer.screenToDoc(10, 2);
  viewer.handleKey({ name: 'char', ch: 'f' }, () => {});
  assert.strictEqual(viewer.showHeader, true);
  assert.strictEqual(viewer.chromeHeight(), 1);
  assert.strictEqual(viewer.screenToDoc(10, 2), null);
  assert.deepStrictEqual(viewer.screenToDoc(10, 3), before);

  const header = viewer.buildHeader(30);
  const plain = stripAnsi(header);
  assert.strictEqual(visibleWidth(header), 30);
  assert.strictEqual(plain.trim(), '/tmp/docs/note.md');
  assert.ok(plain.startsWith('      /tmp'));
  assert.ok(header.startsWith('\x1b[48;2;44;44;48m'));
  assert.ok(header.includes('\x1b[38;2;255;255;255mnote.md'));

  const narrow = stripAnsi(viewer.buildHeader(12)).trim();
  assert.strictEqual(narrow, '…ocs/note.md');
  viewer.handleKey({ name: 'char', ch: 'f' }, () => {});
  assert.strictEqual(viewer.showHeader, false);
});

test('line numbers: render and paint widths agree after reflow', () => {
  // 12 source lines reflow into 6 rows: gutter digits differ (2 vs 1).
  const quote = ['one', 'two', 'three', 'four', 'five', 'six', 'seven']
    .concat(['eight', 'nine', 'ten'])
    .map((w) => `> ${w}`);
  const src = ['# Title', '', ...quote].join('\n');
  const viewer = new Viewer('note.md');
  viewer.source = src;
  viewer.lang = 'md';
  viewer.showLines = true;
  viewer.rebuild();
  const contentW = viewer.contentWidth();
  for (const line of viewer.lines) {
    const w = visibleWidth(line);
    assert.ok(w === 0 || w === contentW, `row width ${w} != ${contentW}`);
  }
});
