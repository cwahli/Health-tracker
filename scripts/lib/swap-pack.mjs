/**
 * Guard 9: the files of a conversation travel with it.
 *
 * A swap hands the *turn* to another machine, but the files that turn is
 * about — the ones this conversation has been editing — may only be dirty
 * here. On a canary (the first turn on a host) the sender packs the changed
 * files of the workspace, ships them through the relay, and the worker
 * verifies every hash before it writes a single byte.
 *
 * Rules that keep this safe:
 *   - only files git reports as changed (or the whole tree, untracked repos);
 *   - bounded: PACK_MAX_FILES / PACK_MAX_BYTES, refused by name when exceeded;
 *   - the worker re-hashes each file against the manifest before applying it;
 *   - a path that would leave the workspace (`..`, absolute) is refused;
 *   - nothing is applied if any file fails its hash.
 *
 * Store: ~/.hermes/packs/<packId>.json
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const PACK_MAX_FILES = 400;
export const PACK_MAX_BYTES = 8 * 1024 * 1024;
export const PACK_BODY_MAX = 16 * 1024 * 1024;
const IGNORED_DIRS = new Set(['node_modules', '.git', '.hermes', 'dist', 'build', 'out', '.next', '.cache', 'coverage', 'playwright-report', 'test-results']);
const MAX_DEPTH = 8;

export function packPath(id, home = os.homedir()) {
  const safe = String(id || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe) return null;
  return path.join(home, '.hermes', 'packs', `${safe}.json`);
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function safeRelativePath(p) {
  const raw = String(p || '').trim();
  if (!raw || path.isAbsolute(raw)) return null;
  const norm = path.normalize(raw);
  if (norm.startsWith('..') || norm === '..') return null;
  if (path.isAbsolute(norm)) return null;
  return norm.split(path.sep).join('/');
}

/** Files git says are not committed — exactly what a swap would otherwise lose. */
export function changedFiles(root, { exec = execFileSync } = {}) {
  try {
    const out = String(exec('git', ['-C', root, 'status', '--porcelain=v1', '-z'], { encoding: 'utf8' }));
    const entries = out.split('\0');
    const files = [];
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      if (!entry) continue;
      const xy = entry.slice(0, 2);
      const rest = entry.slice(2).trim();
      // A rename or copy is "old\0new": the destination is the next entry.
      if (xy.includes('R') || xy.includes('C')) {
        if (rest) files.push(rest);
        const dest = entries[i + 1];
        i += 1;
        if (dest) files.push(dest);
        continue;
      }
      if (rest) files.push(rest);
    }
    return { ok: true, files: [...new Set(files)] };
  } catch (err) {
    return { ok: false, files: [], reason: String(err?.message || err).split('\n')[0] };
  }
}

function walk(root, { dir = root, depth = 0, out = [] } = {}) {
  if (depth > MAX_DEPTH || out.length > PACK_MAX_FILES * 2) return out;
  let names = [];
  try {
    names = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of names) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      walk(root, { dir: path.join(dir, entry.name), depth: depth + 1, out });
    } else if (entry.isFile()) {
      out.push(path.relative(root, path.join(dir, entry.name)));
    }
  }
  return out;
}

/**
 * Build the manifest: which files, what hash, how big. Returns a named
 * refusal instead of a partial pack when the workspace is too big to ship.
 */
