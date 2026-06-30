import React, { useState, useEffect } from 'react';
import { UserProfile, FoodLog, BiomarkerLog, HealthAction, DailyBenefit, RecommendationReport, DbInteraction, QuotaData, FoodIdea } from './types';
import Header from './components/Header';
import BottomNav from './components/BottomNav';
import AuthScreen from './components/AuthScreen';
import HomeTab from './components/HomeTab';
import InsightsTab from './components/InsightsTab';
import FoodHistoryTab from './components/FoodHistoryTab';
import MedicalHistoryTab from './components/MedicalHistoryTab';
import TrendsTab from './components/TrendsTab';
import LogChat from './components/LogChat';
import { translations } from './utils/translations';
import { getLocalFallbackReport } from './utils/fallbackReport';
import { Plus, HeartHandshake, RefreshCw, Sparkles, Stethoscope, Utensils, Loader } from 'lucide-react';
import { auth, db } from './firebase';
import { onAuthStateChanged, signOut as fbSignOut } from 'firebase/auth';
import { doc, getDoc, setDoc, collection, getDocs, deleteDoc, getDocFromServer, getDocsFromServer, onSnapshot, getDocsFromCache } from 'firebase/firestore';
import { getCurrentDateInTimezone } from './utils/dateUtils';
import { biomarkerDefinitions, isAsianEthnicity, hasBmiPendingAlert, getProfileFingerprint } from './utils/biomarkers';
import { get, set } from 'idb-keyval';

const LOCAL_STORAGE_KEY = 'health_cockpit_app_data';
const QUOTA_STORAGE_KEY = 'health_cockpit_quota_data';

const getQuotaKey = () => {
  return new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' });
};

const getDynamicStyles = (profile: any) => {
  if (!profile) return '';
  const p = profile.themePalette || {};
  const fontSize = profile.fontSize || 'normal';
  const fontFamily = profile.fontFamily || 'Inter';
  const fontMono = profile.fontMono || 'JetBrains Mono';
  
  let fontSizeCss = '';
  if (fontSize === 'tiny') {
    fontSizeCss = `
      :root, html { font-size: 12px !important; }
    `;
  } else if (fontSize === 'small') {
    fontSizeCss = `
      :root, html { font-size: 14px !important; }
    `;
  } else if (fontSize === 'normal') {
    fontSizeCss = `
      :root, html { font-size: 16px !important; }
    `;
  } else if (fontSize === 'large') {
    fontSizeCss = `
      :root, html { font-size: 18px !important; }
    `;
  } else if (fontSize === 'xl') {
    fontSizeCss = `
      :root, html { font-size: 20px !important; }
    `;
  } else if (fontSize === 'xxl') {
    fontSizeCss = `
      :root, html { font-size: 24px !important; }
    `;
  }

  const sizeMap = {
    tiny: '12px',
    small: '14px',
    normal: '16px',
    large: '18px',
    xl: '20px',
    xxl: '24px',
    '3xl': '30px',
    '4xl': '36px',
    '5xl': '48px',
    '6xl': '60px'
  };

  const titleSize = profile.fontSizeTitle ? sizeMap[profile.fontSizeTitle as keyof typeof sizeMap] : '';
  const subtitleSize = profile.fontSizeSubtitle ? sizeMap[profile.fontSizeSubtitle as keyof typeof sizeMap] : '';
  const descSize = profile.fontSizeDescription ? sizeMap[profile.fontSizeDescription as keyof typeof sizeMap] : '';
  const smallSize = profile.fontSizeBodySmall ? sizeMap[profile.fontSizeBodySmall as keyof typeof sizeMap] : '';
  const subtitleSmallSize = profile.fontSizeSubtitleSmall ? sizeMap[profile.fontSizeSubtitleSmall as keyof typeof sizeMap] : '14px';
  const keyMetricSize = profile.fontSizeKeyMetric ? sizeMap[profile.fontSizeKeyMetric as keyof typeof sizeMap] : '36px';
  const xsSize = profile.fontSizeXS ? sizeMap[profile.fontSizeXS as keyof typeof sizeMap] : '10px';
  const bodySize = profile.fontSizeBody ? sizeMap[profile.fontSizeBody as keyof typeof sizeMap] : '16px';

  fontSizeCss += `
    .font-size-title { font-size: ${titleSize || '24px'} !important; }
    .font-size-subtitle { font-size: ${subtitleSize || '18px'} !important; }
    .font-size-subtitle-small { font-size: ${subtitleSmallSize} !important; }
    .font-size-body { font-size: ${bodySize} !important; }
    .font-size-body-small { font-size: ${smallSize || '12px'} !important; }
    .font-size-key-metric { font-size: ${keyMetricSize} !important; }
    .font-size-xs { font-size: ${xsSize} !important; }
  `;

  if (titleSize || subtitleSize || descSize || smallSize) {
    fontSizeCss += `
      ${titleSize ? `h1, h2, h3, .font-display, .text-xl, .text-2xl, .text-3xl, .text-4xl, .text-5xl { font-size: ${titleSize} !important; line-height: 1.3 !important; }` : ''}
      ${subtitleSize ? `h4, h5, .subtitle-text, .text-lg { font-size: ${subtitleSize} !important; line-height: 1.4 !important; }` : ''}
      ${descSize ? `p, .desc-text, .text-base, .text-md { font-size: ${descSize} !important; line-height: 1.5 !important; }` : ''}
      ${smallSize ? `small, .text-sm, .text-xs, .text-[11px], .text-[10px], .text-[9px], .body-small { font-size: ${smallSize} !important; line-height: 1.5 !important; }` : ''}
    `;
  }

  let fontCss = `
    :root {
      --font-sans: "${fontFamily}", ui-sans-serif, system-ui, sans-serif !important;
      --font-display: "${fontFamily}", sans-serif !important;
      --font-mono: "${fontMono}", ui-monospace, monospace !important;
    }
    body {
      font-family: var(--font-sans) !important;
    }
  `;

  let colorCss = '';
  colorCss += `
    :root {
  `;

  if (p.button) {
    colorCss += `
      --color-indigo-500: ${p.button} !important;
      --color-indigo-600: ${p.button} !important;
      --color-indigo-700: ${p.button}dd !important;
      --color-indigo-50: ${p.button}12 !important;
      --color-indigo-950: ${p.button}25 !important;
    `;
  }

  if (p.background) {
    colorCss += `
      --color-slate-50: ${p.background} !important;
      --color-slate-950: ${p.background} !important;
    `;
  }

  if (p.bgApp) {
    colorCss += `
      --color-slate-50: ${p.bgApp} !important;
      --color-slate-950: ${p.bgApp} !important;
    `;
  }

  if (p.bgCard) {
    colorCss += `
      --color-white: ${p.bgCard} !important;
      --color-slate-900: ${p.bgCard} !important;
    `;
  }

  if (p.border) {
    colorCss += `
      --color-slate-100: ${p.border}88 !important;
      --color-slate-200: ${p.border} !important;
      --color-slate-300: ${p.border} !important;
      --color-slate-800: ${p.border} !important;
    `;
  }

  if (p.warning) {
    colorCss += `
      --color-rose-500: ${p.warning} !important;
      --color-rose-600: ${p.warning} !important;
      --color-rose-800: ${p.warning} !important;
      --color-rose-50: ${p.warning}12 !important;
      --color-rose-100: ${p.warning}22 !important;
    `;
  }

  if (p.caution) {
    colorCss += `
      --color-amber-500: ${p.caution} !important;
      --color-amber-600: ${p.caution} !important;
      --color-amber-50: ${p.caution}12 !important;
    `;
  }

  if (p.success) {
    colorCss += `
      --color-emerald-500: ${p.success} !important;
      --color-emerald-600: ${p.success} !important;
      --color-emerald-50: ${p.success}12 !important;
    `;
  }

  if (p.text) {
    colorCss += `
      --color-slate-900: ${p.text} !important;
      --color-slate-950: ${p.text} !important;
      --color-slate-800: ${p.text} !important;
    `;
  }

  if (p.textSecondary) {
    colorCss += `
      --color-slate-500: ${p.textSecondary} !important;
      --color-slate-600: ${p.textSecondary} !important;
      --color-slate-400: ${p.textSecondary}aa !important;
    `;
  }

  if (p.neutralSetting) {
    colorCss += `
      --color-slate-700: ${p.neutralSetting} !important;
      --color-slate-300: ${p.neutralSetting}dd !important;
    `;
  }

  colorCss += `
    }
  `;

  return `
    ${fontSizeCss}
    ${fontCss}
    ${colorCss}
  `;
};

function cleanData<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  return JSON.parse(JSON.stringify(obj, (key, value) => {
    return value === undefined ? null : value;
  }));
}

const safeSaveToLocalStorage = async (key: string, bundle: any) => {
  try {
    await set(key, bundle);
  } catch (e) {
    console.error("Failed to save to IndexedDB:", e);
  }
};

