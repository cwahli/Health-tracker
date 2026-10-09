#!/usr/bin/env node
/**
 * assert-sheet-proof — every closeable sheet row must have resolvable proof.
 *
 * Measured 2026-10-09. The `current` tab held three claims that proof
 * could not support: Meal-36 (`Pending`/`done`, empty proof cell),
 * Meal-37 (`Assigned`/`done`, empty proof cell), and Bug-53 (proof URL
 * pointing at Bug-2's Drive folder). Six more rows carried bare folder
 * names the review app can never resolve, because it lists proof by
 * folder-name-equals-key. All of it was hand-typed free text; nothing
 * checked resolvability at write time or at approve time.
 *
 * Rules (read-only — this sensor writes nothing):
 *  1. Any row with Status `review` or state `done` must resolve to a
 *     per-key proof folder holding >= 1 image. Terminal-only evidence
 *     never counts, and neither does an empty cell.
 *  2. Any row whose proof cell names a Drive folder URL must name ITS
 *     OWN key's folder. A URL pointing elsewhere is a mislink.
 *
 * Proof is resolved through `listProofImages` — the same function the
 * review app uses — so a row this sensor passes is a row `/review`
 * actually renders shots for.
 *
 * Live sections run only with a Google identity on the host; without one
 * the fixture section still runs and the live part SKIPs honestly.
 * `bugctl` is not needed here.
 *
 * Run: node scripts/assert-sheet-proof.mjs
 * Exit 0: all green (or live skipped). Exit 1: at least one FAIL.
 */

import {
  getReviewContext,
  readCurrentRows,
  listProofImages,
  proofFolderMap,
  mapReviewRow,
  isReviewStatus,
  resetReviewState,
} from './lib/review-status.mjs';

let passed = 0;
let failed = 0;
let skipped = 0;
const notes = [];
const check = (name, ok, detail = '') => {
  if (ok) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};
const note = (msg) => { skipped += 1; notes.push(msg); console.log(`  SKIP  ${msg}`); };

