/**
 * B5 — Detect weight/portion refine intents and scale prior scout items
 * without re-running Vision Scout or Food Resolver.
 *
 * Pure helpers only (no I/O). Used by food-analyze shortcut path.
 */

import { applyPortionChoices } from './server_portion_clarify.js';

export type WeightRefineKind =
  | 'absolute_grams'
  | 'slices'
  | 'whole_pack'
  | 'half'
  | 'quarter'
  | 'relative_grams'
  | 'item_count';

export type WeightRefineIntent =
  | {
      isRefine: true;
      kind: WeightRefineKind;
      /** Absolute grams when known; null for half/quarter until applied against pack basis */
      weightGrams: number | null;
      /** Slice/portion count when kind === 'slices' */
      unitCount?: number;
      /** Optional food name substring from the user message */
      targetHint?: string;
    }
  | { isRefine: false };

const REFINE_LOG = '[Refine] scale-only';

/** Exported for gates / tests */
export const REFINE_SCALE_ONLY_LOG = REFINE_LOG;

/**
 * True when message is a portion/weight correction rather than a new meal description.
 * Conservative: requires weight/portion vocabulary or a bare grams token.
 */
export function detectWeightRefineIntent(message: string | null | undefined): WeightRefineIntent {
  if (!message || typeof message !== 'string') return { isRefine: false };
  const raw = message.trim();
  if (!raw || raw.length > 280) return { isRefine: false };
  const msg = raw.toLowerCase().replace(/\s+/g, ' ');

  // Reject obvious new-meal / multi-dish narratives (still allow "I ate 100g of the beef")
  if (
    /\b(and also|plus some|for breakfast|for lunch|for dinner|recipe|ingredients?:)\b/i.test(msg) &&
    !/\b\d+\s*g(ram)?s?\b/i.test(msg)
  ) {
    return { isRefine: false };
  }

  const targetHint = extractTargetHint(msg);

  // Bare grams: "100g", "100 grams", "75.5g"
  if (/^\s*\d+(\.\d+)?\s*g(ram)?s?\s*$/i.test(raw)) {
    const n = parseFloat(raw);
    if (n > 0 && n <= 5000) {
      return { isRefine: true, kind: 'absolute_grams', weightGrams: Math.round(n), targetHint };
    }
  }

  // Transition format: "27g ➔ 68g", "27g -> 68g", "27g to 68g"
  {
    const m = msg.match(/\b\d+(?:\.\d+)?\s*g\s*(?:➔|->|to)\s*(\d+(?:\.\d+)?)\s*g\b/i);
    if (m) {
      const n = parseFloat(m[1]);
      if (n > 0 && n <= 5000) {
        return { isRefine: true, kind: 'absolute_grams', weightGrams: Math.round(n), targetHint };
      }
    }
  }

  // "change/set/adjust weight|portion|size to 100g" / "make it 100g"
  {
    const m = msg.match(
      /\b(?:change|adjust|set|update|make\s+it|correct)\s+(?:the\s+)?(?:weight|portion|size|amount)?\s*(?:to\s+)?(\d+(?:\.\d+)?)\s*g/i
    );
    if (m) {
      const n = parseFloat(m[1]);
      if (n > 0 && n <= 5000) {
        return { isRefine: true, kind: 'absolute_grams', weightGrams: Math.round(n), targetHint };
      }
    }
  }

  // "actually 100g" / "use 100g" / "try 50g"
  {
    const m = msg.match(/\b(?:actually|use|try|was|were|is|about|around|roughly|approx(?:imately)?)\s+(\d+(?:\.\d+)?)\s*g\b/i);
    if (m) {
      const n = parseFloat(m[1]);
      if (n > 0 && n <= 5000) {
        return { isRefine: true, kind: 'absolute_grams', weightGrams: Math.round(n), targetHint };
      }
    }
  }

  // "I ate 100g" / "ate the full beef of 100g" / "100g of the beef" / "consumed 50 grams"
  {
    const m = msg.match(
      /\b(?:ate|eat|eaten|had|have|consumed|weighed|weight(?:ed)?|portion(?:ed)?|only)\b[^.]{0,80}?\b(\d+(?:\.\d+)?)\s*g(?:ram)?s?\b/i
    );
    if (m) {
      const n = parseFloat(m[1]);
      if (n > 0 && n <= 5000) {
        return { isRefine: true, kind: 'absolute_grams', weightGrams: Math.round(n), targetHint };
      }
    }
  }

  // "100g of beef" / "full beef of 100g" / trailing grams with food words
  {
    const m = msg.match(/\b(\d+(?:\.\d+)?)\s*g(?:ram)?s?\b/);
    if (
      m &&
      /\b(ate|eat|had|weight|portion|pack|slice|beef|chicken|yogurt|yoghurt|grams?|full|whole|only)\b/i.test(msg)
    ) {
      const n = parseFloat(m[1]);
      if (n > 0 && n <= 5000) {
        return { isRefine: true, kind: 'absolute_grams', weightGrams: Math.round(n), targetHint };
      }
    }
  }

  // Whole / full pack (panel often 100g)
  if (/\b(whole|full|entire)\s+(pack|packet|package|pot|tub|container)\b/i.test(msg)) {
    const g = msg.match(/\b(\d+(?:\.\d+)?)\s*g\b/);
    return {
      isRefine: true,
      kind: 'whole_pack',
      weightGrams: g ? Math.round(parseFloat(g[1])) : 100,
      targetHint,
    };
  }

  // "full pack of beef" / "whole pack 100g"
  if (/\b(whole|full)\s+pack\b/i.test(msg) || /\bpack\s*(of\s*)?(all|whole)?\b.*\b100\s*g\b/i.test(msg)) {
    return { isRefine: true, kind: 'whole_pack', weightGrams: 100, targetHint };
  }

  // N slices / portions
  {
    const m = msg.match(/\b(\d+)\s*(?:slices?|portions?|servings?|pieces?)\b/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 1 && n <= 24) {
        return { isRefine: true, kind: 'slices', weightGrams: null, unitCount: n, targetHint };
      }
    }
  }

  // N countable food items, e.g. "I only had 1 croissant", "I only ate 2 cookies".
  // Deliberately broader than the slices/portions pattern above so ordinary discrete
  // foods (croissant, egg, cookie, dumpling, etc.) are recognised without requiring a
  // generic unit noun. Requires refine-style wording ("only had/ate", "just had/ate")
  // immediately before the count so it doesn't fire on a plain new-meal description
  // like "2 croissants for breakfast, plus coffee".
  {
    const m = msg.match(/\b(?:only\s+(?:had|ate)|had\s+only|ate\s+only|just\s+(?:had|ate))\s+(\d+)\s+([a-z][a-z\-]{2,24})/i)
      || msg.match(/\b(?:had|ate)\s+(\d+)\s+([a-z][a-z\-]{2,24})\s+only\b/i);
    if (m) {
      const n = parseInt(m[1], 10);
      const noun = m[2].trim();
      const genericUnits = ['g', 'gram', 'grams', 'slice', 'slices', 'portion', 'portions', 'serving', 'servings', 'piece', 'pieces'];
      if (n >= 0 && n <= 24 && !genericUnits.includes(noun)) {
        return { isRefine: true, kind: 'item_count', weightGrams: null, unitCount: n, targetHint: noun };
      }
    }
  }

  // half / quarter pack or portion
  if (/\bhalf\s+(?:the\s+)?(?:pack|packet|package|portion|of\s+it|of\s+the)\b/i.test(msg) || /\bhalf\b.*\bpack\b/i.test(msg)) {
    return { isRefine: true, kind: 'half', weightGrams: null, targetHint };
  }
  if (/\bquarter\s+(?:of\s+)?(?:the\s+)?(?:pack|packet|package|portion)\b/i.test(msg)) {
    return { isRefine: true, kind: 'quarter', weightGrams: null, targetHint };
  }

  return { isRefine: false };
}

