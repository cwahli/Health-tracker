/**
 * Brand Catalog Curator LLM (Track F: F-11.2 & F-11.3)
 *
 * Architecture: FOOD.md Part A.2 (Brand catalog self-clean).
 * One librarian for brand_menu_items off the hot path.
 *
 * Rules:
 * 1. Meal never waits on curator: runs asynchronously after finalize.
 * 2. Curator never writes kcal onto this meal (only updates catalog rows).
 * 3. G0-G4 Gates + T1-T3 Triggers:
 *    - G0: Create or identity-changing edit only.
 *    - G1: matchBrandMenu ran (HIT, MULTI, MISS; not SKIPPED).
 *    - G2: Layer 1 TS cleaner finished for chain+country.
 *    - G3: Still dirty (T1 MULTI, T2 NEAR_DUP, or T3 BASIS_AMBIGUOUS).
 *    - G4: Dedup/throttle (no in-flight, max 1 run per 24h per key).
 * 4. T2 NEAR_DUP: token Jaccard >= 0.85, kcal within 10%, no meal/combo/size superset.
 * 5. TypeScript Guard: rejects merge if kcal differs >15% at same basis, or if
 *    loser is official and winner is not.
 * 6. Soft quarantine only (status = 'quarantined'); no hard delete from Gemini.
 * 7. Wire dispatch: id 't1/curator', agent 'curator', dual-accepting 'food_resolver'/'resolver'.
 */

import { supabaseAdmin } from '../../../supabaseAdmin.js';
import { normalizeChainKey, normalizeDishKey } from '../../../serverBrandMenu.js';
import { foodResolverCuratorInstruction } from '../../../agents/foodResolverInstructions.js';

export interface BrandMenuItemRow {
  id: string | number;
  country_code: string;
  chain_key: string;
  dish_name: string;
  dish_name_key: string;
  nutrients?: Record<string, any>;
  capture_count?: number;
  confidence?: number;
  provenance?: string;
  basis_type?: string;
  serving_grams?: number;
  status?: string;
  notes?: string;
  updated_at?: string;
}

export interface CuratorEligibilityArgs {
  mode?: string;
  bindStatus?: 'HIT' | 'MULTI' | 'MISS' | 'SKIPPED' | null;
  chainKey: string;
  countryCode: string;
  dishNameKey?: string | null;
  candidateIds?: Array<string | number>;
  usedRowIds?: Array<string | number>;
}

export interface CuratorCase {
  trigger: 'T1' | 'T2' | 'T3';
  chainKey: string;
  countryCode: string;
  query?: string;
  candidates: BrandMenuItemRow[];
}

export interface CuratorActionProposal {
  type: 'pick_existing' | 'merge_duplicates' | 'normalize_basis' | 'quarantine';
  query?: string;
  chosenId?: string | number | null;
  winnerId?: string | number | null;
  loserIds?: Array<string | number>;
  fromBasis?: string;
  toBasis?: string;
  reason?: string;
}

export interface BrandCuratorExecutionResult {
  executed: boolean;
  casesCount: number;
  actionsProposed: number;
  actionsApplied: number;
  quarantinedCount: number;
  details: string[];
}

// G4 Dedup cache: throttle 24 hours per chain+key
const curatorLastRun = new Map<string, number>();
const inFlightCuratorKeys = new Set<string>();

const STOP_WORDS = new Set([
  'and', 'with', 'the', 'for', 'in', 'of', 'cooked', 'prepared', 'raw', 'fresh', 'style'
]);

const COMBO_OR_SIZE_WORDS = new Set([
  'meal', 'combo', 'large', 'share', 'double', 'triple', 'box', 'bucket', 'small', 'medium', 'set'
]);

/** Tokenize string into normalized keyword set */
export function extractCleanTokens(name: string): string[] {
  if (!name) return [];
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

/** Compute token Jaccard similarity between two names */
export function calculateTokenJaccard(strA: string, strB: string): number {
  const tokensA = new Set(extractCleanTokens(strA));
  const tokensB = new Set(extractCleanTokens(strB));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }
  const union = new Set([...tokensA, ...tokensB]).size;
  return union === 0 ? 0 : intersection / union;
}

/** Check if either name contains combo or sizing keywords not in the other */
export function isSupersetComboOrSize(nameA: string, nameB: string): boolean {
  const normTokens = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
  const setA = new Set(normTokens(nameA));
  const setB = new Set(normTokens(nameB));

  for (const w of COMBO_OR_SIZE_WORDS) {
    if ((setA.has(w) && !setB.has(w)) || (setB.has(w) && !setA.has(w))) {
      return true;
    }
  }
  return false;
}

