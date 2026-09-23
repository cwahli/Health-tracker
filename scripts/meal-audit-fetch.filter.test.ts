import { describe, expect, it } from 'vitest';
import {
  collectDownloadablePhotoUrls,
  isDownloadablePhotoUrl,
  isImageBuffer,
  turnRemoteUrls,
} from './meal-audit-fetch.mjs';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const HTML = Buffer.from('<!DOCTYPE html><html><body>Not found</body></html>', 'utf-8');

describe('meal-audit-fetch photo truth (screenshot 20260923-161925)', () => {
  it('rejects stripHeavyImages placeholders and data-URLs', () => {
    expect(isDownloadablePhotoUrl('[image omitted 200KB]')).toBe(false);
    expect(isDownloadablePhotoUrl('[image omitted 20KB]')).toBe(false);
    expect(isDownloadablePhotoUrl('_image_20omitted_200KB_')).toBe(false);
    expect(isDownloadablePhotoUrl('data:image/jpeg;base64,AAAA')).toBe(false);
    expect(isDownloadablePhotoUrl('')).toBe(false);
    expect(isDownloadablePhotoUrl(null)).toBe(false);
  });

  it('accepts real photo URLs only', () => {
    expect(isDownloadablePhotoUrl('https://cdn.example.com/photos/a.jpg')).toBe(true);
    expect(isDownloadablePhotoUrl('http://127.0.0.1:3000/photos/abc.jpg')).toBe(true);
    expect(isDownloadablePhotoUrl('/photos/abc.jpg')).toBe(true);
  });

  it('rejects HTML error pages, accepts real image bytes', () => {
    expect(isImageBuffer(HTML, 'text/html')).toBe(false);
    expect(isImageBuffer(HTML, 'text/html; charset=utf-8')).toBe(false);
    expect(isImageBuffer(JPEG, 'image/jpeg')).toBe(true);
    expect(isImageBuffer(PNG, 'image/png')).toBe(true);
    expect(isImageBuffer(Buffer.alloc(0), 'image/jpeg')).toBe(false);
  });

  it('collects only downloadable URLs and counts skipped placeholders', () => {
    const turns = [
      {
        images: [
          'https://cdn.example.com/photos/real.jpg',
          '[image omitted 200KB]',
          'data:image/jpeg;base64,AAAA',
        ],
        dispatches: [],
      },
    ];
    const { urls, skippedPlaceholders } = collectDownloadablePhotoUrls(turns);
    expect(urls).toEqual(['https://cdn.example.com/photos/real.jpg']);
    expect(skippedPlaceholders).toBeGreaterThanOrEqual(1);
  });

  it('text-only turn (imageCount 0) stays photo-less — no stale carry-over', () => {
    const textOnly = {
      imageCount: 0,
      images: ['https://cdn.example.com/photos/stale-from-t1.jpg'],
      dispatches: [],
    };
    expect(turnRemoteUrls(textOnly)).toEqual([]);
  });
});
