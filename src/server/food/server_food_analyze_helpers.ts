import { getUSDANutrientValue } from '../../../server_pure_helpers.js';
import { isKnownDatabaseBrandSync, normalizeChainKey } from '../../../serverBrandMenu.js';
import { parseLabelCalories } from '../../../server_budget_reconcile.js';

export const formatUSDANutrients = (nutrients: any[]): string => {
  if (!nutrients || !Array.isArray(nutrients)) return "No nutrients available";

  const findNutrient = (namePatterns: string[]) => {
    const exactMatch = nutrients.find(n => {
      const name = (n.nutrientName || (n.nutrient && n.nutrient.name) || "").toLowerCase().trim();
      return namePatterns.some(p => name === p.toLowerCase().trim());
    });
    if (exactMatch) {
      const val = getUSDANutrientValue(exactMatch);
      const unit = exactMatch.unitName || (exactMatch.nutrient && exactMatch.nutrient.unitName) || "";
      return `${val}${unit}`;
    }

    const nut = nutrients.find(n => {
      const name = (n.nutrientName || (n.nutrient && n.nutrient.name) || "").toLowerCase();
      return namePatterns.some(p => {
        const cleanP = p.toLowerCase().trim();
        if (cleanP === "fat" && name.includes("fatty")) {
          return false;
        }
        return name.includes(cleanP);
      });
    });
    if (!nut) return null;
    const val = getUSDANutrientValue(nut);
    const unit = nut.unitName || (nut.nutrient && nut.nutrient.unitName) || "";
    return `${val}${unit}`;
  };

  const mapped: string[] = [];
  const kcal = findNutrient(["energy", "calories"]);
  const protein = findNutrient(["protein"]);
  const fat = findNutrient(["total lipid", "fat"]);
  const satFat = findNutrient(["saturated fat", "fatty acids, total saturated"]);
  const sodium = findNutrient(["sodium"]);

  if (kcal) mapped.push(`Calories: ${kcal}`);
  if (protein) mapped.push(`Protein: ${protein}`);
  if (fat) mapped.push(`Fat: ${fat}`);
  if (satFat) mapped.push(`SatFat: ${satFat}`);
  if (sodium) mapped.push(`Sodium: ${sodium}`);

  return mapped.join(", ");
};

export const formatOFFNutrients = (nutriments: any): string => {
  if (!nutriments) return "No nutrients available";
  const mapped: string[] = [];

  const formatVal = (val: any) => {
    if (val === undefined || val === null) return null;
    const num = Number(val);
    return isNaN(num) ? val : Math.round(num * 100) / 100;
  };

  const kcal = nutriments["energy-kcal_100g"] !== undefined 
    ? formatVal(nutriments["energy-kcal_100g"]) 
    : (nutriments["energy_100g"] !== undefined ? formatVal(Math.round(nutriments["energy_100g"] / 4.184)) : null);
  const protein = formatVal(nutriments["proteins_100g"]);
  const fat = formatVal(nutriments["fat_100g"]);
  const satFat = formatVal(nutriments["saturated-fat_100g"]);
  const sodium = formatVal(nutriments["sodium_100g"]);

  if (kcal !== null) mapped.push(`Calories: ${kcal}kcal`);
  if (protein !== null) mapped.push(`Protein: ${protein}g`);
  if (fat !== null) mapped.push(`Fat: ${fat}g`);
  if (satFat !== null) mapped.push(`SatFat: ${satFat}g`);
  if (sodium !== null) mapped.push(`Sodium: ${sodium}g`);

  return mapped.join(", ");
};

export const extractOFFNutrientsPer100g = (product: any): Record<string, number> => {
  const profile: Record<string, number> = {};
  const n = product.nutriments;
  if (!n) return profile;

  const setNum = (key: string, field: string, scale: number = 1) => {
    if (n[field] !== undefined && n[field] !== null) {
      const val = Number(n[field]) * scale;
      if (!isNaN(val)) profile[key] = Math.round(val * 100) / 100;
    }
  };

  setNum('calories', 'energy-kcal_100g');
  if (profile.calories === undefined) {
    setNum('calories', 'energy_100g', 1 / 4.184); // kJ to kcal fallback
  }

  setNum('protein', 'proteins_100g');
  setNum('totalFat', 'fat_100g');
  setNum('saturatedFat', 'saturated-fat_100g');
  setNum('transFat', 'trans-fat_100g');
  setNum('carbohydrates', 'carbohydrates_100g');
  setNum('sugar', 'sugars_100g');
  setNum('totalFibre', 'fiber_100g');
  setNum('sodium', 'sodium_100g', 1000); // g to mg
  setNum('cholesterol', 'cholesterol_100g', 1000); // g to mg

  return profile;
};

