'use strict';

const { paintCode } = require('../theme.js');
const { asText } = require('../wrap.js');

const STORAGE = [
  'const', 'let', 'var', 'function', 'class', 'extends', 'static', 'async',
  'get', 'set', 'constructor', 'new', 'typeof', 'instanceof', 'void', 'delete',
  'yield', 'await', 'import', 'export', 'from', 'as', 'default', 'type',
  'interface', 'implements', 'enum', 'namespace', 'module', 'declare',
  'abstract', 'readonly', 'private', 'public', 'protected', 'override',
  'satisfies',
];

const CONTROL = [
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break',
  'continue', 'return', 'throw', 'try', 'catch', 'finally', 'with', 'of', 'in',
];

const LITERALS = [
  'true', 'false', 'null', 'undefined', 'NaN', 'Infinity', 'this', 'super',
];

const TYPES = [
  'string', 'number', 'boolean', 'symbol', 'bigint', 'object', 'any',
  'unknown', 'never', 'void', 'keyof', 'infer', 'unique', 'asserts', 'is',
];

const BUILTINS = [
  'console', 'Math', 'JSON', 'Date', 'Array', 'Object', 'String', 'Number',
  'Boolean', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'Error', 'RegExp',
  'Symbol', 'Proxy', 'Reflect', 'Intl', 'Buffer', 'process', 'module',
  'exports', 'require', 'global', 'globalThis', 'window', 'document',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURI', 'decodeURI',
  'encodeURIComponent', 'decodeURIComponent', 'setTimeout', 'setInterval',
  'clearTimeout', 'clearInterval', 'fetch', 'URL', 'URLSearchParams',
];

const OP3 = ['===', '!==', '>>>', '**=', '&&=', '||=', '??='];

const OP2 = [
  '==', '!=', '<=', '>=', '&&', '||', '??', '=>', '++', '--', '<<', '>>',
  '**', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=',
];

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

const readUntilNl = (source, i) => {
  let j = i;
  const n = source.length;
  while (j < n && source[j] !== '\n') j++;
  return { text: source.slice(i, j), end: j };
};

const readBlockComment = (source, i) => {
  let j = i + 2;
  const n = source.length;
  while (j < n && !(source[j] === '*' && source[j + 1] === '/')) j++;
  j = Math.min(j + 2, n);
  return { text: source.slice(i, j), end: j };
};

const skipQuoted = (source, j) => {
  const q = source[j];
  j += 1;
  const n = source.length;
  while (j < n && source[j] !== q) {
    if (source[j] === '\\') j++;
    j++;
  }
  j++;
  return j;
};

const readJsNumber = (source, i) => {
  const n = source.length;
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
  return { text: source.slice(i, j), end: j };
};

const readJsOperator = (source, i) => {
  const two = source.slice(i, i + 2);
  const three = source.slice(i, i + 3);
  let j = i + 1;
  if (OP3.includes(three)) j = i + 3;
  else if (OP2.includes(two)) j = i + 2;
  return { text: source.slice(i, j), end: j };
};

