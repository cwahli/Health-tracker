/**
 * bot-forge-server.mjs — the button on the front of the forge.
 *
 * The page is one self-contained HTML string: no build step, no app upstream, no
 * second formatter. It is the same document whether it is opened in a desktop
 * browser or as a Telegram Mini App, which is what makes the whole forge
 * testable on a laptop with no Telegram account and no VPS. In Telegram it
 * becomes a Mini App by reading `Telegram.WebApp.initData`; in a browser on the
 * host it is admitted because the request arrived on loopback.
 *
 * AUTH, STATED HONESTLY
 * ---------------------
 * This endpoint mints Telegram bots and writes credentials, so it is never
 * anonymous:
 *   - a Telegram Mini App must present `initData` that HMAC-verifies against one
 *     of the fleet's own bot tokens (the validator is `validateInitData` from
 *     `scripts/tui-gateway.mjs`, already hardened for the current signed shape —
 *     reusing it is the point: there is one initData door, not two);
 *   - a plain browser is admitted only from loopback, and only when the caller
 *     allowed it. Binding anywhere but loopback turns that admission off.
 *
 * The server is a thin shell over `runCreate`, so the pipeline itself lives in
 * one place and the transport cannot add a second creation path.
 */

import fs from 'node:fs';
import http from 'node:http';

import { PIPELINE_STEPS } from './bot-forge-core.mjs';
import { validateInitData } from '../tui-gateway.mjs';

export const FORGE_INIT_HEADER = 'x-telegram-init-data';

/** Bot tokens the fleet holds in this process, for the initData check. */
export function fleetTokenCandidates(registry = {}, env = process.env) {
  const out = [];
  for (const bot of Array.isArray(registry.bots) ? registry.bots : []) {
    const name = bot?.telegram?.tokenEnv;
    if (!name) continue;
    const token = String(env[name] || '').trim();
    if (token) out.push({ botId: bot.id, token });
  }
  return out;
}

export function isLoopback(address) {
  const value = String(address || '');
  return value === '127.0.0.1' || value === '::1' || value === '::ffff:127.0.0.1';
}

/**
 * The authorization decision, as a pure-ish function so refusals are testable.
 * Returns the reason on refusal — an operator who cannot get in has to know
 * which door was tried.
 */
export function authorizeForge({ initData = '', remoteAddress = '', registry = {}, env = process.env, allowLocal = false, now = Date.now() } = {}) {
  const candidates = fleetTokenCandidates(registry, env);
  if (initData) {
    for (const candidate of candidates) {
      const verdict = validateInitData(initData, candidate.token, { now });
      if (verdict.ok) return { ok: true, via: `initData:${candidate.botId}`, chatId: verdict.chatId };
    }
    return { ok: false, status: 401, reason: 'initData did not verify against any bot token this host holds (stale, forged, or from a bot that is not in the registry)' };
  }
  if (allowLocal && isLoopback(remoteAddress)) {
    return { ok: true, via: 'loopback' };
  }
  return {
    ok: false,
    status: 401,
    reason: allowLocal
      ? 'no initData and the request did not come from loopback — open the page from the Telegram button, or from the host itself'
      : 'this forge is bound to a non-loopback address, so it requires Telegram initData',
  };
}

/**
 * The page. One string, no bundler, no second copy of any formatter.
 *
 * `apiBase` is where this page's own API lives: `/api` when the forge owns its
 * own port, `/forge/api` when the gateway mounts it under a prefix. Inlined at
 * generation time, so the served HTML still carries the literal paths.
 */
