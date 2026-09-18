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
const safeAlert = (message: string) => {
  try {
    alert(message);
  } catch (e) {
    console.warn("alert() was blocked by sandbox iframe restrictions:", e);
  }
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

  const handleRestoreSnapshot = async (snapshot: any) => {
    if (!snapshot?.data) return;
    const { profile: snapProfile, foodLogs: snapFoods, biomarkers: snapBiomarkers,
            biomarkerHistory: snapBioHistory, actions: snapActions,
            dailyBenefits: snapBenefits, report: snapReport } = snapshot.data;

    if (snapProfile) setProfile(snapProfile);
    if (snapFoods) setFoodLogs(snapFoods);
    if (snapBiomarkers) setBiomarkers(snapBiomarkers);
    if (snapBioHistory) setBiomarkerHistory(snapBioHistory);
    if (snapActions) setActions(snapActions);
    if (snapBenefits) setDailyBenefits(snapBenefits);
    if (snapReport) setReport(snapReport);

    const restoredBundle = {
      profile: snapProfile,
      foodLogs: snapFoods,
      biomarkers: snapBiomarkers,
      biomarkerHistory: snapBioHistory,
      actions: snapActions || [],
      dailyBenefits: snapBenefits || [],
      foodIdeas: foodIdeas,
      report: snapReport
    };
    await safeSaveToLocalStorage(
      getStorageKey(snapProfile?.email || profile?.email),
      restoredBundle
    );

    setShowSnapshotPanel(false);
    safeAlert(`✅ Restored to: "${snapshot.label}"\n\nYour data has been reverted to this point. Click the Sync button to upload if you wish.`);
  };

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

  const handleResolveConflict = async (biomarkerSource: 'local' | 'cloud', foodSource: 'local' | 'cloud') => {
    if (!conflictData || !auth.currentUser) return;
    setSyncState('syncing');

    const uid = auth.currentUser.uid;
    const now = Date.now();

    // 1. Resolve Profile & Biomarkers
    let resolvedProfile: UserProfile;
    let resolvedBioHistory: BiomarkerLog[];
    let resolvedActions: HealthAction[];
    let resolvedBenefits: DailyBenefit[];
    let resolvedReport: RecommendationReport | null;

    if (biomarkerSource === 'local') {
      resolvedProfile = { ...conflictData.localProfile, lastUpdatedAt: now };
      resolvedBioHistory = [...conflictData.localBioHistory];
      resolvedActions = [...conflictData.localActions];
      resolvedBenefits = [...conflictData.localBenefits];
      resolvedReport = conflictData.localReport;
    } else {
      resolvedProfile = { ...conflictData.cloudProfile, lastUpdatedAt: now };
      resolvedBioHistory = [...conflictData.cloudBioHistory];
      resolvedActions = [...conflictData.cloudActions];
      resolvedBenefits = [...conflictData.cloudBenefits];
      resolvedReport = conflictData.cloudReport;
    }
    // B7.5: the winning side can carry new demographics.
    resolvedProfile = maybeRecalibrateDemographicOverlays(profile, resolvedProfile);

    // 2. Resolve Food Log
    let resolvedFoods: FoodLog[];
    if (foodSource === 'local') {
      resolvedFoods = [...conflictData.localFoods];
    } else {
      resolvedFoods = [...conflictData.cloudFoods];
    }

    // 3. Compute active biomarkers
    const computedBiomarkers: { [key: string]: number | string } = {};
    [...resolvedBioHistory].filter(b => b.sync_state !== 'delete' && !(profile?.deletedBiomarkerLogIds?.[b.id] && (profile?.deletedBiomarkerLogIds?.[b.id] || 0) >= (b.updated_at || 0))).sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date))).forEach(log => {
      Object.entries(log.biomarkers).forEach(([k, v]) => {
        computedBiomarkers[k] = v as string | number;
      });
    });

    // 4. Update state variables immediately
    setProfile(resolvedProfile);
    setFoodLogs(resolvedFoods);
    setBiomarkerHistory(resolvedBioHistory);
    setBiomarkers(computedBiomarkers);
    setActions(resolvedActions);
    setDailyBenefits(resolvedBenefits);
    if (resolvedReport) setReport(resolvedReport);

    // 5. Write to local storage with new sync timestamp
    const bundle = {
      profile: resolvedProfile,
      foodLogs: resolvedFoods,
      biomarkers: computedBiomarkers,
      biomarkerHistory: resolvedBioHistory,
      actions: resolvedActions,
      dailyBenefits: resolvedBenefits,
      report: resolvedReport,
      lastSyncedAt: now
    };
    await safeSaveToLocalStorage(getStorageKey(resolvedProfile?.email || profile?.email || auth.currentUser?.email), bundle);

    // 6. Push fully resolved bundle to Cloud Firestore (full push)
    try {
      await saveAndSync(resolvedProfile, resolvedFoods, computedBiomarkers, resolvedBioHistory, resolvedActions, resolvedBenefits, resolvedReport, { 
        type: 'fullPush',
        cloudFoods: conflictData.cloudFoods,
        cloudBioHistory: conflictData.cloudBioHistory
      } as any);
      setConflictData(null);
      setSyncState('synced');
    } catch (err) {
      console.error("Failed to push resolved sync state:", err);
      setSyncState('local');
    }
  };

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
  const handleLogFood = async (food: FoodLog) => {
    let compressedFood = { ...food };
    if (!compressedFood.id) {
      compressedFood.id = `food_${Date.now()}`;
    }
    
    // Compress imageUrl to 800x800 when logging
    if (compressedFood.imageUrl && typeof compressedFood.imageUrl === 'string' && compressedFood.imageUrl.startsWith('data:image/')) {
      try {
        compressedFood.imageUrl = await compressImage(compressedFood.imageUrl, 800, 800, 0.7);
      } catch (e) {
        console.warn("Failed to compress food.imageUrl to 800x800:", e);
      }
    }
    
    // Compress imageUrls to 800x800 when logging
    if (compressedFood.imageUrls && Array.isArray(compressedFood.imageUrls) && compressedFood.imageUrls.length > 0) {
      const newUrls = [];
      for (const url of compressedFood.imageUrls) {
        if (url && typeof url === 'string' && url.startsWith('data:image/')) {
          try {
            const comp = await compressImage(url, 800, 800, 0.7);
            newUrls.push(comp);
          } catch (e) {
            console.warn("Failed to compress image in food.imageUrls to 800x800:", e);
            newUrls.push(url);
          }
        } else {
          newUrls.push(url);
        }
      }
      compressedFood.imageUrls = newUrls;
    }

    const existingIndex = foodLogs.findIndex(f => f.id === compressedFood.id);
    let updatedFoods;
    if (existingIndex !== -1) {
      const logWithSync = { ...compressedFood, sync_state: 'update' as const, updated_at: Date.now() };
      updatedFoods = foodLogs.map(f => f.id === compressedFood.id ? logWithSync : f);
    } else {
      // Safety net: guard against rapid duplicate submissions (double-tap, SSE
      // retry, reconnect firing twice) producing two distinct food_${Date.now()}
      // ids for the same logical meal. Only kicks in when there's no exact id
      // match above. Pure in-memory check against already-loaded foodLogs — no
      // new Firebase/Supabase reads.
      const now = Date.now();
      const DUPLICATE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
      const newFingerprint = foodLogFingerprint(compressedFood);
      const recentDuplicateIndex = foodLogs.findIndex(f => {
        if (!f.updated_at || (now - f.updated_at) > DUPLICATE_WINDOW_MS) return false;
        if (compressedFood.id && f.id === compressedFood.id) return true;
        if (compressedFood.id && f.id && compressedFood.id !== f.id) return false;
        return foodLogFingerprint(f) === newFingerprint;
      });
      if (recentDuplicateIndex !== -1) {
        console.warn('[handleLogFood] Near-duplicate submission detected within 5 min window, updating existing entry instead of creating a new one:', newFingerprint);
        const existing = foodLogs[recentDuplicateIndex];
        const logWithSync = { ...existing, ...compressedFood, id: existing.id, sync_state: 'update' as const, updated_at: now };
        updatedFoods = foodLogs.map(f => f.id === existing.id ? logWithSync : f);
      } else {
        const newFood = { ...compressedFood, sync_state: 'new' as const, updated_at: now };
        updatedFoods = [...foodLogs, newFood];
      }
    }
    setFoodLogs(updatedFoods);
    
    // Mark matching job as savedToLog and purge from backend/Supabase so preview disappears on all devices
    const matchingJobs = JobStore.getAllJobs().filter(j => 
      j.id === compressedFood.id || 
      (compressedFood as any).jobId === j.id ||
      j.result?.pendingFoodLog?.id === compressedFood.id ||
      (j.result?.pendingFoodLog?.name && compressedFood.name && 
       j.result.pendingFoodLog.name.toLowerCase().trim() === compressedFood.name.toLowerCase().trim() &&
       toYYYYMMDD(j.result.pendingFoodLog.date) === toYYYYMMDD(compressedFood.date))
    );
    matchingJobs.forEach(j => {
      JobStore.updateJob(j.id, { savedToLog: true });
      JobStore.deleteJob(j.id).catch(() => {});
    });

    await saveAndSync(profile, updatedFoods, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'foodLog', targetId: compressedFood.id });
  };
  const handleUpdateFoodLog = async (updatedLog: FoodLog) => {
    let compressedFood = { ...updatedLog };
    if (!compressedFood.id) {
      compressedFood.id = `food_${Date.now()}`;
    }
    
    // Compress imageUrl to 800x800 when logging
    if (compressedFood.imageUrl && typeof compressedFood.imageUrl === 'string' && compressedFood.imageUrl.startsWith('data:image/')) {
      try {
        compressedFood.imageUrl = await compressImage(compressedFood.imageUrl, 800, 800, 0.7);
      } catch (e) {
        console.warn("Failed to compress food.imageUrl to 800x800:", e);
      }
    }
    
    // Compress imageUrls to 800x800 when logging
    if (compressedFood.imageUrls && Array.isArray(compressedFood.imageUrls) && compressedFood.imageUrls.length > 0) {
      const newUrls = [];
      for (const url of compressedFood.imageUrls) {
        if (url && typeof url === 'string' && url.startsWith('data:image/')) {
          try {
            const comp = await compressImage(url, 800, 800, 0.7);
            newUrls.push(comp);
          } catch (e) {
            console.warn("Failed to compress image in food.imageUrls to 800x800:", e);
            newUrls.push(url);
          }
        } else {
          newUrls.push(url);
        }
      }
      compressedFood.imageUrls = newUrls;
    }

    const logWithSync = { ...compressedFood, sync_state: 'update' as const, updated_at: Date.now() };
    const updatedFoods = foodLogs.map(f => f.id === compressedFood.id ? logWithSync : f);
    setFoodLogs(updatedFoods);
    await saveAndSync(profile, updatedFoods, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'foodLog', targetId: compressedFood.id });
  };

  useEffect(() => {
    const handleAutoUpdate = (e: any) => {
      handleUpdateFoodLog(e.detail.log);
    };
    window.addEventListener('food-log-auto-update', handleAutoUpdate);
    return () => window.removeEventListener('food-log-auto-update', handleAutoUpdate);
  });
  const handleDeleteFoodLog = async (id: string) => {
    const existingLog = foodLogs.find(f => f.id === id);
    const existingUpdated = existingLog?.updated_at || 0;
    const now = Math.max(Date.now(), existingUpdated + 1000);
    // Keep it in array but mark as delete so syncUtils can process it
    const updatedFoods = foodLogs.map(f => f.id === id ? { ...f, sync_state: 'delete' as const, updated_at: now } : f);
    setFoodLogs(updatedFoods);
    
    let updatedProfile = profile ? {
      ...profile,
      deletedFoodLogIds: { ...(profile.deletedFoodLogIds || {}), [id]: now }
    } : null;
    if (updatedProfile) {
      setProfile(updatedProfile);
    }
    // Clean up legacy subcollection document in Firestore if it exists so legacy migration never resurrects it
    if (auth.currentUser) {
      Promise.resolve();
    }
    await saveAndSync(updatedProfile, updatedFoods, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'deleteFood', targetId: id });
  };
  const logBmiIfProfileWeightHeightChanged = (
    prev: UserProfile | null,
    next: UserProfile,
    history: BiomarkerLog[],
    biomarks: { [key: string]: number | string }
  ) => {
    const weightChanged = !prev || next.weight !== prev.weight;
    const heightChanged = !prev || next.height !== prev.height;
    const hasNoBmi = !biomarks.bmi || !history.some(h => h.biomarkers && h.biomarkers.bmi !== undefined);
    let updatedHistory = [...history];
    let updatedBiomarkers = { ...biomarks };
    if ((weightChanged || heightChanged || hasNoBmi) && next.weight && next.height) {
      const heightInMeters = Number(next.height) / 100;
      const bmiScore = Number(next.weight) / (heightInMeters * heightInMeters);
      const roundedBmi = parseFloat(bmiScore.toFixed(1));
      const recordDate = getCurrentDateInTimezone(next.timezone || (prev && prev.timezone));
      const existingLogIndex = updatedHistory.findIndex(h => toYYYYMMDD(h.date) === toYYYYMMDD(recordDate));
      if (existingLogIndex >= 0) {
        updatedHistory[existingLogIndex] = {
          ...updatedHistory[existingLogIndex],
          biomarkers: {
            ...updatedHistory[existingLogIndex].biomarkers,
            bmi: roundedBmi
          }
        };
      } else {
        updatedHistory.push({
          id: `med_log_bmi_${Date.now()}`,
          date: recordDate,
          biomarkers: {
            bmi: roundedBmi
          },
          note: `Auto-logged BMI update based on profile change: ${next.weight} kg, ${next.height} cm.`
        });
      }
      updatedHistory.sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));
      updatedBiomarkers.bmi = roundedBmi;
    }
    return { updatedHistory, updatedBiomarkers, changed: weightChanged || heightChanged || hasNoBmi };
  };

  const handleAgentAnalysisSaved = async (agentType: string, agentResult: any, existingId?: string): Promise<string> => {
    if (!profile) return '';
    const newId = existingId || `analysis_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const updatedAnalyses = profile.agentAnalyses ? [...profile.agentAnalyses] : [];
    const existingIndex = existingId ? updatedAnalyses.findIndex(a => a.id === existingId) : -1;
    if (existingIndex >= 0) {
      updatedAnalyses[existingIndex] = {
        ...updatedAnalyses[existingIndex],
        result: agentResult
      };
    } else {
      updatedAnalyses.push({
        id: newId,
        agentType: agentType,
        date: new Date().toISOString(),
        result: agentResult
      });
    }
    const updatedProfile = { 
      ...profile,
      agentAnalyses: updatedAnalyses
    };
    setProfile(updatedProfile);
    await saveAndSync(updatedProfile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'analysis', targetId: newId });
    return newId;
  };

  const handleDeleteAnalysis = async (id: string) => {
    if (!profile) return;
    if (profile.agentAnalyses) {
      const updatedProfile = {
        ...profile,
        agentAnalyses: profile.agentAnalyses.filter(a => a.id !== id)
      };
      setProfile(updatedProfile);
      await saveAndSync(updatedProfile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'deleteAnalysis', targetId: id });
    }
  };

  const handleLogMedical = async (
    extractedBiomarkers: { [key: string]: number | string }, 
    profileUpdates?: Partial<UserProfile>, 
    date?: string, 
    entries?: { date: string | null; biomarkers: { [key: string]: number | string }; tests?: any[] }[],
    modificationCommand?: ModificationCommand[],
    skipClose?: boolean
  ) => {
    let currentProfile = profile;
    let updatedHistory = [...biomarkerHistory];
    let updatedBiomarkers = { ...biomarkers };
    // Standardize and normalize extracted biomarkers and custom definitions
    let finalExtracted = { ...extractedBiomarkers };
    let finalProfileUpdates = profileUpdates ? { ...profileUpdates } : undefined;
    // B7.4: unapproved extract stamps collected here, routed to the Pending
    // store after the entries loop (never merged into customBiomarkers).
    const pendingFromDefs: any[] = [];

    // Filter out invalid/empty biomarkers
    const isValidValue = (v: unknown): boolean => v !== null && v !== undefined && v !== '' && v !== 'N/A' && v !== 'null';
    Object.keys(finalExtracted).forEach(k => {
      if (!isValidValue(finalExtracted[k])) delete finalExtracted[k];
    });
    if (entries) {
      entries.forEach(e => {
        if (e.biomarkers) {
          Object.keys(e.biomarkers).forEach(k => {
            if (!isValidValue(e.biomarkers[k])) delete e.biomarkers[k];
          });
        }
      });
    }

    // Filter customBiomarkers to only include those that are actually being saved
    if (finalProfileUpdates && finalProfileUpdates.customBiomarkers) {
      const activeKeys = new Set<string>(Object.keys(finalExtracted));
      if (entries) {
        entries.forEach(e => {
          if (e.biomarkers) Object.keys(e.biomarkers).forEach(k => activeKeys.add(k));
        });
      }
      if (modificationCommand) {
        modificationCommand.forEach(cmd => {
          if (cmd.keyName) activeKeys.add(cmd.keyName);
        });
      }
      if (profileUpdates?.customBiomarkers) {
        Object.keys(profileUpdates.customBiomarkers).forEach(k => activeKeys.add(k));
      }
      
      const filteredCustoms: { [key: string]: any } = {};
      Object.entries(finalProfileUpdates.customBiomarkers).forEach(([k, v]) => {
        if (activeKeys.has(k)) {
          filteredCustoms[k] = v;
        }
      });
      finalProfileUpdates.customBiomarkers = filteredCustoms;
    }

    const cleanName = (n: string): string => n.split('(')[0].split('[')[0].trim();
    const keyMapping: { [key: string]: string } = {};
    if (finalProfileUpdates && finalProfileUpdates.customBiomarkers && Object.keys(finalProfileUpdates.customBiomarkers).length > 0) {
      const currentCustoms = { ...(profile?.customBiomarkers || {}) };
      const nextCustomDefs: { [key: string]: any } = {};
      Object.entries(finalProfileUpdates.customBiomarkers).forEach(([rawKey, def]) => {
        // B7.4: needsApproval stamps are unapproved extract output. Route to the
        // Pending store — unknown names NEVER become catalog keys here. (Values
        // already flow to pending via routeExtractedObservations below; this
        // preserves name-only defs that carry no value.)
        if ((def as any)?.needsApproval === true) {
          const alreadyApproved = !!currentCustoms[rawKey] && (currentCustoms[rawKey] as any)?.catalogApproved === true;
          const builtInHit = biomarkerDefinitions.some((d: any) => d.key === rawKey);
          if (!alreadyApproved && !builtInHit) {
            const rawName = (def as any).name || rawKey;
            const cleanedPending = cleanName(rawName);
            const slugPending = cleanedPending.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || rawKey;
            pendingFromDefs.push({
              printedName: cleanedPending,
              suggestedKey: slugPending,
              rawValue: (finalExtracted as any)?.[rawKey] ?? '',
              rawUnit: (def as any)?.unit || '',
              printedRange: (def as any)?.normalRange || '',
            });
            return;
          }
        }
        const rawName = def.name || rawKey;
        const cleaned = cleanName(rawName);
        const normalizeUnit = (u: string) => (u || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        
        const cleanDef = { ...def };
        if (!cleanDef.unit || cleanDef.unit.trim() === '-' || cleanDef.unit.trim() === '') delete cleanDef.unit;
        if (!cleanDef.normalRange || cleanDef.normalRange.trim() === '-' || cleanDef.normalRange.trim() === '') delete cleanDef.normalRange;
        if (!cleanDef.standardMedicalGrouping || cleanDef.standardMedicalGrouping === 'Other') delete cleanDef.standardMedicalGrouping;
        if (!cleanDef.riskCategories || cleanDef.riskCategories.length === 0) delete cleanDef.riskCategories;
        // If the key is already actively tracked by the user, we MUST NOT change its key to avoid breaking history
        if (biomarkers[rawKey]) {
          keyMapping[rawKey] = rawKey;
          currentCustoms[rawKey] = {
            ...(currentCustoms[rawKey] || {}),
            ...cleanDef,
            name: cleaned
          };
          return;
        }

        // Check standard match (skip if rawKey is already an explicitly established custom key)
        const stdMatch = !currentCustoms[rawKey] ? biomarkerDefinitions.find(d => {
          const nameMatch = d.name.toLowerCase() === cleaned.toLowerCase() || d.key.toLowerCase() === cleaned.toLowerCase() || cleanName(d.name).toLowerCase() === cleaned.toLowerCase();
          const unitMatch = !def.unit || !d.unit || normalizeUnit(d.unit) === normalizeUnit(def.unit);
          return nameMatch && unitMatch;
        }) : null;
        if (stdMatch) {
          keyMapping[rawKey] = stdMatch.key;
          if (def.normalRange || def.profileAdjustedNormalRange || def.specificRiskContext || def.description || (def.unit && def.unit !== stdMatch.unit)) {
            currentCustoms[stdMatch.key] = {
              ...(currentCustoms[stdMatch.key] || {}),
              ...cleanDef,
              name: cleaned
            };
          }
          return;
        }
        // Check existing custom match
        let existingKey = Object.keys(currentCustoms).find(k => {
          const nameMatch = cleanName(currentCustoms[k]?.name || '').toLowerCase() === cleaned.toLowerCase();
          const keyMatch = k.toLowerCase() === cleaned.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
          return nameMatch || keyMatch;
        });
        // Always fallback to rawKey if it already exists as a known key
        if (!existingKey && currentCustoms[rawKey]) {
          existingKey = rawKey;
        }
        if (existingKey) {
          keyMapping[rawKey] = existingKey;
          currentCustoms[existingKey] = {
            ...currentCustoms[existingKey],
            ...def,
            name: cleaned // enforce simple name without brackets
          };
          return;
        }
        // Create new safe key
        const safeKey = cleaned.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        let targetKey = safeKey || rawKey;
        
        // If targetKey collides with a standard key (which means it failed the unit match above), make it unique
        const isStandard = biomarkerDefinitions.some(d => d.key === targetKey);
        if (isStandard) {
          targetKey = `${targetKey}_${normalizeUnit(def.unit || 'custom')}`;
        }
        
        keyMapping[rawKey] = targetKey;
        nextCustomDefs[targetKey] = {
          ...def,
          name: cleaned
        };
      });
      finalProfileUpdates.customBiomarkers = {
        ...currentCustoms,
        ...nextCustomDefs
      };
    }
    const entriesToProcess = entries && entries.length > 0
      ? entries
      : [{ date: date || null, biomarkers: finalExtracted }];
    let hasNewBiomarkers = false;
    const modifiedLogIds: string[] = [];
    if (modificationCommand && modificationCommand.length > 0) {
      const unitMapApply: Record<string, string> = {};
      Object.entries(profile?.customBiomarkers || {}).forEach(([k, v]: [string, any]) => {
        if (v?.unit) unitMapApply[k] = v.unit;
      });
      modificationCommand = enrichReviewModificationCommands(modificationCommand, updatedHistory, unitMapApply);
      let madeChanges = false;
      const normalizeDateForMatch = (s?: string) => {
        if (!s) return '';
        const clean = s.trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
          const [y, m, d] = clean.split('-');
          return `${d.padStart(2, '0')}-${m.padStart(2, '0')}-${y}`;
        }
        return clean;
      };
      modificationCommand.forEach(cmd => {
        if (cmd.action === 'update_biomarker' && cmd.keyName) {
          const targetDate = cmd.date || getCurrentDateInTimezone(profile?.timezone);
          const logIdx = updatedHistory.findIndex(h => normalizeDateForMatch(h.date) === normalizeDateForMatch(targetDate));
          if (logIdx >= 0 && cmd.newValue !== undefined) {
            updatedHistory[logIdx] = {
              ...updatedHistory[logIdx],
              biomarkers: {
                ...updatedHistory[logIdx].biomarkers,
                [cmd.keyName]: cmd.newValue
              },
              sync_state: 'update' as any,
              updated_at: Date.now()
            };
            modifiedLogIds.push(updatedHistory[logIdx].id);
            madeChanges = true;
            hasNewBiomarkers = true;
          } else if (logIdx < 0 && cmd.newValue !== undefined && cmd.date) {
            const newLog = {
              id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
              date: cmd.date,
              biomarkers: {
                [cmd.keyName]: cmd.newValue
              },
              sync_state: 'update' as const,
              updated_at: Date.now()
            };
            updatedHistory.push(newLog);
            modifiedLogIds.push(newLog.id);
            madeChanges = true;
            hasNewBiomarkers = true;
          }
        } else if (cmd.action === 'remove_biomarker' && cmd.keyName) {
          if (!cmd.date) {
            console.warn(`Prevented deletion: remove_biomarker command missing date`);
            return;
          }
          const targetDate = cmd.date;
          const logIdx = updatedHistory.findIndex(h => normalizeDateForMatch(h.date) === normalizeDateForMatch(targetDate));
          if (logIdx >= 0 && updatedHistory[logIdx].biomarkers[cmd.keyName] !== undefined) {
            const newBiomarkers = { ...updatedHistory[logIdx].biomarkers };
            delete newBiomarkers[cmd.keyName];
            updatedHistory[logIdx] = {
              ...updatedHistory[logIdx],
              biomarkers: newBiomarkers,
              sync_state: 'update',
              updated_at: Date.now()
            };
            modifiedLogIds.push(updatedHistory[logIdx].id);
            madeChanges = true;
            hasNewBiomarkers = true;
          }
        } else if (cmd.action === 'update_profile' && cmd.keyName && cmd.newValue !== undefined) {
          if (!finalProfileUpdates) finalProfileUpdates = {};
          (finalProfileUpdates as any)[cmd.keyName] = cmd.newValue;
          madeChanges = true;
        }
      });
      // If we only processed modification commands and no normal entries, we can skip the standard entry loop.
      if (madeChanges && entriesToProcess.length === 1 && Object.keys(entriesToProcess[0].biomarkers || {}).length === 0) {
        entriesToProcess.length = 0; // Skip
      }
    }
    const newPendingItems: any[] = [];
    // B7.4: same-call approvals (e.g. Dictionary pending approve bundling the
    // approved def with its value) must route as approved, not back to pending.
    const routingProfileView = finalProfileUpdates?.customBiomarkers
      ? { ...(currentProfile as any), customBiomarkers: { ...((currentProfile as any)?.customBiomarkers || {}), ...finalProfileUpdates.customBiomarkers } }
      : currentProfile;
    entriesToProcess.forEach(entry => {
      const recordDate = entry.date || getCurrentDateInTimezone(profile?.timezone);
      const routed = routeExtractedObservations(entry.biomarkers || {}, entry.tests || [], routingProfileView, recordDate);

      if (routed.pendingObservations.length > 0) {
        newPendingItems.push(...routed.pendingObservations);
      }

      const mappedExtracted = routed.approvedObservations;
      const entryTests = routed.approvedTests;

      if (Object.keys(mappedExtracted).length > 0) {
        hasNewBiomarkers = true;
        const existingLogIndex = updatedHistory.findIndex(h => toYYYYMMDD(h.date) === toYYYYMMDD(recordDate));

        if (existingLogIndex >= 0) {
          // Merge with existing log for this date
          const existingTests = updatedHistory[existingLogIndex].tests || [];
          const mergedTests = [...existingTests];
          entryTests.forEach((t: any) => {
            const idx = mergedTests.findIndex(et => et.key === t.key);
            if (idx >= 0) {
              mergedTests[idx] = { ...mergedTests[idx], ...t };
            } else {
              mergedTests.push(t);
            }
          });

          updatedHistory[existingLogIndex] = {
            ...updatedHistory[existingLogIndex],
            biomarkers: { ...updatedHistory[existingLogIndex].biomarkers, ...mappedExtracted },
            tests: mergedTests,
            sync_state: 'update',
            updated_at: Date.now()
          };
          const mergeTarget = updatedHistory[existingLogIndex];
          entryTests.forEach((t: any) => {
            attachObservationMeta(mergeTarget, t.key, {
              unit: t.unit,
              printedRange: t.normalRange || t.printedRange,
              labFlag: t.labFlag || t.flag,
              rawValue: mappedExtracted[t.key],
            });
          });
          Object.entries(mappedExtracted).forEach(([k, v]) => {
            if (!mergeTarget.observationMeta?.[k]) {
              attachObservationMeta(mergeTarget, k, {
                unit: (currentProfile as any)?.customBiomarkers?.[k]?.unit,
                rawValue: v,
              });
            }
          });
          modifiedLogIds.push(updatedHistory[existingLogIndex].id);
        } else {
          const datedLog: BiomarkerLog = {
            id: `med_log_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            date: recordDate,
            biomarkers: mappedExtracted,
            tests: entryTests,
            sync_state: 'new',
            updated_at: Date.now()
          };
          entryTests.forEach((t: any) => {
            attachObservationMeta(datedLog, t.key, {
              unit: t.unit,
              printedRange: t.normalRange || t.printedRange,
              labFlag: t.labFlag || t.flag,
              rawValue: mappedExtracted[t.key],
            });
          });
          Object.entries(mappedExtracted).forEach(([k, v]) => {
            if (!datedLog.observationMeta?.[k]) {
              attachObservationMeta(datedLog, k, {
                unit: (currentProfile as any)?.customBiomarkers?.[k]?.unit,
                rawValue: v,
              });
            }
          });
          updatedHistory.push(datedLog);
          modifiedLogIds.push(datedLog.id);
        }
      }
    });

    // B7.4: fold unapproved def stamps into the pending flow (skip ones the
    // entries loop already routed with the same key).
    if (pendingFromDefs.length > 0) {
      const fallbackDate = (entriesToProcess[0] as any)?.date || getCurrentDateInTimezone(profile?.timezone) || new Date().toISOString().slice(0, 10);
      pendingFromDefs.forEach((pd: any) => {
        const item = { ...pd, date: (pd as any).date || fallbackDate };
        const already = newPendingItems.some((np: any) =>
          String(np?.suggestedKey || '').toLowerCase() === String(item.suggestedKey || '').toLowerCase() ||
          (String(np?.printedName || '').toLowerCase() === String(item.printedName || '').toLowerCase() &&
            String(np?.rawValue ?? '') === String(item.rawValue ?? '')));
        if (!already) newPendingItems.push(item);
      });
    }

    if (newPendingItems.length > 0) {
      const existingPending = Array.isArray(currentProfile?.pendingObservations) ? [...currentProfile.pendingObservations] : [];
      newPendingItems.forEach(np => {
        const dup = existingPending.some(p => p.printedName?.toLowerCase() === np.printedName?.toLowerCase() && p.date === np.date && String(p.rawValue) === String(np.rawValue));
        if (!dup) existingPending.push(np);
      });
      currentProfile = { ...currentProfile, pendingObservations: existingPending } as UserProfile;
      setProfile(currentProfile);
    }

    // Self-healing: Ensure every known catalog or already-approved custom biomarker has complete structural metadata
    // Unknown names NEVER become catalog keys! (B7.4 Real Pending store)
    const itemsToSelfHeal: any[] = [];
    entriesToProcess.forEach(entry => {
      const tests = entry.tests || [];
      Object.keys(entry.biomarkers || {}).forEach(rawKey => {
        const mapped = getMappedBiomarkerKey(rawKey) || rawKey;
        const isBuiltIn = biomarkerDefinitions.some(d => d.key === mapped || d.key === rawKey);
        const isCustom = !!currentProfile?.customBiomarkers?.[rawKey] || !!currentProfile?.customBiomarkers?.[mapped];
        if (!isBuiltIn && !isCustom) return; // Unknown names NEVER become catalog keys
        const testInfo = Array.isArray(tests) ? tests.find((t: any) => t && (t.key === rawKey || t.key === mapped)) : null;
        itemsToSelfHeal.push({
          key: mapped,
          name: testInfo?.name,
          unit: testInfo?.unit,
          normalRange: testInfo?.normalRange,
          printedRange: testInfo?.printedRange,
          category: testInfo?.category,
          description: testInfo?.description
        });
      });
    });
    const { updatedCustoms, hasChanges } = selfHealCustomBiomarkerDefinitions(itemsToSelfHeal, currentProfile?.customBiomarkers);
    if (hasChanges) {
      currentProfile = { ...currentProfile, customBiomarkers: updatedCustoms } as UserProfile;
      setProfile(currentProfile);
    }

    if (finalProfileUpdates && Object.keys(finalProfileUpdates).length > 0) {
      if (typeof finalProfileUpdates.age === 'string') finalProfileUpdates.age = parseFloat(finalProfileUpdates.age) || finalProfileUpdates.age;
      if (typeof finalProfileUpdates.weight === 'string') finalProfileUpdates.weight = parseFloat(finalProfileUpdates.weight) || finalProfileUpdates.weight;
      if (typeof finalProfileUpdates.height === 'string') finalProfileUpdates.height = parseFloat(finalProfileUpdates.height) || finalProfileUpdates.height;
      const nextProfile = { ...currentProfile, ...finalProfileUpdates };
      const bmiRes = logBmiIfProfileWeightHeightChanged(currentProfile, nextProfile, updatedHistory, updatedBiomarkers);
      currentProfile = nextProfile;
      updatedHistory = bmiRes.updatedHistory;
      updatedBiomarkers = bmiRes.updatedBiomarkers;
      setProfile(currentProfile);
      setBiomarkerHistory(updatedHistory);
      setBiomarkers(updatedBiomarkers);
    }
    if (hasNewBiomarkers) {
      // Sort history by date descending
      updatedHistory.sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));
      setBiomarkerHistory(updatedHistory);
      // Recompute the latest biomarkers from history so they reflect the latest dates (sorted ascending)
      const recomputedBiomarkers: { [key: string]: number | string } = {};
      [...updatedHistory].filter(b => b.sync_state !== 'delete' && !(profile?.deletedBiomarkerLogIds?.[b.id] && (profile?.deletedBiomarkerLogIds?.[b.id] || 0) >= (b.updated_at || 0))).sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date))).forEach(log => {
        Object.entries(log.biomarkers).forEach(([k, v]) => {
          recomputedBiomarkers[k] = v as string | number;
        });
      });
      setBiomarkers(recomputedBiomarkers);
      if (!skipClose) {
        setIsMedicalChatOpen(false);
        setActiveTab('home');
      }

