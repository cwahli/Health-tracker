/**
 * Debug log retention — pure/client-safe half.
 *
 * This module is imported by client code (`FoodHistoryTab`) and MUST stay free
 * of server-only imports (`server_d1`, dotenv, …). The D1/R2 pruning half lives
 * in `src/server/debugLogRetention.ts`; importing it here would pull `dotenv`
 * into the browser bundle and crash the app with `process is not defined`.
 */

export interface DebugRetentionCheckItem {
  id?: string;
  jobId?: string;
  debug_url?: string | null;
  debugUrl?: string | null;
  date?: string;
  created_at?: string;
  updated_at?: string;
  name?: string;
}

export interface DebugRetentionResult {
  kept: boolean;
  isLast10: boolean;
  isBugProtected: boolean;
  rank: number;
}

/**
 * Extracts possible job IDs from a debug URL or storage key
 */
export function extractJobIdsFromUrl(urlOrKey: string): string[] {
  const results: string[] = [];
  if (!urlOrKey) return results;

  const debugMatch = urlOrKey.match(/debug\/(?:[^\/]+\/)?([a-zA-Z0-9_\-]+)\.json/i);
  if (debugMatch && debugMatch[1]) results.push(debugMatch[1].toLowerCase());

  const logMatch = urlOrKey.match(/logs\/([a-zA-Z0-9_\-]+)\.log/i);
  if (logMatch && logMatch[1]) results.push(logMatch[1].toLowerCase());

  const jobMatch = urlOrKey.match(/jobs\/([a-zA-Z0-9_\-]+)_result\.json/i);
  if (jobMatch && jobMatch[1]) results.push(jobMatch[1].toLowerCase());

  const generalMatch = urlOrKey.match(/(job_[a-zA-Z0-9_\-]+)/i);
  if (generalMatch && generalMatch[1]) results.push(generalMatch[1].toLowerCase());

  return results;
}

/**
 * Checks if a food entry or job ID is referenced in the bug tracker.
 */
export function isJobOrFoodProtectedByBugTracker(
  item: DebugRetentionCheckItem,
  protectedSet: Set<string>
): boolean {
  if (!protectedSet || protectedSet.size === 0) return false;

  const candidates: string[] = [];

  if (item.id) candidates.push(item.id);
  if (item.jobId) candidates.push(item.jobId);

  const debugUrl = item.debug_url || item.debugUrl;
  if (debugUrl) {
    candidates.push(debugUrl);
    extractJobIdsFromUrl(debugUrl).forEach((jid) => candidates.push(jid));
  }

  for (const raw of candidates) {
    if (!raw) continue;
    const clean = String(raw).trim().toLowerCase();
    if (protectedSet.has(clean)) return true;

    // Check without prefixes
    const withoutJob = clean.replace(/^job_/, '');
    const withoutFood = clean.replace(/^food_/, '');
    const withoutClarify = clean.replace(/^clarify_/, '');

    if (protectedSet.has(withoutJob) || protectedSet.has(withoutFood) || protectedSet.has(withoutClarify)) {
      return true;
    }

    // Substring match for file paths or hold_refs
    for (const ref of protectedSet) {
      if (ref.length > 5 && (ref.includes(clean) || clean.includes(ref))) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Sorts food entries in reverse chronological order (newest date / timestamp first).
 */
export function sortFoodLogsDescending(logs: any[]): any[] {
  if (!Array.isArray(logs)) return [];
  return [...logs].sort((a, b) => {
    // 1. Compare date string (YYYY-MM-DD)
    const dateA = a.date || '';
    const dateB = b.date || '';
    if (dateA !== dateB) {
      return dateB.localeCompare(dateA);
    }
    // 2. Compare updated_at or created_at
    const timeA = new Date(a.updated_at || a.created_at || a.date || 0).getTime();
    const timeB = new Date(b.updated_at || b.created_at || b.date || 0).getTime();
    if (timeA !== timeB) {
      return timeB - timeA;
    }
    // 3. Fallback to id descending
    return String(b.id || '').localeCompare(String(a.id || ''));
  });
}

/**
 * Calculates debug retention status across a list of meals.
 * - The 10 most recent meals keep their debug logs (isLast10 = true, kept = true).
 * - Meals beyond 10 only keep their debug log if referenced in the bug tracker (isBugProtected = true, kept = true).
 * - All other meals beyond 10 have kept = false (to be deleted / purged).
 */
export function calculateMealDebugRetentionStatus(
  foodLogs: any[],
  protectedSet: Set<string> = new Set(),
  maxRetentionCount: number = 10
): Map<string, DebugRetentionResult> {
  const results = new Map<string, DebugRetentionResult>();
  const sorted = sortFoodLogsDescending(foodLogs);

  sorted.forEach((log, index) => {
    const isLast10 = index < maxRetentionCount;
    const isBugProtected = isJobOrFoodProtectedByBugTracker(log, protectedSet);
    const kept = isLast10 || isBugProtected;

    const key = String(log.id || `idx_${index}`);
    results.set(key, {
      kept,
      isLast10,
      isBugProtected,
      rank: index + 1,
    });
  });

  return results;
}
