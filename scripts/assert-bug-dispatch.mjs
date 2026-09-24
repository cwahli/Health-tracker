#!/usr/bin/env node
/**
 * assert-bug-dispatch.mjs — V-30.4 named gate (orchestrator lane).
 *
 * Proves the packet-driven dispatch contract without a live server:
 *  1. scripts/lib/bug-dispatch.mjs: idempotency guard (in_fix / verifying /
 *     done / blocked / not_reproducible / duplicate refused; packed allowed;
 *     same-run lock exception), category mapping, locked-spec lookup, and
 *     planFromPacket (spec files+gates; no-spec refuses with the specify-role
 *     pointer; default named gate fallback).
 *  2. run-coding-dispatch.sh wiring: legacy --task= retained; --ticket=#n
 *     reads `bugctl packet` (the packet is the prompt source); guard runs
 *     BEFORE detach; the plan artifact is posted BEFORE detach; attempt rows
 *     at start (post-lock) and end (committed / failed); failure ends in
 *     `bugctl block --reason` (three paths: cascade, single-tool, abort trap);
 *     bookkeeping rows are --burned=false; the dispatcher NEVER posts
 *     verify/close (author ≠ verifier); git pushes the run branch, never
 *     main; the prompt carries the ticket packet + verification contract.
 *  3. bugctl: a packet READ never enters the offline queue (withFallback is
 *     writes-only — QUEUE writes still queue: plan/attempt/block/...).
 *  4. The scratch fixture test src/utils/bugDispatchFlow.test.ts runs green:
 *     packed → in_fix → verifying → done, failed dispatch keeps
 *     blocked_reason, double-dispatch refused.
 *  5. Offline exec: legacy --print-plan still works; ticket mode fails fast
 *     with exit 2 when the packet read is impossible (no queued read junk).
 *
 * Exit 0 on all pass; exit 1 with FAIL lines otherwise.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { dispatchGuard, categoryFor, planFromPacket, specPathFor, DEFAULT_GATE } from './lib/bug-dispatch.mjs';

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

function sh(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', cwd: ROOT, timeout: 120000, ...opts });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

function dispatchCli(args, env = {}) {
  return sh('node', [path.join(ROOT, 'scripts', 'lib', 'bug-dispatch.mjs'), ...args], {
    env: { ...process.env, ...env },
  });
}

console.log('assert-bug-dispatch (V-30.4)\n');

// ---------------------------------------------------------------------------
// 1. bug-dispatch.mjs — guard / category / spec / plan (pure + CLI)
// ---------------------------------------------------------------------------
console.log('1. bug-dispatch helpers');

const packedPacket = { state: 'packed', flags: {}, defect: { component: 'C', observed: 'o', expected: 'e', criteria: 'c' } };
check('guard allows a packed card with a defect', dispatchGuard(packedPacket).ok === true);
check('guard refuses in_fix (double dispatch)', (() => {
  const r = dispatchGuard({ ...packedPacket, state: 'in_fix' });
  return !r.ok && /in_fix/.test(r.reason);
})());
check('guard refuses verifying / done / new', ['verifying', 'done', 'new'].every((s) => !dispatchGuard({ ...packedPacket, state: s }).ok));
check('guard refuses blocked_reason / not_reproducible / duplicate_of', [
  { blocked_reason: 'burn_budget' },
  { not_reproducible: true },
  { duplicate_of: 'tag_z' },
].every((flags) => !dispatchGuard({ ...packedPacket, flags }).ok));
check('guard refuses a card without a defect pack', !dispatchGuard({ state: 'packed', flags: {} }).ok);
check('same-run exception: matching lock pid allows even non-packed', dispatchGuard({ ...packedPacket, state: 'in_fix' }, { lockPid: 7, selfPid: '7' }).ok === true);
check('different-run pid does not override the guard', !dispatchGuard({ ...packedPacket, state: 'in_fix' }, { lockPid: 7, selfPid: 8 }).ok);
check('categoryFor: home→meal, biomarker→biomarker, onboarding→onboarding, ""→general',
  categoryFor('home') === 'meal' && categoryFor('biomarker') === 'biomarker' && categoryFor('onboarding') === 'onboarding' && categoryFor('') === 'general');

const tmp = path.join(ROOT, 'node_modules', '.assert-bug-dispatch-packet.json');
fs.writeFileSync(tmp, JSON.stringify(packedPacket));
const gOk = dispatchCli(['guard', `--packet-file=${tmp}`]);
check('CLI guard packed → exit 0 / "ok"', gOk.status === 0 && gOk.stdout.trim() === 'ok', gOk.stdout.trim());
fs.writeFileSync(tmp, JSON.stringify({ ...packedPacket, state: 'in_fix' }));
const gNo = dispatchCli(['guard', `--packet-file=${tmp}`]);
check('CLI guard in_fix → exit 1 / refused', gNo.status === 1 && /^refused:/.test(gNo.stdout.trim()) && /in_fix/.test(gNo.stdout));
fs.writeFileSync(tmp, JSON.stringify(packedPacket));
const specPath = specPathFor(path.join(ROOT, 'specs', 'active'), 13, 'F-13');
const planSpec = dispatchCli(['plan-args', `--packet-file=${tmp}`, `--spec=${specPath}`]);
let planSpecJson = {};
try { planSpecJson = JSON.parse(planSpec.stdout); } catch { /* fail below */ }
check('CLI plan-args with a locked spec → ok + spec files', planSpecJson.ok === true && Array.isArray(planSpecJson.files) && planSpecJson.files.length > 0, planSpecJson.reason || '');
const planNoSpec = dispatchCli(['plan-args', `--packet-file=${tmp}`]);
let planNoJson = {};
try { planNoJson = JSON.parse(planNoSpec.stdout); } catch { /* fail below */ }
check('CLI plan-args without spec → refuses with specify-role pointer', planNoJson.ok === false && /specs\/active/.test(planNoJson.reason || ''));
check('default named gate fallback is the bug domain gate', planNoJson.gates && planNoJson.gates.length === 1 && planNoJson.gates[0] === DEFAULT_GATE);
check('CLI spec-path finds F-13.md, misses card 999999', /F-13\.md$/.test(dispatchCli(['spec-path', '--dir=specs/active', '--n=13', '--tag=F-13']).stdout.trim()) && dispatchCli(['spec-path', '--dir=specs/active', '--n=999999', '--tag=tag_nope']).stdout.trim() === '');
check('CLI category --surface=home → meal', dispatchCli(['category', '--surface=home']).stdout.trim() === 'meal');
fs.rmSync(tmp, { force: true });

