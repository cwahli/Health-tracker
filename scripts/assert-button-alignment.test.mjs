// The /freemodel keyboard is a table rendered in a proportional font.
//
// Every button must finish to the same width (COPY_WIDTH display cells, `-` in the
// last cell), carry the mark at cell 0, give the name the same column for every
// row, and be filled with EN SPACEs rather than ASCII spaces. Telegram centres a
// button's label, so a line whose rendered width depends on its letter/space mix
// lands its first glyph and its trailing dash at a different x on every row — the
// reader's screenshot showed the ticks staggered and the dashes ragged, with the
// header (letters and spaces only) ~70px narrower than the rows. EN SPACE is one
// cell here and about a letter wide in the client, so a 72-cell line renders at
// close to one width however its content mixes, and the centring then agrees.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  rowCopy,
  fitCopy,
  enSpace,
  EN_SPACE,
  dispWidth,
  COPY_WIDTH,
  MODEL_NAME_MAX,
} from './lib/free-lanes.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let passed = 0;
let failed = 0;

function check(name, cond, detail) {
  if (cond) {
    console.log(`  PASS  ${name}`);
    passed++;
  } else {
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

console.log('assert-button-alignment:');

const read = (p) => fs.readFileSync(path.join(HERE, p), 'utf8');
const fl = read('lib/free-lanes.mjs');
const botSrc = read('bot-host.mjs');

// --- the helpers themselves ---
check('fitCopy finishes a line by display width, not by character count',
  /const cw = dispWidth\(ch\)/.test(fl)
  && /if \(w \+ cw > COPY_WIDTH - 1\) break;/.test(fl)
  && /out \+= ' '\.repeat\(COPY_WIDTH - 1 - w\)/.test(fl)
  && /return `\$\{out\}-`;/.test(fl));
check('enSpace replaces every ASCII space with EN SPACE',
  enSpace('a b') === `a${EN_SPACE}b` && EN_SPACE === '\u2002');
check('dispWidth counts the mark as two cells',
  dispWidth('✅') === 2 && dispWidth('ab') === 2 && dispWidth('a✅b') === 4);

// --- a keyboard's worth of rows, the shapes the reader actually saw ---
const row = (over = {}) => enSpace(rowCopy({
  mark: '✅',
  name: 'Muse 1.3 Cont',
  plan: 'OC',
  score: 'AA48',
  resetIn: '—',
  ...over,
}));
const rows = [
  row(),
  row({ mark: '❌', name: 'Cline Muse 1.3 Cont', plan: 'CL', resetIn: '2h 31' }),
  row({ name: 'MiMo V2.6', plan: 'TH', score: 'AA~41' }),
  row({ name: 'gemini 3.8 flash', plan: 'GM', score: 'AA41.2' }),
  row({ name: 'GLM 4.7 Flash', plan: 'CF', score: '—' }),
  row({ name: 'Space Bunny', plan: 'OC', score: '—' }),
];
check('every row finishes to COPY_WIDTH display cells',
  rows.every((r) => dispWidth(r) === COPY_WIDTH),
  rows.map((r) => String(dispWidth(r))).join(','));
check('every row starts with a mark and ends with the dash',
  rows.every((r) => /^[✅❌]/.test(r) && r.endsWith('-')));
check('no ASCII space survives in a button: the fill is EN SPACE',
  rows.every((r) => !r.includes(' ')));

const headers = [
  enSpace(fitCopy('Coding-agent capable (11)')),
  enSpace(fitCopy('Light · docs/inventory (19)')),
  enSpace(fitCopy('Cancel — keep current model')),
];
check('a heading and the cancel row finish to the same width',
  headers.every((h) => dispWidth(h) === COPY_WIDTH && h.endsWith('-')),
  headers.map((h) => String(dispWidth(h))).join(','));

// The columns, not just the outline: the plan code must begin at the same display
// cell whatever the name above it was, or the table's columns drift inside the
// button even when the button itself is the right length.
const planAt = (r) => {
  const i = r.indexOf('ZZ');
  let w = 0;
  for (const ch of r.slice(0, i)) w += dispWidth(ch);
  return w;
};
const planRows = ['MiMo V2.6', 'gemini 3.8 flash', 'Space Bunny'].map((name) => row({ name, plan: 'ZZ' }));
check('the plan column starts at the same cell for every name',
  new Set(planRows.map(planAt)).size === 1 && planAt(planRows[0]) === 3 + MODEL_NAME_MAX,
  planRows.map((r) => String(planAt(r))).join(','));

// --- bot-host builds the keyboard that way ---
check('the keyboard imports the EN SPACE fill', /  enSpace,/.test(botSrc));
check('a row is the /allowance copy, EN SPACE filled',
  /const rated = enSpace\(rowCopy\(\{/.test(botSrc) && /text: rated, data: route/.test(botSrc));
check('a group heading is EN SPACE filled', /text: enSpace\(fitCopy\(/.test(botSrc));
check('the cancel row is the same width as the rows',
  /text: enSpace\(fitCopy\('Cancel — keep current model'\)\)/.test(botSrc));
check('the button name comes from the same helper as the table',
  /shortModelName\(r\.lane \|\| \{ label \}\)/.test(botSrc));
check('the reset is the compact countdown, never an absolute timestamp',
  /formatResetIn\(resetSource, now\)/.test(botSrc)
  && !/resetIn: r\.resetIn \|\| r\.resetLabel/.test(botSrc));

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
