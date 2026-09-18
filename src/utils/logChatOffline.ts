import { isCompareOnlyResult } from './compareMealLogGuard';
import { toPendingFoodLog } from '../mealBuild/adapters';
import { formatNutrientDisplayValue } from './nutrients';
import { biomarkerDefinitions } from './biomarkers';

export function isValidFoodLog(log: any): boolean {
  if (!log || typeof log !== 'object' || Array.isArray(log)) return false;
  return !!(
    log.name ||
    log.title ||
    (Array.isArray(log.itemsBreakdown) && log.itemsBreakdown.length > 0) ||
    (Array.isArray(log.items) && log.items.length > 0) ||
    (Array.isArray(log.scoutItems) && log.scoutItems.length > 0) ||
    (log.nutrients && typeof log.nutrients === 'object' && Object.keys(log.nutrients).length > 0)
  );
}
export function resolvePendingFoodLog(job: any): any {
  if (!job) return null;
  const rawResult = job.result?.clean_result || job.result?.raw?.data || job.result?.data || job.result || (job as any).clean_result || {};
  // Mode D boundary (sibling of extractPendingFoodLogFromCleanResult): a
  // compare result is never a meal. Without this, compared products were
  // fabricated into a pseudo food log (mega &-title, doubled rows).
  if (isCompareOnlyResult(rawResult)) return null;
  const candidates = [
    job.result?.pendingFoodLog,
    job.result?.clean_result?.pendingFoodLog,
    rawResult.pendingFoodLog,
    job.result?.foodData,
    rawResult.foodData,
    job.result?.data,
    rawResult.data,
    job.result?.mealBuild ? toPendingFoodLog(job.result.mealBuild) : null,
    job.mealBuild ? toPendingFoodLog(job.mealBuild) : null,
    rawResult.mealBuild ? toPendingFoodLog(rawResult.mealBuild) : null,
    job.messages?.slice().reverse().find((m: any) => m.pendingFoodLog || m.data?.pendingFoodLog)?.pendingFoodLog,
    job.messages?.slice().reverse().find((m: any) => m.data?.pendingFoodLog)?.data?.pendingFoodLog
  ];
  for (const cand of candidates) {
    if (isValidFoodLog(cand)) return cand;
  }
  const items = rawResult.itemsBreakdown || rawResult.items || rawResult.scoutItems || job.result?.scoutItems || [];
  if (items.length > 0 || rawResult.name || rawResult.title || job.result?.name) {
    return {
      itemsBreakdown: items,
      items: items,
      nutrients: rawResult.nutrients || job.result?.nutrients || {},
      name: rawResult.name || rawResult.title || rawResult.content?.name || job.result?.name || 'Meal',
      title: rawResult.name || rawResult.title || rawResult.content?.name || job.result?.name || 'Meal',
      benefits: rawResult.benefits || rawResult.content?.benefits || [],
      risks: rawResult.risks || rawResult.content?.risks || [],
      recommendation: rawResult.recommendation || rawResult.content?.recommendation || '',
      verdict: rawResult.verdict || rawResult.content?.verdict || '',
      message: rawResult.message || rawResult.text || job.result?.message || job.result?.text || '',
      imageUrls: rawResult.imageUrls || job.result?.imageUrls || [],
      photoUrl: rawResult.photoUrl || job.result?.photoUrl || job.photoUrl
    };
  }
  return null;
}
export const isValidValue = (v: unknown): boolean =>
  v !== null && v !== undefined && v !== '' && v !== 'N/A' && v !== 'null';
