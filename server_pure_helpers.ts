import { normalizeLocale, t } from './src/utils/i18n.js';
// Pure, side-effect-free helpers extracted from server.ts so they can be unit
// tested without importing server.ts (which starts a live HTTP server and
// initializes Firebase Admin as soon as the module loads).
// Do not add imports here that create side effects (firebase, fs, express).
// Extracted verbatim on 2026-07-20 — do not change behavior.

import { classifyUniversalPhysicalFormV3 } from "./server_matching_engine";
import { isGroceryBrandSync, isKnownDatabaseBrandSync } from "./serverBrandMenu.js";
import { getFallbackCategoryProfile } from "./server_food_catalog.js";

// Simple and robust custom JS object-to-YAML stringifier
export function jsToYaml(val: any, indent: number = 0): string {
  const spaces = " ".repeat(indent);
  if (val === null) return "null";
  if (val === undefined) return "null";
  if (typeof val === "string") {
    if (val.includes("\n")) {
      return "|\n" + val.split("\n").map(line => spaces + "  " + line).join("\n");
    }
    if (val.includes(":") || val.includes("#") || val.startsWith("-")) {
      return `"${val.replace(/"/g, '\\"')}"`;
    }
    return val;
  }
  if (typeof val === "number" || typeof val === "boolean") {
    return String(val);
  }
  if (Array.isArray(val)) {
    if (val.length === 0) return "[]";
    let out = "";
    for (const item of val) {
      if (typeof item === "object" && item !== null) {
        const inner = jsToYaml(item, indent + 2);
        const lines = inner.split("\n");
        out += `\n${spaces}- ${lines[0].trim()}`;
        if (lines.length > 1) {
          out += "\n" + lines.slice(1).join("\n");
        }
      } else {
        out += `\n${spaces}- ${jsToYaml(item, indent + 2)}`;
      }
    }
    return out;
  }
  if (typeof val === "object") {
    const keys = Object.keys(val);
    if (keys.length === 0) return "{}";
    let out = "";
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const v = val[k];
      const prefix = i === 0 && indent > 0 ? "" : spaces;
      if (typeof v === "object" && v !== null) {
        out += `${prefix}${k}:${Array.isArray(v) ? "" : "\n"}${jsToYaml(v, indent + (Array.isArray(v) ? 0 : 2))}\n`;
      } else {
        out += `${prefix}${k}: ${jsToYaml(v, indent + 2)}\n`;
      }
    }
    return out.trim();
  }
  return String(val);
}

export function extractBalancedJson(text: string): string {
  let cleaned = text.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const startIdx = cleaned.indexOf("{");
  if (startIdx !== -1) {
    let braceDepth = 0;
    let bracketDepth = 0;
    let inString = false;
    let escaped = false;

    for (let i = startIdx; i < cleaned.length; i++) {
      const char = cleaned[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
      } else {
        if (char === '"') {
          inString = true;
        } else if (char === "{") {
          braceDepth++;
        } else if (char === "}") {
          braceDepth--;
        } else if (char === "[") {
          bracketDepth++;
        } else if (char === "]") {
          bracketDepth--;
        }
      }

      if (braceDepth < 0 || bracketDepth < 0) {
        break;
      }

      if (braceDepth === 0 && bracketDepth === 0 && !inString) {
        return cleaned.substring(startIdx, i + 1);
      }
    }
  }
  return cleaned;
}

export function closeTruncatedJson(raw: string): string {
  if (!raw || !raw.trim()) return "{}";
  let s = raw.trim();
  try {
    JSON.parse(s);
    return s;
  } catch {
    // repair below
  }
  let inString = false;
  let isEscaped = false;
  const stack: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const char = s[i];
    if (inString) {
      if (isEscaped) isEscaped = false;
      else if (char === "\\") isEscaped = true;
      else if (char === "\"") inString = false;
    } else {
      if (char === "\"") inString = true;
      else if (char === "{") stack.push("}");
      else if (char === "[") stack.push("]");
      else if ((char === "}" || char === "]") && stack.length > 0 && stack[stack.length - 1] === char) stack.pop();
    }
  }
  if (inString) s += "\"";
  s = s.replace(/(?:,\s*)?"[^"]*"\s*:\s*$/, "").replace(/[:,\s]+$/, "");
  while (stack.length > 0) s += stack.pop();
  return s;
}

// Defensive numeric guard for weight values coming from LLM output.
// Number(x) alone is not safe here: an overlong digit string overflows to
// Infinity, and "Infinity || fallback" still evaluates to Infinity because
// Infinity is truthy. This rejects non-finite and unreasonably large values.
export function sanitizeMealWeight(value: any, fallback: number, maxGrams: number = 10000): number {
  const raw = value;
  const debugMeta = { originalData: Array.isArray(raw) ? raw : [raw] };
  const n = Number(debugMeta.originalData[0]);
  if (!Number.isFinite(n) || n <= 0 || n > maxGrams) return fallback;
  return Math.round(n);
}

export function sanitizeString(val: any, fallback: string): string {
  if (val === null || val === undefined || String(val).toLowerCase() === "undefined" || String(val).trim() === "") {
    return fallback;
  }
  return String(val);
}

export function findItemIndexInList(itemsBreakdown: any[], itemNameStr: string, targetDbId: string | null): number {
  if (!itemsBreakdown || !Array.isArray(itemsBreakdown)) return -1;
  const nameLower = itemNameStr.trim().toLowerCase();
  // Sanitize targetDbId: strip all non-printable/non-ASCII characters (e.g. emoji variation selectors)
  const cleanDbId = targetDbId ? String(targetDbId).replace(/[^\x20-\x7E]/g, '').trim() : null;
  if (!nameLower && !cleanDbId) return -1;

  // 1. Exact match by dbId / id / itemId
  if (cleanDbId) {
    const idx = itemsBreakdown.findIndex((it: any) =>
      (it.dbId && String(it.dbId) === cleanDbId) ||
      (it.id && String(it.id) === cleanDbId) ||
      (it.itemId && String(it.itemId) === cleanDbId)
    );
    if (idx !== -1) return idx;
  }

  // Strip leading articles/pronouns for clean comparison
  const nameClean = nameLower.replace(/^(the|a|an|my|this|that|some)\s+/i, '').trim();

  // 2. Exact match by item name (case-insensitive)
  const exactIdx = itemsBreakdown.findIndex((it: any) => {
    const itName = (it.name || it.originalName || "").trim().toLowerCase();
    return itName === nameLower || itName === nameClean;
  });
  if (exactIdx !== -1) return exactIdx;

  // 3. Exact match by canonical name if present
  const canonicalIdx = itemsBreakdown.findIndex((it: any) => {
    const itCanon = (it.canonicalDbName || "").trim().toLowerCase();
    return itCanon === nameLower || itCanon === nameClean;
  });
  if (canonicalIdx !== -1) return canonicalIdx;

  // 4. Substring prefix/suffix match (e.g. startsWith or endsWith)
  const wordMatchIdx = itemsBreakdown.findIndex((it: any) => {
    const itName = (it.name || it.originalName || "").trim().toLowerCase();
    return itName.startsWith(nameLower) || itName.endsWith(nameLower) ||
           (nameClean && (itName.startsWith(nameClean) || itName.endsWith(nameClean)));
  });
  if (wordMatchIdx !== -1) return wordMatchIdx;

  // 5. Whole-word token intersection match (prioritize highest whole-word match count)
  const queryTokens = (nameClean || nameLower)
    .split(/[\s,_\-]+/)
    .map(w => w.trim().toLowerCase())
    .filter(w => w.length > 1 && !['the', 'and', 'with', 'for', 'item', 'food'].includes(w));

  if (queryTokens.length > 0) {
    let bestIdx = -1;
    let bestScore = 0;
    itemsBreakdown.forEach((it: any, idx: number) => {
      const itTokens = `${it.name || ''} ${it.canonicalDbName || ''} ${it.originalName || ''}`
        .toLowerCase()
        .split(/[\s,_\-]+/)
        .map(w => w.trim())
        .filter(w => w.length > 0);

      const matches = queryTokens.filter(qt => itTokens.includes(qt)).length;
      if (matches > bestScore) {
        bestScore = matches;
        bestIdx = idx;
      }
    });
    if (bestIdx !== -1 && bestScore > 0) return bestIdx;
  }

  // 6. Classic includes fallback (fuzzy substring)
  const includesIdx = itemsBreakdown.findIndex((it: any) => {
    const itName = (it.name || it.originalName || "").trim().toLowerCase();
    return (nameClean && itName.includes(nameClean)) || itName.includes(nameLower) || nameLower.includes(itName);
  });
  if (includesIdx !== -1) return includesIdx;

  return -1;
}

export function getUSDANutrientValue(n: any): number {
  if (!n) return 0;
  if (typeof n === 'number') return isNaN(n) ? 0 : n;
  if (typeof n.value === 'number') return isNaN(n.value) ? 0 : n.value;
  if (typeof n.amount === 'number') return isNaN(n.amount) ? 0 : n.amount;
  if (n.value && typeof n.value === 'number') return n.value;
  if (n.value && typeof n.value === 'object' && typeof n.value.amount === 'number') return n.value.amount;
  if (n.amount && typeof n.amount === 'object' && typeof n.amount.value === 'number') return n.amount.value;
  const raw = n.value !== undefined ? n.value : n.amount;
  if (raw !== undefined && raw !== null) {
    const parsed = parseFloat(String(raw));
    if (!isNaN(parsed)) return parsed;
  }
  return 0;
}

const SATFAT_RATIO_BY_TYPE: Record<string, number> = {
  red_meat: 0.40,
  poultry: 0.30,
  dairy: 0.60,
  fish_fatty: 0.25,
  fish_lean: 0.20,
  grain: 0.20,
  legume: 0.15,
  leafy_veg: 0.10,
  root_veg: 0.10,
  ultra_processed: 0.35,
  other: 0.20
};

export function getSaturatedFatRatio(description: string): number {
  const d = String(description || "").toLowerCase();
  if (d.includes("avocado")) return 0.15;
  if (d.includes("steak") || d.includes("beef") || d.includes("lamb") || d.includes("pork") || d.includes("mutton") || d.includes("veal") || d.includes("daging")) return SATFAT_RATIO_BY_TYPE.red_meat;
  if (d.includes("chicken") || d.includes("turkey") || d.includes("duck") || d.includes("poultry") || d.includes("ayam")) return SATFAT_RATIO_BY_TYPE.poultry;
  if (d.includes("salmon") || d.includes("tuna") || d.includes("mackerel") || d.includes("sardine") || d.includes("herring") || d.includes("fatty fish")) return SATFAT_RATIO_BY_TYPE.fish_fatty;
  if (d.includes("cod") || d.includes("halibut") || d.includes("snapper") || d.includes("bass") || d.includes("tilapia") || d.includes("fish") || d.includes("ikan")) return SATFAT_RATIO_BY_TYPE.fish_lean;
  if (d.includes("milk") || d.includes("cheese") || d.includes("butter") || d.includes("yogurt") || d.includes("dairy")) return SATFAT_RATIO_BY_TYPE.dairy;
  if (d.includes("rice") || d.includes("bread") || d.includes("oat") || d.includes("wheat") || d.includes("grain") || d.includes("corn") || d.includes("maize") || d.includes("pasta") || d.includes("noodle")) return SATFAT_RATIO_BY_TYPE.grain;
  if (d.includes("bean") || d.includes("lentil") || d.includes("pea") || d.includes("chickpea") || d.includes("legume") || d.includes("tempeh") || d.includes("tofu")) return SATFAT_RATIO_BY_TYPE.legume;
  if (d.includes("potato") || d.includes("carrot") || d.includes("onion") || d.includes("garlic") || d.includes("beet") || d.includes("radish") || d.includes("yam") || d.includes("tuber") || d.includes("root") || d.includes("kentang") || d.includes("wortel")) return SATFAT_RATIO_BY_TYPE.root_veg;
  if (d.includes("spinach") || d.includes("kale") || d.includes("lettuce") || d.includes("cabbage") || d.includes("leaf") || d.includes("leaves") || d.includes("sayur") || d.includes("kangkung") || d.includes("pakchoy") || d.includes("mustard green") || d.includes("broccoli") || d.includes("cauliflower")) return SATFAT_RATIO_BY_TYPE.leafy_veg;
  if (d.includes("donut") || d.includes("candy") || d.includes("chocolate") || d.includes("chip") || d.includes("french fry") || d.includes("french fries") || d.includes("processed") || d.includes("nugget")) return SATFAT_RATIO_BY_TYPE.ultra_processed;
  return SATFAT_RATIO_BY_TYPE.other;
}

export function extractUSDANutrientsPer100g(food: any): Record<string, number> {
  const profile: Record<string, number> = {};
  if (!food || !food.foodNutrients) return profile;
  
  const findNut = (namePatterns: string[]) => {
    const exactMatch = food.foodNutrients.find((n: any) => {
      const name = (n.nutrientName || (n.nutrient && n.nutrient.name) || "").toLowerCase().trim();
      return namePatterns.some(p => name === p.toLowerCase().trim());
    });
    if (exactMatch) return exactMatch;

    return food.foodNutrients.find((n: any) => {
      const name = (n.nutrientName || (n.nutrient && n.nutrient.name) || "").toLowerCase();
      return namePatterns.some(p => {
        const cleanP = p.toLowerCase().trim();
        if (cleanP === "fat" && name.includes("fatty")) {
          return false;
        }
        return name.includes(cleanP);
      });
    });
  };
  
  const setVal = (key: string, namePatterns: string[]) => {
    const nut = findNut(namePatterns);
    if (nut) {
      profile[key] = getUSDANutrientValue(nut);
    }
  };
  
  // Find energy/calories. We prefer Kilocalories (ID 1008) over Kilojoules (ID 1062).
  let kcalNut = food.foodNutrients.find((n: any) => {
    const id = Number(n.nutrientId || (n.nutrient && n.nutrient.id));
    const num = String(n.nutrientNumber || "");
    const name = (n.nutrientName || (n.nutrient && n.nutrient.name) || "").toLowerCase();
    const unit = (n.unitName || (n.nutrient && n.nutrient.unitName) || "").toLowerCase();
    return id === 1008 || num === "208" || name.includes("kcal") || name.includes("kilocalories") || (name === "energy" && unit === "kcal");
  });

  let kjNut = food.foodNutrients.find((n: any) => {
    const id = Number(n.nutrientId || (n.nutrient && n.nutrient.id));
    const num = String(n.nutrientNumber || "");
    const name = (n.nutrientName || (n.nutrient && n.nutrient.name) || "").toLowerCase();
    const unit = (n.unitName || (n.nutrient && n.nutrient.unitName) || "").toLowerCase();
    return id === 1062 || num === "268" || name.includes("kj") || name.includes("kilojoules") || (name === "energy" && unit === "kj");
  });

  if (kcalNut) {
    const val = getUSDANutrientValue(kcalNut);
    profile["calories"] = Math.round(val);
  } else if (kjNut) {
    const val = getUSDANutrientValue(kjNut);
    profile["calories"] = Math.round(val / 4.184);
  } else {
    // Fallback to standard name matching
    const energyNut = findNut(["energy", "calories"]);
    if (energyNut) {
      const val = getUSDANutrientValue(energyNut);
      const unit = (energyNut.unitName || (energyNut.nutrient && energyNut.nutrient.unitName) || "").toLowerCase();
      const name = (energyNut.nutrientName || (energyNut.nutrient && energyNut.nutrient.name) || "").toLowerCase();
      if (unit === "kj" || name.includes("kilojoules") || name.includes("kj")) {
        profile["calories"] = Math.round(val / 4.184);
      } else {
        profile["calories"] = Math.round(val);
      }
    }
  }
  
  setVal("protein", ["protein"]);
  setVal("totalFat", ["total lipid", "fat"]);
  setVal("saturatedFat", ["saturated fat", "fatty acids, total saturated"]);
  setVal("transFat", ["trans fat", "fatty acids, total trans"]);

  // Deterministic Saturated Fat Fallback (Bug 4)
  if (profile["saturatedFat"] === undefined || profile["saturatedFat"] === null || isNaN(profile["saturatedFat"])) {
    const totalFat = profile["totalFat"] || 0;
    if (totalFat > 0) {
      const desc = food.description || food.name || "";
      const ratio = getSaturatedFatRatio(desc);
      profile["saturatedFat"] = parseFloat((totalFat * ratio).toFixed(2));
    } else {
      profile["saturatedFat"] = 0;
    }
  }
  
  if (profile["totalFat"] !== undefined) {
     profile["unsaturatedFat"] = Math.max(0, profile["totalFat"] - (profile["saturatedFat"] || 0) - (profile["transFat"] || 0));
  }
  
  setVal("omega3", ["omega-3", "omega 3", "n-3 fatty acid"]);
  setVal("carbohydrates", ["carbohydrate, by difference"]);
  setVal("addedSugar", ["added sugar"]);
  setVal("sugar", ["sugars, total including nlea", "sugars, total", "sugar", "total sugars"]);

  const dLower = (food.description || food.name || "").toLowerCase();

  // If the item is a sweet baking ingredient or pure sugar, all its sugar is Added Sugar
  if (!profile["addedSugar"] && profile["sugar"] > 0) {
    if (/\b(sugar|syrup|honey|molasses|agave|frosting|icing|jam|jelly|marmalade|candy|caramel)\b/i.test(dLower)) {
      profile["addedSugar"] = profile["sugar"];
    }
  }

  setVal("totalFibre", ["fiber, total dietary", "fibre"]);
  if (profile["totalFibre"] === undefined || profile["totalFibre"] === null) {
    if (/\b(quinoa|oat|oats|oatmeal|brown rice|wild rice|barley|farro|buckwheat|millet)\b/i.test(dLower)) {
      profile["totalFibre"] = 2.8;
    } else if (/\b(white rice|rice|pasta|macaroni|noodle|noodles|bread|flour)\b/i.test(dLower)) {
      profile["totalFibre"] = 0.4;
    } else if (/\b(edamame|bean|beans|lentils|chickpeas|soy|soybean|hummus)\b/i.test(dLower)) {
      profile["totalFibre"] = 5.5;
    } else if (/\b(cabbage|broccoli|kale|cauliflower|slaw|coleslaw|sprouts)\b/i.test(dLower)) {
      profile["totalFibre"] = 2.5;
    }
  }
  setVal("solubleFibre", ["fiber, soluble", "soluble fiber"]);
  setVal("sodium", ["sodium"]);
  setVal("potassium", ["potassium"]);
  setVal("magnesium", ["magnesium"]);
  setVal("calcium", ["calcium"]);
  setVal("iron", ["iron"]);
  setVal("zinc", ["zinc"]);
  setVal("selenium", ["selenium"]);
  setVal("iodine", ["iodine"]);
  setVal("phosphorus", ["phosphorus"]);
  setVal("vitaminD", ["vitamin d"]);
  setVal("vitaminB12", ["vitamin b-12", "vitamin b12"]);
  setVal("folate", ["folate"]);
  setVal("vitaminC", ["vitamin c", "ascorbic acid"]);
  setVal("vitaminE", ["vitamin e", "tocopherol"]);
  setVal("vitaminK", ["vitamin k"]);
  setVal("vitaminA", ["vitamin a"]);
  setVal("vitaminB6", ["vitamin b-6", "vitamin b6"]);
  setVal("thiamine", ["thiamine"]);
  setVal("riboflavin", ["riboflavin"]);
  setVal("niacin", ["niacin"]);
  
  return profile;
}

