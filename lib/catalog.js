'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { detectLang } = require('./detect');
const { isRunnable } = require('./run');

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage']);

const INIT_NAMES = new Set(['init.js', 'init.mjs', 'init.cjs', 'init.ts']);

const fenceLang = (lang) => {
  const l = String(lang || '').toLowerCase();
  if (l === 'bash' || l === 'sh' || l === 'shell') return 'bash';
  if (l === 'mjs') return 'mjs';
  if (l === 'ts') return 'ts';
  if (l === 'js') return 'js';
  return l || 'txt';
};

const isInitFile = (name) => INIT_NAMES.has(String(name).toLowerCase());

/**
 * Build a markdown document for a directory: each code file becomes a
 * fenced runnable block; .md files are inlined (their fences stay runnable).
 */
const buildCatalogMarkdown = async (dirPath) => {
  const abs = path.resolve(dirPath);
  const title = path.basename(abs) || abs;
  const entries = await listCatalogFiles(abs);

  const parts = [`# ${title}`, '', `_examples in \`${abs}\`_`, ''];

  for (const entry of entries) {
    const body = await fs.readFile(entry.full, 'utf8');
    parts.push(`## ${entry.name}`, '');

    if (entry.lang === 'md') {
      parts.push(body.replace(/\s*$/, ''), '');
      continue;
    }

    const info = entry.init
      ? `${fenceLang(entry.lang)} init`
      : fenceLang(entry.lang);
    const fence = '```';
    parts.push(`${fence}${info}`, body.replace(/\n$/, ''), fence, '');
  }

  if (entries.length === 0) {
    parts.push('_No code examples in this directory._', '');
  }

  return parts.join('\n');
};

async function listCatalogFiles(dir) {
  let names;
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }

  const files = [];
  for (const name of names) {
    if (name.startsWith('.')) continue;
    if (SKIP_DIRS.has(name)) continue;
    if (name.startsWith('.metascope-run-')) continue;

    const full = path.join(dir, name);
    let st;
    try {
      st = await fs.stat(full);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;

    const lang = detectLang(full);
    const init = isInitFile(name);
    if (lang === 'md') {
      files.push({ name, full, lang, init: false });
      continue;
    }
    if (isRunnable(lang) || init) {
      files.push({
        name,
        full,
        lang: lang === 'txt' && init ? 'js' : lang,
        init,
      });
    }
  }

  files.sort((a, b) => {
    if (a.init !== b.init) return a.init ? -1 : 1;
    if (a.lang === 'md' && b.lang !== 'md') return 1;
    if (b.lang === 'md' && a.lang !== 'md') return -1;
    return a.name.localeCompare(b.name);
  });

  return files;
}

module.exports = { buildCatalogMarkdown, listCatalogFiles, isInitFile };
