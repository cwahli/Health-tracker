import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scheduleCoalescedJobUpsert } from '../SupabaseJobSync';

/**
 * Upsert storm guard sensor: JobStore.apply fires on EVERY job event and
 * completion applies AnalyzeFinished 2-3x within milliseconds. Bursts of
 * scheduleCoalescedJobUpsert must collapse to one active + one trailing run,
 * always ending on the latest snapshot.
 */
describe('scheduleCoalescedJobUpsert', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('collapses a burst of schedules into active + trailing with the latest snapshot', async () => {
    const posted: any[] = [];
    global.fetch = vi.fn(async (_url: any, opts: any) => {
      posted.push(JSON.parse(opts.body).payload);
      return { ok: true, status: 200, json: async () => ({}) };
    }) as any;

    const base: any = { id: 'job_coalesce_1', kind: 'food_log', status: 'succeeded' };
    scheduleCoalescedJobUpsert({ ...base, result: { v: 1 } });
    scheduleCoalescedJobUpsert({ ...base, result: { v: 2 } });
    scheduleCoalescedJobUpsert({ ...base, result: { v: 3 } });
    await new Promise((r) => setTimeout(r, 50));

    // 3 schedules -> 2 backend upserts (active + one trailing), not 3.
    expect(posted.length).toBe(2);
    // The trailing run carries the latest snapshot.
    expect(posted[1].clean_result?.v).toBe(3);
  });

  it('runs a lone schedule exactly once', async () => {
    let calls = 0;
    global.fetch = vi.fn(async () => {
      calls++;
      return { ok: true, status: 200, json: async () => ({}) };
    }) as any;

    scheduleCoalescedJobUpsert({ id: 'job_coalesce_2', kind: 'food_log', status: 'succeeded', result: {} } as any);
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toBe(1);
  });
});
