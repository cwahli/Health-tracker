import React, { useState, useMemo } from 'react';
import { parse } from 'yaml';
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
  ArrowRight
} from 'lucide-react';

interface AgentResultTableProps {
  agentType: 'agent1' | 'agent2' | 'agent3' | 'agent4';
  agentResult: any;
  profile?: any;
  biomarkerHistory?: any[];
  initialRawText?: string;
  onApplyChanges?: () => Promise<void>;
  isApplying?: boolean;
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

export const AgentResultTable: React.FC<AgentResultTableProps> = ({
  agentType,
  agentResult,
  profile,
  biomarkerHistory = [],
  initialRawText = '',
  onApplyChanges,
  isApplying = false
}) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [sortField, setSortField] = useState<string>('default');
  const [sortAsc, setSortAsc] = useState<boolean>(true);
  const [statusSortCategory, setStatusSortCategory] = useState<'atRisk' | 'isNew' | 'changed' | 'synced' | null>(null);

  const isMultiphaseActive = !!(agentResult?.status === 'needs_continuation' || agentResult?.needsContinuation || agentResult?.hasMore || agentResult?.hasMoreMarkers);
  const totalEstimated = agentResult?.estimatedTotalMarkers || agentResult?.planningDetails?.estimatedTotalMetrics || (isMultiphaseActive ? 60 : 0);

