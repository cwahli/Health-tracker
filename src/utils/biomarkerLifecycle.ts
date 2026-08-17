/**
 * Biomarker lifecycle helpers (plan/BIOMARKER_LIFECYCLE_PLAN.md).
 * Relabel vs convert, Review apply, overlay fingerprint, convert table.
 */
import { toYYYYMMDD } from './dateUtils';
import { getMappedBiomarkerKey, isBiomarkerApproved, detectFlaggedTelemetryErrors, biomarkerDefinitions, parseNormalRangeBounds, isBiomarkerValueImprobable } from './biomarkers';
import type { BiomarkerLog } from '../types';

export type UnitChangeMode = 'relabel' | 'convert';

export type RangeVariesBy = 'age' | 'sex' | 'ethnicity';

export interface ModificationCommand {
  action: 'update_biomarker' | 'update_profile' | 'remove_biomarker';
  keyName?: string;
  date?: string;
  newValue?: string | number;
  oldValue?: string | number;
  reason?: string;
}

/** Per-analyte SI conversion. Unknown pair → refuse (do not guess). */
export const ANALYTE_CONVERSIONS: Record<string, { from: string; to: string; multiply: number }> = {
  hdl: { from: 'mg/dl', to: 'mmol/l', multiply: 0.02586 },
  ldl: { from: 'mg/dl', to: 'mmol/l', multiply: 0.02586 },
  total_cholesterol: { from: 'mg/dl', to: 'mmol/l', multiply: 0.02586 },
  triglycerides: { from: 'mg/dl', to: 'mmol/l', multiply: 0.01129 },
  fasting_glucose: { from: 'mg/dl', to: 'mmol/l', multiply: 0.0555 },
  glucose: { from: 'mg/dl', to: 'mmol/l', multiply: 0.0555 },
  creatinine: { from: 'mg/dl', to: 'umol/l', multiply: 88.4 },
  total_bilirubin: { from: 'mg/dl', to: 'umol/l', multiply: 17.1 },
  bilirubin: { from: 'mg/dl', to: 'umol/l', multiply: 17.1 },
  hemoglobin: { from: 'g/dl', to: 'g/l', multiply: 10 },
  albumin: { from: 'g/dl', to: 'g/l', multiply: 10 },
};

const RANGE_VARIES_BY: Record<string, RangeVariesBy[]> = {
  bmi: ['ethnicity'],
  hdl: ['ethnicity', 'sex'],
  ldl: ['ethnicity'],
  triglycerides: ['ethnicity', 'sex'],
  total_cholesterol: ['ethnicity', 'sex'],
  egfr: ['age', 'sex'],
  creatinine: ['sex', 'age'],
  hemoglobin: ['sex'],
  hematocrit: ['sex'],
  ferritin: ['sex'],
  uric_acid: ['sex'],
  testosterone: ['sex', 'age'],
  estradiol: ['sex', 'age'],
  alkaline_phosphatase: ['age', 'sex'],
};

import type { IngestTrace, IngestTraceRow, ClassId } from '../types';

