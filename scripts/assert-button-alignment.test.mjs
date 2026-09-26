// The /freemodel keyboard is a table, and the reader counts it in characters.
//
// The spec they gave, in their own words: the name field is exactly 30
// characters, two spaces, the plan in 2, one space, the expiry in 15, two
// spaces, the benchmark in a fixed width, then the fill, then a `-` — and the
// character length of every button is the same. This gate pins that: one column
// builder, fixed offsets, one finish, 72 characters on every button including
// the tier headings and the Cancel row, ASCII spaces as the fill (the EN SPACE
// fill of the previous attempt made the client middle-elide labels into `…`).
//
// The monospace /allowance table shares the same column builder and finishes by
// display cells instead, because ✅/❌ is one character and two cells — that
// split is asserted here too, so neither surface can drift back into the other's
// unit.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  rowCopy,
  colsCopy,
  fitCopy,
  fitCells,
  headingCopy,
  dispWidth,
  COPY_WIDTH,
  MODEL_NAME_MAX,
  W_PLAN,
  W_EXPIRY,
  W_SCORE,
  MARK_CHARS,
  MARK_CELLS,
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

// --- the reader's spec, as numbers ---
check('the name column is exactly 30 characters', MODEL_NAME_MAX === 30, String(MODEL_NAME_MAX));
check('the plan column is 2, the reset 15, the benchmark 7',
  W_PLAN === 2 && W_EXPIRY === 15 && W_SCORE === 7,
  `${W_PLAN}/${W_EXPIRY}/${W_SCORE}`);
check('the mark column is 2 characters and 3 display cells',
  MARK_CHARS === 2 && MARK_CELLS === 3 && dispWidth('✅') === 2);
check('dispWidth still counts the mark as two cells',
  dispWidth('✅') === 2 && dispWidth('ab') === 2 && dispWidth('a✅b') === 4);

