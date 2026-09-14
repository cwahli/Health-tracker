import { toYYYYMMDD } from "../utils/dateUtils";
import React, { useState, useEffect } from 'react';
import { UserProfile, FoodLog, RecommendationReport } from '../types';
import { translations } from '../utils/translations';
import { displayCategoryLabel, displayEthnicityOption, interpolate } from '../utils/i18n';
import { 
  Brain, Sparkles, AlertCircle, TrendingDown, BookOpen, Clock, Heart, 
  CheckCircle, HelpCircle, Loader, ShieldCheck, Database, Check, X, ArrowRight, Activity, Send, ChevronDown, ChevronUp, Trash2, Lock, Archive, Search, Stethoscope
} from 'lucide-react';
import LLMSelector from './LLMSelector';
import { GenericAgentResultView } from './AgentResultViews';
import { HealthBaselineCard } from './chat-cards/HealthBaselineCard';
import { AgentResultTable } from './AgentResultTable';
import { BatchNavigator } from './BatchNavigator';

import { biomarkerDefinitions, getBiomarkerMetadata, getPhysiologicalBucket, BIOMARKER_GROUPING_OPTIONS, getMappedBiomarkerKey, getMergedBiomarkerDef, isCatalogBuiltIn, shouldStampExtractedDefPending } from '../utils/biomarkers';
import { formatOptimalTargetValue } from '../utils/agentCalibration';
import { lazyWithRetry } from '../utils/lazyWithRetry';
const BiomarkerDictionaryModal = lazyWithRetry(() => import('./BiomarkerDictionaryModal'));
import { auth } from '../firebase';

interface InsightsTabProps {
  profile: UserProfile;
  foodLogs: FoodLog[];
  biomarkers: { [key: string]: number | string };
  biomarkerHistory?: any[];
  report: RecommendationReport | null;
  draftReport: RecommendationReport | null;
  onAcceptReport: (report: RecommendationReport) => Promise<void>;
  onRejectReport: () => void;
  selectedModelId: string;
  onChangeModelId: (id: string) => void;
  onGenerateReport: (engine: string) => Promise<void>;
  isGenerating: boolean;
  onNavigateToTab?: (tab: string) => void;
  onOpenMedicalChat?: () => void;
  onOpenAgentChat?: (
    agentType: 'agent1' | 'agent2' | 'agent3' | 'agent4' | 'agent5' | 'health_baseline' | 'agent7' | 'data_review',
    options?: { 
      prefillMessage?: string; 
      dataReviewBatchIdx?: number | string; 
      dataReviewBatchKeys?: string[];
      extractedData?: any[];
      currentBatch?: number;
      estimatedTotalMarkers?: number | null;
    }
  ) => void;
  onDeleteAnalysis?: (id: string) => Promise<void>;
  onArchiveAnalysis?: (id: string) => Promise<void>;
  onDeleteBiomarker?: (key: string) => void;
  onFlagNotUsed?: (key: string) => void;
  onRestoreNotUsedGlobal?: (key: string) => void;
  onDeleteMultipleBiomarkers?: (keys: string[]) => void;
  onUpdateProfile?: (profile: UserProfile) => Promise<void>;
  onUpdateHistory?: (history: any[], biomarkers: { [key: string]: number | string }, updatedProfile?: UserProfile) => Promise<void>;
  batchSize?: number;
  onChangeBatchSize?: (size: number) => void;
  calibratingBatchIdx?: number | null;
  calibratingAgentType?: string | null;
  onCombineBiomarkers?: (
    targetKey: string,
    targetDef: any,
    mergedLogs: any[],
    sourceKeysToDelete: string[]
  ) => void;
  onBatchConsolidate?: (mapping: { [key: string]: string }) => void;
  onAgentAnalysisSaved?: (agentType: string, agentResult: any, existingId?: string) => Promise<string | void>;
  onOpenFrontDesk?: () => void;
  onDataReviewStateChange?: (state: any) => void;
}

const STABLE_EMPTY_ARRAY: string[] = [];

