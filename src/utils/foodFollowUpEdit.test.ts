import { describe, it, expect } from 'vitest';
import {
  isMealFollowUpEdit,
  mealTimestamp,
  hasEditIntent,
  mostRecentActiveMeal,
  ensureMealBreakdown,
  newestSucceededFoodJob,
  pendingMealOfJob,
  FOLLOW_UP_EDIT_MAX_AGE_MS,
} from './foodFollowUpEdit';

const NOW = Date.parse('2026-09-17T18:00:00');

/** A meal logged "just now" — the case-12 T2 continuation situation. */
const recentMeal = { date: '2026-09-17T17:59:00', updated_at: NOW - 60_000 };

/** The exact turn-2 text of the case-12 live spec. */
const T2_TEXT = '[Mr Oat Rolled Oats] [40g] add oats, drop the coconut';

const base = {
  hasPriorResult: false,
  existingMessageCount: 0,
  imageCount: 0,
  text: T2_TEXT,
  mappedMode: 'review' as const,
  foodLogs: [recentMeal],
  nowMs: NOW,
};

describe('mealTimestamp', () => {
  it('prefers updated_at over date', () => {
    expect(mealTimestamp({ date: '2020-01-01', updated_at: 12345 })).toBe(12345);
  });

  it('parses an ISO date with a time component', () => {
    expect(mealTimestamp({ date: '2026-09-17T08:30:00' })).toBe(
      Date.parse('2026-09-17T08:30:00'),
    );
  });

  it('treats a date-only string as local noon so same-day meals are not rejected', () => {
    expect(mealTimestamp({ date: '2026-09-17' })).toBe(Date.parse('2026-09-17T12:00:00'));
  });

  it('returns null for missing or unparseable input', () => {
    expect(mealTimestamp(null)).toBeNull();
    expect(mealTimestamp(undefined)).toBeNull();
    expect(mealTimestamp({})).toBeNull();
    expect(mealTimestamp({ date: 'not-a-date' })).toBeNull();
  });
});

