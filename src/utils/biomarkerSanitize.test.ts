import { describe, it, expect } from 'vitest';
import {
  isBiomarkerValueImprobable,
  getBiomarkerStatus,
  sanitizeBiomarkerHistoryOnLoad,
  normalizeHistoricalTelemetryErrors,
  parseNormalRangeBounds,
} from './biomarkers';

describe('parseNormalRangeBounds', () => {
  it('parses Aim under 5.0', () => {
    const b = parseNormalRangeBounds('Aim under 5.0');
    expect(b.max).toBe(5);
  });
});

describe('isBiomarkerValueImprobable', () => {
  it('flags 195 mmol/L total cholesterol', () => {
    expect(isBiomarkerValueImprobable('total_cholesterol', 195, 'Aim under 5.0')).toBe(true);
  });
  it('flags 42.1 hematocrit as %', () => {
    expect(isBiomarkerValueImprobable('hematocrit', 42.1, '0.36-0.50')).toBe(true);
  });
  it('flags 14.5 hemoglobin as g/dL when unit is g/L', () => {
    expect(isBiomarkerValueImprobable('hemoglobin', 14.5, '120-180')).toBe(true);
  });
  it('does not flag everyday step counts as improbable', () => {
    expect(isBiomarkerValueImprobable('steps', 3095, '7000 - 12000')).toBe(false);
    expect(isBiomarkerValueImprobable('steps', 0, '7000 - 12000')).toBe(false);
    expect(isBiomarkerValueImprobable('steps', 25000, '7000 - 12000')).toBe(false);
    expect(isBiomarkerValueImprobable('steps', -10, '7000 - 12000')).toBe(true);
    expect(getBiomarkerStatus('steps', 3095, '7000 - 12000')).toBe('low');
  });
});

describe('sanitizeBiomarkerHistoryOnLoad', () => {
  it('flags 195 cholesterol but does not rewrite it', () => {
    const history = [
      {
        id: '1',
        date: '08-08-2026',
        biomarkers: { total_cholesterol: 195 },
      },
      {
        id: '2',
        date: '02-08-2026',
        biomarkers: { total_cholesterol: 6.1 },
      },
    ];
    const { history: cleaned, fixedCount, current } = sanitizeBiomarkerHistoryOnLoad(history, {});
    expect(fixedCount).toBeGreaterThan(0);
    const aug8 = cleaned.find((h) => String(h.date).includes('08'));
    expect(Number(aug8?.biomarkers?.total_cholesterol)).toBe(195);
    expect(Number(current.total_cholesterol)).toBe(195);
  });

  it('flags hematocrit 42.1 but leaves the stored value', () => {
    const history = [{ id: '1', date: '08-08-2026', biomarkers: { hematocrit: 42.1 } }];
    const { history: cleaned, fixedCount } = sanitizeBiomarkerHistoryOnLoad(history, {
      customBiomarkers: { hematocrit: { normalRange: '0.36-0.50' } }
    });
    expect(fixedCount).toBeGreaterThan(0);
    expect(Number(cleaned[0].biomarkers.hematocrit)).toBeCloseTo(42.1, 1);
  });
});

