import { Type } from "@google/genai";

/**
 * 🔒 PROTECTED SPECIFICATION — Edits require human confirmation (AGENTS.md §3).
 * Scout-Only Compare System Instruction & Schema
 * Streamlined, schema-first architecture for Mode D Product Evaluation & Comparison.
 */
// NOTE (2026-09-12, Mode D duplicate-baseline fix): the live NUTRITIONAL
// TARGET STATUS block is appended dynamically per-run by the server
// (buildNutritionTargetStatus). A stale hardcoded averages block used to live
// at the top of the template below, sending the model two conflicting
// baselines (3-day vs 4-day) in one prompt — it is intentionally absent.
export const scoutOnlyCompareSystemInstruction = `You are a Clinical Dietitian & Vision Scout evaluating competing food options (Mode D).

TASK:
STEP 1: FIRST, EXHAUSTIVELY LIST EVERY LEGIBLE DISH/PRODUCT ACROSS ALL IMAGES INTO 'allExtractedDishes'.
STEP 2: THEN, GROUP EVERY EXTRACTED DISH INTO NUTRITIONAL CLUSTERS WITH <=10% MACRO VARIANCE.

CLINICAL INVARIANTS:
1. EVALUATION ONLY (NON-ADDITIVE):
   - Items are mutually exclusive candidate choices. Never sum meal totals or log as a consumed plate. Do not calculate composite meal totals or prompt for portion confirmations.

2. EXHAUSTIVE EXTRACTION FIRST (NO OMISSIONS):
   - In 'allExtractedDishes', scan every column, section, shelf, and page top-to-bottom across ALL images without stopping.
   - Do NOT provide a representative sample or cap at 3-5 items. Transcribe EVERY single legible dish/product into 'allExtractedDishes' (dense restaurant menus contain 30 to 100+ total dishes).
   - Format non-English names as 'Local Name / English Translation'.

3. <=10% MACRO VARIANCE CLUSTERING (ANTI-COLLAPSE):
   - Group items together ONLY if estimated macronutrients differ by <=10%.
   - CRITICAL ANTI-COLLAPSE RULE: Do NOT dump dozens of items into a giant catch-all warning/alert group. Split broad categories into separate groups if preparation methods cause >10% macro variance (e.g., water-poached broths vs boiled greens vs steamed plant proteins vs stir-fried vegetables vs plain carbs vs coconut/fried carbs vs lean grilled/steamed marine fish vs batter-fried poultry/catfish meal sets vs salted fish vs organ meats/offal vs spicy starches/seblak vs sweet confectionery/desserts).
   - HARD SIZE CAP: Never emit a group with >=40 items. If a cluster would exceed ~35 items, split by preparation class (grill/steam vs deep-fry vs coconut rice vs offal vs seblak) until every group is under 40.
       - MARINE WHOLE-FISH SEPARATION: Whole marine Omega-3 fish meal sets and grilled/steamed whole sea fish (Paket Kembung / mackerel-class / kembung-class / nila-class whole fish packages) MUST NOT share a group with deep-fried meal sets, organ meats/offal (usus/ati/jeroan), or seblak/ultra-processed spicy starches. Elevate cardioprotective marine Omega-3 whole-fish classes into Tier 1 (good) or Tier 2 (neutral); keep oxidized deep-fry oils, offal, and seblak in Tier 3–4.
   - Every single dish from 'allExtractedDishes' MUST be classified into exactly one group.

4. UNLISTED HARMS & BENEFITS ISOLATION:
   - Beyond raw macros, actively evaluate physiological hazards and cardioprotective benefits:
     * UNLISTED HARMS: Isolate oxidized deep-frying oils, lipid peroxides, trans fats, and ultra-processed gelatinized starches (e.g., Seblak) into Tier 3 (Warning) or Tier 4 (Alert).
     * BENEFITS: Elevate whole foods offering cardioprotective marine Omega-3s (EPA/DHA in whole sea fish / whole marine fish meal sets) and antioxidant polyphenols (sour fruit broths) into Tier 1 (Good) or Tier 2 (Neutral) — never demote those classes into the same alert cluster as deep-fried sets, offal, or seblak.

5. TARGET-DRIVEN CLINICAL RANKING & COMBINED GUIDANCE:
   - Rank groups strictly descending: Best choice addressing the patient's active surpluses and deficits at the top ('good'), least suitable at the bottom ('alert').
   - Tailor all verdicts, comparative sentences, and clinical messages directly to the patient's target deviations.
   - Combine clinical guidance and an actionable ordering tip into a single cohesive message.`;

export function buildScoutComparePrompt(
  userMessage: string,
  imageCount: number,
  patientContext?: {
    biomarkersNeedingImprovement?: any[];
    remainingAllowance?: any;
  }
): string {
  const cleanMsg = (userMessage || "").trim();
  const isGeneric = !cleanMsg || /^(analyze\s*(this|the)?\s*(meal|food|photo|image)?[s.]*|compare|scan)$/i.test(cleanMsg);
  const multiImageRule = imageCount > 1 ? ` across all ${imageCount} images` : " across provided images";

  return isGeneric
    ? `FIRST: Exhaustively list ALL visible food/beverage options${multiImageRule} into 'allExtractedDishes' (no sampling, extract every legible dish). THEN: Distribute EVERY single dish from 'allExtractedDishes' into granular nutritional groups with <=10% macro variance (no catch-all groups >=40 items; separate clear soups, plain carbs, whole marine Omega-3 fish meal sets, deep-fried poultry/catfish sets, salted fish, offal, and seblak into distinct groups; never co-group marine whole-fish packages with deep-fried sets, offal, or seblak). Elevate marine Omega-3 whole-fish classes to Tier 1–2. The sum of items across all groups MUST equal the total count in 'allExtractedDishes'. All rankings and combined clinical messages (with ordering tips) must directly address the patient's target deviations.`
    : `User request: "${cleanMsg}"${multiImageRule ? ` (${imageCount} images)` : ""}. FIRST: List all visible dishes into 'allExtractedDishes'. THEN: Distribute EVERY dish into <=10% macro variance groups (sum of group items must equal total extracted dishes).`;
}

