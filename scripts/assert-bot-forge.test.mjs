import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  PIPELINE_STEPS,
  parseBotFatherToken,
  planForge,
  slugifyName,
  summarizeRun,
  tokenEnvFor,
  tokenOwnershipConflict,
  usernameCandidates,
  validateBotName,
  validateToken,
  describeUserbot,
} from './lib/bot-forge-core.mjs';
import { negotiateBotToken, resolveTeleproto } from './lib/tg-userbot.mjs';
import { authorizeForge, createForgeHandler, forgePageHtml, isLoopback } from './lib/bot-forge-server.mjs';
import { renderUserUnit, readMasterTokens, upsertMasterToken } from './bot-forge.mjs';
import { toTelegramCommands } from './lib/commands.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = '123456789:AAF-test-token-not-real-000000000000';
const OTHER_TOKEN = '987654321:AAG-other-token-not-real-111111111111';

const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bot-forge-'));

/**
 * A registry fixture shaped like the real one: a master plus one clone already
 * taken, so the duplicate refusals have something to collide with.
 */
function registryFixture() {
  return {
    master: 'vm',
    bots: [
      {
        id: 'vm',
        name: 'VM Bot',
        runtime: 'bot-host',
        enabled: true,
        telegram: { tokenEnv: 'VM_BOT_TOKEN', allowedUserIds: [1] },
        agent: { kind: 'opencode', model: 'opencode/one', sharedSkills: ['a', 'b'] },
        progress: { mode: 'concise', maxChars: 220 },
        session: { mode: 'per-chat' },
      },
      {
        id: 'vm2',
        name: 'VM2 Bot',
        runtime: 'bot-host',
        enabled: true,
        extends: 'vm',
        telegram: { tokenEnv: 'VM2_BOT_TOKEN' },
        agent: { playwrightOutputDir: '/tmp/vm2' },
      },
    ],
  };
}

