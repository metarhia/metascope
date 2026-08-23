'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { formatStackText } = require('./stack.js');
const { asText } = require('./wrap.js');

const RUNNABLE = ['js', 'mjs', 'ts', 'bash', 'sh', 'shell'];

const isRunnable = (lang) => RUNNABLE.includes(asText(lang).toLowerCase());

const TIMEOUT_MS = 8000;
const MAX_OUT = 80_000;

const cleanup = (file) => {
  if (!file) return;
  try {
    fs.unlinkSync(file);
  } catch {
    // ignore
  }
};

const prepareRunFile = (l, code, baseDir, stamp) => {
  let file = '';
  try {
    if (l === 'js' || l === 'mjs') {
      const ext = l === 'mjs' ? 'mjs' : 'js';
      file = path.join(baseDir, `.metascope-run-${stamp}.${ext}`);
      fs.writeFileSync(file, code);
      return { file, cmd: process.execPath, args: [file] };
    }
    if (l === 'ts') {
      file = path.join(baseDir, `.metascope-run-${stamp}.ts`);
      fs.writeFileSync(file, code);
      const args = ['--experimental-strip-types', file];
      return { file, cmd: process.execPath, args };
    }
    if (l === 'bash' || l === 'sh' || l === 'shell') {
      file = path.join(baseDir, `.metascope-run-${stamp}.sh`);
      fs.writeFileSync(file, code, { mode: 0o755 });
      return { file, cmd: 'bash', args: [file] };
    }
  } catch (err) {
    cleanup(file);
    throw err;
  }
  return null;
};

const spawnBuffered = (cmd, args, spawnOpts) => {
  const hasStdbuf =
    fs.existsSync('/usr/bin/stdbuf') || fs.existsSync('/bin/stdbuf');
  if (hasStdbuf) {
    return spawn('stdbuf', ['-oL', '-eL', cmd, ...args], spawnOpts);
  }
  return spawn(cmd, args, spawnOpts);
};

const clip = (s) => {
  if (s.length <= MAX_OUT) return s;
  return `${s.slice(0, MAX_OUT)}\n… (truncated)`;
};

const failResult = (msg) => {
  const stdout = '';
  const running = false;
  return { ok: false, stdout, stderr: msg, text: msg, code: 1, running };
};

// Temp files live in `cwd` so require('./…') resolves next to the file.
const runSnippetStream = (lang, source, opts = {}) => {
  const l = asText(lang).toLowerCase();
  const code = asText(source);
  const baseDir = path.resolve(opts.cwd || process.cwd());
  const onUpdate = typeof opts.onUpdate === 'function' ? opts.onUpdate : null;
  const label = opts.label || 'Example';
  const preludeLines = Math.max(0, Number(opts.preludeLines) || 0);
  const stackOpts = { label, preludeLines };

  const pretty = (s) => formatStackText(s, baseDir, stackOpts);

  const done = (result) => {
    if (onUpdate) onUpdate(result);
    return { promise: Promise.resolve(result), kill: () => {} };
  };

  if (!isRunnable(l)) {
    const msg = `Cannot run language: ${lang || '(none)'}`;
    return done(failResult(msg));
  }

  const rand = Math.random().toString(36).slice(2, 8);
  const stamp = `${process.pid}-${Date.now()}-${rand}`;
  let prepared;
  try {
    prepared = prepareRunFile(l, code, baseDir, stamp);
  } catch (err) {
    const msg = err.message || asText(err);
    return done(failResult(msg));
  }
  if (!prepared) {
    const msg = `Cannot run language: ${lang}`;
    return done(failResult(msg));
  }
  const { file, cmd, args } = prepared;

  let child = null;
  let killed = false;
  let timedOut = false;
  let text = '';
  let stdout = '';
  let stderr = '';
  let settled = false;

  const emit = (running, code) => {
    if (!onUpdate) return;
    const ok = !running && code === 0;
    const out = pretty(stdout);
    const err = pretty(stderr);
    const body = pretty(text);
    if (running) code = 0;
    onUpdate({ ok, stdout: out, stderr: err, text: body, code, running });
  };

  const env = { ...process.env, FORCE_COLOR: '0' };
  const stdio = ['ignore', 'pipe', 'pipe'];
  const spawnOpts = { cwd: baseDir, env, stdio };
  // Line-buffer when possible so console.log appears promptly over a pipe.
  child = spawnBuffered(cmd, args, spawnOpts);

  const promise = new Promise((resolve) => {
    const finish = (result) => {
      if (settled) return;
      settled = true;
      cleanup(file);
      if (onUpdate) onUpdate(result);
      return void resolve(result);
    };

    emit(true, 0);

    const append = (chunk, stream) => {
      const s = asText(chunk);
      text = clip(text + s);
      if (stream === 'out') stdout = clip(stdout + s);
      else stderr = clip(stderr + s);
      emit(true, 0);
    };

    child.stdout.on('data', (c) => append(c, 'out'));
    child.stderr.on('data', (c) => append(c, 'err'));

    child.on('error', (err) => {
      const msg = err.message || asText(err);
      stderr = clip(msg);
      text = clip(text ? `${text}\n${msg}` : msg);
      finish({ ok: false, stdout, stderr, text, code: 1, running: false });
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
      if (timedOut || killed || code === null || code === undefined) {
        code = 1;
      }
      const ok = code === 0;
      const interrupted = killed && !timedOut;
      stdout = pretty(stdout);
      stderr = pretty(stderr);
      text = pretty(text);
      const end = { ok, stdout, stderr, text, code, interrupted, timedOut };
      end.running = false;
      finish(end);
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

module.exports = { runSnippetStream, isRunnable, RUNNABLE, TIMEOUT_MS };