const plainTail = (parts) => {
  const joined = parts.join('');
  const stripped = joined.replace(/\x1b\[[0-9;]*m/g, '');
  return stripped.slice(-8);
};

const wordStyle = (words, style) => {
  const table = {};
  for (const word of words) table[word] = style;
  return table;
};

const typeOverlay = TYPES.filter((word) => STORAGE.includes(word));

const WORD_STYLE = Object.assign(
  {},
  wordStyle(CONTROL, 'control'),
  wordStyle(LITERALS, 'literal'),
  wordStyle(BUILTINS, 'className'),
  wordStyle(STORAGE, 'storage'),
  wordStyle(typeOverlay, 'type'),
);

const TS_WORD_STYLE = Object.assign(
  {},
  WORD_STYLE,
  wordStyle(TYPES, 'type'),
);

const EXPECT_STYLE = {
  function: 'function',
  class: 'className',
  type: 'className',
};

const NEXT_EXPECT = {
  function: 'function',
  class: 'class',
  interface: 'class',
  enum: 'class',
  type: 'type',
};

const styleExpected = ({ expectName }) => EXPECT_STYLE[expectName];

const styleKeyword = ({ word, ts }) => {
  const table = ts ? TS_WORD_STYLE : WORD_STYLE;
  return table[word];
};

const styleConstant = ({ word }) => {
  if (/^[A-Z][A-Z0-9_]+$/.test(word)) return 'constant';
};

const stylePascal = ({ word }) => {
  if (/^[A-Z]/.test(word)) return 'className';
};

const styleCall = ({ after }) => {
  if (after === '(') return 'function';
};

const styleAssign = ({ after, source, k }) => {
  if (after !== '=') return;
  const k2 = skipWs(source, k + 1);
  const rhs = source.slice(k2, k2 + 8);
  if (rhs.startsWith('async')) return 'function';
  if (rhs.startsWith('function')) return 'function';
  if (source[k2] === '(') return 'function';
  return 'variable';
};

const styleProperty = ({ out }) => {
  const prev = plainTail(out);
  if (/\.$/.test(prev)) return 'property';
};

const styleVariable = () => 'variable';

const IDENT_RULES = [
  styleExpected,
  styleKeyword,
  styleConstant,
  stylePascal,
  styleCall,
  styleAssign,
  styleProperty,
  styleVariable,
];

const identStyle = (ctx) => {
  for (const rule of IDENT_RULES) {
    const style = rule(ctx);
    if (style) return style;
  }
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
      const { text, end } = readUntilNl(source, i);
      out.push(paintCode('comment', text));
      i = end;
      continue;
    }

    if (ch === '/' && next === '*') {
      const { text, end } = readBlockComment(source, i);
      out.push(paintCode('comment', text));
      i = end;
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
      out.push(paintCode('string', text));
      i = end;
      continue;
    }

    if (ch === '/' && isRegexContext(out)) {
      const { text, end } = readRegex(source, i);
      out.push(paintCode('regex', text));
      i = end;
      continue;
    }

    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(next || ''))) {
      const { text, end } = readJsNumber(source, i);
      out.push(paintCode('number', text));
      i = end;
      continue;
    }

    if (ch === '@') {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_$]/.test(source[j])) j++;
      out.push(paintCode('decorator', source.slice(i, j)));
      i = j;
      expectName = null;
      continue;
    }

    if (/[A-Za-z_$]/.test(ch)) {
      const word = peekIdent(source, i);
      const end = i + word.length;
      const k = skipWs(source, end);
      const after = source[k];
      const ctx = { word, ts, after, source, k, out, expectName };
      out.push(paintCode(identStyle(ctx), word));
      if (EXPECT_STYLE[expectName]) expectName = null;
      else expectName = NEXT_EXPECT[word] ?? null;
      i = end;
      continue;
    }

    if (/[=<>!+\-*/%&|^~?:]/.test(ch)) {
      const { text, end } = readJsOperator(source, i);
      out.push(paintCode('operator', text));
      i = end;
      expectName = null;
      continue;
    }
    if (/[{}()[\];,.]/.test(ch)) {
      out.push(paintCode('punct', ch));
      i++;
      continue;
    }
    out.push(ch);
    i++;
  }
  return out.join('');
};

const readString = (source, i) => {
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
};

const readRegex = (source, i) => {
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
};

const readTemplateInterp = (source, j) => {
  let depth = 1;
  const start = j;
  const n = source.length;
  while (j < n && depth > 0) {
    if (source[j] === "'" || source[j] === '"' || source[j] === '`') {
      j = skipQuoted(source, j);
      continue;
    }
    if (source[j] === '{') depth++;
    if (source[j] === '}') {
      depth--;
      if (depth === 0) break;
    }
    j++;
  }
  return { expr: source.slice(start, j), end: j };
};

