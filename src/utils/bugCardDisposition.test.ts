import { describe, it, expect } from 'vitest';
import {
  cardDiscipline,
  dispositionLabel,
  isCardOpen,
  isDeclinedStatus,
  isFixedStatus,
  DECLINED_STATUSES,
} from './bugCardDisposition';

// Sensor for the measured 2026-09-30 defect: a card with status='ignored' was
// counted DONE by the KPIs while its own badge rendered the word "fixed". Two
// surfaces, two rules, and `ignored` in one and not the other.

const tag = (status: string, work_item: any = {}, extra: any = {}) => ({
  id: 't',
  status,
  work_item: { public_n: 1, queue: 'ready', commits: [], burns: [], ...work_item },
  ...extra,
});

describe('status vocabulary', () => {
  it('recognises every declined status the store can hold, case-insensitively', () => {
    for (const s of ['ignored', 'IGNORED', 'wont_fix', 'wontfix', 'dismissed', 'rejected', 'duplicate', 'invalid']) {
      expect(isDeclinedStatus(s)).toBe(true);
    }
    expect([...DECLINED_STATUSES]).toContain('ignored');
  });

  it('does not treat open statuses as declined or fixed', () => {
    for (const s of ['to_fix', 'in_progress', '', 'pending', 'weird_new_status']) {
      expect(isDeclinedStatus(s)).toBe(false);
      expect(isFixedStatus(s)).toBe(false);
    }
    expect(isFixedStatus('fixed')).toBe(true);
  });

  it('treats an unknown status as OPEN work — the safe direction to be wrong in', () => {
    const d = cardDiscipline(tag('something_invented_later'));
    expect(d.open).toBe(true);
    expect(d.done).toBe(false);
  });
});

describe('cardDiscipline — the ignored-vs-fixed bug', () => {
  it('an ignored card is NOT done and does NOT read as fixed', () => {
    const d = cardDiscipline(tag('ignored'));
    expect(d.disposition).toBe('declined');
    expect(d.done).toBe(false);
    expect(d.open).toBe(false);
    expect(d.declined).toBe(true);
    expect(dispositionLabel(d.disposition)).toBe('declined');
  });

  it('a green-ticked card IS done', () => {
    const d = cardDiscipline(tag('fixed'));
    expect(d.disposition).toBe('fixed');
    expect(d.done).toBe(true);
    expect(dispositionLabel(d.disposition)).toBe('fixed');
  });

  it('the two never share a label, which is the whole point', () => {
    expect(dispositionLabel(cardDiscipline(tag('ignored')).disposition))
      .not.toBe(dispositionLabel(cardDiscipline(tag('fixed')).disposition));
  });

  it('declined beats a stale work_item that still claims ready', () => {
    // A card can be marked ignored after work started; the work_item is not
    // rewritten, so the decision must win over the leftover queue.
    const d = cardDiscipline(tag('ignored', { queue: 'ready', remaining: ['still open'] }));
    expect(d.disposition).toBe('declined');
    expect(d.open).toBe(false);
  });
});

describe('cardDiscipline — open work', () => {
  it('classifies the four open states the board renders', () => {
    expect(cardDiscipline(tag('to_fix', { commits: [] })).disposition).toBe('untouched');
    expect(cardDiscipline(tag('to_fix', { remaining: ['do the thing'] })).disposition).toBe('to_do');
    // The agent acted LAST: a person owes the reply. This is the board's
    // isPendingReview, and it deliberately outranks leftover `remaining` lines.
    expect(
      cardDiscipline(tag('to_fix', { commits: [{ kind: 'agent', actor: 'agent' }], remaining: ['x'] })).disposition,
    ).toBe('review');
    // The agent acted EARLIER and something was posted after: the agent's turn.
    expect(
      cardDiscipline(
        tag('to_fix', { commits: [{ kind: 'agent', actor: 'agent' }, { kind: 'you', actor: 'you' }], remaining: ['x'] }),
      ).disposition,
    ).toBe('to_do');
  });

  it('blocked wins over review: a stuck card is not waiting on a human', () => {
    const d = cardDiscipline(tag('to_fix', { queue: 'blocked', commits: [{ kind: 'agent', actor: 'agent' }] }));
    expect(d.disposition).toBe('stuck');
    expect(d.filter).toBe('stuck');
  });

  it('burn budget makes a card stuck even without queue=blocked', () => {
    expect(cardDiscipline(tag('to_fix', { burns: [{ burned: true }, { burned: true }] })).disposition).toBe('stuck');
    expect(cardDiscipline(tag('to_fix', { burns: [{ burned: true }] })).disposition).not.toBe('stuck');
  });

  it('an explicit blocked_reason flags it too', () => {
    expect(cardDiscipline(tag('to_fix', { blocked_reason: 'dispatch failed' })).disposition).toBe('stuck');
  });

  it('every open disposition is open work, and none is done', () => {
    const open = [
      tag('to_fix', {}),
      tag('to_fix', { remaining: ['x'] }),
      tag('to_fix', { queue: 'blocked' }),
      tag('to_fix', { commits: [{ kind: 'agent', actor: 'agent' }] }),
    ];
    for (const t of open) {
      const d = cardDiscipline(t);
      expect(d.open).toBe(true);
      expect(d.done).toBe(false);
      expect(isCardOpen(t)).toBe(true);
    }
  });
});

describe('filter mapping', () => {
  it('sends each disposition to the filter a user would look in', () => {
    expect(cardDiscipline(tag('to_fix', { remaining: ['x'] })).filter).toBe('active');
    expect(cardDiscipline(tag('to_fix', { queue: 'blocked' })).filter).toBe('stuck');
    expect(cardDiscipline(tag('fixed')).filter).toBe('done');
    expect(cardDiscipline(tag('ignored')).filter).toBe('done');
  });
});

describe('dispositionLabel', () => {
  it('has a distinct word for every disposition', () => {
    const words = (['declined', 'fixed', 'stuck', 'review', 'to_do', 'untouched'] as const).map((d) =>
      dispositionLabel(d),
    );
    expect(new Set(words).size).toBe(words.length);
  });

  it('uses the supplied translator when given one', () => {
    expect(dispositionLabel('declined', (k) => `id:${k}`)).toBe('id:bugCardDeclined');
  });
});