/** EMIS/NHS Web pastes often concatenate quoted CSV records with a space, not a newline. */
const QUOTED_DMY_RECORD = /"\s+"(?=\d{1,2}-[A-Za-z]{3}-\d{2,4}")/g;
const QUOTED_ISO_RECORD = /"\s+"(?=\d{4}-\d{2}-\d{2}")/g;
const PANEL_NAME_RE = /^(renal profile|liver function(?: test)?|bone profile|full blood count.*|fbc|serum lipids|lipid profile|point of care testing|urea and electrolytes|u(?:and|&)?e)$/i;
const HEADER_CELL_RE = /^(date|test name|result|normal range|comment|reference range|value|unit)$/i;
const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

export function normalizeLabTableText(text: string): string {
  if (!text) return '';
  return String(text)
    .replace(/^\uFEFF/, '')
    .replace(QUOTED_DMY_RECORD, '"\n"')
    .replace(QUOTED_ISO_RECORD, '"\n"');
}

function parseCsvLine(cleanLine: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < cleanLine.length; i++) {
    const char = cleanLine[i];
    if (char === '"') {
      if (inQuotes && cleanLine[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current.trim());
  return fields;
}

export function lexTable(text: string): string[][] {
  if (!text) return [];
  const lines = normalizeLabTableText(text).split(/\r?\n/).filter((l) => l.trim().length > 0);
  return lines.map((line) => {
    const cleanLine = line.trim();
    if (cleanLine.includes('\t')) return cleanLine.split('\t').map((c) => c.trim());
    if (cleanLine.includes('|')) return cleanLine.split('|').map((c) => c.trim()).filter(Boolean);
    if (cleanLine.includes(',')) return parseCsvLine(cleanLine);
    return cleanLine.split(/\s{2,}/).map((c) => c.trim());
  });
}

export function parsePrintedDate(raw: string): string | null {
  const s = String(raw || '').trim().replace(/^"|"$/g, '');
  const dmy = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (dmy) {
    const mm = MONTHS[dmy[2].toLowerCase()];
    if (!mm) return null;
    const year = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
    return `${year}-${mm}-${dmy[1].padStart(2, '0')}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

export function parseResultCell(raw: string): { numeric: number | null; unit: string; qualitative: string | null } {
  const s = String(raw || '').trim();
  if (!s) return { numeric: null, unit: '', qualitative: null };
  if (/^(negative|positive|trace|not detected|detected|nil|n\/a|na)$/i.test(s)) {
    return { numeric: null, unit: '', qualitative: s };
  }
  const bp = s.match(/^(\d+)\s*\/\s*(\d+)\s*(.*)$/);
  if (bp && /mmhg|mm\s*hg/i.test(bp[3] || 'mmHg')) {
    return { numeric: null, unit: (bp[3] || 'mmHg').trim() || 'mmHg', qualitative: `${bp[1]} / ${bp[2]}` };
  }
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*(.*)$/);
  if (m) return { numeric: parseFloat(m[1]), unit: (m[2] || '').trim(), qualitative: null };
  return { numeric: null, unit: '', qualitative: s };
}

/** True only when the name maps to a catalog/alias key, not a slug invented from the print name. */
export function resolveKnownBiomarkerKey(raw: string): string {
  if (!raw) return '';
  const mapped = getMappedBiomarkerKey(raw);
  if (!mapped) return '';
  if (biomarkerDefinitions.some((d) => d.key === mapped)) return mapped;
  const slug = raw.toLowerCase().replace(/[^a-z0-9_]/g, '');
  const slugNoUs = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (mapped === slug || mapped === slugNoUs) return '';
  return mapped;
}

export function buildIngestBatch(rows: string[][], jobId?: string): IngestTrace {
  const trace: IngestTrace = {
    version: 1,
    jobId,
    sourceKind: 'table',
    totalInputRows: rows.length,
    highConfidenceCount: 0,
    flaggedCount: 0,
    unmatchedCount: 0,
    skippedCount: 0,
    rows: [],
    handoff: {
      dualRawInjection: false,
      sentToParserCount: 0,
      sentToReviewCount: 0
    }
  };

  rows.forEach((row, idx) => {
    const cells = row.map((c) => String(c || '').trim());
    const rawRowString = cells.join(' ');
    const dateFromCol = parsePrintedDate(cells[0] || '');
    const headerish = cells.filter(Boolean).every((c) => HEADER_CELL_RE.test(c))
      || /^(page\s+\d+|lab\s+ref|patient\s+id|dob:|date\s+of\s+birth|test\s+name|reference\s+range|\*\*\*)/i.test(rawRowString.trim());
    const nameIdx = dateFromCol ? 1 : 0;
    const printedName = cells[nameIdx] || cells[0] || '';
    const isPanel = PANEL_NAME_RE.test(printedName) || (cells.length <= 2 && !/\d/.test(rawRowString));
    if (cells.filter(Boolean).length <= 1 || headerish || isPanel) {
      trace.skippedCount = (trace.skippedCount || 0) + 1;
      trace.rows!.push({
        sourceRowIndex: idx,
        bucket: 'skip',
        why: headerish ? 'Lab metadata / header line' : isPanel ? 'Panel / section header' : 'Too few columns',
        printedName,
        date: dateFromCol,
        comment: rawRowString,
      });
      return;
    }

    let rawValueStr = '';
    let rawUnit = '';
    let printedRange = '';
    let matchedKey = '';
    let qualitative: string | null = null;

    if (dateFromCol && cells.length >= 3) {
      printedName && (matchedKey = resolveKnownBiomarkerKey(printedName));
      const parsed = parseResultCell(cells[2] || '');
      rawValueStr = parsed.numeric != null ? String(parsed.numeric) : (cells[2] || '');
      rawUnit = parsed.unit;
      qualitative = parsed.qualitative;
      printedRange = cells[3] || '';
    } else {
      for (let i = 0; i < cells.length; i++) {
        const mapped = resolveKnownBiomarkerKey(cells[i]);
        if (mapped) {
          matchedKey = mapped;
          const parsed = parseResultCell(cells[i + 1] || '');
          if (parsed.numeric != null || parsed.qualitative) {
            rawValueStr = parsed.numeric != null ? String(parsed.numeric) : (cells[i + 1] || '');
            rawUnit = parsed.unit || cells[i + 2] || '';
            qualitative = parsed.qualitative;
          } else {
            rawValueStr = cells[i + 1] || '';
            rawUnit = cells[i + 2] || '';
          }
          break;
        }
      }
    }

    if (!matchedKey) {
      trace.unmatchedCount = (trace.unmatchedCount || 0) + 1;
      trace.rows!.push({
        sourceRowIndex: idx,
        bucket: 'unmatched',
        printedName,
        rawValue: cells[dateFromCol ? 2 : 1] || cells[1] || null,
        date: dateFromCol,
        printedRange,
        comment: cells.map((c) => `"${c.replace(/"/g, '""')}"`).join(','),
        class: 'COMPLETENESS',
      });
      return;
    }

    const valNum = parseFloat(rawValueStr);
    const catalogDef = biomarkerDefinitions.find((d) => d.key === matchedKey);
    const catalogUnit = catalogDef?.unit || '';

    let bucket: 'high_confidence' | 'flagged' | 'unmatched' = 'high_confidence';
    let classTag: string = 'IDENTITY_PARALLEL_KEY';
    let why = '';

    if (qualitative && isNaN(valNum)) {
      bucket = 'unmatched';
      classTag = 'COMPLETENESS';
      why = 'Qualitative result — leftover Parser';
    } else if (!isNaN(valNum)) {
      if (catalogUnit && rawUnit && !unitsCompatible(catalogUnit, rawUnit, matchedKey)) {
        const convertible = convertViaTable(matchedKey, valNum, rawUnit, catalogUnit);
        bucket = 'flagged';
        classTag = 'CONFORMANCE_UNIT';
        why = convertible.ok
          ? `Unit mismatch: ${rawUnit} vs catalog ${catalogUnit}`
          : `Unknown unit pair ${rawUnit} → ${catalogUnit}`;
      } else if (isBiomarkerValueImprobable(matchedKey, valNum, catalogDef?.normalRange)) {
        bucket = 'flagged';
        classTag = 'PLAUSIBILITY';
        why = `Implausible value for ${matchedKey}`;
      }
    } else {
      bucket = 'unmatched';
      classTag = 'COMPLETENESS';
      why = 'No numeric result';
    }

    if (bucket === 'flagged') {
      trace.flaggedCount = (trace.flaggedCount || 0) + 1;
    } else if (bucket === 'high_confidence') {
      trace.highConfidenceCount = (trace.highConfidenceCount || 0) + 1;
    } else {
      trace.unmatchedCount = (trace.unmatchedCount || 0) + 1;
    }

    trace.rows!.push({
      sourceRowIndex: idx,
      printedName,
      rawValue: isNaN(valNum) ? (qualitative || rawValueStr) : valNum,
      rawUnit,
      canonicalKey: matchedKey,
      bucket,
      class: classTag as any,
      why: why || undefined,
      date: dateFromCol,
      qualitativeValue: qualitative || undefined,
      printedRange: printedRange || undefined,
      comment: bucket === 'unmatched' ? cells.map((c) => `"${c.replace(/"/g, '""')}"`).join(',') : (why || undefined),
    });
  });
  
  return trace;
}

export function shouldAbortTablePath(trace: any): boolean {
  if (!trace) return true;
  // If source kind is table/tabular but 0 high confidence rows were found, abort table path
  if (trace.sourceKind === 'table' && (trace.highConfidenceCount === 0 || !trace.highConfidenceCount)) {
    return true;
  }
  // Abort if shape conformance is invalid (all unmatched)
  if (trace.unmatchedCount > 0 && (trace.highConfidenceCount || 0) === 0) {
    return true;
  }
  return false;
}

export function unitsCompatible(fromUnit: string, toUnit: string, key?: string): boolean {
  const a = normUnit(fromUnit);
  const b = normUnit(toUnit);
  if (!a || !b) return !a && !b;
  if (a === b) return true;
  const aliases: Record<string, string> = {
    '10*9/l': '10^9/l',
    '10e9/l': '10^9/l',
    'x10^9/l': '10^9/l',
    '10*12/l': '10^12/l',
    '10e12/l': '10^12/l',
    'ml/min/1.73m2': 'ml/min/1.73m²',
    'ml/min/1.73m*2': 'ml/min/1.73m²',
    'u/l': 'iu/l',
  };
  if ((aliases[a] || a) === (aliases[b] || b)) return true;
  return false;
}

export function leftoverTextFromTrace(trace: IngestTrace): string {
  const rows = (trace.rows || []).filter((r) => r.bucket === 'unmatched');
  if (!rows.length) return '';
  const header = '"Date","Test Name","Result","Normal Range","Comment"';
  const body = rows.map((r) => {
    if (r.comment && r.comment.includes(',')) return r.comment;
    const result = r.qualitativeValue
      || (r.rawValue != null ? `${r.rawValue}${r.rawUnit ? ' ' + r.rawUnit : ''}` : '');
    return [r.date || '', r.printedName || '', result, r.printedRange || '', '']
      .map((c) => `"${String(c).replace(/"/g, '""')}"`)
      .join(',');
  });
  return [header, ...body].join('\n');
}

