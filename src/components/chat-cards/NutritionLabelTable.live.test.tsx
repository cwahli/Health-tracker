import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NutritionLabelTable } from "./NutritionLabelTable";

// Live job_1792411945320_kb0lzlvoj (Lidl chicken bites 85g, verbatim label
// strings): the Totals column showed the per-100g figure at serving scale
// (181 kcal) with a glued unit ("10gperg;gperp"). Render the item and assert
// the table shows the pack-anchored totals.
const chicken = {
  keyword: "Southern Style Chicken Bites (Lidl Select & Go)",
  originalName: "Southern Style Chicken Bites (Lidl Select & Go)",
  name: "Southern Style Chicken Bites (Lidl Select & Go)",
  genericEnglishName: "southern style chicken bites",
  chainName: "Lidl",
  estimatedWeightGrams: 85,
  nutrientBasisWeight: 85,
  sourceImageIndex: 0,
  source: "brand_official",
  dbSource: "brand_official",
  cookingMethod: "deep_fried",
  rawNutritionLabel: {
    servingSize: "per pack 85g - This pack contains 1 serving",
    calories: "181kcal (757kJ) per 100g; 154kcal (643kJ) per pack 85g",
    protein: "19.0g per 100g; 16.2g per pack 85g",
    totalFat: "10.0g per 100g; 8.5g per pack 85g",
    saturatedFat: "1.2g per 100g; 1.0g per pack 85g",
    totalCarbohydrate: "3.5g per 100g; 2.98g per pack 85g",
    sugar: "1.5g per 100g; 1.28g per pack 85g",
    salt: "1.20g per 100g; 1.02g per pack 85g",
    sodium: "not listed - derived from salt",
  },
  nutrients: {
    calories: 154, protein: 16.2, totalFat: 8.5, saturatedFat: 1,
    carbohydrates: 3, sugar: 1.3, salt: 1.02, sodium: 400,
  },
};

describe("NutritionLabelTable live render (chicken 85g)", () => {
  it('shows pack totals, not per-100g figures', () => {
    const html = renderToStaticMarkup(
      <NutritionLabelTable activeScoutItems={[chicken]} language="en" />
    );
    // Pack-anchored totals (Total column cells).
    expect(html).toContain(">154kcal<");
    expect(html).toContain(">8.5g<");
    expect(html).toContain(">1g<");
    // No per-100 figure at serving scale, no glued units.
    expect(html).not.toContain(">181kcal<");
    expect(html).not.toContain("gperg");
  });
});