/** Build initData the way Telegram does (decoded pairs sorted, HMAC over them). */
function makeInitData(fields, token = TOKEN) {
  const keys = Object.keys(fields).sort();
  const dataCheckString = keys.map((k) => `${k}=${fields[k]}`).join('\n');
  const wire = keys.map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(fields[k])}`).join('&');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  return `${wire}&hash=${hash}`;
}

/** A Bot API that answers getMe + setMyCommands and records what it was asked. */
function startFakeTelegram() {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const m = String(req.url || '').match(/^\/bot([^/]+)\/([A-Za-z]+)$/);
      if (!m) {
        res.writeHead(404, { 'content-type': 'application/json' });
        return res.end('{"ok":false}');
      }
      let payload = {};
      try { payload = body ? JSON.parse(body) : {}; } catch { payload = {}; }
      calls.push({ token: m[1], method: m[2], payload });
      const result = m[2] === 'getMe'
        ? { id: Number(m[1].split(':')[0]), is_bot: true, first_name: 'Forged', username: 'forged_test_bot' }
        : true;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, result }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, calls }));
  });
}

function extractJson(stdout, args) {
  if (!args.includes('--json')) return null;
  const start = String(stdout || '').indexOf('{');
  if (start < 0) return null;
  try { return JSON.parse(String(stdout).slice(start)); } catch { return null; }
}

/** Run the CLI the way an operator (or the Mini App backend) does. */
function runCli(args) {
  const res = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'bot-forge.mjs'), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const stdout = String(res.stdout || '');
  return { status: res.status, stdout, stderr: String(res.stderr || ''), json: extractJson(stdout, args) };
}

/**
 * The async twin. A run whose Bot API is a server *in this test process* must
 * not be spawned synchronously: spawnSync blocks the event loop, so the fake
 * API could never answer and the run would look like a network timeout.
 */
function runCliAsync(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'bot-forge.mjs'), ...args], { cwd: ROOT });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (status) => resolve({ status, stdout, stderr, json: extractJson(stdout, args) }));
  });
}

// ---------------------------------------------------------------- pure core

test('a name becomes a place name', () => {
  assert.equal(slugifyName('VM3 Bot'), 'vm3');
  assert.equal(slugifyName('Meal Audit'), 'meal_audit');
  assert.equal(slugifyName('Space Bunny Bot'), 'space_bunny');
  // A name that is nothing but the word "bot" leaves no place name at all, and
  // validateBotName refuses it rather than inventing one.
  assert.equal(slugifyName('bot'), '');
  assert.notEqual(validateBotName('bot'), '');
});

test('a usable name plans a thin clone of the master', () => {
  const plan = planForge({ registry: registryFixture(), name: 'VM3 Bot', token: TOKEN });
  assert.equal(plan.ok, true, plan.reason);
  assert.equal(plan.plan.id, 'vm3');
  assert.equal(plan.plan.tokenEnv, 'VM3_BOT_TOKEN');
  assert.equal(plan.plan.masterId, 'vm');
  assert.equal(plan.plan.tokenSource, 'paste');
});

test('a name with no letters or digits is refused with a reason', () => {
  const plan = planForge({ registry: registryFixture(), name: '!!!', token: TOKEN });
  assert.equal(plan.ok, false);
  assert.match(plan.reason, /letter or digit|usable id/);
  assert.notEqual(validateBotName(''), '');
});

test('a token that is not token-shaped is refused (a name or a truncated paste)', () => {
  for (const bad of ['VM3 Bot', '123456789', '123456789:short', '']) {
    const verdict = validateToken(bad);
    assert.equal(verdict.ok, false, `${bad} should not pass`);
  }
  const good = validateToken(TOKEN);
  assert.equal(good.ok, true);
  assert.equal(good.botId, 123456789);
});

test('a taken id is refused', () => {
  const plan = planForge({ registry: registryFixture(), name: 'VM2 Bot', token: TOKEN });
  assert.equal(plan.ok, false);
  assert.match(plan.reason, /already in the registry/);
});

test('a token already used by another registry bot is refused', () => {
  const registry = registryFixture();
  registry.bots[1].telegram.token = TOKEN;
  const plan = planForge({ registry, name: 'VM3 Bot', token: TOKEN });
  assert.equal(plan.ok, false);
  assert.match(plan.reason, /one token is one poller/);
});

test('an attach plan finishes a row that exists and borrows its name', () => {
  const registry = registryFixture();
  registry.bots.push({ id: 'pm', name: 'PM Bot', runtime: 'bot-host', enabled: false, extends: 'vm', telegram: { tokenEnv: 'PM_BOT_TOKEN' } });

  const planned = planForge({ registry, mode: 'attach', id: 'pm', token: TOKEN });
  assert.equal(planned.ok, true, planned.reason);
  assert.equal(planned.plan.attached, true);
  assert.equal(planned.plan.id, 'pm');
  assert.equal(planned.plan.name, 'PM Bot', 'the row already knows its name');
  assert.equal(planned.plan.tokenEnv, 'PM_BOT_TOKEN', 'and its own token key');
  assert.equal(planned.plan.wasEnabled, false);

  // A row that is already enabled is a rotation, not a new bot.
  const rotate = planForge({ registry, mode: 'attach', id: 'vm', token: OTHER_TOKEN });
  assert.equal(rotate.ok, true, rotate.reason);
  assert.equal(rotate.plan.wasEnabled, true);

  // Create still refuses the id, and now says which verb finishes it instead.
  const clash = planForge({ registry, mode: 'create', name: 'PM Bot', token: OTHER_TOKEN });
  assert.equal(clash.ok, false);
  assert.match(clash.reason, /already in the registry/);
  assert.match(clash.reason, /--attach=pm/);
});

test('attach refuses what it cannot do, and names the reason', () => {
  const registry = registryFixture();
  assert.match(planForge({ registry, mode: 'attach', id: 'vm9', token: TOKEN }).reason, /not in the registry/);
  const userbot = planForge({ registry, mode: 'attach', id: 'vm2', tokenSource: 'userbot' });
  assert.equal(userbot.ok, false);
  assert.match(userbot.reason, /cannot mint a second one/);
  assert.match(planForge({ registry, mode: 'attach', id: 'vm2', token: 'not-a-token' }).reason, /does not look like a bot token/);
  assert.match(planForge({ registry: { bots: [] }, mode: 'typo', name: 'X Bot' }).reason, /unknown mode/);
});

test('attaching a token another row already carries is refused', () => {
  const registry = registryFixture();
  registry.bots[1].telegram.token = TOKEN; // vm2 holds it, and only one poller may
  const planned = planForge({ registry, mode: 'attach', id: 'vm', token: TOKEN });
  assert.equal(planned.ok, false);
  assert.match(planned.reason, /one token is one poller/);
});

test('a token that is already the value of another master key is refused', () => {
  assert.match(tokenOwnershipConflict({ VM_BOT_TOKEN: TOKEN }, { token: TOKEN, tokenEnv: 'VM3_BOT_TOKEN' }), /already the value/);
  assert.equal(tokenOwnershipConflict({ VM3_BOT_TOKEN: TOKEN }, { token: TOKEN, tokenEnv: 'VM3_BOT_TOKEN' }), '');
  assert.equal(tokenOwnershipConflict({ VM_BOT_TOKEN: OTHER_TOKEN }, { token: TOKEN, tokenEnv: 'VM3_BOT_TOKEN' }), '');
});

test('usernames always end in "bot" and are unique enough to retry with', () => {
  const candidates = usernameCandidates('VM3 Bot');
  assert.ok(candidates.length >= 3, 'one guess is not a one-click forge');
  assert.equal(new Set(candidates).size, candidates.length);
  for (const c of candidates) assert.match(c, /^[A-Za-z][A-Za-z0-9_]{2,29}bot$/);
});

test('the userbot is described by what is missing, not by a single "no"', () => {
  const missingModule = describeUserbot({});
  assert.match(missingModule.reason, /teleproto/);
  const missingKeys = describeUserbot({ moduleAvailable: true });
  assert.match(missingKeys.reason, /TELEGRAM_API_ID/);
  const missingSession = describeUserbot({ moduleAvailable: true, apiId: '1', apiHash: 'h' });
  assert.match(missingSession.reason, /session/);
  const ready = describeUserbot({ moduleAvailable: true, apiId: '1', apiHash: 'h', sessionExists: true, sessionFile: '/x' });
  assert.equal(ready.configured, true);
  for (const state of [missingModule, missingKeys, missingSession]) {
    assert.ok(state.hostCommands.length >= 2, 'the operator needs the exact commands, not a hint');
  }
});

// ------------------------------------------------- BotFather conversation

test('a BotFather reply yields the token', () => {
  const parsed = parseBotFatherToken(`Done! Congratulations on your new bot. Use this token to access the HTTP API:\n${TOKEN}\nKeep it secure!`);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.token, TOKEN);
  assert.equal(parseBotFatherToken('Sorry, this username is already taken').ok, false);
  assert.equal(parseBotFatherToken('Sorry, this username is already taken').taken, true);
});

test('a taken username retries instead of giving up', async () => {
  const sent = [];
  const replies = [
    "Alright, a new bot. How are we going to call it?",           // /newbot
    'Good. Now let\'s choose a username for your bot.',           // the display name
    'Sorry, this username is already taken. Please try another.',  // first candidate
    `Done! Use this token: ${TOKEN}`,                             // second candidate
  ];
  const result = await negotiateBotToken({
    send: async (text) => {
      const reply = replies[sent.length] ?? '';
      sent.push(text);
      return reply;
    },
    name: 'VM3 Bot',
  });
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.token, TOKEN);
  assert.equal(sent.length, 4, `expected a retry, saw ${JSON.stringify(sent)}`);
  assert.equal(sent[0], '/newbot');
  assert.equal(sent[1], 'VM3 Bot');
});

test('an unrecognised BotFather answer stops rather than pretending to retry', async () => {
  const result = await negotiateBotToken({
    send: async (text) => (text === '/newbot' ? 'What?' : 'Unknown command'),
    name: 'VM3 Bot',
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /unexpectedly/);
});

test('every username taken is a clean refusal naming the candidates', async () => {
  const result = await negotiateBotToken({
    send: async (text) => (/^\/newbot$/.test(text) ? 'name?' : /^VM3 Bot$/.test(text) ? 'username?' : 'Sorry, that name is taken'),
    name: 'VM3 Bot',
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /taken/);
});

// ------------------------------------------------- teleproto import shape
//
// teleproto@1.229.0 (gramjs-derived) exports TelegramClient at top level but
// keeps StringSession under the `sessions` namespace. A flat destructure of
// both died with `StringSession is not a constructor` and killed
// `userbot-login` instantly; resolveTeleproto is the one place that knows the
// shape. Fixtures only — no account, no network, no client.connect().

test('resolveTeleproto resolves a gramjs-shaped module', () => {
  function FakeClient() {}
  function FakeSession() {}
  const resolved = resolveTeleproto({ TelegramClient: FakeClient, sessions: { StringSession: FakeSession } });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.TelegramClient, FakeClient);
  assert.equal(resolved.StringSession, FakeSession);
});

test('resolveTeleproto refuses a module missing the sessions namespace with a sentence', () => {
  function FakeClient() {}
  const resolved = resolveTeleproto({ TelegramClient: FakeClient });
  assert.equal(resolved.ok, false);
  assert.match(resolved.reason, /sessions\.StringSession/);
  assert.match(resolved.reason, /unexpected shape/);
});

test('the real teleproto module resolves and constructs a client without touching the network', async () => {
  const mod = await import('teleproto');
  const resolved = resolveTeleproto(mod);
  assert.equal(resolved.ok, true, resolved.reason);
  const session = new resolved.StringSession('');
  const client = new resolved.TelegramClient(session, 12345, 'hash-not-real', { connectionRetries: 3 });
  assert.ok(client, 'construction must not throw');
  assert.equal(typeof client.disconnect, 'function');
});

// ------------------------------------------------------------ supervision

test('the user unit is a transform of the repo system unit, one source', () => {
  const systemUnit = fs.readFileSync(path.join(ROOT, 'systemd', 'bot-host@.service'), 'utf8');
  const unit = renderUserUnit({ systemUnitText: systemUnit, botHostRoot: '/srv/bot-host', configDir: '/srv/config' });
  assert.match(unit.text, /WantedBy=default\.target/);
  assert.doesNotMatch(unit.text, /^User=/m);
  assert.doesNotMatch(unit.text, /^Group=/m);
  assert.match(unit.execStart, /bot-host\.mjs --id=%i/);
  assert.match(unit.text, /WorkingDirectory=\/srv\/bot-host/);
  assert.equal(unit.environmentFile, '/srv/config/%i.env');
  assert.match(unit.text, /EnvironmentFile=-\/srv\/config\/%i\.env/);
});

test('the master token file is upserted in place and keeps its other lines', () => {
  const dir = scratch();
  const file = path.join(dir, 'tokens.env');
  fs.writeFileSync(file, 'VM_BOT_TOKEN=keep-me\n# a comment\n');
  upsertMasterToken(file, 'VM3_BOT_TOKEN', TOKEN);
  const after = readMasterTokens(file);
  assert.equal(after.VM_BOT_TOKEN, 'keep-me');
  assert.equal(after.VM3_BOT_TOKEN, TOKEN);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  upsertMasterToken(file, 'VM3_BOT_TOKEN', OTHER_TOKEN);
  assert.equal(readMasterTokens(file).VM3_BOT_TOKEN, OTHER_TOKEN);
  assert.equal(readMasterTokens(file).VM_BOT_TOKEN, 'keep-me', 'a second write must not clobber the first bot');
});

// ------------------------------------------------------------------- auth

test('the forge door: initData, or loopback, and nothing else', () => {
  const registry = registryFixture();
  const env = { VM_BOT_TOKEN: TOKEN };
  assert.equal(isLoopback('127.0.0.1'), true);
  assert.equal(isLoopback('10.0.0.5'), false);

  const fresh = String(Math.floor(Date.now() / 1000));
  const good = makeInitData({ auth_date: fresh, user: JSON.stringify({ id: 42 }) });
  assert.equal(authorizeForge({ initData: good, registry, env }).ok, true);
  assert.match(authorizeForge({ initData: good, registry, env }).via, /^initData:vm$/);

  const forged = `${good.split('&hash=')[0]}&hash=${'0'.repeat(64)}`;
  assert.equal(authorizeForge({ initData: forged, registry, env }).ok, false);
  assert.equal(authorizeForge({ initData: makeInitData({ auth_date: fresh, user: JSON.stringify({ id: 42 }) }, OTHER_TOKEN), registry, env }).ok, false);

  assert.equal(authorizeForge({ remoteAddress: '127.0.0.1', registry, env, allowLocal: true }).ok, true);
  assert.equal(authorizeForge({ remoteAddress: '127.0.0.1', registry, env, allowLocal: false }).ok, false);
  assert.equal(authorizeForge({ remoteAddress: '203.0.113.9', registry, env, allowLocal: true }).ok, false);
});

test('the page posts to the one endpoint and carries initData', () => {
  const html = forgePageHtml();
  assert.match(html, /\/api\/forge/);
  assert.match(html, /x-telegram-init-data/);
  assert.match(html, /Telegram\.WebApp/);
  assert.match(html, /forgeInitData/);
  assert.match(html, /tgWebAppData/);
  assert.match(html, /BotFather/);
  for (const step of PIPELINE_STEPS) assert.ok(html.includes(step.title) || html.includes(step.id), `page does not show ${step.id}`);
  // The attach path is on the page the operator already has — a registered row
  // with no token must not send anyone back to a shell.
  assert.match(html, /id="existing"/);
  assert.match(html, /mode: 'attach'/);
});

/**
 * A DOM stub just big enough for the page's own script.
 *
 * The button is the surface the operator actually touches, and its wiring (which
 * endpoint, which header, does every step render) is exactly what a screenshot
 * would not tell us. `assert-tui-gateway.test.mjs` runs its injected widget this
 * way; this is the same technique on the same shape of code.
 */
function makeDom({ telegram = null } = {}) {
  const elements = new Map();
  const element = () => ({
    value: '',
    textContent: '',
    className: '',
    disabled: false,
    dataset: {},
    children: [],
    handlers: {},
    set innerHTML(_v) { this.children.length = 0; },
    get innerHTML() { return ''; },
    append(...kids) { this.children.push(...kids); },
    addEventListener(ev, fn) { this.handlers[ev] = fn; },
  });
  for (const id of ['forge', 'name', 'token', 'tokenHint', 'steps', 'note', 'submit', 'attach', 'attachLede', 'existing', 'attachToken', 'attachSubmit']) elements.set(id, element());
  const document = {
    getElementById: (id) => elements.get(id) || null,
    createElement: () => element(),
  };
  const calls = [];
  const fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (String(url).includes('/api/state')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          master: 'vm',
          // vm already works; vm2 is the row that still has no token, which is
          // exactly the distinction the page has to draw.
          bots: [
            { id: 'vm', name: 'VM Bot', enabled: true, tokenEnv: 'VM_BOT_TOKEN' },
            { id: 'vm2', name: 'VM2 Bot', enabled: false, tokenEnv: 'VM2_BOT_TOKEN' },
          ],
          userbot: { configured: false, reason: 'no session', hostCommands: ['x'] },
        }),
      };
    }
    let input = {};
    try { input = JSON.parse(options.body || '{}'); } catch { input = {}; }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        bot: { id: input.id || 'vm3', name: input.name || 'VM3 Bot', attached: input.mode === 'attach' },
        steps: PIPELINE_STEPS.map((s) => ({ ...s, status: 'done', detail: 'ok' })),
      }),
    };
  };
  return { document, calls, fetch, window: { Telegram: telegram ? { WebApp: telegram } : undefined }, elements };
}

function runPageScript(dom) {
  const html = forgePageHtml();
  const script = html.match(/<script>([\s\S]*)<\/script>/);
  assert.ok(script, 'the page has no script');
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'fetch', 'console', script[1])(dom.window, dom.document, dom.fetch, console);
  return dom;
}

test('the button runs the pipeline and renders every step', async () => {
  const dom = runPageScript(makeDom());
  dom.document.getElementById('name').value = 'VM3 Bot';
  dom.document.getElementById('token').value = TOKEN;

  await dom.document.getElementById('forge').handlers.submit({ preventDefault() {} });

  const forged = dom.calls.find((c) => String(c.url).includes('/api/forge'));
  assert.ok(forged, 'the form did not post to /api/forge');
  assert.equal(forged.options.method, 'POST');
  assert.equal(forged.options.headers['x-telegram-init-data'], '', 'a browser has no initData, and sends none rather than a lie');
  assert.deepEqual(JSON.parse(forged.options.body), { name: 'VM3 Bot', token: TOKEN });

  const rows = dom.document.getElementById('steps').children;
  assert.equal(rows.length, PIPELINE_STEPS.length, 'every step should be shown');
  assert.ok(rows.every((r) => r.dataset.status === 'done'), 'a successful run should mark every row done');
  assert.match(dom.document.getElementById('note').textContent, /created vm3/);
  assert.equal(dom.document.getElementById('token').value, '', 'the token box is cleared after a create');
});

test('the button sends Telegram initData when a Mini App opened it', async () => {
  const dom = runPageScript(makeDom({ telegram: { ready() {}, expand() {}, initData: 'auth_date=1&user=%7B%22id%22%3A1%7D&hash=abc' } }));
  dom.document.getElementById('name').value = 'VM3 Bot';
  await dom.document.getElementById('forge').handlers.submit({ preventDefault() {} });
  const forged = dom.calls.find((c) => String(c.url).includes('/api/forge'));
  assert.equal(forged.options.headers['x-telegram-init-data'], 'auth_date=1&user=%7B%22id%22%3A1%7D&hash=abc');
});

test('the button sends bare-global Telegram initData when window.Telegram is missing', async () => {
  const saved = globalThis.Telegram;
  globalThis.Telegram = { WebApp: { ready() {}, expand() {}, initData: 'auth_date=2&hash=bare' } };
  try {
    const dom = runPageScript(makeDom());
    dom.document.getElementById('name').value = 'VM3 Bot';
    await dom.document.getElementById('forge').handlers.submit({ preventDefault() {} });
    const forged = dom.calls.find((c) => String(c.url).includes('/api/forge'));
    assert.equal(forged.options.headers['x-telegram-init-data'], 'auth_date=2&hash=bare');
  } finally {
    if (saved === undefined) delete globalThis.Telegram;
    else globalThis.Telegram = saved;
  }
});

test('the page falls back to the tgWebAppData hash param on both fetches', async () => {
  const saved = globalThis.location;
  const initData = 'auth_date=3&user=%7B%22id%22%3A3%7D&hash=fromhash';
  globalThis.location = { hash: `#tgWebAppData=${encodeURIComponent(initData)}&tgWebAppVersion=7.0` };
  try {
    const dom = runPageScript(makeDom());
    await new Promise((resolve) => setTimeout(resolve, 0)); // let loadState() resolve
    const state = dom.calls.find((c) => String(c.url).includes('/api/state'));
    assert.ok(state, 'the page did not load state');
    assert.equal(state.options.headers['x-telegram-init-data'], initData);

    dom.document.getElementById('name').value = 'VM3 Bot';
    await dom.document.getElementById('forge').handlers.submit({ preventDefault() {} });
    const forged = dom.calls.find((c) => String(c.url).includes('/api/forge'));
    assert.equal(forged.options.headers['x-telegram-init-data'], initData);
  } finally {
    if (saved === undefined) delete globalThis.location;
    else globalThis.location = saved;
  }
});

