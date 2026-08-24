'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { copyText } = require('../lib/clipboard.js');

test('copyText rejects empty payloads', () => {
  assert.strictEqual(copyText(''), false);
  assert.strictEqual(copyText(null), false);
  assert.strictEqual(copyText(undefined), false);
});