export function stagedRowsToExtractedData(trace: IngestTrace): any[] {
  return (trace.rows || [])
    .filter((r) => r.bucket === 'high_confidence' || r.bucket === 'flagged')
    .map((r) => ({
      biomarker: r.canonicalKey,
      display_name: r.printedName || null,
      date: r.date || null,
      numeric_value: typeof r.rawValue === 'number' ? r.rawValue : null,
      qualitative_value: r.qualitativeValue || null,
      value: r.rawValue,
      unit: r.rawUnit || '',
      explanation: r.bucket === 'flagged' ? (r.why || r.comment || 'Flagged for review') : 'Layer-1 table match',
      printedRange: r.printedRange,
    }));
}

export function flaggedRowsToModificationCommands(trace: IngestTrace): any[] {
  return (trace.rows || [])
    .filter((r) => r.bucket === 'flagged' && r.canonicalKey)
    .map((r) => ({
      action: 'update_biomarker',
      keyName: r.canonicalKey,
      date: r.date || undefined,
      oldValue: r.rawValue,
      reason: r.why || r.comment || 'Flagged for review',
    }));
}

export function mergeStagedExtract(payload: any, trace?: IngestTrace | null): any {
  if (!trace || !trace.rows?.length) return payload;
  const staged = stagedRowsToExtractedData(trace);
  const llm = Array.isArray(payload?.extractedData) ? payload.extractedData : [];
  const seen = new Set(staged.map((s) => `${s.biomarker}|${s.date}|${s.numeric_value}`));
  const extra = llm.filter((item: any) => {
    const key = `${item.biomarker}|${item.date}|${item.numeric_value ?? item.value ?? ''}`;
    return !seen.has(key);
  });
  const cmds = [
    ...(Array.isArray(payload?.modificationCommand) ? payload.modificationCommand : []),
    ...flaggedRowsToModificationCommands(trace),
  ];
  const extractedData = [...staged, ...extra];
  return {
    ...payload,
    extractedData,
    hasMoreMarkers: extra.length ? !!payload?.hasMoreMarkers : false,
    estimatedTotalMarkers: extractedData.length,
    ingestTrace: payload?.ingestTrace || trace,
    modificationCommand: cmds.length ? cmds : payload?.modificationCommand,
    text: payload?.text && extra.length
      ? payload.text
      : `I matched ${staged.length} lab row${staged.length === 1 ? '' : 's'} automatically${extra.length ? ` and extracted ${extra.length} leftover name${extra.length === 1 ? '' : 's'}` : ''}. Review the table and Apply.`,
  };
}

export function getRangeVariesBy(key: string): RangeVariesBy[] {
  const mapped = getMappedBiomarkerKey(key) || key;
  return RANGE_VARIES_BY[mapped] || RANGE_VARIES_BY[key] || [];
}

function normUnit(u: string): string {
  return (u || '').toLowerCase().replace(/µ/g, 'u').replace(/\s+/g, '');
}

export function convertViaTable(
  key: string,
  value: number,
  fromUnit: string,
  toUnit: string
): { ok: true; value: number } | { ok: false; reason: string } {
  const mapped = getMappedBiomarkerKey(key) || key;
  const spec = ANALYTE_CONVERSIONS[mapped] || ANALYTE_CONVERSIONS[key];
  if (!spec) {
    return { ok: false, reason: `No conversion table for ${mapped}` };
  }
  const from = normUnit(fromUnit);
  const to = normUnit(toUnit);
  if (from === to) return { ok: true, value };
  if (from === spec.from && to === spec.to) {
    return { ok: true, value: Number((value * spec.multiply).toFixed(3)) };
  }
  if (from === spec.to && to === spec.from) {
    return { ok: true, value: Number((value / spec.multiply).toFixed(3)) };
  }
  if (mapped === 'hba1c') {
    // IFCC: mmol/mol = 10.93*% − 23.5
    if ((from === '%' || from === 'percent') && (to === 'mmol/mol' || to === 'mmolmol')) {
      return { ok: true, value: Math.round(10.93 * value - 23.5) };
    }
    if ((from === 'mmol/mol' || from === 'mmolmol') && (from !== to) && (to === '%' || to === 'percent')) {
      return { ok: true, value: Number(((value + 23.5) / 10.93).toFixed(1)) };
    }
  }
  return { ok: false, reason: `Incomparable units ${fromUnit} → ${toUnit} for ${mapped}` };
}

export interface HandleUnitChangeOpts {
  key: string;
  fromUnit: string;
  toUnit: string;
  mode: UnitChangeMode; // 'relabel' | 'convert'
  profile: any;
  history?: BiomarkerLog[];
  factor?: number; // optional custom factor
}

export interface HandleUnitChangeResult {
  profile: any;
  history: BiomarkerLog[];
  convertedCount: number;
}

/**
 * Handle unit changes with explicit relabel vs convert split (P6):
 * - mode='relabel': updates profile/custom unit string ONLY. History numbers NEVER change.
 * - mode='convert': applies convertViaTable (or custom factor) across matching history logs; records rawValue/rawUnit on observationMeta.
 */
export function handleUnitChange(opts: HandleUnitChangeOpts): HandleUnitChangeResult {
  const { key, fromUnit, toUnit, mode, profile, history = [], factor } = opts;
  const canonicalKey = getMappedBiomarkerKey(key) || key;

  // 1. Update catalog / profile custom unit
  const nextProfile = {
    ...profile,
    customBiomarkers: { ...(profile?.customBiomarkers || {}) },
  };
  const prevDef = nextProfile.customBiomarkers[canonicalKey] || {};
  nextProfile.customBiomarkers[canonicalKey] = {
    ...prevDef,
    unit: toUnit,
  };

  if (mode === 'relabel') {
    // Relabel: history numbers never change!
    return {
      profile: nextProfile,
      history: [...history],
      convertedCount: 0,
    };
  }

  // mode === 'convert': convert history numbers & record observationMeta
  let convertedCount = 0;
  const nextHistory = history.map((log) => {
    const rawVal = log.biomarkers?.[canonicalKey] ?? log.biomarkers?.[key];
    if (rawVal === undefined || rawVal === null || rawVal === '') {
      return log;
    }
    const num = typeof rawVal === 'number' ? rawVal : parseFloat(String(rawVal));
    if (isNaN(num)) return log;

    let convertedVal: number | null = null;
    if (typeof factor === 'number' && factor > 0) {
      convertedVal = Number((num * factor).toFixed(3));
    } else {
      const res = convertViaTable(canonicalKey, num, fromUnit, toUnit);
      if (res.ok) convertedVal = res.value;
    }

    if (convertedVal === null) return log;

    const nextBiomarkers = { ...log.biomarkers, [canonicalKey]: convertedVal };
    const nextMeta = log.observationMeta ? JSON.parse(JSON.stringify(log.observationMeta)) : {};
    if (!nextMeta[canonicalKey]) nextMeta[canonicalKey] = {};
    if (nextMeta[canonicalKey].rawValue === undefined) {
      nextMeta[canonicalKey].rawValue = num;
    }
    if (!nextMeta[canonicalKey].rawUnit) {
      nextMeta[canonicalKey].rawUnit = fromUnit;
    }

    convertedCount++;
    return {
      ...log,
      biomarkers: nextBiomarkers,
      observationMeta: nextMeta,
      sync_state: 'update' as const,
      updated_at: Date.now(),
    };
  });

  return {
    profile: nextProfile,
    history: nextHistory,
    convertedCount,
  };
}

