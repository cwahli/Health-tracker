import { useEffect } from 'react';
import type { UserProfile, FoodLog, BiomarkerLog, HealthAction, DailyBenefit, RecommendationReport, FoodIdea } from '../types';
import { JobStore } from '../jobs/JobStore';
import { compressImage } from '../utils/imageCompressor';
import { foodLogFingerprint } from '../utils/foodLogDedupe';
import { toYYYYMMDD } from '../utils/dateUtils';
import { maybeRecalibrateDemographicOverlays } from '../utils/appProfileUtils';
import { safeSaveToLocalStorage, getStorageKey } from '../utils/storageUtils';
import { auth } from '../firebase';

export const safeAlert = (message: string) => {
  try {
    alert(message);
  } catch (e) {
    console.warn("alert() was blocked by sandbox iframe restrictions:", e);
  }
};

export interface ConflictData {
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
}

export interface UseFoodLogActionsParams {
  profile: UserProfile | null;
  foodLogs: FoodLog[];
  biomarkers: { [key: string]: number | string };
  biomarkerHistory: BiomarkerLog[];
  actions: HealthAction[];
  dailyBenefits: DailyBenefit[];
  foodIdeas: FoodIdea[];
  report: RecommendationReport | null;
  conflictData: ConflictData | null;
  saveAndSync: (...args: any[]) => Promise<any>;
  setProfile: (p: any) => void;
  setFoodLogs: (val: FoodLog[] | ((prev: FoodLog[]) => FoodLog[])) => void;
  setBiomarkers: (b: { [key: string]: number | string }) => void;
  setBiomarkerHistory: (val: BiomarkerLog[] | ((prev: BiomarkerLog[]) => BiomarkerLog[])) => void;
  setActions: (a: HealthAction[]) => void;
  setDailyBenefits: (d: DailyBenefit[]) => void;
  setReport: (r: RecommendationReport | null) => void;
  setConflictData: (c: ConflictData | null) => void;
  setSyncState: (s: 'synced' | 'syncing' | 'local' | 'conflict') => void;
  setShowSnapshotPanel: (b: boolean) => void;
}

export function useFoodLogActions(params: UseFoodLogActionsParams) {
  const {
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
  } = params;

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

  return {
    handleRestoreSnapshot,
    handleResolveConflict,
    handleLogFood,
    handleUpdateFoodLog,
    handleDeleteFoodLog,
  };
}
