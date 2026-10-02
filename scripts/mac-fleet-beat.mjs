#!/usr/bin/env node
/**
 * mac-fleet-beat.mjs — Telemetry reporter for Mac location.
 *
 * Pushes active model, phase, task summary, and ticket ID to the gateway's
 * POST /fleet/api/heartbeat endpoint so the Telegram Mini-App (/fleet) displays
 * Mac status in real-time.
 *
 * Usage:
 *   node scripts/mac-fleet-beat.mjs --agent="Gemini 3.8 Flash (High)" --task="Planning /fleet mini-app" --once
 *   node scripts/mac-fleet-beat.mjs --agent="Gemini 3.8 Flash (High)" --task="Planning /fleet mini-app"   # runs loop
 */
import process from 'node:process';

export function getArg(name, fallback = '') {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const eq = hit.indexOf('=');
  return eq < 0 ? '1' : hit.slice(eq + 1);
}

export async function sendMacHeartbeat({
  location = 'Mac',
  agent = 'Gemini 3.8 Flash (High)',
  phase = 'working',
  task = 'Active',
  ticketKey = '',
  gatewayUrl = process.env.TUI_GATEWAY_URL || 'http://127.0.0.1:8897',
  secret = process.env.FLEET_TELEMETRY_SECRET || process.env.TUI_GATEWAY_SECRET || '',
} = {}) {
  const url = `${gatewayUrl.replace(/\/+$/, '')}/fleet/api/heartbeat`;
  const body = JSON.stringify({
    location,
    agent,
    phase,
    task,
    ticketKey,
    pid: process.pid,
    cwd: process.cwd(),
    timestamp: new Date().toISOString(),
  });

  const headers = {
    'content-type': 'application/json',
  };
  if (secret) {
    headers['x-fleet-telemetry-secret'] = secret;
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, status: res.status, error: text };
    }
    const data = await res.json();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function main() {
  const agent = getArg('agent', 'Gemini 3.8 Flash (High)');
  const task = getArg('task', 'Working');
  const phase = getArg('phase', 'working');
  const ticketKey = getArg('ticket', '');
  const gatewayUrl = getArg('gateway', process.env.TUI_GATEWAY_URL || 'http://127.0.0.1:8897');
  const once = process.argv.includes('--once');

  const res = await sendMacHeartbeat({ agent, task, phase, ticketKey, gatewayUrl });
  if (res.ok) {
    console.log(`[mac-fleet-beat] Heartbeat sent: ${agent} (${phase}) - "${task}"`);
  } else {
    console.warn(`[mac-fleet-beat] Warning: could not reach gateway at ${gatewayUrl}: ${res.error}`);
  }

  if (once) return;

  // Keep lease alive every 30s while process runs
  setInterval(async () => {
    const r = await sendMacHeartbeat({ agent, task, phase, ticketKey, gatewayUrl });
    if (r.ok) {
      console.log(`[mac-fleet-beat] Heartbeat refreshed at ${new Date().toISOString()}`);
    } else {
      console.warn(`[mac-fleet-beat] Heartbeat refresh failed: ${r.error}`);
    }
  }, 30 * 1000);

  await new Promise(() => {});
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`[mac-fleet-beat] Error: ${err.message}`);
  });
}
