/**
 * Case-12 T2 — same-thread meal edit ("add oats, drop the coconut").
 *
 * The meal sheet closes on submit and reopening it always binds a *fresh blank draft*
 * job (App.tsx `onLogMeal` creates a new job). `hasPriorResult` is therefore false and
 * the submit path dropped to `review`, which lost the add/remove intent and
 * double-counted the meal (phantom estimate row + lock row) instead of editing it.
 *
 * This module is the discriminator only. It is pure and side-effect free so the
 * T1-vs-T2 behaviour can be asserted without a browser or a live model.
 *
 * Why `imageCount` is the right discriminator: T0 setup already leaves a *succeeded*
 * food job before T1 runs, so "adopt the most recent meal" alone would turn T1 (which
 * sends a photo) into an edit of T0's meal and break the currently-green T1.
 * A staged photo means a new scan; text-only on a blank draft means a follow-up.
 *
 * Why an explicit edit verb is *also* required: a blank text-only draft is not enough
 * on its own. A user who logged lunch and then types "nasi goreng" for a genuinely new
 * dinner would otherwise have dinner merged into lunch. Only a command against the
 * previous meal ("add oats, drop the coconut") opts into editing it.
 */

/** A follow-up is treated as a continuation of a meal logged within this window. */
export const FOLLOW_UP_EDIT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * An explicit command against the previous meal (EN + ID).
 *
 * Deliberately action verbs only. Composition words ("without", "tanpa", "no", "extra",
 * "more") are excluded because they describe *what* a meal is — "kopi tanpa gula" is a
 * new drink, not an instruction to edit the last one.
 */
export const EDIT_INTENT_PATTERN =
  /\b(add|adds|added|tambah|tambahkan|remove|removes|removed|drop|drops|dropped|delete|deletes|deleted|hapus|hilangkan|buang|kurang|kurangi|swap|swaps|swapped|replace|replaces|replaced|change|changes|changed|ganti|gantikan)\b/i;

/** True when the typed text commands a change to an existing meal. */
export function hasEditIntent(text: string | null | undefined): boolean {
  return typeof text === 'string' && EDIT_INTENT_PATTERN.test(text);
}

/** Minimal structural view of a FoodLog — avoids importing the full type. */
export interface FollowUpMealLike {
  date?: string;
  updated_at?: number;
  sync_state?: string;
}

export interface FollowUpEditContext {
  /** The bound job already produced a result (existing, unchanged lever). */
  hasPriorResult: boolean;
  /** Number of messages already on the bound job. */
  existingMessageCount: number;
  /** Number of images currently staged in the composer. */
  imageCount: number;
  /** The text about to be submitted (tags included — the command lives in it). */
  text?: string | null;
  /** The mode pill the user is on. */
  mappedMode: 'review' | 'compare' | 'edit' | string;
  /** Active (non-deleted) meal logs, oldest→newest by insertion. */
  foodLogs?: FollowUpMealLike[] | null;
  /** Injectable clock, for deterministic tests. */
  nowMs?: number;
  /** Override the continuation window. */
  maxAgeMs?: number;
}

/**
 * Best-effort timestamp (ms) for a meal log.
 * Prefers `updated_at` (exact epoch ms); falls back to `date`. A date-only string is
 * treated as local noon so a same-day meal is never rejected for missing a time part.
 */
