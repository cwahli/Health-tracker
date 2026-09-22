#!/usr/bin/env node
// meal-audit-compare.mjs — P4 comparison engine
// Scores a QA actual payload against a generated meal-audit bundle.
//
// Usage:
//   node scripts/meal-audit-compare.mjs --bundle=artifacts/meal_audits/Meal-X-01 \
//     --actual=qa-evidence/actual.json [--write] [--ledger] [--site-sha=abc1234]
//
// Exit codes: 0=PASS  1=FAIL  2=DIVERGED  3=usage/config error
//
// Tolerance matrix (plan §3 / payload contract §8):
//   OCR / dish name  exact (whitespace/punct normalized; aliases[] only for acronyms)
//   Core 10 nutrients + total weight  ≤10% per-key
//   Remaining 22 nutrients            ≤30% per-key
//   Bbox (only when photos exist)     IoU ≥ 0.5
//   Atwater energy balance            ≤10% (pre-diff invariant, always runs)
//   Turn structure                    exact ⇒ mismatch is DIVERGED
//
// Taxonomy: name_mismatch, portion_bias, core_nutrient_drift,
//   micro_nutrient_drift, bbox_drift, edit_not_applied, turn_mismatch, ocr_error

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { NUTRIENT_KEYS } from './generate-meal-result.mjs';

const CORE_NUTRIENT_KEYS = [
  'calories', 'solubleFibre', 'saturatedFat', 'protein', 'potassium',
  'transFat', 'addedSugar', 'carbohydrates', 'totalFibre', 'sodium',
];

const CORE_SET = new Set(CORE_NUTRIENT_KEYS);
const OTHER_NUTRIENT_KEYS = NUTRIENT_KEYS.filter(k => !CORE_SET.has(k));

const TOLERANCES = {
  corePct: 10.0,
  microPct: 30.0,
  weightPct: 10.0,
  atwaterPct: 10.0,
  iouMin: 0.5,
};

const TOLERANCE_TIER = 'standard_v1';

