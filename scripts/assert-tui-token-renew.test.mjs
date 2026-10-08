#!/usr/bin/env node
/**
 * assert-tui-token-renew.test.mjs — the sensor for a session outliving its token.
 *
 * Run: node scripts/assert-tui-token-renew.test.mjs
 *
 * WHY THIS EXISTS
 * ---------------
 * The operator opened a terminal on their phone, left it open, and it fell into
 * "Press ⏎ to Reconnect" forever. The gateway log named it exactly:
 *
 *   11:56:05  admitted bot=vm2 user=6218257274
 *   12:20:24  GET /tty2/token  token refused (bad token)
 *   12:20:24  GET /authz        authz refused (token expired)
 *   ... 26 refusals, no landing since
 *
 * TUI_SESSION_TTL_SEC is 900. The page outlived its own credential, and its only
 * recovery re-presented the same dead token, so the loop had no exit.
 *
 * These cases pin the fix and, just as importantly, pin what the fix must NOT
 * do: renewal is bounded, it is opt-in per endpoint, and it never widens which
 * bot may open which terminal.
 *
 * No network, no live bot, no state outside a throwaway temp dir.
 */

import assert from 'node:assert/strict';
import http from 'node:http';

import { createGateway, issueToken, verifyToken } from './tui-gateway.mjs';

const SECRET = 'test-secret-for-the-renewal-sensor';
const TTL = 900;
const GRACE = 3600;
const T0 = 1_750_000_000_000;
const CRED = Buffer.from('tty:pass').toString('base64');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL ${name}: ${err && err.message}`);
  }
}

/* ---------------------------------------------------------- verifyToken ---- */

check('a live token is admitted and is NOT a renewal', () => {
  const tok = issueToken({ botId: 'vm2', chatId: '42', secret: SECRET, ttlSec: TTL, now: T0 });
  const v = verifyToken(tok, SECRET, { now: T0 + 1000, renewGraceSec: GRACE });
  assert.equal(v.ok, true);
  assert.equal(v.renew, undefined, 'a live token must not be flagged as a renewal');
  assert.equal(v.botId, 'vm2');
  assert.equal(v.chatId, '42');
});

check('an expired token is refused when no grace is given — the old cliff', () => {
  const tok = issueToken({ botId: 'vm2', chatId: '42', secret: SECRET, ttlSec: TTL, now: T0 });
  const v = verifyToken(tok, SECRET, { now: T0 + (TTL + 1) * 1000 });
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'token expired');
});

check('renewal defaults OFF, so an unconfigured deployment keeps the cliff', () => {
  const tok = issueToken({ botId: 'vm2', chatId: '42', secret: SECRET, ttlSec: TTL, now: T0 });
  const v = verifyToken(tok, SECRET, { now: T0 + (TTL + 60) * 1000, renewGraceSec: 0 });
  assert.equal(v.ok, false, 'grace must be opt-in, not implicit');
});

check('an expired-but-signed token is admitted for renewal inside the grace', () => {
  const tok = issueToken({ botId: 'vm2', chatId: '42', secret: SECRET, ttlSec: TTL, now: T0 });
  const v = verifyToken(tok, SECRET, { now: T0 + (TTL + 60) * 1000, renewGraceSec: GRACE });
  assert.equal(v.ok, true);
  assert.equal(v.renew, true, 'it is a renewal, not a live credential');
  assert.equal(v.botId, 'vm2');
  assert.equal(v.chatId, '42');
});

check('the grace is BOUNDED — past it the token is dead again', () => {
  // Without this the renewal would be a permanent credential, which is the
  // failure mode a sliding session is supposed to avoid.
  const tok = issueToken({ botId: 'vm2', chatId: '42', secret: SECRET, ttlSec: TTL, now: T0 });
  const inside = verifyToken(tok, SECRET, { now: T0 + (TTL + GRACE - 5) * 1000, renewGraceSec: GRACE });
  assert.equal(inside.ok, true);
  const outside = verifyToken(tok, SECRET, { now: T0 + (TTL + GRACE + 60) * 1000, renewGraceSec: GRACE });
  assert.equal(outside.ok, false, 'an abandoned page must still die');
  assert.equal(outside.reason, 'token expired');
});

check('a forged signature is still refused inside the grace', () => {
  // The grace relaxes EXPIRY only. It must never relax the MAC.
  const tok = issueToken({ botId: 'vm2', chatId: '42', secret: SECRET, ttlSec: TTL, now: T0 });
  const [body, mac] = tok.split('.');
  const forged = `${body}.${'x'.repeat(mac.length)}`;
  const v = verifyToken(forged, SECRET, { now: T0 + (TTL + 60) * 1000, renewGraceSec: GRACE });
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'bad token');
});

/* --------------------------------------------------- the live sequence ----- */

/** Minimal request/response harness against a real gateway handler. */
function withGateway(env, fn) {
  return new Promise((resolve, reject) => {
    const handle = createGateway({ env, log: () => {} });
    const server = http.createServer((req, res) => {
      handle(req, res).catch(reject);
    });
    server.listen(0, '127.0.0.1', async () => {
      const { port } = server.address();
      try {
        await fn(`http://127.0.0.1:${port}`);
        resolve();
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

