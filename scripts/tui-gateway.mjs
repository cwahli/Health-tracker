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
 *   TUI_TTYD_URL          default http://127.0.0.1:8896
 *   TUI_GATEWAY_SECRET    server secret for signing session tokens
 *   TUI_BOT_TOKEN_<id>    the Telegram bot token per bot id
 *   TUI_SESSION_TTL_SEC   default 900
 */
import crypto from 'node:crypto';
import http from 'node:http';
import { URL } from 'node:url';

export const COOKIE_NAME = 'tui_session';
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
  for (const [k, v] of params.entries()) {
    if (k === 'hash' || k === 'signature') continue;
    pairs.push(`${k}=${v}`);
  }
  // Telegram requires the key=value pairs sorted by key.
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  // secret_key = HMAC_SHA256("WebAppData", bot_token)
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return fail('hash mismatch');

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

  // The Mini App is opened from a chat; binding to it is what stops bot A's
  // token opening bot B's conversation.
  const chatId = user.id;
  return { ok: true, reason: '', user, chatId, authDate, queryId: params.get('query_id') || '' };
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

/** Which bot token to check against, given the bot ids this gateway serves. */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function tokenFor(botId, env = process.env) {
  const direct = env[`TUI_BOT_TOKEN_${String(botId).toUpperCase().replace(/[^A-Z0-9]/g, '_')}`];
  if (direct) return direct;
  return env.TUI_BOT_TOKEN || '';
}


/**
 * The injected page.
 *
 * ttyd 1.7.7 inlines its whole client into one HTML page, so there is nothing to
 * import and no build step: the gateway takes ttyd's own page and rewrites it.
 * Two things are injected — the session token (as a value, never a URL) and a
 * `WebSocket` shim, because a browser cannot set a header on a websocket and
 * ttyd's client opens one itself.
 *
 * The shim only touches a socket that is talking to this ttyd, so nothing else
 * on the page is affected.
 */
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
  '<style>html,body{margin:0;height:100%;background:#0d0d0f;color:#e8e8ea;',
  'font:14px system-ui;display:flex;align-items:center;justify-content:center;',
  'text-align:center;padding:24px}</style>',
  '</head><body><div id="m">opening the terminal\u2026</div>',
  '<script>',
  '(function () {',
  '  var m = document.getElementById("m");',
  '  var bot = new URLSearchParams(location.search).get("bot") || "vm";',
  '  var initData = (window.Telegram && Telegram.WebApp && Telegram.WebApp.initData) || "";',
  '  if (!initData) {',
  '    m.textContent = "no initData \u2014 open this from the /tui button in Telegram";',
  '    return;',
  '  }',
  '  location.replace("/?bot=" + encodeURIComponent(bot) +',
  '                  "&initData=" + encodeURIComponent(initData));',
  '})();',
  '</script></body></html>',
].join("\n");

function injectInto(html, token) {
  // The two patterns are built with `new RegExp` instead of written as
  // literals. This is a template literal, and inside one a backslash before a
  // slash collapses, so /\/ws/ would reach the browser as //ws/ — a comment,
  // not a pattern. The shim would then never fire and the websocket would open
  // with no credential on it, which is the one failure this whole file exists to
  // prevent. Escaping that correctly through a template literal is a trap, so
  // the slashes are sidestepped instead.
  const boot = [
    '<script>',
    '(function () {',
    '  var TOKEN = ' + JSON.stringify(token) + ';',
    '  var Native = window.WebSocket;',
    '  var IS_WS = new RegExp("/ws(" + String.fromCharCode(63) + "|$)");',
    '  var SCHEME = new RegExp("^(wss?:" + String.fromCharCode(47, 47) + ")");',
    '  function Patched(url, protocols) {',
    '    if (typeof url === "string" && IS_WS.test(url)) {',
    "      url = url.replace(SCHEME, '$1' + TOKEN + ':x@');",
    '    }',
    '    return protocols === undefined ? new Native(url) : new Native(url, protocols);',
    '  }',
    '  Patched.prototype = Native.prototype;',
    '  Patched.CONNECTING = Native.CONNECTING; Patched.OPEN = Native.OPEN;',
    '  Patched.CLOSING = Native.CLOSING; Patched.CLOSED = Native.CLOSED;',
    '  window.WebSocket = Patched;',
    '})();',
    '</script>',
  ].join('\n');
  // Ahead of ttyd's own scripts, so the shim is installed first.
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + '\n' + boot);
  return boot + html;
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

