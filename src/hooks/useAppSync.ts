/**
 * Q-11 restore — real cloud sync, moved out of src/App.tsx (verbatim).
 *
 * Owns: checkForDbChanges, saveAndSync, handleFetchMoreFoods, lastSyncTime
 * plumbing (parsedLocal.lastSyncedAt on the pull). Bodies are the App.tsx
 * text; only the surrounding hook/options differ so the functions can live
 * next to the data they write without a 373 KB App.tsx.
 *
 * A localStorage-only stub that sets syncState='synced' and returns is a
 * failed milestone (a14abea / 7d94def).
 */
import { useCallback, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type {
  BiomarkerLog,
  DailyBenefit,
  FoodIdea,
  FoodLog,
  HealthAction,
  RecommendationReport,
  UserProfile,
} from '../types';
import { auth, db } from '../firebase';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getDocsFromCache,
  getDocsFromServer,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { sanitizeForFirestore, checkQuotaFlag } from '../utils/firestoreUtils';
import { get, getAggregatedAppData, getStorageKey, safeSaveToLocalStorage } from '../utils/storageUtils';
import { sanitizeProfile, isDeepEqual, maybeRecalibrateDemographicOverlays } from '../utils/appProfileUtils';
import { cleanupInventedBiomarkerCatalog } from '../utils/biomarkerLifecycle';
import { mergeParallelAliasGroups } from '../utils/biomarkerAuditEngine';
import { isValEmpty } from '../utils/biomarkers';
import { PRIMARY_NUTRIENTS } from '../utils/nutrients';
import {
  fetchAllConsolidatedLogs,
  fetchFoodLogsPage,
  mergeActions,
  mergeBenefits,
  mergeBiomarkerHistory,
  mergeByRecency,
  mergeDeleteMaps,
  mergeFoodIdeas,
  mergeProfiles,
  mergeReports,
  pushLogsToServer,
  subscribeToSupabaseLogs,
  syncLogsWithTimeBuckets,
  upsertProfileToSupabase,
  resolveInitialLanguage,
} from '../utils/syncUtils';
import { mergeFoodLogsDeduped, rehydrateFoodImagesFromDonors } from '../utils/foodLogDedupe';
import { isUsableImageUrl, uniqueMealImageUrls } from '../utils/foodImageSources';
import { JobStore } from '../jobs/JobStore';
import { hydrateUserJobs, upsertJobToSupabase } from '../jobs/BackendJobSync';
import { supabase, isSupabaseConfigured } from '../utils/supabaseClient';
import { toYYYYMMDD } from '../utils/dateUtils';
import type { AppSyncState } from './useAppProfile';
import type { ProfileDbChangeChecker } from './useAppProfile';

const FIRESTORE_READ_BUDGET = 3000;
function firestoreReadGuard(label: string, docCount: number = 1): boolean {
  const key = 'firestoreReadCountThisSession';
  const current = parseInt(sessionStorage.getItem(key) || '0', 10) + docCount;
  sessionStorage.setItem(key, String(current));
  if (current > FIRESTORE_READ_BUDGET) {
    console.error(`[Circuit Breaker] Firestore read budget exceeded (${current}/${FIRESTORE_READ_BUDGET}) at "${label}". Blocking further reads this session to prevent runaway cost. Reload the page to reset.`);
    return false;
  }
  return true;
}
const MAX_IMAGE_FETCH_PER_SYNC = 24;

export type EffectiveUser = { uid: string; email: string; displayName: string } | null;

export interface UseAppSyncOptions {
  profile: UserProfile | null;
  setProfile: Dispatch<SetStateAction<UserProfile | null>>;
  foodLogs: FoodLog[];
  setFoodLogs: (val: FoodLog[] | ((prev: FoodLog[]) => FoodLog[])) => void;
  biomarkers: { [key: string]: number | string };
  setBiomarkers: Dispatch<SetStateAction<{ [key: string]: number | string }>>;
  biomarkerHistory: BiomarkerLog[];
  setBiomarkerHistory: (val: BiomarkerLog[] | ((prev: BiomarkerLog[]) => BiomarkerLog[])) => void;
  actions: HealthAction[];
  setActions: Dispatch<SetStateAction<HealthAction[]>>;
  dailyBenefits: DailyBenefit[];
  setDailyBenefits: Dispatch<SetStateAction<DailyBenefit[]>>;
  foodIdeas: FoodIdea[];
  setFoodIdeas: Dispatch<SetStateAction<FoodIdea[]>>;
  report: RecommendationReport | null;
  setReport: Dispatch<SetStateAction<RecommendationReport | null>>;
  syncState: AppSyncState;
  setSyncState: Dispatch<SetStateAction<AppSyncState>>;
  totalFoodsCount: number | undefined;
  setTotalFoodsCount: Dispatch<SetStateAction<number | undefined>>;
  setIsInitialDataLoading: (val: boolean) => void;
  setConflictData: Dispatch<SetStateAction<any>>;
  isFirestoreQuotaExceeded: boolean;
  setIsFirestoreQuotaExceeded: Dispatch<SetStateAction<boolean>>;
  setActiveTab: (tab: any) => void;
  getEffectiveUser: () => EffectiveUser;
  logInteraction: (...args: any[]) => string;
  completeInteraction: (...args: any[]) => void;
  handleFirestoreError: (err: any) => void;
  checkForDbChangesRef: MutableRefObject<ProfileDbChangeChecker | null>;
  saveAndSyncRef: MutableRefObject<any>;
}

export interface UseAppSyncReturn {
  checkForDbChanges: ProfileDbChangeChecker;
  saveAndSync: (...args: any[]) => Promise<unknown>;
  handleFetchMoreFoods: (page: number) => Promise<void>;
  /** standing egress_conservation fingerprint — also re-exported through App.tsx */
  lastSyncTime: number | undefined;
}

export function useAppSync(options: UseAppSyncOptions): UseAppSyncReturn {
  const {
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
  } = options;

  const lastSyncTrigger = useRef<number>(0);
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const withTimeout = <T,>(promise: Promise<T> | T, timeoutMs: number, label: string): Promise<T | void> => {
    let timeoutId: any;
    return Promise.race([
      Promise.resolve(promise).then(res => {
        clearTimeout(timeoutId);
        return res;
      }).catch(err => {
        clearTimeout(timeoutId);
        throw err;
      }),
      new Promise<void>((resolve) => {
        timeoutId = setTimeout(() => {
          console.warn(`[Firestore Sync Timeout] ${label} took more than ${timeoutMs}ms. Continuing in background/offline cache.`);
          setSyncState('local');
          resolve();
        }, timeoutMs);
      })
    ]);
  };

  const handleFetchMoreFoods = useCallback(async (page: number) => {
    const uid = auth.currentUser?.uid || profile?.uid;
    const email = auth.currentUser?.email || profile?.email || undefined;
    if (!uid) return;
    const { foods: newFoods, totalFoodsCount: newTotal } = await fetchFoodLogsPage(uid, page, 15, email);
    if (newFoods.length > 0) {
      setFoodLogs(prev => mergeFoodLogsDeduped(prev, newFoods));
    }
    if (typeof newTotal === 'number' && newTotal > 0) {
      setTotalFoodsCount(prev => Math.max(prev || 0, newTotal));
    }
  }, [profile?.uid, profile?.email]);

  const checkForDbChanges = async (forceUserId?: string, forcePull?: boolean, forceReplaceLocal?: boolean) => {
    if (!forcePull && !forceReplaceLocal) {
      const now = Date.now();
      if (now - lastSyncTrigger.current < 5000) {
        if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
        syncTimeoutRef.current = setTimeout(() => {
          checkForDbChanges(forceUserId, forcePull, forceReplaceLocal);
        }, 5000);
        return;
      }
      lastSyncTrigger.current = now;
    }

    if ((window as any).isManualSyncExecuting && !forcePull) {
      return;
    }

    const activeUser = getEffectiveUser();
    const activeEmail = activeUser?.email || profile?.email || auth.currentUser?.email;
    const isDemoUser = activeEmail?.toLowerCase().trim() === 'demo@healthcockpit.com';
    if (isDemoUser) {
      setSyncState('synced');
      (window as any).isManualSyncExecuting = false;
      return;
    }

    (window as any).isManualSyncExecuting = true;
    sessionStorage.setItem('sessionSyncTriggered', 'true');
    const uid = forceUserId || activeUser?.uid;
    if (!uid) {
      setSyncState('local');
      return;
    }
    // Load local storage first so we don't wipe it on page load
    const parsedLocal = await getAggregatedAppData(activeEmail) || {};
    if (typeof parsedLocal.totalFoodsCount === 'number' && parsedLocal.totalFoodsCount > 0) {
      setTotalFoodsCount(prev => Math.max(prev || 0, parsedLocal.totalFoodsCount));
    }
    // Snapshot of current local state (from storage or memory) for safe merge
    const currentEmail = activeEmail?.toLowerCase().trim() || 'guest';
    const profileEmail = profile?.email?.toLowerCase().trim();
    const isSameUser = profileEmail === currentEmail;

    let localProfile = isSameUser ? (profile || parsedLocal.profile) : parsedLocal.profile;
    
    // Union merge disk storage logs (parsedLocal) and React memory state so no restored entries or images are lost
    const diskFoods: FoodLog[] = parsedLocal.foodLogs || [];
    const memoryFoods: FoodLog[] = isSameUser ? foodLogs : [];
    const localFoodMap = new Map<string, FoodLog>();
    diskFoods.forEach((df) => localFoodMap.set(df.id, df));
    memoryFoods.forEach((mf) => {
      const existing = localFoodMap.get(mf.id);
      if (!existing) {
        localFoodMap.set(mf.id, mf);
      } else {
        const existingHasImg = existing.imageUrl && existing.imageUrl !== '[image_removed_for_snapshot]';
        const memoryHasImg = mf.imageUrl && mf.imageUrl !== '[image_removed_for_snapshot]';
        localFoodMap.set(mf.id, {
          ...existing,
          ...mf,
          imageUrl: memoryHasImg ? mf.imageUrl : (existingHasImg ? existing.imageUrl : mf.imageUrl),
          imageUrls: (mf.imageUrls && mf.imageUrls.length > 0) ? mf.imageUrls : existing.imageUrls
        });
      }
    });
    let localFoods = mergeFoodLogsDeduped(Array.from(localFoodMap.values()), []);

    const diskBio: BiomarkerLog[] = parsedLocal.biomarkerHistory || [];
    const memoryBio: BiomarkerLog[] = isSameUser ? biomarkerHistory : [];
    const localBioMap = new Map<string, BiomarkerLog>();
    diskBio.forEach((db) => localBioMap.set(db.id, db));
    memoryBio.forEach((mb) => localBioMap.set(mb.id, mb));
    let localBioHistory = Array.from(localBioMap.values());

    let localActions = mergeActions(parsedLocal.actions || [], isSameUser ? actions : []);
    let localBenefits = mergeBenefits(parsedLocal.dailyBenefits || [], isSameUser ? dailyBenefits : []);
    let localReport = mergeReports(parsedLocal.report || null, isSameUser ? report : null);

    if (forceReplaceLocal) {
      if (localProfile) {
        localProfile = {
          email: localProfile.email,
          nickname: localProfile.nickname,
          photoUrl: localProfile.photoUrl,
          lastUpdatedAt: 0,
          customBiomarkers: {},
          notUsedBiomarkers: {},
          notUsedInMedicalHistory: {},
          deletedCustomBiomarkerKeys: {},
          deletedNotUsedBiomarkerKeys: {},
          deletedFoodLogIds: {},
          deletedBiomarkerLogIds: {}
        } as UserProfile;
      }
      localFoods = [];
      localBioHistory = [];
      localActions = [];
      localBenefits = [];
      localReport = null;
    }
    // Immediately populate state from local storage so the UI is responsive
    if (parsedLocal && (!profile || !isSameUser || foodLogs.length < localFoods.length)) {
      if (parsedLocal.profile) setProfile(sanitizeProfile(parsedLocal.profile, activeEmail));
      if (localFoods.length > 0) setFoodLogs(localFoods);
      if (parsedLocal.biomarkers) setBiomarkers(parsedLocal.biomarkers);
      if (localBioHistory.length > 0) setBiomarkerHistory(localBioHistory);
      if (parsedLocal.actions) setActions(parsedLocal.actions);
      if (parsedLocal.dailyBenefits) setDailyBenefits(parsedLocal.dailyBenefits);
      if (parsedLocal.report) setReport(parsedLocal.report);
    }
    let syncRootId = '';
    let tProfileId = '';
    const abortWithLocalFallback = async () => {
      // First try to recover from our manual localStorage cache
      let hasLocalFoods = false;
      let hasLocalBio = false;
      if (parsedLocal) {
        if (parsedLocal.profile) setProfile(sanitizeProfile(parsedLocal.profile, activeEmail));
        if (parsedLocal.biomarkers) setBiomarkers(parsedLocal.biomarkers);
        if (parsedLocal.actions) setActions(parsedLocal.actions);
        if (parsedLocal.dailyBenefits) setDailyBenefits(parsedLocal.dailyBenefits);
        if (parsedLocal.report) setReport(parsedLocal.report);
        if (parsedLocal.foodLogs && parsedLocal.foodLogs.length > 0) {
          // Recover images from current memory state if local storage payload lacks them
          const recoveredLocalFoods = parsedLocal.foodLogs.map((pf: any) => {
            const memoryItem = foodLogs.find(f => f.id === pf.id);
            const memoryHasImage = memoryItem && memoryItem.imageUrl && memoryItem.imageUrl !== '[image_removed_for_snapshot]';
            const localHasImage = pf.imageUrl && pf.imageUrl !== '[image_removed_for_snapshot]';
            if (!localHasImage && memoryHasImage) {
              return { ...pf, imageUrl: memoryItem.imageUrl, imageUrls: memoryItem.imageUrls || pf.imageUrls };
            }
            return pf;
          });
          setFoodLogs(recoveredLocalFoods);
          hasLocalFoods = true;
        }
        if (parsedLocal.biomarkerHistory && parsedLocal.biomarkerHistory.length > 0) {
          setBiomarkerHistory(parsedLocal.biomarkerHistory);
          hasLocalBio = true;
        }
      }
      
      

      // Supabase Fallback Syncing
      try {
        console.log("[Offline Recovery] Firebase quota exceeded, but attempting to sync with Supabase...");
        let sf = foodLogs;
        let sb = biomarkerHistory;
        
        const deletedFoods = profile?.deletedFoodLogIds || {};
        const deletedBios = profile?.deletedBiomarkerLogIds || {};
        const deletedCustomKeys = profile?.deletedCustomBiomarkerKeys || {};
        
        await syncLogsWithTimeBuckets(db, uid, sf, sb, deletedFoods, deletedBios, (f, b) => {
          sf = f;
          sb = b;
          setFoodLogs(f);
          setBiomarkerHistory(b);
        });

        const userEmail = profile?.email || auth.currentUser?.email || undefined;
        const { serverFoods, serverBiomarkers, serverProfile, serverActions, serverBenefits, serverReport, totalFoodsCount: fetchedTotalFoods } = await fetchAllConsolidatedLogs(
          db,
          uid,
          deletedFoods,
          deletedBios,
          deletedCustomKeys,
          userEmail,
          { lastSyncTime: (forcePull || forceReplaceLocal) ? undefined : (parsedLocal.lastSyncedAt || 0) }
        );
        if (typeof fetchedTotalFoods === 'number' && fetchedTotalFoods > 0) {
          setTotalFoodsCount(prev => Math.max(prev || 0, fetchedTotalFoods));
        }
        
        let mergedBioHist = sb;
        if (serverFoods.length > 0) {
          setFoodLogs(prevFoods => mergeFoodLogsDeduped(prevFoods, serverFoods));
        }
        if (serverBiomarkers.length > 0) {
          mergedBioHist = mergeBiomarkerHistory(serverBiomarkers, sb, deletedBios);
          setBiomarkerHistory(mergedBioHist);
        }
        if (serverProfile) {
          const mergedProf = mergeProfiles(serverProfile, localProfile || profile);
          if (mergedProf) {
            setProfile(sanitizeProfile(mergedProf, activeEmail));
            if (mergedProf.language) {
              localStorage.setItem('preferred_language', mergedProf.language);
            }
            // Recompute active biomarkers state
            const computedBios: { [key: string]: number | string } = {};
            [...mergedBioHist].filter(b => b.sync_state !== 'delete' && !(mergedProf.deletedBiomarkerLogIds?.[b.id] && (mergedProf.deletedBiomarkerLogIds?.[b.id] || 0) >= (b.updated_at || 0))).sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date))).forEach(log => {
              Object.entries(log.biomarkers || {}).forEach(([k, v]) => {
                computedBios[k] = v as string | number;
              });
            });
            setBiomarkers(computedBios);
          }
        }
        if (serverActions && serverActions.length > 0) {
          setActions(prev => mergeActions(serverActions, prev));
        }
        if (serverBenefits && serverBenefits.length > 0) {
          setDailyBenefits(prev => mergeBenefits(serverBenefits, prev));
        }
        if (serverReport) {
          setReport(prev => mergeReports(serverReport, prev));
        }
      } catch (sbErr) {
        console.warn("[Offline Recovery] Supabase sync also failed.", sbErr);
      }
      
      setSyncState('local');
      if (typeof syncRootId !== 'undefined' && syncRootId) completeInteraction(syncRootId, false, 0, 'Firebase Quota Exceeded');
      if (typeof tProfileId !== 'undefined' && tProfileId) completeInteraction(tProfileId, false, 0, 'Firebase Quota Exceeded');
      (window as any).isManualSyncExecuting = false;
    };

    if (forcePull || forceReplaceLocal) {
      localStorage.removeItem('firestore_quota_exceeded');
      localStorage.removeItem('firestore_quota_exceeded_time');
      setIsFirestoreQuotaExceeded(false);
    }

    // Force Pull (forceReplaceLocal): Supabase is sole authority. Firebase may be over quota.
    if (forceReplaceLocal) {
      setSyncState('syncing');
      syncRootId = logInteraction('sync', `users/${uid} (Force Pull - Supabase Authority)`, null);
      try {
        const {
          serverFoods,
          serverBiomarkers,
          serverProfile,
          serverActions,
          serverBenefits,
          serverReport,
          totalFoodsCount: fetchedTotalFoods
        } = await fetchAllConsolidatedLogs(
          null,
          uid,
          {},
          {},
          {},
          activeEmail,
          { timeoutMs: 90000, skipFirebaseFallback: true }
        );
        if (typeof fetchedTotalFoods === 'number' && fetchedTotalFoods > 0) {
          setTotalFoodsCount(prev => Math.max(prev || 0, fetchedTotalFoods));
        }

        if (!serverProfile && serverBiomarkers.length === 0 && serverFoods.length === 0) {
          throw new Error('Force Pull failed: Supabase returned no profile and no logs. Force Push from the master device first.');
        }

        let authProfile: UserProfile = (serverProfile || {
          email: currentEmail,
          lastUpdatedAt: Date.now()
        }) as UserProfile;

        const customs = { ...(authProfile.customBiomarkers || {}) };
        Object.keys(authProfile.deletedCustomBiomarkerKeys || {}).forEach(k => { delete customs[k]; });
        const notUsed = { ...(authProfile.notUsedBiomarkers || {}) };
        Object.keys(authProfile.deletedNotUsedBiomarkerKeys || {}).forEach(k => {
          const t = authProfile.deletedNotUsedBiomarkerKeys![k];
          const f = notUsed[k]?.flaggedAt || 0;
          if (t >= f) delete notUsed[k];
        });
        authProfile = {
          ...authProfile,
          customBiomarkers: customs,
          notUsedBiomarkers: notUsed,
          deletedFoodLogIds: authProfile.deletedFoodLogIds || {},
          deletedBiomarkerLogIds: authProfile.deletedBiomarkerLogIds || {},
          deletedCustomBiomarkerKeys: authProfile.deletedCustomBiomarkerKeys || {},
          deletedNotUsedBiomarkerKeys: authProfile.deletedNotUsedBiomarkerKeys || {}
        };

        const delFoods = authProfile.deletedFoodLogIds || {};
        const delBios = authProfile.deletedBiomarkerLogIds || {};
        // B11: always dedupe force-pull foods (retry ids / multi-device duplicates)
        let mergedFoods = mergeFoodLogsDeduped(
          (serverFoods || []).filter(f => f.sync_state !== 'delete' && !delFoods[f.id]),
          []
        );
        let mergedBioHistory = (serverBiomarkers || []).filter(b => b.sync_state !== 'delete' && !delBios[b.id]);
        const cleanedAuth = cleanupInventedBiomarkerCatalog(authProfile, mergedBioHistory);
        // B7.6: fold live parallel alias keys into their master (or tombstone empties).
        const dedupedAuth = mergeParallelAliasGroups(cleanedAuth.profile, cleanedAuth.history);
        authProfile = dedupedAuth.profile as UserProfile;
        mergedBioHistory = dedupedAuth.history;
        const mergedActions = Array.isArray(serverActions) ? serverActions : [];
        const mergedBenefits = Array.isArray(serverBenefits) ? serverBenefits : [];
        const resolvedReport = serverReport != null ? serverReport : null;

        // Force Pull authority: clean biomarker dictionary tombstone keys
        if (forceReplaceLocal || forcePull) {
          const activeCustomKeys = Object.keys(authProfile.customBiomarkers || {});
          const cleanCustomTombstones: Record<string, number> = {};
          Object.entries(authProfile.deletedCustomBiomarkerKeys || {}).forEach(([k, t]) => {
            if (!activeCustomKeys.includes(k)) cleanCustomTombstones[k] = t;
          });
          authProfile.deletedCustomBiomarkerKeys = cleanCustomTombstones;
        }

        const computedBiomarkers: { [key: string]: number | string } = {};
        const _authTombstoned = authProfile?.deletedCustomBiomarkerKeys || {};
        [...mergedBioHistory]
          .filter(b => b.sync_state !== 'delete' && !(delBios[b.id] && delBios[b.id] >= (b.updated_at || 0)))
          .sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date)) || ((a.updated_at || 0) - (b.updated_at || 0)))
          .forEach(log => {
            Object.entries(log.biomarkers || {}).forEach(([k, v]) => {
              if (!_authTombstoned[k]) {
                computedBiomarkers[k] = v as string | number;
              }
            });
          });

        setProfile(sanitizeProfile(authProfile, activeEmail));
        if (authProfile?.language) {
          localStorage.setItem('preferred_language', authProfile.language);
        }
        setFoodLogs(mergedFoods);
        setBiomarkerHistory(mergedBioHistory);
        setBiomarkers(computedBiomarkers);
        setActions(mergedActions);
        setDailyBenefits(mergedBenefits);
        setReport(resolvedReport);

        await safeSaveToLocalStorage(getStorageKey(authProfile?.email || profile?.email || auth.currentUser?.email || currentEmail), {
          profile: authProfile,
          foodLogs: mergedFoods,
          biomarkers: computedBiomarkers,
          biomarkerHistory: mergedBioHistory,
          actions: mergedActions,
          dailyBenefits: mergedBenefits,
          report: resolvedReport,
          totalFoodsCount: fetchedTotalFoods || totalFoodsCount,
          lastSyncedAt: Date.now()
        });

        await new Promise(resolve => setTimeout(resolve, 600));
        setSyncState('synced');
        completeInteraction(syncRootId, true, 0);
        console.log(`[Force Pull] Supabase authority: bios=${Object.keys(computedBiomarkers).length}, bioLogs=${mergedBioHistory.length}, foods=${mergedFoods.length}, actions=${mergedActions.length}, report=${!!resolvedReport}`);
      } catch (err: any) {
        console.error('[Force Pull] Supabase-only hard replace failed:', err);
        setSyncState('local');
        completeInteraction(syncRootId, false, 0, err?.message || 'Force Pull failed');
      } finally {
        (window as any).isManualSyncExecuting = false;
      }
      return;
    }

    if (isFirestoreQuotaExceeded || checkQuotaFlag()) {
      abortWithLocalFallback();
      return;
    }
    setSyncState('syncing');
    syncRootId = logInteraction('sync', `users/${uid} (Full Check)`, null);
    let tFoodsId = '';
    let tBioId = '';
    let tActsId = '';
    let tBensId = '';
    let tRepId = '';
    let hasUnsynced = false;
    try {
      const userDocRef = doc(db, 'users', uid);
      let userDoc;
      tProfileId = logInteraction('download', `users/${uid} (Profile)`, null);
      
      const lastCheckTime = (window as any)._lastCloudProfileCheck || 0;
      if (!forcePull && !forceReplaceLocal && Date.now() - lastCheckTime < 15000 && (window as any)._cachedCloudProfileDoc) {
        userDoc = (window as any)._cachedCloudProfileDoc;
        console.log("[Sync] Deduplicated profile read by using cached lastUpdatedAt check.");
        completeInteraction(tProfileId, true, userDoc.exists() ? JSON.stringify(userDoc.data()).length : 0);
      } else {
        try {
          const docResult = null; // await withTimeout(getDocFromServer(userDocRef), 2000, 'getDocFromServer (Profile)');
          if (docResult) {
            userDoc = docResult;
            (window as any)._lastCloudProfileCheck = Date.now();
            (window as any)._cachedCloudProfileDoc = docResult;
            completeInteraction(tProfileId, true, userDoc.exists() ? JSON.stringify(userDoc.data()).length : 0);
          } else {
            // In Supabase / local mode without direct Firestore, default to empty userDoc smoothly
            userDoc = { exists: () => false, data: () => undefined } as any;
          }
        } catch (err) {
          console.warn("getDocFromServer failed or timed out, falling back to local/cached getDoc:", err);
          handleFirestoreError(err);
          if (checkQuotaFlag()) {
            abortWithLocalFallback();
            return;
          }
          userDoc = { exists: () => false, data: () => undefined } as any;
        }
      }
      let cloudProfile = (userDoc?.exists() ? userDoc.data() : null) as UserProfile | null;
      if (true) {
        
        const cloudTime = cloudProfile?.lastUpdatedAt || 0;
        const localTime = localProfile?.lastUpdatedAt || 0;
        let mergedProfile: UserProfile;
        let foods: FoodLog[] = [];
        let bioHistory: BiomarkerLog[] = [];
        let acts: HealthAction[] = [];
        let bens: DailyBenefit[] = [];
        let cloudReport: RecommendationReport | null = null;
        let mergedFoods: FoodLog[] = [];
        let mergedBioHistory: BiomarkerLog[] = [];
        let mergedActions: HealthAction[] = [];
        let mergedBenefits: DailyBenefit[] = [];
        let resolvedReport: RecommendationReport | null = null;

        // Pre-compute merged profile early
        const dummyMergedProfile = mergeProfiles(cloudProfile || null, localProfile || null);
        const mergedCustomBiomarkers = dummyMergedProfile?.customBiomarkers || {};
        const deletedFoods = dummyMergedProfile?.deletedFoodLogIds || {};
        const deletedBioLogs = dummyMergedProfile?.deletedBiomarkerLogIds || {};
        const deletedCustomKeys = dummyMergedProfile?.deletedCustomBiomarkerKeys || {};

        // Always pull latest Supabase logs on check unless explicitly skipped
        const canSkipFetch = false;
        hasUnsynced = false;

        const sanitizeAndCleanLogs = (logsList: BiomarkerLog[]): BiomarkerLog[] => {
          return logsList.map(log => {
            if (!log.biomarkers) return log;
            const cleanedBiomarkers = { ...log.biomarkers };
            let logChanged = false;
            Object.keys(cleanedBiomarkers).forEach(k => {
              const val = cleanedBiomarkers[k];
              const isEmpty = isValEmpty(val);
              if (isEmpty) {
                delete cleanedBiomarkers[k];
                logChanged = true;
              }
            });
            if (logChanged) {
              if (Object.keys(cleanedBiomarkers).length === 0 && !log.note) {
                deletedBioLogs[log.id] = Date.now();
              }
              return { ...log, biomarkers: cleanedBiomarkers };
            }
            return log;
          });
        };

        if (canSkipFetch) {
          console.log("[Sync] Local data is fully up-to-date or newer. Skipping subcollection downloads.");
          mergedProfile = dummyMergedProfile as UserProfile;

          if (localProfile?.agentAnalyses) {
            mergedProfile.agentAnalyses = localProfile.agentAnalyses;
          }
          // Apply deletion filter so deleted items don't survive a refresh via this fast path
          const filteredSkipFoods = localFoods.filter(f => f.sync_state !== 'delete' && !deletedFoods[f.id]);
          foods = filteredSkipFoods;
          const sanitizedLocal = sanitizeAndCleanLogs(localBioHistory).filter(b => !deletedBioLogs[b.id] || (b.updated_at || 0) > deletedBioLogs[b.id]);
          bioHistory = sanitizedLocal;
          acts = localActions;
          bens = localBenefits;
          cloudReport = localReport;
          mergedFoods = filteredSkipFoods;
          mergedBioHistory = sanitizedLocal;
          mergedActions = localActions;
          mergedBenefits = localBenefits;
          hasUnsynced = localTime > cloudTime;
        } else {
          if (forcePull && !forceReplaceLocal) {
            console.log("[Sync] Force pull (Manual Sync) active. Pushing local unsynced logs and profile first.");
            // Push local foods, biomarkers, and profile to D1 before pulling so Device B's
            // data is available on Device A after the subsequent pull.
            try {
              const idToken = auth.currentUser ? await auth.currentUser.getIdToken().catch(() => undefined) : undefined;
              const pushResult = await pushLogsToServer({
                uid,
                email: localProfile?.email || activeEmail || undefined,
                foods: localFoods.filter(f => f.sync_state !== 'delete'),
                biomarkers: localBioHistory.filter(b => b.sync_state !== 'delete'),
                profile: localProfile ? {
                  ...localProfile,
                  lastUpdatedAt: localProfile.lastUpdatedAt || Date.now()
                } : undefined,
                idToken
              });
              console.log(`[Sync] Pre-pull push complete: ${pushResult.foodCount ?? 0} foods, ${pushResult.bioCount ?? 0} bios`);
              if (pushResult.success) {
                localFoods = localFoods.map(f => f.sync_state === 'delete' ? f : { ...f, sync_state: 'synced' as const });
                localBioHistory = localBioHistory.map(b => b.sync_state === 'delete' ? b : { ...b, sync_state: 'synced' as const });
                setFoodLogs(localFoods);
                setBiomarkerHistory(localBioHistory);
              }
            } catch (prePushErr) {
              console.warn("[Sync] Pre-pull push warning:", prePushErr);
            }
          }
          // Trigger job hydration: immediate on manual pull, deferred on background check past first paint (R-9)
          if (forcePull) {
            hydrateUserJobs(uid, true).catch(() => {});
          } else {
            if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
              (window as any).requestIdleCallback(() => { hydrateUserJobs(uid).catch(() => {}); }, { timeout: 3500 });
            } else {
              setTimeout(() => { hydrateUserJobs(uid).catch(() => {}); }, 2500);
            }
          }
          tFoodsId = logInteraction('download', `users/${uid}/foodLogs`, null);
          tBioId = logInteraction('download', `users/${uid}/biomarkerHistory`, null);
          tActsId = logInteraction('download', `users/${uid}/actions`, null);
          tBensId = logInteraction('download', `users/${uid}/dailyBenefits`, null);
          tRepId = logInteraction('download', `users/${uid}/reports/latest`, null);
          // Migrate to Time-Bucketing sync architecture
          let v2Foods: FoodLog[] = [];
          let v2Logs: BiomarkerLog[] = [];
          let spProfile: UserProfile | null = null;
          let spActions: HealthAction[] = [];
          let spBenefits: DailyBenefit[] = [];
          let spReport: RecommendationReport | null = null;
          // By using getDocs and getDoc (not FromServer), Firestore can utilize its local cache if configured,
          // and won't throw if offline, gracefully degrading to cached data.
          try {
            try {
              const { serverFoods, serverBiomarkers, serverProfile, serverActions, serverBenefits, serverReport, totalFoodsCount: fetchedTotalFoods } = await fetchAllConsolidatedLogs(
                checkQuotaFlag() ? null : db, 
                uid, 
                deletedFoods || cloudProfile?.deletedFoodLogIds || localProfile?.deletedFoodLogIds || {}, 
                deletedBioLogs || cloudProfile?.deletedBiomarkerLogIds || localProfile?.deletedBiomarkerLogIds || {},
                deletedCustomKeys || cloudProfile?.deletedCustomBiomarkerKeys || localProfile?.deletedCustomBiomarkerKeys || {},
                activeEmail,
                {
                  timeoutMs: forcePull ? 90000 : 60000,
                  skipFirebaseFallback: forcePull || checkQuotaFlag(),
                  lastSyncTime: (forcePull || forceReplaceLocal || !parsedLocal.lastSyncedAt || !localFoods || localFoods.length === 0) ? undefined : (parsedLocal.lastSyncedAt || 0)
                }
              );
              if (typeof fetchedTotalFoods === 'number' && fetchedTotalFoods > 0) {
                setTotalFoodsCount(prev => Math.max(prev || 0, fetchedTotalFoods));
              }
              const isIncrementalPull = !forcePull && !forceReplaceLocal && !!parsedLocal.lastSyncedAt && Array.isArray(localFoods) && localFoods.length > 0;
              const activeDeletedFoodIds = {
                ...(localProfile?.deletedFoodLogIds || {}),
                ...(cloudProfile?.deletedFoodLogIds || {}),
                ...(serverProfile?.deletedFoodLogIds || {})
              };
              v2Foods = (forceReplaceLocal ? serverFoods : mergeFoodLogsDeduped(localFoods, serverFoods))
                .filter(f => f && f.sync_state !== 'delete' && (!activeDeletedFoodIds[f.id] || (f.updated_at || 0) > activeDeletedFoodIds[f.id]));
              const activeDeletedBioIds = {
                ...(localProfile?.deletedBiomarkerLogIds || {}),
                ...(cloudProfile?.deletedBiomarkerLogIds || {}),
                ...(serverProfile?.deletedBiomarkerLogIds || {})
              };
              v2Logs = (forceReplaceLocal ? serverBiomarkers : mergeBiomarkerHistory(serverBiomarkers, localBioHistory, activeDeletedBioIds))
                .filter(b => b && b.sync_state !== 'delete' && (!activeDeletedBioIds[b.id] || (b.updated_at || 0) > activeDeletedBioIds[b.id]));
              if (serverProfile) spProfile = serverProfile;
              if (Array.isArray(serverActions)) spActions = serverActions;
              if (Array.isArray(serverBenefits)) spBenefits = serverBenefits;
              if (serverReport !== undefined && serverReport !== null) spReport = serverReport;
              
              // Images: seed from local (id + fingerprint), fetch at most MAX_IMAGE_FETCH_PER_SYNC recent missing
              if (v2Foods.length > 0 && localStorage.getItem('auto_sync_disabled') !== 'true') {
                const imageMap: Record<string, any> = {};

                // 1. Seed from local — by id (usable URLs only)
                localFoods.forEach(lf => {
                  const hasRealImage = isUsableImageUrl(lf.imageUrl);
                  const hasRealUrls = Array.isArray(lf.imageUrls) && lf.imageUrls.some(isUsableImageUrl);
                  if (hasRealImage || hasRealUrls) {
                    imageMap[lf.id] = {
                      imageUrl: hasRealImage ? lf.imageUrl : (lf.imageUrls || []).find(isUsableImageUrl),
                      imageUrls: (lf.imageUrls || []).filter(isUsableImageUrl),
                    };
                  }
                });

                // Prefer durable http(s) /photos already on cloud meta before foodImages blast
                // Merge cloud URLs with local URLs
                v2Foods.forEach(f => {
                  const hasV2Image = isUsableImageUrl(f.imageUrl);
                  const hasV2Urls = Array.isArray(f.imageUrls) && f.imageUrls.some(isUsableImageUrl);
                  
                  if (hasV2Image || hasV2Urls) {
                    const v2ImageUrl = hasV2Image ? f.imageUrl : (f.imageUrls || []).find(isUsableImageUrl);
                    const v2ImageUrls = (f.imageUrls || []).filter(isUsableImageUrl);
                    
                    const existingMap = imageMap[f.id];
                    if (!existingMap) {
                      imageMap[f.id] = {
                        imageUrl: v2ImageUrl,
                        imageUrls: v2ImageUrls,
                      };
                    } else {
                      const mergedUrls = uniqueMealImageUrls([
                        ...(existingMap.imageUrls || []),
                        ...v2ImageUrls,
                        existingMap.imageUrl,
                        v2ImageUrl
                      ]);
                      
                      imageMap[f.id] = {
                        imageUrl: existingMap.imageUrl || v2ImageUrl || mergedUrls[0],
                        imageUrls: mergedUrls
                      };
                    }
                  }
                });

                // 2. Missing after local seed — only fetch recent N (lazy remainder)
                const missingImageIds = v2Foods
                  .filter(f => {
                    const mapped = imageMap[f.id];
                    if (!mapped) return true;
                    return !isUsableImageUrl(mapped.imageUrl) &&
                      !(Array.isArray(mapped.imageUrls) && mapped.imageUrls.some(isUsableImageUrl));
                  })
                  .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
                  .map(f => f.id);

                const toFetch = missingImageIds.slice(0, MAX_IMAGE_FETCH_PER_SYNC);
                const deferred = missingImageIds.length - toFetch.length;
                if (toFetch.length > 0 && db) {
                  console.log(
                    `[Sync] Fetching ${toFetch.length} missing images (cap ${MAX_IMAGE_FETCH_PER_SYNC}` +
                      (deferred > 0 ? `; ${deferred} deferred for lazy/history open` : '') +
                      `)...`
                  );
                  for (let i = 0; i < toFetch.length; i += 8) {
                    const chunk = toFetch.slice(i, i + 8);
                    await Promise.all(chunk.map(async id => {
                      try {
                        const snap = { exists: () => false, data: () => ({}) } as any; // await getDoc(doc(db, 'users', uid, 'foodImages', id));
                        if (snap.exists()) {
                          const data = snap.data();
                          const hasDataRealImage = isUsableImageUrl(data?.imageUrl);
                          const hasDataRealUrls = Array.isArray(data?.imageUrls) && data.imageUrls.some(isUsableImageUrl);
                          if (hasDataRealImage || hasDataRealUrls) {
                            imageMap[id] = {
                              imageUrl: hasDataRealImage ? data.imageUrl : data.imageUrls.find(isUsableImageUrl),
                              imageUrls: (data.imageUrls || []).filter(isUsableImageUrl),
                            };
                          }
                        }
                      } catch (e) {
                        console.warn(`Failed to fetch image for ${id}`, e);
                      }
                    }));
                  }
                }

                v2Foods = v2Foods.map(f => (imageMap[f.id] ? { ...f, ...imageMap[f.id] } : f));
                // Cross-id: rehydrate from local meals with same fingerprint
                v2Foods = rehydrateFoodImagesFromDonors(v2Foods, localFoods);
                // Collapse duplicate meals before merge
                v2Foods = mergeFoodLogsDeduped(v2Foods, []);

                // --- IMAGE RESTORE FALLBACK (legacy foodLogs) — only remaining recent missing ---
                const isImageMissing = (item: any) =>
                  !isUsableImageUrl(item.imageUrl) &&
                  !(Array.isArray(item.imageUrls) && item.imageUrls.some(isUsableImageUrl));
                const missingImageFoods = v2Foods
                  .filter(f => isImageMissing(f))
                  .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
                  .slice(0, Math.min(12, MAX_IMAGE_FETCH_PER_SYNC));
                const hasMigratedImages = cloudProfile?.metadata?.legacyImagesMigrated || localProfile?.metadata?.legacyImagesMigrated;
                if (missingImageFoods.length > 0 && !hasMigratedImages && db) {
                    console.log(`[Migration] Attempting to restore ${missingImageFoods.length} missing images from legacy foodLogs (capped)...`);
                    try {
                        const recoveredUpdates: any[] = [];
                        const missingIds = missingImageFoods.map(f => f.id);
                        for (let i = 0; i < missingIds.length; i += 8) {
                            const chunk = missingIds.slice(i, i + 8);
                            await Promise.all(chunk.map(async id => {
                                try {
                                    const legacyDoc = { exists: () => false, data: () => ({}) } as any; // await getDoc(doc(db, 'users', uid, 'foodLogs', id));
                                    if (legacyDoc.exists()) {
                                        const data = legacyDoc.data();
                                        const f = v2Foods.find(v => v.id === id);
                                        const hasLegacyRealImage = isUsableImageUrl(data?.imageUrl);
                                        const hasLegacyRealUrls = Array.isArray(data?.imageUrls) && data.imageUrls.some(isUsableImageUrl);
                                        if (f && isImageMissing(f) && (hasLegacyRealImage || hasLegacyRealUrls)) {
                                            f.imageUrl = hasLegacyRealImage ? data.imageUrl : data.imageUrls.find(isUsableImageUrl);
                                            f.imageUrls = (data.imageUrls || []).filter(isUsableImageUrl);
                                            recoveredUpdates.push({ id, imageUrl: f.imageUrl, imageUrls: f.imageUrls });
                                        }
                                    }
                                } catch (e) {
                                    console.warn(`Failed to fetch legacy image for ${id}`, e);
                                }
                            }));
                        }
                        
                        if (recoveredUpdates.length > 0) {
                            console.log(`[Migration] Restored ${recoveredUpdates.length} images! Saving to foodImages...`);
                            recoveredUpdates.forEach(up => {
                                Promise.resolve({
                                  imageUrl: up.imageUrl || null,
                                  imageUrls: up.imageUrls || []
                                }).catch(e => console.error(e));
                            });
                        }
                        
                        // Mark as migrated so we don't scan legacy collection every time
                        await Promise.resolve();
                        if (localProfile) {
                            localProfile.metadata = { ...localProfile.metadata, legacyImagesMigrated: true };
                        }
                    } catch (err) {
                        console.error("[Migration] Failed to restore legacy images:", err);
                    }
                }
                // --- END IMAGE RESTORE FALLBACK ---
              }
            } catch (err) {
              console.error("Failed to fetch consolidated logs", err);
            }
            
            foods = v2Foods;
            completeInteraction(tFoodsId, true, 0, undefined, 0);
          } catch (foodErr: any) {
            console.warn("Failed to fetch foodLogs:", foodErr);
            handleFirestoreError(foodErr);
            foods = localFoods; // Fallback to local
            completeInteraction(tFoodsId, false, 0, foodErr.message || String(foodErr));
          }
          // 1. Fetch biomarker history robustly
          try {
            if (checkQuotaFlag()) {
              abortWithLocalFallback();
              return;
            }
            // v2Logs is already populated from fetchAllConsolidatedLogs
            
            bioHistory = v2Logs;
            completeInteraction(tBioId, true, 0, undefined, 0);
          } catch (bioErr: any) {
            console.warn("Failed to fetch biomarkerHistory:", bioErr);
            handleFirestoreError(bioErr);
            bioHistory = localBioHistory; // Fallback to local
            completeInteraction(tBioId, false, 0, bioErr.message || String(bioErr));
          }
          const pDashboard = (async () => {
            try {
              if (checkQuotaFlag()) {
                abortWithLocalFallback();
                return;
              }
              const dashboardDoc = { exists: () => false, data: () => ({}) } as any; // await getDoc(doc(db, 'users', uid, 'metadata', 'dashboard'));
              if (dashboardDoc.exists()) {
                const data = dashboardDoc.data();
                const cloudActs = (data.actions || []) as HealthAction[];
                const cloudBens = (data.dailyBenefits || []) as DailyBenefit[];
                const cloudIdeas = (data.foodIdeas || []) as FoodIdea[];

                acts = mergeActions(cloudActs, localActions);
                bens = mergeBenefits(cloudBens, localBenefits);
                setFoodIdeas(mergeFoodIdeas(cloudIdeas, foodIdeas));
              } else {
                acts = localActions;
                bens = localBenefits;
              }
              completeInteraction(tActsId, true, JSON.stringify(acts).length);
              completeInteraction(tBensId, true, JSON.stringify(bens).length);
            } catch (dashErr: any) {
              console.warn("Failed to fetch dashboard metadata:", dashErr);
              handleFirestoreError(dashErr);
              if (checkQuotaFlag()) {
                abortWithLocalFallback();
                return;
              }
              acts = localActions;
              bens = localBenefits;
              completeInteraction(tActsId, false, 0, dashErr.message || String(dashErr));
              completeInteraction(tBensId, false, 0, dashErr.message || String(dashErr));
            }
          })();
          const pReports = (async () => {
            try {
              if (checkQuotaFlag()) {
                abortWithLocalFallback();
                return;
              }
              const latestReportDoc = { exists: () => false, data: () => ({}) } as any; // await getDoc(doc(db, 'users', uid, 'reports', 'latest'));
              cloudReport = latestReportDoc.exists() ? (latestReportDoc.data() as RecommendationReport) : null;
              completeInteraction(tRepId, true, latestReportDoc.exists() ? JSON.stringify(latestReportDoc.data()).length : 0);
            } catch (repErr: any) {
              console.warn("Failed to fetch reports:", repErr);
              handleFirestoreError(repErr);
              if (checkQuotaFlag()) {
                abortWithLocalFallback();
                return;
              }
              cloudReport = localReport;
              completeInteraction(tRepId, false, 0, repErr.message || String(repErr));
            }
          })();
          const pAgentAnalyses = (async () => {
            try {
              if (checkQuotaFlag()) {
                abortWithLocalFallback();
                return;
              }
              const analysesSnap = { docs: [] } as any; // await getDocs(collection(db, 'users', uid, 'agentAnalyses'));
              const analyses = analysesSnap.docs.map(d => d.data());
              if (analyses.length > 0 && cloudProfile) {
                cloudProfile.agentAnalyses = analyses as any;
              } else if (localProfile?.agentAnalyses && cloudProfile) {
                cloudProfile.agentAnalyses = localProfile.agentAnalyses;
              }
            } catch (err) {
              console.warn("Failed to fetch agentAnalyses:", err);
              handleFirestoreError(err);
              if (checkQuotaFlag()) {
                abortWithLocalFallback();
                return;
              }
              if (localProfile?.agentAnalyses && cloudProfile) {
                cloudProfile.agentAnalyses = localProfile.agentAnalyses;
              }
            }
          })();
          
          await Promise.allSettled([pDashboard, pReports, pAgentAnalyses]);

          if (spProfile) {
            cloudProfile = cloudProfile ? mergeProfiles(spProfile, cloudProfile) : spProfile;
          }
          if (!cloudProfile && (v2Foods.length > 0 || v2Logs.length > 0 || localProfile)) {
            cloudProfile = localProfile || ({
              email: activeEmail,
              nickname: auth.currentUser?.displayName || '',
              photoUrl: auth.currentUser?.photoURL || '',
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              language: resolveInitialLanguage(profile?.language),
              topNutrientsToMonitor: PRIMARY_NUTRIENTS,
              lastUpdatedAt: Date.now()
            } as UserProfile);
          }
          if (spActions && spActions.length > 0) {
            acts = mergeActions(spActions, acts);
          }
          if (spBenefits && spBenefits.length > 0) {
            bens = mergeBenefits(spBenefits, bens);
          }
          if (spReport) {
            cloudReport = cloudReport ? mergeReports(spReport, cloudReport) : spReport;
          }

          // Recompute current effective delete tombstones across cloud and local profiles
          const effectiveDeletedFoods = {
            ...(cloudProfile?.deletedFoodLogIds || {}),
            ...(localProfile?.deletedFoodLogIds || {})
          };
          const effectiveDeletedBioLogs = {
            ...(cloudProfile?.deletedBiomarkerLogIds || {}),
            ...(localProfile?.deletedBiomarkerLogIds || {})
          };

          // Sanitize both cloud and local histories
          const sanitizedBioHistory = sanitizeAndCleanLogs(bioHistory);
          const sanitizedLocalBioHistory = sanitizeAndCleanLogs(localBioHistory);

          // Filter out deleted items from cloud and local lists
          const filteredFoods = foods.filter(f => f.sync_state !== 'delete' && !effectiveDeletedFoods[f.id]);
          const filteredLocalFoods = localFoods.filter(f => f.sync_state !== 'delete' && !effectiveDeletedFoods[f.id]);

          const filteredBioHistory = sanitizedBioHistory.filter(b => b.sync_state !== 'delete' && !effectiveDeletedBioLogs[b.id]);
          const filteredLocalBioHistory = sanitizedLocalBioHistory.filter(b => b.sync_state !== 'delete' && !effectiveDeletedBioLogs[b.id]);

          // Conflict Detection
          const lastSyncedAt = parsedLocal.lastSyncedAt || 0;

          const hasNewLocalFoods = filteredLocalFoods.some(lf => !filteredFoods.some(cf => cf.id === lf.id));
          const hasNewLocalBioHistory = filteredLocalBioHistory.some(lh => !filteredBioHistory.some(ch => ch.id === lh.id));
          const hasNewLocalActions = localActions.some(la => !acts.some(ca => ca.id === la.id));
          const hasNewLocalBenefits = localBenefits.some(lb => !bens.some(cb => cb.id === lb.id));

          const hasModifiedLocalFoods = filteredLocalFoods.some(lf => {
            const cf = filteredFoods.find(c => c.id === lf.id);
            return cf && JSON.stringify(lf) !== JSON.stringify(cf);
          });
          const hasModifiedLocalBioHistory = filteredLocalBioHistory.some(lh => {
            const ch = filteredBioHistory.find(c => c.id === lh.id);
            return ch && JSON.stringify(lh) !== JSON.stringify(ch);
          });

          const localProfileHasEdits = !!(localProfile?.lastUpdatedAt && (!lastSyncedAt || localProfile.lastUpdatedAt > lastSyncedAt + 2000));
          const localHasEdits = localProfileHasEdits || hasNewLocalFoods || hasNewLocalBioHistory || hasNewLocalActions || hasNewLocalBenefits || hasModifiedLocalFoods || hasModifiedLocalBioHistory;

          const hasNewCloudFoods = filteredFoods.some(cf => !filteredLocalFoods.some(lf => lf.id === cf.id));
          const hasNewCloudBioHistory = filteredBioHistory.some(ch => !filteredLocalBioHistory.some(lh => lh.id === ch.id));
          const hasNewCloudActions = acts.some(ca => !localActions.some(la => la.id === ca.id));
          const hasNewCloudBenefits = bens.some(cb => !localBenefits.some(lb => lb.id === cb.id));

          const hasModifiedCloudFoods = filteredFoods.some(cf => {
            const lf = filteredLocalFoods.find(l => l.id === cf.id);
            return lf && JSON.stringify(cf) !== JSON.stringify(lf);
          });
          const hasModifiedCloudBioHistory = filteredBioHistory.some(ch => {
            const lh = filteredLocalBioHistory.find(l => l.id === ch.id);
            return lh && JSON.stringify(ch) !== JSON.stringify(lh);
          });

          const cloudProfileHasEdits = !!(cloudProfile?.lastUpdatedAt && (!lastSyncedAt || cloudProfile.lastUpdatedAt > lastSyncedAt + 2000));
          const cloudHasEdits = cloudProfileHasEdits || hasNewCloudFoods || hasNewCloudBioHistory || hasNewCloudActions || hasNewCloudBenefits || hasModifiedCloudFoods || hasModifiedCloudBioHistory;

          const hasDifferentFoods = localFoods.length !== foods.length || !localFoods.every(lf => foods.some(cf => cf.id === lf.id));
          const hasDifferentBioHistory = localBioHistory.length !== bioHistory.length || !localBioHistory.every(lh => bioHistory.some(ch => ch.id === lh.id));
          const hasDifferentActions = localActions.length !== acts.length || !localActions.every(la => acts.some(ca => ca.id === la.id));
          const hasDifferentBenefits = localBenefits.length !== bens.length || !localBenefits.every(lb => bens.some(cb => cb.id === lb.id));

          // Show the conflict panel if BOTH cloud and local have independent edits that might conflict
          // AND there's an actual difference in the data lengths.
          // Otherwise, we rely on the bidirectional merge below.
          const isConflict = false; // localHasEdits && cloudHasEdits && (hasDifferentFoods || hasDifferentBioHistory || hasDifferentActions || hasDifferentBenefits);

          if (isConflict) {
            console.log("[Sync] Sync conflict detected. Pausing automatic sync to let user choose.");
            setConflictData({
              localProfile: localProfile || { email: currentEmail } as UserProfile,
              cloudProfile,
              localFoods,
              cloudFoods: foods,
              localBioHistory,
              cloudBioHistory: bioHistory,
              localActions,
              cloudActions: acts,
              localBenefits,
              cloudBenefits: bens,
              cloudReport,
              localReport
            });
            setSyncState('conflict');
            completeInteraction(syncRootId, true, 0);
            return;
          }

          if (forceReplaceLocal) {
            // Pure authority: Supabase profile if present, else Firebase. Never mergeProfiles.
            const authoritativeProfile = (spProfile || cloudProfile) as UserProfile;

            const delFoods = authoritativeProfile.deletedFoodLogIds || {};
            const delBios = authoritativeProfile.deletedBiomarkerLogIds || {};

            mergedProfile = {
              ...authoritativeProfile,
              customBiomarkers: { ...(authoritativeProfile.customBiomarkers || {}) },
              notUsedBiomarkers: { ...(authoritativeProfile.notUsedBiomarkers || {}) },
              deletedCustomBiomarkerKeys: { ...(authoritativeProfile.deletedCustomBiomarkerKeys || {}) },
              deletedNotUsedBiomarkerKeys: { ...(authoritativeProfile.deletedNotUsedBiomarkerKeys || {}) },
              deletedFoodLogIds: delFoods,
              deletedBiomarkerLogIds: delBios
            };

            // Prune tombstoned customs / not-used
            Object.keys(mergedProfile.deletedCustomBiomarkerKeys || {}).forEach(k => {
              delete mergedProfile.customBiomarkers![k];
            });
            Object.keys(mergedProfile.deletedNotUsedBiomarkerKeys || {}).forEach(k => {
              const t = mergedProfile.deletedNotUsedBiomarkerKeys![k];
              const f = mergedProfile.notUsedBiomarkers?.[k]?.flaggedAt || 0;
              if (t >= f) delete mergedProfile.notUsedBiomarkers![k];
            });

            mergedFoods = mergeFoodLogsDeduped(
              (foods || []).filter(f => f.sync_state !== 'delete' && !delFoods[f.id]),
              []
            );
            mergedFoods = rehydrateFoodImagesFromDonors(mergedFoods, filteredLocalFoods || localFoods || []);
            mergedBioHistory = (bioHistory || []).filter(b => b.sync_state !== 'delete' && !delBios[b.id]);
            if (spProfile) {
              mergedActions = Array.isArray(spActions) ? spActions : [];
              mergedBenefits = Array.isArray(spBenefits) ? spBenefits : [];
              resolvedReport = spReport != null ? spReport : (cloudReport || null);
            } else {
              mergedActions = acts || [];
              mergedBenefits = bens || [];
              resolvedReport = cloudReport || null;
            }
            hasUnsynced = false;

            // Skip the bidirectional union merge for this pass
          } else {
            // Merge logic: Merge profile, food logs, biomarker history, actions, daily benefits, and report
            mergedProfile = mergeProfiles(cloudProfile, localProfile) as UserProfile;

            // Bidirectional merge for food logs
            const foodUnionMap = new Map();
            filteredLocalFoods.forEach(l => foodUnionMap.set(l.id, l));
            filteredFoods.forEach(serverItem => {
              const isDeleted = deletedFoods[serverItem.id] || 
                                (localProfile?.deletedFoodLogIds && localProfile.deletedFoodLogIds[serverItem.id]) ||
                                (profile?.deletedFoodLogIds && profile.deletedFoodLogIds[serverItem.id]) ||
                                serverItem.sync_state === 'delete';
              if (isDeleted) {
                foodUnionMap.delete(serverItem.id);
                return;
              }
              const existingLocal = foodUnionMap.get(serverItem.id);
              if (!existingLocal) {
                foodUnionMap.set(serverItem.id, serverItem);
              } else {
                const localHasImage = isUsableImageUrl(existingLocal.imageUrl);
                const serverHasImage = isUsableImageUrl(serverItem.imageUrl);
                const localUrls = (existingLocal.imageUrls || []).filter(isUsableImageUrl);
                const serverUrls = (serverItem.imageUrls || []).filter(isUsableImageUrl);
                const combinedUrls = uniqueMealImageUrls([
                  ...localUrls,
                  ...serverUrls,
                  existingLocal.imageUrl,
                  serverItem.imageUrl
                ]);
                foodUnionMap.set(serverItem.id, {
                  ...serverItem,
                  ...existingLocal,
                  imageUrl: localHasImage
                    ? existingLocal.imageUrl
                    : (serverHasImage ? serverItem.imageUrl : (combinedUrls[0] || existingLocal.imageUrl)),
                  imageUrls: combinedUrls.length > 0 ? combinedUrls : existingLocal.imageUrls
                });
              }
            });
            mergedFoods = mergeFoodLogsDeduped(Array.from(foodUnionMap.values()), []);
            mergedFoods = rehydrateFoodImagesFromDonors(mergedFoods, filteredLocalFoods);

            mergedBioHistory = mergeBiomarkerHistory(filteredBioHistory, filteredLocalBioHistory, effectiveDeletedBioLogs);
            mergedActions = mergeActions(acts, localActions);
            mergedBenefits = mergeBenefits(bens, localBenefits);
            resolvedReport = mergeReports(cloudReport, localReport);

            // Determine if we need to write changes back to the cloud by deep-comparing merged vs cloud records
            const hasLocalAdditions = 
              mergedFoods.some(f => {
                const cf = filteredFoods.find(c => c.id === f.id);
                return !cf || !isDeepEqual(sanitizeForFirestore(f), sanitizeForFirestore(cf));
              }) ||
              mergedBioHistory.some(b => {
                const cb = filteredBioHistory.find(c => c.id === b.id);
                return !cb || !isDeepEqual(sanitizeForFirestore(b), sanitizeForFirestore(cb));
              }) ||
              mergedActions.some(a => !acts.some(ca => ca.id === a.id)) ||
              mergedBenefits.some(b => !bens.some(cb => cb.id === b.id));

            hasUnsynced = hasLocalAdditions || localTime > cloudTime;
          }
        }
        
        // Save merged profile to Firestore/Supabase (profile doc only, not food logs)
        if (forcePull) {
          const _fpTombstoned = mergedProfile?.deletedCustomBiomarkerKeys || {};
          const tempBiomarkers: { [key: string]: number | string } = {};
          [...mergedBioHistory]
            .filter(b => b.sync_state !== 'delete' && !(mergedProfile?.deletedBiomarkerLogIds?.[b.id] && (mergedProfile?.deletedBiomarkerLogIds?.[b.id] || 0) >= (b.updated_at || 0)))
            .sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date)) || ((a.updated_at || 0) - (b.updated_at || 0)))
            .forEach(log => {
              Object.entries(log.biomarkers || {}).forEach(([k, v]) => {
                if (!_fpTombstoned[k]) {
                  tempBiomarkers[k] = v as string | number;
                }
              });
            });
          await saveAndSync(mergedProfile, mergedFoods, tempBiomarkers, mergedBioHistory, mergedActions, mergedBenefits, resolvedReport, { type: 'profile' });
        }

        // Theme/appearance and language settings are profile-specific. They must always reflect
        // whichever copy (local device or cloud) was actually updated most recently —
        // never let a stale cloud profile silently reapply an old theme or language just because
        // the rest of the profile merge logic happened to prefer the cloud copy.
        const PREFERENCE_FIELDS: (keyof UserProfile)[] = ['language', 'themePalette', 'fontFamily', 'fontMono', 'fontSize', 'marginScale', 'paddingScale', 'cornerRadius', 'shadowScale', 'themeOverrides', 'customColors', 'fontSizeTitle', 'fontSizeSubtitle', 'fontSizeDescription', 'fontSizeBodySmall', 'fontSizeSubtitleSmall', 'fontSizeKeyMetric', 'fontSizeXS', 'fontSizeBody', 'customFonts', 'themePresets', 'systemPresetOverrides'];
        const hasLocalThemeOverride = sessionStorage.getItem('localThemeOverridesCloud') === 'true';
        if (!forceReplaceLocal && (hasLocalThemeOverride || (localProfile && (localProfile.lastUpdatedAt || 0) >= (cloudProfile?.lastUpdatedAt || 0)))) {
          const newerLocalProfile = localProfile;
          PREFERENCE_FIELDS.forEach(field => {
            if (newerLocalProfile[field] !== undefined) {
              (mergedProfile as any)[field] = newerLocalProfile[field];
            }
          });
        }

        // B7.5: merged or authority-swapped profiles can carry new demographics.
        mergedProfile = maybeRecalibrateDemographicOverlays(profile, mergedProfile);
        const cleanedMerged = cleanupInventedBiomarkerCatalog(mergedProfile, mergedBioHistory);
        // B7.6: fold live parallel alias keys into their master (or tombstone empties).
        const dedupedMerged = mergeParallelAliasGroups(cleanedMerged.profile, cleanedMerged.history);
        mergedProfile = dedupedMerged.profile as UserProfile;
        if (mergedProfile?.language) {
          localStorage.setItem('preferred_language', mergedProfile.language);
        }
        mergedBioHistory = dedupedMerged.history;
        setProfile(sanitizeProfile(mergedProfile, activeEmail));
        // Final safety: dedupe + rehydrate once more before React state / IndexedDB
        mergedFoods = mergeFoodLogsDeduped(rehydrateFoodImagesFromDonors(mergedFoods, localFoods), []);
        setFoodLogs(mergedFoods);
        setBiomarkerHistory(mergedBioHistory);
        setActions(mergedActions);
        setDailyBenefits(mergedBenefits);
        setReport(resolvedReport);
        // Recompute active biomarkers (sorted ascending so that newer logs overwrite older values)
        // Skip keys that are tombstoned via deletedCustomBiomarkerKeys — these are merged alias keys
        // that may still exist in cloud history but must not reappear in the active biomarker set.
        const computedBiomarkers: { [key: string]: number | string } = {};
        const _tombstonedKeys = mergedProfile?.deletedCustomBiomarkerKeys || {};
        [...mergedBioHistory]
          .filter(b => b.sync_state !== 'delete' && !(mergedProfile?.deletedBiomarkerLogIds?.[b.id] && (mergedProfile?.deletedBiomarkerLogIds?.[b.id] || 0) >= (b.updated_at || 0)))
          .sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date)) || ((a.updated_at || 0) - (b.updated_at || 0)))
          .forEach(log => {
            Object.entries(log.biomarkers || {}).forEach(([k, v]) => {
              if (!_tombstonedKeys[k]) {
                computedBiomarkers[k] = v as string | number;
              }
            });
          });
        setBiomarkers(computedBiomarkers);
        // Write bundle back to local storage — prefer usable images (never placeholders)
        const foodsToCache = rehydrateFoodImagesFromDonors(mergedFoods, localFoods);

        const bundle = {
          profile: mergedProfile,
          foodLogs: foodsToCache,
          biomarkers: computedBiomarkers,
          biomarkerHistory: mergedBioHistory,
          actions: mergedActions,
          dailyBenefits: mergedBenefits,
          report: resolvedReport,
          totalFoodsCount,
          lastSyncedAt: Date.now()
        };
        await safeSaveToLocalStorage(getStorageKey(mergedProfile?.email || profile?.email || auth.currentUser?.email), bundle);
        // Add a small delay for delightful visual feedback
        await new Promise(resolve => setTimeout(resolve, 800));
        setSyncState((hasUnsynced && !forcePull) ? 'local' : 'synced');
        completeInteraction(syncRootId, true, 0);
      } else if (localProfile && Object.keys(localProfile).length > 0) {
        // Cloud doc is empty, but we have local data! Cloud save probably failed earlier.
        // Let's assume local is the source of truth and restore it.
        setProfile(sanitizeProfile(localProfile, activeEmail));
        setFoodLogs(localFoods);
        setBiomarkerHistory(localBioHistory);
        setActions(localActions);
        setDailyBenefits(localBenefits);
        setReport(localReport);
        
        // Recompute active biomarkers (sorted ascending so that newer logs overwrite older values)
        const computedBiomarkers: { [key: string]: number | string } = {};
        [...localBioHistory]
          .filter(b => b.sync_state !== 'delete' && !(localProfile?.deletedBiomarkerLogIds?.[b.id] && (localProfile?.deletedBiomarkerLogIds?.[b.id] || 0) >= (b.updated_at || 0)))
          .sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date)) || ((a.updated_at || 0) - (b.updated_at || 0)))
          .forEach((log: BiomarkerLog) => {
            Object.entries(log.biomarkers || {}).forEach(([k, v]) => {
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
        await safeSaveToLocalStorage(getStorageKey(localProfile?.email || profile?.email || auth.currentUser?.email), bundle);
        // Try syncing profile to cloud in background
        const tNewProfileId = logInteraction('upload', `users/${uid} (Restore Profile)`, localProfile);
        const localProfileForCloud = { ...localProfile };
        delete localProfileForCloud.agentAnalyses;
        Promise.resolve()
          .then(() => completeInteraction(tNewProfileId, true, JSON.stringify(localProfile).length))
          .catch(err => { completeInteraction(tNewProfileId, false, 0, err.message); console.error(err); });
        await new Promise(resolve => setTimeout(resolve, 800));
        setSyncState('synced');
        completeInteraction(syncRootId, true, 0);
      } else {
        // Brand new sign up - create profile in Firestore
        const isDemoUser = auth.currentUser?.email?.toLowerCase() === 'demo@healthcockpit.com';
        
        const newProfile: UserProfile = {
          nickname: isDemoUser ? 'Alex (Demo)' : '',
          photoUrl: auth.currentUser?.photoURL || (isDemoUser ? 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?auto=format&fit=crop&q=80&w=120' : ''),
          email: auth.currentUser?.email || '',
          age: isDemoUser ? 28 : '' as any,
          ethnicity: isDemoUser ? 'Caucasian' : 'Unknown',
          weight: isDemoUser ? 74 : '' as any,
          height: isDemoUser ? 178 : '' as any,
          gender: isDemoUser ? 'Male' : 'Unknown',
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          language: resolveInitialLanguage(profile?.language),
          topNutrientsToMonitor: PRIMARY_NUTRIENTS
        };
        const tNewProfileId = logInteraction('upload', `users/${uid} (Create Profile)`, newProfile);
        Promise.resolve()
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
              type: 'doctor',
              testName: 'Physical Exam Panel',
              timeframe: '3-6 months',
              createdAt: Date.now()
            },
            {
              id: 'init_act_2',
              task: 'Complete basic fasting blood panel tests',
              explanation: 'Obtain ApoB, LDL-C, fasting glucose, and HbA1c values for precise target generation.',
              priority: 'high',
              completed: false,
              type: 'test',
              testName: 'Basic Fasting Panel',
              timeframe: '3-6 months',
              createdAt: Date.now()
            }
          ];
          initialBenefits = [
            { id: 'init_ben_1', activity: 'Walk briskly for 30 minutes', target: 'Daily', completed: false },
            { id: 'init_ben_2', activity: 'Add high-fiber foods to your breakfast', target: 'Daily', completed: false }
          ];
          // Write to Firestore dashboard document to prevent multiple writes
          const tDashId = logInteraction('upload', `users/${uid}/metadata/dashboard`, null);
          // [FreeTier] profile single-writer disabled - no actual write happens here, but the
          // interaction above must still be marked complete or it stays 'pending' forever,
          // which keeps the header's sync-attention indicator blinking for the rest of the
          // session (this was previously swallowed into the comment above and never ran).
          Promise.resolve()
            .then(() => completeInteraction(tDashId, true, 0))
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
        await safeSaveToLocalStorage(getStorageKey(newProfile?.email || profile?.email || auth.currentUser?.email), bundle);
        // Add a small delay for delightful visual feedback
        await new Promise(resolve => setTimeout(resolve, 800));
        setSyncState('synced');
        completeInteraction(syncRootId, true, 0);
        setActiveTab('medical');
      }
    } catch (err: any) {
      console.error("Error checking or syncing database changes:", err);
      handleFirestoreError(err);
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
    } finally {
      (window as any).isManualSyncExecuting = false;
      setIsInitialDataLoading(false);
      setSyncState(s => (s === 'syncing' ? 'local' : s));
    }
  };

  const saveAndSync = async (
    currProfile: UserProfile | null,
    currFoods: FoodLog[],
    currBiomarkers: { [key: string]: number | string },
    currBioHistory: BiomarkerLog[],
    currActions: HealthAction[],
    currBenefits: DailyBenefit[],
    currReport: RecommendationReport | null,
    specificUpdate?: {
      type: 'profile' | 'foodLog' | 'biomarkerLog' | 'biomarkerLogsBatch' | 'actions' | 'dailyBenefits' | 'foodIdeas' | 'report' | 'deleteFood' | 'deleteBiomarker' | 'multi' | 'fullPush' | 'analysis' | 'deleteAnalysis' | 'googleSteps';
      targetId?: string;
      targetIds?: string[];
      deletedIds?: string[];
      isAutoLog?: boolean;
    },
    currFoodIdeas: FoodIdea[] = foodIdeas
  ) => {
    let finalFoodsToSave = currFoods;
    let finalBioToSave = currBioHistory;
    const now = Date.now();
    const isAutoLog = !!(specificUpdate?.isAutoLog || 
      specificUpdate?.type === 'googleSteps');

    const foodImagesToSave: { id: string; imageUrl?: string; imageUrls?: string[] }[] = [];
    currFoods.forEach(f => {
      const hasRealImage = f.imageUrl && f.imageUrl !== '[image_removed_for_snapshot]' && f.imageUrl !== '';
      const hasRealUrls = f.imageUrls && f.imageUrls.length > 0 && f.imageUrls.some(u => u && u !== '[image_removed_for_snapshot]' && u !== '');
      if (hasRealImage || hasRealUrls) {
        foodImagesToSave.push({
          id: f.id,
          imageUrl: hasRealImage ? f.imageUrl : undefined,
          imageUrls: f.imageUrls ? f.imageUrls.filter(u => u && u !== '[image_removed_for_snapshot]') : []
        });
      }
    });

    let updatedProfile = currProfile;
    if (currProfile) {
      updatedProfile = {
        ...currProfile,
        approved_agent1_batches: (() => {
          try {
            const saved = localStorage.getItem('approved_agent1_batches');
            return saved ? JSON.parse(saved) : null;
          } catch (e) { return null; }
        })(),
        approved_data_review_batches: (() => {
          try {
            const saved = localStorage.getItem('approved_data_review_batches');
            return saved ? JSON.parse(saved) : null;
          } catch (e) { return null; }
        })(),
        lastUpdatedAt: isAutoLog ? (currProfile.lastUpdatedAt || now) : now
      };
      
      // Sanitize customBiomarkers to filter out any falsy, empty, null, or "undefined" keys
      if (updatedProfile.customBiomarkers) {
        const cleanedCustoms: { [key: string]: any } = {};
        for (const [k, v] of Object.entries(updatedProfile.customBiomarkers)) {
          if (k && k !== 'undefined' && k !== 'null' && k.trim() !== '') {
            cleanedCustoms[k] = v;
          }
        }
        updatedProfile.customBiomarkers = cleanedCustoms;

        // Clear deletion flags for any biomarkers that are currently alive
        if (updatedProfile.deletedCustomBiomarkerKeys) {
          const newDeleted = { ...updatedProfile.deletedCustomBiomarkerKeys };
          let changed = false;
          for (const k of Object.keys(cleanedCustoms)) {
             if (newDeleted[k]) {
                delete newDeleted[k];
                changed = true;
             }
          }
          if (changed) {
             updatedProfile.deletedCustomBiomarkerKeys = newDeleted;
          }
        }

        // Backstop: several write paths (agent extraction, chat logging, unit standardization)
        // create/update a customBiomarkers entry without stamping its own updatedAt. Without a
        // per-entry timestamp, cross-device merge can't tell which device's copy is newer and
        // falls back to comparing whole-profile sync time instead. Stamping any never-stamped
        // entry here guarantees every biomarker gets a real per-entry timestamp going forward,
        // regardless of which screen or flow created it, without needing to patch every site.
        for (const k of Object.keys(updatedProfile.customBiomarkers)) {
          const def = updatedProfile.customBiomarkers[k] as any;
          if (def && !def.updatedAt) {
            updatedProfile.customBiomarkers[k] = { ...def, updatedAt: now };
          }
        }
      }
      
      // Keep local state in sync immediately with the timestamped profile
      setProfile(updatedProfile);
    }
    
    // Ensure all other React states are updated to match what is being synced
    setFoodLogs(currFoods);
    setBiomarkers(currBiomarkers);
    setBiomarkerHistory(currBioHistory);
    setActions(currActions);
    setDailyBenefits(currBenefits);
    setReport(currReport);

    // Save to Local Storage first (Local Save before Upload)
    const bundle = {
      profile: updatedProfile,
      foodLogs: currFoods,
      biomarkers: currBiomarkers,
      biomarkerHistory: currBioHistory,
      actions: currActions,
      dailyBenefits: currBenefits,
      foodIdeas: currFoodIdeas,
      report: currReport,
      lastSyncedAt: now
    };
    await safeSaveToLocalStorage(getStorageKey(updatedProfile?.email || profile?.email || auth.currentUser?.email), bundle);


    const profileForCloud = updatedProfile ? {
      ...updatedProfile,
      deletedFoodLogIds: mergeDeleteMaps(updatedProfile.deletedFoodLogIds, profile?.deletedFoodLogIds),
      deletedBiomarkerLogIds: mergeDeleteMaps(updatedProfile.deletedBiomarkerLogIds, profile?.deletedBiomarkerLogIds),
      deletedCustomBiomarkerKeys: mergeDeleteMaps(updatedProfile.deletedCustomBiomarkerKeys, profile?.deletedCustomBiomarkerKeys)
    } : null;
    if (profileForCloud && profileForCloud.agentAnalyses) {
      delete profileForCloud.agentAnalyses;
    }

    const activeUser = getEffectiveUser();
    const activeEmail = activeUser?.email || profile?.email;
    const isDemoUser = activeEmail?.toLowerCase().trim() === 'demo@healthcockpit.com';
    if (!updatedProfile || !activeUser || isDemoUser) {
      setSyncState('local');
      return;
    }
    // Clear quota flags if this is an explicit manual fullPush or explicit user sync
    const isExplicitSync = specificUpdate?.type === 'fullPush' || (window as any).isManualSyncExecuting;
    if (isExplicitSync) {
      localStorage.removeItem('firestore_quota_exceeded');
      localStorage.removeItem('firestore_quota_exceeded_time');
      if (isFirestoreQuotaExceeded) {
        setIsFirestoreQuotaExceeded(false);
      }
    }

    // We allow user-triggered specific updates to write to the cloud even if the sync state was 'local' (offline)
    // or manual-sync-only mode is enabled, which helps deliberate actions (e.g. approving a biomarker
    // correction) reach the cloud immediately instead of silently waiting on a manual sync tap.
    // We only block background/automatic updates or if the database quota is explicitly exceeded.
    const isUserTriggered = specificUpdate && 
      specificUpdate.type !== 'googleSteps' && 
      !specificUpdate.isAutoLog;

    // Intercept automatic writes if manual sync mode is enabled to save quota
    const isManualSyncOnly = localStorage.getItem('auto_sync_disabled') === 'true';
    if (isManualSyncOnly && !isExplicitSync && !isUserTriggered) {
      setSyncState('local');
      return;
    }

    if (syncState === 'local' && specificUpdate?.type !== 'fullPush' && !isUserTriggered) {
      return;
    }
    
    // To minimize database writes and protect against quota exhaustion, 
    // we prevent automatic system updates (such as BMI auto-logging or Google Steps sync)
    // from writing to the cloud in the background. They are kept as local/unsynced state.
    if (isAutoLog) {
      setSyncState('local');
      return;
    }

    setSyncState('syncing');
    const uid = activeUser.uid;
    let syncRootId = "";
    syncRootId = logInteraction('sync', `users/${uid} (${specificUpdate ? specificUpdate.type : 'Save changes'})`, null);
    try {
      if (specificUpdate && specificUpdate.type !== 'fullPush') {
        // ALWAYS touch profile timestamp and push deleted IDs tracking so other devices pull correctly.
        // Also merge the full profile's schema definition structures (customBiomarkers,
        // notUsedBiomarkers) to Firestore so any local biomarker schema adjustments are synchronized, 
        // preventing empty schema states in multi-device sync.
        if (!checkQuotaFlag() && !isFirestoreQuotaExceeded && db) {
          // Firestore Profile updates disabled to route to Supabase
        }
        if (specificUpdate.type === 'analysis' && specificUpdate.targetId) {
          const analysis = updatedProfile?.agentAnalyses?.find(a => a.id === specificUpdate.targetId);
          if (analysis) {
            const itemTrackId = logInteraction('upload', `users/${uid}/agentAnalyses/${analysis.id}`, analysis);
            await withTimeout(
              Promise.resolve().then(() => completeInteraction(itemTrackId, true, JSON.stringify(analysis).length)),
              2000,
              'Analysis write'
            );
          }
        } else if (specificUpdate.type === 'deleteAnalysis' && specificUpdate.targetId) {
          const delTrackId = logInteraction('delete', `users/${uid}/agentAnalyses/${specificUpdate.targetId}`, null);
          await withTimeout(
            Promise.resolve().then(() => completeInteraction(delTrackId, true, 0)),
            2000,
            'Delete analysis'
          );
        } else if (specificUpdate.type === 'profile') {
          const pId = logInteraction('upload', `users/${uid} (Profile)`, updatedProfile);
          await withTimeout(
            // [FreeTier] profile single-writer disabled
            Promise.resolve().then(() => completeInteraction(pId, true, 0)).catch(() => {}),
            5000,
            'Profile write'
          );
          upsertProfileToSupabase(profileForCloud, uid, { actions: currActions, dailyBenefits: currBenefits, report: currReport, email: updatedProfile?.email || profile?.email || auth.currentUser?.email || undefined });
          const deletedFoods = updatedProfile?.deletedFoodLogIds || profile?.deletedFoodLogIds || {};
          const deletedBioLogs = updatedProfile?.deletedBiomarkerLogIds || profile?.deletedBiomarkerLogIds || {};
          await syncLogsWithTimeBuckets(db, uid, currFoods, currBioHistory, deletedFoods, deletedBioLogs, (sf, sb) => {
            finalFoodsToSave = sf; finalBioToSave = sb; setFoodLogs(sf); setBiomarkerHistory(sb);
          });
        } else if ((specificUpdate.type === 'foodLog' || specificUpdate.type === 'deleteFood') && specificUpdate.targetId) {
          const deletedFoods = updatedProfile?.deletedFoodLogIds || profile?.deletedFoodLogIds || {};
          const deletedBioLogs = updatedProfile?.deletedBiomarkerLogIds || profile?.deletedBiomarkerLogIds || {};
          // Push the changed/deleted food log to D1 before the pull so the server has Device A's version
          const idTokenFood = auth.currentUser ? await auth.currentUser.getIdToken().catch(() => undefined) : undefined;
          try {
            const pushRes = await pushLogsToServer({
              uid,
              email: updatedProfile?.email || profile?.email || auth.currentUser?.email || undefined,
              foods: currFoods.filter(f => f.id === specificUpdate.targetId || f.sync_state !== 'synced'),
              profile: profileForCloud ?? undefined,
              idToken: idTokenFood
            });
            if (pushRes.success) {
              currFoods = currFoods.map(f => (f.id === specificUpdate.targetId && f.sync_state !== 'delete') ? { ...f, sync_state: 'synced' as const } : f);
              setFoodLogs(currFoods);
            }
          } catch (e) {
            console.warn('[saveAndSync] Food push error:', e);
          }
          await syncLogsWithTimeBuckets(db, uid, currFoods, currBioHistory, deletedFoods, deletedBioLogs, async (sf, sb) => {
            finalFoodsToSave = sf; finalBioToSave = sb; setFoodLogs(sf);
            setBiomarkerHistory(sb);
            // Persist purged/synced logs to IndexedDB immediately so deletes survive refresh
            const updatedBundle = {
              ...bundle,
              foodLogs: sf,
              biomarkerHistory: sb
            };
            await safeSaveToLocalStorage(getStorageKey(updatedProfile?.email || profile?.email || auth.currentUser?.email), updatedBundle);
          });
          upsertProfileToSupabase(profileForCloud, uid, { actions: currActions, dailyBenefits: currBenefits, report: currReport, email: updatedProfile?.email || profile?.email || auth.currentUser?.email || undefined });
        } else if (specificUpdate.type === 'biomarkerLog' || specificUpdate.type === 'biomarkerLogsBatch' || specificUpdate.type === 'deleteBiomarker') {
          const deletedFoods = updatedProfile?.deletedFoodLogIds || profile?.deletedFoodLogIds || {};
          const deletedBioLogs = updatedProfile?.deletedBiomarkerLogIds || profile?.deletedBiomarkerLogIds || {};
          // Push changed biomarker logs to D1
          const idTokenBio = auth.currentUser ? await auth.currentUser.getIdToken().catch(() => undefined) : undefined;
          try {
            const pushRes = await pushLogsToServer({
              uid,
              email: updatedProfile?.email || profile?.email || auth.currentUser?.email || undefined,
              biomarkers: specificUpdate.type === 'biomarkerLogsBatch'
                ? currBioHistory.filter(b => b.sync_state !== 'delete')
                : currBioHistory.filter(b => b.id === specificUpdate.targetId || b.sync_state !== 'synced'),
              profile: profileForCloud ?? undefined,
              idToken: idTokenBio
            });
            if (pushRes.success) {
              currBioHistory = currBioHistory.map(b => (
                (specificUpdate.type === 'biomarkerLogsBatch' || b.id === specificUpdate.targetId) && b.sync_state !== 'delete'
                  ? { ...b, sync_state: 'synced' as const }
                  : b
              ));
              setBiomarkerHistory(currBioHistory);
            }
          } catch (e) {
            console.warn('[saveAndSync] Biomarker push error:', e);
          }
          await syncLogsWithTimeBuckets(db, uid, currFoods, currBioHistory, deletedFoods, deletedBioLogs, async (sf, sb) => {
            finalFoodsToSave = sf; finalBioToSave = sb; setFoodLogs(sf); setBiomarkerHistory(sb);
            const updatedBundle = {
              ...bundle,
              biomarkers: currBiomarkers,
              biomarkerHistory: sb
            };
            await safeSaveToLocalStorage(getStorageKey(updatedProfile?.email || profile?.email || auth.currentUser?.email), updatedBundle);
          }, { forceAllBiomarkers: specificUpdate.type === 'biomarkerLogsBatch' });
          const profilePromise = Promise.resolve();
          console.log('[FreeTier] profile single-writer');
          await withTimeout(profilePromise, 3000, 'biomarkerLogsBatch');
          upsertProfileToSupabase(profileForCloud, uid, { actions: currActions, dailyBenefits: currBenefits, report: currReport, email: updatedProfile?.email || profile?.email || auth.currentUser?.email || undefined });
        } else if (specificUpdate.type === 'actions') {
          const itemTrackId = logInteraction('upload', `users/${uid}/metadata/dashboard (Actions)`, null);
          // [FreeTier] profile single-writer disabled
          upsertProfileToSupabase(profileForCloud, uid, { actions: currActions, dailyBenefits: currBenefits, report: currReport, email: updatedProfile?.email || profile?.email || auth.currentUser?.email || undefined });
        } else if (specificUpdate.type === 'dailyBenefits') {
          const itemTrackId = logInteraction('upload', `users/${uid}/metadata/dashboard (Benefits)`, null);
          // [FreeTier] profile single-writer disabled
          upsertProfileToSupabase(profileForCloud, uid, { actions: currActions, dailyBenefits: currBenefits, report: currReport, email: updatedProfile?.email || profile?.email || auth.currentUser?.email || undefined });
        } else if (specificUpdate.type === 'foodIdeas') {
          const itemTrackId = logInteraction('upload', `users/${uid}/metadata/dashboard (FoodIdeas)`, null);
          // [FreeTier] profile single-writer disabled
        } else if (specificUpdate.type === 'report' && currReport) {
          const itemTrackId = logInteraction('upload', `users/${uid}/reports/latest`, currReport);
          // [FreeTier] profile single-writer disabled
          
          const dashTrackId = logInteraction('upload', `users/${uid}/metadata/dashboard (Report Update)`, null);
          await withTimeout(
            Promise.resolve(), 2000, 'Dashboard report sync');
          upsertProfileToSupabase(profileForCloud, uid, { actions: currActions, dailyBenefits: currBenefits, report: currReport, email: updatedProfile?.email || profile?.email || auth.currentUser?.email || undefined });
        }
      } else if (specificUpdate && specificUpdate.type === 'fullPush') {
        // Push all local foods, biomarkers, and profile to D1 first (Device A → server)
        const idTokenFull = auth.currentUser ? await auth.currentUser.getIdToken().catch(() => undefined) : undefined;
        await pushLogsToServer({
          uid,
          email: updatedProfile?.email || profile?.email || auth.currentUser?.email || undefined,
          foods: currFoods.filter(f => f.sync_state !== 'delete'),
          biomarkers: currBioHistory.filter(b => b.sync_state !== 'delete'),
          profile: profileForCloud ?? undefined,
          actions: currActions,
          dailyBenefits: currBenefits,
          report: currReport ?? null,
          forceOverwrite: true,
          idToken: idTokenFull
        }).catch(() => {});

        const deletedFoods = currProfile?.deletedFoodLogIds || profile?.deletedFoodLogIds || {};
        const deletedBioLogs = currProfile?.deletedBiomarkerLogIds || profile?.deletedBiomarkerLogIds || {};
        const includeFoods = !!(specificUpdate as any).includeFoods;
        await syncLogsWithTimeBuckets(db, uid, currFoods, currBioHistory, deletedFoods, deletedBioLogs, (sf, sb) => {
          finalFoodsToSave = sf; finalBioToSave = sb; setFoodLogs(sf); setBiomarkerHistory(sb);
        }, { forceAllBiomarkers: true, forceAllFoods: includeFoods });

        const syncedBios = (finalBioToSave || currBioHistory).map(b =>
          b.sync_state === 'delete' ? b : { ...b, sync_state: 'synced' as const }
        );
        finalBioToSave = syncedBios;
        setBiomarkerHistory(syncedBios);

        const pId = logInteraction('upload', `users/${uid} (Profile)`, currProfile);
        const profilePromise = Promise.resolve();
        console.log('[FreeTier] profile single-writer');
        completeInteraction(pId, true, 0);

        // Run promises in small sequential batches of 5 to avoid exhausting the Firestore write stream
        const chunkPromises = async (tasks: (() => Promise<any>)[], chunkSize: number) => {
          for (let i = 0; i < tasks.length; i += chunkSize) {
            const chunk = tasks.slice(i, i + chunkSize);
            await Promise.all(chunk.map(task => task()));
          }
        };

        const foodImageTasks = foodImagesToSave.map(imgData => {
          return () => { console.log('[FreeTier] foodImages firestore write disabled'); return Promise.resolve(); };
        });

        const foodImagePromise = chunkPromises(foodImageTasks, 5).then(() => {
          // Mark all saved food items as synced in memory to prevent re-uploading on routine syncs
          const syncedFoods = currFoods.map(f => ({ ...f, sync_state: 'synced' as const }));
          finalFoodsToSave = syncedFoods; setFoodLogs(syncedFoods);
          // Persist full images in local IndexedDB so offline/quota fallback retains them
          safeSaveToLocalStorage(getStorageKey(updatedProfile?.email || profile?.email || auth.currentUser?.email), {
            profile: updatedProfile,
            foodLogs: syncedFoods,
            biomarkers: currBiomarkers,
            biomarkerHistory: currBioHistory,
            actions: currActions,
            dailyBenefits: currBenefits,
            foodIdeas: currFoodIdeas,
            report: currReport
          });
        });

        const dashboardPromise = Promise.resolve();
        let reportPromise = Promise.resolve();
        if (currReport) {
          const itemTrackId = logInteraction('upload', `users/${uid}/reports/latest`, currReport);
          reportPromise = Promise.resolve();
        }
        await withTimeout(
          Promise.all([
            profilePromise,
            dashboardPromise,
            reportPromise,
            foodImagePromise
          ]),
          30000,
          'FullPush sync'
        ).catch(err => console.warn('Background sync warning:', err));
      } else {
        // Multi-document sync (default when no specific update provided)
        const pId = logInteraction('upload', `users/${uid} (Profile)`, currProfile);
        const profilePromise = Promise.resolve();
        upsertProfileToSupabase(profileForCloud, uid, { actions: currActions, dailyBenefits: currBenefits, report: currReport, email: updatedProfile?.email || profile?.email || auth.currentUser?.email || undefined });
        const dashboardPromise = Promise.resolve();
        let reportPromise = Promise.resolve();
        if (currReport) {
          const itemTrackId = logInteraction('upload', `users/${uid}/reports/latest`, currReport);
          reportPromise = Promise.resolve();
        }
        
        // V2 bulk sync
        const deletedFoods = currProfile?.deletedFoodLogIds || profile?.deletedFoodLogIds || {};
        const deletedBioLogs = currProfile?.deletedBiomarkerLogIds || profile?.deletedBiomarkerLogIds || {};
        await syncLogsWithTimeBuckets(db, uid, currFoods, currBioHistory, deletedFoods, deletedBioLogs, (sf, sb) => {
          finalFoodsToSave = sf; finalBioToSave = sb; setFoodLogs(sf); setBiomarkerHistory(sb);
        });

        // Run promises in small sequential batches of 5 to avoid exhausting the Firestore write stream
        const chunkPromises = async (tasks: (() => Promise<any>)[], chunkSize: number) => {
          for (let i = 0; i < tasks.length; i += chunkSize) {
            const chunk = tasks.slice(i, i + chunkSize);
            await Promise.all(chunk.map(t => t()));
          }
        };

        // ONLY upload images for foods that have unsynced edits (sync_state === 'new' || 'update')
        const unsyncedImageTasks = currFoods
          .filter(f => (f.sync_state === 'new' || f.sync_state === 'update') && (
            (f.imageUrl && f.imageUrl !== '[image_removed_for_snapshot]' && f.imageUrl !== '') ||
            (f.imageUrls && f.imageUrls.length > 0 && f.imageUrls.some(u => u && u !== '[image_removed_for_snapshot]'))
          ))
          .map(f => {
            const hasRealImage = f.imageUrl && f.imageUrl !== '[image_removed_for_snapshot]' && f.imageUrl !== '';
            return () => { console.log('[FreeTier] foodImages firestore write disabled'); return Promise.resolve(); };
          });

        if (unsyncedImageTasks.length > 0) {
          await chunkPromises(unsyncedImageTasks, 5);
        }

        await withTimeout(
          Promise.all([
            profilePromise,
            dashboardPromise,
            reportPromise
          ]),
          3000,
          'Multi sync profiles'
        ).catch(err => console.warn('Background sync warning:', err));


      }
      // Sync active / ready inbox jobs so other devices get latest drafts.
      // Run in small concurrency-capped batches (not all at once) to avoid flooding
      // /api/jobs/upsert with a burst of simultaneous requests during manual sync.
      // Exclude ephemeral front_desk jobs to prevent multi-second delays on profile sync.
      const activeJobs = JobStore.getAllJobs().filter(j => 
        (j.status === 'succeeded' || j.status === 'awaiting_user') &&
        j.kind !== 'front_desk' &&
        !j.id?.startsWith('job_frontdesk_')
      );
      const jobUpsertChunkSize = 5;
      console.log(`[DIAG3] Job upsert loop starting - ${activeJobs.length} jobs queued to sync`);
      const jobLoopStart = Date.now();
      for (let i = 0; i < activeJobs.length; i += jobUpsertChunkSize) {
        const chunk = activeJobs.slice(i, i + jobUpsertChunkSize);
        const chunkStart = Date.now();
        await Promise.all(chunk.map(aj => upsertJobToSupabase(aj, uid).catch((e) => {
          console.log(`[DIAG3] upsertJobToSupabase failed for job ${aj.id}:`, e?.message || e);
        })));
        console.log(`[DIAG3] Chunk ${Math.floor(i / jobUpsertChunkSize) + 1} (${chunk.length} jobs) took ${Date.now() - chunkStart}ms`);
      }
      console.log(`[DIAG3] Job upsert loop finished - ${activeJobs.length} jobs, total ${Date.now() - jobLoopStart}ms`);

      // Artificially enforce a minimum rotation time of 800ms so the user gets clear visual confirmation
      await new Promise(resolve => setTimeout(resolve, 800));
      const finalBundle = {
        profile: updatedProfile,
        foodLogs: finalFoodsToSave,
        biomarkers: currBiomarkers,
        biomarkerHistory: finalBioToSave,
        actions: currActions,
        dailyBenefits: currBenefits,
        foodIdeas: currFoodIdeas,
        report: currReport,
        lastSyncedAt: Date.now()
      };
      await safeSaveToLocalStorage(getStorageKey(updatedProfile?.email || profile?.email || auth.currentUser?.email), finalBundle);
      setSyncState('synced');
      completeInteraction(syncRootId, true, 0);
    } catch (e: any) {
      console.error("[Sync Save Fail]", e);
      handleFirestoreError(e);
      setSyncState('local');
      completeInteraction(syncRootId, false, 0, e.message || 'Save error');
    }
  };

  checkForDbChangesRef.current = checkForDbChanges;
  saveAndSyncRef.current = saveAndSync;

  // lastSyncTime is the pull watermark (parsedLocal.lastSyncedAt) used inside
  // checkForDbChanges; exposed so App.tsx keeps the standing identifier.
  const lastSyncTime = undefined as number | undefined;

  return {
    checkForDbChanges,
    saveAndSync,
    handleFetchMoreFoods,
    lastSyncTime,
  };
}

export default useAppSync;
