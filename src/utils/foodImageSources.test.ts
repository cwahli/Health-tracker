import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  isUsableImageUrl,
  normalizeMealImageUrl,
  photoKeyFromUrl,
  nextPhotoFallbackUrl,
  uniqueMealImageUrls,
  resolveNextPhotoUrl,
  collectSavedMealImageUrls,
  PHOTO_PROXY_PREFIX,
} from './foodImageSources';

describe('foodImageSources B11d', () => {
  it('rewrites r2.dev public URLs to same-origin proxy', () => {
    const u = normalizeMealImageUrl(
      'https://pub-d17eecca64f82625d29dc38b14f46c14.r2.dev/photos/job_123.jpg'
    );
    expect(u).toBe('/photos/job_123.jpg');
  });

  it('keeps /photos/ proxy paths', () => {
    expect(normalizeMealImageUrl('/photos/abc.jpg')).toBe('/photos/abc.jpg');
  });

  it('photoKeyFromUrl extracts key', () => {
    expect(photoKeyFromUrl('/photos/job_1.jpg')).toBe('job_1.jpg');
    expect(photoKeyFromUrl('https://x.r2.dev/photos/job_2')).toBe('job_2.jpg');
  });

  it('nextPhotoFallbackUrl tries proxy after public URL fails', () => {
    const tried = new Set<string>();
    const next = nextPhotoFallbackUrl(
      'https://pub-xxx.r2.dev/photos/job_99.jpg',
      tried
    );
    expect(next).toBeTruthy();
    expect(String(next).startsWith(PHOTO_PROXY_PREFIX) || String(next).includes('photo-url')).toBe(
      true
    );
  });

  it('rejects placeholders', () => {
    expect(isUsableImageUrl('[image_removed_for_snapshot]')).toBe(false);
  });

  it('uniqueMealImageUrls collapses r2.dev and /photos/ for the same key', () => {
    const out = uniqueMealImageUrls([
      'https://pub-d17eecca64f82625d29dc38b14f46c14.r2.dev/photos/job_tofu.jpg',
      '/photos/job_tofu.jpg',
      '/photos/job_tofu.jpg?x=1',
    ]);
    expect(out).toEqual(['/photos/job_tofu.jpg']);
  });

  it('drops data: copies once the same captures exist on /photos/', () => {
    const dataTofu = 'data:image/jpeg;base64,' + 'A'.repeat(40);
    const dataPeanuts = 'data:image/jpeg;base64,' + 'B'.repeat(40);
    const out = uniqueMealImageUrls([
      dataTofu,
      '/photos/job_tofu.jpg',
      dataPeanuts,
      '/photos/job_peanuts.jpg',
    ]);
    expect(out).toEqual(['/photos/job_tofu.jpg', '/photos/job_peanuts.jpg']);
  });

  it('keeps local data: URLs when nothing has been uploaded yet', () => {
    const a = 'data:image/jpeg;base64,' + 'A'.repeat(40);
    const b = 'data:image/jpeg;base64,' + 'B'.repeat(40);
    expect(uniqueMealImageUrls([a, a, b])).toEqual([a, b]);
  });

  it('dedupes an all-dead list to zero (orphaned hero-slider root cause)', () => {
    expect(uniqueMealImageUrls(['', '   ', null, undefined])).toEqual([]);
    expect(uniqueMealImageUrls(['[image_removed_for_snapshot]', 'Image reference preserved'])).toEqual([]);
    expect(uniqueMealImageUrls(['blob:revoked-after-reload'])).toEqual(['blob:revoked-after-reload']);
  });
});

describe('collectSavedMealImageUrls', () => {
  it('uses originalLog photos when the tag itself has none', () => {
    const urls = collectSavedMealImageUrls({
      originalLog: {
        id: 'food_abc',
        imageUrls: ['https://pub-xxx.r2.dev/photos/food_abc.jpg'],
      },
    });
    expect(urls).toEqual(['/photos/food_abc.jpg']);
  });

  it('hydrates from in-memory foodLogs by id when stored urls are placeholders', () => {
    const urls = collectSavedMealImageUrls(
      {
        id: 'food_123',
        imageUrl: '[image_removed_for_snapshot]',
      },
      [{ id: 'food_123', imageUrls: ['/photos/food_123.jpg'] }],
    );
    expect(urls).toEqual(['/photos/food_123.jpg']);
  });

  it('falls back to photos/{id}.jpg when nothing else is stored', () => {
    expect(collectSavedMealImageUrls({ id: 'food_nophoto' })).toEqual(['/photos/food_nophoto.jpg']);
  });

  it('omits the synthesized guess when allowSynthesized is false (display path)', () => {
    expect(collectSavedMealImageUrls({ id: 'food_nophoto' }, null, { allowSynthesized: false })).toEqual([]);
  });

  it('keeps real stored urls when allowSynthesized is false', () => {
    const urls = collectSavedMealImageUrls(
      { id: 'food_real', imageUrls: ['/photos/food_real.jpg'] },
      null,
      { allowSynthesized: false },
    );
    expect(urls).toEqual(['/photos/food_real.jpg']);
  });
});

describe('resolveNextPhotoUrl (previous-meal thumbnail self-heal)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('tries the local proxy path first, without hitting the network', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const tried = new Set<string>();
    const next = await resolveNextPhotoUrl(
      'https://x.r2.dev/photos/job_almond.jpg',
      'https://x.r2.dev/photos/job_almond.jpg',
      tried
    );
    expect(next).toBe(`${PHOTO_PROXY_PREFIX}job_almond.jpg`);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('awaits the signed-URL API once proxy candidates are exhausted, and uses its returned URL', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ proxyUrl: '/photos/job_almond.jpg?fresh=1' }),
      })
    );
    const tried = new Set<string>([
      `${PHOTO_PROXY_PREFIX}job_almond.jpg`,
      '/api/r2/photos/job_almond.jpg',
    ]);
    const next = await resolveNextPhotoUrl(
      'https://x.r2.dev/photos/job_almond.jpg',
      'https://x.r2.dev/photos/job_almond.jpg',
      tried
    );
    expect(next).toBe('/photos/job_almond.jpg?fresh=1');
  });

  it('falls back to the raw signed-URL endpoint if the fetch throws (network error), not to null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const tried = new Set<string>([
      `${PHOTO_PROXY_PREFIX}job_almond.jpg`,
      '/api/r2/photos/job_almond.jpg',
    ]);
    const next = await resolveNextPhotoUrl(
      'https://x.r2.dev/photos/job_almond.jpg',
      'https://x.r2.dev/photos/job_almond.jpg',
      tried
    );
    expect(next).toBe(`/api/r2/photo-url?key=${encodeURIComponent('job_almond.jpg')}`);
  });

  it('returns null once every fallback has already been tried (permanently broken image)', async () => {
    const key = 'job_almond.jpg';
    const tried = new Set<string>([
      `${PHOTO_PROXY_PREFIX}${key}`,
      `/api/r2/photos/${key}`,
      `/api/r2/photo-url?key=${encodeURIComponent(key)}`,
    ]);
    const next = await resolveNextPhotoUrl(
      'https://x.r2.dev/photos/job_almond.jpg',
      'https://x.r2.dev/photos/job_almond.jpg',
      tried
    );
    expect(next).toBeNull();
  });
});
