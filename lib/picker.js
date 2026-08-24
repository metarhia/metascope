'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { chrome, OSC_BG_BLACK, OSC_BG_RESET } = require('./theme.js');
const { decodeKey } = require('./keys.js');
const { isSupportedPath } = require('./detect.js');
const { innerSize, withMargins, flushFrame } = require('./layout.js');

const ENTER_ALT = '\x1b[?1049h';
const LEAVE_ALT = '\x1b[?1049l';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';

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
  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const parent = { name: '..', full: path.dirname(dir), isDir: true, up: true };
  entries.unshift(parent);
  return entries;
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
  }

  start() {
    this.stdin.setRawMode(true);
    this.stdin.resume();
    this.stdin.setEncoding('utf8');
    process.stdout.write(ENTER_ALT + OSC_BG_BLACK + HIDE_CURSOR);
    this.ac = new AbortController();
    const { signal } = this.ac;
    process.on('SIGINT', () => this.onSig(), { signal });
    process.stdout.on('resize', () => this.paint(), { signal });
    this.stdin.on('data', (buf) => this.onData(buf), { signal });
    this.paint();
  }

  cleanup() {
    this.ac.abort();
    process.stdout.write(SHOW_CURSOR + OSC_BG_RESET + LEAVE_ALT);
    this.stdin.setRawMode(false);
    this.stdin.pause();
  }

  done(result) {
    if (!this.running) return;
    this.running = false;
    this.cleanup();
    this.resolve(result);
  }

  onSig() {
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
      const e = this.items[i];
      const icon = e.isDir ? '📁 ' : '📄 ';
      const label = e.isDir ? `${e.name}/` : e.name;
      const text = icon + label;
      const selected = i === this.index;
      const styled = e.isDir ? chrome.dir(text) : chrome.file(text);
      const line = selected ? chrome.selected(` › ${text}`) : `   ${styled}`;
      inner.push(line);
    }
    inner.push(chrome.footer('↑↓ move  Enter open  Esc quit'));
    while (inner.length < innerRows) inner.push('');
    if (inner.length > innerRows) inner.length = innerRows;
    flushFrame(withMargins(inner, cols, rows));
  }

  async reload(nextDir) {
    this.currentDir = nextDir;
    this.items = await listEntries(this.currentDir);
    this.index = Math.min(1, this.items.length - 1);
    this.offset = 0;
    this.paint();
  }

  async onData(buf) {
    const key = decodeKey(Buffer.from(buf));
    const isCtrlC = key.name === 'ctrl-c';
    const isEscape = key.name === 'escape';
    const isQuitChar = key.name === 'char' && key.ch === 'q';
    if (isCtrlC || isEscape || isQuitChar) return void this.done(null);
    if (key.name === 'up') {
      this.index = Math.max(0, this.index - 1);
      return void this.paint();
    }
    if (key.name === 'down') {
      this.index = Math.min(this.items.length - 1, this.index + 1);
      return void this.paint();
    }
    if (key.name === 'enter' || key.name === 'right') {
      const e = this.items[this.index];
      if (!e) return;
      if (e.isDir) {
        await this.reload(e.full);
        return;
      }
      return void this.done(e.full);
    }
    if (key.name === 'left') {
      await this.reload(path.dirname(this.currentDir));
    }
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
    for (const e of entries) {
      console.log(e.isDir ? `${e.name}/` : e.name);
    }
    return null;
  }
  return runPicker(abs, entries);
};

module.exports = { listEntries, PickerSession, openPicker };
