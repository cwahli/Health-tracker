import { describe, it, expect } from 'vitest';
import {
  byCreation,
  describeRenumber,
  duplicateNumbers,
  hasDuplicateNumbers,
  planAssignments,
  planRenumber,
  publicNOf,
  usedNumbers,
} from './bugNumberParity';

// Sensor for the measured 2026-09-30 defect: the board showed 14 cards while
// the canonical list could cite only 10 numbers, because #8, #10, #11 and #12
// each sat on TWO cards. Root cause was a number chosen from a stale snapshot
// and written after the row was already visible as unnumbered, so two
// overlapping requests minted the same #n on two cards.
//
// The invariant under test: one number per card, and a repair that never moves
// the number a citation already points at.

const card = (id: string, publicN: number, created = '2026-09-01 00:00:00') => ({
  id,
  created_at: created,
  work_item: { public_n: publicN, queue: 'ready', commits: [], burns: [] },
});

/** The live shape of the 2026-09-29 migration damage. */
const damaged = [
  card('tag_old1', 1, '2026-09-24 14:16:39'),
  card('tag_a', 8, '2026-09-29 13:01:21'),
  card('tag_b', 8, '2026-09-29 13:01:21'),
  card('tag_c', 9, '2026-09-29 13:01:22'),
  card('tag_d', 10, '2026-09-29 13:01:22'),
  card('tag_e', 10, '2026-09-29 13:01:22'),
  card('tag_f', 11, '2026-09-29 13:01:22'),
  card('tag_g', 11, '2026-09-29 13:01:22'),
  card('tag_h', 12, '2026-09-29 13:01:23'),
  card('tag_i', 12, '2026-09-29 13:01:23'),
  card('tag_j', 13, '2026-09-29 13:01:23'),
];

describe('publicNOf', () => {
  it('reads a number from a parsed object, a TEXT blob, or nothing', () => {
    expect(publicNOf({ id: 'a', work_item: { public_n: 7 } })).toBe(7);
    expect(publicNOf({ id: 'b', work_item: JSON.stringify({ public_n: 9 }) } as any)).toBe(9);
    expect(publicNOf({ id: 'c', work_item: null })).toBe(0);
    expect(publicNOf({ id: 'd', work_item: 'not json' } as any)).toBe(0);
    expect(publicNOf({ id: 'e' })).toBe(0);
    expect(publicNOf({ id: 'f', work_item: { public_n: -3 } })).toBe(0);
  });
});

