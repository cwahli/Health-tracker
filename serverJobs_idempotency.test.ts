import { describe, it, expect, beforeEach } from 'vitest';
import {
  checkOrRegisterIdempotentSubmission,
  activeUserJobLocks,
  recentSubmissionsMap,
  inMemoryServerJobs,
  fingerprintSubmission,
} from './serverJobs';

describe('concurrent meals idempotency (multi-meal workflow)', () => {
  beforeEach(() => {
    activeUserJobLocks.clear();
    recentSubmissionsMap.clear();
    inMemoryServerJobs.clear();
  });

  it('allows two DISTINCT meals submitted at the same time', async () => {
    const r1 = await checkOrRegisterIdempotentSubmission({
      jobId: 'job_A',
      userId: 'u1',
      kind: 'food_log',
      mode: 'review',
      text: 'Nasi lemak with chicken',
    } as any);
    expect(r1.isDuplicate).toBe(false);
    expect(r1.jobId).toBe('job_A');
    inMemoryServerJobs.set('job_A', { id: 'job_A', status: 'running' });

    const r2 = await checkOrRegisterIdempotentSubmission({
      jobId: 'job_B',
      userId: 'u1',
      kind: 'food_log',
      mode: 'review',
      text: 'Mie goreng seafood',
    } as any);
    expect(r2.isDuplicate).toBe(false);
    expect(r2.jobId).toBe('job_B');
  });

  it('blocks rapid double-click of the SAME meal content', async () => {
    const r1 = await checkOrRegisterIdempotentSubmission({
      jobId: 'job_A',
      userId: 'u1',
      kind: 'food_log',
      mode: 'review',
      text: 'Nasi lemak with chicken',
    } as any);
    expect(r1.isDuplicate).toBe(false);
    inMemoryServerJobs.set('job_A', { id: 'job_A', status: 'running' });

    const r2 = await checkOrRegisterIdempotentSubmission({
      jobId: 'job_B',
      userId: 'u1',
      kind: 'food_log',
      mode: 'review',
      text: 'Nasi lemak with chicken',
    } as any);
    expect(r2.isDuplicate).toBe(true);
    expect(r2.jobId).toBe('job_A');
  });

  it('allows photo-only DISTINCT meals with same empty text but different image bytes', async () => {
    const imgA = 'data:image/jpeg;base64,' + 'A'.repeat(2000);
    const imgB = 'data:image/jpeg;base64,' + 'B'.repeat(2000);
    const r1 = await checkOrRegisterIdempotentSubmission({
      jobId: 'job_A',
      userId: 'u1',
      kind: 'food_log',
      mode: 'review',
      text: '',
      images: [imgA],
    } as any);
    expect(r1.isDuplicate).toBe(false);
    inMemoryServerJobs.set('job_A', { id: 'job_A', status: 'running' });

    const r2 = await checkOrRegisterIdempotentSubmission({
      jobId: 'job_B',
      userId: 'u1',
      kind: 'food_log',
      mode: 'review',
      text: '',
      images: [imgB],
    } as any);
    expect(r2.isDuplicate).toBe(false);
    expect(r2.jobId).toBe('job_B');
  });

  it('blocks identical photo bytes as duplicate', async () => {
    const img = 'data:image/jpeg;base64,' + 'A'.repeat(2000);
    const r1 = await checkOrRegisterIdempotentSubmission({
      jobId: 'job_A',
      userId: 'u1',
      kind: 'food_log',
      mode: 'review',
      text: '',
      images: [img],
    } as any);
    expect(r1.isDuplicate).toBe(false);
    inMemoryServerJobs.set('job_A', { id: 'job_A', status: 'running' });

    const r2 = await checkOrRegisterIdempotentSubmission({
      jobId: 'job_B',
      userId: 'u1',
      kind: 'food_log',
      mode: 'review',
      text: '',
      images: [img],
    } as any);
    expect(r2.isDuplicate).toBe(true);
    expect(r2.jobId).toBe('job_A');
  });

  it('allows retry submissions to bypass dedupe', async () => {
    const r1 = await checkOrRegisterIdempotentSubmission({
      jobId: 'job_A',
      userId: 'u1',
      kind: 'food_log',
      mode: 'review',
      text: 'Nasi lemak',
    } as any);
    expect(r1.isDuplicate).toBe(false);
    inMemoryServerJobs.set('job_A', { id: 'job_A', status: 'running' });

    const r2 = await checkOrRegisterIdempotentSubmission({
      jobId: 'job_B',
      userId: 'u1',
      kind: 'food_log',
      mode: 'review',
      text: 'Nasi lemak',
      isRetry: true,
    } as any);
    expect(r2.isDuplicate).toBe(false);
  });

  it('allows different kinds concurrently (food vs medical)', async () => {
    const r1 = await checkOrRegisterIdempotentSubmission({
      jobId: 'job_food',
      userId: 'u1',
      kind: 'food_log',
      mode: 'review',
      text: 'Nasi lemak',
    } as any);
    expect(r1.isDuplicate).toBe(false);
    inMemoryServerJobs.set('job_food', { id: 'job_food', status: 'running' });

    const r2 = await checkOrRegisterIdempotentSubmission({
      jobId: 'job_med',
      userId: 'u1',
      kind: 'medical',
      mode: 'review',
      text: 'Nasi lemak',
    } as any);
    expect(r2.isDuplicate).toBe(false);
    expect(r2.jobId).toBe('job_med');
  });

  it('ignores client idempotencyKey embedding jobId for content dedupe', async () => {
    const r1 = await checkOrRegisterIdempotentSubmission({
      jobId: 'job_A',
      userId: 'u1',
      kind: 'food_log',
      mode: 'review',
      text: 'Same meal',
      idempotencyKey: 'idemp_u1_job_A_req1',
    } as any);
    expect(r1.isDuplicate).toBe(false);
    inMemoryServerJobs.set('job_A', { id: 'job_A', status: 'running' });

    // Different jobId + different client key, same content → still duplicate (double-click)
    const r2 = await checkOrRegisterIdempotentSubmission({
      jobId: 'job_B',
      userId: 'u1',
      kind: 'food_log',
      mode: 'review',
      text: 'Same meal',
      idempotencyKey: 'idemp_u1_job_B_req2',
    } as any);
    expect(r2.isDuplicate).toBe(true);
    expect(r2.jobId).toBe('job_A');

    // Different content, different client key → allowed
    const r3 = await checkOrRegisterIdempotentSubmission({
      jobId: 'job_C',
      userId: 'u1',
      kind: 'food_log',
      mode: 'review',
      text: 'Different meal entirely',
      idempotencyKey: 'idemp_u1_job_C_req3',
    } as any);
    expect(r3.isDuplicate).toBe(false);
    expect(r3.jobId).toBe('job_C');
  });

  it('fingerprint differs for distinct meals', () => {
    const fa = fingerprintSubmission({ text: 'A', images: [], imageUrls: [], mode: 'review' } as any);
    const fb = fingerprintSubmission({ text: 'B', images: [], imageUrls: [], mode: 'review' } as any);
    expect(fa).not.toBe(fb);
  });
});
