import { useState, useEffect, useCallback } from 'react';
import { FoodLog, BiomarkerLog, HealthAction, DailyBenefit, FoodIdea, RecommendationReport, UserProfile } from '../types';

const FOOD_LOGS_KEY = 'health_food_logs';
const BIOMARKER_HISTORY_KEY = 'health_biomarker_history';
const BIOMARKERS_KEY = 'health_biomarkers';
const ACTIONS_KEY = 'health_actions';
const BENEFITS_KEY = 'health_daily_benefits';
const IDEAS_KEY = 'health_food_ideas';
const REPORT_KEY = 'health_report';

export interface UseAppSyncReturn {
  foodLogs: FoodLog[];
  setFoodLogs: React.Dispatch<React.SetStateAction<FoodLog[]>>;
  biomarkerHistory: BiomarkerLog[];
  setBiomarkerHistory: React.Dispatch<React.SetStateAction<BiomarkerLog[]>>;
  biomarkers: Record<string, number | string>;
  setBiomarkers: React.Dispatch<React.SetStateAction<Record<string, number | string>>>;
  actions: HealthAction[];
  setActions: React.Dispatch<React.SetStateAction<HealthAction[]>>;
  dailyBenefits: DailyBenefit[];
  setDailyBenefits: React.Dispatch<React.SetStateAction<DailyBenefit[]>>;
  foodIdeas: FoodIdea[];
  setFoodIdeas: React.Dispatch<React.SetStateAction<FoodIdea[]>>;
  report: RecommendationReport | null;
  setReport: React.Dispatch<React.SetStateAction<RecommendationReport | null>>;
  draftReport: RecommendationReport | null;
  setDraftReport: React.Dispatch<React.SetStateAction<RecommendationReport | null>>;
  syncState: 'synced' | 'syncing' | 'local' | 'conflict';
  cloudSync: () => Promise<void>;
  forcePush: () => Promise<void>;
  forcePushWithFoods: () => Promise<void>;
  forcePull: () => Promise<void>;
  saveAndSync: (
    profile: UserProfile,
    foodLogs: FoodLog[],
    biomarkers: Record<string, any>,
    biomarkerHistory: BiomarkerLog[],
    actions: HealthAction[],
    dailyBenefits: DailyBenefit[],
    report: any
  ) => Promise<void>;
}

export function useAppSync(profile: UserProfile): UseAppSyncReturn {
  const [foodLogs, setFoodLogs] = useState<FoodLog[]>(() => {
    try {
      const val = localStorage.getItem(FOOD_LOGS_KEY);
      return val ? JSON.parse(val) : [];
    } catch {
      return [];
    }
  });

  const [biomarkerHistory, setBiomarkerHistory] = useState<BiomarkerLog[]>(() => {
    try {
      const val = localStorage.getItem(BIOMARKER_HISTORY_KEY);
      return val ? JSON.parse(val) : [];
    } catch {
      return [];
    }
  });

  const [biomarkers, setBiomarkers] = useState<Record<string, number | string>>(() => {
    try {
      const val = localStorage.getItem(BIOMARKERS_KEY);
      return val ? JSON.parse(val) : {};
    } catch {
      return {};
    }
  });

  const [actions, setActions] = useState<HealthAction[]>(() => {
    try {
      const val = localStorage.getItem(ACTIONS_KEY);
      return val ? JSON.parse(val) : [];
    } catch {
      return [];
    }
  });

  const [dailyBenefits, setDailyBenefits] = useState<DailyBenefit[]>(() => {
    try {
      const val = localStorage.getItem(BENEFITS_KEY);
      return val ? JSON.parse(val) : [];
    } catch {
      return [];
    }
  });

  const [foodIdeas, setFoodIdeas] = useState<FoodIdea[]>(() => {
    try {
      const val = localStorage.getItem(IDEAS_KEY);
      return val ? JSON.parse(val) : [];
    } catch {
      return [];
    }
  });

  const [report, setReport] = useState<RecommendationReport | null>(() => {
    try {
      const val = localStorage.getItem(REPORT_KEY);
      return val ? JSON.parse(val) : null;
    } catch {
      return null;
    }
  });

  const [draftReport, setDraftReport] = useState<RecommendationReport | null>(null);
  const [syncState, setSyncState] = useState<'synced' | 'syncing' | 'local' | 'conflict'>('synced');

  // Sync to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(FOOD_LOGS_KEY, JSON.stringify(foodLogs));
    } catch {}
  }, [foodLogs]);

  useEffect(() => {
    try {
      localStorage.setItem(BIOMARKER_HISTORY_KEY, JSON.stringify(biomarkerHistory));
    } catch {}
  }, [biomarkerHistory]);

  useEffect(() => {
    try {
      localStorage.setItem(BIOMARKERS_KEY, JSON.stringify(biomarkers));
    } catch {}
  }, [biomarkers]);

  useEffect(() => {
    try {
      localStorage.setItem(ACTIONS_KEY, JSON.stringify(actions));
    } catch {}
  }, [actions]);

  useEffect(() => {
    try {
      localStorage.setItem(BENEFITS_KEY, JSON.stringify(dailyBenefits));
    } catch {}
  }, [dailyBenefits]);

  useEffect(() => {
    try {
      localStorage.setItem(IDEAS_KEY, JSON.stringify(foodIdeas));
    } catch {}
  }, [foodIdeas]);

  useEffect(() => {
    try {
      localStorage.setItem(REPORT_KEY, JSON.stringify(report));
    } catch {}
  }, [report]);

  const cloudSync = useCallback(async () => {
    setSyncState('syncing');
    try {
      // In local/demo mode, sync is immediate
      setSyncState('synced');
    } catch {
      setSyncState('local');
    }
  }, []);

  const forcePush = useCallback(async () => {
    setSyncState('syncing');
    try {
      setSyncState('synced');
    } catch {
      setSyncState('local');
    }
  }, []);

  const forcePushWithFoods = useCallback(async () => {
    setSyncState('syncing');
    try {
      setSyncState('synced');
    } catch {
      setSyncState('local');
    }
  }, []);

  const forcePull = useCallback(async () => {
    setSyncState('syncing');
    try {
      setSyncState('synced');
    } catch {
      setSyncState('local');
    }
  }, []);

  const saveAndSync = useCallback(async (
    _p: UserProfile,
    _f: FoodLog[],
    _b: Record<string, any>,
    _bh: BiomarkerLog[],
    _a: HealthAction[],
    _db: DailyBenefit[],
    _r: any
  ) => {
    setSyncState('syncing');
    try {
      setSyncState('synced');
    } catch {
      setSyncState('local');
    }
  }, []);

  return {
    foodLogs,
    setFoodLogs,
    biomarkerHistory,
    setBiomarkerHistory,
    biomarkers,
    setBiomarkers,
    actions,
    setActions,
    dailyBenefits,
    setDailyBenefits,
    foodIdeas,
    setFoodIdeas,
    report,
    setReport,
    draftReport,
    setDraftReport,
    syncState,
    cloudSync,
    forcePush,
    forcePushWithFoods,
    forcePull,
    saveAndSync
  };
}
