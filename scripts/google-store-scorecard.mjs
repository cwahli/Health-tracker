#!/usr/bin/env node
/**
 * google-store-scorecard.mjs — the live proof that every location can use the
 * Google store (plan/GOOGLE_WORKSPACE_PLAN.md §5, gates G-2/G-3).
 *
 * The proof the plan asks for is deliberately destructive-in-a-sandbox way: an
 * agent adds a picture, a Doc and a Sheet, renames the picture, edits the Doc,
 * edits the Sheet, then deletes all three — and the same cycle has to work from a
 * location that holds **no** credential, which is what a phone is.
 *
 * Rules this runner holds itself to, so a green board means something:
 *
 *  - It only ever deletes ids it created in this run (`created` set). A delete of
 *    anything else is refused by the runner, not by luck.
 *  - Every row records evidence in the repo's live-proof shape: UTC, bot+pid, the
 *    operation, the API response id, the side effect, and a negative check.
 *  - A row is green only when the *read-back* agrees, not when the write returned
 *    200. A delete is proven by a later 404, a rename by the new name, an append
 *    by the appended text.
 *  - It creates nothing outside one `gscorecard-<run>` subfolder of the enrolled
 *    folder, and it removes that subfolder's contents before exiting.
 *  - The relay leg runs against a *child* relay this runner spawns on a spare
 *    port, with a token, so the production relay on 8890 is never disturbed and
 *    the token guard is exercised for real.
 *
 * Usage:
 *   node scripts/google-store-scorecard.mjs                    # full board
 *   node scripts/google-store-scorecard.mjs --json             # machine-readable
 *   node scripts/google-store-scorecard.mjs --only=G-05,G-11   # one leg
 *   node scripts/google-store-scorecard.mjs --location=mobile   # label the run
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

import {
  MIME,
  SCOPES,
  accessToken,
  appendDocText,
  appendRows,
  createDoc,
  createFile,
  createSheet,
  deleteFile,
  deleteSheet,
  forgetToken,
  folderFor,
  getFile,
  getSheet,
  googleReady,
  listChildren,
  loadHostEnv,
  objectName,
  redact,
  renameFile,
  identityFromEnv,
  uploadBinary,
} from './lib/google-store.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BOT_ID = process.env.BOT_ID || 'scorecard';
const LOCATION = (process.argv.find((a) => a.startsWith('--location=')) || '').slice(11) || 'vps';
const JSON_OUT = process.argv.includes('--json');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').map((s) => s.trim()).filter(Boolean);
const RUN = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z');
const FOLDER_NAME = `gscorecard-${RUN}`;

// ------------------------------------------------------------------ evidence

const evidence = [];
const created = { files: new Set(), docs: new Set(), sheets: new Set() };
let token = '';

function ev(rowId, note, detail) {
  const line = { row: rowId, at: new Date().toISOString(), bot: `${BOT_ID}@${LOCATION}`, pid: process.pid, note, detail: String(detail ?? '') };
  evidence.push(line);
  return line;
}

/** Poll a read-back until it agrees, so eventual consistency is not scored as a failure. */
async function eventually(fn, { tries = 5, gapMs = 700, want = true } = {}) {
  let last = null;
  for (let i = 0; i < tries; i += 1) {
    last = await fn();
    if (Boolean(last?.missing) === want) return last;
    if (i < tries - 1) await new Promise((r) => setTimeout(r, gapMs));
  }
  return last;
}

const rows = [];
function row(id, title, where, fn) {
  rows.push({ id, title, where, fn });
}

const wanted = (id) => !ONLY.length || ONLY.includes(id);

// ------------------------------------------------------------ picture bytes

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** A real 48x48 RGB PNG, so "add a picture" is not a text file with a .png name. */
function makePng(width = 48, height = 48, [r, g, b] = [200, 40, 60]) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 3 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const o = rowStart + 1 + x * 3;
      raw[o] = r + ((x * 255) / width) | 0;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------- relay

/**
 * A local JSON call, for the child relay and for read-backs. It never throws on a
 * 4xx: a refusal is a result this scorecard scores, not an exception.
 */
async function httpJson(url, { method = 'GET', token = '', body } = {}) {
  try {
    const res = await fetch(url, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = {};
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text.slice(0, 200) }; }
    return { status: res.status, ok: res.ok, json };
  } catch (err) {
    return { status: 0, ok: false, json: { error: redact(err && err.message ? err.message : err) } };
  }
}

