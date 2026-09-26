#!/usr/bin/env node
/**
 * agent-hygiene.mjs — the self-cleaning loop for agent branches and PRs.
 *
 * Why this exists is in plan/AGENT_HYGIENE.md: branch-per-task with no retirement
 * step produced 45 branches and 18 open PRs for one live agent. This script is the
 * retirement step, and it runs without a human (daily timer). The audit log is the
 * accountability, not an approval click.
 *
 * Tiers (all must hold within a tier):
 *   Tier 1 — the content is provably in main (merged PR, or tip reachable from
 *            main). Delete the branch pointer. Nothing is judged.
 *   Tier 2 — open PR + head untouched 48h + no live heartbeat + no live process +
 *            (failing gate OR dirty OR older than 7 days). Comment + close the PR.
 *            The branch is kept.
 *   Tier 3 — branch of a Tier-2-closed PR (or never PR'd), untouched 7 more days,
 *            no heartbeat, no process. Delete the branch.
 *
 * A live heartbeat vetoes everything, unconditionally. `main` is never touched.
 * Dry-run unless `--apply` is passed. Every action appends one JSON line to the
 * audit log, including dry runs (marked as such).
 *
 * Usage:
 *   node scripts/agent-hygiene.mjs                      # dry run, report only
 *   node scripts/agent-hygiene.mjs --apply              # act
 *   node scripts/agent-hygiene.mjs --apply --tier=1     # only provably-safe deletes
 *   node scripts/agent-hygiene.mjs --json               # machine-readable report
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { isLive, readBeats, slug } from './agent-heartbeat.mjs';

export const OPEN_GRACE_H = 48;
export const PR_AGE_DAYS = 7;
export const BRANCH_GRACE_DAYS = 7;
const PROTECTED = new Set(['main', 'master', 'HEAD']);

const arg = (name, fallback = '') => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const APPLY = process.argv.includes('--apply');
const JSON_OUT = process.argv.includes('--json');
const ONLY_TIER = arg('tier', '');
const DECLARED = process.argv.includes('--declared-abandoned');

const auditDir = path.join(os.homedir(), '.local', 'state', 'bot-host', 'agent-hygiene');
const auditFile = path.join(auditDir, 'audit.jsonl');
const actions = [];

function audit(action) {
  const line = { at: new Date().toISOString(), dry: !APPLY, ...action };
  actions.push(line);
  try {
    fs.mkdirSync(auditDir, { recursive: true });
    fs.appendFileSync(auditFile, `${JSON.stringify(line)}\n`);
  } catch { /* an unwritable audit log must not stop a dry run report */ }
}

function gh(args) {
  try {
    return execFileSync('gh', args, { encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
  } catch (err) {
    return `__ERR__ ${String(err.message).slice(0, 160)}`;
  }
}

function git(args, { cwd } = {}) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', timeout: 60000, cwd: cwd || process.cwd() }).trim();
  } catch {
    return '';
  }
}

export function hoursSince(iso, now = Date.now()) {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return Infinity;
  return (now - t) / 3600000;
}

/**
 * Pure decision for one open PR. Everything the rule needs is an argument, so the
 * sensor can pin the rule without touching git or the network.
 */
export function tierForPR({ merged, tipInMain, headAgeH, prAgeDays, heartbeatLive, processLive, gateFailing, dirty, declaredAbandoned = false }) {
  if (merged || tipInMain) return 'tier1';
  // A heartbeat or a live process is a veto no declaration overrides. The operator's
  // "everyone else is gone" waives only the head-age grace — never liveness.
  if (heartbeatLive || processLive) return 'keep';
  if (!declaredAbandoned && headAgeH <= OPEN_GRACE_H) return 'keep';
  if (gateFailing || dirty || prAgeDays >= PR_AGE_DAYS) return 'tier2';
  return 'keep';
}

export function tierForBranch({ tipInMain, lastAgeH, heartbeatLive, processLive, closedGraceExpired }) {
  if (tipInMain) return 'tier1';
  if (heartbeatLive || processLive) return 'keep';
  if (closedGraceExpired && lastAgeH >= BRANCH_GRACE_DAYS * 24) return 'tier3';
  return 'keep';
}

/** Pids in our own ancestry: the observer must never count itself as liveness. */
function selfAncestry() {
  const seen = new Set([String(process.pid)]);
  let pid = String(process.pid);
  for (let i = 0; i < 32; i += 1) {
    let stat = '';
    try {
      stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    } catch {
      break;
    }
    const ppid = (stat.match(/\)\s+(\S+\s+){2}(\d+)/) || [])[3];
    if (!ppid || ppid === '0' || seen.has(ppid)) break;
    seen.add(ppid);
    pid = ppid;
  }
  return seen;
}

