import { describe, expect, it } from 'vitest';
import {
  collectDownloadablePhotoUrls,
  filterCandidates,
  filterFoodCandidates,
  jobTitleHaystack,
  isDownloadablePhotoUrl,
  isImageBuffer,
  matchesNormalizedHaystack,
  normalizeMealText,
  parseTimestampWindow,
  tokenizeMealQuery,
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

describe('meal-audit-fetch full-meal visibility (Mr Oat Quick Cook Oatmeal)', () => {
  it('normalizes punctuation: "Mr. Oat" matches "Mr Oat"', () => {
    expect(normalizeMealText('Mr. Oat Quick Cook Oatmeal')).toBe('mr oat quick cook oatmeal');
    expect(tokenizeMealQuery('Mr. Oat')).toEqual(['mr', 'oat']);
    expect(matchesNormalizedHaystack('Mr Oat Rolled Oats', 'Mr. Oat')).toBe(true);
    expect(matchesNormalizedHaystack('Mr. Oat Quick Cook Oatmeal', 'Quick Cook')).toBe(true);
    expect(matchesNormalizedHaystack('Mr. Oat Quick Cook Oatmeal', 'Quick Cook Oatmeal')).toBe(true);
  });

  it('job filter is punctuation-insensitive (old exact-substring bug)', () => {
    const jobs: any[] = [
      { id: 'job_1', clean_result: { dishes: [{ dishName: 'Mr Oat Rolled Oats' }] }, status_message: '', photo_url: '' },
      { id: 'job_2', clean_result: { dishes: [{ dishName: 'Mr. Oat Quick Cook Oatmeal' }] }, status_message: '', photo_url: '' },
    ];
    const hits = filterCandidates(jobs, { timestampWindow: null, name: 'Mr. Oat Quick Cook Oatmeal' });
    expect(hits.map((j: any) => j.id)).toEqual(['job_2']);
    const mrHits = filterCandidates(jobs, { timestampWindow: null, name: 'Mr. Oat' });
    expect(mrHits.length).toBe(2);
  });

  it('prefers dish-title hits over blob-text noise', () => {
    const jobs: any[] = [
      { id: 'job_2', clean_result: { dishes: [{ dishName: 'Mr. Oat Quick Cook Oatmeal' }] }, status_message: '', photo_url: '' },
      { id: 'job_3', clean_result: { dishes: [{ dishName: 'Oatmeal' }], message: 'fiber check' }, status_message: '', photo_url: 'https://cdn.example.com/photos/quick_cook_ref.jpg' },
    ];
    expect(jobTitleHaystack(jobs[0])).toContain('Mr. Oat Quick Cook Oatmeal');
    const blob = filterCandidates(jobs, { timestampWindow: null, name: 'Quick Cook' });
    expect(blob.map((j: any) => j.id).sort()).toEqual(['job_2', 'job_3']);
    const titles = blob.filter((j: any) => matchesNormalizedHaystack(jobTitleHaystack(j), 'Quick Cook'));
    expect(titles.map((j: any) => j.id)).toEqual(['job_2']);
  });

  it('parses Food History day-first timestamps "23 sep 14:56"', () => {
    const w = parseTimestampWindow('23 sep 14:56');
    expect(w).not.toBeNull();
    expect(w!.hasTime).toBe(true);
    const d = new Date(w!.dateMs);
    expect(d.getDate()).toBe(23);
    expect(d.getMonth()).toBe(8);
    expect(d.getHours()).toBe(14);
    expect(d.getMinutes()).toBe(56);
    expect(d.getFullYear()).toBe(new Date().getFullYear());
  });

  it('food timestamp falls back to UTC calendar day (display TZ vs UTC stamp)', () => {
    // Prod truth: log stamped 2026-09-23T07:56Z, UI shows "23 sep 14:56" (WIB = UTC+7).
    const prodFoods: any[] = [
      { id: 'food_1790150172895_0u01o4', name: 'Mr. Oat Quick Cook Oatmeal', date: '2026-09-23', updated_at: '2026-09-23T07:56:15.236Z' },
      { id: 'other', name: 'Mr. Oat Quick Cook Oatmeal', date: '2026-09-22', updated_at: '2026-09-22T05:21:00.000Z' },
    ];
    const w2 = parseTimestampWindow('23 sep 14:56');
    expect(w2!.hasTime).toBe(true);
    expect(filterFoodCandidates(prodFoods, { name: 'Mr. Oat Quick Cook Oatmeal', timestampWindow: w2 }).map((f: any) => f.id))
      .toEqual(['food_1790150172895_0u01o4']);
  });

  it('food-log candidates match Food History titles + timestamp', () => {
    const foods: any[] = [
      { id: 'f1', name: 'Mr. Oat Quick Cook Oatmeal', date: '2026-09-23T14:56:00.000Z', updated_at: '2026-09-23T14:56:00.000Z' },
      { id: 'f2', name: 'Nasi Uduk Oatmeal', date: '2026-09-14T10:00:00.000Z', updated_at: '2026-09-14T10:00:00.000Z' },
    ];
    expect(filterFoodCandidates(foods, { name: 'Mr. Oat Quick Cook Oatmeal', timestampWindow: null }).map((f: any) => f.id)).toEqual(['f1']);
    const w = parseTimestampWindow('23 sep 14:56');
    // year defaults to current year; compare against same-year food date
    const thisYear = new Date().getFullYear();
    const sameYearFoods = [{ id: 'f1', name: 'Mr. Oat Quick Cook Oatmeal', date: `${thisYear}-09-23T14:56:00`, updated_at: `${thisYear}-09-23T14:56:00` }];
    expect(filterFoodCandidates(sameYearFoods, { name: 'oatmeal', timestampWindow: w }).map((f: any) => f.id)).toEqual(['f1']);
  });
});
