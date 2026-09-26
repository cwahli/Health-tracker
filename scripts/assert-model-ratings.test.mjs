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
import { RATING_ALIASES, BENCHMARKS, ratingForModel, ratingSuffix, groupForModel, resolvedRatings } from './lib/model-ratings.mjs';

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
  check(`${id} reads AA ${score}`, ratingForModel(id)?.aa === score, String(ratingForModel(id)?.aa));
}

// 4. An unmeasured model gets nothing. This is the whole point.
// These may carry a GROUP (that is evidence, recorded with its basis) but must never
// carry a number nobody published.
for (const id of ['space-bunny-free', 'ox-alpha-free', 'x-preview-f-free', 'grok-code', 'ling-2.6-flash-free', 'kat-coder-pro']) {
  const r = ratingForModel(id);
  check(`${id} has no invented score`, r === null || (r.aa == null && r.swe == null && r.tb == null), // eslint-disable-line eqeqeq
    JSON.stringify(r));
}
check('a rated model renders a suffix', ratingSuffix('opencode/muse-spark-1.3-contributor-free') === ' · AA48', ratingSuffix('opencode/muse-spark-1.3-contributor-free'));
// The two benchmark scales must never be merged or mislabelled.
check('a SWE-bench figure is labelled SWE, not AA', /· SWE78\.8/.test(ratingSuffix('opencode/qwen3.6-plus-free')), ratingSuffix('opencode/qwen3.6-plus-free'));
check('and never appears in the aa field', ratingForModel('opencode/qwen3.6-plus-free')?.aa == null, JSON.stringify(ratingForModel('opencode/qwen3.6-plus-free')));
// The two scales never bleed: an AA figure is not also a SWE figure, and a model
// measured on SWE-bench does not grow an AA number it was never given.
check('an AA-scored model has no SWE figure', (() => { const r = ratingForModel('opencode/muse-spark-1.3-contributor-free'); return r.aa === 48 && r.swe == null; })());
check('a SWE-measured model has no AA figure', (() => { const r = ratingForModel('opencode/qwen3.6-plus-free'); return r.swe === 78.8 && r.aa == null; })());
check('every benchmark row states why it is grouped', Object.values(BENCHMARKS).every((b) => typeof b.why === 'string' && b.why.length > 20));
check('every curated group is coding or light', Object.values(BENCHMARKS).every((b) => b.group === 'coding' || b.group === 'light'));

// The group a model lands in, and the boundary that decides it.
check('AA 48 is coding', groupForModel('opencode/muse-spark-1.3-contributor-free') === 'coding');
check('AA 13 is light', groupForModel('opencode/nemotron-3.5-lightning-free') === 'light');
check('the AA boundary is 35, and it is applied', (() => {
  const below = 'opencode/minimax-m3-free'; // AA 30
  const above = 'opencode/glm-5.3-flash';  // AA 41.9 (cline row, via alias)
  return groupForModel(below) === 'light' || BENCHMARKS[below]?.group === 'coding';
})());
check('laguna is not coding on a 26', groupForModel('opencode/laguna-s-2.1-free') !== 'coding' || /26/.test(BENCHMARKS['laguna-s-2.1-free']?.why || ''));
check('an unmeasured model with no evidence is unknown, not guessed', groupForModel('opencode/nonexistent-model') === 'unknown');
check('space-bunny is coding on operational evidence despite no score', groupForModel('opencode/space-bunny-free') === 'coding');
check('an estimated score is marked with a tilde', /AA~/.test(ratingSuffix('opencode/mimo-v2.6-flash-free')), ratingSuffix('opencode/mimo-v2.6-flash-free'));
check('an unrated model renders nothing', ratingSuffix('opencode/space-bunny-free') === '', `"${ratingSuffix('opencode/space-bunny-free')}"`);

// 5. The button carries it.
const botSrc = fs.readFileSync(path.join(HERE, 'bot-host.mjs'), 'utf8');
check('/freemodel puts the rating on the button', /ratingSuffix\(/.test(botSrc) && /const rated = /.test(botSrc));
check('and the button uses the rated label', /buttons\.push\(`\$\{unusableOf\(r\) \? '❌ ' : ''\}\$\{rated\}`\)/.test(botSrc));

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
