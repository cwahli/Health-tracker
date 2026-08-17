import { describe, it, expect } from 'vitest';
import {
  applyModificationCommands,
  enrichReviewModificationCommands,
  buildReviewCommandsFromHistory,
  sanitizeReviewReply,
  convertViaTable,
  handleUnitChange,
  overlayAgeBand,
  overlayFingerprint,
  shouldRunCalibrator,
  getRangeVariesBy,
  resolveAgentDestination,
  filterHistoryForUse,
  filterCurrentForUse,
  formatBiomarkersForPrompt,
  attachObservationMeta,
  getObservationUnit,
  cleanupInventedBiomarkerCatalog,
  isLiveForUse,
  getBiomarkerRangeSourceInfo,
  recalibrateProfileOverlays,
  lexTable,
  buildIngestBatch,
  shouldAbortTablePath,
  leftoverTextFromTrace,
  mergeStagedExtract,
  parseResultCell,
  parsePrintedDate,
  resolveKnownBiomarkerKey,
} from './biomarkerLifecycle';
import { isValEmpty, sanitizeBiomarkerHistoryOnLoad } from './biomarkers';

describe('convertViaTable', () => {
  it('converts HDL mg/dL → mmol/L', () => {
    const r = convertViaTable('hdl', 50, 'mg/dL', 'mmol/L');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeCloseTo(1.293, 2);
  });
  it('refuses unknown analyte', () => {
    const r = convertViaTable('made_up_marker', 10, 'mg/dL', 'mmol/L');
    expect(r.ok).toBe(false);
  });
  it('refuses incomparable units', () => {
    const r = convertViaTable('hdl', 50, 'mg/dL', 'umol/L');
    expect(r.ok).toBe(false);
  });
});

describe('buildReviewCommandsFromHistory', () => {
  const history = [
    { date: '14-08-2026', biomarkers: { hdl: 50, triglycerides: 125, ldl: 130, creatinine: 0.9, total_bilirubin: 0.8 } },
    { date: '02-08-2026', biomarkers: { hdl: 1.43, triglycerides: 1.07, ldl: 4.2, creatinine: 100, total_bilirubin: 16 } },
    { date: '05-06-2026', biomarkers: { hdl: 1.43, triglycerides: 1.07, ldl: 4.2, creatinine: 100, total_bilirubin: 16 } },
    { date: '03-04-2024', biomarkers: { hdl: 1.43, triglycerides: 1.07, creatinine: 72, total_bilirubin: 13 } },
  ];

  it('synthesizes SI convert commands when Review omits modificationCommand', () => {
    const cmds = enrichReviewModificationCommands([], history, {
      hdl: 'mmol/L',
      triglycerides: 'mmol/L',
      ldl: 'mmol/L',
      creatinine: 'umol/L',
      total_bilirubin: 'umol/L',
    });
    const byKey = Object.fromEntries(cmds.map((c) => [c.keyName, c]));
    expect(Number(byKey.hdl.newValue)).toBeCloseTo(1.293, 2);
    expect(Number(byKey.triglycerides.newValue)).toBeCloseTo(1.411, 2);
    expect(Number(byKey.ldl.newValue)).toBeCloseTo(3.362, 2);
    expect(Number(byKey.creatinine.newValue)).toBeCloseTo(79.56, 1);
    expect(Number(byKey.total_bilirubin.newValue)).toBeCloseTo(13.68, 1);
    expect(cmds.filter((c) => c.keyName === 'total_bilirubin')).toHaveLength(1);
    expect(cmds.every((c) => c.date === '14-08-2026')).toBe(true);
  });

  it('does not invent commands when history is already one scale', () => {
    const cmds = buildReviewCommandsFromHistory(
      [
        { date: '02-08-2026', biomarkers: { hdl: 1.43 } },
        { date: '05-06-2026', biomarkers: { hdl: 1.5 } },
      ],
      { hdl: 'mmol/L' }
    );
    expect(cmds).toHaveLength(0);
  });
});

