#!/data/data/com.termux/files/usr/bin/node
/**
 * The Telegram Mini App's front door: one login, one tunnel, one surface.
 *
 * What it guards: ttyd's PTY, which is the opencode TUI this phone exposes
 * inside Telegram. ttyd cannot ask a WebView for a password, and Telegram's
 * WebView cannot answer an HTTP Basic challenge (no credential prompt, empty
 * 401 body) — so the lock has to be a form and a cookie:
 *
 *   no cookie   -> a real login form (200, so the WebView shows something)
 *   POST /__login with the password -> HttpOnly cookie, 302 to /tui/
 *   valid cookie -> proxy to ttyd at /tui/, with the auth header ttyd trusts
 *
 * The password never reaches the client and is only ever compared here.
 *
 * Three things this proxy had to get right, each learned the hard way:
 *
 * - The hop-by-hop header filter is fatal on an upgrade. Strip `Connection`
 *   and `Upgrade` and ttyd sees a plain GET, answers 404, and the terminal
 *   loads a page that never paints. They go back on in upgradeTo().
 * - `Origin` is re-pointed upstream. ttyd runs with --check-origin and
 *   compares Origin to Host; passing the browser's tunnel origin through
 *   beside an upstream Host reads as cross-site, and ttyd never answers.
 * - Compression is refused for the socket, and honoured-then-restored for the
 *   page. Chrome always offers permessage-deflate; a raw-socket bridge that
 *   half-relays that negotiation hands the browser frames it cannot decode.
 *   For HTML the reverse applies: ttyd gzips 730 KB down to 191 KB, so the
 *   body is decoded, injected into, and re-compressed rather than corrupted.
 *
 * `/tui` also gets three injected buttons, because the APIs that would do this
 * properly (Telegram.WebApp.requestFullscreen and friends) are JavaScript and
 * cannot be reached by typing a slash command into the chat.
 *
 * Binds loopback only. The public path is the cloudflared tunnel in front of
 * THIS port, so nothing here is reachable except through the tunnel and the
 * cookie.
 */
import http from 'node:http';
import net from 'node:net';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.MINIAPP_SHIM_PORT || 8895);
const PASSWORD = String(process.env.MINIAPP_PASSWORD || '');
const SESSION_FILE = String(process.env.MINIAPP_SESSION_FILE || path.join(os.homedir(), '.miniapp-shim-sessions.json'));
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const COOKIE = 'miniapp_session';
const LOGIN_PATH = '/__login';
const LOGOUT_PATH = '/__logout';
// ttyd is told to trust a header instead of doing auth itself
// (ttyd --auth-header), because a WebView cannot answer a Basic challenge.
const TUI_BASE = '/tui';
const TUI_HOST = String(process.env.MINIAPP_TUI_HOST || '127.0.0.1');
const TUI_PORT = Number(process.env.MINIAPP_TUI_PORT || 8896);
const TUI_AUTH_HEADER = 'x-tui-auth';

