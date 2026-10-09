/**
 * fleet-status.mjs — State module for the dynamic /fleet Telegram Mini App.
 *
 * Responsibility:
 * 1. Read tab 'current' from PM spreadsheet via readTab (projects the eight headers by name).
 * 2. In-memory 15s cache shield against Google Sheets 300 req/min quota ceiling.
 *    A failed sheet read returns the previous snapshot and its age (or pm-fleet fallback).
 * 3. Never writes to Google Sheets (strictly read-only).
 * 4. Owns telemetry nodes (Mac, VM, Grok VM, Mobile, Collab) with 2m/10m TTL lease decay.
 * 5. Queries fleet bots from registry.json and leases.json for live working/idle states.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import { workerStatus } from './worker-presence.mjs';
import { applyMasterDefaults } from './registry.mjs';
import { formatTokens } from './commands.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..', '..');

export const FLEET_CACHE_TTL_MS = 15000;
export const DEFAULT_LOCATIONS = ['Mac', 'VM', 'Grok VM', 'Mobile', 'Collab'];
export const FLEET_STALE_TTL_MS = 15 * 60 * 1000;
// A beat this old means its reporter is gone (process ended, machine offline):
// the pane returns to offline instead of showing stale forever.
export const FLEET_OFFLINE_TTL_MS = 60 * 60 * 1000;
// Freshness window for live VM opencode CLI sessions in the VM fallback.
export const VM_OPENCODE_WINDOW_MS = 15 * 60 * 1000;

let fleetTicketsCache = { cachedAt: 0, rows: [] };
const fleetNodeHeartbeats = new Map();

/**
 * The Drive FILE id inside a proof cell, or '' when there is none.
 *
 * A `drive.google.com/file/d/<id>/…` link is a screenshot, and the mini app
 * renders it as the picture. A `/folders/` link, a bare key, or prose is not
 * an image and stays text — the cell never guesses which one it is.
 */
export function driveFileIdFrom(value) {
  const s = String(value || '');
  if (!/drive\.google\.com/i.test(s)) return '';
  const m = s.match(/\/file\/d\/([A-Za-z0-9_-]{10,})/);
  if (m) return m[1];
  // thumbnail links carry the id in a query param
  const q = s.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  return q ? q[1] : '';
}

/** Directory where local beats are persisted. */
export function fleetBeatsDir() {
  const dir = path.join(os.homedir(), '.local', 'state', 'fleet-beats');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {}
  return dir;
}

/** Disk file backing one location's beat (same sanitization as the writer). */
export function beatFilePath(location) {
  return path.join(fleetBeatsDir(), `${String(location || '').toLowerCase().replace(/[^a-z0-9_-]/g, '_')}.json`);
}

let _DatabaseSync = null;
let _sqliteTried = false;
function sqliteDriver() {
  if (!_sqliteTried) {
    _sqliteTried = true;
    try {
      _DatabaseSync = createRequire(import.meta.url)('node:sqlite').DatabaseSync;
    } catch {}
  }
  return _DatabaseSync;
}

/**
 * One row per live opencode session on the VM host — never an aggregate:
 * the user asked for one agent per row, so each session carries its own
 * model, working marker and title.
 * Each row may carry lastType/lastCompleted from its newest session_message:
 * a streaming assistant message (no completed stamp) means working.
 */
export function vmSessionRows(rows, { now = Date.now() } = {}) {
  return (Array.isArray(rows) ? rows : []).map((r) => {
    let modelId = '';
    try {
      const m = typeof r.model === 'string' ? JSON.parse(r.model) : (r.model || {});
      modelId = String(m.id || '').trim();
    } catch {
      modelId = String(r.model || '').trim();
    }
    if (!modelId) return null;
    const dir = String(r.directory || '').trim();
    const title = String(r.title || '').trim();
    const label = title && title.toLowerCase() !== 'none' ? title : (dir.split('/').pop() || dir);
    const streaming = String(r.lastType || '') === 'assistant' && (r.lastCompleted === null || r.lastCompleted === undefined);
    const working = streaming || String(r.lastType || '') === 'user';
    return {
      location: 'VM',
      agent: `opencode/${modelId}`,
      status: working ? 'working' : 'idle',
      lastPhase: working ? 'working' : 'idle',
      task: label,
      ticketKey: '',
      multiClaim: false,
      claimedTickets: [],
      updatedAt: r.lastSeenMs ? new Date(Number(r.lastSeenMs)).toISOString() : (r.timeUpdated ? new Date(Number(r.timeUpdated)).toISOString() : new Date(now).toISOString()),
    };
  }).filter(Boolean);
}

/** Recent unarchived opencode sessions from the local opencode.db (best-effort).
 * Freshness is the latest activity of either clock: the session row
 * (moves on step completion) or its message stream (moves while a turn is
 * still generating). A long streaming turn must not vanish mid-turn. */
