/**
 * Printed-label energy resolution.
 *
 * A printed label states energy per serving; macros cannot reproduce it. Two
 * cases the macro-derived figure gets wrong:
 *  - fibre, polyols and organic acids contribute energy that no macro carries;
 *  - alcohol carries ~7 kcal/g and appears in no macro at all.
 *
 * Live: job_1791044439374_4x4srekyi. A 440 ml bottle labelled "Energy: 54 kcal
 * per 100ml" (≈238 kcal) was logged at 88 kcal — exactly 22 g carbohydrate × 4,
 * the Atwater figure. The existing Atwater gate only guards a *lower* bound from
 * fat (server_nutrient_aggregation), so with 0 g fat it never fired.
 *
 * Pure TS, no I/O (L12: math lives here, not in the prompt).
 */

import { parseLabelCalories } from '../../server_budget_reconcile.js';
import { parseServingGramsFromLabel } from '../../server_portion_clarify.js';

/** A label/derived gap at or below this is rounding dust both checks accept.
 * Matches the ledger's trial-balance tolerance (±5 kcal, goldenLedger): a gap
 * the ledger would flag must be actionable here, or the two checks can never
 * agree. Live (Bug-3, card #3): printed 300 kcal vs derived ~286 — 13 kcal of
 * label-backed drift the old 15%-only rule let through. */
export const LABEL_ENERGY_MIN_GAP_KCAL = 5;
/** Relative floor so large meals don't churn on sub-2% macro rounding. */
export const LABEL_ENERGY_MIN_GAP_RATIO = 0.02;

export interface LabelEnergyInput {
  /** Scout-printed panel, strings allowed ("54 kcal", "783 kJ / 187 kcal"). */
  rawNutritionLabel?: any;
  /** Normalized numeric per-serving panel already carried on the item. */
  labelNutrientsPerServing?: any;
  /** Declared basis weight in grams, when the item carries one. */
  servingSizeGrams?: number | null;
  /** Weight actually consumed. */
  itemWeightGrams?: number | null;
}

export interface LabelEnergyResult {
  /** Energy for the consumed weight, or null when the label cannot be scaled. */
  kcal: number | null;
  /** Energy exactly as printed, per the label's own serving. */
  perServingKcal: number | null;
  /** Basis weight the printed energy was scaled from. */
  basisGrams: number | null;
  /** Which field supplied the energy. */
  source: 'rawNutritionLabel' | 'labelNutrientsPerServing' | null;
}

/**
 * Scale a printed energy value to the consumed weight. Returns kcal: null when
 * the label prints no energy, or when no basis weight is known — an unscaled
 * per-serving figure must never be charged to the whole item.
 */
export function resolveLabelEnergyKcal(input: LabelEnergyInput): LabelEnergyResult {
  const weight = Number(input?.itemWeightGrams) || 0;
  const raw = input?.rawNutritionLabel;
  const panel = input?.labelNutrientsPerServing;

  const rawKcal = parseLabelCalories(raw);
  const panelKcal = parseLabelCalories(panel);
  const perServingKcal = rawKcal != null && rawKcal > 0 ? rawKcal : panelKcal != null && panelKcal > 0 ? panelKcal : null;
  const source: LabelEnergyResult['source'] =
    rawKcal != null && rawKcal > 0 ? 'rawNutritionLabel' : panelKcal != null && panelKcal > 0 ? 'labelNutrientsPerServing' : null;

  if (perServingKcal == null) return { kcal: null, perServingKcal: null, basisGrams: null, source: null };

  const fromRawServing = parseServingGramsFromLabel(raw?.servingSize ?? raw?.serving);
  const declaredTop = Number(input?.servingSizeGrams);
  const declaredPanel = Number(panel?.servingSizeGrams);
  const basisGrams = fromRawServing != null && fromRawServing > 0
    ? fromRawServing
    : Number.isFinite(declaredTop) && declaredTop > 0
      ? declaredTop
      : Number.isFinite(declaredPanel) && declaredPanel > 0
        ? declaredPanel
        : null;
  if (basisGrams == null || weight <= 0) {
    return { kcal: null, perServingKcal, basisGrams: null, source };
  }

  return {
    kcal: Math.round((perServingKcal * weight) / basisGrams),
    perServingKcal,
    basisGrams,
    source,
  };
}

/**
 * Should the derived figure be replaced by the label's? True only when the label
 * is on a declared basis, the derived figure is non-zero (so a placeholder is
 * never "corrected" into existence here), and the two disagree by more than
 * BOTH the absolute floor (the ledger's ±5 kcal trial-balance tolerance — a
 * gap the ledger flags must be actionable here) and the relative floor (2%,
 * against macro-rounding churn on large meals). The caller keeps ownership of
 * an explicit `calories` lock.
 */
export function shouldPreferLabelEnergy(args: {
  derivedKcal: number | null | undefined;
  labelKcal: number | null | undefined;
  tolerance?: number;
}): boolean {
  const labelKcal = Number(args?.labelKcal);
  const derived = Number(args?.derivedKcal);
  if (!Number.isFinite(labelKcal) || labelKcal <= 0) return false;
  if (!Number.isFinite(derived) || derived <= 0) return false;
  const gap = Math.abs(derived - labelKcal);
  if (gap <= LABEL_ENERGY_MIN_GAP_KCAL) return false;
  const tolerance = args?.tolerance ?? LABEL_ENERGY_MIN_GAP_RATIO;
  return gap / labelKcal > tolerance;
}
