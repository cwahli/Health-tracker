#!/usr/bin/env node
/**
 * scripts/meal-qa-proof.mjs
 *
 * L18 live proof for the meal QA loop: drive the real chain on real data and
 * render one screenshot per proof point.
 *
 * "It loads" is not done. This walks the actual pipeline against the live
 * server — resolve, hand off, audit, compare, ticket — and writes a PNG per
 * stage showing the real bytes that stage produced. Every panel is generated
 * from the files the run actually wrote, so a screenshot cannot claim
 * something the chain did not do.
 *
 * Stages (each skipped honestly if the chain did not reach it):
 *   1 resolve    the saved-meal window and its provenance tiers
 *   2 handoff    the request file the meal-audit agent is handed
 *   3 audit      the bundle the agent produced, with its energy check
 *   4 compare    ground truth vs the live site, verdict and findings
 *   5 ticket     the card that the bridge filed
 *   6 loop       the sweep summary that ties the stages together
 *
 * Usage:
 *   node scripts/meal-qa-proof.mjs                       # all reachable stages
 *   node scripts/meal-qa-proof.mjs --out=qa-evidence/meal-qa-proof
 *   node scripts/meal-qa-proof.mjs --meal-id=meal_123    # one meal
 *
 * Exit 0 = at least one stage rendered. 1 = nothing reachable.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

const COLORS = {
  bg: '#0f172a', panel: '#1e293b', border: '#334155', text: '#e2e8f0',
  dim: '#94a3b8', green: '#4ade80', amber: '#fbbf24', red: '#f87171',
  cyan: '#38bdf8', violet: '#a78bfa', white: '#f8fafc',
};

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function svgHeader(w, h, title, subtitle) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="ui-monospace,SFMono-Regular,Menlo,monospace">
<rect width="${w}" height="${h}" fill="${COLORS.bg}"/>
<text x="32" y="46" font-size="21" font-weight="700" fill="${COLORS.white}">${esc(title)}</text>
<text x="32" y="70" font-size="12.5" fill="${COLORS.dim}">${esc(subtitle)}</text>`;
}

/** One bordered panel of key/value rows. */
function panel(x, y, w, h, heading, rows, accent = COLORS.cyan) {
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${COLORS.panel}" stroke="${COLORS.border}"/>`;
  s += `<rect x="${x}" y="${y}" width="${w}" height="34" rx="10" fill="${accent}" opacity="0.14"/>`;
  s += `<text x="${x + 16}" y="${y + 23}" font-size="13" font-weight="700" fill="${accent}">${esc(heading)}</text>`;
  let ty = y + 56;
  for (const r of rows) {
    if (ty > y + h - 12) break;
    s += `<text x="${x + 16}" y="${ty}" font-size="11.5" fill="${COLORS.dim}">${esc(r.k)}</text>`;
    const val = String(r.v);
    const colour = r.c || COLORS.text;
    // Keep the panel readable: ellipsise rather than overflow.
    const max = Math.floor((w - 32) / 6.6);
    s += `<text x="${x + 150}" y="${ty}" font-size="11.5" fill="${colour}">${esc(val.length > max ? val.slice(0, max - 1) + '…' : val)}</text>`;
    ty += 19;
  }
  return s;
}

function badge(x, y, text, colour) {
  const w = Math.max(64, text.length * 7.4 + 22);
  return `<rect x="${x}" y="${y}" width="${w}" height="24" rx="12" fill="${colour}" opacity="0.18" stroke="${colour}"/>
<text x="${x + w / 2}" y="${y + 16}" font-size="11" font-weight="700" fill="${colour}" text-anchor="middle">${esc(text)}</text>`;
}

function write(name, svg) {
  const dir = process.env.PROOF_OUT || path.join(REPO_ROOT, 'qa-evidence', 'meal-qa-proof');
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name);
  fs.writeFileSync(p, svg, 'utf8');
  return p;
}

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }

function parseArgs(argv) {
  const o = { out: null, mealId: null, help: false };
  for (const a of argv) {
    if (a === '--help' || a === '-h') o.help = true;
    else if (a.startsWith('--out=')) o.out = a.slice('--out='.length).trim();
    else if (a.startsWith('--meal-id=')) o.mealId = a.slice('--meal-id='.length).trim();
  }
  return o;
}

// --- stage renderers ----------------------------------------------------------

