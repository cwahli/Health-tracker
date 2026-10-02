/**
 * assert-fleet-miniapp.test.mjs — Sensor test for fleet mini-app and telemetry gateway.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';

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

test('recordFleetHeartbeat and getFleetNodes TTL decay', () => {
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

  // 3. At t0 + 3 minutes (> 2 min TTL): decays to idle
  nodes = getFleetNodes({ now: t0 + 3 * 60 * 1000 });
  const mac2 = nodes.find((n) => n.location === 'Mac');
  assert.equal(mac2.status, 'idle');

  // 4. At t0 + 11 minutes (> 10 min TTL): decays to offline
  nodes = getFleetNodes({ now: t0 + 11 * 60 * 1000 });
  const mac3 = nodes.find((n) => n.location === 'Mac');
  assert.equal(mac3.status, 'offline');

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
});

test('getFleetTickets provides the declared 8 fields', async () => {
  const tickets = await getFleetTickets();
  assert.ok(Array.isArray(tickets));
  for (const t of tickets.slice(0, 5)) {
    assert.ok(t.id !== undefined, 'ticket id');
    assert.ok(t.originalRequest !== undefined, 'originalRequest');
    assert.ok(t.workDoneSoFar !== undefined, 'workDoneSoFar');
    assert.ok(t.whatsLeftToDo !== undefined, 'whatsLeftToDo');
    assert.ok(t.owner !== undefined, 'owner');
    assert.ok(t.status !== undefined, 'status');
    assert.ok(t.completionProof !== undefined, 'completionProof');
    assert.ok(t.completionGate !== undefined, 'completionGate');
    assert.ok(t.lastActivity !== undefined, 'lastActivity');
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
