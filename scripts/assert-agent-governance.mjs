#!/usr/bin/env node
/**
 * Gate for agent governance + domain regression foundation (M20).
 * Ensures process docs + regression tests exist and key contracts are present.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
let pass = true;
const fail = (m) => {
  console.error('❌', m);
  pass = false;
};
const ok = (m) => console.log('✅', m);

const mustExist = [
  'AGENTS.md',
  'AI_HANDOVER.md',
  'docs/agent/README.md',
  'docs/agent/PACKS.md',
  'docs/agent/TEMPLATES.md',
  'docs/agent/DOMAIN_REGRESSION_MAP.md',
  'docs/agent/domains/food-calc.md',
  'docs/agent/domains/biomarkers.md',
  'docs/agent/domains/sync.md',
  'src/utils/syncUtils.regression.test.ts',
  'src/utils/biomarkerIdentity.test.ts',
  'server_portion_clarify.test.ts',
];

for (const f of mustExist) {
  if (!fs.existsSync(path.join(root, f))) fail(`missing file: ${f}`);
  else ok(`exists: ${f}`);
}

const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

// AGENTS.md contracts
const agents = read('AGENTS.md');
// fef0913 deliberately retired "Commit/push = AI Studio only": any surface may
// commit/push after COMPLETE. Pin the current contract, not the removed rule.
if (!/commit\/push from any surface|commit and push.*after COMPLETE/i.test(agents)) {
  fail('AGENTS.md must state commit/push from any surface after COMPLETE');
} else ok('AGENTS.md: commit from any surface after COMPLETE');

if (!/Protected|before.?after|confirmation/i.test(agents)) {
  fail('AGENTS.md must protect process docs with confirmation + before/after');
} else ok('AGENTS.md: protected docs policy');

if (!/AI_HANDOVER\.md/.test(agents) || !/plan\//.test(agents)) {
  fail('AGENTS.md must distinguish AI_HANDOVER vs plan/');
} else ok('AGENTS.md: document roles');

if (!/evolution|fossilize|not a freeze|Evolution allowed/i.test(agents)) {
  fail('AGENTS.md must allow rulebook evolution (not rigid freeze)');
} else ok('AGENTS.md: evolution-friendly L9');

if (!/STALE_TURN/.test(agents)) {
  fail('AGENTS.md must classify STALE_TURN (preview vs debug mismatch is job-session, not food-calc)');
} else ok('AGENTS.md: STALE_TURN class');

if (!/JobStore\.ts/.test(agents) || !/TaskPlaceholderCard/.test(agents) || !/JobSession\.contract\.test/.test(agents)) {
  fail('AGENTS.md L1 must list job-lifecycle files and require JobSession.contract.test.ts when they change from food-calc');
} else ok('AGENTS.md: job-lifecycle blast list');

const templates = read('docs/agent/TEMPLATES.md');
if (!/layer job-session/.test(templates) || !/STALE_TURN/.test(templates)) {
  fail('TEMPLATES.md IMPACT must include layer + STALE_TURN');
} else ok('TEMPLATES.md: job-session IMPACT');

const regressionMap = read('docs/agent/DOMAIN_REGRESSION_MAP.md');
if (!/JobSession\.contract\.test/.test(regressionMap) || !/assert-dev-serves-vite/.test(regressionMap)) {
  fail('DOMAIN_REGRESSION_MAP.md must name JobSession.contract.test.ts and assert-dev-serves-vite.mjs');
} else ok('DOMAIN_REGRESSION_MAP.md: job-session row');

// Rulebooks not pure freeze language only
const food = read('docs/agent/domains/food-calc.md');
if (!/Evolution|deliberately|default/i.test(food)) {
  fail('food-calc rulebook should allow deliberate evolution');
} else ok('food-calc: evolution-aware');

// Code contracts for regression foundation
const sync = read('src/utils/syncUtils.ts');
if (!/export function mergeDeleteMaps/.test(sync)) fail('syncUtils must export mergeDeleteMaps');
else ok('mergeDeleteMaps exported');
// bca0f80 folded tombstone filtering into mergeDeleteMaps and dropped the old
// filterLogsByTombstone export (its only caller was its own test). Pin the
// surviving behavior, not the removed name.
if (!/tombstone/i.test(sync)) fail('syncUtils must keep tombstone filtering (mergeDeleteMaps)');
else ok('tombstone filtering present');

const scout = read('src/server/food/scoutGeometry.ts');
if (!/estimatedCalories:\s*vItem\.estimatedCalories\s*\?\?\s*lItem\.estimatedCalories/.test(scout)) {
  fail('mergeScoutItems must preserve vision estimatedCalories');
} else ok('mergeScoutItems estimatedCalories preserve');
if (!/components:/.test(scout) || !/vItem\.components/.test(scout)) {
  fail('mergeScoutItems must preserve vision components');
} else ok('mergeScoutItems components preserve');

const bio = read('src/utils/biomarkers.ts');
if (!/return clean \|\| rawKey/.test(bio)) {
  fail('getMappedBiomarkerKey should canonicalize unknown keys to clean slug');
} else ok('getMappedBiomarkerKey clean slug fallback');

// Handover points at M20 or governance
const hand = read('AI_HANDOVER.md');
if (!/M20_AGENT_GOVERNANCE|docs\/agent|AI Studio only/i.test(hand)) {
  fail('AI_HANDOVER should reference governance / Studio ship path');
} else ok('AI_HANDOVER governance pointers');

if (!pass) {
  console.error('=== GATE FAILED ===');
  process.exit(1);
}
console.log('=== ALL ASSERTIONS PASSED (exit 0) ===');
process.exit(0);
