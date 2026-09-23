/**
 * Per-file advisory locks for concurrent coding agents.
 *
 * Replaces the old single global dispatch_lock ("repo is busy").
 * Chat is NEVER gated: only the coder-run moment claims files.
 * A second agent still starts, is told which files are owned, and routes
 * around them. Same-file overlap = warning naming files, never refusal.
 *
 * Store: ~/.hermes/file_locks/<encoded-path>.json
 *   { file, bugId, tool, pid, area, worktree, startedAt, heartbeat, expiresAt }
 * A claim is stale (auto-reclaimable) when pid is dead or heartbeat > TTL.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TTL_MS = 20 * 60 * 1000;

export function locksDir(home = os.homedir()) {
  return path.join(home, '.hermes', 'file_locks');
}

/** Normalize a repo-relative file path; null when not claimable. */
export function normalizeFile(raw) {
  let p = String(raw ?? '').trim();
  if (!p) return null;
  p = p.replace(/^(\.\/|\/)+/, '').replace(/^[`"'([]+/, '').replace(/[:;,)"'\]`]+$/, '');
  if (!p || p.startsWith('.') || p.includes('..') || path.isAbsolute(p)) return null;
  if (!/[A-Za-z0-9_][A-Za-z0-9_./-]*\.[A-Za-z0-9]+$/.test(p)) return null;
  if (p.length > 256) return null;
  return p;
}

/** Scrape repo-relative file paths out of free-form task text. */
export function extractFiles(text, { cap = 25 } = {}) {
  const out = [];
  const seen = new Set();
  const re = /(?:^|[\s("'`\[])([A-Za-z0-9_][A-Za-z0-9_./-]*\.[A-Za-z0-9]{1,5})(?=[\s)",;:'\].]|$)/g;
  let m;
  while ((m = re.exec(String(text ?? ''))) !== null && out.length < cap) {
    const n = normalizeFile(m[1]);
    if (n && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

function lockPath(file, dir) {
  return path.join(dir, `${encodeURIComponent(file)}.json`);
}

export function isAlive(pid) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch {
    return false;
  }
}

export function readClaim(file, dir = locksDir()) {
  try {
    return JSON.parse(fs.readFileSync(lockPath(file, dir), 'utf8'));
  } catch {
    return null;
  }
}

export function isStale(claim, now = Date.now()) {
  if (!claim) return true;
  if (!isAlive(claim.pid)) return true;
  if (Number(claim.expiresAt) > 0 && Number(claim.expiresAt) <= now) return true;
  return false;
}

export function claimFiles(files, owner, { dir = locksDir(), now = Date.now() } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const claimed = [];
  const conflicts = [];
  for (const raw of files || []) {
    const file = normalizeFile(raw);
    if (!file) continue;
    const prev = readClaim(file, dir);
    if (prev && !isStale(prev, now) && prev.bugId && prev.bugId !== owner.bugId) {
      conflicts.push({ file, holder: prev });
      continue;
    }
    const claim = {
      file,
      bugId: owner.bugId || 'unknown',
      tool: owner.tool || 'unknown',
      pid: Number(owner.pid) || process.pid,
      area: owner.area || '',
      worktree: owner.worktree || '',
      startedAt: prev?.startedAt || now,
      heartbeat: now,
      expiresAt: now + TTL_MS,
    };
    fs.writeFileSync(lockPath(file, dir), `${JSON.stringify(claim, null, 2)}\n`);
    claimed.push(file);
  }
  return { claimed, conflicts };
}

export function refreshFiles(files, bugId, { dir = locksDir(), now = Date.now() } = {}) {
  const refreshed = [];
  for (const raw of files || []) {
    const file = normalizeFile(raw);
    if (!file) continue;
    const prev = readClaim(file, dir);
    if (prev && prev.bugId === bugId) {
      prev.heartbeat = now;
      prev.expiresAt = now + TTL_MS;
      fs.writeFileSync(lockPath(file, dir), `${JSON.stringify(prev, null, 2)}\n`);
      refreshed.push(file);
    }
  }
  return refreshed;
}

export function releaseFiles(files, bugId = null, { dir = locksDir() } = {}) {
  let released = 0;
  for (const raw of files || []) {
    const file = normalizeFile(raw);
    if (!file) continue;
    const prev = readClaim(file, dir);
    if (prev && (bugId === null || prev.bugId === bugId)) {
      try {
        fs.unlinkSync(lockPath(file, dir));
        released += 1;
      } catch { /* already gone */ }
    }
  }
  return released;
}

export function releaseByBug(bugId, { dir = locksDir() } = {}) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return 0;
  }
  let released = 0;
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    try {
      const claim = JSON.parse(fs.readFileSync(path.join(dir, entry), 'utf8'));
      if (claim && claim.bugId === bugId) {
        fs.unlinkSync(path.join(dir, entry));
        released += 1;
      }
    } catch {
      try {
        fs.unlinkSync(path.join(dir, entry));
      } catch { /* ignore */ }
    }
  }
  return released;
}

export function listLocks({ dir = locksDir(), now = Date.now(), prune = true } = {}) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const full = path.join(dir, entry);
    let claim = null;
    try {
      claim = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch {
      try {
        fs.unlinkSync(full);
      } catch { /* ignore */ }
      continue;
    }
    if (isStale(claim, now)) {
      if (prune) {
        try {
          fs.unlinkSync(full);
        } catch { /* ignore */ }
      }
      continue;
    }
    out.push(claim);
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

function printUsage() {
  console.log(`usage: file-locks.mjs <claim|refresh|release|release-bug|check|list|prune> [options]`);
}

async function cli(argv) {
  const [cmd, ...rest] = argv;
  const opts = {};
  for (const a of rest) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) opts[m[1]] = m[2];
    else if (a.startsWith('--')) opts[a.slice(2)] = '1';
  }
  const files = String(opts.files || '').split(',').map((s) => s.trim()).filter(Boolean);
  const bugId = opts['bug-id'] || opts.bugId;
  switch (cmd) {
    case 'claim':
      console.log(JSON.stringify(claimFiles(files, {
        bugId, tool: opts.tool, pid: opts.pid, area: opts.area, worktree: opts.worktree,
      })));
      break;
    case 'refresh':
      console.log(JSON.stringify({ refreshed: refreshFiles(files, bugId) }));
      break;
    case 'release':
      console.log(JSON.stringify({ released: releaseFiles(files, bugId) }));
      break;
    case 'release-bug':
      console.log(JSON.stringify({ released: releaseByBug(bugId) }));
      break;
    case 'check': {
      const live = listLocks({ prune: false });
      const conflicts = [];
      for (const f of files) {
        const n = normalizeFile(f);
        const hit = n && live.find((c) => c.file === n);
        if (hit) conflicts.push({ file: n, holder: hit });
      }
      console.log(JSON.stringify({ conflicts }));
      process.exitCode = conflicts.length ? 2 : 0;
      break;
    }
    case 'list':
      console.log(JSON.stringify(listLocks(), null, 2));
      break;
    case 'prune': {
      const before = listLocks({ prune: false }).length;
      const live = listLocks({ prune: true }).length;
      console.log(JSON.stringify({ pruned: before - live, live }));
      break;
    }
    default:
      printUsage();
      process.exitCode = 2;
  }
}

const invokedAs = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedAs === fileURLToPath(import.meta.url)) {
  cli(process.argv.slice(2)).catch((err) => {
    console.error(`file-locks: ${err.message}`);
    process.exit(1);
  });
}

