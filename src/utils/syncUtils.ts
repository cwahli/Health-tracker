import { FoodLog, BiomarkerLog, HealthAction, DailyBenefit, FoodIdea, RecommendationReport, UserProfile } from '../types';
import { supabase, isSupabaseConfigured } from './supabaseClient';
import { resolveMealVerdict } from './verdictUtils.js';
import { translations } from './translations';


// Attach the Firebase ID token when signed in so the authenticated
// server pull endpoints (/api/sync/*, 401-enforced in production)
// accept the request. Falls back to the htk session auto-attach
// (breadcrumbTracker) when Firebase is signed out.
// Exported so LogChat and other call sites reuse the same header builder
// (L5: one path fixed ≠ all paths).
export async function pullAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const { auth } = await import('../firebase');
    const token = auth.currentUser ? await auth.currentUser.getIdToken().catch(() => undefined) : undefined;
    if (token) headers['Authorization'] = 'Bearer ' + token;
  } catch { /* offline / signed out: server decides */ }
  return headers;
}

export function mergeByRecency<T extends { id?: string; updated_at?: number | string; date?: string; timestamp?: string }>(
  listA: T[] = [],
  listB: T[] = []
): T[] {
  const map = new Map<string, T>();

  const getTimestamp = (item: T): number => {
    const t = item.updated_at || item.timestamp || item.date || 0;
    if (typeof t === 'number') return t;
    if (typeof t === 'string') {
      const parsed = new Date(t).getTime();
      return isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  };

  for (const item of [...listA, ...listB]) {
    const id = item.id;
    if (!id) continue;
    const existing = map.get(id);
    if (!existing) {
      map.set(id, item);
    } else {
      const timeNew = getTimestamp(item);
      const timeExisting = getTimestamp(existing);
      if (timeNew >= timeExisting) {
        map.set(id, item);
      }
    }
  }

  return Array.from(map.values());
}

export function mergeActions(a: HealthAction[] = [], b: HealthAction[] = []): HealthAction[] {
  return mergeByRecency(a, b) as HealthAction[];
}

export function mergeBenefits(a: DailyBenefit[] = [], b: DailyBenefit[] = []): DailyBenefit[] {
  return mergeByRecency(a, b) as DailyBenefit[];
}

export function mergeFoodIdeas(a: FoodIdea[] = [], b: FoodIdea[] = []): FoodIdea[] {
  return mergeByRecency(a, b) as FoodIdea[];
}

export function mergeReports(a?: RecommendationReport | null, b?: RecommendationReport | null): RecommendationReport | null {
  if (!a) return b || null;
  if (!b) return a;
  const timeA = new Date(a.timestamp || 0).getTime();
  const timeB = new Date(b.timestamp || 0).getTime();
  return timeB >= timeA ? b : a;
}

// Every place in the app that constructs a brand-new UserProfile needs to
// pick an initial language the same way: prefer an explicit choice made this
// session (e.g. passed through from the just-completed login/signup flow),
// then fall back to whatever the person selected on the language picker
// before they logged in (persisted to localStorage), and only default to
// English if neither is available. Before this helper existed, some call
// sites (loadUserData's new-profile branch) implemented this correctly while
// others (checkForDbChanges' "brand new sign up, no cloud doc yet" branch)
// hardcoded 'en' with no fallback at all - a race between the two on a
// fresh signup could let the hardcoded English default win and overwrite
// the language the person had just picked, even though nothing was ever
// "wrong" from either code path's own local point of view.
export function resolveInitialLanguage(chosenLanguage?: string | null): 'en' | 'fr' | 'zh' | 'id' {
  const valid = ['en', 'fr', 'zh', 'id'];
  if (chosenLanguage && valid.includes(chosenLanguage)) {
    return chosenLanguage as 'en' | 'fr' | 'zh' | 'id';
  }
  try {
    const preferred = typeof localStorage !== 'undefined' ? localStorage.getItem('preferred_language') : null;
    if (preferred && valid.includes(preferred)) {
      return preferred as 'en' | 'fr' | 'zh' | 'id';
    }
  } catch {
    // localStorage unavailable (SSR/sandboxed) - fall through to default
  }
  return 'en';
}

export function mergeProfiles(a?: UserProfile | null, b?: UserProfile | null): UserProfile | null {
  if (!a) return b || null;
  if (!b) return a;
  return { ...a, ...b };
}

export function mergeBiomarkerHistory(
  a: BiomarkerLog[] = [],
  b: BiomarkerLog[] = [],
  deletedMap?: Record<string, number>
): BiomarkerLog[] {
  const merged = mergeByRecency(a, b) as BiomarkerLog[];
  if (!deletedMap || Object.keys(deletedMap).length === 0) {
    return merged;
  }
  return merged.filter(item => {
    if (!item.id) return true;
    const tombstone = deletedMap[item.id];
    if (!tombstone) return true;
    const itemTime = item.updated_at || item.date || 0;
    const t = typeof itemTime === 'number' ? itemTime : new Date(itemTime).getTime();
    return t > tombstone;
  });
}

export function mergeDeleteMaps(a: Record<string, number> = {}, b: Record<string, number> = {}): Record<string, number> {
  const res: Record<string, number> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    res[k] = Math.max(res[k] || 0, v);
  }
  return res;
}

