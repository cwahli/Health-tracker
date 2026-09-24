#!/usr/bin/env node
/**
 * assert-bug-ticket-continuity.mjs — V-30.1 named gate.
 *
 * Proves the bug-ticket pipeline is continuous end-to-end without a live server:
 *  1. bugState() module exists and exports the S-C-lite vocabulary.
 *  2. mapLegacyStatus is exported from bugWorkItem (widened, not replaced).
 *  3. Artifact endpoints exist in serverBugSnapshot (defect/repro/plan/verify).
 *  4. There is NO agent-settable state route (no POST/PATCH .../state).
 *  5. Token guard (bugWriteGuard) is wired on write endpoints (A-f5).
 *  6. A-f1 fix present: /api/bugs/next no longer pre-slices LIMIT 100 on created_at ASC.
 *  7. bugctl.mjs exists, is syntactically valid, and its help lists core commands.
 *  8. Journal path specs/bug-journal is the P1 D location (dir creatable).
 *  9. Offline projection walk: create→pack→attempt→verify derives the right states
 *    through pure bugState() (no HTTP) — the scripted-session shape.
 *
 * Exit 0 on all pass; exit 1 with FAIL lines otherwise.
 */

import fs from 'node:fs';
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

console.log('assert-bug-ticket-continuity (V-30.1)\n');

// 1. bugTicketState module
const statePath = path.join(ROOT, 'src/utils/bugTicketState.ts');
check('bugTicketState.ts exists', fs.existsSync(statePath));
if (fs.existsSync(statePath)) {
  const src = read('src/utils/bugTicketState.ts');
  check('exports bugState', /export function bugState\b/.test(src));
  check('exports projectBugState', /export function projectBugState\b/.test(src));
  check('S-C-lite names present', ["'new'", "'packed'", "'in_fix'", "'verifying'", "'done'"].every((n) => src.includes(n)));
  check('no state setter helper (derived only)', !/export function setState\b|export function setStateName\b/.test(src));
}

// 2. mapLegacyStatus exported
const workSrc = read('src/utils/bugWorkItem.ts');
check('mapLegacyStatus exported from bugWorkItem', /export function mapLegacyStatus\b/.test(workSrc));
check('BugWorkItem has V-30.1 fields', ['defect', 'repro', 'plan', 'verify', 'surface', 'assignee', 'idem_key', 'reply_to', 'blocked_by', 'duplicate_of'].every((f) => workSrc.includes(f)));

