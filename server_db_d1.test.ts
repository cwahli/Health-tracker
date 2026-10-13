import { describe, it, expect, vi, beforeEach } from 'vitest';

// Sensor for class ALWAYS_COUNT_FALLBACK (recurring mobile 2-page collapse):
// d1PullSync must never fire its 5 D1 queries in one burst. On slow links
// the Cloudflare D1 HTTP API drops queries out of a 5-way burst and the
// count(*) queries are the ones that starve — the response then carries a
// page-sized slice with no total and history collapses to ~2 pages.
// Data rows go first, counts go after (peak in-flight <= 3).

vi.mock('./server_d1.js', () => {
  let inFlight = 0;
  let peak = 0;
  const state = {
    get peak() {
      return peak;
    },
    reset() {
      inFlight = 0;
      peak = 0;
    },
  };
  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const safeJsonParse = (raw: any, fallback: any) => {
    if (raw == null) return fallback;
    if (typeof raw !== 'string') return raw;
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  };
  const d1Query = async (sql: string, _params: any[] = []) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    try {
      await delay(20);
      if (sql.startsWith('SELECT count(*)')) {
        return { success: true, results: [{ cnt: sql.includes('food_logs') ? 387 : 40 }] };
      }
      if (sql.includes('FROM food_logs')) {
        return {
          success: true,
          results: Array.from({ length: 15 }, (_, i) => ({
            id: `meal_${i}`,
            firebase_uid: 'u1',
            date: '2026-10-01',
            name: `Meal ${i}`,
            nutrients: '{}',
            items_breakdown: '[]',
            scout_items: '[]',
            image_urls: '[]',
            chat_transcript: '[]',
            updated_at: new Date().toISOString(),
          })),
        };
      }
      if (sql.includes('FROM biomarker_logs')) {
        return { success: true, results: [] };
      }
      return { success: true, results: [] };
    } finally {
      inFlight -= 1;
    }
  };
  return {
    d1Query,
    safeJsonParse,
    isD1Configured: () => true,
    __concurrency: state,
  };
});

import { d1PullSync } from './server_db_d1.js';
import * as serverD1 from './server_d1.js';
// Mock-only concurrency probe (declared in the vi.mock above, not in server_d1).
const __concurrency = (serverD1 as any).__concurrency as { peak: number; reset(): void };

describe('d1PullSync count-query burst separation (ALWAYS_COUNT_FALLBACK sensor)', () => {
  beforeEach(() => {
    __concurrency.reset();
  });

  it('never exceeds 3 concurrent D1 queries: counts run after the data wave', async () => {
    const res = await d1PullSync({ possibleUids: ['u1'], listOnly: true, pageSize: 15, offset: 0 });
    expect(res.foods.length).toBe(15);
    expect(res.totalFoodsCount).toBe(387);
    expect(__concurrency.peak).toBeLessThanOrEqual(3);
  });
});