export function supabaseRowToFoodLog(row: any, language?: string): FoodLog {
  const dateStr = row.date || new Date().toISOString().split('T')[0];
  const updatedTime = row.updated_at
    ? (typeof row.updated_at === 'number' ? row.updated_at : new Date(row.updated_at).getTime())
    : Date.now();

  const rawImageUrls = Array.isArray(row.imageUrls)
    ? row.imageUrls
    : (Array.isArray(row.image_urls)
        ? row.image_urls
        : (typeof row.image_urls === 'string' && row.image_urls.startsWith('[')
            ? (function() { try { return JSON.parse(row.image_urls); } catch(e) { return []; } })()
            : []));

  const imageUrls: string[] = rawImageUrls.length > 0
    ? rawImageUrls
    : (row.imageUrl ? [row.imageUrl] : (row.image_url ? [row.image_url] : []));

  const imageUrl = row.imageUrl || row.image_url || (imageUrls.length > 0 ? imageUrls[0] : undefined);

  let nutrients = row.nutrients;
  if (typeof nutrients === 'string') {
    try { nutrients = JSON.parse(nutrients); } catch (e) { nutrients = null; }
  }
  if (!nutrients || typeof nutrients !== 'object') {
    nutrients = {
      calories: row.calories || 0,
      protein: row.protein || 0,
      totalFat: row.fat || row.total_fat || 0,
      saturatedFat: row.saturated_fat || 0,
      unsaturatedFat: row.unsaturated_fat || 0,
      omega3: 0,
      carbohydrates: row.carbohydrates || 0,
      totalFibre: row.fibre || row.fiber || 0,
      solubleFibre: 0,
      sodium: row.sodium || 0,
      potassium: 0,
      magnesium: 0,
      calcium: 0,
      iron: 0,
      zinc: 0,
      selenium: 0,
      iodine: 0,
      phosphorus: 0,
      vitaminD: 0,
      vitaminB12: 0,
      folate: 0,
      vitaminC: 0,
      vitaminE: 0,
      vitaminK: 0,
      vitaminA: 0,
      vitaminB6: 0,
      thiamine: 0,
      riboflavin: 0,
      niacin: 0,
    };
  }

  let itemsBreakdown = row.itemsBreakdown || row.items_breakdown || [];
  if (typeof itemsBreakdown === 'string') {
    try { itemsBreakdown = JSON.parse(itemsBreakdown); } catch (e) { itemsBreakdown = []; }
  }

  let scoutItems = row.scoutItems || row.scout_items || [];
  if (typeof scoutItems === 'string') {
    try { scoutItems = JSON.parse(scoutItems); } catch (e) { scoutItems = []; }
  }

  const resolvedVerdict = resolveMealVerdict({ ...row, nutrients });
  const verdict = resolvedVerdict ? { label: resolvedVerdict.label, level: resolvedVerdict.level } : undefined;
  const dict = translations[language || 'en'] || translations.en;

  return {
    ...row,
    id: String(row.id),
    date: dateStr,
    name: row.name || row.description || 'Meal',
    composition: row.composition || '',
    weightGrams: Number(row.weightGrams ?? row.weight_grams ?? 0),
    quantity: row.quantity || dict.oneServingDefault,
    consumedAmount: Number(row.consumedAmount ?? row.consumed_amount ?? 1),
    benefits: Array.isArray(row.benefits) ? row.benefits.join(', ') : (row.benefits || ''),
    risks: Array.isArray(row.risks) ? row.risks.join(', ') : (row.risks || ''),
    healthImpact: row.healthImpact || row.health_impact || '',
    recommendation: row.recommendation || '',
    verdict,
    description: row.description || '',
    message: row.message || '',
    nutrients,
    imageUrl,
    imageUrls,
    debugUrl: row.debugUrl || row.debug_url || '',
    sourceMealId: row.sourceMealId || row.source_meal_id || undefined,
    itemsBreakdown,
    scoutItems,
    chatTranscript: Array.isArray(row.chatTranscript) ? row.chatTranscript : (Array.isArray(row.chat_transcript) ? row.chat_transcript : []),
    sync_state: 'synced',
    updated_at: updatedTime,
  };
}

