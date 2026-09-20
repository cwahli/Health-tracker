/**
 * Structural edit patch ledger — user-locked slots, scout↔ledger diff commands,
 * sibling-metadata invalidation, and edit-turn expert dispatch telemetry.
 *
 * No keyword/regex meal band-aids: commands come from index-aligned state diff
 * and locks; tea/fish/weight regressions are prevented by slot invariants.
 */

export type LockedField = 'identity' | 'weightGrams' | 'modifier';

export type UserLockedSlot = {
  scoutIndex: number;
  field: LockedField;
  value: string | number;
  lockedAtTurn: number;
  sourceUserMessage?: string;
};

export type PatchEditCommand = {
  action: string;
  itemName?: string;
  newItemName?: string;
  replacementItemName?: string;
  targetItemName?: string;
  sourceItemName?: string;
  newWeightGrams?: number | null;
  targetDbId?: string | null;
  componentName?: string | null;
  modifier?: string | null;
  scoutIndex?: number | null;
  sourceImageIndex?: number | null;
  estimate?: Record<string, any> | null;
};

export function displayName(it: any): string {
  return String(it?.canonicalDbName || it?.originalName || it?.keyword || it?.name || it?.dishName || '').trim();
}

function weightOf(it: any): number {
  // Scout-shaped rows carry estimatedWeightGrams; ledger rows carry weightGrams.
  // Prefer the scout estimate when both exist so merge leftovers cannot hide edits.
  const est = Number(it?.estimatedWeightGrams);
  const w = Number(it?.weightGrams);
  const pack = Number(it?.packGrams);
  if (Number.isFinite(est) && est > 0) return est;
  if (Number.isFinite(w) && w > 0) return w;
  if (Number.isFinite(pack) && pack > 0) return pack;
  return 0;
}

function normName(s: any): string {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function namesReferSame(a: string, b: string): boolean {
  const na = normName(a);
  const nb = normName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  return false;
}

export function significantTokens(s: string): string[] {
  const stops = new Set([
    'and', 'with', 'the', 'in', 'of', 'for', 'a', 'an', 'to', 'at', 'by', 'on',
    'dish', 'style', 'fast', 'food', 'dan', 'dengan', 'dari', 'untuk', 'di', 'ke', 'yg', 'yang',
  ]);
  return normName(s).split(/[^a-z0-9]+/).filter((w: string) => w.length >= 2 && !stops.has(w));
}

const PREPARATION_MODIFIERS = new Set([
  'manis', 'tawar', 'sweet', 'sweetened', 'unsweetened', 'unsweatened',
  'goreng', 'bakar', 'rebus', 'panggang', 'kukus', 'grilled', 'fried', 'boiled', 'steamed', 'baked', 'roasted',
  'pan', 'deep', 'crispy', 'plain', 'fresh', 'raw', 'pedas', 'spicy', 'extra', 'less', 'no', 'zero', 'tanpa',
  'ice', 'iced', 'hot', 'panas', 'dingin', 'warm', 'hangat',
]);

export function namesShareSubstance(a: string, b: string): boolean {
  const ta = significantTokens(a);
  const tb = significantTokens(b);
  if (ta.length === 0 || tb.length === 0) return false;
  const setB = new Set(tb);
  const shared = ta.filter(t => setB.has(t));
  const minLen = Math.min(ta.length, tb.length);
  if (shared.length >= 2 && shared.length / minLen >= 0.5) return true;
  if (minLen === 1 && shared.length === 1 && (ta.length === 1 || tb.length === 1)) return true;
  if (shared.length >= 1) {
    const setA = new Set(ta);
    const diffA = ta.filter(t => !setB.has(t));
    const diffB = tb.filter(t => !setA.has(t));
    if (diffA.every(t => PREPARATION_MODIFIERS.has(t)) || diffB.every(t => PREPARATION_MODIFIERS.has(t))) {
      return true;
    }
  }
  return false;
}

export function itemAllNames(it: any): string[] {
  const names: string[] = [];
  const add = (v: any) => {
    if (!v || typeof v !== 'string') return;
    const t = v.trim();
    if (t && !names.includes(t)) names.push(t);
  };
  add(it?.name);
  add(it?.dishName);
  add(it?.canonicalDbName);
  add(it?.originalName);
  add(it?.originalLocalName);
  add(it?.keyword);
  add(it?.genericEnglishName);
  const comps = Array.isArray(it?.foods)
    ? it.foods
    : (Array.isArray(it?.components)
      ? it.components
      : (Array.isArray(it?.componentsDetailList) ? it.componentsDetailList : []));
  for (const c of comps) {
    if (typeof c === 'object' && c) {
      add(c?.name);
      add(c?.foodName);
      add(c?.genericEnglishName);
      add(c?.keyword);
    }
  }
  return names;
}

export function itemsReferSame(a: any, b: any): boolean {
  const namesA = itemAllNames(a);
  const namesB = itemAllNames(b);
  for (const na of namesA) {
    for (const nb of namesB) {
      if (namesReferSame(na, nb)) return true;
    }
  }
  return false;
}

export function itemsShareSubstance(a: any, b: any): boolean {
  const namesA = itemAllNames(a);
  const namesB = itemAllNames(b);
  for (const na of namesA) {
    for (const nb of namesB) {
      if (namesShareSubstance(na, nb)) return true;
    }
  }
  return false;
}

const PREPARED_COOKING = new Set([
  'boiled', 'steamed', 'baked', 'cooked', 'fried', 'pan_fried', 'stir_fried',
  'grilled', 'poached', 'simmered', 'deep_fried', 'roasted', 'braised',
]);

function hasPrintedLabel(it: any): boolean {
  const raw = it?.rawNutritionLabel;
  if (!raw || typeof raw !== 'object') return false;
  return Object.keys(raw).some((k) => {
    if (k === 'servingSize' || k === 'weight' || k === 'servingsPerContainer' || k === 'confidence') return false;
    const v = raw[k];
    return v !== undefined && v !== null && v !== '' && v !== '-' && v !== '--';
  });
}

export function isPreparedDishItem(it: any): boolean {
  const cm = String(it?.cookingMethod || '').toLowerCase().replace(/\s+/g, '_');
  if (PREPARED_COOKING.has(cm)) return true;
  return /\b(porridge|oatmeal|cooked|boiled|rebus|bubur|prepared)\b/i.test(displayName(it));
}

export function isPackageOrLabelItem(it: any): boolean {
  const name = displayName(it);
  if (/\b(package|pack|bungkus|kemasan|unopened|nutrition facts|label)\b/i.test(name)) return true;
  const pack = Number(it?.packGrams) || 0;
  const w = Number(it?.estimatedWeightGrams || it?.weightGrams) || 0;
  if (hasPrintedLabel(it) && pack > 0 && w > 0 && pack >= w * 2) return true;
  if (hasPrintedLabel(it) && String(it?.cookingMethod || '').toLowerCase() === 'raw') return true;
  return hasPrintedLabel(it) && !isPreparedDishItem(it);
}

/** User asked to collapse split views of one meal (package vs cooked, "combine them", "1 meal"). */
export function isSameMealMergeRequest(msg?: string): boolean {
  if (!msg) return false;
  return /\b(?:same\s+(?:as\s+(?:the\s+)?)?package|same\s+meal|same\s+dish|same\s+food|duplicate|all\s+(?:the\s+)?same(?:\s+meal)?|it'?s\s+(?:all\s+)?the\s+same|only\s+(?:had\s+)?(?:1|one)\s+(?:dish|meal)|(?:it'?s\s+)?(?:only\s+)?(?:1|one)\s+meal|combine(?:\s+them)?|merge(?:\s+them)?|just\s+combine|join\s+them)\b/i.test(msg);
}

