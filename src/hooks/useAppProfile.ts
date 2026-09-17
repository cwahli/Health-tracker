/**
 * Q-11.4 — the profile, moved out of `src/App.tsx` (move-only).
 *
 * Owns: the `profile` state, the localStorage persistence effect the packet calls `saveProfile`
 * (real per-email bundles through `getStorageKey(email)`, guarded by `syncState` exactly as before)
 * and `loadUserData` — the loader that reads the per-email bundle, seeds the demo accounts, applies
 * the language/nickname rules, writes the bundle back and hands off to the DB-change check.
 *
 * Deliberate non-changes, so a later pass does not "fix" them by accident:
 * - every body below is the App.tsx text verbatim; only the dynamic `./utils/demoData` import path
 *   and the two `checkForDbChanges` call sites differ (see the ref note in the options interface).
 * - the storage contract is frozen: `last_active_email`, `signup_nickname_<email>`,
 *   `preferred_language`, `demo_profile_type` / `demo_fresh_login` keep their names, no new key is
 *   introduced, and a signed-in user with no stored profile still gets the same empty profile the
 *   shell built before (never a demo default that would keep `isLoggedIn` true).
 * - the persistence effect keeps its original dependency list, `syncState` included only as a read
 *   (never a dependency), because that is what the shell did.
 * - `isAuthChecking`, `syncState`, `isInitialDataLoading` and the food/biomarker states stay in `App.tsx`
 *   (written through the options here, exactly as the shell wrote them).
 *
 * Deliberately still in `App.tsx` (the escape hatch Q-11.3 also used): the demographic-calibration /
 * pending-observation call sites, which sit in JSX props that end in `saveAndSync` (Q-11.5's mass),
 * and the Firestore/Supabase merge itself, which arrives through `checkForDbChangesRef`.
 */