function parseArgs(argv) {
  const options = {
    bundle: null,
    actual: null,
    siteSha: null,
    scoutModel: null,
    write: false,
    ledger: false,
    help: false,
  };
  for (const arg of argv) {
    if (arg.startsWith('--bundle=')) options.bundle = arg.slice('--bundle='.length).trim();
    else if (arg.startsWith('--actual=')) options.actual = arg.slice('--actual='.length).trim();
    else if (arg.startsWith('--site-sha=')) options.siteSha = arg.slice('--site-sha='.length).trim();
    else if (arg.startsWith('--scout-model=')) options.scoutModel = arg.slice('--scout-model='.length).trim();
    else if (arg === '--write') options.write = true;
    else if (arg === '--ledger') options.ledger = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(3);
    }
  }
  return options;
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function resolveSiteSha(explicit) {
  if (explicit) return explicit;
  try {
    return execSync('git rev-parse --short HEAD', { cwd: process.cwd(), encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

function normalizeText(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeName(s) {
  return normalizeText(s);
}

function pctError(expected, actual) {
  const e = Number(expected);
  const a = Number(actual);
  if (!Number.isFinite(e) || !Number.isFinite(a)) return null;
  if (e === 0) return a === 0 ? 0 : 100;
  return round1((Math.abs(a - e) / Math.abs(e)) * 100);
}

function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}

function bboxIou(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== 4 || b.length !== 4) return 0;
  const [ay1, ax1, ay2, ax2] = a.map(Number);
  const [by1, bx1, by2, bx2] = b.map(Number);
  const iy1 = Math.max(ay1, by1);
  const ix1 = Math.max(ax1, bx1);
  const iy2 = Math.min(ay2, by2);
  const ix2 = Math.min(ax2, bx2);
  const iw = Math.max(0, ix2 - ix1);
  const ih = Math.max(0, iy2 - iy1);
  const inter = iw * ih;
  const areaA = Math.max(0, ax2 - ax1) * Math.max(0, ay2 - ay1);
  const areaB = Math.max(0, bx2 - bx1) * Math.max(0, by2 - by1);
  const union = areaA + areaB - inter;
  if (union <= 0) return 0;
  return inter / union;
}

function atwaterKcal(nutrients) {
  const p = Number(nutrients.protein) || 0;
  const c = Number(nutrients.carbohydrates) || 0;
  const f = Number(nutrients.totalFat) || 0;
  return Math.round(4 * p + 4 * c + 9 * f);
}

function passHasPhotos(pass) {
  const cum = pass.cumulativePhotos || [];
  const added = pass.addedPhotos || [];
  return cum.length > 0 || added.length > 0;
}

function finalPass(audit) {
  if (audit.passes && audit.passes.length > 0) return audit.passes[audit.passes.length - 1];
  return audit;
}

function mealTotalsOf(pass) {
  if (pass.mealTotals && typeof pass.mealTotals === 'object') {
    // meal_result shape uses nutrient keys; expected.json uses short aliases
    const t = pass.mealTotals;
    return {
      weight: t.weight ?? t.totalWeightGrams ?? null,
      calories: t.calories,
      protein: t.protein,
      carbohydrates: t.carbohydrates ?? t.carbs,
      totalFat: t.totalFat ?? t.fat,
      saturatedFat: t.saturatedFat ?? t.satFat,
      totalFibre: t.totalFibre ?? t.fibre,
      sodium: t.sodium,
      potassium: t.potassium,
      solubleFibre: t.solubleFibre,
      transFat: t.transFat,
      addedSugar: t.addedSugar,
      carbohydratesFull: t.carbohydrates ?? t.carbs,
    };
  }
  if (typeof pass.finalWeightGrams === 'number' && pass.finalTotals) {
    return { weight: pass.finalWeightGrams, ...pass.finalTotals };
  }
  return null;
}

function dishesOf(pass) {
  if (Array.isArray(pass.dishes)) return pass.dishes;
  if (Array.isArray(pass.expectedDishes)) return pass.expectedDishes;
  return [];
}

function dishNutrients(d) {
  return d.dishNutrients || d.nutrients || {};
}

function dishWeight(d) {
  const w = d.estimatedWeightGrams;
  return w === undefined || w === null ? null : Number(w);
}

function matchDishes(expectedList, actualList) {
  const used = new Set();
  const pairs = [];
  const unmatchedExpected = [];

  for (const exp of expectedList) {
    const expKey = normalizeName(exp.dishName || exp.name || '');
    let idx = actualList.findIndex((a, i) => !used.has(i) && normalizeName(a.dishName || a.name || '') === expKey && expKey !== '');
    if (idx === -1 && typeof exp.dishIndex === 'number') {
      idx = actualList.findIndex((a, i) => !used.has(i) && a.dishIndex === exp.dishIndex);
    }
    if (idx === -1) {
      idx = actualList.findIndex((a, i) => !used.has(i));
    }
    if (idx === -1) {
      unmatchedExpected.push(exp);
    } else {
      used.add(idx);
      pairs.push({ expected: exp, actual: actualList[idx] });
    }
  }

  const unmatchedActual = actualList.filter((_, i) => !used.has(i));
  return { pairs, unmatchedExpected, unmatchedActual };
}

function aliasesFor(dish) {
  const raw = dish.aliases;
  if (!Array.isArray(raw)) return [];
  return raw.map(a => normalizeName(a)).filter(Boolean);
}

function nameMatches(expected, actual) {
  const eName = normalizeName(expected.dishName || expected.name || '');
  const aName = normalizeName(actual.dishName || actual.name || '');
  if (eName === aName) return true;
  const eAliases = aliasesFor(expected);
  if (eAliases.includes(aName)) return true;
  const aAliases = aliasesFor(actual);
  if (aAliases.includes(eName)) return true;
  return false;
}

function ocrLabelOf(dish) {
  if (dish.ocrText != null) return String(dish.ocrText).trim();
  if (dish.ocrLabel != null) return String(dish.ocrLabel).trim();
  if (dish.labelText != null) return String(dish.labelText).trim();
  if (dish.label != null && typeof dish.label === 'string') return dish.label.trim();
  return null;
}

function compareNutrientMap(expMap, actMap, context, failures) {
  for (const key of NUTRIENT_KEYS) {
    const hasE = expMap[key] !== undefined && expMap[key] !== null;
    const hasA = actMap[key] !== undefined && actMap[key] !== null;
    if (!hasE && !hasA) continue;
    if (!hasE || !hasA) {
      const isCore = CORE_SET.has(key);
      failures.push({
        taxonomy: isCore ? 'core_nutrient_drift' : 'micro_nutrient_drift',
        key,
        expected: hasE ? expMap[key] : null,
        actual: hasA ? actMap[key] : null,
        deltaPct: null,
        tolerance: isCore ? TOLERANCES.corePct : TOLERANCES.microPct,
        ...context,
      });
      continue;
    }
    const e = Number(expMap[key]);
    const a = Number(actMap[key]);
    if (!Number.isFinite(e) || !Number.isFinite(a)) continue;
    const deltaPct = pctError(e, a);
    const isCore = CORE_SET.has(key);
    const limit = isCore ? TOLERANCES.corePct : TOLERANCES.microPct;
    if (deltaPct === null || deltaPct > limit) {
      failures.push({
        taxonomy: isCore ? 'core_nutrient_drift' : 'micro_nutrient_drift',
        key,
        expected: e,
        actual: a,
        deltaPct,
        tolerance: limit,
        ...context,
      });
    }
  }
}

function comparePayloads(expectedAudit, actualAudit) {
  const failures = [];
  let photosExist = false;

  const expPasses = Array.isArray(expectedAudit.passes) ? expectedAudit.passes : [expectedAudit];
  const actPasses = Array.isArray(actualAudit.passes) ? actualAudit.passes : [actualAudit];

  // --- Turn structure (exact) — mismatch ⇒ DIVERGED via turn_mismatch ---
  // turnId labels may differ by suffix (turn_2_photo_clarify vs turn_2_edit);
  // structural identity is the turn number (MAI-20260922-001).
  const turnKey = (raw, idx) => {
    const id = String(raw == null ? '' : raw);
    const m = id.match(/turn[_-]?(\d+)/i);
    if (m) return `turn_${Number(m[1])}`;
    if (id.toLowerCase() === 'single-turn') return 'turn_1';
    return `turn_${idx + 1}`;
  };
  if (expPasses.length !== actPasses.length) {
    failures.push({
      taxonomy: 'turn_mismatch',
      key: 'turnCount',
      expected: expPasses.length,
      actual: actPasses.length,
      deltaPct: null,
      tolerance: 0,
      turn: null,
      dish: null,
    });
  } else {
    for (let i = 0; i < expPasses.length; i++) {
      const ep = expPasses[i];
      const ap = actPasses[i];
      const eId = ep.turnId || ep.id || `turn_${i + 1}`;
      const aId = ap.turnId || ap.id || `turn_${i + 1}`;
      if (turnKey(eId, i) !== turnKey(aId, i)) {
        failures.push({
          taxonomy: 'turn_mismatch',
          key: 'turnId',
          expected: eId,
          actual: aId,
          deltaPct: null,
          tolerance: 0,
          turn: eId,
          dish: null,
        });
      }
      const eDishes = dishesOf(ep);
      const aDishes = dishesOf(ap);
      if (eDishes.length !== aDishes.length) {
        failures.push({
          taxonomy: 'turn_mismatch',
          key: 'dishCount',
          expected: eDishes.length,
          actual: aDishes.length,
          deltaPct: null,
          tolerance: 0,
          turn: eId,
          dish: null,
        });
      }
      const ePhotos = (ep.cumulativePhotos || ep.addedPhotos || ep.photos || []).length;
      const aPhotos = (ap.cumulativePhotos || ap.addedPhotos || ap.photos || []).length;
      // photo attribution: compare addedPhotos length when both sides carry it
      if (Array.isArray(ep.addedPhotos) && Array.isArray(ap.addedPhotos) &&
          ep.addedPhotos.length !== ap.addedPhotos.length) {
        failures.push({
          taxonomy: 'turn_mismatch',
          key: 'photoCount',
          expected: ep.addedPhotos.length,
          actual: ap.addedPhotos.length,
          deltaPct: null,
          tolerance: 0,
          turn: eId,
          dish: null,
        });
      } else if (Array.isArray(ep.photos) && Array.isArray(ap.photos) &&
                 ep.photos.length !== ap.photos.length && ePhotos === aPhotos) {
        // expected.json photo lists without addedPhotos on actual
        failures.push({
          taxonomy: 'turn_mismatch',
          key: 'photoCount',
          expected: ep.photos.length,
          actual: ap.photos.length,
          deltaPct: null,
          tolerance: 0,
          turn: eId,
          dish: null,
        });
      }
    }
  }

  const expFinal = finalPass(expectedAudit);
  const actFinal = finalPass(actualAudit);
  photosExist = passHasPhotos(expFinal) || passHasPhotos(actFinal) ||
    (Array.isArray(expectedAudit.photos) && expectedAudit.photos.length > 0) ||
    (Array.isArray(actualAudit.photos) && actualAudit.photos.length > 0);

  // --- Meal title (name_mismatch) ---
  const eTitle = normalizeName(expectedAudit.title || expectedAudit.mealName || '');
  const aTitle = normalizeName(actualAudit.title || actualAudit.mealName || '');
  if (eTitle && aTitle && eTitle !== aTitle) {
    const eAliases = (expectedAudit.aliases || []).map(normalizeName);
    if (!eAliases.includes(aTitle)) {
      failures.push({
        taxonomy: 'name_mismatch',
        key: 'title',
        expected: expectedAudit.title,
        actual: actualAudit.title,
        deltaPct: null,
        tolerance: 'exact',
        turn: null,
        dish: null,
      });
    }
  }

  // --- Final-pass meal totals: weight + core/micro nutrients + Atwater ---
  const eTotals = mealTotalsOf(expFinal);
  const aTotals = mealTotalsOf(actFinal);
  if (eTotals && aTotals) {
    if (eTotals.weight != null && aTotals.weight != null) {
      const deltaPct = pctError(eTotals.weight, aTotals.weight);
      if (deltaPct === null || deltaPct > TOLERANCES.weightPct) {
        failures.push({
          taxonomy: 'portion_bias',
          key: 'totalWeightGrams',
          expected: eTotals.weight,
          actual: aTotals.weight,
          deltaPct,
          tolerance: TOLERANCES.weightPct,
          turn: expFinal.turnId || expFinal.id || null,
          dish: null,
        });
      }
    }
    compareNutrientMap(
      pickNutrients(eTotals),
      pickNutrients(aTotals),
      { turn: expFinal.turnId || expFinal.id || null, dish: null, level: 'meal' },
      failures
    );

    // Atwater pre-diff invariant on actual meal totals (always runs)
    const declared = Number(aTotals.calories);
    if (Number.isFinite(declared)) {
      const at = atwaterKcal(aTotals);
      const delta = declared > 0 ? round1((Math.abs(declared - at) / declared) * 100) : (at > 0 ? 100 : 0);
      if (delta > TOLERANCES.atwaterPct) {
        failures.push({
          taxonomy: 'core_nutrient_drift',
          key: 'atwater_balance',
          expected: `${TOLERANCES.atwaterPct}% max`,
          actual: `${delta}%`,
          deltaPct: delta,
          tolerance: TOLERANCES.atwaterPct,
          turn: expFinal.turnId || expFinal.id || null,
          dish: null,
          level: 'atwater',
        });
      }
    }
  }

  // --- Per-dish comparisons on final pass (and every pass when both have dishes) ---
  const passesToScan = [];
  const n = Math.min(expPasses.length, actPasses.length);
  for (let i = 0; i < n; i++) {
    passesToScan.push({ expected: expPasses[i], actual: actPasses[i], index: i });
  }

  for (const { expected: ep, actual: ap, index } of passesToScan) {
    const turnId = ep.turnId || ep.id || `turn_${index + 1}`;
    const eDishes = dishesOf(ep);
    const aDishes = dishesOf(ap);
    if (eDishes.length === 0 && aDishes.length === 0) continue;

    const { pairs, unmatchedExpected, unmatchedActual } = matchDishes(eDishes, aDishes);

    for (const exp of unmatchedExpected) {
      failures.push({
        taxonomy: 'name_mismatch',
        key: 'dishName',
        expected: exp.dishName || exp.name || null,
        actual: null,
        deltaPct: null,
        tolerance: 'exact',
        turn: turnId,
        dish: exp.dishName || exp.name || null,
      });
    }
    for (const act of unmatchedActual) {
      failures.push({
        taxonomy: 'name_mismatch',
        key: 'dishName',
        expected: null,
        actual: act.dishName || act.name || null,
        deltaPct: null,
        tolerance: 'exact',
        turn: turnId,
        dish: act.dishName || act.name || null,
      });
    }

    for (const { expected: ed, actual: ad } of pairs) {
      const dishLabel = ed.dishName || ed.name || ad.dishName || ad.name || null;

      if (!nameMatches(ed, ad)) {
        failures.push({
          taxonomy: 'name_mismatch',
          key: 'dishName',
          expected: ed.dishName || ed.name || null,
          actual: ad.dishName || ad.name || null,
          deltaPct: null,
          tolerance: 'exact',
          turn: turnId,
          dish: dishLabel,
        });
      }

      // OCR / label text exact (whitespace-trimmed)
      const eOcr = ocrLabelOf(ed);
      const aOcr = ocrLabelOf(ad);
      if (eOcr != null && aOcr != null && eOcr.trim() !== aOcr.trim()) {
        failures.push({
          taxonomy: 'ocr_error',
          key: 'ocrLabel',
          expected: eOcr.trim(),
          actual: aOcr.trim(),
          deltaPct: null,
          tolerance: 'exact',
          turn: turnId,
          dish: dishLabel,
        });
      }

      // Weight (portion_bias)
      const ew = dishWeight(ed);
      const aw = dishWeight(ad);
      if (ew != null && aw != null) {
        const deltaPct = pctError(ew, aw);
        if (deltaPct === null || deltaPct > TOLERANCES.weightPct) {
          failures.push({
            taxonomy: 'portion_bias',
            key: 'estimatedWeightGrams',
            expected: ew,
            actual: aw,
            deltaPct,
            tolerance: TOLERANCES.weightPct,
            turn: turnId,
            dish: dishLabel,
          });
        }
      }

      // Nutrients
      compareNutrientMap(
        dishNutrients(ed),
        dishNutrients(ad),
        { turn: turnId, dish: dishLabel, level: 'dish' },
        failures
      );

      // Bbox IoU only when photos exist on this pass (or either side claims photos)
      const epHas = passHasPhotos(ep) || photosExist;
      const apHas = passHasPhotos(ap) || photosExist;
      const eBox = Array.isArray(ed.boundingBox2D) ? ed.boundingBox2D : null;
      const aBox = Array.isArray(ad.boundingBox2D) ? ad.boundingBox2D : null;
      if ((epHas || apHas) && eBox && aBox) {
        const sameBox = eBox.length === aBox.length && eBox.every((v, i) => Number(v) === Number(aBox[i]));
        const iou = sameBox ? 1 : bboxIou(eBox, aBox);
        if (iou < TOLERANCES.iouMin) {
          failures.push({
            taxonomy: 'bbox_drift',
            key: 'boundingBox2D',
            expected: eBox,
            actual: aBox,
            deltaPct: round1((1 - iou) * 100),
            iou: round1(iou * 1000) / 1000,
            tolerance: TOLERANCES.iouMin,
            turn: turnId,
            dish: dishLabel,
          });
        }
      } else if (epHas && eBox && !aBox) {
        failures.push({
          taxonomy: 'bbox_drift',
          key: 'boundingBox2D',
          expected: eBox,
          actual: null,
          deltaPct: null,
          iou: 0,
          tolerance: TOLERANCES.iouMin,
          turn: turnId,
          dish: dishLabel,
        });
      }
    }
  }

  // --- edit_not_applied: expected final pass differs from expected first pass
  // but actual final deep-equals actual first (multi-turn only) ---
  if (expPasses.length > 1 && actPasses.length > 1) {
    const e0 = dishesOf(expPasses[0]);
    const eN = dishesOf(expPasses[expPasses.length - 1]);
    const a0 = dishesOf(actPasses[0]);
    const aN = dishesOf(actPasses[actPasses.length - 1]);
    const expectedChanged = normalizeName(signatureOfDishes(e0)) !== normalizeName(signatureOfDishes(eN));
    const actualUnchanged = signatureOfDishes(a0) === signatureOfDishes(aN);
    if (expectedChanged && actualUnchanged) {
      failures.push({
        taxonomy: 'edit_not_applied',
        key: 'finalPassDishes',
        expected: signatureOfDishes(eN),
        actual: signatureOfDishes(aN),
        deltaPct: null,
        tolerance: 'exact',
        turn: expPasses[expPasses.length - 1].turnId || expPasses[expPasses.length - 1].id || null,
        dish: null,
      });
    }
  }

  return failures;
}

function pickNutrients(totals) {
  const out = {};
  for (const key of NUTRIENT_KEYS) {
    if (totals[key] !== undefined && totals[key] !== null) out[key] = totals[key];
  }
  // short aliases from expected.json mealTotals
  const alias = {
    carbohydrates: 'carbs',
    totalFat: 'fat',
    saturatedFat: 'satFat',
    totalFibre: 'fibre',
  };
  for (const [full, short] of Object.entries(alias)) {
    if (out[full] === undefined && totals[short] !== undefined && totals[short] !== null) {
      out[full] = totals[short];
    }
  }
  return out;
}

function signatureOfDishes(dishes) {
  if (!Array.isArray(dishes)) return '';
  return dishes
    .map(d => normalizeName(d.dishName || d.name || ''))
    .sort()
    .join('|');
}

function verdictFromFailures(failures) {
  if (failures.some(f => f.taxonomy === 'turn_mismatch')) return 'DIVERGED';
  if (failures.length > 0) return 'FAIL';
  return 'PASS';
}

function primaryCode(failures) {
  if (failures.length === 0) return null;
  // DIVERGED wins; else first failure taxonomy (stable order already)
  const order = [
    'turn_mismatch',
    'edit_not_applied',
    'name_mismatch',
    'ocr_error',
    'core_nutrient_drift',
    'portion_bias',
    'bbox_drift',
    'micro_nutrient_drift',
  ];
  const sorted = [...failures].sort((a, b) => order.indexOf(a.taxonomy) - order.indexOf(b.taxonomy));
  return sorted[0].taxonomy;
}

function loadExpectedSide(bundleDir) {
  const mr = path.join(bundleDir, 'meal_result.json');
  if (fs.existsSync(mr)) return { audit: readJson(mr), source: 'meal_result.json' };
  const ex = path.join(bundleDir, 'expected.json');
  if (fs.existsSync(ex)) return { audit: readJson(ex), source: 'expected.json' };
  throw new Error(`Bundle missing meal_result.json and expected.json under ${bundleDir}`);
}

function normalizeExpectedAudit(raw) {
  // expected.json uses expectedItems[] at top level for dishes in some exports;
  // meal_result.json already has passes[].dishes. If only expectedItems, wrap as single pass.
  if (Array.isArray(raw.passes) && raw.passes.length > 0) {
    return raw;
  }
  if (Array.isArray(raw.expectedItems)) {
    return {
      title: raw.title,
      passes: [{
        turnIndex: 1,
        turnId: 'turn_1_initial',
        dishes: raw.expectedItems,
        addedPhotos: raw.photos || [],
        cumulativePhotos: raw.photos || [],
      }],
    };
  }
  return raw;
}

function normalizeActualAudit(raw) {
  if (Array.isArray(raw.passes) && raw.passes.length > 0) return raw;
  if (Array.isArray(raw.dishes)) {
    return {
      title: raw.title,
      passes: [{
        turnIndex: 1,
        turnId: 'turn_1_initial',
        dishes: raw.dishes,
        addedPhotos: raw.photos || [],
        cumulativePhotos: raw.photos || [],
        mealTotals: raw.mealTotals,
      }],
    };
  }
  if (Array.isArray(raw.expectedItems)) {
    return {
      title: raw.title,
      passes: [{
        turnIndex: 1,
        turnId: 'turn_1_initial',
        dishes: raw.expectedItems,
        addedPhotos: raw.photos || [],
        cumulativePhotos: raw.photos || [],
      }],
    };
  }
  return raw;
}

function appendLedger(bundleName, failures) {
  const ledgerPath = path.join(process.cwd(), 'artifacts', 'meal_audits', 'issue_ledger.jsonl');
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  let seq = 1;
  if (fs.existsSync(ledgerPath)) {
    const lines = fs.readFileSync(ledgerPath, 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const row = JSON.parse(line);
        if (String(row.id || '').startsWith(`MAI-${day}-`)) {
          const n = parseInt(String(row.id).split('-').pop(), 10);
          if (Number.isFinite(n) && n >= seq) seq = n + 1;
        }
      } catch { /* skip bad lines */ }
    }
  }
  const appended = [];
  for (const f of failures) {
    const id = `MAI-${day}-${String(seq).padStart(3, '0')}`;
    seq += 1;
    const row = {
      id,
      bundle: bundleName,
      turn: f.turn ?? null,
      taxonomy: f.taxonomy,
      key: f.key,
      expected: f.expected,
      actual: f.actual,
      deltaPct: f.deltaPct,
      status: 'open',
      bugId: null,
      createdAt: new Date().toISOString(),
      resolvedAt: null,
    };
    fs.appendFileSync(ledgerPath, JSON.stringify(row) + '\n', 'utf-8');
    appended.push(id);
  }
  return { ledgerPath, appended };
}

function printReport(result) {
  const { harness, verdict, failures, primary } = result;
  console.log('');
  console.log('=== Meal-Audit Comparison ===');
  console.log(`Bundle:     ${harness.bundleName}`);
  console.log(`Site SHA:   ${harness.siteSha}`);
  console.log(`Scout:      ${harness.scoutModel}`);
  console.log(`Generated:  ${JSON.stringify(harness.generatedBy)}`);
  console.log(`Tier:       ${harness.toleranceTier}`);
  console.log(`Compared:   ${harness.comparedAt}`);
  console.log(`Verdict:    ${verdict}${primary ? ` (${primary})` : ''}`);
  if (failures.length === 0) {
    console.log('No tolerance violations.');
  } else {
    console.log(`Failures:   ${failures.length}`);
    for (const f of failures.slice(0, 50)) {
      const loc = [f.turn, f.dish].filter(Boolean).join(' / ');
      console.log(
        `  - [${f.taxonomy}] ${f.key}` +
        (loc ? ` @ ${loc}` : '') +
        `: expected=${JSON.stringify(f.expected)} actual=${JSON.stringify(f.actual)}` +
        (f.deltaPct != null ? ` Δ${f.deltaPct}%` : '') +
        (f.iou != null ? ` IoU=${f.iou}` : '')
      );
    }
    if (failures.length > 50) console.log(`  … ${failures.length - 50} more`);
  }
  console.log('');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.bundle || !options.actual) {
    console.log(`Usage:
  node scripts/meal-audit-compare.mjs --bundle=artifacts/meal_audits/Meal-X-01 \\
    --actual=qa-evidence/actual.json [--write] [--ledger] [--site-sha=abc] [--scout-model=id]

Exit: 0=PASS  1=FAIL  2=DIVERGED  3=usage`);
    process.exit(options.help ? 0 : 3);
  }

  const bundleDir = options.bundle;
  if (!fs.existsSync(bundleDir)) {
    console.error(`Bundle directory not found: ${bundleDir}`);
    process.exit(3);
  }

  let expectedRaw;
  let expectedSource;
  try {
    const loaded = loadExpectedSide(bundleDir);
    expectedRaw = loaded.audit;
    expectedSource = loaded.source;
  } catch (e) {
    console.error(e.message);
    process.exit(3);
  }

  let actualRaw;
  try {
    actualRaw = readJson(options.actual);
  } catch (e) {
    console.error(e.message);
    process.exit(3);
  }

  const expectedAudit = normalizeExpectedAudit(expectedRaw);
  const actualAudit = normalizeActualAudit(actualRaw);

  let failures;
  try {
    failures = comparePayloads(expectedAudit, actualAudit);
  } catch (e) {
    console.error(`Comparison error: ${e.message}`);
    process.exit(3);
  }

  const verdict = verdictFromFailures(failures);
  const primary = primaryCode(failures);
  const bundleName = path.basename(path.resolve(bundleDir));

  const harness = {
    bundleName,
    siteSha: resolveSiteSha(options.siteSha),
    scoutModel: options.scoutModel ||
      (actualRaw.generatedBy && actualRaw.generatedBy.model) ||
      (expectedRaw.generatedBy && expectedRaw.generatedBy.model) ||
      'unknown',
    toleranceTier: TOLERANCE_TIER,
    generatedBy: expectedRaw.generatedBy || actualRaw.generatedBy || null,
    comparedAt: new Date().toISOString(),
    expectedSource,
    tolerances: { ...TOLERANCES, coreKeys: CORE_NUTRIENT_KEYS, nutrientKeys: NUTRIENT_KEYS },
  };

  const result = {
    harness,
    verdict,
    primaryCode: primary,
    failureCount: failures.length,
    failures,
  };

  if (options.write) {
    const outPath = path.join(bundleDir, 'comparison.json');
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf-8');
    console.log(`Wrote ${outPath}`);
  }

  let ledgerInfo = null;
  if (options.ledger && failures.length > 0) {
    ledgerInfo = appendLedger(bundleName, failures);
    console.log(`Ledger: +${ledgerInfo.appended.length} → ${ledgerInfo.ledgerPath}`);
  }

  printReport(result);

  if (verdict === 'PASS') process.exit(0);
  if (verdict === 'DIVERGED') process.exit(2);
  process.exit(1);
}

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
  try {
    main();
  } catch (err) {
    console.error('[MealAuditCompare] Fatal error:', err);
    process.exit(3);
  }
}

export { comparePayloads, verdictFromFailures, bboxIou, pctError, TOLERANCES, CORE_NUTRIENT_KEYS };
