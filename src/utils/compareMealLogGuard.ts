/**
 * compareMealLogGuard.ts — Mode D boundary: a compare (evaluation) result is
 * NEVER a meal. Its items are mutually exclusive candidate choices, not a
 * consumed plate. Two live failure shapes forced this guard:
 *
 * 1. Pseudo meal logs: `extractPendingFoodLogFromCleanResult` (App.tsx) and
 *    `resolvePendingFoodLog` (LogChat.tsx) used to fabricate a food log out
 *    of ANY items array — including the 19 compared products of a shelf
 *    compare. That produced a 19-name `&`-joined card title, a Components
 *    list duplicating the composition tiles, and a "Log This Food" button
 *    that would log 19 compared products as a consumed meal.
 * 2. Dropped comparison: the App.tsx poller finalize whitelist never copied
 *    `comparison` into the message, so group cards never rendered on the
 *    server-owned polling path (the path every real photo submission takes).
 */
export function isCompareOnlyResult(res: any): boolean {
  if (!res || typeof res !== 'object') return false;
  const isCompareMode = (res as any).mode === 'evaluation' || (res as any).mode === 'compare' || (res as any).kind === 'food_compare';
  const hasComparison = !!(res as any).comparison || (Array.isArray((res as any).groups) && (res as any).groups.length > 0) || Boolean((res as any).comparisonTitle);
  return isCompareMode && hasComparison;
}
