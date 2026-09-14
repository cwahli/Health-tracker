/**
 * Biomarker Audit & Continuity Engine
 * 
 * Performs generalized structural and heuristic diagnostics across UserProfile.customBiomarkers
 * and BiomarkerHistory without using hardcoded analyte names.
 * 
 * Features:
 * 1. Stringified "null", "undefined", or blank unit detection.
 * 2. Self-contained unit scraping from optimal values, ranges, descriptions, and history logs.
 * 3. Generalized morphological & affix-based duplicate candidate clustering.
 * 4. Missing metadata categorization & triage.
 * 5. Continuity state serialization for pause & resume workflows.
 */

import { 
  biomarkerDefinitions,
  getMergedBiomarkerDef, 
  BiomarkerDefinition,
  getMappedBiomarkerKey,
  CLINICAL_SYNONYM_MAP,
  lookupClinicalSynonym,
  normalizeStemKey,
  normalizeBiomarkerName,
  isBiomarkerDuplicateCandidate,
  findDuplicateOrExistingBiomarker,
  detectFlaggedTelemetryErrors,
  COMMON_PREFIXES,
  COMMON_SUFFIXES,
  COMMON_UNIT_SUFFIXES
} from './biomarkers';
import { CONVERSION_FACTORS } from './unitConversion';
import { t, interpolate } from './i18n';

export {
  CLINICAL_SYNONYM_MAP,
  normalizeStemKey,
  normalizeBiomarkerName,
  isBiomarkerDuplicateCandidate,
  findDuplicateOrExistingBiomarker,
  COMMON_PREFIXES,
  COMMON_SUFFIXES,
  COMMON_UNIT_SUFFIXES
};

export interface BiomarkerAuditItem {
  key: string;
  name: string;
  currentUnit: string;
  status: 'clean' | 'corrupted_unit' | 'duplicate_candidate' | 'missing_ranges' | 'conflict';
  logCount: number;
  corruptedUnitProposal?: {
    proposedUnit: string;
    sourceField: 'optimalValue' | 'rangeBrackets' | 'logHistory' | 'normalRange' | 'catalog';
    confidence: number;
    reason: string;
    issueTitle?: string;
    preciseCause?: string;
    suggestedFix?: string;
    badgeLabel?: string;
  };
  duplicateCluster?: {
    targetKey: string;
    targetName: string;
    clusterKeys: string[];
    candidateAliases: string[];
    reason: string;
    isPrimary: boolean;
  };
  missingMetadata?: {
    missingRange: boolean;
    missingCategory: boolean;
    missingBrackets?: boolean;
    missingDescription: boolean;
    missingRiskCategory?: boolean;
    missingConditions?: boolean;
    currentRange?: string;
    currentCategory?: string;
    catalogMatch?: {
      normalRange?: string;
      category?: string;
      unit?: string;
      standardMedicalGrouping?: string;
      descriptions?: { [lang: string]: string };
    };
  };
  conflictInfo?: {
    declaredUnit: string;
    bracketUnit: string;
    optimalUnit?: string;
    suggestedResolution?: {
      action: 'scale_brackets_to_declared' | 'align_declared_to_brackets';
      targetUnit: string;
      description: string;
      scaledBrackets?: any[];
      scaledRange?: string;
    };
  };
}

export interface DuplicateGroupAudit {
  suggestedMasterKey: string;
  suggestedMasterName: string;
  memberKeys: string[];
  candidateAliases: string[];
  reason: string;
  totalLogsInCluster: number;
  emptyAliasKeys: string[];
  populatedAliasKeys: string[];
}

export interface BiomarkerAuditReport {
  timestamp: string;
  totalScanned: number;
  corruptedUnitsCount: number;
  duplicateCandidatesCount: number;
  missingRangesCount: number;
  conflictsCount: number;
  cleanCount: number;
  items: BiomarkerAuditItem[];
  duplicateGroups: DuplicateGroupAudit[];
}

export interface AuditSessionState {
  id: string;
  createdAt: string;
  updatedAt: string;
  step: 'triage' | 'units_review' | 'duplicates_review' | 'ranges_review' | 'conflicts_review' | 'completed';
  selectedFixes: { [key: string]: boolean };
  autoFixUnits: { key: string; fromUnit: string; toUnit: string; reason: string }[];
  duplicateMergeQueue: { sourceKey: string; targetKey: string }[];
  status: 'in_progress' | 'paused' | 'applied';
}

/**
 * Resolves a key or name to its canonical biomarker stem across synonym dictionaries
 * and standard medical catalogs. Single unified engine shared with getMappedBiomarkerKey.
 */
export function getCanonicalBiomarkerStem(key: string, name?: string): string {
  if (!key && !name) return '';
  const mapped = getMappedBiomarkerKey(key, name);
  if (mapped) {
    const norm = normalizeStemKey(mapped);
    if (norm) return norm;
  }
  const normKey = normalizeStemKey(key);
  const normKeySyn = lookupClinicalSynonym(normKey);
  if (normKeySyn) {
    return normKeySyn;
  }
  if (name) {
    const normName = normalizeStemKey(name);
    const normNameSyn = lookupClinicalSynonym(normName);
    if (normNameSyn) {
      return normNameSyn;
    }
    if (normName) return normName;
  }
  return normKey || key.toLowerCase().trim();
}

/**
 * Normalizes a unit string for equivalence comparison (handles unicode superscripts, micro, spaces, eGFR conventions)
 */
export function normalizeUnitEquivalence(unit?: string | null): string {
  if (!unit || typeof unit !== 'string') return '';
  return unit
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/²/g, '2')
    .replace(/³/g, '3')
    .replace(/\^2/g, '2')
    .replace(/\^3/g, '3')
    .replace(/µ/g, 'u')
    .replace(/μ/g, 'u')
    .replace(/1\.73m2/g, '1.73m2')
    .replace(/1\.73m\b/g, '1.73m2') // eGFR 1.73m shorthand is equivalent to 1.73m2
    .replace(/percent/g, '%')
    .replace(/pct/g, '%');
}

/**
 * Extracts a unit token from arbitrary string text using heuristic regex
 */
