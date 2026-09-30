#!/usr/bin/env node
/**
 * no-undo — a merge may not silently erase landed work.
 *
 * Measured history (2026-09): a re-pushed branch re-opened its auto-PR and
 * re-added a file a later PR had deleted (#143); five empty no-op squashes
 * landed work that was already on main; #371 hand-reverted a bot-host.mjs
 * hunk to dodge an overlapping PR. Every one entered through the merge, so
 * this judges the merge range — the same place the identity gate judges.
 *
 * Rule: a deleted line, a deleted file, or a resurrected file whose owner is
 * a LANDED commit (an ancestor of --landed-ref, i.e. not the change's own
 * work) fails, unless the judged body declares it:
 *
 *   Reverts: <sha> — reason        covers lines/files owned by that commit
 *   Resurrects: <path> — reason    covers re-adding a file main had deleted
 *
 * Declare-only, by decision: the declaration plus the permanent record is the
 * control. Approval would re-insert a human into every refactor.
 *
 * Ownership is deliberately narrow to stay false-positive-free:
 *  - blank lines are never judged;
 *  - a deleted line is judged only when base history shows EXACTLY the
 *    commits that touched it resolving to one landed adder (common lines
 *    like `}` that dozens of commits touched are ambiguous — skipped, and
 *    reported as skipped with -v);
 *  - lines whose owner cannot be found are skipped, not failed;
 *  - a file the change both deletes and re-adds inside its own range is
 *    own churn, not an undo;
 *  - rewording is not undo: only owners landed within --window commits of
 *    the landed ref are judged (default 150). A line from last month being
 *    rewritten is normal editing; a line from yesterday's still-open
 *    workstream disappearing is the collision this exists for. File-level
 *    delete/resurrect has no window — deleting or reviving a whole file is
 *    always significant enough to declare.
 *
 * Usage:
 *   node scripts/no-undo.mjs --range <base>..<head> --landed-ref <ref>
 *     [--body-file <file>] [--repo <dir>] [-v]
 *
 * Exit 0: clean (or nothing changed). Exit 1: undeclared undo, with the
 * owning commit, its trailer, and the two valid moves printed. Exit 2:
 * usage / git failure.
 */

import { execFileSync } from 'node:child_process';