export function extractOFFNutrientsPer100g(product: any): Record<string, number> {
  const profile: Record<string, number> = {};
  if (!product || !product.nutriments) return profile;
  const n = product.nutriments;
  
  if (n["energy-kcal_100g"] !== undefined) {
    profile["calories"] = Number(n["energy-kcal_100g"]) || 0;
  } else if (n["energy_100g"] !== undefined) {
    profile["calories"] = Math.round(Number(n["energy_100g"]) / 4.184) || 0;
  }
  
  const setNum = (key: string, field: string, scale: number = 1) => {
    if (n[field] !== undefined) {
      profile[key] = (Number(n[field]) || 0) * scale;
    }
  };

  setNum("protein", "proteins_100g");
  setNum("totalFat", "fat_100g");
  setNum("saturatedFat", "saturated-fat_100g");
  setNum("transFat", "trans-fat_100g");

  // Deterministic Saturated Fat Fallback (Bug 4)
  if (profile["saturatedFat"] === undefined || profile["saturatedFat"] === null || isNaN(profile["saturatedFat"])) {
    const totalFat = profile["totalFat"] || 0;
    if (totalFat > 0) {
      const desc = product.product_name || "";
      const ratio = getSaturatedFatRatio(desc);
      profile["saturatedFat"] = parseFloat((totalFat * ratio).toFixed(2));
    } else {
      profile["saturatedFat"] = 0;
    }
  }
  
  if (profile["totalFat"] !== undefined) {
    profile["unsaturatedFat"] = Math.max(0, profile["totalFat"] - (profile["saturatedFat"] || 0) - (profile["transFat"] || 0));
  }
  
  setNum("omega3", "omega-3_100g");
  setNum("carbohydrates", "carbohydrates_100g");
  setNum("addedSugar", "added_sugars_100g");
  setNum("sugar", "sugars_100g");
  setNum("totalFibre", "fiber_100g");
  setNum("solubleFibre", "soluble-fiber_100g");
  
  setNum("sodium", "sodium_100g", 1000);
  setNum("potassium", "potassium_100g", 1000);
  setNum("magnesium", "magnesium_100g", 1000);
  setNum("calcium", "calcium_100g", 1000);
  setNum("iron", "iron_100g", 1000);
  setNum("zinc", "zinc_100g", 1000);
  setNum("selenium", "selenium_100g");
  setNum("iodine", "iodine_100g");
  setNum("phosphorus", "phosphorus_100g", 1000);
  setNum("vitaminD", "vitamin-d_100g");
  setNum("vitaminB12", "vitamin-b12_100g");
  setNum("folate", "folate_100g");
  setNum("vitaminC", "vitamin-c_100g", 1000);
  setNum("vitaminE", "vitamin-e_100g", 1000);
  setNum("vitaminK", "vitamin-k_100g");
  setNum("vitaminA", "vitamin-a_100g");
  setNum("vitaminB6", "vitamin-b6_100g", 1000);
  setNum("thiamine", "thiamine_100g", 1000);
  setNum("riboflavin", "riboflavin_100g", 1000);
  setNum("niacin", "niacin_100g", 1000);

  return profile;
}

export function checkIfItemIsAlreadyPrepared(
  name: string,
  keyword: string,
  dbSource?: string,
  baselineSodium?: number
): boolean {
  const nameLower = (name || "").toLowerCase();
  const kwLower = (keyword || "").toLowerCase();
  
  // 1. Branded, Open Food Facts, or printed label sources are always prepared/packaged
  if (dbSource === "off" || dbSource === "label") return true;

  // 2. High baseline sodium (> 200mg per 100g) indicates pre-seasoned / processed base ingredient.
  // Only trust this heuristic when the sodium value came from a verified match (USDA/OFF/label/
  // canonical reference) — NOT from the generic Tier-3 "estimated" fallback, whose sodium guess
  // is not real evidence that the ingredient is already prepared/seasoned.
  if (dbSource && dbSource !== "estimated" && baselineSodium !== undefined && baselineSodium > 200) return true;

  // 3. Keywords in name or keyword that indicate prepared, seasoned, processed base product (sauces/mayo handled separately)
  const preparedKeywords = [
    "fries", "french fry", "french fries", "wedge", "wedges", "chip", "chips", "nugget", "nuggets",
    "patty", "patties", "burger", "burgers",
    "processed", "seasoned", "canned", "fried", "cured",
    "bacon", "ham", "sausage", "sausages", "meatball", "meatballs", "toasted", "instant", "salted",
    "bowl", "bowls", "poke", "salad", "salads", "bento", "combo", "platter", "box", "wrap", "wraps",
    "burrito", "burritos", "taco", "tacos", "curry", "stew", "casserole", "sandwich", "sandwiches",
    "roll", "rolls", "sushi", "tartare", "poke_bowl", "compound_meal"
  ];

  if (preparedKeywords.some(kw => nameLower.includes(kw) || kwLower.includes(kw))) {
    return true;
  }

  // 4. Known chains or brands from database
  if (isKnownDatabaseBrandSync(nameLower) || isKnownDatabaseBrandSync(kwLower)) {
    return true;
  }

  return false;
}

export function evaluateNutrientWarnings(nutrients: any) {
  const warnings: string[] = [];
  if (!nutrients) return warnings;
  if (nutrients.sodium > 500) warnings.push("High Sodium (>500mg)");
  if (nutrients.totalFat < (nutrients.saturatedFat + nutrients.transFat)) warnings.push("Fat Thermodynamics Mismatch");
  if (nutrients.protein > 45) warnings.push("Unusually High Protein (>45g)");
  if (nutrients.calories === 0) warnings.push("Zero Calories Detected");
  return warnings;
}

// Atwater general factors (4 kcal/g protein, 4 kcal/g carb, 9 kcal/g fat). Applied with a
// generous tolerance band because rounding, fibre, and alcohol all shift the true figure —
// this is a coarse "is this physically possible" net, not a precise validator. Runs on every
// item unconditionally, including label-sourced ones, because a physical impossibility is a
// physical impossibility regardless of where the number came from (OCR misread, wrong DB
// match, wrong component sum, etc. can all produce one).
const ATWATER_TOLERANCE = 0.35; // allow 35% deviation before intervening

export function checkAtwaterConsistency(
  itemName: string,
  itemNutrients: Record<string, number>,
  addDebugLog?: (msg: string) => void
): void {
  if (!itemNutrients || typeof itemNutrients !== 'object') return;
  const protein = itemNutrients.protein || 0;
  let carbs = itemNutrients.carbohydrates || 0;
  const fat = itemNutrients.totalFat || 0;
  const statedCalories = itemNutrients.calories || 0;

  if (statedCalories <= 0 && (protein > 0 || carbs > 0 || fat > 0)) {
    // Macros present but zero calories logged — definitely wrong, not just imprecise.
    const derivedCalories = Math.round(protein * 4 + carbs * 4 + fat * 9);
    if (addDebugLog) {
      addDebugLog(`[Atwater Check] "${itemName}" has macros (P=${protein}g C=${carbs}g F=${fat}g) but ${statedCalories} stated kcal. Correcting calories to ${derivedCalories} kcal (derived from macros).`);
    }
    itemNutrients.calories = derivedCalories;
    return;
  }

  if (statedCalories <= 0) return; // nothing to compare against

  if (protein <= 0 && carbs <= 0 && fat <= 0 && statedCalories > 0) {
    const estCarbs = Math.round(((statedCalories * 0.45) / 4) * 10) / 10;
    const estFat = Math.round(((statedCalories * 0.35) / 9) * 10) / 10;
    const estProtein = Math.round(((statedCalories * 0.20) / 4) * 10) / 10;
    itemNutrients.carbohydrates = estCarbs;
    itemNutrients.totalFat = estFat;
    itemNutrients.protein = estProtein;
    if (addDebugLog) {
      addDebugLog(`[Atwater Anchor Engine] "${itemName}" had ${statedCalories} stated kcal but no macros. Applied category macro prior (45% Carbs, 35% Fat, 20% Protein): C=${estCarbs}g, F=${estFat}g, P=${estProtein}g.`);
    }
    return;
  }

  const isAlcoholicBeverage = /\b(wine|brut|prosecco|champagne|chardonnay|cabernet|merlot|pinot|sauvignon|syrah|shiraz|rosé|rose|beer|ale|lager|stout|cider|vodka|whiskey|whisky|rum|gin|tequila|cognac|brandy|bourbon|liquor|spirit|cocktail|margarita|martini)\b/i.test(itemName);
  if (isAlcoholicBeverage) {
    if (addDebugLog) {
      addDebugLog(`[Atwater Check] "${itemName}" identified as alcoholic beverage. Skipping Atwater macro rescaling to preserve authentic alcohol caloric contribution.`);
    }
    return;
  }

  const isGrainItem = /\b(rice|bread|ciabatta|bun|sandwich|wrap|pasta|noodle|grain|oat|bagel|pancake|waffle|flour|dough|roll|toast|croissant)\b/i.test(
    itemName
  );

  if (carbs <= 0 && isGrainItem && statedCalories > 0) {
    const residualCarbs = Math.max(
      0,
      Math.round(((statedCalories - (protein * 4 + fat * 9)) / 4) * 10) / 10
    );
    if (residualCarbs > 0) {
      if (addDebugLog) {
        addDebugLog(
          `[Atwater Check] Preserved/estimated carbs=${residualCarbs}g before rescale for grain-containing item ("${itemName}").`
        );
      }
      carbs = residualCarbs;
      itemNutrients.carbohydrates = residualCarbs;
    }
  }

  const derivedCalories = protein * 4 + carbs * 4 + fat * 9;
  if (derivedCalories <= 0) return; // no macros to check against stated calories

  // Specific macro floors: calories cannot physically be lower than energy from fat or carbohydrates alone.
  const minFatCalories = Math.round(fat * 9);
  if (minFatCalories > statedCalories && fat >= 5 && (fat * 9) / Math.max(1, derivedCalories) > 0.80) {
    if (addDebugLog) {
      addDebugLog(`[Atwater Fat Floor] "${itemName}": stated ${statedCalories} kcal is physically below energy from fat alone (${fat}g * 9 = ${minFatCalories} kcal). Adjusting calories to ${minFatCalories} kcal.`);
    }
    itemNutrients.calories = Math.round(derivedCalories);
    return;
  }

  const minCarbCalories = Math.round(carbs * 4);
  if (minCarbCalories > statedCalories * 1.35 && carbs >= 15) {
    if (addDebugLog) {
      addDebugLog(`[Atwater Carb Floor] "${itemName}": stated ${statedCalories} kcal is physically below energy from carbohydrates alone (${carbs}g * 4 = ${minCarbCalories} kcal). Adjusting calories to ${Math.round(derivedCalories)} kcal.`);
    }
    itemNutrients.calories = Math.round(derivedCalories);
    return;
  }

  const deviation = Math.abs(derivedCalories - statedCalories) / statedCalories;
  if (deviation > ATWATER_TOLERANCE) {
    // Macros and stated calories disagree by more than physically plausible rounding/fibre
    // error can explain. Trust the calories (usually the most reliably sourced single number —
    // printed on labels/menus, or the primary DB field) and rescale the macros proportionally
    // rather than guessing which individual macro is wrong.
    const scaleRatio = derivedCalories > 0 ? statedCalories / derivedCalories : 1;
    const newProtein = Math.round(protein * scaleRatio * 10) / 10;
    const newCarbs = Math.round(carbs * scaleRatio * 10) / 10;
    const newFat = Math.round(fat * scaleRatio * 10) / 10;
    if (addDebugLog) {
      addDebugLog(`[Atwater Check] "${itemName}": macros (P=${protein}g C=${carbs}g F=${fat}g -> ${Math.round(derivedCalories)} kcal) don't reconcile with stated ${statedCalories} kcal (${Math.round(deviation * 100)}% deviation). Rescaling macros to match stated calories: P=${newProtein}g C=${newCarbs}g F=${newFat}g.`);
    }
    itemNutrients.protein = newProtein;
    itemNutrients.carbohydrates = newCarbs;
    itemNutrients.totalFat = newFat;
    if ((itemNutrients as any).truthNutrients && typeof (itemNutrients as any).truthNutrients === 'object') {
      (itemNutrients as any).truthNutrients.protein = newProtein;
      (itemNutrients as any).truthNutrients.carbohydrates = newCarbs;
      (itemNutrients as any).truthNutrients.totalFat = newFat;
    }
    if (itemNutrients.saturatedFat !== undefined && itemNutrients.saturatedFat !== null) {
      const satRatio = fat > 0 ? (itemNutrients.saturatedFat / fat) : getSaturatedFatRatio(itemName);
      itemNutrients.saturatedFat = Math.min(
        newFat,
        Math.round(itemNutrients.saturatedFat * scaleRatio * 10) / 10,
        Math.round(newFat * satRatio * 10) / 10
      );
      if ((itemNutrients as any).truthNutrients?.saturatedFat !== undefined) {
        (itemNutrients as any).truthNutrients.saturatedFat = itemNutrients.saturatedFat;
      }
    }
    if (itemNutrients.transFat !== undefined && itemNutrients.transFat !== null) {
      itemNutrients.transFat = Math.min(newFat, Math.round(itemNutrients.transFat * scaleRatio * 10) / 10);
      if ((itemNutrients as any).truthNutrients?.transFat !== undefined) {
        (itemNutrients as any).truthNutrients.transFat = itemNutrients.transFat;
      }
    }
    if (itemNutrients.sugar !== undefined && itemNutrients.sugar !== null) {
      itemNutrients.sugar = Math.min(newCarbs, Math.round(itemNutrients.sugar * scaleRatio * 10) / 10);
      if ((itemNutrients as any).truthNutrients?.sugar !== undefined) {
        (itemNutrients as any).truthNutrients.sugar = itemNutrients.sugar;
      }
    }
    if (itemNutrients.addedSugar !== undefined && itemNutrients.addedSugar !== null) {
      itemNutrients.addedSugar = Math.min(itemNutrients.sugar ?? newCarbs, Math.round(itemNutrients.addedSugar * scaleRatio * 10) / 10);
      if ((itemNutrients as any).truthNutrients?.addedSugar !== undefined) {
        (itemNutrients as any).truthNutrients.addedSugar = itemNutrients.addedSugar;
      }
    }
    const satFat = itemNutrients.saturatedFat || 0;
    const transFat = itemNutrients.transFat || 0;
    itemNutrients.unsaturatedFat = parseFloat(Math.max(0, newFat - satFat - transFat).toFixed(2));
  }
}