test('initData resolution prefers the bare global, then window.Telegram, then the hash', async () => {
  const savedTelegram = globalThis.Telegram;
  const savedLocation = globalThis.location;
  const initData = 'auth_date=4&hash=winner';
  globalThis.location = { hash: `#tgWebAppData=${encodeURIComponent('auth_date=4&hash=hashloser')}&tgWebAppVersion=7.0` };
  try {
    // window.Telegram beats the hash.
    let dom = runPageScript(makeDom({ telegram: { ready() {}, expand() {}, initData } }));
    dom.document.getElementById('name').value = 'VM3 Bot';
    await dom.document.getElementById('forge').handlers.submit({ preventDefault() {} });
    assert.equal(
      dom.calls.find((c) => String(c.url).includes('/api/forge')).options.headers['x-telegram-init-data'],
      initData,
    );

    // The bare global beats window.Telegram.
    globalThis.Telegram = { WebApp: { ready() {}, expand() {}, initData } };
    dom = runPageScript(makeDom({ telegram: { ready() {}, expand() {}, initData: 'auth_date=4&hash=windowloser' } }));
    dom.document.getElementById('name').value = 'VM3 Bot';
    await dom.document.getElementById('forge').handlers.submit({ preventDefault() {} });
    assert.equal(
      dom.calls.find((c) => String(c.url).includes('/api/forge')).options.headers['x-telegram-init-data'],
      initData,
    );
  } finally {
    if (savedTelegram === undefined) delete globalThis.Telegram;
    else globalThis.Telegram = savedTelegram;
    if (savedLocation === undefined) delete globalThis.location;
    else globalThis.location = savedLocation;
  }
});

