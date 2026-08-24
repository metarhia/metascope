'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { fileExists, directoryExists } = require('metautil');
const { chrome } = require('./theme.js');
const { openViewer } = require('./viewer.js');
const { render } = require('./render/index.js');

const USAGE_MD = fs.readFileSync(path.join(__dirname, 'usage.md'), 'utf8');

const usage = () => {
  const width = process.stdout.columns || 80;
  const { lines } = render('md', USAGE_MD, { width, wrap: true });
  console.log(lines.join('\n'));
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

module.exports = { usage, main };
