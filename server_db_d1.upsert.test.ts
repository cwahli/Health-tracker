import { describe, it, expect, beforeEach, vi } from 'vitest';

// Sensor for the Nov 5 meal-result loss: the client JobStore re-posts its local
// snapshot on every store change, and that snapshot can be a welcome/live
// skeleton while the realtime status row arrives before the result payload.
// The blind ON CONFLICT overwrite then erased the server-authored result. The
// d1UpsertJob client guard must keep the richer side.

const h = vi.hoisted(() => ({
  queries: [] as { sql: string; params: any[] }[],
  state: {
    selectResults: [] as any[],
    upsertResult: { success: true } as { success: boolean; error?: string },
  },
}));

vi.mock('./server_d1.js', () => ({
  isD1Configured: () => true,
  safeJsonParse: (raw: any, fallback: any) => {
    if (raw == null) return fallback;
    if (typeof raw !== 'string') return raw;
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  d1Query: async (sql: string, params: any[] = []) => {
    h.queries.push({ sql, params });
    if (sql.startsWith('SELECT')) return { success: true, results: h.state.selectResults };
    return h.state.upsertResult;
  },
}));

import { d1UpsertJob, cleanResultHasJobPayload } from './server_db_d1.js';

const MEAL_RESULT = {
  pendingFoodLog: { id: 'meal_1', name: 'Groceries', calories: 300 },
  message: 'Logged Groceries successfully into your daily ledger. Pair it with colorful vegetables.',
  text: 'Logged Groceries successfully into your daily ledger. Pair it with colorful vegetables.',
};

const SKELETON = {
  sessionEvents: [{ ts: 1, writer: 'realtime', status: 'succeeded', action: 'RealtimeRow' }],
  messages: [
    { id: 'welcome', role: 'assistant', content: 'Hello! Tell me what you plan to eat.' },
    { id: 'msg_live', role: 'assistant', content: 'Analyzing your meal in the background...' },
  ],
};

function latestInsert() {
  return h.queries.filter((q) => q.sql.includes('INSERT INTO agent_jobs')).pop();
}

beforeEach(() => {
  h.queries.length = 0;
  h.state.selectResults = [];
  h.state.upsertResult = { success: true };
});

describe('cleanResultHasJobPayload', () => {
  it('treats a welcome/live skeleton as no payload', () => {
    expect(cleanResultHasJobPayload(SKELETON)).toBe(false);
    expect(cleanResultHasJobPayload(JSON.stringify(SKELETON))).toBe(false);
    expect(cleanResultHasJobPayload(null)).toBe(false);
    expect(cleanResultHasJobPayload('{}')).toBe(false);
  });

  it('treats meal results and R2 pointers as payload', () => {
    expect(cleanResultHasJobPayload(MEAL_RESULT)).toBe(true);
    expect(cleanResultHasJobPayload(JSON.stringify(MEAL_RESULT))).toBe(true);
    expect(cleanResultHasJobPayload({ is_r2: true, r2_url: 'https://cdn/job.json' })).toBe(true);
    expect(cleanResultHasJobPayload({ needsPortionClarify: true })).toBe(true);
  });

  it('ignores short status placeholder text', () => {
    expect(cleanResultHasJobPayload({ message: 'Analysis complete' })).toBe(false);
    expect(cleanResultHasJobPayload({ message: 'x'.repeat(60) })).toBe(true);
  });
});

describe('d1UpsertJob client guard (meal-result loss)', () => {
  it('keeps the stored result, photo and completion state when the client snapshot has none', async () => {
    h.state.selectResults = [
      {
        status: 'succeeded',
        progress_percent: 100,
        status_message: 'Analysis complete',
        photo_url: 'https://cdn.example/photo.jpg',
        debug_url: null,
        clean_result: JSON.stringify(MEAL_RESULT),
      },
    ];

    const res = await d1UpsertJob(
      {
        id: 'job_1',
        user_id: 'u1',
        kind: 'food_log',
        mode: 'review',
        status: 'succeeded',
        progress_percent: 100,
        status_message: 'Analysis complete',
        clean_result: SKELETON,
      },
      { source: 'client' }
    );

    expect(res.success).toBe(true);
    const insert = latestInsert();
    expect(insert).toBeTruthy();
    expect(insert!.params[4]).toBe('succeeded');
    expect(insert!.params[5]).toBe(100);
    expect(insert!.params[6]).toBe('Analysis complete');
    expect(insert!.params[7]).toBe('https://cdn.example/photo.jpg');
    expect(JSON.parse(insert!.params[9]).pendingFoodLog.name).toBe('Groceries');
  });

  it('accepts a richer client snapshot', async () => {
    h.state.selectResults = [
      {
        status: 'running',
        progress_percent: 15,
        status_message: 'Looking at your photo',
        photo_url: null,
        debug_url: null,
        clean_result: JSON.stringify(SKELETON),
      },
    ];
    const richer = { ...MEAL_RESULT, pendingFoodLog: { id: 'meal_2', name: 'Chicken Hotpot', calories: 900 } };

    await d1UpsertJob(
      {
        id: 'job_2',
        user_id: 'u1',
        kind: 'food_log',
        mode: 'review',
        status: 'succeeded',
        progress_percent: 100,
        status_message: 'Analysis complete',
        photo_url: 'https://cdn.example/hotpot.jpg',
        clean_result: richer,
      },
      { source: 'client' }
    );

    const insert = latestInsert();
    expect(insert!.params[4]).toBe('succeeded');
    expect(insert!.params[6]).toBe('Analysis complete');
    expect(insert!.params[7]).toBe('https://cdn.example/hotpot.jpg');
    expect(JSON.parse(insert!.params[9]).pendingFoodLog.name).toBe('Chicken Hotpot');
  });

  it('keeps the stored photo even when the incoming result omits it', async () => {
    h.state.selectResults = [
      {
        status: 'succeeded',
        progress_percent: 100,
        status_message: 'Analysis complete',
        photo_url: 'https://cdn.example/kept.jpg',
        debug_url: null,
        clean_result: JSON.stringify(MEAL_RESULT),
      },
    ];

    await d1UpsertJob(
      {
        id: 'job_3',
        user_id: 'u1',
        kind: 'food_log',
        mode: 'review',
        status: 'succeeded',
        clean_result: MEAL_RESULT,
      },
      { source: 'client' }
    );

    expect(latestInsert()!.params[7]).toBe('https://cdn.example/kept.jpg');
  });

  it('does not run the guard for trusted server writes', async () => {
    h.state.selectResults = [
      { status: 'succeeded', clean_result: JSON.stringify(MEAL_RESULT), photo_url: 'https://cdn.example/old.jpg' },
    ];

    await d1UpsertJob(
      {
        id: 'job_4',
        user_id: 'u1',
        kind: 'food_log',
        mode: 'review',
        status: 'running',
        clean_result: null,
      },
      { source: 'server' }
    );

    expect(h.queries.some((q) => q.sql.startsWith('SELECT'))).toBe(false);
    const insert = latestInsert();
    expect(insert!.params[4]).toBe('running');
    // Trusted server writes keep the historical 'null' stringify (serverJobs
    // job-start resets pass clean_result: null); safeJsonParse maps it back.
    expect(insert!.params[9]).toBe('null');
  });

  it('writes normally when the job row is new', async () => {
    await d1UpsertJob(
      {
        id: 'job_5',
        user_id: 'u1',
        kind: 'food_log',
        mode: 'review',
        status: 'queued',
        clean_result: SKELETON,
      },
      { source: 'client' }
    );

    const insert = latestInsert();
    expect(insert!.params[4]).toBe('queued');
    expect(JSON.parse(insert!.params[9]).messages).toHaveLength(2);
  });
});