  // 1. Parse and extract rows depending on agentType
  const tableData = useMemo(() => {
    if (!agentResult) return [];

    if (agentType === 'agent1') {
      // Step 1: Clinical Data Parser (from YAML)
      const yamlText = agentResult.extractedYaml || agentResult;
      let parsedRows: any[] = [];
      
      if (typeof yamlText === 'string') {
        try {
          const parsed = parse(yamlText);
          if (Array.isArray(parsed)) {
            parsedRows = parsed;
          }
        } catch (e) {
          // Robust line-by-line regex fallback parser if YAML parser errors out
          const lines = yamlText.split('\n');
          let current: any = {};
          for (let line of lines) {
            line = line.trim();
            if (line.startsWith('-') || line.startsWith('biomarker:')) {
              if (current.biomarker) parsedRows.push(current);
              current = {};
            }
            const bioMatch = line.match(/(?:-\s+)?biomarker:\s*(.*)/i);
            if (bioMatch) { current.biomarker = bioMatch[1].replace(/['"]/g, '').trim(); }
            const dateMatch = line.match(/date:\s*([\d-]+)/i);
            if (dateMatch) { current.date = dateMatch[1].trim(); }
            const valMatch = line.match(/value:\s*([\d.]+)/i);
            if (valMatch) { current.value = valMatch[1]; }
            const unitMatch = line.match(/unit:\s*(.*)/i);
            if (unitMatch) { current.unit = unitMatch[1].replace(/['"]/g, '').trim(); }
          }
          if (current.biomarker) parsedRows.push(current);
        }
      }

      return parsedRows.map((row: any) => {
        const key = (row.biomarker || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
        const existingEntries = biomarkerHistory.filter((h: any) => h.biomarkers[key] !== undefined);
        const isNew = existingEntries.length === 0;
        
        // Determine severity of biomarker if clinical context is available in customBiomarkers
        const customDef = profile?.customBiomarkers?.[key];
        const normalRange = customDef?.normalRange || '';
        const valueNum = parseFloat(row.value);
        let isAtRisk = false;
        
        if (!isNaN(valueNum) && normalRange) {
          const rangeMatch = normalRange.match(/([\d.]+)\s*-\s*([\d.]+)/);
          if (rangeMatch) {
            const min = parseFloat(rangeMatch[1]);
            const max = parseFloat(rangeMatch[2]);
            if (valueNum < min || valueNum > max) {
              isAtRisk = true;
            }
          }
        }

        let changeReason = `Extracted new ${row.biomarker || 'reading'}: ${row.value} ${row.unit || ''}`;
        let oldValue: any = undefined;
        let isChanged = false;
        if (!isNew && existingEntries.length > 0) {
          const sortedHistory = [...existingEntries].sort((a, b) => b.date.localeCompare(a.date));
          const latestVal = sortedHistory[0].biomarkers[key];
          if (latestVal !== undefined) {
            if (String(latestVal) !== String(row.value)) {
              oldValue = latestVal;
              isChanged = true;
              changeReason = `Value changed from ${latestVal} to ${row.value}`;
            } else {
              changeReason = `New reading of ${row.value} logged on ${row.date}`;
            }
          }
        }

        const riskReason = isAtRisk 
          ? `Value ${row.value} ${row.unit || ''} is outside normal range (${normalRange})` 
          : '';

        return {
          biomarker: row.biomarker || 'Unknown',
          date: row.date || 'N/A',
          value: row.value ?? 'N/A',
          unit: row.unit || '',
          isNew,
          isChanged,
          oldValue,
          isAtRisk,
          severity: isAtRisk ? 1 : 0,
          normalRange,
          changeReason,
          riskReason
        };
      });
    }

    if (agentType === 'agent2') {
      // Step 2: Clinical Ontologist (Mapping)
      const mapping = agentResult.bucketMapping || agentResult || {};
      const entries = Object.entries(mapping).filter(([k]) => k !== 'text' && k !== 'extractedYaml');
      
      return entries.map(([bioName, mapData]: [string, any]) => {
        const key = bioName.toLowerCase().replace(/[^a-z0-9]/g, '_');
        const existingDef = profile?.customBiomarkers?.[key];
        const newGroup = mapData.standardMedicalGrouping || 'Other';
        const oldGroup = existingDef?.standardMedicalGrouping || 'Other';
        const isGroupChanged = newGroup !== oldGroup;
        const newCategories = (mapData.riskCategories || []).join(', ');
        const oldCategories = (existingDef?.riskCategories || []).join(', ');
        const isCategoryChanged = newCategories !== oldCategories;
        const isChanged = isGroupChanged || isCategoryChanged;
        const isNew = !existingDef;

        let changeReason = "";
        if (isNew) {
          changeReason = `Mapped ${bioName} to ${newGroup}`;
        }

        const hasRisk = mapData.riskCategories && mapData.riskCategories.length > 0;
        const riskReason = hasRisk 
          ? `Associated with risk categories: ${mapData.riskCategories.join(', ')}` 
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
        return (bucket.biomarkers || []).map((b: any) => {
          const key = (b.name || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
          const existingDef = profile?.customBiomarkers?.[key];
          const oldGroup = existingDef?.standardMedicalGrouping || 'Other';
          const isGroupChanged = bucket.systemName && bucket.systemName !== oldGroup;
          const isNew = !existingDef;
          
          let hasNewReadings = false;
          if (Array.isArray(b.history) && b.history.length > 0) {
            if (!existingDef) {
              hasNewReadings = true;
            } else {
              const existingDates = biomarkerHistory.filter((h: any) => h.biomarkers[key] !== undefined).map((h: any) => h.date);
              const newDates = b.history.filter((h: any) => h && h.date && !existingDates.includes(h.date));
              if (newDates.length > 0) {
                hasNewReadings = true;
              }
            }
          }

          let changeReason = "";
          if (isNew) {
            changeReason = `Assembled new biomarker: ${b.name}`;
          } else if (hasNewReadings) {
            changeReason = `Integrated ${b.history?.length || 0} readings`;
          }

          const customDef = profile?.customBiomarkers?.[key];
          const hasRisk = customDef?.riskCategories && customDef.riskCategories.length > 0;
          const riskReason = hasRisk 
            ? `Associated with risk categories: ${customDef.riskCategories.join(', ')}` 
            : "";

          return {
            biomarker: b.name || 'Unknown',
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

    if (agentType === 'agent4') {
      // Step 4: Prognostic Diagnostics Assessment
      const conditions = Array.isArray(agentResult.prioritizedConditions) ? agentResult.prioritizedConditions : [];
      return conditions.flatMap((cond: any) => {
        return (Array.isArray(cond.biomarkers) ? cond.biomarkers : []).map((b: any) => {
          const key = (b.key || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
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
            biomarker: b.name || b.key || 'Unknown',
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
        });
      });
    }

    return [];
  }, [agentResult, agentType, biomarkerHistory, profile]);

  // Status counts memo
  const counts = useMemo(() => {
    let atRisk = 0;
    let isNew = 0;
    let changed = 0;
    let synced = 0;
    tableData.forEach(row => {
      if (row.isAtRisk) atRisk++;
      if (row.isNew) isNew++;
      else if (row.isChanged) changed++;
      else synced++;
    });
    return { atRisk, isNew, changed, synced };
  }, [tableData]);

  // 2. Perform sorting
  const sortedData = useMemo(() => {
    const data = [...tableData];
    
    // If a specific status category is selected for priority sorting
    if (statusSortCategory) {
      return data.sort((a, b) => {
        const isA = statusSortCategory === 'atRisk' ? a.isAtRisk 
                   : statusSortCategory === 'isNew' ? a.isNew
                   : statusSortCategory === 'changed' ? (!a.isNew && a.isChanged)
                   : (!a.isNew && !a.isChanged && !a.isAtRisk); // synced
        const isB = statusSortCategory === 'atRisk' ? b.isAtRisk 
                   : statusSortCategory === 'isNew' ? b.isNew
                   : statusSortCategory === 'changed' ? (!b.isNew && b.isChanged)
                   : (!b.isNew && !b.isChanged && !b.isAtRisk); // synced
        
        if (isA && !isB) return -1;
        if (!isA && isB) return 1;
        
        // Secondary fallback
        const aChange = (a.isNew || a.isChanged) ? 1 : 0;
        const bChange = (b.isNew || b.isChanged) ? 1 : 0;
        if (aChange !== bChange) return bChange - aChange;
        return (b.severity || 0) - (a.severity || 0);
      });
    }
    
    if (sortField === 'default') {
      // Default: Sort by changes (isChanged/isNew first) or severity descending
      return data.sort((a, b) => {
        // Primary: isNew or isChanged
        const aChange = (a.isNew || a.isChanged) ? 1 : 0;
        const bChange = (b.isNew || b.isChanged) ? 1 : 0;
        if (aChange !== bChange) return bChange - aChange;
        
        // Secondary: Severity
        return (b.severity || 0) - (a.severity || 0);
      });
    }

    if (sortField === 'isNew') {
      const getStatusPriority = (row: any) => {
        if (row.isAtRisk) return 4;
        if (row.isNew) return 3;
        if (row.isChanged) return 2;
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

  // Check if any row in sortedData has update content
  const hasUpdateContent = useMemo(() => {
    return sortedData.some((row: any) => {
      const hasRisk = row.isAtRisk && row.riskReason;
      const hasChange = row.isNew && row.changeReason;
      return hasRisk || hasChange;
    });
  }, [sortedData]);

  // 3. Verification calculation
  const verification = useMemo(() => {
    let initialCount = 0;
    let generatedCount = tableData.length;
    let missingList: string[] = [];
    let differenceMsg = '';

    if (agentType === 'agent1') {
      const initialMarkers = getInitialMarkersFromText(initialRawText);
      initialCount = Math.max(initialMarkers.length, tableData.length);
      
      // Match missing
      missingList = initialMarkers.filter(initName => {
        const cleanInit = initName.toLowerCase().replace(/[^a-z0-9]/g, '');
        return !tableData.some(row => {
          const cleanRow = (row.biomarker || '').toLowerCase().replace(/[^a-z0-9]/g, '');
          return cleanRow.includes(cleanInit) || cleanInit.includes(cleanRow);
        });
      });
    } else if (agentType === 'agent2') {
      // Count unique markers in preceding agent1 yaml
      const yamlMsg = [...(biomarkerHistory || [])]; // we can approximate or find inside raw YAML if supplied
      const prevYaml = agentResult?.extractedYaml || '';
      let prevCount = 0;
      if (prevYaml) {
        try {
          const parsed = parse(prevYaml);
          if (Array.isArray(parsed)) prevCount = parsed.length;
        } catch(e) {}
      }
      initialCount = prevCount || tableData.length;
    } else {
      initialCount = tableData.length;
    }

    if (initialCount !== generatedCount) {
      if (missingList.length > 0) {
        differenceMsg = `${missingList.length} biomarkers were present in raw input but omitted during extraction: ${missingList.join(', ')}.`;
      } else if (generatedCount > initialCount) {
        differenceMsg = `Agent generated ${generatedCount - initialCount} additional rows or broken-down entries.`;
      } else {
        differenceMsg = `Mismatch detected: Raw count was ${initialCount}, table has ${generatedCount}.`;
      }
    }

    return {
      initialCount,
      generatedCount,
      differenceMsg,
      hasMismatch: initialCount !== generatedCount
    };
  }, [tableData, agentType, initialRawText, agentResult, biomarkerHistory]);

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
      className="px-3 py-2.5 font-bold text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer select-none font-mono text-[10px] tracking-wider uppercase"
    >
      <div className="flex items-center gap-1">
        {label}
        <ArrowUpDown className={`w-3 h-3 text-slate-400 shrink-0 ${sortField === field ? 'text-indigo-600' : ''}`} />
      </div>
    </th>
  );

  const renderTableContent = () => (
    <table className="w-full text-[11px] text-left border-collapse">
      <thead className="bg-slate-50 dark:bg-slate-900 sticky top-0 z-10 border-b border-slate-100 dark:border-slate-800">
        <tr>
          {tableHeader('Biomarker', 'biomarker')}
          {agentType === 'agent1' && tableHeader('Log Date', 'date')}
          {agentType === 'agent1' && tableHeader('Value', 'value')}
          {agentType === 'agent1' && tableHeader('Unit', 'unit')}
          {(agentType === 'agent2' || agentType === 'agent3') && tableHeader('Medical Grouping', 'group')}
          {agentType === 'agent2' && tableHeader('Risk Categories', 'categories')}
          {agentType === 'agent3' && tableHeader('Total Readings', 'totalReadings')}
          {agentType === 'agent4' && tableHeader('Condition Association', 'condition')}
          {tableHeader('Status', 'isNew')}
          {hasUpdateContent && tableHeader('Update', 'riskReason')}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 dark:divide-slate-850">
        {sortedData.map((row: any, idx: number) => {
          const isRowHighlighted = row.isNew || row.isChanged || row.isAtRisk;
          const bgClass = row.isAtRisk 
            ? 'bg-rose-50/30 dark:bg-rose-950/10' 
            : row.isNew 
              ? 'bg-emerald-50/30 dark:bg-emerald-950/10' 
              : row.isChanged 
                ? 'bg-amber-50/30 dark:bg-amber-900/10' 
                : 'bg-white dark:bg-slate-950';

          return (
            <tr key={idx} className={`${bgClass} hover:bg-slate-50/50 dark:hover:bg-slate-900/40 transition-colors`}>
              <td className="px-3 py-2 font-semibold text-slate-900 dark:text-slate-100">
                {row.biomarker}
              </td>
              
              {agentType === 'agent1' && (
                <>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-300 font-mono">
                    {row.date}
                  </td>
                  <td className="px-3 py-2 font-mono">
                    {row.isChanged && row.oldValue !== undefined ? (
                      <div className="flex flex-col gap-0.5">
                        <span className="text-amber-600 dark:text-amber-400 font-bold leading-none">{row.value}</span>
                        <span className="text-[9px] text-slate-400 line-through leading-none">{row.oldValue}</span>
                      </div>
                    ) : (
                      <span className="font-bold text-slate-800 dark:text-slate-200">{row.value}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400">
                    {row.unit}
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
                    <span className="text-slate-600 dark:text-slate-300">{row.group}</span>
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
                    <span className="text-slate-600 dark:text-slate-300">{row.categories || 'None'}</span>
                  )}
                </td>
              )}

              {agentType === 'agent3' && (
                <td className="px-3 py-2 font-mono font-bold text-slate-600 dark:text-slate-300">
                  {row.totalReadings}
                </td>
              )}

              {agentType === 'agent4' && (
                <td className="px-3 py-2">
                  {row.isGroupChanged ? (
                    <div className="flex flex-col gap-0.5">
                      <span className="text-amber-600 dark:text-amber-400 font-bold">{row.condition}</span>
                      <span className="text-[8.5px] text-slate-400 line-through">{row.oldGroup}</span>
                    </div>
                  ) : (
                    <span className="text-slate-600 dark:text-slate-300">{row.condition}</span>
                  )}
                </td>
              )}

              <td className="px-3 py-2 font-mono">
                <div className="flex flex-col gap-0.5">
                  {row.isAtRisk && (
                    <span className="text-rose-600 dark:text-rose-400 font-bold">At Risk</span>
                  )}
                  {row.isNew ? (
                    <span className="text-emerald-600 dark:text-emerald-400 font-bold">New</span>
                  ) : row.isChanged ? (
                    <span className="text-amber-600 dark:text-amber-400 font-bold">Changed</span>
                  ) : (
                    <span className="text-slate-400 dark:text-slate-500">Synced</span>
                  )}
                </div>
              </td>

              {hasUpdateContent && (
                <td className="px-3 py-2 font-mono max-w-[200px] break-words">
                  <div className="flex flex-col gap-0.5">
                    {row.isAtRisk && row.riskReason && (
                      <span className="text-rose-600 dark:text-rose-400 font-bold">
                        {row.riskReason}
                      </span>
                    )}
                    {row.isNew && row.changeReason && (
                      <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                        {row.changeReason}
                      </span>
                    )}
                  </div>
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  return (
    <div className="space-y-3 w-full">
      {/* Table Container Header */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase font-mono font-extrabold text-indigo-600 dark:text-indigo-400 tracking-wider">
            {agentType === 'agent1' && 'Biomarker Extraction Stream'}
            {agentType === 'agent2' && 'Unified Ontology Mapping'}
            {agentType === 'agent3' && 'Data Assembly Diagnostics'}
            {agentType === 'agent4' && 'Prognostic Diagnostics Assessment'}
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

      {/* Status Summary Counts Bar */}
      <div className="flex flex-wrap items-center gap-2 pb-1 bg-slate-50/50 dark:bg-slate-900/40 p-2 rounded-xl border border-slate-100 dark:border-slate-800">
        <button
          type="button"
          onClick={() => setStatusSortCategory(null)}
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold border transition-all cursor-pointer ${
            statusSortCategory === null
              ? 'bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 border-indigo-200'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200/30 hover:bg-slate-200'
          }`}
        >
          Total: {tableData.length}
        </button>
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
        <button
          type="button"
          onClick={() => setStatusSortCategory('synced')}
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold border transition-all cursor-pointer ${
            statusSortCategory === 'synced'
              ? 'bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 border-slate-300'
              : 'bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 border-slate-200/10 hover:bg-slate-100'
          }`}
        >
          Synced: {counts.synced}
        </button>
      </div>

      {/* Main Table view */}
      <div className="overflow-x-auto border border-slate-150 dark:border-slate-800 rounded-xl max-h-64 overflow-y-auto bg-white dark:bg-slate-950">
        {renderTableContent()}
      </div>

      {/* Verification footer */}
      <div className="p-3 bg-slate-50 dark:bg-slate-900/60 border border-slate-200/60 dark:border-slate-800/80 rounded-xl space-y-1.5">
        {(isMultiphaseActive || totalEstimated > 0) && (
          <div className="flex items-center gap-1.5 pb-1 border-b border-slate-200/40 dark:border-slate-800/40">
            <span className="px-2 py-0.5 bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-400 font-bold rounded-md text-[9px] uppercase tracking-wider font-mono">
              {isMultiphaseActive ? "Step 1 of 2: Multiphase Extraction Active" : "Step 2 of 2: Extraction Complete"}
            </span>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono text-slate-500">
          <div className="flex items-center gap-4">
            <span>
              Initial Raw Markers: <strong className="text-slate-700 dark:text-slate-300">
                {(isMultiphaseActive || totalEstimated > 0)
                  ? `${verification.generatedCount}/${totalEstimated}`
                  : verification.initialCount}
              </strong>
            </span>
            <span>
              Generated Table Rows: <strong className="text-slate-700 dark:text-slate-300">
                {(isMultiphaseActive || totalEstimated > 0)
                  ? `${verification.generatedCount}/${totalEstimated}`
                  : verification.generatedCount}
              </strong>
            </span>
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
          <p className="text-[10px] text-amber-600 dark:text-amber-400 leading-relaxed bg-amber-500/5 p-2 rounded-lg border border-amber-500/10 font-sans">
            {verification.differenceMsg}
          </p>
        )}
      </div>

      {/* Apply Changes Button or "No changes" info */}
      <div className="pt-1 space-y-2">
        {hasChanges ? (
          onApplyChanges && (
            <button
              type="button"
              disabled={isApplying}
              onClick={onApplyChanges}
              className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/10 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              {isApplying 
                ? 'Applying Agent Findings...' 
                : (agentResult?.status === 'needs_continuation' || agentResult?.needsContinuation || agentResult?.hasMore)
                  ? 'Save & Continue to Next Batch'
                  : 'Apply & Save Agent Findings'}
            </button>
          )
        ) : (
          <div className="w-full py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800/50 rounded-xl text-center text-xs text-slate-500 italic">
            No changes to apply. All biomarker entries are already up-to-date.
          </div>
        )}

        {agentResult?.status === 'needs_continuation' || agentResult?.needsContinuation || agentResult?.hasMore ? (
          <button
            type="button"
            onClick={() => {
              alert("Resuming pipeline to analyze the next batch of raw biomarker data coordinates...");
            }}
            className="w-full py-1.5 px-3 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/30 dark:hover:bg-indigo-950/50 border border-indigo-200/50 text-indigo-700 dark:text-indigo-400 rounded-xl text-[10px] font-bold transition-all flex items-center justify-center gap-1 cursor-pointer"
          >
            <ArrowRight className="w-3 h-3" />
            Continue Analysis
          </button>
        ) : null}
      </div>

      {/* Full Screen View Modal */}
      {isFullscreen && (
        <div className="fixed inset-0 z-9999 bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden shadow-2xl border border-slate-200 dark:border-slate-800 animate-scale-up">
            {/* Modal Header */}
            <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900/80 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-600">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm font-display">
                    Fullscreen Explorer — 
                    {agentType === 'agent1' && ' Biomarker Extraction'}
                    {agentType === 'agent2' && ' Category Mapping'}
                    {agentType === 'agent3' && ' Data Assembly'}
                    {agentType === 'agent4' && ' Prognostic diagnostics'}
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
            <div className="flex-1 overflow-auto p-6 bg-slate-50/30 dark:bg-slate-950/20">
              <div className="border border-slate-200 dark:border-slate-800 rounded-2xl bg-white dark:bg-slate-950 overflow-hidden shadow-md">
                {renderTableContent()}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900/80 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 shrink-0">
              <div className="space-y-1">
                {(isMultiphaseActive || totalEstimated > 0) && (
                  <div className="pb-1">
                    <span className="px-2 py-0.5 bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-400 font-bold rounded-md text-[9px] uppercase tracking-wider font-mono">
                      {isMultiphaseActive ? "Step 1 of 2: Multiphase Extraction Active" : "Step 2 of 2: Extraction Complete"}
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-4 text-xs font-mono text-slate-500">
                  <span>
                    Initial Raw Markers: <strong className="text-slate-800 dark:text-slate-200">
                      {(isMultiphaseActive || totalEstimated > 0)
                        ? `${verification.generatedCount}/${totalEstimated}`
                        : verification.initialCount}
                    </strong>
                  </span>
                  <span>
                    Generated Table Rows: <strong className="text-slate-800 dark:text-slate-200">
                      {(isMultiphaseActive || totalEstimated > 0)
                        ? `${verification.generatedCount}/${totalEstimated}`
                        : verification.generatedCount}
                    </strong>
                  </span>
                </div>
                {verification.differenceMsg && !(isMultiphaseActive || totalEstimated > 0) && (
                  <p className="text-[10px] text-amber-600 dark:text-amber-400">{verification.differenceMsg}</p>
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
                {hasChanges && onApplyChanges && (
                  <button
                    type="button"
                    disabled={isApplying}
                    onClick={async () => {
                      await onApplyChanges();
                      setIsFullscreen(false);
                    }}
                    className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/10 flex items-center gap-1.5 transition-all cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    {isApplying 
                      ? 'Applying...' 
                      : (agentResult?.status === 'needs_continuation' || agentResult?.needsContinuation || agentResult?.hasMore)
                        ? 'Save & Continue to Next Batch'
                        : 'Apply Findings & Close'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
