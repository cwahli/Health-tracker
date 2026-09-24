import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JobStore, isJobBlank, isStalePriorTurn } from '../JobStore';
import { ImageStore } from '../ImageStore';
import { processJobRows } from '../BackendJobSync';
import { uniqueMealImageUrls } from '../../utils/foodImageSources';

vi.mock('idb-keyval', () => {
  const store = new Map();
  return {
    set: async (key: string, val: any) => store.set(key, val),
    get: async (key: string) => store.get(key),
    del: async (key: string) => store.delete(key),
    clear: async () => store.clear(),
  };
});

describe('JobStore', () => {
  beforeEach(() => {
    // Reset JobStore completely for isolated test runs
    JobStore.clearForTests();
  });

  it('resetAllJobs clears threads but keeps subscribers notified', async () => {
    let notified = 0;
    const unsub = JobStore.subscribe(() => { notified++; });
    JobStore.createJob({ id: 'r1' });
    JobStore.createJob({ id: 'r2' });
    expect(JobStore.getAllJobs().length).toBe(2);
    JobStore.resetAllJobs();
    expect(JobStore.getAllJobs().length).toBe(0);
    expect(JobStore.getJob('r1')).toBeUndefined();
    expect(notified).toBeGreaterThan(0);
    unsub();
  });

  it('creates, updates and deletes a job', async () => {
    const job = JobStore.createJob({ id: 'j1' });
    expect(job.status).toBe('draft');

    JobStore.updateJob('j1', { status: 'queued' });
    expect(JobStore.getJob('j1')?.status).toBe('queued');

    await JobStore.deleteJob('j1');
    expect(JobStore.getJob('j1')).toBeUndefined();
  });

  it('maintains FIFO order in getQueue', () => {
    JobStore.createJob({ id: 'j1' });
    JobStore.createJob({ id: 'j2' });
    
    JobStore.updateJob('j1', { status: 'queued' });
    JobStore.updateJob('j2', { status: 'queued' });

    const q = JobStore.getQueue();
    expect(q.length).toBe(2);
    expect(q[0].id).toBe('j1');
    expect(q[1].id).toBe('j2');
  });

  it('rejects queued job if maxQueued=5 is reached', () => {
    for (let i = 1; i <= 5; i++) {
      JobStore.createJob({ id: `j${i}` });
      JobStore.updateJob(`j${i}`, { status: 'queued' });
    }

    JobStore.createJob({ id: 'j6' });
    expect(() => {
      JobStore.updateJob('j6', { status: 'queued' });
    }).toThrow('maxQueued limit reached');
  });

  it('draft auto-delete works in store tests', async () => {
    const job = JobStore.createJob({ id: 'draft1' });
    await ImageStore.putImages('draft1', ['img1', 'img2']);
    
    await JobStore.deleteJob('draft1');
    
    const imgs = await ImageStore.getImages('draft1');
    expect(imgs.length).toBe(0);
  });

  it('subscribers are notified', () => {
    let calls = 0;
    const unsub = JobStore.subscribe(() => calls++);
    JobStore.createJob({ id: 's1' });
    JobStore.updateJob('s1', { status: 'queued' });
    expect(calls).toBe(2);
    unsub();
    JobStore.updateJob('s1', { status: 'running' });
    expect(calls).toBe(2);
  });

  it('correctly detects blank jobs vs valid jobs', () => {
    // Draft is considered blank
    expect(isJobBlank({ status: 'draft' as any })).toBe(true);

    // Empty succeeded job with no text, image, or results is blank
    expect(isJobBlank({ id: 'b1', status: 'succeeded' as any })).toBe(true);

    // Job with valid text input
    expect(isJobBlank({ id: 'b2', status: 'queued' as any, inputSnapshot: { text: '2 eggs and toast', imageRefs: [] } })).toBe(false);

    // Job with photo URL
    expect(isJobBlank({ id: 'b3', status: 'queued' as any, photoUrl: 'data:image/jpeg;base64,...' })).toBe(false);

    // Job with food result
    expect(isJobBlank({
      id: 'b4',
      status: 'succeeded' as any,
      result: { pendingFoodLog: { foodName: 'Oatmeal with berries', calories: 250 } } as any
    })).toBe(false);

    // Job with medical result
    expect(isJobBlank({
      id: 'b5',
      status: 'succeeded' as any,
      result: { biomarkers: { glucose: 95 } } as any
    })).toBe(false);
  });

  it('re-queues a succeeded meal for an edit turn and then allows running', () => {
    JobStore.createJob({
      id: 'edit1',
      status: 'succeeded',
      result: {
        pendingFoodLog: {
          name: 'Ikan Bakar Set with Cah Kangkung and Es Teh Manis',
          nutrients: { calories: 695, protein: 43.7 },
          itemsBreakdown: [
            { name: 'Es Teh Manis', nutrients: { calories: 84 } },
            { name: 'Cah Kangkung', nutrients: { calories: 142 } },
            { name: 'Ikan Bakar Set with Rice and Sambal', nutrients: { calories: 469 } },
          ],
        },
      },
      inputSnapshot: { text: 'Analyze this meal photo.', imageRefs: [], mode: 'review' },
    });

    // 1. Client submit: queued + clientSubmitPending
    JobStore.updateJob('edit1', {
      status: 'queued',
      mode: 'edit',
      inputSnapshot: { text: 'the tea is unsweetened', imageRefs: [], mode: 'edit' },
      clientSubmitPending: true,
      serverSubmittedAt: Date.now(),
      statusMessage: 'Updating meal...',
    });
    expect(JobStore.getJob('edit1')?.status).toBe('queued');

    // 2. Submit finished: queued without clientSubmitPending. Prior-turn
    // pendingFoodLog is still on the job — must NOT force succeeded.
    JobStore.updateJob('edit1', {
      status: 'queued',
      clientSubmitPending: false,
      statusMessage: 'Updating meal...',
      serverSubmittedAt: Date.now(),
    });
    expect(JobStore.getJob('edit1')?.status).toBe('queued');

    // 3. Queue runner picks it up
    JobStore.updateJob('edit1', { status: 'running', statusMessage: 'Updating meal...' });
    expect(JobStore.getJob('edit1')?.status).toBe('running');
  });

  it('keeps a running new job in the queue until a meal result lands', () => {
    JobStore.createJob({ id: 'poll-me', status: 'queued' });
    JobStore.updateJob('poll-me', { status: 'running', inFlightTurnAt: Date.now() });
    expect(JobStore.getQueue().map((j) => j.id)).toContain('poll-me');
    JobStore.updateJob('poll-me', {
      status: 'succeeded',
      result: { pendingFoodLog: { name: 'Soto', nutrients: { calories: 598 } } },
    });
    expect(JobStore.getJob('poll-me')?.status).toBe('succeeded');
    expect(JobStore.getJob('poll-me')?.inFlightTurnAt).toBeUndefined();
    expect(JobStore.getQueue().map((j) => j.id)).not.toContain('poll-me');
  });

  it('accepts succeeded on a new in-flight job that has no prior meal', () => {
    JobStore.createJob({
      id: 'new-meal',
      status: 'running',
      inFlightTurnAt: Date.now(),
      finishedAt: undefined,
    });
    JobStore.updateJob('new-meal', { status: 'succeeded', statusMessage: 'Analysis complete' });
    const job = JobStore.getJob('new-meal');
    expect(job?.status).toBe('succeeded');
    expect(job?.inFlightTurnAt).toBeUndefined();
    expect(job?.finishedAt).toBeTruthy();
  });

  it('does not let a late submit callback downgrade running back to queued', () => {
    JobStore.createJob({ id: 'live1', status: 'queued' });
    JobStore.updateJob('live1', { status: 'running', statusMessage: 'Analyzing on server...' });
    JobStore.updateJob('live1', { status: 'queued', clientSubmitPending: false, statusMessage: 'Analyzing on server...' });
    expect(JobStore.getJob('live1')?.status).toBe('running');
  });

  it('does not let stale sync downgrade a finished job to queued', () => {
    JobStore.createJob({
      id: 'done1',
      status: 'succeeded',
      result: { pendingFoodLog: { name: 'Oatmeal', nutrients: { calories: 250 } } },
      inputSnapshot: { text: 'oatmeal', imageRefs: [] },
    });

    JobStore.updateJob('done1', { status: 'queued', statusMessage: 'Analyzing on server...' });
    expect(JobStore.getJob('done1')?.status).toBe('succeeded');
  });

  it('allows retry of a succeeded job when attemptCount increases', () => {
    JobStore.createJob({
      id: 'retry1',
      status: 'succeeded',
      attemptCount: 1,
      result: { pendingFoodLog: { name: 'Soup', degradedStages: ['diet'] } },
    });

    JobStore.updateJob('retry1', {
      status: 'queued',
      attemptCount: 2,
      clientSubmitPending: false,
      statusMessage: 'Retrying AI advice (Attempt 2)...',
    });
    expect(JobStore.getJob('retry1')?.status).toBe('queued');
  });

  it('keeps Updating state when a succeeded echo still has the prior meal', () => {
    const prior = { pendingFoodLog: { name: 'Meal', nutrients: { calories: 660 }, itemsBreakdown: [{ name: 'Sweet Iced Tea', nutrients: { calories: 104 } }] } };
    JobStore.createJob({
      id: 'turn-same',
      status: 'succeeded',
      result: prior,
      finishedAt: new Date(Date.now() - 60_000).toISOString(),
    });
    JobStore.updateJob('turn-same', {
      status: 'queued',
      clientSubmitPending: true,
      inFlightTurnAt: Date.now(),
      finishedAt: undefined,
      inputSnapshot: { text: 'the tea is unsweetened', imageRefs: [], mode: 'edit' },
      mode: 'edit',
    });
    JobStore.updateJob('turn-same', {
      status: 'succeeded',
      result: { pendingFoodLog: { name: 'Meal', nutrients: { calories: 660 }, itemsBreakdown: [{ name: 'Sweet Iced Tea', nutrients: { calories: 104 } }] } },
      messages: [{ role: 'assistant', content: 'old' }],
      inFlightTurnAt: undefined,
      finishedAt: new Date().toISOString(),
    });
    const job = JobStore.getJob('turn-same');
    expect(job?.status).toBe('queued');
    expect(job?.inFlightTurnAt).toBeGreaterThan(0);
    expect(job?.result?.pendingFoodLog?.nutrients?.calories).toBe(660);

    JobStore.updateJob('turn-same', {
      status: 'succeeded',
      result: { pendingFoodLog: { name: 'Grilled Fish and Water Spinach Meal', nutrients: { calories: 650 }, itemsBreakdown: [{ name: 'Unsweetened Iced Tea', nutrients: { calories: 0 } }] } },
      inFlightTurnAt: undefined,
      finishedAt: new Date().toISOString(),
    });
    const done = JobStore.getJob('turn-same');
    expect(done?.status).toBe('succeeded');
    expect(done?.inFlightTurnAt).toBeUndefined();
    expect(done?.result?.pendingFoodLog?.nutrients?.calories).toBe(650);
  });

  it('keeps an in-flight edit turn even if a status-only succeeded echo arrives', () => {
    JobStore.createJob({
      id: 'turn1',
      status: 'succeeded',
      result: { pendingFoodLog: { name: 'Meal', nutrients: { calories: 660 } } },
      finishedAt: new Date(Date.now() - 60_000).toISOString(),
    });
    JobStore.updateJob('turn1', {
      status: 'queued',
      clientSubmitPending: true,
      inFlightTurnAt: Date.now(),
      finishedAt: undefined,
      inputSnapshot: { text: 'the tea is unsweetened', imageRefs: [], mode: 'edit' },
    });
    expect(JobStore.getJob('turn1')?.status).toBe('queued');
    expect(JobStore.getJob('turn1')?.inFlightTurnAt).toBeGreaterThan(0);

    JobStore.updateJob('turn1', { status: 'succeeded', statusMessage: 'Analysis complete' });
    expect(JobStore.getJob('turn1')?.status).toBe('queued');
    expect(JobStore.getJob('turn1')?.inFlightTurnAt).toBeGreaterThan(0);
  });

  it('detects stale prior-turn succeeded rows while an edit is in flight', () => {
    const submittedAt = Date.now();
    const existing = {
      status: 'queued' as const,
      serverSubmittedAt: submittedAt,
      clientSubmitPending: false,
    };
    const oldStamp = new Date(submittedAt - 60_000).toISOString();
    expect(isStalePriorTurn(existing, 'succeeded', oldStamp)).toBe(true);
    expect(isStalePriorTurn(existing, 'queued', oldStamp)).toBe(false);

    const freshStamp = new Date(submittedAt + 30_000).toISOString();
    expect(isStalePriorTurn(existing, 'succeeded', freshStamp)).toBe(false);

    const finished = { status: 'succeeded' as const, serverSubmittedAt: submittedAt, clientSubmitPending: false };
    expect(isStalePriorTurn(finished, 'succeeded', oldStamp)).toBe(false);
  });

  it('drops succeeded echoes from a lower currentTurn', () => {
    JobStore.createJob({
      id: 'turn-n',
      status: 'queued',
      currentTurn: 2,
      inFlightTurnAt: Date.now(),
      result: { pendingFoodLog: { name: 'Meal', nutrients: { calories: 660 } } },
    });
    JobStore.updateJob('turn-n', {
      status: 'succeeded',
      currentTurn: 1,
      result: { pendingFoodLog: { name: 'Meal', nutrients: { calories: 660 } } },
    });
    expect(JobStore.getJob('turn-n')?.status).toBe('queued');
    expect(JobStore.getJob('turn-n')?.currentTurn).toBe(2);
  });

  it('does not let a stale realtime failed echo clobber an in-flight retry', () => {
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
      statusMessage: 'Retrying...',
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

    const job = JobStore.getJob('echo-fail');
    expect(job?.status).toBe('running');
    expect(job?.inFlightTurnAt).toBe(t0);
    expect(job?.attemptCount).toBe(2);

    JobStore.updateJob('echo-fail', {
      status: 'failed',
      error: { class: 'permanent', message: 'Invalid JSON from model' },
    });
    expect(JobStore.getJob('echo-fail')?.status).toBe('failed');
    expect(JobStore.getJob('echo-fail')?.error?.message).toContain('Invalid JSON from model');
  });

  it('CROSS_DEVICE_SYNC: fresh JobStore on second device sees R2/photo URL without local ImageStore', async () => {
    // 1. Fresh second device starts with an empty store and no local ImageStore records
    JobStore.clearForTests();
    const localImages = await ImageStore.getImages('job_remote_sync_1');
    expect(localImages).toEqual([]);

    // 2. Second device processes remote job row synced from backend (e.g. Supabase or /api/jobs/status)
    const remotePhotoUrl = 'https://pub-r2.example.com/photos/job_remote_sync_1.jpg';
    processJobRows([
      {
        id: 'job_remote_sync_1',
        kind: 'food_log',
        status: 'succeeded',
        photo_url: remotePhotoUrl,
        clean_result: {
          photoUrl: remotePhotoUrl,
          message: 'Analysis complete.',
          pendingFoodLog: {
            name: 'Grilled Salmon with Quinoa',
            nutrients: { calories: 520, protein: 42 },
          },
        },
        raw_text: 'Analyze this meal photo.',
        created_at: new Date().toISOString(),
      },
    ]);

    // 3. Fresh JobStore on second device receives and stores the durable remote photoUrl
    const remoteJob = JobStore.getJob('job_remote_sync_1');
    expect(remoteJob).toBeDefined();
    expect(remoteJob?.photoUrl).toBe(remotePhotoUrl);
    expect(remoteJob?.inputSnapshot?.hasImage).toBe(true);
    expect(remoteJob?.result?.photoUrl).toBe(remotePhotoUrl);

    // 4. Image sanitization / deduplication on second device normalizes R2 URL to /photos/ proxy and rejects placeholders
    const resolvedUrls = uniqueMealImageUrls([
      remoteJob?.photoUrl,
      'Image reference preserved',
      '[image_removed_for_snapshot]',
    ]);
    expect(resolvedUrls).toEqual(['/photos/job_remote_sync_1.jpg']);
  });

  it('CROSS_DEVICE_SYNC: patches stripped placeholder to durable R2 URL before remote sync', () => {
    JobStore.clearForTests();
    JobStore.createJob({
      id: 'job_submit_patch_1',
      status: 'draft',
      messages: [
        {
          id: 'msg_user_1',
          role: 'user',
          content: 'Here is my breakfast',
          timestamp: new Date().toISOString(),
          imageUrl: 'Image reference preserved',
          imageUrls: ['Image reference preserved'],
        },
      ],
    });

    const r2Url = '/photos/job_submit_patch_1.jpg';
    // Emulate LogChat submit response patch (PR #2)
    JobStore.apply({
      type: 'ServerStatus',
      id: 'job_submit_patch_1',
      status: 'running',
      serverSubmittedAt: Date.now(),
      messages: [
        {
          id: 'msg_user_1',
          role: 'user',
          content: 'Here is my breakfast',
          timestamp: new Date().toISOString(),
          imageUrl: r2Url,
          imageUrls: [r2Url],
        },
      ],
    });

    const job = JobStore.getJob('job_submit_patch_1');
    expect(job?.messages?.[0].imageUrl).toBe(r2Url);
    expect(job?.messages?.[0].imageUrls).toEqual([r2Url]);
    expect(job?.messages?.[0].imageUrl).not.toBe('Image reference preserved');
  });

  it('PORTION_CONFIRM: awaiting_user clarify message carries the meal ledger so Confirm can resolve activeMeal', () => {
    JobStore.clearForTests();
    processJobRows([
      {
        id: 'job_clarify_meal_1',
        kind: 'food_log',
        status: 'awaiting_user',
        status_message: 'Please confirm portion size',
        clean_result: {
          message: 'How much of "Packaged Snack" did you eat?',
          needsPortionClarify: true,
          portionClarify: {
            promptMessage: 'How much of "Packaged Snack" did you eat?',
            items: [{ scoutIndex: 0, name: 'Packaged Snack', estimatedWeightGrams: 25, labelServingGrams: 100, options: [] }],
            scoutItems: [{ scoutIndex: 0, name: 'Packaged Snack', estimatedWeightGrams: 25 }],
          },
          scoutItems: [{ scoutIndex: 0, name: 'Packaged Snack', estimatedWeightGrams: 25 }],
          pendingFoodLog: {
            name: 'Packaged Snack',
            itemsBreakdown: [{ scoutIndex: 0, name: 'Packaged Snack', weightGrams: 25 }],
            nutrients: { calories: 100 },
          },
        },
      },
    ]);

    const job = JobStore.getJob('job_clarify_meal_1');
    const clarifyMsg = job?.messages?.find((m: any) => m.data?.needsPortionClarify);
    expect(clarifyMsg).toBeDefined();
    // PortionClarifyCard.onConfirm reads activeMeal off the message; without the
    // ledger it silently returns and the Confirm button appears dead.
    expect(clarifyMsg?.pendingFoodLog?.name).toBe('Packaged Snack');
    expect(clarifyMsg?.data?.pendingFoodLog?.name).toBe('Packaged Snack');
    expect(job?.result?.pendingFoodLog?.name).toBe('Packaged Snack');
  });
});
