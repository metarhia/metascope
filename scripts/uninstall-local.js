#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const home = os.homedir();
const destDir = process.env.METASCOPE_BIN_DIR
  ? path.resolve(process.env.METASCOPE_BIN_DIR)
  : path.join(home, '.local', 'bin');
const dest = path.join(destDir, 'metascope');

const MARK_BEGIN = '# >>> metascope >>>';
const MARK_END = '# <<< metascope <<<';

try {
  if (fs.existsSync(dest) || fs.lstatSync(dest).isSymbolicLink()) {
    fs.unlinkSync(dest);
    console.log(`metascope: removed ${dest}`);
  } else {
    console.log(`metascope: nothing to remove at ${dest}`);
  }
} catch (err) {
  console.log(`metascope: could not remove bin (${err.message})`);
}

const dropIn = path.join(home, '.bashrc.d', 'metascope.sh');
if (fs.existsSync(dropIn)) {
  fs.unlinkSync(dropIn);
  console.log(`metascope: removed ${dropIn}`);
}

const envFile = path.join(home, '.config', 'environment.d', 'metascope.conf');
if (fs.existsSync(envFile)) {
  fs.unlinkSync(envFile);
  console.log(`metascope: removed ${envFile}`);
}

const profiles = [
  path.join(home, '.bashrc'),
  path.join(home, '.zshrc'),
  path.join(home, '.profile'),
];

for (const filePath of profiles) {
  if (!fs.existsSync(filePath)) continue;
  try {
    let text = fs.readFileSync(filePath, 'utf8');
    if (!text.includes(MARK_BEGIN)) continue;
    const re = new RegExp(`${MARK_BEGIN}[\\s\\S]*?${MARK_END}\\n?`, 'm');
    text = text.replace(re, '');
    fs.writeFileSync(filePath, text);
    console.log(`metascope: cleaned ${filePath}`);
  } catch (err) {
    console.log(`metascope: skip ${filePath} (${err.message})`);
  }
}

const extPath = path.join(home, '.config', 'mc', 'mc.ext.ini');
if (fs.existsSync(extPath)) {
  try {
    let ext = fs.readFileSync(extPath, 'utf8');
    const before = ext;
    ext = ext.replace(/^View=.*\/metascope %f$/gm, 'View=');
    if (ext !== before) {
      fs.writeFileSync(extPath, ext);
      console.log(`metascope: restored View= in ${extPath}`);
    }
  } catch (err) {
    console.log(`metascope: skip mc.ext.ini (${err.message})`);
  }
}
