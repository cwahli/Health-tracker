import { MealBuild, StageAuditRecord } from './src/mealBuild/types';
import { consolidateMeal, appendHistory, migrateMealSchema } from './src/mealBuild/consolidate';
import { fromPendingFoodLog, toPendingFoodLog } from './src/mealBuild/adapters';

export function appendStage(meal: MealBuild, stage: string, status: 'success'|'error'|'degraded', message?: string): MealBuild {
  return consolidateMeal(meal, {}, stage, { stageKey: `${meal.id}_${stage}_1`, attempt: 1 });
}

export function markDietDegraded(meal: MealBuild, errorMsg?: string): MealBuild {
  let m = consolidateMeal(meal, { 
    savable: true, 
    lastCompletedStage: 'calculation', 
    degradedStages: ['diet'] 
  }, 'diet');
  
  const record: StageAuditRecord = {
    stageKey: `${m.id}_diet_1`,
    stage: 'diet',
    attempt: 1,
    timestamp: new Date().toISOString(),
    status: 'degraded',
    recovery: 'retry_advice',
    message: errorMsg
  };
  
  const ledger = m.stageLedger ? [...m.stageLedger] : [];
  const idx = ledger.findIndex(r => r.stageKey === record.stageKey);
  if (idx >= 0) {
    ledger[idx] = record;
  } else {
    ledger.push(record);
  }
  m.stageLedger = ledger;

  m = appendHistory(m, {
    type: 'error',
    timestamp: new Date().toISOString(),
    stage: 'diet',
    message: errorMsg || 'Diet degraded',
  } as any);

  return m;
}

/** Success path: build MealBuild from finalized parsedData after calc/aggregate. */
export function attachHappyPathMealBuild(opts: {
  parsedData: any;
  jobId?: string;
  activeMeal?: any;
  scoutItems?: any[];
  diningEnvironment?: string;
  degradedStages?: string[];
}): { mealBuild: MealBuild; pendingFoodLog: any } {
  const { parsedData, jobId, activeMeal, scoutItems, diningEnvironment, degradedStages } = opts;
  const baseLog = activeMeal || parsedData;
  const base = migrateMealSchema(
    activeMeal?.mealBuild ||
      fromPendingFoodLog(baseLog, {
        id: jobId || parsedData?.id || `meal_${Date.now()}`,
        mode: activeMeal ? (activeMeal.mode || 'edit') : 'new_log',
      })
  );
  let meal = consolidateMeal(
    base,
    {
      ...fromPendingFoodLog(parsedData, { id: base.id, mode: base.mode || 'new_log' }),
      savable: true,
      lastCompletedStage: degradedStages?.length ? 'calculation' : 'diet',
      degradedStages: degradedStages || [],
      diningEnvironment: diningEnvironment || base.diningEnvironment,
      scoutSnapshot: scoutItems || base.scoutSnapshot,
      staleDietNarrative: false,
    },
    'calculation',
    { actor: 'job_stage_calculation', stageKey: `${base.id}|calculation|1`, attempt: 1 }
  );
  meal = appendHistory(meal, {
    type: 'stage_complete',
    timestamp: new Date().toISOString(),
    stage: 'calculation',
    message: 'Happy-path meal attached (savable)',
  } as any);

  return { mealBuild: meal, pendingFoodLog: toPendingFoodLog(meal) };
}

export function buildSavableMealFromParsed(preCalcItems: any[], activeMeal: any, aggregatedNutrients: any, rawFoodData: any): MealBuild {
  let base = migrateMealSchema(activeMeal || {});
  base = consolidateMeal(base, {
    items: preCalcItems.map(p => ({
      itemId: p.itemId,
      scoutIndex: p.scoutIndex,
      name: p.originalName || p.keyword || 'Food Item',
      estimatedCalories: p.estimatedCalories || (p.primaryBase100g ? p.primaryBase100g.calories : 0),
      nutrients: p.nutrients || {},
      weightGrams: p.weightGrams || p.estimatedWeightGrams || 100,
      dbId: p.bestMatchDbId,
      dbSource: p.bestMatchDbSource,
      componentsDetailList: p.componentsDetailList,
      primaryBase100g: p.primaryBase100g,
      rawNutritionLabel: p.rawNutritionLabel,
      boundingBox2D: p.boundingBox2D || null,
      sourceImageIndex: typeof p.sourceImageIndex === 'number' ? p.sourceImageIndex : 0,
    })),
    nutrients: aggregatedNutrients || {},
  }, 'calculation');
  return base;
}
