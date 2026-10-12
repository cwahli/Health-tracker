// Phase 2 spike harness: Drive Meals-inbox poll + dedupe + triage-manifest.
// DRY-RUN ONLY. Reads inbox, never deletes, never creates analyze jobs.
// Food-gate is a stub (returns 'unknown') — replace with the P1 winner.
// Usage:
//   node scripts/drive-inbox-spike.mjs --selftest
//   DRIVE_REFRESH_TOKEN=.. DRIVE_CLIENT_ID=.. DRIVE_CLIENT_SECRET=.. \
//     DRIVE_INBOX_ID=.. DRIVE_T0=2026-10-12T00:00:00.000Z \
//     node scripts/drive-inbox-spike.mjs --out spike-out/ [--cap 20]
//   node scripts/drive-inbox-spike.mjs --local ./spike-photos/ --out spike-out/ [--cap 30]
//   node scripts/drive-inbox-spike.mjs --gates --out spike-out/   (after labeling)

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// STUB stage-1 food gate. Always 'unknown'. The spike measures ingest+dedupe;
// triage precision is measured after the human labels the manifest, against
// whichever gate model P1 produces. Do NOT ship this stub as a gate.
function classifyFoodThumb(_bytes) {
  return 'unknown';
}

async function refreshAccessToken() {
  const { DRIVE_REFRESH_TOKEN, DRIVE_CLIENT_ID, DRIVE_CLIENT_SECRET } = process.env;
  if (!DRIVE_REFRESH_TOKEN || !DRIVE_CLIENT_ID || !DRIVE_CLIENT_SECRET) {
    throw new Error('missing DRIVE_REFRESH_TOKEN / DRIVE_CLIENT_ID / DRIVE_CLIENT_SECRET');
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: DRIVE_CLIENT_ID,
      client_secret: DRIVE_CLIENT_SECRET,
      refresh_token: DRIVE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`token refresh failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

const driveGet = (token) => async (path, params = {}) => {
  const url = new URL(`https://www.googleapis.com/drive/v3/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`drive ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
};

// Shared ingest: bytes in, dedupe + manifest entry out. Used by both the
// Drive poll and --local (test-folder) modes so the spike measures one path.
function ingestOne(state, outDir, id, name, createdTime, bytes, md5 = null) {
  const hash = sha256(bytes);
  if (state.shaSeen[hash]) {
    state.processed[id] = { sha256: hash, verdict: 'duplicate', of: state.shaSeen[hash] };
    return 'duplicate';
  }
  state.shaSeen[hash] = id;
  writeFileSync(join(outDir, 'full', `${id}.bin`), bytes);
  state.processed[id] = {
    name, createdTime, md5, sha256: hash,
    size: bytes.length, gate: classifyFoodThumb(bytes), label: null,
  };
  return 'stored';
}

// Test-folder mode: ingest local image files as if just polled from Drive.
// Proves dedupe + manifest + gates on N real files with zero credentials.
async function ingestLocal(dir, cap, outDir, state) {
  const exts = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.gif'];
  const files = readdirSync(dir)
    .filter((f) => exts.some((e) => f.toLowerCase().endsWith(e)))
    .sort()
    .slice(0, cap);
  let n = 0;
  for (const f of files) {
    const id = `local-${f}`;
    if (state.processed[id]) continue;
    ingestOne(state, outDir, id, f, null, readFileSync(join(dir, f)));
    n++;
  }
  return n;
}

async function pollInbox({ token, inboxId, t0, cap, outDir, state }) {
  const api = driveGet(token);
  const q = `'${inboxId}' in parents and trashed = false and createdTime > '${t0}'`;
  let pageToken;
  const fresh = [];
  do {
    const page = await api('files', {
      q,
      orderBy: 'createdTime',
      pageSize: '100',
      ...(pageToken ? { pageToken } : {}),
      fields: 'nextPageToken,files(id,name,mimeType,createdTime,md5Checksum,size)',
    });
    for (const f of page.files || []) {
      if (!String(f.mimeType || '').startsWith('image/')) continue;
      if (!f.md5Checksum) { state.skippedNoMd5.push(f.id); continue; }
      if (state.processed[f.id]) continue;
      fresh.push(f);
      if (fresh.length >= cap) break;
    }
    pageToken = page.nextPageToken;
  } while (pageToken && fresh.length < cap);

  for (const f of fresh) {
    const dl = await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!dl.ok) { state.errors.push(`${f.id}: download ${dl.status}`); continue; }
    const bytes = Buffer.from(await dl.arrayBuffer());
    ingestOne(state, outDir, f.id, f.name, f.createdTime, bytes, f.md5Checksum || null);
  }
  return fresh.length;
}

