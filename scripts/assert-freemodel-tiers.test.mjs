#!/usr/bin/env node
/**
 * assert-freemodel-tiers.test.mjs — QS-6 / QS-7 named gate.
 *
 * The /freemodel keyboard renders the one canonical list: the catalogs' tier
 * order (coding-agent capable, unlisted, light) with a heading per group and one
 * button per row, each button the /allowance row copy — mark, short name, plan,
 * reset, benchmark, finished to 72 characters ending in `-` and filled with
 * ASCII spaces, so every button in the keyboard is the same length in the unit
 * the reader counts. A keyboard has no subheadings, so the heading row and the
 * order are where the split is visible.
 *
 * Proves against the real formatter with synthetic rows (no Telegram, no ledger,
 * no quota). Exit 0 on all pass; exit 1 with FAIL lines otherwise.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let pass = 0;
let fail = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail++;
    failures.push(name + (detail ? ` — ${detail}` : ''));
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('assert-freemodel-tiers (QS-6/QS-7)\n');

const host = await import(path.join(__dirname, 'bot-host.mjs'));
const { scoreLabelFor, tierForModel, benchmarkLabel } = await import(path.join(__dirname, 'lib', 'free-catalogs.mjs'));
const { groupRowsByTier, fitCopy, COPY_WIDTH } = await import(path.join(__dirname, 'lib', 'free-lanes.mjs'));
const { formatFreemodelWithDepletion } = host;
check('the formatter is exported for the sensor', typeof formatFreemodelWithDepletion === 'function');

// Synthetic canonical rows: a ranked coding lane, a lane the catalog does not
// know, a light lane, a depleted lane and a terminal-only lane.
const rows = [
  { label: 'DeepSeek V4.1', laneLabel: 'DeepSeek V4.1', lane: { model: 'deepseek-v4.1-flash' }, model: 'cline-free/deepseek-v4.1-flash', ref: 'cline:cline-free/deepseek-v4.1-flash', plan: 'CL', selectable: true, inLedger: true },
  { label: 'mystery-free', lane: { model: 'mystery-free' }, model: 'opencode/mystery-free', ref: 'opencode/mystery-free', plan: 'OC', selectable: true, inLedger: true },
  { label: 'laguna-s-2.1', lane: { model: 'laguna-s-2.1-free' }, model: 'opencode/laguna-s-2.1-free', ref: 'opencode/laguna-s-2.1-free', plan: 'OC', selectable: true, inLedger: true },
  { label: 'Muse 1.3', laneLabel: 'Muse 1.3', lane: { model: 'muse-spark-1.3-contributor' }, model: 'cline-free/muse-spark-1.3-contributor', ref: 'cline:cline-free/muse-spark-1.3-contributor', plan: 'CL', selectable: true, depleted: true, resetIn: '10h', inLedger: true },
  { label: 'Freebuff lane', lane: { model: 'deepseek-v4-flash' }, model: 'freebuff/deepseek-v4-flash', ref: 'freebuff/deepseek-v4-flash', plan: 'FB', selectable: true, terminalOnly: true, inLedger: true },
];
const out = formatFreemodelWithDepletion([], [], { current: 'x', location: 'vps', canonical: rows, tableLanes: [] });
const text = out.text;
check('the header and total survive the tier projection',
  text.includes('Free models at vps') && /Total: 5 · 3 usable/.test(text), text.split('\n')[4] || '');

const btns = out.buttons;
const btnText = (b) => (typeof b === 'string' ? b : b.text);
const refOf = (r) => r.lane?.model || r.model || r.ref || '';
const labelOf = (r) => r.laneLabel || r.label;
// Buttons print the row label, so the order is checked against what each row
// actually prints, not an internal id.
const nameOf = (r) => labelOf(r);

// 2. order: the keyboard follows the catalogs' own grouping, one heading per
// non-empty group with the same label and count /allowance prints above it.
const groups = groupRowsByTier(rows);
check('the keyboard has one button per row plus the group headings',
  groups.length > 1 && btns.length === rows.length + groups.length,
  `${btns.length} buttons for ${rows.length} rows / ${groups.length} groups`);
let cursor = 0;
let orderOk = true;
const seenHeadings = [];
for (const g of groups) {
  const heading = btnText(btns[cursor]);
  seenHeadings.push(heading);
  if (heading !== fitCopy(`${g.label} (${g.rows.length})`)) orderOk = false;
  cursor += 1;
  for (const r of g.rows) {
    if (!btnText(btns[cursor]).includes(nameOf(r))) orderOk = false;
    cursor += 1;
  }
}
check('the buttons follow the catalog tier order, head by head', orderOk && cursor === btns.length,
  seenHeadings.map((h) => h.split('(')[0].trim()).join(' → '));

// 3. every model button is the table's copy: 72 characters, dash last, the mark
// at index 0, ASCII spaces as the fill and no U+2002 anywhere in the label.
const modelBtns = btns.filter((b) => !b.header && b.data !== 'noop');
const shapeBad = modelBtns
  .filter((b) => b.text.length !== COPY_WIDTH || !b.text.endsWith('-') || !/^[✅❌]/.test(b.text) || !b.text.includes(' ') || b.text.includes('\u2002'))
  .map((b) => b.text);
check('every row button is 72 characters, dash last, ASCII filled', shapeBad.length === 0, shapeBad.slice(0, 2).join(' | '));
check('the heading rows are finished the same way',
  btns.filter((b) => b.data === 'noop').every((b) => b.text.length === COPY_WIDTH && b.text.endsWith('-') && b.text.includes(' ') && !b.text.includes('\u2002')));

// 4. the benchmark on the button is the catalog's own string, or nothing.
const scoreBad = rows
  .map((r) => ({ r, want: benchmarkLabel(r.model) }))
  .filter(({ r, want }) => want && !btnText(buttonFor(r)).includes(want))
  .map(({ r, want }) => `${labelOf(r)} wants ${want}`);
function buttonFor(r) {
  return btns.find((b) => typeof b === 'object' && b.ref === r.ref) || {};
}
check('every published benchmark appears on its button', scoreBad.length === 0, scoreBad.join('; '));
check('an unpublished benchmark shows the em dash, never a neighbour\'s number',
  String(scoreLabelFor('mystery-free')).length > 0
  && btnText(buttonFor(rows[1])).includes(benchmarkLabel(rows[1].model) || '—'));

// 5. depleted and terminal rows are rendered, but marked and never counted usable.
check('depleted and terminal rows stay out of usable',
  out.usable.length === 3 && out.unusable.length === 2
  && btnText(buttonFor(rows[3])).startsWith('❌ ')
  && btnText(buttonFor(rows[4])).startsWith('❌ ')
  && btnText(buttonFor(rows[0])).startsWith('✅ '),
  `${out.usable.length} usable / ${out.unusable.length} not usable`);

// 6. the keyboard: one object per row, route in data, headings a real noop.
check('one button per row, route carried in data not in text',
  out.rows.length === rows.length
  && rows.every((r) => { const b = buttonFor(r); return typeof b === 'object' && b.ref && b.data === b.ref && Boolean(b.text); })
  && btns.filter((b) => b.data === 'noop').every((b) => b.header === true),
  rows.map((r) => r.plan).join(','));

console.log(`\n${pass} pass, ${fail} fail`);
if (fail > 0) {
  console.error('\nFailures:\n' + failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