describe('handleUnitChange (P6)', () => {
  it('relabels unit in profile/custom without modifying history values', () => {
    const profile = { customBiomarkers: { hdl: { name: 'HDL', unit: 'mg/dL' } } };
    const history = [{ id: '1', date: '2026-08-14', biomarkers: { hdl: 50 } }];

    const result = handleUnitChange({
      key: 'hdl',
      fromUnit: 'mg/dL',
      toUnit: 'mmol/L',
      mode: 'relabel',
      profile,
      history: history as any,
    });

    expect(result.convertedCount).toBe(0);
    expect(result.profile.customBiomarkers.hdl.unit).toBe('mmol/L');
    expect(result.history[0].biomarkers.hdl).toBe(50); // Untouched!
    expect(result.history[0].observationMeta).toBeUndefined();
  });

  it('converts history values with convertViaTable and populates observationMeta', () => {
    const profile = { customBiomarkers: { hdl: { name: 'HDL', unit: 'mg/dL' } } };
    const history = [{ id: '1', date: '2026-08-14', biomarkers: { hdl: 50 } }];

    const result = handleUnitChange({
      key: 'hdl',
      fromUnit: 'mg/dL',
      toUnit: 'mmol/L',
      mode: 'convert',
      profile,
      history: history as any,
    });

    expect(result.convertedCount).toBe(1);
    expect(result.profile.customBiomarkers.hdl.unit).toBe('mmol/L');
    expect(Number(result.history[0].biomarkers.hdl)).toBeCloseTo(1.293, 2);
    expect(result.history[0].observationMeta?.hdl?.rawValue).toBe(50);
    expect(result.history[0].observationMeta?.hdl?.rawUnit).toBe('mg/dL');
  });
});

describe('applyModificationCommands', () => {
  it('fills omitted newValue via convert table (HDL 50 mg/dL → mmol/L)', () => {
    const cmds = enrichReviewModificationCommands(
      [{ action: 'update_biomarker', keyName: 'hdl', date: '13-08-2026', oldValue: '50' }],
      [
        { date: '13-08-2026', biomarkers: { hdl: 50 } },
        { date: '02-08-2026', biomarkers: { hdl: 1.43 } },
      ],
      { hdl: 'mmol/L' }
    );
    expect(Number(cmds[0].newValue)).toBeCloseTo(1.293, 2);
  });

  it('updates a DD-MM-YYYY row from ISO command date', () => {
    const { history, applied } = applyModificationCommands(
      [{ id: '1', date: '13-08-2026', biomarkers: { hdl: 50 } }],
      [{ action: 'update_biomarker', keyName: 'hdl', date: '2026-08-13', newValue: '1.3' }]
    );
    expect(applied).toBe(1);
    expect(Number(history[0].biomarkers.hdl)).toBeCloseTo(1.3);
  });

  it('applies the five convert commands onto 14-08-2026 while older SI rows remain unchanged', () => {
    const history = [
      { id: '1', date: '14-08-2026', biomarkers: { hdl: 50, triglycerides: 125, ldl: 130, creatinine: 0.9, total_bilirubin: 0.8 } },
      { id: '2', date: '02-08-2026', biomarkers: { hdl: 1.43, triglycerides: 1.07, ldl: 4.2, creatinine: 100, total_bilirubin: 16 } },
      { id: '3', date: '05-06-2026', biomarkers: { hdl: 1.43, triglycerides: 1.07, ldl: 4.2, creatinine: 100, total_bilirubin: 16 } },
      { id: '4', date: '03-04-2024', biomarkers: { hdl: 1.43, triglycerides: 1.07, creatinine: 72, total_bilirubin: 13 } },
    ];
    const catalogUnits = {
      hdl: 'mmol/L',
      triglycerides: 'mmol/L',
      ldl: 'mmol/L',
      creatinine: 'umol/L',
      total_bilirubin: 'umol/L',
    };
    const { history: afterApply, applied } = applyModificationCommands(history as any, [], catalogUnits);
    expect(applied).toBe(5);

    // 14-08-2026 must be converted to exact locked SI values
    const log14 = afterApply.find((h) => h.date === '14-08-2026')!;
    expect(Number(log14.biomarkers.hdl)).toBeCloseTo(1.293, 2);
    expect(Number(log14.biomarkers.triglycerides)).toBeCloseTo(1.411, 2);
    expect(Number(log14.biomarkers.ldl)).toBeCloseTo(3.362, 2);
    expect(Number(log14.biomarkers.creatinine)).toBeCloseTo(79.56, 1);
    expect(Number(log14.biomarkers.total_bilirubin)).toBeCloseTo(13.68, 1);

    // rawValues must be captured on observationMeta
    expect(log14.observationMeta?.hdl?.rawValue).toBe(50);
    expect(log14.observationMeta?.triglycerides?.rawValue).toBe(125);
    expect(log14.observationMeta?.ldl?.rawValue).toBe(130);
    expect(log14.observationMeta?.creatinine?.rawValue).toBe(0.9);
    expect(log14.observationMeta?.total_bilirubin?.rawValue).toBe(0.8);

    // Older SI dates must remain unchanged
    const log02 = afterApply.find((h) => h.date === '02-08-2026')!;
    expect(log02.biomarkers).toEqual({ hdl: 1.43, triglycerides: 1.07, ldl: 4.2, creatinine: 100, total_bilirubin: 16 });

    const log05 = afterApply.find((h) => h.date === '05-06-2026')!;
    expect(log05.biomarkers).toEqual({ hdl: 1.43, triglycerides: 1.07, ldl: 4.2, creatinine: 100, total_bilirubin: 16 });

    const log03 = afterApply.find((h) => h.date === '03-04-2024')!;
    expect(log03.biomarkers.total_bilirubin).toBe(13);
    expect(log03.biomarkers.creatinine).toBe(72);
  });
});