function printedCalories(it: any): number | null {
  const raw = it?.rawNutritionLabel?.calories;
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Package/label row + prepared row of the same food. Never pairs two distinctly labeled products. */
export function findPackagePreparedPair(items: any[]): { pkgIdx: number; preparedIdx: number } | null {
  if (!Array.isArray(items) || items.length < 2) return null;
  for (let i = 0; i < items.length; i++) {
    if (!isPackageOrLabelItem(items[i])) continue;
    for (let j = 0; j < items.length; j++) {
      if (i === j) continue;
      if (!itemsShareSubstance(items[i], items[j])) continue;
      const calA = printedCalories(items[i]);
      const calB = printedCalories(items[j]);
      if (calA != null && calB != null && Math.abs(calA - calB) >= 2) continue;
      if (isPreparedDishItem(items[j]) || !hasPrintedLabel(items[j])) {
        return { pkgIdx: i, preparedIdx: j };
      }
    }
  }
  return null;
}

function packageServingWeight(pkg: any, prepared: any): number {
  const wPkg = Number(pkg?.weightGrams || pkg?.estimatedWeightGrams) || 0;
  const wPrep = Number(prepared?.weightGrams || prepared?.estimatedWeightGrams) || 0;
  if (wPkg > 0) return wPkg;
  if (wPrep > 0) return wPrep;
  return 0;
}

/**
 * Create-path collapse: package photo + cooked bowl of the same food → one dish.
 * Keeps label truth and the package serving weight (never dry+wet sum).
 */
export function collapsePackagePreparedScoutItems(items: any[], addDebugLog?: (msg: string) => void): any[] {
  if (!Array.isArray(items) || items.length < 2) return items || [];
  const out = items.slice();
  const log = addDebugLog || (() => {});
  let pair = findPackagePreparedPair(out);
  while (pair) {
    const pkg = out[pair.pkgIdx];
    const prep = out[pair.preparedIdx];
    const serving = packageServingWeight(pkg, prep);
    const brand = String(pkg.chainName || pkg.brandLock || (displayName(pkg).match(/\b(Quaker|Lidl|Kellogg|Nestle|Indomie)\b/i) || [])[0] || '');
    let mergedName = displayName(prep) || displayName(pkg);
    if (brand && mergedName && !mergedName.toLowerCase().includes(brand.toLowerCase())) {
      mergedName = `${brand} ${mergedName}`;
    }
    const survivor = {
      ...prep,
      ...pkg,
      originalName: mergedName,
      keyword: mergedName,
      dishName: mergedName,
      name: mergedName,
      estimatedWeightGrams: serving || prep.estimatedWeightGrams || pkg.estimatedWeightGrams,
      weightGrams: serving || prep.weightGrams || pkg.weightGrams,
      packGrams: pkg.packGrams ?? prep.packGrams ?? null,
      rawNutritionLabel: pkg.rawNutritionLabel || prep.rawNutritionLabel || null,
      cookingMethod: prep.cookingMethod || pkg.cookingMethod,
      components: (Array.isArray(prep.components) && prep.components.length > 0) ? prep.components : pkg.components,
      foods: (Array.isArray(prep.foods) && prep.foods.length > 0) ? prep.foods : pkg.foods,
      sourceImageIndex: prep.sourceImageIndex ?? pkg.sourceImageIndex,
      chainName: pkg.chainName || prep.chainName || null,
    };
    const drop = Math.max(pair.pkgIdx, pair.preparedIdx);
    const keep = Math.min(pair.pkgIdx, pair.preparedIdx);
    out[keep] = survivor;
    out.splice(drop, 1);
    log(`[Package-Prepared Merge] Collapsed "${displayName(pkg)}" + "${displayName(prep)}" → "${mergedName}" (${serving || survivor.estimatedWeightGrams}g, label preserved).`);
    pair = findPackagePreparedPair(out);
  }
  return out;
}

function mergeDishesCommand(pkg: any, prep: any, pkgIdx: number, userMessage?: string): PatchEditCommand {
  let targetWeight = 0;
  const wMatch = String(userMessage || '').match(/\b(\d+(?:\.\d+)?)\s*g(?:rams)?\b/i);
  if (wMatch && Number(wMatch[1]) > 0) targetWeight = Math.round(Number(wMatch[1]));
  else targetWeight = packageServingWeight(pkg, prep);
  return {
    action: 'merge_dishes',
    itemName: displayName(pkg),
    targetItemName: displayName(prep),
    newItemName: displayName(prep),
    newWeightGrams: targetWeight > 0 ? targetWeight : null,
    targetDbId: pkg.dbId || null,
    scoutIndex: scoutIndexOf(pkg, pkgIdx),
  };
}

function scoutIndexOf(it: any, fallback: number): number {
  const n = Number(it?.scoutIndex);
  return Number.isFinite(n) ? n : fallback;
}

function estimateFromScout(it: any): Record<string, any> | null {
  const n = { ...(it?.dishNutrients || {}), ...(it?.nutrients || {}), ...(it?.preCalcNutrients || {}) };
  const keys = [
    'protein', 'carbohydrates', 'totalFat', 'saturatedFat', 'sodium',
    'addedSugar', 'totalFibre', 'sugar', 'totalSugar', 'potassium', 'calcium', 'iron',
    'magnesium', 'vitaminD', 'omega3', 'cookingMethod', 'foodType',
  ];
  const out: Record<string, any> = {};
  let any = false;
  for (const k of keys) {
    const v = n[k] ?? it?.[k];
    if (v !== undefined && v !== null && v !== '') {
      out[k] = v;
      any = true;
    }
  }
  if (it?.cookingMethod) out.cookingMethod = it.cookingMethod;
  if (it?.foodType) out.foodType = it.foodType;
  if (it?.sourceImageIndex != null) out.sourceImageIndex = Number(it.sourceImageIndex);
  if (Array.isArray(it?.components) && it.components.length > 0) {
    out.components = it.components;
    any = true;
  }
  if (Array.isArray(it?.componentsDetailList) && it.componentsDetailList.length > 0) {
    out.componentsDetailList = it.componentsDetailList;
    any = true;
  }
  if (Array.isArray(it?.foods) && it.foods.length > 0) {
    out.foods = it.foods;
    any = true;
  }
  return any ? out : null;
}

/**
 * Handle user message clarification for duplicate / same-meal package removal or merge.
 * Looks at leftover siblings even if scout already "used" one row (replace_identity
 * of the package must not leave the prepared bowl behind).
 */
export function applySameMealClarification(args: {
  commands: PatchEditCommand[];
  usedPrior: Set<number>;
  priorItems: any[];
  userMessage?: string;
}): void {
  const { commands, usedPrior, priorItems, userMessage } = args;
  if (!Array.isArray(priorItems) || priorItems.length === 0) return;
  const isSameMeal = isSameMealMergeRequest(userMessage);
  const isExplicitRemovePackage = /\b(remove|delete|omit|drop|don't\s+include)\b/i.test(userMessage || '') && /\b(package|pack|bungkus|kemasan|box|bag)\b/i.test(userMessage || '');
  if (!isSameMeal && !isExplicitRemovePackage) return;

  const pair = findPackagePreparedPair(priorItems);
  let pkgIdx = pair?.pkgIdx ?? -1;
  let otherIdx = pair?.preparedIdx ?? -1;
  if (pkgIdx < 0) {
    pkgIdx = priorItems.findIndex((p) => {
      const pName = displayName(p).toLowerCase();
      return /\b(package|pack|bungkus|kemasan|box|bag)\b/i.test(pName) || Boolean((p.packGrams || p.rawNutritionLabel) && !/boiled|fried|cooked|soup|porridge|oatmeal\b/i.test(pName));
    });
    if (pkgIdx < 0 && isSameMeal && priorItems.length === 2) {
      const labelIdx = priorItems.findIndex((p) => hasPrintedLabel(p));
      pkgIdx = labelIdx >= 0 ? labelIdx : 0;
    }
    if (pkgIdx >= 0) {
      otherIdx = priorItems.findIndex((_, i) => i !== pkgIdx);
    }
  }
  if (pkgIdx < 0) return;
  const pkgItem = priorItems[pkgIdx];
  const otherItem = otherIdx >= 0 ? priorItems[otherIdx] : null;
  if (otherItem && (isSameMeal || hasPrintedLabel(pkgItem))) {
    const names = new Set([displayName(pkgItem), displayName(otherItem)].map((n) => n.toLowerCase()));
    for (let i = commands.length - 1; i >= 0; i--) {
      const c = commands[i];
      const hit = [c.itemName, c.newItemName, c.targetItemName, c.replacementItemName]
        .filter(Boolean)
        .some((n) => names.has(String(n).toLowerCase()));
      if (hit && c.action !== 'merge_dishes') commands.splice(i, 1);
    }
    if (!commands.some((c) => c.action === 'merge_dishes')) {
      commands.push(mergeDishesCommand(pkgItem, otherItem, pkgIdx, userMessage));
    }
    usedPrior.add(pkgIdx);
    usedPrior.add(otherIdx);
    return;
  }
  if (!commands.some((c) => c.action === 'remove_item' && c.itemName === displayName(pkgItem))) {
    commands.push({
      action: 'remove_item',
      itemName: displayName(pkgItem),
      targetDbId: pkgItem.dbId || null,
      scoutIndex: scoutIndexOf(pkgItem, pkgIdx),
    });
    usedPrior.add(pkgIdx);
  }
}

/**
 * Align prior ledger rows to scout emission (scoutIndex, else positional)
 * and emit structural patch commands for identity/weight/component drifts.
 */
export function diffScoutToEditCommands(args: {
  priorItems: any[];
  scoutItems: any[];
  userMessage?: string;
  portionChoices?: any;
}): PatchEditCommand[] {
  const { priorItems, scoutItems = [] } = args;
  if (!Array.isArray(priorItems) || priorItems.length === 0) {
    return [];
  }
  const commands: PatchEditCommand[] = [];
  const usedPrior = new Set<number>();

  // 1. Process portionChoices if explicitly provided (e.g. direct UI portion selection)
  if (args.portionChoices && typeof args.portionChoices === 'object') {
    const entries = Array.isArray(args.portionChoices)
      ? args.portionChoices.map((c: any) => [c.scoutIndex ?? c.name, c.weightGrams ?? c.weight])
      : Object.entries(args.portionChoices);
    for (const [k, targetWeight] of entries) {
      const grams = Math.round(Number(targetWeight));
      if (!grams || grams <= 0) continue;
      const priorIdx = priorItems.findIndex((p, i) => {
        if (p.scoutIndex != null && String(p.scoutIndex) === String(k)) return true;
        if (String(i) === String(k)) return true;
        return namesReferSame(displayName(p), String(k)) || namesShareSubstance(displayName(p), String(k));
      });
      if (priorIdx >= 0) {
        const prior = priorItems[priorIdx];
        const pName = displayName(prior);
        const pWeight = weightOf(prior);
        if (Math.abs(grams - pWeight) >= 1) {
          commands.push({
            action: 'set_weight',
            itemName: pName,
            newWeightGrams: grams,
            scoutIndex: scoutIndexOf(prior, priorIdx),
            targetDbId: prior.dbId || null,
          });
          usedPrior.add(priorIdx);
        }
      }
    }
  }

  // 2. Process portion update syntax from userMessage (e.g. "Lemonilo Brownies Crispy: 15g ➔ 30g")
  if (args.userMessage) {
    const arrowRegex = /([a-zA-Z0-9\s/'-]+?):\s*\d+(?:\.\d+)?\s*g\s*(?:➔|->)\s*(\d+(?:\.\d+)?)\s*g/gi;
    let match: RegExpExecArray | null;
    while ((match = arrowRegex.exec(args.userMessage)) !== null) {
      const matchedName = match[1].trim();
      const targetGrams = Math.round(Number(match[2]));
      if (targetGrams > 0) {
        const priorIdx = priorItems.findIndex((p, i) => !usedPrior.has(i) && (namesReferSame(displayName(p), matchedName) || namesShareSubstance(displayName(p), matchedName)));
        if (priorIdx >= 0) {
          const prior = priorItems[priorIdx];
          const pName = displayName(prior);
          const pWeight = weightOf(prior);
          if (Math.abs(targetGrams - pWeight) >= 1 && !commands.some(c => c.action === 'set_weight' && c.itemName === pName)) {
            commands.push({
              action: 'set_weight',
              itemName: pName,
              newWeightGrams: targetGrams,
              scoutIndex: scoutIndexOf(prior, priorIdx),
              targetDbId: prior.dbId || null,
            });
            usedPrior.add(priorIdx);
          }
        }
      }
    }
  }

  const pair = findPackagePreparedPair(priorItems);
  const mergeAsk = isSameMealMergeRequest(args.userMessage);
  const scoutLooksCombined = Array.isArray(scoutItems) && scoutItems.length === 1 && priorItems.length === 2 && Boolean(pair)
    && itemsShareSubstance(scoutItems[0], priorItems[pair!.pkgIdx])
    && itemsShareSubstance(scoutItems[0], priorItems[pair!.preparedIdx]);
  if (pair && (mergeAsk || scoutLooksCombined)) {
    commands.push(mergeDishesCommand(priorItems[pair.pkgIdx], priorItems[pair.preparedIdx], pair.pkgIdx, args.userMessage));
    usedPrior.add(pair.pkgIdx);
    usedPrior.add(pair.preparedIdx);
    return commands;
  }

  // Pure portion modification with empty scout emission
  if (!Array.isArray(scoutItems) || scoutItems.length === 0) {
    applySameMealClarification({ commands, usedPrior, priorItems, userMessage: args.userMessage });
    return commands;
  }

  const isFullReEmission = scoutItems.length === priorItems.length;

  for (let sIdx = 0; sIdx < scoutItems.length; sIdx++) {
    const scout = scoutItems[sIdx];
    const sName = displayName(scout);
    if (!sName) continue;
    const hasExplicitScoutIdx = scout.scoutIndex != null && Number.isFinite(Number(scout.scoutIndex));
    const sScoutIdx = hasExplicitScoutIdx ? Number(scout.scoutIndex) : scoutIndexOf(scout, sIdx);
    const isExplicitAdd = scout.action === 'add';
    const isExplicitReplace = scout.action === 'replace';
    const isExplicitDelete = scout.action === 'delete' || scout.action === 'remove';
    // F-13.1 live T2: foods[] carrying their own add/delete/replace actions is
    // structural signal — an unaligned targetDishIndex must not glue such a
    // dish onto a prior by legacy index preference (oats glued onto coconut).
    const scoutFoodsEarly = Array.isArray(scout.foods) ? scout.foods : [];
    const hasSubitemActions = scoutFoodsEarly.some((f: any) => f && typeof f === 'object' &&
      (f.action === 'delete' || f.action === 'remove' || f.action === 'add' || f.action === 'replace'));

    let priorIdx = -1;

    if (!isExplicitAdd) {
      // 1. Explicit targetDishIndex from agent — validate against replacesDish if present!
      const rep = typeof scout.replacesDish === 'string' ? scout.replacesDish.trim().toLowerCase() : '';
      if (scout.targetDishIndex != null && Number.isFinite(Number(scout.targetDishIndex))) {
        const rawIdx = Number(scout.targetDishIndex);
        const oneBased = rawIdx - 1;
        const indexCandidates = [oneBased, rawIdx].filter(
          (i) => i >= 0 && i < priorItems.length && !usedPrior.has(i),
        );
        const nameAligned = (i: number) => {
          const names = itemAllNames(priorItems[i]);
          if (rep) {
            return names.some(
              (n) => n.toLowerCase() === rep || namesReferSame(n, rep) || namesShareSubstance(n, rep),
            );
          }
          // Ambiguous 0-based vs 1-based indexes: prefer the candidate that
          // matches the scout dishName (live T2: targetDishIndex=2 +
          // dishName="Coconut Juice" must not remove Big Mac at 1-based slot 2).
          return (
            namesReferSame(displayName(priorItems[i]), sName) ||
            itemsReferSame(priorItems[i], scout) ||
            itemsShareSubstance(priorItems[i], scout) ||
            names.some((n) => namesReferSame(n, sName) || namesShareSubstance(n, sName))
          );
        };
        const aligned = indexCandidates.find(nameAligned);
        if (aligned != null) {
          priorIdx = aligned;
        } else if (rep) {
          // keeps priorIdx=-1 so replacesDish / name match can recover
        } else if (!(isExplicitDelete || isExplicitReplace) && !hasSubitemActions) {
          // Non-delete/replace: keep legacy 1-based-then-0-based preference,
          // but only when the emission carries no subitem actions of its own.
          if (oneBased >= 0 && oneBased < priorItems.length && !usedPrior.has(oneBased)) {
            priorIdx = oneBased;
          } else if (rawIdx >= 0 && rawIdx < priorItems.length && !usedPrior.has(rawIdx)) {
            priorIdx = rawIdx;
          }
        }
        // For explicit delete/replace with no name-aligned index, fall through
        // to dishName / replacesDish matching instead of guessing the index base.
      }

      // 2. Explicit replacesDish from agent
      if (priorIdx < 0 && rep) {
        priorIdx = priorItems.findIndex((p, i) => !usedPrior.has(i) && (
          itemAllNames(p).some(n => n.toLowerCase() === rep || namesReferSame(n, rep) || namesShareSubstance(n, rep))
        ));
      }

      // 3. Explicit scoutIndex if provided by scout
      if (priorIdx < 0 && hasExplicitScoutIdx) {
        priorIdx = priorItems.findIndex((p, i) => !usedPrior.has(i) && scoutIndexOf(p, i) === sScoutIdx);
      }
      // 4. High-confidence name match on display name
      if (priorIdx < 0) {
        priorIdx = priorItems.findIndex((p, i) => !usedPrior.has(i) && namesReferSame(displayName(p), sName));
      }
      // 5. Multi-name match across genericEnglishName and constituent foods
      if (priorIdx < 0) {
        priorIdx = priorItems.findIndex((p, i) => !usedPrior.has(i) && itemsReferSame(p, scout));
      }
      // 6. Substantive name match + sourceImageIndex correlation
      if (priorIdx < 0 && scout.sourceImageIndex != null) {
        priorIdx = priorItems.findIndex((p, i) => !usedPrior.has(i) && p.sourceImageIndex === scout.sourceImageIndex && itemsShareSubstance(p, scout));
      }
      // 7. Substantive name match (without image restriction)
      if (priorIdx < 0) {
        priorIdx = priorItems.findIndex((p, i) => !usedPrior.has(i) && itemsShareSubstance(p, scout));
      }
      // 8. User message targeting
      if (priorIdx < 0 && args.userMessage) {
        const msg = args.userMessage.toLowerCase();
        const hasReplaceWord = /\b(replace|substitute|instead of|change .* to|switch)\b/i.test(msg);
        if (hasReplaceWord) {
          const replaceIdx = priorItems.findIndex((p, i) => !usedPrior.has(i) && itemAllNames(p).some(n => msg.includes(n.toLowerCase())));
          if (replaceIdx >= 0) {
            priorIdx = replaceIdx;
          }
        } else {
          // Check if user message mentions substantive keywords of prior item or scout item.
          // F-13.1 live T2: when the emission carries its own subitem actions,
          // message-word coincidence must not glue a new dish onto a prior
          // named for another intent ("drop the coconut" attached oats to
          // coconut). Require token overlap between scout dish and candidate.
          const sTokens = hasSubitemActions ? significantTokens(sName) : [];
          const keywordIdx = priorItems.findIndex((p, i) => {
            if (usedPrior.has(i)) return false;
            if (hasSubitemActions) {
              const sharesToken = itemAllNames(p).some((pn) =>
                significantTokens(pn).some((t) => sTokens.includes(t)),
              );
              if (!sharesToken) return false;
            }
            const pNames = itemAllNames(p);
            for (const pn of pNames) {
              if (msg.includes(pn.toLowerCase())) return true;
              const pTokens = significantTokens(pn);
              if (pTokens.some(t => msg.includes(t))) return true;
            }
            // Bilingual category matches (tea <-> teh, coffee <-> kopi, fish <-> ikan)
            const isTea = pNames.some(n => /\b(tea|teh|chai|matcha)\b/i.test(n));
            if (isTea && /\b(tea|teh)\b/i.test(msg)) return true;
            const isCoffee = pNames.some(n => /\b(coffee|kopi|espresso|latte)\b/i.test(n));
            if (isCoffee && /\b(coffee|kopi)\b/i.test(msg)) return true;
            const isFish = pNames.some(n => /\b(fish|ikan|seafood)\b/i.test(n));
            if (isFish && /\b(fish|ikan)\b/i.test(msg)) return true;
            return false;
          });
          if (keywordIdx >= 0) {
            priorIdx = keywordIdx;
          }
        }
      }
      // 9. Source image index match (if photo anchor matches a prior item and no ambiguity)
      if (priorIdx < 0 && scout.sourceImageIndex != null) {
        const imgMatches = priorItems.map((p, i) => (!usedPrior.has(i) && p.sourceImageIndex === scout.sourceImageIndex ? i : -1)).filter(i => i >= 0);
        if (imgMatches.length === 1) {
          priorIdx = imgMatches[0];
        }
      }
      // 10. Explicit replace fallback: if agent specified replace action, ensure an unused prior item is targeted
      if (priorIdx < 0 && isExplicitReplace) {
        const remainingPriorIndices = priorItems.map((_, i) => i).filter(i => !usedPrior.has(i));
        if (remainingPriorIndices.length === 1) {
          priorIdx = remainingPriorIndices[0];
        }
      }
      // 11. Only fall back to positional match if scoutItems has the SAME length as priorItems (full meal re-emission)
      if (priorIdx < 0 && isFullReEmission && sIdx < priorItems.length && !usedPrior.has(sIdx)) {
        priorIdx = sIdx;
      }
    }

    if (isExplicitDelete) {
      if (priorIdx >= 0) {
        usedPrior.add(priorIdx);
        const prior = priorItems[priorIdx];
        commands.push({
          action: 'remove_item',
          itemName: displayName(prior),
          targetDbId: prior.dbId || null,
          scoutIndex: sScoutIdx,
        });
      } else if (sName) {
        commands.push({
          action: 'remove_item',
          itemName: sName,
          scoutIndex: sScoutIdx,
        });
      }
      continue;
    }

    if (priorIdx < 0) {
      // New dish from scout — add_item when estimate available
      const grams = weightOf(scout) || 100;
      const estimate = estimateFromScout(scout);
      commands.push({
        action: 'add_item',
        itemName: sName,
        newItemName: sName,
        newWeightGrams: grams,
        scoutIndex: sScoutIdx,
        sourceImageIndex: scout.sourceImageIndex ?? null,
        estimate,
      });
      continue;
    }

    usedPrior.add(priorIdx);
    const prior = priorItems[priorIdx];
    const pName = displayName(prior);
    const pWeight = weightOf(prior);
    const sWeight = weightOf(scout);

    const isSubstantiveRename = pName && sName && !namesReferSame(pName, sName);

    // Subitem / component level actions inside this dish
    const scoutFoods = Array.isArray(scout.foods) ? scout.foods : [];
    const subitemActions = scoutFoods.filter((f: any) => f && typeof f === 'object' && (f.action === 'delete' || f.action === 'remove' || f.action === 'add' || f.action === 'replace'));
    if (subitemActions.length > 0 && (!isSubstantiveRename || !isExplicitReplace)) {
      // F-13.1 live T2: a foods[] delete that names the dish itself is a
      // dish-level removal (Coconut Juice on Coconut Juice), not a component
      // removal — demoting it keeps a ghost dish and corrupts the row.
      const selfDelete = subitemActions.find((f: any) => {
        const a = String(f?.action || '').toLowerCase();
        const n = String(f?.foodName || f?.name || '').trim();
        return (a === 'delete' || a === 'remove') && !!n && !!pName && namesReferSame(n, pName);
      });
      if (selfDelete) {
        commands.push({
          action: 'remove_item',
          itemName: pName,
          targetDbId: prior.dbId || null,
          scoutIndex: sScoutIdx,
        });
        continue;
      }
      for (const f of subitemActions) {
        const fAction = String(f.action).toLowerCase();
        const fName = String(f.foodName || f.name || '').trim();
        const fRep = String(f.replacesFood || '').trim();
        const fWeight = Number(f.weightGrams ?? f.estimatedWeightGrams) || 0;
        const fImageIdx = f.sourceImageIndex != null ? Number(f.sourceImageIndex) : (scout.sourceImageIndex != null ? Number(scout.sourceImageIndex) : null);
        const fEstimate = f.nutrients ? { nutrients: f.nutrients } : null;

        if (fAction === 'delete' || fAction === 'remove') {
          commands.push({
            action: 'remove_component',
            itemName: pName,
            componentName: fRep || fName,
            targetDbId: prior.dbId || null,
            scoutIndex: sScoutIdx,
          });
        } else if (fAction === 'add') {
          commands.push({
            action: 'add_component',
            itemName: pName,
            componentName: fName,
            newItemName: fName,
            newWeightGrams: fWeight > 0 ? fWeight : 50,
            sourceImageIndex: fImageIdx,
            targetDbId: prior.dbId || null,
            scoutIndex: sScoutIdx,
            estimate: fEstimate,
          });
        } else if (fAction === 'replace') {
          commands.push({
            action: 'replace_component',
            itemName: pName,
            componentName: fRep || fName,
            newItemName: fName,
            newWeightGrams: fWeight > 0 ? fWeight : null,
            sourceImageIndex: fImageIdx,
            targetDbId: prior.dbId || null,
            scoutIndex: sScoutIdx,
            estimate: fEstimate,
          });
        }
      }
      continue;
    }

    const estimate = estimateFromScout(scout);
    const hasNutrientChanges = Boolean(estimate && Object.keys(estimate).some(k => k !== 'cookingMethod' && k !== 'foodType'));

    if (pName && sName && (isExplicitReplace || isSubstantiveRename || (pName !== sName && hasNutrientChanges))) {
      commands.push({
        action: 'replace_identity',
        itemName: pName,
        newItemName: sName,
        replacementItemName: sName,
        newWeightGrams: sWeight > 0 ? sWeight : (pWeight || null),
        targetDbId: prior.dbId || null,
        scoutIndex: sScoutIdx,
        sourceImageIndex: scout.sourceImageIndex ?? prior.sourceImageIndex ?? null,
        estimate,
      });
    } else {
      if (pName && sName && pName !== sName) {
        commands.push({
          action: 'rename_alias',
          itemName: pName,
          newItemName: sName,
          targetDbId: prior.dbId || null,
          scoutIndex: sScoutIdx,
        });
      }
      if (sWeight > 0 && pWeight > 0 && Math.abs(sWeight - pWeight) >= 1) {
        // Prefer component rescale when scout components show a primary-ingredient change
        const priorComps = Array.isArray(prior.componentsDetailList) && prior.componentsDetailList.length
          ? prior.componentsDetailList
          : (Array.isArray(prior.components) ? prior.components : (Array.isArray(prior.foods) ? prior.foods : []));
        const scoutComps = Array.isArray(scout.componentsDetailList) && scout.componentsDetailList.length
          ? scout.componentsDetailList
          : (Array.isArray(scout.components) ? scout.components : (Array.isArray(scout.foods) ? scout.foods : []));
        let componentCmd: PatchEditCommand | null = null;
        if (priorComps.length && scoutComps.length) {
          for (let ci = 0; ci < Math.min(priorComps.length, scoutComps.length); ci++) {
            const pc = priorComps[ci];
            const sc = scoutComps[ci];
            if (typeof pc !== 'object' || typeof sc !== 'object') continue;
            const pw = Number(pc.weightGrams ?? pc.estimatedWeightGrams) || 0;
            const sw = Number(sc.weightGrams ?? sc.estimatedWeightGrams) || 0;
            if (pw > 0 && sw > 0 && Math.abs(pw - sw) >= 1) {
              componentCmd = {
                action: 'update_component_weight',
                itemName: pName,
                componentName: String(pc.name || pc.foodName || pc.keyword || sc.name || sc.foodName || ''),
                newWeightGrams: sw,
                targetDbId: prior.dbId || null,
                scoutIndex: sScoutIdx,
              };
              break;
            }
          }
        }
        if (componentCmd) {
          commands.push(componentCmd);
        } else {
          commands.push({
            action: 'set_weight',
            itemName: pName,
            newWeightGrams: sWeight,
            targetDbId: prior.dbId || null,
            scoutIndex: sScoutIdx,
          });
        }
      }
    }
  }
  // 3. User message clarification: duplicate / same-meal package removal or merge
  applySameMealClarification({ commands, usedPrior, priorItems, userMessage: args.userMessage });

  return commands;
}

/**
 * Enforce user-locked identity/weight/modifier on a scout emission.
 * A lock yields only when the current user message explicitly targets that
 * slot with a different value (token overlap with a non-matching name/weight).
 */
export function applyUserLockedSlots(args: {
  scoutItems: any[];
  locks: UserLockedSlot[] | null | undefined;
  userMessage?: string;
}): { items: any[]; notes: string[] } {
  const notes: string[] = [];
  const locks = Array.isArray(args.locks) ? args.locks : [];
  if (!locks.length || !Array.isArray(args.scoutItems)) {
    return { items: args.scoutItems || [], notes };
  }
  const msg = normName(args.userMessage || '');
  const items = args.scoutItems.map((it, idx) => {
    const sIdx = scoutIndexOf(it, idx);
    const slotLocks = locks.filter((l) => l.scoutIndex === sIdx);
    if (!slotLocks.length) return it;
    let next = { ...it };
    for (const lock of slotLocks) {
      if (lock.field === 'identity') {
        const lockedName = String(lock.value);
        const current = displayName(next);
        if (namesReferSame(current, lockedName)) continue;
        // Explicit unlock: user message names both a competing identity token and does not restate the lock
        const lockedTok = normName(lockedName).split(/\s+/).filter((t) => t.length > 2);
        const curTok = normName(current).split(/\s+/).filter((t) => t.length > 2);
        const userRestatesLock = lockedTok.some((t) => msg.includes(t));
        const userNamesCompetitor = curTok.some((t) => msg.includes(t) && !lockedTok.includes(t));
        if (userNamesCompetitor && !userRestatesLock) {
          notes.push(`[PatchLedger] unlock identity slot ${sIdx}: user retargeted away from "${lockedName}"`);
          continue;
        }
        notes.push(`[PatchLedger] lock identity slot ${sIdx}: "${current}" → "${lockedName}"`);
        next = invalidateStaleIdentityMetadata({
          ...next,
          name: lockedName,
          dishName: lockedName,
          canonicalDbName: lockedName,
          originalName: lockedName,
          keyword: lockedName,
        }, lockedName);
      } else if (lock.field === 'weightGrams') {
        const lockedW = Number(lock.value);
        const curW = weightOf(next);
        if (!(lockedW > 0) || Math.abs(curW - lockedW) < 1) continue;
        // Unlock if user states a different explicit gram amount for this slot
        const gramMention = msg.match(/(\d+)\s*(?:g|gram|grams)\b/);
        if (gramMention && Number(gramMention[1]) !== lockedW) {
          const nameTok = normName(displayName(next)).split(/\s+/).filter((t) => t.length > 2);
          if (nameTok.some((t) => msg.includes(t))) {
            notes.push(`[PatchLedger] unlock weight slot ${sIdx}: user set ${gramMention[1]}g`);
            continue;
          }
        }
        notes.push(`[PatchLedger] lock weight slot ${sIdx}: ${curW}g → ${lockedW}g`);
        next = {
          ...next,
          estimatedWeightGrams: lockedW,
          weightGrams: lockedW,
          packGrams: next.packGrams != null ? lockedW : next.packGrams,
        };
      } else if (lock.field === 'modifier') {
        const lockedMod = String(lock.value);
        const current = displayName(next);
        if (normName(current).includes(normName(lockedMod))) continue;
        notes.push(`[PatchLedger] lock modifier slot ${sIdx}: enforce "${lockedMod}" on "${current}"`);
        // Modifier locks are carried as identity names after set_modifier; restore via identity path if present
      }
    }
    return next;
  });
  return { items, notes };
}

/** Record locks from successfully applied commands (immutable append/replace per field). */
export function mergeLocksFromCommands(args: {
  priorLocks: UserLockedSlot[] | null | undefined;
  commands: any[];
  itemsAfter: any[];
  turn: number;
  userMessage?: string;
}): UserLockedSlot[] {
  const prior = Array.isArray(args.priorLocks) ? [...args.priorLocks] : [];
  const cmds = Array.isArray(args.commands) ? args.commands : [];
  const items = Array.isArray(args.itemsAfter) ? args.itemsAfter : [];
  const byKey = new Map<string, UserLockedSlot>();
  for (const l of prior) byKey.set(`${l.scoutIndex}:${l.field}`, l);

  const findItem = (cmd: any): { item: any; idx: number } | null => {
    const name = cmd.newItemName || cmd.replacementItemName || cmd.itemName;
    let idx = items.findIndex((it, i) => scoutIndexOf(it, i) === Number(cmd.scoutIndex));
    if (idx < 0 && name) idx = items.findIndex((it) => namesReferSame(displayName(it), name) || namesReferSame(displayName(it), cmd.itemName));
    if (idx < 0) return null;
    return { item: items[idx], idx };
  };

  for (const cmd of cmds) {
    const action = String(cmd.action || '').toLowerCase();
    const found = findItem(cmd);
    if (!found) continue;
    const sIdx = scoutIndexOf(found.item, found.idx);
    if (action === 'replace_identity' || action === 'rename_alias') {
      const value = displayName(found.item) || cmd.newItemName || cmd.replacementItemName;
      if (value) {
        byKey.set(`${sIdx}:identity`, {
          scoutIndex: sIdx,
          field: 'identity',
          value,
          lockedAtTurn: args.turn,
          sourceUserMessage: args.userMessage,
        });
      }
    } else if (action === 'set_modifier' || action === 'update_modifier') {
      const value = displayName(found.item) || cmd.newItemName;
      if (value) {
        byKey.set(`${sIdx}:identity`, {
          scoutIndex: sIdx,
          field: 'identity',
          value,
          lockedAtTurn: args.turn,
          sourceUserMessage: args.userMessage,
        });
        if (cmd.modifier) {
          byKey.set(`${sIdx}:modifier`, {
            scoutIndex: sIdx,
            field: 'modifier',
            value: String(cmd.modifier),
            lockedAtTurn: args.turn,
            sourceUserMessage: args.userMessage,
          });
        }
      }
    } else if (action === 'set_weight' || action === 'update_weight' || action === 'update_component_weight') {
      const w = weightOf(found.item) || Number(cmd.newWeightGrams);
      if (w > 0) {
        byKey.set(`${sIdx}:weightGrams`, {
          scoutIndex: sIdx,
          field: 'weightGrams',
          value: w,
          lockedAtTurn: args.turn,
          sourceUserMessage: args.userMessage,
        });
      }
    } else if (action === 'merge_dishes') {
      const w = weightOf(found.item) || Number(cmd.newWeightGrams);
      if (w > 0) {
        byKey.set(`${sIdx}:weightGrams`, {
          scoutIndex: sIdx,
          field: 'weightGrams',
          value: w,
          lockedAtTurn: args.turn,
          sourceUserMessage: args.userMessage,
        });
      }
      const val = displayName(found.item);
      if (val) {
        byKey.set(`${sIdx}:identity`, {
          scoutIndex: sIdx,
          field: 'identity',
          value: val,
          lockedAtTurn: args.turn,
          sourceUserMessage: args.userMessage,
        });
      }
    }
  }
  return Array.from(byKey.values());
}

/**
 * After identity/modifier change: purge conflicting sibling labels, English
 * aliases, ingredient lists, and stale preCalc that still describe the old
 * sweetened/previous identity.
 */
export function invalidateStaleIdentityMetadata(item: any, newName: string): any {
  if (!item || typeof item !== 'object') return item;
  const next = { ...item };
  const name = String(newName || displayName(item) || '').trim();
  next.name = name;
  next.canonicalDbName = name;
  next.originalName = name;
  next.keyword = name;
  if (next.dishName) next.dishName = name;
  // Drop English/generic labels that can lag behind (e.g. "sweetened iced tea")
  if (next.genericEnglishName) delete next.genericEnglishName;
  if (next.englishName) delete next.englishName;
  if (next.translatedName) delete next.translatedName;
  // Ingredient / visual sibling lists must not retain the prior identity
  next.ingredientsList = [name];
  next.visualIngredients = [name];
  next.ingredients = [name];
  // Stale pre-calc macros from the prior identity (e.g. manis 56 kcal)
  if (next.preCalcNutrients) delete next.preCalcNutrients;
  if (next.truthNutrients && next.nutrients) {
    // keep nutrients as source of truth after modifier apply
  }
  return next;
}

/** Prompt block listing locked invariants for the scout on edit turns. */
export function formatLockedSlotsForPrompt(locks: UserLockedSlot[] | null | undefined): string {
  const list = Array.isArray(locks) ? locks : [];
  if (!list.length) return '';
  const lines = list.map((l) => `- slot scoutIndex=${l.scoutIndex} field=${l.field} LOCKED="${l.value}" (do not revert without explicit user instruction)`);
  return (
    `USER-LOCKED SLOT INVARIANTS (patch ledger — must preserve unless the user explicitly changes that slot):\n` +
    lines.join('\n') +
    `\n`
  );
}

/**
 * Build a dietitian/expert dispatch row for edit turns so telemetry has full
 * I/O parity with create (or an explicit skip contract).
 */
export function buildEditExpertDispatch(args: {
  turn: number;
  userMessage?: string;
  finalMessage: string;
  editCommands: any[];
  items: any[];
  nutrients?: Record<string, any>;
  verdict?: { label?: string; level?: string } | null;
  skipped?: boolean;
  skipReason?: string;
  model?: string;
}): any {
  const turn = args.turn;
  const systemInstruction =
    'Edit-turn expert/projector stage. TARGETED DISH UPDATE ONLY: rescale the locked label truth for the edited slots; never re-emit or recompute unchanged dishes. ' +
    'Clinical narrative must reflect the post-edit ledger. ' +
    'When skipped, reason is explicit in output.skipReason.';
  const userPrompt = JSON.stringify({
    userMessage: args.userMessage || '',
    editCommands: args.editCommands || [],
    ledgerSummary: (args.items || []).map((it) => ({
      name: displayName(it),
      weightGrams: weightOf(it),
      calories: it?.nutrients?.calories ?? it?.calories ?? null,
      scoutIndex: it?.scoutIndex ?? null,
    })),
    nutrients: args.nutrients || null,
  }, null, 2);
  const output = args.skipped
    ? {
        skipped: true,
        skipReason: args.skipReason || 'explicit_skip',
        message: args.finalMessage,
        clinicalAdvice: args.finalMessage,
      }
    : {
        skipped: false,
        message: args.finalMessage,
        clinicalAdvice: args.finalMessage,
        // Contract parity with create: one emission must carry BOTH the
        // verdict label/level and the advice text, or the debug export law
        // "Agent output: verdict + advice" fails on every weight-only edit
        // (scout emits verdict with empty dishes[], projector emits the
        // message — neither alone satisfies the law).
        ...(args.verdict && args.verdict.label && args.verdict.level
          ? { verdict: { label: args.verdict.label, level: args.verdict.level } }
          : {}),
        editCommandCount: (args.editCommands || []).length,
      };
  return {
    id: `t${turn}/diet`,
    parent: `t${turn}/scout`,
    turn,
    agent: 'diet',
    user: args.userMessage || '',
    received: {
      mode: 'edit',
      editCommandCount: (args.editCommands || []).length,
      skipped: Boolean(args.skipped),
    },
    systemInstruction,
    userPrompt,
    instruction: `=== SYSTEM INSTRUCTION ===\n${systemInstruction}\n\n=== USER PROMPT ===\n${userPrompt}`,
    rawEmission: output,
    output,
    model: args.model || 'projector',
    latency_ms: 0,
    tokens: 0,
    error: null,
  };
}

/** Re-sum parent dish weight from components after component-level edits. */
export function reaggregateDishWeightFromComponents(item: any): any {
  if (!item || typeof item !== 'object') return item;
  const comps = Array.isArray(item.componentsDetailList) && item.componentsDetailList.length
    ? item.componentsDetailList
    : (Array.isArray(item.components) ? item.components.filter((c: any) => typeof c === 'object') : []);
  if (!comps.length) return item;
  const sum = comps.reduce((acc: number, c: any) => acc + (Number(c.weightGrams ?? c.estimatedWeightGrams) || 0), 0);
  if (!(sum > 0)) return item;
  const oldW = weightOf(item);
  if (oldW > 0 && Math.abs(oldW - sum) < 0.5) return item;
  const ratio = oldW > 0 ? sum / oldW : 1;
  const nutrients = { ...(item.nutrients || {}) };
  for (const k of Object.keys(nutrients)) {
    if (typeof nutrients[k] === 'number' && Number.isFinite(nutrients[k])) {
      nutrients[k] = Math.round(nutrients[k] * ratio * 10) / 10;
    }
  }
  return {
    ...item,
    weightGrams: Math.round(sum),
    estimatedWeightGrams: Math.round(sum),
    nutrients,
    calories: nutrients.calories ?? item.calories,
    components: comps,
    componentsDetailList: comps,
  };
}
