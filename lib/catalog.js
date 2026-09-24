'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const { detectLang, mapLang } = require('./detect.js');
const { isRunnable } = require('./run.js');
const { asText } = require('./wrap.js');

const SKIP_DIRS = ['node_modules', '.git', 'dist', 'coverage'];

const INIT_NAMES = ['init.js', 'init.mjs', 'init.cjs', 'init.ts'];

const isInitFile = (name) => INIT_NAMES.includes(asText(name).toLowerCase());

const rankCatalog = (files) => {
  const ranked = [...files];
  ranked.sort((left, right) => {
    if (left.init !== right.init) return left.init ? -1 : 1;
    if (left.lang === 'md' && right.lang !== 'md') return 1;
    if (right.lang === 'md' && left.lang !== 'md') return -1;
    return left.name.localeCompare(right.name);
  });
  return ranked;
};

const listCatalogFiles = async (dir) => {
  let names = [];
  try {
    names = await fs.readdir(dir);
  } catch {
    return names;
  }

  const files = [];
  for (const name of names) {
    if (name.startsWith('.')) continue;
    if (SKIP_DIRS.includes(name)) continue;
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
      const langKey = lang === 'txt' && init ? 'js' : lang;
      files.push({ name, full, lang: langKey, init });
    }
  }

  return rankCatalog(files);
};

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

    const langName = mapLang(entry.lang);
    const info = entry.init ? `${langName} init` : langName;
    const fence = '```';
    parts.push(`${fence}${info}`, body.replace(/\n$/, ''), fence, '');
  }

  if (entries.length === 0) {
    parts.push('_No code examples in this directory._', '');
  }

  return parts.join('\n');
};

module.exports = { isInitFile, listCatalogFiles, buildCatalogMarkdown };