const ENV = {
  TUI_GATEWAY_SECRET: SECRET,
  TUI_SESSION_TTL_SEC: String(TTL),
  TUI_TOKEN_RENEW_GRACE_SEC: String(GRACE),
  TUI_TTYD_CREDENTIAL: CRED,
  TUI_TTYD_URL_VM2: 'http://127.0.0.1:1', // never reached: the token route is local
  TUI_BOT_TOKEN: 'x',
};

const run = [];
const checkAsync = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL ${name}: ${err && err.message}`);
  }
};

await checkAsync('the reported failure: ./token renews after the token has expired', async () => {
  await withGateway(ENV, async (base) => {
    const minted = issueToken({ botId: 'vm2', chatId: '42', secret: SECRET, ttlSec: TTL, now: Date.now() - (TTL + 120) * 1000 });
    const res = await fetch(`${base}/tty2/token`, { headers: { cookie: `__Host-tui_session=${encodeURIComponent(minted)}` } });
    assert.equal(res.status, 200, `expected the renewal to succeed, got ${res.status}`);
    const body = await res.json();
    assert.equal(body.token, CRED, 'ttyd’s credential is still what the page gets');
    const cookie = res.headers.get('set-cookie');
    assert.ok(cookie, 'a replacement cookie must be set or the next hop dies too');
    // The replacement must be genuinely fresh, not the dead token re-served.
    const fresh = decodeURIComponent(/__Host-tui_session=([^;]+)/.exec(cookie)[1]);
    const v = verifyToken(fresh, SECRET, { now: Date.now() });
    assert.equal(v.ok, true, 'the replacement must verify as live');
    assert.equal(v.renew, undefined);
    run.push('renew');
  });
});

await checkAsync('the renewal does NOT widen which bot may open which terminal', async () => {
  await withGateway(ENV, async (base) => {
    // A vm2 token asking for the vm2 route is fine; ask for a route whose bot it
    // is not, and the old refusal must still stand even though the token is
    // inside its renewal grace.
    const minted = issueToken({ botId: 'vm9', chatId: '42', secret: SECRET, ttlSec: TTL, now: Date.now() - (TTL + 60) * 1000 });
    const res = await fetch(`${base}/tty2/token`, { headers: { cookie: `__Host-tui_session=${encodeURIComponent(minted)}` } });
    assert.equal(res.status, 401, 'a foreign seat must still be refused');
    assert.match(await res.text(), /another bot/);
  });
});

await checkAsync('TUI_TOKEN_RENEW_GRACE_SEC=0 restores the hard cliff', async () => {
  await withGateway({ ...ENV, TUI_TOKEN_RENEW_GRACE_SEC: '0' }, async (base) => {
    const minted = issueToken({ botId: 'vm2', chatId: '42', secret: SECRET, ttlSec: TTL, now: Date.now() - (TTL + 60) * 1000 });
    const res = await fetch(`${base}/tty2/token`, { headers: { cookie: `__Host-tui_session=${encodeURIComponent(minted)}` } });
    assert.equal(res.status, 401, 'renewal must be switchable off without a code change');
  });
});

await checkAsync('a token far past its grace is still refused on ./token', async () => {
  await withGateway(ENV, async (base) => {
    const minted = issueToken({ botId: 'vm2', chatId: '42', secret: SECRET, ttlSec: TTL, now: Date.now() - (TTL + GRACE + 600) * 1000 });
    const res = await fetch(`${base}/tty2/token`, { headers: { cookie: `__Host-tui_session=${encodeURIComponent(minted)}` } });
    assert.equal(res.status, 401);
  });
});

await checkAsync('/authz stays strict: its Set-Cookie cannot reach the browser', async () => {
  // Caddy consumes the /authz response in an auth_request, so a replacement
  // cookie set there would be swallowed. Renewal must therefore happen on the
  // page's own fetch, and /authz must keep refusing an expired token rather
  // than admitting one it cannot re-credential.
  await withGateway(ENV, async (base) => {
    const minted = issueToken({ botId: 'vm2', chatId: '42', secret: SECRET, ttlSec: TTL, now: Date.now() - (TTL + 60) * 1000 });
    const res = await fetch(`${base}/authz`, { headers: { cookie: `__Host-tui_session=${encodeURIComponent(minted)}` } });
    assert.equal(res.status, 401, '/authz must not admit an expired token');
  });
});

await checkAsync('a LIVE token on /authz still passes, and gets no renewal cookie', async () => {
  await withGateway(ENV, async (base) => {
    const minted = issueToken({ botId: 'vm2', chatId: '42', secret: SECRET, ttlSec: TTL, now: Date.now() });
    const res = await fetch(`${base}/authz`, { headers: { cookie: `__Host-tui_session=${encodeURIComponent(minted)}` } });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('set-cookie'), null, 'no renewal on the normal path');
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
console.log(failed === 0 ? 'assert-tui-token-renew: PASS' : 'assert-tui-token-renew: FAIL');
process.exitCode = failed === 0 ? 0 : 1;