export function forgePageHtml({ apiBase = '/api' } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bot forge</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 16px; background: #101418; color: #e8eef4;
         font: 15px/1.45 -apple-system, system-ui, "Segoe UI", Roboto, sans-serif; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 26px 0 4px; color: #cfdae4; }
  p.lede { color: #9fb0c0; margin: 0 0 16px; font-size: 13px; }
  label { display: block; margin: 12px 0 4px; font-size: 13px; color: #9fb0c0; }
  input, select { width: 100%; box-sizing: border-box; padding: 10px; border-radius: 8px;
          border: 1px solid #2b3642; background: #161c22; color: inherit; font: inherit; }
  button { margin-top: 16px; width: 100%; padding: 12px; border: 0; border-radius: 8px;
           background: #2f7d4f; color: #fff; font: inherit; font-weight: 600; }
  button[disabled] { background: #33404c; color: #93a3b2; }
  a { color: #6fb3ff; }
  ol.steps { list-style: none; margin: 16px 0 0; padding: 0; font-size: 13px; }
  ol.steps li { display: flex; gap: 8px; padding: 5px 0; border-bottom: 1px solid #1c2318; }
  ol.steps li .mark { width: 1.2em; }
  ol.steps li[data-status="done"] .mark { color: #5ad07f; }
  ol.steps li[data-status="failed"] .mark { color: #ff7b72; }
  ol.steps li[data-status="skipped"] .mark { color: #6b7784; }
  .note { margin-top: 16px; padding: 10px; border-radius: 8px; background: #161c22; font-size: 13px;
          white-space: pre-wrap; word-break: break-word; }
  .note.err { background: #2a1719; }
  code { background: #1b232b; padding: 1px 4px; border-radius: 4px; }
</style>
</head>
<body>
  <h1>Bot forge</h1>
  <p class="lede">Name it, and it joins the fleet as a clone of the master bot.</p>

  <form id="forge">
    <label for="name">Bot name</label>
    <input id="name" name="name" placeholder="VM3 Bot" autocomplete="off" required>
    <label for="token">Bot token</label>
    <input id="token" name="token" placeholder="Leave empty for 1-click, or paste the full token" autocomplete="off">
    <p class="lede" id="tokenHint">Leave the token empty to let the userbot ask @BotFather. If that is not configured,
      open <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather</a>, send <code>/newbot</code>,
      and paste the token here.</p>
    <button id="submit" type="submit">Create bot</button>
  </form>

  <ol class="steps" id="steps"></ol>
  <div class="note" id="note">Checking this host…</div>

  <h2>Finish a row that exists</h2>
  <p class="lede" id="attachLede">A row with no working token yet is listed here.</p>
  <form id="attach">
    <label for="existing">Bot already in the registry</label>
    <select id="existing"></select>
    <label for="attachToken">Its @BotFather token</label>
    <input id="attachToken" name="attachToken" placeholder="123456789:AA…" autocomplete="off">
    <button id="attachSubmit" type="submit">Attach token</button>
  </form>

<script>
const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
if (tg) { try { tg.ready(); tg.expand(); } catch (e) {} }

// Same three-step order as the TUI exchange page: the bare Telegram global,
// then window.Telegram, then the tgWebAppData launch param in the URL hash.
// Some clients never inject window.Telegram but still carry the launch params
// in the hash. A plain browser (no Telegram, no hash) yields '' and fails
// closed at the server exactly as before.
function forgeInitData() {
  try {
    if (typeof Telegram !== 'undefined' && Telegram && Telegram.WebApp && Telegram.WebApp.initData) {
      return String(Telegram.WebApp.initData);
    }
  } catch (e) {}
  try {
    if (typeof window !== 'undefined' && window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData) {
      return String(window.Telegram.WebApp.initData);
    }
  } catch (e) {}
  try {
    if (typeof location !== 'undefined' && location && location.hash) {
      var data = new URLSearchParams(String(location.hash).replace(/^#/, '')).get('tgWebAppData');
      if (data) return String(data);
    }
  } catch (e) {}
  return '';
}

const el = (id) => document.getElementById(id);
const stepsEl = el('steps');
const noteEl = el('note');

function renderSteps(steps) {
  stepsEl.innerHTML = '';
  for (const step of steps) {
    const li = document.createElement('li');
    li.dataset.status = step.status;
    const mark = document.createElement('span');
    mark.className = 'mark';
    mark.textContent = step.status === 'done' ? '\\u2713' : step.status === 'failed' ? '\\u2717' : '\\u00b7';
    const body = document.createElement('span');
    body.textContent = step.title + (step.detail ? ' \\u2014 ' + step.detail : '');
    li.append(mark, body);
    stepsEl.append(li);
  }
}

function say(text, isError) {
  noteEl.textContent = text;
  noteEl.className = isError ? 'note err' : 'note';
}

function showNote(text, isError) {
  say(text, isError);
  try { if (noteEl.scrollIntoView) noteEl.scrollIntoView({ block: 'nearest' }); } catch (e) {}
}

// Same shape check as the server (bot-forge-core validateToken): <bot id>:<secret>.
// A placeholder paste must fail HERE, next to the button — not as a receipt
// below the fold where a tap looks like it did nothing.
function tokenShapeError(token) {
  const value = String(token || '').trim();
  if (!value) return '';
  if (/^\\d{5,12}:[A-Za-z0-9_-]{30,50}$/.test(value)) return '';
  return 'that does not look like a bot token. @BotFather gives one line shaped like 123456789:AA… (30-50 characters after the colon); a name, a truncated paste and a username all fail this check on purpose. Leave it empty for 1-click, or paste the full line.';
}

function botLabel(bot) {
  const name = bot.name && bot.name !== bot.id ? ' (' + bot.name + ')' : '';
  return bot.id + name + (bot.enabled ? '' : ' — no token yet');
}

function fillExisting(bots) {
  const select = el('existing');
  const chosen = select.value;
  select.innerHTML = '';
  for (const bot of bots) {
    const option = document.createElement('option');
    option.value = bot.id;
    option.textContent = botLabel(bot);
    select.append(option);
  }
  if (chosen) select.value = chosen;
  el('attachSubmit').disabled = bots.length === 0;
  if (!bots.length) el('attachLede').textContent = 'The registry has no rows yet — create one above.';
  else if (bots.some((b) => !b.enabled)) el('attachLede').textContent = 'A row with no working token yet is listed here. Paste its token and the same pipeline finishes it without writing a second row.';
  else el('attachLede').textContent = 'Every row is already enabled, so attaching a token here rotates it.';
}

async function loadState() {
  try {
    const res = await fetch('${apiBase}/state', {
      headers: { 'x-telegram-init-data': forgeInitData() },
    });
    const state = await res.json();
    if (!state.ok) {
      say(state.reason || 'could not read forge state', true);
      return;
    }
    const bots = Array.isArray(state.bots) ? state.bots : [];
    fillExisting(bots);
    const list = bots.map(botLabel).join(', ') || 'none';
    const userbot = state.userbot && state.userbot.configured
      ? 'userbot ready (@BotFather automation is on).'
      : 'userbot not configured: ' + ((state.userbot && state.userbot.reason) || 'unknown') +
        '\\nThe paste path below works without it.';
    say('master: ' + state.master + '\\nbots: ' + list + '\\n' + userbot);
  } catch (err) {
    say('could not read forge state: ' + err.message, true);
  }
}

async function post(input) {
  stepsEl.innerHTML = '';
  showNote((input.mode === 'attach' ? 'attaching a token to ' : 'creating ') + (input.id || input.name) + '…');
  try {
    const res = await fetch('${apiBase}/forge', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-telegram-init-data': forgeInitData(),
      },
      body: JSON.stringify(input),
    });
    const body = await res.json();
    if (Array.isArray(body.steps)) renderSteps(body.steps);
    if (res.ok === false || body.ok === false) {
      showNote((body.reason || 'the forge stopped') + (body.hostCommands && body.hostCommands.length ? '\\n\\n' + body.hostCommands.join('\\n') : ''), true);
      return false;
    }
    const bot = body.bot || {};
    showNote((bot.attached ? 'attached the token to ' : 'created ') + (bot.id || input.id) + '. It replies in Telegram once the host finishes enabling it.', false);
    return true;
  } catch (err) {
    showNote('request failed: ' + err.message, true);
    return false;
  }
}

el('forge').addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = String(el('name').value || '').trim();
  if (!name) return;
  const bad = tokenShapeError(el('token').value);
  if (bad) { showNote(bad, true); return; }
  el('submit').disabled = true;
  if (await post({ name, token: String(el('token').value || '').trim() })) el('token').value = '';
  el('submit').disabled = false;
  loadState();
});

el('attach').addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = String(el('existing').value || '').trim();
  const token = String(el('attachToken').value || '').trim();
  if (!id || !token) return;
  const bad = tokenShapeError(token);
  if (bad) { showNote(bad, true); return; }
  el('attachSubmit').disabled = true;
  if (await post({ mode: 'attach', id, token })) el('attachToken').value = '';
  el('attachSubmit').disabled = false;
  loadState();
});

renderSteps(${JSON.stringify(PIPELINE_STEPS.map((s) => ({ ...s, status: 'pending' })))});
loadState();
</script>
</body>
</html>
`;
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

/**
 * The request handler, mountable.
 *
 * `basePath` is where the caller serves the forge: '' when the forge owns its
 * own port, '/forge' when the TUI gateway mounts it. It decides BOTH the routes
 * and the page's own API base, so a mounted forge and a standalone one are this
 * one handler with a prefix — never a second copy of the pipeline.
 *
 * `authorize` is the door, injectable so the mounting server keeps its own:
 * the gateway passes its initData check (its token set is `TUI_BOT_TOKEN_<id>`,
 * not the registry's `<id>_BOT_TOKEN`). It returns { ok, status, reason, via }.
 *
 * `registryPath` is where the registry file lives. When given, a state request
 * re-reads it instead of serving the object parsed at construction: the forge
 * itself writes new rows to that file, so a gateway started before the last
 * create must still list it. The passed `registry` object stays the fallback
 * for an unreadable or mid-write file.
 *
 * Returns `false` when the path is not the forge's, so a mounting server can
 * fall through to its own routes.
 */
export function createForgeHandler({
  env = process.env,
  registry = {},
  registryPath = '',
  runCreate,
  buildRegistryView = null,
  allowLocal = true,
  log = () => {},
  basePath = '',
  requireStateAuth = false,
  authorize = authorizeForge,
} = {}) {
  if (typeof runCreate !== 'function') throw new Error('createForgeHandler needs a runCreate(input, meta) function');
  const pagePaths = basePath ? [basePath, `${basePath}/`, `${basePath}/index.html`] : ['/', '/index.html'];
  const apiBase = `${basePath}/api`;
  const statePath = `${apiBase}/state`;
  const forgePath = `${apiBase}/forge`;

  // The registry file is written by the create pipeline, so the state view
  // must be the file as of the request, not as of gateway start. The parsed
  // object passed at construction is the fallback: a read or parse error
  // (file mid-write) degrades to the startup snapshot, never to a blank page.
  const readStateRegistry = () => {
    if (!registryPath) return registry;
    try {
      return JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    } catch {
      return registry;
    }
  };

  return async function handleForgeRequest(req, res) {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    try {
      // The page is public: it holds no secret, and the create below still
      // needs a door. A cold Mini App WebView has no initData in the URL.
      if (req.method === 'GET' && pagePaths.includes(url.pathname)) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(forgePageHtml({ apiBase }));
        return true;
      }

      if (req.method === 'GET' && url.pathname === statePath) {
        const stateRegistry = readStateRegistry();
        if (requireStateAuth) {
          const auth = authorize({
            initData: String(req.headers[FORGE_INIT_HEADER] || url.searchParams.get('initData') || ''),
            remoteAddress: req.socket?.remoteAddress || '',
            registry: stateRegistry,
            env,
            allowLocal,
          });
          if (!auth.ok) {
            log(`forge state refused (${auth.reason})`);
            sendJson(res, auth.status || 401, { ok: false, reason: auth.reason });
            return true;
          }
        }
        // The page needs the rows, not just their ids: `enabled` is the honest
        // "has no working token yet" signal, and the id/name pair is what the
        // attach path targets. A caller may still inject its own view.
        const view = buildRegistryView
          ? buildRegistryView()
          : {
              master: stateRegistry.master || '',
              bots: (stateRegistry.bots || []).map((b) => ({
                id: b.id,
                name: b.name || b.id,
                enabled: b.enabled !== false,
                tokenEnv: b.telegram?.tokenEnv || '',
                runtime: b.runtime || 'bot-host',
              })),
            };
        const { userbotState } = await import('./tg-userbot.mjs');
        const userbot = await userbotState(env);
        sendJson(res, 200, { ok: true, ...view, userbot: { configured: userbot.configured, reason: userbot.reason, hostCommands: userbot.hostCommands } });
        return true;
      }

      if (req.method === 'POST' && url.pathname === forgePath) {
        const raw = await readBody(req);
        let input = {};
        try {
          input = raw ? JSON.parse(raw) : {};
        } catch {
          sendJson(res, 400, { ok: false, reason: 'body must be JSON' });
          return true;
        }
        const auth = authorize({
          initData: String(req.headers[FORGE_INIT_HEADER] || url.searchParams.get('initData') || ''),
          remoteAddress: req.socket?.remoteAddress || '',
          registry,
          env,
          allowLocal,
        });
        if (!auth.ok) {
          log(`forge refused (${auth.via ? 'initData' : 'no door'}): ${auth.reason}`);
          sendJson(res, auth.status || 401, { ok: false, reason: auth.reason });
          return true;
        }
        const result = await runCreate(input, { via: auth.via });
        sendJson(res, result.ok ? 200 : 422, result);
        return true;
      }

      return false;
    } catch (err) {
      log(`forge error: ${err.message}`);
      if (!res.headersSent) sendJson(res, 500, { ok: false, reason: err.message });
      return true;
    }
  };
}

/**
 * The server. `runCreate` is injected, so the HTTP layer cannot invent a second
 * creation path and the tests can drive it without spawning anything.
 */
export function createForgeServer(options = {}) {
  const handle = createForgeHandler(options);
  const log = options.log || (() => {});
  return http.createServer((req, res) => {
    handle(req, res)
      .then((handled) => {
        if (handled || res.headersSent) return;
        const pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;
        sendJson(res, 404, { ok: false, reason: `no route for ${req.method} ${pathname}` });
      })
      .catch((err) => {
        log(`forge error: ${err.message}`);
        if (!res.headersSent) sendJson(res, 500, { ok: false, reason: err.message });
      });
  });
}