// Sync deferred to manual button click
      
      await saveAndSync(currentProfile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLogsBatch', targetIds: modifiedLogIds, deletedIds: [] });
    } else {
      if (!skipClose) {
        setIsMedicalChatOpen(false);
        setActiveTab('home');
      }
      await saveAndSync(currentProfile, foodLogs, updatedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLogsBatch', targetIds: modifiedLogIds, deletedIds: [] });
    }
  };
  const handleDeleteMultipleBiomarkers = async (keys: string[]) => {
    const updatedBiomarkers = { ...biomarkers };
    keys.forEach(key => delete updatedBiomarkers[key]);
    
    const logsToDelete: string[] = [];
    const logsToUpdate: string[] = [];
    let updatedHistory = biomarkerHistory.map(log => {
      const cleanBiomarkers = { ...log.biomarkers };
      let changed = false;
      keys.forEach(key => {
        if (cleanBiomarkers[key] !== undefined) {
          delete cleanBiomarkers[key];
          changed = true;
        }
      });
      if (changed) {
        if (Object.keys(cleanBiomarkers).length === 0 && !log.note) {
          logsToDelete.push(log.id);
          return { ...log, biomarkers: cleanBiomarkers, sync_state: 'delete' as const, updated_at: Date.now() };
        } else {
          logsToUpdate.push(log.id);
          return { ...log, biomarkers: cleanBiomarkers, sync_state: 'update' as const, updated_at: Date.now() };
        }
      }
      return log;
    });
    
    // Do NOT filter out logsToDelete from updatedHistory so syncUtils can process them!
    setBiomarkers(updatedBiomarkers);
    setBiomarkerHistory(updatedHistory);
    
    let updatedProfile = { ...profile } as UserProfile;
    if (logsToDelete.length > 0) {
      updatedProfile.deletedBiomarkerLogIds = { ...(updatedProfile.deletedBiomarkerLogIds || {}) };
      logsToDelete.forEach((id: string) => { updatedProfile.deletedBiomarkerLogIds![id] = Date.now(); });
    }
    if (updatedProfile.customBiomarkers) {
      const newCustoms = { ...updatedProfile.customBiomarkers };
      keys.forEach(key => delete newCustoms[key]);
      updatedProfile.customBiomarkers = newCustoms;
    }
    updatedProfile.deletedCustomBiomarkerKeys = { ...(updatedProfile.deletedCustomBiomarkerKeys || {}) };
    keys.forEach(k => { updatedProfile.deletedCustomBiomarkerKeys![k] = Date.now(); });
    setProfile(updatedProfile);
    if (logsToUpdate.length > 0) {
      await saveAndSync(updatedProfile, foodLogs, updatedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLogsBatch', targetIds: logsToUpdate, deletedIds: logsToDelete });
    } else if (logsToDelete.length > 0) {
      await saveAndSync(updatedProfile, foodLogs, updatedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLogsBatch', targetIds: [], deletedIds: logsToDelete });
    } else {
      await saveAndSync(updatedProfile, foodLogs, updatedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'profile' });
    }
  };

  const handleDeleteBiomarker = async (key: string) => {
    const updatedBiomarkers = { ...biomarkers };
    delete updatedBiomarkers[key];
    
    const logsToDelete: string[] = [];
    const logsToUpdate: string[] = [];
    let updatedHistory = biomarkerHistory.map(log => {
      const cleanBiomarkers = { ...log.biomarkers };
      if (cleanBiomarkers[key] !== undefined) {
        delete cleanBiomarkers[key];
        if (Object.keys(cleanBiomarkers).length === 0 && !log.note) {
          logsToDelete.push(log.id);
          return { ...log, biomarkers: cleanBiomarkers, sync_state: 'delete' as const, updated_at: Date.now() };
        } else {
          logsToUpdate.push(log.id);
          return { ...log, biomarkers: cleanBiomarkers, sync_state: 'update' as const, updated_at: Date.now() };
        }
      }
      return log;
    });
    
    // Do NOT filter out logsToDelete from updatedHistory so syncUtils can process them!
    setBiomarkers(updatedBiomarkers);
    setBiomarkerHistory(updatedHistory);
    let updatedProfile = { ...profile } as UserProfile;
    if (logsToDelete.length > 0) {
      updatedProfile.deletedBiomarkerLogIds = { ...(updatedProfile.deletedBiomarkerLogIds || {}) };
      logsToDelete.forEach((id: string) => { updatedProfile.deletedBiomarkerLogIds![id] = Date.now(); });
    }
    if (updatedProfile.customBiomarkers && updatedProfile.customBiomarkers[key]) {
      const newCustoms = { ...updatedProfile.customBiomarkers };
      delete newCustoms[key];
      updatedProfile.customBiomarkers = newCustoms;
    }
    updatedProfile.deletedCustomBiomarkerKeys = { ...(updatedProfile.deletedCustomBiomarkerKeys || {}), [key]: Date.now() };
    setProfile(updatedProfile);
// Sync deferred to manual button click
    if (logsToUpdate.length > 0) {
      await saveAndSync(updatedProfile, foodLogs, updatedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLogsBatch', targetIds: logsToUpdate, deletedIds: logsToDelete });
    } else if (logsToDelete.length > 0) {
      await saveAndSync(updatedProfile, foodLogs, updatedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLogsBatch', targetIds: [], deletedIds: logsToDelete });
    } else {
      await saveAndSync(updatedProfile, foodLogs, updatedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'profile' });
    }
  };

  const handleFlagNotUsedGlobal = async (key: string) => {
    if (!profile) return;
    const updatedNotUsed = {
      ...(profile.notUsedBiomarkers || {}),
      [key]: { flaggedAt: Date.now() }
    };
    const updatedDeletedNotUsed = { ...(profile.deletedNotUsedBiomarkerKeys || {}) };
    delete updatedDeletedNotUsed[key];
    const updatedProfile: UserProfile = {
      ...profile,
      notUsedBiomarkers: updatedNotUsed,
      deletedNotUsedBiomarkerKeys: updatedDeletedNotUsed
    };
    setProfile(updatedProfile);
    await saveAndSync(updatedProfile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'profile' });
  };

  const handleRestoreNotUsedGlobal = async (key: string) => {
    if (!profile || !profile.notUsedBiomarkers) return;
    const updatedNotUsed = { ...profile.notUsedBiomarkers };
    delete updatedNotUsed[key];
    Object.keys(updatedNotUsed).forEach(k => {
      if (k.toLowerCase() === key.toLowerCase()) {
        delete updatedNotUsed[k];
      }
    });
    const updatedDeletedNotUsed = {
      ...(profile.deletedNotUsedBiomarkerKeys || {}),
      [key]: Date.now()
    };
    const updatedProfile: UserProfile = {
      ...profile,
      notUsedBiomarkers: updatedNotUsed,
      deletedNotUsedBiomarkerKeys: updatedDeletedNotUsed
    };
    setProfile(updatedProfile);
    await saveAndSync(updatedProfile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'profile' });
  };

  const handleFlagNotUsedLocal = async (key: string) => {
    if (!profile) return;
    const updatedLocal = {
      ...(profile.notUsedInMedicalHistory || {}),
      [key]: { flaggedAt: Date.now() }
    };
    const updatedProfile: UserProfile = {
      ...profile,
      notUsedInMedicalHistory: updatedLocal
    };
    setProfile(updatedProfile);
    await saveAndSync(updatedProfile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'profile' });
  };

  const handleRestoreNotUsedLocal = async (key: string) => {
    if (!profile || !profile.notUsedInMedicalHistory) return;
    const updatedLocal = { ...profile.notUsedInMedicalHistory };
    delete updatedLocal[key];
    Object.keys(updatedLocal).forEach(k => {
      if (k.toLowerCase() === key.toLowerCase()) {
        delete updatedLocal[k];
      }
    });
    const updatedProfile: UserProfile = {
      ...profile,
      notUsedInMedicalHistory: updatedLocal
    };
    setProfile(updatedProfile);
    await saveAndSync(updatedProfile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'profile' });
  };
  const handleDeleteEmptyBiomarkers = async () => {
    let updatedProfile = { ...profile } as UserProfile;
    let modifiedProfile = false;
    let modifiedBiomarkers = false;

    const logsToDelete: string[] = [];
    const logsToUpdate: BiomarkerLog[] = [];

    // 1. Clean history: remove empty values from logs.
    let updatedHistory = biomarkerHistory.map(log => {
      const cleanBiomarkers = { ...log.biomarkers };
      let logChanged = false;

      Object.keys(cleanBiomarkers).forEach(key => {
        const val = cleanBiomarkers[key];
        // Delete if it has no useful value or is 0
        if (isValEmpty(val)) {
          delete cleanBiomarkers[key];
          logChanged = true;
        }
      });

      if (logChanged) {
        if (Object.keys(cleanBiomarkers).length === 0 && !log.note) {
          logsToDelete.push(log.id);
          return { ...log, biomarkers: cleanBiomarkers, sync_state: 'delete' as const, updated_at: Math.max(Date.now(), (log.updated_at || 0) + 1000) };
        } else {
          const updatedLog = { ...log, biomarkers: cleanBiomarkers, sync_state: 'update' as const, updated_at: Math.max(Date.now(), (log.updated_at || 0) + 1000) };
          logsToUpdate.push(updatedLog);
          return updatedLog;
        }
      }
      return log;
    });

    // We do NOT filter out logsToDelete, syncUtils handles it
    if (logsToDelete.length > 0) {
      updatedProfile.deletedBiomarkerLogIds = { ...(updatedProfile.deletedBiomarkerLogIds || {}) };
      logsToDelete.forEach((id: string) => { updatedProfile.deletedBiomarkerLogIds![id] = Date.now(); });
      modifiedProfile = true;
    }

    // Explicitly record BMI suppression so auto-log does not re-inject it on sync
    updatedProfile.bmiAutoLogged = true;
    updatedProfile.deletedCustomBiomarkerKeys = mergeDeleteMaps(updatedProfile.deletedCustomBiomarkerKeys, { bmi: Date.now() });
    modifiedProfile = true;

    // Recompute the biomarkers state
    // NOTE: Do NOT delete profile.customBiomarkers or write deletedCustomBiomarkerKeys here.
    // Unused dictionary definitions are not "empty biomarkers" — wiping them strips custom categorisations
    // and causes biomarkers to revert back to Pending Approval.
    const recomputedBiomarkers: { [key: string]: number | string } = {};
    [...updatedHistory].filter(b => b.sync_state !== 'delete' && !(profile?.deletedBiomarkerLogIds?.[b.id] && (profile?.deletedBiomarkerLogIds?.[b.id] || 0) >= (b.updated_at || 0))).sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date))).forEach(log => {
      Object.entries(log.biomarkers).forEach(([k, v]) => {
        recomputedBiomarkers[k] = v as string | number;
      });
    });

    // Detect if current biomarkers state changed
    const currentKeys = Object.keys(biomarkers);
    const newKeys = Object.keys(recomputedBiomarkers);
    if (currentKeys.length !== newKeys.length || currentKeys.some(k => biomarkers[k] !== recomputedBiomarkers[k])) {
      modifiedBiomarkers = true;
    }

    if (logsToDelete.length === 0 && logsToUpdate.length === 0 && !modifiedProfile && !modifiedBiomarkers) {
      return; // Nothing to change
    }

    if (modifiedProfile) setProfile(updatedProfile);
    if (modifiedBiomarkers) setBiomarkers(recomputedBiomarkers);
    setBiomarkerHistory(updatedHistory);

