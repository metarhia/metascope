'use strict';

const decodeKey = (buf) => {
  const s = typeof buf === 'string' ? buf : buf.toString('utf8');
  if (s === '\x1b') return { name: 'escape' };
  if (s === '\x03') return { name: 'ctrl-c' };
  if (s === '\x04') return { name: 'ctrl-d' };
  if (s === '\x15') return { name: 'ctrl-u' };
  if (s === '\r' || s === '\n') return { name: 'enter' };
  if (s === '\x7f' || s === '\b') return { name: 'backspace' };
  if (s === '\t') return { name: 'tab' };
  if (s === ' ') return { name: 'space', ch: ' ' };

  // SGR mouse: ESC [ < btn ; x ; y M/m
  const ESC = '\\u001b';
  const mouse = s.match(new RegExp(`^${ESC}\\[<(\\d+);(\\d+);(\\d+)([Mm])$`));
  if (mouse) {
    return {
      name: 'mouse',
      button: Number(mouse[1]),
      col: Number(mouse[2]),
      row: Number(mouse[3]),
      release: mouse[4] === 'm',
    };
  }

  // CSI sequences
  if (s.startsWith('\x1b[')) {
    const seq = s.slice(2);
    const map = {
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
    if (map[seq]) return { name: map[seq] };
    if (seq.endsWith('~') && map[seq]) return { name: map[seq] };
    const bare = seq.replace(/^\d+(?:;\d+)?([A-Z~])$/, '$1');
    if (map[bare]) return { name: map[bare] };
    if (seq === '5~') return { name: 'pageup' };
    if (seq === '6~') return { name: 'pagedown' };
  }

  // SS3 (application cursor keys)
  if (s.startsWith('\x1bO')) {
    const map = {
      A: 'up',
      B: 'down',
      C: 'right',
      D: 'left',
      H: 'home',
      F: 'end',
    };
    if (map[s[2]]) return { name: map[s[2]] };
  }

  if (s.length === 1) {
    return { name: 'char', ch: s };
  }

  if (s.length > 1 && !s.startsWith('\x1b')) {
    return { name: 'char', ch: s };
  }

  return { name: 'unknown', raw: s };
};

/** True if buffer looks like an incomplete CSI / mouse sequence.
 * Lone ESC is incomplete only until a short timeout flushes it as Escape.
 */
const isIncompleteSequence = (s) => {
  if (!s.startsWith('\x1b')) return false;
  // Lone ESC: caller decides via timeout (may be Escape or start of CSI).
  if (s === '\x1b') return true;
  if (s === '\x1b[') return true;
  if (s.startsWith('\x1b[<')) {
    return !/[Mm]$/.test(s);
  }
  if (s.startsWith('\x1b[')) {
    return !/[A-Za-z~]$/.test(s);
  }
  if (s.startsWith('\x1bO')) {
    return s.length < 3;
  }
  return false;
};

module.exports = { decodeKey, isIncompleteSequence };