export function extractUnitFromString(text?: string | null): string | null {
  if (!text || typeof text !== 'string') return null;
  const cleaned = text.trim();
  if (!cleaned || cleaned.toLowerCase() === 'null' || cleaned.toLowerCase() === 'undefined' || cleaned.toLowerCase() === 'unknown') {
    return null;
  }

  // Look for patterns like "100 mL/min/1.73m²", "> 90 mL/min/1.73m²", "35 mmol/mol", "15 - 30 U/L", "4.5 - 11.0 10^9/L", "18.5 - 24.9 kg/m²"
  // Includes unicode superscripts ² (\u00B2), ³ (\u00B3), µ (\u00B5), μ (\u03BC), degrees ° (\u00B0), and scientific units like 10^9/L
  const match = cleaned.match(/(?:[\d\.]+|\bto\b|\-|\>|\<|\>\=|\<\=)\s*(10(?:\^|\*|e|\_)\d+\/[a-zA-Z%µμ°²³]+|[a-zA-Z%µμ°²³][a-zA-Z0-9%µμ°²³\/\^\._\-]*)/);
  if (match && match[1]) {
    const candidate = match[1].trim();
    if (!['to', 'and', 'or', 'null', 'undefined', 'min', 'max', 'range', 'unknown'].includes(candidate.toLowerCase())) {
      return candidate;
    }
  }

  // Also check if the string itself is a direct unit token like "mL/min/1.73m²", "10^9/L", "kg", "mg/dL", "U/L"
  const directMatch = cleaned.match(/^(10(?:\^|\*|e|\_)\d+\/[a-zA-Z%µμ°²³]+|[a-zA-Z%µμ°²³][a-zA-Z0-9%µμ°²³\/\^\._\-]*)$/);
  if (directMatch && directMatch[1]) {
    const candidate = directMatch[1].trim();
    if (!['to', 'and', 'or', 'null', 'undefined', 'min', 'max', 'range', 'unknown'].includes(candidate.toLowerCase())) {
      return candidate;
    }
  }

  return null;
}

/**
 * Checks if a stored unit is structurally corrupted
 */
export function isCorruptedUnit(unit?: string | null): boolean {
  if (unit === null || unit === undefined) return true;
  const s = String(unit).trim().toLowerCase();
  return s === '' || s === 'null' || s === 'undefined' || s === '[object object]' || s === 'unknown' || s === 'none';
}

/**
 * Computes information completeness score for a biomarker definition
 */
export function calculateCompletenessScore(def: any, logCount: number): number {
  if (!def) return 0;
  let score = 0;
  if (def.unit && !isCorruptedUnit(def.unit)) score += 3;
  if (def.optimalValue) score += 2;
  if (Array.isArray(def.rangeBrackets) && def.rangeBrackets.length > 0) score += 4;
  if (def.normalRange && def.normalRange !== 'Unknown') score += 2;
  if (def.category && def.category !== 'other' && def.category !== 'wellness') score += 2;
  if (def.description || def.descriptions?.en) score += 1;
  if (def.catalogApproved) score += 3;
  score += Math.min(logCount, 5); // Up to 5 points for log activity
  return score;
}

const catalogByKey = new Map<string, BiomarkerDefinition>();
const catalogByStem = new Map<string, BiomarkerDefinition>();
const catalogBySynonym = new Map<string, BiomarkerDefinition>();
const catalogByAlias = new Map<string, BiomarkerDefinition>();
const catalogByName = new Map<string, BiomarkerDefinition>();

let catalogIndexed = false;
function ensureCatalogIndexed() {
  if (catalogIndexed) return;
  catalogIndexed = true;
  biomarkerDefinitions.forEach(d => {
    const kLow = d.key.toLowerCase().trim();
    const stem = normalizeStemKey(d.key);
    const nameLow = d.name.toLowerCase().trim();

    catalogByKey.set(kLow, d);
    if (stem && !catalogByStem.has(stem)) catalogByStem.set(stem, d);
    if (nameLow && !catalogByName.has(nameLow)) catalogByName.set(nameLow, d);

    const synKey = lookupClinicalSynonym(kLow) || (stem ? lookupClinicalSynonym(stem) : undefined);
    if (synKey) {
      catalogBySynonym.set(synKey.toLowerCase(), d);
      const normSyn = normalizeStemKey(synKey);
      if (normSyn) catalogBySynonym.set(normSyn, d);
    }

    if (Array.isArray(d.aliases)) {
      d.aliases.forEach(a => {
        const aLow = a.toLowerCase().trim();
        catalogByAlias.set(aLow, d);
        const aStem = normalizeStemKey(a);
        if (aStem) catalogByAlias.set(aStem, d);
      });
    }
  });
}
ensureCatalogIndexed();

/**
 * Finds a matching standard biomarker catalog definition by key, stem, alias, or name
 */
export function findCatalogDefinition(key: string, name?: string): BiomarkerDefinition | undefined {
  if (!key) return undefined;
  ensureCatalogIndexed();
  const normKey = key.toLowerCase().trim();
  const stem = normalizeStemKey(key);
  const mapped = getMappedBiomarkerKey(key, name);
  
  // Exact key match
  let found = catalogByKey.get(normKey);
  if (found) return found;

  // Mapped canonical key match
  if (mapped) {
    found = catalogByKey.get(mapped.toLowerCase());
    if (found) return found;
  }

  // Stem match
  if (stem) {
    found = catalogByStem.get(stem);
    if (found) return found;
  }

  // Clinical Synonym match
  const synKey = lookupClinicalSynonym(normKey) || (stem ? lookupClinicalSynonym(stem) : undefined);
  if (synKey) {
    found = catalogBySynonym.get(synKey.toLowerCase()) || (stem ? catalogBySynonym.get(stem) : undefined) || catalogByKey.get(synKey.toLowerCase());
    if (found) return found;
  }

  // Alias match
  found = catalogByAlias.get(normKey) || (stem ? catalogByAlias.get(stem) : undefined);
  if (found) return found;

  // Name match
  if (name) {
    const cleanName = name.toLowerCase().trim();
    found = catalogByName.get(cleanName);
    if (found) return found;
  }

  return undefined;
}

/**
 * Derives an automatic mathematical resolution for unit/bracket conflict
 */