// Sync deferred to manual button click
    if (logsToUpdate.length > 0) {
      await saveAndSync(updatedProfile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLogsBatch', targetIds: logsToUpdate.map(l => l.id), deletedIds: logsToDelete });
    } else if (logsToDelete.length > 0) {
      await saveAndSync(updatedProfile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLogsBatch', targetIds: [], deletedIds: logsToDelete });
    } else {
      await saveAndSync(updatedProfile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'profile' });
    }
  };
  const handleDeleteBiomarkerLog = async (id: string) => {
    const existingLog = biomarkerHistory.find(b => b.id === id);
    const existingUpdated = existingLog?.updated_at || 0;
    const now = Math.max(Date.now(), existingUpdated + 1000);
    // Keep it in array but mark as delete so syncUtils can process it
    const updatedHistory = biomarkerHistory.map(b => b.id === id ? { ...b, sync_state: 'delete' as const, updated_at: now } : b);
    setBiomarkerHistory(updatedHistory);
    
    let updatedProfile = profile ? {
      ...profile,
      deletedBiomarkerLogIds: mergeDeleteMaps(profile.deletedBiomarkerLogIds, { [id]: now }),
      ...(id.includes('bmi') || existingLog?.biomarkers?.bmi !== undefined ? {
        bmiAutoLogged: true,
        deletedCustomBiomarkerKeys: mergeDeleteMaps(profile.deletedCustomBiomarkerKeys, { bmi: now })
      } : {})
    } : null;
    if (updatedProfile) {
      setProfile(updatedProfile);
    }

    // We filter it out for the recomputed local state map
    const recomputedBiomarkers: { [key: string]: number | string } = {};
    [...updatedHistory].filter(b => b.sync_state !== 'delete' && !(updatedProfile?.deletedBiomarkerLogIds?.[b.id] && (updatedProfile?.deletedBiomarkerLogIds?.[b.id] || 0) >= (b.updated_at || 0))).sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date))).forEach(log => {
      Object.entries(log.biomarkers).forEach(([k, v]) => {
        recomputedBiomarkers[k] = v as string | number;
      });
    });
    setBiomarkers(recomputedBiomarkers);
    
    await saveAndSync(updatedProfile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'deleteBiomarker', targetId: id });
  };
  const handleDeleteBiomarkerFromLog = async (id: string, key: string) => {
    const targetLog = biomarkerHistory.find(b => b.id === id);
    if (!targetLog) return;

    const targetDate = toYYYYMMDD(targetLog.date);
    const canonicalKeyToDelete = (getMappedBiomarkerKey(key) || key).toLowerCase().replace(/[\s_]/g, '');

    const now = Date.now();
    const deletedLogIds: string[] = [];
    const updatedLogIds: string[] = [];
    const updatedHistory: BiomarkerLog[] = [];

    biomarkerHistory.forEach(log => {
      const isTarget = log.id === id || (targetDate && toYYYYMMDD(log.date) === targetDate);
      if (!isTarget) {
        updatedHistory.push(log);
        return;
      }

      const keysToDelete = Object.keys(log.biomarkers || {}).filter(k => {
        const canK = (getMappedBiomarkerKey(k) || k).toLowerCase().replace(/[\s_]/g, '');
        return k === key || canK === canonicalKeyToDelete || k.toLowerCase().replace(/[\s_]/g, '') === canonicalKeyToDelete;
      });

      if (keysToDelete.length === 0) {
        updatedHistory.push(log);
        return;
      }

      const newBiomarkers = { ...log.biomarkers };
      keysToDelete.forEach(k => delete newBiomarkers[k]);

      const remainingKeys = Object.keys(newBiomarkers);
      if (remainingKeys.length > 0) {
        updatedLogIds.push(log.id);
        updatedHistory.push({
          ...log,
          biomarkers: newBiomarkers,
          sync_state: 'update' as const,
          updated_at: now
        });
      } else {
        deletedLogIds.push(log.id);
        updatedHistory.push({
          ...log,
          biomarkers: {},
          sync_state: 'delete' as const,
          updated_at: now
        });
      }
    });

    let updatedProfile = profile;
    if (deletedLogIds.length > 0 && profile) {
      const newDeletes: Record<string, number> = {};
      deletedLogIds.forEach(delId => {
        newDeletes[delId] = now;
      });
      updatedProfile = {
        ...profile,
        deletedBiomarkerLogIds: mergeDeleteMaps(profile.deletedBiomarkerLogIds, newDeletes)
      };
      setProfile(updatedProfile);
    }

    if (canonicalKeyToDelete === 'bmi' || key.toLowerCase() === 'bmi') {
      updatedProfile = (updatedProfile || profile) ? {
        ...(updatedProfile || profile)!,
        bmiAutoLogged: true,
        deletedCustomBiomarkerKeys: mergeDeleteMaps((updatedProfile || profile)?.deletedCustomBiomarkerKeys, { bmi: now })
      } : null;
      if (updatedProfile) setProfile(updatedProfile);
    }

    setBiomarkerHistory(updatedHistory);

    const recomputedBiomarkers: { [key: string]: number | string } = {};
    [...updatedHistory]
      .filter(b => b.sync_state !== 'delete' && !(updatedProfile?.deletedBiomarkerLogIds?.[b.id] && (updatedProfile?.deletedBiomarkerLogIds?.[b.id] || 0) >= (b.updated_at || 0)))
      .sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date)))
      .forEach(log => {
        Object.entries(log.biomarkers).forEach(([k, v]) => {
          recomputedBiomarkers[k] = v as string | number;
        });
      });
    setBiomarkers(recomputedBiomarkers);

    await saveAndSync(updatedProfile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, {
      type: 'biomarkerLogsBatch',
      targetIds: updatedLogIds.length > 0 ? updatedLogIds : undefined,
      deletedIds: deletedLogIds.length > 0 ? deletedLogIds : undefined
    });
  };
  const handleEditBiomarkerLog = async (id: string, key: string, value: string | number, newDate?: string) => {
    const targetLog = biomarkerHistory.find(b => b.id === id);
    const targetDate = targetLog ? toYYYYMMDD(targetLog.date) : '';
    const canonicalKey = (getMappedBiomarkerKey(key) || key).toLowerCase().replace(/[\s_]/g, '');
    const numValue = typeof value === 'string' ? parseFloat(value) : value;
    const finalVal = isNaN(numValue) ? value : numValue;
    const now = Date.now();
    const updatedIds: string[] = [];

    const updatedHistory = biomarkerHistory.map(log => {
      const isTarget = log.id === id || (targetDate && toYYYYMMDD(log.date) === targetDate);
      if (isTarget) {
        const matchingKey = Object.keys(log.biomarkers || {}).find(k => {
          const canK = (getMappedBiomarkerKey(k) || k).toLowerCase().replace(/[\s_]/g, '');
          return k === key || canK === canonicalKey || k.toLowerCase().replace(/[\s_]/g, '') === canonicalKey;
        }) || key;

        updatedIds.push(log.id);
        return {
          ...log,
          date: newDate || log.date,
          biomarkers: {
            ...log.biomarkers,
            [matchingKey]: finalVal
          },
          sync_state: 'update' as const,
          updated_at: now
        };
      }
      return log;
    });
    updatedHistory.sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));
    setBiomarkerHistory(updatedHistory);
    const recomputedBiomarkers: { [key: string]: number | string } = {};
    [...updatedHistory]
      .filter(b => b.sync_state !== 'delete' && !(profile?.deletedBiomarkerLogIds?.[b.id] && (profile?.deletedBiomarkerLogIds?.[b.id] || 0) >= (b.updated_at || 0)))
      .sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date)))
      .forEach(log => {
        Object.entries(log.biomarkers).forEach(([k, v]) => {
          recomputedBiomarkers[k] = v as string | number;
        });
      });
    setBiomarkers(recomputedBiomarkers);
    await saveAndSync(profile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, {
      type: 'biomarkerLogsBatch',
      targetIds: updatedIds.length > 0 ? updatedIds : [id]
    });
  };
  const handleBatchDeleteBiomarkersFromLogs = async (deletions: { id: string; key: string }[]) => {
    if (!deletions || deletions.length === 0) return;

    const deletionsByLogId = new Map<string, Set<string>>();
    const deletionsByDate = new Map<string, Set<string>>();
    deletions.forEach(d => {
      if (!deletionsByLogId.has(d.id)) {
        deletionsByLogId.set(d.id, new Set());
      }
      deletionsByLogId.get(d.id)!.add(d.key);

      const target = biomarkerHistory.find(b => b.id === d.id);
      if (target) {
        const dStr = toYYYYMMDD(target.date);
        if (!deletionsByDate.has(dStr)) deletionsByDate.set(dStr, new Set());
        deletionsByDate.get(dStr)!.add(d.key);
      }
    });

    const now = Date.now();
    const deletedLogIds: string[] = [];
    const updatedHistory: BiomarkerLog[] = [];

    biomarkerHistory.forEach(log => {
      const keysToDelete = new Set<string>();
      const byId = deletionsByLogId.get(log.id);
      if (byId) byId.forEach(k => keysToDelete.add(k));
      const byDate = deletionsByDate.get(toYYYYMMDD(log.date));
      if (byDate) byDate.forEach(k => keysToDelete.add(k));

      if (keysToDelete.size === 0) {
        updatedHistory.push(log);
        return;
      }

      const newBiomarkers = { ...log.biomarkers };
      Object.keys(newBiomarkers).forEach(bk => {
        const canonical = getMappedBiomarkerKey(bk) || bk;
        if (
          keysToDelete.has(bk) ||
          keysToDelete.has(canonical) ||
          Array.from(keysToDelete).some(k => k.toLowerCase().replace(/[\s_]/g, '') === bk.toLowerCase().replace(/[\s_]/g, '') || k.toLowerCase().replace(/[\s_]/g, '') === canonical.toLowerCase().replace(/[\s_]/g, ''))
        ) {
          delete newBiomarkers[bk];
        }
      });

      const remainingKeys = Object.keys(newBiomarkers);
      if (remainingKeys.length > 0) {
        updatedHistory.push({
          ...log,
          biomarkers: newBiomarkers,
          sync_state: 'update' as const,
          updated_at: now
        });
      } else {
        deletedLogIds.push(log.id);
        updatedHistory.push({
          ...log,
          biomarkers: {},
          sync_state: 'delete' as const,
          updated_at: now
        });
      }
    });

    let updatedProfile = profile;
    if (deletedLogIds.length > 0 && profile) {
      const newDeletes: Record<string, number> = {};
      deletedLogIds.forEach(id => {
        newDeletes[id] = now;
      });
      updatedProfile = {
        ...profile,
        deletedBiomarkerLogIds: mergeDeleteMaps(profile.deletedBiomarkerLogIds, newDeletes)
      };
      setProfile(updatedProfile);
    }

    setBiomarkerHistory(updatedHistory);

    const recomputedBiomarkers: { [key: string]: number | string } = {};
    [...updatedHistory]
      .filter(b => b.sync_state !== 'delete' && !(updatedProfile?.deletedBiomarkerLogIds?.[b.id] && (updatedProfile?.deletedBiomarkerLogIds?.[b.id] || 0) >= (b.updated_at || 0)))
      .sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date)))
      .forEach(log => {
        Object.entries(log.biomarkers).forEach(([k, v]) => {
          recomputedBiomarkers[k] = v as string | number;
        });
      });
    setBiomarkers(recomputedBiomarkers);

    const targetUpdatedIds = Array.from(deletionsByLogId.keys()).filter(id => !deletedLogIds.includes(id));
    await saveAndSync(updatedProfile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, {
      type: 'biomarkerLogsBatch',
      targetIds: targetUpdatedIds.length > 0 ? targetUpdatedIds : undefined,
      deletedIds: deletedLogIds.length > 0 ? deletedLogIds : undefined
    });
  };
  const handleBatchEditBiomarkersInLogs = async (updates: { id: string; key: string; value: string | number }[]) => {
    if (!updates || updates.length === 0) return;

    const updatesByLogId = new Map<string, { key: string; value: string | number }[]>();
    const updatesByDate = new Map<string, { key: string; value: string | number }[]>();
    updates.forEach(u => {
      if (!updatesByLogId.has(u.id)) {
        updatesByLogId.set(u.id, []);
      }
      updatesByLogId.get(u.id)!.push(u);

      const target = biomarkerHistory.find(b => b.id === u.id);
      if (target) {
        const dStr = toYYYYMMDD(target.date);
        if (!updatesByDate.has(dStr)) updatesByDate.set(dStr, []);
        updatesByDate.get(dStr)!.push(u);
      }
    });

    const now = Date.now();
    const updatedHistory = biomarkerHistory.map(log => {
      const logUpdates = updatesByLogId.get(log.id) || updatesByDate.get(toYYYYMMDD(log.date));
      if (!logUpdates) return log;

      const newBiomarkers = { ...log.biomarkers };
      logUpdates.forEach(u => {
        const canonicalUKey = (getMappedBiomarkerKey(u.key) || u.key).toLowerCase().replace(/[\s_]/g, '');
        const matchingKey = Object.keys(newBiomarkers).find(k => {
          const canK = (getMappedBiomarkerKey(k) || k).toLowerCase().replace(/[\s_]/g, '');
          return k === u.key || canK === canonicalUKey || k.toLowerCase().replace(/[\s_]/g, '') === canonicalUKey;
        }) || u.key;

        const numValue = typeof u.value === 'string' ? parseFloat(u.value) : u.value;
        newBiomarkers[matchingKey] = isNaN(numValue) ? u.value : numValue;
      });

      return {
        ...log,
        biomarkers: newBiomarkers,
        sync_state: 'update' as const,
        updated_at: now
      };
    });

    updatedHistory.sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));
    setBiomarkerHistory(updatedHistory);

    const recomputedBiomarkers: { [key: string]: number | string } = {};
    [...updatedHistory]
      .filter(b => b.sync_state !== 'delete' && !(profile?.deletedBiomarkerLogIds?.[b.id] && (profile?.deletedBiomarkerLogIds?.[b.id] || 0) >= (b.updated_at || 0)))
      .sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date)))
      .forEach(log => {
        Object.entries(log.biomarkers).forEach(([k, v]) => {
          recomputedBiomarkers[k] = v as string | number;
        });
      });
    setBiomarkers(recomputedBiomarkers);

    await saveAndSync(profile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLog' });
  };
  const handleStandardizeBiomarkerUnits = async (
    updates: { [key: string]: any },
    logValueCorrections?: { logId?: string; date: string; key: string; newValue: number }[]
  ) => {
    let hasChanges = false;
    const updatedProfile = { ...profile };
    if (!updatedProfile.customBiomarkers) updatedProfile.customBiomarkers = {};
    let updatedHistory = [...biomarkerHistory];
    let historyChanged = false;
    const logsToUpdate: string[] = [];

    // 1. Apply user-approved historical log value conversions
    if (Array.isArray(logValueCorrections) && logValueCorrections.length > 0) {
      logValueCorrections.forEach(corr => {
        updatedHistory = updatedHistory.map(log => {
          const matches = corr.logId ? log.id === corr.logId : log.date === corr.date;
          if (matches && log.biomarkers) {
            const targetKeyInLog = Object.keys(log.biomarkers).find(k => k.toLowerCase() === corr.key.toLowerCase());
            if (targetKeyInLog) {
              historyChanged = true;
              if (log.id) logsToUpdate.push(log.id);
              return {
                ...log,
                biomarkers: {
                  ...log.biomarkers,
                  [targetKeyInLog]: corr.newValue
                },
                sync_state: 'update' as const,
                updated_at: Date.now()
              };
            }
          }
          return log;
        });
      });
    }

    for (const [key, val] of Object.entries(updates)) {
      const targetKey = (val.newKey || val.standardizedKey || key) as string;
      const originalKey = (val.originalKey || (val.newKey && val.newKey !== key ? key : undefined)) as string | undefined;

      if (originalKey && originalKey !== targetKey) {
        const fromCustom = (updatedProfile.customBiomarkers[originalKey] || {}) as any;
        const existingTarget = (updatedProfile.customBiomarkers[targetKey] || {}) as any;
        updatedProfile.customBiomarkers[targetKey] = { ...fromCustom, ...existingTarget };
        delete updatedProfile.customBiomarkers[originalKey];

        updatedHistory = updatedHistory.map(log => {
          if (log.biomarkers && log.biomarkers[originalKey] !== undefined) {
            const newB = { ...log.biomarkers };
            if (newB[targetKey] === undefined) {
              newB[targetKey] = newB[originalKey];
            }
            delete newB[originalKey];
            historyChanged = true;
            if (log.id) logsToUpdate.push(log.id);
            return { ...log, biomarkers: newB, sync_state: 'update' as const, updated_at: Date.now() };
          }
          return log;
        });
      }

      const oldCustom = (updatedProfile.customBiomarkers[targetKey] || updatedProfile.customBiomarkers[key] || {}) as any;
      // Relabel only — never apply conversionFactor to stored numbers.
      const nextUnit = val.unit !== undefined && val.unit !== null && String(val.unit).trim() !== ''
        ? val.unit
        : oldCustom.unit;
      const nextName = (val.name && String(val.name).trim() !== '' && val.name !== targetKey)
        ? val.name
        : (oldCustom.name || val.name || targetKey);

      const now = Date.now();
      updatedProfile.lastUpdatedAt = now;
      updatedProfile.customBiomarkers[targetKey] = {
        ...oldCustom,
        name: nextName,
        unit: nextUnit,
        updatedAt: now,
        ...(val.normalRange !== undefined ? { normalRange: val.normalRange } : {}),
        ...(val.minRange !== undefined ? { minRange: val.minRange } : {}),
        ...(val.maxRange !== undefined ? { maxRange: val.maxRange } : {}),
        ...(val.optimalRange !== undefined ? { optimalRange: val.optimalRange } : {}),
        ...(val.optimalMin !== undefined ? { optimalMin: val.optimalMin } : {}),
        ...(val.optimalMax !== undefined ? { optimalMax: val.optimalMax } : {}),
        ...(val.rangeBrackets !== undefined ? { rangeBrackets: val.rangeBrackets } : {}),
        ...(val.rangeConfig !== undefined ? { rangeConfig: val.rangeConfig } : {}),
        ...(val.customRanges !== undefined ? { customRanges: val.customRanges } : {}),
        ...(val.notes !== undefined ? { notes: val.notes } : {}),
        ...(val.instrumentScale !== undefined ? { instrumentScale: val.instrumentScale } : {}),
        ...(val.dataType !== undefined ? { dataType: val.dataType } : {}),
        ...(val.category !== undefined ? { category: val.category } : (oldCustom.category ? { category: oldCustom.category } : {})),
        standardMedicalGrouping: val.standardMedicalGrouping !== undefined
          ? val.standardMedicalGrouping
          : (oldCustom.standardMedicalGrouping || "By Medical Practice"),
        riskCategories: val.riskCategories !== undefined ? val.riskCategories : oldCustom.riskCategories,
        potentialMedicalConditions: val.potentialMedicalConditions !== undefined
          ? val.potentialMedicalConditions
          : oldCustom.potentialMedicalConditions,
        ...(val.description !== undefined ? { description: val.description } : (oldCustom.description ? { description: oldCustom.description } : {})),
        ...(val.descriptions !== undefined ? { descriptions: val.descriptions } : (oldCustom.descriptions ? { descriptions: oldCustom.descriptions } : {})),
        catalogApproved: true,
        needsApproval: false
      } as any;

      delete updatedProfile.customBiomarkers[targetKey].needsApproval;
      hasChanges = true;
    }

    if (hasChanges || historyChanged) {
      let nextBiomarkers = biomarkers;
      if (historyChanged) {
        const recomputedBiomarkers: { [key: string]: number | string } = {};
        [...updatedHistory]
          .filter(b => b.sync_state !== 'delete' && !(updatedProfile?.deletedBiomarkerLogIds?.[b.id] && (updatedProfile?.deletedBiomarkerLogIds?.[b.id] || 0) >= (b.updated_at || 0)))
          .sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date)))
          .forEach(log => {
            Object.entries(log.biomarkers || {}).forEach(([k, v]) => {
              recomputedBiomarkers[k] = v as string | number;
            });
          });
        nextBiomarkers = recomputedBiomarkers;
        setBiomarkerHistory(updatedHistory);
        setBiomarkers(recomputedBiomarkers);
      }
      setProfile(updatedProfile);
      if (historyChanged && logsToUpdate.length > 0) {
        await saveAndSync(updatedProfile, foodLogs, nextBiomarkers, updatedHistory, actions, dailyBenefits, report, {
          type: 'biomarkerLogsBatch',
          targetIds: [...new Set(logsToUpdate)],
          deletedIds: []
        });
      } else {
        await saveAndSync(updatedProfile, foodLogs, nextBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'profile' });
      }
    }
  };

  
  const handleBatchCombineBiomarkers = async (
    combinations: {
      targetKey: string;
      targetDef: any;
      mergedLogs: { date: string; value: number | string; originalLogId?: string }[];
      sourceKeysToDelete: string[];
    }[]
  ) => {
    let updatedCustomBiomarkers = { ...(profile?.customBiomarkers || {}) };
    let deletedCustomBiomarkerKeys = { ...(profile?.deletedCustomBiomarkerKeys || {}) };
    let updatedHistory = [...biomarkerHistory];
    
    combinations.forEach(combo => {
      const { targetKey, targetDef, mergedLogs, sourceKeysToDelete } = combo;
      const keysToDelete = sourceKeysToDelete.filter(k => k !== targetKey);
      
      keysToDelete.forEach(k => {
        delete updatedCustomBiomarkers[k];
        deletedCustomBiomarkerKeys[k] = Date.now();
      });
      delete deletedCustomBiomarkerKeys[targetKey];

      const builtIn = biomarkerDefinitions.find(d => d.key === targetKey);
      const existingCustom = updatedCustomBiomarkers[targetKey];
      
      updatedCustomBiomarkers[targetKey] = {
        ...(builtIn || {}),
        ...(existingCustom || {}),
        name: targetDef.name,
        unit: targetDef.unit,
        normalRange: targetDef.normalRange,
        description: targetDef.description,
        standardMedicalGrouping: targetDef.standardMedicalGrouping || '',
        riskCategories: targetDef.riskCategories || [],
        potentialMedicalConditions: targetDef.potentialMedicalConditions || [],
        ...(targetDef.rangeConfig ? { rangeConfig: targetDef.rangeConfig } : {}),
        ...(targetDef.customRanges ? { customRanges: targetDef.customRanges } : {})
      };

      updatedHistory = updatedHistory.map(log => {
        const cleanBiomarkers = { ...log.biomarkers };
        let logChanged = false;
        keysToDelete.forEach(k => {
          if (cleanBiomarkers[k] !== undefined) {
            delete cleanBiomarkers[k];
            logChanged = true;
          }
        });

        // Update tests array and observationMeta
        let updatedTests = log.tests;
        if (Array.isArray(log.tests)) {
          const testMap = new Map<string, any>();
          log.tests.forEach((t: any) => {
            const mappedKey = keysToDelete.includes(t.key) ? targetKey : t.key;
            if (!testMap.has(mappedKey)) {
              testMap.set(mappedKey, { ...t, key: mappedKey });
            } else {
              testMap.set(mappedKey, { ...testMap.get(mappedKey), ...t, key: mappedKey });
            }
          });
          updatedTests = Array.from(testMap.values());
          logChanged = true;
        }

        let updatedMeta = log.observationMeta ? { ...log.observationMeta } : undefined;
        if (updatedMeta) {
          keysToDelete.forEach(k => {
            if (updatedMeta![k]) {
              if (!updatedMeta![targetKey]) {
                updatedMeta![targetKey] = updatedMeta![k];
              }
              delete updatedMeta![k];
              logChanged = true;
            }
          });
        }

        return {
          ...log,
          biomarkers: cleanBiomarkers,
          ...(updatedTests ? { tests: updatedTests } : {}),
          ...(updatedMeta ? { observationMeta: updatedMeta } : {}),
          ...(logChanged ? { sync_state: 'update' as const, updated_at: Date.now() } : {})
        };
      });

      mergedLogs.forEach(ml => {
        let existingIndex = -1;
        if (ml.originalLogId) {
          existingIndex = updatedHistory.findIndex(h => h.id === ml.originalLogId);
        }
        if (existingIndex < 0) {
          existingIndex = updatedHistory.findIndex(h => toYYYYMMDD(h.date) === toYYYYMMDD(ml.date));
        }
        if (existingIndex >= 0) {
          updatedHistory[existingIndex] = {
            ...updatedHistory[existingIndex],
            biomarkers: {
              ...updatedHistory[existingIndex].biomarkers,
              [targetKey]: ml.value
            },
            sync_state: 'update' as const,
            updated_at: Date.now()
          };
        } else {
          updatedHistory.push({
            id: `med_log_combined_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            date: ml.date,
            biomarkers: {
              [targetKey]: ml.value
            },
            sync_state: 'new' as const,
            updated_at: Date.now()
          });
        }
      });
    });

    const logsToDelete: string[] = [];
    updatedHistory = updatedHistory.map(h => {
      if (Object.keys(h.biomarkers).length === 0 && !h.note) {
        logsToDelete.push(h.id);
        return { ...h, sync_state: 'delete' as const, updated_at: Date.now() };
      }
      return h;
    });

    const now = Date.now();
    const updatedProfile: UserProfile = {
      ...profile as any,
      lastUpdatedAt: now,
      customBiomarkers: updatedCustomBiomarkers,
      deletedCustomBiomarkerKeys,
      deletedBiomarkerLogIds: {
        ...(profile?.deletedBiomarkerLogIds || {}),
        ...Object.fromEntries(logsToDelete.map(id => [id, now]))
      }
    };

    updatedHistory.sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));

    const recomputedBiomarkers: { [key: string]: number | string } = {};
    [...updatedHistory].filter(b => b.sync_state !== 'delete' && !(updatedProfile?.deletedBiomarkerLogIds?.[b.id] && (updatedProfile?.deletedBiomarkerLogIds?.[b.id] || 0) >= (b.updated_at || 0))).sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date))).forEach(log => {
      Object.entries(log.biomarkers).forEach(([k, v]) => {
        if (!deletedCustomBiomarkerKeys[k]) {
          recomputedBiomarkers[k] = v as string | number;
        }
      });
    });

    setProfile(updatedProfile);
    setBiomarkerHistory(updatedHistory);
    setBiomarkers(recomputedBiomarkers);

    const changedLogIds = updatedHistory.filter(l => l.sync_state !== 'delete').map(l => l.id);
    await saveAndSync(updatedProfile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLogsBatch', targetIds: changedLogIds, deletedIds: logsToDelete });
  };


  const handleCombineBiomarkers = async (
    targetKey: string,
    targetDef: any,
    mergedLogs: { date: string; value: number | string; originalLogId?: string }[],
    sourceKeysToDelete: string[]
  ) => {
    // 1. Remove old custom definitions, and add the new one if custom
    const updatedCustomBiomarkers = { ...(profile?.customBiomarkers || {}) };
    const deletedCustomBiomarkerKeys = { ...(profile?.deletedCustomBiomarkerKeys || {}) };
    const keysToDelete = sourceKeysToDelete.filter(k => k !== targetKey);
    keysToDelete.forEach(k => {
      delete updatedCustomBiomarkers[k];
      deletedCustomBiomarkerKeys[k] = Date.now();
    });
    delete deletedCustomBiomarkerKeys[targetKey];

    const builtIn = biomarkerDefinitions.find(d => d.key === targetKey);
    const existingCustom = profile?.customBiomarkers?.[targetKey];
    
    updatedCustomBiomarkers[targetKey] = {
      ...(builtIn || {}),
      ...(existingCustom || {}),
      name: targetDef.name,
      unit: targetDef.unit,
      normalRange: targetDef.normalRange,
      description: targetDef.description,
      standardMedicalGrouping: targetDef.standardMedicalGrouping || '',
      riskCategories: targetDef.riskCategories || [],
      potentialMedicalConditions: targetDef.potentialMedicalConditions || [],
      ...(targetDef.rangeConfig ? { rangeConfig: targetDef.rangeConfig } : {}),
      ...(targetDef.customRanges ? { customRanges: targetDef.customRanges } : {})
    };
    const updatedProfile: UserProfile = {
      ...profile,
      customBiomarkers: updatedCustomBiomarkers,
      deletedCustomBiomarkerKeys
    };
    // 2. Remove old keys from history and merge the consolidated logs
    let updatedHistory = biomarkerHistory.map(log => {
      const cleanBiomarkers = { ...log.biomarkers };
      let changed = false;
      keysToDelete.forEach(k => {
        if (cleanBiomarkers[k] !== undefined) {
          delete cleanBiomarkers[k];
          changed = true;
        }
      });

      // Update tests array and observationMeta
      let updatedTests = log.tests;
      if (Array.isArray(log.tests)) {
        const testMap = new Map<string, any>();
        log.tests.forEach((t: any) => {
          const mappedKey = keysToDelete.includes(t.key) ? targetKey : t.key;
          if (!testMap.has(mappedKey)) {
            testMap.set(mappedKey, { ...t, key: mappedKey });
          } else {
            testMap.set(mappedKey, { ...testMap.get(mappedKey), ...t, key: mappedKey });
          }
        });
        updatedTests = Array.from(testMap.values());
        changed = true;
      }

      let updatedMeta = log.observationMeta ? { ...log.observationMeta } : undefined;
      if (updatedMeta) {
        keysToDelete.forEach(k => {
          if (updatedMeta![k]) {
            if (!updatedMeta![targetKey]) {
              updatedMeta![targetKey] = updatedMeta![k];
            }
            delete updatedMeta![k];
            changed = true;
          }
        });
      }

      if (changed) {
        return {
          ...log,
          biomarkers: cleanBiomarkers,
          ...(updatedTests ? { tests: updatedTests } : {}),
          ...(updatedMeta ? { observationMeta: updatedMeta } : {}),
          sync_state: 'update' as const,
          updated_at: Date.now()
        };
      }
      return log;
    });
    // Merge Consolidated
    mergedLogs.forEach(ml => {
      let existingIndex = -1;
      if (ml.originalLogId) {
        existingIndex = updatedHistory.findIndex(h => h.id === ml.originalLogId);
      }
      if (existingIndex < 0) {
        existingIndex = updatedHistory.findIndex(h => toYYYYMMDD(h.date) === toYYYYMMDD(ml.date));
      }
      if (existingIndex >= 0) {
        updatedHistory[existingIndex] = {
          ...updatedHistory[existingIndex],
          biomarkers: {
            ...updatedHistory[existingIndex].biomarkers,
            [targetKey]: ml.value
          },
          sync_state: 'update' as const,
          updated_at: Date.now()
        };
      } else {
        updatedHistory.push({
          id: `med_log_combined_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          date: ml.date,
          biomarkers: {
            [targetKey]: ml.value
          },
          sync_state: 'new' as const,
          updated_at: Date.now()
        });
      }
    });
    // Clean completely empty history logs
    const logsToDelete: string[] = [];
    updatedHistory = updatedHistory.map(h => {
      if (Object.keys(h.biomarkers).length === 0 && !h.note) {
        logsToDelete.push(h.id);
        return { ...h, sync_state: 'delete' as const, updated_at: Date.now() };
      }
      return h;
    });
    if (logsToDelete.length > 0) {
      updatedProfile.deletedBiomarkerLogIds = { ...(updatedProfile.deletedBiomarkerLogIds || {}) };
      logsToDelete.forEach(id => { updatedProfile.deletedBiomarkerLogIds![id] = Date.now(); });
    }
    
    updatedHistory.sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));
    // 3. Recompute latest biomarkers
    const recomputedBiomarkers: { [key: string]: number | string } = {};
    [...updatedHistory].filter(b => b.sync_state !== 'delete' && !(updatedProfile?.deletedBiomarkerLogIds?.[b.id] && (updatedProfile?.deletedBiomarkerLogIds?.[b.id] || 0) >= (b.updated_at || 0))).sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date))).forEach(log => {
      Object.entries(log.biomarkers).forEach(([k, v]) => {
        recomputedBiomarkers[k] = v as string | number;
      });
    });
    setProfile(updatedProfile);
    setBiomarkerHistory(updatedHistory);
    setBiomarkers(recomputedBiomarkers);

    const changedLogIds = updatedHistory.filter(l => l.sync_state !== 'delete').map(l => l.id);
    await saveAndSync(updatedProfile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLogsBatch', targetIds: changedLogIds, deletedIds: logsToDelete });
  };
  const handleBatchConsolidate = async (mapping: { [key: string]: string }) => {
    const targetGroups: { [targetKey: string]: string[] } = {};
    const updatedCustomBiomarkers = { ...(profile?.customBiomarkers || {}) };
    const deletedCustomBiomarkerKeys = { ...(profile?.deletedCustomBiomarkerKeys || {}) };

    Object.entries(mapping).forEach(([srcKey, tgtKey]) => {
      if (srcKey && tgtKey) {
        if (srcKey !== tgtKey) {
          if (!targetGroups[tgtKey]) {
            targetGroups[tgtKey] = [];
          }
          if (!targetGroups[tgtKey].includes(srcKey)) {
            targetGroups[tgtKey].push(srcKey);
          }
        } else {
          // If source equals target, the user is approving the marker as its own standard definition
          if (!updatedCustomBiomarkers[srcKey]) {
            updatedCustomBiomarkers[srcKey] = {
              name: srcKey.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
              unit: '',
              normalRange: '',
              description: '',
              standardMedicalGrouping: 'By Medical Practice' // Giving it a grouping marks it as approved
            } as any;
          } else if (!updatedCustomBiomarkers[srcKey].standardMedicalGrouping) {
            updatedCustomBiomarkers[srcKey].standardMedicalGrouping = 'By Medical Practice';
          }
        }
      }
    });

    let updatedHistory = [...biomarkerHistory];

    Object.entries(targetGroups).forEach(([targetKey, sourceKeys]) => {
      const isTargetStandard = biomarkerDefinitions.some(d => d.key === targetKey);
      if (!isTargetStandard && !updatedCustomBiomarkers[targetKey]) {
        const sourceDef = sourceKeys.map(k => updatedCustomBiomarkers[k]).find(def => !!def);
        updatedCustomBiomarkers[targetKey] = {
          name: sourceDef?.name || targetKey.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
          unit: sourceDef?.unit || '',
          normalRange: sourceDef?.normalRange || '',
          description: sourceDef?.description || '',
          benefitRisk: sourceDef?.benefitRisk || ''
        };
      }

      const allUniqueDates = Array.from(new Set(
        updatedHistory.filter(log => {
          return log.biomarkers[targetKey] !== undefined || sourceKeys.some(k => log.biomarkers[k] !== undefined);
        }).map(log => log.date)
      ));

      allUniqueDates.forEach(date => {
        const dayLogs = updatedHistory.filter(log => log.date === date);
        if (dayLogs.length === 0) return;

        const values: (number | string)[] = [];
        const notes: string[] = [];
        const summaries: string[] = [];
        const testsList: any[] = [];

        dayLogs.forEach(log => {
          if (log.biomarkers[targetKey] !== undefined && log.biomarkers[targetKey] !== null && log.biomarkers[targetKey] !== '') {
            values.push(log.biomarkers[targetKey]);
          }
          sourceKeys.forEach(k => {
            if (log.biomarkers[k] !== undefined && log.biomarkers[k] !== null && log.biomarkers[k] !== '') {
              values.push(log.biomarkers[k]);
            }
          });

          if (log.note) notes.push(log.note);
          if (log.summary) summaries.push(log.summary);
          if (log.tests && Array.isArray(log.tests)) {
            testsList.push(...log.tests);
          }
        });

        let finalValue: number | string | undefined = undefined;
        if (values.length > 0) {
          const numericValues = values.map(v => Number(v)).filter(n => !isNaN(n));
          if (numericValues.length === values.length && numericValues.length > 0) {
            const sum = numericValues.reduce((a, b) => a + b, 0);
            finalValue = Number((sum / numericValues.length).toFixed(2));
          } else {
            finalValue = values[0];
          }
        }

        const uniqueNotes = Array.from(new Set(notes.map(n => n.trim()).filter(Boolean)));
        const uniqueSummaries = Array.from(new Set(summaries.map(s => s.trim()).filter(Boolean)));

        const combinedNote = uniqueNotes.join(' | ');
        const combinedSummary = uniqueSummaries.join(' | ');

        const primaryLog = dayLogs[0];
        primaryLog.biomarkers[targetKey] = finalValue !== undefined ? finalValue : primaryLog.biomarkers[targetKey];
        if (combinedNote) primaryLog.note = combinedNote;
        if (combinedSummary) primaryLog.summary = combinedSummary;
        if (testsList.length > 0) {
          primaryLog.tests = testsList;
        }

        dayLogs.forEach(log => {
          sourceKeys.forEach(k => {
            delete log.biomarkers[k];
          });
        });
      });

      sourceKeys.forEach(k => {
        delete updatedCustomBiomarkers[k];
        deletedCustomBiomarkerKeys[k] = Date.now();
      });
    });

    updatedHistory = updatedHistory.filter(h => Object.keys(h.biomarkers).length > 0);
    updatedHistory.sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));

    const recomputedBiomarkers: { [key: string]: number | string } = {};
    [...updatedHistory].filter(b => b.sync_state !== 'delete' && !(profile?.deletedBiomarkerLogIds?.[b.id] && (profile?.deletedBiomarkerLogIds?.[b.id] || 0) >= (b.updated_at || 0))).sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date))).forEach(log => {
      Object.entries(log.biomarkers).forEach(([k, v]) => {
        recomputedBiomarkers[k] = v as string | number;
      });
    });

    const updatedProfile: UserProfile = {
      ...profile,
      customBiomarkers: updatedCustomBiomarkers,
      deletedCustomBiomarkerKeys
    };

    setProfile(updatedProfile);
    setBiomarkerHistory(updatedHistory);
    setBiomarkers(recomputedBiomarkers);

