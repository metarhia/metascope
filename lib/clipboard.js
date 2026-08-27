'use strict';

const { spawn } = require('node:child_process');
const { asText } = require('./wrap.js');

const TOOLS = [
  ['wl-copy', []],
  ['xclip', ['-selection', 'clipboard']],
  ['xsel', ['--clipboard', '--input']],
  ['pbcopy', []],
];

const copyText = (text) => {
  const s = asText(text);
  if (!s) return false;

  // OSC 52 — no subprocess (tmux set-clipboard and many terminals).
  try {
    const b64 = Buffer.from(s, 'utf8').toString('base64');
    if (b64.length < 120_000) {
      process.stdout.write(`\x1b]52;c;${b64}\x07`);
    }
  } catch {
    // ignore
  }

  // External tools must not block paint / mouse handling.
  setImmediate(() => {
    const tryTool = (i) => {
      if (i >= TOOLS.length) return;
      const [cmd, args] = TOOLS[i];
      let child;
      try {
        child = spawn(cmd, args, {
          stdio: ['pipe', 'ignore', 'ignore'],
        });
      } catch {
        return void tryTool(i + 1);
      }

      let settled = false;
      const attempt = {};
      const done = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(attempt.timer);
        if (!ok) tryTool(i + 1);
      };
      attempt.timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
        done(false);
      }, 400);

      child.on('error', () => done(false));
      child.on('close', (code) => done(code === 0));

      try {
        child.stdin.end(s);
      } catch {
        return void done(false);
      }
    };
    tryTool(0);
  });

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