// What the root serves now that `opencode web` is gone. It is deliberately not
// a proxy any more: the web UI fought the WebView three ways (Basic auth it
// cannot answer, a project list in browser storage that opens empty, no deep
// link that survives a tunnel hostname change), and /tui covers the same ground
// as a real terminal. Leaving its server running behind this would keep a
// second, worse surface alive for no gain.
const GONE_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>opencode</title><style>
  :root { color-scheme: dark; }
  body { margin:0; min-height:100dvh; display:flex; align-items:center; justify-content:center;
         padding:24px; background:#0d0d0f; color:#e8e8ea;
         font:15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  main { max-width:340px; } h1 { font-size:18px; margin:0 0 10px; }
  p { color:#8b8b93; margin:0 0 18px; } a { color:#3a7afe; }
</style></head>
<body><main>
  <h1>opencode lives at <a href="${TUI_BASE}/">/tui/</a></h1>
  <p>The chat web UI was removed: it is a chat client rather than a terminal, and
     it could not answer for itself inside a WebView. The TUI is this same
     conversation in a real terminal.</p>
</main></body></html>`;

if (!PASSWORD) {
  console.error('[shim] MINIAPP_PASSWORD is empty — refusing to start (that would publish an unauthenticated agent shell)');
  process.exit(1);
}

const log = (...args) => console.log(`[shim ${new Date().toISOString()}]`, ...args);

// ------------------------------------------------------------------ sessions
// Persisted, so a shim or tunnel restart does not log the phone out of the
// Mini App; the WebView keeps the cookie but the shim would otherwise forget
// which token it had handed out.
const sessions = new Map();
try {
  const raw = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
  const now = Date.now();
  for (const [token, expiry] of Object.entries(raw)) {
    if (Number(expiry) > now) sessions.set(token, Number(expiry));
  }
  if (sessions.size) log(`loaded ${sessions.size} live session(s)`);
} catch {
  // no file yet, or unreadable: start empty
}
let saveTimer = null;
function persistSessions() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.writeFileSync(SESSION_FILE, JSON.stringify(Object.fromEntries(sessions)), { mode: 0o600 });
    } catch (err) {
      log(`could not persist sessions: ${err.message}`);
    }
  }, 500);
  saveTimer.unref?.();
}

function newSession() {
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  persistSessions();
  return token;
}

function sessionValid(token) {
  if (!token) return false;
  const expiry = sessions.get(token);
  if (!expiry) return false;
  if (expiry <= Date.now()) {
    sessions.delete(token);
    persistSessions();
    return false;
  }
  return true;
}

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

// ------------------------------------------------------------------- the lock
// Brute force over a public tunnel is the only way past this, so failures are
// rate limited per client address rather than merely counted.
const failures = new Map();
const LOCKOUT_MS = 60_000;
function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
}
function lockedOut(ip) {
  const row = failures.get(ip);
  if (!row) return false;
  if (row.until && row.until > Date.now()) return true;
  if (row.until && row.until <= Date.now()) failures.delete(ip);
  return false;
}
function noteFailure(ip) {
  const row = failures.get(ip) || { count: 0, until: 0 };
  row.count += 1;
  // 5 tries a minute; after that a minute of nothing.
  if (row.count >= 5) {
    row.until = Date.now() + LOCKOUT_MS;
    row.count = 0;
  }
  failures.set(ip, row);
}
function noteSuccess(ip) {
  failures.delete(ip);
}

function passwordMatches(candidate) {
  const a = Buffer.from(String(candidate || ''));
  const b = Buffer.from(PASSWORD);
  // Constant-time, and length-safe: a plain !== leaks the length and the first
  // differing byte, which is plenty for a public endpoint.
  if (a.length !== b.length) {
    crypto.timingSafeEqual(b, b);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

// --------------------------------------------------------------- login page
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function loginPage({ error = '', notice = '' } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>opencode — sign in</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100dvh; display: flex; align-items: center; justify-content: center;
    padding: 24px; background: #0d0d0f; color: #e8e8ea;
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  form { width: 100%; max-width: 340px; }
  h1 { font-size: 18px; font-weight: 600; margin: 0 0 4px; }
  p.sub { margin: 0 0 20px; color: #8b8b93; font-size: 13px; }
  input {
    width: 100%; padding: 14px 16px; font-size: 16px; color: #fff; background: #1c1c1f;
    border: 1px solid #2c2c2e; border-radius: 12px; outline: none;
  }
  input:focus { border-color: #3a7afe; }
  button {
    width: 100%; margin-top: 12px; padding: 14px 16px; font-size: 16px; font-weight: 600;
    color: #fff; background: #3a7afe; border: 0; border-radius: 12px; cursor: pointer;
  }
  button:active { opacity: 0.85; }
  .err { margin: 0 0 14px; padding: 10px 12px; border-radius: 10px; background: #3a1416; color: #ff9a9a; font-size: 13px; }
  .note { margin: 18px 0 0; color: #6e6e73; font-size: 12px; }
</style>
</head>
<body>
<form method="post" action="${LOGIN_PATH}">
  <h1>opencode</h1>
  <p class="sub">This terminal is password-gated.</p>
  ${error ? `<p class="err">${esc(error)}</p>` : ''}
  ${notice ? `<p class="note">${esc(notice)}</p>` : ''}
  <input type="password" name="password" placeholder="Password" autocomplete="current-password" autofocus required />
  <button type="submit">Unlock</button>
  <p class="note">Same password the bot uses for its work sessions.</p>
</form>
</body>
</html>`;
}

function cookieHeader(token, req) {
  // Secure only when the request actually arrived over TLS (the tunnel sets
  // x-forwarded-proto), so local testing over http still works.
  const secure = String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https' ? '; Secure' : '';
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure}`;
}

// ------------------------------------------------------------------- proxy
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);

const TUI_CHROME = `
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<script>
(function () {
  var tg = (window.Telegram && window.Telegram.WebApp) || null;
  try { if (tg && tg.expand) tg.expand(); } catch (e) {}
  // Vertical swipes collapse the Mini App; a terminal is scrolled by dragging
  // all over it, so that gesture has to belong to the page.
  try { if (tg && tg.disableVerticalSwipes) tg.disableVerticalSwipes(); } catch (e) {}

  function place(el) {
    var s = el.style;
    s.position = 'fixed';
    s.top = 'calc(env(safe-area-inset-top, 0px) + 6px)';
    s.zIndex = 2147483647;
    return el;
  }
  function add(label, title, fn) {
    var b = document.createElement('button');
    b.textContent = label;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.style.cssText = 'position:relative;margin-left:6px;padding:7px 9px;font-size:14px;line-height:1;'
      + 'border-radius:8px;border:1px solid #3a3a3d;background:rgba(22,22,24,0.9);color:#e8e8ea;'
      + '-webkit-tap-highlight-color:transparent;';
    b.addEventListener('click', function (ev) { ev.preventDefault(); try { fn(); } catch (e) {} });
    return b;
  }
  function fullscreen() {
    // Telegram's own fullscreen where it exists (Bot API 8+), DOM fullscreen
    // otherwise: inside the WebView the visible result is the same.
    try { if (tg && tg.requestFullscreen) { tg.requestFullscreen(); return; } } catch (e) {}
    var el = document.documentElement;
    if (el.requestFullscreen) el.requestFullscreen();
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  }
  function keyboard() {
    // xterm.js listens on a helper textarea; focusing it is what raises the
    // soft keyboard, and a bare focus() is not always enough on a phone.
    var ta = document.querySelector('textarea.xterm-helper-textarea')
      || document.querySelector('.xterm-screen textarea')
      || document.querySelector('textarea');
    if (!ta) return;
    ta.focus();
    try { ta.click(); } catch (e) {}
    if (ta.scrollIntoView) ta.scrollIntoView({ block: 'center' });
  }
  function close() { try { if (tg && tg.close) tg.close(); } catch (e) {} }

  function mount() {
    if (document.getElementById('tg-chrome')) return;
    var wrap = document.createElement('div');
    wrap.id = 'tg-chrome';
    wrap.appendChild(add('⛶', 'Fullscreen', fullscreen));
    wrap.appendChild(add('⌨', 'Show keyboard', keyboard));
    wrap.appendChild(add('✕', 'Close', close));
    document.body.appendChild(place(wrap));
  }
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();
</script>
`;

/**
 * Put the Telegram chrome in front of ttyd's own HTML.
 *
 * `Telegram.WebApp.requestFullscreen()` is a JS API: there is no chat command
 * that can reach it, and ttyd knows nothing about Telegram. The shim is the one
 * place that sees both, so it injects the buttons rather than leaving the user
 * to type a slash command that would do nothing.
 */
function injectTuiChrome(html) {
  const text = String(html);
  if (text.includes('id="tg-chrome"')) return text;
  if (/<\/body>/i.test(text)) return text.replace(/<\/body>/i, `${TUI_CHROME}</body>`);
  return text + TUI_CHROME;
}

function tuiHeaders(req) {
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (HOP_BY_HOP.has(k)) continue;
    if (k === 'cookie' || k === 'host') continue;
    headers[k] = v;
  }
  headers.host = `${TUI_HOST}:${TUI_PORT}`;
  // The browser's Origin names the tunnel, not this socket. ttyd runs with
  // --check-origin and compares the two, so a passthrough Origin reads as a
  // cross-site socket and ttyd simply never answers. Re-point it upstream;
  // the cookie is the real lock, this only keeps ttyd's own check meaningful.
  if (headers.origin) headers.origin = `http://${TUI_HOST}:${TUI_PORT}`;
  // Refuse to relay permessage-deflate for the terminal. Chrome always offers
  // it, and a raw-socket bridge that half-relays a compression negotiation ends
  // up feeding the browser frames it cannot decode — a screen of replacement
  // characters instead of a prompt. Terminal output is small and latency
  // matters far more than the bytes, so the safe answer is to never negotiate
  // it: ttyd then sends plain frames, which is the path verified end-to-end.
  delete headers['sec-websocket-extensions'];
  // The cookie already proved identity; ttyd only needs to be told so.
  headers[TUI_AUTH_HEADER] = '1';
  return headers;
}

/**
 * Undo the upstream's compression so the body can be edited as text.
 * Returns null when the bytes are not what the header claims.
 */
function decodeUpstream(buf, contentEncoding) {
  const enc = String(contentEncoding || '').toLowerCase();
  if (!enc || enc === 'identity') return { body: buf, reencode: '' };
  try {
    if (enc.includes('br')) return { body: zlib.brotliDecompressSync(buf), reencode: 'br' };
    if (enc.includes('gzip')) return { body: zlib.gunzipSync(buf), reencode: 'gzip' };
    if (enc.includes('deflate')) return { body: zlib.inflateSync(buf), reencode: 'deflate' };
  } catch {
    return null;
  }
  return null;
}

function encodeUpstream(buf, encoding) {
  if (encoding === 'gzip') return zlib.gzipSync(buf);
  if (encoding === 'br') {
    return zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } });
  }
  if (encoding === 'deflate') return zlib.deflateSync(buf);
  return buf;
}