test('an empty environment sends no initData on either fetch (fails closed)', async () => {
  const dom = runPageScript(makeDom());
  await new Promise((resolve) => setTimeout(resolve, 0)); // let loadState() resolve
  const state = dom.calls.find((c) => String(c.url).includes('/api/state'));
  assert.ok(state, 'the page did not load state');
  assert.equal(state.options.headers['x-telegram-init-data'], '');

  dom.document.getElementById('name').value = 'VM3 Bot';
  await dom.document.getElementById('forge').handlers.submit({ preventDefault() {} });
  const forged = dom.calls.find((c) => String(c.url).includes('/api/forge'));
  assert.equal(forged.options.headers['x-telegram-init-data'], '');
});

test('the button reports a refusal instead of claiming success', async () => {
  const dom = makeDom();
  dom.fetch = async (url) => {
    if (String(url).includes('/api/state')) return { ok: true, status: 200, json: async () => ({ ok: true, master: 'vm', bots: [], userbot: { configured: false, reason: 'r', hostCommands: [] } }) };
    return { ok: false, status: 422, json: async () => ({ ok: false, reason: 'that token is already registered to another bot', hostCommands: ['only you: X'] }) };
  };
  runPageScript(dom);
  dom.document.getElementById('name').value = 'VM3 Bot';
  await dom.document.getElementById('forge').handlers.submit({ preventDefault() {} });
  const note = dom.document.getElementById('note');
  assert.match(note.textContent, /already registered/);
  assert.match(note.textContent, /only you: X/, 'the operator gets the host-only command too');
  assert.equal(note.className, 'note err');
});