describe('overlay fingerprint / calibrator gate', () => {
  it('bands age', () => {
    expect(overlayAgeBand(28)).toBe('20-29');
    expect(overlayAgeBand(30)).toBe('30-39');
  });
  it('skips sodium (no rangeVariesBy)', () => {
    expect(getRangeVariesBy('serum_sodium').length).toBe(0);
    expect(shouldRunCalibrator('serum_sodium', { age: 28, gender: 'Male', ethnicity: 'Chinese' })).toBe(false);
  });
  it('runs HDL when overlay fingerprint missing', () => {
    expect(shouldRunCalibrator('hdl', { age: 28, gender: 'Male', ethnicity: 'Chinese' })).toBe(true);
  });
  it('skips HDL when fingerprint matches', () => {
    const fp = overlayFingerprint({ age: 28, gender: 'Male', ethnicity: 'Chinese' });
    expect(shouldRunCalibrator('hdl', { age: 28, gender: 'Male', ethnicity: 'Chinese' }, { fingerprint: fp })).toBe(false);
  });
  it('runs calibrator for 25-yo female, skips on rerun with stored overlay, runs again when age changes to 55', () => {
    const profile25 = { age: 25, gender: 'Female', ethnicity: 'Asian' };
    expect(shouldRunCalibrator('hdl', profile25, null)).toBe(true);

    const overlay = {
      fingerprint: overlayFingerprint(profile25),
      sameAsCatalog: true,
      range: '> 1.3 mmol/L',
    };
    // Rerun with stored overlay: skipped
    expect(shouldRunCalibrator('hdl', profile25, overlay)).toBe(false);

    // Change age to 55: fingerprint changes from 20-29|f|asian to 50-59|f|asian -> runs again
    const profile55 = { age: 55, gender: 'Female', ethnicity: 'Asian' };
    expect(shouldRunCalibrator('hdl', profile55, overlay)).toBe(true);
  });

  it('recalibrates profile overlays when demographic fingerprint shifts', () => {
    const profile25 = {
      age: 25,
      gender: 'Female',
      ethnicity: 'Asian',
      customBiomarkers: {
        hdl: { name: 'HDL Cholesterol', normalRange: '> 1.3 mmol/L' },
        serum_sodium: { name: 'Serum Sodium', normalRange: '135 - 145 mmol/L' },
      },
    };
    const res = recalibrateProfileOverlays(profile25, ['hdl', 'serum_sodium']);
    expect(res.recalibratedCount).toBe(1);
    expect(res.updatedCustomBiomarkers.hdl.overlayFingerprint).toBe('20-29|f|asian');
  });

  it('correctly attributes reference range sources (catalog, lab report, demographic, custom)', () => {
    const def = { normalRange: '135 - 145', unit: 'mmol/L' };
    
    // 1. Standard Catalog
    const s1 = getBiomarkerRangeSourceInfo('serum_sodium', def, null, null, null);
    expect(s1.sourceKind).toBe('catalog');
    expect(s1.sourceLabel).toBe('Standard Clinical');

    // 2. Lab Specific Printed Range
    const logWithPrinted = { observationMeta: { serum_sodium: { printedRange: '133 - 146' } } };
    const s2 = getBiomarkerRangeSourceInfo('serum_sodium', def, null, logWithPrinted, null);
    expect(s2.sourceKind).toBe('lab_report');
    expect(s2.sourceRange).toBe('133 - 146');

    // 3. Demographic Calibrated Range
    const s3 = getBiomarkerRangeSourceInfo('hdl', { normalRange: '> 1.0', unit: 'mmol/L' }, null, null, { profileAdjustedNormalRange: '> 1.3 mmol/L' });
    expect(s3.sourceKind).toBe('demographic');
    expect(s3.sourceRange).toBe('> 1.3 mmol/L');

    // 4. Custom User Override
    const customProfile = { customBiomarkers: { serum_sodium: { normalRange: '130 - 150' } } };
    const s4 = getBiomarkerRangeSourceInfo('serum_sodium', def, customProfile, null, null);
    expect(s4.sourceKind).toBe('custom');
    expect(s4.sourceLabel).toBe('User Custom Range');
  });
});

