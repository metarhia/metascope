'use strict';

const path = require('node:path');
const { fileExt } = require('metautil');

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

/** Plain-prose legal/meta files: reflow like markdown paragraphs. */
const PROSE_BASENAMES = new Set([
  'license',
  'licence',
  'copying',
  'authors',
  'notice',
  'copyright',
]);

const isProseBasename = (base) => {
  const name = String(base || '').toLowerCase();
  if (PROSE_BASENAMES.has(name)) return true;
  const stem = name.replace(/\.(txt|text|md|markdown)$/i, '');
  return PROSE_BASENAMES.has(stem);
};

const detectLang = (filePath) => {
  const base = path.basename(filePath).toLowerCase();
  if (base.endsWith('.d.ts')) return 'dts';
  // LICENSE / COPYING / … → markdown path (paragraph reflow, no code frame)
  if (isProseBasename(base)) return 'md';
  if (base.endsWith('.log')) return 'log';
  // Dotfiles keep line structure (never paragraph-join).
  if (base.startsWith('.')) return 'dot';
  const ext = fileExt(base);
  if (ext) return EXT_LANG[ext] || 'txt';
  // Extensionless non-prose (Dockerfile, Makefile, …): line-oriented
  return 'dot';
};

const langLabel = (lang) => {
  const labels = {
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
  return labels[lang] || lang;
};

const SUPPORTED = new Set([
  'md',
  'js',
  'mjs',
  'ts',
  'dts',
  'json',
  'csv',
  'html',
  'css',
  'bash',
  'txt',
  'log',
  'dot',
]);

const isSupportedPath = (filePath) => {
  const lang = detectLang(filePath);
  return SUPPORTED.has(lang);
};

module.exports = {
  detectLang,
  langLabel,
  isSupportedPath,
  SUPPORTED,
  isProseBasename,
};