import { useEffect, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { BiomarkerLog, DailyBenefit, FoodIdea, FoodLog, HealthAction, RecommendationReport, UserProfile } from '../types';
import { JobStore } from '../jobs/JobStore';
import { get, set, getStorageKey, safeSaveToLocalStorage, clearChatMemoryKeys } from '../utils/storageUtils';
import { purgeHallucinatedAndCorruptedData } from '../utils/dataSanitize';
import { PRIMARY_NUTRIENTS } from '../utils/nutrients';
import { resolveInitialLanguage } from '../utils/syncUtils';
import type { DemoProfileType } from '../utils/demoData';

/** `App.tsx`'s `checkForDbChanges` as this hook calls it (see `checkForDbChangesRef`). */
export type ProfileDbChangeChecker = (
  forceUserId?: string,
  forcePull?: boolean,
  forceReplaceLocal?: boolean,
) => Promise<unknown>;

/** The shell's sync-state union, kept in lockstep with `App.tsx`. */
export type AppSyncState = 'synced' | 'syncing' | 'local' | 'conflict';

export interface UseAppProfileOptions {
  // ── values the persistence effect writes into the per-email bundle ──────────
  foodLogs: FoodLog[];
  biomarkers: { [key: string]: number | string };
  biomarkerHistory: BiomarkerLog[];
  actions: HealthAction[];
  dailyBenefits: DailyBenefit[];
  foodIdeas: FoodIdea[];
  report: RecommendationReport | null;
  /** Read by the same guard the shell used; deliberately not an effect dependency. */
  syncState: AppSyncState;
  // ── writers `loadUserData` drives (they stay owned by `App.tsx`) ────────────
  setFoodLogs: (val: FoodLog[] | ((prev: FoodLog[]) => FoodLog[])) => void;
  setBiomarkers: (val: { [key: string]: number | string }) => void;
  setBiomarkerHistory: (val: BiomarkerLog[] | ((prev: BiomarkerLog[]) => BiomarkerLog[])) => void;
  setActions: (val: HealthAction[]) => void;
  setDailyBenefits: (val: DailyBenefit[]) => void;
  setReport: (val: RecommendationReport | null) => void;
  setSyncState: (val: AppSyncState) => void;
  setIsInitialDataLoading: (val: boolean) => void;
  setIsAuthChecking: (val: boolean) => void;
  /**
   * `checkForDbChanges` arrives by reference (the Q-11.3b `saveAndSyncRef` pattern): it is declared
   * far below the hook site, so a direct reference would be a render-time TDZ error. The shell
   * assigns it during the same render the hook mounts, before any effect can call the loader.
   */
  checkForDbChangesRef: MutableRefObject<ProfileDbChangeChecker | null>;
}

export interface UseAppProfileReturn {
  profile: UserProfile | null;
  /** Exactly React's own setter shape, so `setProfile(prev => …)` keeps working in the shell. */
  setProfile: Dispatch<SetStateAction<UserProfile | null>>;
  /** Was `App.tsx`'s loader; passed to `useAuthSession` as `onUser`. */
  loadUserData: (
    uid: string,
    email: string,
    displayName?: string,
    photoURL?: string,
    chosenLanguage?: string,
  ) => Promise<void>;
}

export function useAppProfile(options: UseAppProfileOptions): UseAppProfileReturn {
  const {
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
  } = options;

  const [profile, setProfile] = useState<UserProfile | null>(null);

  // The packet's `saveProfile`: localStorage kept in step with React state (hasLocal/canSkipFetch).
  useEffect(() => {
    // Prevent overwriting local storage with empty arrays during initial loading/syncing
    if (!profile || (syncState !== 'synced' && syncState !== 'local' && syncState !== 'conflict')) return;
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
    safeSaveToLocalStorage(getStorageKey(profile?.email), bundle);
  }, [profile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, foodIdeas, report]);

  const loadUserData = async (uid: string, email: string, displayName?: string, photoURL?: string, chosenLanguage?: string) => {
    const newEmail = email.toLowerCase().trim();
    if (!newEmail) {
      setIsAuthChecking(false);
      return;
    }
    localStorage.setItem('last_active_email', newEmail);
    const storageKey = getStorageKey(newEmail);
    
    const parsedLocal = await get(storageKey);
    const cachedSignupNick = localStorage.getItem(`signup_nickname_${newEmail}`);
    const resolvedNickname = (
      displayName ||
      cachedSignupNick ||
      parsedLocal?.profile?.nickname ||
      newEmail.split('@')[0] ||
      'User'
    ).trim();
    
    let loadedProfile: UserProfile | null = null;
    let loadedFoods: FoodLog[] = [];
    let loadedBiomarkers = {};
    let loadedHistory: BiomarkerLog[] = [];
    let loadedActions: HealthAction[] = [];
    let loadedBenefits: DailyBenefit[] = [];
    let loadedReport: RecommendationReport | null = null;

    if (parsedLocal) {
      loadedProfile = parsedLocal.profile || null;
      const deletedFoodMap = loadedProfile?.deletedFoodLogIds || {};
      const deletedBioMap = loadedProfile?.deletedBiomarkerLogIds || {};
      loadedFoods = (parsedLocal.foodLogs || []).filter((f: any) => f.sync_state !== 'delete' && !deletedFoodMap[f.id]);
      loadedHistory = (parsedLocal.biomarkerHistory || []).filter((b: any) => b.sync_state !== 'delete' && !deletedBioMap[b.id]);
      loadedBiomarkers = parsedLocal.biomarkers || {};
      loadedActions = parsedLocal.actions || [];
      loadedBenefits = parsedLocal.dailyBenefits || [];
      loadedReport = parsedLocal.report || null;

      const purged = purgeHallucinatedAndCorruptedData(loadedHistory, loadedBiomarkers, loadedProfile);
      if (purged.purgedCount > 0) {
        loadedHistory = purged.biomarkerHistory;
        loadedBiomarkers = purged.biomarkers;
        if (loadedProfile) {
          loadedProfile = {
            ...loadedProfile,
            deletedBiomarkerLogIds: {
              ...(loadedProfile.deletedBiomarkerLogIds || {}),
              ...(purged.profileUpdates.deletedBiomarkerLogIds || {})
            }
          };
        }
      }
    }

    const isDemoUser = newEmail === 'demo@healthcockpit.com';
    const demoType = (localStorage.getItem('demo_profile_type') || 'average') as DemoProfileType;
    // Explicit "Initial Start (Empty)" demo login always reseeds empty, even when
    // stale cached state exists for the shared demo account. One-shot flag set by
    // AuthScreen.handleDemoLogin and consumed here.
    const freshEmptyDemoLogin = isDemoUser && demoType === 'empty' && localStorage.getItem('demo_fresh_login') === '1';
    if (freshEmptyDemoLogin) {
      localStorage.removeItem('demo_fresh_login');
    }
    if (isDemoUser && (!loadedProfile || loadedHistory.length === 0 || freshEmptyDemoLogin)) {
      if (demoType === 'empty') {
        // Any empty-demo reseed (not only the one-shot fresh-login flag) must
        // drop Front Desk transcripts + JobStore so leftover chats cannot win
        // over the localized welcome.
        clearChatMemoryKeys();
        JobStore.resetAllJobs();
      }
      const demoDataModule = await import('../utils/demoData');
      loadedProfile = demoDataModule.getDemoProfile(demoType);
      loadedFoods = demoDataModule.getDemoFoodLogs(demoType);
      loadedHistory = demoDataModule.getDemoBiomarkerHistory(demoType);
      if (demoType === 'empty') {
        loadedBiomarkers = {};
      } else if (demoType === 'complex') {
        loadedBiomarkers = { fasting_glucose: 131, hba1c: 7.1, total_cholesterol: 228, ldl: 151, hdl: 38, triglycerides: 198, egfr: 64, vitamin_d: 19, wbc: 6.9, hemoglobin: 14.1, bmi: 30.2 };
      } else {
        loadedBiomarkers = { fasting_glucose: 91, hba1c: 5.3, total_cholesterol: 208, ldl: 132, hdl: 46, triglycerides: 155, egfr: 94, vitamin_d: 22, wbc: 6.2, hemoglobin: 14.6, bmi: 23.4 };
      }
      loadedReport = demoDataModule.getDemoReport(demoType, loadedProfile?.language);
      loadedActions = loadedReport.actions || [];
      loadedBenefits = loadedReport.dailyBenefits || [];
    }

    if (!loadedProfile) {
      loadedProfile = {
        nickname: resolvedNickname,
        photoUrl: photoURL || '',
        email: newEmail,
        age: '' as any,
        ethnicity: 'Unknown',
        weight: '' as any,
        height: '' as any,
        gender: 'Unknown',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        language: resolveInitialLanguage(chosenLanguage),
        userType: 'Standard',
        topNutrientsToMonitor: PRIMARY_NUTRIENTS
      };
    } else {
      loadedProfile.email = newEmail;
      if (resolvedNickname && (!loadedProfile.nickname || loadedProfile.nickname === 'Healthy User' || loadedProfile.nickname === 'User')) {
        loadedProfile.nickname = resolvedNickname;
      }
      if (photoURL && !loadedProfile.photoUrl) loadedProfile.photoUrl = photoURL;
      if (!loadedProfile.topNutrientsToMonitor) {
        loadedProfile.topNutrientsToMonitor = PRIMARY_NUTRIENTS;
      }
    }
    if (chosenLanguage && ['en', 'fr', 'zh', 'id'].includes(chosenLanguage)) {
      loadedProfile.language = chosenLanguage as any;
    } else if (loadedProfile && (!loadedProfile.language || !['en', 'fr', 'zh', 'id'].includes(loadedProfile.language))) {
      loadedProfile.language = resolveInitialLanguage();
    }
    if (loadedProfile?.language) {
      localStorage.setItem('preferred_language', loadedProfile.language);
    }
    if (loadedProfile.nickname && loadedProfile.nickname !== 'Healthy User' && loadedProfile.nickname !== 'User') {
      localStorage.setItem(`signup_nickname_${newEmail}`, loadedProfile.nickname);
    }
    loadedProfile.lastLogin = new Date().toISOString();

    const bundle = {
      profile: loadedProfile,
      foodLogs: loadedFoods,
      biomarkers: loadedBiomarkers,
      biomarkerHistory: loadedHistory,
      actions: loadedActions,
      dailyBenefits: loadedBenefits,
      foodIdeas,
      report: loadedReport
    };
    await set(storageKey, bundle);

    setProfile(loadedProfile);
    setFoodLogs(loadedFoods);
    setBiomarkers(loadedBiomarkers);
    setBiomarkerHistory(loadedHistory);
    setActions(loadedActions);
    setDailyBenefits(loadedBenefits);
    setReport(loadedReport);

    setIsAuthChecking(false);

    if (!isDemoUser) {
      const hasSyncedThisSession = sessionStorage.getItem('synced_' + uid) === 'true';
      const isLocalDataEmpty = loadedFoods.length === 0 && loadedHistory.length === 0;

      if (!hasSyncedThisSession) {
        sessionStorage.setItem('synced_' + uid, 'true');
        checkForDbChangesRef.current!(uid, isLocalDataEmpty).catch(err => console.warn("[Auth] Background sync error:", err)).finally(() => {
          setIsInitialDataLoading(false);
        });
      } else if (isLocalDataEmpty) {
        checkForDbChangesRef.current!(uid, true).catch(err => console.warn("[Auth] Background sync error:", err)).finally(() => {
          setIsInitialDataLoading(false);
        });
      } else {
        setSyncState('synced');
        setIsInitialDataLoading(false);
      }
    } else {
      setSyncState('synced');
      setIsInitialDataLoading(false);
    }
  };

  return { profile, setProfile, loadUserData };
}
