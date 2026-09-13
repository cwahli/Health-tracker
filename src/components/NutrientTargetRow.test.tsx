import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NutrientTargetRow } from './NutrientTargetRow';

describe('NutrientTargetRow', () => {
  it('renders all top target nutrients matching Home derivation', () => {
    const report = {
      topNutrientTargets: ['saturatedFat', 'addedSugar'],
      healthBaselineCategories: [
        {
          priorityNutrientTargets: [{ nutrientKey: 'calories' }, { nutrientKey: 'solubleFibre' }]
        },
        {
          nutrientTargets: ['sodium', 'steps']
        }
      ],
      dailyNutrientTargets: {
        saturatedFat: '15g',
        addedSugar: '25g',
        calories: '2100kcal',
        solubleFibre: '15g',
        sodium: '2000mg',
        steps: '8000'
      }
    };

    const nutrients = {
      saturatedFat: 3.7,
      addedSugar: 0,
      calories: 450,
      solubleFibre: 2.5,
      sodium: 320
    };

    const html = renderToStaticMarkup(
      <NutrientTargetRow
        nutrients={nutrients}
        report={report}
        profile={{ language: 'en' }}
      />
    );

    expect(html).toContain('data-testid="nutrient-target-row"');
    expect(html).toContain('data-testid="nutrient-target-item-saturatedFat"');
    expect(html).toContain('data-testid="nutrient-target-item-addedSugar"');
    expect(html).toContain('data-testid="nutrient-target-item-calories"');
    expect(html).toContain('data-testid="nutrient-target-item-solubleFibre"');
    expect(html).toContain('data-testid="nutrient-target-item-sodium"');

    // Values formatted properly (even 0 is rendered as 0.00 g)
    expect(html).toContain('Sat Fat: 3.70 g');
    expect(html).toContain('Added Sugar: 0.00 g');
    expect(html).toContain('Calories: 450 kcal');
    expect(html).toContain('Soluble Fibre: 2.50 g');
    expect(html).toContain('Sodium: 320 mg');

    // Steps must NOT be rendered
    expect(html).not.toContain('nutrient-target-item-steps');
    expect(html).not.toContain('8000');
  });
});

