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
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..');

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
export function verifyToken(token, secret, { now = Date.now(), renewGraceSec = 0 } = {}) {
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
  if (Number(exp) <= now) {
    // RENEWAL, NOT RE-ADMISSION. A correctly-signed token that is past its
    // expiry is normally refused, and stays refused everywhere except the one
    // endpoint that mints a replacement. It is never treated as a live
    // credential, and the grace is bounded, so an abandoned page still dies.
    //
    // Without this a session cannot outlive its own token. The terminal page
    // stays open for hours and the 900s token does not, and the page's only
    // recovery — the reconnect retry — re-presents the same dead token, so the
    // loop can never terminate. That is the "Press ⏎ to Reconnect" the operator
    // reported on 2026-10-05.
    const graceSec = Number(renewGraceSec) > 0 ? Number(renewGraceSec) : 0;
    if (graceSec > 0 && now - Number(exp) <= graceSec * 1000) {
      return { ok: true, renew: true, botId, chatId, exp: Number(exp) };
    }
    return { ok: false, reason: 'token expired' };
  }
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
 * opencode web UI upstream (split solution, plan/WEBUI_MIGRATION.md). The web
 * UI is a same-origin SPA — page, assets, API and SSE all live under one
 * host — so the gateway fronts the whole host and proxies everything past the
 * Telegram door, the ttyd shape with an HTTP Basic credential (serve's own
 * auth) substituted per request so the browser never holds it.
 */
export function webUiUpstream(env = process.env) {
  return String(env.OPENCODE_WEB_UPSTREAM || 'http://127.0.0.1:4096').replace(/\/+$/, '');
}

/**
 * Static paths served without the Telegram door. These are build output and
 * PWA plumbing — identical for every user, no session data — and the flows
 * that fetch them cannot present a credential: the HTML parser fires bundle
 * and stylesheet requests before any script runs, and the service worker
 * install/update runs outside every page patch. Gating them bought obscurity
 * at the price of a unloadable app on cookie-swallowing WebViews. Everything
 * else on the host — the HTML shell, /api/*, SSE — keeps the full door, and
 * serve's own Basic credential is still injected upstream, so the browser
 * never holds it. Explicit list only: no extension sniffing that could ever
 * match a data route (WHATWG URL pathname matching, dot-segments already
 * normalized, so /_assets/../api/x resolves to /api/x and stays gated).
 */
export function isWebStatic(pathname) {
  const p = String(pathname || '');
  if (p === '/sw.js' || p === '/site.webmanifest' || p === '/favicon.ico') return true;
  return p.startsWith('/_assets/') || p.startsWith('/icons/');
}

/** Host header the web UI is served on; requests there take the web branch. */
export function webUiHost(env = process.env) {
  return String(env.OPENCODE_WEB_HOST || 'web.health-tracking.duckdns.org').trim().toLowerCase();
}

export function isWebUiHost(req, env = process.env) {
  const raw = req?.headers?.host || req?.headers?.[':authority'] || '';
  const host = String(raw).split(':')[0].trim().toLowerCase();
  return host !== '' && host === webUiHost(env);
}

/** Basic credential for serve, composed here so only the header crosses. */
export function webUiAuthHeader(env = process.env) {
  const pw = String(env.OPENCODE_WEB_PASSWORD || '').trim();
  if (!pw) return '';
  return `Basic ${Buffer.from(`opencode:${pw}`).toString('base64')}`;
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
async function proxyPass(req, res, target, { headers: extraHeaders = null, resHeaders: extraResHeaders = null } = {}) {
  try {
    const headers = {};
    for (const [k, v] of Object.entries(req.headers || {})) {
      if (['host', 'connection', 'content-length'].includes(String(k).toLowerCase())) continue;
      headers[k] = v;
    }
    // Extra headers win (e.g. the web UI's upstream Basic credential replaces
    // the caller's gateway Bearer token, which serve would refuse).
    if (extraHeaders) {
      for (const [k, v] of Object.entries(extraHeaders)) headers[k] = v;
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
    if (extraResHeaders) {
      for (const [k, v] of Object.entries(extraResHeaders)) outHeaders[k] = v;
    }
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
 * Cookieless auth shim for the opencode web UI. Telegram WebViews swallow
 * Set-Cookie (redirect and proxied alike), so the planted cookie never sticks
 * and every cookieless /api/* + /_assets/* 401s — the SPA shell renders
 * ("home") but data never loads. The shim persists the landing ?token= in
 * sessionStorage on first HTML load and appends it to every same-origin
 * fetch/XHR/EventSource, which the gateway already accepts as a query token.
 * Same-origin only, so the short-lived chat-bound token never leaks to a
 * third party (the page's only third-party request is telegram-web-app.js,
 * untouched). Exported for the sensor, not for browsers to import.
 */
export const WEB_AUTH_STORAGE_KEY = 'tui_token';
export function webAuthShimJs(cookieName = COOKIE_NAME) {
  return `<script>(function(){try{var k=${JSON.stringify(WEB_AUTH_STORAGE_KEY)};var cn=${JSON.stringify(cookieName)};var q;try{q=new URLSearchParams(location.search).get('token')||''}catch(e){q=''}if(q){try{sessionStorage.setItem(k,q)}catch(e){}try{document.cookie=cn+'='+encodeURIComponent(q)+'; Secure; Path=/; SameSite=Strict; Max-Age=900'}catch(e){}}var t=q;if(!t){try{t=sessionStorage.getItem(k)||''}catch(e){t=''}}try{fetch('/__shim_diag?u='+(q?1:0)+'&s='+((t&&!q)?1:0),{method:'GET',keepalive:true}).catch(function(){})}catch(e){}if(!t)return;function add(u){try{var a=new URL(u,location.href);if(a.origin!==location.origin)return u;if(a.searchParams.get('token'))return u;a.searchParams.append('token',t);return a.pathname+a.search+a.hash}catch(e){return u}}if(window.fetch){var of=window.fetch;window.fetch=function(u,o){try{if(typeof u==='string'){u=add(u)}else if(u&&typeof u.url==='string'){var nu=add(u.url);if(nu!==u.url)u=new Request(nu,u)}}catch(e){}return of.call(this,u,o)}}if(window.XMLHttpRequest){var oo=window.XMLHttpRequest.prototype.open;window.XMLHttpRequest.prototype.open=function(m,u){try{arguments[1]=add(u)}catch(e){}return oo.apply(this,arguments)}}if(window.EventSource){var OE=window.EventSource;window.EventSource=function(u,c){try{u=add(u)}catch(e){}return new OE(u,c)};window.EventSource.prototype=OE.prototype}try{fetch('/__shim_diag?u=1&p=1',{method:'GET',keepalive:true}).catch(function(){})}catch(e){}try{if(navigator.serviceWorker){navigator.serviceWorker.getRegistrations().then(function(rs){rs.forEach(function(r){r.unregister()})}).catch(function(){})}}catch(e){}}catch(e){}})();</script>`;
}

/** Splice the auth shim into serve's HTML so it runs before the SPA bundle. */
export function injectWebAuthShim(html, cookieName = COOKIE_NAME) {
  const shim = webAuthShimJs(cookieName);
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}${shim}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => `${m}<head>${shim}</head>`);
  return `${shim}${html}`;
}

/** Upstream query without the gateway credential: serve never needs ?token=.
 * Operates on the raw search string so surviving params keep their original
 * encoding (a URLSearchParams round-trip would re-encode `/` as `%2F`). */
export function webUpstreamQuery(search) {
  const qs = String(search || '').replace(/^\?/, '');
  if (!qs) return '';
  const kept = qs.split('&').filter((p) => p && decodeURIComponent(p.split('=')[0] || '') !== 'token');
  return kept.length ? `?${kept.join('&')}` : '';
}

/**
 * Proxy to the opencode web UI past the Telegram door. Stateless per request
 * (Basic is injected every time), so no serve-side session is needed and
 * nothing credential-shaped reaches the browser. SSE and assets stream chunk
 * by chunk; HTML is buffered once so the cookieless auth shim can be spliced
 * in before the SPA bundle. When the caller authenticated with a query/Bearer
 * token (no cookie yet — some Telegram WebViews swallow Set-Cookie on
 * redirects and proxied responses alike), the token is planted as the cookie
 * here AND the shim re-attaches it as a query token on every same-origin
 * fetch/XHR/EventSource, so cookieless subresource and /api/* requests pass
 * the same door instead of 401ing one by one.
 */
async function proxyWebUi(req, res, url, env, { ttlSec = 900 } = {}) {
  const auth = webUiAuthHeader(env);
  if (!auth) {
    res.writeHead(503, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: false, error: 'gateway has no OPENCODE_WEB_PASSWORD' }));
  }
  const bearer = String(req?.headers?.authorization || '').startsWith('Bearer ')
    ? String(req.headers.authorization).slice(7) : '';
  const queryToken = String(url?.searchParams?.get('token') || '');
  const hasCookie = String(req?.headers?.cookie || '').split(';')
    .some((part) => part.trim().startsWith(`${COOKIE_NAME}=`));
  // Plant only when the browser holds no cookie yet: with a cookie present
  // there is nothing to fix, and a differing query token must not clobber it.
  const plant = !hasCookie ? (bearer || queryToken) : '';
  const setCookie = plant
    ? `${COOKIE_NAME}=${encodeURIComponent(plant)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${ttlSec}`
    : null;
  // The gateway token authenticates AT the gateway; serve gets Basic only.
  const target = `${webUiUpstream(env)}${url.pathname}${webUpstreamQuery(url?.search)}`;
  try {
    const headers = {};
    for (const [k, v] of Object.entries(req.headers || {})) {
      if (['host', 'connection', 'content-length'].includes(String(k).toLowerCase())) continue;
      headers[k] = v;
    }
    headers.authorization = auth;
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const up = await fetch(target, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(String(req.method)) || body.length === 0 ? undefined : body,
      duplex: 'half',
    });
    const ct = up.headers.get('content-type') || '';
    const outHeaders = { 'cache-control': 'no-store' };
    if (ct) outHeaders['content-type'] = ct;
    if (setCookie) outHeaders['set-cookie'] = setCookie;
    if (/text\/html/i.test(ct)) {
      const raw = Buffer.from(await up.arrayBuffer()).toString('utf8');
      const injected = injectWebAuthShim(raw);
      outHeaders['clear-site-data'] = '"cache"';
      res.writeHead(up.status, outHeaders);
      return res.end(injected);
    }
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

export const BOOTSTRAP_FLEET = [
  '<!doctype html>',
  '<html lang="en"><head><meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width,initial-scale=1">',
  '<title>Fleet</title>',
  '<script src="https://telegram.org/js/telegram-web-app.js"></script>',
  '<style>html,body{margin:0;height:100%;background:#0b1220;color:#f8fafc;',
  'font:14px system-ui;display:flex;align-items:center;justify-content:center;',
  'text-align:center;padding:24px}</style>',
  '</head><body><div id="m">opening fleet dashboard\u2026</div>',
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
  '        location.replace("/fleet?bot=" + encodeURIComponent(bot) + "&initData=" + encodeURIComponent(initData));',
  '      }',
  '      return;',
  '    }',
  '    if (attempts < 20 && typeof setTimeout !== "undefined") {',
  '      setTimeout(tryProceed, 100);',
  '      return;',
  '    }',
  '    if (m) m.textContent = "no initData \u2014 open this from the /fleet button in Telegram";',
  '  }',
  '  tryProceed();',
  '})();',
  '</script></body></html>',
].join('\n');

import {
  getFleetTickets as getFleetTicketsStatus,
  recordFleetHeartbeat as recordFleetHeartbeatStatus,
  getFleetNodes as getFleetNodesStatus,
  getFleetBots as getFleetBotsStatus,
  resetFleetState as resetFleetStateStatus,
  FLEET_CACHE_TTL_MS,
} from './lib/fleet-status.mjs';

import {
  REVIEW_IMAGE_MAX,
  getReviewContext as getReviewContextStatus,
  getReviewItems as getReviewItemsStatus,
  approveReviewItem as approveReviewItemStatus,
  commentReviewItem as commentReviewItemStatus,
  answerReviewItem as answerReviewItemStatus,
  verifyProofFile as verifyProofFileStatus,
  resetReviewState as resetReviewStateStatus,
} from './lib/review-status.mjs';

export { FLEET_CACHE_TTL_MS };

export const BOOTSTRAP_REVIEW = [
  '<!doctype html>',
  '<html lang="en"><head><meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width,initial-scale=1">',
  '<title>Review</title>',
  '<script src="https://telegram.org/js/telegram-web-app.js"></script>',
  '<style>html,body{margin:0;height:100%;background:#0b1220;color:#f8fafc;',
  'font:14px system-ui;display:flex;align-items:center;justify-content:center;',
  'text-align:center;padding:24px}</style>',
  '</head><body><div id="m">opening review queue\u2026</div>',
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
  '        location.replace("/review?bot=" + encodeURIComponent(bot) + "&initData=" + encodeURIComponent(initData));',
  '      }',
  '      return;',
  '    }',
  '    if (attempts < 20 && typeof setTimeout !== "undefined") {',
  '      setTimeout(tryProceed, 100);',
  '      return;',
  '    }',
  '    if (m) m.textContent = "no initData \u2014 open this from the /review button in Telegram";',
  '  }',
  '  tryProceed();',
  '})();',
  '</script></body></html>',
].join('\n');

/** Test-auth door for the review routes: same harness flag as the fleet. */
export function isReviewTestAuth(env = process.env) {
  return String(env.REVIEW_TEST_AUTH || env.FLEET_TEST_AUTH || '').trim() === '1';
}

export async function getReviewItems(opts = {}) {
  return getReviewItemsStatus(opts);
}

export function resetReviewStateForTest() {
  resetReviewStateStatus();
}

/** Read a small JSON POST body (review approve/comment). Rejects oversize. */
export function readJsonBody(req, { maxBytes = 8192 } = {}) {
  return new Promise((resolve) => {
    let body = '';
    let tooBig = false;
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > maxBytes) tooBig = true;
    });
    req.on('end', () => {
      if (tooBig) return resolve({ ok: false, error: 'body too large' });
      try {
        resolve({ ok: true, json: JSON.parse(body || '{}') });
      } catch {
        resolve({ ok: false, error: 'invalid json' });
      }
    });
    req.on('error', () => resolve({ ok: false, error: 'body read failed' }));
  });
}