function writeReport(outDir, state) {
  const manifest = Object.entries(state.processed).map(([id, e]) => ({ driveId: id, ...e }));
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const lines = ['# Spike labeling checklist', '', 'Fill `label` per row: `meal` or `notfood`.', ''];
  for (const m of manifest) lines.push(`- [ ] ${m.driveId} ${m.name || ''} (${m.createdTime || '?'}) gate=${m.gate}`);
  writeFileSync(join(outDir, 'contact.md'), lines.join('\n'));
}

function computeGates(outDir) {
  const manifest = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8'));
  const labeled = manifest.filter((m) => m.label === 'meal' || m.label === 'notfood');
  const unlabeled = manifest.length - labeled.length;
  const meals = labeled.filter((m) => m.label === 'meal').length;
  // Stub gate passes nothing, so leak/miss are measured against the P1 gate later.
  // Here: report labeling coverage + projected scout cost if all labeled meals ran.
  return { total: manifest.length, labeled: labeled.length, unlabeled, meals, gate: 'stub-unknown' };
}

function selftest() {
  // Proves sha256-map dedupe + gate math with zero network.
  const a = Buffer.from('photo-bytes-1');
  const b = Buffer.from('photo-bytes-1');
  const c = Buffer.from('photo-bytes-2');
  const seen = {};
  const results = [];
  for (const [id, buf] of [['f1', a], ['f2', b], ['f3', c]]) {
    const h = sha256(buf);
    if (seen[h]) { results.push([id, 'duplicate']); continue; }
    seen[h] = id;
    results.push([id, classifyFoodThumb(buf)]);
  }
  const ok = JSON.stringify(results) === JSON.stringify([['f1', 'unknown'], ['f2', 'duplicate'], ['f3', 'unknown']]);
  console.log(JSON.stringify({ selftest: ok ? 'PASS' : 'FAIL', results }));
  if (!ok) process.exit(1);
}

async function main() {
  if (flag('--selftest')) return selftest();
  const outDir = val('--out', 'spike-out/');
  mkdirSync(join(outDir, 'full'), { recursive: true });
  const statePath = join(outDir, 'state.json');
  const state = existsSync(statePath)
    ? JSON.parse(readFileSync(statePath, 'utf8'))
    : { processed: {}, shaSeen: {}, skippedNoMd5: [], errors: [] };

  if (flag('--gates')) {
    console.log(JSON.stringify(computeGates(outDir), null, 2));
    return;
  }
  const localDir = val('--local', null);
  if (localDir) {
    const n = await ingestLocal(localDir, Number(val('--cap', '30')), outDir, state);
    writeFileSync(statePath, JSON.stringify(state, null, 2));
    writeReport(outDir, state);
    console.log(JSON.stringify({ mode: 'local', ingested: n, processed: Object.keys(state.processed).length, errors: state.errors }));
    return;
  }
  const inboxId = process.env.DRIVE_INBOX_ID;
  const t0 = process.env.DRIVE_T0;
  if (!inboxId || !t0) throw new Error('missing DRIVE_INBOX_ID / DRIVE_T0');
  const token = await refreshAccessToken();
  const api = driveGet(token);
  const about = await api('about', { fields: 'storageQuota' });
  const q = about.storageQuota || {};
  const freeGB = q.limit ? (Number(q.limit) - Number(q.usage || 0)) / 1e9 : null;
  console.log(JSON.stringify({ quotaFreeGB: freeGB === null ? 'unknown' : +freeGB.toFixed(2) }));
  if (freeGB !== null && freeGB < 2) throw new Error(`stop rule: only ${freeGB.toFixed(2)} GB free (< 2 GB)`);
  const n = await pollInbox({ token, inboxId, t0, cap: Number(val('--cap', '30')), outDir, state });
  writeFileSync(statePath, JSON.stringify(state, null, 2));
  writeReport(outDir, state);
  console.log(JSON.stringify({ fetched: n, processed: Object.keys(state.processed).length, errors: state.errors }));
}

main().catch((e) => { console.error(`spike FAILED: ${e.message}`); process.exit(1); });
