#!/usr/bin/env node
/**
 * assert-freemodel-tiers.test.mjs — QS-6 / QS-7 named gate.
 *
 * The /freemodel keyboard splits the free models the catalogs already define —
 * high first, unlisted next, light last — and every button carries the tier word
 * plus the bakeoff ledger's own verdict, or "unranked" where no ledger covers the
 * model. A keyboard has no subheadings, so the button is where the split is
 * visible. Proves against the real formatter with synthetic rows (no Telegram, no
 * ledger, no quota):
 *  1. the header and total survive the tier projection;
 *  2. button order is the catalog's tier order, not the caller's;
 *  3. every button names its tier, and the word is the catalog's mapping;
 *  4. every shown score is scoreLabelFor()'s own string — no invented numbers;
 *  5. an unlisted model says unranked, never a borrowed number;
 *  6. depleted/terminal rows stay out of usable (footer owns them);
 *  7. the keyboard is untouched: one button per row, the route in `data`, and no
 *     tap ever parses button text.
 *
 * Exit 0 on all pass; exit 1 with FAIL lines otherwise.
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
const { scoreLabelFor, tierForModel, walkTierRank } = await import(path.join(__dirname, 'lib', 'free-catalogs.mjs'));
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
// The mapping the formatter uses: a catalog tier word, "unranked" for a model
// the catalog does not name. Derived here so a catalog edit cannot leave this
// sensor asserting yesterday's words.
const TIER_WORD = { high: 'coding', light: 'light', unlisted: 'unranked' };
const tierWordOf = (r) => TIER_WORD[tierForModel(refOf(r)).tier || 'unlisted'] || 'unranked';

// 2. order: the keyboard follows the catalog's own ranking, stable within a tier
// so a caller cannot put a light lane above a coding one.
const byTier = [...rows].sort((a, b) => walkTierRank(refOf(a)) - walkTierRank(refOf(b)));
check('buttons follow the catalog tier order, not the caller order',
  btns.length === rows.length
  && byTier.every((r, i) => btnText(btns[i]).includes(labelOf(r))),
  btns.map(btnText).map((t) => t.split(' · ')[1] || t).join(' → '));

// 3. every button names its tier, in the formatter's own mapping.
const buttonFor = (r) => btns.find((b) => btnText(b).includes(labelOf(r)));
check('every button names its tier the way the catalog does',
  rows.every((r) => Boolean(buttonFor(r)) && btnText(buttonFor(r)).includes(` · ${tierWordOf(r)} · `)),
  rows.map((r) => tierWordOf(r)).join(','));

// 4. no invented numbers: the button ends in the ledger's own verdict string,
// whatever that string is ("bakeoff 4 pass · 1 partial" is one verdict).
const badScores = [];
for (const r of rows) {
  const b = buttonFor(r);
  const want = scoreLabelFor(refOf(r));
  if (!b || !btnText(b).endsWith(` · ${want}`)) badScores.push(`${labelOf(r)} shows "${b ? btnText(b) : 'no button'}", ledger says "${want}"`);
}
check('no invented numbers: every shown score is the ledger verdict', badScores.length === 0, badScores.join('; '));

// 5. a model the catalog does not rank says unranked, in both the tier word and
// the score, rather than borrowing another model's number.
const mystery = btns.find((b) => btnText(b).includes('mystery-free'));
check('an unknown model is unranked, not borrowed',
  Boolean(mystery) && btnText(mystery).includes(' · unranked · ') && String(scoreLabelFor('mystery-free')) === 'unranked',
  mystery ? btnText(mystery) : 'button missing');

// 6. depleted and terminal rows are rendered, but never counted usable.
check('depleted and terminal rows stay out of usable',
  out.usable.length === 3 && out.unusable.length === 2
  && btnText(btns.find((b) => btnText(b).includes('Muse 1.3'))).startsWith('❌ ')
  && btnText(btns.find((b) => btnText(b).includes('Freebuff lane'))).startsWith('❌ '),
  `${out.usable.length} usable / ${out.unusable.length} not usable`);

// 7. the keyboard: one object per row, route in data, text never parsed for taps.
check('one button per row, route carried in data not in text',
  out.buttons.length === rows.length && out.rows.length === rows.length
  && out.buttons.every((b) => typeof b === 'object' && b.ref && b.data === b.ref && Boolean(b.text)),
  out.buttons.map((b) => b.data).join(', '));

console.log(`\n${pass} pass, ${fail} fail`);
if (fail > 0) {
  console.error('\nFailures:\n' + failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
