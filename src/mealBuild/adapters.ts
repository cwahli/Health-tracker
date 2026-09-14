import { MealBuild, ComparisonSet } from './types';
import { migrateMealSchema } from './consolidate';

export function fromPendingFoodLog(log: any, meta?: Partial<MealBuild>): MealBuild {
  if (!log) return migrateMealSchema({});
  
  const items = Array.isArray(log.itemsBreakdown) ? log.itemsBreakdown : (Array.isArray(log.items) ? log.items : []);
  
  const meal: MealBuild = {
    id: meta?.id || Math.random().toString(36).substring(2, 9),
    schemaVersion: 1,
    version: meta?.version || 1,
    mode: meta?.mode || 'new_log',
    items: items.map((i: any, index: number) => ({
      ...i,
      scoutIndex: i.scoutIndex ?? index,
    })),
    nutrients: log.nutrients || {},
    content: {
      name: log.name || log.title,
      healthImpact: log.healthImpact || '',
      benefits: log.benefits || [],
      risks: log.risks || [],
      recommendation: log.recommendation || '',
      verdict: log.verdict || '',
      message: log.message || log.description || '',
    },
    imageUrls: log.imageUrls || [],
    composition: log.composition || meta?.composition,
    receiptTable: log.receiptTable,
    weightGrams: log.weightGrams,
    quantity: log.quantity,
    date: log.date || meta?.date,
    historyLog: log.historyLog || meta?.historyLog || [],
    ...meta
  };
  if (log.userLockedSlots || (meta as any)?.userLockedSlots) {
    (meal as any).userLockedSlots = log.userLockedSlots || (meta as any).userLockedSlots;
  }
  
  return migrateMealSchema(meal);
}

export function toPendingFoodLog(meal: MealBuild): any {
  return {
    id: meal.id,
    itemsBreakdown: meal.items,
    items: meal.items,
    nutrients: meal.nutrients || {},
    name: meal.content?.name || 'Meal',
    title: meal.content?.name || 'Meal',
    message: meal.content?.message || meal.message || '',
    healthImpact: meal.content?.healthImpact || meal.healthImpact || '',
    composition: meal.composition || '',
    benefits: meal.content?.benefits || [],
    risks: meal.content?.risks || [],
    recommendation: meal.content?.recommendation || '',
    verdict: meal.content?.verdict || '',
    imageUrls: meal.imageUrls || [],
    photoUrl: meal.photoUrl,
    weightGrams: meal.weightGrams,
    quantity: meal.quantity,
    debugUrl: meal.coldDebugUrl,
    scoutConfidence: meal.scoutConfidence,
    scoutContentType: meal.scoutContentType,
    receiptTable: meal.receiptTable,
    dangerBadges: meal.dangerBadges,
    biomarkerStatus: meal.biomarkerStatus,
    savable: meal.savable,
    degradedStages: meal.degradedStages,
    date: meal.date,
    scoutItems: meal.scoutSnapshot || [],
    historyLog: meal.historyLog || [],
    userLockedSlots: (meal as any).userLockedSlots || [],
  };
}

export function fromEvaluationComparison(comparison: any, scoutItems: any[], meta?: any): ComparisonSet {
  const set: ComparisonSet = {
    id: meta?.id || Math.random().toString(36).substring(2, 9),
    schemaVersion: 1,
    version: 1,
    mode: 'compare',
    optionMeals: [],
    ...meta
  };
  
  const rawGroups =
    (Array.isArray(comparison?.groups) && comparison.groups) ||
    (Array.isArray(comparison?.options) && comparison.options) ||
    [];

  if (rawGroups.length > 0) {
    set.optionMeals = rawGroups.map((group: any, index: number) => {
      let items: any[] = [];
      if (Array.isArray(group.items) && group.items.length > 0) {
        items = group.items.map((optItem: any) => {
          const scoutMatch = scoutItems?.find(s => s.name === optItem.name || s.name === optItem.title || s.scoutIndex === optItem.scoutIndex);
          return {
            ...scoutMatch,
            ...optItem,
            scoutIndex: optItem.scoutIndex ?? scoutMatch?.scoutIndex,
          };
        });
      } else if (Array.isArray(group.scoutItemIndices) && scoutItems) {
        items = group.scoutItemIndices.map((idx: number) => scoutItems[idx] || scoutItems.find(s => s.scoutIndex === idx)).filter(Boolean);
      }

      const meal: MealBuild = {
        id: Math.random().toString(36).substring(2, 9),
        schemaVersion: 1,
        version: 1,
        mode: 'compare_option',
        parentComparisonId: set.id,
        items,
        nutrients: group.nutrients || group.averageNutrients || {},
        content: {
          name: group.groupName || group.name || group.title || `Option ${index + 1}`,
          benefits: group.benefits || [],
          risks: group.risks || [],
          recommendation: group.recommendation || '',
          verdict: group.verdict || '',
          message: group.message || '',
        }
      };
      return meal;
    });
  }
  
  return set;
}

export function toEvaluationPayload(set: ComparisonSet): { mode: 'evaluation'; comparison: any, scoutItems?: any[], message?: string } {
  const formattedOptions = set.optionMeals.map(meal => ({
    ...toPendingFoodLog(meal),
    groupName: meal.content?.name,
    name: meal.content?.name,
    title: meal.content?.name,
  }));

  return {
    mode: 'evaluation',
    comparison: {
      groups: formattedOptions,
      options: formattedOptions,
    },
    scoutItems: set.optionMeals.flatMap(m => m.items),
    message: set.content?.message || 'Comparison ready.'
  };
}

export function fromActiveMeal(activeMeal: any): MealBuild {
  const meal = fromPendingFoodLog(activeMeal, { mode: 'edit', id: activeMeal.id });
  return meal;
}
