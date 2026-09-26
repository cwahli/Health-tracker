// The /freemodel keyboard is a table — and a button label is laid out by the
// client in a *proportional* font, centred in its row, and finished by rendered
// width, not by characters.
//
// What the reader counts is 72 characters, and every button still carries one
// builder's worth of columns in their order (mark, name, plan, three spaces,
// countdown, benchmark, fill, dash). But characters are not a length on this
// surface: the same 72 characters measured 386px to 465px across one keyboard,
// a 414.6px row rendered whole while the 418.4px row beside it lost its middle
// to the client's `…` elision, and the one row that read correctly — the tier
// heading the reader pointed at — landed at 409px. So the keyboard is pinned
// here by width: every column padded to a fixed em budget (so the plan code and
// the countdown start at the same x on every row), every line finished at
// COPY_UNITS = 24em = 408px, which is under the client's cut-off by a margin
// and equal to that heading's own width.
//
// The monospace /allowance table shares the column order and finishes by
// display cells instead (✅/❌ is one character, two cells) — asserted here too,
// so neither surface can drift into the other's unit.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  rowWidth,
  headingWidth,
  widthUnits,
  fitWidth,
  padUnits,
  ADV,
  COPY_UNITS,
  UNIT_PX,
  ROW_UNITS,
  W_HEAD_UNITS,
  W_PLAN_UNITS,
  W_EXPIRY_UNITS,
  W_SCORE_UNITS,
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
const SP = ADV[' '];