export const isFastFoodChain = (query: string): boolean => {
  const chains = ['mcdonald', 'kfc', 'burger king', 'subway', 'domino', 'pizza hut', 'wendy', 'taco bell', 'starbucks', 'greggs', 'nando'];
  const q = query.toLowerCase();
  return chains.some(c => q.includes(c));
};

export const buildWebSearchQuery = (item: any): string | null => {
  if (!item) return null;
  const name = item.keyword || item.originalName || item.name;
  if (!name) return null;
  const chain = item.chainName || item.brandOwner;
  if (chain && !name.toLowerCase().includes(chain.toLowerCase())) {
    return `${chain} ${name} nutrition facts`;
  }
  return `${name} nutrition facts`;
};

/**
 * F-8.10 shard 1 — DB-search query normalization, extracted verbatim from
 * runFoodAnalyze. Pure string transforms; no request/streaming closure deps.
 */
export const loosenQuery = (query: string): string => {
  if (!query) return "";
  let q = query.toLowerCase().trim();
  // Strip common brand adjectives and prefixes
  q = q.replace(/\b(sainsburys?|tesco|morrisons?|asda|aldi|lidl|waitrose|marks\s*&\s*spencer|m&s|official|fresh|raw|cooked|baked|fried|roasted|steamed|boiled|grilled|organic|natural|wild|sweet|spicy|pure|premium|classic|canned|frozen|delicious|tasty|freshly)\b/g, '');
  // Normalize plurals (simple s/es stripping for common words, especially fruits/vegetables)
  q = q.replace(/\b(clementines|mandarins|tangerines|oranges|berries|raspberries|strawberries|blueberries|grapes|apples|pears|peaches|plums|bananas|lemons|limes|tomatoes|cucumbers|radishes|onions|carrots|potatoes|mushrooms|peas|beans)\b/g, (match) => {
    if (match === 'berries') return 'berry';
    if (match === 'raspberries') return 'raspberry';
    if (match === 'strawberries') return 'strawberry';
    if (match === 'blueberries') return 'blueberry';
    if (match === 'tomatoes') return 'tomato';
    if (match === 'potatoes') return 'potato';
    if (match === 'radishes') return 'radish';
    if (match.endsWith('es')) return match.slice(0, -2);
    if (match.endsWith('s')) return match.slice(0, -1);
    return match;
  });
  q = q.replace(/\s+/g, ' ').trim();
  return q;
};

export const cleanQuery = (raw: string) => {
  let clean = raw.replace(/\s*\(.*?\)\s*/g, '').trim().toLowerCase();
  clean = clean.replace(/\b(soda|can|bottle|pack|tub|slice|cubes|pieces|portion|raw|cooked|boiled|baked|grilled|steamed)\b/g, '').replace(/\s+/g, ' ').trim();
  if (!clean) clean = raw.replace(/\s*\(.*?\)\s*/g, '').trim().toLowerCase();
  const indonesianToEnglish: Record<string, string> = {
    "potongan ikan": "raw fish fillet",
    "ikan potongan": "raw fish fillet",
    "ikan": "raw fish",
    "daging sapi": "raw beef",
    "daging": "raw beef",
    "ayam": "raw chicken",
    "sayur": "vegetables",
    "nasi": "cooked rice",
    "telur": "egg",
    "tempe": "tempeh",
    "tahu": "tofu",
    "kentang": "potato",
    "wortel": "carrot",
    "santan": "coconut milk",
    "tomat dan daun bawang": "tomato",
    "tomat": "tomato",
    "daun bawang": "scallion",
    "donut malaysia matcha": "donut",
    "donut malaysia": "donut"
  };
  for (const [indo, eng] of Object.entries(indonesianToEnglish)) {
    const regex = new RegExp(`\\b${indo}\\b`, 'g');
    if (regex.test(clean)) {
      clean = clean.replace(regex, eng);
    }
  }
  // Automatically prepend "raw" to meats to prevent fetching salted/cooked versions, unless it's a known chain or already specified
  const meats = ["beef", "chicken", "pork", "fish", "steak", "lamb", "mutton", "veal", "salmon", "tuna", "cod", "shrimp", "prawn", "duck"];
  const preparedModifiers = ["raw", "cooked", "fried", "roasted", "grilled", "baked", "boiled", "smoked", "cured", "canned"];
  const chainModifiers = ["mcdonald", "kfc", "burger king", "subway", "brand"];
  const isMeat = meats.some(m => clean.includes(m));
  const hasPreparation = preparedModifiers.some(p => clean.includes(p));
  const isChain = chainModifiers.some(c => clean.includes(c));
  if (isMeat && !hasPreparation && !isChain) {
    clean = "raw " + clean;
  }
  return clean;
};

