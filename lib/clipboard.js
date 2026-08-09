'use strict';

const { spawn } = require('node:child_process');

const TOOLS = [
  ['wl-copy', []],
  ['xclip', ['-selection', 'clipboard']],
  ['xsel', ['--clipboard', '--input']],
  ['pbcopy', []],
];

/**
 * Copy text to the system clipboard without blocking the UI.
 * OSC 52 is written immediately; external tools run in the background.
 * @returns {boolean}
 */
const copyText = (text) => {
  const s = String(text ?? '');
  if (!s) return false;

  // Instant path — no subprocess (many terminals / tmux with set-clipboard).
  try {
    const b64 = Buffer.from(s, 'utf8').toString('base64');
    if (b64.length < 120_000) {
      process.stdout.write(`\x1b]52;c;${b64}\x07`);
    }
  } catch {
    // continue to external tools
  }

  // Background: do not block paint / mouse handling.
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
        tryTool(i + 1);
        return;
      }

      let settled = false;
      const state = { timer: null };
      const done = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(state.timer);
        if (!ok) tryTool(i + 1);
      };

      state.timer = setTimeout(() => {
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
        done(false);
      }
    };
    tryTool(0);
  });

  return true;
};

module.exports = { copyText };