export function datesMatch(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  return toYYYYMMDD(a) === toYYYYMMDD(b);
}

export function collectCatalogUnitMap(profile?: any): Record<string, string> {
  const map: Record<string, string> = {};
  (biomarkerDefinitions || []).forEach((d: any) => {
    if (d?.key && d?.unit) map[d.key] = d.unit;
  });
  Object.entries(profile?.customBiomarkers || {}).forEach(([k, v]: [string, any]) => {
    if (v?.unit) map[k] = v.unit;
  });
  return map;
}

/** Typical SI/canonical band after convert. Used to tell 13 µmol/L bilirubin from 0.8 mg/dL. */
const SI_VALUE_BAND: Record<string, [number, number]> = {
  hdl: [0.4, 4],
  ldl: [0.5, 8],
  total_cholesterol: [1, 12],
  triglycerides: [0.2, 8],
  fasting_glucose: [2, 20],
  glucose: [2, 20],
  creatinine: [20, 400],
  total_bilirubin: [2, 80],
  bilirubin: [2, 80],
  hemoglobin: [80, 220],
  albumin: [20, 60],
};

function inferConvSide(
  key: string,
  spec: { from: string; to: string; multiply: number },
  value: number,
  observedUnit?: string
): 'from' | 'to' | null {
  if (observedUnit) {
    const u = normUnit(observedUnit);
    if (u === spec.from) return 'from';
    if (u === spec.to) return 'to';
  }
  const band = SI_VALUE_BAND[key];
  if (band) {
    const [lo, hi] = band;
    if (value >= lo && value <= hi) return 'to';
    const conv = convertViaTable(key, value, spec.from, spec.to);
    if (conv.ok && conv.value >= lo && conv.value <= hi) return 'from';
    return null;
  }
  if (spec.multiply < 1) return value >= 15 ? 'from' : 'to';
  return value < 15 ? 'from' : 'to';
}

/**
 * When Review writes an essay and omits modificationCommand (common after schema
 * requires newValue), build convert commands from scale-shift history.
 */
export function buildReviewCommandsFromHistory(
  history: { date?: string; biomarkers?: Record<string, any>; observationMeta?: Record<string, { rawUnit?: string }> }[] = [],
  catalogUnitByKey: Record<string, string> = {}
): ModificationCommand[] {
  const byKey: Record<string, { date: string; value: number; rawKey: string; unit?: string }[]> = {};
  (history || []).forEach((h) => {
    if (!h?.date || !h.biomarkers) return;
    Object.entries(h.biomarkers).forEach(([rawKey, raw]) => {
      const n = typeof raw === 'number' ? raw : parseFloat(String(raw ?? ''));
      if (!Number.isFinite(n) || n <= 0) return;
      const key = getMappedBiomarkerKey(rawKey) || rawKey;
      if (!byKey[key]) byKey[key] = [];
      byKey[key].push({
        date: h.date,
        value: n,
        rawKey,
        unit: h.observationMeta?.[rawKey]?.rawUnit || h.observationMeta?.[key]?.rawUnit,
      });
    });
  });

  const cmds: ModificationCommand[] = [];
  Object.entries(byKey).forEach(([key, entries]) => {
    const spec = ANALYTE_CONVERSIONS[key];
    const catalog = normUnit(catalogUnitByKey[key] || '');
    const numVals = entries.map((e) => e.value);
    const sortedVals = [...numVals].sort((a, b) => a - b);
    const median = sortedVals[Math.floor(sortedVals.length / 2)] || 0;

    // 1. Registered Multi-Unit Molecular Conversions (e.g. US mg/dL <-> SI mmol/L or umol/L)
    if (spec) {
      const sides = entries.map((e) => inferConvSide(key, spec, e.value, e.unit));
      const fromCount = sides.filter((s) => s === 'from').length;
      const toCount = sides.filter((s) => s === 'to').length;

      if (entries.length >= 2 && fromCount > 0 && toCount > 0) {
        let target: 'from' | 'to' = toCount >= fromCount ? 'to' : 'from';
        if (catalog === spec.to) target = 'to';
        else if (catalog === spec.from && toCount < fromCount) target = 'from';

        const fromUnit = target === 'to' ? spec.from : spec.to;
        const toUnit = target === 'to' ? spec.to : spec.from;
        entries.forEach((e, i) => {
          if (!sides[i] || sides[i] === target) return;
          const conv = convertViaTable(key, e.value, fromUnit, toUnit);
          if (!conv.ok) return;
          cmds.push({
            action: 'update_biomarker',
            keyName: key,
            date: e.date,
            oldValue: e.value,
            newValue: conv.value,
            reason: `Unit scaling: ${e.value} ${fromUnit} → ${conv.value} ${toUnit} (table, not a clinical finding).`,
          });
        });
        return;
      }
    }

    // 2. Structural Percentage vs Decimal Ratio / Fraction Harmonization
    // Triggered when catalog unit is % or dominant historical cluster is percentage scale (median >= 5)
    const isPercentage = catalog === '%' || catalog.includes('percent') || (median >= 5 && sortedVals.filter(v => v >= 10).length >= sortedVals.length / 2);
    if (isPercentage) {
      entries.forEach((e) => {
        if (e.value <= 1.0 && e.value > 0) {
          // Decimal ratio e.g. 0.48 -> 48.0%
          const newV = parseFloat((e.value * 100).toFixed(1));
          cmds.push({
            action: 'update_biomarker',
            keyName: key,
            date: e.date,
            oldValue: e.value,
            newValue: newV,
            reason: `Scaling error: decimal ratio (${e.value}) calibrated to standard percentage (${newV} %).`,
          });
        } else if (e.value > 1.0 && e.value < 10.0 && median >= 25) {
          // Single-digit notation error (e.g. 3 or 5 entered instead of 30 or 50)
          const newV = parseFloat((e.value * 10).toFixed(1));
          cmds.push({
            action: 'update_biomarker',
            keyName: key,
            date: e.date,
            oldValue: e.value,
            newValue: newV,
            reason: `Scaling error: malformed notation (${e.value}) calibrated to standard percentage (${newV} %).`,
          });
        }
      });
      return;
    }

    // 3. Structural Fractional / Low-Concentration Harmonization
    // Triggered when catalog unit is a fraction/concentration (median < 1.0 and catalog is not %)
    const isFractionalScale = median > 0 && median < 1.0 && catalog !== '%';
    if (isFractionalScale) {
      entries.forEach((e) => {
        if (e.value >= 10.0) {
          // Percentage entered when decimal ratio expected (e.g. 48 -> 0.48)
          const newV = parseFloat((e.value / 100).toFixed(3));
          cmds.push({
            action: 'update_biomarker',
            keyName: key,
            date: e.date,
            oldValue: e.value,
            newValue: newV,
            reason: `Unit scaling: percentage (${e.value} %) calibrated to standard ratio (${newV}).`,
          });
        } else if (e.value >= 0.5 && median < 0.2) {
          // Order-of-magnitude count anomaly (e.g. 1 x10^3/uL instead of 0.05 x10^9/L)
          cmds.push({
            action: 'update_biomarker',
            keyName: key,
            date: e.date,
            oldValue: e.value,
            newValue: median,
            reason: `Scaling/unit error: outlier notation (${e.value}) unified to standard baseline concentration (${median}).`,
          });
        }
      });
      return;
    }

    // 4. Structural Factor-10 Scale Shift (e.g. g/dL vs g/L for high-magnitude tests)
    if (median >= 50) {
      entries.forEach((e) => {
        if (e.value > 0 && e.value < 25) {
          const newV = parseFloat((e.value * 10).toFixed(1));
          cmds.push({
            action: 'update_biomarker',
            keyName: key,
            date: e.date,
            oldValue: e.value,
            newValue: newV,
            reason: `Unit conversion: ${e.value} → ${newV} using standard factor 10.`,
          });
        }
      });
    }
  });
  return cmds;
}

