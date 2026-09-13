import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NutrientPieChart } from './NutrientPieChart';

describe('NutrientPieChart polarity wrap', () => {
  it('wraps sat-fat overage in rose, protein overage in emerald', () => {
    const satFat = renderToStaticMarkup(
      <NutrientPieChart allowance={14} alreadyConsumed={0} mealValue={29} nutrientKey="saturated_fat" />
    );
    expect(satFat).toContain('var(--color-rose-500)');
    expect(satFat).not.toContain('var(--color-emerald-500)');

    const protein = renderToStaticMarkup(
      <NutrientPieChart allowance={65} alreadyConsumed={0} mealValue={132} nutrientKey="protein" />
    );
    expect(protein).toContain('var(--color-emerald-500)');
    expect(protein).not.toContain('var(--color-rose-500)');
  });
});
