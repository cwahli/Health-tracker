export const projectors = {} as any;

export const projectScoutInput = (jobPayload: any) => {
  return {
    text: jobPayload.inputSnapshot?.message,
    imageUrls: jobPayload.photo_url ? [jobPayload.photo_url] : [],
    diningEnvironment: jobPayload.diningEnvironment
  };
};

export const projectResolverInput = (meal: any) => {
  return {
    mealId: meal.id,
    items: meal.items?.map((item: any) => ({
      itemId: item.itemId,
      scoutIndex: item.scoutIndex,
      name: item.name,
      originalName: item.originalName,
      weightGrams: item.weightGrams,
      formTags: [item.physicalFormClassification].filter(Boolean),
      diningEnvironment: meal.diningEnvironment,
      componentsSketch: item.componentsDetailList?.map((c: any) => c.name) || [],
      hasRawLabel: !!item.rawNutritionLabel
    })) || []
  };
};

export const projectCalculatorInput = (meal: any) => {
  return {
    mealId: meal.id,
    items: meal.items?.map((item: any) => ({
      itemId: item.itemId,
      dbId: item.dbId,
      weightGrams: item.weightGrams
    })) || [],
    lockedNutrientKeys: Array.from(new Set(meal.items?.flatMap((i: any) => i.lockedNutrientKeys || []) || []))
  };
};

export const projectDietInput = (meal: any, profile: any) => {
  return {
    mealId: meal.id,
    macroTotals: {
      calories: meal.nutrients?.calories || 0,
      protein: meal.nutrients?.protein || 0,
      fat: meal.nutrients?.fat || 0,
      carbohydrates: meal.nutrients?.carbohydrates || 0
    },
    itemsSummary: meal.items?.map((item: any) => ({
      name: item.name,
      protein: item.nutrients?.protein || 0
    })) || [],
    userProfileSummary: {
      age: profile?.age,
      gender: profile?.gender,
      goals: profile?.healthGoals || [],
      dietaryRestrictions: profile?.allergies || []
    }
  };
};
