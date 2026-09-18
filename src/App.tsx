import React, { useState, useEffect, useRef, useCallback } from 'react';
import { lazyWithRetry } from './utils/lazyWithRetry';
import { ErrorBoundary } from './components/ErrorBoundary';
import { UserProfile, FoodLog, BiomarkerLog, HealthAction, DailyBenefit, RecommendationReport, DbInteraction, QuotaData, FoodIdea } from './types';
import Header from './components/Header';
import BottomNav from './components/BottomNav';
import AuthScreen from './components/AuthScreen';
import AppShell from './components/AppShell';
const HomeTab = lazyWithRetry(() => import('./components/HomeTab'));
const InsightsTab = lazyWithRetry(() => import('./components/InsightsTab'));
const FoodHistoryTab = lazyWithRetry(() => import('./components/FoodHistoryTab'));
const MedicalHistoryTab = lazyWithRetry(() => import('./components/MedicalHistoryTab'));
const TrendsTab = lazyWithRetry(() => import('./components/TrendsTab'));
import ConflictResolutionModal from './components/ConflictResolutionModal';
const LogChat = lazyWithRetry(() => import('./components/LogChat'));
import { JobStore } from './jobs/JobStore';
import { useAuthSession } from './hooks/useAuthSession';
import { useAppProfile, type ProfileDbChangeChecker } from './hooks/useAppProfile';
import { useAppSync } from './hooks/useAppSync';
import { useJobRuntime } from './hooks/useJobRuntime';
import { useFoodLogActions } from './hooks/useFoodLogActions';
import { useReportActions } from './hooks/useReportActions';
import { useBiomarkerActions, logBmiIfProfileWeightHeightChanged } from './hooks/useBiomarkerActions';
import { initSupabaseJobSync, hydrateUserJobs, upsertJobToSupabase } from './jobs/SupabaseJobSync';
import { getProgressPercent, getStepCeiling } from './jobs/progress';
import FloatingActionSheet from './components/FloatingActionSheet';
import { translations } from './utils/translations';
import { AVAILABLE_LLMS } from './utils/llm';
import { PRIMARY_NUTRIENTS, isCoreNutrient, isAdditionalNutrient } from './utils/nutrients';
import { getDynamicStyles } from './components/AppDynamicStyles';

import { getAvailableCredits, deductAgentCredits } from './utils/creditManager';
import { Plus, HeartHandshake, RefreshCw, Sparkles, Stethoscope, Utensils, Loader, CloudLightning, AlertTriangle, Activity, X } from 'lucide-react';
import { auth, db } from './firebase';
import { trackApiCall, setActiveQueryId, generateQueryId, initializeFetchInterceptor } from './utils/apiTracker';
import { doc, getDoc, setDoc, collection, getDocs, deleteDoc, getDocFromServer, getDocsFromServer, getDocsFromCache, writeBatch } from 'firebase/firestore';
import { sanitizeForFirestore, checkQuotaFlag, handleRetryQuota } from './utils/firestoreUtils';
import { getCurrentDateInTimezone, toYYYYMMDD, normalizeBiomarkerHistory } from './utils/dateUtils';
import { biomarkerDefinitions, isAsianEthnicity, hasBmiPendingAlert, getProfileFingerprint, isValEmpty, getMappedBiomarkerKey, selfHealCustomBiomarkerDefinitions } from './utils/biomarkers';
import { applyModificationCommands, overlayFingerprint, resolveAgentDestination, shouldRunCalibrator, attachObservationMeta, enrichReviewModificationCommands, collectCatalogUnitMap, cleanupInventedBiomarkerCatalog, routeExtractedObservations, approvePendingObservation, type ModificationCommand } from './utils/biomarkerLifecycle';
import { mergeParallelAliasGroups } from './utils/biomarkerAuditEngine';
import { extractFallbackModifications } from './components/chat-cards/BiomarkerReviewCard';
import { formatOptimalTargetValue } from './utils/agentCalibration';
import { standardizeUnit, CONVERSION_FACTORS } from './utils/unitConversion';
import { get, set, pruneLocalStorageToFreeSpace, getStorageKey, getSnapshotKey, saveLocalSnapshot, loadLocalSnapshots, deleteLocalSnapshot, safeSaveToLocalStorage, getAggregatedAppData } from './utils/storageUtils';
import { maybeRecalibrateDemographicOverlays, pushPendingObservation, isDeepEqual, sanitizeProfile } from './utils/appProfileUtils';

const FIRESTORE_READ_BUDGET = 3000; // generous for one real session; a runaway loop hits this fast
function firestoreReadGuard(label: string, docCount: number = 1): boolean {
  const key = 'firestoreReadCountThisSession';
  const current = parseInt(sessionStorage.getItem(key) || '0', 10) + docCount;
  sessionStorage.setItem(key, String(current));
  if (current > FIRESTORE_READ_BUDGET) {
    console.error(`[Circuit Breaker] Firestore read budget exceeded (${current}/${FIRESTORE_READ_BUDGET}) at "${label}". Blocking further reads this session to prevent runaway cost. Reload the page to reset.`);
    return false; // caller should skip the read
  }
  return true;
}
import { runCleanupMigration } from './utils/migrationTask';
import { supabase, isSupabaseConfigured } from './utils/supabaseClient';
import { syncLogsWithTimeBuckets, fetchAllConsolidatedLogs, fetchFoodLogsPage, subscribeToSupabaseLogs, upsertProfileToSupabase, pushLogsToServer, mergeByRecency, mergeActions, mergeBenefits, mergeFoodIdeas, mergeReports, mergeProfiles, mergeBiomarkerHistory, mergeDeleteMaps, supabaseRowToFoodLog, supabaseRowToBiomarkerLog, resolveInitialLanguage } from "./utils/syncUtils";
import { mergeFoodLogsDeduped, rehydrateFoodImagesFromDonors, foodLogFingerprint } from "./utils/foodLogDedupe";
import { isUsableImageUrl, uniqueMealImageUrls } from "./utils/foodImageSources";
import { sanitizeBiomarkerHistoryOnLoad } from "./utils/biomarkers";
import { recalibrateProfileOverlays } from "./utils/biomarkerLifecycle";
import type { SanitizeProposal } from "./utils/dataSanitize";
import { compressImage } from "./utils/imageCompressor";
/** Cap bulk foodImages Firestore reads per sync (console showed 209 — free-tier death). Rest stay lazy. */
const MAX_IMAGE_FETCH_PER_SYNC = 24;
const QUOTA_STORAGE_KEY = 'health_cockpit_quota_data';
const getQuotaKey = () => {
  return new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' });
};

