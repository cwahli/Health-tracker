import { describe, it, expect, afterEach, vi } from 'vitest';
import { resolveApiUrl, uploadJobResultToR2, fetchJobResultFromR2, preserveR2StubInlineFields } from './r2Storage';

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

// Sensor for the rest of the upload contract: the route reads `payload`, and
// serverJobs stores the returned URL as `r2_url`. A helper that posted
// `{ result }` and returned a boolean left every upload at 400 and the URL
// unreachable even after the relative-URL fix.
describe('uploadJobResultToR2', () => {
  const originalInternal = process.env.INTERNAL_BASE_URL;

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalInternal === undefined) delete process.env.INTERNAL_BASE_URL;
    else process.env.INTERNAL_BASE_URL = originalInternal;
    delete (globalThis as any).window;
  });

  it('posts payload (and legacy result) to the absolute internal URL and returns the public URL', async () => {
    process.env.INTERNAL_BASE_URL = 'http://127.0.0.1:3000';
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ url: 'https://cdn.example/jobs/job_1_result.json' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = { pendingFoodLog: { id: 'meal_1', name: 'Proof Meal' } };
    const url = await uploadJobResultToR2('job_1', result);

    expect(url).toBe('https://cdn.example/jobs/job_1_result.json');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0] as any;
    expect(calledUrl).toBe('http://127.0.0.1:3000/api/r2/upload-job-result');
    const body = JSON.parse(init.body);
    expect(body.jobId).toBe('job_1');
    expect(body.payload).toEqual(result);
    expect(body.result).toEqual(result);
  });

  it('returns the legacy r2_url field too', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ r2_url: 'https://cdn.example/jobs/job_2_result.json' }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(uploadJobResultToR2('job_2', {})).resolves.toBe(
      'https://cdn.example/jobs/job_2_result.json'
    );
  });

  it('returns an empty string when the upload fails', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, json: async () => ({ error: 'Missing jobId or payload' }) }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(uploadJobResultToR2('job_3', {})).resolves.toBe('');
  });
});

// Sensor for HOLLOW_RESULT (portion card NO IMAGE + fallback title while the
// result sat in R2: the only reader asked for GET /api/r2/job-result — missing).
describe('fetchJobResultFromR2', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it('fetches the absolute job-result route and returns the parsed payload', async () => {
    process.env.INTERNAL_BASE_URL = 'http://127.0.0.1:3000';
    const payload = { portionClarify: { items: [{ name: 'Soup' }] }, scoutItems: [{ name: 'Soup' }] };
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => payload }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchJobResultFromR2('job_9')).resolves.toEqual(payload);
    expect((fetchMock.mock.calls[0] as any)[0]).toBe('http://127.0.0.1:3000/api/r2/job-result?jobId=job_9');
  });
  it('returns null when the route 404s or the fetch throws (pointer stays, never throws)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
    await expect(fetchJobResultFromR2('job_missing')).resolves.toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Failed to parse URL'); }));
    await expect(fetchJobResultFromR2('job_9')).resolves.toBeNull();
  });
});

describe('preserveR2StubInlineFields', () => {
  it('keeps question/names/photo, drops the dead pointer, fills only missing pieces', () => {
    const out = preserveR2StubInlineFields({
      is_r2: true, r2_url: 'https://cdn.example/j1.json', message: 'Confirm your portion',
      needsPortionClarify: true, portionClarify: { items: [{ name: 'Soup' }] },
      scoutItems: [{ name: 'Soup' }], photoUrl: '/photos/j1.jpg',
    }, 'Waiting for portion choice');
    expect(out.is_r2).toBeUndefined();
    expect(out.message).toBe('Confirm your portion');
    expect(out.portionClarify).toEqual({ items: [{ name: 'Soup' }] });
    expect(out.scoutItems).toEqual([{ name: 'Soup' }]);
    expect(out.photoUrl).toBe('/photos/j1.jpg');
    expect(preserveR2StubInlineFields({ message: 'm' }, 's').pendingFoodLog.name).toBe('Meal');
    expect(preserveR2StubInlineFields(null, 'Waiting').message).toBe('Waiting');
    expect(preserveR2StubInlineFields(undefined, undefined).message).toBe('Analysis complete');
  });
});
