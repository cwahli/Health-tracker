# Health Tracker — End-to-End Diagnostic Report

- **Exported:** 2026-08-23T21:21:41.477Z
- **Job ID:** `job_1787519993656_n3pn6u0de`
- **Mode:** review
- **Photo:** https://pub-d17eecca64f82625d29dc38b14f46c14.r2.dev/photos/job_1787519993656_n3pn6u0de.jpg

## 👤 Last User Action

- **Action:** submit_meal_job
- **Timestamp:** 2026-08-23T21:20:09.624Z

## 🐾 User Action Breadcrumbs

| Timestamp | Action | Target / Context | Details |
|-----------|--------|------------------|---------|
| 21:19:43 | network_slow | /api/jobs/status | {"duration":2707,"method":"GET"} |
| 21:19:45 | network_slow | https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel | {"duration":2711,"method":"POST"} |
| 21:19:49 | click | button | {"id":"nav-tab-food","label":"Food History"} |
| 21:19:50 | click | button | {"label":"w-14 h-14 bg-indigo-600 text-w"} |
| 21:19:53 | click | button | {"label":"Log Meal"} |
| 21:19:54 | click | button | {"id":"food-chat-photo-btn","label":"food-chat-photo-btn"} |
| 21:20:04 | input_change | input | {"name":"input","valueLength":35} |
| 21:20:09 | submit_initiated | chat_composer | {"prompt":"I had it at yolk","imageCount":1} |
| 21:20:09 | input_change | input | {"name":"food-chat-input","valueLength":16} |
| 21:20:09 | submit_meal_job | chat_compose_dock | {"jobId":"job_1787519993656_n3pn6u0de","promptLength":16,"imageCount":1,"submissionMode":"review"} |

## 🌐 Console & Network Diagnostics

### Network Request Warnings & Errors (2)
```
[2026-08-23T21:19:43.084Z] [NET LATENCY WARNING GET] /api/jobs/status (2707ms)
[2026-08-23T21:19:45.970Z] [NET LATENCY WARNING POST] https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel (2711ms)
```

### Client Console Logs (1)
```
[WARN 2026-08-23T21:19:48.364Z] Auth check timed out. Falling back to local state.
```

## 🔍 Vision Scout Results (3 items detected)

| Item / Keyword | Estimated Weight | Confidence | Notes / Search Query |
|----------------|------------------|------------|----------------------|
| YOLK Steak Chimi 2.0 Sandwich | 30g | High | french bread; grilled chicken breast; chimichurri sauce; cheese |
| YOLK Roasted Broccoli and Cabbage Side | 200g | High | broccoli; cabbage; olive oil |
| YOLK Roasted Baby Potatoes Side | 220g | High | potato; olive oil |

## 📊 Nutrition Calculation & Breakdown

- **Meal Name:** YOLK Steak Chimi 2.0 Sandwich with Roasted Broccoli and Cabbage Side and Roasted Baby Potatoes Side
- **Quantity:** 1 serving
- **Total Meal Weight:** 450g

### Component Items Breakdown

| Component | Weight | Calories | Protein | Carbs | Fat | Brand / Truth Source |
|-----------|-------:|---------:|--------:|------:|----:|---------------------|
| YOLK Steak Chimi 2.0 Sandwich | 30g | 95 | 3.1g | 10.6g | 3.5g | — |
| YOLK Roasted Broccoli and Cabbage Side | 200g | 92 | 2.1g | 16.6g | 2.5g | — |
| YOLK Roasted Baby Potatoes Side | 220g | 175 | 7.7g | 18.3g | 8.2g | — |

### 📋 Comprehensive Nutrient Values

| Nutrient | Value |
|----------|------:|
| **Calories** | **362 kcal** |
| **Protein** | **12.9 g** |
| **Carbohydrates** | **45.5 g** |
| **Total Fat** | **14.2 g** |
| **Saturated Fat** | **3.4 g** |
| **Trans Fat** | **0 g** |
| **Added Sugar** | **0.2 g** |
| **Sodium** | **1222 mg** |
| **Dietary Fiber** | **6.1 g** |
| Calcium | 95.7 mg |
| Iron | 3.1 mg |
| Potassium | 420 mg |
| Vitamin A | 37 mcg |
| Vitamin C | 36 mg |
| Vitamin D | 0 mcg |
| Vitamin E | 1.2 mg |
| Vitamin K | 15.6 mcg |
| Riboflavin (B2) | 0.2 mg |
| Niacin (B3) | 4.4 mg |
| Vitamin B6 | 0.3 mg |
| Vitamin B12 | 0.4 mcg |
| Folate | 112.3 mcg |
| Phosphorus | 189.4 mg |
| Magnesium | 85.4 mg |
| Zinc | 2 mg |
| Selenium | 21.4 mcg |

## 💬 Dietitian & Agent Narrative

You got 32.3g of quality protein and fiber from the roasted vegetables. However, the restaurant sandwich and sides add 1,222mg of sodium, pushing today's total 101% over your daily limit. This high sodium load causes temporary fluid retention, increased thirst, and mild blood vessel constriction. Drink an extra glass of water to support electrolyte balance, and keep your upcoming meals light and low in salt.

## 🖥️ Backend Execution Logs

