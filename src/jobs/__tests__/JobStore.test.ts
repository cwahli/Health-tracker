import { describe, it, expect, beforeEach } from 'vitest';
import { JobStore, isStalePriorTurn, isJobBlank } from '../JobStore';

describe('JobStore', () => {
  beforeEach(() => {
    JobStore.clearForTests();
  });

  it('creates, retrieves, and updates jobs', () => {
    const job = JobStore.createJob({ id: 'test-1', status: 'queued' });
    expect(JobStore.getJob('test-1')?.status).toBe('queued');

    JobStore.updateJob('test-1', { status: 'running' });
    expect(JobStore.getJob('test-1')?.status).toBe('running');

    JobStore.updateJob('test-1', { status: 'succeeded' });
    expect(JobStore.getJob('test-1')?.status).toBe('succeeded');
  });

  it('identifies blank jobs', () => {
    expect(isJobBlank({ id: 'empty' })).toBe(true);
    expect(isJobBlank({ id: 'with-text', text: 'Hello' })).toBe(false);
  });
});