/** A Drive folder URL inside a proof cell, if any. */
export function proofFolderId(proof) {
  const m = String(proof || '').match(/\/folders\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : '';
}

/**
 * Raw cell by header name. The review projection (`mapReviewRow`) carries
 * only the columns the review app renders — `state` is not among them —
 * so closeable-row detection reads the row itself. (2026-10-09: the first
 * version of this sensor used `item.state`, which is always undefined, and
 * went blind to every `done` row while its fixtures stayed green.)
 */
export function cellByName(vals, header, name) {
  const c = header.indexOf(String(name).toLowerCase());
  return c >= 0 && vals[c] !== undefined ? String(vals[c]) : '';
}

const isDoneState = (state) => String(state || '').trim().toLowerCase() === 'done';

/**
 * Pure verdict for one projected row + its listed proof.
 * `folderNameById` maps Work-done folder ids to names; `rowKeys` holds
 * every key on `current`. Together they tell a true mislink (the URL
 * names ANOTHER ROW's per-key folder, e.g. Bug-53 pointing at Bug-2's)
 * apart from an evidence link (a session/sync folder no row claims).
 * A URL naming a folder that exists nowhere under Work done fails:
 * proof lives in Work done, nowhere else.
 */
export function verdictForRow(item, listed, folderNameById = new Map(), rowKeys = new Set()) {
  const images = listed && listed.ok ? (listed.images || []) : [];
  const folderId = listed && listed.ok ? (listed.folderId || '') : '';
  const urlId = proofFolderId(item.proof);
  if (urlId && urlId !== folderId) {
    const named = folderNameById.get(urlId) || '';
    if (!named) {
      return { ok: false, reason: `proof links folder ${urlId} which is not under Work done` };
    }
    if (named !== item.key && rowKeys.has(named)) {
      return { ok: false, reason: `proof links ${named} (${urlId}) but this row is ${item.key}` };
    }
    // Evidence link: followable, claimed by no other row. Rule 1 decides.
  }
  if (isReviewStatus(item.status) || isDoneState(item.state)) {
    if (!listed || !listed.ok) return { ok: false, reason: `proof listing failed for key ${item.key}` };
    if (!images.length) return { ok: false, reason: `Status=${item.status} state=${item.state} but zero proof images for key ${item.key}` };
  }
  return { ok: true, reason: '' };
}

console.log('assert-sheet-proof:');

// ---------------------------------------------------------------------------
// 1. Fixtures — deterministic, no network. These prove the verdict logic
//    itself, including the three production failures of 2026-10-09.
// ---------------------------------------------------------------------------

{
  const meal36 = { key: 'card:tag_mupd6fhn_g62r4n', status: 'Pending', state: 'done', proof: '' };
  const v = verdictForRow(meal36, { ok: true, images: [], folderId: '' });
  check('done with no proof folder fails (Meal-36)', !v.ok, v.reason);
}
{
  const bug53 = {
    key: 'card:tag_muxcn960_px5wm4', status: 'Assigned', state: 'new',
    proof: 'https://drive.google.com/drive/folders/1Wi35a5-t-JQ4Lr1R1jKAVWQEzw9AcVtN',
  };
  const names = new Map([['1Wi35a5-t-JQ4Lr1R1jKAVWQEzw9AcVtN', 'card:tag_muwyto2i_lv3uyw']]);
  const keys = new Set(['card:tag_muxcn960_px5wm4', 'card:tag_muwyto2i_lv3uyw']);
  const v = verdictForRow(bug53, { ok: true, images: [{ id: 'x', name: 'p.png' }], folderId: '' }, names, keys);
  check('proof URL pointing at another key fails (Bug-53)', !v.ok, v.reason);
}
{
  const linked = {
    key: 'task:vm5-ping-loop', status: 'Assigned', state: 'open',
    proof: 'https://drive.google.com/drive/folders/1Qye_0Gr8m6W7PG1LvsXE_pR5x_RfVXCG',
  };
  const names = new Map([['1Qye_0Gr8m6W7PG1LvsXE_pR5x_RfVXCG', 'req:ses_f012c7391ffeigPFFAyoUNvivt:msg_0fed38c7b001nAojPersSbTBmj']]);
  const keys = new Set(['task:vm5-ping-loop']);
  const v = verdictForRow(linked, { ok: true, images: [], folderId: '' }, names, keys);
  check('evidence link to a non-key folder passes an open row', v.ok, v.reason);
}
{
  const dead = { key: 'sync:x', status: 'Assigned', state: '', proof: 'https://drive.google.com/drive/folders/DEADDEADDEAD' };
  const v = verdictForRow(dead, { ok: true, images: [], folderId: '' }, new Map());
  check('proof URL to a nonexistent folder fails (dead link)', !v.ok, v.reason);
}
{
  const shared = { key: 'card:tag_mumoqh5v_cu5q9r', status: 'review', state: 'new', proof: 'cards-17-15-14-13-11-duplicates' };
  const v = verdictForRow(shared, { ok: true, images: [], folderId: '' });
  check('review with no per-key folder fails (shared-name proof)', !v.ok, v.reason);
}
{
  const good = {
    key: 'card:tag_muwyto2i_lv3uyw', status: 'review', state: 'new',
    proof: 'https://drive.google.com/drive/folders/1Wi35a5-t-JQ4Lr1R1jKAVWQEzw9AcVtN',
  };
  const v = verdictForRow(good, { ok: true, images: [{ id: 'a', name: 'p.png' }], folderId: '1Wi35a5-t-JQ4Lr1R1jKAVWQEzw9AcVtN' });
  check('review with matching folder + images passes', v.ok, v.reason);
}
{
  const assigned = { key: 'spec:X-1', status: 'Assigned', state: 'locked', proof: '' };
  const v = verdictForRow(assigned, { ok: true, images: [], folderId: '' });
  check('in-progress rows without proof claims still pass', v.ok, v.reason);
}
check('proofFolderId extracts folder ids', proofFolderId('https://drive.google.com/drive/folders/ABC_123-xyz') === 'ABC_123-xyz');
check('proofFolderId is empty for bare names', proofFolderId('cards-17-15-14-13-11-duplicates') === '');
{
  // Regression: `state` must come from the raw row, never the review
  // projection (which does not carry it). Meal-36 live row, verbatim.
  const vals = ['Meal-36', '', '', '', '', 'Pending', '', 'gate', 'card:tag_mupd6fhn_g62r4n', '#20', 'card', 'done', 'no'];
  const header = ['ref', '', '', '', '', 'status', '', '', 'key', 'id', 'kind', 'state', 'blocked'];
  check('cellByName reads state off the raw row', cellByName(vals, header, 'state') === 'done');
  const item = { key: 'card:tag_mupd6fhn_g62r4n', status: 'Pending', state: cellByName(vals, header, 'state'), proof: '' };
  const v = verdictForRow(item, { ok: true, images: [], folderId: '' });
  check('raw-row done with no proof fails end to end', !v.ok, v.reason);
}

// ---------------------------------------------------------------------------
// 2. Live — the real `current` tab, read-only. Skips without an identity.
// ---------------------------------------------------------------------------

resetReviewState();
{
  const ctx = await getReviewContext({});
  if (!ctx.ok) {
    note(`live sheet check skipped (${ctx.reason || 'no Google identity on this host'})`);
  } else {
    const current = await readCurrentRows(ctx, { refresh: true });
    if (!current.ok) {
      note(`live sheet check skipped (${current.reason || 'sheet read failed'})`);
    } else {
      const folders = await proofFolderMap(ctx, {});
      const folderNameById = new Map();
      if (folders.ok) {
        for (const [name, id] of folders.map) folderNameById.set(id, name);
      }
      const rowKeys = new Set(current.numbered.map(({ vals }) => mapReviewRow(vals, current.header, 0).key).filter(Boolean));
      let liveFails = 0;
      for (const { rowNumber, vals } of current.numbered) {
        const item = mapReviewRow(vals, current.header, rowNumber);
        if (!item.key) continue;
        item.state = cellByName(vals, current.header, 'state');
        const needsProof = isReviewStatus(item.status) || isDoneState(item.state);
        const hasUrl = Boolean(proofFolderId(item.proof));
        if (!needsProof && !hasUrl) continue;
        const listed = await listProofImages(ctx, item.key);
        const v = verdictForRow(item, listed, folderNameById, rowKeys);
        liveFails += v.ok ? 0 : 1;
        check(`row ${rowNumber} ${item.ref || item.key} proof resolves`, v.ok, v.reason);
      }
      if (!liveFails) console.log('  (live: every closeable row resolves proof)');
    }
  }
}

console.log(`assert-sheet-proof: ${passed} pass, ${failed} fail${skipped ? `, ${skipped} skipped` : ''}`);
process.exit(failed ? 1 : 0);