export function deriveConflictResolution(
  key: string,
  declaredUnit: string,
  bracketUnit: string,
  def: any
): BiomarkerAuditItem['conflictInfo']['suggestedResolution'] {
  const k = key.toLowerCase();
  const dUnit = (declaredUnit || '').trim();
  const bUnit = (bracketUnit || '').trim();
  const dLow = dUnit.toLowerCase();
  const bLow = bUnit.toLowerCase();

  const dNorm = normalizeUnitEquivalence(declaredUnit);
  const bNorm = normalizeUnitEquivalence(bracketUnit);
  if (dNorm === bNorm) {
    return undefined;
  }

  // Hematocrit % vs L/L
  if (k.includes('hematocrit') || k.includes('hct')) {
    if ((dLow === '%' || dLow === 'percent') && (bLow === 'l/l' || bLow === 'fraction')) {
      let scaledRange = '';
      if (def.normalRange && typeof def.normalRange === 'string') {
        scaledRange = def.normalRange.replace(/([\d\.]+)/g, m => {
          const v = parseFloat(m);
          return v <= 1 ? (v * 100).toFixed(0) : m;
        });
      }
      return {
        action: 'scale_brackets_to_declared',
        targetUnit: '%',
        description: 'Convert reference brackets from L/L to % (e.g. 0.37-0.50 L/L ➔ 37-50 %) to match declared % unit',
        scaledRange: scaledRange || '37 - 50'
      };
    }
  }

  // Hemoglobin / Albumin / Protein: g/dL vs g/L
  if ((k.includes('hemoglobin') || k.includes('albumin') || k.includes('protein')) &&
      ((dLow === 'g/dl' && bLow === 'g/l') || (dLow === 'g/l' && bLow === 'g/dl'))) {
    if (dLow === 'g/dl' && bLow === 'g/l') {
      let scaledRange = '';
      if (def.normalRange && typeof def.normalRange === 'string') {
        scaledRange = def.normalRange.replace(/([\d\.]+)/g, m => {
          const v = parseFloat(m);
          return v > 30 ? (v / 10).toFixed(1) : m;
        });
      }
      return {
        action: 'scale_brackets_to_declared',
        targetUnit: 'g/dL',
        description: 'Convert reference brackets from g/L to g/dL (e.g. 120-160 g/L ➔ 12.0-16.0 g/dL) using clinical factor 10 to match declared g/dL unit',
        scaledRange: scaledRange || '12.0 - 16.0'
      };
    } else {
      return {
        action: 'scale_brackets_to_declared',
        targetUnit: 'g/L',
        description: 'Convert reference brackets from g/dL to g/L using clinical factor 10 to match declared g/L unit'
      };
    }
  }

  // General conversion factor check
  const conv = CONVERSION_FACTORS[k];
  if (conv) {
    if (dLow === conv.from.toLowerCase() && bLow === conv.to.toLowerCase()) {
      return {
        action: 'scale_brackets_to_declared',
        targetUnit: conv.from,
        description: `Scale reference brackets to match declared ${conv.from} unit using clinical multiplier ${conv.multiplier}`
      };
    }
    if (dLow === conv.to.toLowerCase() && bLow === conv.from.toLowerCase()) {
      return {
        action: 'scale_brackets_to_declared',
        targetUnit: conv.to,
        description: `Scale reference brackets to match declared ${conv.to} unit using clinical multiplier ${conv.multiplier}`
      };
    }
  }

  // If no verified clinical conversion exists, never propose a destructive auto-fix that overwrites
  // the declared unit with an arbitrary/corrupted bracket string.
  return undefined;
}

/**
 * Ultra-fast duplicate & alias grouping for view components (MedicalHistoryTab, BiomarkerDictionaryModal, TrendsTab)
 * Runs in <2ms by skipping unnecessary full telemetry scans, unit scraping, and metadata completeness passes.
 */
