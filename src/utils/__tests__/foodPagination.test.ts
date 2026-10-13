import { describe, it, expect } from 'vitest';
import { missingFoodPages, needsFoodFetch } from '../foodPagination';

/**
 * Sensor for class COMBINED_LIST_PAGINATION: the meals history list mixes
 * saved food logs with job cards, but the server pages food logs only.
 * The old trigger measured the fetch decision against the combined list
 * length, so any job card in the list silently disabled page-2+ meal loads.
 */
describe('Meal history pagination (COMBINED_LIST_PAGINATION sensor)', () => {
  const PAGE = 15;

  it('fetches page 2 when job cards pad the combined list past the food window', () => {
    // Reported shape: 15 meals loaded, 8 job cards visible, 387 meals total.
    const loadedFoods = 15;
    const combinedLength = 23;
    const totalFoodsCount = 387;
    const targetPage = 2;

    // The old inline condition — pinned here as the diagnosis, must stay false:
    // neededIndex (15) >= combinedLength (23) is false, so no fetch ever fired.
    const neededIndex = (targetPage - 1) * PAGE;
    const oldCondition = neededIndex >= combinedLength && combinedLength < totalFoodsCount;
    expect(oldCondition).toBe(false);

    // The fixed food-space decision fires for exactly page 2.
    expect(missingFoodPages(loadedFoods, targetPage, PAGE, totalFoodsCount)).toEqual([2]);
    expect(
      needsFoodFetch({ searchTerm: '', loadedFoods, targetPage, pageSize: PAGE, totalFoods: totalFoodsCount }),
    ).toBe(true);
  });

  it('fills every skipped page so jumps leave no gaps', () => {
    expect(missingFoodPages(15, 3, PAGE, 387)).toEqual([2, 3]);
    expect(missingFoodPages(15, 4, PAGE, 387)).toEqual([2, 3, 4]);
  });

  it('fetches nothing when the target window is already loaded', () => {
    expect(missingFoodPages(30, 2, PAGE, 387)).toEqual([]);
    expect(missingFoodPages(45, 3, PAGE, 387)).toEqual([]);
    expect(
      needsFoodFetch({ searchTerm: '', loadedFoods: 30, targetPage: 2, pageSize: PAGE, totalFoods: 387 }),
    ).toBe(false);
  });

  it('never fetches while searching (server window does not apply to filters)', () => {
    expect(
      needsFoodFetch({ searchTerm: 'oatmeal', loadedFoods: 15, targetPage: 2, pageSize: PAGE, totalFoods: 387 }),
    ).toBe(false);
  });

  it('unknown total still recovers one window at a time (never stuck at ~2 pages)', () => {
    // Count starved on a slow link: 15 loaded, total unknown, turn to page 2.
    expect(missingFoodPages(15, 2, PAGE, undefined)).toEqual([2]);
    expect(missingFoodPages(15, 2, PAGE, 0)).toEqual([2]);
    // No skipping ahead blindly: a jump fills progressively, one window per turn.
    expect(missingFoodPages(15, 3, PAGE, undefined)).toEqual([2]);
    // Covered windows never refetch.
    expect(missingFoodPages(30, 2, PAGE, undefined)).toEqual([]);
    // Past the end with an exhausted server: only the next window is
    // re-attempted (bounded, self-terminating once it comes back short).
    expect(missingFoodPages(45, 4, PAGE, undefined)).toEqual([4]);
    expect(missingFoodPages(45, 5, PAGE, undefined)).toEqual([4]);
  });

  it('stops at the reported total instead of overshooting', () => {
    // 20 meals total: page 2 needs rows 15..19 → only page 2, nothing beyond.
    expect(missingFoodPages(15, 3, PAGE, 20)).toEqual([2]);
    expect(missingFoodPages(20, 3, PAGE, 20)).toEqual([]);
  });

  it('handles boundary equality: exactly one window loaded still pulls the next', () => {
    expect(missingFoodPages(15, 2, PAGE, 30)).toEqual([2]);
  });
});