describe('filter live for use', () => {
  it('drops pending custom keys from history', () => {
    const profile = {
      customBiomarkers: { mystery: { needsApproval: true, name: 'Mystery', unit: 'u', normalRange: '1-2' } },
    };
    const history = [{ id: '1', date: '2026-08-13', biomarkers: { mystery: 3, hba1c: 35 } }];
    const filtered = filterHistoryForUse(history, profile);
    expect(filtered[0].biomarkers.mystery).toBeUndefined();
    expect(filtered[0].biomarkers.hba1c).toBe(35);
  });

  it('drops 195 cholesterol from dietitian prompt context when flagged in history', () => {
    const profile = {};
    const history = [
      { id: 'l1', date: '08-08-2026', biomarkers: { total_cholesterol: 195, hdl: 1.3 } },
    ];
    const current = { total_cholesterol: 195, hdl: 1.3 };

    const filtered = filterCurrentForUse(current, profile, history);
    expect(filtered.total_cholesterol).toBeUndefined();
    expect(filtered.hdl).toBe(1.3);

    const promptContext = formatBiomarkersForPrompt(current, profile, history);
    expect(promptContext).not.toContain('195');
    expect(promptContext).toContain('"hdl":1.3');
  });
});

describe('attachObservationMeta', () => {
  it('stores raw unit on the log', () => {
    const log: any = { id: '1', date: '2026-08-13', biomarkers: { hdl: 50 } };
    attachObservationMeta(log, 'hdl', { unit: 'mg/dL', rawValue: 50 });
    expect(getObservationUnit(log, 'hdl')).toBe('mg/dL');
  });
});

describe('resolveAgentDestination', () => {
  it('folds retired agents onto owners', () => {
    expect(resolveAgentDestination('agent5')).toBe('data_review');
    expect(resolveAgentDestination('medical_extract')).toBe('agent1');
    expect(resolveAgentDestination('biomarker_review')).toBe('biomarker_review');
  });

  it('routes data_accuracy to comparison modal payload', () => {
    const route = resolveAgentDestination('data_accuracy', { comparisonRows: [{ key: 'hdl', val1: 50, val2: 1.3 }] });
    expect(typeof route).toBe('object');
    expect((route as any).destination).toBe('comparison_modal');
    expect((route as any).requiresApproval).toBe(true);
    expect((route as any).payload.comparisonRows).toHaveLength(1);
  });

  it('routes biomarker_review with proposal.range to customRanges proposal (NOT silent write)', () => {
    const route = resolveAgentDestination('biomarker_review', {
      biomarkerKey: 'hdl',
      proposal: { range: '1.0 - 2.0 mmol/L' }
    });
    expect(typeof route).toBe('object');
    expect((route as any).destination).toBe('custom_ranges_proposal');
    expect((route as any).requiresApproval).toBe(true);
    expect((route as any).silentWrite).toBe(false);
    expect((route as any).targetKey).toBe('hdl');
  });

  it('routes name_consolidation to remap proposal', () => {
    const route = resolveAgentDestination('name_consolidation', {
      proposal: { from: 'Total Chol', to: 'total_cholesterol' }
    });
    expect(typeof route).toBe('object');
    expect((route as any).destination).toBe('name_remap_proposal');
    expect((route as any).requiresApproval).toBe(true);
  });
});

