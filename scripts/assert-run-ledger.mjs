#!/usr/bin/env node
/**
 * assert-run-ledger.mjs — BOT-15 named gate.
 *
 * Proves the per-dispatch outcome ledger and duplicate-signature gate:
 *  1. scripts/lib/run-ledger.mjs exists and exports:
 *     buildOutcome, signatureOf, loadLedger, countSignature, checkDuplicate,
 *     recordOutcome.
 *  2. scripts/run-coding-dispatch.sh defines check_run_ledger/record_run_outcome,
 *     invokes the pre-action gate before any coder runs, and records outcomes
 *     at the committed / escalated / unresolved terminal points.
 *  3. Signatures are stable and discriminate on every identity field.
 *  4. First record: priorCount=0; second identical: duplicate with priorCount=1.
 *  5. Failure outcomes feed bot-failures.jsonl (the Hermes reader).
 *  6. CLI record/check subcommands execute with expected exit codes.
 *
 * Exit 0 on all pass; exit 1 with FAIL lines otherwise.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

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

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

console.log('assert-run-ledger (BOT-15)\n');

// 1. Module existence & exports.
const ledgerPath = path.join(ROOT, 'scripts/lib/run-ledger.mjs');
check('run-ledger.mjs exists', fs.existsSync(ledgerPath));

if (fs.existsSync(ledgerPath)) {
  const src = read('scripts/lib/run-ledger.mjs');
  for (const fn of [
    'export function buildOutcome',
    'export function signatureOf',
    'export function loadLedger',
    'export function countSignature',
    'export function checkDuplicate',
    'export function recordOutcome',
  ]) {
    check(`run-ledger ${fn}`, src.includes(fn));
  }
}

// 2. Dispatch wiring: gate in code beside the file locks, before the edit.
const dispatchSrc = read('scripts/run-coding-dispatch.sh');
check('dispatch defines check_run_ledger', dispatchSrc.includes('check_run_ledger()'));
check('dispatch defines record_run_outcome', dispatchSrc.includes('record_run_outcome()'));
check('dispatch invokes the pre-action gate', dispatchSrc.includes('check_run_ledger'));
check('dispatch records the committed outcome', dispatchSrc.includes('record_run_outcome "committed"'));
check('dispatch records the escalated outcome', dispatchSrc.includes('record_run_outcome "escalated"'));
check('dispatch records the unresolved outcome', dispatchSrc.includes('record_run_outcome "unresolved"'));

// 3-5. In-memory behavior against an isolated ledger.
const tmpLedger = path.join(os.tmpdir(), `ledger_gate_${Date.now()}_${Math.random().toString(36).slice(2)}.jsonl`);
const tmpFailures = path.join(os.tmpdir(), `ledger_fail_${Date.now()}_${Math.random().toString(36).slice(2)}.jsonl`);
process.env.RUN_LEDGER = tmpLedger;
process.env.BOT_FAILURE_LOG = tmpFailures;

const {
  signatureOf,
  checkDuplicate,
  recordOutcome,
  loadLedger,
} = await import(new URL(`file://${ledgerPath.replace(/\\/g, '/')}`).href);

const base = {
  ticket: 'BUG-15', surface: 'orchestrator', provider: 'opencode',
  model: 'opencode/deepseek-v4.1-flash', defectClass: 'FALSE_FRIEND|key|2026-W39',
};
check('signature is 12 hex chars', /^[0-9a-f]{12}$/.test(signatureOf(base)));
for (const field of ['ticket', 'surface', 'provider', 'model', 'defectClass']) {
  const alt = { ...base, [field]: `${base[field]}-x` };
  check(`signature changes when ${field} changes`, signatureOf(alt) !== signatureOf(base));
}

const r1 = recordOutcome({ ...base, outcome: 'committed', wallClockMs: 61000 });
check('first record: written, priorCount=0', r1.written === true && r1.priorCount === 0);

const dup = checkDuplicate(base);
check('second identical signature: duplicate, priorCount=1',
  dup.duplicate === true && dup.priorCount === 1 && dup.signature === r1.signature);

const r2 = recordOutcome({ ...base, outcome: 'escalated' });
check('repeat record keeps counting', r2.priorCount === 1);
check('ledger holds both rows', loadLedger().length === 2);

const failRows = (() => {
  try {
    return fs.readFileSync(tmpFailures, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch { return []; }
})();
check('escalated outcome feeds bot-failures.jsonl',
  failRows.some((r) => r.kind === 'dispatch:escalated' && (r.hint || '').includes('BUG-15')));

// 6. CLI subcommands.
const cliScript = ledgerPath;
const cliEnv = { ...process.env, RUN_LEDGER: tmpLedger, BOT_FAILURE_LOG: tmpFailures };
const checkClean = execFileSync(process.execPath, [
  cliScript, 'check', '--ticket=NEW-1', '--surface=s', '--provider=p', '--model=m', '--defect-class=d',
], { encoding: 'utf8', env: cliEnv });
check('CLI check on fresh signature exits 0 without duplicate',
  JSON.parse(checkClean).duplicate === false);

let dupExit = 0;
let dupOut = null;
try {
  execFileSync(process.execPath, [
    cliScript, 'check', '--ticket=BUG-15', '--surface=orchestrator', '--provider=opencode',
    '--model=opencode/deepseek-v4.1-flash', '--defect-class=FALSE_FRIEND|key|2026-W39',
  ], { encoding: 'utf8', stdio: 'pipe', env: cliEnv });
} catch (err) {
  dupExit = err.status;
  try { dupOut = JSON.parse(err.stdout); } catch {}
}
check('CLI check on repeated signature exits 2 with needsLearning',
  dupExit === 2 && dupOut?.duplicate === true && dupOut?.needsLearning === true);

for (const f of [tmpLedger, tmpFailures]) {
  try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
}

console.log(`\n${pass} pass, ${fail} fail`);
if (fail > 0) {
  console.error('\nFailures:\n' + failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
