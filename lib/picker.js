'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { chrome, OSC_BG_BLACK, OSC_BG_RESET } = require('./theme');
const { decodeKey } = require('./keys');
const { isSupportedPath } = require('./detect');
const { innerSize, withMargins, flushFrame } = require('./layout');

const ENTER_ALT = '\x1b[?1049h';
const LEAVE_ALT = '\x1b[?1049l';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';

const openPicker = async (dirPath) => {
  const abs = path.resolve(dirPath);
  const entries = await listEntries(abs);

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    for (const e of entries) {
      console.log(e.isDir ? `${e.name}/` : e.name);
    }
    return null;
  }

  return runPicker(abs, entries);
};

async function listEntries(dir) {
  const names = await fs.readdir(dir);
  const entries = [];
  for (const name of names) {
    if (name.startsWith('.')) continue;
    const full = path.join(dir, name);
    let st;
    try {
      st = await fs.stat(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      entries.push({ name, full, isDir: true });
    } else if (st.isFile() && isSupportedPath(full)) {
      entries.push({ name, full, isDir: false });
    }
  }
  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  entries.unshift({
    name: '..',
    full: path.dirname(dir),
    isDir: true,
    up: true,
  });
  return entries;
}

function runPicker(dir, entries) {
  return new Promise((resolve) => {
    let index = Math.min(1, entries.length - 1);
    let offset = 0;
    let currentDir = dir;
    let items = entries;
    let running = true;

    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    process.stdout.write(ENTER_ALT + OSC_BG_BLACK + HIDE_CURSOR);

    const cleanup = () => {
      process.stdout.write(SHOW_CURSOR + OSC_BG_RESET + LEAVE_ALT);
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      process.stdout.removeListener('resize', paint);
      process.removeListener('SIGINT', onSig);
    };

    const done = (result) => {
      if (!running) return;
      running = false;
      cleanup();
      resolve(result);
    };

    function onSig() {
      done(null);
    }

    function paint() {
      const { cols, rows, innerRows } = innerSize();
      const body = Math.max(1, innerRows - 2);
      if (index < offset) offset = index;
      if (index >= offset + body) offset = index - body + 1;

      const inner = [];
      inner.push(`📂 ${chrome.header(currentDir)}`);

      for (let row = 0; row < body; row++) {
        const i = offset + row;
        if (i >= items.length) {
          inner.push('');
          continue;
        }
        const e = items[i];
        const icon = e.isDir ? '📁 ' : '📄 ';
        const label = e.isDir ? `${e.name}/` : e.name;
        const text = icon + label;
        const line =
          i === index
            ? chrome.selected(` › ${text}`)
            : `   ${e.isDir ? chrome.dir(text) : chrome.file(text)}`;
        inner.push(line);
      }

      inner.push(chrome.footer('↑↓ move  Enter open  Esc quit'));

      while (inner.length < innerRows) inner.push('');
      if (inner.length > innerRows) inner.length = innerRows;

      flushFrame(withMargins(inner, cols, rows));
    }

    const reload = async (nextDir) => {
      currentDir = nextDir;
      items = await listEntries(currentDir);
      index = Math.min(1, items.length - 1);
      offset = 0;
      paint();
    };

    async function onData(buf) {
      const key = decodeKey(Buffer.from(buf));
      if (
        key.name === 'ctrl-c' ||
        key.name === 'escape' ||
        (key.name === 'char' && key.ch === 'q')
      ) {
        done(null);
        return;
      }
      if (key.name === 'up' || (key.name === 'char' && key.ch === 'k')) {
        index = Math.max(0, index - 1);
        paint();
        return;
      }
      if (key.name === 'down' || (key.name === 'char' && key.ch === 'j')) {
        index = Math.min(items.length - 1, index + 1);
        paint();
        return;
      }
      if (key.name === 'enter' || key.name === 'right') {
        const e = items[index];
        if (!e) return;
        if (e.isDir) {
          await reload(e.full);
          return;
        }
        done(e.full);
        return;
      }
      if (key.name === 'left') {
        await reload(path.dirname(currentDir));
      }
    }

    process.on('SIGINT', onSig);
    process.stdout.on('resize', paint);
    stdin.on('data', onData);
    paint();
  });
}

module.exports = { openPicker, listEntries };
