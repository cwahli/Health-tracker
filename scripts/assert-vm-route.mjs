#!/usr/bin/env node
/**
 * assert-vm-route — the fleet's box must not be reported unreachable from memory.
 *
 * Measured 2026-10-07. The user asked why Muse could not be seen from Cline, and
 * the agent answered that it had "no route" to the VM the bots run on. The user
 * pushed back — correctly. `ssh ubuntu@51.254.217.163` answered on the first
 * try, with the default key, and had been working the whole time.
 *
 * The cost was not the wasted sentence. The real cause of the symptom (a stale
 * free-lane hold being re-stamped by a probe that could not run) exists ONLY on
 * the box — in its ledgers and its service journal. A diagnosis that begins "I
 * cannot reach it" never gets there, so it reports a live, fixable defect as
 * something unseeable, and the operator is told to re-tap instead of being told
 * what the bytes say.
 *
 * A memory note does not hold — that is the lesson assert-bugctl-is-reachable.mjs
 * already records ("a memory note is not a mechanism"). So the route is written
 * in docs/agent/WORKTREES.md, which AGENTS.md §0 points at for this box, and
 * this is the mechanism that keeps the record honest and (with --live) the route
 * itself.
 *
 * The default run is OFFLINE and deterministic, so it is safe in prepush and CI,
 * where there is no route and the honest answer is "cannot judge the network
 * here". It asserts the record is still wired. `--live` actually opens the door,
 * and is the only mode that may judge reachability.
 *
 * Run: node scripts/assert-vm-route.mjs          # the record is still wired
 *      node scripts/assert-vm-route.mjs --live   # the route answers, today
 */

import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const HOST = '51.254.217.163';
const USER = 'ubuntu';
const DOC = join(ROOT, 'docs', 'agent', 'WORKTREES.md');

/**
 * The one door. BatchMode is the point: a key or host prompt fails immediately
 * instead of waiting for a human who is not there, so the test costs a second
 * and can never hang a gate.
 */
export function sshArgs(command = 'uname -n') {
  return [
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=10',
    '-o', 'StrictHostKeyChecking=accept-new',
    `${USER}@${HOST}`,
    command,
  ];
}

const run = (cmd, args) => {
  try {
    return { code: 0, out: execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
};

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

console.log('assert-vm-route:');

// ---------------------------------------------------------------------------
// 1. The record is where the always-on path points.
// AGENTS.md §0 (every session) names docs/agent/WORKTREES.md for this box, so a
// reader that starts from AGENTS.md reaches the route without a load-map row.
// ---------------------------------------------------------------------------
{
  const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');
  check('AGENTS.md still points at the host/worktree doc for this box',
    /docs\/agent\/WORKTREES\.md/.test(agents));

  const doc = readFileSync(DOC, 'utf8');
  check('the doc names the host', doc.includes(HOST));
  check('the doc gives the login as user@host', doc.includes(`${USER}@${HOST}`));
  check('the doc gives the non-interactive flag', doc.includes('BatchMode=yes'));
  check('the doc says the helper lives on the box, not on the Mac',
    doc.includes('**on the box**, not on the Mac'));
  check('the doc forbids the unreachable claim',
    doc.includes('Never report the host as unreachable'));
  check('the doc points at this check', doc.includes('assert-vm-route.mjs'));
  check('the doc points at the host inventory',
    doc.includes('plan/VPS2_MOBILE_DEV.md'));
}

// ---------------------------------------------------------------------------
// 2. The live command is non-interactive BY CONSTRUCTION, not by documentation.
// ---------------------------------------------------------------------------
{
  const args = sshArgs();
  check('the ssh command is non-interactive (BatchMode)',
    args.some((a) => a === 'BatchMode=yes'));
  check('it cannot hang on a connect (ConnectTimeout set)',
    args.some((a) => /^ConnectTimeout=\d+$/.test(a)));
  check('it targets the documented user@host',
    args.includes(`${USER}@${HOST}`));
}

// ---------------------------------------------------------------------------
// 3. The record can actually be COMMITTED where it lives.
// docs/agent was silently ignored: .gitignore had a bare `agent` line (from the
// "Antigravity & mobile symlinks" block) and a bare pattern matches a directory
// of that name at ANY depth, so docs/agent/** — the always-on process dir — was
// refused by `git add`. Tracked files kept working, which is why it went
// unnoticed; a NEW record dropped there looked added and never committed.
// ---------------------------------------------------------------------------
{
  // `git check-ignore` does NOT reproduce this: the tracked files inside
  // docs/agent keep the path readable, so it reports "not ignored" even when
  // `git add` on a NEW file there is refused. The only honest test is to try the
  // thing that failed — create a file and dry-run adding it. EXECUTED, not
  // grepped, which is what makes this a sensor instead of decoration.
  const probe = join(ROOT, 'docs', 'agent', '.vm-route-probe.md');
  writeFileSync(probe, 'probe\n');
  const add = run('git', ['add', '-n', '--', 'docs/agent/.vm-route-probe.md']);
  rmSync(probe, { force: true });
  if (add.code === 128) {
    console.log('  (not a git checkout: the ignore check cannot be judged here)');
  } else {
    check('a NEW file under docs/agent can be added (the process dir is commit-able)',
      add.code === 0, add.out.trim().split('\n')[0] || `git add -n exit=${add.code}`);
  }
}

// ---------------------------------------------------------------------------
// 3. Only --live judges reachability, and it says so out loud either way.
// ---------------------------------------------------------------------------
if (process.argv.includes('--live')) {
  const cmd = 'uname -n; systemctl list-units "bot-host@*" --no-legend --state=running | wc -l';
  let out = '';
  let code = 0;
  try {
    out = execFileSync('ssh', sshArgs(cmd), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    code = err.status ?? 1;
    out = `${err.stdout || ''}${err.stderr || ''}`;
  }
  const [hostname = '', countRaw = ''] = out.trim().split('\n');
  const units = Number.parseInt(countRaw.trim(), 10);
  console.log(`  route: ssh ${USER}@${HOST}`);
  check('the route answers', code === 0, out.trim().slice(0, 200));
  check('it is the fleet box', hostname.trim().startsWith('vps-'), JSON.stringify(hostname));
  check('bots are running there (>= 1 bot-host unit)',
    Number.isFinite(units) && units >= 1, `units=${countRaw.trim()}`);
  if (code !== 0) {
    console.log('  the route failed. Do NOT report the host as unreachable from this alone —');
    console.log('  check first that this machine holds the key:  ssh-add -l ; ls ~/.ssh/');
  }
} else {
  console.log('  (offline: reachability is NOT judged here — pass --live to open the route)');
}

console.log('');
console.log(
  failed === 0
    ? `assert-vm-route: ${passed} pass, 0 fail`
    : `assert-vm-route: ${passed} pass, ${failed} FAIL`,
);
process.exit(failed === 0 ? 0 : 1);
