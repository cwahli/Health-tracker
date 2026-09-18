import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JobStore } from '../JobStore';
import { previewStatus, previewStatusLabel } from '../jobPreview';
import { mergeFoodEditMessages } from '../mergeFoodEditMessages';
import { scheduleCoalescedJobUpsert, upsertJobToSupabase } from '../SupabaseJobSync';

vi.mock('../SupabaseJobSync', () => ({
  deleteJobFromBackend: vi.fn(async () => {}),
  scheduleCoalescedJobUpsert: vi.fn(),
  upsertJobToSupabase: vi.fn(async () => {}),
}));

vi.mock('idb-keyval', () => {
  const store = new Map();
  return {
    set: async (key: string, val: any) => store.set(key, val),
    get: async (key: string) => store.get(key),
    del: async (key: string) => store.delete(key),
    clear: async () => store.clear(),
  };
});

const prior = {
  pendingFoodLog: {
    name: 'Meal',
    nutrients: { calories: 660 },
    itemsBreakdown: [{ name: 'Sweet Iced Tea', nutrients: { calories: 104 } }],
  },
};

const next = {
  pendingFoodLog: {
    name: 'Grilled Fish and Water Spinach Meal',
    nutrients: { calories: 650 },
    itemsBreakdown: [{ name: 'Unsweetened Iced Tea', nutrients: { calories: 0 } }],
  },
};