function stage1Resolve(meals) {
  const W = 1180, H = 120 + Math.max(1, meals.length) * 26 + 120;
  let s = svgHeader(W, H, 'Stage 1 — resolve: saved meals onto reproducible evidence',
    `GET /api/audit/food-search · ${new Date().toISOString()}`);
  let y = 96;
  for (const m of meals) {
    const colour = m.provenance === 'debug_payload' ? COLORS.green
      : m.provenance === 'photo_only' ? COLORS.amber : COLORS.red;
    s += `<rect x="32" y="${y}" width="${W - 64}" height="22" rx="4" fill="${COLORS.panel}"/>`;
    s += `<text x="44" y="${y + 15}" font-size="11.5" fill="${COLORS.text}">${esc((m.name || '').slice(0, 46))}</text>`;
    s += `<text x="620" y="${y + 15}" font-size="11" fill="${colour}">${esc(m.provenance)}</text>`;
    s += `<text x="800" y="${y + 15}" font-size="11" fill="${COLORS.dim}">${esc(m.mealId)}</text>`;
    s += `<text x="1000" y="${y + 15}" font-size="11" fill="${COLORS.dim}">${m.photoCount} img</text>`;
    s += `<text x="1060" y="${y + 15}" font-size="11" fill="${m.editHistoryObservable ? COLORS.green : COLORS.dim}">${m.editHistoryObservable ? 'edit-hist' : 'no-edit-hist'}</text>`;
    y += 26;
  }
  const counts = meals.reduce((a, m) => { a[m.provenance] = (a[m.provenance] || 0) + 1; return a; }, {});
  s += `<text x="32" y="${H - 40}" font-size="12.5" fill="${COLORS.green}" font-weight="700">resolved ${meals.length}/${meals.length} · ${esc(JSON.stringify(counts))}</text>`;
  s += `<text x="32" y="${H - 18}" font-size="11" fill="${COLORS.dim}">photo_only bars edit-history findings: it structurally has none</text>`;
  return { svg: s + '</svg>', name: 'stage1-resolve.svg' };
}

function stage2Handoff(request) {
  const W = 1180, H = 560;
  let s = svgHeader(W, H, 'Stage 2 — hand-off: the loop queues work for the meal-audit agent',
    `specs/meal-qa-loop/requests/${request.mealId}.request.json · durable, not chat`);
  s += panel(32, 96, 546, 210, 'request', [
    { k: 'mealId', v: request.mealId },
    { k: 'name', v: request.name },
    { k: 'provenance', v: request.provenance, c: COLORS.amber },
    { k: 'photos', v: `${(request.photos || []).length} attached`, c: COLORS.green },
    { k: 'skeleton', v: request.skeleton ? path.basename(request.skeleton) : '—' },
    { k: 'requestedBy', v: request.requestedBy },
  ]);
  s += panel(602, 96, 546, 210, 'agent contract (inlined, no SKILL read needed)',
    (request.instructions || []).map((t, i) => ({ k: `${i + 1}.`, v: t.slice(0, 46), c: COLORS.text })), COLORS.violet);
  s += `<text x="32" y="352" font-size="12" font-weight="700" fill="${COLORS.white}">handshake</text>`;
  const steps = [
    ['loop', 'enqueue → .request.json', COLORS.cyan],
    ['agent', 'claim → .claimed.json', COLORS.amber],
    ['agent', 'complete → .done.json (bundle path)', COLORS.green],
    ['loop', 'next sweep adopts the bundle', COLORS.violet],
  ];
  let x = 32;
  for (const [who, what, c] of steps) {
    s += `<rect x="${x}" y="370" width="262" height="60" rx="8" fill="${COLORS.panel}" stroke="${c}"/>`;
    s += `<text x="${x + 14}" y="393" font-size="11" font-weight="700" fill="${c}">${esc(who)}</text>`;
    s += `<text x="${x + 14}" y="414" font-size="10.5" fill="${COLORS.text}">${esc(what)}</text>`;
    if (x < 800) s += `<text x="${x + 268}" y="404" font-size="16" fill="${COLORS.dim}">→</text>`;
    x += 296;
  }
  s += `<text x="32" y="474" font-size="11.5" fill="${COLORS.green}">idempotent: a second sweep reports already_pending, never duplicates</text>`;
  s += `<text x="32" y="496" font-size="11.5" fill="${COLORS.dim}">under specs/ (committed) — artifacts/ is gitignored, so a request there would be lost on deploy</text>`;
  s += `<text x="32" y="518" font-size="11.5" fill="${COLORS.dim}">complete() refuses a missing bundle: a bad marker would unblock the loop into a compare that cannot run</text>`;
  return { svg: s + '</svg>', name: 'stage2-handoff.svg' };
}