test('the page offers the attach path and posts it as a mode', async () => {
  const dom = runPageScript(makeDom());
  await new Promise((resolve) => setTimeout(resolve, 0)); // let loadState() resolve

  const select = dom.document.getElementById('existing');
  assert.deepEqual(select.children.map((o) => o.value), ['vm', 'vm2'], 'every row is offered');
  assert.match(select.children[1].textContent, /VM2 Bot/);
  assert.match(select.children[1].textContent, /no token yet/, 'the row that needs a token says so');

  select.value = 'vm2';
  dom.document.getElementById('attachToken').value = OTHER_TOKEN;
  await dom.document.getElementById('attach').handlers.submit({ preventDefault() {} });

  const forged = dom.calls.find((c) => String(c.url).includes('/api/forge'));
  assert.deepEqual(JSON.parse(forged.options.body), { mode: 'attach', id: 'vm2', token: OTHER_TOKEN });
  assert.match(dom.document.getElementById('note').textContent, /attached the token to vm2/);
  assert.equal(dom.document.getElementById('attachToken').value, '', 'the token box is cleared after an attach');
});

// ------------------------------------------------------- the HTTP surface

async function startForge(runCreate, { allowLocal }) {
  const server = (await import('./lib/bot-forge-server.mjs')).createForgeServer({
    env: {},
    registry: registryFixture(),
    allowLocal,
    runCreate,
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

test('the Mini App backend serves the page and the fleet state', async () => {
  const { server, base } = await startForge(async () => ({ ok: true, steps: [] }), { allowLocal: true });
  try {
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Bot forge/);
    const state = await (await fetch(`${base}/api/state`)).json();
    assert.deepEqual(state.bots, [
      { id: 'vm', name: 'VM Bot', enabled: true, tokenEnv: 'VM_BOT_TOKEN', runtime: 'bot-host' },
      { id: 'vm2', name: 'VM2 Bot', enabled: true, tokenEnv: 'VM2_BOT_TOKEN', runtime: 'bot-host' },
    ]);
    assert.equal(state.master, 'vm');
    assert.equal(state.userbot.configured, false, 'no session on a dev box: the page must say so');
    assert.ok(state.userbot.hostCommands.length > 0, 'the operator must be told what to run');
  } finally {
    server.close();
  }
});

test('a loopback forge admits the operator and runs the one creation path', async () => {
  const looked = [];
  const { server, base } = await startForge(async (input, meta) => {
    looked.push({ input, meta });
    return { ok: true, bot: { id: 'vm3', name: input.name }, steps: [], hostCommands: [] };
  }, { allowLocal: true });
  try {
    const admitted = await fetch(`${base}/api/forge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'VM3 Bot' }),
    });
    assert.equal(admitted.status, 200);
    const body = await admitted.json();
    assert.equal(body.ok, true);
    assert.equal(body.bot.id, 'vm3');
    assert.equal(looked.length, 1);
    assert.equal(looked[0].meta.via, 'loopback');
  } finally {
    server.close();
  }
});

test('a forge that is not loopback-admitted refuses an unauthenticated create', async () => {
  const { server, base } = await startForge(async () => ({ ok: true, steps: [] }), { allowLocal: false });
  try {
    const denied = await fetch(`${base}/api/forge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'VM3 Bot' }),
    });
    assert.equal(denied.status, 401);
    const body = await denied.json();
    assert.equal(body.ok, false);
    assert.match(body.reason, /initData/);
  } finally {
    server.close();
  }
});

test('the page GET is public — it holds no secret and the create still needs a door', async () => {
  const { server, base } = await startForge(async () => ({ ok: true, steps: [] }), { allowLocal: false });
  try {
    assert.equal((await fetch(`${base}/`)).status, 200);
    assert.equal((await fetch(`${base}/api/nope`)).status, 404);
  } finally {
    server.close();
  }
});

// ------------------------------------------------------- the mounted forge
//
// The gateway does not publish the forge on its own port; it mounts this
// handler under /forge and keeps its own initData door. That means the handler
// must (a) use the prefix for BOTH the page and the API, and (b) yield every
// path that is not its own so the mounting server can answer it.

