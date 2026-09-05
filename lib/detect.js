'use strict';

const path = require('node:path');
const { fileExt } = require('metautil');
const { asText } = require('./wrap.js');

/** Extension / fence-tag aliases → canonical language id. */
const LANG = {
  md: 'md',
  markdown: 'md',
  js: 'js',
  javascript: 'js',
  mjs: 'mjs',
  cjs: 'js',
  ts: 'ts',
  typescript: 'ts',
  json: 'json',
  csv: 'csv',
  html: 'html',
  htm: 'html',
  css: 'css',
  sh: 'bash',
  bash: 'bash',
  shell: 'bash',
  zsh: 'bash',
  txt: 'txt',
  text: 'txt',
  plain: 'txt',
  log: 'log',
  env: 'dot',
  ini: 'dot',
  conf: 'dot',
  cfg: 'dot',
  yaml: 'dot',
  yml: 'dot',
  toml: 'dot',
  py: 'py',
  python: 'py',
};

const JS_LANGS = ['js', 'mjs', 'ts'];

const PROSE_BASENAMES = [
  'license',
  'licence',
  'copying',
  'authors',
  'notice',
  'copyright',
];

const LANG_LABELS = {
  md: 'markdown',
  js: 'javascript',
  mjs: 'javascript',
  ts: 'typescript',
  dts: 'typescript',
  json: 'json',
  csv: 'csv',
  html: 'html',
  css: 'css',
  bash: 'bash',
  txt: 'text',
  log: 'log',
  dot: 'config',
  py: 'python',
};

const SUPPORTED = Object.keys(LANG_LABELS);

const mapLang = (name) => {
  const l = asText(name).toLowerCase();
  return LANG[l] || 'txt';
};

const isJsLang = (lang) => JS_LANGS.includes(mapLang(lang));

const isProseBasename = (base) => {
  const name = asText(base).toLowerCase();
  if (PROSE_BASENAMES.includes(name)) return true;
  const stem = name.replace(/\.(txt|text|md|markdown)$/i, '');
  return PROSE_BASENAMES.includes(stem);
};

const detectLang = (filePath) => {
  const base = path.basename(filePath).toLowerCase();
  if (base.endsWith('.d.ts')) return 'dts';
  if (isProseBasename(base)) return 'md';
  if (base.endsWith('.log')) return 'log';
  // Dotfiles keep line structure (never paragraph-join).
  if (base.startsWith('.')) return 'dot';
  // metautil fileExt('Dockerfile') → 'dockerfile', not ''.
  if (!base.includes('.')) return 'dot';
  const ext = fileExt(base);
  if (ext) return LANG[ext] || 'txt';
  return 'dot';
};

const langLabel = (lang) => LANG_LABELS[lang] || lang;

const isSupportedPath = (filePath) => {
  const lang = detectLang(filePath);
  return SUPPORTED.includes(lang);
};

module.exports = {
  LANG,
  JS_LANGS,
  SUPPORTED,
  mapLang,
  isJsLang,
  detectLang,
  langLabel,
  isSupportedPath,
  isProseBasename,
};
