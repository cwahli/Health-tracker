/**
 * pm-fleet.mjs — responsibility 1 of the PM role: the fleet projection.
 *
 * WHY A PROJECTION AND NOT A SECOND TRACKER
 * -----------------------------------------
 * The fleet already writes down everything that matters, in four places that
 * were never meant to be read together:
 *
 *   - `specs/active/*.md` frontmatter — what a locked packet says it is doing
 *     (`parseSpec` in `bug-dispatch.mjs` is the one parser; it is reused here,
 *     never re-implemented, so a new frontmatter key cannot come to mean two
 *     different things).
 *   - `bugctl list --json`          — the ticket queue the site and every agent
 *     already read (`flags.blocked_reason` is the explicit block).
 *   - `run-ledger.jsonl`            — the last dispatch outcome per surface
 *     (`run-ledger.mjs` owns the schema and the failure set).
 *   - the agent-heartbeat store     — who is alive right now
 *     (`agent-heartbeat.mjs` owns `isLive`: fresh AND the pid still runs).
 *
 * A PM that kept its own board would be a fifth write and the first one to go
 * stale. So this file WRITES NOTHING. It reads those four and returns one
 * normalised model, which is why the answer can never disagree with the source
 * the operator is looking at.
 *
 * WHAT IS HONEST HERE
 * -------------------
 * The four stores do not join cleanly, and pretending otherwise would invent a
 * fact. The ledger is keyed by surface, the heartbeats by branch, the packets by
 * id. So: lane items carry the ledger's own surface, and a heartbeat attaches to
 * an item only when the item's id appears in the heartbeat's branch name (the
 * `agent/pm-1` convention) — otherwise `live` is `null`, meaning "not linked",
 * not "dead". A lane whose last dispatch failed and which has no live heartbeat
 * is the one thing the ladder acts on.
 */

import { execFileSync as nodeExecFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseSpec } from './bug-dispatch.mjs';
import { isLive } from '../agent-heartbeat.mjs';
import { loadLedger, FAILED_OUTCOMES } from './run-ledger.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..', '..');

/** How long a failed dispatch may sit untouched before it counts as stalled. */
export const DEFAULT_STALL_MS = 30 * 60 * 1000;

/** Packet statuses that mean "not progressing without help". */
export const BLOCKED_STATUSES = new Set(['blocked', 'stalled', 'paused']);

/**
 * Where each source lives.
 *
 * Every path is derived from `home` rather than from `ledgerPath()`'s default,
 * so a caller that pins `home` gets all four sources from that tree. Reading a
 * pinned heartbeat store next to the real home's ledger is how a fixture quietly
 * proves nothing. `RUN_LEDGER` still wins (and `RUN_LEDGER=0` still disables the
 * ledger), because that is the knob `run-ledger.mjs` writes through. `PM_SPECS_DIR`
 * is the only override the projection adds.
 */
export function pmPaths(env = process.env, { root = REPO_ROOT, home = os.homedir() } = {}) {
  const specsOverride = String(env.PM_SPECS_DIR || '').trim();
  const ledgerOverride = String(env.RUN_LEDGER || '').trim();
  return {
    root,
    specsDir: specsOverride || path.join(root, 'specs', 'active'),
    bugctl: path.join(root, 'scripts', 'bugctl.mjs'),
    ledgerPath: ledgerOverride === '0' ? '' : ledgerOverride || path.join(home, '.hermes', 'run-ledger.jsonl'),
    heartbeatDir: path.join(home, '.local', 'state', 'bot-host', 'agent-heartbeat'),
  };
}

