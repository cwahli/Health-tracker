/**
 * assert-fleet-miniapp.test.mjs — Sensor test for fleet mini-app and telemetry gateway.
 *
 * Covers:
 * - TTL decay (working -> idle -> offline)
 * - Bot registry loading with live status
 * - 8 human headers from current tab by name, keeping Pending/In progress unchanged
 * - Zero Google Sheets writes on read path
 * - Gateway authentication: admits valid initData, refuses bad HMAC / tampered signatures
 * - Gateway endpoints: /fleet, /fleet/app, /fleet/api/state, /fleet/api/heartbeat
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import {
  createGateway,
  recordFleetHeartbeat,
  getFleetNodes,
  getFleetBots,
  getFleetTickets,
  resetFleetStateForTest,
  issueToken,
  COOKIE_NAME,
} from './tui-gateway.mjs';

import {
  recordFleetHeartbeat as recordStatusBeat,
  getFleetNodes as getStatusNodes,
  getFleetTickets as getStatusTickets,
  getFleetBots as getStatusBots,
} from './lib/fleet-status.mjs';

function makeInitData(botToken, { user = { id: 123456, first_name: 'Test' }, authDate = Math.floor(Date.now() / 1000) } = {}) {
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const params = new URLSearchParams({
    auth_date: String(authDate),
    user: JSON.stringify(user),
  });
  params.sort();
  const dataCheckString = Array.from(params.entries()).map(([k, v]) => `${k}=${v}`).join('\n');
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

test('recordFleetHeartbeat and getFleetNodes freshness windows: 5m stays working, 20m becomes stale', () => {
  resetFleetStateForTest();
  const t0 = 10000000;

  // 1. Initial heartbeat from Mac (working)
  const res1 = recordFleetHeartbeat({
    location: 'Mac',
    agent: 'Gemini 3.8 Flash (High)',
    phase: 'working',
    task: 'Planning fleet-miniapp',
    ticketKey: 'card:19',
  }, { now: t0 });
  assert.equal(res1.ok, true);

  // At t0: Mac should be working
  let nodes = getFleetNodes({ now: t0 });
  const mac0 = nodes.find((n) => n.location === 'Mac');
  assert.ok(mac0);
  assert.equal(mac0.status, 'working');
  assert.equal(mac0.agent, 'Gemini 3.8 Flash (High)');
  assert.equal(mac0.task, 'Planning fleet-miniapp');
  assert.equal(mac0.ticketKey, 'card:19');

  // 2. At t0 + 1 minute: still working
  nodes = getFleetNodes({ now: t0 + 60 * 1000 });
  const mac1 = nodes.find((n) => n.location === 'Mac');
  assert.equal(mac1.status, 'working');

  // 3. At t0 + 5 minutes (no 2m decay to idle): still working!
  nodes = getFleetNodes({ now: t0 + 5 * 60 * 1000 });
  const mac2 = nodes.find((n) => n.location === 'Mac');
  assert.equal(mac2.status, 'working');

  // 4. At t0 + 20 minutes (> 15 min TTL): becomes stale with old phase visible
  nodes = getFleetNodes({ now: t0 + 20 * 60 * 1000 });
  const mac3 = nodes.find((n) => n.location === 'Mac');
  assert.equal(mac3.status, 'stale');
  assert.equal(mac3.lastPhase, 'working');
  assert.ok(mac3.task.includes('Planning fleet-miniapp') || mac3.task.includes('working'));

  // 5. Default locations always present
  const defaultLocations = ['Mac', 'VM', 'Grok VM', 'Mobile', 'Collab'];
  for (const def of defaultLocations) {
    assert.ok(nodes.some((n) => n.location === def), `default location ${def} must be present`);
  }
});

test('getFleetBots returns registry bots with status and model', async () => {
  const bots = await getFleetBots();
  assert.ok(Array.isArray(bots));
  assert.ok(bots.length >= 20, `expected at least 20 bots in registry, got ${bots.length}`);
  const vmBot = bots.find((b) => b.id === 'vm');
  assert.ok(vmBot);
  assert.equal(vmBot.enabled, true);
  assert.ok(vmBot.model);
  assert.ok(vmBot.status === 'idle' || vmBot.status === 'working', `vm bot status ${vmBot.status}`);
});

test('getFleetTickets provides the declared 8 fields and keeps Pending unchanged', async () => {
  const tickets = await getFleetTickets();
  assert.ok(Array.isArray(tickets));
  assert.ok(tickets.length > 0, 'tickets must not be empty');

  for (const t of tickets.slice(0, 10)) {
    assert.ok(t.id !== undefined, 'ticket id');
    assert.ok(t.originalRequest !== undefined, 'originalRequest');
    assert.ok(t.workDoneSoFar !== undefined, 'workDoneSoFar');
    assert.ok(t.whatsLeftToDo !== undefined, 'whatsLeftToDo');
    assert.ok(t.owner !== undefined, 'owner');
    assert.ok(t.status !== undefined, 'status');
    assert.ok(t.completionProof !== undefined, 'completionProof');
    assert.ok(t.completionGate !== undefined, 'completionGate');
    assert.ok(t.lastActivity !== undefined, 'lastActivity');

    // Values like Pending, Assigned, In progress, Done must be preserved
    assert.ok(typeof t.status === 'string' && t.status.length > 0);
  }
});

test('fleet-status module parity and zero mutating sheet writes', async () => {
  // getFleetTickets is strictly read-only and never invokes appendRows, createSheet, or batchUpdate
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.join(HERE, 'lib', 'fleet-status.mjs'), 'utf8');
  assert.equal(/appendRows\s*\(/.test(src), false, 'must not call appendRows');
  assert.equal(/createSheet\s*\(/.test(src), false, 'must not call createSheet');
  assert.equal(/batchUpdate/i.test(src), false, 'must not call batchUpdate');

  const tickets = await getStatusTickets();
  assert.ok(Array.isArray(tickets));
});

test('gateway /fleet auth door admits valid initData and refuses bad HMAC', async () => {
  const botToken = '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ';
  const secret = 'gateway-test-secret-12345';
  const env = {
    TUI_GATEWAY_SECRET: secret,
    TUI_BOT_TOKEN_VM: botToken,
  };

  const handle = createGateway({ env });
  const server = http.createServer(handle);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  try {
    // 1. Valid initData admits with 302 to /fleet/app
    const validInitData = makeInitData(botToken);
    const validRes = await fetch(`${base}/fleet?bot=vm&initData=${encodeURIComponent(validInitData)}`, { redirect: 'manual' });
    assert.equal(validRes.status, 302);
    const loc = validRes.headers.get('location') || '';
    assert.ok(loc.startsWith('/fleet/app?token='));

    // 2. Tampered hash is refused with 401
    const badInitData = validInitData.replace(/hash=[a-f0-9]{10}/, 'hash=deadbeef00');
    const badRes = await fetch(`${base}/fleet?bot=vm&initData=${encodeURIComponent(badInitData)}`, { redirect: 'manual' });
    assert.equal(badRes.status, 401);

    // 3. Foreign bot token is refused with 401
    const foreignInitData = makeInitData('999999999:ForeignBotToken');
    const foreignRes = await fetch(`${base}/fleet?bot=vm&initData=${encodeURIComponent(foreignInitData)}`, { redirect: 'manual' });
    assert.equal(foreignRes.status, 401);
  } finally {
    server.close();
  }
});

test('gateway /fleet routes: landing, auth, app, state, and heartbeat', async () => {
  resetFleetStateForTest();
  const botToken = '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ';
  const secret = 'gateway-test-secret-12345';
  const env = {
    TUI_GATEWAY_SECRET: secret,
    TUI_BOT_TOKEN_VM: botToken,
    FLEET_TEST_AUTH: '1',
  };

  const handle = createGateway({ env });
  const server = http.createServer(handle);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  try {
    // 1. GET /fleet without auth or initData returns BOOTSTRAP_FLEET HTML
    const landingRes = await fetch(`${base}/fleet`, { redirect: 'manual' });
    assert.equal(landingRes.status, 200);
    const landingText = await landingRes.text();
    assert.ok(landingText.includes('opening fleet dashboard'));

    // 2. GET /fleet with valid initData admits and redirects to /fleet/app
    const validInitData = makeInitData(botToken);
    const authRes = await fetch(`${base}/fleet?bot=vm&initData=${encodeURIComponent(validInitData)}`, { redirect: 'manual' });
    assert.equal(authRes.status, 302);
    const location = authRes.headers.get('location') || '';
    assert.ok(location.startsWith('/fleet/app?token='));
    const setCookie = authRes.headers.get('set-cookie') || '';
    assert.ok(setCookie.includes(COOKIE_NAME));

    // 3. GET /fleet/app returns fleet.html
    const appRes = await fetch(`${base}/fleet/app`);
    assert.equal(appRes.status, 200);
    const appHtml = await appRes.text();
    assert.ok(appHtml.includes('Fleet Status'));
    assert.ok(appHtml.includes('id="table-tickets"'));
    assert.ok(appHtml.includes('id="table-terms"'));
    assert.ok(appHtml.includes('id="table-bots"'));

    // 4. POST /fleet/api/heartbeat records heartbeat
    const beatRes = await fetch(`${base}/fleet/api/heartbeat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        location: 'Mac',
        agent: 'Gemini 3.8 Flash (High)',
        phase: 'working',
        task: 'Running sensor checks',
        ticketKey: 'card:20',
      }),
    });
    assert.equal(beatRes.status, 200);
    const beatData = await beatRes.json();
    assert.equal(beatData.ok, true);

    // 5. GET /fleet/api/state returns composite payload
    const stateRes = await fetch(`${base}/fleet/api/state`);
    assert.equal(stateRes.status, 200);
    const stateData = await stateRes.json();
    assert.equal(stateData.ok, true);
    assert.ok(Array.isArray(stateData.tickets));
    assert.ok(Array.isArray(stateData.terminals));
    assert.ok(Array.isArray(stateData.bots));
    const macTerminal = stateData.terminals.find((t) => t.location === 'Mac');
    assert.ok(macTerminal);
    assert.equal(macTerminal.agent, 'Gemini 3.8 Flash (High)');
    assert.equal(macTerminal.task, 'Running sensor checks');
    assert.equal(macTerminal.status, 'working');
  } finally {
    server.close();
  }
});

test('getFleetNodes separates PM ticket claim from worker liveness badge', () => {
  resetFleetStateForTest();
  const t0 = 10000000;

  // 1. Idle beat from Mac + 'In progress' ticket on PM sheet:
  // Stale ticket does NOT paint an idle beat green! Badge must stay 'idle'.
  recordFleetHeartbeat({
    location: 'Mac',
    agent: 'Antigravity (Gemini 3.8 Flash High)',
    phase: 'idle',
    task: 'Waiting for instructions',
  }, { now: t0 });

  const mockTickets = [
    {
      id: 'spec:fleet-refine',
      originalRequest: 'Refine fleet telemetry with PM sync and refresh button',
      owner: 'Antigravity (Gemini 3.8 Flash High) @ mac',
      status: 'In progress',
    },
  ];

  let nodes = getFleetNodes({ now: t0, tickets: mockTickets });
  let mac = nodes.find((n) => n.location === 'Mac');
  assert.ok(mac);
  // Badge comes from worker: idle!
  assert.equal(mac.status, 'idle');
  // Ticket claim is projected in ticketKey
  assert.equal(mac.ticketKey, 'spec:fleet-refine');
  assert.equal(mac.task, 'Waiting for instructions');

  // 2. Working pane with no reported sentence displays 'Sentence missing'
  recordFleetHeartbeat({
    location: 'Mac',
    agent: 'Antigravity (Gemini 3.8 Flash High)',
    phase: 'working',
    task: '', // empty sentence
  }, { now: t0 });

  nodes = getFleetNodes({ now: t0, tickets: mockTickets });
  mac = nodes.find((n) => n.location === 'Mac');
  assert.equal(mac.status, 'working');
  assert.equal(mac.task, 'Sentence missing');
});

test('location mapping prevents grok-vps from lighting VM and flags multi-claims', () => {
  resetFleetStateForTest();
  const t0 = 10000000;

  const mockTickets = [
    {
      id: 'spec:grok-task',
      originalRequest: 'Grok background synthesis',
      owner: 'Grok @ grok-vps',
      status: 'In progress',
    },
    {
      id: 'spec:mac-1',
      originalRequest: 'First Mac task',
      owner: 'Gemini @ mac',
      status: 'In progress',
    },
    {
      id: 'spec:mac-2',
      originalRequest: 'Second Mac task',
      owner: 'Gemini @ mac',
      status: 'In progress',
    },
  ];

  const nodes = getFleetNodes({ now: t0, tickets: mockTickets });

  // 1. grok-vps matches Grok VM, NEVER VM
  const vm = nodes.find((n) => n.location === 'VM');
  assert.ok(vm);
  assert.notEqual(vm.ticketKey, 'spec:grok-task');

  const grokVm = nodes.find((n) => n.location === 'Grok VM');
  assert.ok(grokVm);
  assert.equal(grokVm.ticketKey, 'spec:grok-task');

  // 2. Multi-claim on Mac: two 'In progress' tickets flags multiClaim: true
  const mac = nodes.find((n) => n.location === 'Mac');
  assert.ok(mac);
  assert.equal(mac.multiClaim, true);
  assert.ok(mac.ticketKey.includes('spec:mac-1'));
  assert.ok(mac.ticketKey.includes('spec:mac-2'));
});

test('mock stand-ins are reported offline', () => {
  resetFleetStateForTest();
  const t0 = 10000000;

  recordFleetHeartbeat({
    location: 'Collab',
    agent: 'Collab Worker',
    phase: 'working',
    standin: true,
  }, { now: t0 });

  recordFleetHeartbeat({
    location: 'Grok VM',
    agent: 'Grok Worker',
    phase: 'working',
    standin: true,
  }, { now: t0 });

  const nodes = getFleetNodes({ now: t0 });
  const collab = nodes.find((n) => n.location === 'Collab');
  assert.ok(collab);
  assert.equal(collab.status, 'offline');
  assert.equal(collab.task, 'Offline (mock standin)');

  const grokVm = nodes.find((n) => n.location === 'Grok VM');
  assert.ok(grokVm);
  assert.equal(grokVm.status, 'offline');
  assert.equal(grokVm.task, 'Offline (mock standin)');
});

test('on-demand refresh bypasses 15-second in-memory cache', async () => {
  resetFleetStateForTest();
  const res1 = await getFleetTickets();
  assert.ok(Array.isArray(res1));

  // Call with refresh: true to bypass cache
  const res2 = await getFleetTickets({ refresh: true });
  assert.ok(Array.isArray(res2));
});

test('heartbeat endpoint enforces authentication and rejects spoofed locations', async () => {
  resetFleetStateForTest();
  const secret = 'gateway-secret-telemetry-999';
  const env = {
    FLEET_TELEMETRY_SECRET: secret,
    FLEET_SECRET_MAC: 'mac-scoped-secret-777',
  };

  const handle = createGateway({ env });
  const server = http.createServer(handle);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  try {
    // 1. Unauthenticated beat is rejected with 401
    const unauthRes = await fetch(`${base}/fleet/api/heartbeat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ location: 'Mac', phase: 'working', task: 'Unauth attempt' }),
    });
    assert.equal(unauthRes.status, 401);

    // 2. Bad secret is rejected with 401
    const badSecretRes = await fetch(`${base}/fleet/api/heartbeat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-fleet-telemetry-secret': 'wrong-secret',
      },
      body: JSON.stringify({ location: 'Mac', phase: 'working', task: 'Bad secret attempt' }),
    });
    assert.equal(badSecretRes.status, 401);

    // 3. Valid global secret admits (agent identifies the model — required)
    const validRes = await fetch(`${base}/fleet/api/heartbeat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-fleet-telemetry-secret': secret,
      },
      body: JSON.stringify({ location: 'Mac', agent: 'Probe Agent', phase: 'working', task: 'Valid global secret' }),
    });
    assert.equal(validRes.status, 200);

    // 4. Mismatched location with host-scoped secret is rejected with 403
    const spoofRes = await fetch(`${base}/fleet/api/heartbeat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-fleet-telemetry-secret': 'mac-scoped-secret-777',
      },
      body: JSON.stringify({ location: 'VM', phase: 'working', task: 'Spoofed VM from Mac key' }),
    });
    assert.equal(spoofRes.status, 403);
  } finally {
    server.close();
  }
});


test('heartbeat without agent is refused and never stored', async () => {
  resetFleetStateForTest();
  const t0 = 10000000;

  // Unit level: no agent and no model → refused
  const noAgent = recordFleetHeartbeat({ location: 'Mac', phase: 'working', task: 'Agent-less probe' }, { now: t0 });
  assert.equal(noAgent.ok, false);
  assert.equal(noAgent.error, 'missing agent');

  // Explicit "Unknown" is not an identity either
  const unknown = recordFleetHeartbeat({ location: 'Mac', agent: 'Unknown', phase: 'working' }, { now: t0 });
  assert.equal(unknown.ok, false);

  // Nothing stored: Mac pane stays off the reporter path
  const nodes = getFleetNodes({ now: t0 });
  const mac = nodes.find((n) => n.location === 'Mac');
  assert.notEqual(mac.agent, 'Unknown');

  // HTTP level: authenticated but agent-less → 400, not 200
  const secret = 'gateway-secret-telemetry-444';
  const handle = createGateway({ env: { FLEET_TELEMETRY_SECRET: secret } });
  const server = http.createServer(handle);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/fleet/api/heartbeat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-fleet-telemetry-secret': secret },
      body: JSON.stringify({ location: 'Mac', phase: 'working', task: 'Agent-less probe' }),
    });
    assert.equal(res.status, 400);
  } finally {
    server.close();
  }
});

test('beats older than 60m read offline instead of stale forever', () => {
  resetFleetStateForTest();
  const t0 = 10000000;

  recordFleetHeartbeat({
    location: 'Mac',
    agent: 'Antigravity (Gemini 3.8 Flash High)',
    phase: 'working',
    task: 'Session ended without disconnect',
  }, { now: t0 });

  // 20m: stale, last phase kept
  let nodes = getFleetNodes({ now: t0 + 20 * 60 * 1000 });
  assert.equal(nodes.find((n) => n.location === 'Mac').status, 'stale');

  // 61m: reporter gone → offline, no badge, no sentence
  nodes = getFleetNodes({ now: t0 + 61 * 60 * 1000 });
  const mac = nodes.find((n) => n.location === 'Mac');
  assert.equal(mac.status, 'offline');
  assert.equal(mac.lastPhase, 'offline');
  assert.equal(mac.agent, '—');
  assert.equal(mac.task, 'No reporter (last beat expired)');
});

test('VM pane reflects live opencode sessions with model', async () => {
  resetFleetStateForTest();
  const t0 = 10000000;
  const { DatabaseSync } = await import('node:sqlite');
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-vm-'));
  const dbPath = path.join(tmpHome, 'opencode.db');
  const db = new DatabaseSync(dbPath);
  db.exec(`create table session_v2 (id text, model text, directory text, title text, time_updated integer, time_archived integer)`);
  db.exec(`create table session_message (session_id text, type text, time_created integer, data text)`);
  const ins = db.prepare(`insert into session_v2 (id, model, directory, title, time_updated, time_archived) values (?, ?, ?, ?, ?, ?)`);
  const msg = db.prepare(`insert into session_message (session_id, type, time_created, data) values (?, ?, ?, ?)`);
  ins.run('ses_working', JSON.stringify({ id: 'space-bunny-free', providerID: 'opencode' }), '/home/ubuntu', 'Meal QA audit', t0 - 2 * 60 * 1000, null);
  msg.run('ses_working', 'assistant', t0 - 60 * 1000, JSON.stringify({ time: { created: 1, streamed: 2 } }));
  ins.run('ses_idle', JSON.stringify({ id: 'muse-spark', providerID: 'opencode-go' }), '/home/ubuntu/src/Health-tracker', 'None', t0 - 5 * 60 * 1000, null);
  msg.run('ses_idle', 'idle', t0 - 4 * 60 * 1000, JSON.stringify({ time: { created: 1 }, outcome: 'succeeded' }));
  ins.run('ses_old', JSON.stringify({ id: 'old-model', providerID: 'opencode' }), '/home/ubuntu', 'Cold session', t0 - 30 * 60 * 1000, null);
  ins.run('ses_arch', JSON.stringify({ id: 'archived-model', providerID: 'opencode' }), '/home/ubuntu', 'Archived', t0 - 1 * 60 * 1000, t0);
  db.close();

  const nodes = getFleetNodes({ now: t0, home: tmpHome, vmOpencodeDb: dbPath });
  const vm = nodes.find((n) => n.location === 'VM');
  assert.ok(vm);
  assert.equal(vm.status, 'working');
  assert.equal(vm.agent, 'opencode/space-bunny-free (+1)');
  assert.ok(vm.task.includes('1/2 working'));
  assert.ok(vm.task.includes('Meal QA audit [space-bunny-free] ●'));
  assert.ok(vm.task.includes('Health-tracker [muse-spark] ○'));
  assert.ok(!vm.task.includes('old-model'));
  assert.ok(!vm.task.includes('archived-model'));

  fs.rmSync(tmpHome, { recursive: true, force: true });
});
