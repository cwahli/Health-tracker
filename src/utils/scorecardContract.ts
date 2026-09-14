/**
 * Live scorecard contract. One writer. Frozen inventories in
 * golden/scorecard/instruction/inventories/structure.json must match this payload.
 * Render serves GET /api/scorecard/contract from this module (bundled into dist).
 */
import { GIT_COMMIT_HASH, GIT_COMMIT_TIME } from '../git-version.generated';
import { ANALYTE_CONVERSIONS } from './analyteConversions';
import {
  LIMIT_NUTRIENT_KEYS,
  NUTRIENT_KEYS,
  PRIMARY_NUTRIENTS,
} from './nutrients';

function roundN(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function scorecardCommit(): { commit: string; commitSource: 'env' | 'generated'; time: string } {
  const envCommit = String(
    process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || process.env.GITHUB_SHA || '',
  ).trim();
  if (envCommit) {
    return { commit: envCommit.slice(0, 7), commitSource: 'env', time: new Date().toISOString() };
  }
  return { commit: GIT_COMMIT_HASH, commitSource: 'generated', time: GIT_COMMIT_TIME };
}

export function buildScorecardContract() {
  const ident = scorecardCommit();
  const hdlMul = ANALYTE_CONVERSIONS.hdl.multiply;
  const tgMul = ANALYTE_CONVERSIONS.triglycerides.multiply;
  const ldlMul = ANALYTE_CONVERSIONS.ldl.multiply;
  const creatMul = ANALYTE_CONVERSIONS.creatinine.multiply;
  const biliMul = ANALYTE_CONVERSIONS.total_bilirubin.multiply;
  return {
    pack: 'scorecard' as const,
    ...ident,
    inventories: {
      top_targets: {
        helper: 'getTopTargetNutrientKeys',
        polarity_helper: 'isLimitNutrient',
        fallback: PRIMARY_NUTRIENTS.filter((k) => k !== 'steps'),
        exclude: ['steps'],
        limit_keys: [...LIMIT_NUTRIENT_KEYS],
      },
      meal_ledger: {
        kcal_writer: 'finalizeDishLedger',
        nutrient_keys: [...NUTRIENT_KEYS],
      },
      biomarkers: {
        convert_via: 'ANALYTE_CONVERSIONS',
        multiply: {
          hdl: hdlMul,
          ldl: ldlMul,
          triglycerides: tgMul,
          creatinine: creatMul,
          total_bilirubin: biliMul,
        },
        locked_apply: {
          hdl: roundN(50 * hdlMul, 3),
          tg: roundN(125 * tgMul, 3),
          ldl: roundN(130 * ldlMul, 3),
          creat: roundN(0.9 * creatMul, 2),
          bili: roundN(0.8 * biliMul, 2),
        },
      },
    },
  };
}

export type ScorecardContract = ReturnType<typeof buildScorecardContract>;