describe('usedNumbers / byCreation', () => {
  it('collects only positive numbers and honours a reserve', () => {
    expect([...usedNumbers(damaged)].sort((a, b) => a - b)).toEqual([1, 8, 9, 10, 11, 12, 13]);
    expect([...usedNumbers(damaged, [14])]).toContain(14);
    expect(publicNOf({ id: 'z', work_item: {} })).toBe(0);
  });

  it('orders oldest first with id as a deterministic tiebreak', () => {
    const same = [card('b', 0, '2026-01-01'), card('a', 0, '2026-01-01'), card('c', 0, '2025-01-01')];
    expect(byCreation(same).map((r) => r.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('planAssignments', () => {
  it('numbers unnumbered cards from max+1 without touching a held number', () => {
    const rows = [card('keep', 4), card('new_a', 0, '2026-09-02'), card('new_b', 0, '2026-09-03')];
    expect(planAssignments(rows)).toEqual([
      { id: 'new_a', to: 5 },
      { id: 'new_b', to: 6 },
    ]);
  });

  it('is deterministic, so two concurrent callers converge on the SAME number', () => {
    const rows = [card('a', 0, '2026-09-02'), card('b', 0, '2026-09-03')];
    expect(planAssignments(rows)).toEqual(planAssignments(rows));
  });

  it('skips numbers reserved by the caller and never reuses a retired one', () => {
    const rows = [card('held', 4), card('fresh', 0, '2026-09-02')];
    expect(planAssignments(rows, [5])).toEqual([{ id: 'fresh', to: 6 }]);
  });

  it('returns nothing when every card already has a number', () => {
    expect(planAssignments(damaged.filter((c) => publicNOf(c) > 0))).toEqual([]);
  });

  // The hole I shipped in #391 and then walked into on 2026-09-30: a scratch
  // card took #18, was deleted, and #18 was handed to a real defect four
  // minutes later. The floor is the retired set, not the live rows.
  it('does NOT reissue a number whose card was deleted (the incident)', () => {
    const live = [card('low', 1, '2026-09-01'), card('high', 17, '2026-09-01')];
    const fresh = { id: 'newcomer', created_at: '2026-09-30', work_item: { public_n: 0 } };
    // Without the floor: #18, the same number a citation already points at.
    expect(planAssignments([...live, fresh]).map((x) => x.to)).toContain(18);
    // With it: above the highest retired number.
    expect(planAssignments([...live, fresh], [], [18]).map((x) => x.to)).toEqual([19]);
  });

  it('skips a retired number sitting in the middle of the range', () => {
    const rows = [card('a', 1, '2026-09-01'), { id: 'b', created_at: '2026-09-30', work_item: { public_n: 0 } }];
    expect(planAssignments(rows, [], [7]).map((x) => x.to)).toEqual([8]);
  });

  it('a retired number outranks a reserve for the same slot', () => {
    const rows = [card('a', 1, '2026-09-01'), { id: 'b', created_at: '2026-09-30', work_item: { public_n: 0 } }];
    expect(planAssignments(rows, [2], [3]).map((x) => x.to)).toEqual([4]);
  });

  it('a repair does not hand a retired number to the card it is moving', () => {
    const rows = [card('p', 5, '2026-01-01'), card('q', 5, '2026-02-01')];
    expect(planRenumber(rows, [6]).moves).toEqual([{ id: 'q', from: 5, to: 7 }]);
    expect(planRenumber(rows).moves).toEqual([{ id: 'q', from: 5, to: 6 }]);
  });
});

describe('duplicateNumbers / hasDuplicateNumbers', () => {
  it('finds exactly the four doubled numbers from the live incident', () => {
    const dups = duplicateNumbers(damaged);
    expect([...dups.keys()].sort((a, b) => a - b)).toEqual([8, 10, 11, 12]);
    expect(dups.get(8)!.map((r) => r.id)).toEqual(['tag_a', 'tag_b']);
    expect(hasDuplicateNumbers(damaged)).toBe(true);
    expect(hasDuplicateNumbers([card('x', 1), card('y', 2)])).toBe(false);
  });

  it('ignores unnumbered cards — they are pending, not duplicates', () => {
    expect(hasDuplicateNumbers([card('x', 0), card('y', 0)])).toBe(false);
  });
});

describe('planRenumber', () => {
  it('keeps the oldest holder of a duplicated number and moves the rest up', () => {
    const plan = planRenumber(damaged);
    expect(plan.moves).toEqual([
      { id: 'tag_b', from: 8, to: 14 },
      { id: 'tag_e', from: 10, to: 15 },
      { id: 'tag_g', from: 11, to: 16 },
      { id: 'tag_i', from: 12, to: 17 },
    ]);
  });

  it('a citation already in an issue keeps resolving to the same card', () => {
    const before = duplicateNumbers(damaged).get(12)!.map((r) => r.id);
    const moved = planRenumber(damaged).moves.find((m) => m.from === 12)!;
    const keeper = before.filter((id) => id !== moved.id);
    expect(keeper).toEqual(['tag_h']); // oldest holder of #12 is untouched
  });

  it('never reuses a freed number: the repaired set is still unique', () => {
    const repaired = damaged.map((c) => {
      const m = planRenumber(damaged).moves.find((x) => x.id === c.id);
      return m ? card(c.id, m.to, String(c.created_at)) : c;
    });
    expect(hasDuplicateNumbers(repaired)).toBe(false);
    const nums = repaired.map(publicNOf).sort((a, b) => a - b);
    expect(nums).toEqual([...new Set(nums)]);
    expect(nums).toContain(14);
    expect(nums).toContain(17);
  });

  it('is idempotent — running it on its own output plans nothing', () => {
    const first = planRenumber(damaged);
    const repaired = damaged.map((c) => {
      const m = first.moves.find((x) => x.id === c.id);
      return m ? card(c.id, m.to, String(c.created_at)) : c;
    });
    expect(planRenumber(repaired).moves).toEqual([]);
  });

  it('handles three cards on one number, keeping only the oldest', () => {
    const rows = [card('a', 5, '2026-01-01'), card('b', 5, '2026-02-01'), card('c', 5, '2026-03-01')];
    expect(planRenumber(rows).moves).toEqual([
      { id: 'b', from: 5, to: 6 },
      { id: 'c', from: 5, to: 7 },
    ]);
  });

  it('breaks a created_at tie by id so two runs agree', () => {
    const rows = [card('zz', 5, '2026-01-01'), card('aa', 5, '2026-01-01')];
    expect(planRenumber(rows).moves).toEqual([{ id: 'zz', from: 5, to: 6 }]);
  });

  it('reports clean when nothing is duplicated', () => {
    const plan = planRenumber([card('a', 1), card('b', 2)]);
    expect(plan).toEqual({ moves: [], kept: 2, duplicates: 0 });
    expect(describeRenumber(plan)).toMatch(/clean \(2 unique\)/);
  });

  it('names every move in the human line', () => {
    expect(describeRenumber(planRenumber(damaged))).toContain('tag_b #8 -> #14');
  });
});
