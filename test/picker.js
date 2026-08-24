'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { listEntries } = require('../lib/picker.js');

const FIXTURES = path.join(__dirname, 'fixtures');

test('listEntries prepends parent and lists supported files', async () => {
  const entries = await listEntries(FIXTURES);
  assert.ok(entries.length > 1);
  assert.strictEqual(entries[0].name, '..');
  assert.strictEqual(entries[0].isDir, true);
  const names = entries.map((entry) => entry.name);
  assert.ok(names.includes('sample.js'));
  assert.ok(names.includes('sample.md'));
  assert.ok(names.includes('sample.json'));
  const listed = names.filter((name) => name !== '..');
  assert.ok(!listed.some((name) => name.startsWith('.')));
});