test('the page posts to the mounted prefix when the forge is mounted', () => {
  const html = forgePageHtml({ apiBase: '/forge/api' });
  assert.match(html, /\/forge\/api\/forge/);
  assert.match(html, /\/forge\/api\/state/);
  // the standalone page still posts to /api/* — the default is unchanged
  assert.match(forgePageHtml(), /\/api\/forge/);
});

async function startMountedForge(handler) {
  const server = http.createServer((req, res) => {
    handler(req, res)
      .then((handled) => {
        if (handled || res.headersSent) return;
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ mounted: false }));
      })
      .catch(() => {});
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

test('a mounted forge serves its own prefix and yields every other path', async () => {
  const handler = createForgeHandler({
    env: {},
    registry: registryFixture(),
    basePath: '/forge',
    allowLocal: false,
    requireStateAuth: true,
    authorize: () => ({ ok: true, via: 'initData:vm' }),
    runCreate: async (input, meta) => ({ ok: true, bot: { id: 'vm3', name: input.name }, via: meta.via, steps: [] }),
  });
  const { server, base } = await startMountedForge(handler);
  try {
    const page = await fetch(`${base}/forge`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /\/forge\/api\/forge/);

    const state = await (await fetch(`${base}/forge/api/state`)).json();
    assert.equal(state.ok, true);
    assert.deepEqual(state.bots.map((b) => b.id), ['vm', 'vm2']);

    const created = await fetch(`${base}/forge/api/forge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'VM3 Bot' }),
    });
    assert.equal(created.status, 200);
    assert.equal((await created.json()).via, 'initData:vm');

    // Not the forge's prefix: the mounting server owns /api, not the forge.
    assert.equal((await fetch(`${base}/api/state`)).status, 404);
    assert.equal((await fetch(`${base}/nope`)).status, 404);
  } finally {
    server.close();
  }
});

test('a mounted forge keeps the injected door: a refusal is a refusal', async () => {
  const handler = createForgeHandler({
    env: {},
    registry: registryFixture(),
    basePath: '/forge',
    authorize: () => ({ ok: false, status: 401, reason: 'no initData — open the forge from the /forge button in Telegram' }),
    runCreate: async () => ({ ok: true, steps: [] }),
  });
  const { server, base } = await startMountedForge(handler);
  try {
    const denied = await fetch(`${base}/forge/api/forge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'VM3 Bot' }),
    });
    assert.equal(denied.status, 401);
    assert.match((await denied.json()).reason, /initData/);

    // The mounted prefix still owns its state route when requireStateAuth is
    // off (the standalone server's posture) — the door is the caller's choice.
    assert.equal((await fetch(`${base}/forge/api/state`)).status, 200);
  } finally {
    server.close();
  }
});

test('a mounted forge refuses an unauthenticated state read when the door asks', async () => {
  const handler = createForgeHandler({
    env: {},
    registry: registryFixture(),
    basePath: '/forge',
    requireStateAuth: true,
    authorize: () => ({ ok: false, status: 401, reason: 'no initData' }),
    runCreate: async () => ({ ok: true, steps: [] }),
  });
  const { server, base } = await startMountedForge(handler);
  try {
    assert.equal((await fetch(`${base}/forge/api/state`)).status, 401);
  } finally {
    server.close();
  }
});

// --------------------------------------------------- END TO END (real run)

