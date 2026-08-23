'use strict';

const concolor = require('concolor');
const { stripAnsi, visibleWidth, asText } = require('./wrap.js');

const chrome = concolor({
  header: 'b,cyan',
  headerDim: 'f,cyan',
  footer: 'f,white',
  accent: 'b,white',
  muted: 'f,white',
  match: 'b,black/yellow',
  help: 'b,white',
  helpKey: 'b,cyan',
  border: 'f,blue',
  error: 'b,red',
  success: 'b,green',
  selected: 'b,cyan',
  dir: 'b,blue',
  file: 'white',
});

const tokens = concolor({
  keyword: 'b,cyan',
  string: 'b,green',
  comment: 'f,cyan',
  number: 'b,yellow',
  type: 'b,magenta',
  punct: 'f,white',
  attr: 'b,cyan',
  tag: 'b,blue',
  plain: 'f,white',
  heading: 'b,white',
  h1: 'b,white',
  h2: 'b,white',
  h3: 'b,cyan',
  h4: 'b,white',
  h5: 'white',
  h6: 'f,white',
  link: 'u,cyan',
  code: 'yellow',
  quote: 'green',
  quoteMark: 'b,green',
  list: 'cyan',
  hr: 'f,blue',
  codeBand: 'white',
  codeGutter: 'f,cyan',
  codeRule: 'f,blue',
  codeLabel: 'b,cyan',
  codeAccentJs: 'b,yellow',
  codeAccentTs: 'b,blue',
  codeAccentJson: 'b,green',
  codeAccentCss: 'b,magenta',
  codeAccentHtml: 'b,red',
  codeAccentCsv: 'b,cyan',
  codeAccentTxt: 'f,white',
  codeFoot: 'f,cyan',
  bold: 'b,white',
  italic: 'i,white',
  csvEven: 'white',
  csvOdd: 'cyan',
  csvHeader: 'b,yellow',
  url: 'u,blue',
  tableRule: 'f,cyan',
  tableHead: 'b,white',
});

const rgb = (r, g, b) => `48;2;${r};${g};${b}`;

const BG = {
  screen: rgb(0, 0, 0),
  // Fenced / whole-file code — slightly lighter than pure black
  code: rgb(18, 18, 22),
  codeHead: rgb(24, 24, 28),
  // Headings: h1/h2 much brighter bg+text, then fade down
  h1: rgb(88, 52, 110),
  h2: rgb(48, 72, 118),
  h3: rgb(36, 58, 64),
  h4: rgb(38, 38, 46),
  h5: rgb(30, 30, 36),
  h6: rgb(26, 26, 30),
  quote: rgb(22, 32, 24),
  hr: rgb(24, 26, 34),
  inlineCode: rgb(22, 22, 26),
  accentJs: rgb(34, 32, 22),
  accentTs: rgb(22, 26, 36),
  accentJson: rgb(22, 32, 24),
  accentCss: rgb(32, 22, 32),
  accentHtml: rgb(34, 24, 24),
  accentCsv: rgb(22, 30, 32),
  accentTxt: rgb(26, 26, 28),
};

const screenBg = () => `\x1b[${BG.screen}m`;

/** SGR reset, then keep black screen bg (no terminal gray default). */
const resetScreen = () => `\x1b[0m${screenBg()}`;

/** OSC: force terminal default background to black while viewer is open. */
const OSC_BG_BLACK = '\x1b]11;#000000\x07';
const OSC_BG_RESET = '\x1b]111\x07';

const ACCENT_BG = {
  codeAccentJs: BG.accentJs,
  codeAccentTs: BG.accentTs,
  codeAccentJson: BG.accentJson,
  codeAccentCss: BG.accentCss,
  codeAccentHtml: BG.accentHtml,
  codeAccentCsv: BG.accentCsv,
  codeAccentTxt: BG.accentTxt,
  codeLabel: BG.codeHead,
  h1: BG.h1,
  h2: BG.h2,
  h3: BG.h3,
  h4: BG.h4,
  h5: BG.h5,
  h6: BG.h6,
  quote: BG.quote,
  hr: BG.hr,
  code: BG.inlineCode,
};

const paint = (style, text) => {
  if (!text) return '';
  const fn = tokens[style] || chrome[style];
  return fn ? fn(asText(text)) : asText(text);
};

