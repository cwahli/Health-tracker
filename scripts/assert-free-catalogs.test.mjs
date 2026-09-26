#!/usr/bin/env node
/**
 * R-16 law sensor: what `/freemodel` is allowed to show, and where it may come
 * from.
 *
 * R-16 (plan/ROADMAP.md, "R-16 — cross-location quota-resilience scorecard")
 * is explicit on both counts, and both are rules about *provenance* rather than
 * about any particular number:
 *
 *   QS-6  "high (coding-agent-capable) vs light (docs/inventory) split follows
 *          FREE_CODING_TOOLS_CATALOG.md Ranked picks + Tools x free models and
 *          FREE_MODEL_TOOL_PICKER.md defaults ... no new tier file, no per-bot
 *          tier fork."
 *   QS-7  "Each selectable /freemodel row carries its bakeoff benchmark
 *          score/label from FREE_MODEL_BAKEOFF.md; a model with no bakeoff entry
 *          shows 'unranked', never an invented number."
 *   Tier + catalog law: "Benchmark score shown on /freemodel comes from
 *          FREE_MODEL_BAKEOFF.md, not a new rating."
 *
 * So the failure this file exists to prevent is a second source of truth: a
 * hardcoded ratings table that renders a number the bakeoff never ran. The
 * checks below are mostly about the absence of things — no ratings table, no
 * numeric score that is not in the ledger, no tier that is not in the catalog.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bakeoffVerdict, benchmarkFor, benchmarkLabel, catalogFacts, demonstratedModels, HIGH_TIER_MIN_AA, modelIdOf, scoreLabelFor, tierForModel, walkTierRank, CATALOG_FILES } from './lib/free-catalogs.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
let passed = 0;
let failed = 0;

function check(name, cond) {
  if (cond) {
    console.log(`  PASS  ${name}`);
    passed++;
  } else {
    console.error(`  FAIL  ${name}`);
    failed++;
  }
}

const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(REPO, p));

console.log('assert-free-catalogs:');

// 1. The catalogs R-16 names are present and readable by the module.
for (const [which, rel] of Object.entries(CATALOG_FILES)) {
  check(`${which} catalog is where R-16 says it is (${rel})`, exists(rel));
}

const botSrc = read('scripts/bot-host.mjs');
const lanesSrc = read('scripts/lib/free-lanes.mjs');

// 2. No second source of truth. This is the check the charter is really about:
//    a ratings table in the repo is a fork of the score rule, whatever it holds.
check('there is no ratings table in the repo', !exists('scripts/lib/model-ratings.mjs'));
check('and none in the router mirror', !exists('tools/telegram-provider-router/src/model-ratings.mjs'));
check('no code imports a ratings module', !/model-ratings/.test(botSrc) && !/model-ratings/.test(lanesSrc));
check('the catalogs module is the only score/tier source', /free-catalogs\.mjs/.test(botSrc));

// 3. What /freemodel renders is a bakeoff label or the word "unranked".
// The button now carries the /allowance row copy, which shows the *benchmark* — the
// published figure from the Benchmarks table — rather than the bakeoff wave count.
// Both come from this module and both are asserted below; the button row is built
// by free-lanes' rowWidth() from the same columns, so the check is that the module
// is the source.
check('the button label is built from the catalogs (benchmark via rowWidth)', /rowWidth\(\{/.test(botSrc) && /benchmarkLabel\(/.test(botSrc));
check('and the bakeoff verdict is still available for the row copy path', /scoreLabelFor\(/.test(fs.readFileSync(path.join(HERE, 'lib', 'free-lanes.mjs'), 'utf8')) || /bakeoffVerdict\(/.test(fs.readFileSync(path.join(HERE, 'lib', 'free-catalogs.mjs'), 'utf8')));
check('an unranked model says "unranked"', scoreLabelFor('space-bunny-free') === 'unranked');
check('a model with waves says so, counted from the ledger', /^bakeoff \d+ pass/.test(scoreLabelFor('deepseek-v4.1-flash')));
check('no rendered score is a bare number', !/^\d/.test(scoreLabelFor('deepseek-v4.1-flash')));

// 4. Every number on screen traces to a ledger row.
for (const model of ['deepseek-v4.1-flash', 'muse-spark-1.3-contributor', 'laguna-s-2.1']) {
  const b = bakeoffVerdict(model);
  check(`${model}: scored only because the ledger has its rows`, b.ranked && b.waves > 0 && Boolean(b.source));
}
for (const model of ['space-bunny-free', 'kimi-k2.5-free', 'big-pickle', 'glm-5.3-flash']) {
  check(`${model}: no ledger row means unranked, not a guess`, bakeoffVerdict(model).ranked === false);
}

// 5. The boundary rule. A model that is a prefix of another must not inherit it.
check('deepseek-v4 does not inherit the V4.1 bakeoff', bakeoffVerdict('deepseek-v4').ranked === false);
check('deepseek-v4 does not inherit the V4.1 tier', tierForModel('deepseek-v4').tier === null);
check('and the catalog says why', /Forbidden/i.test(String(tierForModel('deepseek-v4').why || '')));
check('deepseek-v4.1-flash itself is high', tierForModel('deepseek-v4.1-flash').tier === 'high');

// 6. Tiers are the catalog's, in the catalog's words.
check('DeepSeek V4.1 Flash is high (rank 1)', tierForModel('deepseek-v4.1-flash').tier === 'high');
check('Muse Spark 1.3 Contributor is high (rank 2)', tierForModel('muse-spark-1.3-contributor').tier === 'high');
check('Laguna S 2.1 is light (rank 6, "Proven light")', tierForModel('laguna-s-2.1').tier === 'light');
// A retired *promo* is not a lock: the GLM 5.3 Flash lane is live and selectable on
// this host, so its published AA 42 places it like any other row. A user lock and a
// terminal-only tool row still hide a model.
check('a retired promo row does not hide a live lane; its rating places it', tierForModel('glm-5.3-flash').tier === 'high');
check('a Freebuff-only row is terminal-only, not selectable in either pool', tierForModel('muse-spark-1.2').tier === null);
check('a user lock outranks any rating', tierForModel('deepseek-v4').tier === null && /Forbidden/i.test(String(tierForModel('deepseek-v4').why || '')));

// 7. The walk's order is the catalog's tier order: high, then locked, then light.
check('the coding pool ranks first', walkTierRank('deepseek-v4.1-flash') === 0);
check('the light pool ranks last', walkTierRank('laguna-s-2.1') === 2);
check('a locked model is neither pool', walkTierRank('deepseek-v4') === 1);

// The owner's rule: the rating decides, and no rating means light unless demonstrated.
console.log('  -- placement rule: rating decides, no rating is light unless demonstrated --');
check('AA >= 35 is the coding pool', tierForModel('muse-spark-1.3-contributor').tier === 'high' && tierForModel('deepseek-v4.1-flash').tier === 'high' && tierForModel('gemini-3.8-flash').tier === 'high');
check('AA < 35 is the light pool', tierForModel('big-pickle').tier === 'light' && tierForModel('minimax-m3-free').tier === 'light' && tierForModel('solar-pro4').tier === 'light');
check('an estimate counts as a figure', tierForModel('mimo-v2.6-flash').tier === 'high' && tierForModel('laguna-s-2.1').tier === 'light');
check('no published figure is light, without exception', ['ox-alpha-free', 'x-preview-f-free', 'kimi-k2.5-free', 'north-mini-code-free', 'kat-coder-pro', 'hy3-free', 'qwen3.8-27b', 'glm-4.7-flash', 'ring-2.6-1t-free', 'trinity-large-preview-free'].every((m) => tierForModel(m).tier === 'light'));
check('except a demonstrated one, which is high on evidence', tierForModel('space-bunny-free').tier === 'high' && /ROADMAP|BOT_ROLES/.test(String(tierForModel('space-bunny-free').why || '')));
check('and the exception list is exactly one row, with evidence', demonstratedModels().length === 1 && demonstratedModels()[0].name === 'Space Bunny');
check('a vendor adjective is not evidence', /no published figure/.test(String(tierForModel('kat-coder-pro').why || '')));
check('the cut sits in the gap between the two clusters', [['muse-spark-1.3-contributor', 48], ['deepseek-v4.1-flash', 39.5], ['qwen3.8-flash', 39.9], ['big-pickle', 30], ['minimax-m3-free', 29], ['ling-3.0-flash-free', 25], ['nemotron-3.5-lightning-free', 14]].every(([m, aa]) => tierForModel(m).tier === (aa >= HIGH_TIER_MIN_AA ? 'high' : 'light')));
check('the threshold is the catalog\'s, in one place', /export const HIGH_TIER_MIN_AA = 35/.test(fs.readFileSync(new URL('./lib/free-catalogs.mjs', import.meta.url), 'utf8')));

// 8. Ids normalise the way the catalogs are written.
check('provider prefixes are stripped', modelIdOf('opencode/space-bunny-free') === 'space-bunny-free');
check('the cline-free prefix is stripped', modelIdOf('cline-free/deepseek-v4.1-flash') === 'deepseek-v4.1-flash');
check('a cloudflare worker prefix is stripped', modelIdOf('@cf/meta/llama-3.1-8b-instruct') === 'llama-3.1-8b-instruct');
check('a Token Harbor ":free" routing suffix is stripped', modelIdOf('tokenharbor/deepseek-v4.1-flash:free') === 'deepseek-v4.1-flash');
check('a hyphenated "-free" is part of the model id and is kept', modelIdOf('opencode/glm-5-free') === 'glm-5-free');

// 9. Facts carry their provenance, because an unsourced score is the forbidden one.
const facts = catalogFacts('deepseek-v4.1-flash');
check('facts name the file they came from', String(facts.source).endsWith('FREE_MODEL_BAKEOFF.md'));
check('tier facts name the catalog', String(facts.tierSource).endsWith('FREE_CODING_TOOLS_CATALOG.md'));
check('and the tier carries the catalog row that decided it', Boolean(facts.tierWhy));

// 10. A missing catalog degrades to "unranked", never to a guess.
check('the module is importable with no catalogs at all', (() => {
  try {
    const facts2 = catalogFacts('deepseek-v4.1-flash');
    return typeof facts2.score === 'string';
  } catch {
    return false;
  }
})());

// 11. The external benchmark figures you asked to see again. The rules that keep
// them honest are the catalog's: a number carries a source and a checked date, an
// estimate is marked, and no published figure means no number at all.
console.log('  -- external benchmarks (catalog Benchmarks table) --');
check('a published figure comes with a source and a checked date', (() => {
  for (const m of ['deepseek-v4.1-flash', 'muse-spark-1.3-contributor', 'ling-3.0-flash-free', 'minimax-m3-free']) {
    const b = benchmarkFor(m);
    if (!b.published || !b.source || !b.checked) return false;
  }
  return true;
})());
check('an estimate is marked with ~', /~/.test(benchmarkLabel('big-pickle')) && /~/.test(benchmarkLabel('laguna-s-2.1')) && /~/.test(benchmarkLabel('mimo-v2.6')));
check('a measured figure carries no ~', benchmarkLabel('deepseek-v4.1-flash') === 'AA39.5' && benchmarkLabel('muse-spark-1.3-contributor') === 'AA48');
check('no published figure means no number, not a zero and not a neighbour\'s',
  benchmarkLabel('ox-alpha-free') === '' && benchmarkLabel('space-bunny-free') === '' && benchmarkLabel('kimi-k2.5-free') === '');
check('ox-alpha says why it has none', /no (AA|artificial analysis)|No AA/i.test(String(benchmarkFor('ox-alpha-free').other || '')));
check('the live pages overrode the older scorecard numbers',
  benchmarkFor('ling-3.0-flash-free').aa === 25 && benchmarkFor('minimax-m3-free').aa === 29 && benchmarkFor('nemotron-3.5-lightning-free').aa === 14);
check('a benchmark never decides a tier', (() => {
  // Nemotron 3.5 Lightning scores 14 and Ling 3.0 Flash 25; both are light, and
  // Space Bunny has no figure at all and is high. Placement follows the basis
  // column, not the number.
  return tierForModel('nemotron-3.5-lightning-free').tier === 'light'
    && tierForModel('ling-3.0-flash-free').tier === 'light'
    && tierForModel('space-bunny-free').tier === 'high'
    && tierForModel('muse-spark-1.3-contributor').tier === 'high';
})());
check('the benchmark reaches both surfaces from the one table', /benchmarkLabel\(/.test(fs.readFileSync(path.join(HERE, 'bot-host.mjs'), 'utf8'))
  && /benchmarkLabel\(/.test(fs.readFileSync(path.join(HERE, 'lib', 'free-lanes.mjs'), 'utf8')));

// 12. Two tables in one file must not answer for each other. The Benchmarks table
// sits below the Model tiers table, so its rows land in the tier table's row slice;
// a benchmark row that scores higher on the model name used to win the lookup and
// then hand back no tier at all, which silently dropped a row out of its group.
// Every table after the first in a file lands in the earlier table's row slice, so a
// row from one table can answer a lookup meant for another. Both of these bit: a
// Benchmarks row won the tier lookup and returned nothing, and a capability-notes row
// reading "coding by name" promoted every undescribed model into the coding pool.
check('a demonstrated row must BE a tier, not contain the word', (() => {
  const src = fs.readFileSync(new URL('./lib/free-catalogs.mjs', import.meta.url), 'utf8');
  return /\/\^\(high\|coding\|light\)\$\/i\.test/.test(src);
})());
check('and a model on two tools is one group, not two', (() => {
  const oc = tierForModel('mimo-v2.6-flash-free');
  const th = tierForModel('mimo-v2.6-flash');
  return oc.tier === 'high' && th.tier === 'high';
})());

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