test('END TO END: the paste path creates a real bot against a scratch tree', async () => {
  const dir = scratch();
  const registryPath = path.join(dir, 'registry.json');
  const tokensPath = path.join(dir, 'tokens.env');
  const configDir = path.join(dir, 'config');
  const unitDir = path.join(dir, 'units');
  const hostRoot = path.join(dir, 'bot-host');
  fs.writeFileSync(registryPath, JSON.stringify(registryFixture(), null, 2));
  fs.writeFileSync(tokensPath, 'VM_BOT_TOKEN=123456789:master-token-not-real-000000000000\n');

  const api = await startFakeTelegram();
  try {
    const run = await runCliAsync([
      '--create',
      '--name=VM3 Bot',
      `--token=${TOKEN}`,
      `--registry=${registryPath}`,
      `--tokens=${tokensPath}`,
      `--config-dir=${configDir}`,
      `--unit-dir=${unitDir}`,
      `--bot-host-root=${hostRoot}`,
      `--api-base=http://127.0.0.1:${api.port}`,
      '--no-start',
      '--json',
    ]);

    assert.equal(run.status, 0, `forge failed: ${run.stdout}\n${run.stderr}`);
    assert.equal(run.json.ok, true, JSON.stringify(run.json, null, 2));
    assert.equal(run.json.summary.ok, true);
    assert.deepEqual(run.json.summary.remaining, [], 'every step should have run');

    // 1. the registry row is thin and enabled only after publish
    const row = JSON.parse(fs.readFileSync(registryPath, 'utf8')).bots.find((b) => b.id === 'vm3');
    assert.ok(row, 'no vm3 row was written');
    assert.equal(row.extends, 'vm');
    assert.equal(row.enabled, true, 'publish succeeded, so the bot should be enabled');
    assert.deepEqual(Object.keys(row.agent), ['playwrightOutputDir'], 'the row must not restate the inherited block');
    assert.equal(row.telegram.tokenEnv, 'VM3_BOT_TOKEN');
    assert.equal(row.agent.playwrightOutputDir, '/tmp/bot-host-shots-vm3');

    // 2. the row still satisfies the clone contract, on the scratch registry
    const gate = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'assert-bot-clone.mjs'), `--registry=${registryPath}`], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(gate.status, 0, `assert-bot-clone failed: ${gate.stdout}`);

    // 3. the master token line, mode 600
    assert.equal(readMasterTokens(tokensPath).VM3_BOT_TOKEN, TOKEN);
    assert.equal(readMasterTokens(tokensPath).VM_BOT_TOKEN, '123456789:master-token-not-real-000000000000');
    assert.equal(fs.statSync(tokensPath).mode & 0o777, 0o600);

    // 4. sync wrote the runtime env file the unit reads
    const envFile = path.join(configDir, 'vm3.env');
    assert.equal(fs.readFileSync(envFile, 'utf8').trim(), `VM3_BOT_TOKEN=${TOKEN}`);
    assert.equal(fs.statSync(envFile).mode & 0o777, 0o600);

    // 5. supervision: the unit exists, points at the local root, and its
    //    EnvironmentFile resolves to the file sync just wrote
    const unit = fs.readFileSync(path.join(unitDir, 'bot-host@.service'), 'utf8');
    assert.match(unit, /WantedBy=default\.target/);
    assert.match(unit, new RegExp(`WorkingDirectory=${hostRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.match(unit, /bot-host\.mjs --id=%i/);
    assert.ok(unit.includes(`EnvironmentFile=-${configDir}/%i.env`), unit);
    assert.ok(fs.existsSync(path.join(configDir, 'vm3.env')), 'the unit would read a file that does not exist');

    // 6. publish really called Telegram, with the fleet's own command list
    const methods = api.calls.map((c) => c.method);
    assert.deepEqual(methods, ['getMe', 'setMyCommands']);
    assert.equal(api.calls[0].token, TOKEN);
    assert.deepEqual(api.calls[1].payload.commands, toTelegramCommands());

    // 7. the receipt names what only the operator can still do
    assert.ok(run.json.steps.some((s) => s.id === 'enable' && s.status === 'done'));
    assert.ok(run.json.hostCommands.some((c) => /systemctl --user enable --now bot-host@vm3/.test(c)), JSON.stringify(run.json.hostCommands));
  } finally {
    api.server.close();
  }
});

test('END TO END: a duplicate token is refused and writes nothing', async () => {
  const dir = scratch();
  const registryPath = path.join(dir, 'registry.json');
  const tokensPath = path.join(dir, 'tokens.env');
  fs.writeFileSync(registryPath, JSON.stringify(registryFixture(), null, 2));
  fs.writeFileSync(tokensPath, `VM_BOT_TOKEN=${TOKEN}\n`);

  const run = runCli([
    '--create', '--name=VM4 Bot', `--token=${TOKEN}`,
    `--registry=${registryPath}`, `--tokens=${tokensPath}`,
    `--config-dir=${path.join(dir, 'config')}`, `--unit-dir=${path.join(dir, 'units')}`,
    `--bot-host-root=${path.join(dir, 'host')}`, '--no-start', '--json',
  ]);
  assert.equal(run.status, 1);
  assert.match(run.json.reason, /already the value of VM_BOT_TOKEN|one token is one poller/);
  const bots = JSON.parse(fs.readFileSync(registryPath, 'utf8')).bots.map((b) => b.id);
  assert.deepEqual(bots, ['vm', 'vm2'], 'a refused run must not touch the registry');
  assert.equal(readMasterTokens(tokensPath).VM4_BOT_TOKEN, undefined);
});

test('END TO END: a bad name is refused before anything is written', () => {
  const dir = scratch();
  const registryPath = path.join(dir, 'registry.json');
  fs.writeFileSync(registryPath, JSON.stringify(registryFixture(), null, 2));
  const run = runCli([
    '--create', '--name=!!!', `--token=${TOKEN}`,
    `--registry=${registryPath}`, `--tokens=${path.join(dir, 'tokens.env')}`,
    `--config-dir=${path.join(dir, 'config')}`, `--unit-dir=${path.join(dir, 'units')}`,
    `--bot-host-root=${path.join(dir, 'host')}`, '--no-start', '--json',
  ]);
  assert.equal(run.status, 1);
  assert.match(run.json.reason, /letter or digit|usable id/);
  assert.equal(run.json.failedStep, 'plan');
  assert.deepEqual(JSON.parse(fs.readFileSync(registryPath, 'utf8')).bots.map((b) => b.id), ['vm', 'vm2']);
});

test('END TO END: the userbot path refuses cleanly when unconfigured', () => {
  const dir = scratch();
  const registryPath = path.join(dir, 'registry.json');
  fs.writeFileSync(registryPath, JSON.stringify(registryFixture(), null, 2));
  // No --token: the forge must try the userbot, and this box has no session.
  const run = runCli([
    '--create', '--name=VM5 Bot',
    `--registry=${registryPath}`, `--tokens=${path.join(dir, 'tokens.env')}`,
    `--config-dir=${path.join(dir, 'config')}`, `--unit-dir=${path.join(dir, 'units')}`,
    `--bot-host-root=${path.join(dir, 'host')}`, '--no-start', '--json',
  ]);
  assert.equal(run.status, 1);
  assert.equal(run.json.failedStep, 'token');
  assert.match(run.json.reason, /teleproto|session|TELEGRAM_API_ID/);
  assert.ok(run.json.hostCommands.some((c) => /teleproto|userbot-login/.test(c)), 'the operator must be told what to run');
  assert.deepEqual(JSON.parse(fs.readFileSync(registryPath, 'utf8')).bots.map((b) => b.id), ['vm', 'vm2']);
});

test('END TO END: an unreachable Telegram stops at publish and does NOT enable the bot', () => {
  const dir = scratch();
  const registryPath = path.join(dir, 'registry.json');
  fs.writeFileSync(registryPath, JSON.stringify(registryFixture(), null, 2));
  const run = runCli([
    '--create', '--name=VM6 Bot', `--token=${TOKEN}`,
    `--registry=${registryPath}`, `--tokens=${path.join(dir, 'tokens.env')}`,
    `--config-dir=${path.join(dir, 'config')}`, `--unit-dir=${path.join(dir, 'units')}`,
    `--bot-host-root=${path.join(dir, 'host')}`,
    // Port 1 is reserved and closed: a real network failure, not a stub.
    '--api-base=http://127.0.0.1:1', '--no-start', '--json',
  ]);
  assert.equal(run.status, 1);
  assert.equal(run.json.failedStep, 'publish');
  assert.match(run.json.reason, /unreachable|timed out/);
  const row = JSON.parse(fs.readFileSync(registryPath, 'utf8')).bots.find((b) => b.id === 'vm6');
  assert.ok(row, 'the row should exist — the earlier steps really ran');
  assert.equal(row.enabled, false, 'a bot whose token never answered must not be enabled');
  assert.deepEqual(run.json.summary.remaining, ['publish', 'enable']);
});

test('END TO END: attach finishes a registered row that has no token', async () => {
  const dir = scratch();
  const registryPath = path.join(dir, 'registry.json');
  const tokensPath = path.join(dir, 'tokens.env');
  const registry = registryFixture();
  registry.bots.push({ id: 'pm', name: 'PM Bot', runtime: 'bot-host', enabled: false, extends: 'vm', telegram: { tokenEnv: 'PM_BOT_TOKEN' } });
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
  fs.writeFileSync(tokensPath, 'VM_BOT_TOKEN=123456789:master-token-not-real-000000000000\n');

  const api = await startFakeTelegram();
  try {
    const run = await runCliAsync([
      '--attach=pm',
      `--token=${TOKEN}`,
      `--registry=${registryPath}`,
      `--tokens=${tokensPath}`,
      `--config-dir=${path.join(dir, 'config')}`,
      `--unit-dir=${path.join(dir, 'units')}`,
      `--bot-host-root=${path.join(dir, 'host')}`,
      `--api-base=http://127.0.0.1:${api.port}`,
      '--no-start',
      '--json',
    ]);

    assert.equal(run.status, 0, `attach failed: ${run.stdout}\n${run.stderr}`);
    assert.equal(run.json.ok, true, JSON.stringify(run.json, null, 2));
    assert.equal(run.json.summary.ok, true);
    assert.deepEqual(run.json.summary.remaining, [], 'every step should have run — attach is the same pipeline');
    assert.equal(run.json.bot.attached, true);
    assert.equal(run.json.bot.name, 'PM Bot');
    assert.equal(run.json.bot.telegramBotId, '123456789');

    // The whole point: the only change to the row is the enable flip at the end.
    // Anything else means attach rewrote a row it was supposed to leave alone.
    const expected = structuredClone(registry);
    expected.bots.find((b) => b.id === 'pm').enabled = true;
    assert.deepEqual(
      JSON.parse(fs.readFileSync(registryPath, 'utf8')),
      expected,
      'attach must not rewrite the row it attached a token to',
    );

    // And the token really reached every surface the row needs.
    assert.equal(readMasterTokens(tokensPath).PM_BOT_TOKEN, TOKEN);
    assert.equal(readMasterTokens(tokensPath).VM_BOT_TOKEN, '123456789:master-token-not-real-000000000000');
    assert.equal(fs.readFileSync(path.join(dir, 'config', 'pm.env'), 'utf8').trim(), `PM_BOT_TOKEN=${TOKEN}`);
    assert.deepEqual(api.calls.map((c) => c.method), ['getMe', 'setMyCommands']);
    assert.ok(run.json.steps.some((s) => s.id === 'registry' && /kept as it is/.test(s.detail)), 'the receipt must say the row was kept');
  } finally {
    api.server.close();
  }
});

