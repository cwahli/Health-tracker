import { deleteDebugPayloadFromR2 } from './r2Storage';
import { d1Query, isD1Configured, safeJsonParse } from '../../server_d1.js';

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
 * Extracts a normalized list of references from bug tracker tables (issue_tags, issue_backlog)
 * to ensure that any debug log referenced in the bug tracker is protected from automated deletion.
 *
 * D-2: D1-only. Production path reads D1 (`issue_tags`, `issue_backlog` minimal
 * columns; `golden_cases` has no D1 table and is skipped). The optional `db`
 * arg is legacy DI for tests (Supabase-style `.from()` stub); when provided it
 * is used as-is. No Supabase import, no 402.
 */
export async function getBugTrackerProtectedRefs(db?: any): Promise<Set<string>> {
  const protectedRefs = new Set<string>();

  // Legacy DI (tests): Supabase-style stub with .from()
  const admin = db && typeof db.from === 'function' ? db : null;

  if (!admin) {
    // D1 production path
    if (!isD1Configured()) return protectedRefs;
    try {
      const tagRes = await d1Query<any>(`SELECT id, work_item, comments FROM issue_tags LIMIT 500`);
      if (tagRes.success && Array.isArray(tagRes.results)) {
        for (const tag of tagRes.results) {
          if (tag.id) protectedRefs.add(String(tag.id).trim().toLowerCase());
          const wi = typeof tag.work_item === 'string' ? safeJsonParse(tag.work_item, null) : tag.work_item;
          if (wi && typeof wi === 'object') {
            if (Array.isArray(wi.hold_refs)) {
              for (const ref of wi.hold_refs) {
                if (ref) {
                  const s = String(ref).trim().toLowerCase();
                  protectedRefs.add(s);
                  extractJobIdsFromUrl(s).forEach((jid) => protectedRefs.add(jid));
                }
              }
            }
            if (wi.job_id) protectedRefs.add(String(wi.job_id).trim().toLowerCase());
            if (wi.current_evidence) {
              const ev = wi.current_evidence;
              if (ev.job_id) protectedRefs.add(String(ev.job_id).trim().toLowerCase());
              if (ev.debug_url) {
                const u = String(ev.debug_url).trim().toLowerCase();
                protectedRefs.add(u);
                extractJobIdsFromUrl(u).forEach((jid) => protectedRefs.add(jid));
              }
              if (ev.r2_prefix) protectedRefs.add(String(ev.r2_prefix).trim().toLowerCase());
            }
          }
        }
      }
    } catch (err) {
      console.warn('[DebugLogRetention] Error querying D1 issue_tags for protected refs:', err);
    }
    try {
      const blRes = await d1Query<any>(`SELECT id, payload FROM issue_backlog LIMIT 500`);
      if (blRes.success && Array.isArray(blRes.results)) {
        for (const item of blRes.results) {
          if (item.id) protectedRefs.add(String(item.id).trim().toLowerCase());
          const p = typeof item.payload === 'string' ? safeJsonParse(item.payload, null) : item.payload;
          if (p && typeof p === 'object') {
            if (p.activeJobId) protectedRefs.add(String(p.activeJobId).trim().toLowerCase());
            if (p.tagId) protectedRefs.add(String(p.tagId).trim().toLowerCase());
            if (p.r2_prefix) protectedRefs.add(String(p.r2_prefix).trim().toLowerCase());
            if (p.debug_url) {
              const u = String(p.debug_url).trim().toLowerCase();
              protectedRefs.add(u);
              extractJobIdsFromUrl(u).forEach((jid) => protectedRefs.add(jid));
            }
            if (p.backendLogsUrl) {
              const u = String(p.backendLogsUrl).trim().toLowerCase();
              protectedRefs.add(u);
              extractJobIdsFromUrl(u).forEach((jid) => protectedRefs.add(jid));
            }
          }
        }
      }
    } catch (err) {
      console.warn('[DebugLogRetention] Error querying D1 issue_backlog for protected refs:', err);
    }
    // golden_cases has no D1 table — skipped (no 402, no stub).
    return protectedRefs;
  }

  // 1. Query issue_tags (fix items, cards, work_items)
  try {
    const { data: tags, error } = await admin
      .from('issue_tags')
      .select('id, tag_id, work_item, linked_issues, comments, resolution_note');

    if (!error && Array.isArray(tags)) {
      for (const tag of tags) {
        if (tag.id) protectedRefs.add(String(tag.id).trim().toLowerCase());
        if (tag.tag_id) protectedRefs.add(String(tag.tag_id).trim().toLowerCase());

        const wi = tag.work_item;
        if (wi && typeof wi === 'object') {
          if (Array.isArray(wi.hold_refs)) {
            for (const ref of wi.hold_refs) {
              if (ref) {
                const s = String(ref).trim().toLowerCase();
                protectedRefs.add(s);
                extractJobIdsFromUrl(s).forEach((jid) => protectedRefs.add(jid));
              }
            }
          }
          if (wi.job_id) protectedRefs.add(String(wi.job_id).trim().toLowerCase());
          if (wi.current_evidence) {
            const ev = wi.current_evidence;
            if (ev.job_id) protectedRefs.add(String(ev.job_id).trim().toLowerCase());
            if (ev.debug_url) {
              const u = String(ev.debug_url).trim().toLowerCase();
              protectedRefs.add(u);
              extractJobIdsFromUrl(u).forEach((jid) => protectedRefs.add(jid));
            }
            if (ev.r2_prefix) protectedRefs.add(String(ev.r2_prefix).trim().toLowerCase());
          }
        }

        if (Array.isArray(tag.linked_issues)) {
          for (const link of tag.linked_issues) {
            if (typeof link === 'string') {
              protectedRefs.add(link.trim().toLowerCase());
            } else if (link && typeof link === 'object') {
              if (link.id) protectedRefs.add(String(link.id).trim().toLowerCase());
              if (link.job_id) protectedRefs.add(String(link.job_id).trim().toLowerCase());
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('[DebugLogRetention] Error querying issue_tags for protected refs:', err);
  }

  // 2. Query issue_backlog (snapped reports & raw items)
  try {
    const { data: backlog, error } = await admin
      .from('issue_backlog')
      .select('id, job_id, payload');

    if (!error && Array.isArray(backlog)) {
      for (const item of backlog) {
        if (item.id) protectedRefs.add(String(item.id).trim().toLowerCase());
        if (item.job_id) protectedRefs.add(String(item.job_id).trim().toLowerCase());

        const p = item.payload;
        if (p && typeof p === 'object') {
          if (p.activeJobId) protectedRefs.add(String(p.activeJobId).trim().toLowerCase());
          if (p.tagId) protectedRefs.add(String(p.tagId).trim().toLowerCase());
          if (p.r2_prefix) protectedRefs.add(String(p.r2_prefix).trim().toLowerCase());
          if (p.debug_url) {
            const u = String(p.debug_url).trim().toLowerCase();
            protectedRefs.add(u);
            extractJobIdsFromUrl(u).forEach((jid) => protectedRefs.add(jid));
          }
          if (p.backendLogsUrl) {
            const u = String(p.backendLogsUrl).trim().toLowerCase();
            protectedRefs.add(u);
            extractJobIdsFromUrl(u).forEach((jid) => protectedRefs.add(jid));
          }
          if (p.env && typeof p.env === 'object' && p.env.activeJobId) {
            protectedRefs.add(String(p.env.activeJobId).trim().toLowerCase());
          }
          if (Array.isArray(p.r2_files)) {
            for (const f of p.r2_files) {
              if (f && f.key) {
                const k = String(f.key).trim().toLowerCase();
                protectedRefs.add(k);
                extractJobIdsFromUrl(k).forEach((jid) => protectedRefs.add(jid));
              }
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('[DebugLogRetention] Error querying issue_backlog for protected refs:', err);
  }

  // 3. Query golden_cases (if present in D1 or database)
  try {
    const { data: golden, error } = await admin
      .from('golden_cases')
      .select('id, job_id, tag_id, r2_prefix');

    if (!error && Array.isArray(golden)) {
      for (const g of golden) {
        if (g.id) protectedRefs.add(String(g.id).trim().toLowerCase());
        if (g.job_id) protectedRefs.add(String(g.job_id).trim().toLowerCase());
        if (g.tag_id) protectedRefs.add(String(g.tag_id).trim().toLowerCase());
        if (g.r2_prefix) protectedRefs.add(String(g.r2_prefix).trim().toLowerCase());
      }
    }
  } catch {
    // golden_cases table may be purely in D1 or optional
  }

  return protectedRefs;
}

/**
 * Extracts possible job IDs from a debug URL or storage key
 */
function extractJobIdsFromUrl(urlOrKey: string): string[] {
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

/**
 * Prunes debug logs for a specific user.
 * Deletes debug payload from R2 and clears debug_url from D1 food_logs
 * for meals older than the last 10 that are NOT filed in the bug tracker.
 *
 * D-2: D1-only in production. `options.db` is legacy DI for tests
 * (a `.from()` stub); when provided the legacy path runs unchanged.
 */
export async function pruneUserDebugLogs(
  userId: string,
  options?: { maxRetention?: number; db?: any }
): Promise<{
  success: boolean;
  totalMeals: number;
  keptCount: number;
  prunedCount: number;
  bugProtectedCount: number;
  prunedFoodIds: string[];
}> {
  const maxRetention = options?.maxRetention ?? 10;
  const admin = options?.db;

  if (!admin) {
    return pruneUserDebugLogsD1(userId, maxRetention);
  }

  try {
    const possibleUids = [
      userId,
      userId.replace(/[^a-zA-Z0-9]/g, '_'),
      userId.toLowerCase(),
      `admin_${userId.toLowerCase().replace(/[^a-zA-Z0-9]/g, '_')}`
    ];

    // Fetch food logs for user
    const { data: rawFoods, error: foodErr } = await admin
      .from('food_logs')
      .select('id, firebase_uid, date, name, debug_url, updated_at')
      .in('firebase_uid', possibleUids);

    if (foodErr || !rawFoods) {
      console.warn('[DebugLogRetention] Failed to fetch food_logs for prune:', foodErr?.message);
      return {
        success: false,
        totalMeals: 0,
        keptCount: 0,
        prunedCount: 0,
        bugProtectedCount: 0,
        prunedFoodIds: [],
      };
    }

    const sortedFoods = sortFoodLogsDescending(rawFoods);
    const protectedRefs = await getBugTrackerProtectedRefs(admin);

    let keptCount = 0;
    let prunedCount = 0;
    let bugProtectedCount = 0;
    const prunedFoodIds: string[] = [];

    for (let i = 0; i < sortedFoods.length; i++) {
      const food = sortedFoods[i];
      const isLast10 = i < maxRetention;

      if (isLast10) {
        keptCount++;
        continue;
      }

      // Meal rank 11 or older
      const isProtected = isJobOrFoodProtectedByBugTracker(food, protectedRefs);
      if (isProtected) {
        bugProtectedCount++;
        keptCount++;
        continue;
      }

      // Beyond last 10 AND not in bug tracker -> delete debug log
      if (food.debug_url) {
        try {
          await deleteDebugPayloadFromR2(food.debug_url, food.firebase_uid);
        } catch (delErr) {
          console.warn(`[DebugLogRetention] Failed deleting R2 payload for food ${food.id}:`, delErr);
        }

        // Clear debug_url in database
        await admin.from('food_logs').update({ debug_url: null }).eq('id', food.id);

        // Also check if there's an associated agent_jobs row
        const extractedJid = food.debug_url.match(/debug\/(?:[^\/]+\/)?([a-zA-Z0-9_\-]+)\.json/i)?.[1];
        if (extractedJid) {
          await admin.from('agent_jobs').update({ debug_url: null }).eq('id', extractedJid);
        }

        prunedCount++;
        prunedFoodIds.push(food.id);
      }
    }

    console.log(
      `[DebugLogRetention] User ${userId}: ${sortedFoods.length} total meals, kept ${keptCount} (including ${bugProtectedCount} bug tracker holds), pruned ${prunedCount} old debug logs.`
    );

    return {
      success: true,
      totalMeals: sortedFoods.length,
      keptCount,
      prunedCount,
      bugProtectedCount,
      prunedFoodIds,
    };
  } catch (err: any) {
    console.error('[DebugLogRetention] pruneUserDebugLogs error:', err?.message || err);
    return {
      success: false,
      totalMeals: 0,
      keptCount: 0,
      prunedCount: 0,
      bugProtectedCount: 0,
      prunedFoodIds: [],
    };
  }
}

/**
 * D1 production path for pruneUserDebugLogs (no Supabase, no 402).
 */
async function pruneUserDebugLogsD1(
  userId: string,
  maxRetention: number
): Promise<{
  success: boolean;
  totalMeals: number;
  keptCount: number;
  prunedCount: number;
  bugProtectedCount: number;
  prunedFoodIds: string[];
}> {
  const fail = {
    success: false,
    totalMeals: 0,
    keptCount: 0,
    prunedCount: 0,
    bugProtectedCount: 0,
    prunedFoodIds: [] as string[],
  };
  if (!isD1Configured()) return fail;
  try {
    const possibleUids = [
      userId,
      userId.replace(/[^a-zA-Z0-9]/g, '_'),
      userId.toLowerCase(),
      `admin_${userId.toLowerCase().replace(/[^a-zA-Z0-9]/g, '_')}`
    ];
    const placeholders = possibleUids.map(() => '?').join(', ');
    const foodRes = await d1Query<any>(
      `SELECT id, firebase_uid, date, name, debug_url, updated_at FROM food_logs WHERE firebase_uid IN (${placeholders}) LIMIT 2000`,
      possibleUids
    );
    if (!foodRes.success || !foodRes.results) {
      console.warn('[DebugLogRetention] Failed to fetch D1 food_logs for prune:', foodRes.error);
      return fail;
    }
    const sortedFoods = sortFoodLogsDescending(foodRes.results);
    const protectedRefs = await getBugTrackerProtectedRefs();

    let keptCount = 0;
    let prunedCount = 0;
    let bugProtectedCount = 0;
    const prunedFoodIds: string[] = [];

    for (let i = 0; i < sortedFoods.length; i++) {
      const food = sortedFoods[i];
      if (i < maxRetention) {
        keptCount++;
        continue;
      }
      if (isJobOrFoodProtectedByBugTracker(food, protectedRefs)) {
        bugProtectedCount++;
        keptCount++;
        continue;
      }
      if (food.debug_url) {
        try {
          await deleteDebugPayloadFromR2(food.debug_url, food.firebase_uid);
        } catch (delErr) {
          console.warn(`[DebugLogRetention] Failed deleting R2 payload for food ${food.id}:`, delErr);
        }
        await d1Query(`UPDATE food_logs SET debug_url = NULL WHERE id = ?`, [food.id]);
        const extractedJid = String(food.debug_url).match(/debug\/(?:[^\/]+\/)?([a-zA-Z0-9_\-]+)\.json/i)?.[1];
        if (extractedJid) {
          await d1Query(`UPDATE agent_jobs SET debug_url = NULL WHERE id = ?`, [extractedJid]);
        }
        prunedCount++;
        prunedFoodIds.push(food.id);
      }
    }

    console.log(
      `[DebugLogRetention] User ${userId}: ${sortedFoods.length} total meals, kept ${keptCount} (including ${bugProtectedCount} bug tracker holds), pruned ${prunedCount} old debug logs.`
    );
    return { success: true, totalMeals: sortedFoods.length, keptCount, prunedCount, bugProtectedCount, prunedFoodIds };
  } catch (err: any) {
    console.error('[DebugLogRetention] pruneUserDebugLogsD1 error:', err?.message || err);
    return fail;
  }
}
