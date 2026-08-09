'use strict';

const fs = require('node:fs');
const path = require('node:path');

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
  const f = String(file || '');
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
  const base = path.basename(String(file || ''));
  return base.startsWith('.metascope-run-');
};

const shortPath = (file, roots, label = 'Example') => {
  let abs = String(file || '');
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

/** `at fn (file:line:col)` or `at file:line:col` */
const FRAME_RE =
  /^(\s*at\s+)(?:(.*?)\s+\()?(?:file:\/\/)?(.+?):(\d+)(?::(\d+))?\)?\s*$/;

/** Bare `/abs/path/file.js:11` (Node often prints this above the caret). */
const BARE_LOC_RE = new RegExp(
  '^(?:file:\\/\\/)?(\\/?.*?\\.metascope-run-[^\\s:]+|\\/[^\\s:]+)' +
    ':(\\d+)(?::(\\d+))?\\s*$',
);

/**
 * Pretty-print Node-like stack traces: drop internals, shorten repo paths,
 * map temp run files to a short label (file name or Example).
 *
 * @param {string} text
 * @param {string} cwd
 * @param {{ label?: string, preludeLines?: number }} [opts]
 */
const formatStackText = (text, cwd, opts = {}) => {
  const raw = String(text || '');
  if (
    !raw.includes('\n') &&
    !/\sat\s/.test(raw) &&
    !raw.includes('.metascope-run-')
  ) {
    return raw;
  }

  const label = opts.label || 'Example';
  const preludeLines = Math.max(0, Number(opts.preludeLines) || 0);
  const roots = findPathRoots(cwd);
  const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const out = [];

  const adjustRow = (file, row) => {
    let n = Number(row);
    if (isRunTemp(file) && preludeLines > 0) {
      n = Math.max(1, n - preludeLines);
    }
    return n;
  };

  /** Temp-run sites: `Example line:6` / `demo.js line:6` (not path:line). */
  const formatRunLoc = (file, row, col) => {
    const short = shortPath(file, roots, label);
    const adj = adjustRow(file, row);
    if (isRunTemp(file)) {
      if (col !== undefined && col !== null) {
        return `${short} line:${adj}:${col}`;
      }
      return `${short} line:${adj}`;
    }
    if (col !== undefined && col !== null) {
      return `${short}:${adj}:${col}`;
    }
    return `${short}:${adj}`;
  };

  for (const line of lines) {
    const m = line.match(FRAME_RE);
    if (m) {
      const [, prefix, name, file, row, col] = m;
      if (isInternalFrame(file)) continue;

      const loc = formatRunLoc(file, row, col);
      if (name && name !== 'Object.<anonymous>') {
        const nice = name
          .replace(/^Object\./, '')
          .replace(/\[as \w+\]/g, '')
          .trim();
        out.push(`${prefix}${nice} (${loc})`);
      } else {
        out.push(`${prefix}${loc}`);
      }
      continue;
    }

    const bare = line.match(BARE_LOC_RE);
    if (bare) {
      const [, file, row, col] = bare;
      if (isInternalFrame(file)) continue;
      out.push(formatRunLoc(file, row, col));
      continue;
    }

    // Any leftover absolute temp-run paths in free text
    if (line.includes('.metascope-run-')) {
      const tempRe =
        /(?:file:\/\/)?[^\s)]*\.metascope-run-[^\s:)]+(?::(\d+)(?::(\d+))?)?/g;
      out.push(
        line.replace(tempRe, (_, row, col) => {
          if (!row) return label;
          const adj = adjustRow('.metascope-run-x', row);
          if (col !== undefined && col !== null) {
            return `${label} line:${adj}:${col}`;
          }
          return `${label} line:${adj}`;
        }),
      );
      continue;
    }

    out.push(line);
  }

  // Drop one blank line after the caret marker
  // (`    ^\n\nError` → `    ^\nError`)
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

module.exports = { formatStackText, findPathRoots, shortPath, isRunTemp };
