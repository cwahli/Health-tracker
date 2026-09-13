import { describe, it, expect } from 'vitest';
import {
  projectScoutInput,
  projectResolverInput,
  projectCalculatorInput,
  projectDietInput
} from '../projectors';
import { MealBuild } from '../types';

describe('Pure Stage Projectors (Plan §3A Context Subtraction)', () => {
  const sampleMeal: MealBuild = {
    id: 'meal-101',
    schemaVersion: 1,
    version: 3,
    mode: 'new_log',
    items: [
      {
        itemId: 'item-1',
        scoutIndex: 0,
        name: 'Grilled Salmon',
        originalName: 'salmon fillet',
        weightGrams: 180,
        dbId: 'fdc-123',
        dbSource: 'usda',
        physicalFormClassification: 'cooked_solid',
        rawNutritionLabel: { calories: 350 },
        componentsDetailList: [{ name: 'Salmon', weightGrams: 180 }],
        nutrients: { calories: 350, protein: 34, fat: 22, carbohydrates: 0 },
        lockedNutrientKeys: ['protein']
      },
      {
        itemId: 'item-2',
        scoutIndex: 1,
        name: 'Steamed Broccoli',
        originalName: 'broccoli florets',
        weightGrams: 120,
        dbId: 'fdc-456',
        dbSource: 'usda',
        physicalFormClassification: 'cooked_solid',
        nutrients: { calories: 45, protein: 4, fat: 0.5, carbohydrates: 8 }
      }
    ],
    nutrients: { calories: 395, protein: 38, fat: 22.5, carbohydrates: 8 },
    diningEnvironment: 'home_cooked'
  };

  it('projectScoutInput strips heavy candidate dumps and returns light input payload', () => {
    const jobPayload = {
      inputSnapshot: { message: 'I ate grilled salmon and broccoli' },
      photo_url: 'https://r2.cdn/photo.jpg',
      mode: 'new_log',
      diningEnvironment: 'restaurant',
      heavyFdcCandidatesDump: [{ id: 1, name: 'junk' }]
    };

    const scoutInput = projectScoutInput(jobPayload);
    expect(scoutInput.text).toBe('I ate grilled salmon and broccoli');
    expect(scoutInput.imageUrls).toEqual(['https://r2.cdn/photo.jpg']);
    expect(scoutInput.diningEnvironment).toBe('restaurant');
    expect((scoutInput as any).heavyFdcCandidatesDump).toBeUndefined();
  });

  it('projectResolverInput provides clean per-item search keys and excludes LLM context bloat', () => {
    const resolverInput = projectResolverInput(sampleMeal);

    expect(resolverInput.mealId).toBe('meal-101');
    expect(resolverInput.items).toHaveLength(2);
    expect(resolverInput.items[0]).toEqual({
      itemId: 'item-1',
      scoutIndex: 0,
      name: 'Grilled Salmon',
      originalName: 'salmon fillet',
      weightGrams: 180,
      formTags: ['cooked_solid'],
      diningEnvironment: 'home_cooked',
      componentsSketch: ['Salmon'],
      hasRawLabel: true
    });
    expect((resolverInput.items[0] as any).rawNutritionLabel).toBeUndefined();
  });

  it('projectCalculatorInput produces pure mathematical input with 0 LLM context', () => {
    const calcInput = projectCalculatorInput(sampleMeal);

    expect(calcInput.mealId).toBe('meal-101');
    expect(calcInput.items).toHaveLength(2);
    expect(calcInput.items[0].dbId).toBe('fdc-123');
    expect(calcInput.items[0].weightGrams).toBe(180);
    expect(calcInput.lockedNutrientKeys).toContain('protein');
  });

  it('projectDietInput extracts clean macros and light user profile summary without raw candidate dumps', () => {
    const mockProfile = { age: 30, gender: 'female', healthGoals: ['muscle_gain'], allergies: ['peanuts'] };
    const dietInput = projectDietInput(sampleMeal, mockProfile);

    expect(dietInput.mealId).toBe('meal-101');
    expect(dietInput.macroTotals.calories).toBe(395);
    expect(dietInput.itemsSummary).toHaveLength(2);
    expect(dietInput.itemsSummary[0].name).toBe('Grilled Salmon');
    expect(dietInput.itemsSummary[0].protein).toBe(34);
    expect(dietInput.userProfileSummary).toEqual({
      age: 30,
      gender: 'female',
      goals: ['muscle_gain'],
      dietaryRestrictions: ['peanuts']
    });
  });
});
