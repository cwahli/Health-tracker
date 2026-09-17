import { toYYYYMMDD, formatToDDMMYYYY } from "../utils/dateUtils";
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { UserProfile, BiomarkerLog, ChatMessage, FoodLog } from '../types';
import { translations } from '../utils/translations';
import { displayStatusLabel, displayCategoryLabel, displayBiomarkerName, displayConditionName } from '../utils/i18n';
import { ShieldAlert, ClipboardList, Trash2, ChevronDown, ChevronUp, LineChart as LineChartIcon, BrainCircuit, AlertCircle, Clock, CheckCircle2, EyeOff } from 'lucide-react';
import { standardizeUnit, reverseStandardizeUnit, formatNormalRange } from '../utils/unitConversion';
import { getBiomarkerRangeSourceInfo } from '../utils/biomarkerLifecycle';
import { generateDynamicInsight } from '../utils/biomarkerInsights';
import { biomarkerDefinitions, getBiomarkerStatus, getBiomarkerColor, getBiomarkerStatusLabel, getBiomarkerRiskTag, BiomarkerDefinition, isAsianEthnicity, getPhysiologicalBucket, getBiomarkerMetadata, BIOMARKER_GROUPING_OPTIONS, getCustomBiomarkerDef, getMergedBiomarkerDef, isBiomarkerApproved, isBiomarkerMissingCategory, isValEmpty, isBiomarkerMissingRange, isBiomarkerNeedingReview, detectFlaggedTelemetryErrors, buildBiomarkerReviewPrefill, canonicalizeRiskCategory, getActiveStructuredRangeRule, formatCustomRangesSummary, getMappedBiomarkerKey, getIdealBmiTarget, getBiomarkerEffectiveRisk, BiomarkerEffectiveRisk, NO_DATA_RISK_SCORE } from '../utils/biomarkers';
import { getAgentCalibration, getAllAgentCalibrationRecords, formatOptimalTargetValue } from '../utils/agentCalibration';
import { getDuplicateAliasGroups } from '../utils/biomarkerAuditEngine';
import { handleUnitChange } from '../utils/biomarkerLifecycle';

const getBiomarkerDef = (key: string) => biomarkerDefinitions.find(d => d.key === key);

import { BiomarkerExpandedSection } from './BiomarkerExpandedSection';
import CombineBiomarkersModal from './CombineBiomarkersModal';
import { lazyWithRetry } from '../utils/lazyWithRetry';
const BiomarkerDictionaryModal = lazyWithRetry(() => import('./BiomarkerDictionaryModal'));
import NotUsedBiomarkersModal from './NotUsedBiomarkersModal';
import TaskPlaceholderCard from './TaskPlaceholderCard';
import { JobStore, isJobBlank } from '../jobs/JobStore';

interface MedicalHistoryTabProps {
  profile: UserProfile;
  biomarkers: { [key: string]: number | string };
  biomarkerHistory: BiomarkerLog[];
  foodLogs?: FoodLog[];
  onApplyDataSanitize?: (selected: any[]) => Promise<void>;
  [key: string]: any;
  hideSensitive: boolean;
  onDeleteBiomarkerLog: (id: string) => void;
  onBatchCombineBiomarkers?: (combinations: {targetKey: string, targetDef: any, mergedLogs: any[], sourceKeysToDelete: string[]}[]) => Promise<void>;
  onDeleteBiomarkerFromLog?: (id: string, key: string) => void;
  onDeleteBiomarker?: (key: string) => void;
  onFlagNotUsed?: (key: string) => void;
  onFlagNotUsedLocal?: (key: string) => void;
  onRestoreNotUsedLocal?: (key: string) => void;
  onRestoreNotUsedGlobal?: (key: string) => void;
  onDeleteMultipleBiomarkers?: (keys: string[]) => void;
  onDeleteEmptyBiomarkers?: () => void;
  onStandardizeUnits?: (updates: { [key: string]: { unit: string; normalRange: string; name: string } }) => Promise<void>;
  onUpdateProfile?: (updates: Partial<UserProfile>) => void;
  onEditBiomarkerLog: (id: string, key: string, value: string | number, newDate?: string) => void;
  onLogMedical?: (biomarkers: { [key: string]: number | string }, profileUpdates?: Partial<UserProfile>, date?: string, entries?: any, modificationCommand?: any, skipClose?: boolean) => void;
  onCombineBiomarkers?: (
    targetKey: string,
    targetDef: { name: string; unit: string; normalRange: string; description: string },
    mergedLogs: { date: string; value: number | string }[],
    sourceKeysToDelete: string[]
  ) => void;
  onBatchConsolidate?: (mapping: { [key: string]: string }) => void;
  onReviewWithAgent?: (keys: string[]) => void;
  onOpenAgentChat?: (agentType: 'agent1' | 'agent2' | 'agent3' | 'agent4' | 'agent5' | 'health_baseline' | 'agent7' | 'data_review' | 'biomarker_review', options?: { prefillMessage?: string; dataReviewBatchKeys?: string[]; dataReviewBatchIdx?: number | string; biomarkerKey?: string }) => void;
  onApplyCalculation?: (updates: {
    targetCalories?: number;
    targetWeight?: number;
    addedBenefit?: string;
    descriptionExplain?: string;
  }) => void;
  selectedModelId: string;
  onChangeModelId: (id: string) => void;
  hasBmiAlert?: boolean;
  onDismissBmiAlert?: () => void;
  onAgentAnalysisSaved?: (agentType: string, agentResult: any, existingId?: string) => Promise<string | void>;
  onDeleteAnalysis?: (id: string) => Promise<void>;
  onViewJob?: (jobId: string) => void;
}

