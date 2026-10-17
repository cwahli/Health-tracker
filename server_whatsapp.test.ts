import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import express from 'express';
import {
  verifyWebhookSignature,
  checkWebhookVerifyToken,
  parseLoginCode,
  newSessionCode,
  mapCodeRow,
  storeLoginCode,
  findLoginCodeByHash,
  markCodeVerified,
  consumeCode,
  hasSeenWamid,
  checkRequestRate,
  extractSenderFromPayload,
  whatsappRouter,
  __resetWaMemoryForTests,
  __resetWaUsersForTests,
} from './server_whatsapp';
import { verifySessionToken } from './server_auth';

const SECRET = 'test-app-secret-123';
const TOKEN = 'test-verify-token-abc';

// Hermetic: the worktree .env carries live Cloudflare credentials, which
// would route the store through real D1. Strip them so tests pin the
// in-memory fallback deterministically.
const D1_ENV_KEYS = ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_D1_DATABASE_ID', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_D1_API_TOKEN'];
function stripD1Env() {
  for (const k of D1_ENV_KEYS) delete process.env[k];
}

function sign(raw: Buffer): string {
  return 'sha256=' + crypto.createHmac('sha256', SECRET).update(raw).digest('hex');
}

function metaPayload(bodyText: string, wamid = 'wamid.TEST1', from = '447700900123') {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '111',
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              contacts: [{ wa_id: from }],
              messages: [{ from, id: wamid, timestamp: '1700000000', type: 'text', text: { body: bodyText } }],
            },
            field: 'messages',
          },
        ],
      },
    ],
  };
}

describe('server_whatsapp: webhook signature (WA-1)', () => {
  it('accepts a valid signature', () => {
    const raw = Buffer.from(JSON.stringify({ a: 1 }));
    expect(verifyWebhookSignature(raw, sign(raw), SECRET)).toBe(true);
  });
  it('rejects wrong secret, missing/malformed header, empty secret', () => {
    const raw = Buffer.from('{}');
    expect(verifyWebhookSignature(raw, sign(raw), 'other-secret')).toBe(false);
    expect(verifyWebhookSignature(raw, undefined, SECRET)).toBe(false);
    expect(verifyWebhookSignature(raw, 'sha256=zzzz', SECRET)).toBe(false);
    expect(verifyWebhookSignature(raw, sign(raw), '')).toBe(false);
  });
  it('checks the verify-token handshake constant-time, fails closed', () => {
    expect(checkWebhookVerifyToken('subscribe', TOKEN, TOKEN)).toBe(true);
    expect(checkWebhookVerifyToken('subscribe', 'wrong', TOKEN)).toBe(false);
    expect(checkWebhookVerifyToken('unsubscribe', TOKEN, TOKEN)).toBe(false);
    expect(checkWebhookVerifyToken('subscribe', TOKEN, '')).toBe(false);
  });
});