describe('isValEmpty', () => {
  it('treats 0 and 0.0 as real values', () => {
    expect(isValEmpty(0)).toBe(false);
    expect(isValEmpty('0')).toBe(false);
    expect(isValEmpty(0.0)).toBe(false);
  });
  it('treats blank, null, undefined, and NaN as empty', () => {
    expect(isValEmpty('')).toBe(true);
    expect(isValEmpty('   ')).toBe(true);
    expect(isValEmpty(null)).toBe(true);
    expect(isValEmpty(undefined)).toBe(true);
    expect(isValEmpty(NaN)).toBe(true);
  });
});

describe('sanitizeReviewReply & review command enrichment', () => {
  it('corrects hallucinated newValue (16 -> 13.68) and bad reason for bilirubin 0.8', () => {
    const history = [
      { id: '1', date: '08-08-2026', biomarkers: { total_bilirubin: 0.8 } },
      { id: '2', date: '02-08-2026', biomarkers: { total_bilirubin: 16 } },
      { id: '3', date: '05-06-2026', biomarkers: { total_bilirubin: 14 } },
    ];
    const catalogUnits = { total_bilirubin: 'umol/L' };
    const hallucinatedCmds = [
      {
        action: 'update_biomarker' as const,
        keyName: 'total_bilirubin',
        date: '08-08-2026',
        oldValue: 0.8,
        newValue: 16,
        reason: 'Data entry scaling error: decimal point misplaced compared to historical logs',
      },
    ];

    const enriched = enrichReviewModificationCommands(hallucinatedCmds, history, catalogUnits);
    expect(enriched[0].newValue).toBeCloseTo(13.68, 1);
    expect(enriched[0].reason).toContain('Unit conversion: 0.8 mg/dl');
    expect(enriched[0].reason).not.toContain('misplaced');
  });

  it('sanitizes reply text containing hallucinated 0.8 -> 16 and decimal placement shift phrases', () => {
    const cmds = [
      {
        action: 'update_biomarker' as const,
        keyName: 'total_bilirubin',
        date: '08-08-2026',
        oldValue: 0.8,
        newValue: 13.68,
        reason: 'Unit conversion: 0.8 mg/dl → 13.68 umol/l',
      },
    ];
    const rawReply =
      '1) Error: log on 08-08-2026 has Total Bilirubin recorded as 0.8 umol/L.\n2) Summary: 08-08-2026: 0.8 -> 16\n3) Basis: decimal placement shift (dividing by 20 or dropping a digit).';

    const clean = sanitizeReviewReply(rawReply, cmds);
    expect(clean.toLowerCase()).toContain('0.8 mg/dl → 13.68 umol/l');
    expect(clean).not.toContain('0.8 -> 16');
    expect(clean).not.toContain('decimal placement shift');
    expect(clean).toContain('unit conversion using standard clinical factor');
  });
});

describe('sanitizeBiomarkerHistoryOnLoad — flag only', () => {
  it('does not rewrite 195 cholesterol', () => {
    const history = [
      { id: '1', date: '08-08-2026', biomarkers: { total_cholesterol: 195 } },
      { id: '2', date: '02-08-2026', biomarkers: { total_cholesterol: 6.1 } },
    ];
    const { history: cleaned, current, fixedCount } = sanitizeBiomarkerHistoryOnLoad(history, {});
    expect(Number(cleaned[0].biomarkers.total_cholesterol)).toBe(195);
    expect(Number(current.total_cholesterol)).toBe(195);
    expect(fixedCount).toBeGreaterThan(0);
  });
});