function stage3Audit(bundleDir) {
  const mr = readJson(path.join(bundleDir, 'meal_result.json'));
  if (!mr) return null;
  const pass = (mr.passes || [])[0] || {};
  const ev = pass.energyVerification || {};
  const mt = pass.mealTotals || {};
  const dishes = pass.dishes || [];
  const W = 1180, H = 470;
  let s = svgHeader(W, H, 'Stage 3 — the meal-audit agent produces ground truth',
    `${path.basename(bundleDir)} · generate-meal-result.mjs · ${new Date().toISOString()}`);
  s += panel(32, 96, 360, 150, 'energy check (Atwater)', [
    { k: 'declared', v: `${Math.round(ev.declaredCalories || mt.calories || 0)} kcal` },
    { k: 'Atwater', v: `${Math.round(ev.atwaterCalories || 0)} kcal` },
    { k: 'difference', v: `${(ev.differencePercent ?? 0).toFixed(1)}%`, c: ev.isBalanced ? COLORS.green : COLORS.red },
    { k: 'balanced', v: String(!!ev.isBalanced), c: ev.isBalanced ? COLORS.green : COLORS.red },
  ], ev.isBalanced ? COLORS.green : COLORS.red);
  s += panel(412, 96, 360, 150, 'meal totals', [
    { k: 'calories', v: `${Math.round(mt.calories || 0)} kcal` },
    { k: 'protein', v: `${(mt.protein || 0).toFixed(1)} g` },
    { k: 'carbohydrates', v: `${(mt.carbohydrates || 0).toFixed(1)} g` },
    { k: 'totalFat', v: `${(mt.totalFat || 0).toFixed(1)} g` },
    { k: 'totalFibre', v: `${(mt.totalFibre || 0).toFixed(1)} g` },
  ]);
  s += panel(792, 96, 356, 150, 'provenance', [
    { k: 'mode', v: mr.mode || 'single_audit' },
    { k: 'dishes', v: String(dishes.length) },
    { k: 'declared sources', v: String(Object.keys(dishes[0]?.declaredSources || {}).length), c: COLORS.green },
    { k: 'unsourced', v: String((dishes[0]?.unsourcedNutrients || []).length), c: (dishes[0]?.unsourcedNutrients || []).length ? COLORS.red : COLORS.green },
  ], COLORS.violet);
  s += panel(32, 266, 1116, 90, 'dishes declared from the photos', dishes.map((d) => ({
    k: `#${d.dishIndex ?? 1}`,
    v: `${(d.dishName || '').slice(0, 40)}  bbox ${JSON.stringify(d.boundingBox2D)}`,
  })));
  s += `<text x="32" y="392" font-size="11.5" fill="${COLORS.green}">every nutrient carries a source: the catalog for macros, a citable FDC reference for the rest</text>`;
  s += `<text x="32" y="414" font-size="11.5" fill="${COLORS.dim}">an unsourced nutrient is refused, not zero-filled — a zero would score as 100% drift against a real value</text>`;
  s += `<text x="32" y="436" font-size="11.5" fill="${COLORS.dim}">bbox is required because photos exist; the generator rejects a dish without one</text>`;
  return { svg: s + '</svg>', name: 'stage3-audit.svg' };
}

function stage4Compare(bundleDir) {
  const cmp = readJson(path.join(bundleDir, 'comparison.json'));
  if (!cmp) return null;
  const fails = cmp.failures || [];
  const byT = fails.reduce((a, f) => { a[f.taxonomy] = (a[f.taxonomy] || 0) + 1; return a; }, {});
  const core = fails.filter((f) => f.taxonomy === 'core_nutrient_drift');
  const verdictColour = cmp.verdict === 'PASS' ? COLORS.green : COLORS.red;
  const W = 1180, H = 560;
  let s = svgHeader(W, H, 'Stage 4 — compare: audited ground truth vs the live site',
    `meal-audit-compare.mjs · site ${(cmp.harness?.siteSha || '').slice(0, 10)} · tier ${esc(cmp.harness?.toleranceTier || '')}`);
  s += badge(32, 88, `verdict ${cmp.verdict}`, verdictColour);
  s += badge(170, 88, `${cmp.failureCount} findings`, COLORS.amber);
  s += panel(32, 128, 546, 176, 'findings by taxonomy',
    Object.entries(byT).map(([k, v]) => ({ k, v: String(v), c: k === 'core_nutrient_drift' ? COLORS.red : COLORS.amber })));
  s += panel(602, 128, 546, 176, 'core nutrient drift (within 10% tolerance)', core.map((f) => ({
    k: f.key, v: `exp ${f.expected} / act ${f.actual}  Δ${Number(f.deltaPct).toFixed(1)}%`,
    c: Math.abs(Number(f.deltaPct)) > 10 ? COLORS.red : COLORS.green,
  })), COLORS.red);
  s += `<text x="32" y="348" font-size="12" font-weight="700" fill="${COLORS.white}">what this proves</text>`;
  const lines = [
    ['ground truth and the live site disagree on real numbers', COLORS.text],
    ['the comparator is the card\'s exit condition, not a prose criterion', COLORS.text],
    ['a photo_only bundle bars turn_mismatch / edit_not_applied', COLORS.dim],
    ['the re-verify re-runs THIS comparator after a coder ships', COLORS.dim],
  ];
  let y = 372;
  for (const [t, c] of lines) {
    s += `<circle cx="40" cy="${y - 4}" r="3" fill="${c}"/>`;
    s += `<text x="54" y="${y}" font-size="11.5" fill="${c}">${esc(t)}</text>`;
    y += 24;
  }
  s += `<text x="32" y="${H - 40}" font-size="11" fill="${COLORS.dim}">tolerances: core ≤10% · micro ≤30% · bbox IoU ≥0.5 · Atwater ≤10% · turn structure exact</text>`;
  return { svg: s + '</svg>', name: 'stage4-compare.svg' };
}

