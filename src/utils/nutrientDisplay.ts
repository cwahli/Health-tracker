/**
 * Pure display math for nutrient values (card #2 class: float dust in
 * Home targets). Extracted verbatim from HomeTab.tsx so the rounding
 * semantics have a deterministic sensor — see nutrientDisplay.test.ts.
 *
 * Original inline semantics (kept):
 *   formatValue:    3-decimal pre-clean, then ceil to 1 decimal (integer
 *                   result once the value reaches 10).
 *   weeklyTarget:   round(daily * 7) to 1 decimal.
 *
 * Fix (BUG-20260921-8449 / card #2): sub-1e-9 float dust on an exact tenth
 * boundary (7.700000000000001) must not ceil/round to the next tenth.
 */

const DISPLAY_EPSILON = 1e-9;

/** Round to 1 decimal, immune to sub-1e-9 float dust (7.700000000000001 → 7.7). */
export function roundValue1Dec(val: number): number {
  return Math.round(val * 10) / 10;
}

/**
 * Display value: 3-decimal pre-clean, then ceil to 1 decimal; integers from
 * 10 up stay integers. 7.700000000000001 → 7.7 (not 7.8).
 */
export function ceilDisplayValue(val: number): number {
  const clean = Math.round(val * 1000) / 1000;
  if (clean >= 10) return Math.ceil(clean - DISPLAY_EPSILON);
  return Math.ceil(clean * 10 - DISPLAY_EPSILON) / 10;
}

/** Weekly target from a daily target: (daily * 7) rounded to 1 decimal. */
export function weeklyTargetFromDaily(baseDailyTarget: number): number {
  return roundValue1Dec(baseDailyTarget * 7);
}
