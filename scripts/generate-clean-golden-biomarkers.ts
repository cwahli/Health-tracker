import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';
import {
  getBiomarkerStatus,
  getBiomarkerStatusLabel,
  getBiomarkerRiskTag,
  getActiveStructuredRangeRule,
  formatCustomRangesSummary,
  biomarkerDefinitions,
  getCustomBiomarkerDef,
  isValEmpty,
  getMappedBiomarkerKey,
  getMergedBiomarkerDef,
  getBiomarkerMetadata,
  isAsianEthnicity,
  getIdealBmiTarget
} from '../src/utils/biomarkers';
import { getBiomarkerRangeSourceInfo } from '../src/utils/biomarkerLifecycle';
import { generateDynamicInsight } from '../src/utils/biomarkerInsights';
import { formatToDDMMYYYY, toYYYYMMDD } from '../src/utils/dateUtils';
import { buildDataSanitizePlan, applyDataSanitizePlan } from '../src/utils/dataSanitize';
import { getDuplicateAliasGroups } from '../src/utils/biomarkerAuditEngine';

const rootDir = process.cwd();
const logsCsv = fs.readFileSync(path.join(rootDir, 'golden/biomarker/input/raw_biomarker_logs.csv'), 'utf-8');
const dictCsv = fs.readFileSync(path.join(rootDir, 'golden/biomarker/input/raw_biomarker_dictionary.csv'), 'utf-8');

const rawLogs = Papa.parse(logsCsv, { header: true }).data.filter((r: any) => r.Date && r.Biomarker);
const rawDict = Papa.parse(dictCsv, { header: true }).data.filter((r: any) => r['Biomarker Name']);

const profile: any = {
  age: 43,
  gender: 'Male',
  ethnicity: 'Asian',
  height: 164,
  weight: 61.9,
  language: 'en',
  customBiomarkers: {},
  notUsedInMedicalHistory: {},
  notUsedBiomarkers: {},
  deletedBiomarkerLogIds: {}
};

rawDict.forEach((d: any) => {
  profile.customBiomarkers[d.Key] = {
    name: d['Biomarker Name'],
    unit: d.Unit,
    normalRange: d['Normal Range'],
    description: d.Description,
    standardMedicalGrouping: d['Medical Practice'],
    riskCategories: d['Risk Categories'] ? d['Risk Categories'].split('; ') : [],
    potentialMedicalConditions: d['Medical Conditions'] ? d['Medical Conditions'].split('; ') : [],
  };
});

const normalizeBiomarkerKey = (raw: string) => {
  const dictMatch = rawDict.find((x: any) => x['Biomarker Name'].toLowerCase() === raw.toLowerCase());
  if (dictMatch) return dictMatch.Key;
  const mapped = getMappedBiomarkerKey(raw);
  if (biomarkerDefinitions.some(d => d.key === mapped)) return mapped;
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
};

const historyMap = new Map<string, any>();
rawLogs.forEach((r: any) => {
  const d = r.Date;
  if (!historyMap.has(d)) {
    historyMap.set(d, {
      id: 'log_' + d,
      date: d,
      biomarkers: {},
      note: r.Comment || '',
      tests: []
    });
  }
  const h = historyMap.get(d);
  const key = normalizeBiomarkerKey(r.Biomarker);
  const numVal = isNaN(Number(r.Value)) ? r.Value : Number(r.Value);
  h.biomarkers[key] = numVal;
  if (r.Comment && !h.note) h.note = r.Comment;
  if (r.Comment) {
    h.tests.push({ key, originalTestName: r.Biomarker, doctorComment: r.Comment, unit: r.Unit });
  }
});

let biomarkerHistory = Array.from(historyMap.values());
const biomarkers: any = {};
rawDict.forEach((d: any) => {
  const statusStr = d['Current Evaluation Status'] || '';
  const match = statusStr.match(/Value:\s*([^|]+)\s*\|/);
  if (match) {
    const v = match[1].trim();
    biomarkers[d.Key] = isNaN(Number(v)) ? v : Number(v);
  }
});

// Run data sanitize plan
const plan = buildDataSanitizePlan({
  profile,
  biomarkers,
  biomarkerHistory,
  foodLogs: []
});

const result = applyDataSanitizePlan(plan, new Set(plan.proposals.map(p => p.id)), {
  profile,
  biomarkers,
  biomarkerHistory,
  foodLogs: []
});

