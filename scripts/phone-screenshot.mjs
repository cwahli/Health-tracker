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
 *   node scripts/phone-screenshot.mjs --n=12 --json          # more, plus a manifest
 *   node scripts/phone-screenshot.mjs --key=photos/x.jpg     # one known key
 *   node scripts/phone-screenshot.mjs --url=http://localhost:3000
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

const baseUrl = (args.url || 'https://health-tracking.duckdns.org').replace(/\/$/, '');
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

main().catch((e) => fail(e?.message || String(e)));
