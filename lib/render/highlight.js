'use strict';

const { paintCode } = require('../theme');

const ESC = '\\u001b';
const ANSI_RE = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');

const STORAGE = new Set([
  'const',
  'let',
  'var',
  'function',
  'class',
  'extends',
  'static',
  'async',
  'get',
  'set',
  'constructor',
  'new',
  'typeof',
  'instanceof',
  'void',
  'delete',
  'yield',
  'await',
  'import',
  'export',
  'from',
  'as',
  'default',
  'type',
  'interface',
  'implements',
  'enum',
  'namespace',
  'module',
  'declare',
  'abstract',
  'readonly',
  'private',
  'public',
  'protected',
  'override',
  'satisfies',
]);

const CONTROL = new Set([
  'if',
  'else',
  'for',
  'while',
  'do',
  'switch',
  'case',
  'break',
  'continue',
  'return',
  'throw',
  'try',
  'catch',
  'finally',
  'with',
  'of',
  'in',
]);

const LITERALS = new Set([
  'true',
  'false',
  'null',
  'undefined',
  'NaN',
  'Infinity',
  'this',
  'super',
]);

const TYPES = new Set([
  'string',
  'number',
  'boolean',
  'symbol',
  'bigint',
  'object',
  'any',
  'unknown',
  'never',
  'void',
  'keyof',
  'infer',
  'unique',
  'asserts',
  'is',
]);

const BUILTINS = new Set([
  'console',
  'Math',
  'JSON',
  'Date',
  'Array',
  'Object',
  'String',
  'Number',
  'Boolean',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'Promise',
  'Error',
  'RegExp',
  'Symbol',
  'Proxy',
  'Reflect',
  'Intl',
  'Buffer',
  'process',
  'module',
  'exports',
  'require',
  'global',
  'globalThis',
  'window',
  'document',
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'encodeURI',
  'decodeURI',
  'encodeURIComponent',
  'decodeURIComponent',
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',
  'fetch',
  'URL',
  'URLSearchParams',
]);

const c = (style, text) => paintCode(style, text);

const peekIdent = (source, i) => {
  if (!/[A-Za-z_$]/.test(source[i] || '')) return null;
  let j = i + 1;
  while (j < source.length && /[A-Za-z0-9_$]/.test(source[j])) j++;
  return source.slice(i, j);
};

const skipWs = (source, i) => {
  while (i < source.length && /\s/.test(source[i])) i++;
  return i;
};

