#!/usr/bin/env node
/**
 * Ratchet: a TUI fix must not sit on a branch that never lands.
 *
 * Why this exists. On 2026-09-28 the /tui socket-token and tmux-attach fixes
 * were made and committed on `fix/tui-telegram-auth` (16 commits, PR #315),
 * with 60+ sensor cases green and a written trail. Nothing merged. On
 * 2026-09-29 the same bugs — plus the signature and layout ones from the same
 * branch — were live on main and had to be re-fixed by hand against a phone.
 * Structure was green throughout; every CI check passed. The sensors prove
 * what main contains. Nothing here proved what main HAD, and that was the gap.
 *
 * What it checks. For every remote branch, the commits it has that the base
 * does not, limited to the files a /tui regression hides in. Any of those
 * older than the staleness bound is stranded work: the gate fails and names
 * the branch, the age and the subject. Fresh work in flight is not a failure —
 * that is the difference between a ratchet and a nag.
 *
 * A commit whose watched files are byte-identical on the branch and on the
 * base counts as landed by another route (a cherry-pick, a rebase, a
 * squash-then-redo), so reworked work does not cry wolf. A commit listed in
 * the exceptions file is skipped, and the file prints how old each exception
 * is, so a bypass cannot quietly become permanent.
 *
 * ## Two senses this gate was missing (both paid for on 2026-10-01)
 *
 * **Squash-merge residue is unreachable, forever.** A PR merged with a squash
 * puts a NEW commit on the base; the branch keeps its original sha, which is
 * then not an ancestor of the base and never will be. `git log base..branch`
 * reports it forever, so reachability alone condemns landed work. The
 * byte-identical escape hatch only holds while the base has not moved past the
 * change — on 2026-10-01 `scripts/tui-gateway.mjs` advanced to eca9ed2c and
 * stopped matching, and two agents each spent a waiver on the same branch
 * (1ea00d23). `git cherry` answers the question reachability cannot: it compares
 * PATCHES, and prints `-` for a commit whose change is already upstream.
 *
 * **Work in review is not stranded.** A branch with an open PR is visibly being
 * worked; that is the opposite of "an unlanded fix reads as a done fix". The
 * branch names are supplied by the caller in `--open-pr-branches=` (or the
 * `TUI_OPEN_PR_BRANCHES` env var) so this module stays pure — it makes no
 * network call and its own sensor can drive it without a token. If the caller
 * supplies nothing, no branch is exempt and the gate behaves exactly as before:
 * the API being unreachable must not silently pass anything.
 *
 * Usage:
 *   node scripts/assert-tui-fixes-landed.mjs [--max-age-hours=24] [--base=main]
 *                                               [--exceptions=<path>]
 *                                               [--open-pr-branches=a,b,c]
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = new Map(
  process.argv.slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => a.replace(/^--/, '').split('=')),
);

const HERE = dirname(fileURLToPath(import.meta.url));
// The checkout to judge, from the working directory when it is inside one.
// Falling back to the script's own parent keeps a bare `node scripts/…` from the
// repo root working, and `--repo=` lets the sensor point the gate at a fixture.
const toplevel = () => {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return '';
  }
};
const REPO = args.get('repo') ? resolve(args.get('repo')) : (toplevel() || resolve(HERE, '..'));

// A checkout of an older commit puts a detached HEAD in place of `main`, and
// `origin/main` moves to the same commit the local `main` is behind. A person
// running this wants the branch named `main`; a CI checkout on a detached HEAD
// wants the commit under test. Take `main` when it is a real branch, otherwise
// fall back to origin/main.
const gitQuiet = (...argv) => {
  try {
    return execFileSync('git', argv, { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
};
const BASE = args.get('base')
  || (gitQuiet('rev-parse', '--verify', '--quiet', 'refs/heads/main') ? 'main' : 'origin/main');
const MAX_AGE_HOURS = Number(args.get('max-age-hours') || 24);
const EXCEPTIONS_FILE = resolve(REPO, args.get('exceptions') || 'scripts/tui-stranded-exceptions.txt');

// Branches with an open PR, supplied by the caller so this module makes no
// network call. Comma or newline separated. Empty (the default, and what CI
// gets if its `gh pr list` fails) means "exempt nobody" — the pre-existing
// behaviour — so an API outage cannot quietly pass stranded work.
//
// `origin/` is stripped on both sides for NAME comparison: CI enumerates
// remote-tracking refs (`origin/agent/x`) while a developer runs this locally
// against `agent/x`, and `gh pr list` reports the bare name.
//
// The refs themselves are resolved further down, next to the patch comparison
// that needs them — a bare name from `gh` often does not exist in this
// checkout (a CI clone has only `origin/agent/x`), and an unresolved ref makes
// `git cherry` fail, return nothing, and report reviewed work as stranded.
const OPEN_PR_BRANCHES = new Set();
for (const raw of (args.get('open-pr-branches') ?? process.env.TUI_OPEN_PR_BRANCHES ?? '')
  .split(/[\s,]+/)) {
  const name = raw.trim();
  if (name) OPEN_PR_BRANCHES.add(name);
}

// The files a /tui regression hides in. A new one added here must also be
// covered by a sensor in scripts/assert-tui-gateway.test.mjs or
// scripts/assert-tui-chat-select.test.sh, or this gate is a branch-shaped
// tripwire with no teeth.
const TUI_PATHS = [
  'scripts/tui-gateway.mjs',
  'scripts/mobile/tui-attach.sh',
  'scripts/assert-tui-gateway.test.mjs',
  'scripts/assert-tui-gateway-live.sh',
  'scripts/assert-tui-chat-select.test.sh',
  'TUI_TG_AUTH_TRAIL.md',
];

let failed = 0;
const log = (s) => process.stdout.write(`${s}\n`);
const fail = (s) => { failed += 1; log(`  FAIL  ${s}`); };
const pass = (s) => log(`  PASS  ${s}`);

// Git's stderr is diagnostics, not output: a missing blob is an answer here,
// not something to print. Silence it and let the caller decide.
const git = (...argv) => {
  try {
    return execFileSync('git', argv, {
      encoding: 'utf8',
      cwd: REPO,
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    // exit 1 from `git diff --quiet` means "different", not "broken".
    if (err && typeof err.stdout === 'string') return err.stdout;
    return null;
  }
};

const blobAt = (ref, file) => {
  const out = git('rev-parse', '--verify', '--quiet', `${ref}:${file}`);
  return out ? out.trim() : null;
};

log('assert-tui-fixes-landed:');

if (!git('rev-parse', '--verify', '--quiet', BASE)) {
  git('fetch', '--no-tags', '--quiet', 'origin', BASE);
}
if (!git('rev-parse', '--verify', '--quiet', BASE)) {
  fail(`base ref ${BASE} is not available; cannot judge branches`);
  log('');
  log(`assert-tui-fixes-landed: ${failed} fail`);
  process.exit(1);
}

// Exceptions: "<sha>  <reason>", '#' comments. One line each, dated in the
// reason so the age of a bypass is visible in the output.
const exceptions = new Map();
if (existsSync(EXCEPTIONS_FILE)) {
  for (const line of readFileSync(EXCEPTIONS_FILE, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const [sha, ...rest] = t.split(/\s+/);
    if (sha && rest.length) exceptions.set(sha, rest.join(' '));
  }
}

// Both local branches and remote-tracking ones: a developer mid-flight has the
// branch locally, CI sees it as origin/<branch>, and a branch that exists in
// neither is not a branch anything can regress from.
const branchRows = [
  ...(git('for-each-ref', '--format=%(refname:short)', 'refs/heads') || '').split('\n'),
  ...(git('for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin') || '').split('\n'),
]
  .map((l) => l.trim())
  .filter((l) => l && !l.endsWith('/HEAD') && l !== BASE && l !== `origin/${BASE}`);

const nowSec = Math.floor(Date.now() / 1000);
const boundSec = MAX_AGE_HOURS * 3600;
const stranded = [];
let considered = 0;

for (const branch of branchRows) {
  const raw = git('log', `--format=%H%x1f%at%x1f%s`, `${BASE}..${branch}`, '--', ...TUI_PATHS);
  if (raw === null) continue; // unrelated history, or already merged
  for (const line of raw.split('\n').filter(Boolean)) {
    considered += 1;
    const [hash, ts, subject] = line.split('\x1f');
    const ageHours = (nowSec - Number(ts)) / 3600;
    if (ageHours * 3600 < boundSec) continue; // still in flight
    stranded.push({ branch, hash, subject, ageHours });
  }
}

// Exceptions are written as short shas (what a person reads off a log line),
// so match on prefix rather than demanding the full 40.
const waivedFor = (hash) => {
  for (const [sha, reason] of exceptions) {
    if (hash.startsWith(sha) || sha.startsWith(hash)) return reason;
  }
  return null;
};

let waived = 0;
const blockers = [];

// `git cherry <upstream> <branch>` compares PATCHES, not shas: it prints `-` for
// a commit whose change is already upstream even when the sha is unreachable —
// which is the squash-merge case reachability can never satisfy, and also the
// case of work rebuilt onto a fresh branch. Cached per (upstream, branch).
const cherryCache = new Map();
const cherryLanded = (upstream, branch) => {
  const key = `${upstream} ${branch}`;
  if (!cherryCache.has(key)) {
    const out = git('cherry', upstream, branch) || '';
    const landed = new Set();
    for (const line of out.split('\n')) {
      const [mark, sha] = line.trim().split(/\s+/);
      if (mark === '-' && sha) landed.add(sha);
    }
    cherryCache.set(key, landed);
  }
  return cherryCache.get(key);
};

// A branch is named locally (`agent/x`) or as a remote-tracking ref
// (`origin/agent/x`); CI only ever sees the latter.
const bareName = (branch) => branch.replace(/^origin\//, '');

// Resolve each open-PR name to a ref that EXISTS here, for the patch
// comparison below. Name-only matching still works when nothing resolves; this
// only makes the patch check possible.
const OPEN_PR_REFS = [];
const OPEN_PR_UNRESOLVED = [];
for (const name of OPEN_PR_BRANCHES) {
  const found = [name, `origin/${name}`].find((c) => git('rev-parse', '--verify', '--quiet', `${c}^{commit}`));
  if (found) OPEN_PR_REFS.push(found);
  else OPEN_PR_UNRESOLVED.push(name);
}

const patchIsUpstream = (branch, hash) => cherryLanded(BASE, branch).has(hash);

// In review: either the branch itself is under review, or this exact patch is.
// Work rebuilt onto a fresh `agent/` branch with an open PR is the same work,
// and 2026-10-01 had exactly that — cf8f68f7 sat on the leftover
// `fix/tui-scroll-multiclient` while the reviewed `agent/tui-scroll-multiclient`
// carried the same change as 593433f8. Judging by branch name alone would have
// reported reviewed work as stranded.
const isUnderOpenPr = (branch, hash) => {
  const bare = bareName(branch);
  for (const pr of OPEN_PR_BRANCHES) {
    if (bareName(pr) === bare) return true;
  }
  for (const pr of OPEN_PR_REFS) {
    if (pr !== branch && cherryLanded(pr, branch).has(hash)) return true;
  }
  return false;
};

for (const s of stranded) {
  if (waivedFor(s.hash)) {
    waived += 1;
    continue;
  }
  // Landed by another route, squash-merged: the patch is upstream, the sha is not.
  if (patchIsUpstream(s.branch, s.hash)) {
    waived += 1;
    continue;
  }
  // In review: an open PR means the work is visibly being worked, not sitting.
  if (isUnderOpenPr(s.branch, s.hash)) {
    waived += 1;
    continue;
  }
  // Landed by another route? Every watched file this commit touched must be
  // byte-identical on the branch and on the base.
  const files = (git('show', '--format=', '--name-only', s.hash) || '')
    .split('\n')
    .map((f) => f.trim())
    .filter((f) => TUI_PATHS.includes(f));
  const same = files.length > 0
    && files.every((f) => blobAt(BASE, f) && blobAt(s.branch, f) === blobAt(BASE, f));
  if (same) {
    waived += 1;
    continue;
  }
  blockers.push(s);
}

blockers.sort((a, b) => b.ageHours - a.ageHours);

// Said out loud, because a branch the caller named as "under review" that this
// checkout cannot see is exactly the case where the exemption quietly stops
// working. Silence there would be a gate that reports less than it checked.
if (OPEN_PR_UNRESOLVED.length) {
  log(`  note: ${OPEN_PR_UNRESOLVED.length} open-PR branch(es) are not in this checkout and can only be matched by name: ${OPEN_PR_UNRESOLVED.join(', ')}`);
}

if (blockers.length === 0) {
  pass(`no TUI fix older than ${MAX_AGE_HOURS}h is stranded on a branch (${considered} commit(s) scanned, ${waived} already landed or waived)`);
} else {
  log(`  ${blockers.length} TUI commit(s) older than ${MAX_AGE_HOURS}h are not in ${BASE}:`);
  for (const s of blockers) {
    fail(`${s.branch}: ${s.ageHours.toFixed(0)}h old  ${s.subject}  (${s.hash.slice(0, 8)})`);
  }
  log('');
  log('  A TUI fix that has not landed for a day is a live regression waiting');
  log('  for the user to find. Land it (or cherry-pick it), then delete the');
  log('  branch. If it is genuinely dead work, say so in TUI_TG_AUTH_TRAIL.md,');
  log(`  add "<sha>  <reason, dated>" to ${EXCEPTIONS_FILE.replace(`${REPO}/`, '')}, and`);
  log('  delete the branch anyway: an unlanded fix reads as a done fix.');
}

// The watched files must exist on the base, or the gate protects nothing.
for (const p of TUI_PATHS) {
  if (blobAt(BASE, p)) pass(`${p} exists on ${BASE}`);
  else fail(`${p} is missing from ${BASE} but is in the watched set`);
}

if (exceptions.size) {
  // An exception whose branch is gone is a waiver for nothing, and a waiver
  // nobody reads is how a gate goes quiet. Both are worth saying out loud.
  const stale = [...exceptions.keys()].filter(
    (sha) => !branchRows.some((b) => stranded.some((s) => s.branch === b && waivedFor(s.hash) === exceptions.get(sha))),
  );
  log('');
  log(`  exceptions on file: ${exceptions.size} (${waived} applied this run)`);
  if (stale.length) {
    log(`  note: ${stale.length} exception(s) match no stranded commit this run:`);
    for (const sha of stale) log(`        ${sha}`);
    log('        Delete them with the branch, or check the fix really landed.');
  }
}

log('');
log(failed === 0 ? 'assert-tui-fixes-landed: 0 fail' : `assert-tui-fixes-landed: ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