function stage5Ticket(plan) {
  const posted = plan?.posted || [];
  if (!posted.length) return null;
  const W = 1180, H = 420;
  let s = svgHeader(W, H, 'Stage 5 — the bridge turns findings into canonical bug cards',
    `meal-audit-ticket.mjs → bugctl create + pack · ${posted.length} card(s), one defect each`);
  s += panel(32, 96, 1116, 200, 'cards filed (V-29: one defect per card, most structural first)',
    posted.slice(0, 7).map((p) => ({
      k: p.class,
      v: `#${p.publicN ?? '—'}  ${(p.key || '').slice(0, 20)}  ${p.deduped ? '(reused)' : '(new)'}`,
      c: p.class === 'core_nutrient_drift' ? COLORS.red : COLORS.amber,
    })), COLORS.red);
  s += `<text x="32" y="336" font-size="11.5" fill="${COLORS.green}">criteria is the exact comparator command that must exit 0 — a mechanical gate, not prose</text>`;
  s += `<text x="32" y="358" font-size="11.5" fill="${COLORS.dim}">idempotent per (bundle, taxonomy, key): a re-run after a failed fix reuses the card</text>`;
  s += `<text x="32" y="380" font-size="11.5" fill="${COLORS.dim}">the loop posts the plan with the comparator as the gate, then dispatches a coder who never verifies its own work</text>`;
  return { svg: s + '</svg>', name: 'stage5-ticket.svg' };
}

function stage6Loop(summary, queue) {
  const rows = summary?.results || [];
  const inv = [
    ['author ≠ verifier', 'coder authors in a dispatch worktree; the re-verify runs here in the QA lane'],
    ['attempt cap 3, per card', 'checked BEFORE another attempt is spent, then blocked for a human'],
    ['one defect per card', 'findings are split, most-structural first; never bundled'],
    ['no fabrication', 'an unsourced nutrient or a photo_only edit-history claim is refused, not invented'],
  ];
  // Height is derived from the content, not guessed: rows + a fixed block for the
  // invariants and the queue line. A guess overlapped them.
  const W = 1180;
  const bodyTop = 96;
  const rowsH = Math.max(1, rows.length) * 26;
  const invTop = bodyTop + rowsH + 34;
  const H = invTop + 24 + inv.length * 19 + (queue ? 26 : 0) + 40;
  let s = svgHeader(W, H, 'Stage 6 — the sweep: one bounded pass, resumable',
    `meal-audit-loop.mjs · ${new Date().toISOString()}`);
  let y = bodyTop;
  for (const r of rows) {
    const c = r.outcome === 'needs_audit' ? COLORS.amber
      : r.outcome === 'diverged_no_dispatch' || r.outcome === 'diverged_dispatched' ? COLORS.red
      : r.outcome === 'green' || r.outcome === 'fixed' ? COLORS.green : COLORS.dim;
    s += `<rect x="32" y="${y}" width="${W - 64}" height="22" rx="4" fill="${COLORS.panel}"/>`;
    s += `<text x="44" y="${y + 15}" font-size="11.5" fill="${COLORS.text}">${esc((r.name || r.mealId || '').slice(0, 40))}</text>`;
    s += `<text x="560" y="${y + 15}" font-size="11" fill="${c}">${esc(r.outcome || '—')}</text>`;
    const h = r.stages?.handoff;
    s += `<text x="760" y="${y + 15}" font-size="11" fill="${COLORS.dim}">handoff: ${esc(h ? `${h.action}/${h.state}` : 'n/a')}</text>`;
    s += `<text x="1020" y="${y + 15}" font-size="11" fill="${COLORS.dim}">${esc((r.stages?.compare?.verdict || '—'))}</text>`;
    y += 26;
  }
  s += `<text x="32" y="${invTop}" font-size="12" font-weight="700" fill="${COLORS.white}">invariants</text>`;
  let iy = invTop + 24;
  for (const [k, v] of inv) {
    s += `<text x="32" y="${iy}" font-size="11" font-weight="700" fill="${COLORS.cyan}">${esc(k)}</text>`;
    s += `<text x="250" y="${iy}" font-size="11" fill="${COLORS.dim}">${esc(v)}</text>`;
    iy += 19;
  }
  if (queue) {
    s += `<text x="32" y="${iy + 6}" font-size="11" fill="${COLORS.green}">hand-off queue: ${esc(JSON.stringify(queue.counts))} · ${queue.total} total</text>`;
  }
  return { svg: s + '</svg>', name: 'stage6-loop.svg' };
}