/** If Review omitted newValue, hallucinated values, or produced scaling error reasons, correct from convert table. */
export function enrichReviewModificationCommands(
  commands: ModificationCommand[] | undefined | null,
  history: { date?: string; biomarkers?: Record<string, any>; observationMeta?: Record<string, { rawUnit?: string }> }[] = [],
  catalogUnitByKey: Record<string, string> = {}
): ModificationCommand[] {
  const filled = (commands || []).map((cmd) => {
    if (cmd.action !== 'update_biomarker' || !cmd.keyName) return cmd;
    const key = getMappedBiomarkerKey(cmd.keyName) || cmd.keyName;
    const oldRaw = cmd.oldValue ?? history.find((h) => datesMatch(h.date, cmd.date))?.biomarkers?.[key]
      ?? history.find((h) => datesMatch(h.date, cmd.date))?.biomarkers?.[cmd.keyName];
    const oldNum = typeof oldRaw === 'number' ? oldRaw : parseFloat(String(oldRaw ?? ''));
    if (!Number.isFinite(oldNum)) return cmd;

    const histVals = history
      .filter((h) => !datesMatch(h.date, cmd.date))
      .map((h) => Number(h.biomarkers?.[key] ?? h.biomarkers?.[cmd.keyName]))
      .filter((n) => Number.isFinite(n) && n > 0);
    const histMedian = histVals.length
      ? [...histVals].sort((a, b) => a - b)[Math.floor(histVals.length / 2)]
      : 0;
    const spec = ANALYTE_CONVERSIONS[key];
    const catalogUnit = catalogUnitByKey[key] || catalogUnitByKey[cmd.keyName] || '';
    if (!spec) return cmd;

    const cat = normUnit(catalogUnit);
    const looksLikeFrom = histMedian > 0 && oldNum / histMedian >= 8;
    const isSiBand = SI_VALUE_BAND[key] && histMedian >= SI_VALUE_BAND[key][0] && oldNum < SI_VALUE_BAND[key][0];
    const targetIsSi = cat === spec.to || looksLikeFrom || isSiBand;

    if (targetIsSi) {
      const conv = convertViaTable(key, oldNum, spec.from, spec.to);
      if (conv.ok) {
        const curNewVal = typeof cmd.newValue === 'number' ? cmd.newValue : parseFloat(String(cmd.newValue ?? ''));
        const badVal = !Number.isFinite(curNewVal) || Math.abs(curNewVal - conv.value) > 0.5;
        const badReason = !cmd.reason || /decimal|misplaced|scaling|digit|divide|dividing/i.test(cmd.reason);
        return {
          ...cmd,
          keyName: key,
          oldValue: oldNum,
          newValue: conv.value,
          reason: badReason
            ? `Unit conversion: ${oldNum} ${spec.from} → ${conv.value} ${spec.to} using clinical factor ${spec.multiply} (table, not a clinical finding).`
            : cmd.reason,
        };
      }
    }

    const looksLikeTo = histMedian > 0 && histMedian / oldNum >= 8;
    if (cat === spec.from || looksLikeTo) {
      const conv = convertViaTable(key, oldNum, spec.to, spec.from);
      if (conv.ok) {
        const curNewVal = typeof cmd.newValue === 'number' ? cmd.newValue : parseFloat(String(cmd.newValue ?? ''));
        const badVal = !Number.isFinite(curNewVal) || Math.abs(curNewVal - conv.value) > 0.5;
        const badReason = !cmd.reason || /decimal|misplaced|scaling|digit|divide|dividing/i.test(cmd.reason);
        return {
          ...cmd,
          keyName: key,
          oldValue: oldNum,
          newValue: conv.value,
          reason: badReason
            ? `Unit conversion: ${oldNum} ${spec.to} → ${conv.value} ${spec.from} using clinical factor ${spec.multiply} (table, not a clinical finding).`
            : cmd.reason,
        };
      }
    }

    if (cmd.newValue !== undefined && cmd.newValue !== null && cmd.newValue !== '') return cmd;
    return cmd;
  });

  const synthesized = buildReviewCommandsFromHistory(history, catalogUnitByKey);
  if (synthesized.length === 0) return filled;
  const have = new Set(
    filled
      .filter((c) => c.keyName && c.date)
      .map((c) => `${getMappedBiomarkerKey(c.keyName as string) || c.keyName}|${toYYYYMMDD(c.date as string)}`)
  );
  const extra = synthesized.filter((c) => {
    const id = `${c.keyName}|${toYYYYMMDD(c.date as string)}`;
    return !have.has(id);
  });
  return [...filled, ...extra];
}

/**
 * Sanitizes LLM text output for biomarker_review to prevent erroneous math descriptions
 * (e.g. replacing hallucinated "0.8 -> 16" or "dividing by 20" or "decimal placement shift"
 * with the accurate clinical unit conversion factor and converted value).
 */
