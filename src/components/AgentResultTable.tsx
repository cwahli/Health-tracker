import { toYYYYMMDD } from "../utils/dateUtils";
import { parseAgent1Json, buildAgent1FallbackRows } from '../utils/agentResultRowsFallback';
import { buildMedicalExtractRows, buildAgent2Rows, buildAgent3Rows, buildAgent4Rows, buildDataReviewRows } from '../utils/agentResultRowsStages';
import { buildAgentResultRows } from '../utils/agentResultRows';
import { computeMergedInfoForStep2, isKeyMarkedNotUsed } from '../utils/agentResultRowsBatch';
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

// Row/parse helpers live in TypeScript modules (Q-4 KIT_DRIFT extract-only).
// The grid keeps its public export surface via re-export below.
import {
  getInitialMarkersFromText,
  getInitialMarkerDetails,
  resolveBiomarkerKey,
  sanitizeUnitText,
} from '../utils/agentResultParse';
import { readMissingKeys, hasSavedMissingKeys, writeMissingKeys } from '../utils/agentResultMissingKeys';

export {
  getInitialMarkersFromText,
  getInitialMarkerDetails,
  generateSafeKey,
  resolveBiomarkerKey,
} from '../utils/agentResultParse';

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
  const [localSelectedMissingKeys, setLocalSelectedMissingKeys] = useState<string[]>(() => readMissingKeys(agentResult?.batchIdx));

  const isControlled = selectedMissingKeys !== undefined;
  const effectiveSelectedMissingKeys = isControlled ? selectedMissingKeys : localSelectedMissingKeys;

  const handleSelectedMissingKeysChange = (newKeys: string[]) => {
    if (!isControlled) {
      setLocalSelectedMissingKeys(newKeys);
    }
    if (onChangeSelectedMissingKeys) {
      onChangeSelectedMissingKeys(newKeys);
    }
    writeMissingKeys(agentResult?.batchIdx, newKeys);
  };

  const isMultiphaseActive = !!(agentResult?.status === 'needs_continuation' || agentResult?.needsContinuation || agentResult?.hasMore || agentResult?.hasMoreMarkers);
  const totalEstimated = agentResult?.estimatedTotalMarkers || agentResult?.planningDetails?.estimatedTotalMetrics || (isMultiphaseActive ? 60 : 0);

  const mergedInfoForStep2 = useMemo(() => computeMergedInfoForStep2(agentType, precedingAgent1Result, profile), [agentType, precedingAgent1Result]);

  // 1. Parse and extract rows depending on agentType

  const tableData = useMemo(() => {
    if (!agentResult) return [];

    if (agentType === 'agent1') {
      const { parsedRows } = parseAgent1Json({ agentResult, profile, biomarkerHistory, initialRawText });
      {
        const batchRows = buildAgentResultRows({
          agentResult,
          agentType,
          profile,
          biomarkerHistory,
          initialRawText,
          precedingAgent1Result,
          parsedRows,
          mergedInfo: mergedInfoForStep2,
        });
        if (batchRows !== null) return batchRows;
      }
      return buildAgent1FallbackRows({ agentResult, parsedRows, profile, biomarkerHistory, initialRawText });
    }

    if (agentType === 'medical_extract') return buildMedicalExtractRows({ agentResult, profile, biomarkerHistory });
    if (agentType === 'agent2') return buildAgent2Rows({ agentResult, profile, mergedInfo: mergedInfoForStep2 });
    if (agentType === 'agent3') return buildAgent3Rows({ agentResult, profile, biomarkerHistory });
    if (agentType === 'agent4') return buildAgent4Rows({ agentResult, profile });
    if (agentType === 'data_review') return buildDataReviewRows({ agentResult, profile });

    if (agentType === 'biomarker_review') {
      const reviewRows = buildAgentResultRows({
        agentResult,
        agentType,
        profile,
        biomarkerHistory,
        initialRawText,
        precedingAgent1Result,
        parsedRows: [],
        mergedInfo: {},
      });
      if (reviewRows !== null) return reviewRows;
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
        if (!hasSavedMissingKeys(batchIdx)) {
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