describe('JobSession contract (STALE_TURN)', () => {
  beforeEach(() => {
    JobStore.clearForTests();
  });

  it('edit submit shows Updating meal while the prior meal is still on the job', () => {
    JobStore.createJob({
      id: 'tea1',
      status: 'succeeded',
      result: prior,
      finishedAt: new Date(Date.now() - 60_000).toISOString(),
      inputSnapshot: { text: 'Analyze this meal photo.', imageRefs: [], mode: 'review' },
    });
    JobStore.updateJob('tea1', {
      status: 'queued',
      mode: 'edit',
      clientSubmitPending: true,
      inFlightTurnAt: Date.now(),
      finishedAt: undefined,
      inputSnapshot: { text: 'the tea is unsweetened', imageRefs: [], mode: 'edit' },
      statusMessage: 'Updating meal...',
    });
    const job = JobStore.getJob('tea1')!;
    expect(previewStatus(job) === 'queued' || previewStatus(job) === 'running' || previewStatus(job) === 'processing').toBe(true);
    expect(previewStatusLabel(job)).toMatch(/Updating meal/);
    expect(job.result?.pendingFoodLog?.nutrients?.calories).toBe(660);
  });

  it('same-meal succeeded echo does not complete the turn', () => {
    JobStore.createJob({
      id: 'tea2',
      status: 'succeeded',
      result: prior,
      finishedAt: new Date(Date.now() - 60_000).toISOString(),
    });
    JobStore.updateJob('tea2', {
      status: 'queued',
      mode: 'edit',
      clientSubmitPending: true,
      inFlightTurnAt: Date.now(),
      finishedAt: undefined,
      inputSnapshot: { text: 'the tea is unsweetened', imageRefs: [], mode: 'edit' },
    });
    JobStore.updateJob('tea2', {
      status: 'succeeded',
      result: prior,
      messages: [{ role: 'assistant', content: 'old' }],
      inFlightTurnAt: undefined,
      finishedAt: new Date().toISOString(),
    });
    const job = JobStore.getJob('tea2')!;
    expect(job.inFlightTurnAt).toBeGreaterThan(0);
    expect(previewStatusLabel(job)).toMatch(/Updating meal/);
    expect(previewStatus(job)).not.toBe('succeeded');
  });

  it('new Unsweetened snapshot completes to Analysis completed', () => {
    JobStore.createJob({
      id: 'tea3',
      status: 'succeeded',
      result: prior,
      finishedAt: new Date(Date.now() - 60_000).toISOString(),
    });
    JobStore.updateJob('tea3', {
      status: 'queued',
      mode: 'edit',
      clientSubmitPending: true,
      inFlightTurnAt: Date.now(),
      finishedAt: undefined,
      inputSnapshot: { text: 'the tea is unsweetened', imageRefs: [], mode: 'edit' },
    });
    JobStore.updateJob('tea3', {
      status: 'succeeded',
      result: next,
      inFlightTurnAt: undefined,
      finishedAt: new Date().toISOString(),
    });
    const done = JobStore.getJob('tea3')!;
    expect(previewStatus(done)).toBe('succeeded');
    expect(previewStatusLabel(done)).toBe('Analysis completed');
    expect(done.result?.pendingFoodLog?.itemsBreakdown?.[0]?.name).toMatch(/Unsweetened/);
    expect(done.result?.pendingFoodLog?.nutrients?.calories).toBe(650);
  });

  it('keeps one food card on merge', () => {
    const original = {
      id: 'a1',
      role: 'assistant',
      pendingFoodLog: prior.pendingFoodLog,
      data: { pendingFoodLog: prior.pendingFoodLog },
    };
    const user = { id: 'u2', role: 'user', content: 'the tea is unsweetened' };
    const assistant = {
      id: 'a2',
      role: 'assistant',
      content: 'Unsweetened Iced Tea is 0 kcal',
      pendingFoodLog: next.pendingFoodLog,
      data: { pendingFoodLog: next.pendingFoodLog, mode: 'modify' },
    };
    const merged = mergeFoodEditMessages([original, user], assistant);
    expect(merged.filter((m: any) => m.data?.pendingFoodLog || m.pendingFoodLog)).toHaveLength(1);
  });

  it('prevents duplicate assistant messages when multiple completion events arrive for same job', () => {
    JobStore.createJob({
      id: 'job-multi-event',
      status: 'queued',
      inFlightTurnAt: Date.now(),
      messages: [
        { role: 'user', content: 'Analyze this meal photo.' }
      ],
      inputSnapshot: { text: 'Analyze this meal photo.', imageRefs: [], mode: 'review' },
    });

    const assistantMsg1 = {
      id: 'msg_assistant_1',
      role: 'assistant',
      content: 'Meal analyzed: 650 kcal',
      pendingFoodLog: next.pendingFoodLog,
    };

    JobStore.apply({
      type: 'AnalyzeFinished',
      id: 'job-multi-event',
      status: 'succeeded',
      inFlightTurnAt: undefined,
      finishedAt: new Date().toISOString(),
      result: next,
      messages: [assistantMsg1],
    });

    const assistantMsg2 = {
      id: 'msg_assistant_2',
      role: 'assistant',
      content: 'Meal analyzed: 650 kcal (updated)',
      pendingFoodLog: next.pendingFoodLog,
    };

    JobStore.apply({
      type: 'PollerPayload',
      id: 'job-multi-event',
      status: 'succeeded',
      result: next,
      messages: [assistantMsg2],
    });

    JobStore.apply({
      type: 'RealtimeRow',
      id: 'job-multi-event',
      status: 'succeeded',
    });

    const job = JobStore.getJob('job-multi-event')!;
    const assistantMessages = (job.messages || []).filter((m: any) => m.role === 'assistant');
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0].content).toBe('Meal analyzed: 650 kcal (updated)');
  });

  it('F-9.5 SubmitStarted writes queued + inFlight without updateJob', () => {
    JobStore.createJob({
      id: 'sub1',
      status: 'draft',
      currentTurn: 1,
      inputSnapshot: { text: 'Analyze this meal photo.', imageRefs: [], mode: 'review' },
    });
    JobStore.apply({
      type: 'SubmitStarted',
      id: 'sub1',
      status: 'queued',
      clientSubmitPending: true,
      inFlightTurnAt: Date.now(),
      currentTurn: 2,
      statusMessage: 'Uploading to server… Keep this tab open',
      inputSnapshot: { text: 'Analyze this meal photo.', imageRefs: ['img'], mode: 'review' },
    });
    const job = JobStore.getJob('sub1')!;
    expect(job.status).toBe('queued');
    expect(job.clientSubmitPending).toBe(true);
    expect(job.currentTurn).toBe(2);
    expect(job.inFlightTurnAt).toBeGreaterThan(0);
    expect(previewStatusLabel(job)).toMatch(/Uploading|Updating|queued|Queued/i);
  });

  it('F-9.5 PollerPayload progress does not require currentTurn and does not clobber turn', () => {
    JobStore.createJob({
      id: 'poll1',
      status: 'queued',
      currentTurn: 3,
      clientSubmitPending: true,
      inFlightTurnAt: Date.now(),
    });
    JobStore.apply({
      type: 'SubmitStarted',
      id: 'poll1',
      status: 'running',
      clientSubmitPending: false,
      statusMessage: 'Analyzing on server...',
    });
    JobStore.apply({
      type: 'PollerPayload',
      id: 'poll1',
      status: 'running',
      statusMessage: 'Vision Scout starting...',
      progressPercent: 15,
    });
    const job = JobStore.getJob('poll1')!;
    expect(job.status).toBe('running');
    expect(job.currentTurn).toBe(3);
    expect(job.progressPercent).toBe(15);
  });

  it('F-9.5 AnalyzeFinished from poller completes with result', () => {
    JobStore.createJob({
      id: 'fin1',
      status: 'running',
      currentTurn: 1,
      inFlightTurnAt: Date.now(),
      messages: [{ role: 'user', content: 'log meal' }],
    });
    JobStore.apply({
      type: 'AnalyzeFinished',
      id: 'fin1',
      status: 'succeeded',
      result: next,
      messages: [{ role: 'assistant', content: 'done', pendingFoodLog: next.pendingFoodLog }],
      inFlightTurnAt: undefined,
      finishedAt: new Date().toISOString(),
      progressPercent: 100,
      statusMessage: 'Analysis complete',
    });
    const job = JobStore.getJob('fin1')!;
    expect(job.status).toBe('succeeded');
    expect(job.currentTurn).toBe(1);
    expect(job.result?.pendingFoodLog?.nutrients?.calories).toBe(650);
    expect(previewStatus(job)).toBe('succeeded');
  });

  it('duplicate completions route through the coalesced scheduler, never direct upserts (DIAG4 storm guard)', () => {
    vi.mocked(scheduleCoalescedJobUpsert).mockClear();
    vi.mocked(upsertJobToSupabase).mockClear();
    JobStore.createJob({ id: 'storm1', status: 'running', currentTurn: 1 });
    const finish: any = {
      type: 'AnalyzeFinished',
      id: 'storm1',
      status: 'succeeded',
      result: next,
      finishedAt: new Date().toISOString(),
      progressPercent: 100,
    };
    // Runner + poller + realtime triple-completion, as seen live.
    JobStore.apply({ ...finish });
    JobStore.apply({ ...finish });
    JobStore.apply({ ...finish });
    expect(JobStore.getJob('storm1')!.status).toBe('succeeded');
    expect(vi.mocked(scheduleCoalescedJobUpsert).mock.calls.length).toBeGreaterThan(0);
    // The store hot path must never fire a raw upsert per event.
    expect(vi.mocked(upsertJobToSupabase)).not.toHaveBeenCalled();
  });

  it('compare completion preserves mode=evaluation + comparison through the store (group render boundary)', () => {
    // Live shape (debug-job_1789204750819): the App.tsx poller finalize reads
    // job.result for mode/comparison. If the store dropped either, group
    // cards never render on the server-owned polling path.
    const compareResult: any = {
      mode: 'evaluation',
      message: 'shelf summary',
      comparison: {
        comparisonTitle: 'Shelf',
        groups: [{ groupName: 'Tier 1', verdict: { level: 'good', label: 'x' }, comparisonSentence: 's', message: 'm', items: [{ name: 'A' }] }],
        items: [{ name: 'A' }],
        recommendedOption: 'A',
      },
      scoutItems: [{ keyword: 'A' }],
    };
    JobStore.createJob({ id: 'cmp1', status: 'running', currentTurn: 1 });
    JobStore.apply({
      type: 'AnalyzeFinished',
      id: 'cmp1',
      status: 'succeeded',
      result: compareResult,
      finishedAt: new Date().toISOString(),
      progressPercent: 100,
    });
    const stored = JobStore.getJob('cmp1')!.result as any;
    expect(stored.mode).toBe('evaluation');
    expect(stored.comparison?.groups?.length).toBe(1);
    expect(stored.comparison?.recommendedOption).toBe('A');
  });
});
