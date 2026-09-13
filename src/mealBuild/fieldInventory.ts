export const MEAL_ENVELOPE_FIELDS: string[] = [
  'id', 'schemaVersion', 'version', 'lastUpdatedBy', 'lastUserAction',
  'historyLog', 'stageLimits', 'mode', 'parentComparisonId', 'items',
  'nutrients', 'imageUrls', 'content', 'scoutSnapshot', 'scoutContentType',
  'diningEnvironment', 'cookingMethod', 'scoutConfidence', 'receiptTable',
  'dangerBadges', 'biomarkerStatus', 'savable', 'lastCompletedStage',
  'degradedStages', 'stageLedger', 'coldDebugUrl', 'photoUrl',
  'portionClarify', 'needsPortionClarify', 'date', 'weightGrams',
  'quantity', 'basis_type', 'serving_grams', 'updatedAt',
  'deletedItemIds', 'staleDietNarrative', 'staleDietitianNarrative'
];

export const MEAL_ITEM_FIELDS: string[] = [
  'itemId', 'scoutIndex', 'name', 'canonicalDbName', 'originalName',
  'originalLocalName', 'keyword', 'weightGrams', 'estimatedWeightGrams',
  'estimatedCalories', 'nutrients', 'nutrientStatus', 'compositionStatus',
  'dbSource', 'dbId', 'cookingMethod', 'visualIngredients', 'components',
  'componentsDetailList', 'hasComponents', 'primaryBase100g',
  'primaryBaseMatchName', 'primaryBaseWeightG', 'labelNutrientsPerServing',
  'rawNutritionLabel', 'lockedNutrientKeys', 'itemLockedKeys',
  'truthNutrients', 'cookingAdded', 'ingredientsList', 'chainName',
  'foodType', 'warnings', 'confidenceRating', 'confidenceComment',
  'physicalFormClassification', 'matchReasonInfo', 'diningEnvironment',
  'saucesDetailList', 'portionChoiceApplied', 'fill', 'boundingBox2D', 'sourceImageIndex'
];

export const CRITICAL_PRESERVE_FIELDS: string[] = [
  'rawNutritionLabel', 'estimatedCalories', 'estimatedWeightGrams', 'components',
  'componentsDetailList', 'dbId', 'dbSource', 'lockedNutrientKeys', 'itemLockedKeys',
  'primaryBase100g', 'scoutIndex', 'itemId', 'diningEnvironment', 'boundingBox2D', 'sourceImageIndex'
];