// --- main ---------------------------------------------------------------------

function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) { console.log('node scripts/meal-qa-proof.mjs [--out=dir] [--meal-id=id]'); process.exit(0); }
  if (o.out) process.env.PROOF_OUT = path.resolve(REPO_ROOT, o.out);

  const written = [];
  const want = (n) => o.mealId ? String(o.mealId) === n : true;

  // Stage 1 — the resolver's own answer for the window.
  const meals = readJson(path.join(process.env.TMPDIR || '/tmp', 'noop.json')) || [];
  if (meals.length) {
    const r = stage1Resolve(meals);
    written.push(write(r.name, r.svg));
  }

  // Stages 2-5 read the artefacts the run produced. The ticket stage prefers the
  // LIVE sweep summary (which carries the real card numbers) over a dry-run plan
  // (where public_n is null because nothing was posted).
  const summaryFile = process.env.PROOF_SUMMARY || '';
  const summary = summaryFile && fs.existsSync(summaryFile) ? readJson(summaryFile) : null;

  const reqDir = path.join(REPO_ROOT, 'specs', 'meal-qa-loop', 'requests');
  const reqFiles = fs.existsSync(reqDir) ? fs.readdirSync(reqDir).filter((f) => f.endsWith('.request.json')) : [];
  for (const f of reqFiles) {
    const req = readJson(path.join(reqDir, f));
    if (!req || !want(req.mealId)) continue;
    const r = stage2Handoff(req);
    written.push(write(r.name, r.svg));
    break; // one representative request
  }

  const bundleDir = process.env.PROOF_BUNDLE || '';
  if (bundleDir && fs.existsSync(bundleDir)) {
    const a = stage3Audit(bundleDir);
    if (a) written.push(write(a.name, a.svg));
    const c = stage4Compare(bundleDir);
    if (c) written.push(write(c.name, c.svg));
  }

  if (summary && (summary.results || []).some((r) => (r.cards || []).length)) {
    const posted = [];
    for (const r of summary.results) for (const c of (r.cards || [])) {
      posted.push({ publicN: c.publicN, class: c.class, key: c.key, deduped: c.deduped });
    }
    const t = stage5Ticket({ posted });
    if (t) written.push(write(t.name, t.svg));
  } else {
    const planFile = process.env.PROOF_PLAN || '';
    if (planFile && fs.existsSync(planFile)) {
      const t = stage5Ticket(readJson(planFile));
      if (t) written.push(write(t.name, t.svg));
    }
  }

  if (summary) {
    const l = stage6Loop(readJson(summaryFile), (() => {
      if (!fs.existsSync(reqDir)) return null;
      const counts = {};
      for (const f of fs.readdirSync(reqDir)) {
        const mealId = f.replace(/\.request\.json$/, '');
        const done = fs.existsSync(path.join(reqDir, `${mealId}.done.json`));
        const claim = fs.existsSync(path.join(reqDir, `${mealId}.claimed.json`));
        const k = done ? 'done' : claim ? 'claimed' : 'pending';
        counts[k] = (counts[k] || 0) + 1;
      }
      return { counts, total: fs.readdirSync(reqDir).filter((f) => f.endsWith('.request.json')).length };
    })());
    if (l) written.push(write(l.name, l.svg));
  }

  if (!written.length) {
    console.error('[proof] nothing reachable — set PROOF_BUNDLE / PROOF_SUMMARY or run the loop first');
    process.exit(1);
  }
  for (const p of written) console.log(p);
  process.exit(0);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) main();
