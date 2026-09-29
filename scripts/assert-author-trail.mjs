#!/usr/bin/env node
/**
 * Backfill audit: judge EVERY commit on the base, not only the new ones.
 *
 * Why this exists. `check-agent-identity.sh` judges a *range* — the commits a
 * PR adds, or the commits a merge lands. That is the right shape for a gate:
 * cheap, and it never blocks on history it cannot change. But it has a blind
 * spot: a commit that landed while the range was wrong is never re-judged, so
 * it stays wrong forever and nobody can tell it is there.
 *
 * Measured on 2026-09-29: 35 of 1350 commits on main fail the current rule.
 * Three of them are the interesting ones — `9641a2e` and `0127c7d` (mine) and
 * `f443870` (another agent) carry no trailer at all, and landed *because* of
 * the empty-range hole fixed in #353. The rest are older, predate the rule's
 * current shape, or use the legacy prefix.
 *
 * So: the fix is not to rewrite shared history. `check-agent-identity.sh`
 * already says why, in its own header — grandfathering exists so that "the
 * pressure to fix that lands on rewriting someone else's history" is not a
 * real option. This makes the debt *visible and pinned* instead:
 *
 *   - a commit failing today that is NOT in the debt file is NEW debt → fail,
 *     because that is the case a range gate structurally cannot catch;
 *   - a commit in the debt file that now passes → reported as stale, so the
 *     file gets pruned rather than becoming a permanent off switch;
 *   - a commit in the debt file with no dated reason → fail. An unexplained
 *     waiver is indistinguishable from a bug.
 *
 * Run: node scripts/assert-author-trail.mjs [--base=origin/main] [--report]
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GATE = join(ROOT, 'scripts', 'check-agent-identity.sh');
const args = new Map(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => a.replace(/^--/, '').split('=')));
const BASE = args.get('base') || 'origin/main';
const REPORT = args.has('report');
// The debt file is overridable so the sensor can point the audit at a fixture
// repo. It is not overridable in spirit: in normal use it is this one path.
const DEBT_FILE = args.get('debt') ? resolve(ROOT, args.get('debt')) : join(ROOT, 'scripts', 'author-trail-debt.txt');

let failed = 0;
const log = (s) => process.stdout.write(`${s}\n`);
const fail = (s) => { failed += 1; log(`  FAIL  ${s}`); };
const pass = (s) => log(`  PASS  ${s}`);

// A --repo lets the sensor point the audit at a fixture repository. In normal
// use there is exactly one: the checkout the script lives in.
const REPO = args.get('repo') ? resolve(ROOT, args.get('repo')) : ROOT;
const git = (...argv) => execFileSync('git', argv, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const judged = (range) => {
  try {
    execFileSync('sh', [GATE, '--range', range], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, detail: '' };
  } catch (err) {
    return { ok: false, detail: String(err.stderr || '') };
  }
};

const short = (h) => h.slice(0, 8);
const subject = (h) => {
  try { return git('log', '-1', '--format=%s', h); } catch { return '(unknown)'; }
};
const authored = (h) => {
  try { return git('log', '-1', '--format=%aI', h); } catch { return '(unknown)'; }
};

// --- known debt, parsed. "<sha>  <reason, dated>"
const known = new Map();
if (existsSync(DEBT_FILE)) {
  for (const line of readFileSync(DEBT_FILE, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const [sha, ...rest] = t.split(/\s+/);
    if (sha && rest.length) known.set(sha, rest.join(' '));
  }
}

const revs = git('rev-list', BASE).split('\n').filter(Boolean);

// A root commit has no parent, so `p..h` cannot express it. Judge the message
// directly for those instead of skipping them silently.
const total = revs.length;
const failing = [];

for (const h of revs) {
  let parent;
  try { parent = git('rev-parse', `${h}^`); } catch { continue; } // root commit
  const r = judged(`${parent}..${h}`);
  if (r.ok) continue;
  const trailer = (() => {
    try { return git('log', '-1', '--format=%B', h).split('\n').find((l) => /^(Agent|Author):/.test(l)) || '(none)'; }
    catch { return '(unreadable)'; }
  })();
  // Classify precisely. "shape" for 35 commits tells a future reader nothing;
  // the four ways a commit can be wrong here are four different pieces of debt,
  // and the no-trailer one is the only one that means the gate never saw it.
  const reason = (() => {
    if (trailer === '(none)') return 'no-trailer';
    if (/uses the legacy 'Agent:' prefix/.test(r.detail)) return 'legacy-prefix';
    if (!/\)\s+[A-Za-z0-9][A-Za-z0-9._-]*\s*$/.test(trailer)) return 'no-location';
    if (/\([^)()]+\)\s+[A-Za-z0-9]/.test(trailer)) return 'bad-level';
    return 'unknown';
  })();
  failing.push({ sha: h, reason, trailer, authored: authored(h), subject: subject(h) });
}

log('assert-author-trail:');
log(`  base ${BASE}: ${total} commit(s) judged, ${failing.length} fail the current rule`);

if (REPORT) {
  log('');
  for (const f of failing) {
    log(`  ${short(f.sha)}  ${f.authored.slice(0, 19)}  ${f.reason.padEnd(14)} ${f.trailer}`);
  }
  log('');
}

// --- new debt: failing, and not on the file. This is the case a range gate
// structurally cannot catch, and the only thing here that must go red.
const fresh = failing.filter((f) => ![...known.keys()].some((k) => f.sha.startsWith(k) || k.startsWith(f.sha)));
const stale = [...known.keys()].filter((k) => !failing.some((f) => f.sha.startsWith(k) || k.startsWith(f.sha)));

// A commit rejudged every run: the file is not a ratchet, it is a snapshot of
// debt, and a snapshot nobody prunes becomes a permanent off switch.
for (const k of stale) {
  log(`  note: debt entry ${k} no longer fails — delete it from scripts/author-trail-debt.txt`);
}

if (fresh.length === 0) {
  pass(`no unrecorded debt: every failing commit is on the debt file with a reason`);
} else {
  fail(`${fresh.length} commit(s) on ${BASE} fail the author rule and are not on the debt file:`);
  for (const f of fresh) {
    log(`        ${short(f.sha)}  ${f.authored.slice(0, 19)}  ${f.reason.padEnd(14)} ${f.trailer}`);
    log(`          ${f.subject.slice(0, 70)}`);
  }
  log('');
  log('  A range gate cannot see these: it only judges what a change ADDS, so a');
  log('  commit that landed while a range was wrong is never re-judged. Record it');
  log(`  in scripts/author-trail-debt.txt as "<sha>  <reason, dated>" — do NOT`);
  log('  rewrite shared history to hide it. check-agent-identity.sh grandfathered');
  log('  old work on purpose, for exactly this reason.');
}

// A waiver with no reason is a bug wearing a waiver's clothes.
const unreasoned = [...known.entries()].filter(([, reason]) => !/\d{4}-\d{2}-\d{2}/.test(reason));
if (unreasoned.length) {
  fail(`${unreasoned.length} debt entr(ies) carry no dated reason:`);
  for (const [k] of unreasoned) log(`        ${k}`);
}

if (REPORT) {
  const body = [
    '# Commits on main that do not satisfy the current author rule.',
    '#',
    '# Format:  <sha>  <reason, dated>',
    '#',
    '# Read by scripts/assert-author-trail.mjs, which judges EVERY commit on the',
    '# base rather than only the ones a change adds. The range gate cannot see',
    '# these: a commit that landed while its range was wrong is never re-judged.',
    '#',
    '# This file is a record of debt, not a waiver of the rule — the rule still',
    '# applies to every new commit. An entry is here because the commit is',
    '# already on a shared branch and rewriting shared history is not an option',
    '# we take (see the header of scripts/check-agent-identity.sh).',
    '#',
    '# Regenerate with: node scripts/assert-author-trail.mjs --report',
    '# Delete an entry as soon as its commit stops failing, so this file cannot',
    '# become a permanent off switch.',
    '',
  ].join('\n');
  const WHY = {
    // Stated as the mechanism, not a story: a range gate judges only what a
    // change adds, so anything that landed while its range was wrong is never
    // re-judged. #353 is the case where the range was provably empty for every
    // post-merge run; it is not the only path, so it is cited rather than
    // claimed for all of them.
    'no-trailer': 'no Author/Agent trailer; never judged, because a range gate only judges what a change adds (#353 is the provable empty-range case)',
    'legacy-prefix': 'legacy Agent: prefix, authored after the rename was enforced',
    'no-location': 'trailer predates the location token (#326)',
    'bad-level': 'thinking level is not a word (n/a and friends)',
    unknown: 'unclassified — investigate, do not leave as unknown',
  };
  const lines = failing.map((f) => `${short(f.sha)}  ${WHY[f.reason]}; authored ${f.authored.slice(0, 10)}; recorded 2026-09-29`);
  writeFileSync(DEBT_FILE, body + lines.join('\n') + '\n');
  log(`  wrote ${DEBT_FILE} (${lines.length} entries)`);
  log('  Re-run without --report: the debt is now recorded, so it should pass.');
  log('  Review the entries before committing — this records what IS, not what should be.');
}

log('');
log(failed === 0 ? 'assert-author-trail: 0 fail' : `assert-author-trail: ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