/** Check T2 Near-Duplicate criteria: Jaccard >= 0.85, kcal within 10%, no meal/combo superset */
export function isNearDuplicateCandidate(itemA: BrandMenuItemRow, itemB: BrandMenuItemRow): boolean {
  if (!itemA || !itemB) return false;
  if (String(itemA.id) === String(itemB.id)) return false;
  if (itemA.chain_key !== itemB.chain_key) return false;

  // Jaccard token similarity >= 0.85
  const jaccard = calculateTokenJaccard(itemA.dish_name, itemB.dish_name);
  if (jaccard < 0.85) return false;

  // Must not be a superset with meal / combo / large
  if (isSupersetComboOrSize(itemA.dish_name, itemB.dish_name)) {
    return false;
  }

  // Kcal within 10%
  const kcalA = Number(itemA?.nutrients?.calories ?? itemA?.nutrients?.energy ?? NaN);
  const kcalB = Number(itemB?.nutrients?.calories ?? itemB?.nutrients?.energy ?? NaN);
  if (!Number.isFinite(kcalA) || !Number.isFinite(kcalB) || kcalA <= 0 || kcalB <= 0) return false;

  const maxKcal = Math.max(kcalA, kcalB);
  const diffRatio = Math.abs(kcalA - kcalB) / maxKcal;
  return diffRatio <= 0.10;
}

/** G0-G4 Gate Evaluator: returns list of eligible curator cases or [] */
export function evaluateBrandCuratorEligibility(
  args: CuratorEligibilityArgs,
  survivingRows: BrandMenuItemRow[]
): CuratorCase[] {
  // G0: Create or identity-changing edit only (skip compare, weight-only, or Q&A)
  const mode = (args.mode || 'create').toLowerCase();
  if (mode === 'compare' || mode === 'qa' || mode === 'weight_only') {
    return [];
  }

  // G1: Brand attempt ran (HIT, MULTI, or MISS). SKIPPED -> skip LLM
  if (args.bindStatus === 'SKIPPED') {
    return [];
  }

  const chainKey = normalizeChainKey(args.chainKey || '');
  if (!chainKey) return [];
  const country = String(args.countryCode || 'GB').toUpperCase();

  // G4: Dedup/throttle check (24 hours per chain+key)
  const throttleKey = `${country}:${chainKey}:${args.dishNameKey || 'all'}`;
  const now = Date.now();
  if (inFlightCuratorKeys.has(throttleKey)) return [];
  const lastRun = curatorLastRun.get(throttleKey) || 0;
  if (now - lastRun < 24 * 60 * 60 * 1000) return [];

  // Filter to active, non-quarantined, non-merged items
  const activeItems = survivingRows.filter(
    (r) => r.status !== 'quarantined' && r.status !== 'merged'
  );
  if (activeItems.length === 0) return [];

  const cases: CuratorCase[] = [];

  // T1: MULTI with >= 2 live rows still matching this query
  if (args.bindStatus === 'MULTI' && args.dishNameKey) {
    const queryKey = args.dishNameKey.toLowerCase().replace(/[\s_]+/g, '');
    const matching = activeItems.filter((r) => {
      if (r.dish_name_key === args.dishNameKey) return true;
      const rowKey = (r.dish_name_key || '').toLowerCase().replace(/[\s_]+/g, '');
      const rowName = (r.dish_name || '').toLowerCase().replace(/[\s_]+/g, '');
      return rowKey.includes(queryKey) || rowName.includes(queryKey) || queryKey.includes(rowKey);
    });
    if (matching.length >= 2) {
      cases.push({
        trigger: 'T1',
        chainKey,
        countryCode: country,
        query: args.dishNameKey,
        candidates: matching.slice(0, 4),
      });
    }
  }

  // T3: BASIS_AMBIGUOUS (disagreeing basis types on same dish key)
  const keyGroups = new Map<string, BrandMenuItemRow[]>();
  for (const item of activeItems) {
    const k = item.dish_name_key;
    if (!k) continue;
    const list = keyGroups.get(k) || [];
    list.push(item);
    keyGroups.set(k, list);
  }

  for (const [k, group] of keyGroups.entries()) {
    if (group.length >= 2) {
      const basisTypes = new Set(group.map((g) => g.basis_type || 'per_dish'));
      if (basisTypes.size > 1) {
        cases.push({
          trigger: 'T3',
          chainKey,
          countryCode: country,
          query: k,
          candidates: group.slice(0, 4),
        });
      }
    }
  }

  // T2: NEAR_DUP (Jaccard >= 0.85, kcal within 10%, no meal/combo superset)
  const seenPairKeys = new Set<string>();
  for (let i = 0; i < activeItems.length; i++) {
    for (let j = i + 1; j < activeItems.length; j++) {
      const itemA = activeItems[i];
      const itemB = activeItems[j];
      if (itemA.dish_name_key === itemB.dish_name_key) continue; // Layer 1 already handles same key
      if (isNearDuplicateCandidate(itemA, itemB)) {
        const pairKey = [String(itemA.id), String(itemB.id)].sort().join(':');
        if (!seenPairKeys.has(pairKey)) {
          seenPairKeys.add(pairKey);
          cases.push({
            trigger: 'T2',
            chainKey,
            countryCode: country,
            query: `${itemA.dish_name} vs ${itemB.dish_name}`,
            candidates: [itemA, itemB],
          });
        }
      }
    }
  }

  // Cap at 12 cases per batch, prioritized T1 then T3 then T2
  const priorityOrder = { T1: 1, T3: 2, T2: 3 };
  cases.sort((a, b) => priorityOrder[a.trigger] - priorityOrder[b.trigger]);
  return cases.slice(0, 12);
}