export function sanitizeReviewReply(
  reply: string,
  commands: ModificationCommand[] = [],
  history: { date?: string; biomarkers?: Record<string, any> }[] = [],
  catalogUnitByKey: Record<string, string> = {}
): string {
  if (!reply || typeof reply !== 'string') return reply || '';
  let clean = reply;

  // 1. Process each command to fix hallucinated numbers in reply text
  (commands || []).forEach((cmd) => {
    if (cmd.action !== 'update_biomarker' || !cmd.keyName) return;
    const key = getMappedBiomarkerKey(cmd.keyName) || cmd.keyName;
    const spec = ANALYTE_CONVERSIONS[key];
    if (!spec) return;

    const oldVal = cmd.oldValue !== undefined ? cmd.oldValue : '';
    const newVal = cmd.newValue !== undefined ? cmd.newValue : '';

    if (oldVal !== '' && newVal !== '') {
      // Find patterns like "0.8 -> 16" or "0.8 -> 16.0" or "0.8 to 16" or "0.8 → 16"
      const numPattern = new RegExp(
        `\\b(${oldVal})\\s*(?:->|-->|to|→)\\s*(\\d+(?:\\.\\d+)?)\\b`,
        'gi'
      );
      clean = clean.replace(numPattern, (match, p1, p2) => {
        const numP2 = parseFloat(p2);
        if (Math.abs(numP2 - Number(newVal)) > 0.5) {
          return `${p1} ${spec.from} → ${newVal} ${spec.to}`;
        }
        return `${p1} ${spec.from} → ${p2} ${spec.to}`;
      });
    }

    // Replace "0.8 umol/L" with "0.8 mg/dL" if old value was in mg/dL before conversion
    if (oldVal !== '') {
      const wrongUnitPattern = new RegExp(`\\b(${oldVal})\\s*(?:umol\\/L|µmol\\/L|mmol\\/L)\\b`, 'gi');
      clean = clean.replace(wrongUnitPattern, `$1 ${spec.from}`);
    }
  });

  // 2. Fix erroneous text phrases describing unit conversions as decimal placement or scaling errors
  clean = clean.replace(
    /decimal placement shift \([^)]*\)/gi,
    'unit conversion using standard clinical factor'
  );
  clean = clean.replace(
    /decimal placement shift/gi,
    'unit conversion using standard clinical factor'
  );
  clean = clean.replace(
    /decimal point misplaced/gi,
    'unit conversion required'
  );
  clean = clean.replace(
    /dividing by \d+|dropping a digit/gi,
    'applying clinical unit conversion factor'
  );
  clean = clean.replace(
    /data-entry\/unit-scaling correction/gi,
    'unit conversion correction'
  );

  return clean;
}

export function applyModificationCommands(
  history: BiomarkerLog[],
  commands: ModificationCommand[] | undefined | null,
  catalogUnitByKey: Record<string, string> = {}
): { history: BiomarkerLog[]; applied: number } {
  const enriched = enrichReviewModificationCommands(commands, history, catalogUnitByKey);
  if (!enriched.length) return { history, applied: 0 };
  let applied = 0;
  const next = history.map((h) => ({
    ...h,
    biomarkers: { ...(h.biomarkers || {}) },
    observationMeta: h.observationMeta ? JSON.parse(JSON.stringify(h.observationMeta)) : undefined,
  }));

  enriched.forEach((cmd) => {
    const key = cmd.keyName ? getMappedBiomarkerKey(cmd.keyName) || cmd.keyName : '';
    if (!key) return;
    if (cmd.action === 'update_biomarker' && cmd.newValue !== undefined) {
      const matchingIndices = next
        .map((h, i) => (datesMatch(h.date, cmd.date) ? i : -1))
        .filter((i) => i >= 0);
      const num = typeof cmd.newValue === 'number' ? cmd.newValue : Number(cmd.newValue);
      const val = Number.isNaN(num) ? cmd.newValue : num;
      if (matchingIndices.length > 0) {
        matchingIndices.forEach((idx) => {
          if (!next[idx].observationMeta) next[idx].observationMeta = {};
          if (!next[idx].observationMeta[key]) next[idx].observationMeta[key] = {};
          if (next[idx].observationMeta[key].rawValue === undefined && next[idx].biomarkers[key] !== undefined) {
            next[idx].observationMeta[key].rawValue = cmd.oldValue !== undefined ? cmd.oldValue : next[idx].biomarkers[key];
          }
          next[idx].biomarkers[key] = val;
          next[idx].sync_state = 'update';
          next[idx].updated_at = Date.now();
          applied += 1;
        });
      } else if (cmd.date) {
        next.push({
          id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          date: cmd.date,
          biomarkers: { [key]: val },
          observationMeta: {
            [key]: {
              rawValue: cmd.oldValue !== undefined ? cmd.oldValue : val,
            },
          },
          note: cmd.reason || 'Corrected by Review',
          sync_state: 'update',
          updated_at: Date.now(),
        });
        applied += 1;
      }
    } else if (cmd.action === 'remove_biomarker' && cmd.date) {
      const matchingIndices = next
        .map((h, i) => (datesMatch(h.date, cmd.date) ? i : -1))
        .filter((i) => i >= 0);
      matchingIndices.forEach((idx) => {
        if (next[idx].biomarkers[key] !== undefined) {
          delete next[idx].biomarkers[key];
          if (next[idx].observationMeta?.[key]) {
            delete next[idx].observationMeta[key];
          }
          next[idx].sync_state = 'update';
          next[idx].updated_at = Date.now();
          applied += 1;
        }
      });
    }
  });

  return { history: next, applied };
}

export function latestValuesFromHistory(history: any[]): Record<string, number | string> {
  const current: Record<string, number | string> = {};
  const sorted = [...(history || [])]
    .filter((h) => h && h.sync_state !== 'delete')
    .sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date)));
  sorted.forEach((log) => {
    Object.entries(log.biomarkers || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') {
        current[k] = v as string | number;
      }
    });
  });
  return current;
}

export function overlayAgeBand(age: number | string | undefined | null): string {
  const n = typeof age === 'number' ? age : parseInt(String(age ?? ''), 10);
  if (!Number.isFinite(n) || n <= 0) return 'unknown';
  if (n < 18) return '0-17';
  const lo = Math.floor(n / 10) * 10;
  return `${lo}-${lo + 9}`;
}

export function overlayFingerprint(profile: {
  age?: any;
  gender?: string;
  ethnicity?: string;
} | null | undefined): string {
  const sex = String(profile?.gender || '').toLowerCase().slice(0, 1) || 'u';
  const eth = String(profile?.ethnicity || '').toLowerCase().trim() || 'unspecified';
  return `${overlayAgeBand(profile?.age)}|${sex}|${eth}`;
}

export function shouldRunCalibrator(
  key: string,
  profile: { age?: any; gender?: string; ethnicity?: string } | null | undefined,
  overlay?: { fingerprint?: string; sameAsCatalog?: boolean } | null
): boolean {
  const varies = getRangeVariesBy(key);
  if (varies.length === 0) return false;
  const fp = overlayFingerprint(profile);
  if (overlay?.fingerprint === fp) return false;
  return true;
}

export type RangeSourceKind = 'custom' | 'demographic' | 'lab_report' | 'catalog';

export interface RangeSourceInfo {
  sourceKind: RangeSourceKind;
  sourceLabel: string;
  badgeClass: string;
  sourceRange: string;
}

/**
 * Derives reference range source attribution for UI badges (B7.6).
 * Categories:
 * 1. custom: User explicitly modified/customized range in their profile.
 * 2. demographic: Calibrator adjusted range for age/gender/ethnicity profile.
 * 3. lab_report: Range extracted directly from printed lab report observation metadata.
 * 4. catalog: Standard population default clinical reference range.
 */
