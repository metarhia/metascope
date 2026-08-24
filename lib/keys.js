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

const decodeKey = (buf) => {
  const s = typeof buf === 'string' ? buf : buf.toString('utf8');
  if (SIMPLE[s]) return SIMPLE[s];

  // SGR mouse: ESC [ < btn ; x ; y M/m
  const esc = String.fromCharCode(0x1b);
  const mouse = s.match(new RegExp(`^${esc}\\[<(\\d+);(\\d+);(\\d+)([Mm])$`));
  if (mouse) {
    const name = 'mouse';
    const button = Number(mouse[1]);
    const col = Number(mouse[2]);
    const row = Number(mouse[3]);
    const release = mouse[4] === 'm';
    return { name, button, col, row, release };
  }

  if (s.startsWith('\x1b[')) {
    const seq = s.slice(2);
    if (CSI[seq]) return { name: CSI[seq] };
    const bare = seq.replace(/^\d+(?:;\d+)?([A-Z~])$/, '$1');
    if (CSI[bare]) return { name: CSI[bare] };
  }
  // SS3 (application cursor keys) — same letters as CSI
  if (s.startsWith('\x1bO') && CSI[s[2]]) return { name: CSI[s[2]] };
  if (s.length === 1) return { name: 'char', ch: s };
  if (s.length > 1 && !s.startsWith('\x1b')) return { name: 'char', ch: s };
  return { name: 'unknown', raw: s };
};

const isIncompleteSequence = (s) => {
  if (!s.startsWith('\x1b')) return false;
  // Caller timeout distinguishes Escape from the start of CSI / mouse.
  if (s === '\x1b') return true;
  if (s === '\x1b[') return true;
  if (s.startsWith('\x1b[<')) return !/[Mm]$/.test(s);
  if (s.startsWith('\x1b[')) return !/[A-Za-z~]$/.test(s);
  if (s.startsWith('\x1bO')) return s.length < 3;
  return false;
};

module.exports = { decodeKey, isIncompleteSequence };
