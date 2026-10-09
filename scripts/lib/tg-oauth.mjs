/**
 * Telegram Mini App exchange for the one shell (META-1 P1).
 *
 * Not wired in. `scripts/tui-gateway.mjs` still admits every live route.
 * Importing this module does not listen, does not read a bot token from the
 * environment, and does not change a cookie the gateway already sets.
 *
 * `validateInitData` is the gateway check: drop `hash`, accept the check
 * string with or without `signature`, HMAC key is the literal "WebAppData"
 * and the bot token is the message, compare in constant time, and refuse
 * `auth_date` outside 5 minutes plus 60 seconds of future skew.
 *
 * `issueHtk` / `verifyHtk` follow the `htk.<payload>.<sig>` shape in
 * `server_auth.ts`. The payload is bound to (bot, chat, tab). The signature
 * compare is constant-time. The caller passes the secret. There is no
 * built-in default.
 *
 * The cookie name stays `__Host-tui_session` with the same attributes. When
 * the WebView has to hold the token itself, the place is Telegram
 * SecureStorage under the key `htk`, not `localStorage`.
 */
import crypto from 'node:crypto';

export const COOKIE_NAME = '__Host-tui_session';
export const MAX_AGE_SEC = 5 * 60;
export const SKEW_SEC = 60;
export const HTK_TTL_SEC = 900;
export const HTK_STORE = 'SecureStorage';
export const HTK_STORE_KEY = 'htk';
export const HTK_FORBIDDEN_STORE = 'localStorage';

/**
 * Validate a Mini App `initData` query string against one bot token.
 * Returns { ok, reason, user, chat, chatId, boundBy, authDate, queryId }.
 * Never throws.
 */
export function validateInitData(initData, botToken, { now = Date.now(), maxAgeSec = MAX_AGE_SEC, skewSec = SKEW_SEC } = {}) {
  const fail = (reason) => ({ ok: false, reason });
  if (!initData || !botToken) return fail('missing initData or bot token');

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return fail('no hash in initData');

  const pairs = [];
  const pairsWithSig = [];
  for (const [k, v] of params.entries()) {
    if (k === 'hash') continue;
    pairsWithSig.push(`${k}=${v}`);
    if (k === 'signature') continue;
    pairs.push(`${k}=${v}`);
  }
  pairs.sort();
  pairsWithSig.sort();

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hmac = (dcs) => crypto.createHmac('sha256', secretKey).update(dcs).digest('hex');
  const b = Buffer.from(hash, 'hex');
  const match = (dcs) => {
    const a = Buffer.from(hmac(dcs), 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };
  if (!match(pairs.join('\n')) && !match(pairsWithSig.join('\n'))) return fail('hash mismatch');

  const authDate = Number(params.get('auth_date') || 0);
  if (!Number.isFinite(authDate) || authDate <= 0) return fail('no auth_date');
  const ageSec = (now / 1000) - authDate;
  if (ageSec > maxAgeSec) return fail(`initData is ${Math.round(ageSec)}s old (max ${maxAgeSec}s)`);
  if (ageSec < -skewSec) return fail(`auth_date is ${Math.round(-ageSec)}s in the future`);

  let user = null;
  try {
    user = params.get('user') ? JSON.parse(params.get('user')) : null;
  } catch {
    return fail('user is not JSON');
  }
  if (!user || !user.id) return fail('no user in initData');

  let chat = null;
  try {
    chat = params.get('chat') ? JSON.parse(params.get('chat')) : null;
  } catch {
    return fail('chat is not JSON');
  }
  const chatId = String(chat?.id ?? user.id);
  const boundBy = chat?.id ? 'chat' : 'user';
  return { ok: true, reason: '', user, chat, chatId, boundBy, authDate, queryId: params.get('query_id') || '' };
}

function requireBinding(bot, chat, tab) {
  const clean = (value) => String(value || '').trim();
  const botId = clean(bot);
  const chatId = clean(chat);
  const tabId = clean(tab);
  if (!botId || !chatId || !tabId) return { ok: false, reason: 'bot, chat, and tab are required' };
  if (!/^[a-z0-9-]+$/.test(tabId)) return { ok: false, reason: 'tab is not a mini-app id' };
  return { ok: true, bot: botId, chat: chatId, tab: tabId };
}

function signPayload(b64Data, secret) {
  return crypto.createHmac('sha256', secret).update(b64Data).digest('base64url');
}

function signaturesMatch(sig, expected) {
  const a = Buffer.from(String(sig));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Sign an htk bound to (bot, chat, tab). `exp` is unix seconds.
 * Shape: `htk.<base64url json>.<base64url hmac>`.
 */
export function issueHtk({ bot, chat, tab, secret, ttlSec = HTK_TTL_SEC, now = Date.now() } = {}) {
  const bound = requireBinding(bot, chat, tab);
  if (!bound.ok) return '';
  if (!secret) return '';
  const exp = Math.floor(now / 1000) + ttlSec;
  const data = JSON.stringify({ bot: bound.bot, chat: bound.chat, tab: bound.tab, exp });
  const b64Data = Buffer.from(data, 'utf8').toString('base64url');
  return `htk.${b64Data}.${signPayload(b64Data, secret)}`;
}

/** Verify an htk. Returns the (bot, chat, tab) binding, or a refusal. */
export function verifyHtk(token, secret, { now = Date.now() } = {}) {
  const bad = (reason) => ({ ok: false, reason });
  if (!token || !secret || typeof token !== 'string' || !token.startsWith('htk.')) return bad('bad token');
  const parts = token.split('.');
  if (parts.length !== 3) return bad('bad token');
  const [, b64Data, sig] = parts;
  if (!signaturesMatch(sig, signPayload(b64Data, secret))) return bad('bad token');
  let payload;
  try {
    payload = JSON.parse(Buffer.from(b64Data, 'base64url').toString('utf8'));
  } catch {
    return bad('bad token');
  }
  const bound = requireBinding(payload.bot, payload.chat, payload.tab);
  if (!bound.ok) return bad('bad token');
  if (!payload.exp || payload.exp < Math.floor(now / 1000)) return bad('token expired');
  return { ok: true, bot: bound.bot, chat: bound.chat, tab: bound.tab, exp: payload.exp };
}

/** Same Set-Cookie attributes the gateway already uses for this name. */
export function sessionCookie(token, ttlSec = HTK_TTL_SEC) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${ttlSec}`;
}

/** Where a later client stores the htk. SecureStorage, never localStorage. */
export function htkClientStore() {
  return { store: HTK_STORE, key: HTK_STORE_KEY, forbidden: HTK_FORBIDDEN_STORE };
}

/**
 * One exchange: initData in, htk out, bound to (bot, chat, tab).
 * Chat comes from the signed initData. Bot and tab come from the caller.
 */
export function exchangeInitData({ initData, botToken, bot, tab, secret, now = Date.now(), ttlSec = HTK_TTL_SEC } = {}) {
  const verdict = validateInitData(initData, botToken, { now });
  if (!verdict.ok) return { ok: false, reason: verdict.reason };
  if (!secret) return { ok: false, reason: 'missing secret' };
  const htk = issueHtk({ bot, chat: verdict.chatId, tab, secret, ttlSec, now });
  if (!htk) return { ok: false, reason: 'bot, chat, and tab are required' };
  return {
    ok: true,
    htk,
    cookie: sessionCookie(htk, ttlSec),
    store: htkClientStore(),
    bot: String(bot).trim(),
    chat: verdict.chatId,
    tab: String(tab).trim(),
  };
}
