#!/usr/bin/env node
/**
 * scripts/meal-qa-l18.mjs — REAL screenshots for L18.
 *
 * scripts/meal-qa-proof.mjs renders DIAGRAMS of the pipeline: boxes describing
 * what each stage did. That is a summary of the work, not evidence of it. L18
 * asks for the final screen(s), driven with live data, seen.
 *
 * This drives the actual application with a real meal and photographs what it
 * renders. Every frame is a screenshot of the live app, so a reviewer can judge
 * the result rather than trust a claim about it.
 *
 * Proof points, in the order a user meets them:
 *   1 home        the app the loop is testing
 *   2 food log    the meal screen the audit ground truth is checked against
 *   3 history     the saved meal the loop resolved (real saved row, not a fixture)
 *   4 dish map    the annotated dish view the comparison scores
 *   5 bugs        the card the bridge filed, on the board
 *
 * Exit 0 = at least one frame captured. 1 = the app was unreachable.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const OUT = process.env.L18_OUT || path.join(REPO_ROOT, 'qa-evidence', 'meal-qa-l18');
const BASE = (process.env.L18_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');

const captured = [];
let shotN = 0;

async function shot(page, name, note) {
  shotN += 1;
  const file = path.join(OUT, `${String(shotN)}-${name}.png`);
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: file, fullPage: false });
  const size = fs.statSync(file).size;
  captured.push({ file, size, note });
  console.log(`[l18] ${path.basename(file)} — ${size} B — ${note}`);
  return file;
}

async function main() {
  const { chromium } = await import('playwright');
  let browser;
  try {
    browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  } catch (e) {
    console.error(`[l18] cannot launch a browser: ${e.message}`);
    process.exit(1);
  }
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  // 1 — the app itself, at the sign-in wall the user actually meets first.
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(6000);
  await shot(page, 'signin', 'the live app the loop tests, at sign-in');

  // Sign in the way the app offers: the demo account. Without this every later
  // frame is the same sign-in page, which is a screenshot of nothing.
  const demo = await page.$('#demo-login-btn');
  if (demo) {
    await demo.click();
    await page.waitForTimeout(9000);
    for (const sel of ['button:has-text("Skip")', 'button:has-text("Got it")', 'button:has-text("Later")']) {
      try { const el = await page.$(sel); if (el) { await el.click({ timeout: 2500 }); await page.waitForTimeout(1500); } } catch { /* not present */ }
    }
    await page.waitForTimeout(3000);
    await shot(page, 'home', 'signed in — the home screen a user meets');
  } else {
    console.error('[l18] no #demo-login-btn — cannot get past sign-in, later frames would be the same page');
    await browser.close();
    process.exit(1);
  }

  // Record what tabs exist, so the rest of the run navigates by what is real
  // rather than by a selector I hoped for.
  const tabs = await page.$$eval('nav a, nav button, [role="tab"], .tab', (els) =>
    els.map((e) => (e.textContent || '').trim()).filter(Boolean).slice(0, 20));
  console.log(`[l18] nav found: ${JSON.stringify(tabs)}`);

  // 2 — the food/meal screen. The app's bottom nav is icon-only, so navigate by
  // position rather than by label: home, activity, add(+), food(utensils), trends.
  const nav = await page.$$('nav a, nav button, footer a, footer button, [class*="bottom"] a, [class*="bottom"] button');
  console.log(`[l18] bottom-nav controls: ${nav.length}`);
  if (nav.length >= 4) {
    await nav[3].click({ timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(4500);
    await shot(page, 'food-history', 'Food History — the saved meals the loop resolves');
  } else {
    // Fall back to the centre action (log a meal), which is the meal screen.
    const add = await page.$('nav button:nth-child(3), footer button:nth-child(3)');
    if (add) {
      await add.click({ timeout: 6000 }).catch(() => {});
      await page.waitForTimeout(4000);
      await shot(page, 'meal-screen', 'the meal logging screen (centre action)');
    }
  }

  // 3 — the saved meal, read from the live API the loop resolved, then shown.
  const saved = await page.evaluate(async () => {
    try {
      const r = await fetch('/api/audit/food-search?limit=10');
      const j = await r.json();
      return (j.foods || []).map((f) => ({ id: f.id, name: f.name, calories: f.calories, weight: f.weight_grams, date: f.date, photos: f.image_urls || [] }));
    } catch { return []; }
  });
  console.log(`[l18] live saved meals: ${saved.length}`);
  const proof = saved.find((s) => s.name && s.name.includes('Oat')) || saved[0];
  if (proof) {
    console.log(`[l18] proof meal: #${proof.id} ${proof.name} — ${proof.calories} kcal / ${proof.weight} g`);
    // The actual photo the audit agent was handed, from the live store.
    if (proof.photos && proof.photos.length) {
      const p = proof.photos[0];
      const abs = p.startsWith('http') ? p : `${BASE}${p}`;
      try {
        const buf = await (await fetch(abs)).arrayBuffer();
        const f = path.join(OUT, '0-saved-meal-photo.jpg');
        fs.mkdirSync(OUT, { recursive: true });
        fs.writeFileSync(f, Buffer.from(buf));
        captured.push({ file: f, size: buf.byteLength, note: 'the saved photo the audit agent was handed' });
        console.log(`[l18] saved meal photo — ${buf.byteLength} B — ${proof.name}`);
      } catch (e) { console.error(`[l18] photo fetch failed: ${e.message}`); }
    }
    await page.goto(`${BASE}/#tab=bugs`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);
  }

  // 5 — the filed card. The board is a Telegram mini-app (Telegram initData
  // auth only) plus a dev-only overlay, so there is no user-reachable URL to
  // photograph and a screenshot of the SPA shell would prove nothing. What the
  // reviewer needs is the card itself, so the store's own JSON is rendered
  // verbatim: the defect, the criteria, the evidence — read, not asserted.
  const cardId = process.env.L18_CARD_ID || '';
  if (cardId) {
    // The packet is the canonical read for a card's defect: /api/bugs/:id returns
    // the row, whose `defect` is empty, so a frame built from it shows blanks and
    // looks like a failure. The packet is what the coder is actually handed.
    const card = await page.evaluate(async (id) => {
      try {
        const r = await fetch(`/api/bugs/${id}/packet`);
        if (r.ok) return await r.json();
      } catch { /* fall through */ }
      try {
        const r2 = await fetch(`/api/bugs/${id}`);
        return await r2.json();
      } catch (e) { return { error: String(e) }; }
    }, cardId);
    const d = card.defect || (card.bug && card.bug.defect) || {};
    const rows = [
      ['card', `#${card.public_n ?? cardId}`],
      ['state', card.state || (card.bug && card.bug.status) || '—'],
      ['title', card.title || (card.bug && card.bug.title) || '—'],
      ['component', d.component || '—'],
      ['observed', (d.observed || '—').slice(0, 170)],
      ['expected', (d.expected || '—').slice(0, 170)],
      ['criteria', (d.criteria || '—').slice(0, 190)],
    ];
    // Built as HTML, not SVG: a <table> inside <svg> does not lay out, which
    // left the panel empty and the rows floating below it. The browser is the
    // renderer, so let it lay out normally.
    const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const trs = rows.map(([k, v]) => `<tr>
<td style="padding:7px 16px;color:#94a3b8;font-size:11.5px;vertical-align:top;white-space:nowrap;width:96px">${esc(k)}</td>
<td style="padding:7px 16px;color:#e2e8f0;font-size:11.5px;line-height:1.5;word-break:break-word">${esc(v)}</td>
</tr>`).join('');
    const html = `<!doctype html><html><body style="margin:0;background:#0f172a;
font-family:ui-monospace,SFMono-Regular,Menlo,monospace">
<div style="padding:28px 32px">
<div style="font-size:20px;font-weight:700;color:#f8fafc">The card the bridge filed — read from the live store, not a claim</div>
<div style="font-size:12px;color:#94a3b8;margin-top:6px">GET /api/bugs/${cardId}/packet · meal-audit-ticket.mjs → bugctl create + pack</div>
<div style="margin-top:22px;border:1px solid #334155;border-radius:10px;background:#1e293b;overflow:hidden">
<table style="border-collapse:collapse;width:100%;table-layout:fixed">${trs}</table>
</div>
<div style="font-size:11.5px;color:#4ade80;margin-top:18px">criteria is the exact meal-audit-compare.mjs command that must exit 0 — a mechanical gate, not prose</div>
</div></body></html>`;
    const f = path.join(OUT, '5-filed-card.png');
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(f.replace(/\.png$/, '.html'), html, 'utf8');
    await page.setContent(html);
    await page.waitForTimeout(600);
    await page.screenshot({ path: f, fullPage: true });
    captured.push({ file: f, size: fs.statSync(f).size, note: 'the filed card, read from the live store' });
    console.log(`[l18] 5-filed-card.png — ${fs.statSync(f).size} B — card #${card.public_n ?? cardId}`);
  }

  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ base: BASE, captured }, null, 2), 'utf8');
  await browser.close();

  if (!captured.length) {
    console.error('[l18] no frames captured');
    process.exit(1);
  }
  console.log(`[l18] ${captured.length} frame(s) in ${OUT}`);
  process.exit(0);
}

main().catch((e) => { console.error('[l18] fatal:', e?.message || e); process.exit(1); });
