/**
 * One row set, one numbering pass, for every surface that shows bug cards.
 *
 * Why this file exists (measured 2026-09-30): the board and `bugctl list` were
 * two independent queries with two different row sets and two different numbering
 * passes, so "how many bug tickets are there" had two answers.
 *
 *   /api/bug-tracker/overview  status IN ('to_fix','in_progress','fixed'), no
 *                              updated_at column  (serverIssueBacklog.mjs:539)
 *   /api/bugs/list            SELECT *, every status (serverBugSnapshot.mjs:1503)
 *
 * Any card whose status fell outside the board's IN-list was counted by the bot
 * and invisible on the board. Today every card is `to_fix` so the two agree by
 * luck; the divergence is structural and one `wont_fix` away from being reported.
 *
 * This module is the single answer to "which cards exist":
 *   - `loadIssueTags()` — the ONE row set, all statuses, one column list;
 *   - `claimPublicNumbers()` — number every unnumbered card and repair any
 *     duplicate, using a conditional UPDATE so a concurrent writer's number wins
 *     instead of being overwritten, and re-reading until the invariant holds.
 *
 * Pure planning lives in src/utils/bugNumberParity.ts and is unit-tested there;
 * this file only does I/O.
 */

import { d1Query } from './server_d1.js';
import { hydrateWorkItem } from './src/utils/bugWorkItem.js';
import {
  describeRenumber,
  hasDuplicateNumbers,
  planAssignments,
  planRenumber,
  publicNOf,
  type NumberRow,
  type RenumberPlan,
} from './src/utils/bugNumberParity.js';

const LOG = '[bug-numbers]';

/** Every column any bug surface reads. One list, so no surface can be missing a
 *  field the others use (the board's old query omitted `updated_at`, which made
 *  its "last actioned" sort and its done-this-week count disagree with the list). */
export const ISSUE_TAG_COLUMNS = [
  'id',
  'title',
  'title_key',
  'category',
  'status',
  'created_at',
  'updated_at',
  'resolved_at',
  'resolution_note',
  'whats_still_open',
  'comments',
  'work_item',
] as const;

const safeJson = (v: any, fallback: any) => {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'object') return v;
  if (typeof v !== 'string') return fallback;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
};

/** D1 TEXT payload columns -> parsed. Shared so both surfaces hydrate the same. */
export function normalizeTagRow(row: any): any {
  if (!row) return row;
  return {
    ...row,
    category: row.category || 'foodcart',
    whats_still_open: row.whats_still_open || '',
    work_item: safeJson(row.work_item, null),
    comments: safeJson(row.comments, []),
  };
}

/**
 * THE row set. All statuses, one column list, one order. `limit` exists only as
 * a runaway guard; nothing may narrow it by status, because a narrower board is
 * exactly the bug this replaced.
 */
export async function loadIssueTags(limit = 1000): Promise<{ ok: boolean; rows: any[]; error?: string }> {
  const sql = `SELECT ${ISSUE_TAG_COLUMNS.join(', ')} FROM issue_tags ORDER BY created_at ASC, id ASC LIMIT ?`;
  const res = await d1Query<any>(sql, [limit]);
  if (!res.success) return { ok: false, rows: [], error: res.error || 'issue_tags query failed' };
  return { ok: true, rows: (res.results || []).map(normalizeTagRow) };
}

/**
 * Numbers whose card was deleted. They stay in the "used" set forever, so the
 * floor for a new card is max(live, retired) + 1 rather than max(live) + 1.
 *
 * Without this, deleting the highest-numbered card drops the maximum and the
 * number is reissued to the next card created — measured 2026-09-30: #18 was
 * issued to a scratch card, the card was deleted, and #18 came back four
 * minutes later to a real meal-audit defect, silently re-pointing every
 * citation at it. bugNumberParity.ts promised numbers are never reused; this
 * table is what makes the promise true.
 *
 * A read failure returns [] instead of throwing: a missing floor means a
 * duplicate number, which is recoverable, and a 500 on every board read is not.
 */
export async function loadRetiredNumbers(): Promise<number[]> {
  const res = await d1Query<any>(`SELECT public_n FROM retired_ticket_numbers`);
  if (!res.success) {
    console.warn(`${LOG} retired numbers unreadable, using live rows only:`, res.error);
    return [];
  }
  return (res.results || []).map((r: any) => Number(r.public_n || 0)).filter((n: number) => n > 0);
}

/**
 * Record that `publicN` will never be issued again. Called BEFORE the card is
 * deleted, so there is no window in which the number is free to be reused.
 */
export async function retireTicketNumber(publicN: number, reason = 'card deleted'): Promise<boolean> {
  const n = Number(publicN || 0);
  if (!Number.isFinite(n) || n <= 0) return false;
  const res = await d1Query(`INSERT OR IGNORE INTO retired_ticket_numbers (public_n, reason) VALUES (?, ?)`, [
    n,
    String(reason).slice(0, 200),
  ]);
  if (!res.success) {
    console.warn(`${LOG} could not retire #${n}:`, res.error);
    return false;
  }
  return true;
}

/** Retire the numbers of cards that are about to be deleted. */
export async function retireTicketNumbers(rows: NumberRow[], reason = 'card deleted'): Promise<number[]> {
  const done: number[] = [];
  for (const r of rows || []) {
    const n = publicNOf(r);
    if (n > 0 && (await retireTicketNumber(n, reason))) done.push(n);
  }
  return done;
}