test('END TO END: attach on an id nobody registered writes nothing', () => {
  const dir = scratch();
  const registryPath = path.join(dir, 'registry.json');
  fs.writeFileSync(registryPath, JSON.stringify(registryFixture(), null, 2));
  const before = fs.readFileSync(registryPath, 'utf8');

  const run = runCli([
    '--attach=vm9', `--token=${TOKEN}`,
    `--registry=${registryPath}`, `--tokens=${path.join(dir, 'tokens.env')}`,
    `--config-dir=${path.join(dir, 'config')}`, `--unit-dir=${path.join(dir, 'units')}`,
    '--bot-host-root=/tmp/host', '--no-start', '--json',
  ]);
  assert.equal(run.status, 1);
  assert.equal(run.json.failedStep, 'plan');
  assert.match(run.json.reason, /not in the registry/);
  assert.equal(fs.readFileSync(registryPath, 'utf8'), before);
  assert.equal(fs.existsSync(path.join(dir, 'tokens.env')), false);
});

test('a dry run plans without writing', () => {
  const dir = scratch();
  const registryPath = path.join(dir, 'registry.json');
  fs.writeFileSync(registryPath, JSON.stringify(registryFixture(), null, 2));
  const before = fs.readFileSync(registryPath, 'utf8');
  const run = runCli([
    '--create', '--name=VM7 Bot', `--token=${TOKEN}`,
    `--registry=${registryPath}`, `--tokens=${path.join(dir, 'tokens.env')}`,
    `--config-dir=${path.join(dir, 'config')}`, `--unit-dir=${path.join(dir, 'units')}`,
    '--bot-host-root=/tmp/host', '--dry-run', '--json',
  ]);
  assert.equal(run.status, 0);
  assert.equal(run.json.dryRun, true);
  assert.equal(fs.readFileSync(registryPath, 'utf8'), before);
  assert.equal(fs.existsSync(path.join(dir, 'tokens.env')), false);

  // The attach variant plans just as harmlessly.
  const attachRun = runCli([
    '--attach=vm2', `--token=${OTHER_TOKEN}`,
    `--registry=${registryPath}`, `--tokens=${path.join(dir, 'tokens.env')}`,
    `--config-dir=${path.join(dir, 'config')}`, `--unit-dir=${path.join(dir, 'units')}`,
    '--bot-host-root=/tmp/host', '--dry-run', '--json',
  ]);
  assert.equal(attachRun.status, 0, attachRun.stdout);
  assert.equal(attachRun.json.dryRun, true);
  assert.equal(attachRun.json.bot.attached, true);
  assert.equal(attachRun.json.bot.tokenEnv, 'VM2_BOT_TOKEN');
  assert.equal(fs.readFileSync(registryPath, 'utf8'), before);
  assert.equal(fs.existsSync(path.join(dir, 'tokens.env')), false);
});

test('the step list and the summary agree on what a run did', () => {
  const steps = [
    { id: 'plan', title: 'p', status: 'done' },
    { id: 'token', title: 't', status: 'done' },
    { id: 'registry', title: 'r', status: 'failed', detail: 'nope' },
  ];
  const summary = summarizeRun(steps);
  assert.equal(summary.ok, false);
  assert.deepEqual(summary.completed, ['plan', 'token']);
  assert.deepEqual(summary.failed, [{ id: 'registry', reason: 'nope' }]);
  assert.ok(summary.remaining.includes('enable'));
  assert.equal(tokenEnvFor('vm3'), 'VM3_BOT_TOKEN');
});
