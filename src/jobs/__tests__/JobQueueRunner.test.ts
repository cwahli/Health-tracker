import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JobQueueRunner } from '../JobQueueRunner';
import { JobStore } from '../JobStore';

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

describe('JobQueueRunner', () => {
  beforeEach(() => {
    // Reset
    JobQueueRunner.stop();
    const all = JobStore.getAllJobs();
    for (const j of all) {
      JobStore.deleteJob(j.id);
    }
  });

  afterEach(() => {
    JobQueueRunner.stop();
  });

  it('runs queued job and marks as succeeded', async () => {
    JobStore.createJob({ id: 'r1' });
    JobStore.updateJob('r1', { status: 'queued' });

    let runCount = 0;
    JobQueueRunner.setExecutor(async () => {
      runCount++;
    });

    JobQueueRunner.start();

    // Wait a bit
    await new Promise(r => setTimeout(r, 100));

    expect(runCount).toBe(1);
    expect(JobStore.getJob('r1')?.status).toBe('succeeded');
  });

  it('handles abort correctly', async () => {
    JobStore.createJob({ id: 'r2' });
    JobStore.updateJob('r2', { status: 'queued' });

    JobQueueRunner.setExecutor(async (job, signal) => {
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(new Error('AbortError'));
        });
      });
    });

    JobQueueRunner.start();
    
    // allow runner to pick it up
    await new Promise(r => setTimeout(r, 100));
    const job = JobStore.getJob('r2');
    expect(job?.status).toBe('running');
    
    job?.abortController?.abort();
    
    await new Promise(r => setTimeout(r, 100));
    expect(JobStore.getJob('r2')?.status).toBe('cancelled');
  });

  it('circuit breaker triggers after 3 failures', async () => {
    JobStore.createJob({ id: 'f1' });
    JobStore.createJob({ id: 'f2' });
    JobStore.createJob({ id: 'f3' });
    JobStore.createJob({ id: 'f4' });
    
    JobStore.updateJob('f1', { status: 'queued' });
    JobStore.updateJob('f2', { status: 'queued' });
    JobStore.updateJob('f3', { status: 'queued' });
    JobStore.updateJob('f4', { status: 'queued' });

    JobQueueRunner.setExecutor(async () => {
      throw new Error('fail');
    });

    JobQueueRunner.start();

    await new Promise(r => setTimeout(r, 500));

    // f1, f2, f3 should be failed. f4 should still be queued because circuit breaker pauses runner.
    expect(JobStore.getJob('f1')?.status).toBe('failed');
    expect(JobStore.getJob('f2')?.status).toBe('failed');
    expect(JobStore.getJob('f3')?.status).toBe('failed');
    expect(JobStore.getJob('f4')?.status).toBe('queued');
  });

  it('wall-clock retry logic skips job if not before', async () => {
    JobStore.createJob({ id: 'w1' });
    const future = new Date();
    future.setHours(future.getHours() + 1);
    JobStore.updateJob('w1', { status: 'queued', retryNotBefore: future.toISOString() });

    let runCount = 0;
    JobQueueRunner.setExecutor(async () => {
      runCount++;
    });

    JobQueueRunner.start();
    await new Promise(r => setTimeout(r, 200));

    expect(runCount).toBe(0);
    expect(JobStore.getJob('w1')?.status).toBe('queued');
  });

  it('does not overwrite job status to succeeded if executor sets status to failed', async () => {
    JobStore.createJob({ id: 'f_executor' });
    JobStore.updateJob('f_executor', { status: 'queued' });

    JobQueueRunner.setExecutor(async (job) => {
      JobStore.updateJob(job.id, {
        status: 'failed',
        error: { class: 'permanent', message: 'Invalid JSON from model' }
      });
    });

    JobQueueRunner.start();
    await new Promise(r => setTimeout(r, 100));

    expect(JobStore.getJob('f_executor')?.status).toBe('failed');
    expect(JobStore.getJob('f_executor')?.error?.message).toContain('Invalid JSON from model');
  });
});
