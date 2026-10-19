import { describe, it, expect } from "vitest";
import { extractPer100Figure, isPer100ServingBasis } from "./NutritionLabelTable";

// Live job_1792411945320 (chicken 85g pack): the Totals column showed the
// per-100g figure at serving scale (181 kcal) with a glued unit
// ("10gperg;gperp") because first-number parsing mixed with the serving
// basis. These pin the dual-column contract the component relies on.

describe("NutritionLabelTable dual-column labels", () => {
  it('extracts the per-100 figure from dual-column strings', () => {
    expect(extractPer100Figure("10.0g per 100g; 8.5g per pack 85g")).toEqual({ value: 10, unit: 'g' });
    expect(extractPer100Figure("1.0g per 100g; 1.0g per pack 85g")).toEqual({ value: 1, unit: 'g' });
    expect(extractPer100Figure("135 kcal")).toBeNull();
    expect(extractPer100Figure("17.4g")).toBeNull();
  });

  it('reads the per-100 column through parenthetical kJ equivalents', () => {
    // Chicken label: "181kcal (757kJ) per 100g; 154kcal (643kJ) per pack 85g".
    expect(extractPer100Figure("181kcal (757kJ) per 100g; 154kcal (643kJ) per pack 85g")).toEqual({ value: 181, unit: 'kcal' });
  });

  it('does not mistake the per-serving figure for the per-100 figure (kJ-first energy)', () => {
    // "570kJ/135kcal per 100g": the 570 must not match (it is not followed by 100).
    expect(extractPer100Figure("570kJ/135kcal per 100g**, 935kJ/221kcal per half pack approx. 164g**")).toEqual({ value: 135, unit: 'kcal' });
  });

  it('detects per-100 serving bases so they keep the existing path', () => {
    expect(isPer100ServingBasis("100g")).toBe(true);
    expect(isPer100ServingBasis("per 100g")).toBe(true);
    expect(isPer100ServingBasis("per pack 85g - This pack contains 1 serving")).toBe(false);
    expect(isPer100ServingBasis("Per portion (25g) - This pack contains approx. 4 portions")).toBe(false);
    expect(isPer100ServingBasis("")).toBe(false);
  });
});