const highlightTemplate = (source, i) => {
  const n = source.length;
  let j = i + 1;
  const parts = [paintCode('template', '`')];
  let buf = '';
  const flush = () => {
    if (buf) {
      parts.push(paintCode('template', buf));
      buf = '';
    }
  };
  while (j < n) {
    if (source[j] === '\\') {
      flush();
      parts.push(paintCode('escape', source.slice(j, j + 2)));
      j += 2;
      continue;
    }
    if (source[j] === '`') {
      flush();
      parts.push(paintCode('template', '`'));
      j++;
      break;
    }
    if (source[j] === '$' && source[j + 1] === '{') {
      flush();
      parts.push(paintCode('interpolation', '${'));
      j += 2;
      const interp = readTemplateInterp(source, j);
      parts.push(highlightJsFamily(interp.expr, false));
      j = interp.end;
      if (source[j] === '}') {
        parts.push(paintCode('interpolation', '}'));
        j++;
      }
      continue;
    }
    buf += source[j];
    j++;
  }
  flush();
  return { text: parts.join(''), end: j };
};

const isRegexContext = (parts) => {
  const prev = parts
    .join('')
    .replace(/\x1b\[[0-9;]*m/g, '')
    .trimEnd();
  if (!prev) return true;
  return (
    /[=(:,[?!&|{};]$/.test(prev) ||
    /(?:return|case|throw|=>|typeof|void)$/.test(prev)
  );
};

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
      out.push(paintCode(source[k] === ':' ? 'property' : 'string', text));
      i = end;
      continue;
    }
    if (/[0-9-]/.test(ch)) {
      let j = i;
      while (j < n && /[0-9.eE+-]/.test(source[j])) j++;
      out.push(paintCode('number', source.slice(i, j)));
      i = j;
      continue;
    }
    if (/[a-z]/.test(ch)) {
      let j = i;
      while (j < n && /[a-z]/.test(source[j])) j++;
      const word = source.slice(i, j);
      const isLit =
        LITERALS.includes(word) ||
        word === 'true' ||
        word === 'false' ||
        word === 'null';
      out.push(isLit ? paintCode('literal', word) : word);
      i = j;
      continue;
    }
    if (/[{}[\],:]/.test(ch)) {
      out.push(paintCode('punct', ch));
      i++;
      continue;
    }
    out.push(ch);
    i++;
  }
  return out.join('');
};

const cssWordStyle = (next) => {
  if (next === ':') return 'property';
  if (next === '{') return 'tag';
  return 'plain';
};