const highlightJsFamily = (source, ts = false) => {
  const out = [];
  let i = 0;
  const n = source.length;
  let expectName = null; // 'function' | 'class' | 'type'

  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === '/' && next === '/') {
      let j = i + 2;
      while (j < n && source[j] !== '\n') j++;
      out.push(c('comment', source.slice(i, j)));
      i = j;
      continue;
    }

    if (ch === '/' && next === '*') {
      let j = i + 2;
      while (j < n && !(source[j] === '*' && source[j + 1] === '/')) j++;
      j = Math.min(j + 2, n);
      out.push(c('comment', source.slice(i, j)));
      i = j;
      continue;
    }

    if (ch === '`') {
      const r = highlightTemplate(source, i);
      out.push(r.text);
      i = r.end;
      continue;
    }

    if (ch === "'" || ch === '"') {
      const { text, end } = readString(source, i);
      out.push(c('string', text));
      i = end;
      continue;
    }

    if (ch === '/' && isRegexContext(out)) {
      const { text, end } = readRegex(source, i);
      out.push(c('regex', text));
      i = end;
      continue;
    }

    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(next || ''))) {
      let j = i;
      if (source.startsWith('0x', i) || source.startsWith('0X', i)) {
        j += 2;
        while (j < n && /[0-9a-fA-F_]/.test(source[j])) j++;
      } else if (source.startsWith('0b', i) || source.startsWith('0B', i)) {
        j += 2;
        while (j < n && /[01_]/.test(source[j])) j++;
      } else if (source.startsWith('0o', i) || source.startsWith('0O', i)) {
        j += 2;
        while (j < n && /[0-7_]/.test(source[j])) j++;
      } else {
        while (j < n && /[0-9_n.]/.test(source[j])) j++;
        if (source[j] === 'e' || source[j] === 'E') {
          j++;
          if (source[j] === '+' || source[j] === '-') j++;
          while (j < n && /[0-9_]/.test(source[j])) j++;
        }
      }
      out.push(c('number', source.slice(i, j)));
      i = j;
      continue;
    }

    if (ch === '@') {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_$]/.test(source[j])) j++;
      out.push(c('decorator', source.slice(i, j)));
      i = j;
      expectName = null;
      continue;
    }

    if (/[A-Za-z_$]/.test(ch)) {
      const word = peekIdent(source, i);
      const end = i + word.length;
      const k = skipWs(source, end);
      const after = source[k];

      if (expectName === 'function') {
        out.push(c('function', word));
        expectName = null;
      } else if (expectName === 'class' || expectName === 'type') {
        out.push(c('className', word));
        expectName = null;
      } else if (
        STORAGE.has(word) ||
        (ts && TYPES.has(word) && word !== 'string')
      ) {
        out.push(c(TYPES.has(word) ? 'type' : 'storage', word));
        if (word === 'function') {
          expectName = 'function';
        } else if (
          word === 'class' ||
          word === 'interface' ||
          word === 'type' ||
          word === 'enum'
        ) {
          expectName = word === 'type' ? 'type' : 'class';
        } else {
          expectName = null;
        }
      } else if (CONTROL.has(word)) {
        out.push(c('control', word));
        expectName = null;
      } else if (LITERALS.has(word)) {
        out.push(c('literal', word));
        expectName = null;
      } else if (ts && TYPES.has(word)) {
        out.push(c('type', word));
        expectName = null;
      } else if (BUILTINS.has(word)) {
        out.push(c('className', word));
        expectName = null;
      } else if (/^[A-Z][A-Z0-9_]+$/.test(word)) {
        out.push(c('constant', word));
        expectName = null;
      } else if (/^[A-Z]/.test(word)) {
        out.push(c('className', word));
        expectName = null;
      } else if (after === '(') {
        out.push(c('function', word));
        expectName = null;
      } else if (after === '=') {
        const k2 = skipWs(source, k + 1);
        const rhs = source.slice(k2, k2 + 8);
        if (
          rhs.startsWith('async') ||
          rhs.startsWith('function') ||
          source[k2] === '('
        ) {
          out.push(c('function', word));
        } else {
          out.push(c('variable', word));
        }
        expectName = null;
      } else {
        // property after dot?
        const prev = plainTail(out);
        if (/\.$/.test(prev)) out.push(c('property', word));
        else out.push(c('variable', word));
        expectName = null;
      }
      i = end;
      continue;
    }

    if (/[=<>!+\-*/%&|^~?:]/.test(ch)) {
      let j = i + 1;
      // multi-char operators
      const two = source.slice(i, i + 2);
      const three = source.slice(i, i + 3);
      if (['===', '!==', '>>>', '**=', '&&=', '||=', '??='].includes(three)) {
        j = i + 3;
      } else if (
        [
          '==',
          '!=',
          '<=',
          '>=',
          '&&',
          '||',
          '??',
          '=>',
          '++',
          '--',
          '<<',
          '>>',
          '**',
          '+=',
          '-=',
          '*=',
          '/=',
          '%=',
          '&=',
          '|=',
          '^=',
        ].includes(two)
      ) {
        j = i + 2;
      }
      out.push(c('operator', source.slice(i, j)));
      i = j;
      expectName = null;
      continue;
    }

    if (/[{}()[\];,.]/.test(ch)) {
      out.push(c('punct', ch));
      i++;
      continue;
    }

    out.push(ch);
    i++;
  }

  return out.join('');
};

function plainTail(parts) {
  return parts.join('').replace(ANSI_RE, '').slice(-8);
}

function readString(source, i) {
  const q = source[i];
  let j = i + 1;
  const n = source.length;
  while (j < n) {
    if (source[j] === '\\') {
      j += 2;
      continue;
    }
    if (source[j] === q) {
      j++;
      break;
    }
    if (source[j] === '\n') break;
    j++;
  }
  return { text: source.slice(i, j), end: j };
}

