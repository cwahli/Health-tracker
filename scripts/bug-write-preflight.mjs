#!/usr/bin/env node
/**
 * bug-write-preflight — fail-fast route check before any bugctl write.
 *
 * Why this exists: bugctl's withFallback queues a write on HTTP 401/503 (or
 * network failure) and exits 0 with { queued: true }. A poller/disatcher that
 * only checks the exit code then reports "filed card #N" forever while nothing
 * landed. The bug API guard (bugWriteGuard, serverBugSnapshot.ts) allows
 * loopback writes with no token, but an off-box BASE with no BUG_API_TOKEN is
 * a guaranteed 401+queue. That misconfiguration must refuse LOUDLY (exit 2)
 * before any dispatch, never proceed to queue silently.
 *
 * Checks, in order:
 *   1. BUG_API_BASE parses (default http://127.0.0.1:3000, same as bugctl).
 *   2. Off-box (non-loopback host) with no BUG_API_TOKEN → refuse. Writes
 *      would 401 and queue; the queue is not a filing.
 *   3. Live read: GET <BASE>/api/bugs/queue must answer 2xx. A read never
 *      queues, so a failure here proves the route is dead — refuse.
 *   4. Off-box WITH a token passes, with a warning: a read cannot prove the
 *      token is valid (reads are unauthenticated), so callers must still check
 *      bugctl's JSON for { queued: true } after every write.
 *
 * Exit: 0 = route is writable (or read-proven live on loopback), 2 = refused.
 * Usage: node scripts/bug-write-preflight.mjs [--json]
 *        BUG_API_BASE=https://host node scripts/bug-write-preflight.mjs
 */

const BASE = (process.env.BUG_API_BASE || 'http://127.0.0.1:3000').replace(/\/$/, '');
const TOKEN = process.env.BUG_API_TOKEN || '';
const WANT_JSON = process.argv.includes('--json');

function say(obj) {
  if (WANT_JSON) {
    process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
  } else if (obj.ok) {
    process.stdout.write(`preflight ok: base=${obj.base} loopback=${obj.loopback} live=${obj.live}${obj.warning ? ` warning=${obj.warning}` : ''}\n`);
  } else {
    process.stderr.write(`preflight refused: ${obj.refused}\n  base=${obj.base} loopback=${obj.loopback} token=${obj.tokenPresent ? 'set' : 'unset'} live=${obj.live}\n`);
  }
}

function refuse(base, host, loopback, live, reason) {
  const obj = { ok: false, refused: reason, base, host, loopback, tokenPresent: Boolean(TOKEN), live };
  say(obj);
  process.exit(2);
}

function isLoopback(host) {
  const h = String(host || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h === '::1') return true;
  const v4 = h.split('.');
  if (v4.length === 4 && v4[0] === '127' && v4.every((p) => /^\d+$/.test(p) && Number(p) >= 0 && Number(p) <= 255)) return true;
  return false;
}

let url;
try {
  url = new URL(BASE);
} catch {
  refuse(BASE, '', false, false, `BUG_API_BASE does not parse: ${BASE}`);
}
const host = url.hostname;
const loopback = isLoopback(host);

if (!loopback && !TOKEN) {
  refuse(BASE, host, false, false,
    `off-box BASE (${host}) with BUG_API_TOKEN unset: bugWriteGuard would 401 every write and bugctl would queue it with exit 0. Run on the VM over loopback, or set BUG_API_TOKEN.`);
}

let live = false;
try {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  const headers = {};
  if (TOKEN) headers['X-Bug-Api-Token'] = TOKEN;
  const res = await fetch(`${BASE}/api/bugs/queue`, { headers, signal: ctl.signal });
  clearTimeout(t);
  live = res.ok;
} catch {
  live = false;
}
if (!live) {
  refuse(BASE, host, loopback, false,
    `no live read at ${BASE}/api/bugs/queue (unreachable or non-2xx). Dispatch needs a live API; the offline queue only replays writes.`);
}

const obj = {
  ok: true,
  base: BASE,
  host,
  loopback,
  tokenPresent: Boolean(TOKEN),
  live,
  ...(!loopback ? { warning: 'off-box with token: reads cannot prove the token is valid — every bugctl write must be checked for { queued: true }' } : {}),
};
say(obj);