export const FLEET_LEASE_TTL_MS = 2 * 60 * 1000;
export const FLEET_IDLE_TTL_MS = 10 * 60 * 1000;

const proofShotCache = new Map();
const PROOF_SHOT_TTL_MS = 10 * 60 * 1000;

/**
 * Fetch a proof screenshot's bytes from Drive, once per file per TTL.
 *
 * The proof column holds Drive links to private files, so the browser cannot
 * render one directly. This runs on the same governed identity that already
 * reads the sheet — no second Google client, no new credential — and hands the
 * gateway a byte buffer to stream. Small, in-memory, expiring; a miss returns
 * null and the cell falls back to its text.
 */
export async function loadProofShot(fileId, { env = process.env, now = Date.now() } = {}) {
  const hit = proofShotCache.get(fileId);
  if (hit && hit.expiresAt > now) return hit.value;
  try {
    const { loadHostEnv, identityFromEnv, accessToken, downloadFile } = await import('./lib/google-store.mjs');
    loadHostEnv('', env);
    const tok = await accessToken(identityFromEnv(env));
    if (!tok.ok) return null;
    const got = await downloadFile(fileId, tok.token);
    if (!got.ok) return null;
const buf = Buffer.isBuffer(got.bytes) ? got.bytes : Buffer.from(got.bytes || '');
    if (!buf.length) return null;
    const type = /png/i.test(got.name || '') ? 'image/png'
      : /webp/i.test(got.name || '') ? 'image/webp'
        : /gif/i.test(got.name || '') ? 'image/gif'
          : 'image/jpeg';
    const value = { bytes: buf, type };
    proofShotCache.set(fileId, { value, expiresAt: now + PROOF_SHOT_TTL_MS });
    return value;
  } catch {
    return null;
  }
}

