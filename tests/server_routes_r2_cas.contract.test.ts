import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import { uploadBase64ToR2 } from '../server_routes_r2';

describe('D-9 R2 Photo CAS Deduplication (uploadBase64ToR2)', () => {
  const pixelBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const expectedHash = crypto.createHash('sha256').update(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')).digest('hex');

  it('generates deterministic SHA-256 CAS key from base64 image data', async () => {
    const url = await uploadBase64ToR2('job_test_123', pixelBase64, 0);
    expect(url).toContain(`photos/sha256_${expectedHash}.jpg`);
  });

  it('guarantees identical CAS URL across different job IDs, food IDs, and indexes (zero duplicate storage)', async () => {
    const jobUrl = await uploadBase64ToR2('job_first_scan', pixelBase64, 0);
    const foodUrl = await uploadBase64ToR2('food_saved_meal', pixelBase64, 1);
    const adminUrl = await uploadBase64ToR2('brand_item_456', pixelBase64, 2);

    expect(jobUrl).toEqual(foodUrl);
    expect(foodUrl).toEqual(adminUrl);
    expect(jobUrl).toContain(`sha256_${expectedHash}.jpg`);
  });

  it('returns immediately without re-processing if URL is already an uploaded photo or HTTP resource', async () => {
    const existingPhoto = '/photos/sha256_abcd1234ef.jpg';
    const httpPhoto = 'https://pub-r2.dev/photos/sha256_abcd1234ef.jpg';

    expect(await uploadBase64ToR2('job_any', existingPhoto, 0)).toBe(existingPhoto);
    expect(await uploadBase64ToR2('job_any', httpPhoto, 0)).toBe(httpPhoto);
  });

  it('falls back to safe proxy path on empty or invalid input', async () => {
    const fallback = await uploadBase64ToR2('job_fallback', '', 0);
    expect(fallback).toBe('/photos/job_fallback.jpg');
  });
});
