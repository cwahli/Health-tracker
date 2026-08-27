import { formatMessageContent } from '../utils/formatUtils';
import {
 ErrorBoundary } from './ErrorBoundary';
import { agentCardRegistry } from './chat-cards';
import { AgentThoughtBox } from './chat-cards/FoodCard';
import { trackApiCall, setActiveQueryId, generateQueryId } from '../utils/apiTracker';
import { saveAgentRequestLog, getAgentRequestLogs } from '../utils/agentLogsTracker';
import React, { useState, useRef, useEffect, Suspense } from 'react';

import { ChatMessage, FoodLog, UserProfile, FoodIdea } from '../types';
import { translations } from '../utils/translations';
import { X, Send, Image, Camera, MessageSquare, Sparkles, Plus, Terminal, ChevronDown, ChevronUp, Loader, MapPin, Trash2, Check, Table, RotateCcw, RefreshCw, AlertTriangle, ShieldAlert, Edit2, Maximize2, Minimize2, Flag, BrainCircuit, Download } from 'lucide-react';
import { UniversalModal } from './UniversalModal';
import { nutrientDefinitions } from '../utils/nutrition';
import { biomarkerDefinitions, getBiomarkerStatus, isAsianEthnicity, getBiomarkerStatusLabel, isBiomarkerValueImprobable, getMergedBiomarkerDef, detectFlaggedTelemetryErrors, buildReviewBiomarkerContext, buildBiomarkerReviewPrefill, getMappedBiomarkerKey, isBiomarkerApproved, isCatalogBuiltIn, shouldStampExtractedDefPending } from '../utils/biomarkers';
import { BatchNavigator } from './BatchNavigator';
import LLMSelector from './LLMSelector';
import { AVAILABLE_LLMS } from '../utils/llm';
import { compressMultipleImages, compressImage } from '../utils/imageCompressor';
import { getCurrentDateInTimezone, toYYYYMMDD } from '../utils/dateUtils';
import { enrichReviewModificationCommands, collectCatalogUnitMap, sanitizeReviewReply, parserLeftoverKeys, calibratorStaleKeys } from '../utils/biomarkerLifecycle';
import { CANONICAL_SEVEN, selectBiomarkerAgentPack, wireBiomarkerRequest } from '../utils/biomarkerAgentPacks';
import ImageSlider from './ImageSlider';
import { lazyWithRetry } from '../utils/lazyWithRetry';
const FullScreenLogViewer = lazyWithRetry(() => import('./FullScreenLogViewer'));
import FullScreenInstructionViewer from './FullScreenInstructionViewer';
import { NutritionLabelTable } from './chat-cards/NutritionLabelTable';
import { InteractivePlacesMap } from './InteractivePlacesMap';
import { PortionClarifyCard } from './PortionClarifyCard';
import exifr from 'exifr';
import { auth, db } from '../firebase';
import { getAgentCalibration, getAllAgentCalibrations } from '../utils/agentCalibration';
import { collection, query, where, getDocs, setDoc, doc, deleteDoc, getDoc, limit, orderBy } from 'firebase/firestore';
import { sanitizeForFirestore, checkQuotaFlag } from '../utils/firestoreUtils';
import { get as idbGet } from 'idb-keyval';
import { pruneLocalStorageToFreeSpace, safeIdbSet } from '../utils/storageUtils';


import { resolveFoodImage } from '../utils/imageResolver';

import { JobStore } from '../jobs/JobStore';
import { toPendingFoodLog } from '../mealBuild/adapters';
import { executeFoodAgent } from '../jobs/FoodAgentExecutor';

function isValidFoodLog(log: any): boolean {
  if (!log || typeof log !== 'object' || Array.isArray(log)) return false;
  return !!(
    log.name ||
    log.title ||
    (Array.isArray(log.itemsBreakdown) && log.itemsBreakdown.length > 0) ||
    (Array.isArray(log.items) && log.items.length > 0) ||
    (Array.isArray(log.scoutItems) && log.scoutItems.length > 0) ||
    (log.nutrients && typeof log.nutrients === 'object' && Object.keys(log.nutrients).length > 0)
  );
}

function resolvePendingFoodLog(job: any): any {
  if (!job) return null;
  const rawResult = job.result?.clean_result || job.result?.raw?.data || job.result?.data || job.result || (job as any).clean_result || {};
  
  const candidates = [
    job.result?.pendingFoodLog,
    job.result?.clean_result?.pendingFoodLog,
    rawResult.pendingFoodLog,
    job.result?.foodData,
    rawResult.foodData,
    job.result?.data,
    rawResult.data,
    job.result?.mealBuild ? toPendingFoodLog(job.result.mealBuild) : null,
    job.mealBuild ? toPendingFoodLog(job.mealBuild) : null,
    rawResult.mealBuild ? toPendingFoodLog(rawResult.mealBuild) : null,
    job.messages?.slice().reverse().find((m: any) => m.pendingFoodLog || m.data?.pendingFoodLog)?.pendingFoodLog,
    job.messages?.slice().reverse().find((m: any) => m.data?.pendingFoodLog)?.data?.pendingFoodLog
  ];

  for (const cand of candidates) {
    if (isValidFoodLog(cand)) return cand;
  }

  const items = rawResult.itemsBreakdown || rawResult.items || rawResult.scoutItems || job.result?.scoutItems || [];
  if (items.length > 0 || rawResult.name || rawResult.title || job.result?.name) {
    return {
      itemsBreakdown: items,
      items: items,
      nutrients: rawResult.nutrients || job.result?.nutrients || {},
      name: rawResult.name || rawResult.title || rawResult.content?.name || job.result?.name || 'Meal',
      title: rawResult.name || rawResult.title || rawResult.content?.name || job.result?.name || 'Meal',
      benefits: rawResult.benefits || rawResult.content?.benefits || [],
      risks: rawResult.risks || rawResult.content?.risks || [],
      recommendation: rawResult.recommendation || rawResult.content?.recommendation || '',
      verdict: rawResult.verdict || rawResult.content?.verdict || '',
      message: rawResult.message || rawResult.text || job.result?.message || job.result?.text || '',
      imageUrls: rawResult.imageUrls || job.result?.imageUrls || [],
      photoUrl: rawResult.photoUrl || job.result?.photoUrl || job.photoUrl
    };
  }

  return null;
}
import { humanizeJobFailure } from '../utils/jobFailure';
import { ImageStore } from '../jobs/ImageStore';
import { reserveCredits } from '../jobs/credits';
import { JobQueueRunner } from '../jobs/JobQueueRunner';
import { recordBreadcrumb, clearBreadcrumbs } from '../utils/breadcrumbTracker';
import { consumeGoldenAnalyzeToken, GOLDEN_NEW_ANALYZE_EVENT } from '../utils/goldenIngestClient';

import { PRIMARY_NUTRIENTS, formatNutrientDisplayValue } from '../utils/nutrients';
import { AgentType, AGENT_REGISTRY, getAgentRolloutStatus } from '../utils/agentConfig';
import { getAvailableCredits, deductAgentCredits } from '../utils/creditManager';
import { getAdminSettings } from '../utils/userManagement';
const isValidValue = (v: unknown): boolean =>
  v !== null && v !== undefined && v !== '' && v !== 'N/A' && v !== 'null';

const formatNutrientValue = (value: unknown, unit: string): string => {
  if (!isValidValue(value)) return '—';
  return formatNutrientDisplayValue(value, unit);
};
interface BiomarkerEntry {
  biomarker: string;
  date: string;
  value: number;
  unit: string;
}

export function safeJSONStringify(obj: any): string {
  const seen = new WeakSet();
  return JSON.stringify(obj, (key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return undefined;
      }
      seen.add(value);
    }
    return value;
  });
}

type FoodAgentExecutorInput = any;

async function* executeMedicalAgent(input: any): AsyncGenerator<any, void, unknown> {}

function parseJsonOffline(jsonText: string): BiomarkerEntry[] {
  const entries: BiomarkerEntry[] = [];
  if (!jsonText) return entries;
  
  try {
    const cleanedText = jsonText.replace(/```(?:json)?/gi, '').trim();
    const parsed = JSON.parse(cleanedText);
    const rawList = Array.isArray(parsed) 
      ? parsed 
      : (parsed?.biomarkers || parsed?.entries || parsed?.data || []);
    if (Array.isArray(rawList)) {
      rawList.forEach((item: any) => {
        if (item && typeof item === 'object') {
          const bName = item.biomarker || item.name || item.key;
          const bDate = item.date || item.timestamp;
          const bVal = item.value !== undefined ? item.value : item.val;
          if (bName && bDate) {
            entries.push({
              biomarker: String(bName),
              date: String(bDate),
              value: Number(bVal) || 0,
              unit: item.unit ? String(item.unit) : ''
            });
          }
        }
      });
    }
  } catch (e) {
    console.warn("parseJsonOffline: standard parser failed, falling back to regex", e);
  }

  if (entries.length > 0) {
    return entries;
  }

  const lines = jsonText.split(/\r?\n|\\n/);
  let currentEntry: Partial<BiomarkerEntry> = {};
  
  for (let line of lines) {
    line = line.trim();
    if (line.startsWith('-') || line.startsWith('biomarker:')) {
      if (currentEntry.biomarker) {
        entries.push(currentEntry as BiomarkerEntry);
      }
      currentEntry = {};
    }
    
    const biomarkerMatch = line.match(/(?:-\s+)?biomarker:\s*(.*)/i);
    if (biomarkerMatch) {
      currentEntry.biomarker = biomarkerMatch[1].replace(/['"]/g, '').trim();
      continue;
    }
    
    const dateMatch = line.match(/date:\s*([\d-]+)/i);
    if (dateMatch) {
      currentEntry.date = dateMatch[1].trim();
      continue;
    }
    
    const valueMatch = line.match(/value:\s*([\d.]+)/i);
    if (valueMatch) {
      currentEntry.value = parseFloat(valueMatch[1]);
      continue;
    }
    
    const unitMatch = line.match(/unit:\s*(.*)/i);
    if (unitMatch) {
      currentEntry.unit = unitMatch[1].replace(/['"]/g, '').trim();
      continue;
    }
  }
  
  if (currentEntry.biomarker) {
    entries.push(currentEntry as BiomarkerEntry);
  }
  
  return entries;
}

function getOfflineCategorization(name: string) {
  const lowerName = name.toLowerCase();
  
  if (lowerName.includes('alt') || lowerName.includes('ast') || lowerName.includes('alp') || lowerName.includes('bilirubin') || lowerName.includes('liver') || lowerName.includes('ggt')) {
    return {
      riskCategories: ['Liver & hepatitis stress'],
      standardMedicalGrouping: 'Hepatic',
      potentialMedicalConditions: ['Fatty Liver', 'Hepatitis Stress']
    };
  }
  
  if (lowerName.includes('creatinine') || lowerName.includes('egfr') || lowerName.includes('urea') || lowerName.includes('kidney') || lowerName.includes('bun') || lowerName.includes('uric acid')) {
    return {
      riskCategories: ['Kidney & hydration'],
      standardMedicalGrouping: 'Renal',
      potentialMedicalConditions: ['Chronic Kidney Disease', 'Hydration Issues']
    };
  }
  
  if (lowerName.includes('glucose') || lowerName.includes('hba1c') || lowerName.includes('insulin') || lowerName.includes('cholesterol') || lowerName.includes('ldl') || lowerName.includes('hdl') || lowerName.includes('triglycerides') || lowerName.includes('tg') || lowerName.includes('sugar') || lowerName.includes('metabolic')) {
    return {
      riskCategories: ['Metabolic & glycemic', 'Cardiovascular'],
      standardMedicalGrouping: 'Metabolic',
      potentialMedicalConditions: ['Diabetes Risk', 'Insulin Resistance', 'Cardiovascular Risk']
    };
  }
  
  if (lowerName.includes('hemoglobin') || lowerName.includes('hgb') || lowerName.includes('wbc') || lowerName.includes('rbc') || lowerName.includes('platelet') || lowerName.includes('plt') || lowerName.includes('hematocrit') || lowerName.includes('mcv') || lowerName.includes('mch') || lowerName.includes('anemia') || lowerName.includes('iron') || lowerName.includes('ferritin')) {
    return {
      riskCategories: ['Hematology'],
      standardMedicalGrouping: 'Hematology',
      potentialMedicalConditions: ['Anemia', 'Hematology Disbalance']
    };
  }
  
  if (lowerName.includes('weight') || lowerName.includes('height') || lowerName.includes('bmi') || lowerName.includes('bp') || lowerName.includes('blood pressure') || lowerName.includes('heart rate') || lowerName.includes('pulse')) {
    return {
      riskCategories: ['Cardiovascular'],
      standardMedicalGrouping: 'Biometrics',
      potentialMedicalConditions: ['Hypertension', 'Obesity']
    };
  }
  
  return {
    riskCategories: ['General Health'],
    standardMedicalGrouping: 'Other',
    potentialMedicalConditions: ['General Imbalance']
  };
}

function performOfflineDataAssembly(jsonText: string, bucketMapping: any) {
  const entries = parseJsonOffline(jsonText);
  const bucketsMap: Record<string, any> = {
    'Metabolic': [],
    'Hepatic': [],
    'Renal': [],
    'Hematology': [],
    'Biometrics': [],
    'Other': []
  };
  
  const biomarkerHistory: Record<string, { value: number; date: string; unit: string }[]> = {};
  for (const entry of entries) {
    if (!entry.biomarker) continue;
    if (!biomarkerHistory[entry.biomarker]) {
      biomarkerHistory[entry.biomarker] = [];
    }
    biomarkerHistory[entry.biomarker].push({
      value: entry.value,
      date: entry.date,
      unit: entry.unit
    });
  }
  
  for (const [name, history] of Object.entries(biomarkerHistory)) {
    const mapping = bucketMapping[name] || getOfflineCategorization(name);
    const grouping = mapping.standardMedicalGrouping || 'Other';
    
    const sortedHistory = [...history].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const latest = sortedHistory[0];
    
    const bObj = {
      name,
      riskCategories: mapping.riskCategories || [],
      standardMedicalGrouping: grouping,
      potentialMedicalConditions: mapping.potentialMedicalConditions || [],
      history: history.map(h => {
        const lower = name.toLowerCase();
        let refRange = '0 - 100 ' + h.unit;
        if (lower.includes('glucose')) refRange = '70 - 99 ' + h.unit;
        else if (lower.includes('hba1c')) refRange = '4.0 - 5.6 ' + h.unit;
        else if (lower.includes('alt')) refRange = '7 - 56 ' + h.unit;
        else if (lower.includes('ast')) refRange = '10 - 40 ' + h.unit;
        else if (lower.includes('creatinine')) refRange = '0.6 - 1.2 ' + h.unit;
        
        return {
          date: h.date,
          value: h.value,
          referenceRange: refRange,
          level: "Normal"
        };
      })
    };
    
    if (bucketsMap[grouping]) {
      bucketsMap[grouping].push(bObj);
    } else {
      bucketsMap['Other'].push(bObj);
    }
  }
  
  const buckets = Object.entries(bucketsMap)
    .filter(([_, list]) => list.length > 0)
    .map(([systemName, biomarkers]) => ({
      systemName,
      biomarkers
    }));
    
  return {
    text: "Data successfully processed and categorized offline.",
    entriesCount: entries.length,
    buckets
  };
}

function extractBiomarkerKeysFromJson(jsonStr: string): string[] {
  if (!jsonStr) return [];
  const keys: string[] = [];

  try {
    const cleanedText = jsonStr.replace(/```(?:json)?/gi, '').trim();
    const parsed = JSON.parse(cleanedText);
    const rawList = Array.isArray(parsed) 
      ? parsed 
      : (parsed?.biomarkers || parsed?.entries || parsed?.data || []);
    if (Array.isArray(rawList)) {
      rawList.forEach((item: any) => {
        if (item && typeof item === 'object') {
          const bName = item.biomarker || item.name || item.key;
          if (bName) {
            keys.push(String(bName));
          }
        }
      });
    }
  } catch (e) {
    console.warn("extractBiomarkerKeysFromJson: standard parser failed, falling back to regex", e);
  }

  if (keys.length > 0) {
    return Array.from(new Set(keys)).filter(Boolean);
  }

  const lines = jsonStr.split(/\r?\n|\\n/);
  lines.forEach(line => {
    const trimmed = line.trim();
    const match = trimmed.match(/^(?:-\s*)?biomarker\s*:\s*["']?([^"'\s:]+)["']?/i);
    if (match && match[1]) {
      keys.push(match[1]);
    } else {
      const keyValMatch = trimmed.match(/^([a-zA-Z0-9_-]+)\s*:\s*/);
      if (keyValMatch && keyValMatch[1]) {
        const k = keyValMatch[1].toLowerCase();
        if (k !== 'date' && k !== 'value' && k !== 'unit' && k !== 'biomarker' && k !== 'name') {
          keys.push(keyValMatch[1]);
        }
      }
    }
  });
  return Array.from(new Set(keys)).filter(Boolean);
}

function extractBiomarkerKeysFromPrioritizedConditions(prioritizedConditions: any[]): string[] {
  if (!Array.isArray(prioritizedConditions)) return [];
  const keys: string[] = [];
  prioritizedConditions.forEach(cond => {
    if (cond) {
      if (Array.isArray(cond.biomarkers)) {
        cond.biomarkers.forEach((m: any) => {
          if (m && typeof m.key === 'string') {
            keys.push(m.key);
          }
        });
      }
      if (Array.isArray(cond.biomarkerKeys)) {
        cond.biomarkerKeys.forEach((k: any) => {
          if (typeof k === 'string') {
            keys.push(k);
          }
        });
      }
    }
  });
  return Array.from(new Set(keys)).filter(Boolean);
}

function detectBiomarkersInText(text: string): string[] {
  if (!text) return [];
  const found = new Set<string>();
  const lowerText = text.toLowerCase();
  
  biomarkerDefinitions.forEach(def => {
    const keyLower = def.key.toLowerCase().replace(/_/g, ' ');
    const nameLower = def.name.toLowerCase();
    
    // Check key (as a word boundary if short, otherwise substring)
    const cleanKey = def.key.toLowerCase();
    const isShortKey = cleanKey.length <= 4;
    
    let isKeyInText = false;
    if (isShortKey) {
      const words = lowerText.split(/[^a-zA-Z0-9]/);
      isKeyInText = words.includes(cleanKey);
    } else {
      isKeyInText = lowerText.includes(cleanKey);
    }
    
    const isNameInText = lowerText.includes(nameLower);
    
    if (isNameInText || isKeyInText) {
      found.add(def.name);
    }
  });
  
  return Array.from(found);
}

interface LogChatProps {
  key?: string;
  type: AgentType;
  jobId?: string | null;
  profile?: UserProfile | null;
  isOpen: boolean;
  selectedModelId: string;
  onChangeModelId: (id: string) => void;
  onClose: () => void;
  onLogFood?: (food: FoodLog) => void;
  onLogFoodIdeas?: (ideas: FoodIdea[]) => void;
  onLogMedical?: (
    biomarkers: { [key: string]: number | string }, 
    profileUpdates?: Partial<UserProfile>, 
    date?: string, 
    entries?: { date: string | null; biomarkers: { [key: string]: number | string } }[],
    modificationCommand?: { action: 'update_biomarker' | 'update_profile' | 'remove_biomarker'; keyName: string; newValue?: string | number; date?: string }[],
    skipClose?: boolean
  ) => void;
  biomarkers?: { [key: string]: number | string };
  foodLogs?: FoodLog[];
  report?: any;
  actions?: any[];
  googleSteps?: number | null;
  agentType?: 'agent1' | 'agent2' | 'agent3' | 'agent4' | 'agent5' | 'agent7' | 'data_review' | 'health_baseline' | 'biomarker_review' | 'catalog_clean' | null;
  agentTask?: string | null;
  reviewBiomarkerKey?: string;
  onOpenAgentFromFrontDesk?: (agentType: 'agent1' | 'agent2' | 'agent3' | 'agent4' | 'agent5' | 'agent7' | 'data_review' | 'health_baseline' | 'biomarker_review' | 'catalog_clean' | null) => void;
  biomarkerHistory?: any[];
  onAgentFinish?: (agentType: string, agentResult: any, extraActions?: any) => Promise<void>;
  onAgentAnalysisSaved?: (agentType: string, agentResult: any, existingId?: string) => Promise<string>;
  onGoToManualEdit?: (errorMsg?: string) => void;
  onSaveProfile?: (profile: UserProfile) => Promise<void>;
  onAddBiomarkerLogs?: (logs: any[]) => void;
  autoSendMessage?: string | null;
  dataReviewBatchIdx?: number | string | null;
  dataReviewBatchKeys?: string[];
  remainingText?: string;
  lastProcessedIndex?: number | null;
  extractedData?: any[];
  currentBatch?: number;
  estimatedTotalMarkers?: number | null;
  batchSize?: number;
  isFirestoreQuotaExceeded?: boolean;
  dataReviewSharedState?: any;
  onDataReviewBatchChange?: (idx: number | string) => void;
  onJobEnqueued?: (jobId: string, kind: 'food' | 'medical') => void;
}