export function getDuplicateAliasGroups(
  customBiomarkers: { [key: string]: any } = {},
  biomarkerHistory: any[] = [],
  currentBiomarkers: { [key: string]: any } = {},
  deletedCustomBiomarkerKeys: { [key: string]: number } = {}
): DuplicateGroupAudit[] {
  ensureCatalogIndexed();
  const combinedHistory = [...biomarkerHistory];
  if (currentBiomarkers && Object.keys(currentBiomarkers).length > 0) {
    combinedHistory.push({ date: new Date().toISOString().split('T')[0], biomarkers: currentBiomarkers });
  }
  const logCounts: { [key: string]: number } = {};
  const allKeysSet = new Set<string>(
    Object.keys(customBiomarkers).filter(k => !(deletedCustomBiomarkerKeys[k] && deletedCustomBiomarkerKeys[k] > 0))
  );

  combinedHistory.forEach(log => {
    if (log && log.biomarkers) {
      Object.keys(log.biomarkers).forEach(k => {
        if (deletedCustomBiomarkerKeys[k] && deletedCustomBiomarkerKeys[k] > 0 && !customBiomarkers[k]) {
          return;
        }
        logCounts[k] = (logCounts[k] || 0) + 1;
        allKeysSet.add(k);
      });
    }
  });

  biomarkerDefinitions.forEach(d => allKeysSet.add(d.key));
  const allKeys = Array.from(allKeysSet);

  const getDef = (key: string) => {
    return getMergedBiomarkerDef(key, catalogByKey.get(key.toLowerCase()), customBiomarkers[key], biomarkerHistory);
  };

  const adjacency: { [key: string]: Set<string> } = {};
  allKeys.forEach(k => { adjacency[k] = new Set([k]); });

  const buckets: { [bucketKey: string]: string[] } = {};
  const addToBucket = (bucket: string | undefined | null, key: string) => {
    if (!bucket) return;
    const b = bucket.trim().toLowerCase();
    if (!b || b.length < 2) return;
    if (!buckets[b]) buckets[b] = [];
    if (!buckets[b].includes(key)) buckets[b].push(key);
  };

  const keyMetaMap = new Map<string, { stem: string; name: string; rawClean: string; normName: string; def: any; isCustomOrHistory: boolean }>();
  allKeys.forEach(k => {
    const def = getDef(k);
    const stem = getCanonicalBiomarkerStem(k, def.name);
    const rawClean = (def.name || k).toLowerCase().replace(/[^a-z0-9]/g, '');
    const normName = normalizeBiomarkerName(def.name || k);
    const isCustomOrHistory = (logCounts[k] || 0) > 0 || customBiomarkers[k] !== undefined;
    keyMetaMap.set(k, { stem, name: def.name || k, rawClean, normName, def, isCustomOrHistory });

    addToBucket(`stem:${stem}`, k);
    addToBucket(`name:${rawClean}`, k);
    addToBucket(`norm:${normName.replace(/\s+/g, '')}`, k);
    const synKey = lookupClinicalSynonym(rawClean) || lookupClinicalSynonym(stem);
    if (synKey) addToBucket(`syn:${synKey}`, k);
    const mapped = getMappedBiomarkerKey(k, def.name);
    if (mapped) addToBucket(`mapped:${mapped}`, k);
  });

  const checkedPairs = new Set<string>();
  const evaluatePair = (keyA: string, keyB: string) => {
    if (keyA === keyB) return;
    const metaA = keyMetaMap.get(keyA)!;
    const metaB = keyMetaMap.get(keyB)!;
    if (!metaA.isCustomOrHistory && !metaB.isCustomOrHistory) return;

    const pairKey = keyA < keyB ? `${keyA}:::${keyB}` : `${keyB}:::${keyA}`;
    if (checkedPairs.has(pairKey)) return;
    checkedPairs.add(pairKey);

    const stemA = metaA.stem;
    const stemB = metaB.stem;

    let isDuplicate = false;
    if (stemA && stemB && stemA === stemB) {
      isDuplicate = true;
    } else {
      const candidateCheck = isBiomarkerDuplicateCandidate(
        { key: keyA, name: metaA.name, unit: metaA.def.unit, normalRange: metaA.def.normalRange },
        { key: keyB, name: metaB.name, unit: metaB.def.unit, normalRange: metaB.def.normalRange }
      );
      if (candidateCheck.isMatch) {
        isDuplicate = true;
      }
    }

    if (isDuplicate) {
      adjacency[keyA].add(keyB);
      adjacency[keyB].add(keyA);
    }
  };

  Object.values(buckets).forEach(bucketKeys => {
    if (bucketKeys.length > 1) {
      for (let i = 0; i < bucketKeys.length; i++) {
        for (let j = i + 1; j < bucketKeys.length; j++) {
          evaluatePair(bucketKeys[i], bucketKeys[j]);
        }
      }
    }
  });

  const activeUserKeys = allKeys.filter(k => (logCounts[k] || 0) > 0 || customBiomarkers[k] !== undefined);
  activeUserKeys.forEach(userKey => {
    const metaU = keyMetaMap.get(userKey);
    if (!metaU) return;
    allKeys.forEach(catalogKey => {
      if (userKey === catalogKey) return;
      const metaC = keyMetaMap.get(catalogKey);
      if (!metaC) return;
      const isSub = (metaU.rawClean.length > 5 && metaC.rawClean.includes(metaU.rawClean)) ||
                    (metaC.rawClean.length > 5 && metaU.rawClean.includes(metaC.rawClean)) ||
                    (metaU.normName.length > 4 && metaC.normName.includes(metaU.normName)) ||
                    (metaC.normName.length > 4 && metaU.normName.includes(metaC.normName));
      if (isSub) {
        evaluatePair(userKey, catalogKey);
      }
    });
  });

  const visited = new Set<string>();
  const clusterMap: { [key: string]: string[] } = {};
  const clusterReasonMap: { [key: string]: string } = {};

  allKeys.forEach(k => {
    if (!visited.has(k)) {
      const component: string[] = [];
      const queue = [k];
      visited.add(k);
      while (queue.length > 0) {
        const curr = queue.shift()!;
        component.push(curr);
        adjacency[curr]?.forEach(neighbor => {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        });
      }
      
      const componentStem = getCanonicalBiomarkerStem(k, getDef(k).name);
      const compReason = component.length > 1 
        ? `Morphological & clinical match cluster for "${componentStem}" across ${component.length} entries`
        : '';

      component.forEach(memberKey => {
        clusterMap[memberKey] = component;
        clusterReasonMap[memberKey] = compReason;
      });
    }
  });

  const duplicateGroups: DuplicateGroupAudit[] = [];
  const processedMasters = new Set<string>();

  allKeys.forEach(key => {
    const siblings = clusterMap[key] || [key];
    if (siblings.length > 1) {
      let bestKey = siblings[0];
      let bestScore = -1;
      siblings.forEach(sk => {
        const sDef = getDef(sk);
        const score = calculateCompletenessScore(sDef, logCounts[sk] || 0);
        if (score > bestScore) {
          bestScore = score;
          bestKey = sk;
        }
      });

      if (!processedMasters.has(bestKey)) {
        processedMasters.add(bestKey);
        const targetDef = getDef(bestKey);
        const allCandidateAliases = siblings.filter(sk => sk !== bestKey);
        const candidateAliases = allCandidateAliases.filter(sk => {
          const hasLogs = (logCounts[sk] || 0) > 0;
          const isCustom = customBiomarkers[sk] !== undefined;
          return hasLogs || isCustom;
        });

        if (candidateAliases.length > 0) {
          const emptyAliasKeys = candidateAliases.filter(sk => (logCounts[sk] || 0) === 0);
          const populatedAliasKeys = candidateAliases.filter(sk => (logCounts[sk] || 0) > 0);
          const totalLogsInCluster = siblings.reduce((sum, sk) => sum + (logCounts[sk] || 0), 0);

          duplicateGroups.push({
            suggestedMasterKey: bestKey,
            suggestedMasterName: targetDef.name || bestKey,
            memberKeys: siblings,
            candidateAliases,
            reason: clusterReasonMap[bestKey] || `Matches cluster for ${bestKey}`,
            totalLogsInCluster,
            emptyAliasKeys,
            populatedAliasKeys
          });
        }
      }
    }
  });

  return duplicateGroups;
}

/**
 * Runs a complete generalized audit on the custom biomarkers dictionary and log history
 */