export function getBiomarkerRangeSourceInfo(
  key: string,
  def: { normalRange?: string; unit?: string },
  profile?: { customBiomarkers?: Record<string, any>; age?: any; gender?: string; ethnicity?: string } | null,
  latestLog?: { observationMeta?: Record<string, { printedRange?: string }> } | null,
  agentCalibration?: { profileAdjustedNormalRange?: string } | null
): RangeSourceInfo {
  const custom = profile?.customBiomarkers?.[key];
  const customRange = custom?.normalRange;
  const printedRange = latestLog?.observationMeta?.[key]?.printedRange;
  const calibratedRange = agentCalibration?.profileAdjustedNormalRange;
  const defaultRange = def?.normalRange || '';

  if (customRange && typeof customRange === 'string' && customRange.trim() && customRange !== defaultRange && !custom?.overlayFingerprint) {
    return {
      sourceKind: 'custom',
      sourceLabel: 'User Custom Range',
      badgeClass: 'bg-purple-100 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800/40',
      sourceRange: customRange.trim(),
    };
  }

  if (calibratedRange && typeof calibratedRange === 'string' && calibratedRange.trim() && calibratedRange !== defaultRange) {
    return {
      sourceKind: 'demographic',
      sourceLabel: 'Demographic Calibrated',
      badgeClass: 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/40',
      sourceRange: calibratedRange.trim(),
    };
  }

  if (printedRange && typeof printedRange === 'string' && printedRange.trim() && printedRange !== defaultRange) {
    return {
      sourceKind: 'lab_report',
      sourceLabel: 'Lab Report Specific',
      badgeClass: 'bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800/40',
      sourceRange: printedRange.trim(),
    };
  }

  return {
    sourceKind: 'catalog',
    sourceLabel: 'Standard Clinical',
    badgeClass: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700',
    sourceRange: defaultRange || 'Standard',
  };
}

/**
 * Evaluates demographic overlays across active profile biomarkers.
 * When age, gender, or ethnicity change, returns updated customBiomarkers
 * with new fingerprints for analytes that vary by demographic (B7.5).
 */
export function recalibrateProfileOverlays(
  profile: { age?: any; gender?: string; ethnicity?: string; customBiomarkers?: Record<string, any> } | null | undefined,
  activeKeys: string[] = []
): { updatedCustomBiomarkers: Record<string, any>; recalibratedCount: number } {
  const custom = { ...(profile?.customBiomarkers || {}) };
  if (!profile) return { updatedCustomBiomarkers: custom, recalibratedCount: 0 };
  const currentFp = overlayFingerprint(profile);
  let count = 0;

  const candidateKeys = activeKeys.length > 0 ? activeKeys : Object.keys(custom);
  for (const k of candidateKeys) {
    const existing = custom[k];
    if (shouldRunCalibrator(k, profile, existing)) {
      custom[k] = {
        ...(existing || {}),
        overlayFingerprint: currentFp,
      };
      count += 1;
    }
  }

  return { updatedCustomBiomarkers: custom, recalibratedCount: count };
}

/** Retired chat destinations → owner the user should land on. */
export const RETIRED_AGENT_REDIRECT: Record<string, string> = {
  medical_extract: 'agent1',
  agent2: 'data_review',
  agent3: 'data_review',
  agent5: 'data_review',
};

export interface AgentDestinationRoute {
  destination: string;
  payload?: any;
  proposal?: any;
  targetKey?: string;
  requiresApproval?: boolean;
  silentWrite?: boolean;
}

export function resolveAgentDestination(
  agentType: string | null | undefined,
  payload?: any
): string | AgentDestinationRoute | null {
  if (!agentType) return null;
  const canonical = RETIRED_AGENT_REDIRECT[agentType] || agentType;

  if (payload !== undefined && payload !== null) {
    if (payload?.isWrongDoor === true) {
      return {
        destination: payload.destination || 'food',
        payload,
      };
    }
    if (payload?.destination && typeof payload.destination === 'string') {
      return {
        destination: payload.destination,
        payload,
      };
    }
    if (canonical === 'data_accuracy' || agentType === 'data_accuracy') {
      return {
        destination: 'comparison_modal',
        payload,
        requiresApproval: true,
      };
    }
    if (canonical === 'biomarker_review' || agentType === 'biomarker_review') {
      if (payload?.proposal?.range || payload?.proposal?.normalRange) {
        return {
          destination: 'custom_ranges_proposal',
          targetKey: payload.biomarkerKey || payload.proposal?.key || payload.proposal?.name,
          proposal: payload.proposal,
          requiresApproval: true,
          silentWrite: false,
        };
      }
    }
    if (
      canonical === 'name_consolidation' ||
      agentType === 'name_consolidation' ||
      agentType === 'agent3' ||
      agentType === 'consolidate_names'
    ) {
      return {
        destination: 'name_remap_proposal',
        proposal: payload?.proposal || payload,
        requiresApproval: true,
      };
    }
    return {
      destination: canonical,
      payload,
    };
  }

  return canonical;
}

export const INSTRUCTION_KEY_ALIASES: Record<string, string[]> = {
  agent1: ['medical_extract'],
  medical: ['medical_extract', 'agent1'],
  medical_categorise: ['agent2'],
  consolidate_names: ['agent3'],
  data_review: ['agent5'],
  biomarker_review: [],
};

export function readAliasedInstruction(storageKeyPrefix: string, resolvedKey: string): string | null {
  if (typeof localStorage === 'undefined') return null;
  const keys = [resolvedKey, ...(INSTRUCTION_KEY_ALIASES[resolvedKey] || [])];
  for (const k of keys) {
    const v = localStorage.getItem(`${storageKeyPrefix}${k}`);
    if (v !== null) return v;
  }
  return null;
}

export function flaggedKeySet(profile: any, history?: any[], resolved?: Record<string, any>): Set<string> {
  return new Set(
    detectFlaggedTelemetryErrors(resolved || {}, profile, history || [], undefined).map((f) => f.key)
  );
}

export function isLiveForUse(key: string, profile: any, history?: any[], resolved?: Record<string, any>, flagged?: Set<string>): boolean {
  if (!isBiomarkerApproved(key, profile, history)) return false;
  if (profile?.pendingObservations?.some((p: any) => p.suggestedKey === key || p.printedName === key)) {
    const isBuiltIn = biomarkerDefinitions.some((d: any) => d.key === key);
    const custom = profile?.customBiomarkers?.[key];
    if (!isBuiltIn && custom?.catalogApproved !== true) return false;
  }
  const bad = flagged || flaggedKeySet(profile, history, resolved);
  return !bad.has(key);
}

export function filterHistoryForUse(history: any[] | undefined, profile: any): any[] {
  const flagged = flaggedKeySet(profile, history);
  return (history || []).map((log) => {
    const next: Record<string, any> = {};
    Object.entries(log.biomarkers || {}).forEach(([k, v]) => {
      if (isLiveForUse(k, profile, history, undefined, flagged)) next[k] = v;
    });
    const meta = { ...(log.observationMeta || {}) };
    Object.keys(meta).forEach((k) => {
      if (next[k] === undefined) delete meta[k];
    });
    return { ...log, biomarkers: next, observationMeta: Object.keys(meta).length ? meta : log.observationMeta };
  }).filter((log) => Object.keys(log.biomarkers || {}).length > 0);
}

export function filterCurrentForUse(
  current: Record<string, any> | undefined,
  profile: any,
  history?: any[]
): Record<string, any> {
  const flagged = flaggedKeySet(profile, history, current);
  const out: Record<string, any> = {};
  Object.entries(current || {}).forEach(([k, v]) => {
    if (isLiveForUse(k, profile, history, current, flagged)) out[k] = v;
  });
  return out;
}

