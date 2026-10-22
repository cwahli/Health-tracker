#!/usr/bin/env node
/**
 * fleet-snapshot-push.mjs — Publish the local fleet dashboard to the gateway.
 *
 * The dashboard that owns the authoritative fleet rows (`fleet-status.py
 * --serve`, default http://127.0.0.1:8765/status.json) runs on a machine the
 * deployed gateway cannot dial back. This reporter reads that status.json and
 * POSTs it to the gateway's `/fleet/api/snapshot` door, so the Fleet mini-app
 * renders the same location / tool / model / status / task / allowance rows.
 *
 * Usage:
 *   node scripts/fleet-snapshot-push.mjs --once
 *   node scripts/fleet-snapshot-push.mjs --interval 5000
 *
 * Env / flags:
 *   FLEET_STATUS_URL   --source     default http://127.0.0.1:8765/status.json
 *   FLEET_GATEWAY_URL  --gateway    default https://app.health-tracker.co.uk
 *   FLEET_TELEMETRY_SECRET / TUI_GATEWAY_SECRET   --secret
 */
import process from 'node:process';
import fs from 'node:fs';

export function getArg(name, fallback = '') {
  const argv = process.argv;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === `--${name}`) {
      const next = argv[i + 1];
      // `--source URL` (space form) as well as bare boolean flags.
      return next && !next.startsWith('--') ? next : '1';
    }
    if (arg.startsWith(`--${name}=`)) return arg.slice(name.length + 3);
  }
  return fallback;
}

export function readSecretFile(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    const out = {};
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 1) continue;
      out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    }
    return out;
  } catch {
    return {};
  }
}

export async function pushSnapshot({
  sourceUrl = 'http://127.0.0.1:8765/status.json',
  gatewayUrl = 'https://app.health-tracker.co.uk',
  secret = '',
  fetchImpl = fetch,
} = {}) {
  const src = await fetchImpl(sourceUrl, { headers: { accept: 'application/json' }, cache: 'no-store' });
  if (!src.ok) return { ok: false, stage: 'source', status: src.status, error: `status.json returned ${src.status}` };
  const status = await src.json();
  if (!status || !Array.isArray(status.channels)) {
    return { ok: false, stage: 'source', error: 'status.json has no channels[]' };
  }

  const res = await fetchImpl(`${String(gatewayUrl).replace(/\/+$/, '')}/fleet/api/snapshot`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(secret ? { 'x-fleet-telemetry-secret': secret } : {}),
    },
    body: JSON.stringify({ source: 'fleet-status.py', status }),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = null; }
  if (!res.ok || !data?.ok) {
    return { ok: false, stage: 'gateway', status: res.status, error: data?.error || text.slice(0, 200) };
  }
  return { ok: true, rows: data.rows, receivedAt: data.receivedAt, stale: data.stale };
}

async function main() {
  const sourceUrl = getArg('source', process.env.FLEET_STATUS_URL || 'http://127.0.0.1:8765/status.json');
  const gatewayUrl = getArg('gateway', process.env.FLEET_GATEWAY_URL || 'https://app.health-tracker.co.uk');
  const secretFile = getArg('secret-file', '');
  const fileEnv = secretFile ? readSecretFile(secretFile) : {};
  const secret = getArg('secret', process.env.FLEET_TELEMETRY_SECRET || process.env.TUI_GATEWAY_SECRET || fileEnv.FLEET_TELEMETRY_SECRET || '');
  const interval = Math.max(1000, Number(getArg('interval', '5000')) || 5000);
  const once = process.argv.includes('--once');

  let lastState = '';
  const beat = async () => {
    try {
      const res = await pushSnapshot({ sourceUrl, gatewayUrl, secret });
      const key = res.ok ? `ok:${res.rows}` : `${res.stage}:${res.status || ''}:${res.error || ''}`;
      // One line per state change, not one per 5s push.
      if (key !== lastState) {
        lastState = key;
        if (res.ok) {
          console.log(`[fleet-snapshot] pushed ${res.rows} row(s) to ${gatewayUrl} at ${res.receivedAt || new Date().toISOString()}`);
        } else {
          console.warn(`[fleet-snapshot] ${res.stage} failed: ${res.error}`);
        }
      }
      return res;
    } catch (err) {
      const key = `error:${err.message}`;
      if (key !== lastState) {
        lastState = key;
        console.warn(`[fleet-snapshot] error: ${err.message}`);
      }
      return { ok: false, error: err.message };
    }
  };

  const first = await beat();
  if (once) return first;
  setInterval(beat, interval);
  await new Promise(() => {});
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`[fleet-snapshot] fatal: ${err.message}`);
    process.exit(1);
  });
}
