'use strict';

const path = require('node:path');
const { fileExists, directoryExists } = require('metautil');
const { chrome } = require('./theme.js');
const { openViewer } = require('./viewer.js');

const usage = () => {
  console.log(`metascope — interactive file viewer

Usage:
  metascope [path]
  $VIEWER [path]          # when export VIEWER=metascope

  path   file to view, or directory of code examples (default: .)

  Directory: all .js/.mjs/.ts/.sh examples (and .md) as runnable blocks.
  init.js / init.mjs / init.ts → shared js init prelude.

Keys: ↑↓ ←→  Space status  g/G  /search  ▶run  ?help  q/Esc
`);
};

const resolveTarget = (argv) => {
  const args = argv.filter((a) => {
    if (a === '-h' || a === '--help') return true;
    if (/^\+\d+$/.test(a)) return false; // less/view $VIEWER +LINE
    if (a.startsWith('-') && a !== '-') return false;
    return true;
  });
  if (args.includes('-h') || args.includes('--help')) return { help: true };
  const fileArg = args.find((a) => a !== '-h' && a !== '--help');
  return { path: path.resolve(fileArg || process.cwd()) };
};

const main = async (argv) => {
  const resolved = resolveTarget(argv);
  if (resolved.help) return void usage();
  const target = resolved.path;
  const isDir = await directoryExists(target);
  const isFile = await fileExists(target);
  if (!isDir && !isFile) {
    console.error(chrome.error(`Not found: ${target}`));
    process.exitCode = 1;
    return;
  }
  await openViewer(target);
};

module.exports = { main, usage };