describe('server_whatsapp: session codes (WA-2)', () => {
  beforeEach(() => {
    stripD1Env();
    __resetWaMemoryForTests();
    __resetWaUsersForTests();
  });

  it('mints unique opaque codes in the right shape', () => {
    const a = newSessionCode();
    const b = newSessionCode();
    expect(a.code).toMatch(/^wa_[0-9a-f]{32}$/);
    expect(a.code).not.toBe(b.code);
    expect(a.sessionId).not.toBe(b.sessionId);
  });

  it('parses exactly one code, rejects none/ambiguous/non-string', () => {
    expect(parseLoginCode('LOGIN wa_' + 'a'.repeat(32))).toBe('wa_' + 'a'.repeat(32));
    expect(parseLoginCode('hi LOGIN WA_' + 'B'.repeat(32) + ' thanks')).toBe('wa_' + 'b'.repeat(32));
    expect(parseLoginCode('hello there')).toBeNull();
    expect(parseLoginCode(`wa_${'a'.repeat(32)} and wa_${'b'.repeat(32)}`)).toBeNull();
    expect(parseLoginCode(42)).toBeNull();
  });

  it('maps raw D1 snake_case rows to camelCase (live D1-path bug class)', () => {
    const now = Date.now();
    const rec = mapCodeRow({
      code_hash: 'abc',
      session_id: 's1',
      created_at: now - 1000,
      expires_at: now + 1000,
      consumed_at: null,
      wa_id: '447700900123',
      verified_at: now,
    });
    expect(rec).toEqual({
      codeHash: 'abc',
      sessionId: 's1',
      createdAt: now - 1000,
      expiresAt: now + 1000,
      consumedAt: null,
      waId: '447700900123',
      verifiedAt: now,
    });
    // Guards must read mapped fields: verified+unexpired passes, consumed fails.
    expect(rec.verifiedAt).toBeTruthy();
    expect(rec.consumedAt).toBeNull();
    expect(rec.expiresAt > now).toBe(true);
  });

  it('verifies then single-use consumes; replay and expiry fail', async () => {
    const { sessionId, code } = newSessionCode();
    const now = Date.now();
    const hash = crypto.createHash('sha256').update(code).digest('hex');
    await storeLoginCode({ codeHash: hash, sessionId, createdAt: now, expiresAt: now + 300000, consumedAt: null, waId: null, verifiedAt: null });
    expect(await markCodeVerified(hash, '447700900123', now)).toBe(true);
    const used = await consumeCode(sessionId, now);
    expect(used?.waId).toBe('447700900123');
    expect(await consumeCode(sessionId, now)).toBeNull(); // replay
    expect(await findLoginCodeByHash('nope')).toBeNull();
  });

  it('refuses verify after expiry', async () => {
    const { sessionId, code } = newSessionCode();
    void sessionId;
    const hash = crypto.createHash('sha256').update(code).digest('hex');
    await storeLoginCode({ codeHash: hash, sessionId: 's', createdAt: 1, expiresAt: 2, consumedAt: null, waId: null, verifiedAt: null });
    expect(await markCodeVerified(hash, '447700900123', Date.now())).toBe(false);
  });

  it('rate-limits code issuance per IP', () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) expect(checkRequestRate('1.2.3.4', now)).toBe(true);
    expect(checkRequestRate('1.2.3.4', now)).toBe(false);
    expect(checkRequestRate('5.6.7.8', now)).toBe(true);
  });

  it('dedupes webhook ids', async () => {
    expect(await hasSeenWamid('wamid.X')).toBe(false);
    expect(await hasSeenWamid('wamid.X')).toBe(true);
  });

  it('extracts sender BSUID-aware, ignores non-text', () => {
    const { waId, text, wamid } = extractSenderFromPayload(metaPayload('LOGIN hi'));
    expect(waId).toBe('447700900123');
    expect(text).toBe('LOGIN hi');
    expect(wamid).toBe('wamid.TEST1');
    const nonText = JSON.parse(JSON.stringify(metaPayload('x')));
    nonText.entry[0].changes[0].value.messages[0].type = 'image';
    expect(extractSenderFromPayload(nonText).text).toBeNull();
    // from_user_id fallback (BSUID future)
    const bsuid = JSON.parse(JSON.stringify(metaPayload('LOGIN x')));
    delete (bsuid.entry[0].changes[0].value.messages[0] as any).from;
    (bsuid.entry[0].changes[0].value.messages[0] as any).from_user_id = 'bsuid-9';
    expect(extractSenderFromPayload(bsuid).waId).toBe('bsuid-9');
  });
});