function proxyTo({ host, port, headers }, req, res, label, transformHtml = null) {
  const target = http.request({ host, port, method: req.method, path: req.url, headers }, (up) => {
    const type = String(up.headers['content-type'] || '');
    if (!transformHtml || !/text\/html/i.test(type)) {
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
      return;
    }
    // Buffer only HTML, and only to inject into. Streaming everything would
    // cost memory on a page that never ends (the terminal WS is not HTML, so it
    // still streams untouched).
    const chunks = [];
    let size = 0;
    up.on('data', (c) => {
      size += c.length;
      if (size > 8 * 1024 * 1024) {
        up.destroy();
        return;
      }
      chunks.push(c);
    });
    up.on('end', () => {
      const rawBuf = Buffer.concat(chunks);
      const decoded = decodeUpstream(rawBuf, up.headers['content-encoding']);
      if (!decoded) {
        // If the bytes are not what the header claims, do not touch them. A
        // browser told "gzip" over corrupt bytes paints replacement characters;
        // the same browser told the truth just fails to load, which is honest.
        res.writeHead(up.statusCode || 502, up.headers);
        res.end(rawBuf);
        return;
      }
      const body = transformHtml(decoded.body.toString('utf8'));
      const out = { ...up.headers };
      // The body is no longer framed the way ttyd framed it. Leaving
      // transfer-encoding: chunked on a response that has no chunk headers
      // makes the client read a plain body as chunks and stop early.
      delete out['transfer-encoding'];
      delete out['content-length'];
      // Re-apply the compression the client asked for: ttyd's page is 730 KB
      // raw and 191 KB gzipped, which matters on a phone.
      let final = Buffer.from(body, 'utf8');
      if (decoded.reencode) {
        final = encodeUpstream(final, decoded.reencode);
        out['content-encoding'] = decoded.reencode;
      } else {
        delete out['content-encoding'];
      }
      out['content-length'] = String(final.length);
      res.writeHead(up.statusCode || 502, out);
      res.end(final);
    });
    up.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
      res.end(`${label} did not answer`);
    });
  });
  target.on('error', (err) => {
    log(`${label} error ${req.method} ${req.url}: ${err.message}`);
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
    res.end(`${label} is not answering on the phone right now`);
  });
  req.pipe(target);
}