describe('isMealFollowUpEdit', () => {
  it('treats a text-only follow-up on a blank draft as an edit (case-12 T2)', () => {
    expect(isMealFollowUpEdit(base)).toBe(true);
  });

  it('does NOT treat a follow-up with a staged photo as an edit (case-12 T1 must stay a new scan)', () => {
    expect(isMealFollowUpEdit({ ...base, imageCount: 1 })).toBe(false);
  });

  it('does not fire when the job already has a result (existing lever unchanged)', () => {
    expect(isMealFollowUpEdit({ ...base, hasPriorResult: true })).toBe(false);
  });

  it('does not fire when the bound job already has conversation', () => {
    expect(isMealFollowUpEdit({ ...base, existingMessageCount: 2 })).toBe(false);
  });

  it('never fires for compare', () => {
    expect(isMealFollowUpEdit({ ...base, mappedMode: 'compare' })).toBe(false);
  });

  it('always fires for an explicit edit pill', () => {
    expect(
      isMealFollowUpEdit({ ...base, mappedMode: 'edit', hasPriorResult: true, imageCount: 3 }),
    ).toBe(true);
  });

  it('does not fire when there is no meal to edit', () => {
    expect(isMealFollowUpEdit({ ...base, foodLogs: [] })).toBe(false);
    expect(isMealFollowUpEdit({ ...base, foodLogs: null })).toBe(false);
  });

  it('ignores soft-deleted meals', () => {
    expect(isMealFollowUpEdit({ ...base, foodLogs: [{ ...recentMeal, sync_state: 'delete' }] })).toBe(
      false,
    );
  });

  it('uses the newest active log by timestamp, not array position', () => {
    const older = { date: '2026-09-17T09:00:00', updated_at: NOW - 9 * 3600_000 };
    const newest = { date: '2026-09-17T17:59:00', updated_at: NOW - 60_000 };
    expect(isMealFollowUpEdit({ ...base, foodLogs: [older, newest] })).toBe(true);
    expect(isMealFollowUpEdit({ ...base, foodLogs: [newest, older] })).toBe(true);
    expect(mostRecentActiveMeal([older, newest])).toEqual(newest);
    expect(mostRecentActiveMeal([newest, older])).toEqual(newest);
  });

  it('still fires when newest-first array ends with a stale meal (live T2 regression)', () => {
    // mergeFoodLogsDeduped sorts newest-first; the old code used array[-1] (oldest)
    // and rejected the follow-up whenever any >24h log sat at the tail.
    const newest = { updated_at: NOW - 60_000 };
    const stale = { updated_at: NOW - FOLLOW_UP_EDIT_MAX_AGE_MS - 60_000 };
    expect(isMealFollowUpEdit({ ...base, foodLogs: [newest, stale] })).toBe(true);
    expect(isMealFollowUpEdit({ ...base, foodLogs: [stale, newest] })).toBe(true);
    // Only stale → still false
    expect(isMealFollowUpEdit({ ...base, foodLogs: [stale] })).toBe(false);
  });

  it('does not fire for a stale meal outside the continuation window', () => {
    const stale = { updated_at: NOW - FOLLOW_UP_EDIT_MAX_AGE_MS - 1000 };
    expect(isMealFollowUpEdit({ ...base, foodLogs: [stale] })).toBe(false);
  });

  it('honours a custom window', () => {
    const fiveMinAgo = { updated_at: NOW - 5 * 60_000 };
    expect(isMealFollowUpEdit({ ...base, foodLogs: [fiveMinAgo], maxAgeMs: 60_000 })).toBe(false);
    expect(isMealFollowUpEdit({ ...base, foodLogs: [fiveMinAgo], maxAgeMs: 600_000 })).toBe(true);
  });

  it('accepts a same-day date-only log (no time component)', () => {
    expect(isMealFollowUpEdit({ ...base, foodLogs: [{ date: '2026-09-17' }] })).toBe(true);
  });

  it('treats a future-dated log as just-now rather than rejecting it', () => {
    expect(isMealFollowUpEdit({ ...base, foodLogs: [{ updated_at: NOW + 60_000 }] })).toBe(true);
  });

  it('does NOT hijack a genuinely new text-only meal (regression guard)', () => {
    // Logged lunch, now typing dinner. This must stay a new scan, not merge into lunch.
    expect(isMealFollowUpEdit({ ...base, text: 'nasi goreng' })).toBe(false);
    expect(isMealFollowUpEdit({ ...base, text: 'kopi susu 200ml' })).toBe(false);
    expect(isMealFollowUpEdit({ ...base, text: '[Big Mac] [215g]' })).toBe(false);
  });

  it('does not fire on composition wording, only on commands', () => {
    // "without sugar" describes the drink; it is not an instruction to edit the last meal.
    expect(isMealFollowUpEdit({ ...base, text: 'kopi tanpa gula' })).toBe(false);
    expect(isMealFollowUpEdit({ ...base, text: 'coffee without sugar' })).toBe(false);
  });
});

describe('hasEditIntent', () => {
  it('recognises the case-12 T2 command', () => {
    expect(hasEditIntent(T2_TEXT)).toBe(true);
  });

  it('recognises English add/remove/change verbs', () => {
    expect(hasEditIntent('add oats')).toBe(true);
    expect(hasEditIntent('drop the coconut')).toBe(true);
    expect(hasEditIntent('remove the rice')).toBe(true);
    expect(hasEditIntent('delete coconut')).toBe(true);
    expect(hasEditIntent('replace the milk')).toBe(true);
    expect(hasEditIntent('swap rice for oats')).toBe(true);
  });

  it('recognises Indonesian add/remove/change verbs', () => {
    expect(hasEditIntent('tambah oat')).toBe(true);
    expect(hasEditIntent('hapus kelapa')).toBe(true);
    expect(hasEditIntent('buang nasi')).toBe(true);
    expect(hasEditIntent('ganti susu')).toBe(true);
    expect(hasEditIntent('kurangi nasi')).toBe(true);
  });

  it('ignores plain food descriptions and composition words', () => {
    expect(hasEditIntent('nasi goreng')).toBe(false);
    expect(hasEditIntent('kopi tanpa gula')).toBe(false);
    expect(hasEditIntent('coffee without sugar')).toBe(false);
    expect(hasEditIntent('')).toBe(false);
    expect(hasEditIntent(null)).toBe(false);
    expect(hasEditIntent(undefined)).toBe(false);
  });

  it('requires a word boundary, not a substring', () => {
    expect(hasEditIntent('address the salad')).toBe(false);
    expect(hasEditIntent('droppings')).toBe(false);
  });
});

