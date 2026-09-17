import { getTopTargetNutrientKeys, isLimitNutrient, PRIMARY_NUTRIENTS, NUTRIENT_KEYS } from './nutrients.js';
import { ANALYTE_CONVERSIONS } from './analyteConversions.js';
import { GIT_COMMIT_HASH } from '../git-version.generated.js';

export interface ScorecardContract {
  pack: 'scorecard';
  commit: string;
  commitSource: string;
  inventories: {
    top_targets: {
      helper: string;
      polarity_helper: string;
      fallback: string[];
      exclude: string[];
      limit_keys: string[];
    };
    meal_ledger: {
      kcal_writer: string;
      nutrient_keys: string[];
      nutrient_key_count: number;
    };
    biomarkers: {
      convert_via: string;
      multiply: {
        hdl: number;
        ldl: number;
        triglycerides: number;
        creatinine: number;
        total_bilirubin: number;
      };
      locked_apply: {
        hdl: number;
        tg: number;
        ldl: number;
        creat: number;
        bili: number;
      };
    };
  };
}

export function buildScorecardContract(): ScorecardContract {
  return {
    pack: 'scorecard',
    commit: GIT_COMMIT_HASH || 'unknown',
    commitSource: 'git-version.generated',
    inventories: {
      top_targets: {
        helper: 'getTopTargetNutrientKeys',
        polarity_helper: 'isLimitNutrient',
        fallback: [...PRIMARY_NUTRIENTS],
        exclude: ['steps'],
        limit_keys: [
          'calories',
          'totalFat',
          'saturatedFat',
          'transFat',
          'cholesterol',
          'sodium',
          'salt',
          'sugar',
          'addedSugar',
          'carbohydrates',
        ],
      },
      meal_ledger: {
        kcal_writer: 'finalizeDishLedger',
        nutrient_keys: [...NUTRIENT_KEYS],
        nutrient_key_count: NUTRIENT_KEYS.length,
      },
      biomarkers: {
        convert_via: 'ANALYTE_CONVERSIONS',
        multiply: {
          hdl: ANALYTE_CONVERSIONS.hdl.multiply,
          ldl: ANALYTE_CONVERSIONS.ldl.multiply,
          triglycerides: ANALYTE_CONVERSIONS.triglycerides.multiply,
          creatinine: ANALYTE_CONVERSIONS.creatinine.multiply,
          total_bilirubin: ANALYTE_CONVERSIONS.total_bilirubin.multiply,
        },
        locked_apply: {
          hdl: 1.293,
          tg: 1.411,
          ldl: 3.362,
          creat: 79.56,
          bili: 13.68,
        },
      },
    },
  };
}