export default function MedicalHistoryTab({
  profile,
  biomarkers,
  biomarkerHistory,
  hideSensitive,
  onDeleteBiomarkerLog,
  onDeleteBiomarkerFromLog,
  onDeleteBiomarker,
  onFlagNotUsed,
  onFlagNotUsedLocal,
  onRestoreNotUsedLocal,
  onRestoreNotUsedGlobal,
  onDeleteMultipleBiomarkers,
  onDeleteEmptyBiomarkers,
  onEditBiomarkerLog,
  onLogMedical,
  onCombineBiomarkers,
  onBatchCombineBiomarkers,
  onBatchConsolidate,
  onReviewWithAgent,
  onOpenAgentChat,
  onApplyCalculation,
  selectedModelId,
  onChangeModelId,
  hasBmiAlert,
  onDismissBmiAlert,
  onUpdateProfile,
  onStandardizeUnits,
  onAgentAnalysisSaved,
  onDeleteAnalysis,
  onViewJob,
}: MedicalHistoryTabProps) {
  const t = translations[profile.language] || translations.en;
  
  const [jobs, setJobs] = useState(() => JobStore.getAllJobs().filter(j => (j.kind === 'medical' || j.kind === 'front_desk') && !isJobBlank(j)));
  useEffect(() => {
    let mounted = true;
    const unsubscribe = JobStore.subscribe(() => {
      queueMicrotask(() => {
        if (mounted) {
          setJobs(JobStore.getAllJobs().filter(j => (j.kind === 'medical' || j.kind === 'front_desk') && !isJobBlank(j)));
        }
      });
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const activeMedicalJobs = useMemo(() => {
    return jobs.filter(job => {
      if (job.status === 'draft' || isJobBlank(job)) return false;
      const hasText = !!job.inputSnapshot?.text?.trim();
      const hasPayload = hasText || !!(job.inputSnapshot as any)?.extractedData || !!(job.inputSnapshot as any)?.hasImage || !!(job.result?.biomarkers && Object.keys(job.result.biomarkers).length > 0);
      if (!hasPayload && (job.status === 'queued' || job.status === 'succeeded')) return false;
      return true;
    });
  }, [jobs]);

  const activeHistory = useMemo(() => (biomarkerHistory || []).filter(h => h.sync_state !== 'delete'), [biomarkerHistory]);

  const duplicateGroups = useMemo(() => {
    return getDuplicateAliasGroups(
      profile?.customBiomarkers || {},
      activeHistory || [],
      biomarkers || {},
      profile?.deletedCustomBiomarkerKeys || {}
    );
  }, [profile?.customBiomarkers, profile?.deletedCustomBiomarkerKeys, activeHistory, biomarkers]);

  const aliasKeysToHide = useMemo(() => {
    const keys = new Set<string>();
    duplicateGroups.forEach(g => {
      g.candidateAliases.forEach(a => keys.add(a));
    });
    return keys;
  }, [duplicateGroups]);
  
  // Pre-indexed latest value map by key for instant O(1) lookups
  const latestValueMap = useMemo(() => {
    const map = new Map<string, any>();
    const sorted = [...activeHistory].sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));
    
    // Fill from history logs from oldest to newest so newest overwrites
    for (let i = sorted.length - 1; i >= 0; i--) {
      const log = sorted[i];
      if (log.biomarkers) {
        Object.entries(log.biomarkers).forEach(([k, v]) => {
          if (v !== undefined) {
            map.set(k, v);
            map.set(k.toLowerCase(), v);
          }
        });
      }
    }

    // Fill current biomarkers fallback
    if (biomarkers) {
      Object.entries(biomarkers).forEach(([k, v]) => {
        if (!map.has(k) && v !== undefined) {
          map.set(k, v);
          map.set(k.toLowerCase(), v);
        }
      });
    }

    return map;
  }, [activeHistory, biomarkers]);

  const aliasMap = useMemo(() => {
    const map = new Map<string, string[]>();
    duplicateGroups?.forEach((g: any) => {
      if (g.suggestedMasterKey && Array.isArray(g.candidateAliases)) {
        map.set(g.suggestedMasterKey.toLowerCase(), g.candidateAliases);
      }
    });
    return map;
  }, [duplicateGroups]);

  const getLatestValue = useCallback((key: string) => {
    const kLower = key.toLowerCase();
    const val = latestValueMap.get(key) ?? latestValueMap.get(kLower);
    if (val !== undefined) return val;

    const aliases = aliasMap.get(kLower) || [];
    for (const alias of aliases) {
      const aliasVal = latestValueMap.get(alias) ?? latestValueMap.get(alias.toLowerCase());
      if (aliasVal !== undefined) return aliasVal;
    }
    return undefined;
  }, [latestValueMap, aliasMap]);
  const isKeyNotUsedGlobal = useCallback((k: string) => {
    if (!profile?.notUsedBiomarkers) return false;
    if (profile.notUsedBiomarkers[k]) return true;
    const kLower = k.toLowerCase();
    return Object.keys(profile.notUsedBiomarkers).some(nok => nok.toLowerCase() === kLower);
  }, [profile?.notUsedBiomarkers]);

  const isKeyNotUsedLocal = useCallback((k: string) => {
    if (!profile?.notUsedInMedicalHistory) return false;
    if (profile.notUsedInMedicalHistory[k]) return true;
    const kLower = k.toLowerCase();
    return Object.keys(profile.notUsedInMedicalHistory).some(nok => nok.toLowerCase() === kLower);
  }, [profile?.notUsedInMedicalHistory]);

  const isKeyNotUsedInMedicalHistory = useCallback((k: string) => {
    return isKeyNotUsedGlobal(k) || isKeyNotUsedLocal(k);
  }, [isKeyNotUsedGlobal, isKeyNotUsedLocal]);
  const [viewType, setViewType] = useState<'risk' | 'condition' | 'practice'>('risk');
  const [selectedSubCategory, setSelectedSubCategory] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'risk' | 'name'>('risk');
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [editDate, setEditDate] = useState<string>('');
  
  const [combineBiomarkerKey, setCombineBiomarkerKey] = useState<string | null>(null);
  const [flashingKey, setFlashingKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [reviewHistories, setReviewHistories] = useState<{[key: string]: ChatMessage[]}>({});
  const [openSubCategories, setOpenSubCategories] = useState<{ [category: string]: boolean }>({});
  const [showDictionaryModal, setShowDictionaryModal] = useState(false);
  const [showNotUsedLocalModal, setShowNotUsedLocalModal] = useState(false);

  useEffect(() => {
    const handleOpenConsolidation = () => {
      setShowDictionaryModal(true);
    };
    window.addEventListener('open-dictionary-consolidation', handleOpenConsolidation);
    return () => window.removeEventListener('open-dictionary-consolidation', handleOpenConsolidation);
  }, []);

  const toggleSubCategory = (cat: string) => {
    setOpenSubCategories(prev => ({
      ...prev,
      [cat]: !prev[cat]
    }));
  };

  const hasEmptyBiomarkers = useMemo(() => {
    return activeHistory.some(log => {
      return Object.values(log.biomarkers || {}).some(val => isValEmpty(val));
    });
  }, [activeHistory]);



  // Important/highlighted biomarkers for user cardiovascular/kidney health
  const highlightKeys = ['ldl', 'apob', 'hba1c', 'egfr', 'hscrp'];

  // Combine definitions with dynamic ones from `biomarkers` object and profile.customBiomarkers
  const allDefinitions = useMemo(() => {
    // ONLY show definitions in MedicalHistoryTab if they have recorded non-empty data!
    const hasData = (key: string) => {
      const v = biomarkers ? biomarkers[key] : undefined;
      if (v !== undefined && v !== null && !isValEmpty(v)) return true;
      return (activeHistory || []).some(h => {
        const val = h.biomarkers ? h.biomarkers[key] : undefined;
        return val !== undefined && val !== null && !isValEmpty(val);
      });
    };
    const combined = biomarkerDefinitions.filter(d => hasData(d.key)).map(d => {
      if (d.key === 'bmi') {
        const isAsian = isAsianEthnicity(profile.ethnicity);
        const gender = (profile.gender || 'male').toLowerCase();
        const isMale = gender.startsWith('m');
        const targetBmi = getIdealBmiTarget(profile);
        const targetWeight = Math.round(targetBmi * Math.pow((profile.height || 170) / 100, 2) * 10) / 10;
        return {
          ...d,
          normalRange: isAsian ? '18.5 - 22.9' : '18.5 - 24.9',
          descriptions: {
            ...d.descriptions,
            en: 'A measure of body fat based on height and weight.'
          }
        };
      }
      return {
        ...d,
        descriptions: { ...d.descriptions }
      };
    });
    
    // First, merge from profile.customBiomarkers
    if (profile.customBiomarkers) {
      Object.entries(profile.customBiomarkers).forEach(([key, def]) => {
        const existing = combined.find(d => d.key === key);
        if (existing) {
          if (key === 'bmi') {
            const isAsian = isAsianEthnicity(profile.ethnicity);
            const gender = (profile.gender || 'male').toLowerCase();
            const isMale = gender.startsWith('m');
            const targetBmi = getIdealBmiTarget(profile);
            const targetWeight = Math.round(targetBmi * Math.pow((profile.height || 170) / 100, 2) * 10) / 10;
            existing.normalRange = isAsian ? '18.5 - 22.9' : '18.5 - 24.9';
            existing.descriptions = {
              ...existing.descriptions,
              en: 'A measure of body fat based on height and weight.'
            };
            existing.structuredRanges = def.structuredRanges || existing.structuredRanges;
          } else {
            existing.name = def.name || existing.name;
            const validRange = def.normalRange && def.normalRange !== 'Unknown' && def.normalRange.trim() !== '' && def.normalRange !== 'n/a' && def.normalRange !== 'unset' && def.normalRange !== '-';
            existing.normalRange = validRange ? def.normalRange : existing.normalRange;
            existing.structuredRanges = def.structuredRanges || existing.structuredRanges;
            const validUnit = def.unit && def.unit !== 'Unknown' && def.unit.trim() !== '' && def.unit !== 'n/a' && def.unit !== 'unset' && def.unit !== '-';
            existing.unit = validUnit ? def.unit : existing.unit;
            existing.standardMedicalGrouping = def.standardMedicalGrouping || existing.standardMedicalGrouping; existing.potentialMedicalConditions = def.potentialMedicalConditions || existing.potentialMedicalConditions; existing.riskCategories = def.riskCategories || existing.riskCategories;
            if (def.description) {
              existing.descriptions = { ...existing.descriptions, en: def.description };
            }
          }
          if (def.benefitRisk) {
            (existing as any).benefitRisk = def.benefitRisk;
          }
        } else {
          combined.push({
            key,
            name: def.name || key,
            category: 'other',
            unit: def.unit || '',
            normalRange: def.normalRange || 'Unknown',
            descriptions: {
              en: def.description || ''
            },
            benefitRisk: def.benefitRisk,
            standardMedicalGrouping: def.standardMedicalGrouping,
            potentialMedicalConditions: def.potentialMedicalConditions,
            riskCategories: def.riskCategories,
            structuredRanges: def.structuredRanges
          } as any);
        }
      });
    }

    const allHistoryKeys = new Set<string>();
    (activeHistory || []).forEach(h => {
      if (h.biomarkers) {
        Object.keys(h.biomarkers).forEach(k => allHistoryKeys.add(k));
      }
    });
    if (biomarkers) {
      Object.keys(biomarkers).forEach(k => allHistoryKeys.add(k));
    }

    allHistoryKeys.forEach(key => {
      if (key === 'weight' || key === 'height' || key === 'age') return;
      if (!combined.find(d => d.key === key)) {
        const builtIn = biomarkerDefinitions.find((d: any) => d.key === key || (Array.isArray(d.aliases) && d.aliases.includes(key)));
        const custom = getCustomBiomarkerDef(profile, key);
        const itemLogs = activeHistory.map(h => ({
          date: h.date,
          value: h.biomarkers?.[key],
          unit: (h as any).units?.[key] || (h as any).unit,
          normalRange: (h as any).normalRanges?.[key] || (h as any).normalRange
        })).filter(l => l.value !== undefined || l.unit || l.normalRange);
        const merged = getMergedBiomarkerDef(key, builtIn, custom, itemLogs);
        combined.push({
          key,
          name: merged.name,
          category: 'other',
          unit: merged.unit,
          normalRange: merged.normalRange || 'Unknown',
          descriptions: {
            en: merged.description || ''
          }
        } as any);
      }
    });

    const withMetadata = combined.map(def => {
      const customDef = getCustomBiomarkerDef(profile, def.key);
      const meta = getBiomarkerMetadata(def.key, customDef);
      const isBuiltIn = biomarkerDefinitions.some(b => b.key === def.key || (Array.isArray(b.aliases) && b.aliases.includes(def.key)));
      const needsApproval = customDef?.needsApproval === true || (def as any).needsApproval === true || (!isBuiltIn && customDef?.needsApproval !== false && (customDef?.needsApproval === true || (def as any).needsApproval === true));
      return {
        ...def,
        needsApproval,
        riskCategories: meta.riskCategories,
        standardMedicalGrouping: meta.standardMedicalGrouping,
        potentialMedicalConditions: meta.potentialMedicalConditions
      };
    });
    return withMetadata.filter(d => hasData(d.key) && !isKeyNotUsedInMedicalHistory(d.key) && !aliasKeysToHide.has(d.key));
  }, [biomarkers, activeHistory, profile.customBiomarkers, profile.ethnicity, profile.gender, profile.height, isKeyNotUsedInMedicalHistory, aliasKeysToHide]);

  


  
  const exportBiomarkersToCSV = () => {
    const headers = [
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

    const exportList = allDefinitions;
    const rows = exportList.map(def => {
      const customDef = getCustomBiomarkerDef(profile, def.key);
      const name = def.name || customDef?.name || def.key;
      const key = def.key;
      const aliases = (def.aliases || customDef?.aliases || []).join('; ');
      const desc = def.descriptions?.en || (def as any).description || customDef?.descriptions?.en || (customDef as any)?.description || '';
      const unit = def.unit || customDef?.unit || '';
      
      const normalRange = def.normalRange || '';
      const isPlaceholderRange = (v: any) => !v || typeof v !== 'string' || v.trim() === '' || v === 'Unknown' || v === 'unset' || v === 'n/a' || v === '-';
      const structuredOverrideSummary = formatCustomRangesSummary(customDef?.customRanges || (def as any).customRanges);
      const flatCustomRange = !isPlaceholderRange(customDef?.normalRange) ? customDef.normalRange : '';
      const customRange = structuredOverrideSummary || flatCustomRange;
      
      const agentCal = agentCalibrationRecords[def.key] || null;
      const optVal = customDef?.optimalValue || (agentCal ? formatOptimalTargetValue(agentCal) : '');
      const latestLogForUnit = [...activeHistory].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).find(h => h.biomarkers && h.biomarkers[key] !== undefined);
      
      const rangeSourceInfo = getBiomarkerRangeSourceInfo(key, def, profile, latestLogForUnit, agentCal);
      let clinicalReferenceRange = rangeSourceInfo.sourceRange || normalRange;
      const activeRule = getActiveStructuredRangeRule(def, profile);
      if (activeRule && activeRule.name) {
        const profileType = activeRule.filters?.ethnicity ? `${activeRule.filters.ethnicity} Profile` : 'General Profile';
        clinicalReferenceRange = `${clinicalReferenceRange} (${activeRule.name} - ${profileType})`;
      }
      
      const medicalPractice = def.standardMedicalGrouping || customDef?.standardMedicalGrouping || '';
      const riskCats = (def.riskCategories || customDef?.riskCategories || []).join('; ');
      
      const potConds = (def.potentialMedicalConditions || customDef?.potentialMedicalConditions || []).join('; ');

      // Current Evaluation Status & Medical Insight
      const latestVal = biomarkers[key];
      const hasVal = !isValEmpty(latestVal);
      let evalStatus = 'No recent data';
      let insightText = '';
      if (hasVal) {
        const status = getBiomarkerStatus(key, latestVal, def.normalRange, def, profile);
        const statusLabel = getBiomarkerStatusLabel(key, status, customDef, latestVal, profile);
        const riskTag = getBiomarkerRiskTag(key, status, customDef, latestVal, profile);
        evalStatus = `Value: ${latestVal} | Status: ${statusLabel} | Risk: ${riskTag || 'N/A'}`;
        insightText = generateDynamicInsight(def, profile, latestVal, status);
      }
      
      const notUsed = isKeyNotUsedInMedicalHistory(key) ? "TRUE" : "FALSE";

      const logs = activeHistory
        .filter(h => h.biomarkers && h.biomarkers[key] !== undefined)
        .map(h => {
          let logStr = `Date: ${h.date} | Value: ${h.biomarkers[key]}`;
          if (h.tests) {
             const test = h.tests.find(t => t.key === key);
             if (test) {
                const details = [];
                if (test.originalTestName) details.push(`Original Name: ${test.originalTestName}`);
                if (test.normalRange) details.push(`Extracted Range: ${test.normalRange}`);
                if (test.doctorComment) details.push(`Doctor/Lab Comment:\n${test.doctorComment}`);
                if (details.length > 0) {
                   logStr += `\n${details.join('\n')}`;
                }
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

    const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `biomarkers_export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportLogEntriesToCSV = () => {
    const headers = ["Biomarker", "Date", "Value", "Unit", "Comment"];
    const rows: string[] = [];

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

    sortedHistory.forEach(h => {
      if (!h.biomarkers) return;
      const formattedDate = formatToDDMMYYYY(h.date) || h.date;
      const seenCanonicalKeys = new Set<string>();

      Object.keys(h.biomarkers).forEach(key => {
        const val = h.biomarkers[key];
        if (val === undefined || val === null || val === '') return;

        const canonicalKey = getMappedBiomarkerKey(key) || key;
        if (seenCanonicalKeys.has(canonicalKey)) {
          return;
        }
        seenCanonicalKeys.add(canonicalKey);

        const def = allDefinitions.find(d => d.key === canonicalKey || d.key === key) || biomarkerDefinitions.find(d => d.key === canonicalKey || d.key === key);
        const customDef = getCustomBiomarkerDef(profile, canonicalKey) || getCustomBiomarkerDef(profile, key);
        const testDetail = h.tests?.find(t => t.key === key || t.key === canonicalKey);
        
        let name = def?.name || customDef?.name || testDetail?.originalTestName;
        if (!name) {
          name = formatKeyToTitle(key);
        }

        const unit = h.observationMeta?.[key]?.rawUnit || testDetail?.unit || customDef?.unit || def?.unit || '';

        let comment = testDetail?.doctorComment || '';
        if (!comment && h.note) {
          const isGeneralCalcNote = h.note.includes('Mifflin-St Jeor') || h.note.includes('Auto-logged BMI update');
          const isBodyCompMarker = ['bmi', 'weight', 'height', 'ideal_body_weight'].includes(canonicalKey);
          if (!isGeneralCalcNote || isBodyCompMarker) {
            comment = h.note;
          }
        }

        // Clean leading punctuation like ". " or "."
        comment = comment.trim();
        if (comment.startsWith('.')) {
          comment = comment.replace(/^\.\s*/, '').trim();
        }

        rows.push([
          escapeCsvField(name),
          escapeCsvField(formattedDate),
          escapeCsvField(val),
          escapeCsvField(unit),
          escapeCsvField(comment)
        ].join(','));
      });
    });

    const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `biomarker_log_entries_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const totalUniqueBiomarkers = useMemo(() => {
    return allDefinitions.length;
  }, [allDefinitions]);

  // PERF: compute the flagged-telemetry key set exactly ONCE per render.
  // isBiomarkerNeedingReview() is called once per biomarker at multiple
  // spots below (subcategory count, per-category filtering, per-card JSX);
  // without this, each of those calls independently reran the full
  // O(history x definitions) detectFlaggedTelemetryErrors scan.
  const flaggedTelemetryList = useMemo(() => {
    return detectFlaggedTelemetryErrors(biomarkers, profile, activeHistory, allDefinitions || []);
  }, [biomarkers, profile, activeHistory, allDefinitions]);

  const flaggedTelemetryKeys = useMemo(() => {
    return new Set(flaggedTelemetryList.map(f => f.key));
  }, [flaggedTelemetryList]);

  // PERF: parse `batch_analysis_results` from localStorage exactly ONCE per
  // render. The per-card "🎯 Target" badge used to call getAgentCalibration()
  // once per rendered biomarker card (~65 cards), each call independently
  // re-reading and JSON.parse-ing the same localStorage blob from scratch —
  // this was the #1 remaining cause of Health tab load lag after the
  // telemetry-scan fix. Deliberately NOT wrapped in useMemo with an empty
  // dependency array — recomputing every render (cheaply, once) preserves
  // the original "always fresh" behavior (e.g. right after the Data Accuracy
  // Agent writes a new batch) without paying the per-card cost.
  const agentCalibrationRecords = getAllAgentCalibrationRecords();

  const checkIsPending = (def: any) => {
    return !isBiomarkerApproved(def.key, profile, activeHistory);
  };

  // Dynamic list of subcategories based on current viewType
  const subCategories = useMemo(() => {
    const hasBiomarkersToReview = allDefinitions.some(def => isBiomarkerNeedingReview(def.key, profile, activeHistory, biomarkers, allDefinitions, flaggedTelemetryKeys));

    let baseCategories: string[] = [];
    if (viewType === 'risk') {
      const allRisks = new Set<string>();
      allDefinitions.forEach(def => {
        const meta = getBiomarkerMetadata(def.key, profile.customBiomarkers?.[def.key] || def);
        const risks = (meta.riskCategories && meta.riskCategories.length > 0) ? meta.riskCategories : ['Screenings & Wellness'];
        risks.forEach(r => {
          allRisks.add(canonicalizeRiskCategory(r));
        });
      });
      const arr = Array.from(allRisks).sort();
      baseCategories = ['all', ...arr];
    } else if (viewType === 'condition') {
      const allConditions = new Set<string>();
      let hasUnknown = false;
      allDefinitions.forEach(def => {
        if (!def.potentialMedicalConditions || def.potentialMedicalConditions.length === 0) {
           hasUnknown = true;
        } else {
          def.potentialMedicalConditions.forEach(c => {
            if (c) allConditions.add(c);
          });
        }
      });
      const arr = Array.from(allConditions).sort();
      if (hasUnknown) arr.push('Unknown');
      baseCategories = ['all', ...arr];
    } else {
      const allPractices = new Set<string>();
      allDefinitions.forEach(def => {
        let groupName = def.standardMedicalGrouping;
        if (!groupName || groupName === 'Other') {
           groupName = getPhysiologicalBucket(def.key, def.name);
        }
        allPractices.add(groupName);
      });
      const sortedPractices = Array.from(allPractices).sort();
      baseCategories = ['all', ...sortedPractices];
    }

    if (hasBiomarkersToReview) baseCategories.push('Biomarkers to Review');

    return baseCategories;
  }, [allDefinitions, viewType, profile.customBiomarkers, biomarkers, activeHistory, flaggedTelemetryKeys]);

  const filteredBiomarkers = useMemo(() => {
    let filtered = allDefinitions.filter(def => {
      // Apply search query filter if it exists
      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase();
        const matchesName = def.name.toLowerCase().includes(q) || displayBiomarkerName(profile.language, def.key, def.name).toLowerCase().includes(q);
        const matchesKey = def.key.toLowerCase().includes(q);
        const matchesConditions = def.potentialMedicalConditions?.some(c => c.toLowerCase().includes(q) || displayConditionName(profile.language, c).toLowerCase().includes(q));
        const matchesRisks = def.riskCategories?.some(r => r.toLowerCase().includes(q));
        const matchesGroup = def.standardMedicalGrouping?.toLowerCase().includes(q);
        if (!matchesName && !matchesKey && !matchesConditions && !matchesRisks && !matchesGroup) {
          return false;
        }
      }

      if (selectedSubCategory === 'all') return true;
      if (viewType === 'risk') {
        const meta = getBiomarkerMetadata(def.key, profile.customBiomarkers?.[def.key] || def);
        const risks = (meta.riskCategories && meta.riskCategories.length > 0) ? meta.riskCategories : ['Screenings & Wellness'];
        const canonical = risks.map(r => canonicalizeRiskCategory(r));
        return canonical.includes(selectedSubCategory as any);
      } else if (viewType === 'condition') {
        return def.potentialMedicalConditions?.includes(selectedSubCategory);
      } else {
        return def.standardMedicalGrouping === selectedSubCategory;
      }
    });

    if (sortBy === 'name') {
      filtered.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      // Sort by importance: critical > high/low > normal > unknown > no data
      const getSeverityScore = (key: string) => {
        const val = getLatestValue(key);
        if (val === undefined) return NO_DATA_RISK_SCORE;
        const def = allDefinitions.find(d => d.key === key);
        return getBiomarkerEffectiveRisk(key, val, def, profile).score;
      };

      const getLatestDate = (key: string) => {
        const logs = activeHistory.filter(h => h.biomarkers[key] !== undefined);
        if (logs.length === 0) return '0000-00-00';
        return logs.map(h => h.date).sort((a, b) => toYYYYMMDD(a).localeCompare(toYYYYMMDD(b))).reverse()[0];
      };

      filtered.sort((a, b) => {
        const scoreA = getSeverityScore(a.key);
        const scoreB = getSeverityScore(b.key);
        
        if (scoreA !== scoreB) return scoreB - scoreA; // higher severity first
        
        // Secondary sort: Latest date
        const dateA = getLatestDate(a.key);
        const dateB = getLatestDate(b.key);
        if (dateA !== dateB) return toYYYYMMDD(dateB).localeCompare(toYYYYMMDD(dateA));
        
        return a.name.localeCompare(b.name);
      });
    }

    return filtered;
  }, [allDefinitions, viewType, selectedSubCategory, sortBy, activeHistory, biomarkers, searchQuery]);

  // Helper to filter biomarkers for a subcategory
  const getBiomarkersForSubCategory = (cat: string) => {
    return filteredBiomarkers.filter(def => {
      const isApproved = isBiomarkerApproved(def.key, profile, activeHistory);
      const isPending = !isApproved;
      const hasVal = getLatestValue(def.key) !== undefined;

      if (cat === 'Biomarkers to Review' || cat === 'Unknown Range') {
        return isBiomarkerNeedingReview(def.key, profile, activeHistory, biomarkers, allDefinitions, flaggedTelemetryKeys);
      }

      // If pending approval, exclude from standard medical groupings/categories (they appear under Biomarkers to Review)
      if (isPending) {
        return false;
      }

      if (viewType === 'risk') {
        const meta = getBiomarkerMetadata(def.key, profile.customBiomarkers?.[def.key] || def);
        const risks = (meta.riskCategories && meta.riskCategories.length > 0) ? meta.riskCategories : ['Screenings & Wellness'];
        const canonical = risks.map(r => canonicalizeRiskCategory(r));
        return canonical.includes(cat as any);
      } else if (viewType === 'condition') {
        if (cat === 'Unknown') return !def.potentialMedicalConditions || def.potentialMedicalConditions.length === 0;
        return def.potentialMedicalConditions?.includes(cat);
      } else {
        let groupName = def.standardMedicalGrouping;
        if (!groupName || groupName === 'Other') {
           groupName = getPhysiologicalBucket(def.key, def.name);
        }
        return groupName === cat;
      }
    });
  };

  // Helper to calculate highest risk info for a subcategory
  const getSubCategoryRiskInfo = (cat: string) => {
    if (cat === 'Biomarkers to Review' || cat === 'Unknown Range') {
      return { label: t.biomarkersToReview, bg: 'bg-amber-600', text: 'text-white' };
    }
    const groupMarkers = getBiomarkersForSubCategory(cat);
    let highestRisk: BiomarkerEffectiveRisk = {
      score: NO_DATA_RISK_SCORE,
      severity: null,
      tag: t.noData,
      bg: 'bg-slate-200 dark:bg-slate-800/50',
      text: 'text-theme-text-secondary'
    };
    
    groupMarkers.forEach(def => {
      const val = getLatestValue(def.key);
      if (val !== undefined && val !== null && val !== '' && !isValEmpty(val)) {
        const risk = getBiomarkerEffectiveRisk(def.key, val, def, profile);
        if (risk.score > highestRisk.score) {
          highestRisk = risk;
        }
      }
    });
    
    return { label: highestRisk.tag, bg: highestRisk.bg, text: highestRisk.text };
  };

  // Sort subcategories
  const activeCategories = useMemo(() => {
    const cats = subCategories.filter(cat => cat !== 'all' && getBiomarkersForSubCategory(cat).length > 0);
    if (sortBy === 'name') {
      return [...cats].sort((a, b) => {
        if (a === 'Biomarkers to Review') return 1;
        if (b === 'Biomarkers to Review') return -1;
        return a.localeCompare(b);
      });
    } else {
      const getCatScore = (cat: string) => {
        if (cat === 'Biomarkers to Review') return -1;
        const groupMarkers = getBiomarkersForSubCategory(cat);
        let maxScore = NO_DATA_RISK_SCORE;
        groupMarkers.forEach(def => {
          const val = getLatestValue(def.key);
          if (val !== undefined && val !== null && val !== '' && !isValEmpty(val)) {
            const risk = getBiomarkerEffectiveRisk(def.key, val, def, profile);
            maxScore = Math.max(maxScore, risk.score);
          }
        });
        return maxScore;
      };
      
      return [...cats].sort((a, b) => {
        const scoreA = getCatScore(a);
        const scoreB = getCatScore(b);
        if (scoreB !== scoreA) return scoreB - scoreA;
        return a.localeCompare(b);
      });
    }
  }, [subCategories, sortBy, allDefinitions, biomarkers, filteredBiomarkers]);

  // Sort markers inside each subcategory
  const getSortedBiomarkersForSubCategory = (cat: string) => {
    const markers = getBiomarkersForSubCategory(cat);
    if (sortBy === 'name') {
      return [...markers].sort((a, b) => a.name.localeCompare(b.name));
    } else {
      const getSeverityScore = (key: string) => {
        const val = getLatestValue(key);
        if (val === undefined) return NO_DATA_RISK_SCORE;
        const def = allDefinitions.find(d => d.key === key);
        return getBiomarkerEffectiveRisk(key, val, def, profile).score;
      };
      const getLatestDate = (key: string) => {
        const logs = activeHistory.filter(h => h.biomarkers[key] !== undefined);
        if (logs.length === 0) return '0000-00-00';
        return logs.map(h => h.date).sort((a, b) => toYYYYMMDD(a).localeCompare(toYYYYMMDD(b))).reverse()[0];
      };
      
      return [...markers].sort((a, b) => {
        const scoreA = getSeverityScore(a.key);
        const scoreB = getSeverityScore(b.key);
        if (scoreA !== scoreB) return scoreB - scoreA;
        const dateA = getLatestDate(a.key);
        const dateB = getLatestDate(b.key);
        if (dateA !== dateB) return toYYYYMMDD(dateB).localeCompare(toYYYYMMDD(dateA));
        return a.name.localeCompare(b.name);
      });
    }
  };

  return (
    <div className="space-y-4 pb-40 animation-fade-in max-w-md mx-auto px-3 mt-4 font-sans text-theme-text">
      
      {/* Search Input */}
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <svg className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <input
          type="text"
          placeholder={t.searchConditionsOrMarkers}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-3 py-2 bg-white dark:bg-slate-800 border border-theme-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all shadow-sm"
        />
      </div>

      {/* View Selection Controls */}
      <div className="grid grid-cols-2 gap-3 mb-1">
        {/* View Selection */}
        <div className="flex flex-col gap-1">
          <select
            value={viewType}
            onChange={(e) => {
              setViewType(e.target.value as any);
              setSelectedSubCategory('all');
            }}
            className="w-full px-2.5 py-1.5 text-xs font-semibold bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-theme-border rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:outline-none transition-all cursor-pointer shadow-sm"
          >
            {BIOMARKER_GROUPING_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>
                {opt.value === 'risk' ? t.byRiskCategories : opt.value === 'practice' ? t.byMedicalPractice : t.byMedicalConditions}
              </option>
            ))}
          </select>
        </div>

        {/* Sort Selection */}
        <div className="flex flex-col gap-1">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="w-full px-2.5 py-1.5 text-xs font-semibold bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-theme-border rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:outline-none transition-all cursor-pointer shadow-sm"
          >
            <option value="risk">{t.sortByRiskLevel}</option>
            <option value="name">{t.sortByName}</option>
          </select>
        </div>
      </div>

      {/* Active Medical Jobs */}
      {activeMedicalJobs.length > 0 && (
        <div className="space-y-3 mb-4" id="active-medical-jobs">
          {activeMedicalJobs.map((job) => (
            <TaskPlaceholderCard
              key={job.id}
              job={job}
              onView={(id) => {
                if (onViewJob) onViewJob(id);
              }}
              onDelete={async (id) => {
                await JobStore.deleteJob(id);
              }}
              onCancel={(id) => {
                const j = JobStore.getJob(id);
                if (j) {
                  if (j.status === 'queued') {
                    JobStore.updateJob(id, { status: 'cancelled' });
                  } else if (j.status === 'running') {
                    j.abortController?.abort();
                    JobStore.updateJob(id, { status: 'cancelled' });
                  }
                }
              }}
              onSave={() => {}}
              profileLanguage={profile.language}
            />
          ))}
        </div>
      )}

      {/* Accordions Group of Biomarkers */}
      <div className="space-y-2.5 mt-[20px]">
        {activeCategories.length === 0 ? (
          <div className="p-8 text-center bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-dashed border-theme-border">
            <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">
              {searchQuery.trim() !== ''
                ? `${t.noBiomarkersFoundMatching} "${searchQuery}"`
                : t.noBiomarkersAvailableView}
            </p>
            {searchQuery.trim() !== '' && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="mt-3 px-3 py-1.5 text-xs font-bold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors cursor-pointer shadow-xs"
              >
                {t.clearSearch}
              </button>
            )}
          </div>
        ) : (
          activeCategories.map((cat) => {
          const isOpen = searchQuery.trim() !== '' || !!openSubCategories[cat];
          const riskInfo = getSubCategoryRiskInfo(cat);
          const markers = getSortedBiomarkersForSubCategory(cat);
          
          return (
            <div key={cat} className="border border-theme-border rounded-2xl overflow-hidden bg-theme-bg-card shadow-xs">
              {/* Accordion Header */}
              <div 
                onClick={() => toggleSubCategory(cat)}
                className="flex items-center justify-between p-3.5 bg-slate-50/50 dark:bg-slate-900/60 hover:bg-slate-100/60 dark:hover:bg-slate-850/40 cursor-pointer select-none transition-colors border-b border-theme-border/30"
              >
                <span className="text-xs font-bold text-slate-700 dark:text-slate-200 capitalize">
  {viewType === 'condition' ? displayConditionName(profile.language, cat) : displayCategoryLabel(profile.language, cat)} ({markers.length})
</span>

                <div className="flex items-center gap-2">
                  <span className={`${riskInfo.bg} ${riskInfo.text} text-[10px] font-bold px-2.5 py-0.5 rounded-full lowercase [font-variant:small-caps] tracking-wider`}>
                    {displayStatusLabel(profile.language, riskInfo.label)}
                  </span>
                  <span className="text-slate-400">
                    {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </span>
                </div>
              </div>

              {/* Accordion Content */}
              {isOpen && (
                <div className="divide-y divide-slate-100 dark:divide-slate-800/40 bg-theme-bg-card">
                  {(cat === 'Biomarkers to Review' || cat === 'Unknown Range') && markers.length > 0 && (
                    <div className="p-3 bg-amber-500/10 border-b border-amber-500/20 text-amber-900 dark:text-amber-200 text-xs flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                        <span>{t.biomarkersNeedingReviewNoticePrefix} <strong>{markers.length}</strong> {t.biomarkersNeedingReviewNoticeSuffix}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const keys = markers.map(m => m.key);
                          if (onReviewWithAgent) {
                            onReviewWithAgent(keys);
                          } else if (onOpenAgentChat) {
                            const prefillMsg = `Please help me review and correct scaling, unit, and notation errors in my historical biomarker logs:\n` +
                              markers.map(m => {
                                const errInfo = flaggedTelemetryList.find(e => e.key === m.key);
                                const flaggedSamples = errInfo ? errInfo.samples : [];
                                return `- ${m.name}: ${flaggedSamples.join(', ')}`;
                              }).join('\n');

                            onOpenAgentChat('biomarker_review', {
                              dataReviewBatchKeys: keys,
                              prefillMessage: prefillMsg
                            });
                          }
                        }}
                        className="px-2.5 py-1 text-[11px] font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors shrink-0 cursor-pointer shadow-xs"
                      >
                        {t.fixAllWithDataReviewAgent}
                      </button>
                    </div>
                  )}

                  {markers.length > 0 ? (
                    markers.map((def) => {
                      let val = getLatestValue(def.key);
                      const originalVal = val;
                      const isEmptyVal = isValEmpty(val);
                      const hasVal = val !== undefined && val !== null && val !== '';
                      const customDef = getCustomBiomarkerDef(profile, def.key);
                      const status = (hasVal && !isEmptyVal) ? getBiomarkerStatus(def.key, val, def.normalRange, def, profile) : 'unknown';
                      const statusLabel = (hasVal && !isEmptyVal) ? getBiomarkerStatusLabel(def.key, status, customDef, val, profile) : '';
                      const colorClass = isEmptyVal ? 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30' : getBiomarkerColor(statusLabel || status);
                      const isExpanded = expandedKey === def.key;
                      const riskTag = (hasVal && !isEmptyVal) ? getBiomarkerRiskTag(def.key, status, customDef, val, profile) : null;
                      const isApproved = isBiomarkerApproved(def.key, profile, activeHistory);
                      const isNeedsApproval = !isApproved && (!!(def as any).needsApproval || !!profile.customBiomarkers?.[def.key]?.needsApproval);
                      const isMissingUnit = !isApproved && (!def.unit || def.unit.trim() === '');
                      const isMissingCategory = !isApproved && isBiomarkerMissingCategory(def.key, profile, activeHistory);
                      const isPendingReview = isBiomarkerNeedingReview(def.key, profile, activeHistory, biomarkers, allDefinitions, flaggedTelemetryKeys);
                      
                      const latestLogForUnit = [...(activeHistory || [])]
                        .filter((h: any) => h.biomarkers && h.biomarkers[def.key] !== undefined)
                        .sort((a: any, b: any) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)))[0];
                      let displayUnit = latestLogForUnit?.observationMeta?.[def.key]?.rawUnit || def.unit || '';
                      if (profile.unitPreference === 'US' && typeof val === 'number') {
                        const reversed = reverseStandardizeUnit(def.key, val, displayUnit);
                        val = reversed.newValue;
                        displayUnit = reversed.newUnit || displayUnit;
                      }
                      
                      // Clone def so we can safely update the unit
                      const displayRange = formatNormalRange(def.key, def.normalRange || '', def.unit || '', profile.unitPreference as 'SI' | 'US');
                      const displayDef = { ...def, unit: displayUnit, normalRange: displayRange };

                      return (
                        <div 
                          key={def.key} 
                          id={`biomarker-card-${def.key}`} 
                          className={`flex flex-col transition-all duration-1000 ${
                            flashingKey === def.key 
                              ? 'bg-indigo-50/70 dark:bg-indigo-950/30 ring-2 ring-indigo-500/50 dark:ring-indigo-400/50 rounded-xl overflow-hidden' 
                              : ''
                          }`}
                        >
                          <div
                            onClick={() => setExpandedKey(isExpanded ? null : def.key)}
                            className={`flex items-center justify-between p-3.5 cursor-pointer hover:bg-slate-50/60 dark:hover:bg-slate-800/20 ${isExpanded ? 'bg-slate-50/50 dark:bg-slate-800/20' : ''}`}
                          >
                            <div className="min-w-0 flex-1 pr-3">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate capitalize">
                                  {displayBiomarkerName(profile.language, def.key, def.name)}
                                </span>
                                {def.key === 'bmi' && hasBmiAlert && (
                                  <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0 animate-pulse" />
                                )}
                                <span className="text-[10px] font-mono text-slate-400">({displayUnit})</span>
                              </div>
                              <p className="text-[10px] text-slate-400 mt-0.5">
                                {t.normalRangeLabel} {displayDef.normalRange}
                              </p>
                              
                              {/* Associated Metadata Badges */}
                              <div className="flex flex-wrap gap-1 mt-1.5 max-w-full overflow-hidden">
                                {isEmptyVal && (
                                  <span className="px-1.5 py-0.5 text-[8px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300 rounded-md border border-rose-300/80 dark:border-rose-700/60 whitespace-nowrap flex items-center gap-1 animate-pulse">
                                    <AlertCircle className="w-2.5 h-2.5 text-rose-600 dark:text-rose-400" />
                                    {t.zeroEmptyValueFlagged}
                                  </span>
                                )}
                                {isBiomarkerNeedingReview(def.key, profile, activeHistory, biomarkers, allDefinitions, flaggedTelemetryKeys) && (
                                  <span className="px-1.5 py-0.5 text-[8px] font-bold bg-amber-100 text-amber-900 dark:bg-amber-950/80 dark:text-amber-300 rounded-md border border-amber-300/80 dark:border-amber-700/60 whitespace-nowrap flex items-center gap-1">
                                    <AlertCircle className="w-2.5 h-2.5 text-amber-600 dark:text-amber-400" />
                                    {t.biomarkerToReview}
                                  </span>
                                )}
                                {(() => {
                                  const customOpt = profile.customBiomarkers?.[def.key]?.optimalValue;
                                  const agentCal = agentCalibrationRecords[def.key] || null;
                                  const optVal = customOpt || (agentCal ? formatOptimalTargetValue(agentCal) : null);
                                  if (optVal && optVal.trim() && optVal.trim() !== def.normalRange) {
                                    return (
                                      <span className="px-1.5 py-0.5 text-[8px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 rounded-md border border-emerald-300/80 dark:border-emerald-700/60 whitespace-nowrap flex items-center gap-1">
                                        🎯 {t.targetLabel}: {optVal}
                                      </span>
                                    );
                                  }
                                  return null;
                                })()}
                                {isNeedsApproval && !isPendingReview && (
                                  <span className="px-1.5 py-0.5 text-[8px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 rounded-md border border-amber-300/80 dark:border-amber-700/60 whitespace-nowrap flex items-center gap-1 animate-pulse">
                                    <Clock className="w-2.5 h-2.5 text-amber-600 dark:text-amber-400" />
                                    {t.biomarkerToReview}
                                  </span>
                                )}
                                {isMissingUnit && (
                                  <span className="px-1.5 py-0.5 text-[8px] font-bold bg-orange-100 text-orange-800 dark:bg-orange-950/80 dark:text-orange-300 rounded-md border border-orange-300/80 dark:border-orange-700/60 whitespace-nowrap flex items-center gap-1">
                                    <AlertCircle className="w-2.5 h-2.5 text-orange-600 dark:text-orange-400" />
                                    {t.missingUnitToBeApproved}
                                  </span>
                                )}
                                {isMissingCategory && (
                                  <span className="px-1.5 py-0.5 text-[8px] font-bold bg-yellow-100 text-yellow-800 dark:bg-yellow-950/80 dark:text-yellow-300 rounded-md border border-yellow-300/80 dark:border-yellow-700/60 whitespace-nowrap flex items-center gap-1">
                                    <AlertCircle className="w-2.5 h-2.5 text-yellow-600 dark:text-yellow-400" />
                                    {t.missingCategoryToBeApproved}
                                  </span>
                                )}
                                {status === 'flagged' && (
                                  <span className="px-1.5 py-0.5 text-[8px] font-bold bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 rounded-md border border-purple-300 dark:border-purple-700 whitespace-nowrap animate-pulse flex items-center gap-1">
                                    <AlertCircle className="w-2.5 h-2.5 text-purple-600 dark:text-purple-400" />
                                    {t.flaggedImprobableValue}
                                  </span>
                                )}
                                {riskTag && (
                                  <span className={`px-1.5 py-0.5 text-[8px] font-bold rounded-md border whitespace-nowrap uppercase ${
                                    riskTag.toLowerCase() === 'healthy' 
                                      ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border-emerald-100/60 dark:border-emerald-900/40' 
                                      : riskTag.toLowerCase().includes('at risk')
                                        ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border-amber-100/60 dark:border-amber-900/40'
                                        : 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border-rose-100/60 dark:border-rose-900/40'
                                  }`}>
                                    {riskTag}
                                  </span>
                                )}
                                
                                
                              </div>
                            </div>

                            <div className="text-right flex items-center gap-2">
                              <div className="flex flex-col items-end">
                                <span className={`text-xs font-bold font-sans ${isEmptyVal ? 'text-rose-600 dark:text-rose-400 font-extrabold' : (hasVal ? colorClass : 'text-slate-300')}`}>
                                  {hasVal ? (hideSensitive ? '***' : (isEmptyVal ? `${val} (${t.emptyZero})` : val)) : t.unset}
                                </span>
                                {hasVal && (
                                  <span className={`text-[9px] font-bold uppercase tracking-wider ${isEmptyVal ? 'text-rose-600 dark:text-rose-400' : colorClass}`}>
                                    {isEmptyVal ? t.toBeDeleted : displayStatusLabel(profile.language, statusLabel)}
                                  </span>
                                )}
                              </div>
                              <div className="text-slate-400">
                                {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                              </div>
                            </div>
                          </div>
                          
                          {isExpanded && (
                            <BiomarkerExpandedSection onOpenAiReview={(key) => {
                                if (onOpenAgentChat) {
                                  const targetDef = def || getBiomarkerDef(key);
                                  onOpenAgentChat('biomarker_review', { 
                                    biomarkerKey: key, 
                                    prefillMessage: buildBiomarkerReviewPrefill(key, targetDef, biomarkers, profile) 
                                  });
                                }
                              }} onCombineBiomarker={() => {}}
                              def={def}
                              profile={profile}
                              language={profile.language}
                              biomarkerHistory={activeHistory}
                              biomarkers={biomarkers}
                              onEditBiomarkerLog={onEditBiomarkerLog}
                              onDeleteBiomarkerLog={onDeleteBiomarkerLog}
                              onDeleteBiomarkerFromLog={onDeleteBiomarkerFromLog}
                              onDeleteBiomarker={onDeleteBiomarker}
                                                                                          onApplyCalculation={onApplyCalculation}
                              hasPendingAlert={def.key === 'bmi' ? hasBmiAlert : false}
                              onDismissAlert={def.key === 'bmi' ? onDismissBmiAlert : undefined}
                              hideSensitive={hideSensitive}
                              onEditBiomarkerDef={(key, range, unit) => {
                                const currentUnit = profile.customBiomarkers?.[key]?.unit || getBiomarkerDef(key)?.unit || '';
                                const res = handleUnitChange({
                                  key,
                                  fromUnit: currentUnit,
                                  toUnit: unit,
                                  mode: 'relabel',
                                  profile,
                                  history: activeHistory,
                                });
                                const newCustom = { ...res.profile.customBiomarkers };
                                const existing = newCustom[key] || { name: key, unit: unit, normalRange: range, description: '' };
                                newCustom[key] = { ...existing, normalRange: range, unit: unit };
                                if (onUpdateProfile) {
                                  onUpdateProfile({ customBiomarkers: newCustom });
                                }
                              }}
                              onFlagNotUsedLocal={onFlagNotUsedLocal}
                            />
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <p className="p-4 text-xs text-slate-400 italic text-center">{t.noBiomarkersInCategory}</p>
                  )}
                </div>
              )}
            </div>
          );
        }))}
      </div>

      <div className="mt-8 pt-6 border-t border-theme-border/80 flex flex-col sm:flex-row items-center justify-between gap-4 px-4">
        <div className="flex flex-wrap items-center gap-6 text-xs text-theme-text-secondary font-medium">
          <div className="flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-indigo-500" />
            <span onClick={exportBiomarkersToCSV} className="cursor-pointer hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors" title={t.downloadAsCsv}>{t.trackedBiomarkers}: <strong className="text-slate-800 dark:text-slate-200 font-bold">{totalUniqueBiomarkers}</strong></span>
          </div>
          <div className="flex items-center gap-2">
            <BrainCircuit className="w-4 h-4 text-indigo-500" />
            <span onClick={exportLogEntriesToCSV} className="cursor-pointer hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors" title={t.downloadAsCsv}>{t.totalLogEntries}: <strong className="text-slate-800 dark:text-slate-200 font-bold">{activeHistory.reduce((sum, h) => sum + Object.keys(h.biomarkers).length, 0)}</strong></span>
          </div>
        </div>
      </div>

      <div className="mt-6 flex flex-col items-center gap-3 pb-8">
        <button
          onClick={() => setShowDictionaryModal(true)}
          className="px-4 py-2 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 font-bold text-xs rounded-xl border border-indigo-100 dark:border-indigo-800/50 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors cursor-pointer flex items-center gap-2"
        >
          <ClipboardList className="w-4 h-4" />
          {t.openBiomarkerDictionary}
        </button>

        {Object.keys(profile?.notUsedInMedicalHistory || {}).length > 0 && (
          <button
            type="button"
            onClick={() => setShowNotUsedLocalModal(true)}
            className="px-3 py-1.5 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 font-bold text-xs rounded-xl border border-amber-200 dark:border-amber-800/60 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors cursor-pointer flex items-center gap-2"
          >
            <EyeOff className="w-3.5 h-3.5" />
            {t.notUsed} ({Object.keys(profile?.notUsedInMedicalHistory || {}).length})
          </button>
        )}
        
        {onDeleteEmptyBiomarkers && hasEmptyBiomarkers && (
          <button
            onClick={() => {
              onDeleteEmptyBiomarkers();
            }}
            className="px-4 py-2 bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 font-bold text-xs rounded-xl border border-rose-100 dark:border-rose-800/50 hover:bg-rose-100 dark:hover:bg-rose-900/40 transition-colors cursor-pointer flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            {t.deleteEmptyBiomarkers}
          </button>
        )}
      </div>
      
      

      {combineBiomarkerKey && onCombineBiomarkers && (
        <CombineBiomarkersModal
          profile={profile}
          isOpen={true}
          initialKey={combineBiomarkerKey}
          biomarkers={biomarkers}
          biomarkerHistory={activeHistory}
          allDefinitions={allDefinitions}
          onClose={() => setCombineBiomarkerKey(null)}
          onSaveCombine={onCombineBiomarkers}
          onReviewWithAgent={onReviewWithAgent}
        />
      )}

      {showDictionaryModal && onLogMedical && (
        <React.Suspense fallback={null}>
        <BiomarkerDictionaryModal
          profile={profile?.email === 'demo@healthcockpit.com' ? { ...profile, agentAnalyses: [] } : profile}
          biomarkers={profile?.email === 'demo@healthcockpit.com' ? {} : biomarkers}
          biomarkerHistory={profile?.email === 'demo@healthcockpit.com' ? [] : activeHistory}
          onClose={() => {
            setShowDictionaryModal(false);
          }}
          onReviewWithAgent={onReviewWithAgent}
          onUpdateProfile={onUpdateProfile ? (updates) => onUpdateProfile(updates) : (updates) => onLogMedical({}, updates, undefined, undefined, undefined, true)}
          onDeleteBiomarker={onDeleteBiomarker}
          onFlagNotUsed={onFlagNotUsed}
          onRestoreNotUsedGlobal={onRestoreNotUsedGlobal}
          onDeleteMultipleBiomarkers={onDeleteMultipleBiomarkers}
          onCombineBiomarkers={onCombineBiomarkers!}
          onBatchCombineBiomarkers={onBatchCombineBiomarkers}
          onBatchConsolidate={onBatchConsolidate}
          onStandardizeUnits={onStandardizeUnits}
          onLogMedical={onLogMedical}
          onAgentAnalysisSaved={onAgentAnalysisSaved}
          onDeleteAnalysis={onDeleteAnalysis}
          selectedModelId={selectedModelId}
          onChangeModelId={onChangeModelId}
        />
        </React.Suspense>
      )}

      {/* LOCAL NOT USED BIOMARKERS MODAL FOR MEDICAL HISTORY */}
      <NotUsedBiomarkersModal
        isOpen={showNotUsedLocalModal}
        onClose={() => setShowNotUsedLocalModal(false)}
        flaggedKeys={Object.keys(profile?.notUsedInMedicalHistory || {})}
        getDisplayName={(k) => profile?.customBiomarkers?.[k]?.name || biomarkerDefinitions.find((b: any) => b.key === k || (Array.isArray(b.aliases) && b.aliases.some((a: string) => a.toLowerCase() === k.toLowerCase())))?.name || k}
        onRestore={(k) => {
          if (onRestoreNotUsedLocal) onRestoreNotUsedLocal(k);
        }}
      />
    </div>
  );
}