function readRegex(source, i) {
  let j = i + 1;
  const n = source.length;
  while (j < n) {
    if (source[j] === '\\') {
      j += 2;
      continue;
    }
    if (source[j] === '[') {
      j++;
      while (j < n && source[j] !== ']') {
        if (source[j] === '\\') j++;
        j++;
      }
      j++;
      continue;
    }
    if (source[j] === '/') {
      j++;
      while (j < n && /[a-z]/i.test(source[j])) j++;
      break;
    }
    if (source[j] === '\n') break;
    j++;
  }
  return { text: source.slice(i, j), end: j };
}

function highlightTemplate(source, i) {
  const n = source.length;
  let j = i + 1;
  const parts = [c('template', '`')];
  let buf = '';
  const flush = () => {
    if (buf) {
      parts.push(c('template', buf));
      buf = '';
    }
  };
  while (j < n) {
    if (source[j] === '\\') {
      flush();
      parts.push(c('escape', source.slice(j, j + 2)));
      j += 2;
      continue;
    }
    if (source[j] === '`') {
      flush();
      parts.push(c('template', '`'));
      j++;
      break;
    }
    if (source[j] === '$' && source[j + 1] === '{') {
      flush();
      parts.push(c('interpolation', '${'));
      j += 2;
      let depth = 1;
      const start = j;
      while (j < n && depth > 0) {
        if (source[j] === "'" || source[j] === '"' || source[j] === '`') {
          // nested string — skip simply
          const q = source[j++];
          while (j < n && source[j] !== q) {
            if (source[j] === '\\') j++;
            j++;
          }
          j++;
          continue;
        }
        if (source[j] === '{') depth++;
        if (source[j] === '}') {
          depth--;
          if (depth === 0) break;
        }
        j++;
      }
      const expr = source.slice(start, j);
      parts.push(highlightJsFamily(expr, false));
      if (source[j] === '}') {
        parts.push(c('interpolation', '}'));
        j++;
      }
      continue;
    }
    buf += source[j];
    j++;
  }
  flush();
  return { text: parts.join(''), end: j };
}

function isRegexContext(parts) {
  const prev = parts.join('').replace(ANSI_RE, '').trimEnd();
  if (!prev) return true;
  return (
    /[=(:,[?!&|{};]$/.test(prev) ||
    /(?:return|case|throw|=>|typeof|void)$/.test(prev)
  );
}

const highlightJson = (source) => {
  const out = [];
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    if (ch === '"') {
      const { text, end } = readString(source, i);
      let k = end;
      while (k < n && /\s/.test(source[k])) k++;
      out.push(c(source[k] === ':' ? 'property' : 'string', text));
      i = end;
      continue;
    }
    if (/[0-9-]/.test(ch)) {
      let j = i;
      while (j < n && /[0-9.eE+-]/.test(source[j])) j++;
      out.push(c('number', source.slice(i, j)));
      i = j;
      continue;
    }
    if (/[a-z]/.test(ch)) {
      let j = i;
      while (j < n && /[a-z]/.test(source[j])) j++;
      const word = source.slice(i, j);
      out.push(
        LITERALS.has(word) ||
          word === 'true' ||
          word === 'false' ||
          word === 'null'
          ? c('literal', word)
          : word,
      );
      i = j;
      continue;
    }
    if (/[{}[\],:]/.test(ch)) {
      out.push(c('punct', ch));
      i++;
      continue;
    }
    out.push(ch);
    i++;
  }
  return out.join('');
};

const highlightCss = (source) => {
  const out = [];
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '/' && next === '*') {
      let j = i + 2;
      while (j < n && !(source[j] === '*' && source[j + 1] === '/')) j++;
      j = Math.min(j + 2, n);
      out.push(c('comment', source.slice(i, j)));
      i = j;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const { text, end } = readString(source, i);
      out.push(c('string', text));
      i = end;
      continue;
    }
    if (ch === '@') {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9-]/.test(source[j])) j++;
      out.push(c('keyword', source.slice(i, j)));
      i = j;
      continue;
    }
    if (ch === '#' || ch === '.') {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_-]/.test(source[j])) j++;
      out.push(c(ch === '#' ? 'constant' : 'className', source.slice(i, j)));
      i = j;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < n && /[0-9.%]/.test(source[j])) j++;
      out.push(c('number', source.slice(i, j)));
      i = j;
      continue;
    }
    if (/[A-Za-z_-]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_-]/.test(source[j])) j++;
      const word = source.slice(i, j);
      let k = j;
      while (k < n && /\s/.test(source[k])) k++;
      if (source[k] === ':') out.push(c('property', word));
      else if (source[k] === '{') out.push(c('tag', word));
      else out.push(c('plain', word));
      i = j;
      continue;
    }
    if (/[{};:,]/.test(ch)) {
      out.push(c('punct', ch));
      i++;
      continue;
    }
    out.push(ch);
    i++;
  }
  return out.join('');
};