/** A row is unnumbered when the column is absent, unparseable, or zero. */
const UNNUMBERED_GUARD = `(work_item IS NULL OR work_item = '' OR json_extract(work_item, '$.public_n') IS NULL OR json_extract(work_item, '$.public_n') = 0)`;

/**
 * Write public_n onto one card, but only if it is still unnumbered. The guard is
 * the whole point: without it two callers that read the same snapshot both win
 * and the later write silently destroys the earlier one (measured: four
 * duplicated numbers, all from one inbox migration).
 * Returns true when this caller is the one that set the number.
 */
async function claimNumber(tagId: string, to: number): Promise<boolean> {
  const cur = await d1Query<any>(`SELECT work_item FROM issue_tags WHERE id = ? LIMIT 1`, [tagId]);
  if (!cur.success) return false;
  const row = (cur.results || [])[0];
  if (!row) return false;
  const item = hydrateWorkItem(normalizeTagRow({ id: tagId, work_item: row.work_item }) as any);
  if (Number(item.public_n || 0) > 0) return false; // someone else got there first
  const next = { ...item, public_n: to };
  const res = await d1Query<any>(
    `UPDATE issue_tags SET work_item = ?, updated_at = datetime('now') WHERE id = ? AND ${UNNUMBERED_GUARD}`,
    [JSON.stringify(next), tagId]
  );
  return !!res.success;
}

/** Rewrite public_n on a card that already has one (the repair path only). */
async function forceNumber(tagId: string, to: number): Promise<boolean> {
  const cur = await d1Query<any>(`SELECT work_item FROM issue_tags WHERE id = ? LIMIT 1`, [tagId]);
  if (!cur.success) return false;
  const row = (cur.results || [])[0];
  if (!row) return false;
  const item = hydrateWorkItem(normalizeTagRow({ id: tagId, work_item: row.work_item }) as any);
  const res = await d1Query<any>(`UPDATE issue_tags SET work_item = ? WHERE id = ?`, [
    JSON.stringify({ ...item, public_n: to }),
    tagId,
  ]);
  return !!res.success;
}

export type ClaimReport = {
  ok: boolean;
  claimed: Array<{ id: string; to: number }>;
  lost: string[];
  repaired: RenumberPlan['moves'];
  rounds: number;
  duplicatesRemaining: number;
  error?: string;
};

/**
 * Number every unnumbered card and repair duplicates, then PROVE it by
 * re-reading. Bounded: at most `maxRounds` passes, because the invariant is
 * checked against fresh rows each time rather than assumed from the plan.
 * `dryRun` plans and reports without writing — the same code path the repair
 * script uses, so a dry run cannot lie about what a real run would do.
 */
export async function claimPublicNumbers({ dryRun = false, maxRounds = 4 } = {}): Promise<ClaimReport> {
  const claimed: Array<{ id: string; to: number }> = [];
  const lost: string[] = [];
  const repaired: RenumberPlan['moves'] = [];
  let rounds = 0;
  let rows: NumberRow[] = [];
  // Read once per pass. Cheap, and it is the difference between a number that
  // can never come back and one that comes back with the next new card.
  const retired = await loadRetiredNumbers();

  for (; rounds < maxRounds; rounds += 1) {
    const loaded = await loadIssueTags();
    if (!loaded.ok) return { ok: false, claimed, lost, repaired, rounds, duplicatesRemaining: -1, error: loaded.error };
    rows = loaded.rows as NumberRow[];

    const dupPlan = planRenumber(rows, retired);
    if (dupPlan.moves.length > 0) {
      if (dryRun) {
        repaired.push(...dupPlan.moves);
        break;
      }
      for (const m of dupPlan.moves) {
        if (await forceNumber(m.id, m.to)) repaired.push(m);
      }
      continue; // re-read before deciding anything else
    }

    const plan = planAssignments(rows, [], retired);
    if (plan.length === 0) {
      return {
        ok: true,
        claimed,
        lost,
        repaired,
        rounds: rounds + 1,
        duplicatesRemaining: hasDuplicateNumbers(rows) ? 1 : 0,
      };
    }
    if (dryRun) {
      claimed.push(...plan);
      break;
    }
    for (const p of plan) {
      if (await claimNumber(p.id, p.to)) claimed.push({ id: p.id, to: p.to });
      else lost.push(p.id);
    }
  }

  if (dryRun) {
    const projected = rows.map((r) => {
      const move = repaired.find((m) => m.id === String(r.id));
      const claim = claimed.find((c) => c.id === String(r.id));
      const to = move ? move.to : claim ? claim.to : publicNOf(r);
      return { id: String(r.id), work_item: { public_n: to } };
    });
    return { ok: true, claimed, lost, repaired, rounds, duplicatesRemaining: hasDuplicateNumbers(projected) ? 1 : 0 };
  }

  const final = await loadIssueTags();
  if (!final.ok) return { ok: false, claimed, lost, repaired, rounds, duplicatesRemaining: -1, error: final.error };
  return {
    ok: true,
    claimed,
    lost,
    repaired,
    rounds: rounds + 1,
    duplicatesRemaining: hasDuplicateNumbers(final.rows as NumberRow[]) ? 1 : 0,
  };
}

export { describeRenumber };