export default function App() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
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

  const [activeTab, setActiveTab] = useState<'home' | 'insights' | 'food' | 'medical' | 'trends'>('home');
  const [syncState, setSyncState] = useState<'synced' | 'syncing' | 'local'>('local');
  const [hideSensitive, setHideSensitive] = useState<boolean>(false);

  // DB Transaction tracker state for spinning loader click analytics
  const [dbInteractions, setDbInteractions] = useState<DbInteraction[]>([]);

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

  const logInteraction = (type: 'upload' | 'download' | 'delete' | 'sync', path: string, data: any, docCount: number = 1) => {
    const sizeBytes = data ? (typeof data === 'string' ? data.length : JSON.stringify(data).length) : 0;
    const newOp: DbInteraction = {
      id: `db_op_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      timestamp: new Date().toLocaleTimeString(),
      type,
      path,
      sizeBytes,
      status: 'pending',
      startTimeMs: Date.now(),
      docCount
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

  // Core logs and targets states
  const [foodLogs, setFoodLogs] = useState<FoodLog[]>([]);
  const [biomarkers, setBiomarkers] = useState<{ [key: string]: number | string }>({});
  const [biomarkerHistory, setBiomarkerHistory] = useState<BiomarkerLog[]>([]);
  const [actions, setActions] = useState<HealthAction[]>([]);
  const [dailyBenefits, setDailyBenefits] = useState<DailyBenefit[]>([]);
  const [foodIdeas, setFoodIdeas] = useState<FoodIdea[]>([]);
  const [report, setReport] = useState<RecommendationReport | null>(null);
  const [draftReport, setDraftReport] = useState<RecommendationReport | null>(null);

  // Chat window visibility modals
  const [isFoodChatOpen, setIsFoodChatOpen] = useState(false);
  const [isMedicalChatOpen, setIsMedicalChatOpen] = useState(false);
  const [activeAgentType, setActiveAgentType] = useState<'agent1' | 'agent2' | 'agent3' | 'agent4' | 'agent5' | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isEditingFoodLog, setIsEditingFoodLog] = useState(false);
  const [isAuthChecking, setIsAuthChecking] = useState(true);

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
  // Check of changes in profile and other info on the database (and pull latest changes)
  const checkForDbChanges = async (forceUserId?: string) => {
    const uid = forceUserId || auth.currentUser?.uid;
    if (!uid) {
      setSyncState('local');
      return;
    }

    // Load local storage first so we don't wipe it on page load
    const parsedLocal = await get(LOCAL_STORAGE_KEY) || {};

    // Snapshot of current local state (from storage or memory) for safe merge
    const localProfile = profile || parsedLocal.profile;
    const localFoods = foodLogs.length > 0 ? [...foodLogs] : (parsedLocal.foodLogs || []);
    const localBioHistory = biomarkerHistory.length > 0 ? [...biomarkerHistory] : (parsedLocal.biomarkerHistory || []);
    const localActions = actions.length > 0 ? [...actions] : (parsedLocal.actions || []);
    const localBenefits = dailyBenefits.length > 0 ? [...dailyBenefits] : (parsedLocal.dailyBenefits || []);
    const localReport = report || parsedLocal.report;

    // Immediately populate state from local storage so the UI is responsive
    if (parsedLocal && !profile) {
      if (parsedLocal.profile) setProfile(parsedLocal.profile);
      // We omit setFoodLogs here since foodLogs is natively managed by onSnapshot and localStorage stores it as empty []
      if (parsedLocal.biomarkers) setBiomarkers(parsedLocal.biomarkers);
      if (parsedLocal.biomarkerHistory) setBiomarkerHistory(parsedLocal.biomarkerHistory);
      if (parsedLocal.actions) setActions(parsedLocal.actions);
      if (parsedLocal.dailyBenefits) setDailyBenefits(parsedLocal.dailyBenefits);
      if (parsedLocal.report) setReport(parsedLocal.report);
    }

    setSyncState('syncing');
    const syncRootId = logInteraction('sync', `users/${uid} (Full Check)`, null);

    let tProfileId = '';
    let tFoodsId = '';
    let tBioId = '';
    let tActsId = '';
    let tBensId = '';
    let tRepId = '';

    try {
      const userDocRef = doc(db, 'users', uid);
      let userDoc;
      tProfileId = logInteraction('download', `users/${uid} (Profile)`, null);
      try {
        userDoc = await getDocFromServer(userDocRef);
        completeInteraction(tProfileId, true, userDoc.exists() ? JSON.stringify(userDoc.data()).length : 0);
      } catch (err) {
        console.warn("getDocFromServer failed, falling back to local/cached getDoc:", err);
        userDoc = await getDoc(userDocRef);
        completeInteraction(tProfileId, true, userDoc.exists() ? JSON.stringify(userDoc.data()).length : 0);
      }

      if (userDoc.exists()) {
        const cloudProfile = userDoc.data() as UserProfile;
        
        const cloudTime = cloudProfile.lastUpdatedAt || 0;
        const localTime = localProfile?.lastUpdatedAt || 0;

        let mergedProfile: UserProfile;
        let foods: FoodLog[] = [];
        let bioHistory: BiomarkerLog[] = [];
        let acts: HealthAction[] = [];
        let bens: DailyBenefit[] = [];
        let cloudReport: RecommendationReport | null = null;

        // Optimization: if cloud lastUpdatedAt matches local lastUpdatedAt and we have local data, we skip subcollection reads
        const canSkipFetch = !!(
          localProfile &&
          localProfile.lastUpdatedAt &&
          cloudProfile.lastUpdatedAt &&
          cloudProfile.lastUpdatedAt === localProfile.lastUpdatedAt &&
          parsedLocal.foodLogs &&
          parsedLocal.biomarkerHistory
        );

        if (canSkipFetch) {
          console.log("[Sync] Local data is fully up-to-date with cloud timestamp:", cloudProfile.lastUpdatedAt);
          mergedProfile = cloudProfile;
          foods = localFoods;
          bioHistory = localBioHistory;
          acts = localActions;
          bens = localBenefits;
          cloudReport = localReport;
        } else {
          tFoodsId = logInteraction('download', `users/${uid}/foodLogs`, null);
          tBioId = logInteraction('download', `users/${uid}/biomarkerHistory`, null);
          tActsId = logInteraction('download', `users/${uid}/actions`, null);
          tBensId = logInteraction('download', `users/${uid}/dailyBenefits`, null);
          tRepId = logInteraction('download', `users/${uid}/reports/latest`, null);

          // By using getDocs and getDoc (not FromServer), Firestore can utilize its local cache if configured,
          // and won't throw if offline, gracefully degrading to cached data.
          // Note: foodLogs is now managed by onSnapshot listener to save reads/bandwidth
          foods = []; // Handled by onSnapshot
          completeInteraction(tFoodsId, true, 0);

          // 1. Fetch biomarker history robustly
          try {
            const bioHistorySnap = await getDocs(collection(db, 'users', uid, 'biomarkerHistory'));
            bioHistory = bioHistorySnap.docs.map(d => d.data() as BiomarkerLog);
            completeInteraction(tBioId, true, bioHistorySnap.docs.reduce((acc, d) => acc + JSON.stringify(d.data()).length, 0), undefined, bioHistorySnap.size);
          } catch (bioErr: any) {
            console.warn("Failed to fetch biomarkerHistory:", bioErr);
            bioHistory = localBioHistory; // Fallback to local
            completeInteraction(tBioId, false, 0, bioErr.message || String(bioErr));
          }

          // 2. Fetch dashboard metadata robustly
          try {
            const dashboardDoc = await getDoc(doc(db, 'users', uid, 'metadata', 'dashboard'));
            if (dashboardDoc.exists()) {
              const data = dashboardDoc.data();
              acts = (data.actions || []) as HealthAction[];
              bens = (data.dailyBenefits || []) as DailyBenefit[];
              setFoodIdeas((data.foodIdeas || []) as FoodIdea[]);
            } else {
              acts = localActions;
              bens = localBenefits;
            }
            completeInteraction(tActsId, true, JSON.stringify(acts).length);
            completeInteraction(tBensId, true, JSON.stringify(bens).length);
          } catch (dashErr: any) {
            console.warn("Failed to fetch dashboard metadata:", dashErr);
            acts = localActions;
            bens = localBenefits;
            completeInteraction(tActsId, false, 0, dashErr.message || String(dashErr));
            completeInteraction(tBensId, false, 0, dashErr.message || String(dashErr));
          }

          // 3. Fetch reports robustly
          try {
            const latestReportDoc = await getDoc(doc(db, 'users', uid, 'reports', 'latest'));
            cloudReport = latestReportDoc.exists() ? (latestReportDoc.data() as RecommendationReport) : null;
            completeInteraction(tRepId, true, latestReportDoc.exists() ? JSON.stringify(latestReportDoc.data()).length : 0);
          } catch (repErr: any) {
            console.warn("Failed to fetch reports:", repErr);
            cloudReport = localReport;
            completeInteraction(tRepId, false, 0, repErr.message || String(repErr));
          }

          if (cloudTime >= localTime) {
            console.log("[Sync] Cloud profile is newer or equal. Overwriting local with cloud.");
            mergedProfile = cloudProfile;
          } else {
            console.log("[Sync] Local profile is newer. Pushing local to cloud.");
            mergedProfile = localProfile;
            foods = localFoods;
            bioHistory = localBioHistory;
            acts = localActions;
            bens = localBenefits;
            cloudReport = localReport;

            // Trigger background save and sync
            setTimeout(() => {
              saveAndSync(localProfile, localFoods, biomarkers, localBioHistory, localActions, localBenefits, localReport);
            }, 50);
          }
        }

        // Apply loaded values merged with local state to React states
        const mergedFoods = [...foods];
        localFoods.forEach(localFood => {
          const existingCloudIndex = mergedFoods.findIndex(f => f.id === localFood.id);
          if (existingCloudIndex === -1) {
            mergedFoods.push(localFood);
          } else {
            const cloudFood = mergedFoods[existingCloudIndex];
            mergedFoods[existingCloudIndex] = {
              ...cloudFood,
              ...localFood,
              imageUrl: localFood.imageUrl || cloudFood.imageUrl,
              imageUrls: (localFood.imageUrls && localFood.imageUrls.length > 0) ? localFood.imageUrls : cloudFood.imageUrls,
            };
          }
        });

        const mergedBioHistory = [...bioHistory];
        localBioHistory.forEach(localLog => {
          const existingCloudIndex = mergedBioHistory.findIndex(b => b.id === localLog.id);
          if (existingCloudIndex === -1) {
            mergedBioHistory.push(localLog);
          } else {
            mergedBioHistory[existingCloudIndex] = { ...mergedBioHistory[existingCloudIndex], ...localLog };
          }
        });

        const mergedActions = [...acts];
        localActions.forEach(localAct => {
          const existingCloudIndex = mergedActions.findIndex(a => a.id === localAct.id);
          if (existingCloudIndex === -1) {
            mergedActions.push(localAct);
          } else {
            mergedActions[existingCloudIndex] = { ...mergedActions[existingCloudIndex], ...localAct };
          }
        });

        const mergedBenefits = [...bens];
        localBenefits.forEach(localBen => {
          const existingCloudIndex = mergedBenefits.findIndex(b => b.id === localBen.id);
          if (existingCloudIndex === -1) {
            mergedBenefits.push(localBen);
          } else {
            mergedBenefits[existingCloudIndex] = { ...mergedBenefits[existingCloudIndex], ...localBen };
          }
        });

        setProfile(mergedProfile);
        setFoodLogs(mergedFoods);
        setBiomarkerHistory(mergedBioHistory);
        setActions(mergedActions);
        setDailyBenefits(mergedBenefits);
        setReport(cloudReport);

        // Recompute active biomarkers (sorted ascending so that newer logs overwrite older values)
        const computedBiomarkers: { [key: string]: number | string } = {};
        [...mergedBioHistory].sort((a, b) => a.date.localeCompare(b.date)).forEach(log => {
          Object.entries(log.biomarkers).forEach(([k, v]) => {
            computedBiomarkers[k] = v;
          });
        });
        setBiomarkers(computedBiomarkers);

        // Write bundle back to local storage
        const bundle = {
          profile: mergedProfile,
          foodLogs: mergedFoods,
          biomarkers: computedBiomarkers,
          biomarkerHistory: mergedBioHistory,
          actions: mergedActions,
          dailyBenefits: mergedBenefits,
          report: cloudReport
        };
        safeSaveToLocalStorage(LOCAL_STORAGE_KEY, bundle);
        // Add a small delay for delightful visual feedback
        await new Promise(resolve => setTimeout(resolve, 800));
        setSyncState('synced');
        completeInteraction(syncRootId, true, 0);
      } else if (localProfile && Object.keys(localProfile).length > 0) {
        // Cloud doc is empty, but we have local data! Cloud save probably failed earlier.
        // Let's assume local is the source of truth and restore it.
        setProfile(localProfile);
        setFoodLogs(localFoods);
        setBiomarkerHistory(localBioHistory);
        setActions(localActions);
        setDailyBenefits(localBenefits);
        setReport(localReport);
        
        // Recompute active biomarkers (sorted ascending so that newer logs overwrite older values)
        const computedBiomarkers: { [key: string]: number | string } = {};
        [...localBioHistory].sort((a, b) => a.date.localeCompare(b.date)).forEach((log: BiomarkerLog) => {
          Object.entries(log.biomarkers).forEach(([k, v]) => {
            computedBiomarkers[k] = v as string | number;
          });
        });
        setBiomarkers(computedBiomarkers);

        const bundle = {
          profile: localProfile,
          foodLogs: localFoods,
          biomarkers: computedBiomarkers,
          biomarkerHistory: localBioHistory,
          actions: localActions,
          dailyBenefits: localBenefits,
          report: localReport
        };
        safeSaveToLocalStorage(LOCAL_STORAGE_KEY, bundle);

        // Try syncing profile to cloud in background
        const tNewProfileId = logInteraction('upload', `users/${uid} (Restore Profile)`, localProfile);
        setDoc(userDocRef, cleanData(localProfile), { merge: true })
          .then(() => completeInteraction(tNewProfileId, true, JSON.stringify(localProfile).length))
          .catch(err => { completeInteraction(tNewProfileId, false, 0, err.message); console.error(err); });

        await new Promise(resolve => setTimeout(resolve, 800));
        setSyncState('synced');
        completeInteraction(syncRootId, true, 0);
      } else {
        // Brand new sign up - create profile in Firestore
        const isDemoUser = auth.currentUser?.email?.toLowerCase() === 'john@mail.com';
        
        const newProfile: UserProfile = {
          nickname: isDemoUser ? 'John Doe' : '',
          photoUrl: auth.currentUser?.photoURL || (isDemoUser ? 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=120' : ''),
          email: auth.currentUser?.email || '',
          age: isDemoUser ? 35 : '' as any,
          ethnicity: isDemoUser ? 'Caucasian' : 'Unknown',
          weight: isDemoUser ? 75 : '' as any,
          height: isDemoUser ? 178 : '' as any,
          gender: isDemoUser ? 'Male' : 'Unknown',
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          language: 'en'
        };

        const tNewProfileId = logInteraction('upload', `users/${uid} (Create Profile)`, newProfile);
        setDoc(userDocRef, cleanData(newProfile))
          .then(() => completeInteraction(tNewProfileId, true, JSON.stringify(newProfile).length))
          .catch(err => { completeInteraction(tNewProfileId, false, 0, err.message); console.error(err); });
        
        setProfile(newProfile);

        let initialActions: HealthAction[] = [];
        let initialBenefits: DailyBenefit[] = [];

        if (isDemoUser) {
          initialActions = [
            {
              id: 'init_act_1',
              task: 'Schedule primary physician physical consultation',
              explanation: 'Consult your doctor before initiating heavy nutrient restrictions or supplement additions.',
              priority: 'high',
              completed: false,
              type: 'doctor'
            },
            {
              id: 'init_act_2',
              task: 'Complete basic fasting blood panel tests',
              explanation: 'Obtain ApoB, LDL-C, fasting glucose, and HbA1c values for precise target generation.',
              priority: 'high',
              completed: false,
              type: 'test'
            }
          ];

          initialBenefits = [
            { id: 'init_ben_1', activity: 'Walk briskly for 30 minutes', target: 'Daily', completed: false },
            { id: 'init_ben_2', activity: 'Add high-fiber foods to your breakfast', target: 'Daily', completed: false }
          ];

          // Write to Firestore dashboard document to prevent multiple writes
          const tDashId = logInteraction('upload', `users/${uid}/metadata/dashboard`, null);
          setDoc(doc(db, 'users', uid, 'metadata', 'dashboard'), {
            actions: initialActions.map(cleanData),
            dailyBenefits: initialBenefits.map(cleanData)
          }, { merge: true })
            .then(() => completeInteraction(tDashId, true, JSON.stringify({ actions: initialActions, dailyBenefits: initialBenefits }).length))
            .catch(err => { completeInteraction(tDashId, false, 0, err.message); console.error(err); });
        }

        setFoodLogs([]);
        setBiomarkers({});
        setBiomarkerHistory([]);
        setActions(initialActions);
        setDailyBenefits(initialBenefits);
        setReport(null);

        // Local storage cache
        const bundle = {
          profile: newProfile,
          foodLogs: [],
          biomarkers: {},
          biomarkerHistory: [],
          actions: initialActions,
          dailyBenefits: initialBenefits,
          report: null
        };
        safeSaveToLocalStorage(LOCAL_STORAGE_KEY, bundle);
        // Add a small delay for delightful visual feedback
        await new Promise(resolve => setTimeout(resolve, 800));
        setSyncState('synced');
        completeInteraction(syncRootId, true, 0);

        setActiveTab('medical');
      }
    } catch (err: any) {
      console.error("Error checking or syncing database changes:", err);
      setSyncState('local');
      completeInteraction(syncRootId, false, 0, err.message || 'Database error');
      if (tProfileId) completeInteraction(tProfileId, false, 0, err.message);
      if (tFoodsId) completeInteraction(tFoodsId, false, 0, err.message);
      if (tBioId) completeInteraction(tBioId, false, 0, err.message);
      if (tActsId) completeInteraction(tActsId, false, 0, err.message);
      if (tBensId) completeInteraction(tBensId, false, 0, err.message);
      if (tRepId) completeInteraction(tRepId, false, 0, err.message);
      
      // Fallback to local storage if DB fails
      if (parsedLocal) {
        if (parsedLocal.profile) setProfile(parsedLocal.profile);
        if (parsedLocal.foodLogs) setFoodLogs(parsedLocal.foodLogs);
        if (parsedLocal.biomarkers) setBiomarkers(parsedLocal.biomarkers);
        if (parsedLocal.biomarkerHistory) setBiomarkerHistory(parsedLocal.biomarkerHistory);
        if (parsedLocal.actions) setActions(parsedLocal.actions);
        if (parsedLocal.dailyBenefits) setDailyBenefits(parsedLocal.dailyBenefits);
        if (parsedLocal.report) setReport(parsedLocal.report);
      }
    }
  };

  // Initialize from Firebase Auth and Firestore on mount
  useEffect(() => {
    let unsubs: (() => void)[] = [];
    
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      unsubs.forEach(u => u());
      unsubs = [];
      
      try {
        if (user) {
          // Real-time Firestore listener for profile to sync nickname, weight, etc. across devices
          unsubs.push(onSnapshot(
            doc(db, 'users', user.uid),
            (docSnap) => {
              if (docSnap.exists()) {
                const cloudProfile = docSnap.data() as UserProfile;
                setProfile(prev => {
                  if (!prev || !prev.lastUpdatedAt || !cloudProfile.lastUpdatedAt || cloudProfile.lastUpdatedAt > prev.lastUpdatedAt) {
                    return cloudProfile;
                  }
                  return prev;
                });
              }
            },
            (error) => {
              console.warn("Firestore profile onSnapshot error:", error);
            }
          ));

          // Listen to foodLogs natively via Firestore to prevent large collection reads (14k read quota issue)
          // and to ensure images are loaded perfectly from the local IndexedDB cache.
          unsubs.push(onSnapshot(
            collection(db, 'users', user.uid, 'foodLogs'),
            (snap) => {
              const cloudFoods = snap.docs.map(d => d.data() as FoodLog);
              setFoodLogs(prevFoods => {
                const merged = [...cloudFoods];
                prevFoods.forEach(localFood => {
                  if (localFood && localFood.id) {
                    const exists = merged.some(f => f.id === localFood.id);
                    if (!exists && (localFood.id.startsWith('food_') || localFood.id.startsWith('food_manual_'))) {
                      merged.push(localFood);
                    }
                  }
                });
                return merged;
              });
            },
            (error) => {
              console.warn("Firestore onSnapshot error (likely quota):", error);
              // Fallback to reading from local IndexedDB cache if quota exceeded
              getDocsFromCache(collection(db, 'users', user.uid, 'foodLogs'))
                .then(cacheSnap => {
                  const cloudFoods = cacheSnap.docs.map(d => d.data() as FoodLog);
                  setFoodLogs(prevFoods => {
                    const merged = [...cloudFoods];
                    prevFoods.forEach(localFood => {
                      if (localFood && localFood.id) {
                        const exists = merged.some(f => f.id === localFood.id);
                        if (!exists && (localFood.id.startsWith('food_') || localFood.id.startsWith('food_manual_'))) {
                          merged.push(localFood);
                        }
                      }
                    });
                    return merged;
                  });
                })
                .catch(cacheErr => {
                  console.warn("Failed to read from cache after snapshot error:", cacheErr);
                });
            }
          ));

          // Real-time Firestore listener for biomarkerHistory to keep medical history synced across devices
          unsubs.push(onSnapshot(
            collection(db, 'users', user.uid, 'biomarkerHistory'),
            (snap) => {
              const updatedHistory = snap.docs.map(d => d.data() as BiomarkerLog);
              setBiomarkerHistory(updatedHistory);
              
              // Recompute active biomarkers in real-time
              const computedBiomarkers: { [key: string]: number | string } = {};
              [...updatedHistory].sort((a, b) => a.date.localeCompare(b.date)).forEach(log => {
                Object.entries(log.biomarkers).forEach(([k, v]) => {
                  computedBiomarkers[k] = v;
                });
              });
              setBiomarkers(computedBiomarkers);
            },
            (error) => {
              console.warn("Firestore biomarkerHistory onSnapshot error (likely quota):", error);
              // Fallback to reading from local IndexedDB cache if snapshot fails
              getDocsFromCache(collection(db, 'users', user.uid, 'biomarkerHistory'))
                .then(cacheSnap => {
                  const updatedHistory = cacheSnap.docs.map(d => d.data() as BiomarkerLog);
                  setBiomarkerHistory(updatedHistory);
                  
                  const computedBiomarkers: { [key: string]: number | string } = {};
                  [...updatedHistory].sort((a, b) => a.date.localeCompare(b.date)).forEach(log => {
                    Object.entries(log.biomarkers).forEach(([k, v]) => {
                      computedBiomarkers[k] = v;
                    });
                  });
                  setBiomarkers(computedBiomarkers);
                })
                .catch(cacheErr => {
                  console.warn("Failed to read biomarker history from cache after snapshot error:", cacheErr);
                });
            }
          ));

          const parsedLocal = await get(LOCAL_STORAGE_KEY);
          let hasLocal = false;
          if (parsedLocal) {
            try {
              // Ensure the cached profile matches the logged-in user
              if (parsedLocal.profile && (parsedLocal.profile.email === user.email || !user.email)) {
                hasLocal = true;
                if (parsedLocal.profile) setProfile(parsedLocal.profile);
                if (parsedLocal.foodLogs) setFoodLogs(parsedLocal.foodLogs);
                if (parsedLocal.biomarkerHistory) setBiomarkerHistory(parsedLocal.biomarkerHistory);
                if (parsedLocal.biomarkers) setBiomarkers(parsedLocal.biomarkers);
                if (parsedLocal.actions) setActions(parsedLocal.actions);
                if (parsedLocal.dailyBenefits) setDailyBenefits(parsedLocal.dailyBenefits);
                if (parsedLocal.report) setReport(parsedLocal.report);
                setSyncState('synced');
              }
            } catch (e) {}
          }
          
          // Always fetch and merge the latest changes from the database in the background to ensure synchronization
          checkForDbChanges(user.uid);
        } else {
          // Not signed in, fall back to localStorage if available
          const parsedLocal = await get(LOCAL_STORAGE_KEY);
          if (parsedLocal) {
            try {
              if (parsedLocal.profile) setProfile(parsedLocal.profile);
              if (parsedLocal.foodLogs) setFoodLogs(parsedLocal.foodLogs);
              if (parsedLocal.biomarkers) setBiomarkers(parsedLocal.biomarkers);
              if (parsedLocal.biomarkerHistory) setBiomarkerHistory(parsedLocal.biomarkerHistory);
              if (parsedLocal.actions) setActions(parsedLocal.actions);
              if (parsedLocal.dailyBenefits) setDailyBenefits(parsedLocal.dailyBenefits);
              if (parsedLocal.report) setReport(parsedLocal.report);
            } catch (e) {
              console.error("Failed to restore cached local storage:", e);
            }
          } else {
            setProfile(null);
            setFoodLogs([]);
            setBiomarkers({});
            setBiomarkerHistory([]);
            setActions([]);
            setDailyBenefits([]);
            setReport(null);
          }
          setSyncState('local');
        }
      } catch (err) {
        console.error("Auth session restore failed:", err);
      } finally {
        setIsAuthChecking(false);
      }
    });

    return () => unsubscribe();
  }, []);

  // Keep localStorage updated with React states so that hasLocal and canSkipFetch work flawlessly!
  useEffect(() => {
    if (!profile) return;
    const bundle = {
      profile,
      foodLogs,
      biomarkers,
      biomarkerHistory,
      actions,
      dailyBenefits,
      foodIdeas,
      report
    };
    safeSaveToLocalStorage(LOCAL_STORAGE_KEY, bundle);
  }, [profile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, foodIdeas, report]);

  // Automatically log BMI on initial load if profile has height/weight but BMI is missing from history or biomarkers
  useEffect(() => {
    if (profile && profile.weight && profile.height) {
      const hasBmiInHistory = biomarkerHistory.some(h => h.biomarkers && h.biomarkers.bmi !== undefined);
      const hasBmiInBiomarkers = biomarkers.bmi !== undefined;

      if (!hasBmiInHistory || !hasBmiInBiomarkers) {
        const heightInMeters = Number(profile.height) / 100;
        const bmiScore = Number(profile.weight) / (heightInMeters * heightInMeters);
        const roundedBmi = parseFloat(bmiScore.toFixed(1));
        const recordDate = getCurrentDateInTimezone(profile.timezone);

        setBiomarkers(prev => {
          if (prev.bmi === roundedBmi) return prev;
          return { ...prev, bmi: roundedBmi };
        });

        setBiomarkerHistory(prev => {
          const updatedHistory = [...prev];
          const existingLogIndex = updatedHistory.findIndex(h => h.date === recordDate);
          
          if (existingLogIndex >= 0) {
            if (updatedHistory[existingLogIndex].biomarkers?.bmi === roundedBmi) {
              return prev; // no change
            }
            updatedHistory[existingLogIndex] = {
              ...updatedHistory[existingLogIndex],
              biomarkers: {
                ...updatedHistory[existingLogIndex].biomarkers,
                bmi: roundedBmi
              }
            };
          } else {
            updatedHistory.push({
              id: `med_log_bmi_init_${Date.now()}`,
              date: recordDate,
              biomarkers: {
                bmi: roundedBmi
              },
              note: `Auto-logged default BMI: ${profile.weight} kg, ${profile.height} cm.`
            });
          }
          updatedHistory.sort((a, b) => b.date.localeCompare(a.date));

          // Trigger saveAndSync in background
          setTimeout(() => {
            const updatedBiomarkers = { ...biomarkers, bmi: roundedBmi };
            saveAndSync(profile, foodLogs, updatedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLog', targetId: `med_log_bmi_init_${Date.now()}` });
          }, 0);

          return updatedHistory;
        });
      }
    }
  }, [profile?.weight, profile?.height, biomarkerHistory.length, biomarkers.bmi]);

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

        if (updated) {
          console.log(`Restoring ${updateCount} lost images from chat history`);
          setFoodLogs(newFoodLogs);
          // Fire individual saves for the newly restored logs to ensure cloud sync catches them
          newFoodLogs.forEach(f => {
            const oldLog = foodLogs.find(old => old.id === f.id);
            if (!oldLog?.imageUrl && f.imageUrl) {
               saveAndSync(profile, newFoodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'foodLog', targetId: f.id });
            }
          });
        }
      }
    } catch (e) {
      console.warn("Failed to auto-restore images:", e);
    }
  }, [foodLogs.length]);

  // Save changes to local storage and sync to Server cloud database
  const saveAndSync = async (
    currProfile: UserProfile | null,
    currFoods: FoodLog[],
    currBiomarkers: { [key: string]: number | string },
    currBioHistory: BiomarkerLog[],
    currActions: HealthAction[],
    currBenefits: DailyBenefit[],
    currReport: RecommendationReport | null,
    specificUpdate?: {
      type: 'profile' | 'foodLog' | 'biomarkerLog' | 'actions' | 'dailyBenefits' | 'foodIdeas' | 'report' | 'deleteFood' | 'deleteBiomarker';
      targetId?: string;
    },
    currFoodIdeas: FoodIdea[] = foodIdeas
  ) => {
    const now = Date.now();
    let updatedProfile = currProfile;
    if (currProfile) {
      updatedProfile = {
        ...currProfile,
        lastUpdatedAt: now
      };
      // Keep local state in sync immediately with the timestamped profile
      setProfile(updatedProfile);
    }

    // Save to Local Storage first (Local Save before Upload)
    const bundle = {
      profile: updatedProfile,
      foodLogs: currFoods,
      biomarkers: currBiomarkers,
      biomarkerHistory: currBioHistory,
      actions: currActions,
      dailyBenefits: currBenefits,
      foodIdeas: currFoodIdeas,
      report: currReport
    };
    safeSaveToLocalStorage(LOCAL_STORAGE_KEY, bundle);

    if (!updatedProfile || !auth.currentUser) {
      setSyncState('local');
      return;
    }

    setSyncState('syncing');
    const uid = auth.currentUser.uid;
    const syncRootId = logInteraction('sync', `users/${uid} (${specificUpdate ? specificUpdate.type : 'Save changes'})`, null);

    try {
      if (specificUpdate) {
        // For non-profile updates, we also trigger a quick setDoc on profile to bump lastUpdatedAt in the cloud
        if (specificUpdate.type !== 'profile') {
          setDoc(doc(db, 'users', uid), { lastUpdatedAt: now }, { merge: true }).catch(err => {
            console.warn("Failed to touch lastUpdatedAt timestamp in cloud:", err);
          });
        }

        if (specificUpdate.type === 'profile') {
          const pId = logInteraction('upload', `users/${uid} (Profile)`, updatedProfile);
          await setDoc(doc(db, 'users', uid), cleanData(updatedProfile), { merge: true })
            .then(() => completeInteraction(pId, true, JSON.stringify(updatedProfile).length))
            .catch(err => { completeInteraction(pId, false, 0, err.message); console.error(err); });
        } else if (specificUpdate.type === 'foodLog' && specificUpdate.targetId) {
          const f = currFoods.find(item => item.id === specificUpdate.targetId);
          if (f) {
            const itemTrackId = logInteraction('upload', `users/${uid}/foodLogs/${f.id}`, f);
            await setDoc(doc(db, 'users', uid, 'foodLogs', f.id), cleanData(f))
              .then(() => completeInteraction(itemTrackId, true, JSON.stringify(f).length))
              .catch(err => { completeInteraction(itemTrackId, false, 0, err.message); console.error(err); });
          }
        } else if (specificUpdate.type === 'biomarkerLog' && specificUpdate.targetId) {
          const b = currBioHistory.find(item => item.id === specificUpdate.targetId);
          if (b) {
            const itemTrackId = logInteraction('upload', `users/${uid}/biomarkerHistory/${b.id}`, b);
            await setDoc(doc(db, 'users', uid, 'biomarkerHistory', b.id), cleanData(b))
              .then(() => completeInteraction(itemTrackId, true, JSON.stringify(b).length))
              .catch(err => { completeInteraction(itemTrackId, false, 0, err.message); console.error(err); });
          }
        } else if (specificUpdate.type === 'actions') {
          const itemTrackId = logInteraction('upload', `users/${uid}/metadata/dashboard (Actions)`, null);
          await setDoc(doc(db, 'users', uid, 'metadata', 'dashboard'), { actions: currActions.map(cleanData) }, { merge: true })
            .then(() => completeInteraction(itemTrackId, true, JSON.stringify(currActions).length))
            .catch(err => { completeInteraction(itemTrackId, false, 0, err.message); console.error(err); });
        } else if (specificUpdate.type === 'dailyBenefits') {
          const itemTrackId = logInteraction('upload', `users/${uid}/metadata/dashboard (Benefits)`, null);
          await setDoc(doc(db, 'users', uid, 'metadata', 'dashboard'), { dailyBenefits: currBenefits.map(cleanData) }, { merge: true })
            .then(() => completeInteraction(itemTrackId, true, JSON.stringify(currBenefits).length))
            .catch(err => { completeInteraction(itemTrackId, false, 0, err.message); console.error(err); });
        } else if (specificUpdate.type === 'foodIdeas') {
          const itemTrackId = logInteraction('upload', `users/${uid}/metadata/dashboard (FoodIdeas)`, null);
          await setDoc(doc(db, 'users', uid, 'metadata', 'dashboard'), { foodIdeas: currFoodIdeas.map(cleanData) }, { merge: true })
            .then(() => completeInteraction(itemTrackId, true, JSON.stringify(currFoodIdeas).length))
            .catch(err => { completeInteraction(itemTrackId, false, 0, err.message); console.error(err); });
        } else if (specificUpdate.type === 'report' && currReport) {
          const itemTrackId = logInteraction('upload', `users/${uid}/reports/latest`, currReport);
          await setDoc(doc(db, 'users', uid, 'reports', 'latest'), cleanData(currReport))
            .then(() => completeInteraction(itemTrackId, true, JSON.stringify(currReport).length))
            .catch(err => { completeInteraction(itemTrackId, false, 0, err.message); console.error(err); });
          
          const dashTrackId = logInteraction('upload', `users/${uid}/metadata/dashboard (Report Update)`, null);
          await setDoc(doc(db, 'users', uid, 'metadata', 'dashboard'), {
            actions: currActions.map(cleanData),
            dailyBenefits: currBenefits.map(cleanData)
          }, { merge: true }).catch(console.error);
        } else if (specificUpdate.type === 'deleteFood' && specificUpdate.targetId) {
          const delTrackId = logInteraction('delete', `users/${uid}/foodLogs/${specificUpdate.targetId}`, null);
          await deleteDoc(doc(db, 'users', uid, 'foodLogs', specificUpdate.targetId))
            .then(() => completeInteraction(delTrackId, true, 0))
            .catch(err => { completeInteraction(delTrackId, false, 0, err.message); console.error(err); });
        } else if (specificUpdate.type === 'deleteBiomarker' && specificUpdate.targetId) {
          const delTrackId = logInteraction('delete', `users/${uid}/biomarkerHistory/${specificUpdate.targetId}`, null);
          await deleteDoc(doc(db, 'users', uid, 'biomarkerHistory', specificUpdate.targetId))
            .then(() => completeInteraction(delTrackId, true, 0))
            .catch(err => { completeInteraction(delTrackId, false, 0, err.message); console.error(err); });
        }
      } else {
        const pId = logInteraction('upload', `users/${uid} (Profile)`, currProfile);
        const profilePromise = setDoc(doc(db, 'users', uid), cleanData(currProfile), { merge: true })
          .then(() => completeInteraction(pId, true, JSON.stringify(currProfile).length))
          .catch(err => completeInteraction(pId, false, 0, err.message));
        
        // DANGEROUS: Do NOT mass-overwrite foodLogs and biomarkerHistory here.
        // They are synced granularly via specificUpdate. Mass overwriting from local state
        // risks permanently deleting images/fields if the local React state was stale.
        
        const dashboardPromise = setDoc(doc(db, 'users', uid, 'metadata', 'dashboard'), {
          actions: currActions.map(cleanData),
          dailyBenefits: currBenefits.map(cleanData),
          foodIdeas: currFoodIdeas.map(cleanData)
        }, { merge: true });
        
        let reportPromise = Promise.resolve();
        if (currReport) {
          const itemTrackId = logInteraction('upload', `users/${uid}/reports/latest`, currReport);
          reportPromise = setDoc(doc(db, 'users', uid, 'reports', 'latest'), cleanData(currReport))
            .then(() => completeInteraction(itemTrackId, true, JSON.stringify(currReport).length))
            .catch(err => completeInteraction(itemTrackId, false, 0, err.message));
        }

        // Await these promises so data is not lost on reload
        await Promise.all([
          profilePromise,
          dashboardPromise,
          reportPromise
        ]).catch(err => console.warn('Background sync warning:', err));
      }

      // Artificially enforce a minimum rotation time of 800ms so the user gets clear visual confirmation
      await new Promise(resolve => setTimeout(resolve, 800));
      setSyncState('synced');
      completeInteraction(syncRootId, true, 0);
    } catch (e: any) {
      console.error("[Sync Save Fail]", e);
      setSyncState('local');
      completeInteraction(syncRootId, false, 0, e.message || 'Save error');
    }
  };

  // Sync Check on Login / Fetch user record if existing on server
  const handleLogin = async (loggedProfile: UserProfile) => {
    setProfile(loggedProfile);
    if (auth.currentUser) {
      await checkForDbChanges(auth.currentUser.uid);
    } else {
      setSyncState('synced');
    }
  };

  const handleSignOut = async () => {
    try {
      await fbSignOut(auth);
      setProfile(null);
      // Removed localStorage clear to preserve data in case cloud sync is out of quota
    } catch (e) {
      console.error("Failed to sign out from Firebase:", e);
    }
  };

  // Selected LLM Engine shared across sections - Gemini 3.1 Flash Lite is the default model
  const [selectedModelId, setSelectedModelId] = useState<string>('gemini-3.1-flash-lite');

  // Add / Edit logs handlers
  const handleLogFood = async (food: FoodLog) => {
    const updatedFoods = [...foodLogs, food];
    setFoodLogs(updatedFoods);
    setIsFoodChatOpen(false);
    setActiveTab('home');
    await saveAndSync(profile, updatedFoods, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'foodLog', targetId: food.id });
  };

  const handleUpdateFoodLog = async (updatedLog: FoodLog) => {
    const updatedFoods = foodLogs.map(f => f.id === updatedLog.id ? updatedLog : f);
    setFoodLogs(updatedFoods);
    await saveAndSync(profile, updatedFoods, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'foodLog', targetId: updatedLog.id });
  };

  const handleDeleteFoodLog = async (id: string) => {
    const updatedFoods = foodLogs.filter(f => f.id !== id);
    setFoodLogs(updatedFoods);
    await saveAndSync(profile, updatedFoods, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'deleteFood', targetId: id });
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
      const existingLogIndex = updatedHistory.findIndex(h => h.date === recordDate);

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
      updatedHistory.sort((a, b) => b.date.localeCompare(a.date));
      updatedBiomarkers.bmi = roundedBmi;
    }

    return { updatedHistory, updatedBiomarkers, changed: weightChanged || heightChanged || hasNoBmi };
  };

  const handleLogMedical = async (
    extractedBiomarkers: { [key: string]: number | string }, 
    profileUpdates?: Partial<UserProfile>, 
    date?: string, 
    entries?: { date: string | null; biomarkers: { [key: string]: number | string } }[],
    modificationCommand?: { action: 'update_biomarker' | 'update_profile' | 'remove_biomarker'; keyName: string; newValue?: string | number; date?: string }[]
  ) => {
    let currentProfile = profile;
    let updatedHistory = [...biomarkerHistory];
    let updatedBiomarkers = { ...biomarkers };

    // Standardize and normalize extracted biomarkers and custom definitions
    let finalExtracted = { ...extractedBiomarkers };
    let finalProfileUpdates = profileUpdates ? { ...profileUpdates } : undefined;

    const cleanName = (n: string): string => n.split('(')[0].split('[')[0].trim();

    const keyMapping: { [key: string]: string } = {};

    if (finalProfileUpdates && finalProfileUpdates.customBiomarkers && Object.keys(finalProfileUpdates.customBiomarkers).length > 0) {
      const currentCustoms = { ...(profile?.customBiomarkers || {}) };
      const nextCustomDefs: { [key: string]: any } = {};

      Object.entries(finalProfileUpdates.customBiomarkers).forEach(([rawKey, def]) => {
        const rawName = def.name || rawKey;
        const cleaned = cleanName(rawName);

        const normalizeUnit = (u: string) => (u || '').toLowerCase().replace(/[^a-z0-9]/g, '');

        // Check standard match
        const stdMatch = biomarkerDefinitions.find(d => {
          const nameMatch = d.name.toLowerCase() === cleaned.toLowerCase() || d.key.toLowerCase() === cleaned.toLowerCase() || cleanName(d.name).toLowerCase() === cleaned.toLowerCase();
          const unitMatch = !def.unit || !d.unit || normalizeUnit(d.unit) === normalizeUnit(def.unit);
          return nameMatch && unitMatch;
        });
        if (stdMatch) {
          keyMapping[rawKey] = stdMatch.key;
          return; // Map to standard key, drop custom def
        }

        // Check existing custom match
        const existingKey = Object.keys(currentCustoms).find(k => {
          const nameMatch = cleanName(currentCustoms[k]?.name || '').toLowerCase() === cleaned.toLowerCase();
          const keyMatch = k.toLowerCase() === cleaned.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
          return nameMatch || keyMatch;
        });

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
    let targetId: string | undefined = undefined;

    if (modificationCommand && modificationCommand.length > 0) {
      let madeChanges = false;
      modificationCommand.forEach(cmd => {
        if (cmd.action === 'update_biomarker' && cmd.keyName) {
          const targetDate = cmd.date || getCurrentDateInTimezone(profile?.timezone);
          const logIdx = updatedHistory.findIndex(h => h.date === targetDate);
          if (logIdx >= 0 && cmd.newValue !== undefined) {
            updatedHistory[logIdx].biomarkers = {
              ...updatedHistory[logIdx].biomarkers,
              [cmd.keyName]: cmd.newValue
            };
            madeChanges = true;
            hasNewBiomarkers = true;
          }
        } else if (cmd.action === 'remove_biomarker' && cmd.keyName) {
          const targetDate = cmd.date || getCurrentDateInTimezone(profile?.timezone);
          const logIdx = updatedHistory.findIndex(h => h.date === targetDate);
          if (logIdx >= 0 && updatedHistory[logIdx].biomarkers[cmd.keyName] !== undefined) {
            const newBiomarkers = { ...updatedHistory[logIdx].biomarkers };
            delete newBiomarkers[cmd.keyName];
            updatedHistory[logIdx].biomarkers = newBiomarkers;
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

    entriesToProcess.forEach(entry => {
      // Standardize extracted keys
      const mappedExtracted: { [key: string]: number | string } = {};
      Object.entries(entry.biomarkers || {}).forEach(([rawKey, val]) => {
        // Ignore age, height, weight from extracted biomarkers
        if (rawKey === 'weight' || rawKey === 'height' || rawKey === 'age') return;

        if (biomarkerDefinitions.some(d => d.key === rawKey)) {
          mappedExtracted[rawKey] = val;
          return;
        }
        if (keyMapping[rawKey]) {
          mappedExtracted[keyMapping[rawKey]] = val;
          return;
        }

        // Check name match directly
        const cleaned = cleanName(rawKey.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '));
        const stdMatch = biomarkerDefinitions.find(d => d.name.toLowerCase() === cleaned.toLowerCase() || cleanName(d.name).toLowerCase() === cleaned.toLowerCase());
        if (stdMatch) {
          mappedExtracted[stdMatch.key] = val;
          return;
        }

        const existingCustoms = { ...(profile?.customBiomarkers || {}) };
        const custMatchKey = Object.keys(existingCustoms).find(k => cleanName(existingCustoms[k]?.name || '').toLowerCase() === cleaned.toLowerCase());
        if (custMatchKey) {
          mappedExtracted[custMatchKey] = val;
          return;
        }

        const safeKey = cleaned.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        const finalKey = safeKey || rawKey;
        mappedExtracted[finalKey] = val;
      });

      if (Object.keys(mappedExtracted).length > 0) {
        hasNewBiomarkers = true;
        const recordDate = entry.date || getCurrentDateInTimezone(profile?.timezone);
        const existingLogIndex = updatedHistory.findIndex(h => h.date === recordDate);
        if (existingLogIndex >= 0) {
          // Merge with existing log for this date
          updatedHistory[existingLogIndex] = {
            ...updatedHistory[existingLogIndex],
            biomarkers: { ...updatedHistory[existingLogIndex].biomarkers, ...mappedExtracted }
          };
          targetId = updatedHistory[existingLogIndex].id;
        } else {
          const datedLog: BiomarkerLog = {
            id: `med_log_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            date: recordDate,
            biomarkers: mappedExtracted
          };
          updatedHistory.push(datedLog);
          targetId = datedLog.id;
        }
      }
    });

    if (finalProfileUpdates && Object.keys(finalProfileUpdates).length > 0) {
      if (typeof finalProfileUpdates.age === 'string') finalProfileUpdates.age = parseFloat(finalProfileUpdates.age) || finalProfileUpdates.age;
      if (typeof finalProfileUpdates.weight === 'string') finalProfileUpdates.weight = parseFloat(finalProfileUpdates.weight) || finalProfileUpdates.weight;
      if (typeof finalProfileUpdates.height === 'string') finalProfileUpdates.height = parseFloat(finalProfileUpdates.height) || finalProfileUpdates.height;
      const nextProfile = { ...profile, ...finalProfileUpdates };
      const bmiRes = logBmiIfProfileWeightHeightChanged(profile, nextProfile, updatedHistory, updatedBiomarkers);
      currentProfile = nextProfile;
      updatedHistory = bmiRes.updatedHistory;
      updatedBiomarkers = bmiRes.updatedBiomarkers;
      setProfile(currentProfile);
      setBiomarkerHistory(updatedHistory);
      setBiomarkers(updatedBiomarkers);
    }

    if (hasNewBiomarkers) {
      // Sort history by date descending
      updatedHistory.sort((a, b) => b.date.localeCompare(a.date));

      setBiomarkerHistory(updatedHistory);

      // Recompute the latest biomarkers from history so they reflect the latest dates (sorted ascending)
      const recomputedBiomarkers: { [key: string]: number | string } = {};
      [...updatedHistory].sort((a, b) => a.date.localeCompare(b.date)).forEach(log => {
        Object.entries(log.biomarkers).forEach(([k, v]) => {
          recomputedBiomarkers[k] = v as string | number;
        });
      });
      setBiomarkers(recomputedBiomarkers);

      setIsMedicalChatOpen(false);
      setActiveTab('home');

      await saveAndSync(currentProfile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLog', targetId });
    } else {
      setIsMedicalChatOpen(false);
      setActiveTab('home');
      await saveAndSync(currentProfile, foodLogs, updatedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'profile' });
    }
  };

  const handleDeleteBiomarkerLog = async (id: string) => {
    const updatedHistory = biomarkerHistory.filter(b => b.id !== id);
    setBiomarkerHistory(updatedHistory);

    const recomputedBiomarkers: { [key: string]: number | string } = {};
    [...updatedHistory].sort((a, b) => a.date.localeCompare(b.date)).forEach(log => {
      Object.entries(log.biomarkers).forEach(([k, v]) => {
        recomputedBiomarkers[k] = v as string | number;
      });
    });
    setBiomarkers(recomputedBiomarkers);

    await saveAndSync(profile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'deleteBiomarker', targetId: id });
  };

  const handleEditBiomarkerLog = async (id: string, key: string, value: string | number, newDate?: string) => {
    const updatedHistory = biomarkerHistory.map(log => {
      if (log.id === id) {
        const numValue = typeof value === 'string' ? parseFloat(value) : value;
        return {
          ...log,
          date: newDate || log.date,
          biomarkers: {
            ...log.biomarkers,
            [key]: isNaN(numValue) ? value : numValue
          }
        };
      }
      return log;
    });

    updatedHistory.sort((a, b) => b.date.localeCompare(a.date));

    setBiomarkerHistory(updatedHistory);

    const recomputedBiomarkers: { [key: string]: number | string } = {};
    [...updatedHistory].sort((a, b) => a.date.localeCompare(b.date)).forEach(log => {
      Object.entries(log.biomarkers).forEach(([k, v]) => {
        recomputedBiomarkers[k] = v as string | number;
      });
    });
    setBiomarkers(recomputedBiomarkers);

    await saveAndSync(profile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLog', targetId: id });
  };

  const handleCombineBiomarkers = async (
    targetKey: string,
    targetDef: { name: string; unit: string; normalRange: string; description: string },
    mergedLogs: { date: string; value: number | string; originalLogId?: string }[],
    sourceKeysToDelete: string[]
  ) => {
    // 1. Remove old custom definitions, and add the new one if custom
    const updatedCustomBiomarkers = { ...(profile?.customBiomarkers || {}) };
    sourceKeysToDelete.forEach(k => {
      delete updatedCustomBiomarkers[k];
    });

    const isStandard = biomarkerDefinitions.some(d => d.key === targetKey);
    if (!isStandard) {
      updatedCustomBiomarkers[targetKey] = {
        name: targetDef.name,
        unit: targetDef.unit,
        normalRange: targetDef.normalRange,
        description: targetDef.description,
        benefitRisk: ''
      };
    }

    const updatedProfile: UserProfile = {
      ...profile,
      customBiomarkers: updatedCustomBiomarkers
    };

    // 2. Remove old keys from history and merge the consolidated logs
    let updatedHistory = biomarkerHistory.map(log => {
      const cleanBiomarkers = { ...log.biomarkers };
      sourceKeysToDelete.forEach(k => {
        delete cleanBiomarkers[k];
      });
      return {
        ...log,
        biomarkers: cleanBiomarkers
      };
    });

    // Merge Consolidated
    mergedLogs.forEach(ml => {
      let existingIndex = -1;
      if (ml.originalLogId) {
        existingIndex = updatedHistory.findIndex(h => h.id === ml.originalLogId);
      }
      if (existingIndex < 0) {
        existingIndex = updatedHistory.findIndex(h => h.date === ml.date);
      }

      if (existingIndex >= 0) {
        updatedHistory[existingIndex] = {
          ...updatedHistory[existingIndex],
          biomarkers: {
            ...updatedHistory[existingIndex].biomarkers,
            [targetKey]: ml.value
          }
        };
      } else {
        updatedHistory.push({
          id: `med_log_combined_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          date: ml.date,
          biomarkers: {
            [targetKey]: ml.value
          }
        });
      }
    });

    // Clean completely empty history logs
    updatedHistory = updatedHistory.filter(h => Object.keys(h.biomarkers).length > 0);
    updatedHistory.sort((a, b) => b.date.localeCompare(a.date));

    // 3. Recompute latest biomarkers
    const recomputedBiomarkers: { [key: string]: number | string } = {};
    [...updatedHistory].sort((a, b) => a.date.localeCompare(b.date)).forEach(log => {
      Object.entries(log.biomarkers).forEach(([k, v]) => {
        recomputedBiomarkers[k] = v as string | number;
      });
    });

    setProfile(updatedProfile);
    setBiomarkerHistory(updatedHistory);
    setBiomarkers(recomputedBiomarkers);

    await saveAndSync(updatedProfile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'profile' });
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

    let updatedReport = report ? { ...report } : getLocalFallbackReport(profile);
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
      const response = await fetch('/api/gemini/insight-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userProfile: profile,
          foodLogs,
          biomarkerHistory,
          engine: modelId,
          refinement
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      const resData = await response.json();
      if (resData.error) throw new Error(resData.error);

      if (resData.report) {
        setDraftReport(resData.report);
      }
    } catch (err: any) {
      clearTimeout(timeoutId);
      console.error("Analysis generation error/timeout:", err);
      if (err.name === 'AbortError') {
        alert('Server took longer than expected to complete profiling. Activating specialized local preventative engine fallback.');
        const fallback = getLocalFallbackReport(profile);
        setDraftReport(fallback);
      } else {
        alert(`Failed to complete analysis: ${err.message || 'Server timeout. Activating high-fidelity fallback.'}`);
        const fallback = getLocalFallbackReport(profile);
        setDraftReport(fallback);
      }
    } finally {
      setIsGenerating(false);
    }
  };

  // Render Screens based on active tab
  if (isAuthChecking) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3">
          <Loader className="w-8 h-8 text-indigo-600 animate-spin" />
          <p className="text-xs font-semibold text-slate-500 animate-pulse">Checking your health portal...</p>
        </div>
      </div>
    );
  }

  if (!profile) {
    return <AuthScreen onLogin={handleLogin} />;
  }

  // Floating Action Button (FAB) rules:
  // - Home, Food, Trends tabs show '+' for adding food log.
  // - Medical, Insights tabs show 'Medical icon' for adding medical records chat logs.
  const isMedicalTabFAB = ['medical', 'insights'].includes(activeTab);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col transition-colors duration-200">
      <style dangerouslySetInnerHTML={{ __html: getDynamicStyles(profile) }} />
      
      {/* Header Profile Section */}
      <Header
        profile={profile}
        setProfile={(p) => {
          setProfile(p);
          const bundle = {
            profile: p,
            foodLogs,
            biomarkers,
            biomarkerHistory,
            actions,
            dailyBenefits,
            report
          };
          safeSaveToLocalStorage(LOCAL_STORAGE_KEY, bundle);
        }}
        onSaveProfile={async (p) => {
          const updatedProfile = { ...p };
          const { updatedHistory, updatedBiomarkers, changed } = logBmiIfProfileWeightHeightChanged(profile, updatedProfile, biomarkerHistory, biomarkers);
          setProfile(updatedProfile);
          if (changed) {
            setBiomarkerHistory(updatedHistory);
            setBiomarkers(updatedBiomarkers);
            await saveAndSync(updatedProfile, foodLogs, updatedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'profile' });
          } else {
            await saveAndSync(updatedProfile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'profile' });
          }
        }}
        hideSensitive={hideSensitive}
        setHideSensitive={setHideSensitive}
        syncState={syncState}
        onSignOut={handleSignOut}
        onCloudSync={() => checkForDbChanges()}
        dbInteractions={dbInteractions}
        quota={quota}
        foodLogs={foodLogs}
        activeTab={activeTab}
      />

      {/* Main Viewport Container */}
      <main className="flex-1 overflow-x-hidden">
        {activeTab === 'home' && (
          <HomeTab
            profile={profile}
            foodLogs={foodLogs}
            biomarkers={biomarkers}
            biomarkerHistory={biomarkerHistory}
            actions={actions}
            setActions={async (act) => {
              setActions(act);
              await saveAndSync(profile, foodLogs, biomarkers, biomarkerHistory, act, dailyBenefits, report, { type: 'actions' });
            }}
            dailyBenefits={dailyBenefits}
            setDailyBenefits={async (ben) => {
              setDailyBenefits(ben);
              await saveAndSync(profile, foodLogs, biomarkers, biomarkerHistory, actions, ben, report, { type: 'dailyBenefits' });
            }}
            foodIdeas={foodIdeas}
            setFoodIdeas={async (ideas) => {
              setFoodIdeas(ideas);
              await saveAndSync(profile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'foodIdeas' }, ideas);
            }}
            report={report}
            onNavigateToTab={setActiveTab}
            onEditBiomarkerLog={handleEditBiomarkerLog}
            onDeleteBiomarkerLog={handleDeleteBiomarkerLog}
            onLogMedical={handleLogMedical}
            onOpenAgentChat={(agentType: 'agent1' | 'agent2' | 'agent3' | 'agent4' | 'agent5') => {
              setActiveAgentType(agentType);
              setIsMedicalChatOpen(true);
            }}
            hideSensitive={hideSensitive}
            selectedModelId={selectedModelId}
            onChangeModelId={setSelectedModelId}
            hasBmiAlert={profile ? hasBmiPendingAlert(profile, dismissedBmiAlerts, report) : false}
            onDismissBmiAlert={handleDismissBmiAlert}
            onApplyCalculation={handleApplyCalculation}
          />
        )}

        {activeTab === 'insights' && (
          <InsightsTab
            profile={profile}
            foodLogs={foodLogs}
            biomarkers={biomarkers}
            report={report}
            draftReport={draftReport}
            onAcceptReport={handleAcceptReport}
            onRejectReport={handleRejectReport}
            selectedModelId={selectedModelId}
            onChangeModelId={setSelectedModelId}
            onGenerateReport={handleGenerateReport}
            isGenerating={isGenerating}
            onNavigateToTab={setActiveTab}
            onOpenMedicalChat={() => setIsMedicalChatOpen(true)}
          />
        )}

        {activeTab === 'food' && (
          <FoodHistoryTab
            profile={profile}
            foodLogs={foodLogs}
            onUpdateFoodLog={handleUpdateFoodLog}
            onDeleteFoodLog={handleDeleteFoodLog}
            onLogFood={handleLogFood}
            onEditingActiveChange={setIsEditingFoodLog}
          />
        )}

        {activeTab === 'medical' && (
          <MedicalHistoryTab
            profile={profile}
            biomarkers={biomarkers}
            biomarkerHistory={biomarkerHistory}
            hideSensitive={hideSensitive}
            onDeleteBiomarkerLog={handleDeleteBiomarkerLog}
            onEditBiomarkerLog={handleEditBiomarkerLog}
            onLogMedical={handleLogMedical}
            onCombineBiomarkers={handleCombineBiomarkers}
            onApplyCalculation={handleApplyCalculation}
            selectedModelId={selectedModelId}
            onChangeModelId={setSelectedModelId}
            hasBmiAlert={profile ? hasBmiPendingAlert(profile, dismissedBmiAlerts, report) : false}
            onDismissBmiAlert={handleDismissBmiAlert}
          />
        )}

        {activeTab === 'trends' && (
          <TrendsTab
            profile={profile}
            foodLogs={foodLogs}
            biomarkerHistory={biomarkerHistory}
            hideSensitive={hideSensitive}
            report={report}
          />
        )}
      </main>

      {/* Floating Action Button (FAB) Dock */}
      {!isEditingFoodLog && (
        <div className="fixed bottom-24 right-5 z-40">
          {isMedicalTabFAB ? (
            <button
              id="fab-medical-btn"
              onClick={() => setIsMedicalChatOpen(true)}
              className="w-14 h-14 bg-indigo-600 text-white rounded-full flex items-center justify-center shadow-xl hover:bg-indigo-700 hover:scale-105 active:scale-95 transition-all focus:outline-none focus:ring-4 focus:ring-indigo-500/20"
              title="Scan Blood Report / Log Medical Biomarkers"
            >
              <Stethoscope className="w-6 h-6 stroke-[2.5px]" />
            </button>
          ) : (
            <button
              id="fab-food-btn"
              onClick={() => setIsFoodChatOpen(true)}
              className="w-14 h-14 bg-indigo-600 text-white rounded-full flex items-center justify-center shadow-xl hover:bg-indigo-700 hover:scale-105 active:scale-95 transition-all focus:outline-none focus:ring-4 focus:ring-indigo-500/20"
              title="Log Meal consumed"
            >
              <Plus className="w-6 h-6 stroke-[2.5px]" />
            </button>
          )}
        </div>
      )}

      {/* Bottom Material Tab Bar (Icons only) */}
      <BottomNav activeTab={activeTab} setActiveTab={setActiveTab} />

      {/* Slide-over interactive dialogs */}
      <LogChat
        type="food"
        profile={profile}
        isOpen={isFoodChatOpen}
        selectedModelId={selectedModelId}
        onChangeModelId={setSelectedModelId}
        onClose={() => setIsFoodChatOpen(false)}
        onLogFood={handleLogFood}
        biomarkers={biomarkers}
        foodLogs={foodLogs}
        report={report}
      />

      <LogChat
        type="medical"
        profile={profile}
        isOpen={isMedicalChatOpen}
        selectedModelId={selectedModelId}
        onChangeModelId={setSelectedModelId}
        onClose={() => {
          setIsMedicalChatOpen(false);
          setActiveAgentType(null);
        }}
        onLogMedical={handleLogMedical}
        biomarkers={biomarkers}
        biomarkerHistory={biomarkerHistory}
        foodLogs={foodLogs}
        report={report}
        agentType={activeAgentType}
        onAgentFinish={async (agentType, agentResult) => {
          const updatedProfile = { ...profile };
          if (agentType === 'agent1') {
            updatedProfile.agentTriageSummary = agentResult.message;
          } else if (agentType === 'agent2') {
            updatedProfile.agentDiagnosticSummary = agentResult.primaryDiagnosis;
            updatedProfile.agent2TimelineProjections = agentResult.timelineProjections;
            updatedProfile.agent2GapTasks = agentResult.recommendedTests?.map((t: any) => `${t.testName}: ${t.reason}`);
          } else if (agentType === 'agent3') {
            updatedProfile.agentContextualizerSummary = agentResult.message;
          } else if (agentType === 'agent4') {
            updatedProfile.agentInterventionSummary = agentResult.message;
            updatedProfile.agent4Projections = agentResult.projections;
          } else if (agentType === 'agent5') {
            updatedProfile.agentLiteratureSummary = agentResult.message;
          }
          
          setProfile(updatedProfile);
          await saveAndSync(updatedProfile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report);
          
          setActiveAgentType(null);
        }}
      />

    </div>
  );
}