export const scoutOnlyCompareResponseSchema = {
  type: Type.OBJECT,
  properties: {
    allExtractedDishes: {
      type: Type.ARRAY,
      description: "FIRST: Exhaustive list of ALL legible dishes, products, or drinks across all columns, shelves, and pages. Format as 'Local Name / English Translation'. Must contain every single item before grouping.",
      items: { type: Type.STRING },
    },
    _internalReasoning: {
      type: Type.STRING,
      description: "Clinical evaluation trace: extraction coverage across sections, <=10% macro clustering rationale, unlisted harm/benefit segregation, and patient target alignment.",
    },
    comparisonTitle: {
      type: Type.STRING,
      description: "Descriptive title of the evaluated menu, shelf, or products.",
    },
    comparisonType: {
      type: Type.STRING,
      enum: ["nutrition_labels", "menu_items", "shelf_selection", "food_items"],
    },
    summary: {
      type: Type.STRING,
      description: "High-level clinical summary synthesizing the landscape of choices against the patient's specific metabolic surpluses and deficits.",
    },
    recommendedOption: {
      type: Type.STRING,
      description: "Top recommended dish or product formatted as 'Local Name / English Translation'.",
    },
    groups: {
      type: Type.ARRAY,
      description: "THEN: Granular nutritional clusters with <=10% macro variance, ordered strictly from healthiest/safest to least favorable. CRITICAL: Every single item from allExtractedDishes MUST be classified into exactly one group. The total count of items across all groups MUST equal the count in allExtractedDishes (no sampling, no exemplars, zero omitted items). FORBIDDEN: any group with >=40 items — split it by preparation class.",
      items: {
        type: Type.OBJECT,
        properties: {
          groupName: {
            type: Type.STRING,
            description: "Tier and descriptive cluster name (e.g., 'Tier 1 - Safest Choice: Tangy Poached Broths (Garang Asem)').",
          },
          sourceImageIndex: {
            type: Type.INTEGER,
            description: "0-based index of the photo containing this group's visual region (default 0).",
          },
          verdict: {
            type: Type.OBJECT,
            properties: {
              label: {
                type: Type.STRING,
                description: "3-6 word concise clinical verdict label (e.g., 'Lowest Fat & Clean Protein').",
              },
              level: {
                type: Type.STRING,
                enum: ["good", "neutral", "warning", "alert"],
                description: "Clinical safety level: 'good' (Tier 1), 'neutral' (Tier 2), 'warning' (Tier 3), 'alert' (Tier 4).",
              },
            },
            required: ["label", "level"],
          },
          comparisonSentence: {
            type: Type.STRING,
            description: "Exactly ONE comparative sentence contrasting how this group moves the user's specific targets compared to alternatives.",
          },
          message: {
            type: Type.STRING,
            description: "35-70 words explaining why this group ranks here relative to the user's active surpluses and deficits, concluding with an actionable ordering tip.",
          },
          boundingBox2D: {
            type: Type.ARRAY,
            items: { type: Type.INTEGER },
            description: "[ymin, xmin, ymax, xmax] normalized (0 to 1000) framing this group's visual region on the photo.",
          },
          servingWeightGrams: {
            type: Type.NUMBER,
            description: "Typical single-serving weight in grams (e.g., 350 for soup/stew, 300 for plated meal, 250 for beverage, 70 for bread/pastry).",
          },
          averageNutrientsPer100g: {
            type: Type.OBJECT,
            description: "Estimated nutrients per 100g reference. Track strictly the 10 patient allowance keys. Do NOT emit meal-logging trace minerals (no selenium, iodine, phosphorus, zinc, vitamin B12).",
            properties: {
              calories: { type: Type.NUMBER },
              protein: { type: Type.NUMBER },
              totalFat: { type: Type.NUMBER },
              saturatedFat: { type: Type.NUMBER },
              carbohydrates: { type: Type.NUMBER },
              sugar: { type: Type.NUMBER },
              addedSugar: { type: Type.NUMBER },
              totalFibre: { type: Type.NUMBER },
              sodium: { type: Type.NUMBER },
              transFat: { type: Type.NUMBER },
            },
            required: ["calories", "protein", "totalFat", "saturatedFat", "carbohydrates", "sugar", "totalFibre", "sodium"],
          },
          items: {
            type: Type.ARRAY,
            description: "EXHAUSTIVE list of ALL visible dishes in this category across all columns, rows, and pages. Do NOT sample or truncate at 3-5 items; transcribe every legible item (dense menus have 15-30+ items per group). Format non-English names as 'Local Name / English Translation'.",
            items: { type: Type.STRING },
          },
        },
        required: ["groupName", "sourceImageIndex", "verdict", "comparisonSentence", "message", "boundingBox2D", "servingWeightGrams", "averageNutrientsPer100g", "items"],
      },
    },
  },
  required: ["allExtractedDishes", "_internalReasoning", "comparisonTitle", "comparisonType", "summary", "recommendedOption", "groups"],
};
