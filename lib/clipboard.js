'use strict';

const { spawn } = require('node:child_process');

const { asText } = require('./wrap.js');

const TOOLS = [
  ['wl-copy', []],
  ['xclip', ['-selection', 'clipboard']],
  ['xsel', ['--clipboard', '--input']],
  ['pbcopy', []],
];

const COPY_TIMEOUT_MS = 400;

const spawnCopy = (cmd, args, text, onFail) => {
  let child;
  try {
    child = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'ignore'] });
  } catch {
    return void onFail();
  }

  let settled = false;
  let timer = null;
  const done = (ok) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (!ok) onFail();
  };

  timer = setTimeout(() => {
    try {
      child.kill('SIGKILL');
    } catch {
      // ignore
    }
    done(false);
  }, COPY_TIMEOUT_MS);

  child.on('error', () => done(false));
  child.on('close', (code) => done(code === 0));

  try {
    child.stdin.end(text);
  } catch {
    done(false);
  }
};

const copyWithTools = (text) => {
  const tryTool = (index) => {
    if (index >= TOOLS.length) return;
    const pair = TOOLS[index];
    const cmd = pair[0];
    const args = pair[1];
    spawnCopy(cmd, args, text, () => tryTool(index + 1));
  };
  tryTool(0);
};

const copyText = (text) => {
  const s = asText(text);
  if (!s) return false;

  try {
    const b64 = Buffer.from(s, 'utf8').toString('base64');
    if (b64.length < 120_000) {
      process.stdout.write(`\x1b]52;c;${b64}\x07`);
    }
  } catch {
    // ignore
  }

  setImmediate(() => copyWithTools(s));
  return true;
};

const sourceLines = (source) => {
  const text = asText(source).replace(/\r\n/g, '\n');
  return text.split('\n');
};

const textFromOrigins = (source, origins, fromLine, toLine) => {
  if (!origins || fromLine > toLine) return '';
  const lines = sourceLines(source);
  let first = Infinity;
  let last = -1;
  const begin = Math.max(0, fromLine);
  const end = Math.min(toLine, origins.length - 1);
  for (let i = begin; i <= end; i++) {
    const origin = origins[i];
    if (!origin) continue;
    if (origin.first < 0 || origin.last < 0) continue;
    if (origin.first < first) first = origin.first;
    if (origin.last > last) last = origin.last;
  }
  if (first === Infinity || last < first) return '';
  const lo = Math.max(0, first);
  const hi = Math.min(lines.length - 1, last);
  if (lo > hi) return '';
  return lines.slice(lo, hi + 1).join('\n');
};

module.exports = { copyText, textFromOrigins };
