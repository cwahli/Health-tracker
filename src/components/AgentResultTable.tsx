import { toYYYYMMDD } from "../utils/dateUtils";
import React, { useState, useMemo, useEffect, useRef } from 'react';

import { biomarkerDefinitions } from '../utils/biomarkers';
import { t, interpolate } from '../utils/i18n';
import { formatOptimalTargetValue, evaluateRangeBracketMatch } from '../utils/agentCalibration';
import { HealthPlanningResultView } from './HealthPlanningResultView';
import { extractFallbackModifications, getMappedBiomarkerKey } from './chat-cards/BiomarkerReviewCard';
import { enrichReviewModificationCommands, collectCatalogUnitMap } from '../utils/biomarkerLifecycle';
import { 
  Maximize2, 
  Minimize2, 
  ArrowUpDown, 
  AlertCircle, 
  CheckCircle2, 
  HelpCircle,
  TrendingDown,
  TrendingUp,
  Sparkles,
  ArrowRight,
  Loader2,
  Clock
} from 'lucide-react';

interface AgentResultTableProps {
  agentType: 'agent1' | 'agent2' | 'agent3' | 'agent4' | 'data_review' | 'biomarker_review' | 'medical_extract';
  agentResult: any;
  profile?: any;
  biomarkerHistory?: any[];
  initialRawText?: string;
  onApplyChanges?: (filteredRows?: any[]) => Promise<void>;
  onAcceptRecommendations?: (acceptedActions: any[]) => Promise<void>;
  onCancel?: () => void;
  onContinueToNextStep?: (filteredKeys?: string[], filteredRows?: any[]) => Promise<void>;
  isApplying?: boolean;
  liveStreamLogs?: string;
  precedingAgent1Result?: any;
  selectedMissingKeys?: string[];
  onChangeSelectedMissingKeys?: (keys: string[]) => void;
  onSendMessage?: (msg: string) => void;
}

// Robust helper to extract potential biomarker names and values from raw clinical text
export function getInitialMarkersFromText(text: string): string[] {
  if (!text) return [];
  const lines = text.split(/[\n;\r]/);
  const markers: string[] = [];
  
  for (let line of lines) {
    line = line.trim();
    // Ignore lines that are too long, likely general conversation paragraphs
    if (!line || line.length > 120) continue;
    
    // Look for lines containing letters and at least one number
    const hasLetters = /[a-zA-Z]/.test(line);
    const hasNumbers = /\d/.test(line);
    
    if (hasLetters && hasNumbers) {
      const colonIndex = line.indexOf(':');
      const dashIndex = line.indexOf('-');
      let nameCandidate = '';
      
      if (colonIndex > 0) {
        nameCandidate = line.substring(0, colonIndex).trim();
      } else if (dashIndex > 0 && isNaN(Number(line.charAt(dashIndex - 1))) && isNaN(Number(line.charAt(dashIndex + 1)))) {
        nameCandidate = line.substring(0, dashIndex).trim();
      } else {
        const numberMatch = line.match(/\d/);
        if (numberMatch && numberMatch.index !== undefined && numberMatch.index > 0) {
          nameCandidate = line.substring(0, numberMatch.index).trim();
        }
      }
      
      const cleanName = nameCandidate.replace(/[^a-zA-Z0-9\s()]/g, '').trim();
      if (cleanName && cleanName.length > 2 && !cleanName.toLowerCase().includes('http') && !cleanName.toLowerCase().includes('date')) {
        markers.push(cleanName);
      }
    }
  }
  return Array.from(new Set(markers)); // unique list
}

