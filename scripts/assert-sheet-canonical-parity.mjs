#!/usr/bin/env node
/**
 * assert-sheet-canonical-parity — the sheet must not outrun the store.
 *
 * Measured 2026-10-09. Seven of the ten `card:tag_*` rows on `current`
 * named cards absent from `bugctl list` (Meal-35/36/37, Stew-01, Bug-59,
 * Bug-58/57, Bug-55) — sheet states like `in_fix`, `packed`, even `done`
 * with no canonical card behind them. Where cards did exist, the sheet
 * disagreed with the store (Bug-2: sheet `new`, store `in_fix`;
 * Bug-53: sheet `new`, store `packed`). The pipeline derives state from
 * artifacts server-side (`bugState()`); the sheet's hand-typed Status is
 * a shadow state machine that drifted.
 *
 * Rules (read-only — this sensor writes nothing):
 *  1. Every `card:tag_*` key on `current` must exist in `bugctl list`.
 *  2. A sheet `done` requires canonical `done` (verify green). A `done`
 *     with no canonical card — or a non-done canonical state — fails.
 *  3. For mapped states (new/packed/in_fix/verifying/done), sheet and
 *     canonical must agree. Unmapped sheet vocab (open/locked/draft/…)
 *     is existence-checked only, never failed.
 *
 * Live sections need `bugctl` on PATH and a Google identity for the
 * sheet read; either missing SKIPs honestly after the fixtures run.
 *
 * Run: node scripts/assert-sheet-canonical-parity.mjs
 * Exit 0: all green (or live skipped). Exit 1: at least one FAIL.
 */

import { execFileSync } from 'node:child_process';
import {
  getReviewContext,
  readCurrentRows,
  mapReviewRow,
  resetReviewState,
} from './lib/review-status.mjs';

let passed = 0;
let failed = 0;
let skipped = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};
const note = (msg) => { skipped += 1; console.log(`  SKIP  ${msg}`); };

/** Canonical pipeline order. Unmapped vocab returns null (check skips). */
export function stateRank(state) {
  const s = String(state || '').trim().toLowerCase();
  if (s === 'new') return 0;
  if (s === 'packed' || s === 'needs_repro') return 1;
  if (s === 'reproduced' || s === 'planned') return 2;
  if (s === 'in_fix') return 3;
  if (s === 'verifying') return 4;
  if (s === 'done') return 5;
  return null;
}

export const isCardKey = (key) => String(key || '').startsWith('card:tag_');

/**
 * Raw cell by header name. The review projection (`mapReviewRow`) does not
 * carry `state`, so parity reads the row itself — `item.state` is always
 * undefined (same trap as assert-sheet-proof's first version).
 */
export function cellByName(vals, header, name) {
  const c = header.indexOf(String(name).toLowerCase());
  return c >= 0 && vals[c] !== undefined ? String(vals[c]) : '';
}

/**
 * Pure verdict for one sheet row against the canonical map
 * (bare tag_id -> {state}). Sheet keys carry a `card:` prefix the store
 * does not (2026-10-09: the first version compared prefixed against bare
 * and reported every card missing, including Bug-2 which exists).
 * Returns {ok, reason, checked} where checked=false means "not
 * applicable" (not a card row / unmapped vocab).
 */
export function verdictForKey(item, canonByTag) {
  if (!isCardKey(item.key)) return { ok: true, reason: '', checked: false };
  const tag = String(item.key).replace(/^card:/, '');
  const canon = canonByTag.get(tag);
  if (!canon) return { ok: false, reason: `sheet state=${item.state || '?'} but ${tag} missing from bugctl`, checked: true };
  const sheetRank = stateRank(item.state);
  const canonRank = stateRank(canon.state);
  if (sheetRank === 5 && canonRank !== 5) {
    return { ok: false, reason: `sheet done but canonical state=${canon.state || '?'}`, checked: true };
  }
  if (sheetRank === null || canonRank === null) return { ok: true, reason: '', checked: false };
  if (sheetRank !== canonRank) {
    return { ok: false, reason: `sheet ${item.state} but canonical ${canon.state}`, checked: true };
  }
  return { ok: true, reason: '', checked: true };
}

