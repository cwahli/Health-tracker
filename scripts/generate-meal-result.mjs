#!/usr/bin/env node
/**
 * scripts/generate-meal-result.mjs
 *
 * Audit-Grade Meal Result Document & Benchmark Generator for Health-tracker.
 * Supports both:
 *  1. Single-Turn Standalone Meal Audits (human/agent photos -> ground truth)
 *  2. Multi-Turn Meal Flow Reviews (initial upload -> photo edits -> text edits)
 *
 * Output Bundle: Meal-[meal name]-[number]/
 *  ├── meal_result.json        (Canonical typed 31-nutrient ledger with multi-turn passes)
 *  ├── meal_result.md          (Executive audit report with turn evolution and nutrient tables)
 *  ├── Instruction.md          (Multi-turn replay instructions for QA runners)
 *  ├── expected.json           (Golden benchmark contract compatible with Meal_04_log)
 *  ├── meal_annotated_turn*.svg(Visual bounding box overlay maps per turn)
 *  └── photos/                 (Local copies of all evidence photos)
 *
 * Usage:
 *   node scripts/generate-meal-result.mjs --input="payload.json" [--bundle-name="Meal-Salmon-Bowl-01"]
 *   cat payload.json | node scripts/generate-meal-result.mjs --stdin
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================================
// 1. CANONICAL 31 NUTRIENT DEFINITIONS & UNITS
// ============================================================================

export const NUTRIENT_METADATA = {
  // Core Energy & Macronutrients (8)
  calories:       { label: 'Calories',          unit: 'kcal', group: 'core',       dailyRef: 2000, isLimit: true },
  protein:        { label: 'Protein',           unit: 'g',    group: 'core',       dailyRef: 75,   isLimit: false },
  carbohydrates:  { label: 'Carbohydrates',     unit: 'g',    group: 'core',       dailyRef: 225,  isLimit: false },
  totalFat:       { label: 'Total Fat',         unit: 'g',    group: 'core',       dailyRef: 65,   isLimit: true },
  saturatedFat:   { label: 'Saturated Fat',     unit: 'g',    group: 'core',       dailyRef: 20,   isLimit: true },
  transFat:       { label: 'Trans Fat',         unit: 'g',    group: 'core',       dailyRef: 1,    isLimit: true },
  unsaturatedFat: { label: 'Unsaturated Fat',   unit: 'g',    group: 'core',       dailyRef: 45,   isLimit: false },
  omega3:         { label: 'Omega-3',           unit: 'g',    group: 'core',       dailyRef: 1.6,  isLimit: false },

  // Carbohydrate Fractions & Fibre (4)
  sugar:          { label: 'Total Sugar',       unit: 'g',    group: 'carb_frac',  dailyRef: 50,   isLimit: true },
  addedSugar:     { label: 'Added Sugar',       unit: 'g',    group: 'carb_frac',  dailyRef: 25,   isLimit: true },
  totalFibre:     { label: 'Total Fibre',       unit: 'g',    group: 'carb_frac',  dailyRef: 30,   isLimit: false },
  solubleFibre:   { label: 'Soluble Fibre',     unit: 'g',    group: 'carb_frac',  dailyRef: 8,    isLimit: false },

  // Minerals & Electrolytes (9)
  sodium:         { label: 'Sodium',            unit: 'mg',   group: 'minerals',   dailyRef: 2000, isLimit: true },
  potassium:      { label: 'Potassium',         unit: 'mg',   group: 'minerals',   dailyRef: 3500, isLimit: false },
  magnesium:      { label: 'Magnesium',         unit: 'mg',   group: 'minerals',   dailyRef: 400,  isLimit: false },
  calcium:        { label: 'Calcium',           unit: 'mg',   group: 'minerals',   dailyRef: 1000, isLimit: false },
  iron:           { label: 'Iron',              unit: 'mg',   group: 'minerals',   dailyRef: 14,   isLimit: false },
  zinc:           { label: 'Zinc',              unit: 'mg',   group: 'minerals',   dailyRef: 11,   isLimit: false },
  selenium:       { label: 'Selenium',          unit: 'mcg',  group: 'minerals',   dailyRef: 55,   isLimit: false },
  iodine:         { label: 'Iodine',            unit: 'mcg',  group: 'minerals',   dailyRef: 150,  isLimit: false },
  phosphorus:     { label: 'Phosphorus',        unit: 'mg',   group: 'minerals',   dailyRef: 700,  isLimit: false },

  // Vitamins & Micronutrients (11)
  vitaminD:       { label: 'Vitamin D',         unit: 'IU',   group: 'vitamins',   dailyRef: 600,  isLimit: false },
  vitaminB12:     { label: 'Vitamin B12',       unit: 'mcg',  group: 'vitamins',   dailyRef: 2.4,  isLimit: false },
  folate:         { label: 'Folate (B9)',       unit: 'mcg',  group: 'vitamins',   dailyRef: 400,  isLimit: false },
  vitaminC:       { label: 'Vitamin C',         unit: 'mg',   group: 'vitamins',   dailyRef: 80,   isLimit: false },
  vitaminE:       { label: 'Vitamin E',         unit: 'mg',   group: 'vitamins',   dailyRef: 15,   isLimit: false },
  vitaminK:       { label: 'Vitamin K',         unit: 'mcg',  group: 'vitamins',   dailyRef: 90,   isLimit: false },
  vitaminA:       { label: 'Vitamin A',         unit: 'mcg',  group: 'vitamins',   dailyRef: 800,  isLimit: false },
  vitaminB6:      { label: 'Vitamin B6',        unit: 'mg',   group: 'vitamins',   dailyRef: 1.4,  isLimit: false },
  thiamine:       { label: 'Thiamine (B1)',     unit: 'mg',   group: 'vitamins',   dailyRef: 1.1,  isLimit: false },
  riboflavin:     { label: 'Riboflavin (B2)',   unit: 'mg',   group: 'vitamins',   dailyRef: 1.4,  isLimit: false },
  niacin:         { label: 'Niacin (B3)',       unit: 'mg',   group: 'vitamins',   dailyRef: 16,   isLimit: false },
};

export const NUTRIENT_KEYS = Object.keys(NUTRIENT_METADATA);

// ============================================================================
// 2. HELPER FUNCTIONS: NORMALIZATION, BUNDLE NAMING, ENERGY CHECK
// ============================================================================

function round(val, decimals = 1) {
  if (val === null || val === undefined || isNaN(Number(val))) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round(Number(val) * factor) / factor;
}

function sanitizeBundleName(title, number = 1) {
  const base = String(title || 'Meal')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const numPadded = String(number).padStart(2, '0');
  return `Meal-${base}-${numPadded}`;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    input: null,
    outputDir: null,
    bundleName: null,
    stdin: false,
    annotateImage: true,
  };

  for (const arg of args) {
    if (arg.startsWith('--input=')) {
      options.input = arg.slice('--input='.length).trim();
    } else if (arg.startsWith('--output-dir=')) {
      options.outputDir = arg.slice('--output-dir='.length).trim();
    } else if (arg.startsWith('--bundle-name=')) {
      options.bundleName = arg.slice('--bundle-name='.length).trim();
    } else if (arg === '--stdin') {
      options.stdin = true;
    } else if (arg === '--no-annotate-image') {
      options.annotateImage = false;
    }
  }

  return options;
}

function normalizeDishesArray(dishesRaw) {
  if (!Array.isArray(dishesRaw)) return [];

  return dishesRaw.map((d, idx) => {
    const dishIndex = typeof d.dishIndex === 'number' ? d.dishIndex : idx + 1;
    const dishName = d.dishName || `Dish ${dishIndex}`;
    const genericEnglishName = d.genericEnglishName || dishName;
    const estimatedWeightGrams = Number(d.estimatedWeightGrams) || 0;
    const cookingMethod = d.cookingMethod || 'standard';
    const sourceImageIndex = typeof d.sourceImageIndex === 'number' ? d.sourceImageIndex : 0;

    let box = [0, 0, 1000, 1000];
    if (Array.isArray(d.boundingBox2D) && d.boundingBox2D.length === 4) {
      box = d.boundingBox2D.map(n => Math.max(0, Math.min(1000, Math.round(Number(n) || 0))));
    }

    const foods = Array.isArray(d.foods) ? d.foods.map(f => {
      if (typeof f === 'string') {
        return { name: f, estimatedWeightGrams: 0, ingredients: [] };
      }
      return {
        name: f.name || 'Ingredient',
        estimatedWeightGrams: Number(f.estimatedWeightGrams) || 0,
        cookingMethod: f.cookingMethod || cookingMethod,
        ingredients: Array.isArray(f.ingredients) ? f.ingredients : [],
      };
    }) : [];

    const rawNuts = d.dishNutrients || d.nutrients || {};
    const dishNutrients = {};
    for (const key of NUTRIENT_KEYS) {
      const v = rawNuts[key];
      dishNutrients[key] = (v !== undefined && v !== null && !isNaN(Number(v))) ? round(v, key === 'omega3' || key === 'vitaminB12' ? 2 : 1) : 0;
    }

    return {
      dishIndex,
      dishName,
      genericEnglishName,
      sourceImageIndex,
      boundingBox2D: box,
      estimatedWeightGrams,
      cookingMethod,
      foods,
      dishNutrients,
    };
  });
}

function calculatePassNutrients(dishes) {
  const mealTotals = {};
  for (const key of NUTRIENT_KEYS) {
    let sum = 0;
    for (const dish of dishes) {
      sum += Number(dish.dishNutrients[key]) || 0;
    }
    mealTotals[key] = round(sum, key === 'omega3' || key === 'vitaminB12' ? 2 : 1);
  }
  mealTotals.salt = round((mealTotals.sodium * 2.54) / 1000, 2);

  const totalWeightGrams = round(dishes.reduce((acc, d) => acc + (d.estimatedWeightGrams || 0), 0), 0);

  const declaredKcal = mealTotals.calories || 0;
  const atwaterKcal = round((4 * mealTotals.protein) + (4 * mealTotals.carbohydrates) + (9 * mealTotals.totalFat), 0);
  const diffKcal = round(declaredKcal - atwaterKcal, 0);
  const diffPercent = declaredKcal > 0 ? round((Math.abs(diffKcal) / declaredKcal) * 100, 1) : 0;

  const energyVerification = {
    declaredCalories: declaredKcal,
    atwaterCalories: atwaterKcal,
    differenceKcal: diffKcal,
    differencePercent: diffPercent,
    isBalanced: diffPercent <= 10.0,
    formula: `4 * ${mealTotals.protein}g(P) + 4 * ${mealTotals.carbohydrates}g(C) + 9 * ${mealTotals.totalFat}g(F) = ${atwaterKcal} kcal`
  };

  const metrics = {
    potassiumSodiumRatio: mealTotals.sodium > 0 ? round(mealTotals.potassium / mealTotals.sodium, 2) : 0,
    addedSugarKcalPercent: declaredKcal > 0 ? round(((mealTotals.addedSugar * 4) / declaredKcal) * 100, 1) : 0,
    satFatKcalPercent: declaredKcal > 0 ? round(((mealTotals.saturatedFat * 9) / declaredKcal) * 100, 1) : 0,
    fibrePer1000Kcal: declaredKcal > 0 ? round((mealTotals.totalFibre / declaredKcal) * 1000, 1) : 0,
  };

  return { totalWeightGrams, mealTotals, energyVerification, metrics };
}

export function validateAndNormalizePayload(raw, explicitBundleName = null) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid payload: must be a JSON object.');
  }

  const mealId = raw.mealId || `MEAL-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
  const timestamp = raw.timestamp || new Date().toISOString();
  const title = raw.title || raw.mealName || 'Audited Meal';
  const bundleName = explicitBundleName || raw.bundleName || sanitizeBundleName(title);

  // Normalize passes
  let normalizedPasses = [];

  if (Array.isArray(raw.passes) && raw.passes.length > 0) {
    // Multi-turn mode
    let cumulativePhotos = [];
    normalizedPasses = raw.passes.map((p, idx) => {
      const turnIndex = typeof p.turnIndex === 'number' ? p.turnIndex : idx + 1;
      const turnId = p.turnId || (idx === 0 ? 'turn_1_initial' : `turn_${turnIndex}_edit`);
      const userPrompt = String(p.userPrompt || p.prompt || '');
      const addedPhotos = Array.isArray(p.addedPhotos) ? p.addedPhotos : (Array.isArray(p.photos) ? p.photos : []);
      cumulativePhotos = Array.from(new Set([...cumulativePhotos, ...addedPhotos]));

      const dishes = normalizeDishesArray(p.dishes || []);
      const { totalWeightGrams, mealTotals, energyVerification, metrics } = calculatePassNutrients(dishes);

      return {
        turnIndex,
        turnId,
        userPrompt,
        addedPhotos,
        cumulativePhotos: [...cumulativePhotos],
        totalWeightGrams,
        dishes,
        mealTotals,
        energyVerification,
        metrics,
        observations: Array.isArray(p.observations) ? p.observations : [],
      };
    });
  } else {
    // Single-turn mode
    const photos = Array.isArray(raw.photos) ? raw.photos : (raw.photo ? [raw.photo] : []);
    const dishes = normalizeDishesArray(raw.dishes || []);
    if (dishes.length === 0) {
      throw new Error('Invalid payload: "dishes" array is required and must contain at least one dish.');
    }
    const { totalWeightGrams, mealTotals, energyVerification, metrics } = calculatePassNutrients(dishes);

    normalizedPasses = [{
      turnIndex: 1,
      turnId: 'turn_1_initial',
      userPrompt: String(raw.userPrompt || raw.prompt || ''),
      addedPhotos: photos,
      cumulativePhotos: photos,
      totalWeightGrams,
      dishes,
      mealTotals,
      energyVerification,
      metrics,
      observations: Array.isArray(raw.observations) ? raw.observations : (raw.clinicalSummary?.observations || []),
    }];
  }

  // Final Pass is the current ground truth state
  const lastPass = normalizedPasses[normalizedPasses.length - 1];

  return {
    schemaVersion: '2.0.0',
    bundleName,
    mealId,
    timestamp,
    title,
    mode: normalizedPasses.length > 1 ? 'multi_turn_flow' : 'single_audit',
    totalTurns: normalizedPasses.length,
    finalWeightGrams: lastPass.totalWeightGrams,
    finalTotals: lastPass.mealTotals,
    passes: normalizedPasses,
    clinicalObservations: lastPass.observations,
  };
}

// ============================================================================
// 3. MARKDOWN DOCUMENT BUILDER (MULTI-TURN AWARE)
// ============================================================================

export function buildMealResultMarkdown(audit) {
  const { bundleName, mealId, timestamp, title, mode, totalTurns, finalWeightGrams, finalTotals, passes } = audit;

  const lines = [];

  lines.push(`# 🍽️ Meal Audit Benchmark: ${title}`);
  lines.push(`**Bundle:** \`${bundleName}\`  |  **Meal ID:** \`${mealId}\`  |  **Audited At:** ${timestamp}`);
  lines.push(`**Mode:** \`${mode}\` (${totalTurns} turn${totalTurns > 1 ? 's' : ''})  |  **Final Weight:** ${finalWeightGrams} g  |  **Final Calories:** ${finalTotals.calories} kcal`);
  lines.push('');

  // Multi-Turn Flow Summary Banner
  if (mode === 'multi_turn_flow') {
    lines.push('## Multi-Turn Flow Overview');
    lines.push('| Turn # | Step Name | User Instruction | Added Photos | Final Dishes | Calories | Weight | Energy Verified? |');
    lines.push('|---|---|---|---|---|---|---|---|');
    passes.forEach(p => {
      const photosStr = p.addedPhotos.length > 0 ? p.addedPhotos.map(ph => `\`${ph}\``).join(', ') : '*None*';
      const promptStr = p.userPrompt ? `"${p.userPrompt}"` : '*[Initial upload]*';
      const evIcon = p.energyVerification.isBalanced ? '✅ Yes' : '⚠️ Imbalance';
      lines.push(`| **Turn ${p.turnIndex}** | \`${p.turnId}\` | ${promptStr} | ${photosStr} | ${p.dishes.length} dishes | **${p.mealTotals.calories} kcal** | ${p.totalWeightGrams}g | ${evIcon} |`);
    });
    lines.push('');
  }

  // Iterate each turn/pass
  passes.forEach(pass => {
    const isMulti = passes.length > 1;
    const turnPrefix = isMulti ? `Turn ${pass.turnIndex}: ` : '';

    lines.push(`## ${turnPrefix}${pass.turnIndex === 1 ? 'Initial Meal Analysis' : `Pass ${pass.turnIndex} (${pass.turnId})`}`);
    if (pass.userPrompt) {
      lines.push(`> 💬 **User Instruction:** "${pass.userPrompt}"`);
    }
    if (pass.addedPhotos.length > 0) {
      lines.push(`> 📸 **Photos for this turn:** ${pass.addedPhotos.map(ph => `\`${ph}\``).join(', ')}`);
    }

    // Energy Banner
    const ev = pass.energyVerification;
    if (ev.isBalanced) {
      lines.push(`> [!NOTE] Energy Balance Verified\n> Declared **${ev.declaredCalories} kcal** matches Atwater macronutrient sum (**${ev.atwaterCalories} kcal**, Δ ${ev.differencePercent}%). Formula: ${ev.formula}.`);
    } else {
      lines.push(`> [!WARNING] Energy Imbalance Detected\n> Declared **${ev.declaredCalories} kcal** diverges by **${ev.differencePercent}%** from macronutrient energy sum (**${ev.atwaterCalories} kcal**). Inspect cooking oils or hidden sauces.`);
    }
    lines.push('');

    // Dishes Table
    lines.push(`### ${turnPrefix}Dishes & Bounding Boxes`);
    lines.push('| # | Dish Name | Generic / English Name | Weight | Cooking Method | Bounding Box [ymin, xmin, ymax, xmax] |');
    lines.push('|---|---|---|---|---|---|');
    pass.dishes.forEach(d => {
      const boxStr = `\`[${d.boundingBox2D.join(', ')}]\``;
      lines.push(`| **${d.dishIndex}** | **${d.dishName}** | ${d.genericEnglishName} | ${d.estimatedWeightGrams} g | ${d.cookingMethod} | ${boxStr} |`);
    });
    lines.push('');

    // Ingredients list
    lines.push(`### ${turnPrefix}Ingredients Breakdown`);
    pass.dishes.forEach(d => {
      lines.push(`- **Dish ${d.dishIndex}: ${d.dishName}** (${d.estimatedWeightGrams} g, \`${d.cookingMethod}\`)`);
      if (d.foods && d.foods.length > 0) {
        d.foods.forEach(f => {
          const wtStr = f.estimatedWeightGrams > 0 ? ` (~${f.estimatedWeightGrams}g)` : '';
          const ingStr = f.ingredients && f.ingredients.length > 0 ? ` (Ingredients: ${f.ingredients.join(', ')})` : '';
          lines.push(`  • ${f.name}${wtStr}${ingStr}`);
        });
      } else {
        lines.push('  • Whole portion (no sub-components extracted)');
      }
    });
    lines.push('');

    // 31-Nutrient Table
    lines.push(`### ${turnPrefix}31-Nutrient Audit Ledger`);
    const headerCols = ['Nutrient', 'Unit'];
    pass.dishes.forEach(d => headerCols.push(`D${d.dishIndex}: ${d.dishName.slice(0, 14)}`));
    headerCols.push('Whole-Meal Total', 'Daily Ref %');

    lines.push('| ' + headerCols.join(' | ') + ' |');
    lines.push('| ' + headerCols.map(() => '---').join(' | ') + ' |');

    const groups = [
      { title: 'Core Macronutrients & Energy', groupKey: 'core' },
      { title: 'Carbohydrate Fractions & Fibre', groupKey: 'carb_frac' },
      { title: 'Electrolytes & Minerals', groupKey: 'minerals' },
      { title: 'Vitamins & Micronutrients', groupKey: 'vitamins' },
    ];

    for (const grp of groups) {
      lines.push(`| **--- ${grp.title} ---** | | ${pass.dishes.map(() => '').join(' | ')} | | |`);
      const groupNutrients = NUTRIENT_KEYS.filter(k => NUTRIENT_METADATA[k].group === grp.groupKey);

      for (const key of groupNutrients) {
        const meta = NUTRIENT_METADATA[key];
        const totalVal = pass.mealTotals[key] || 0;
        const refPct = meta.dailyRef ? round((totalVal / meta.dailyRef) * 100, 0) : '--';
        const refStr = typeof refPct === 'number' ? `${refPct}%` : refPct;

        const row = [
          meta.isLimit ? `⚠️ **${meta.label}**` : meta.label,
          meta.unit
        ];

        pass.dishes.forEach(d => {
          row.push(d.dishNutrients[key] !== undefined ? `${d.dishNutrients[key]}` : '0');
        });

        row.push(`**${totalVal}**`);
        row.push(`${refStr}`);

        lines.push('| ' + row.join(' | ') + ' |');
      }
    }

    // Salt derived
    lines.push(`| Salt (Derived: Na × 2.54) | g | ${pass.dishes.map(d => round((d.dishNutrients.sodium * 2.54) / 1000, 2)).join(' | ')} | **${pass.mealTotals.salt}** | ${round((pass.mealTotals.salt / 5) * 100, 0)}% |`);
    lines.push('');

    // Clinical metrics
    const cm = pass.metrics;
    lines.push(`- **Potassium-to-Sodium (K/Na) Ratio:** \`${cm.potassiumSodiumRatio}\` ${cm.potassiumSodiumRatio >= 1.0 ? '✅ (Optimal ≥ 1.0)' : '⚠️ (High sodium relative to potassium < 1.0)'}`);
    lines.push(`- **Added Sugar Energy:** \`${cm.addedSugarKcalPercent}%\` ${cm.addedSugarKcalPercent <= 10.0 ? '✅ (≤ 10%)' : '⚠️ (> 10%)'}`);
    lines.push(`- **Saturated Fat Energy:** \`${cm.satFatKcalPercent}%\` ${cm.satFatKcalPercent <= 10.0 ? '✅ (≤ 10%)' : '⚠️ (> 10%)'}`);
    lines.push(`- **Fibre Density:** \`${cm.fibrePer1000Kcal} g / 1000 kcal\` ${cm.fibrePer1000Kcal >= 14.0 ? '✅ (≥ 14g)' : '⚠️ (< 14g)'}`);
    lines.push('');
  });

  // Observations
  if (audit.clinicalObservations && audit.clinicalObservations.length > 0) {
    lines.push('## Clinical Observations');
    audit.clinicalObservations.forEach(obs => lines.push(`- ${obs}`));
    lines.push('');
  }

  lines.push('---');
  lines.push(`*Generated by Health-tracker Meal Audit Engine v2.0.0 — Canonical 31-Nutrient Benchmark.*`);

  return lines.join('\n');
}

// ============================================================================
// 4. BENCHMARK CONTRACTS (expected.json & Instruction.md)
// ============================================================================

export function buildInstructionMarkdown(audit) {
  const { title, passes, bundleName } = audit;
  const lines = [];

  lines.push(`# Multi-Turn Meal Replay Instruction: ${title}`);
  lines.push(`**Benchmark Bundle:** \`${bundleName}\`  |  **Total Passes:** ${passes.length}`);
  lines.push('');

  passes.forEach((p, idx) => {
    lines.push(`### Pass ${idx + 1}: ${p.turnId}`);
    if (p.userPrompt) {
      lines.push(`- **User Prompt:** "${p.userPrompt}"`);
    } else {
      lines.push(`- **User Prompt:** *None (Initial photo intake)*`);
    }
    if (p.addedPhotos.length > 0) {
      lines.push(`- **Photos Input:** ${p.addedPhotos.map(ph => `\`photos/${path.basename(ph)}\``).join(', ')}`);
    } else {
      lines.push(`- **Photos Input:** *None (Text-only edit turn)*`);
    }
    lines.push(`- **Expected Dishes:** ${p.dishes.map(d => `${d.dishName} (~${d.estimatedWeightGrams}g)`).join(', ')}`);
    lines.push(`- **Expected Macros:** Calories: ${p.mealTotals.calories} kcal, Protein: ${p.mealTotals.protein}g, Carbs: ${p.mealTotals.carbohydrates}g, Fat: ${p.mealTotals.totalFat}g`);
    lines.push('');
  });

  return lines.join('\n');
}

export function buildExpectedBenchmarkJson(audit) {
  const { bundleName, title, passes } = audit;
  const lastPass = passes[passes.length - 1];

  return {
    id: bundleName,
    title,
    mode: passes.length > 1 ? 'multi_turn_edit' : 'new_log',
    status: 'FINAL',
    fullNutrientsAvailable: true,
    passes: passes.map(p => ({
      id: p.turnId,
      turnIndex: p.turnIndex,
      prompt: p.userPrompt,
      photos: p.addedPhotos.map(ph => path.basename(ph)),
      expectedDishCount: p.dishes.length,
      mealTotals: {
        weight: p.totalWeightGrams,
        calories: p.mealTotals.calories,
        protein: p.mealTotals.protein,
        carbs: p.mealTotals.carbohydrates,
        fat: p.mealTotals.totalFat,
        satFat: p.mealTotals.saturatedFat,
        fibre: p.mealTotals.totalFibre,
        sodium: p.mealTotals.sodium,
      },
    })),
    expectedItems: lastPass.dishes.map(d => ({
      key: d.dishName.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      dishName: d.dishName,
      genericEnglishName: d.genericEnglishName,
      estimatedWeightGrams: d.estimatedWeightGrams,
      boundingBox2D: d.boundingBox2D,
      nutrients: d.dishNutrients,
    })),
    finalMealTotals: lastPass.mealTotals,
    sourceOfTruth: `golden/meal/${bundleName}`
  };
}

// ============================================================================
// 5. SVG BOUNDING BOX MAP BUILDER
// ============================================================================

export function buildBoundingBoxSvg(dishes, title, turnLabel = '') {
  const colors = ['#22c55e', '#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6'];

  const rects = dishes.map((d, i) => {
    const [ymin, xmin, ymax, xmax] = d.boundingBox2D;
    const width = Math.max(10, xmax - xmin);
    const height = Math.max(10, ymax - ymin);
    const color = colors[i % colors.length];

    return `
  <!-- Dish ${d.dishIndex}: ${d.dishName} -->
  <rect x="${xmin}" y="${ymin}" width="${width}" height="${height}" 
        fill="${color}" fill-opacity="0.18" stroke="${color}" stroke-width="4" rx="8" />
  <rect x="${xmin}" y="${Math.max(0, ymin - 32)}" width="${Math.min(width, 320)}" height="32" 
        fill="${color}" rx="4" />
  <text x="${xmin + 8}" y="${Math.max(22, ymin - 10)}" font-family="sans-serif" font-size="20" font-weight="bold" fill="#ffffff">
    #${d.dishIndex} ${escapeXml(d.dishName.slice(0, 20))} (${d.estimatedWeightGrams}g)
  </text>`;
  }).join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="100%" height="100%">
  <rect width="1000" height="1000" fill="#1e293b" />
  <text x="30" y="50" font-family="sans-serif" font-size="26" font-weight="bold" fill="#f8fafc">
    ${escapeXml(title)} ${turnLabel ? `— ${escapeXml(turnLabel)}` : ''}
  </text>
  ${rects}
</svg>`;
}

function escapeXml(unsafe) {
  return String(unsafe).replace(/[<>&'"]/g, c => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

// ============================================================================
// 6. MAIN EXECUTION CLI
// ============================================================================

async function main() {
  const options = parseArgs();

  let rawData = '';

  if (options.stdin) {
    rawData = fs.readFileSync(0, 'utf-8');
  } else if (options.input) {
    if (!fs.existsSync(options.input)) {
      console.error(`[MealResultGen] Error: Input file not found at: ${options.input}`);
      process.exit(1);
    }
    rawData = fs.readFileSync(options.input, 'utf-8');
  } else {
    console.log(`
Usage:
  node scripts/generate-meal-result.mjs --input=payload.json [--bundle-name="Meal-Salmon-Bowl-01"] [--output-dir=./output]
  cat payload.json | node scripts/generate-meal-result.mjs --stdin
`);
    process.exit(1);
  }

  let parsedJson;
  try {
    parsedJson = JSON.parse(rawData);
  } catch (e) {
    console.error(`[MealResultGen] Error: Failed to parse input JSON: ${e.message}`);
    process.exit(1);
  }

  const normalizedAudit = validateAndNormalizePayload(parsedJson, options.bundleName);

  // Target directory bundle convention: Meal-[name]-[number]
  const outDir = options.outputDir || path.join(process.cwd(), 'artifacts', 'meal_audits', normalizedAudit.bundleName);
  const photosDir = path.join(outDir, 'photos');
  fs.mkdirSync(photosDir, { recursive: true });

  // 1. Write meal_result.json
  const jsonPath = path.join(outDir, 'meal_result.json');
  fs.writeFileSync(jsonPath, JSON.stringify(normalizedAudit, null, 2), 'utf-8');
  console.log(`  ✓ Generated JSON ledger: ${jsonPath}`);

  // 2. Write meal_result.md
  const mdPath = path.join(outDir, 'meal_result.md');
  const markdownContent = buildMealResultMarkdown(normalizedAudit);
  fs.writeFileSync(mdPath, markdownContent, 'utf-8');
  console.log(`  ✓ Generated Audit Markdown: ${mdPath}`);

  // 3. Write Instruction.md & expected.json (Golden benchmark contracts)
  const instrPath = path.join(outDir, 'Instruction.md');
  fs.writeFileSync(instrPath, buildInstructionMarkdown(normalizedAudit), 'utf-8');
  console.log(`  ✓ Generated Replay Instruction: ${instrPath}`);

  const expectedPath = path.join(outDir, 'expected.json');
  fs.writeFileSync(expectedPath, JSON.stringify(buildExpectedBenchmarkJson(normalizedAudit), null, 2), 'utf-8');
  console.log(`  ✓ Generated Golden Benchmark Contract: ${expectedPath}`);

  // 4. Copy photos into photos/ subfolder if accessible
  for (const pass of normalizedAudit.passes) {
    for (const ph of pass.addedPhotos) {
      if (fs.existsSync(ph)) {
        const dest = path.join(photosDir, path.basename(ph));
        if (path.resolve(ph) !== path.resolve(dest)) {
          fs.copyFileSync(ph, dest);
          console.log(`  ✓ Copied evidence photo: ${path.basename(ph)} -> photos/`);
        }
      }
    }
  }

  // 5. Generate SVG Bounding Box Maps
  if (options.annotateImage) {
    if (normalizedAudit.passes.length === 1) {
      const svgPath = path.join(outDir, 'meal_annotated.svg');
      fs.writeFileSync(svgPath, buildBoundingBoxSvg(normalizedAudit.passes[0].dishes, normalizedAudit.title), 'utf-8');
      console.log(`  ✓ Generated Bounding Box SVG Map: ${svgPath}`);
    } else {
      normalizedAudit.passes.forEach(p => {
        const svgPath = path.join(outDir, `meal_annotated_turn${p.turnIndex}.svg`);
        fs.writeFileSync(svgPath, buildBoundingBoxSvg(p.dishes, normalizedAudit.title, `Turn ${p.turnIndex} (${p.turnId})`), 'utf-8');
        console.log(`  ✓ Generated Bounding Box SVG Map: ${svgPath}`);
      });
    }
  }

  console.log(`\n🎉 Meal Audit Bundle Created: ${normalizedAudit.bundleName}`);
  console.log(`📁 Bundle Path: ${outDir}`);
  console.log(`📊 Mode: ${normalizedAudit.mode} (${normalizedAudit.totalTurns} turn${normalizedAudit.totalTurns > 1 ? 's' : ''}), Weight: ${normalizedAudit.finalWeightGrams}g, Calories: ${normalizedAudit.finalTotals.calories} kcal`);
}

// Direct CLI invocation (symlink-safe)
const isDirectCli = Boolean(
  process.argv[1] &&
  (import.meta.url === `file://${process.argv[1]}` ||
   (() => {
     try {
       return fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
     } catch {
       return false;
     }
   })())
);

if (isDirectCli) {
  main().catch(err => {
    console.error('[MealResultGen] Fatal error:', err);
    process.exit(1);
  });
}
