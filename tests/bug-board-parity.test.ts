import { describe, it, expect } from 'vitest';
import { projectCanonicalRow, normIssueTag } from '../serverIssueBacklog';
import { hydrateWorkItem } from '../src/utils/bugWorkItem';
import { bugState } from '../src/utils/bugTicketState';

// Sensor for packet bug-board-parity Node 1: overview rows must carry the
// same canonical projection `GET /api/bugs/list` serves, computed by the
// same hydrateWorkItem() + bugState(). Independent oracle per case.
const oracle = (tag: any) => {
  const item = hydrateWorkItem(tag);
  const ticket = bugState(item);
  return {
    public_n: item.public_n,
    class: item.class || null,
    fingerprint: item.fingerprint || null,
    state: ticket.state,
    flags: ticket.flags,
    queue: ticket.queue,
  };
};

const d1Row = (id: string, status: string, workItem: any) =>
  normIssueTag({
    id,
    title: `card ${id}`,
    category: 'foodcart',
    status,
    created_at: '2026-09-25 09:28:04',
    updated_at: '2026-09-25 09:28:04',
    comments: '[]',
    work_item: JSON.stringify(workItem),
  });

const cases: Array<[string, any]> = [
  [
    'new card (no defect)',
    d1Row('tag_new', 'to_fix', { public_n: 1, queue: 'ready', commits: [], remaining: [], done: [] }),
  ],
  [
    'packed card (defect + class)',
    d1Row('tag_packed', 'to_fix', {
      public_n: 7,
      queue: 'ready',
      class: 'UI',
      defect: { component: 'Home' },
      commits: [],
      remaining: ['nav labels'],
      done: [],
    }),
  ],
  [
    'blocked card (blocked_reason flag)',
    d1Row('tag_blocked', 'to_fix', {
      public_n: 4,
      queue: 'blocked',
      blocked_reason: 'dispatch failed',
      defect: { component: 'X' },
      commits: [],
      remaining: [],
      done: [],
    }),
  ],
  [
    'done card (legacy fixed)',
    d1Row('tag_done', 'fixed', {
      public_n: 2,
      queue: 'done',
      class: 'CLONE_UI',
      commits: [],
      remaining: [],
      done: ['omega-3 display'],
    }),
  ],
];

describe('projectCanonicalRow matches the canonical list projection', () => {
  for (const [name, tag] of cases) {
    it(name, () => {
      expect(projectCanonicalRow(tag)).toEqual(oracle(tag));
    });
  }

  it('reflects class-only curation (the original drift)', () => {
    const a = d1Row('tag_x', 'to_fix', { public_n: 9, queue: 'ready', class: 'UI', defect: { c: 'H' }, commits: [], remaining: [], done: [] });
    const b = d1Row('tag_x', 'to_fix', { public_n: 9, queue: 'ready', class: 'CLONE_UI', defect: { c: 'H' }, commits: [], remaining: [], done: [] });
    expect(projectCanonicalRow(a).class).toBe('UI');
    expect(projectCanonicalRow(b).class).toBe('CLONE_UI');
  });
});
