import { describe, it, expect, vi } from 'vitest';
import {
  sortFoodLogsDescending,
  isJobOrFoodProtectedByBugTracker,
  calculateMealDebugRetentionStatus,
  pruneUserDebugLogs
} from './debugLogRetention';

describe('Debug Log Retention Policy (10-meal limit + Bug Tracker protection)', () => {
  it('sorts food logs in reverse chronological order (newest date first)', () => {
    const logs = [
      { id: 'food_1', date: '2026-08-10', updated_at: '2026-08-10T12:00:00Z' },
      { id: 'food_3', date: '2026-08-25', updated_at: '2026-08-25T14:00:00Z' },
      { id: 'food_2', date: '2026-08-20', updated_at: '2026-08-20T10:00:00Z' },
      { id: 'food_4', date: '2026-08-25', updated_at: '2026-08-25T16:00:00Z' },
    ];

    const sorted = sortFoodLogsDescending(logs);
    expect(sorted.map(s => s.id)).toEqual(['food_4', 'food_3', 'food_2', 'food_1']);
  });

  it('correctly checks if an item or job is protected by the bug tracker', () => {
    const protectedSet = new Set<string>([
      'job_1787331029834_s0j27ofr7',
      'https://pub-d17eecca64f82625d29dc38b14f46c14.r2.dev/debug/job_1787331029834_s0j27ofr7.json',
      'bugs/foodcart/issue_123',
      'food_special_bug',
    ]);

    // Matches via direct jobId
    expect(isJobOrFoodProtectedByBugTracker({ jobId: 'job_1787331029834_s0j27ofr7' }, protectedSet)).toBe(true);

    // Matches via debugUrl containing job ID
    expect(isJobOrFoodProtectedByBugTracker({
      id: 'food_unrelated',
      debugUrl: 'https://pub-d17eecca64f82625d29dc38b14f46c14.r2.dev/debug/job_1787331029834_s0j27ofr7.json'
    }, protectedSet)).toBe(true);

    // Matches via food id
    expect(isJobOrFoodProtectedByBugTracker({ id: 'food_special_bug' }, protectedSet)).toBe(true);

    // Unrelated food is NOT protected
    expect(isJobOrFoodProtectedByBugTracker({
      id: 'food_random_meal',
      jobId: 'job_random_999',
      debugUrl: 'https://pub-d17eecca64f82625d29dc38b14f46c14.r2.dev/debug/job_random_999.json'
    }, protectedSet)).toBe(false);
  });

  it('preserves debug logs for the last 10 meals and purges older meals unless in bug tracker', () => {
    // Generate 15 meals: meal_01 (newest, 2026-08-15) down to meal_15 (oldest, 2026-08-01)
    const logs = Array.from({ length: 15 }, (_, i) => {
      const day = 15 - i;
      const dayStr = String(day).padStart(2, '0');
      return {
        id: `meal_${String(i + 1).padStart(2, '0')}`,
        date: `2026-08-${dayStr}`,
        updated_at: `2026-08-${dayStr}T12:00:00Z`,
        jobId: `job_${String(i + 1).padStart(2, '0')}`,
        debugUrl: `https://pub-d17eecca64f82625d29dc38b14f46c14.r2.dev/debug/job_${String(i + 1).padStart(2, '0')}.json`
      };
    });

    // Protect meal_14 (rank 14, 2026-08-02) in bug tracker
    const protectedSet = new Set<string>(['job_14', 'meal_14']);

    const statusMap = calculateMealDebugRetentionStatus(logs, protectedSet, 10);

    // Check ranks 1 to 10 (meal_01 to meal_10)
    for (let rank = 1; rank <= 10; rank++) {
      const mealId = `meal_${String(rank).padStart(2, '0')}`;
      const status = statusMap.get(mealId);
      expect(status?.isLast10).toBe(true);
      expect(status?.kept).toBe(true);
    }

    // meal_11 (rank 11) is NOT protected -> kept should be false
    const statusMeal11 = statusMap.get('meal_11');
    expect(statusMeal11?.isLast10).toBe(false);
    expect(statusMeal11?.isBugProtected).toBe(false);
    expect(statusMeal11?.kept).toBe(false);

    // meal_14 (rank 14) IS protected in the bug tracker -> kept must be true!
    const statusMeal14 = statusMap.get('meal_14');
    expect(statusMeal14?.isLast10).toBe(false);
    expect(statusMeal14?.isBugProtected).toBe(true);
    expect(statusMeal14?.kept).toBe(true);
  });

  it('prunes old meals and protects bug tracker items in pruneUserDebugLogs', async () => {
    // 12 food entries: meal_01 (2026-08-12, rank 1) down to meal_12 (2026-08-01, rank 12)
    const mockFoods = Array.from({ length: 12 }, (_, i) => {
      const day = 12 - i;
      const dayStr = String(day).padStart(2, '0');
      const id = `meal_${String(i + 1).padStart(2, '0')}`;
      return {
        id,
        firebase_uid: 'user_123',
        date: `2026-08-${dayStr}`,
        updated_at: `2026-08-${dayStr}T12:00:00Z`,
        debug_url: `https://pub-d17eecca64f82625d29dc38b14f46c14.r2.dev/debug/job_${String(i + 1).padStart(2, '0')}.json`
      };
    });

    const mockTags = [
      {
        id: 'tag_bug_1',
        work_item: { hold_refs: ['job_12'] } // meal_12 (job_12) is at rank 12 (oldest)
      }
    ];

    const mockBacklog: any[] = [];

    const updatedRows: any[] = [];
    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'food_logs') {
          return {
            select: () => ({
              in: () => Promise.resolve({ data: mockFoods, error: null })
            }),
            update: (patch: any) => ({
              eq: (col: string, val: any) => {
                updatedRows.push({ table, patch, col, val });
                return Promise.resolve({ error: null });
              }
            })
          };
        }
        if (table === 'issue_tags') {
          return {
            select: () => Promise.resolve({ data: mockTags, error: null })
          };
        }
        if (table === 'issue_backlog') {
          return {
            select: () => Promise.resolve({ data: mockBacklog, error: null })
          };
        }
        if (table === 'golden_cases') {
          return {
            select: () => Promise.resolve({ data: [], error: null })
          };
        }
        if (table === 'agent_jobs') {
          return {
            update: () => ({
              eq: () => Promise.resolve({ error: null })
            })
          };
        }
        return {
          select: () => Promise.resolve({ data: [], error: null })
        };
      })
    };

    const result = await pruneUserDebugLogs('user_123', {
      maxRetention: 10,
      db: mockSupabase
    });

    expect(result.success).toBe(true);
    expect(result.totalMeals).toBe(12);
    // Rank 1..10 (10 meals) kept
    // Rank 11 (meal_11): pruned
    // Rank 12 (meal_12): kept because job_12 is in issue_tags hold_refs!
    expect(result.keptCount).toBe(11);
    expect(result.prunedCount).toBe(1);
    expect(result.bugProtectedCount).toBe(1);
    expect(result.prunedFoodIds).toEqual(['meal_11']);

    // Verify DB update was executed on meal_11
    expect(updatedRows).toEqual([
      { table: 'food_logs', patch: { debug_url: null }, col: 'id', val: 'meal_11' }
    ]);
  });
});
