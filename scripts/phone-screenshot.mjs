#!/usr/bin/env node
/**
 * scripts/phone-screenshot.mjs
 *
 * Pull the phone's own images off the live deploy into this box, so a phone
 * screenshot is readable here without the phone, without Telegram, and
 * without R2 credentials.
 *
 * Why this exists: the phone uploads to R2 (photos/, bugs/<cat>/<tagId>/...).
 * A key alone is not enough because there is no list route, and a host path
 * is not portable (see qa-reproduce/SKILL.md). So we read the one
 * unauthenticated route that already orders by recency --
 * GET /api/admin/meals-with-photos -- then fetch each key off the public
 * bucket. The bucket is public-read, so no secret is needed on this side.
 *
 * Usage:
 *   node scripts/phone-screenshot.mjs                       # 5 newest phone photos
 *   node scripts/phone-screenshot.mjs --kind=bug            # bug-report screenshots
 *   node scripts/phone-screenshot.mjs --n=12 --json          # more, plus a manifest
 *   node scripts/phone-screenshot.mjs --key=photos/x.jpg     # one known key
 *   node scripts/phone-screenshot.mjs --url=http://localhost:3000
 *
 * Two kinds, because there are two different things a phone produces:
 *   meal = a photo of the food, uploaded as part of logging it
 *   bug  = a screenshot of the app, attached when reporting a bug
 * Both end up in R2, under different keys, reached through different routes.
 *
 * Exit 0 = at least one image written. Exit 1 = nothing reachable.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? 'true'] : [a, 'true'];
  })
);

const baseUrl = (args.url || 'https://health-tracker.co.uk').replace(/\/$/, '');
const outDir = path.resolve(REPO_ROOT, args.out || 'qa-evidence/phone');
const wantJson = args.json === 'true';
const DEFAULT_N = 5;

function fail(msg) {
  console.error(`phone-screenshot: ${msg}`);
  process.exit(1);
}

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(Number(args.timeout || 45000)) });
  if (!res.ok) fail(`GET ${url} -> HTTP ${res.status}`);
  return res.json();
}

async function getBuffer(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(Number(args.timeout || 45000)) });
  if (!res.ok) return { ok: false, status: res.status };
  const type = res.headers.get('content-type') || '';
  if (!type.startsWith('image/')) return { ok: false, status: res.status, type };
  return { ok: true, type, buf: Buffer.from(await res.arrayBuffer()) };
}

/** A relative "/photos/<key>" must go to the deploy; an absolute r2.dev URL must not. */
function absoluteUrl(u) {
  if (/^https?:\/\//i.test(u)) return u;
  return `${baseUrl}${u.startsWith('/') ? '' : '/'}${u}`;
}

function safeName(s) {
  return String(s || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'untitled';
}

async function fetchOne(key, meal) {
  const url = absoluteUrl(key);
  const got = await getBuffer(url);
  if (!got.ok) return { key, url, ok: false, status: got.status };
  const ext = (got.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg').replace('+xml', '');
  const stamp = (meal?.date || '').replace(/-/g, '');
  const file = `${String(meal?._i ?? 0).padStart(2, '0')}${stamp ? `-${stamp}` : ''}-${safeName(meal?.name || key.split('/').pop())}.${ext}`;
  const full = path.join(outDir, file);
  fs.writeFileSync(full, got.buf);
  return { key, url, ok: true, file: path.relative(REPO_ROOT, full), bytes: got.buf.length, date: meal?.date || null, name: meal?.name || null };
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });

  if (args.key) {
    const r = await fetchOne(args.key, { _i: 1, date: new Date().toISOString().slice(0, 10) });
    if (!r.ok) fail(`could not read ${r.url} (HTTP ${r.status})`);
    console.log(`${r.bytes} bytes -> ${r.file}`);
    return;
  }

  const n = Math.max(1, Math.min(50, Number(args.n || DEFAULT_N)));
  const kind = String(args.kind || 'meal');
  if (kind === 'bug') return await runBugKind({ baseUrl, outDir, n, wantJson });
  if (kind !== 'meal') fail(`unknown --kind=${kind} (expected meal|bug)`);

  const data = await getJson(`${baseUrl}/api/admin/meals-with-photos`);
  const meals = (data.meals || []).filter((m) => m.imageUrl);
  if (!meals.length) fail(`${baseUrl} returned no meals with photos`);

  const picked = meals.slice(0, n);
  const rows = [];
  for (const [i, m] of picked.entries()) {
    m._i = i + 1;
    const r = await fetchOne(m.imageUrl, m);
    rows.push(r);
    console.log(
      r.ok
        ? `${r.date}  ${String(r.bytes).padStart(7)} B  ${r.file}`
        : `${m.date || '?'}  FAILED HTTP ${r.status}  ${m.imageUrl}`
    );
  }

  const ok = rows.filter((r) => r.ok);
  if (wantJson) {
    const manifest = { source: baseUrl, fetched_at: new Date().toISOString(), count: ok.length, shots: ok };
    const mf = path.join(outDir, 'manifest.json');
    fs.writeFileSync(mf, JSON.stringify(manifest, null, 2));
    console.log(`\nmanifest -> ${path.relative(REPO_ROOT, mf)}`);
  }
  console.log(`\n${ok.length}/${rows.length} phone image(s) in ${path.relative(REPO_ROOT, outDir)}/`);
  if (!ok.length) fail('no image could be fetched');
}

/**
 * Bug screenshots: the images a user attached when reporting a bug, which for a
 * phone user is a screenshot of the app itself.
 *
 * These live under bugs/<category>/<tagId>/reports/<reportId>/shot-NN.jpg and
 * there was no way to find them: shot_count lived only on a report row, so
 * listing a bug never mentioned a screenshot, and the artifacts route needs a
 * tagId + reportId + exact filename. `?with_shots=1` on the list route is the
 * one query that yields all three. Note the artifact route is binary-safe and
 * streams bytes, unlike a raw r2.dev key which is not guaranteed public.
 */
async function runBugKind({ baseUrl, outDir, n, wantJson }) {
  const data = await getJson(`${baseUrl}/api/bugs/list?with_shots=1`);
  const withShots = (data.rows || []).filter((r) => (r.shot_count || 0) > 0);
  if (!withShots.length) {
    console.log(`no bug on ${baseUrl} has an attached screenshot yet`);
    if (wantJson) {
      fs.writeFileSync(
        path.join(outDir, 'manifest.json'),
        JSON.stringify({ source: baseUrl, fetched_at: new Date().toISOString(), count: 0, shots: [] }, null, 2)
      );
    }
    return;
  }
  const rows = [];
  let i = 0;
  for (const bug of withShots.slice(0, n)) {
    for (const shot of bug.shots || []) {
      i += 1;
      const label = { _i: i, date: (bug.updated_at || bug.created_at || '').slice(0, 10), name: bug.title };
      const url = `${baseUrl}/api/bugs/${encodeURIComponent(bug.tag_id)}/artifacts?reportId=${encodeURIComponent(
        shot.report_id
      )}&name=${encodeURIComponent(shot.name)}${shot.key ? `&key=${encodeURIComponent(shot.key)}` : ''}`;
      const got = await getBuffer(url);
      if (!got.ok) {
        console.log(`${label.date}  FAILED HTTP ${got.status}  ${bug.tag_id} ${shot.name}`);
        rows.push({ ok: false, status: got.status, tag_id: bug.tag_id, ...shot });
        continue;
      }
      const file = `${String(i).padStart(2, '0')}${label.date ? `-${label.date}` : ''}-bug-${safeName(
        bug.title || bug.tag_id
      )}-${shot.name}`;
      const full = path.join(outDir, file);
      fs.writeFileSync(full, got.buf);
      const row = {
        ok: true,
        tag_id: bug.tag_id,
        title: bug.title,
        state: bug.state,
        ...shot,
        url,
        file: path.relative(REPO_ROOT, full),
        bytes: got.buf.length,
      };
      rows.push(row);
      console.log(`${label.date || '?'}  ${String(got.buf.length).padStart(7)} B  ${row.file}`);
    }
  }
  const ok = rows.filter((r) => r.ok);
  if (wantJson) {
    const mf = path.join(outDir, 'manifest.json');
    fs.writeFileSync(
      mf,
      JSON.stringify({ source: baseUrl, kind: 'bug', fetched_at: new Date().toISOString(), count: ok.length, shots: ok }, null, 2)
    );
    console.log(`\nmanifest -> ${path.relative(REPO_ROOT, mf)}`);
  }
  console.log(`\n${ok.length}/${rows.length} bug screenshot(s) in ${path.relative(REPO_ROOT, outDir)}/`);
  if (!ok.length) fail('no bug screenshot could be fetched');
}

main().catch((e) => fail(e?.message || String(e)));
