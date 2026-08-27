'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { copyText, textFromOrigins } = require('../lib/clipboard.js');

test('copyText rejects empty payloads', () => {
  assert.strictEqual(copyText(''), false);
  assert.strictEqual(copyText(null), false);
  assert.strictEqual(copyText(undefined), false);
});

test('textFromOrigins slices source lines covered by the selection', () => {
  const source = '# Title\n\npara\n';
  const origins = [
    { first: 0, last: 0 },
    { first: 1, last: 1 },
    { first: 2, last: 2 },
  ];
  assert.strictEqual(textFromOrigins(source, origins, 0, 0), '# Title');
  assert.strictEqual(textFromOrigins(source, origins, 2, 2), 'para');
  assert.strictEqual(textFromOrigins(source, origins, 0, 2), '# Title\n\npara');
});

test('textFromOrigins skips chrome lines without a source origin', () => {
  const source = 'const x = 1;\n';
  const origins = [{ first: 0, last: 0 }, null, { first: 0, last: 0 }];
  assert.strictEqual(textFromOrigins(source, origins, 1, 1), '');
  assert.strictEqual(textFromOrigins(source, origins, 0, 2), 'const x = 1;');
});