export function readVmOpencodeSessions({ home = os.homedir(), now = Date.now(), windowMs = VM_OPENCODE_WINDOW_MS, dbPath = null } = {}) {
  try {
    const DatabaseSync = sqliteDriver();
    if (!DatabaseSync) return [];
    const db = dbPath || path.join(home, '.local', 'share', 'opencode', 'opencode.db');
    if (!fs.existsSync(db)) return [];
    const conn = new DatabaseSync(db, { readOnly: true });
    try {
      const rows = conn.prepare(
        `select s.model, s.directory, s.title, s.time_updated as timeUpdated,
          (select m.type from session_message m where m.session_id = s.id order by m.time_created desc limit 1) as lastType,
          (select m.data from session_message m where m.session_id = s.id order by m.time_created desc limit 1) as lastData,
          (select max(m.time_created) from session_message m where m.session_id = s.id) as lastMsgMs
        from session_v2 s where s.time_archived is null order by s.time_updated desc limit 10`
      ).all();
      const fresh = [];
      for (const r of rows) {
        try {
          const d = typeof r.lastData === 'string' ? JSON.parse(r.lastData) : null;
          r.lastCompleted = d && d.time ? (d.time.completed ?? null) : null;
        } catch {
          r.lastCompleted = null;
        }
        const seen = Math.max(Number(r.timeUpdated || 0), Number(r.lastMsgMs || 0));
        if (now - seen > windowMs) continue;
        r.lastSeenMs = seen;
        fresh.push(r);
        if (fresh.length >= 5) break;
      }
      return fresh;
    } finally {
      try { conn.close(); } catch {}
    }
  } catch {
    return [];
  }
}

/** Record a distributed heartbeat from a machine/agent pane. */
export function recordFleetHeartbeat(data, { now = Date.now() } = {}) {
  if (!data || typeof data !== 'object') return { ok: false, error: 'invalid payload' };
  const location = String(data.location || 'Unknown').trim();
  // The pane renders agent verbatim, so an agent-less beat would paint
  // "Unknown" as if it were a model. Refuse it instead of storing it.
  const rawAgent = String(data.agent || data.model || '').trim();
  if (!rawAgent || rawAgent.toLowerCase() === 'unknown' || rawAgent === '—') {
    return { ok: false, error: 'missing agent' };
  }
  const agent = rawAgent;
  const phase = String(data.phase || data.status || 'working').trim();
  const task = String(data.task || data.sentence || '').slice(0, 240);
  const ticketKey = String(data.ticketKey || data.ticket || '').trim();
  const standin = Boolean(data.standin);
  const record = {
    location,
    agent,
    phase,
    task,
    ticketKey,
    standin,
    pid: data.pid || null,
    updatedAt: new Date(now).toISOString(),
    updatedAtMs: now,
  };
  fleetNodeHeartbeats.set(location, record);

  // Persist to local disk cache
  try {
    const filePath = beatFilePath(location);
    fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf8');
  } catch {}

  return { ok: true, node: record };
}

/** Explicit mapping table: one pane per ticket, no loose substring overlap. */
export const LOCATION_OWNER_KEYS = {
  'mac': ['mac', 'darwin'],
  'vm': ['vm', 'vps', 'vps-france'],
  'grok vm': ['grok', 'grok-vps'],
  'collab': ['collab', 'colab'],
  'mobile': ['mobile', 'termux', 'phone', 'android'],
};

/**
 * Match a ticket owner string to a fleet pane location.
 * Crucial: grok-vps must strictly match 'Grok VM' and NEVER match 'VM'.
 */
export function matchesLocation(locationName, ownerStr) {
  const loc = String(locationName || '').toLowerCase().trim();
  const owner = String(ownerStr || '').toLowerCase().trim();
  if (!owner) return false;
  const atParts = owner.split('@');
  const hostPart = (atParts.length > 1 ? atParts[1] : atParts[0]).trim();
  const tokens = hostPart.split(/[^a-z0-9_-]+/).filter(Boolean);

  if (loc === 'grok vm') {
    return tokens.includes('grok-vps') || tokens.includes('grok') || hostPart === 'grok-vps' || hostPart === 'grok';
  }
  if (loc === 'vm') {
    // Grok on grok-vps must NEVER match the VM pane!
    if (tokens.includes('grok-vps') || tokens.includes('grok') || hostPart.includes('grok')) {
      return false;
    }
    return tokens.includes('vm') || tokens.includes('vps') || tokens.includes('vps-france') || hostPart === 'vm' || hostPart === 'vps' || hostPart === 'vps-france';
  }
  if (loc === 'mac') {
    return tokens.includes('mac') || tokens.includes('darwin') || hostPart === 'mac';
  }
  if (loc === 'collab') {
    return tokens.includes('collab') || tokens.includes('colab') || hostPart === 'collab' || hostPart === 'colab';
  }
  if (loc === 'mobile') {
    return tokens.includes('mobile') || tokens.includes('termux') || tokens.includes('phone') || tokens.includes('android');
  }
  return false;
}