export function buildPack(root, { id = '', home = os.homedir(), now = Date.now(), maxFiles = PACK_MAX_FILES, maxBytes = PACK_MAX_BYTES, exec = execFileSync } = {}) {
  const base = String(root || '').trim();
  if (!base) return { ok: false, reason: 'no workspace given' };
  if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) return { ok: false, reason: `workspace ${base} is not a directory` };

  const fromGit = changedFiles(base, { exec });
  const candidates = fromGit.ok && fromGit.files.length ? fromGit.files : walk(base);
  const files = [];
  let totalBytes = 0;
  for (const rel of candidates) {
    const safe = safeRelativePath(rel);
    if (!safe) return { ok: false, reason: `refusing a path that leaves the workspace: ${rel}` };
    const abs = path.join(base, safe);
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch {
      continue; // deleted between git status and here
    }
    if (!stat.isFile()) continue;
    if (files.length >= maxFiles) return { ok: false, reason: `too many changed files (${files.length}+ > ${maxFiles}): split the work or commit it` };
    if (totalBytes + stat.size > maxBytes) return { ok: false, reason: `pack would be ${totalBytes + stat.size} bytes > ${maxBytes}` };
    totalBytes += stat.size;
    files.push({ path: safe, sha256: sha256(fs.readFileSync(abs)), bytes: stat.size, mode: stat.mode & 0o777 });
  }
  const packId = String(id || `p${now.toString(36)}${Math.floor(Math.random() * 0xffff).toString(16)}`);
  return {
    ok: true,
    id: packId,
    root: base,
    source: fromGit.ok ? 'git' : 'walk',
    files,
    totalBytes,
    createdAt: new Date(now).toISOString(),
  };
}

/** The manifest with the file contents, base64, ready to PUT to the relay. */
export function packWithContents(manifest) {
  const root = manifest?.root;
  const files = [];
  for (const f of manifest?.files || []) {
    const abs = path.join(root, f.path);
    const buf = fs.readFileSync(abs);
    if (sha256(buf) !== f.sha256) return { ok: false, reason: `${f.path} changed while the pack was built` };
    files.push({ path: f.path, sha256: f.sha256, bytes: f.bytes, mode: f.mode, data: buf.toString('base64') });
  }
  return { ok: true, id: manifest.id, source: manifest.source, createdAt: manifest.createdAt, files, totalBytes: manifest.totalBytes };
}

/** Arriving side: every file must match its hash before anything is applied. */
export function verifyPack(payload) {
  const files = Array.isArray(payload?.files) ? payload.files : [];
  if (!files.length) return { ok: false, reason: 'pack has no files', mismatched: [] };
  const mismatched = [];
  for (const f of files) {
    const buf = Buffer.from(String(f.data || ''), 'base64');
    if (sha256(buf) !== String(f.sha256 || '')) mismatched.push(String(f.path || '?'));
  }
  if (mismatched.length) return { ok: false, reason: `${mismatched.length} file(s) failed their hash: ${mismatched.slice(0, 3).join(', ')}`, mismatched };
  return { ok: true, reason: `${files.length} file(s) verified`, mismatched: [] };
}

/** Apply a verified pack into the workspace. Nothing partial: verify first. */
export function applyPack(root, payload) {
  const verified = verifyPack(payload);
  if (!verified.ok) return { ok: false, applied: [], reason: verified.reason };
  const base = String(root || '').trim();
  if (!base || !fs.existsSync(base)) return { ok: false, applied: [], reason: `workspace ${base} does not exist here` };
  const applied = [];
  for (const f of payload.files) {
    const safe = safeRelativePath(f.path);
    if (!safe) return { ok: false, applied, reason: `refusing a path that leaves the workspace: ${f.path}` };
    const abs = path.join(base, safe);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, Buffer.from(String(f.data || ''), 'base64'), typeof f.mode === 'number' ? { mode: f.mode & 0o777 } : undefined);
    applied.push(safe);
  }
  return { ok: true, applied, reason: `${applied.length} file(s) applied` };
}

/** The relay stores only packs whose hashes all check out. */
export function savePack(payload, { home = os.homedir() } = {}) {
  const id = String(payload?.id || '');
  if (!id) return { ok: false, reason: 'pack has no id' };
  const file = packPath(id, home);
  if (!file) return { ok: false, reason: 'bad pack id' };
  const verified = verifyPack(payload);
  if (!verified.ok) return { ok: false, reason: verified.reason };
  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body) > PACK_BODY_MAX) return { ok: false, reason: `pack is ${Buffer.byteLength(body)} bytes > ${PACK_BODY_MAX}` };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, 'utf8');
  return { ok: true, id, bytes: Buffer.byteLength(body), files: payload.files.length };
}

export function loadPack(id, { home = os.homedir() } = {}) {
  const file = packPath(id, home);
  if (!file) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}
