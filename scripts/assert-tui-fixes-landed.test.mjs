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

{
  // 8. THE 2026-10-01 CASE. A squash merge puts a NEW commit on the base and
  //    leaves the branch's original sha unreachable forever, so reachability
  //    condemns landed work. Once the base moves past the change the blob
  //    escape hatch closes too. `git cherry` still sees the patch upstream.
  const dir = makeRepo();
  cleanup.push(dir);
  git(dir, 'checkout', '-q', '-b', 'feat/forge');
  writeFileSync(join(dir, TUI_FILE), 'export const v = 2;\n');
  git(dir, 'add', '-A');
  commit(dir, 'feat(forge): one click to create a bot', { hoursAgo: 30 });
  git(dir, 'checkout', '-q', 'main');
  // The squash: same change, new sha — what a squash merge actually writes.
  writeFileSync(join(dir, TUI_FILE), 'export const v = 2;\n');
  git(dir, 'add', '-A');
  commit(dir, 'feat(forge): one click to create a bot (#373)', { hoursAgo: 29 });
  // And then the base moves on, so branch and base blobs differ again.
  writeFileSync(join(dir, TUI_FILE), 'export const v = 3; // serve the registry as of the request\n');
  git(dir, 'add', '-A');
  commit(dir, 'feat(forge): serve the registry as of the request', { hoursAgo: 2 });

  // The precondition that made this a false positive: the sha really is
  // unreachable and the blobs really do differ. If either stops being true the
  // test is no longer proving what it claims to.
  const unreachable = git(dir, 'log', '--format=%s', 'main..feat/forge');
  check('the squash residue is unreachable from main', unreachable.includes('one click to create a bot'), unreachable);
  const branchBlob = git(dir, 'rev-parse', 'feat/forge:scripts/tui-gateway.mjs');
  const mainBlob = git(dir, 'rev-parse', 'main:scripts/tui-gateway.mjs');
  check('the blob escape hatch is closed (they differ)', branchBlob !== mainBlob);

  const r = runGate(dir);
  check('a squash-merged branch is NOT stranded', r.code === 0, r.out.trim().split('\n').pop());
}

{
  // 9. Work in review is not stranded. An open PR is the opposite of an
  //    unlanded fix reading as a done fix.
  const dir = makeRepo();
  cleanup.push(dir);
  git(dir, 'checkout', '-q', '-b', 'fix/tui-scroll-multiclient');
  writeFileSync(join(dir, TUI_FILE), 'export const v = 2;\n');
  git(dir, 'add', '-A');
  commit(dir, 'fix(tui): lane-shared page-key scroll', { hoursAgo: 26 });
  git(dir, 'checkout', '-q', 'main');
  check('without the PR list it is still flagged', runGate(dir).code === 1);
  check('with an open PR it is not stranded',
    runGate(dir, ['--open-pr-branches=fix/tui-scroll-multiclient']).code === 0);
  // CI only ever sees remote-tracking refs, so origin/<name> must match too.
  check('an origin/ prefixed name matches as well',
    runGate(dir, ['--open-pr-branches=origin/fix/tui-scroll-multiclient']).code === 0);
}

{
  // 10. The new senses must not become a wider hole. A branch that is neither
  //     patch-upstream nor under an open PR is still stranded, even when
  //     ANOTHER branch in the same repo has an open PR.
  const dir = makeRepo();
  cleanup.push(dir);
  git(dir, 'checkout', '-q', '-b', 'fix/in-review');
  writeFileSync(join(dir, OTHER_FILE), 'export const o = 2;\n');
  git(dir, 'add', '-A');
  commit(dir, 'feat(other): reviewed work', { hoursAgo: 40 });
  git(dir, 'checkout', '-q', 'main');
  git(dir, 'checkout', '-q', '-b', 'fix/tui-abandoned');
  writeFileSync(join(dir, TUI_FILE), 'export const v = 9;\n');
  git(dir, 'add', '-A');
  commit(dir, 'fix(tui): nobody is reviewing this', { hoursAgo: 50 });
  git(dir, 'checkout', '-q', 'main');
  const r = runGate(dir, ['--open-pr-branches=fix/in-review']);
  check('an unlisted old TUI branch still fails', r.code === 1);
  check('and it is the abandoned one that is named', r.out.includes('nobody is reviewing this'), r.out);
}