/** VS Code Dark+-inspired truecolor foregrounds for code. */
const CODE_FG = {
  keyword: [197, 134, 192], // #c586c0
  control: [197, 134, 192],
  storage: [86, 156, 214], // #569cd6
  literal: [86, 156, 214],
  string: [206, 145, 120], // #ce9178
  template: [206, 145, 120],
  escape: [209, 105, 105],
  interpolation: [156, 220, 254],
  number: [181, 206, 168], // #b5cea8
  comment: [106, 153, 85], // #6a9955
  function: [220, 220, 170], // #dcdcaa
  method: [220, 220, 170],
  className: [78, 201, 176], // #4ec9b0
  type: [78, 201, 176],
  interface: [78, 201, 176],
  property: [156, 220, 254], // #9cdcfe
  variable: [156, 220, 254],
  parameter: [156, 220, 254],
  constant: [79, 193, 255], // #4fc1ff
  operator: [212, 212, 212],
  punct: [212, 212, 212],
  regex: [209, 105, 105], // #d16969
  decorator: [220, 220, 170],
  tag: [86, 156, 214],
  attr: [156, 220, 254],
  plain: [212, 212, 212], // #d4d4d4
  punctDim: [128, 128, 128],
};

const paintCode = (style, text) => {
  if (!text) return '';
  const rgb = CODE_FG[style];
  if (!rgb) return paint(style, text);
  // Only set fg — do not force screen black (bandAnsi restores block bg).
  return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m${text}\x1b[0m`;
};

const paintInlineCode = (text) => {
  if (!text) return '';
  const open = `\x1b[${BG.inlineCode}m`;
  const fg = '\x1b[38;2;220;220;225m';
  const inner = ` ${text} `;
  return `${open}${fg}${inner}\x1b[0m`;
};

/**
 * Keep band background alive after nested \x1b[0m resets,
 * optionally pad remaining cells with the same background.
 */
const bandAnsi = (ansiLine, bgCode, width) => {
  const open = `\x1b[${bgCode}m`;
  let s = asText(ansiLine);
  // Drop trailing resets (plain or reset+screen-black).
  const esc = String.fromCharCode(0x1b);
  const trailReset = new RegExp(
    `(${esc}\\[0m(?:${esc}\\[48;2;0;0;0m)?)+$`,
    'g',
  );
  s = s.replace(trailReset, '');
  // After mid-line reset, restore this band's bg (drop forced screen black).
  const midReset = new RegExp(`${esc}\\[0m(?:${esc}\\[48;2;0;0;0m)?`, 'g');
  const body = s.replace(midReset, `\x1b[0m${open}`);
  const pad = Math.max(0, (width || 0) - visibleWidth(ansiLine));
  // Re-open band bg before pad so nested chips never bleed to EOL.
  return `${open}${body}\x1b[0m${open}${pad > 0 ? ' '.repeat(pad) : ''}\x1b[0m`;
};

const band = (style, text, width) => {
  const raw = stripAnsi(asText(text));
  const pad = Math.max(0, (width || 0) - visibleWidth(raw));
  const filled = raw + (pad > 0 ? ' '.repeat(pad) : '');
  const bg = ACCENT_BG[style] || BG.codeHead;
  const colored = paint(style, filled);
  return bandAnsi(colored, bg, 0);
};

/**
 * Full row on black. Does not rewrite inner SGR (preserves code/heading bands).
 */
const screenLine = (ansiLine, width) => {
  const open = screenBg();
  const line = ansiLine || '';
  const pad = Math.max(0, (width || 0) - visibleWidth(line));
  return `${open}${line}${pad > 0 ? ' '.repeat(pad) : ''}${resetScreen()}`;
};

const headingStyle = (level) => {
  const n = Math.min(6, Math.max(1, level));
  return `h${n}`;
};

const headingBg = (level) => {
  const n = Math.min(6, Math.max(1, level));
  return BG[`h${n}`];
};

module.exports = {
  chrome,
  tokens,
  paint,
  paintCode,
  paintInlineCode,
  CODE_FG,
  band,
  bandAnsi,
  screenLine,
  screenBg,
  resetScreen,
  OSC_BG_BLACK,
  OSC_BG_RESET,
  headingStyle,
  headingBg,
  BG,
  ACCENT_BG,
  concolor,
};