export const formatNutrientValue = (value: unknown, unit: string): string => {
  if (!isValidValue(value)) return '—';
  return formatNutrientDisplayValue(value, unit);
};
export interface BiomarkerEntry {
  biomarker: string;
  date: string;
  value: number;
  unit: string;
}
export function safeJSONStringify(obj: any): string {
  const seen = new WeakSet();
  return JSON.stringify(obj, (key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return undefined;
      }
      seen.add(value);
    }
    return value;
  });
}
export function parseJsonOffline(jsonText: string): BiomarkerEntry[] {
  const entries: BiomarkerEntry[] = [];
  if (!jsonText) return entries;
  try {
    const cleanedText = jsonText.replace(/```(?:json)?/gi, '').trim();
    const parsed = JSON.parse(cleanedText);
    const rawList = Array.isArray(parsed) 
      ? parsed 
      : (parsed?.biomarkers || parsed?.entries || parsed?.data || []);
    if (Array.isArray(rawList)) {
      rawList.forEach((item: any) => {
        if (item && typeof item === 'object') {
          const bName = item.biomarker || item.name || item.key;
          const bDate = item.date || item.timestamp;
          const bVal = item.value !== undefined ? item.value : item.val;
          if (bName && bDate) {
            entries.push({
              biomarker: String(bName),
              date: String(bDate),
              value: Number(bVal) || 0,
              unit: item.unit ? String(item.unit) : ''
            });
          }
        }
      });
    }
  } catch (e) {
    console.warn("parseJsonOffline: standard parser failed, falling back to regex", e);
  }
  if (entries.length > 0) {
    return entries;
  }
  const lines = jsonText.split(/\r?\n|\\n/);
  let currentEntry: Partial<BiomarkerEntry> = {};
  for (let line of lines) {
    line = line.trim();
    if (line.startsWith('-') || line.startsWith('biomarker:')) {
      if (currentEntry.biomarker) {
        entries.push(currentEntry as BiomarkerEntry);
      }
      currentEntry = {};
    }
    const biomarkerMatch = line.match(/(?:-\s+)?biomarker:\s*(.*)/i);
    if (biomarkerMatch) {
      currentEntry.biomarker = biomarkerMatch[1].replace(/['"]/g, '').trim();
      continue;
    }
    const dateMatch = line.match(/date:\s*([\d-]+)/i);
    if (dateMatch) {
      currentEntry.date = dateMatch[1].trim();
      continue;
    }
    const valueMatch = line.match(/value:\s*([\d.]+)/i);
    if (valueMatch) {
      currentEntry.value = parseFloat(valueMatch[1]);
      continue;
    }
    const unitMatch = line.match(/unit:\s*(.*)/i);
    if (unitMatch) {
      currentEntry.unit = unitMatch[1].replace(/['"]/g, '').trim();
      continue;
    }
  }
  if (currentEntry.biomarker) {
    entries.push(currentEntry as BiomarkerEntry);
  }
  return entries;
}
export function getOfflineCategorization(name: string) {
  const lowerName = name.toLowerCase();
  if (lowerName.includes('alt') || lowerName.includes('ast') || lowerName.includes('alp') || lowerName.includes('bilirubin') || lowerName.includes('liver') || lowerName.includes('ggt')) {
    return {
      riskCategories: ['Liver & hepatitis stress'],
      standardMedicalGrouping: 'Hepatic',
      potentialMedicalConditions: ['Fatty Liver', 'Hepatitis Stress']
    };
  }
  if (lowerName.includes('creatinine') || lowerName.includes('egfr') || lowerName.includes('urea') || lowerName.includes('kidney') || lowerName.includes('bun') || lowerName.includes('uric acid')) {
    return {
      riskCategories: ['Kidney & hydration'],
      standardMedicalGrouping: 'Renal',
      potentialMedicalConditions: ['Chronic Kidney Disease', 'Hydration Issues']
    };
  }
  if (lowerName.includes('glucose') || lowerName.includes('hba1c') || lowerName.includes('insulin') || lowerName.includes('cholesterol') || lowerName.includes('ldl') || lowerName.includes('hdl') || lowerName.includes('triglycerides') || lowerName.includes('tg') || lowerName.includes('sugar') || lowerName.includes('metabolic')) {
    return {
      riskCategories: ['Metabolic & glycemic', 'Cardiovascular'],
      standardMedicalGrouping: 'Metabolic',
      potentialMedicalConditions: ['Diabetes Risk', 'Insulin Resistance', 'Cardiovascular Risk']
    };
  }
  if (lowerName.includes('hemoglobin') || lowerName.includes('hgb') || lowerName.includes('wbc') || lowerName.includes('rbc') || lowerName.includes('platelet') || lowerName.includes('plt') || lowerName.includes('hematocrit') || lowerName.includes('mcv') || lowerName.includes('mch') || lowerName.includes('anemia') || lowerName.includes('iron') || lowerName.includes('ferritin')) {
    return {
      riskCategories: ['Hematology'],
      standardMedicalGrouping: 'Hematology',
      potentialMedicalConditions: ['Anemia', 'Hematology Disbalance']
    };
  }
  if (lowerName.includes('weight') || lowerName.includes('height') || lowerName.includes('bmi') || lowerName.includes('bp') || lowerName.includes('blood pressure') || lowerName.includes('heart rate') || lowerName.includes('pulse')) {
    return {
      riskCategories: ['Cardiovascular'],
      standardMedicalGrouping: 'Biometrics',
      potentialMedicalConditions: ['Hypertension', 'Obesity']
    };
  }
  return {
    riskCategories: ['General Health'],
    standardMedicalGrouping: 'Other',
    potentialMedicalConditions: ['General Imbalance']
  };
}
export function performOfflineDataAssembly(jsonText: string, bucketMapping: any) {
  const entries = parseJsonOffline(jsonText);
  const bucketsMap: Record<string, any> = {
    'Metabolic': [],
    'Hepatic': [],
    'Renal': [],
    'Hematology': [],
    'Biometrics': [],
    'Other': []
  };
  const biomarkerHistory: Record<string, { value: number; date: string; unit: string }[]> = {};
  for (const entry of entries) {
    if (!entry.biomarker) continue;
    if (!biomarkerHistory[entry.biomarker]) {
      biomarkerHistory[entry.biomarker] = [];
    }
    biomarkerHistory[entry.biomarker].push({
      value: entry.value,
      date: entry.date,
      unit: entry.unit
    });
  }
  for (const [name, history] of Object.entries(biomarkerHistory)) {
    const mapping = bucketMapping[name] || getOfflineCategorization(name);
    const grouping = mapping.standardMedicalGrouping || 'Other';
    const sortedHistory = [...history].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const latest = sortedHistory[0];
    const bObj = {
      name,
      riskCategories: mapping.riskCategories || [],
      standardMedicalGrouping: grouping,
      potentialMedicalConditions: mapping.potentialMedicalConditions || [],
      history: history.map(h => {
        const lower = name.toLowerCase();
        let refRange = '0 - 100 ' + h.unit;
        if (lower.includes('glucose')) refRange = '70 - 99 ' + h.unit;
        else if (lower.includes('hba1c')) refRange = '4.0 - 5.6 ' + h.unit;
        else if (lower.includes('alt')) refRange = '7 - 56 ' + h.unit;
        else if (lower.includes('ast')) refRange = '10 - 40 ' + h.unit;
        else if (lower.includes('creatinine')) refRange = '0.6 - 1.2 ' + h.unit;
        return {
          date: h.date,
          value: h.value,
          referenceRange: refRange,
          level: "Normal"
        };
      })
    };
    if (bucketsMap[grouping]) {
      bucketsMap[grouping].push(bObj);
    } else {
      bucketsMap['Other'].push(bObj);
    }
  }
  const buckets = Object.entries(bucketsMap)
    .filter(([_, list]) => list.length > 0)
    .map(([systemName, biomarkers]) => ({
      systemName,
      biomarkers
    }));
  return {
    text: "Data successfully processed and categorized offline.",
    entriesCount: entries.length,
    buckets
  };
}
export function extractBiomarkerKeysFromJson(jsonStr: string): string[] {
  if (!jsonStr) return [];
  const keys: string[] = [];
  try {
    const cleanedText = jsonStr.replace(/```(?:json)?/gi, '').trim();
    const parsed = JSON.parse(cleanedText);
    const rawList = Array.isArray(parsed) 
      ? parsed 
      : (parsed?.biomarkers || parsed?.entries || parsed?.data || []);
    if (Array.isArray(rawList)) {
      rawList.forEach((item: any) => {
        if (item && typeof item === 'object') {
          const bName = item.biomarker || item.name || item.key;
          if (bName) {
            keys.push(String(bName));
          }
        }
      });
    }
  } catch (e) {
    console.warn("extractBiomarkerKeysFromJson: standard parser failed, falling back to regex", e);
  }
  if (keys.length > 0) {
    return Array.from(new Set(keys)).filter(Boolean);
  }
  const lines = jsonStr.split(/\r?\n|\\n/);
  lines.forEach(line => {
    const trimmed = line.trim();
    const match = trimmed.match(/^(?:-\s*)?biomarker\s*:\s*["']?([^"'\s:]+)["']?/i);
    if (match && match[1]) {
      keys.push(match[1]);
    } else {
      const keyValMatch = trimmed.match(/^([a-zA-Z0-9_-]+)\s*:\s*/);
      if (keyValMatch && keyValMatch[1]) {
        const k = keyValMatch[1].toLowerCase();
        if (k !== 'date' && k !== 'value' && k !== 'unit' && k !== 'biomarker' && k !== 'name') {
          keys.push(keyValMatch[1]);
        }
      }
    }
  });
  return Array.from(new Set(keys)).filter(Boolean);
}
export function extractBiomarkerKeysFromPrioritizedConditions(prioritizedConditions: any[]): string[] {
  if (!Array.isArray(prioritizedConditions)) return [];
  const keys: string[] = [];
  prioritizedConditions.forEach(cond => {
    if (cond) {
      if (Array.isArray(cond.biomarkers)) {
        cond.biomarkers.forEach((m: any) => {
          if (m && typeof m.key === 'string') {
            keys.push(m.key);
          }
        });
      }
      if (Array.isArray(cond.biomarkerKeys)) {
        cond.biomarkerKeys.forEach((k: any) => {
          if (typeof k === 'string') {
            keys.push(k);
          }
        });
      }
    }
  });
  return Array.from(new Set(keys)).filter(Boolean);
}
export function detectBiomarkersInText(text: string): string[] {
  if (!text) return [];
  const found = new Set<string>();
  const lowerText = text.toLowerCase();
  biomarkerDefinitions.forEach(def => {
    const keyLower = def.key.toLowerCase().replace(/_/g, ' ');
    const nameLower = def.name.toLowerCase();
    // Check key (as a word boundary if short, otherwise substring)
    const cleanKey = def.key.toLowerCase();
    const isShortKey = cleanKey.length <= 4;
    let isKeyInText = false;
    if (isShortKey) {
      const words = lowerText.split(/[^a-zA-Z0-9]/);
      isKeyInText = words.includes(cleanKey);
    } else {
      isKeyInText = lowerText.includes(cleanKey);
    }
    const isNameInText = lowerText.includes(nameLower);
    if (isNameInText || isKeyInText) {
      found.add(def.name);
    }
  });
  return Array.from(found);
}