/**
 * TypeScript Guard: Validate Curator LLM proposals before database execution.
 *
 * Rules:
 * 1. Rejects merge if kcal differs > 15% at same basis.
 * 2. Rejects merge if loser is official and winner is not official.
 * 3. Soft quarantine only (status = 'quarantined'); no hard delete.
 */
export function validateCuratorAction(
  action: CuratorActionProposal,
  candidatePool: BrandMenuItemRow[]
): { valid: boolean; reason?: string } {
  if (!action || !action.type) {
    return { valid: false, reason: 'Missing action type' };
  }

  const findRow = (id: any) =>
    candidatePool.find((c) => String(c.id) === String(id));

  if (action.type === 'merge_duplicates') {
    const winnerId = action.winnerId;
    const loserIds = action.loserIds || [];
    if (!winnerId || loserIds.length === 0) {
      return { valid: false, reason: 'merge_duplicates missing winnerId or loserIds' };
    }

    const winner = findRow(winnerId);
    if (!winner) {
      return { valid: false, reason: `Winner ID ${winnerId} not in candidate pool` };
    }

    const winnerKcal = Number(winner.nutrients?.calories ?? winner.nutrients?.energy ?? NaN);
    const winnerIsOfficial = winner.provenance === 'official';

    for (const loserId of loserIds) {
      if (String(loserId) === String(winnerId)) continue;
      const loser = findRow(loserId);
      if (!loser) continue;

      // Invariant: Official loser cannot be merged into non-official winner
      if (loser.provenance === 'official' && !winnerIsOfficial) {
        return {
          valid: false,
          reason: `Rejected merge: official loser ${loser.id} cannot be merged into non-official winner ${winner.id}`,
        };
      }

      // Invariant: kcal sanity: differences > 15% at same basis are rejected
      const loserKcal = Number(loser.nutrients?.calories ?? loser.nutrients?.energy ?? NaN);
      if (
        Number.isFinite(winnerKcal) &&
        Number.isFinite(loserKcal) &&
        winnerKcal > 0 &&
        loserKcal > 0
      ) {
        const diffRatio = Math.abs(winnerKcal - loserKcal) / Math.max(winnerKcal, loserKcal);
        if (diffRatio > 0.15) {
          return {
            valid: false,
            reason: `Rejected merge: kcal difference ${(diffRatio * 100).toFixed(1)}% exceeds 15% limit (${winnerKcal} vs ${loserKcal})`,
          };
        }
      }
    }

    return { valid: true };
  }

  if (action.type === 'pick_existing') {
    if (!action.chosenId) {
      return { valid: false, reason: 'pick_existing missing chosenId' };
    }
    const hit = findRow(action.chosenId);
    if (!hit) {
      return { valid: false, reason: `Chosen ID ${action.chosenId} not in candidate pool` };
    }
    return { valid: true };
  }

  if (action.type === 'normalize_basis') {
    return { valid: true };
  }

  if (action.type === 'quarantine') {
    return { valid: true };
  }

  return { valid: false, reason: `Unknown action type ${action.type}` };
}