describe('canonical clinical definitions and engine sanitization capabilities', () => {
  it('provides built-in standard reference ranges and units for basic clinical panel markers', async () => {
    const { biomarkerDefinitions } = await import('./biomarkers');
    const pot = biomarkerDefinitions.find((d) => d.key === 'serum_potassium');
    expect(pot).toBeDefined();
    expect(pot?.normalRange).toBe('3.5 - 5.0');
    expect(pot?.unit).toBe('mmol/L');

    const sod = biomarkerDefinitions.find((d) => d.key === 'serum_sodium');
    expect(sod?.normalRange).toBe('135 - 145');
    expect(sod?.unit).toBe('mmol/L');

    const bili = biomarkerDefinitions.find((d) => d.key === 'total_bilirubin');
    expect(bili?.normalRange).toBe('3 - 21');
    expect(bili?.unit).toBe('umol/L');

    const psa = biomarkerDefinitions.find((d) => d.key === 'prostate_specific_antigen');
    expect(psa?.normalRange).toBe('< 2.5');
    expect(psa?.unit).toBe('ug/L');

    const nonHdl = biomarkerDefinitions.find((d) => d.key === 'non_hdl_cholesterol');
    expect(nonHdl?.normalRange).toBe('< 3.8');
    expect(nonHdl?.unit).toBe('mmol/L');
  });

  it('detects transposed DD-MM vs MM-DD lab panels and unifies observations onto the true date', async () => {
    const { buildDataSanitizePlan, applyDataSanitizePlan } = await import('./dataSanitize');
    const history = [
      {
        id: 'log_apr2',
        date: '02-04-2024',
        biomarkers: { hemoglobin: 164, mean_corpuscular_hemoglobin_concentration: 336 },
      },
      {
        id: 'log_feb4_dup',
        date: '04-02-2024',
        biomarkers: {
          hemoglobin: 164,
          mean_corpuscular_hemoglobin_concentration: 336,
          creatinine: 72,
          serum_potassium: 5.3,
        },
      },
    ];

    const plan = buildDataSanitizePlan({
      biomarkerHistory: history,
      profile: {},
      biomarkers: {},
    });

    const transposedProposal = plan.proposals.find((p) => p.kind === 'merge_transposed_dates');
    expect(transposedProposal).toBeDefined();
    expect(transposedProposal?.selected).toBe(true);

    const result = applyDataSanitizePlan(plan, new Set([transposedProposal!.id]), {
      biomarkerHistory: history,
      profile: {},
      biomarkers: {},
      foodLogs: [],
    });

    // The active history should keep the unified keeper log with all merged markers
    const keeper = result.biomarkerHistory.find((h) => h.id === transposedProposal?.targetLogId);
    expect(keeper).toBeDefined();
    expect(keeper?.biomarkers.creatinine).toBe(72);
    expect(keeper?.biomarkers.serum_potassium).toBe(5.3);
    expect(keeper?.biomarkers.hemoglobin).toBe(164);

    const deleted = result.biomarkerHistory.find((h) => h.id === transposedProposal?.logId);
    expect(deleted?.sync_state).toBe('delete');
  });

  it('detects future date transpositions (e.g. 07-11-2026 duplicate of 11-07-2026) and merges them', async () => {
    const { buildDataSanitizePlan } = await import('./dataSanitize');
    const history = [
      { id: 'step_july', date: '11-07-2026', biomarkers: { steps: 3095 } },
      { id: 'step_future', date: '07-11-2026', biomarkers: { steps: 3095 } },
    ];

    const plan = buildDataSanitizePlan({
      biomarkerHistory: history,
      profile: {},
      biomarkers: {},
    });

    const proposal = plan.proposals.find(
      (p) => p.kind === 'merge_transposed_dates' && (p.date === '07-11-2026' || p.targetDate === '11-07-2026')
    );
    expect(proposal).toBeDefined();
    expect(proposal?.targetLogId).toBe('step_july');
  });

  it('proposes backfilling canonical ranges for custom biomarkers marked Unknown', async () => {
    const { buildDataSanitizePlan, applyDataSanitizePlan } = await import('./dataSanitize');
    const profile = {
      customBiomarkers: {
        serum_potassium: { name: 'Serum Potassium', normalRange: 'Unknown', unit: '' },
        total_bilirubin: { name: 'Total Bilirubin', normalRange: '', unit: 'umol/L' },
      },
    };

    const plan = buildDataSanitizePlan({
      profile,
      biomarkerHistory: [],
      biomarkers: {},
    });

    const potBackfill = plan.proposals.find((p) => p.kind === 'backfill_canonical_range' && p.key === 'serum_potassium');
    expect(potBackfill).toBeDefined();
    expect(potBackfill?.canonicalRange).toBe('3.5 - 5.0');
    expect(potBackfill?.canonicalUnit).toBe('mmol/L');

    const res = applyDataSanitizePlan(plan, new Set([potBackfill!.id]), {
      profile,
      biomarkerHistory: [],
      biomarkers: {},
      foodLogs: [],
    });

    expect(res.profileUpdates.customBiomarkers?.serum_potassium?.normalRange).toBe('3.5 - 5.0');
    expect(res.profileUpdates.customBiomarkers?.serum_potassium?.unit).toBe('mmol/L');
  });

  it('proposes archiving qualitative swab tests and granular survey checkboxes', async () => {
    const { buildDataSanitizePlan, applyDataSanitizePlan } = await import('./dataSanitize');
    const profile = {
      customBiomarkers: {
        chlamydia_dna_detection: { name: 'Chlamydia Dna Detection', normalRange: 'Unknown' },
        audit_guilt_remorse: { name: 'Audit Guilt Remorse Score', normalRange: 'Unknown' },
      },
    };

    const plan = buildDataSanitizePlan({
      profile,
      biomarkerHistory: [
        { id: '1', date: '09-06-2026', biomarkers: { chlamydia_dna_detection: 'NEGATIVE' } },
      ],
      biomarkers: {},
    });

    const chlamydiaArchive = plan.proposals.find((p) => p.kind === 'archive_qualitative_or_survey' && p.key === 'chlamydia_dna_detection');
    expect(chlamydiaArchive).toBeDefined();

    const auditArchive = plan.proposals.find((p) => p.kind === 'archive_qualitative_or_survey' && p.key === 'audit_guilt_remorse');
    expect(auditArchive).toBeDefined();

    const res = applyDataSanitizePlan(plan, new Set([chlamydiaArchive!.id, auditArchive!.id]), {
      profile,
      biomarkerHistory: [],
      biomarkers: {},
      foodLogs: [],
    });

    expect(res.profileUpdates.notUsedInMedicalHistory?.chlamydia_dna_detection).toBe(true);
    expect(res.profileUpdates.notUsedInMedicalHistory?.audit_guilt_remorse).toBe(true);
  });

  it('generates non-contradictory medical insights for HbA1c, steps, and unverified ranges', async () => {
    const { generateDynamicInsight } = await import('./biomarkerInsights');
    const { biomarkerDefinitions } = await import('./biomarkers');

    const hba1cDef = biomarkerDefinitions.find((d) => d.key === 'hba1c')!;
    const hba1cInsight = generateDynamicInsight(hba1cDef, { ethnicity: 'Chinese', age: 43, gender: 'male' } as any, 40, 'Elevated');
    // Must NOT claim 40 is elevated above 20 - 41
    expect(hba1cInsight).not.toContain('elevated above the standard reference range (20 - 41 mmol/mol)');
    expect(hba1cInsight).toContain('within the standard general laboratory reference range');

    const stepsDef = biomarkerDefinitions.find((d) => d.key === 'steps')!;
    const stepsInsight = generateDynamicInsight(stepsDef, { ethnicity: 'Chinese', age: 43 } as any, 3095, 'low');
    // Must NOT prescribe dietary nutrient absorption / supplementation for low step counts
    expect(stepsInsight).not.toContain('sub-optimal nutrient absorption');
    expect(stepsInsight).toContain('Aim over 8,000 steps');

    const unknownDef = { key: 'test_marker', name: 'Test Marker', normalRange: 'Unknown', unit: '' } as any;
    const unknownInsight = generateDynamicInsight(unknownDef, { ethnicity: 'Chinese', age: 43 } as any, 10, 'unknown');
    // Must NOT state "recommended target range of Unknown is essential"
    expect(unknownInsight).not.toContain('target range of Unknown');
    expect(unknownInsight).toContain('pending clinical lab verification');
  });
});
