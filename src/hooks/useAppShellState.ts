import { useState, useEffect, useRef, type MutableRefObject } from 'react';
import type { UserProfile, FoodLog, BiomarkerLog, HealthAction, DailyBenefit, RecommendationReport, DbInteraction, QuotaData, FoodIdea } from '../types';
import type { ProfileDbChangeChecker } from './useAppProfile';
import { mergeFoodLogsDeduped } from '../utils/foodLogDedupe';
import { normalizeBiomarkerHistory } from '../utils/dateUtils';
import { sanitizeBiomarkerHistoryOnLoad } from '../utils/biomarkers';
import { AVAILABLE_LLMS } from '../utils/llm';
import { checkQuotaFlag } from '../utils/firestoreUtils';
import { trackApiCall, setActiveQueryId, generateQueryId, initializeFetchInterceptor } from '../utils/apiTracker';
import { auth } from '../firebase';
import { get, set } from '../utils/storageUtils';
import { initSupabaseJobSync } from '../jobs/SupabaseJobSync';
import { JobStore } from '../jobs/JobStore';
import { getCurrentDateInTimezone, toYYYYMMDD } from '../utils/dateUtils';
import { loadLocalSnapshots } from '../utils/storageUtils';
import { getProfileFingerprint } from '../utils/biomarkers';

const QUOTA_STORAGE_KEY = 'health_cockpit_quota_data';
const getQuotaKey = () => {
  return new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' });
};

export function useAppShellState() {
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
        profileForSanitizeRef.current
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
  // Q-11.3b-style late binding: the sanitize wrapper needs the current
  // profile, which is owned by useAppProfile (called after this hook).
  // App assigns `profileRef.current || profile` every render; event-time
  // reads below therefore see exactly what the inline version saw.
  const profileForSanitizeRef = useRef<UserProfile | null>(null);
  const [actions, setActions] = useState<HealthAction[]>([]);
  const [dailyBenefits, setDailyBenefits] = useState<DailyBenefit[]>([]);
  const [foodIdeas, setFoodIdeas] = useState<FoodIdea[]>([]);
  const [report, setReport] = useState<RecommendationReport | null>(null);
  const [draftReport, setDraftReport] = useState<RecommendationReport | null>(null);

  const checkForDbChangesRef = useRef<ProfileDbChangeChecker | null>(null);
  const [dismissedBmiAlerts, setDismissedBmiAlerts] = useState<{[key: string]: boolean}>(() => {
    try {
      const saved = localStorage.getItem('dismissedBmiAlerts');
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      return {};
    }
  });
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
    window.addEventListener('switch-tab', handleSwitchTab);
    window.addEventListener('navigate-tab', handleSwitchTab);
    return () => {
      window.removeEventListener('switch-tab', handleSwitchTab);
      window.removeEventListener('navigate-tab', handleSwitchTab);
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

  const currentUserId = auth.currentUser?.uid;
  useEffect(() => {
    // Multi-device sync hydrates state on app boot from Supabase
    const cleanupSupabaseSync = initSupabaseJobSync(currentUserId);
    return () => {
      cleanupSupabaseSync();
    };
  }, [currentUserId]);

  const [isManualFoodLogOpen, setIsManualFoodLogOpen] = useState(false);
  const [manualFoodLogError, setManualFoodLogError] = useState<string | null>(null);

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
      import('../components/LogChat').catch(() => {});
    };
    if ('requestIdleCallback' in window) {
      (window as any).requestIdleCallback(preload, { timeout: 2000 });
    } else {
      setTimeout(preload, 1000);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.removeItem('custom_system_instruction_agent1');
    } catch (e) {}
  }, []);

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

  return {
  setFoodLogs, setBiomarkerHistory, biomarkerHistory, checkForDbChangesRef, setActiveTab, activeTab,
  handleFirestoreError, handleToggleAutoSyncDisabled, updateQuota, logInteraction, completeInteraction, resolveSupabaseLabel,
  currentUserId, setSelectedModelId, snapshots, setSnapshots, showSnapshotPanel, setShowSnapshotPanel,
  lastSnapshotLabel, setLastSnapshotLabel, syncState, setSyncState, isInitialDataLoading, setIsInitialDataLoading,
  isAuthChecking, setIsAuthChecking, foodLogs, setFoodLogsRaw, totalFoodsCount, setTotalFoodsCount,
  biomarkers, setBiomarkers, biomarkerHistoryRaw, setBiomarkerHistoryRaw, actions, setActions,
  dailyBenefits, setDailyBenefits, foodIdeas, setFoodIdeas, report, setReport,
  draftReport, setDraftReport, dismissedBmiAlerts, setDismissedBmiAlerts, activeTabRaw, setActiveTabRaw,
  healthSubTab, setHealthSubTab, initiallyExpandedFoodId, setInitiallyExpandedFoodId, isConflictModalOpen, setIsConflictModalOpen,
  conflictData, setConflictData, isFirestoreQuotaExceeded, setIsFirestoreQuotaExceeded, syncFailedWarning, setSyncFailedWarning,
  hideSensitive, setHideSensitive, dbInteractions, setDbInteractions, autoSyncDisabled, setAutoSyncDisabled,
  quota, setQuota, activeFrontDeskJobId, setActiveFrontDeskJobId, isMedicalChatOpen, setIsMedicalChatOpen,
  isFrontDeskOpen, setIsFrontDeskOpen, activeAgentType, setActiveAgentType, activeReviewBiomarkerKey, setActiveReviewBiomarkerKey,
  isFloatingOpen, setIsFloatingOpen, isManualFoodLogOpen, setIsManualFoodLogOpen, manualFoodLogError, setManualFoodLogError,
  activeDataReviewBatchIdx, setActiveDataReviewBatchIdx, activeDataReviewBatchKeys, setActiveDataReviewBatchKeys, activeDataReviewExtractedYaml, setActiveDataReviewExtractedYaml,
  activeDataReviewCurrentBatch, setActiveDataReviewCurrentBatch, activeDataReviewEstimatedTotalMarkers, setActiveDataReviewEstimatedTotalMarkers, dataReviewSharedState, setDataReviewSharedState,
  calibratingBatchIdx, setCalibratingBatchIdx, calibratingAgentType, setCalibratingAgentType, batchSize, setBatchSize,
  prefillMessage, setPrefillMessage, activeHandoffPayload, setActiveHandoffPayload, isGenerating, setIsGenerating,
  isEditingFoodLog, setIsEditingFoodLog, selectedModelId, setSelectedModelIdState,
  profileForSanitizeRef
  };
}

