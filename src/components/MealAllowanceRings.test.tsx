import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MealAllowanceRings, computeMealAllowanceRings, formatRingNumber } from './MealAllowanceRings';

const report = {
  dailyNutrientTargets: {
    saturatedFat: '20g',
    sodium: '2300mg',
    calories: '2000kcal',
  },
};

describe('computeMealAllowanceRings', () => {
  it('computes sat fat, sodium-in-grams and calories against daily allowances', () => {
    const rings = computeMealAllowanceRings({
      nutrients: { saturatedFat: 18.7, sodium: 2750, calories: 1193 },
      report,
      profile: { language: 'en' },
    });
    expect(rings.map((r) => r.key)).toEqual(['saturatedFat', 'sodium', 'calories']);
    const sat = rings[0];
    expect(sat.max).toBe(20);
    expect(sat.value).toBeCloseTo(18.7, 5);
    expect(sat.pct).toBeCloseTo(0.935, 5);
    const sod = rings[1];
    expect(sod.unit).toBe('g');
    expect(sod.value).toBeCloseTo(2.75, 5);
    expect(sod.max).toBeCloseTo(2.3, 5);
    expect(sod.pct).toBeGreaterThan(1);
    expect(rings[2].max).toBe(2000);
  });

  it('sums the full day across logs sharing the date', () => {
    const rings = computeMealAllowanceRings({
      nutrients: { saturatedFat: 8, sodium: 900, calories: 500 },
      report,
      profile: { language: 'en' },
      activeFoodLogs: [
        { id: 'a', date: '2026-10-17', nutrients: { saturatedFat: 8, sodium: 900, calories: 500 } },
        { id: 'b', date: '2026-10-17', nutrients: { saturatedFat: 10.7, sodium: 1850, calories: 693 } },
        { id: 'c', date: '2026-10-16', nutrients: { saturatedFat: 99, sodium: 9999, calories: 9999 } },
      ],
      logDate: '2026-10-17',
      logId: 'b',
    });
    expect(rings[0].value).toBeCloseTo(18.7, 5);
    expect(rings[1].value).toBeCloseTo(2.75, 5);
    expect(rings[2].value).toBe(1193);
  });

  it('falls back to app defaults without a report', () => {
    const rings = computeMealAllowanceRings({
      nutrients: { saturatedFat: 5, sodium: 500, calories: 600 },
      profile: { language: 'en' },
    });
    expect(rings[0].max).toBe(15);
    expect(rings[1].max).toBeCloseTo(1.5, 5);
    expect(rings[2].max).toBe(2000);
  });

  it('uses short translated names', () => {
    const rings = computeMealAllowanceRings({
      nutrients: {},
      report,
      profile: { language: 'en' },
    });
    expect(rings.map((r) => r.name)).toEqual(['Sat Fat', 'Sodium', 'Calories']);
  });
});

describe('formatRingNumber', () => {
  it('rounds like the prototype: whole grams, trimmed decimals', () => {
    expect(formatRingNumber(1193)).toBe('1193');
    expect(formatRingNumber(2.75)).toBe('2.75');
    expect(formatRingNumber(2.3)).toBe('2.3');
    expect(formatRingNumber(18.7)).toBe('18.7');
  });
});

describe('MealAllowanceRings render', () => {
  it('renders three allowance rings with day values', () => {
    const html = renderToStaticMarkup(
      <MealAllowanceRings
        nutrients={{ saturatedFat: 18.7, sodium: 2750, calories: 1193 }}
        report={report}
        profile={{ language: 'en' }}
      />,
    );
    expect(html).toContain('data-testid="meal-allowance-rings"');
    expect(html).toContain('data-testid="allowance-ring-saturatedFat"');
    expect(html).toContain('data-testid="allowance-ring-sodium"');
    expect(html).toContain('data-testid="allowance-ring-calories"');
    expect(html).toContain('2.75');
    expect(html).toContain('1193');
  });
});
