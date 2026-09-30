/**
 * One ticket number per card, assigned once, under concurrency.
 *
 * Measured 2026-09-30 (V-30.x follow-up): the board showed 14 cards while the
 * canonical list could only cite 10 numbers, because #8, #10, #11 and #12 each
 * sat on TWO cards. All four pairs were minted inside one 2026-09-29 inbox
 * migration, which is the shape of this class of bug rather than a coincidence:
 *
 *   persistAutoFile() read a snapshot, chose `max(used)+1` from it, INSERTed the
 *   row, and only then wrote the numbered work_item. Between the INSERT and the
 *   write the card is VISIBLE and reads as unnumbered, so any second caller —
 *   and the board fires `POST /api/bugs/migrate-inbox` on every mount, fire and
 *   forget — numbers from a snapshot that cannot yet include it. Two passes over
 *   the same inbox hand the same #n to different cards.
 *
 * So this module is pure: it plans numbers from a row set and it plans the
 * repair of numbers that are already duplicated. The caller does the claiming
 * with a conditional UPDATE, and re-runs `planRenumber` until it reports clean —
 * the invariant is enforced by re-reading, not by trusting one snapshot.
 *
 * Rules (deliberately boring, so no agent has to guess):
 *  - a number belongs to exactly one card, forever;
 *  - the OLDEST card keeps a duplicated number (citations already in issues,
 *    journals and chat keep resolving to the same card);
 *  - every other holder of that number moves to the next free integer, in
 *    created_at order, so the repair is deterministic;
 *  - numbers are never reused: a freed number stays retired.
 */

import { hydrateWorkItem } from './bugWorkItem';

export type NumberRow = { id: string; created_at?: string | null; work_item?: any };

export type RenumberPlan = {
  /** tag ids that must be rewritten, in the order they should be written. */
  moves: Array<{ id: string; from: number; to: number }>;
  /** Numbers that were already unique and stay untouched. */
  kept: number;
  duplicates: number;
};

/** public_n per row, tolerating a string blob, a parsed object, or nothing. */
export function publicNOf(row: NumberRow): number {
  const n = Number(hydrateWorkItem(row as any).public_n || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const createdKey = (r: NumberRow) => String(r.created_at || '');

/** Oldest first, id as the tiebreak so two runs on the same data agree. */
export function byCreation<T extends NumberRow>(rows: T[]): T[] {
  return [...(rows || [])].sort((a, b) => {
    const c = createdKey(a).localeCompare(createdKey(b));
    return c !== 0 ? c : String(a.id).localeCompare(String(b.id));
  });
}

/**
 * Numbers a card may take: every number already held, plus the retirements this
 * plan produces. `reserve` lets a caller hand in numbers it is about to use.
 */
export function usedNumbers(rows: NumberRow[], reserve: number[] = []): Set<number> {
  const used = new Set<number>();
  for (const r of rows || []) {
    const n = publicNOf(r);
    if (n > 0) used.add(n);
  }
  for (const n of reserve || []) {
    if (n > 0) used.add(n);
  }
  return used;
}

/**
 * Numbers for cards that have none yet. Pure and deterministic: given the same
 * rows it returns the same assignment, which is what makes a concurrent second
 * caller converge on the SAME number instead of two different ones.
 */
export function planAssignments<T extends NumberRow>(rows: T[], reserve: number[] = []): Array<{ id: string; to: number }> {
  const used = usedNumbers(rows, reserve);
  let next = Math.max(0, ...used) + 1;
  const out: Array<{ id: string; to: number }> = [];
  for (const r of byCreation(rows.filter((x) => publicNOf(x) === 0))) {
    while (used.has(next)) next += 1;
    used.add(next);
    out.push({ id: r.id, to: next });
    next += 1;
  }
  return out;
}

/** Group rows by number; only numbers held by more than one card. */
export function duplicateNumbers(rows: NumberRow[]): Map<number, NumberRow[]> {
  const byN = new Map<number, NumberRow[]>();
  for (const r of rows || []) {
    const n = publicNOf(r);
    if (n <= 0) continue;
    if (!byN.has(n)) byN.set(n, []);
    byN.get(n)!.push(r);
  }
  for (const [n, list] of [...byN.entries()]) if (list.length < 2) byN.delete(n);
  return byN;
}

export function hasDuplicateNumbers(rows: NumberRow[]): boolean {
  return duplicateNumbers(rows).size > 0;
}

/**
 * Repair plan for numbers that are already duplicated: the oldest holder of each
 * keeps it, the rest take the next free integers. Idempotent — running it on the
 * output of itself yields zero moves.
 */
export function planRenumber<T extends NumberRow>(rows: T[]): RenumberPlan {
  const dups = duplicateNumbers(rows);
  const moves: Array<{ id: string; from: number; to: number }> = [];
  if (dups.size === 0) {
    return { moves, kept: new Set([...usedNumbers(rows)]).size, duplicates: 0 };
  }
  // Every number ever held stays retired, so a repair can never hand a freed
  // number to a new card and re-point a citation.
  const used = usedNumbers(rows);
  let next = Math.max(0, ...used) + 1;
  const ordered = byCreation(rows);
  for (const n of [...dups.keys()].sort((a, b) => a - b)) {
    const holders = dups.get(n)!.slice().sort((a, b) => {
      const c = createdKey(a).localeCompare(createdKey(b));
      return c !== 0 ? c : String(a.id).localeCompare(String(b.id));
    });
    for (const loser of holders.slice(1)) {
      while (used.has(next)) next += 1;
      used.add(next);
      moves.push({ id: String(loser.id), from: n, to: next });
      next += 1;
    }
  }
  void ordered;
  return { moves, kept: new Set([...used]).size - moves.length, duplicates: dups.size };
}

/** One line a human can read in a run log or a PR. */
export function describeRenumber(plan: RenumberPlan): string {
  if (plan.moves.length === 0) return `bug numbers: clean (${plan.kept} unique)`;
  return (
    `bug numbers: ${plan.moves.length} duplicate holder(s) across ${plan.duplicates} number(s) -> ` +
    plan.moves.map((m) => `${m.id} #${m.from} -> #${m.to}`).join(', ')
  );
}
