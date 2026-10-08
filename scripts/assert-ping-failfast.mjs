#!/usr/bin/env node
/**
 * assert-ping-failfast.mjs — connectivity pings check one lane, never walk.
 *
 * `hi` becomes a PONG ping that must exercise the real turn path, but a dead
 * primary on a ping must surface one honest error, not N switch lines across
 * lanes the user never chose. Real prompts keep the full ledger walk.
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

console.log('assert-ping-failfast (ping checks one lane)\n');

const host = await import(
  new URL(`file://${path.join(ROOT, 'scripts/bot-host.mjs').replace(/\\/g, '/')}`).href
);
check('bot-host exports pingOnlyModels', typeof host.pingOnlyModels === 'function');

check('ping returns the chat model only',
  JSON.stringify(host.pingOnlyModels({ isPingTurn: true, model: 'm-primary', fallback: 'm-default' })) === JSON.stringify(['m-primary']));
check('ping falls back to bot default when chat has none',
  JSON.stringify(host.pingOnlyModels({ isPingTurn: true, model: '', fallback: 'm-default' })) === JSON.stringify(['m-default']));
check('ping with no model anywhere returns null (caller decides)',
  host.pingOnlyModels({ isPingTurn: true, model: '', fallback: '' }) === null);
check('real prompt returns null (ledger walk untouched)',
  host.pingOnlyModels({ isPingTurn: false, model: 'm-primary', fallback: 'm-default' }) === null);
check('missing flag returns null', host.pingOnlyModels({ model: 'm-primary' }) === null);

// The turn path prefers the ping chain when present.
import fs from 'node:fs';
const src = fs.readFileSync(path.join(ROOT, 'scripts/bot-host.mjs'), 'utf8');
check('turn path prefers pingModels over the ledger walk',
  src.includes('pingModels || (laneChoice.models.length'));
check('displaced stays-on notice suppressed on ping turns',
  src.includes('if (laneChoice.displaced && !isPingTurn)'));

console.log(`\n${pass} pass, ${fail} fail`);
if (fail > 0) {
  console.error('\nFailures:\n' + failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