// ---------------------------------------------------------------------------
// 2. run-coding-dispatch.sh wiring
// ---------------------------------------------------------------------------
console.log('\n2. run-coding-dispatch.sh ticket wiring');
const disp = read('scripts/run-coding-dispatch.sh');

check('legacy --task= path retained', /--task=\*\)/.test(disp));
check('--ticket= argument parsed', /--ticket=\*\)\s+TICKET="\$\{arg#\*=\}"/.test(disp));
check('ticket mode reads `bugctl packet` (packet is the prompt source, audit note B)', /node "\$BUGCTL" packet --id "\$TICKET" --json/.test(disp));
check('idempotency guard runs on the packet', /node "\$DISPATCH_HELPER" guard --packet-file="\$PACKET_FILE" --self-pid="\$\$"/.test(disp));
check('a refused dispatch exits 3 and notifies', /Dispatch refused for ticket #\$TICKET/.test(disp) && /exit 3/.test(disp));

const idxGuard = disp.indexOf('guard --packet-file=');
const idxPlanPost = disp.indexOf('node "$BUGCTL" plan --id "$TICKET"');
const idxDetach = disp.indexOf('Detaching ${BUG_ID}');
check('guard runs before detach (parent refuses, never spawns a child)', idxGuard > 0 && idxDetach > 0 && idxGuard < idxDetach, `guard@${idxGuard} < detach@${idxDetach}`);
check('plan artifact posted before detach (before dispatch)', idxPlanPost > 0 && idxPlanPost < idxDetach, `plan@${idxPlanPost} < detach@${idxDetach}`);

const idxLock = disp.indexOf('WE_OWN_LOCK=1');
const idxStart = disp.indexOf('ticket_attempt_row "start"');
check('attempt START row posted after the per-bug lock', idxStart > 0 && idxLock > 0 && idxStart > idxLock, `lock@${idxLock} < start@${idxStart}`);
check('attempt END rows: committed + failed', /ticket_attempt_row "committed"/.test(disp) && /ticket_attempt_row "failed: /.test(disp));
check('end-success row is applied=true → verifying', /applied_flag="--applied"/.test(disp) && /awaiting non-author verifier/.test(disp));
check('failure ends in bugctl block --reason (3 paths: cascade, single-tool, abort trap)',
  (disp.match(/ticket_fail_and_block "/g) || []).length >= 3 && /node "\$BUGCTL" block --id "\$TICKET" --reason/.test(disp));
check('abort/signal path closes the open attempt (cleanup trap)', /ticket_fail_and_block "dispatch aborted \(signal or early exit\)"/.test(disp));
check('bookkeeping rows are --burned=false (server would default them burned)', /--burned=false --json/.test(disp));
check('start row carries the dispatch tool/model note', /dispatch start tool=\$REQUESTED_TOOL model=\$PREFERRED_MODEL/.test(disp));

check('dispatcher NEVER posts verify/close (author ≠ verifier)', !/\$BUGCTL" (verify|close)/.test(disp) && !/bugctl\.mjs" (verify|close)/.test(disp));
check('prompt carries the ticket packet + verification contract + named gate',
  /\[TICKET PACKET/.test(disp) && /\[VERIFICATION CONTRACT — author ≠ verifier\]/.test(disp) && /method=named_test/.test(disp));
check('prompt embeds the locked spec when present', /\[LOCKED SPEC/.test(disp) && /SPEC_TEXT=\$\(cat "\$SPEC_PATH"\)/.test(disp));
check('repro lane verdict rides in the prompt', /\[REPRO \(\$\{REPRO_STATUS\}\)\]/.test(disp));

check('git pushes the run branch (never main directly)', /git -C "\$CODER_DIR" push -u origin "\$run_branch"/.test(disp) && !/push[^\n]*origin[^\n]*\bmain\b/.test(disp));
check('a worktree sitting on main is re-branched before push', /if \[ "\$run_branch" = "main" \] \|\| \[ -z "\$run_branch" \]; then/.test(disp));
check('per-bug lock still refuses a live duplicate PID', /already running \(PID \$dup_pid\)/.test(disp));
check('--print-plan exposes the ticket fields', /echo "ticket_state=\$\{TICKET_STATE\}"/.test(disp) && /echo "ticket=\$\{TICKET\}"/.test(disp));
check('help documents --ticket=#n', /--ticket=#n/.test(disp));

try {
  execFileSync('bash', ['-n', path.join(ROOT, 'scripts', 'run-coding-dispatch.sh')], { stdio: 'pipe' });
  check('bash -n run-coding-dispatch.sh', true);
} catch (e) {
  // macOS ships bash 3.2 which false-fails on this script (also on main);
  // the named gates run on Linux (bash 5) in CI/VPS. Only fail on bash >= 4.
  const ver = sh('bash', ['-c', 'echo ${BASH_VERSINFO[0]}']);
  const major = parseInt(ver.stdout.trim(), 10);
  if (major >= 4) {
    check('bash -n run-coding-dispatch.sh', false, String(e.stderr || e.message).slice(0, 200));
  } else {
    console.log(`  SKIP  bash -n (bash ${ver.stdout.trim()} is too old for this script; Linux/CI covers it)`);
  }
}

// ---------------------------------------------------------------------------
// 3. bugctl — reads never queue; writes still do
// ---------------------------------------------------------------------------
console.log('\n3. bugctl read/write queue contract');
const ctl = read('scripts/bugctl.mjs');
try {
  execFileSync(process.execPath, ['--check', path.join(ROOT, 'scripts', 'bugctl.mjs')], { stdio: 'pipe' });
  check('bugctl.mjs syntax valid', true);
} catch (e) {
  check('bugctl.mjs syntax valid', false, String(e.stderr || e.message).slice(0, 200));
}
const packetCase = /case 'packet': \{[\s\S]*?\n    \}/.exec(ctl)?.[0] || '';
check('packet case bypasses withFallback (a read never queues)', packetCase.length > 0 && !/await withFallback\(/.test(packetCase));
check('a non-OK packet response exits 1 (fail loud)', /payload\.error && !r\.ok\) process\.exit\(1\)/.test(ctl));
const writeOps = /const WRITE_OPS = new Set\(\[([\s\S]*?)\]\)/.exec(ctl)?.[1] || '';
check('WRITE_OPS keeps every write queueable (plan/attempt/block/verify/repro)',
  ['plan', 'attempt', 'block', 'verify', 'repro', 'create', 'pack'].every((op) => new RegExp(`'${op}'`).test(writeOps)));
check('WRITE_OPS excludes reads (queue/next/list)', !/'queue'/.test(writeOps) && !/'next'/.test(writeOps) && !/'list'/.test(writeOps));
check('withFallback only appends when isWrite', /if \(isWrite\) appendQueue\(op\)/.test(ctl) && (ctl.match(/if \(isWrite\) appendQueue\(op\)/g) || []).length === 2);

// ---------------------------------------------------------------------------
// 4. Scratch fixture test (committed, dev-only card — no production card)
// ---------------------------------------------------------------------------
console.log('\n4. scratch fixture: src/utils/bugDispatchFlow.test.ts');
const walk = sh('npx', ['vitest', 'run', 'src/utils/bugDispatchFlow.test.ts']);
check('bugDispatchFlow vitest green', walk.status === 0, walk.status === 0 ? (walk.stdout.match(/Tests\s+(\d+) passed/) || [, ''])[1] + ' tests' : walk.stdout.slice(-400) + walk.stderr.slice(-400));

// ---------------------------------------------------------------------------
// 5. Offline exec: legacy print-plan + ticket fail-fast
// ---------------------------------------------------------------------------
console.log('\n5. offline exec');
const legacy = sh('bash', [path.join(ROOT, 'scripts', 'run-coding-dispatch.sh'),
  '--task=Component: T. Observed: x. Expected: y. Verification: z', '--print-plan']);
check('legacy --task= --print-plan exit 0', legacy.status === 0, legacy.stdout.split('\n')[0]);
check('legacy print-plan prints pack output', /defect_component=/.test(legacy.stdout) && !/ticket=/.test(legacy.stdout));

const dead = sh('bash', [path.join(ROOT, 'scripts', 'run-coding-dispatch.sh'), '--ticket=#1'], {
  env: { ...process.env, BUG_API_BASE: 'http://127.0.0.1:9', BUG_API_TOKEN: '' },
});
check('ticket mode with unreachable API fails fast (exit 2, packet read)', dead.status === 2, `exit=${dead.status}`);
const queuePath = path.join(ROOT, '.bugctl-queue.jsonl');
check('the failed read left no offline queue junk', !fs.existsSync(queuePath) || !fs.readFileSync(queuePath, 'utf8').includes('"op":"packet"'));

// ---------------------------------------------------------------------------
console.log(`\nassert-bug-dispatch: ${pass} pass, ${fail} fail`);
if (fail) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