describe('server_whatsapp: HTTP flow (WA-1..WA-3)', () => {
  let server: any;
  let base = '';
  const envBackup = { ...process.env };

  beforeEach(async () => {
    stripD1Env();
    __resetWaMemoryForTests();
    __resetWaUsersForTests();
    process.env.WHATSAPP_VERIFY_TOKEN = TOKEN;
    process.env.WHATSAPP_APP_SECRET = SECRET;
    process.env.WHATSAPP_BUSINESS_NUMBER = '447700900999';
    const app = express();
    app.use('/api/auth/whatsapp/webhook', express.raw({ type: 'application/json', limit: '1mb' }));
    app.use(express.json({ limit: '15mb' }));
    app.use(whatsappRouter);
    server = await new Promise<any>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    base = `http://127.0.0.1:${(server.address() as any).port}`;
  });

  afterEach(async () => {
    process.env = { ...envBackup };
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  it('handshakes GET verify, 403 on bad token', async () => {
    const ok = await fetch(`${base}/api/auth/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${TOKEN}&hub.challenge=CHAL`);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('CHAL');
    const bad = await fetch(`${base}/api/auth/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=CHAL`);
    expect(bad.status).toBe(403);
  });

  it('full flow: request -> signed inbound -> complete -> htk token; replay dead', async () => {
    const rc = await (await fetch(`${base}/api/auth/whatsapp/request-code`, { method: 'POST' })).json();
    expect(rc.success).toBe(true);
    expect(rc.waLink).toContain('wa.me/447700900999');

    // complete before verification fails
    const early = await (
      await fetch(`${base}/api/auth/whatsapp/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: rc.sessionId }),
      })
    ).json();
    expect(early.error).toBeTruthy();

    // forged webhook: 401, code stays unverified
    const forgedRaw = Buffer.from(JSON.stringify(metaPayload(`LOGIN ${rc.code}`, 'wamid.FORGE')));
    const forged = await fetch(`${base}/api/auth/whatsapp/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': 'sha256=' + '0'.repeat(64) },
      body: forgedRaw,
    });
    expect(forged.status).toBe(401);

    // real signed inbound verifies the session
    const raw = Buffer.from(JSON.stringify(metaPayload(`please LOGIN ${rc.code} thanks`, 'wamid.REAL1')));
    const inbound = await fetch(`${base}/api/auth/whatsapp/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sign(raw) },
      body: raw,
    });
    expect(inbound.status).toBe(200);

    // at-least-once retry of the same wamid is acked, harmless
    const retry = await fetch(`${base}/api/auth/whatsapp/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sign(raw) },
      body: raw,
    });
    expect(retry.status).toBe(200);

    const done = await (
      await fetch(`${base}/api/auth/whatsapp/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: rc.sessionId }),
      })
    ).json();
    expect(done.success).toBe(true);
    expect(done.token).toMatch(/^htk\./);
    const session = verifySessionToken(done.token);
    expect(session?.uid).toBe(done.userProfile.uid);

    // replay of complete is dead (single-use)
    const replay = await (
      await fetch(`${base}/api/auth/whatsapp/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: rc.sessionId }),
      })
    ).json();
    expect(replay.error).toBeTruthy();
  });

  it('shared number logs into the bound account (first-bind-wins)', async () => {
    const mk = async () =>
      (await (
        await fetch(`${base}/api/auth/whatsapp/request-code`, { method: 'POST' })
      ).json()) as any;
    const rc1 = await mk();
    const raw1 = Buffer.from(JSON.stringify(metaPayload(`LOGIN ${rc1.code}`, 'wamid.S1')));
    await fetch(`${base}/api/auth/whatsapp/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sign(raw1) },
      body: raw1,
    });
    const done1 = await (
      await fetch(`${base}/api/auth/whatsapp/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: rc1.sessionId }),
      })
    ).json();
    // second device, same WhatsApp number
    const rc2 = await mk();
    const raw2 = Buffer.from(JSON.stringify(metaPayload(`LOGIN ${rc2.code}`, 'wamid.S2')));
    await fetch(`${base}/api/auth/whatsapp/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sign(raw2) },
      body: raw2,
    });
    const done2 = await (
      await fetch(`${base}/api/auth/whatsapp/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: rc2.sessionId }),
      })
    ).json();
    expect(done2.success).toBe(true);
    expect(done2.userProfile.uid).toBe(done1.userProfile.uid);
  });

  it('config endpoint reports the surface', async () => {
    const cfg = await (await fetch(`${base}/api/auth/whatsapp/config`)).json();
    expect(cfg).toEqual({ enabled: true, businessNumber: '447700900999' });
  });
});
