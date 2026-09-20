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

  it('returns empty string on empty or invalid input (D-9: no phantom job-keyed URL)', async () => {
    expect(await uploadBase64ToR2('job_fallback', '', 0)).toBe('');
    expect(await uploadBase64ToR2('job_fallback', undefined as any, 0)).toBe('');
  });

  it('maps different bytes to different CAS keys', async () => {
    const otherBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const url = await uploadBase64ToR2('job_test_123', pixelBase64, 0);
    const otherUrl = await uploadBase64ToR2('job_test_123', otherBase64 + 'A', 0);
    expect(otherUrl).not.toEqual(url);
    expect(otherUrl).toContain('photos/sha256_');
  });

  it('never embeds the index suffix in the CAS key', async () => {
    const urls = await Promise.all([0, 1, 2].map((i) => uploadBase64ToR2('job_idx', pixelBase64, i)));
    expect(new Set(urls).size).toBe(1);
    expect(urls[0]).not.toMatch(/_0\.jpg|_1\.jpg|_2\.jpg/);
  });
});

describe('D-9 R2 Photo CAS head-check reuse (mocked S3)', () => {
  const pixelBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  it('HeadObject hit returns the public URL without any PutObject', async () => {
    vi.stubEnv('CLOUDFLARE_R2_ACCESS_KEY_ID', 'test-key');
    vi.stubEnv('CLOUDFLARE_R2_SECRET_ACCESS_KEY', 'test-secret');
    vi.resetModules();
    const send = vi.fn(async (cmd: any) => {
      if (cmd?.constructor?.name === 'HeadObjectCommand') return {};
      throw new Error(`unexpected S3 command: ${cmd?.constructor?.name}`);
    });
    vi.doMock('@aws-sdk/client-s3', () => ({
      S3Client: vi.fn(() => ({ send })),
      PutObjectCommand: class PutObjectCommand { input: any; constructor(input: any) { this.input = input; } },
      HeadObjectCommand: class HeadObjectCommand { input: any; constructor(input: any) { this.input = input; } },
      GetObjectCommand: class GetObjectCommand { input: any; constructor(input: any) { this.input = input; } },
    }));
    try {
      const mod = await import('../server_routes_r2');
      const url = await mod.uploadBase64ToR2('job_reuse', pixelBase64, 0);
      expect(url).toContain('photos/sha256_');
      expect(url).toContain('https://');
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0][0].constructor.name).toBe('HeadObjectCommand');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
