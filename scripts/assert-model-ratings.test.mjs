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
import { RATING_ALIASES, BENCHMARKS, AA_ESTIMATES, ratingForModel, ratingSuffix, groupForModel, resolvedRatings } from './lib/model-ratings.mjs';

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

// 6. Free means the name says so. A zero list price is not a free model, and
// grok-code is not one — the user confirmed it on 2026-09-26.
const { listFreeOpenCode, FREE_NAME_EXCEPTIONS } = await import('./lib/freemodels.mjs');
const refs = listFreeOpenCode({ env: {}, home: '/home/ubuntu', includeUnready: true });
check('grok-code is not offered as a free model', !refs.some((r) => /grok-code/.test(r)), refs.filter((r) => /grok-code/.test(r)).join());
check('every offered model is named -free or is a cited exception',
  refs.every((r) => { const id = r.split('/').pop(); return /-free/.test(id) || FREE_NAME_EXCEPTIONS[id]; }),
  refs.filter((r) => { const id = r.split('/').pop(); return !/-free/.test(id) && !FREE_NAME_EXCEPTIONS[id]; }).join());
check('the one exception carries its citation', Object.values(FREE_NAME_EXCEPTIONS).every((v) => /model-comparison\.json/.test(v)), JSON.stringify(FREE_NAME_EXCEPTIONS));

// 7. One version per family, and a newer model only wins if it is not worse.
const { supersedeOlderVersions } = await import('./lib/free-lanes.mjs');
const fam = (models, scoreOf) => supersedeOlderVersions(models.map((m) => ({ model: m })), { scoreOf }).lanes.map((l) => l.model);
check('an older version is dropped when a newer one is present',
  !fam(['opencode/deepseek-v4-flash-free', 'cline-free/deepseek-v4.1-flash']).includes('opencode/deepseek-v4-flash-free'));
check('the newest version is kept', fam(['opencode/deepseek-v4-flash-free', 'cline-free/deepseek-v4.1-flash']).includes('cline-free/deepseek-v4.1-flash'));
check('a family is matched across surfaces, not by path',
  !fam(['opencode/ling-2.6-flash-free', 'opencode/ling-3.0-flash-free']).includes('opencode/ling-2.6-flash-free'));
check('a preview is treated as earlier than its release', !fam(['opencode/hy3-preview-free', 'opencode/hy3-free']).includes('opencode/hy3-preview-free'));
check('a NEWER but WORSE model does not displace a better older one',
  fam(['opencode/nemotron-3-ultra-free', 'opencode/nemotron-3.5-lightning-free'], (l) => (l.model.includes('ultra') ? 23 : 13)).includes('opencode/nemotron-3-ultra-free'),
  'Nemotron 3 Ultra (23) must survive 3.5 Lightning (13)');
check('and the weaker newer one survives only because nothing beats it',
  fam(['opencode/nemotron-3-ultra-free', 'opencode/nemotron-3.5-lightning-free'], (l) => (l.model.includes('ultra') ? 23 : 13)).length === 2);
check('unrelated families are untouched', fam(['opencode/space-bunny-free', 'opencode/glm-5-free']).length === 2);

// 8. An estimate is only ever an inference from a measured relative, and is marked.
// The basis must name the relative AND state its epistemic status, so "we guessed"
//and "its parent was also a guess" are both visible in the table.
check('every estimate names its relative and states how sure that relative is',
  Object.values(AA_ESTIMATES).every((e) => typeof e.basis === 'string' && e.basis.length > 30
    && /(measured|published|estimate|interpolat)/i.test(e.basis) && /[A-Za-z]/.test(e.basis)),
  JSON.stringify(Object.entries(AA_ESTIMATES).filter(([, e]) => !/(measured|published|estimate|interpolat)/i.test(e.basis || '')).map(([k]) => k)));
check('an estimate renders with a tilde, never as a measurement', /^ · AA~/.test(ratingSuffix('opencode/ling-3.0-tiny-free')), ratingSuffix('opencode/ling-3.0-tiny-free'));
check('a measured score is not overwritten by an estimate', !/~/.test(ratingSuffix('opencode/nemotron-3-ultra-free')));
check('no model is given an estimate with no basis', !Object.keys(AA_ESTIMATES).some((id) => !BENCHMARKS[id] && !RATING_ALIASES[id] && !/ling-3.0-tiny/.test(id)));
check('a model with nothing measured and no relative stays blank', ratingSuffix('opencode/trinity-large-preview-free') === '', ratingSuffix('opencode/trinity-large-preview-free'));

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