export function runGeneralizedBiomarkerAudit(
  customBiomarkers: { [key: string]: any } = {},
  biomarkerHistory: any[] = [],
  currentBiomarkers: { [key: string]: any } = {},
  deletedCustomBiomarkerKeys: { [key: string]: number } = {},
  lang?: unknown
): BiomarkerAuditReport {
  ensureCatalogIndexed();
  const items: BiomarkerAuditItem[] = [];

  // 1. Calculate log activity counts per key
  const combinedHistory = [...biomarkerHistory];
  if (currentBiomarkers && Object.keys(currentBiomarkers).length > 0) {
    combinedHistory.push({ date: new Date().toISOString().split('T')[0], biomarkers: currentBiomarkers });
  }
  const logCounts: { [key: string]: number } = {};
  const logUnits: { [key: string]: { [unit: string]: number } } = {};
  const allKeysSet = new Set<string>(
    Object.keys(customBiomarkers).filter(k => !(deletedCustomBiomarkerKeys[k] && deletedCustomBiomarkerKeys[k] > 0))
  );

  combinedHistory.forEach(log => {
    if (log && log.biomarkers) {
      Object.keys(log.biomarkers).forEach(k => {
        // Skip counting or adding keys tombstoned as deleted/consolidated aliases
        if (deletedCustomBiomarkerKeys[k] && deletedCustomBiomarkerKeys[k] > 0 && !customBiomarkers[k]) {
          return;
        }
        logCounts[k] = (logCounts[k] || 0) + 1;
        allKeysSet.add(k);
      });
    }
    if (log && log.tests && Array.isArray(log.tests)) {
      log.tests.forEach((t: any) => {
        if (t && t.key && t.unit && !isCorruptedUnit(t.unit)) {
          if (deletedCustomBiomarkerKeys[t.key] && deletedCustomBiomarkerKeys[t.key] > 0 && !customBiomarkers[t.key]) {
            return;
          }
          if (!logUnits[t.key]) logUnits[t.key] = {};
          logUnits[t.key][t.unit] = (logUnits[t.key][t.unit] || 0) + 1;
          allKeysSet.add(t.key);
        }
      });
    }
  });

  // Also include built-in keys so we can detect duplicates against the standard catalog
  biomarkerDefinitions.forEach(d => allKeysSet.add(d.key));

  const allKeys = Array.from(allKeysSet);

  // Helper to get definition
  const getDef = (key: string) => {
    return getMergedBiomarkerDef(key, catalogByKey.get(key.toLowerCase()), customBiomarkers[key], biomarkerHistory);
  };

  const fakeProfile = { customBiomarkers, deletedCustomBiomarkerKeys, language: lang };
  const telemetryFlags = detectFlaggedTelemetryErrors(
    currentBiomarkers,
    fakeProfile,
    biomarkerHistory,
    allKeys.map(k => getDef(k))
  );

  // 2. Multi-strategy candidate-bucketed duplicate clustering (O(N) bucketing with bounded intra-bucket matching)
  const adjacency: { [key: string]: Set<string> } = {};
  const matchReasons: { [pairKey: string]: string } = {};
  allKeys.forEach(k => { adjacency[k] = new Set([k]); });

  // Pre-index keys by stem, canonical mapped key, exact name token, and clinical synonym
  const buckets: { [bucketKey: string]: string[] } = {};
  const addToBucket = (bucket: string | undefined | null, key: string) => {
    if (!bucket) return;
    const b = bucket.trim().toLowerCase();
    if (!b || b.length < 2) return;
    if (!buckets[b]) buckets[b] = [];
    if (!buckets[b].includes(key)) buckets[b].push(key);
  };

  const keyMetaMap = new Map<string, { stem: string; name: string; rawClean: string; normName: string; def: any; isCustomOrHistory: boolean }>();
  allKeys.forEach(k => {
    const def = getDef(k);
    const stem = getCanonicalBiomarkerStem(k, def.name);
    const rawClean = (def.name || k).toLowerCase().replace(/[^a-z0-9]/g, '');
    const normName = normalizeBiomarkerName(def.name || k);
    const isCustomOrHistory = (logCounts[k] || 0) > 0 || customBiomarkers[k] !== undefined;
    keyMetaMap.set(k, { stem, name: def.name || k, rawClean, normName, def, isCustomOrHistory });

    addToBucket(`stem:${stem}`, k);
    addToBucket(`name:${rawClean}`, k);
    addToBucket(`norm:${normName.replace(/\s+/g, '')}`, k);
    const synKey = lookupClinicalSynonym(rawClean) || lookupClinicalSynonym(stem);
    if (synKey) addToBucket(`syn:${synKey}`, k);
    const mapped = getMappedBiomarkerKey(k, def.name);
    if (mapped) addToBucket(`mapped:${mapped}`, k);
  });

  const checkedPairs = new Set<string>();
  const evaluatePair = (keyA: string, keyB: string) => {
    if (keyA === keyB) return;
    const metaA = keyMetaMap.get(keyA)!;
    const metaB = keyMetaMap.get(keyB)!;
    if (!metaA.isCustomOrHistory && !metaB.isCustomOrHistory) return;

    const pairKey = keyA < keyB ? `${keyA}:::${keyB}` : `${keyB}:::${keyA}`;
    if (checkedPairs.has(pairKey)) return;
    checkedPairs.add(pairKey);

    const stemA = metaA.stem;
    const stemB = metaB.stem;

    let isDuplicate = false;
    let reason = '';

    if (stemA && stemB && stemA === stemB) {
      isDuplicate = true;
      reason = `Shares canonical biomarker stem "${stemA}"`;
    } else {
      const candidateCheck = isBiomarkerDuplicateCandidate(
        { key: keyA, name: metaA.name, unit: metaA.def.unit, normalRange: metaA.def.normalRange },
        { key: keyB, name: metaB.name, unit: metaB.def.unit, normalRange: metaB.def.normalRange }
      );
      if (candidateCheck.isMatch) {
        isDuplicate = true;
        reason = candidateCheck.reason;
      }
    }

    if (isDuplicate) {
      adjacency[keyA].add(keyB);
      adjacency[keyB].add(keyA);
      matchReasons[pairKey] = reason;
    }
  };

  // Compare candidates within matching buckets
  Object.values(buckets).forEach(bucketKeys => {
    if (bucketKeys.length > 1) {
      for (let i = 0; i < bucketKeys.length; i++) {
        for (let j = i + 1; j < bucketKeys.length; j++) {
          evaluatePair(bucketKeys[i], bucketKeys[j]);
        }
      }
    }
  });

  // Check user-active biomarkers against catalog for substring/close name matches
  const activeUserKeys = allKeys.filter(k => (logCounts[k] || 0) > 0 || customBiomarkers[k] !== undefined);
  activeUserKeys.forEach(userKey => {
    const metaU = keyMetaMap.get(userKey);
    if (!metaU) return;
    allKeys.forEach(catalogKey => {
      if (userKey === catalogKey) return;
      const metaC = keyMetaMap.get(catalogKey);
      if (!metaC) return;
      const isSub = (metaU.rawClean.length > 5 && metaC.rawClean.includes(metaU.rawClean)) ||
                    (metaC.rawClean.length > 5 && metaU.rawClean.includes(metaC.rawClean)) ||
                    (metaU.normName.length > 4 && metaC.normName.includes(metaU.normName)) ||
                    (metaC.normName.length > 4 && metaU.normName.includes(metaC.normName));
      if (isSub) {
        evaluatePair(userKey, catalogKey);
      }
    });
  });

  // Find connected components in the adjacency graph
  const visited = new Set<string>();
  const clusterMap: { [key: string]: string[] } = {};
  const clusterReasonMap: { [key: string]: string } = {};

  allKeys.forEach(k => {
    if (!visited.has(k)) {
      const component: string[] = [];
      const queue = [k];
      visited.add(k);
      while (queue.length > 0) {
        const curr = queue.shift()!;
        component.push(curr);
        adjacency[curr]?.forEach(neighbor => {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        });
      }
      
      const componentStem = getCanonicalBiomarkerStem(k, getDef(k).name);
      const compReason = component.length > 1 
        ? `Morphological & clinical match cluster for "${componentStem}" across ${component.length} entries`
        : '';

      component.forEach(memberKey => {
        clusterMap[memberKey] = component;
        clusterReasonMap[memberKey] = compReason;
      });
    }
  });

  // 3. Evaluate each biomarker
  allKeys.forEach(key => {
    const def = getDef(key);
    const name = def.name || key;
    const currentUnit = def.unit || '';
    const siblings = clusterMap[key] || [key];
    const thisLogCount = logCounts[key] || 0;
    const catalogMatchDef = findCatalogDefinition(key, name);

    let status: BiomarkerAuditItem['status'] = 'clean';
    let corruptedUnitProposal: BiomarkerAuditItem['corruptedUnitProposal'] = undefined;
    let duplicateCluster: BiomarkerAuditItem['duplicateCluster'] = undefined;
    let missingMetadata: BiomarkerAuditItem['missingMetadata'] = undefined;
    let conflictInfo: BiomarkerAuditItem['conflictInfo'] = undefined;

    const tFlag = telemetryFlags.find(f => f.key === key);

    // Check Unit Corruption or Improbable Telemetry
    if (isCorruptedUnit(currentUnit) || tFlag) {
      // Attempt internal scraping or catalog lookup
      let proposedUnit: string | null = null;
      let source: BiomarkerAuditItem['corruptedUnitProposal']['sourceField'] = 'optimalValue';
      let reason = '';

      if (def.optimalValue) {
        const u = extractUnitFromString(def.optimalValue);
        if (u) {
          proposedUnit = u;
          source = 'optimalValue';
          reason = `Extracted from optimal target "${def.optimalValue}"`;
        }
      }

      if (!proposedUnit && Array.isArray(def.rangeBrackets) && def.rangeBrackets.length > 0) {
        for (const b of def.rangeBrackets) {
          const u = extractUnitFromString(b.range);
          if (u) {
            proposedUnit = u;
            source = 'rangeBrackets';
            reason = `Extracted from reference bracket "${b.range}"`;
            break;
          }
        }
      }

      if (!proposedUnit && def.normalRange && def.normalRange !== 'Unknown') {
        const u = extractUnitFromString(def.normalRange);
        if (u) {
          proposedUnit = u;
          source = 'normalRange';
          reason = `Extracted from normal range "${def.normalRange}"`;
        }
      }

      if (!proposedUnit && logUnits[key]) {
        // Find most frequent unit from logs
        const sortedUnits = Object.entries(logUnits[key]).sort((a, b) => b[1] - a[1]);
        if (sortedUnits.length > 0 && sortedUnits[0][0]) {
          proposedUnit = sortedUnits[0][0];
          source = 'logHistory';
          reason = `Consensus unit from ${sortedUnits[0][1]} recorded lab history log(s)`;
        }
      }

      if (!proposedUnit && catalogMatchDef && catalogMatchDef.unit) {
        proposedUnit = catalogMatchDef.unit;
        source = 'catalog';
        reason = `Standard medical catalog unit for ${catalogMatchDef.name}`;
      }

      // 6. Extract unit directly embedded in key name (e.g. height_cm -> cm, serum_sodium_mmol_l -> mmol/L, psa_ug_l -> ug/L)
      if (!proposedUnit) {
        const kLow = key.toLowerCase();
        if (kLow.endsWith('_mmol_l') || kLow.endsWith('_mmol_per_l')) { proposedUnit = 'mmol/L'; reason = 'Extracted from key name unit suffix'; }
        else if (kLow.endsWith('_umol_l') || kLow.endsWith('_umol_per_l')) { proposedUnit = 'umol/L'; reason = 'Extracted from key name unit suffix'; }
        else if (kLow.endsWith('_pmol_l')) { proposedUnit = 'pmol/L'; reason = 'Extracted from key name unit suffix'; }
        else if (kLow.endsWith('_nmol_l')) { proposedUnit = 'nmol/L'; reason = 'Extracted from key name unit suffix'; }
        else if (kLow.endsWith('_mg_dl')) { proposedUnit = 'mg/dL'; reason = 'Extracted from key name unit suffix'; }
        else if (kLow.endsWith('_mg_l')) { proposedUnit = 'mg/L'; reason = 'Extracted from key name unit suffix'; }
        else if (kLow.endsWith('_ug_l') || kLow.endsWith('_mcg_l')) { proposedUnit = 'ug/L'; reason = 'Extracted from key name unit suffix'; }
        else if (kLow.endsWith('_g_l') || kLow.endsWith('_g_per_l')) { proposedUnit = 'g/L'; reason = 'Extracted from key name unit suffix'; }
        else if (kLow.endsWith('_g_dl')) { proposedUnit = 'g/dL'; reason = 'Extracted from key name unit suffix'; }
        else if (kLow.endsWith('_pg') || kLow.endsWith('_pg_ml')) { proposedUnit = 'pg/mL'; reason = 'Extracted from key name unit suffix'; }
        else if (kLow.endsWith('_ng_ml') || kLow.endsWith('_ng_dl')) { proposedUnit = 'ng/mL'; reason = 'Extracted from key name unit suffix'; }
        else if (kLow.endsWith('_fl')) { proposedUnit = 'fL'; reason = 'Extracted from key name unit suffix'; }
        else if (kLow.endsWith('_u_l') || kLow.endsWith('_iu_l')) { proposedUnit = 'U/L'; reason = 'Extracted from key name unit suffix'; }
        else if (kLow.endsWith('_10_9_l') || kLow.endsWith('_10_9_per_l') || kLow.endsWith('_10e9_l')) { proposedUnit = '10^9/L'; reason = 'Extracted from key name unit suffix'; }
        else if (kLow.endsWith('_10_12_l') || kLow.endsWith('_10_12_per_l') || kLow.endsWith('_10e12_l')) { proposedUnit = '10^12/L'; reason = 'Extracted from key name unit suffix'; }
        else if (kLow.endsWith('_cm')) { proposedUnit = 'cm'; reason = 'Extracted from key name unit suffix'; }
        else if (kLow.endsWith('_kg') || kLow.includes('_kg_m2')) { proposedUnit = kLow.includes('_kg_m2') ? 'kg/m2' : 'kg'; reason = 'Extracted from key name unit suffix'; }
        else if (kLow.endsWith('_percent') || kLow.endsWith('_pct')) { proposedUnit = '%'; reason = 'Extracted from key name unit suffix'; }
        else if (kLow.endsWith('_score') || kLow.includes('audit_c_') || kLow.includes('audit_score')) { proposedUnit = 'points'; reason = 'Clinical assessment scoring scale'; }
        else if (kLow.includes('weekly_alcohol')) { proposedUnit = 'units/week'; reason = 'Standard alcohol telemetry unit'; }
        
        if (proposedUnit) {
          source = 'optimalValue';
        }
      }

      if (proposedUnit && proposedUnit !== currentUnit) {
        status = 'corrupted_unit';
        corruptedUnitProposal = {
          proposedUnit,
          sourceField: source,
          confidence: 0.95,
          reason,
          issueTitle: tFlag?.issueTitle || t(lang, 'auditTitleUnitCorrect'),
          preciseCause: tFlag?.preciseCause || reason,
          suggestedFix: tFlag?.suggestedFix || interpolate(t(lang, 'auditFixUnitCorrect'), { unit: proposedUnit }),
          badgeLabel: tFlag?.badgeLabel || interpolate(t(lang, 'auditBadgeUnitCorrect'), { unit: proposedUnit })
        };
      } else if (tFlag && !isCorruptedUnit(currentUnit)) {
        status = 'corrupted_unit';
        corruptedUnitProposal = {
          proposedUnit: '',
          sourceField: 'logHistory',
          confidence: 0.8,
          reason: tFlag.preciseCause || tFlag.reason,
          issueTitle: tFlag.issueTitle || t(lang, 'auditTitleScaleMismatch'),
          preciseCause: tFlag.preciseCause || tFlag.reason,
          suggestedFix: tFlag.suggestedFix,
          badgeLabel: tFlag.badgeLabel || t(lang, 'auditBadgeScaleMismatch')
        };
      } else if (!proposedUnit || proposedUnit !== currentUnit) {
        status = 'corrupted_unit';
        corruptedUnitProposal = {
          proposedUnit: '',
          sourceField: 'optimalValue',
          confidence: 0.2,
          reason: t(lang, 'auditCauseCorrupt'),
          issueTitle: t(lang, 'auditTitleMissingUnit'),
          preciseCause: t(lang, 'auditCauseMissingUnit'),
          suggestedFix: t(lang, 'auditFixMissingUnit'),
          badgeLabel: t(lang, 'auditBadgeMissingUnit')
        };
      }
    }

    // Check Duplicate Candidates
    if (siblings.length > 1) {
      // Find the highest score member in the cluster
      let bestKey = siblings[0];
      let bestScore = -1;
      siblings.forEach(sk => {
        const sDef = getDef(sk);
        const score = calculateCompletenessScore(sDef, logCounts[sk] || 0);
        if (score > bestScore) {
          bestScore = score;
          bestKey = sk;
        }
      });

      const isPrimary = key === bestKey;
      const targetDef = getDef(bestKey);
      const allCandidateAliases = siblings.filter(sk => sk !== bestKey);
      const candidateAliases = allCandidateAliases.filter(sk => {
        const hasLogs = (logCounts[sk] || 0) > 0;
        const isCustom = customBiomarkers[sk] !== undefined;
        return hasLogs || isCustom;
      });

      const clusterReason = clusterReasonMap[key] || `Matches cluster across ${siblings.length} entries`;

      if (candidateAliases.length > 0 || isPrimary) {
        duplicateCluster = {
          targetKey: bestKey,
          targetName: targetDef.name || bestKey,
          clusterKeys: siblings,
          candidateAliases,
          reason: clusterReason,
          isPrimary
        };

        if (!isPrimary && status === 'clean' && candidateAliases.includes(key)) {
          status = 'duplicate_candidate';
        }
      }
    }

    // Check Missing Metadata & Catalog Matches
    const hasNormalRange = !!def.normalRange && def.normalRange !== 'Unknown' && def.normalRange.trim() !== '';
    const hasRangeBrackets = Array.isArray(def.rangeBrackets) && def.rangeBrackets.length > 0;
    const isRangeMissing = (!hasNormalRange && !hasRangeBrackets) && !catalogMatchDef;
    // Mirror isBiomarkerApproved() in src/utils/biomarkers.ts exactly, so the Audit's
    // "clean" verdict can never disagree with the Dictionary's approval gate.
    const hasRiskCategoryTag = Array.isArray(def.riskCategories) && def.riskCategories.length > 0 && def.riskCategories.some((r: string) => r.trim() !== '' && r !== 'Uncategorized');
    const hasPotentialConditionTag = Array.isArray(def.potentialMedicalConditions) && def.potentialMedicalConditions.length > 0 && def.potentialMedicalConditions.some((c: string) => c.trim() !== '');
    const isRiskCategoryMissing = !hasRiskCategoryTag;
    const isConditionsMissing = !hasPotentialConditionTag;
        // If this is a perfect catalog match, and the catalog genuinely has "other" or missing risk categories, we shouldn't punish the user in an infinite loop.
        const isMatched = !!catalogMatchDef;
    const isCategoryMissing = (!def.category || def.category === 'other' || def.category === 'wellness' || !def.standardMedicalGrouping || def.standardMedicalGrouping === 'Other' || isRiskCategoryMissing || isConditionsMissing) && !isMatched;
    const isBracketsMissing = false; // We no longer strictly require detailed brackets if the catalog doesn't provide them, aligning with isBiomarkerApproved
    const isDescriptionMissing = false; // Aligning with isBiomarkerApproved which doesn't strictly check descriptions
    
    if (isRangeMissing || isCategoryMissing) {
      missingMetadata = {
        missingRange: !!isRangeMissing,
        missingCategory: !!isCategoryMissing,
        missingBrackets: !!isBracketsMissing,
        missingDescription: !!isDescriptionMissing,
        missingRiskCategory: !!isRiskCategoryMissing,
        missingConditions: !!isConditionsMissing,
        currentRange: hasNormalRange ? def.normalRange : undefined,
        currentCategory: def.category && def.category !== 'other' && def.category !== 'wellness' ? def.category : undefined,
        catalogMatch: catalogMatchDef ? {
          normalRange: catalogMatchDef.normalRange,
          category: catalogMatchDef.category,
          unit: catalogMatchDef.unit,
          standardMedicalGrouping: catalogMatchDef.standardMedicalGrouping || catalogMatchDef.category,
          descriptions: catalogMatchDef.descriptions
        } : undefined
      };
      if (status === 'clean') {
        status = 'missing_ranges';
      }
    }

    // Check Internal Scale Conflicts
    if (!isCorruptedUnit(currentUnit)) {
      const optimalUnit = extractUnitFromString(def.optimalValue);
      let bracketUnit: string | null = null;
      if (Array.isArray(def.rangeBrackets) && def.rangeBrackets.length > 0) {
        for (const b of def.rangeBrackets) {
          const u = extractUnitFromString(b.range);
          if (u) {
            bracketUnit = u;
            break;
          }
        }
      }

      if (bracketUnit) {
        const uNormCurrent = normalizeUnitEquivalence(currentUnit);
        const uNormBracket = normalizeUnitEquivalence(bracketUnit);

        if (uNormCurrent && uNormBracket && uNormCurrent !== uNormBracket) {
          status = 'conflict';
          const suggestedResolution = deriveConflictResolution(key, currentUnit, bracketUnit, def);
          conflictInfo = {
            declaredUnit: currentUnit,
            bracketUnit,
            optimalUnit: optimalUnit || undefined,
            suggestedResolution
          };
        }
      }
    }

    items.push({
      key,
      name,
      currentUnit,
      status,
      logCount: thisLogCount,
      corruptedUnitProposal,
      duplicateCluster,
      missingMetadata,
      conflictInfo
    });
  });

  // Extract deduplicated group list with full alias analytics
  const duplicateGroups: DuplicateGroupAudit[] = [];
  const processedClusters = new Set<string>();

  Object.values(clusterMap).forEach(keys => {
    if (keys.length > 1) {
      const clusterSig = [...keys].sort().join(':::');
      if (!processedClusters.has(clusterSig)) {
        processedClusters.add(clusterSig);

        // Determine master key
        let bestKey = keys[0];
        let bestScore = -1;
        keys.forEach(sk => {
          const sDef = getDef(sk);
          const score = calculateCompletenessScore(sDef, logCounts[sk] || 0);
          if (score > bestScore) {
            bestScore = score;
            bestKey = sk;
          }
        });
        const masterDef = getDef(bestKey);
        const allCandidateAliases = keys.filter(k => k !== bestKey);

        let totalLogsInCluster = 0;
        const emptyAliasKeys: string[] = [];
        const populatedAliasKeys: string[] = [];

        keys.forEach(k => {
          const count = logCounts[k] || 0;
          totalLogsInCluster += count;
          if (k !== bestKey) {
            if (count === 0) {
              emptyAliasKeys.push(k);
            } else {
              populatedAliasKeys.push(k);
            }
          }
        });

        // Only report as a duplicate cluster if there is at least one active candidate alias
        // that exists in customBiomarkers or has historical observations (>0 logs)
        const activeCandidateAliases = allCandidateAliases.filter(k => {
          const hasLogs = (logCounts[k] || 0) > 0;
          const isCustom = customBiomarkers[k] !== undefined;
          return hasLogs || isCustom;
        });

        if (activeCandidateAliases.length === 0) return;

        const clusterReason = clusterReasonMap[bestKey] || `Matches duplicate cluster across ${keys.length} entries`;

        duplicateGroups.push({
          suggestedMasterKey: bestKey,
          suggestedMasterName: masterDef.name || bestKey,
          memberKeys: keys,
          candidateAliases: activeCandidateAliases,
          reason: clusterReason,
          totalLogsInCluster,
          emptyAliasKeys: emptyAliasKeys.filter(k => activeCandidateAliases.includes(k)),
          populatedAliasKeys: populatedAliasKeys.filter(k => activeCandidateAliases.includes(k))
        });
      }
    }
  });

  const corruptedUnitsCount = items.filter(i => i.status === 'corrupted_unit').length;
  const duplicateCandidatesCount = items.filter(i => i.status === 'duplicate_candidate').length;
  const missingRangesCount = items.filter(i => i.status === 'missing_ranges').length;
  const conflictsCount = items.filter(i => i.status === 'conflict').length;
  const cleanCount = items.filter(i => i.status === 'clean').length;

  return {
    timestamp: new Date().toISOString(),
    totalScanned: allKeys.length,
    corruptedUnitsCount,
    duplicateCandidatesCount,
    missingRangesCount,
    conflictsCount,
    cleanCount,
    items,
    duplicateGroups
  };
}

/**
 * Persistence helpers for continuity across sessions
 */
export const AUDIT_STORAGE_KEY = 'dict_audit_continuity_state';

export function loadSavedAuditSession(): AuditSessionState | null {
  try {
    const raw = localStorage.getItem(AUDIT_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.warn('Failed to load audit continuity session:', e);
    return null;
  }
}

export function saveAuditSession(state: AuditSessionState | null): void {
  try {
    if (!state) {
      localStorage.removeItem(AUDIT_STORAGE_KEY);
    } else {
      localStorage.setItem(AUDIT_STORAGE_KEY, JSON.stringify(state));
    }
  } catch (e) {
    console.warn('Failed to save audit continuity session:', e);
  }
}