const activeHistory = result.biomarkerHistory.filter(h => h.sync_state !== 'delete');
const activeBiomarkers = result.biomarkers;
const activeProfile = { ...profile, ...result.profileUpdates };

// Generate clean_biomarker_logs.csv
const logHeaders = ["Biomarker", "Date", "Value", "Unit", "Comment"];
const logRows: string[] = [];
const sortedHistory = [...activeHistory].sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));

const escapeCsvField = (field: any) => {
  if (field === null || field === undefined) return '';
  const str = String(field).trim();
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

const formatKeyToTitle = (k: string) => {
  return k
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
};

// Build withMetadata definitions
const hasData = (key: string) => {
  const v = activeBiomarkers ? activeBiomarkers[key] : undefined;
  if (v !== undefined && v !== null && !isValEmpty(v)) return true;
  return activeHistory.some(h => {
    const val = h.biomarkers ? h.biomarkers[key] : undefined;
    return val !== undefined && val !== null && !isValEmpty(val);
  });
};

const combined = biomarkerDefinitions.filter(d => hasData(d.key) && d.key !== 'weight' && d.key !== 'height' && d.key !== 'age').map(d => {
  if (d.key === 'bmi') {
    const isAsian = isAsianEthnicity(activeProfile.ethnicity);
    return {
      ...d,
      normalRange: isAsian ? '18.5 - 22.9' : '18.5 - 24.9',
      descriptions: { ...d.descriptions, en: 'A measure of body fat based on height and weight.' }
    };
  }
  return { ...d, descriptions: { ...d.descriptions } };
});

if (activeProfile.customBiomarkers) {
  Object.entries(activeProfile.customBiomarkers).forEach(([key, def]: [string, any]) => {
    const existing = combined.find(d => d.key === key);
    if (existing) {
      existing.name = def.name || existing.name;
      const validRange = def.normalRange && def.normalRange !== 'Unknown' && def.normalRange.trim() !== '' && def.normalRange !== 'n/a' && def.normalRange !== 'unset' && def.normalRange !== '-';
      existing.normalRange = validRange ? def.normalRange : existing.normalRange;
      const validUnit = def.unit && def.unit !== 'Unknown' && def.unit.trim() !== '' && def.unit !== 'n/a' && def.unit !== 'unset' && def.unit !== '-';
      existing.unit = validUnit ? def.unit : existing.unit;
      existing.standardMedicalGrouping = def.standardMedicalGrouping || existing.standardMedicalGrouping;
      existing.potentialMedicalConditions = def.potentialMedicalConditions || existing.potentialMedicalConditions;
      existing.riskCategories = def.riskCategories || existing.riskCategories;
      if (def.description) existing.descriptions = { ...existing.descriptions, en: def.description };
    } else {
      combined.push({
        key,
        name: def.name || key,
        category: 'other',
        unit: def.unit || '',
        normalRange: def.normalRange || 'Unknown',
        descriptions: { en: def.description || '' },
        standardMedicalGrouping: def.standardMedicalGrouping,
        potentialMedicalConditions: def.potentialMedicalConditions,
        riskCategories: def.riskCategories
      } as any);
    }
  });
}

// Check history keys not yet combined
activeHistory.forEach(h => {
  if (h.biomarkers) {
    Object.keys(h.biomarkers).forEach(key => {
      if (key === 'weight' || key === 'height' || key === 'age') return;
      if (!combined.find(d => d.key === key)) {
        const builtIn = biomarkerDefinitions.find((d: any) => d.key === key || (Array.isArray(d.aliases) && d.aliases.includes(key)));
        const custom = getCustomBiomarkerDef(activeProfile, key);
        const itemLogs = activeHistory.map(l => ({
          date: l.date,
          value: l.biomarkers?.[key],
          unit: (l as any).units?.[key] || (l as any).unit,
          normalRange: (l as any).normalRanges?.[key] || (l as any).normalRange
        })).filter(l => l.value !== undefined || l.unit || l.normalRange);
        const merged = getMergedBiomarkerDef(key, builtIn, custom, itemLogs);
        combined.push({
          key,
          name: merged.name,
          category: 'other',
          unit: merged.unit,
          normalRange: merged.normalRange || 'Unknown',
          descriptions: { en: merged.description || '' }
        } as any);
      }
    });
  }
});

const withMetadata = combined.map(def => {
  const customDef = getCustomBiomarkerDef(activeProfile, def.key);
  const meta = getBiomarkerMetadata(def.key, customDef);
  return {
    ...def,
    riskCategories: meta.riskCategories,
    standardMedicalGrouping: meta.standardMedicalGrouping,
    potentialMedicalConditions: meta.potentialMedicalConditions
  };
});

sortedHistory.forEach(h => {
  if (!h.biomarkers) return;
  const formattedDate = formatToDDMMYYYY(h.date) || h.date;
  const seenCanonicalKeys = new Set<string>();

  Object.keys(h.biomarkers).forEach(key => {
    const val = h.biomarkers[key];
    if (val === undefined || val === null || val === '') return;

    const canonicalKey = getMappedBiomarkerKey(key) || key;
    if (seenCanonicalKeys.has(canonicalKey)) return;
    seenCanonicalKeys.add(canonicalKey);

    const allDefinitions = withMetadata.filter(d => !activeProfile.notUsedInMedicalHistory?.[d.key] && !activeProfile.notUsedBiomarkers?.[d.key]);
    const def = allDefinitions.find(d => d.key === canonicalKey || d.key === key) || biomarkerDefinitions.find(d => d.key === canonicalKey || d.key === key);
    const customDef = getCustomBiomarkerDef(activeProfile, canonicalKey) || getCustomBiomarkerDef(activeProfile, key);
    const testDetail = h.tests?.find((t: any) => t.key === key || t.key === canonicalKey);

    let name = def?.name || customDef?.name || testDetail?.originalTestName;
    if (!name) name = formatKeyToTitle(key);

    const unit = (h as any).observationMeta?.[key]?.rawUnit || testDetail?.unit || customDef?.unit || def?.unit || '';

    let comment = testDetail?.doctorComment || '';
    if (!comment && h.note) {
      const isGeneralCalcNote = h.note.includes('Mifflin-St Jeor') || h.note.includes('Auto-logged BMI update');
      const isBodyCompMarker = ['bmi', 'weight', 'height', 'ideal_body_weight'].includes(canonicalKey);
      if (!isGeneralCalcNote || isBodyCompMarker) {
        comment = h.note;
      }
    }

    comment = comment.trim();
    if (comment.startsWith('.')) {
      comment = comment.replace(/^\.\s*/, '').trim();
    }

    logRows.push([
      escapeCsvField(name),
      escapeCsvField(formattedDate),
      escapeCsvField(val),
      escapeCsvField(unit),
      escapeCsvField(comment)
    ].join(','));
  });
});

const cleanLogsCsvContent = '\uFEFF' + [logHeaders.join(','), ...logRows].join('\n');
fs.writeFileSync(path.join(rootDir, 'golden/biomarker/result/clean_biomarker_logs.csv'), cleanLogsCsvContent, 'utf-8');
console.log('Saved clean_biomarker_logs.csv with rows:', logRows.length);

// Generate clean_biomarker_dictionary.csv
const dictHeaders = [
  "Biomarker Name",
  "Key",
  "Alias",
  "Description",
  "Unit",
  "Normal Range",
  "Custom Range",
  "Clinical Reference Range",
  "Optimal Target Value",
  "Medical Practice",
  "Risk Categories",
  "Medical Conditions",
  "Current Evaluation Status",
  "Medical Insight",
  "Historical Logs (Date: Value)",
  "Not Used"
];

const duplicateGroups = getDuplicateAliasGroups(
  activeProfile.customBiomarkers || {},
  activeHistory || [],
  activeBiomarkers || {},
  activeProfile.deletedCustomBiomarkerKeys || {}
);
const aliasKeysToHide = new Set<string>();
duplicateGroups.forEach(g => {
  g.candidateAliases.forEach(a => aliasKeysToHide.add(a));
});

const exportList = withMetadata
  .filter(d => hasData(d.key) && !aliasKeysToHide.has(d.key))
  .filter(def => activeBiomarkers[def.key] !== undefined || activeProfile.customBiomarkers?.[def.key]);
const dictRows = exportList.map(def => {
  const key = def.key;
  const customDef = getCustomBiomarkerDef(activeProfile, key);
  const name = def.name || customDef?.name || key;
  const aliases = (def.aliases || customDef?.aliases || []).join('; ');
  const desc = def.descriptions?.en || (def as any).description || customDef?.descriptions?.en || (customDef as any)?.description || '';
  const unit = customDef?.unit || def.unit || '';

  const normalRange = customDef?.normalRange || def.normalRange || '';
  const isPlaceholderRange = (v: any) => !v || typeof v !== 'string' || v.trim() === '' || v === 'Unknown' || v === 'unset' || v === 'n/a' || v === '-';
  const structuredOverrideSummary = formatCustomRangesSummary(customDef?.customRanges || (def as any).customRanges);
  const flatCustomRange = !isPlaceholderRange(customDef?.normalRange) && customDef?.normalRange !== def.normalRange ? customDef.normalRange : '';
  const customRange = structuredOverrideSummary || flatCustomRange || '';

  const optVal = customDef?.optimalValue || '';
  const latestLogForUnit = [...activeHistory].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).find(h => h.biomarkers && h.biomarkers[key] !== undefined);

  const rangeSourceInfo = getBiomarkerRangeSourceInfo(key, def, activeProfile, latestLogForUnit, null);
  let clinicalReferenceRange = rangeSourceInfo.sourceRange || normalRange;
  const activeRule = getActiveStructuredRangeRule(def, activeProfile);
  if (activeRule && activeRule.name) {
    const profileType = activeRule.filters?.ethnicity ? `${activeRule.filters.ethnicity} Profile` : 'General Profile';
    clinicalReferenceRange = `${clinicalReferenceRange} (${activeRule.name} - ${profileType})`;
  }

  const medicalPractice = customDef?.standardMedicalGrouping || def.standardMedicalGrouping || '';
  const riskCats = (def.riskCategories || customDef?.riskCategories || []).join('; ');
  const potConds = (def.potentialMedicalConditions || customDef?.potentialMedicalConditions || []).join('; ');

  const latestVal = activeBiomarkers[key];
  const hasVal = !isValEmpty(latestVal);
  let evalStatus = 'No recent data';
  let insightText = '';
  if (hasVal) {
    const status = getBiomarkerStatus(key, latestVal, normalRange, def, activeProfile);
    const statusLabel = getBiomarkerStatusLabel(key, status, customDef, latestVal, activeProfile);
    const riskTag = getBiomarkerRiskTag(key, status, customDef, latestVal, activeProfile);
    evalStatus = `Value: ${latestVal} | Status: ${statusLabel} | Risk: ${riskTag || 'N/A'}`;
    insightText = generateDynamicInsight(def, activeProfile, latestVal, status);
  }

  const isNotUsed = activeProfile.notUsedInMedicalHistory?.[key] === true || activeProfile.notUsedBiomarkers?.[key] != null || customDef?.isNotUsed === true;
  const notUsed = isNotUsed ? "TRUE" : "FALSE";

  const logs = activeHistory
    .filter(h => h.biomarkers && h.biomarkers[key] !== undefined)
    .map(h => {
      let logStr = `Date: ${h.date} | Value: ${h.biomarkers[key]}`;
      if (h.tests) {
        const test = h.tests.find((t: any) => t.key === key);
        if (test) {
          const details = [];
          if (test.originalTestName) details.push(`Original Name: ${test.originalTestName}`);
          if (test.normalRange) details.push(`Extracted Range: ${test.normalRange}`);
          if (test.doctorComment) details.push(`Doctor/Lab Comment:\n${test.doctorComment}`);
          if (details.length > 0) logStr += `\n${details.join('\n')}`;
        }
      }
      return logStr;
    })
    .join('\n\n---\n\n');

  return [
    `"${name.replace(/"/g, '""')}"`,
    `"${key.replace(/"/g, '""')}"`,
    `"${aliases.replace(/"/g, '""')}"`,
    `"${desc.replace(/"/g, '""')}"`,
    `"${unit.replace(/"/g, '""')}"`,
    `"${normalRange.replace(/"/g, '""')}"`,
    `"${customRange.replace(/"/g, '""')}"`,
    `"${clinicalReferenceRange.replace(/"/g, '""')}"`,
    `"${String(optVal).replace(/"/g, '""')}"`,
    `"${medicalPractice.replace(/"/g, '""')}"`,
    `"${riskCats.replace(/"/g, '""')}"`,
    `"${potConds.replace(/"/g, '""')}"`,
    `"${evalStatus.replace(/"/g, '""')}"`,
    `"${insightText.replace(/"/g, '""')}"`,
    `"${logs.replace(/"/g, '""')}"`,
    `"${notUsed}"`
  ].join(',');
});

const cleanDictCsvContent = '\uFEFF' + [dictHeaders.join(','), ...dictRows].join('\n');
fs.writeFileSync(path.join(rootDir, 'golden/biomarker/result/clean_biomarker_dictionary.csv'), cleanDictCsvContent, 'utf-8');
console.log('Saved clean_biomarker_dictionary.csv with rows:', dictRows.length);