/** "4m", "2h", "3d" — short enough for a Telegram line. */
export function humanAge(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return 'unknown';
  const s = Math.floor(n / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** One spec packet → one item. `meta.id` wins; the filename is the fallback. */
export function specItem(md, { fileName = '', mtime = '' } = {}) {
  const meta = parseSpec(md);
  const fallback = String(fileName || '').replace(/\.md$/i, '');
  const id = String(meta.id || fallback).trim();
  const status = String(meta.status || '').trim().toLowerCase();
  const blocked = BLOCKED_STATUSES.has(status);
  return {
    key: `spec:${id}`,
    kind: 'spec',
    id,
    title: String(meta.goal || '').trim() || id,
    state: status || 'unknown',
    owner: '',
    blocked,
    blockedReason: blocked ? `packet status=${status}` : '',
    lastOutcome: '',
    lastActivityAt: mtime || '',
    live: null,
    branch: '',
    source: 'specs/active',
  };
}

/** Read every packet in a directory. A missing directory is an empty fleet, not an error. */
export function readSpecDir(dir) {
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return { items: [], dir, ok: false, reason: `no packet directory at ${dir}` };
  }
  const items = [];
  for (const name of names.filter((f) => f.toLowerCase().endsWith('.md')).sort()) {
    const full = path.join(dir, name);
    try {
      const md = fs.readFileSync(full, 'utf8');
      const mtime = fs.statSync(full).mtime.toISOString();
      items.push(specItem(md, { fileName: name, mtime }));
    } catch {
      // An unreadable packet is not a fleet fact; skip it rather than abort.
    }
  }
  return { items, dir, ok: true, reason: '' };
}

/** Ticket rows (the `rows` array from `bugctl list --json`) → items. */
export function bugItems(rows) {
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const tag = String(r?.tag_id || r?.public_n || r?.id || '').trim();
    if (!tag) continue;
    const flags = r?.flags || {};
    const state = String(r?.state || 'unknown').trim();
    const id = r?.public_n !== undefined && r?.public_n !== null && r?.public_n !== '' ? `#${r.public_n}` : tag;
    const blockedByState = state === 'blocked';
    const blockedReason = String(flags.blocked_reason || (blockedByState ? 'state=blocked' : '')).trim();
    out.push({
      key: `card:${tag}`,
      kind: 'card',
      id,
      title: String(r?.title || r?.bug || id).trim(),
      state,
      owner: String(r?.assignee || '').trim(),
      blocked: Boolean(blockedReason),
      blockedReason,
      lastOutcome: '',
      lastActivityAt: String(r?.updated_at || r?.created_at || '').trim(),
      live: null,
      branch: '',
      source: 'bugctl',
    });
  }
  return out;
}

/**
 * Ledger rows → one item per surface (the newest row wins).
 *
 * A failed outcome does NOT set `blocked`: a single failure is normal. It sets
 * `lastOutcome`, and `stalledReason` decides from the outcome plus its age plus
 * whether anyone is still alive on that branch. That split is what stops the
 * PM from nudging a lane that failed a second ago and is already retrying.
 */
export function laneItems(rows) {
  const newest = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const surface = String(r?.surface || '').trim();
    if (!surface) continue;
    const prev = newest.get(surface);
    if (!prev || String(r?.at || '') >= String(prev.at || '')) newest.set(surface, r);
  }
  return [...newest.entries()].map(([surface, r]) => ({
    key: `lane:${surface}`,
    kind: 'lane',
    id: surface,
    title: `${surface} — last dispatch ${r.outcome || 'unknown'}${r.ticket ? ` (${r.ticket})` : ''}`,
    state: String(r.outcome || 'unknown').trim(),
    owner: surface,
    blocked: false,
    blockedReason: '',
    lastOutcome: String(r.outcome || '').trim(),
    lastActivityAt: String(r.at || '').trim(),
    live: null,
    branch: '',
    source: 'run-ledger',
  }));
}

/**
 * Attach a heartbeat to an item, by the one convention the two stores share: the
 * item's id appears in the heartbeat's branch name (`agent/pm-1` ↔ `PM-1`).
 * No match means `null` — "not linked" — never "dead".
 */
