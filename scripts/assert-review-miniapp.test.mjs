/**
 * assert-review-miniapp.test.mjs — Sensor test for the /review human queue.
 *
 * Covers:
 * - Review projection: only Status `review` rows (case/space tolerant), by header name
 * - Proof images resolve from Drive "Work done" per-key folders, images only
 * - Approve: archives to `archive_done` with Status Done + archived_at, then
 *   deletes the row from `current` (refuses when the item is not in review)
 * - Comment: stamped feedback lands in "What's left to do" (proof wrong) or
 *   "Original request" (new feature); rejects empty/oversize/bad-target
 * - Gateway endpoints: /review, /review/app, /review/api/state,
 *   /review/api/proof, /review/api/approve, /review/api/comment
 * - Gateway auth door admits valid initData and refuses bad HMAC
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';

import {
  createGateway,
  issueToken,
  COOKIE_NAME,
} from './tui-gateway.mjs';

import {
  REVIEW_TAB,
  ARCHIVE_TAB,
  PROOF_DRIVE_FOLDER,
  isReviewStatus,
  findHeaderIndex,
  colLetter,
  mapReviewRow,
  formatHumanStamp,
  formatLastActivity,
  buildArchiveRow,
  getReviewItems,
  approveReviewItem,
  commentReviewItem,
  verifyProofFile,
  resetReviewState,
} from './lib/review-status.mjs';

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

const HEADER = ['Ref', 'Original request', 'Work done so far', "What's left to do", 'Owner', 'Status', 'Completion proof', 'Completion gate', 'last_activity', 'Session', 'Session id', 'key'];
const ROW_A = ['R-1', 'Build the thing', 'Built it', '', 'agent-a', 'review', 'req:test-1', 'human says done', '12:00 - 2 oct (UK)', '', '', 'req:test-1'];
const ROW_B = ['R-2', 'Other work', 'Working', '', 'agent-b', 'Assigned', '', 'gate b', '12:00 - 2 oct (UK)', '', '', 'req:test-2'];
const ROW_C = ['R-3', 'Third work', 'Done-ish', 'left bits', 'agent-c', ' Review ', 'req:test-3', 'gate c', '12:00 - 2 oct (UK)', '', '', 'req:test-3'];
const CURRENT_VALUES = [HEADER, ROW_A, ROW_B, ROW_C];
const ARCHIVE_HEADER = ['Original request', 'Work done so far', "What's left to do", 'Owner', 'Status', 'Completion proof', 'Completion gate', 'id', 'key', 'kind', 'state', 'source', 'last_activity', 'archived_at', 'Ref'];

function fakeDeps(calls = {}) {
  return {
    loadHostEnv: () => ({ env: {} }),
    identityFromEnv: () => ({ ok: true }),
    accessToken: async () => ({ ok: true, token: 'tok' }),
    pmSheetId: () => 'sheet1',
    readTab: async (sheetId, tab) => {
      calls.reads = calls.reads || [];
      calls.reads.push(tab);
      if (tab === REVIEW_TAB) return { ok: true, json: { values: CURRENT_VALUES } };
      if (tab === ARCHIVE_TAB) return { ok: true, json: { values: [ARCHIVE_HEADER] } };
      return { ok: false, error: 'no such tab' };
    },
    appendRows: async (sheetId, tab, rows) => {
      calls.appended = { sheetId, tab, rows };
      return { ok: true };
    },
    updateValues: async (sheetId, range, values) => {
      calls.updated = calls.updated || [];
      calls.updated.push({ sheetId, range, values });
      return { ok: true };
    },
    deleteSheetRows: async (sheetId, gid, start, end) => {
      calls.deleted = { sheetId, gid, start, end };
      return { ok: true };
    },
    getSheet: async () => ({ ok: true, sheet: { sheets: [{ properties: { title: REVIEW_TAB, sheetId: 1597238694 } }] } }),
    listFolder: async (folderId) => {
      if (folderId === PROOF_DRIVE_FOLDER) {
        return { ok: true, json: { files: [{ id: 'fld1', name: 'req:test-1', mimeType: 'application/vnd.google-apps.folder' }] } };
      }
      if (folderId === 'fld1') {
        return {
          ok: true,
          json: {
            files: [
              { id: 'img1', name: 'a.png', mimeType: 'image/png' },
              { id: 'img2', name: 'b.png', mimeType: 'image/png' },
              { id: 'doc1', name: 'notes.md', mimeType: 'text/markdown' },
            ],
          },
        };
      }
      return { ok: true, json: { files: [] } };
    },
    downloadFile: async (fileId) => ({ ok: fileId === 'img1', bytes: fileId === 'img1' ? Buffer.from([1, 2, 3]) : null, error: 'nope' }),
  };
}

test('isReviewStatus matches review case- and space-insensitively, nothing else', () => {
  assert.equal(isReviewStatus('review'), true);
  assert.equal(isReviewStatus(' Review '), true);
  assert.equal(isReviewStatus('REVIEW'), true);
  assert.equal(isReviewStatus('Assigned'), false);
  assert.equal(isReviewStatus('Done'), false);
  assert.equal(isReviewStatus('In progress'), false);
  assert.equal(isReviewStatus(''), false);
  assert.equal(isReviewStatus(null), false);
});

test('findHeaderIndex locates the key header in the top five rows', () => {
  assert.equal(findHeaderIndex([['a'], HEADER]), 1);
  assert.equal(findHeaderIndex([HEADER]), 0);
  assert.equal(findHeaderIndex([['a'], ['b']]), -1);
});

test('colLetter maps columns to A1 letters', () => {
  assert.equal(colLetter(0), 'A');
  assert.equal(colLetter(3), 'D');
  assert.equal(colLetter(25), 'Z');
  assert.equal(colLetter(26), 'AA');
});

test('mapReviewRow projects by header name with the 1-based sheet row', () => {
  const lower = HEADER.map((h) => h.toLowerCase());
  const item = mapReviewRow(ROW_A, lower, 2);
  assert.equal(item.key, 'req:test-1');
  assert.equal(item.row, 2);
  assert.equal(item.originalRequest, 'Build the thing');
  assert.equal(item.status, 'review');
});

test('formatHumanStamp and formatLastActivity follow the sheet shapes', () => {
  const stamp = formatHumanStamp(new Date('2026-10-03T12:00:00+01:00').getTime());
  assert.ok(/^\[human \d{1,2} \w{3}\]$/.test(stamp), stamp);
  const act = formatLastActivity(new Date('2026-10-03T14:10:00+01:00').getTime());
  assert.ok(/^\d{2}:\d{2} - \d{1,2} [a-z]{3} \(UK\)$/.test(act), act);
});

test('buildArchiveRow follows the archive header order with Done + archived_at', () => {
  const fields = { key: 'req:test-1', ref: 'R-1', originalRequest: 'Build', workDone: 'Built', whatsLeft: '', owner: 'a', proof: 'p', gate: 'g' };
  const row = buildArchiveRow(ARCHIVE_HEADER, fields, '2026-10-03T00:00:00.000Z');
  const at = (name) => row[ARCHIVE_HEADER.indexOf(name)];
  assert.equal(at('Status'), 'Done');
  assert.equal(at('state'), 'done');
  assert.equal(at('archived_at'), '2026-10-03T00:00:00.000Z');
  assert.equal(at('key'), 'req:test-1');
  assert.equal(at('Original request'), 'Build');
  assert.equal(at('source'), 'review-miniapp');
});

test('getReviewItems returns only review rows with their proof images', async () => {
  resetReviewState();
  const deps = fakeDeps();
  const res = await getReviewItems({ env: {}, deps, refresh: true });
  assert.equal(res.ok, true);
  assert.equal(res.google, true);
  assert.deepEqual(res.items.map((i) => i.key), ['req:test-1', 'req:test-3']);
  const first = res.items[0];
  assert.equal(first.row, 2);
  assert.deepEqual(first.proofs.map((p) => p.id), ['img1', 'img2']);
  assert.equal(res.items[1].proofs.length, 0);
});

test('verifyProofFile admits only listed images of the item', async () => {
  resetReviewState();
  const deps = fakeDeps();
  const { getReviewContext } = await import('./lib/review-status.mjs');
  const ctx = await getReviewContext({ env: {}, deps });
  assert.equal(ctx.ok, true);
  const hit = await verifyProofFile(ctx, 'req:test-1', 'img1', { deps });
  assert.equal(hit.ok, true);
  const miss = await verifyProofFile(ctx, 'req:test-1', 'evil-id', { deps });
  assert.equal(miss.ok, false);
});

test('approveReviewItem archives Done then deletes the current row', async () => {
  resetReviewState();
  const calls = {};
  const res = await approveReviewItem('req:test-1', { env: {}, deps: fakeDeps(calls) });
  assert.equal(res.ok, true);
  assert.equal(calls.appended.tab, ARCHIVE_TAB);
  const archRow = calls.appended.rows[0];
  assert.equal(archRow[ARCHIVE_HEADER.indexOf('Status')], 'Done');
  assert.equal(archRow[ARCHIVE_HEADER.indexOf('key')], 'req:test-1');
  assert.equal(archRow[ARCHIVE_HEADER.indexOf('Original request')], 'Build the thing');
  assert.ok(archRow[ARCHIVE_HEADER.indexOf('archived_at')]);
  assert.deepEqual([calls.deleted.gid, calls.deleted.start, calls.deleted.end], [1597238694, 1, 2]);
});

test('approveReviewItem refuses items not awaiting review', async () => {
  resetReviewState();
  const notReview = await approveReviewItem('req:test-2', { env: {}, deps: fakeDeps() });
  assert.equal(notReview.ok, false);
  assert.match(notReview.error, /not review|not found/);
  const missing = await approveReviewItem('req:nope', { env: {}, deps: fakeDeps() });
  assert.equal(missing.ok, false);
  const empty = await approveReviewItem('', { env: {}, deps: fakeDeps() });
  assert.equal(empty.ok, false);
});

test('commentReviewItem appends stamped feedback to Whats-left vs Original-request', async () => {
  resetReviewState();
  const callsLeft = {};
  const left = await commentReviewItem('req:test-3', 'screenshot shows the old text', 'left', { env: {}, deps: fakeDeps(callsLeft), now: new Date('2026-10-03T14:10:00+01:00').getTime() });
  assert.equal(left.ok, true);
  assert.equal(left.target, 'left');
  const whatsRange = callsLeft.updated[0];
  assert.equal(whatsRange.range, 'current!D4');
  assert.match(whatsRange.values[0][0], /left bits\n\[human .*\] screenshot shows the old text/);

  resetReviewState();
  const callsOrig = {};
  const orig = await commentReviewItem('req:test-3', 'also add dark mode', 'original', { env: {}, deps: fakeDeps(callsOrig) });
  assert.equal(orig.ok, true);
  assert.equal(callsOrig.updated[0].range, 'current!B4');
  assert.match(callsOrig.updated[0].values[0][0], /Third work\n\[human .*\] also add dark mode/);
});

test('commentReviewItem rejects empty, oversize, and mistargeted comments', async () => {
  resetReviewState();
  const deps = fakeDeps();
  assert.equal((await commentReviewItem('req:test-3', '  ', 'left', { env: {}, deps })).ok, false);
  assert.equal((await commentReviewItem('req:test-3', 'x'.repeat(2001), 'left', { env: {}, deps })).ok, false);
  assert.equal((await commentReviewItem('req:test-3', 'hi', 'elsewhere', { env: {}, deps })).ok, false);
  assert.equal((await commentReviewItem('req:test-2', 'hi', 'left', { env: {}, deps })).ok, false);
});

test('gateway /review auth door admits valid initData and refuses bad HMAC', async () => {
  const botToken = '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ';
  const secret = 'gateway-test-secret-12345';
  const env = { TUI_GATEWAY_SECRET: secret, TUI_BOT_TOKEN_VM: botToken };
  const handle = createGateway({ env });
  const server = http.createServer(handle);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const validInitData = makeInitData(botToken);
    const validRes = await fetch(`${base}/review?bot=vm&initData=${encodeURIComponent(validInitData)}`, { redirect: 'manual' });
    assert.equal(validRes.status, 302);
    assert.ok((validRes.headers.get('location') || '').startsWith('/review/app?token='));

    const badInitData = validInitData.replace(/hash=[a-f0-9]{10}/, 'hash=deadbeef00');
    const badRes = await fetch(`${base}/review?bot=vm&initData=${encodeURIComponent(badInitData)}`, { redirect: 'manual' });
    assert.equal(badRes.status, 401);
  } finally {
    server.close();
  }
});

test('gateway /review routes: landing, app, state, proof guard, write validation', async () => {
  resetReviewState();
  const botToken = '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ';
  const secret = 'gateway-test-secret-12345';
  const env = { TUI_GATEWAY_SECRET: secret, TUI_BOT_TOKEN_VM: botToken, FLEET_TEST_AUTH: '1' };
  const handle = createGateway({ env });
  const server = http.createServer(handle);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const landingRes = await fetch(`${base}/review`, { redirect: 'manual' });
    assert.equal(landingRes.status, 200);
    assert.ok((await landingRes.text()).includes('opening review queue'));

    const appRes = await fetch(`${base}/review/app`);
    assert.equal(appRes.status, 200);
    const appHtml = await appRes.text();
    assert.ok(appHtml.includes('Review Queue'));
    assert.ok(appHtml.includes('id="comment"'));

    const stateRes = await fetch(`${base}/review/api/state`);
    assert.equal(stateRes.status, 200);
    const stateData = await stateRes.json();
    assert.equal(stateData.ok, true);
    assert.ok(Array.isArray(stateData.items));

    const proofRes = await fetch(`${base}/review/api/proof?key=x`);
    assert.equal(proofRes.status, 400);

    const approveRes = await fetch(`${base}/review/api/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(approveRes.status, 200);
    assert.equal((await approveRes.json()).ok, false);

    const commentRes = await fetch(`${base}/review/api/comment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'x', target: 'elsewhere', text: 'hi' }),
    });
    assert.equal(commentRes.status, 200);
    assert.equal((await commentRes.json()).ok, false);
  } finally {
    server.close();
  }
});

test('gateway /review/api routes refuse without a token outside test auth', async () => {
  const secret = 'gateway-test-secret-12345';
  const env = { TUI_GATEWAY_SECRET: secret, TUI_BOT_TOKEN_VM: '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ' };
  const handle = createGateway({ env });
  const server = http.createServer(handle);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/review/app`)).status, 401);
    assert.equal((await fetch(`${base}/review/api/state`)).status, 401);
    assert.equal((await fetch(`${base}/review/api/proof?key=a&file=b`)).status, 401);
    assert.equal((await fetch(`${base}/review/api/approve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
  } finally {
    server.close();
  }
  assert.ok(COOKIE_NAME.length > 0);
  assert.ok(issueToken);
});
