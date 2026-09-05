'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const detect = require('../lib/detect.js');
const { detectLang, mapLang, isJsLang } = detect;
const { langLabel, isSupportedPath, isProseBasename } = detect;

test('mapLang aliases fence tags and extensions', () => {
  assert.strictEqual(mapLang('JavaScript'), 'js');
  assert.strictEqual(mapLang('mjs'), 'mjs');
  assert.strictEqual(mapLang('cjs'), 'js');
  assert.strictEqual(mapLang('typescript'), 'ts');
  assert.strictEqual(mapLang('htm'), 'html');
  assert.strictEqual(mapLang('sh'), 'bash');
  assert.strictEqual(mapLang('yml'), 'dot');
  assert.strictEqual(mapLang('python'), 'py');
  assert.strictEqual(mapLang('unknown'), 'txt');
  assert.strictEqual(mapLang(''), 'txt');
  assert.strictEqual(mapLang(null), 'txt');
});

test('isJsLang covers js family aliases', () => {
  assert.strictEqual(isJsLang('js'), true);
  assert.strictEqual(isJsLang('mjs'), true);
  assert.strictEqual(isJsLang('ts'), true);
  assert.strictEqual(isJsLang('javascript'), true);
  assert.strictEqual(isJsLang('json'), false);
  assert.strictEqual(isJsLang('bash'), false);
});

test('isProseBasename treats license-like names as markdown', () => {
  assert.strictEqual(isProseBasename('LICENSE'), true);
  assert.strictEqual(isProseBasename('licence.md'), true);
  assert.strictEqual(isProseBasename('COPYING.txt'), true);
  assert.strictEqual(isProseBasename('authors'), true);
  assert.strictEqual(isProseBasename('README'), false);
  assert.strictEqual(isProseBasename(''), false);
});

test('detectLang maps paths to canonical language ids', () => {
  assert.strictEqual(detectLang('a.js'), 'js');
  assert.strictEqual(detectLang('a.mjs'), 'mjs');
  assert.strictEqual(detectLang('a.ts'), 'ts');
  assert.strictEqual(detectLang('types.d.ts'), 'dts');
  assert.strictEqual(detectLang('a.json'), 'json');
  assert.strictEqual(detectLang('a.md'), 'md');
  assert.strictEqual(detectLang('LICENSE'), 'md');
  assert.strictEqual(detectLang('.env'), 'dot');
  assert.strictEqual(detectLang('.gitignore'), 'dot');
  assert.strictEqual(detectLang('Dockerfile'), 'dot');
  assert.strictEqual(detectLang('Makefile'), 'dot');
  assert.strictEqual(detectLang('app.log'), 'log');
  assert.strictEqual(detectLang('circlecam.py'), 'py');
  assert.strictEqual(detectLang('notes.unknown'), 'txt');
});

test('detectLang uses basename not directory names', () => {
  const file = path.join('src', 'lib', 'wrap.js');
  assert.strictEqual(detectLang(file), 'js');
});

test('langLabel and isSupportedPath', () => {
  assert.strictEqual(langLabel('js'), 'javascript');
  assert.strictEqual(langLabel('dts'), 'typescript');
  assert.strictEqual(langLabel('nope'), 'nope');
  assert.strictEqual(isSupportedPath('a.js'), true);
  assert.strictEqual(isSupportedPath('a.md'), true);
  assert.strictEqual(isSupportedPath('types.d.ts'), true);
  assert.strictEqual(isSupportedPath('Makefile'), true);
  assert.strictEqual(isSupportedPath('circlecam.py'), true);
});
