import type { AgentResultRowsArgs } from './agentResultRows';
import { toYYYYMMDD } from '../utils/dateUtils';
import { resolveBiomarkerKey, sanitizeUnitText } from '../utils/agentResultParse';

export function computeMergedInfoForStep2(agentType: string, precedingAgent1Result: any, profile: any): { [key: string]: { isMerged: boolean; mergedFrom: string[] } } {
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
}

export const isKeyMarkedNotUsed = (checkKey: string, checkName?: string, profile?: any): boolean => {
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

export function buildAgent1BatchRows(args: AgentResultRowsArgs): any[] {
  const { agentResult, parsedRows, profile, biomarkerHistory } = args;
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
            isNotUsed: isKeyMarkedNotUsed(key, biomarkerName, profile),
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
                isNotUsed: isKeyMarkedNotUsed(suggested_key, rawName, profile),
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