const highlightHtml = (source) => {
  const out = [];
  let i = 0;
  const n = source.length;
  while (i < n) {
    if (source.startsWith('<!--', i)) {
      let j = source.indexOf('-->', i + 4);
      j = j === -1 ? n : j + 3;
      out.push(c('comment', source.slice(i, j)));
      i = j;
      continue;
    }
    if (source[i] === '<') {
      let j = i + 1;
      while (j < n && source[j] !== '>') {
        if (source[j] === '"' || source[j] === "'") {
          const q = source[j++];
          while (j < n && source[j] !== q) {
            if (source[j] === '\\') j++;
            j++;
          }
          j++;
          continue;
        }
        j++;
      }
      if (j < n) j++;
      out.push(colorHtmlTag(source.slice(i, j)));
      i = j;
      continue;
    }
    let j = i + 1;
    while (j < n && source[j] !== '<' && !source.startsWith('<!--', j)) j++;
    out.push(c('plain', source.slice(i, j)));
    i = j;
  }
  return out.join('');
};

function colorHtmlTag(tag) {
  const out = [];
  let i = 0;
  const n = tag.length;
  out.push(c('punct', '<'));
  i = 1;
  if (tag[i] === '/') {
    out.push(c('punct', '/'));
    i++;
  }
  let j = i;
  while (j < n && /[A-Za-z0-9:-]/.test(tag[j])) j++;
  out.push(c('tag', tag.slice(i, j)));
  i = j;
  while (i < n) {
    if (tag[i] === '>' || (tag[i] === '/' && tag[i + 1] === '>')) {
      out.push(c('punct', tag.slice(i)));
      break;
    }
    if (/\s/.test(tag[i])) {
      out.push(tag[i]);
      i++;
      continue;
    }
    if (tag[i] === '"' || tag[i] === "'") {
      const q = tag[i];
      let k = i + 1;
      while (k < n && tag[k] !== q) k++;
      k = Math.min(k + 1, n);
      out.push(c('string', tag.slice(i, k)));
      i = k;
      continue;
    }
    if (/[A-Za-z_:]/.test(tag[i])) {
      let k = i + 1;
      while (k < n && /[A-Za-z0-9_:.-]/.test(tag[k])) k++;
      out.push(c('attr', tag.slice(i, k)));
      i = k;
      continue;
    }
    out.push(c('punct', tag[i]));
    i++;
  }
  return out.join('');
}

const highlightCsv = (source) => {
  const lines = source.split(/\r?\n/);
  return lines
    .map((line, row) => {
      if (!line) return '';
      const cells = splitCsv(line);
      return cells
        .map((cell, col) => {
          if (row === 0) return c('function', cell);
          if (/^-?\d+(\.\d+)?$/.test(cell.trim())) return c('number', cell);
          if (col % 2 === 0) return c('string', cell);
          return c('variable', cell);
        })
        .join(c('punct', ','));
    })
    .join('\n');
};

function splitCsv(line) {
  const cells = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQ = !inQ;
        cur += ch;
      }
      continue;
    }
    if (ch === ',' && !inQ) {
      cells.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  cells.push(cur);
  return cells;
}

const BASH_KEYWORDS = new Set([
  'if',
  'then',
  'else',
  'elif',
  'fi',
  'for',
  'while',
  'until',
  'do',
  'done',
  'case',
  'esac',
  'function',
  'select',
  'in',
  'time',
  'coproc',
]);