/**
 * Get terminal panes with separated liveness and sheet claim:
 * - Worker badge comes from reporter beat (working, idle) or presence fallback.
 * - Sheet row is a claim (ticketKey chip/link, multi-claim warning if > 1 claim).
 * - Freshness: retained phase under 15m; 'stale' after 15m quiet period.
 * - 'offline' reserved for explicit disconnect, standin: true, or no reporter.
 * - A working pane with no reported sentence displays 'Sentence missing'.
 */
export function getFleetNodes(opts = {}) {
  const now = typeof opts === 'number' ? opts : (opts?.now ?? Date.now());
  const result = [];
  const seenLocations = new Set();

  // Reload from disk cache if files are present
  try {
    const dir = fleetBeatsDir();
    if (fs.existsSync(dir)) {
      for (const file of fs.readdirSync(dir)) {
        if (file.endsWith('.json')) {
          try {
            const content = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
            if (content.location) {
              const existing = fleetNodeHeartbeats.get(content.location);
              if (!existing || (content.updatedAtMs || 0) >= (existing.updatedAtMs || 0)) {
                fleetNodeHeartbeats.set(content.location, content);
              }
            }
          } catch {}
        }
      }
    }
  } catch {}

  const allTickets = Array.isArray(opts?.tickets) ? opts.tickets : fleetTicketsCache.rows;
  const activeTickets = (allTickets || []).filter(
    (t) => String(t.status || '').trim().toLowerCase() === 'in progress'
  );

  function resolveNode(loc, beat) {
    // 1. Identify sheet claims for this pane
    const matchingTickets = activeTickets.filter((t) => matchesLocation(loc, t.owner));
    const isMultiClaim = matchingTickets.length > 1;
    const claimedTicketKeys = matchingTickets.map((t) => t.id);
    const sheetTicketKey = claimedTicketKeys.join(', ');

    // 2. Determine worker liveness (badge comes from worker, not sheet claim)
    let agent = '—';
    let status = 'offline';
    let lastPhase = 'offline';
    let task = '';
    let updatedAt = null;

    if (beat) {
      agent = beat.agent || '—';
      updatedAt = beat.updatedAt;
      const reportedPhase = String(beat.phase || 'working').toLowerCase();
      lastPhase = reportedPhase;

      if (beat.standin) {
        status = 'offline';
        task = 'Offline (mock standin)';
        agent = '—';
      } else if (reportedPhase === 'offline') {
        status = 'offline';
        task = beat.task || 'Offline (explicit disconnect)';
      } else {
        const ageMs = Math.max(0, now - (beat.updatedAtMs || 0));
        if (ageMs > FLEET_OFFLINE_TTL_MS) {
          // Reporter gone (process ended, machine offline): back to offline
          // instead of a stale badge forever. Drop the evidence both places.
          status = 'offline';
          lastPhase = 'offline';
          task = 'No reporter (last beat expired)';
          agent = '—';
          updatedAt = null;
          try { fleetNodeHeartbeats.delete(beat.location); } catch {}
          try { fs.unlinkSync(beatFilePath(beat.location)); } catch {}
        } else if (ageMs > FLEET_STALE_TTL_MS) {
          status = 'stale';
          task = beat.task ? beat.task : `Last: ${reportedPhase}`;
        } else {
          // Fresh (within 15m): keep the reported phase (no 2m/10m decay)
          status = reportedPhase === 'working' ? 'working' : reportedPhase;
          if (status === 'working') {
            task = (beat.task || '').trim() || 'Sentence missing';
          } else {
            task = (beat.task || '').trim() || 'Idle';
          }
        }
      }
    } else {
      // No beat received yet: check fallback presence
      if (loc === 'VM') {
        try {
          const home = opts.home || os.homedir();
          const botHostStateDir = path.join(home, '.local', 'state', 'bot-host');
          let isWorking = false;
          let activeDetail = '';
          let activeBot = 'VM Bot (@VM_19485_bot)';
          if (fs.existsSync(botHostStateDir)) {
            for (const botId of ['vm', 'vm2', 'vm3', 'vm4', 'vm5', 'vm6', 'android', 'opencode']) {
              const leaseFile = path.join(botHostStateDir, botId, 'leases.json');
              if (fs.existsSync(leaseFile)) {
                try {
                  const raw = JSON.parse(fs.readFileSync(leaseFile, 'utf8'));
                  const leases = Array.isArray(raw) ? raw : Object.values(raw || {});
                  if (leases.length > 0) {
                    isWorking = true;
                    activeDetail = `Turn in progress (${botId})`;
                    activeBot = `${botId} bot`;
                    break;
                  }
                } catch {}
              }
            }
          }
          agent = activeBot;
          status = isWorking ? 'working' : 'idle';
          lastPhase = status;
          task = isWorking ? activeDetail : 'Ready (polling Telegram)';
          updatedAt = new Date(now).toISOString();
        } catch {
          status = 'idle';
          lastPhase = 'idle';
          task = 'Ready (polling Telegram)';
          agent = 'VM Bot (@VM_19485_bot)';
          updatedAt = new Date(now).toISOString();
        }
      } else if (loc === 'Grok VM' || loc === 'Collab' || loc === 'Mobile') {
        try {
          const hostKey = loc === 'Grok VM' ? 'grok' : loc.toLowerCase();
          const ws = workerStatus(hostKey, { home: opts.home || os.homedir(), now });
          if (ws && ws.reachable) {
            if (ws.standin) {
              // Standin is a local mock process on VPS, not real connected hardware
              status = 'offline';
              lastPhase = 'offline';
              task = 'Offline (mock standin)';
              agent = '—';
              updatedAt = null;
            } else {
              agent = loc === 'Grok VM' ? 'Grok Worker' : `${loc} Worker`;
              status = 'idle';
              lastPhase = 'idle';
              task = 'Worker connected (waiting for prompt)';
              updatedAt = ws.lastSeen || new Date(now).toISOString();
            }
          } else {
            status = 'offline';
            lastPhase = 'offline';
            task = 'No reporter active';
            agent = '—';
            updatedAt = null;
          }
        } catch {
          status = 'offline';
          lastPhase = 'offline';
          task = 'No reporter active';
          agent = '—';
          updatedAt = null;
        }
      } else {
        status = 'offline';
        lastPhase = 'offline';
        task = 'No reporter active';
        agent = '—';
        updatedAt = null;
      }
    }

    // Determine ticketKey: sheet claim takes precedence for ticket display chip/link;
    // fallback to worker's reported ticketKey if sheet has no active claim.
    const finalTicketKey = sheetTicketKey || beat?.ticketKey || '';

    return {
      location: loc,
      agent,
      status,
      lastPhase,
      task,
      ticketKey: finalTicketKey,
      multiClaim: isMultiClaim,
      claimedTickets: claimedTicketKeys,
      updatedAt,
    };
  }

  // Iterate over known default locations
  for (const loc of DEFAULT_LOCATIONS) {
    seenLocations.add(loc);
    const beat = fleetNodeHeartbeats.get(loc);
    // VM is one pane but many agents: every live opencode session is its own
    // row (one agent per row), never an aggregate sentence. The sheet claim
    // attaches to the first row so the ticket chip still links the pane.
    if (loc === 'VM' && !beat) {
      const sessionRows = vmSessionRows(
        readVmOpencodeSessions({ home: opts.home || os.homedir(), now, dbPath: opts.vmOpencodeDb || null }),
        { now }
      );
      if (sessionRows.length) {
        const matchingTickets = activeTickets.filter((t) => matchesLocation(loc, t.owner));
        const claimedKeys = matchingTickets.map((t) => t.id);
        result.push(...sessionRows.map((row, i) => ({
          ...row,
          ticketKey: i === 0 ? claimedKeys.join(', ') : '',
          multiClaim: i === 0 && claimedKeys.length > 1,
          claimedTickets: i === 0 ? claimedKeys : [],
        })));
        continue;
      }
    }
    result.push(resolveNode(loc, beat));
  }

  // Include any extra locations reported dynamically
  for (const [loc, beat] of fleetNodeHeartbeats.entries()) {
    if (seenLocations.has(loc)) continue;
    result.push(resolveNode(loc, beat));
  }

  return result;
}

