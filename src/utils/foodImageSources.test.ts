import { describe, it, expect } from 'vitest';
import {
  isUsableImageUrl,
  normalizeMealImageUrl,
  photoKeyFromUrl,
  nextPhotoFallbackUrl,
  uniqueMealImageUrls,
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