export function getInitialMarkerDetails(text: string): { biomarker: string; value: string; unit: string; date: string }[] {
  const markerNames = getInitialMarkersFromText(text);
  if (markerNames.length === 0) return [];

  // Try to find a date in the overall text
  let detectedDate = '';
  const dateRegex = /\b(\d{4}-\d{2}-\d{2}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/;
  const dateMatch = text.match(dateRegex);
  if (dateMatch) {
    detectedDate = dateMatch[1];
  } else {
    detectedDate = new Date().toISOString().split('T')[0];
  }

  return markerNames.map(name => {
    // Search for the line containing this name to extract value and unit
    const lines = text.split(/[\n;\r]/);
    let value = 'N/A';
    let unit = '';

    for (let line of lines) {
      if (line.toLowerCase().includes(name.toLowerCase())) {
        // Try to extract numeric value from the rest of the line or the line itself
        const numericMatch = line.match(/[\s:]\+?(-?[\d.]+)/) || line.match(/([\d.]+)/);
        if (numericMatch) {
          value = numericMatch[1];
          // Try to extract unit following the number
          const afterNumber = line.substring(numericMatch.index! + numericMatch[0].length).trim();
          const unitMatch = afterNumber.match(/^([a-zA-Z\/%]+)/);
          if (unitMatch) {
            unit = unitMatch[1];
          }
          break;
        }
      }
    }

    return {
      biomarker: name,
      value,
      unit,
      date: detectedDate
    };
  });
}

export function generateSafeKey(name: string): string {
  if (!name) return '';
  const cleanName = name.split('(')[0].split('[')[0].trim();
  return cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}


export const resolveBiomarkerKey = (rawKey: string, rawName: string, profile: any) => {
  const cleanName = (n: string): string => n.split('(')[0].split('[')[0].trim();
  const cleaned = cleanName(String(rawName || rawKey));
  const safeKey = cleaned.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  let key = rawKey || safeKey;
  
  const currentCustoms = profile?.customBiomarkers || {};
  let targetKey = key;
  
  const stdMatch = !currentCustoms[key] ? biomarkerDefinitions.find(d => {
    const nameMatch = d.name.toLowerCase() === cleaned.toLowerCase() || d.key.toLowerCase() === cleaned.toLowerCase() || cleanName(d.name).toLowerCase() === cleaned.toLowerCase();
    return nameMatch;
  }) : null;
  
  if (stdMatch) {
    targetKey = stdMatch.key;
  } else {
    let existingKey = Object.keys(currentCustoms).find(k => {
      const nameMatch = cleanName(currentCustoms[k]?.name || '').toLowerCase() === cleaned.toLowerCase();
      const keyMatch = k.toLowerCase() === cleaned.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      return nameMatch || keyMatch;
    });
    if (existingKey) {
      targetKey = existingKey;
    }
  }
  return targetKey;
};

function sanitizeUnitText(rawUnit: any): string {
  if (!rawUnit) return '';
  return String(rawUnit)
    .toLowerCase()
    .replace(/[\s]+/g, ' ')
    .replace(/²/g, '2')
    .replace(/³/g, '3')
    .replace(/percent/g, '%')
    .replace(/\^/g, '*')
    .replace(/^[a-z]*(?=10)/g, '')
    .replace(/[x×]/g, '')
    .replace(/units\/week/g, 'u/week')
    .replace(/ng\/ml/g, 'ug/l')
    .replace(/^\/[0-9]+$/g, 'score')
    .trim();
}

export const AgentResultTable: React.FC<AgentResultTableProps> = ({
  agentType,
  agentResult,
  profile,
  biomarkerHistory = [],
  initialRawText = '',
  onApplyChanges,
  onAcceptRecommendations,
  onCancel,
  onContinueToNextStep,
  isApplying = false,
  liveStreamLogs,
  precedingAgent1Result,
  selectedMissingKeys,
  onChangeSelectedMissingKeys,
  onSendMessage
}) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [diffExpanded, setDiffExpanded] = useState(false);
  const [sortField, setSortField] = useState<string>('default');
  const [sortAsc, setSortAsc] = useState<boolean>(true);
  const [statusSortCategory, setStatusSortCategory] = useState<'atRisk' | 'isNew' | 'changed' | 'synced' | 'merged' | 'toDelete' | 'isMissing' | null>(null);
  const PAGE_SIZE = 50;
  const [pageStart, setPageStart] = useState(0);

  const [unselectedRowKeys, setUnselectedRowKeys] = useState<string[]>([]);
  const [justApplied, setJustApplied] = useState(false);
  const [localSelectedMissingKeys, setLocalSelectedMissingKeys] = useState<string[]>(() => {
    try {
      const batchIdx = agentResult?.batchIdx;
      if (batchIdx !== undefined && batchIdx !== null) {
        const saved = localStorage.getItem(`batch_${batchIdx}_missing_keys_to_move`);
        if (saved) return JSON.parse(saved);
      }
    } catch (e) {}
    return [];
  });

  const isControlled = selectedMissingKeys !== undefined;
  const effectiveSelectedMissingKeys = isControlled ? selectedMissingKeys : localSelectedMissingKeys;

  const handleSelectedMissingKeysChange = (newKeys: string[]) => {
    if (!isControlled) {
      setLocalSelectedMissingKeys(newKeys);
    }
    if (onChangeSelectedMissingKeys) {
      onChangeSelectedMissingKeys(newKeys);
    }
    try {
      const batchIdx = agentResult?.batchIdx;
      if (batchIdx !== undefined && batchIdx !== null) {
        localStorage.setItem(`batch_${batchIdx}_missing_keys_to_move`, JSON.stringify(newKeys));
      }
    } catch (e) {}
  };

  const isMultiphaseActive = !!(agentResult?.status === 'needs_continuation' || agentResult?.needsContinuation || agentResult?.hasMore || agentResult?.hasMoreMarkers);
  const totalEstimated = agentResult?.estimatedTotalMarkers || agentResult?.planningDetails?.estimatedTotalMetrics || (isMultiphaseActive ? 60 : 0);

  // Helper to identify if a biomarker in Step 2 was merged from other markers in Step 1
  const mergedInfoForStep2 = useMemo(() => {
    if (agentType !== 'agent2' || !precedingAgent1Result) return {};
    
    // Let's run a simplified version of Step 1 parsing and matching to see what merged where.
    let parsedRows: any[] = [];
    const text = precedingAgent1Result.extractedData || precedingAgent1Result.text || '';
    if (text && typeof text === 'string') {
      let cleanText = text;
      if (text.includes('```yaml')) {
        cleanText = text.split('```yaml')[1].split('```')[0].trim();
      } else if (text.includes('```')) {
        cleanText = text.split('```')[1].split('```')[0].trim();
      }
      try {
        const parsed = JSON.parse(cleanText);
        if (Array.isArray(parsed)) {
          parsedRows = parsed;
        } else if (parsed && typeof parsed === 'object') {
          const possibleArray = parsed.biomarkers || parsed.extracted || parsed.data || parsed.metrics || parsed.results;
          if (Array.isArray(possibleArray)) {
            parsedRows = possibleArray;
          }
        }
      } catch (e) {}
    }

    // If no parsedRows, check if batchBiomarkers exists
    const rawItems = precedingAgent1Result.batchBiomarkers || [];
    if (parsedRows.length === 0 || rawItems.length === 0) return {};

    // Run same alignment
    const parsedToRawGroup: { [idx: number]: any[] } = {};
    rawItems.forEach((raw: any) => {
      const rawKey = String(raw.key || '').toLowerCase();
      const rawName = String(raw.name || '').toLowerCase();
      
      let bestParsedIdx = -1;
      let bestScore = -1;
      
      parsedRows.forEach((parsed: any, idx: number) => {
        const parsedKey = String(parsed.key || parsed.biomarker || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        const parsedName = String(parsed.name || parsed.biomarker || '').toLowerCase();
        const explanation = String(parsed.explanation || parsed.changeReason || parsed.description || '').toLowerCase();
        
        let score = 0;
        const cleanRawKey = rawKey.replace(/[^a-z0-9]/g, '');
        const cleanParsedKey = parsedKey.replace(/[^a-z0-9]/g, '');
        const cleanRawName = rawName.replace(/[^a-z0-9]/g, '');
        const cleanParsedName = parsedName.replace(/[^a-z0-9]/g, '');
        
        if (cleanRawKey === cleanParsedKey || cleanRawName === cleanParsedName) {
          score += 100;
        } else if (cleanRawKey.includes(cleanParsedKey) || cleanParsedKey.includes(cleanRawKey)) {
          score += 40;
        } else if (cleanRawName.includes(cleanParsedName) || cleanParsedName.includes(cleanRawName)) {
          score += 40;
        }
        if (explanation.includes(rawKey) || explanation.includes(rawName)) {
          score += 80;
        }
        const rawKeyPart = rawKey.replace(/_10_9_l|_g_l|_umol_l|_10_12_l/g, '');
        if (rawKeyPart && rawKeyPart.length > 3 && parsedKey.includes(rawKeyPart)) {
          score += 30;
        }
        if (raw.value !== undefined && parsed.value !== undefined && Number(raw.value) === Number(parsed.value)) {
          if (cleanRawName.slice(0, 5) === cleanParsedName.slice(0, 5)) {
            score += 50;
          }
        }
        if (score > bestScore) {
          bestScore = score;
          bestParsedIdx = idx;
        }
      });

      if (bestScore > 15 && bestParsedIdx !== -1) {
        if (!parsedToRawGroup[bestParsedIdx]) {
          parsedToRawGroup[bestParsedIdx] = [];
        }
        parsedToRawGroup[bestParsedIdx].push({ raw });
      }
    });

    // Now, build a map from standard biomarker name to its mergedFrom list
    const mergeMap: { [key: string]: { isMerged: boolean, mergedFrom: string[] } } = {};
    parsedRows.forEach((parsed, idx) => {
      const matches = parsedToRawGroup[idx] || [];
      if (matches.length > 1) {
        const parsedName = parsed.name || parsed.biomarker || '';
        const key = resolveBiomarkerKey(parsedName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''), parsedName, profile);
        
        // Primary raw item (closest value)
        let primaryMatch = matches[0];
        let minDiff = Infinity;
        matches.forEach((m: any) => {
          if (m.raw.value !== undefined && parsed.value !== undefined) {
            const diff = Math.abs(Number(m.raw.value) - Number(parsed.value));
            if (diff < minDiff) {
              minDiff = diff;
              primaryMatch = m;
            }
          }
        });

        const otherMatches = matches.filter((m: any) => m.raw.key !== primaryMatch.raw.key);
        const mergedFrom = otherMatches.map((m: any) => m.raw.name || m.raw.key);
        
        if (mergedFrom.length > 0) {
          mergeMap[key] = {
            isMerged: true,
            mergedFrom
          };
        }
      }
    });

    return mergeMap;
  }, [agentType, precedingAgent1Result]);

  // 1. Parse and extract rows depending on agentType
  const isKeyMarkedNotUsed = (checkKey: string, checkName?: string): boolean => {
    const checkOneMap = (notUsedMap: any): boolean => {
      if (!notUsedMap) return false;
      if (notUsedMap[checkKey]) return true;
      const kLower = String(checkKey || '').toLowerCase();
      if (Object.keys(notUsedMap).some(nok => nok.toLowerCase() === kLower)) return true;
      if (checkName) {
        const nameKey = String(checkName).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        if (notUsedMap[nameKey]) return true;
      }
      return false;
    };
    return checkOneMap(profile?.notUsedBiomarkers) || checkOneMap(profile?.notUsedInMedicalHistory);
  };

  const tableData = useMemo(() => {
    if (!agentResult) return [];

    if (agentType === 'agent1') {
      // Step 1: Clinical Data Parser (from YAML)
      const jsonText = agentResult.filledRows || agentResult.extractedData || agentResult;
      let parsedRows: any[] = [];
      
      if (Array.isArray(jsonText)) {
        parsedRows = jsonText;
      } else if (jsonText && typeof jsonText === 'object') {
        const possibleArray = jsonText.extractedBiomarkers || jsonText.biomarkers || jsonText.extracted || jsonText.data || jsonText.metrics || jsonText.results || jsonText.calibratedBiomarkers;
        if (Array.isArray(possibleArray)) {
          parsedRows = possibleArray;
        } else {
          const arrays = Object.values(jsonText).filter(v => Array.isArray(v));
          if (arrays.length > 0) {
            parsedRows = arrays[0] as any[];
          }
        }
      } else if (typeof jsonText === 'string') {
        const cleanText = jsonText.replace(/```(?:yaml|json)?/gi, '').trim();
        try {
          const parsed = JSON.parse(cleanText);
          if (Array.isArray(parsed)) {
            parsedRows = parsed;
          } else if (parsed && typeof parsed === 'object') {
            const possibleArray = parsed.biomarkers || parsed.extracted || parsed.data || parsed.metrics || parsed.results;
            if (Array.isArray(possibleArray)) {
              parsedRows = possibleArray;
            } else {
              const arrays = Object.values(parsed).filter(v => Array.isArray(v));
              if (arrays.length > 0) {
                parsedRows = arrays[0] as any[];
              }
            }
          }
        } catch (e) {
          // Robust line-by-line regex fallback parser if YAML parser errors out
          const lines = cleanText.split('\n');
          let current: any = {};
          for (let line of lines) {
            line = line.trim();
            if (line.startsWith('-') || line.startsWith('biomarker:')) {
              if (current.biomarker) parsedRows.push(current);
              current = {};
            }
            const bioMatch = line.match(/(?:-\s+)?biomarker:\s*(.*)/i);
            if (bioMatch) { current.biomarker = bioMatch[1].replace(/['"]/g, '').trim(); }
            const dateMatch = line.match(/date:\s*(.*)/i);
            if (dateMatch) { current.date = dateMatch[1].replace(/['"]/g, '').trim(); }
            const valMatch = line.match(/value:\s*(.*)/i);
            if (valMatch) { current.value = valMatch[1].replace(/['"]/g, '').trim(); }
            const unitMatch = line.match(/unit:\s*(.*)/i);
            if (unitMatch) { current.unit = unitMatch[1].replace(/['"]/g, '').trim(); }
          }
          if (current.biomarker) parsedRows.push(current);
        }
      }

      if (parsedRows.length === 0) {
        if (initialRawText) {
          const details = getInitialMarkerDetails(initialRawText);
          parsedRows = Array.isArray(details) ? details.map(d => ({

            biomarker: d.biomarker,
            date: d.date,
            value: d.value,
            unit: d.unit,
            noChangeNeeded: true
          
          })) : [];
        } else if (biomarkerHistory && biomarkerHistory.length > 0) {
          // Collect all unique biomarker keys and their latest entries from history
          const latestEntries: { [key: string]: { value: any, date: string } } = {};
          [...biomarkerHistory].filter(log => log && log.date).sort((a, b) => toYYYYMMDD(String(a.date)).localeCompare(toYYYYMMDD(String(b.date)))).forEach(log => {
            Object.entries(log.biomarkers || {}).forEach(([k, v]) => {
              latestEntries[k] = { value: v, date: log.date };
            });
          });

          parsedRows = Object.entries(latestEntries).map(([k, entry]) => {
            const customDef = profile?.customBiomarkers?.[k];
            const name = customDef?.name || k.replace(/_/g, ' ').toUpperCase();
            const unit = customDef?.unit || '';
            return {
              biomarker: name,
              date: entry.date,
              value: entry.value,
              unit,
              noChangeNeeded: true
            };
          });
        }
      }

      parsedRows = parsedRows.filter((p: any) => p && typeof p === 'object').map((p: any) => {
    if (p.numeric_value !== undefined && p.numeric_value !== null) p.value = p.numeric_value;
    else if (p.qualitative_value !== undefined && p.qualitative_value !== null) p.value = p.qualitative_value;
    return p;
  });
      // Advanced alignment mapping with raw batch input (if available)
      if (agentResult?.batchBiomarkers && Array.isArray(agentResult.batchBiomarkers) && agentResult.batchBiomarkers.length > 0) {
        const rawItems = agentResult.batchBiomarkers;
        
        // 1. Map each raw item to parsedRows by finding the highest matching score
        const rawMatches = rawItems.map((raw: any) => {
          const rawKey = String(raw.key || '').toLowerCase();
          const rawName = String(raw.name || '').toLowerCase();
          
          let bestParsedIdx = -1;
          let bestScore = -1;
          
          parsedRows.forEach((parsed: any, idx: number) => {
            const parsedKey = String(parsed.key || parsed.biomarker || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
            const parsedName = String(parsed.name || parsed.biomarker || '').toLowerCase();
            const explanation = String(parsed.explanation || parsed.changeReason || parsed.description || '').toLowerCase();
            
            let score = 0;
            
            // Text comparison scores
            const cleanRawKey = rawKey.replace(/[^a-z0-9]/g, '');
            const cleanParsedKey = parsedKey.replace(/[^a-z0-9]/g, '');
            const cleanRawName = rawName.replace(/[^a-z0-9]/g, '');
            const cleanParsedName = parsedName.replace(/[^a-z0-9]/g, '');
            
            if (cleanRawKey === cleanParsedKey || cleanRawName === cleanParsedName) {
              score += 100;
            } else if (cleanRawKey.includes(cleanParsedKey) || cleanParsedKey.includes(cleanRawKey)) {
              score += 40;
            } else if (cleanRawName.includes(cleanParsedName) || cleanParsedName.includes(cleanRawName)) {
              score += 40;
            }
            
            // Substring or explanation search
            if (explanation.includes(rawKey) || explanation.includes(rawName)) {
              score += 80;
            }
            const rawKeyPart = rawKey.replace(/_10_9_l|_g_l|_umol_l|_10_12_l/g, '');
            if (rawKeyPart && rawKeyPart.length > 3 && parsedKey.includes(rawKeyPart)) {
              score += 30;
            }
            
            if (raw.value !== undefined && parsed.value !== undefined && Number(raw.value) === Number(parsed.value)) {
              if (cleanRawName.slice(0, 5) === cleanParsedName.slice(0, 5)) {
                score += 50;
              }
            }
            
            if (score > bestScore) {
              bestScore = score;
              bestParsedIdx = idx;
            }
          });
          
          return {
            raw,
            parsedIdx: bestScore > 15 ? bestParsedIdx : -1,
            score: bestScore
          };
        });

        // 2. For each parsed row, identify its associated raw items
        const parsedToRawGroup: { [idx: number]: any[] } = {};
        rawMatches.forEach((match: any) => {
          if (match.parsedIdx !== -1) {
            if (!parsedToRawGroup[match.parsedIdx]) {
              parsedToRawGroup[match.parsedIdx] = [];
            }
            parsedToRawGroup[match.parsedIdx].push(match);
          }
        });

        // For each parsed row, decide which raw item is the "primary" (kept) and which are "secondary" (merged/discarded)
        const parsedPrimaryRaw: { [idx: number]: any } = {};
        const secondaryRawMatches: any[] = [];
        
        Object.entries(parsedToRawGroup).forEach(([idxStr, matches]) => {
          const idx = parseInt(idxStr);
          const parsed = parsedRows[idx];
          
          // Match primary raw item (closest value)
          let primaryMatch = matches[0];
          let minDiff = Infinity;
          matches.forEach((m: any) => {
            if (m.raw.value !== undefined && parsed.value !== undefined) {
              const diff = Math.abs(Number(m.raw.value) - Number(parsed.value));
              if (diff < minDiff) {
                minDiff = diff;
                primaryMatch = m;
              }
            }
          });
          
          parsedPrimaryRaw[idx] = primaryMatch.raw;
          
          // The other matches are secondary/merged
          matches.forEach((m: any) => {
            if (m.raw.key !== primaryMatch.raw.key) {
              secondaryRawMatches.push({
                raw: m.raw,
                parsedIdx: idx,
                parentParsed: parsed
              });
            }
          });
        });

        const unmappedRawMatches = rawMatches.filter((m: any) => m.parsedIdx === -1);

        // 3. Construct the table rows for each parsed row
        const primaryRows = parsedRows.map((parsed: any, idx: number) => {
          const raw = parsedPrimaryRaw[idx];
          const rawName = raw ? raw.name : '';
          const rawKey = raw ? raw.key : '';
          const rawUnit = raw ? (raw.unit || raw.metric || '') : '';
          
          const biomarkerName = parsed.standardizedName || parsed.name || parsed.biomarker || 'Unknown';
          const cleanName = (n: string): string => n.split('(')[0].split('[')[0].trim();
          const cleaned = cleanName(String(parsed.key || biomarkerName));
          const safeKey = cleaned.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
          let key = resolveBiomarkerKey(safeKey || String(parsed.key || biomarkerName), biomarkerName, profile);
          
          const existingEntries = (biomarkerHistory || []).filter((h: any) => h?.biomarkers?.[key] !== undefined);
          const hasLegacyProfileData = profile?.biomarkers?.[key] !== undefined;
          const customDef = profile?.customBiomarkers?.[key];
          const normalRange = customDef?.normalRange || '';
          const valueNum = parseFloat(parsed.value);
          
          let isAtRisk = false;
          if (false) {
            const rangeMatch = normalRange.match(/([\d.]+)\s*-\s*([\d.]+)/);
            if (rangeMatch) {
              const min = parseFloat(rangeMatch[1]);
              const max = parseFloat(rangeMatch[2]);
              if (valueNum < min || valueNum > max) {
                isAtRisk = true;
              }
            }
          }

          const isRenamed = (rawName && rawName !== biomarkerName) || (parsed.originalName && parsed.originalName !== parsed.standardizedName);
          const rowUnit = parsed.unit || parsed.metric || '';
          const isUnitChanged = rawUnit && sanitizeUnitText(rawUnit) !== sanitizeUnitText(rowUnit);
          
          const newGroup = parsed.standardMedicalGrouping || 'Other';
          const oldGroup = customDef?.standardMedicalGrouping || 'Other';
          const isGroupChanged = false;
          const oldRiskCategories = customDef?.riskCategories || [];
          const isRiskChanged = !!customDef && JSON.stringify([...(parsed.riskCategories || [])].sort()) !== JSON.stringify([...oldRiskCategories].sort());
          const oldConditions = customDef?.potentialMedicalConditions || [];
          const isConditionsChanged = !!customDef && JSON.stringify([...(parsed.potentialMedicalConditions || [])].sort()) !== JSON.stringify([...oldConditions].sort());
          
          const isNewInHistory = existingEntries.length === 0 && !hasLegacyProfileData;
          const isRenamedOrUnitOrGroupChanged = isRenamed || isUnitChanged || isGroupChanged;
          
          const isMerged = parsedToRawGroup[idx] && parsedToRawGroup[idx].length > 1;
          const otherMatches = parsedToRawGroup[idx]?.filter((m: any) => m.raw.key !== rawKey) || [];
          const mergedFrom = otherMatches.map((m: any) => m.raw.name || m.raw.key);

          // CRITICAL: status shouldn't be new if it's a name change or unit change or grouping change. It should just be "Changed", or if it's merged it's "Merged"
          const isNew = isNewInHistory && !isRenamedOrUnitOrGroupChanged && !isMerged;

          const exactMatch = existingEntries.find((h: any) => toYYYYMMDD(String(h.date)) === toYYYYMMDD(String(resolvedDate)));
          const matchVal = exactMatch?.biomarkers?.[key];
          const isValueSame = matchVal !== undefined && (parseFloat(String(matchVal)) === parseFloat(String(parsed.value)) || String(matchVal).toLowerCase().trim() === String(parsed.value).toLowerCase().trim());
          
          const isChanged = (isRenamedOrUnitOrGroupChanged || (!isNewInHistory && existingEntries.length > 0 && !isValueSame)) && !isMerged;
          
          let changeReason = parsed.changeReason || parsed.explanation || '';
          if (!changeReason) {
            if (isRenamed && isUnitChanged && isGroupChanged) {
              changeReason = `Standardized from raw '${rawName}', unit mapped to '${rowUnit}', and medical grouping changed from '${oldGroup}' to '${newGroup}'.`;
            } else if (isRenamed && isGroupChanged) {
              changeReason = `Standardized from raw '${rawName}' and medical grouping changed from '${oldGroup}' to '${newGroup}'.`;
            } else if (isUnitChanged && isGroupChanged) {
              changeReason = `Standardized unit to '${rowUnit}' and medical grouping changed from '${oldGroup}' to '${newGroup}'.`;
            } else if (isGroupChanged) {
              changeReason = `Medical grouping changed from '${oldGroup}' to '${newGroup}'.`;
            } else if (isRenamed && isUnitChanged) {
              changeReason = `Standardized from raw '${rawName}' and unit mapped to '${rowUnit}'.`;
            } else if (isRenamed) {
              changeReason = `Standardized from raw '${rawName}'.`;
            } else if (isUnitChanged) {
              changeReason = `Standardized unit to '${rowUnit}'.`;
            } else {
              changeReason = `Extracted new biomarker reading.`;
            }
          }

          if (isMerged && mergedFrom.length > 0) {
            changeReason = `Merged from ${mergedFrom.join(', ')}. ${changeReason}`;
          }

          const explanation = parsed.explanation || parsed.changeReason || parsed.description || '';

          // Look up raw date if available
          let resolvedDate = parsed.date || 'N/A';
          if (rawKey) {
            const historyDates = biomarkerHistory
              .filter((h: any) => h?.biomarkers?.[rawKey] !== undefined)
              .map((h: any) => h.date);
            if (historyDates.length > 0) {
              resolvedDate = historyDates[0];
            }
          }

          return {
            key,
            biomarker: biomarkerName,
            oldName: rawName,
            isRenamed,
            isUnitChanged,
            oldUnit: rawUnit,
            date: resolvedDate,
            value: parsed.value ?? 'N/A',
            unit: rowUnit,
            isNew,
            isNewBiomarker: isNew && isNewInHistory,
            isNotUsed: isKeyMarkedNotUsed(key, biomarkerName),
            isChanged,
            isAtRisk,
            isMerged,
            mergedFrom,
            isPrimary: true,
            severity: isAtRisk ? 1 : 0,
            normalRange,
            changeReason,
            riskReason: isAtRisk ? `Value ${parsed.value} ${rowUnit} is outside normal range (${normalRange})` : '',
            description: explanation,
            standardMedicalGrouping: parsed.standardMedicalGrouping || 'Other',
            isGroupChanged,
            oldGroup,
            riskCategories: parsed.riskCategories || [],
            oldRiskCategories,
            isRiskChanged,
            potentialMedicalConditions: parsed.potentialMedicalConditions || [],
            oldConditions,
            isConditionsChanged
          };
        });

        // 4. Construct secondary/merged (discarded) items
        const secondaryRows = secondaryRawMatches.map((m: any) => {
          const raw = m.raw;
          const parentParsed = m.parentParsed;
          const parentBiomarkerName = parentParsed.name || parentParsed.biomarker || 'Unknown';
          
          let resolvedDate = parentParsed.date || 'N/A';
          const historyDates = biomarkerHistory
            .filter((h: any) => h?.biomarkers?.[raw.key] !== undefined)
            .map((h: any) => h.date);
          if (historyDates.length > 0) {
            resolvedDate = historyDates[0];
          }

          const hasDifferentDate = resolvedDate !== 'N/A' && parentParsed.date && resolvedDate !== parentParsed.date;

          return {
            key: raw.key,
            biomarker: parentBiomarkerName,
            oldName: raw.name,
            isRenamed: true,
            isUnitChanged: false,
            oldUnit: raw.unit || '',
            date: resolvedDate,
            value: raw.value ?? 'N/A',
            unit: parentParsed.metric || parentParsed.unit || '',
            isNew: false,
            isChanged: hasDifferentDate,
            isAtRisk: false,
            isSecondary: true,
            // If the dates are different, keep it as "Changed" (Merged Kept), otherwise "To Delete"
            status: hasDifferentDate ? 'Changed' : 'To Delete',
            severity: 0,
            normalRange: '',
            changeReason: hasDifferentDate 
              ? `Logged on different date (${resolvedDate}) under standardized key '${parentBiomarkerName}'.`
              : `Merged into '${parentBiomarkerName}' and discarded.`,
            riskReason: '',
            description: hasDifferentDate 
              ? `Deduplicated raw reading kept on separate date ${resolvedDate}.`
              : `Deduplicated raw reading. Merged with value ${parentParsed.value}.`,
            standardMedicalGrouping: parentParsed.standardMedicalGrouping || 'Other',
            riskCategories: parentParsed.riskCategories || [],
            potentialMedicalConditions: parentParsed.potentialMedicalConditions || []
          };
        });

        // 5. Construct unmapped items as "To Delete"
        const unmappedRows = unmappedRawMatches.map((m: any) => {
          const raw = m.raw;
          return {
            key: raw.key,
            biomarker: raw.name,
            oldName: raw.name,
            isRenamed: false,
            isUnitChanged: false,
            oldUnit: raw.unit || '',
            date: 'N/A',
            value: raw.value ?? 'N/A',
            unit: raw.unit || '',
            isNew: false,
            isChanged: false,
            isAtRisk: false,
            isSecondary: true,
            status: 'To Delete',
            severity: 0,
            normalRange: '',
            changeReason: `Discarded during clinical standardization.`,
            riskReason: '',
            description: `Unmapped raw reading.`,
            standardMedicalGrouping: 'Other',
            riskCategories: [],
            potentialMedicalConditions: []
          };
        });

        const finalRows = [...primaryRows, ...secondaryRows, ...unmappedRows];

        // Identify the missing items and append directly to tableData!
        if (agentResult?.batchBiomarkers && Array.isArray(agentResult.batchBiomarkers)) {
          const initialNames = agentResult.batchBiomarkers.map((b: any) => b.name || b.key || '');
          const missingItems = agentResult.batchBiomarkers.filter((bm: any) => {
            const initName = bm.name || bm.key || '';
            if (!initName) return false;
            const cleanInit = String(initName).toLowerCase().replace(/[^a-z0-9]/g, '');
            
            // Not in any finalRows
            return !finalRows.some(row => {
              const cleanRow = String(row.biomarker || '').toLowerCase().replace(/[^a-z0-9]/g, '');
              const cleanOld = String(row.oldName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
              const cleanKey = String(row.key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
              return cleanRow === cleanInit || cleanOld === cleanInit || cleanKey === cleanInit;
            });
          });

          missingItems.forEach((bm: any) => {
            const key = bm.key || bm.name?.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown_biomarker';
            finalRows.push({
              key,
              biomarker: bm.name || bm.key || 'Unknown',
              oldName: bm.name || bm.key || 'Unknown',
              isRenamed: false,
              isUnitChanged: false,
              oldUnit: bm.unit || '',
              date: 'N/A',
              value: bm.value ?? 'N/A',
              unit: bm.unit || '',
              isNew: false,
              isChanged: false,
              isAtRisk: false,
              isSecondary: false,
              isMissing: true, // Mark as missing!
              status: 'Missing',
              severity: 0,
              normalRange: '',
              changeReason: `Omitted during extraction. Select checkbox to move to next batch.`,
              riskReason: '',
              description: `Missing raw reading from source text.`,
              standardMedicalGrouping: 'Other',
              riskCategories: [],
              potentialMedicalConditions: []
            });
          });
        }

        // Also append any unmappedTests that are not already in finalRows!
        if (agentResult?.unmappedTests && Array.isArray(agentResult.unmappedTests)) {
          agentResult.unmappedTests.forEach((test: any) => {
            const rawName = test?.raw_name || (typeof test === 'string' ? test : '');
            if (!rawName) return;
            const suggested_key = test?.suggested_key || rawName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
            
            // Check if already in finalRows (either as key, biomarker, or oldName)
            const cleanRawName = rawName.toLowerCase().replace(/[^a-z0-9]/g, '');
            const cleanSuggestedKey = suggested_key.toLowerCase().replace(/[^a-z0-9]/g, '');
            
            const alreadyExists = finalRows.some(row => {
              const cleanRow = String(row.biomarker || '').toLowerCase().replace(/[^a-z0-9]/g, '');
              const cleanOld = String(row.oldName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
              const cleanKey = String(row.key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
              return cleanRow === cleanRawName || cleanOld === cleanRawName || cleanKey === cleanSuggestedKey || cleanKey === cleanRawName;
            });
            
            if (!alreadyExists) {
              const testVal = test?.numeric_value ?? test?.qualitative_value ?? test?.value ?? 'N/A';
              const testDate = test?.date || test?.logDate || 'N/A';
              const testUnit = test?.unit || '';
              const isHasValue = testVal !== 'N/A' && testVal !== null && testVal !== '';

              finalRows.push({
                key: suggested_key,
                biomarker: rawName,
                oldName: rawName,
                isRenamed: false,
                isUnitChanged: false,
                oldUnit: testUnit,
                date: testDate,
                value: testVal,
                unit: testUnit,
                isNew: true,
                isNewBiomarker: true,
                isNotUsed: isKeyMarkedNotUsed(suggested_key, rawName),
                isChanged: false,
                isAtRisk: false,
                isSecondary: false,
                isMissing: !isHasValue,
                status: isHasValue ? 'New' : 'Unmapped',
                severity: 0,
                normalRange: '',
                changeReason: isHasValue 
                  ? `New custom biomarker reading extracted from source text.` 
                  : `Detected in source text. Select checkbox to approve/add as custom biomarker.`,
                riskReason: '',
                description: test?.explanation || `Unmapped biomarker found in raw clinical records.`,
                standardMedicalGrouping: test?.standardMedicalGrouping || 'Other',
                riskCategories: test?.riskCategories || [],
                potentialMedicalConditions: test?.potentialMedicalConditions || []
              });
            }
          });
        }

        return finalRows;
      }

      // Fallback standard mapping when batchBiomarkers is not available
      const finalRowsFallback = parsedRows.map((row: any) => {
        const biomarkerName = row.biomarker || row.name || row.key || 'Unknown';
        const cleanName = (n: string): string => n.split('(')[0].split('[')[0].trim();
        const cleaned = cleanName(String(biomarkerName));
        const safeKey = cleaned.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        let key = resolveBiomarkerKey(safeKey || String(biomarkerName), biomarkerName, profile);

        const existingEntries = (biomarkerHistory || []).filter((h: any) => h?.biomarkers?.[key] !== undefined);
        const hasLegacyProfileData = profile?.biomarkers?.[key] !== undefined;
        let isNew = row.noChangeNeeded ? false : (existingEntries.length === 0 && !hasLegacyProfileData);

        const customDef = profile?.customBiomarkers?.[key];
        const normalRange = customDef?.normalRange || '';
        const valueNum = parseFloat(row.value);
        let isAtRisk = false;

        if (false) {
          const rangeMatch = normalRange.match(/([\d.]+)\s*-\s*([\d.]+)/);
          if (rangeMatch) {
            const min = parseFloat(rangeMatch[1]);
            const max = parseFloat(rangeMatch[2]);
            if (valueNum < min || valueNum > max) {
              isAtRisk = true;
            }
          }
        }

        let rowUnit = row.unit || row.metric || '';
        const dictUnit = customDef?.unit || '';
        if (rowUnit.trim() === '' || rowUnit.trim() === '-' || rowUnit.trim().toLowerCase() === 'n/a') {
            rowUnit = dictUnit;
        }
        const newGroup = row.standardMedicalGrouping || 'Other';
        const oldGroup = customDef?.standardMedicalGrouping || 'Other';
        const isGroupChanged = false;

        const isSameUnit = (unit1: string, unit2: string) => {
          if (!unit1 || !unit2) return unit1 === unit2;
          return sanitizeUnitText(unit1) === sanitizeUnitText(unit2);
        };
        const normalizeDate = (d: string) => {
          if (!d) return d;
          return toYYYYMMDD(d);
        };
        const normalizedRowDate = normalizeDate(row.date);

        let changeReason = row.noChangeNeeded
          ? `No changes needed. Entry is already up-to-date.`
          : `Extracted new ${biomarkerName}: ${typeof row.value === 'object' ? JSON.stringify(row.value) : String(row.value || '')} ${rowUnit}`;
        let oldValue: any = undefined;
        let oldUnit: any = undefined;
        let isChanged = false;
        let isSynced = false;
        let isUnitChanged = false;

        if (!row.noChangeNeeded && !isNew && existingEntries.length > 0) {
          const exactMatch = existingEntries.find((h: any) => normalizeDate(h.date) === normalizedRowDate && h?.biomarkers?.[key] !== undefined);
          if (exactMatch) {
            const matchVal = exactMatch.biomarkers?.[key];
            const dictUnit = customDef?.unit || '';
            const numMatchVal = parseFloat(matchVal);
            const numRowVal = parseFloat(row.value);
            let isValueMatch = (!isNaN(numMatchVal) && !isNaN(numRowVal) && numMatchVal === numRowVal) || String(matchVal).toLowerCase().trim() === String(row.value).toLowerCase().trim();

            if (!isValueMatch && !isNaN(numMatchVal) && !isNaN(numRowVal)) {
              if (key === "hematocrit") {
                if (Math.abs(numMatchVal * 100 - numRowVal) < 0.01 || Math.abs(numRowVal * 100 - numMatchVal) < 0.01) {
                  isValueMatch = true;
                }
              } else if (key === "total_cholesterol" || key === "cholesterol" || key.includes("cholesterol") || key === "hdl_cholesterol" || key === "ldl_cholesterol") {
                const ratio = numMatchVal / numRowVal;
                if (Math.abs(ratio - 0.02586) < 0.001 || Math.abs(ratio - (1 / 0.02586)) < 0.05) {
                  isValueMatch = true;
                }
              } else if (key === "triglycerides") {
                const ratio = numMatchVal / numRowVal;
                if (Math.abs(ratio - 0.0113) < 0.001 || Math.abs(ratio - (1 / 0.0113)) < 0.05) {
                  isValueMatch = true;
                }
              }
            }

            if (isValueMatch && (!dictUnit || isSameUnit(rowUnit, dictUnit))) {
              isSynced = true;
              changeReason = "Already logged";
            } else if (isValueMatch && dictUnit && !isSameUnit(rowUnit, dictUnit)) {
              isUnitChanged = true;
              oldUnit = dictUnit;
              console.warn(`[UnitCompare] ${biomarkerName} (${key}): extracted unit=${rowUnit}, saved unit=${dictUnit} (source: profile.customBiomarkers, last updated ${customDef?.updatedAt || 'unknown'}). Saved unit is not a verified clinical/SI standard — it is simply the unit first recorded for this biomarker.`);
              changeReason = `Unit differs from your saved record: this extracted value uses ${rowUnit}, your saved history uses ${dictUnit}. Convert this new value to match your saved unit (${dictUnit})?`;
            } else {
              oldValue = matchVal;
              isChanged = true;
              changeReason = `Value discrepancy for ${row.date}: existing was ${matchVal}, extracted is ${row.value}`;
            }
          } else {
            const sortedHistory = [...existingEntries].sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));
            const latestVal = sortedHistory[0]?.biomarkers?.[key];
            if (latestVal !== undefined) {
              isNew = true;
              isChanged = false;
              changeReason = "New reading";
            }
          }
        }

        const riskReason = isAtRisk
          ? `Value ${typeof row.value === 'object' ? JSON.stringify(row.value) : String(row.value || '')} ${rowUnit} is outside normal range (${normalRange})`
          : '';

        const explanation = row.explanation || row.changeReason || row.description || '';

        return {
          key,
          biomarker: biomarkerName,
          date: row.date || 'N/A',
          value: row.value ?? 'N/A',
          unit: rowUnit,
          isNew,
          isNewBiomarker: isNew && existingEntries.length === 0 && !hasLegacyProfileData,
          isNotUsed: isKeyMarkedNotUsed(key, biomarkerName),
          isChanged,
          isSynced,
          isUnitChanged,
          oldValue,
          oldUnit,
          isAtRisk,
          severity: isAtRisk ? 1 : 0,
          normalRange,
          changeReason,
          riskReason,
          description: explanation,
          standardMedicalGrouping: row.standardMedicalGrouping || 'Other',
          isGroupChanged,
          oldGroup,
          riskCategories: row.riskCategories || [],
          potentialMedicalConditions: row.potentialMedicalConditions || []
        };
      });

      // Find missing biomarkers if fallback
      const initialMarkers = getInitialMarkersFromText(initialRawText);
      const missingList = initialMarkers.filter(initName => {
        const cleanInit = String(initName).toLowerCase().replace(/[^a-z0-9]/g, '');
        return !finalRowsFallback.some((row: any) => {
          const cleanRow = String(row.biomarker || '').toLowerCase().replace(/[^a-z0-9]/g, '');
          const cleanOld = String(row.oldName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
          return cleanRow === cleanInit || cleanOld === cleanInit;
        });
      });

      missingList.forEach(name => {
        const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        (finalRowsFallback as any[]).push({
          key,
          biomarker: name,
          oldName: name,
          isRenamed: false,
          isUnitChanged: false,
          oldUnit: '',
          date: 'N/A',
          value: 'N/A',
          unit: '',
          isNew: false,
          isChanged: false,
          isAtRisk: false,
          isSecondary: false,
          isMissing: true,
          status: 'Missing',
          severity: 0,
          normalRange: '',
          changeReason: `Omitted during extraction. Select checkbox to move to next batch.`,
          riskReason: '',
          description: `Missing raw reading from source text.`,
          standardMedicalGrouping: 'Other',
          riskCategories: [],
          potentialMedicalConditions: []
        });
      });

      // Also append any unmappedTests that are not already in finalRowsFallback!
      if (agentResult?.unmappedTests && Array.isArray(agentResult.unmappedTests)) {
        agentResult.unmappedTests.forEach((test: any) => {
          const rawName = test?.raw_name || (typeof test === 'string' ? test : '');
          if (!rawName) return;
          const suggested_key = test?.suggested_key || rawName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

          const cleanRawName = rawName.toLowerCase().replace(/[^a-z0-9]/g, '');
          const cleanSuggestedKey = suggested_key.toLowerCase().replace(/[^a-z0-9]/g, '');

          const alreadyExists = (finalRowsFallback as any[]).some(row => {
            const cleanRow = String(row.biomarker || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            const cleanOld = String(row.oldName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            const cleanKey = String(row.key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            return cleanRow === cleanRawName || cleanOld === cleanRawName || cleanKey === cleanSuggestedKey || cleanKey === cleanRawName;
          });

          if (!alreadyExists) {
            const testVal = test?.numeric_value ?? test?.qualitative_value ?? test?.value ?? 'N/A';
            const testDate = test?.date || test?.logDate || 'N/A';
            const testUnit = test?.unit || '';
            const isHasValue = testVal !== 'N/A' && testVal !== null && testVal !== '';

            (finalRowsFallback as any[]).push({
              key: suggested_key,
              biomarker: rawName,
              oldName: rawName,
              isRenamed: false,
              isUnitChanged: false,
              oldUnit: testUnit,
              date: testDate,
              value: testVal,
              unit: testUnit,
              isNew: true,
              isNewBiomarker: true,
              isNotUsed: isKeyMarkedNotUsed(suggested_key, rawName),
              isChanged: false,
              isAtRisk: false,
              isSecondary: false,
              isMissing: !isHasValue,
              status: isHasValue ? 'New' : 'Unmapped',
              severity: 0,
              normalRange: '',
              changeReason: isHasValue
                ? `New custom biomarker reading extracted from source text.`
                : `Detected in source text. Select checkbox to approve/add as custom biomarker.`,
              riskReason: '',
              description: test?.explanation || `Unmapped biomarker found in raw clinical records.`,
              standardMedicalGrouping: test?.standardMedicalGrouping || 'Other',
              riskCategories: test?.riskCategories || [],
              potentialMedicalConditions: test?.potentialMedicalConditions || []
            });
          }
        });
      }

      return finalRowsFallback;
    }

    // Fallback standard mapping when batchBiomarkers is not available
    if (agentType === 'medical_extract') {
      let parsedRows: any[] = [];
      const jsonText = agentResult.filledRows || agentResult.extractedData || agentResult;
      const entries = Array.isArray(jsonText) ? jsonText : [];
      entries.forEach(entry => {
        if (entry.tests && Array.isArray(entry.tests)) {
          entry.tests.forEach((test: any) => { 
             parsedRows.push({
               biomarker: test.originalTestName || test.key || 'Unknown',
               name: test.originalTestName || test.key || 'Unknown',
               key: test.key,
               date: entry.date,
               value: test.valueNumeric !== null && test.valueNumeric !== undefined ? test.valueNumeric : test.valueString,
               unit: test.unit,
               normalRange: test.normalRange,
               explanation: test.doctorComment
             });
          });
        } else if (entry.biomarker || entry.name) {
          parsedRows.push({
            biomarker: entry.name || entry.biomarker || 'Unknown',
            name: entry.name || entry.biomarker || 'Unknown',
            key: entry.biomarker || entry.key,
            date: entry.date,
            value: entry.numeric_value !== null && entry.numeric_value !== undefined ? entry.numeric_value : (entry.qualitative_value || entry.value),
            unit: entry.unit,
            normalRange: entry.normalRange,
            explanation: entry.explanation || entry.changeReason || ''
          });
        }
      });
      const finalRowsFallback = parsedRows.map((row: any) => {
        const biomarkerName = row.biomarker || row.name || row.key || 'Unknown';
        const key = resolveBiomarkerKey(row.key || String(biomarkerName).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''), biomarkerName, profile);
        const existingEntries = (biomarkerHistory || []).filter((h: any) => h?.biomarkers?.[key] !== undefined);
        const hasLegacyProfileData = profile?.biomarkers?.[key] !== undefined;
        let isNew = row.noChangeNeeded ? false : (existingEntries.length === 0 && !hasLegacyProfileData);
        
        const customDef = profile?.customBiomarkers?.[key];
        const normalRange = row.normalRange || customDef?.normalRange || '';
        const valueNum = parseFloat(row.value);
        let isAtRisk = false;
        
        if (false) {
          const rangeMatch = normalRange.match(/([\d.]+)\s*-\s*([\d.]+)/);
          if (rangeMatch) {
            const min = parseFloat(rangeMatch[1]);
            const max = parseFloat(rangeMatch[2]);
            if (valueNum < min || valueNum > max) {
              isAtRisk = true;
            }
          }
        }

        let rowUnit = row.unit || row.metric || '';
        const dictUnit = customDef?.unit || '';
        if (rowUnit.trim() === '' || rowUnit.trim() === '-' || rowUnit.trim().toLowerCase() === 'n/a') {
            rowUnit = dictUnit;
        }
        const newGroup = row.standardMedicalGrouping || 'Other';
        const oldGroup = customDef?.standardMedicalGrouping || 'Other';
        const isGroupChanged = false;

        const isSameUnit = (unit1: string, unit2: string) => {
          if (!unit1 || !unit2) return unit1 === unit2;
          return sanitizeUnitText(unit1) === sanitizeUnitText(unit2);
        };
        const normalizeDate = (d: string) => {
          if (!d) return d;
          return toYYYYMMDD(d);
        };
        const normalizedRowDate = normalizeDate(row.date);

        let changeReason = row.noChangeNeeded 
          ? `No changes needed. Entry is already up-to-date.` 
          : `Extracted new ${biomarkerName}: ${typeof row.value === 'object' ? JSON.stringify(row.value) : String(row.value || '')} ${rowUnit}`;
        let oldValue: any = undefined;
        let oldUnit: any = undefined;
        let isChanged = false;
        let isSynced = false;
        let isUnitChanged = false;

        if (!row.noChangeNeeded && !isNew && existingEntries.length > 0) {
          const exactMatch = existingEntries.find((h: any) => normalizeDate(h.date) === normalizedRowDate && h?.biomarkers?.[key] !== undefined);
          if (exactMatch) {
            const matchVal = exactMatch.biomarkers?.[key];
            const dictUnit = customDef?.unit || '';
            const numMatchVal = parseFloat(matchVal);
            const numRowVal = parseFloat(row.value);
            let isValueMatch = (!isNaN(numMatchVal) && !isNaN(numRowVal) && numMatchVal === numRowVal) || String(matchVal).toLowerCase().trim() === String(row.value).toLowerCase().trim();
            
            // Check for known unit conversions (e.g. Hematocrit 0.48 L/L vs 48 %)
            if (!isValueMatch && !isNaN(numMatchVal) && !isNaN(numRowVal)) {
              if (key === "hematocrit") {
                if (Math.abs(numMatchVal * 100 - numRowVal) < 0.01 || Math.abs(numRowVal * 100 - numMatchVal) < 0.01) {
                  isValueMatch = true;
                }
              } else if (key === "total_cholesterol" || key === "cholesterol" || key.includes("cholesterol") || key === "hdl_cholesterol" || key === "ldl_cholesterol") {
                const ratio = numMatchVal / numRowVal;
                if (Math.abs(ratio - 0.02586) < 0.001 || Math.abs(ratio - (1 / 0.02586)) < 0.05) {
                  isValueMatch = true;
                }
              } else if (key === "triglycerides") {
                const ratio = numMatchVal / numRowVal;
                if (Math.abs(ratio - 0.0113) < 0.001 || Math.abs(ratio - (1 / 0.0113)) < 0.05) {
                  isValueMatch = true;
                }
              }
            }

            if (isValueMatch && (!dictUnit || isSameUnit(rowUnit, dictUnit))) {
              isSynced = true;
              changeReason = "Already logged";
            } else if (isValueMatch && dictUnit && !isSameUnit(rowUnit, dictUnit)) {
              isUnitChanged = true;
              oldUnit = dictUnit;
              console.warn(`[UnitCompare] ${biomarkerName} (${key}): extracted unit=${rowUnit}, saved unit=${dictUnit} (source: profile.customBiomarkers, last updated ${customDef?.updatedAt || 'unknown'}). Saved unit is not a verified clinical/SI standard — it is simply the unit first recorded for this biomarker.`);
              changeReason = `Unit differs from your saved record: this extracted value uses ${rowUnit}, your saved history uses ${dictUnit}. Convert this new value to match your saved unit (${dictUnit})?`;
            } else {
              oldValue = matchVal;
              isChanged = true;
              changeReason = `Value discrepancy for ${row.date}: existing was ${matchVal}, extracted is ${row.value}`;
            }
          } else {
            const sortedHistory = [...existingEntries].sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));
            const latestVal = sortedHistory[0]?.biomarkers?.[key];
            if (latestVal !== undefined) {
              isNew = true;
              isChanged = false;
              changeReason = "New reading";
            }
          }
        }

        const riskReason = isAtRisk 
          ? `Value ${typeof row.value === 'object' ? JSON.stringify(row.value) : String(row.value || '')} ${rowUnit} is outside normal range (${normalRange})` 
          : '';

        const explanation = row.explanation || row.changeReason || row.description || '';

        return {
          key,
          biomarker: biomarkerName,
          date: row.date || 'N/A',
          value: row.value ?? 'N/A',
          unit: rowUnit,
          isNew,
          isNewBiomarker: isNew && existingEntries.length === 0 && !hasLegacyProfileData,
          isNotUsed: isKeyMarkedNotUsed(key, biomarkerName),
          isChanged,
          isSynced,
          isUnitChanged,
          oldValue,
          oldUnit,
          isAtRisk,
          severity: isAtRisk ? 1 : 0,
          normalRange,
          changeReason,
          riskReason,
          description: explanation,
          standardMedicalGrouping: row.standardMedicalGrouping || 'Other',
          isGroupChanged,
          oldGroup,
          riskCategories: row.riskCategories || [],
          potentialMedicalConditions: row.potentialMedicalConditions || []
        };
      });

      return finalRowsFallback;
    }

    if (agentType === 'agent2') {
      // Step 2: Clinical Ontologist (Mapping)
      const mapping = agentResult.bucketMapping || agentResult || {};
      const entries = Object.entries(mapping).filter(([k, v]) => k !== 'text' && k !== 'extractedData' && v && typeof v === 'object');
      
      return entries.map(([bioName, mapData]: [string, any]) => {
        const key = String(bioName).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        const existingDef = profile?.customBiomarkers?.[key];
        const newGroup = mapData?.standardMedicalGrouping || 'Other';
        const oldGroup = existingDef?.standardMedicalGrouping || 'Other';
        const isGroupChanged = newGroup !== oldGroup;
        const newCategories = (Array.isArray(mapData?.riskCategories) ? mapData.riskCategories : []).join(', ');
        const oldCategories = (Array.isArray(existingDef?.riskCategories) ? existingDef?.riskCategories : []).join(', ');
        const isCategoryChanged = newCategories !== oldCategories;
        const isChanged = isGroupChanged || isCategoryChanged;
        
        const mergeInfo = mergedInfoForStep2[key];
        const isMerged = !!mergeInfo?.isMerged;
        const mergedFrom = mergeInfo?.mergedFrom || [];
        const isNew = !existingDef && !isMerged;

        let changeReason = "";
        if (isMerged) {
          changeReason = `Merged from: ${mergedFrom.join(', ')}. Mapped ${bioName} to ${newGroup}`;
        } else if (isNew) {
          changeReason = `Mapped ${bioName} to ${newGroup}`;
        }

        const hasRisk = mapData?.riskCategories && mapData.riskCategories.length > 0;
        const riskReason = hasRisk 
          ? `Associated with risk categories: ${(Array.isArray(mapData?.riskCategories) ? mapData.riskCategories : []).join(', ')}` 
          : "";

        return {
          biomarker: bioName,
          group: newGroup,
          oldGroup,
          isGroupChanged,
          categories: newCategories,
          oldCategories,
          isCategoryChanged,
          isNew,
          isChanged,
          isMerged,
          mergedFrom,
          severity: isCategoryChanged || isGroupChanged ? 1 : 0,
          changeReason,
          riskReason,
          isAtRisk: hasRisk
        };
      });
    }

    if (agentType === 'agent3') {
      // Step 3: Clinical Data Coordinator (Assembly)
      const buckets = Array.isArray(agentResult.buckets) ? agentResult.buckets : [];
      const allBiomarkers = buckets.flatMap((bucket: any) => {
        if (!bucket) return [];
        return (bucket.biomarkers || []).filter((b: any) => b && typeof b === 'object').map((b: any) => {
          const nameToUse = b.name || b.key || b.biomarker || 'Unknown';
          const key = String(nameToUse).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
          const existingDef = profile?.customBiomarkers?.[key];
          const oldGroup = existingDef?.standardMedicalGrouping || 'Other';
          const isGroupChanged = bucket.systemName && bucket.systemName !== oldGroup;
          const isNew = !existingDef;
          
          let hasNewReadings = false;
          if (Array.isArray(b.history) && b.history.length > 0) {
            if (!existingDef) {
              hasNewReadings = true;
            } else {
              const existingDates = (biomarkerHistory || []).filter((h: any) => h && h.biomarkers && h.biomarkers[key] !== undefined).map((h: any) => h.date);
              const newDates = b.history.filter((h: any) => h && h.date && !existingDates.includes(h.date));
              if (newDates.length > 0) {
                hasNewReadings = true;
              }
            }
          }

          let changeReason = "";
          if (isNew) {
            changeReason = `Assembled new biomarker: ${nameToUse}`;
          } else if (hasNewReadings) {
            changeReason = `Integrated ${b.history?.length || 0} readings`;
          }

          const customDef = profile?.customBiomarkers?.[key];
          const hasRisk = customDef?.riskCategories && customDef.riskCategories.length > 0;
          const riskReason = hasRisk 
            ? `Associated with risk categories: ${(Array.isArray(customDef?.riskCategories) ? customDef.riskCategories : []).join(', ')}` 
            : "";

          return {
            biomarker: nameToUse,
            group: bucket.systemName || 'Other',
            oldGroup,
            isGroupChanged,
            totalReadings: b.history?.length || 0,
            isNew,
            isChanged: isGroupChanged || hasNewReadings,
            hasNewReadings,
            severity: isGroupChanged || hasNewReadings ? 1 : 0,
            changeReason,
            riskReason,
            isAtRisk: hasRisk
          };
        });
      });

      return allBiomarkers;
    }

    if ((agentType as string) === 'agent4') {
      // Step 4: Prognostic Diagnostics Assessment
      const conditions = Array.isArray(agentResult.prioritizedConditions) ? agentResult.prioritizedConditions : [];
      return conditions.flatMap((cond: any) => {
        if (!cond) return [];
        return (Array.isArray(cond.biomarkers) ? cond.biomarkers : []).map((b: any) => {
          if (!b) return null;
          const nameToUse = b.name || b.key || b.biomarker || 'Unknown';
          const key = String(nameToUse).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
          const existingDef = profile?.customBiomarkers?.[key];
          const oldGroup = existingDef?.standardMedicalGrouping || 'Other';
          const isGroupChanged = cond.conditionName && cond.conditionName !== oldGroup;
          const isNew = !existingDef;

          let changeReason = "";
          if (isNew) {
            changeReason = `Associated with ${cond.conditionName}`;
          }

          const isAtRisk = cond.riskTier === 'High' || cond.riskTier === 'Moderate';
          const riskReason = isAtRisk 
            ? `Assessed as ${cond.riskTier} Risk condition: "${cond.conditionName}"` 
            : "";

          return {
            biomarker: nameToUse,
            condition: cond.conditionName || 'Other',
            oldGroup,
            isGroupChanged,
            isNew,
            isChanged: isGroupChanged,
            severity: cond.riskTier === 'High' ? 2 : cond.riskTier === 'Moderate' ? 1 : 0,
            changeReason,
            riskReason,
            isAtRisk
          };
        }).filter(Boolean);
      });
    }

    if (agentType === 'data_review') {
      const reviewed = Array.isArray(agentResult?.reviewedBiomarkers) ? agentResult.reviewedBiomarkers : [];
      return reviewed.filter((r: any) => r && typeof r === 'object').map((bm: any) => {
        const isAtRisk = bm.status === 'At Risk' || bm.status === 'high' || bm.status === 'critical';
        const isActionZone = bm.status === 'Sub-Optimal (Action Zone)' || bm.status === 'Sub-Optimal' || bm.status === 'Borderline';

        const unit = (() => {
          const dictDef = profile?.customBiomarkers?.[bm.key] || biomarkerDefinitions.find((d: any) => d.key === bm.key);
          const dictUnit = dictDef?.unit || '';
          return (dictUnit && dictUnit.trim() !== '') ? dictUnit : (bm.unit || '');
        })();

        // Extract single target optimal value using formatOptimalTargetValue
        const optimalVal = formatOptimalTargetValue({ ...bm, unit });

        return {
          biomarker: bm.name || (bm.key ? String(bm.key).replace(/_/g, ' ').toUpperCase() : '') || 'Unknown',
          key: bm.key,
          value: bm.userValue !== undefined ? bm.userValue : '',
          unit,
          group: bm.standardMedicalGrouping || 'Other',
          normalRange: bm.profileAdjustedNormalRange || '',
          optimalValue: optimalVal,
          reference: bm.reference || '',
          description: bm.description || '',
          role: bm.role || 'Clinical Calibration Specialist',
          insight: bm.insight || '',
          specificRiskContext: bm.specificRiskContext || '',
          rangeBrackets: bm.rangeBrackets || [],
          riskCategories: bm.riskCategories || [],
          potentialMedicalConditions: bm.potentialMedicalConditions || [],
          isDataArtifact: bm.isDataArtifact || false,
          artifactNote: bm.artifactNote || '',
          isAtRisk,
          isActionZone,
          isChanged: false,
          isNew: false,
          severity: isAtRisk ? 2 : (isActionZone ? 1 : 0)
        };
      });
    }

    if (agentType === 'biomarker_review') {
      let candidate = agentResult;
      if (typeof candidate === 'string') {
        try {
          candidate = JSON.parse(candidate.replace(/```(?:json)?/gi, '').trim());
        } catch (e) {}
      }

      const rawCmds = Array.isArray(candidate?.modificationCommand)
        ? candidate.modificationCommand
        : (Array.isArray(candidate?.result?.modificationCommand)
          ? candidate.result.modificationCommand
          : (Array.isArray(candidate?.agentResult?.modificationCommand)
            ? candidate.agentResult.modificationCommand
            : (Array.isArray((candidate as any)?.clean_result?.modificationCommand)
              ? (candidate as any).clean_result.modificationCommand
              : (Array.isArray((candidate as any)?.data?.modificationCommand)
                ? (candidate as any).data.modificationCommand
                : (Array.isArray((candidate as any)?.data?.agentResult?.modificationCommand)
                  ? (candidate as any).data.agentResult.modificationCommand
                  : [])))));

      const catalogUnits = collectCatalogUnitMap(profile);
      let commands = enrichReviewModificationCommands(
        rawCmds,
        biomarkerHistory || [],
        catalogUnits
      );

      if (commands.length === 0) {
        const textCandidate = candidate?.reply || candidate?.text || candidate?.message || candidate?.content || candidate?.summary || candidate?.globalSummary || candidate?.explanation || candidate?.agentResult?.reply || candidate?.agentResult?.text || candidate?.agentResult?.message || initialRawText || '';
        if (textCandidate) {
          commands = extractFallbackModifications(textCandidate, biomarkerHistory || [], profile);
          if (commands.length > 0) {
            commands = enrichReviewModificationCommands(commands, biomarkerHistory || [], catalogUnits);
          }
        }
      }

      if (commands.length > 0) {
        return commands.map((cmd: any, idx: number) => {
          const rawKey = cmd.keyName || cmd.key || cmd.biomarker || `marker_${idx}`;
          const customDef = profile?.customBiomarkers?.[rawKey];
          const stdDef = biomarkerDefinitions.find(d => d.key === rawKey || d.name.toLowerCase() === String(rawKey).toLowerCase());
          const name = customDef?.name || stdDef?.name || (cmd.name || rawKey.replace(/_/g, ' ').toUpperCase());
          const unit = cmd.unit || customDef?.unit || stdDef?.unit || '';
          const oldUnit = cmd.oldUnit && cmd.oldUnit !== unit ? cmd.oldUnit : undefined;
          const group = customDef?.group || (stdDef as any)?.group || (stdDef as any)?.category || 'Clinical Calibration';

          return {
            biomarker: name,
            key: rawKey,
            date: cmd.date || '',
            value: cmd.newValue !== undefined ? cmd.newValue : '',
            oldValue: cmd.oldValue !== undefined ? cmd.oldValue : '',
            unit,
            oldUnit,
            isUnitChanged: !!oldUnit,
            group,
            isChanged: true,
            isNew: false,
            status: 'Calibrated',
            reason: cmd.reason || 'Scaling and notation calibration',
            description: cmd.reason || 'Scaling and notation calibration',
            insight: agentResult?.proposal?.medicalInsight || ''
          };
        });
      }

      const reviewed = candidate?.reviewedBiomarkers || candidate?.biomarkers || candidate?.extractedBiomarkers || candidate?.agentResult?.reviewedBiomarkers || candidate?.agentResult?.biomarkers;
      if (Array.isArray(reviewed) && reviewed.length > 0) {
        return reviewed.map((bm: any) => {
          const isAtRisk = bm.status === 'At Risk' || bm.status === 'high' || bm.status === 'critical';
          const unit = bm.unit || profile?.customBiomarkers?.[bm.key]?.unit || '';
          return {
            biomarker: bm.name || (bm.key ? String(bm.key).replace(/_/g, ' ').toUpperCase() : '') || 'Unknown',
            key: bm.key,
            date: bm.date || '',
            value: bm.userValue !== undefined ? bm.userValue : (bm.newValue !== undefined ? bm.newValue : (bm.value !== undefined ? bm.value : '')),
            unit,
            group: bm.standardMedicalGrouping || 'Clinical Calibration',
            isAtRisk,
            isChanged: true,
            isNew: false,
            status: 'Calibrated',
            reason: bm.reason || bm.insight || 'Clinical calibration review',
            description: bm.description || bm.insight || '',
            insight: bm.insight || ''
          };
        });
      }

      const prop = candidate?.proposal || candidate?.agentResult?.proposal || (agentResult as any)?.proposal;
      if (prop) {
        const rawKey = prop.key || prop.keyName || prop.biomarkerKey || getMappedBiomarkerKey(prop.name) || 'reviewed_marker';
        const customDef = profile?.customBiomarkers?.[rawKey];
        const stdDef = biomarkerDefinitions.find(d => d.key === rawKey || d.name.toLowerCase() === String(prop.name || rawKey).toLowerCase());
        const name = prop.name || customDef?.name || stdDef?.name || rawKey;
        const unit = prop.metric || prop.unit || customDef?.unit || stdDef?.unit || '';
        const group = customDef?.standardMedicalGrouping || (stdDef as any)?.standardMedicalGrouping || (stdDef as any)?.category || 'Clinical Calibration';
        return [{
          biomarker: name,
          key: rawKey,
          date: prop.date || '',
          value: prop.value !== undefined ? prop.value : '',
          unit,
          group,
          isChanged: true,
          isNew: false,
          status: 'Calibrated',
          reason: prop.medicalInsight || prop.description || 'Clinical calibration proposal',
          description: prop.description || prop.medicalInsight || '',
          insight: prop.medicalInsight || ''
        }];
      }
    }

    return [];
  }, [agentResult, agentType, biomarkerHistory, profile, initialRawText]);

  // Status counts memo
  const counts = useMemo(() => {
    let atRisk = 0;
    let isNew = 0;
    let changed = 0;
    let synced = 0;
    let toDelete = 0;
    let merged = 0;
    let isMissing = 0;
    tableData.forEach(row => {
      if (row.isMissing) {
        isMissing++;
      } else if (row.isSecondary && row.status === 'To Delete') {
        toDelete++;
      } else {
        if (row.isAtRisk) atRisk++;
        if (row.isMerged) merged++;
        else if (row.isNew) isNew++;
        else if (row.isChanged || row.isRenamed || row.isUnitChanged) changed++;
        else synced++;
      }
    });
    return { atRisk, isNew, changed, synced, toDelete, merged, isMissing };
  }, [tableData]);

  // 2. Perform sorting
  const sortedData = useMemo(() => {
    const data = [...tableData];
    
    // If a specific status category is selected for priority sorting
    if (statusSortCategory) {
      return data.sort((a, b) => {
        const isA = statusSortCategory === 'atRisk' ? a.isAtRisk 
                   : statusSortCategory === 'isNew' ? a.isNew
                   : statusSortCategory === 'changed' ? (!a.isNew && (a.isChanged || a.isRenamed || a.isUnitChanged) && !a.isMerged && !a.isMissing && !(a.isSecondary && a.status === 'To Delete'))
                   : statusSortCategory === 'toDelete' ? (a.isSecondary && a.status === 'To Delete')
                   : statusSortCategory === 'merged' ? a.isMerged
                   : statusSortCategory === 'isMissing' ? a.isMissing
                   : (!a.isNew && !a.isChanged && !a.isRenamed && !a.isUnitChanged && !a.isAtRisk && !a.isSecondary && !a.isMerged && !a.isMissing); // synced
        const isB = statusSortCategory === 'atRisk' ? b.isAtRisk 
                   : statusSortCategory === 'isNew' ? b.isNew
                   : statusSortCategory === 'changed' ? (!b.isNew && (b.isChanged || b.isRenamed || b.isUnitChanged) && !b.isMerged && !b.isMissing && !(b.isSecondary && b.status === 'To Delete'))
                   : statusSortCategory === 'toDelete' ? (b.isSecondary && b.status === 'To Delete')
                   : statusSortCategory === 'merged' ? b.isMerged
                   : statusSortCategory === 'isMissing' ? b.isMissing
                   : (!b.isNew && !b.isChanged && !b.isRenamed && !b.isUnitChanged && !b.isAtRisk && !b.isSecondary && !b.isMerged && !b.isMissing); // synced
        
        if (isA && !isB) return -1;
        if (!isA && isB) return 1;
        
        // Secondary fallback
        const aChange = (a.isNew || a.isChanged || a.isMerged || a.isMissing) ? 1 : 0;
        const bChange = (b.isNew || b.isChanged || b.isMerged || b.isMissing) ? 1 : 0;
        if (aChange !== bChange) return bChange - aChange;
        return (b.severity || 0) - (a.severity || 0);
      });
    }
    
    if (sortField === 'default') {
      // Default: Sort by changes (isChanged/isNew/isMerged/isMissing first) or severity descending
      return data.sort((a, b) => {
        // "To Delete" goes to bottom
        const aDel = (a.isSecondary && a.status === 'To Delete') ? 1 : 0;
        const bDel = (b.isSecondary && b.status === 'To Delete') ? 1 : 0;
        if (aDel !== bDel) return aDel - bDel;

        // Missing/Omitted should rank at the very top of the table to flag them prominently
        const aMiss = a.isMissing ? 1 : 0;
        const bMiss = b.isMissing ? 1 : 0;
        if (aMiss !== bMiss) return bMiss - aMiss;

        // Primary: isNew or isChanged or isMerged
        const aChange = (a.isNew || a.isChanged || a.isRenamed || a.isUnitChanged || a.isMerged) ? 1 : 0;
        const bChange = (b.isNew || b.isChanged || b.isRenamed || b.isUnitChanged || b.isMerged) ? 1 : 0;
        if (aChange !== bChange) return bChange - aChange;
        
        // Secondary: Severity
        return (b.severity || 0) - (a.severity || 0);
      });
    }

    if (sortField === 'isNew') {
      const getStatusPriority = (row: any) => {
        if (row.isSecondary && row.status === 'To Delete') return 0;
        if (row.isMissing) return 5;
        if (row.isAtRisk) return 4;
        if (row.isMerged) return 3.5;
        if (row.isNew) return 3;
        if (row.isChanged || row.isRenamed || row.isUnitChanged) return 2;
        return 1; // Synced
      };
      return data.sort((a, b) => {
        const priorityA = getStatusPriority(a);
        const priorityB = getStatusPriority(b);
        return sortAsc ? priorityA - priorityB : priorityB - priorityA;
      });
    }

    // Interactive clickable column sorting
    return data.sort((a, b) => {
      let valA = a[sortField] ?? '';
      let valB = b[sortField] ?? '';

      if (typeof valA === 'string') valA = valA.toLowerCase();
      if (typeof valB === 'string') valB = valB.toLowerCase();

      if (valA < valB) return sortAsc ? -1 : 1;
      if (valA > valB) return sortAsc ? 1 : -1;
      return 0;
    });
  }, [tableData, sortField, sortAsc, statusSortCategory]);

  const isPaginatedView = (agentType === 'agent1' || agentType === 'medical_extract') && sortedData.length > PAGE_SIZE;
  const pagedData = isPaginatedView ? sortedData.slice(pageStart, pageStart + PAGE_SIZE) : sortedData;
  const pagedKeys = (pagedData || []).map((row: any) => row.key).filter(Boolean);
  const isLastPage = !isPaginatedView || (pageStart + PAGE_SIZE >= sortedData.length);


  // Check if any row in sortedData has update content
  const hasUpdateContent = useMemo(() => {
    return sortedData.some((row: any) => {
      const hasRisk = row.isAtRisk && row.riskReason;
      const hasChange = (row.isNew || row.isChanged || row.isRenamed || row.isUnitChanged) && row.changeReason;
      const hasExplanation = !!row.description;
      return hasRisk || hasChange || hasExplanation;
    });
  }, [sortedData]);

  // Check if there are any new or changed entries to actually approve
  const hasAnythingToApprove = useMemo(() => {
    if (tableData.length === 0) return false;
    if (agentType === 'agent1' || agentType === 'medical_extract' || agentType === 'agent2' || agentType === 'agent3' || (agentType as string) === 'agent4') {
      return counts.isNew > 0 || counts.changed > 0 || counts.toDelete > 0;
    }
    return tableData.length > 0;
  }, [tableData, agentType, counts]);

  // 3. Verification calculation
  const verification = useMemo(() => {
    let initialCount = 0;
    let generatedCount = tableData.length;
    let missingList: string[] = [];
    let differenceMsg = '';

    if (agentType === 'agent1' || agentType === 'medical_extract' || agentType === 'data_review') {
      if (agentResult?.batchBiomarkers && Array.isArray(agentResult.batchBiomarkers) && agentResult.batchBiomarkers.length > 0) {
        initialCount = agentResult.batchBiomarkers.length;
        // GeneratedCount shows the active primary table rows (excluding secondary duplicates)
        generatedCount = tableData.filter(row => !row.isSecondary).length;
        
        // Find raw names that are not mapped/matched at all
        const initialNames = (agentResult?.batchBiomarkers || []).map((b: any) => b.name || b.key || '');
        missingList = initialNames.filter((initName: string) => {
          if (!initName) return false;
          const cleanInit = String(initName).toLowerCase().replace(/[^a-z0-9]/g, '');
          
          // Must not be in any primary row as biomarker or oldName
          const existsInPrimary = tableData.some(row => {
            if (row.isSecondary || row.isMissing) return false;
            const cleanRow = String(row.biomarker || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            const cleanOld = String(row.oldName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            const cleanKey = String(row.key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            return cleanRow === cleanInit || cleanOld === cleanInit || cleanKey === cleanInit;
          });
          
          if (existsInPrimary) return false;

          // Must not be in any secondary row as oldName
          const existsInSecondary = tableData.some(row => {
            if (!row.isSecondary || row.isMissing) return false;
            const cleanOld = String(row.oldName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            const cleanKey = String(row.key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            return cleanOld === cleanInit || cleanKey === cleanInit;
          });

          return !existsInSecondary;
        });
      } else {
        const initialMarkers = getInitialMarkersFromText(initialRawText);
        initialCount = Math.max(initialMarkers.length, tableData.filter(row => !row.isMissing).length);
        
        // Match missing
        missingList = initialMarkers.filter(initName => {
          const cleanInit = String(initName).toLowerCase().replace(/[^a-z0-9]/g, '');
          return !tableData.some(row => {
            if (row.isMissing) return false;
            const cleanRow = String(row.biomarker || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            return cleanRow.includes(cleanInit) || cleanInit.includes(cleanRow);
          });
        });
      }
    } else if (agentType === 'agent2' || agentType === 'agent3') {
      // Count unique markers in preceding agent1 yaml
      const jsonMsg = [...(biomarkerHistory || [])]; // we can approximate or find inside raw YAML if supplied
      const prevYaml = agentResult?.extractedData || '';
      let prevCount = 0;
      if (prevYaml) {
        try {
          const parsed = JSON.parse(prevYaml);
          if (Array.isArray(parsed)) prevCount = parsed.length;
        } catch(e) {}
      }
      initialCount = prevCount || tableData.length;
    } else {
      initialCount = tableData.length;
    }

    let mergeCount = tableData.filter(row => row.isSecondary).length;
    if (mergeCount === 0) {
      tableData.forEach(row => {
        if (row.isMerged && Array.isArray(row.mergedFrom) && row.mergedFrom.length > 1) {
          mergeCount += (row.mergedFrom.length - 1);
        }
      });
    }
    let hasMismatch = initialCount !== generatedCount;

    if (initialCount !== generatedCount) {
      if (missingList.length > 0) {
        differenceMsg = `${missingList.length} biomarkers were present in raw input but omitted during extraction: ${missingList.join(', ')}.`;
      } else if (generatedCount > initialCount) {
        differenceMsg = `Agent generated ${generatedCount - initialCount} additional rows or broken-down entries.`;
      } else {
        if (generatedCount + mergeCount === initialCount) {
          differenceMsg = `Raw count was ${initialCount}, table has ${generatedCount} (${mergeCount} merged rows detected). All entries successfully consolidated.`;
          hasMismatch = false;
        } else if (mergeCount > 0) {
          differenceMsg = `Mismatch remains: Raw count was ${initialCount}, table has ${generatedCount} with ${mergeCount} merged rows.`;
        } else {
          differenceMsg = `Mismatch detected: Raw count was ${initialCount}, table has ${generatedCount}.`;
        }
      }
    }

    // Map missingList to keys and names
    const missingBiomarkers: { key: string; name: string }[] = [];
    
    // First, add unmappedTests from the agent if available
    const addedUnmappedNames = new Set<string>();
    if (agentResult?.unmappedTests && Array.isArray(agentResult.unmappedTests)) {
      agentResult.unmappedTests.forEach((test: any) => {
        const raw_name = test?.raw_name || (typeof test === 'string' ? test : '');
        if (!raw_name) return;
        const suggested_key = test?.suggested_key || raw_name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        missingBiomarkers.push({ key: suggested_key, name: raw_name });
        addedUnmappedNames.add(raw_name.toLowerCase());
      });
    }

    if (agentResult?.batchBiomarkers && Array.isArray(agentResult.batchBiomarkers)) {
      missingList.forEach(name => {
        if (addedUnmappedNames.has(name.toLowerCase())) return;
        const found = agentResult.batchBiomarkers.find((b: any) => (b.name || b.key) === name);
        if (found) {
          const key = found.key || found.name?.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
          missingBiomarkers.push({ key, name: found.name || found.key || name });
        } else {
          const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
          missingBiomarkers.push({ key, name });
        }
      });
    } else {
      missingList.forEach(name => {
        if (addedUnmappedNames.has(name.toLowerCase())) return;
        const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        missingBiomarkers.push({ key, name });
      });
    }

    return {
      initialCount,
      generatedCount,
      differenceMsg,
      hasMismatch,
      missingBiomarkers
    };
  }, [tableData, agentType, initialRawText, agentResult, biomarkerHistory]);

  const missingBiomarkersSerialized = useMemo(() => {
    return (verification.missingBiomarkers || []).map(bm => bm.key).sort().join(',');
  }, [verification.missingBiomarkers]);

  useEffect(() => {
    setPageStart(0);
  }, [agentResult]);

  const hasInitializedMissingKeys = useRef(false);

  // Auto-initialize selectedMissingKeys to all missing keys as default
  useEffect(() => {
    if (hasInitializedMissingKeys.current) return;
    
    if (verification.missingBiomarkers && verification.missingBiomarkers.length > 0) {
      const batchIdx = agentResult?.batchIdx;
      if (batchIdx !== undefined && batchIdx !== null) {
        const saved = localStorage.getItem(`batch_${batchIdx}_missing_keys_to_move`);
        if (!saved) {
          const allKeys = verification.missingBiomarkers.map(bm => bm.key);
          const currentKeys = effectiveSelectedMissingKeys || [];
          const isIdentical = allKeys.length === currentKeys.length && allKeys.every(k => currentKeys.includes(k));
          if (!isIdentical) {
            handleSelectedMissingKeysChange(allKeys);
            hasInitializedMissingKeys.current = true;
          }
        }
      }
    }
  }, [missingBiomarkersSerialized, agentResult?.batchIdx, effectiveSelectedMissingKeys]);

  const renderCoverageDiagnostics = () => {
    return null;
  };

  const toggleSort = (field: string) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  const hasChanges = tableData.length > 0;

  const tableHeader = (label: string, field: string) => (
    <th 
      onClick={() => toggleSort(field)}
      className="px-3 py-2.5 font-bold text-theme-text-secondary hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer select-none font-mono text-[10px] tracking-wider uppercase"
    >
      <div className="flex items-center gap-1">
        {label}
        <ArrowUpDown className={`w-3 h-3 text-slate-400 shrink-0 ${sortField === field ? 'text-indigo-600' : ''}`} />
      </div>
    </th>
  );

  const renderTableContent = () => (
    <table className="w-full text-[11px] text-left border-collapse">
      <thead className="bg-slate-50 dark:bg-slate-900 sticky top-0 z-10 border-b border-theme-border">
        <tr>
          {tableHeader('Biomarker', 'biomarker')}
          {(agentType === 'agent1' || agentType === 'medical_extract' || agentType === 'biomarker_review') && tableHeader('Log Date', 'date')}
          {(agentType === 'agent1' || agentType === 'medical_extract' || agentType === 'biomarker_review') && tableHeader('Value', 'value')}
          {(agentType === 'agent1' || agentType === 'medical_extract' || agentType === 'biomarker_review') && tableHeader('Unit', 'unit')}
          {agentType === 'data_review' && tableHeader('User Value', 'value')}
          {agentType === 'data_review' && tableHeader('Optimal Value / Range', 'optimalValue')}
          {(agentType === 'agent2' || agentType === 'agent3') && tableHeader('Medical Practice', 'group')}
          {agentType === 'agent2' && tableHeader('Risk Categories', 'categories')}
          {agentType === 'agent3' && tableHeader('Total Readings', 'totalReadings')}
          {(agentType as string) === 'agent4' && tableHeader('Condition Association', 'condition')}
          {tableHeader('Status', 'isNew')}
          {agentType === 'data_review' ? (
            <>
              {tableHeader('Description', 'description')}
              {tableHeader('Medical Insight', 'insight')}
            </>
          ) : (
            hasUpdateContent && tableHeader('Description', 'description')
          )}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 dark:divide-slate-850">
        {(() => {
          const isPaginatedView = (agentType === 'agent1' || agentType === 'medical_extract') && sortedData.length > PAGE_SIZE;
          const pagedData = isPaginatedView ? sortedData.slice(pageStart, pageStart + PAGE_SIZE) : sortedData;
          return pagedData.map((row: any, idx: number) => {
            const isRowHighlighted = row.isNew || row.isChanged || row.isAtRisk || row.isActionZone || row.isMerged || (row.isSecondary && row.status === 'To Delete') || row.isMissing;
            const isToDelete = row.isSecondary && row.status === 'To Delete';
            const bgClass = isToDelete
              ? 'bg-rose-600 text-white dark:bg-rose-900'
              : row.isMissing
                ? 'bg-amber-500/5 text-slate-850 dark:bg-amber-500/10 border-l-2 border-l-amber-550'
                : row.isAtRisk 
                  ? 'bg-rose-50/30 dark:bg-rose-950/10' 
                  : row.isActionZone
                    ? 'bg-amber-50/30 dark:bg-amber-950/10'
                    : row.isMerged
                      ? 'bg-indigo-50/30 dark:bg-indigo-950/10'
                      : row.isNew 
                        ? 'bg-emerald-50/30 dark:bg-emerald-950/10' 
                        : row.isChanged || row.isRenamed || row.isUnitChanged
                          ? 'bg-amber-50/30 dark:bg-amber-900/10' 
                          : 'bg-white dark:bg-slate-950';

            return (
              <tr key={idx} className={`${bgClass} hover:bg-slate-50/50 dark:hover:bg-slate-900/40 transition-colors`}>
                <td className="px-3 py-2 font-semibold">
                  <div className="flex items-center gap-2">
                    {(row.isMissing || row.isNew || row.isChanged || row.isRenamed || row.isUnitChanged || row.isGroupChanged) && !isToDelete && !row.isSynced && !row.isNotUsed && (agentType === 'medical_extract' || agentType === 'agent1' || agentType === 'biomarker_review') && (
                      <input
                      type="checkbox"
                      checked={row.isMissing ? effectiveSelectedMissingKeys.includes(row.key) : !unselectedRowKeys.includes(row.key)}
                      onChange={() => {
                        if (row.isMissing) {
                          const isChecked = effectiveSelectedMissingKeys.includes(row.key);
                          const newKeys = isChecked
                            ? effectiveSelectedMissingKeys.filter(k => k !== row.key)
                            : [...effectiveSelectedMissingKeys, row.key];
                          handleSelectedMissingKeysChange(newKeys);
                        } else {
                          const isChecked = !unselectedRowKeys.includes(row.key);
                          if (isChecked) {
                            setUnselectedRowKeys(prev => [...prev, row.key]);
                          } else {
                            setUnselectedRowKeys(prev => prev.filter(k => k !== row.key));
                          }
                        }
                      }}
                      className="w-3.5 h-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 shrink-0 cursor-pointer"
                    />
                  )}
                  {row.isMissing && agentType !== 'medical_extract' && (
                    <input
                      type="checkbox"
                      checked={effectiveSelectedMissingKeys.includes(row.key)}
                      onChange={() => {
                        const isChecked = effectiveSelectedMissingKeys.includes(row.key);
                        const newKeys = isChecked
                          ? effectiveSelectedMissingKeys.filter(k => k !== row.key)
                          : [...effectiveSelectedMissingKeys, row.key];
                        handleSelectedMissingKeysChange(newKeys);
                      }}
                      className="w-3.5 h-3.5 rounded border-slate-300 text-amber-600 focus:ring-amber-500 shrink-0 cursor-pointer"
                    />
                  )}
                  <div className="flex flex-col gap-0.5 min-w-0">
                    {row.isRenamed && row.oldName ? (
                      <>
                        <span className={`text-[10px] line-through leading-tight ${isToDelete ? 'text-rose-100/80 decoration-white' : 'text-slate-400 dark:text-slate-500 decoration-slate-400'}`}>
                          {row.oldName}
                        </span>
                        <span className={`font-semibold leading-normal ${isToDelete ? 'text-white' : 'text-theme-text'}`}>
                          {row.biomarker}
                        </span>
                      </>
                    ) : (
                      <span className={`font-semibold ${row.isMissing ? 'text-amber-800 dark:text-amber-400 font-bold' : isToDelete ? 'text-white' : 'text-theme-text'}`}>
                        {row.biomarker}
                      </span>
                    )}
                    {row.key && (
                      <span className={`text-[9px] font-mono opacity-70 ${isToDelete ? 'text-rose-100' : 'text-theme-text-secondary'}`}>
                        key: {row.key}
                      </span>
                    )}
                    {row.isMerged && row.mergedFrom && row.mergedFrom.length > 0 && (
                      <span className={`text-[9px] font-semibold mt-0.5 ${isToDelete ? 'text-rose-100' : 'text-indigo-600 dark:text-indigo-400'}`}>
                        Merged from: {row.mergedFrom.join(', ')}
                      </span>
                    )}
                  </div>
                </div>
              </td>
              
              {(agentType === 'agent1' || agentType === 'medical_extract' || agentType === 'biomarker_review') && (
                <>
                  <td className={`px-3 py-2 font-mono ${isToDelete ? 'text-white' : 'text-theme-text-secondary'}`}>
                    {typeof row.date === 'object' ? JSON.stringify(row.date) : String(row.date || '')}
                  </td>
                  <td className="px-3 py-2 font-mono">
                    {row.isChanged && row.oldValue !== undefined ? (
                      <div className="flex flex-col gap-0.5">
                        <span className={`font-bold leading-none ${isToDelete ? 'text-white' : 'text-amber-650 dark:text-amber-400'}`}>{typeof row.value === 'object' ? JSON.stringify(row.value) : String(row.value)}</span>
                        <span className={`text-[9px] line-through leading-none ${isToDelete ? 'text-rose-100/80' : 'text-slate-400'}`}>{typeof row.oldValue === 'object' ? JSON.stringify(row.oldValue) : String(row.oldValue)}</span>
                      </div>
                    ) : (
                      <span className={`font-bold ${isToDelete ? 'text-white' : 'text-slate-800 dark:text-slate-200'}`}>{typeof row.value === 'object' ? JSON.stringify(row.value) : String(row.value)}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {row.isUnitChanged && row.oldUnit ? (
                      <div className="flex flex-col gap-0.5">
                        <span className={`text-[9px] line-through leading-none ${isToDelete ? 'text-rose-100/80' : 'text-slate-400'}`}>{row.oldUnit}</span>
                        <span className={`font-bold leading-none ${isToDelete ? 'text-white' : 'text-theme-neutral'}`}>{typeof row.unit === 'object' ? JSON.stringify(row.unit) : String(row.unit)}</span>
                      </div>
                    ) : (
                      <span className={`font-bold ${isToDelete ? 'text-white' : 'text-theme-neutral'}`}>{typeof row.unit === 'object' ? JSON.stringify(row.unit) : String(row.unit)}</span>
                    )}
                  </td>
                </>
              )}

              {agentType === 'data_review' && (
                <>
                  <td className="px-3 py-2 font-mono text-slate-800 dark:text-slate-200 font-bold">
                    {typeof row.value === 'object' ? JSON.stringify(row.value) : String(row.value || '')} <span className="text-slate-500 font-normal text-[9.5px]">{typeof row.unit === 'object' ? JSON.stringify(row.unit) : String(row.unit)}</span>
                  </td>
                  <td className="px-3 py-2 text-theme-neutral min-w-[260px]">
                    <div className="flex flex-col gap-1.5 py-1">
                      {/* Prominent Optimal Value display */}
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[9px] uppercase font-bold text-emerald-600 dark:text-emerald-400 tracking-wider flex items-center gap-1 font-sans">
                          🎯 Optimal Value
                        </span>
                        <span className="px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 font-mono font-bold border border-emerald-200 dark:border-emerald-800/80 w-fit text-xs">
                          {row.optimalValue || row.normalRange}
                        </span>
                      </div>

                      {/* Calibrated Normal Range */}
                      {row.normalRange && row.normalRange !== row.optimalValue && (
                        <div className="text-[10px] text-slate-500 font-mono">
                          <span className="text-[8px] uppercase font-semibold text-slate-400 block font-sans">Calibrated Range:</span>
                          <span className="px-1.5 py-0.5 rounded bg-indigo-50/60 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300 font-mono border border-indigo-100/30 dark:border-indigo-900/40 w-fit inline-block">
                            {row.normalRange}
                          </span>
                        </div>
                      )}

                      {/* Reference Source */}
                      {row.reference && (
                        <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                          <span className="text-[8px] uppercase font-semibold text-slate-400 block font-sans">Reference:</span>
                          <span className="text-[9.5px] italic text-slate-500 dark:text-slate-400">
                            {row.reference}
                          </span>
                        </div>
                      )}

                      {/* Range Brackets */}
                      {row.rangeBrackets && row.rangeBrackets.length > 0 && (
                        <div className="flex flex-wrap gap-1 max-w-[220px] mt-0.5">
                          {row.rangeBrackets.map((br: any, brIdx: number) => {
                            const { isMatched, isOptimal, colorScheme } = evaluateRangeBracketMatch(br, row.value, row.status, row.rangeBrackets);
                            
                            let styleClasses = 'bg-slate-50 dark:bg-slate-900/40 border-theme-border/60 text-slate-400 font-normal opacity-75';
                            let titleColor = 'text-slate-400';
                            
                            if (isMatched) {
                              if (colorScheme === 'emerald') {
                                styleClasses = 'bg-emerald-500/15 dark:bg-emerald-950/90 border-emerald-400 dark:border-emerald-700 text-emerald-900 dark:text-emerald-200 font-bold ring-1 ring-emerald-500/30';
                                titleColor = 'text-emerald-700 dark:text-emerald-300 font-bold';
                              } else if (colorScheme === 'rose') {
                                styleClasses = 'bg-rose-500/15 dark:bg-rose-950/90 border-rose-400 dark:border-rose-700 text-rose-900 dark:text-rose-200 font-bold ring-1 ring-rose-500/30';
                                titleColor = 'text-rose-700 dark:text-rose-300 font-bold';
                              } else if (colorScheme === 'amber') {
                                styleClasses = 'bg-amber-500/15 dark:bg-amber-950/90 border-amber-400 dark:border-amber-700 text-amber-900 dark:text-amber-200 font-bold ring-1 ring-amber-500/30';
                                titleColor = 'text-amber-700 dark:text-amber-300 font-bold';
                              }
                            } else if (isOptimal) {
                              titleColor = 'text-emerald-600/70 dark:text-emerald-400/70';
                            }

                            return (
                              <div key={brIdx} className={`text-[8.5px] px-1.5 py-0.5 rounded border leading-tight transition-all ${styleClasses}`}>
                                <span className={`block text-[7.5px] font-sans truncate ${titleColor}`} title={br.name}>
                                  {isOptimal ? '🎯 ' : ''}{br.name}{isMatched ? ' ✓' : ''}
                                </span>
                                <span className="font-mono font-bold">
                                  {br.range || (br.lowerBound !== undefined ? `${br.lowerBound}-${br.upperBound}` : '')}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Outlier Data Artifact Warning */}
                      {row.isDataArtifact && (
                        <div className="mt-1 px-2 py-1.5 rounded bg-amber-500/10 dark:bg-amber-950/50 border border-amber-400/40 text-amber-800 dark:text-amber-300 text-[10px] flex flex-col items-start gap-0.5 font-sans">
                          <span className="font-bold shrink-0">⚠️ Suspected Data Artifact:</span>
                          <span className="leading-relaxed">{row.artifactNote || 'Physiologically extreme value detected. Likely document parsing artifact.'}</span>
                        </div>
                      )}
                    </div>
                  </td>
                </>
              )}

              {(agentType === 'agent2' || agentType === 'agent3') && (
                <td className="px-3 py-2">
                  {row.isGroupChanged ? (
                    <div className="flex flex-col gap-0.5">
                      <span className="text-amber-600 dark:text-amber-400 font-bold">{row.group}</span>
                      <span className="text-[8.5px] text-slate-400 line-through">{row.oldGroup}</span>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1.5 py-1">
                      <span className="font-semibold text-theme-text">{row.group}</span>
                    </div>
                  )}
                </td>
              )}

              {agentType === 'agent2' && (
                <td className="px-3 py-2">
                  {row.isCategoryChanged ? (
                    <div className="flex flex-col gap-0.5">
                      <span className="text-amber-600 dark:text-amber-400 font-bold">{row.categories}</span>
                      <span className="text-[8.5px] text-slate-400 line-through">{row.oldCategories || 'None'}</span>
                    </div>
                  ) : (
                    <span className="text-theme-text-secondary">{row.categories || 'None'}</span>
                  )}
                </td>
              )}

              {agentType === 'agent3' && (
                <td className="px-3 py-2 font-mono font-bold text-theme-text-secondary">
                  {row.totalReadings}
                </td>
              )}

              {(agentType as string) === 'agent4' && (
                <td className="px-3 py-2">
                  {row.isGroupChanged ? (
                    <div className="flex flex-col gap-0.5">
                      <span className="text-amber-600 dark:text-amber-400 font-bold">{row.condition}</span>
                      <span className="text-[8.5px] text-slate-400 line-through">{row.oldGroup}</span>
                    </div>
                  ) : (
                    <span className="text-theme-text-secondary">{row.condition}</span>
                  )}
                </td>
              )}

              <td className="px-3 py-2 font-mono">
                <div className="flex flex-col gap-0.5">
                  {(() => {
                    const isSelectedForApproval = row.isMissing ? effectiveSelectedMissingKeys.includes(row.key) : !unselectedRowKeys.includes(row.key);
                    const isUnapproved = !row.isNotUsed && (row.isMissing || row.isNewBiomarker || row.status === 'Unmapped' || row.needsApproval);

                    if (row.isNotUsed) {
                      return (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 dark:bg-slate-800/60 dark:text-slate-400 border border-slate-300/50 dark:border-slate-700/50 uppercase tracking-wider w-fit">
                          Not used
                        </span>
                      );
                    }

                    if (isUnapproved && isSelectedForApproval) {
                      return isApplying ? (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 dark:bg-indigo-950/80 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-700 animate-pulse flex items-center gap-1">
                          <Loader2 className="w-2.5 h-2.5 animate-spin" /> Approving...
                        </span>
                      ) : (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 border border-amber-300/80 dark:border-amber-700/60 flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5 text-amber-600 dark:text-amber-400 shrink-0" /> In Process of Being Approved
                        </span>
                      );
                    }

                    if (row.isMissing) {
                      return <span className="text-amber-600 dark:text-amber-400 font-extrabold uppercase tracking-wider text-[9px] bg-amber-100/50 dark:bg-amber-950/40 px-1.5 py-0.5 rounded border border-amber-200/20 w-fit">Missing</span>;
                    }

                    return (
                      <>
                        {row.isAtRisk && (
                          <span className={`${isToDelete ? 'text-white' : 'text-rose-600 dark:text-rose-400'} font-bold`}>At Risk</span>
                        )}
                        {row.isActionZone && !row.isAtRisk && (
                          <span className={`${isToDelete ? 'text-white' : 'text-amber-600 dark:text-amber-400'} font-bold`}>Action Zone</span>
                        )}
                        {isToDelete ? (
                          <span className="text-white font-bold decoration-white line-through">To Delete</span>
                        ) : row.isMerged ? (
                          <span className="text-indigo-600 dark:text-indigo-400 font-bold">Merged</span>
                        ) : agentType === 'data_review' ? (
                          !row.isAtRisk && !row.isActionZone && <span className="text-emerald-600 dark:text-emerald-400 font-bold">Optimal</span>
                        ) : row.isSynced ? (
                          <span className="text-emerald-600 dark:text-emerald-400 font-bold">Match</span>
                        ) : row.isNew ? (
                          <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                            {row.isNewBiomarker ? "New biomarker" : "New log"}
                          </span>
                        ) : row.isChanged || row.isRenamed || row.isUnitChanged || row.isGroupChanged ? (
                          <span className="text-amber-600 dark:text-amber-400 font-bold">Changed</span>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-500">Match</span>
                        )}
                      </>
                    );
                  })()}
                </div>
              </td>

              {agentType === 'data_review' ? (
                <>
                  <td className="px-3 py-2 text-[11px] min-w-[180px] max-w-[220px] text-theme-text break-words leading-relaxed">
                    {typeof row.description === 'object' ? JSON.stringify(row.description) : String(row.description || '')}
                  </td>
                  <td className="px-3 py-2 text-[11px] min-w-[200px] max-w-[260px] text-theme-text break-words">
                    <div className="flex flex-col gap-1">
                      {row.specificRiskContext && (
                        <span className="leading-relaxed font-medium">
                          {row.specificRiskContext}
                        </span>
                      )}
                      {row.insight && (
                        <span className="leading-relaxed">{typeof row.insight === 'object' ? JSON.stringify(row.insight) : String(row.insight || '')}</span>
                      )}
                    </div>
                  </td>
                </>
              ) : (
                hasUpdateContent && (() => {
                  let cleanDescription = typeof row.description === 'object' ? JSON.stringify(row.description) : String(row.description || '');
                  if (/new reading of/i.test(cleanDescription) || /logged on/i.test(cleanDescription)) {
                    cleanDescription = '';
                  }
                  
                  let cleanChangeReason = row.changeReason || '';
                  if (/new reading of/i.test(cleanChangeReason) || /logged on/i.test(cleanChangeReason)) {
                    cleanChangeReason = '';
                  }
                  
                  return (
                    <td className="px-3 py-2 text-[11px] max-w-[220px] break-words text-white">
                      <div className="flex flex-col gap-1 text-white">
                        {row.specificRiskContext && (
                          <span className="leading-relaxed font-medium text-[11px] text-white">
                            {row.specificRiskContext}
                          </span>
                        )}
                        {cleanDescription && (
                          <span className="leading-relaxed text-[11px] text-white">
                            {cleanDescription}
                          </span>
                        )}
                        {row.isAtRisk && row.riskReason && (
                          <span className="font-bold text-[11px] text-white">
                            {row.riskReason}
                          </span>
                        )}
                        {(row.isNew || row.isChanged || row.isRenamed || row.isUnitChanged || row.isGroupChanged || row.isSynced) && cleanChangeReason && (
                          <div className="flex flex-col gap-1 text-white">
                            <span className="font-bold text-[11px] leading-tight text-white">
                              {cleanChangeReason}
                            </span>
                            {row.isUnitChanged && row.oldUnit && onSendMessage && !isToDelete && (
                              <button
                                type="button"
                                onClick={() => onSendMessage(`Please update the current extraction: mathematically convert the value of ${row.biomarker} from ${row.unit} to ${row.oldUnit}. Return the full updated data in the 'entries' array and set mode to 'extract_chunk'.`)}
                                className="self-start text-[9px] bg-amber-100 hover:bg-amber-200 dark:bg-amber-900/40 dark:hover:bg-amber-800/60 text-amber-700 dark:text-amber-300 font-bold py-0.5 px-2 rounded transition-colors"
                              >
                                Match saved unit ({row.oldUnit})
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                  );
                })()
              )}
            </tr>
          );
        })})()}
      </tbody>
    </table>
  );

  const renderFilterTags = () => (
    <div className="flex flex-wrap items-center gap-2 pb-1 bg-slate-50/50 dark:bg-slate-900/40 p-2 rounded-xl border border-theme-border">
      <button
        type="button"
        onClick={() => setStatusSortCategory(null)}
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold border transition-all cursor-pointer ${
          statusSortCategory === null
            ? 'bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 border-indigo-200'
            : 'bg-slate-100 dark:bg-slate-800 text-theme-neutral border-slate-200/30 hover:bg-slate-200'
        }`}
      >
        Total: {tableData.length}
      </button>
      {counts.atRisk > 0 && (
        <button
          type="button"
          onClick={() => setStatusSortCategory('atRisk')}
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold border transition-all cursor-pointer ${
            statusSortCategory === 'atRisk'
              ? 'bg-rose-100 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border-rose-300'
              : 'bg-rose-50 dark:bg-rose-950/20 text-rose-700 dark:text-rose-400 border-rose-200/20 hover:bg-rose-100/50'
          }`}
        >
          At Risk: {counts.atRisk}
        </button>
      )}
      {counts.isNew > 0 && (
        <button
          type="button"
          onClick={() => setStatusSortCategory('isNew')}
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold border transition-all cursor-pointer ${
            statusSortCategory === 'isNew'
              ? 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-300'
              : 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border-emerald-200/20 hover:bg-emerald-100/50'
          }`}
        >
          New: {counts.isNew}
        </button>
      )}
      {counts.changed > 0 && (
        <button
          type="button"
          onClick={() => setStatusSortCategory('changed')}
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold border transition-all cursor-pointer ${
            statusSortCategory === 'changed'
              ? 'bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-300'
              : 'bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 border-amber-200/20 hover:bg-amber-100/50'
          }`}
        >
          Changed: {counts.changed}
        </button>
      )}
      {counts.merged > 0 && (
        <button
          type="button"
          onClick={() => setStatusSortCategory('merged')}
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold border transition-all cursor-pointer ${
            statusSortCategory === 'merged'
              ? 'bg-indigo-100 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border-indigo-300'
              : 'bg-indigo-50 dark:bg-indigo-950/20 text-indigo-700 dark:text-indigo-400 border-indigo-200/20 hover:bg-indigo-100/50'
          }`}
        >
          Merged: {counts.merged}
        </button>
      )}
      {counts.toDelete > 0 && (
        <button
          type="button"
          onClick={() => setStatusSortCategory('toDelete' as any)}
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold border transition-all cursor-pointer ${
            statusSortCategory === 'toDelete'
              ? 'bg-rose-100 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border-rose-300'
              : 'bg-rose-50 dark:bg-rose-950/20 text-rose-700 dark:text-rose-400 border-rose-200/20 hover:bg-rose-100/50'
          }`}
        >
          To Delete: {counts.toDelete}
        </button>
      )}
      {counts.isMissing > 0 && (
        <button
          type="button"
          onClick={() => setStatusSortCategory('isMissing' as any)}
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold border transition-all cursor-pointer ${
            statusSortCategory === 'isMissing'
              ? 'bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-300 animate-pulse'
              : 'bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 border-amber-200/20 hover:bg-amber-100/50'
          }`}
        >
          Omitted/Missing: {counts.isMissing}
        </button>
      )}
      <button
        type="button"
        onClick={() => setStatusSortCategory('synced')}
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold border transition-all cursor-pointer ${
          statusSortCategory === 'synced'
            ? 'bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 border-slate-300'
            : 'bg-slate-50 dark:bg-slate-900 text-theme-text-secondary border-slate-200/10 hover:bg-slate-100'
        }`}
      >
        Match: {counts.synced}
      </button>
    </div>
  );

  if (agentType === 'agent4') {
    return (
      <HealthPlanningResultView
        agentResult={agentResult}
        profile={profile}
        onAcceptRecommendations={async (acceptedActions) => {
          if (onAcceptRecommendations) {
            await onAcceptRecommendations(acceptedActions);
          } else if (onApplyChanges) {
            await onApplyChanges(acceptedActions);
          }
        }}
        isApplying={isApplying}
      />
    );
  }

  if (agentType === 'agent1' && sortedData.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3 w-full">
      {/* Table Container Header */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase font-mono font-extrabold text-indigo-600 dark:text-indigo-400 tracking-wider">
            {(agentType === 'agent1' || agentType === 'medical_extract') && 'Biomarker Extraction Stream'}
            {agentType === 'biomarker_review' && 'Biomarker Telemetry & Scaling Review'}
            {agentType === 'agent2' && 'Unified Ontology Mapping'}
            {agentType === 'agent3' && 'Data Assembly Diagnostics'}
            {(agentType as string) === 'agent4' && 'Prognostic Diagnostics Assessment'}
            {agentType === 'data_review' && 'Biomarker Clinical Calibration'}
          </span>
        </div>
        
        <button
          type="button"
          onClick={() => setIsFullscreen(true)}
          className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-all cursor-pointer"
          title="Open fullscreen view"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Extreme Divergence / Anomalies Banner */}
      {(() => {
        const anomalies = agentResult?.extremeDivergences || agentResult?.flaggedAnomalies;
        if (anomalies && Array.isArray(anomalies) && anomalies.length > 0) {
          return (
            <div className="p-4 bg-rose-50/80 dark:bg-rose-950/20 border border-rose-200/50 dark:border-rose-900/50 rounded-xl space-y-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
                <div>
                  <h6 className="text-[11px] font-bold text-rose-800 dark:text-rose-300">Extreme Divergence Detected</h6>
                  <p className="text-[10px] text-rose-600/90 dark:text-rose-400/90 leading-relaxed mt-0.5">
                    The agent flagged highly improbable values or likely metric unit mismatches (e.g. US vs SI units) in this batch.
                    Please verify the data. If correct, you may proceed. Otherwise, edit the source data to correct the values or units before continuing.
                  </p>
                </div>
              </div>
              <div className="space-y-1.5">
                {anomalies.map((a: any, i: number) => (
                  <div key={i} className="px-3 py-2 bg-white/60 dark:bg-slate-950/40 rounded-lg border border-rose-100/50 dark:border-rose-900/30 flex flex-col gap-1 text-[10px]">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-800 dark:text-slate-200">{a.name || a.key}</span>
                      <span className="font-mono text-rose-600 dark:text-rose-400 bg-rose-100/50 dark:bg-rose-900/30 px-1.5 py-0.5 rounded font-bold">
                        {a.originalValue} {a.unit}
                      </span>
                    </div>
                    {a.reason && <p className="text-theme-text-secondary">{a.reason}</p>}
                    {a.suggestedAction && (
                      <div className="flex items-center gap-2 mt-1">
                        <p className="text-rose-600 dark:text-rose-400 font-medium">Suggested: {a.suggestedAction}</p>
                        {onSendMessage && (
                          <button 
                            onClick={() => onSendMessage(`Please apply the suggested action for ${a.name || a.key}: ${a.suggestedAction}.`)}
                            className="px-2 py-1 bg-rose-100 hover:bg-rose-200 dark:bg-rose-900/40 dark:hover:bg-rose-900/60 text-rose-700 dark:text-rose-300 rounded text-[10px] font-bold transition-colors cursor-pointer"
                          >
                            Apply Action
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        }
        return null;
      })()}

      {/* Status Summary Counts Bar */}
      {renderFilterTags()}

      {/* Main Table view */}
      <div className="overflow-x-auto border border-slate-150 dark:border-slate-800 rounded-xl max-h-[550px] overflow-y-auto bg-white dark:bg-slate-950">
        {isApplying && liveStreamLogs && (
          <div className="p-3 border-b border-slate-150 dark:border-slate-800 bg-slate-900">
            <div className="flex items-center gap-2 mb-1.5">
              <Loader2 className="w-3 h-3 text-green-400 animate-spin shrink-0" />
              <span className="text-[9px] font-bold text-green-400 uppercase tracking-wider">Live — Extracting Next Batch...</span>
            </div>
            <div className="max-h-40 overflow-y-auto font-mono text-[10px] text-green-300 leading-relaxed whitespace-pre-wrap">
              {liveStreamLogs.split('\n').slice(-40).join('\n')}
            </div>
          </div>
        )}
        {renderTableContent()}
      </div>

      {(() => {
        const isPaginatedView = (agentType === 'agent1' || agentType === 'medical_extract') && sortedData.length > PAGE_SIZE;
        return isPaginatedView && (
          <div className="flex items-center justify-between px-1 pt-2 text-[10px] font-mono text-theme-text-secondary">
            <span>
              {interpolate(t(profile?.language, 'tableShowing'), { a: pageStart + 1, b: Math.min(pageStart + PAGE_SIZE, sortedData.length), c: sortedData.length })}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={pageStart === 0}
                onClick={() => setPageStart(Math.max(0, pageStart - PAGE_SIZE))}
                className="px-2 py-1 rounded-lg border border-theme-border bg-theme-bg-card disabled:opacity-40 disabled:cursor-not-allowed font-bold cursor-pointer"
              >
                {t(profile?.language, 'tablePrev50')}
              </button>
              <button
                type="button"
                disabled={pageStart + PAGE_SIZE >= sortedData.length}
                onClick={() => setPageStart(pageStart + PAGE_SIZE)}
                className="px-2 py-1 rounded-lg border border-theme-border bg-theme-bg-card disabled:opacity-40 disabled:cursor-not-allowed font-bold cursor-pointer"
              >
                {t(profile?.language, 'tableNext50')}
              </button>
            </div>
          </div>
        );
      })()}

      {/* Coverage Auditing Diagnostics */}
      {renderCoverageDiagnostics()}

      {/* Verification footer */}
      <div className="p-3 bg-slate-50 dark:bg-slate-900/60 border border-slate-200/60 dark:border-slate-800/80 rounded-xl space-y-1.5">
        {(isMultiphaseActive || totalEstimated > 0) && (
          <div className="flex items-center gap-1.5 pb-1 border-b border-slate-200/40 dark:border-slate-800/40">
            <span className="px-2 py-0.5 bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-400 font-bold rounded-md text-[9px] uppercase tracking-wider font-mono">
              {isMultiphaseActive
                ? (totalEstimated > 0 ? interpolate(t(profile?.language, 'tableExtracting'), { x: agentResult?.currentBatch || 1, y: Math.ceil(totalEstimated / 50) }) : t(profile?.language, 'tableExtracting').replace(/ \(Batch.*/, ''))
                : t(profile?.language, 'tableComplete')}
            </span>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono text-slate-500">
          <div className="flex items-center gap-4">
            {(isMultiphaseActive || totalEstimated > 0) ? (
              <span>
                Extracted Markers: <strong className="text-theme-neutral">
                  {verification.generatedCount}/{totalEstimated}
                </strong>
              </span>
            ) : (
              <>
                <span>
                  Initial Raw Markers: <strong className="text-theme-neutral">{verification.initialCount}</strong>
                </span>
                <span>
                  Generated Table Rows: <strong className="text-theme-neutral">{verification.generatedCount}</strong>
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {verification.hasMismatch && !(isMultiphaseActive || totalEstimated > 0) ? (
              <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-bold">
                <AlertCircle className="w-3.5 h-3.5" />
                DIVERGENCE DETECTED
              </span>
            ) : null}
          </div>
        </div>

        {verification.differenceMsg && !(isMultiphaseActive || totalEstimated > 0) && (
          <div className="relative">
            <div className={`text-[10px] text-amber-600 dark:text-amber-400 leading-relaxed bg-amber-500/5 p-2 rounded-lg border border-amber-500/10 font-sans ${diffExpanded ? 'max-h-40 overflow-y-auto' : 'line-clamp-2'}`}>
              {verification.differenceMsg}
            </div>
            {verification.differenceMsg.length > 120 && (
              <button 
                onClick={() => setDiffExpanded(!diffExpanded)}
                className="text-[10px] text-amber-600 dark:text-amber-400 hover:underline mt-1 cursor-pointer"
              >
                {diffExpanded ? t(profile?.language, 'tableShowLess') : t(profile?.language, 'tableExpand')}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Apply Changes Button or "No changes" info */}
      <div className="pt-1 space-y-2">
        {!hasAnythingToApprove && (
          <div className="w-full py-4 bg-slate-50 dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800/50 rounded-xl flex flex-col items-center justify-center gap-2">
            {isApplying || (agentResult?.status === 'processing' || agentResult?.status === 'in_progress') || isMultiphaseActive ? (
              <span className="text-xs text-indigo-600 dark:text-indigo-400 font-medium flex items-center gap-2 animate-pulse">
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                {t(profile?.language, 'tableSearching')}
              </span>
            ) : counts.isMissing > 0 || (verification.initialCount > 0 && verification.generatedCount === 0) ? (
              <span className="text-xs text-slate-500 italic text-center px-4">
                {t(profile?.language, 'tableUnmapped')}
              </span>
            ) : (
              <span className="text-xs text-slate-500 italic">
                {t(profile?.language, 'tableNoChanges')}
              </span>
            )}
            {onCancel ? (
              <button
                type="button"
                onClick={onCancel}
                className="mt-1 px-4 py-1.5 bg-indigo-100 hover:bg-indigo-200 dark:bg-indigo-900/40 dark:hover:bg-indigo-800/60 text-indigo-700 dark:text-indigo-300 font-bold rounded-lg text-[11px] transition-colors cursor-pointer"
              >
                That's great
              </button>
            ) : onApplyChanges ? (
              <button
                type="button"
                disabled={isApplying}
                onClick={() => onApplyChanges && onApplyChanges(unselectedRowKeys)}
                className="mt-1 px-4 py-1.5 bg-indigo-100 hover:bg-indigo-200 dark:bg-indigo-900/40 dark:hover:bg-indigo-800/60 text-indigo-700 dark:text-indigo-300 font-bold rounded-lg text-[11px] transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
              >
                {isApplying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                {isApplying ? 'Processing...' : 'Mark as Reviewed'}
              </button>
            ) : null}
          </div>
        )}

        {onContinueToNextStep ? (
          <button
            type="button"
            disabled={isApplying}
            onClick={() => {
              const filteredRows = tableData.filter(row => !unselectedRowKeys.includes(row.key));
              onContinueToNextStep(unselectedRowKeys, filteredRows);
            }}
            className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/10 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
          >
            <ArrowRight className="w-4 h-4" />
            Continue to next step
          </button>
        ) : (onApplyChanges && hasAnythingToApprove) ? (
          <>
            <button
              type="button"
              onClick={() => {
                if (isPaginatedView && agentResult) {
                  agentResult.scopeKeys = pagedKeys;
                }
                onApplyChanges(unselectedRowKeys);
              }}
              className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/10 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
            >
              {isApplying ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {isApplying 
                ? 'Applying Agent Findings...' 
                : (agentResult?.status === 'needs_continuation' || agentResult?.needsContinuation || agentResult?.hasMore || agentResult?.hasMoreMarkers)
                  ? t(profile?.language, 'tableContinueBatch')
                  : isPaginatedView && !isLastPage
                    ? 'Apply This Batch'
                    : isPaginatedView
                      ? 'Apply Final Batch'
                      : 'Apply & Save Agent Findings'}
            </button>
            {isPaginatedView && isLastPage && (
              <button
                type="button"
                onClick={() => {
                  if (agentResult) agentResult.scopeKeys = undefined;
                  onApplyChanges(unselectedRowKeys);
                }}
                className="w-full py-1.5 mt-1.5 bg-transparent border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 rounded-xl text-[10px] font-bold hover:bg-indigo-50 dark:hover:bg-indigo-950/30 transition-all cursor-pointer"
              >
                Approve All {sortedData.length} Rows At Once
              </button>
            )}
            {isMultiphaseActive && (
              <button
                type="button"
                disabled={isApplying || justApplied}
                onClick={async () => {
                  if (agentResult) agentResult.forceApplyNow = true;
                  if (onApplyChanges) {
                    try {
                      await onApplyChanges(unselectedRowKeys);
                      setJustApplied(true);
                      setTimeout(() => setJustApplied(false), 2000);
                    } catch (e) {
                      console.error(e);
                    }
                  }
                }}
                className="w-full py-1.5 mt-1.5 bg-transparent border border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 rounded-xl text-[10px] font-bold hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {isApplying ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : justApplied ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                )}
                {isApplying ? t(profile?.language, 'tableApplying') : justApplied ? t(profile?.language, 'tableApplied') : interpolate(t(profile?.language, 'tableApplyN'), { n: tableData.length })}
              </button>
            )}
          </>
        ) : null}

        {agentResult?.status === 'needs_continuation' || agentResult?.needsContinuation || agentResult?.hasMore ? (
          <button
            type="button"
            onClick={() => {
              alert(t(profile?.language, 'alertResumePipeline'));
            }}
            className="w-full py-1.5 px-3 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/30 dark:hover:bg-indigo-950/50 border border-indigo-200/50 text-indigo-700 dark:text-indigo-400 rounded-xl text-[10px] font-bold transition-all flex items-center justify-center gap-1 cursor-pointer"
          >
            <ArrowRight className="w-3 h-3" />
            {t(profile?.language, 'tableContinueAnalysis')}
          </button>
        ) : null}
      </div>

      {/* Full Screen View Modal */}
      {isFullscreen && (
        <div className="fixed inset-0 z-9999 bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-theme-bg-card rounded-3xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden shadow-2xl border border-theme-border animate-scale-up">
            {/* Modal Header */}
            <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900/80 border-b border-theme-border flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-600">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-theme-text text-sm font-display">
                    Fullscreen Explorer — 
                    {(agentType === 'agent1' || agentType === 'medical_extract') && ' Biomarker Extraction'}
                    {agentType === 'biomarker_review' && ' Biomarker Review & Calibration'}
                    {agentType === 'agent2' && ' Category Mapping'}
                    {agentType === 'agent3' && ' Data Assembly'}
                    {(agentType as string) === 'agent4' && ' Prognostic diagnostics'}
                    {agentType === 'data_review' && ' Biomarker Calibration'}
                  </h3>
                  <p className="text-[10px] text-slate-500">
                    Review, sort, and verify data with full high-resolution fidelity.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsFullscreen(false)}
                className="p-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-850 rounded-xl transition-all cursor-pointer"
              >
                <Minimize2 className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Table content */}
            <div className="flex-1 flex flex-col overflow-hidden p-6 bg-slate-50/30 dark:bg-slate-950/20 space-y-4">
              <div className="mb-4">
                {renderFilterTags()}
              </div>
              <div className="flex-1 border border-theme-border rounded-2xl bg-white dark:bg-slate-950 overflow-auto shadow-md">
                {isApplying && liveStreamLogs && (
                  <div className="p-3 border-b border-theme-border bg-slate-900">
                    <div className="flex items-center gap-2 mb-1.5">
                      <Loader2 className="w-3 h-3 text-green-400 animate-spin shrink-0" />
                      <span className="text-[9px] font-bold text-green-400 uppercase tracking-wider">Live — Extracting Next Batch...</span>
                    </div>
                    <div className="max-h-40 overflow-y-auto font-mono text-[10px] text-green-300 leading-relaxed whitespace-pre-wrap">
                      {liveStreamLogs.split('\n').slice(-40).join('\n')}
                    </div>
                  </div>
                )}
                {renderTableContent()}
              </div>
              {renderCoverageDiagnostics()}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900/80 border-t border-theme-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 shrink-0">
              <div className="space-y-1">
                {(isMultiphaseActive || totalEstimated > 0) && (
                  <div className="pb-1">
                    <span className="px-2 py-0.5 bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-400 font-bold rounded-md text-[9px] uppercase tracking-wider font-mono">
                      {isMultiphaseActive 
                        ? `Extraction In Progress ${totalEstimated > 0 ? `(Batch ${agentResult?.currentBatch || 1} of ${Math.ceil(totalEstimated / 50)})` : ''}` 
                        : "Extraction Complete"}
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-4 text-xs font-mono text-slate-500">
                  {(isMultiphaseActive || totalEstimated > 0) ? (
                    <span>
                      Extracted Markers: <strong className="text-slate-800 dark:text-slate-200">
                        {verification.generatedCount}/{totalEstimated}
                      </strong>
                    </span>
                  ) : (
                    <>
                      <span>
                        Initial Raw Markers: <strong className="text-slate-800 dark:text-slate-200">{verification.initialCount}</strong>
                      </span>
                      <span>
                        Generated Table Rows: <strong className="text-slate-800 dark:text-slate-200">{verification.generatedCount}</strong>
                      </span>
                    </>
                  )}
                </div>
                {verification.differenceMsg && !(isMultiphaseActive || totalEstimated > 0) && (
                  <div className="relative mt-2">
                    <div className={`text-[13px] text-amber-500 font-medium ${diffExpanded ? 'max-h-60 overflow-y-auto' : 'line-clamp-2'}`}>
                      {verification.differenceMsg}
                    </div>
                    {verification.differenceMsg.length > 120 && (
                      <button 
                        onClick={() => setDiffExpanded(!diffExpanded)}
                        className="text-[12px] text-amber-500 hover:underline mt-1 cursor-pointer font-bold"
                      >
                        {diffExpanded ? t(profile?.language, 'tableShowLess') : t(profile?.language, 'tableExpand')}
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsFullscreen(false)}
                  className="px-4 py-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  Close Explorer
                </button>
                {onContinueToNextStep ? (
                  <button
                    type="button"
                    disabled={isApplying}
                    onClick={async () => {
                      const filteredRows = tableData.filter(row => !unselectedRowKeys.includes(row.key));
                      await onContinueToNextStep(unselectedRowKeys, filteredRows);
                      setIsFullscreen(false);
                    }}
                    className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/10 flex items-center gap-1.5 transition-all cursor-pointer"
                  >
                    {isApplying ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                    {isApplying ? 'Processing...' : t(profile?.language, 'tableContinueStep')}
                  </button>
                ) : (hasAnythingToApprove && onApplyChanges) ? (
                  <button
                    type="button"
                    disabled={isApplying}
                    onClick={async () => {
                      await onApplyChanges(unselectedRowKeys);
                      setIsFullscreen(false);
                    }}
                    className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/10 flex items-center gap-1.5 transition-all cursor-pointer"
                  >
                    {isApplying ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    {isApplying 
                      ? 'Applying...' 
                      : (agentResult?.status === 'needs_continuation' || agentResult?.needsContinuation || agentResult?.hasMore || agentResult?.hasMoreMarkers)
                        ? t(profile?.language, 'tableContinueBatch')
                        : 'Apply Findings & Close'}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
