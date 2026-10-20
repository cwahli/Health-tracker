import crypto from 'crypto';
import { Router } from 'express';
import { d1Query, isD1Configured } from './server_d1.js';
import { findUserByEmail, signSessionToken } from './server_auth.js';

// WA-1..WA-3 — WhatsApp inverted-code login ("user sends us the code").
//
// The free path is the user-initiated 24h service window: the app shows an
// opaque session code, the user sends it TO our WhatsApp number via a
// prefilled wa.me link, Meta POSTs the inbound to our webhook, and we match
// the code to the pending session. We NEVER send WhatsApp messages
// (zero-reply policy): pure-inbound costs $0 in Meta fees at any volume,
// and there is no auth-template surface to approve or be billed for.
//
// Security load-bearing points (verify findings F2/G1-G8):
// - Every webhook POST must pass X-Hub-Signature-256 (HMAC-SHA256 of the
//   RAW body, App Secret — never the verify token), constant-time compare.
//   Without this anyone who learns the URL forges logins (CWE-345).
// - Session codes are opaque 128-bit CSPRNG tokens the user never types
//   (prefill sends them): single-use, 5-minute TTL, consume-on-success,
//   stored as sha256 hashes, canonical parse, ambiguous bodies rejected.
// - Identity is ONLY the signed-webhook sender (from / wa_id, BSUID-aware).
//   A client-claimed phone number is never trusted.

const CODE_TTL_MS = 5 * 60 * 1000;
const CODE_BYTES = 16; // 128-bit
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 5;
// /complete is polled by the waiting browser every 2s for up to CODE_TTL_MS
// (~150 POSTs per session), so it gets its own generous per-IP budget rather
// than sharing the tight issuance budget above.
const COMPLETE_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const COMPLETE_RATE_LIMIT_MAX = 300;
const SEEN_CACHE_MAX = 5000;

export function getWaConfig() {
  return {
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || '',
    appSecret: process.env.WHATSAPP_APP_SECRET || '',
    businessNumber: (process.env.WHATSAPP_BUSINESS_NUMBER || '').replace(/\D/g, ''),
  };
}

export function isWaLoginAvailable(): boolean {
  // The login surface needs a business number for the wa.me link. The
  // webhook secrets gate verification, not code issuance.
  return getWaConfig().businessNumber.length > 5;
}

// --- Webhook verification (WA-1) -------------------------------------------

export function verifyWebhookSignature(
  rawBody: Buffer,
  header: string | undefined,
  appSecret: string,
): boolean {
  if (!appSecret || !header || !header.startsWith('sha256=')) return false;
  const given = Buffer.from(header.slice('sha256='.length), 'hex');
  if (given.length !== 32) return false;
  const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest();
  if (given.length !== expected.length) return false;
  return crypto.timingSafeEqual(given, expected);
}