// --- the two finishers, each in its own unit ---
check('fitCopy finishes a line by CHARACTER count (the unit the reader counts)',
  /export function fitCopy\(line\) \{/.test(fl)
  && /if \(n \+ 1 > COPY_WIDTH - 1\) break;/.test(fl)
  && /out \+= " "\.repeat\(COPY_WIDTH - 1 - n\);/.test(fl)
  && fitCopy('a').length === COPY_WIDTH
  && fitCopy('y'.repeat(400)).length === COPY_WIDTH);
check('fitCells finishes a line by DISPLAY CELLS, for the monospace table',
  /export function fitCells\(line\) \{/.test(fl)
  && /const cw = dispWidth\(ch\)/.test(fl)
  // the mark is one character but two cells, so the two units disagree by exactly one here
  && fitCells('✅').length === COPY_WIDTH - 1
  && dispWidth(fitCells('✅')) === COPY_WIDTH
  && dispWidth(fitCells('ab')) === COPY_WIDTH);
check('the EN SPACE fill is gone from the helpers and from the keyboard',
  !/EN_SPACE|enSpace/.test(fl) && !/EN_SPACE|enSpace/.test(botSrc));

// --- a keyboard's worth of rows, the shapes the reader actually saw ---
const row = (over = {}) => fitCopy(rowCopy({
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
  row({ name: 'x'.repeat(60), plan: 'LONGPROVIDER', resetIn: 'y'.repeat(40), score: 'AA100.5555' }),
];
check('every row is exactly COPY_WIDTH characters, ending in the dash',
  rows.every((r) => r.length === COPY_WIDTH && r.endsWith('-')),
  rows.map((r) => String(r.length)).join(','));
check('every row starts with a mark',
  rows.every((r) => /^[✅❌]/.test(r)));
check('the fill is ASCII spaces — no U+2002 survives',
  rows.every((r) => r.includes(' ') && !r.includes('\u2002')),
  rows.filter((r) => r.includes('\u2002')).length + ' rows still filled');

// The columns, not just the outline: each column must begin at the character
// index the spec puts it at, whatever the content above it was, or the table
// drifts inside the button even when the button is the right length.
//   mark(1) + space(1) + name(30) + 2 = plan at 34
//   plan(2) + 3 spaces = reset at 39, reset(15) + 2 = benchmark at 56
const OFFSET = { name: 2, plan: 2 + MODEL_NAME_MAX + 2, reset: 2 + MODEL_NAME_MAX + 2 + W_PLAN + 3, score: 2 + MODEL_NAME_MAX + 2 + W_PLAN + 3 + W_EXPIRY + 2 };
const probe = fitCopy(rowCopy({ mark: '❌', name: 'N'.repeat(60), plan: 'ZZZZZZ', resetIn: 'R'.repeat(40), score: 'SSSSSSS' }));
check('the name column starts at character 2 and is 30 wide',
  probe.slice(OFFSET.name, OFFSET.name + MODEL_NAME_MAX) === 'N'.repeat(MODEL_NAME_MAX)
  && probe.slice(OFFSET.name + MODEL_NAME_MAX, OFFSET.plan) === '  ',
  JSON.stringify(probe.slice(0, OFFSET.plan + 2)));
check('the plan column starts at 34 and is 2 wide',
  probe.slice(OFFSET.plan, OFFSET.plan + W_PLAN) === 'ZZ' && probe[OFFSET.plan + W_PLAN] === ' ',
  `at ${OFFSET.plan}: ${JSON.stringify(probe.slice(OFFSET.plan, OFFSET.plan + 4))}`);
check('the plan code sits three spaces clear of the countdown, never beside it',
  probe.slice(OFFSET.plan + W_PLAN, OFFSET.reset) === '   ' && OFFSET.reset === 39,
  JSON.stringify(probe.slice(OFFSET.plan, OFFSET.reset + 2)));
check('the reset column starts at 39 and is 15 wide',
  probe.slice(OFFSET.reset, OFFSET.reset + W_EXPIRY) === 'R'.repeat(W_EXPIRY)
  && probe.slice(OFFSET.reset + W_EXPIRY, OFFSET.score) === '  ',
  JSON.stringify(probe.slice(OFFSET.reset, OFFSET.score + 2)));
check('the benchmark column starts at 56 and is 7 wide',
  probe.slice(OFFSET.score, OFFSET.score + W_SCORE) === 'SSSSSSS' && probe[OFFSET.score + W_SCORE] === ' ',
  JSON.stringify(probe.slice(OFFSET.score, OFFSET.score + 9)));
check('every row puts every column at the same character index',
  rows.every((r) => {
    const p = fitCopy(rowCopy({ mark: ' ', name: 'zzz', plan: 'YY', score: 'AA1', resetIn: '1h' }));
    return p.slice(OFFSET.plan, OFFSET.plan + 2) === 'YY' && p.length === COPY_WIDTH;
  }));
check('a heading and the cancel row finish to the same length as a row',
  [headingCopy('Coding-agent capable (11)'), headingCopy('Light · docs/inventory (19)'), headingCopy('Cancel — keep current model')]
    .every((h) => h.length === COPY_WIDTH && h.endsWith('-') && h.startsWith('  ')),
  [headingCopy('Coding-agent capable (11)').length, headingCopy('Cancel — keep current model').length].join(','));
check('the monospace table finishes in cells, so a row and its header share an edge',
  (() => {
    const header = fitCells(`${' '.repeat(MARK_CELLS)}${colsCopy({ name: 'Model', plan: 'PL', resetIn: 'Reset in', score: 'AA' })}`);
    const rowLine = fitCells(rowCopy({ mark: '❌', name: 'Cline Muse 1.3 Cont', plan: 'CL', score: 'AA48.5', resetIn: '2h 31' }));
    return dispWidth(header) === COPY_WIDTH && dispWidth(rowLine) === COPY_WIDTH;
  })());

// --- bot-host builds the keyboard that way ---
check('the keyboard imports the heading helper and no EN SPACE fill',
  /  headingCopy,/.test(botSrc) && !/enSpace/.test(botSrc));
check('a row is the /allowance copy, finished by characters',
  /const rated = fitCopy\(rowCopy\(\{/.test(botSrc) && /text: rated, data: route/.test(botSrc));
check('a group heading is the same length as a row', /text: headingCopy\(/.test(botSrc));
check('the cancel row is the same length as the rows',
  /text: headingCopy\('Cancel — keep current model'\)/.test(botSrc));
check('the button name comes from the same helper as the table',
  /shortModelName\(r\.lane \|\| \{ label \}\)/.test(botSrc));
check('the reset is the compact countdown, never an absolute timestamp',
  /formatResetIn\(resetSource, now\)/.test(botSrc)
  && !/resetIn: r\.resetIn \|\| r\.resetLabel/.test(botSrc));
check('an unpublished benchmark prints the em dash, never an empty column',
  /score: benchmarkLabel\(model\) \|\| '—'/.test(botSrc));

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