function proxyTui(req, res) {
  proxyTo({ host: TUI_HOST, port: TUI_PORT, headers: tuiHeaders(req) }, req, res, 'the TUI', injectTuiChrome);
}

/** WebSocket (and any other upgrade): rewrite the handshake onto a raw socket. */
function upgradeTo({ host, port, headers }, req, clientSocket, head, label) {
  const upstream = net.connect(port, host, () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    // The hop-by-hop filter above is right for ordinary requests and fatal
    // here: drop Connection/Upgrade and the server sees a plain GET, answers
    // 404, and the terminal never paints. Put them back, and forward the
    // client's own key/extensions verbatim so the handshake ttyd completes is
    // the one the browser started.
    const out = { ...headers, connection: 'Upgrade', upgrade: 'websocket' };
    for (const [k, v] of Object.entries(out)) {
      if (Array.isArray(v)) for (const item of v) lines.push(`${k}: ${item}`);
      else lines.push(`${k}: ${v}`);
    }
    upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
    if (head && head.length) upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });
  const drop = () => {
    try { upstream.destroy(); } catch {}
    try { clientSocket.destroy(); } catch {}
  };
  upstream.on('error', (err) => {
    log(`${label} upgrade error ${req.url}: ${err.message}`);
    drop();
  });
  clientSocket.on('error', drop);
  clientSocket.on('close', () => {
    try { upstream.end(); } catch {}
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const ip = clientIp(req);

  if (url.pathname === LOGIN_PATH) {
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST' });
      res.end();
      return;
    }
    if (lockedOut(ip)) {
      log(`login locked out for ${ip}`);
      res.writeHead(429, { 'content-type': 'text/html; charset=utf-8' });
      res.end(loginPage({ error: 'Too many attempts. Wait a minute and try again.' }));
      return;
    }
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      // A password field does not need a body; anything huge is a probe.
      if (size > 64 * 1024) req.destroy();
      else chunks.push(c);
    });
    req.on('end', () => {
      if (req.destroyed && size > 64 * 1024) return;
      const password = new URLSearchParams(Buffer.concat(chunks).toString('utf8')).get('password') || '';
      if (!passwordMatches(password)) {
        noteFailure(ip);
        log(`bad password from ${ip}`);
        res.writeHead(401, { 'content-type': 'text/html; charset=utf-8' });
        res.end(loginPage({ error: 'That password is not right.' }));
        return;
      }
      noteSuccess(ip);
      const token = newSession();
      log(`session issued for ${ip}`);
      res.writeHead(302, { location: url.searchParams.get('next') || '/', 'set-cookie': cookieHeader(token, req) });
      res.end();
    });
    return;
  }

  if (url.pathname === LOGOUT_PATH) {
    const token = cookies(req)[COOKIE];
    if (token) {
      sessions.delete(token);
      persistSessions();
    }
    res.writeHead(302, { location: '/', 'set-cookie': `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` });
    res.end();
    return;
  }

  if (!sessionValid(cookies(req)[COOKIE])) {
    // Anything that is not the login form gets the form, not a Basic
    // challenge: a WebView cannot answer a challenge, and a 401 shows nothing.
    if (url.pathname !== '/') {
      res.writeHead(302, { location: `/?next=${encodeURIComponent(url.pathname + url.search)}` });
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(loginPage({}));
    return;
  }

  if (url.pathname === TUI_BASE || url.pathname.startsWith(`${TUI_BASE}/`)) {
    proxyTui(req, res);
    return;
  }

  // Not the TUI: point at the TUI instead of proxying a UI we removed.
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(GONE_PAGE);
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(`Nothing here. The TUI is at ${TUI_BASE}/\n`);
});

server.on('upgrade', (req, socket, head) => {
  if (!sessionValid(cookies(req)[COOKIE])) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  // ttyd's terminal is one long-lived WebSocket; without this the Mini App
  // would load its page and then sit on a dead socket forever. Nothing else
  // upgrades any more — there is no second surface behind this proxy.
  if (req.url === TUI_BASE || req.url.startsWith(`${TUI_BASE}/`)) {
    upgradeTo({ host: TUI_HOST, port: TUI_PORT, headers: tuiHeaders(req) }, req, socket, head, 'the TUI');
    return;
  }
  socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
  socket.destroy();
});

server.on('clientError', (err, socket) => {
  if (!socket.destroyed) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
});
server.keepAliveTimeout = 65_000;

server.listen(PORT, '127.0.0.1', () => {
  const line = `listening on 127.0.0.1:${PORT} -> TUI at ${TUI_BASE} -> ${TUI_HOST}:${TUI_PORT}`;
  log(line);
  console.log(`[shim ${new Date().toISOString()}] ${line}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    try { fs.writeFileSync(SESSION_FILE, JSON.stringify(Object.fromEntries(sessions)), { mode: 0o600 }); } catch {}
    process.exit(0);
  });
}