export function checkWebhookVerifyToken(
  mode: unknown,
  token: unknown,
  configuredToken: string,
): boolean {
  if (!configuredToken || mode !== 'subscribe' || typeof token !== 'string') return false;
  const a = Buffer.from(token, 'utf8');
  const b = Buffer.from(configuredToken, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// --- Session codes (WA-2) ---------------------------------------------------

export interface WaLoginCode {
  codeHash: string;
  sessionId: string;
  createdAt: number;
  expiresAt: number;
  consumedAt: number | null;
  waId: string | null;
  verifiedAt: number | null;
}

// In-memory fallback when D1 is offline (same pattern as server_auth.ts).
const memCodes = new Map<string, WaLoginCode>();
const memSeen = new Set<string>();
const memRate = new Map<string, number[]>();
const memCompleteRate = new Map<string, number[]>();

export function __resetWaMemoryForTests() {
  memCodes.clear();
  memSeen.clear();
  memRate.clear();
  memCompleteRate.clear();
}

function sha256hex(s: string): string {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

/** D1 rows are snake_case; the code works in camelCase. No mapping = the
 * D1 path silently misreads every guard (found live: verify passed by
 * accident, consume always refused). */
export function mapCodeRow(r: any): WaLoginCode {
  return {
    codeHash: r.code_hash,
    sessionId: r.session_id,
    createdAt: Number(r.created_at),
    expiresAt: Number(r.expires_at),
    consumedAt: r.consumed_at == null ? null : Number(r.consumed_at),
    waId: r.wa_id ?? null,
    verifiedAt: r.verified_at == null ? null : Number(r.verified_at),
  };
}

export function newSessionCode(): { sessionId: string; code: string } {
  return {
    sessionId: `wa_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`,
    code: `wa_${crypto.randomBytes(CODE_BYTES).toString('hex')}`,
  };
}

/** Canonical parse: extract the single opaque code from a message body. */
export function parseLoginCode(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const matches = text.match(/wa_[0-9a-f]{32}/gi);
  if (!matches || matches.length !== 1) return null; // none or ambiguous
  return matches[0].toLowerCase();
}

export async function storeLoginCode(rec: WaLoginCode): Promise<void> {
  if (isD1Configured()) {
    await d1Query(
      `INSERT INTO wa_login_codes (code_hash, session_id, created_at, expires_at, consumed_at, wa_id, verified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [rec.codeHash, rec.sessionId, rec.createdAt, rec.expiresAt, rec.consumedAt, rec.waId, rec.verifiedAt],
    );
    return;
  }
  memCodes.set(rec.codeHash, { ...rec });
}

export async function findLoginCodeByHash(codeHash: string): Promise<WaLoginCode | null> {
  if (isD1Configured()) {
    const res = await d1Query('SELECT * FROM wa_login_codes WHERE code_hash = ? LIMIT 1', [codeHash]);
    if (res.success && res.results.length > 0) return mapCodeRow(res.results[0]);
    return null;
  }
  return memCodes.get(codeHash) || null;
}

export async function findLoginCodeBySession(sessionId: string): Promise<WaLoginCode | null> {
  if (isD1Configured()) {
    const res = await d1Query('SELECT * FROM wa_login_codes WHERE session_id = ? LIMIT 1', [sessionId]);
    if (res.success && res.results.length > 0) return mapCodeRow(res.results[0]);
    return null;
  }
  for (const rec of memCodes.values()) {
    if (rec.sessionId === sessionId) return { ...rec };
  }
  return null;
}

export async function markCodeVerified(codeHash: string, waId: string, now: number): Promise<boolean> {
  const rec = await findLoginCodeByHash(codeHash);
  if (!rec || rec.consumedAt || rec.verifiedAt || rec.expiresAt <= now) return false;
  if (isD1Configured()) {
    const res = await d1Query(
      `UPDATE wa_login_codes SET wa_id = ?, verified_at = ?
       WHERE code_hash = ? AND verified_at IS NULL AND consumed_at IS NULL AND expires_at > ?`,
      [waId, now, codeHash, now],
    );
    // The WHERE clause is the single-use guard under concurrency: two tabs
    // racing the same code must not both win. D1 reports rows touched in
    // meta.changes — 0 means we lost the race (or the row expired between
    // the read above and this write). Missing meta (older API shape) falls
    // back to the pre-change success bit.
    if (!res.success) return false;
    if (typeof res.meta?.changes === 'number') return res.meta.changes === 1;
    return true;
  }
  const mem = memCodes.get(codeHash);
  if (!mem || mem.verifiedAt || mem.consumedAt || mem.expiresAt <= now) return false;
  mem.waId = waId;
  mem.verifiedAt = now;
  return true;
}

export async function consumeCode(sessionId: string, now: number): Promise<WaLoginCode | null> {
  const rec = await findLoginCodeBySession(sessionId);
  if (!rec || !rec.verifiedAt || rec.consumedAt || rec.expiresAt <= now) return null;
  if (isD1Configured()) {
    const res = await d1Query(
      `UPDATE wa_login_codes SET consumed_at = ?
       WHERE session_id = ? AND consumed_at IS NULL AND verified_at IS NOT NULL AND expires_at > ?`,
      [now, sessionId, now],
    );
    // Same race guard as markCodeVerified: changes === 0 means another
    // holder consumed first — report failure so only one login mints.
    if (!res.success) return null;
    if (typeof res.meta?.changes === 'number' && res.meta.changes !== 1) return null;
    return { ...rec, consumedAt: now };
  }
  const mem = [...memCodes.values()].find((r) => r.sessionId === sessionId);
  if (!mem || !mem.verifiedAt || mem.consumedAt || mem.expiresAt <= now) return null;
  mem.consumedAt = now;
  return { ...mem };
}

export async function hasSeenWamid(wamid: string): Promise<boolean> {
  if (isD1Configured()) {
    // Atomic claim: INSERT OR IGNORE + changes bit, no SELECT-then-INSERT
    // gap for concurrent same-wamid redeliveries to slip through.
    const ins = await d1Query('INSERT OR IGNORE INTO wa_webhook_seen (wamid, created_at) VALUES (?, ?)', [wamid, Date.now()]);
    if (typeof ins.meta?.changes === 'number') return ins.meta.changes === 0;
    // Legacy fallback (no meta shape): previous select-then-insert order.
    const res = await d1Query('SELECT wamid FROM wa_webhook_seen WHERE wamid = ? LIMIT 1', [wamid]);
    if (res.success && res.results.length > 0) return true;
    await d1Query('INSERT OR IGNORE INTO wa_webhook_seen (wamid, created_at) VALUES (?, ?)', [wamid, Date.now()]);
    return false;
  }
  if (memSeen.has(wamid)) return true;
  memSeen.add(wamid);
  if (memSeen.size > SEEN_CACHE_MAX) {
    const first = memSeen.values().next().value as string;
    memSeen.delete(first);
  }
  return false;
}

export function checkRequestRate(ip: string, now: number): boolean {
  const hits = (memRate.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (hits.length >= RATE_LIMIT_MAX) return false;
  hits.push(now);
  memRate.set(ip, hits);
  return true;
}

export function checkCompleteRate(ip: string, now: number): boolean {
  const hits = (memCompleteRate.get(ip) || []).filter((t) => now - t < COMPLETE_RATE_LIMIT_WINDOW_MS);
  if (hits.length >= COMPLETE_RATE_LIMIT_MAX) return false;
  hits.push(now);
  memCompleteRate.set(ip, hits);
  return true;
}

// --- Inbound sender identity (BSUID-aware) ----------------------------------
// Sole identity is the signed-webhook sender: messages[].from today,
// messages[].from_user_id (BSUID) or contacts[].wa_id as fallback.
// A client-claimed phone number is never trusted.
export interface WaInboundMessage {
  waId: string | null;
  text: string | null;
  wamid: string | null;
}

function senderFromMessage(msg: any, contactsWaId: string | null): WaInboundMessage {
  if (!msg || msg.type !== 'text') return { waId: null, text: null, wamid: typeof msg?.id === 'string' ? msg.id : null };
  const waId =
    (typeof msg.from === 'string' && msg.from) ||
    (typeof msg.from_user_id === 'string' && msg.from_user_id) ||
    contactsWaId ||
    null;
  const text = typeof msg.text?.body === 'string' ? msg.text.body : null;
  return { waId, text, wamid: typeof msg.id === 'string' ? msg.id : null };
}

/** Every text message in the POST: Meta may batch several entries, changes,
 * and messages in one delivery. Reading only messages[0] silently drops a
 * login code that arrives anywhere else in the batch. */
export function extractMessagesFromPayload(payload: any): WaInboundMessage[] {
  try {
    const entries = payload?.entry;
    if (!Array.isArray(entries)) return [];
    const out: WaInboundMessage[] = [];
    for (const entry of entries) {
      const changes = entry?.changes;
      if (!Array.isArray(changes)) continue;
      for (const change of changes) {
        const value = change?.value;
        const msgs = value?.messages;
        if (!Array.isArray(msgs)) continue;
        const contactsWaId =
          (typeof value?.contacts?.[0]?.wa_id === 'string' && value.contacts[0].wa_id) || null;
        for (const msg of msgs) out.push(senderFromMessage(msg, contactsWaId));
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function extractSenderFromPayload(payload: any): WaInboundMessage {
  const all = extractMessagesFromPayload(payload);
  return all[0] || { waId: null, text: null, wamid: null };
}

// --- Router -----------------------------------------------------------------

export const whatsappRouter = Router();

/** Meta verification handshake: GET with hub.mode=subscribe + verify token. */
whatsappRouter.get('/api/auth/whatsapp/webhook', (req, res) => {
  const { verifyToken } = getWaConfig();
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  if (!checkWebhookVerifyToken(mode, token, verifyToken)) {
    return res.status(403).send('Forbidden');
  }
  if (typeof challenge !== 'string' || challenge.length === 0) {
    return res.status(400).send('Missing challenge');
  }
  return res.status(200).send(challenge);
});

/** Inbound messages. Raw body required: mount express.raw() for this path. */
whatsappRouter.post('/api/auth/whatsapp/webhook', async (req, res) => {
  const { appSecret } = getWaConfig();
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
  if (!verifyWebhookSignature(raw, req.headers['x-hub-signature-256'] as string | undefined, appSecret)) {
    // Fail closed: without a verified signature (or without a configured
    // secret) nothing is processed. Never reveal which half failed.
    return res.status(401).send('Unauthorized');
  }
  let payload: any;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch {
    return res.status(200).send('ok');
  }
  const inbound = extractMessagesFromPayload(payload);
  for (const msg of inbound) {
    if (!msg.wamid) continue;
    if (await hasSeenWamid(msg.wamid)) continue; // at-least-once retry
    if (!msg.waId || !msg.text) continue; // statuses[], non-text: ack only
    const code = parseLoginCode(msg.text);
    if (!code) continue; // chatter without a code: ack only
    await markCodeVerified(sha256hex(code), msg.waId, Date.now());
  }
  return res.status(200).send('ok');
});

/** Public client config: is the surface on, and which number to message. */
whatsappRouter.get('/api/auth/whatsapp/config', (_req, res) => {
  const { businessNumber } = getWaConfig();
  return res.json({ enabled: isWaLoginAvailable(), businessNumber });
});

/** Issue a pending session code. Rate-limited per IP. */
whatsappRouter.post('/api/auth/whatsapp/request-code', async (req, res) => {
  if (!isWaLoginAvailable()) {
    // Fail fast instead of entering a 5-minute dead wait with no number to
    // message: the UI surfaces data.error via waUnavailable.
    return res.status(503).json({ error: 'WhatsApp login is not configured yet.' });
  }
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown';
  if (!checkRequestRate(ip, Date.now())) {
    return res.status(429).json({ error: 'Too many code requests. Try again later.' });
  }
  const { sessionId, code } = newSessionCode();
  const now = Date.now();
  await storeLoginCode({
    codeHash: sha256hex(code),
    sessionId,
    createdAt: now,
    expiresAt: now + CODE_TTL_MS,
    consumedAt: null,
    waId: null,
    verifiedAt: null,
  });
  if (isD1Configured()) {
    // Opportunistic purge: every issuance (including abandoned polls) leaves
    // a row otherwise. Best-effort, never fails the login.
    try {
      await d1Query('DELETE FROM wa_login_codes WHERE expires_at < ?', [now]);
    } catch {
      /* ignore */
    }
  }
  const { businessNumber } = getWaConfig();
  const waLink = businessNumber
    ? `https://wa.me/${businessNumber}?text=${encodeURIComponent(`LOGIN ${code}`)}`
    : '';
  return res.json({ success: true, sessionId, code, waLink, expiresInMs: CODE_TTL_MS });
});

/**
 * Complete login: single-use consume of a verified session, phone binding
 * (first-bind-wins: a number already bound logs into ITS account), then the
 * standard htk. session token. Zero WhatsApp messages are sent, ever.
 */
whatsappRouter.post('/api/auth/whatsapp/complete', async (req, res) => {
  const { sessionId } = req.body || {};
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
  const cip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown';
  if (!checkCompleteRate(cip, Date.now())) {
    return res.status(429).json({ error: 'Too many attempts. Try again later.' });
  }
  const rec = await consumeCode(String(sessionId), Date.now());
  if (!rec || !rec.waId) {
    return res.status(400).json({ error: 'Not verified yet or code expired.' });
  }
  const waId = rec.waId;
  const userId = `wa_${waId}`;
  const email = `wa_${waId}@whatsapp.local`;
  try {
    // Never collide with a real email account: resolve by id first.
    let user: any = null;
    if (isD1Configured()) {
      const byId = await d1Query('SELECT * FROM app_users WHERE id = ? LIMIT 1', [userId]);
      if (byId.success && byId.results.length > 0) user = byId.results[0];
      if (!user) {
        const byEmail = await findUserByEmail(email);
        if (byEmail && byEmail.id !== userId) {
          return res.status(409).json({ error: 'Number identity conflict. Contact support.' });
        }
      }
    }
    // Phone binding: first-bind-wins. A number already bound to an account
    // logs into that account (documented policy, not last-write-wins hijack).
    let boundUserId: string | null = null;
    if (isD1Configured()) {
      const bound = await d1Query<{ user_id: string }>('SELECT user_id FROM phone_bindings WHERE wa_id = ? LIMIT 1', [waId]);
      if (bound.success && bound.results.length > 0) {
        boundUserId = bound.results[0].user_id;
      } else {
        await d1Query('INSERT OR IGNORE INTO phone_bindings (wa_id, user_id, verified_at, created_at) VALUES (?, ?, ?, ?)', [
          waId,
          userId,
          Date.now(),
          Date.now(),
        ]);
        const recheck = await d1Query<{ user_id: string }>('SELECT user_id FROM phone_bindings WHERE wa_id = ? LIMIT 1', [waId]);
        if (recheck.success && recheck.results.length > 0) boundUserId = recheck.results[0].user_id;
      }
    } else {
      boundUserId = getMemBinding(waId) || userId;
      setMemBinding(waId, boundUserId);
    }
    const loginUserId = boundUserId || userId;
    if (!user || user.id !== loginUserId) {
      if (isD1Configured()) {
        const existing = await d1Query('SELECT * FROM app_users WHERE id = ? LIMIT 1', [loginUserId]);
        if (existing.success && existing.results.length > 0) {
          user = existing.results[0];
        } else if (loginUserId === userId) {
          const ins = await d1Query(
            `INSERT INTO app_users (id, email, password_hash, password_salt, nickname, user_type)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [userId, email, '', 'whatsapp-nopassword', 'WhatsApp User', 'Standard'],
          );
          if (!ins.success) return res.status(500).json({ error: 'Failed to create user' });
          user = { id: userId, email, nickname: 'WhatsApp User', user_type: 'Standard' };
        } else {
          return res.status(409).json({ error: 'Number identity conflict. Contact support.' });
        }
      } else {
        user = memUsers.get(loginUserId) || null;
        if (!user && loginUserId === userId) {
          user = { id: userId, email, nickname: 'WhatsApp User', user_type: 'Standard' };
          memUsers.set(userId, user);
        }
        if (!user) return res.status(409).json({ error: 'Number identity conflict. Contact support.' });
      }
    }
    const token = signSessionToken({
      uid: user.id,
      email: user.email,
      nickname: user.nickname,
      userType: user.user_type || 'Standard',
    });
    return res.json({
      success: true,
      token,
      userProfile: { uid: user.id, email: user.email, nickname: user.nickname, userType: user.user_type || 'Standard' },
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Login failed' });
  }
});

// In-memory user + binding fallback (mirrors server_auth.ts pattern).
const memUsers = new Map<string, any>();
const memBindingMap = new Map<string, string>();

function getMemBinding(waId: string): string | null {
  return memBindingMap.get(waId) || null;
}

function setMemBinding(waId: string, userId: string) {
  if (!memBindingMap.has(waId)) memBindingMap.set(waId, userId);
}

export function __resetWaUsersForTests() {
  memUsers.clear();
  memBindingMap.clear();
}
