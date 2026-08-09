'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { formatStackText } = require('./stack');

const RUNNABLE = new Set(['js', 'mjs', 'ts', 'bash', 'sh', 'shell']);

const isRunnable = (lang) => RUNNABLE.has(String(lang || '').toLowerCase());

const TIMEOUT_MS = 8000;
const MAX_OUT = 80_000;

/**
 * Stream a fenced code snippet.
 * Temp files live in `cwd` so require('./…') resolves next to the
 * viewed file/dir.
 *
 * @param {string} lang
 * @param {string} source
 * @param {{
 *   cwd?: string,
 *   onUpdate?: (result: object) => void,
 *   label?: string,
 *   preludeLines?: number,
 * }} [opts]
 */
const runSnippetStream = (lang, source, opts = {}) => {
  const l = String(lang || '').toLowerCase();
  const code = String(source || '');
  const baseDir = path.resolve(opts.cwd || process.cwd());
  const onUpdate = typeof opts.onUpdate === 'function' ? opts.onUpdate : null;
  const stackOpts = {
    label: opts.label || 'Example',
    preludeLines: Math.max(0, Number(opts.preludeLines) || 0),
  };

  const pretty = (s) => formatStackText(s, baseDir, stackOpts);

  const done = (result) => {
    if (onUpdate) onUpdate(result);
    return {
      promise: Promise.resolve(result),
      kill: () => {},
    };
  };

  if (!isRunnable(l)) {
    return done({
      ok: false,
      stdout: '',
      stderr: `Cannot run language: ${lang || '(none)'}`,
      text: `Cannot run language: ${lang || '(none)'}`,
      code: 1,
      running: false,
    });
  }

  const rand = Math.random().toString(36).slice(2, 8);
  const stamp = `${process.pid}-${Date.now()}-${rand}`;
  let file = '';
  let cmd = process.execPath;
  let args = [];

  try {
    if (l === 'js' || l === 'mjs') {
      const ext = l === 'mjs' ? 'mjs' : 'js';
      file = path.join(baseDir, `.metascope-run-${stamp}.${ext}`);
      fs.writeFileSync(file, code);
      args = [file];
    } else if (l === 'ts') {
      file = path.join(baseDir, `.metascope-run-${stamp}.ts`);
      fs.writeFileSync(file, code);
      args = ['--experimental-strip-types', file];
    } else if (l === 'bash' || l === 'sh' || l === 'shell') {
      file = path.join(baseDir, `.metascope-run-${stamp}.sh`);
      fs.writeFileSync(file, code, { mode: 0o755 });
      cmd = 'bash';
      args = [file];
    } else {
      return done({
        ok: false,
        stdout: '',
        stderr: `Cannot run language: ${lang}`,
        text: `Cannot run language: ${lang}`,
        code: 1,
        running: false,
      });
    }
  } catch (err) {
    cleanup(file);
    const msg = err.message || String(err);
    return done({
      ok: false,
      stdout: '',
      stderr: msg,
      text: msg,
      code: 1,
      running: false,
    });
  }

  let child = null;
  let killed = false;
  let timedOut = false;
  let text = '';
  let stdout = '';
  let stderr = '';
  let settled = false;

  const emit = (running, code) => {
    if (!onUpdate) return;
    onUpdate({
      ok: !running && code === 0,
      stdout: pretty(stdout),
      stderr: pretty(stderr),
      text: pretty(text),
      code: running ? 0 : code,
      running,
    });
  };

  const spawnOpts = {
    cwd: baseDir,
    env: { ...process.env, FORCE_COLOR: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  };

  // Line-buffer when possible so console.log appears promptly over a pipe.
  if (fs.existsSync('/usr/bin/stdbuf') || fs.existsSync('/bin/stdbuf')) {
    child = spawn('stdbuf', ['-oL', '-eL', cmd, ...args], spawnOpts);
  } else {
    child = spawn(cmd, args, spawnOpts);
  }

  const promise = new Promise((resolve) => {
    const finish = (result) => {
      if (settled) return;
      settled = true;
      cleanup(file);
      if (onUpdate) onUpdate(result);
      resolve(result);
    };

    emit(true, 0);

    const append = (chunk, stream) => {
      const s = String(chunk);
      text = clip(text + s);
      if (stream === 'out') stdout = clip(stdout + s);
      else stderr = clip(stderr + s);
      emit(true, 0);
    };

    child.stdout.on('data', (c) => append(c, 'out'));
    child.stderr.on('data', (c) => append(c, 'err'));

    child.on('error', (err) => {
      const msg = err.message || String(err);
      stderr = clip(msg);
      text = clip(text ? `${text}\n${msg}` : msg);
      finish({
        ok: false,
        stdout,
        stderr,
        text,
        code: 1,
        running: false,
      });
    });

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
    }, TIMEOUT_MS);

    child.on('close', (code) => {
      clearTimeout(timer);
      let exit = code;
      if (timedOut || killed || code === null || code === undefined) {
        exit = 1;
      }
      finish({
        ok: exit === 0,
        stdout: pretty(stdout),
        stderr: pretty(stderr),
        text: pretty(text),
        code: exit,
        running: false,
        interrupted: !!killed && !timedOut,
        timedOut: !!timedOut,
      });
    });
  });

  return {
    promise,
    kill: () => {
      killed = true;
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
    },
  };
};

function cleanup(file) {
  if (!file) return;
  try {
    fs.unlinkSync(file);
  } catch {
    // ignore
  }
}

function clip(s) {
  if (s.length <= MAX_OUT) return s;
  return `${s.slice(0, MAX_OUT)}\n… (truncated)`;
}

module.exports = { runSnippetStream, isRunnable, RUNNABLE, TIMEOUT_MS };