export function formatBiomarkersForPrompt(
  current: Record<string, any> | undefined,
  profile: any,
  history?: any[]
): string {
  const filtered = filterCurrentForUse(current, profile, history);
  return JSON.stringify(filtered);
}

export function attachObservationMeta(
  log: BiomarkerLog,
  key: string,
  meta: { unit?: string; printedRange?: string; labFlag?: string; rawValue?: string | number }
): void {
  if (!log.observationMeta) log.observationMeta = {};
  const existing = log.observationMeta[key] || {};
  const backfillVal = meta.rawValue !== undefined ? meta.rawValue : (existing.rawValue !== undefined ? existing.rawValue : log.biomarkers?.[key]);
  log.observationMeta[key] = {
    ...existing,
    ...(meta.unit ? { rawUnit: meta.unit } : {}),
    ...(meta.printedRange ? { printedRange: meta.printedRange } : {}),
    ...(meta.labFlag ? { labFlag: meta.labFlag } : {}),
    ...(backfillVal !== undefined ? { rawValue: backfillVal } : {}),
  };
}

export function getObservationUnit(log: BiomarkerLog | undefined, key: string, fallback?: string): string {
  return log?.observationMeta?.[key]?.rawUnit || fallback || '';
}

export const AGENT_DISPLAY_NAMES: Record<string, string> = {
  medical: 'Lab Parser',
  medical_extract: 'Lab Parser',
  agent1: 'Lab Parser',
  biomarker_review: 'Review',
  agent2: 'Categoriser',
  agent3: 'Name Deduper',
  data_review: 'Range Calibrator',
  agent4: 'Test Planner',
  agent5: 'Range Calibrator',
  agent7: 'Literature',
  health_baseline: 'Health Coach',
  front_desk: 'Front Desk',
  data_accuracy: 'Field Compare',
  name_consolidation: 'Name Deduper',
  standardize_units: 'Unit Relabel',
  medical_categorise: 'Categoriser',
};

export interface CleanupBiomarkerCatalogResult {
  profile: any;
  remappedKeys: Record<string, string>;
  droppedKeys: string[];
  strippedRanges: string[];
}

/**
 * Cleanup helper for profile catalog hygiene (P2):
 * 1. Remap custom keys through getMappedBiomarkerKey; tombstone alias key in deletedCustomBiomarkerKeys.
 * 2. Drop metric_N / empty-name / needsApproval with no history and no unit.
 * 3. Delete needsApproval on catalog-mapped keys.
 * 4. Strip customRanges whose parsed bounds are < 0 or otherwise invented-empty. Does not invent replacements.
 */
export function cleanupInventedBiomarkerCatalog(
  profile: any,
  history: any[] = []
): CleanupBiomarkerCatalogResult {
  const nextProfile = {
    ...profile,
    customBiomarkers: { ...(profile?.customBiomarkers || {}) },
    deletedCustomBiomarkerKeys: { ...(profile?.deletedCustomBiomarkerKeys || {}) },
    customRanges: { ...(profile?.customRanges || {}) },
  };

  const remappedKeys: Record<string, string> = {};
  const droppedKeys: string[] = [];
  const strippedRanges: string[] = [];

  // 1. Remap custom keys through getMappedBiomarkerKey & tombstone alias keys
  Object.entries(nextProfile.customBiomarkers).forEach(([key, def]: [string, any]) => {
    const mappedByKey = getMappedBiomarkerKey(key);
    const mappedByName = def?.name ? getMappedBiomarkerKey(def.name) : '';
    const mapped =
      mappedByKey && mappedByKey !== key && biomarkerDefinitions.some((d) => d.key === mappedByKey)
        ? mappedByKey
        : mappedByName && mappedByName !== key && biomarkerDefinitions.some((d) => d.key === mappedByName)
        ? mappedByName
        : mappedByKey && mappedByKey !== key
        ? mappedByKey
        : '';

    if (mapped && mapped !== key) {
      remappedKeys[key] = mapped;
      delete nextProfile.customBiomarkers[key];
      nextProfile.deletedCustomBiomarkerKeys[key] = Date.now();
    }
  });

  // 2. Drop metric_N / empty-name / needsApproval with no history and no unit
  Object.entries(nextProfile.customBiomarkers).forEach(([key, def]: [string, any]) => {
    const isJunkKey =
      /^metric[_\s-]?\d+$/i.test(key) ||
      /^metric\s*\d+$/i.test(String(def?.name || '')) ||
      !def?.name ||
      !String(def.name).trim();
    const hasHistory = (history || []).some(
      (h) => h?.biomarkers && h.biomarkers[key] != null && h.biomarkers[key] !== ''
    );
    const isPendingNoUnitNoHistory = def?.needsApproval === true && !hasHistory && !def?.unit;

    if ((isJunkKey && !hasHistory) || isPendingNoUnitNoHistory) {
      delete nextProfile.customBiomarkers[key];
      nextProfile.deletedCustomBiomarkerKeys[key] = Date.now();
      droppedKeys.push(key);
    }
  });

  // 3. Delete needsApproval on catalog-mapped keys
  Object.entries(nextProfile.customBiomarkers).forEach(([key, def]: [string, any]) => {
    const mapped = getMappedBiomarkerKey(key) || key;
    const isBuiltIn = biomarkerDefinitions.some((d: any) => d.key === mapped || d.key === key);
    if (isBuiltIn && def?.needsApproval) {
      delete def.needsApproval;
    }
  });

  // 4. Strip customRanges whose parsed bounds are < 0 or otherwise invented-empty. Does not invent replacements.
  Object.entries(nextProfile.customRanges).forEach(([key, range]: [string, any]) => {
    const rangeStr = typeof range === 'string' ? range : range?.range || range?.normalRange || '';
    const bounds = parseNormalRangeBounds(rangeStr);
    const hasNegative =
      (bounds && ((bounds.min !== undefined && bounds.min < 0) || (bounds.max !== undefined && bounds.max < 0))) ||
      rangeStr.includes('< 0') ||
      rangeStr.includes('<0');
    const isEmptyObj = typeof range === 'object' && range !== null && Object.keys(range).length === 0;
    const isEmptyStr = typeof range === 'string' && !range.trim();

    if (hasNegative || isEmptyObj || isEmptyStr) {
      delete nextProfile.customRanges[key];
      strippedRanges.push(key);
    }
  });

  // Also clean negative/invalid normalRange strings inside customBiomarkers definitions
  Object.entries(nextProfile.customBiomarkers).forEach(([key, def]: [string, any]) => {
    if (def?.normalRange) {
      const bounds = parseNormalRangeBounds(def.normalRange);
      if ((bounds && ((bounds.min !== undefined && bounds.min < 0) || (bounds.max !== undefined && bounds.max < 0))) ||
          def.normalRange.includes('< 0') || def.normalRange.includes('<0')) {
        delete def.normalRange;
        strippedRanges.push(`customBiomarkers.${key}.normalRange`);
      }
    }
  });

  if (Array.isArray(profile?.pendingObservations)) {
    nextProfile.pendingObservations = [...profile.pendingObservations];
  }

  return {
    profile: nextProfile,
    remappedKeys,
    droppedKeys,
    strippedRanges,
  };
}