/**
 * Read tickets from PM spreadsheet tab 'current' projecting the 8 human fields strictly by name.
 * Caches for 15s in memory. On failure, returns previous snapshot and age. Never writes to Google.
 */
/**
 * One sheet row → the ticket the mini app renders.
 *
 * Pure on purpose: `getByName` is injected, so both layouts the `current` tab
 * has used (curated `Owner/Status/Completion proof`, and projected
 * `owner/author/state/agent_note/stall_reason`) are testable without touching
 * Google. Each field lists every header that has ever carried it.
 */
export function ticketFromRow(getByName, idx = 0) {
  const idVal = getByName('key') || getByName('id') || getByName('#') || String(idx + 1);
  const proof = getByName('Completion proof') || getByName('proof') || '—';
  const proofShot = driveFileIdFrom(proof);
  return {
    id: idVal,
    originalRequest: getByName('Original request') || getByName('goal') || getByName('title') || '—',
    workDoneSoFar: getByName('Work done so far') || getByName('Work done') || getByName('note') || getByName('agent_note') || '—',
    whatsLeftToDo: getByName("What's left to do") || getByName('What is left to do') || getByName('todo') || '—',
    owner: getByName('Owner') || getByName('author') || '—',
    status: getByName('Status') || getByName('state') || 'Pending',
    // A Drive FILE link is a screenshot: the cell shows the picture, not the
    // URL. Anything else (a folder, a key, prose) stays text.
    completionProof: proofShot ? '' : proof,
    proofFileId: proofShot,
    completionProofText: proofShot ? proof : '',
    completionGate: getByName('Completion gate') || getByName('gate') || getByName('stall_reason') || '—',
    lastActivity: getByName('last_activity') || getByName('last activity') || getByName('Last activity') || getByName('built_at') || '—',
  };
}

