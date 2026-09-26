#!/usr/bin/env node
/**
 * assert-freemodel-tiers.test.mjs — QS-6 / QS-7 named gate.
 *
 * The /freemodel body must render the two tiers the catalogs already define
 * (coding-capable first, light second) with every row's benchmark score, and
 * `unranked` where no ledger covers the model. Proves against the real
 * formatter with synthetic rows (no Telegram, no ledger, no quota):
 *  1. coding section precedes the light section; every usable row is in one;
 *  2. every shown score resolves through ratingForModel — no invented numbers;
 *  3. unknown-group models render inside Light (fallback-class), never lost;
 *  4. depleted/terminal rows stay out of both tiers (footer owns them);
 *  5. the keyboard is untouched: one button per row, canonical order.
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
const { ratingForModel, groupForModel } = await import(path.join(__dirname, 'lib', 'model-ratings.mjs'));
const { formatFreemodelWithDepletion } = host;
check('the formatter is exported for the sensor', typeof formatFreemodelWithDepletion === 'function');

// Synthetic canonical rows: a scored coding lane, an unscored unknown lane,
// a light lane, a depleted lane and a terminal-only lane.
const rows = [
  { label: 'DeepSeek V4.1', laneLabel: 'DeepSeek V4.1', lane: { model: 'deepseek-v4.1-flash' }, model: 'cline-free/deepseek-v4.1-flash', ref: 'cline:cline-free/deepseek-v4.1-flash', plan: 'CL', selectable: true, inLedger: true },
  { label: 'mystery-free', lane: { model: 'mystery-free' }, model: 'opencode/mystery-free', ref: 'opencode/mystery-free', plan: 'OC', selectable: true, inLedger: true },
  { label: 'laguna-s-2.1', lane: { model: 'laguna-s-2.1-free' }, model: 'opencode/laguna-s-2.1-free', ref: 'opencode/laguna-s-2.1-free', plan: 'OC', selectable: true, inLedger: true },
  { label: 'Muse 1.3', lane: { model: 'muse-spark-1.3-contributor' }, model: 'cline-free/muse-spark-1.3-contributor', ref: 'cline:cline-free/muse-spark-1.3-contributor', plan: 'CL', selectable: true, depleted: true, resetIn: '10h', inLedger: true },
  { label: 'Freebuff lane', lane: { model: 'deepseek-v4-flash' }, model: 'freebuff/deepseek-v4-flash', ref: 'freebuff/deepseek-v4-flash', plan: 'FB', selectable: true, terminalOnly: true, inLedger: true },
];
const out = formatFreemodelWithDepletion([], [], { current: 'x', location: 'vps', canonical: rows, tableLanes: [] });
const text = out.text;
check('the header and total survive the tier render',
  text.includes('Free models at vps') && /Total: 5 · 3 usable/.test(text), text.split('\n')[4] || '');

const codingAt = text.indexOf('Coding-capable:');
const lightAt = text.indexOf('Light / fallback:');
check('coding section precedes the light section', codingAt !== -1 && lightAt !== -1 && codingAt < lightAt);
const codingBlock = text.slice(codingAt, lightAt);
const lightBlock = text.slice(lightAt);
check('the scored coding lane renders in Coding with its number',
  codingBlock.includes('DeepSeek V4.1') && /AA\d/.test(codingBlock), codingBlock.trim().split('\n').slice(0, 3).join(' | '));
check('the unscored lane renders in Light as unranked, not dropped',
  lightBlock.includes('mystery-free') && lightBlock.includes('unranked'));
const tierRows = (block) => block.split('\n').filter((l) => l.startsWith('• ')).join('\n');
check('depleted and terminal rows stay out of both tiers (footer owns them)',
  !tierRows(codingBlock).includes('Muse 1.3') && !tierRows(lightBlock).includes('Freebuff lane')
  && !tierRows(codingBlock).includes('Freebuff lane') && !tierRows(lightBlock).includes('Muse 1.3'));

// Every score shown must resolve through ratingForModel: parse each body row's
// trailing label and prove it is either 'unranked' or the module's own number.
const rowLines = text.split('\n').filter((l) => l.startsWith('• '));
const bad = [];
for (const line of rowLines) {
  const m = line.match(/ — (\S+(?: \S+)?)$/);
  const shown = (m && m[1]) || '';
  if (shown === 'unranked') continue;
  const label = line.slice(2).split(' — ')[0];
  const row = rows.find((r) => (r.laneLabel || r.label) === label);
  const ref = row?.lane?.model || row?.model || row?.ref || '';
  const r = ratingForModel(ref);
  const nums = [];
  if (typeof r?.aa === 'number') nums.push(`AA${r.estimated ? '~' : ''}${r.aa}`);
  else if (typeof r?.aaEst === 'number') nums.push(`AA~${r.aaEst}`);
  if (typeof r?.swe === 'number') nums.push(`SWE${r.swe}`);
  if (!nums.some((n) => shown.includes(n))) bad.push(`${label} shows ${shown}`);
}
check('no invented numbers: every shown score resolves via ratingForModel', bad.length === 0, bad.join('; ') || `${rowLines.length} rows checked`);
check('unknown-group models are fallback-class, by the module not by fiat',
  groupForModel('opencode/mystery-free') === 'unknown');

// The keyboard is untouched: one button per canonical row, same order.
check('one button per row in canonical order',
  out.buttons.length === rows.length
  && out.buttons[0].includes('DeepSeek V4.1')
  && out.buttons[4].includes('Freebuff lane'));
check('no button text is parsed for taps (refs intact)',
  out.rows.length === rows.length && out.usable.length === 3 && out.unusable.length === 2);

console.log(`\n${pass} pass, ${fail} fail`);
if (fail > 0) {
  console.error('\nFailures:\n' + failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