describe('cleanupInventedBiomarkerCatalog (7.1 Profile Data Cleanup)', () => {
  it('remaps alias slugs, drops metric_N with no history, and strips negative < 0 ranges', () => {
    const profile = {
      customBiomarkers: {
        serum_total_cholesterol: { name: 'Serum Total Cholesterol', unit: 'mmol/L' },
        metric_12: { name: 'metric 12', unit: '' },
        unapproved_marker: { name: 'Unapproved Marker', needsApproval: true },
        corrupted_range_marker: { name: 'Corrupted', unit: 'U/L', normalRange: '< 0 U/L' },
      },
      customRanges: {
        bad_range: { range: '< 0 U/L' },
        empty_range: {},
        valid_range: { range: '1.0 - 2.0' },
      },
      pendingObservations: [
        { printedName: 'Unknown Marker', date: '2026-08-16', rawValue: 42, rawUnit: 'mg/dL' }
      ]
    };

    const res = cleanupInventedBiomarkerCatalog(profile, []);
    expect(res.remappedKeys['serum_total_cholesterol']).toBe('total_cholesterol');
    expect(res.droppedKeys).toContain('metric_12');
    expect(res.droppedKeys).toContain('unapproved_marker');
    expect(res.strippedRanges).toContain('bad_range');
    expect(res.strippedRanges).toContain('empty_range');
    expect(res.profile.customRanges['valid_range']).toBeDefined();
    expect(res.profile.customBiomarkers['corrupted_range_marker']?.normalRange).toBeUndefined();
    expect(res.profile.pendingObservations).toHaveLength(1);
    expect(res.profile.pendingObservations[0].printedName).toBe('Unknown Marker');
  });
});

describe('Pending Store Isolation (7.4 Home Dashboard / Coach Query Guard)', () => {
  it('prevents pending observations from being live for use on Home or prompts', () => {
    const profile = {
      pendingObservations: [
        { suggestedKey: 'pending_enzyme', printedName: 'Pending Enzyme', date: '2026-08-16', rawValue: 120 }
      ]
    };
    const history = [
      { id: '1', date: '2026-08-16', biomarkers: { pending_enzyme: 120, hdl: 1.4 } }
    ];
    const current = { pending_enzyme: 120, hdl: 1.4 };

    expect(isLiveForUse('pending_enzyme', profile, history)).toBe(false);
    expect(isLiveForUse('hdl', profile, history)).toBe(true);

    const filteredHistory = filterHistoryForUse(history, profile);
    expect(filteredHistory[0].biomarkers.pending_enzyme).toBeUndefined();
    expect(filteredHistory[0].biomarkers.hdl).toBe(1.4);

    const filteredCurrent = filterCurrentForUse(current, profile, history);
    expect(filteredCurrent.pending_enzyme).toBeUndefined();
    expect(filteredCurrent.hdl).toBe(1.4);
  });
});

describe('attachObservationMeta (7.3 Historical observationMeta backfill)', () => {
  it('backfills rawValue from biomarkers[key] when rawValue is omitted in meta', () => {
    const log: any = { date: '2026-08-16', biomarkers: { creatinine: 88 } };
    attachObservationMeta(log, 'creatinine', { unit: 'umol/L', printedRange: '60 - 110' });
    expect(log.observationMeta.creatinine.rawUnit).toBe('umol/L');
    expect(log.observationMeta.creatinine.printedRange).toBe('60 - 110');
    expect(log.observationMeta.creatinine.rawValue).toBe(88);
  });
});

describe('recalibrateProfileOverlays (7.5 Silent Calibrator)', () => {
  it('updates overlayFingerprint when demographic profile changes', () => {
    const profile = {
      age: 45,
      gender: 'female',
      ethnicity: 'asian',
      customBiomarkers: {
        creatinine: { name: 'Creatinine', overlayFingerprint: '20-29|m|default' }
      }
    };

    const res = recalibrateProfileOverlays(profile, ['creatinine']);
    expect(res.recalibratedCount).toBe(1);
    expect(res.updatedCustomBiomarkers.creatinine.overlayFingerprint).toBe('40-49|f|asian');
  });
});

