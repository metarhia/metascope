'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const { chrome } = require('./theme.js');
const { decodeKey } = require('./keys.js');
const { isSupportedPath } = require('./detect.js');
const layout = require('./layout.js');
const { innerSize, withMargins, flushFrame } = layout;
const { enterInteractive, leaveInteractive } = layout;

const PICKER_KEYS = {
  'ctrl-c': 'quit',
  escape: 'quit',
  up: 'moveUp',
  down: 'moveDown',
  enter: 'open',
  right: 'open',
  left: 'goParent',
};

const rankEntries = (entries) => {
  const ranked = [...entries];
  ranked.sort((left, right) => {
    if (left.isDir !== right.isDir) return left.isDir ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
  return ranked;
};

const listEntries = async (dir) => {
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
    const isDir = st.isDirectory();
    if (isDir || (st.isFile() && isSupportedPath(full))) {
      entries.push({ name, full, isDir });
    }
  }
  const parent = { name: '..', full: path.dirname(dir), isDir: true, up: true };
  return [parent, ...rankEntries(entries)];
};

class PickerSession {
  constructor(dir, entries, resolve) {
    this.currentDir = dir;
    this.items = entries;
    this.index = Math.min(1, entries.length - 1);
    this.offset = 0;
    this.running = true;
    this.resolve = resolve;
    this.stdin = process.stdin;
    this.ac = null;
  }

  start() {
    this.stdin.setRawMode(true);
    this.stdin.resume();
    this.stdin.setEncoding('utf8');
    enterInteractive({ blackBg: true });
    this.ac = new AbortController();
    const { signal } = this.ac;
    process.on('SIGINT', () => this.quit(), { signal });
    process.stdout.on('resize', () => this.paint(), { signal });
    this.stdin.on('data', (buf) => this.onData(buf), { signal });
    this.paint();
  }

  cleanup() {
    if (this.ac) this.ac.abort();
    leaveInteractive();
    this.stdin.setRawMode(false);
    this.stdin.pause();
  }

  done(result) {
    if (!this.running) return;
    this.running = false;
    this.cleanup();
    this.resolve(result);
  }

  quit() {
    this.done(null);
  }

  paint() {
    const { cols, rows, innerRows } = innerSize();
    const body = Math.max(1, innerRows - 2);
    if (this.index < this.offset) this.offset = this.index;
    if (this.index >= this.offset + body) {
      this.offset = this.index - body + 1;
    }
    const inner = [];
    inner.push(`📂 ${chrome.header(this.currentDir)}`);
    for (let row = 0; row < body; row++) {
      const i = this.offset + row;
      if (i >= this.items.length) {
        inner.push('');
        continue;
      }
      const entry = this.items[i];
      const icon = entry.isDir ? '📁 ' : '📄 ';
      const label = entry.isDir ? `${entry.name}/` : entry.name;
      const text = icon + label;
      const selected = i === this.index;
      const styled = entry.isDir ? chrome.dir(text) : chrome.file(text);
      const line = selected ? chrome.selected(` › ${text}`) : `   ${styled}`;
      inner.push(line);
    }
    inner.push(chrome.footer('↑↓ move  Enter open  Esc quit'));
    while (inner.length < innerRows) inner.push('');
    if (inner.length > innerRows) inner.length = innerRows;
    flushFrame(withMargins(inner, cols, rows));
  }

  async reload(nextDir) {
    try {
      const items = await listEntries(nextDir);
      this.currentDir = nextDir;
      this.items = items;
      this.index = Math.min(1, this.items.length - 1);
      this.offset = 0;
    } catch (error) {
      console.error(error);
    }
    this.paint();
  }

  moveUp() {
    this.index = Math.max(0, this.index - 1);
    this.paint();
  }

  moveDown() {
    this.index = Math.min(this.items.length - 1, this.index + 1);
    this.paint();
  }

  async open() {
    const entry = this.items[this.index];
    if (!entry) return;
    if (entry.isDir) {
      await this.reload(entry.full);
      return;
    }
    this.done(entry.full);
  }

  async goParent() {
    await this.reload(path.dirname(this.currentDir));
  }

  async onData(buf) {
    const key = decodeKey(Buffer.from(buf));
    const isQuitChar = key.name === 'char' && key.ch === 'q';
    const name = isQuitChar ? 'quit' : PICKER_KEYS[key.name];
    if (!name || typeof this[name] !== 'function') return;
    await this[name]();
  }
}

const runPicker = (dir, entries) =>
  new Promise((resolve) => {
    const session = new PickerSession(dir, entries, resolve);
    session.start();
  });

const openPicker = async (dirPath) => {
  const abs = path.resolve(dirPath);
  const entries = await listEntries(abs);
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    for (const entry of entries) {
      console.log(entry.isDir ? `${entry.name}/` : entry.name);
    }
    return null;
  }
  return runPicker(abs, entries);
};

module.exports = { listEntries, PickerSession, openPicker };
