#!/usr/bin/env node
/**
 * assert-coordination-tax.mjs — BOT-21 named gate.
 *
 * Proves the coordination-tax logger & repro consensus rules:
 *  1. scripts/lib/coordination-tax.mjs exists and exports:
 *     argsHash, canonicalString, normalizeTicket, recordCoordination,
 *     readCoordinationLog, evaluateReproVerdicts.
 *  2. src/utils/bugTicketState.ts exports evaluateReproVerdicts and wires it into bugState.
 *  3. serverBugSnapshot.ts wires evaluateReproVerdicts into POST /api/bugs/:tagId/repro.
 *  4. scripts/run-coding-dispatch.sh defines and invokes record_coordination_tax.
 *  5. argsHash is deterministic across key ordering and whitespace.
 *  6. normalizeTicket handles #, BUG-, and raw numbers.
 *  7. recordCoordination tracks (ticket, agent, tool, args-hash) and alerts on duplicate.
 *  8. CLI subcommands (hash, record, check, repro-verdicts) execute with expected exit codes.
 *  9. evaluateReproVerdicts matches matching verdicts and escalates conflicts.
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

console.log('assert-coordination-tax (BOT-21)\n');

// 1. coordination-tax module existence & exports
const taxPath = path.join(ROOT, 'scripts/lib/coordination-tax.mjs');
check('coordination-tax.mjs exists', fs.existsSync(taxPath));

if (fs.existsSync(taxPath)) {
  const taxSrc = read('scripts/lib/coordination-tax.mjs');
  const requiredFns = [
    'export function argsHash',
    'export function canonicalString',
    'export function normalizeTicket',
    'export function recordCoordination',
    'export function readCoordinationLog',
    'export function evaluateReproVerdicts',
  ];
  for (const fn of requiredFns) {
    check(`coordination-tax ${fn}`, taxSrc.includes(fn));
  }
}

// 2. bugTicketState integration
const stateSrc = read('src/utils/bugTicketState.ts');
check('bugTicketState exports evaluateReproVerdicts', /export function evaluateReproVerdicts\b/.test(stateSrc));
check('bugTicketState checks repro_verdicts consensus', stateSrc.includes('evaluateReproVerdicts(item.repro_verdicts)'));
check('bugTicketState flags repro_verdict_conflict', stateSrc.includes('repro_verdict_conflict'));

// 3. serverBugSnapshot integration
const serverSrc = read('serverBugSnapshot.ts');
check('serverBugSnapshot imports evaluateReproVerdicts', /import\s*\{[^}]*evaluateReproVerdicts[^}]*\}\s*from\s*'\.\/src\/utils\/bugTicketState'/.test(serverSrc));
check('serverBugSnapshot accumulates repro_verdicts', serverSrc.includes('item.repro_verdicts = verdicts'));
check('serverBugSnapshot escalates repro conflicts to orchestrator', serverSrc.includes('repro_verdict_conflict') && serverSrc.includes('item.assignee ='));

// 4. run-coding-dispatch integration
const dispatchSrc = read('scripts/run-coding-dispatch.sh');
check('run-coding-dispatch defines record_coordination_tax', dispatchSrc.includes('record_coordination_tax()'));
check('run-coding-dispatch alerts on REPEAT_ARGS_HASH', dispatchSrc.includes('REPEAT_ARGS_HASH'));
check('run-coding-dispatch calls record_coordination_tax', dispatchSrc.includes('record_coordination_tax "opencode"'));

// 5-9. In-memory & CLI module checks
const {
  argsHash,
  canonicalString,
  normalizeTicket,
  recordCoordination,
  readCoordinationLog,
  evaluateReproVerdicts,
} = await import(new URL(`file://${path.join(ROOT, 'scripts/lib/coordination-tax.mjs').replace(/\\/g, '/')}`).href);

// 5. Deterministic hashing
const h1 = argsHash({ b: 2, a: 1 });
const h2 = argsHash({ a: 1, b: 2 });
check('argsHash deterministic on key ordering', h1 === h2 && h1.length === 16);

const json1 = argsHash('{"task":"fix","tool":"opencode"}');
const json2 = argsHash({ task: 'fix', tool: 'opencode' });
check('argsHash canonicalizes JSON strings', json1 === json2);

// 6. Ticket normalization
check('normalizeTicket handles #, BUG-, and raw numbers',
  normalizeTicket('42') === '42' &&
  normalizeTicket('#42') === '42' &&
  normalizeTicket('BUG-42') === '42' &&
  normalizeTicket('#BUG-42') === '42'
);

// 7. Coordination tax logging & repeat alerts
const tmpLog = path.join(os.tmpdir(), `tax_gate_test_${Date.now()}_${Math.random().toString(36).slice(2)}.jsonl`);
try {
  const payloadA = { task: 'refactor', model: 'flash' };
  const r1 = recordCoordination({
    ticket: 'BUG-777',
    agent: 'orchestrator',
    tool: 'opencode',
    args: payloadA,
    logPath: tmpLog,
  });
  check('first call: count=1, alert=false', r1.count === 1 && r1.alert === false);

  const r2 = recordCoordination({
    ticket: '777',
    agent: 'orchestrator',
    tool: 'opencode',
    args: payloadA,
    logPath: tmpLog,
  });
  check('second call on same ticket with same args: count=2, alert=true, REPEAT_ARGS_HASH',
    r2.count === 2 && r2.alert === true && r2.alertReason === 'REPEAT_ARGS_HASH'
  );

  const r3 = recordCoordination({
    ticket: '888',
    agent: 'orchestrator',
    tool: 'opencode',
    args: payloadA,
    logPath: tmpLog,
  });
  check('same args on different ticket: count=1, alert=false', r3.count === 1 && r3.alert === false);
} finally {
  if (fs.existsSync(tmpLog)) fs.unlinkSync(tmpLog);
}

// 8. CLI tests
const cliScript = path.join(ROOT, 'scripts/lib/coordination-tax.mjs');

// 8a. hash subcommand
const hashOut = execFileSync(process.execPath, [cliScript, 'hash', '--args={"foo":"bar"}'], { encoding: 'utf8' }).trim();
check('CLI hash subcommand returns 16-hex hash', hashOut.length === 16);

// 8b. record subcommand exit code: exit 0 on clean, exit 2 on alert
const tmpCliLog = path.join(os.tmpdir(), `tax_cli_test_${Date.now()}_${Math.random().toString(36).slice(2)}.jsonl`);
try {
  execFileSync(process.execPath, [
    cliScript,
    'record',
    '--ticket=99',
    '--agent=test',
    '--tool=opencode',
    '--args=test_arg',
    `--logPath=${tmpCliLog}`,
  ]);
  check('CLI record call 1 exits 0', true);

  let exitCode = 0;
  try {
    execFileSync(process.execPath, [
      cliScript,
      'record',
      '--ticket=99',
      '--agent=test',
      '--tool=opencode',
      '--args=test_arg',
      `--logPath=${tmpCliLog}`,
    ], { stdio: 'pipe' });
  } catch (err) {
    exitCode = err.status;
  }
  check('CLI record call 2 with duplicate args exits 2 (alert)', exitCode === 2);
} finally {
  if (fs.existsSync(tmpCliLog)) fs.unlinkSync(tmpCliLog);
}

// 8c. repro-verdicts CLI subcommand: exit 0 on match, exit 1 on conflict
const matchCliOut = execFileSync(process.execPath, [
  cliScript,
  'repro-verdicts',
  '--verdicts=[{"status":"confirmed"},{"status":"confirmed"}]',
], { encoding: 'utf8' });
const matchParsed = JSON.parse(matchCliOut);
check('CLI repro-verdicts matching exits 0', matchParsed.match === true && matchParsed.escalated === false);

let conflictExit = 0;
let conflictParsed = null;
try {
  execFileSync(process.execPath, [
    cliScript,
    'repro-verdicts',
    '--verdicts=[{"status":"confirmed"},{"status":"failed"}]',
  ], { encoding: 'utf8', stdio: 'pipe' });
} catch (err) {
  conflictExit = err.status;
  try { conflictParsed = JSON.parse(err.stdout); } catch {}
}
check('CLI repro-verdicts conflict exits 1 and returns blocked_reason=repro_verdict_conflict',
  conflictExit === 1 && conflictParsed?.blocked_reason === 'repro_verdict_conflict'
);

// 9. Pure repro consensus evaluation
const evalMatch = evaluateReproVerdicts([
  { status: 'confirmed' },
  { status: 'confirmed' },
]);
check('evaluateReproVerdicts: confirmed/confirmed matches without escalation',
  evalMatch.match === true && evalMatch.escalated === false && evalMatch.consensus === 'confirmed'
);

const evalConflict = evaluateReproVerdicts([
  { status: 'confirmed', by: 'qa1' },
  { status: 'failed', by: 'qa2' },
]);
check('evaluateReproVerdicts: confirmed/failed conflicts and escalates to orchestrator',
  evalConflict.match === false &&
  evalConflict.escalated === true &&
  evalConflict.blocked_reason === 'repro_verdict_conflict' &&
  evalConflict.escalation_assignee === 'orchestrator'
);

console.log(`\n${pass} pass, ${fail} fail`);
if (fail > 0) {
  console.error('\nFailures:\n' + failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