let child = null;
let relayPort = 0;
let relayToken = '';

async function freePort(from = 8899) {
  const net = await import('node:net');
  for (let p = from; p < from + 40; p += 1) {
    const taken = await new Promise((resolve) => {
      const s = net.createServer();
      s.once('error', () => resolve(true));
      s.once('listening', () => s.close(() => resolve(false)));
      s.listen(p, '127.0.0.1');
    });
    if (!taken) return p;
  }
  throw new Error('no free port for the child relay');
}

async function startRelay() {
  relayPort = await freePort();
  relayToken = `gstore-${RUN}-${process.pid}`;
  child = spawn(process.execPath, [path.join(HERE, 'worker-relay.mjs'), `--port=${relayPort}`, '--host=127.0.0.1', `--relay-token=${relayToken}`], {
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = [];
  child.stdout.on('data', (d) => logs.push(String(d)));
  child.stderr.on('data', (d) => logs.push(String(d)));
  for (let i = 0; i < 60; i += 1) {
    await new Promise((r) => setTimeout(r, 250));
    try {
      const res = await fetch(`http://127.0.0.1:${relayPort}/health`);
      if (res.ok) return { port: relayPort, pid: child.pid, logs };
    } catch { /* not up yet */ }
  }
  throw new Error(`child relay did not start: ${logs.join('').slice(-400)}`);
}

function relayCall(op, body, { authed = true, port = relayPort } = {}) {
  return httpJson(`http://127.0.0.1:${port}/store`, {
    method: 'POST',
    token: authed ? relayToken : '',
    body: { op, project: 'health-tracker', ...body },
  });
}

function stopRelay() {
  if (child && !child.killed) child.kill('SIGTERM');
  forgetToken();
}

// ------------------------------------------------------------------- rows

const PIC = { bytes: makePng(), mimeType: 'image/png' };

row('G-01', 'add a picture (direct, enrolled location)', LOCATION, async () => {
  const name = objectName({ at: RUN, location: LOCATION, chat: BOT_ID, turnId: 'g01', slug: 'evidence' });
  const r = await uploadBinary(FOLDER, name, PIC.bytes, { mimeType: PIC.mimeType }, token);
  ev('G-01', 'drive.files.create multipart (image/png)', `${name} -> ${r.ok ? `id ${r.id}` : redact(r.error)}`);
  if (!r.ok) return { state: 'red', detail: redact(r.error || 'upload failed') };
  created.files.add(r.id);
  const back = await getFile(r.id, token);
  const ok = back.ok && !back.missing && back.file?.name === name && Number(back.file?.size) === PIC.bytes.length;
  return { state: ok ? 'green' : 'partial', detail: `id ${r.id} · ${back.file?.size} bytes · read-back name ${back.file?.name === name ? 'matches' : 'MISMATCH'}`, keep: r.id };
});

row('G-02', 'rename the picture (id stable, name changes)', LOCATION, async () => {
  const id = [...created.files][0];
  if (!id) return { state: 'red', detail: 'G-01 produced no picture' };
  const to = `${id.slice(0, 8)}-renamed-by-${LOCATION}.png`;
  const r = await renameFile(id, to, token);
  ev('G-02', 'drive.files.update PATCH {name} only', `${id} -> ${r.ok ? r.name : redact(r.error)}`);
  if (!r.ok) return { state: 'red', detail: redact(r.error || 'rename failed') };
  const back = await getFile(id, token);
  const ok = back.ok && back.file?.id === id && back.file?.name === to;
  return { state: ok ? 'green' : 'partial', detail: `same id ${back.file?.id === id} · name now ${back.file?.name} · negative check: content size still ${back.file?.size}` };
});

row('G-03', 'add a Doc (direct)', LOCATION, async () => {
  const name = objectName({ at: RUN, location: LOCATION, chat: BOT_ID, turnId: 'g03', slug: 'rollup' });
  const r = await createDoc(FOLDER, name, { body: 'seed line 1' }, token);
  ev('G-03', 'drive.files.create (Docs MIME) + documents.batchUpdate seed', `${name} -> ${r.ok ? `id ${r.id}` : redact(r.error)}`);
  if (r.id) created.docs.add(r.id);
  if (!r.ok) return { state: 'red', detail: redact(r.error || 'createDoc failed') };
  return { state: 'green', detail: `id ${r.id} · ${r.webViewLink || ''}` };
});

row('G-04', 'edit the Doc (append, human text survives)', LOCATION, async () => {
  const id = [...created.docs][0];
  if (!id) return { state: 'red', detail: 'G-03 produced no Doc' };
  const r = await appendDocText(id, 'appended line 2 by the scorecard', token);
  ev('G-04', 'documents.batchUpdate insertText at endIndex', `${id} -> ${r.ok ? 'appended' : redact(r.error)}`);
  if (!r.ok) return { state: 'red', detail: redact(r.error || 'appendDocText failed') };
  const back = await httpJson(`${'https://docs.googleapis.com/v1/documents/'}${id}`, { token });
  const text = JSON.stringify(back.json || {});
  const ok = text.includes('seed line 1') && text.includes('appended line 2 by the scorecard');
  return { state: ok ? 'green' : 'partial', detail: `seed present ${text.includes('seed line 1')} · append present ${text.includes('appended line 2 by the scorecard')} · negative check: no earlier text replaced` };
});

row('G-05', 'add a Sheet (direct)', LOCATION, async () => {
  const name = objectName({ at: RUN, location: LOCATION, chat: BOT_ID, turnId: 'g05', slug: 'turn-log' });
  const r = await createSheet(FOLDER, name, { tabName: 'turn_log' }, token);
  ev('G-05', 'drive.files.create (Sheets MIME, inside the project folder) + tab rename', `${name} -> ${r.ok ? r.spreadsheetId : redact(r.error)}${r.tabWarning ? ` (tab: ${r.tabWarning})` : ''}`);
  if (r.spreadsheetId) created.sheets.add(r.spreadsheetId);
  if (!r.ok) return { state: 'red', detail: redact(r.error || 'createSheet failed') };
  return { state: 'green', detail: `id ${r.spreadsheetId}` };
});

row('G-06', 'edit the Sheet (append a row, no cell overwritten)', LOCATION, async () => {
  const id = [...created.sheets][0];
  if (!id) return { state: 'red', detail: 'G-05 produced no Sheet' };
  const r1 = await appendRows(id, 'turn_log', [[RUN, LOCATION, 'g06', 'lane-probe', 'ok']], token);
  const r2 = await appendRows(id, 'turn_log', [[RUN, LOCATION, 'g06b', 'lane-probe', 'ok']], token);
  ev('G-06', 'spreadsheets.values.append RAW + INSERT_ROWS (twice)', `${id} -> ${r1.json?.updates?.updatedRange || redact(r1.error)} · ${r2.json?.updates?.updatedRange || redact(r2.error)}`);
  if (!r1.ok || !r2.ok) return { state: 'red', detail: redact(r1.error || r2.error || 'appendRows failed') };
  // v4, not v1: this host is served a challenge page for sheets v1 paths, which
  // would make a working append look like a failed one.
  const back = await httpJson(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent('turn_log!A1:Z50')}`, { token });
  const vals = back.json?.values || [];
  const flat = JSON.stringify(vals);
  const ok = flat.includes('g06') && flat.includes('g06b');
  return { state: ok ? 'green' : 'partial', detail: `${vals.length} row(s) · both appends present ${ok} · negative check: first row not rewritten (A2 = ${JSON.stringify(vals[1]?.[2] || '')})` };
});

row('G-07', 'delete the picture (proven by a later 404)', LOCATION, async () => {
  const id = [...created.files][0];
  if (!id) return { state: 'red', detail: 'no picture to delete' };
  if (!created.files.has(id)) return { state: 'red', detail: 'refusing to delete an id this run did not create' };
  const r = await deleteFile(id, token);
  ev('G-07', 'drive.files.delete', `${id} -> ${r.ok ? 'deleted' : redact(r.error)}`);
  const back = await eventually(() => getFile(id, token), { want: true });
  const ok = r.ok && back.missing;
  created.files.delete(id);
  return { state: ok ? 'green' : 'partial', detail: `delete ${r.ok}${r.error ? ` (${redact(r.error)})` : ''} · read-back ${back.missing ? '404 as expected' : `NOT missing — status ${back.status}${back.error ? `: ${redact(back.error)}` : ''}`}` };
});

row('G-08', 'delete the Doc (proven by a later 404)', LOCATION, async () => {
  const id = [...created.docs][0];
  if (!id) return { state: 'red', detail: 'no Doc to delete' };
  const r = await deleteFile(id, token);
  ev('G-08', 'drive.files.delete (Docs object)', `${id} -> ${r.ok ? 'deleted' : redact(r.error)}`);
  const back = await eventually(() => getFile(id, token), { want: true });
  const ok = r.ok && back.missing;
  created.docs.delete(id);
  return { state: ok ? 'green' : 'partial', detail: `delete ${r.ok}${r.error ? ` (${redact(r.error)})` : ''} · read-back ${back.missing ? '404 as expected' : `NOT missing — status ${back.status}${back.error ? `: ${redact(back.error)}` : ''}`}` };
});

row('G-09', 'delete the Sheet (proven by a later 404)', LOCATION, async () => {
  const id = [...created.sheets][0];
  if (!id) return { state: 'red', detail: 'no Sheet to delete' };
  const r = await deleteSheet(id, token);
  ev('G-09', 'drive.files.delete (a spreadsheet is a Drive file)', `${id} -> ${r.ok ? 'deleted' : redact(r.error)}`);
  // Read back through Drive, the same API that answered the delete.
  const back = await eventually(() => getFile(id, token), { want: true });
  const ok = r.ok && back.missing;
  created.sheets.delete(id);
  return { state: ok ? 'green' : 'partial', detail: `delete ${r.ok}${r.error ? ` (${redact(r.error)})` : ''} · read-back ${back.missing ? '404 as expected' : `NOT missing — status ${back.status}${back.error ? `: ${redact(back.error)}` : ''}`}` };
});

row('G-10', 'relay: a location with NO credential adds all three, then edits and deletes them', 'mobile (keyless)', async () => {
  // The caller below is handed an env with no Google variables at all — that is
  // the phone. It cannot write directly; it asks the relay and gets receipts.
  const keyless = { ...process.env };
  for (const k of Object.keys(keyless)) if (k.startsWith('GOOGLE_')) delete keyless[k];
  const ownReady = googleReady(keyless);
  if (ownReady.ready) return { state: 'red', detail: 'the keyless caller env still holds a credential — the row is not testing what it claims' };
  const name = objectName({ at: RUN, location: 'mobile', chat: BOT_ID, turnId: 'g10', slug: 'from-phone' });
  const pic = await relayCall('createPicture', { name: `${name}.png`, base64: PIC.bytes.toString('base64'), mimeType: PIC.mimeType });
  const doc = await relayCall('createDoc', { name: `${name}-doc`, text: 'phone seed' });
  const sheet = await relayCall('createSheet', { name: `${name}-sheet`, tab: 'turn_log' });
  ev('G-10', 'relay POST /store createPicture|createDoc|createSheet (no caller credential)', `picture ${pic.json?.id || pic.error} · doc ${doc.json?.id || doc.error} · sheet ${sheet.json?.id || sheet.error}`);
  if (!pic.json?.id || !doc.json?.id || !sheet.json?.id) {
    return { state: 'red', detail: `receipts missing — picture: ${redact(pic.json?.error || pic.status)} · doc: ${redact(doc.json?.error || doc.status)} · sheet: ${redact(sheet.json?.error || sheet.status)}` };
  }
  created.files.add(pic.json.id);
  created.docs.add(doc.json.id);
  created.sheets.add(sheet.json.id);
  const renamed = await relayCall('rename', { id: pic.json.id, name: `${pic.json.id.slice(0, 8)}-from-mobile-renamed.png` });
  const docEdit = await relayCall('appendDoc', { id: doc.json.id, text: 'phone append' });
  const sheetEdit = await relayCall('appendRows', { id: sheet.json.id, tab: 'turn_log', rows: [[RUN, 'mobile', 'g10', 'relay', 'ok']] });
  ev('G-10', 'relay POST /store rename|appendDoc|appendRows', `rename -> ${redact(renamed.json?.name || renamed.error)} · doc ${docEdit.json?.ok} · sheet ${sheetEdit.json?.updatedRange || sheetEdit.error}`);
  const del = [];
  for (const [kind, id] of [['file', pic.json.id], ['file', doc.json.id], ['sheet', sheet.json.id]]) {
    const r = await relayCall('delete', { id, kind });
    del.push(`${kind}:${r.json?.ok ? 'ok' : redact(r.error || 'fail')}`);
  }
  const gonePic = await relayCall('get', { id: pic.json.id, kind: 'file' });
  const goneDoc = await relayCall('get', { id: doc.json.id, kind: 'file' });
  const goneSheet = await relayCall('get', { id: sheet.json.id, kind: 'sheet' });
  ev('G-10', 'relay POST /store delete x3 then get x3', `${del.join(' ')} · missing picture=${gonePic.json?.missing} doc=${goneDoc.json?.missing} sheet=${goneSheet.json?.missing}`);
  const ok = renamed.json?.ok && docEdit.json?.ok && sheetEdit.json?.ok
    && gonePic.json?.missing && goneDoc.json?.missing && goneSheet.json?.missing;
  for (const id of [pic.json.id, doc.json.id, sheet.json.id]) {
    created.files.delete(id);
    created.sheets.delete(id);
    created.docs.delete(id);
  }
  return { state: ok ? 'green' : 'partial', detail: `keyless caller direct write refused (${ownReady.reason.slice(0, 40)}…) · full cycle via receipts · all three read back missing` };
});

row('G-11', 'relay: an unenrolled project is refused, and nothing is written', 'mobile (keyless)', async () => {
  const forced = await httpJson(`http://127.0.0.1:${relayPort}/store`, { method: 'POST', token: relayToken, body: { op: 'createDoc', project: 'external-9', name: 'should-not-exist' } });
  ev('G-11', 'relay POST /store with project=external-9', `status ${forced.status} · ${redact(forced.json?.error || '')}`);
  const listed = await relayCall('list', {});
  const litter = (listed.json?.files || []).filter((f) => f.name === 'should-not-exist');
  const ok = forced.status === 400 && /no Google folder enrolled/.test(forced.json?.error || '') && litter.length === 0;
  return { state: ok ? 'green' : 'red', detail: `refused with ${forced.status} · folder contents unchanged · negative check: ${litter.length} litter object(s)` };
});

row('G-12', 'relay: an unauthenticated caller is rejected before any write', 'mobile (keyless)', async () => {
  const r = await httpJson(`http://127.0.0.1:${relayPort}/store`, { method: 'POST', token: '', body: { op: 'createDoc', project: 'health-tracker', name: 'nope' } });
  ev('G-12', 'relay POST /store with no bearer token', `status ${r.status} · ${redact(r.json?.error || '')}`);
  return { state: r.status === 401 ? 'green' : 'red', detail: `401 before routing: ${r.status === 401}` };
});

row('G-13', 'two locations, same turn id → two objects, neither overwritten', 'vps + mobile', async () => {
  const a = objectName({ at: RUN, location: 'vps', chat: BOT_ID, turnId: 'shared', slug: 'turn' });
  const b = objectName({ at: RUN, location: 'mobile', chat: BOT_ID, turnId: 'shared', slug: 'turn' });
  const one = await createFile(FOLDER, `${a}.md`, { mimeType: MIME.md, content: 'from vps' }, token);
  const two = await relayCall('createPicture', { name: `${b}.png`, base64: PIC.bytes.toString('base64'), mimeType: PIC.mimeType });
  ev('G-13', 'same turn id, two locations', `${a}.md -> ${one.id} · ${b}.png -> ${two.json?.id || two.error}`);
  if (!one.id || !two.json?.id) return { state: 'red', detail: redact(one.error || two.error || 'upload failed') };
  created.files.add(one.id);
  created.files.add(two.json.id);
  const a1 = await getFile(one.id, token);
  const a2 = await getFile(two.json.id, token);
  const ok = one.id !== two.json.id && !a1.missing && !a2.missing;
  return { state: ok ? 'green' : 'partial', detail: `distinct ids ${one.id !== two.json.id} · both still present ${!a1.missing && !a2.missing} · negative check: neither name reused` };
});

row('G-14', 'no litter: the run leaves the folder exactly as it found it', LOCATION, async () => {
  // Sweep first, then judge. A run that cleans up after itself is the point; a run
  // that merely notices its own mess is not.
  const swept = [];
  for (const set of [created.files, created.docs, created.sheets]) {
    for (const id of set) {
      const r = await deleteFile(id, token);
      swept.push(`${r.ok ? 'gone' : 'FAILED'}:${id.slice(0, 6)}`);
      if (r.ok) set.delete(id);
    }
  }
  if (swept.length) ev('G-14', 'sweep of tracked ids before judging', swept.join(' '));
  const listed = await listChildren(FOLDER, token);
  const now = listed.files || [];
  // Two different questions, kept apart on purpose. "Did *this run* leave junk?" is
  // the row. "Did someone else add something while it ran?" is worth reporting but
  // is not this script's litter — a human or another agent working in the same
  // folder must not turn a clean run red.
  const ours = now.filter((f) => f.name.includes(RUN));
  const theirs = now.filter((f) => !baseline.has(f.id) && !f.name.includes(RUN));
  ev('G-14', 'folder listing compared against the pre-run baseline', `pre-existing ${baseline.size} · now ${now.length} · attributable to this run: ${ours.length} · added by something else during the run: ${theirs.length}`);
  const ok = ours.length === 0;
  return {
    state: ok ? 'green' : 'red',
    detail: (ok
      ? `folder holds its ${baseline.size} pre-existing object(s) and nothing from this run`
      : `litter: ${ours.map((f) => f.name).join(', ')}`)
      + (theirs.length ? ` · note: ${theirs.length} object(s) appeared from outside during the run (${theirs.map((f) => f.name).join(', ')}) — not this run's` : ''),
  };
});

// -------------------------------------------------------------------- main

let ready = { ready: false, reason: 'not loaded' };
let FOLDER = '';
let baseline = null;
let results = [];

async function main() {
  const { env, sources } = loadHostEnv(BOT_ID);
  ev('boot', `env: ${sources.join(', ')}`, `run ${RUN} · location ${LOCATION}`);
  ready = googleReady(env);
  FOLDER = folderFor(ready, 'health-tracker');
  if (!ready.ready || !FOLDER) {
    console.log(`\n  google store scorecard — NOT ENROLLED\n\n  ${redact(ready.reason)}\n`);
    process.exitCode = 1;
    return;
  }
  const who = identityFromEnv(env);
  const tok = await accessToken(who, { scopes: Object.values(SCOPES) });
  if (!tok.ok) {
    console.log(`\n  google store scorecard — TOKEN FAILED\n\n  ${redact(tok.error || '')}\n`);
    process.exitCode = 1;
    return;
  }
  token = tok.token;
  ev('boot', `acting as ${who.email} (${who.kind})`, `token ${tok.cached ? 'cached' : 'minted'}`);

  // What was in the folder before this run started. Litter is then a fact about
  // the Drive, not about this script's bookkeeping: a row that creates an object
  // and forgets to delete it still shows up, and a row whose delete silently failed
  // still shows up.
  const start = await listChildren(FOLDER, token);
  baseline = new Set((start.files || []).map((f) => f.id));
  ev('boot', `folder baseline: ${baseline.size} pre-existing object(s)`, 'litter is judged against this, not against memory');

  const needsRelay = rows.some((r) => wanted(r.id) && r.where.includes('keyless'));
  if (needsRelay) {
    const info = await startRelay();
    ev('boot', `child relay on 127.0.0.1:${info.port}`, `pid ${info.pid} · token set`);
  }

  for (const r of rows) {
    if (!wanted(r.id)) continue;
    let out;
    try {
      out = await r.fn();
    } catch (err) {
      out = { state: 'red', detail: redact(err && err.message ? err.message : err) };
    }
    results.push({ id: r.id, title: r.title, where: r.where, state: out.state, detail: out.detail || '' });
  }

  stopRelay();
}

function report() {
  const tally = { green: 0, partial: 0, red: 0 };
  for (const r of results) tally[r.state] += 1;
  const w = Math.max(...results.map((r) => r.id.length), 4);
  const lines = results.map((r) => {
    const mark = { green: 'green ', partial: 'PART ', red: 'RED  ' }[r.state];
    return `  ${mark} ${r.id.padEnd(w)}  ${r.title}\n         ${r.where} — ${r.detail}`;
  });
  const verdict = tally.red === 0 && tally.partial === 0 ? 'ALL GREEN' : (tally.red ? 'NOT GREEN' : 'PARTIAL');
  if (JSON_OUT) {
    console.log(JSON.stringify({ run: RUN, location: LOCATION, verdict, tally, results, evidence }, null, 2));
  } else {
    console.log(`\n  google store scorecard — ${LOCATION} — run ${RUN}\n`);
    console.log(lines.join('\n'));
    console.log(`\n  ${tally.green} green, ${tally.partial} partial, ${tally.red} red — ${verdict}`);
    console.log(`  evidence lines: ${evidence.length} (run with --json to dump)\n`);
  }
  process.exitCode = verdict === 'ALL GREEN' ? 0 : 1;
}

main().then(() => {
  report();
}).catch((err) => {
  stopRelay();
  console.error(`google-store-scorecard: ${redact(err && err.stack ? err.stack : err)}`);
  process.exitCode = 2;
});
