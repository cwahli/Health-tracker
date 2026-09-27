#!/usr/bin/env node
/**
 * scripts/bugctl-drain.mjs
 *
 * Replay `.bugctl-queue.jsonl` — the writes `bugctl` parked when the API was
 * unreachable.
 *
 * WHY: `bugctl flush` existed but nothing ever called it, so a bug write queued
 * during an API restart or a phone tunnel drop sat there forever, and the
 * bug-ticket skill told agents to "wait for `bugctl flush`" as though something
 * would run it. This is the drainer that something *can* call: a cron entry, a
 * bot turn, or a human.
 *
 * Safe to run repeatedly and safe to run unattended:
 *   - idempotent — replays whatever is queued, exits cleanly when empty
 *   - a row that fails to send is KEPT, never dropped
 *   - the queue is rewritten atomically (temp + rename)
 *   - bounded by --limit, and one bad row cannot stop the rest
 *
 *   node scripts/bugctl-drain.mjs              # drain, human-readable summary
 *   node scripts/bugctl-drain.mjs --json       # machine-readable
 *   node scripts/bugctl-drain.mjs --limit=50   # bound the work per run
 *
 * Exit 0 = queue empty or fully drained. Exit 1 = rows remain (a cron should
 * alert on this rather than treat it as done).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertOpTableMatches, planDrain, readQueueLines, writeQueueLines } from './lib/bug-intake.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? 'true'] : [a, 'true'];
  })
);

const BASE = (process.env.BUG_API_BASE || 'http://127.0.0.1:3000').replace(/\/$/, '');
const TOKEN = process.env.BUG_API_TOKEN || '';
const QUEUE_PATH = process.env.BUGCTL_QUEUE || path.join(REPO_ROOT, '.bugctl-queue.jsonl');
const TIMEOUT_MS = Number(args.timeout || 30000);

function out(obj) {
  if (args.json === 'true') process.stdout.write(`${JSON.stringify(obj)}\n`);
}

async function send(entry) {
  const headers = { 'Content-Type': 'application/json' };
  if (TOKEN) headers['X-Bug-Api-Token'] = TOKEN;
  const res = await fetch(`${BASE}${entry.path}`, {
    method: entry.method,
    headers,
    body: entry.body === undefined || entry.body === null ? undefined : JSON.stringify(entry.body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return { ok: res.ok, status: res.status };
}

async function main() {
  // Two sources of truth for queue routing is how a write ends up replayed to
  // the wrong route. Fail before touching the queue if bugctl's flush has moved.
  try {
    assertOpTableMatches(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'bugctl.mjs'), 'utf8'));
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }

  const lines = readQueueLines(QUEUE_PATH);
  if (!lines.length) {
    out({ message: 'queue empty', path: QUEUE_PATH, sent: 0, failed: 0, remaining: 0 });
    if (args.json !== 'true') console.log(`queue empty — ${QUEUE_PATH}`);
    return 0;
  }

  const limit = Math.max(1, Number(args.limit || lines.length));
  const { send: planned, keep, corrupt } = planDrain(lines);
  const batch = planned.slice(0, limit);

  const sent = [];
  const failed = [];

  for (const entry of batch) {
    try {
      const r = await send(entry);
      if (r.ok) sent.push(entry);
      else failed.push({ entry, reason: `HTTP ${r.status}` });
    } catch (err) {
      failed.push({ entry, reason: String(err?.message || err) });
    }
  }

  // The only rule: a row survives unless it was actually sent. That covers
  // failures, rows past --limit, unparseable lines, and ops with no route.
  const sentIdx = new Set(sent.map((e) => e.index));
  const remaining = lines.filter((_, i) => !sentIdx.has(i));
  writeQueueLines(QUEUE_PATH, remaining);

  const report = {
    queue: QUEUE_PATH,
    base: BASE,
    queued: lines.length,
    attempted: batch.length,
    sent: sent.length,
    failed: failed.length,
    corrupt,
    remaining: remaining.length,
    firstError: failed[0]?.reason || null,
  };

  if (args.json === 'true') {
    out(report);
  } else {
    console.log(`drain ${QUEUE_PATH} via ${BASE}`);
    console.log(`  queued ${report.queued} · sent ${report.sent} · failed ${report.failed} · still queued ${report.remaining}`);
    if (corrupt) console.log(`  ${corrupt} unparseable row(s) kept for inspection`);
    if (report.firstError) console.log(`  first error: ${report.firstError}`);
  }
  return report.remaining > 0 ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`bugctl-drain: ${err?.message || err}\n`);
    process.exit(1);
  });