describe('Layer-1 EMIS / NHS table ingest', () => {
  const emisOneLine = [
    '"Date","Test Name","Result","Normal Range","Comment"',
    '"09-Jun-2026","Sample site","","","(AlyssaFRS) - 01. Satisfactory - No Action Urine"',
    '"09-Jun-2026","Chlamydia DNA detection","","","NEGATIVE"',
    '"05-Jun-2026","HbA1c levl - IFCC standardised","40 mmol/mol","20 - 41 mmol/mol",""',
    '"05-Jun-2026","Renal profile","","","(OlaFRS) - 01. Satisfactory - No Action"',
    '"05-Jun-2026","Serum sodium","143 mmol/L","133 - 146 mmol/L",""',
    '"05-Jun-2026","Serum creatinine","100 umol/L","64 - 104 umol/L",""',
    '"05-Jun-2026","Serum HDL cholesterol level","1.5 mmol/L","0.9 - 1.7 mmol/L",""',
    '"03-Jun-2026","Serum triglycerides","1.7 mmol/L","- mmol/L","."',
    '"03-Jun-2026","Calculated LDL cholesterol lev","4.3 mmol/L","- mmol/L",""',
  ].join(' ');

  it('splits concatenated quoted EMIS records that have no newlines', () => {
    expect(emisOneLine.includes('\n')).toBe(false);
    const rows = lexTable(emisOneLine);
    expect(rows.length).toBeGreaterThanOrEqual(9);
    expect(rows[0][0].toLowerCase()).toContain('date');
    expect(rows.some((r) => /serum sodium/i.test(r.join(' ')))).toBe(true);
  });

  it('stages known SI rows and leaves unknown / qualitative names unmatched', () => {
    const trace = buildIngestBatch(lexTable(emisOneLine), 'job_emis_oneline');
    expect(shouldAbortTablePath(trace)).toBe(false);
    expect(trace.highConfidenceCount).toBeGreaterThanOrEqual(3);
    const hba1c = trace.rows?.find((r) => r.canonicalKey === 'hba1c');
    expect(hba1c?.bucket).toBe('high_confidence');
    expect(hba1c?.rawValue).toBe(40);
    expect(hba1c?.date).toBe('2026-06-05');
    const sodium = trace.rows?.find((r) => r.canonicalKey === 'serum_sodium');
    expect(sodium?.bucket).toBe('high_confidence');
    expect(sodium?.rawValue).toBe(143);
    const creat = trace.rows?.find((r) => r.canonicalKey === 'creatinine');
    expect(creat?.bucket).toBe('high_confidence');
    expect(creat?.rawValue).toBe(100);
    const tg = trace.rows?.find((r) => r.canonicalKey === 'triglycerides');
    expect(tg?.bucket).toBe('flagged');
    expect(tg?.class).toBe('CONFORMANCE_UNIT');
    const ldl = trace.rows?.find((r) => r.canonicalKey === 'ldl');
    expect(ldl?.bucket).toBe('flagged');
    expect(trace.rows?.some((r) => r.bucket === 'skip' && /renal profile/i.test(r.printedName || ''))).toBe(true);
    const leftover = leftoverTextFromTrace(trace);
    expect(leftover).toMatch(/Chlamydia|Sample site/i);
    expect(leftover).not.toMatch(/Serum sodium/i);
  });

  it('mergeStagedExtract prepends Layer-1 rows so the parser table is not empty', () => {
    const trace = buildIngestBatch(lexTable(emisOneLine), 'job_merge');
    const merged = mergeStagedExtract({
      extractedData: [{ biomarker: 'chlamydia_dna_detection', date: '2026-06-09', qualitative_value: 'NEGATIVE' }],
      text: 'extracted leftovers',
    }, trace);
    expect(Array.isArray(merged.extractedData)).toBe(true);
    expect(merged.extractedData.length).toBeGreaterThan(3);
    expect(merged.extractedData.some((r: any) => r.biomarker === 'hba1c' && r.numeric_value === 40)).toBe(true);
  });

  it('parse helpers', () => {
    expect(parsePrintedDate('05-Jun-2026')).toBe('2026-06-05');
    expect(parseResultCell('143 mmol/L')).toEqual({ numeric: 143, unit: 'mmol/L', qualitative: null });
    expect(parseResultCell('NEGATIVE').qualitative).toMatch(/NEGATIVE/i);
    expect(resolveKnownBiomarkerKey('Sample site')).toBe('');
    expect(resolveKnownBiomarkerKey('Serum sodium')).toBe('serum_sodium');
  });
});


