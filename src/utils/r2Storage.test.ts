import { describe, it, expect, afterEach } from 'vitest';
import { resolveApiUrl } from './r2Storage';

// Sensor for the server-side "Failed to parse URL from /api/r2/upload-job-result"
// error: Node fetch rejects relative URLs, so the job pipeline must resolve API
// paths against INTERNAL_BASE_URL while the browser keeps the relative path.

describe('resolveApiUrl', () => {
  const originalInternal = process.env.INTERNAL_BASE_URL;
  const originalApi = process.env.API_BASE_URL;

  afterEach(() => {
    if (originalInternal === undefined) delete process.env.INTERNAL_BASE_URL;
    else process.env.INTERNAL_BASE_URL = originalInternal;
    if (originalApi === undefined) delete process.env.API_BASE_URL;
    else process.env.API_BASE_URL = originalApi;
    delete (globalThis as any).window;
  });

  it('keeps a relative path in the browser', () => {
    (globalThis as any).window = {};
    expect(resolveApiUrl('/api/r2/upload-job-result')).toBe('/api/r2/upload-job-result');
  });

  it('uses INTERNAL_BASE_URL on the server', () => {
    process.env.INTERNAL_BASE_URL = 'http://127.0.0.1:3000';
    expect(resolveApiUrl('/api/r2/upload-job-result')).toBe(
      'http://127.0.0.1:3000/api/r2/upload-job-result'
    );
  });

  it('normalizes a trailing slash and a missing leading slash', () => {
    process.env.INTERNAL_BASE_URL = 'http://127.0.0.1:3100/';
    expect(resolveApiUrl('api/r2/job-result')).toBe('http://127.0.0.1:3100/api/r2/job-result');
  });

  it('falls back to localhost when the env is absent', () => {
    delete process.env.INTERNAL_BASE_URL;
    delete process.env.API_BASE_URL;
    expect(resolveApiUrl('/api/upload')).toBe('http://127.0.0.1:3000/api/upload');
  });
});
