/** Machine copy of TEMPLATE.md — import this; do not fork a second field list. */

export const TEMPLATE_SLOTS = [
  { slot: "biomarkerName", dictionary: true, user: false, fill: "prefill" as const },
  { slot: "key", dictionary: true, user: false, fill: "prefill" as const },
  { slot: "alias", dictionary: true, user: false, fill: "prefill" as const },
  { slot: "normalRange", dictionary: true, user: false, fill: "prefill" as const },
  { slot: "unit", dictionary: true, user: false, fill: "prefill" as const },
  { slot: "description", dictionary: true, user: false, fill: "prefill" as const },
  { slot: "riskCategories", dictionary: true, user: false, fill: "prefill" as const },
  { slot: "notUsed", dictionary: true, user: true, fill: "flag" as const },
  { slot: "customRangePopulation", dictionary: true, user: false, fill: "prefill" as const },
  { slot: "customRangeOverlay", dictionary: false, user: true, fill: "agent" as const },
  { slot: "medicalInsight", dictionary: false, user: true, fill: "agent" as const },
  { slot: "historicalLogs", dictionary: false, user: true, fill: "intake" as const },
  { slot: "currentEvaluationStatus", dictionary: false, user: true, fill: "computed" as const },
] as const;

export type TemplateSlotId = (typeof TEMPLATE_SLOTS)[number]["slot"];

export const AGENT_WRITABLE_ON_HIT = ["medicalInsight", "customRangeOverlay"] as const;
export const AGENT_WRITABLE_ON_MISS = ["newCatalogDraft"] as const;

/**
 * Turns are automated from an output-token budget, not a user follow-up
 * and not a model “continue?”. Hits only emit insight (~140 tokens);
 * misses emit a full draft (~220). Same budget → more hits per turn.
 */
export const OUTPUT_TOKEN_BUDGET = 2800; // ~2× the budget that produced 4 C2 turns
export const HIT_OUTPUT_TOKENS = 140;
export const MISS_OUTPUT_TOKENS = 220;

export function packSize(kind: "hit" | "miss"): number {
  const per = kind === "hit" ? HIT_OUTPUT_TOKENS : MISS_OUTPUT_TOKENS;
  return Math.max(1, Math.floor(OUTPUT_TOKEN_BUDGET / per));
}

/** Fallbacks if a caller still passes an explicit size. */
export const INSIGHT_BATCH_SIZE = packSize("hit"); // 20
export const DRAFT_BATCH_SIZE = packSize("miss"); // 12