function cookieValue(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return '';
}

export function createGateway({ env = process.env, log = () => {} } = {}) {
  const secret = env.TUI_GATEWAY_SECRET || '';
  const ttyd = env.TUI_TTYD_URL || 'http://127.0.0.1:8896';
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
      const botId = url.searchParams.get('bot') || env.TUI_BOT_ID || 'vm';
      const verdict = validateInitData(initData, tokenFor(botId, env));
      if (!verdict.ok) {
        log(`landing refused (${verdict.reason})`);
        res.writeHead(401, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(`<!doctype html><meta charset=utf-8><body style="font:14px system-ui;background:#0d0d0f;color:#e8e8ea;padding:24px">
          <h1>refused</h1><p>${escapeHtml(verdict.reason)}</p></body>`);
      }
      const token = issueToken({ botId, chatId: verdict.chatId, secret, ttlSec: ttl });
      log(`admitted bot=${botId} chat=${verdict.chatId}`);
      res.writeHead(302, {
        'location': '/tty/',
        'set-cookie': `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${ttl}`,
        'cache-control': 'no-store',
      });
      return res.end();
    }

    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, ttyd: ttyd.replace(/:\d+$/, ':<port>') }));
    }

    // The Mini App's first request: initData in the query, exchanged for a token.
    if (url.pathname === '/auth') {
      const initData = url.searchParams.get('initData') || '';
      const botId = url.searchParams.get('bot') || env.TUI_BOT_ID || 'vm';
      const verdict = validateInitData(initData, tokenFor(botId, env));
      if (!verdict.ok) {
        log(`refused (${verdict.reason})`);
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: verdict.reason }));
      }
      const token = issueToken({ botId, chatId: verdict.chatId, secret, ttlSec: ttl });
      log(`admitted bot=${botId} chat=${verdict.chatId}`);
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ ok: true, token, bot: botId, chat: verdict.chatId, ttyd: '/tty/' }));
    }

    // Caddy calls this before proxying the websocket. Answering 204 lets the
    // upgrade through; anything else stops it before a socket exists.
    if (url.pathname === '/authz') {
      const verdict = verifyToken(presentedToken(req, url), secret);
      if (!verdict.ok) {
        log(`authz refused (${verdict.reason})`);
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: verdict.reason }));
      }
      res.writeHead(204);
      return res.end();
    }

    // The page. The socket is NOT proxied from here: node's upgrade handling
    // hung up on the socket, and Caddy proxies upgrades properly. So this path
    // serves ttyd's HTML with the shim injected, and /tty/ws is Caddy's.
    if (url.pathname === '/tty/' || url.pathname === '/tty') {
      const token = presentedToken(req, url);
      const verdict = verifyToken(token, secret);
      if (!verdict.ok) {
        log(`page refused (${verdict.reason})`);
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: verdict.reason }));
      }
      if (!ttydCredential) {
        res.writeHead(503, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'gateway has no TUI_TTYD_CREDENTIAL' }));
      }
      return serveInjectedPage(req, res, ttyd, token, ttydCredential);
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: false, error: 'not found' }));
  };
}

/**
 * Fetch ttyd's page and serve it with the session token and the WebSocket shim
 * injected. Identity encoding is requested on purpose: the body is rewritten as
 * text, so a gzipped response would reach the browser as gzip bytes with the
 * header stripped — row S7's replacement characters, reached the other way.
 */
function serveInjectedPage(req, res, ttydBase, token, ttydCredential = '') {
  const target = new URL('/tty/', ttydBase);
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
        const html = injectInto(Buffer.concat(chunks).toString('utf8'), token);
        res.writeHead(up.statusCode || 200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'content-length': String(Buffer.byteLength(html)),
        });
        res.end(html);
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

export function start(env = process.env) {
  const port = Number(env.TUI_GATEWAY_PORT || 8897);
  const bind = env.TUI_GATEWAY_BIND || '127.0.0.1';
  const handle = createGateway({ env, log: (m) => console.log('[tui-gateway]', m) });
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

if (process.argv[1] && process.argv[1].endsWith('tui-gateway.mjs')) start();
