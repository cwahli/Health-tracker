# Plan: Meal-Audit Bot & Document Generator

## 1. Executive Summary & Objective

The **Meal-Audit Bot** (`meal-audit`) is an audit-grade AI nutrition agent designed for clinical-precision meal analysis. Unlike standard meal trackers that only estimate rough calories and macronutrients, the Meal-Audit Bot performs an exhaustive visual and nutritional decomposition of every meal image:

1. **Scene Grounding & Dish Decomposition**: Detects every separate dish/plate/container in the meal with normalized 2D bounding boxes (`[ymin, xmin, ymax, xmax]`).
2. **Ingredient-Level Analysis**: Deconstructs each dish into its concrete food ingredients, cooking methods, and estimated gram weights.
3. **Audit-Grade 31-Nutrient Ledger**: Computes the exact nutrient profile covering all **31 canonical nutrients** for each individual dish and the whole-meal total.
4. **Automated Document Generation**: Feeds the structured audit data into a script (`scripts/generate-meal-result.mjs`) that produces a verified **Meal Results Document** (`meal_result.json` and `meal_result.md`), complete with visual bounding boxes, dish breakdowns, and full nutrient ledger tables.

---

## 2. Bot Identity & Operational Role

| Attribute | Specification |
|---|---|
| **Bot Name** | `meal-audit` (e.g. Telegram `@Meal_Audit_bot` or Hermes profile `meal_audit`) |
| **Primary Input** | Meal photos (single plate, multi-dish spread, bento, packaging, label), optional text context |
| **Vision Model** | High-precision multimodal vision model (Gemini 2.5 Flash / Gemini 3.5 Flash-lite or DeepSeek Vision) |
| **Output** | Interactive chat breakdown + generated audit documents (`meal_result.json`, `meal_result.md`) |
| **Interaction Style** | Clinical, rigorous, transparent about confidence, shows typing indicators and step progress |

---

## 3. Data Schema: The 31 Nutrients & Bounding Boxes

The bot and generator script adhere strictly to the canonical nutrient keys defined in `src/utils/nutrients.ts`:

- **Core Energy & Macronutrients (8)**: `calories` (kcal), `protein` (g), `carbohydrates` (g), `totalFat` (g), `saturatedFat` (g), `transFat` (g), `unsaturatedFat` (g), `omega3` (g).
- **Carbohydrate Fractions (4)**: `sugar` (g), `addedSugar` (g), `totalFibre` (g), `solubleFibre` (g).
- **Electrolytes & Minerals (9)**: `sodium` (mg), `potassium` (mg), `magnesium` (mg), `calcium` (mg), `iron` (mg), `zinc` (mg), `selenium` (mcg), `iodine` (mcg), `phosphorus` (mg), plus derived `salt` (g).
- **Vitamins (11)**: `vitaminD` (IU), `vitaminB12` (mcg), `folate` (mcg), `vitaminC` (mg), `vitaminE` (mg), `vitaminK` (mcg), `vitaminA` (mcg), `vitaminB6` (mg), `thiamine` (mg), `riboflavin` (mg), `niacin` (mg).

---

## 4. End-to-End Processing Workflow

1. **Scene Inspection & Dish Segmentation**: Detect every distinct dish/container and extract normalized 2D bounding boxes `[ymin, xmin, ymax, xmax]` (0-1000 scale).
2. **Food Item & Ingredient Decomposition**: Split each dish into ingredients, cooking methods, and gram estimates.
3. **31-Nutrient Mapping & Energy Balance Verification**: Compute all 31 nutrients per dish. Verify Atwater energy balance:
   ```
   Calculated kcal = (4 * protein) + (4 * carbs) + (9 * fat)
   ```
4. **Whole-Meal Aggregation**: Sum all 31 nutrients across every dish into `mealTotals`.
5. **Document Generation**: Run `node scripts/generate-meal-result.mjs` to output:
   - `meal_result.json` (strictly typed JSON ledger)
   - `meal_result.md` (audit report with bounding boxes, dish breakdown, and 31-nutrient table).

---

## 5. Generator Script: `scripts/generate-meal-result.mjs`

CLI Usage:
```bash
node scripts/generate-meal-result.mjs \
  --input="payload.json" \
  --output-dir="artifacts/meal_audits/MEAL-20260922-001" \
  [--annotate-image]
```

---

## 6. Implementation Phases

1. **Phase 1**: Implement `scripts/generate-meal-result.mjs` (schema validation, 31-nutrient aggregator, markdown report generator).
2. **Phase 2**: Add bounding box image overlay annotation capability.
3. **Phase 3**: Create `meal-audit-engine` skill and Hermes profile `meal_audit` (SOUL.md, config.yaml).
4. **Phase 4**: Connect to golden benchmark test harness (`golden/meal/Meal_04_log`).
5. **Phase 5**: End-to-end verification with sample meal photos and `npx tsc --noEmit`.
