#!/usr/bin/env node
/**
 * assert-tier-pin.mjs — high-tier failover must never silently downgrade.
 *
 * A `high` primary with a `light` fallback fails closed on the high lane
 * (one attempt, light dropped, no switch line) unless the turn explicitly
 * opts in with `allowTierDowngrade: true`. Non-high primaries and unknown
 * tiers pass through untouched (stub chains behave as before).
 *
 * Exit 0 on all pass; exit 1 with FAIL lines otherwise.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

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

console.log('assert-tier-pin (no silent high → light)\n');

const lib = await import(
  new URL(`file://${path.join(ROOT, 'scripts/lib/agent-opencode.mjs').replace(/\\/g, '/')}`).href
);
check('exports isTransportFailure', typeof lib.isTransportFailure === 'function');
check('exports tierOfModel', typeof lib.tierOfModel === 'function');
check('exports pinTierModels', typeof lib.pinTierModels === 'function');

check('transport classifier hits endpoint-unavailable',
  lib.isTransportFailure('Upstream request failed: Endpoint is unavailable.'));
check('transport classifier hits 503/high-demand',
  lib.isTransportFailure('code 503 "high demand"'));
check('transport classifier ignores quota wording',
  !lib.isTransportFailure('rate limit exceeded, resets at 12:00'));

const tiers = { high1: 'high', high2: 'high', light1: 'light', light2: 'light' };
const tierOf = (ref) => tiers[ref] ?? null;

const pinned = lib.pinTierModels(['high1', 'light1'], { tierOf });
check('high primary drops light fallback',
  pinned.models.length === 1 && pinned.models[0] === 'high1');
check('dropped names the light lane',
  pinned.dropped.length === 1 && pinned.dropped[0] === 'light1');

const keptHigh = lib.pinTierModels(['high1', 'high2', 'light1'], { tierOf });
check('high-to-high failover survives the pin',
  JSON.stringify(keptHigh.models) === JSON.stringify(['high1', 'high2']));

const lightFirst = lib.pinTierModels(['light1', 'light2'], { tierOf });
check('light primary chain untouched',
  JSON.stringify(lightFirst.models) === JSON.stringify(['light1', 'light2']));

const unknown = lib.pinTierModels(['m1', 'm2'], { tierOf });
check('unknown tiers untouched (stub chains as before)',
  JSON.stringify(unknown.models) === JSON.stringify(['m1', 'm2']));

const opted = lib.pinTierModels(['high1', 'light1'], { tierOf, allowTierDowngrade: true });
check('explicit opt-in restores the full chain',
  JSON.stringify(opted.models) === JSON.stringify(['high1', 'light1']));

// End to end through the real runner: a dead high lane must NOT spend the
// light fallback and must NOT emit a switch line (no silent downgrade).
const seen = [];
const switched = [];
const res = await lib.runWithModelFailover({
  models: ['high1', 'light1'],
  tierOf,
  makeRun: async (model) => {
    seen.push(model);
    return { finalText: '', lastError: 'Endpoint is unavailable' };
  },
  onSwitch: (s) => switched.push(s),
});
check('dead high lane attempts once, never touches light',
  seen.length === 1 && seen[0] === 'high1');
check('no switch line on a pinned chain', switched.length === 0);
check('pin reported back to the caller',
  res.tierPinned === true && res.dropped.length === 1);

console.log(`\n${pass} pass, ${fail} fail`);
if (fail > 0) {
  console.error('\nFailures:\n' + failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