export function applyCommercialSodiumFloor(
  itemName: string,
  itemNutrients: Record<string, number>,
  dbSource?: string,
  addDebugLog?: (msg: string) => void,
  ctx?: {
    originalName?: string | null;
    keyword?: string | null;
    componentCount?: number;
    physicalForm?: string | null;
    chainName?: string | null;
  }
): void {
  if (!itemNutrients || typeof itemNutrients !== 'object') return;
  const canonicalName = itemName;
  const identityForChecks = [
    ctx?.originalName,
    ctx?.keyword,
    itemName,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const isGroceryBrand =
    ctx?.chainName != null && isGroceryBrandSync(ctx.chainName);
  const isFastFoodOrChain =
    (ctx?.chainName != null && !isGroceryBrand) ||
    isKnownDatabaseBrandSync(identityForChecks) ||
    /\b(kebab|tikka|burger|fries|fried\s+chicken|pizza|fast\s+food)\b/i.test(identityForChecks);

  const isCleanProteinSide =
    /\b(chicken|poultry|turkey|steak|beef|flank|breast|salmon|tuna|cod|fish|seafood|egg|poached)\b/i.test(identityForChecks) &&
    !/\b(fried|breaded|crispy|nugget|tenders?|sauced?|glazed?|gravy|burger|sandwich|pizza|pie|casserole|curry|fries|wings)\b/i.test(identityForChecks);

  const isCompositeEntree =
    /\b(fried\s+chicken|breaded|nuggets?|tenders?|burger|sandwich|pizza|burrito|taco|casserole|pie|pasta|curry|wings|bowl|meal|platter|bento|entree)\b/i.test(identityForChecks) ||
    (ctx?.componentCount != null && ctx.componentCount >= 2);

  const isWholeFood =
    ctx?.physicalForm === 'SOLID_FRUIT_VEG' ||
    dbSource === 'canonical_dict' ||
    dbSource === 'label_raw' ||
    isCleanProteinSide ||
    /\b(oats?|oatmeal|rolled\s+oats|milk|cow\s+milk|berries|berry|blueberry|blueberries|strawberry|strawberries|raspberry|raspberries|blackberry|blackberries|fruit|apple|banana|orange|grape|plain\s+yogurt|greek\s+yogurt|nuts?|seeds?|almonds?|walnuts?|raw|fresh)\b/i.test(identityForChecks);

  const isSaucedOrGlazedEntree =
    /\b(glazed?|braised?|teriyaki|sweet\s*and\s*sour|kung\s*pao|curry|masala|tikka\s*masala|butter\s*chicken|black\s*pepper\s*sauce|soy\s*glazed?|stir-?fry|stewed?)\b/i.test(identityForChecks) &&
    !/\b(plain|steamed\s+plain|raw|fresh|salad|fruit|apple|orange)\b/i.test(identityForChecks);

  if ((isFastFoodOrChain || isSaucedOrGlazedEntree) && !isWholeFood && (itemNutrients.calories || 0) > 0) {
    const currentSodium = itemNutrients.sodium || 0;
    const multiplier = isFastFoodOrChain ? 1.8 : 1.2;
    const commercialSodiumFloor = Math.round((itemNutrients.calories || 0) * multiplier);
    if (currentSodium < commercialSodiumFloor) {
      if (addDebugLog) {
        addDebugLog(
          `[Commercial Sodium Floor] Sodium for seasoned/sauced item "${canonicalName}" (${currentSodium}mg) was below baseline floor (${multiplier}mg/kcal). Adjusted sodium to ${commercialSodiumFloor}mg floor for ${itemNutrients.calories} kcal.`
        );
      }
      itemNutrients.sodium = commercialSodiumFloor;
    }
  }
}

export function applySatFatAndAddedSugarFloor(
  itemName: string,
  itemNutrients: Record<string, number>,
  dbSource?: string,
  addDebugLog?: (msg: string) => void,
  ctx?: {
    originalName?: string | null;
    keyword?: string | null;
    componentCount?: number;
    physicalForm?: string | null;
    chainName?: string | null;
    syntheticBase100g?: any;
    isDishEstimate?: boolean;
  }
): void {
  if (!itemNutrients || typeof itemNutrients !== 'object') return;
  const isLabelOrScreenSource = dbSource === "label" || 
    dbSource === "kiosk" || 
    dbSource === "screen" || 
    dbSource === "menu" || 
    dbSource === "brand_official" || 
    Boolean(ctx?.syntheticBase100g) ||
    Boolean(ctx?.isDishEstimate) ||
    (typeof dbSource === "string" && dbSource.startsWith("label"));
  if (isLabelOrScreenSource) return;
  if (!(itemNutrients.calories > 10)) return;

  const canonicalName = itemName;
  const identityForChecks = [
    ctx?.originalName,
    ctx?.keyword,
    itemName,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const isGroceryBrand =
    ctx?.chainName != null && isGroceryBrandSync(ctx.chainName);
  const isFastFoodOrChain =
    (ctx?.chainName != null && !isGroceryBrand) ||
    isKnownDatabaseBrandSync(identityForChecks) ||
    /\b(kebab|tikka|burger|cheeseburger|hamburger|fries|french\s+fries|fried\s+chicken|pizza|fast\s+food|mcdonald|kfc|wendy|burger\s+king|taco\s+bell|subway|domino|starbucks|greggs)\b/i.test(identityForChecks);

  const isCleanProteinSide =
    /\b(chicken|poultry|turkey|steak|beef|flank|breast|salmon|tuna|cod|fish|seafood|egg|poached)\b/i.test(identityForChecks) &&
    !/\b(fried|breaded|crispy|nugget|tenders?|sauced?|glazed?|gravy|burger|cheeseburger|sandwich|pizza|pie|casserole|curry|fries|wings)\b/i.test(identityForChecks);

  const isWholeProduceOrGrain =
    ctx?.physicalForm === 'SOLID_FRUIT_VEG' ||
    dbSource === 'canonical_dict' ||
    dbSource === 'label_raw' ||
    (/\b(oats?|oatmeal|rolled\s+oats|cow\s+milk|berries|berry|blueberry|blueberries|strawberry|strawberries|raspberry|raspberries|blackberry|blackberries|fruit|apple|banana|orange|grape|peach|plum|plain\s+yogurt|greek\s+yogurt|nuts?|seeds?|almonds?|walnuts?|raw|fresh|boiled\s+egg|poached\s+egg|lettuce|salad\s+greens|spinach|kale|broccoli|cucumber|tomato)\b/i.test(identityForChecks) &&
     !/\b(croissant|pastry|danish|donut|doughnut|muffin|cake|cookie|brownie|pie|tart|scone|biscuit|brioche|ice\s*cream|sundae|parfait|cheesecake|pudding|custard|dessert|waffle|pancake|syrup|frosting|chocolate|chocolates|candy|sugar|sweet|fried|breaded|burger|pizza)\b/i.test(identityForChecks));

  const isWholeFood = isCleanProteinSide || isWholeProduceOrGrain;

  const isBakeryOrDessert = /\b(croissant|pastry|danish|donut|doughnut|muffin|cake|cookie|brownie|pie|tart|scone|biscuit|brioche|ice\s*cream|sundae|parfait|cheesecake|pudding|custard|sweet|dessert|waffle|pancake|syrup|frosting|chocolate|chocolates)\b/i.test(identityForChecks);
  const isFriedOrProcessed = /\b(fried|breaded|crispy|batter|nugget|tenders?|chips?|fries|french\s+fries|wedge|wedges|onion\s+rings?|hash\s+brown)\b/i.test(identityForChecks);
  const isSweetBeverageOrSauce = /\b(frappe|frappuccino|shake|milkshake|smoothie|soda|cola|syrup|bbq\s*sauce|teriyaki|sweet\s*chili|sweet\s*and\s*sour|caramel|glaze|sweet\s*tea)\b/i.test(identityForChecks);

  // 1. Saturated Fat Floor
  if ((isFastFoodOrChain || isBakeryOrDessert || isFriedOrProcessed) && !isWholeFood) {
    const totalFat = itemNutrients.totalFat || 0;
    if (totalFat > 0) {
      const satFatRatioFloor = isBakeryOrDessert ? 0.35 : 0.25;
      const minSatFat = Math.min(totalFat, Math.round(totalFat * satFatRatioFloor * 10) / 10);
      if ((itemNutrients.saturatedFat || 0) < minSatFat) {
        if (addDebugLog) {
          addDebugLog(`[SatFat Floor] Saturated fat for "${canonicalName}" (${itemNutrients.saturatedFat || 0}g) was below commercial/bakery floor (${Math.round(satFatRatioFloor * 100)}% of fat). Adjusted sat fat to ${minSatFat}g for ${totalFat}g total fat.`);
        }
        itemNutrients.saturatedFat = minSatFat;
        const trans = itemNutrients.transFat || 0;
        itemNutrients.unsaturatedFat = parseFloat(Math.max(0, totalFat - minSatFat - trans).toFixed(2));
      }
    }
  }

  // 2. Added Sugar Floor
  if ((isBakeryOrDessert || isSweetBeverageOrSauce) && !isWholeFood) {
    const sugar = itemNutrients.sugar || 0;
    const carbs = itemNutrients.carbohydrates || 0;
    const currentAdded = itemNutrients.addedSugar || 0;

    let targetAdded = 0;
    if (sugar > 0) {
      targetAdded = Math.round(sugar * 0.80 * 10) / 10;
    } else if (carbs > 0 && (isBakeryOrDessert || isSweetBeverageOrSauce)) {
      targetAdded = Math.round(carbs * 0.40 * 10) / 10;
    }

    if (targetAdded > 0 && currentAdded < targetAdded) {
      if (addDebugLog) {
        addDebugLog(`[Added Sugar Floor] Added sugar for sweet item "${canonicalName}" (${currentAdded}g) was below minimum floor. Adjusted added sugar to ${targetAdded}g.`);
      }
      itemNutrients.addedSugar = targetAdded;
      if ((itemNutrients.sugar || 0) < targetAdded) {
        itemNutrients.sugar = targetAdded;
      }
    }
  }
}

export function checkThermodynamicDensitySanity(
  itemName: string,
  foodType: string | undefined,
  cookingMethod: string | undefined,
  calories: number,
  servingGrams: number
): { isBreach: boolean; ceiling: number; density: number; category: string } {
  if (!itemName || calories <= 0 || servingGrams <= 0) {
    return { isBreach: false, ceiling: 0, density: 0, category: 'unknown' };
  }

  const density = (calories / servingGrams) * 100;
  const nameLower = itemName.toLowerCase();
  const typeLower = (foodType || '').toLowerCase();
  const combined = `${nameLower} ${typeLower}`;

  const isFried = /\b(fried|breaded|crispy|nugget|tenders?|chips|fries)\b/i.test(combined);

  // 1. Plain poultry / fish / lean meat: <= 250 kcal/100g
  if (/\b(chicken|poultry|turkey|steak|beef|pork|flank|breast|salmon|tuna|cod|fish|seafood|lean_meat|protein)\b/i.test(combined) && !isFried) {
    const ceiling = 250;
    if (density > ceiling) {
      return { isBreach: true, ceiling, density, category: 'plain_meat_poultry_fish' };
    }
    return { isBreach: false, ceiling, density, category: 'plain_meat_poultry_fish' };
  }

  // 2. Cooked tubers / potatoes: <= 160 kcal/100g
  if (/\b(potato|potatoes|tuber|yam|sweet_potato)\b/i.test(combined) && !isFried) {
    const ceiling = 160;
    if (density > ceiling) {
      return { isBreach: true, ceiling, density, category: 'cooked_tubers_potatoes' };
    }
    return { isBreach: false, ceiling, density, category: 'cooked_tubers_potatoes' };
  }

  // 3. Cooked pasta / rice: <= 200 kcal/100g
  if (/\b(pasta|rice|noodles|spaghetti|macaroni|grain)\b/i.test(combined) && !isFried) {
    const ceiling = 200;
    if (density > ceiling) {
      return { isBreach: true, ceiling, density, category: 'cooked_pasta_rice' };
    }
    return { isBreach: false, ceiling, density, category: 'cooked_pasta_rice' };
  }

  // 4. Fresh fruits / vegetables: <= 90 kcal/100g
  const isDessertOrProcessedSweet = /\b(cake|tart|pie|mousse|dessert|jelly|gelatin|pudding|jam|preserves|pastry|danish|muffin|bread|candy|bar|cookie|custard|smoothie|juice|dried|confection)\b/i.test(combined);
  if (!isDessertOrProcessedSweet && /\b(vegetable|fruit|greens|broccoli|cabbage|salad|kale|spinach|lettuce|berry|berries|apple|orange|banana)\b/i.test(combined)) {
    const ceiling = 90;
    if (density > ceiling) {
      return { isBreach: true, ceiling, density, category: 'fresh_fruits_vegetables' };
    }
    return { isBreach: false, ceiling, density, category: 'fresh_fruits_vegetables' };
  }

  return { isBreach: false, ceiling: 0, density, category: 'generic' };
}

export function checkArchetypeMacroBounds(
  itemName: string,
  foodType: string | undefined,
  cookingMethod: string | undefined,
  calories: number,
  protein: number,
  carbs: number,
  fat: number
): { violated: boolean; reason?: string } {
  if (!itemName || calories <= 0) return { violated: false };

  const nameLower = itemName.toLowerCase();
  const typeLower = (foodType || '').toLowerCase();
  const combined = `${nameLower} ${typeLower}`;
  const methodLower = (cookingMethod || '').toLowerCase();

  const isFried = /\b(fried|breaded|crispy|nugget|tenders?)\b/i.test(combined);

  // Archetype 1: Plain Protein / Meats (foodType: "protein" or plain meat names)
  if ((typeLower === 'protein' || /\b(chicken|poultry|turkey|steak|beef|pork|flank|breast|salmon|tuna|cod|fish|seafood)\b/i.test(combined)) && !isFried) {
    if (carbs > 5) {
      return { violated: true, reason: `Carbs (${carbs}g > 5g) on plain protein archetype` };
    }
    const proteinCalRatio = (protein * 4) / calories;
    if (proteinCalRatio < 0.65) {
      return { violated: true, reason: `Protein calories ratio (${(proteinCalRatio * 100).toFixed(1)}% < 65%) on plain protein archetype` };
    }
  }

  // Archetype 2: Tubers / Potatoes (foodType: "tuber" or potato names)
  if (typeLower === 'tuber' || /\b(potato|potatoes|tuber|yam|sweet_potato)\b/i.test(combined)) {
    const carbsCalRatio = (carbs * 4) / calories;
    if (carbsCalRatio < 0.60) {
      return { violated: true, reason: `Carbs calories ratio (${(carbsCalRatio * 100).toFixed(1)}% < 60%) on tuber archetype` };
    }
    if (/\b(roasted|boiled|baked|steamed)\b/i.test(methodLower) || /\b(roasted|boiled|baked|steamed)\b/i.test(combined)) {
      if (fat > 12) {
        return { violated: true, reason: `Fat (${fat}g > 12g) on roasted/boiled/baked tuber archetype` };
      }
    }
  }

  return { violated: false };
}

export function applyNutrientRealityChecks(
  itemName: string,
  itemWeight: number,
  itemNutrients: Record<string, number>,
  addedSodium: number,
  addDebugLog?: (msg: string) => void,
  dbSource?: string,
  ctx?: {
    originalName?: string | null;
    keyword?: string | null;
    componentCount?: number;
    physicalForm?: string | null;
    chainName?: string | null;
    syntheticBase100g?: any;
    isDishEstimate?: boolean;
  }
): void {
  if (!itemNutrients || typeof itemNutrients !== 'object') return;
  // Physics-based check first, unconditionally — no dbSource value, current or future,
  // exempts an item from basic thermodynamic plausibility.
  checkAtwaterConsistency(itemName, itemNutrients, addDebugLog);

  // Values sourced directly from a scanned/printed nutrition label or kiosk screen/menu
  // are verified ground truth and must never be overridden by heuristic sanity checks.
  // Skip heuristic (category/keyword-based) checks for label/kiosk/screen/menu sourced items,
  // including partial backfills — but NOT the Atwater check above, which already ran.
  const isLabelOrScreenSource = dbSource === "label" || 
    dbSource === "kiosk" || 
    dbSource === "screen" || 
    dbSource === "menu" || 
    dbSource === "brand_official" || 
    Boolean(ctx?.syntheticBase100g) ||
    Boolean(ctx?.isDishEstimate) ||
    (typeof dbSource === "string" && dbSource.startsWith("label"));

  if (isLabelOrScreenSource) {
    if (addDebugLog) {
      addDebugLog(`[Dietitian Reality Check] Heuristic checks skipped for "${itemName}" — dbSource is "${dbSource}" (ground truth / dish estimate pipeline active). Atwater consistency check still applied.`);
    }
    return;
  }

  const nameLower = itemName.toLowerCase();
  const canonicalName = itemName;

  const identityForChecks = [
    ctx?.originalName,
    ctx?.keyword,
    itemName,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const componentCount = ctx?.componentCount ?? 0;
  const form = String(ctx?.physicalForm || "").toUpperCase();

  const isCompositeDish =
    componentCount >= 2 ||
    form === "COMPOUND_MEAL" ||
    Boolean(ctx?.chainName && componentCount >= 1) ||
    /\b(burgers?|sandwich(es)?|buns?|rolls?|wraps?|pies?|nuggets?|pizzas?|dumplings?|patties|patty|tacos?|burritos?|noodles?|rice|soup|fried|batter|breaded|bowls?|poke|salad|salads|combos?|meals?|platters?|boxes?|bentos?|currys?|curries|stews?|casseroles?|pastas?|spaghetti|macaroni|risotto|paella|teriyaki|stir-?fry|mix|mixed|dish|dishes|entrees?|compounds?|sets?|surimi|with|and)\b/i.test(
      identityForChecks
    );

  // Use identityForChecks (not only itemName) for meat/fish detection on the *dish*
  const cleanNameLower = identityForChecks || canonicalName.toLowerCase();

  // 1. Meat / Fish Protein Reality Check (< 10% protein by weight for pure solid fish/meat)
  const isMeatOrFish = !isCompositeDish && (
    cleanNameLower.includes('fish') || cleanNameLower.includes('salmon') || cleanNameLower.includes('steak') || 
    cleanNameLower.includes('chicken') || cleanNameLower.includes('beef') || cleanNameLower.includes('pork') || 
    cleanNameLower.includes('ayam') || cleanNameLower.includes('ikan') || cleanNameLower.includes('daging') || 
    cleanNameLower.includes('bebek') || cleanNameLower.includes('udang') || cleanNameLower.includes('cumi')
  );

  if (isMeatOrFish && itemWeight > 10) {
    const proteinRatio = (itemNutrients.protein || 0) / itemWeight;
    if (proteinRatio < 0.10) {
      // Scale protein realistically to ~22g per 100g of detected meat/fish component weight
      const adjustedProtein = Math.round(itemWeight * 0.22 * 10) / 10;
      
      const minFat = Math.round(itemWeight * 0.05 * 10) / 10;
      if ((itemNutrients.totalFat || 0) < minFat) {
         itemNutrients.totalFat = minFat;
      }
      
      if (addDebugLog) addDebugLog(`[Dietitian Reality Check] Protein for "${canonicalName}" (${itemNutrients.protein}g per ${itemWeight}g) was unrealistically low for pure meat/fish. Adjusted protein to ${adjustedProtein}g, fat to ${itemNutrients.totalFat}g.`);
      itemNutrients.protein = adjustedProtein;
      const derivedMeatCal = Math.round(itemNutrients.protein * 4 + (itemNutrients.carbohydrates || 0) * 4 + (itemNutrients.totalFat || 0) * 9);
      if (derivedMeatCal > (itemNutrients.calories || 0)) {
        itemNutrients.calories = derivedMeatCal;
      }
      // Re-run Atwater check to reconcile macros with stated calories without artificially inflating calories
      checkAtwaterConsistency(itemName, itemNutrients, addDebugLog);
    }
  }
  
  // 3. Egg / Tofu Protein Reality Check
  const isEggplant = cleanNameLower.includes('eggplant') || cleanNameLower.includes('aubergine') || cleanNameLower.includes('terong');
  const isEggOrTofu = !isEggplant && !isCompositeDish && /\b(eggs?|telur|tofu|tahu|tempeh)\b/i.test(cleanNameLower);
  if (isEggOrTofu && itemWeight > 10) {
    const proteinRatio = (itemNutrients.protein || 0) / itemWeight;
    if (proteinRatio < 0.05) { // If less than 5% protein, it's severely undercounted
      const adjustedProtein = Math.round(itemWeight * 0.12 * 10) / 10;
      
      const minFat = Math.round(itemWeight * 0.07 * 10) / 10;
      if ((itemNutrients.totalFat || 0) < minFat) {
         itemNutrients.totalFat = minFat;
      }
      
      if (addDebugLog) addDebugLog(`[Dietitian Reality Check] Protein for "${canonicalName}" (${itemNutrients.protein}g per ${itemWeight}g) was unrealistically low for egg/tofu. Adjusted protein to ${adjustedProtein}g, fat to ${itemNutrients.totalFat}g.`);
      itemNutrients.protein = adjustedProtein;
      const derivedEggCal = Math.round(itemNutrients.protein * 4 + (itemNutrients.carbohydrates || 0) * 4 + (itemNutrients.totalFat || 0) * 9);
      if (derivedEggCal > (itemNutrients.calories || 0)) {
        itemNutrients.calories = derivedEggCal;
      }
      checkAtwaterConsistency(itemName, itemNutrients, addDebugLog);
    }
  }

  // 4. Sodium Reality Check
  const isCuredOrSalted = nameLower.includes('cured') || nameLower.includes('bacon') || nameLower.includes('ham') || 
                          nameLower.includes('sausage') || nameLower.includes('soy sauce') || nameLower.includes('salted') || 
                          nameLower.includes('anchovy') || nameLower.includes('pickle') || nameLower.includes('fish sauce') ||
                          nameLower.includes('chilli') || nameLower.includes('chili') || nameLower.includes('sauce') ||
                          nameLower.includes('seasoned') || nameLower.includes('glazed') || nameLower.includes('marinated') ||
                          nameLower.includes('bbq') || nameLower.includes('teriyaki') || nameLower.includes('curry') ||
                          nameLower.includes('tikka') || nameLower.includes('quorn') || nameLower.includes('cracker') ||
                          nameLower.includes('crisp') || nameLower.includes('chip') || nameLower.includes('pretzel') ||
                          nameLower.includes('fry') || nameLower.includes('fries') || nameLower.includes('snack') ||
                          nameLower.includes('broth') || nameLower.includes('soup') || nameLower.includes('miso') ||
                          nameLower.includes('bouillon') || nameLower.includes('stock');
  const sodiumPer100g = (itemNutrients.sodium / itemWeight) * 100;
  if (!isCuredOrSalted && sodiumPer100g > 500) {
    const realisticSodium = Math.round((250 + (addedSodium / (itemWeight / 100) || 150)) * (itemWeight / 100));
    if (addDebugLog) {
      addDebugLog(`[Dietitian Reality Check] Sodium for "${itemName}" (${itemNutrients.sodium}mg) was unrealistically high for a non-cured item. Reality check adjusted sodium from ${itemNutrients.sodium}mg to ${realisticSodium}mg.`);
    }

    itemNutrients.sodium = realisticSodium;
  }

  // 4b. Fast-Food Commercial Sodium Floor (Tier 3 Guardrail)
  applyCommercialSodiumFloor(itemName, itemNutrients, dbSource, addDebugLog, ctx);

  // 4c. Saturated Fat & Added Sugar Floor Guardrails
  applySatFatAndAddedSugarFloor(itemName, itemNutrients, dbSource, addDebugLog, ctx);

  // 2. Fibre Reality Check (Specific for Kimchi / Radish)
  const isKimchiOrRadish = nameLower.includes('kimchi') || nameLower.includes('radish') || nameLower.includes('daikon') || nameLower.includes('kkakdugi');
  if (isKimchiOrRadish && (!itemNutrients.totalFibre || itemNutrients.totalFibre < 0.5)) {
    const expectedFibre = parseFloat(((1.6 / 100) * itemWeight).toFixed(2));
    const expectedSoluble = parseFloat(((0.5 / 100) * itemWeight).toFixed(2));
    if (addDebugLog) {
      addDebugLog(`[Dietitian Reality Check] Applied fibre estimation for "${itemName}" (kimchi/radish). Added ${expectedFibre}g total fibre, ${expectedSoluble}g soluble fibre.`);
    }
    itemNutrients.totalFibre = Math.max(itemNutrients.totalFibre || 0, expectedFibre);
    itemNutrients.solubleFibre = Math.max(itemNutrients.solubleFibre || 0, expectedSoluble);
  }

  // Ensure lipid sub-components sum cleanly to totalFat
  if (itemNutrients.totalFat > 0 || (itemNutrients.saturatedFat || 0) > 0 || (itemNutrients.transFat || 0) > 0) {
    // 4d. Dairy / Natural Ruminant Trans Fat Clamping
    // Natural ruminant trans fat in pure dairy products (butter, cream, ghee, cheese) is at most 3-4.5% of total fat.
    // Artificial/hydrogenated trans fat levels (e.g. 20-30% of fat) should not be applied to pure dairy butter.
    const isDairyFat = /\b(butter|ghee|dairy|cream|cow milk|cheese|curd)\b/i.test(identityForChecks) &&
      !/\b(margarine|shortening|hydrogenated|partially\s+hydrogenated|spread|frosting|pastry\s+shortening)\b/i.test(identityForChecks);
    if (isDairyFat && itemNutrients.transFat !== undefined && itemNutrients.transFat !== null && itemNutrients.totalFat > 0) {
      const maxDairyTransFat = Math.round(itemNutrients.totalFat * 0.045 * 10) / 10;
      if (itemNutrients.transFat > maxDairyTransFat) {
        if (addDebugLog) {
          addDebugLog(`[Dietitian Reality Check] Trans fat for dairy item "${itemName}" (${itemNutrients.transFat}g) exceeded natural ruminant ceiling (4.5% of ${itemNutrients.totalFat}g fat). Clamped trans fat to ${maxDairyTransFat}g.`);
        }
        itemNutrients.transFat = maxDairyTransFat;
      }
    }

    if (itemNutrients.saturatedFat > (itemNutrients.totalFat || 0)) {
      itemNutrients.totalFat = itemNutrients.saturatedFat;
    }
    if (itemNutrients.transFat > (itemNutrients.totalFat || 0)) {
      itemNutrients.totalFat = itemNutrients.transFat;
    }
    if ((itemNutrients.saturatedFat || 0) + (itemNutrients.transFat || 0) > (itemNutrients.totalFat || 0)) {
      itemNutrients.totalFat = parseFloat(((itemNutrients.saturatedFat || 0) + (itemNutrients.transFat || 0)).toFixed(2));
    }
    itemNutrients.unsaturatedFat = parseFloat(Math.max(0, (itemNutrients.totalFat || 0) - (itemNutrients.saturatedFat || 0) - (itemNutrients.transFat || 0)).toFixed(2));
  }

  // Backfill missing/zero soluble fibre based on food category when totalFibre > 0
  backfillSolubleFibre(itemNutrients, identityForChecks || itemName, addDebugLog);

  // Backfill sparse/missing micronutrients from category fallback profile
  backfillSparseMicronutrients(itemName, itemWeight, itemNutrients, dbSource, identityForChecks || itemName, addDebugLog);


  // 2. Protein Reality Check
  const proteinPer100g = (itemNutrients.protein / itemWeight) * 100;
  const isProteinPowder = nameLower.includes('powder') || nameLower.includes('isolate') || nameLower.includes('whey');
  if (!isProteinPowder && proteinPer100g > 45) {
     const realisticProtein = 45 * (itemWeight / 100);
     if (addDebugLog) {
       addDebugLog(`[Dietitian Reality Check] Protein for "${itemName}" (${itemNutrients.protein}g) exceeded 45g/100g ceiling. Capped to ${realisticProtein}g.`);
     }
     itemNutrients.protein = realisticProtein;
  }

  // 5. GENERIC Caloric Density Plausibility Check (applies to ALL food categories,
  // not name-specific). Catches wrong DB matches / hallucinated LLM estimates that
  // produce a physically implausible kcal-per-100g for the food's general category.
  // Intentionally wide bounds with extra margin — this is a coarse safety net for
  // gross errors (e.g. 400% off), not a precise validator, to avoid false positives.
  if (typeof itemNutrients.calories === 'number' && itemWeight > 0) {
    const CALORIC_DENSITY_BOUNDS: Record<string, [number, number]> = {
      bakery_dessert: [180, 600],
      meat_seafood: [60, 450],
      dairy_solid: [250, 750],
      raw_ingredient_dry_fat: [200, 900],
      grain_bakery_snack: [100, 560],
      fruit_vegetable: [10, 180],
      beverage: [0, 220],
      sauce_condiment: [20, 750],
      compound_meal: [80, 520],
      prepared_dish: [80, 520],
    };
    const pfClass = classifyUniversalPhysicalFormV3({ name: itemName, canonicalDbName: itemName, keyword: itemName });
    const isJellyOrMousse = /\b(jelly|gelatin|mousse|pudding|custard|flan)\b/i.test(itemName);
    const isWrapOrSandwich = /\b(wrap|sandwich|burrito|panini|burger|sub|taco)\b/i.test(itemName);
    const bounds = isJellyOrMousse ? [50, 300] : isWrapOrSandwich ? [80, 550] : (CALORIC_DENSITY_BOUNDS[pfClass.primaryCategory] || [50, 600]);
    if (bounds) {
      const [floor, ceiling] = bounds;
      const caloriesPer100g = (itemNutrients.calories / itemWeight) * 100;
      if (caloriesPer100g < floor * 0.5 || caloriesPer100g > ceiling * 1.6) {
        const midpointPer100g = (floor + ceiling) / 2;
        const realisticCalories = Math.round(midpointPer100g * (itemWeight / 100));
        const oldCal = itemNutrients.calories || 1;
        const scaleRatio = realisticCalories / oldCal;
        if (addDebugLog) {
          addDebugLog(`[Dietitian Reality Check] Caloric density for "${itemName}" (${Math.round(caloriesPer100g)} kcal/100g) was implausible for category "${pfClass.primaryCategory}" (expected ~${floor}-${ceiling} kcal/100g). Rescaled ${itemNutrients.calories} kcal -> ${realisticCalories} kcal for ${itemWeight}g.`);
        }
        itemNutrients.calories = realisticCalories;

        if (itemNutrients.totalFat) {
          itemNutrients.totalFat = Math.round(itemNutrients.totalFat * scaleRatio * 10) / 10;
        }
        if (itemNutrients.saturatedFat !== undefined && itemNutrients.saturatedFat !== null) {
          const ratio = getSaturatedFatRatio(itemName);
          const maxSatFat = (itemNutrients.totalFat || 0) * ratio;
          itemNutrients.saturatedFat = Math.min(
            Math.round(itemNutrients.saturatedFat * scaleRatio * 10) / 10,
            Math.round(maxSatFat * 10) / 10
          );
        }
        if (itemNutrients.protein) {
          itemNutrients.protein = Math.round(itemNutrients.protein * scaleRatio * 10) / 10;
        }
        if (itemNutrients.carbohydrates) {
          itemNutrients.carbohydrates = Math.round(itemNutrients.carbohydrates * scaleRatio * 10) / 10;
        }
        if (itemNutrients.transFat !== undefined && itemNutrients.transFat !== null) {
          itemNutrients.transFat = Math.min(itemNutrients.totalFat || 0, Math.round(itemNutrients.transFat * scaleRatio * 10) / 10);
        }
        if (itemNutrients.sugar !== undefined && itemNutrients.sugar !== null) {
          itemNutrients.sugar = Math.min(itemNutrients.carbohydrates || 0, Math.round(itemNutrients.sugar * scaleRatio * 10) / 10);
        }
        if (itemNutrients.addedSugar !== undefined && itemNutrients.addedSugar !== null) {
          itemNutrients.addedSugar = Math.min(itemNutrients.sugar ?? (itemNutrients.carbohydrates || 0), Math.round(itemNutrients.addedSugar * scaleRatio * 10) / 10);
        }
        checkAtwaterConsistency(itemName, itemNutrients, addDebugLog);
      }
    }
  }

  // 6. Mass Conservation & Physical Macro/Moisture Ceiling Guard
  if (itemWeight > 0) {
    const p = itemNutrients.protein || 0;
    const c = itemNutrients.carbohydrates || 0;
    const f = itemNutrients.totalFat || 0;
    const macroSum = p + c + f;

    // Determine max physical dry matter fraction based on physical moisture category
    let maxMacroCeiling = itemWeight;
    const isWateryDrink = /\b(water|tea|black\s*coffee|diet\s*soda|clear\s*broth)\b/i.test(identityForChecks);
    const isHighMoisture = /\b(gelatin|jell-?o|jelly|mousse|pudding|custard|soup|broth|consomme)\b/i.test(identityForChecks);
    if (isWateryDrink) {
      maxMacroCeiling = itemWeight * 0.15;
    } else if (isHighMoisture) {
      maxMacroCeiling = itemWeight * 0.45;
    }

    if (macroSum > maxMacroCeiling && macroSum > 0) {
      const massScale = maxMacroCeiling / macroSum;
      if (addDebugLog) {
        addDebugLog(`[Mass Conservation Guard] "${itemName}": Total macros (${macroSum.toFixed(1)}g = P:${p}g + C:${c}g + F:${f}g) exceeded physical ceiling (${maxMacroCeiling.toFixed(1)}g for ${itemWeight}g). Rescaling macros.`);
      }
      itemNutrients.protein = Math.round(p * massScale * 10) / 10;
      itemNutrients.carbohydrates = Math.round(c * massScale * 10) / 10;
      itemNutrients.totalFat = Math.round(f * massScale * 10) / 10;
      if (itemNutrients.saturatedFat !== undefined && itemNutrients.saturatedFat !== null) {
        itemNutrients.saturatedFat = Math.min(itemNutrients.totalFat, Math.round(itemNutrients.saturatedFat * massScale * 10) / 10);
      }
      if (itemNutrients.transFat !== undefined && itemNutrients.transFat !== null) {
        itemNutrients.transFat = Math.min(itemNutrients.totalFat, Math.round(itemNutrients.transFat * massScale * 10) / 10);
      }
      if (itemNutrients.sugar !== undefined && itemNutrients.sugar !== null) {
        itemNutrients.sugar = Math.min(itemNutrients.carbohydrates, Math.round(itemNutrients.sugar * massScale * 10) / 10);
      }
      if (itemNutrients.addedSugar !== undefined && itemNutrients.addedSugar !== null) {
        itemNutrients.addedSugar = Math.min(itemNutrients.sugar ?? itemNutrients.carbohydrates, Math.round(itemNutrients.addedSugar * massScale * 10) / 10);
      }
      const sat = itemNutrients.saturatedFat || 0;
      const trans = itemNutrients.transFat || 0;
      itemNutrients.unsaturatedFat = parseFloat(Math.max(0, (itemNutrients.totalFat || 0) - sat - trans).toFixed(2));
      itemNutrients.calories = Math.round((itemNutrients.protein || 0) * 4 + (itemNutrients.carbohydrates || 0) * 4 + (itemNutrients.totalFat || 0) * 9);
    }
  }
}

export function sanitizeVerdictLabel(rawLabel: string, level?: string, nutrients?: any, lang?: unknown): string {
  const locale = normalizeLocale(lang);
  let label = String(rawLabel || '').trim();
  if (!label) return t(locale, 'verdictSupportsMetabolicEnergy');
  if (locale !== 'en') return label;

  // Strip wrapping quotes and extra whitespace
  label = label.replace(/^["']|["']$/g, '').trim();

  // If label is describing a food/meal entity rather than a biological health outcome or metric overage, convert it
  const entityNounPattern = /\b(?:meal|dish|dinner|lunch|breakfast|snack|food|bowl|pot|soup|platter|choice|asset|option|selection|entry|item|spread|entree|plate|combo|source|portion|serving|treat|treats|drink|beverage|shake|smoothie|dessert|feast|side|sides|main|mains|recipe|cuisine|package|bite|bites|product|products|preparation|preparations|assembly|formulation|profile|offering|offerings|delight|fare|fuel|pick|picks|starter|starters|appetizer|appetizers)\b/i;
  const descriptorAdjPattern = /\b(?:exceptional|solid|great|good|healthy|nutrient|dense|rich|carb|heavy|high|lean|protein|low|calorie|calories|fiber|fibre|sodium|packed|balanced|macro|macros|clean|pure|light|heavy|hearty|fat|sugar)\b/i;
  const standaloneMealPattern = /\b(?:high\s+protein|lean\s+protein|protein\s+packed|protein\s+dense|protein\s+rich|nutrient\s+dense|nutrient\s+rich|low\s+calorie|high\s+calorie|high\s+fiber|fiber\s+rich|carb\s+heavy|low\s+sodium|high\s+sodium|balanced\s+macro|exceptional\s+high|exceptional\s+lean|high\s+fat|low\s+fat|high\s+carb|low\s+carb|low\s+sugar|high\s+sugar|sugar\s+free|fat\s+free)\b/i;
  const biologicalActionPattern = /\b(?:supports|boosts|maintains|promotes|aids|improves|enhances|helps|fuels|protects|regulates|good\s+for|healthy\s+for|sustains|optimizes)\b/i;
  const metricImpactPattern = /\b(?:\d+%|over|limit|target|excess|deficit)\b/i;

  const isGenericMealDescriptor =
    entityNounPattern.test(label) ||
    (standaloneMealPattern.test(label) && !biologicalActionPattern.test(label) && !metricImpactPattern.test(label)) ||
    (!biologicalActionPattern.test(label) && !metricImpactPattern.test(label));

  if (isGenericMealDescriptor) {
    if (level === 'alert' || level === 'warning') {
      if (nutrients?.saturatedFat && nutrients.saturatedFat >= 10) {
        return 'Elevated saturated fat impact';
      }
      if (nutrients?.sodium && nutrients.sodium >= 1000) {
        return 'Elevated sodium impact';
      }
      if (nutrients?.addedSugar && nutrients.addedSugar >= 20) {
        return 'Elevated added sugar impact';
      }
      return 'Requires mindful portion balance';
    }

    if (nutrients?.protein && nutrients.protein >= 30) {
      return 'Boosts lean muscle tissue';
    }
    if ((nutrients?.totalFibre || nutrients?.fiber) && (nutrients.totalFibre >= 8 || nutrients.fiber >= 8)) {
      return 'Supports digestive health';
    }
    if (nutrients?.sodium && nutrients.sodium <= 500 && nutrients?.calories && nutrients.calories < 600) {
      return 'Good for your heart';
    }
    if (nutrients?.addedSugar && nutrients.addedSugar >= 20) {
      return 'Requires mindful sugar balance';
    }
    if (nutrients?.sugar && nutrients.sugar >= 35) {
      return 'High simple carbohydrate load';
    }
    return 'Supports sustained metabolic energy';
  }

  // Ensure word count is 3-6 words
  const words = label.split(/\s+/);
  if (words.length > 6) {
    label = words.slice(0, 6).join(' ');
  }

  return label;
}

export function itemsMatchByName(oldName: string, newName: string): boolean {
  if (!oldName || !newName) return false;
  const o = oldName.toLowerCase().trim();
  const n = newName.toLowerCase().trim();
  if (o === n) return true;

  const oldWords = o.split(/\s+/).filter(w => w.length > 2);
  const newWords = n.split(/\s+/).filter(w => w.length > 2);
  if (oldWords.length === 0 || newWords.length === 0) return o === n;
  if (oldWords.join(' ') === newWords.join(' ')) return true;

  const common = oldWords.filter(w => newWords.includes(w));
  const minLen = Math.min(oldWords.length, newWords.length);
  const maxLen = Math.max(oldWords.length, newWords.length);

  if (common.length / maxLen >= 0.75) return true;
  if (minLen >= 2 && common.length === minLen && maxLen <= minLen + 1) return true;
  return false;
}

export function synthesizeEditCommandsFromBreakdown(activeMeal: any, dietitianItems: any[] = [], userMessage: string = ''): any[] {
  if (!activeMeal || !Array.isArray(activeMeal.itemsBreakdown) || (!dietitianItems?.length && !userMessage?.trim())) {
    return [];
  }

  const synthesizedCommands: any[] = [];
  const activeItems: any[] = activeMeal.itemsBreakdown || [];
  const uMsgLower = (userMessage || '').toLowerCase().trim();

  if (Array.isArray(dietitianItems) && dietitianItems.length > 0) {

  // Find set of scoutIndices present in dietitianItems
  const touchedScoutIndices = new Set(
    dietitianItems
      .map((it: any) => it.scoutIndex)
      .filter((idx: any) => idx !== undefined && idx !== null && typeof idx === 'number')
  );

  // Check which activeMeal items should be removed
  activeItems.forEach((oldIt: any) => {
    const oldName = String(oldIt.canonicalDbName || oldIt.originalName || oldIt.name || '').toLowerCase().trim();
    const oldScoutIdx = (oldIt.scoutIndex !== undefined && oldIt.scoutIndex !== null && typeof oldIt.scoutIndex === 'number')
      ? oldIt.scoutIndex
      : null;

    // Candidate items in dietitian output to match against oldIt:
    // If scoutIndices are present, restrict matching to dietitianItems at the same scoutIndex.
    const candidateNewItems = (touchedScoutIndices.size > 0 && oldScoutIdx !== null)
      ? dietitianItems.filter((newIt: any) => newIt.scoutIndex === oldScoutIdx)
      : dietitianItems;

    const stillExists = candidateNewItems.some((newIt: any) => {
      const newName = String(newIt.canonicalDbName || newIt.originalName || newIt.name || '').toLowerCase().trim();
      return itemsMatchByName(oldName, newName);
    });

    if (!stillExists) {
      // Determine if oldIt was removed:
      // 1) Explicitly mentioned in user message to remove/replace/split or keywords from oldIt match userMessage
      const isExplicitRemoveInMsg = /\b(remove|delete|omit|without|don't include|no|replace|split|separated?)\b/i.test(userMessage) &&
        (userMessage.toLowerCase().includes(oldName) || oldName.split(/\s+/).some((token: string) => token.length > 3 && userMessage.toLowerCase().includes(token)));

      // 2) The item's scoutIndex was explicitly targeted by Dietitian but oldIt was omitted/replaced
      const isTargetedScoutIndex = touchedScoutIndices.size > 0 && oldScoutIdx !== null && touchedScoutIndices.has(oldScoutIdx);

      // 3) Dietitian provided a breakdown with newly added replacement/split items and omitted oldIt
      const hasNewlyAddedItems = dietitianItems.some((newIt: any) => {
        const newScoutIdx = newIt.scoutIndex;
        return (newScoutIdx === undefined || newScoutIdx === null) && !activeItems.some(a => itemsMatchByName(a.name || a.canonicalDbName, newIt.canonicalDbName || newIt.name));
      });
      const isFullReplacement = hasNewlyAddedItems && dietitianItems.length >= Math.max(1, activeItems.length - 1);

      if (isTargetedScoutIndex || isExplicitRemoveInMsg || isFullReplacement) {
        synthesizedCommands.push({
          action: 'remove_item',
          itemName: oldIt.name || oldIt.canonicalDbName || oldName,
          targetDbId: oldIt.dbId || null
        });
      }
    }
  });

  // Identify weight updates, modifiers, or added items
  dietitianItems.forEach((newIt: any) => {
    const newName = String(newIt.canonicalDbName || newIt.originalName || newIt.name || '').toLowerCase().trim();
    const newScoutIdx = (newIt.scoutIndex !== undefined && newIt.scoutIndex !== null && typeof newIt.scoutIndex === 'number')
      ? newIt.scoutIndex
      : null;

    const candidateOldItems = (newScoutIdx !== null)
      ? activeItems.filter((oldIt: any) => oldIt.scoutIndex === newScoutIdx)
      : activeItems;

    let matchedOld = candidateOldItems.find((oldIt: any) => {
      const oldName = String(oldIt.canonicalDbName || oldIt.originalName || oldIt.name || '').toLowerCase().trim();
      return itemsMatchByName(oldName, newName);
    });

    if (!matchedOld && newScoutIdx === null) {
      matchedOld = activeItems.find((oldIt: any) => {
        const oldName = String(oldIt.canonicalDbName || oldIt.originalName || oldIt.name || '').toLowerCase().trim();
        return itemsMatchByName(oldName, newName);
      });
    }

    if (matchedOld) {
      if (newIt.weightGrams && Number(newIt.weightGrams) !== Number(matchedOld.weightGrams)) {
        synthesizedCommands.push({
          action: 'update_weight',
          itemName: matchedOld.name || matchedOld.canonicalDbName || newName,
          targetDbId: matchedOld.dbId || null,
          newWeightGrams: Number(newIt.weightGrams)
        });
      }
      if (newIt.cookingMethod && matchedOld.cookingMethod && newIt.cookingMethod.toLowerCase() !== matchedOld.cookingMethod.toLowerCase()) {
        synthesizedCommands.push({
          action: 'update_cooking_method',
          itemName: matchedOld.name || matchedOld.canonicalDbName || newName,
          targetDbId: matchedOld.dbId || null,
          newMethod: newIt.cookingMethod
        });
      }
      if (newIt.canonicalDbName && newIt.canonicalDbName !== matchedOld.canonicalDbName && newIt.canonicalDbName !== matchedOld.name) {
        synthesizedCommands.push({
          action: 'rename_alias',
          itemName: matchedOld.name || matchedOld.canonicalDbName,
          targetDbId: matchedOld.dbId || null,
          newItemName: newIt.canonicalDbName
        });
      }
    } else if (!matchedOld && newIt.weightGrams) {
      synthesizedCommands.push({
        action: 'add_item',
        itemName: newIt.canonicalDbName || newIt.name || 'Food Item',
        newWeightGrams: Number(newIt.weightGrams)
      });
    }
  });
  }

  // Check for modifier commands in userMessage (e.g., "the tea is unsweetened", "I had es teh tawar", "no oil", "no salt")
  if (/\b(unsweetened|unsweatened|no\s*sugar|zero\s*sugar|without\s*sugar|sugar\s*free|tawar|tanpa\s*gula|bebas\s*gula|tidak\s*manis|tidak\s*pake\s*gula|tidak\s*pakai\s*gula|ga\s*pake\s*gula|gak\s*pake\s*gula|plain\s*tea)\b/i.test(uMsgLower)) {
    const teaItem = activeItems.find((it: any) => {
      const n = String(it.name || it.canonicalDbName || it.originalName || it.originalLocalName || it.keyword || '').toLowerCase();
      const type = String(it.foodType || '').toLowerCase();
      const hasTeaWord = n.includes('tea') || n.includes('teh') || n.includes('beverage') || n.includes('drink') || n.includes('coffee') || n.includes('kopi') || n.includes('juice') || n.includes('latte') || type === 'beverage' || type === 'drink' || (Array.isArray(it.components) && it.components.some((c: any) => {
        const cn = String(c.name || c.keyword || c.searchQuery || '').toLowerCase();
        return cn.includes('tea') || cn.includes('teh') || cn.includes('coffee') || cn.includes('drink') || cn.includes('beverage');
      }));
      return hasTeaWord && !n.includes('unsweetened') && !n.includes('tawar');
    });
    if (teaItem && !synthesizedCommands.some(c => c.action === 'update_modifier' && (c.itemName === teaItem.name || c.itemName === teaItem.canonicalDbName || c.itemName === teaItem.originalName))) {
      synthesizedCommands.push({
        action: 'update_modifier',
        itemName: teaItem.name || teaItem.canonicalDbName || teaItem.originalName,
        targetDbId: teaItem.dbId || null,
        modifier: 'unsweetened'
      });
    }
  } else if (/\b(no\s*oil|without\s*oil|oil\s*free|no\s*fat|without\s*fat|fat\s*free|tanpa\s*minyak|bebas\s*minyak)\b/i.test(uMsgLower)) {
    const targetItem = activeItems.find((it: any) => {
      const n = String(it.name || it.canonicalDbName || it.originalName || it.keyword || '').toLowerCase();
      return uMsgLower.includes(n) || n.split(/\s+/).some((t: string) => t.length > 3 && uMsgLower.includes(t)) || activeItems.length === 1;
    }) || activeItems[0];
    if (targetItem && !synthesizedCommands.some(c => c.action === 'update_modifier')) {
      synthesizedCommands.push({
        action: 'update_modifier',
        itemName: targetItem.name || targetItem.canonicalDbName || targetItem.originalName,
        targetDbId: targetItem.dbId || null,
        modifier: 'no oil'
      });
    }
  } else if (/\b(no\s*salt|without\s*salt|salt\s*free|unsalted|tanpa\s*garam|bebas\s*garam)\b/i.test(uMsgLower)) {
    const targetItem = activeItems.find((it: any) => {
      const n = String(it.name || it.canonicalDbName || it.originalName || it.keyword || '').toLowerCase();
      return uMsgLower.includes(n) || n.split(/\s+/).some((t: string) => t.length > 3 && uMsgLower.includes(t)) || activeItems.length === 1;
    }) || activeItems[0];
    if (targetItem && !synthesizedCommands.some(c => c.action === 'update_modifier')) {
      synthesizedCommands.push({
        action: 'update_modifier',
        itemName: targetItem.name || targetItem.canonicalDbName || targetItem.originalName,
        targetDbId: targetItem.dbId || null,
        modifier: 'no salt'
      });
    }
  }

  // Check for portion update syntax in userMessage (e.g. "Lemonilo Brownies Crispy: 15g ➔ 30g")
  const arrowRegex = /([a-zA-Z0-9\s/'-]+?):\s*\d+(?:\.\d+)?\s*g\s*(?:➔|->)\s*(\d+(?:\.\d+)?)\s*g/gi;
  let arrowMatch: RegExpExecArray | null;
  while ((arrowMatch = arrowRegex.exec(userMessage)) !== null) {
    const matchedName = arrowMatch[1].trim().toLowerCase();
    const targetGrams = Math.round(Number(arrowMatch[2]));
    if (targetGrams > 0) {
      const targetItem = activeItems.find((it: any) => {
        const n = String(it.name || it.canonicalDbName || it.originalName || it.keyword || '').toLowerCase();
        return itemsMatchByName(n, matchedName) || n.includes(matchedName) || matchedName.includes(n);
      });
      if (targetItem && !synthesizedCommands.some(c => (c.action === 'update_weight' || c.action === 'set_weight') && (c.itemName === targetItem.name || c.itemName === targetItem.canonicalDbName))) {
        synthesizedCommands.push({
          action: 'update_weight',
          itemName: targetItem.name || targetItem.canonicalDbName || targetItem.originalName,
          targetDbId: targetItem.dbId || null,
          newWeightGrams: targetGrams,
        });
      }
    }
  }

  return synthesizedCommands;
}

export function synchronizeNarrativeText(
  text: string,
  grandCal: number,
  grandP: number,
  grandFat: number,
  grandSatFat: number,
  grandNa: number,
  grandCarbs?: number,
  grandFiber?: number
): string {
  if (!text || typeof text !== 'string') return text;

  let updated = text;

  const calVal = Math.round(grandCal);
  const pVal = Math.round(grandP * 10) / 10;
  const fatVal = Math.round(grandFat * 10) / 10;
  const satFatVal = Math.round(grandSatFat * 10) / 10;
  const naVal = Math.round(grandNa);
  const naFormatted = naVal.toLocaleString('en-US');

  const safeAdj = `(?:(?!\b(?:and|with|plus|or|including|protein|fat|calories|sugar|sodium|carbs|carbohydrates|carbohydrate|fiber|fibre)\b)[a-zA-Z-]+\\s+){0,2}`;

  // 1. Calories
  const calRe = new RegExp(`\\b([\\d,]+(?:\\.\\d+)?)\\s*(${safeAdj}(?:calories|kcal))\\b`, 'gi');
  updated = updated.replace(calRe, (match, num, rest) => `${calVal} ${rest}`);
  updated = updated.replace(/((?:calories|energy)\s*\(\s*)(?:[\d,]+(?:\.\d+)?)\s*(?:kcal|calories|g)?(\s*\))/gi, (match, p1, p2) => `${p1}${calVal} kcal${p2}`);

  // 2. Sodium
  const naRe = new RegExp(`\\b([\\d,]+(?:\\.\\d+)?)\\s*(mg\\s*(?:of\\s+)?${safeAdj}sodium)\\b`, 'gi');
  updated = updated.replace(naRe, (match, num, rest) => `${naFormatted}${rest}`);
  updated = updated.replace(/(sodium\s*\(\s*)(?:[\d,]+(?:\.\d+)?)\s*mg(\s*\))/gi, (match, p1, p2) => `${p1}${naFormatted}mg${p2}`);
  updated = updated.replace(/(sodium\s*(?:[a-zA-Z-]+\s+){0,3}(?:to|is|at|under|below|around|of|:)\s*)([\d,]+(?:\.\d+)?)(\s*mg)/gi, (match, p1, num, p3) => `${p1}${naFormatted}${p3}`);

  // 3. Saturated Fat
  const satFatRe = new RegExp(`\\b([\\d,]+(?:\\.\\d+)?)\\s*(g\\s*(?:of\\s+)?${safeAdj}saturated\\s*fat)\\b`, 'gi');
  updated = updated.replace(satFatRe, (match, num, rest) => `${satFatVal}${rest}`);
  updated = updated.replace(/(saturated\s*fat\s*\(\s*)(?:[\d,]+(?:\.\d+)?)\s*g(\s*\))/gi, (match, p1, p2) => `${p1}${satFatVal}g${p2}`);
  updated = updated.replace(/(saturated\s*fat\s*:\s*)([\d,]+(?:\.\d+)?)(\s*g)/gi, (match, p1, num, p3) => `${p1}${satFatVal}${p3}`);
  updated = updated.replace(/(saturated\s*fat\s*(?:[a-zA-Z-]+\s+){0,3}(?:to|is|at|under|below|around|of|:)\s*)([\d,]+(?:\.\d+)?)(\s*g)/gi, (match, p1, num, p3) => `${p1}${satFatVal}${p3}`);

  // 4. Total Fat
  const fatRe = new RegExp(`\\b([\\d,]+(?:\\.\\d+)?)\\s*(g\\s*(?:of\\s+)?${safeAdj}total\\s*fat)\\b`, 'gi');
  updated = updated.replace(fatRe, (match, num, rest) => `${fatVal}${rest}`);

  // 5. Protein
  const pRe = new RegExp(`\\b([\\d,]+(?:\\.\\d+)?)\\s*(g\\s*(?:of\\s+)?${safeAdj}protein)\\b`, 'gi');
  updated = updated.replace(pRe, (match, num, rest) => `${pVal}${rest}`);
  updated = updated.replace(/(protein\s*\(\s*)(?:[\d,]+(?:\.\d+)?)\s*g(\s*\))/gi, (match, p1, p2) => `${p1}${pVal}g${p2}`);
  updated = updated.replace(/(protein\s*:\s*)([\d,]+(?:\.\d+)?)(\s*g)/gi, (match, p1, num, p3) => `${p1}${pVal}${p3}`);
  updated = updated.replace(/(protein\s*(?:[a-zA-Z-]+\s+){0,3}(?:to|is|at|under|below|around|of|:)\s*)([\d,]+(?:\.\d+)?)(\s*g)/gi, (match, p1, num, p3) => `${p1}${pVal}${p3}`);

  // 6. Carbohydrates
  if (grandCarbs !== undefined && grandCarbs > 0) {
    const carbVal = Math.round(grandCarbs * 10) / 10;
    const carbRe = new RegExp(`\\b([\\d,]+(?:\\.\\d+)?)\\s*(g\\s*(?:of\\s+)?${safeAdj}(?:carbohydrates|carbs))\\b`, 'gi');
    updated = updated.replace(carbRe, (match, num, rest) => `${carbVal}${rest}`);
    updated = updated.replace(/(carbohydrates\s*\(\s*)(?:[\d,]+(?:\.\d+)?)\s*g(\s*\))/gi, (match, p1, p2) => `${p1}${carbVal}g${p2}`);
    updated = updated.replace(/(carbs\s*\(\s*)(?:[\d,]+(?:\.\d+)?)\s*g(\s*\))/gi, (match, p1, p2) => `${p1}${carbVal}g${p2}`);
  }

  // 7. Fiber
  if (grandFiber !== undefined && grandFiber >= 0) {
    const fiberVal = Math.round(grandFiber * 10) / 10;
    const fiberRe = new RegExp(`\\b([\\d,]+(?:\\.\\d+)?)\\s*(g\\s*(?:of\\s+)?${safeAdj}(?:fiber|fibre|dietary\\s*fiber|dietary\\s*fibre))\\b`, 'gi');
    updated = updated.replace(fiberRe, (match, num, rest) => `${fiberVal}${rest}`);
    updated = updated.replace(/((?:dietary\s*fiber|dietary\s*fibre|fiber|fibre)\s*\(\s*)(?:[\d,]+(?:\.\d+)?)\s*g(\s*\))/gi, (match, p1, p2) => `${p1}${fiberVal}g${p2}`);
    updated = updated.replace(/((?:dietary\s*fiber|dietary\s*fibre|fiber|fibre)\s*(?:[a-zA-Z-]+\s+){0,3}(?:to|is|at|under|below|around|of|:)\s*)([\d,]+(?:\.\d+)?)(\s*g)/gi, (match, p1, num, p3) => `${p1}${fiberVal}${p3}`);
  }

  return updated;
}



// Quantity words that make the plural/singular form already visible in a title
// grammatically correct regardless of itemsBreakdown's own canonical form
// (e.g. "Two Croissants" is correct even if canonicalDbName is singular "Croissant";
// "A Croissant" is correct even if canonicalDbName is plural "Croissants").
const TITLE_PARITY_SINGULAR_QUANTITY_RE = /^(a|an|one|1)$/i;
const TITLE_PARITY_PLURAL_QUANTITY_RE = /^(\d+|two|three|four|five|six|seven|eight|nine|ten|couple|few|several|many)$/i;

function pluralizeSimpleWord(word: string): string {
  if (/[sxz]$/i.test(word) || /(ch|sh)$/i.test(word)) return `${word}es`;
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

function singularizeSimpleWord(word: string): string {
  if (/ies$/i.test(word)) return `${word.slice(0, -3)}y`;
  if (/(ches|shes|xes|zes|ses)$/i.test(word)) return word.slice(0, -2);
  if (/s$/i.test(word) && !/ss$/i.test(word)) return word.slice(0, -1);
  return word;
}

/**
 * Enforces singular/plural parity between the composite meal title and each item's own
 * canonicalDbName/name in itemsBreakdown, per the system-prompt rule that requires them to
 * match exactly (e.g. itemsBreakdown "Croissant" (singular) but title says "Croissants").
 * The LLM is only asked to do this via prompt instruction with no code-level enforcement,
 * so mismatches slip through. Skips correction when a quantity word already visible in the
 * title (e.g. "Two", "A", "3") independently justifies the form that's already there.
 */
export function enforceTitlePluralParity(title: string, itemsBreakdown: any[]): string {
  if (!title || typeof title !== 'string' || !Array.isArray(itemsBreakdown) || itemsBreakdown.length === 0) {
    return title;
  }

  let updated = title;

  for (const it of itemsBreakdown) {
    const canonicalName = String((it && (it.canonicalDbName || it.name)) || '').trim();
    if (!canonicalName) continue;

    const words = canonicalName.split(/\s+/);
    const lastWord = words[words.length - 1];
    const restPrefix = words.slice(0, -1).join(' ');

    const singularLast = singularizeSimpleWord(lastWord);
    const pluralLast = pluralizeSimpleWord(singularLast);
    const canonicalIsPlural = lastWord.toLowerCase() === pluralLast.toLowerCase();
    const wrongFormLast = canonicalIsPlural ? singularLast : pluralLast;
    if (!wrongFormLast || wrongFormLast.toLowerCase() === lastWord.toLowerCase()) continue;

    const wrongPhrase = restPrefix ? `${restPrefix} ${wrongFormLast}` : wrongFormLast;
    const correctPhrase = restPrefix ? `${restPrefix} ${lastWord}` : lastWord;
    const escaped = wrongPhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const re = new RegExp(`(\\S+\\s+)?\\b${escaped}\\b`, 'gi');
    updated = updated.replace(re, (match: string, precedingWord: string) => {
      const token = precedingWord ? precedingWord.trim() : '';
      if (canonicalIsPlural && TITLE_PARITY_SINGULAR_QUANTITY_RE.test(token)) return match;
      if (!canonicalIsPlural && TITLE_PARITY_PLURAL_QUANTITY_RE.test(token)) return match;
      return precedingWord ? `${precedingWord}${correctPhrase}` : correctPhrase;
    });
  }

  return updated;
}

export function build31NutrientsMarkdownServer(nutrients: Record<string, any>): string {
  if (!nutrients) return '';

  const coreList = [
    { key: 'calories', label: 'Calories', unit: 'kcal' },
    { key: 'protein', label: 'Protein', unit: 'g' },
    { key: 'carbohydrates', label: 'Carbohydrates', unit: 'g' },
    { key: 'totalFat', label: 'Total Fat', unit: 'g' },
    { key: 'saturatedFat', label: 'Saturated Fat', unit: 'g' },
    { key: 'transFat', label: 'Trans Fat', unit: 'g' },
    { key: 'addedSugar', label: 'Added Sugar', unit: 'g' },
    { key: 'sodium', label: 'Sodium', unit: 'mg' },
    { key: 'potassium', label: 'Potassium', unit: 'mg' },
    { key: 'totalFibre', label: 'Total Fibre', unit: 'g' },
    { key: 'solubleFibre', label: 'Soluble Fibre', unit: 'g' },
  ];

  const additionalList = [
    { key: 'unsaturatedFat', label: 'Unsaturated Fat', unit: 'g' },
    { key: 'omega3', label: 'Omega-3', unit: 'g' },
    { key: 'salt', label: 'Salt', unit: 'g' },
    { key: 'magnesium', label: 'Magnesium', unit: 'mg' },
    { key: 'calcium', label: 'Calcium', unit: 'mg' },
    { key: 'iron', label: 'Iron', unit: 'mg' },
    { key: 'zinc', label: 'Zinc', unit: 'mg' },
    { key: 'selenium', label: 'Selenium', unit: 'mcg' },
    { key: 'iodine', label: 'Iodine', unit: 'mcg' },
    { key: 'phosphorus', label: 'Phosphorus', unit: 'mg' },
    { key: 'vitaminD', label: 'Vitamin D', unit: 'IU' },
    { key: 'vitaminB12', label: 'Vitamin B12', unit: 'mcg' },
    { key: 'folate', label: 'Folate (B9)', unit: 'mcg' },
    { key: 'vitaminC', label: 'Vitamin C', unit: 'mg' },
    { key: 'vitaminE', label: 'Vitamin E', unit: 'mg' },
    { key: 'vitaminK', label: 'Vitamin K', unit: 'mcg' },
    { key: 'vitaminA', label: 'Vitamin A', unit: 'mcg' },
    { key: 'vitaminB6', label: 'Vitamin B6', unit: 'mg' },
    { key: 'thiamine', label: 'Thiamine (B1)', unit: 'mg' },
    { key: 'riboflavin', label: 'Riboflavin (B2)', unit: 'mg' },
    { key: 'niacin', label: 'Niacin (B3)', unit: 'mg' },
  ];

  const fmt = (v: any, unit: string) => {
    if (v === undefined || v === null || isNaN(Number(v))) return '--';
    const num = Math.round(Number(v) * 100) / 100;
    return unit ? `${num} ${unit}` : `${num}`;
  };

  const coreRows = coreList.map(item => `| ${item.label} | ${fmt(nutrients[item.key], item.unit)} |`);
  const populatedAdd = additionalList.filter(item => {
    const val = nutrients[item.key];
    return val !== undefined && val !== null && !isNaN(Number(val)) && Number(val) > 0;
  });
  const addRows = populatedAdd.map(item => `| ${item.label} | ${fmt(nutrients[item.key], item.unit)} |`);

  const lines = [
    "\n\n### 📋 Comprehensive Nutrient Values (31 Nutrients)\n",
    "#### Core Nutrients (11)",
    "| Nutrient | Value |",
    "|---|---|",
    ...coreRows
  ];

  if (addRows.length > 0) {
    lines.push(
      `\n#### Additional Nutrients (${addRows.length})`,
      "| Nutrient | Value |",
      "|---|---|",
      ...addRows
    );
  }

  return lines.join("\n");
}

export function backfillSolubleFibre(
  itemNutrients: Record<string, number>,
  itemName: string,
  addDebugLog?: (msg: string) => void
): void {
  if (!itemNutrients || typeof itemNutrients !== 'object') return;
  const totalF = Number(itemNutrients.totalFibre) || 0;
  const currentSoluble = Number(itemNutrients.solubleFibre) || 0;

  if (totalF > 0 && currentSoluble === 0) {
    const nameLower = (itemName || "").toLowerCase();
    let ratio = 0.20; // Default: 20% of total fiber is soluble

    if (/\b(oat|oats|oatmeal|porridge|psyllium|barley|rye)\b/i.test(nameLower)) {
      ratio = 0.35; // Beta-glucan rich oats/barley
    } else if (/\b(apple|apples|pear|pears|peach|peaches|plum|plums|grape|grapes|berry|berries|strawberry|strawberries|blueberry|blueberries|raspberry|raspberries|orange|oranges|citrus|banana|bananas|kiwi|kiwis|melon|melons|mango|mangoes|nectarine|nectarines|apricot|apricots|fig|figs|date|dates|prune|prunes|cherry|cherries|fruit|fruits)\b/i.test(nameLower)) {
      ratio = 0.30; // Pectin rich fresh/dried fruits
    } else if (/\b(bean|beans|lentil|lentils|chickpea|chickpeas|hummus|pea|peas|edamame|soy|soya)\b/i.test(nameLower)) {
      ratio = 0.30; // Legumes
    } else if (/\b(carrot|carrots|broccoli|brussels|sprout|sprouts|sweet potato|potato|potatoes|squash|onion|onions|radish|radishes|beet|beets|spinach|kale|cabbage|cauliflower|vegetable|veg|vegetables)\b/i.test(nameLower)) {
      ratio = 0.25; // Vegetables
    } else if (/\b(chia|flax|flaxseed|flaxseeds|almond|almonds|walnut|walnuts|seed|seeds|nut|nuts)\b/i.test(nameLower)) {
      ratio = 0.25; // Nuts & seeds
    } else if (/\b(wheat|quinoa|rice|bread|breads|cereal|cereals|granola|pasta|noodle|noodles)\b/i.test(nameLower)) {
      ratio = 0.20; // Whole grains/cereals
    }

    const calculated = parseFloat((totalF * ratio).toFixed(2));
    if (calculated > 0) {
      itemNutrients.solubleFibre = Math.min(totalF, calculated);
      if (addDebugLog) {
        addDebugLog(`[Soluble Fibre Backfill] "${itemName}": backfilled soluble fibre (${itemNutrients.solubleFibre}g) from total fibre (${totalF}g) using ratio ${(ratio * 100).toFixed(0)}% for food category.`);
      }
    }
  }
}

export function backfillSparseMicronutrients(
  itemName: string,
  itemWeight: number,
  itemNutrients: Record<string, number>,
  dbSource?: string,
  categoryQuery?: string,
  addDebugLog?: (msg: string) => void
): void {
  if (!itemNutrients || typeof itemNutrients !== 'object') return;
  // Never touch label/brand_official/menu sourced items — a printed zero is truth.
  const isVerifiedSource = dbSource === 'label' || dbSource === 'label_partial' ||
    dbSource === 'brand_official' || dbSource === 'kiosk' || dbSource === 'menu';
  if (isVerifiedSource) return;
  if (!(itemNutrients.calories > 10) || !(itemWeight > 0)) return; // skip trivial/garnish items

  const MICRO_KEYS = [
    'magnesium', 'zinc', 'selenium', 'iodine', 'phosphorus', 'potassium', 'calcium', 'iron',
    'vitaminA', 'vitaminC', 'vitaminD', 'vitaminE', 'vitaminK', 'vitaminB12', 'vitaminB6',
    'folate', 'thiamine', 'riboflavin', 'niacin', 'solubleFibre', 'omega3'
  ];
  const zeroKeys = MICRO_KEYS.filter(k => !itemNutrients[k] || itemNutrients[k] === 0);
  // Only intervene when MOST of the micronutrient list is zero — a single genuine zero
  // (e.g. vitamin C in plain chicken) should not trigger a full backfill.
  if (zeroKeys.length < MICRO_KEYS.length * 0.6) return;

  const q = categoryQuery || itemName || '';
  const categoryProfile = getFallbackCategoryProfile(q);
  
  // Cap the scale factor by calorie density to prevent over-inflating micronutrients 
  // for heavy but watery/diluted foods (like soups) matched to dense categories (like meat).
  const weightScale = itemWeight / 100;
  const calorieScale = (itemNutrients.calories || 0) / Math.max(10, categoryProfile.calories || 100);
  const scaleFactor = Math.min(weightScale, calorieScale * 1.5); // Allow some leeway, but cap severe over-inflation

  zeroKeys.forEach(k => {
    const categoryValue = (categoryProfile[k] || 0) * scaleFactor;
    if (categoryValue > 0) {
      itemNutrients[k] = Math.round(categoryValue * 100) / 100;
    }
  });
  if (addDebugLog) {
    addDebugLog(`[Sparse Micronutrient Backfill] "${itemName}": backfilled ${zeroKeys.length} micronutrient(s) from category profile for "${q}".`);
  }
}

export function checkCategoryAndStateCompatibility(
  query: string,
  candidateName: string
): { compatible: boolean; reason?: string } {
  if (!query || !candidateName) return { compatible: true };
  const q = query.toLowerCase().trim();
  const c = candidateName.toLowerCase().trim();

  // 1. Beverage vs Solid
  const isQBeverage = /\b(beverage|beverages|drink|drinks|water|juice|juices|beer|wine|soda|cola|tea|coffee|latte|mocha|macchiato|smoothie|shake|milk|oat\s*milk|almond\s*milk|soy\s*milk|coconut\s*milk|seltzer|powerade|gatorade|cider|lemonade)\b/i.test(q);
  const isCBeverage = /\b(beverage|beverages|drink|drinks|water|juice|juices|beer|wine|soda|cola|tea|coffee|latte|mocha|macchiato|smoothie|shake|milk|oat\s*milk|almond\s*milk|soy\s*milk|coconut\s*milk|seltzer|powerade|gatorade|cider|lemonade)\b/i.test(c);
  const isQSolid = /\b(egg|eggs|yogurt|cheese|meat|chicken|steak|fish|salad|greens|bread|pastry|cake|cookie|tortilla|rice|pasta|grain|granola|raw\s+fruit|fresh\s+fruit|fresh\s+orange|raw\s+orange)\b/i.test(q);
  const isCSolid = /\b(egg|eggs|yogurt|cheese|meat|chicken|steak|fish|salad|greens|bread|pastry|cake|cookie|tortilla|rice|pasta|grain|granola|raw\s+fruit|fresh\s+fruit)\b/i.test(c);

  if (isQBeverage && (isCSolid || !isCBeverage) && /\b(raw|fresh|peel|sections|slices|whole\s+(?:orange|apple|banana|fruit|vegetable))\b/i.test(c)) {
    return { compatible: false, reason: `Blocked solid whole food candidate ("${candidateName}") for beverage query ("${query}")` };
  }
  if (isQBeverage && isCSolid && !isCBeverage) {
    return { compatible: false, reason: `Blocked solid candidate ("${candidateName}") for beverage query ("${query}")` };
  }
  if (isQSolid && isCBeverage && !isQBeverage) {
    return { compatible: false, reason: `Blocked beverage candidate ("${candidateName}") for solid food query ("${query}")` };
  }

  // 2. Pastry/Bakery vs Dairy/Yogurt/Produce
  const isBakery = /\b(pastry|pastries|danish|donut|doughnut|muffin|croissant|cake|pie|tart|cookie|cookies|brownie|scone|biscuit)\b/i.test(c);
  const isDairyOrProduce = /\b(yogurt|greek\s*yogurt|curd|milk|cheese|cottage\s*cheese|salad|greens|lettuce|spinach|kale|cabbage|apple|banana|orange|berry|berries)\b/i.test(q);
  if (isBakery && isDairyOrProduce && !/\b(pastry|cake|pie|tart)\b/i.test(q)) {
    return { compatible: false, reason: `Blocked bakery/pastry candidate ("${candidateName}") for dairy/produce query ("${query}")` };
  }

  // 3. Meat/Seafood vs Produce/Vegetables
  const isMeatSeafoodCandidate = /\b(beef|steak|pork|bacon|ham|sausage|chicken|turkey|duck|fish|salmon|tuna|cod|shrimp|prawn|crab|lobster|clams|seafood)\b/i.test(c);
  const isVegProduceQuery = /\b(salad|greens|lettuce|spinach|kale|cabbage|broccoli|cauliflower|carrot|cucumber|tomato|zucchini|pepper|onion)\b/i.test(q);
  if (isMeatSeafoodCandidate && isVegProduceQuery && !/\b(chicken|beef|steak|pork|bacon|ham|fish|salmon|tuna|shrimp|prawn|crab|turkey|duck|seafood)\b/i.test(q)) {
    return { compatible: false, reason: `Blocked meat/seafood candidate ("${candidateName}") for plain greens/vegetable query ("${query}")` };
  }

  // 4. Spice/Seasoning vs Fresh/Whole/Meat
  const isSpiceCandidate = /\b(spice|spices|seasoning|seasonings|powder|extract|flavoring|flavouring)\b/i.test(c);
  const isFreshWholeQuery = /\b(fresh|raw|whole|leaf|leaves|fruit|vegetable)\b/i.test(q);
  const isMeatSeafoodQuery = /\b(beef|steak|pork|bacon|ham|sausage|chicken|turkey|duck|fish|salmon|tuna|cod|shrimp|prawn|crab|lobster|clams|seafood)\b/i.test(q);
  if (isSpiceCandidate && isFreshWholeQuery && !/\b(spice|seasoning|powder|extract)\b/i.test(q)) {
    return { compatible: false, reason: `Blocked spice/seasoning candidate ("${candidateName}") for fresh/whole food query ("${query}")` };
  }
  if (isSpiceCandidate && isMeatSeafoodQuery && !/\b(spice|seasoning|powder|extract)\b/i.test(q)) {
    return { compatible: false, reason: `Blocked spice/seasoning candidate ("${candidateName}") for meat/seafood query ("${query}")` };
  }

  // 4b. Salt vs Butter/Fat
  const isSaltQuery = /\b(salt|table salt|sea salt|sodium chloride)\b/i.test(q);
  const isFatCandidate = /\b(butter|margarine|oil|ghee|shortening|lard)\b/i.test(c);
  if (isSaltQuery && isFatCandidate && !/\b(butter|margarine|oil|ghee|shortening|lard)\b/i.test(q)) {
    return { compatible: false, reason: `Blocked fat/butter candidate ("${candidateName}") for salt query ("${query}")` };
  }

  // 4c. Raw Flour/Grain vs Baked/Bread/Tortilla
  const isRawFlourQuery = /\b(flour|wheat flour|all-purpose flour|bread flour|cake flour|rye flour|semolina|cornmeal|raw grain|yeast)\b/i.test(q);
  const isBakedGoodCandidate = /\b(tortilla|tortillas|bread|flatbread|pita|naan|bun|buns|roll|rolls|croissant|pastry|muffin|cake|cookie|donut|doughnut|scone|biscuit|cracker|crackers)\b/i.test(c);
  if (isRawFlourQuery && isBakedGoodCandidate && !/\b(tortilla|bread|pita|naan|bun|roll|croissant|pastry|muffin|cake|cookie|donut|scone|biscuit|cracker)\b/i.test(q)) {
    return { compatible: false, reason: `Blocked baked/bread/tortilla candidate ("${candidateName}") for raw flour/grain query ("${query}")` };
  }

  // 5. Dried/Powder vs Fresh/Cooked
  const isDriedCandidate = /\b(dried|dehydrated|powder|powdered|freeze-dried|flakes)\b/i.test(c);
  const isCookedFreshQuery = /\b(fresh|raw|cooked|boiled|hard-boiled|steamed|grilled|baked|poached)\b/i.test(q);
  if (isDriedCandidate && isCookedFreshQuery && !/\b(dried|dehydrated|powder|powdered|flake|flakes)\b/i.test(q)) {
    return { compatible: false, reason: `Blocked dried/powder candidate ("${candidateName}") for fresh/cooked query ("${query}")` };
  }

  // 6. Condiment vs Produce
  const isCondimentCandidate = /\b(sauce|sauces|dressing|dressings|condiment|condiments|ketchup|mayo|mayonnaise|mustard|syrup|syrups)\b/i.test(c);
  const isProduceQuery = /\b(lettuce|spinach|apple|apples|strawberry|strawberries|kale|cabbage|broccoli|cauliflower|cucumber|cucumbers|tomato|tomatoes|zucchini|onion|onions|garlic)\b/i.test(q);
  if (isCondimentCandidate && isProduceQuery && !/\b(sauce|dressing|condiment|ketchup|mayo|mayonnaise|mustard|syrup)\b/i.test(q)) {
    return { compatible: false, reason: `Blocked condiment candidate ("${candidateName}") for fresh/whole produce query ("${query}")` };
  }

  // 7. Prepared/Spread/Dessert/Salad vs Raw Agricultural Commodity
  const isPreparedOrSpreadQuery = /\b(jam|jelly|preserves?|marmalade|fruit\s*spread|mousse|cake|dessert|seaweed\s*salad|wakame\s*salad|potato\s*salad|coleslaw)\b/i.test(q);
  const isRawCommodityCandidate = /\b(raw|fresh)\b/i.test(c) && !/\b(jam|preserves?|marmalade|spread|mousse|cake|salad|cooked|prepared|sweetened)\b/i.test(c);
  if (isPreparedOrSpreadQuery && isRawCommodityCandidate) {
    return { compatible: false, reason: `Blocked raw commodity candidate ("${candidateName}") for prepared/spread/dessert query ("${query}")` };
  }

  return { compatible: true };
}

export function applyServerAverageNutrients(
  groups: any[],
  preCalcByScoutIndex: Record<number, Record<string, number>>
): any[] {
  if (!Array.isArray(groups)) return [];
  return groups.map((g) => {
    const indices: number[] = Array.isArray(g.scoutItemIndices) ? g.scoutItemIndices : [];
    if (indices.length === 0) {
      return g;
    }
    const sumMap: Record<string, number> = {};
    let count = 0;
    indices.forEach((idx) => {
      const nutrients = preCalcByScoutIndex[idx];
      if (nutrients) {
        count++;
        for (const [k, v] of Object.entries(nutrients)) {
          const num = Number(v) || 0;
          sumMap[k] = (sumMap[k] || 0) + num;
        }
      }
    });

    let avgServing = g.averageNutrients ? { ...g.averageNutrients } : null;
    let avg100g = g.averageNutrientsPer100g ? { ...g.averageNutrientsPer100g } : null;

    if (count > 0) {
      const avgMap: Record<string, number> = {};
      for (const [k, v] of Object.entries(sumMap)) {
        avgMap[k] = Math.round((v / count) * 10) / 10;
      }
      avgServing = avgMap;
    }

    // Determine realistic servingWeightGrams for proportional scaling
    let weight = Number(g.servingWeightGrams) || 0;
    if (weight <= 0 && avgServing?.calories && avg100g?.calories && Number(avg100g.calories) > 0) {
      weight = Math.round((Number(avgServing.calories) / Number(avg100g.calories)) * 100);
    }
    if (weight <= 0) {
      const name = (g.groupName || '').toLowerCase();
      if (name.includes('drink') || name.includes('juice') || name.includes('beverage') || name.includes('tea') || name.includes('coffee') || name.includes('es ')) weight = 250;
      else if (name.includes('soup') || name.includes('soto') || name.includes('asem') || name.includes('curry')) weight = 250;
      else if (name.includes('bread') || name.includes('bun') || name.includes('pie') || name.includes('cake') || name.includes('roti')) weight = 70;
      else if (name.includes('chocolate') || name.includes('bar') || name.includes('cokelat')) weight = 30;
      else if (name.includes('chip') || name.includes('snack') || name.includes('popcorn') || name.includes('keripik')) weight = 40;
      else weight = 150; // standard meal portion
    }

    // Proportional cross-derivation between per-serving and per-100g
    if (avg100g && Number(avg100g.calories) > 0 && (!avgServing || Number(avgServing.calories) <= 0)) {
      avgServing = {};
      for (const [k, v] of Object.entries(avg100g)) {
        avgServing[k] = Math.round(Number(v) * (weight / 100) * 10) / 10;
      }
    } else if (avgServing && Number(avgServing.calories) > 0 && (!avg100g || Number(avg100g.calories) <= 0)) {
      avg100g = {};
      for (const [k, v] of Object.entries(avgServing)) {
        avg100g[k] = Math.round(Number(v) * (100 / weight) * 10) / 10;
      }
    }

    return {
      ...g,
      servingWeightGrams: weight,
      averageNutrients: avgServing,
      averageNutrientsPer100g: avg100g,
      comparisonSentence: g.comparisonSentence || g.message || g.recommendation || (g.groupName ? `Evaluation for ${g.groupName}.` : null),
      orderingTip: g.orderingTip || "Consider your daily nutrition allowance when selecting.",
      boundingBox2D: g.boundingBox2D || null,
    };
  });
}

export function isLabelPanelItem(item: any): boolean {
  const orig = (item.canonicalDbName || item.name || item.originalLocalName || "").toLowerCase();
  const foodKeywords = ["milk", "burger", "fries", "fry", "chicken", "fish", "beef", "fillet", "pork", "salad", "wrap", "bread", "juice", "water", "tea", "coffee", "rice", "noodle", "pasta", "pizza", "cookie", "cake", "fruit", "vegetable", "cheese", "yogurt", "egg", "soup", "stew", "pancake", "waffle", "sausage", "bacon", "steak", "tart", "pie", "donut", "doughnut", "oat", "cereal", "muffin", "soda", "coke"];
  if (foodKeywords.some(kw => orig.includes(kw))) return false;
  return orig.includes("nutrition fact") || 
         orig.includes("informasi nilai gizi") || 
         orig.includes("komposisi") || 
         orig.includes("nutrition label") || 
         orig.includes("back of package") || 
         orig.includes("printed_packaging_label") ||
         orig === "label";
}

export function formatMealReceiptTable(items: any[], totalNutrients: any, totalWeightGrams?: number): string {
  const fVal = (val: any, unit: string = ''): string => {
    if (val === null || val === undefined) return `0${unit}`;
    const num = typeof val === 'number' ? val : parseFloat(val);
    if (isNaN(num) || Math.abs(num) < 0.05) return `0${unit}`;
    const rounded = Math.round(num * 10) / 10;
    return rounded === 0 ? `0${unit}` : `${rounded}${unit}`;
  };

  let table = "### 🧾 Nutrition calculation\n\n";
  table += "| Item / Ingredient | Kcal | Protein | Sat Fat | Sodium |\n";
  table += "|---|---|---|---|---|\n";

  const totalW = totalWeightGrams ?? items.reduce((sum: number, it: any) => sum + (Number(it.weightGrams) || 0), 0);

  items.forEach((it: any, idx: number) => {
    const itCal = it.nutrients?.calories ?? it.calories ?? 0;
    const itP = it.nutrients?.protein ?? it.protein ?? 0;
    const itSatFat = it.nutrients?.saturatedFat ?? it.saturatedFat ?? 0;
    const itNa = it.nutrients?.sodium ?? it.sodium ?? 0;
    const itW = Number(it.weightGrams) || 0;
    const itemName = it.name || it.canonicalDbName || it.originalName || 'Item';

    const compList = (Array.isArray(it.componentsDetailList) && it.componentsDetailList.length > 0)
      ? it.componentsDetailList
      : (Array.isArray(it.components) && it.components.length > 0 ? it.components : null);

    // 1. Dish title row
    // Only append constituent names the title doesn't already spell out — composite dishes
    // built by Spatial Clustering (server_vision_scout.ts) already fold ingredient names into
    // itemName, so re-listing them here duplicated the same text twice in the row header.
    const subNames = (() => {
      if (!compList || compList.length <= 1) return '';
      const compNames = compList.map((c: any) => c.name || c.keyword || '').filter(Boolean);
      const missingNames = compNames.filter((n: string) => !itemName.toLowerCase().includes(n.toLowerCase()));
      return missingNames.length > 0 ? ` (${missingNames.join(', ')})` : '';
    })();
    table += `| **${idx + 1}. ${itemName} - ${itW}g${subNames}** | - | - | - | - |\n`;

    // 2. Constituent rows
    if (compList && compList.length > 0) {
      compList.forEach((c: any) => {
        const cName = c.name || c.searchQuery || c.keyword || 'Ingredient';
        const isSingleComp = compList.length === 1;
        const cW = isSingleComp ? itW : (Number(c.weightGrams) || Math.round(itW / compList.length));
        const cCal = isSingleComp ? itCal : (c.calories ?? c.nutrients?.calories ?? 0);
        const cP = isSingleComp ? itP : (c.protein ?? c.nutrients?.protein ?? 0);
        const cSatFat = isSingleComp ? itSatFat : (c.saturatedFat ?? c.nutrients?.saturatedFat ?? 0);
        const cNa = isSingleComp ? itNa : (c.sodium ?? c.nutrients?.sodium ?? 0);
        table += `| ${cName} - ${cW}g | ${fVal(cCal)} | ${fVal(cP, 'g')} | ${fVal(cSatFat, 'g')} | ${fVal(cNa, 'mg')} |\n`;
      });
    } else {
      const labelRef = it.dbSource === 'label' ? `Printed Packaging Label (${itemName})` : itemName;
      table += `| ${labelRef} - ${itW}g | ${fVal(itCal)} | ${fVal(itP, 'g')} | ${fVal(itSatFat, 'g')} | ${fVal(itNa, 'mg')} |\n`;
    }

    // 3. Item Sub-Total row
    table += `| **Item Sub-Total - ${itW}g** | **${fVal(itCal)}** | **${fVal(itP, 'g')}** | **${fVal(itSatFat, 'g')}** | **${fVal(itNa, 'mg')}** |\n`;
  });

  // Grand Total row
  const grandCal = totalNutrients?.calories ?? 0;
  const grandP = totalNutrients?.protein ?? 0;
  const grandSatFat = totalNutrients?.saturatedFat ?? 0;
  const grandNa = totalNutrients?.sodium ?? 0;
  table += `| **🏆 GRAND MEAL TOTAL - ${totalW}g** | **${fVal(grandCal)}** | **${fVal(grandP, 'g')}** | **${fVal(grandSatFat, 'g')}** | **${fVal(grandNa, 'mg')}** |\n`;

  return table;
}

const KNOWN_BILINGUAL_MAP: Record<string, string> = {
  // Set 1: Bakery & Confectionery
  "silverqueen milk chocolate with cashews": "SilverQueen Milk Chocolate with Cashews / SilverQueen Susu Cokelat dengan Kacang Mede",
  "silverqueen milk chocolate": "SilverQueen Milk Chocolate / Cokelat Susu SilverQueen",
  "silverqueen cashew": "SilverQueen Cashew / SilverQueen Cokelat dengan Kacang Mede",
  "polo cokelat": "Polo Cokelat / Chocolate Polo Bun",
  "polo keju": "Polo Keju / Cheese Polo Bun",
  "choco topping pie": "Choco Topping Pie / Chocolate Topping Pie",
  "cheese topping pie": "Cheese Topping Pie / Cheese Topping Pie",
  "double cheese bread": "Double Cheese Bread / Double Cheese Bread",
  "say bread - polo keju": "Say Bread - Polo Keju / Cheese Polo Bun",
  "say bread - polo cokelat": "Say Bread - Polo Cokelat / Chocolate Polo Bun",
  "say bread - choco topping pie": "Say Bread - Choco Topping Pie / Chocolate Topping Pie",
  "say bread - cheese topping pie": "Say Bread - Cheese Topping Pie / Cheese Topping Pie",
  "say bread - double cheese bread": "Say Bread - Double Cheese Bread / Double Cheese Bread",

  // Set 6: Supermarket chip aisle
  "oishi popcorn": "Oishi Popcorn / Oishi Caramel Popcorn",
  "oishi popcorn caramel": "Oishi Popcorn Caramel / Oishi Caramel Popcorn",
  "chitato lite": "Chitato Lite / Chitato Lite Potato Chips",
  "lay's potato chips": "Lay's Potato Chips / Lays Potato Snack",
  "lays potato chips": "Lay's Potato Chips / Lays Potato Snack",
  "lays way": "Lays Way / Lays Way Snack",
  "happy tos": "Happy Tos / Happy Tos Corn Chips",
  "happy tos corn chips": "Happy Tos Corn Chips / Roasted Corn Tortilla Chips",
  "happy tos jagung bakar": "Happy Tos Jagung Bakar / Roasted Corn Tortilla Chips",
  "doritos tortilla chips": "Doritos Tortilla Chips / Doritos Nacho Cheese Tortilla Chips",
  "doritos nacho cheese": "Doritos Nacho Cheese / Doritos Nacho Cheese Tortilla Chips",
  "panchos traditional tortilla chips": "Panchos Traditional Tortilla Chips / Panchos Tortilla Chips",
  "jetz tortilla snack": "Jetz Tortilla Snack / Jetz Sweet & Savory Snack",
  "qtela singkong": "Qtela Singkong / Qtela Cassava Chips",
  "qtela singkong original": "Qtela Singkong Original / Qtela Cassava Original",
  "qtela singkong balado": "Qtela Singkong Balado / Qtela Cassava Chips Balado Spicy",
  "qtela tempe": "Qtela Tempe / Qtela Fermented Soybean Chips",
  "qtela tempe original": "Qtela Tempe Original / Qtela Soybean Chips Original",
  "qtela family pack barbeque": "Qtela Family Pack Barbeque / Qtela BBQ Family Pack",
  "qtela family pack balado": "Qtela Family Pack Balado / Qtela Balado Family Pack",
  "chimi cassava chips": "Chimi Cassava Chips / Chimi Fried Cassava Chips",
  "kusuka singkong chips": "Kusuka Singkong Chips / Kusuka Crispy Cassava Chips",
  "gunjbee layers snack": "GunjBee Layers Snack / GunjBee Crispy Layered Snack",
  "chiki twist": "Chiki Twist / Chiki Twist Snack",
  "taro net snack": "Taro Net Snack / Taro Net Seaweed Snack",
};

const INDO_ENG_WORDS: [RegExp, string][] = [
  [/\bsingkong\b/gi, "Cassava"],
  [/\bkeju\b/gi, "Cheese"],
  [/\bcokelat\b/gi, "Chocolate"],
  [/\bcoklat\b/gi, "Chocolate"],
  [/\bayam\b/gi, "Chicken"],
  [/\bikan\b/gi, "Fish"],
  [/\bnila\b/gi, "Tilapia"],
  [/\blele\b/gi, "Catfish"],
  [/\bgurame\b/gi, "Carp"],
  [/\btongkol\b/gi, "Mackerel Tuna"],
  [/\bsapi\b/gi, "Beef"],
  [/\budang\b/gi, "Shrimp"],
  [/\bcumi\b/gi, "Squid"],
  [/\btelur\b/gi, "Egg"],
  [/\btahu\b/gi, "Tofu"],
  [/\btempe\b/gi, "Tempeh"],
  [/\bpedas\b/gi, "Spicy"],
  [/\bmanis\b/gi, "Sweet"],
  [/\basam\b/gi, "Sour"],
  [/\bbalado\b/gi, "Spicy Balado"],
  [/\bbakar\b/gi, "Grilled"],
  [/\bgoreng\b/gi, "Fried"],
  [/\brebus\b/gi, "Boiled"],
  [/\bkukus\b/gi, "Steamed"],
  [/\bkuah\b/gi, "Soup"],
  [/\bsup\b/gi, "Soup"],
  [/\bsoto\b/gi, "Aromatic Soup"],
  [/\bsayur\b/gi, "Vegetable"],
  [/\broti\b/gi, "Bread"],
  [/\bsusu\b/gi, "Milk"],
  [/\bkacang\b/gi, "Nut"],
  [/\bjagung\b/gi, "Corn"],
  [/\bkerupuk\b/gi, "Crackers"],
  [/\bteh\b/gi, "Tea"],
  [/\bkopi\b/gi, "Coffee"],
  [/\bes\b/gi, "Iced"],
  [/\bnasi\b/gi, "Rice"],
  [/\bmie\b/gi, "Noodles"],
  [/\bkwetiau\b/gi, "Flat Rice Noodles"],
  [/\bbihun\b/gi, "Rice Vermicelli"],
  [/\bbakso\b/gi, "Meatballs"],
  [/\bsosis\b/gi, "Sausage"],
  [/\bpencok\b/gi, "Fresh Chili Relish"],
  [/\bkangkung\b/gi, "Water Spinach"],
  [/\bterong\b/gi, "Eggplant"],
  [/\bpete\b/gi, "Stink Bean"],
  [/\bkol\b/gi, "Cabbage"],
  [/\btaoge\b/gi, "Bean Sprouts"],
  [/\btauge\b/gi, "Bean Sprouts"],
  [/\bwedang\b/gi, "Warm Herbal Drink"],
  [/\bjahe\b/gi, "Ginger"],
  [/\bkelapa\b/gi, "Coconut"],
  [/\balpukat\b/gi, "Avocado"],
  [/\bmangga\b/gi, "Mango"],
  [/\bjambu\b/gi, "Guava"],
  [/\bjeruk\b/gi, "Orange/Citrus"],
  [/\bnaga\b/gi, "Dragon Fruit"],
  [/\bsirsak\b/gi, "Soursop"],
  [/\bmelon\b/gi, "Melon"],
  [/\bsemangka\b/gi, "Watermelon"],
  [/\btomat\b/gi, "Tomato"],
  [/\bwortel\b/gi, "Carrot"],
];

export function enrichBilingualItemName(rawName: string): string {
  if (!rawName || typeof rawName !== 'string') return rawName;
  const name = rawName.trim();
  if (!name) return name;
  if (name.includes(' / ')) return name;

  const lower = name.toLowerCase();
  if (KNOWN_BILINGUAL_MAP[lower]) {
    return KNOWN_BILINGUAL_MAP[lower];
  }

  // Check if any key in KNOWN_BILINGUAL_MAP is contained
  for (const [key, translated] of Object.entries(KNOWN_BILINGUAL_MAP)) {
    if (lower === key || lower.includes(key)) {
      return translated;
    }
  }

  // Check Indonesian culinary words
  let translated = name;
  let matchedWord = false;
  for (const [pattern, replacement] of INDO_ENG_WORDS) {
    if (pattern.test(name)) {
      matchedWord = true;
      pattern.lastIndex = 0; // reset regex state
      translated = translated.replace(pattern, replacement);
    }
  }

  if (matchedWord && translated !== name) {
    return `${name} / ${translated}`;
  }

  // For branded snacks without explicit Indonesian words
  const snackBrands = ["chiki", "taro", "lays", "lay's", "doritos", "jetz", "happy tos", "oishi", "chitato", "kusuka", "chimi", "gunjbee", "silverqueen"];
  if (snackBrands.some(brand => lower.includes(brand))) {
    return `${name} / ${name} Snack`;
  }

  return name;
}

