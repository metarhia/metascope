'use strict';

const path = require('node:path');
const { fileExt } = require('metautil');
const { asText } = require('./wrap.js');

const EXT_LANG = {
  md: 'md',
  markdown: 'md',
  js: 'js',
  mjs: 'mjs',
  cjs: 'js',
  ts: 'ts',
  json: 'json',
  csv: 'csv',
  html: 'html',
  htm: 'html',
  css: 'css',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  txt: 'txt',
  text: 'txt',
  log: 'log',
  env: 'dot',
  ini: 'dot',
  conf: 'dot',
  cfg: 'dot',
  yaml: 'dot',
  yml: 'dot',
  toml: 'dot',
};

const PROSE_BASENAMES = [
  'license', 'licence', 'copying', 'authors', 'notice', 'copyright',
];

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
  const ext = fileExt(base);
  if (ext) return EXT_LANG[ext] || 'txt';
  // Extensionless non-prose (Dockerfile, Makefile, …): line-oriented
  return 'dot';
};

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
};

const langLabel = (lang) => LANG_LABELS[lang] || lang;

const SUPPORTED = [
  'md', 'js', 'mjs', 'ts', 'dts', 'json', 'csv', 'html', 'css',
  'bash', 'txt', 'log', 'dot',
];

const isSupportedPath = (filePath) => {
  const lang = detectLang(filePath);
  return SUPPORTED.includes(lang);
};

module.exports = {
  detectLang,
  langLabel,
  isSupportedPath,
  SUPPORTED,
  isProseBasename,
};