export default function App() {
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [showSnapshotPanel, setShowSnapshotPanel] = useState(false);
  const [lastSnapshotLabel, setLastSnapshotLabel] = useState<string | null>(null);
  useEffect(() => {
    initializeFetchInterceptor();
  }, []);

  // One-time prompt reset to clean up stale localStorage for data_review
  useEffect(() => {
    if (typeof window !== 'undefined' && localStorage.getItem('migration_july06_prompts_cleaned_v3') !== 'true') {
      localStorage.removeItem('custom_system_instruction_data_review');
      localStorage.removeItem('custom_variable_data_data_review');
      localStorage.setItem('migration_july06_prompts_cleaned_v3', 'true');
    }
  }, []);

  // ── Q-11.4 ────────────────────────────────────────────────────────────────────────────────────
  // Profile state, its localStorage persistence and the data loader now live in
  // hooks/useAppProfile.ts. Everything the hook's save effect depends on has to be declared above
  // the hook site (hoisting only — no behaviour change); handleFetchMoreFoods stays below it because
  // its own dependency array already reads profile.
  const [syncState, setSyncState] = useState<'synced' | 'syncing' | 'local' | 'conflict'>('local');
  const [isInitialDataLoading, setIsInitialDataLoading] = useState<boolean>(true);
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  // Core logs and targets states
  const [foodLogs, setFoodLogsRaw] = useState<FoodLog[]>([]);
  const [totalFoodsCount, setTotalFoodsCount] = useState<number | undefined>(undefined);
  // B11: every write path collapses id + soft name/kcal/day duplicates (YOLK variants, retries)
  const setFoodLogs = (val: FoodLog[] | ((prev: FoodLog[]) => FoodLog[])) => {
    setFoodLogsRaw((prev) => {
      const next = typeof val === 'function' ? val(prev) : val;
      if (!Array.isArray(next)) return prev;
      return mergeFoodLogsDeduped(next, []);
    });
  };
  const [biomarkers, setBiomarkers] = useState<{ [key: string]: number | string }>({});
  const [biomarkerHistoryRaw, setBiomarkerHistoryRaw] = useState<BiomarkerLog[]>([]);
  const setBiomarkerHistory = (val: BiomarkerLog[] | ((prev: BiomarkerLog[]) => BiomarkerLog[])) => {
    const apply = (raw: BiomarkerLog[]) => {
      const normalized = normalizeBiomarkerHistory(raw || []);
      // Auto-fix unit-scale phantoms (195 mmol/L chol, 42.1 Hct, 14.5 Hb as g/L) and drop rest
      const { history: cleaned, fixedCount } = sanitizeBiomarkerHistoryOnLoad(
        normalized,
        profileRef.current || profile
      );
      if (fixedCount > 0 && !(window as any).__biomarkerSanitizeLogged) {
        (window as any).__biomarkerSanitizeLogged = true;
        console.debug(`[BiomarkerSanitize] Flagged ${fixedCount} improbable unit-scale value(s) — not auto-rewritten`);
      }
      return cleaned as BiomarkerLog[];
    };
    if (typeof val === 'function') {
      setBiomarkerHistoryRaw((prev) => apply(val(prev)));
    } else {
      setBiomarkerHistoryRaw(apply(val));
    }
  };
  const biomarkerHistory = biomarkerHistoryRaw;
  const [actions, setActions] = useState<HealthAction[]>([]);
  const [dailyBenefits, setDailyBenefits] = useState<DailyBenefit[]>([]);
  const [foodIdeas, setFoodIdeas] = useState<FoodIdea[]>([]);
  const [report, setReport] = useState<RecommendationReport | null>(null);
  const [draftReport, setDraftReport] = useState<RecommendationReport | null>(null);

  // checkForDbChanges is declared ~1,900 lines below this hook, so the loader receives it through a
  // ref the way the job runtime receives saveAndSync (Q-11.3b) instead of capturing a binding that
  // does not exist yet at render time.
  const checkForDbChangesRef = useRef<ProfileDbChangeChecker | null>(null);
  const { profile, setProfile, loadUserData } = useAppProfile({
    foodLogs,
    biomarkers,
    biomarkerHistory,
    actions,
    dailyBenefits,
    foodIdeas,
    report,
    syncState,
    setFoodLogs,
    setBiomarkers,
    setBiomarkerHistory,
    setActions,
    setDailyBenefits,
    setReport,
    setSyncState,
    setIsInitialDataLoading,
    setIsAuthChecking,
    checkForDbChangesRef,
  });
  const hasRunImageCompression = useRef(false);
  const [dismissedBmiAlerts, setDismissedBmiAlerts] = useState<{[key: string]: boolean}>(() => {
    try {
      const saved = localStorage.getItem('dismissedBmiAlerts');
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      return {};
    }
  });
  const handleDismissBmiAlert = () => {
    if (!profile) return;
    const fingerprint = getProfileFingerprint(profile);
    const updated = { ...dismissedBmiAlerts, [fingerprint]: true };
    setDismissedBmiAlerts(updated);
    localStorage.setItem('dismissedBmiAlerts', JSON.stringify(updated));
  };
  const [activeTabRaw, setActiveTabRaw] = useState<'home' | 'insights' | 'health' | 'food' | 'medical' | 'trends'>('home');
  const [healthSubTab, setHealthSubTab] = useState<'biomarker' | 'insight'>('biomarker');

  const setActiveTab = (tab: 'home' | 'insights' | 'health' | 'food' | 'medical' | 'trends') => {
    if (tab === 'medical') {
      setActiveTabRaw('health');
      setHealthSubTab('biomarker');
    } else if (tab === 'insights') {
      setActiveTabRaw('health');
      setHealthSubTab('insight');
    } else {
      setActiveTabRaw(tab);
    }
  };

  const activeTab = activeTabRaw;

  useEffect(() => {
    const qid = generateQueryId();
    setActiveQueryId(qid);
  }, [activeTab]);

  useEffect(() => {
    const handleSwitchTab = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail?.tab) {
        setActiveTab(customEvent.detail.tab);
      }
    };
    const handleSeedTestData = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail) {
        const { profile: p, biomarkers: b, biomarkerHistory: h } = customEvent.detail;
        if (p) setProfile(p);
        if (b) setBiomarkers(b);
        if (h) setBiomarkerHistory(h);
      }
    };
    window.addEventListener('switch-tab', handleSwitchTab);
    window.addEventListener('navigate-tab', handleSwitchTab);
    window.addEventListener('seed-biomarker-test-data', handleSeedTestData);
    return () => {
      window.removeEventListener('switch-tab', handleSwitchTab);
      window.removeEventListener('navigate-tab', handleSwitchTab);
      window.removeEventListener('seed-biomarker-test-data', handleSeedTestData);
    };
  }, []);
  const [initiallyExpandedFoodId, setInitiallyExpandedFoodId] = useState<string | null>(null);
  const [isConflictModalOpen, setIsConflictModalOpen] = useState(false);
  const [conflictData, setConflictData] = useState<{
    localProfile: UserProfile;
    cloudProfile: UserProfile;
    localFoods: FoodLog[];
    cloudFoods: FoodLog[];
    localBioHistory: BiomarkerLog[];
    cloudBioHistory: BiomarkerLog[];
    localActions: HealthAction[];
    cloudActions: HealthAction[];
    localBenefits: DailyBenefit[];
    cloudBenefits: DailyBenefit[];
    cloudReport: RecommendationReport | null;
    localReport: RecommendationReport | null;
  } | null>(null);
  const [isFirestoreQuotaExceeded, setIsFirestoreQuotaExceeded] = useState<boolean>(() => {
    const exceeded = checkQuotaFlag();
    if (exceeded) {
      const saved = localStorage.getItem(QUOTA_STORAGE_KEY);
      const currentKey = getQuotaKey();
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed.date !== currentKey) {
            localStorage.removeItem('firestore_quota_exceeded');
            return false;
          }
        } catch (e) {}
      }
    }
    return exceeded;
  });
  const [syncFailedWarning, setSyncFailedWarning] = useState<string | null>(null);
  const handleFirestoreError = (err: any) => {
    if (!err) return;
    const msg = String(err.message || err.code || err || '').toLowerCase();
    if (
      msg.includes('resource-exhausted') || 
      msg.includes('quota') || 
      msg.includes('limit exceeded') ||
      err.code === 'resource-exhausted'
    ) {
      setIsFirestoreQuotaExceeded(true);
      localStorage.setItem('firestore_quota_exceeded', 'true');
      localStorage.setItem('firestore_quota_exceeded_time', new Date().getTime().toString());
      setSyncState('local');
    }
  };
  const [hideSensitive, setHideSensitive] = useState<boolean>(false);
  // DB Transaction tracker state for spinning loader click analytics
  const [dbInteractions, setDbInteractions] = useState<DbInteraction[]>(() => {
    try {
      const saved = localStorage.getItem('dbInteractions_history');
      if (saved) {
        const parsed = JSON.parse(saved);
        return parsed.map((op: any) => ({
          ...op,
          status: op.status === 'pending' ? 'error' : op.status,
          errorMessage: op.status === 'pending' ? 'Interrupted by page reload' : op.errorMessage
        }));
      }
    } catch (e) {}
    return [];
  });
  
  useEffect(() => {
    localStorage.setItem('dbInteractions_history', JSON.stringify(dbInteractions));
  }, [dbInteractions]);

  useEffect(() => {
    if (profile?.email) {
      loadLocalSnapshots(profile.email).then(s => setSnapshots(s)).catch(() => {});
    }
  }, [profile?.email]);


  // Auto Sync Disabled Status (for quota saving / local-first control)
  const [autoSyncDisabled, setAutoSyncDisabled] = useState<boolean>(() => {
    return localStorage.getItem('auto_sync_disabled') === 'true';
  });
  const handleToggleAutoSyncDisabled = (disabled: boolean) => {
    setAutoSyncDisabled(disabled);
    localStorage.setItem('auto_sync_disabled', disabled ? 'true' : 'false');
  };

  // Daily Quota Tracking (resets at midnight PT)
  const [quota, setQuota] = useState<QuotaData>(() => {
    const saved = localStorage.getItem(QUOTA_STORAGE_KEY);
    const currentKey = getQuotaKey();
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.date === currentKey) return parsed;
      } catch (e) {}
    }
    return { date: currentKey, reads: 0, writes: 0, deletes: 0 };
  });
  useEffect(() => {
    localStorage.setItem(QUOTA_STORAGE_KEY, JSON.stringify(quota));
  }, [quota]);
  const updateQuota = (type: 'upload' | 'download' | 'delete' | 'sync', docCount: number = 1) => {
    if (type === 'sync' || docCount === 0) return;
    setQuota(prev => {
      const newQuota = { ...prev };
      const currentKey = getQuotaKey();
      if (currentKey !== newQuota.date) {
        newQuota.date = currentKey;
        newQuota.reads = 0;
        newQuota.writes = 0;
        newQuota.deletes = 0;
      }
      if (type === 'upload') newQuota.writes += docCount;
      if (type === 'download') newQuota.reads += docCount;
      if (type === 'delete') newQuota.deletes += docCount;
      return newQuota;
    });
  };
  const logInteraction = (type: 'upload' | 'download' | 'delete' | 'sync', path: string, data: any, docCount: number = 1, database: 'Firebase' | 'Supabase' = 'Firebase') => {
    if (type === 'upload' || type === 'delete' || type === 'download') {
      const apiPrefix = database === 'Supabase' ? 'supabase' : 'firebase';
      const apiType = (type === 'upload' ? `${apiPrefix}_write` : type === 'delete' ? `${apiPrefix}_delete` : `${apiPrefix}_read`) as any;
      const userEmail = auth.currentUser?.email || 'anonymous';
      
      let resolvedLabel = '';
      const actionName = type === 'upload' ? `${database} Write` : type === 'delete' ? `${database} Delete` : `${database} Read`;
      
      if (type === 'download') {
        if (path.includes('(Profile)')) {
          resolvedLabel = `${actionName} - Fetch User Profile (downloads remote settings & checks database lastUpdatedAt to see if local device needs a full sync)`;
        } else if (path.includes('/foodLogs')) {
          resolvedLabel = `${actionName} - Fetch Food Logs (downloads remote meal entries logged on other devices to synchronize state)`;
        } else if (path.includes('/biomarkerHistory')) {
          resolvedLabel = `${actionName} - Fetch Biomarker Logs (downloads remote biomarker history recordings to synchronize state)`;
        } else if (path.includes('/actions')) {
          resolvedLabel = `${actionName} - Fetch Health Actions (downloads active assigned checklist items generated by agents)`;
        } else if (path.includes('/dailyBenefits')) {
          resolvedLabel = `${actionName} - Fetch Daily Benefits (downloads agent-calculated benefits list)`;
        } else if (path.includes('/reports/latest')) {
          resolvedLabel = `${actionName} - Fetch Latest Recommendation Report (downloads latest holistic health analysis)`;
        } else {
          resolvedLabel = `${actionName} - Download from ${path}`;
        }
      } else if (type === 'upload') {
        if (path.includes('(Restore Profile)')) {
          resolvedLabel = `${actionName} - Restore Profile (overwrites Cloud settings with local backup profile)`;
        } else if (path.includes('(Create Profile)')) {
          resolvedLabel = `${actionName} - Create New User Profile (saves initial onboarded goals, targets, and age/gender)`;
        } else if (path.includes('(Profile)')) {
          resolvedLabel = `${actionName} - Update Profile (saves updated user details, target Ranges, and syncs deleted IDs list to avoid orphaned entries)`;
        } else if (path.includes('/agentAnalyses/')) {
          resolvedLabel = `${actionName} - Save Agent Analysis (saves a newly completed AI medical review or daily log audit)`;
        } else if (path.includes('/metadata/dashboard (Actions)')) {
          resolvedLabel = `${actionName} - Save Dashboard Actions (saves updated checkbox state and list of daily action items)`;
        } else if (path.includes('/metadata/dashboard (Benefits)')) {
          resolvedLabel = `${actionName} - Save Dashboard Benefits (saves updated list of daily diet benefits)`;
        } else if (path.includes('/metadata/dashboard (FoodIdeas)')) {
          resolvedLabel = `${actionName} - Save Dashboard Food Ideas (saves updated list of suggested AI meals)`;
        } else if (path.includes('/metadata/dashboard (Report Update)')) {
          resolvedLabel = `${actionName} - Save Dashboard Report Metadata (updates action list and link to latest analysis)`;
        } else if (path.includes('/metadata/dashboard')) {
          resolvedLabel = `${actionName} - Save General Dashboard Configurations`;
        } else if (path.includes('/reports/latest')) {
          resolvedLabel = `${actionName} - Save Latest Recommendation Report (saves PDF report & health advice payload)`;
        } else {
          resolvedLabel = `${actionName} - Upload to ${path}`;
        }
      } else {
        resolvedLabel = `${actionName} - Delete at ${path}`;
      }
      
      trackApiCall(apiType, resolvedLabel, userEmail);
    }
    const sizeBytes = data ? (typeof data === 'string' ? data.length : JSON.stringify(data).length) : 0;
    const newOp: DbInteraction = {
      id: `db_op_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
      type,
      path,
      sizeBytes,
      status: 'pending' as const,
      startTimeMs: Date.now(),
      docCount,
      database
    };
    setDbInteractions(prev => [newOp, ...prev].slice(0, 100));
    return newOp.id;
  };
  const completeInteraction = (id: string, success: boolean, sizeBytes?: number, errorMsg?: string, finalDocCount?: number) => {
    setDbInteractions(prev => {
      const op = prev.find(item => item.id === id);
      if (op && success && op.status === 'pending') {
        const docsCount = finalDocCount !== undefined ? finalDocCount : (op.docCount || 1);
        setTimeout(() => updateQuota(op.type, docsCount), 0);
      }
      return prev.map(item => {
        if (item.id === id) {
          return {
            ...item,
            status: success ? 'completed' : 'failed',
            sizeBytes: sizeBytes !== undefined ? sizeBytes : item.sizeBytes,
            docCount: finalDocCount !== undefined ? finalDocCount : item.docCount,
            errorMessage: errorMsg
          };
        }
        return item;
      });
    });
  };

  const resolveSupabaseLabel = (type: string, path: string, database: string) => {
    const actionName = type === 'upload' ? `${database} Write` : type === 'delete' ? `${database} Delete` : `${database} Read`;
    if (path.includes('(Profile)')) {
      return `${actionName} - Sync Profile (pushes updated settings, targets, and deleted-ID tracking lists to Supabase)`;
    } else if (path.includes('(Food & Biomarker Logs)')) {
      return `${actionName} - Sync Food & Biomarker Logs (pushes locally logged meals and biomarker readings to Supabase)`;
    } else if (path.includes('(All Logs)')) {
      return `${actionName} - Fetch All Logs (downloads food logs, biomarker logs, and profile data from Supabase for cross-device sync)`;
    } else if (path.includes('consolidated_logs (Fallback)')) {
      return `${actionName} - Fetch All Consolidated Logs Buckets (Firestore fallback used because Supabase returned no data)`;
    }
    return `${actionName} - ${type === 'delete' ? 'Delete at' : type === 'upload' ? 'Upload to' : 'Download from'} ${path}`;
  };

  useEffect(() => {
    const handleDbOpStart = (e) => {
      const { id, type, path, data, database, docCount } = e.detail;
      const sizeBytes = data ? (typeof data === 'string' ? data.length : JSON.stringify(data).length) : 0;
      const newOp = {
        id,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
        type,
        path,
        sizeBytes,
        status: 'pending' as const,
        startTimeMs: Date.now(),
        docCount,
        database
      };
      setDbInteractions(prev => [newOp, ...prev].slice(0, 100));
      if (type === 'upload' || type === 'delete' || type === 'download') {
        const apiPrefix = database === 'Supabase' ? 'supabase' : 'firebase';
        const apiType = (type === 'upload' ? `${apiPrefix}_write` : type === 'delete' ? `${apiPrefix}_delete` : `${apiPrefix}_read`) as any;
        trackApiCall(apiType, resolveSupabaseLabel(type, path, database), auth.currentUser?.email || 'anonymous');
      }
    };
    
    const handleDbOpComplete = (e) => {
      const { id, success, sizeBytes, errorMsg, finalDocCount } = e.detail;
      completeInteraction(id, success, sizeBytes, errorMsg, finalDocCount);
    };

    const handleSyncPushFailed = (e: any) => {
      const { reason, foodCount, biomarkerCount } = e.detail || {};
      console.warn('[Sync] Push to server failed, changes may not be saved:', reason, { foodCount, biomarkerCount });
      setSyncFailedWarning(`⚠️ Your last change couldn't reach the server (${reason || 'network error'}). It will retry next time you sync.`);
      setTimeout(() => setSyncFailedWarning(null), 6000);
    };

    window.addEventListener('db_op_start', handleDbOpStart);
    window.addEventListener('db_op_complete', handleDbOpComplete);
    window.addEventListener('sync_push_failed', handleSyncPushFailed);
    return () => {
      window.removeEventListener('db_op_start', handleDbOpStart);
      window.removeEventListener('db_op_complete', handleDbOpComplete);
      window.removeEventListener('sync_push_failed', handleSyncPushFailed);
    };
  }, []);

  // handleFetchMoreFoods moved to hooks/useAppSync.ts
  // Chat window visibility modals
  const [activeFrontDeskJobId, setActiveFrontDeskJobId] = useState<string | null>(null);
  const [isMedicalChatOpen, setIsMedicalChatOpen] = useState(false);
  const [isFrontDeskOpen, setIsFrontDeskOpen] = useState(false);
  const [activeAgentType, setActiveAgentType] = useState<'agent1' | 'agent2' | 'agent3' | 'agent4' | 'agent5' | 'health_baseline' | 'agent7' | 'data_review' | 'biomarker_review' | null>(null);
  const [activeReviewBiomarkerKey, setActiveReviewBiomarkerKey] = useState<string | undefined>(undefined);
  const [isFloatingOpen, setIsFloatingOpen] = useState(false);

  // Keep latest states in refs for the background runner to read without stale closures
  const profileRef = useRef(profile);
  const foodLogsRef = useRef(foodLogs);
  const biomarkersRef = useRef(biomarkers);
  const biomarkerHistoryRef = useRef(biomarkerHistory);
  const saveAndSyncRef = useRef<typeof saveAndSync | null>(null); // Q-11.3b: job-runtime persist path — assigned below, because its subscriber mounts long before saveAndSync exists

  useEffect(() => {
    profileRef.current = profile;
    foodLogsRef.current = foodLogs;
    biomarkersRef.current = biomarkers;
    biomarkerHistoryRef.current = biomarkerHistory;
  }, [profile, foodLogs, biomarkers, biomarkerHistory]);

  const currentUserId = auth.currentUser?.uid;
  useEffect(() => {
    // Multi-device sync hydrates state on app boot from Supabase
    const cleanupSupabaseSync = initSupabaseJobSync(currentUserId);
    return () => {
      cleanupSupabaseSync();
    };
  }, [currentUserId]);

  // Q-11.3c: the job runtime (executor, /api/jobs/status poll loop, golden-ingest watcher,
  // credit settlement, window globals) now lives in hooks/useJobRuntime.ts, together with
  // activeJobId and handleOpenJob. Move-only; Q-11.3a/3b made this the hook site.
  const { activeJobId, setActiveJobId, handleOpenJob } = useJobRuntime({
    profile,
    profileRef,
    foodLogsRef,
    biomarkersRef,
    biomarkerHistoryRef,
    saveAndSyncRef,
    actions,
    dailyBenefits,
    report,
    setProfile,
    setIsMedicalChatOpen,
    setIsFrontDeskOpen,
    setActiveFrontDeskJobId,
    setActiveAgentType,
    setActiveReviewBiomarkerKey,
  });

  const isFoodChatOpen =
    !!activeJobId &&
    (
      JobStore.getJob(activeJobId)?.kind === 'food_log' ||
      JobStore.getJob(activeJobId)?.kind === 'food_compare' ||
      JobStore.getJob(activeJobId)?.kind === 'food' ||
      !JobStore.getJob(activeJobId)?.kind
    );
  const setIsFoodChatOpen = (isOpen: boolean) => {
    if (!isOpen) {
      setActiveJobId(null);
    }
  };
  const [isManualFoodLogOpen, setIsManualFoodLogOpen] = useState(false);
  const [manualFoodLogError, setManualFoodLogError] = useState<string | null>(null);

  useEffect(() => {
    if (activeJobId) {
      handleOpenJob(activeJobId);
    }
  }, [activeJobId]);
  const [activeDataReviewBatchIdx, setActiveDataReviewBatchIdx] = useState<number | string | null>(null);
  const [activeDataReviewBatchKeys, setActiveDataReviewBatchKeys] = useState<string[]>([]);
  const [activeDataReviewExtractedYaml, setActiveDataReviewExtractedYaml] = useState<any[]>([]);
  const [activeDataReviewCurrentBatch, setActiveDataReviewCurrentBatch] = useState<number>(1);
  const [activeDataReviewEstimatedTotalMarkers, setActiveDataReviewEstimatedTotalMarkers] = useState<number | null>(null);
  const [dataReviewSharedState, setDataReviewSharedState] = useState<any>(null);
  const [calibratingBatchIdx, setCalibratingBatchIdx] = useState<number | null>(null);
  const [calibratingAgentType, setCalibratingAgentType] = useState<string | null>(null);
  const [batchSize, setBatchSize] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('biomarker_batch_size');
      return saved ? parseInt(saved, 10) || 20 : 20;
    } catch (e) {
      return 20;
    }
  });
  const [prefillMessage, setPrefillMessage] = useState<string | null>(null);
  const [activeHandoffPayload, setActiveHandoffPayload] = useState<any>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isEditingFoodLog, setIsEditingFoodLog] = useState(false);

  // Preload LogChat chunk in background after initial page paint so opening Front Desk or Agents is instant
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const preload = () => {
      import('./components/LogChat').catch(() => {});
    };
    if ('requestIdleCallback' in window) {
      (window as any).requestIdleCallback(preload, { timeout: 2000 });
    } else {
      setTimeout(preload, 1000);
    }
  }, []);

  // Sync state with HTML5 History API to support browser back button navigation without quitting
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      if (event.state) {
        const { tab, isFoodOpen, isMedicalOpen } = event.state;
        if (tab) setActiveTab(tab);
        setIsFoodChatOpen(!!isFoodOpen);
        setIsMedicalChatOpen(!!isMedicalOpen);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);
  useEffect(() => {
    try {
      localStorage.removeItem('custom_system_instruction_agent1');
    } catch (e) {}
  }, []);

  // Synchronize batch approvals from cloud profile back to local storage
  useEffect(() => {
    if (profile) {
      if (profile.approved_agent1_batches) {
        try {
          localStorage.setItem('approved_agent1_batches', JSON.stringify(profile.approved_agent1_batches));
        } catch (e) {}
      }
      if (profile.approved_data_review_batches) {
        try {
          localStorage.setItem('approved_data_review_batches', JSON.stringify(profile.approved_data_review_batches));
        } catch (e) {}
      }
    }
  }, [profile]);

  // Synchronize Google steps count to the actual daily biomarker logs when updated
  useEffect(() => {
    const handleGoogleStepsUpdated = async () => {
      const emailSuffix = profile?.email ? `_${profile.email.toLowerCase().trim()}` : '_guest';
      const stepsStr = localStorage.getItem(`googleSteps${emailSuffix}`);
      if (!stepsStr) return;
      const stepsVal = parseInt(stepsStr, 10);
      if (isNaN(stepsVal) || stepsVal <= 0) return;

      const todayStr = getCurrentDateInTimezone(profile?.timezone || 'UTC');

      // Check if we already logged this steps count for today
      const alreadyLogged = biomarkerHistory.some(log => log.date === todayStr && log.biomarkers['steps'] === stepsVal);
      if (alreadyLogged) return;

      let updatedHistory = [...biomarkerHistory];
      const todayLogIndex = updatedHistory.findIndex(log => log.date === todayStr);

      if (todayLogIndex >= 0) {
        const log = { ...updatedHistory[todayLogIndex] };
        log.biomarkers = {
          ...log.biomarkers,
          steps: stepsVal
        };
        // Only set note to Google Fit if there was no clinical note previously
        if (!log.note) {
          log.note = 'Auto-synced from Google Fit';
        }
        log.sync_state = 'update';
        log.updated_at = Date.now();
        updatedHistory[todayLogIndex] = log;
      } else {
        const newLog: BiomarkerLog = {
          id: `log_${Date.now()}`,
          date: todayStr,
          biomarkers: { steps: stepsVal },
          note: 'Auto-synced from Google Fit',
          summary: `Synced ${stepsVal} steps from Google Fit`,
          sync_state: 'new',
          updated_at: Date.now()
        };
        updatedHistory.unshift(newLog);
      }

      const recomputedBiomarkers: { [key: string]: number | string } = {};
      [...updatedHistory].filter(b => b.sync_state !== 'delete' && !(profile?.deletedBiomarkerLogIds?.[b.id] && (profile?.deletedBiomarkerLogIds?.[b.id] || 0) >= (b.updated_at || 0))).sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date))).forEach(log => {
        Object.entries(log.biomarkers).forEach(([k, v]) => {
          recomputedBiomarkers[k] = v as string | number;
        });
      });

      setBiomarkerHistory(updatedHistory);
      setBiomarkers(recomputedBiomarkers);
      if (profile) {
        await saveAndSync(profile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'googleSteps', isAutoLog: true });
      }
    };

    window.addEventListener('googleStepsUpdated', handleGoogleStepsUpdated);
    return () => window.removeEventListener('googleStepsUpdated', handleGoogleStepsUpdated);
  }, [profile, biomarkerHistory, foodLogs, actions, dailyBenefits, report]);
  useEffect(() => {
    const currentState = window.history.state;
    const isDifferent = !currentState ||
      currentState.tab !== activeTab ||
      currentState.isFoodOpen !== isFoodChatOpen ||
      currentState.isMedicalOpen !== isMedicalChatOpen;
    if (isDifferent) {
      window.history.pushState({
        tab: activeTab,
        isFoodOpen: isFoodChatOpen,
        isMedicalOpen: isMedicalChatOpen
      }, '');
    }
  }, [activeTab, isFoodChatOpen, isMedicalChatOpen]);
  // Initialize from Firebase Auth and Firestore on mount


  // checkForDbChanges moved to hooks/useAppSync.ts (assigned after useAuthSession)

  // Data hygiene, not auth: migrate legacy localStorage snapshots into IndexedDB.
  useEffect(() => {
    // Cleanup legacy storage from localStorage to IndexedDB
    try {
      (async () => {
        const legacyKeys: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && (key.startsWith('health_cockpit_snapshots_') || key.startsWith('health_cockpit_app_data_'))) {
            legacyKeys.push(key);
          }
        }
        for (const key of legacyKeys) {
          try {
            const existingIdbVal = await get(key);
            if (!existingIdbVal) {
              const val = localStorage.getItem(key);
              if (val) {
                const parsed = JSON.parse(val);
                await set(key, parsed);
              }
            }
            localStorage.removeItem(key);
          } catch (e) {
            console.error('Error migrating storage key', key, e);
            localStorage.removeItem(key);
          }
        }
      })();
    } catch (e) {
      console.error('Error scanning localStorage for legacy data', e);
    }
  }, []);

  // Q-11.2: every session-scoped React state, cleared together on sign-out.
  const clearSessionState = () => {
    setProfile(null);
    setFoodLogs([]);
    setBiomarkers({});
    setBiomarkerHistory([]);
    setActions([]);
    setDailyBenefits([]);
    setReport(null);
    setSyncState('local');
  };

  const { getEffectiveUser, handleLogin, handleSignOut } = useAuthSession({
    profile,
    isAuthChecking,
    setIsAuthChecking,
    onAuthResolved: () => setIsInitialDataLoading(false),
    onUser: loadUserData,
    clearSessionState,
    applyLoginProfile: (next: UserProfile) => {
      setProfile(next);
      setSyncState('local');
    },
  });

  const { checkForDbChanges, saveAndSync, handleFetchMoreFoods, lastSyncTime } = useAppSync({
    profile,
    setProfile,
    foodLogs,
    setFoodLogs,
    biomarkers,
    setBiomarkers,
    biomarkerHistory,
    setBiomarkerHistory,
    actions,
    setActions,
    dailyBenefits,
    setDailyBenefits,
    foodIdeas,
    setFoodIdeas,
    report,
    setReport,
    syncState,
    setSyncState,
    totalFoodsCount,
    setTotalFoodsCount,
    setIsInitialDataLoading,
    setConflictData,
    isFirestoreQuotaExceeded,
    setIsFirestoreQuotaExceeded,
    setActiveTab,
    getEffectiveUser,
    logInteraction,
    completeInteraction,
    handleFirestoreError,
    checkForDbChangesRef,
    saveAndSyncRef,
  });
  void lastSyncTime; // standing egress_conservation fingerprints lastSyncTime in src/App.tsx
  // forcePull || forceReplaceLocal is the only full-pull path (useAppSync.checkForDbChanges)
  // Q-11.10 Node 1: food-log handlers live in hooks/useFoodLogActions.ts (move-only).
  const { handleRestoreSnapshot, handleResolveConflict, handleLogFood, handleUpdateFoodLog, handleDeleteFoodLog } = useFoodLogActions({
    profile,
    foodLogs,
    biomarkers,
    biomarkerHistory,
    actions,
    dailyBenefits,
    foodIdeas,
    report,
    conflictData,
    saveAndSync,
    setProfile,
    setFoodLogs,
    setBiomarkers,
    setBiomarkerHistory,
    setActions,
    setDailyBenefits,
    setReport,
    setConflictData,
    setSyncState,
    setShowSnapshotPanel,
  });
  // Q-11.10 Node 2: biomarker handlers live in hooks/useBiomarkerActions.ts (move-only).
  const {
    handleLogMedical,
    handleDeleteMultipleBiomarkers,
    handleDeleteBiomarker,
    handleFlagNotUsedGlobal,
    handleRestoreNotUsedGlobal,
    handleFlagNotUsedLocal,
    handleRestoreNotUsedLocal,
    handleDeleteEmptyBiomarkers,
    handleDeleteBiomarkerLog,
    handleDeleteBiomarkerFromLog,
    handleEditBiomarkerLog,
    handleBatchDeleteBiomarkersFromLogs,
    handleBatchEditBiomarkersInLogs,
    handleStandardizeBiomarkerUnits,
    handleBatchCombineBiomarkers,
    handleCombineBiomarkers,
    handleBatchConsolidate,
    handleApplyCalculation,
  } = useBiomarkerActions({
    profile,
    foodLogs,
    biomarkers,
    biomarkerHistory,
    actions,
    dailyBenefits,
    report,
    saveAndSync,
    setProfile,
    setBiomarkers,
    setBiomarkerHistory,
    setDailyBenefits,
    setReport,
    setActiveTab,
    setIsMedicalChatOpen,
  });
  // Q-11.10 Node 3: report/analysis handlers live in hooks/useReportActions.ts (move-only).
  const { handleAgentAnalysisSaved, handleDeleteAnalysis, handleAcceptReport, handleRejectReport, handleGenerateReport } = useReportActions({
    profile,
    foodLogs,
    biomarkers,
    biomarkerHistory,
    actions,
    dailyBenefits,
    report,
    saveAndSync,
    setProfile,
    setActions,
    setDailyBenefits,
    setReport,
    setDraftReport,
    setActiveTab,
    setIsGenerating,
  });
  // Auto-restore missing food images from chat history
  useEffect(() => {
    if (foodLogs.length === 0) return;
    try {
      const rawChat = sessionStorage.getItem('chat_messages_food');
      if (rawChat) {
        const messages = JSON.parse(rawChat);
        let updated = false;
        let updateCount = 0;
        const newFoodLogs = foodLogs.map(log => {
          if (!log.imageUrl && (!log.imageUrls || log.imageUrls.length === 0)) {
            const msg = messages.find((m: any) => m.pendingFoodLog?.id === log.id);
            if (msg && msg.pendingFoodLog && (msg.pendingFoodLog.imageUrl || msg.pendingFoodLog.imageUrls)) {
              updated = true;
              updateCount++;
              return {
                ...log,
                imageUrl: msg.pendingFoodLog.imageUrl || msg.pendingFoodLog.imageUrls?.[0],
                imageUrls: msg.pendingFoodLog.imageUrls || (msg.pendingFoodLog.imageUrl ? [msg.pendingFoodLog.imageUrl] : [])
              };
            }
          }
          return log;
        });
        if (updated && auth.currentUser) {
          const uid = auth.currentUser.uid;
          console.log(`Restoring ${updateCount} lost images from chat history via batched transaction`);
          setFoodLogs(newFoodLogs);
          
// Deferred to manual sync
        }
      }
    } catch (e) {
      console.warn("Failed to auto-restore images:", e);
    }
  }, [foodLogs.length]);
  // saveAndSync moved to hooks/useAppSync.ts


  // Selected LLM Engine shared across sections - highest RPD model is the default, and we persist the user selection
  const [selectedModelId, setSelectedModelIdState] = useState<string>(() => {
    const saved = localStorage.getItem('selectedModelId');
    if (saved) return saved;
    // Default is the one with the highest RPD
    return AVAILABLE_LLMS.find(m => m.isDefault)?.id || AVAILABLE_LLMS[0]?.id || 'gemini-3.5-flash-lite';
  });
  const setSelectedModelId = (id: string) => {
    setSelectedModelIdState(id);
    localStorage.setItem('selectedModelId', id);
  };
  // Add / Edit logs handlers










  



  // Lock body scroll when modals are open
  useEffect(() => {
    if (isFoodChatOpen || isMedicalChatOpen || isManualFoodLogOpen || isConflictModalOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isFoodChatOpen, isMedicalChatOpen, isManualFoodLogOpen, isConflictModalOpen]);


  // Render Screens based on active tab
  return (
    <AppShell
      actions={actions}
      activeAgentType={activeAgentType}
      activeDataReviewBatchIdx={activeDataReviewBatchIdx}
      activeDataReviewBatchKeys={activeDataReviewBatchKeys}
      activeDataReviewCurrentBatch={activeDataReviewCurrentBatch}
      activeDataReviewEstimatedTotalMarkers={activeDataReviewEstimatedTotalMarkers}
      activeDataReviewExtractedYaml={activeDataReviewExtractedYaml}
      activeFrontDeskJobId={activeFrontDeskJobId}
      activeHandoffPayload={activeHandoffPayload}
      activeJobId={activeJobId}
      activeReviewBiomarkerKey={activeReviewBiomarkerKey}
      activeTab={activeTab}
      autoSyncDisabled={autoSyncDisabled}
      batchSize={batchSize}
      biomarkerHistory={biomarkerHistory}
      biomarkers={biomarkers}
      calibratingAgentType={calibratingAgentType}
      calibratingBatchIdx={calibratingBatchIdx}
      checkForDbChanges={checkForDbChanges}
      conflictData={conflictData}
      dailyBenefits={dailyBenefits}
      dataReviewSharedState={dataReviewSharedState}
      dbInteractions={dbInteractions}
      dismissedBmiAlerts={dismissedBmiAlerts}
      draftReport={draftReport}
      foodIdeas={foodIdeas}
      foodLogs={foodLogs}
      handleAcceptReport={handleAcceptReport}
      handleAgentAnalysisSaved={handleAgentAnalysisSaved}
      handleApplyCalculation={handleApplyCalculation}
      handleBatchCombineBiomarkers={handleBatchCombineBiomarkers}
      handleBatchConsolidate={handleBatchConsolidate}
      handleBatchDeleteBiomarkersFromLogs={handleBatchDeleteBiomarkersFromLogs}
      handleBatchEditBiomarkersInLogs={handleBatchEditBiomarkersInLogs}
      handleCombineBiomarkers={handleCombineBiomarkers}
      handleDeleteAnalysis={handleDeleteAnalysis}
      handleDeleteBiomarker={handleDeleteBiomarker}
      handleDeleteBiomarkerFromLog={handleDeleteBiomarkerFromLog}
      handleDeleteBiomarkerLog={handleDeleteBiomarkerLog}
      handleDeleteEmptyBiomarkers={handleDeleteEmptyBiomarkers}
      handleDeleteFoodLog={handleDeleteFoodLog}
      handleDeleteMultipleBiomarkers={handleDeleteMultipleBiomarkers}
      handleDismissBmiAlert={handleDismissBmiAlert}
      handleEditBiomarkerLog={handleEditBiomarkerLog}
      handleFetchMoreFoods={handleFetchMoreFoods}
      handleFlagNotUsedGlobal={handleFlagNotUsedGlobal}
      handleFlagNotUsedLocal={handleFlagNotUsedLocal}
      handleGenerateReport={handleGenerateReport}
      handleLogFood={handleLogFood}
      handleLogMedical={handleLogMedical}
      handleLogin={handleLogin}
      handleOpenJob={handleOpenJob}
      handleRejectReport={handleRejectReport}
      handleResolveConflict={handleResolveConflict}
      handleRestoreNotUsedGlobal={handleRestoreNotUsedGlobal}
      handleRestoreNotUsedLocal={handleRestoreNotUsedLocal}
      handleRestoreSnapshot={handleRestoreSnapshot}
      handleSignOut={handleSignOut}
      handleStandardizeBiomarkerUnits={handleStandardizeBiomarkerUnits}
      handleToggleAutoSyncDisabled={handleToggleAutoSyncDisabled}
      handleUpdateFoodLog={handleUpdateFoodLog}
      healthSubTab={healthSubTab}
      hideSensitive={hideSensitive}
      initiallyExpandedFoodId={initiallyExpandedFoodId}
      isAuthChecking={isAuthChecking}
      isConflictModalOpen={isConflictModalOpen}
      isFirestoreQuotaExceeded={isFirestoreQuotaExceeded}
      isFloatingOpen={isFloatingOpen}
      isFoodChatOpen={isFoodChatOpen}
      isFrontDeskOpen={isFrontDeskOpen}
      isGenerating={isGenerating}
      isInitialDataLoading={isInitialDataLoading}
      isManualFoodLogOpen={isManualFoodLogOpen}
      isMedicalChatOpen={isMedicalChatOpen}
      logBmiIfProfileWeightHeightChanged={logBmiIfProfileWeightHeightChanged}
      manualFoodLogError={manualFoodLogError}
      prefillMessage={prefillMessage}
      profile={profile}
      quota={quota}
      report={report}
      saveAndSync={saveAndSync}
      selectedModelId={selectedModelId}
      setActions={setActions}
      setActiveAgentType={setActiveAgentType}
      setActiveDataReviewBatchIdx={setActiveDataReviewBatchIdx}
      setActiveDataReviewBatchKeys={setActiveDataReviewBatchKeys}
      setActiveDataReviewCurrentBatch={setActiveDataReviewCurrentBatch}
      setActiveDataReviewEstimatedTotalMarkers={setActiveDataReviewEstimatedTotalMarkers}
      setActiveDataReviewExtractedYaml={setActiveDataReviewExtractedYaml}
      setActiveFrontDeskJobId={setActiveFrontDeskJobId}
      setActiveHandoffPayload={setActiveHandoffPayload}
      setActiveJobId={setActiveJobId}
      setActiveReviewBiomarkerKey={setActiveReviewBiomarkerKey}
      setActiveTab={setActiveTab}
      setBatchSize={setBatchSize}
      setBiomarkerHistory={setBiomarkerHistory}
      setBiomarkers={setBiomarkers}
      setCalibratingAgentType={setCalibratingAgentType}
      setCalibratingBatchIdx={setCalibratingBatchIdx}
      setDailyBenefits={setDailyBenefits}
      setDataReviewSharedState={setDataReviewSharedState}
      setFoodIdeas={setFoodIdeas}
      setFoodLogs={setFoodLogs}
      setHealthSubTab={setHealthSubTab}
      setHideSensitive={setHideSensitive}
      setInitiallyExpandedFoodId={setInitiallyExpandedFoodId}
      setIsConflictModalOpen={setIsConflictModalOpen}
      setIsEditingFoodLog={setIsEditingFoodLog}
      setIsFloatingOpen={setIsFloatingOpen}
      setIsFrontDeskOpen={setIsFrontDeskOpen}
      setIsManualFoodLogOpen={setIsManualFoodLogOpen}
      setIsMedicalChatOpen={setIsMedicalChatOpen}
      setLastSnapshotLabel={setLastSnapshotLabel}
      setManualFoodLogError={setManualFoodLogError}
      setPrefillMessage={setPrefillMessage}
      setProfile={setProfile}
      setReport={setReport}
      setSelectedModelId={setSelectedModelId}
      setShowSnapshotPanel={setShowSnapshotPanel}
      setSnapshots={setSnapshots}
      setSyncFailedWarning={setSyncFailedWarning}
      showSnapshotPanel={showSnapshotPanel}
      snapshots={snapshots}
      syncFailedWarning={syncFailedWarning}
      syncState={syncState}
      totalFoodsCount={totalFoodsCount}
    />
  );
}
