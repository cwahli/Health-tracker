#!/usr/bin/env node
/**
 * agent-heartbeat.mjs — the liveness fact the hygiene cleaner trusts.
 *
 * A branch with a live heartbeat is never touched by `agent-hygiene.mjs`, no
 * matter how old it is or how red its CI is. That veto is the whole point: an
 * agent that is alive says so, cheaply, and the cleaner never has to guess.
 *
 * Usage:
 *   node scripts/agent-heartbeat.mjs --branch=agent/bot-12 [--note="probing lanes"]
 *   node scripts/agent-heartbeat.mjs --branch=agent/bot-12 --once   # single write, no loop
 *
 * Without --once it rewrites the file every 5 minutes until killed. Run it beside
 * the agent (same pattern as the poller-lease renewer): a dead agent stops beating
 * without needing an exit hook.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const arg = (name, fallback = '') => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};

export const HEARTBEAT_DIR = () => path.join(os.homedir(), '.local', 'state', 'bot-host', 'agent-heartbeat');
export const LIVE_MS = 6 * 3600 * 1000;

export function slug(branch) {
  return String(branch || '').replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/-+/g, '-').slice(0, 80) || 'unknown';
}

export function beat(branch, { note = '', home = os.homedir() } = {}) {
  const dir = path.join(home, '.local', 'state', 'bot-host', 'agent-heartbeat');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${slug(branch)}.json`);
  fs.writeFileSync(file, JSON.stringify({ pid: process.pid, branch, updatedAt: new Date().toISOString(), note: String(note).slice(0, 200) }) + '\n', { mode: 0o600 });
  return file;
}

/** A heartbeat counts only if it is fresh AND its process still runs. */
export function isLive(record, { now = Date.now() } = {}) {
  if (!record || !record.updatedAt || !record.pid) return false;
  if (now - new Date(record.updatedAt).getTime() > LIVE_MS) return false;
  try {
    process.kill(Number(record.pid), 0);
    return true;
  } catch {
    return false;
  }
}

export function readBeats({ home = os.homedir() } = {}) {
  const dir = path.join(home, '.local', 'state', 'bot-host', 'agent-heartbeat');
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
    } catch { /* a torn write is not a heartbeat */ }
  }
  return out;
}

async function main() {
  const branch = arg('branch', '');
  if (!branch) {
    console.error('  --branch=<name> is required');
    process.exitCode = 2;
    return;
  }
  const note = arg('note', '');
  const file = beat(branch, { note });
  console.log(`  heartbeat: ${branch} -> ${file} (pid ${process.pid})`);
  if (process.argv.includes('--once')) return;
  setInterval(() => {
    try {
      beat(branch, { note });
    } catch (err) {
      console.error(`  heartbeat failed: ${err.message}`);
    }
  }, 5 * 60 * 1000).unref?.();
  // Stay alive so the pid in the file keeps meaning "this agent runs".
  await new Promise(() => {});
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((err) => {
  console.error(`agent-heartbeat: ${err.message}`);
  process.exitCode = 1;
});