export function supabaseRowToBiomarkerLog(row: any): BiomarkerLog {
  const dateStr = row.date || new Date().toISOString().split('T')[0];
  const updatedTime = row.updated_at
    ? (typeof row.updated_at === 'number' ? row.updated_at : new Date(row.updated_at).getTime())
    : Date.now();

  const biomarkers = row.biomarkers || (row.key ? { [row.key]: row.value } : {});

  return {
    id: row.id,
    date: dateStr,
    biomarkers,
    note: row.note || '',
    summary: row.summary || '',
    tests: row.tests || [],
    sync_state: 'synced',
    updated_at: updatedTime,
    ...row
  };
}

export async function fetchAllConsolidatedLogs(
  db: any,
  uid: string,
  deleteMapFoods: Record<string, number> = {},
  deleteMapBiomarkers: Record<string, number> = {},
  deleteMapCustomKeys: Record<string, number> = {},
  email?: string,
  options: { timeoutMs?: number; skipFirebaseFallback?: boolean; lastSyncTime?: number; listOnly?: boolean; pageSize?: number; offset?: number; cursor?: { updated_at?: string; id?: string } } = {}
): Promise<{
  serverFoods: FoodLog[];
  serverBiomarkers: BiomarkerLog[];
  serverProfile?: UserProfile | null;
  serverActions?: HealthAction[];
  serverBenefits?: DailyBenefit[];
  serverReport?: RecommendationReport | null;
  totalFoodsCount?: number;
  totalBiomarkersCount?: number;
}> {
  const serverFoods: FoodLog[] = [];
  const serverBiomarkers: BiomarkerLog[] = [];
  let serverProfile: UserProfile | null = null;
  let serverActions: HealthAction[] = [];
  let serverBenefits: DailyBenefit[] = [];
  let serverReport: RecommendationReport | null = null;
  let totalFoodsCount: number | undefined;
  let totalBiomarkersCount: number | undefined;

  // 1. Primary path: Server-side proxy /api/sync/supabase-pull (handles D1, SupabaseAdmin, and multiple UID aliases)
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs || 30000);
    const resp = await fetch('/api/sync/supabase-pull', {
      method: 'POST',
      headers: await pullAuthHeaders(),
      body: JSON.stringify({
        uid,
        email,
        lastSyncTime: options.lastSyncTime,
        listOnly: options.listOnly ?? false,
        pageSize: options.pageSize,
        offset: options.offset,
        cursor: options.cursor
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (resp.status === 401) {
      // Class: silent 401 hides totalFoodsCount → UI collapses to ~1–2 pages.
      // Fail loud so the next regression is visible in the console/net log.
      console.error('[syncUtils] supabase-pull 401 Unauthorized — missing/expired Firebase ID token (uid=%s)', uid);
    }

    if (resp.ok) {
      const data = await resp.json();
      if (data && data.success) {
        if (data.totalFoodsCount != null) totalFoodsCount = Number(data.totalFoodsCount);
        if (data.totalBiomarkersCount != null) totalBiomarkersCount = Number(data.totalBiomarkersCount);
        if (Array.isArray(data.foods)) {
          data.foods.forEach((r: any) => {
            if (r && r.id && !deleteMapFoods[r.id]) {
              serverFoods.push(supabaseRowToFoodLog(r));
            }
          });
        }
        if (Array.isArray(data.biomarkers)) {
          data.biomarkers.forEach((r: any) => {
            if (r && r.id && !deleteMapBiomarkers[r.id]) {
              serverBiomarkers.push(supabaseRowToBiomarkerLog(r));
            }
          });
        }
        if (data.profileData) {
          if (data.profileData.profile) {
            serverProfile = data.profileData.profile;
          } else if (data.profileData.nickname || data.profileData.email) {
            serverProfile = data.profileData;
          }
          if (Array.isArray(data.profileData.actions)) {
            serverActions = data.profileData.actions;
          }
          if (Array.isArray(data.profileData.dailyBenefits)) {
            serverBenefits = data.profileData.dailyBenefits;
          }
          if (data.profileData.report) {
            serverReport = data.profileData.report;
          }
        }
      }
    }
  } catch (err) {
    console.warn('[syncUtils] /api/sync/supabase-pull proxy fetch error:', err);
  }

  // 2. Direct client fallback if proxy returned nothing and direct client is configured
  if (serverFoods.length === 0 && serverBiomarkers.length === 0 && isSupabaseConfigured && supabase) {
    try {
      const { data: foodRows } = await supabase.from('food_logs').select('*').eq('user_id', uid);
      if (foodRows) {
        foodRows.forEach(r => {
          if (!deleteMapFoods[r.id]) {
            serverFoods.push(supabaseRowToFoodLog(r));
          }
        });
      }
      const { data: bioRows } = await supabase.from('biomarker_logs').select('*').eq('user_id', uid);
      if (bioRows) {
        bioRows.forEach(r => {
          if (!deleteMapBiomarkers[r.id]) {
            serverBiomarkers.push(supabaseRowToBiomarkerLog(r));
          }
        });
      }
    } catch (err) {
      console.warn('[syncUtils] Supabase direct client fetch error:', err);
    }
  }

  return { serverFoods, serverBiomarkers, serverProfile, serverActions, serverBenefits, serverReport, totalFoodsCount, totalBiomarkersCount };
}

export async function fetchFoodLogsPage(
  uid: string,
  page: number,
  pageSize: number = 15,
  email?: string
): Promise<{ foods: FoodLog[]; totalFoodsCount: number }> {
  const offset = Math.max(0, (page - 1) * pageSize);
  try {
    const resp = await fetch('/api/sync/supabase-pull', {
      method: 'POST',
      headers: await pullAuthHeaders(),
      body: JSON.stringify({
        uid,
        email,
        listOnly: true,
        pageSize,
        offset
      })
    });
    if (resp.ok) {
      const data = await resp.json();
      if (data && data.success && Array.isArray(data.foods)) {
        const foods = data.foods.map((r: any) => supabaseRowToFoodLog(r));
        return { foods, totalFoodsCount: data.totalFoodsCount ?? data.meta?.totalFoodsCount ?? foods.length };
      }
    }
  } catch (err) {
    console.warn('[syncUtils] fetchFoodLogsPage error:', err);
  }
  return { foods: [], totalFoodsCount: 0 };
}

export async function fetchFoodLogDetail(
  logId: string,
  uid?: string,
  email?: string
): Promise<any> {
  if (!logId) return null;
  if (isSupabaseConfigured && supabase) {
    try {
      const { data, error } = await supabase
        .from('food_logs')
        .select('*')
        .eq('id', logId)
        .single();
      if (!error && data) {
        return data;
      }
    } catch (err) {
      console.warn('[syncUtils] fetchFoodLogDetail supabase error:', err);
    }
  }
  // Try backend proxy /api/sync/food-log-detail
  try {
    const res = await fetch('/api/sync/food-log-detail', {
      method: 'POST',
      headers: await pullAuthHeaders(),
      body: JSON.stringify({ logId, uid, email })
    });
    if (res.ok) {
      const payload = await res.json();
      if (payload && payload.food) return payload.food;
    }
  } catch (err) {
    console.warn('[syncUtils] fetchFoodLogDetail proxy error:', err);
  }
  return null;
}

export async function syncLogsWithTimeBuckets(
  db: any,
  uid: string,
  localFoods: FoodLog[],
  localBiomarkers: BiomarkerLog[],
  deleteMapFoods: Record<string, number> = {},
  deleteMapBiomarkers: Record<string, number> = {},
  onSyncComplete?: (syncedFoods: FoodLog[], syncedBiomarkers: BiomarkerLog[]) => void,
  options?: { forceAllBiomarkers?: boolean; forceAllFoods?: boolean }
): Promise<void> {
  const { serverFoods, serverBiomarkers } = await fetchAllConsolidatedLogs(
    db,
    uid,
    deleteMapFoods,
    deleteMapBiomarkers
  );

  const mergedFoods = mergeByRecency(localFoods, serverFoods) as FoodLog[];
  const mergedBiomarkers = mergeByRecency(localBiomarkers, serverBiomarkers) as BiomarkerLog[];

  if (onSyncComplete) {
    onSyncComplete(mergedFoods, mergedBiomarkers);
  }
}

export function subscribeToSupabaseLogs(
  uid: string,
  onUpdate: (type: 'food' | 'biomarker', payload: any) => void
): () => void {
  if (!isSupabaseConfigured || !supabase) {
    return () => {};
  }
  try {
    const channel = supabase
      .channel(`user_logs_${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'food_logs', filter: `user_id=eq.${uid}` }, payload => {
        onUpdate('food', payload);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'biomarker_logs', filter: `user_id=eq.${uid}` }, payload => {
        onUpdate('biomarker', payload);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  } catch (err) {
    console.warn('[syncUtils] Subscription setup failed:', err);
    return () => {};
  }
}

export async function upsertProfileToSupabase(
  profile: any,
  uid?: string,
  extra?: { actions?: any[]; dailyBenefits?: any[]; report?: any; email?: string; forceOverwrite?: boolean }
): Promise<void> {
  if (!profile) return;
  const effectiveUid = uid || profile.uid || profile.firebase_uid;
  if (!effectiveUid) return;
  pushLogsToServer({
    uid: effectiveUid,
    email: extra?.email || profile.email,
    profile,
    actions: extra?.actions,
    dailyBenefits: extra?.dailyBenefits,
    report: extra?.report ?? null,
    forceOverwrite: extra?.forceOverwrite
  }).catch((err: any) => console.warn('[syncUtils] upsertProfileToSupabase push failed:', err));
}

// Firebase backup writes for food/biomarker logs removed — all food/biomarker
// persistence goes through Cloudflare D1 via /api/sync/supabase-push (D1-backed).
export async function pushLogsToServer(params: {
  uid: string;
  email?: string;
  foods?: FoodLog[];
  biomarkers?: BiomarkerLog[];
  profile?: any;
  actions?: any[];
  dailyBenefits?: any[];
  report?: any;
  forceOverwrite?: boolean;
  idToken?: string;
  deletedFoodLogIds?: Record<string, number> | string[];
  deletedBiomarkerLogIds?: Record<string, number> | string[];
}): Promise<{ success: boolean; foodCount?: number; bioCount?: number; error?: string }> {
  if (!params.uid) return { success: false, error: 'uid required' };
  try {
    // Always attach a Bearer token: prod enforces 401 without one.
    // Prefer explicit idToken (call sites that already minted one); otherwise
    // fall back to pullAuthHeaders() so profile-only pushes (upsertProfileToSupabase)
    // are not unauthenticated.
    const headers: Record<string, string> = await pullAuthHeaders();
    if (params.idToken) {
      headers['Authorization'] = `Bearer ${params.idToken}`;
    }
    const res = await fetch('/api/sync/supabase-push', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        uid: params.uid,
        email: params.email,
        foods: params.foods,
        biomarkers: params.biomarkers,
        profile: params.profile,
        actions: params.actions,
        dailyBenefits: params.dailyBenefits,
        report: params.report,
        forceOverwrite: params.forceOverwrite,
        deletedFoodLogIds: params.deletedFoodLogIds,
        deletedBiomarkerLogIds: params.deletedBiomarkerLogIds
      })
    });
    if (!res.ok) {
      let err: any = {};
      try {
        err = typeof res.json === 'function' ? await res.json() : {};
      } catch {}
      return { success: false, error: err?.error || `HTTP ${res.status} ${res.statusText || ''}`.trim() };
    }
    const data = await res.json();
    return { success: true, foodCount: data.foodCount, bioCount: data.bioCount };
  } catch (err: any) {
    return { success: false, error: err.message || String(err) };
  }
}