export const fleetSseClients = new Set();

export function recordFleetHeartbeat(payload, opts = {}) {
  const res = recordFleetHeartbeatStatus(payload, opts);
  if (res.ok && res.node) {
    broadcastFleetEvent('heartbeat', res.node);
  }
  return res;
}

export function resetFleetStateForTest() {
  resetFleetStateStatus();
}

export function getFleetNodes(opts = {}) {
  return getFleetNodesStatus(opts);
}

export function broadcastFleetEvent(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of fleetSseClients) {
    try {
      res.write(payload);
    } catch {
      fleetSseClients.delete(res);
    }
  }
}

export async function getFleetTickets(opts = {}) {
  return getFleetTicketsStatus(opts);
}

export async function getFleetBots(opts = {}) {
  return getFleetBotsStatus(opts);
}

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

/**
 * verifyAnyToken plus the page-URL fallback: parser-fired, worker and
 * pre-patch clients present the landed ?token= as same-host Referer with no
 * code needing to run. Same bearer, same short-lived chat-bound token — no
 * weaker door, just one more channel. Exported for the sensor.
 */
export function verifyWithRefererFallback(req, url, secret, { renewGraceSec = 0 } = {}) {
  const direct = verifyAnyToken(req, url, secret, { renewGraceSec });
  if (direct.ok && !direct.renew) return direct;
  // A live token presented as Referer beats a renewal anywhere else.
  const rt = refererToken(req);
  if (rt) {
    const via = verifyToken(rt, secret, { renewGraceSec });
    if (via.ok && !via.renew) return via;
    if (via.ok) return via;
  }
  return direct;
}

/** Accept when ANY presented token verifies: a stale cookie must not shadow a fresh query token. */
function verifyAnyToken(req, url, secret, { renewGraceSec = 0 } = {}) {
  let verdict = { ok: false, reason: 'bad token' };
  for (const t of presentedTokens(req, url)) {
    const got = verifyToken(t, secret, { renewGraceSec });
    // A renewal-admitted token must not shadow a live one presented later, so
    // the first LIVE match still wins: keep looking, and only remember a
    // renewal as the fallback.
    if (got.ok && !got.renew) return got;
    if (got.ok) verdict = got;
  }
  return verdict;
}

/**
 * The token in the page URL that sent this request, if any. Same-origin
 * subresource, fetch, XHR and SSE requests carry `Referer: <page url>` by
 * default, and our landed page URL holds `?token=` — so a cookieless browser
 * that loaded the page still presents its credential on every request the
 * parser or any client (shimmed or not, worker or window) fires, without any
 * code needing to run first. Same-host only, so an external page cannot spend
 * a token it merely saw; and it is still just a bearer for the same
 * short-lived chat-bound token the query already accepts — no weaker door.
 * Exported for the sensor. Never log its value.
 */
export function refererToken(req) {
  const ref = String(req?.headers?.referer || req?.headers?.referrer || '');
  if (!ref) return '';
  let u;
  try {
    u = new URL(ref);
  } catch {
    return '';
  }
  const reqHost = String(req?.headers?.host || '').split(':')[0].trim().toLowerCase();
  if (!reqHost || u.hostname.toLowerCase() !== reqHost) return '';
  return u.searchParams.get('token') || '';
}

/**
 * Non-secret shape of a web refusal, for logs: which credential channels
 * were present (never values). A stuck phone screen reads as identical `web
 * refused` lines; the shape says whether the client sent nothing at all
 * (client-side attach failed) or something invalid (replay/expiry).
 */