{
  // 11. A branch holding one landed commit AND one genuinely stranded commit
  //     must be judged per commit: the patch-upstream sense excuses only the
  //     first. This is what stops `git cherry` from becoming a blanket pass.
  const dir = makeRepo();
  cleanup.push(dir);
  git(dir, 'checkout', '-q', '-b', 'feat/mixed');
  writeFileSync(join(dir, TUI_FILE), 'export const v = 2;\n');
  git(dir, 'add', '-A');
  commit(dir, 'feat(forge): landed by a squash', { hoursAgo: 30 });
  writeFileSync(join(dir, TUI_FILE), 'export const v = 77;\n');
  git(dir, 'add', '-A');
  commit(dir, 'fix(tui): the half that never landed', { hoursAgo: 31 });
  git(dir, 'checkout', '-q', 'main');
  writeFileSync(join(dir, TUI_FILE), 'export const v = 2;\n');
  git(dir, 'add', '-A');
  commit(dir, 'feat(forge): landed by a squash (#373)', { hoursAgo: 29 });
  writeFileSync(join(dir, TUI_FILE), 'export const v = 3; // moved on\n');
  git(dir, 'add', '-A');
  commit(dir, 'feat(forge): the base moved past it', { hoursAgo: 2 });
  const r = runGate(dir);
  check('a mixed branch still fails', r.code === 1);
  check('the landed half is not named', !r.out.includes('landed by a squash (#373'), r.out);
  check('the stranded half IS named', r.out.includes('the half that never landed'), r.out);
}

{
  // 9b. The same work, rebuilt. 2026-10-01: cf8f68f7 sat on the leftover
  //     `fix/tui-scroll-multiclient` while the reviewed
  //     `agent/tui-scroll-multiclient` carried the SAME change as a different
  //     sha. Branch names differ and neither sha is reachable from the other,
  //     so only a patch-level comparison finds it.
  const dir = makeRepo();
  cleanup.push(dir);
  git(dir, 'checkout', '-q', '-b', 'fix/tui-scroll-multiclient');
  writeFileSync(join(dir, TUI_FILE), 'export const v = 2;\n');
  git(dir, 'add', '-A');
  commit(dir, 'fix(tui): lane-shared page-key scroll', { hoursAgo: 26 });
  git(dir, 'checkout', '-q', 'main');
  git(dir, 'checkout', '-q', '-b', 'agent/tui-scroll-multiclient');
  writeFileSync(join(dir, TUI_FILE), 'export const v = 2;\n');
  git(dir, 'add', '-A');
  commit(dir, 'fix(tui): lane-shared page-key scroll', { hoursAgo: 1 });
  git(dir, 'checkout', '-q', 'main');
  check('without the PR list the leftover branch is flagged', runGate(dir).code === 1);
  check('the rebuilt work is recognised as in review',
    runGate(dir, ['--open-pr-branches=agent/tui-scroll-multiclient']).code === 0);
  // Same patch, unreviewed branch: still stranded. The patch check must be
  // scoped to branches that actually have an open PR.
  check('the same patch on an unreviewed branch is still stranded',
    runGate(dir, ['--open-pr-branches=agent/something-else']).code === 1);
}

{
  // 9c. A PR name this checkout cannot resolve (a CI clone has only
  //     origin/<name>; a shallow local clone may have neither) must still
  //     exempt by name AND say so — a gate that quietly stops checking is worse
  //     than one that fails.
  const dir = makeRepo();
  cleanup.push(dir);
  git(dir, 'checkout', '-q', '-b', 'fix/tui-ghost-ref');
  writeFileSync(join(dir, TUI_FILE), 'export const v = 2;\n');
  git(dir, 'add', '-A');
  commit(dir, 'fix(tui): work whose PR ref is not fetched', { hoursAgo: 26 });
  git(dir, 'checkout', '-q', 'main');
  const r = runGate(dir, ['--open-pr-branches=origin/fix/tui-ghost-ref']);
  check('an unresolvable PR ref still exempts by name', r.code === 0, r.out.trim().split('\n').pop());
  check('and the gate says the ref was not in the checkout', r.out.includes('not in this checkout'), r.out);
}

for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });

console.log(`\n${passed} pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
