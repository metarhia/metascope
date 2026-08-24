'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const catalog = require('../lib/catalog.js');
const { isInitFile, listCatalogFiles } = catalog;
const { buildCatalogMarkdown } = catalog;

test('isInitFile matches shared prelude names', () => {
  assert.strictEqual(isInitFile('init.js'), true);
  assert.strictEqual(isInitFile('INIT.mjs'), true);
  assert.strictEqual(isInitFile('init.ts'), true);
  assert.strictEqual(isInitFile('init.cjs'), true);
  assert.strictEqual(isInitFile('app.js'), false);
  assert.strictEqual(isInitFile(''), false);
});

test('listCatalogFiles orders init then code then markdown', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metascope-'));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  await fs.writeFile(path.join(dir, 'z.js'), 'console.log(1);\n');
  await fs.writeFile(path.join(dir, 'a.md'), '# hi\n');
  await fs.writeFile(path.join(dir, 'init.js'), `'use strict';\n`);
  await fs.writeFile(path.join(dir, 'skip.json'), '{}\n');
  await fs.mkdir(path.join(dir, 'node_modules'));
  const files = await listCatalogFiles(dir);
  assert.strictEqual(files[0].name, 'init.js');
  assert.strictEqual(files[0].init, true);
  const names = files.map((file) => file.name);
  assert.ok(names.includes('z.js'));
  assert.ok(names.includes('a.md'));
  assert.ok(!names.includes('skip.json'));
  const mdIndex = names.indexOf('a.md');
  const jsIndex = names.indexOf('z.js');
  assert.ok(mdIndex > jsIndex);
});

test('buildCatalogMarkdown fences code and inlines markdown', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metascope-'));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  await fs.writeFile(path.join(dir, 'demo.js'), 'console.log(1);\n');
  const md = await buildCatalogMarkdown(dir);
  assert.ok(md.includes('# '));
  assert.ok(md.includes('```js'));
  assert.ok(md.includes('console.log(1);'));
});

test('buildCatalogMarkdown empty directory note', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metascope-'));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  const md = await buildCatalogMarkdown(dir);
  assert.ok(md.includes('No code examples'));
});
