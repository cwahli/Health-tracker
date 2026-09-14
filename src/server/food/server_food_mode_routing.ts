/**
 * F-8.10 shard 5 — mode routing + apiCalls ledger, extracted verbatim from
 * runFoodAnalyze. Pure decisions; the caller keeps early-returns and logging
 * flows through the injected onLog callback.
 */

export interface FoodModeArgs {
  rawMode?: string;
  originalModeIsModify: boolean;
  userSelectedMode?: string;
  visionScoutItemCount?: number;
  hasActiveMealDocument: boolean;
  editCommandCount: number;
  onLog: (msg: string) => void;
}

/**
 * Resolves the response mode. Mirrors the inline order: explicit mode first,
 * single-item evaluation demotion, modify forcing, then the post-evaluation
 * edit-command override (which never applies to discussion/evaluation —
 * those return before it in the caller).
 */
export function resolveFoodAnalyzeMode(args: FoodModeArgs): string {
  const {
    rawMode,
    originalModeIsModify,
    userSelectedMode,
    visionScoutItemCount,
    hasActiveMealDocument,
    editCommandCount,
    onLog,
  } = args;
  let mode = rawMode || (originalModeIsModify ? "modify" : "new_log");
  // Mirrors the inline guard: a missing scout list never demotes evaluation.
  if (userSelectedMode !== 'compare' && (visionScoutItemCount ?? 2) <= 1 && mode === "evaluation") {
    onLog(`[Mode Override] Overriding mode from 'evaluation' to 'new_log' because only 1 item was identified.`);
    mode = "new_log";
  }
  if (originalModeIsModify && mode !== "discussion" && mode !== "evaluation") {
    mode = "modify";
  }
  if (mode !== "discussion" && mode !== "evaluation") {
    if (editCommandCount > 0) {
      mode = "modify";
    }
    if (originalModeIsModify && hasActiveMealDocument) {
      mode = "modify";
      if (editCommandCount === 0) {
        onLog(`[Single-Path] Same meal, empty modificationCommand — Q&A (card unchanged). Not a new meal.`);
      } else {
        onLog(`[Single-Path] Same meal, ${editCommandCount} edit command(s).`);
      }
    }
  }
  return mode;
}

export interface FoodApiCallsArgs {
  hasImage: boolean;
  queriesToSearch: any;
  engine: any;
}

export function buildFoodApiCalls(args: FoodApiCallsArgs): Array<{ type: string; label: string }> {
  // Second-agent LLM removed: the call list never includes it. Pure-scale and
  // single-agent creates use precalc math, not a model call.
  const { hasImage, queriesToSearch } = args;
  return [
    ...(hasImage ? [{ type: 'gemini', label: 'Food nutrition agent - Visual Scout (gemini-3.5-flash-lite)' }] : []),
    ...(queriesToSearch && queriesToSearch.length > 0 ? [{ type: 'usda', label: `Food nutrition agent - USDA (${queriesToSearch.length})` }] : []),
  ];
}

export interface PostDietNormArgs {
  rawParsed: any;
  isExplicitModify: boolean;
  userSelectedMode?: string;
  visionScoutItems: any;
}

/**
 * F-8.10 shard 18 — post-diet response normalization, extracted
 * verbatim from runFoodAnalyze. Mutates rawParsed in place (mode fixups,
 * comparison breakdown backfill).
 */
export function normalizeParsedPostDiet(args: PostDietNormArgs): void {
  const { rawParsed, isExplicitModify, userSelectedMode, visionScoutItems } = args;
  if (rawParsed && typeof rawParsed === 'object') {
    if (isExplicitModify) {
      rawParsed.mode = 'modify';
    }
    if (userSelectedMode === 'review') {
      if (!rawParsed.mode || rawParsed.mode !== 'modify') rawParsed.mode = isExplicitModify ? 'modify' : 'new_log';
      rawParsed.comparison = null; // Guaranteed 100% clean review card rendering
    } else if (userSelectedMode === 'compare') {
      rawParsed.mode = 'evaluation';
      const existingFd = rawParsed.foodData && typeof rawParsed.foodData === 'object' ? rawParsed.foodData : {};
      const breakdown = Array.isArray(existingFd.itemsBreakdown) && existingFd.itemsBreakdown.length
        ? existingFd.itemsBreakdown
        : (visionScoutItems || []).map((s: any, idx: number) => ({
            name: s.originalName || s.keyword || `item ${idx + 1}`,
            originalName: s.originalName || s.keyword,
            weightGrams: s.estimatedWeightGrams,
            scoutIndex: s.scoutIndex ?? idx,
          }));
      rawParsed.foodData = { ...existingFd, itemsBreakdown: breakdown };
    }
  }
}

export type PostProjectorNormArgs = PostDietNormArgs;
export const normalizeParsedPostProjector = normalizeParsedPostDiet;

