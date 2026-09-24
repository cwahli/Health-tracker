#!/usr/bin/env node
/**
 * scripts/assert-memory-stores.mjs
 *
 * BOT-13 Assertion Gate:
 * Retrieved memory, not dumped. Verifies the memory-stores contract without
 * touching the live ~/.hermes home:
 *  - lib exports the retrieval/health/false-fire surface with the locked caps
 *  - setup-hermes-global-soul.sh seeds the three stores and keeps USER.md
 *    within its 1,375-char cap
 *  - functional self-test in a temp home: append, turn-gated retrieve,
 *    health receipts, false-fire counts
 *
 * Usage:
 *   node scripts/assert-memory-stores.mjs
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

let failures = [];
let checksPassed = 0;

function check(name, condition, errorMsg = '') {
  if (condition) {
    checksPassed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}: ${errorMsg}`);
    console.error(`  ✗ ${name}: ${errorMsg}`);
  }
}

console.log('[BOT-13] Running memory-stores assertion gate...');

const lib = await import('./lib/memory-stores.mjs');

// 1. Locked surface and caps (plan/BOT_ROLES.md §0).
check('lib exports appendRow', typeof lib.appendRow === 'function');
check('lib exports retrieve', typeof lib.retrieve === 'function');
check('lib exports healthCheck', typeof lib.healthCheck === 'function');
check('lib exports noteFalseFire', typeof lib.noteFalseFire === 'function');
check('USER_CAP is 1375', lib.USER_CAP === 1375, `got ${lib.USER_CAP}`);
check('MEMORY_CAP is 2200', lib.MEMORY_CAP === 2200, `got ${lib.MEMORY_CAP}`);
check(
  'stores are decisions/dead-ends/facts',
  JSON.stringify(lib.STORES) === JSON.stringify(['decisions', 'dead-ends', 'facts']),
  `got ${JSON.stringify(lib.STORES)}`,
);
check(
  'retrieve turns are build/investigate/decide',
  lib.RETRIEVE_TURNS.has('build') && lib.RETRIEVE_TURNS.has('investigate') &&
  lib.RETRIEVE_TURNS.has('decide') && lib.RETRIEVE_TURNS.size === 3,
);

// 2. Deploy path seeds the stores and respects the USER cap.
const setupPath = path.join(ROOT, 'scripts', 'setup-hermes-global-soul.sh');
const setup = fs.existsSync(setupPath) ? fs.readFileSync(setupPath, 'utf8') : '';
check('setup script exists', setup.length > 0);
check(
  'setup seeds memories/stores',
  setup.includes('memories/stores'),
  'setup-hermes-global-soul.sh never creates the stores dir',
);
const userContent = setup.match(/^USER_CONTENT="([\s\S]*?)"\s*$/m);
check('setup defines USER_CONTENT', Boolean(userContent));
if (userContent) {
  check(
    'setup USER_CONTENT within 1375-char cap',
    userContent[1].length <= 1375,
    `${userContent[1].length} chars`,
  );
}

// 3. Functional self-test in a temp home (never the live ~/.hermes).
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mem13-'));
const memDir = path.join(home, '.hermes', 'memories');
fs.mkdirSync(memDir, { recursive: true });
fs.writeFileSync(path.join(memDir, 'USER.md'), 'Cwah Li. Short replies.');
fs.writeFileSync(path.join(memDir, 'MEMORY.md'), 'Live site is https://health-tracking.duckdns.org.');

const row = lib.appendRow('decisions', { ticket: 'BUG-1', text: 'Retry once on depleted model, then stop.' }, { home });
check('appendRow returns stored row', row.ticket === 'BUG-1' && row.text.length > 0);
for (const store of lib.STORES) {
  lib.appendRow(store, { ticket: 'SEED', text: 'seed row' }, { home });
}

const gated = lib.retrieve('BUG-1 depleted', { turn: 'chat', home });
check('non build/investigate/decide turn is gated', gated.gated === true && gated.rows.length === 0);

const hit = lib.retrieve('BUG-1 depleted model', { turn: 'investigate', home });
check('investigate turn retrieves the row', hit.gated === false && hit.rows.length === 1 && hit.rows[0].store === 'decisions');

const miss = lib.retrieve('unrelated zebra quantum', { turn: 'build', home });
check('no-overlap query returns zero rows', miss.rows.length === 0);

let threw = false;
try {
  lib.appendRow('nope', { text: 'x' }, { home });
} catch { threw = true; }
check('unknown store throws', threw);

threw = false;
try {
  lib.appendRow('facts', { text: 'x'.repeat(501) }, { home });
} catch { threw = true; }
check('over-cap row text throws', threw);

const counts = lib.noteFalseFire('decisions', { home });
check('false-fire counted', counts.total === 1 && counts.byStore.decisions === 1);

const healthy = lib.healthCheck({ home });
check('healthy home passes check', healthy.ok === true && healthy.receipts.length === 0);

fs.rmSync(path.join(memDir, 'USER.md'));
const missing = lib.healthCheck({ home });
check(
  'missing USER.md produces a receipt',
  missing.ok === false && missing.receipts.some((r) => r.kind === 'missing'),
);

console.log(`\n[BOT-13 Gate Result] ${checksPassed} checks passed, ${failures.length} failures.`);

if (failures.length > 0) {
  console.error('\nFailures:');
  failures.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
} else {
  console.log('✅ BOT-13 Gate PASSED cleanly.\n');
  process.exit(0);
}