export async function getFleetTickets({ env = process.env, root = REPO_ROOT, refresh = false } = {}) {
  const now = Date.now();
  if (!refresh && fleetTicketsCache.cachedAt && now - fleetTicketsCache.cachedAt < FLEET_CACHE_TTL_MS && fleetTicketsCache.rows.length) {
    return fleetTicketsCache.rows;
  }

  // 1. Try reading Google Sheet 'current' tab
  try {
    const { loadHostEnv, identityFromEnv, accessToken, readTab } = await import('./google-store.mjs');
    const { pmSheetId } = await import('./pm-sheet.mjs');
    const { env: hostEnv } = loadHostEnv('vm', env, { apply: false });
    const mergedEnv = { ...env, ...hostEnv };
    const sheetId = pmSheetId(mergedEnv) || '10oPI9AsHaKpb9xRR8XcTm6JyH1gYyykUFBNqeqg2SM0';
    const id = identityFromEnv(mergedEnv);
    if (sheetId && id.ok) {
      const token = await accessToken(id);
      if (token.ok && token.token) {
        const tabRes = await readTab(sheetId, 'current', token.token, { range: 'current!A1:Z60' });
        if (tabRes.ok && Array.isArray(tabRes.json?.values) && tabRes.json.values.length > 1) {
          const rawRows = tabRes.json.values;
          // Find header row (must contain 'key' or 'Original request')
          const headerIdx = rawRows.slice(0, 5).findIndex((r) => Array.isArray(r) && r.some((c) => /original request|key/i.test(String(c || ''))));
          if (headerIdx >= 0) {
            const rawHeader = rawRows[headerIdx];
            const headers = rawHeader.map((h) => String(h || '').trim().toLowerCase());
            const col = (name) => headers.indexOf(name.toLowerCase());

            const mapped = rawRows.slice(headerIdx + 1).filter((r) => Array.isArray(r) && r.length > 0 && r.some(Boolean)).map((vals, idx) => {
              const getByName = (headerName) => {
                const c = col(headerName);
                return c >= 0 && vals[c] !== undefined ? String(vals[c]).trim() : '';
              };

              // The `current` tab has been laid out two ways (a curated one with
              // Owner/Status/Completion proof, a projected one with
              // owner/author/state/agent_note). Reading only the curated names
              // blanked five columns the instant the layout flipped, even when
              // the projected row carried the value. `ticketFromRow` names all
              // the headers that have ever held each field, so a layout change
              // costs one field instead of five.
              return ticketFromRow(getByName, idx);
            });

            fleetTicketsCache = { cachedAt: now, rows: mapped };
            return mapped;
          }
        }
      }
    }
  } catch (err) {
    // If we have a cached snapshot, return it on error
    if (fleetTicketsCache.rows.length > 0) {
      return fleetTicketsCache.rows;
    }
  }

  // If Google API failed but we have cached snapshot, return previous snapshot
  if (fleetTicketsCache.rows.length > 0) {
    return fleetTicketsCache.rows;
  }

  // 2. Ground-truth fallback from pm-fleet projection
  try {
    const { pmPaths, readFleetSources, projectFleet } = await import('./pm-fleet.mjs');
    const paths = pmPaths(env, { root });
    const raw = readFleetSources({ paths, env });
    const fleet = projectFleet({ specs: raw.specs, bugs: raw.bugs, lanes: raw.lanes, beats: raw.beats, now });
    const mapped = (fleet.items || []).slice(0, 40).map((it, idx) => ({
      id: String(it.id || idx + 1),
      originalRequest: String(it.title || it.id || '—'),
      workDoneSoFar: it.lastOutcome ? `last outcome: ${it.lastOutcome}` : '—',
      whatsLeftToDo: it.stallReason || (it.blocked ? 'blocked' : 'in progress'),
      owner: it.owner || it.branch || '—',
      status: String(it.state || 'Pending'),
      completionProof: '—',
      completionGate: it.stallReason || '—',
      lastActivity: String(it.lastActivityAt || ''),
    }));
    fleetTicketsCache = { cachedAt: now, rows: mapped };
    return mapped;
  } catch {
    return [];
  }
}

/**
 * Return all registered bots with live working/idle status from lease files.
 */
