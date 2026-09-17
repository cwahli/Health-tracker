import type { AgentResultRowsArgs } from './agentResultRows';
import { toYYYYMMDD } from '../utils/dateUtils';
import {
  getInitialMarkerDetails,
  getInitialMarkersFromText,
  resolveBiomarkerKey,
  sanitizeUnitText,
} from '../utils/agentResultParse';
import { isKeyMarkedNotUsed } from './agentResultRowsBatch';
import { biomarkerDefinitions } from '../utils/biomarkers';
import { extractFallbackModifications, getMappedBiomarkerKey } from '../components/chat-cards/BiomarkerReviewCard';
import { enrichReviewModificationCommands, collectCatalogUnitMap } from '../utils/biomarkerLifecycle';

export function parseAgent1Json(args: {
  agentResult: any;
  profile: any;
  biomarkerHistory: any[];
  initialRawText: string;
}): { parsedRows: any[] } {
  const { agentResult, profile, biomarkerHistory, initialRawText } = args;
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
  return { parsedRows };
}

export function buildAgent1FallbackRows(args: {
  agentResult: any;
  parsedRows: any[];
  profile: any;
  biomarkerHistory: any[];
  initialRawText: string;
}): any[] {
  const { agentResult, parsedRows, profile, biomarkerHistory, initialRawText } = args;
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
          isNotUsed: isKeyMarkedNotUsed(key, biomarkerName, profile),
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

      return finalRowsFallback;
}

export function buildBiomarkerReviewRows(args: {
  agentResult: any;
  profile: any;
  biomarkerHistory: any[];
  initialRawText: string;
}): any[] {
  const { agentResult, profile, biomarkerHistory, initialRawText } = args;
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
  return [];
}
