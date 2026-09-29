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

/** The page. One string, no bundler, no second copy of any formatter. */
export function forgePageHtml() {
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
  p.lede { color: #9fb0c0; margin: 0 0 16px; font-size: 13px; }
  label { display: block; margin: 12px 0 4px; font-size: 13px; color: #9fb0c0; }
  input { width: 100%; box-sizing: border-box; padding: 10px; border-radius: 8px;
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
    <input id="token" name="token" placeholder="123456789:AA…" autocomplete="off">
    <p class="lede" id="tokenHint">Leave the token empty to let the userbot ask @BotFather. If that is not configured,
      open <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather</a>, send <code>/newbot</code>,
      and paste the token here.</p>
    <button id="submit" type="submit">Create bot</button>
  </form>

  <ol class="steps" id="steps"></ol>
  <div class="note" id="note">Checking this host…</div>

<script>
const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
if (tg) { try { tg.ready(); tg.expand(); } catch (e) {} }

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

async function loadState() {
  try {
    const res = await fetch('/api/state');
    const state = await res.json();
    const bots = (state.bots || []).join(', ') || 'none';
    const userbot = state.userbot && state.userbot.configured
      ? 'userbot ready (@BotFather automation is on).'
      : 'userbot not configured: ' + ((state.userbot && state.userbot.reason) || 'unknown') +
        '\\nThe paste path below works without it.';
    say('master: ' + state.master + '\\nbots: ' + bots + '\\n' + userbot);
    if (state.userbot && !state.userbot.configured) {
      el('tokenHint').textContent = state.userbot.reason;
    }
  } catch (err) {
    say('could not read forge state: ' + err.message, true);
  }
}

el('forge').addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = String(el('name').value || '').trim();
  const token = String(el('token').value || '').trim();
  if (!name) return;
  el('submit').disabled = true;
  say('creating ' + name + '…');
  stepsEl.innerHTML = '';
  try {
    const res = await fetch('/api/forge', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-telegram-init-data': tg ? String(tg.initData || '') : '',
      },
      body: JSON.stringify({ name, token }),
    });
    const body = await res.json();
    if (Array.isArray(body.steps)) renderSteps(body.steps);
    if (res.ok === false || body.ok === false) {
      say((body.reason || 'creation failed') + (body.hostCommands && body.hostCommands.length ? '\\n\\n' + body.hostCommands.join('\\n') : ''), true);
    } else {
      say('created ' + body.bot.id + '. It replies in Telegram once the host finishes enabling it.', false);
      el('token').value = '';
    }
  } catch (err) {
    say('request failed: ' + err.message, true);
  } finally {
    el('submit').disabled = false;
    loadState();
  }
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
 * The server. `runCreate` is injected, so the HTTP layer cannot invent a second
 * creation path and the tests can drive it without spawning anything.
 */
export function createForgeServer({ env = process.env, registry = {}, runCreate, buildRegistryView = null, allowLocal = true, log = () => {} } = {}) {
  if (typeof runCreate !== 'function') throw new Error('createForgeServer needs a runCreate(input, meta) function');

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    try {
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(forgePageHtml());
      }

      if (req.method === 'GET' && url.pathname === '/api/state') {
        const view = buildRegistryView ? buildRegistryView() : { master: registry.master || '', bots: (registry.bots || []).map((b) => b.id) };
        const { userbotState } = await import('./tg-userbot.mjs');
        const userbot = await userbotState(env);
        return sendJson(res, 200, { ok: true, ...view, userbot: { configured: userbot.configured, reason: userbot.reason, hostCommands: userbot.hostCommands } });
      }

      if (req.method === 'POST' && url.pathname === '/api/forge') {
        const raw = await readBody(req);
        let input = {};
        try {
          input = raw ? JSON.parse(raw) : {};
        } catch {
          return sendJson(res, 400, { ok: false, reason: 'body must be JSON' });
        }
        const auth = authorizeForge({
          initData: String(req.headers[FORGE_INIT_HEADER] || url.searchParams.get('initData') || ''),
          remoteAddress: req.socket?.remoteAddress || '',
          registry,
          env,
          allowLocal,
        });
        if (!auth.ok) {
          log(`forge refused (${auth.via ? 'initData' : 'no door'}): ${auth.reason}`);
          return sendJson(res, auth.status || 401, { ok: false, reason: auth.reason });
        }
        const result = await runCreate(input, { via: auth.via });
        return sendJson(res, result.ok ? 200 : 422, result);
      }

      return sendJson(res, 404, { ok: false, reason: `no route for ${req.method} ${url.pathname}` });
    } catch (err) {
      log(`forge error: ${err.message}`);
      return sendJson(res, 500, { ok: false, reason: err.message });
    }
  });

  return server;
}
