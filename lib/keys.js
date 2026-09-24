'use strict';

const SIMPLE = {
  '\x1b': { name: 'escape' },
  '\x03': { name: 'ctrl-c' },
  '\x04': { name: 'ctrl-d' },
  '\x15': { name: 'ctrl-u' },
  '\r': { name: 'enter' },
  '\n': { name: 'enter' },
  '\x7f': { name: 'backspace' },
  '\b': { name: 'backspace' },
  '\t': { name: 'tab' },
  ' ': { name: 'space', ch: ' ' },
};

const CSI = {
  A: 'up',
  B: 'down',
  C: 'right',
  D: 'left',
  H: 'home',
  F: 'end',
  '5~': 'pageup',
  '6~': 'pagedown',
  '1~': 'home',
  '4~': 'end',
  '7~': 'home',
  '8~': 'end',
};

const CSI_RE = new RegExp(`^${String.fromCharCode(0x1b)}\\[[0-9;]*[A-Za-z~]`);
const MOUSE_RE = new RegExp(
  `^${String.fromCharCode(0x1b)}\\[<(\\d+);(\\d+);(\\d+)([Mm])$`,
);

const decodeKey = (buf) => {
  const s = typeof buf === 'string' ? buf : buf.toString('utf8');
  if (SIMPLE[s]) return SIMPLE[s];

  const mouse = s.match(MOUSE_RE);
  if (mouse) {
    const button = Number(mouse[1]);
    const col = Number(mouse[2]);
    const row = Number(mouse[3]);
    const release = mouse[4] === 'm';
    return { name: 'mouse', button, col, row, release };
  }

  if (s.startsWith('\x1b[')) {
    const seq = s.slice(2);
    if (CSI[seq]) return { name: CSI[seq] };
    const bare = seq.replace(/^\d+(?:;\d+)?([A-Z~])$/, '$1');
    if (CSI[bare]) return { name: CSI[bare] };
  }
  if (s.startsWith('\x1bO') && CSI[s[2]]) return { name: CSI[s[2]] };
  if (s.length === 1) return { name: 'char', ch: s };
  if (s.length > 1 && !s.startsWith('\x1b')) return { name: 'char', ch: s };
  return { name: 'unknown', raw: s };
};

const sequenceLength = (s) => {
  if (!s) return 0;
  if (s[0] !== '\x1b') {
    const esc = s.indexOf('\x1b');
    return esc === -1 ? s.length : esc;
  }
  if (s.length === 1) return 0;
  if (s.startsWith('\x1b[<')) {
    const end = s.search(/[Mm]/);
    return end === -1 ? 0 : end + 1;
  }
  if (s.startsWith('\x1b[')) {
    const match = s.match(CSI_RE);
    return match ? match[0].length : 0;
  }
  if (s.startsWith('\x1bO')) return s.length < 3 ? 0 : 3;
  return 1;
};

const isIncompleteSequence = (s) =>
  s.startsWith('\x1b') && sequenceLength(s) === 0;

module.exports = { decodeKey, sequenceLength, isIncompleteSequence };
