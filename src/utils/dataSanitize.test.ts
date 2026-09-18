import { describe, it, expect } from 'vitest';
import { buildDataSanitizePlan, applyDataSanitizePlan, cleanupInventedBiomarkerCatalog, purgeHallucinatedAndCorruptedData } from './dataSanitize';

describe('cleanupInventedBiomarkerCatalog (P2)', () => {
  it('remaps custom aliases, drops junk metric_N and pending without unit/history, clears needsApproval on builtins, and strips negative ranges', () => {
    const profile = {
      customBiomarkers: {
        'total_cholesterol_alias': { name: 'Total Cholesterol', unit: 'mmol/L' },
        'metric_1': { name: 'metric_1' },
        'metric_2': { name: '', unit: '' },
        'empty_name': { name: '   ' },
        'pending_ghost': { name: 'Ghost Marker', needsApproval: true }, // no unit, no history -> drop
        'pending_with_unit': { name: 'Valid Marker', unit: 'mg/dL', needsApproval: true }, // kept
        'hdl': { name: 'HDL Cholesterol', needsApproval: true }, // built-in -> clear needsApproval
      },
      deletedCustomBiomarkerKeys: {},
      customRanges: {
        'vitamin_d': '< 0',
        'zinc': { range: '< 0 ng/mL' },
        'iron': { range: '-10 - 20' },
        'glucose': '3.9 - 5.6 mmol/L', // valid -> kept
      },
    };

    const history = [
      { id: '1', date: '2026-08-01', biomarkers: { glucose: 5.2 } }
    ];

    const result = cleanupInventedBiomarkerCatalog(profile, history);

    // 1. Remapping
    expect(result.remappedKeys['total_cholesterol_alias']).toBe('total_cholesterol');
    expect(result.profile.deletedCustomBiomarkerKeys['total_cholesterol_alias']).toBeDefined();
    expect(result.profile.customBiomarkers['total_cholesterol_alias']).toBeUndefined();

    // 2. Junk dropped
    expect(result.droppedKeys).toContain('metric_1');
    expect(result.droppedKeys).toContain('metric_2');
    expect(result.droppedKeys).toContain('empty_name');
    expect(result.droppedKeys).toContain('pending_ghost');
    expect(result.profile.customBiomarkers['metric_1']).toBeUndefined();
    expect(result.profile.customBiomarkers['pending_ghost']).toBeUndefined();
    // B7.4: pending_with_unit moved to pendingObservations, stripped from customBiomarkers catalog
    expect(result.profile.customBiomarkers['pending_with_unit']).toBeUndefined();
    expect(result.profile.pendingObservations.some((p: any) => p.printedName === 'Valid Marker')).toBe(true);

    // 3. NeedsApproval deleted on built-ins
    expect(result.profile.customBiomarkers['hdl']?.needsApproval).toBeUndefined();

    // 4. Negative ranges stripped without inventing replacements
    expect(result.strippedRanges).toContain('vitamin_d');
    expect(result.strippedRanges).toContain('zinc');
    expect(result.strippedRanges).toContain('iron');
    expect(result.profile.customRanges['vitamin_d']).toBeUndefined();
    expect(result.profile.customRanges['zinc']).toBeUndefined();
    expect(result.profile.customRanges['iron']).toBeUndefined();
    expect(result.profile.customRanges['glucose']).toBe('3.9 - 5.6 mmol/L');
  });
});

