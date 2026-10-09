/**
 * One worktree per coder, cut from current origin/main.
 *
 * A dirty shared checkout is not a lock. An open PR does not reserve the
 * repo. A branch whose remote is gone is not unfinished work. `close` removes
 * a worktree only when it is clean, not a named hold, not main / master /
 * the primary checkout / ~/dev/status-all, and the commit is an ancestor of
 * origin/main or the PR was squash-merged. Hub files stay on the per-file
 * locks in scripts/lib/file-locks.mjs.
 */

import { execFileSync } from 'node:child_process';

export const KEEPER_BRANCHES = [
  'agent/bunny-two-pools',
  'agent/bot-host-r14-wip',
  'agent/sheet-guard-wip',
  'journey/fleet-miniapp',
  'agent/health-room-item6-handoff',
  'agent/model-pools',
  'agent/dispatch-repro-47',
];

export const HUB_FILES = [
  'scripts/bot-host.mjs',
  'scripts/lib/free-lanes.mjs',
  'scripts/lib/work-session.mjs',
];

export function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

export function gitOk(repo, args) {
  try {
    git(repo, args);
    return true;
  } catch {
    return false;
  }
}

export function slugToBranch(slug) {
  const raw = String(slug || '').trim().replace(/^agent\//, '');
  if (!/^[a-z0-9][a-z0-9-]{0,48}$/.test(raw)) {
    throw new Error('slug must be 1–49 chars of lowercase letters, numbers, and dashes');
  }
  return `agent/${raw}`;
}

export function classifyWorktree(entry) {
  const branch = String(entry?.branch || '');
  const worktreePath = String(entry?.path || '').replace(/\/+$/, '');
  const base = worktreePath.split('/').pop();
  const shared = Boolean(entry?.primary)
    || Boolean(entry?.statusAll)
    || base === 'status-all'
    || branch === 'main'
    || branch === 'master';
  if (shared) {
    return { action: 'keep', kind: 'protected', why: 'main, primary checkout, or status-all' };
  }
  if (KEEPER_BRANCHES.includes(branch)) {
    return { action: 'keep', kind: 'held', why: 'named hold' };
  }
  if (entry?.dirty) {
    return { action: 'leave', kind: 'dirty-leave', why: 'dirty tree is not a lock and is not removed' };
  }
  if (entry?.ancestor || entry?.mergedSquash) {
    return {
      action: 'close',
      kind: 'landed',
      why: entry.ancestor ? 'clean ancestor of origin/main' : 'clean and the PR was squash-merged',
    };
  }
  if (entry?.upstreamGone) {
    return {
      action: 'leave',
      kind: 'gone-not-unfinished',
      why: 'remote is gone; not unfinished work and not removed',
    };
  }
  return {
    action: 'leave',
    kind: 'open',
    why: 'not on main; an open PR does not reserve the repo',
  };
}

export function guardCheckout({ branch, dirty, primary, statusAll, path }) {
  const base = String(path || '').replace(/\/+$/, '').split('/').pop();
  const shared = Boolean(primary)
    || Boolean(statusAll)
    || base === 'status-all'
    || branch === 'main'
    || branch === 'master';
  if (!shared) return { ok: true, why: 'feature worktree' };
  if (dirty) {
    return {
      ok: false,
      why: 'This shared checkout is dirty. A dirty tree is not a lock. Run: node scripts/agent-worktree.mjs new <slug>',
    };
  }
  return {
    ok: false,
    why: 'This is the shared main checkout. Run: node scripts/agent-worktree.mjs new <slug>',
  };
}

export function parseWorktreePorcelain(text) {
  const rows = [];
  let cur = null;
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) {
      if (cur?.path) rows.push(cur);
      cur = null;
      continue;
    }
    if (!cur) cur = { path: '', head: '', branch: '', detached: false };
    if (line.startsWith('worktree ')) cur.path = line.slice('worktree '.length);
    else if (line.startsWith('HEAD ')) cur.head = line.slice('HEAD '.length);
    else if (line.startsWith('branch ')) {
      cur.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    } else if (line === 'detached') cur.detached = true;
  }
  if (cur?.path) rows.push(cur);
  return rows;
}

export function inspectWorktrees(repo, { isMerged = () => false } = {}) {
  const rows = parseWorktreePorcelain(git(repo, ['worktree', 'list', '--porcelain']));
  const primary = rows[0]?.path || '';
  const hasOrigin = gitOk(repo, ['rev-parse', '--verify', 'origin/main']);
  return rows.map((row) => {
    const porcelain = git(row.path, ['status', '--porcelain']);
    const dirty = porcelain.length > 0;
    const ancestor = Boolean(hasOrigin && row.head && gitOk(repo, ['merge-base', '--is-ancestor', row.head, 'origin/main']));
    const short = git(row.path, ['status', '-sb']).split('\n')[0] || '';
    const upstreamGone = /\[gone\]/.test(short);
    const statusAll = row.path.replace(/\/+$/, '').endsWith('/status-all');
    const mergedSquash = Boolean(!ancestor && row.branch && isMerged(row.branch));
    const entry = {
      path: row.path,
      head: row.head,
      branch: row.branch || '',
      detached: row.detached,
      dirty,
      ancestor,
      upstreamGone,
      mergedSquash,
      primary: row.path === primary,
      statusAll,
    };
    return { ...entry, ...classifyWorktree(entry) };
  });
}

export function newWorktree(repo, slug, dest, { fetch = true } = {}) {
  const branch = slugToBranch(slug);
  if (fetch) {
    try {
      git(repo, ['fetch', 'origin', 'main']);
    } catch {
      // A local origin/main is enough for tests and for a fetch that cannot run.
    }
  }
  if (!gitOk(repo, ['rev-parse', '--verify', 'origin/main'])) {
    throw new Error('origin/main is missing. Fetch it before creating a worktree.');
  }
  git(repo, ['worktree', 'add', '-b', branch, dest, 'origin/main']);
  return { branch, dest };
}

export function pathsToClose(rows) {
  return (rows || []).filter((row) => row.action === 'close').map((row) => row.path);
}
