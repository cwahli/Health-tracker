/**
 * narration.ts - F-10.4 Ledger Narration for Adaptive Meal Agent
 *
 * Invariant Laws:
 * - Saved message numbers must derive strictly from the finalized ledger table.
 * - Substitute into draft message if present; generate concise clinical summary if empty.
 * - Never narrate from pre-finalize estimates or dispatch a second LLM purely for narration when draft exists.
 */

import { t, interpolate } from '../utils/i18n';

export interface FinalizeLedgerSummary {
  mealName: string;
  weightGrams: number;
  calories: number;
  protein: number;
  carbohydrates: number;
  totalFat: number;
  saturatedFat?: number;
  addedSugar?: number;
  sugar?: number;
  sodium?: number;
  salt?: number;
  items?: Array<{
    name: string;
    weightGrams: number;
    calories: number;
    protein?: number;
    carbohydrates?: number;
    totalFat?: number;
  }>;
}

export function formatLedgerDefaultMessage(summary: FinalizeLedgerSummary, lang?: unknown): string {
  const name = summary.mealName || 'Meal';
  const wt = summary.weightGrams ? `${summary.weightGrams}g` : '';
  const cal = `${summary.calories} kcal`;
  const macros = interpolate(t(lang, 'ledgerMacros'), {
    p: summary.protein,
    c: summary.carbohydrates,
    f: summary.totalFat,
  });
  const paren = [wt, cal, macros].filter(Boolean).join(', ');
  return interpolate(t(lang, 'ledgerLoggedMeal'), { name, paren });
}

export function reconcileMessageWithLedger(
  draftMessage: string | null | undefined,
  summary: FinalizeLedgerSummary,
  lang?: unknown
): string {
  if (!draftMessage || !draftMessage.trim()) {
    return formatLedgerDefaultMessage(summary, lang);
  }
  let msg = draftMessage.trim();

  // 1. Reconcile cited meal-level total protein (e.g. "You got 72.7g of quality protein" -> "You got 69.7g of quality protein")
  if (summary.protein !== undefined && summary.protein !== null) {
    const formattedP = Math.round(summary.protein * 10) / 10;
    msg = msg.replace(/\b(\d+(?:\.\d+)?)\s*g(\s+(?:of\s+)?(?:quality\s+|lean\s+|total\s+)?protein)\b/gi, (match, num, suffix) => {
      const cited = parseFloat(num);
      if (Math.abs(cited - formattedP) > 0.1 && cited > 20) {
        return `${formattedP}g${suffix}`;
      }
      return match;
    });
  }

  // 2. Reconcile cited added sugar (e.g. "contribute 80g of added sugar" -> "contribute 34g of added sugar")
  if (summary.addedSugar !== undefined && summary.addedSugar !== null) {
    const formattedAddedSugar = Math.round(summary.addedSugar * 10) / 10;
    msg = msg.replace(/\b(\d+(?:\.\d+)?)\s*g(\s+(?:of\s+)?(?:added\s+sugar|added\s+sugars))\b/gi, (match, num, suffix) => {
      const cited = parseFloat(num);
      if (Math.abs(cited - formattedAddedSugar) > 0.1) {
        return `${formattedAddedSugar}g${suffix}`;
      }
      return match;
    });
  }

  // 3. Reconcile cited total calories if referenced as total meal calories
  if (summary.calories !== undefined && summary.calories !== null) {
    const formattedCal = Math.round(summary.calories);
    msg = msg.replace(/\b(\d{3,4})\s*kcal(\s+(?:total|in\s+this\s+meal))\b/gi, (match, num, suffix) => {
      const cited = parseInt(num, 10);
      if (Math.abs(cited - formattedCal) > 5) {
        return `${formattedCal} kcal${suffix}`;
      }
      return match;
    });
  }

  return msg;
}
