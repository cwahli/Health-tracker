import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { NUTRIENT_KEYS } from '../src/utils/nutrients';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASE = path.join(
  __dirname,
  '..',
  'golden',
  'meal',
  'Meal_04_log',
  '12_chat_saved_meal',
);

function loadExpected() {
  return JSON.parse(fs.readFileSync(path.join(CASE, 'expected.json'), 'utf8'));
}

const MACROS = ['weight', 'calories', 'protein', 'carbs', 'fat', 'satFat', 'fibre', 'sodium'] as const;
// expected.json mealTotals use Mode-A macro names; dish nutrients use ledger keys.

describe('golden meal 12 — chat-modal saved-meal journey (offline)', () => {
  it('case files are complete (bench parity)', () => {
    for (const f of [
      'Instruction.md',
      'expected.json',
      'correct_results.md',
      'benchmark_result.md',
      'MODEL.md',
      'setup/prior_coconut_log.json',
      'photos/12_cup_white_coffee.jpg',
      'debug_runs/debug-job_g12_turn0_coconut.md',
      'debug_runs/debug-job_g12_turn0_coconut.json',
      'debug_runs/debug-job_g12_turn1_meal.md',
      'debug_runs/debug-job_g12_turn1_meal.json',
      'debug_runs/debug-job_g12_turn2_edit.md',
      'debug_runs/debug-job_g12_turn2_edit.json',
    ]) {
      expect(fs.existsSync(path.join(CASE, f)), `missing ${f}`).toBe(true);
    }
    const photo = path.join(CASE, 'photos/12_cup_white_coffee.jpg');
    expect(fs.statSync(photo).size).toBeLessThanOrEqual(200 * 1024);
  });

  it('expected.json is FINAL with finite Mode-A totals', () => {
    const exp = loadExpected();
    expect(exp.slug).toBe('12_chat_saved_meal');
    expect(exp.status).toBe('FINAL');
    expect(exp.fullNutrientsAvailable).toBe(true);
    expect(exp.modelRequired).toBe('gemini-3.5-flash-lite');
    for (const k of MACROS) {
      expect(typeof exp.mealTotals[k]).toBe('number');
      expect(Number.isFinite(exp.mealTotals[k])).toBe(true);
    }
  });

  it('turn-2 FINAL ledger: identity, locks, 32-key nutrients, exact sums', () => {
    const exp = loadExpected();
    const dishes = exp.turns.turn2_edit.dishes;
    expect(dishes.map((d: any) => d.name)).toEqual([
      'White Coffee',
      'Big Mac',
      'Mr Oat Rolled Oats',
    ]);
    expect(dishes.some((d: any) => /coconut/i.test(d.name))).toBe(false);

    const mac = exp.turns.turn2_edit;
    expect(mac.mealKcal).toBe(681);
    expect(mac.mealWeightGrams).toBe(455);

    // Column sums equal meal totals exactly (the journey's core guarantee).
    const col = (k: string) => dishes.reduce((s: number, d: any) => s + (d.nutrients[k] ?? 0), 0);
    expect(col('calories')).toBeCloseTo(exp.mealTotals.calories, 5);
    expect(col('protein')).toBeCloseTo(exp.mealTotals.protein, 5);
    expect(col('carbohydrates')).toBeCloseTo(exp.mealTotals.carbs, 5);
    expect(col('totalFat')).toBeCloseTo(exp.mealTotals.fat, 5);
    expect(col('sodium')).toBeCloseTo(exp.mealTotals.sodium, 5);
    expect(dishes.reduce((s: number, d: any) => s + d.weightGrams, 0)).toBe(
      exp.mealTotals.weight,
    );

    // Every dish carries the full 32-key ledger.
    for (const d of dishes) {
      for (const k of NUTRIENT_KEYS) {
        expect(d.nutrients[k], `${d.name} missing ${k}`).not.toBeUndefined();
      }
    }

    // Big Mac label lock equals the seeded McDonald's UK truth.
    const burger = dishes.find((d: any) => d.name === 'Big Mac');
    expect(burger.brandLock).toBe(true);
    const truth = exp.lockedLabelTruth['Big Mac'].valuesAtBasis;
    for (const [k, v] of Object.entries(truth)) {
      if (!NUTRIENT_KEYS.includes(k)) continue; // e.g. salt rides outside the 32-key ledger
      expect(burger.nutrients[k]).toBe(v);
    }
    expect(burger.weightGrams).toBe(215);
  });

  it('turn-1 log: three dishes with the tray edit recorded', () => {
    const exp = loadExpected();
    const dishes = exp.turns.turn1_log.dishes;
    expect(dishes.map((d: any) => d.name)).toEqual([
      'White Coffee',
      'Big Mac',
      'Coconut Juice',
    ]);
    const burger = dishes.find((d: any) => d.name === 'Big Mac');
    expect(burger.macros.calories).toBe(508);
    const coconut = dishes.find((d: any) => d.name === 'Coconut Juice');
    expect(coconut.weightGrams).toBe(200); // in-tray edit 250 -> 200 recorded
    expect(exp.turns.turn1_log.mealKcal).toBe(597);
  });

  it('estimate bands contain the observed live values', () => {
    const exp = loadExpected();
    const coffee = exp.estimateBands['White Coffee @~200g'];
    expect(coffee.weightGrams[0]).toBeLessThanOrEqual(200);
    expect(coffee.weightGrams[1]).toBeGreaterThanOrEqual(240);
    expect(coffee.calories[0]).toBeLessThanOrEqual(43);
    expect(coffee.calories[1]).toBeGreaterThanOrEqual(47);
    const oats = exp.estimateBands['Mr Oat Rolled Oats @40g'];
    expect(oats.calories[0]).toBeLessThanOrEqual(130);
    expect(oats.calories[1]).toBeGreaterThanOrEqual(130);
  });

  it('correct_results.md is honestly marked with sources', () => {
    const md = fs.readFileSync(path.join(CASE, 'correct_results.md'), 'utf8');
    expect(md).toMatch(/\*\*FINAL[^*]*\*\*/);
    expect(md).toMatch(/## Sources/);
  });
});
