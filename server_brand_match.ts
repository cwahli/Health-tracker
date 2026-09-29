/**
 * server_brand_match.ts
 *
 * Standalone brand menu item matcher:
 * - Queries brand catalog once per dish (with chain context).
 * - Enforces exact key or score >= 0.92 and 2x second score.
 * - Extracts locked keys at basis without altering raw whole-dish portion values.
 */

import {
  searchBrandMenuItems,
  brandHitFitsQuery,
  normalizeChainKey,
  normalizeDishKey,
} from './serverBrandMenu';

export interface BrandMatchResult {
  matched: boolean;
  status: 'HIT' | 'MULTI' | 'MISS';
  hit?: any;
  lockedKeys?: string[];
  basisType?: string;
  servingGrams?: number | null;
  valuesAtBasis?: Record<string, number>;
}

/** Packaged/OCR items bind via finalize brand/OCR rungs — not generic USDA curator skip. */
export function isPackagedBindItem(it: any): boolean {
  if (!it) return false;
  const label = it.rawNutritionLabel;
  const hasPrinted = Boolean(
    label && typeof label === 'object' && (label.calories || label.energy || label.kcal)
  );
  return Boolean(it.chainName || it.barcode || it.packageLabelText || hasPrinted);
}

export function inferChainNameFromPackageLabel(packageLabelText?: string | null): string | null {
  const brandGuess = String(packageLabelText || '').split(/[-–|,]/)[0].trim();
  if (brandGuess.length >= 3 && brandGuess.length < 40) return brandGuess;
  return null;
}

export async function matchBrandMenu(
  chainName?: string | null,
  originalName?: string | null,
  keyword?: string | null
): Promise<BrandMatchResult> {
  let query = (originalName || keyword || '').trim();
  if (!query) return { matched: false, status: 'MISS' };

  const explicitChain = chainName ? normalizeChainKey(chainName) : undefined;
  let candidates = await searchBrandMenuItems(query, explicitChain);
  let validHits = candidates ? candidates.filter((hit: any) => brandHitFitsQuery(query, hit)) : [];

  if (validHits.length === 0 && keyword && keyword.trim() && keyword.trim().toLowerCase() !== query.toLowerCase()) {
    const fallbackQuery = keyword.trim();
    const fallbackCandidates = await searchBrandMenuItems(fallbackQuery, explicitChain);
    const fallbackValid = fallbackCandidates ? fallbackCandidates.filter((hit: any) => brandHitFitsQuery(fallbackQuery, hit)) : [];
    if (fallbackValid.length > 0) {
      query = fallbackQuery;
      candidates = fallbackCandidates;
      validHits = fallbackValid;
    }
  }

  if (!candidates || candidates.length === 0 || validHits.length === 0) {
    return { matched: false, status: 'MISS' };
  }

  // Check (a) exact normalizeDishKey match
  const normQ = normalizeDishKey(query);
  const exactHit = validHits.find((hit: any) => {
    const normHit = normalizeDishKey(hit.dish_name || hit.name || '');
    return normHit === normQ || normHit === normalizeDishKey(originalName || '');
  });

  let topHit: any = null;
  if (exactHit) {
    topHit = exactHit;
  } else if (validHits.length === 1 && (validHits[0].score === undefined || validHits[0].score >= 0.92)) {
    topHit = validHits[0];
  } else if (validHits.length > 1) {
    const top = validHits[0];
    const second = validHits[1];
    const topScore = top.score ?? 0;
    const secondScore = second.score ?? 0;
    if (topScore >= 0.92 && (secondScore === 0 || topScore >= 2 * secondScore)) {
      topHit = top;
    } else {
      return { matched: false, status: 'MULTI' };
    }
  }

  if (!topHit) {
    return { matched: false, status: 'MISS' };
  }

  // Extract locked keys and values at basis
  const valuesAtBasis: Record<string, number> = {};
  const lockedKeys: string[] = [];

  const rawNutrients = topHit.nutrients || topHit;
  const calorieVal = Number(topHit.calories ?? rawNutrients.calories ?? rawNutrients.energy);
  if (Number.isFinite(calorieVal) && calorieVal > 0) {
    valuesAtBasis['calories'] = calorieVal;
    lockedKeys.push('calories');
  }

  const MACRO_FIELDS = [
    'protein', 'totalFat', 'saturatedFat', 'transFat',
    'carbohydrates', 'sugar', 'totalSugar', 'addedSugar',
    'totalFibre', 'sodium', 'salt', 'potassium'
  ];

  for (const field of MACRO_FIELDS) {
    const val = Number(rawNutrients[field]);
    if (Number.isFinite(val) && val >= 0) {
      const normField = field === 'totalSugar' ? 'sugar' : field;
      valuesAtBasis[normField] = val;
      if (!lockedKeys.includes(normField)) {
        lockedKeys.push(normField);
      }
    }
  }

  // F-8.12: carry brand-row micros (vitamin C etc.) into the lock when the row has
  // them. Packaged drinks bind labelled micros from brand facts; never invent the
  // can-name dose (e.g. 1000 mg from "C1000") — only lock values present on the row.
  const MICRO_FIELDS = [
    'vitaminC', 'vitaminD', 'vitaminA', 'vitaminE', 'vitaminK', 'vitaminB12',
    'calcium', 'iron', 'zinc', 'magnesium', 'potassium', 'phosphorus', 'iodine',
  ];
  for (const field of MICRO_FIELDS) {
    const val = Number(rawNutrients[field]);
    if (Number.isFinite(val) && val > 0) {
      valuesAtBasis[field] = val;
      if (!lockedKeys.includes(field)) {
        lockedKeys.push(field);
      }
    }
  }

  return {
    matched: true,
    status: 'HIT',
    hit: topHit,
    lockedKeys,
    basisType: topHit.basis_type || topHit.basisType || 'per_dish',
    servingGrams: topHit.serving_grams ?? topHit.servingGrams ?? null,
    valuesAtBasis,
  };
}