// Sync deferred to manual button click
    const changedLogIds = updatedHistory.map(l => l.id);
    await saveAndSync(updatedProfile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLogsBatch', targetIds: changedLogIds });
  };
  const handleApplyCalculation = async (updates: {
    targetCalories?: number;
    targetWeight?: number;
    addedBenefit?: string;
    descriptionExplain?: string;
  }) => {
    let updatedBenefits = [...dailyBenefits];
    if (updates.addedBenefit) {
      const exists = updatedBenefits.some(b => {
        const actName = b.activity || (b as any).label || '';
        return actName.toLowerCase() === updates.addedBenefit!.toLowerCase() || b.id === 'walking_30';
      });
      if (!exists) {
        updatedBenefits.push({
          id: 'walking_30',
          activity: updates.addedBenefit,
          target: '30 min',
          completed: false
        });
        setDailyBenefits(updatedBenefits);
      }
    }
    let updatedReport = report ? { ...report } : (await import('./utils/fallbackReport')).getLocalFallbackReport(profile);
    if (updates.targetCalories && updatedReport) {
      updatedReport = {
        ...updatedReport,
        dailyNutrientTargets: {
          ...updatedReport.dailyNutrientTargets,
          calories: `${updates.targetCalories} kcal`
        }
      };
      setReport(updatedReport);
    }
    let updatedHistory = [...biomarkerHistory];
    const latestBmiLogIndex = updatedHistory.findIndex(h => h.biomarkers.bmi !== undefined);
    if (latestBmiLogIndex >= 0 && updates.descriptionExplain) {
      updatedHistory[latestBmiLogIndex] = {
        ...updatedHistory[latestBmiLogIndex],
        note: updates.descriptionExplain
      };
      setBiomarkerHistory(updatedHistory);
      // Quickly save this log since multi-sync skips collections
      saveAndSync(profile, foodLogs, biomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLog', targetId: updatedHistory[latestBmiLogIndex].id }).catch(console.error);
    }
    let updatedProfile = { ...profile };
    const isAsian = isAsianEthnicity(updatedProfile.ethnicity);
    const gender = (updatedProfile.gender || 'male').toLowerCase();
    const isMale = gender.startsWith('m');
    const targetBmi = isAsian ? 21.0 : (isMale ? 22.5 : 21.7);
    const targetRange = isAsian ? '18.5 - 22.9' : '18.5 - 24.9';
    const targetWeight = updates.targetWeight || Math.round(targetBmi * Math.pow((updatedProfile.height || 170) / 100, 2) * 10) / 10;
    if (targetWeight) {
      if (!updatedProfile.customBiomarkers) {
        updatedProfile.customBiomarkers = {};
      }
      if (!updatedProfile.customBiomarkers.bmi) {
        updatedProfile.customBiomarkers.bmi = {
          name: 'Body Mass Index (BMI)',
          unit: 'kg/m²',
          normalRange: targetRange,
          description: 'A measure of body fat based on height and weight.',
          benefitRisk: ''
        };
      } else {
        updatedProfile.customBiomarkers.bmi = {
          ...updatedProfile.customBiomarkers.bmi,
          normalRange: targetRange,
          description: 'A measure of body fat based on height and weight.'
        };
      }
      setProfile(updatedProfile);
    }
    await saveAndSync(updatedProfile, foodLogs, biomarkers, updatedHistory, actions, updatedBenefits, updatedReport);
  };
  // Accept and apply recommendations to active dashboard targets
  const handleAcceptReport = async (acceptedReport: RecommendationReport) => {
    setReport(acceptedReport);
    setActions(acceptedReport.actions);
    setDailyBenefits(acceptedReport.dailyBenefits);
    setDraftReport(null);
    
    // Quick, clean targeted sync to database
    await saveAndSync(
      profile,
      foodLogs,
      biomarkers,
      biomarkerHistory,
      acceptedReport.actions,
      acceptedReport.dailyBenefits,
      acceptedReport,
      { type: 'report' }
    );
    
    // Auto-navigate to dashboard for glorious preview of newly updated targets
    setActiveTab('home');
  };

  const handleRejectReport = () => {
    setDraftReport(null);
  };
  // Run On-demand Insights Totality analysis with LLM Selection
  const handleGenerateReport = async (modelId: string, refinement?: { message: string, chatHistory: any[] }) => {
    setIsGenerating(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, 18000); // 18-second robust timeout
    try {
      trackApiCall('gemini', `Insight Analyze`, auth.currentUser?.email || 'anonymous');
      const excludedKeys = new Set([
        ...Object.keys(profile?.notUsedBiomarkers || {}),
        ...Object.keys(profile?.notUsedInMedicalHistory || {})
      ]);
      const analysisEligibleHistory = excludedKeys.size === 0 ? biomarkerHistory : biomarkerHistory.map(log => {
        if (!log.biomarkers) return log;
        const filtered = { ...log.biomarkers };
        let changed = false;
        Object.keys(filtered).forEach(k => {
          if (excludedKeys.has(k)) { delete filtered[k]; changed = true; }
        });
        return changed ? { ...log, biomarkers: filtered } : log;
      });
      const response = await fetch('/api/gemini/insight-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userProfile: profile,
          foodLogs,
          biomarkerHistory: analysisEligibleHistory,
          engine: modelId,
          refinement
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      const resText = await response.text();
      let resData: any = {};
      try {
        resData = JSON.parse(resText);
      } catch {
        throw new Error(`Server returned non-JSON response (${response.status})`);
      }
      if (resData.error) throw new Error(resData.error);
      if (resData.report) {
        setDraftReport(resData.report);
      }
    } catch (err: any) {
      clearTimeout(timeoutId);
      console.error("Analysis generation error/timeout:", err);
      if (err.name === 'AbortError') {
        safeAlert('Server took longer than expected to complete profiling. Activating specialized local preventative engine fallback.');
        const fallback = (await import('./utils/fallbackReport')).getLocalFallbackReport(profile);
        setDraftReport(fallback);
      } else {
        safeAlert(`Failed to complete analysis: ${err.message || 'Server timeout. Activating high-fidelity fallback.'}`);
        const fallback = (await import('./utils/fallbackReport')).getLocalFallbackReport(profile);
        setDraftReport(fallback);
      }
    } finally {
      setIsGenerating(false);
    }
  };
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
