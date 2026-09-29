#!/usr/bin/env node
/**
 * The unlanded-fix ratchet, proven against real git repositories.
 *
 * A gate that has never been seen red is a gate nobody knows works. This builds
 * throwaway repos in a temp dir and asserts the outcomes that matter:
 *
 *   1. a fix that landed                 -> pass
 *   2. a fix sitting on a branch, fresh  -> pass (in flight is not failure)
 *   3. a fix sitting on a branch, old    -> FAIL, naming branch and subject
 *   4. the same fix reworked into base   -> pass (landed by another route)
 *   5. a waiver, and a waiver with no
 *      stranded commit behind it         -> pass, but the stale one is named
 *   6. a non-TUI file on an old branch   -> pass (out of scope)
 *   7. a watched file deleted from base  -> FAIL
 *
 * Run: node scripts/assert-tui-fixes-landed.test.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE_SOURCE = resolve(HERE, 'assert-tui-fixes-landed.mjs');

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

const TUI_FILE = 'scripts/tui-gateway.mjs';
const OTHER_FILE = 'scripts/other.mjs';
const TRAIL = 'TUI_TG_AUTH_TRAIL.md';
// Every watched file must exist in a fixture: the gate fails when one is
// missing from the base, which is a real condition, not a fixture artefact.
const WATCHED = [
  TUI_FILE,
  'scripts/mobile/tui-attach.sh',
  'scripts/assert-tui-gateway.test.mjs',
  'scripts/assert-tui-gateway-live.sh',
  'scripts/assert-tui-chat-select.test.sh',
  TRAIL,
];

const git = (cwd, ...argv) =>
  execFileSync('git', argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

// Commit with a chosen age. The gate judges age, so a fixture committed "now"
// is in flight and correctly passes — the stranded case needs a real old date.
function commit(dir, message, { hoursAgo = 0 } = {}) {
  const when = `${Math.floor(Date.now() / 1000) - hoursAgo * 3600} +0000`;
  return execFileSync('git', ['commit', '-q', '-m', message], {
    cwd: dir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: when,
      GIT_COMMITTER_DATE: when,
    },
  });
}

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'tui-ratchet-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'ratchet test');
  git(dir, 'config', 'user.email', 'ratchet@test');
  mkdirSync(join(dir, 'scripts/mobile'), { recursive: true });
  for (const f of WATCHED) writeFileSync(join(dir, f), `// ${f}\n`);
  writeFileSync(join(dir, OTHER_FILE), 'export const o = 1;\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  return dir;
}

function runGate(dir, extra = []) {
  try {
    const out = execFileSync('node', [GATE_SOURCE, '--exceptions=scripts/waivers.txt', ...extra], {
      cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

const cleanup = [];
console.log('assert-tui-fixes-landed:');

{
  // 1. A fix that landed: nothing to report.
  const dir = makeRepo();
  cleanup.push(dir);
  git(dir, 'checkout', '-q', '-b', 'feature');
  writeFileSync(join(dir, TUI_FILE), 'export const v = 2;\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'fix(tui): landed immediately');
  git(dir, 'checkout', '-q', 'main');
  git(dir, 'merge', '-q', '--ff-only', 'feature');
  git(dir, 'branch', '-q', '-D', 'feature');
  const r = runGate(dir);
  check('a fix that landed passes', r.code === 0, r.out.trim().split('\n').pop());
}

{
  // 2. Unlanded but young: in flight, so not a failure.
  const dir = makeRepo();
  cleanup.push(dir);
  git(dir, 'checkout', '-q', '-b', 'feature');
  writeFileSync(join(dir, TUI_FILE), 'export const v = 2;\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'fix(tui): in flight');
  git(dir, 'checkout', '-q', 'main');
  const r = runGate(dir, ['--max-age-hours=24']);
  check('a fresh unlanded fix passes (in flight)', r.code === 0, r.out.trim().split('\n').pop());
}

{
  // 3. Unlanded and old: exactly the 2026-09-28 failure, and it must name
  //    the branch and the subject so the finding is actionable.
  const dir = makeRepo();
  cleanup.push(dir);
  git(dir, 'checkout', '-q', '-b', 'fix/tui-telegram-auth');
  writeFileSync(join(dir, TUI_FILE), 'export const v = 2;\n');
  git(dir, 'add', '-A');
  commit(dir, 'fix(tui): the socket token route', { hoursAgo: 47 });
  git(dir, 'checkout', '-q', 'main');
  const r = runGate(dir);
  check('an old unlanded fix fails', r.code === 1);
  check('the failure names the branch', r.out.includes('fix/tui-telegram-auth'), r.out);
  check('the failure names the subject', r.out.includes('the socket token route'), r.out);
  check('the failure explains what to do', r.out.includes('unlanded fix reads as a done fix'), r.out);
}

{
  // 4. Same content reached the base by another route: a rebase or a
  //    cherry-pick must not be reported as stranded, or the gate trains
  //    people to waive things and stops being read.
  const dir = makeRepo();
  cleanup.push(dir);
  git(dir, 'checkout', '-q', '-b', 'fix/tui-layout');
  writeFileSync(join(dir, TUI_FILE), 'export const v = 2;\n');
  git(dir, 'add', '-A');
  commit(dir, 'fix(tui): the phone viewport', { hoursAgo: 40 });
  git(dir, 'checkout', '-q', 'main');
  // Same edit, different commit — the classic reworked/cherry-picked case.
  writeFileSync(join(dir, TUI_FILE), 'export const v = 2;\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'chore: bring the TUI file forward');
  const r = runGate(dir);
  check('work reworked into the base is not stranded', r.code === 0, r.out.trim().split('\n').pop());
}

{
  // 5. Waivers: one that is doing work, and one that is stale. The stale one
  //    must be named, or a waiver becomes a permanent off switch.
  const dir = makeRepo();
  cleanup.push(dir);
  git(dir, 'checkout', '-q', '-b', 'fix/tui-real');
  writeFileSync(join(dir, TUI_FILE), 'export const v = 2;\n');
  git(dir, 'add', '-A');
  commit(dir, 'fix(tui): genuinely unlanded', { hoursAgo: 30 });
  const sha = git(dir, 'rev-parse', 'HEAD').slice(0, 8);
  git(dir, 'checkout', '-q', 'main');
  writeFileSync(join(dir, 'scripts/waivers.txt'), [
    '# sha          reason',
    `${sha}  dead work, judged 2026-09-29`,
    'deadbee0  a waiver for a commit that is no longer stranded',
    '',
  ].join('\n'));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'chore: waivers');
  const r = runGate(dir);
  check('a waiver suppresses its commit', r.code === 0, r.out.trim().split('\n').pop());
  check('a waiver with nothing behind it is named', r.out.includes('deadbee0'), r.out);
}

{
  // 6. Scope: an old branch that never touched a TUI file is not this gate's
  //    business, or every branch in the repo becomes a TUI failure.
  const dir = makeRepo();
  cleanup.push(dir);
  git(dir, 'checkout', '-q', '-b', 'fix/unrelated');
  writeFileSync(join(dir, OTHER_FILE), 'export const o = 2;\n');
  git(dir, 'add', '-A');
  commit(dir, 'fix(other): not a TUI file', { hoursAgo: 60 });
  git(dir, 'checkout', '-q', 'main');
  const r = runGate(dir);
  check('a non-TUI old branch passes', r.code === 0, r.out.trim().split('\n').pop());
}

{
  // 7. If a watched file is gone from the base, the gate protects nothing
  //    and must say so instead of reporting a clean bill of health.
  const dir = makeRepo();
  cleanup.push(dir);
  git(dir, 'rm', '-q', TUI_FILE);
  git(dir, 'commit', '-q', '-m', 'chore: drop the gateway');
  const r = runGate(dir);
  check('a missing watched file fails', r.code === 1);
  check('the missing file is named', r.out.includes(TUI_FILE), r.out);
}

for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