export function heartbeatFor(item, beats = {}) {
  // Substring convention, kept deliberately loose: heartbeat branches are
  // free-form (`agent/pm-1`, `bot-host-vm`) while item ids are short (`vm`,
  // `#901`). Tightening to segment-match would drop real links, so a short id
  // can over-match (`vm` ∋ `agent/vm2`) — per-agent routing is not modelled
  // (see packet residual); the ladder only fires on failed+old+not-live.
  const needle = String(item?.id || '').toLowerCase().replace(/^#/, '');
  if (!needle) return null;
  for (const rec of Object.values(beats || {})) {
    const branch = String(rec?.branch || '').toLowerCase();
    if (branch && branch.includes(needle)) return rec;
  }
  return null;
}

/**
 * The worktree an agent branch implies, by the one convention worktrees share:
 * `agent/<area>` works in `~/dev/<area>` (`~/dev/new-worktree.sh <area>`).
 * Any other branch shape means "unknown", never a guessed path — a heartbeat
 * branch is free-form, and a wrong directory is worse than a blank cell.
 */
export function worktreeFor(branch) {
  const m = String(branch || '').match(/^agent\/([^/\s]+)/);
  if (!m) return '';
  return `~/dev/${m[1]}`;
}

/** Why this item is not progressing, or '' when it is. Liveness arrives
 * precomputed as `item.live` (projectFleet runs liveFn); there is deliberately
 * no liveFn here so stalled-ness stays a pure function of the item. */
export function stalledReason(item, { now = Date.now(), stallMs = DEFAULT_STALL_MS } = {}) {
  if (item?.blocked) return item.blockedReason || 'blocked';
  if (!item?.lastOutcome || !FAILED_OUTCOMES.has(item.lastOutcome)) return '';
  if (item.live === true) return '';
  const at = Date.parse(item.lastActivityAt || '');
  if (!Number.isFinite(at)) return `last dispatch ${item.lastOutcome} (no timestamp)`;
  if (now - at < stallMs) return '';
  return `last dispatch ${item.lastOutcome} ${humanAge(now - at)} ago, no live agent`;
}

/** Live vs stale heartbeats, as two lists. */
export function beatIndex(beats = {}, { liveFn = isLive, now = Date.now() } = {}) {
  const out = { live: [], stale: [] };
  for (const [slug, rec] of Object.entries(beats || {})) {
    const entry = {
      slug,
      branch: String(rec?.branch || slug),
      note: String(rec?.note || ''),
      updatedAt: String(rec?.updatedAt || ''),
    };
    let alive = false;
    try {
      alive = Boolean(liveFn(rec, { now }));
    } catch {
      alive = false;
    }
    out[alive ? 'live' : 'stale'].push(entry);
  }
  out.live.sort((a, b) => a.branch.localeCompare(b.branch));
  out.stale.sort((a, b) => a.branch.localeCompare(b.branch));
  return out;
}

/**
 * Deployed agents, from tmux itself.
 *
 * Heartbeats say who is *alive*; tmux says what *exists*: a session with no
 * live heartbeat behind it is an idle resource (or a dead agent's leftover),
 * and a live heartbeat with no tmux session is a headless worker. The PM reads
 * both lists side by side when it judges whether agent resources are allocated
 * intelligently — this function only lists, never judges.
 *
 * The runner is injectable (`(args) => stdout`) so the sensor drives parsing
 * without a tmux server. A missing server is `{ ok: false }`, never an empty
 * list: "could not look" and "nothing deployed" are different facts.
 */
export function listTmuxSessions({ runner = null, now = Date.now() } = {}) {
  const run = runner || ((args) => nodeExecFileSync('tmux', args, { encoding: 'utf8', timeout: 8000 }));
  let out = '';
  try {
    out = String(run(['ls', '-F', '#{session_name}\t#{session_created}\t#{session_attached}']) || '');
  } catch {
    return { ok: false, error: 'no tmux server on this host', sessions: [] };
  }
  const text = out.trim();
  if (!text) return { ok: true, error: '', sessions: [] };
  const sessions = [];
  for (const line of text.split(/\r?\n/)) {
    const [name, created, attached] = line.split('\t');
    if (!name || !name.trim()) continue;
    const createdMs = Number(created) * 1000;
    sessions.push({
      name: name.trim(),
      age: Number.isFinite(createdMs) && createdMs > 0 ? humanAge(now - createdMs) : 'unknown',
      attached: String(attached || '').trim() === '1',
    });
  }
  sessions.sort((a, b) => a.name.localeCompare(b.name));
  return { ok: true, error: '', sessions };
};

/**
 * The projection. Pure given its inputs: hand it already-read sources and it
 * cannot touch the disk, which is what lets the sensor drive every rule.
 */
export function projectFleet({
  specs = [],
  bugs = [],
  lanes = [],
  beats = {},
  now = Date.now(),
  stallMs = DEFAULT_STALL_MS,
  liveFn = isLive,
} = {}) {
  const items = [...specs, ...bugs, ...lanes].map((it) => {
    const beat = heartbeatFor(it, beats);
    let alive = null;
    if (beat) {
      try {
        alive = Boolean(liveFn(beat, { now }));
      } catch {
        alive = false;
      }
    }
    // The agent's own words travel with the item: branch + note are the
    // heartbeat the agent beats (`agent-heartbeat.mjs --branch=… --note=…`),
    // worktree is where the beating process runs (`cwd` in the beat — ground
    // truth; the `agent/<area>` convention is only the fallback when the beat
    // carries no cwd). The sheet serialises these, so "who is on it and where"
    // is automatic every sweep — no agent ever writes the sheet directly.
    const branch = beat ? String(beat.branch || '') : '';
    const cwd = beat && beat.cwd ? String(beat.cwd) : '';
    return { ...it, live: alive, branch, note: beat ? String(beat.note || '') : '', worktree: cwd || worktreeFor(branch) };
  });
  for (const it of items) it.stallReason = stalledReason(it, { now, stallMs });
  const stalled = items.filter((it) => it.stallReason);
  return {
    generatedAt: new Date(now).toISOString(),
    items,
    stalled,
    liveness: beatIndex(beats, { liveFn, now }),
    counts: {
      total: items.length,
      stalled: stalled.length,
      specs: items.filter((i) => i.kind === 'spec').length,
      cards: items.filter((i) => i.kind === 'card').length,
      lanes: items.filter((i) => i.kind === 'lane').length,
    },
  };
}

/** Read the four sources into the shape `projectFleet` takes. */
export function readFleetSources({ paths, env = process.env, execFileSync } = {}) {
  const p = paths || pmPaths(env);
  const specs = readSpecDir(p.specsDir);

  let ledger = [];
  let ledgerError = '';
  try {
    ledger = loadLedger(p.ledgerPath);
  } catch (err) {
    ledger = [];
    ledgerError = String(err?.message || err).slice(0, 200);
  }

  let beats = {};
  let beatsError = '';
  try {
    beats = readBeatsFrom(p.heartbeatDir);
  } catch (err) {
    beats = {};
    beatsError = String(err?.message || err).slice(0, 200);
  }

  const tickets = readTickets({ env, execFileSync });
  return {
    specs: specs.items,
    bugs: bugItems(tickets.rows),
    lanes: laneItems(ledger),
    beats,
    sources: {
      specsDir: specs.dir,
      specsOk: specs.ok,
      specsReason: specs.reason,
      ledger: p.ledgerPath,
      ledgerRows: ledger.length,
      ledgerError,
      heartbeatDir: p.heartbeatDir,
      beats: Object.keys(beats).length,
      beatsError,
      tickets: tickets.source,
      ticketsError: tickets.error,
      ticketsCount: tickets.rows.length,
    },
  };
}

/** Read the heartbeat store from an explicit directory (so a fixture needs no HOME rewrite). */
export function readBeatsFrom(dir) {
  const out = {};
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return out;
  }
  for (const f of files) {
    try {
      out[f.replace(/\.json$/, '')] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch {
      // a torn write is not a heartbeat
    }
  }
  return out;
}

/**
 * The ticket source, exactly as named: `bugctl list --json`.
 *
 * Spawned rather than re-implemented on purpose — `bugctl` owns the HTTP shape,
 * the token header and the offline queue, and a second client here would be the
 * fifth place a ticket list is parsed. A refusal (no API, no token) is returned
 * as an error for the report to print, never as an empty fleet: "we could not
 * read the queue" and "the queue is empty" are different facts.
 */
export function readTickets({ env = process.env, execFileSync = nodeExecFileSync, timeoutMs = 15000, root = REPO_ROOT } = {}) {
  if (String(env.PM_SKIP_BUGCTL || '').trim() === '1') {
    return { rows: [], source: 'skipped', error: '' };
  }
  const run = execFileSync;
  const script = String(env.PM_BUGCTL || '').trim() || path.join(root, 'scripts', 'bugctl.mjs');
  try {
    const stdout = run(process.execPath, [script, 'list', '--json'], {
      env,
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
    });
    const parsed = JSON.parse(String(stdout || '{}'));
    if (parsed.error) return { rows: [], source: 'error', error: String(parsed.error) };
    return { rows: Array.isArray(parsed.rows) ? parsed.rows : [], source: parsed.source || 'api', error: '' };
  } catch (err) {
    return { rows: [], source: 'error', error: String(err?.message || err).slice(0, 200) };
  }
}

/** Markdown-safe dynamic text: Telegram parses `_` and `*` anywhere, even mid-word. */
export function mdSafe(value) {
  return String(value ?? '').replace(/[*_`\[\]]/g, '');
}

/** The fleet answer, as one Telegram message. */
export function renderFleet(fleet, { limit = 12, sources = null, tmux = null } = {}) {
  const lines = [];
  const c = fleet.counts;
  lines.push(`📋 *Fleet — ${c.total} item(s), ${c.stalled} stalled*`);
  lines.push(`• packets: ${c.specs} · cards: ${c.cards} · lanes: ${c.lanes}`);
  const live = fleet.liveness.live.length;
  const stale = fleet.liveness.stale.length;
  lines.push(`• agents: ${live} live, ${stale} stale${live ? ` (${fleet.liveness.live.map((b) => mdSafe(b.branch)).join(', ')})` : ''}`);
  if (tmux) {
    if (tmux.ok) {
      const names = tmux.sessions.map((t) => `${mdSafe(t.name)}${t.attached ? ' (viewed)' : ''}, ${t.age}`).join('; ');
      lines.push(`• deployed (tmux): ${tmux.sessions.length} session(s)${names ? `: ${names}` : ''}`);
      const dark = tmux.sessions.filter((t) => !t.attached);
      if (dark.length) lines.push(`• ${dark.length} terminal(s) with no viewer attached (${dark.map((t) => mdSafe(t.name)).join(', ')}) — compare with the live agents above before calling them free`);
    } else {
      lines.push(`• deployed (tmux): unavailable (${mdSafe(tmux.error || 'unknown')})`);
    }
  }
  if (fleet.stalled.length) {
    lines.push('');
    lines.push('*Stalled:*');
    for (const it of fleet.stalled.slice(0, limit)) {
      const who = it.branch ? ` — ${mdSafe(it.branch)}${it.note ? `: ${mdSafe(it.note)}` : ''}` : '';
      lines.push(`• \`${mdSafe(it.id)}\` — ${mdSafe(it.stallReason)}${who}`);
    }
    if (fleet.stalled.length > limit) lines.push(`• …and ${fleet.stalled.length - limit} more`);
  } else {
    lines.push('');
    lines.push('Nothing is stalled.');
  }
  if (sources) {
    lines.push('');
    lines.push('*Sources:*');
    lines.push(`• packets: ${mdSafe(sources.specsOk ? sources.specsDir : sources.specsReason)}`);
    lines.push(`• tickets: ${mdSafe(sources.tickets)}${sources.ticketsError ? ` (${mdSafe(sources.ticketsError)})` : ''} — ${sources.ticketsCount ?? 0} row(s)`);
    lines.push(`• ledger: ${sources.ledgerRows} row(s)${sources.ledgerError ? ` (${mdSafe(sources.ledgerError)})` : ''}`);
    lines.push(`• heartbeats: ${sources.beats}${sources.beatsError ? ` (${mdSafe(sources.beatsError)})` : ''}`);
  }
  return lines.join('\n');
}
