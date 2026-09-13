/**
 * Q-8.1 food process audit board — QUALITY.md §1.3.1 exits as dummy rows.
 * Each it() calls a real helper. Historical Soto captures stay red in dumpContract.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JobStore, isStalePriorTurn } from '../src/jobs/JobStore';
import { inMemoryServerJobs, publishResultReady, getInMemoryServerJob } from '../serverJobs';
import { attachSseJsonResponder, parseSseFinalResult } from '../server_sse_json';
import { nextGeminiFallbackEngine, GEMINI_FALLBACK_ENGINE } from '../server_gemini_retry';
import { classifyDump } from '../src/utils/dumpContract';
import { buildCanonicalRunTree } from '../src/utils/debugRunTree';
import { shouldRunHandoffAutoSend } from '../src/utils/chatAutoSend';

vi.mock('idb-keyval', () => {
  const store = new Map();
  return {
    set: async (key: string, val: any) => store.set(key, val),
    get: async (key: string) => store.get(key),
    del: async (key: string) => store.delete(key),
    clear: async () => store.clear(),
    keys: async () => Array.from(store.keys()),
  };
});

/** QUALITY.md §1.3.1 food-process exits. Class ids so a row cannot be dropped silently. */
export const FOOD_PROCESS_EXITS = [
  { exit: 'Submit JSON is running once worker started', class: 'QUEUE_LIE' },
  { exit: 'Food SSE res.json is {final:true,result}', class: 'DEGRADE_NOT_TERMINAL' },
  { exit: 'Ledger exists + dietitian/scout dead → job terminal', class: 'DEGRADE_NOT_TERMINAL' },
  { exit: 'pendingFoodLog → in-memory succeeded before R2', class: 'DISPLAY_LAG' },
  { exit: 'getQueue includes running with no meal', class: 'DISPLAY_LAG' },
  { exit: 'Empty prior meal key is not a stale-edit echo', class: 'STALE_TURN' },
  { exit: 'AnalyzeFinished at most once', class: 'COMPLETE_ONCE' },
  { exit: '90s stall / 503 / quota → hop 3.1 same job', class: 'STALL_NO_FALLBACK' },
  { exit: 'Cooldown on 3.5 hops to 3.1; do not throw switch models as the hop path', class: 'STALL_NO_FALLBACK' },
  { exit: 'Card is not Attempt 1/3 / Retry when succeeded with kcal', class: 'DISPLAY_LAG' },
  { exit: 'awaiting_user (portion) is a pause, not a fail', class: 'AWAITING_USER_PAUSE' },
  { exit: 'Realtime failed echo must not clobber an in-flight retry', class: 'FAILED_ECHO_NO_CLOBBER' },
] as const;

/** RELIABILITY.md §11.12 A–F (debug contract gaps that the board must still name). */
export const RELIABILITY_11_12_AF = ['A', 'B', 'C', 'D', 'E', 'F'] as const;

const SOTO_KCAL = 337;
const STALL_ERR = new Error(
  'Stream stalled: Vision Scout (gemini-3.5-flash-lite) produced no tokens for 90s after the prompt. Switch to gemini-3.1-flash-lite.'
);
const FALLBACK_LOG =
  '[backend] [UnifiedLLM] gemini-3.5-flash-lite stalled/unavailable — falling back to gemini-3.1-flash-lite on the same job (no user retry).';

function dummyHappySotoTree(overrides: Record<string, unknown> = {}) {
  return buildCanonicalRunTree({
    jobId: 'job_dummy_soto',
    pack: 'food',
    status: 'succeeded',
    pendingFoodLog: { name: 'Soto', nutrients: { calories: SOTO_KCAL, protein: 28 } },
    backendLogs: [
      '[Vision Scout] ok (1200ms)',
      `[Budget] Finalized ledger for "Soto": ${SOTO_KCAL} kcal`,
      FALLBACK_LOG,
      'AnalyzeFinished succeeded',
    ].join('\n'),
    sessionEvents: [{ writer: 'JobQueueRunner', status: 'succeeded', message: 'result_ready' }],
    dialogInventory: {
      open: true,
      title: 'Soto',
      on_card: { kcal: SOTO_KCAL, protein: 28 },
      visible: ['View Analysis', 'Download Debug'],
      hidden: ['Retry', 'Attempt 1 of 3'],
      composer: { photo: 1, add_image: 1, paste: 1, send: 1 },
    },
    dispatches: [
      { id: 't1/scout', agent: 'scout', model: 'gemini-3.5-flash-lite', latency_ms: 1200 },
      { id: 't1/dietitian', agent: 'dietitian', model: 'gemini-3.1-flash-lite', latency_ms: 800 },
    ],
    clientConsoleLogs: ['[job_dummy_soto] AnalyzeFinished succeeded'],
    networkErrors: [],
    ...overrides,
  });
}