const highlightCss = (source) => {
  const out = [];
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '/' && next === '*') {
      const { text, end } = readBlockComment(source, i);
      out.push(paintCode('comment', text));
      i = end;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const { text, end } = readString(source, i);
      out.push(paintCode('string', text));
      i = end;
      continue;
    }
    if (ch === '@') {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9-]/.test(source[j])) j++;
      out.push(paintCode('keyword', source.slice(i, j)));
      i = j;
      continue;
    }
    if (ch === '#' || ch === '.') {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_-]/.test(source[j])) j++;
      const kind = ch === '#' ? 'constant' : 'className';
      out.push(paintCode(kind, source.slice(i, j)));
      i = j;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < n && /[0-9.%]/.test(source[j])) j++;
      out.push(paintCode('number', source.slice(i, j)));
      i = j;
      continue;
    }
    if (/[A-Za-z_-]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_-]/.test(source[j])) j++;
      const word = source.slice(i, j);
      let k = j;
      while (k < n && /\s/.test(source[k])) k++;
      out.push(paintCode(cssWordStyle(source[k]), word));
      i = j;
      continue;
    }
    if (/[{};:,]/.test(ch)) {
      out.push(paintCode('punct', ch));
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
      out.push(paintCode('comment', source.slice(i, j)));
      i = j;
      continue;
    }
    if (source[i] === '<') {
      let j = i + 1;
      while (j < n && source[j] !== '>') {
        if (source[j] === '"' || source[j] === "'") {
          j = skipQuoted(source, j);
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
    out.push(paintCode('plain', source.slice(i, j)));
    i = j;
  }
  return out.join('');
};

const colorHtmlTag = (tag) => {
  const out = [];
  let i = 0;
  const n = tag.length;
  out.push(paintCode('punct', '<'));
  i = 1;
  if (tag[i] === '/') {
    out.push(paintCode('punct', '/'));
    i++;
  }
  let j = i;
  while (j < n && /[A-Za-z0-9:-]/.test(tag[j])) j++;
  out.push(paintCode('tag', tag.slice(i, j)));
  i = j;
  while (i < n) {
    if (tag[i] === '>' || (tag[i] === '/' && tag[i + 1] === '>')) {
      out.push(paintCode('punct', tag.slice(i)));
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
      out.push(paintCode('string', tag.slice(i, k)));
      i = k;
      continue;
    }
    if (/[A-Za-z_:]/.test(tag[i])) {
      let k = i + 1;
      while (k < n && /[A-Za-z0-9_:.-]/.test(tag[k])) k++;
      out.push(paintCode('attr', tag.slice(i, k)));
      i = k;
      continue;
    }
    out.push(paintCode('punct', tag[i]));
    i++;
  }
  return out.join('');
};

const highlightCsvCell = (cell, row, col) => {
  if (row === 0) return paintCode('function', cell);
  const num = /^-?\d+(\.\d+)?$/.test(cell.trim());
  if (num) return paintCode('number', cell);
  if (col % 2 === 0) return paintCode('string', cell);
  return paintCode('variable', cell);
};

const highlightCsvLine = (line, row) => {
  if (!line) return '';
  const cells = splitCsv(line);
  const painted = [];
  for (let col = 0; col < cells.length; col++) {
    painted.push(highlightCsvCell(cells[col], row, col));
  }
  const comma = paintCode('punct', ',');
  return painted.join(comma);
};

const highlightCsv = (source) => {
  const text = asText(source);
  const lines = text.split(/\r?\n/);
  const painted = lines.map(highlightCsvLine);
  return painted.join('\n');
};

const splitCsv = (line) => {
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
};

const BASH_KEYWORDS = [
  'if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'until', 'do', 'done',
  'case', 'esac', 'function', 'select', 'in', 'time', 'coproc',
];

const BASH_BUILTINS = [
  'echo', 'printf', 'cd', 'pwd', 'exit', 'export', 'source', 'alias',
  'unalias', 'local', 'declare', 'typeset', 'readonly', 'unset', 'shift',
  'read', 'test', 'true', 'false', 'exec', 'eval', 'set', 'trap', 'wait',
  'kill', 'type', 'command', 'builtin', 'return', 'break', 'continue',
  'pushd', 'popd', 'dirs', 'getopts', 'mapfile', 'readarray', 'let',
  'umask', 'ulimit', 'fg', 'bg', 'jobs', 'hash', 'help', 'enable', 'caller',
  'bind', 'compgen', 'complete',
];

const readBashVar = (source, i) => {
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
};

const takeQuoted = (source, i) => {
  const q = source[i];
  let j = i + 1;
  const n = source.length;
  while (j < n && source[j] !== q) j++;
  if (j < n) j++;
  return { text: source.slice(i, j), end: j };
};

const takeBashDouble = (source, i, out) => {
  let j = i + 1;
  let chunk = '"';
  const n = source.length;
  while (j < n && source[j] !== '"') {
    if (source[j] === '\\' && j + 1 < n) {
      chunk += source.slice(j, j + 2);
      j += 2;
      continue;
    }
    if (source[j] === '$') {
      out.push(paintCode('string', chunk));
      chunk = '';
      const { text, end } = readBashVar(source, j);
      out.push(paintCode('variable', text));
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
  if (chunk) out.push(paintCode('string', chunk));
  return j;
};

const bashWordStyle = (word, nextCh) => {
  if (BASH_KEYWORDS.includes(word)) return 'control';
  if (BASH_BUILTINS.includes(word)) return 'function';
  if (nextCh === '=') return 'variable';
  return 'plain';
};

const bashOpLen = (ch, next) => {
  const isOr = ch === '|' && next === '|';
  const isAnd = ch === '&' && next === '&';
  const isAppend = ch === '>' && next === '>';
  const isHeredoc = ch === '<' && next === '<';
  if (isOr || isAnd || isAppend || isHeredoc) return 2;
  return 1;
};

const highlightBash = (source) => {
  const out = [];
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === '#' && (i === 0 || /\s/.test(source[i - 1]))) {
      const { text, end } = readUntilNl(source, i);
      out.push(paintCode('comment', text));
      i = end;
      continue;
    }

    if (ch === "'" || ch === '`') {
      const { text, end } = takeQuoted(source, i);
      out.push(paintCode('string', text));
      i = end;
      continue;
    }

    if (ch === '"') {
      i = takeBashDouble(source, i, out);
      continue;
    }

    if (ch === '$') {
      const { text, end } = readBashVar(source, i);
      out.push(paintCode('variable', text));
      i = end;
      continue;
    }

    if (ch === '-' && /[A-Za-z0-9]/.test(next || '')) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_-]/.test(source[j])) j++;
      out.push(paintCode('attr', source.slice(i, j)));
      i = j;
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(source[j])) j++;
      const word = source.slice(i, j);
      out.push(paintCode(bashWordStyle(word, source[j]), word));
      i = j;
      continue;
    }

    if (/[0-9]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[0-9]/.test(source[j])) j++;
      out.push(paintCode('number', source.slice(i, j)));
      i = j;
      continue;
    }

    if ('|&;<>(){}'.includes(ch)) {
      const j = i + bashOpLen(ch, next);
      out.push(paintCode('operator', source.slice(i, j)));
      i = j;
      continue;
    }

    out.push(paintCode('plain', ch));
    i++;
  }

  return out.join('');
};

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

