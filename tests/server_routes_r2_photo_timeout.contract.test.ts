import { describe, it, expect, vi } from 'vitest';

/**
 * 2026-11-16 — meal photos disappeared from health-tracker.co.uk for ~2 weeks.
 * Two causes were live at once: the apex origin was a dead tunnel, and on the
 * origin that *did* answer, `/photos/{key}` held the request open until
 * Cloudflare returned 524 at ~125s because the S3 SDK retried an unreachable
 * R2 endpoint with no deadline. The browser saw a spinner, not an image, and
 * the client fallback chain re-issued the same doomed request.
 *
 * Sensor: every R2 **read** must be bounded. A timeout answers fast (504 +
 * `no-store`) instead of hanging, and a timeout must NOT spend a second
 * deadline on the legacy no-extension key.
 */

function mockResponse() {
  const headers: Record<string, string> = {};
  const res: any = {
    statusCode: 200,
    body: undefined as any,
    setHeader: (k: string, v: string) => { headers[k] = v; },
    getHeader: (k: string) => headers[k],
    status(code: number) { res.statusCode = code; return res; },
    send(body: any) { res.body = body; return res; },
    json(body: any) { res.body = body; return res; },
  };
  return res;
}

/** S3 client whose reads never answer — the shape of an unreachable endpoint. */
function hangingClient() {
  return {
    send: vi.fn((_cmd: any, opts?: any) => new Promise((_resolve, reject) => {
      const signal: AbortSignal | undefined = opts?.abortSignal;
      if (signal) {
        signal.addEventListener('abort', () => {
          const err: any = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      }
    })),
  };
}

describe('R2 read deadline (photo fail-fast, 2026-11-16)', () => {
  it('exposes a bounded R2_READ_TIMEOUT_MS default', async () => {
    vi.resetModules();
    const mod = await import('../server_routes_r2');
    expect(mod.R2_READ_TIMEOUT_MS).toBe(5000);
    expect(mod.isR2TimeoutError({ code: 'R2_TIMEOUT' })).toBe(true);
    expect(mod.isR2TimeoutError({ name: 'AbortError' })).toBe(true);
    expect(mod.isR2TimeoutError(new Error('NotFound'))).toBe(false);
    expect(mod.isR2TimeoutError(null)).toBe(false);
  });

  it('answers 504 quickly instead of hanging when R2 never responds', async () => {
    vi.stubEnv('CLOUDFLARE_R2_ACCESS_KEY_ID', 'test-key');
    vi.stubEnv('CLOUDFLARE_R2_SECRET_ACCESS_KEY', 'test-secret');
    vi.stubEnv('R2_READ_TIMEOUT_MS', '500');
    vi.resetModules();
    const client = hangingClient();
    vi.doMock('@aws-sdk/client-s3', () => ({
      S3Client: vi.fn(function (this: any) { return client; }),
      PutObjectCommand: class PutObjectCommand { constructor(public input: any) {} },
      HeadObjectCommand: class HeadObjectCommand { constructor(public input: any) {} },
      GetObjectCommand: class GetObjectCommand { constructor(public input: any) {} },
    }));
    try {
      const mod = await import('../server_routes_r2');
      const res = mockResponse();
      const started = Date.now();
      await mod.streamR2Photo(res, 'food_1783421756721.jpg');
      const elapsed = Date.now() - started;

      expect(res.statusCode).toBe(504);
      expect(String((res.body as any)?.error || '')).toMatch(/timed out/i);
      expect(res.getHeader('Cache-Control')).toBe('no-store');
      // One deadline, not one per candidate key, and never the 125s edge timeout.
      expect(elapsed).toBeLessThan(1400);
      expect(client.send).toHaveBeenCalledTimes(1);
      expect(mod.R2_READ_TIMEOUT_MS).toBe(500);
    } finally {
      vi.unstubAllEnvs();
      vi.doUnmock('@aws-sdk/client-s3');
    }
  });

  it('still returns 404 fast for a missing object (no false timeout)', async () => {
    vi.stubEnv('CLOUDFLARE_R2_ACCESS_KEY_ID', 'test-key');
    vi.stubEnv('CLOUDFLARE_R2_SECRET_ACCESS_KEY', 'test-secret');
    vi.resetModules();
    const send = vi.fn(async () => { throw Object.assign(new Error('Not Found'), { name: 'NoSuchKey' }); });
    vi.doMock('@aws-sdk/client-s3', () => ({
      S3Client: vi.fn(function (this: any) { return { send }; }),
      PutObjectCommand: class PutObjectCommand { constructor(public input: any) {} },
      HeadObjectCommand: class HeadObjectCommand { constructor(public input: any) {} },
      GetObjectCommand: class GetObjectCommand { constructor(public input: any) {} },
    }));
    try {
      const mod = await import('../server_routes_r2');
      const res = mockResponse();
      await mod.streamR2Photo(res, 'food_does_not_exist.jpg');
      expect(res.statusCode).toBe(404);
      expect(res.getHeader('Cache-Control')).toBeUndefined();
      // Legacy no-extension key is still tried: a miss is cheap, unlike a hang.
      expect(send).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllEnvs();
      vi.doUnmock('@aws-sdk/client-s3');
    }
  });

  it('returns null (never throws, never hangs) when job-result R2 read times out', async () => {
    vi.stubEnv('CLOUDFLARE_R2_ACCESS_KEY_ID', 'test-key');
    vi.stubEnv('CLOUDFLARE_R2_SECRET_ACCESS_KEY', 'test-secret');
    vi.stubEnv('R2_READ_TIMEOUT_MS', '100');
    vi.resetModules();
    const client = hangingClient();
    vi.doMock('@aws-sdk/client-s3', () => ({
      S3Client: vi.fn(function (this: any) { return client; }),
      PutObjectCommand: class PutObjectCommand { constructor(public input: any) {} },
      HeadObjectCommand: class HeadObjectCommand { constructor(public input: any) {} },
      GetObjectCommand: class GetObjectCommand { constructor(public input: any) {} },
    }));
    try {
      const mod = await import('../server_routes_r2');
      const started = Date.now();
      const result = await mod.fetchJobResultFromR2Direct('job_timeout');
      expect(result).toBeNull();
      expect(Date.now() - started).toBeLessThan(1000);
      expect(client.send).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllEnvs();
      vi.doUnmock('@aws-sdk/client-s3');
    }
  });
});