const BASH_BUILTINS = new Set([
  'echo',
  'printf',
  'cd',
  'pwd',
  'exit',
  'export',
  'source',
  'alias',
  'unalias',
  'local',
  'declare',
  'typeset',
  'readonly',
  'unset',
  'shift',
  'read',
  'test',
  'true',
  'false',
  'exec',
  'eval',
  'set',
  'trap',
  'wait',
  'kill',
  'type',
  'command',
  'builtin',
  'return',
  'break',
  'continue',
  'pushd',
  'popd',
  'dirs',
  'getopts',
  'mapfile',
  'readarray',
  'let',
  'umask',
  'ulimit',
  'fg',
  'bg',
  'jobs',
  'hash',
  'help',
  'enable',
  'caller',
  'bind',
  'compgen',
  'complete',
]);

const highlightBash = (source) => {
  const out = [];
  let i = 0;
  const n = source.length;

  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === '#' && (i === 0 || /\s/.test(source[i - 1]))) {
      let j = i;
      while (j < n && source[j] !== '\n') j++;
      out.push(c('comment', source.slice(i, j)));
      i = j;
      continue;
    }

    if (ch === "'") {
      let j = i + 1;
      while (j < n && source[j] !== "'") j++;
      if (j < n) j++;
      out.push(c('string', source.slice(i, j)));
      i = j;
      continue;
    }

    if (ch === '"') {
      let j = i + 1;
      let chunk = '"';
      while (j < n && source[j] !== '"') {
        if (source[j] === '\\' && j + 1 < n) {
          chunk += source.slice(j, j + 2);
          j += 2;
          continue;
        }
        if (source[j] === '$') {
          out.push(c('string', chunk));
          chunk = '';
          const { text, end } = readBashVar(source, j);
          out.push(c('variable', text));
          j = end;
          continue;
        }
        chunk += source[j];
        j++;
      }
      if (j < n) {
        chunk += '"';
        j++;
      }
      if (chunk) out.push(c('string', chunk));
      i = j;
      continue;
    }

    if (ch === '`') {
      let j = i + 1;
      while (j < n && source[j] !== '`') j++;
      if (j < n) j++;
      out.push(c('string', source.slice(i, j)));
      i = j;
      continue;
    }

    if (ch === '$') {
      const { text, end } = readBashVar(source, i);
      out.push(c('variable', text));
      i = end;
      continue;
    }

    if (ch === '-' && /[A-Za-z0-9]/.test(next || '')) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_-]/.test(source[j])) j++;
      out.push(c('attr', source.slice(i, j)));
      i = j;
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(source[j])) j++;
      const word = source.slice(i, j);
      if (BASH_KEYWORDS.has(word)) out.push(c('control', word));
      else if (BASH_BUILTINS.has(word)) out.push(c('function', word));
      else if (j < n && source[j] === '=') out.push(c('variable', word));
      else out.push(c('plain', word));
      i = j;
      continue;
    }

    if (/[0-9]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[0-9]/.test(source[j])) j++;
      out.push(c('number', source.slice(i, j)));
      i = j;
      continue;
    }

    if ('|&;<>(){}'.includes(ch)) {
      let j = i + 1;
      if (
        (ch === '|' && next === '|') ||
        (ch === '&' && next === '&') ||
        (ch === '>' && next === '>') ||
        (ch === '<' && next === '<')
      ) {
        j = i + 2;
      }
      out.push(c('operator', source.slice(i, j)));
      i = j;
      continue;
    }

    out.push(c('plain', ch));
    i++;
  }

  return out.join('');
};