/** Branches with a live process holding a worktree on them. */
function liveBranchesFromProcesses(worktrees) {
  const mine = selfAncestry();
  const live = new Set();
  let pids = [];
  try {
    pids = fs.readdirSync('/proc').filter((p) => /^\d+$/.test(p));
  } catch {
    return live;
  }
  const cwdOf = (pid) => {
    try {
      return fs.readlinkSync(`/proc/${pid}/cwd`);
    } catch {
      return '';
    }
  };
  for (const pid of pids) {
    if (mine.has(pid)) continue;
    const cwd = cwdOf(pid);
    if (!cwd) continue;
    for (const [dir, branch] of worktrees) {
      if (cwd === dir || cwd.startsWith(`${dir}/`)) live.add(branch);
    }
  }
  return live;
}

function localWorktrees() {
  // A worktree root is a directory whose .git is a file (linked) or dir, and the
  // branch is whatever it has checked out. Detached heads count as no branch.
  const out = [];
  const base = path.join(os.homedir(), 'dev');
  let entries = [];
  try {
    entries = fs.readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return out;
  }
  for (const name of entries) {
    const dir = path.join(base, name);
    if (!fs.existsSync(path.join(dir, '.git'))) continue;
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir });
    if (branch && branch !== 'HEAD') out.push([dir, branch]);
  }
  return out;
}