function readBugctlList() {
  try {
    const out = execFileSync('bugctl', ['list', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const parsed = JSON.parse(out);
    const rows = parsed && Array.isArray(parsed.rows) ? parsed.rows : [];
    return { ok: true, rows };
  } catch (err) {
    return { ok: false, reason: `bugctl list failed: ${String(err && err.message || err).slice(0, 160)}` };
  }
}

console.log('assert-sheet-canonical-parity:');

// ---------------------------------------------------------------------------
// 1. Fixtures — deterministic. The 2026-10-09 production rows, replayed.
// ---------------------------------------------------------------------------

{
  // Canonical ids are bare; sheet keys carry `card:`. Fixtures mirror that.
  const canon = new Map([
    ['tag_muwyto2i_lv3uyw', { state: 'in_fix' }],
    ['tag_muxcn960_px5wm4', { state: 'packed' }],
  ]);
  const meal36 = { key: 'card:tag_mupd6fhn_g62r4n', state: 'done' };
  const v = verdictForKey(meal36, canon);
  check('sheet done with no canonical card fails (Meal-36)', !v.ok, v.reason);

  const bug2 = { key: 'card:tag_muwyto2i_lv3uyw', state: 'new' };
  const v2 = verdictForKey(bug2, canon);
  check('sheet behind canonical fails (Bug-2 new vs in_fix)', !v2.ok, v2.reason);

  const bug53 = { key: 'card:tag_muxcn960_px5wm4', state: 'new' };
  const v3 = verdictForKey(bug53, canon);
  check('sheet behind canonical fails (Bug-53 new vs packed)', !v3.ok, v3.reason);

  const agree = { key: 'card:tag_muwyto2i_lv3uyw', state: 'in_fix' };
  const v4 = verdictForKey(agree, canon);
  check('matching states pass', v4.ok && v4.checked, v4.reason);

  const spec = { key: 'spec:X-1', state: 'locked' };
  const v5 = verdictForKey(spec, canon);
  check('non-card keys are out of scope', v5.ok && !v5.checked, v5.reason);

  const unmapped = { key: 'card:tag_muwyto2i_lv3uyw', state: 'open' };
  const v6 = verdictForKey(unmapped, canon);
  check('unmapped sheet vocab is existence-checked only', v6.ok && !v6.checked, v6.reason);
  {
    // Regression: state off the raw row (the projection lacks it).
    const vals = ['Meal-36', '', '', '', '', 'Pending', '', '', 'card:tag_mupd6fhn_g62r4n', '', '', 'done'];
    const header = ['ref', '', '', '', '', 'status', '', '', 'key', '', '', 'state'];
    check('cellByName reads state off the raw row', cellByName(vals, header, 'state') === 'done');
  }
}
check('isCardKey matches card tags only', isCardKey('card:tag_x') && !isCardKey('spec:X') && !isCardKey('task:x'));
check('stateRank orders the pipeline', stateRank('new') === 0 && stateRank('packed') === 1 && stateRank('in_fix') === 3 && stateRank('verifying') === 4 && stateRank('done') === 5);
check('stateRank is null off-vocab', stateRank('open') === null && stateRank('locked') === null && stateRank('') === null);

// ---------------------------------------------------------------------------
// 2. Live — bugctl vs the real `current` tab, read-only.
// ---------------------------------------------------------------------------

resetReviewState();
{
  const bugs = readBugctlList();
  if (!bugs.ok) {
    note(`live parity check skipped (${bugs.reason}; is bugctl on PATH?)`);
  } else {
    const ctx = await getReviewContext({});
    if (!ctx.ok) {
      note(`live sheet check skipped (${ctx.reason || 'no Google identity on this host'})`);
    } else {
      const current = await readCurrentRows(ctx, { refresh: true });
      if (!current.ok) {
        note(`live sheet check skipped (${current.reason || 'sheet read failed'})`);
      } else {
        const canonByTag = new Map(bugs.rows.map((r) => [String(r.tag_id || r.tag || ''), { state: r.state }]));
        let cardRows = 0;
        for (const { rowNumber, vals } of current.numbered) {
          const item = mapReviewRow(vals, current.header, rowNumber);
          if (!item.key || !isCardKey(item.key)) continue;
          cardRows += 1;
          item.state = cellByName(vals, current.header, 'state');
          const v = verdictForKey(item, canonByTag);
          if (!v.checked) {
            note(`row ${rowNumber} ${item.key}: state ${item.state || '?'} off-vocab, existence ok`);
            continue;
          }
          check(`row ${rowNumber} ${item.ref || item.key} matches canonical`, v.ok, v.reason);
        }
        console.log(`  (live: ${cardRows} card rows, canonical store holds ${canonByTag.size} cards)`);
      }
    }
  }
}

console.log(`assert-sheet-canonical-parity: ${passed} pass, ${failed} fail${skipped ? `, ${skipped} skipped` : ''}`);
process.exit(failed ? 1 : 0);