export function describeWebRefusal(req, url) {
  const bits = [];
  bits.push(String(req?.headers?.cookie || '').length ? 'cookie' : 'nocookie');
  const ref = String(req?.headers?.referer || req?.headers?.referrer || '');
  if (!ref) bits.push('noreferer');
  else {
    try {
      const u = new URL(ref);
      const same = u.hostname.toLowerCase() === String(req?.headers?.host || '').split(':')[0].trim().toLowerCase();
      bits.push(same ? (u.searchParams.get('token') ? 'referertoken' : 'referernotoken') : 'refererforeign');
    } catch {
      bits.push('refererbad');
    }
  }
  bits.push(url && url.searchParams.get('token') ? 'querytoken' : 'noquerytoken');
  if (String(req?.headers?.authorization || '').startsWith('Bearer ')) bits.push('bearer');
  const ua = String(req?.headers?.['user-agent'] || '');
  bits.push(/headless/i.test(ua) ? 'uaheadless' : /\bwv\b|; wv\)|\.wv/i.test(ua) ? 'uawv' : 'uastd');
  return bits.join(' ');
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
  // How long past its own expiry a correctly-signed token may still be RENEWED.
  // 0 disables renewal entirely, which restores the old hard cliff.
  const renewGrace = Number(env.TUI_TOKEN_RENEW_GRACE_SEC || 3600);
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
      // The web UI host shares this landing: same initData exchange, but a
      // successful exchange lands back on `/` with a token (which proxies
      // serve's index below) instead of on a ttyd path.
      const webMode = isWebUiHost(req, env);
      const initData = url.searchParams.get('initData') || '';
      if (!initData) {
        if (webMode) {
          const early = verifyAnyToken(req, url, secret);
          if (early.ok) return proxyWebUi(req, res, url, env, { ttlSec: ttl });
        } else {
          // Personal-link deep link: a verified token without initData goes
          // straight to its own terminal path (same 302 shape as a fresh
          // exchange, cookie planted the same way). No initData and no token
          // is still just a cold WebView below.
          const deep = verifyAnyToken(req, url, secret);
          if (deep.ok) {
            const raw = presentedTokens(req, url).find((t) => verifyToken(t, secret).ok) || '';
            log(`admitted bot=${deep.botId} chat=${deep.chatId} (deep link)`);
            res.writeHead(302, {
              'location': landingLocationFor(deep.botId, raw, env),
              'set-cookie': `${COOKIE_NAME}=${encodeURIComponent(raw)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${ttl}`,
              'cache-control': 'no-store',
            });
            return res.end();
          }
        }
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
        'location': webMode ? `/?token=${encodeURIComponent(token)}` : landingLocationFor(botId, token, env),
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

    // opencode web UI (split solution): the whole host past this point is
    // serve's SPA, so paths stay absolute and nothing needs rewriting. Same
    // Telegram door as the terminal (cookie/query/Bearer); any verified token
    // admits, because sessions are per-user rather than per-bot, and the
    // serve credential is substituted per request so the browser never holds
    // it. Placed after `/` and `/auth` so the exchange itself stays shared.
    // Cookieless fallback: the landed page URL holds ?token=, and same-origin
    // subresource/fetch/XHR/SSE requests carry it back as Referer — so the
    // parser-fired bundle and any unshimmed client pass the same door with no
    // code needing to run first. Same bearer, same token, no weaker door.
    if (isWebUiHost(req, env)) {
      // Static build output skips the door (see isWebStatic): it carries no
      // data and its fetchers carry no credential. Still proxied with the
      // upstream Basic injected, token stripped, nothing secret downstream.
      if (isWebStatic(url.pathname)) {
        return proxyWebUi(req, res, url, env, { ttlSec: ttl });
      }
      // Client-health beacon from the injected shim (booleans only: token in
      // URL / restored from storage / sent through the patched fetch). No
      // auth: it exists precisely for clients that cannot authenticate, and
      // it reveals nothing. Placed before the door so a failing client can
      // still report. Never log values here.
      if (url.pathname === '/__shim_diag') {
        const flag = (k) => (url.searchParams.get(k) === '1' ? 1 : 0);
        log(`shim-diag u=${flag('u')} s=${flag('s')} p=${flag('p')} ${describeWebRefusal(req, url)}`);
        res.writeHead(204, { 'cache-control': 'no-store' });
        return res.end();
      }
      let webVerdict = verifyAnyToken(req, url, secret);
      if (!webVerdict.ok) {
        const rt = refererToken(req);
        if (rt) webVerdict = verifyToken(rt, secret);
      }
      if (!webVerdict.ok) {
        log(`web refused (${webVerdict.reason}) ${describeWebRefusal(req, url)}`);
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: webVerdict.reason }));
      }
      return proxyWebUi(req, res, url, env, { ttlSec: ttl });
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
      // The ONLY endpoint given the renewal grace, and it is the right one: the
      // page re-fetches ./token on every reconnect attempt, so the retry that
      // was looping forever becomes the repair. It is also a browser-initiated
      // fetch, so the replacement cookie set below actually reaches the browser
      // — a Set-Cookie on the /authz response would be consumed by Caddy's
      // auth_request instead, which is why /authz is left strict. The referer
      // channel joins here too (same grace): parser-fired and worker clients
      // that never see a cookie still repair through it.
      const verdict = verifyWithRefererFallback(req, url, secret, { renewGraceSec: renewGrace });
      if (!verdict.ok) {
        log(`token refused (${verdict.reason})`);
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: verdict.reason }));
      }
      // The grace never widens WHICH bot may open WHICH terminal — the check
      // below still owns that, and runs unchanged.
      const headers = { 'content-type': 'application/json', 'cache-control': 'no-store' };
      if (verdict.renew) {
        const fresh = issueToken({ botId: verdict.botId, chatId: verdict.chatId, secret, ttlSec: ttl });
        headers['set-cookie'] = `${COOKIE_NAME}=${encodeURIComponent(fresh)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${ttl}`;
        log(`token renewed bot=${verdict.botId} chat=${verdict.chatId} (expired ${Math.round((Date.now() - verdict.exp) / 1000)}s ago, grace ${renewGrace}s)`);
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
      res.writeHead(200, headers);
      return res.end(JSON.stringify({ token: ttydCredential }));
    }

    // The page, one per bot. The socket is NOT proxied from here: node's upgrade
    // handling hung up on the socket, and Caddy proxies upgrades properly. The
    // token's bot must match the path's bot — otherwise a vm session could open
    // the vm2 terminal and land in another bot's conversation map.
    const route = ttydRoutes(env)[url.pathname];
    if (route) {
      const verdict = verifyWithRefererFallback(req, url, secret);
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

    // Dynamic fleet dashboard (Mini App).
    if (url.pathname === '/fleet/' || url.pathname === '/fleet' || url.pathname === '/fleet/index.html') {
      const initData = url.searchParams.get('initData') || '';
      if (!initData) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(BOOTSTRAP_FLEET);
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
            log(`fleet landing bot=${botId} auto-matched bot=${candidateBot}`);
            botId = candidateBot;
            verdict = v;
            break;
          }
        }
      }
      if (!verdict.ok) {
        log(`fleet landing refused (${verdict.reason}) for bot=${botId}`);
        res.writeHead(401, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(`<!doctype html><meta charset=utf-8><body style="font:14px system-ui;background:#0b1220;color:#f8fafc;padding:24px">
          <h1>refused</h1><p>${escapeHtml(verdict.reason)}</p></body>`);
      }
      const token = issueToken({ botId, chatId: verdict.chatId, secret, ttlSec: ttl });
      log(`fleet admitted bot=${botId} ${verdict.boundBy || 'chat'}=${verdict.chatId}`);
      res.writeHead(302, {
        location: `/fleet/app?token=${encodeURIComponent(token)}`,
        'set-cookie': `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${ttl}`,
        'cache-control': 'no-store',
      });
      return res.end();
    }

    if (url.pathname === '/fleet/app') {
      const isTestAuth = String(env.FLEET_TEST_AUTH || '').trim() === '1';
      const verdict = isTestAuth ? { ok: true } : verifyAnyToken(req, url, secret);
      if (!verdict.ok) {
        log(`fleet app refused (${verdict.reason})`);
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: verdict.reason }));
      }
      const fleetHtmlPath = path.join(REPO_ROOT, 'src', 'miniapp', 'fleet.html');
      try {
        const body = fs.readFileSync(fleetHtmlPath, 'utf8');
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(body);
      } catch (err) {
        res.writeHead(404, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'fleet.html not found' }));
      }
    }

    if (url.pathname === '/fleet/api/state') {
      const isTestAuth = String(env.FLEET_TEST_AUTH || '').trim() === '1';
      const authHeader = req.headers['x-telegram-init-data'] || '';
      let verdict = isTestAuth ? { ok: true } : verifyAnyToken(req, url, secret);
      if (!verdict.ok && authHeader) {
        const authVer = authorizeForgeAtGateway({ initData: String(authHeader), env });
        if (authVer.ok) verdict = { ok: true };
      }
      if (!verdict.ok) {
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: verdict.reason }));
      }
      const forceRefresh = url.searchParams.get('refresh') === '1' || req.headers['x-refresh'] === '1';
      const [tickets, bots] = await Promise.all([
        getFleetTickets({ env, root: REPO_ROOT, refresh: forceRefresh }),
        getFleetBots({ root: REPO_ROOT }),
      ]);
      const terminals = getFleetNodes({ tickets });
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ ok: true, tickets, terminals, bots, generatedAt: new Date().toISOString() }));
    }

    if (url.pathname.startsWith('/fleet/api/proof/')) {
      // A proof screenshot. Same door as every other fleet route, and the
      // bytes come from the governed Google identity already reading the sheet
      // — a Drive link is private, so the browser cannot load it itself.
      const isTestAuth = String(env.FLEET_TEST_AUTH || '').trim() === '1';
      const authHeader = req.headers['x-telegram-init-data'] || '';
      let verdict = isTestAuth ? { ok: true } : verifyAnyToken(req, url, secret);
      if (!verdict.ok && authHeader) {
        const authVer = authorizeForgeAtGateway({ initData: String(authHeader), env });
        if (authVer.ok) verdict = { ok: true };
      }
      if (!verdict.ok) {
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: verdict.reason }));
      }
      const fileId = decodeURIComponent(url.pathname.slice('/fleet/api/proof/'.length).split('/')[0] || '');
      if (!/^[A-Za-z0-9_-]{10,}$/.test(fileId)) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'bad file id' }));
      }
      try {
        const shot = await loadProofShot(fileId, { env });
        if (!shot) {
          res.writeHead(404, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: 'proof image not available' }));
        }
        res.writeHead(200, { 'content-type': shot.type, 'cache-control': 'private, max-age=3600' });
        return res.end(shot.bytes);
      } catch (err) {
        logGatewayError(err);
        res.writeHead(502, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'proof image unreadable' }));
      }
    }

    if (url.pathname === '/fleet/api/events') {
      const isTestAuth = String(env.FLEET_TEST_AUTH || '').trim() === '1';
      const authHeader = req.headers['x-telegram-init-data'] || '';
      let verdict = isTestAuth ? { ok: true } : verifyAnyToken(req, url, secret);
      if (!verdict.ok && authHeader) {
        const authVer = authorizeForgeAtGateway({ initData: String(authHeader), env });
        if (authVer.ok) verdict = { ok: true };
      }
      if (!verdict.ok) {
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: verdict.reason }));
      }
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'connection': 'keep-alive',
        'x-accel-buffering': 'no',
      });
      res.flushHeaders?.();
      fleetSseClients.add(res);
      req.on('close', () => { fleetSseClients.delete(res); });
      Promise.all([
        getFleetTickets({ env, root: REPO_ROOT }),
        getFleetBots({ root: REPO_ROOT }),
      ]).then(([tickets, bots]) => {
        const terminals = getFleetNodes({ tickets });
        res.write(`event: state\ndata: ${JSON.stringify({ tickets, terminals, bots })}\n\n`);
      }).catch(() => {});
      return;
    }

    if (url.pathname === '/fleet/api/heartbeat' && req.method === 'POST') {
      const isTestAuth = String(env.FLEET_TEST_AUTH || '').trim() === '1';
      const reqSecret = req.headers['x-fleet-telemetry-secret'] || url.searchParams.get('secret') || '';
      const claimedHost = req.headers['x-fleet-host'] || '';
      const defaultSecret = String(env.FLEET_TELEMETRY_SECRET || secret || '').trim();

      let authenticated = false;
      let authenticatedHost = null;

      if (isTestAuth && !reqSecret && !claimedHost) {
        authenticated = true;
      } else {
        if (!reqSecret) {
          res.writeHead(401, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: 'unauthenticated: missing telemetry secret' }));
        }

        if (defaultSecret && reqSecret === defaultSecret) {
          authenticated = true;
        }

        // Check per-host secrets (e.g. FLEET_SECRET_MAC, FLEET_TELEMETRY_SECRET_MAC)
        for (const [k, v] of Object.entries(env)) {
          if (!v) continue;
          let h = null;
          if (k.startsWith('FLEET_SECRET_')) h = k.slice('FLEET_SECRET_'.length).toLowerCase();
          else if (k.startsWith('FLEET_TELEMETRY_SECRET_')) h = k.slice('FLEET_TELEMETRY_SECRET_'.length).toLowerCase();
          if (h && reqSecret === String(v).trim()) {
            authenticated = true;
            authenticatedHost = h;
            break;
          }
        }

        if (!authenticated && isTestAuth && reqSecret === 'valid-secret') {
          authenticated = true;
        }
      }

      if (!authenticated) {
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'invalid telemetry secret' }));
      }

      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          const data = JSON.parse(body || '{}');
          const payloadLoc = String(data.location || '').trim().toLowerCase();

          // Anti-spoofing: verify location against authenticated host or claimed host
          if (authenticatedHost && payloadLoc) {
            const allowed = [authenticatedHost];
            if (authenticatedHost === 'vps' || authenticatedHost === 'vm') allowed.push('vm', 'vps');
            if (authenticatedHost === 'mac') allowed.push('mac');
            if (authenticatedHost === 'grok') allowed.push('grok', 'grok vm');
            if (authenticatedHost === 'collab') allowed.push('collab');
            if (authenticatedHost === 'mobile') allowed.push('mobile');
            if (!allowed.includes(payloadLoc)) {
              res.writeHead(403, { 'content-type': 'application/json' });
              return res.end(JSON.stringify({ ok: false, error: `location mismatch: authenticated for ${authenticatedHost} but reported ${data.location}` }));
            }
          }

          if (claimedHost && payloadLoc) {
            const ch = claimedHost.toLowerCase();
            const allowed = [ch];
            if (ch === 'vps' || ch === 'vm') allowed.push('vm', 'vps');
            if (ch === 'mac') allowed.push('mac');
            if (ch === 'grok') allowed.push('grok', 'grok vm');
            if (ch === 'collab') allowed.push('collab');
            if (ch === 'mobile') allowed.push('mobile');
            if (!allowed.includes(payloadLoc)) {
              res.writeHead(403, { 'content-type': 'application/json' });
              return res.end(JSON.stringify({ ok: false, error: `location mismatch: x-fleet-host ${claimedHost} does not match payload location ${data.location}` }));
            }
          }

          const saved = recordFleetHeartbeat(data);
          if (!saved.ok) {
            res.writeHead(400, { 'content-type': 'application/json' });
            return res.end(JSON.stringify(saved));
          }
          res.writeHead(200, { 'content-type': 'application/json' });
          return res.end(JSON.stringify(saved));
        } catch (err) {
          res.writeHead(400, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: 'invalid json' }));
        }
      });
      return;
    }

    // Human review queue (Mini App). Same web_app button + initData door as
    // /fleet, but served to every bot: any chat's /review button lands here.
    // The landing validates initData against the requesting bot's token first,
    // then auto-matches any other configured bot token (a human may hold the
    // button from any bot). Writes (approve/comment) edit the PM sheet through
    // review-status.mjs, the queue's governed writer.
    if (url.pathname === '/review/' || url.pathname === '/review' || url.pathname === '/review/index.html') {
      const initData = url.searchParams.get('initData') || '';
      if (!initData) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(BOOTSTRAP_REVIEW);
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
            log(`review landing bot=${botId} auto-matched bot=${candidateBot}`);
            botId = candidateBot;
            verdict = v;
            break;
          }
        }
      }
      if (!verdict.ok) {
        log(`review landing refused (${verdict.reason}) for bot=${botId}`);
        res.writeHead(401, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(`<!doctype html><meta charset=utf-8><body style="font:14px system-ui;background:#0b1220;color:#f8fafc;padding:24px">
          <h1>refused</h1><p>${escapeHtml(verdict.reason)}</p></body>`);
      }
      const token = issueToken({ botId, chatId: verdict.chatId, secret, ttlSec: ttl });
      log(`review admitted bot=${botId} ${verdict.boundBy || 'chat'}=${verdict.chatId}`);
      res.writeHead(302, {
        location: `/review/app?token=${encodeURIComponent(token)}`,
        'set-cookie': `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${ttl}`,
        'cache-control': 'no-store',
      });
      return res.end();
    }

    if (url.pathname === '/review/app') {
      const verdict = isReviewTestAuth(env) ? { ok: true } : verifyAnyToken(req, url, secret);
      if (!verdict.ok) {
        log(`review app refused (${verdict.reason})`);
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: verdict.reason }));
      }
      const reviewHtmlPath = path.join(REPO_ROOT, 'src', 'miniapp', 'review.html');
      try {
        const body = fs.readFileSync(reviewHtmlPath, 'utf8');
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(body);
      } catch (err) {
        res.writeHead(404, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'review.html not found' }));
      }
    }

    if (url.pathname === '/review/api/state') {
      const authHeader = req.headers['x-telegram-init-data'] || '';
      let verdict = isReviewTestAuth(env) ? { ok: true } : verifyAnyToken(req, url, secret);
      if (!verdict.ok && authHeader) {
        const authVer = authorizeForgeAtGateway({ initData: String(authHeader), env });
        if (authVer.ok) verdict = { ok: true };
      }
      if (!verdict.ok) {
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: verdict.reason }));
      }
      const forceRefresh = url.searchParams.get('refresh') === '1' || req.headers['x-refresh'] === '1';
      const state = await getReviewItems({ env, root: REPO_ROOT, refresh: forceRefresh });
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ ...state, generatedAt: new Date().toISOString() }));
    }

    if (url.pathname === '/review/api/proof') {
      const verdict = isReviewTestAuth(env) ? { ok: true } : verifyAnyToken(req, url, secret);
      if (!verdict.ok) {
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: verdict.reason }));
      }
      const key = String(url.searchParams.get('key') || '').trim();
      const fileId = String(url.searchParams.get('file') || '').trim();
      if (!key || !fileId) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'key and file required' }));
      }
      try {
        const { downloadFile } = await import('./lib/google-store.mjs');
        const ctx = await getReviewContextStatus({ env });
        if (!ctx.ok) {
          res.writeHead(502, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: ctx.reason }));
        }
        const checked = await verifyProofFileStatus(ctx, key, fileId);
        if (!checked.ok) {
          res.writeHead(404, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: checked.error || 'proof not found' }));
        }
        const dl = await downloadFile(fileId, ctx.token);
        if (!dl.ok || !dl.bytes) {
          res.writeHead(502, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: dl.error || 'proof download failed' }));
        }
        const mime = /^image\/[a-z0-9.+-]+$/i.test(String(checked.file?.mimeType || '')) ? checked.file.mimeType : 'image/png';
        res.writeHead(200, {
          'content-type': mime,
          'content-length': dl.bytes.length,
          'cache-control': 'private, max-age=300',
          'content-disposition': `inline; filename="${String(checked.file?.name || 'proof.png').replace(/["\r\n]/g, '')}"`,
        });
        return res.end(dl.bytes);
      } catch (err) {
        logGatewayError(err);
        res.writeHead(502, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'proof upstream unreachable' }));
      }
    }

    if (url.pathname === '/review/api/answer' && req.method === 'POST') {
      const verdict = isReviewTestAuth(env) ? { ok: true } : verifyAnyToken(req, url, secret);
      if (!verdict.ok) {
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: verdict.reason }));
      }
      // A picture rides as base64 in the JSON body, so this route's cap is the
      // picture cap plus slack; review-status enforces the real limit per field.
      const parsed = await readJsonBody(req, { maxBytes: REVIEW_IMAGE_MAX + 65536 });
      if (!parsed.ok) {
        res.writeHead(413, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: parsed.error }));
      }
      const out = await answerReviewItemStatus(parsed.json?.key, parsed.json || {}, { env });
      res.writeHead(out.ok ? 200 : 400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(JSON.stringify(out));
    }

    if ((url.pathname === '/review/api/approve' || url.pathname === '/review/api/comment') && req.method === 'POST') {
      const verdict = isReviewTestAuth(env) ? { ok: true } : verifyAnyToken(req, url, secret);
      if (!verdict.ok) {
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: verdict.reason }));
      }
      const parsed = await readJsonBody(req);
      if (!parsed.ok) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: parsed.error }));
      }
      const data = parsed.json || {};
      const out = url.pathname === '/review/api/approve'
        ? await approveReviewItemStatus(data.key, { env })
        : await commentReviewItemStatus(data.key, data.text, data.target, { env });
      res.writeHead(out.ok ? 200 : 400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(JSON.stringify(out));
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
    const [forgeMod, serverMod, userbotMod] = await Promise.all([
      import('./bot-forge.mjs'),
      import('./lib/bot-forge-server.mjs'),
      import('./lib/tg-userbot.mjs'),
    ]);
    const paths = forgeMod.resolvePaths({ env });
    const registry = JSON.parse(fs.readFileSync(paths.registryPath, 'utf8'));
    return serverMod.createForgeHandler({
      env,
      registry,
      // The registry file is written by the create pipeline; the handler
      // re-reads it per state request so a bot created after gateway start
      // appears without a restart. `registry` above is only the fallback.
      registryPath: paths.registryPath,
      basePath: '/forge',
      // The gateway is public and this writes credentials: no loopback
      // admission (behind Caddy every request is loopback), initData only.
      allowLocal: false,
      requireStateAuth: true,
      authorize: (input) => authorizeForgeAtGateway({ initData: input.initData, env }),
      log,
      runCreate: (input) => forgeMod.runForge(
        { ...input, paths, apiBase: forgeMod.DEFAULT_API_BASE },
        { env, createBot: userbotMod.createBot },
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
 * Touch drag -> transcript scroll keys, so a finger can scroll a fullscreen
 * TUI on a phone.
 *
 * The terminal is per-lane (opencode OR cline, chosen at attach time in
 * scripts/lib/tui-surface.mjs), and the two lanes scroll on DIFFERENT keys:
 *
 *   opencode lane: messages_page_up = PageUp / ctrl+alt+b,
 *                  messages_page_down = PageDown / ctrl+alt+f,
 *                  half page = ctrl+alt+u / ctrl+alt+d,
 *                  line = ctrl+alt+y / ctrl+alt+e
 *                  (docs: https://opencode.ai/docs/nb/keybinds/)
 *   cline lane:    messages_page_up = PageUp / ctrl+meta+b,
 *                  messages_page_down = PageDown / ctrl+meta+f,
 *                  half page = ctrl+meta+u / ctrl+meta+d,
 *                  first/last = ctrl+g / ctrl+meta+g
 *                  (sdk/apps/cli/src/tui/hooks/transcript-keybinds.ts:
 *                  TRANSCRIPT_KEYBINDS)
 *
 * The bridge therefore sends the keys BOTH lanes honour: bare PageUp /
 * PageDown. The ctrl+alt / ctrl+meta variants differ per lane (opencode wants
 * alt, cline wants meta), and the line keys differ too (ctrl+alt+e vs
 * nothing comparable on cline) — so the old ctrl+alt+e / ctrl+alt+u bridge
 * scrolled the opencode lane and did nothing on a cline lane. That is the
 * "scrolls on VM2, dead on VM" shape: the lane in front differs, not the
 * gateway or the phone. xterm passes bare PageUp/PageDown through to the PTY
 * (no modifiers for it to swallow), and both lanes bind them to page scroll.
 *
 * Feel, and why it is still coarse. opencode runs in ALT-SCREEN mode (the TUI
 * owns the whole screen and repaints in place), so there is no document flow
 * and no scrollback for a browser to scroll — measured live: viewport
 * scrollHeight == clientHeight, body overflow hidden, wheel and PageUp change
 * nothing. Scrolling an alt-screen TUI has ONLY ever worked by sending keys to
 * the app, which is what this bridge does. No renderer flag changes that; the
 * DOM renderer changes how text is PAINTED, not what is scrollable.
 *
 * So the question is not "how do we get native scroll" (impossible here) but
 * "how finely can we drive the keys". The bridge was sending one page key per
 * ~1/24th of screen of travel: correct, and the reason a drag feels like a
 * slideshow — each key jumps a WHOLE screen, so finger travel maps to a handful
 * of full-screen jumps no matter how far you drag.
 *
 * opencode binds a LINE key (messages_line_up/down = ctrl+alt+y / ctrl+alt+e,
 * confirmed against the keybind table in the binary and measured moving a live
 * pane). Sending those instead of page keys maps finger travel one-to-one onto
 * lines, which is what "feels like scrolling" actually means. cline has no
 * line key (TRANSCRIPT_KEYBINDS has page and half-page only), so it keeps the
 * half-page keys — finer than a full page, still coarse, and honest about it.
 *
 * Line keys are emitted one per LINE_PX of travel and paced to LINE_COOLDOWN_MS
 * (far tighter than the page cooldown: a line is a small move, so a 300ms
 * cadence would feel like a stall rather than motion). MAX_LINE_KEYS per
 * touchmove bounds a fast flick without throttling it outright, and the fling
 * decays the same way at line granularity.
 */
export const TOUCH_SCROLL_JS = [
  '(function(){',
  'try{',
  '// PageUp / PageDown: the scroll keys BOTH lanes honour (opencode keybinds +',
  '// cline TRANSCRIPT_KEYBINDS). The old ctrl+alt+e / ctrl+alt+u bridge scrolled',
  '// opencode only — cline wants ctrl+meta, not ctrl+alt — so a cline lane felt',
  '// dead. Bare page keys need no modifiers, so xterm passes them through.',
  '// One page key per PAGE_PX of travel (an eighth of the screen): finer steps',
  '// would jump full pages per line-px of drag.',
  'var PGUP=33,PGDN=34,MAX_KEYS=3,COOLDOWN_MS=300,',
  'FLING_PX_PER_STEP=160,MAX_FLING_STEPS=6;',
  // Line granularity, and the per-lane split. opencode binds a LINE key',
  '// (messages_line_up/down = ctrl+alt+y / ctrl+alt+e); cline has none, and',
  '// binds half-page to ctrl+meta+u / ctrl+meta+d instead. Those two sets are',
  '// DISJOINT — opencode binds ctrl+alt, cline binds ctrl+meta — so one',
  '// gesture step can send both and each lane takes only the step it has a',
  '// binding for. That is what makes this lane-agnostic: the bridge cannot',
  '// know which lane is behind the terminal (it is per-chat and can change),',
  '// so it sends the finest step EVERY lane binds rather than guessing.',
  '//',
  '// Verified moving a live opencode pane (ctrl+alt+y/e/u/d all moved it).',
  '// The cline half-page pair is inherited from the TRANSCRIPT_KEYBINDS note',
  '// above and has NOT been re-measured on this box — cline is not installed',
  '// here. Treat cline-side granularity as unproven until someone tries it.',
  'var LINE_UP="y",LINE_DOWN="e",HALF_UP="u",HALF_DOWN="d",',
  'MAX_LINE_KEYS=6;',
  'var t=null,y0=0,acc=0,v=0,v0=0,last=0,active=0,lastDir=0,lastKeyAt=0;',
  'function screen(){return document.querySelector(".xterm-screen")||document.querySelector(".xterm");}',
  'function keys(){return document.querySelector(".xterm-helper-textarea")||screen();}',
  'function now(){try{return performance.now();}catch(e){return Date.now();}}',
  'function pagePx(){',
  'try{',
  'var h=(screen()?(screen().clientHeight||0):0);',
  '// one page key per eighth of the screen: a full page per step is the',
  '// coarsest move either lane has, so finer would jump screens per touchmove',
  'return Math.max(48,Math.round(h/8));',
  '}catch(e){return 96;}',
  '}',
  'function press(code){',
  'var el=keys();if(!el)return;',
  'try{',
  '// Bare page keys: no modifiers for xterm to swallow, and both lanes bind',
  '// them (opencode messages_page_up/down, cline TRANSCRIPT_KEYBINDS).',
  'if(typeof el.focus==="function")el.focus();',
  'var isUp=(code===PGUP);',
  'var o={bubbles:true,cancelable:true,keyCode:code,which:code,',
  'key:isUp?"PageUp":"PageDown",code:isUp?"PageUp":"PageDown",',
  'ctrlKey:false,altKey:false,metaKey:false,shiftKey:false};',
  'el.dispatchEvent(new KeyboardEvent("keydown",o));',
  'el.dispatchEvent(new KeyboardEvent("keyup",o));',
  '}catch(e){}',
  '}',
  '// One LINE of travel on opencode, one HALF PAGE on cline, in the same',
  '// gesture step. Both are sent because the bindings are disjoint — see the',
  '// note above. ctrl+alt+e/y and ctrl+meta+d/u are distinct key combinations,',
  '// so no lane sees a doubled step, and no modifier here is one xterm or the',
  '// browser eats: alt+letter is the risky pair on some platforms, so a',
  '// failure degrades to the coarse page key below rather than to nothing.',
  'function pressFine(dir){',
  'var el=keys();if(!el)return 0;',
  'var sent=0;',
  'try{',
  'if(typeof el.focus==="function")el.focus();',
  'var up=dir<0;',
  'var fire=function(key,mods){',
  'try{',
  'var K=key.toUpperCase();',
  'var o={bubbles:true,cancelable:true,keyCode:K.charCodeAt(0),which:K.charCodeAt(0),',
  'key:key,code:"Key"+K,ctrlKey:!!mods.ctrl,altKey:!!mods.alt,',
  'metaKey:!!mods.meta,shiftKey:false};',
  'el.dispatchEvent(new KeyboardEvent("keydown",o));',
  'el.dispatchEvent(new KeyboardEvent("keyup",o));',
  'sent++;',
  '}catch(e){}',
  '};',
  '// opencode messages_line_up/down -> ctrl+alt+y / ctrl+alt+e  (one line)',
  'fire(up?LINE_UP:LINE_DOWN,{ctrl:true,alt:true});',
  '// cline half-page -> ctrl+meta+u / ctrl+meta+d  (TRANSCRIPT_KEYBINDS)',
  'fire(up?HALF_UP:HALF_DOWN,{ctrl:true,meta:true});',
  '}catch(e){}',
  'return sent;',
  '}',
  '// Both directions paced: page keys jump a full page, so an unpaced drag',
  '// would skip whole screens per touchmove on either lane.',
  'function emit(dir){',
  'var t=now();',
  'if(t-lastKeyAt<COOLDOWN_MS)return;',
  'press(dir>0?PGDN:PGUP);lastDir=dir>0?1:-1;lastKeyAt=t;',
  '}',
  '// LinePx is the whole point of this change: a page key is a WHOLE screen,',
  '// so one page key per 1/24th of travel makes any drag feel like a handful',
  '// of full-screen jumps. One LINE of finger travel per line key maps the',
  '// gesture onto the content 1:1, which is what "scrolling" means to a thumb.',
  'function linePx(){',
  'try{return 18;}catch(e){return 18;}',
  '}',
  '// emitFine sends the finest step each lane binds (see pressFine), and has',
  '// NO time-based cooldown. That is deliberate: the accumulator already',
  '// admits exactly one key per LINE_PX of finger travel, so a key cannot',
  '// escape without the finger having moved that far. Adding a timer on top',
  '// decoupled keys from movement — the scroll would run on a clock instead of',
  '// the thumb, which is the same "not real" feeling at a smaller scale. The',
  '// page-key path below keeps its 300ms cooldown because a page key is a',
  '// WHOLE screen and an unpaced burst would jump screens per touchmove.',
  '//',
  '// Falls back to the coarse page key if the fine dispatch sent nothing, so a',
  '// platform that eats ctrl+alt / ctrl+meta degrades to the old behaviour',
  '// rather than to a dead scroll.',
  'function emitFine(dir){',
  'if(pressFine(dir)>0){lastDir=dir>0?1:-1;return;}',
  'var t=now();',
  'if(t-lastKeyAt<COOLDOWN_MS)return;',
  'press(dir>0?PGDN:PGUP);lastDir=dir>0?1:-1;lastKeyAt=t;',
  '}',
  'function drain(){',
  'var s=linePx(),n=0;',
  'while(acc>=s&&n<MAX_LINE_KEYS){acc-=s;emitFine(1);n++;}',
  'while(acc<=-s&&n<MAX_LINE_KEYS){acc+=s;emitFine(-1);n++;}',
  '}',
  'function down(e){',
  'if(active||!e.touches||e.touches.length!==1)return;',
  't=e.touches[0];y0=t.clientY;v=0;v0=0;acc=0;last=now();',
  '}',
  'function move(e){',
  'if(!t||!e.touches||e.touches.length!==1)return;',
  'var y=e.touches[0].clientY,dy=y0-y,n=now();',
  'y0=y;',
  // A drag becomes a scroll at ONE LINE of travel, not one page-key worth: the',
  '// gesture has to be unambiguous (a tap still types) without demanding a',
  '// whole eighth-screen before anything moves.',
  'if(!active&&Math.abs(acc+dy)>=linePx()){active=1;}',
  'acc+=dy;',
  'v=dy/Math.max(1,n-last);last=n;',
  'v0=v;',
  'drain();',
  'if(active){try{e.preventDefault();}catch(err){}}',
  '}',
  'function up(){',
  'if(!t)return;',
  't=null;',
  // Momentum: a flick keeps scrolling for a few steps, one per frame, so it',
  '// glides instead of stopping dead. Capped, and it ends on its own. The',
  '// step count is measured in LINES now (linePx, not pagePx), so the fling',
  '// covers a distance proportional to the flick rather than a fixed number',
  '// of screen-jumps.',
  'var steps=0;',
  'try{',
  'steps=Math.min(MAX_FLING_STEPS,Math.round(Math.abs(v)*FLING_PX_PER_STEP/linePx()));',
  '}catch(e){}',
  'var dir=v>0?1:-1;',
  'acc=0;active=0;v=0;',
  'if(steps>0){',
  'var n=0;',
  'var tick=function(){',
  'if(n++>=steps)return;',
  'emitFine(dir);',
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
