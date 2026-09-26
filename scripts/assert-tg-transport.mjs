#!/usr/bin/env node
/**
 * assert-tg-transport.mjs — BOT-9 transport hardening gate.
 *
 * Proves the 409/429 behavior in code, not prose:
 *  1. Throttle.noteHeaders pauses on x-ratelimit-remaining: 0, honors a
 *     retry-after hint, ignores absent headers, and never shortens a pause.
 *  2. TelegramApi stores a string token and invokes the onHeaders hook with
 *     each response's headers (fake fetch, no network).
 *  3. collab-bot.mjs constructs TelegramApi with the token string, exits
 *     loudly on 409, and pauses on 429 (mirrors bot-host).
 *  4. bot-host.mjs keeps its 409 exit and 429 pause wiring (regression).
 *
 * Exit 0 on all pass; exit 1 with FAIL lines otherwise.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail++;
    failures.push(name + (detail ? ` — ${detail}` : ''));
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

console.log('assert-tg-transport (BOT-9)\n');

const { Throttle } = await import(
  new URL(`file://${path.join(ROOT, 'scripts/lib/tg-throttle.mjs').replace(/\\/g, '/')}`).href
);
const { TelegramApi } = await import(
  new URL(`file://${path.join(ROOT, 'scripts/lib/tg-api.mjs').replace(/\\/g, '/')}`).href
);

// 1. Proactive header slowdown.
{
  let now = 1000000;
  const t = new Throttle({ minIntervalMs: 0, now: () => now, sleep: async () => {} });
  check('absent headers apply nothing', t.noteHeaders(null) === 0 && t.pausedUntil === 0);
  check('healthy remaining applies nothing',
    t.noteHeaders({ get: () => '10' }) === 0 && t.pausedUntil === 0);
  const until = t.noteHeaders({ get: (k) => (k === 'x-ratelimit-remaining' ? '0' : k === 'retry-after' ? '7' : null) });
  check('remaining:0 pauses for retry-after', until === 1000000 + 7000 && t.pausedUntil === until);
  now = 1001000;
  t.noteHeaders({ 'x-ratelimit-remaining': '0', 'retry-after': '1' });
  check('never shortens an existing pause', t.pausedUntil === 1000000 + 7000);
  check('plain-object headers work',
    new Throttle({ now: () => 0, sleep: async () => {} }).noteHeaders({ 'x-ratelimit-remaining': 0 }) > 0);
}

// 2. onHeaders hook with a fake fetch.
{
  const seen = [];
  const fakeFetch = async () => ({
    headers: { get: (k) => (k === 'x-ratelimit-remaining' ? '0' : null) },
    async json() { return { ok: true, result: true }; },
  });
  const api = new TelegramApi('tok123', { fetchImpl: fakeFetch, onHeaders: (h) => seen.push(h) });
  check('token stored as string', api.token === 'tok123');
  await api.call('getMe');
  check('onHeaders invoked with response headers', seen.length === 1);
  const silent = new TelegramApi('tok123', {
    fetchImpl: fakeFetch,
    onHeaders: () => { throw new Error('hook must not break calls'); },
  });
  check('throwing hook never breaks a call', (await silent.call('getMe')) === true);
}

// 3. collab-bot wiring.
{
  const src = read('scripts/collab-bot.mjs');
  check('collab constructs TelegramApi with the token string', src.includes('new TelegramApi(token'));
  check('collab never passes an object token', !src.includes('new TelegramApi({ token })'));
  check('collab wires onHeaders to the throttle', src.includes('onHeaders') && src.includes('noteHeaders'));
  check('collab exits loudly on 409', src.includes('err.isConflict') && src.includes('process.exit(1)'));
  check('collab pauses on 429', src.includes('err.isRateLimit') && src.includes('throttle.pause(wait)'));
}

// 4. bot-host regression.
{
  const src = read('scripts/bot-host.mjs');
  check('bot-host keeps the 409 loud exit', src.includes('409 Conflict') && src.includes('Exiting.'));
  check('bot-host keeps the 429 throttle pause', src.includes('throttle.pause(err.retryAfter)'));
  check('the long-poll hold is env-overridable, default 30', /timeout: Number\(process\.env\.TG_POLL_TIMEOUT\) \|\| 30/.test(src));
}

console.log(`\n${pass} pass, ${fail} fail`);
if (fail > 0) {
  console.error('\nFailures:\n' + failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