describe('buildDataSanitizePlan', () => {
  it('proposes fixing 195 total cholesterol and merging food dups', () => {
    const plan = buildDataSanitizePlan({
      profile: {},
      biomarkers: { total_cholesterol: 195 },
      biomarkerHistory: [
        { id: 'l1', date: '08-08-2026', biomarkers: { total_cholesterol: 195 } },
        { id: 'l2', date: '02-08-2026', biomarkers: { total_cholesterol: 6.1 } },
      ],
      foodLogs: [
        {
          id: 'f1',
          name: 'Oatmeal with Fruit and Fresh Produce Selection',
          date: '2026-08-06',
          nutrients: { calories: 405 },
        },
        {
          id: 'f2',
          name: 'Oatmeal with Fruit and Fresh Produce Selection',
          date: '06-08-2026',
          nutrients: { calories: 405 },
        },
      ],
    });
    expect(plan.proposals.some((p) => p.kind === 'fix_value' || p.kind === 'drop_value')).toBe(true);
    expect(plan.proposals.some((p) => p.kind === 'merge_food')).toBe(true);
  });

  it('applies selected food merges', () => {
    const plan = buildDataSanitizePlan({
      profile: {},
      biomarkers: {},
      biomarkerHistory: [],
      foodLogs: [
        { id: 'f1', name: 'Honi Poke Salmon Poke Bowl with Sides', date: '2026-08-04', nutrients: { calories: 1176 } },
        { id: 'f2', name: 'Honi Poke Salmon Poke Bowl with Sides', date: '04-08-2026', nutrients: { calories: 1176 } },
      ],
    });
    const merge = plan.proposals.find((p) => p.kind === 'merge_food');
    expect(merge).toBeTruthy();
    const result = applyDataSanitizePlan(plan, new Set([merge!.id]), {
      profile: {},
      biomarkers: {},
      biomarkerHistory: [],
      foodLogs: [
        { id: 'f1', name: 'Honi Poke Salmon Poke Bowl with Sides', date: '2026-08-04', nutrients: { calories: 1176 } },
        { id: 'f2', name: 'Honi Poke Salmon Poke Bowl with Sides', date: '04-08-2026', nutrients: { calories: 1176 } },
      ],
    });
    expect(result.foodLogs).toHaveLength(1);
  });
});

describe('purgeHallucinatedAndCorruptedData', () => {
  it('purges synthetic 2026-08-16 panel, drops auto-BMI phantom logs, and repairs corrupted clinical notes', () => {
    const history = [
      {
        id: 'synth_1',
        date: '2026-08-16',
        biomarkers: {
          glucose: 5.4,
          estimated_average_glucose: 5.6,
          total_cholesterol: 4.8,
          hdl: 1.4,
          ldl: 2.8,
          triglycerides: 1.2
        },
        note: 'Extracted by Synthetic Clinical Data Parser'
      },
      {
        id: 'bmi_phantom_1',
        date: '2026-07-28',
        biomarkers: { bmi: 22.9 },
        note: 'Auto-logged default BMI: 70 kg, 175 cm.'
      },
      {
        id: 'real_lab_1',
        date: '2026-06-05',
        biomarkers: {
          hba1c: 40,
          serum_sodium: 143,
          serum_potassium: 4.3,
          serum_creatinine: 100
        },
        note: '(AlyssaFRS) - 01. Satisfactory - No Action | Auto-synced from Google Fit'
      }
    ];

    const profile = {
      deletedBiomarkerLogIds: {}
    };

    const res = purgeHallucinatedAndCorruptedData(history, { hba1c: 40, estimated_average_glucose: 5.6 }, profile);

    expect(res.purgedCount).toBeGreaterThan(0);
    expect(res.biomarkerHistory).toHaveLength(8);
    const realLab1 = res.biomarkerHistory.find((h: any) => h.id === 'real_lab_1');
    expect(realLab1).toBeDefined();
    expect(realLab1?.note).toBe('(AlyssaFRS) - 01. Satisfactory - No Action');
    expect(res.biomarkers['estimated_average_glucose']).toBeUndefined();
    expect(res.biomarkers['hba1c']).toBe(40);
    expect(res.profileUpdates.deletedBiomarkerLogIds?.['synth_1']).toBeDefined();
    expect(res.profileUpdates.deletedBiomarkerLogIds?.['bmi_phantom_1']).toBeDefined();
  });
});