export function mealTimestamp(log: FollowUpMealLike | null | undefined): number | null {
  if (!log) return null;
  if (typeof log.updated_at === 'number' && Number.isFinite(log.updated_at)) {
    return log.updated_at;
  }
  const raw = typeof log.date === 'string' ? log.date.trim() : '';
  if (!raw) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const parsed = Date.parse(dateOnly ? `${raw}T12:00:00` : raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * True when this submit must edit the most recent meal rather than start a new scan.
 *
 * Requires ALL of: a blank draft (no result, no conversation), no staged image,
 * an explicit edit command in the text, a recently logged active meal, and a
 * non-compare pill.
 */
export function isMealFollowUpEdit(ctx: FollowUpEditContext): boolean {
  if (ctx.mappedMode === 'compare') return false;
  if (ctx.mappedMode === 'edit') return true;
  if (ctx.hasPriorResult) return false;
  if (ctx.existingMessageCount > 0) return false;
  if (ctx.imageCount > 0) return false;
  if (!hasEditIntent(ctx.text)) return false;

  const recent = mostRecentActiveMeal(ctx.foodLogs);
  if (!recent) return false;

  const lastAt = mealTimestamp(recent);
  if (lastAt == null) return false;

  const nowMs = typeof ctx.nowMs === 'number' ? ctx.nowMs : Date.now();
  const age = nowMs - lastAt;
  // Negative age means clock skew / a future-dated log: treat as just-now.
  if (age < 0) return true;
  return age <= (ctx.maxAgeMs ?? FOLLOW_UP_EDIT_MAX_AGE_MS);
}

/**
 * Newest active meal by timestamp.
 *
 * `foodLogs` is newest-first after `mergeFoodLogsDeduped` (date DESC, then
 * updated_at DESC), so `array[array.length - 1]` is the *oldest* meal — using
 * that as the continuation target made live T2 fall through to `review` whenever
 * any older-than-24h log sat at the tail (common on demo/synced profiles).
 */
export function mostRecentActiveMeal<T extends FollowUpMealLike>(
  foodLogs: T[] | null | undefined,
): T | null {
  const active = (foodLogs || []).filter((l) => l && l.sync_state !== 'delete');
  if (active.length === 0) return null;
  let best: T | null = null;
  let bestAt = -Infinity;
  for (const log of active) {
    const at = mealTimestamp(log);
    if (at == null) continue;
    if (at >= bestAt) {
      bestAt = at;
      best = log;
    }
  }
  // If nothing had a parseable timestamp, fall back to insertion-last (legacy).
  return best ?? active[active.length - 1];
}

/**
 * Hydrates a D1-pulled (listOnly, breakdown-less) meal into an editable meal.
 *
 * Fresh-thread edits attach `mostRecentActiveMeal(activeFoodLogs)`, but paged
 * pulls carry light columns only — no `itemsBreakdown` — so the server edit
 * inherits zero priors and silently returns the meal unchanged (live T2 gap:
 * the client sent mode=edit with an empty meal). Fetch the full detail once
 * for the chosen meal; on any failure return the light row (no regression).
 */
export async function ensureMealBreakdown(
  meal: any,
  fetchDetail?: (id: string) => Promise<any>,
): Promise<any> {
  if (!meal || typeof meal !== 'object') return meal;
  if (Array.isArray(meal.itemsBreakdown) && meal.itemsBreakdown.length > 0) return meal;
  if (Array.isArray(meal.items) && meal.items.length > 0) return meal;
  const id = meal.id;
  if (!id || !fetchDetail) return meal;
  try {
    const detail = await fetchDetail(id);
    const raw = detail?.itemsBreakdown ?? detail?.items_breakdown ?? detail?.food?.itemsBreakdown;
    const list = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(list) && list.length > 0) return { ...meal, itemsBreakdown: list };
  } catch {
    // Keep the light row — server falls back to no-op rather than failing.
  }
  return meal;
}

export interface PriorSucceededJobLike {
  id?: string;
  status?: string;
  kind?: string;
  result?: { pendingFoodLog?: any; clean_result?: any; data?: any } | null;
}

/** Meal carried by a succeeded session job, if any. Mirrors the spec's
`dishesOf` read paths: live T1 jobs carry the meal under
`result.clean_result.pendingFoodLog`, not `result.pendingFoodLog`. */
export function pendingMealOfJob(job: PriorSucceededJobLike | null | undefined): any | null {
  const r = job?.result;
  return (
    r?.pendingFoodLog ||
    r?.clean_result?.pendingFoodLog ||
    (job as any)?.clean_result?.pendingFoodLog ||
    r?.data?.pendingFoodLog ||
    null
  );
}

/**
 * Newest succeeded food job in this session (excluding the current draft).
 *
 * Blank-draft follow-ups must adopt THIS meal first: the `foodLogs` list can
 * hold stale demo seeds that outrank the just-saved meal, which made live T2
 * attach a stale log with an empty breakdown (server returned zero dishes).
 * `getAllJobs` is createdAt-ascending, so the last match is the newest.
 */
export function newestSucceededFoodJob<T extends PriorSucceededJobLike>(
  jobs: readonly T[] | null | undefined,
  currentJobId?: string | null,
): T | null {
  let best: T | null = null;
  for (const j of jobs || []) {
    if (!j || (currentJobId != null && j.id === currentJobId)) continue;
    if (j.status !== 'succeeded') continue;
    if (j.kind != null && j.kind !== 'food_log' && j.kind !== 'food') continue;
    if (!pendingMealOfJob(j)) continue;
    best = j;
  }
  return best;
}
