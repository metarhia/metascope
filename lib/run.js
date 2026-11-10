'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { generateUUID } = require('metautil');

const { formatStackText, findPathRoots } = require('./stack.js');
const { asText } = require('./wrap.js');
const { mapLang } = require('./detect.js');

const TIMEOUT_MS = 8000;
const MAX_OUT = 80_000;
const STDBUF = ['/usr/bin/stdbuf', '/bin/stdbuf'];

const cleanup = (file) => {
  if (!file) return;
  try {
    fs.unlinkSync(file);
  } catch {
    // ignore
  }
};

const writeRunFile = (baseDir, stamp, ext, code, mode) => {
  const file = path.join(baseDir, `.metascope-run-${stamp}.${ext}`);
  if (mode) fs.writeFileSync(file, code, { mode });
  else fs.writeFileSync(file, code);
  return file;
};

const nodeRun = (ext) => (code, baseDir, stamp) => {
  const file = writeRunFile(baseDir, stamp, ext, code);
  return { file, cmd: process.execPath, args: [file] };
};

const PREPARE = {
  js: nodeRun('js'),
  mjs: nodeRun('mjs'),
  ts: (code, baseDir, stamp) => {
    const file = writeRunFile(baseDir, stamp, 'ts', code);
    const args = ['--experimental-strip-types', file];
    return { file, cmd: process.execPath, args };
  },
  bash: (code, baseDir, stamp) => {
    const file = writeRunFile(baseDir, stamp, 'sh', code, 0o755);
    return { file, cmd: 'bash', args: [file] };
  },
};

const RUNNABLE = Object.keys(PREPARE);

const isRunnable = (lang) => RUNNABLE.includes(mapLang(lang));

const spawnBuffered = (cmd, args, spawnOpts) => {
  const hasStdbuf = STDBUF.some((bin) => fs.existsSync(bin));
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

const runSnippetStream = (lang, source, opts = {}) => {
  const l = mapLang(lang);
  const code = asText(source);
  const baseDir = path.resolve(opts.cwd || process.cwd());
  const onUpdate = typeof opts.onUpdate === 'function' ? opts.onUpdate : null;
  const { label, preludeLines } = opts;
  let stackOpts = null;

  // Path roots are fixed for the run: resolve them once, not per chunk.
  const pretty = (s) => {
    if (!stackOpts) {
      stackOpts = { label, preludeLines, roots: findPathRoots(baseDir) };
    }
    return formatStackText(s, baseDir, stackOpts);
  };

  const done = (result) => {
    if (onUpdate) onUpdate(result);
    return { promise: Promise.resolve(result), kill: () => {} };
  };

  if (!isRunnable(l)) {
    const msg = `Cannot run language: ${lang || '(none)'}`;
    return done(failResult(msg));
  }

  const stamp = `${process.pid}-${generateUUID()}`;
  let prepared;
  try {
    prepared = PREPARE[l](code, baseDir, stamp);
  } catch (error) {
    const msg = error.message || asText(error);
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

  const emitRunning = () => {
    if (!onUpdate) return;
    onUpdate({
      ok: false,
      stdout: pretty(stdout),
      stderr: pretty(stderr),
      text: pretty(text),
      code: 0,
      running: true,
    });
  };

  const env = { ...process.env, FORCE_COLOR: '0' };
  const stdio = ['ignore', 'pipe', 'pipe'];
  const spawnOpts = { cwd: baseDir, env, stdio };
  child = spawnBuffered(cmd, args, spawnOpts);

  const promise = new Promise((resolve) => {
    const finish = (result) => {
      if (settled) return;
      settled = true;
      cleanup(file);
      if (onUpdate) onUpdate(result);
      return void resolve(result);
    };

    emitRunning();

    const append = (chunk, stream) => {
      const s = asText(chunk);
      text = clip(text + s);
      if (stream === 'out') stdout = clip(stdout + s);
      else stderr = clip(stderr + s);
      emitRunning();
    };

    child.stdout.on('data', (chunk) => append(chunk, 'out'));
    child.stderr.on('data', (chunk) => append(chunk, 'err'));

    child.on('error', (error) => {
      const msg = error.message || asText(error);
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

    child.on('close', (exitCode) => {
      clearTimeout(timer);
      const missing = exitCode === null || exitCode === undefined;
      const code = timedOut || killed || missing ? 1 : exitCode;
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

module.exports = { RUNNABLE, TIMEOUT_MS, isRunnable, runSnippetStream };