const highlightLog = (source) => {
  const text = asText(source);
  const lines = text.split('\n');
  return lines.map(highlightLogLine).join('\n');
};

const highlightDotLine = (line) => {
  if (!line) return '';
  const t = line.trimStart();
  if (t.startsWith('#') || t.startsWith(';')) return paintCode('comment', line);
  if (t.startsWith('!')) {
    const lead = line.slice(0, line.length - t.length);
    const bang = paintCode('operator', '!');
    const rest = paintCode('plain', t.slice(1));
    return lead + bang + rest;
  }
  const eq = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_.-]*)(\s*=\s*)(.*)$/);
  if (eq) {
    const indent = eq[1];
    const key = paintCode('variable', eq[2]);
    const op = paintCode('operator', eq[3]);
    const val = paintCode('string', eq[4]);
    return indent + key + op + val;
  }
  return paintCode('plain', line);
};

const highlightDot = (source) => {
  const text = asText(source);
  const lines = text.split('\n');
  return lines.map(highlightDotLine).join('\n');
};

const highlightTxtLine = (line) => {
  if (!line) return '';
  const re = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/g;
  let out = '';
  let last = 0;
  let m;
  while ((m = re.exec(line))) {
    if (m.index > last) {
      const before = line.slice(last, m.index);
      out += paintCode('plain', before);
    }
    out += paintCode('string', m[0]);
    last = m.index + m[0].length;
  }
  if (last < line.length) {
    const tail = line.slice(last);
    out += paintCode('plain', tail);
  }
  if (out) return out;
  return paintCode('plain', line);
};

const highlightTxt = (source) => {
  const text = asText(source);
  const lines = text.split('\n');
  return lines.map(highlightTxtLine).join('\n');
};

const highlightJs = (source) => highlightJsFamily(source, false);
const highlightTs = (source) => highlightJsFamily(source, true);

const HIGHLIGHTERS = {
  js: highlightJs,
  mjs: highlightJs,
  ts: highlightTs,
  json: highlightJson,
  css: highlightCss,
  html: highlightHtml,
  csv: highlightCsv,
  bash: highlightBash,
  sh: highlightBash,
  shell: highlightBash,
  zsh: highlightBash,
  log: highlightLog,
  dot: highlightDot,
  txt: highlightTxt,
};

const highlight = (lang, source) => {
  const key = lang === 'dts' ? 'ts' : lang;
  const fn = HIGHLIGHTERS[key] || highlightTxt;
  return fn(source);
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
