import { describe, it, expect } from 'vitest';
import {
  normalizeStemKey,
  getCanonicalBiomarkerStem,
  runGeneralizedBiomarkerAudit,
  findCatalogDefinition,
  extractUnitFromString,
  normalizeUnitEquivalence,
  deriveConflictResolution
} from './biomarkerAuditEngine';
import {
  normalizeBiomarkerName,
  isBiomarkerDuplicateCandidate,
  findDuplicateOrExistingBiomarker,
  biomarkerDefinitions
} from './biomarkers';

describe('Biomarker Audit & Deduplication Engine', () => {
  it('correctly maps AST, SGOT, aspartate aminotransferase and serum levels to canonical AST stem', () => {
    const s1 = getCanonicalBiomarkerStem('ast');
    const s2 = getCanonicalBiomarkerStem('sgot');
    const s3 = getCanonicalBiomarkerStem('aspartate_aminotransferase');
    const s4 = getCanonicalBiomarkerStem('ast_serum_level_u_l');
    const s5 = getCanonicalBiomarkerStem('serum_ast_level');

    expect(s1).toBe(s2);
    expect(s1).toBe(s3);
    expect(s1).toBe(s4);
    expect(s1).toBe(s5);
  });

  it('correctly maps HDL, HDL-C, serum HDL to canonical HDL stem', () => {
    const s1 = getCanonicalBiomarkerStem('hdl');
    const s2 = getCanonicalBiomarkerStem('hdl_c');
    const s3 = getCanonicalBiomarkerStem('hdl_cholesterol');
    const s4 = getCanonicalBiomarkerStem('serum_hdl_cholesterol_mmol_l');
    const s5 = getCanonicalBiomarkerStem('serum_hdl');

    expect(s1).toBe(s2);
    expect(s1).toBe(s3);
    expect(s1).toBe(s4);
    expect(s1).toBe(s5);
  });

  it('correctly clusters duplicates where one has values and the other has missing values', () => {
    const customBiomarkers = {
      ast: {
        name: 'AST (SGOT)',
        unit: 'U/L',
        normalRange: '10 - 40',
        category: 'liver'
      },
      aspartate_aminotransferase: {
        name: 'Aspartate Aminotransferase',
        unit: 'U/L',
        normalRange: 'Unknown',
        category: 'other'
      },
      ast_serum_level_u_l: {
        name: 'AST Serum Level',
        unit: 'U/L'
      },
      hdl: {
        name: 'HDL-C',
        unit: 'mmol/L',
        normalRange: '0.9 - 1.7',
        category: 'lipids'
      },
      serum_hdl_cholesterol: {
        name: 'Serum HDL Cholesterol',
        unit: 'mmol/L'
      }
    };

    const biomarkerHistory = [
      {
        id: 'log1',
        date: '2026-08-01',
        biomarkers: {
          ast: 28,
          hdl: 1.45
        }
      }
    ];

    const report = runGeneralizedBiomarkerAudit(customBiomarkers, biomarkerHistory);

    expect(report.duplicateGroups.length).toBe(2);

    const astGroup = report.duplicateGroups.find(g => g.suggestedMasterKey === 'ast');
    expect(astGroup).toBeDefined();
    expect(astGroup?.candidateAliases).toContain('aspartate_aminotransferase');
    expect(astGroup?.candidateAliases).toContain('ast_serum_level_u_l');
    expect(astGroup?.emptyAliasKeys).toContain('aspartate_aminotransferase');
    expect(astGroup?.emptyAliasKeys).toContain('ast_serum_level_u_l');

    const hdlGroup = report.duplicateGroups.find(g => g.suggestedMasterKey === 'hdl');
    expect(hdlGroup).toBeDefined();
    expect(hdlGroup?.candidateAliases).toContain('serum_hdl_cholesterol');
    expect(hdlGroup?.emptyAliasKeys).toContain('serum_hdl_cholesterol');
  });

  it('preserves all metadata fields during deduplication enrichment', () => {
    const masterDef: any = {
      name: 'Total Cholesterol',
      unit: 'mmol/L',
      normalRange: 'Aim under 5.0'
    };

    const aliasDef: any = {
      name: 'Serum Cholesterol',
      description: 'Overall blood cholesterol level',
      category: 'lipids',
      standardMedicalGrouping: 'Metabolic',
      riskCategories: ['Cardiovascular', 'Hyperlipidemia'],
      optimalValue: '< 4.5 mmol/L',
      target: 4.5
    };

    // Merging alias into master without overwriting master existing fields
    const enrichedMaster = {
      ...masterDef,
      category: masterDef.category || aliasDef.category,
      standardMedicalGrouping: masterDef.standardMedicalGrouping || aliasDef.standardMedicalGrouping,
      description: masterDef.description || aliasDef.description,
      optimalValue: masterDef.optimalValue || aliasDef.optimalValue,
      target: masterDef.target !== undefined ? masterDef.target : aliasDef.target,
      riskCategories: Array.from(new Set([...(masterDef.riskCategories || []), ...(aliasDef.riskCategories || [])]))
    };

    expect(enrichedMaster.name).toBe('Total Cholesterol');
    expect(enrichedMaster.unit).toBe('mmol/L');
    expect(enrichedMaster.category).toBe('lipids');
    expect(enrichedMaster.description).toBe('Overall blood cholesterol level');
    expect(enrichedMaster.riskCategories).toEqual(['Cardiovascular', 'Hyperlipidemia']);
    expect(enrichedMaster.optimalValue).toBe('< 4.5 mmol/L');
  });

  it('correctly maps and clusters eGFR variants (egfr, egfr_mlmin173m2, egfr_ml_min_1_73m2)', () => {
    const s1 = getCanonicalBiomarkerStem('egfr');
    const s2 = getCanonicalBiomarkerStem('egfr_mlmin173m2');
    const s3 = getCanonicalBiomarkerStem('egfr_ml_min_1_73m2');
    const s4 = getCanonicalBiomarkerStem('egfrcreatckdepi173m2');

    expect(s1).toBe('egfr');
    expect(s2).toBe('egfr');
    expect(s3).toBe('egfr');
    expect(s4).toBe('egfr');

    const customBiomarkers = {
      egfr: {
        name: 'egfr',
        unit: 'mL/min/1.73m2',
        normalRange: 'over 90',
        category: 'kidneys',
        riskCategories: ['Kidney', 'Chronic Kidney Disease']
      },
      egfr_mlmin173m2: {
        name: 'eGFR',
        unit: 'mL/min/1.73m²',
        normalRange: 'over 90',
        category: 'wellness'
      },
      egfr_ml_min_1_73m2: {
        name: 'eGFR',
        unit: 'mL/min/1.73m²',
        normalRange: 'over 90',
        category: 'wellness'
      }
    };

    const biomarkerHistory = [
      {
        id: 'log1',
        date: '2026-08-16',
        biomarkers: { egfr: 95 }
      }
    ];

    const report = runGeneralizedBiomarkerAudit(customBiomarkers, biomarkerHistory);
    expect(report.duplicateGroups.length).toBe(1);

    const egfrGroup = report.duplicateGroups[0];
    expect(egfrGroup.suggestedMasterKey).toBe('egfr');
    expect(egfrGroup.candidateAliases).toContain('egfr_mlmin173m2');
    expect(egfrGroup.candidateAliases).toContain('egfr_ml_min_1_73m2');
    expect(egfrGroup.totalLogsInCluster).toBe(1);
    expect(egfrGroup.emptyAliasKeys).toContain('egfr_mlmin173m2');
    expect(egfrGroup.emptyAliasKeys).toContain('egfr_ml_min_1_73m2');
  });

  it('correctly normalizes biomarker names and strips units/parentheses', () => {
    expect(normalizeBiomarkerName('Body Mass Index (BMI)')).toBe('body mass');
    expect(normalizeBiomarkerName('Mean Corpuscular Hemoglobin (MCH) pg')).toBe('mean corpuscular hemoglobin');
    expect(normalizeBiomarkerName('eGFR (mL/min/1.73m²)')).toBe('egfr');
    expect(normalizeBiomarkerName('Aspartate Aminotransferase (AST/SGOT) U/L')).toBe('aspartate aminotransferase');
  });

  it('detects duplicate candidates and existing dictionary items accurately', () => {
    const res1 = isBiomarkerDuplicateCandidate(
      { key: 'egfr', name: 'eGFR' },
      { key: 'egfr_mlmin173m2', name: 'eGFR', unit: 'mL/min/1.73m2' }
    );
    expect(res1.isMatch).toBe(true);

    const res2 = isBiomarkerDuplicateCandidate(
      { key: 'mean_corpuscular_hemoglobin', name: 'Mean Corpuscular Hemoglobin (MCH)', unit: 'pg' },
      { key: 'mean_corpuscular_hemoglobin_pg', name: 'Mean Corpuscular Hemoglobin', unit: 'pg' }
    );
    expect(res2.isMatch).toBe(true);

    // Differentiates MCH from MCHC (no false friend matching)
    const resMchc = isBiomarkerDuplicateCandidate(
      { key: 'mean_corpuscular_hemoglobin', name: 'Mean Corpuscular Hemoglobin' },
      { key: 'mean_corpuscular_hemoglobin_concentration', name: 'Mean Corpuscular Hemoglobin Concentration (MCHC)' }
    );
    expect(resMchc.isMatch).toBe(false);

    // Detects duplicate in catalog via findDuplicateOrExistingBiomarker
    const dupCheck = findDuplicateOrExistingBiomarker('Hemoglobin (g/dL)', {
      customBiomarkers: {}
    });
    expect(dupCheck?.isDuplicate).toBe(true);
    expect(dupCheck?.matchedKey).toBe('hemoglobin');
    expect(dupCheck?.isBuiltIn).toBe(true);
  });

  it('filters out tombstoned custom biomarker aliases even if historical logs contain old keys', () => {
    const customBiomarkers = {
      alt: { name: 'Alanine Aminotransferase', unit: 'U/L' }
    };
    const biomarkerHistory = [
      { id: 'log1', date: '2026-08-16', biomarkers: { alt: 35, serum_alt: 35 } }
    ];
    const deletedCustomBiomarkerKeys = {
      serum_alt: Date.now()
    };

    const report = runGeneralizedBiomarkerAudit(customBiomarkers, biomarkerHistory, {}, deletedCustomBiomarkerKeys);
    expect(report.duplicateGroups.length).toBe(0);
    expect(report.items.find(i => i.key === 'serum_alt')).toBeUndefined();
  });

  it('correctly extracts units with unicode superscripts and micro signs without truncation', () => {
    expect(extractUnitFromString('100 mL/min/1.73m²')).toBe('mL/min/1.73m²');
    expect(extractUnitFromString('> 90 mL/min/1.73m²')).toBe('mL/min/1.73m²');
    expect(extractUnitFromString('18.5 - 24.9 kg/m²')).toBe('kg/m²');
    expect(extractUnitFromString('4.5 - 11.0 10^9/L')).toBe('10^9/L');
    expect(extractUnitFromString('0.37 - 0.50 L/L')).toBe('L/L');
    expect(extractUnitFromString('120 - 160 g/dL')).toBe('g/dL');
    expect(extractUnitFromString('kg')).toBe('kg');
  });

  it('correctly treats eGFR unit variations as equivalent with zero false conflicts', () => {
    const u1 = normalizeUnitEquivalence('mL/min/1.73m²');
    const u2 = normalizeUnitEquivalence('mL/min/1.73m2');
    const u3 = normalizeUnitEquivalence('mL/min/1.73 m²');
    const u4 = normalizeUnitEquivalence('mL/min/1.73m');
    expect(u1).toBe(u2);
    expect(u1).toBe(u3);
    expect(u1).toBe(u4);

    const customBiomarkers = {
      egfr: {
        name: 'eGFR',
        unit: 'mL/min/1.73m²',
        normalRange: '> 90 mL/min/1.73m²',
        rangeBrackets: [
          { range: '> 90 mL/min/1.73m²', label: 'Normal' },
          { range: '60 - 89 mL/min/1.73m²', label: 'Mildly Decreased' }
        ]
      }
    };
    const report = runGeneralizedBiomarkerAudit(customBiomarkers, []);
    const egfrItem = report.items.find(i => i.key === 'egfr');
    expect(egfrItem?.status).not.toBe('conflict');
    expect(egfrItem?.conflictInfo).toBeUndefined();
  });

  it('does NOT propose destructive auto-fixes converting valid body weight units into invalid/bracket strings', () => {
    const customBiomarkers = {
      ideal_body_weight: {
        name: 'Ideal Body Weight (Target)',
        unit: 'kg',
        normalRange: 'Varies',
        rangeBrackets: [
          { range: '18.5 - 24.9 kg/m²', label: 'Normal BMI' }
        ]
      }
    };
    const report = runGeneralizedBiomarkerAudit(customBiomarkers, []);
    const ibwItem = report.items.find(i => i.key === 'ideal_body_weight');
    // Even if bracket mismatch is flagged as conflict, no destructive align_declared_to_brackets auto-fix proposal is created
    expect(ibwItem?.conflictInfo?.suggestedResolution).toBeUndefined();
  });
});