```
[status] Starting food analysis...
[backend] [Client State] No active meal received.
[backend] [Image Payload] Received 1 image(s). Approx sizes (KB): 85KB.
[backend] [Edit Gate] userSelectedMode="review" | userExplicitlySelectedEditMode=false | activeMeal=false | hasImages=true | message="I had it at yolk" | isExplicitModify=false | refineSkip=false reason=not_refine
[scout_instruction] Vision Scout Instruction dispatched (model: gemini-3.5-flash-lite). Prompt: "Analyze the provided image and list the food items you see, taking into consideration the user's message: "I had it at yolk". If any identified dish is a known item from a restaurant chain or brand (e.g. McDonald's, Yolk, Starbucks), capture exact brand and dish name in originalName and queriesToSearch for server web search."
[backend] [Vision Scout] Running Stage 3 lightweight vision scout with retry protection...
[backend] [UnifiedLLM:scout] Dispatching prompt to model: "gemini-3.5-flash-lite". Contents turns: 1.
[backend] [UnifiedLLM:scout] Attaching 1 image part(s) to model "gemini-3.5-flash-lite".
[backend] [UnifiedLLM-Prompt:scout] System Instruction:
System Instruction:
STEP 1: SCENE CLASSIFICATION & ENVIRONMENT
- 'contentType': 'visual' (food photo), 'menu_or_poster' (menu/kiosk screen), 'label' (nutrition panel), or 'text'.
- 'diningEnvironment': 'casual_restaurant' | 'fast_food_chain' | 'home_cooked' | 'fine_dining' | 'airline' | 'unknown'.

STEP 2: UNIVERSAL DISH EXTRACTION & DEDUPLICATION
- USER MESSAGE SCOPE ANCHOR & MULTI-DISH EXTRACTION: Extract EVERY distinct food, drink, side, or meal item visible in the photo or menu/kiosk screen as its own separate entry in 'items' (e.g. if 2 dishes or a main + drink are visible, output 2 separate item objects). Do NOT combine distinct dishes into 1 item. For beverages and open cups, estimate weight based on visible fill level (e.g. half-full cup ~100-120g vs full ~200-250g). If user's text message specifies a portion/weight (e.g. "50g of oats + fruits"), assign logically. The user's explicit text sentence is absolute ground truth. CRITICAL: If the user's text explicitly limits consumption (e.g., "I only had 1 croissant", "I just ate the salad"), you MUST strictly obey this constraint and ONLY extract the specified items. Skip all other visible food items entirely. Otherwise, only skip items if they are unopened bulk grocery packaging used merely for context.
- CROSS-IMAGE DEDUPLICATION: If photos show BOTH a menu screen AND physical food, or raw grocery packages AND the cooked dish prepared from them, extract each distinct dish ONCE. Do NOT duplicate raw ingredients and their cooked dish as separate meals.
- KNOWN CHAIN & BRAND IDENTIFICATION: For any restaurant chain, brand, or menu item (e.g. McDonald's, Yolk, Starbucks, Pret):
  1. Capture exact brand + dish title in 'originalName' (e.g. "YOLK Steak Chimi 2.0 Sandwich").
  1b. ALSO output the brand/chain name alone (e.g. 'McDonald's', not 'McDonald's Big Mac') in the new 'chainName' field. Leave 'chainName' null for home-cooked or non-branded items.
  2. Include brand + dish title in 'queriesToSearch' so the server executes live web search and database matching for official nutrients and ingredients.
  3. If calories/macros or ingredients are printed on a visible menu/kiosk screen or package, transcribe them into 'rawNutritionLabel' & 'ingredientsList' with 'source': 'label' (Screen OCR Dominance).
  4. STRICT PRINTED TRUTH IN rawNutritionLabel: Transcribe ONLY values that are literally visible/printed on the image, photo, or kiosk screen into 'rawNutritionLabel'. NEVER invent, guess, or populate unprinted macro fields into 'rawNutritionLabel' using internal parametric memory. If a kiosk photo or menu board only displays calories (e.g. "455 kcal"), set ONLY calories: "455 kcal" in 'rawNutritionLabel' and set missing unprinted fields to null. When a photo is flagged as a nutrition label — even a secondary/background photo merged with a primary dish photo — look closely at that image specifically before transcribing: read each printed value directly off the label rather than defaulting fields to null, and only use null for a field if it is genuinely illegible or absent from the label itself.
  4b. SUGAR FIELDS — TOTAL vs ADDED: 'sugar' = Total Sugars, printed as "Sugars" or "of which sugars" on UK/EU labels, or "Total Sugars" on US labels. Populate 'sugar' whenever any sugar figure is printed. 'addedSugar' must be populated ONLY when the label explicitly and separately prints an "Added Sugars" or "Includes Xg Added Sugars" line (US FDA format). UK/EU labels almost never print this — leave 'addedSugar' null in that case. Do NOT copy the 'sugar' value into 'addedSugar' — the backend derives Added Sugar itself from food type and ingredients.
- PARTIAL TRUTH TRANSCRIPTION & VISUAL TRACKING: Transcribe whatever partial truth is literally visible on the screen/label/menu (even if only calories, e.g. "450 kcal", or 8-10 key nutrients) into 'rawNutritionLabel'. Set 'lockedNutrientKeys' to an array of lowercase nutrient names that were literally visible (e.g. ["calories"]). NEVER invent unprinted fields in 'rawNutritionLabel'. Simultaneously, for mixed dishes (like salads, sandwiches) ALWAYS visually inspect and decompose dish ingredients in 'components' & 'visualIngredients' so the engine can extrapolate the full 31-nutrient profile using first principles anchored by the printed truth. For single, uniform foods (like bread, baguettes, cheese, plain rice, whole fruits, plain meats, liquids), DO NOT decompose them into recipe ingredients (like flour, water, yeast, milk).

STEP 3: COMPONENT DECOMPOSITION, CLINICAL QUERIES & LABELS
- NATURAL CANONICAL ENGLISH QUERIES (USDA RETRIEVAL): Format all 'keyword', 'searchQuery', and 'queriesToSearch' strictly in clean standard English for USDA database matching (e.g. translate foreign/local culinary terms like "caisim" -> "baby bok choy", "daging empal" -> "braised beef brisket", "gai lan" -> "chinese broccoli"). Use natural 2-3 word canonical noun phrases (e.g., "grilled chicken breast", "feta cheese", "steamed white rice"). Do NOT use non-English terms in search queries. Do NOT use inverted comma syntax (avoid "Egg, whole, cooked").
- CANONICAL COMPONENT DECOMPOSITION: Extract clean, direct canonical English search queries for each component so they are immediately retrievable in USDA. Do NOT guess numeric database IDs.
- PREPARATION FAT & OILS: For any deep-fried, pan-fried, or heavily glazed items, explicitly extract the cooking oil or butter as a separate component (e.g., "Oil, vegetable, canola", "Butter, salted"). Assign it a realistic mass percentage.
- MASS PERCENTAGE OVER VOLUME: When estimating component ratios, strongly prefer estimating 'massPercentage' (weight) over pure 'volumePercentage'.
- REALISTIC SEASONING RATIOS: Salt, baking soda, baking powder, yeast, and dry spices are potent by weight and are never a large share of a recipe's mass. For baked/dough items specifically, salt is typically only 1.5-2% of the flour weight — do NOT assign it a mass percentage anywhere near the flour or liquid components. As a general rule, a single seasoning component should rarely exceed ~2-3% of the total dish mass unless the item is literally a seasoning blend or condiment itself.
- BRAND SEPARATION: When user mentions brand + staples (e.g. "Sainsbury oat + fruit"), apply 'chainName' strictly to the branded item ("Sainsbury oat"). Emit whole companion foods (fruits, drinks, sides) as separate unbranded items.
- COMPONENT DECOMPOSITION (< 15 items): Decompose cooked dishes into raw 'components' (volume % totaling 100%, including oils, dressings, and sauces). Set precise boundingBox2D [ymin, xmin, ymax, xmax].
- PRECISE COUNTING, BAG INSPECTION & OCCLUSION: Inspect inside open pastry bags, boxes, trays, or packaging for stacked, nested, or distinct items (e.g. a croissant resting on a cinnamon swirl/pain aux raisins) before treating a container as a single item. If multiple distinct baked goods or pastries are present, split them into individual items with realistic weights (e.g. Croissant ~65g, Danish/Swirl ~100g) rather than aggregating into an ambiguous category fallback. If grouping identical items, prepend count (e.g., "2 butter croissants").
- COMPACT MODE (>= 15 items): Group high-density menus by category blocks or shelf rows.
- PACKAGE LABELS (HARDENED FOR UK/EU & MULTI-COLUMN FORMATS):
  - PRESERVE BRAND IN COMPONENTS: If the user explicitly mentions a brand name for an ingredient (e.g., "Sainsbury oat"), you MUST preserve that brand name in the component's 'searchQuery' (e.g., "Sainsbury rolled oats" or "Sainsbury oat"). Do not strip the brand name from the component query.
  1. FORCE THE 100G BASELINE: Standard UK/EU nutrition labels always include a "Per 100g" (or "Typical values per 100g") column by law. If multiple columns are present (e.g., "Per 100g" and "Per 1/4 pot" or "Per Serving"), you MUST always extract the "Per 100g" column data for nutrients and set "servingSize" to "100g" in 'rawNutritionLabel'. This completely eliminates the risk of column-hopping and ensures consistent backend scaling calculations.
  2. DEFINE & DEDUCE SERVING WEIGHTS: If you are extracting a portion-based serving size instead of 100g, or if a textual portion size is given, you MUST deduce or calculate the numerical gram weight of that serving size. For example: "If serving size is '1/4 pot' and total weight is 160g, deduce/calculate and output '40g' for the 'servingSize'". Ensure textual portion size descriptions (like "1/4 pack", "1/2 carton", "1 slice") are mapped to their calculated actual gram weight inside 'rawNutritionLabel' so that the backend parser can correctly parse it as a number and prevent macro-overflow anomalies.
  3. If label lists 'Salt', transcribe into 'salt' with "sodium": null for backend conversion.
- SOFT ITEM CALORIE ESTIMATE (REQUIRED for visual food items): For EACH distinct food item (dish), set "estimatedCalories" to a single rough total kcal for the portion you see (the whole item, not each component). Examples: restaurant mac & cheese plate ~550-750; composed salad bowl ~400-600; yogurt granola fruit cup ~300-500. This is a SOFT prior for the server — NOT printed truth. Do NOT put estimatedCalories into rawNutritionLabel. rawNutritionLabel calories remain ONLY for literally printed values. Do NOT invent protein/fat/sodium — only this one calorie number per item plus existing structure fields.
- NAMES: 'keyword', 'searchQuery', and 'queriesToSearch' = clean English USDA queries. 'originalName' = exact local/printed dish name (preserve untranslated brand/local name here only).

=== SYSTEM CONSTRAINTS ===
Output exactly ONE JSON object matching this schema. NEVER omit keys; use null or 'unknown' if inapplicable.

{
  "_internalReasoning": "string",
  "contentType": "visual | menu_or_poster | text",
  "diningEnvironment": "home_cooked | casual_restaurant | fast_food_chain | fine_dining | airline | unknown",
  "items": [
    {
      "keyword": "string",
      "originalName": "string",
      "chainName": "string | null",
      "rawNutritionLabel": { "servingSize": "Perpack", "calories": "90 kcal", "protein": "2g", "totalFat": "0g", "saturatedFat": "0g", "totalCarbohydrate": "22g", "sugar": "17g", "addedSugar": null, "sodium": null, "salt": "0.53g" },
      "ingredientsList": "string | null",
      "estimatedWeightGrams": "number",
      "estimatedCalories": "number",
      "components": [{ "searchQuery": "string", "volumePercentage": "number", "suggestedFdcId": "string | null" }],
      "visualIngredients": ["string"],
      "source": "label | visual",
      "boundingBox2D": [150, 200, 800, 750],
      "sourceImageIndex": 0,
      "nutritionFacts": "{}",
      "anomalyFlags": ["string"],
      "itemConfidence": "High | Medium | Low",
      "cookingMethod": "deep_fried | pan_fried | stir_fried | roasted | boiled | steamed | grilled | baked | raw | unknown"
    }
  ],
  "cookingMethod": "string",
  "scanCompleteness": "full | partial",
  "queriesToSearch": ["string"]
}

[backend] [UnifiedLLM-Prompt:scout] User Prompt:
Analyze the provided image and list the food items you see, taking into consideration the user's message: "I had it at yolk". If any identified dish is a known item from a restaurant chain or brand (e.g. McDonald's, Yolk, Starbucks), capture exact brand and dish name in originalName and queriesToSearch for server web search.
[backend] [UnifiedLLM] Successfully completed content generation. Response length: 3345 chars.
[backend] [UnifiedLLM-Response:scout] Complete response returned from agent:
{
  "_internalReasoning": "The user provided an image showing a meal from YOLK containing a sandwich cut in half, a side of roasted/charred broccoli and cabbage, and a side of roasted baby potatoes. We extract three distinct items: the YOLK sandwich, roasted broccoli, and roasted potatoes. The chain name is Yolk.",
  "items": [
    {
      "keyword": "chicken sandwich with chimichurri sauce",
      "originalName": "YOLK Steak Chimi 2.0 Sandwich",
      "estimatedWeightGrams": 350,
      "boundingBox2D": [108, 287, 477, 888],
      "sourceImageIndex": 0,
      "anomalyFlags": [],
      "chainName": "Yolk",
      "components": [
        {
          "searchQuery": "french bread",
          "volumePercentage": 40
        },
        {
          "searchQuery": "grilled chicken breast",
          "volumePercentage": 35
        },
        {
          "searchQuery": "chimichurri sauce",
          "volumePercentage": 15
        },
        {
          "searchQuery": "cheese",
          "volumePercentage": 10
        }
      ],
      "cookingMethod": "grilled",
      "estimatedCalories": 650,
      "ingredientsList": null,
      "itemConfidence": "High",
      "nutritionFacts": null,
      "rawNutritionLabel": null,
      "source": "visual",
      "visualIngredients": [
        "bread",
        "chicken",
        "chimichurri sauce",
        "cheese"
      ]
    },
    {
      "keyword": "roasted broccoli and cabbage",
      "originalName": "YOLK Roasted Broccoli and Cabbage Side",
      "estimatedWeightGrams": 200,
      "boundingBox2D": [390, 0, 948, 414],
      "sourceImageIndex": 0,
      "anomalyFlags": [],
      "chainName": "Yolk",
      "components": [
        {
          "searchQuery": "broccoli",
          "volumePercentage": 60
        },
        {
          "searchQuery": "cabbage",
          "volumePercentage": 30
        },
        {
          "searchQuery": "olive oil",
          "volumePercentage": 10
        }
      ],
      "cookingMethod": "roasted",
      "estimatedCalories": 120,
      "ingredientsList": null,
      "itemConfidence": "High",
      "nutritionFacts": null,
      "rawNutritionLabel": null,
      "source": "visual",
      "visualIngredients": [
        "broccoli",
        "cabbage",
        "oil"
      ]
    },
    {
      "keyword": "roasted baby potatoes",
      "originalName": "YOLK Roasted Baby Potatoes Side",
      "estimatedWeightGrams": 220,
      "boundingBox2D": [372, 563, 908, 977],
      "sourceImageIndex": 0,
      "anomalyFlags": [],
      "chainName": "Yolk",
      "components": [
        {
          "searchQuery": "potato",
          "volumePercentage": 90
        },
        {
          "searchQuery": "olive oil",
          "volumePercentage": 10
        }
      ],
      "cookingMethod": "roasted",
      "estimatedCalories": 240,
      "ingredientsList": null,
      "itemConfidence": "High",
      "nutritionFacts": null,
      "rawNutritionLabel": null,
      "source": "visual",
      "visualIngredients": [
        "baby potatoes",
        "oil",
        "seasoning"
      ]
    }
  ],
  "contentType": "visual",
  "cookingMethod": "mixed",
  "scanCompleteness": "full",
  "queriesToSearch": [
    "YOLK Steak Chimi 2.0 Sandwich",
    "YOLK roasted broccoli and cabbage",
    "YOLK roasted baby potatoes"
  ],
  "diningEnvironment": "casual_restaurant"
}
[backend] [Volumetric Tuning] Capped high-density condiment "chicken sandwich with chimichurri sauce" to 30g.
[backend] [Mode Override] User explicitly selected 'review' mode via UI pill. Forcing mode to 'new_log'.
[scout_answer] Scout identified 3 item(s): YOLK Steak Chimi 2.0 Sandwich (~30g), YOLK Roasted Broccoli and Cabbage Side (~200g), YOLK Roasted Baby Potatoes Side (~220g)
[backend] [Vision Scout] Exploded high density rows into 3 individual item(s) to process:
[backend] [Vision Scout] - Index: 0 | Name: "YOLK Steak Chimi 2.0 Sandwich" | Keyword: "chicken sandwich with chimichurri sauce" | Confidence: High
[backend] [Vision Scout] - Index: 1 | Name: "YOLK Roasted Broccoli and Cabbage Side" | Keyword: "roasted broccoli and cabbage" | Confidence: High
[backend] [Vision Scout] - Index: 2 | Name: "YOLK Roasted Baby Potatoes Side" | Keyword: "roasted baby potatoes" | Confidence: High
[backend] [ChainSource] Found 2 source(s) for yolk: https://yolk.vmos.io/store/a75aab37-d3ba-4833-9785-c5eb27592d49/menu/category/75c0b3b4-cbd6-4555-9f4f-a67107e715e5/bundles?menuUUID=52e377db-9146-4227-b248-43318643f731 | crowdsourced://ocr/yolk
[db_search] Querying USDA & OpenFoodFacts databases for: [YOLK Steak Chimi 2.0 Sandwich, french bread, grilled chicken breast, chimichurri sauce, cheese, YOLK Roasted Broccoli and Cabbage Side, broccoli, cabbage, olive oil, YOLK Roasted Baby Potatoes Side, potato]
[backend] [Database Search] Performing USDA & OFF searches for queries: ["YOLK Steak Chimi 2.0 Sandwich","french bread","grilled chicken breast","chimichurri sauce","cheese","YOLK Roasted Broccoli and Cabbage Side","broccoli","cabbage","olive oil","YOLK Roasted Baby Potatoes Side","potato"]
[backend] [BrandGuard] Using generic USDA types for "cheese" (not a brand — skip branded/OFF catalog)
[backend] [Database Search Fallback] Zero results for "raw chicken breast". Retrying with loosened query "chicken breast"...
[backend] [Brand DB Match] Found official restaurant/brand menu item for "YOLK Steak Chimi 2.0 Sandwich" -> "Steak Chimi 2.0" (yolk)
[backend] [Brand DB Match] Found official restaurant/brand menu item for "YOLK Steak Chimi 2.0 Sandwich" -> "YOLK Sandwich" (yolk)
[backend] [Brand DB Match] Found official restaurant/brand menu item for "YOLK Steak Chimi 2.0 Sandwich" -> "Steak Frites" (yolk)
[backend] [Brand DB Match] Found official restaurant/brand menu item for "YOLK Steak Chimi 2.0 Sandwich" -> "Steak Béarnaise" (yolk)
[backend] [Brand DB Match] Found official restaurant/brand menu item for "YOLK Steak Chimi 2.0 Sandwich" -> "YOLK Chicken Sandwich" (yolk)
[backend] [Brand DB Match] Found official restaurant/brand menu item for "cheese" -> "Salmon & Cream Cheese Bap" (yolk)
[backend] [Brand DB Match] Found official restaurant/brand menu item for "YOLK Roasted Broccoli and Cabbage Side" -> "Roasted Chicken Side" (yolk)
[backend] [Brand DB Match] Found official restaurant/brand menu item for "YOLK Roasted Broccoli and Cabbage Side" -> "Roasted Side Greens" (yolk)
[backend] [Brand DB Match] Found official restaurant/brand menu item for "YOLK Roasted Broccoli and Cabbage Side" -> "YOLK Chicken Side" (yolk)
[backend] [Brand DB Match] Found official restaurant/brand menu item for "YOLK Roasted Broccoli and Cabbage Side" -> "Roasted New Potatoes" (yolk)
[backend] [Brand DB Match] Found official restaurant/brand menu item for "YOLK Roasted Broccoli and Cabbage Side" -> "Romesco Roast Chicken / "Chicken'esco"" (yolk)
[backend] [Brand DB Match] Found official restaurant/brand menu item for "YOLK Roasted Baby Potatoes Side" -> "YOLK Baby Potatoes" (yolk)
[db_search_complete] Found 18 database match(es) across USDA & OpenFoodFacts.
[backend] [Internal Catalog Hit] Resolved "YOLK Steak Chimi 2.0 Sandwich" from internal catalog without Food Resolver agent gap.
[backend] [Internal Catalog Hit] Resolved "grilled chicken breast" from internal catalog without Food Resolver agent gap.
[backend] [Internal Catalog Hit] Resolved "cheese" from internal catalog without Food Resolver agent gap.
[backend] [Internal Catalog Hit] Resolved "YOLK Roasted Broccoli and Cabbage Side" from internal catalog without Food Resolver agent gap.
[backend] [Internal Catalog Hit] Resolved "cabbage" from internal catalog without Food Resolver agent gap.
[backend] [Internal Catalog Hit] Resolved "olive oil" from internal catalog without Food Resolver agent gap.
[backend] [Food Resolver Skip] Composite multi-component parent dish "YOLK Roasted Baby Potatoes Side" is resolved via its sub-components — skipping monolithic LLM resolver gap.
[status] Dispatched Food Resolver agent for 4 gap items.
[backend] [CuratorCase] Calling LLM Curator with 4 cases
[backend] [UnifiedLLM:food_resolver] Dispatching prompt to model: "gemini-3.5-flash-lite". Contents turns: 1.
[backend] [UnifiedLLM:food_resolver] Attaching 0 image part(s) to model "gemini-3.5-flash-lite".
[backend] [UnifiedLLM-Prompt:food_resolver] System Instruction:
You are the Master Curator of the AI Studio Food Database.
Your mandate is to resolve identity conflicts, deduplicate rows, and normalize data bases.

1. PARAMETRIC USDA MEMORY & ZERO-CANDIDATE GAP RESOLUTION: For standard generic USDA clinical foods (e.g. raw avocado, hard-boiled egg, grilled chicken breast, flour tortilla, falafel, feta cheese, raw onion, raw red pepper):
  a. Output 'parametricFoodName' and supply the standard 6-digit FDC ID in 'parametricFdcId' if you are confident in the canonical USDA record.
  b. If uncertain of the exact 6-digit FDC ID, set 'parametricFdcId' to null, but supply a clean 2-3 word canonical search string in 'parametricFoodName' (e.g., "plain whole milk yogurt" or "granola with mixed nuts"). All standard USDA items are 100g by definition — NEVER emit 'normalize_basis' for USDA or generic commodity items. Do NOT use inverted comma syntax (avoid "Yogurt, plain" or "Cereals, granola").
2. STRICT CASE ISOLATION (ANTI-REUSE RULE): You must resolve each case in the batch independently. Do NOT copy, repeat, or reuse the same 'parametricFdcId' across different food queries unless the queries refer to the exact same ingredient. Repeating FDC IDs across unrelated cases is a severe database defect.
3. CANDIDATE EVALUATION: When parametric ID is not known, select the best candidate ('chosenFdcId') from the provided candidates list.
4. CONFIDENCE & ALIASES: Provide a 'confidence' ('high' | 'medium' | 'low') and list new normalized search aliases in 'aliasesToCreate'. High-confidence aliases are saved permanently. Do NOT create aliases for already canonical names.
5. DUPLICATE MERGING & QUARANTINE: Merge duplicate candidate rows ('merge_duplicates') by picking 1 winner and listing loser IDs. Quarantine impossible or severely mismatched candidates ('quarantine').
6. CATALOG ROUTING & ANTI-COMBINE: Set 'catalogType' to 'commodity' or 'brand'. NEVER combine multiple distinct foods (e.g. 'croissant and pain au raisin') into a single item — decompose conjoined foods into their basic canonical food components for composite meal modeling.
7. ANTI-COMMODITY COLLAPSE RULE: Never map prepared, sweetened, dressed, or processed items (e.g. jam, preserves, seaweed salad, potato salad, mousse, jelly dessert) to raw agricultural single-ingredient commodities (e.g. raw strawberries, raw kelp, raw potato). If no prepared USDA commodity is available, supply a clean canonical preparation search term or set parametricFdcId to null.
8. CRITICAL JSON SYNTAX RULE: Every property key MUST be strictly lowercase and double-quoted in valid JSON format (e.g. "type", "query", "chosenFdcId", "confidence", "reason"). Output a single JSON object {"actions": [...]}.
[backend] [UnifiedLLM-Prompt:food_resolver] User Prompt:
Please curate the following database matches.

CASE 1:
Query: "french bread"
Candidates:
 - (No candidate matches found in database search API)

---
CASE 2:
Query: "chimichurri sauce"
Candidates:
 - (No candidate matches found in database search API)

---
CASE 3:
Query: "broccoli"
Candidates:
 - (No candidate matches found in database search API)

---
CASE 4:
Query: "potato"
Candidates:
 - ID: brand_menu_3a5891c7-1b51-4a58-980d-0d28d294a0e7 | Name: yolk YOLK Baby Potatoes | Source: brand_official
 - ID: brand_menu_4af8c389-950f-4331-a441-8cf6caf2abbd | Name: yolk Roasted New Potatoes | Source: brand_official


Output a strict JSON object of the shape {"actions": [...]} matching the FoodCuratorActionSchema — do NOT output a bare array. Include 'pick_existing', 'merge_duplicates', 'normalize_basis', or 'quarantine' actions as appropriate for each case.
[backend] [UnifiedLLM] Successfully completed content generation. Response length: 1168 chars.
[backend] [UnifiedLLM-Response:food_resolver] Complete response returned from agent:
```json
{
  "actions": [
    {
      "query": "french bread",
      "parametricFoodName": "french bread",
      "parametricFdcId": 172688,
      "catalogType": "commodity",
      "confidence": "high",
      "aliasesToCreate": ["french baguette", "white bread french"]
    },
    {
      "query": "chimichurri sauce",
      "parametricFoodName": "chimichurri sauce",
      "parametricFdcId": null,
      "catalogType": "commodity",
      "confidence": "high",
      "aliasesToCreate": ["chimichurri", "green herb sauce"]
    },
    {
      "query": "broccoli",
      "parametricFoodName": "raw broccoli",
      "parametricFdcId": 170379,
      "catalogType": "commodity",
      "confidence": "high",
      "aliasesToCreate": ["fresh broccoli", "broccoli florets raw"]
    },
    {
      "query": "potato",
      "parametricFoodName": "raw potato",
      "parametricFdcId": 170393,
      "catalogType": "commodity",
      "confidence": "high",
      "aliasesToCreate": ["fresh potato", "raw russet potato"],
      "quarantine": [
        "brand_menu_3a5891c7-1b51-4a58-980d-0d28d294a0e7",
        "brand_menu_4af8c389-950f-4331-a441-8cf6caf2abbd"
      ]
    }
  ]
}
```
[backend] [ParametricVerification] PASSED (high-confidence, priority) for "french bread" -> FDC 172688 ("french bread", overlap: 100%, coreMatch: true)
[backend] [CuratorAction] pick_existing for "french bread" -> 172688 (Reason: Curated action)
[backend] [Backend Fallback Search] Searching USDA for parametricFoodName: "chimichurri sauce" (Original query: "chimichurri sauce")...
[backend] [Backend Fallback Search] No USDA hits found for "chimichurri sauce".
[backend] [CuratorAction] No verified candidate found for "chimichurri sauce".
[backend] [ParametricVerification] PASSED (high-confidence, priority) for "broccoli" -> FDC 170379 ("raw broccoli", overlap: 100%, coreMatch: true)
[backend] [CuratorAction] pick_existing for "broccoli" -> 170379 (Reason: Curated action)
[backend] [ParametricVerification] PASSED (high-confidence, priority) for "potato" -> FDC 170393 ("raw potato", overlap: 100%, coreMatch: true)
[backend] [USDA Title Mismatch] REJECTED: FDC 170393 official USDA description "Carrots, raw" does not match query "potato" (overlap: 0%).
[backend] [DynamicPoisonQuarantine] REJECTED candidate 170393 ("raw potato"). Adding to quarantine.
[backend] [CuratorAction] No verified candidate found for "potato".
[backend] [AliasWrite] Creating alias "french baguette" -> 172688
[backend] [AliasWrite] Creating alias "white bread french" -> 172688
[backend] [AliasWrite] Creating alias "fresh broccoli" -> 170379
[backend] [AliasWrite] Creating alias "broccoli florets raw" -> 170379
[backend] [AliasWrite] Creating alias "broccoli" -> 170379
[backend] [CatalogQuarantine Skip] Protected brand/internal entry brand_menu_3a5891c7-1b51-4a58-980d-0d28d294a0e7 from database purge.
[backend] [CatalogQuarantine Skip] Protected brand/internal entry brand_menu_4af8c389-950f-4331-a441-8cf6caf2abbd from database purge.
[backend] [Quarantine Guard] Ignored global quarantine for catalog/brand ID brand_menu_3a5891c7-1b51-4a58-980d-0d28d294a0e7
[backend] [Quarantine Guard] Ignored global quarantine for catalog/brand ID brand_menu_4af8c389-950f-4331-a441-8cf6caf2abbd
[backend] [Quarantine Sync] Added FDC ID 170393 to quarantinedIdsSet from curator.
[backend] [Food Resolver Integration] Injected resolved nutrients for "french bread" into databaseMatchesArray: {"calories":252,"protein":12.45,"totalFat":3.5,"saturatedFat":0.722,"transFat":0.02,"unsaturatedFat":2.758,"carbohydrates":42.71,"sugar":4.34,"totalFibre":6,"sodium":455,"potassium":254,"magnesium":75,"calcium":161,"iron":2.47,"zinc":1.77,"selenium":25.7,"phosphorus":212,"vitaminD":0,"vitaminB12":0,"folate":42,"vitaminC":0,"vitaminE":2.66,"vitaminK":7.8,"vitaminA":0,"vitaminB6":0.215,"riboflavin":0.167,"niacin":4.438}
[backend] [Quarantine Guard] Ignored global quarantine for catalog/brand ID brand_menu_3a5891c7-1b51-4a58-980d-0d28d294a0e7
[backend] [Quarantine Guard] Ignored global quarantine for catalog/brand ID brand_menu_4af8c389-950f-4331-a441-8cf6caf2abbd
[backend] [Quarantine Guard] Ignored global quarantine for catalog/brand ID brand_menu_3a5891c7-1b51-4a58-980d-0d28d294a0e7
[backend] [Quarantine Guard] Ignored global quarantine for catalog/brand ID brand_menu_4af8c389-950f-4331-a441-8cf6caf2abbd
[backend] [Quarantine Guard] Ignored global quarantine for catalog/brand ID brand_menu_3a5891c7-1b51-4a58-980d-0d28d294a0e7
[backend] [Quarantine Guard] Ignored global quarantine for catalog/brand ID brand_menu_4af8c389-950f-4331-a441-8cf6caf2abbd
[backend] [SelfClean] Complete! Removed 0 unofficial item(s), deleted 0 duplicate(s) across 0 chain(s).
[backend] [Food Resolver Fallback] skip category fallback; non-fallback match exists for "YOLK Steak Chimi 2.0 Sandwich"
[backend] [Food Resolver Fallback] skip category fallback; non-fallback match exists for "grilled chicken breast"
[backend] [Food Resolver Fallback] Created category fallback for gap "chimichurri sauce": {"calories":430,"protein":1.5,"totalFat":45,"saturatedFat":7,"transFat":0,"unsaturatedFat":36,"omega3":0,"carbohydrates":6.5,"sugar":3.5,"addedSugar":2.5,"totalFibre":0.2,"solubleFibre":0,"sodium":850,"potassium":75,"magnesium":5,"calcium":35,"iron":0.3,"zinc":0.2,"selenium":1.5,"iodine":5,"phosphorus":40,"vitaminD":0.1,"vitaminB12":0.1,"folate":6,"vitaminC":0.5,"vitaminE":3.5,"vitaminK":45,"vitaminA":20,"vitaminB6":0.02,"thiamine":0.02,"riboflavin":0.03,"niacin":0.1}
[backend] [Food Resolver Fallback] skip category fallback; non-fallback match exists for "cheese"
[backend] [Food Resolver Fallback] skip category fallback; non-fallback match exists for "YOLK Roasted Broccoli and Cabbage Side"
[backend] [Food Resolver Fallback] Created category fallback for gap "broccoli": {"calories":40,"protein":1,"totalFat":0.2,"saturatedFat":0.05,"transFat":0,"unsaturatedFat":0.15,"omega3":0,"carbohydrates":9,"sugar":6,"addedSugar":0,"totalFibre":2.2,"solubleFibre":0.5,"sodium":10,"potassium":200,"magnesium":15,"calcium":25,"iron":0.5,"zinc":0.2,"selenium":0.5,"iodine":2,"phosphorus":25,"vitaminD":0,"vitaminB12":0,"folate":25,"vitaminC":15,"vitaminE":0.4,"vitaminK":10,"vitaminA":30,"vitaminB6":0.08,"thiamine":0.04,"riboflavin":0.04,"niacin":0.5}
[backend] [Food Resolver Fallback] skip category fallback; non-fallback match exists for "cabbage"
[backend] [Food Resolver Fallback] skip category fallback; non-fallback match exists for "olive oil"
[backend] [Food Resolver Fallback] skip category fallback; non-fallback match exists for "YOLK Roasted Baby Potatoes Side"
[backend] [Food Resolver Fallback] skip category fallback; non-fallback match exists for "potato"
[backend] [Truth Serving Rescale] "YOLK Steak Chimi 2.0 Sandwich": Whole dish/portion basis (per_dish). Keeping truth values unscaled (760 kcal).
[backend] [Thermodynamic Density Gate] BREACH detected for "YOLK Steak Chimi 2.0 Sandwich" (2533.3 kcal/100g > ceiling 250 kcal/100g for category plain_meat_poultry_fish). Flagging DENSITY_ANOMALY_BREACH, stripping brand calorie lock, and falling back to USDA component decomposition.
[backend] [Truth Direct Injection] REJECTED for "YOLK Steak Chimi 2.0 Sandwich" (kcal=760, P=0, C=0, F=0, atwaterDev=100%). Falling back to components/USDA.
[backend] [TruthLock] cleared locks after REJECT for "YOLK Steak Chimi 2.0 Sandwich"
[backend] [Component Resolution Diagnostic] item="YOLK Steak Chimi 2.0 Sandwich" (scoutIndex=0) component[0] query="french bread enriched wheat" -> canonicalMatch=none bestMatch.source=usda bestMatch.id=172688
[backend] [Component Resolution Diagnostic] item="YOLK Steak Chimi 2.0 Sandwich" (scoutIndex=0) component[1] query="grilled chicken breast" -> canonicalMatch="171077" bestMatch.source=internal_catalog bestMatch.id=171077
[backend] [Component Resolution Diagnostic] item="YOLK Steak Chimi 2.0 Sandwich" (scoutIndex=0) component[2] query="chimichurri sauce" -> canonicalMatch=none bestMatch.source=null bestMatch.id=null
[backend] [MatchPriority] Bound direct Curator query match id=brand_menu_28bd36f4-1fe8-4c72-96ff-bd9027a8f983 ("Salmon & Cream Cheese Bap") for component "cheese".
[backend] [Component Resolution Diagnostic] item="YOLK Steak Chimi 2.0 Sandwich" (scoutIndex=0) component[3] query="cheese" -> canonicalMatch=none bestMatch.source=brand_official bestMatch.id=brand_menu_28bd36f4-1fe8-4c72-96ff-bd9027a8f983
[backend] [Component Macro Baseline] "cheese" had 352 kcal but no macros. Applied category macro prior: P=17.6g F=13.7g C=39.6g.
[backend] [Assembly] multi-component rows=4 weightSum=31 itemWeight=30 for "YOLK Steak Chimi 2.0 Sandwich"
[backend] [Assembly] Recomputed primaryBase100g as weighted composite density for "YOLK Steak Chimi 2.0 Sandwich" (was: first-component-only density).
[backend] [PrepPolicy:precalc] "YOLK Steak Chimi 2.0 Sandwich" reason=composite_dish_suppress_top_level_prep cal=0
[backend] [RealityCheck] skipped pre-budget density rescale for soft-budget item "YOLK Steak Chimi 2.0 Sandwich"
[backend] [Budget] item="YOLK Steak Chimi 2.0 Sandwich" kcal=56 source=scout hard=false weight=30 scoutEst=56
[backend] [Foundation] item="YOLK Steak Chimi 2.0 Sandwich" kcal=407.89
[backend] [Reconcile] item="YOLK Steak Chimi 2.0 Sandwich" action=reject_scale foundation=407.89 budget=56 final=407.89 factor=1.000
[backend] [Reconcile] flagged "YOLK Steak Chimi 2.0 Sandwich" FOUNDATION_BUDGET_DIVERGENCE (ratio=7.28)
[backend] [Commercial Sodium Floor] Sodium for seasoned/sauced item "YOLK Steak Chimi 2.0 Sandwich" (102.74000000000001mg) was below baseline floor (1.8mg/kcal). Adjusted sodium to 734mg floor for 407.89 kcal.
[backend] [SatFat Floor] Saturated fat for "YOLK Steak Chimi 2.0 Sandwich" (0.28g) was below commercial/bakery floor (25% of fat). Adjusted sat fat to 3.8g for 15.02g total fat.
[backend] [TruthSkip] multi-component / composite dish "YOLK Roasted Broccoli and Cabbage Side": ignoring single-dish match "YOLK Roasted Broccoli and Cabbage Side" as parent dish truth (use component decomposition + scout budget)
[backend] [MatchPriority] Relevance gate rejected "Roasted Chicken Side" (id=brand_menu_3f52f8eb-081f-4ba4-b4de-dbe27a5b0a20) for query "broccoli" — Blocked meat/seafood candidate ("roasted chicken side") for plain greens/vegetable query ("broccoli").
[backend] [Component Resolution Diagnostic] item="YOLK Roasted Broccoli and Cabbage Side" (scoutIndex=1) component[0] query="broccoli" -> canonicalMatch=none bestMatch.source=null bestMatch.id=null
[backend] [MatchPriority] Bound direct Curator query match id=170420 ("cabbage") for component "cabbage".
[backend] [Component Resolution Diagnostic] item="YOLK Roasted Broccoli and Cabbage Side" (scoutIndex=1) component[1] query="cabbage" -> canonicalMatch="170420" bestMatch.source=internal_catalog bestMatch.id=170420
[backend] [Component Resolution Diagnostic] item="YOLK Roasted Broccoli and Cabbage Side" (scoutIndex=1) component[2] query="olive oil" -> canonicalMatch="1103091" bestMatch.source=internal_catalog bestMatch.id=1103091
[backend] [Assembly] multi-component rows=3 weightSum=200 itemWeight=200 for "YOLK Roasted Broccoli and Cabbage Side"
[backend] [Assembly] Recomputed primaryBase100g as weighted composite density for "YOLK Roasted Broccoli and Cabbage Side" (was: first-component-only density).
[backend] [PrepPolicy:precalc] "YOLK Roasted Broccoli and Cabbage Side" reason=composite_dish_suppress_top_level_prep cal=0
[backend] [RealityCheck] skipped pre-budget density rescale for soft-budget item "YOLK Roasted Broccoli and Cabbage Side"
[backend] [Budget] item="YOLK Roasted Broccoli and Cabbage Side" kcal=120 source=scout hard=false weight=200 scoutEst=120
[backend] [Foundation] item="YOLK Roasted Broccoli and Cabbage Side" kcal=92
[backend] [Reconcile] item="YOLK Roasted Broccoli and Cabbage Side" action=keep foundation=92 budget=120 final=92 factor=1.000
[backend] [Truth Serving Rescale] "YOLK Roasted Baby Potatoes Side": Whole dish/portion basis (per_dish). Keeping truth values unscaled (150 kcal).
[backend] [OCR Broadcast Detector] COLLISION DETECTED: "Roasted New Potatoes" shares unverified OCR calorie count (150 kcal) with distinct items in brand menu. Suppressing locked truth status.
[backend] [Truth Direct Injection] REJECTED for "YOLK Roasted Baby Potatoes Side" (kcal=150, P=0, C=0, F=0, atwaterDev=100%). Falling back to components/USDA.
[backend] [TruthLock] cleared locks after REJECT for "YOLK Roasted Baby Potatoes Side"
[backend] [Component Resolution Diagnostic] item="YOLK Roasted Baby Potatoes Side" (scoutIndex=2) component[0] query="potato" -> canonicalMatch=none bestMatch.source=brand_official bestMatch.id=brand_menu_3a5891c7-1b51-4a58-980d-0d28d294a0e7
[backend] [Component Macro Baseline] "potato" had 150 kcal but no macros. Applied category macro prior: P=7.5g F=5.8g C=16.9g.
[backend] [Component Resolution Diagnostic] item="YOLK Roasted Baby Potatoes Side" (scoutIndex=2) component[1] query="olive oil" -> canonicalMatch="1103091" bestMatch.source=internal_catalog bestMatch.id=1103091
[backend] [Assembly] multi-component rows=2 weightSum=220 itemWeight=220 for "YOLK Roasted Baby Potatoes Side"
[backend] [Assembly] Recomputed primaryBase100g as weighted composite density for "YOLK Roasted Baby Potatoes Side" (was: first-component-only density).
[backend] [PrepPolicy:precalc] "YOLK Roasted Baby Potatoes Side" reason=composite_dish_suppress_top_level_prep cal=0
[backend] [RealityCheck] skipped pre-budget density rescale for soft-budget item "YOLK Roasted Baby Potatoes Side"
[backend] [Budget] item="YOLK Roasted Baby Potatoes Side" kcal=240 source=scout hard=false weight=220 scoutEst=240
[backend] [Foundation] item="YOLK Roasted Baby Potatoes Side" kcal=175.3
[backend] [Reconcile] item="YOLK Roasted Baby Potatoes Side" action=keep foundation=175.3 budget=240 final=175.3 factor=1.000
[backend] [Commercial Sodium Floor] Sodium for seasoned/sauced item "YOLK Roasted Baby Potatoes Side" (161.7mg) was below baseline floor (1.8mg/kcal). Adjusted sodium to 316mg floor for 175.3 kcal.
[backend] [SatFat Floor] Saturated fat for "YOLK Roasted Baby Potatoes Side" (0.31g) was below commercial/bakery floor (25% of fat). Adjusted sat fat to 2g for 8.15g total fat.
[backend] [State Isolation] New image scan or new_log mode detected. Isolating activeMeal context so Dietitian operates on clean state.
[backend] [Dietitian Coach] Sending nutrition analysis request to Gemini...
[backend] [MealBuild] projector dietitian
[backend] [MealBuild] stage dietitian started
[backend] [MealBuild] projector dietitian applied
[dietitian_instruction] Dietitian System Instruction & Patient Biomarkers payload dispatched (model: gemini-3.5-flash-lite).
[backend] [UnifiedLLM:dietitian] Dispatching prompt to model: "gemini-3.5-flash-lite". Contents turns: 1.
[backend] [UnifiedLLM:dietitian] Attaching 0 image part(s) to model "gemini-3.5-flash-lite".
[backend] [UnifiedLLM-Prompt:dietitian] System Instruction:

You are a Dietician coach operating within a personalized health application. Provide direct, practical nutritional guidance as a raw JSON object without markdown wrappers.

=== GENERAL RULES ===
- Do not recite raw macro lists. 
- Keep next steps focused on practical real-food habits or movement (not future gram targets).
- When discussing sugar, always distinguish Total Sugar (naturally occurring, e.g. fructose in fruit, lactose in dairy) from Added Sugar (the only figure with a 24g/day guideline). Do not flag naturally high-sugar whole foods (fruit, vegetables, plain dairy) as a sugar concern — only flag genuinely high Added Sugar intake.

=== VERDICT LABEL GUIDELINES (3-6 WORDS MAX) ===
- Positive/Neutral Choice: Focus on a core physical health outcome. Example: "Good for your heart", "Boosts lean muscle tissue".
- Overage/Risk Choice: Focus strictly on a punchy, metric-backed impact label. Example: "140% over sat fat limit", "115% over sodium limit".
- BANNED: Never use vague descriptive sentences like "Elevates saturated fat and sodium limits" or "High saturated fat warning". Keep it punchy and metric-backed.

=== MESSAGE NARRATIVE GUIDELINES (35-70 WORDS IN 4 BEATS) ===
You MUST write the "message" narrative strictly using a 4-beat structure:
- Beat 1 (Primary Asset & Metric): Praise the meal's key nutrient asset using specific, concrete metrics. Example: "You got 53g of quality protein and healthy omega-3s from the salmon."
- Beat 2 (Impact/Overage & Metric): Highlight any overage/impact using exact, concrete metrics and percentages, using the pre-calculated overage percentages already provided in the NUTRITIONAL TARGET STATUS section above — do not calculate percentages yourself. Example: "However, the cheesy pasta adds 18g of saturated fat, pushing today's total 140% over your daily limit."
- Beat 3 (Symptom-Based Physical Effect): Translate abstract clinical or cholesterol jargon into a relatable immediate physical sensation or feeling. Example: "This heavy fat load causes physical sluggishness, digestive heaviness, and vascular stiffness." (BANNED: "temporarily burdens your cardiovascular system" or "impacts your lipid biomarkers").
- Beat 4 (Actionable Next Steps): Recommend a direct physical action or habit to mitigate the impact. Example: "Take a 20-minute post-meal walk to boost circulation, and make your next meal rich in soluble fiber like lentils or greens."

=== FULLY COMPLIANT FEW-SHOT EXAMPLE ===
{
  "_internalReasoning": "The user logged a meal with grilled salmon, macaroni and cheese, avocado, and lettuce. The salmon offers excellent lean protein and heart-healthy omega-3s, but the mac and cheese is highly concentrated in saturated fat and sodium. Given their high cholesterol and overweight status, I will frame this as an overage, using the pre-calculated 140% over figure from the NUTRITIONAL TARGET STATUS section for the exact 18g of saturated fat, explaining the physical feeling of vascular stiffness, and guiding a post-meal walk.",
  "verdict": {
    "label": "140% over sat fat limit",
    "level": "alert"
  },
  "message": "You got 53g of quality protein and healthy omega-3s from the salmon. However, the cheesy pasta adds 18g of saturated fat, pushing today's total 140% over your daily limit. This heavy fat load causes physical sluggishness, digestive heaviness, and vascular stiffness. Take a 20-minute post-meal walk to boost circulation, and make your next meal rich in soluble fiber like lentils or greens.",
  "foodData": {
    "date": "2026-08-03",
    "name": "Grilled Salmon with Macaroni and Cheese, Avocado, and Lettuce",
    "itemsBreakdown": [
      {
        "scoutIndex": 0,
        "canonicalDbName": "Macaroni and Cheese, frozen entree",
        "weightGrams": 220,
        "dbSource": "usda",
        "dbId": "173342",
        "foodType": "prepared dish/entree",
        "cookingMethod": "baked"
      },
      {
        "scoutIndex": 1,
        "canonicalDbName": "Fish, salmon, Atlantic, farmed, cooked, dry heat",
        "weightGrams": 150,
        "dbSource": "estimated",
        "dbId": null,
        "foodType": "protein",
        "cookingMethod": "grilled"
      },
      {
        "scoutIndex": 2,
        "canonicalDbName": "Avocado, Hass, peeled, raw",
        "weightGrams": 90,
        "dbSource": "usda",
        "dbId": "2710824",
        "foodType": "fruit/fat source",
        "cookingMethod": "raw"
      },
      {
        "scoutIndex": 3,
        "canonicalDbName": "Lettuce, iceberg, raw",
        "weightGrams": 30,
        "dbSource": "usda",
        "dbId": "2346388",
        "foodType": "vegetable",
        "cookingMethod": "raw"
      }
    ]
  }
}


=== PATIENT CONTEXT PAYLOAD ===
CRITICAL PATIENT BIOMARKER WARNINGS & NUTRITIONAL DIRECTIVES:
• None

=== NUTRITIONAL TARGET STATUS ===
No 7-day history available yet.
Todays target: Sat fat (0/15g), Calorie (0/1651kcal), Sodium (0/1200mg), Protein (0/90g), Carbohydrates (0/160g), Total Fibre (0/10g), Potassium (0/3500mg), Soluble Fibre (0/10g), Added Sugar (0/20g), Trans Fat (0g)

=== ACTIVE TASK: NEW FOOD LOGGING ===
DEFAULT TO CONSUMPTION: Process the identified food logs and visual scout items as a consumed meal. Provide constructive, warm clinical analysis on today's target fit.


=== REQUIRED OUTPUT JSON SCHEMA ===
{
  "_internalReasoning": "string (Silently synthesize clinical evidence and plan response structure)",
  "verdict": {
    "label": "string (3-6 words max. Positive: Core health outcome e.g. 'Good for your heart'. Overage: Primary metric/impact e.g. '140% over sat fat limit')",
    "level": "string ('good' | 'warning' | 'alert' | 'neutral')"
  },
  "message": "string (35-70 words in 4 beats: 1. Key Value w/ selective metric -> 2. Impact/Overage w/ selective metric if applicable -> 3. Symptom-based physical effect -> 4. Next Action: MITIGATION if overage occurred [walk/water/fiber], or CONTINUATION/GAP-FILLING if on-track [fill missing target])",
  "foodData": {
    "date": "string (YYYY-MM-DD)",
    "name": "string (Meal title. Must match the singular/plural form of each item exactly as it appears in that item's own itemsBreakdown entry below — e.g. if itemsBreakdown lists a single item as 'Croissant', the title must say 'Croissant', not 'Croissants', and vice versa.)",
    "itemsBreakdown": [
      {
        "scoutIndex": 0,
        "canonicalDbName": "string (strictly standard database/product name, 2-5 words maximum. No reasoning/scaling/notes)",
        "weightGrams": 0,
        "dbSource": "string ('usda' | 'label' | 'estimated')",
        "dbId": "string | null",
        "foodType": "string (strictly concise 1-2 words category e.g. 'grain', 'protein', 'vegetable', 'fruit', 'dairy'. No sentences, no explanations, no explanations of calculations, no justifications)",
        "cookingMethod": "string (strictly 1-2 words concise method e.g. 'raw', 'baked', 'grilled', 'boiled'. No justifications)"
      }
    ]
  },
  "comparison": {
    "comparisonTitle": "string (e.g. 'Nutrients of Concern')",
    "groups": [
      {
        "groupName": "string (Descriptive group name or option title e.g. 'Tier 1 - Safest Choice' or 'Sainsbury Scottish Oats')",
        "scoutItemIndices": [0],
        "verdict": {
          "label": "string (3-6 words max. Positive: Core health outcome e.g. 'Good for your heart'. Overage: Primary metric/impact e.g. '140% over sat fat limit')",
          "level": "string ('good' | 'warning' | 'alert' | 'neutral')"
        },
        "message": "string (35-70 words in 4 beats: 1. Key Value w/ selective metric -> 2. Impact/Overage w/ selective metric if applicable -> 3. Symptom-based physical effect -> 4. Next Action: MITIGATION if overage occurred [walk/water/fiber], or CONTINUATION/GAP-FILLING if on-track [fill missing target])",
        "averageNutrients": {
          "calories": 0,
          "protein": 0,
          "totalFat": 0,
          "saturatedFat": 0,
          "sodium": 0,
          "carbohydrates": 0,
          "addedSugar": 0,
          "potassium": 0,
          "totalFibre": 0
        }
      }
    ]
  }
}

[backend] [UnifiedLLM-Prompt:dietitian] User Prompt:
Analyze this current food request.

USER DIETARY PROFILE & DEMOGRAPHICS:
- Age: 28 years old
- Gender: Male
- Weight: 70 kg
- Height: 175 cm
- Ethnicity: Chinese



CURRENT TIME CONTEXT: 2026-08-23 9:20:39 PM
CRITICAL INSTRUCTION: You MUST use "2026-08-23" in the "date" field of "foodData" unless the user explicitly provides a different date in the chat.


[Context: An image is uploaded and attached above. If it is a close-up of a printed Nutrition Facts label, read its exact printed values and stated serving size, then scale them to the actual weight/quantity consumed; otherwise rely on visual cues for portion sizing, ingredients, and freshness.]

[CRITICAL DATE OVERRIDE: The uploaded image was taken on 2026-08-17T14:53:06.000Z. You MUST use this exact date or its nearest YYYY-MM-DD representation as the "date" field in "foodData", completely overriding the CURRENT TIME CONTEXT, unless the user explicitly asks otherwise.]


=== VISUAL FOOD SCOUT IDENTIFIED ITEMS ===
- Index: 0 | Scout Item: "chicken sandwich with chimichurri sauce" | Weight: 30g | Observed/Local Context: "YOLK Steak Chimi 2.0 Sandwich"
- Index: 1 | Scout Item: "roasted broccoli and cabbage" | Weight: 200g | Observed/Local Context: "YOLK Roasted Broccoli and Cabbage Side"
- Index: 2 | Scout Item: "roasted baby potatoes" | Weight: 220g | Observed/Local Context: "YOLK Roasted Baby Potatoes Side"
Content Type: visual (3 items identified)
Visual Scout Confidence Rating: High (>90%)
Identified Cooking Method & Preparation/Seasonings: mixed
diningEnvironment: casual_restaurant


=== BACKEND PRE-CALCULATED ITEM NUTRIENTS ===
=== BACKEND PRE-CALCULATED ITEM NUTRIENTS (Absolute Truth) ===
- "YOLK Steak Chimi 2.0 Sandwich" (30g):
  Calories: 408 kcal
  Protein: 22.55g
  Fat: 15.02g (Saturated: 3.8g)
  Carbs: 45.480000000000004g (Sugar: 0.7g, Added Sugar: 0.25g)
  Sodium: 734mg

- "YOLK Roasted Broccoli and Cabbage Side" (200g):
  Calories: 92 kcal
  Protein: 2.08g
  Fat: 2.5g (Saturated: 0.36000000000000004g)
  Carbs: 16.560000000000002g (Sugar: 9.48g, Added Sugar: 0g)
  Sodium: 172.2mg

- "YOLK Roasted Baby Potatoes Side" (220g):
  Calories: 175 kcal
  Protein: 7.68g
  Fat: 8.15g (Saturated: 2g)
  Carbs: 18.29g (Sugar: 0g, Added Sugar: 0g)
  Sodium: 316mg




=== VERIFIED DATABASE MATCHES ===
- [Brand Menu (Official)] Chain: yolk | Item: Steak Chimi 2.0 | Calories: 760 | P: n/a | C: n/a | F: n/a | Source: brand_official
- [Brand Menu (Official)] Chain: yolk | Item: YOLK Sandwich | Calories: 783 | P: n/a | C: n/a | F: n/a | Source: brand_official
- [Brand Menu (Official)] Chain: yolk | Item: Steak Frites | Calories: 810 | P: n/a | C: n/a | F: n/a | Source: brand_official
- [Brand Menu (Official)] Chain: yolk | Item: Steak Béarnaise | Calories: 793 | P: n/a | C: n/a | F: n/a | Source: brand_official
- [Brand Menu (Official)] Chain: yolk | Item: YOLK Chicken Sandwich | Calories: 783 | P: 0g | C: 0g | F: 0g | Source: brand_official
- [Brand Menu (Official)] Chain: yolk | Item: Salmon & Cream Cheese Bap | Calories: 352 | P: n/a | C: n/a | F: n/a | Source: brand_official
- [Brand Menu (Official)] Chain: yolk | Item: Roasted Chicken Side | Calories: 240 | P: n/a | C: n/a | F: n/a | Source: brand_official
- [Brand Menu (Official)] Chain: yolk | Item: Roasted Side Greens | Calories: 66 | P: n/a | C: n/a | F: n/a | Source: brand_official
- [Brand Menu (Official)] Chain: yolk | Item: YOLK Chicken Side | Calories: 783 | P: n/a | C: n/a | F: n/a | Source: brand_official
- [Brand Menu (Official)] Chain: yolk | Item: Roasted New Potatoes | Calories: 150 | P: n/a | C: n/a | F: n/a | Source: brand_official
- [Brand Menu (Official)] Chain: yolk | Item: Romesco Roast Chicken / "Chicken'esco" | Calories: 803 | P: n/a | C: n/a | F: n/a | Source: brand_official
- [Brand Menu (Official)] Chain: yolk | Item: YOLK Baby Potatoes | Calories: 150 | P: n/a | C: n/a | F: n/a | Source: brand_official

Current User Input: "I had it at yolk"

[SERVER PRECALC — use only these numbers; do not invent macros]
mealId=xr53944
mealName=YOLK Steak Chimi 2.0 Sandwich
macroTotals={"calories":675.2,"protein":32.3,"totalFat":25.7,"saturatedFat":6.2,"transFat":0,"unsaturatedFat":17.6,"omega3":0,"carbohydrates":80.3,"sugar":10.2,"addedSugar":0.3,"totalFibre":6.1,"solubleFibre":0.6,"sodium":1222.2,"potassium":420.8,"magnesium":30.4,"calcium":73.7,"iron":1.3,"zinc":0.6,"selenium":3.8,"iodine":2.7,"phosphorus":57.4,"vitaminD":0,"vitaminB12":0,"folate":35.3,"vitaminC":36,"vitaminE":1,"vitaminK":15.2,"vitaminA":37,"vitaminB6":0.1,"thiamine":0.1,"riboflavin":0.1,"niacin":1.1}
itemsSummary=[{"name":"YOLK Steak Chimi 2.0 Sandwich","weightGrams":30,"calories":407.89,"protein":22.55,"carbs":45.480000000000004},{"name":"YOLK Roasted Broccoli and Cabbage Side","weightGrams":200,"calories":92,"protein":2.08,"carbs":16.560000000000002},{"name":"YOLK Roasted Baby Potatoes Side","weightGrams":220,"calories":175.3,"protein":7.68,"carbs":18.29}]
[backend] [UnifiedLLM] Successfully completed content generation. Response length: 1779 chars.
[backend] [UnifiedLLM-Response:dietitian] Complete response returned from agent:
{
  "_internalReasoning": "The user logged a meal from Yolk consisting of a steak chimi sandwich, roasted broccoli and cabbage, and roasted baby potatoes. The meal provides 32.3g of protein and fiber from the veggies, but the sodium reaches 1222.2mg, pushing the sodium target over by 101%. I will formulate the verdict and 4-beat message following all strict rules, using the exact override date 2026-08-17.",
  "verdict": {
    "label": "101% over sodium limit",
    "level": "alert"
  },
  "message": "You got 32.3g of quality protein and fiber from the roasted vegetables. However, the restaurant sandwich and sides add 1222.2mg of sodium, pushing today's total 101% over your daily limit. This high sodium load causes temporary fluid retention, increased thirst, and mild blood vessel constriction. Drink an extra glass of water to support electrolyte balance, and keep your upcoming meals light and low in salt.",
  "foodData": {
    "date": "2026-08-17",
    "name": "YOLK Steak Chimi 2.0 Sandwich with Roasted Broccoli and Cabbage Side and Roasted Baby Potatoes Side",
    "itemsBreakdown": [
      {
        "scoutIndex": 0,
        "canonicalDbName": "YOLK Steak Chimi 2.0 Sandwich",
        "weightGrams": 30,
        "dbSource": "estimated",
        "dbId": null,
        "foodType": "prepared dish/entree"
      },
      {
        "scoutIndex": 1,
        "canonicalDbName": "YOLK Roasted Broccoli and Cabbage Side",
        "weightGrams": 200,
        "dbSource": "estimated",
        "dbId": null,
        "foodType": "vegetable"
      },
      {
        "scoutIndex": 2,
        "canonicalDbName": "YOLK Roasted Baby Potatoes Side",
        "weightGrams": 220,
        "dbSource": "estimated",
        "dbId": null,
        "foodType": "grain"
      }
    ]
  }
}
[backend] [Dietitian Coach] Received response from Gemini. Length: 1779 chars.
[backend] [Dietitian Internal Reasoning]
The user logged a meal from Yolk consisting of a steak chimi sandwich, roasted broccoli and cabbage, and roasted baby potatoes. The meal provides 32.3g of protein and fiber from the veggies, but the sodium reaches 1222.2mg, pushing the sodium target over by 101%. I will formulate the verdict and 4-beat message following all strict rules, using the exact override date 2026-08-17.
[backend] [First-Principles Injection] Injecting deterministic backend nutrients for "YOLK Steak Chimi 2.0 Sandwich" (scoutIndex=0, dbSource=composite, dbId=composite_0).
[backend] [First-Principles Injection] Injecting deterministic backend nutrients for "YOLK Roasted Broccoli and Cabbage Side" (scoutIndex=1, dbSource=composite, dbId=composite_1).
[backend] [First-Principles Injection] Injecting deterministic backend nutrients for "YOLK Roasted Baby Potatoes Side" (scoutIndex=2, dbSource=composite, dbId=composite_2).
[backend] [Nutrient] "YOLK Steak Chimi 2.0 Sandwich" multi-component aggregation. raw100={"calories":1359.633,"protein":75.167,"totalFat":50.067,"saturatedFat":12.667,"transFat":0,"unsaturatedFat":37.4,"omega3":0,"carbohydrates":151.6,"sugar":2.333,"addedSugar":0.833,"totalFibre":2.4,"solubleFibre":0,"sodium":2446.667,"potassium":203.8,"magnesium":41.467,"calcium":75.733,"iron":1.4,"zinc":1.1,"selenium":10.533,"iodine":0.833,"phosphorus":91.467,"vitaminD":0.033,"vitaminB12":0.033,"folate":17.8,"vitaminC":0.1,"vitaminE":1.667,"vitaminK":10.633,"vitaminA":3.333,"vitaminB6":0.1,"thiamine":0,"riboflavin":0.067,"niacin":1.8}, baseW=30, baseFactor=0.3
[backend] [Nutrient] "YOLK Steak Chimi 2.0 Sandwich" computed DETERMINISTICALLY by summing components: Cal=408, Protein=22.6, Fat=15, SatFat=3.8, Sodium=734, AddedSugar=0, TotalFibre=0.7
[backend] [Dietitian Reality Check] Sodium for "YOLK Steak Chimi 2.0 Sandwich" (734mg) was unrealistically high for a non-cured item. Reality check adjusted sodium from 734mg to 120mg.
[backend] [Commercial Sodium Floor] Sodium for seasoned/sauced item "YOLK Steak Chimi 2.0 Sandwich" (120mg) was below baseline floor (1.8mg/kcal). Adjusted sodium to 734mg floor for 408 kcal.
[backend] [Sparse Micronutrient Backfill] "YOLK Steak Chimi 2.0 Sandwich": backfilled 18 micronutrient(s) from category profile for "yolk steak chimi 2.0 sandwich chicken sandwich with chimichurri sauce yolk steak chimi 2.0 sandwich".
[backend] [Dietitian Reality Check] Protein for "YOLK Steak Chimi 2.0 Sandwich" (22.6g) exceeded 45g/100g ceiling. Capped to 13.5g.
[backend] [Dietitian Reality Check] Caloric density for "YOLK Steak Chimi 2.0 Sandwich" (1360 kcal/100g) was implausible for category "compound_dish" (expected ~80-550 kcal/100g). Rescaled 408 kcal -> 95 kcal for 30g.
[backend] [Nutrient] "YOLK Steak Chimi 2.0 Sandwich" trace-20 computed from authentic DB nutrients with fallback.
[backend] [Nutrient] "YOLK Roasted Broccoli and Cabbage Side" multi-component aggregation. raw100={"calories":46,"protein":1.04,"totalFat":1.25,"saturatedFat":0.18,"transFat":0,"unsaturatedFat":0.09,"omega3":0,"carbohydrates":8.28,"sugar":4.74,"addedSugar":0,"totalFibre":2.36,"solubleFibre":0.3,"sodium":86.1,"potassium":175.2,"magnesium":9,"calcium":25.5,"iron":0.45,"zinc":0.12,"selenium":0.3,"iodine":1.2,"phosphorus":15,"vitaminD":0,"vitaminB12":0,"folate":15,"vitaminC":18,"vitaminE":0.24,"vitaminK":6,"vitaminA":18,"vitaminB6":0.05,"thiamine":0.025,"riboflavin":0.025,"niacin":0.3}, baseW=200, baseFactor=2
[backend] [Nutrient] "YOLK Roasted Broccoli and Cabbage Side" computed DETERMINISTICALLY by summing components: Cal=92, Protein=2.1, Fat=2.5, SatFat=0.4, Sodium=172, AddedSugar=0, TotalFibre=4.7
[backend] [Sparse Micronutrient Backfill] "YOLK Roasted Broccoli and Cabbage Side": backfilled 18 micronutrient(s) from category profile for "yolk roasted broccoli and cabbage side roasted broccoli and cabbage yolk roasted broccoli and cabbage side".
[backend] [Nutrient] "YOLK Roasted Broccoli and Cabbage Side" trace-20 computed from authentic DB nutrients with fallback.
[backend] [Nutrient] "YOLK Roasted Baby Potatoes Side" multi-component aggregation. raw100={"calories":79.682,"protein":3.491,"totalFat":3.705,"saturatedFat":0.909,"transFat":0,"carbohydrates":8.314,"sugar":0,"totalFibre":0.318,"sodium":143.636,"potassium":4.2,"unsaturatedFat":2.795,"omega3":0,"addedSugar":0,"solubleFibre":0,"magnesium":0,"calcium":0,"iron":0,"zinc":0,"selenium":0,"iodine":0,"phosphorus":0,"vitaminD":0,"vitaminB12":0,"folate":0,"vitaminC":0,"vitaminE":0,"vitaminK":0,"vitaminA":0,"vitaminB6":0,"thiamine":0,"riboflavin":0,"niacin":0}, baseW=220, baseFactor=2.2
[backend] [Nutrient] "YOLK Roasted Baby Potatoes Side" computed DETERMINISTICALLY by summing components: Cal=175, Protein=7.7, Fat=8.2, SatFat=2, Sodium=316, AddedSugar=0, TotalFibre=0.7
[backend] [SatFat Floor] Saturated fat for "YOLK Roasted Baby Potatoes Side" (2g) was below commercial/bakery floor (25% of fat). Adjusted sat fat to 2.1g for 8.2g total fat.
[backend] [Sparse Micronutrient Backfill] "YOLK Roasted Baby Potatoes Side": backfilled 18 micronutrient(s) from category profile for "yolk roasted baby potatoes side roasted baby potatoes yolk roasted baby potatoes side".
[backend] [Nutrient] "YOLK Roasted Baby Potatoes Side" trace-20 computed from authentic DB nutrients with fallback.
[dietitian_answer] You got 32.3g of quality protein and fiber from the roasted vegetables. However, the restaurant sandwich and sides add 1222.2mg of sodium, pushing today's total 101% over your daily limit. This high sodium load causes temporary fluid retention, increased thirst, and mild blood vessel constriction. Drink an extra glass of water to support electrolyte balance, and keep your upcoming meals light and low in salt.
[backend] [Nutrient Final Check] "YOLK Steak Chimi 2.0 Sandwich" finalItemNutrients: {"calories":95,"protein":3.1,"totalFat":3.5,"saturatedFat":0.9,"transFat":0,"unsaturatedFat":2.6,"omega3":0.01,"carbohydrates":10.6,"sugar":0.2,"addedSugar":0.2,"totalFibre":0.7,"solubleFibre":0.14,"sodium":734,"potassium":61,"magnesium":12.4,"calcium":22.7,"iron":0.42,"zinc":0.33,"selenium":3.16,"iodine":0.25,"phosphorus":27.4,"vitaminD":0.01,"vitaminB12":0.01,"folate":5.34,"vitaminC":0.03,"vitaminE":0.5,"vitaminK":3.19,"vitaminA":1,"vitaminB6":0.03,"thiamine":0.01,"riboflavin":0.02,"niacin":0.54}
[backend] [Nutrient Final Check] "YOLK Roasted Broccoli and Cabbage Side" finalItemNutrients: {"calories":92,"protein":2.1,"totalFat":2.5,"saturatedFat":0.4,"transFat":0,"unsaturatedFat":2.1,"omega3":0.1,"carbohydrates":16.6,"sugar":9.5,"addedSugar":0,"totalFibre":4.7,"solubleFibre":0.6,"sodium":172,"potassium":350,"magnesium":18,"calcium":51,"iron":0.9,"zinc":0.24,"selenium":0.6,"iodine":2.4,"phosphorus":30,"vitaminD":0,"vitaminB12":0.4,"folate":30,"vitaminC":36,"vitaminE":0.48,"vitaminK":12,"vitaminA":36,"vitaminB6":0.1,"thiamine":0.05,"riboflavin":0.05,"niacin":0.6}
[backend] [Nutrient Final Check] "YOLK Roasted Baby Potatoes Side" finalItemNutrients: {"calories":175,"protein":7.7,"totalFat":8.2,"saturatedFat":2.1,"transFat":0,"unsaturatedFat":6.1,"omega3":0.04,"carbohydrates":18.3,"sugar":0,"addedSugar":0,"totalFibre":0.7,"solubleFibre":0.17,"sodium":316,"potassium":9,"magnesium":55,"calcium":22,"iron":1.76,"zinc":1.54,"selenium":17.6,"iodine":4.4,"phosphorus":132,"vitaminD":0,"vitaminB12":0,"folate":77,"vitaminC":0,"vitaminE":0.22,"vitaminK":0.44,"vitaminA":0,"vitaminB6":0.22,"thiamine":0.33,"riboflavin":0.07,"niacin":3.3}
[backend] [AutoChainRegister] REJECTED unofficial/computed item "YOLK Steak Chimi 2.0 Sandwich" for chain "Yolk": Item has 4 decomposed sub-components
[backend] [AutoChainRegister] REJECTED unofficial/computed item "YOLK Roasted Broccoli and Cabbage Side" for chain "Yolk": Item has 3 decomposed sub-components
[backend] [AutoChainRegister] REJECTED unofficial/computed item "YOLK Roasted Baby Potatoes Side" for chain "Yolk": Item has 2 decomposed sub-components
[backend] [Receipt] using preCalc multi-row n=4 for "YOLK Steak Chimi 2.0 Sandwich": [USDA #172688](https://fdc.nal.usda.gov/food-details/172688/nutrients) (french bread)(id=172688,cal=30.2), 📖 [grilled chicken breast](https://fdc.nal.usda.gov/fdc-app.html#/food-details/171077/nutrients)(id=171077,cal=18.1), Estimated chimichurri sauce(id=estimated_comp_0_2,cal=7.5), Salmon & Cream Cheese Bap(id=brand_menu_28bd36f4-1fe8-4c72-96ff-bd9027a8f983,cal=352)
[backend] [PrepPolicy:receipt] "YOLK Steak Chimi 2.0 Sandwich" reason=composite_dish_suppress_top_level_prep cal=0
[backend] [Airline Multiplier Diagnostic] item="YOLK Steak Chimi 2.0 Sandwich" diningEnvironment="casual_restaurant" hasCookingAdded=true cookingNa=0
[backend] [Atwater Check] "YOLK Steak Chimi 2.0 Sandwich": macros (P=5.2g C=45.5g F=3.5g -> 234 kcal) don't reconcile with stated 95 kcal (147% deviation). Rescaling macros to match stated calories: P=2.1g C=18.4g F=1.4g.
[backend] [Dietitian Reality Check] Sodium for "YOLK Steak Chimi 2.0 Sandwich" (734mg) was unrealistically high for a non-cured item. Reality check adjusted sodium from 734mg to 120mg.
[backend] [Commercial Sodium Floor] Sodium for seasoned/sauced item "YOLK Steak Chimi 2.0 Sandwich" (120mg) was below baseline floor (1.8mg/kcal). Adjusted sodium to 171mg floor for 95 kcal.
[backend] [SatFat Floor] Saturated fat for "YOLK Steak Chimi 2.0 Sandwich" (0g) was below commercial/bakery floor (25% of fat). Adjusted sat fat to 0.4g for 1.4g total fat.
[backend] [Sparse Micronutrient Backfill] "YOLK Steak Chimi 2.0 Sandwich": backfilled 19 micronutrient(s) from category profile for "yolk steak chimi 2.0 sandwich chicken sandwich with chimichurri sauce yolk steak chimi 2.0 sandwich".
[backend] [LedgerInvariant] applied sodium reality-check override for composite "YOLK Steak Chimi 2.0 Sandwich": adjusted sodium from row-sum to 171
[backend] [Receipt] using preCalc multi-row n=3 for "YOLK Roasted Broccoli and Cabbage Side": Estimated broccoli(id=estimated_comp_1_0,cal=48), 📖 [cabbage](https://fdc.nal.usda.gov/fdc-app.html#/food-details/170420/nutrients)(id=170420,cal=21), 📖 [olive oil](https://fdc.nal.usda.gov/fdc-app.html#/food-details/1103091/nutrients)(id=1103091,cal=23)
[backend] [PrepPolicy:receipt] "YOLK Roasted Broccoli and Cabbage Side" reason=composite_dish_suppress_top_level_prep cal=0
[backend] [Airline Multiplier Diagnostic] item="YOLK Roasted Broccoli and Cabbage Side" diningEnvironment="casual_restaurant" hasCookingAdded=true cookingNa=0
[backend] [Sparse Micronutrient Backfill] "YOLK Roasted Broccoli and Cabbage Side": backfilled 19 micronutrient(s) from category profile for "yolk roasted broccoli and cabbage side roasted broccoli and cabbage yolk roasted broccoli and cabbage side".
[backend] [LedgerInvariant] composite "YOLK Roasted Broccoli and Cabbage Side": using row-sum totals, reality-check mutations ignored
[backend] [Receipt] using preCalc multi-row n=2 for "YOLK Roasted Baby Potatoes Side": YOLK Baby Potatoes(id=brand_menu_3a5891c7-1b51-4a58-980d-0d28d294a0e7,cal=150), 📖 [olive oil](https://fdc.nal.usda.gov/fdc-app.html#/food-details/1103091/nutrients)(id=1103091,cal=25.3)
[backend] [PrepPolicy:receipt] "YOLK Roasted Baby Potatoes Side" reason=composite_dish_suppress_top_level_prep cal=0
[backend] [Airline Multiplier Diagnostic] item="YOLK Roasted Baby Potatoes Side" diningEnvironment="casual_restaurant" hasCookingAdded=true cookingNa=0
[backend] [SatFat Floor] Saturated fat for "YOLK Roasted Baby Potatoes Side" (0.3g) was below commercial/bakery floor (25% of fat). Adjusted sat fat to 2.1g for 8.2g total fat.
[backend] [Sparse Micronutrient Backfill] "YOLK Roasted Baby Potatoes Side": backfilled 19 micronutrient(s) from category profile for "yolk roasted baby potatoes side roasted baby potatoes yolk roasted baby potatoes side".
[backend] [LedgerInvariant] composite "YOLK Roasted Baby Potatoes Side": using row-sum totals, reality-check mutations ignored
[backend] [MealBuild] happy-path
```

---
_Generated by Health Tracker debug export. Images are omitted to prevent bloat._
