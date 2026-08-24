'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { asText } = require('./wrap.js');

/** `at fn (file:line:col)` or `at file:line:col` */
const FRAME_RE =
  /^(\s*at\s+)(?:(.*?)\s+\()?(?:file:\/\/)?(.+?):(\d+)(?::(\d+))?\)?\s*$/;

/** Bare `/abs/path/file.js:11` (Node often prints this above the caret). */
const BARE_LOC_RE = new RegExp(
  String.raw`^(?:file://)?(/?.*?\.metascope-run-[^\s:]+|/[^\s:]+)` +
    String.raw`:(\d+)(?::(\d+))?\s*$`,
);

/**
 * Collect candidate roots for shortening paths (cwd + package/.git ancestors).
 * Longer roots first so the tightest match wins.
 */
const findPathRoots = (cwd) => {
  const abs = path.resolve(cwd || process.cwd());
  const roots = [abs];
  let dir = abs;
  for (;;) {
    try {
      if (
        fs.existsSync(path.join(dir, 'package.json')) ||
        fs.existsSync(path.join(dir, '.git'))
      ) {
        roots.push(dir);
      }
    } catch {
      // ignore
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return [...new Set(roots)].sort((a, b) => b.length - a.length);
};

const isInternalFrame = (file) => {
  const f = asText(file);
  return (
    f.startsWith('node:') ||
    f.includes('/node:') ||
    f.includes('node:internal') ||
    f.includes('internal/modules/') ||
    f.includes('internal/process/') ||
    f.includes('internal/main/')
  );
};

const isRunTemp = (file) => {
  const base = path.basename(asText(file));
  return base.startsWith('.metascope-run-');
};

const shortPath = (file, roots, label = 'Example') => {
  let abs = asText(file);
  if (!path.isAbsolute(abs) && roots[0]) {
    abs = path.resolve(roots[0], abs);
  }
  if (isRunTemp(abs)) return label || 'Example';
  for (const root of roots) {
    const rel = path.relative(root, abs);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
      const norm = rel.split(path.sep).join('/');
      const nm = norm.indexOf('node_modules/');
      if (nm !== -1) return norm.slice(nm + 'node_modules/'.length);
      return norm;
    }
    if (abs === root) return '.';
  }
  const parts = abs.split(/[/\\]/).filter(Boolean);
  return parts.slice(-2).join('/');
};

const adjustRow = (file, row, preludeLines) => {
  let n = Number(row);
  if (isRunTemp(file) && preludeLines > 0) {
    n = Math.max(1, n - preludeLines);
  }
  return n;
};

/** Temp-run sites: `Example line:6` / `demo.js line:6` (not path:line). */
const formatRunLoc = (file, row, col, opts) => {
  const { roots, label, preludeLines } = opts;
  const short = shortPath(file, roots, label);
  const adj = adjustRow(file, row, preludeLines);
  if (isRunTemp(file)) {
    if (col !== undefined && col !== null) {
      return `${short} line:${adj}:${col}`;
    }
    return `${short} line:${adj}`;
  }
  return col !== undefined && col !== null
    ? `${short}:${adj}:${col}`
    : `${short}:${adj}`;
};

const formatStackLine = (line, opts) => {
  const { label, preludeLines } = opts;
  const m = line.match(FRAME_RE);
  if (m) {
    const [, prefix, name, file, row, col] = m;
    if (isInternalFrame(file)) return null;
    const loc = formatRunLoc(file, row, col, opts);
    if (name && name !== 'Object.<anonymous>') {
      const nice = name
        .replace(/^Object\./, '')
        .replace(/\[as \w+\]/g, '')
        .trim();
      return `${prefix}${nice} (${loc})`;
    }
    return `${prefix}${loc}`;
  }
  const bare = line.match(BARE_LOC_RE);
  if (bare) {
    const [, file, row, col] = bare;
    if (isInternalFrame(file)) return null;
    return formatRunLoc(file, row, col, opts);
  }
  if (line.includes('.metascope-run-')) {
    const re =
      /(?:file:\/\/)?[^\s)]*\.metascope-run-[^\s:)]+(?::(\d+)(?::(\d+))?)?/g;
    const replaceLoc = (_, row, col) => {
      if (!row) return label;
      const adj = adjustRow('.metascope-run-x', row, preludeLines);
      if (col !== undefined && col !== null) {
        return `${label} line:${adj}:${col}`;
      }
      return `${label} line:${adj}`;
    };
    return line.replace(re, replaceLoc);
  }
  return line;
};

const formatStackText = (text, cwd, opts = {}) => {
  const raw = asText(text);
  const hasNl = raw.includes('\n');
  const hasAt = /\sat\s/.test(raw);
  const hasTemp = raw.includes('.metascope-run-');
  if (!hasNl && !hasAt && !hasTemp) {
    return raw;
  }
  const label = opts.label || 'Example';
  const preludeLines = Math.max(0, Number(opts.preludeLines) || 0);
  const roots = findPathRoots(cwd);
  const locOpts = { roots, label, preludeLines };
  const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const out = [];
  for (const line of lines) {
    const formatted = formatStackLine(line, locOpts);
    if (formatted !== null && formatted !== undefined) {
      out.push(formatted);
    }
  }

  // Drop one blank line after the caret (`    ^\n\nError` → `    ^\nError`)
  for (let i = 0; i < out.length - 1; i++) {
    if (/^\s*\^\s*$/.test(out[i]) && out[i + 1] === '') {
      out.splice(i + 1, 1);
    }
  }

  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+$/gm, '');
};

module.exports = { findPathRoots, isRunTemp, shortPath, formatStackText };