export function parseDeclarations(body) {
  const reverts = [];
  const resurrects = [];
  for (const raw of String(body || '').split('\n')) {
    const line = raw.trim();
    let m = line.match(/^Reverts:\s*([0-9a-fA-F]{6,40})\b/);
    if (m) {
      reverts.push(m[1].toLowerCase());
      continue;
    }
    m = line.match(/^Resurrects:\s*(\S+)/);
    if (m) resurrects.push(m[1].replace(/^\.\//, '').replace(/,+$/, ''));
  }
  return { reverts, resurrects };
}

export function git(repo, ...argv) {
  return execFileSync('git', argv, {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function ownSet(repo, base, head) {
  try {
    return new Set(git(repo, 'rev-list', `${base}..${head}`).split('\n').filter(Boolean));
  } catch {
    return new Set();
  }
}

function trailerOf(repo, sha) {
  try {
    const body = git(repo, 'log', '-1', '--format=%B', sha);
    const line = body.split('\n').find((l) => /^(Author|Agent): /.test(l));
    return line ? line.trim() : '(no trailer)';
  } catch {
    return '(unreadable)';
  }
}

function subjectOf(repo, sha) {
  try {
    return git(repo, 'log', '-1', '--format=%s', sha).slice(0, 80);
  } catch {
    return '(unreadable)';
  }
}

/** Deletions in the range: [{ file, line }], renames followed. */
export function deletedLines(repo, base, head) {
  let out;
  try {
    out = git(repo, 'diff', '-U0', '-M', `${base}..${head}`, '--');
  } catch {
    return [];
  }
  const dels = [];
  let file = null;
  for (const raw of out.split('\n')) {
    const m = raw.match(/^\+\+\+ b\/(.+)$/);
    if (m) {
      file = m[1] === '/dev/null' ? null : m[1];
      continue;
    }
    if (file && raw.startsWith('-') && !raw.startsWith('---')) {
      const line = raw.slice(1);
      if (line.trim() !== '') dels.push({ file, line });
    }
  }
  return dels;
}

/** { added: [paths], deleted: [paths] } in the range, renames followed. */
export function changedFiles(repo, base, head) {
  const added = [];
  const deleted = [];
  let out;
  try {
    out = git(repo, 'diff', '--name-status', '-M', `${base}..${head}`, '--');
  } catch {
    return { added, deleted };
  }
  for (const raw of out.split('\n')) {
    const m = raw.match(/^([ADM])\t(.+)$/);
    if (!m) continue;
    // Rename "R100\told\tnew": the content survives, neither an add of a
    // stranger nor a delete of landed work.
    if (m[1] === 'A') added.push(m[2]);
    else if (m[1] === 'D') deleted.push(m[2]);
  }
  return { added, deleted };
}

/**
 * The landed commit that added `line` to `file`, or null when ownership is
 * ambiguous (too many touches), unknown, or the change's own work.
 */
export function lineOwner(repo, file, line, landedRef, own) {
  let hits;
  try {
    hits = git(repo, 'log', '--format=%H', '-S', line, landedRef, '--', file)
      .split('\n')
      .filter(Boolean)
      .slice(0, 9);
  } catch {
    return { owner: null, reason: 'untraceable' };
  }
  if (hits.length === 0) return { owner: null, reason: 'untraceable' };
  if (hits.length > 8) return { owner: null, reason: 'ambiguous' };
  for (const sha of hits) {
    // Did this commit ADD the line? -S fires on add and remove alike.
    let added = false;
    try {
      const show = execFileSync('git', ['show', sha, '--format=', '--', file], {
        cwd: repo,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      added = show.split('\n').some((l) => l === `+${line}`);
    } catch {
      continue;
    }
    if (!added) continue;
    if (own.has(sha)) return { owner: null, reason: 'own' };
    return { owner: sha, reason: 'landed' };
  }
  return { owner: null, reason: 'untraceable' };
}

/** Newest landed commit that added `path` (diff-filter=A), or null. */
export function fileAdder(repo, path, landedRef) {
  try {
    const out = git(repo, 'log', '--format=%H', '--diff-filter=A', landedRef, '--', path);
    return out.split('\n').filter(Boolean)[0] || null;
  } catch {
    return null;
  }
}

/** Newest landed commit that deleted `path` (diff-filter=D), or null. */
export function fileDeleter(repo, path, landedRef) {
  try {
    const out = git(repo, 'log', '--format=%H', '--diff-filter=D', landedRef, '--', path);
    return out.split('\n').filter(Boolean)[0] || null;
  } catch {
    return null;
  }
}

/** Commits between owner (exclusive) and ref (inclusive), or Infinity. */
export function commitDistance(repo, owner, ref) {
  try {
    return Number(git(repo, 'rev-list', '--count', `${owner}..${ref}`));
  } catch {
    return Infinity;
  }
}

export function checkRange(repo, base, head, landedRef, body, opts = {}) {
  const verbose = !!opts.verbose;
  const window = opts.window === undefined ? 150 : Number(opts.window);
  const { reverts, resurrects } = parseDeclarations(body);
  const own = ownSet(repo, base, head);
  const violations = [];
  const skipped = [];
  const covers = (sha) => reverts.some((d) => sha.startsWith(d) || d.startsWith(sha));

  for (const { file, line } of deletedLines(repo, base, head)) {
    const { owner, reason } = lineOwner(repo, file, line, landedRef, own);
    if (!owner) {
      if (verbose) skipped.push(`${file}: ${reason}: ${line.slice(0, 60)}`);
      continue;
    }
    if (commitDistance(repo, owner, landedRef) > window) {
      if (verbose) skipped.push(`${file}: older-than-window: ${line.slice(0, 60)}`);
      continue;
    }
    if (covers(owner)) continue;
    violations.push({
      kind: 'line',
      file,
      line: line.slice(0, 120),
      owner,
      subject: subjectOf(repo, owner),
      trailer: trailerOf(repo, owner),
    });
  }

  const { added, deleted } = changedFiles(repo, base, head);
  for (const path of deleted) {
    const adder = fileAdder(repo, path, landedRef);
    if (!adder || own.has(adder)) continue;
    if (covers(adder)) continue;
    violations.push({
      kind: 'file-deleted',
      file: path,
      line: '',
      owner: adder,
      subject: subjectOf(repo, adder),
      trailer: trailerOf(repo, adder),
    });
  }
  for (const path of added) {
    const deleter = fileDeleter(repo, path, landedRef);
    if (!deleter || own.has(deleter)) continue;
    const norm = path.replace(/^\.\//, '');
    if (resurrects.includes(norm)) continue;
    violations.push({
      kind: 'file-resurrected',
      file: path,
      line: '',
      owner: deleter,
      subject: subjectOf(repo, deleter),
      trailer: trailerOf(repo, deleter),
    });
  }

  return { violations, skipped };
}