export const chainPatterns: [string, RegExp][] = [
  ['sainsbury', /\bsainsbury\b/i],
  ['yolk', /\byolk\b/i],
  ['mcdonalds', /mcdonald|maccas|麦当劳/i],
  ['kfc', /\bkfc\b|kentucky/i],
  ['coco_di_mama', /coco\s*di\s*mama|cocodimama/i],
  ['costa', /\bcosta\b/i],
  ['wasabi', /\bwasabi\b/i],
  ['itsu', /\bitsu\b/i],
  ['honi_poke', /honi\s*poke|honipoke/i],
  ['pret', /\bpret\b/i],
  ['starbucks', /starbucks/i],
  ['quaker', /\bquaker\b/i],
  ['jack_daniels', /jack\s*daniel/i],
];

export const detectChainKeyFromText = (str: string): string | undefined => {
  const s = String(str || '').toLowerCase();
  const matched = chainPatterns.find(([, rx]) => rx.test(s));
  if (matched) return matched[0];
  // Dynamic database brand match
  if (isKnownDatabaseBrandSync(s)) {
    const words = s.split(/[^a-z0-9]+/);
    for (const w of words) {
      if (w.length >= 3 && isKnownDatabaseBrandSync(w)) {
        return normalizeChainKey(w);
      }
    }
  }
  return undefined;
};

/**
 * F-8.10 shard 2 — resolver skip gate, extracted verbatim from runFoodAnalyze.
 * A printed label covering calories + several panel fields means the LLM
 * resolver gap is skipped for that query (token save + avoid bad USDA).
 */
export const scoutHasCompletePrintedLabel = (item: any): boolean => {
  const raw = item?.rawNutritionLabel;
  if (!raw || typeof raw !== 'object') return false;
  const cal = parseLabelCalories(raw);
  if (cal == null || !(cal > 0)) return false;
  let filled = 0;
  for (const [k, v] of Object.entries(raw)) {
    const ck = k.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (ck === 'servingsize' || ck === 'weight' || ck === 'servingspercontainer') continue;
    if (v === undefined || v === null || v === '' || v === '-' || v === '--') continue;
    filled++;
  }
  // calories + several panel fields (protein/fat/carbs/salt etc.)
  return filled >= 4;
};

/**
 * F-8.10 shard 2 — component/match enrichment, extracted verbatim from
 * runFoodAnalyze. Mutates scout items in place (same as the inline block).
 */
export function enrichScoutComponentsWithMatches(visionScoutItems: any[], databaseMatchesArray: any[]): void {
  if (Array.isArray(visionScoutItems) && Array.isArray(databaseMatchesArray) && databaseMatchesArray.length > 0) {
    visionScoutItems.forEach((item: any) => {
      if (Array.isArray(item.components)) {
        item.components.forEach((c: any) => {
          const cQuery = String(c.searchQuery || c.name || c.keyword || '').toLowerCase().trim();
          if (!cQuery) return;
          const match = databaseMatchesArray.find((m: any) => {
            const mQuery = String(m.searchQuery || m.query || m.name || '').toLowerCase().trim();
            if (!mQuery) return false;
            const isParentDishMatch = item.originalName && mQuery === String(item.originalName).toLowerCase().trim();
            if (isParentDishMatch && cQuery !== mQuery) return false;
            return mQuery === cQuery || (m.name && m.name.toLowerCase().trim() === cQuery);
          });
          if (match) {
            const isBrandMatch = Boolean(match.chainName) || match.source === 'brand_official' || match.dbSource === 'brand_official';
            const matchChain = String(match.chainName || match.brand || '').toLowerCase().trim();
            const queryHasBrand = isBrandMatch && Boolean(matchChain) && (
              cQuery.includes(matchChain) ||
              (c.brand && String(c.brand).toLowerCase().includes(matchChain))
            );
            if (isBrandMatch && Boolean(matchChain) && !queryHasBrand) {
              c.dbSource = (match.source && match.source !== 'brand_official') ? match.source : 'category_fallback';
              c.chainName = null;
              c.brand = null;
            } else {
              c.dbSource = (match.source || match.dbSource) || (isBrandMatch ? 'brand_official' : 'estimated');
              c.primaryBaseMatchName = match.name || c.primaryBaseMatchName;
              if (queryHasBrand) {
                c.chainName = match.chainName || c.chainName;
                c.brand = match.chainName || match.brand || c.brand;
              }
            }
            if (match.rawNutritionLabel) {
              c.rawNutritionLabel = match.rawNutritionLabel;
            }
          } else {
            if (c.packageLabelText) {
              c.dbSource = 'brand_official';
            } else if (item.components.length === 1 && (item.dbSource === 'brand_official' || item.chainName)) {
              c.dbSource = 'brand_official';
            } else {
              c.dbSource = 'estimated';
            }
          }
        });
      }
    });
  }
}