export async function getFleetBots({ root = REPO_ROOT, home = os.homedir() } = {}) {
  try {
    const regPath = path.join(root, 'bots', 'registry.json');
    if (!fs.existsSync(regPath)) return [];
    const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
    const bots = Array.isArray(reg.bots) ? reg.bots : [];
    return bots.map((b) => {
      let isWorking = false;
      let activeDetail = '';
      try {
        const leaseFile = path.join(home, '.local', 'state', 'bot-host', b.id, 'leases.json');
        if (fs.existsSync(leaseFile)) {
          const raw = JSON.parse(fs.readFileSync(leaseFile, 'utf8'));
          const leases = Array.isArray(raw) ? raw : Object.values(raw || {});
          if (leases.length > 0) {
            isWorking = true;
            activeDetail = 'Turn in progress';
          }
        }
      } catch {}

      const enabled = Boolean(b.enabled);
      const status = isWorking ? 'working' : (enabled ? 'idle' : 'offline');
      const progress = isWorking
        ? (activeDetail || 'Working')
        : (b.notes || (enabled ? 'Ready' : 'Disabled'));

      return {
        id: b.id,
        name: b.name || b.id,
        runtime: b.runtime || 'bot-host',
        model: b.agent?.model || (b.extends ? 'inherited' : '—'),
        enabled,
        active: enabled,
        status,
        progress,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Runtimes that share the bot-host on-disk per-chat state layout
 * (`~/.local/state/bot-host/<id>/{prefs,sessions,totals,leases}.json`).
 * hermes/collab/provider-router keep their own state and are excluded.
 */
export const FLEET_CHAT_RUNTIMES = new Set(['bot-host', 'device']);

function readJsonObject(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function lookupByChat(obj, chatId) {
  const key = String(chatId ?? '');
  if (!key || !obj || typeof obj !== 'object') return undefined;
  if (Object.hasOwn(obj, key)) return obj[key];
  return undefined;
}

function splitScopedSession(raw) {
  const s = String(raw ?? '');
  if (!s) return { workspace: '', sessionId: null };
  const cut = s.indexOf('\u0000');
  if (cut === -1) return { workspace: '', sessionId: null };
  return { workspace: s.slice(0, cut), sessionId: s.slice(cut + 1) || null };
}

/**
 * One row per council agent for this chat, read from on-disk state.
 *
 * `seats` + `roleOf` select the agents in the room: the registry master
 * (coordinator) plus the bots holding a seat on this chat's council
 * (health seats for a health chat, tax seats for a tax chat). Without them
 * every chat-capable runtime is listed. Each bot is its own OS process, so
 * live memory (last-run usage, uptime, poll health) of *other* bots is not
 * visible here. Task state falls back to what the fleet dashboard uses: a
 * leases.json entry for this chat means working, otherwise idle. Only the
 * answering bot's own /status has the live-memory fields — this table says
 * which bot to ask for those.
 *
 * `workspace` scopes the session row the same way /status does (an exact
 * workspace match, or the row belongs to another project).
 */
/**
 * Group presence, learned from the group's own traffic.
 *
 * "Which agents are in THIS group" has no registry answer: seats join chats at
 * runtime and nothing on disk said so. What IS true is that a bot only receives
 * an update for a chat it belongs to, so every message in a group is proof of
 * presence for the bots that saw it. Recording that turns membership into a fact
 * instead of a guess, which is what lets a fleet-wide read work in any group —
 * including one created a minute ago — with no per-group config.
 *
 * Kept out of totals.json on purpose: presence churns on every message and must
 * not rewrite the usage ledger to record "I was here".
 */
const PRESENCE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PRESENCE_MIN_GAP_MS = 60 * 1000;

function presencePath(seatId, home) {
  return path.join(home, '.local', 'state', 'bot-host', seatId, 'presence.json');
}

/**
 * Record that this seat has seen this chat. Cheap: an entry written inside the
 * gap window writes nothing, so a busy group does not become a write per
 * message. Returns true when the file was written.
 */
export function noteChatPresence(seatId, chatId, { home = os.homedir(), now = Date.now() } = {}) {
  const key = String(chatId ?? '');
  if (!key || !seatId) return false;
  try {
    const file = presencePath(seatId, home);
    const prev = readJsonObject(file) || {};
    const at = Number(prev[key]) || 0;
    const age = now - at;
    if (at && age >= 0 && age < PRESENCE_MIN_GAP_MS) return false;
    const next = {};
    for (const [k, v] of Object.entries(prev)) {
      const t = Number(v) || 0;
      // Bounded, or this file grows with every group the fleet ever sat in.
      if (t && now - t >= 0 && now - t < PRESENCE_TTL_MS) next[k] = t;
    }
    next[key] = now;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(next)}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

/**
 * The agents present in one chat, in registry order.
 *
 * Presence first (they are in the room), then per-chat work records (they have
 * been in the room), then null for "nothing known here yet" — so a caller can
 * fall back to the full council instead of claiming the room is empty.
 */
export function chatRoster({ fleetBots, chatId, home = os.homedir(), now = Date.now() } = {}) {
  const key = String(chatId ?? '');
  if (!key) return null;
  const here = [];
  const worked = [];
  for (const b of fleetBots || []) {
    if (!b || b.enabled === false) continue;
    if (!FLEET_CHAT_RUNTIMES.has(b.runtime || 'bot-host')) continue;
    const at = Number((readJsonObject(presencePath(b.id, home)) || {})[key]) || 0;
    // age >= 0 matters: a file written by a host whose clock ran ahead reads as a
    // negative age, which is < TTL, so the seat would sit in the roster forever.
    const age = now - at;
    if (at && age >= 0 && age < PRESENCE_TTL_MS) { here.push(b.id); continue; }
    const dir = path.join(home, '.local', 'state', 'bot-host', b.id);
    const totals = readJsonObject(path.join(dir, 'totals.json'));
    if (Object.prototype.hasOwnProperty.call(totals || {}, key)) worked.push(b.id);
  }
  if (here.length) return here;
  if (worked.length) return worked;
  return null;
}

export function fleetChatStatus({ chatId, workspace = '', root = REPO_ROOT, home = os.homedir(), seats = null, roleOf = null, masterId = null, onlySeats = null } = {}) {
  const key = String(chatId ?? '');
  if (!key) return [];
  let bots = [];
  let master = null;
  try {
    const reg = readJsonObject(path.join(root, 'bots', 'registry.json'));
    if (!Array.isArray(reg.bots) || reg.bots.length === 0) return [];
    master = masterId || reg.master || null;
    bots = applyMasterDefaults({ master: reg.master, bots: reg.bots }).bots;
  } catch {
    return [];
  }
  const ws = String(workspace || '');
  // When the caller scoped this chat (see chatRoster), the room's own seats
  // win over the council: a group is not every seat that exists.
  const scopedIds = Array.isArray(onlySeats) && onlySeats.length ? new Set(onlySeats) : null;
  const inCouncil = (b) => {
    if (scopedIds) return scopedIds.has(b.id);
    if (!Array.isArray(seats) || typeof roleOf !== 'function') return true;
    if (master && b.id === master) return true;
    return seats.includes(roleOf(b));
  };
  return bots
    .filter((b) => FLEET_CHAT_RUNTIMES.has(b.runtime || 'bot-host') && inCouncil(b))
    .map((b) => {
      const dir = path.join(home, '.local', 'state', 'bot-host', b.id);
      const pref = lookupByChat(readJsonObject(path.join(dir, 'prefs.json')), key) || {};
      const sessionRow = lookupByChat(readJsonObject(path.join(dir, 'sessions.json')), key);
      const totalsRow = lookupByChat(readJsonObject(path.join(dir, 'totals.json')), key) || {};
      const leases = readJsonObject(path.join(dir, 'leases.json'));
      const leaseHit = Array.isArray(leases)
        ? leases.some((l) => String(l?.chatId ?? '') === key)
        : lookupByChat(leases, key) !== undefined;
      const scoped = splitScopedSession(sessionRow);
      const sessionId = scoped.sessionId && (!ws || scoped.workspace === ws) ? scoped.sessionId : null;
      const foreignSession = Boolean(scoped.sessionId && ws && scoped.workspace !== ws);
      const runs = Number(totalsRow.runs) || 0;
      const tokens = Number(totalsRow.tokens) || 0;
      const cost = Number(totalsRow.cost) || 0;
      const last = totalsRow.last && typeof totalsRow.last === 'object' ? totalsRow.last : null;
      // What this seat RAN on beats what it is CONFIGURED to run on. noteUsage
      // records the answering lane (seat-model's `answeredBy`), which differs
      // from the registry default the moment a lane fails over. Reading only
      // the config made the table claim a lane the answer did not come from —
      // the opposite of the point of the column.
      const usedModel = typeof last?.model === 'string' ? last.model.trim() : '';
      const lastTokens = Number(last?.tokens?.total ?? last?.tokens) || 0;
      const lastLimit = Number(last?.contextLimit) || 0;
      const enabled = b.enabled !== false;
      const seat = typeof roleOf === 'function' ? String(roleOf(b) || '') : '';
      return {
        id: b.id,
        name: b.name || b.id,
        enabled,
        role: master && b.id === master ? 'coordinator' : seat || null,
        model: usedModel || pref.model || b.agent?.model || null,
        agent: pref.agent || b.agent?.defaultAgent || null,
        sessionId,
        foreignSession,
        totals: runs > 0 || tokens > 0 || cost > 0 ? { runs, tokens, cost } : null,
        lastUsage: lastTokens > 0 ? { tokens: lastTokens, contextLimit: lastLimit } : null,
        task: !enabled ? 'off' : leaseHit ? 'working' : 'idle',
      };
    });
}

function padEnd(s, w) {
  const t = String(s ?? '');
  return t.length >= w ? t : t + ' '.repeat(w - t.length);
}

function trunc(s, w) {
  const t = String(s ?? '');
  return t.length > w ? `${t.slice(0, w - 1)}…` : t;
}

function sessionCell(r) {
  if (r.sessionId) return trunc(r.sessionId, 9);
  if (r.foreignSession) return 'other-proj';
  return '—';
}

/**
 * Session usage for the compaction question: last-run tokens against the
 * context window, e.g. `310k (30%)`. Falls back to cumulative chat totals
 * when no last-run snapshot was persisted yet.
 */
export function usageCell(r) {
  const t = Number(r.lastUsage?.tokens) || 0;
  const limit = Number(r.lastUsage?.contextLimit) || 0;
  if (t > 0 && limit > 0) {
    const pct = Math.round((t / limit) * 100);
    return `${formatTokens(t)} (${pct}%)`;
  }
  if (t > 0) return formatTokens(t);
  if (!r.totals) return '—';
  // Cumulative chat totals. A council answer is a stateless one-shot — the
  // lane reports no token events for it (verified against the live CLI: no
  // step_finish on a text turn) — so a seat that only ever answers here has
  // runs but zero measured tokens. Show the honest parts only, never `·0`.
  const parts = [`${r.totals.runs} run${r.totals.runs === 1 ? '' : 's'}`];
  if ((Number(r.totals.tokens) || 0) > 0) parts.push(formatTokens(r.totals.tokens));
  const spend = Number(r.totals.cost) || 0;
  if (spend > 0) parts.push(`$${spend.toFixed(spend < 0.01 ? 5 : 4)}`);
  return parts.join('·');
}

/**
 * Monospace fleet-wide table for /status_all. Telegram has no table
 * rendering, so the table ships in a code fence with padded columns.
 * When every live bot shares model+agent those move to one `all:` line and
 * the table stays narrow enough for a phone; otherwise each row carries its
 * own Model/Agent columns. Disabled bots are not table rows — they get one
 * `off:` line. The answering bot is named so a group chat knows who
 * rendered it. Full per-bot detail stays behind each bot's own /status.
 */
export function formatFleetStatusTable(rows, { chatId, via } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const live = list.filter((r) => r.enabled !== false);
  const off = list.filter((r) => r.enabled === false);
  const uniform =
    live.length > 0 && live.every((r) => r.model === live[0].model && r.agent === live[0].agent);
  const head = `Fleet status · chat ${String(chatId ?? '')} · ${list.length} agent${list.length === 1 ? '' : 's'}${via ? ` (via ${via})` : ''}`;
  const out = [head];
  const roleCell = (r) => trunc(r.role || '—', 14);
  if (uniform) {
    const free = live[0].model && /free/i.test(live[0].model) ? ' (free)' : '';
    out.push(`all: ${live[0].model || '—'}${free} · ${live[0].agent || '—'}`);
    const W = { bot: 8, role: 14, sess: 9, task: 7, runs: 14 };
    out.push('```');
    out.push(`${padEnd('Bot', W.bot)} ${padEnd('Role', W.role)} ${padEnd('Session', W.sess)} ${padEnd('Task', W.task)} ${padEnd('Usage', W.runs)}`.trimEnd());
    for (const r of live) {
      out.push(
        `${padEnd(trunc(r.id, W.bot), W.bot)} ${padEnd(roleCell(r), W.role)} ${padEnd(sessionCell(r), W.sess)} ${padEnd(r.task, W.task)} ${padEnd(trunc(usageCell(r), W.runs), W.runs)}`.trimEnd(),
      );
    }
    out.push('```');
  } else {
    // Wide enough for a full model id ("opencode/nemotron-3.5-lightning-free" is
    // 38). A truncated lane name defeats the column — it cannot tell you which
    // lane ran. Only reached when the seats disagree, so the narrow uniform
    // table above is unaffected.
    const W = { bot: 8, role: 13, model: 38, agent: 5, sess: 9, task: 7, runs: 10 };
    out.push('```');
    out.push(
      `${padEnd('Bot', W.bot)} ${padEnd('Role', W.role)} ${padEnd('Model', W.model)} ${padEnd('Ag', W.agent)} ${padEnd('Session', W.sess)} ${padEnd('Task', W.task)} ${padEnd('Usage', W.runs)}`.trimEnd(),
    );
    for (const r of live) {
      out.push(
        `${padEnd(trunc(r.id, W.bot), W.bot)} ${padEnd(roleCell(r), W.role)} ${padEnd(trunc(r.model || '—', W.model), W.model)} ${padEnd(trunc(r.agent || '—', W.agent), W.agent)} ${padEnd(sessionCell(r), W.sess)} ${padEnd(r.task, W.task)} ${padEnd(trunc(usageCell(r), W.runs), W.runs)}`.trimEnd(),
      );
    }
    out.push('```');
  }
  if (off.length) out.push(`off: ${off.map((r) => r.id).join(', ')}`);
  return out.join('\n');
}

/** Clear in-memory caches (for sensor testing). */
export function resetFleetState() {
  fleetTicketsCache = { cachedAt: 0, rows: [] };
  fleetNodeHeartbeats.clear();
}
