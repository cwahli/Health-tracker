import { describe, it, expect } from 'vitest';
import { resolveMealVerdict } from './verdictUtils.js';

describe('resolveMealVerdict', () => {
  it('preserves valid structured verdict object', () => {
    const meal = {
      name: 'Salmon and Avocado',
      verdict: { label: 'Heart Healthy Fats', level: 'good' },
      nutrients: { saturatedFat: 2, calories: 400 },
    };
    const res = resolveMealVerdict(meal);
    expect(res).toEqual({
      label: 'Heart Healthy Fats',
      level: 'good',
    });
  });

  it('parses valid JSON string verdict', () => {
    const meal = {
      name: 'Oatmeal with Berries',
      verdict: '{"label":"Supports Digestive Health","level":"good"}',
      nutrients: { fiber: 8, calories: 250 },
    };
    const res = resolveMealVerdict(meal);
    expect(res).toEqual({
      label: 'Supports Digestive Health',
      level: 'good',
    });
  });

  it('rejects corrupt "[object Object]" and self-heals high saturated fat meal', () => {
    // Exact case from 11 Sep / 12 Sep screenshot: Fried chicken with 16.1g sat fat
    const meal = {
      name: 'Fried Chicken Drumstick and Kacang Kulit',
      verdict: '[object Object]',
      recommendation: 'good', // legacy default
      saturated_fat: 16.1,
      nutrients: { saturatedFat: 16.1, calories: 1091 },
    };
    const res = resolveMealVerdict(meal);
    expect(res).not.toBeNull();
    expect(res?.label).toBe('Elevated Saturated Fat');
    expect(res?.level).toBe('warning');
    // Crucial: Must NEVER return literal 'good' or '[object Object]'
    expect(res?.label.toLowerCase()).not.toBe('good');
    expect(res?.label).not.toBe('[object Object]');
  });

  it('self-heals meal when verdict is null (12 Sep regression where badge disappeared)', () => {
    const meal = {
      name: 'Kerupuk, Es Teh Tawar, and 2 other dishes',
      verdict: null,
      recommendation: null,
      nutrients: { saturatedFat: 11.5, calories: 819 },
    };
    const res = resolveMealVerdict(meal);
    expect(res).not.toBeNull();
    expect(res?.label).toBe('Elevated Saturated Fat');
    expect(res?.level).toBe('warning');
  });

  it('self-heals high sugar meal to High Glycemic Sugar', () => {
    const meal = {
      name: 'Soda and Donut',
      verdict: null,
      nutrients: { addedSugar: 35, calories: 450 },
    };
    const res = resolveMealVerdict(meal);
    expect(res?.label).toBe('High Glycemic Sugar');
    expect(res?.level).toBe('warning');
  });

  it('self-heals high protein meal to Lean Muscle Support', () => {
    const meal = {
      name: 'Grilled Chicken Breast',
      verdict: null,
      nutrients: { protein: 35, saturatedFat: 2, calories: 300 },
    };
    const res = resolveMealVerdict(meal);
    expect(res?.label).toBe('Lean Muscle Support');
    expect(res?.level).toBe('good');
  });

  it('falls back to Supports Metabolic Energy for balanced standard meal', () => {
    const meal = {
      name: 'White Rice and Vegetables',
      verdict: null,
      nutrients: { saturatedFat: 1, protein: 5, calories: 300 },
    };
    const res = resolveMealVerdict(meal);
    expect(res?.label).toBe('Supports Metabolic Energy');
    expect(res?.level).toBe('neutral');
  });
});