/**
 * F-8.10 shard 2 — client past-meals prompt context, extracted verbatim from
 * runFoodAnalyze (including its try/catch). Returns the context string;
 * logging flows through the injected onLog callback.
 */
export function buildPastMealsContext(foodLogs: any, onLog: (msg: string) => void): string {
  let pastMealsCtx = "";
  if (foodLogs && Array.isArray(foodLogs) && foodLogs.length > 0) {
    try {
      const pastMeals: any[] = [];
      foodLogs.forEach((f: any) => {
        if (f) {
          pastMeals.push({
            name: f.name,
            date: f.date || "",
            calories: f.nutrients?.calories || f.calories || 0,
            protein: f.nutrients?.protein || f.protein || 0,
            saturatedFat: f.nutrients?.saturatedFat || f.saturatedFat || 0,
            sodium: f.nutrients?.sodium || f.sodium || 0,
            carbohydrates: f.nutrients?.carbohydrates || f.carbohydrates || 0
          });
        }
      });
      if (pastMeals.length > 0) {
        pastMeals.sort((a: any, b: any) => b.date.localeCompare(a.date));
        const recent = pastMeals.slice(0, 10);
        pastMealsCtx = "PATIENT'S RECENT LOGGED MEALS HISTORY (from client state):\n" +
          recent.map((m, idx) => `- Meal ${idx + 1}: "${m.name}" on ${m.date}`).join("\n") + "\n\n";
        onLog(`[Client Context] Successfully loaded ${pastMeals.length} past meal(s) from client payload, included recent ${recent.length} meals in prompt context.`);
        // Rolling average of DAILY TOTALS, counting only days with 2+ meals
        // logged (a single snack logged alone would otherwise skew the
        // "daily average" misleadingly low).
        const dayTotals: { [date: string]: { count: number; calories: number; protein: number; saturatedFat: number; sodium: number; carbohydrates: number } } = {};
        pastMeals.forEach((m: any) => {
          if (!m.date) return;
          if (!dayTotals[m.date]) {
            dayTotals[m.date] = { count: 0, calories: 0, protein: 0, saturatedFat: 0, sodium: 0, carbohydrates: 0 };
          }
          dayTotals[m.date].count += 1;
          dayTotals[m.date].calories += Number(m.calories) || 0;
          dayTotals[m.date].protein += Number(m.protein) || 0;
          dayTotals[m.date].saturatedFat += Number(m.saturatedFat) || 0;
          dayTotals[m.date].sodium += Number(m.sodium) || 0;
          dayTotals[m.date].carbohydrates += Number(m.carbohydrates) || 0;
        });
        const qualifyingDays = Object.keys(dayTotals)
          .filter((d) => dayTotals[d].count >= 2)
          .sort((a, b) => b.localeCompare(a))
          .slice(0, 10);
        if (qualifyingDays.length > 0) {
          const sum = qualifyingDays.reduce((acc, d) => {
            acc.calories += dayTotals[d].calories;
            acc.protein += dayTotals[d].protein;
            acc.saturatedFat += dayTotals[d].saturatedFat;
            acc.sodium += dayTotals[d].sodium;
            acc.carbohydrates += dayTotals[d].carbohydrates;
            return acc;
          }, { calories: 0, protein: 0, saturatedFat: 0, sodium: 0, carbohydrates: 0 });
          const n = qualifyingDays.length;
          const avgCal = Math.round(sum.calories / n);
          const avgProtein = Math.round((sum.protein / n) * 10) / 10;
          const avgSatFat = Math.round((sum.saturatedFat / n) * 10) / 10;
          const avgSodium = Math.round(sum.sodium / n);
          const avgCarbs = Math.round((sum.carbohydrates / n) * 10) / 10;
          onLog(`[Client Context] Computed ${n}-day rolling average from qualifying days (>=2 meals/day).`);
        }
      }
    } catch (err: any) {
      onLog(`[Client Context Error] Failed to process client foodLogs: ${err.message}`);
    }
  }
  return pastMealsCtx;
}