const getSessionId = (): string => {
  if (typeof window === 'undefined') return 'global';
  let id = sessionStorage.getItem('app_session_id');
  if (!id) {
    id = `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    sessionStorage.setItem('app_session_id', id);
  }
  return id;
};

export default function LogChat({ 
  type, 
  jobId,
  profile, 
  isOpen, 
  selectedModelId, 
  onChangeModelId, 
  onClose, 
  onLogFood, 
  onLogFoodIdeas,
  onLogMedical, 
  biomarkers,
  foodLogs,
  report,
  actions = [],
  googleSteps = null,
  agentType = null,
  agentTask = null,
  reviewBiomarkerKey,
  onOpenAgentFromFrontDesk,
  biomarkerHistory = [],
  onAgentFinish,
  onAgentAnalysisSaved,
  onGoToManualEdit,
  onSaveProfile,
  onAddBiomarkerLogs,
  autoSendMessage = null,
  dataReviewBatchIdx = null,
  dataReviewBatchKeys = [],
  remainingText = '',
  lastProcessedIndex = null,
  extractedData = [],
  currentBatch = 1,
  estimatedTotalMarkers = null,
  batchSize = 20,
  isFirestoreQuotaExceeded = false,
  dataReviewSharedState = null,
  onDataReviewBatchChange,
  onJobEnqueued
}: LogChatProps) {
  const activeAgentKey = (type === 'medical' && agentType) ? (agentType as AgentType) : (type as AgentType);
  const activeAgentConfig = AGENT_REGISTRY[activeAgentKey] || AGENT_REGISTRY[type as AgentType];
  const isUnified = ['food', 'medical', 'food_idea', 'daily_recommendation'].includes(type) && getAgentRolloutStatus(type as AgentType) === 'unified';

  const isAgent = (targetType: AgentType) => {
    if (['medical', 'food', 'food_idea', 'daily_recommendation'].includes(targetType)) {
      return type === targetType;
    }
    if (isUnified) return activeAgentConfig?.id === targetType;
    return type === targetType;
  };

  const isSendingRef = useRef(false);
  const lastSendClickTimeRef = useRef<number>(0);


  const [showDataUsed, setShowDataUsed] = useState(false);
  const [showFullScreenConv, setShowFullScreenConv] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(true);
  const [isSendingLogs, setIsSendingLogs] = useState(false);
  const [logsSendStatus, setLogsSendStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [activeModalTableRows, setActiveModalTableRows] = useState<any[] | null>(null);
  const [activeModalTitle, setActiveModalTitle] = useState<string>('Consolidated Clinical Biomarker Log');
  const [activeInstructionAgentType, setActiveInstructionAgentType] = useState<string | null>(null);
  const [activeInstructionPrompt, setActiveInstructionPrompt] = useState<string | null>(null);
  const [expandedAudits, setExpandedAudits] = useState<Record<string, boolean>>({});
  const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>({});
  const [fullScreenJson, setFullScreenJson] = useState<string | null>(null);
  const [localBatchSize, setLocalBatchSize] = useState(batchSize || 20);
  const [numberOfBatches, setNumberOfBatches] = useState<number>(() => {
    const saved = parseInt(localStorage.getItem('agent_num_batches') || '50', 10);
    return (isNaN(saved) || saved < 10) ? 50 : saved;
  });

  const [showFullScreenDebugLogs, setShowFullScreenDebugLogs] = useState(false);
  const [debugLogs, setDebugLogs] = useState<{ timestamp: string, message: string }[]>([]);
  const [isDebugSendingLogs, setIsDebugSendingLogs] = useState(false);
  const [debugLogsSendStatus, setDebugLogsSendStatus] = useState<'idle' | 'success' | 'error'>('idle');

  const [liveThoughts, setLiveThoughts] = useState<{scout?: string, dietitian?: string, dbSearchLog?: string, activeStage?: string, backendLogs?: string, globalLiveLogs?: string}>({});

  const safeParseResponse = async (res: Response, fallback: any = {}) => {
    try {
      const contentType = res.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        const text = await res.text().catch(() => "");
        if (!text || !text.trim()) return fallback;
        try {
          return JSON.parse(text);
        } catch (e) {
          console.warn("Could not parse response as JSON:", e);
          return fallback;
        }
      }
      const text = await res.text().catch(() => "");
      console.warn("Expected JSON response, but received non-JSON. Status:", res.status, "Content-Type:", contentType, "Body slice:", text.substring(0, 150));
      return fallback;
    } catch (e) {
      console.warn("Failed to parse response as JSON:", e);
      return fallback;
    }
  };

  const fetchDebugLogs = async () => {
    try {
      const sessionId = getSessionId();
      const res = await fetch('/api/gemini/debug-logs', {
        headers: {
          'X-Session-ID': sessionId
        }
      });
      if (res.ok) {
        const data = await safeParseResponse(res, null);
        if (data && Array.isArray(data.logs)) {
          setDebugLogs(data.logs);
        }
      }
    } catch {
      /* ignore background fetch errors */
    }
  };

  const handleClearDebugLogs = async () => {
    try {
      const sessionId = getSessionId();
      const res = await fetch('/api/gemini/clear-debug-logs', { 
        method: 'POST',
        headers: {
          'X-Session-ID': sessionId
        }
      });
      if (res.ok) {
        const data = await safeParseResponse(res, null);
        setDebugLogs(data && data.logs ? data.logs : []);
      }
    } catch (err) {
      console.error("Error clearing debug logs:", err);
    }
  };

  const handleSendDebugLogsToAdmin = async () => {
    setIsDebugSendingLogs(true);
    setDebugLogsSendStatus('idle');
    try {
      const logsText = debugLogs.map(l => `[${l.timestamp}] ${l.message}`).join('\\n');
      const sessionId = getSessionId();
      
      const res = await fetch('/api/gemini/send-logs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-ID': sessionId
        },
        body: JSON.stringify({ logsText })
      });
      
      if (res.ok) {
        try {
          const res2 = await fetch('/api/gemini/debug-logs', {
            headers: {
              'X-Session-ID': sessionId
            }
          });
          if (res2.ok) {
            const data = await safeParseResponse(res2, null);
            if (data && Array.isArray(data.logs)) {
              setDebugLogs(data.logs);
            }
          }
        } catch (err) {
          console.warn("Error fetching debug logs:", err);
        }
        setDebugLogsSendStatus('success');
        setTimeout(() => setDebugLogsSendStatus('idle'), 3000);
      } else {
        setDebugLogsSendStatus('error');
        const subject = encodeURIComponent(`Healthy App Debug Logs - Session ${sessionId}`);
        const body = encodeURIComponent(`Hello Admin,

Here is the compiled log history for session ${sessionId}:

${logsText}`);
        window.open(`mailto:cwah.liu@gmail.com?subject=${subject}&body=${body}`, '_blank');
      }
    } catch (err) {
      console.error("Error sending logs:", err);
      setDebugLogsSendStatus('error');
    } finally {
      setIsDebugSendingLogs(false);
    }
  };

  useEffect(() => {
    let interval: any;
    if (showFullScreenDebugLogs) {
      fetchDebugLogs();
      interval = setInterval(fetchDebugLogs, 1500);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [showFullScreenDebugLogs]);
  useEffect(() => {
    localStorage.setItem('agent_num_batches', String(numberOfBatches));
  }, [numberOfBatches]);

  const handleSendLogToAdmin = async () => {
    setIsSendingLogs(true);
    setLogsSendStatus('idle');
    try {
      const logsText = messages.map(m => `[${m.role.toUpperCase()}]\n${m.content}`).join('\n\n---\n\n');
      const sessionId = auth.currentUser?.uid || 'anonymous';
      
      const res = await fetch('/api/gemini/send-logs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-ID': sessionId
        },
        body: JSON.stringify({ logsText })
      });
      
      if (res.ok) {
        setLogsSendStatus('success');
        
        // Native mailto link fallback
        const subject = encodeURIComponent(`Healthy App Food Chat Logs - User ${sessionId}`);
        const body = encodeURIComponent(`Hello Admin,

Here is the compiled food log history for user ${sessionId}:

${logsText}`);
        window.open(`mailto:cwah.liu@gmail.com?subject=${subject}&body=${body}`, '_blank');
      } else {
        setLogsSendStatus('error');
      }
    } catch (err) {
      console.error("Error sending logs:", err);
      setLogsSendStatus('error');
    } finally {
      setIsSendingLogs(false);
      setTimeout(() => setLogsSendStatus('idle'), 4000);
    }
  };

  const activeFoodLogs = React.useMemo(() => (foodLogs || []).filter(f => f.sync_state !== 'delete'), [foodLogs]);
  const activeHistory = (biomarkerHistory || []).filter(h => h.sync_state !== 'delete');
  const userIdentifier = profile?.email?.toLowerCase().replace(/[^a-z0-9]/g, '_') || 'guest';

  const payloadStorageKey = agentType ? `last_sent_payload_${userIdentifier}_${type}_${agentType}_${dataReviewBatchIdx ?? 'none'}` : `last_sent_payload_${userIdentifier}_${type}`;
  const chatStorageKey = agentType ? `chat_messages_${userIdentifier}_${type}_${agentType}_${dataReviewBatchIdx ?? 'none'}` : `chat_messages_${userIdentifier}_${type}`;

  const [lastSentPayload, setLastSentPayload] = useState<any>(null);
  const [messages, setMessagesInternal] = useState<ChatMessage[]>([]);
  const [flagMsg, setFlagMsg] = useState<ChatMessage | null>(null);
  const [userSelectedMode, setUserSelectedMode] = useState<"review" | "compare" | "edit">("review");

  const hasUnsavedChangesRef = useRef<boolean>(false);
  const activeAnalysisIdRef = useRef<string | null>(null);

  const setMessages = (
    update: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[]),
    markAsUnsaved = true
  ) => {
    if (markAsUnsaved) {
      hasUnsavedChangesRef.current = true;
    }
    setMessagesInternal(prev => {
      let newVal = typeof update === 'function' ? update(prev) : update;
      if (isAgent('food') && newVal.length > 11) {
        newVal = [newVal[0], ...newVal.slice(-10)];
      }
      return newVal;
    });
  };
  
  // Synchronized Multi-select Search Mode States for Bottom Action Bar
  const [isSelectingMode, setIsSelectingMode] = useState<boolean>(false);
  const [selectingMsgId, setSelectingMsgId] = useState<string | null>(null);
  const [selectedItemKeys, setSelectedItemKeys] = useState<string[]>([]);
  const foodCardActionRef = useRef<any>(null);
  const [activeConversationId, setActiveConversationId] = useState<string>(() => {
    const key = `active_session_id_${type || 'medical'}_${agentType || 'none'}`;
    const saved = localStorage.getItem(key);
    return saved || `session_${Date.now()}`;
  });
  const [conversationsList, setConversationsList] = useState<any[]>([]);
  const [isLoadingConversations, setIsLoadingConversations] = useState<boolean>(false);

  const getWelcomeMessage = () => {
    return {
      id: `welcome_${type}_${agentType || 'default'}_${Date.now()}`,
      role: 'assistant' as const,
      content: activeAgentConfig?.welcomeMessage
        ? (typeof activeAgentConfig.welcomeMessage === 'function' ? activeAgentConfig.welcomeMessage({ dataReviewBatchIdx }) : activeAgentConfig.welcomeMessage)
        : 'Hello! How can I help you today?',
      timestamp: new Date().toISOString()
    };
  };

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingSaveRef = useRef<(() => void) | null>(null);

  const debouncedSaveConversation = (id: string, msgs: ChatMessage[], payload: any) => {
    if (!hasUnsavedChangesRef.current) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    pendingSaveRef.current = () => {
      saveConversationToFirestore(id, msgs, payload);
      hasUnsavedChangesRef.current = false;
    };
    saveTimeoutRef.current = setTimeout(() => {
      if (pendingSaveRef.current) {
        pendingSaveRef.current();
        pendingSaveRef.current = null;
      }
    }, 800);
  };

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      if (pendingSaveRef.current) {
        pendingSaveRef.current();
        pendingSaveRef.current = null;
      }
    };
  }, []);

  const compressLargeImagesInObject = async (obj: any): Promise<any> => {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === 'string') {
      if (obj.startsWith('data:image/') && obj.length > 8000) {
        try {
          // STRICT RULE: Compress base64 to maximum 400x400 pixels at 0.5 quality to prevent Firestore exhaustion
          const compressed = await compressImage(obj, 400, 400, 0.5);
          return compressed;
        } catch (e) {
          console.warn("Failed to compress base64 image in object:", e);
          if (obj.length > 900000) {
            return obj.substring(0, 100) + "... [large base64 image stripped to prevent Firestore size limit error]";
          }
          return obj;
        }
      }
      return obj;
    }
    if (Array.isArray(obj)) {
      const arr = [];
      for (const item of obj) {
        arr.push(await compressLargeImagesInObject(item));
      }
      return arr;
    }
    if (typeof obj === 'object') {
      const cleaned: any = {};
      for (const [k, v] of Object.entries(obj)) {
        cleaned[k] = await compressLargeImagesInObject(v);
      }
      return cleaned;
    }
    return obj;
  };

  const saveConversationToFirestore = async (id: string, msgs: ChatMessage[], payload: any) => {
    const userId = auth.currentUser?.uid;
    if (!userId) {
      try {
        // Strip heavy base64 images before saving to sessionStorage/localStorage to prevent quota crashes.
        // IndexedDB below still keeps the full, unstripped copy — it has a much higher capacity ceiling
        // and is already treated as the authoritative guest store elsewhere (see loadConversationsFromFirestore,
        // which reads IndexedDB first for guests specifically to retain full images).
        const strippedMsgs = msgs.map(m => {
          const copy = { ...m };
          if (copy.imageUrls) copy.imageUrls = [];
          if (copy.imageUrl) delete copy.imageUrl;
          return copy;
        });
        sessionStorage.setItem(chatStorageKey, JSON.stringify(strippedMsgs));
        if (payload) sessionStorage.setItem(payloadStorageKey, JSON.stringify(payload));
        // Fallback to localStorage and IndexedDB to survive page reloads and tab closures
        localStorage.setItem(chatStorageKey, JSON.stringify(strippedMsgs));
        if (payload) localStorage.setItem(payloadStorageKey, JSON.stringify(payload));
        await safeIdbSet(`${chatStorageKey}_guest_${id}`, msgs);
        if (payload) await safeIdbSet(`${payloadStorageKey}_guest_${id}`, payload);
      } catch (e) {
        console.warn("Quota exceeded in sessionStorage/localStorage/IndexedDB");
      }
      return;
    }

    // Always preserve full, complete messages with images in IndexedDB to prevent image loss on reload
    try {
      await safeIdbSet(`${chatStorageKey}_${userId}_${id}`, msgs);
      if (payload) {
        await safeIdbSet(`${payloadStorageKey}_${userId}_${id}`, payload);
      }
    } catch (e) {
      console.warn("Failed to save to IndexedDB:", e);
    }

    const isManualSyncOnly = localStorage.getItem('auto_sync_disabled') === 'true';
    if (isManualSyncOnly || checkQuotaFlag() || isFirestoreQuotaExceeded) {
      try {
        // Strip heavy base64 images before saving to localStorage to prevent quota crashes!
        const strippedMsgs = msgs.map(m => {
           const copy = { ...m };
           if (copy.imageUrls) copy.imageUrls = [];
           if (copy.imageUrl) delete copy.imageUrl;
           return copy;
        });
        
        try {
          localStorage.setItem(`${chatStorageKey}_${userId}_${id}`, JSON.stringify(strippedMsgs));
          if (payload) localStorage.setItem(`${payloadStorageKey}_${userId}_${id}`, JSON.stringify(payload));
        } catch (quotaErr) {
          pruneLocalStorageToFreeSpace();
          try {
            localStorage.setItem(`${chatStorageKey}_${userId}_${id}`, JSON.stringify(strippedMsgs));
            if (payload) localStorage.setItem(`${payloadStorageKey}_${userId}_${id}`, JSON.stringify(payload));
          } catch (retryErr) {
            // Silently bypass as IndexedDB holds the primary full copy
          }
        }
        
        // Also update the local list so the sidebar is completely in sync and beautiful
        const title = msgs.length > 1 
          ? (msgs[1].role === 'user' ? msgs[1].content.slice(0, 30) + '...' : `Session - ${new Date(msgs[0].timestamp).toLocaleDateString()}`)
          : `Session - ${new Date().toLocaleDateString()}`;
        
        setConversationsList(prev => {
          const existingIdx = prev.findIndex(c => c.id === id);
          const updatedItem = {
            id,
            userId,
            type: type || 'medical',
            agentType: agentType || null,
            title,
            createdAt: msgs[0]?.timestamp || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            messages: msgs,
            lastSentPayload: payload || null
          };
          if (existingIdx >= 0) {
            const nextList = [...prev];
            nextList[existingIdx] = updatedItem;
            return nextList;
          } else {
            return [updatedItem, ...prev];
          }
        });
      } catch (e) {
        console.warn("Quota exceeded in localStorage");
      }
      return;
    }

    // M23 free-tier kill-switch: chat is device-local only (IDB).
    // Cross-device chat is out of scope until a dedicated non-Firestore design.
    console.log('[FreeTier] chat cloud write disabled');
    try {
      const indexKey = `chat_index_${userId}_${type || 'medical'}_${agentType || 'none'}`;
      const prev = JSON.parse(localStorage.getItem(indexKey) || '[]');
      const title = msgs.length > 1 
        ? (msgs[1].role === 'user' ? msgs[1].content.slice(0, 30) + '...' : `Session - ${new Date(msgs[0].timestamp).toLocaleDateString()}`)
        : `Session - ${new Date().toLocaleDateString()}`;
      const entry = { id, title, updatedAt: new Date().toISOString(), type: type || 'medical', agentType: agentType || null };
      const next = [entry, ...(Array.isArray(prev) ? prev.filter((x: any) => x && x.id !== id) : [])].slice(0, 50);
      localStorage.setItem(indexKey, JSON.stringify(next));
    } catch (indexErr) {
      console.warn('[FreeTier] chat index update failed', indexErr);
    }
    return;
  };

  const migrateMessages = (msgs: any[]) => msgs.map(msg => {
    const newMsg = { ...msg };
    if (!newMsg.data) {
      newMsg.data = {};
      const legacyFields = ['pendingFoodLog', 'pendingFoodIdeas', 'pendingBiomarkers', 'pendingBiomarkerEntries', 'pendingCustomBiomarkerDefs', 'proposal', 'bucketMapping', 'agentResult'];
      legacyFields.forEach(f => {
        if (newMsg[f] !== undefined) {
          newMsg.data[f] = newMsg[f];
          delete newMsg[f];
        }
      });
    }
    return newMsg;
  });

  const loadConversationsFromFirestore = async () => {
    const userId = auth.currentUser?.uid;
    if (!userId) {
      let savedMsgs = null;
      let savedPayload = null;

      try {
        // Try IndexedDB first (retains full images and detail payload)
        const idbSaved = await idbGet(`${chatStorageKey}_guest_${activeConversationId}`);
        if (idbSaved) {
          savedMsgs = idbSaved;
          savedPayload = await idbGet(`${payloadStorageKey}_guest_${activeConversationId}`);
        }
      } catch (e) {
        console.warn("Failed to load guest chat from IndexedDB:", e);
      }

      if (!savedMsgs) {
        const saved = sessionStorage.getItem(chatStorageKey) || localStorage.getItem(chatStorageKey);
        if (saved) {
          try {
            savedMsgs = JSON.parse(saved);
            const savedP = sessionStorage.getItem(payloadStorageKey) || localStorage.getItem(payloadStorageKey);
            savedPayload = savedP ? JSON.parse(savedP) : null;
          } catch {}
        }
      }

      if (savedMsgs) {
        setMessages(migrateMessages(savedMsgs), false);
        setLastSentPayload(savedPayload);
      } else {
        const welcome = getWelcomeMessage();
        setMessages([welcome], false);
        setLastSentPayload(null);
      }
      return;
    }

    setIsLoadingConversations(true);
    try {
      // M23 free-tier kill-switch: chat list is loaded from local index only
      const indexKey = `chat_index_${userId}_${type || 'medical'}_${agentType || 'none'}`;
      const localListStr = localStorage.getItem(indexKey);
      let list: any[] = localListStr ? JSON.parse(localListStr) : [];
      
      list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      const cappedList = list.slice(0, 30);
      setConversationsList(cappedList);

      if (cappedList.length > 0) {
        const match = cappedList.find(c => c.id === activeConversationId) || cappedList[0];
        setActiveConversationId(match.id);
        
        let localSaved = null;
        let localPayload = null;
        try {
          const idbSaved = await idbGet(`${chatStorageKey}_${userId}_${match.id}`);
          if (idbSaved) {
            localSaved = idbSaved;
            localPayload = await idbGet(`${payloadStorageKey}_${userId}_${match.id}`);
          }
        } catch (e) {
          console.warn("Failed to load from IndexedDB:", e);
        }

        if (!localSaved) {
          const lsSaved = localStorage.getItem(`${chatStorageKey}_${userId}_${match.id}`);
          if (lsSaved) {
            try {
              localSaved = JSON.parse(lsSaved);
              const lsPayload = localStorage.getItem(`${payloadStorageKey}_${userId}_${match.id}`);
              if (lsPayload) {
                localPayload = JSON.parse(lsPayload);
              }
            } catch {}
          }
        }

        if (localSaved) {
          try {
            setMessages(migrateMessages(localSaved), false);
            setLastSentPayload(localPayload || null);
          } catch {
            setMessages(migrateMessages(match.messages || []), false);
            setLastSentPayload(match.lastSentPayload || null);
          }
        } else {
          setMessages(migrateMessages(match.messages || []), false);
          setLastSentPayload(match.lastSentPayload || null);
        }
      } else {
        const newId = `session_${Date.now()}`;
        setActiveConversationId(newId);
        const welcome = getWelcomeMessage();
        setMessages([welcome], false);
        setLastSentPayload(null);
        setConversationsList([{
          id: newId,
          type: type || 'medical',
          agentType: agentType || null,
          title: 'New Session',
          updatedAt: new Date().toISOString(),
          messages: [welcome]
        }]);
      }
    } catch (err: any) {
      console.log("Error loading conversations from local index:", err?.message || err);
    } finally {
      setIsLoadingConversations(false);
    }
  };

  const handleNewSession = async () => {
    if (type === 'food') setUserSelectedMode('review');
    const newId = `session_${Date.now()}`;
    setActiveConversationId(newId);
    const welcome = getWelcomeMessage();
    setMessages([welcome], false);
    setLastSentPayload(null);
    setConversationsList(prev => [
      {
        id: newId,
        type: type || 'medical',
        agentType: agentType || null,
        title: `Session - ${new Date().toLocaleDateString()}`,
        updatedAt: new Date().toISOString(),
        messages: [welcome]
      },
      ...prev
    ]);
  };

  const handleDeleteSession = async (sessId: string) => {
    const userId = auth.currentUser?.uid;
    if (!userId) return;

    try {
      trackApiCall('firebase_delete', `Firestore Delete - Remove Chat Session (${sessId}) (permanently deletes specified chat history from Cloud Database)`);
      await Promise.resolve();
      const updatedList = conversationsList.filter(c => c.id !== sessId);
      setConversationsList(updatedList);
      
      if (sessId === activeConversationId) {
        if (updatedList.length > 0) {
          const nextSess = updatedList[0];
          setActiveConversationId(nextSess.id);
          setMessages(migrateMessages(nextSess.messages || []), false);
          setLastSentPayload(nextSess.lastSentPayload || null);
        } else {
          handleNewSession();
        }
      }
    } catch (err) {
      console.error("Error deleting session:", err);
    }
  };

  const handleSwitchSession = async (sessId: string) => {
    if (type === 'food') setUserSelectedMode('review');
    const found = conversationsList.find(c => c.id === sessId);
    if (found) {
      setActiveConversationId(sessId);
      
      const userId = auth.currentUser?.uid || 'guest';
      let fullMessages = null;
      let fullPayload = null;
      try {
        const idbSaved = await idbGet(`${chatStorageKey}_${userId}_${sessId}`);
        if (idbSaved) {
          fullMessages = idbSaved;
          fullPayload = await idbGet(`${payloadStorageKey}_${userId}_${sessId}`);
        } else {
          const guestSaved = await idbGet(`${chatStorageKey}_guest_${sessId}`);
          if (guestSaved) {
            fullMessages = guestSaved;
            fullPayload = await idbGet(`${payloadStorageKey}_guest_${sessId}`);
          }
        }
      } catch (e) {
        console.warn("Failed to load full session from IndexedDB:", e);
      }

      if (fullMessages) {
        setMessages(migrateMessages(fullMessages), false);
        setLastSentPayload(fullPayload || null);
      } else {
        setMessages(migrateMessages(found.messages || []), false);
        setLastSentPayload(found.lastSentPayload || null);
      }
    }
  };

  useEffect(() => {
    const userId = auth.currentUser?.uid || 'guest';
    if (conversationsList && conversationsList.length > 0) {
      const lightweightList = conversationsList.map(c => ({
        id: c.id,
        userId: c.userId || userId,
        type: c.type,
        agentType: c.agentType,
        title: c.title,
        createdAt: c.createdAt || new Date().toISOString(),
        updatedAt: c.updatedAt || new Date().toISOString(),
      }));
      const listKey = `conversations_list_${type || 'medical'}_${agentType || 'none'}_${userId}`;
      safeIdbSet(listKey, lightweightList).catch(err => {
        console.warn("Failed to save lightweight conversations list to IndexedDB:", err);
      });
    }
  }, [conversationsList, type, agentType]);

  useEffect(() => {
    if (activeConversationId) {
      const key = `active_session_id_${type || 'medical'}_${agentType || 'none'}`;
      localStorage.setItem(key, activeConversationId);
    }
  }, [activeConversationId, type, agentType]);

  useEffect(() => {
    if (isOpen) {
      const qid = generateQueryId();
      setActiveQueryId(qid);
      if (messages.length <= 1 && !jobId) {
        loadConversationsFromFirestore();
      }
    } else {
      setActiveQueryId(null);
      if (pendingSaveRef.current) {
        pendingSaveRef.current();
        pendingSaveRef.current = null;
      }
    }
  }, [auth.currentUser?.uid, type, agentType, isOpen, jobId]);

  useEffect(() => {
    if (isOpen && currentBatch === 1) {
      activeAnalysisIdRef.current = null;
    }
  }, [isOpen, currentBatch]);

  useEffect(() => {
    if (isOpen && messages.length === 0 && !jobId) {
      setMessages([getWelcomeMessage()], false);
    }
  }, [isOpen, messages.length, jobId]);

  useEffect(() => {
    if (activeConversationId && messages && messages.length > 1) {
      // Do not save to Firestore while the AI is actively streaming to prevent quota exhaustion
      if (messages.some(m => m.isLive)) return;
      debouncedSaveConversation(activeConversationId, messages, lastSentPayload);
    }
  }, [messages, lastSentPayload, activeConversationId]);

  const [inputText, setInputText] = useState('');
  const [budget, setBudget] = useState(() => localStorage.getItem('food_budget') || '');
  const [currency, setCurrency] = useState(() => localStorage.getItem('food_currency') || 'GBP');
  const [maxDistance, setMaxDistance] = useState(() => {
    const saved = localStorage.getItem('food_max_distance');
    return saved ? parseFloat(saved) : 3;
  });

  useEffect(() => {
    localStorage.setItem('food_budget', budget);
  }, [budget]);

  useEffect(() => {
    localStorage.setItem('food_currency', currency);
  }, [currency]);

  useEffect(() => {
    localStorage.setItem('food_max_distance', String(maxDistance));
  }, [maxDistance]);

  useEffect(() => {
    const savedCurrency = localStorage.getItem('food_currency');
    if (!savedCurrency) {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const isIndo = tz && (tz.includes('Jakarta') || tz.includes('Makassar') || tz.includes('Jayapura') || tz.includes('Asia/Jakarta') || tz.includes('Asia/Makassar') || tz.includes('Asia/Jayapura'));
      if (isIndo) {
        setCurrency('IDR');
        setBudget('100000');
      } else {
        setCurrency('GBP');
        setBudget('5');
      }
    }
  }, []);

  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [selectedImagesForAnalysis, setSelectedImagesForAnalysis] = useState<string[]>([]);
  const [imageDates, setImageDates] = useState<string[]>([]);
  const [isCompressing, setIsCompressing] = useState(false);
  const [compressionProgress, setCompressionProgress] = useState({ current: 0, total: 0, percent: 0 });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeReqId, setActiveReqId] = useState<string | null>(null);
  const [isThoughtsExpanded, setIsThoughtsExpanded] = useState(true);
  const [analyzingStepIndex, setAnalyzingStepIndex] = useState(0);
  const [expandedNutrients, setExpandedNutrients] = useState(false);
  const [isEngineSelectorOpen, setIsEngineSelectorOpen] = useState(false);
  const [userLocation, setUserLocation] = useState<{lat: number, lng: number} | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const t = translations[profile?.language || 'en'] || translations.en;

  const isManualModeRef = useRef<boolean>(false);

  const hasReviewedOrAddedFoodLog = React.useMemo(() => {
    if (type !== 'food' || !Array.isArray(messages)) return false;
    return !!([...messages].reverse().find(m => m?.data?.pendingFoodLog || m?.data?.options));
  }, [messages, type]);

  // Lock mode based on job's lockedModeFamily
  useEffect(() => {
    let targetJobId = jobId;
    if (!targetJobId && type === 'food') {
      const isLocalSessionEmpty = messages.length <= 1 || (messages.length === 1 && messages[0].id?.startsWith('welcome_'));
      if (isLocalSessionEmpty) {
        const pendingFoodJobs = JobStore.getAllJobs().filter(j => 
          (j.kind === 'food_log' || j.kind === 'food' || (j as any).kind === 'food_compare') &&
          j.status === 'succeeded' &&
          !j.savedToLog &&
          !j.viewed &&
          (j.result?.pendingFoodLog || j.result?.data?.pendingFoodLog || j.result?.clean_result?.pendingFoodLog || j.result?.items || j.result?.clean_result?.items)
        ).sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime());

        if (pendingFoodJobs.length > 0) {
          targetJobId = pendingFoodJobs[0].id;
        }
      }
    }
    if (type !== 'food' || !targetJobId) return;
    const job = JobStore.getJob(targetJobId);
    if (job && job.lockedModeFamily) {
      if (job.lockedModeFamily === 'A') {
        setUserSelectedMode('review');
      } else if (job.lockedModeFamily === 'D') {
        setUserSelectedMode('compare');
      }
    }
  }, [jobId, isOpen, type, messages.length]);

  // Load messages from background job if jobId is set, or auto-bind to latest unlogged food job if opened on another device
  useEffect(() => {
    if ((type !== 'food' && type !== 'medical') || !isOpen) return;

    let targetJobId = jobId;
    if (!targetJobId && type === 'food') {
      const isLocalSessionEmpty = messages.length <= 1 || (messages.length === 1 && messages[0].id?.startsWith('welcome_'));
      if (isLocalSessionEmpty) {
        const pendingFoodJobs = JobStore.getAllJobs().filter(j => 
          (j.kind === 'food_log' || j.kind === 'food' || (j as any).kind === 'food_compare') &&
          j.status === 'succeeded' &&
          !j.savedToLog &&
          !j.viewed &&
          (j.result?.pendingFoodLog || j.result?.data?.pendingFoodLog || j.result?.clean_result?.pendingFoodLog || j.result?.items || j.result?.clean_result?.items)
        ).sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime());

        if (pendingFoodJobs.length > 0) {
          targetJobId = pendingFoodJobs[0].id;
        }
      }
    }

    if (!targetJobId) return;
    const activeJobId = targetJobId;

    const loadJobMessages = async () => {
      let job = JobStore.getJob(activeJobId);
      if (!job) {
        setIsAnalyzing(false);
        isSendingRef.current = false;
        return;
      }

      if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'awaiting_user' || job.status === 'draft') {
        setIsAnalyzing(false);
        isSendingRef.current = false;
      } else if (job.status === 'running' || job.status === 'queued') {
        setIsAnalyzing(true);
      }

      const remotePhoto =
        job.photoUrl ||
        job.result?.photoUrl ||
        job.result?.clean_result?.photoUrl ||
        (job.result as any)?.data?.photoUrl ||
        (job as any).clean_result?.photoUrl ||
        (job as any).photo_url;

      if (job.status === 'succeeded' && type === 'food') {
        let currentResult = job.result?.clean_result || job.result || (job as any).clean_result || {};
        if (currentResult.is_r2 || (job as any).clean_result?.is_r2 || !resolvePendingFoodLog(job)) {
          try {
            const baseUrl = typeof window !== 'undefined' ? '' : 'http://localhost:3000';
            const r = await fetch(`${baseUrl}/api/jobs/status?jobId=${activeJobId}&full=true`);
            if (r.ok) {
              const fullData = await r.json();
              const backendJob = fullData.jobs?.[0];
              if (backendJob && backendJob.clean_result && !backendJob.clean_result.is_r2) {
                currentResult = backendJob.clean_result;
                job = {
                  ...job,
                  result: currentResult,
                  mealBuild: currentResult.mealBuild || job.mealBuild,
                  photoUrl: currentResult.photoUrl || job.photoUrl,
                  debugUrl: currentResult.debugUrl || job.debugUrl
                };
                JobStore.updateJob(activeJobId, {
                  result: currentResult,
                  mealBuild: currentResult.mealBuild || job.mealBuild,
                  photoUrl: currentResult.photoUrl || job.photoUrl,
                  debugUrl: currentResult.debugUrl || job.debugUrl
                });
              }
            }
          } catch (e) {
            console.warn('[LogChat] Failed to fetch full R2 result:', e);
          }
        }

        const welcome = getWelcomeMessage();
        
        let userMsg: ChatMessage | undefined = job.messages?.find((m: any) => m.role === 'user');
        if (!userMsg) {
          userMsg = {
            id: `msg_user_${activeJobId}`,
            role: 'user',
            content: job.inputSnapshot?.text || '',
            timestamp: job.createdAt,
            imageUrl: (job.inputSnapshot as any)?.hasImage ? 'loading' : undefined
          };
        }

        const remotePhoto =
          job.photoUrl ||
          job.result?.photoUrl ||
          job.result?.clean_result?.photoUrl ||
          (job.result as any)?.data?.photoUrl ||
          (job as any).clean_result?.photoUrl ||
          (job as any).photo_url;

        if ((job.inputSnapshot as any)?.hasImage || userMsg.imageUrl === 'loading' || userMsg.imageUrl === 'Image reference preserved' || remotePhoto) {
          try {
            const images = await ImageStore.getImages(activeJobId);
            if (images && images.length > 0) {
              userMsg.imageUrl = typeof images[0] === 'string' ? images[0] : URL.createObjectURL(images[0] as Blob);
              userMsg.imageUrls = images.map(img => typeof img === 'string' ? img : URL.createObjectURL(img as Blob));
            } else if (remotePhoto) {
              userMsg.imageUrl = remotePhoto;
              userMsg.imageUrls = [remotePhoto];
            }
          } catch (err) {
            console.warn('Failed to load images from ImageStore for LogChat:', err);
            if (remotePhoto) {
              userMsg.imageUrl = remotePhoto;
              userMsg.imageUrls = [remotePhoto];
            }
          }
        }

        const foodLog = resolvePendingFoodLog(job);

        try {
          const imgs = await ImageStore.getImages(activeJobId);
          if (foodLog && imgs?.length) {
            foodLog.imageUrls = imgs.map(img => typeof img === 'string' ? img : URL.createObjectURL(img as Blob));
            foodLog.imageUrl = foodLog.imageUrls[0];
          } else if (foodLog && remotePhoto) {
            foodLog.imageUrl = foodLog.imageUrl || remotePhoto;
            foodLog.imageUrls = foodLog.imageUrls?.length ? foodLog.imageUrls : [remotePhoto];
          }
        } catch (err) {
          console.warn('Failed to load images from ImageStore for LogChat:', err);
          if (foodLog && remotePhoto) {
            foodLog.imageUrl = foodLog.imageUrl || remotePhoto;
            foodLog.imageUrls = foodLog.imageUrls?.length ? foodLog.imageUrls : [remotePhoto];
          }
        }

        const raw = currentResult.raw || (currentResult as any)?.clean_result || currentResult || job.result?.raw || (job.result as any)?.clean_result || job.result || {};
        const snapAgent = (job.inputSnapshot as any)?.agentType;
        const reviewCmds = raw.modificationCommand || raw.agentResult?.modificationCommand;
        const resolvedType = (type === 'food' || foodLog || raw.agentType === 'food' || raw.agentType === 'food_log' || raw.agentType === 'food_analyze' || raw.agentType === 'front_desk')
          ? 'food'
          : (raw.agentType || snapAgent || (Array.isArray(reviewCmds) && reviewCmds.length ? 'biomarker_review' : type));
        const unitMap = collectCatalogUnitMap(profile);
        const isReview = resolvedType === 'biomarker_review' || (type as string) === 'biomarker_review' || agentType === 'biomarker_review';
        const cmds = isReview
          ? enrichReviewModificationCommands(Array.isArray(reviewCmds) ? reviewCmds : [], biomarkerHistory || [], unitMap)
          : reviewCmds;
        const rawContent = raw.message || raw.text || raw.reply || raw.globalSummary || foodLog?.message || 'Analysis complete.';
        const assistantMsg: ChatMessage = {
          id: `msg_assistant_${activeJobId}`,
          role: 'assistant',
          content: isReview ? sanitizeReviewReply(rawContent, cmds, biomarkerHistory || [], unitMap) : rawContent,
          timestamp: job.updatedAt || new Date().toISOString(),
          isLive: false,
          agentResult: raw,
          agentType: resolvedType as any,
          modificationCommand: cmds,
          pendingFoodLog: foodLog,
          data: {
            pendingFoodLog: foodLog,
            hasImage: !!(foodLog?.imageUrl || foodLog?.imageUrls?.length || (job.inputSnapshot as any)?.hasImage),
            photoUrl: job.result?.photoUrl || raw.photoUrl,
            debugUrl: job.result?.debugUrl || raw.debugUrl,
            scoutItems: job.result?.scoutItems || raw.scoutItems || [],
            scoutContentType: raw.scoutContentType,
            mode: raw.mode || (job.inputSnapshot as any)?.mode || 'review',
            comparison: raw.comparison,
            agentResult: {
              ...raw,
              ...(raw.agentResult || {}),
              modificationCommand: cmds,
              proposal: raw.proposal || raw.agentResult?.proposal || null,
              reply: raw.reply || raw.text,
              scoutScratchpad: raw.agentResult?.scoutScratchpad || raw.scoutScratchpad || job.liveThoughts?.scout || '',
              dietitianScratchpad: raw.agentResult?.dietitianScratchpad || raw.dietitianScratchpad || job.liveThoughts?.dietitian || '',
              backendLogs: raw.agentResult?.backendLogs || raw.backendLogs || job.liveThoughts?.backendLogs || '',
              globalLiveLogs: job.liveThoughts?.globalLiveLogs || '',
              dbSearchLog: raw.agentResult?.dbSearchLog || job.liveThoughts?.dbSearchLog || ''
            }
          }
        };
        if (assistantMsg.pendingFoodLog) {
          assistantMsg.pendingFoodLog.id = assistantMsg.pendingFoodLog.id || `food_${Date.now()}`;
          assistantMsg.pendingFoodLog.chatTranscript = [
            { role: userMsg.role, content: userMsg.content, timestamp: userMsg.timestamp },
            { role: assistantMsg.role, content: assistantMsg.content, timestamp: assistantMsg.timestamp }
          ];
        }

        const isDefaultWelcome = !userMsg.content && !userMsg.imageUrl && !userMsg.imageUrls?.length;
        if (isDefaultWelcome) {
          setMessages([assistantMsg], false);
        } else {
          setMessages([welcome, userMsg, assistantMsg], false);
        }
        return;
      }

      if (job.status === 'draft') {
        setMessages([getWelcomeMessage()], false);
        return;
      }

      if (job.messages && job.messages.length > 0) {
        const baseMsgs = migrateMessages(job.messages).map((m: any) => {
          if (m.role === 'user' && typeof m.content === 'string' && m.content.trim().startsWith('{')) {
            try {
              const parsed = JSON.parse(m.content);
              if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
                const entries = Object.entries(parsed);
                if (entries.length > 0 && entries.every(([k, v]) => (!isNaN(Number(k)) || typeof k === 'string') && typeof v === 'number')) {
                  const parts = entries.map(([_, v]) => `${v}g`);
                  return { ...m, content: `Portion Selection: ${parts.join(', ')}` };
                }
              }
            } catch {}
          }
          if (m.role === 'assistant' && (m.agentType === 'food' || m.agentType === 'food_log' || m.agentType === 'food_analyze' || m.agentType === 'front_desk' || type === 'food' || m.pendingFoodLog || m.data?.pendingFoodLog)) {
            const foodLog = m.pendingFoodLog || m.data?.pendingFoodLog || resolvePendingFoodLog(job);
            if (foodLog) {
              return {
                ...m,
                agentType: 'food',
                pendingFoodLog: foodLog,
                data: {
                  ...m.data,
                  pendingFoodLog: foodLog,
                  hasImage: m.data?.hasImage || !!(foodLog.imageUrl || foodLog.imageUrls?.length)
                }
              };
            }
          }
          return m;
        });

        const remotePhoto = job.photoUrl || job.result?.photoUrl || (job.result as any)?.clean_result?.photoUrl;
        try {
          const realImages = await ImageStore.getImages(activeJobId);
          const realUrls = (realImages && realImages.length > 0)
            ? realImages.map((img: any) => typeof img === 'string' ? img : URL.createObjectURL(img as Blob))
            : (remotePhoto ? [remotePhoto] : []);

          if (realUrls.length > 0) {
            baseMsgs.forEach((m: any) => {
              if (!m.imageUrl || m.imageUrl === 'Image reference preserved' || m.imageUrl === 'loading' || m.imageUrl.startsWith('/_/upload/')) {
                m.imageUrl = realUrls[0];
              }
              if (!m.imageUrls || m.imageUrls.some((u: string) => u === 'Image reference preserved' || u.startsWith('/_/upload/'))) {
                m.imageUrls = realUrls;
              }
              if (m.pendingFoodLog) {
                if (!m.pendingFoodLog.imageUrl || m.pendingFoodLog.imageUrl === 'Image reference preserved' || m.pendingFoodLog.imageUrl.startsWith('/_/upload/')) {
                  m.pendingFoodLog.imageUrl = realUrls[0];
                }
                if (!m.pendingFoodLog.imageUrls || m.pendingFoodLog.imageUrls.some((u: string) => u === 'Image reference preserved' || u.startsWith('/_/upload/'))) {
                  m.pendingFoodLog.imageUrls = realUrls;
                }
              }
              if (m.data?.pendingFoodLog) {
                if (!m.data.pendingFoodLog.imageUrl || m.data.pendingFoodLog.imageUrl === 'Image reference preserved' || m.data.pendingFoodLog.imageUrl.startsWith('/_/upload/')) {
                  m.data.pendingFoodLog.imageUrl = realUrls[0];
                }
                if (!m.data.pendingFoodLog.imageUrls || m.data.pendingFoodLog.imageUrls.some((u: string) => u === 'Image reference preserved' || u.startsWith('/_/upload/'))) {
                  m.data.pendingFoodLog.imageUrls = realUrls;
                }
              }
            });
          }
        } catch (err) {
          console.warn('[loadJobMessages] Failed to restore images from ImageStore for job', activeJobId, err);
        }

        const lastMsg = baseMsgs[baseMsgs.length - 1];
        if (job.status === 'awaiting_user') {
          const rawResult = job.result?.clean_result || job.result || (job as any).clean_result || {};
          const portionClarify =
            rawResult.portionClarify ||
            (job.result as any)?.data?.portionClarify;
          const promptMsg = portionClarify?.promptMessage || job.statusMessage || 'Please confirm portion size';
          const scoutItems =
            (Array.isArray(rawResult.scoutItems) && rawResult.scoutItems.length > 0)
              ? rawResult.scoutItems
              : (Array.isArray(portionClarify?.scoutItems) ? portionClarify.scoutItems : []);
          let assistantClarifyMsg = baseMsgs.find((m: any) => m.id === `msg_assistant_clarify_${activeJobId}` || (m.role === 'assistant' && (m.data?.portionClarify || m.data?.needsPortionClarify)));
          if (!assistantClarifyMsg) {
            assistantClarifyMsg = {
              id: `msg_assistant_clarify_${activeJobId}`,
              role: 'assistant',
              content: promptMsg,
              timestamp: job.updatedAt || new Date().toISOString(),
              isLive: false,
              agentType: type as any,
              data: {
                needsPortionClarify: true,
                portionClarify,
                scoutItems,
                photoUrl: job.photoUrl || rawResult.photoUrl,
                debugUrl: job.debugUrl || rawResult.debugUrl,
                agentResult: {
                  scoutItems,
                  activeStage: 'portion_clarify',
                  scoutScratchpad: rawResult.agentResult?.scoutScratchpad || rawResult.scoutScratchpad || job.liveThoughts?.scout || '',
                  backendLogs: rawResult.agentResult?.backendLogs || rawResult.backendLogs || job.liveThoughts?.backendLogs || ''
                }
              }
            };
            baseMsgs.push(assistantClarifyMsg);
          } else if (assistantClarifyMsg.data) {
            assistantClarifyMsg.data.portionClarify = assistantClarifyMsg.data.portionClarify || portionClarify;
            assistantClarifyMsg.data.needsPortionClarify = true;
            assistantClarifyMsg.data.scoutItems = assistantClarifyMsg.data.scoutItems?.length ? assistantClarifyMsg.data.scoutItems : scoutItems;
          }
          setMessages(baseMsgs, false);
        } else if ((job.status === 'queued' || job.status === 'running') && lastMsg?.role === 'user') {
          const liveMsg: ChatMessage = {
            id: `msg_live_${activeJobId}`,
            role: 'assistant',
            content: job.statusMessage || (type === 'medical' ? 'Analyzing medical data in the background...' : 'Analyzing your meal in the background...'),
            timestamp: job.updatedAt || new Date().toISOString(),
            isLive: true,
            agentType: type as any,
            data: {
              userSelectedMode: (job.inputSnapshot as any)?.mode || 'review',
              hasImage: (job.inputSnapshot as any)?.hasImage || false,
              agentResult: {
                scoutScratchpad: job.liveThoughts?.scout || job.statusMessage || '',
                dietitianScratchpad: job.liveThoughts?.dietitian || '',
                backendLogs: job.liveThoughts?.backendLogs || '',
                globalLiveLogs: job.liveThoughts?.globalLiveLogs || '',
                dbSearchLog: job.liveThoughts?.dbSearchLog || ''
              }
            }
          };
          setMessages([...baseMsgs, liveMsg], false);
        } else {
          setMessages(baseMsgs, false);
        }
      } else {
        const welcome = getWelcomeMessage();
        const userMsg: ChatMessage = {
          id: `msg_user_${activeJobId}`,
          role: 'user',
          content: job.inputSnapshot?.text || '',
          timestamp: job.createdAt,
          imageUrl: (job.inputSnapshot as any)?.hasImage ? 'loading' : undefined
        };

        if ((job.inputSnapshot as any)?.hasImage || remotePhoto) {
          try {
            const images = await ImageStore.getImages(activeJobId);
            if (images && images.length > 0) {
              userMsg.imageUrl = typeof images[0] === 'string' ? images[0] : URL.createObjectURL(images[0] as Blob);
              userMsg.imageUrls = images.map(img => typeof img === 'string' ? img : URL.createObjectURL(img as Blob));
            } else if (remotePhoto) {
              userMsg.imageUrl = remotePhoto;
              userMsg.imageUrls = [remotePhoto];
            }
          } catch (err) {
            console.warn('Failed to load images from ImageStore for LogChat:', err);
            if (remotePhoto) {
              userMsg.imageUrl = remotePhoto;
              userMsg.imageUrls = [remotePhoto];
            }
          }
        }

        if (job.status === 'succeeded' && (job.result?.data || job.result?.pendingFoodLog || job.result?.mealBuild || job.mealBuild || job.result?.foodData || type === 'medical' || resolvePendingFoodLog(job))) {
          const foodLog = resolvePendingFoodLog(job);

          try {
            if (foodLog && (!foodLog.imageUrls || foodLog.imageUrls.length === 0 || foodLog.imageUrls.some((u: string) => u.startsWith('blob:')))) {
              const imgs = await ImageStore.getImages(activeJobId);
              if (imgs?.length) {
                const base64Imgs = await Promise.all(imgs.map(async (img) => {
                  if (typeof img === 'string') return img;
                  return new Promise<string>((resolve) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result as string);
                    reader.onerror = () => resolve('');
                    reader.readAsDataURL(img as Blob);
                  });
                }));
                foodLog.imageUrls = base64Imgs.filter(Boolean);
                if (foodLog.imageUrls.length > 0) {
                  foodLog.imageUrl = foodLog.imageUrls[0];
                }
              } else if (remotePhoto) {
                foodLog.imageUrl = foodLog.imageUrl || remotePhoto;
                foodLog.imageUrls = foodLog.imageUrls?.length ? foodLog.imageUrls : [remotePhoto];
              }
            }
          } catch (err) {
            console.warn('Failed to load images from ImageStore for LogChat:', err);
            if (foodLog && remotePhoto) {
              foodLog.imageUrl = foodLog.imageUrl || remotePhoto;
              foodLog.imageUrls = foodLog.imageUrls?.length ? foodLog.imageUrls : [remotePhoto];
            }
          }

          const raw = job.result?.raw || (job.result as any)?.clean_result || job.result || {};
          const snapAgent2 = (job.inputSnapshot as any)?.agentType;
          const reviewCmds2 = raw.modificationCommand || raw.agentResult?.modificationCommand;
          const resolvedType2 = raw.agentType || snapAgent2 || (Array.isArray(reviewCmds2) && reviewCmds2.length ? 'biomarker_review' : type);
          const unitMap2 = collectCatalogUnitMap(profile);
          const isReview2 = resolvedType2 === 'biomarker_review' || (type as string) === 'biomarker_review' || agentType === 'biomarker_review';
          const cmds2 = isReview2
            ? enrichReviewModificationCommands(Array.isArray(reviewCmds2) ? reviewCmds2 : [], biomarkerHistory || [], unitMap2)
            : reviewCmds2;
          const rawContent2 = raw.message || raw.reply || raw.globalSummary || 'Analysis complete.';
          const assistantMsg: ChatMessage = {
            id: `msg_assistant_${activeJobId}`,
            role: 'assistant',
            content: isReview2 ? sanitizeReviewReply(rawContent2, cmds2, biomarkerHistory || [], unitMap2) : rawContent2,
            timestamp: job.updatedAt || new Date().toISOString(),
            agentResult: raw,
            agentType: resolvedType2 as any,
            modificationCommand: cmds2,
            pendingFoodLog: foodLog,
            data: {
              pendingFoodLog: foodLog,
              hasImage: !!(foodLog?.imageUrl || foodLog?.imageUrls?.length || (job.inputSnapshot as any)?.hasImage),
              scoutItems: job.result?.scoutItems || raw.scoutItems || [],
              scoutContentType: raw.scoutContentType,
              mode: raw.mode || (job.inputSnapshot as any)?.mode || 'review',
              comparison: raw.comparison,
              agentResult: {
                ...raw,
                ...(raw.agentResult || {}),
                modificationCommand: cmds2,
                proposal: raw.proposal || raw.agentResult?.proposal || null,
                reply: raw.reply || raw.text,
                scoutScratchpad: raw.agentResult?.scoutScratchpad || raw.scoutScratchpad || job.liveThoughts?.scout || '',
                dietitianScratchpad: raw.agentResult?.dietitianScratchpad || raw.dietitianScratchpad || job.liveThoughts?.dietitian || '',
                backendLogs: raw.agentResult?.backendLogs || raw.backendLogs || job.liveThoughts?.backendLogs || '',
                globalLiveLogs: raw.agentResult?.globalLiveLogs || raw.globalLiveLogs || job.liveThoughts?.globalLiveLogs || '',
                dbSearchLog: raw.agentResult?.dbSearchLog || raw.dbSearchLog || job.liveThoughts?.dbSearchLog || ''
              }
            }
          };
          if (assistantMsg.pendingFoodLog) {
            assistantMsg.pendingFoodLog.id = assistantMsg.pendingFoodLog.id || `food_${Date.now()}`;
            
            const r2PhotoUrl = assistantMsg.pendingFoodLog.imageUrl;
            const r2PhotoUrls = assistantMsg.pendingFoodLog.imageUrls;

            if (userMsg) {
              userMsg.imageUrl = r2PhotoUrl;
              userMsg.imageUrls = r2PhotoUrls;
            }

            assistantMsg.pendingFoodLog.chatTranscript = [
              { 
                role: userMsg.role, 
                content: userMsg.content, 
                timestamp: userMsg.timestamp,
                imageUrl: r2PhotoUrl,
                imageUrls: r2PhotoUrls,
                data: userMsg.data
              },
              { 
                role: assistantMsg.role, 
                content: assistantMsg.content, 
                timestamp: assistantMsg.timestamp,
                agentResult: assistantMsg.agentResult,
                data: assistantMsg.data
              }
            ];
          }

          const isDefaultWelcome = !userMsg.content && !userMsg.imageUrl && !userMsg.imageUrls?.length;
          if (isDefaultWelcome) {
            setMessages([assistantMsg], false);
          } else {
            setMessages([welcome, userMsg, assistantMsg], false);
          }
        } else if (job.status === 'awaiting_user') {
          const rawResult = job.result?.clean_result || job.result || (job as any).clean_result || {};
          const portionClarify =
            rawResult.portionClarify ||
            (job.result as any)?.data?.portionClarify;
          const promptMsg = portionClarify?.promptMessage || job.statusMessage || 'Please confirm portion size';
          const scoutItems =
            rawResult.scoutItems ||
            [];
          const assistantClarifyMsg: ChatMessage = {
            id: `msg_assistant_clarify_${activeJobId}`,
            role: 'assistant',
            content: promptMsg,
            timestamp: job.updatedAt || new Date().toISOString(),
            isLive: false,
            agentType: type as any,
            data: {
              needsPortionClarify: true,
              portionClarify,
              scoutItems,
              photoUrl: job.photoUrl || rawResult.photoUrl,
              debugUrl: job.debugUrl || rawResult.debugUrl,
              agentResult: {
                scoutItems,
                activeStage: 'portion_clarify',
                scoutScratchpad: rawResult.agentResult?.scoutScratchpad || rawResult.scoutScratchpad || job.liveThoughts?.scout || '',
                backendLogs: rawResult.agentResult?.backendLogs || rawResult.backendLogs || job.liveThoughts?.backendLogs || ''
              }
            }
          };
          setMessages([welcome, userMsg, assistantClarifyMsg], false);
        } else if (job.status === 'failed') {
          const assistantMsg: ChatMessage = {
            id: `msg_assistant_${activeJobId}`,
            role: 'assistant',
            content: `⚠️ **Analysis failed**\n\n${humanizeJobFailure(job.error?.message)}`,
            timestamp: job.updatedAt || new Date().toISOString(),
            isError: true
          };
          setMessages([welcome, userMsg, assistantMsg], false);
        } else if (job.status === 'cancelled') {
          const assistantMsg: ChatMessage = {
            id: `msg_assistant_${activeJobId}`,
            role: 'assistant',
            content: `⚠️ **Analysis cancelled**\n\nThe user cancelled this analysis request.`,
            timestamp: job.updatedAt || new Date().toISOString()
          };
          setMessages([welcome, userMsg, assistantMsg], false);
        } else {
          const liveMsg: ChatMessage = {
            id: `msg_live_${activeJobId}`,
            role: 'assistant',
            content: job.statusMessage || (type === 'medical' ? 'Analyzing medical data in the background...' : 'Analyzing your meal in the background...'),
            timestamp: job.updatedAt || new Date().toISOString(),
            isLive: true,
            agentType: type as any,
            data: {
              userSelectedMode: (job.inputSnapshot as any)?.mode || 'review',
              hasImage: (job.inputSnapshot as any)?.hasImage || false,
              agentResult: {
                scoutScratchpad: job.liveThoughts?.scout || job.statusMessage || '',
                dietitianScratchpad: job.liveThoughts?.dietitian || '',
                backendLogs: job.liveThoughts?.backendLogs || '',
                globalLiveLogs: job.liveThoughts?.globalLiveLogs || '',
                dbSearchLog: job.liveThoughts?.dbSearchLog || ''
              }
            }
          };
          setMessages([welcome, userMsg, liveMsg], false);
        }
      }
    };

    loadJobMessages();

    const unsubscribe = JobStore.subscribe(() => {
      loadJobMessages();
    });
    return () => {
      unsubscribe();
    };
  }, [jobId, isOpen, type, messages.length]);

  // Cleanly reset isAnalyzing and isSending when modal closes
  useEffect(() => {
    if (!isOpen) {
      setIsAnalyzing(false);
      isSendingRef.current = false;
    }
  }, [isOpen]);

  const handleDownloadDebug = async (jobIdToDownload: string, msg: any, format: 'json' | 'markdown' = 'markdown') => {
    const resolvedJobId =
      msg?.data?.jobId ||
      (msg?.id?.startsWith('msg_assistant_job_') ? msg.id.replace('msg_assistant_job_', 'job_') : '') ||
      (msg?.id?.startsWith('msg_assistant_') && !msg.id.includes('fail') && !msg.id.includes('clarify') && !/^\d+$/.test(msg.id.replace('msg_assistant_', '')) ? msg.id.replace('msg_assistant_', '') : '') ||
      (msg?.pendingFoodLog?.jobId || msg?.data?.pendingFoodLog?.jobId) ||
      jobIdToDownload ||
      jobId;

    const job = JobStore.getJob(resolvedJobId);
    const clientConsoleLogs = window.__clientConsoleLogs || [];
    const networkErrors = window.__clientNetworkErrors || [];
    const lastUserAction = window.__lastUserAction || (inputText ? { action: 'chat_submit', prompt: inputText, timestamp: new Date().toISOString() } : undefined);

    const pendingFoodLog = msg?.data?.pendingFoodLog || msg?.pendingFoodLog || job?.result?.pendingFoodLog || job?.result;
    const scoutItems = msg?.data?.scoutItems || msg?.data?.agentResult?.scoutItems || job?.result?.scoutItems;
    const receiptTable = msg?.data?.pendingFoodLog?.receiptTable || msg?.data?.receiptTable || job?.result?.receiptTable || job?.result?.pendingFoodLog?.receiptTable;

    const extractLogString = (val: any): string => {
      if (!val) return '';
      if (typeof val === 'string') return val.trim();
      if (Array.isArray(val)) {
        return val.map((l: any) => typeof l === 'string' ? l : (l.message ? (l.timestamp ? `[${l.timestamp}] ${l.message}` : l.message) : JSON.stringify(l))).join('\n').trim();
      }
      return '';
    };

    let initialBackendLogs =
      extractLogString(msg?.data?.agentResult?.backendLogs) ||
      extractLogString(msg?.data?.agentResult?.globalLiveLogs) ||
      extractLogString(msg?.data?.backendLogs) ||
      extractLogString(msg?.agentResult?.backendLogs) ||
      extractLogString(pendingFoodLog?.backendLogs) ||
      extractLogString(pendingFoodLog?.rawLogs) ||
      extractLogString(job?.result?.backendLogs) ||
      extractLogString((job as any)?.clean_result?.backendLogs) ||
      extractLogString(job?.liveThoughts?.backendLogs) ||
      extractLogString(job?.liveThoughts?.globalLiveLogs) ||
      extractLogString((job as any)?.accumulatedLogs) ||
      globalLiveLogsRef.current ||
      '';

    const localPayload = {
      jobId: resolvedJobId,
      status: job?.status,
      result: {
        ...(job?.result || {}),
        lastUserAction,
        clientConsoleLogs,
        networkErrors,
      },
      messages: job?.messages,
      liveThoughts: job?.liveThoughts,
      backendLogs: initialBackendLogs,
      exportedAt: new Date().toISOString(),
      source: 'client-fallback',
    };

    // 1) Try server proxy (auth-friendly)
    try {
      const uid = auth.currentUser?.uid || 'anonymous';
      const fmtParam = format === 'markdown' ? '&format=markdown' : '';
      const res = await fetch(`/api/jobs/debug?jobId=${encodeURIComponent(resolvedJobId)}&userId=${encodeURIComponent(uid)}${fmtParam}`);
      if (res.ok) {
        const contentType = res.headers.get('content-type') || '';
        const text = await res.text();
        if (
          !contentType.includes('text/html') &&
          !text.trim().startsWith('<!doctype') &&
          !text.trim().startsWith('<html') &&
          !text.includes('Cookie check') &&
          !text.includes('No server execution trace found')
        ) {
          const blob = new Blob([text], { type: format === 'markdown' ? 'text/markdown;charset=utf-8' : 'application/json' });
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `debug-${resolvedJobId}.${format === 'markdown' ? 'md' : 'json'}`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          window.URL.revokeObjectURL(url);
          return;
        }
      }
    } catch (e) {
      console.warn('Proxy download failed, trying local fallback:', e);
    }

    // 2) Local fallback using buildDebugMarkdownReport or JSON
    let finalBackendLogs = localPayload.backendLogs;
    if (finalBackendLogs && (finalBackendLogs.startsWith('[Logs stored in R2') || finalBackendLogs.includes('.r2.dev/logs/'))) {
      const urlMatch = finalBackendLogs.match(/(https?:\/\/[^\s\]"]+\.r2\.dev\/logs\/[^\s\]"]+)/i) ||
                       finalBackendLogs.match(/\[Logs stored in R2:\s*(https?:\/\/[^\s\]]+)\]/i);
      if (urlMatch) {
        const r2Url = urlMatch[1] || urlMatch[0];
        try {
          let r2Res = await fetch(`/api/r2/log-proxy?url=${encodeURIComponent(r2Url)}`);
          if (!r2Res.ok) {
            r2Res = await fetch(r2Url);
          }
          if (r2Res.ok) {
            const fetchedText = await r2Res.text();
            if (fetchedText && fetchedText.trim() && !fetchedText.startsWith('[Logs stored in R2')) {
              finalBackendLogs = fetchedText;
            }
          }
        } catch (e) {
          console.warn('[LogChat] Failed fetching R2 logs for debug download:', e);
        }
      }
    }

    if (!finalBackendLogs || finalBackendLogs.startsWith('[Logs stored in R2') || finalBackendLogs.length < 50) {
      try {
        const storedLogs = getAgentRequestLogs();
        const matchedReq = storedLogs.find(r =>
          r.id === resolvedJobId ||
          r.id === `server-job-${resolvedJobId}` ||
          (msg?.data?.requestId && r.id === msg.data.requestId) ||
          (msg?.id && r.id === msg.id) ||
          (pendingFoodLog?.id && r.id === pendingFoodLog.id)
        );
        if (matchedReq && matchedReq.logs && matchedReq.logs.length > 0) {
          finalBackendLogs = matchedReq.logs.map(l => typeof l === 'string' ? l : (l.timestamp ? `[${l.timestamp}] ${l.message}` : (l.message || JSON.stringify(l)))).join('\n');
        }
      } catch (e) {
        console.warn('[LogChat] Failed loading stored logs from tracker:', e);
      }
    }

    if (format === 'markdown') {
      const { buildDebugMarkdownReport } = await import('../utils/debugPayload');
      const mdContent = buildDebugMarkdownReport({
        jobId: resolvedJobId,
        status: job?.status,
        mode: job?.result?.mode,
        message: job?.result?.message || msg?.content,
        backendLogs: finalBackendLogs,
        pendingFoodLog,
        scoutItems,
        receiptTable,
        error: job?.error?.message,
        lastUserAction: lastUserAction || job?.result?.lastUserAction || (typeof window !== 'undefined' ? window.__lastUserAction : undefined),
        userActionBreadcrumbs: (typeof window !== 'undefined' ? window.__userActionBreadcrumbs : undefined) || job?.result?.userActionBreadcrumbs || [],
        clientConsoleLogs: clientConsoleLogs || job?.result?.clientConsoleLogs || (typeof window !== 'undefined' ? window.__clientConsoleLogs : undefined) || [],
        networkErrors: networkErrors || job?.result?.networkErrors || (typeof window !== 'undefined' ? window.__clientNetworkErrors : undefined) || [],
        usdaSearchResults: job?.result?.usdaSearchResults,
        brandSearchResults: job?.result?.brandSearchResults,
        comprehensiveNutrients: job?.result?.comprehensiveNutrients || pendingFoodLog?.nutrients
      });
      const blob = new Blob([mdContent], { type: 'text/markdown;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `debug-${resolvedJobId}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } else {
      const blob = new Blob([JSON.stringify({ ...localPayload, backendLogs: finalBackendLogs }, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `debug-${resolvedJobId}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    }
  };

  const [globalLiveLogs, setGlobalLiveLogs] = useState<string>('');
  const globalLiveLogsRef = useRef<string>('');

  useEffect(() => {
    let eventSource: EventSource | null = null;
    try {
      eventSource = new EventSource('/api/debug/live-stream');
      const es = eventSource;
      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.message) {
            // Same tagging convention Stream 2 uses (see the main SSE reader loop below) —
            // this is what lets LiveBackendStreamViewer build matching tabs/elapsed-time
            // for Stream 1 too.
            const taggedLine = data.logType ? `[${data.logType}]${data.timestamp ? `[${data.timestamp}]` : ''} ${data.message}` : data.message;
            setGlobalLiveLogs((prev) => {
              const next = prev ? prev + '\n' + taggedLine : taggedLine;
              globalLiveLogsRef.current = next;
              return next;
            });
          }
        } catch (e) {}
      };
      es.onerror = () => {
        // Permanently close the EventSource instance to prevent infinite browser auto-retry loop
        try {
          es.close();
        } catch (e) {}
      };
    } catch (err) {}

    return () => {
      if (eventSource) {
        try { eventSource.close(); } catch (e) {}
      }
    };
  }, []);

  const ANALYZING_STEPS = ["Gathering your recent history..."];

  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isAnalyzing) {
      interval = setInterval(() => {
        setAnalyzingStepIndex((prev) => {
          if (prev < ANALYZING_STEPS.length - 1) {
            return prev + 1;
          }
          return prev;
        });
      }, 1800);
    } else {
      setAnalyzingStepIndex(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isAnalyzing, type]);

  const [loggedMessageIds, setLoggedMessageIds] = useState<string[]>(() => {
    try {
      const uid = auth.currentUser?.uid || 'guest';
      const saved = localStorage.getItem(`logged_message_ids_${uid}`);
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });

  useEffect(() => {
    try {
      const uid = auth.currentUser?.uid || 'guest';
      localStorage.setItem(`logged_message_ids_${uid}`, JSON.stringify(loggedMessageIds));
    } catch (e) {}
  }, [loggedMessageIds, auth.currentUser?.uid]);
  const [showPastDiscussion, setShowPastDiscussion] = useState(false);
  const [sessionStartTime, setSessionStartTime] = useState<number>(Date.now());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const liveThoughtRef = useRef<HTMLDivElement>(null);
  const chatWindowRef = useRef<HTMLDivElement>(null);
  const initialOpenScrollDoneRef = useRef<boolean>(false);

  const lastFoodMsg = React.useMemo(() => {
    return [...messages].reverse().find(m => m.role === 'assistant' && m.agentType === 'food');
  }, [messages]);

  const scrollToLastFoodMessage = (smooth = false) => {
    const container = chatWindowRef.current;
    const target = document.getElementById("last-food-message");
    if (container && target) {
      let actualOffsetTop = 0;
      let curr: HTMLElement | null = target;
      while (curr && curr !== container) {
        actualOffsetTop += curr.offsetTop;
        curr = curr.offsetParent as HTMLElement | null;
      }
      container.scrollTo({
        top: actualOffsetTop,
        behavior: smooth ? 'smooth' : 'auto'
      });
    }
  };

  useEffect(() => {
    if (!isOpen) {
      initialOpenScrollDoneRef.current = false;
    } else if (isOpen && isAgent('food') && !initialOpenScrollDoneRef.current) {
      initialOpenScrollDoneRef.current = true;
      const timer = setTimeout(() => {
        scrollToLastFoodMessage(false);
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [isOpen, activeAgentKey, messages]);

  useEffect(() => {
    if (!isAnalyzing && isAgent('food')) {
      const timer = setTimeout(() => {
        scrollToLastFoodMessage(true);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isAnalyzing, activeAgentKey]);

  const handleDeleteMessagePair = (messageId: string) => {
    setMessages(prev => {
      const idx = prev.findIndex(m => m.id === messageId);
      if (idx === -1) return prev;
      const msgToDelete = prev[idx];
      const newMsgs = [...prev];
      if (msgToDelete.role === 'user') {
        if (idx + 1 < newMsgs.length && newMsgs[idx + 1].role === 'assistant') {
          newMsgs.splice(idx, 2);
        } else {
          newMsgs.splice(idx, 1);
        }
      } else if (msgToDelete.role === 'assistant') {
        if (idx - 1 >= 0 && newMsgs[idx - 1].role === 'user') {
          newMsgs.splice(idx - 1, 2);
        } else {
          newMsgs.splice(idx, 1);
        }
      }
      return newMsgs;
    });
  };

  useEffect(() => {
    if (isOpen) {
      const saved = sessionStorage.getItem(chatStorageKey);
      let lastMsg: ChatMessage | null = null;
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed && parsed.length > 0) {
            lastMsg = parsed[parsed.length - 1];
          }
        } catch (e) {}
      }

      // Removed session start time resetting

      // Removed forced welcome message append and hiding of past discussion
    }
  }, [isOpen, type, chatStorageKey]);

  useEffect(() => {
    // Eagerly fetch user location only when food idea chat is active
    if (type !== 'food_idea' || !isOpen) return;
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        setUserLocation({ lat, lng });
        
        const isIndo = lat >= -11 && lat <= 6 && lng >= 95 && lng <= 141;
        const savedCurrency = localStorage.getItem('food_currency');
        if (!savedCurrency && isIndo) {
          setCurrency('IDR');
          setBudget('100000');
        }
      }, (err) => {
        console.warn("Could not get location:", err);
      });
    }
  }, [isOpen, type]);

  const outOfRangeBiomarkers = React.useMemo(() => {
    const list: { key: string; name: string; value: any; status: string; normalRange: string; unit: string }[] = [];
    
    // Aggregate all unique biomarker keys from both the local snapshot and the active history
    const allKeys = new Set<string>();
    Object.keys(biomarkers || {}).forEach(k => allKeys.add(k));
    (activeHistory || []).forEach(h => {
      Object.keys(h.biomarkers || {}).forEach(k => allKeys.add(k));
    });
    Array.from(allKeys).forEach((key) => {
      const def = biomarkerDefinitions.find(d => d.key === key);
      const customDef = profile?.customBiomarkers?.[key];
      if (!def && !customDef) return;
      if (!isBiomarkerApproved(key, profile, activeHistory)) return;
      
      let val = biomarkers?.[key];
      const historyLogs = activeHistory ? activeHistory.filter(h => h.biomarkers && h.biomarkers[key] !== undefined) : [];
      if (historyLogs.length > 0) {
        const sortedLogs = [...historyLogs].sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));
        val = sortedLogs[0].biomarkers[key];
      }
      
      const normalRange = customDef?.normalRange || def?.normalRange || '';
      const unit = customDef?.unit || def?.unit || '';
      const name = customDef?.name || def?.name || key;
      
      const status = getBiomarkerStatus(key, val, normalRange, customDef || def, profile);
      const isImprobable = isBiomarkerValueImprobable(key, val, normalRange);

      const statusLabel = getBiomarkerStatusLabel(key, status, customDef, val, profile).toLowerCase();
      const isOptimallyLabeled = statusLabel.includes('optimal') || statusLabel === 'normal' || statusLabel === 'remission / healthy';

      if (status === 'flagged' || isImprobable) return;
      if ((status === 'high' || status === 'low' || status === 'critical') && !isOptimallyLabeled) {
        list.push({
          key,
          name,
          value: val,
          status,
          normalRange,
          unit
        });
      }
    });
    return list;
  }, [biomarkers, profile?.ethnicity, activeHistory]);

  const remainingAllowance = React.useMemo(() => {
    const todayStr = getCurrentDateInTimezone(profile?.timezone);
    const todaysFoods = activeFoodLogs ? activeFoodLogs.filter(f => f.date === todayStr) : [];

    const todaysTotals = todaysFoods.reduce((acc, curr) => {
      if (curr.nutrients) {
        Object.keys(curr.nutrients).forEach(k => {
          const key = k as keyof typeof curr.nutrients;
          acc[key] = (Number(acc[key]) || 0) + (Number(curr.nutrients[key]) || 0);
        });
      }
      return acc;
    }, {} as { [key: string]: number });

    const parseTarget = (val: any, fallback: number) => {
      if (val === null || val === undefined) return fallback;
      const cleanStr = String(val).replace(/,/g, '');
      const matches = cleanStr.match(/\d+(\.\d+)?/g);
      if (!matches || matches.length === 0) return fallback;
      const parsed = parseFloat(matches[0]);
      return isNaN(parsed) ? fallback : parsed;
    };

    const activeTargets = {
      calories: Number(todaysTotals.calories || 0),
      caloriesTarget: report && report.dailyNutrientTargets ? parseTarget(report.dailyNutrientTargets.calories, 1700) : 1800,
      satFat: Number(todaysTotals.saturatedFat || 0),
      satFatTarget: report && report.dailyNutrientTargets ? parseTarget(report.dailyNutrientTargets.saturatedFat, 15) : 15,
      sodium: Number(todaysTotals.sodium || 0),
      sodiumTarget: report && report.dailyNutrientTargets ? parseTarget(report.dailyNutrientTargets.sodium, 1200) : 1200,
      addedSugar: Number(todaysTotals.addedSugar || 0),
      addedSugarTarget: report && report.dailyNutrientTargets ? parseTarget(report.dailyNutrientTargets.addedSugar, 50) : 50,
      carbohydrates: Number(todaysTotals.carbohydrates || 0),
      carbohydratesTarget: report && report.dailyNutrientTargets ? parseTarget(report.dailyNutrientTargets.carbohydrates, 250) : 250,
      solubleFibre: Number(todaysTotals.solubleFibre || 0),
      solubleFibreTarget: report && report.dailyNutrientTargets ? parseTarget(report.dailyNutrientTargets.solubleFibre, 15) : 15,
      protein: Number(todaysTotals.protein || 0),
      proteinTarget: report && report.dailyNutrientTargets ? parseTarget(report.dailyNutrientTargets.protein, 50) : 50,
      potassium: Number(todaysTotals.potassium || 0),
      potassiumTarget: report && report.dailyNutrientTargets ? parseTarget(report.dailyNutrientTargets.potassium, 3500) : 3500,
      unsaturatedFat: Number(todaysTotals.unsaturatedFat || 0),
      unsaturatedFatTarget: report && report.dailyNutrientTargets ? parseTarget(report.dailyNutrientTargets.unsaturatedFat, 40) : 40,
    };

    const rollingDaysStr = localStorage.getItem('foodTracker_rollingDays');
    const rollingDays = rollingDaysStr ? parseInt(rollingDaysStr, 10) : 7;
    const showAverageInBar = localStorage.getItem('foodTracker_showAverageInBar') === 'true';

    const getAverageIntake = (key: string, numDays: number) => {
      let totalIntake = 0;
      for (let d = 0; d < numDays; d++) {
        const parts = todayStr.split('-');
        const todayDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        const targetDate = new Date(todayDate);
        targetDate.setDate(todayDate.getDate() - d);
        const y = targetDate.getFullYear();
        const m = String(targetDate.getMonth() + 1).padStart(2, '0');
        const day = String(targetDate.getDate()).padStart(2, '0');
        const dStr = `${y}-${m}-${day}`;

        const dayFoods = activeFoodLogs ? activeFoodLogs.filter(f => f.date === dStr) : [];
        const dayTotal = dayFoods.reduce((acc, curr) => {
          return acc + (Number(curr.nutrients?.[key as keyof typeof curr.nutrients]) || 0);
        }, 0);
        totalIntake += dayTotal;
      }
      return totalIntake / numDays;
    };
    
    const averages = {
      calories: getAverageIntake('calories', rollingDays),
      saturatedFat: getAverageIntake('saturatedFat', rollingDays),
      sodium: getAverageIntake('sodium', rollingDays),
      addedSugar: getAverageIntake('addedSugar', rollingDays),
      carbohydrates: getAverageIntake('carbohydrates', rollingDays),
      solubleFibre: getAverageIntake('solubleFibre', rollingDays),
      protein: getAverageIntake('protein', rollingDays),
      potassium: getAverageIntake('potassium', rollingDays),
      unsaturatedFat: getAverageIntake('unsaturatedFat', rollingDays),
    };

    return {
      calories: Math.max(0, activeTargets.caloriesTarget - activeTargets.calories),
      saturatedFat: Math.max(0, activeTargets.satFatTarget - activeTargets.satFat),
      sodium: Math.max(0, activeTargets.sodiumTarget - activeTargets.sodium),
      addedSugar: Math.max(0, activeTargets.addedSugarTarget - activeTargets.addedSugar),
      carbohydrates: Math.max(0, activeTargets.carbohydratesTarget - activeTargets.carbohydrates),
      solubleFibre: Math.max(0, activeTargets.solubleFibreTarget - activeTargets.solubleFibre),
      protein: Math.max(0, activeTargets.proteinTarget - activeTargets.protein),
      potassium: Math.max(0, activeTargets.potassiumTarget - activeTargets.potassium),
      unsaturatedFat: Math.max(0, activeTargets.unsaturatedFatTarget - activeTargets.unsaturatedFat),
      caloriesLogged: activeTargets.calories,
      saturatedFatLogged: activeTargets.satFat,
      sodiumLogged: activeTargets.sodium,
      caloriesTarget: activeTargets.caloriesTarget,
      saturatedFatTarget: activeTargets.satFatTarget,
      sodiumTarget: activeTargets.sodiumTarget,
      addedSugarTarget: activeTargets.addedSugarTarget,
      carbohydratesTarget: activeTargets.carbohydratesTarget,
      solubleFibreTarget: activeTargets.solubleFibreTarget,
      proteinTarget: activeTargets.proteinTarget,
      potassiumTarget: activeTargets.potassiumTarget,
      unsaturatedFatTarget: activeTargets.unsaturatedFatTarget,
      averages,
      rollingDays,
    };
  }, [foodLogs, report, profile?.timezone]);

  useEffect(() => {
    if (!isAnalyzing && messages.length > 1) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg && lastMsg.role === 'assistant') {
          // When the summary answer is shown, do not scroll down again
          return;
        }
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 150);
    } else if (isAnalyzing) {
      // Keep the live "Agent thought..." box pinned near the top of the viewport
      // while it's still growing, instead of scrolling past it to the bottom.
      (liveThoughtRef.current || messagesEndRef.current)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [isAnalyzing, messages, liveThoughts]);

  const matchingPreviousLogs = React.useMemo(() => {
    if (type !== 'food' || !activeFoodLogs || inputText.trim().length < 3) return [];
    const query = inputText.toLowerCase().trim();
    const uniqueMatches: FoodLog[] = [];
    const seenNames = new Set<string>();
    
    const reversedLogs = [...activeFoodLogs].reverse();
    for (const log of reversedLogs) {
      if (log.name && log.name.toLowerCase().includes(query)) {
        if (!seenNames.has(log.name.toLowerCase())) {
          seenNames.add(log.name.toLowerCase());
          uniqueMatches.push(log);
        }
      }
    }
    return uniqueMatches;
  }, [type, activeFoodLogs, inputText]);



  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputEl = e.target;
    const fileList = inputEl.files ? Array.from(inputEl.files) : [];
    
    if (fileList.length > 0) {
      const validFiles = fileList.filter((file: any) => {
        const isDng = file.name.toLowerCase().endsWith('.dng') || file.type.includes('dng') || file.type === 'image/x-adobe-dng';
        return !isDng;
      });

      const dngCount = fileList.length - validFiles.length;
      if (dngCount > 0) {
        alert("DNG (RAW) files are not supported by web browsers. Please select standard images like JPEG, PNG, or WEBP.");
      }

      if (validFiles.length === 0) return;

      setIsCompressing(true);
      setCompressionProgress({ current: 0, total: validFiles.length, percent: 0 });
      try {
        const compressed = await compressMultipleImages(validFiles, (progress) => {
          setCompressionProgress({
            current: progress.currentIndex,
            total: progress.totalCount,
            percent: progress.percentage
          });
        }, 1400, 1400, 0.8);
        const analysisCompressed = await compressMultipleImages(validFiles, () => {}, 1400, 1400, 0.85);
        const dates = await Promise.all(validFiles.map(async (f: any) => {
          try {
            const exifData = await exifr.parse(f, ['DateTimeOriginal']);
            if (exifData && exifData.DateTimeOriginal) {
              return new Date(exifData.DateTimeOriginal).toISOString();
            }
          } catch (e) {
            console.warn("Could not parse EXIF for", f.name);
          }
          if (f.lastModified) {
            return new Date(f.lastModified).toISOString();
          }
          return new Date().toISOString();
        }));
        setSelectedImages(prev => [...prev, ...compressed]);
        setSelectedImagesForAnalysis(prev => [...prev, ...analysisCompressed]);
        setImageDates(prev => [...prev, ...dates]);
      } catch (err) {
        console.error("Error compressing selected images:", err);
      } finally {
        setIsCompressing(false);
        inputEl.value = ''; // Reset input value AFTER processing so files aren't garbage collected early by Safari
      }
    } else {
      inputEl.value = '';
    }
  };

  const handleSend = async (overrideText?: string | { text?: string; imageUrls?: string[]; compareOnly?: boolean; compareItems?: string[]; sourceMsgId?: string; skipScout?: boolean; activeScoutItems?: any; scoutContentType?: any; overrideMode?: string; userSelectedMode?: string; } | any, extraImages?: any[], extraOptions?: any) => {
    if (isCompressing) {
      console.log('[handleSend] Blocked — image compression in progress.');
      return;
    }

    let textToSend = typeof overrideText === 'string' ? overrideText : (overrideText?.text || inputText);
    const overrideImagesInner = typeof overrideText === 'object' && overrideText?.imageUrls ? overrideText.imageUrls : (extraImages || []);
    const finalImages = overrideImagesInner.length > 0 ? overrideImagesInner : selectedImages;
    const tempDates = overrideImagesInner.length > 0 ? (extraOptions?.imageDates || []) : [...imageDates];

    if (!textToSend && finalImages.length > 0) {
      textToSend = isAgent('food') ? 'Analyze this meal photo.' : (isAgent('medical') ? 'Please review my health records / lab report.' : 'Analyze attached photo.');
    }

    if (!textToSend && finalImages.length === 0) {
      if (autoSendMessage) {
        textToSend = autoSendMessage;
      } else if (reviewBiomarkerKey) {
        textToSend = buildBiomarkerReviewPrefill(reviewBiomarkerKey, undefined, biomarkers, profile);
      } else if (isAgent('biomarker_review') || agentType === 'biomarker_review') {
        textToSend = 'Please review my full set of biomarker data and log history.';
      }
    }

    if (!textToSend && finalImages.length === 0) {
      console.log('[handleSend] Blocked — both text and images are empty.');
      return;
    }

    const now = Date.now();
    if (now - lastSendClickTimeRef.current < 1000) {
      console.log('[handleSend] Blocked — debounced duplicate click within 1000ms.');
      return;
    }
    if (isSendingRef.current || isAnalyzing || isSubmitting) {
      console.log('[handleSend] Blocked — analysis already in progress or duplicate tap.');
      return;
    }
    lastSendClickTimeRef.current = now;
    recordBreadcrumb('submit_initiated', 'chat_composer', {
      prompt: textToSend,
      imageCount: finalImages.length
    });
    isSendingRef.current = true;
    setIsSubmitting(true);
    setIsAnalyzing(true);
    const failsafe = setTimeout(() => {
      isSendingRef.current = false;
      setIsSubmitting(false);
      setIsAnalyzing(false);
    }, 60000);
    // Check credit limits before proceeding
    if (profile) {
      const creditInfo = getAvailableCredits(profile);
      const settings = getAdminSettings();
      const isFlashLite = selectedModelId === 'gemini-3.5-flash-lite' || selectedModelId.toLowerCase().includes('flash-lite');
      const cost = isFlashLite ? settings.flashLiteCost : settings.standardCost;
      if (creditInfo.total < cost) {
        const errorMsg: ChatMessage = {
          id: `msg_err_${Date.now()}`,
          role: 'assistant',
          content: `⚠️ **Credit Quota Exceeded**\n\nYou have insufficient AI Agent credits to make this request!\n\n* **Required**: \`${cost}\` credits (for model \`${selectedModelId}\`)\n* **Available**: \`${creditInfo.total}\` credits (Daily quota: \`${creditInfo.daily}\`)\n* **Reset Time**: Resets in **${creditInfo.nextResetStr}**.\n\n*Admins can grant additional credits with duration in the User Management tab under Admin Settings.*`,
          timestamp: new Date().toISOString(),
          isError: true
        };
        setMessages(prev => [...prev, errorMsg]);
        clearTimeout(failsafe);
        isSendingRef.current = false;
        setIsSubmitting(false);
        setIsAnalyzing(false);
        return;
      }
    }

    const existingJobForReq = jobId ? JobStore.getJob(jobId) : null;
    const currentReqId = (extraOptions as any)?.requestId || (extraOptions?.inPlaceMsgId && existingJobForReq?.requestId) || generateQueryId();
    setActiveQueryId(currentReqId);
    setActiveReqId(currentReqId);
    setLiveThoughts({});
    
    const compareOnly = typeof overrideText === 'object' && overrideText?.compareOnly;
    const compareItems = typeof overrideText === 'object' && overrideText?.compareItems;
    const sourceMsgId = typeof overrideText === 'object' && overrideText?.sourceMsgId;
    const skipScout = typeof overrideText === 'object' && overrideText?.skipScout;
    const activeScoutItemsFallback = typeof overrideText === 'object' && overrideText?.activeScoutItems;
    const scoutContentTypeFallback = typeof overrideText === 'object' && overrideText?.scoutContentType;

    const overrideModeRaw = typeof overrideText === 'object' && (overrideText?.overrideMode || overrideText?.userSelectedMode);
    let mappedMode: "review" | "compare" | "edit" = userSelectedMode;
    if (overrideModeRaw) {
      if (overrideModeRaw === 'compare' || overrideModeRaw === 'evaluation' || overrideModeRaw === 'D' || overrideModeRaw === 'mode-d') {
        mappedMode = 'compare';
      } else if (overrideModeRaw === 'edit' || overrideModeRaw === 'modify' || overrideModeRaw === 'C' || overrideModeRaw === 'mode-c') {
        mappedMode = 'edit';
      } else if (overrideModeRaw === 'review' || overrideModeRaw === 'origin' || overrideModeRaw === 'A' || overrideModeRaw === 'mode-a') {
        mappedMode = 'review';
      }
    }

    if (isAgent('food')) {
      try {
        setUserSelectedMode(mappedMode);
        isManualModeRef.current = true;

        const currentJobId = jobId || `job_legacy_${Date.now()}`;
        const job = JobStore.getJob(currentJobId);

        // Family Lock: preserve existing family if present, else derive from mappedMode
        let family: 'A' | 'D' = 'A';
        if (job?.lockedModeFamily === 'D') {
          family = 'D';
        } else if (job?.lockedModeFamily === 'A') {
          family = 'A';
        } else if (mappedMode === 'compare') {
          family = 'D';
        } else {
          family = 'A';
        }

        // Submission mode:
        // If job already succeeded or has a pending food log, this submission is an edit
        let submissionMode: 'review' | 'compare' | 'edit' = mappedMode;
        const hasPriorResult = job && (job.status === 'succeeded' || job.result?.pendingFoodLog || job.result?.data?.pendingFoodLog || (job.messages && job.messages.some(m => m.data?.pendingFoodLog || m.pendingFoodLog)));
        if (hasPriorResult) {
          submissionMode = 'edit';
        } else if (family === 'D') {
          submissionMode = 'compare';
        } else {
          submissionMode = 'review';
        }

        // Stage images
        if (finalImages.length > 0) {
          await ImageStore.putImages(currentJobId, finalImages);
        }

        const existingMsgs = (job?.messages && job.messages.length > 0)
          ? job.messages
          : [getWelcomeMessage()];

        const lastScoutMsgForJob = [...existingMsgs].reverse().find(m => 
          (m.data?.scoutItems && m.data.scoutItems.length > 0) || 
          (m.data?.agentResult?.scoutItems && m.data.agentResult.scoutItems.length > 0)
        );
        const jobScoutItems = currentJobId ? (JobStore.getJob(currentJobId)?.result?.scoutItems || JobStore.getJob(currentJobId)?.result?.clean_result?.scoutItems) : undefined;
        // Prefer scout items passed explicitly by the caller (e.g. PortionClarifyCard's
        // onConfirm) over indirect lookups, so a portion-confirm resume never loses them.
        const explicitScoutItems = Array.isArray(extraOptions?.scoutItems) ? extraOptions.scoutItems : undefined;
        const scoutItemsForJob = (explicitScoutItems && explicitScoutItems.length > 0) ? explicitScoutItems :
          (lastScoutMsgForJob?.data?.scoutItems || 
          lastScoutMsgForJob?.data?.agentResult?.scoutItems || 
          jobScoutItems ||
          activeScoutItemsFallback || []);

        let userContent = textToSend;
        if (extraOptions?.portionChoices && typeof extraOptions.portionChoices === 'object') {
          try {
            const choices = extraOptions.portionChoices;
            const items = extraOptions.scoutItems || scoutItemsForJob || [];
            const parts: string[] = [];
            Object.entries(choices).forEach(([key, value]) => {
              const idx = Number(key);
              const matchedItem = !isNaN(idx) ? items[idx] : items.find((i: any) => i.id === key || i.name === key);
              const itemName = matchedItem?.name || matchedItem?.label || matchedItem?.displayName || matchedItem?.originalName || matchedItem?.description;
              if (itemName) {
                parts.push(`${itemName}: ${value}g`);
              } else {
                parts.push(`${value}g`);
              }
            });
            if (parts.length > 0) {
              userContent = `Portion Selection: ${parts.join(', ')}`;
            } else {
              userContent = `Portion Selection: ${textToSend}`;
            }
          } catch (e) {
            userContent = `Portion Selection: ${textToSend}`;
          }
        }

        const inputSnapshot = {
          text: userContent,
          imageRefs: [],
          imageDates: tempDates.length > 0 ? tempDates : (extraOptions?.imageDates || job?.inputSnapshot?.imageDates || undefined),
          hasImage: finalImages.length > 0,
          mode: submissionMode,
          portionChoices: extraOptions?.portionChoices,
          activeScoutItems: scoutItemsForJob,
          skipScout: extraOptions?.skipScout,
          scoutContentType: scoutContentTypeFallback,
          goldenCaseId: extraOptions?.goldenCaseId || (typeof overrideText === 'object' ? overrideText?.goldenCaseId : undefined),
        };

        // Use a durable base64 data URL instead of a throwaway blob: URL, so the
        // preview image survives JobStore/localStorage persistence + rehydration
        // (blob: URLs become invalid after reload and render as a broken image).
        let userMsgImageUrl: string | undefined = undefined;
        let userMsgImageUrls: string[] | undefined = undefined;
        if (finalImages.length > 0) {
          const base64Imgs = await Promise.all(finalImages.map(async (img) => {
            if (typeof img === 'string') return img;
            return new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = () => reject(new Error('Failed to read image Blob for preview'));
              reader.readAsDataURL(img as Blob);
            });
          }));
          userMsgImageUrls = base64Imgs.filter(Boolean);
          if (userMsgImageUrls.length > 0) {
            userMsgImageUrl = userMsgImageUrls[0];
          }
        }

        const userMsg: ChatMessage = {
          id: `msg_user_${Date.now()}`,
          role: 'user',
          content: userContent,
          timestamp: new Date().toISOString(),
          imageUrl: userMsgImageUrl,
          imageUrls: userMsgImageUrls
        };

        const updatedMessages = [...existingMsgs, userMsg];

        // Strip big base64 strings and nested circular references from messages stored in JobStore to prevent localStorage bloat/failure
        const persistMessages = updatedMessages.map(m => {
          let cleaned = { ...m };
          if (cleaned.imageUrl && typeof cleaned.imageUrl === 'string' && cleaned.imageUrl.startsWith('data:image/')) {
            cleaned.imageUrl = 'Image reference preserved';
          }
          if (cleaned.imageUrls) {
            cleaned.imageUrls = cleaned.imageUrls.map(url => (typeof url === 'string' && url.startsWith('data:image/')) ? 'Image reference preserved' : url);
          }
          if (cleaned.pendingFoodLog?.chatTranscript) {
            cleaned.pendingFoodLog = {
              ...cleaned.pendingFoodLog,
              chatTranscript: (cleaned.pendingFoodLog.chatTranscript || []).map((t: any) => ({
                role: t.role,
                content: t.content,
                timestamp: t.timestamp
              }))
            };
          }
          if (cleaned.data?.pendingFoodLog?.chatTranscript) {
            cleaned.data = {
              ...cleaned.data,
              pendingFoodLog: {
                ...cleaned.data.pendingFoodLog,
                chatTranscript: (cleaned.data.pendingFoodLog.chatTranscript || []).map((t: any) => ({
                  role: t.role,
                  content: t.content,
                  timestamp: t.timestamp
                }))
              }
            };
          }
          return cleaned;
        });

        let updatedProfile = profile ? { ...profile } : null;
        let reserved = 0;
        if (profile) {
          const resCredits = reserveCredits(profile, selectedModelId);
          reserved = resCredits.reserved;
          updatedProfile = resCredits.updatedProfile;
          if (onSaveProfile && updatedProfile) {
            // Fire-and-forget: this Firestore/profile write must NOT block the modal
            // from closing. reserved/updatedProfile are already computed synchronously
            // above, so the job below can be queued immediately regardless of when
            // this save resolves.
            onSaveProfile(updatedProfile).catch((err) => {
              console.error('[handleSend] Failed to persist reserved credits to profile:', err);
            });
          }
        }

        if (job) {
          JobStore.updateJob(currentJobId, {
            status: 'queued',
            inputSnapshot,
            messages: persistMessages,
            creditReserved: reserved,
            creditSettled: false,
            lockedModeFamily: family,
            requestId: currentReqId,
            serverSubmittedAt: undefined,
            clientSubmitPending: true,
            statusMessage: 'Uploading to server… Keep this tab open',
          });
        } else {
          JobStore.createJob({
            id: currentJobId,
            kind: family === 'D' ? 'food_compare' : 'food_log',
            status: 'queued',
            inputSnapshot,
            messages: persistMessages,
            creditReserved: reserved,
            creditSettled: false,
            lockedModeFamily: family,
            requestId: currentReqId,
            serverSubmittedAt: undefined,
            clientSubmitPending: true,
            statusMessage: 'Uploading to server… Keep this tab open',
          });
        }

        // Keep modal open, append messages to local React state
        let liveContent = 'Analyzing your meal in the background...';
        if (extraOptions?.portionChoices && typeof extraOptions.portionChoices === 'object') {
          const choices = extraOptions.portionChoices;
          const items = extraOptions.scoutItems || scoutItemsForJob || [];
          const parts: string[] = [];
          Object.entries(choices).forEach(([key, value]) => {
            const idx = Number(key);
            const matchedItem = !isNaN(idx) ? items[idx] : items.find((i: any) => i.id === key || i.name === key);
            const itemName = matchedItem?.name || matchedItem?.label || matchedItem?.displayName || matchedItem?.originalName || matchedItem?.description;
            if (itemName) {
              parts.push(`"${value}g portion" of ${itemName}`);
            } else {
              parts.push(`"${value}g portion"`);
            }
          });
          if (parts.length > 0) {
            liveContent = `Adjusting for ${parts.join(', ')}...`;
          } else {
            liveContent = 'Adjusting portion sizes...';
          }
        }

        const liveMsg: ChatMessage = {
          id: `msg_live_${currentJobId}`,
          role: 'assistant',
          content: liveContent,
          timestamp: new Date().toISOString(),
          isLive: true,
          agentType: 'food',
          data: {
            userSelectedMode: submissionMode,
            hasImage: finalImages.length > 0,
            agentResult: {
              scoutScratchpad: 'Analysis queued...',
              dietitianScratchpad: ''
            }
          }
        };
        // Task 8: When confirming a portion, update the existing awaiting_user clarify message
        // in-place (same message slot: card → loading → result) instead of appending a new pair.
        // This keeps the conversation linear and prevents a duplicate branch from appearing.
        const inPlaceMsgId: string | undefined = (extraOptions as any)?.inPlaceMsgId;
        if (inPlaceMsgId) {
          // Replace the clarify assistant message in-place with a live loading state.
          // Do NOT add a new user message — the PortionClarifyCard already showed the selection.
          const inPlaceLive: ChatMessage = {
            id: `msg_live_${currentJobId}`,
            role: 'assistant',
            content: liveContent,
            timestamp: new Date().toISOString(),
            isLive: true,
            agentType: 'food',
            data: {
              userSelectedMode: submissionMode,
              hasImage: finalImages.length > 0,
              agentResult: {
                scoutScratchpad: 'Applying portion selection...',
                dietitianScratchpad: ''
              }
            }
          };
          // Replace the old clarify message with the live slot; keep everything else.
          const msgsWithInPlace = existingMsgs.map((m: ChatMessage) =>
            m.id === inPlaceMsgId ? inPlaceLive : m
          );
          setMessages(msgsWithInPlace, false);
        } else {
          setMessages([...existingMsgs, userMsg, liveMsg], false);
        }

        // Clear input compose dock
        setInputText('');
        setSelectedImages([]);
        setSelectedImagesForAnalysis([]);
        setImageDates([]);

        // Send images and submit job to server background execution
        const getImagesAsBase64 = async (imagesList: any[]): Promise<string[]> => {
          return Promise.all(
            imagesList.map(async (img) => {
              try {
                return await compressImage(img, 1024, 1024, 0.75);
              } catch (err) {
                if (typeof img === 'string') {
                  return img;
                }
                return new Promise<string>((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onload = () => resolve(reader.result as string);
                  reader.onerror = () => reject(new Error('Failed to read image Blob'));
                  reader.readAsDataURL(img as Blob);
                });
              }
            })
          );
        };

        const fetchSubmitWithRetry = async (url: string, payload: any, maxRetries = 3, delayMs = 500) => {
          let lastErr: any = null;
          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
              const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: safeJSONStringify(payload)
              });
              if (res.ok) return res;
              if (res.status >= 500 && attempt < maxRetries) {
                await new Promise(r => setTimeout(r, delayMs * Math.pow(2, attempt - 1)));
                continue;
              }
              return res;
            } catch (err) {
              lastErr = err;
              if (attempt < maxRetries) {
                await new Promise(r => setTimeout(r, delayMs * Math.pow(2, attempt - 1)));
              }
            }
          }
          throw lastErr || new Error('Network request failed');
        };

        const lastFoodLogForJob = job?.result?.pendingFoodLog || 
          job?.result?.data || 
          [...existingMsgs].reverse().find(m => m.data?.pendingFoodLog || m.pendingFoodLog)?.data?.pendingFoodLog || 
          [...existingMsgs].reverse().find(m => m.data?.pendingFoodLog || m.pendingFoodLog)?.pendingFoodLog ||
          (!extraOptions?.portionChoices && finalImages.length === 0 && foodLogs && foodLogs.length > 0 ? foodLogs[foodLogs.length - 1] : null);
        let prunedMealForJob = null;
        if (lastFoodLogForJob) {
          try {
            prunedMealForJob = JSON.parse(JSON.stringify(lastFoodLogForJob));
            if (prunedMealForJob.itemsBreakdown) {
              prunedMealForJob.itemsBreakdown = prunedMealForJob.itemsBreakdown.map((item: any) => {
                const cleaned = { ...item };
                delete cleaned.labelNutrientsPerServing;
                return cleaned;
              });
            }
          } catch (e) {
            prunedMealForJob = lastFoodLogForJob;
          }
        }

        getImagesAsBase64(finalImages).then((stagedImagesForSubmit) => {
          recordBreadcrumb('submit_meal_job', 'chat_compose_dock', {
            jobId: currentJobId,
            promptLength: textToSend?.length,
            imageCount: stagedImagesForSubmit.length,
            submissionMode
          });

          const submitPayload = {
            jobId: currentJobId,
            idempotencyKey: `idemp_${auth.currentUser?.uid || 'anon'}_${currentJobId}_${currentReqId}`,
            userId: auth.currentUser?.uid || 'anonymous',
            kind: family === 'D' ? 'food_compare' : 'food_log',
            mode: submissionMode,
            text: userContent || textToSend,
            images: stagedImagesForSubmit,
            imageDates: tempDates.length > 0 ? tempDates : (extraOptions?.imageDates || job?.inputSnapshot?.imageDates || undefined),
            history: persistMessages,
            userProfile: profile || null,
            engine: selectedModelId || 'gemini-3.5-flash-lite',
            biomarkersNeedingImprovement: [],
            remainingAllowance: remainingAllowance || null,
            activeMeal: prunedMealForJob,
            foodLogs: [],
            userSelectedMode: submissionMode,
            activeScoutItems: scoutItemsForJob,
            portionChoices: extraOptions?.portionChoices,
            skipScout: extraOptions?.skipScout || !!extraOptions?.portionChoices,
            resolvedDbCandidates: extraOptions?.resolvedDbCandidates || [],
            priorLogsUrl: extraOptions?.priorLogsUrl || '',
            photoUrl: (extraOptions as any)?.photoUrl || job?.photoUrl || job?.result?.photoUrl || undefined,
            requestId: currentReqId,
            clientConsoleLogs: window.__clientConsoleLogs || [],
            networkErrors: window.__clientNetworkErrors || [],
            userActionBreadcrumbs: window.__userActionBreadcrumbs || [],
            lastUserAction: window.__lastUserAction || { action: 'chat_submit', prompt: userContent || textToSend, timestamp: new Date().toISOString() }
          };

          fetchSubmitWithRetry('/api/jobs/submit', submitPayload)
          .then(async (res) => {
            if (!res.ok) {
              let detail = '';
              try { detail = await res.text(); } catch {}
              throw new Error(`HTTP ${res.status}${detail ? ': ' + detail.slice(0, 300) : ''}`);
            }
            return res.json();
          })
          .then(data => {
            console.log('[LogChat] Job successfully submitted to server:', data);
            JobStore.updateJob(currentJobId, {
              status: 'queued',
              statusMessage: 'Analyzing on server...',
              serverSubmittedAt: Date.now(),
              clientSubmitPending: false,
            });
            JobQueueRunner.wake();
          })
          .catch(err => {
            console.error('[LogChat] Server submit failed after retries, delegating to JobQueueRunner:', err);
            JobStore.updateJob(currentJobId, {
              status: 'queued',
              clientSubmitPending: false,
              statusMessage: 'Connection delayed; background runner retrying submit...'
            });
            JobQueueRunner.wake();
          }).finally(() => {
            // Wake queue runner & notify parent
            JobQueueRunner.wake();
            if (onJobEnqueued) {
              onJobEnqueued(currentJobId, 'food');
            }

            // Release the double-tap guard now that the job is queued
            clearTimeout(failsafe);
            isSendingRef.current = false;
            setIsSubmitting(false);
            setIsAnalyzing(false);

            const keepOpen = !!(extraOptions?.goldenCaseId || (typeof overrideText === 'object' && overrideText?.goldenCaseId));
            if (!keepOpen) onClose();
          });
        }).catch(err => {
          console.error('[LogChat] Error converting images:', err);
          JobStore.updateJob(currentJobId, {
            status: 'failed',
            statusMessage: 'Submission Failed: Image conversion error'
          });
          clearTimeout(failsafe);
          setIsSubmitting(false);
          setIsAnalyzing(false);
          isSendingRef.current = false;
        });

      } catch (err: any) {
        console.error('Failed to enqueue food job:', err);
        clearTimeout(failsafe);
        isSendingRef.current = false;
        setIsSubmitting(false);
        setIsAnalyzing(false);
        const errorMsg: ChatMessage = {
          id: `msg_err_${Date.now()}`,
          role: 'assistant',
          content: `⚠️ **Submission Failed**\n\n${err.message || 'An unexpected error occurred while queueing your request.'}`,
          timestamp: new Date().toISOString(),
          isError: true
        };
        setMessages(prev => [...prev, errorMsg]);
      }
      return;
    }

    if (isAgent('medical')) {
      try {
        // B2 FIX: Guard against duplicate job creation (e.g. when both autoSend and manual button fire)
        const activeType = agentType || 'agent1_step1';
        const dedupeKey = reviewBiomarkerKey ? `${activeType}_${reviewBiomarkerKey}` : activeType;
        const duplicate = JobStore.getAllJobs().find(j =>
          j.kind === 'medical' &&
          (j.status === 'queued' || j.status === 'running') &&
          (j.inputSnapshot as any)?.agentType === activeType &&
          (!reviewBiomarkerKey || (j.inputSnapshot as any)?.reviewBiomarkerKey === reviewBiomarkerKey)
        );
        if (duplicate) {
          console.log(`[LogChat] B2: Skipping duplicate job for ${dedupeKey}, existing job: ${duplicate.id}`);
          clearTimeout(failsafe);
          isSendingRef.current = false;
          setIsSubmitting(false);
          setIsAnalyzing(false);
          onClose();
          return;
        }

        const currentJobId = jobId || `job_medical_${Date.now()}`;
        const job = JobStore.getJob(currentJobId);

        // B3 FIX: A job/chat thread can be reused across genuinely different biomarker
        // agent actions (e.g. a single biomarker_review chat followed by a bulk
        // agent1_step1 lab-report paste in the same open modal). When the agentType or
        // reviewBiomarkerKey of this submission differs from what the job was last used
        // for, treat it as a fresh action rather than a retry of the old one.
        const previousInputSnapshot = job?.inputSnapshot as any;
        const isDifferentBiomarkerAction = !!job && (
          (previousInputSnapshot?.agentType || 'agent1_step1') !== activeType ||
          (previousInputSnapshot?.reviewBiomarkerKey || undefined) !== (reviewBiomarkerKey || undefined)
        );

        const mapMsg = [...messages].reverse().find(m => m.data?.agentResult?.bucketMapping || m.data?.bucketMapping);
        const bucketMappingStr = mapMsg
          ? (typeof (mapMsg.agentResult?.bucketMapping || mapMsg.bucketMapping) === 'string'
            ? (mapMsg.agentResult?.bucketMapping || mapMsg.bucketMapping)
            : JSON.stringify(mapMsg.agentResult?.bucketMapping || mapMsg.bucketMapping))
          : undefined;

        let effectiveBatchKeys: string[] = [];
        if (typeof textToSend === 'string' && textToSend.includes(':')) {
          const parts = textToSend.split(':');
          const candidateKeys = parts.slice(1).join(':').split(/[\n,]/).map((s: string) => s.trim().toLowerCase()).filter(Boolean);
          if (candidateKeys.length > 0 && candidateKeys.length <= 200) {
            effectiveBatchKeys = candidateKeys;
          }
        }
        if (effectiveBatchKeys.length === 0 && dataReviewBatchKeys && dataReviewBatchKeys.length > 0) {
          effectiveBatchKeys = dataReviewBatchKeys;
        } else if (effectiveBatchKeys.length === 0 && dataReviewBatchIdx === 'custom') {
          if (dataReviewSharedState?.customDataReviewBatchKeys?.length > 0) {
            effectiveBatchKeys = dataReviewSharedState.customDataReviewBatchKeys;
          } else {
            try {
              const drKey = `datareview_custom_batch_keys_${userIdentifier}`;
              const a1Key = `agent1_custom_batch_keys_${userIdentifier}`;
              const raw = localStorage.getItem(drKey) || localStorage.getItem(a1Key);
              effectiveBatchKeys = JSON.parse(raw || '[]');
            } catch(e) {}
          }
        } else if (effectiveBatchKeys.length === 0 && dataReviewBatchIdx !== null && dataReviewBatchIdx !== undefined) {
          const sharedBatches = dataReviewSharedState?.batches || [];
          if (typeof dataReviewBatchIdx === 'number' && sharedBatches[dataReviewBatchIdx]?.length > 0) {
            effectiveBatchKeys = sharedBatches[dataReviewBatchIdx];
          } else {
            const allKnownKeys = new Set<string>();
            (biomarkerHistory || []).forEach((h: any) => {
              if (h.biomarkers) {
                Object.keys(h.biomarkers).forEach(k => {
                  if (h.biomarkers[k] !== undefined && h.biomarkers[k] !== null && h.biomarkers[k] !== '') {
                    allKnownKeys.add(k);
                  }
                });
              }
            });
            if (biomarkers) {
              Object.keys(biomarkers).forEach(k => {
                if (biomarkers[k] !== undefined && biomarkers[k] !== null && biomarkers[k] !== '') {
                  allKnownKeys.add(k);
                }
              });
            }
            const markerKeysList = Array.from(allKnownKeys).sort((a, b) => a.localeCompare(b));
            const bSize = localBatchSize || batchSize || 20;
            const batchRes: string[][] = [];
            for (let i = 0; i < markerKeysList.length; i += bSize) {
              batchRes.push(markerKeysList.slice(i, i + bSize));
            }
            effectiveBatchKeys = batchRes[dataReviewBatchIdx as number] || [];
          }
        }

        const stagedBatchBiomarkers = effectiveBatchKeys.length > 0
          ? effectiveBatchKeys.map(k => {
              const customDef = profile?.customBiomarkers?.[k];
              const stdDef = biomarkerDefinitions.find(d => d.key === k || (Array.isArray(d.aliases) && d.aliases.some((a: string) => a.toLowerCase() === k.toLowerCase())));
              const merged = getMergedBiomarkerDef(k, stdDef, customDef);
              const historyEntries: { date: string; value: any }[] = [];
              (biomarkerHistory || []).forEach((h: any) => {
                if (h.biomarkers && h.biomarkers[k] !== undefined && h.biomarkers[k] !== null && h.biomarkers[k] !== '') {
                  historyEntries.push({ date: h.date || 'unknown', value: h.biomarkers[k] });
                }
              });
              const rawVal = biomarkers?.[k] !== undefined && biomarkers?.[k] !== null && biomarkers?.[k] !== ''
                ? biomarkers[k]
                : (historyEntries[0]?.value ?? '');
              const val = rawVal !== '' && rawVal !== undefined && rawVal !== null ? rawVal : 'Baseline / Unrecorded';
              const unit = merged.unit || (k.endsWith('_score') || k.endsWith('_risk') || k.endsWith('_index') ? 'score' : (k === 'steps' ? 'steps' : 'standard'));
              return {
                key: k,
                name: merged.name || k,
                userValue: val,
                value: val,
                unit,
                normalRange: merged.normalRange || '',
                historicalEntries: historyEntries,
                historicalSummary: historyEntries.map(e => `${e.date}: ${e.value}`).join(' → ')
              };
            })
          : undefined;

        const inputSnapshot = {
          text: textToSend,
          imageRefs: [],
          agentType: agentType || 'agent1_step1',
          numberOfBatches,
          extractedData,
          remainingText,
          lastProcessedIndex,
          bucketMapping: bucketMappingStr,
          estimatedTotalMarkers,
          currentBatch,
          reviewBiomarkerKey,
          biomarkerKey: reviewBiomarkerKey,
          biomarkers: biomarkers || {},
          biomarkerHistory: biomarkerHistory || [],
          dataReviewBatchKeys: effectiveBatchKeys.length > 0 ? effectiveBatchKeys : dataReviewBatchKeys,
          batchKeys: effectiveBatchKeys.length > 0 ? effectiveBatchKeys : undefined,
          batchBiomarkers: stagedBatchBiomarkers,
          dataReviewBatchIdx,
          batchSize
        };

        const userMsg: ChatMessage = {
          id: `msg_user_${Date.now()}`,
          role: 'user',
          content: textToSend,
          timestamp: new Date().toISOString()
        };

        const existingMsgs = (job?.messages && job.messages.length > 0 && !isDifferentBiomarkerAction)
          ? job.messages
          : [getWelcomeMessage()];
        const updatedMessages = [...existingMsgs, userMsg];

        let updatedProfile = profile ? { ...profile } : null;
        let reserved = 0;
        if (profile) {
          const resCredits = reserveCredits(profile, selectedModelId);
          reserved = resCredits.reserved;
          updatedProfile = resCredits.updatedProfile;
          if (onSaveProfile && updatedProfile) {
            await onSaveProfile(updatedProfile);
          }
        }

        if (job) {
          JobStore.updateJob(currentJobId, {
            status: 'queued',
            inputSnapshot,
            messages: updatedMessages,
            creditReserved: reserved,
            creditSettled: false,
            requestId: currentReqId,
            serverSubmittedAt: undefined,
            // FIX: medical jobs are submitted to the server exclusively by
            // JobQueueRunner's executor (App.tsx), unlike food_log/food_compare
            // where LogChat calls fetch('/api/jobs/submit') itself right after this.
            // JobQueueRunner treats clientSubmitPending:true as "the client already
            // submitted this, don't submit again" (see clientOwnsSubmit in App.tsx).
            // Leaving this true here made the executor silently skip the submit
            // fetch on the very first attempt for every medical/biomarker job —
            // no request ever reached /api/gemini/medical-analyze, no Gemini
            // usage appeared, and the job just polled a status that never
            // changed until a retry (isRetryAttempt) forced clientOwnsSubmit
            // false and the submit finally fired.
            clientSubmitPending: false,
            statusMessage: 'Uploading to server… Keep this tab open',
            ...(isDifferentBiomarkerAction ? { attemptCount: 1, maxAttempts: 3 } : {}),
          });
        } else {
          JobStore.createJob({
            id: currentJobId,
            kind: 'medical',
            status: 'queued',
            inputSnapshot,
            messages: updatedMessages,
            creditReserved: reserved,
            creditSettled: false,
            requestId: currentReqId,
            serverSubmittedAt: undefined,
            // FIX: see matching comment in the JobStore.updateJob branch above —
            // medical jobs rely on JobQueueRunner to perform the actual
            // /api/jobs/submit fetch, so this must be false, not true.
            clientSubmitPending: false,
            statusMessage: 'Uploading to server… Keep this tab open',
          });
        }

        // Keep modal open, append messages to local React state
        const liveMsg: ChatMessage = {
          id: `msg_live_${currentJobId}`,
          role: 'assistant',
          content: 'Analyzing medical data in the background...',
          timestamp: new Date().toISOString(),
          isLive: true,
          agentType: 'medical',
          data: {
            userSelectedMode: 'review',
            hasImage: false,
            agentResult: {
              scoutScratchpad: 'Analysis queued...',
              dietitianScratchpad: ''
            }
          }
        };
        setMessages([...existingMsgs, userMsg, liveMsg], false);

        // Clear input compose dock
        setInputText('');

        // Wake queue runner & notify parent
        JobQueueRunner.wake();
        if (onJobEnqueued) {
          onJobEnqueued(currentJobId, 'medical');
        }
        onClose();
      } catch (err: any) {
        console.error('Failed to enqueue medical job:', err);
        clearTimeout(failsafe);
        isSendingRef.current = false;
        setIsSubmitting(false);
        setIsAnalyzing(false);
        const errorMsg: ChatMessage = {
          id: `msg_err_${Date.now()}`,
          role: 'assistant',
          content: `⚠️ **Submission Failed**\n\n${err.message || 'An unexpected error occurred while queueing your request.'}`,
          timestamp: new Date().toISOString(),
          isError: true
        };
        setMessages(prev => [...prev, errorMsg]);
      }
      return;
    }

    if (!textToSend && finalImages.length === 0) {
      if (autoSendMessage) {
        textToSend = autoSendMessage;
      } else if (reviewBiomarkerKey) {
        textToSend = buildBiomarkerReviewPrefill(reviewBiomarkerKey, undefined, biomarkers, profile);
      } else if (isAgent('biomarker_review') || agentType === 'biomarker_review') {
        textToSend = 'Please review my full set of biomarker data and log history.';
      }
    }

    if (!textToSend && finalImages.length === 0) return;

    // Eagerly wait for geolocation if doing food ideas and it's not resolved yet
    let loc = userLocation;
    if (isAgent('food_idea') && !loc) {
      if (navigator.geolocation) {
        try {
          console.log("[Geolocation] Awaiting geolocation resolution before food-idea request...");
          const position = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 4000 });
          });
          loc = { lat: position.coords.latitude, lng: position.coords.longitude };
          setUserLocation(loc);
        } catch (err) {
          console.warn("[Geolocation] Could not await location during handleSend:", err);
        }
      }
    }

    const userMsg: ChatMessage = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: textToSend,
      timestamp: new Date().toISOString(),
      imageUrl: finalImages[0] || undefined,
      imageUrls: finalImages.length > 0 ? finalImages : undefined,
      data: {
        userSelectedMode: mappedMode
      }
    };

    const isFood = isAgent('food');
    const liveMsg: ChatMessage = {
      id: `msg_live_${Date.now()}`,
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      isLive: true,
      agentType: isFood ? 'food' : (isAgent('food_idea') ? 'food_idea' : (agentType || 'agent1')),
      data: {
        userSelectedMode: mappedMode,
        hasImage: finalImages.length > 0,
        agentResult: {
          scoutScratchpad: '',
          dietitianScratchpad: ''
        }
      }
    };

    setMessages(prev => [...prev, userMsg, liveMsg]);
    if (typeof overrideText !== 'string') {
      setInputText('');
    }
    const tempImages = overrideImagesInner.length > 0 ? overrideImagesInner : [...selectedImages];
    const tempAnalysisImages = overrideImagesInner.length > 0 ? overrideImagesInner : [...selectedImagesForAnalysis];
    setSelectedImages([]);
    setSelectedImagesForAnalysis([]);
    setImageDates([]);
    // Task 9: Only reset the live-log accumulator for brand-new submissions.
    // Portion-confirm turns (inPlaceMsgId set) preserve the prior logs so
    // the full turn-1 + turn-2 trace remains visible without a blank gap.
    const isPortionConfirmTurn = !!(extraOptions as any)?.inPlaceMsgId;
    if (!isPortionConfirmTurn) {
      setGlobalLiveLogs('');
      globalLiveLogsRef.current = '';
    }
    setIsAnalyzing(true);
    // Scroll immediately so the user can watch the agent's live thought process
    // as soon as the request starts, instead of waiting for the final answer.
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    });

    try {
      if (isAgent('food')) {
        const executorInput: FoodAgentExecutorInput = {
          jobId: jobId || `legacy_${Date.now()}`,
          text: textToSend,
          images: tempImages.length > 0 ? tempImages : undefined,
          mode: mappedMode,
          lockedModeFamily: jobId ? JobStore.getJob(jobId)?.lockedModeFamily : undefined,
          profile,
          modelId: selectedModelId,
          requestId: currentReqId,
          activeScoutItems: activeScoutItemsFallback || undefined,
          scoutContentType: scoutContentTypeFallback || undefined,
          skipScout,
          activeFoodLogs: activeFoodLogs,
          outOfRangeBiomarkers,
          remainingAllowance,
          messages,
        };

        let resData: any = null;
        let lastCheckpoint: any = null;

        for await (const event of executeFoodAgent(executorInput)) {
          if (event.type === 'checkpoint' && event.checkpoint) {
             lastCheckpoint = event.checkpoint;
             setMessages(prev => {
                const newMsgs = [...prev];
                const lastMsg = newMsgs[newMsgs.length - 1];
                if (lastMsg && lastMsg.role === "assistant" && lastMsg.isLive) {
                   const updatedData = lastMsg.data ? { ...lastMsg.data } : {};
                   updatedData.scoutItems = lastCheckpoint.scoutItems;
                   updatedData.scoutContentType = lastCheckpoint.scoutContentType;
                   return [
                      ...newMsgs.slice(0, newMsgs.length - 1),
                      { ...lastMsg, data: updatedData }
                   ];
                }
                return prev;
             });
          } else if (event.type === 'partial' && event.partialThoughts) {
             const thoughts = event.partialThoughts;
             setLiveThoughts(prev => ({
                ...prev,
                scout: thoughts.scout !== undefined ? thoughts.scout : prev.scout,
                dietitian: thoughts.dietitian !== undefined ? thoughts.dietitian : prev.dietitian,
                dbSearchLog: thoughts.dbSearchLog !== undefined ? thoughts.dbSearchLog : prev.dbSearchLog,
                backendLogs: thoughts.backendLogs !== undefined ? thoughts.backendLogs : prev.backendLogs
             }));
             setMessages(prev => {
                const newMsgs = [...prev];
                const lastMsg = newMsgs[newMsgs.length - 1];
                if (lastMsg && lastMsg.role === "assistant" && lastMsg.isLive) {
                   const updatedData = lastMsg.data ? { ...lastMsg.data } : {};
                   const updatedAgentResult = updatedData.agentResult ? { ...updatedData.agentResult } : {};
                   if (thoughts.activeStage) updatedAgentResult.activeStage = thoughts.activeStage;
                   if (thoughts.scout !== undefined) updatedAgentResult.scoutScratchpad = thoughts.scout;
                   if (thoughts.dietitian !== undefined) updatedAgentResult.dietitianScratchpad = thoughts.dietitian;
                   if (thoughts.backendLogs !== undefined) updatedAgentResult.backendLogs = thoughts.backendLogs;
                   if (thoughts.dbSearchLog !== undefined) updatedAgentResult.dbSearchLog = thoughts.dbSearchLog;
                   return [
                      ...newMsgs.slice(0, newMsgs.length - 1),
                      { ...lastMsg, data: { ...updatedData, agentResult: updatedAgentResult } }
                   ];
                }
                return prev;
             });
          } else if (event.type === 'done') {
             resData = event.data;
          } else if (event.type === 'error') {
             const err: any = new Error(event.message);
             if (event.checkpoint?.scoutItems) err.scoutItems = event.checkpoint.scoutItems;
             if (event.checkpoint?.scoutContentType) err.scoutContentType = event.checkpoint.scoutContentType;
             throw err;
          }
        }

        // Handle `done` event payload identical to existing implementation
        let messageText = resData.message || resData.text || resData.reply || '';
        if (messageText === 'null' || messageText === '""') messageText = '';
        if (!messageText || (typeof messageText === 'string' && messageText.trim().startsWith('{'))) {
          if (resData.report?.globalSummary) messageText = resData.report.globalSummary;
          else if (resData.globalSummary) messageText = resData.globalSummary;
          else if (resData.explanation) messageText = resData.explanation;
          else if (resData.report?._internalReasoning) messageText = resData.report._internalReasoning;
          else if (resData._internalReasoning) messageText = resData._internalReasoning;
        }

        const assistantMsg: ChatMessage = {
          id: `msg_${Date.now() + 1}`,
          role: 'assistant',
          content: messageText,
          timestamp: new Date().toISOString(),
          agentResult: resData,
          agentType: 'food'
        };

        const isPortionClarifyResult = resData.needsPortionClarify || !!resData.portionClarify || resData.mode === 'portion_clarify';
        const clarifiedScoutItems = (Array.isArray(resData.scoutItems) && resData.scoutItems.length > 0)
          ? resData.scoutItems
          : (Array.isArray(resData.portionClarify?.scoutItems) ? resData.portionClarify.scoutItems : (resData.scoutItems || []));

        assistantMsg.data = {
          hasImage: finalImages.length > 0,
          scoutItems: clarifiedScoutItems,
          scoutContentType: resData.scoutContentType,
          mode: resData.mode,
          comparison: resData.comparison,
          needsPortionClarify: isPortionClarifyResult,
          portionClarify: resData.portionClarify,
          resolvedDbCandidates: resData.resolvedDbCandidates || [],
          agentResult: {
            ...resData,
            scoutItems: clarifiedScoutItems,
            activeStage: isPortionClarifyResult ? 'portion_clarify' : (resData.agentResult?.activeStage || ''),
            scoutScratchpad: resData.agentResult?.scoutScratchpad || '',
            dietitianScratchpad: resData.agentResult?.dietitianScratchpad || '',
            backendLogs: resData.agentResult?.backendLogs || liveThoughts.backendLogs || '',
            globalLiveLogs: globalLiveLogsRef.current || undefined
          }
        };

        if (isPortionClarifyResult) {
          const effectiveJobId = jobId || executorInput.jobId;
          assistantMsg.id = `msg_assistant_clarify_${effectiveJobId}`;
          if (effectiveJobId) {
            JobStore.updateJob(effectiveJobId, {
              status: 'awaiting_user',
              statusMessage: 'Waiting for portion choice',
              progressPercent: 45,
              result: resData,
            });
          }
        }

        if (resData.data) {
          const lastFoodLog = [...messages].reverse().find(m => m.data?.pendingFoodLog)?.data?.pendingFoodLog;
          const currentTranscript = [...messages, userMsg, liveMsg].map(m => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
            timestamp: m.timestamp
          }));
          const newFoodLog = {
            ...resData.data,
            date: resData.data.date || lastFoodLog?.date || getCurrentDateInTimezone(profile?.timezone),
            id: `food_${Date.now()}`,
            imageUrl: tempImages.length > 0 ? tempImages[0] : resData.data.imageUrl,
            imageUrls: tempImages.length > 0 ? tempImages : resData.data.imageUrls,
            chatTranscript: currentTranscript
          };
          assistantMsg.data.pendingFoodLog = newFoodLog;
          assistantMsg.pendingFoodLog = newFoodLog;
        } else if (resData.mode === 'evaluation') {
          let carryOverScoutItems = resData.scoutItems || [];
          if (compareOnly && sourceMsgId) {
             const sourceMsg = messages.find(m => m.id === sourceMsgId);
             if (sourceMsg?.data?.scoutItems) carryOverScoutItems = sourceMsg.data.scoutItems;
          }
          assistantMsg.data.comparison = resData.comparison;
          assistantMsg.data.scoutItems = carryOverScoutItems;
        } else if (resData.mode === 'origin') {
          assistantMsg.data.mode = 'origin';
          assistantMsg.data.origins = resData.origins || [];
        }

        const migratedAssistantMsg = migrateMessages([assistantMsg])[0];
        setMessages(prev => [...prev.filter(m => !m.isLive), migratedAssistantMsg]);
        return; // Early return on success!
      }

      let endpoint = '';
      const wired = !isAgent('food') && !isAgent('food_idea')
        ? wireBiomarkerRequest(agentType || (isAgent('front_desk') ? 'front_desk' : isAgent('daily_recommendation') ? 'daily_recommendation' : isAgent('health_baseline') ? 'health_baseline' : 'agent1'), agentTask)
        : null;
      if (isAgent('food')) endpoint = '/api/gemini/food-analyze';
      else if (isAgent('food_idea')) endpoint = '/api/gemini/food-idea';
      else if (isAgent('daily_recommendation')) endpoint = '/api/gemini/daily-recommendation-chat';
      else if (wired?.endpoint) endpoint = wired.endpoint;
      else if (isAgent('health_baseline')) endpoint = '/api/gemini/health-baseline-analyze';
      else if (isAgent('front_desk')) endpoint = '/api/gemini/front-desk';
      else endpoint = '/api/gemini/medical-analyze';

      if (wired?.usesSelectedBiomarkers && !(dataReviewBatchKeys && dataReviewBatchKeys.length > 0)) {
        endpoint = '/api/gemini/medical-analyze';
      }

      const lightProfile = profile ? { ...profile } as any : null;
      if (lightProfile) {
        delete lightProfile.fontSizeTitle;
        delete lightProfile.fontSizeSubtitle;
        delete lightProfile.fontSizeSubtitleSmall;
        delete lightProfile.fontSizeBodySmall;
        delete lightProfile.fontSizeXS;
        delete lightProfile.fontSizeKeyMetric;
        delete lightProfile.fontSizeDescription;
        delete lightProfile.photoUrl;
        delete lightProfile.timezone;
        delete lightProfile.language;
        delete lightProfile.deletedBiomarkerLogIds;
        delete lightProfile.deletedFoodLogIds;
        delete lightProfile.deletedCustomBiomarkerKeys;
        delete lightProfile.agentTriageSummary;
        delete lightProfile.approved_agent1_batches;
        delete lightProfile.approved_data_review_batches;
        delete lightProfile.agentAnalyses;
        delete lightProfile.agentContextualizerSummary;
        delete lightProfile.stripeSubscriptionId;
        // customBiomarkers (full lab results) is never read by the food-analyze
        // or food-idea backend endpoints — only age/gender/weight/height/ethnicity
        // are used, plus the separately-sent, pre-filtered biomarkersNeedingImprovement.
        // Stop sending it for these two request types to shrink the payload and
        // avoid exposing irrelevant lab data (e.g. unrelated screening results)
        // in agent request logs.
        if (isAgent('food') || isAgent('food_idea')) {
          delete lightProfile.customBiomarkers;
        }
      }

      const revIdx = [...messages].reverse().findIndex(m => m.id?.startsWith('welcome_'));
      const lastWelcomeIndex = revIdx >= 0 ? messages.length - 1 - revIdx : -1;
      const activeSessionIdx = lastWelcomeIndex >= 0 ? lastWelcomeIndex : 0;
      
      const bodyData: any = {
        userId: auth.currentUser?.uid || undefined,
        message: userMsg.content,
        image: tempAnalysisImages[0] || tempImages[0] || undefined,
        images: tempAnalysisImages.length > 0 ? tempAnalysisImages : (tempImages.length > 0 ? tempImages : undefined),
        imageDates: tempDates.length > 0 ? tempDates : undefined,
        history: messages.slice(activeSessionIdx).filter(m => !m.id?.startsWith('welcome_')).reduce((acc: any[], m: any) => {
          let extra = "";
          if (m.role === 'assistant') {
            if (m.data?.pendingBiomarkers) extra += `\n[Extracted Biomarkers: ${JSON.stringify(m.data?.pendingBiomarkers)}]`;
            if (m.data?.pendingFoodLog) {
               extra += `\n[Extracted Food: ${m.data?.pendingFoodLog.name}, ${m.data?.pendingFoodLog.quantity}, ${m.data?.pendingFoodLog.nutrients?.calories || 0} kcal. (Full nutrient data omitted for brevity)]`;
            }
            if (m.pendingDate) extra += `\n[Extracted Date: ${m.pendingDate}]`;
            if (m.pendingProfile) extra += `\n[Extracted Profile: ${JSON.stringify(m.pendingProfile)}]`;
          }
          const content = (m.content + extra).trim();
          const last = acc[acc.length - 1];
          if (!last || last.role !== m.role || last.content !== content) {
            acc.push({ role: m.role, content });
          }
          return acc;
        }, []),
        userProfile: lightProfile,
        engine: selectedModelId,
        biomarkerKey: reviewBiomarkerKey,
        batchSize: numberOfBatches || 50
      };
      
      // Clean up undefined fields
      Object.keys(bodyData).forEach(key => {
        if (bodyData[key] === undefined) delete bodyData[key];
      });


      if (isAgent('front_desk') || isAgent('biomarker_review') || agentType === 'biomarker_review') {
        bodyData.profile = bodyData.userProfile;
        bodyData.biomarkers = biomarkers;
        bodyData.biomarkerHistory = (biomarkerHistory || activeHistory || []).slice(-50);
        bodyData.foodLogs = (foodLogs || []).map(f => ({ name: f.name, date: f.date, nutrients: f.nutrients }));
        if (dataReviewBatchKeys && dataReviewBatchKeys.length > 0) {
          bodyData.dataReviewBatchKeys = dataReviewBatchKeys;
        }
        if (reviewBiomarkerKey) {
          const rawCur = (biomarkers?.[reviewBiomarkerKey] || null) as any;
          const curVal = rawCur && typeof rawCur === 'object' && 'value' in rawCur ? rawCur.value : (rawCur ?? '');
          bodyData.reviewContext = buildReviewBiomarkerContext(
            reviewBiomarkerKey,
            curVal,
            biomarkerDefinitions,
            biomarkerHistory || activeHistory || [],
            profile
          );
        }
      }
      if (compareOnly) {
         bodyData.compareOnly = true;
         bodyData.compareItems = compareItems;
      }

      if (isAgent('food')) {
        const lastFoodLog = [...messages].reverse().find(m => m.data?.pendingFoodLog)?.data?.pendingFoodLog;
        if (lastFoodLog) {
          try {
            const prunedMeal = JSON.parse(JSON.stringify(lastFoodLog));
            if (prunedMeal.itemsBreakdown) {
              prunedMeal.itemsBreakdown = prunedMeal.itemsBreakdown.map((item: any) => {
                const cleaned = { ...item };
                delete cleaned.labelNutrientsPerServing;
                return cleaned;
              });
            }
            bodyData.activeMeal = prunedMeal;
          } catch (e) {
            bodyData.activeMeal = lastFoodLog;
          }
        }
        bodyData.userSelectedMode = mappedMode;
        isManualModeRef.current = true;
        
        // Pass the active scout items to the backend so the Dietitian can resolve warnings
        const lastScoutMsg = [...messages].reverse().find(m => m.data?.scoutItems && m.data.scoutItems.length > 0);
        if (lastScoutMsg) {
          bodyData.activeScoutItems = lastScoutMsg.data.scoutItems;
        } else if (activeScoutItemsFallback) {
          bodyData.activeScoutItems = activeScoutItemsFallback;
        }
        if (skipScout) bodyData.skipScout = true;
        if (scoutContentTypeFallback) bodyData.scoutContentType = scoutContentTypeFallback;
        
        // Send a larger recent window (not just -5) so the server can compute a
        // 10-day rolling average of days with 2+ meals logged. This is still
        // purely local/client-loaded data — no new Firestore reads.
        bodyData.foodLogs = (activeFoodLogs || []).slice(-60).map(f => ({ name: f.name, date: f.date, nutrients: f.nutrients }));
        bodyData.biomarkersNeedingImprovement = outOfRangeBiomarkers.map(b => {
          if (b.status === 'flagged') {
            return `${b.name} is FLAGGED (Telemetry data error — please review log in Medical History)`;
          }
          return `${b.name} is ${getBiomarkerStatusLabel(b.key, b.status, profile?.customBiomarkers?.[b.key], b.value, profile).toUpperCase()} (${b.value} ${b.unit}, normal range: ${b.normalRange})`;
        });
        bodyData.remainingAllowance = {
          calories: remainingAllowance.calories,
          caloriesTarget: remainingAllowance.caloriesTarget,
          saturatedFat: remainingAllowance.saturatedFat,
          saturatedFatTarget: remainingAllowance.saturatedFatTarget,
          sodium: remainingAllowance.sodium,
          sodiumTarget: remainingAllowance.sodiumTarget,
          addedSugar: remainingAllowance.addedSugar,
          addedSugarTarget: remainingAllowance.addedSugarTarget,
          carbohydrates: remainingAllowance.carbohydrates,
          carbohydratesTarget: remainingAllowance.carbohydratesTarget,
          solubleFibre: remainingAllowance.solubleFibre,
          solubleFibreTarget: remainingAllowance.solubleFibreTarget,
          protein: remainingAllowance.protein,
          proteinTarget: remainingAllowance.proteinTarget,
          potassium: remainingAllowance.potassium,
          potassiumTarget: remainingAllowance.potassiumTarget,
          unsaturatedFat: remainingAllowance.unsaturatedFat,
          unsaturatedFatTarget: remainingAllowance.unsaturatedFatTarget,
        };
      } else if (isAgent('daily_recommendation')) {
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = String(now.getMonth() + 1).padStart(2, '0');
        const monthPrefix = `${currentYear}-${currentMonth}`;

        // Filter food logs for this month
        const thisMonthFoodLogs = (activeFoodLogs || []).filter(f => f.date && f.date.startsWith(monthPrefix));

        // Group by day
        const dailyNutrientIntake: { [date: string]: { [nutrient: string]: number } } = {};
        thisMonthFoodLogs.forEach(log => {
          const d = log.date;
          if (!dailyNutrientIntake[d]) {
            dailyNutrientIntake[d] = {
              calories: 0,
              protein: 0,
              saturatedFat: 0,
              sodium: 0,
              carbohydrates: 0,
              totalFat: 0
            };
          }
          const nut = (log.nutrients || {}) as any;
          dailyNutrientIntake[d].calories += Number(nut.calories || 0);
          dailyNutrientIntake[d].protein += Number(nut.protein || 0);
          dailyNutrientIntake[d].saturatedFat += Number(nut.saturatedFat || 0);
          dailyNutrientIntake[d].sodium += Number(nut.sodium || 0);
          dailyNutrientIntake[d].carbohydrates += Number(nut.carbohydrates || 0);
          dailyNutrientIntake[d].totalFat += Number(nut.totalFat || 0);
        });

        const emailSuffix = profile?.email ? `_${profile.email.toLowerCase().trim()}` : '_guest';
        const stepsHistoryStr = localStorage.getItem(`googleStepsHistory${emailSuffix}`);
        let stepsHistory: { date: string, value: number }[] = [];
        if (stepsHistoryStr) {
          try {
            stepsHistory = JSON.parse(stepsHistoryStr);
          } catch (e) {}
        }
        const thisMonthSteps = stepsHistory.filter(h => h.date && h.date.startsWith(monthPrefix));

        bodyData.foodLogs = (activeFoodLogs || []).map(f => ({ name: f.name, date: f.date, nutrients: f.nutrients }));
        bodyData.biomarkers = biomarkers;
        bodyData.report = report;
        bodyData.actions = actions;
        bodyData.steps = googleSteps;
        bodyData.location = loc;
        bodyData.thisMonthTrends = {
          dailyNutrientIntake,
          stepsHistory: thisMonthSteps
        };
      } else if (isAgent('health_baseline')) {
        bodyData.biomarkerHistory = activeHistory;
        bodyData.outOfRangeBiomarkers = outOfRangeBiomarkers;
        bodyData.calibratedInsights = getAllAgentCalibrations();
        if (agentTask === 'today' || wired?.pack?.task === 'today') {
          bodyData.foodLogs = (activeFoodLogs || []).map(f => ({ name: f.name, date: f.date, nutrients: f.nutrients }));
          bodyData.report = report;
          bodyData.actions = actions;
          bodyData.steps = googleSteps;
        }
      } else if (isAgent('food_idea')) {
        bodyData.location = loc;
        bodyData.recentMeals = (activeFoodLogs || []).slice(-20).map(f => f.name);
        bodyData.budget = budget;
        bodyData.currency = currency;
        bodyData.maxDistance = maxDistance;
        bodyData.outOfRangeBiomarkers = outOfRangeBiomarkers;
        bodyData.biomarkersNeedingImprovement = outOfRangeBiomarkers.map(b => {
          if (b.status === 'flagged') {
            return `${b.name} is FLAGGED (Telemetry data error — please review log in Medical History)`;
          }
          return `${b.name} is ${getBiomarkerStatusLabel(b.key, b.status, profile?.customBiomarkers?.[b.key], b.value, profile).toUpperCase()} (${b.value} ${b.unit}, normal range: ${b.normalRange})`;
        });
        
        // Fetch real places from Overpass API (client-side bypasses container blocks)
        if (loc) {
          try {
            const radius = Math.min(Number(maxDistance) * 1000, 5000);
            const overpassQuery = `[out:json];(node["amenity"~"restaurant|cafe|fast_food|food_court"](around:${radius},${loc.lat},${loc.lng}););out 30;`;
            const overpassRes = await fetch("https://overpass-api.de/api/interpreter", {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: "data=" + encodeURIComponent(overpassQuery)
            });
            if (overpassRes.ok) {
              const overpassData = await safeParseResponse(overpassRes, null);
              if (overpassData && overpassData.elements && overpassData.elements.length > 0) {
                bodyData.clientNearbyPlaces = overpassData.elements
                  .filter((e: any) => e.tags && e.tags.name)
                  .map((e: any) => ({
                    name: e.tags.name,
                    lat: e.lat,
                    lng: e.lon,
                    address: e.tags['addr:street'] ? `${e.tags['addr:street']} ${e.tags['addr:housenumber'] || ''}` : '',
                    opening_hours: e.tags['opening_hours'] || '--'
                  }));
              }
            }
          } catch (e) {
            console.warn("Client side Overpass fetch failed:", e);
          }
        }
      } else if (isAgent('medical')) {
        bodyData.existingBiomarkers = Array.from(new Set([...(biomarkers ? Object.keys(biomarkers) : []), ...Object.keys(profile?.customBiomarkers || {})]));
        bodyData.numberOfBatches = numberOfBatches;
        const lastMsg = [...messages].reverse().find(m => m.lastProcessedItem !== undefined || m.lastProcessedIndex !== undefined);
        if (lastMsg && lastMsg.lastProcessedItem) {
          bodyData.lastProcessedItem = lastMsg.lastProcessedItem;
        }
        if (lastMsg && lastMsg.lastProcessedIndex !== undefined) {
          bodyData.lastProcessedIndex = lastMsg.lastProcessedIndex;
        }
        if (agentType) {
          let currentStep = 'agent1_step1';
          if (agentType === 'agent1') {
            if (dataReviewBatchIdx !== null && dataReviewBatchIdx !== undefined) {
              currentStep = 'agent1';
            } else {
              // New user-typed text queries must ALWAYS start fresh at Step 1
              currentStep = 'agent1_step1';
            }
            
            // Also find and attach extractedData and bucketMapping if available
            const jsonMsg = [...messages].reverse().find(m => m.data?.agentResult?.extractedData || m.extractedData);
            if (jsonMsg) {
              bodyData.extractedData = jsonMsg.agentResult?.extractedData || jsonMsg.extractedData;
            } else if (extractedData && extractedData.length > 0) {
              bodyData.extractedData = extractedData;
            }
            
            if (lastProcessedIndex !== null && lastProcessedIndex !== undefined) {
              bodyData.lastProcessedIndex = lastProcessedIndex;
            } else if (remainingText) {
              bodyData.remainingText = remainingText;
            }
            if (currentBatch > 1) {
              bodyData.currentBatch = currentBatch;
            }
            if (estimatedTotalMarkers !== null) {
              bodyData.estimatedTotalMarkers = estimatedTotalMarkers;
            }
            
            const allUserText = messages.filter(m => m.role === 'user').map(m => m.content).join('\n\n');
            if (allUserText) {
              bodyData.originalReportText = allUserText;
            }
            
            const mapMsg = [...messages].reverse().find(m => m.data?.agentResult?.bucketMapping || m.data?.bucketMapping);
            if (mapMsg) {
              bodyData.bucketMapping = typeof (mapMsg.agentResult?.bucketMapping || mapMsg.bucketMapping) === 'string'
                ? (mapMsg.agentResult?.bucketMapping || mapMsg.bucketMapping)
                : JSON.stringify(mapMsg.agentResult?.bucketMapping || mapMsg.bucketMapping);
            }
          } else {
            currentStep = (wired?.wireAgentType && wired.wireAgentType !== 'catalog_clean')
              ? wired.wireAgentType
              : agentType;
          }
          bodyData.agentType = currentStep;
          const deletedIds = profile?.deletedBiomarkerLogIds || {};
          bodyData.biomarkerHistory = (biomarkerHistory || []).filter(h => h.sync_state !== 'delete' && !deletedIds[h.id]);
          bodyData.biomarkers = biomarkers || {};
          bodyData.actions = actions || [];
          bodyData.agentDiagnosticSummary = profile?.agentDiagnosticSummary || '';

          if (currentStep === 'data_review' || currentStep === 'agent1') {
            let batchKeys: string[] = [];
            if (typeof textToSend === 'string' && textToSend.includes(':')) {
              const parts = textToSend.split(':');
              const candidateKeys = parts.slice(1).join(':').split(/[\n,]/).map((s: string) => s.trim().toLowerCase()).filter(Boolean);
              if (candidateKeys.length > 0 && candidateKeys.length <= 200) {
                batchKeys = candidateKeys;
              }
            }
            const flaggedList = detectFlaggedTelemetryErrors(biomarkers || {}, profile, biomarkerHistory || [], biomarkerDefinitions);
            if (batchKeys.length === 0 && dataReviewBatchKeys && dataReviewBatchKeys.length > 0) {
              batchKeys = dataReviewBatchKeys;
            } else if (batchKeys.length === 0 && dataReviewBatchIdx === 'custom') {
              try {
                const drKey = `datareview_custom_batch_keys_${userIdentifier}`;
                const a1Key = `agent1_custom_batch_keys_${userIdentifier}`;
                const raw = (currentStep === 'data_review' ? localStorage.getItem(drKey) : localStorage.getItem(a1Key)) 
                         || localStorage.getItem(drKey) 
                         || localStorage.getItem(a1Key);
                batchKeys = JSON.parse(raw || '[]');
              } catch(e) {}
            } else if (batchKeys.length === 0 && dataReviewBatchIdx !== null && dataReviewBatchIdx !== undefined) {
              const allKnownKeys = new Set<string>();
              (biomarkerHistory || []).forEach((h: any) => {
                if (h.biomarkers) {
                  Object.keys(h.biomarkers).forEach(k => {
                    if (h.biomarkers[k] !== undefined && h.biomarkers[k] !== null && h.biomarkers[k] !== '') {
                      allKnownKeys.add(k);
                    }
                  });
                }
              });
              if (biomarkers) {
                Object.keys(biomarkers).forEach(k => {
                  if (biomarkers[k] !== undefined && biomarkers[k] !== null && biomarkers[k] !== '') {
                    allKnownKeys.add(k);
                  }
                });
              }
              const markerKeysList = Array.from(allKnownKeys).sort((a, b) => a.localeCompare(b));
              const bSize = localBatchSize || batchSize || 20;
              const batchRes: string[][] = [];
              for (let i = 0; i < markerKeysList.length; i += bSize) {
                batchRes.push(markerKeysList.slice(i, i + bSize));
              }
              batchKeys = batchRes[dataReviewBatchIdx as number] || [];
            } else if (batchKeys.length === 0) {
              // Fallback when neither batch keys nor batch index were explicitly provided
              if (flaggedList.length > 0) {
                batchKeys = flaggedList.map(f => f.key);
              } else {
                const allKnownKeys = new Set<string>();
                (biomarkerHistory || []).forEach((h: any) => {
                  if (h.biomarkers) {
                    Object.keys(h.biomarkers).forEach(k => {
                      if (h.biomarkers[k] !== undefined && h.biomarkers[k] !== null && h.biomarkers[k] !== '') {
                        allKnownKeys.add(k);
                      }
                    });
                  }
                });
                if (biomarkers) {
                  Object.keys(biomarkers).forEach(k => {
                    if (biomarkers[k] !== undefined && biomarkers[k] !== null && biomarkers[k] !== '') {
                      allKnownKeys.add(k);
                    }
                  });
                }
                batchKeys = Array.from(allKnownKeys);
              }
            }

            if (currentStep === 'data_review') {
              batchKeys = calibratorStaleKeys(batchKeys, profile);
            } else if (currentStep === 'agent1' && (dataReviewBatchIdx !== null && dataReviewBatchIdx !== undefined)) {
              batchKeys = parserLeftoverKeys(batchKeys, profile);
            }

            const flaggedErrorsMap = new Map(flaggedList.map(f => [f.key, f]));

            bodyData.batchBiomarkers = batchKeys.map(k => {
              const customDef = profile?.customBiomarkers?.[k];
              const stdDef = biomarkerDefinitions.find(d => d.key === k || (Array.isArray(d.aliases) && d.aliases.some((a: string) => a.toLowerCase() === k.toLowerCase())));
              const merged = getMergedBiomarkerDef(k, stdDef, customDef);

              const historyEntries: { date: string; value: any }[] = [];
              (biomarkerHistory || []).forEach((h: any) => {
                if (h.biomarkers && h.biomarkers[k] !== undefined && h.biomarkers[k] !== null && h.biomarkers[k] !== '') {
                  historyEntries.push({ date: h.date || 'unknown', value: h.biomarkers[k] });
                }
              });

              const rawVal = biomarkers?.[k] !== undefined && biomarkers?.[k] !== null && biomarkers?.[k] !== ''
                ? biomarkers[k]
                : (historyEntries[0]?.value ?? '');
              const val = rawVal !== '' && rawVal !== undefined && rawVal !== null ? rawVal : 'Baseline / Unrecorded';
              const unit = merged.unit || (k.endsWith('_score') || k.endsWith('_risk') || k.endsWith('_index') ? 'score' : (k === 'steps' ? 'steps' : 'standard'));

              const flaggedItem = flaggedErrorsMap.get(k);

              return {
                key: k,
                name: merged.name || k,
                userValue: val,
                value: val,
                unit,
                normalRange: merged.normalRange || '',
                historicalEntries: historyEntries,
                historicalSummary: historyEntries.map(e => `${e.date}: ${e.value}`).join(' → '),
                flaggedReason: flaggedItem?.reason || null,
                flaggedSamples: flaggedItem?.samples || []
              };
            });
            bodyData.batchIdx = dataReviewBatchIdx;
            bodyData.batchKeys = batchKeys;
            bodyData.dataReviewBatchKeys = batchKeys;
          }
        }
      }

      if (wired?.usesSelectedBiomarkers && endpoint === wired.endpoint) {
        const keys = (dataReviewBatchKeys && dataReviewBatchKeys.length > 0)
          ? dataReviewBatchKeys
          : (bodyData.batchKeys || []);
        const selectedBiomarkers = (Array.isArray(bodyData.batchBiomarkers) && bodyData.batchBiomarkers.length > 0)
          ? bodyData.batchBiomarkers.map((b: any) => ({
              key: b.key,
              name: b.name || b.key,
              currentUnit: b.unit || '',
              currentRange: b.normalRange || '',
              sampleLogs: (b.historicalEntries || []).slice(0, 8),
            }))
          : keys.map((k: string) => ({ key: k, name: k }));
        bodyData.selectedBiomarkers = selectedBiomarkers;
        bodyData.unitPreference = profile?.unitPreference || 'SI';
        bodyData.engine = selectedModelId;
      }

      const storageKey = isAgent('food') ? 'food' : (isAgent('food_idea') ? 'food_idea' : (agentType || 'agent1'));
      const customSystemInstruction = localStorage.getItem(`custom_system_instruction_${storageKey}`);
      const customVariableData = localStorage.getItem(`custom_variable_data_${storageKey}`);
      if (customSystemInstruction) {
        bodyData.customSystemInstruction = customSystemInstruction;
      }
      if (customVariableData) {
        bodyData.customVariableData = customVariableData;
      }

      // Save display-friendly payload for debug mode
      const displayPayload = { ...bodyData };
      if (displayPayload.image && typeof displayPayload.image === 'string') {
        displayPayload.image = displayPayload.image.substring(0, 100) + "... [truncated base64]";
      }
      if (displayPayload.images && Array.isArray(displayPayload.images)) {
        displayPayload.images = displayPayload.images.map((img: any) => typeof img === 'string' ? img.substring(0, 100) + "... [truncated base64]" : img);
      }
      setLastSentPayload(displayPayload);

      let fetchEndpoint = endpoint;
      if (endpoint === '/api/gemini/food-analyze' || endpoint === '/api/gemini/health-baseline-analyze' || endpoint === '/api/gemini/medical-analyze') {
        fetchEndpoint += '?stream=true';
      }

      const response = await fetch(fetchEndpoint, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Session-ID': currentReqId
        },
        body: JSON.stringify(bodyData)
      });

      if (!response.ok) {
        const rawText = await response.text().catch(() => '');
        const looksLikeTimeout = response.status === 504 || response.status === 502 || response.status === 503 || rawText.trim().toLowerCase().startsWith('<!doctype') || rawText.trim().toLowerCase().startsWith('<html');
        throw new Error(looksLikeTimeout
          ? "This analysis took too long and the server timed out. Please try again — if it keeps happening, it may need a longer server timeout setting."
          : `Request failed (${response.status}). Please try again.\n${rawText ? 'Details: ' + rawText.substring(0, 500) : ''}`);
      }

      const contentType = response.headers.get("content-type");
      console.log("[Client SSE] Fetch complete. Status:", response.status, "Content-Type:", contentType);
      console.log("[Client SSE] Response body present:", !!response.body);
      try {
        const headersObj: Record<string, string> = {};
        response.headers.forEach((val, key) => { headersObj[key] = val; });
        console.log("[Client SSE] Response headers list:", JSON.stringify(headersObj, null, 2));
      } catch (e) {}

      let resData: any = {};
      let backendLogsFull = "";
      if (contentType && contentType.includes("text/event-stream")) {
        console.log("[Client SSE] Identified text/event-stream response. Initializing stream reader...");
        const reader = response.body?.getReader();
        if (!reader) {
          console.error("[Client SSE] No stream reader available!");
          throw new Error("No stream reader available");
        }
        const decoder = new TextDecoder();
        const accumulatedByStage: Record<string, string> = { scout: "", dietitian: "" };
        // Full (not delta) current values for scratchpad/log display text. These persist across
        // flush cycles (unlike accumulatedAgentResult/accumulatedThoughts, which are cleared on
        // every flush) so that every patch applied to React state is a complete, correct
        // replacement — never an append-on-top-of-an-already-cumulative-value, which was
        // previously causing duplicated/exponentially growing scratchpad text.
        const scratchpadFullByStage: Record<string, string> = { scout: "", dietitian: "" };
        let dbSearchLogFull = "";
        let lineBuffer = "";

        // --- NEW BATCHING LOGIC START ---
        let pendingPatch = false;
        let accumulatedAgentResult: any = {};
        let accumulatedThoughts: {scout?: string, dietitian?: string, dbSearchLog?: string, activeStage?: string, backendLogs?: string} = {};
        let animationFrameId: number | null = null;

        const flushPatches = () => {
          if (!pendingPatch) { animationFrameId = null; return; }
          // pendingPatch/animationFrameId are reset unconditionally via finally below —
          // previously, if anything in this function threw, animationFrameId stayed
          // non-null forever, which permanently blocked scheduleFlush() from ever
          // scheduling another flush for the rest of the request (it only schedules
          // when animationFrameId is null). A single transient error would silently
          // freeze all further live updates until the unconditional flushPatches()
          // call after the stream closes — i.e. exactly "stuck, then everything at
          // once at the end."
          try {
            if (Object.keys(accumulatedThoughts).length > 0) {
               const thoughtsToMerge = { ...accumulatedThoughts };
               setLiveThoughts(prev => {
                  const next = { ...prev };
                  // thoughtsToMerge values are always the full current value (see
                  // scratchpadFullByStage above) — replace, don't append.
                  if (thoughtsToMerge.scout !== undefined) next.scout = thoughtsToMerge.scout;
                  if (thoughtsToMerge.dietitian !== undefined) next.dietitian = thoughtsToMerge.dietitian;
                  if (thoughtsToMerge.dbSearchLog !== undefined) next.dbSearchLog = thoughtsToMerge.dbSearchLog;
                  if (thoughtsToMerge.backendLogs !== undefined) next.backendLogs = thoughtsToMerge.backendLogs;
                  return next;
               });
               accumulatedThoughts = {};
            }
            
            if (Object.keys(accumulatedAgentResult).length > 0) {
               const resultPatch = { ...accumulatedAgentResult };
               setMessages(prev => {
                  const newMsgs = [...prev];
                  const lastMsg = newMsgs[newMsgs.length - 1];
                  if (lastMsg && lastMsg.role === "assistant" && lastMsg.isLive) {
                     const updatedData = lastMsg.data ? { ...lastMsg.data } : {};
                     const updatedAgentResult = updatedData.agentResult ? { ...updatedData.agentResult } : {};
                     
                     // Every value in resultPatch is already the full current value — always
                     // replace, never append (see where accumulatedAgentResult is populated below).
                     for (const key in resultPatch) {
                        updatedAgentResult[key] = resultPatch[key];
                     }
                     
                     return [
                        ...newMsgs.slice(0, newMsgs.length - 1),
                        { ...lastMsg, data: { ...updatedData, agentResult: updatedAgentResult } }
                     ];
                  }
                  return prev;
               });
               accumulatedAgentResult = {};
            }
          } catch (err) {
            console.error("[Client SSE] Error inside flushPatches:", err);
          } finally {
            // Always reset, even if something above threw, so scheduleFlush() can
            // schedule the next flush instead of being permanently blocked.
            pendingPatch = false;
            animationFrameId = null;
          }
        };

        const scheduleFlush = () => {
          pendingPatch = true;
          if (animationFrameId === null) {
            animationFrameId = setTimeout(flushPatches, 32) as any;
          }
        };
        // --- NEW BATCHING LOGIC END ---

        const extractScratchpadText = (accumulated: string) => {
          const match = accumulated.match(/["']_internalReasoning["']\s*:\s*"/i);
          if (!match || match.index === undefined) return "";
          
          const startQuoteIndex = match.index + match[0].length - 1;
          
          let text = "";
          let escaped = false;
          for (let i = startQuoteIndex + 1; i < accumulated.length; i++) {
            const char = accumulated[i];
            if (escaped) {
              if (char === 'n') text += '\n';
              else if (char === 't') text += '\t';
              else if (char === 'r') text += '\r';
              else text += char;
              escaped = false;
            } else if (char === '\\') {
              escaped = true;
            } else if (char === '"') {
              if (accumulated.length - i > 30) { 
                 text += "\n\n[Building structured JSON items...]";
              }
              return text;
            } else {
              text += char;
            }
          }
          return text;
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunkStr = decoder.decode(value, { stream: true });
          
          scheduleFlush();

          lineBuffer += chunkStr;

          // Process only complete SSE events (delimited by \n\n or \r\n\r\n) from the accumulated buffer
          while (true) {
            let separatorIdx = lineBuffer.indexOf("\n\n");
            let separatorLen = 2;
            let altIdx = lineBuffer.indexOf("\r\n\r\n");
            if (altIdx !== -1 && (separatorIdx === -1 || altIdx < separatorIdx)) {
              separatorIdx = altIdx;
              separatorLen = 4;
            }
            if (separatorIdx === -1) break;
            
            const ev = lineBuffer.substring(0, separatorIdx).trim(); // trim whitespace just in case
            lineBuffer = lineBuffer.substring(separatorIdx + separatorLen);
            if (ev.startsWith("data: ")) {
              try {
                const data = JSON.parse(ev.slice(6));
                console.log(`[APP DIAG] SSE event: type=${data.type} logType=${data.logType} stage=${data.stage} final=${data.final} msgPreview=${(data.message || '').substring(0, 60)}`);
                if (data.type === 'status') {
                  accumulatedAgentResult.activeStage = data.stage;
                  accumulatedAgentResult.stageStatus = data.status;
                  accumulatedThoughts.activeStage = data.stage;
                } else if (data.type === 'log' || data.logType) {
                  const logMsg = data.message || '';
                  if (logMsg) {
                    const taggedLine = data.logType ? `[${data.logType}]${data.timestamp ? `[${data.timestamp}]` : ''} ${logMsg}` : logMsg;
                    backendLogsFull = (backendLogsFull ? backendLogsFull + '\n' : '') + taggedLine;
                    accumulatedThoughts.backendLogs = backendLogsFull;
                    accumulatedAgentResult.backendLogs = backendLogsFull;
                    
                    // Commit live state IMMEDIATELY on every log chunk
                    setLiveThoughts((prev) => ({
                      ...prev,
                      backendLogs: backendLogsFull
                    }));
                  }
                  const isDbLog = data.logType?.startsWith('db_') || logMsg.includes('[Database Search]') || logMsg.includes('[USDA]') || logMsg.includes('[OpenFoodFacts]');
                  
                  if (logMsg && isDbLog) {
                    dbSearchLogFull = (dbSearchLogFull ? dbSearchLogFull + "\n" : "") + logMsg;
                    accumulatedAgentResult.dbSearchLog = dbSearchLogFull;
                    accumulatedThoughts.dbSearchLog = dbSearchLogFull;
                  }

                  const logStage = data.stage || (data.logType?.startsWith('db_') ? 'db_search' : undefined);
                  if (logStage && logStage !== 'scout') {
                    accumulatedAgentResult.activeStage = logStage;
                    accumulatedAgentResult.stageStatus = 'active';
                    accumulatedThoughts.activeStage = logStage;
                  }

                  if (data.logType === 'scout_instruction') accumulatedAgentResult.scoutInstruction = data.message;
                  if (data.logType === 'scout_answer') {
                    accumulatedAgentResult.scoutAnswer = data.message;
                    if (data.items) accumulatedAgentResult.scoutItemsList = data.items;
                  }
                  if (data.logType === 'food_resolver_instruction') accumulatedAgentResult.foodResolverInstruction = data.message;
                  if (data.logType === 'food_resolver_answer') accumulatedAgentResult.foodResolverAnswer = data.message;
                  if (data.logType === 'dietitian_instruction') accumulatedAgentResult.dietitianInstruction = data.message;
                  if (data.logType === 'dietitian_answer') accumulatedAgentResult.dietitianAnswer = data.message;
                } else if (data.chunk || data.thought || data.type === 'stream') {
                  const stage: string = data.stage === 'scout' ? 'scout' : 'dietitian';
                  const chunkText = data.chunk || data.thought || '';
                  
                  if (data.thought) {
                    scratchpadFullByStage[stage as 'scout' | 'dietitian'] += chunkText;
                    accumulatedThoughts[stage as 'scout' | 'dietitian'] = scratchpadFullByStage[stage as 'scout' | 'dietitian'];
                    accumulatedAgentResult[`${stage}Scratchpad`] = scratchpadFullByStage[stage as 'scout' | 'dietitian'];
                  } else if (data.chunk) {
                    accumulatedByStage[stage as 'scout' | 'dietitian'] += data.chunk;
                    const text = extractScratchpadText(accumulatedByStage[stage as 'scout' | 'dietitian']);
                    if (text) {
                      scratchpadFullByStage[stage as 'scout' | 'dietitian'] = text;
                      accumulatedAgentResult[`${stage}Scratchpad`] = text;
                      accumulatedThoughts[stage as 'scout' | 'dietitian'] = text;
                    }
                  }
                } else if (data.final) {
                  resData = data.result;
                } else if (data.error) {
                  resData.error = data.error;
                }
              } catch (e) { /* ignore malformed events */ }
            }
          }
        }
        
        flushPatches(); // Ensure anything pending is flushed
        
        // Flush any remaining complete event left in the buffer after the stream closes
        if (lineBuffer.startsWith("data: ")) {
          try {
            const data = JSON.parse(lineBuffer.slice(6));
            if (data.final) resData = data.result;
            else if (data.error) resData.error = data.error;
          } catch (e) {}
        }
      } else {
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          const rawText = await response.text().catch(() => "");
          try {
            resData = rawText ? JSON.parse(rawText) : {};
          } catch (parseErr) {
            throw new Error(`Server returned invalid JSON (${response.status}): ${rawText.substring(0, 150)}`);
          }
        } else {
          const rawText = await response.text().catch(() => "");
          throw new Error(`Server returned a non-JSON response (${response.status}): ${rawText.substring(0, 150)}`);
        }
      }

      // Save captured agent debug logs. Prefer fetching the full, untruncated log
      // entries from the server (sessionDebugLogs/globalDebugLogs) over the locally
      // accumulated `backendLogsFull`, which is built from the live SSE stream and
      // has long entries (system instructions, DB match lists) truncated to 300
      // chars for wire efficiency. This restores the original format: no synthetic
      // "[backend]" wrapper tag, no duplicated timestamp line, full untruncated text.
      if (backendLogsFull || isAgent('health_baseline') || endpoint.includes('health-baseline-analyze')) {
        let summary = [
          selectedImages.length > 0 ? `[${selectedImages.length} Image(s)]` : null,
          textToSend ? (textToSend.length > 50 ? textToSend.substring(0, 50) + '...' : textToSend) : null
        ].filter(Boolean).join(' ') || 'Empty Request';

        if (isAgent('health_baseline') || endpoint.includes('health-baseline-analyze')) {
          let biomarkerCount = 0;
          if (bodyData.biomarkerHistory && Array.isArray(bodyData.biomarkerHistory)) {
            const keys = new Set<string>();
            bodyData.biomarkerHistory.forEach((log: any) => {
              if (log.biomarkers) Object.keys(log.biomarkers).forEach(k => keys.add(k));
            });
            biomarkerCount = keys.size;
          }
          if (!biomarkerCount && Array.isArray(bodyData.outOfRangeBiomarkers)) {
            biomarkerCount = bodyData.outOfRangeBiomarkers.length;
          }
          if (!biomarkerCount && profile?.customBiomarkers) {
            biomarkerCount = Object.keys(profile.customBiomarkers).length;
          }
          if (!biomarkerCount) biomarkerCount = 20;

          const rawReport = resData?.report || resData || {};
          const topTargetsArr = Array.isArray(rawReport.topNutrientTargets) ? rawReport.topNutrientTargets : 
                                (Array.isArray(rawReport.nutrientTargets) ? rawReport.nutrientTargets : null);
          let targetsCount = 0;
          if (topTargetsArr && topTargetsArr.length > 0) {
            targetsCount = topTargetsArr.length;
          } else if (Array.isArray(rawReport.riskCategories) && rawReport.riskCategories.length > 0) {
            const catTargets = rawReport.riskCategories.flatMap((c: any) => Array.isArray(c.nutrientTargets) ? c.nutrientTargets : []);
            if (catTargets.length > 0) {
              targetsCount = new Set(catTargets.map((t: any) => typeof t === 'string' ? t : (t?.nutrientKey || t?.key))).size;
            }
          }
          if (!targetsCount) targetsCount = 4;
          summary = `${targetsCount} top targets - ${biomarkerCount}b`;
        }

        let fullLogs: { timestamp: string; message: string }[] | null = null;
        try {
          const debugLogsRes = await fetch(`/api/gemini/debug-logs?sessionId=${currentReqId}`);
          if (debugLogsRes.ok) {
            const debugLogsData = await safeParseResponse(debugLogsRes, null);
            if (debugLogsData && Array.isArray(debugLogsData.logs)) {
              fullLogs = debugLogsData.logs;
            }
          }
        } catch (e) {
          // Fall back to the local truncated stream below if the fetch fails
        }
        saveAgentRequestLog({
          id: currentReqId,
          timestamp: new Date().toISOString(),
          summary,
          logs: fullLogs || (backendLogsFull ? backendLogsFull.split('\n').map(line => ({ timestamp: new Date().toISOString(), message: line })) : [{ timestamp: new Date().toISOString(), message: `[health_coach] Completed Health Coach analysis (${summary})` }])
        });
      }

      if (resData.error) {
        const err: any = new Error(resData.error);
        if (resData.scoutItems) err.scoutItems = resData.scoutItems;
        if (resData.scoutContentType) err.scoutContentType = resData.scoutContentType;
        throw err;
      }

      // Deduct agent credits upon successful response
      if (profile) {
        const updatedProfile = deductAgentCredits(profile, selectedModelId);
        if (onSaveProfile) {
          await onSaveProfile(updatedProfile);
        }
      }

      if (bodyData.batchBiomarkers && !resData.batchBiomarkers) {
        resData.batchBiomarkers = bodyData.batchBiomarkers;
      }

      let messageText = resData.message || resData.text || resData.reply || '';
      if (messageText === 'null' || messageText === '""') messageText = '';
      if (!messageText || (typeof messageText === 'string' && messageText.trim().startsWith('{'))) {
        if (resData.report?.globalSummary) {
          messageText = resData.report.globalSummary;
        } else if (resData.globalSummary) {
          messageText = resData.globalSummary;
        } else if (resData.explanation) {
          messageText = resData.explanation;
        } else if (resData.report?._internalReasoning) {
          messageText = resData.report._internalReasoning;
        } else if (resData._internalReasoning) {
          messageText = resData._internalReasoning;
        }
      }

      if (resData.updatedProfile && onSaveProfile) {
        onSaveProfile(resData.updatedProfile);
      }
      if (resData.newBiomarkerLogs && resData.newBiomarkerLogs.length > 0 && onAddBiomarkerLogs) {
        onAddBiomarkerLogs(resData.newBiomarkerLogs);
      }

      const assistantMsg: ChatMessage = {
        id: `msg_${Date.now() + 1}`,
        role: 'assistant',
        content: messageText,
        timestamp: new Date().toISOString(),
        agentResult: resData,
      };
      
      if (isAgent('food_idea')) {
        assistantMsg.agentType = 'food_idea';
        if (resData.ideas && resData.ideas.length > 0) {
          assistantMsg.data = { pendingFoodIdeas: resData.ideas };
          assistantMsg.pendingFoodIdeas = resData.ideas;
        }
      } else {
        const activeAgentType = (agentType || resData.agentType || (resData.extractedData && resData.extractedData.trim() && resData.extractedData.trim() !== '[]' ? 'agent1' : null)) as string | null;
        if (activeAgentType) {
          assistantMsg.agentType = (activeAgentType === 'agent1_step1' ? 'agent1' : activeAgentType) as AgentType;
          assistantMsg.agentResult = resData;
          assistantMsg.lastProcessedIndex = resData.lastProcessedIndex;
          assistantMsg.lastProcessedItem = resData.lastProcessedItem;
          const unitMap = collectCatalogUnitMap(profile);
          const isBiomarkerReviewTurn = activeAgentType === 'biomarker_review' || agentType === 'biomarker_review';
          const serverCmds = Array.isArray(resData.modificationCommand) ? resData.modificationCommand : [];
          const reviewCmds = isBiomarkerReviewTurn
            ? (serverCmds.length ? serverCmds : enrichReviewModificationCommands(serverCmds, activeHistory || [], unitMap))
            : resData.modificationCommand;
          assistantMsg.modificationCommand = reviewCmds;
          assistantMsg.data = {
            agentResult: {
              ...resData,
              modificationCommand: reviewCmds,
              scoutScratchpad: resData.scoutScratchpad || liveThoughts.scout || '',
              dietitianScratchpad: resData.dietitianScratchpad || liveThoughts.dietitian || '',
              backendLogs: resData.backendLogs || backendLogsFull || liveThoughts.backendLogs || '',
              globalLiveLogs: resData.globalLiveLogs || globalLiveLogsRef.current || liveThoughts.globalLiveLogs || liveThoughts.backendLogs || '',
              dbSearchLog: resData.dbSearchLog || liveThoughts.dbSearchLog || ''
            }
          };
          if (activeAgentType === 'agent1' || activeAgentType === 'agent1_step1') {
            assistantMsg.agentTypeStep = resData.agentType || 'agent1_step1';
          const originalReport = bodyData.originalReportText || bodyData.message;
          if (originalReport) {
            localStorage.setItem('agent1_original_report_text', originalReport);
          }
          }
          if (onAgentAnalysisSaved && agentType) {
            // B3 FIX: persist the normalized agent type (assistantMsg.agentType), not the
            // raw server-step type (e.g. 'agent1_step1'). InsightsTab.tsx's biomarker
            // review tables key off the normalized type ('agent1'), so saving the raw
            // step type silently hid the review table for every biomarker agent whose
            // raw type differs from its normalized/display type.
            activeAnalysisIdRef.current = await onAgentAnalysisSaved(assistantMsg.agentType || agentType, resData, activeAnalysisIdRef.current || undefined);
          }
        } else {
          assistantMsg.mode = resData.mode;
          assistantMsg.status = resData.status;
          assistantMsg.planningDetails = resData.planningDetails;
          assistantMsg.lastProcessedItem = resData.lastProcessedItem;
          assistantMsg.lastProcessedIndex = resData.lastProcessedIndex;
          assistantMsg.modificationCommand = resData.modificationCommand;
          if (Array.isArray(resData.modificationCommand) && resData.modificationCommand.length) {
            assistantMsg.data = {
              ...(assistantMsg.data || {}),
              agentResult: {
                ...(assistantMsg.data?.agentResult || {}),
                ...resData,
                modificationCommand: resData.modificationCommand
              }
            };
          }
          assistantMsg.pendingBiomarkerEntries = resData.entries || resData.extractedData || [];
          // Legacy fallback
          assistantMsg.pendingBiomarkers = resData.biomarkers;
          assistantMsg.pendingDate = resData.date;
          
          // Merge custom biomarker definitions into profile if any
          let mergedProfile = { ...resData.profile };
          let defsWithApproval: { [key: string]: any } = {};

          if (resData.customBiomarkerDefs && Object.keys(resData.customBiomarkerDefs).length > 0) {
            Object.entries(resData.customBiomarkerDefs).forEach(([k, v]: [string, any]) => {
              const mapped = getMappedBiomarkerKey(k) || k;
              if (isCatalogBuiltIn(mapped)) return;
              const existing = profile?.customBiomarkers?.[mapped] || profile?.customBiomarkers?.[k];
              if (existing) {
                defsWithApproval[mapped] = { ...existing, ...v, needsApproval: existing.needsApproval };
              } else if (shouldStampExtractedDefPending(mapped)) {
                defsWithApproval[mapped] = { ...v, needsApproval: true };
              }
            });
          }

          if (resData.unmappedTests && Array.isArray(resData.unmappedTests)) {
            resData.unmappedTests.forEach((test: any) => {
              if (!test) return;
              const raw_name = test.raw_name || (typeof test === 'string' ? test : '');
              if (!raw_name) return;
              const suggested_key = test.suggested_key || raw_name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
              const mapped = getMappedBiomarkerKey(suggested_key) || suggested_key;
              if (isCatalogBuiltIn(mapped)) return;
              if (!defsWithApproval[mapped] && shouldStampExtractedDefPending(mapped, profile?.customBiomarkers?.[mapped])) {
                defsWithApproval[mapped] = {
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

          if (Object.keys(defsWithApproval).length > 0) {
            mergedProfile.customBiomarkers = {
              ...(profile?.customBiomarkers || {}),
              ...defsWithApproval
            };
          }
          assistantMsg.pendingProfile = mergedProfile;
        }
      }

      const migratedAssistantMsg = migrateMessages([assistantMsg])[0];

      setMessages(prev => {
        const filteredPrev = prev.filter(m => !m.isLive);
        if (isAgent('food') && resData.mode === 'modify' && (resData.data || (resData.scoutItems && resData.scoutItems.length > 0))) {
          let newPrev = [...filteredPrev];
          let wasMerged = false;

          if (resData.data) {
            // Check if this food was already saved to database history
            const targetMsg = [...filteredPrev].reverse().find(m => m.data?.pendingFoodLog);
            const wasLogged = targetMsg ? loggedMessageIds.includes(targetMsg.id) : false;
            if (wasLogged && targetMsg?.data?.pendingFoodLog) {
              // Automatically mark the modified card message as logged too
              setLoggedMessageIds(prevIds => [...prevIds, migratedAssistantMsg.id]);
              // Automatically trigger the log update handler to push modifications to database
              if (onLogFood) {
                onLogFood({
                  ...targetMsg.data.pendingFoodLog,
                  ...resData.data,
                  imageUrls: (resData.data?.imageUrls && resData.data.imageUrls.length > 0)
                    ? resData.data.imageUrls
                    : (targetMsg.data.pendingFoodLog?.imageUrls || targetMsg.imageUrls || []),
                  imageUrl: resData.data?.imageUrl || targetMsg.data.pendingFoodLog?.imageUrl || targetMsg.imageUrl || undefined
                } as FoodLog);
              }
            }

            newPrev = [...newPrev].reverse().map(m => {
              if (!wasMerged && m.data?.pendingFoodLog) {
                wasMerged = true;

                // If this update removed an item, prune the matching entry from
                // scoutItems too — the "Meal composition" gallery/chips read from
                // scoutItems (not itemsBreakdown), so without this they keep
                // showing items that were just removed.
                let prunedScoutItems = (resData.scoutItems && resData.scoutItems.length > 0) ? resData.scoutItems : m.data?.scoutItems;
                if (Array.isArray(resData.modificationCommand)) {
                  const removedScoutIndices = new Set<number>();
                  const removedAnItem = resData.modificationCommand.some((cmd: any) => cmd?.action === 'remove_item');
                  if (removedAnItem) {
                    const oldItems = m.data?.pendingFoodLog?.itemsBreakdown || [];
                    const newItems = resData.data?.itemsBreakdown || [];
                    const newIndices = new Set(newItems.map((it: any) => it.scoutIndex));
                    oldItems.forEach((it: any) => {
                      if (it.scoutIndex !== undefined && !newIndices.has(it.scoutIndex)) {
                        removedScoutIndices.add(it.scoutIndex);
                      }
                    });
                  }
                  if (removedScoutIndices.size > 0 && Array.isArray(m.data?.scoutItems)) {
                    prunedScoutItems = (prunedScoutItems || m.data.scoutItems).filter((s: any) => !removedScoutIndices.has(s.scoutIndex));
                  }
                }

                return {
                  ...m,
                  // Update the message text in place so the new clinical assessment
                  // replaces the old one directly under the meal card title, instead
                  // of appearing as a separate duplicate chat bubble.
                  content: resData.text || resData.message || m.content,
                  data: {
                    ...m.data,
                    scoutItems: prunedScoutItems,
                    pendingFoodLog: {
                      ...m.data?.pendingFoodLog,
                      ...resData.data,
                      imageUrls: (resData.data?.imageUrls && resData.data.imageUrls.length > 0)
                        ? resData.data.imageUrls
                        : (m.data?.pendingFoodLog?.imageUrls || m.imageUrls || []),
                      imageUrl: resData.data?.imageUrl || m.data?.pendingFoodLog?.imageUrl || m.imageUrl || undefined
                    }
                  }
                };
              }
              return m;
            }).reverse();
          }

          if (resData.scoutItems && resData.scoutItems.length > 0) {
            // A correction was resolved for a previously flagged item (text correction
            // or new photo). MODE C intentionally returns foodData=null when no full
            // recompute is needed, so this must run independently of the pendingFoodLog
            // merge above — otherwise the corrected scoutItems array is silently
            // dropped and "Items in Review" / the thumbnail keep showing the stale item.
            let scoutUpdated = false;
            newPrev = [...newPrev].reverse().map(m => {
              if (!scoutUpdated && m.data?.scoutItems && m.data.scoutItems.length > 0) {
                scoutUpdated = true;
                return { ...m, data: { ...m.data, scoutItems: resData.scoutItems } };
              }
              return m;
            }).reverse();
          }

          // If we successfully merged the update into the existing meal card, do NOT
          // also append a second assistant message — that previously caused the
          // dietitian's response text and "Meal composition" list to render twice.
          if (wasMerged) {
            return newPrev;
          }

          // Clear the pending food log from the new assistant message so it doesn't render a duplicate card
          if (migratedAssistantMsg.data) {
            migratedAssistantMsg.data.pendingFoodLog = null;
          }
          return [...newPrev, migratedAssistantMsg];
        }
        return [...filteredPrev, migratedAssistantMsg];
      });
    } catch (err: any) {
      console.error(err);
      const isTimeout = err.message?.includes("timed out") || err.message?.includes("150s") || err.message?.includes("timeout") || err.message?.includes("took too long") || err.message?.toLowerCase()?.includes("abort");
      const isQuota = err.message?.includes("429") || err.message?.includes("quota") || err.message?.toUpperCase()?.includes("RESOURCE_EXHAUSTED");
      
      let displayErr = err.message || "An error occurred during processing.";
      if (err.message && err.message.toLowerCase().includes("failed to fetch")) {
        displayErr = "Network error: Failed to reach the server. Please check your internet connection or verify that the server is running. (Original error: " + err.message + ")";
      } else if (err.message && err.message.toLowerCase() === "network error") {
        displayErr = "Network error: The browser failed to complete the request (CORS, offline, or server abruptly closed the connection).";
      }
      if (isTimeout) {
        displayErr = `The analysis timed out after 150 seconds. The selected model (${selectedModelId}) may be taking too long. Please retry your request or switch to a different model from the top-left model selector.`;
      } else if (isQuota) {
        displayErr = "The AI agent hit a rate limit (quota exceeded). Please wait a few moments or switch to a different model from the top-left model selector.";
      }

      if (isAgent('food')) {
        const errMsg: any = {
          id: `msg_err_${Date.now()}`,
          role: 'assistant',
          content: displayErr,
          timestamp: new Date().toISOString(),
          agentUnavailable: true,
          data: {
            userSelectedMode: mappedMode,
            ...(err.scoutItems && err.scoutItems.length > 0 ? {
              scoutItems: err.scoutItems,
              scoutContentType: err.scoutContentType || 'visual'
            } : {})
          }
        };
        setMessages(prev => [
          ...prev.filter(m => !m.isLive && !m.isError && !m.agentUnavailable && !/Failed to process your request|Analysis failed|Vision Scout Failed|Gemini unavailable|rate limit|quota exceeded|quota \(\d+\)|503|429|Service Unavailable/i.test(m.content || '')),
          errMsg
        ]);
        if (onGoToManualEdit && !isTimeout && !isQuota) {
          setTimeout(() => {
            onGoToManualEdit(displayErr);
          }, 800);
        }
      } else {
        setMessages(prev => [
          ...prev.filter(m => !m.isLive && !m.isError && !m.agentUnavailable && !/Failed to process your request|Analysis failed|Vision Scout Failed|Gemini unavailable|rate limit|quota exceeded|quota \(\d+\)|503|429|Service Unavailable/i.test(m.content || '')),
          {
            id: `msg_err_${Date.now()}`,
            role: 'assistant',
            content: displayErr,
            timestamp: new Date().toISOString()
          }
        ]);
      }
    } finally {
      clearTimeout(failsafe);
      isSendingRef.current = false;
      setIsSubmitting(false);
      setIsAnalyzing(false);
      setActiveReqId(null);
    }
  };

  const lastAutoSendKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (isOpen && autoSendMessage && (isAgent('medical') || isAgent('daily_recommendation'))) {
      if (agentType === 'agent1' || agentType === 'agent2' || agentType === 'agent3' || agentType === 'agent4' || agentType === 'agent5' || agentType === 'agent7') {
        return;
      }
      if (agentType === 'data_review' || agentType === 'biomarker_review') {
        setInputText(autoSendMessage);
        return;
      }

      const currentSendKey = `${agentType || 'med'}_${reviewBiomarkerKey || ''}_${autoSendMessage}`;
      if (lastAutoSendKeyRef.current !== currentSendKey) {
        lastAutoSendKeyRef.current = currentSendKey;
        const timer = setTimeout(() => {
          handleSend(autoSendMessage);
        }, 350);
        return () => clearTimeout(timer);
      }
    }
  }, [isOpen, autoSendMessage, type, agentType, reviewBiomarkerKey]);

  useEffect(() => {
    if (type !== 'food') return;
    const onGolden = (ev: Event) => {
      const d = (ev as CustomEvent).detail || {};
      if (!d.caseId || !Array.isArray(d.photos) || d.photos.length === 0) return;
      if (!consumeGoldenAnalyzeToken(d.token)) return;
      handleSend(
        { text: d.query || 'Analyze this meal photo.', imageUrls: d.photos, goldenCaseId: d.caseId, userSelectedMode: 'review' },
        d.photos,
        { goldenCaseId: d.caseId }
      );
    };
    window.addEventListener(GOLDEN_NEW_ANALYZE_EVENT, onGolden as EventListener);
    return () => window.removeEventListener(GOLDEN_NEW_ANALYZE_EVENT, onGolden as EventListener);
  }, [type]);

  const handleContinueExtractionChunk = async (msg: any) => {
    setIsAnalyzing(true);
    // Scroll immediately so the user can watch the agent's live thought process
    // as soon as the request starts, instead of waiting for the final answer.
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    });

    setGlobalLiveLogs('');
    globalLiveLogsRef.current = '';
    setMessages(prev => prev.map(m => (m.id === msg.id ? { ...m, isLive: true } : m)));

    try {
      const msgIndex = messages.findIndex(m => m.id === msg.id);
      const allUserText = messages.slice(0, msgIndex).filter(m => m.role === 'user').map(m => m.content).join('\n\n');
      const nextBatch = (msg.data?.agentResult?.currentBatch || 1) + 1;

      const lightProfile = profile ? { ...profile } as any : null;
      if (lightProfile) {
        delete lightProfile.fontSizeTitle;
        delete lightProfile.fontSizeSubtitle;
        delete lightProfile.fontSizeSubtitleSmall;
        delete lightProfile.fontSizeBodySmall;
        delete lightProfile.fontSizeXS;
        delete lightProfile.fontSizeKeyMetric;
        delete lightProfile.fontSizeDescription;
        delete lightProfile.photoUrl;
        delete lightProfile.timezone;
        delete lightProfile.language;
        delete lightProfile.deletedBiomarkerLogIds;
        delete lightProfile.deletedFoodLogIds;
      }

      const bodyData: any = {
        agentType: 'agent1_step1',
        message: `continue. CRITICAL: Do NOT map a test to an existing key if it is not a perfect match. Do not use surrogate markers. If a test does not have a perfect match in the EXISTING DATABASE KEYS, you MUST extract it as a new biomarker with a lowercase snake_case key (e.g., 'pulse_rate'). Do not generate empty or null entries for tests that are not present in the text.`,
        originalReportText: allUserText,
        currentBatch: nextBatch,
        extractedData: msg.data?.agentResult?.extractedData || msg.extractedData,
        remainingText: msg.data?.agentResult?.remainingText || '',
        lastProcessedIndex: msg.data?.agentResult?.lastProcessedIndex ?? null,
        estimatedTotalMarkers: msg.data?.agentResult?.estimatedTotalMarkers,
        numberOfBatches: numberOfBatches,
        engine: selectedModelId,
        userProfile: lightProfile,
        biomarkerKey: reviewBiomarkerKey,
        batchSize: numberOfBatches || 50
      };

      trackApiCall('gemini', `Medical Analyze - ${agentType}`);
      const currentReqId = generateQueryId();
      setActiveQueryId(currentReqId);

      const response = await fetch('/api/gemini/medical-analyze', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Session-ID': currentReqId
        },
        body: JSON.stringify(bodyData)
      });

      try {
        const logsRes = await fetch(`/api/gemini/debug-logs?sessionId=${currentReqId}`);
        if (logsRes.ok) {
           const logsData = await safeParseResponse(logsRes, null);
           if (logsData && logsData.logs && logsData.logs.length > 0) {
              saveAgentRequestLog({
                 id: currentReqId,
                 timestamp: new Date().toISOString(),
                                   summary: `[Medical Analyze] Batch ${nextBatch} (Continue)`,
                  logs: logsData.logs
               });
            }
         }
      } catch (e) {
        console.warn("Could not save agent request logs", e);
      }

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Server returned ${response.status}: ${errText}`);
      }

      const contentType = response.headers.get("content-type"); let resData: any = {}; if (contentType && contentType.includes("text/event-stream")) { const reader = response.body?.getReader(); if (!reader) throw new Error("No stream reader available"); const decoder = new TextDecoder(); let accumulatedText = ""; let accumulatedByStage: { scout: string, dietitian: string } = { scout: "", dietitian: "" }; while (true) { const { done, value } = await reader.read(); if (done) break; const chunkStr = decoder.decode(value, { stream: true }); const events = chunkStr.split("\n\n"); for (const ev of events) { if (ev.startsWith("data: ")) { try { const data = JSON.parse(ev.slice(6)); if (data.chunk) { accumulatedText += data.chunk; const stage: string = data.stage === 'scout' ? 'scout' : 'dietitian'; accumulatedByStage[stage as keyof typeof accumulatedByStage] += data.chunk; const scoutMatch = accumulatedByStage.scout.match(/"(?:scratchpad|_internalReasoning)"\s*:\s*"([^]*?)("|$)/); const dietMatch = accumulatedByStage.dietitian.match(/"(?:scratchpad|_internalReasoning)"\s*:\s*"([^]*?)("|$)/); setMessages(prev => { const newMsgs = [...prev]; const lastMsg = newMsgs[newMsgs.length - 1]; if (lastMsg && lastMsg.role === "assistant" && lastMsg.isLive) { const updatedData = lastMsg.data ? { ...lastMsg.data } : {}; const updatedAgentResult = updatedData.agentResult ? { ...updatedData.agentResult } : {}; let hasChanges = false; if (scoutMatch) { updatedAgentResult.scoutScratchpad = scoutMatch[1].replace(/\\n/g, "\n").replace(/\\\"/g, "\""); hasChanges = true; } if (dietMatch) { updatedAgentResult.dietitianScratchpad = dietMatch[1].replace(/\\n/g, "\n").replace(/\\\"/g, "\""); hasChanges = true; } if (hasChanges) { return [ ...newMsgs.slice(0, newMsgs.length - 1), { ...lastMsg, data: { ...updatedData, agentResult: updatedAgentResult } } ]; } } return prev; }); } else if (data.final) { resData = data.result; } } catch (e) {} } } } } else {
        const responseContentType = response.headers.get("content-type");
        if (responseContentType && responseContentType.includes("application/json")) {
          resData = await response.json();
        } else {
          const rawText = await response.text().catch(() => "");
          throw new Error(`Server returned a non-JSON response (${response.status}): ${rawText.substring(0, 150)}`);
        }
      }

      try {
        fetch(`/api/gemini/debug-logs?sessionId=${currentReqId}`).then(async (logsRes) => {
          if (logsRes.ok) { 
             const logsData = await safeParseResponse(logsRes, null);
             if (logsData && logsData.logs && logsData.logs.length > 0) {
                saveAgentRequestLog({ 
                   id: currentReqId, 
                   timestamp: new Date().toISOString(), 
                   summary: `[Medical Analyze] Batch ${nextBatch} (Continue)`, 
                   logs: logsData.logs 
                });
             } 
          }
        }).catch(e => console.warn("Could not save agent request logs", e));
      } catch (e) {}

      setMessages(prev => prev.map(m => {
        if (m.id === msg.id) {
          // Parse old YAML entries
          const oldJsonStr = m.data?.agentResult?.extractedData || '';
          let oldEntries: any[] = [];
          if (oldJsonStr) {
            try {
              let oldParsed = oldJsonStr;
              if (typeof oldJsonStr === 'string') {
                const cleanedOld = oldJsonStr.replace(/```(?:json)?/gi, '').trim();
                try {
                  oldParsed = JSON.parse(cleanedOld);
                } catch(e) {
                  oldParsed = JSON.parse(cleanedOld);
                }
              }
              oldEntries = Array.isArray(oldParsed) 
                ? oldParsed 
                : (oldParsed?.biomarkers || oldParsed?.entries || oldParsed?.data || []);
              if (!Array.isArray(oldEntries)) oldEntries = [];
            } catch (e) {
              console.warn("Failed to parse old JSON/YAML", e);
            }
          }

          // Parse new JSON entries
          const newJsonStr = resData.extractedData || '';
          let newEntries: any[] = [];
          if (newJsonStr) {
            try {
              let newParsed = newJsonStr;
              if (typeof newJsonStr === 'string') {
                const cleanedNew = newJsonStr.replace(/```(?:json)?/gi, '').trim();
                try {
                  newParsed = JSON.parse(cleanedNew);
                } catch(e) {
                  newParsed = JSON.parse(cleanedNew);
                }
              }
              newEntries = Array.isArray(newParsed) 
                ? newParsed 
                : (newParsed?.biomarkers || newParsed?.entries || newParsed?.data || []);
              if (!Array.isArray(newEntries)) newEntries = [];
            } catch (e) {
              console.warn("Failed to parse new YAML", e);
            }
          }

          // Merge entries and deduplicate
          let combinedEntries = [...oldEntries];
          newEntries.forEach((newE: any) => {
            if (!newE || typeof newE !== 'object') return;
            const newKey = String(newE.biomarker || newE.name || '').trim().toLowerCase();
            const newDate = String(newE.date || '').trim();
            const newVal = String(newE.numeric_value !== undefined && newE.numeric_value !== null ? newE.numeric_value : (newE.qualitative_value || newE.value || '')).trim();
            
            const isDuplicate = oldEntries.some((oldE: any) => {
              if (!oldE || typeof oldE !== 'object') return false;
              const oldKey = String(oldE.biomarker || oldE.name || '').trim().toLowerCase();
              const oldDate = String(oldE.date || '').trim();
              const oldVal = String(oldE.numeric_value !== undefined && oldE.numeric_value !== null ? oldE.numeric_value : (oldE.qualitative_value || oldE.value || '')).trim();
              return oldKey === newKey && oldDate === newDate && oldVal === newVal;
            });
            
            if (!isDuplicate) {
              combinedEntries.push(newE);
            }
          });

          // Convert combined back to JSON
          let combinedJsonStr = resData.extractedData || oldJsonStr;
          if (combinedEntries.length > 0) {
            try {
              combinedJsonStr = JSON.stringify(combinedEntries, null, 2);
            } catch (e) {
              console.warn("Failed to stringify combined entries", e);
            }
          }
          
          let combinedUnmappedTests = [
            ...(Array.isArray(m.data?.agentResult?.unmappedTests) ? m.data.agentResult.unmappedTests : []),
            ...(Array.isArray(resData.unmappedTests) ? resData.unmappedTests : [])
          ];
          
          // Deduplicate unmapped tests by raw_name
          const uniqueUnmapped = new Map();
          combinedUnmappedTests.forEach(test => {
            if (test && test.raw_name) {
              uniqueUnmapped.set(test.raw_name, test);
            }
          });
          combinedUnmappedTests = Array.from(uniqueUnmapped.values());

          const updatedMsg = {
            ...m,
            content: resData.text || m.content,
            isLive: false,
            data: {
              ...m.data,
              agentResult: {
                ...m.data?.agentResult,
                text: resData.text || m.data?.agentResult?.text,
                extractedData: combinedJsonStr,
                hasMoreMarkers: resData.hasMoreMarkers,
                remainingText: resData.remainingText || '',
                lastProcessedIndex: resData.lastProcessedIndex ?? null,
                currentBatch: resData.currentBatch || nextBatch,
                unmappedTests: combinedUnmappedTests,
                estimatedTotalMarkers: resData.estimatedTotalMarkers !== undefined ? resData.estimatedTotalMarkers : m.data?.agentResult?.estimatedTotalMarkers
              }
            }
          };
          return migrateMessages([updatedMsg])[0];
        }
        return m;
      }));
    } catch (err: any) {
      console.error(err);
      setMessages(prev => [
        ...prev,
        {
          id: `msg_err_${Date.now()}`,
          role: 'assistant',
          content: `Error during chunk extraction: ${err.message}`,
          timestamp: new Date().toISOString(),
          isError: true,
          errorStep: 'agent1_step1',
          originalMsg: msg
        }
      ]);
    } finally {
      setIsAnalyzing(false);
      setMessages(prev => prev.map(m => (m.id === msg.id ? { ...m, isLive: false } : m)));
    }
  };

  const handleAgent1Step = async (step: 'agent1_step2' | 'agent1_step3', msg: any) => {
    setIsAnalyzing(true);
    // Scroll immediately so the user can watch the agent's live thought process
    // as soon as the request starts, instead of waiting for the final answer.
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    });

    try {
      const lightProfile = profile ? { ...profile } as any : null;
      if (lightProfile) {
        delete lightProfile.fontSizeTitle;
        delete lightProfile.fontSizeSubtitle;
        delete lightProfile.fontSizeSubtitleSmall;
        delete lightProfile.fontSizeBodySmall;
        delete lightProfile.fontSizeXS;
        delete lightProfile.fontSizeKeyMetric;
        delete lightProfile.fontSizeDescription;
        delete lightProfile.photoUrl;
        delete lightProfile.timezone;
        delete lightProfile.language;
        delete lightProfile.deletedBiomarkerLogIds;
        delete lightProfile.deletedFoodLogIds;
      }

      const bodyData: any = {
        agentType: step,
        extractedData: msg.data?.agentResult?.extractedData || msg.extractedData,
        bucketMapping: msg.data?.agentResult?.bucketMapping ? JSON.stringify(msg.data?.agentResult.bucketMapping) : msg.data?.bucketMapping ? JSON.stringify(msg.data?.bucketMapping) : undefined,
        message: "Continue processing",
        engine: selectedModelId,
        userProfile: lightProfile,
        biomarkerKey: reviewBiomarkerKey
      };

      // To grab yaml and mapping correctly from previous messages
      if (!bodyData.extractedData) {
         const jsonMsg = [...messages].reverse().find(m => m.data?.agentResult?.extractedData || m.extractedData);
         bodyData.extractedData = jsonMsg?.agentResult?.extractedData || jsonMsg?.extractedData;
      }
      if (step === 'agent1_step3' && !bodyData.bucketMapping) {
         const mapMsg = [...messages].reverse().find(m => m.data?.agentResult?.bucketMapping || m.data?.bucketMapping);
         bodyData.bucketMapping = JSON.stringify(mapMsg?.agentResult?.bucketMapping || mapMsg?.bucketMapping);
      }

      let prevTotalMarkers = msg.data?.agentResult?.estimatedTotalMarkers;
      if (prevTotalMarkers === undefined) {
         const oldMsg = [...messages].reverse().find(m => m.data?.agentResult?.estimatedTotalMarkers !== undefined);
         prevTotalMarkers = oldMsg?.agentResult?.estimatedTotalMarkers;
      }

      const displayPayload = { ...bodyData };
      setLastSentPayload(displayPayload);

      trackApiCall('gemini', `Medical Analyze - ${agentType}`);
      const currentReqId = generateQueryId();
      setActiveQueryId(currentReqId);

      const response = await fetch('/api/gemini/medical-analyze', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Session-ID': currentReqId
        },
        body: JSON.stringify(bodyData)
      });

      try {
        const logsRes = await fetch(`/api/gemini/debug-logs?sessionId=${currentReqId}`);
        if (logsRes.ok) {
           const logsData = await safeParseResponse(logsRes, null);
           if (logsData && logsData.logs && logsData.logs.length > 0) {
              saveAgentRequestLog({
                 id: currentReqId,
                 timestamp: new Date().toISOString(),
                                   summary: `[Medical Analyze] Processing Step: ${step}`,
                  logs: logsData.logs
               });
            }
         }
      } catch (e) {
        console.warn("Could not save agent request logs", e);
      }

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Server returned ${response.status}: ${errText}`);
      }

      const contentType = response.headers.get("content-type"); let resData: any = {}; if (contentType && contentType.includes("text/event-stream")) { const reader = response.body?.getReader(); if (!reader) throw new Error("No stream reader available"); const decoder = new TextDecoder(); let accumulatedText = ""; let accumulatedByStage: { scout: string, dietitian: string } = { scout: "", dietitian: "" }; while (true) { const { done, value } = await reader.read(); if (done) break; const chunkStr = decoder.decode(value, { stream: true }); const events = chunkStr.split("\n\n"); for (const ev of events) { if (ev.startsWith("data: ")) { try { const data = JSON.parse(ev.slice(6)); if (data.chunk) { accumulatedText += data.chunk; const stage: string = data.stage === 'scout' ? 'scout' : 'dietitian'; accumulatedByStage[stage as keyof typeof accumulatedByStage] += data.chunk; const scoutMatch = accumulatedByStage.scout.match(/"(?:scratchpad|_internalReasoning)"\s*:\s*"([^]*?)("|$)/); const dietMatch = accumulatedByStage.dietitian.match(/"(?:scratchpad|_internalReasoning)"\s*:\s*"([^]*?)("|$)/); setMessages(prev => { const newMsgs = [...prev]; const lastMsg = newMsgs[newMsgs.length - 1]; if (lastMsg && lastMsg.role === "assistant" && lastMsg.isLive) { const updatedData = lastMsg.data ? { ...lastMsg.data } : {}; const updatedAgentResult = updatedData.agentResult ? { ...updatedData.agentResult } : {}; let hasChanges = false; if (scoutMatch) { updatedAgentResult.scoutScratchpad = scoutMatch[1].replace(/\\n/g, "\n").replace(/\\\"/g, "\""); hasChanges = true; } if (dietMatch) { updatedAgentResult.dietitianScratchpad = dietMatch[1].replace(/\\n/g, "\n").replace(/\\\"/g, "\""); hasChanges = true; } if (hasChanges) { return [ ...newMsgs.slice(0, newMsgs.length - 1), { ...lastMsg, data: { ...updatedData, agentResult: updatedAgentResult } } ]; } } return prev; }); } else if (data.final) { resData = data.result; } } catch (e) {} } } } } else {
        const responseContentType = response.headers.get("content-type");
        if (responseContentType && responseContentType.includes("application/json")) {
          resData = await response.json();
        } else {
          const rawText = await response.text().catch(() => "");
          throw new Error(`Server returned a non-JSON response (${response.status}): ${rawText.substring(0, 150)}`);
        }
      }
      
      try {
        fetch(`/api/gemini/debug-logs?sessionId=${currentReqId}`).then(async (logsRes) => {
          if (logsRes.ok) { 
             const logsData = await safeParseResponse(logsRes, null);
             if (logsData && logsData.logs && logsData.logs.length > 0) {
                saveAgentRequestLog({ 
                   id: currentReqId, 
                   timestamp: new Date().toISOString(), 
                   summary: `[Medical Analyze] Processing Step: ${step}`, 
                   logs: logsData.logs 
                });
             } 
          }
        }).catch(e => console.warn("Could not save agent request logs", e));
      } catch (e) {}

      const assistantMsg: ChatMessage & { agentTypeStep?: string } = {
        id: `msg_agent1_${step}_${Date.now()}`,
        role: 'assistant',
        content: resData.text || 'Processing...',
        timestamp: new Date().toISOString(),
        agentType: 'agent1',
        agentResult:  {
           ...resData,
           extractedData: bodyData.extractedData,
           bucketMapping: resData.bucketMapping || (bodyData.bucketMapping ? JSON.parse(bodyData.bucketMapping) : undefined),
           estimatedTotalMarkers: prevTotalMarkers !== undefined ? prevTotalMarkers : resData.estimatedTotalMarkers
        },
        agentTypeStep: step
      };

      const migratedAssistantMsg = migrateMessages([assistantMsg])[0];
      setMessages(prev => [...prev, migratedAssistantMsg]);
    } catch (err: any) {
      console.error(err);
      setMessages(prev => [
        ...prev,
        {
          id: `msg_err_${Date.now()}`,
          role: 'assistant',
          content: `Error during processing step: ${err.message}`,
          timestamp: new Date().toISOString(),
          isError: true,
          errorStep: step,
          originalMsg: msg
        }
      ]);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleDuplicateFoodLog = (log: FoodLog) => {
    if (!onLogFood) return;
    const todayDate = getCurrentDateInTimezone(profile?.timezone);
    
    // Save image reference to the primary log to avoid duplicating raw Base64 data in the database
    let resolvedImageUrl = log.imageUrl;
    let resolvedImageUrls = log.imageUrls;

    if (log.imageUrl) {
      const primaryId = (typeof log.imageUrl === 'string' && log.imageUrl.startsWith('ref:')) ? log.imageUrl.replace('ref:', '') : log.id;
      resolvedImageUrl = `ref:${primaryId}`;
    }
    if (log.imageUrls && log.imageUrls.length > 0) {
      const firstImg = log.imageUrls[0];
      const primaryId = (typeof firstImg === 'string' && firstImg.startsWith('ref:')) ? firstImg.replace('ref:', '') : log.id;
      resolvedImageUrls = [`ref:${primaryId}`];
    }

    const duplicatedLog: FoodLog = {
      ...log,
      id: `food_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      date: todayDate,
      imageUrl: resolvedImageUrl,
      imageUrls: resolvedImageUrls
    };
    onLogFood(duplicatedLog);
    setInputText('');
    setMessages(prev => [
      ...prev,
      {
        id: `msg_dup_${Date.now()}`,
        role: 'assistant',
        content: `Successfully duplicated your previously logged **${log.name}** to today (${todayDate})!`,
        timestamp: new Date().toISOString()
      }
    ]);
  };

  if (!isOpen) return null;

  return (
      <div className={`fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex flex-col justify-end sm:justify-center animation-fade-in font-sans ${isFullscreen ? 'p-0' : 'p-0 sm:p-4'}`}>
        <div 
          id="food-chat-container"
          data-unified-modal="true"
          data-job-id={jobId || ''}
          className={`w-full mx-auto bg-theme-bg-card flex flex-col shadow-2xl overflow-hidden transition-all duration-300 ${
            isFullscreen 
              ? 'max-w-full w-full h-full sm:h-full rounded-none border-none' 
              : 'max-w-md h-[90vh] sm:h-[80vh] rounded-t-3xl sm:rounded-3xl border border-theme-border/80'
          }`}
        >
        
        {/* Modal Header */}
        <div className="bg-slate-50 dark:bg-slate-900/60 border-b border-theme-border/80 px-4 py-3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-indigo-600/10 flex items-center justify-center text-indigo-600">
              <Sparkles className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-theme-text font-display">
                {activeAgentKey === 'data_review' ? `${dataReviewBatchIdx === 'custom' ? 'Custom Test Batch' : 'Batch ' + (dataReviewBatchIdx !== null && dataReviewBatchIdx !== undefined ? (dataReviewBatchIdx as number) + 1 : 1)}` : (activeAgentConfig?.displayName || t.addMedical)}
              </h2>
              {(type === 'medical' || type === 'front_desk' || type === 'daily_recommendation') && onOpenAgentFromFrontDesk && (
                <select
                  value={selectBiomarkerAgentPack(agentType || (type === 'front_desk' ? 'front_desk' : type === 'daily_recommendation' ? 'health_baseline' : 'agent1'))?.agentType || 'agent1'}
                  onChange={(e) => {
                    const next = e.target.value as any;
                    if (next === 'front_desk') return;
                    onOpenAgentFromFrontDesk(next);
                  }}
                  className="mt-0.5 max-w-[11rem] text-[10px] font-bold bg-transparent text-indigo-600 dark:text-indigo-400 border-0 p-0 cursor-pointer"
                  title="Switch biomarker agent"
                >
                  {CANONICAL_SEVEN.filter((id) => id !== 'front_desk').map((id) => (
                    <option key={id} value={id === 'catalog_clean' ? 'catalog_clean' : id}>
                      {AGENT_REGISTRY[id as AgentType]?.displayName || id}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                onClick={() => setIsEngineSelectorOpen(!isEngineSelectorOpen)}
                className="flex items-center gap-1 text-[10px] font-mono text-indigo-600 dark:text-indigo-400 font-bold hover:text-indigo-700 transition-colors focus:outline-none cursor-pointer"
              >
                <span>{AVAILABLE_LLMS.find(m => m.id === selectedModelId)?.name || selectedModelId}</span>
                <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${isEngineSelectorOpen ? 'rotate-180 text-indigo-500' : 'text-slate-400'}`} />
              </button>
            </div>
          </div>
          
          <div className="flex items-center gap-1">

            <button
              onClick={() => setShowFullScreenDebugLogs(true)}
              className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-indigo-500 hover:text-indigo-600 dark:text-indigo-400 transition-colors"
              title="View Historical Logs"
            >
              <Terminal className="w-5 h-5" />
            </button>
            <button 
              id="close-food-chat-btn"
              onClick={onClose} 
              className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 dark:text-slate-500 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Expandable Model Selector Dropdown */}
        {isEngineSelectorOpen && (
          <div className="px-4 py-2.5 bg-indigo-50/50 dark:bg-indigo-950/25 border-b border-indigo-100 dark:border-indigo-950/40 animation-slide-down">
            <LLMSelector
              selectedModelId={selectedModelId}
              variant="inline"
              onChangeModelId={(id) => {
                onChangeModelId(id);
                setIsEngineSelectorOpen(false);
              }}
            />
          </div>
        )}

        {isAgent('medical') && (activeAgentKey === 'data_review' || activeAgentKey === 'agent1') && (
          <div className="px-4 py-2 bg-indigo-50/20 dark:bg-indigo-950/10 border-b border-theme-border/80 flex items-center justify-between text-xs shrink-0">
            <span className="text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider text-[10px]">Items per batch:</span>
            <div className="flex items-center gap-2 bg-slate-100/80 dark:bg-slate-950/40 px-2.5 py-1 rounded-lg border border-slate-200/60 dark:border-slate-800/30">
              <input 
                  type="number"
                  min="1"
                  max="200"
                  value={numberOfBatches}
                  onChange={(e) => setNumberOfBatches(Math.max(1, Number(e.target.value)))}
                  placeholder="Max items..."
                  className="w-16 bg-transparent font-bold text-slate-700 dark:text-slate-200 outline-none text-right font-mono"
              />
              <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500">items</span>
            </div>
          </div>
        )}



        {/* Chat Message Window */}
        <div ref={chatWindowRef} className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50 dark:bg-slate-900/20">
          
          {/* Batch Calibration Card for data_review inside Chat Message Window */}
          {activeAgentKey === 'data_review' && dataReviewSharedState && (() => {
            const sharedBatches = dataReviewSharedState.batches || [];
            if (sharedBatches.length === 0) return null;

            const allBatchEntries = [
              ...sharedBatches.map((keys: string[], idx: number) => ({ keys, idx: idx as string | number, isCustom: false })),
              ...(dataReviewSharedState.customDataReviewBatchKeys?.length > 0 ? [{ keys: dataReviewSharedState.customDataReviewBatchKeys, idx: "custom" as string | number, isCustom: true }] : [])
            ];

            const safeCurrentIdx = allBatchEntries.findIndex(e => String(e.idx) === String(dataReviewBatchIdx));
            const currentIdx = safeCurrentIdx !== -1 ? safeCurrentIdx : 0;
            const currentEntry = allBatchEntries[currentIdx];
            if (!currentEntry) return null;

            const bIdx = currentEntry.idx;
            const batchKeys = currentEntry.keys;
            const isCustom = currentEntry.isCustom;

            const isApproved = dataReviewSharedState.approvedBatches?.[bIdx];
            const isCalibrating = dataReviewSharedState.isAnalyzingBatch?.[bIdx];
            const result = dataReviewSharedState.batchAnalysisResults?.[bIdx];

            // Check for missing units
            const missingUnitBiomarkers = batchKeys.map((k: string) => {
              const customDef = profile?.customBiomarkers?.[k];
              const stdDef = biomarkerDefinitions.find(d => d.key === k);
              const isMissing = (!customDef && !stdDef) || (customDef && !customDef.unit) || (stdDef && !stdDef.unit);
              return {
                key: k,
                isMissing,
                name: customDef?.name || stdDef?.name || k,
                mappedKey: getMappedBiomarkerKey(k)
              };
            }).filter((bm: any) => bm.isMissing);

            const hasMissingUnits = missingUnitBiomarkers.length > 0;

            const totalItems = allBatchEntries.reduce((acc: number, entry: any) => acc + entry.keys.length, 0);
            let accumulatedBefore = 0;
            for (let i = 0; i < currentIdx; i++) {
              accumulatedBefore += allBatchEntries[i].keys.length;
            }
            const startItemNumber = accumulatedBefore + 1;
            const endItemNumber = accumulatedBefore + batchKeys.length;

            return (
              <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-md space-y-4 mb-4 font-sans text-left">
                <BatchNavigator
                  currentIndex={currentIdx}
                  totalBatches={allBatchEntries.length}
                  itemsInCurrentBatch={batchKeys.length}
                  totalItems={totalItems}
                  startItemNumber={startItemNumber}
                  endItemNumber={endItemNumber}
                  isCurrentApproved={!!isApproved}
                  canGoPrev={currentIdx > 0}
                  canGoNext={currentIdx < allBatchEntries.length - 1}
                  isLastBatch={currentIdx === allBatchEntries.length - 1}
                  onPrev={() => {
                    if (onDataReviewBatchChange) {
                      onDataReviewBatchChange(allBatchEntries[currentIdx - 1].idx);
                    }
                  }}
                  onNext={() => {
                    if (onDataReviewBatchChange) {
                      onDataReviewBatchChange(allBatchEntries[currentIdx + 1].idx);
                    }
                  }}
                  onApproveCurrent={async () => {
                    if (result && dataReviewSharedState.handleApproveBatchStep2) {
                      await dataReviewSharedState.handleApproveBatchStep2(bIdx, result);
                    }
                  }}
                >
                  <div className="space-y-4 pt-1">
                    <div className="flex items-center justify-between">
                      <h5 className="text-xs font-bold text-theme-text-secondary flex items-center gap-1.5">
                        <span>Calibration Batch {typeof bIdx === 'number' ? bIdx + 1 : 'Custom'}</span>
                        <span className="text-[10px] text-slate-400 font-medium">({batchKeys.length} biomarkers)</span>
                      </h5>
                      {isApproved && (
                        <span className="text-[10px] bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400 font-bold px-2 py-0.5 rounded flex items-center gap-1">
                          <Check className="w-3 h-3" />
                          Approved
                        </span>
                      )}
                    </div>

                    {/* Pre-calibration Batch List */}
                    {!result && (
                      <div className="space-y-3">
                        <div className="text-[11px] text-slate-500 leading-normal font-medium bg-slate-50 dark:bg-slate-900/30 p-2.5 rounded-xl border border-theme-border/50">
                          The following raw biomarker records are grouped in this calibration batch. Please ensure all units are defined before starting.
                        </div>

                        {/* Pre-calibration Table */}
                        <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden text-[11px]">
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-slate-500 font-bold">
                                <th className="p-2">Biomarker</th>
                                <th className="p-2 text-right">Unit Calibration Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                              {batchKeys.map((k: string) => {
                                const customDef = profile?.customBiomarkers?.[k];
                                const stdDef = biomarkerDefinitions.find(d => d.key === k);
                                const isMissing = (!customDef && !stdDef) || (customDef && !customDef.unit) || (stdDef && !stdDef.unit);
                                const mappedKey = getMappedBiomarkerKey(k);
                                const name = customDef?.name || stdDef?.name || k;

                                return (
                                  <tr key={k} className="hover:bg-slate-50/40 dark:hover:bg-slate-900/10">
                                    <td className="p-2">
                                      <span className="font-semibold block">{name}</span>
                                      <span className="text-[9px] text-slate-400 font-mono select-all">{k}</span>
                                    </td>
                                    <td className="p-2 text-right">
                                      {isMissing ? (
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            if (dataReviewSharedState.onOpenDictionary) {
                                              dataReviewSharedState.onOpenDictionary(mappedKey);
                                            }
                                          }}
                                          className="px-2 py-1 bg-amber-50 hover:bg-amber-100 text-amber-700 dark:bg-amber-950/20 dark:hover:bg-amber-900/30 dark:text-amber-450 font-bold rounded text-[10px] border border-amber-200/50 dark:border-amber-900/10 transition-colors inline-flex items-center gap-1 cursor-pointer"
                                        >
                                          <AlertTriangle className="w-3 h-3" />
                                          Missing Unit (Click to Define)
                                        </button>
                                      ) : (
                                        <span className="text-emerald-600 dark:text-emerald-400 font-bold inline-flex items-center gap-1 text-[10px]">
                                          <Check className="w-3 h-3" />
                                          Ready: {customDef?.unit || stdDef?.unit}
                                        </span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>

                        {hasMissingUnits ? (
                          <div className="p-3 bg-amber-50/50 dark:bg-amber-950/10 border border-amber-200/50 dark:border-amber-900/10 rounded-xl flex gap-2 text-amber-800 dark:text-amber-400">
                            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                            <div className="space-y-0.5 text-[11px] leading-normal font-medium">
                              <span className="font-bold">Calibration Locked</span>
                              <p className="opacity-90">Please define the units for all biomarkers above before calibrating with the clinical agent. Raw data cannot be standardized without units.</p>
                            </div>
                          </div>
                        ) : (
                          <div className="pt-2 flex justify-center">
                            <button
                              disabled={isCalibrating || isAnalyzing}
                              onClick={() => {
                                const prefill = `Calibrate Batch ${typeof bIdx === 'number' ? bIdx + 1 : bIdx}`;
                                handleSend(prefill);
                              }}
                              className={`py-2 px-5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer shadow-md shadow-indigo-600/15 transition-all ${(isCalibrating || isAnalyzing) ? 'opacity-50 cursor-not-allowed' : ''}`}
                            >
                              {(isCalibrating || isAnalyzing) ? (
                                <>
                                  <Loader className="w-3.5 h-3.5 animate-spin" />
                                  <span>Calibrating with Agent...</span>
                                </>
                              ) : (
                                <>
                                  <Sparkles className="w-3.5 h-3.5 animate-pulse" />
                                  <span>Calibrate with Agent</span>
                                </>
                              )}
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Calibrated / Result View */}
                    {result && (
                      <div className="space-y-3">
                        <div className="text-[11px] text-slate-600 dark:text-slate-400 leading-normal space-y-1 bg-indigo-50/30 dark:bg-indigo-950/10 p-2.5 rounded-xl border border-indigo-100/50 dark:border-indigo-900/10">
                          <span className="font-bold text-indigo-700 dark:text-indigo-400 block">Clinical Calibration Active</span>
                          <p className="opacity-90">{result.clinicalSummary || 'The clinical agent has verified referencing brackets, demographic cohorts, and unit scales for this batch.'}</p>
                        </div>
                      </div>
                    )}
                  </div>
                </BatchNavigator>
              </div>
            );
          })()}

          {/* Data used by agent inline block */}
          {(isAgent('food') || isAgent('food_idea') || isAgent('medical')) && (
            <div className="bg-slate-50 dark:bg-slate-900/55 rounded-xl px-4 py-2.5 mb-4 border border-theme-border/20">
              <button
                type="button"
                onClick={() => setShowDataUsed(!showDataUsed)}
                className="w-full flex items-center justify-between text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 font-bold cursor-pointer transition-colors"
              >
                <span className="flex items-center gap-1.5 text-sm font-semibold font-sans text-theme-text-secondary">
                  Data used by agent
                </span>
                <div className="flex items-center text-slate-400 dark:text-slate-500">
                  {showDataUsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </div>
              </button>
              
              {showDataUsed && (
                <div className="mt-2.5 pt-2.5 border-t border-slate-200/50 dark:border-slate-800/50 space-y-3.5 text-theme-text-secondary font-sans leading-normal">
                  <div className="flex gap-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        let targetAgent = 'agent1';
                        let targetPrompt = null;
                        if (isAgent('food')) {
                          targetAgent = 'food';
                          const lastMsgWithStep = [...messages].reverse().find(m => m.data?.agentResult?.agentPrompt);
                          targetPrompt = lastMsgWithStep?.agentResult?.agentPrompt || null;
                        }
                        else if (isAgent('food_idea')) {
                          targetAgent = 'food_idea';
                          const lastMsgWithStep = [...messages].reverse().find(m => m.data?.pendingFoodIdeas && m.data?.agentResult?.agentPrompt);
                          targetPrompt = lastMsgWithStep?.agentResult?.agentPrompt || null;
                        }
                        else {
                          const lastMsgWithStep = [...messages].reverse().find(m => m.agentTypeStep || m.agentType);
                          targetAgent = lastMsgWithStep?.agentType || agentType || 'agent1';
                          targetPrompt = lastMsgWithStep?.agentResult?.agentPrompt || null;
                        }
                        
                        setActiveInstructionAgentType(targetAgent);
                        setActiveInstructionPrompt(targetPrompt);
                      }}
                      className="flex-1 py-2 bg-indigo-50 dark:bg-indigo-900/20 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 border border-indigo-200 dark:border-indigo-800/30 text-indigo-700 dark:text-indigo-400 font-bold rounded-xl text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
                    >
                      <span>ℹ️ View Instructions</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowFullScreenConv(true)}
                      className="flex-1 py-2 bg-indigo-50 dark:bg-indigo-900/20 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 border border-indigo-200 dark:border-indigo-800/30 text-indigo-700 dark:text-indigo-400 font-bold rounded-xl text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm text-center"
                    >
                      <Terminal className="w-4 h-4 text-indigo-500" />
                      <span>📜 View Log History</span>
                    </button>
                  </div>
                  {/* Profile Stats */}
                  <div className="grid grid-cols-2 gap-2.5 font-size-xs bg-slate-100/50 dark:bg-slate-950/20 p-2 rounded-xl border border-slate-150 dark:border-slate-800/30">
                    <div>
                      <span className="text-slate-400 dark:text-slate-500 font-bold block font-size-xs uppercase tracking-wider mb-0.5">Demographics</span>
                      <span className="font-bold text-slate-700 dark:text-slate-200">{(profile?.age) || 'Unknown'} yo • {profile?.gender || 'Unknown'} • {profile?.ethnicity || 'Unknown'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 dark:text-slate-500 font-bold block font-size-xs uppercase tracking-wider mb-0.5">Body Metrics</span>
                      <span className="font-bold text-slate-700 dark:text-slate-200">{profile?.weight || 'Unknown'} kg • {profile?.height || 'Unknown'} cm (BMI: {profile?.weight && profile?.height ? (Number(profile.weight) / Math.pow(Number(profile.height) / 100, 2)).toFixed(1) : 'Unknown'})</span>
                    </div>
                  </div>

                  {(agentType === 'biomarker_review' || reviewBiomarkerKey) && (
                    <div className="bg-indigo-50/70 dark:bg-indigo-950/40 p-3 rounded-xl border border-indigo-200/60 dark:border-indigo-800/40 text-xs space-y-1.5 font-sans mt-2">
                      <div className="font-bold text-indigo-950 dark:text-indigo-200 flex items-center justify-between">
                        <span className="flex items-center gap-1.5 font-semibold">
                          <Sparkles className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                          Focus Biomarker Data Sent to AI
                        </span>
                        <span className="text-[10px] px-2 py-0.5 bg-indigo-200/80 dark:bg-indigo-800/80 text-indigo-900 dark:text-indigo-100 rounded-full font-mono font-bold">
                          {reviewBiomarkerKey || (dataReviewBatchKeys && dataReviewBatchKeys.length > 0 ? `${dataReviewBatchKeys.length} Biomarkers` : 'General')}
                        </span>
                      </div>
                      {reviewBiomarkerKey ? (() => {
                        const def = profile?.customBiomarkers?.[reviewBiomarkerKey] || biomarkerDefinitions.find(d => d.key === reviewBiomarkerKey);
                        const rawCur = (biomarkers?.[reviewBiomarkerKey] || null) as any;
                        const valStr = rawCur && typeof rawCur === 'object' && 'value' in rawCur ? String(rawCur.value) : (rawCur !== undefined && rawCur !== null ? String(rawCur) : '');
                        const unitStr = rawCur && typeof rawCur === 'object' && 'unit' in rawCur ? String(rawCur.unit || '') : (def?.unit || '');
                        const rangeStr = rawCur && typeof rawCur === 'object' && 'normalRange' in rawCur ? String(rawCur.normalRange || '') : (def?.normalRange || 'Standard reference range');
                        const histLogs = (biomarkerHistory || []).filter(h => h.biomarkers && h.biomarkers[reviewBiomarkerKey] !== undefined && h.biomarkers[reviewBiomarkerKey] !== '');
                        return (
                          <div className="text-slate-700 dark:text-slate-300 space-y-1 pt-1 border-t border-indigo-100 dark:border-indigo-900/50">
                            <div><span className="font-semibold text-slate-500 dark:text-slate-400">Name:</span> <span className="font-bold">{def?.name || reviewBiomarkerKey}</span></div>
                            <div><span className="font-semibold text-slate-500 dark:text-slate-400">Latest Logged:</span> <span className="font-bold">{valStr ? `${valStr} ${unitStr}` : 'No value logged yet'}</span></div>
                            <div><span className="font-semibold text-slate-500 dark:text-slate-400">Standard Range:</span> <span className="font-bold">{rangeStr}</span></div>
                            <div><span className="font-semibold text-slate-500 dark:text-slate-400">Historical Records:</span> <span className="font-bold text-indigo-600 dark:text-indigo-400">{histLogs.length} test records attached</span></div>
                          </div>
                        );
                      })() : dataReviewBatchKeys && dataReviewBatchKeys.length > 0 ? (
                        <div className="text-slate-700 dark:text-slate-300 space-y-1 pt-1 border-t border-indigo-100 dark:border-indigo-900/50">
                          <div><span className="font-semibold text-slate-500 dark:text-slate-400">Batch Review:</span> <span className="font-bold">{dataReviewBatchKeys.map(k => profile?.customBiomarkers?.[k]?.name || biomarkerDefinitions.find(d => d.key === k)?.name || k).join(', ')}</span></div>
                          <div><span className="font-semibold text-slate-500 dark:text-slate-400">Mode:</span> <span className="font-bold text-indigo-600 dark:text-indigo-400">Multi-Biomarker Simultaneous AI Review</span></div>
                        </div>
                      ) : null}
                    </div>
                  )}
                  
                  {isAgent('medical') && dataReviewBatchIdx !== null && (
                    <div className="mt-2.5">
                      <div className="bg-slate-100/50 dark:bg-slate-950/20 p-2 rounded-xl border border-slate-150 dark:border-slate-800/30 font-size-xs">
                        <span className="text-slate-400 dark:text-slate-500 font-bold block font-size-xs uppercase tracking-wider mb-0.5">Agent Batch Size</span>
                        <input 
                            type="number"
                            value={localBatchSize}
                            onChange={(e) => setLocalBatchSize(Number(e.target.value))}
                            placeholder="Number of items per batch..."
                            className="w-full bg-transparent font-bold text-slate-700 dark:text-slate-200 outline-none"
                        />
                      </div>
                    </div>
                  )}

                  {isAgent('food_idea') && (
                    <>
                      <div className="grid grid-cols-2 gap-2.5">
                        <div className="bg-slate-100/50 dark:bg-slate-950/20 p-2 rounded-xl border border-slate-150 dark:border-slate-800/30 font-size-xs">
                          <span className="text-slate-400 dark:text-slate-500 font-bold block font-size-xs uppercase tracking-wider mb-0.5">Max Budget</span>
                          <input 
                              type="number"
                              value={budget}
                              onChange={(e) => setBudget(e.target.value)}
                              placeholder="Enter budget..."
                              className="w-full bg-transparent font-bold text-slate-700 dark:text-slate-200 outline-none"
                          />
                        </div>
                        <div className="bg-slate-100/50 dark:bg-slate-950/20 p-2 rounded-xl border border-slate-150 dark:border-slate-800/30 font-size-xs">
                          <span className="text-slate-400 dark:text-slate-500 font-bold block font-size-xs uppercase tracking-wider mb-0.5">Currency</span>
                          <select
                              value={currency}
                              onChange={(e) => setCurrency(e.target.value)}
                              className="w-full bg-transparent font-bold text-slate-700 dark:text-slate-200 outline-none border-none p-0 cursor-pointer"
                          >
                            <option value="IDR" className="bg-slate-100 dark:bg-slate-900">IDR (Rp)</option>
                            <option value="GBP" className="bg-slate-100 dark:bg-slate-900">GBP (£)</option>
                            <option value="USD" className="bg-slate-100 dark:bg-slate-900">USD ($)</option>
                            <option value="EUR" className="bg-slate-100 dark:bg-slate-900">EUR (€)</option>
                            <option value="AUD" className="bg-slate-100 dark:bg-slate-900">AUD ($)</option>
                            <option value="SGD" className="bg-slate-100 dark:bg-slate-900">SGD ($)</option>
                          </select>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2.5">
                        <div className="bg-slate-100/50 dark:bg-slate-950/20 p-2 rounded-xl border border-slate-150 dark:border-slate-800/30 font-size-xs">
                          <span className="text-slate-400 dark:text-slate-500 font-bold block font-size-xs uppercase tracking-wider mb-0.5">Max Distance</span>
                          <select
                              value={maxDistance}
                              onChange={(e) => setMaxDistance(parseFloat(e.target.value) || 3)}
                              className="w-full bg-transparent font-bold text-slate-700 dark:text-slate-200 outline-none border-none p-0 cursor-pointer"
                          >
                            <option value="0.5" className="bg-slate-100 dark:bg-slate-900">0.5 km</option>
                            <option value="1" className="bg-slate-100 dark:bg-slate-900">1 km</option>
                            <option value="2" className="bg-slate-100 dark:bg-slate-900">2 km</option>
                            <option value="3" className="bg-slate-100 dark:bg-slate-900">3 km</option>
                            <option value="5" className="bg-slate-100 dark:bg-slate-900">5 km</option>
                            <option value="7" className="bg-slate-100 dark:bg-slate-900">7 km</option>
                            <option value="10" className="bg-slate-100 dark:bg-slate-900">10 km</option>
                          </select>
                        </div>
                        <div className="bg-slate-100/50 dark:bg-slate-950/20 p-2 rounded-xl border border-slate-150 dark:border-slate-800/30 font-size-xs">
                          <span className="text-slate-400 dark:text-slate-500 font-bold block font-size-xs uppercase tracking-wider mb-0.5">Location</span>
                          <span className="font-bold text-slate-700 dark:text-slate-200 truncate block mt-0.5">
                            {userLocation ? `📍 ${userLocation.lat.toFixed(4)}, ${userLocation.lng.toFixed(4)}` : '❌ Not available'}
                          </span>
                        </div>
                      </div>
                      
                      <div className="bg-slate-100/50 dark:bg-slate-950/20 p-2 rounded-xl border border-slate-150 dark:border-slate-800/30 font-size-xs">
                        <span className="text-slate-400 dark:text-slate-500 font-bold block font-size-xs uppercase tracking-wider mb-0.5">Last 20 Meals</span>
                        <span className="font-bold text-slate-700 dark:text-slate-200 max-h-20 overflow-y-auto block whitespace-pre-wrap">
                          {(activeFoodLogs || []).slice(-20).map(f => f.name).join(', ') || 'No meals logged yet'}
                        </span>
                      </div>
                    </>
                  )}

                  {agentType && (
                    <div className="space-y-2">
                      <div className="bg-slate-100/50 dark:bg-slate-950/20 p-2 rounded-xl border border-slate-150 dark:border-slate-800/30 font-size-xs">
                        <span className="text-slate-400 dark:text-slate-500 font-bold block font-size-xs uppercase tracking-wider mb-0.5">Biomarker History Logs</span>
                        <details className="group cursor-pointer">
                          <summary className="font-bold text-slate-700 dark:text-slate-200 select-none">
                            {activeHistory.length || 0} historic logs
                          </summary>
                          <div className="mt-2 text-[10px] font-mono text-slate-500 max-h-32 overflow-y-auto pl-2 border-l-2 border-theme-border">
                            {activeHistory.map((h, i) => (
                              <div key={i} className="mb-1">{h.date}: {Object.keys(h.biomarkers || {}).length} markers</div>
                            ))}
                          </div>
                        </details>
                      </div>
                      <div className="bg-slate-100/50 dark:bg-slate-950/20 p-2 rounded-xl border border-slate-150 dark:border-slate-800/30 font-size-xs">
                        <span className="text-slate-400 dark:text-slate-500 font-bold block font-size-xs uppercase tracking-wider mb-1.5">Checked Biomarker Values ({biomarkers ? Object.keys(biomarkers).length : 0})</span>
                        {biomarkers && Object.keys(biomarkers).length > 0 ? (
                          <div className="flex flex-wrap gap-1.5 mt-1 max-h-32 overflow-y-auto">
                            {Object.entries(biomarkers || {}).map(([key, value]) => {
                              const def = (profile?.customBiomarkers && profile.customBiomarkers[key]) || biomarkerDefinitions[key] || { name: key, unit: '' };
                              return (
                                <span key={key} className="px-2 py-1 bg-theme-bg-card border border-theme-border rounded text-[10px] font-mono text-theme-neutral">
                                  {def.name}: <strong className="text-indigo-600 dark:text-indigo-400">{value}</strong> <span className="text-slate-400">{def.unit}</span>
                                </span>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="text-slate-450 dark:text-slate-500 italic font-size-xs block mt-1">No biomarker data available.</span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Warning Biomarkers */}
                  {(isAgent('food') || isAgent('food_idea')) && (
                    <div>
                      <span className="text-slate-400 dark:text-slate-500 font-bold block font-size-xs uppercase tracking-wider mb-1.5">Important Biomarkers Needing Improvement</span>
                      {outOfRangeBiomarkers.length > 0 ? (
                        <div className="space-y-1">
                          {outOfRangeBiomarkers.map(b => (
                            <div key={b.key} className="flex items-center justify-between font-size-xs font-mono bg-rose-50/50 dark:bg-rose-950/10 border border-rose-100 dark:border-rose-950/30 px-2 py-1 rounded-lg">
                              <span className="font-sans font-bold text-theme-neutral">{b.name}</span>
                              <span className="text-rose-600 dark:text-rose-450 font-black">
                                {b.value} {b.unit} ({getBiomarkerStatusLabel(b.key, b.status, profile?.customBiomarkers?.[b.key], b.value, profile).toUpperCase()})
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-450 dark:text-slate-500 italic font-size-xs">All active biomarkers are within normal reference ranges.</span>
                      )}
                    </div>
                  )}

                  {/* Remaining Daily Allowances */}
                  {(isAgent('food') || isAgent('food_idea')) && (
                    <div>
                      <span className="text-slate-400 dark:text-slate-500 font-bold block font-size-xs uppercase tracking-wider mb-2">Nutrient Targets & 7-Day Rolling Status</span>
                      <div className="grid grid-cols-3 gap-2">
                        {/* Calories Card */}
                        <div className="text-center bg-slate-100/60 dark:bg-slate-950/30 border border-slate-150 dark:border-slate-800/40 p-2.5 rounded-xl flex flex-col justify-between">
                          <div>
                            <span className="text-slate-400 font-size-xs block uppercase font-bold tracking-wider mb-1">Calories</span>
                            <span className="font-mono text-sm font-bold text-slate-800 dark:text-slate-200 block">
                              {remainingAllowance.calories} <span className="text-[10px] text-slate-400 font-normal">kcal left</span>
                            </span>
                          </div>
                          <div className="mt-2 pt-1.5 border-t border-slate-200/50 dark:border-slate-800/50 text-[10px] space-y-0.5 text-slate-500 dark:text-slate-400">
                            <div>Today: <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">{remainingAllowance.caloriesLogged || 0}/{remainingAllowance.caloriesTarget}</span></div>
                            <div>7d Avg: <span className="font-mono font-semibold text-indigo-600 dark:text-indigo-400">{Math.round(remainingAllowance.averages?.calories || 0)}</span></div>
                          </div>
                        </div>

                        {/* Sat. Fat Card */}
                        <div className="text-center bg-slate-100/60 dark:bg-slate-950/30 border border-slate-150 dark:border-slate-800/40 p-2.5 rounded-xl flex flex-col justify-between">
                          <div>
                            <span className="text-slate-400 font-size-xs block uppercase font-bold tracking-wider mb-1">Sat. Fat</span>
                            <span className={`font-mono text-sm font-bold block ${remainingAllowance.saturatedFat === 0 ? 'text-rose-500' : 'text-slate-800 dark:text-slate-200'}`}>
                              {remainingAllowance.saturatedFat.toFixed(1)} <span className="text-[10px] text-slate-400 font-normal font-sans">g left</span>
                            </span>
                          </div>
                          <div className="mt-2 pt-1.5 border-t border-slate-200/50 dark:border-slate-800/50 text-[10px] space-y-0.5 text-slate-500 dark:text-slate-400">
                            <div>Today: <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">{(remainingAllowance.saturatedFatLogged || 0).toFixed(1)}/{remainingAllowance.saturatedFatTarget}</span></div>
                            <div>7d Avg: <span className="font-mono font-semibold text-indigo-600 dark:text-indigo-400">{(remainingAllowance.averages?.saturatedFat || 0).toFixed(1)}</span></div>
                          </div>
                        </div>

                        {/* Sodium Card */}
                        <div className="text-center bg-slate-100/60 dark:bg-slate-950/30 border border-slate-150 dark:border-slate-800/40 p-2.5 rounded-xl flex flex-col justify-between">
                          <div>
                            <span className="text-slate-400 font-size-xs block uppercase font-bold tracking-wider mb-1">Sodium</span>
                            <span className={`font-mono text-sm font-bold block ${remainingAllowance.sodium === 0 ? 'text-rose-500' : 'text-slate-800 dark:text-slate-200'}`}>
                              {remainingAllowance.sodium} <span className="text-[10px] text-slate-400 font-normal">mg left</span>
                            </span>
                          </div>
                          <div className="mt-2 pt-1.5 border-t border-slate-200/50 dark:border-slate-800/50 text-[10px] space-y-0.5 text-slate-500 dark:text-slate-400">
                            <div>Today: <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">{remainingAllowance.sodiumLogged || 0}/{remainingAllowance.sodiumTarget}</span></div>
                            <div>7d Avg: <span className="font-mono font-semibold text-indigo-600 dark:text-indigo-400">{Math.round(remainingAllowance.averages?.sodium || 0)}</span></div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Conversation Log History */}
                  <div className="border border-theme-border rounded-xl bg-slate-100/50 dark:bg-slate-950/20 p-3 mt-3 space-y-2 text-left">
                    <div className="flex items-center justify-between">
                      <span className="text-indigo-650 dark:text-indigo-400 font-bold block text-[10px] uppercase tracking-wider">
                        📡 Real-Time Full Agent Request Payload & Log
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          let logTxt = lastSentPayload ? JSON.stringify(lastSentPayload, null, 2) : messages.map(m => `[${m.role.toUpperCase()}]\n${m.content}`).join('\n\n---\n\n');
                          if (isAgent('medical')) {
                            logTxt = `=== PAYLOAD ===\n` + logTxt;
                          }
                          navigator.clipboard.writeText(logTxt);
                        }}
                        className="px-2 py-0.5 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 rounded text-[10px] font-bold text-theme-text-secondary transition-colors cursor-pointer"
                      >
                        Copy Log
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowFullScreenConv(true)}
                      className="w-full py-2 bg-indigo-600/10 hover:bg-indigo-600/20 border border-indigo-500/20 text-indigo-600 dark:text-indigo-400 font-bold rounded-xl text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm animate-fade-in mb-2"
                    >
                      <span>🔍 View Log</span>
                    </button>

                    {showFullScreenConv && (
                      <Suspense fallback={null}>
                        <FullScreenLogViewer
                          isOpen={showFullScreenConv}
                          onClose={() => setShowFullScreenConv(false)}
                          title="Full Agent Request Payload & Log"
                          logsText={(() => {
                            const msgLog = messages.map(m => `[${m.role.toUpperCase()}]\n${m.content}`).join('\n\n---\n\n');
                            let logTxt = lastSentPayload ? `=== PAYLOAD ===\n${JSON.stringify(lastSentPayload, null, 2)}\n\n=== CONVERSATION ===\n${msgLog}` : msgLog;
                            if (isAgent('medical')) {
                              logTxt += `\n\n[Medical Profile]\n${JSON.stringify(profile, null, 2)}`;
                            }
                            return logTxt;
                          })()}
                          logsArray={(() => {
                            const arr = messages.map(m => `[${m.role.toUpperCase()}]\n${m.content}`);
                            if (lastSentPayload) {
                              arr.unshift(`=== PAYLOAD ===\n${JSON.stringify(lastSentPayload, null, 2)}`);
                            }
                            if (isAgent('medical')) {
                              arr.push(`[Medical Profile]\n${JSON.stringify(profile, null, 2)}`);
                            }
                            return arr;
                          })()}
                          onSendToAdmin={handleSendLogToAdmin}
                          isSendingLogs={isSendingLogs}
                          logsSendStatus={logsSendStatus}
                          onClearLogs={() => {
                            setMessages(prev => prev.length > 0 ? [prev[0]] : []);
                            setLastSentPayload(null);
                            sessionStorage.removeItem(payloadStorageKey);
                            sessionStorage.removeItem(chatStorageKey);
                            setShowFullScreenConv(false);
                          }}
                          eventsCount={messages.length}
                        />
                      </Suspense>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {(() => {
            const revIdx = [...messages].reverse().findIndex(m => m.id?.startsWith('welcome_'));
            const lastWelcomeIndex = revIdx >= 0 ? messages.length - 1 - revIdx : -1;
            const sessionStartIdx = lastWelcomeIndex >= 0 ? lastWelcomeIndex : 0;
            const pastCount = sessionStartIdx;
            const hasPastMessages = pastCount > 0;

            return (
              <>
                {(hasPastMessages || messages.length > 1) && (
                  <div className="flex justify-center items-center gap-2 mb-4 mt-2">
                    {hasPastMessages && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setShowPastDiscussion(!showPastDiscussion)}
                          className="px-4 py-1.5 text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 hover:underline flex items-center gap-1.5 cursor-pointer bg-slate-100/50 dark:bg-slate-950/20 rounded-xl border border-slate-200/50 dark:border-slate-800/40"
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                          <span>
                            {showPastDiscussion ? "Hide past discussion" : `View past discussion (${pastCount})`}
                          </span>
                        </button>
                        {showPastDiscussion && (
                          <button 
                            type="button"
                            onClick={() => {
                              setMessages(messages.slice(sessionStartIdx));
                              setShowPastDiscussion(false);
                            }}
                            className="p-1.5 rounded-xl bg-slate-100/50 dark:bg-slate-950/20 border border-slate-200/50 dark:border-slate-800/40 hover:bg-rose-100 dark:hover:bg-rose-900/30 text-rose-500 hover:text-rose-600 transition-colors"
                            title="Clear past discussion history"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {messages.map((msg, idx) => {
                  const isPast = idx < sessionStartIdx;
                  if (isPast && !showPastDiscussion) return null;

                  const isLastFoodMsg = lastFoodMsg && msg.id === lastFoodMsg.id;
                  const isAss = msg.role === 'assistant';
                  if (isAss) {

                  return (
                <div
                  key={msg.id ? `${msg.id}_${idx}` : idx}
                  id={isLastFoodMsg ? "last-food-message" : undefined}
                  className="w-full space-y-2.5 px-1 min-w-0 relative group"
                >
                  {!msg.id?.startsWith('welcome_') && (
                    <div className="absolute right-2 top-0 flex items-center gap-1 sm:opacity-0 sm:group-hover:opacity-100 opacity-100 z-20">
                      {msg.role === 'assistant' && (
                        <button
                          type="button"
                          onClick={() => setFlagMsg(msg)}
                          className="p-1 text-slate-300 hover:text-amber-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                          title="Flag issue with this response"
                        >
                          <Flag className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDeleteMessagePair(msg.id)}
                        className="p-1 text-slate-300 hover:text-rose-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                        title="Delete conversation step"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  {/* No switcher */}
                  <div className="w-full leading-relaxed font-size-body text-slate-850 dark:text-slate-100 font-medium break-words overflow-x-hidden bg-transparent border-none shadow-none">
                    <div className="animation-fade-in">
                      {msg.role === 'user' && (
                        msg.imageUrls && msg.imageUrls.length > 0 ? (
                          <div className="mb-2 overflow-hidden border border-theme-border/30 w-full rounded-2xl max-h-96">
                            <ImageSlider images={msg.imageUrls} altText="Attached meal pictures" />
                          </div>
                        ) : msg.imageUrl ? (
                          <div className="mb-2 overflow-hidden border border-theme-border/30 max-h-96 w-full rounded-2xl">
                            <img src={(msg.imageUrls && msg.imageUrls.length > 0 && msg.imageUrls[0]) ? msg.imageUrls[0] : msg.imageUrl} alt="Attached meal" loading="lazy" decoding="async" className="object-contain max-h-96 w-full rounded-2xl" />
                          </div>
                        ) : null
                      )}
                      
                      {(() => {
                        const isFoodMsg = msg.agentType === 'food' || msg.agentType === 'food_log' || msg.agentType === 'food_analyze' || msg.agentType === 'food_compare' || msg.agentType === 'front_desk' || msg.agentType === 'new_log' || msg.agentType === 'modify' || msg.agentType === 'review' || !!(msg.pendingFoodLog || msg.data?.pendingFoodLog || msg.data?.scoutItems?.length || msg.data?.portionClarify || msg.data?.needsPortionClarify);
                        if (isFoodMsg || msg.agentType === 'biomarker_review' || msg.modificationCommand?.length || msg.data?.agentResult?.modificationCommand?.length) return null;
                        const formatted = formatMessageContent(msg.content, msg);
                        if (!formatted || !formatted.trim()) return null;
                        return <p className="whitespace-pre-line break-words">{formatted}</p>;
                      })()}

                      {(() => {
                        if (msg.id?.startsWith('welcome_')) return null;
                        const isLatestAssistant = !messages.slice(idx + 1).some(m => m.role === 'assistant');
                        const targetJobId =
                          msg.data?.jobId ||
                          (msg.id?.startsWith('msg_assistant_job_') ? msg.id.replace('msg_assistant_job_', 'job_') : '') ||
                          (msg.id?.startsWith('msg_assistant_') && !msg.id.includes('fail') && !msg.id.includes('clarify') && !/^\d+$/.test(msg.id.replace('msg_assistant_', '')) ? msg.id.replace('msg_assistant_', '') : '') ||
                          (msg.pendingFoodLog?.jobId || msg.data?.pendingFoodLog?.jobId) ||
                          jobId;
                        const debugUrl = msg.data?.debugUrl || (targetJobId ? JobStore.getJob(targetJobId)?.result?.debugUrl : undefined) || (jobId ? JobStore.getJob(jobId)?.result?.debugUrl : undefined);
                        const isErrorMsg = msg.isError || msg.agentUnavailable || /Failed to process your request|Analysis failed|Vision Scout Failed|Gemini unavailable|rate limit|quota exceeded|quota \(\d+\)|503|429|Service Unavailable|Error:/i.test(msg.content || '');

                        if ((!debugUrl && !targetJobId && !isErrorMsg) || (!isLatestAssistant && isErrorMsg)) return null;
                        return (
                          <div className="mt-2 pt-2 border-t border-slate-200/60 dark:border-slate-800 flex flex-wrap items-center gap-2">
                            {isErrorMsg && (
                              <button
                                type="button"
                                onClick={() => {
                                  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user' && m.id < msg.id) || [...messages].reverse().find(m => m.role === 'user');
                                  setMessages(prev => prev.filter(m => !m.isError && !m.agentUnavailable && !/Failed to process your request|Analysis failed|Vision Scout Failed|Gemini unavailable|rate limit|quota exceeded|quota \(\d+\)|503|429|Service Unavailable/i.test(m.content || '')));
                                  if (targetJobId) {
                                    const existingJob = JobStore.getJob(targetJobId);
                                    JobStore.updateJob(targetJobId, {
                                      status: 'queued',
                                      error: undefined,
                                      retryNotBefore: undefined,
                                      clientSubmitPending: false,
                                      statusMessage: `Retrying with ${AVAILABLE_LLMS.find(m => m.id === selectedModelId)?.name || selectedModelId}...`,
                                      inputSnapshot: {
                                        ...(existingJob?.inputSnapshot || { text: '', imageRefs: [] }),
                                        modelId: selectedModelId,
                                        engine: selectedModelId
                                      }
                                    });
                                    JobQueueRunner.wake();
                                  }
                                  if (lastUserMsg) {
                                    handleSend({
                                      text: lastUserMsg.content,
                                      imageUrls: lastUserMsg.imageUrls || (lastUserMsg.imageUrl ? [lastUserMsg.imageUrl] : []),
                                      overrideMode: msg.data?.userSelectedMode || lastUserMsg?.data?.userSelectedMode || userSelectedMode
                                    });
                                  }
                                }}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-all cursor-pointer"
                                title={`Retry analysis with ${AVAILABLE_LLMS.find(m => m.id === selectedModelId)?.name || selectedModelId}`}
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                                <span>Retry ({AVAILABLE_LLMS.find(m => m.id === selectedModelId)?.name || selectedModelId})</span>
                              </button>
                            )}
                            {isErrorMsg && (
                              <button
                                type="button"
                                onClick={() => setIsEngineSelectorOpen(prev => !prev)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:hover:bg-indigo-900/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200/60 dark:border-indigo-800/40 transition-all cursor-pointer"
                                title="Change model / agent to retry"
                              >
                                <Sparkles className="w-3.5 h-3.5" />
                                <span>Switch Agent</span>
                                <ChevronDown className="w-3 h-3" />
                              </button>
                            )}
                            {(debugUrl || targetJobId) && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (targetJobId) {
                                    handleDownloadDebug(targetJobId, msg);
                                  }
                                }}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-all cursor-pointer"
                                title="Download complete raw debug logs from Cloudflare R2"
                              >
                                <Download className="w-3.5 h-3.5 text-indigo-500" />
                                <span>Download Debug Logs</span>
                              </button>
                            )}
                          </div>
                        );
                      })()}

                    </div>
                  </div>

                    {msg.agentUnavailable && msg.data?.scoutItems && msg.data.scoutItems.length > 0 && (
                      <div className="mt-3 mb-2">
                        <NutritionLabelTable activeScoutItems={msg.data.scoutItems} isSaved={loggedMessageIds.includes(msg.id)} />
                      </div>
                    )}


                  {/* Render extracted Pending Food Log info */}
                  {(() => {
                    const hasReviewFixes = !!(
                      (Array.isArray(msg.modificationCommand) && msg.modificationCommand.length) ||
                      (Array.isArray(msg.data?.agentResult?.modificationCommand) && msg.data.agentResult.modificationCommand.length) ||
                      msg.data?.agentResult?.proposal
                    );
                    const hasFoodContent = !!(msg.pendingFoodLog || msg.data?.pendingFoodLog || msg.data?.scoutItems?.length || msg.data?.agentResult?.mealBuild || msg.data?.agentResult?.clean_result || msg.agentResult?.scoutItems?.length);
                    const rawRenderer = msg.id?.startsWith('welcome_')
                      ? 'welcome'
                      : (hasReviewFixes ? 'biomarker_review' : ((msg.agentType === 'agent1_step1' || String(msg.agentType).startsWith('agent1_step') || msg.agentType === 'medical_extract' || msg.agentType === 'medical') ? 'agent1' : msg.agentType));
                    const rendererType = (rawRenderer && agentCardRegistry[rawRenderer])
                      ? rawRenderer
                      : (hasFoodContent ? 'food' : rawRenderer);
                    const Renderer = rendererType ? (agentCardRegistry[rendererType] || (hasFoodContent ? agentCardRegistry['food'] : null)) : null;
                    if (!Renderer) return null;
                    return (
                      <>
                        <div ref={msg.isLive ? liveThoughtRef : undefined}>

                          <AgentThoughtBox
                            globalLiveLogs={(msg.agentType === 'agent1' || msg.agentType === 'medical_extract') ? undefined : (msg.isLive ? (globalLiveLogs || liveThoughts.globalLiveLogs || liveThoughts.backendLogs || (jobId ? JobStore.getJob(jobId)?.liveThoughts?.globalLiveLogs || JobStore.getJob(jobId)?.liveThoughts?.backendLogs : undefined)) : (msg.data?.agentResult?.globalLiveLogs || msg.data?.agentResult?.backendLogs || (jobId ? JobStore.getJob(jobId)?.liveThoughts?.globalLiveLogs || JobStore.getJob(jobId)?.liveThoughts?.backendLogs || JobStore.getJob(jobId)?.result?.backendLogs : undefined)))}
                            scoutScratchpad={msg.isLive ? (liveThoughts.scout || msg.data?.agentResult?.scoutScratchpad) : msg.data?.agentResult?.scoutScratchpad}
                            dietitianScratchpad={msg.isLive ? (liveThoughts.dietitian || msg.data?.agentResult?.dietitianScratchpad) : msg.data?.agentResult?.dietitianScratchpad}
                            isLive={msg.isLive}
                            placeholderStep={undefined}
                            hasImage={msg.data?.hasImage}
                            language={profile?.language || "en"}
                            scoutInstruction={msg.data?.agentResult?.scoutInstruction}
                            scoutAnswer={msg.data?.agentResult?.scoutAnswer}
                            dbSearchLog={msg.isLive ? (liveThoughts.dbSearchLog || msg.data?.agentResult?.dbSearchLog) : msg.data?.agentResult?.dbSearchLog}
                            backendLogs={msg.isLive ? (liveThoughts.backendLogs || msg.data?.agentResult?.backendLogs) : msg.data?.agentResult?.backendLogs}
                            dietitianInstruction={msg.data?.agentResult?.dietitianInstruction}
                            dietitianAnswer={msg.data?.agentResult?.dietitianAnswer}
                            activeStage={msg.isLive ? (liveThoughts.activeStage || msg.data?.agentResult?.activeStage) : msg.data?.agentResult?.activeStage}
                            stageStatus={msg.data?.agentResult?.stageStatus}
                            warnings={msg.data?.agentResult?.warnings || (msg.data as any)?.warnings}
                          />
                        <Renderer
                          msg={msg}
                          globalLiveLogs={msg.isLive ? (globalLiveLogs || liveThoughts.globalLiveLogs || liveThoughts.backendLogs) : (msg.data?.agentResult?.globalLiveLogs || msg.data?.agentResult?.backendLogs || (jobId ? JobStore.getJob(jobId)?.liveThoughts?.globalLiveLogs || JobStore.getJob(jobId)?.liveThoughts?.backendLogs || JobStore.getJob(jobId)?.result?.backendLogs : undefined))}
                          idx={idx}
                          messages={messages}
                          report={report}
                          foodLogs={activeFoodLogs}
                          language={profile?.language || "en"}
                          t={t}
                          formatNutrientValue={formatNutrientValue}
                          onLogFood={onLogFood}
                          onLogFoodIdeas={onLogFoodIdeas}
                          setLoggedMessageIds={setLoggedMessageIds}
                          loggedMessageIds={loggedMessageIds}
                          profile={profile}
                          biomarkerHistory={activeHistory}
                          isSelectingMode={isSelectingMode && selectingMsgId === msg.id}
                          setIsSelectingMode={setIsSelectingMode}
                          onEnterSelectingMode={() => setSelectingMsgId(msg.id)}
                          selectedItemKeys={selectedItemKeys}
                          setSelectedItemKeys={setSelectedItemKeys}
                          actionRef={foodCardActionRef}
                          handleAgent1Step={handleAgent1Step}
                          handleContinueExtractionChunk={handleContinueExtractionChunk}
                          onAgentFinish={async (agentType, agentResult, extraActions) => {
                            // B3 FIX: Signal loading while onAgentFinish is executing
                            setIsAnalyzing(true);
                            try {
                              if (onAgentFinish) {
                                await onAgentFinish(agentType, agentResult, extraActions);
                              }
                            } finally {
                              setIsAnalyzing(false);
                            }
                          }}
                          handleSend={handleSend}
                          setActiveInstructionAgentType={setActiveInstructionAgentType}
                          setActiveInstructionPrompt={setActiveInstructionPrompt}
                          setInputText={setInputText}
                          fileInputRef={fileInputRef}
                          onDeleteMessage={(id) => setMessages(prev => prev.filter(m => m.id !== id))}
                          onLogMedical={onLogMedical}
                          isAnalyzing={isAnalyzing}
                          agentType={agentType}
                          autoSendMessage={autoSendMessage}
                          type={type}
                        />
                        {msg.data?.portionClarify && (
                          <PortionClarifyCard
                            portionClarify={msg.data.portionClarify}
                            onConfirm={(choices: any) => {
                              if (typeof handleSend === 'function') {
                                // Pass the scout item(s) straight from this message with full fallback,
                                // ensuring portion-confirm resume never loses OCR label truth.
                                const activeMeal = [...messages].reverse().find(m => m.data?.pendingFoodLog)?.data?.pendingFoodLog || [...messages].reverse().find(m => m.pendingFoodLog)?.pendingFoodLog;
                                const clarifyScoutItems = (Array.isArray(msg.data?.scoutItems) && msg.data.scoutItems.length > 0)
                                  ? msg.data.scoutItems
                                  : (Array.isArray(msg.data?.portionClarify?.scoutItems) && msg.data.portionClarify.scoutItems.length > 0 ? msg.data.portionClarify.scoutItems
                                  : (Array.isArray(msg.data?.agentResult?.scoutItems) && msg.data.agentResult.scoutItems.length > 0 ? msg.data.agentResult.scoutItems
                                  : (Array.isArray(msg.data?.portionClarify?.items) && msg.data.portionClarify.items.length > 0 ? msg.data.portionClarify.items
                                  : (Array.isArray(activeMeal?.scoutItems) && activeMeal.scoutItems.length > 0 ? activeMeal.scoutItems : []))));
                                // Task 8: Carry pre-resolved DB candidates and prior logs URL from the
                                // awaiting_user job so turn-2 skips the DB re-scan and shows full logs.
                                const currentJob = jobId ? JobStore.getJob(jobId) : undefined;
                                const resolvedDbCandidates =
                                  msg.data?.resolvedDbCandidates ||
                                  currentJob?.result?.resolvedDbCandidates ||
                                  currentJob?.result?.clean_result?.resolvedDbCandidates ||
                                  [];
                                const priorLogsUrl =
                                  msg.data?.agentResult?.backendLogsUrl ||
                                  currentJob?.result?.backendLogsUrl ||
                                  currentJob?.result?.clean_result?.backendLogsUrl ||
                                  '';
                                recordBreadcrumb('confirm_portions', 'portion_clarify_card', { choices, inPlaceMsgId: msg.id });
                                handleSend(JSON.stringify(choices), [], {
                                  portionChoices: choices,
                                  skipScout: true,
                                  scoutItems: clarifyScoutItems,
                                  activeScoutItems: clarifyScoutItems,
                                  resolvedDbCandidates,
                                  priorLogsUrl,
                                  photoUrl: currentJob?.photoUrl || currentJob?.result?.photoUrl || msg.data?.photoUrl,
                                  requestId: currentJob?.requestId || activeReqId,
                                  inPlaceMsgId: msg.id,  // update this message slot in-place
                                });
                              }
                            }}
                          />
                        )}
                        <div className="hidden scale-hint">{msg.data?.agentResult?.scoutItems && msg.data.agentResult.scoutItems.map(si => si.estimatedWeightGrams).join(',')}</div>
                        </div>
                      </>
                    );
                  })()}
                </div>
              );
            }
            else {
              if (msg.content === 'Surprise me') return null;
              return (
                <div
                  key={msg.id ? `${msg.id}_${idx}` : idx}
                  className="flex gap-3 max-w-[85%] w-full min-w-0 ml-auto flex-row-reverse"
                >
                  <div className="space-y-2 flex-1 min-w-0 max-w-full">
                    <div className="relative group rounded-2xl px-3.5 py-2.5 leading-relaxed font-size-body shadow-sm font-medium break-words overflow-x-hidden bg-indigo-600 text-white">
                      <button
                        type="button"
                        onClick={() => handleDeleteMessagePair(msg.id)}
                        className="absolute right-2 top-2 p-1 text-indigo-200 hover:text-white hover:bg-white/10 rounded-lg transition-colors z-20 cursor-pointer opacity-0 group-hover:opacity-100"
                        title="Delete conversation step"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                      {msg.imageUrls && msg.imageUrls.length > 0 ? (
                        <div className="mb-2 overflow-hidden border border-theme-border/30 w-full rounded-2xl max-h-96">
                          <ImageSlider images={msg.imageUrls} altText="Attached meal pictures" />
                        </div>
                      ) : msg.imageUrl ? (
                        <div className="mb-2 overflow-hidden border border-white/10 max-h-96 w-full rounded-2xl">
                          <img src={(msg.imageUrls && msg.imageUrls.length > 0 && msg.imageUrls[0]) ? msg.imageUrls[0] : msg.imageUrl} alt="Attached meal" loading="lazy" decoding="async" className="object-contain max-h-96 w-full rounded-2xl" />
                        </div>
                      ) : null}
                      {String(msg.content).includes('Here is the suggestion:\n\n') ? (
                        <div className="whitespace-pre-line break-words text-sm">
                          {String(msg.content).split('Here is the suggestion:\n\n')[0]}
                          Here is the suggestion:
                          <div className="mt-2 mb-2 p-2 bg-indigo-700/30 rounded border border-indigo-400/30 font-mono text-xs overflow-hidden h-10 relative cursor-pointer"
                               onClick={() => {
                                  const jsonStr = String(msg.content).split('Here is the suggestion:\n\n')[1].split('\n\nCould you please')[0];
                                  setFullScreenJson(jsonStr);
                               }}
                          >
                            <span className="text-indigo-200 hover:text-white underline">(previous review)</span>
                          </div>
                          {String(msg.content).split('\n\nCould you please')[1] ? 'Could you please' + String(msg.content).split('\n\nCould you please')[1] : ''}
                        </div>
                      ) : (() => {
                        const formatted = formatMessageContent(msg.content, msg);
                        if (!formatted || !formatted.trim()) return null;
                        return <p className="whitespace-pre-line break-words">{formatted}</p>;
                      })()}
                    </div>
                  </div>
                </div>
              );
            }
          })}
        </>
      );
    })()}
        <div ref={messagesEndRef} />
        {/* Reserve room so the live thought box (attached to the streaming message
            above) can be scrolled to the top of the viewport instead of being
            pushed off-screen while the answer is still growing. */}
        <div aria-hidden="true" className="min-h-[45vh]" />
      </div>

        {/* Input Dock */}
        <div className="bg-theme-bg-card border-t border-theme-border/80 p-3 flex flex-col gap-2 shrink-0 relative">
          {matchingPreviousLogs.length > 0 && (
            <div className="absolute bottom-full left-0 right-0 mb-2 mx-3 bg-white dark:bg-slate-800 border border-theme-border/80 rounded-2xl shadow-2xl overflow-hidden max-h-48 overflow-y-auto z-50 animate-fade-in font-sans">
              <div className="px-3 py-1.5 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-700/50 flex justify-between items-center">
                <span className="text-[11px] font-bold text-theme-text-secondary">Previous Matches</span>
                <span className="text-[9px] text-slate-400">Click Add to duplicate</span>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
                {matchingPreviousLogs.map((log) => (
                  <div key={log.id} className="p-2.5 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors">
                    <div className="flex items-center gap-2.5 min-w-0">
                      {log.imageUrl || (log.imageUrls && log.imageUrls.length > 0) ? (
                        <img 
                          src={resolveFoodImage(log.imageUrl || log.imageUrls?.[0], activeFoodLogs)} 
                          alt={log.name} 
                          className="w-8 h-8 rounded-lg object-cover border border-slate-100 dark:border-slate-700 shrink-0"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 flex items-center justify-center text-indigo-500 font-bold text-xs shrink-0">
                          {log.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">{log.name}</div>
                        <div className="text-[10px] text-theme-text-secondary truncate">{log.composition || log.quantity}</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDuplicateFoodLog(log)}
                      className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:hover:bg-indigo-900/60 text-indigo-600 dark:text-indigo-400 rounded-lg text-[10px] font-bold transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      Add
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {isCompressing && (
            <div className="flex items-center gap-2 p-2 bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900 rounded-xl">
              <Loader className="w-3.5 h-3.5 text-indigo-600 animate-spin" />
              <span className="text-[11px] text-indigo-700 dark:text-indigo-400 font-bold">
                Compressing image {compressionProgress.current} of {compressionProgress.total} ({compressionProgress.percent}%) ...
              </span>
            </div>
          )}

          {selectedImages.length > 0 && (
            <div className="flex gap-2 overflow-x-auto py-1 max-w-full">
              {selectedImages.map((imgSrc, idx) => (
                <div key={idx} className="relative w-14 h-14 rounded-xl overflow-hidden border border-theme-border flex-shrink-0 group">
                  <img src={imgSrc} alt="Preview thumbnail" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setSelectedImages(prev => prev.filter((_, i) => i !== idx))}
                    className="absolute top-0 right-0 bg-slate-900/80 hover:bg-rose-600 text-white p-0.5 rounded-bl-lg transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Quick Action Prompts */}
          {!isAgent('food') && (
            messages.length <= 1 || 
            selectedImages.length > 0 || 
            ((isAgent('biomarker_review') || agentType === 'biomarker_review') && (!messages.some(m => m.role === 'assistant' && !m.id?.startsWith('welcome_')) || isAnalyzing))
          ) && (
            <div className="flex gap-2 mb-2 w-full overflow-x-auto scrollbar-none pb-1 shrink-0">
              {isAgent('front_desk') ? (
                <>
                  <button
                    type="button"
                    onClick={() => handleSend('What should I do?')}
                    className="whitespace-nowrap px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-full transition-colors flex items-center gap-1.5 cursor-pointer shadow-sm active:scale-95"
                  >
                    <span>🧭 What should I do?</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenAgentFromFrontDesk?.('agent1')}
                    className="whitespace-nowrap px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-theme-neutral text-xs font-bold rounded-full transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>Lab Parser</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenAgentFromFrontDesk?.('biomarker_review')}
                    className="whitespace-nowrap px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-theme-neutral text-xs font-bold rounded-full transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>Review</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenAgentFromFrontDesk?.('catalog_clean')}
                    className="whitespace-nowrap px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-theme-neutral text-xs font-bold rounded-full transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>Catalog Cleaner</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenAgentFromFrontDesk?.('data_review')}
                    className="whitespace-nowrap px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-theme-neutral text-xs font-bold rounded-full transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>Range Calibrator</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenAgentFromFrontDesk?.('health_baseline')}
                    className="whitespace-nowrap px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-theme-neutral text-xs font-bold rounded-full transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>Health Coach</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenAgentFromFrontDesk?.('agent4')}
                    className="whitespace-nowrap px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-theme-neutral text-xs font-bold rounded-full transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>Test Planner</span>
                  </button>
                </>
              ) : (
                (isAgent('biomarker_review') || agentType === 'biomarker_review') ? (
                  (!messages.some(m => m.role === 'assistant' && !m.id?.startsWith('welcome_')) || isAnalyzing) ? (
                    <button
                      type="button"
                      onClick={() => {
                        const triggerText = inputText.trim() || autoSendMessage || (reviewBiomarkerKey ? `Please review my biomarker: ${reviewBiomarkerKey}` : 'Please review my biomarker');
                        handleSend(triggerText);
                      }}
                      disabled={isAnalyzing}
                      className="w-full py-2.5 px-4 bg-gradient-to-r from-indigo-600 via-indigo-650 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white text-xs font-extrabold rounded-xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-98 disabled:opacity-60 mb-2"
                    >
                      <BrainCircuit className="w-4 h-4 text-amber-300 animate-pulse" />
                      <span>{isAnalyzing ? 'AI Diagnostic Analysis in Progress...' : '🔬 Run AI Diagnostic Analysis Now'}</span>
                    </button>
                  ) : null
                ) : (
                  !isAgent('food_idea') && !isAgent('daily_recommendation') && !(isAgent('medical') && !agentType) && (
                    <button
                      type="button"
                      onClick={() => {
                        const triggerText = autoSendMessage || 'Start';
                        handleSend(triggerText);
                      }}
                      className="whitespace-nowrap px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-full transition-colors flex items-center gap-1.5 cursor-pointer shadow-sm active:scale-95"
                    >
                      <span>🚀 {autoSendMessage ? (autoSendMessage.toLowerCase().includes('calibrate') ? 'Start Calibration' : 'Start Review') : "Let's start"}</span>
                    </button>
                  )
                )
              )}
            </div>
          )}
          {isSelectingMode && (
            <div className="flex items-center gap-2.5 w-full bg-indigo-50/15 dark:bg-indigo-950/5 p-2 rounded-2xl border border-indigo-100/30 dark:border-indigo-950/30">
              {selectedItemKeys.length > 0 && (
                <>
                  {/* Reload / Reset Selection Icon */}
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedItemKeys([]);
                    }}
                    className="p-3 bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800 text-theme-text-secondary rounded-xl transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500/20 flex-shrink-0 cursor-pointer"
                    title="Reset Selection"
                  >
                    <RotateCcw className="w-5 h-5" />
                  </button>
                  {/* Action Buttons: Image Search, Origin Search, Compare Food */}
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedItemKeys.length === 0) return;
                      if (foodCardActionRef.current?.triggerImageSearch) {
                        foodCardActionRef.current.triggerImageSearch(selectedItemKeys);
                      }
                      setIsSelectingMode(false);
                      setSelectedItemKeys([]);
                    }}
                    disabled={selectedItemKeys.length === 0}
                    className={`flex-1 py-3 px-4 rounded-xl text-xs font-bold shadow-md transition-all text-center flex items-center justify-center gap-1.5 cursor-pointer ${
                      selectedItemKeys.length === 0
                        ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-600 cursor-not-allowed shadow-none border border-theme-border/40'
                        : 'bg-indigo-600 hover:bg-indigo-700 text-white active:scale-95'
                    }`}
                  >
                    <span>🔍 Image Search</span>
                    {selectedItemKeys.length > 0 && (
                      <span className="px-1.5 py-0.5 bg-white/20 text-[9.5px] rounded-full">
                        {selectedItemKeys.length}
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      if (selectedItemKeys.length === 0) return;
                      if (foodCardActionRef.current?.triggerFetchMenuImages) {
                        foodCardActionRef.current.triggerFetchMenuImages(selectedItemKeys);
                      }
                      setIsSelectingMode(false);
                      setSelectedItemKeys([]);
                    }}
                    disabled={selectedItemKeys.length === 0}
                    className={`flex-1 py-3 px-4 rounded-xl text-xs font-bold shadow-md transition-all text-center flex items-center justify-center gap-1.5 cursor-pointer ${
                      selectedItemKeys.length === 0
                        ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-600 cursor-not-allowed shadow-none border border-theme-border/40'
                        : 'bg-emerald-600 hover:bg-emerald-700 text-white active:scale-95'
                    }`}
                  >
                    <span>🖼️ Show Menu Image</span>
                    {selectedItemKeys.length > 0 && (
                      <span className="px-1.5 py-0.5 bg-white/20 text-[9.5px] rounded-full">
                        {selectedItemKeys.length}
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      if (selectedItemKeys.length === 0) return;
                      if (foodCardActionRef.current?.triggerCompareFood) {
                        foodCardActionRef.current.triggerCompareFood(selectedItemKeys);
                      }
                      setIsSelectingMode(false);
                      setSelectedItemKeys([]);
                    }}
                    disabled={selectedItemKeys.length === 0}
                    className={`flex-1 py-3 px-4 rounded-xl text-xs font-bold shadow-md transition-all text-center flex items-center justify-center gap-1.5 cursor-pointer ${
                      selectedItemKeys.length === 0
                        ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-600 cursor-not-allowed shadow-none border border-theme-border/40'
                        : 'bg-amber-600 hover:bg-amber-700 text-white active:scale-95'
                    }`}
                  >
                    <span>⚖️ Compare Food</span>
                    {selectedItemKeys.length > 0 && (
                      <span className="px-1.5 py-0.5 bg-white/20 text-[9.5px] rounded-full">
                        {selectedItemKeys.length}
                      </span>
                    )}
                  </button>
                </>
              )}
              {/* Close / Cancel Search Mode Button */}
              <button
                type="button"
                onClick={() => {
                  setIsSelectingMode(false);
                  setSelectedItemKeys([]);
                }}
                className="p-3 bg-rose-50 dark:bg-rose-950/20 hover:bg-rose-100 dark:hover:bg-rose-900/40 text-rose-650 dark:text-rose-450 rounded-xl transition-all cursor-pointer flex-shrink-0"
                title="Cancel Selection"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          )}
          {!isSelectingMode && (
            <div className="flex items-center gap-2">
              <button
                id="food-chat-photo-btn"
                onClick={() => fileInputRef.current?.click()}
                className="p-3 bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800 text-theme-text-secondary rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500/20 flex-shrink-0"
                title={t.uploadPhoto}
              >
                <Image className="w-5 h-5" />
              </button>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleImageSelect}
                accept="image/*"
                multiple
                className="hidden"
              />

              <button
                id="food-chat-camera-btn"
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                className="p-3 bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800 text-theme-text-secondary rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500/20 flex-shrink-0"
                title="Take photo from phone camera"
              >
                <Camera className="w-5 h-5" />
              </button>
              <input
                type="file"
                ref={cameraInputRef}
                onChange={handleImageSelect}
                accept="image/*"
                capture="environment"
                className="hidden"
              />

              <input
                id="food-chat-input"
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isAnalyzing && !isSubmitting && !isSendingRef.current && !isCompressing) {
                    const triggerText = inputText.trim() || autoSendMessage || (reviewBiomarkerKey ? buildBiomarkerReviewPrefill(reviewBiomarkerKey, undefined, biomarkers, profile) : (selectedImages.length > 0 ? 'Analyze this meal photo.' : ''));
                    if (triggerText || selectedImages.length > 0) {
                      handleSend(triggerText || undefined);
                    }
                  }
                }}
                placeholder={t.chatPlaceholder}
                className="flex-1 min-w-0 bg-slate-50 dark:bg-slate-800/60 border border-theme-border/50 rounded-xl px-3.5 py-3 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all font-medium"
              />

              <button
                id="food-chat-send-btn"
                type="button"
                onClick={() => {
                  if (isAnalyzing || isSubmitting || isSendingRef.current || isCompressing) return;
                  const triggerText = inputText.trim() || autoSendMessage || (reviewBiomarkerKey ? buildBiomarkerReviewPrefill(reviewBiomarkerKey, undefined, biomarkers, profile) : (selectedImages.length > 0 ? 'Analyze this meal photo.' : ''));
                  if (triggerText || selectedImages.length > 0) {
                    handleSend(triggerText || undefined);
                  }
                }}
                disabled={isAnalyzing || isSubmitting || isSendingRef.current || isCompressing}
                className={`px-4 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-md transition-all active:scale-95 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 font-bold text-xs flex items-center gap-1.5 shrink-0 ${(isAnalyzing || isSubmitting || isSendingRef.current || isCompressing) ? 'opacity-50 cursor-not-allowed pointer-events-none' : 'cursor-pointer'}`}
              >
                {(isAnalyzing || isSubmitting || isCompressing) ? (
                  <Loader className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                <span>{isCompressing ? 'Compressing...' : (isAnalyzing || isSubmitting) ? 'Analyzing...' : 'Analyze'}</span>
              </button>
            </div>
          )}
        </div>

      </div>

      {/* Full View Consolidated Log Modal */}
      {activeModalTableRows && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[110] flex items-center justify-center p-4 animation-fade-in">
          <div className="bg-theme-bg-card border border-theme-border rounded-3xl shadow-2xl w-full max-w-5xl h-[80vh] flex flex-col overflow-hidden animate-scale-up">
            
            {/* Modal Header */}
            <div className="bg-slate-50 dark:bg-slate-900/60 border-b border-theme-border/80 px-6 py-4 flex items-center justify-between shrink-0 font-sans">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-600/10 flex items-center justify-center text-indigo-600">
                  <Table className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-theme-text font-display">
                    {activeModalTitle}
                  </h3>
                  <p className="text-xs text-theme-text-secondary">
                    {activeModalTitle.includes('Reference')
                      ? 'Demographically adjusted reference ranges and risk analysis based on age, gender, and ethnicity'
                      : 'Unified view of system-by-system health indicators and 2-year longitudinal insights'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveModalTableRows(null)}
                className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-850 text-slate-400 dark:text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-auto p-6 bg-slate-50/35 dark:bg-slate-950/20 font-sans">
              <div className="overflow-x-auto rounded-2xl border border-theme-border bg-white dark:bg-slate-950 shadow-sm">
                {/* min-w-[1200px] ensures the table is twice as wide for easier reading */}
                <table className="min-w-[1200px] w-full divide-y divide-slate-200 dark:divide-slate-800 text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-900/90 font-bold text-theme-text-secondary sticky top-0 backdrop-blur-sm">
                    <tr>
                      <th className="px-4 py-3 w-[200px]">
                        {activeModalTitle.includes('Reference') ? 'Calibration Domain' : 'System'}
                      </th>
                      <th className="px-4 py-3 w-[180px]">Biomarker</th>
                      <th className="px-4 py-3 w-[120px] text-center">Result</th>
                      <th className="px-4 py-3 w-[100px] text-center">Status</th>
                      <th className="px-4 py-3 min-w-[600px]">
                        {activeModalTitle.includes('Reference') ? 'Profile Calibrated Ranges & Diagnostic Explanations' : '2-Year Trend / Insight (Twice as Wide)'}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-150 dark:divide-slate-800/60 bg-white dark:bg-slate-950 text-theme-neutral font-medium">
                    {activeModalTableRows.map((row, idx) => {
                      const stat = row.status.toUpperCase();
                      let badgeStyle = "text-slate-600 bg-slate-50 dark:bg-slate-900 border-slate-150";
                      if (stat === 'CRITICAL') {
                        badgeStyle = "text-rose-600 bg-rose-50 dark:bg-rose-950/40 border-rose-100 dark:border-rose-900/40";
                      } else if (stat === 'WARNING' || stat === 'AMBER' || stat === 'HIGH' || stat === 'LOW') {
                        badgeStyle = "text-amber-600 bg-amber-50 dark:bg-amber-950/40 border-amber-100 dark:border-amber-900/40";
                      } else if (stat === 'NORMAL' || stat === 'OPTIMAL') {
                        badgeStyle = "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-100 dark:border-emerald-900/40";
                      }
                      return (
                        <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/30 transition-colors">
                          <td className="px-4 py-3.5 font-bold text-theme-text-secondary capitalize">{row.system}</td>
                          <td className="px-4 py-3.5 text-theme-text font-bold">{row.biomarker}</td>
                          <td className="px-4 py-3.5 text-center font-mono font-bold text-slate-800 dark:text-slate-200">{row.result}</td>
                          <td className="px-4 py-3.5 text-center">
                            <span className={`inline-block px-2.5 py-1 rounded-md text-[10px] font-bold border ${badgeStyle}`}>
                              {row.status}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-slate-650 dark:text-slate-400 leading-relaxed font-medium whitespace-pre-line">
                            {row.insight}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="bg-slate-50 dark:bg-slate-900/40 border-t border-theme-border/80 px-6 py-4 flex items-center justify-between shrink-0 font-sans">
              <span className="text-xs text-theme-text-secondary">
                Showing {activeModalTableRows.length} biomarker correlations. Tip: Use horizontal scroll on narrow views.
              </span>
              <button
                type="button"
                onClick={() => setActiveModalTableRows(null)}
                className="px-5 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 text-xs font-bold rounded-xl transition-all cursor-pointer shadow-sm"
              >
                Close View
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Full Screen JSON Viewer */}
      {fullScreenJson && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[120] flex items-center justify-center p-4 animation-fade-in">
          <div className="bg-theme-bg-card border border-theme-border rounded-3xl shadow-2xl w-full max-w-4xl h-[80vh] flex flex-col overflow-hidden animate-scale-up">
            
            {/* Modal Header */}
            <div className="bg-slate-50 dark:bg-slate-900/60 border-b border-theme-border/80 px-6 py-4 flex items-center justify-between shrink-0 font-sans">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-600/10 flex items-center justify-center text-indigo-600">
                  <Table className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-theme-text font-display">
                    Previous Review Data
                  </h3>
                  <p className="text-xs text-theme-text-secondary">
                    The JSON data provided for context in this conversation step.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setFullScreenJson(null)}
                className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-850 text-slate-400 dark:text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-auto p-6 bg-slate-50/35 dark:bg-slate-950/20 font-sans">
              <div className="rounded-2xl border border-theme-border bg-white dark:bg-slate-950 shadow-sm p-4 overflow-auto">
                <pre className="text-xs font-mono text-theme-neutral whitespace-pre-wrap break-words">
                  {fullScreenJson}
                </pre>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="bg-slate-50 dark:bg-slate-900/40 border-t border-theme-border/80 px-6 py-4 flex items-center justify-between shrink-0 font-sans">
              <span className="text-xs text-theme-text-secondary">
                Read-only view
              </span>
              <button
                type="button"
                onClick={() => setFullScreenJson(null)}
                className="px-5 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 text-xs font-bold rounded-xl transition-all cursor-pointer shadow-sm"
              >
                Close
              </button>
            </div>

          </div>
        </div>
      )}

      <FullScreenInstructionViewer
        isOpen={activeInstructionAgentType !== null}
        onClose={() => {
          setActiveInstructionAgentType(null);
          setActiveInstructionPrompt(null);
        }}
        agentType={activeInstructionAgentType || ''}
        profile={profile}
        biomarkerHistory={activeHistory}
        agentPrompt={activeInstructionPrompt || undefined}
        outOfRangeBiomarkers={outOfRangeBiomarkers}
        remainingAllowance={remainingAllowance}
        activeMeal={[...messages].reverse().find(m => m.data?.pendingFoodLog)?.data?.pendingFoodLog}
        location={userLocation}
        recentMeals={foodLogs?.slice(-20).map(f => f.name)}
        budget={budget}
        currency={currency}
        maxDistance={maxDistance}
      />
      {showFullScreenDebugLogs && (
        <Suspense fallback={null}>
          <FullScreenLogViewer
            isOpen={showFullScreenDebugLogs}
            onClose={() => setShowFullScreenDebugLogs(false)}
            title="AI Agent Diagnostic Log History"
            logsText={debugLogs.map(l => `[${l.timestamp}] ${l.message}`).join('\\n')}
            logsArray={debugLogs.map(l => `[${l.timestamp}]\n${l.message}`)}
            onSendToAdmin={handleSendDebugLogsToAdmin}
            isSendingLogs={isDebugSendingLogs}
            logsSendStatus={debugLogsSendStatus}
            onClearLogs={handleClearDebugLogs}
            eventsCount={debugLogs.length}
            conversationsList={conversationsList}
            activeConversationId={activeConversationId || undefined}
            showFilters={true}
          />
        </Suspense>
      )}
      {flagMsg && (
        <UniversalModal
          isOpen={!!flagMsg}
          onClose={() => setFlagMsg(null)}
          title={`Flag issue with ${activeAgentKey} response`}
          flagContext={{
            context: activeAgentKey || 'log_chat',
            initialCategory: (activeAgentKey === 'data_review' || activeAgentKey === 'medical') ? 'biomarker' : (activeAgentKey === 'food' ? 'foodcart' : 'Other'),
            firebaseUid: profile?.uid,
            getPayload: () => ({
              message_content: flagMsg.content,
              message_data: flagMsg.data,
              agent: activeAgentKey,
              model: selectedModelId,
            }),
            defaultIssueType: 'incorrect_answer',
          }}
          onFlagSuccess={() => setFlagMsg(null)}
        />
      )}
    </div>
  );
}

  // B5
  // skipScout = true
  // skipScout: skipScout === true
  
/* PortionClarifyCard portionChoices: choices skipScout: true */

/* handleDownloadDebugReport Download full report.md report- */
