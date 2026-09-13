import { describe, it, expect } from 'vitest';
import { buildNutritionTargetStatus, pickExplicitTargets } from './nutritionTargetStatus';

const T = { saturatedFat: 12, calories: 1318, sodium: 961, protein: 72, carbohydrates: 128 };

function day(date: string, nutrients: Record<string, number>) {
  return { date, nutrients };
}

describe('buildNutritionTargetStatus (adaptive rolling average)', () => {
  it('matches the spec shape on 7 full days', () => {
    const logs = Array.from({ length: 7 }, (_, i) => day(`2026-09-${String(i + 1).padStart(2, '0')}`, {
      saturatedFat: 33, calories: 2610, sodium: 3096, protein: 125, carbohydrates: 226,
      totalFibre: 35, potassium: 1777, solubleFibre: 2.6, addedSugar: 12, transFat: 0,
    }));
    const out = buildNutritionTargetStatus({ logs, targets: T, todayStr: '2026-09-07' });
    expect(out.startsWith('=== NUTRITIONAL TARGET STATUS ===\n7 days avg: ')).toBe(true);
    expect(out).toMatch(/Sat fat \(33g - 17\d% over\)/);
    expect(out).toMatch(/Calorie \(2610kcal - 9\d% over\)/);
    expect(out).toMatch(/Sodium \(3096mg - 22\d% over\)/);
    expect(out).toMatch(/Protein \(125g - 7\d% over\)/);
    expect(out).toMatch(/Carbohydrates \(226g - 7\d% over\)/);
    expect(out).toMatch(/Total Fibre \(35g\)/);
    expect(out).toMatch(/Potassium \(1777mg\)/);
    expect(out).toMatch(/Soluble Fibre \(2\.6g\)/);
    expect(out).toMatch(/Added Sugar \(12g\)/);
    expect(out).toMatch(/Trans Fat \(0g\)/);
  });

  it('restart after a gap yields a 1-day average (empty days never dilute)', () => {
    const logs = [
      day('2026-08-20', { calories: 2000, protein: 100 }),
      day('2026-09-07', { calories: 2600, protein: 120 }),
    ];
    const out = buildNutritionTargetStatus({ logs, targets: { calories: 2000 }, todayStr: '2026-09-07' });
    expect(out).toMatch(/^=== NUTRITIONAL TARGET STATUS ===\n1 days avg: /);
    expect(out).toMatch(/Calorie \(2600kcal - 30% over\)/);
  });

  it('two logged days yield a 2-day average', () => {
    const logs = [
      day('2026-09-06', { calories: 2000 }),
      day('2026-09-07', { calories: 2600 }),
    ];
    const out = buildNutritionTargetStatus({ logs, targets: { calories: 2000 }, todayStr: '2026-09-07' });
    expect(out).toMatch(/\n2 days avg: /);
    expect(out).toMatch(/Calorie \(2300kcal - 15% over\)/);
  });

  it('under-target and on-target wording; no percent without a target', () => {
    const logs = [day('2026-09-07', { calories: 1500, sodium: 961, protein: 50 })];
    const out = buildNutritionTargetStatus({
      logs,
      targets: { calories: 2000, sodium: 961 },
      todayStr: '2026-09-07',
    });
    expect(out).toMatch(/Calorie \(1500kcal - 25% under\)/);
    expect(out).toMatch(/Sodium \(961mg - on target\)/);
    expect(out).toMatch(/Protein \(50g\)/);
  });

  it('returns empty with no usable days', () => {
    expect(buildNutritionTargetStatus({ logs: [], targets: T, todayStr: '2026-09-07' })).toBe('');
    expect(buildNutritionTargetStatus({ logs: [day('2026-09-07', {})], targets: T, todayStr: '2026-09-07' })).toBe('');
    expect(buildNutritionTargetStatus({ logs: [day('2026-08-01', { calories: 1 })], targets: T, todayStr: '2026-09-07' })).toBe('');
    expect(buildNutritionTargetStatus({ logs: undefined, targets: T, todayStr: '' })).toBe('');
  });

  it('pickExplicitTargets keeps only finite positive target keys', () => {
    expect(pickExplicitTargets({ calories: '2000', saturatedFat: 20, sodium: 0, protein: null, foo: 1 }))
      .toEqual({ calories: 2000, saturatedFat: 20 });
    expect(pickExplicitTargets(null)).toEqual({});
  });

  it('evaluates custom targetKeys matching Top Targets', () => {
    const topKeys = ['saturatedFat', 'addedSugar', 'calories', 'solubleFibre', 'sodium'];
    const targets = pickExplicitTargets({
      saturatedFat: 15,
      addedSugar: 25,
      calories: 2100,
      solubleFibre: 15,
      sodium: 2000,
      steps: 8000
    }, topKeys);

    const logs = [day('2026-09-07', {
      saturatedFat: 12,
      addedSugar: 10,
      calories: 1800,
      solubleFibre: 12,
      sodium: 1500,
      protein: 80
    })];

    const out = buildNutritionTargetStatus({
      logs,
      targets,
      todayStr: '2026-09-07',
      targetKeys: topKeys
    });

    expect(out).toContain('Sat fat (12g - 20% under)');
    expect(out).toContain('Added Sugar (10g - 60% under)');
    expect(out).toContain('Calorie (1800kcal - 14% under)');
    expect(out).toContain('Soluble Fibre (12g - 20% under)');
    expect(out).toContain('Sodium (1500mg - 25% under)');
    // Protein was logged but not in targetKeys, so should not appear
    expect(out).not.toContain('Protein');
    expect(out).not.toContain('steps');
  });
});