// --- the width table the buttons are measured with ---
check('the advance table is exported and measures em',
  /export const ADV = \{/.test(fl)
  && Math.abs(widthUnits(' ') - 0.2559) < 1e-9
  && Math.abs(widthUnits('a') - ADV.a) < 1e-9
  && Math.abs(widthUnits('ab') - ADV.a - ADV.b) < 1e-9,
  `space=${widthUnits(' ')}`);
check('the mark is the widest glyph on the row and both marks agree',
  ADV['✅'] > 1.3 && ADV['✅'] === ADV['❌'],
  `${ADV['✅']} vs ${ADV['❌']}`);
check('an unknown glyph still costs the default, never zero',
  widthUnits('\u{1f900}') > 0, String(widthUnits('\u{1f900}')));

// --- the budget: equal to the heading that reads correctly, under the cut-off ---
check('every button is finished at COPY_UNITS = 24em = 408px',
  COPY_UNITS === 24.0 && COPY_UNITS * UNIT_PX === 408,
  `${COPY_UNITS}em × ${UNIT_PX}px`);
check('the budget sits under the client cut-off (~415px) with margin, and at the heading width (409px)',
  COPY_UNITS * UNIT_PX <= 410 && COPY_UNITS * UNIT_PX >= 400,
  `${COPY_UNITS * UNIT_PX}px`);

// --- a keyboard's worth of rows, the shapes the reader actually saw ---
const row = (over = {}) => rowWidth({
  mark: '✅',
  name: 'Muse 1.3 Cont',
  plan: 'OC',
  score: 'AA48',
  resetIn: '—',
  ...over,
});
const rows = [
  row(),
  row({ mark: '❌', name: 'Cline Muse 1.3 Cont', plan: 'CL', resetIn: '2h 31' }),
  row({ name: 'MiMo V2.6', plan: 'TH', score: 'AA~41' }),
  row({ name: 'gemini 3.8 flash', plan: 'GM', score: 'AA41.2', resetIn: '1h 33' }),
  row({ name: 'GLM 4.7 Flash', plan: 'CF', score: '—' }),
  row({ name: 'Space Bunny', plan: 'OC', score: '—' }),
  row({ name: 'nemotron-3.5-lightning', plan: 'OC', score: 'AA14', resetIn: '1h 33' }),
  row({ name: 'trinity-large-preview', plan: 'OC', score: 'AA29' }),
];
const widths = rows.map(widthUnits);
check('every row ends in the dash and starts with the mark',
  rows.every((r) => r.endsWith('-') && /^[✅❌]/.test(r)));
check('every row renders at COPY_UNITS, none over (over is what the client elides)',
  rows.every((r, i) => widths[i] <= COPY_UNITS + 1e-9 && widths[i] >= COPY_UNITS - SP - 1e-9),
  widths.map((w) => (w * UNIT_PX).toFixed(1)).join(','));
check('rows render within one space of each other — one shared edge',
  Math.max(...widths) - Math.min(...widths) <= SP + 1e-9,
  `spread ${((Math.max(...widths) - Math.min(...widths)) * UNIT_PX).toFixed(1)}px`);
check('the worst row in the catalog still fits under the cut-off',
  widthUnits(row({ name: 'nemotron-3.5-lightning', plan: 'OC', score: 'AA14', resetIn: '1h 33' })) * UNIT_PX <= 410,
  `${(widthUnits(row({ name: 'nemotron-3.5-lightning', plan: 'OC', score: 'AA14', resetIn: '1h 33' })) * UNIT_PX).toFixed(1)}px`);
check('the fill is ASCII spaces — no U+2002 survives',
  rows.every((r) => r.includes(' ') && !r.includes('\u2002')));
check('the finisher floors to the budget, it never rounds past it',
  fitWidth('a'.repeat(400)) === fitWidth('a'.repeat(400)) && widthUnits(fitWidth('x')) <= COPY_UNITS + 1e-9
  && widthUnits(fitWidth('x')) >= COPY_UNITS - SP - 1e-9,
  `${(widthUnits(fitWidth('x')) * UNIT_PX).toFixed(1)}px`);
check('padding is by width: padUnits stops at the budget in em, not in characters',
  Math.abs(widthUnits(padUnits('a', 2)) - 2) < SP && widthUnits(padUnits('a', 2)) >= 2 - 1e-9);

// --- the columns begin at the same x on every row, whatever the content ---
//   mark + space + name = W_HEAD, two spaces = plan, three more = countdown,
//   two more = benchmark. Offsets are em, because that is the unit the client
//   lays the label out in; a character index drifts with the name's letters.
check('the column offsets are the sum of the budgets and the gaps',
  Math.abs(ROW_UNITS.plan - (W_HEAD_UNITS + 2 * SP)) < 1e-9
  && Math.abs(ROW_UNITS.expiry - (ROW_UNITS.plan + W_PLAN_UNITS + 3 * SP)) < 1e-9
  && Math.abs(ROW_UNITS.score - (ROW_UNITS.expiry + W_EXPIRY_UNITS + 2 * SP)) < 1e-9,
  JSON.stringify(ROW_UNITS));
const probe = rowWidth({ mark: '❌', name: 'nemotron-3.5-lightning', plan: 'ZZ', resetIn: '1h 33', score: '9999' });
const planIdx = probe.indexOf('ZZ');
const expIdx = probe.indexOf('1h 33');
const scoreIdx = probe.indexOf('9999');
const upto = (i) => widthUnits(probe.slice(0, i));
check('the plan column starts at the name column’s width, whatever the name',
  planIdx > 0 && upto(planIdx) >= ROW_UNITS.plan - 1e-9 && upto(planIdx) < ROW_UNITS.plan + SP,
  `${upto(planIdx).toFixed(4)} vs ${ROW_UNITS.plan}`);
check('the countdown starts at its own offset, three spaces clear of the plan',
  expIdx > planIdx && upto(expIdx) >= ROW_UNITS.expiry - 1e-9 && upto(expIdx) < ROW_UNITS.expiry + SP
  && probe.slice(0, expIdx).endsWith('   '),
  `${upto(expIdx).toFixed(4)} vs ${ROW_UNITS.expiry}; gap ${JSON.stringify(probe.slice(planIdx, expIdx))}`);
check('the benchmark starts at its own offset',
  scoreIdx > expIdx && upto(scoreIdx) >= ROW_UNITS.score - 1e-9 && upto(scoreIdx) < ROW_UNITS.score + SP,
  `${upto(scoreIdx).toFixed(4)} vs ${ROW_UNITS.score}`);
const shortRow = row({ name: 'hy3', plan: 'OC' });
const shortPlanIdx = shortRow.indexOf('OC');
const shortUpto = widthUnits(shortRow.slice(0, shortPlanIdx));
check('a short name and a long name put the plan code at the same x',
  Math.abs(shortUpto - upto(planIdx)) < SP + 1e-9,
  `${shortUpto.toFixed(4)} vs ${upto(planIdx).toFixed(4)}`);
check('the benchmark on a button carries no AA prefix — the reader’s call, the table keeps it',
  !rowWidth({ name: 'Muse 1.3 Cont', plan: 'OC', score: 'AA48' }).includes('AA')
  && rowWidth({ name: 'Muse 1.3 Cont', plan: 'OC', score: 'AA~41' }).includes('~41')
  && rowWidth({ name: 'Muse 1.3 Cont', plan: 'OC', score: '' }).includes('—'),
  JSON.stringify(rowWidth({ name: 'Muse 1.3 Cont', plan: 'OC', score: 'AA48' })));

// --- headings and the cancel row are the same rendered length as a row ---
const heads = [
  headingWidth('Coding-agent capable (11)'),
  headingWidth('Light · docs/inventory (19)'),
  headingWidth('Cancel — keep current model'),
];
check('a heading and the cancel row finish at COPY_UNITS, indented, dash last',
  heads.every((h) => h.endsWith('-') && h.startsWith('  ')
    && widthUnits(h) <= COPY_UNITS + 1e-9 && widthUnits(h) >= COPY_UNITS - SP - 1e-9),
  heads.map((h) => (widthUnits(h) * UNIT_PX).toFixed(1)).join(','));
check('a heading renders within one space of a row — one keyboard, one width',
  heads.every((h) => Math.abs(widthUnits(h) - widths[0]) <= SP + 1e-9),
  heads.map((h) => (widthUnits(h) * UNIT_PX).toFixed(1)).join(','));

// --- the character- and cell-counted table, unchanged by all of this ---
check('the name column is exactly 30 characters', MODEL_NAME_MAX === 30, String(MODEL_NAME_MAX));
check('the plan column is 2, the reset 15, the benchmark 7',
  W_PLAN === 2 && W_EXPIRY === 15 && W_SCORE === 7,
  `${W_PLAN}/${W_EXPIRY}/${W_SCORE}`);
check('the mark column is 2 characters and 3 display cells',
  MARK_CHARS === 2 && MARK_CELLS === 3 && dispWidth('✅') === 2);
check('fitCopy still finishes a line by CHARACTER count',
  /export function fitCopy\(line\) \{/.test(fl)
  && /if \(n \+ 1 > COPY_WIDTH - 1\) break;/.test(fl)
  && fitCopy('a').length === COPY_WIDTH
  && fitCopy('y'.repeat(400)).length === COPY_WIDTH);
check('fitCells finishes a line by DISPLAY CELLS, for the monospace table',
  /export function fitCells\(line\) \{/.test(fl)
  && /const cw = dispWidth\(ch\)/.test(fl)
  && fitCells('✅').length === COPY_WIDTH - 1
  && dispWidth(fitCells('✅')) === COPY_WIDTH
  && dispWidth(fitCells('ab')) === COPY_WIDTH);
check('the table row keeps the AA prefix and the three-space gap in characters',
  rowCopy({ mark: '❌', name: 'Cline Muse 1.3 Cont', plan: 'CL', score: 'AA48.5', resetIn: '2h 31' })
    .includes('CL   2h 31') && rowCopy({ mark: '❌', name: 'x', plan: 'CL', score: 'AA48', resetIn: '—' }).includes('AA48'),
  JSON.stringify(rowCopy({ mark: '❌', name: 'x', plan: 'CL', score: 'AA48', resetIn: '—' })));
check('the monospace table finishes in cells, so a row and its header share an edge',
  (() => {
    const header = fitCells(`${' '.repeat(MARK_CELLS)}${colsCopy({ name: 'Model', plan: 'PL', resetIn: 'Reset in', score: 'AA' })}`);
    const rowLine = fitCells(rowCopy({ mark: '❌', name: 'Cline Muse 1.3 Cont', plan: 'CL', score: 'AA48.5', resetIn: '2h 31' }));
    return dispWidth(header) === COPY_WIDTH && dispWidth(rowLine) === COPY_WIDTH;
  })());
check('the EN SPACE fill is gone from the helpers and from the keyboard',
  !/EN_SPACE|enSpace/.test(fl) && !/EN_SPACE|enSpace/.test(botSrc));

// --- bot-host builds the keyboard that way ---
check('the keyboard imports the width helpers and no EN SPACE fill',
  /  rowWidth,/.test(botSrc) && /  headingWidth,/.test(botSrc) && !/enSpace/.test(botSrc));
check('a row is built by width, finished at COPY_UNITS',
  /const rated = rowWidth\(\{/.test(botSrc) && /text: rated, data: route/.test(botSrc));
check('a group heading and the cancel row go through the same width finisher',
  /text: headingWidth\(/.test(botSrc)
  && /text: headingWidth\('Cancel — keep current model'\)/.test(botSrc));
check('the button name comes from the same helper as the table',
  /shortModelName\(r\.lane \|\| \{ label \}\)/.test(botSrc));
check('the reset is the compact countdown, never an absolute timestamp',
  /formatResetIn\(resetSource, now\)/.test(botSrc)
  && !/resetIn: r\.resetIn \|\| r\.resetLabel/.test(botSrc));
check('an unpublished benchmark prints the em dash, never an empty column',
  /score: benchmarkLabel\(model\) \|\| '—'/.test(botSrc));
check('the buttons share one column order with the table',
  /plan, three spaces, countdown, benchmark/.test(botSrc));

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