export type AppShellState = ReturnType<typeof useAppShellState>;

export interface UseAppShellEffectsParams {
  shelf: AppShellState;
  profile: UserProfile | null;
  setProfile: (p: any) => void;
  saveAndSync: (...args: any[]) => Promise<any>;
  activeJobId: string | null;
  setActiveJobId: (id: string | null) => void;
  handleOpenJob: (jobId: string) => void;
  profileRef: MutableRefObject<UserProfile | null>;
  foodLogsRef: MutableRefObject<FoodLog[]>;
  biomarkersRef: MutableRefObject<{ [key: string]: number | string }>;
  biomarkerHistoryRef: MutableRefObject<BiomarkerLog[]>;
}

export function useAppShellEffects(params: UseAppShellEffectsParams) {
  const { shelf, profile, setProfile, saveAndSync, activeJobId, setActiveJobId, handleOpenJob, profileRef, foodLogsRef, biomarkersRef, biomarkerHistoryRef } = params;
  const {
  dismissedBmiAlerts, setDismissedBmiAlerts, setSnapshots, foodLogs, biomarkers, biomarkerHistory,
  setActiveTab, setIsMedicalChatOpen, setBiomarkerHistory, setBiomarkers, actions, dailyBenefits,
  report, activeTab, isMedicalChatOpen, isManualFoodLogOpen, isConflictModalOpen
  } = shelf;
  useEffect(() => {
    const handleSeedTestData = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail) {
        const { profile: p, biomarkers: b, biomarkerHistory: h } = customEvent.detail;
        if (p) setProfile(p);
        if (b) setBiomarkers(b);
        if (h) setBiomarkerHistory(h);
      }
    };
    window.addEventListener('seed-biomarker-test-data', handleSeedTestData);
    return () => {
      window.removeEventListener('seed-biomarker-test-data', handleSeedTestData);
    };
  }, []);
  const handleDismissBmiAlert = () => {
    if (!profile) return;
    const fingerprint = getProfileFingerprint(profile);
    const updated = { ...dismissedBmiAlerts, [fingerprint]: true };
    setDismissedBmiAlerts(updated);
    localStorage.setItem('dismissedBmiAlerts', JSON.stringify(updated));
  };
  useEffect(() => {
    if (profile?.email) {
      loadLocalSnapshots(profile.email).then(s => setSnapshots(s)).catch(() => {});
    }
  }, [profile?.email]);


  useEffect(() => {
    profileRef.current = profile;
    foodLogsRef.current = foodLogs;
    biomarkersRef.current = biomarkers;
    biomarkerHistoryRef.current = biomarkerHistory;
  }, [profile, foodLogs, biomarkers, biomarkerHistory]);
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
  useEffect(() => {
    if (activeJobId) {
      handleOpenJob(activeJobId);
    }
  }, [activeJobId]);
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
  // Lock body scroll when modals are open
  useEffect(() => {
    if (isFoodChatOpen || isMedicalChatOpen || isManualFoodLogOpen || isConflictModalOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isFoodChatOpen, isMedicalChatOpen, isManualFoodLogOpen, isConflictModalOpen]);

  return {
    isFoodChatOpen,
    setIsFoodChatOpen,
    handleDismissBmiAlert,
  };
}