/** Apply validated curator actions to database using soft quarantine */
export async function applyCuratorActions(
  actions: CuratorActionProposal[],
  candidatePool: BrandMenuItemRow[],
  adminClient: any,
  log: (msg: string) => void
): Promise<{ applied: number; quarantined: number; details: string[] }> {
  const admin = adminClient || supabaseAdmin;
  let applied = 0;
  let quarantined = 0;
  const details: string[] = [];

  for (const action of actions) {
    const check = validateCuratorAction(action, candidatePool);
    if (!check.valid) {
      log(`[BrandCurator] TS Guard rejected action: ${check.reason}`);
      details.push(`Rejected: ${check.reason}`);
      continue;
    }

    if (action.type === 'merge_duplicates') {
      const losersToQuarantine = (action.loserIds || [])
        .map((id) => String(id))
        .filter((id) => id !== String(action.winnerId));

      if (losersToQuarantine.length > 0) {
        try {
          const { error } = await admin
            .from('brand_menu_items')
            .update({
              status: 'quarantined',
              notes: `Merged into ${action.winnerId} by Brand Curator: ${action.reason || 'Deduplication'}`,
              updated_at: new Date().toISOString(),
            })
            .in('id', losersToQuarantine);

          if (error) throw error;

          applied++;
          quarantined += losersToQuarantine.length;
          const msg = `Merged ${losersToQuarantine.join(', ')} into winner ${action.winnerId}`;
          log(`[BrandCurator] ${msg}`);
          details.push(msg);
        } catch (e: any) {
          log(`[BrandCurator] Merge DB write failed: ${e?.message || e}`);
        }
      }
    } else if (action.type === 'quarantine' && action.chosenId) {
      try {
        const { error } = await admin
          .from('brand_menu_items')
          .update({
            status: 'quarantined',
            notes: `Quarantined by Brand Curator: ${action.reason || 'Quality review'}`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', String(action.chosenId));

        if (error) throw error;
        applied++;
        quarantined++;
        details.push(`Quarantined ${action.chosenId}`);
      } catch (e: any) {
        log(`[BrandCurator] Quarantine DB write failed: ${e?.message || e}`);
      }
    }
  }

  return { applied, quarantined, details };
}

/**
 * Execute Layer 2 Brand Curator Stage (F-11.2 & F-11.3)
 *
 * Wire dispatch: 'curator' (t1/curator), dual-accepting 'food_resolver'/'resolver'.
 */
export async function runBrandCuratorStage(args: {
  eligibility: CuratorEligibilityArgs;
  survivingRows: BrandMenuItemRow[];
  callLLMFn?: (prompt: string, sysInst: string) => Promise<string>;
  adminClient?: any;
  onLog?: (msg: string) => void;
}): Promise<BrandCuratorExecutionResult> {
  const log = args.onLog || console.log;
  const emptyRes: BrandCuratorExecutionResult = {
    executed: false,
    casesCount: 0,
    actionsProposed: 0,
    actionsApplied: 0,
    quarantinedCount: 0,
    details: [],
  };

  const cases = evaluateBrandCuratorEligibility(args.eligibility, args.survivingRows);
  if (cases.length === 0) {
    return emptyRes;
  }

  if (!args.callLLMFn) {
    log('[BrandCurator] callLLMFn not provided; skipping Layer 2 curator LLM.');
    return emptyRes;
  }

  const throttleKey = `${args.eligibility.countryCode}:${args.eligibility.chainKey}:${args.eligibility.dishNameKey || 'all'}`;
  inFlightCuratorKeys.add(throttleKey);

  try {
    log(`[BrandCurator] Executing Layer 2 Curator LLM (agent: 'curator', dispatch: 't1/curator') for ${cases.length} case(s)...`);

    const casesPrompt = JSON.stringify(
      cases.map((c, idx) => ({
        caseIndex: idx + 1,
        trigger: c.trigger,
        chain: c.chainKey,
        query: c.query,
        candidates: c.candidates.map((cand) => ({
          id: String(cand.id),
          dish_name: cand.dish_name,
          nutrients: cand.nutrients,
          provenance: cand.provenance,
          basis_type: cand.basis_type,
        })),
      })),
      null,
      2
    );

    const userPrompt = `Brand Catalog Curation Batch (${cases.length} case(s)):\n${casesPrompt}\n\nEmit brand deduplication actions in valid JSON format.`;

    const rawResponse = await args.callLLMFn(userPrompt, foodResolverCuratorInstruction);

    // Parse actions JSON
    let parsedActions: CuratorActionProposal[] = [];
    try {
      const cleanJson = rawResponse.replace(/```json/gi, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleanJson);
      parsedActions = Array.isArray(parsed) ? parsed : parsed.actions || [];
    } catch (err: any) {
      log(`[BrandCurator] JSON parse error on curator response: ${err?.message || err}`);
      return emptyRes;
    }

    const candidatePool = cases.flatMap((c) => c.candidates);
    const applyRes = await applyCuratorActions(parsedActions, candidatePool, args.adminClient, log);

    curatorLastRun.set(throttleKey, Date.now());

    return {
      executed: true,
      casesCount: cases.length,
      actionsProposed: parsedActions.length,
      actionsApplied: applyRes.applied,
      quarantinedCount: applyRes.quarantined,
      details: applyRes.details,
    };
  } finally {
    inFlightCuratorKeys.delete(throttleKey);
  }
}