describe('Q-8.1 food process audit board', () => {
  beforeEach(() => {
    JobStore.clearForTests();
    inMemoryServerJobs.clear();
  });

  it('Q-8.1 audit lists every §1.3.1 food exit', () => {
    expect(FOOD_PROCESS_EXITS.map((row) => row.class)).toEqual([
      'QUEUE_LIE',
      'DEGRADE_NOT_TERMINAL',
      'DEGRADE_NOT_TERMINAL',
      'DISPLAY_LAG',
      'DISPLAY_LAG',
      'STALE_TURN',
      'COMPLETE_ONCE',
      'STALL_NO_FALLBACK',
      'STALL_NO_FALLBACK',
      'DISPLAY_LAG',
      'AWAITING_USER_PAUSE',
      'FAILED_ECHO_NO_CLOBBER',
    ]);
    expect(new Set(FOOD_PROCESS_EXITS.map((row) => row.class))).toEqual(
      new Set([
        'QUEUE_LIE',
        'DEGRADE_NOT_TERMINAL',
        'DISPLAY_LAG',
        'STALE_TURN',
        'COMPLETE_ONCE',
        'STALL_NO_FALLBACK',
        'AWAITING_USER_PAUSE',
        'FAILED_ECHO_NO_CLOBBER',
      ])
    );
    expect(RELIABILITY_11_12_AF).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
  });

  it('QUEUE_LIE: running is not clobbered back to queued', () => {
    JobStore.createJob({ id: 'q-lie', status: 'queued' });
    JobStore.apply({ type: 'ServerStatus', id: 'q-lie', status: 'running' });
    JobStore.updateJob('q-lie', { status: 'queued', clientSubmitPending: false });
    expect(JobStore.getJob('q-lie')?.status).toBe('running');
  });

  it('DEGRADE_NOT_TERMINAL: food SSE res.json is {final:true,result}', () => {
    const writes: string[] = [];
    const res: any = { headersSent: true, write: (c: string) => writes.push(c), end: () => {} };
    attachSseJsonResponder(res);
    res.json({ pendingFoodLog: { name: 'Soto', nutrients: { calories: SOTO_KCAL } }, degradedStages: ['dietitian'] });
    expect(writes[0]).toMatch(/"final":true/);
    const result = parseSseFinalResult(writes[0]);
    expect(result.pendingFoodLog.nutrients.calories).toBe(SOTO_KCAL);
    expect(result.degradedStages).toEqual(['dietitian']);
  });

  it('DEGRADE_NOT_TERMINAL: ledger + dietitian dead still publishes terminal succeeded', () => {
    inMemoryServerJobs.set('job_degrade', {
      id: 'job_degrade',
      status: 'running',
      clean_result: null,
      sessionEvents: [],
    });
    expect(
      publishResultReady('job_degrade', {
        pendingFoodLog: { name: 'Soto', nutrients: { calories: SOTO_KCAL } },
        degradedStages: ['dietitian'],
      })
    ).toBe(true);
    expect(getInMemoryServerJob('job_degrade').status).toBe('succeeded');

    const tree = dummyHappySotoTree({
      jobId: 'job_degrade_dummy',
      backendLogs: [
        `[Budget] Finalized ledger for "Soto": ${SOTO_KCAL} kcal`,
        '[error] Dietitian Failed Permanently',
        '[error] 503 Service Unavailable',
        FALLBACK_LOG,
        'AnalyzeFinished succeeded',
      ].join('\n'),
    });
    const fails = classifyDump(tree);
    expect(fails.some((f) => f.id === 'JOB_TERMINAL_IF_LEDGER')).toBe(false);
    expect(fails.length).toBe(0);
  });

  it('DISPLAY_LAG: pendingFoodLog flips in-memory succeeded before R2', () => {
    inMemoryServerJobs.set('job_lag', {
      id: 'job_lag',
      status: 'running',
      clean_result: null,
      sessionEvents: [],
    });
    expect(
      publishResultReady('job_lag', { pendingFoodLog: { name: 'Soto', nutrients: { calories: SOTO_KCAL } } })
    ).toBe(true);
    expect(getInMemoryServerJob('job_lag').status).toBe('succeeded');
    expect(getInMemoryServerJob('job_lag').progress_percent).toBe(100);
  });

  it('DISPLAY_LAG: getQueue includes running with no meal', () => {
    JobStore.createJob({ id: 'run-empty', status: 'queued' });
    JobStore.updateJob('run-empty', { status: 'running' });
    expect(JobStore.getQueue().map((j) => j.id)).toContain('run-empty');
  });

  it('STALE_TURN: empty prior meal key is not a stale-edit echo', () => {
    const now = Date.now();
    expect(
      isStalePriorTurn(
        { status: 'running', inFlightTurnAt: now, finishedAt: undefined },
        'succeeded',
        new Date(now + 1_000).toISOString()
      )
    ).toBe(false);

    JobStore.createJob({ id: 'new-meal', status: 'running', inFlightTurnAt: now, finishedAt: undefined });
    JobStore.updateJob('new-meal', { status: 'succeeded', statusMessage: 'Analysis complete' });
    expect(JobStore.getJob('new-meal')?.status).toBe('succeeded');
  });

  it('COMPLETE_ONCE: publishResultReady does not republish; AnalyzeFinished count=1 is green', () => {
    inMemoryServerJobs.set('job_once', {
      id: 'job_once',
      status: 'succeeded',
      clean_result: { pendingFoodLog: { name: 'Soto', nutrients: { calories: SOTO_KCAL } } },
    });
    expect(
      publishResultReady('job_once', {
        pendingFoodLog: { name: 'Soto', nutrients: { calories: 999 } },
      })
    ).toBe(false);
    expect(getInMemoryServerJob('job_once').clean_result.pendingFoodLog.nutrients.calories).toBe(SOTO_KCAL);

    const tree = dummyHappySotoTree();
    const afLaw = tree.contract.find((c) => c.law === 'AnalyzeFinished count = 1');
    expect(afLaw?.result).toBe('PASS');
    expect(classifyDump(tree).some((f) => f.id === 'ANALYZE_FINISHED_ONCE')).toBe(false);
  });

  it('STALL_NO_FALLBACK: 90s stall hops to 3.1 on the same job', () => {
    expect(nextGeminiFallbackEngine('gemini-3.5-flash-lite', STALL_ERR, false)).toBe(GEMINI_FALLBACK_ENGINE);
    const tree = dummyHappySotoTree({
      backendLogs: [
        '[error] Stream stalled: Vision Scout (gemini-3.5-flash-lite) produced no tokens for 90s after the prompt.',
        FALLBACK_LOG,
        `[Budget] Finalized ledger for "Soto": ${SOTO_KCAL} kcal`,
        'AnalyzeFinished succeeded',
      ].join('\n'),
    });
    expect(classifyDump(tree).some((f) => f.id === 'STALL_FALLBACK_SAME_JOB')).toBe(false);
    expect(classifyDump(tree).length).toBe(0);
  });

  it('STALL_NO_FALLBACK: quota cooldown hops to 3.1 instead of throwing switch-models', () => {
    expect(
      nextGeminiFallbackEngine('gemini-3.5-flash-lite', new Error('quota cooldown 40s'), false)
    ).toBe(GEMINI_FALLBACK_ENGINE);
    const tree = dummyHappySotoTree({
      backendLogs: [
        '[error] quota cooldown 40s',
        FALLBACK_LOG,
        `[Budget] Finalized ledger for "Soto": ${SOTO_KCAL} kcal`,
        'AnalyzeFinished succeeded',
      ].join('\n'),
    });
    expect(classifyDump(tree).some((f) => f.id === 'STALL_FALLBACK_SAME_JOB')).toBe(false);
    expect(classifyDump(tree).length).toBe(0);
  });

  it('DISPLAY_LAG: succeeded card hides Retry / Attempt 1/3 and on_card matches ledger', () => {
    const tree = dummyHappySotoTree();
    expect(tree.dialogInventory?.hidden).toEqual(expect.arrayContaining(['Retry', 'Attempt 1 of 3']));
    expect(tree.dialogInventory?.on_card?.kcal).toBe(SOTO_KCAL);
    const retryLaw = tree.contract.find((c) => c.law === 'Retry hidden if succeeded or kcal in logs');
    const attemptLaw = tree.contract.find((c) => c.law === 'Attempt 1/3 hidden if succeeded');
    const cardLaw = tree.contract.find((c) => c.law === 'Dialog on_card kcal = ledger');
    expect(retryLaw?.result).toBe('PASS');
    expect(attemptLaw?.result).toBe('PASS');
    expect(cardLaw?.result).toBe('PASS');
    expect(classifyDump(tree).some((f) => f.class === 'DISPLAY_LAG')).toBe(false);
    expect(shouldRunHandoffAutoSend({
      isOpen: true,
      type: 'food',
      agentType: null,
      autoSendMessage: null,
      hasHandoffPayload: false,
      effectiveAutoSend: null,
    }).run).toBe(false);
  });

  it('AWAITING_USER_PAUSE: portion pause is not failed / STALL / DEGRADE', () => {
    JobStore.createJob({ id: 'portion', status: 'running' });
    JobStore.updateJob('portion', {
      status: 'awaiting_user',
      result: { portionClarify: { items: ['rice'] }, message: 'Confirm how much you ate' },
    });
    expect(JobStore.getJob('portion')?.status).toBe('awaiting_user');
    expect(JobStore.getJob('portion')?.status).not.toBe('failed');

    const tree = buildCanonicalRunTree({
      jobId: 'job_portion',
      pack: 'food',
      status: 'awaiting_user',
      backendLogs: '[portionClarify] confirm grams for rice',
      dialogInventory: {
        open: true,
        visible: ['Confirm portion'],
        hidden: ['Retry', 'Attempt 1 of 3'],
      },
    });
    const fails = classifyDump(tree);
    expect(fails.some((f) => f.class === 'STALL_NO_FALLBACK' || f.class === 'DEGRADE_NOT_TERMINAL')).toBe(false);
  });

  it('FAILED_ECHO_NO_CLOBBER: realtime failed from a prior attempt does not wipe a newer retry', () => {
    const t0 = Date.now();
    JobStore.createJob({
      id: 'echo-fail',
      status: 'failed',
      attemptCount: 1,
      error: { class: 'permanent', message: 'prior attempt failed' },
    });
    JobStore.updateJob('echo-fail', {
      status: 'queued',
      attemptCount: 2,
      clientSubmitPending: true,
      inFlightTurnAt: t0,
      finishedAt: undefined,
      error: undefined,
    });
    JobStore.updateJob('echo-fail', { status: 'running', clientSubmitPending: false });
    JobStore.apply({
      type: 'RealtimeRow',
      id: 'echo-fail',
      status: 'failed',
      updatedAt: new Date(t0 - 60_000).toISOString(),
      inFlightTurnAt: undefined,
      finishedAt: new Date().toISOString(),
      error: { class: 'permanent', message: 'prior attempt failed' },
    } as any);
    expect(JobStore.getJob('echo-fail')?.status).toBe('running');
    expect(JobStore.getJob('echo-fail')?.inFlightTurnAt).toBe(t0);
  });

  it('dummy Soto-like CanonicalRunTree classifies green (historical capture stays red elsewhere)', () => {
    const tree = dummyHappySotoTree();
    expect(tree.status).toBe('succeeded');
    expect(tree.pendingFoodLog.nutrients.calories).toBe(SOTO_KCAL);
    expect(tree.contract.some((c) => c.law === 'AnalyzeFinished count = 1' && c.result === 'PASS')).toBe(true);
    expect(classifyDump(tree)).toEqual([]);
  });

  it('EDIT_COMPONENT_PRESERVED: multi-turn edit preserves components and passes contract', () => {
    const tree = buildCanonicalRunTree({
      jobId: 'job_edit_soto',
      pack: 'food',
      status: 'succeeded',
      dispatches: [
        { id: 't1/scout', agent: 'scout', turn: 1, model: 'gemini-3.5-flash-lite', latency_ms: 1200 },
        { id: 't2/scout', agent: 'scout', turn: 2, model: 'gemini-3.5-flash-lite', latency_ms: 1100, received: { mode: 'edit' } },
      ],
      pendingFoodLog: {
        dishes: [
          {
            dishName: 'Beef and Vegetable Hotpot',
            weightGrams: 550,
            foods: [
              { name: 'Beef Slices', weightGrams: 120 },
              { name: 'Tofu', weightGrams: 100 },
              { name: 'Shirataki Noodles', weightGrams: 100 },
              { name: 'Napa Cabbage and Vegetables', weightGrams: 180 },
              { name: 'Potato', weightGrams: 50 },
            ],
            nutrients: { calories: 401, protein: 33, totalFat: 14, carbohydrates: 22.8, sodium: 108 },
          },
        ],
      },
    });
    expect(tree.contract.some((c) => c.law === 'Edit patch: components & nutrients preserved' && c.result === 'PASS')).toBe(true);
    expect(classifyDump(tree)).toEqual([]);
  });
});
