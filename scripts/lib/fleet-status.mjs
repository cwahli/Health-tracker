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

import { workerStatus } from './worker-presence.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..', '..');

export const FLEET_CACHE_TTL_MS = 15000;
export const DEFAULT_LOCATIONS = ['Mac', 'VM', 'Grok VM', 'Mobile', 'Collab'];

let fleetTicketsCache = { cachedAt: 0, rows: [] };
const fleetNodeHeartbeats = new Map();

/** Directory where local beats are persisted. */
export function fleetBeatsDir() {
  const dir = path.join(os.homedir(), '.local', 'state', 'fleet-beats');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {}
  return dir;
}

/** Record a distributed heartbeat from a machine/agent pane. */
export function recordFleetHeartbeat(data, { now = Date.now() } = {}) {
  if (!data || typeof data !== 'object') return { ok: false, error: 'invalid payload' };
  const location = String(data.location || 'Unknown').trim();
  const agent = String(data.agent || data.model || 'Unknown').trim();
  const phase = String(data.phase || data.status || 'working').trim();
  const task = String(data.task || data.sentence || '').slice(0, 240);
  const ticketKey = String(data.ticketKey || data.ticket || '').trim();
  const record = {
    location,
    agent,
    phase,
    task,
    ticketKey,
    updatedAt: new Date(now).toISOString(),
    updatedAtMs: now,
  };
  fleetNodeHeartbeats.set(location, record);

  // Persist to local disk cache
  try {
    const filePath = path.join(fleetBeatsDir(), `${location.toLowerCase().replace(/[^a-z0-9_-]/g, '_')}.json`);
    fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf8');
  } catch {}

  return { ok: true, node: record };
}

/**
 * Get terminal panes with lease-based TTL decay:
 * - < 2 min: working (or waiting_prompt)
 * - 2 to 10 min: idle
 * - > 10 min: offline
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

  // Iterate over known default locations
  for (const loc of DEFAULT_LOCATIONS) {
    seenLocations.add(loc);
    const beat = fleetNodeHeartbeats.get(loc);
    if (!beat) {
      let fallback = null;
      if (loc === 'VM') {
        try {
          const home = opts.home || os.homedir();
          const botHostStateDir = path.join(home, '.local', 'state', 'bot-host');
          if (fs.existsSync(botHostStateDir)) {
            let isWorking = false;
            let activeDetail = '';
            let activeBot = 'VM Bot (@VM_19485_bot)';
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
            fallback = {
              location: 'VM',
              agent: activeBot,
              status: isWorking ? 'working' : 'idle',
              task: isWorking ? activeDetail : 'Ready (polling Telegram)',
              ticketKey: '',
              updatedAt: new Date(now).toISOString(),
            };
          }
        } catch {}
      } else if (loc === 'Grok VM' || loc === 'Collab' || loc === 'Mobile') {
        try {
          const hostKey = loc === 'Grok VM' ? 'grok' : loc.toLowerCase();
          const ws = workerStatus(hostKey, { home: opts.home || os.homedir(), now });
          if (ws && ws.reachable) {
            fallback = {
              location: loc,
              agent: loc === 'Grok VM' ? 'Grok Worker' : `${loc} Worker`,
              status: 'idle',
              task: ws.standin ? 'Worker connected (standin)' : 'Worker connected',
              ticketKey: '',
              updatedAt: ws.lastSeen || new Date(now).toISOString(),
            };
          }
        } catch {}
      }

      if (fallback) {
        result.push(fallback);
        continue;
      }

      result.push({
        location: loc,
        agent: '—',
        status: 'offline',
        task: 'No reporter active',
        ticketKey: '',
        updatedAt: null,
      });
      continue;
    }
    const ageMs = Math.max(0, now - (beat.updatedAtMs || 0));
    let status = 'working';
    if (ageMs > 10 * 60 * 1000) {
      status = 'offline';
    } else if (ageMs > 2 * 60 * 1000) {
      status = 'idle';
    } else {
      status = beat.phase === 'working' ? 'working' : (beat.phase || 'working');
    }
    result.push({
      location: beat.location,
      agent: beat.agent,
      status,
      task: status === 'offline' ? 'Offline (lease expired)' : beat.task,
      ticketKey: beat.ticketKey,
      updatedAt: beat.updatedAt,
    });
  }

  // Include any extra locations reported dynamically
  for (const [loc, beat] of fleetNodeHeartbeats.entries()) {
    if (seenLocations.has(loc)) continue;
    const ageMs = Math.max(0, now - (beat.updatedAtMs || 0));
    let status = 'working';
    if (ageMs > 10 * 60 * 1000) {
      status = 'offline';
    } else if (ageMs > 2 * 60 * 1000) {
      status = 'idle';
    } else {
      status = beat.phase === 'working' ? 'working' : (beat.phase || 'working');
    }
    result.push({
      location: beat.location,
      agent: beat.agent,
      status,
      task: status === 'offline' ? 'Offline' : beat.task,
      ticketKey: beat.ticketKey,
      updatedAt: beat.updatedAt,
    });
  }

  return result;
}

/**
 * Read tickets from PM spreadsheet tab 'current' projecting the 8 human fields strictly by name.
 * Caches for 15s in memory. On failure, returns previous snapshot and age. Never writes to Google.
 */
export async function getFleetTickets({ env = process.env, root = REPO_ROOT } = {}) {
  const now = Date.now();
  if (fleetTicketsCache.cachedAt && now - fleetTicketsCache.cachedAt < FLEET_CACHE_TTL_MS && fleetTicketsCache.rows.length) {
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

              const idVal = getByName('id') || getByName('key') || String(idx + 1);
              return {
                id: idVal,
                originalRequest: getByName('Original request') || getByName('goal') || getByName('title') || '—',
                workDoneSoFar: getByName('Work done so far') || getByName('note') || '—',
                whatsLeftToDo: getByName("What's left to do") || getByName('todo') || '—',
                owner: getByName('Owner') || '—',
                status: getByName('Status') || 'Pending',
                completionProof: getByName('Completion proof') || getByName('proof') || '—',
                completionGate: getByName('Completion gate') || getByName('gate') || '—',
                lastActivity: getByName('last_activity') || getByName('built_at') || '—',
              };
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

/** Clear in-memory caches (for sensor testing). */
export function resetFleetState() {
  fleetTicketsCache = { cachedAt: 0, rows: [] };
  fleetNodeHeartbeats.clear();
}
