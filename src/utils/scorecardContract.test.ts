import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ANALYTE_CONVERSIONS } from './analyteConversions';
import {
  LIMIT_NUTRIENT_KEYS,
  NUTRIENT_KEYS,
  PRIMARY_NUTRIENTS,
  getTopTargetNutrientKeys,
} from './nutrients';
import { buildScorecardContract } from './scorecardContract';

const structure = JSON.parse(
  readFileSync(
    path.resolve(process.cwd(), 'golden/scorecard/instruction/inventories/structure.json'),
    'utf8',
  ),
);

describe('scorecard live contract (cannot swap inventories)', () => {
  it('echoes frozen Top Targets fallback and polarity lists', () => {
    const c = buildScorecardContract();
    const exp = structure.expected.top_targets;
    expect(c.inventories.top_targets.helper).toBe(exp.helper);
    expect(c.inventories.top_targets.polarity_helper).toBe(exp.polarity_helper);
    expect(c.inventories.top_targets.fallback).toEqual(exp.fallback);
    expect(c.inventories.top_targets.exclude).toEqual(exp.exclude);
    expect(c.inventories.top_targets.limit_keys).toEqual(exp.limit_keys);
    expect(PRIMARY_NUTRIENTS.filter((k) => k !== 'steps')).toEqual(exp.fallback);
    expect([...LIMIT_NUTRIENT_KEYS]).toEqual(exp.limit_keys);
  });

  it('keeps the 32-key meal ledger and kcal writer name', () => {
    const c = buildScorecardContract();
    expect(c.inventories.meal_ledger.kcal_writer).toBe('finalizeDishLedger');
    expect(c.inventories.meal_ledger.nutrient_keys).toEqual([...NUTRIENT_KEYS]);
    expect(c.inventories.meal_ledger.nutrient_keys).toHaveLength(
      structure.expected.meal_ledger.nutrient_key_count,
    );
  });

  it('locks B0 convert multipliers and apply outputs', () => {
    const c = buildScorecardContract();
    const exp = structure.expected.biomarkers;
    expect(c.inventories.biomarkers.multiply).toEqual(exp.multiply);
    expect(c.inventories.biomarkers.locked_apply).toEqual(exp.locked_apply);
    expect(ANALYTE_CONVERSIONS.hdl.multiply).toBe(0.02586);
    expect(getTopTargetNutrientKeys({}, {})).toEqual(['calories', 'saturatedFat', 'sodium']);
  });
});
