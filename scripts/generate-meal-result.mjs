#!/usr/bin/env node
/**
 * scripts/generate-meal-result.mjs
 *
 * Audit-Grade Meal Result Document Generator for Health-tracker.
 * Transforms raw dish and vision audit data into canonical, verified:
 *  1. meal_result.json   (Machine-readable 31-nutrient ledger with bounding boxes)
 *  2. meal_result.md     (Executive clinical report with dish breakdowns and nutrient tables)
 *  3. meal_annotated.svg (Visual bounding box overlay in normalized 0-1000 coordinate space)
 *
 * Usage:
 *   node scripts/generate-meal-result.mjs --input="payload.json" --output-dir="artifacts/meal_audits/MEAL-001"
 *   cat payload.json | node scripts/generate-meal-result.mjs --stdin --output-dir="./output"
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================================
// 1. CANONICAL 31 NUTRIENT DEFINITIONS & UNITS
// ============================================================================

export const NUTRIENT_METADATA = {
  // Core Energy & Macronutrients
  calories:       { label: 'Calories',          unit: 'kcal', group: 'core',       dailyRef: 2000, isLimit: true },
  protein:        { label: 'Protein',           unit: 'g',    group: 'core',       dailyRef: 75,   isLimit: false },
  carbohydrates:  { label: 'Carbohydrates',     unit: 'g',    group: 'core',       dailyRef: 225,  isLimit: false },
  totalFat:       { label: 'Total Fat',         unit: 'g',    group: 'core',       dailyRef: 65,   isLimit: true },
  saturatedFat:   { label: 'Saturated Fat',     unit: 'g',    group: 'core',       dailyRef: 20,   isLimit: true },
  transFat:       { label: 'Trans Fat',         unit: 'g',    group: 'core',       dailyRef: 1,    isLimit: true },
  unsaturatedFat: { label: 'Unsaturated Fat',   unit: 'g',    group: 'core',       dailyRef: 45,   isLimit: false },
  omega3:         { label: 'Omega-3',           unit: 'g',    group: 'core',       dailyRef: 1.6,  isLimit: false },

  // Carbohydrate Fractions
  sugar:          { label: 'Total Sugar',       unit: 'g',    group: 'carb_frac',  dailyRef: 50,   isLimit: true },
  addedSugar:     { label: 'Added Sugar',       unit: 'g',    group: 'carb_frac',  dailyRef: 25,   isLimit: true },
  totalFibre:     { label: 'Total Fibre',       unit: 'g',    group: 'carb_frac',  dailyRef: 30,   isLimit: false },
  solubleFibre:   { label: 'Soluble Fibre',     unit: 'g',    group: 'carb_frac',  dailyRef: 8,    isLimit: false },

  // Minerals & Electrolytes
  sodium:         { label: 'Sodium',            unit: 'mg',   group: 'minerals',   dailyRef: 2000, isLimit: true },
  potassium:      { label: 'Potassium',         unit: 'mg',   group: 'minerals',   dailyRef: 3500, isLimit: false },
  magnesium:      { label: 'Magnesium',         unit: 'mg',   group: 'minerals',   dailyRef: 400,  isLimit: false },
  calcium:        { label: 'Calcium',           unit: 'mg',   group: 'minerals',   dailyRef: 1000, isLimit: false },
  iron:           { label: 'Iron',              unit: 'mg',   group: 'minerals',   dailyRef: 14,   isLimit: false },
  zinc:           { label: 'Zinc',              unit: 'mg',   group: 'minerals',   dailyRef: 11,   isLimit: false },
  selenium:       { label: 'Selenium',          unit: 'mcg',  group: 'minerals',   dailyRef: 55,   isLimit: false },
  iodine:         { label: 'Iodine',            unit: 'mcg',  group: 'minerals',   dailyRef: 150,  isLimit: false },
  phosphorus:     { label: 'Phosphorus',        unit: 'mg',   group: 'minerals',   dailyRef: 700,  isLimit: false },

  // Vitamins
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
// 2. HELPER FUNCTIONS: VALIDATION, AGGREGATION, ATWATER CHECK
// ============================================================================

function round(val, decimals = 1) {
  if (val === null || val === undefined || isNaN(Number(val))) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round(Number(val) * factor) / factor;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    input: null,
    outputDir: null,
    stdin: false,
    annotateImage: true,
  };

  for (const arg of args) {
    if (arg.startsWith('--input=')) {
      options.input = arg.slice('--input='.length).trim();
    } else if (arg.startsWith('--output-dir=')) {
      options.outputDir = arg.slice('--output-dir='.length).trim();
    } else if (arg === '--stdin') {
      options.stdin = true;
    } else if (arg === '--no-annotate-image') {
      options.annotateImage = false;
    }
  }

  return options;
}

export function validateAndNormalizePayload(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid payload: must be a JSON object.');
  }

  const mealId = raw.mealId || `MEAL-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
  const timestamp = raw.timestamp || new Date().toISOString();
  const title = raw.title || raw.mealName || 'Untitled Meal';
  const photos = Array.isArray(raw.photos) ? raw.photos : (raw.photo ? [raw.photo] : []);

  if (!Array.isArray(raw.dishes) || raw.dishes.length === 0) {
    throw new Error('Invalid payload: "dishes" array is required and must contain at least one dish.');
  }

  const normalizedDishes = raw.dishes.map((d, idx) => {
    const dishIndex = typeof d.dishIndex === 'number' ? d.dishIndex : idx + 1;
    const dishName = d.dishName || `Dish ${dishIndex}`;
    const genericEnglishName = d.genericEnglishName || dishName;
    const estimatedWeightGrams = Number(d.estimatedWeightGrams) || 0;
    const cookingMethod = d.cookingMethod || 'standard';
    const sourceImageIndex = typeof d.sourceImageIndex === 'number' ? d.sourceImageIndex : 0;

    // Validate bounding box [ymin, xmin, ymax, xmax] in 0-1000 space
    let box = [0, 0, 1000, 1000];
    if (Array.isArray(d.boundingBox2D) && d.boundingBox2D.length === 4) {
      box = d.boundingBox2D.map(n => Math.max(0, Math.min(1000, Math.round(Number(n) || 0))));
    }

    // Foods / ingredients breakdown
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

    // Ensure all 31 nutrients are cleanly populated
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

  // Calculate Whole-Meal Totals
  const mealTotals = {};
  for (const key of NUTRIENT_KEYS) {
    let sum = 0;
    for (const dish of normalizedDishes) {
      sum += Number(dish.dishNutrients[key]) || 0;
    }
    mealTotals[key] = round(sum, key === 'omega3' || key === 'vitaminB12' ? 2 : 1);
  }

  // Calculate Salt (Sodium * 2.54 / 1000)
  mealTotals.salt = round((mealTotals.sodium * 2.54) / 1000, 2);

  const totalWeightGrams = round(normalizedDishes.reduce((acc, d) => acc + (d.estimatedWeightGrams || 0), 0), 0);

  // Atwater Energy Cross-Check: 4P + 4C + 9F
  const atwaterKcal = round((4 * mealTotals.protein) + (4 * mealTotals.carbohydrates) + (9 * mealTotals.totalFat), 0);
  const declaredKcal = mealTotals.calories || 0;
  const kcalDiff = round(declaredKcal - atwaterKcal, 0);
  const kcalDiffPercent = declaredKcal > 0 ? round((Math.abs(kcalDiff) / declaredKcal) * 100, 1) : 0;

  // Clinical Metrics
  const potassiumSodiumRatio = mealTotals.sodium > 0 ? round(mealTotals.potassium / mealTotals.sodium, 2) : 0;
  const addedSugarKcalPercent = declaredKcal > 0 ? round(((mealTotals.addedSugar * 4) / declaredKcal) * 100, 1) : 0;
  const satFatKcalPercent = declaredKcal > 0 ? round(((mealTotals.saturatedFat * 9) / declaredKcal) * 100, 1) : 0;

  const clinicalSummary = {
    energyVerification: {
      declaredCalories: declaredKcal,
      atwaterCalories: atwaterKcal,
      differenceKcal: kcalDiff,
      differencePercent: kcalDiffPercent,
      isBalanced: kcalDiffPercent <= 10.0,
      formula: `4 * ${mealTotals.protein}g(P) + 4 * ${mealTotals.carbohydrates}g(C) + 9 * ${mealTotals.totalFat}g(F) = ${atwaterKcal} kcal`
    },
    metrics: {
      potassiumSodiumRatio,
      addedSugarKcalPercent,
      satFatKcalPercent,
      fibrePer1000Kcal: declaredKcal > 0 ? round((mealTotals.totalFibre / declaredKcal) * 1000, 1) : 0,
    },
    observations: raw.clinicalSummary?.observations || raw.observations || [],
  };

  return {
    schemaVersion: '1.0.0',
    mealId,
    timestamp,
    title,
    photos,
    totalWeightGrams,
    dishes: normalizedDishes,
    mealTotals,
    clinicalSummary,
  };
}

// ============================================================================
// 3. MARKDOWN DOCUMENT BUILDER
// ============================================================================

export function buildMealResultMarkdown(audit) {
  const { mealId, timestamp, title, photos, totalWeightGrams, dishes, mealTotals, clinicalSummary } = audit;

  const lines = [];

  lines.push(`# 🍽️ Meal Audit Report: ${title}`);
  lines.push(`**Meal ID:** \`${mealId}\`  |  **Audited At:** ${timestamp}  |  **Total Weight:** ${totalWeightGrams} g`);
  if (photos && photos.length > 0) {
    lines.push(`**Evidence Photos:** ${photos.map(p => `\`${p}\``).join(', ')}`);
  }
  lines.push('');

  // Energy Balance Banner
  const ev = clinicalSummary.energyVerification;
  if (ev.isBalanced) {
    lines.push(`> [!NOTE] Energy Balance Verified\n> Declared **${ev.declaredCalories} kcal** matches Atwater macronutrient sum (**${ev.atwaterCalories} kcal**, Δ ${ev.differencePercent}%). Formula: ${ev.formula}.`);
  } else {
    lines.push(`> [!WARNING] Energy Imbalance Detected\n> Declared **${ev.declaredCalories} kcal** diverges by **${ev.differencePercent}%** from macronutrient energy sum (**${ev.atwaterCalories} kcal**). Inspect cooking oils or hidden sauces.`);
  }
  lines.push('');

  // Section 1: Dishes & Bounding Boxes
  lines.push('## 1. Dish Decomposition & Visual Grounding');
  lines.push('');
  lines.push('| # | Dish Name | Generic / English Name | Weight | Cooking Method | Bounding Box [ymin, xmin, ymax, xmax] |');
  lines.push('|---|---|---|---|---|---|');
  dishes.forEach(d => {
    const boxStr = `\`[${d.boundingBox2D.join(', ')}]\``;
    lines.push(`| **${d.dishIndex}** | **${d.dishName}** | ${d.genericEnglishName} | ${d.estimatedWeightGrams} g | ${d.cookingMethod} | ${boxStr} |`);
  });
  lines.push('');

  // Detail for each dish and its ingredients
  lines.push('### Dish Ingredients & Components');
  dishes.forEach(d => {
    lines.push(`- **Dish ${d.dishIndex}: ${d.dishName}** (${d.estimatedWeightGrams} g, \`${d.cookingMethod}\`)`);
    if (d.foods && d.foods.length > 0) {
      d.foods.forEach(f => {
        const wtStr = f.estimatedWeightGrams > 0 ? ` (~${f.estimatedWeightGrams}g)` : '';
        const ingStr = f.ingredients && f.ingredients.length > 0 ? ` (Ingredients: ${f.ingredients.join(', ')})` : '';
        lines.push(`  • ${f.name}${wtStr}${ingStr}`);
      });
    } else {
      lines.push('  • Whole-item portion (no sub-components extracted)');
    }
  });
  lines.push('');

  // Section 2: Comprehensive 31-Nutrient Ledger Table
  lines.push('## 2. Comprehensive 31-Nutrient Audit Ledger');
  lines.push('');
  lines.push('Full breakdown across all 31 canonical nutrients for each dish and aggregated whole-meal totals:');
  lines.push('');

  // Build Table Header
  const headerCols = ['Nutrient', 'Unit'];
  dishes.forEach(d => headerCols.push(`D${d.dishIndex}: ${d.dishName.slice(0, 14)}`));
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
    lines.push(`| **--- ${grp.title} ---** | | ${dishes.map(() => '').join(' | ')} | | |`);
    const groupNutrients = NUTRIENT_KEYS.filter(k => NUTRIENT_METADATA[k].group === grp.groupKey);

    for (const key of groupNutrients) {
      const meta = NUTRIENT_METADATA[key];
      const totalVal = mealTotals[key] || 0;
      const refPct = meta.dailyRef ? round((totalVal / meta.dailyRef) * 100, 0) : '--';
      const refStr = typeof refPct === 'number' ? `${refPct}%` : refPct;

      const row = [
        meta.isLimit ? `⚠️ **${meta.label}**` : meta.label,
        meta.unit
      ];

      dishes.forEach(d => {
        row.push(d.dishNutrients[key] !== undefined ? `${d.dishNutrients[key]}` : '0');
      });

      row.push(`**${totalVal}**`);
      row.push(`${refStr}`);

      lines.push('| ' + row.join(' | ') + ' |');
    }
  }

  // Salt row (derived)
  lines.push(`| Salt (Derived: Na × 2.54) | g | ${dishes.map(d => round((d.dishNutrients.sodium * 2.54) / 1000, 2)).join(' | ')} | **${mealTotals.salt}** | ${round((mealTotals.salt / 5) * 100, 0)}% |`);
  lines.push('');

  // Section 3: Clinical & Dietitian Summary
  lines.push('## 3. Clinical & Nutritional Evaluation');
  lines.push('');
  const cm = clinicalSummary.metrics;
  lines.push(`- **Potassium-to-Sodium (K/Na) Ratio:** \`${cm.potassiumSodiumRatio}\` ${cm.potassiumSodiumRatio >= 1.0 ? '✅ (Healthy cardiovascular balance ≥ 1.0)' : '⚠️ (High sodium relative to potassium < 1.0)'}`);
  lines.push(`- **Added Sugar Energy:** \`${cm.addedSugarKcalPercent}%\` of total calories ${cm.addedSugarKcalPercent <= 10.0 ? '✅ (Within WHO guideline ≤ 10%)' : '⚠️ (Exceeds WHO guideline > 10%)'}`);
  lines.push(`- **Saturated Fat Energy:** \`${cm.satFatKcalPercent}%\` of total calories ${cm.satFatKcalPercent <= 10.0 ? '✅ (Optimal cardiometabolic limit ≤ 10%)' : '⚠️ (High saturated fat > 10%)'}`);
  lines.push(`- **Fibre Density:** \`${cm.fibrePer1000Kcal} g / 1000 kcal\` ${cm.fibrePer1000Kcal >= 14.0 ? '✅ (Meets dietary fibre density benchmark ≥ 14g)' : '⚠️ (Low fibre density < 14g)'}`);
  lines.push('');

  if (clinicalSummary.observations && clinicalSummary.observations.length > 0) {
    lines.push('### Key Observations');
    clinicalSummary.observations.forEach(obs => lines.push(`- ${obs}`));
    lines.push('');
  }

  lines.push('---');
  lines.push(`*Generated by Health-tracker Meal Audit Engine v1.0.0 — Verified 31-Nutrient Protocol.*`);

  return lines.join('\n');
}

// ============================================================================
// 4. SVG BOUNDING BOX OVERLAY GENERATOR
// ============================================================================

export function buildBoundingBoxSvg(audit) {
  const { title, dishes } = audit;
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
  <text x="30" y="50" font-family="sans-serif" font-size="28" font-weight="bold" fill="#f8fafc">
    ${escapeXml(title)} — Visual Dish Bounding Boxes
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
// 5. MAIN EXECUTION CLI
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
  node scripts/generate-meal-result.mjs --input=payload.json [--output-dir=./artifacts/meals/MEAL-001]
  cat payload.json | node scripts/generate-meal-result.mjs --stdin [--output-dir=./output]
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

  const normalizedAudit = validateAndNormalizePayload(parsedJson);

  // Target directory
  const outDir = options.outputDir || path.join(process.cwd(), 'artifacts', 'meal_audits', normalizedAudit.mealId);
  fs.mkdirSync(outDir, { recursive: true });

  const jsonPath = path.join(outDir, 'meal_result.json');
  const mdPath = path.join(outDir, 'meal_result.md');
  const svgPath = path.join(outDir, 'meal_annotated.svg');

  // 1. Write JSON
  fs.writeFileSync(jsonPath, JSON.stringify(normalizedAudit, null, 2), 'utf-8');
  console.log(`  ✓ Generated JSON ledger: ${jsonPath}`);

  // 2. Write Markdown
  const markdownContent = buildMealResultMarkdown(normalizedAudit);
  fs.writeFileSync(mdPath, markdownContent, 'utf-8');
  console.log(`  ✓ Generated Audit Markdown: ${mdPath}`);

  // 3. Write SVG Bounding Box Map
  if (options.annotateImage) {
    const svgContent = buildBoundingBoxSvg(normalizedAudit);
    fs.writeFileSync(svgPath, svgContent, 'utf-8');
    console.log(`  ✓ Generated Bounding Box SVG Map: ${svgPath}`);
  }

  console.log(`\n🎉 Meal Audit Complete: ${normalizedAudit.title} (${normalizedAudit.dishes.length} dishes, ${normalizedAudit.totalWeightGrams}g, ${normalizedAudit.mealTotals.calories} kcal)`);
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
