import { toYYYYMMDD } from '../utils/dateUtils';
import { resolveBiomarkerKey, sanitizeUnitText } from '../utils/agentResultParse';
import { isKeyMarkedNotUsed } from './agentResultRowsBatch';
import { formatOptimalTargetValue } from '../utils/agentCalibration';
import { biomarkerDefinitions } from '../utils/biomarkers';

export function buildMedicalExtractRows(args: { agentResult: any; profile: any; biomarkerHistory: any[] }): any[] {
  const { agentResult, profile, biomarkerHistory } = args;
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

      return finalRowsFallback;
}

export function buildAgent2Rows(args: { agentResult: any; profile: any; mergedInfo: Record<string, { isMerged: boolean; mergedFrom: string[] }> }): any[] {
  const { agentResult, profile, mergedInfo } = args;
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
        
        const mergeInfo = mergedInfo[key];
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

export function buildAgent3Rows(args: { agentResult: any; profile: any; biomarkerHistory: any[] }): any[] {
  const { agentResult, profile, biomarkerHistory } = args;
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

export function buildAgent4Rows(args: { agentResult: any; profile: any }): any[] {
  const { agentResult, profile } = args;
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

export function buildDataReviewRows(args: { agentResult: any; profile: any }): any[] {
  const { agentResult, profile } = args;
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