export default function InsightsTab({
  profile,
  foodLogs,
  biomarkers,
  report,
  draftReport,
  onAcceptReport,
  onRejectReport,
  selectedModelId,
  onChangeModelId,
  onGenerateReport,
  isGenerating,
  onNavigateToTab,
  onOpenMedicalChat,
  onOpenAgentChat,
  onDeleteAnalysis,
  onArchiveAnalysis,
  onDeleteBiomarker,
  onFlagNotUsed,
  onRestoreNotUsedGlobal,
  onDeleteMultipleBiomarkers,
  biomarkerHistory,
  onUpdateProfile,
  onUpdateHistory,
  batchSize = 20,
  onChangeBatchSize,
  calibratingBatchIdx = null,
  calibratingAgentType = null,
  onCombineBiomarkers,
  onBatchConsolidate,
  onAgentAnalysisSaved,
  onOpenFrontDesk,
  onDataReviewStateChange
}: InsightsTabProps) {
  const t = translations[profile.language] || translations.en;
  const activeHistory = React.useMemo(() => (biomarkerHistory || []).filter(h => h.sync_state !== 'delete'), [biomarkerHistory]);
  const userIdentifier = profile?.email?.toLowerCase().replace(/[^a-z0-9]/g, '_') || 'guest';
  const [isApplying, setIsApplying] = useState(false);
  const [refinementText, setRefinementText] = useState("");
  const [chatHistory, setChatHistory] = useState<any[]>([]);
  const [showDictionaryModal, setShowDictionaryModal] = useState(false);
  const [dictionaryPreFillKey, setDictionaryPreFillKey] = useState<string | null>(null);
  const [expandedAgentHistory, setExpandedAgentHistory] = useState<Record<string, boolean>>({});

  // Accordion active step index
  const [activeStepIndex, setActiveStepIndex] = useState<number | null>(0);

  const [batchSizeInput, setBatchSizeInput] = useState<string>(batchSize.toString());
  const [customBatchKeys, setCustomBatchKeys] = useState<string[]>(() => {
    try {
      const uId = profile?.email?.toLowerCase().replace(/[^a-z0-9]/g, '_') || 'guest';
      const saved = localStorage.getItem(`agent1_custom_batch_keys_${uId}`);
      return saved ? JSON.parse(saved) : [];
    } catch(e) { return []; }
  });
  const [showCustomBatchModal, setShowCustomBatchModal] = useState(false);
  const [customBatchSearch, setCustomBatchSearch] = useState('');
  const [batchGroupType, setBatchGroupType] = useState<'risk' | 'practice' | 'condition'>('risk');
  const [customDataReviewBatchKeys, setCustomDataReviewBatchKeys] = useState<string[]>(() => {
    try {
      const uId = profile?.email?.toLowerCase().replace(/[^a-z0-9]/g, '_') || 'guest';
      const saved = localStorage.getItem(`datareview_custom_batch_keys_${uId}`);
      return saved ? JSON.parse(saved) : [];
    } catch(e) { return []; }
  });
  const [showCustomDataReviewBatchModal, setShowCustomDataReviewBatchModal] = useState(false);
  const [customDataReviewBatchSearch, setCustomDataReviewBatchSearch] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  
  React.useEffect(() => {
    setBatchSizeInput(batchSize.toString());
  }, [batchSize]);

  React.useEffect(() => {
    try {
      const savedApprovedData = localStorage.getItem('approved_data_review_batches');
      if (savedApprovedData) setApprovedBatches(JSON.parse(savedApprovedData));
      
      const savedAnalysisResults = localStorage.getItem('batch_analysis_results');
      if (savedAnalysisResults) setBatchAnalysisResults(JSON.parse(savedAnalysisResults));

      const savedApprovedAgent1 = localStorage.getItem('approved_agent1_batches');
      if (savedApprovedAgent1) setApprovedAgent1Batches(JSON.parse(savedApprovedAgent1));

      const savedAgent1Results = localStorage.getItem('agent1_batch_results');
      if (savedAgent1Results) setAgent1BatchResults(JSON.parse(savedAgent1Results));
    } catch (e) {
      console.warn("Failed to sync localStorage in InsightsTab useEffect", e);
    }
  }, [profile]);

  React.useEffect(() => {
    if (sessionStorage.getItem('auto_open_custom_batch_modal') === 'true') {
      sessionStorage.removeItem('auto_open_custom_batch_modal');
      setShowCustomBatchModal(true);
      // Reload keys from localStorage to ensure we have the prefilled keys
      try {
        const uId = profile?.email?.toLowerCase().replace(/[^a-z0-9]/g, '_') || 'guest';
        const saved = localStorage.getItem(`agent1_custom_batch_keys_${uId}`);
        if (saved) {
          setCustomBatchKeys(JSON.parse(saved));
        }
      } catch (e) {}
    }
  }, []);

  // Accordion approved steps state
  const [approvedSteps, setApprovedSteps] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('approvedSteps');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return {
      agent1: !!profile.agentTriageSummary,
      agent2: !!(profile.agentAnalyses?.some(a => a.agentType === 'agent2' && profile.customBiomarkers && Object.values(profile.customBiomarkers).some(b => b && b.riskCategories && b.riskCategories.length > 0))),
      agent3: !!(profile.agentAnalyses?.some(a => a.agentType === 'agent3')),
      agent4: !!(profile.agentDiagnosticSummary),
      agent5: !!(profile.agentContextualizerSummary),
      health_baseline: !!(report && (((report as any).healthBaselineCategories && (report as any).healthBaselineCategories.length > 0) || ((report as any).riskCategories && (report as any).riskCategories.length > 0) || (report.topNutrientTargets && report.topNutrientTargets.length > 0))),
      agent7: !!(profile.agentLiteratureSummary)
    };
  });

  const [isAdminMode, setIsAdminMode] = useState(() => {
    const saved = localStorage.getItem('health_cockpit_admin_mode');
    if (saved) return saved === 'admin';
    return profile?.email?.toLowerCase().trim() === 'cwah.liu@gmail.com';
  });

  useEffect(() => {
    const handleStorageChange = () => {
      const saved = localStorage.getItem('health_cockpit_admin_mode');
      if (saved) {
        setIsAdminMode(saved === 'admin');
      }
    };
    window.addEventListener('storage', handleStorageChange);
    const interval = setInterval(() => {
      const saved = localStorage.getItem('health_cockpit_admin_mode');
      if (saved) {
        setIsAdminMode(saved === 'admin');
      }
    }, 1000);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(interval);
    };
  }, []);

  // Approved analysis ids state, kept across sessions
  const [approvedAnalysisIds, setApprovedAnalysisIdsState] = useState<Record<string, string>>(() => {
    try {
      const saved = localStorage.getItem('approvedAnalysisIds');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
    
    const initialIds: Record<string, string> = {};
    const initialApproved = {
      agent1: !!profile.agentTriageSummary,
      agent2: !!(profile.agentAnalyses?.some(a => a.agentType === 'agent2' && profile.customBiomarkers && Object.values(profile.customBiomarkers).some(b => b && b.riskCategories && b.riskCategories.length > 0))),
      agent3: !!(profile.agentAnalyses?.some(a => a.agentType === 'agent3')),
      agent4: !!(profile.agentDiagnosticSummary),
      agent5: !!(profile.agentContextualizerSummary),
      health_baseline: !!(report && report.healthBaselineCategories && report.healthBaselineCategories.length > 0),
      agent7: !!(profile.agentLiteratureSummary)
    };
    
    Object.keys(initialApproved).forEach(agentType => {
      if (initialApproved[agentType as keyof typeof initialApproved]) {
        const history = (profile.agentAnalyses || [])
          .filter(a => a.agentType === agentType)
          .sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));
        if (history.length > 0) {
          initialIds[agentType] = history[0].id;
        }
      }
    });
    return initialIds;
  });

  const setApprovedAnalysisId = (agentType: string, id: string) => {
    setApprovedAnalysisIdsState(prev => {
      const updated = { ...prev, [agentType]: id };
      localStorage.setItem('approvedAnalysisIds', JSON.stringify(updated));
      return updated;
    });
  };

  const hasStepSomethingToApprove = (step: any, latestAnalysis: any) => {
    if (!latestAnalysis || !latestAnalysis.result) return false;
    
    if (step.id === 'data_review') {
      return batches.some((_, bIdx) => !approvedBatches[bIdx] && batchAnalysisResults[bIdx]);
    }
    
    if (step.agentType === 'agent1') {
      const jsonText = latestAnalysis.result.filledRows || latestAnalysis.result.extractedData || latestAnalysis.result;
      let parsedRows: any[] = [];
      if (Array.isArray(jsonText)) {
        parsedRows = jsonText;
      } else if (typeof jsonText === 'string') {
        const cleanText = jsonText.replace(/```(?:json)?/gi, '').trim();
        try {
          const parsed = JSON.parse(cleanText);
          if (Array.isArray(parsed)) parsedRows = parsed;
          else if (parsed?.biomarkers && Array.isArray(parsed.biomarkers)) parsedRows = parsed.biomarkers;
        } catch (e) {}
      }
      if (parsedRows.length === 0) return false;
      
      return parsedRows.some((row: any) => {
        const key = (row.biomarker || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
        if (!key) return false;
        const existingEntries = (activeHistory || []).filter((h: any) => h.biomarkers[key] !== undefined);
        const isNew = existingEntries.length === 0;
        if (isNew) return true;
        
        const sortedHistory = [...existingEntries].sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));
        const latestVal = sortedHistory[0].biomarkers[key];
        if (latestVal !== undefined && String(latestVal) !== String(row.value)) {
          return true;
        }
        return false;
      });
    }
    
    if (step.agentType === 'agent2') {
      const mapping = latestAnalysis.result.bucketMapping || latestAnalysis.result || {};
      const entries = Object.entries(mapping).filter(([k]) => k !== 'text' && k !== 'extractedData');
      if (entries.length === 0) return false;
      
      return entries.some(([bioName, mapData]: [string, any]) => {
        const key = bioName.toLowerCase().replace(/[^a-z0-9]/g, '_');
        const existingDef = profile?.customBiomarkers?.[key];
        if (!existingDef) return true;
        const newGroup = mapData.standardMedicalGrouping || 'Other';
        const oldGroup = existingDef?.standardMedicalGrouping || 'Other';
        if (newGroup !== oldGroup) return true;
        const newCategories = (mapData.riskCategories || []).join(', ');
        const oldCategories = (existingDef?.riskCategories || []).join(', ');
        if (newCategories !== oldCategories) return true;
        return false;
      });
    }
    
    if (step.agentType === 'agent3') {
      return true;
    }
    
    if (step.agentType === 'agent4') {
      const conditions = Array.isArray(latestAnalysis.result.prioritizedConditions) ? latestAnalysis.result.prioritizedConditions : [];
      return conditions.length > 0;
    }
    
    return true;
  };

  const [approvedBatches, setApprovedBatches] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('approved_data_review_batches');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    
    const initial: Record<number, boolean> = {};
    // Auto-approve batches if all keys in the batch exist in profile.customBiomarkers
    const batchSize = 20;
    const markerKeysList = Object.keys(biomarkers).filter(k => biomarkers[k] !== undefined && biomarkers[k] !== null && biomarkers[k] !== '');
    for (let i = 0; i < markerKeysList.length; i += batchSize) {
      const batchIdx = Math.floor(i / batchSize);
      const batchKeys = markerKeysList.slice(i, i + batchSize);
      const allExist = batchKeys.every(k => profile.customBiomarkers?.[k]?.standardMedicalGrouping !== undefined);
      if (allExist && batchKeys.length > 0) {
        initial[batchIdx] = true;
      }
    }
    return initial;
  });

  const [isAnalyzingBatch, setIsAnalyzingBatch] = useState<Record<string, boolean>>({});
  const [batchAnalysisResults, setBatchAnalysisResults] = useState<Record<string, any>>(() => {
    try {
      const saved = localStorage.getItem('batch_analysis_results');
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      return {};
    }
  });

  const [expandedBatches, setExpandedBatches] = useState<Record<string, boolean>>({});

  const [biomarkerBatches, setBiomarkerBatches] = React.useState<string[][]>(() => {
    try {
      const saved = localStorage.getItem('biomarker_batches_custom');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return [];
  });

  const [dataReviewCurrentBatchIdx, setDataReviewCurrentBatchIdx] = useState<number>(() => {
    const firstUnapprovedIdx = biomarkerBatches.findIndex((_, idx) => !approvedBatches[idx]);
    return firstUnapprovedIdx >= 0 ? firstUnapprovedIdx : Math.max(0, biomarkerBatches.length - 1);
  });

  const [fullscreenBatchIndex, setFullscreenBatchIndex] = useState<number | null>(null);
  const [fullscreenExtractionAnalysis, setFullscreenExtractionAnalysis] = useState<any | null>(null);

  const [approvedAgent1Batches, setApprovedAgent1Batches] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('approved_agent1_batches');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return {};
  });

  const [isAnalyzingAgent1Batch, setIsAnalyzingAgent1Batch] = useState<Record<string, boolean>>({});
  const [agent1LiveLogs, setAgent1LiveLogs] = useState<Record<string, string[]>>({});
  const [agent1BatchResults, setAgent1BatchResults] = useState<Record<string, any>>(() => {
    try {
      const saved = localStorage.getItem('agent1_batch_results');
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      return {};
    }
  });
  
  const [expandedAgent1Batches, setExpandedAgent1Batches] = useState<Record<string, boolean>>({});

  const handleResetBatches = () => {
    if (!window.confirm("This will clear all processed batches in Data Cleaning and Data Review, and force a full re-chunking. Proceed?")) return;
    
      setApprovedBatches({});
      setBatchAnalysisResults({});
      setApprovedAgent1Batches({});
      setAgent1BatchResults({});
      setCustomDataReviewBatchKeys([]);
      setCustomBatchKeys([]);
      setDataReviewCurrentBatchIdx(0);
      setBiomarkerBatches([]);

      localStorage.setItem('approved_data_review_batches', '{}');
      localStorage.setItem('batch_analysis_results', '{}');
      localStorage.setItem('approved_agent1_batches', '{}');
      localStorage.setItem('agent1_batch_results', '{}');
      localStorage.removeItem('biomarker_batches_custom');

      try {
        const uId = profile?.email?.toLowerCase().replace(/[^a-z0-9]/g, '_') || 'guest';
        localStorage.removeItem(`datareview_custom_batch_keys_${uId}`);
        localStorage.removeItem(`agent1_custom_batch_keys_${uId}`);
      } catch (e) {}

      if (onUpdateProfile && profile) {
        onUpdateProfile({
          ...profile,
          approved_data_review_batches: {},
          approved_agent1_batches: {}
        });
      }

      if (onChangeBatchSize) onChangeBatchSize(parseInt(batchSizeInput) || 20);
  };

  const [excludeStandardized, setExcludeStandardized] = useState<boolean>(() => {
    return localStorage.getItem('agent1_exclude_standardized') === 'true';
  });

  const clearCustomBatchResults = () => {
    setApprovedAgent1Batches(prev => {
      const updated = { ...prev };
      delete updated['custom'];
      localStorage.setItem('approved_agent1_batches', JSON.stringify(updated));
      return updated;
    });
    setAgent1BatchResults(prev => {
      const updated = { ...prev };
      delete updated['custom'];
      localStorage.setItem('agent1_batch_results', JSON.stringify(updated));
      return updated;
    });
    try {
      sessionStorage.removeItem('chat_messages_medical_agent1_custom');
      sessionStorage.removeItem('last_sent_payload_medical_agent1_custom');
    } catch (err) {}
  };

  // Batch keys and splitting
  const markerKeys = React.useMemo(() => {
    // Derive all known keys from history, not from the flat biomarkers dict
    const allKnownKeys = new Set<string>();
    (activeHistory || []).forEach((h: any) => {
      if (h.biomarkers) {
        Object.keys(h.biomarkers).forEach(k => {
          if (h.biomarkers[k] !== undefined && h.biomarkers[k] !== null && h.biomarkers[k] !== '') {
            allKnownKeys.add(k);
          }
        });
      }
    });

    // Fallback to flat dict if some keys exist only there
    if (biomarkers) {
      Object.keys(biomarkers).forEach(k => {
        if (biomarkers[k] !== undefined && biomarkers[k] !== null && biomarkers[k] !== '') {
          allKnownKeys.add(k);
        }
      });
    }

    return Array.from(allKnownKeys).sort((a, b) => a.localeCompare(b));
  }, [activeHistory, biomarkers]);

  const [selectedMissingKeysToMove, setSelectedMissingKeysToMove] = React.useState<Record<number, string[]>>({});

  const batches = biomarkerBatches;

  React.useEffect(() => {
    if (onDataReviewStateChange) {
      onDataReviewStateChange({
        batches: biomarkerBatches,
        approvedBatches,
        setApprovedBatches,
        batchAnalysisResults,
        setBatchAnalysisResults,
        isAnalyzingBatch,
        dataReviewCurrentBatchIdx,
        setDataReviewCurrentBatchIdx,
        handleResetBatches,
        customDataReviewBatchKeys,
        setCustomDataReviewBatchKeys,
        setShowCustomDataReviewBatchModal,
        onOpenDictionary: (key: string) => {
          setDictionaryPreFillKey(key);
          setShowDictionaryModal(true);
        },
        handleApproveBatchStep2
      });
    }
  }, [
    biomarkerBatches,
    approvedBatches,
    batchAnalysisResults,
    isAnalyzingBatch,
    dataReviewCurrentBatchIdx,
    customDataReviewBatchKeys,
    onDataReviewStateChange
  ]);

  React.useEffect(() => {
    localStorage.setItem('biomarker_batch_size', String(batchSize || 20));
  }, [batchSize]);

  React.useEffect(() => {
    const activeKeys = [...markerKeys];
    if (activeKeys.length === 0) {
      if (biomarkerBatches.length > 0) {
        setBiomarkerBatches([]);
        localStorage.setItem('biomarker_batches_custom', JSON.stringify([]));
      }
      return;
    }

    let currentBatches: string[][] = [];
    try {
      const saved = localStorage.getItem('biomarker_batches_custom');
      if (saved) currentBatches = JSON.parse(saved);
    } catch (e) {}

    currentBatches = currentBatches.map(batch => 
      batch.filter(key => activeKeys.includes(key))
    );

    // Keep completed batches exactly as they are. Re-chunk all uncompleted batches and any missing keys.
    const preservedBatches: string[][] = [];
    const keysToRechunk: string[] = [];

    currentBatches.forEach((batch, idx) => {
      const isApprovedStep2 = approvedAgent1Batches[idx];
      const hasResultStep2 = agent1BatchResults[idx];
      const isApprovedStep3 = approvedBatches[idx];
      const hasResultStep3 = batchAnalysisResults[idx];
      const isCompleted = isApprovedStep2 || hasResultStep2 || isApprovedStep3 || hasResultStep3;

      if (isCompleted) {
        preservedBatches.push(batch);
      } else {
        batch.forEach(key => {
          if (!keysToRechunk.includes(key)) {
            keysToRechunk.push(key);
          }
        });
      }
    });

    // Gather any active keys not present in any batch
    const keysInBatches = new Set([
      ...preservedBatches.flat(),
      ...keysToRechunk
    ]);
    const missingKeys = activeKeys.filter(k => !keysInBatches.has(k));
    missingKeys.forEach(key => {
      if (!keysToRechunk.includes(key)) {
        keysToRechunk.push(key);
      }
    });

    // Re-chunk the keysToRechunk into optimal chunks of size batchSize
    const size = batchSize || 20;
    let finalBatches = [...preservedBatches];

    if (keysToRechunk.length > 0) {
      for (let i = 0; i < keysToRechunk.length; i += size) {
        finalBatches.push(keysToRechunk.slice(i, i + size));
      }
    }

    // Fallback if we have absolutely empty batches but have active keys
    if (finalBatches.length === 0 && activeKeys.length > 0) {
      for (let i = 0; i < activeKeys.length; i += size) {
        finalBatches.push(activeKeys.slice(i, i + size));
      }
    }

    localStorage.setItem('biomarker_batch_size_last', String(batchSize || 20));

    // Filter out absolutely any empty batch to completely avoid empty batches and shift indices of associated metadata
    const nonEmptyBatches: string[][] = [];
    const indexMapping: Record<number, number> = {};

    finalBatches.forEach((batch, oldIdx) => {
      if (batch.length > 0) {
        const newIdx = nonEmptyBatches.length;
        indexMapping[newIdx] = oldIdx;
        nonEmptyBatches.push(batch);
      }
    });

    let indicesShifted = false;
    const nextApprovedBatches: Record<string, boolean> = {};
    const nextBatchAnalysisResults: Record<string, any> = {};
    const nextApprovedAgent1Batches: Record<string, boolean> = {};
    const nextAgent1BatchResults: Record<string, any> = {};

    nonEmptyBatches.forEach((batch, newIdx) => {
      const oldIdx = indexMapping[newIdx];
      if (oldIdx !== undefined) {
        if (oldIdx !== newIdx) {
          indicesShifted = true;
        }
        if (approvedBatches[oldIdx] !== undefined) nextApprovedBatches[newIdx] = approvedBatches[oldIdx];
        if (batchAnalysisResults[oldIdx] !== undefined) nextBatchAnalysisResults[newIdx] = batchAnalysisResults[oldIdx];
        if (approvedAgent1Batches[oldIdx] !== undefined) nextApprovedAgent1Batches[newIdx] = approvedAgent1Batches[oldIdx];
        if (agent1BatchResults[oldIdx] !== undefined) nextAgent1BatchResults[newIdx] = agent1BatchResults[oldIdx];
      }
    });

    // Also preserve non-numeric keys like 'custom' if they exist in the record
    Object.keys(approvedBatches).forEach(k => {
      if (isNaN(Number(k))) nextApprovedBatches[k] = approvedBatches[k];
    });
    Object.keys(batchAnalysisResults).forEach(k => {
      if (isNaN(Number(k))) nextBatchAnalysisResults[k] = batchAnalysisResults[k];
    });
    Object.keys(approvedAgent1Batches).forEach(k => {
      if (isNaN(Number(k))) nextApprovedAgent1Batches[k] = approvedAgent1Batches[k];
    });
    Object.keys(agent1BatchResults).forEach(k => {
      if (isNaN(Number(k))) nextAgent1BatchResults[k] = agent1BatchResults[k];
    });

    if (indicesShifted) {
      setApprovedBatches(nextApprovedBatches);
      localStorage.setItem('approved_data_review_batches', JSON.stringify(nextApprovedBatches));

      setBatchAnalysisResults(nextBatchAnalysisResults);
      localStorage.setItem('batch_analysis_results', JSON.stringify(nextBatchAnalysisResults));

      setApprovedAgent1Batches(nextApprovedAgent1Batches);
      localStorage.setItem('approved_agent1_batches', JSON.stringify(nextApprovedAgent1Batches));

      setAgent1BatchResults(nextAgent1BatchResults);
      localStorage.setItem('agent1_batch_results', JSON.stringify(nextAgent1BatchResults));
    }

    currentBatches = nonEmptyBatches;

    const currentStr = JSON.stringify(currentBatches);
    const stateStr = JSON.stringify(biomarkerBatches);
    if (currentStr !== stateStr) {
      setBiomarkerBatches(currentBatches);
      localStorage.setItem('biomarker_batches_custom', JSON.stringify(currentBatches));
    }
  }, [markerKeys, batchSize, approvedBatches, batchAnalysisResults, approvedAgent1Batches, agent1BatchResults]);


  React.useEffect(() => {
    const interval = setInterval(() => {
      const checkAndSet = (key, setter) => {
        try {
          const saved = localStorage.getItem(key);
          if (saved) {
            setter(prev => {
              if (JSON.stringify(prev) !== saved) {
                return JSON.parse(saved);
              }
              return prev;
            });
          }
        } catch (e) {}
      };

      checkAndSet('agent1_batch_results', setAgent1BatchResults);
      checkAndSet('approved_agent1_batches', setApprovedAgent1Batches);
      checkAndSet('batch_analysis_results', setBatchAnalysisResults);
      checkAndSet('approved_data_review_batches', setApprovedBatches);
    }, 1500);
    return () => clearInterval(interval);
  }, []);

  React.useEffect(() => {
    const checkAndSet = (key, setter) => {
      try {
        const saved = localStorage.getItem(key);
        if (saved) {
          setter(prev => {
            if (JSON.stringify(prev) !== saved) {
              return JSON.parse(saved);
            }
            return prev;
          });
        }
      } catch (e) {}
    };
    checkAndSet('agent1_batch_results', setAgent1BatchResults);
    checkAndSet('approved_agent1_batches', setApprovedAgent1Batches);
    checkAndSet('batch_analysis_results', setBatchAnalysisResults);
    checkAndSet('approved_data_review_batches', setApprovedBatches);
  }, [profile, calibratingBatchIdx]);

  const handleMoveMissingBiomarkers = (bIdx: number | string, missingKeysToMove: string[]) => {
    if (!missingKeysToMove || missingKeysToMove.length === 0) return;

    let currentBatches = [...biomarkerBatches];
    const numericIdx = typeof bIdx === 'number' ? bIdx : parseInt(String(bIdx), 10) || 0;

    missingKeysToMove.forEach(key => {
      // 1. Remove from current batch
      if (currentBatches[numericIdx]) {
        currentBatches[numericIdx] = currentBatches[numericIdx].filter(k => k !== key);
      }

      // 2. Find the first subsequent unapproved & uncalibrated batch with space
      let placed = false;
      const size = batchSize || 20;

      for (let i = numericIdx + 1; i < currentBatches.length; i++) {
        const isApproved = approvedBatches[i];
        const hasResult = batchAnalysisResults[i];
        const batchKeys = currentBatches[i];

        if (!isApproved && !hasResult && batchKeys.length < size) {
          batchKeys.push(key);
          placed = true;
          break;
        }
      }

      if (!placed) {
        // Find any subsequent unapproved & uncalibrated batch (even if full), and append it
        for (let i = numericIdx + 1; i < currentBatches.length; i++) {
          const isApproved = approvedBatches[i];
          const hasResult = batchAnalysisResults[i];
          const batchKeys = currentBatches[i];

          if (!isApproved && !hasResult) {
            batchKeys.push(key);
            placed = true;
            break;
          }
        }
      }

      if (!placed) {
        // If there's no unapproved & uncalibrated subsequent batch, create a new batch at the end!
        currentBatches.push([key]);
      }
    });

    // Clean up empty batches
    currentBatches = currentBatches.filter((batch, idx) => 
      batch.length > 0 || idx === 0 || approvedBatches[idx] || batchAnalysisResults[idx]
    );

    // Save batches to state and localStorage
    setBiomarkerBatches(currentBatches);
    localStorage.setItem('biomarker_batches_custom', JSON.stringify(currentBatches));
  };

  // Biomarkers grouped dynamically by risk categories
  const groupedBiomarkers = React.useMemo<Record<string, Array<{ key: string; name: string; present: boolean }>>>(() => {
    const groups: Record<string, Array<{ key: string; name: string; present: boolean }>> = {};

    const isPresent = (key: string) => {
      const inBiomarkers = biomarkers[key] !== undefined && biomarkers[key] !== null && biomarkers[key] !== '';
      const inHistory = activeHistory?.some(h => h.biomarkers && h.biomarkers[key] !== undefined) || false;
      return inBiomarkers || inHistory;
    };

    // Gather standard ones
    biomarkerDefinitions.forEach(def => {
      const present = isPresent(def.key);
      const customDef = profile?.customBiomarkers?.[def.key] as any;
      let risks = (customDef && customDef.riskCategories) ? customDef.riskCategories : (def.riskCategories || ['Uncategorized']);
      if (!Array.isArray(risks)) risks = [risks];
      if (risks.length === 0) risks = ['Uncategorized'];
      risks.forEach((cat: string) => {
        if (!groups[cat]) groups[cat] = [];
        if (!groups[cat].some(item => item.key === def.key)) {
          groups[cat].push({ key: def.key, name: customDef?.name || def.name, present });
        }
      });
    });

    // Custom/User ones in profile
    if (profile?.customBiomarkers) {
      Object.entries(profile.customBiomarkers).forEach(([key, def]) => {
        if (!def) return;
        // Skip if it's already a standard biomarker (handled above)
        if (biomarkerDefinitions.some(d => d.key === key)) return;
        
        const present = isPresent(key);
        let risks = (def as any).riskCategories || ['Uncategorized'];
        if (!Array.isArray(risks)) risks = [risks];
        if (risks.length === 0) risks = ['Uncategorized'];
        risks.forEach((cat: string) => {
          if (!groups[cat]) groups[cat] = [];
          if (!groups[cat].some(item => item.key === key)) {
            groups[cat].push({ key, name: (def as any).name, present });
          }
        });
      });
    }

    return groups;
  }, [profile, biomarkers, activeHistory]);

  const toggleAgentHistory = (agentType: string) => {
    setExpandedAgentHistory(prev => ({ ...prev, [agentType]: !prev[agentType] }));
  };

  const handleApproveBatchStep1 = async (bIdx: string | number, result: any) => {
    setIsApplying(true);
    try {
      // Parse the cleaned YAML
      const jsonText = result ? (result.filledRows || result.extractedData || result) : '';
    let parsedRows: any[] = [];
    if (typeof jsonText === 'string' && jsonText.trim() !== '') {
      try {
        const cleanText = jsonText.replace(/```(?:json)?/gi, '').trim();
        const parsed = JSON.parse(cleanText);
        parsedRows = Array.isArray(parsed) ? parsed : (parsed?.biomarkers || []);
      } catch (e) {
        console.error("Failed to parse approved agent1 YAML", e);
      }
    } else if (Array.isArray(jsonText)) {
      parsedRows = jsonText;
    }

    // Save customBiomarkers to user profile and history
    const updatedCustoms = { ...(profile.customBiomarkers || {}) };
    let currentHistory = activeHistory ? activeHistory.map((h: any) => ({
      ...h,
      biomarkers: { ...h.biomarkers }
    })) : [];

    // 1. Identify which unstandardized raw keys were mapped to what standardized keys and migrate/delete
    if (result?.batchBiomarkers && Array.isArray(result.batchBiomarkers)) {
      result.batchBiomarkers.forEach((raw: any) => {
        const rawKey = raw.key;
        if (!rawKey) return;

        // Find best matched parsed row in the parsedRows output
        let bestParsedIdx = -1;
        parsedRows.forEach((parsed: any, idx: number) => {
          if (parsed.originalName) {
            const cleanRawName = raw.name.toLowerCase().replace(/[^a-z0-9]/g, '');
            const cleanParsedOrigName = parsed.originalName.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (cleanRawName === cleanParsedOrigName || parsed.originalName === raw.name) {
              bestParsedIdx = idx;
            }
          }
        });

        if (bestParsedIdx !== -1) {
          const matched = parsedRows[bestParsedIdx];
          const stdKey = (matched.key || matched.biomarker || matched.standardizedName || matched.name || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
          if (stdKey && rawKey !== stdKey) {
            // Migrate existing values from rawKey to stdKey across all historical logs, then delete rawKey
            currentHistory.forEach((log: any) => {
              if (log.biomarkers && log.biomarkers[rawKey] !== undefined) {
                const valueToMigrate = log.biomarkers[rawKey];
                log.biomarkers[stdKey] = valueToMigrate;
                delete log.biomarkers[rawKey];
              }
            });

            // Delete from customBiomarkers list
            delete updatedCustoms[rawKey];
          }
        } else {
          // Completely unmapped/deleted raw item: delete from all historical logs and custom definitions
          currentHistory.forEach((log: any) => {
            if (log.biomarkers && log.biomarkers[rawKey] !== undefined) {
              delete log.biomarkers[rawKey];
            }
          });
          delete updatedCustoms[rawKey];
        }
      });
    }

    // 2. Apply newly cleaned/standardized readings from parsedRows
    parsedRows.forEach((row: any) => {
      const rawKey = row.key || (row.name || row.biomarker || row.standardizedName || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
      if (!rawKey) return;
      // Canonicalize against the existing biomarker dictionary so a lab-report re-parse
      // that names the same measurement differently (e.g. "mean_corpuscular_hb_conc_g_l"
      // vs "mchc") writes to the SAME key instead of creating a look-alike duplicate.
      const key = getMappedBiomarkerKey(rawKey) || rawKey;

      const name = row.name || row.biomarker || row.standardizedName || 'Unknown';
      const unit = row.metric || row.unit || '';

      // Skip biomarkers flagged "Not Used" by the user (in either store) — never create a definition or log entry for them
      const kLower = String(key).toLowerCase();
      const nameKey = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      const checkNotUsedMap = (m: any): boolean => !!m && (!!m[key] || !!m[nameKey] || Object.keys(m).some(nok => nok.toLowerCase() === kLower));
      if (checkNotUsedMap(profile?.notUsedBiomarkers) || checkNotUsedMap(profile?.notUsedInMedicalHistory)) return;

      // Update customBiomarker definition
      const existing: any = updatedCustoms[key] || {};
      updatedCustoms[key] = {
        ...existing,
        name,
        unit,
        riskCategories: (existing.riskCategories && existing.riskCategories.length > 0) ? existing.riskCategories : (row.riskCategories || []),
        standardMedicalGrouping: (existing.standardMedicalGrouping && existing.standardMedicalGrouping !== 'Other') ? existing.standardMedicalGrouping : (row.standardMedicalGrouping || 'Other'),
        potentialMedicalConditions: row.potentialMedicalConditions || existing.potentialMedicalConditions || []
      } as any;

      // Extract and write the actual numeric or qualitative reading value to currentHistory
      const rawVal = row.numeric_value !== undefined && row.numeric_value !== null && row.numeric_value !== ''
        ? row.numeric_value
        : (row.value !== undefined ? row.value : row.qualitative_value);
      
      const entryDate = row.date || new Date().toISOString().split('T')[0];
      const standardDate = String(entryDate).split('T')[0].trim();

      if (rawVal !== undefined && rawVal !== null && rawVal !== '') {
        const valNum = Number(rawVal);
        const finalValue = isNaN(valNum) ? rawVal : valNum;

        let existingLogIndex = currentHistory.findIndex((h: any) => {
          if (!h.date) return false;
          return String(h.date).split('T')[0].trim() === standardDate;
        });

        if (existingLogIndex >= 0) {
          currentHistory[existingLogIndex].biomarkers[key] = finalValue;
        } else {
          currentHistory.push({
            id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
            date: standardDate,
            biomarkers: { [key]: finalValue },
            note: "Extracted by Clinical Data Parser"
          });
        }
      }
    });

    // 3. Add unmappedTests to customBiomarkers with needsApproval = true
    if (result?.unmappedTests && Array.isArray(result.unmappedTests)) {
      result.unmappedTests.forEach((test: any) => {
        const raw_name = test?.raw_name || (typeof test === 'string' ? test : '');
        if (!raw_name) return;
        const suggested_key = test?.suggested_key || raw_name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        const mapped = getMappedBiomarkerKey(suggested_key) || suggested_key;
        if (isCatalogBuiltIn(mapped)) return;
        if (!updatedCustoms[mapped] && shouldStampExtractedDefPending(mapped, updatedCustoms[mapped])) {
          updatedCustoms[mapped] = {
            name: raw_name,
            unit: '',
            normalRange: '',
            description: '',
            standardMedicalGrouping: 'By Medical Practice',
            needsApproval: true
          };
        }
      });
    }

    currentHistory.sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));

    // Recompute biomarkers list
    const recomputedBiomarkers: { [key: string]: number | string } = {};
    [...currentHistory].sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date))).forEach(log => {
      Object.entries(log.biomarkers).forEach(([k, v]) => {
        recomputedBiomarkers[k] = v as string | number;
      });
    });

    const updatedProfile = {
      ...profile,
      customBiomarkers: updatedCustoms
    };

    if (onUpdateProfile) {
      await onUpdateProfile(updatedProfile);
    }
    if (onUpdateHistory) {
      await onUpdateHistory(currentHistory, recomputedBiomarkers, updatedProfile);
    }

      // Mark as approved
      setApprovedAgent1Batches(prev => {
        const updated = { ...prev, [bIdx]: true };
        localStorage.setItem('approved_agent1_batches', JSON.stringify(updated));
        return updated;
      });
    } finally {
      setIsApplying(false);
    }
  };

  const handleApproveBatchStep2 = async (bIdx: number | string, result: any, unselectedKeys?: string[]) => {
    setIsApplying(true);
    try {
      // Save customBiomarkers to user profile
      const updatedCustoms = { ...(profile.customBiomarkers || {}) };
    const currentHistory = JSON.parse(JSON.stringify(biomarkerHistory || []));
    
    result.reviewedBiomarkers?.forEach((bm: any) => {
      if (unselectedKeys && unselectedKeys.includes(bm.key)) return;
      const existing: any = updatedCustoms[bm.key] || {};
      const optVal = formatOptimalTargetValue(bm);

      updatedCustoms[bm.key] = {
        ...existing,
        name: bm.name || existing.name,
        unit: existing.unit || bm.unit || '',
        optimalValue: optVal,
        normalRange: existing.normalRange || '',
        profileAdjustedNormalRange: bm.profileAdjustedNormalRange || existing.profileAdjustedNormalRange || '',
        description: bm.description || existing.description || '',
        riskCategories: (existing.riskCategories && existing.riskCategories.length > 0) ? existing.riskCategories : (bm.riskCategories || []),
        standardMedicalGrouping: (existing.standardMedicalGrouping && existing.standardMedicalGrouping !== 'Other') ? existing.standardMedicalGrouping : (bm.standardMedicalGrouping || 'Other'),
        potentialMedicalConditions: bm.potentialMedicalConditions || existing.potentialMedicalConditions || [],
        specificRiskContext: bm.specificRiskContext || existing.specificRiskContext || '',
        status: bm.status || existing.status || 'Healthy',
        rangeBrackets: bm.rangeBrackets || existing.rangeBrackets || [],
      } as any;
    });

    const updatedProfile = {
      ...profile,
      customBiomarkers: updatedCustoms
    };

    // Overlay only — do not rewrite observation numbers from Range Calibrator.

    // Recompute biomarkers list
    const recomputedBiomarkers: { [key: string]: number | string } = {};
    [...currentHistory]
      .filter((b: any) => b.sync_state !== 'delete' && !(profile?.deletedBiomarkerLogIds?.[b.id] && (profile?.deletedBiomarkerLogIds?.[b.id] || 0) >= (b.updated_at || 0)))
      .sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date)))
      .forEach((log: any) => {
        Object.entries(log.biomarkers).forEach(([k, v]) => {
          recomputedBiomarkers[k] = v as string | number;
        });
      });

    if (onUpdateProfile) {
      await onUpdateProfile(updatedProfile);
    }
    if (onUpdateHistory) {
      await onUpdateHistory(currentHistory, recomputedBiomarkers, updatedProfile);
    }

    // Move missing biomarkers to future batches if selected
    const keysToMove = selectedMissingKeysToMove[bIdx] || [];
    if (keysToMove.length > 0) {
      handleMoveMissingBiomarkers(bIdx, keysToMove);
    }

      // Mark as approved
      setApprovedBatches(prev => {
        const updated = { ...prev, [bIdx]: true };
        localStorage.setItem('approved_data_review_batches', JSON.stringify(updated));
        return updated;
      });
    } finally {
      setIsApplying(false);
    }
  };

  const handleApproveExtractionAnalysis = async (analysis: any, unselectedKeys: string[] = []) => {
    if (!analysis) return;
    setIsApplying(true);
    try {
      const res = analysis.result || {};
      const extractedRows = Array.isArray(res.filledRows) ? res.filledRows : (Array.isArray(res.extractedData) ? res.extractedData : (Array.isArray(res.biomarkers) ? res.biomarkers : []));
      
      const selectedRows = extractedRows.filter((row: any) => {
        const key = row.standard_key || row.key || row.biomarker || row.name;
        return !unselectedKeys.includes(key);
      });

      if (selectedRows.length > 0) {
        const currentHistory = JSON.parse(JSON.stringify(biomarkerHistory || []));
        const updatedCustoms = { ...(profile.customBiomarkers || {}) };
        const dateMap: { [dateStr: string]: { [key: string]: number | string } } = {};

        selectedRows.forEach((row: any) => {
          const key = row.standard_key || row.key || row.biomarker;
          const val = row.numeric_value ?? row.value ?? row.qualitative_value;
          if (key && val !== undefined && val !== null) {
            const rDate = row.date || new Date().toISOString().split('T')[0];
            if (!dateMap[rDate]) dateMap[rDate] = {};
            dateMap[rDate][key] = val;

            if (!updatedCustoms[key]) {
              updatedCustoms[key] = {
                name: row.display_name || row.name || row.biomarker || key,
                unit: row.unit || '',
                normalRange: row.reference_range || row.normalRange || '',
                description: row.description || '',
                standardMedicalGrouping: row.category || 'By Medical Practice'
              };
            }
          }
        });

        Object.entries(dateMap).forEach(([dStr, bObj]) => {
          const existingEntry = currentHistory.find((h: any) => h.date === dStr);
          if (existingEntry) {
            existingEntry.biomarkers = {
              ...(existingEntry.biomarkers || {}),
              ...bObj
            };
            existingEntry.updated_at = Date.now();
          } else {
            currentHistory.push({
              id: 'log_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
              date: dStr,
              biomarkers: bObj,
              created_at: Date.now(),
              updated_at: Date.now(),
              sync_state: 'synced'
            });
          }
        });

        currentHistory.sort((a: any, b: any) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));

        const recomputedBiomarkers: { [key: string]: number | string } = {};
        [...currentHistory].sort((a: any, b: any) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date))).forEach((log: any) => {
          Object.entries(log.biomarkers || {}).forEach(([k, v]) => {
            recomputedBiomarkers[k] = v as string | number;
          });
        });

        const updatedProfile = {
          ...profile,
          customBiomarkers: updatedCustoms
        };

        if (onUpdateProfile) {
          await onUpdateProfile(updatedProfile);
        }
        if (onUpdateHistory) {
          await onUpdateHistory(currentHistory, recomputedBiomarkers, updatedProfile);
        }
      }

      setApprovedSteps(prev => {
        const updated = { ...prev, agent1: true };
        localStorage.setItem('approvedSteps', JSON.stringify(updated));
        return updated;
      });

      if (analysis.id) {
        setApprovedAnalysisId('agent1', analysis.id);
      }

      if (onAgentAnalysisSaved) {
        await onAgentAnalysisSaved('agent1', res, analysis.id);
      }
    } catch (err) {
      console.error("Failed to approve extraction analysis:", err);
    } finally {
      setIsApplying(false);
    }
  };

  const handleRefineDataCleaning = () => {
    // 1. Set excludeStandardized to true to hide already standardized biomarkers
    setExcludeStandardized(true);
    localStorage.setItem('agent1_exclude_standardized', 'true');

    // 2. Reset approved agent 1 batches
    setApprovedAgent1Batches({});
    localStorage.removeItem('approved_agent1_batches');

    // 3. Clear agent 1 batch results
    setAgent1BatchResults({});
    localStorage.removeItem('agent1_batch_results');
    localStorage.removeItem('agent1_original_report_text');

    // 4. Clear session storage chat messages & payloads for all agent1 batches
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && (key.includes('chat_messages_medical_agent1') || key.includes('last_sent_payload_medical_agent1'))) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(k => sessionStorage.removeItem(k));
    } catch (e) {
      console.warn("Failed to clear session storage during refine:", e);
    }
    
    // Also clear custom batch and report text cache
    setCustomBatchKeys([]);
    localStorage.removeItem(`agent1_custom_batch_keys_${userIdentifier}`);
    localStorage.removeItem('agent1_original_report_text');
  };

  const renderAgentHistory = (agentType: string) => {
    const history = (profile.agentAnalyses || [])
      .filter(a => a.agentType === agentType)
      .sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));
    
    // Exclude the currently displayed active one
    const isDataAccuracy = agentType === 'data_accuracy';
    const latestActive = isDataAccuracy ? null : history.filter(a => !a.archived)[0];
    const prevAnalyses = isDataAccuracy ? history : history.filter(a => a.id !== latestActive?.id);
    
    if (prevAnalyses.length === 0) return null;
    
    const isExpanded = expandedAgentHistory[agentType] ?? false;
    const latestPrev = prevAnalyses[0];
    
    const dateObj = new Date(latestPrev.date);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - dateObj.getTime());
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    const timeStr = diffDays > 0 ? `${diffDays} days ago` : 'today';

    return (
      <div className="mt-3">
        <button 
          onClick={() => toggleAgentHistory(agentType)}
          className="text-[11px] text-theme-text-secondary font-medium flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-200 transition-colors cursor-pointer"
        >
          {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          Last analysis on {dateObj.toLocaleDateString()} ({timeStr})
        </button>
        {isExpanded && (
          <div className="mt-2 space-y-2">
            {prevAnalyses.map(item => (
              <div key={item.id} className="p-3 bg-slate-50 dark:bg-slate-800/40 border border-theme-border rounded-xl relative group">
                <p className="text-[10px] font-bold text-slate-400 mb-1">{new Date(item.date).toLocaleString()}</p>
                {['agent1', 'agent2', 'agent3', 'agent4', 'medical_extract'].includes(agentType) && item.result ? (
                  <div className="mt-2">
                    <AgentResultTable
                      agentType={agentType as any}
                      agentResult={item.result}
                      profile={profile}
                      biomarkerHistory={activeHistory || []}
                      initialRawText=""
                      isApplying={isApplying}
                    />
                  </div>
                ) : agentType === 'health_baseline' ? (
                  <div className="mt-2">
                    <HealthBaselineCard
                      msg={{ id: 'mock', role: 'assistant', content: '', agentType: 'health_baseline', data: { agentResult: item.result } } as any}
                      idx={0}
                      messages={[]}
                      t={(key: string) => key}
                      formatNutrientValue={(val: number) => String(val)}
                      onLogFood={async () => {}}
                      onLogFoodIdeas={async () => {}}
                    />
                  </div>
                ) : ['agent5', 'agent7'].includes(agentType) ? (
                  <div className="mt-2">
                    <GenericAgentResultView rawResult={item.result} />
                  </div>
                ) : agentType === 'data_accuracy' ? (
                  <div className="mt-2 space-y-2 text-xs text-left">
                    <div className="bg-theme-bg-card border border-theme-border p-2.5 rounded-lg">
                      <p className="font-semibold text-theme-text-secondary">User Input:</p>
                      <p className="text-slate-800 dark:text-slate-200 mt-1 italic whitespace-pre-wrap">"{item.result?.inputText}"</p>
                    </div>
                    <div className="bg-indigo-50/50 dark:bg-indigo-950/15 border border-indigo-100/50 dark:border-indigo-900/30 p-2.5 rounded-lg text-theme-neutral leading-relaxed whitespace-pre-wrap">
                      <p className="font-semibold text-indigo-800 dark:text-indigo-400 mb-1">Agent Explanation:</p>
                      {item.result?.explanation}
                    </div>
                  </div>
                ) : (
                  <div className={`text-[10px] text-theme-neutral font-mono overflow-auto ${agentType === 'agent1' ? 'max-h-96' : 'max-h-32'}`}>
                    <pre>{typeof item.result === 'string' ? item.result : (() => { try { return JSON.stringify(item.result, null, 2); } catch (e) { return String(item.result); } })()}</pre>
                  </div>
                )}
                {onDeleteAnalysis && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onDeleteAnalysis(item.id); }}
                    className="absolute top-2 right-2 p-1.5 text-slate-400 hover:text-red-500 transition-opacity cursor-pointer bg-theme-bg-card rounded-lg shadow-sm border border-theme-border"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const handleRefine = () => {
    if (!refinementText.trim() || isGenerating) return;
    const userMessage = { role: "user", text: refinementText };
    const aiMessage = { role: "ai", text: JSON.stringify(draftReport) };
    const updatedHistory = [...chatHistory, aiMessage, userMessage];
    setChatHistory(updatedHistory);
    // @ts-ignore - we updated the signature in App.tsx but interface might not match exactly, so casting
    (onGenerateReport as any)(selectedModelId, { message: refinementText, chatHistory: updatedHistory });
    setRefinementText("");
  };

  const missingProfilePoints: string[] = [];
  if (profile.age === undefined || profile.age === null || String(profile.age).trim() === '') missingProfilePoints.push(t.age);
  if (profile.ethnicity === undefined || profile.ethnicity === null || String(profile.ethnicity).trim() === '' || String(profile.ethnicity).toLowerCase() === 'unknown') missingProfilePoints.push(t.ethnicity);
  if (profile.weight === undefined || profile.weight === null || String(profile.weight).trim() === '') missingProfilePoints.push(t.weight);
  if (profile.height === undefined || profile.height === null || String(profile.height).trim() === '') missingProfilePoints.push(t.height);

  const hasProfileInfo = missingProfilePoints.length === 0;

  // Verify missing data points above the button
   // Determine if basic demographics are present
  const criticalMissing = [
    { name: t.age, present: !!profile?.age },
    { name: t.ethnicity, present: !!profile?.ethnicity && String(profile.ethnicity).toLowerCase() !== 'unknown' },
    { name: t.weight, present: !!profile?.weight },
    { name: t.height, present: !!profile?.height }
  ].filter(p => !p.present);

  const getMissingNote = () => {
    if (criticalMissing.length === 0) return "";
    const missingNames = criticalMissing.map(p => p.name).join(", ");
    return interpolate(t.pleaseAddProfileFields, { names: missingNames });
  };

  const steps = [
    {
      id: 'add_health_data',
      title: t.stepAddHealthDataTitle,
      agentType: null,
      description: t.stepAddHealthDataDesc,
      valueProposition: t.stepAddHealthDataValue
    },
    {
      id: 'agent1',
      title: t.stepLabParserTitle,
      agentType: 'agent1',
      description: t.stepLabParserDesc,
      valueProposition: t.stepLabParserValue
    },
    {
      id: 'data_review',
      title: t.stepRangeCalibratorTitle,
      agentType: 'data_review',
      description: t.stepRangeCalibratorDesc,
      valueProposition: t.stepRangeCalibratorValue
    },
    {
      id: 'health_baseline',
      title: t.healthCoach,
      agentType: 'health_baseline',
      description: t.stepHealthCoachDesc,
      valueProposition: t.stepHealthCoachValue
    },
    {
      id: 'agent4',
      title: t.stepTestPlannerTitle,
      agentType: 'agent4',
      description: t.stepTestPlannerDesc,
      valueProposition: t.stepTestPlannerValue
    },
    {
      id: 'agent7',
      title: t.stepLiteratureTitle,
      agentType: 'agent7',
      description: t.stepLiteratureDesc,
      valueProposition: t.stepLiteratureValue
    }
  ];

  const getStepStatus = (index: number): 'Not ready' | 'To do' | 'To review' | 'Done' => {
    const step = steps[index];
    if (!step) return 'Not ready';

    if (index === 0) {
      const isDone = criticalMissing.length === 0;
      return isDone ? 'Done' : 'To do';
    }

    if (step.id === 'agent1') {
      if (batches.length === 0) return 'To do';
      const allApproved = batches.every((_, bIdx) => approvedAgent1Batches[bIdx]);
      if (allApproved) return 'Done';
      const hasSomeAnalysis = Object.keys(agent1BatchResults).length > 0;
      return hasSomeAnalysis ? 'To review' : 'To do';
    }

    if (step.id === 'data_review') {
      if (batches.length === 0) return 'To do';
      const allApproved = batches.every((_, bIdx) => approvedBatches[bIdx]);
      if (allApproved) return 'Done';
      const hasSomeAnalysis = Object.keys(batchAnalysisResults).length > 0;
      return hasSomeAnalysis ? 'To review' : 'To do';
    }

    // Gating check: previous required steps must be Done
    const isProjectOrInsight = step.agentType === 'agent4' || step.agentType === 'agent7';

    if (!isAdminMode || !isProjectOrInsight) {
      for (let j = 0; j < index; j++) {
        if (j === 0) {
          // Demographics are optional for gating subsequent analytical agents
          continue;
        } else {
          const prevStep = steps[j];
          if (prevStep.id === 'data_review') {
            // Do not block subsequent steps if data review is not completed
            continue;
          } else if (prevStep.id === 'agent1') {
            // Do not block if data cleaning is not done
            continue;
          } else {
            const prevAgentType = prevStep.agentType!;
            const prevApproved = approvedSteps[prevAgentType];
            if (!prevApproved) return 'Not ready';
          }
        }
      }
    }

    const agentType = step.agentType!;
    
    // Check if there's any saved analysis for this agent in history
    const history = (profile.agentAnalyses || []).filter(a => a.agentType === agentType);
    if (history.length === 0) return 'To do';

    const latestAnalysis = (profile.agentAnalyses || [])
      .filter(a => a.agentType === agentType && !a.archived)
      .sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)))[0];

    const isApproved = approvedSteps[agentType] && (!latestAnalysis || approvedAnalysisIds[agentType] === latestAnalysis.id);
    return isApproved ? 'Done' : 'To review';
  };

  const getStepSummaryText = (index: number, status: 'Not ready' | 'To do' | 'To review' | 'Done') => {
    if (index === 0) {
      if (status === 'Done') return t.demographicsComplete;
      return `${criticalMissing.length} ${t.demographicsMissing}`;
    }

    const step = steps[index];
    if (step.id === 'agent1') {
      const total = markerKeys.length;
      if (total === 0) return t.noBiomarkersLogged;
      const approvedCount = batches.filter((_, bIdx) => approvedAgent1Batches[bIdx]).length;
      return `${approvedCount} ${t.of} ${batches.length} ${t.batchesStandardized}`;
    }

    if (step.id === 'data_review') {
      const total = markerKeys.length;
      if (total === 0) return t.noBiomarkersLogged;
      const approvedCount = batches.filter((_, bIdx) => approvedBatches[bIdx]).length;
      return `${approvedCount} ${t.of} ${batches.length} ${t.batchesReviewed}`;
    }

    const latestAnalysis = (profile.agentAnalyses || [])
      .filter(a => a.agentType === step.agentType && !a.archived)
      .sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)))[0];

    if (!latestAnalysis) {
      if (status === 'Not ready') return t.waitingForPreviousSteps;
      return t.unlockedAwaitingAnalysis;
    }

    const recWord = status === 'Done' ? t.recWordApplied : t.recWordNeedReview;
    switch (step.agentType) {
      case 'agent1': {
        let count = 0;
        if (typeof latestAnalysis.result === 'string') {
          count = latestAnalysis.result.split('\n').filter(l => l.trim().startsWith('-') || l.trim().startsWith('biomarker:')).length;
        } else if (Array.isArray(latestAnalysis.result)) {
          count = latestAnalysis.result.length;
        }
        return interpolate(t.biomarkersExtractedStatus, { count: count || 5, recWord });
      }
      case 'health_baseline':
        return interpolate(t.precisionDietGenerated, { recWord });
      case 'agent4':
        return interpolate(t.tenYearTrajectoriesProjected, { recWord });
      case 'agent7':
        return interpolate(t.pubmedInsightsIntegrated, { recWord });
      default:
        return t.analysisResultsReady;
    }
  };

  const handleApproveStep = (index: number) => {
    const step = steps[index];
    if (step.id === 'agent1') {
      const updatedApproved = { ...approvedAgent1Batches };
      batches.forEach((_, bIdx) => {
        updatedApproved[bIdx] = true;
      });
      setApprovedAgent1Batches(updatedApproved);
      localStorage.setItem('approved_agent1_batches', JSON.stringify(updatedApproved));
    } else if (step.id === 'data_review') {
      const updatedApproved = { ...approvedBatches };
      batches.forEach((_, bIdx) => {
        updatedApproved[bIdx] = true;
      });
      setApprovedBatches(updatedApproved);
      localStorage.setItem('approved_data_review_batches', JSON.stringify(updatedApproved));
    } else {
      if (!step.agentType) return;
      
      // Save state
      setApprovedSteps(prev => {
        const updated = { ...prev, [step.agentType!]: true };
        localStorage.setItem('approvedSteps', JSON.stringify(updated));
        return updated;
      });
      
      const latestAnalysis = (profile.agentAnalyses || [])
        .filter(a => a.agentType === step.agentType && !a.archived)
        .sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)))[0];
      if (latestAnalysis) {
        setApprovedAnalysisId(step.agentType!, latestAnalysis.id);
        if (step.agentType === 'health_baseline' && onAgentAnalysisSaved) {
          onAgentAnalysisSaved('health_baseline', latestAnalysis.result);
        }
      }
    }
    
    // Find next open/To do step to expand
    const nextIndex = index + 1;
    if (nextIndex < steps.length) {
      setActiveStepIndex(nextIndex);
      
      // Smooth scroll to next step element
      setTimeout(() => {
        const el = document.getElementById(`accordion-step-${nextIndex}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 150);
    } else {
      setActiveStepIndex(null); // All steps completed!
    }
  };

  const handleAcceptClick = async () => {
    if (!draftReport) return;
    setIsApplying(true);
    try {
      await onAcceptReport(draftReport);
    } catch (e) {
      console.error(e);
    } finally {
      setIsApplying(false);
    }
  };

  // If a draft is generated, show the interactive review & approval screen
  if (draftReport) {
    const isSpecialUser = profile?.email?.toLowerCase() === 'chiwah.liu@gmail.com' || profile?.email?.toLowerCase() === 'cwah.liu@gmail.com';

    return (
      <div className="space-y-10 pb-40 animation-fade-in max-w-md mx-auto px-3 mt-4 font-sans text-theme-text">
        
        {/* Draft Heading Alert */}
        <div className="space-y-3 relative overflow-hidden">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-amber-500 animate-pulse" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200/20 px-2 py-0.5 rounded-full">{t.preventionDraft}</span>
          </div>
          <h2 className="text-xl font-extrabold tracking-tight font-display text-theme-text leading-tight">{t.interactiveTargetReview}</h2>
          <p className="text-xs text-theme-text-secondary leading-relaxed">
            {t.interactiveTargetReviewDesc}
          </p>
        </div>

        {/* SECTION 1: Data Taken Into Account */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 border-b border-theme-border/50 pb-3">
            <Database className="w-4 h-4 text-indigo-600" />
            <h3 className="text-sm font-bold text-theme-text font-display">{t.sourceClinicalDataAnalyzed}</h3>
          </div>
          
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-3 bg-theme-bg rounded-2xl border border-theme-border/20">
              <span className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">{t.userProfile}</span>
              <span className="font-semibold block">{profile.age}{t.yearsOldAbbrev}, {displayEthnicityOption(profile.language, profile.ethnicity) || t.unknownEthnicity}</span>
              <span className="text-[10px] text-slate-500 mt-0.5 block">{profile.weight} kg | {profile.height} cm</span>
              {(profile.gender || profile.bloodType) && (
                <span className="text-[10px] text-slate-500 block">
                  {profile.gender ? (profile.gender === 'Male' ? t.male : profile.gender === 'Female' ? t.female : profile.gender === 'Other' ? t.otherGender : profile.gender) : ''} {profile.gender && profile.bloodType ? '|' : ''} {profile.bloodType ? interpolate(t.bloodTypeValue, { type: profile.bloodType }) : ''}
                </span>
              )}
            </div>

            <div className="p-3 bg-theme-bg rounded-2xl border border-theme-border/20">
              <span className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">{t.nutritionInputs}</span>
              <span className="font-semibold block">{interpolate(t.loggedEntriesCount, { n: foodLogs.length })}</span>
              <span className="text-[10px] text-slate-500 mt-0.5 block">{t.recentEatingPatterns}</span>
            </div>
          </div>

          <div className="p-4 bg-theme-bg rounded-2xl border border-theme-border/20 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider">{t.checkedBiomarkerValues}</span>
              <span className="text-[10px] text-slate-400">{Object.keys(biomarkers).length} {t.logged}</span>
            </div>
            
            {Object.keys(biomarkers).length > 0 ? (
              <details className="group">
                <summary className="text-[11px] font-bold text-indigo-600 cursor-pointer list-none flex items-center gap-1">
                  <span>{t.viewAllUsedBiomarkers}</span>
                  <span className="transition-transform group-open:rotate-180">▼</span>
                </summary>
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2 text-center text-[11px]">
                  {Object.entries(biomarkers).map(([k, v]) => (
                    <div key={k} className="py-1 px-2 bg-theme-bg-card rounded-lg border border-slate-150 dark:border-slate-800/60 overflow-hidden">
                      <span className="block text-[9px] text-slate-400 font-semibold truncate" title={k}>{k.replace(/_/g, ' ').toUpperCase()}</span>
                      <span className="font-bold text-indigo-600 font-mono">
                        {v}
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            ) : (
              <p className="text-[11px] text-slate-500 italic">No biomarker data available. Using general population defaults.</p>
            )}
            
            {isSpecialUser && (
              <p className="text-[10px] text-slate-500 italic mt-2 leading-normal">
                🧬 East Asian genetics and specific kidney filtration rate (eGFR) profiles were fully integrated.
              </p>
            )}
          </div>
        </div>

        {/* SECTION 2: Proposed Daily Nutrient Targets */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 border-b border-theme-border/50 pb-3">
            <Activity className="w-4 h-4 text-indigo-600" />
            <h3 className="text-sm font-bold text-theme-text font-display">{t.proposedNutrientRecs}</h3>
          </div>

          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-xs py-2 px-3 bg-theme-bg rounded-xl">
              <span className="font-semibold text-slate-700 dark:text-slate-350">{t.caloriesLabel}</span>
              <span className="font-mono font-bold text-theme-text">{draftReport.dailyNutrientTargets.calories || '1,800 kcal'}</span>
            </div>
            <div className="flex items-center justify-between text-xs py-2 px-3 bg-theme-bg rounded-xl">
              <span className="font-semibold text-slate-700 dark:text-slate-350">{t.saturatedFat}</span>
              <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">{draftReport.dailyNutrientTargets.saturatedFat || 'under 15 g'}</span>
            </div>
            <div className="flex items-center justify-between text-xs py-2 px-3 bg-theme-bg rounded-xl">
              <span className="font-semibold text-slate-700 dark:text-slate-350">{t.sodiumLabel}</span>
              <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">{draftReport.dailyNutrientTargets.sodium || 'under 1,200 mg'}</span>
            </div>
            <div className="flex items-center justify-between text-xs py-2 px-3 bg-theme-bg rounded-xl">
              <span className="font-semibold text-slate-700 dark:text-slate-350">{t.protein}</span>
              <span className="font-mono font-bold text-theme-text">{draftReport.dailyNutrientTargets.protein || '90-100 g'}</span>
            </div>
            <div className="flex items-center justify-between text-xs py-2 px-3 bg-theme-bg rounded-xl">
              <span className="font-semibold text-slate-700 dark:text-slate-350">{t.solubleFibre}</span>
              <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">{draftReport.dailyNutrientTargets.solubleFibre || '10-15 g'}</span>
            </div>
          </div>
        </div>

        {/* SECTION 3: Action Plan / What Target User Should Do */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 border-b border-theme-border/50 pb-3">
            <Heart className="w-4 h-4 text-rose-500" />
            <h3 className="text-sm font-bold text-theme-text font-display">{t.preventativeActionChecklist}</h3>
          </div>

          <div className="space-y-3.5">
            {draftReport.actions.slice(0, 3).map((act, idx) => (
              <div key={idx} className="flex gap-2 text-xs">
                <div className="w-1.5 h-1.5 rounded-full bg-rose-500 mt-1.5 flex-shrink-0" />
                <div className="space-y-0.5">
                  <span className="font-bold text-theme-text block">{act.task}</span>
                  <span className="text-[10px] text-slate-500 leading-normal block">{act.explanation}</span>
                </div>
              </div>
            ))}

            <div className="border-t border-theme-border/40 my-3 pt-3" />

            <div className="space-y-2">
              <span className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">{t.recommendedHabitModifiers}</span>
              {draftReport.dailyBenefits.slice(0, 3).map((ben, idx) => (
                <div key={idx} className="flex items-center gap-2 text-xs">
                  <CheckCircle className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" />
                  <span className="font-medium text-slate-750 dark:text-slate-300">{ben.activity || (ben as any).label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* SECTION 4: Risk Forecast Comparison */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 border-b border-theme-border/50 pb-3">
            <TrendingDown className="w-4 h-4 text-rose-500" />
            <h3 className="text-sm font-bold text-theme-text font-display">{t.clinicalForecast10Year}</h3>
          </div>

          <div className="space-y-3 text-xs leading-relaxed">
            <div className="p-3 bg-rose-50/50 dark:bg-rose-950/20 border border-rose-100/40 rounded-2xl">
              <span className="text-[9px] uppercase font-bold tracking-wider text-rose-600 block mb-1">{t.ifHabitsDoNotChange}</span>
              <p className="text-rose-700 dark:text-rose-300 font-medium">{draftReport.healthRiskForecast.year10}</p>
            </div>

            <div className="p-3 bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-100/40 rounded-2xl">
              <span className="text-[9px] uppercase font-bold tracking-wider text-emerald-600 block mb-1">{t.withOptimizedTargets}</span>
              <p className="text-emerald-700 dark:text-emerald-300 font-semibold">{draftReport.healthRiskForecast.optimized10}</p>
            </div>
          </div>
        </div>

        {/* REFINEMENT CHAT PANEL */}
        <div className="border border-theme-border rounded-2xl p-3 flex items-center gap-2">
          <input 
            type="text" 
            placeholder={t.refineRecommendationPlaceholder} 
            className="flex-1 bg-transparent text-sm text-slate-800 dark:text-slate-200 focus:outline-none"
            value={refinementText}
            onChange={(e) => setRefinementText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleRefine()}
          />
          <button 
            onClick={handleRefine}
            disabled={!refinementText.trim() || isGenerating}
            className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center cursor-pointer disabled:opacity-50"
          >
            {isGenerating ? <Loader className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>

        {/* ACCEPT / REJECT BUTTONS */}
        <div className="grid grid-cols-2 gap-3 pt-2">
          <button
            onClick={onRejectReport}
            disabled={isApplying}
            className="py-3 px-4 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 rounded-2xl text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <X className="w-3.5 h-3.5" />
            {t.rejectDraft}
          </button>

          <button
            onClick={handleAcceptClick}
            disabled={isApplying}
            className="py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl text-xs font-bold transition-all shadow-md shadow-indigo-600/10 flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            {isApplying ? (
              <>
                <Loader className="w-3.5 h-3.5 animate-spin" />
                {t.applying}
              </>
            ) : (
              <>
                <Check className="w-3.5 h-3.5" />
                {t.acceptAndApply}
              </>
            )}
          </button>
        </div>

      </div>
    );
  }

  // Normal view when no draft is generated
  const completedCount = steps.map((_, idx) => idx).filter(idx => getStepStatus(idx) === 'Done').length;

  return (
    <div className="space-y-10 pb-40 animation-fade-in max-w-md mx-auto px-3 mt-4 font-sans text-theme-text">
      
      {/* Global Progress Indicator */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between text-xs font-mono font-bold text-slate-500">
          <span className="text-indigo-600 dark:text-indigo-400">{t.clinicalPipelineProgress}</span>
          <span>{completedCount} {t.of} {steps.length} {t.stepsCompleted}</span>
        </div>
        <div className="w-full bg-slate-100 dark:bg-slate-800 h-2.5 rounded-full overflow-hidden border border-slate-200/20">
          <div 
            className="bg-gradient-to-r from-indigo-500 to-indigo-600 h-full rounded-full transition-all duration-500 ease-out" 
            style={{ width: `${(completedCount / steps.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Multi-Agent Clinical Diagnostics Accordion Group */}
      
      {onOpenFrontDesk && (
        <div className="bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/50 rounded-2xl p-4 flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-100 dark:bg-indigo-900/60 rounded-xl">
              <Stethoscope className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 dark:text-slate-100 text-sm">{t.healthPrepAgent}</h3>
              <p className="text-xs text-slate-500">{t.askHealthPrepDesc}</p>
            </div>
          </div>
          <button
            onClick={onOpenFrontDesk}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all"
          >
            {t.askHealthPrep}
          </button>
        </div>
      )}

      <div id="agent-diagnostics-dashboard" className="space-y-4">
        <div className="flex items-center gap-2 pb-3 border-b border-theme-border/50">
          <Sparkles className="w-5 h-5 text-indigo-600" />
          <h3 className="font-bold text-theme-text text-sm flex items-center gap-2">
            {t.clinicalMultiAgentPipeline}
          </h3>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
          {steps.map((step, index) => {
            const status = getStepStatus(index);
            const summaryText = getStepSummaryText(index, status);
            const latestAnalysis = step.agentType 
              ? (profile.agentAnalyses || [])
                  .filter(a => a.agentType === step.agentType && !a.archived)
                  .sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)))[0]
              : null;

            return (
              <div 
                key={step.id} 
                id={`accordion-step-${index}`} 
                className={`py-4 first:pt-0 last:pb-0`}
              >
                {/* Accordion Header */}
                <div 
                  onClick={() => {
                    setActiveStepIndex(activeStepIndex === index ? null : index);
                  }}
                  className="flex items-center justify-between cursor-pointer group transition-opacity hover:opacity-95"
                >
                  <div className="flex items-center gap-3">
                    {/* Step Number Badge */}
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                      status === 'Done' 
                        ? 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400' 
                        : status === 'To review'
                        ? 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400'
                        : status === 'To do'
                        ? 'bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-400'
                    }`}>
                      {index + 1}
                    </span>
                    
                    <div className="space-y-0.5">
                      <h4 className="font-bold text-theme-text text-xs flex items-center gap-1.5">
                        {step.title}
                      </h4>
                      {/* Dynamic Summary */}
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">
                        {summaryText}
                      </p>
                    </div>
                  </div>

                  {/* Status Indicator Badge */}
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-wider ${
                      status === 'Done'
                        ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200/20'
                        : status === 'To review'
                        ? 'bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 border border-amber-200/20 animate-pulse'
                        : status === 'To do'
                        ? 'bg-indigo-50 dark:bg-indigo-950/20 text-indigo-700 dark:text-indigo-400 border border-indigo-200/20'
                        : 'bg-slate-50 dark:bg-slate-900 text-slate-450 border border-slate-200/10'
                    }`}>
                      {status === 'Not ready' ? t.stepPending : status === 'Done' ? t.stepDone : status === 'To review' ? t.stepToReview : t.stepToDo}
                    </span>
                    {activeStepIndex === index ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-200" />}
                  </div>
                </div>

                {/* Expanded Content */}
                {activeStepIndex === index && (
                  <div className="mt-3.5 pl-0 space-y-4 animation-fade-in">
                    {step.description && (
                      <p className="text-xs text-theme-text-secondary leading-relaxed">
                        {step.description}
                      </p>
                    )}

                    {/* Value Proposition Box */}
                    <div className="p-3 bg-indigo-50/20 dark:bg-indigo-950/10 rounded-2xl border border-indigo-100/30 dark:border-indigo-900/10">
                      <span className="block text-[8px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider mb-1">{t.clinicalValueProposition}</span>
                      <p className="text-[11px] text-theme-text leading-relaxed font-medium">
                        {step.valueProposition}
                      </p>
                    </div>

                    {index === 0 ? (
                      /* Tell us about you Step 0 expanded */
                      <div className="space-y-4">
                        {(() => {
                          const checklistItems = [
                            { name: t.age, present: !!profile?.age, presentCount: 0, type: 'demographic' },
                            { name: t.ethnicity, present: !!profile?.ethnicity && String(profile.ethnicity).toLowerCase() !== 'unknown', presentCount: 0, type: 'demographic' },
                            { name: t.weight, present: !!profile?.weight, presentCount: 0, type: 'demographic' },
                            { name: t.height, present: !!profile?.height, presentCount: 0, type: 'demographic' },
                            ...Object.entries(groupedBiomarkers).map(([category, items]) => {
                              const typedItems = items as Array<{ key: string; name: string; present: boolean }>;
                              const presentCount = typedItems.filter(item => item.present).length;
                              return {
                                name: category,
                                present: presentCount > 0,
                                presentCount,
                                type: 'biomarker_category'
                              };
                            })
                          ];

                          return (
                            <div className="space-y-4">
                              {/* what's done so far Checklist */}
                              <div className="space-y-3">
                                <span className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                                  {t.whatsDoneSoFar}
                                </span>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                  {checklistItems.map((item, idx) => {
                                    const hasAtLeastOne = item.present;
                                    return (
                                      <div 
                                        key={idx} 
                                        className={`flex items-center justify-between p-2.5 rounded-xl border transition-all ${
                                          hasAtLeastOne
                                            ? 'bg-emerald-50/20 dark:bg-emerald-950/10 border-emerald-100/30 dark:border-emerald-950/30 text-slate-800 dark:text-slate-200'
                                            : 'bg-slate-50/50 dark:bg-slate-900/30 border-slate-100/60 dark:border-slate-800/40 text-slate-400'
                                        }`}
                                      >
                                        <div className="flex items-center gap-2">
                                          <Activity className={`w-3.5 h-3.5 ${hasAtLeastOne ? 'text-emerald-500' : 'text-slate-400'}`} />
                                          <div className="flex flex-col">
                                            <span className={`text-[11px] font-bold ${hasAtLeastOne ? 'text-theme-text' : 'text-theme-text-secondary'}`}>
                                              {item.type === 'biomarker_category' ? displayCategoryLabel(profile.language, item.name) : item.name}
                                            </span>
                                            {item.type === 'biomarker_category' && (
                                              <span className="text-[9px] font-mono text-slate-400">
                                                {item.presentCount} {t.added}
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                        <div>
                                          {hasAtLeastOne ? (
                                            <CheckCircle className="w-3.5 h-3.5 text-emerald-600 fill-emerald-600/10" />
                                          ) : (
                                            <span className="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-700 mr-1" />
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>

                              {criticalMissing.length > 0 && (
                                <div className="bg-amber-50/50 dark:bg-amber-950/20 border border-amber-500/10 rounded-2xl p-3 flex gap-2">
                                  <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                                  <p className="text-[11px] text-amber-700 dark:text-amber-400 leading-normal font-medium">
                                    {t.missingCriticalIndicators} <strong>{criticalMissing.map(m => m.name).join(', ')}</strong>. {t.missingIndicatorsNote}
                                  </p>
                                </div>
                              )}
                              {(() => {
                                const latestExtraction = (profile.agentAnalyses || [])
                                  .filter((a: any) => (a.agentType === 'agent1' || a.agentType === 'medical_extract') && !a.archived)
                                  .sort((a: any, b: any) => (b.date || '').localeCompare(a.date || ''))[0];

                                if (!latestExtraction) return null;

                                const res = latestExtraction.result || {};
                                const hasMore = !!(res.hasMoreMarkers || res.hasMore || res.needsContinuation || res.status === 'needs_continuation');
                                const currentBatch = res.currentBatch || 1;
                                const estimatedTotal = res.estimatedTotalMarkers || null;
                                const extractedCount = Array.isArray(res.filledRows) ? res.filledRows.length : (Array.isArray(res.extractedData) ? res.extractedData.length : (Array.isArray(res.biomarkers) ? res.biomarkers.length : 0));

                                // Check if user has approved this analysis
                                const isApproved = approvedSteps['agent1'] || approvedAnalysisIds['agent1'] === latestExtraction.id;

                                // If extraction has 0 markers and not in progress, do not show pending box
                                if (extractedCount === 0 && !hasMore && !res.agentResult) return null;

                                return (
                                  <div className={`p-4 rounded-2xl border transition-all ${
                                    hasMore 
                                      ? 'bg-indigo-50/40 dark:bg-indigo-950/10 border-indigo-100 dark:border-indigo-900/50' 
                                      : isApproved
                                        ? 'bg-emerald-50/20 dark:bg-emerald-950/5 border-emerald-100/60 dark:border-emerald-900/30'
                                        : 'bg-emerald-50/45 dark:bg-emerald-950/10 border-emerald-100 dark:border-emerald-900/50'
                                  }`}>
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                      <div className="space-y-1.5 flex-1 text-left">
                                        <div className="flex items-center gap-2">
                                          <span className={`w-2 h-2 rounded-full ${hasMore ? 'bg-indigo-500 animate-pulse' : 'bg-emerald-500'}`} />
                                          <h5 className="text-xs font-bold text-theme-text">
                                            {hasMore ? t.extractionInProgress : isApproved ? t.extractedDataApproved : t.extractedDataPendingApproval}
                                          </h5>
                                        </div>
                                        
                                        <p className="text-[11px] text-theme-text-secondary leading-relaxed">
                                          {hasMore ? (
                                            estimatedTotal 
                                              ? interpolate(t.batchActiveExtractedOf, { batch: currentBatch, count: extractedCount, estimated: estimatedTotal })
                                              : interpolate(t.batchActiveExtractedContinue, { batch: currentBatch, count: extractedCount })
                                          ) : isApproved ? (
                                            interpolate(t.extractionApprovedApplied, { count: extractedCount })
                                          ) : (
                                            interpolate(t.extractionCompleteReview, { count: extractedCount })
                                          )}
                                        </p>

                                        <div className="flex flex-wrap gap-2 pt-1">
                                          <span className="bg-slate-100/80 dark:bg-slate-800/80 text-theme-text-secondary px-2 py-0.5 rounded-full text-[9px] font-medium border border-slate-200/30 whitespace-nowrap">
                                            {interpolate(t.batchNumberLabel, { n: currentBatch })}
                                          </span>
                                          {estimatedTotal && (
                                            <span className="bg-slate-100/80 dark:bg-slate-800/80 text-theme-text-secondary px-2 py-0.5 rounded-full text-[9px] font-medium border border-slate-200/30 whitespace-nowrap">
                                              {interpolate(t.estimatedMarkersCount, { n: estimatedTotal })}
                                            </span>
                                          )}
                                          <span className="bg-slate-100/80 dark:bg-slate-800/80 text-theme-text-secondary px-2 py-0.5 rounded-full text-[9px] font-medium border border-slate-200/30 whitespace-nowrap">
                                            {interpolate(t.extractedCountChip, { n: extractedCount })}
                                          </span>
                                        </div>

                                        {(Array.isArray(res.filledRows) && res.filledRows.length > 0) || (Array.isArray(res.extractedData) && res.extractedData.length > 0) || res.agentResult ? (
                                          <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
                                            <AgentResultTable
                                              agentType="agent1"
                                              agentResult={res}
                                              profile={profile}
                                              biomarkerHistory={activeHistory || []}
                                              initialRawText=""
                                              isApplying={isApplying}
                                              onApplyChanges={async (unselectedKeys?: string[]) => {
                                                await handleApproveExtractionAnalysis(latestExtraction, unselectedKeys);
                                              }}
                                            />
                                          </div>
                                        ) : null}
                                      </div>

                                      <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            if (hasMore) {
                                              onOpenAgentChat?.('agent1', {
                                                extractedData: res.filledRows || res.extractedData || [],
                                                currentBatch: currentBatch + 1,
                                                estimatedTotalMarkers: estimatedTotal,
                                                prefillMessage: 'continue'
                                              });
                                            } else {
                                              setFullscreenExtractionAnalysis(latestExtraction);
                                            }
                                          }}
                                          className={`px-3 py-1.5 rounded-xl text-[10px] font-bold text-white transition-all shadow-sm shrink-0 whitespace-nowrap cursor-pointer ${
                                            hasMore 
                                              ? 'bg-indigo-600 hover:bg-indigo-700' 
                                              : isApproved
                                                ? 'bg-slate-700 hover:bg-slate-800'
                                                : 'bg-emerald-600 hover:bg-emerald-700'
                                          }`}
                                        >
                                          {hasMore ? t.continueExtraction : isApproved ? t.viewTable : t.reviewAndApprove}
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                          );
                        })()}

                        {onOpenMedicalChat && (
                          <button
                            onClick={() => onOpenMedicalChat()}
                            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center justify-center mt-2 cursor-pointer"
                          >
                            {t.addHealthData}
                          </button>
                        )}
                      </div>
                    ) : step.id === 'data_review' ? (
                      /* Simplified Data Review / Calibration UI */
                      <div className="space-y-4">
                        {batches.length === 0 ? (
                          <div className="p-4 text-center bg-slate-50 dark:bg-slate-900 rounded-2xl border border-theme-border text-slate-500 text-xs">
                            {t.noBiomarkersAvailableDesc}
                          </div>
                        ) : (
                          <div className="space-y-4 text-left font-sans">
                            <div className="p-3.5 bg-slate-50 dark:bg-slate-900 rounded-2xl border border-slate-150 dark:border-slate-850 flex gap-2">
                              <Sparkles className="w-4 h-4 text-indigo-500 flex-shrink-0 mt-0.5" />
                              <div className="space-y-1">
                                <span className="block text-xs font-bold text-indigo-600 dark:text-indigo-400">{t.whatToExpectAndValue}</span>
                                <p className="text-[11px] text-theme-text-secondary leading-normal">
                                  {step.description}
                                </p>
                                <p className="text-[11px] text-theme-neutral leading-normal">
                                  <strong>Value:</strong> <span className="text-theme-text font-medium">{step.valueProposition}</span>
                                </p>
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-3 pt-2">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const firstUnapprovedIdx = batches.findIndex((_, idx) => !approvedBatches[idx]);
                                  const targetIdx = firstUnapprovedIdx >= 0 ? firstUnapprovedIdx : 0;
                                  const batchKeys = batches[targetIdx] || [];
                                  if (onOpenAgentChat) {
                                    onOpenAgentChat('data_review', {
                                      dataReviewBatchIdx: targetIdx,
                                      dataReviewBatchKeys: batchKeys,
                                      prefillMessage: `Calibrate Batch ${targetIdx + 1}`
                                    });
                                  }
                                }}
                                className="py-2.5 px-5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer shadow-md shadow-indigo-600/10 transition-all"
                              >
                                <Sparkles className="w-3.5 h-3.5" />
                                <span>{t.reviewBatch}</span>
                              </button>

                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleResetBatches();
                                }}
                                className="py-2.5 px-3 bg-red-100 hover:bg-red-200 text-red-600 dark:bg-red-900/30 dark:text-red-400 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1 cursor-pointer"
                                title="Reset all batch progress"
                              >
                                {t.resetProgress}
                              </button>

                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setShowCustomDataReviewBatchModal(true);
                                }}
                                className="py-2.5 px-3 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/20 dark:hover:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/10 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1 cursor-pointer"
                                title="Create a custom subset to calibrate"
                              >
                                {t.createCustomBatch}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      /* Steps 1-7 expanded content */
                      <div className="space-y-4">
                        {status === 'Not ready' && (
                          <div className="p-3.5 bg-slate-50 dark:bg-slate-900 rounded-2xl border border-slate-150 dark:border-slate-850 flex gap-2">
                            <Sparkles className="w-4 h-4 text-indigo-500 flex-shrink-0 mt-0.5" />
                            <div className="space-y-1">
                              <span className="block text-xs font-bold text-indigo-600 dark:text-indigo-400">{t.whatToExpectAndValue}</span>
                              <p className="text-[11px] text-theme-text-secondary leading-normal">
                                This module will analyze your {step.title.toLowerCase()} when unlocked.
                              </p>
                              <p className="text-[11px] text-theme-neutral leading-normal">
                                <strong>Value:</strong> <span className="text-theme-text font-medium">{step.valueProposition}</span>
                              </p>
                              <p className="text-[11px] text-slate-450 dark:text-slate-500 leading-normal italic pt-1">
                                (Will become fully operational once prior steps are approved.)
                              </p>
                            </div>
                          </div>
                        )}

                        {status === 'To do' && (
                          <div className="pt-2">
                            <button
                              onClick={() => onOpenAgentChat?.(step.agentType as any)}
                              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-indigo-600/10 flex items-center justify-center gap-1.5 cursor-pointer"
                            >
                              <Sparkles className="w-3.5 h-3.5" />
                              {step.agentType === 'agent4' ? t.reviewWithPlanningAgent : `${t.start} ${step.title}`}
                            </button>
                          </div>
                        )}

                        {(status === 'To review' || status === 'Done') && !latestAnalysis && (
                          <div className="pt-2">
                            <button
                              onClick={() => onOpenAgentChat?.(step.agentType as any)}
                              className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-1.5 cursor-pointer"
                            >
                              <Send className="w-3.5 h-3.5 text-slate-400" />
                              {t.chatWithAgent}
                            </button>
                            {step.agentType && renderAgentHistory(step.agentType)}
                          </div>
                        )}

                        {(status === 'To review' || status === 'Done') && latestAnalysis && (
                          <div className="space-y-4 pt-1">
                            {/* Proposal Content */}
                            <div className="p-3 bg-slate-50/50 dark:bg-slate-900/40 rounded-2xl border border-theme-border/80 space-y-3">
                              <div className="flex items-center justify-between">
                                {status === 'Done' ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[8px] font-bold bg-emerald-100/80 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">
                                    <Check className="w-2.5 h-2.5" /> {t.accepted}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[8px] font-bold bg-indigo-100/50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 uppercase tracking-wider">
                                    {t.agentFindingProposal}
                                  </span>
                                )}
                                <span className="text-[9px] text-slate-400 font-mono">
                                  {new Date(latestAnalysis.date).toLocaleDateString()}
                                </span>
                              </div>

                              {/* Specific view rendering based on agent type */}
                              {['agent1', 'agent2', 'agent3', 'agent4', 'medical_extract'].includes(step.agentType!) && latestAnalysis.result ? (
                                <div className="overflow-hidden rounded-xl border border-theme-border bg-white dark:bg-slate-950">
                                  <AgentResultTable
                                    agentType={step.agentType! as any}
                                    agentResult={latestAnalysis.result}
                                    profile={profile}
                                    biomarkerHistory={activeHistory || []}
                                    initialRawText=""
                                    isApplying={isApplying}
                                  />
                                </div>
                              ) : step.agentType === 'health_baseline' ? (
                                <div>
                                  <HealthBaselineCard
                                    msg={{ id: 'mock', role: 'assistant', content: '', agentType: 'health_baseline', data: { agentResult: latestAnalysis.result } } as any}
                                    idx={0}
                                    messages={[]}
                                    t={(key: string) => key}
                                    formatNutrientValue={(val: number) => String(val)}
                                    onLogFood={async () => {}}
                                    onLogFoodIdeas={async () => {}}
                                  />
                                </div>
                              ) : ['agent5', 'agent7'].includes(step.agentType!) ? (
                                <div className="bg-white dark:bg-slate-950 p-3 rounded-xl border border-slate-100 dark:border-slate-850">
                                  <GenericAgentResultView rawResult={latestAnalysis.result} />
                                </div>
                              ) : (
                                <div className="text-[10px] text-theme-neutral font-mono bg-white dark:bg-slate-950 p-3 rounded-xl border border-slate-100 dark:border-slate-850 max-h-32 overflow-auto">
                                  <pre>{typeof latestAnalysis.result === 'string' ? latestAnalysis.result : JSON.stringify(latestAnalysis.result, null, 2)}</pre>
                                </div>
                              )}
                            </div>

                            {(() => {
                              const isApproved = status === 'Done' || (step.agentType && (approvedSteps[step.agentType] || (latestAnalysis && approvedAnalysisIds[step.agentType] === latestAnalysis.id)));
                              return (
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 pt-1">
                                  <button
                                    onClick={() => onArchiveAnalysis?.(latestAnalysis.id)}
                                    className="py-2.5 px-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-theme-text-secondary rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                                  >
                                    <Archive className="w-3.5 h-3.5" />
                                    {t.archive}
                                  </button>
                                  <button
                                    onClick={() => {
                                      if (['agent1', 'agent2', 'agent3', 'agent4', 'medical_extract'].includes(step.agentType!)) {
                                        setFullscreenExtractionAnalysis(latestAnalysis);
                                      } else {
                                        const suggestionText = typeof latestAnalysis.result === 'string' 
                                          ? latestAnalysis.result 
                                          : JSON.stringify(latestAnalysis.result, null, 2);
                                        onOpenAgentChat?.(step.agentType as any, {
                                          prefillMessage: `I want to edit some information in your previous suggestion for ${step.title}. Here is the suggestion:\n\n${suggestionText}\n\nCould you please help me edit and adjust this suggestion?`
                                        });
                                      }
                                    }}
                                    className="py-2.5 px-3 bg-slate-150 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                                  >
                                    <Send className="w-3.5 h-3.5 text-slate-400" />
                                    {t.review}
                                  </button>
                                  {calibratingAgentType === step.agentType ? (
                                    <button
                                      type="button"
                                      disabled
                                      className="py-2.5 px-3 bg-indigo-400 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-not-allowed opacity-75"
                                    >
                                      <Loader className="w-3.5 h-3.5 animate-spin" />
                                      {t.approving}
                                    </button>
                                  ) : isApproved ? (
                                    <button
                                      onClick={() => handleApproveStep(index)}
                                      className="py-2.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-md shadow-emerald-600/10"
                                    >
                                      <Check className="w-3.5 h-3.5" />
                                      {t.approved}
                                    </button>
                                  ) : (
                                    <button
                                      onClick={() => handleApproveStep(index)}
                                      className="py-2.5 px-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-md shadow-indigo-600/10"
                                    >
                                      <Check className="w-3.5 h-3.5" />
                                      {t.approve}
                                    </button>
                                  )}
                                </div>
                              );
                            })()}

                            {step.agentType && renderAgentHistory(step.agentType)}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>



      {/* Results Section */}
      {report ? (
        <div className="space-y-6">
          


          {/* Core Medical Insights summarised bullet points */}
          <div id="latest-insights-card" className="bg-theme-bg-card border border-theme-border/80 rounded-3xl p-6 shadow-sm space-y-4">
            <h3 className="font-bold text-theme-text text-sm flex items-center gap-1.5 font-display">
              <BookOpen className="w-4 h-4 text-indigo-600" />
              {t.latestInsights}
            </h3>

            <div className="space-y-4">
              {report.latestInsights.map((insight, idx) => (
                <div key={idx} className="space-y-1 bg-theme-bg p-4 rounded-2xl border border-theme-border/20">
                  <h4 className="font-bold text-theme-text text-xs">
                    {insight.title}
                  </h4>
                  <p className="text-[11px] text-theme-text-secondary leading-relaxed mt-0.5 font-medium">
                    {insight.summary}
                  </p>
                  <a
                    href={insight.link}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] font-bold text-indigo-600 hover:text-indigo-700 hover:underline block pt-1.5 font-mono"
                  >
                    {t.pubmedLink}
                  </a>
                </div>
              ))}
            </div>
          </div>

        </div>
      ) : (
        /* Empty insights state */
        <div id="insights-empty-state" className="bg-theme-bg-card border border-theme-border/80 rounded-3xl p-8 text-center shadow-sm flex flex-col items-center">
          <Clock className="w-10 h-10 text-slate-300 dark:text-slate-700 mb-3" />
          <p className="text-xs text-theme-text-secondary leading-relaxed font-medium">
            {t.noDataInsight}
          </p>
        </div>
      )}


      {fullscreenBatchIndex !== null && batchAnalysisResults[fullscreenBatchIndex] && (
        <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-[60] flex items-center justify-center p-4 sm:p-6 md:p-10">
          <div className="bg-theme-bg-card border border-theme-border rounded-3xl w-full max-w-7xl h-[85vh] flex flex-col shadow-2xl overflow-hidden animation-zoom-in">
            <div className="flex items-center justify-between px-6 py-5 border-b border-theme-border bg-slate-50/50 dark:bg-slate-950/20">
              <div>
                <h3 className="text-sm font-bold text-theme-text font-display">
                  Batch {fullscreenBatchIndex + 1} {t.batchFullscreenTitle}
                </h3>
                <p className="text-[10px] text-slate-450 mt-1">
                  Showing detailed physiological calibrations, ranges, and clinical insights for Batch {fullscreenBatchIndex + 1}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFullscreenBatchIndex(null)}
                className="p-2 rounded-full hover:bg-slate-200 dark:hover:bg-slate-850 text-slate-450 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="flex-1 overflow-auto p-6 bg-slate-50/20 dark:bg-slate-950/10">
              <AgentResultTable
                agentType="data_review"
                agentResult={batchAnalysisResults[fullscreenBatchIndex]}
                profile={profile}
                biomarkerHistory={activeHistory}
                isApplying={isApplying}
                selectedMissingKeys={selectedMissingKeysToMove[fullscreenBatchIndex] || STABLE_EMPTY_ARRAY}
                onChangeSelectedMissingKeys={(keys) => setSelectedMissingKeysToMove(prev => ({ ...prev, [fullscreenBatchIndex]: keys }))}
                onApplyChanges={async (unselectedKeys?: string[]) => {
                  await handleApproveBatchStep2(fullscreenBatchIndex, batchAnalysisResults[fullscreenBatchIndex], unselectedKeys);
                  setFullscreenBatchIndex(null);
                }}
              />
            </div>
            
            <div className="px-6 py-4 border-t border-theme-border bg-slate-50/50 dark:bg-slate-950/20 flex justify-end">
              <button
                type="button"
                onClick={() => setFullscreenBatchIndex(null)}
                className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-md cursor-pointer"
              >
                {t.closeFullscreen}
              </button>
            </div>
          </div>
        </div>
      )}

      {fullscreenExtractionAnalysis && fullscreenExtractionAnalysis.result && (
        <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-[60] flex items-center justify-center p-4 sm:p-6 md:p-10">
          <div className="bg-theme-bg-card border border-theme-border rounded-3xl w-full max-w-7xl h-[85vh] flex flex-col shadow-2xl overflow-hidden animation-zoom-in">
            <div className="flex items-center justify-between px-6 py-5 border-b border-theme-border bg-slate-50/50 dark:bg-slate-950/20">
              <div>
                <h3 className="text-sm font-bold text-theme-text font-display">
                  {t.extractedBiomarkersReviewTitle}
                </h3>
                <p className="text-[10px] text-slate-450 mt-1">
                  {t.reviewAllExtractedBiomarkers}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFullscreenExtractionAnalysis(null)}
                className="p-2 rounded-full hover:bg-slate-200 dark:hover:bg-slate-850 text-slate-450 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="flex-1 overflow-auto p-6 bg-slate-50/20 dark:bg-slate-950/10">
              <AgentResultTable
                agentType="agent1"
                agentResult={fullscreenExtractionAnalysis.result}
                profile={profile}
                biomarkerHistory={activeHistory}
                isApplying={isApplying}
                onApplyChanges={async (unselectedKeys?: string[]) => {
                  await handleApproveExtractionAnalysis(fullscreenExtractionAnalysis, unselectedKeys);
                  setFullscreenExtractionAnalysis(null);
                }}
              />
            </div>
            
            <div className="px-6 py-4 border-t border-theme-border bg-slate-50/50 dark:bg-slate-950/20 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setFullscreenExtractionAnalysis(null)}
                className="px-4 py-2 bg-slate-150 dark:bg-slate-800 text-theme-text rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                {t.close}
              </button>
              <button
                type="button"
                disabled={isApplying}
                onClick={async () => {
                  await handleApproveExtractionAnalysis(fullscreenExtractionAnalysis);
                  setFullscreenExtractionAnalysis(null);
                }}
                className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-md cursor-pointer flex items-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                {isApplying ? t.applying : t.approveAndApplyToProfile}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Batch Builder Modal */}
      {showCustomBatchModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex flex-col p-0 animation-fade-in font-sans">
          <div className="w-full h-full bg-white dark:bg-slate-950 flex flex-col shadow-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-theme-border bg-slate-50 dark:bg-slate-900/60">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-bold text-theme-text">{t.testCustomBatch}</h3>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-slate-500">{t.pickBiomarkerTestDesc}</span>
                    <span className="text-[10px] font-bold bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 px-1.5 py-0.25 rounded-md">
                      {customBatchKeys.length} {t.selected}
                    </span>
                  </div>
                </div>
                <button onClick={() => setShowCustomBatchModal(false)} className="text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full p-1 transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder={t.searchBiomarkersPlaceholder}
                  value={customBatchSearch}
                  onChange={e => setCustomBatchSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-white dark:bg-slate-950 border border-theme-border rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* Group By Selector */}
              <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-slate-150 dark:border-slate-800">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{t.groupBy}</span>
                <select
                  value={batchGroupType}
                  onChange={(e) => setBatchGroupType(e.target.value as any)}
                  className="px-2.5 py-1 text-xs font-semibold bg-theme-bg-card text-slate-700 dark:text-slate-200 border border-theme-border rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer shadow-sm"
                >
                  {BIOMARKER_GROUPING_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>
                      {opt.value === 'risk' ? t.byRiskCategories : opt.value === 'practice' ? t.byMedicalPractice : t.byMedicalConditions}
                    </option>
                  ))}
                </select>
              </div>

              {/* Active Selection Summary Panel */}
              <div className="mt-3 p-3 bg-indigo-50/60 dark:bg-indigo-950/40 border border-indigo-200/50 dark:border-indigo-800/40 rounded-xl">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-bold text-indigo-900 dark:text-indigo-200 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                    <span>{t.biomarkersInCustomBatch} ({customBatchKeys.length}):</span>
                  </span>
                  {customBatchKeys.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        clearCustomBatchResults();
                        setCustomBatchKeys([]);
                        localStorage.removeItem(`agent1_custom_batch_keys_${userIdentifier}`);
                      }}
                      className="text-[10px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer shrink-0"
                    >
                      {t.clearAll}
                    </button>
                  )}
                </div>
                {customBatchKeys.length === 0 ? (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 italic">
                    No biomarkers selected yet. Click any biomarker in the list below to add it to this custom batch.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5 max-h-[110px] overflow-y-auto pr-1">
                    {customBatchKeys.map(k => {
                      const customDef = profile?.customBiomarkers?.[k];
                      const stdDef = biomarkerDefinitions.find(d => d.key === k || (Array.isArray(d.aliases) && d.aliases.some((a: string) => a.toLowerCase() === k.toLowerCase())));
                      const def = getMergedBiomarkerDef(k, stdDef, customDef);
                      const val = biomarkers[k];
                      return (
                        <span
                          key={k}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold bg-white dark:bg-slate-900 text-indigo-950 dark:text-indigo-200 border border-indigo-200 dark:border-indigo-800 shadow-2xs"
                        >
                          <span className="font-bold">{def.name || k}</span>
                          <span className="text-[9px] font-mono text-slate-400 font-normal">({k})</span>
                          {val !== undefined && val !== null && val !== '' && (
                            <span className="bg-indigo-100/80 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 px-1 py-0.25 rounded text-[9px] font-mono">
                              {val} {def.unit || ''}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              clearCustomBatchResults();
                              setCustomBatchKeys(prev => {
                                const updated = prev.filter(key => key !== k);
                                localStorage.setItem(`agent1_custom_batch_keys_${userIdentifier}`, JSON.stringify(updated));
                                return updated;
                              });
                            }}
                            className="ml-0.5 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-full p-0.5 text-slate-400 hover:text-rose-500 cursor-pointer"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {(() => {
                const filtered = markerKeys.filter(k => k.toLowerCase().includes(customBatchSearch.toLowerCase()));
                if (filtered.length === 0) {
                  return <p className="text-xs text-slate-500 text-center py-4">{t.noBiomarkersAvailable}</p>;
                }

                // Compute groups
                const groups: Record<string, string[]> = {};
                filtered.forEach(key => {
                  const meta = getBiomarkerMetadata(key, profile.customBiomarkers?.[key]);
                  
                  if (batchGroupType === 'risk') {
                    const cats = meta.riskCategories && meta.riskCategories.length > 0 ? meta.riskCategories : ['General Health'];
                    cats.forEach(c => {
                      if (!groups[c]) groups[c] = [];
                      groups[c].push(key);
                    });
                  } else if (batchGroupType === 'practice') {
                    const practice = meta.standardMedicalGrouping || 'Other';
                    if (!groups[practice]) groups[practice] = [];
                    groups[practice].push(key);
                  } else if (batchGroupType === 'condition') {
                    const conditions = meta.potentialMedicalConditions && meta.potentialMedicalConditions.length > 0 ? meta.potentialMedicalConditions : ['General Health'];
                    conditions.forEach(c => {
                      if (!groups[c]) groups[c] = [];
                      groups[c].push(key);
                    });
                  }
                });

                const groupNames = Object.keys(groups).sort();

                return groupNames.map(groupName => {
                  const keysInGroup = groups[groupName];
                  const selectedInGroup = keysInGroup.filter(k => customBatchKeys.includes(k));
                  const isExpanded = expandedGroups[groupName] !== false;

                  const toggleGroup = () => {
                    setExpandedGroups(prev => ({
                      ...prev,
                      [groupName]: !isExpanded
                    }));
                  };

                  return (
                    <div key={groupName} className="border border-theme-border rounded-xl overflow-hidden bg-slate-50/20 dark:bg-slate-900/10">
                      <div 
                        onClick={toggleGroup}
                        className="flex items-center justify-between p-3 bg-slate-50/80 dark:bg-slate-900/60 hover:bg-slate-100/60 dark:hover:bg-slate-800/60 cursor-pointer select-none transition-colors border-b border-theme-border"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-theme-neutral">{displayCategoryLabel(profile.language, groupName)}</span>
                          <span className="text-[10px] bg-slate-200/60 dark:bg-slate-800 text-theme-text-secondary px-1.5 py-0.5 rounded-full font-bold">
                            {keysInGroup.length}
                          </span>
                          {selectedInGroup.length > 0 && (
                            <span className="text-[10px] bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 px-1.5 py-0.5 rounded-full font-bold">
                              {selectedInGroup.length} selected
                            </span>
                          )}
                        </div>
                        {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                      </div>

                      {isExpanded && (
                        <div className="p-3 space-y-2 bg-white dark:bg-slate-950">
                          {keysInGroup.map(key => {
                            const isSelected = customBatchKeys.includes(key);
                            const customDef = profile?.customBiomarkers?.[key];
                            const stdDef = biomarkerDefinitions.find(d => d.key === key || (Array.isArray(d.aliases) && d.aliases.some((a: string) => a.toLowerCase() === key.toLowerCase())));
                            const def = getMergedBiomarkerDef(key, stdDef, customDef);
                            const val = biomarkers[key];

                            return (
                              <div 
                                key={key} 
                                onClick={() => {
                                  clearCustomBatchResults();
                                  setCustomBatchKeys(prev => {
                                    const updated = isSelected ? prev.filter(k => k !== key) : [...prev, key];
                                    localStorage.setItem(`agent1_custom_batch_keys_${userIdentifier}`, JSON.stringify(updated));
                                    return updated;
                                  });
                                }}
                                className={`p-2.5 rounded-xl border flex items-center justify-between cursor-pointer transition-colors ${isSelected ? 'bg-indigo-50/40 border-indigo-300 dark:bg-indigo-950/40 dark:border-indigo-800' : 'bg-theme-bg-card border-slate-100 dark:border-slate-850 hover:bg-slate-50 dark:hover:bg-slate-800/60'}`}
                              >
                                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                  <div className={`w-4 h-4 rounded-md border flex items-center justify-center shrink-0 ${isSelected ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-300 dark:border-slate-700'}`}>
                                    {isSelected && <Check className="w-3 h-3" />}
                                  </div>
                                  <div className="flex flex-col min-w-0">
                                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">
                                      {def.name || key}
                                    </span>
                                    <span className="text-[10px] font-mono text-slate-400">
                                      Key: {key} {def.unit ? `· Unit: ${def.unit}` : ''}
                                    </span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  {val !== undefined && val !== null && val !== '' ? (
                                    <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 font-mono bg-indigo-50 dark:bg-indigo-950/50 px-2 py-0.5 rounded-md border border-indigo-100 dark:border-indigo-900/40">
                                      {val} {def.unit || ''}
                                    </span>
                                  ) : (
                                    <span className="text-[10px] text-slate-400 italic">{t.noValue}</span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
            
            <div className="p-4 border-t border-theme-border bg-slate-50 dark:bg-slate-900/60 flex justify-end gap-2">
              <button 
                type="button" 
                onClick={() => {
                  clearCustomBatchResults();
                  setCustomBatchKeys([]);
                  localStorage.removeItem(`agent1_custom_batch_keys_${userIdentifier}`);
                }} 
                className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-700 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-xl transition-colors"
              >
                {t.clear}
              </button>
              <button 
                type="button" 
                onClick={() => {
                  setShowCustomBatchModal(false);
                  if (onOpenAgentChat && customBatchKeys.length > 0) {
                    onOpenAgentChat('data_review', {
                      dataReviewBatchKeys: customBatchKeys,
                      dataReviewBatchIdx: 'custom',
                      prefillMessage: `Please calibrate and review reference ranges, units, and categories for these ${customBatchKeys.length} selected biomarkers:\n${customBatchKeys.join(', ')}`
                    });
                  }
                }} 
                className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 shadow-md shadow-indigo-600/10 rounded-xl transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <Sparkles className="w-3.5 h-3.5" />
                {t.doneAndCalibrate} ({customBatchKeys.length})
              </button>
            </div>
          </div>
        </div>
      )}

      {showCustomDataReviewBatchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 dark:bg-slate-900/60 backdrop-blur-sm animation-fade-in">
          <div className="bg-white dark:bg-slate-900 border border-theme-border shadow-2xl rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
            <div className="p-4 border-b border-theme-border bg-slate-50/50 dark:bg-slate-900/50">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">{t.customDataReviewBatch}</h3>
                  <p className="text-[10px] text-slate-500 mt-0.5">{t.selectBiomarkersCalibrateDesc}</p>
                </div>
                <button onClick={() => setShowCustomDataReviewBatchModal(false)} className="text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full p-1 transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder={t.searchBiomarkersPlaceholder}
                  value={customDataReviewBatchSearch}
                  onChange={e => setCustomDataReviewBatchSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-white dark:bg-slate-950 border border-theme-border rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-slate-150 dark:border-slate-800">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{t.groupBy}</span>
                <select
                  value={batchGroupType}
                  onChange={(e) => setBatchGroupType(e.target.value as any)}
                  className="px-2.5 py-1 text-xs font-semibold bg-theme-bg-card text-slate-700 dark:text-slate-200 border border-theme-border rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer shadow-sm"
                >
                  {BIOMARKER_GROUPING_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>
                      {opt.value === 'risk' ? t.byRiskCategories : opt.value === 'practice' ? t.byMedicalPractice : t.byMedicalConditions}
                    </option>
                  ))}
                </select>
              </div>

              {/* Active Selection Summary Panel */}
              <div className="mt-3 p-3 bg-indigo-50/60 dark:bg-indigo-950/40 border border-indigo-200/50 dark:border-indigo-800/40 rounded-xl">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-bold text-indigo-900 dark:text-indigo-200 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                    <span>{t.biomarkersInCustomBatch} ({customDataReviewBatchKeys.length}):</span>
                  </span>
                  {customDataReviewBatchKeys.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setCustomDataReviewBatchKeys([]);
                        localStorage.removeItem(`datareview_custom_batch_keys_${userIdentifier}`);
                      }}
                      className="text-[10px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer shrink-0"
                    >
                      {t.clearAll}
                    </button>
                  )}
                </div>
                {customDataReviewBatchKeys.length === 0 ? (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 italic">
                    No biomarkers selected yet. Click any biomarker in the list below to add it to this custom batch.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5 max-h-[110px] overflow-y-auto pr-1">
                    {customDataReviewBatchKeys.map(k => {
                      const customDef = profile?.customBiomarkers?.[k];
                      const stdDef = biomarkerDefinitions.find(d => d.key === k || (Array.isArray(d.aliases) && d.aliases.some((a: string) => a.toLowerCase() === k.toLowerCase())));
                      const def = getMergedBiomarkerDef(k, stdDef, customDef);
                      const val = biomarkers[k];
                      const hasUnit = !!def.unit;
                      return (
                        <span
                          key={k}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold border transition-all ${
                            !hasUnit
                              ? 'bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950/80 dark:text-amber-200 dark:border-amber-800'
                              : 'bg-white dark:bg-slate-900 text-indigo-950 dark:text-indigo-200 border border-indigo-200 dark:border-indigo-800 shadow-2xs'
                          }`}
                        >
                          <span className="font-bold">{def.name || k}</span>
                          <span className="text-[9px] font-mono opacity-70">({k})</span>
                          {val !== undefined && val !== null && val !== '' && (
                            <span className="bg-indigo-100/80 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 px-1 py-0.25 rounded text-[9px] font-mono">
                              {val} {def.unit || ''}
                            </span>
                          )}
                          {!hasUnit && (
                            <span className="text-[9px] font-bold text-amber-600 dark:text-amber-400">⚠️ No Unit</span>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setCustomDataReviewBatchKeys(prev => {
                                const updated = prev.filter(key => key !== k);
                                localStorage.setItem(`datareview_custom_batch_keys_${userIdentifier}`, JSON.stringify(updated));
                                return updated;
                              });
                            }}
                            className="ml-0.5 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-full p-0.5 text-slate-400 hover:text-rose-500 cursor-pointer"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {(() => {
                const filtered = markerKeys.filter(k => k.toLowerCase().includes(customDataReviewBatchSearch.toLowerCase()));
                if (filtered.length === 0) {
                  return <p className="text-xs text-slate-500 text-center py-4">{t.noBiomarkersAvailable}</p>;
                }
                const groups: Record<string, string[]> = {};
                filtered.forEach(key => {
                  const meta = getBiomarkerMetadata(key, profile.customBiomarkers?.[key]);
                  
                  if (batchGroupType === 'risk') {
                    const cats = meta.riskCategories && meta.riskCategories.length > 0 ? meta.riskCategories : ['General Health'];
                    cats.forEach(c => {
                      if (!groups[c]) groups[c] = [];
                      groups[c].push(key);
                    });
                  } else if (batchGroupType === 'practice') {
                    const practice = meta.standardMedicalGrouping || 'Other';
                    if (!groups[practice]) groups[practice] = [];
                    groups[practice].push(key);
                  } else if (batchGroupType === 'condition') {
                    const conditions = meta.potentialMedicalConditions && meta.potentialMedicalConditions.length > 0 ? meta.potentialMedicalConditions : ['General Health'];
                    conditions.forEach(c => {
                      if (!groups[c]) groups[c] = [];
                      groups[c].push(key);
                    });
                  }
                });
                const groupNames = Object.keys(groups).sort();
                return groupNames.map(groupName => {
                  const keysInGroup = groups[groupName];
                  const selectedInGroup = keysInGroup.filter(k => customDataReviewBatchKeys.includes(k));
                  const isExpanded = expandedGroups[groupName] !== false;
                  const toggleGroup = () => {
                    setExpandedGroups(prev => ({
                      ...prev,
                      [groupName]: !isExpanded
                    }));
                  };
                  return (
                    <div key={groupName} className="border border-theme-border rounded-xl overflow-hidden bg-slate-50/20 dark:bg-slate-900/10">
                      <div 
                        onClick={toggleGroup}
                        className="flex items-center justify-between p-3 bg-slate-50/80 dark:bg-slate-900/60 hover:bg-slate-100/60 dark:hover:bg-slate-800/60 cursor-pointer select-none transition-colors border-b border-theme-border"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-theme-neutral">{displayCategoryLabel(profile.language, groupName)}</span>
                          <span className="text-[10px] bg-slate-200/60 dark:bg-slate-800 text-theme-text-secondary px-1.5 py-0.5 rounded-full font-bold">
                            {keysInGroup.length}
                          </span>
                          {selectedInGroup.length > 0 && (
                            <span className="text-[10px] bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 px-1.5 py-0.5 rounded-full font-bold">
                              {selectedInGroup.length} {t.selected}
                            </span>
                          )}
                        </div>
                        {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                      </div>
                      {isExpanded && (
                        <div className="p-3 space-y-2 bg-white dark:bg-slate-950">
                          {keysInGroup.map(key => {
                            const isSelected = customDataReviewBatchKeys.includes(key);
                            const customDef = profile?.customBiomarkers?.[key];
                            const stdDef = biomarkerDefinitions.find(d => d.key === key || (Array.isArray(d.aliases) && d.aliases.some((a: string) => a.toLowerCase() === key.toLowerCase())));
                            const def = getMergedBiomarkerDef(key, stdDef, customDef);
                            const val = biomarkers[key];

                            return (
                              <div 
                                key={key}
                                onClick={() => {
                                  setCustomDataReviewBatchKeys(prev => {
                                    const updated = isSelected ? prev.filter(k => k !== key) : [...prev, key];
                                    localStorage.setItem(`datareview_custom_batch_keys_${userIdentifier}`, JSON.stringify(updated));
                                    return updated;
                                  });
                                }}
                                className={`p-2.5 rounded-xl border flex items-center justify-between cursor-pointer transition-colors ${isSelected ? 'bg-indigo-50/40 border-indigo-300 dark:bg-indigo-950/40 dark:border-indigo-800' : 'bg-theme-bg-card border-slate-100 dark:border-slate-850 hover:bg-slate-50 dark:hover:bg-slate-800/60'}`}
                              >
                                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                  <div className={`w-4 h-4 rounded-md border flex items-center justify-center shrink-0 ${isSelected ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-300 dark:border-slate-700'}`}>
                                    {isSelected && <Check className="w-3 h-3" />}
                                  </div>
                                  <div className="flex flex-col min-w-0">
                                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">
                                      {def.name || key}
                                    </span>
                                    <span className="text-[10px] font-mono text-slate-400">
                                      Key: {key} {def.unit ? `· Unit: ${def.unit}` : ''}
                                    </span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  {val !== undefined && val !== null && val !== '' ? (
                                    <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 font-mono bg-indigo-50 dark:bg-indigo-950/50 px-2 py-0.5 rounded-md border border-indigo-100 dark:border-indigo-900/40">
                                      {val} {def.unit || ''}
                                    </span>
                                  ) : (
                                    <span className="text-[10px] text-slate-400 italic">{t.noValue}</span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
            
            <div className="p-4 border-t border-theme-border bg-slate-50 dark:bg-slate-900/60 flex justify-end gap-2">
              <button 
                type="button" 
                onClick={() => {
                  setCustomDataReviewBatchKeys([]);
                  localStorage.removeItem(`datareview_custom_batch_keys_${userIdentifier}`);
                }} 
                className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-700 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-xl transition-colors"
              >
                {t.clear}
              </button>
              <button 
                type="button" 
                onClick={() => {
                  setShowCustomDataReviewBatchModal(false);
                  if (onOpenAgentChat && customDataReviewBatchKeys.length > 0) {
                    onOpenAgentChat('data_review', {
                      dataReviewBatchKeys: customDataReviewBatchKeys,
                      dataReviewBatchIdx: 'custom',
                      prefillMessage: `Please calibrate and review reference ranges, units, and categories for these ${customDataReviewBatchKeys.length} selected biomarkers:\n${customDataReviewBatchKeys.join(', ')}`
                    });
                  }
                }} 
                className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 shadow-md shadow-indigo-600/10 rounded-xl transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <Sparkles className="w-3.5 h-3.5" />
                {t.doneAndCalibrate} ({customDataReviewBatchKeys.length})
              </button>
            </div>
          </div>
        </div>
      )}
      {showDictionaryModal && (
        <React.Suspense fallback={null}>
        <BiomarkerDictionaryModal
          profile={profile?.email === 'demo@healthcockpit.com' ? { ...profile, agentAnalyses: [] } : profile}
          biomarkers={profile?.email === 'demo@healthcockpit.com' ? {} : biomarkers}
          biomarkerHistory={profile?.email === 'demo@healthcockpit.com' ? [] : (activeHistory || [])}
          onClose={() => {
            setShowDictionaryModal(false);
            setDictionaryPreFillKey(null);
          }}
          onReviewWithAgent={(keys) => {
            setCustomBatchKeys(keys);
            setShowCustomBatchModal(true);
            setShowDictionaryModal(false);
            setDictionaryPreFillKey(null);
          }}
          initialSearchQuery={dictionaryPreFillKey || undefined}
          onDeleteBiomarker={onDeleteBiomarker}
          onFlagNotUsed={onFlagNotUsed}
          onRestoreNotUsedGlobal={onRestoreNotUsedGlobal}
          onDeleteMultipleBiomarkers={onDeleteMultipleBiomarkers}
          onUpdateProfile={async (updates) => {
            if (onUpdateProfile) {
              await onUpdateProfile({ ...profile, ...updates });
            }
          }}
          onCombineBiomarkers={onCombineBiomarkers || (() => {})}
          onBatchConsolidate={onBatchConsolidate}
          onAgentAnalysisSaved={onAgentAnalysisSaved}
          onDeleteAnalysis={onDeleteAnalysis}
          selectedModelId={selectedModelId}
          onChangeModelId={onChangeModelId}
        />
        </React.Suspense>
      )}
    </div>
  );
}
