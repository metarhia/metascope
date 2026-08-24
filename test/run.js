'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { isRunnable, runSnippetStream, RUNNABLE } = require('../lib/run.js');

test('isRunnable covers supported snippet languages', () => {
  assert.deepStrictEqual(RUNNABLE, ['js', 'mjs', 'ts', 'bash']);
  assert.strictEqual(isRunnable('js'), true);
  assert.strictEqual(isRunnable('javascript'), true);
  assert.strictEqual(isRunnable('mjs'), true);
  assert.strictEqual(isRunnable('ts'), true);
  assert.strictEqual(isRunnable('bash'), true);
  assert.strictEqual(isRunnable('json'), false);
  assert.strictEqual(isRunnable('md'), false);
});

test('runSnippetStream rejects non-runnable languages', async () => {
  const { promise } = runSnippetStream('json', '{"a":1}');
  const result = await promise;
  assert.strictEqual(result.ok, false);
  assert.ok(result.stderr.includes('Cannot run language'));
});

test('runSnippetStream executes a js snippet', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metascope-'));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  const source = `console.log('hello-metascope');\n`;
  const { promise } = runSnippetStream('js', source, { cwd: dir });
  const result = await promise;
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.code, 0);
  assert.ok(result.stdout.includes('hello-metascope'));
});

test('runSnippetStream captures js failure', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metascope-'));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  const source = `console.error('nope'); process.exit(2);\n`;
  const { promise } = runSnippetStream('js', source, { cwd: dir });
  const result = await promise;
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 2);
  assert.ok(result.stderr.includes('nope'));
});
