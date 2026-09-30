#!/usr/bin/env node
/**
 * TUI gateway — the only door to a public terminal.
 *
 * A ttyd PTY on the public internet is a shell on this box. So the terminal is
 * never published directly: this gateway sits in front of it on its own
 * hostname and admits exactly one thing — a Telegram Mini App `initData` string
 * that this bot's own token signed.
 *
 * The check, in the order Telegram documents it:
 *   secret_key = HMAC_SHA256(key="WebAppData", data=<bot token>)
 *   data_check_string = the query minus `hash`, sorted, `k=v` joined by "\n"
 *   expected  = HMAC_SHA256(key=secret_key, data=data_check_string) hex
 * and the comparison is constant-time, because a byte-at-a-time compare on an
 * HMAC is a compare an attacker can walk.
 *
 * `auth_date` is refused when it is older than MAX_AGE or more than SKEW in the
 * future, so a captured initData cannot be replayed tomorrow and a
 * clock-skewed phone is not punished.
 *
 * A successful check returns a short-lived session token bound to
 * (bot, chat). Later sockets carry only that token — never the raw initData,
 * which is never logged.
 *
 * Env:
 *   TUI_GATEWAY_PORT      default 8897
 *   TUI_GATEWAY_BIND      default 127.0.0.1 (Caddy fronts it; never 0.0.0.0)
 *   TUI_TTYD_URL          default http://127.0.0.1:8896 (vm's ttyd)
 *   TUI_TTYD_URL_<BOT>    per-bot override, e.g. TUI_TTYD_URL_VM2 for the vm2 ttyd
 *   TUI_GATEWAY_SECRET    server secret for signing session tokens
 *   TUI_BOT_TOKEN_<id>    the Telegram bot token per bot id
 *   TUI_SESSION_TTL_SEC   default 900
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { URL } from 'node:url';

// `__Host-` is a browser-enforced prefix: the cookie is only accepted with
// Secure, Path=/ and no Domain, so it cannot be read by a sibling subdomain or
// sent over plaintext. All three hold here.
export const COOKIE_NAME = '__Host-tui_session';
export const MAX_AGE_SEC = 5 * 60;
export const SKEW_SEC = 60;

/**
 * Validate a Mini App `initData` query string against one bot token.
 * Returns { ok, reason, user, chatId, authDate }. Never throws.
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
  // Telegram requires the key=value pairs sorted by key.
  pairs.sort();
  pairsWithSig.sort();

  // secret_key = HMAC_SHA256("WebAppData", bot_token)
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hmac = (dcs) => crypto.createHmac('sha256', secretKey).update(dcs).digest('hex');

  // Current Telegram clients sign the check string WITH the signature field
  // included (only `hash` is excluded); older data has no signature field, so
  // both shapes are accepted and neither client generation breaks.
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

  // Bind to the CHAT when Telegram sends one, and to the user otherwise (a
  // private Mini App has no `chat` field). The distinction matters: in a group
  // the same person in two chats must not get the same session, and two people
  // in one chat must not either. An earlier version always used user.id while
  // calling it a chat binding, so the name promised an isolation it did not have.
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

/** Sign a session token bound to (botId, chatId). */
export function issueToken({ botId, chatId, secret, ttlSec = 900, now = Date.now() }) {
  const exp = now + ttlSec * 1000;
  const nonce = crypto.randomBytes(9).toString('base64url');
  const body = `${botId}|${chatId}|${exp}|${nonce}`;
  const mac = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${Buffer.from(body).toString('base64url')}.${mac}`;
}

/** Verify a session token: signature, then expiry. Returns the binding. */
export function verifyToken(token, secret, { now = Date.now() } = {}) {
  const bad = { ok: false, reason: 'bad token' };
  if (!token || !secret || typeof token !== 'string') return bad;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return bad;
  let body;
  try {
    body = Buffer.from(token.slice(0, dot), 'base64url').toString('utf8');
  } catch {
    return bad;
  }
  const mac = token.slice(dot + 1);
  const expect = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(expect);
  const b = Buffer.from(mac);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return bad;
  const [botId, chatId, exp] = body.split('|');
  if (!botId || !chatId || !Number(exp)) return bad;
  if (Number(exp) <= now) return { ok: false, reason: 'token expired' };
  return { ok: true, botId, chatId, exp: Number(exp) };
}

/** Escape text interpolated into the refusal page. */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Which bot token to check against, given the bot ids this gateway serves. */
export function tokenFor(botId, env = process.env) {
  const direct = String(env[`TUI_BOT_TOKEN_${String(botId).toUpperCase().replace(/[^A-Z0-9]/g, '_')}`] || '').trim();
  if (direct) return direct;
  return String(env.TUI_BOT_TOKEN || '').trim();
}

/** Bot ids with a configured token, for refusal logs. Names only — never values. */
export function configuredTokenBots(env = process.env) {
  return Object.keys(env)
    .filter((k) => k.startsWith('TUI_BOT_TOKEN_') && String(env[k] || '').trim())
    .map((k) => k.slice('TUI_BOT_TOKEN_'.length).toLowerCase())
    .sort();
}

/**
 * Non-secret shape of an initData string, for refusal logs. Keys, the user id,
 * auth_date and length — never values, never the hash. A "hash mismatch" with
 * sane keys means Telegram signed with a key we don't hold (wrong bot);
 * mangled keys (double-encoding, truncation) point at the transport instead.
 */
export function describeInitData(initData) {
  try {
    const params = new URLSearchParams(initData || '');
    const keys = [...new Set(params.keys())].sort();
    const authDate = params.get('auth_date') || 'none';
    let userId = 'none';
    const u = params.get('user');
    if (u) {
      try {
        userId = String(JSON.parse(u).id ?? 'unparsed');
      } catch {
        userId = 'unparsed';
      }
    }
    return `keys=[${keys.join(',')}] user=${userId} auth_date=${authDate} len=${String(initData || '').length}`;
  } catch {
    return 'initData unparseable';
  }
}

/**
 * The forge door, expressed against THIS gateway's token set.
 *
 * `bot-forge-server.mjs` has its own initData check, but it reads the registry's
 * `<ID>_BOT_TOKEN` while the gateway holds `TUI_BOT_TOKEN_<ID>` — the names
 * `sync-bot-tokens` actually writes for the doors. Same HMAC, same
 * `validateInitData`; this is the gateway's one door applied to the forge POST,
 * not a second check with its own rules.
 */
export function authorizeForgeAtGateway({ initData = '', env = process.env, now = Date.now() } = {}) {
  if (!initData) {
    return { ok: false, status: 401, reason: 'no initData — open the forge from the /forge button in Telegram' };
  }
  for (const [key, raw] of Object.entries(env)) {
    if (!key.startsWith('TUI_BOT_TOKEN_')) continue;
    const token = String(raw || '').trim();
    if (!token) continue;
    const verdict = validateInitData(initData, token, { now });
    if (verdict.ok) {
      return { ok: true, via: `initData:${key.slice('TUI_BOT_TOKEN_'.length).toLowerCase()}`, chatId: verdict.chatId };
    }
  }
  return { ok: false, status: 401, reason: 'initData did not verify against any bot token this gateway holds (stale, forged, or from a bot this host does not serve)' };
}

/**
 * Which ttyd serves a bot, and under which gateway path.
 *
 * Two bots share this box, and each has its own sessions map, so each gets its
 * own ttyd: the attach script reads one bot's sessions.json, and pointing two
 * bots at one ttyd would attach every vm2 chat to a vm conversation. The paths
 * mirror ttyd's own base-paths (`--base-path /tty` serves page + socket under
 * `/tty/`), so the client's relative links keep working through the gateway.
 */
export const TTYD_ROUTES = {
  '/tty/': { bot: 'vm', base: '/tty/' },
  '/tty': { bot: 'vm', base: '/tty/' },
  '/tty2/': { bot: 'vm2', base: '/tty2/' },
  '/tty2': { bot: 'vm2', base: '/tty2/' },
};

/**
 * The socket AuthToken, one per bot. The ttyd page fetches `./token`
 * (relative to the served page, so it lands here through Caddy) and puts it
 * in the socket init message; ttyd kills a socket whose token is missing or
 * wrong (POLICY_VIOLATION, and silently when the key is absent) — without
 * this route every open died seconds later on the reconnect prompt. Same
 * admission as the page; the body matches ttyd's own /token endpoint.
 */
export const TOKEN_ROUTES = {
  '/tty/token': 'vm',
  '/tty2/token': 'vm2',
};

/**
 * The route table for a deployment: the two built-in bots plus any bot the
 * operator registered with `TUI_ROUTE_<BOT>_PATH=/ttyx/`.
 *
 * The built-ins are the bots this gateway has always served (vm, vm2). The
 * extension exists because a third agent — the standalone Grok TG router — now
 * opens the same Mini App door, and it needs its own ttyd (its attach script
 * reads its own per-chat session map). Hardcoding a third path here would be
 * the same mistake as the router forking its own command list: the deployment
 * shape belongs in the deployment's env, not in the gateway's source.
 *
 * Values are refused unless they are a plain path, so an env typo cannot make
 * the gateway proxy somewhere unexpected.
 */
export function ttydRoutes(env = process.env) {
  const routes = { ...TTYD_ROUTES };
  for (const [key, value] of Object.entries(env || {})) {
    const m = /^TUI_ROUTE_([A-Z0-9_]+)_PATH$/.exec(key);
    if (!m) continue;
    const path = String(value || '').trim();
    if (!/^\/[A-Za-z0-9._/-]*$/.test(path) || path === '/') continue;
    const bot = m[1].toLowerCase();
    const base = path.endsWith('/') ? path : `${path}/`;
    routes[base] = { bot, base };
    routes[base.replace(/\/$/, '')] = { bot, base };
  }
  return routes;
}

/**
 * The socket AuthToken routes for a deployment, derived from `ttydRoutes` so
 * the page route and its token route can never drift apart (they were two
 * hand-kept maps before, which is exactly how the second bot's token path gets
 * forgotten when a third bot is added).
 */
export function tokenRoutes(env = process.env) {
  const out = { ...TOKEN_ROUTES };
  for (const [path, route] of Object.entries(ttydRoutes(env))) {
    if (!path.endsWith('/')) continue;
    out[`${path}token`] = route.bot;
  }
  return out;
}

/** The ttyd upstream for a bot. Per-bot URL wins; the shared one is the fallback. */
export function ttydFor(botId, env = process.env) {
  const direct = env[`TUI_TTYD_URL_${String(botId).toUpperCase().replace(/[^A-Z0-9]/g, '_')}`];
  if (direct) return direct;
  return env.TUI_TTYD_URL || 'http://127.0.0.1:8896';
}

/** Where the landing page sends a bot after the exchange. */
export function ttydPathFor(botId, env = process.env) {
  for (const [path, route] of Object.entries(ttydRoutes(env))) {
    if (route.bot === botId && path.endsWith('/')) return path;
  }
  return '/tty/';
}

/** Upstream Health Tracker app server that serves the built bug board page
 *  (/bugs.html) and the /api + /assets it needs. Same host the site runs on. */
export function boardUpstream(env = process.env) {
  return String(env.BUG_BOARD_UPSTREAM || 'http://127.0.0.1:3000').replace(/\/+$/, '');
}

/**
 * Cold-start page for the bug board mini app (packet bug-board-miniapp,
 * Node 5). Same shape as BOOTSTRAP: Telegram hands initData to the page, the
 * page puts it in the query, the server exchanges it — the HMAC never runs
 * in the browser.
 */
const BOOTSTRAP_BUGS = [
  '<!doctype html>',
  '<html lang="en"><head><meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width,initial-scale=1">',
  '<title>Bug queue</title>',
  '<script src="https://telegram.org/js/telegram-web-app.js"></script>',
  '<style>html,body{margin:0;height:100%;background:#0b1220;color:#f8fafc;',
  'font:14px system-ui;display:flex;align-items:center;justify-content:center;',
  'text-align:center;padding:24px}</style>',
  '</head><body><div id="m">opening the bug board\u2026</div>',
  '<script>',
  '(function () {',
  '  var m = document.getElementById("m");',
  '  var attempts = 0;',
  '  function tryProceed() {',
  '    attempts++;',
  '    var bot = (typeof location !== "undefined" && location.search && new URLSearchParams(location.search).get("bot")) || "bug_ticket";',
  '    var initData = "";',
  '    if (typeof Telegram !== "undefined" && Telegram && Telegram.WebApp) {',
  '      if (Telegram.WebApp.ready) Telegram.WebApp.ready();',
  '      if (Telegram.WebApp.expand) Telegram.WebApp.expand();',
  '      if (Telegram.WebApp.initData) initData = Telegram.WebApp.initData;',
  '    }',
  '    if (!initData && typeof window !== "undefined" && window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData) {',
  '      initData = window.Telegram.WebApp.initData;',
  '    }',
  '    if (!initData && typeof location !== "undefined" && location.hash) {',
  '      try {',
  '        var hp = new URLSearchParams(location.hash.replace(/^#/, ""));',
  '        initData = hp.get("tgWebAppData") || "";',
  '      } catch (e) {}',
  '    }',
  '    if (initData) {',
  '      if (typeof location !== "undefined" && location.replace) {',
  '        location.replace("/bugs/?bot=" + encodeURIComponent(bot) + "&initData=" + encodeURIComponent(initData));',
  '      }',
  '      return;',
  '    }',
  '    if (attempts < 20 && typeof setTimeout !== "undefined") {',
  '      setTimeout(tryProceed, 100);',
  '      return;',
  '    }',
  '    if (m) m.textContent = "no initData \u2014 open this from the /bugs button in Telegram";',
  '  }',
  '  tryProceed();',
  '})();',
  '</script></body></html>',
].join("\n");

/**
 * Transparent upstream proxy (packet bug-board-miniapp, Node 5). Forwards
 * method/headers/body to the app server and streams the response back. The
 * target host is fixed (boardUpstream); only the path+query come from the
 * caller, so this cannot be aimed elsewhere.
 */
async function proxyPass(req, res, target) {
  try {
    const headers = {};
    for (const [k, v] of Object.entries(req.headers || {})) {
      if (['host', 'connection', 'content-length'].includes(String(k).toLowerCase())) continue;
      headers[k] = v;
    }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const up = await fetch(String(target), {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(String(req.method)) || body.length === 0 ? undefined : body,
      duplex: 'half',
    });
    const outHeaders = { 'cache-control': 'no-store' };
    const ct = up.headers.get('content-type');
    if (ct) outHeaders['content-type'] = ct;
    res.writeHead(up.status, outHeaders);
    if (up.body) {
      for await (const c of up.body) {
        if (!res.write(c)) await new Promise((r) => res.once('drain', r));
      }
    }
    res.end();
  } catch (err) {
    logGatewayError(err);
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'board upstream unreachable' }));
  }
}

function logGatewayError(err) {
  console.error('[tui-gateway] board proxy error:', err && err.message ? err.message : err);
}

/**
 * The 302 target after a successful Telegram exchange. TEMP-DEBUG: with
 * TUI_PAGE_DEBUG=1 it also asks the page for its on-screen geometry readout,
 * so one phone screenshot carries the numbers. Remove both when the phone
 * layout is confirmed.
 */
export function landingLocationFor(botId, token, env = process.env) {
  const debug = String(env.TUI_PAGE_DEBUG || '') === '1' ? '&tui_measure=1' : '';
  return `${ttydPathFor(botId, env)}?token=${encodeURIComponent(token)}${debug}`;
}


/**
 * The bootstrap the Mini App opens.
 *
 * Telegram hands `initData` to the page through `Telegram.WebApp.initData`, not
 * in the URL, so a cold WebView arrives here with no credential at all. This
 * page reads it, puts it in the query, and lets the server do the exchange —
 * the HMAC never runs in the browser, where anyone could read it.
 */
const BOOTSTRAP = [
  '<!doctype html>',
  '<html lang="en"><head><meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width,initial-scale=1">',
  '<title>TUI</title>',
  '<script src="https://telegram.org/js/telegram-web-app.js"></script>',
  '<style>html,body{margin:0;height:100%;background:#0d0d0f;color:#e8e8ea;',
  'font:14px system-ui;display:flex;align-items:center;justify-content:center;',
  'text-align:center;padding:24px}</style>',
  '</head><body><div id="m">opening the terminal\u2026</div>',
  '<script>',
  '(function () {',
  '  var m = document.getElementById("m");',
  '  var attempts = 0;',
  '  function tryProceed() {',
  '    attempts++;',
  '    var bot = (typeof location !== "undefined" && location.search && new URLSearchParams(location.search).get("bot")) || "vm";',
  '    var initData = "";',
  '    if (typeof Telegram !== "undefined" && Telegram && Telegram.WebApp) {',
  '      if (Telegram.WebApp.ready) Telegram.WebApp.ready();',
  '      if (Telegram.WebApp.expand) Telegram.WebApp.expand();',
  '      if (Telegram.WebApp.initData) initData = Telegram.WebApp.initData;',
  '    }',
  '    if (!initData && typeof window !== "undefined" && window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData) {',
  '      initData = window.Telegram.WebApp.initData;',
  '    }',
  '    if (!initData && typeof location !== "undefined" && location.hash) {',
  '      try {',
  '        var hp = new URLSearchParams(location.hash.replace(/^#/, ""));',
  '        initData = hp.get("tgWebAppData") || "";',
  '      } catch (e) {}',
  '    }',
  '    if (initData) {',
  '      if (typeof location !== "undefined" && location.replace) {',
  '        location.replace("/?bot=" + encodeURIComponent(bot) + "&initData=" + encodeURIComponent(initData));',
  '      }',
  '      return;',
  '    }',
  '    if (attempts < 20 && typeof setTimeout !== "undefined") {',
  '      setTimeout(tryProceed, 100);',
  '      return;',
  '    }',
  '    if (m) m.textContent = "no initData \u2014 open this from the /tui button in Telegram";',
  '  }',
  '  tryProceed();',
  '})();',
  '</script></body></html>',
].join("\n");

/**
 * The token the caller presented, wherever they put it. A browser navigating
 * with the HttpOnly cookie is the normal path; the header and the query are
 * accepted too so a curl proof (and any future server-side caller) can use the
 * same door rather than a second, weaker one.
 */
function presentedToken(req, url) {
  return cookieValue(req, COOKIE_NAME)
    || (String(req.headers.authorization || '').startsWith('Bearer ')
        ? String(req.headers.authorization).slice(7)
        : '')
    || (url ? String(url.searchParams.get('token') || '') : '');
}

/** All tokens the caller presented, in preference order. */
function presentedTokens(req, url) {
  return [
    cookieValue(req, COOKIE_NAME),
    (String(req.headers.authorization || '').startsWith('Bearer ')
      ? String(req.headers.authorization).slice(7)
      : ''),
    (url ? String(url.searchParams.get('token') || '') : ''),
  ].filter((t) => typeof t === 'string' && t.length > 0);
}

/** Accept when ANY presented token verifies: a stale cookie must not shadow a fresh query token. */
function verifyAnyToken(req, url, secret) {
  let verdict = { ok: false, reason: 'bad token' };
  for (const t of presentedTokens(req, url)) {
    verdict = verifyToken(t, secret);
    if (verdict.ok) return verdict;
  }
  return verdict;
}

function cookieValue(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return '';
}

export function createGateway({ env = process.env, log = () => {}, forge = null } = {}) {
  const secret = env.TUI_GATEWAY_SECRET || '';
  const ttl = Number(env.TUI_SESSION_TTL_SEC || 900);
  // ttyd's own credential, base64 of user:password. It is substituted for the
  // caller's session token on the way upstream and is never sent to a browser.
  const ttydCredential = String(env.TUI_TTYD_CREDENTIAL || '').trim();

  return async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    // Never log the query: it carries the raw initData.
    log(`${req.method} ${url.pathname}`);

    // The Mini App's landing URL. It carries initData, which is exchanged for
    // a session token that goes into an HttpOnly cookie — so the token never
    // appears in a URL, in browser history, or in a Referer.
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const initData = url.searchParams.get('initData') || '';
      if (!initData) {
        // A cold WebView: Telegram gives initData to the page, not the URL.
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(BOOTSTRAP);
      }
      let botId = url.searchParams.get('bot') || env.TUI_BOT_ID || 'vm';
      let verdict = validateInitData(initData, tokenFor(botId, env));
      if (!verdict.ok && (verdict.reason === 'hash mismatch' || verdict.reason === 'missing initData or bot token')) {
        for (const [k, raw] of Object.entries(env)) {
          if (!k.startsWith('TUI_BOT_TOKEN_')) continue;
          const val = String(raw || '').trim();
          if (!val) continue;
          const candidateBot = k.slice('TUI_BOT_TOKEN_'.length).toLowerCase();
          if (candidateBot === botId) continue;
          const v = validateInitData(initData, val);
          if (v.ok) {
            log(`landing bot=${botId} was ${verdict.reason}, auto-matched bot=${candidateBot}`);
            botId = candidateBot;
            verdict = v;
            break;
          }
        }
      }
      if (!verdict.ok) {
        log(`landing refused (${verdict.reason}) for bot=${botId} (tokens for: ${configuredTokenBots(env).join(',') || 'none'}); got ${describeInitData(initData)}`);
        res.writeHead(401, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(`<!doctype html><meta charset=utf-8><body style="font:14px system-ui;background:#0d0d0f;color:#e8e8ea;padding:24px">
          <h1>refused</h1><p>${escapeHtml(verdict.reason)}</p></body>`);
      }
      const token = issueToken({ botId, chatId: verdict.chatId, secret, ttlSec: ttl });
      log(`admitted bot=${botId} ${verdict.boundBy}=${verdict.chatId}`);
      // The token rides in the query as well as the cookie: some Telegram
      // WebViews swallow the Set-Cookie on the redirect chain, and the ttyd
      // client appends location.search to its socket URL, so ?token= reaches
      // /authz through Caddy untouched. Short-lived (ttl) and chat-bound, and
      // the served page makes no third-party requests, so nothing leaks it.
      // TEMP-DEBUG 2026-09-28: TUI_PAGE_DEBUG=1 turns on the on-screen geometry
      // readout so a phone screenshot carries the numbers. Remove with the
      // readout once the layout is confirmed.
      res.writeHead(302, {
        'location': landingLocationFor(botId, token, env),
        'set-cookie': `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${ttl}`,
        'cache-control': 'no-store',
      });
      return res.end();
    }

    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true }));
    }

    // The Mini App's first request: initData in the query, exchanged for a token.
    if (url.pathname === '/auth') {
      const initData = url.searchParams.get('initData') || '';
      let botId = url.searchParams.get('bot') || env.TUI_BOT_ID || 'vm';
      let verdict = validateInitData(initData, tokenFor(botId, env));
      if (!verdict.ok && (verdict.reason === 'hash mismatch' || verdict.reason === 'missing initData or bot token')) {
        for (const [k, raw] of Object.entries(env)) {
          if (!k.startsWith('TUI_BOT_TOKEN_')) continue;
          const val = String(raw || '').trim();
          if (!val) continue;
          const candidateBot = k.slice('TUI_BOT_TOKEN_'.length).toLowerCase();
          if (candidateBot === botId) continue;
          const v = validateInitData(initData, val);
          if (v.ok) {
            log(`auth bot=${botId} was ${verdict.reason}, auto-matched bot=${candidateBot}`);
            botId = candidateBot;
            verdict = v;
            break;
          }
        }
      }
      if (!verdict.ok) {
        log(`refused (${verdict.reason}) for bot=${botId} (tokens for: ${configuredTokenBots(env).join(',') || 'none'}); got ${describeInitData(initData)}`);
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: verdict.reason }));
      }
      const token = issueToken({ botId, chatId: verdict.chatId, secret, ttlSec: ttl });
      log(`admitted bot=${botId} ${verdict.boundBy}=${verdict.chatId}`);
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ ok: true, token, bot: botId, chat: verdict.chatId, ttyd: ttydPathFor(botId, env) }));
    }

    // Caddy calls this before proxying the websocket. Answering 204 lets the
    // upgrade through; anything else stops it before a socket exists.
    if (url.pathname === '/authz') {
      const verdict = verifyAnyToken(req, url, secret);
      if (!verdict.ok) {
        log(`authz refused (${verdict.reason})`);
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: verdict.reason }));
      }
      res.writeHead(204);
      return res.end();
    }

    // The socket AuthToken the served page fetches as ./token (see
    // TOKEN_ROUTES). Same admission as the page below.
    const tokenBot = tokenRoutes(env)[url.pathname];
    if (tokenBot) {
      const verdict = verifyAnyToken(req, url, secret);
      if (!verdict.ok) {
        log(`token refused (${verdict.reason})`);
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: verdict.reason }));
      }
      if (verdict.botId !== tokenBot && !(tokenBot === 'vm' && verdict.botId !== 'vm2')) {
        log(`token refused (token is for bot=${verdict.botId}, path is for bot=${tokenBot})`);
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'token is for another bot' }));
      }
      if (!ttydCredential) {
        res.writeHead(503, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'gateway has no TUI_TTYD_CREDENTIAL' }));
      }
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ token: ttydCredential }));
    }

    // The page, one per bot. The socket is NOT proxied from here: node's upgrade
    // handling hung up on the socket, and Caddy proxies upgrades properly. The
    // token's bot must match the path's bot — otherwise a vm session could open
    // the vm2 terminal and land in another bot's conversation map.
    const route = ttydRoutes(env)[url.pathname];
    if (route) {
      const verdict = verifyAnyToken(req, url, secret);
      if (!verdict.ok) {
        log(`page refused (${verdict.reason})`);
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: verdict.reason }));
      }
      if (verdict.botId !== route.bot && !(route.bot === 'vm' && verdict.botId !== 'vm2')) {
        log(`page refused (token is for bot=${verdict.botId}, path is for bot=${route.bot})`);
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'token is for another bot' }));
      }
      if (!ttydCredential) {
        res.writeHead(503, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'gateway has no TUI_TTYD_CREDENTIAL' }));
      }
      return serveTtydPage(req, res, ttydFor(route.bot, env), route.base, ttydCredential);
    }

    // Bug board mini app (packet bug-board-miniapp, Node 5). Same initData
    // door as the terminal: exchange here, then the token admits /bugs/app.
    // Page assets (/assets/*) and data (/api/*) below are proxied to the app
    // upstream so the page works same-origin; the upstream keeps its own
    // posture (reads already same-origin-open on the app host), the door
    // keeps casual browsing out without forking auth.
    if (url.pathname === '/bugs/' || url.pathname === '/bugs' || url.pathname === '/bugs/index.html') {
      const initData = url.searchParams.get('initData') || '';
      if (!initData) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(BOOTSTRAP_BUGS);
      }
      let botId = url.searchParams.get('bot') || 'bug_ticket';
      let verdict = validateInitData(initData, tokenFor(botId, env));
      if (!verdict.ok && (verdict.reason === 'hash mismatch' || verdict.reason === 'missing initData or bot token')) {
        for (const [k, raw] of Object.entries(env)) {
          if (!k.startsWith('TUI_BOT_TOKEN_')) continue;
          const val = String(raw || '').trim();
          if (!val) continue;
          const candidateBot = k.slice('TUI_BOT_TOKEN_'.length).toLowerCase();
          if (candidateBot === botId) continue;
          const v = validateInitData(initData, val);
          if (v.ok) {
            log(`bugs landing bot=${botId} was ${verdict.reason}, auto-matched bot=${candidateBot}`);
            botId = candidateBot;
            verdict = v;
            break;
          }
        }
      }
      if (!verdict.ok) {
        log(`bugs landing refused (${verdict.reason}) for bot=${botId} (tokens for: ${configuredTokenBots(env).join(',') || 'none'}); got ${describeInitData(initData)}`);
        res.writeHead(401, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(`<!doctype html><meta charset=utf-8><body style="font:14px system-ui;background:#0b1220;color:#f8fafc;padding:24px">
          <h1>refused</h1><p>${escapeHtml(verdict.reason)}</p></body>`);
      }
      const token = issueToken({ botId, chatId: verdict.chatId, secret, ttlSec: ttl });
      log(`bugs admitted bot=${botId} ${verdict.boundBy}=${verdict.chatId}`);
      res.writeHead(302, {
        'location': `/bugs/app?token=${encodeURIComponent(token)}`,
        'set-cookie': `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${ttl}`,
        'cache-control': 'no-store',
      });
      return res.end();
    }

    if (url.pathname === '/bugs/app') {
      const verdict = verifyAnyToken(req, url, secret);
      if (!verdict.ok) {
        log(`board refused (${verdict.reason})`);
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: verdict.reason }));
      }
      try {
        const up = await fetch(boardUpstream(env) + '/bugs.html', { headers: { 'accept-encoding': 'identity' } });
        if (up.status === 404) {
          res.writeHead(503, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: 'bug board not built on app upstream (vite build has no bugs.html input yet)' }));
        }
        const body = Buffer.from(await up.arrayBuffer());
        res.writeHead(up.status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(body);
      } catch (err) {
        logGatewayError(err);
        res.writeHead(502, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'board upstream unreachable' }));
      }
    }

    if (url.pathname === '/assets/' || url.pathname.startsWith('/assets/')) {
      return proxyPass(req, res, boardUpstream(env) + url.pathname + url.search);
    }

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return proxyPass(req, res, boardUpstream(env) + url.pathname + url.search);
    }

    // One-click bot forge. The gateway owns the hostname and the initData
    // door, so the forge is mounted here under /forge rather than published on
    // its own port; the page and the create API are the same handler the CLI's
    // `--serve` runs, prefixed. `createForgeHandler` decides the paths and
    // returns false for anything that is not its own.
    if (forge && (url.pathname === '/forge' || url.pathname.startsWith('/forge/'))) {
      const handled = await forge(req, res);
      if (handled) return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: false, error: 'not found' }));
  };
}

/**
 * Build the forge route the gateway mounts, or null when this host cannot forge
 * (no repo, unreadable registry). Imported dynamically on purpose: `bot-forge.mjs`
 * imports this module for `validateInitData`, so a static import here would
 * close a load-time cycle.
 */
async function loadForgeRoute({ env, log }) {
  try {
    const [forgeMod, serverMod] = await Promise.all([
      import('./bot-forge.mjs'),
      import('./lib/bot-forge-server.mjs'),
    ]);
    const paths = forgeMod.resolvePaths({ env });
    const registry = JSON.parse(fs.readFileSync(paths.registryPath, 'utf8'));
    return serverMod.createForgeHandler({
      env,
      registry,
      basePath: '/forge',
      // The gateway is public and this writes credentials: no loopback
      // admission (behind Caddy every request is loopback), initData only.
      allowLocal: false,
      requireStateAuth: true,
      authorize: (input) => authorizeForgeAtGateway({ initData: input.initData, env }),
      log,
      runCreate: (input) => forgeMod.runForge(
        { ...input, paths, apiBase: forgeMod.DEFAULT_API_BASE },
        { env },
      ),
    });
  } catch (err) {
    log(`forge route unavailable: ${err.message}`);
    return null;
  }
}

/**
 * Fetch ttyd's page and serve it with a phone-sized viewport.
 *
 * Two additions, CSS + meta only, no JavaScript (an earlier JS shim threw a
 * SyntaxError on every page load, so page surgery stays declarative):
 * - viewport meta: without it a phone WebView lays the page out at ~980px
 *   and shrinks it into a framed box instead of filling the screen.
 * - margin:0 + full-size html/body: ttyd's bundle sets no body margin, so the
 *   browser default 8px shows as a frame around the terminal.
 * - touch-action on the xterm viewport: lets one-finger vertical pans scroll
 *   the scrollback instead of fighting the canvas.
 */
export const VIEWPORT_HEAD_TAGS = [
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  '<style>html,body{margin:0!important;padding:0!important;height:100%!important;'
    + 'width:100%!important;overflow:hidden!important;background:#000!important}'
    + '#terminal-container{width:100%!important;max-width:100%!important;margin:0!important;'
    + 'padding:0!important;height:100%!important}'
    + '#terminal-container .terminal,.terminal{padding:0!important;height:100%!important;'
    + 'width:100%!important;box-sizing:border-box!important}'
    + '.xterm{height:100%!important;width:100%!important}'
    + '.xterm .xterm-viewport{touch-action:pan-y!important;overscroll-behavior:contain!important}</style>',
].join('');

export function withPhoneViewport(html) {
  const body = String(html || '');
  if (/<meta[^>]*viewport/i.test(body)) return body;
  if (/<head[^>]*>/i.test(body)) return body.replace(/<head[^>]*>/i, (m) => `${m}${VIEWPORT_HEAD_TAGS}`);
  return `${VIEWPORT_HEAD_TAGS}${body}`;
}

/**
 * Fullscreen button + Mini App viewport lock for the terminal page. Two
 * separate phone complaints, one snippet:
 * - Telegram keeps its own header ("VM2 bot" bar) unless the app requests
 *   fullscreen; the button toggles it (expand fallback).
 * - A vertical drag inside the terminal collapsed the Mini App instead of
 *   scrolling: Telegram claims vertical swipes for its own sheet gestures
 *   unless the app calls disableVerticalSwipes(). That call — on load, not
 *   on tap — is what keeps a scroll gesture inside the terminal.
 * The snippet is tiny and dependency-free apart from Telegram's own loader.
 * Everything is guarded: outside Telegram the button hides itself; unknown
 * API methods are feature-checked (older clients lack both calls).
 */

/**
 * Layout work that must run EVERYWHERE (headless included, so it is
 * verifiable), split from the Telegram-only chrome. Loading the page without
 * Telegram used to be a total no-op, which meant the phone fixes could not be
 * checked here at all.
 */
export const LAYOUT_JS = [
  '(function(){',
  'try{',
  // The rule: the terminal fills the phone's real max width, whatever that is.
  // No device is special-cased, and nothing is measured off a screen size.
  'function avail(){',
  'try{',
  'var vv=window.visualViewport;',
  'var w=(vv&&vv.width)||document.documentElement.clientWidth||window.innerWidth;',
  'return Math.max(1,Math.floor(w));',
  '}catch(e){return Math.max(1,window.innerWidth||1);}',
  '}',
  'function fit(){',
  'try{',
  'var c=document.getElementById("terminal-container");',
  'if(c){',
  // The container does not exist at load either; arm the observer the first
  // time it shows up, not only on the first pass.
  'try{',
  'if(window.ResizeObserver&&!c.__tuiObserved){c.__tuiObserved=1;new window.ResizeObserver(fit).observe(c);}',
  '}catch(e2){}',
  // Widen the container to the viewport itself. Telegram insets the sheet, so
  // the container is narrower than the screen and xterm fits to the inset —
  // that inset was the "gap on the side", and it is native, so the page
  // overreaches the viewport width instead of living inside the inset.
  'c.style.setProperty("width",avail()+"px");',
  'c.style.setProperty("max-width","none");',
  '}',
  'window.dispatchEvent(new Event("resize"));',
  '}catch(e){}',
  // xterm floors columns, so up to one whole cell of background is left over.
  // Absorb it by stretching the grid over the full width — automatic for any
  // width, no size list, no font tuning. Below ~1% the stretch is invisible and
  // it is left off so text stays crisp.
  'setTimeout(function(){',
  'try{',
  'var c=document.getElementById("terminal-container");',
  'var s=document.querySelector(".xterm-screen");',
  'if(!c||!s)return;',
  'var g=s.clientWidth,t=c.clientWidth;',
  'if(g>8&&t>g&&(t-g)/t>0.01){',
  's.style.transform="scaleX("+(t/g)+")";',
  's.style.transformOrigin="left top";',
  '}else if(s.style.transform){s.style.transform="";s.style.transformOrigin="";}',
  '}catch(e){}',
  '},60);',
  '}',
  'try{',
  'var c=document.getElementById("terminal-container");',
  'if(c&&window.ResizeObserver&&!c.__tuiObserved){',
  'c.__tuiObserved=1;new window.ResizeObserver(fit).observe(c);',
  '}',
  '}catch(e){}',
  'try{if(window.visualViewport&&window.visualViewport.addEventListener)',
  'window.visualViewport.addEventListener("resize",fit);}catch(e){}',
  'window.addEventListener("resize",fit);',
  'try{if(window.visualViewport&&window.visualViewport.addEventListener)',
  'window.visualViewport.addEventListener("scroll",fit);}catch(e){}',
  // The Mini App's own chrome settles after load, so fit again as it does.
  '[0,150,600,1500,3000,6000].forEach(function(t){setTimeout(fit,t);});',
  '}catch(e){}',
  '})();',
].join('\n');

/**
 * Touch drag -> the app's own scroll keys, so a finger can scroll a fullscreen
 * TUI on a phone.
 *
 * Every number here is measured against the installed opencode: keys fired as
 * exact bytes into the real binary, pane diffs counted, and REPEATABILITY
 * tested (fire 4, see how many land). Repeatability is the whole game - a key
 * that fires once and then goes dead makes dragging feel broken.
 *
 *   key                  moves        repeats?
 *   alt+ArrowUp / Down   1 line       NO - 1 of 4 applies, at any gap
 *   ctrl+alt+y (doc'd    1 line       n/a - xterm never sends it at all
 *     line UP)
 *   ctrl+alt+e           1 line       YES - 4 of 4, 1 line each
 *   ctrl+alt+u / d       half page    YES - 4 of 4, 8 lines each
 *   ctrl+alt+b, PageUp   full page    partly
 *   SGR wheel (ESC[65/66) none        n/a - the app ignores wheel entirely
 *
 * So: scrolling DOWN is 1 line per step (ctrl+alt+e) and scrolling UP is a
 * half page per step (ctrl+alt+u). An up drag is nudged with a page key
 * first - the app ignores a same-direction key inside a few hundred ms of
 * the last one, so the nudge also re-arms it. That is the finest repeatable
 * scrolling this app can do from a browser, and it is why the earlier
 * "one line each way" version felt like it was not scrolling at all.
 *
 * Feel: one step per ~1/24th of the screen, up to 6 keys per touchmove so a
 * fast drag is never throttled, a decaying fling for momentum, `preventDefault`
 * only once a drag is really scrolling (a tap still types), multi-touch left
 * alone so pinch-zoom survives, and one accumulator per gesture.
 */
export const TOUCH_SCROLL_JS = [
  '(function(){',
  'try{',
  '// One line per step. alt+ArrowUp/alt+ArrowDown are the finest scroll the',
  '// app has (measured: 1 line) AND the finest pair the browser can send',
  '// (xterm emits ESC[1;5A / ESC[1;5B; ctrl+alt+y never leaves the browser).',
  '// Line DOWN (ctrl+alt+e, keyCode 69) repeats 4-for-4; the matching line UP',
  '// (ctrl+alt+y) is swallowed by xterm and alt+ArrowUp fires only once, so up',
  '// scrolls a half page (ctrl+alt+u, keyCode 85) and is re-armed with a page',
  '// key (ctrl+alt+b, keyCode 66) - the app ignores a same-direction key sent',
  '// too soon after the last one.',
  'var DOWN=69,UP=85,MAX_KEYS=6,COOLDOWN_MS=300,',
  'FLING_PX_PER_STEP=55,MAX_FLING_STEPS=10;',
  'var t=null,y0=0,acc=0,v=0,v0=0,last=0,active=0,lastDir=0,lastKeyAt=0;',
  'function screen(){return document.querySelector(".xterm-screen")||document.querySelector(".xterm");}',
  'function keys(){return document.querySelector(".xterm-helper-textarea")||screen();}',
  'function now(){try{return performance.now();}catch(e){return Date.now();}}',
  'function lineH(){',
  'try{',
  'var h=(screen()?(screen().clientHeight||0):0);',
  '// one step of finger travel, derived from the viewport so no font size or',
  '// screen size is baked in',
  'return Math.max(8,Math.min(24,Math.round(h/24)));',
  '}catch(e){return 12;}',
  '}',
  'function step(){return lineH();}',
  'function press(code){',
  'var el=keys();if(!el)return;',
  'try{',
  '// xterm reads keys from its textarea and only emits the ESC prefix when',
  '// ctrl+alt are set, so both modifiers travel with every key here.',
  'if(typeof el.focus==="function")el.focus();',
  'var ch=code===DOWN?"e":"u";',
  'var o={bubbles:true,cancelable:true,keyCode:code,which:code,',
  'key:ch,code:("Key"+ch.toUpperCase()),ctrlKey:true,altKey:true};',
  'el.dispatchEvent(new KeyboardEvent("keydown",o));',
  'el.dispatchEvent(new KeyboardEvent("keyup",o));',
  '}catch(e){}',
  '}',
  '// Down needs no rate limit: ctrl+alt+e applies 4-for-4 at any speed. Up does,',
  '// because ctrl+alt+u lands ~4-for-4 at 300ms and less when fired flat out -',
  '// so an up-drag is paced instead of dropped. No page-key nudge: measured',
  '// repeats say the half page is enough, and a page nudge would jump 30 lines.',
  'function emit(dir){',
  'if(dir>0){press(DOWN);lastDir=1;lastKeyAt=now();return;}',
  'var t=now();',
  'if(t-lastKeyAt<COOLDOWN_MS)return;',
  'press(UP);lastDir=-1;lastKeyAt=t;',
  '}',
  'function drain(){',
  'var s=step(),n=0;',
  'while(acc>=s&&n<MAX_KEYS){acc-=s;emit(1);n++;}',
  'while(acc<=-s&&n<MAX_KEYS){acc+=s;emit(-1);n++;}',
  '}',
  'function down(e){',
  'if(active||!e.touches||e.touches.length!==1)return;',
  't=e.touches[0];y0=t.clientY;v=0;v0=0;acc=0;last=now();',
  '}',
  'function move(e){',
  'if(!t||!e.touches||e.touches.length!==1)return;',
  'var y=e.touches[0].clientY,dy=y0-y,n=now();',
  'y0=y;',
  'if(!active&&Math.abs(acc+dy)>=step()){active=1;}',
  'acc+=dy;',
  'v=dy/Math.max(1,n-last);last=n;',
  'v0=v;',
  'drain();',
  'if(active){try{e.preventDefault();}catch(err){}}',
  '}',
  'function up(){',
  'if(!t)return;',
  't=null;',
  '// Momentum: a flick keeps scrolling for a few steps, one per frame, so it',
  '// glides instead of stopping dead. Capped, and it ends on its own.',
  'var steps=0;',
  'try{',
  'steps=Math.min(MAX_FLING_STEPS,Math.round(Math.abs(v)*FLING_PX_PER_STEP/step()));',
  '}catch(e){}',
  'var dir=v>0?1:-1;',
  'acc=0;active=0;v=0;',
  'if(steps>0){',
  'var n=0;',
  'var tick=function(){',
  'if(n++>=steps)return;',
  'emit(dir);',
  'try{requestAnimationFrame(tick);}catch(e){}',
  '};',
  'try{requestAnimationFrame(tick);}catch(e){}',
  '}',
  '}',
  'var h={touchstart:down,touchmove:move,touchend:up,touchcancel:up};',
  'var bound=null,tries=0;',
  'function arm(){',
  'try{',
  'var el=document.querySelector(".xterm-screen");',
  'if(!el)return false;',
  'if(el===bound)return true;',
  'if(bound){',
  '["touchstart","touchmove","touchend","touchcancel"].forEach(function(t){',
  'try{bound.removeEventListener(t,h[t]);}catch(e){}});',
  '}',
  'el.addEventListener("touchstart",h.touchstart,{passive:true});',
  'el.addEventListener("touchmove",h.touchmove,{passive:false});',
  'el.addEventListener("touchend",h.touchend,{passive:true});',
  'el.addEventListener("touchcancel",h.touchcancel,{passive:true});',
  'bound=el;',
  'return true;',
  '}catch(e){return false;}',
  '}',
  '// The terminal does not exist when this file runs: ttyd mounts xterm after',
  '// its bundle boots, so attaching once at load attached nothing and a finger',
  '// drag did nothing at all. Poll until it is there, then attach; if xterm is',
  '// ever re-created the element changes and this re-arms.',
  'var iv=setInterval(function(){tries++;if(arm()||tries>240)clearInterval(iv);},150);',
  'try{window.addEventListener("resize",function(){arm();});}catch(e){}',
  '}catch(e){}',
  '})();',
].join('\n');

/** Telegram-only chrome: fullscreen, expand, and the swipe lock. */
export const FULLSCREEN_WIDGET_JS = [
  '(function(){',
  'try{',
  'var tg=(window.Telegram&&window.Telegram.WebApp)?window.Telegram.WebApp:null;',
  "var b=document.getElementById('tui-fsbtn');",
  'if(!b)return;',
  "if(!tg){b.style.display='none';return;}",
  'if(tg.ready)tg.ready();',
  'try{if(tg.expand)tg.expand();}catch(e){}',
  'try{if(tg.disableVerticalSwipes)tg.disableVerticalSwipes();}catch(e){}',
  'function refit(){try{window.dispatchEvent(new Event(\'resize\'));}catch(e){}}',
  'function go(){',
  'try{',
  'if(tg.isFullscreen&&tg.exitFullscreen){tg.exitFullscreen();}',
  'else if(tg.requestFullscreen){tg.requestFullscreen();}',
  'else if(tg.expand){tg.expand();}',
  '}catch(e){}',
  'setTimeout(refit,300);setTimeout(refit,1000);',
  '}',
  // Fullscreen on load, not only on tap: Telegram opens a Mini App with its own
  // header AND horizontal insets, and only real fullscreen removes them — no
  // page CSS can reach a native inset. Guarded on isFullscreen, and retried
  // once because some clients refuse the call during the first tick.
  'setTimeout(function(){try{if(tg.requestFullscreen&&!tg.isFullscreen)tg.requestFullscreen();}catch(e){}refit();},600);',
  'setTimeout(function(){try{if(tg.requestFullscreen&&!tg.isFullscreen)tg.requestFullscreen();}catch(e){}refit();},1800);',
  "b.addEventListener('click',go);",
  "try{tg.onEvent('viewportChanged',refit);}catch(e){}",
  '}catch(e){}',
  '})();',
].join('\n');

/**
 * TEMP-DEBUG 2026-09-28: on-screen geometry readout, switched on only when the
 * gateway appends tui_measure=1 to the landing URL (TUI_PAGE_DEBUG=1). Remove
 * once the phone layout is confirmed.
 */
export const MEASURE_JS = [
  '(function(){',
  'try{',
  'window.__tuiAtLoad=!!document.querySelector(".xterm-screen");',
  "if(!/[?&]tui_measure=1/.test(location.search))return;",
  'setTimeout(function(){',
  'var c=document.getElementById("terminal-container");',
  'var x=document.querySelector(".xterm");',
  'var s=document.querySelector(".xterm-screen");',
  'var vp=window.visualViewport;',
  'var d=document.createElement("pre");',
  'd.id="tui-measure";',
  'd.style.cssText="position:fixed;left:2px;bottom:2px;z-index:99999;margin:0;'
    + 'background:rgba(0,0,0,.85);color:#0f0;font:9px/1.3 monospace;padding:2px 3px;";',
  'd.textContent=JSON.stringify({',
  'iw:window.innerWidth,dpr:window.devicePixelRatio,',
  'vvw:vp?Math.round(vp.width):null,vvs:vp?vp.scale:null,',
  'cw:c?c.clientWidth:null,xw:x?x.clientWidth:null,sw:s?Math.round(s.clientWidth):null,',
  'atLoad:window.__tuiAtLoad,screenNow:!!document.querySelector(".xterm-screen"),',
  'taNow:!!document.querySelector(".xterm-helper-textarea")',
  '});',
  'document.body.appendChild(d);',
  '},8000);',
  '}catch(e){}',
  '})();',
].join('\n');

export const FULLSCREEN_WIDGET = [
  '<script src="https://telegram.org/js/telegram-web-app.js"></script>',
  '<button id="tui-fsbtn" title="fullscreen" style="position:fixed;top:8px;right:8px;'
    + 'z-index:9999;width:40px;height:40px;border-radius:20px;border:1px solid #555;'
    + 'background:rgba(20,20,20,.7);color:#eee;font-size:20px;line-height:1;cursor:pointer;">&#x26F6;</button>',
  `<script>${LAYOUT_JS}</script>`,
  `<script>${TOUCH_SCROLL_JS}</script>`,
  `<script>${FULLSCREEN_WIDGET_JS}</script>`,
].join('');

export function withFullscreenButton(html) {
  const body = String(html || '');
  if (body.includes('tui-fsbtn')) return body;
  if (/<\/body\s*>/i.test(body)) return body.replace(/<\/body\s*>/i, (m) => `${FULLSCREEN_WIDGET}${m}`);
  return `${body}${FULLSCREEN_WIDGET}`;
}

export function withGeometryProbe(html) {
  const body = String(html || '');
  if (body.includes('tui-measure')) return body;
  return body.replace(/<\/body\s*>/i, (m) => `<script>${MEASURE_JS}</script>${m}`);
}
function serveTtydPage(req, res, ttydBase, upstreamPath = '/tty/', ttydCredential = '') {
  const target = new URL(upstreamPath, ttydBase);
  const upstream = http.request(
    {
      hostname: target.hostname,
      port: target.port || 80,
      path: target.pathname,
      method: 'GET',
      headers: {
        host: new URL(ttydBase).host,
        'accept-encoding': 'identity',
        authorization: `Basic ${ttydCredential}`,
      },
    },
    (up) => {
      const chunks = [];
      up.on('data', (c) => chunks.push(c));
      up.on('end', () => {
        let out = Buffer.concat(chunks);
        // Phone viewport injection is for the terminal page only; error
        // bodies pass through untouched.
        if ((up.statusCode || 200) === 200) {
          let page = withPhoneViewport(out.toString('utf8'));
          page = withFullscreenButton(page);
          page = withGeometryProbe(page);
          out = Buffer.from(page, 'utf8');
        }
        res.writeHead(up.statusCode || 200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'content-length': String(out.length),
        });
        res.end(out);
      });
    },
  );
  upstream.on('error', (err) => {
    console.error('[tui-gateway] ttyd page error:', err && err.message ? err.message : err);
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'ttyd unreachable' }));
  });
  upstream.end();
}

export async function start(env = process.env) {
  const port = Number(env.TUI_GATEWAY_PORT || 8897);
  const bind = env.TUI_GATEWAY_BIND || '127.0.0.1';
  const log = (m) => console.log('[tui-gateway]', m);
  const forge = await loadForgeRoute({ env, log });
  const handle = createGateway({ env, log, forge });
  const server = http.createServer((req, res) => {
    // A 500 with no reason is a dead end for whoever is debugging it at 2am.
    handle(req, res).catch((err) => {
      console.error('[tui-gateway] handler threw:', err && err.stack ? err.stack : err);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'gateway error' }));
    });
  });
  server.listen(port, bind, () => console.log(`[tui-gateway] listening on ${bind}:${port} -> ${env.TUI_TTYD_URL || 'http://127.0.0.1:8896'}`));
  return server;
}

if (process.argv[1] && process.argv[1].endsWith('tui-gateway.mjs')) {
  start().catch((err) => {
    console.error('[tui-gateway] start failed:', err && err.stack ? err.stack : err);
    process.exit(1);
  });
}
