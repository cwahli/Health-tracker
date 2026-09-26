#!/usr/bin/env node
/**
 * assert-model-ratings — the benchmark rating on a /freemodel button is real.
 *
 * The rating comes from qa-evidence/model-comparison.json (the repo's canonical
 * scorecard, Artificial Analysis Intelligence Index v4.3, a composite that includes
 * Terminal-Bench 4.0 and AutomationBench-AA). Two things can silently rot it:
 *
 *   1. The scorecard is renamed or a row is reworded, and the alias table keeps
 *      pointing at a row that no longer exists — every button quietly loses its
 *      number, or worse, inherits a neighbour's.
 *   2. A rating is invented for a model nobody measured, which is the failure this
 *      whole file exists to prevent.
 *
 * So: every alias must resolve to a row that is actually in the scorecard, a model
 * with no alias must return nothing at all, and the button must carry the number.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RATING_ALIASES, ratingForModel, ratingSuffix, resolvedRatings } from './lib/model-ratings.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`  PASS  ${name}`); passed++; }
  else { console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); failed++; }
}

console.log('assert-model-ratings:');

// 1. The scorecard is the source and it is the one the repo calls canonical.
let doc = null;
let dir = HERE;
for (let i = 0; i < 6; i++) {
  const p = path.join(dir, 'qa-evidence', 'model-comparison.json');
  if (fs.existsSync(p)) { doc = JSON.parse(fs.readFileSync(p, 'utf8')); break; }
  const up = path.dirname(dir);
  if (up === dir) break;
  dir = up;
}
check('the canonical scorecard is present', Boolean(doc), doc ? '' : 'qa-evidence/model-comparison.json not found');
check('it declares itself the source of truth', /SOURCE OF TRUTH/.test(fs.readFileSync(path.join(dir, 'qa-evidence', 'model-comparison.json'), 'utf8')));
check('the metric is a coding-relevant index', doc ? /Terminal-Bench|AutomationBench/.test(JSON.stringify(doc.preamble || [])) : false);

// 2. Every alias resolves to a row that is really in the scorecard.
const all = resolvedRatings();
const unresolved = all.filter((r) => !r.rating);
check(`all ${all.length} rating aliases resolve`, unresolved.length === 0,
  unresolved.map((u) => `${u.id} -> "${u.alias}"`).join('; '));

// 3. The numbers are the ones the scorecard publishes, not numbers we typed.
const expect = {
  'muse-spark-1.3-contributor-free': 48,
  'muse-spark-1.2-contributor-free': 40,
  'mimo-v2.6-flash-free': 41,
  'nemotron-3.5-lightning-free': 13,
  'laguna-s-2.1-free': 26,
  'solar-pro4': 28,
  'gemini-3.8-flash': 41.2,
  'deepseek-v4.1-flash': 39.5,
};
for (const [id, score] of Object.entries(expect)) {
  check(`${id} reads ${score}`, ratingForModel(id)?.score === score, String(ratingForModel(id)?.score));
}

// 4. An unmeasured model gets nothing. This is the whole point.
for (const id of ['space-bunny-free', 'ox-alpha-free', 'x-preview-f-free', 'grok-code', 'ling-2.6-flash-free', 'kat-coder-pro']) {
  check(`${id} has no invented rating`, ratingForModel(id) === null, JSON.stringify(ratingForModel(id)));
}
check('a rated model renders a suffix', ratingSuffix('opencode/muse-spark-1.3-contributor-free') === ' · AA48', ratingSuffix('opencode/muse-spark-1.3-contributor-free'));
check('an estimated score is marked with a tilde', /AA~/.test(ratingSuffix('opencode/mimo-v2.6-flash-free')), ratingSuffix('opencode/mimo-v2.6-flash-free'));
check('an unrated model renders nothing', ratingSuffix('opencode/space-bunny-free') === '', `"${ratingSuffix('opencode/space-bunny-free')}"`);

// 5. The button carries it.
const botSrc = fs.readFileSync(path.join(HERE, 'bot-host.mjs'), 'utf8');
check('/freemodel puts the rating on the button', /ratingSuffix\(/.test(botSrc) && /const rated = /.test(botSrc));
check('and the button uses the rated label', /buttons\.push\(`\$\{unusableOf\(r\) \? '❌ ' : ''\}\$\{rated\}`\)/.test(botSrc));

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
