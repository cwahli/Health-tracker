import React, { useState, useEffect, useMemo } from 'react';
import {
  Sparkles,
  AlertTriangle,
  CheckCircle,
  Layers,
  ArrowRight,
  RefreshCw,
  Sliders,
  Check,
  X,
  ChevronRight,
  ShieldCheck,
  Info,
  GitMerge,
  BookOpen,
  Bot,
  Zap,
  CheckSquare,
  Square
} from 'lucide-react';
import {
  BiomarkerAuditReport,
  BiomarkerAuditItem,
  DuplicateGroupAudit,
  AuditSessionState,
  runGeneralizedBiomarkerAudit,
  loadSavedAuditSession,
  saveAuditSession
} from '../utils/biomarkerAuditEngine';
import { FilterPills } from './ui/FilterPills';
import { t, interpolate, displayBiomarkerName, displayCategoryLabel } from '../utils/i18n';

interface BiomarkerAuditModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'overview' | 'corrupted_units' | 'duplicates' | 'missing_metadata' | 'conflicts' | 'clean';
  initialFocusKey?: string | null;
  profile: any;
  biomarkerHistory: any[];
  biomarkers?: { [key: string]: any };
  onUpdateProfile: (updates: any) => void;
  onDeleteBiomarker?: (key: string) => void;
  onCombineBiomarkers?: (
    targetKey: string,
    targetDef: any,
    mergedLogs: { date: string; value: number | string; originalLogId?: string }[],
    sourceKeysToDelete: string[]
  ) => Promise<void> | void;
  onBatchCombineBiomarkers?: (
    combinations: {
      targetKey: string;
      targetDef: any;
      mergedLogs: { date: string; value: number | string; originalLogId?: string }[];
      sourceKeysToDelete: string[];
    }[]
  ) => Promise<void> | void;
  onLaunchNameConsolidation: (keys: string[]) => void;
  onLaunchUnitStandardization: (keys: string[]) => void;
  onLaunchMedicalCategorisation: (keys: string[]) => void;
  onLaunchRangeCalibrator?: (keys: string[]) => void;
  onSelectBiomarkerKeys?: (keys: string[]) => void;
}

