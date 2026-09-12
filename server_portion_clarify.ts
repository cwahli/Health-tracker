import { isDishEstimateEnabled } from "./server_food_flags";
import { parseStatedQuantity, type StatedQuantity } from "./src/utils/quantityText";
import { namesReferToSameFood } from "./server_scout_reconcile";

export type PortionOption = {
  id: string;
  label: string;
  weightGrams: number;
};

export type PortionClarifyItem = {
  scoutIndex: number;
  name: string;
  estimatedWeightGrams: number;
  packGrams: number | null;
  labelServingGrams: number | null;
  options: PortionOption[];
  reason: string;
};

export type PortionClarifyPayload = {
  promptMessage: string;
  items: PortionClarifyItem[];
  scoutItems?: any[];
  /** S-10: per-item quantity resolution (candidates, decision, why) for debug export. */
  resolutions?: QuantityResolution[];
};

export function parseServingGramsFromLabel(servingSize: any): number | null {
  if (servingSize == null || servingSize === '') return null;
  const s = String(servingSize).trim();
  const m = s.match(/(\d+(?:\.\d+)?)\s*(?:g|ml)\b/i);
  if (!m) {
    if (/100/.test(s) && /g/i.test(s)) return 100;
    return null;
  }
  const n = parseFloat(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function hasPrintedCalories(raw: any): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const c = raw.calories ?? raw.energy ?? raw.kcal;
  if (c == null || c === '') return false;
  const m = String(c).match(/-?\d+(?:\.\d+)?/);
  return !!(m && parseFloat(m[0]) > 0);
}

function hasEnoughLabelFields(raw: any): boolean {
  if (!raw || typeof raw !== 'object') return false;
  let filled = 0;
  for (const [k, v] of Object.entries(raw)) {
    const ck = k.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (ck === 'servingsize' || ck === 'weight' || ck === 'servingspercontainer') continue;
    if (v === undefined || v === null || v === '' || v === '-' || v === '--') continue;
    filled++;
  }
  return filled >= 4;
}

/**
 * Single source of scanned text for pack/portion detection. The pack parser
 * and the ambiguity detector MUST read the same blob — a prior split (pack
 * parser blind to `packageLabelText`) let a 28g guess on a 180g printed pack
 * through silently while the export proved the text was there all along.
 */
export function scoutItemTextBlob(item: any): string {
  if (!item) return '';
  const raw = item.rawNutritionLabel || {};
  return [
    item.originalName, item.keyword, item.name,
    item.ingredientsList, item.ingredients,
    item.packageLabelText, item.labelText, item.stickerText, item.ocrText,
    typeof raw === 'string' ? raw : JSON.stringify(raw),
  ]
    .filter((v) => typeof v === 'string' && v.trim())
    .join(' ');
}

export function detectPackNetWeightGrams(item: any): number | null {
  if (!item) return null;
  // 1. Explicit package weight fields
  if (item.packGrams != null && Number(item.packGrams) > 0) {
    return Math.round(Number(item.packGrams));
  }
  if (item.packageWeightGrams != null && Number(item.packageWeightGrams) > 0) {
    return Math.round(Number(item.packageWeightGrams));
  }
  if (item.netWeightGrams != null && Number(item.netWeightGrams) > 0) {
    return Math.round(Number(item.netWeightGrams));
  }
  if (item.packWeight != null && Number(item.packWeight) > 0) {
    return Math.round(Number(item.packWeight));
  }
  if (Array.isArray(item.components) && item.components.length === 1 && item.components[0].packGrams != null && Number(item.components[0].packGrams) > 0) {
    return Math.round(Number(item.components[0].packGrams));
  }

  const raw = item.rawNutritionLabel || {};
  const rawServing = String(raw.servingSize || raw.serving || '').trim();
  const rawServingGrams = parseServingGramsFromLabel(rawServing);
  if (rawServingGrams && rawServingGrams > 0 && rawServingGrams !== 100) {
    if (/\b(?:pack|pot|bag|tub|pouch|can|bottle|container)\b/i.test(rawServing)) {
      return Math.round(rawServingGrams);
    }
  }

  const blob = scoutItemTextBlob(item);

  // 2. Front of pack net weight OCR: e.g. "80g", "85g", "net weight 80g", "e 85g", "80 g e",
  // "Berat Bersih 180 g" (id), "Isi Bersih 90 g" (id). These cues are boundary
  // DATA (locale pack-print vocabulary), not decision logic: the funnel below
  // is language-free and only consumes the parsed grams.
  const netMatch = blob.match(/\b(?:net\s*wt\.?|net\s*weight|pack\s*size|netto|berat\s*bersih|isi\s*bersih|weight|e\s*|\b)(\d{2,3})\s*(?:g|grams)\b(?:\s*e\b)?/i);
  if (netMatch) {
    const parsedG = parseInt(netMatch[1], 10);
    if (parsedG >= 25 && parsedG <= 500 && parsedG !== 100) {
      return parsedG;
    }
  }

  // 3. Front of pack printed protein deduction against per-100g label
  // e.g. "16.2g Protein" on front and 19.0g Protein per 100g on label -> 16.2 / 19.0 * 100 = 85.2g
  const frontProteinMatch = blob.match(/\b(\d+(?:\.\d+)?)\s*g\s*protein\b/i);
  const labelProtein = raw.protein ? parseFloat(String(raw.protein).replace(/[^0-9.]/g, '')) : null;
  if (frontProteinMatch && labelProtein && labelProtein > 5 && rawServingGrams === 100) {
    const frontProtein = parseFloat(frontProteinMatch[1]);
    if (frontProtein > 0 && Math.abs(frontProtein - labelProtein) > 0.5) {
      const derived = Math.round((frontProtein / labelProtein) * 100);
      if (derived >= 25 && derived <= 500) {
        return derived;
      }
    }
  }

  return null;
}

/**
 * Extract natural unit noun from food title, ingredient list, or serving description.
 * Works across all categories: bakery, meats, snacks, dairy, seafood, ready meals, etc.
 */
export function extractFoodUnitNoun(name: string, blob: string, servingSizeStr?: string | null): string {
  const text = `${name} ${blob} ${servingSizeStr || ''}`.toLowerCase();

  // 1. Direct unit matches from serving string or name
  if (/\b(bagel\s*thins?|thins?)\b/i.test(text)) return 'bagel thin';
  if (/\b(bagels?)\b/i.test(text)) return 'bagel';
  if (/\b(bars?|cereal\s*bar|snack\s*bar|protein\s*bar)\b/i.test(text)) return 'bar';
  if (/\b(biscuits?|cookies?|crackers?)\b/i.test(text)) return 'biscuit';
  if (/\b(slices?)\b/i.test(text)) return 'slice';
  if (/\b(patties?|patty|burgers?)\b/i.test(text)) return 'patty';
  if (/\b(fillets?|filets?)\b/i.test(text)) return 'fillet';
  if (/\b(sausages?|bangers?|frankfurters?|hot\s*dogs?)\b/i.test(text)) return 'sausage';
  if (/\b(wraps?|tortillas?|fajitas?)\b/i.test(text)) return 'wrap';
  if (/\b(rolls?|bread\s*rolls?|buns?|baps?|barm\s*cakes?)\b/i.test(text)) return 'roll';
  if (/\b(cone|ice\s*cream|soft\s*serve|sundae)\b/i.test(text)) return 'portion';
  if (/\b(pancakes?|crepes?|waffles?)\b/i.test(text)) return 'pancake';
  if (/\b(croissants?|pastries?|danishes?|viennoiseries?)\b/i.test(text)) return 'croissant';
  if (/\b(crumpets?|muffins?|scones?)\b/i.test(text)) return 'piece';
  if (/\b(meatballs?|falafels?|nuggets?|bites?|strips?|wings?|tenders?|dumplings?|gyozas?|samosas?)\b/i.test(text)) return 'piece';
  if (/\b(pouches?|sachets?|packets?)\b/i.test(text)) return 'pouch';
  if (/\b(pots?|tubs?|cups?|tins?|cans?|jars?|bottles?)\b/i.test(text)) return 'serving';

  return 'portion';
}

/**
 * Multi-serve grocery packs, multipacks, or items with ambiguous unit counts.
 * Single-serve pots (yogurt ~215g) with clear container size are NOT ambiguous.
 */
export function detectPortionAmbiguity(item: any, scoutIndex: number): PortionClarifyItem | null {
  const name = String(item.originalName || item.keyword || item.name || 'Item').trim();
  const nameL = name.toLowerCase();
  const ing = String(item.ingredientsList || item.ingredients || '').toLowerCase();
  const blob = scoutItemTextBlob(item).toLowerCase();
  const w = Math.round(Number(item.estimatedWeightGrams ?? item.weightGrams) || 0);
  const raw = item?.rawNutritionLabel;
  const rawServing = String(raw?.servingSize || raw?.serving || '').trim();
  const ssG = parseServingGramsFromLabel(rawServing) ?? (raw ? 100 : null);

  // 1. Detect explicit pack weight from fields, components, OCR, or label
  let packGrams = detectPackNetWeightGrams(item);

  // Universal Unit Count Match: matches any digit preceding common packaging / unit words
  const unitCountMatch = blob.match(/\b(\d+)\s*(?:pack|pk|slices?|bagels?|rolls?|thins?|buns?|wraps?|tortillas?|pancakes?|muffins?|crumpets?|waffles?|pieces?|pcs?|bars?|bakes?|sachets?|pouches?|biscuits?|cookies?|patties?|fillets?|sausages?|cutlets?|meatballs?|servings?|sajian|saji|porsi|units?)\b/i);
  let detectedUnits = unitCountMatch ? parseInt(unitCountMatch[1], 10) : 0;

  // Extract leading digit from item name (e.g. "2 butter croissants" → 2, "4 chicken strips" → 4).
  if (!detectedUnits) {
    const nameLeadingDigit = nameL.match(/^(\d+)\s+\w/);
    if (nameLeadingDigit) {
      const n = parseInt(nameLeadingDigit[1], 10);
      if (n >= 2 && n <= 24) detectedUnits = n;
    }
  }

  // Clear single-serve container or visual dessert (ice cream cone, soft serve, sundae, pot/cup/bottle) — trust scout
  if (/\b(ice\s*cream|soft\s*serve|sundae|cone|waffle\s*cone|popsicle|gelato|sorbet|parfait|smoothie)\b/i.test(nameL) && !detectedUnits) {
    return null;
  }

  const unitNoun = extractFoodUnitNoun(name, blob, rawServing);
  const isDiscreteUnitFood = unitNoun !== 'portion' && unitNoun !== 'serving';

  // Multi-serve package / container / servings check
  const servingsRaw = raw?.servingsPerContainer ?? raw?.servings ?? raw?.numberOfServings;
  let servings =
    servingsRaw != null && String(servingsRaw).trim() !== ''
      ? Math.round(Number(String(servingsRaw).match(/[\d.]+/)?.[0] || 0))
      : null;

  // If packGrams wasn't directly found, derive it if item is a multipack or has servings count
  if (!packGrams || packGrams <= 0) {
    const isVisual = item.source === 'visual' || item.contentType === 'visual' || item.contentType === 'visual_food' || !item.rawNutritionLabel;
    // Label-bound visual items still get pack-checked: the label proves a pack
    // exists, so unit/serving derivation below must run. Pure visual guesses
    // without labels or unit counts stay silent (nothing to anchor a question).
    if (isVisual && !item.rawNutritionLabel && (!detectedUnits || detectedUnits < 2)) {
      return null;
    }
    if (detectedUnits >= 2 && w > 0) {
      packGrams = detectedUnits * w;
    } else if (servings != null && servings >= 2 && w > 0) {
      packGrams = Math.round(servings * w);
    } else if (isDiscreteUnitFood && !isVisual && w > 0) {
      detectedUnits = 4;
      packGrams = 4 * w;
    }
  }

  // CORE LAW: Portion clarify ONLY appears when there is a difference between packGrams and weightGrams!
  if (!packGrams || packGrams <= 0 || Math.abs(packGrams - w) <= 1) {
    return null;
  }

  // If discrete unit food (e.g. croissants, bars, biscuits, patties)
  if (detectedUnits >= 2 || isDiscreteUnitFood) {
    const isIndividualUnit = /\b(bar|biscuit|cookie|bagel|thin|wrap|slice|patty|fillet|sausage|pancake|muffin|crumpet|roll|bun|croissant)\b/i.test(unitNoun);
    // Servings-counted bulk (e.g. "23 sajian", "40 servings") is not a set of
    // countable units: "Whole pack of 23 (805g)" is not something anyone
    // eats, so unit framing must not leak into the reason or the pack option.
    const countIsServingsOnly = unitCountMatch
      ? /servings?|sajian|saji|porsi/i.test(unitCountMatch[0] || '')
      : false;
    let singleUnitGrams: number;
    if (isIndividualUnit && w > 0 && w <= 95) {
      singleUnitGrams = w;
    } else if (unitCountMatch && w > 0 && w <= 95) {
      singleUnitGrams = w;
    } else {
      singleUnitGrams = Math.max(5, Math.round(packGrams / (detectedUnits || 4)));
    }

    const options: PortionOption[] = [];
    const pluralNoun = unitNoun.endsWith('s') ? unitNoun : `${unitNoun}s`;
    // Whole-pack options above ~5 servings are not real choices (nobody eats
    // an 805g oats bag); offering them normalizes absurd ledgers.
    const wholePackSane = packGrams <= 5 * singleUnitGrams;
    const packLabel = unitCountMatch && !countIsServingsOnly
      ? `Whole pack of ${detectedUnits} (${packGrams}g)`
      : `Whole pack (${packGrams}g)`;

    options.push({ id: `unit_1_${singleUnitGrams}`, label: `1 ${unitNoun} (${singleUnitGrams}g)`, weightGrams: singleUnitGrams });
    if (detectedUnits >= 2) {
      options.push({ id: `unit_2_${singleUnitGrams * 2}`, label: `2 ${pluralNoun} (${singleUnitGrams * 2}g)`, weightGrams: singleUnitGrams * 2 });
    }
    if (detectedUnits >= 3 && detectedUnits !== 4) {
      options.push({ id: `unit_3_${singleUnitGrams * 3}`, label: `3 ${pluralNoun} (${singleUnitGrams * 3}g)`, weightGrams: singleUnitGrams * 3 });
    }
    if (wholePackSane && !options.some((o) => o.weightGrams === packGrams)) {
      options.push({ id: `pack_${packGrams}`, label: packLabel, weightGrams: packGrams });
    }
    if ((ssG === 100 || !ssG) && !options.some((o) => o.weightGrams === 100)) {
      options.push({ id: 'panel_100', label: '100g (nutrition panel basis)', weightGrams: 100 });
    }

    return {
    scoutIndex,
    name,
    estimatedWeightGrams: w > 0 ? w : singleUnitGrams,
    packGrams: Number.isFinite(packGrams) && (packGrams as number) > 0 ? Math.round(packGrams as number) : null,
    labelServingGrams: ssG || 100,
      options,
      reason: detectedUnits >= 2
        ? (countIsServingsOnly
          ? `Multi-serve pack (${detectedUnits} servings) — confirm how much you ate`
          : `Multi-serve pack (${detectedUnits} units) — confirm how much you ate`)
        : `Package weight (${packGrams}g) differs from estimated portion (${w}g) — confirm how much you ate`,
    };
  }

  // General multi-serve grocery / container item
  const options: PortionOption[] = [];
  const seen = new Set<number>();

  // 1. Portion in dish / photo estimate
  if (w > 0) {
    options.push({
      id: `photo_${w}`,
      label: `Portion in dish (${w}g)`,
      weightGrams: w,
    });
    seen.add(w);
  }

  // 2. Whole pack (only when it is a sane choice — see discrete branch)
  const servingGrams = w > 0 ? w : (ssG || 100);
  const wholePackSane = packGrams <= 5 * servingGrams;
  if (wholePackSane && !seen.has(packGrams)) {
    options.push({
      id: `pack_${packGrams}`,
      label: `Whole pack (${packGrams}g)`,
      weightGrams: packGrams,
    });
    seen.add(packGrams);
  }

  // 3. Portion fractions based on actual pack size or servings
  if (servings != null && servings >= 2 && servings <= 12) {
    const sliceGrams = Math.max(5, Math.round(packGrams / servings));
    for (let n = 1; n < servings; n++) {
      const grams = sliceGrams * n;
      if (!seen.has(grams) && grams > 0 && grams !== packGrams) {
        seen.add(grams);
        const label = n === 1 ? `1 slice / portion (${grams}g)` : `${n} slices / portions (${grams}g)`;
        options.push({ id: `n${n}_${grams}`, label, weightGrams: grams });
      }
    }
  } else if (packGrams >= 100) {
    // Half/quarter sanity is per-option (same 5x multiple as whole-pack):
    // a 90g half of a 180g pack is a real choice even when the whole pack
    // is not. Gating halves on whole-pack sanity hid the only meaningful
    // options and silenced the question entirely.
    const saneCap = 5 * servingGrams;
    const half = Math.round(packGrams / 2);
    if (half >= 15 && half <= saneCap && !seen.has(half) && half !== packGrams) {
      seen.add(half);
      options.push({ id: `half_${half}`, label: `Half pack (${half}g)`, weightGrams: half });
    }
    const quarter = Math.round(packGrams / 4);
    if (quarter >= 15 && quarter <= saneCap && !seen.has(quarter) && quarter !== packGrams) {
      seen.add(quarter);
      options.push({ id: `quarter_${quarter}`, label: `1/4 pack (${quarter}g)`, weightGrams: quarter });
    }
    const effectiveServings = servings != null && servings >= 2
      ? servings
      : (servingGrams > 0 && packGrams >= 2 * servingGrams ? Math.round(packGrams / servingGrams) : null);
    if (effectiveServings != null && effectiveServings >= 2) {
      // Bulk pack with absurd whole/half options (e.g. 805g oats):
      // offer a realistic second serving instead so the question survives.
      const sliceGrams = Math.max(5, Math.round(packGrams / effectiveServings));
      const twoServ = sliceGrams * 2;
      if (!seen.has(twoServ) && twoServ > 0 && twoServ !== packGrams && twoServ <= saneCap) {
        seen.add(twoServ);
        options.push({ id: `n2_${twoServ}`, label: `2 servings (${twoServ}g)`, weightGrams: twoServ });
      }
    }
  }

  // 4. Always offer 100g if label is per-100g
  if (ssG === 100 && !seen.has(100)) {
    seen.add(100);
    options.push({
      id: 'panel_100',
      label: '100g (nutrition panel basis)',
      weightGrams: 100,
    });
  }

  if (options.length < 2) return null;

  return {
    scoutIndex,
    name,
    estimatedWeightGrams: w,
    packGrams: Number.isFinite(packGrams) && packGrams > 0 ? Math.round(packGrams) : null,
    labelServingGrams: ssG,
    options,
    reason: `Package weight (${packGrams}g) differs from estimated portion (${w}g) — confirm how much you ate`,
  };
}

/**
 * S-10 PORTION_FUNNEL — quantity resolution.
 *
 * Candidates carry provenance-fixed confidence (assigned here, never by the
 * model): user-stated HIGH (the diner knows what they ate), label-derived
 * HIGH for pack totals (arithmetic on transcribed facts), visual LOW unless
 * corroborated. Decision table:
 * - unambiguous user statement (+tolerance) → adopt, never ask
 * - ambiguous user statement                  → ask (disambiguation; stated grams injected as options)
 * - no statement + pack known + consumed unknown → ask (existing detector)
 * - otherwise                                 → accept visual (unchanged)
 */
export const STATED_MATCH_TOLERANCE_G = 2;
export const STATED_MATCH_TOLERANCE_RATIO = 0.05;

export function statedMatchesEstimate(statedG: number, estG: number): boolean {
  if (!(statedG > 0) || !(estG > 0)) return false;
  // Kitchen-rounding rationale: diners round to the nearest few grams.
  return Math.abs(statedG - estG) <= Math.max(STATED_MATCH_TOLERANCE_G, STATED_MATCH_TOLERANCE_RATIO * estG);
}

export interface QuantityCandidate {
  source: 'user' | 'label' | 'visual';
  grams: number | null;
  packGrams: number | null;
  confidence: 'high' | 'low';
  note: string;
}

export interface QuantityResolution {
  scoutIndex: number;
  name: string;
  candidates: QuantityCandidate[];
  decision: 'accept-stated' | 'adopt-stated' | 'ask' | 'accept-visual';
  why: string;
}

export interface QuantityFunnelResult {
  /** Scout items with unambiguous stated grams applied (copies; originals untouched). */
  items: any[];
  clarifyItems: PortionClarifyItem[];
  resolutions: QuantityResolution[];
}

function itemNameVariants(it: any): string[] {
  return [it?.originalName, it?.keyword, it?.name, it?.genericEnglishName].filter(
    (v) => typeof v === 'string' && v.trim()
  ) as string[];
}

function matchStatedToItem(stated: StatedQuantity, it: any): boolean {
  if (!stated.itemRefText) return false;
  return itemNameVariants(it).some((variant) => {
    try {
      return namesReferToSameFood(stated.itemRefText, variant);
    } catch {
      return false;
    }
  });
}

function scoutEstGrams(it: any): number {
  return Math.round(Number(it?.estimatedWeightGrams ?? it?.weightGrams) || 0);
}

function packGramsOf(it: any): number | null {
  const p = detectPackNetWeightGrams(it);
  return p && p > 0 ? p : null;
}

/** Inject "You said Xg" into clarify options so even the ask path honors the user. */
function injectStatedOption(found: PortionClarifyItem, grams: number): PortionClarifyItem {
  if (!(grams > 0)) return found;
  if (found.options.some((o) => Math.abs(o.weightGrams - grams) <= Math.max(2, 0.05 * grams))) return found;
  return {
    ...found,
    options: [...found.options, { id: `stated_${grams}`, label: `You said ${grams}g`, weightGrams: grams }],
  };
}

function minimalClarifyItem(it: any, si: number, extraGrams: number[], reason: string): PortionClarifyItem | null {
  const w = scoutEstGrams(it);
  const raw = it?.rawNutritionLabel;
  const rawServing = String(raw?.servingSize || raw?.serving || '').trim();
  const ssG = parseServingGramsFromLabel(rawServing) ?? (raw ? 100 : null);
  const options: PortionOption[] = [];
  const seen = new Set<number>();
  const push = (id: string, label: string, weightGrams: number) => {
    if (weightGrams > 0 && !seen.has(weightGrams)) {
      seen.add(weightGrams);
      options.push({ id, label, weightGrams });
    }
  };
  if (w > 0) push(`photo_${w}`, `Portion in photo (${w}g)`, w);
  for (const g of extraGrams) {
    const rg = Math.round(g);
    push(`stated_${rg}`, `You said ${rg}g`, rg);
  }
  if (ssG === 100 && w !== 100) push('panel_100', '100g (nutrition panel basis)', 100);
  if (options.length < 2) return null;
  const name = String(it?.originalName || it?.keyword || it?.name || 'Item').trim();
  return { scoutIndex: si, name, estimatedWeightGrams: w, packGrams: packGramsOf(it), labelServingGrams: ssG || 100, options, reason };
}

export function resolveItemQuantities(
  scoutItems: any[],
  opts?: { userText?: unknown; locale?: unknown }
): QuantityFunnelResult {
  const items = Array.isArray(scoutItems) ? scoutItems : [];
  const locale = opts?.locale || 'en';
  const statedAll = parseStatedQuantity(opts?.userText, locale).filter((s) => !s.isQuestion && !s.isPastReference);
  const adopted = items.map((it) => ({ ...it }));
  const clarifyItems: PortionClarifyItem[] = [];
  const resolutions: QuantityResolution[] = [];
  const statedCounts = new Map<number, number>();

  const estOf = (idx: number) => scoutEstGrams(adopted[idx]);
  const nameOf = (idx: number) =>
    String(adopted[idx]?.originalName || adopted[idx]?.keyword || adopted[idx]?.name || `Item #${idx + 1}`);

  // 1. Attribute each stated quantity to meal items (closed world: this meal only).
  statedAll.forEach((stated) => {
    const matchedIdx: number[] = [];
    if (stated.itemRefText) {
      adopted.forEach((it, idx) => {
        if (matchStatedToItem(stated, it)) matchedIdx.push(idx);
      });
    } else if (adopted.length === 1) {
      matchedIdx.push(0);
    }
    (stated as any)._matchedIdx = matchedIdx;
  });

  // 2. Resolve per item.
  adopted.forEach((it, idx) => {
    const si = it.scoutIndex != null ? Number(it.scoutIndex) : idx;
    const name = nameOf(idx);
    const w = estOf(idx);
    const pack = packGramsOf(it);
    const candidates: QuantityCandidate[] = [];
    if (pack != null) candidates.push({ source: 'label', grams: null, packGrams: pack, confidence: 'high', note: 'pack total from label/OCR math' });
    candidates.push({ source: 'visual', grams: w > 0 ? w : null, packGrams: null, confidence: 'low', note: 'uncorroborated scout guess' });

    const mine = statedAll.filter((s) => ((s as any)._matchedIdx as number[]).includes(idx));
    const myGrams = mine.find((s) => s.grams != null && (s as any)._matchedIdx.length === 1);
    if (myGrams && myGrams.grams != null) {
      candidates.unshift({ source: 'user', grams: myGrams.grams, packGrams: null, confidence: 'high', note: `stated "${myGrams.raw}"` });
      if (statedMatchesEstimate(myGrams.grams, w)) {
        adopted[idx] = { ...it, estimatedWeightGrams: myGrams.grams, weightGrams: myGrams.grams, statedGramsAdopted: true };
        resolutions.push({ scoutIndex: si, name, candidates, decision: 'accept-stated', why: `unambiguous user statement (${myGrams.grams}g) corroborates scout est (${w}g)` });
      } else {
        const overflow = pack != null && myGrams.grams > pack ? `; stated exceeds ${pack}g pack — downstream plausibility gate is the backstop` : '';
        adopted[idx] = { ...it, estimatedWeightGrams: myGrams.grams, weightGrams: myGrams.grams, statedGramsAdopted: true };
        resolutions.push({ scoutIndex: si, name, candidates, decision: 'adopt-stated', why: `explicit user statement outranks visual guess (${w}g → ${myGrams.grams}g)${overflow}` });
      }
      return;
    }

    const myFraction = mine.find((s) => s.fraction != null && (s as any)._matchedIdx.length === 1);
    if (myFraction && myFraction.fraction != null) {
      candidates.unshift({ source: 'user', grams: null, packGrams: null, confidence: 'high', note: `stated fraction "${myFraction.raw}"` });
      if (pack != null) {
        const g = Math.max(1, Math.round(pack * (myFraction.fraction as number)));
        adopted[idx] = { ...it, estimatedWeightGrams: g, weightGrams: g, statedGramsAdopted: true };
        resolutions.push({ scoutIndex: si, name, candidates, decision: 'adopt-stated', why: `fraction ${(myFraction.fraction as number) * 100}% of ${pack}g pack = ${g}g` });
          return;
      }
      // Fraction without a known basis cannot resolve — force the question.
      const forced = minimalClarifyItem(it, si, [], `you said "${myFraction.raw}" but the pack size is unknown — confirm`);
      if (forced) {
        clarifyItems.push(forced);
        resolutions.push({ scoutIndex: si, name, candidates, decision: 'ask', why: 'stated fraction has no pack basis to resolve against' });
          return;
      }
    }

    const myCount = mine.find((s) => s.count != null && s.unitNoun && (s as any)._matchedIdx.length === 1);
    if (myCount && myCount.count != null) {
      candidates.unshift({ source: 'user', grams: null, packGrams: null, confidence: 'high', note: `stated count "${myCount.raw}"` });
      // Counts resolve through the detector's unit options; mark for the ask path below.
      statedCounts.set(idx, myCount.count);
    }

    // 3. Ambiguous or bare statements: inject grams into options when asked.
    const bare = statedAll.find((s) => s.grams != null && !s.itemRefText && adopted.length > 1);
    const ambiguous = mine.filter((s) => (s as any)._matchedIdx.length > 1);
    const inject: number[] = [];
    if (bare?.grams != null) inject.push(bare.grams);
    for (const a of ambiguous) if (a.grams != null) inject.push(a.grams);

    const found = detectPortionAmbiguity(it, si);
    if (found) {
      let enriched = found;
      for (const g of inject) enriched = injectStatedOption(enriched, g);
      clarifyItems.push(enriched);
      resolutions.push({
        scoutIndex: si, name, candidates, decision: 'ask',
        why: inject.length > 0 ? `pack/estimate diverge; user-stated ${inject.join('/')}g offered back as options` : `package (${pack}g) differs from estimated portion (${w}g) — confirm how much was eaten`,
      });
      return;
    }
    if (inject.length > 0 || statedCounts.has(idx)) {
      // Detector silent but the user spoke about this item: synthesize the
      // disambiguation question rather than dropping their statement.
      const synth = minimalClarifyItem(it, si, inject, `your note mentions this item — confirm the portion`);
      if (synth) {
        clarifyItems.push(synth);
        resolutions.push({ scoutIndex: si, name, candidates, decision: 'ask', why: 'user statement needs disambiguation; detector was silent' });
          return;
      }
    }
    const hasPackDivergence = pack != null && Math.abs(pack - w) > 1;
    const whyText = hasPackDivergence
      ? `no user statement; package (${pack}g) differs from visual guess (${w}g) but options collapsed — visual estimate stands`
      : 'no statement, no pack divergence — visual estimate stands';
    resolutions.push({ scoutIndex: si, name, candidates, decision: 'accept-visual', why: whyText });
  });

  return { items: adopted, clarifyItems, resolutions };
}

function buildPayloadFromFunnel(funnel: QuantityFunnelResult): PortionClarifyPayload | null {
  if (funnel.clarifyItems.length === 0) return null;
  const names = funnel.clarifyItems.map((i) => i.name).join('; ');
  return {
    promptMessage:
      funnel.clarifyItems.length === 1
        ? `How much of “${funnel.clarifyItems[0].name}” did you eat? (Label is per 100g — pick a portion so we don’t guess.)`
        : `Confirm portions for: ${names}`,
    items: funnel.clarifyItems,
    scoutItems: funnel.items,
    resolutions: funnel.resolutions,
  };
}

export function buildPortionClarifyPayload(
  scoutItems: any[],
  opts?: { userText?: unknown; locale?: unknown }
): PortionClarifyPayload | null {
  if (!Array.isArray(scoutItems) || scoutItems.length === 0) return null;
  const funnel = resolveItemQuantities(scoutItems, opts);
  const payload = buildPayloadFromFunnel(funnel);

  // Check composite sub-components (legacy path for items the funnel accepted).
  if (payload) {
    funnel.items.forEach((it, idx) => {
      const si = it.scoutIndex != null ? Number(it.scoutIndex) : idx;
      const subComps: any[] = (Array.isArray(it.compositeSiblings) && it.compositeSiblings.length > 0)
        ? it.compositeSiblings
        : ((Array.isArray(it.components) && it.components.length > 0)
          ? it.components
          : []);
      if (subComps.length > 1) {
        subComps.forEach((comp: any, cIdx: number) => {
          if (!comp) return;
          const compIndex = 10000 + (si * 100) + cIdx;
          const compFound = detectPortionAmbiguity(comp, compIndex);
          if (compFound && !payload.items.some((i) => i.scoutIndex === compIndex)) {
            payload.items.push(compFound);
          }
        });
      }
    });
  } else {
    // Funnel silent: legacy composite scan still applies (no user-text involved).
    const items: PortionClarifyItem[] = [];
    funnel.items.forEach((it, idx) => {
      const si = it.scoutIndex != null ? Number(it.scoutIndex) : idx;
      const subComps: any[] = (Array.isArray(it.compositeSiblings) && it.compositeSiblings.length > 0)
        ? it.compositeSiblings
        : ((Array.isArray(it.components) && it.components.length > 0)
          ? it.components
          : []);
      if (subComps.length > 1) {
        subComps.forEach((comp: any, cIdx: number) => {
          if (!comp) return;
          const compFound = detectPortionAmbiguity(comp, 10000 + (si * 100) + cIdx);
          if (compFound) items.push(compFound);
        });
      }
    });
    if (items.length > 0) {
      const names = items.map((i) => i.name).join('; ');
      return {
        promptMessage: items.length === 1
          ? `How much of “${items[0].name}” did you eat? (Label is per 100g — pick a portion so we don’t guess.)`
          : `Confirm portions for: ${names}`,
        items,
        scoutItems: funnel.items,
      };
    }
  }
  return payload;
}

/** choices: map scoutIndex (string or number key) → weightGrams */
export function applyPortionChoices(
  scoutItems: any[],
  choices: Record<string, number> | null | undefined
): any[] {
  if (!Array.isArray(scoutItems) || !choices || typeof choices !== 'object') {
    return scoutItems || [];
  }
  return scoutItems.map((it, idx) => {
    const si = it.scoutIndex != null ? Number(it.scoutIndex) : idx;
    const w =
      choices[String(si)] ??
      choices[si as any] ??
      choices[String(idx)] ??
      null;

    let updatedItem = { ...it };

    if (w != null && Number(w) > 0) {
      const weightGrams = Math.round(Number(w));
      const prevW = Math.round(Number(it.estimatedWeightGrams) || 0) || weightGrams;
      const labelG = parseServingGramsFromLabel(it?.rawNutritionLabel?.servingSize || it?.rawNutritionLabel?.serving);
      const storedBasis = Number(it.nutrientBasisWeight);
      let nutrientBasisWeight = prevW;
      if (Number.isFinite(storedBasis) && storedBasis > 0) {
        // A 1g "serving" with a 70g pick is WRONG_BASIS (R>9). Don't keep it.
        nutrientBasisWeight = (weightGrams / storedBasis > 9.2)
          ? (labelG || prevW)
          : storedBasis;
      } else if (labelG && labelG > 0) {
        nutrientBasisWeight = labelG;
      }
      updatedItem = {
        ...updatedItem,
        estimatedWeightGrams: weightGrams,
        nutrientBasisWeight,
        portionChoiceApplied: weightGrams,
      };
      if (!isDishEstimateEnabled()) {
        const estCal = Number(it.estimatedCalories);
        if (estCal > 0 && prevW > 0) {
          updatedItem.estimatedCalories = Math.round(estCal * (weightGrams / prevW));
        }
      }
    }

    // Also apply choices to composite sub-components if present
    const subComps: any[] = (Array.isArray(it.compositeSiblings) && it.compositeSiblings.length > 0)
      ? it.compositeSiblings
      : ((Array.isArray(it.components) && it.components.length > 0)
        ? it.components
        : []);

    if (subComps.length >= 1) {
      let subCompsChanged = false;
      const updatedSubComps = subComps.map((comp: any, cIdx: number) => {
        if (!comp) return comp;
        const compIndex = 10000 + (si * 100) + cIdx;
        const compW =
          choices[String(compIndex)] ??
          choices[compIndex as any] ??
          choices[`${si}-${cIdx + 1}`] ??
          (subComps.length === 1 && w != null ? Number(w) : null);
        if (compW != null && Number(compW) > 0) {
          subCompsChanged = true;
          const cWeightGrams = Math.round(Number(compW));
          return {
            ...comp,
            weightGrams: cWeightGrams,
            estimatedWeightGrams: cWeightGrams,
            portionChoiceApplied: cWeightGrams,
          };
        }
        return comp;
      });

      if (subCompsChanged) {
        if (Array.isArray(it.compositeSiblings) && it.compositeSiblings.length > 0) {
          updatedItem.compositeSiblings = updatedSubComps;
        }
        if (Array.isArray(it.components) && it.components.length > 0) {
          updatedItem.components = updatedSubComps;
        }
        if (Array.isArray(it.componentsDetailList) && it.componentsDetailList.length > 0) {
          updatedItem.componentsDetailList = updatedSubComps;
        }
        // If subcomponent weights changed, update parent composite dish total weight
        const totalCompWeight = updatedSubComps.reduce((sum: number, c: any) => sum + (Number(c.weightGrams ?? c.estimatedWeightGrams) || 0), 0);
        if (totalCompWeight > 0) {
          updatedItem.estimatedWeightGrams = totalCompWeight;
          updatedItem.weightGrams = totalCompWeight;
        }
      }
    }

    return updatedItem;
  });
}