async function main() {
  git(['fetch', '-q', 'origin']);
  const beats = readBeats();
  const liveBeatBranches = new Set(
    Object.entries(beats).filter(([, r]) => isLive(r)).map(([, r]) => r.branch).filter(Boolean),
  );
  const worktrees = localWorktrees();
  const liveProcBranches = liveBranchesFromProcesses(worktrees);

  const prs = JSON.parse(gh(['pr', 'list', '--state', 'open', '--json', 'number,title,headRefName,updatedAt,createdAt,mergeable,mergeStateStatus']) || '[]');
  const closedByNumber = new Set();
  try {
    const closed = JSON.parse(gh(['pr', 'list', '--state', 'closed', '--limit', '100', '--json', 'number,headRefName,mergedAt,closedAt']) || '[]');
    for (const p of closed) {
      if (p.mergedAt) closedByNumber.add(`${p.number}:${p.headRefName}`);
    }
  } catch { /* closed-list is best-effort */ }

  const report = { at: new Date().toISOString(), dry: !APPLY, tier1: [], tier2: [], tier3: [], kept: [], skipped: [] };

  // Resolve each open PR's head age from the remote branch (not from PR updatedAt,
  // which moves on comments and label changes — activity theatre, not work).
  for (const pr of (Array.isArray(prs) ? prs : [])) {
    const branch = pr.headRefName || '';
    if (!branch || PROTECTED.has(branch)) {
      report.skipped.push({ pr: pr.number, reason: 'protected or missing branch' });
      continue;
    }
    const tip = git(['rev-parse', `origin/${branch}`]) || '';
    const headISO = tip ? git(['log', '-1', '--format=%cI', tip]) : '';
    const tipInMain = tip ? execOk(['merge-base', '--is-ancestor', tip, 'origin/main']) : false;
    const checks = JSON.parse(gh(['pr', 'view', String(pr.number), '--json', 'statusCheckRollup,mergeable,mergeStateStatus']) || '{}');
    const conclusions = (checks.statusCheckRollup || []).map((c) => c.conclusion).filter(Boolean);
    const gateFailing = conclusions.some((c) => c === 'FAILURE' || c === 'TIMED_OUT' || c === 'CANCELLED');
    const mergedState = checks.mergeable === 'MERGEABLE' && checks.mergeStateStatus === 'CLEAN' ? 'clean' : (checks.mergeable || checks.mergeStateStatus || '');
    const decision = tierForPR({
      merged: closedByNumber.has(`${pr.number}:${branch}`),
      tipInMain,
      headAgeH: hoursSince(headISO),
      prAgeDays: (Date.now() - new Date(pr.createdAt).getTime()) / 86400000,
      heartbeatLive: [...liveBeatBranches].some((b) => b === branch || slug(b) === slug(branch)),
      processLive: liveProcBranches.has(branch),
      declaredAbandoned: DECLARED,
      gateFailing,
      dirty: /DIRTY|CONFLICTING|BLOCKED/i.test(mergedState),
    });

    const row = { pr: pr.number, branch, title: (pr.title || '').slice(0, 80), decision, headAgeH: Math.round(hoursSince(headISO)), gateFailing, mergedState };
    if (ONLY_TIER && decision !== `tier${ONLY_TIER}` && decision !== 'keep') {
      report.skipped.push({ ...row, reason: `tier filter ${ONLY_TIER}` });
      continue;
    }
    if (decision === 'tier1') {
      report.tier1.push(row);
      audit({ tier: 1, action: 'delete-branch', branch, pr: pr.number, tip, reason: 'content in main' });
      if (APPLY && (!ONLY_TIER || ONLY_TIER === '1')) {
        const out = gh(['api', '-X', 'DELETE', `repos/:owner/:repo/git/refs/heads/${branch}`]);
        audit({ tier: 1, action: 'deleted-branch', branch, pr: pr.number, result: String(out).slice(0, 120) });
      }
    } else if (decision === 'tier2') {
      report.tier2.push(row);
      audit({ tier: 2, action: 'close-pr', branch, pr: pr.number, tip, declaredAbandoned: DECLARED, reason: `abandoned: head ${Math.round(hoursSince(headISO))}h old, gates failing=${gateFailing}, state=${mergedState}` });
      if (APPLY && (!ONLY_TIER || ONLY_TIER === '2')) {
        gh(['pr', 'comment', String(pr.number), '--body', [
          'Closed by the agent-hygiene cleaner (plan/AGENT_HYGIENE.md, Tier 2).',
          '',
          `Why: no commits to \`${branch}\` in 48h+, no live heartbeat or process behind it, and the PR cannot merge (${mergedState || 'failing gates'}).`,
          'The branch is kept for 7 days and then reaped; the commits stay in git. Reopen if this is still wanted — a fresh heartbeat vetoes any future run.',
          '',
          `Audit: \`~/.local/state/bot-host/agent-hygiene/audit.jsonl\``,
        ].join('\n')]);
        gh(['pr', 'close', String(pr.number)]);
        audit({ tier: 2, action: 'closed-pr', branch, pr: pr.number });
      }
    } else {
      report.kept.push(row);
    }
  }

  // Tier 3: remote branches with no open PR left, old and ownerless.
  const openHeads = new Set((Array.isArray(prs) ? prs : []).map((p) => p.headRefName).filter(Boolean));
  let remote = [];
  try {
    remote = execFileSync('git', ['ls-remote', '--heads', 'origin'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch { /* network failure means report-only */ }
  for (const line of remote) {
    const m = line.match(/refs\/heads\/(.+)$/);
    const branch = m ? m[1] : '';
    if (!branch || PROTECTED.has(branch) || openHeads.has(branch)) continue;
    const tip = git(['rev-parse', `origin/${branch}`]) || '';
    if (!tip) continue;
    const tipInMain = !!execOk(['merge-base', '--is-ancestor', tip, 'origin/main']);
    const headISO = git(['log', '-1', '--format=%cI', tip]);
    const decision = tierForBranch({
      tipInMain,
      lastAgeH: hoursSince(headISO),
      heartbeatLive: [...liveBeatBranches].some((b) => b === branch || slug(b) === slug(branch)),
      processLive: liveProcBranches.has(branch),
      // Without a closed-PR timestamp we use branch age alone: only reap what is
      // both ownerless and old enough that no reasonable grace is cut short.
      closedGraceExpired: true,
    });
    if (decision === 'tier1') {
      report.tier1.push({ branch, decision, reason: 'tip in main, no open PR' });
      audit({ tier: 1, action: 'delete-branch', branch, tip, reason: 'tip in main, no open PR' });
      if (APPLY && (!ONLY_TIER || ONLY_TIER === '1')) {
        gh(['api', '-X', 'DELETE', `repos/:owner/:repo/git/refs/heads/${branch}`]);
        audit({ tier: 1, action: 'deleted-branch', branch });
      }
    } else if (decision === 'tier3') {
      report.tier3.push({ branch, decision, headAgeH: Math.round(hoursSince(headISO)) });
      audit({ tier: 3, action: 'delete-branch', branch, tip, reason: `ownerless ${Math.round(hoursSince(headISO))}h, no open PR` });
      if (APPLY && (!ONLY_TIER || ONLY_TIER === '3')) {
        gh(['api', '-X', 'DELETE', `repos/:owner/:repo/git/refs/heads/${branch}`]);
        audit({ tier: 3, action: 'deleted-branch', branch });
      }
    }
  }

  if (JSON_OUT) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const show = (label, rows) => {
      console.log(`\n  ${label} (${rows.length})`);
      for (const r of rows.slice(0, 30)) {
        console.log(`    ${r.pr ? `#${r.pr} ` : ''}${r.branch}${r.title ? ` — ${r.title}` : ''}${r.reason ? ` (${r.reason})` : ''}${r.headAgeH !== undefined ? ` [head ${r.headAgeH}h]` : ''}`);
      }
      if (rows.length > 30) console.log(`    … and ${rows.length - 30} more`);
    };
    console.log(`\n  agent hygiene — ${report.dry ? 'DRY RUN' : 'APPLIED'} — ${report.at}`);
    show('TIER 1 delete branch (content in main)', report.tier1);
    show('TIER 2 close PR (abandoned)', report.tier2);
    show('TIER 3 reap ownerless branch', report.tier3);
    show('KEPT (live or fresh)', report.kept);
    show('SKIPPED', report.skipped);
    console.log(`\n  audit: ~/.local/state/bot-host/agent-hygiene/audit.jsonl\n`);
  }
}

function execOk(args) {
  try {
    execFileSync('git', args, { stdio: 'ignore', timeout: 60000 });
    return true;
  } catch {
    return false;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((err) => {
  console.error(`agent-hygiene: ${err && err.stack ? err.stack : err}`);
  process.exitCode = 2;
});