export const BiomarkerAuditModal: React.FC<BiomarkerAuditModalProps> = ({
  isOpen,
  onClose,
  initialTab,
  initialFocusKey,
  profile,
  biomarkerHistory,
  biomarkers,
  onUpdateProfile,
  onDeleteBiomarker,
  onCombineBiomarkers,
  onBatchCombineBiomarkers,
  onLaunchNameConsolidation,
  onLaunchUnitStandardization,
  onLaunchMedicalCategorisation,
  onLaunchRangeCalibrator,
  onSelectBiomarkerKeys
}) => {
  const savedSession = useMemo(() => loadSavedAuditSession(), []);
  const [activeTab, setActiveTab] = useState<'overview' | 'corrupted_units' | 'duplicates' | 'missing_metadata' | 'conflicts' | 'clean'>(() => {
    if (initialTab) return initialTab;
    if (savedSession?.step === 'units_review') return 'corrupted_units';
    if (savedSession?.step === 'duplicates_review') return 'duplicates';
    if (savedSession?.step === 'ranges_review') return 'missing_metadata';
    if (savedSession?.step === 'conflicts_review') return 'conflicts';
    if ((savedSession?.step as any) === 'clean_review') return 'clean';
    return 'overview';
  });

  useEffect(() => {
    if (isOpen && initialTab) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  useEffect(() => {
    if (isOpen && initialFocusKey) {
      setSelectedFixKeys(prev => ({ ...prev, [initialFocusKey]: true }));
    }
  }, [isOpen, initialFocusKey]);
  const [selectedFixKeys, setSelectedFixKeys] = useState<{ [key: string]: boolean }>(() => savedSession?.selectedFixes || {});
  const [showApplyConfirm, setShowApplyConfirm] = useState(false);
  const [showCatalogApproveConfirm, setShowCatalogApproveConfirm] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [appliedMessage, setAppliedMessage] = useState<string | null>(null);
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null);
  const [unitFilter, setUnitFilter] = useState<'all' | 'auto_proposals' | 'agent_review'>('all');
  const [metadataFilter, setMetadataFilter] = useState<'all' | 'catalog' | 'categorise' | 'calibrate' | 'custom_calibrate'>('all');

  const handleDeleteBiomarkerKey = (key: string) => {
    if (onDeleteBiomarker) {
      onDeleteBiomarker(key);
    } else {
      const updatedCustom = { ...(profile?.customBiomarkers || {}) };
      delete updatedCustom[key];
      onUpdateProfile({ customBiomarkers: updatedCustom });
    }
    setAppliedMessage(`Deleted biomarker "${key}"`);
    setTimeout(() => setAppliedMessage(null), 3000);
  };

  const renderDeleteButton = (key: string, name?: string) => {
    if (confirmDeleteKey === key) {
      return (
        <div className="flex items-center gap-1 bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800/80 rounded-md px-1.5 py-0.5 z-10 shrink-0 shadow-xs">
          <span className="text-[10px] font-bold text-rose-600 dark:text-rose-400">Delete?</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleDeleteBiomarkerKey(key);
              setConfirmDeleteKey(null);
            }}
            className="p-0.5 hover:bg-rose-200 dark:hover:bg-rose-900/80 text-rose-700 dark:text-rose-300 rounded font-bold text-[10px] cursor-pointer"
            title="Confirm delete biomarker"
          >
            <Check className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setConfirmDeleteKey(null);
            }}
            className="p-0.5 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 rounded text-[10px] cursor-pointer"
            title="Cancel"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      );
    }

    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setConfirmDeleteKey(key);
        }}
        className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-md transition-colors cursor-pointer shrink-0"
        title={`Delete ${name || key}`}
        aria-label={`Delete biomarker ${name || key}`}
      >
        <X className="w-3.5 h-3.5" />
      </button>
    );
  };

  // Compute live report from profile & history only when modal is open
  const report: BiomarkerAuditReport = useMemo(() => {
    if (!isOpen) {
      return {
        timestamp: '',
        totalScanned: 0,
        corruptedUnitsCount: 0,
        duplicateCandidatesCount: 0,
        missingRangesCount: 0,
        conflictsCount: 0,
        cleanCount: 0,
        items: [],
        duplicateGroups: []
      };
    }
    return runGeneralizedBiomarkerAudit(
      profile?.customBiomarkers || {},
      biomarkerHistory || [],
      biomarkers || {},
      profile?.deletedCustomBiomarkerKeys || {},
      profile?.language
    );
  }, [isOpen, profile?.customBiomarkers, profile?.deletedCustomBiomarkerKeys, profile?.language, biomarkerHistory, biomarkers]);

  // Automatic background continuity persistence on any change (no manual button required)
  useEffect(() => {
    if (!isOpen) return;
    const sessionState: AuditSessionState = {
      id: `audit_auto_${Date.now()}`,
      createdAt: savedSession?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      step: activeTab === 'overview' 
        ? 'triage' 
        : (activeTab === 'corrupted_units' 
          ? 'units_review' 
          : (activeTab === 'duplicates' 
            ? 'duplicates_review' 
            : (activeTab === 'conflicts' ? 'conflicts_review' : 'ranges_review'))),
      selectedFixes: selectedFixKeys,
      autoFixUnits: [],
      duplicateMergeQueue: [],
      status: 'in_progress'
    };
    saveAuditSession(sessionState);
  }, [isOpen, activeTab, selectedFixKeys, savedSession?.createdAt]);

  // Initialize selected fixes for corrupted unit items (both auto-proposals and agent review)
  useEffect(() => {
    if (report && report.items) {
      const initial: { [key: string]: boolean } = {};
      report.items.forEach(item => {
        if (item.status === 'corrupted_unit') {
          initial[item.key] = true;
        }
      });
      setSelectedFixKeys(prev => (Object.keys(prev).length === 0 ? initial : prev));
    }
  }, [report]);

  const corruptedUnitItems = report.items.filter(i => i.status === 'corrupted_unit');
  const targetAutoUnitItems = useMemo(() => corruptedUnitItems.filter(i => !!i.corruptedUnitProposal?.proposedUnit), [corruptedUnitItems]);
  const targetAgentUnitItems = useMemo(() => corruptedUnitItems.filter(i => !i.corruptedUnitProposal?.proposedUnit), [corruptedUnitItems]);
  const targetAutoUnitKeys = useMemo(() => targetAutoUnitItems.map(i => i.key), [targetAutoUnitItems]);
  const targetAgentUnitKeys = useMemo(() => targetAgentUnitItems.map(i => i.key), [targetAgentUnitItems]);

  const selectedAutoUnitKeys = useMemo(() => targetAutoUnitKeys.filter(k => selectedFixKeys[k]), [targetAutoUnitKeys, selectedFixKeys]);
  const selectedAgentUnitKeys = useMemo(() => targetAgentUnitKeys.filter(k => selectedFixKeys[k]), [targetAgentUnitKeys, selectedFixKeys]);

  const filteredCorruptedUnitItems = useMemo(() => {
    if (unitFilter === 'auto_proposals') {
      return targetAutoUnitItems;
    }
    if (unitFilter === 'agent_review') {
      return targetAgentUnitItems;
    }
    return corruptedUnitItems;
  }, [corruptedUnitItems, unitFilter, targetAutoUnitItems, targetAgentUnitItems]);

  const duplicateCandidateItems = report.items.filter(i => i.status === 'duplicate_candidate' || i.duplicateCluster);
  const missingMetadataItems = report.items.filter(i => i.status === 'missing_ranges');
  const conflictItems = report.items.filter(i => i.status === 'conflict');
  const cleanItems = report.items.filter(i => i.status === 'clean');
  const catalogMatchCount = missingMetadataItems.filter(i => i.missingMetadata?.catalogMatch).length;

  const targetCategoriseKeys = useMemo(() => missingMetadataItems.filter(i => !!i.missingMetadata?.missingCategory).map(i => i.key), [missingMetadataItems]);
  const targetCatalogItems = useMemo(() => missingMetadataItems.filter(i => !!i.missingMetadata?.catalogMatch), [missingMetadataItems]);
  const targetCustomCalibrateItems = useMemo(() => missingMetadataItems.filter(i => !!i.missingMetadata?.missingRange || !!i.missingMetadata?.missingBrackets), [missingMetadataItems]);
  const targetCalibrateItems = useMemo(() => missingMetadataItems.filter(i => !!i.missingMetadata?.missingRange || !!i.missingMetadata?.missingBrackets), [missingMetadataItems]);
  const targetCustomCalibrateKeys = useMemo(() => targetCustomCalibrateItems.map(i => i.key), [targetCustomCalibrateItems]);

  const filteredMissingMetadataItems = useMemo(() => {
    if (metadataFilter === 'catalog') {
      return targetCatalogItems;
    }
    if (metadataFilter === 'custom_calibrate') {
      return targetCustomCalibrateItems;
    }
    if (metadataFilter === 'calibrate') {
      return targetCalibrateItems;
    }
    if (metadataFilter === 'categorise') {
      return missingMetadataItems.filter(i => !!i.missingMetadata?.missingCategory);
    }
    return missingMetadataItems;
  }, [missingMetadataItems, metadataFilter, targetCatalogItems, targetCustomCalibrateItems, targetCalibrateItems]);

  // Candidate keys for agent handoffs
  const duplicateKeys = Array.from(new Set(duplicateCandidateItems.flatMap(i => i.duplicateCluster?.clusterKeys || [i.key])));
  const missingUnitKeys = corruptedUnitItems.map(i => i.key);
  const missingRangeKeys = missingMetadataItems.map(i => i.key);
  const conflictKeys = conflictItems.map(i => i.key);

  if (!isOpen) return null;

  const handleToggleFix = (key: string) => {
    setSelectedFixKeys(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const handleSelectAllFixes = (items: BiomarkerAuditItem[]) => {
    const next = { ...selectedFixKeys };
    const allSelected = items.every(i => next[i.key]);
    items.forEach(i => {
      next[i.key] = !allSelected;
    });
    setSelectedFixKeys(next);
  };

  // Safe apply for user-confirmed unit repairs
  const handleApplySelectedUnitFixes = async () => {
    setIsApplying(true);
    try {
      const newCustomBiomarkers = { ...(profile?.customBiomarkers || {}) };
      let fixed = 0;

      report.items.forEach(item => {
        if (selectedFixKeys[item.key] && item.corruptedUnitProposal?.proposedUnit) {
          const currentDef = newCustomBiomarkers[item.key] || {};
          newCustomBiomarkers[item.key] = {
            ...currentDef,
            unit: item.corruptedUnitProposal.proposedUnit,
            updatedAt: Date.now()
          };
          delete newCustomBiomarkers[item.key].needsApproval;
          fixed++;
        }
      });

      await onUpdateProfile({ customBiomarkers: newCustomBiomarkers });
      setSelectedFixKeys({});
      setAppliedMessage(`Successfully applied ${fixed} biomarker unit repair(s)!`);
      setShowApplyConfirm(false);

      saveAuditSession({
        id: `audit_auto_${Date.now()}`,
        createdAt: savedSession?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        step: 'completed',
        selectedFixes: {},
        autoFixUnits: [],
        duplicateMergeQueue: [],
        status: 'applied'
      });
    } catch (e: any) {
      alert(`Error applying unit repairs: ${e.message}`);
    } finally {
      setIsApplying(false);
    }
  };

  // 1-Click Automated Consolidation for a single duplicate cluster
  const handleApplySingleDuplicateConsolidation = async (group: DuplicateGroupAudit) => {
    if (!group.candidateAliases || group.candidateAliases.length === 0) return;
    setIsApplying(true);
    try {
      const masterKey = group.suggestedMasterKey;
      const customBiomarkers = profile?.customBiomarkers || {};
      const masterDef = { ...(customBiomarkers[masterKey] || {}) };
      const sourceKeysToDelete = group.candidateAliases.filter(k => k !== masterKey);

      // Enrich master definition with any richer metadata found in alias definitions
      sourceKeysToDelete.forEach(k => {
        const aliasDef = customBiomarkers[k] || {};
        if (!masterDef.description && (aliasDef.description || aliasDef.descriptions)) {
          masterDef.description = aliasDef.description || aliasDef.descriptions?.en || '';
        }
        if (aliasDef.descriptions) {
          masterDef.descriptions = { ...(aliasDef.descriptions || {}), ...(masterDef.descriptions || {}) };
        }
        if ((!masterDef.category || masterDef.category === 'other' || masterDef.category === 'wellness') && aliasDef.category && aliasDef.category !== 'other' && aliasDef.category !== 'wellness') {
          masterDef.category = aliasDef.category;
        }
        if (!masterDef.standardMedicalGrouping && aliasDef.standardMedicalGrouping) {
          masterDef.standardMedicalGrouping = aliasDef.standardMedicalGrouping;
        }
        if ((!masterDef.normalRange || masterDef.normalRange === 'Unknown') && aliasDef.normalRange && aliasDef.normalRange !== 'Unknown') {
          masterDef.normalRange = aliasDef.normalRange;
        }
        if ((!masterDef.rangeBrackets || masterDef.rangeBrackets.length === 0) && Array.isArray(aliasDef.rangeBrackets) && aliasDef.rangeBrackets.length > 0) {
          masterDef.rangeBrackets = aliasDef.rangeBrackets;
        }
        if (!masterDef.optimalValue && aliasDef.optimalValue) {
          masterDef.optimalValue = aliasDef.optimalValue;
        }
        if (masterDef.target === undefined && aliasDef.target !== undefined) {
          masterDef.target = aliasDef.target;
        }
        if (aliasDef.riskCategories && Array.isArray(aliasDef.riskCategories)) {
          const combinedRisks = Array.from(new Set([...(masterDef.riskCategories || []), ...aliasDef.riskCategories]));
          masterDef.riskCategories = combinedRisks;
        }
        if (aliasDef.potentialMedicalConditions && Array.isArray(aliasDef.potentialMedicalConditions)) {
          const combinedConditions = Array.from(new Set([...(masterDef.potentialMedicalConditions || []), ...aliasDef.potentialMedicalConditions]));
          masterDef.potentialMedicalConditions = combinedConditions;
        }
      });

      // Build merged log entries
      const mergedLogsMap: { [date: string]: { date: string; value: number | string; originalLogId?: string } } = {};
      biomarkerHistory.forEach(log => {
        if (log.biomarkers) {
          // Check master value
          if (log.biomarkers[masterKey] !== undefined) {
            mergedLogsMap[log.date] = {
              date: log.date,
              value: log.biomarkers[masterKey],
              originalLogId: log.id
            };
          } else {
            // Check candidate aliases
            for (const aliasKey of sourceKeysToDelete) {
              if (log.biomarkers[aliasKey] !== undefined) {
                mergedLogsMap[log.date] = {
                  date: log.date,
                  value: log.biomarkers[aliasKey],
                  originalLogId: log.id
                };
                break;
              }
            }
          }
        }
      });

      const mergedLogs = Object.values(mergedLogsMap);

      if (onCombineBiomarkers) {
        await onCombineBiomarkers(masterKey, masterDef, mergedLogs, sourceKeysToDelete);
      } else {
        // Fallback local update
        const updatedCustom = { ...customBiomarkers };
        sourceKeysToDelete.forEach(k => delete updatedCustom[k]);
        updatedCustom[masterKey] = masterDef;
        onUpdateProfile({ customBiomarkers: updatedCustom });
      }

      setAppliedMessage(`Consolidated ${sourceKeysToDelete.length} alias(es) into master "${group.suggestedMasterName}" (${masterKey})!`);
    } catch (e: any) {
      alert(`Error consolidating duplicate cluster: ${e.message}`);
    } finally {
      setIsApplying(false);
    }
  };

  // 1-Click Automated Consolidation for ALL duplicate clusters
  const handleApplyAllDuplicateConsolidations = async () => {
    if (report.duplicateGroups.length === 0) return;
    setIsApplying(true);
    try {
      const customBiomarkers = profile?.customBiomarkers || {};
      const combinations = report.duplicateGroups.map(group => {
        const masterKey = group.suggestedMasterKey;
        const masterDef = { ...(customBiomarkers[masterKey] || {}) };
        const sourceKeysToDelete = group.candidateAliases.filter(k => k !== masterKey);

        // Enrich master definition with any richer metadata found in alias definitions
        sourceKeysToDelete.forEach(k => {
          const aliasDef = customBiomarkers[k] || {};
          if (!masterDef.description && (aliasDef.description || aliasDef.descriptions)) {
            masterDef.description = aliasDef.description || aliasDef.descriptions?.en || '';
          }
          if (aliasDef.descriptions) {
            masterDef.descriptions = { ...(aliasDef.descriptions || {}), ...(masterDef.descriptions || {}) };
          }
          if ((!masterDef.category || masterDef.category === 'other' || masterDef.category === 'wellness') && aliasDef.category && aliasDef.category !== 'other' && aliasDef.category !== 'wellness') {
            masterDef.category = aliasDef.category;
          }
          if (!masterDef.standardMedicalGrouping && aliasDef.standardMedicalGrouping) {
            masterDef.standardMedicalGrouping = aliasDef.standardMedicalGrouping;
          }
          if ((!masterDef.normalRange || masterDef.normalRange === 'Unknown') && aliasDef.normalRange && aliasDef.normalRange !== 'Unknown') {
            masterDef.normalRange = aliasDef.normalRange;
          }
          if ((!masterDef.rangeBrackets || masterDef.rangeBrackets.length === 0) && Array.isArray(aliasDef.rangeBrackets) && aliasDef.rangeBrackets.length > 0) {
            masterDef.rangeBrackets = aliasDef.rangeBrackets;
          }
          if (!masterDef.optimalValue && aliasDef.optimalValue) {
            masterDef.optimalValue = aliasDef.optimalValue;
          }
          if (masterDef.target === undefined && aliasDef.target !== undefined) {
            masterDef.target = aliasDef.target;
          }
          if (aliasDef.riskCategories && Array.isArray(aliasDef.riskCategories)) {
            masterDef.riskCategories = Array.from(new Set([...(masterDef.riskCategories || []), ...aliasDef.riskCategories]));
          }
          if (aliasDef.potentialMedicalConditions && Array.isArray(aliasDef.potentialMedicalConditions)) {
            masterDef.potentialMedicalConditions = Array.from(new Set([...(masterDef.potentialMedicalConditions || []), ...aliasDef.potentialMedicalConditions]));
          }
        });

        // Build merged log entries
        const mergedLogsMap: { [date: string]: { date: string; value: number | string; originalLogId?: string } } = {};
        biomarkerHistory.forEach(log => {
          if (log.biomarkers) {
            if (log.biomarkers[masterKey] !== undefined) {
              mergedLogsMap[log.date] = {
                date: log.date,
                value: log.biomarkers[masterKey],
                originalLogId: log.id
              };
            } else {
              for (const aliasKey of sourceKeysToDelete) {
                if (log.biomarkers[aliasKey] !== undefined) {
                  mergedLogsMap[log.date] = {
                    date: log.date,
                    value: log.biomarkers[aliasKey],
                    originalLogId: log.id
                  };
                  break;
                }
              }
            }
          }
        });

        return {
          targetKey: masterKey,
          targetDef: masterDef,
          mergedLogs: Object.values(mergedLogsMap),
          sourceKeysToDelete
        };
      });

      if (onBatchCombineBiomarkers) {
        await onBatchCombineBiomarkers(combinations);
      } else if (onCombineBiomarkers) {
        for (const combo of combinations) {
          await onCombineBiomarkers(combo.targetKey, combo.targetDef, combo.mergedLogs, combo.sourceKeysToDelete);
        }
      } else {
        const updatedCustom = { ...customBiomarkers };
        combinations.forEach(combo => {
          combo.sourceKeysToDelete.forEach(k => delete updatedCustom[k]);
          updatedCustom[combo.targetKey] = combo.targetDef;
        });
        onUpdateProfile({ customBiomarkers: updatedCustom });
      }

      setAppliedMessage(`Successfully consolidated all ${report.duplicateGroups.length} duplicate clusters!`);
    } catch (e: any) {
      alert(`Error during automated consolidation: ${e.message}`);
    } finally {
      setIsApplying(false);
    }
  };

  // 1-Click Automated Fix for Single Catalog Range & Category
  const handleApplySingleCatalogRangeFix = (item: BiomarkerAuditItem) => {
    const match = item.missingMetadata?.catalogMatch;
    if (!match) return;
    setIsApplying(true);
    try {
      const updatedCustom = { ...(profile?.customBiomarkers || {}) };
      const currentDef = updatedCustom[item.key] || {};
      updatedCustom[item.key] = {
        ...currentDef,
        ...(match.normalRange ? { normalRange: match.normalRange } : {}),
        ...(match.category ? { category: match.category } : {}),
        ...(match.standardMedicalGrouping ? { standardMedicalGrouping: match.standardMedicalGrouping } : {}),
        ...(match.unit && !currentDef.unit ? { unit: match.unit } : {}),
        ...(match.descriptions ? { descriptions: match.descriptions } : {}),
        needsApproval: false,
        catalogApproved: true,
        updatedAt: Date.now()
      };

      onUpdateProfile({ customBiomarkers: updatedCustom });
      setAppliedMessage(`Updated "${item.name}" with standard range "${match.normalRange}"!`);
      setTimeout(() => setAppliedMessage(null), 3000);
    } catch (e: any) {
      alert(`Error applying catalog range: ${e.message}`);
    } finally {
      setIsApplying(false);
    }
  };

  // Automated Fix for Catalog-Matched Missing Ranges & Categories
  const handleApplyCatalogRangeFixes = () => {
    const catalogMatchItems = report.items.filter(i => i.missingMetadata?.catalogMatch);
    if (catalogMatchItems.length === 0) return;
    setIsApplying(true);
    try {
      const updatedCustom = { ...(profile?.customBiomarkers || {}) };
      let count = 0;

      catalogMatchItems.forEach(item => {
        const match = item.missingMetadata?.catalogMatch;
        if (!match) return;
        const currentDef = updatedCustom[item.key] || {};
        updatedCustom[item.key] = {
          ...currentDef,
          ...(match.normalRange ? { normalRange: match.normalRange } : {}),
          ...(match.category ? { category: match.category } : {}),
          ...(match.standardMedicalGrouping ? { standardMedicalGrouping: match.standardMedicalGrouping } : {}),
          ...(match.unit && !currentDef.unit ? { unit: match.unit } : {}),
          ...(match.descriptions ? { descriptions: match.descriptions } : {}),
          needsApproval: false,
          catalogApproved: true,
          updatedAt: Date.now()
        };
        count++;
      });

      onUpdateProfile({ customBiomarkers: updatedCustom });
      setShowCatalogApproveConfirm(false);
      setAppliedMessage(`Enriched ${count} biomarkers with standard clinical reference ranges and categories!`);
      setTimeout(() => setAppliedMessage(null), 3000);
    } catch (e: any) {
      alert(`Error applying catalog ranges: ${e.message}`);
    } finally {
      setIsApplying(false);
    }
  };

  // 1-Click Automated Fix for Conflict Resolution
  const handleApplyConflictFix = (item: BiomarkerAuditItem) => {
    const resolution = item.conflictInfo?.suggestedResolution;
    if (!resolution) return;
    setIsApplying(true);
    try {
      const updatedCustom = { ...(profile?.customBiomarkers || {}) };
      const currentDef = updatedCustom[item.key] || {};

      if (resolution.action === 'scale_brackets_to_declared') {
        updatedCustom[item.key] = {
          ...currentDef,
          normalRange: resolution.scaledRange || currentDef.normalRange,
          unit: resolution.targetUnit,
          rangeBrackets: (currentDef.rangeBrackets || []).map((b: any) => ({
            ...b,
            range: b.range ? b.range.replace(new RegExp(item.conflictInfo?.bracketUnit || '', 'gi'), resolution.targetUnit) : b.range
          })),
          updatedAt: Date.now()
        };
      } else {
        // align declared to brackets
        updatedCustom[item.key] = {
          ...currentDef,
          unit: resolution.targetUnit,
          updatedAt: Date.now()
        };
      }

      onUpdateProfile({ customBiomarkers: updatedCustom });
      setAppliedMessage(`Resolved unit conflict for ${item.name} (${item.key})!`);
    } catch (e: any) {
      alert(`Error resolving conflict: ${e.message}`);
    } finally {
      setIsApplying(false);
    }
  };

  // 1-Click Automated Fix for ALL conflicts
  const handleApplyAllConflictFixes = () => {
    const conflicts = report.items.filter(i => i.status === 'conflict' && i.conflictInfo?.suggestedResolution);
    if (conflicts.length === 0) return;
    setIsApplying(true);
    try {
      const updatedCustom = { ...(profile?.customBiomarkers || {}) };
      conflicts.forEach(item => {
        const resolution = item.conflictInfo?.suggestedResolution;
        if (!resolution) return;
        const currentDef = updatedCustom[item.key] || {};
        if (resolution.action === 'scale_brackets_to_declared') {
          updatedCustom[item.key] = {
            ...currentDef,
            normalRange: resolution.scaledRange || currentDef.normalRange,
            unit: resolution.targetUnit,
            rangeBrackets: (currentDef.rangeBrackets || []).map((b: any) => ({
              ...b,
              range: b.range ? b.range.replace(new RegExp(item.conflictInfo?.bracketUnit || '', 'gi'), resolution.targetUnit) : b.range
            })),
            updatedAt: Date.now()
          };
        } else {
          updatedCustom[item.key] = {
            ...currentDef,
            unit: resolution.targetUnit,
            updatedAt: Date.now()
          };
        }
      });

      onUpdateProfile({ customBiomarkers: updatedCustom });
      setAppliedMessage(`Resolved ${conflicts.length} unit conflict(s) successfully!`);
    } catch (e: any) {
      alert(`Error resolving conflicts: ${e.message}`);
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-0 animate-in fade-in">
      <div className="bg-white dark:bg-slate-900 w-full h-full rounded-none flex flex-col overflow-hidden text-slate-800 dark:text-slate-100">
        
        {/* MODAL HEADER */}
        <div className="p-3.5 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/40 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-slate-800 dark:text-slate-100">Biomarker diagnostic</h2>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                <strong className="text-slate-700 dark:text-slate-200">{report.totalScanned}</strong> custom biomarkers
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* NOTIFICATION BANNER */}
        {appliedMessage && (
          <div className="bg-emerald-50 dark:bg-emerald-950/40 border-b border-emerald-200 dark:border-emerald-800 px-4 py-2.5 flex items-center justify-between text-xs text-emerald-800 dark:text-emerald-300 shrink-0">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>{appliedMessage}</span>
            </div>
            <button onClick={() => setAppliedMessage(null)} className="text-emerald-600 hover:underline text-[11px] font-bold cursor-pointer">
              Dismiss
            </button>
          </div>
        )}

        {/* TAB NAVIGATION */}
        <div className="flex items-center gap-1 px-4 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto text-xs font-semibold shrink-0">
          <button
            onClick={() => setActiveTab('overview')}
            className={`py-3 px-3 border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'overview'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            Triage Overview
          </button>
          <button
            onClick={() => setActiveTab('corrupted_units')}
            className={`py-3 px-3 border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'corrupted_units'
                ? 'border-amber-500 text-amber-600 dark:text-amber-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
            Corrupted Units ({report.corruptedUnitsCount})
          </button>
          <button
            onClick={() => setActiveTab('duplicates')}
            className={`py-3 px-3 border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'duplicates'
                ? 'border-violet-600 text-violet-600 dark:text-violet-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <GitMerge className="w-3.5 h-3.5 text-violet-500" />
            Duplicates & Aliases ({report.duplicateGroups.length} groups)
          </button>
          <button
            onClick={() => setActiveTab('missing_metadata')}
            className={`py-3 px-3 border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'missing_metadata'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5 text-blue-500" />
            Missing Metadata ({report.missingRangesCount})
          </button>
          {report.conflictsCount > 0 && (
            <button
              onClick={() => setActiveTab('conflicts')}
              className={`py-3 px-3 border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'conflicts'
                  ? 'border-rose-600 text-rose-600 dark:text-rose-400'
                  : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
              Scale & Unit Conflicts ({report.conflictsCount})
            </button>
          )}
          <button
            onClick={() => setActiveTab('clean')}
            className={`py-3 px-3 border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'clean'
                ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
            Fully Clean ({report.cleanCount})
          </button>
        </div>

        {/* CONTENT BODY */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">

          {/* TAB 1: OVERVIEW & SMART AGENT ROUTING */}
          {activeTab === 'overview' && (
            <div className="space-y-6 max-w-7xl mx-auto">
              {/* METRIC SUMMARY CARDS */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <button
                  type="button"
                  onClick={() => setActiveTab('corrupted_units')}
                  className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 hover:border-amber-400 dark:hover:border-amber-700/80 hover:shadow-md transition-all text-left cursor-pointer group"
                >
                  <div className="flex items-center justify-between">
                    <div className="text-2xl font-black text-amber-700 dark:text-amber-400">{report.corruptedUnitsCount}</div>
                    <ChevronRight className="w-4 h-4 text-amber-400 group-hover:translate-x-0.5 transition-transform" />
                  </div>
                  <div className="text-xs font-bold text-amber-900 dark:text-amber-300 mt-1">Corrupted Units</div>
                  <div className="text-[10px] text-amber-700/80 dark:text-amber-400/70">"null" or invalid (Click to view)</div>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('duplicates')}
                  className="p-4 rounded-xl bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-900/40 hover:border-violet-400 dark:hover:border-violet-700/80 hover:shadow-md transition-all text-left cursor-pointer group"
                >
                  <div className="flex items-center justify-between">
                    <div className="text-2xl font-black text-violet-700 dark:text-violet-400">{report.duplicateGroups.length}</div>
                    <ChevronRight className="w-4 h-4 text-violet-400 group-hover:translate-x-0.5 transition-transform" />
                  </div>
                  <div className="text-xs font-bold text-violet-900 dark:text-violet-300 mt-1">Duplicate Groups</div>
                  <div className="text-[10px] text-violet-700/80 dark:text-violet-400/70">Synonyms & empty aliases (Click to view)</div>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('missing_metadata')}
                  className="p-4 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/40 hover:border-blue-400 dark:hover:border-blue-700/80 hover:shadow-md transition-all text-left cursor-pointer group"
                >
                  <div className="flex items-center justify-between">
                    <div className="text-2xl font-black text-blue-700 dark:text-blue-400">{report.missingRangesCount}</div>
                    <ChevronRight className="w-4 h-4 text-blue-400 group-hover:translate-x-0.5 transition-transform" />
                  </div>
                  <div className="text-xs font-bold text-blue-900 dark:text-blue-300 mt-1">Missing Metadata</div>
                  <div className="text-[10px] text-blue-700/80 dark:text-blue-400/70">{catalogMatchCount} match catalog (Click to view)</div>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('conflicts')}
                  className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/40 hover:border-rose-400 dark:hover:border-rose-700/80 hover:shadow-md transition-all text-left cursor-pointer group"
                >
                  <div className="flex items-center justify-between">
                    <div className="text-2xl font-black text-rose-700 dark:text-rose-400">{report.conflictsCount}</div>
                    <ChevronRight className="w-4 h-4 text-rose-400 group-hover:translate-x-0.5 transition-transform" />
                  </div>
                  <div className="text-xs font-bold text-rose-900 dark:text-rose-300 mt-1">Unit Conflicts</div>
                  <div className="text-[10px] text-rose-700/80 dark:text-rose-400/70">Declared vs Bracket (Click to view)</div>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('clean')}
                  className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/40 hover:border-emerald-400 dark:hover:border-emerald-700/80 hover:shadow-md transition-all text-left cursor-pointer group"
                >
                  <div className="flex items-center justify-between">
                    <div className="text-2xl font-black text-emerald-700 dark:text-emerald-400">{report.cleanCount}</div>
                    <ChevronRight className="w-4 h-4 text-emerald-400 group-hover:translate-x-0.5 transition-transform" />
                  </div>
                  <div className="text-xs font-bold text-emerald-900 dark:text-emerald-300 mt-1">Fully Clean</div>
                  <div className="text-[10px] text-emerald-700/80 dark:text-emerald-400/70">Valid unit & brackets (Click to view)</div>
                </button>
              </div>

              {/* EXPLANATION NOTE ON WHY INITIAL COUNT WAS 0 CLEAN BIOMARKERS */}
              <div className="p-4 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900/50 space-y-2">
                <div className="flex items-center gap-2">
                  <Info className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                  <span className="text-xs font-bold text-indigo-900 dark:text-indigo-200">
                    Why did the initial audit count 0 clean biomarkers?
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  Every custom biomarker in your dictionary initially either had a missing reference bracket/category ({report.missingRangesCount}), was an unmerged synonym/alias ({report.duplicateCandidatesCount}), or had an invalid unit declaration ({report.corruptedUnitsCount}).
                  The audit engine has automatically matched standard medical catalog definitions and formulated instant 1-click proposals for every category below!
                </p>
              </div>

              {/* ACTION PIPELINE CARDS - UNIFIED AUTO-PROPOSAL + AGENT ASSISTANCE PATTERN */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Standard Proposal Pipeline — Approve Automated Fix or Request Agent
                </h3>

                {/* 1. Auto-Repair Units Card */}
                {report.corruptedUnitsCount > 0 && (
                  <div className="p-4 rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/40 dark:bg-amber-950/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-slate-800 dark:text-slate-100">1. Corrupted Unit Repair</span>
                        <span className="px-2 py-0.5 bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-300 text-[10px] font-bold rounded-full">
                          {report.corruptedUnitsCount} Fixes Proposed
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-300">
                        Automatically repairs "null" and placeholder units extracted from optimal values and lab consensus.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => setShowApplyConfirm(true)}
                        className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg shadow-sm flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <Zap className="w-3.5 h-3.5" />
                        Approve Unit Fixes ({report.corruptedUnitsCount})
                      </button>
                      <button
                        onClick={() => {
                          onClose();
                          onLaunchUnitStandardization(missingUnitKeys);
                        }}
                        className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
                      >
                        <Bot className="w-3.5 h-3.5 text-amber-500" />
                        Ask Unit Agent
                      </button>
                    </div>
                  </div>
                )}

                {/* 2. Duplicates & Aliases Consolidation Card */}
                {report.duplicateGroups.length > 0 && (
                  <div className="p-4 rounded-xl border border-violet-200 dark:border-violet-900/50 bg-violet-50/40 dark:bg-violet-950/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-slate-800 dark:text-slate-100">2. Duplicates & Empty Aliases Consolidation</span>
                        <span className="px-2 py-0.5 bg-violet-100 dark:bg-violet-950/60 text-violet-800 dark:text-violet-300 text-[10px] font-bold rounded-full">
                          {report.duplicateGroups.length} Clusters ({report.duplicateCandidatesCount} Aliases)
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-300">
                        Merges synonym keys into single primary master biomarkers, migrating lab logs and clearing orphaned empty entries.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={handleApplyAllDuplicateConsolidations}
                        disabled={isApplying}
                        className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold rounded-lg shadow-sm flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        <Zap className="w-3.5 h-3.5" />
                        Approve All Consolidations
                      </button>
                      <button
                        onClick={() => {
                          onClose();
                          onLaunchNameConsolidation(duplicateKeys);
                        }}
                        className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
                      >
                        <Bot className="w-3.5 h-3.5 text-violet-500" />
                        Ask Deduper Agent
                      </button>
                    </div>
                  </div>
                )}

                {/* 3. Missing Reference Ranges & Categories Card */}
                {report.missingRangesCount > 0 && (
                  <div className="p-4 rounded-xl border border-blue-200 dark:border-blue-900/50 bg-blue-50/40 dark:bg-blue-950/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-slate-800 dark:text-slate-100">3. Standard Medical Reference Ranges</span>
                        <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300 text-[10px] font-bold rounded-full">
                          {catalogMatchCount} Catalog Matches Found
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-300">
                        Enriches uncalibrated biomarkers with standard medical reference brackets and organ groupings.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {catalogMatchCount > 0 && (
                        <button
                          onClick={handleApplyCatalogRangeFixes}
                          disabled={isApplying}
                          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg shadow-sm flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                        >
                          <Zap className="w-3.5 h-3.5" />
                          Approve Standard Ranges ({catalogMatchCount})
                        </button>
                      )}
                      {onLaunchRangeCalibrator && (
                        <button
                          onClick={() => {
                            onClose();
                            onLaunchRangeCalibrator(missingRangeKeys);
                          }}
                          className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
                        >
                          <Bot className="w-3.5 h-3.5 text-blue-500" />
                          Calibrate with AI Agent
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* 4. Conflict Resolution Card */}
                {report.conflictsCount > 0 && (
                  <div className="p-4 rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50/40 dark:bg-rose-950/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-slate-800 dark:text-slate-100">4. Unit & Bracket Synchronization</span>
                        <span className="px-2 py-0.5 bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 text-[10px] font-bold rounded-full">
                          {report.conflictsCount} Discrepancies
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-300">
                        Synchronizes declared unit and reference brackets (e.g. Hematocrit % vs L/L, Hemoglobin g/dL vs g/L).
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={handleApplyAllConflictFixes}
                        disabled={isApplying}
                        className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-lg shadow-sm flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        <Zap className="w-3.5 h-3.5" />
                        Approve Conflict Resolutions
                      </button>
                      <button
                        onClick={() => {
                          onClose();
                          onLaunchUnitStandardization(conflictKeys);
                        }}
                        className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
                      >
                        <Bot className="w-3.5 h-3.5 text-rose-500" />
                        Ask Unit Agent
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: CORRUPTED UNITS */}
          {activeTab === 'corrupted_units' && (
            <div className="space-y-4 max-w-7xl mx-auto">
              <div className="flex items-center justify-between flex-wrap gap-3 pb-2 border-b border-slate-100 dark:border-slate-800">
                {/* FILTER PILLS */}
                <FilterPills<'all' | 'auto_proposals' | 'agent_review'>
                  language={profile?.language}
                  items={[
                    {
                      id: 'all',
                      label: interpolate(t(profile?.language, 'auditFilterAll'), { n: corruptedUnitItems.length }),
                      activeColorClass: 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 shadow-xs',
                    },
                    {
                      id: 'auto_proposals',
                      label: interpolate(t(profile?.language, 'auditFilterAuto'), { n: targetAutoUnitItems.length }),
                      icon: <Zap className="w-3.5 h-3.5" />,
                      activeColorClass: 'bg-amber-600 text-white shadow-xs',
                    },
                    {
                      id: 'agent_review',
                      label: interpolate(t(profile?.language, 'auditFilterAgentReview'), { n: targetAgentUnitItems.length }),
                      icon: <Bot className="w-3.5 h-3.5" />,
                      activeColorClass: 'bg-indigo-600 text-white shadow-xs',
                    },
                  ]}
                  activeId={unitFilter}
                  onChange={setUnitFilter}
                />

                {/* HEADER ACTIONS */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleSelectAllFixes(filteredCorruptedUnitItems)}
                    className="text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:underline px-2.5 py-1 font-semibold cursor-pointer"
                  >
                    Toggle All
                  </button>
                </div>
              </div>

              {filteredCorruptedUnitItems.length === 0 ? (
                <div className="p-8 text-center bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 text-slate-400 text-xs">
                  ✨ No unit issues found in this filter view.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {filteredCorruptedUnitItems.map(item => {
                    const proposal = item.corruptedUnitProposal;
                    const hasAutoProposal = !!proposal?.proposedUnit;
                    const isSelected = !!selectedFixKeys[item.key];

                    return (
                      <div
                        key={item.key}
                        className={`p-3.5 rounded-xl border transition-all flex items-start gap-3 ${
                          item.key === initialFocusKey ? 'ring-2 ring-amber-500 shadow-md' : ''
                        } ${
                          isSelected
                            ? 'bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/60'
                            : hasAutoProposal
                            ? 'bg-white dark:bg-slate-800/40 border-amber-100 dark:border-amber-950/40'
                            : 'bg-white dark:bg-slate-800/40 border-slate-200 dark:border-slate-800'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleFix(item.key)}
                          className="mt-1 rounded text-amber-600 focus:ring-amber-500 cursor-pointer"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1">
                              <span className="font-bold text-xs text-slate-800 dark:text-slate-100">{item.name}</span>
                              <span className="text-[10px] font-mono px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded">
                                {item.key}
                              </span>
                              <span className="text-[11px] text-rose-600 dark:text-rose-400 line-through font-mono">
                                current: "{item.currentUnit || 'blank'}"
                              </span>
                              <ArrowRight className="w-3 h-3 text-slate-400" />
                              {proposal?.proposedUnit ? (
                                <span className="text-[11px] font-bold font-mono px-2 py-0.5 bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 rounded">
                                  {proposal.proposedUnit}
                                </span>
                              ) : (
                                <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-semibold px-2 py-0.5 bg-indigo-50 dark:bg-indigo-950/60 rounded border border-indigo-200/50 dark:border-indigo-800/50">
                                  Needs AI Agent review
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={() => {
                                  onClose();
                                  onLaunchUnitStandardization([item.key]);
                                }}
                                className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[11px] font-bold flex items-center gap-1 transition-colors cursor-pointer shadow-2xs"
                                title="Launch AI Agent to review and fix this biomarker"
                              >
                                <Bot className="w-3 h-3" />
                                <span>Fix with Agent</span>
                              </button>
                              {renderDeleteButton(item.key, item.name)}
                            </div>
                          </div>

                          {/* Unified Rich Diagnostic Box (matching BiomarkerDictionaryModal layout style) */}
                          {proposal?.preciseCause && (
                            <div className="text-xs text-rose-800 dark:text-rose-200 font-medium leading-relaxed bg-rose-50/80 dark:bg-rose-950/40 p-2.5 rounded-lg border border-rose-200/80 dark:border-rose-900/50 mt-2">
                              {proposal.preciseCause}
                            </div>
                          )}
                          {!proposal?.preciseCause && proposal?.reason && (
                            <div className="text-xs text-rose-800 dark:text-rose-200 font-medium leading-relaxed bg-rose-50/80 dark:bg-rose-950/40 p-2.5 rounded-lg border border-rose-200/80 dark:border-rose-900/50 mt-2">
                              {proposal.reason}
                            </div>
                          )}
                          {proposal?.suggestedFix && (
                            <div className="text-[11px] text-amber-900/90 dark:text-amber-200/90 font-normal mt-1.5">
                              <span className="font-bold text-amber-950 dark:text-amber-100">Action:</span> {proposal.suggestedFix}
                            </div>
                          )}
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {proposal?.badgeLabel && (
                              <span className="px-1.5 py-0.5 text-[10px] bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-300 rounded font-bold">
                                {proposal.badgeLabel}
                              </span>
                            )}
                            {proposal?.proposedUnit ? (
                              <span className="px-1.5 py-0.5 text-[10px] bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300 rounded font-bold">
                                Auto-Proposal Available
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 text-[10px] bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-300 rounded font-bold">
                                Needs AI Review
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: DUPLICATES & ALIAS GROUPS */}
          {activeTab === 'duplicates' && (
            <div className="space-y-4 max-w-7xl mx-auto">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                    Duplicates & Alias Clusters ({report.duplicateGroups.length} Groups)
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Master biomarker displayed once. Candidate aliases and empty records can be consolidated automatically or via the agent.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleApplyAllDuplicateConsolidations}
                    disabled={isApplying || report.duplicateGroups.length === 0}
                    className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-xs font-bold flex items-center gap-1 shadow-sm transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    Approve All Consolidations
                  </button>
                  <button
                    onClick={() => {
                      onClose();
                      onLaunchNameConsolidation(duplicateKeys);
                    }}
                    className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <Bot className="w-3.5 h-3.5 text-violet-500" />
                    Ask Name Deduper Agent
                  </button>
                </div>
              </div>

              {report.duplicateGroups.length === 0 ? (
                <div className="p-8 text-center bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 text-slate-400 text-xs">
                  ✨ Zero duplicate clusters detected! All biomarkers are unique.
                </div>
              ) : (
                <div className="space-y-3.5">
                  {report.duplicateGroups.map((group, idx) => {
                    const masterDef = profile?.customBiomarkers?.[group.suggestedMasterKey] || {};
                    const candidateAliases = group.candidateAliases;

                    return (
                      <div key={idx} className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800/40 space-y-3 shadow-xs">
                        
                        {/* MASTER BIOMARKER DISPLAYED STRICTLY ONCE */}
                        <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 text-[10px] font-bold rounded-md flex items-center gap-1">
                              <CheckCircle className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                              Primary Master
                            </span>
                            <span className="font-bold text-xs text-slate-900 dark:text-slate-100">
                              {group.suggestedMasterName}
                            </span>
                            <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                              ({group.suggestedMasterKey})
                            </span>
                            {masterDef.unit && (
                              <span className="text-[10px] font-mono text-slate-600 dark:text-slate-300">
                                • Unit: <strong>{masterDef.unit}</strong>
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleApplySingleDuplicateConsolidation(group)}
                              disabled={isApplying}
                              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-xs font-bold flex items-center gap-1 shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                            >
                              <Check className="w-3 h-3" />
                              Approve Consolidation
                            </button>
                            <button
                              onClick={() => {
                                onClose();
                                onLaunchNameConsolidation(group.memberKeys);
                              }}
                              className="px-2.5 py-1 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 text-slate-700 dark:text-slate-200 rounded-md text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                            >
                              <Bot className="w-3 h-3 text-violet-500" />
                              Ask Deduper Agent
                            </button>
                            {renderDeleteButton(group.suggestedMasterKey, group.suggestedMasterName)}
                          </div>
                        </div>

                        {/* LIST OF CANDIDATE ALIASES TO MERGE */}
                        <div className="space-y-1.5">
                          <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                            <GitMerge className="w-3.5 h-3.5 text-violet-500" />
                            <span>Aliases & Duplicates to merge into master ({candidateAliases.length}):</span>
                          </div>
                          
                          <div className="flex flex-wrap gap-2">
                            {candidateAliases.map(k => {
                              const aliasDef = profile?.customBiomarkers?.[k] || {};
                              const isEmpty = group.emptyAliasKeys.includes(k);

                              return (
                                <div
                                  key={k}
                                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 flex items-center gap-2 text-xs"
                                >
                                  <span className="font-semibold text-slate-700 dark:text-slate-200">
                                    {aliasDef.name || k}
                                  </span>
                                  <span className="font-mono text-[10px] text-slate-400">
                                    ({k})
                                  </span>
                                  {isEmpty ? (
                                    <span className="px-1.5 py-0.5 bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 text-[9px] font-bold rounded">
                                      0 lab logs (Empty)
                                    </span>
                                  ) : (
                                    <span className="px-1.5 py-0.5 bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300 text-[9px] font-bold rounded">
                                      Has lab records
                                    </span>
                                  )}
                                  {renderDeleteButton(k, aliasDef.name || k)}
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        <p className="text-[10px] text-slate-400 dark:text-slate-500">
                          {group.reason} • Will combine all lab records and register synonyms under "{group.suggestedMasterKey}".
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: MISSING METADATA / RANGES */}
          {activeTab === 'missing_metadata' && (
            <div className="space-y-4 max-w-7xl mx-auto">
              <div className="flex items-center justify-between flex-wrap gap-3 pb-2 border-b border-slate-100 dark:border-slate-800">
                {/* FILTER PILLS */}
                <FilterPills<'all' | 'catalog' | 'custom_calibrate' | 'categorise'>
                  language={profile?.language}
                  items={[
                    {
                      id: 'all',
                      label: interpolate(t(profile?.language, 'auditFilterAll'), { n: missingMetadataItems.length }),
                      activeColorClass: 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 shadow-xs',
                    },
                    {
                      id: 'catalog',
                      label: interpolate(t(profile?.language, 'auditFilterCatalog'), { n: targetCatalogItems.length }),
                      icon: <Zap className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400" />,
                      activeColorClass: 'bg-blue-600 text-white shadow-xs',
                    },
                    {
                      id: 'custom_calibrate',
                      label: interpolate(t(profile?.language, 'auditFilterCalibrate'), { n: targetCustomCalibrateItems.length }),
                      icon: <Bot className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" />,
                      activeColorClass: 'bg-emerald-600 text-white shadow-xs',
                    },
                    ...(targetCategoriseKeys.length > 0
                      ? [
                          {
                            id: 'categorise' as const,
                            label: interpolate(t(profile?.language, 'auditFilterCategory'), { n: targetCategoriseKeys.length }),
                            icon: <Bot className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400" />,
                            activeColorClass: 'bg-indigo-600 text-white shadow-xs',
                          },
                        ]
                      : []),
                  ]}
                  activeId={metadataFilter as any}
                  onChange={(val) => setMetadataFilter(val as any)}
                />
              </div>

              {filteredMissingMetadataItems.length === 0 ? (
                <div className="text-center py-12 text-slate-400 text-xs bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-dashed border-slate-200 dark:border-slate-800">
                  No biomarkers found in this filter view.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {filteredMissingMetadataItems.map(item => {
                    const match = item.missingMetadata?.catalogMatch;

                  return (
                    <div key={item.key} className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800/40 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="font-bold text-xs text-slate-800 dark:text-slate-100 truncate">{item.name}</div>
                          <div className="text-[10px] text-slate-400 font-mono truncate">
                            {item.key} • Unit: {item.currentUnit || 'None'}
                            {item.missingMetadata?.currentRange && (
                              <span className="ml-1.5 text-slate-500 font-sans">• Current Range: <strong className="text-slate-700 dark:text-slate-300">{item.missingMetadata.currentRange}</strong></span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {match && (
                            <span className="text-[10px] font-bold px-2 py-0.5 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 rounded border border-emerald-200 dark:border-emerald-800">
                              Catalog Match Found
                            </span>
                          )}
                          {!match && item.missingMetadata?.missingRange && (
                            <span className="text-[10px] font-bold px-2 py-0.5 bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 rounded">
                              Range: Unknown
                            </span>
                          )}
                          {!match && item.missingMetadata?.missingCategory && (
                            <span className="text-[10px] font-bold px-2 py-0.5 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 rounded">
                              Category Needed
                            </span>
                          )}
                          {!match && !item.missingMetadata?.missingRange && !item.missingMetadata?.missingCategory && (
                            <span className="text-[10px] font-bold px-2 py-0.5 bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 rounded">
                              Brackets Needed
                            </span>
                          )}
                          {renderDeleteButton(item.key, item.name)}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {item.missingMetadata?.missingRange && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200 rounded shrink-0">Missing Range</span>
                        )}
                        {item.missingMetadata?.missingCategory && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-200 rounded shrink-0">Missing Category</span>
                        )}
                        {item.missingMetadata?.missingBrackets && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200 rounded shrink-0">Missing detailed brackets</span>
                        )}
                        {item.missingMetadata?.missingRiskCategory && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-200 rounded shrink-0">Missing Risk Category</span>
                        )}
                        {item.missingMetadata?.missingConditions && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200 rounded shrink-0">Missing Potential Conditions</span>
                        )}
                        {item.missingMetadata?.missingDescription && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200 rounded shrink-0">Missing Description</span>
                        )}
                      </div>

                      {match && (
                        <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800 text-[11px] space-y-2">
                          <div className="space-y-1">
                            <div className="flex justify-between">
                              <span className="text-slate-500">Proposed Standard Range:</span>
                              <span className="font-bold text-emerald-700 dark:text-emerald-300 font-mono">{match.normalRange} {match.unit || ''}</span>
                            </div>
                            {match.category && (
                              <div className="flex justify-between">
                                <span className="text-slate-500">Organ Category:</span>
                          <span className="font-semibold text-indigo-600 dark:text-indigo-400 capitalize">{displayCategoryLabel(profile?.language, match.category)}</span>
                              </div>
                            )}
                          </div>

                          <div className="pt-1.5 border-t border-slate-200/60 dark:border-slate-800 flex justify-end">
                            <button
                              type="button"
                              onClick={() => handleApplySingleCatalogRangeFix(item)}
                              disabled={isApplying}
                              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-xs font-bold flex items-center gap-1 shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                            >
                              <Check className="w-3 h-3" />
                              Approve Standard Range
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

          {/* TAB 5: CONFLICTS */}
          {activeTab === 'conflicts' && (
            <div className="space-y-4 max-w-7xl mx-auto">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                    Internal Scale & Unit Conflicts ({conflictItems.length})
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Automated clinical math resolutions are ready to synchronize declared units with reference brackets.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleApplyAllConflictFixes}
                    disabled={isApplying || conflictItems.length === 0}
                    className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold flex items-center gap-1 shadow-sm transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    Approve All Resolutions
                  </button>
                  <button
                    onClick={() => {
                      onClose();
                      onLaunchUnitStandardization(conflictKeys);
                    }}
                    className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <Bot className="w-3.5 h-3.5 text-rose-500" />
                    Ask Unit Standardization Agent
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                {conflictItems.map(item => {
                  const resolution = item.conflictInfo?.suggestedResolution;

                  return (
                    <div key={item.key} className="p-4 rounded-xl border border-rose-200 dark:border-rose-900/50 bg-white dark:bg-slate-800/40 space-y-3 shadow-xs">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-xs text-slate-800 dark:text-slate-100">{item.name}</span>
                          <span className="font-mono text-[10px] text-slate-500 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                            ({item.key})
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          {resolution && (
                            <button
                              onClick={() => handleApplyConflictFix(item)}
                              disabled={isApplying}
                              className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-md text-xs font-bold flex items-center gap-1 shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                            >
                              <Check className="w-3 h-3" />
                              Approve Fix
                            </button>
                          )}
                          <button
                            onClick={() => {
                              onClose();
                              onLaunchUnitStandardization([item.key]);
                            }}
                            className="px-2.5 py-1 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 text-slate-700 dark:text-slate-200 rounded-md text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                          >
                            <Bot className="w-3 h-3 text-rose-500" />
                            Ask Agent
                          </button>
                          {renderDeleteButton(item.key, item.name)}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="p-2.5 rounded-lg bg-rose-50/50 dark:bg-rose-950/30 border border-rose-200/60 dark:border-rose-900/40">
                          <div className="text-[10px] text-rose-600 dark:text-rose-400 font-semibold">Declared Unit</div>
                          <div className="font-bold text-rose-700 dark:text-rose-300 font-mono text-sm">{item.conflictInfo?.declaredUnit}</div>
                        </div>
                        <div className="p-2.5 rounded-lg bg-emerald-50/50 dark:bg-emerald-950/30 border border-emerald-200/60 dark:border-emerald-900/40">
                          <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">Reference Bracket Unit</div>
                          <div className="font-bold text-emerald-700 dark:text-emerald-300 font-mono text-sm">{item.conflictInfo?.bracketUnit}</div>
                        </div>
                      </div>

                      {resolution && (
                        <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700 text-xs space-y-1">
                          <div className="font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1">
                            <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                            <span>Automated Resolution Proposal:</span>
                          </div>
                          <p className="text-slate-600 dark:text-slate-300 text-[11px] leading-relaxed">
                            {resolution.description}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 6: FULLY CLEAN BIOMARKERS */}
          {activeTab === 'clean' && (
            <div className="space-y-4 max-w-7xl mx-auto">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    <span>Fully Clean & Validated Biomarkers ({cleanItems.length})</span>
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    These biomarkers have valid unit definitions, calibrated reference ranges/brackets, correct medical categorisation, and no unresolved duplicate aliases.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="px-3 py-1 bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 text-xs font-bold rounded-lg border border-emerald-200/80 dark:border-emerald-800/80">
                    {cleanItems.length} Passed Quality Gates
                  </span>
                </div>
              </div>

              {cleanItems.length === 0 ? (
                <div className="p-8 text-center bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 text-slate-400 text-xs">
                  No biomarkers currently marked as fully clean. Complete the triage steps to standardize your dictionary.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {cleanItems.map(item => {
                    const customDef = profile?.customBiomarkers?.[item.key] || {};
                    const normalRangeStr = customDef.normalRange || (customDef.rangeBrackets && customDef.rangeBrackets.find((b: any) => b.type === 'normal')?.range) || '';
                    const optimalRangeStr = customDef.optimalRange || (customDef.rangeBrackets && customDef.rangeBrackets.find((b: any) => b.type === 'optimal')?.range) || '';
                    const category = customDef.category || customDef.standardMedicalGrouping || '';

                    return (
                      <div
                        key={item.key}
                        className="p-3.5 rounded-xl border border-emerald-200/80 dark:border-emerald-900/40 bg-white dark:bg-slate-800/60 shadow-xs space-y-2 hover:border-emerald-400 dark:hover:border-emerald-700/80 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-bold text-xs text-slate-800 dark:text-slate-100 truncate">
                                {item.name || item.key}
                              </span>
                              <span className="px-1.5 py-0.5 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-mono text-[10px] font-bold rounded">
                                {item.currentUnit || 'unitless'}
                              </span>
                            </div>
                            <div className="font-mono text-[10px] text-slate-400 dark:text-slate-500 truncate mt-0.5">
                              {item.key}
                            </div>
                          </div>
                          <span className="px-2 py-0.5 bg-emerald-100/70 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300 text-[10px] font-semibold rounded-full shrink-0 flex items-center gap-1">
                            <Check className="w-2.5 h-2.5" /> Clean
                          </span>
                        </div>

                        {/* RANGES & METADATA DETAILS */}
                        <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 text-[11px] space-y-1">
                          {normalRangeStr && (
                            <div className="flex justify-between items-center text-slate-600 dark:text-slate-300">
                              <span className="text-[10px] text-slate-400">Normal Range:</span>
                              <span className="font-mono font-medium">{normalRangeStr} {item.currentUnit}</span>
                            </div>
                          )}
                          {optimalRangeStr && (
                            <div className="flex justify-between items-center text-emerald-700 dark:text-emerald-400">
                              <span className="text-[10px] text-slate-400">Optimal:</span>
                              <span className="font-mono font-medium">{optimalRangeStr} {item.currentUnit}</span>
                            </div>
                          )}
                          {category && (
                            <div className="flex justify-between items-center text-slate-500 dark:text-slate-400">
                              <span className="text-[10px]">Category:</span>
                              <span className="capitalize font-medium text-indigo-600 dark:text-indigo-400">{category}</span>
                            </div>
                          )}
                          <div className="flex justify-between items-center text-slate-400 text-[10px] pt-0.5">
                            <span>Historical Logs:</span>
                            <span className="font-mono">{item.logCount} {item.logCount === 1 ? 'log' : 'logs'}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* MODAL FOOTER */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 flex items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-slate-500 dark:text-slate-400 font-medium">
            {activeTab === 'missing_metadata' && (
              <span>
                Showing {filteredMissingMetadataItems.length} of {missingMetadataItems.length} items
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
            >
              Close
            </button>

            {/* TAB 4 ACTIONS NEXT TO CLOSE */}
            {activeTab === 'missing_metadata' && (
              <>
                {(metadataFilter === 'all' || metadataFilter === 'catalog') && targetCatalogItems.length > 0 && (
                  <button
                    onClick={() => setShowCatalogApproveConfirm(true)}
                    disabled={isApplying}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm transition-all cursor-pointer disabled:opacity-50"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    <span>Apply catalog ranges ({targetCatalogItems.length})</span>
                  </button>
                )}
                {(metadataFilter === 'all' || metadataFilter === 'categorise') && onLaunchMedicalCategorisation && targetCategoriseKeys.length > 0 && (
                  <button
                    onClick={() => {
                      onClose();
                      onLaunchMedicalCategorisation(targetCategoriseKeys);
                    }}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
                  >
                    <Bot className="w-3.5 h-3.5" />
                    <span>Categorise ({targetCategoriseKeys.length}) with Agent</span>
                  </button>
                )}
                {(metadataFilter === 'all' || metadataFilter === 'custom_calibrate' || metadataFilter === 'calibrate') && onLaunchRangeCalibrator && (metadataFilter === 'custom_calibrate' ? targetCustomCalibrateItems.length > 0 : targetCalibrateItems.length > 0) && (
                  <button
                    onClick={() => {
                      onClose();
                      onLaunchRangeCalibrator((metadataFilter === 'custom_calibrate' ? targetCustomCalibrateItems : targetCalibrateItems).map(i => i.key));
                    }}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
                  >
                    <Bot className="w-3.5 h-3.5" />
                    <span>Calibrate ({metadataFilter === 'custom_calibrate' ? targetCustomCalibrateItems.length : targetCalibrateItems.length}) with AI Agent</span>
                  </button>
                )}
              </>
            )}

            {/* TAB 2 ACTIONS */}
            {activeTab === 'corrupted_units' && (
              <>
                {(unitFilter === 'all' || unitFilter === 'auto_proposals') && targetAutoUnitItems.length > 0 && (
                  <button
                    onClick={() => setShowApplyConfirm(true)}
                    disabled={isApplying || selectedAutoUnitKeys.length === 0}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-xl shadow-md transition-all disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Apply ({selectedAutoUnitKeys.length}) Selected Unit Repairs</span>
                  </button>
                )}
                {(unitFilter === 'all' || unitFilter === 'agent_review') && targetAgentUnitItems.length > 0 && onLaunchUnitStandardization && (
                  <button
                    onClick={() => {
                      onClose();
                      onLaunchUnitStandardization(selectedAgentUnitKeys);
                    }}
                    disabled={selectedAgentUnitKeys.length === 0}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-md transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <Bot className="w-3.5 h-3.5" />
                    <span>Ask Unit Relabel Agent ({selectedAgentUnitKeys.length})</span>
                  </button>
                )}
              </>
            )}

            {/* TAB 3 ACTIONS */}
            {activeTab === 'duplicates' && report.duplicateGroups.length > 0 && (
              <button
                onClick={handleApplyAllDuplicateConsolidations}
                disabled={isApplying}
                className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold rounded-xl shadow-md transition-all disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
              >
                <Zap className="w-3.5 h-3.5" />
                <span>Approve All Duplicate Consolidations</span>
              </button>
            )}

            {/* TAB 5 ACTIONS */}
            {activeTab === 'conflicts' && report.conflictsCount > 0 && (
              <button
                onClick={handleApplyAllConflictFixes}
                disabled={isApplying}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl shadow-md transition-all disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
              >
                <Zap className="w-3.5 h-3.5" />
                <span>Approve All Conflict Resolutions</span>
              </button>
            )}
          </div>
        </div>

        {/* EXPLICIT CONFIRMATION MODAL BEFORE MODIFYING VALUES */}
        {showApplyConfirm && (
          <div className="absolute inset-0 z-50 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 max-w-md w-full shadow-2xl space-y-4">
              <div className="flex items-center gap-3 text-amber-600 dark:text-amber-400">
                <AlertTriangle className="w-6 h-6 shrink-0" />
                <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">
                  Confirm Biomarker Unit Changes
                </h3>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                You are about to update the unit field for <strong>{Object.values(selectedFixKeys).filter(Boolean).length}</strong> biomarker dictionary entries in your profile. 
                Existing numerical history logs will be preserved.
              </p>
              <div className="max-h-36 overflow-y-auto p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 space-y-1 text-xs font-mono">
                {report.items.filter(i => selectedFixKeys[i.key] && i.corruptedUnitProposal?.proposedUnit).map(i => (
                  <div key={i.key} className="flex justify-between text-[11px]">
                    <span className="text-slate-700 dark:text-slate-300 font-bold">{i.name}:</span>
                    <span className="text-emerald-600 dark:text-emerald-400">➔ {i.corruptedUnitProposal?.proposedUnit}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  onClick={() => setShowApplyConfirm(false)}
                  className="px-3.5 py-1.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-semibold rounded-lg hover:bg-slate-100 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleApplySelectedUnitFixes}
                  disabled={isApplying}
                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg shadow flex items-center gap-1.5 cursor-pointer"
                >
                  {isApplying ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  Confirm & Apply Updates
                </button>
              </div>
            </div>
          </div>
        )}

        {/* EXPLICIT PREVIEW & CONFIRMATION MODAL FOR CATALOG RANGE APPROVAL */}
        {showCatalogApproveConfirm && (
          <div className="absolute inset-0 z-50 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 max-w-lg w-full shadow-2xl space-y-4">
              <div className="flex items-center gap-3 text-blue-600 dark:text-blue-400">
                <Zap className="w-6 h-6 shrink-0" />
                <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">
                  Approve Standard Catalog Ranges ({catalogMatchCount})
                </h3>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                The following <strong>{catalogMatchCount}</strong> biomarkers match standard medical catalog definitions. Review the exact reference ranges and organ categories that will be enriched:
              </p>
              <div className="max-h-64 overflow-y-auto p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 space-y-2 text-xs">
                {report.items.filter(i => i.missingMetadata?.catalogMatch).map(i => {
                  const match = i.missingMetadata?.catalogMatch;
                  return (
                    <div key={i.key} className="p-2 bg-white dark:bg-slate-900/80 rounded-lg border border-slate-100 dark:border-slate-800 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-800 dark:text-slate-100 text-xs">{displayBiomarkerName(profile?.language, i.key, i.name)}</span>
                        <span className="font-mono text-[10px] text-slate-400">({i.key})</span>
                      </div>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-500">Standard Range:</span>
                        <span className="font-bold font-mono text-emerald-600 dark:text-emerald-400">{match?.normalRange} {match?.unit || ''}</span>
                      </div>
                      {match?.category && (
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-slate-500">Organ Category:</span>
                          <span className="font-semibold text-indigo-600 dark:text-indigo-400 capitalize">{match.category}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  onClick={() => setShowCatalogApproveConfirm(false)}
                  className="px-3.5 py-1.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-semibold rounded-lg hover:bg-slate-100 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleApplyCatalogRangeFixes}
                  disabled={isApplying}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg shadow flex items-center gap-1.5 cursor-pointer"
                >
                  {isApplying ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  Confirm & Apply All ({catalogMatchCount}) Ranges
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
