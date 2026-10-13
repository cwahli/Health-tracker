/**
 * Meal-history pagination math.
 *
 * Class: COMBINED_LIST_PAGINATION — the history list mixes saved food logs
 * with job cards, but the server pages food logs only (`OFFSET` over
 * `food_logs`). Any fetch decision measured against the *combined* list
 * length false-negatives as soon as job cards pad the list (page 2+ then
 * shows job cards and never loads meals), and fetching only the tapped page
 * leaves a permanent gap when a page was skipped. Measure against loaded
 * food logs and fill every missing food window up to the target page.
 *
 * Sensor: `src/utils/__tests__/foodPagination.test.ts`.
 */

export interface FoodFetchPlanArgs {
  /** Food logs currently in memory (NOT the combined logs+jobs list). */
  loadedFoods: number;
  /** 1-based page the user is turning to. */
  targetPage: number;
  /** Rows per page (matches `FOOD_HISTORY_PAGE_SIZE`). */
  pageSize: number;
  /** Server-reported total food count, when known. */
  totalFoods?: number;
}

/**
 * Food-log pages (1-based) still missing to fill `targetPage`.
 * Empty when the target window is already loaded, when searching (the server
 * window does not apply to a filtered list), or when no total was ever
 * reported (never fetch blindly on an unknown total).
 */
export function missingFoodPages(
  loadedFoods: number,
  targetPage: number,
  pageSize: number,
  totalFoods?: number,
): number[] {
  const safeLoaded = Math.max(0, Math.floor(loadedFoods) || 0);
  const safeSize = Math.max(1, Math.floor(pageSize) || 1);
  const safeTarget = Math.max(1, Math.floor(targetPage) || 1);
  const reported = typeof totalFoods === 'number' && totalFoods > 0 ? Math.floor(totalFoods) : 0;
  const total = Math.max(reported, safeLoaded);
  const needUntil = Math.min(safeTarget * safeSize, total);
  const pages: number[] = [];
  let cursor = safeLoaded;
  let guard = 0;
  while (cursor < needUntil && guard < 1000) {
    guard += 1;
    pages.push(Math.floor(cursor / safeSize) + 1);
    cursor += safeSize;
  }
  return pages;
}

/** Whether turning to `targetPage` must pull food pages first. */
export function needsFoodFetch(args: {
  searchTerm: string;
  loadedFoods: number;
  targetPage: number;
  pageSize: number;
  totalFoods?: number;
}): boolean {
  if ((args.searchTerm || '').length > 0) return false;
  return (
    missingFoodPages(args.loadedFoods, args.targetPage, args.pageSize, args.totalFoods).length > 0
  );
}