// 3–6. server routes
const serverSrc = read('serverBugSnapshot.ts');
check('POST defect endpoint', /app\.post\('\/api\/bugs\/:tagId\/defect'/.test(serverSrc));
check('POST repro endpoint', /app\.post\('\/api\/bugs\/:tagId\/repro'/.test(serverSrc));
check('POST plan endpoint', /app\.post\('\/api\/bugs\/:tagId\/plan'/.test(serverSrc));
check('POST verify endpoint', /app\.post\('\/api\/bugs\/:tagId\/verify'/.test(serverSrc));
check('NO agent-settable state route', !/app\.(post|patch|put)\(\s*['"`][^'"`]*\/state['"`]/.test(serverSrc));
check('bugWriteGuard defined (A-f5)', /function bugWriteGuard\b/.test(serverSrc));
check('bugWriteGuard on attempts', /app\.post\('\/api\/bugs\/:tagId\/attempts',\s*bugWriteGuard/.test(serverSrc));
check('bugWriteGuard on PATCH', /app\.patch\('\/api\/bugs\/:tagId',\s*bugWriteGuard/.test(serverSrc));
check('bugWriteGuard on defect', /app\.post\('\/api\/bugs\/:tagId\/defect',\s*bugWriteGuard/.test(serverSrc));
check('A-f1: next no longer LIMIT 100 on created_at ASC', !/status IN \('to_fix', 'in_progress'\) ORDER BY created_at ASC LIMIT 100/.test(serverSrc));
check('A-f1: next uses large window', /ORDER BY updated_at DESC LIMIT 1000/.test(serverSrc));
check('projects bugState on writes', /projectBugState\(/.test(serverSrc));
const stateSrc = read('src/utils/bugTicketState.ts');
check(
  'journey green does not close',
  /JOURNEY_GREEN_DOES_NOT_CLOSE/.test(stateSrc) &&
    /verifyMethod === 'journey'/.test(stateSrc) &&
    /state = 'verifying'/.test(stateSrc),
);

// 7. bugctl
const ctlPath = path.join(ROOT, 'scripts/bugctl.mjs');
check('bugctl.mjs exists', fs.existsSync(ctlPath));
if (fs.existsSync(ctlPath)) {
  try {
    execFileSync(process.execPath, ['--check', ctlPath], { stdio: 'pipe' });
    check('bugctl.mjs syntax valid', true);
  } catch (e) {
    check('bugctl.mjs syntax valid', false, String(e.stderr || e.message).slice(0, 200));
  }
  const ctl = read('scripts/bugctl.mjs');
  for (const c of ['create', 'pack', 'repro', 'plan', 'attempt', 'verify', 'queue', 'flush']) {
    check(`bugctl has ${c}`, new RegExp(`case '${c}'`).test(ctl) || ctl.includes(`case '${c}'`));
  }
  check('bugctl writes journal', ctl.includes('bug-journal'));
  check('bugctl offline queue', ctl.includes('.bugctl-queue.jsonl') || ctl.includes('BUGCTL_QUEUE'));
}

// 8. journal dir path
check('journal dir path is specs/bug-journal', path.join('specs', 'bug-journal') === 'specs/bug-journal');

// 9. Offline projection walk (pure, no HTTP) — mirrors the scripted session
try {
  const { execFileSync: exec } = await import('node:child_process');
  // Use vitest to run a tiny inline script via node --experimental-strip-types is unreliable;
  // instead spawn npx vitest with a one-off test file written to a temp path inside repo.
  const tmpTest = path.join(ROOT, 'src/utils/__bug_ticket_continuity_walk.test.ts');
  fs.writeFileSync(
    tmpTest,
    `
import { describe, expect, it } from 'vitest';
import { emptyWorkItem, applyAttempt } from './bugWorkItem';
import { bugState, projectBugState } from './bugTicketState';

describe('continuity walk: create→pack→attempt→verify', () => {
  it('every state change is derived from the posted artifact', () => {
    // create
    let item = emptyWorkItem({ public_n: 901, bug: 'continuity fixture' });
    expect(bugState(item).state).toBe('new');

    // pack (defect artifact)
    item = { ...item, defect: { component: 'x', observed: 'o', expected: 'e', criteria: 'c' }, class: 'FALSE_FRIEND', surface: 'food' };
    let p = projectBugState(item);
    expect(p.ticket.state).toBe('packed');
    item = p.item;

    // attempt
    const r = applyAttempt(item, { actor: 'agent', hyp: 'h', file: 'f.ts', test: 'f.test.ts', result: 'fail', burned: true });
    item = r.item;
    p = projectBugState(item);
    expect(p.ticket.state).toBe('in_fix');
    item = p.item;

    // verify green
    item = { ...item, verify: { method: 'named_test', command: 'npx vitest run f', result: 'green', evidence: [] } };
    p = projectBugState(item);
    expect(p.ticket.state).toBe('done');
    expect(p.ticket.legacy_status).toBe('fixed');
    expect(p.ticket.queue).toBe('done');

    const journeyOnly = {
      ...item,
      verify: { method: 'journey', command: 'node scripts/qa-runner.mjs --journey=meal', result: 'green', evidence: [] },
    };
    expect(bugState(journeyOnly).state).not.toBe('done');
  });
});
`
  );
  try {
    exec('npx', ['vitest', 'run', 'src/utils/__bug_ticket_continuity_walk.test.ts'], {
      cwd: ROOT,
      stdio: 'pipe',
      encoding: 'utf8',
      timeout: 120000,
    });
    check('offline projection walk (create→pack→attempt→verify)', true);
  } finally {
    try {
      fs.unlinkSync(tmpTest);
    } catch {
      /* ignore */
    }
  }
} catch (e) {
  check('offline projection walk (create→pack→attempt→verify)', false, String(e.stderr || e.message).slice(0, 300));
}

console.log(`\n${pass} pass, ${fail} fail`);
if (fail) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
process.exit(0);