describe('ensureMealBreakdown', () => {
  const full = { id: 'm1', name: 'T1', itemsBreakdown: [{ name: 'Big Mac', weightGrams: 215 }] };
  const light = { id: 'm1', name: 'T1', nutrients: { calories: 681 } };

  it('passes through meals that already carry dishes', async () => {
    await expect(ensureMealBreakdown(full)).resolves.toBe(full);
    await expect(ensureMealBreakdown({ ...light, items: [{ name: 'X' }] })).resolves.toMatchObject({ id: 'm1' });
  });

  it('hydrates a light D1-pulled row via injected fetch (object and JSON-string forms)', async () => {
    const dishes = [{ name: 'Big Mac', weightGrams: 215 }];
    await expect(ensureMealBreakdown(light, async () => ({ itemsBreakdown: dishes })))
      .resolves.toMatchObject({ id: 'm1', itemsBreakdown: dishes });
    await expect(ensureMealBreakdown(light, async () => ({ items_breakdown: JSON.stringify(dishes) })))
      .resolves.toMatchObject({ id: 'm1', itemsBreakdown: dishes });
  });

  it('keeps the light row when fetch fails, returns null, or has no id', async () => {
    await expect(ensureMealBreakdown(light, async () => { throw new Error('down'); })).resolves.toBe(light);
    await expect(ensureMealBreakdown(light, async () => null)).resolves.toBe(light);
    await expect(ensureMealBreakdown(light)).resolves.toBe(light);
    await expect(ensureMealBreakdown({ name: 'noid' }, async () => ({ itemsBreakdown: [1] })))
      .resolves.toMatchObject({ name: 'noid' });
  });
});

describe('newestSucceededFoodJob (Case-12 T2 blank-draft adoption)', () => {
  const bigMac = { name: 'Big Mac', weightGrams: 215 };
  const t1 = { id: 'job_t1', status: 'succeeded', kind: 'food_log', result: { pendingFoodLog: { id: 'log_t1', itemsBreakdown: [bigMac] } } };
  const stale = { id: 'job_old', status: 'succeeded', kind: 'food_log', result: { pendingFoodLog: { id: 'demo_food_log_3', itemsBreakdown: [] } } };
  const draft = { id: 'job_t2', status: 'running', kind: 'food_log', result: null };

  it('adopts the newest succeeded food job, skipping the current draft', () => {
    expect(newestSucceededFoodJob([stale, t1, draft], 'job_t2')).toBe(t1);
    expect(pendingMealOfJob(t1)).toMatchObject({ id: 'log_t1' });
  });

  it('skips failed jobs, non-food kinds, and jobs with no meal', () => {
    const failed = { id: 'x', status: 'failed', kind: 'food_log', result: { pendingFoodLog: { id: 'z' } } };
    const medical = { id: 'y', status: 'succeeded', kind: 'medical', result: { pendingFoodLog: { id: 'z' } } };
    const nomeal = { id: 'w', status: 'succeeded', kind: 'food_log', result: null };
    expect(newestSucceededFoodJob([failed, medical, nomeal, stale], 'other')).toBe(stale);
    expect(newestSucceededFoodJob([failed, medical, nomeal], 'other')).toBeNull();
    expect(pendingMealOfJob(nomeal)).toBeNull();
  });
});