/**
 * F-8.10 shard 21 — text-query extraction, extracted verbatim from
 * runFoodAnalyze (was a module-private top-level function). Splits a
 * text-only message into candidate food phrases for DB search.
 */
export function extractFoodSearchQueriesFromText(message: string): string[] {
  if (!message || typeof message !== 'string') return [];
  let msg = message.trim().toLowerCase();
  // Non-food / greeting check
  const nonFoodPatterns = [
    /^(start|let's start|hello|hi|hey|greetings|help|test|yes|no|ok|okay|clear|reset|menu|why|explain|question|info|please)$/i,
    /\b(alt|ast|cholesterol|ldl|hdl|egfr|creatinine|bilirubin|triglycerides|platelets|wbc|rbc|hemoglobin|hba1c|glucose|blood pressure|systolic|diastolic)\b/i
  ];
  const isNonFood = nonFoodPatterns.some(p => p.test(msg)) && !/\b(eat|ate|eating|had|cooked|fried|grilled|recipe|meal|food|snack|breakfast|lunch|dinner|portion|slice|glass|cup|gram|grams|calorie|calories|nutrient|nutrients)\b/i.test(msg);
  if (isNonFood) return [];
  // Remove portion/weight amounts & units: e.g. "200g", "150 grams", "2 oz", "1 serving", "3 pcs", "2 slices", "1/2 cup"
  msg = msg.replace(/\b\d+(\.\d+)?\s*(g|grams|oz|lbs|kg|servings|serving|pcs|piece|pieces|slice|slices|cup|cups|glass|glasses|tbsp|tsp|bowl|bowls|plate|plates)?\b/gi, ' ');
  msg = msg.replace(/\b(\d+\/\d+)\s*(g|grams|oz|lbs|kg|servings|serving|pcs|piece|pieces|slice|slices|cup|cups|glass|glasses|tbsp|tsp|bowl|bowls|plate|plates)?\b/gi, ' ');
  // Remove punctuation (including apostrophes, commas, quotes, hyphens, colons, brackets)
  msg = msg.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?'"“”\[\]]/g, ' ');
  // List of conversational stop words/phrases to remove
  const stopWords = new Set([
    'it', 'its', 'is', 's', 'that', 'thats', 'this', 'these', 'those', 'there', 'theres', 'they', 'theyre', 'them',
    'i', 'me', 'my', 'you', 'your', 'we', 'our', 'he', 'she', 'his', 'her',
    'am', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
    'would', 'should', 'could', 'will', 'can',
    'a', 'an', 'the', 'and', 'or', 'with', 'for', 'in', 'on', 'at', 'to', 'from', 'by', 'of', 'some', 'about', 'into', 'through',
    'not', 'no', 'but', 'yes', 'ok', 'okay', 'please', 'thanks', 'thank', 'hello', 'hi', 'hey',
    'eat', 'ate', 'eating', 'had', 'have', 'having', 'food', 'meal', 'snack', 'dinner', 'lunch', 'breakfast', 'item', 'items',
    'portion', 'portions', 'dish', 'dishes', 'plate', 'plates',
    'correction', 'corrections', 'actually', 'instead', 'change', 'modify', 'update', 'correct', 'replace',
    'rather', 'than', 'think', 'believe', 'cooked', 'made', 'make'
  ]);
  // Split into candidate food phrases using conjunctions / separators ("and", ",", "+", ";", "with", "to", "instead of")
  const rawSegments = msg.split(/\b(?:and|with|to|instead of|\+|;|,)\b/gi);
  const queries: string[] = [];
  for (const seg of rawSegments) {
    const words = seg.trim().split(/\s+/).filter(w => w.length > 0);
    // Filter out stop words
    const foodWords = words.filter(w => !stopWords.has(w) && w.length > 1);
    if (foodWords.length > 0) {
      const foodPhrase = foodWords.join(' ').trim();
      if (foodPhrase.length >= 2 && !/^\d+$/.test(foodPhrase)) {
        if (!queries.includes(foodPhrase)) {
          queries.push(foodPhrase);
        }
      }
    }
  }
  return queries;
}