function extractTargetHint(msgLower: string): string | undefined {
  // "of the beef topside" / "the yogurt" / "beef"
  const ofThe = msgLower.match(/\b(?:of|for)\s+(?:the\s+)?([a-z][a-z0-9\s\-']{1,40}?)(?:\s+(?:to|at|was|is|weigh|\d)|$)/i);
  if (ofThe) {
    const t = ofThe[1]
      .replace(/\b(full|whole|entire|pack|packet|grams?|g|portion|slice|slices)\b/gi, '')
      .trim();
    if (t.length >= 3) return t.slice(0, 48);
  }
  const foods = msgLower.match(
    /\b(beef|chicken|yogurt|yoghurt|ham|turkey|cheese|salmon|bacon|rice|bread|pasta|fish|pork|lamb|topside)\b/i
  );
  if (foods) return foods[1].toLowerCase();
  return undefined;
}

/** Item has a usable printed nutrition panel (same spirit as B7 complete label). */
export function scoutItemHasPrintedLabel(item: any): boolean {
  const raw = item?.rawNutritionLabel;
  if (!raw || typeof raw !== 'object') return false;
  const c = raw.calories ?? raw.energy ?? raw.kcal;
  if (c == null || c === '') return false;
  const m = String(c).match(/-?\d+(?:\.\d+)?/);
  if (!(m && parseFloat(m[0]) > 0)) return false;
  let filled = 0;
  for (const [k, v] of Object.entries(raw)) {
    const ck = k.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (ck === 'servingsize' || ck === 'weight' || ck === 'servingspercontainer') continue;
    if (v === undefined || v === null || v === '' || v === '-' || v === '--') continue;
    filled++;
  }
  return filled >= 3;
}

export function priorScoutHasLabelLocks(scoutItems: any[] | null | undefined): boolean {
  if (!Array.isArray(scoutItems) || scoutItems.length === 0) return false;
  return scoutItems.some((it) => scoutItemHasPrintedLabel(it));
}

function parseSliceUnitGrams(item: any): number {
  const servingsRaw =
    item?.rawNutritionLabel?.servingsPerContainer ??
    item?.rawNutritionLabel?.servings ??
    item?.rawNutritionLabel?.numberOfServings;
  const servings =
    servingsRaw != null && String(servingsRaw).trim() !== ''
      ? Math.round(Number(String(servingsRaw).match(/[\d.]+/)?.[0] || 0))
      : null;
  if (servings != null && servings >= 2 && servings <= 12) {
    return Math.max(5, Math.round(100 / servings));
  }
  // Common UK meat pack default
  return 25;
}

function resolveTargetIndex(scoutItems: any[], targetHint?: string): number {
  if (!Array.isArray(scoutItems) || scoutItems.length === 0) return 0;
  if (scoutItems.length === 1) return 0;

  if (targetHint) {
    const hint = targetHint.toLowerCase();
    let best = -1;
    let bestScore = 0;
    scoutItems.forEach((it, idx) => {
      const name = String(it.originalName || it.keyword || it.name || '').toLowerCase();
      let score = 0;
      if (name.includes(hint)) score = hint.length + 10;
      else if (hint.split(/\s+/).some((w) => w.length >= 3 && name.includes(w))) score = 5;
      if (score > bestScore) {
        bestScore = score;
        best = idx;
      }
    });
    if (best >= 0) return best;
  }

  // Prefer multi-serve pack with printed label (beef over yogurt pot)
  const multi = scoutItems.findIndex((it) => {
    if (!scoutItemHasPrintedLabel(it)) return false;
    const w = Math.round(Number(it.estimatedWeightGrams) || 0);
    const name = String(it.originalName || it.keyword || '').toLowerCase();
    if (/\b(yogurt|yoghurt|pot)\b/i.test(name) && w >= 150) return false;
    const servings = it?.rawNutritionLabel?.servingsPerContainer;
    if (servings != null && Number(servings) >= 2) return true;
    if (/\b(slice|topside|rashers)\b/i.test(name)) return true;
    return w > 0 && w < 100 && scoutItemHasPrintedLabel(it);
  });
  if (multi >= 0) return multi;

  const labeled = scoutItems.findIndex((it) => scoutItemHasPrintedLabel(it));
  if (labeled >= 0) return labeled;
  return 0;
}

/**
 * Resolve absolute grams for the intent against a target scout item.
 */
export function resolveRefineWeightGrams(intent: WeightRefineIntent, targetItem: any): number | null {
  if (!intent.isRefine) return null;
  if (intent.kind === 'absolute_grams' && intent.weightGrams != null && intent.weightGrams > 0) {
    return Math.round(intent.weightGrams);
  }
  if (intent.kind === 'whole_pack') {
    if (intent.weightGrams && intent.weightGrams > 0) return Math.round(intent.weightGrams);
    const raw = targetItem?.rawNutritionLabel;
    if (raw) {
      if (raw.totalPackWeight != null && String(raw.totalPackWeight).trim() !== '') {
        const tw = Number(String(raw.totalPackWeight).match(/[\d.]+/)?.[0] || 0);
        if (tw > 0) return Math.round(tw);
      }
      const servingsRaw = raw.servingsPerContainer ?? raw.servings ?? raw.numberOfServings;
      if (servingsRaw != null && String(servingsRaw).trim() !== '') {
        const servings = Number(String(servingsRaw).match(/[\d.]+/)?.[0] || 0);
        const sizeGrams = Number(String(raw.servingSize || '').match(/[\d.]+/)?.[0] || 0);
        if (servings > 0 && sizeGrams > 0) {
          return Math.round(servings * sizeGrams);
        }
      }
    }
    return 100;
  }
  if (intent.kind === 'slices' && intent.unitCount != null) {
    return Math.round(intent.unitCount * parseSliceUnitGrams(targetItem));
  }
  if (intent.kind === 'item_count' && intent.unitCount != null) {
    // Scale from the target's existing per-unit weight if we know how many units it
    // currently represents (pieceCount, or a leading digit in its own name e.g. "2
    // Croissants"). If we can't determine a per-unit weight, return null rather than
    // guess — the caller leaves the weight untouched, which is still strictly better
    // than the old behaviour of re-running Vision Scout and losing the photo binding.
    const origWeight = Number(targetItem?.estimatedWeightGrams) || 0;
    let origCount =
      Number(targetItem?.pieceCount) ||
      Number(String(targetItem?.originalName || '').match(/^(\d+)\b/)?.[1]) ||
      0;
      
    if (origCount === 0 && origWeight > 0) {
      // If unspecified, guess original count based on plurality of the name — but only
      // for foods that are genuinely eaten as discrete countable units. Mass-noun plurals
      // (fries, greens, noodles, grapes, beans, oats, chips, crisps,
      // berries, leaves, sprouts, herbs, spices, crumbs, chunks, shreds,
      // flakes, grains, lentils, peas, nuts, seeds, raisins, olives,
      // are not "2 units" just because the name ends in "s", so we deliberately exclude
      // common ones here rather than let the guess silently misfire on them.
      const name = String(targetItem?.originalName || targetItem?.keyword || '').toLowerCase();
      const massNounPlurals = [
        'fries', 'greens', 'noodles', 'grapes', 'beans', 'oats', 'chips', 'crisps',
        'berries', 'leaves', 'sprouts', 'herbs', 'spices', 'crumbs', 'chunks', 'shreds',
        'flakes', 'grains', 'lentils', 'peas', 'nuts', 'seeds', 'raisins', 'olives',
      ];
      const isMassNoun = massNounPlurals.some((w) => name.includes(w));
      if (!isMassNoun && name.endsWith('s') && !name.endsWith('ss')) {
        origCount = 2; // Plural defaults to 2 units (e.g. "croissants" -> 2)
      } else {
        origCount = 1; // Singular, or an excluded mass-noun plural, defaults to 1
      }
    }

    if (origWeight > 0 && origCount > 0) {
      return Math.max(1, Math.round((origWeight / origCount) * intent.unitCount));
    }
    return null;
  }
  if (intent.kind === 'half') {
    return 50; // per-100g pack default
  }
  if (intent.kind === 'quarter') {
    return 25;
  }
  if (intent.weightGrams != null && intent.weightGrams > 0) {
    return Math.round(intent.weightGrams);
  }
  return null;
}

/**
 * Apply weight refine to prior scout items. Returns new array (does not mutate).
 * Logs caller should emit REFINE_SCALE_ONLY_LOG when this is used on the scale-only path.
 */
export function applyWeightRefineToScoutItems(
  scoutItems: any[] | null | undefined,
  intent: WeightRefineIntent
): any[] {
  if (!Array.isArray(scoutItems) || scoutItems.length === 0) return scoutItems || [];
  if (!intent.isRefine) return scoutItems;

  const idx = resolveTargetIndex(scoutItems, intent.targetHint);
  const target = scoutItems[idx];
  const grams = resolveRefineWeightGrams(intent, target);
  if (grams == null || !(grams > 0)) return scoutItems;

  const si = target?.scoutIndex != null ? Number(target.scoutIndex) : idx;
  const choices: Record<string, number> = { [String(si)]: grams, [String(idx)]: grams };
  return applyPortionChoices(scoutItems, choices);
}

/**
 * Should food-analyze skip Vision Scout and DB search for this request?
 *
 * Path A: no images + refine + prior scout (or active meal context via caller).
 * Path B: images present but prior scout has printed label locks + refine text.
 */
export function shouldSkipScoutForWeightRefine(opts: {
  message?: string | null;
  imageCount?: number;
  activeScoutItems?: any[] | null;
  activeMeal?: any;
  explicitSkipScout?: boolean;
}): { skip: boolean; intent: WeightRefineIntent; reason: string } {
  const intent = detectWeightRefineIntent(opts.message);
  if (!intent.isRefine) {
    return { skip: false, intent, reason: 'not_refine' };
  }

  const prior = Array.isArray(opts.activeScoutItems) ? opts.activeScoutItems : [];
  if (prior.length === 0) {
    return { skip: false, intent, reason: 'no_prior_scout' };
  }

  const imageCount = opts.imageCount || 0;
  const hasLocks = priorScoutHasLabelLocks(prior);
  const hasMeal = !!(opts.activeMeal && (opts.activeMeal.itemsBreakdown || opts.activeMeal.nutrients));

  if (imageCount === 0 && (hasLocks || hasMeal || prior.length > 0)) {
    return { skip: true, intent, reason: 'path_a_text_only' };
  }

  // Path B: images still attached from prior compose, but labels already locked
  if (imageCount > 0 && hasLocks) {
    return { skip: true, intent, reason: 'path_b_images_with_label_locks' };
  }

  // Path C: images still attached from prior compose (frontend resends them on
  // follow-up edits), but this is a named whole-item count correction ("I only had 1
  // croissant") against an item we can already identify in this meal by name. There is
  // no reason to re-run Vision Scout just to reprocess a text portion correction — doing
  // so both burns Gemini quota for no benefit and lets Scout re-assign a fresh
  // sourceImageIndex per item, which desyncs the photo shown against each meal
  // component. Only applies when we can actually find the named item in prior scout —
  // otherwise fall through to the normal full pipeline as before.
  if (imageCount > 0 && intent.kind === 'item_count') {
    const hint = String(intent.targetHint || '').toLowerCase().replace(/s$/, '');
    const targetIdx = hint
      ? prior.findIndex((it) => String(it.originalName || it.keyword || it.name || '').toLowerCase().includes(hint))
      : -1;
    if (targetIdx >= 0) {
      return { skip: true, intent, reason: 'path_c_item_count_named_target' };
    }
  }

  if (opts.explicitSkipScout && prior.length > 0) {
    return { skip: true, intent, reason: 'explicit_skip_scout' };
  }

  return { skip: false, intent, reason: 'images_without_locks' };
}
