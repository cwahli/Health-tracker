import { toYYYYMMDD } from './dateUtils';
import { isUsableImageUrl, resolveMealImageCandidates, uniqueMealImageUrls } from './foodImageSources';

export interface DedupableFoodLog {
  id?: string;
  name?: string;
  date?: string;
  weightGrams?: number;
  updated_at?: number;
  imageUrl?: string;
  imageUrls?: string[];
  nutrients?: { calories?: number };
  [key: string]: any;
}

const STOP_WORDS = new Set([
  'and',
  'with',
  'the',
  'a',
  'an',
  'of',
  'for',
  'in',
  'on',
  'to',
  'from',
  'meal',
  'food',
  'selection',
  'fresh',
  'produce',
]);

/** Normalize meal name for fingerprinting (drop trailing ellipsis from UI truncation). */
export function normalizeFoodName(name: unknown): string {
  return String(name || '')
    .toLowerCase()
    .replace(/\.{2,}/g, '')
    .replace(/…/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Significant tokens for soft matching (YOLK Chimi Salad vs Yolk Steak Bowl). */
export function significantFoodTokens(name: unknown): string[] {
  return normalizeFoodName(name)
    .split(' ')
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

/** Jaccard-ish: intersection / min(size) so shorter name can fully match. */
export function foodNameSimilarity(a: unknown, b: unknown): number {
  const ta = new Set(significantFoodTokens(a));
  const tb = new Set(significantFoodTokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  ta.forEach((t) => {
    if (tb.has(t)) inter++;
  });
  return inter / Math.min(ta.size, tb.size);
}

/** Parse calories from number or strings like "405", "405 kcal", "405.2kcal". */
export function parseFoodCalories(log: DedupableFoodLog): number {
  const raw = log.nutrients?.calories ?? (log as any).calories ?? (log as any).nutrients?.energy;
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.round(raw);
  if (raw == null || raw === '') return 0;
  const m = String(raw).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!m) return 0;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/**
 * Stable fingerprint for "same logical meal" across devices / retry ids.
 * Uses YYYY-MM-DD so DD-MM-YYYY and ISO timestamps collapse correctly.
 */
export function foodLogFingerprint(log: DedupableFoodLog): string {
  const rawName = normalizeFoodName(log.name);
  const date = toYYYYMMDD(log.date);
  const calories = parseFoodCalories(log);
  const nameKey = rawName.slice(0, 36).trim() || 'meal';
  if (calories > 50) {
    return `${nameKey}|${date}|c${calories}`;
  }
  const weight = Math.round(Number(log.weightGrams ?? (log as any).weight_grams ?? 0));
  if (weight > 0) {
    return `${nameKey}|${date}|w${weight}`;
  }
  const desc = String((log as any).description || (log as any).summary || (log as any).composition || '').slice(0, 20).toLowerCase().trim();
  const timeBucket = typeof log.updated_at === 'number' ? Math.floor(log.updated_at / (3 * 60 * 1000)) : (log.id ? String(log.id) : '0');
  return `${nameKey}|${date}|t:${desc || timeBucket}`;
}

/**
 * Aggressive cluster: same day + ~same kcal (±10 bucket) + first 4 name words.
 * Catches oatmeal/honi exact dups when date formats or tiny cal drift blocked exact fp.
 */
export function foodLogAggressiveKey(log: DedupableFoodLog): string {
  const date = toYYYYMMDD(log.date);
  const cal = parseFoodCalories(log);
  const calBucket = cal > 50 ? Math.round(cal / 10) * 10 : 0;
  const words = normalizeFoodName(log.name).split(' ').filter(Boolean).slice(0, 4).join(' ');
  return `${date}|c${calBucket}|${words || 'meal'}`;
}

/**
 * Soft cluster key: same calendar day + similar calories + shared food tokens.
 * Collapses "YOLK Chicken Sandwich and Steak Chimi Salad" vs "Yolk Chicken Sandwich and Steak Bowl".
 */
export function foodLogSoftClusterKey(log: DedupableFoodLog): string {
  const date = toYYYYMMDD(log.date);
  const calories = parseFoodCalories(log);
  // Bucket calories to ±5 so tiny float differences don't split clusters
  const calBucket = calories > 50 ? Math.round(calories / 5) * 5 : 0;
  const tokens = significantFoodTokens(log.name).slice(0, 5).sort();
  // Prefer brand/main dish tokens first 3
  const core = tokens.slice(0, 3).join('_') || normalizeFoodName(log.name).slice(0, 20) || 'meal';
  return `${date}|c${calBucket}|${core}`;
}

export function hasUsableFoodImage(log: DedupableFoodLog): boolean {
  if (isUsableImageUrl(log.imageUrl)) return true;
  if (Array.isArray(log.imageUrls) && log.imageUrls.some(isUsableImageUrl)) return true;
  return false;
}

/** Prefer row with real photos; then newer updated_at; merge image fields onto winner. */
function pickBetter<T extends DedupableFoodLog>(a: T, b: T): T {
  const aImg = hasUsableFoodImage(a);
  const bImg = hasUsableFoodImage(b);
  let winner: T;
  let loser: T;
  if (aImg !== bImg) {
    winner = aImg ? a : b;
    loser = aImg ? b : a;
  } else {
    const aTime = a.updated_at || 0;
    const bTime = b.updated_at || 0;
    // Prefer longer/more complete name when times similar
    if (Math.abs(aTime - bTime) < 1000) {
      const aLen = String(a.name || '').length;
      const bLen = String(b.name || '').length;
      winner = bLen > aLen ? b : a;
      loser = bLen > aLen ? a : b;
    } else {
      winner = bTime > aTime ? b : a;
      loser = bTime > aTime ? a : b;
    }
  }
  const candidates = uniqueMealImageUrls(
    resolveMealImageCandidates({
      imageUrl: winner.imageUrl || loser.imageUrl,
      imageUrls: [
        ...(Array.isArray(winner.imageUrls) ? winner.imageUrls : []),
        ...(Array.isArray(loser.imageUrls) ? loser.imageUrls : []),
        winner.imageUrl,
        loser.imageUrl,
      ].filter(Boolean) as string[],
    }),
  );
  // If either side is confirmed synced from server, and no subsequent local edits exist, mark as synced
  const isServerSynced = a.sync_state === 'synced' || b.sync_state === 'synced';
  const aTime = a.updated_at || 0;
  const bTime = b.updated_at || 0;
  const hasSubsequentLocalEdit = (winner.sync_state === 'update' || loser.sync_state === 'update') &&
    Math.abs(aTime - bTime) > 3000;
  const resolvedSyncState = isServerSynced && !hasSubsequentLocalEdit ? 'synced' : winner.sync_state;

  const resolved = {
    ...winner,
    sync_state: resolvedSyncState,
  };
  if (candidates.length === 0) return resolved;
  return {
    ...resolved,
    imageUrl: candidates[0],
    imageUrls: candidates,
  };
}

function shouldSoftMerge(a: DedupableFoodLog, b: DedupableFoodLog): boolean {
  const da = toYYYYMMDD(a.date);
  const db = toYYYYMMDD(b.date);
  if (da !== db) return false;

  const imgA = isUsableImageUrl(a.imageUrl)
    ? a.imageUrl
    : (Array.isArray(a.imageUrls) && a.imageUrls.find(isUsableImageUrl));
  const imgB = isUsableImageUrl(b.imageUrl)
    ? b.imageUrl
    : (Array.isArray(b.imageUrls) && b.imageUrls.find(isUsableImageUrl));

  // Same durable photo URL on same day → almost certainly the same meal (sync retry)
  if (imgA && imgB && String(imgA) === String(imgB)) return true;

  // Differentiate distinct explicit IDs if they do not share the exact same photo URL
  if (a.id && b.id && String(a.id) !== String(b.id)) {
    const timeA = typeof a.updated_at === 'number' ? a.updated_at : 0;
    const timeB = typeof b.updated_at === 'number' ? b.updated_at : 0;
    if (timeA > 0 && timeB > 0 && Math.abs(timeA - timeB) > 3 * 60 * 1000) {
      return false;
    }
  }

  const ca = parseFoodCalories(a);
  const cb = parseFoodCalories(b);
  if (ca > 50 && cb > 50) {
    if (Math.abs(ca - cb) > 12) return false; // allow small rounding / re-estimate
  } else if (ca > 0 && cb > 0 && Math.abs(ca - cb) > 12) {
    return false;
  }

  // Exact normalized name + same day
  if (normalizeFoodName(a.name) === normalizeFoodName(b.name) && normalizeFoodName(a.name).length >= 4) {
    return true;
  }

  const sim = foodNameSimilarity(a.name, b.name);
  if (sim >= 0.5) return true;

  // Same soft / aggressive cluster keys
  if (foodLogSoftClusterKey(a) === foodLogSoftClusterKey(b)) return true;
  if (foodLogAggressiveKey(a) === foodLogAggressiveKey(b)) return true;

  return false;
}

/**
 * Merge two lists (e.g. local + cloud). Collapses same id, same exact fingerprint,
 * AND soft near-duplicates (same day + kcal + similar name).
 */
export function mergeFoodLogsDeduped<T extends DedupableFoodLog>(a: T[], b: T[]): T[] {
  const byId = new Map<string, T>();
  const order: string[] = [];

  const ingest = (log: T) => {
    if (!log) return;
    const id = (log.id && String(log.id).trim()) || `fp:${foodLogFingerprint(log)}`;
    if (byId.has(id)) {
      byId.set(id, pickBetter(byId.get(id) as T, log));
    } else {
      byId.set(id, log);
      order.push(id);
    }
  };

  (a || []).forEach(ingest);
  (b || []).forEach(ingest);

  // Pass 1: exact fingerprint
  const byFingerprint = new Map<string, string>();
  let finalIds: string[] = [];

  order.forEach((id) => {
    const log = byId.get(id) as T;
    if (!log) return;
    const fp = foodLogFingerprint(log);
    const existingId = byFingerprint.get(fp);
    if (!existingId) {
      byFingerprint.set(fp, id);
      finalIds.push(id);
    } else {
      const kept = byId.get(existingId) as T;
      byId.set(existingId, pickBetter(kept, log));
    }
  });

  // Pass 2: soft merge (YOLK name variants, truncated titles, same image)
  const softKept: string[] = [];
  finalIds.forEach((id) => {
    const log = byId.get(id) as T;
    if (!log) return;
    let mergedInto: string | null = null;
    for (const keptId of softKept) {
      const kept = byId.get(keptId) as T;
      if (kept && shouldSoftMerge(kept, log)) {
        byId.set(keptId, pickBetter(kept, log));
        mergedInto = keptId;
        break;
      }
    }
    if (!mergedInto) softKept.push(id);
  });

  // Pass 3: aggressive key (day + 10kcal bucket + first 4 words) — last safety net for oatmeal/honi
  const byAgg = new Map<string, string>();
  const aggKept: string[] = [];
  softKept.forEach((id) => {
    const log = byId.get(id) as T;
    if (!log) return;
    const ak = foodLogAggressiveKey(log);
    const existing = byAgg.get(ak);
    if (!existing) {
      byAgg.set(ak, id);
      aggKept.push(id);
    } else {
      byId.set(existing, pickBetter(byId.get(existing) as T, log));
    }
  });

  const results = aggKept.map((id) => byId.get(id) as T).filter(Boolean);
  return results.sort((a, b) => {
    const dateA = toYYYYMMDD(a.date);
    const dateB = toYYYYMMDD(b.date);
    if (dateA !== dateB) return dateB.localeCompare(dateA);
    const timeA = typeof a.updated_at === 'number' ? a.updated_at : 0;
    const timeB = typeof b.updated_at === 'number' ? b.updated_at : 0;
    return timeB - timeA;
  });
}

/**
 * Copy usable images from a donor list onto targets missing photos.
 * Matches by id first, then by foodLogFingerprint, then soft name+day+kcal.
 */
export function rehydrateFoodImagesFromDonors<T extends DedupableFoodLog>(
  targets: T[],
  donors: T[]
): T[] {
  if (!Array.isArray(targets) || targets.length === 0) return targets || [];
  if (!Array.isArray(donors) || donors.length === 0) return targets;

  const byId = new Map<string, T>();
  const byFp = new Map<string, T>();
  const donorList = donors.filter((d) => d && hasUsableFoodImage(d));
  donorList.forEach((d) => {
    if (d.id) byId.set(String(d.id), d);
    byFp.set(foodLogFingerprint(d), d);
  });

  return targets.map((t) => {
    if (!t) return t;
    let donor =
      (t.id && byId.get(String(t.id))) || byFp.get(foodLogFingerprint(t)) || null;
    if (!donor) {
      donor = donorList.find((d) => shouldSoftMerge(d, t)) || null;
    }
    
    const targetCandidates = uniqueMealImageUrls(
      resolveMealImageCandidates({
        imageUrl: t.imageUrl,
        imageUrls: t.imageUrls,
      }),
    );

    // Already has a photo — do not union another meal's URLs (sync duplicate slides).
    if (targetCandidates.length > 0) {
      return {
        ...t,
        imageUrl: targetCandidates[0],
        imageUrls: targetCandidates,
      };
    }

    if (!donor || !hasUsableFoodImage(donor)) return t;

    const donorCandidates = uniqueMealImageUrls(
      resolveMealImageCandidates({
        imageUrl: donor.imageUrl,
        imageUrls: donor.imageUrls,
      }),
    );
    if (donorCandidates.length === 0) return t;
    return {
      ...t,
      imageUrl: donorCandidates[0],
      imageUrls: donorCandidates,
    };
  });
}

/* export function rehydrateFoodImagesFromDonors export function foodLogFingerprint toYYYYMMDD foodLogFingerprint */