function readBashVar(source, i) {
  // $NAME | ${...} | $1 | $? | $!
  if (source[i + 1] === '{') {
    let j = i + 2;
    while (j < source.length && source[j] !== '}') j++;
    if (j < source.length) j++;
    return { text: source.slice(i, j), end: j };
  }
  if (/[0-9#?$!*@-]/.test(source[i + 1] || '')) {
    return { text: source.slice(i, i + 2), end: i + 2 };
  }
  let j = i + 1;
  while (j < source.length && /[A-Za-z0-9_]/.test(source[j])) j++;
  if (j === i + 1) return { text: '$', end: i + 1 };
  return { text: source.slice(i, j), end: j };
}

/** ISO / common datetime with gray bg; tab fields in rotating colors. */
const LOG_DATETIME_RE =
  /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/;

const LOG_COL_FG = [
  [210, 210, 220],
  [120, 180, 220],
  [180, 160, 220],
  [140, 200, 160],
  [220, 180, 120],
  [220, 140, 160],
  [160, 200, 200],
  [200, 170, 140],
];

const LOG_TAG_FG = {
  error: [230, 90, 90],
  err: [230, 90, 90],
  warn: [230, 180, 80],
  warning: [230, 180, 80],
  info: [100, 170, 230],
  debug: [140, 160, 180],
  log: [180, 180, 190],
};

const paintLogDate = (text) =>
  `\x1b[48;2;48;48;56m\x1b[38;2;210;210;220m${text}\x1b[0m`;

const paintLogCol = (index, text) => {
  if (!text) return '';
  const rgb = LOG_COL_FG[index % LOG_COL_FG.length];
  return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m${text}\x1b[0m`;
};

const paintLogTag = (tag) => {
  const name = tag.replace(/^\[|\]$/g, '').toLowerCase();
  const rgb = LOG_TAG_FG[name] || [180, 180, 190];
  return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m\x1b[1m${tag}\x1b[0m`;
};

const highlightLogLine = (line) => {
  if (!line) return '';
  let rest = line;
  let out = '';

  const dm = rest.match(LOG_DATETIME_RE);
  if (dm) {
    out += paintLogDate(dm[1]);
    rest = rest.slice(dm[1].length);
  }

  const tag = rest.match(/^(\s*)(\[[^\]]+\])/);
  if (tag) {
    out += tag[1] + paintLogTag(tag[2]);
    rest = rest.slice(tag[0].length);
  }

  if (rest.includes('\t')) {
    const parts = rest.split('\t');
    out += parts.map((p, i) => paintLogCol(i, p)).join('\t');
    return out;
  }

  if (rest) out += paintLogCol(0, rest);
  return out;
};

const highlightLog = (source) =>
  String(source || '')
    .split('\n')
    .map(highlightLogLine)
    .join('\n');

/** Dotfiles / configs: comments, KEY=value, gitignore bang/negation. */
const highlightDot = (source) =>
  String(source || '')
    .split('\n')
    .map((line) => {
      if (!line) return '';
      const t = line.trimStart();
      if (t.startsWith('#') || t.startsWith(';')) return c('comment', line);
      if (t.startsWith('!')) {
        const lead = line.slice(0, line.length - t.length);
        return lead + c('operator', '!') + c('plain', t.slice(1));
      }
      const eq = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_.-]*)(\s*=\s*)(.*)$/);
      if (eq) {
        return (
          eq[1] +
          c('variable', eq[2]) +
          c('operator', eq[3]) +
          c('string', eq[4])
        );
      }
      return c('plain', line);
    })
    .join('\n');

const highlightTxt = (source) =>
  source
    .split('\n')
    .map((line) => {
      if (!line) return '';
      const re = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/g;
      let out = '';
      let last = 0;
      let m = re.exec(line);
      while (m !== null) {
        if (m.index > last) out += c('plain', line.slice(last, m.index));
        out += c('string', m[0]);
        last = m.index + m[0].length;
        m = re.exec(line);
      }
      if (last < line.length) out += c('plain', line.slice(last));
      return out || c('plain', line);
    })
    .join('\n');

const highlight = (lang, source) => {
  switch (lang) {
    case 'js':
    case 'mjs':
      return highlightJsFamily(source, false);
    case 'ts':
    case 'dts':
      return highlightJsFamily(source, true);
    case 'json':
      return highlightJson(source);
    case 'css':
      return highlightCss(source);
    case 'html':
      return highlightHtml(source);
    case 'csv':
      return highlightCsv(source);
    case 'bash':
    case 'sh':
    case 'shell':
    case 'zsh':
      return highlightBash(source);
    case 'log':
      return highlightLog(source);
    case 'dot':
      return highlightDot(source);
    case 'txt':
    default:
      return highlightTxt(source);
  }
};

const highlightLines = (lang, source) => highlight(lang, source).split('\n');

module.exports = {
  highlight,
  highlightLines,
  highlightJsFamily,
  highlightJson,
  highlightCss,
  highlightHtml,
  highlightCsv,
  highlightBash,
  highlightLog,
  highlightDot,
  highlightTxt,
};
