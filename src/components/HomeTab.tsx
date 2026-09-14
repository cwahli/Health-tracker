// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { UserProfile, FoodLog, HealthAction, DailyBenefit, RecommendationReport, BiomarkerLog, ChatMessage, FoodIdea } from '../types';
import { translations } from '../utils/translations';
import { displayStatusLabel, displayCategoryLabel, displayClinicalType, displayIssueChrome, displayNutrientName, displayTimeTag, interpolate } from '../utils/i18n';
import { CheckCircle2, Circle, AlertCircle, AlertTriangle, ShieldAlert, Wrench, ArrowRight, Heart, ChevronDown, ChevronUp, Calendar, MapPin, Search, Sparkles, Trash2, Clock, Settings, X, TrendingUp, Activity, Copy, FlaskConical, Plus, BrainCircuit, Loader, Loader2, CheckSquare, Square, Edit2, Save, Check, Zap } from 'lucide-react';
import { parseActionDetails, getDynamicTimeTag, sortActionsByDueDate } from '../utils/actionUtils';
import { getBiomarkerStatus, getBiomarkerColor, getBiomarkerStatusLabel, biomarkerDefinitions, isAsianEthnicity, getBiomarkerMetadata, detectFlaggedTelemetryErrors, buildBiomarkerReviewPrefill, isBiomarkerApproved, isBiomarkerValueImprobable, diagnoseTelemetryIssue, getMappedBiomarkerKey, getIdealBmiTarget } from '../utils/biomarkers';

const getBiomarkerDef = (key: string) => biomarkerDefinitions.find(d => d.key === key);
import { getAgentCalibration, formatOptimalTargetValue } from '../utils/agentCalibration';
import { getCurrentDateInTimezone, toYYYYMMDD } from '../utils/dateUtils';
import { standardizeUnit, reverseStandardizeUnit, formatNormalRange } from '../utils/unitConversion';
import { isCoreNutrient, isAdditionalNutrient, getTopTargetNutrientKeys, extractNutrientValue, isLimitNutrient, isNutrientOverLimit, isNutrientGoalMet, lookupByNutrientKey, canonicalNutrientKey, nutrientKeySlug } from '../utils/nutrients';
import { nutrientDefinitions } from '../utils/nutrition';
import { BiomarkerExpandedSection } from './BiomarkerExpandedSection';
import { FilterPills } from './ui/FilterPills';
import { lazyWithRetry } from '../utils/lazyWithRetry';

const LogChat = lazyWithRetry(() => import('./LogChat'));
import { JobStore } from '../jobs/JobStore';

const defaultNutrientTargets: { [key: string]: string } = {
  calories: "1800 kcal",
  protein: "70 g",
  carbohydrates: "200 g",
  totalFat: "60 g",
  saturatedFat: "20 g",
  unsaturatedFat: "40 g",
  omega3: "1.1 g",
  addedSugar: "25 g",
  totalFibre: "25 g",
  solubleFibre: "5 g",
  sodium: "1500 mg",
  potassium: "3500 mg",
  magnesium: "310 mg",
  calcium: "1000 mg",
  iron: "18 mg",
  zinc: "8 mg",
  selenium: "55 mcg",
  iodine: "150 mcg",
  phosphorus: "700 mg",
  vitaminD: "600 IU",
  vitaminB12: "2.4 mcg",
  folate: "400 mcg",
  vitaminC: "75 mg",
  vitaminE: "15 mg",
  vitaminK: "90 mcg",
  vitaminA: "700 mcg",
  vitaminB6: "1.3 mg",
  thiamine: "1.1 mg",
  riboflavin: "1.1 mg",
  niacin: "14 mg",
  steps: "3000 steps"
};

interface HomeTabProps {
  profile: UserProfile;
  foodLogs: FoodLog[];
  biomarkers: { [key: string]: number | string };
  biomarkerHistory: BiomarkerLog[];
  actions: HealthAction[];
  setActions: (actions: HealthAction[]) => void;
  dailyBenefits: DailyBenefit[];
  setDailyBenefits: (b: DailyBenefit[]) => void;
  foodIdeas: FoodIdea[];
  setFoodIdeas: (ideas: FoodIdea[]) => void;
  report: RecommendationReport | null;
  onNavigateToTab: (tab: 'home' | 'insights' | 'food' | 'medical' | 'trends') => void;
  onEditBiomarkerLog: (id: string, key: string, value: string | number, newDate?: string) => void;
  onDeleteBiomarkerLog: (id: string) => void;
  onDeleteBiomarkerFromLog?: (id: string, key: string) => void;
  onBatchDeleteBiomarkersFromLogs?: (deletions: { id: string; key: string }[]) => Promise<void> | void;
  onBatchEditBiomarkersInLogs?: (updates: { id: string; key: string; value: string | number }[]) => Promise<void> | void;
  onLogMedical?: (biomarkers: { [key: string]: number | string }, profileUpdates?: Partial<UserProfile>, date?: string, entries?: { date: string | null; biomarkers: { [key: string]: number | string } }[]) => void;
  onOpenAgentChat?: (agentType: 'agent1' | 'agent2' | 'agent3' | 'agent4' | 'agent5' | 'health_baseline' | 'agent7' | 'data_review' | 'biomarker_review', options?: { prefillMessage?: string; dataReviewBatchKeys?: string[]; dataReviewBatchIdx?: number | string; autoSendMessage?: string; biomarkerKey?: string }) => void;
  hideSensitive: boolean;
  selectedModelId: string;
  onChangeModelId: (id: string) => void;
  hasBmiAlert?: boolean;
  onDismissBmiAlert?: () => void;
  onUpdateReport?: (report: any) => void;
  onApplyCalculation?: (updates: {
    targetCalories?: number;
    targetWeight?: number;
    addedBenefit?: string;
    descriptionExplain?: string;
  }) => void;
  isLoadingProfile?: boolean;
  syncState?: string;
  onViewJob?: (jobId: string) => void;
  onLogFood?: (foodLog: FoodLog) => void;
}

export default function HomeTab({
  profile,
  foodLogs,
  biomarkers,
  biomarkerHistory,
  actions,
  setActions,
  dailyBenefits,
  setDailyBenefits,
  foodIdeas,
  setFoodIdeas,
  report,
  onNavigateToTab,
  onEditBiomarkerLog,
  onDeleteBiomarkerLog,
  onDeleteBiomarkerFromLog,
  onBatchDeleteBiomarkersFromLogs,
  onBatchEditBiomarkersInLogs,
  onLogMedical,
  onOpenAgentChat,
  hideSensitive,
  selectedModelId,
  onChangeModelId,
  hasBmiAlert,
  onDismissBmiAlert,
  onApplyCalculation,
  onUpdateReport,
  isLoadingProfile,
  syncState,
  onViewJob,
  onLogFood,
}: HomeTabProps) {
  const t = translations[profile.language] || translations.en;
  const activeFoodLogs = React.useMemo(() => (foodLogs || []).filter(f => f.sync_state !== 'delete'), [foodLogs]);
  const activeHistory = React.useMemo(() => (biomarkerHistory || []).filter(h => h.sync_state !== 'delete'), [biomarkerHistory]);
  const [debugResult, setDebugResult] = React.useState<any>(null);
  const [debugLoading, setDebugLoading] = React.useState(false);
  const runSupabasePullDebugCheck = async () => {
    setDebugLoading(true);
    setDebugResult(null);
    try {
      const uid = (profile as any)?.firebase_uid || profile?.uid || '';
      const email = profile?.email || '';
      const res = await fetch(`/api/debug/supabase-pull-check?uid=${encodeURIComponent(uid)}&email=${encodeURIComponent(email)}`);
      const data = await res.json();
      setDebugResult(data);
    } catch (e: any) {
      setDebugResult({ error: e?.message || String(e) });
    } finally {
      setDebugLoading(false);
    }
  };
  const [showAllTargets, setShowAllTargets] = React.useState(false);
  const [expandedActionIds, setExpandedActionIds] = React.useState<Set<string>>(new Set());
  const [showAllActions, setShowAllActions] = React.useState<boolean>(false);

  const toggleExpandAction = (id: string) => {
    setExpandedActionIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const sortedActions = React.useMemo(() => sortActionsByDueDate(actions || []), [actions]);
  const visibleActions = showAllActions ? sortedActions : sortedActions.slice(0, 7);
  const [expandedKey, setExpandedKey] = React.useState<string | null>(null);
  const [reviewingBiomarkerKey, setReviewingBiomarkerKey] = React.useState<string | null>(null);
  const [reviewHistories, setReviewHistories] = React.useState<{[key: string]: ChatMessage[]}>({});
  const [isFoodIdeaChatOpen, setIsFoodIdeaChatOpen] = React.useState(false);
  const [isDailyRecommendationChatOpen, setIsDailyRecommendationChatOpen] = React.useState(false);

  const [jobs, setJobs] = React.useState(() => JobStore.getAllJobs().filter(j => j.kind === 'food_log' || j.kind === 'food_compare' || j.kind === 'medical' || j.kind === 'front_desk'));
  React.useEffect(() => {
    let mounted = true;
    const unsubscribe = JobStore.subscribe(() => {
      queueMicrotask(() => {
        if (mounted) {
          setJobs(JobStore.getAllJobs().filter(j => j.kind === 'food_log' || j.kind === 'food_compare' || j.kind === 'medical' || j.kind === 'front_desk'));
        }
      });
    });
    return () => { mounted = false; unsubscribe(); };
  }, []);

  const [showHealthDiagnostics, setShowHealthDiagnostics] = React.useState(false);
  const [healthApiStatus, setHealthApiStatus] = React.useState<string>("Success (No API payload cached)");
  const [lastApiPayload, setLastApiPayload] = React.useState<any>(null);
  const [userLocation, setUserLocation] = React.useState<{ lat: number; lng: number } | null>(null);

  // Rolling target configurations and persistent states
  const [showAverageInBar, setShowAverageInBar] = React.useState<boolean>(() => {
    const saved = localStorage.getItem('showAverageInBar');
    return saved !== null ? saved === 'true' : true;
  });

  React.useEffect(() => {
    localStorage.setItem('showAverageInBar', String(showAverageInBar));
  }, [showAverageInBar]);

  

  const [rollingEnabled, setRollingEnabled] = React.useState<boolean>(() => {
    return localStorage.getItem('rollingTargetEnabled') === 'true';
  });
  const [rollingDays, setRollingDays] = React.useState<number>(() => {
    const saved = localStorage.getItem('rollingDays');
    return saved ? parseInt(saved, 10) : 7;
  });
  const [rollingAllowance, setRollingAllowance] = React.useState<number>(() => {
    const saved = localStorage.getItem('rollingAllowance');
    return saved ? parseInt(saved, 10) : 20;
  });
  const [viewTimeframe, setViewTimeframe] = React.useState<string>(() => {
    return localStorage.getItem('targetViewTimeframe') || '1';
  });
  const [isSettingsModalOpen, setIsSettingsModalOpen] = React.useState<boolean>(false);
  const [isTargetsExpanded, setIsTargetsExpanded] = React.useState<boolean>(false);

  React.useEffect(() => {
    localStorage.setItem('targetViewTimeframe', viewTimeframe);
  }, [viewTimeframe]);

  React.useEffect(() => {
    localStorage.setItem('rollingTargetEnabled', String(rollingEnabled));
  }, [rollingEnabled]);

  React.useEffect(() => {
    localStorage.setItem('rollingDays', String(rollingDays));
  }, [rollingDays]);

  React.useEffect(() => {
    localStorage.setItem('rollingAllowance', String(rollingAllowance));
  }, [rollingAllowance]);



  // Combine static and custom definitions for HomeTab
  const allDefinitions = React.useMemo(() => {
    // Clone biomarkerDefinitions so we don't mutate the original static array
    const combined = biomarkerDefinitions.map(d => {
      if (d.key === 'bmi') {
        const isAsian = isAsianEthnicity(profile.ethnicity);
        const gender = (profile.gender || 'male').toLowerCase();
        const isMale = gender.startsWith('m');
        const targetBmi = getIdealBmiTarget(profile);
        const targetWeight = Math.round(targetBmi * Math.pow((profile.height || 170) / 100, 2) * 10) / 10;
        return {
          ...d,
          normalRange: isAsian ? '18.5 - 22.9' : '18.5 - 24.9',
          descriptions: {
            ...d.descriptions,
            en: 'A measure of body fat based on height and weight.'
          }
        };
      }
      return {
        ...d,
        descriptions: { ...d.descriptions }
      };
    });
    
    if (profile.customBiomarkers) {
      Object.entries(profile.customBiomarkers).forEach(([key, def]) => {
        const existing = combined.find(d => d.key === key);
        if (existing) {
          if (key === 'bmi') {
            const isAsian = isAsianEthnicity(profile.ethnicity);
            const gender = (profile.gender || 'male').toLowerCase();
            const isMale = gender.startsWith('m');
            const targetBmi = getIdealBmiTarget(profile);
            const targetWeight = Math.round(targetBmi * Math.pow((profile.height || 170) / 100, 2) * 10) / 10;
            existing.normalRange = isAsian ? '18.5 - 22.9' : '18.5 - 24.9';
            existing.descriptions = {
              ...existing.descriptions,
              [profile.language || 'en']: 'A measure of body fat based on height and weight.'
            };
          } else {
            existing.normalRange = def.normalRange || existing.normalRange;
            existing.unit = def.unit || existing.unit;
            if (def.description) {
              existing.descriptions = { ...existing.descriptions, [profile.language || 'en']: def.description };
            }
          }
          if (def.benefitRisk) {
            (existing as any).benefitRisk = def.benefitRisk;
          }
          if (def.standardMedicalGrouping) existing.standardMedicalGrouping = def.standardMedicalGrouping;
          if (def.potentialMedicalConditions) existing.potentialMedicalConditions = def.potentialMedicalConditions;
          if (def.riskCategories) existing.riskCategories = def.riskCategories;
        } else {
          combined.push({
            key,
            name: def.name || key,
            category: 'other',
            unit: def.unit || '',
            normalRange: def.normalRange || 'Unknown',
            descriptions: {
              [profile.language || 'en']: def.description || ''
            },
            benefitRisk: def.benefitRisk,
            standardMedicalGrouping: def.standardMedicalGrouping,
            potentialMedicalConditions: def.potentialMedicalConditions,
            riskCategories: def.riskCategories
          } as any);
        }
      });
    }
    return combined;
  }, [profile.customBiomarkers, profile.language, profile.ethnicity, profile.gender, profile.height]);

  // Compute resolvedBiomarkers including BMI from profile if not explicitly defined in historical log
  const resolvedBiomarkers = React.useMemo(() => {
    const hasHistory = Array.isArray(activeHistory) && activeHistory.length > 0;
    // Collect all keys from history (or fallback dictionary if no history exists yet)
    const keys = new Set<string>();
    if (hasHistory) {
      activeHistory.forEach(h => {
        if (h.biomarkers) {
          Object.keys(h.biomarkers).forEach(k => keys.add(k));
        }
      });
    } else if (biomarkers) {
      Object.keys(biomarkers).forEach(k => keys.add(k));
    }

    const isKeyNotUsed = (k: string) => {
      if (!profile) return false;
      const kLower = k.toLowerCase();
      if (profile.notUsedBiomarkers) {
        if (profile.notUsedBiomarkers[k]) return true;
        if (Object.keys(profile.notUsedBiomarkers).some(nok => nok.toLowerCase() === kLower)) return true;
      }
      if (profile.notUsedInMedicalHistory) {
        if (profile.notUsedInMedicalHistory[k]) return true;
        if (Object.keys(profile.notUsedInMedicalHistory).some(nok => nok.toLowerCase() === kLower)) return true;
      }
      return false;
    };

    // Derive the latest value for each key from history, fallback to biomarkers only if no history exists
    const res: Record<string, number | string> = {};
    keys.forEach(key => {
      if (isKeyNotUsed(key)) return;
      const relevantLogs = (activeHistory || [])
        .filter(h => h.biomarkers && h.biomarkers[key] !== undefined && h.biomarkers[key] !== null && h.biomarkers[key] !== '')
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      if (relevantLogs.length > 0) {
        res[key] = relevantLogs[0].biomarkers[key];
      } else if (!hasHistory && biomarkers && biomarkers[key] !== undefined) {
        res[key] = biomarkers[key];
      }
    });

    if (res.bmi === undefined && profile.weight && profile.height) {
      const heightInMeters = Number(profile.height) / 100;
      const bmiScore = Number(profile.weight) / (heightInMeters * heightInMeters);
      if (!isKeyNotUsed('bmi')) {
        res.bmi = parseFloat(bmiScore.toFixed(1));
      }
    }
    return res;
  }, [biomarkers, activeHistory, profile.weight, profile.height, profile.notUsedBiomarkers, profile.notUsedInMedicalHistory]);

  const problematicBiomarkers = React.useMemo(() => {
    const list = Object.entries(resolvedBiomarkers)
      .map(([key, val]) => {
        const def = allDefinitions.find(d => d.key === key);
        if (!def) return null;
        const status = getBiomarkerStatus(key, val as string | number, def.normalRange, def, profile);
        
        let displayValue = val;
        let displayUnit = def.unit || '';
         if (profile.unitPreference === 'US' && typeof val === 'number') {
            const reversed: any = reverseStandardizeUnit(key, val, displayUnit);
            displayValue = reversed?.newValue ?? reversed;
            displayUnit = reversed?.newUnit || displayUnit;
         }

        return {
          key,
          value: displayValue,
          unit: displayUnit,
          originalValue: val,
          status,
          def: { ...def, unit: displayUnit, normalRange: formatNormalRange(key, def.normalRange || '', def.unit || '', profile.unitPreference as 'SI' | 'US') }
        };
      })
      .filter((b): b is NonNullable<typeof b> => {
        if (b === null) return false;
        if (!isBiomarkerApproved(b.key, profile)) return false;
        
        if (profile?.notUsedBiomarkers) {
          if (profile.notUsedBiomarkers[b.key]) return false;
          const kLower = b.key.toLowerCase();
          if (Object.keys(profile.notUsedBiomarkers).some(nok => nok.toLowerCase() === kLower)) return false;
        }

        if (b.key === 'bmi' && hasBmiAlert) return true;
        
        const statusLabel = getBiomarkerStatusLabel(b.key, b.status, profile.customBiomarkers?.[b.key], b.value, profile).toUpperCase();
        if (statusLabel === 'OPTIMAL' || statusLabel === 'NORMAL' || statusLabel === 'HEALTHY' || statusLabel === 'TARGET' || statusLabel === 'EXCELLENT') return false;

        return b.status === 'high' || b.status === 'low' || b.status === 'critical';
      });

    return list.sort((a, b) => {
      const getPriority = (status: string) => {
        if (status === 'flagged') return 4;
        if (status === 'critical') return 3;
        if (status === 'high' || status === 'low') return 2;
        return 1;
      };
      return getPriority(b.status) - getPriority(a.status);
    });
  }, [resolvedBiomarkers, allDefinitions, hasBmiAlert]);

  const flaggedTelemetryErrors = React.useMemo(() => {
    return detectFlaggedTelemetryErrors(resolvedBiomarkers, profile, activeHistory, allDefinitions);
  }, [resolvedBiomarkers, profile, activeHistory, allDefinitions]);

  const flaggedBiomarkers = React.useMemo(() => {
    return flaggedTelemetryErrors
      .map((f) => {
        const def = allDefinitions.find((d) => d.key === f.key);
        if (!def || !isBiomarkerApproved(f.key, profile)) return null;
        return { key: f.key, status: 'flagged' as const, def, value: f.value, unit: f.unit };
      })
      .filter((b): b is NonNullable<typeof b> => b !== null);
  }, [flaggedTelemetryErrors, profile, allDefinitions]);

  const [showTelemetryModal, setShowTelemetryModal] = React.useState(false);
  const [selectedErrorKeys, setSelectedErrorKeys] = React.useState<Set<string>>(new Set());
  const [editingLogState, setEditingLogState] = React.useState<{ logId: string; date: string; key: string; val: string | number } | null>(null);
  const [editingLogVal, setEditingLogVal] = React.useState<string>('');
  const [telemetryFilterTab, setTelemetryFilterTab] = React.useState<'all' | 'auto_fix' | 'ai_review'>('all');
  const [appliedToastMessage, setAppliedToastMessage] = React.useState<string | null>(null);
  const [pendingAgentTrigger, setPendingAgentTrigger] = React.useState<{ agentType: any; options?: any } | null>(null);
  const [confirmDeleteEntryKey, setConfirmDeleteEntryKey] = React.useState<string | null>(null);
  const [confirmBatchDelete, setConfirmBatchDelete] = React.useState(false);
  const [savingActionKeys, setSavingActionKeys] = React.useState<Record<string, string>>({});
  const [savedActionKeys, setSavedActionKeys] = React.useState<Set<string>>(new Set());

  const markKeySaving = React.useCallback((key: string, label: string = 'Saving...') => {
    setSavingActionKeys(prev => ({ ...prev, [key]: label }));
  }, []);

  const markKeySaved = React.useCallback((key: string) => {
    setSavingActionKeys(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setSavedActionKeys(prev => new Set(prev).add(key));
    setTimeout(() => {
      setSavedActionKeys(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }, 2200);
  }, []);

  React.useEffect(() => {
    if (flaggedTelemetryErrors.length > 0) {
      setSelectedErrorKeys(new Set(flaggedTelemetryErrors.map(e => e.key)));
    } else {
      setSelectedErrorKeys(new Set());
    }
  }, [flaggedTelemetryErrors]);

  const handleInterceptAgentCall = (agentType: any, options?: any) => {
    if (flaggedTelemetryErrors.length > 0 && (agentType === 'health_baseline' || agentType === 'agent1' || agentType === 'agent4')) {
      setPendingAgentTrigger({ agentType, options });
      setShowTelemetryModal(true);
    } else {
      if (onOpenAgentChat) onOpenAgentChat(agentType, options);
    }
  };

  // Compute daily consumption from food history for today
  const todayStr = getCurrentDateInTimezone(profile.timezone);

  const getAverageIntake = React.useCallback((key: string, numDays: number) => {
    let totalIntake = 0;
    let activeDaysCount = 0;
    for (let d = 0; d < numDays; d++) {
      const parts = todayStr.split('-');
      const todayDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      const targetDate = new Date(todayDate);
      targetDate.setDate(todayDate.getDate() - d);
      
      const yyyy = targetDate.getFullYear();
      const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
      const dd = String(targetDate.getDate()).padStart(2, '0');
      const targetDateStr = `${yyyy}-${mm}-${dd}`;
      
      const dayFoods = activeFoodLogs.filter(f => toYYYYMMDD(f.date) === targetDateStr);
      if (dayFoods.length > 0) {
        const dayTotal = dayFoods.reduce((acc, curr) => {
          return acc + extractNutrientValue(curr.nutrients, key);
        }, 0);
        totalIntake += dayTotal;
        activeDaysCount++;
      }
    }
    return activeDaysCount > 0 ? totalIntake / activeDaysCount : 0;
  }, [todayStr, activeFoodLogs]);
  const todaysFoods = activeFoodLogs.filter(f => toYYYYMMDD(f.date) === todayStr);

  const todaysTotals = todaysFoods.reduce((acc, curr) => {
    if (curr.nutrients) {
      Object.keys(curr.nutrients).forEach(k => {
        const key = k as keyof typeof curr.nutrients;
        acc[key] = (Number(acc[key]) || 0) + (Number(curr.nutrients[key]) || 0);
      });
    }
    return acc;
  }, {} as { [key: string]: number });

  // Compute consumption totals/averages based on selected viewTimeframe
  const timeframeTotals = React.useMemo(() => {
    const days = parseInt(viewTimeframe, 10);
    if (days <= 1) {
      return todaysTotals;
    }
    
    const totals: { [key: string]: number } = {};
    
    const parts = todayStr.split('-');
    const todayDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    
    const targetDates = new Set<string>();
    for (let i = 0; i < days; i++) {
      const d = new Date(todayDate);
      d.setDate(todayDate.getDate() - i);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      targetDates.add(`${yyyy}-${mm}-${dd}`);
    }
    
    const foodsInRange = activeFoodLogs.filter(f => targetDates.has(toYYYYMMDD(f.date)));
    const activeDatesInRange = new Set(foodsInRange.map(f => toYYYYMMDD(f.date)));
    const divisor = activeDatesInRange.size > 0 ? activeDatesInRange.size : 1;
    
    foodsInRange.forEach(f => {
      if (f.nutrients) {
        Object.keys(f.nutrients).forEach(k => {
          const val = Number(f.nutrients[k]) || 0;
          totals[k] = (totals[k] || 0) + val;
        });
      }
    });
    
    const averages: { [key: string]: number } = {};
    Object.keys(totals).forEach(k => {
      const avg = totals[k] / divisor;
      if (avg >= 10) {
        averages[k] = Math.round(avg);
      } else {
        averages[k] = Math.round(avg * 10) / 10;
      }
    });
    
    return averages;
  }, [viewTimeframe, todaysTotals, activeFoodLogs, todayStr]);

  // Compute 7-day rolling total sums (for Weekly Targets)
  const rolling7DayTotals = React.useMemo(() => {
    const totals: { [key: string]: number } = {};
    const parts = todayStr.split('-');
    const todayDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    
    const targetDates = new Set<string>();
    for (let i = 0; i < 7; i++) {
      const d = new Date(todayDate);
      d.setDate(todayDate.getDate() - i);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      targetDates.add(`${yyyy}-${mm}-${dd}`);
    }
    
    const foodsInRange = activeFoodLogs.filter(f => targetDates.has(toYYYYMMDD(f.date)));
    
    foodsInRange.forEach(f => {
      if (f.nutrients) {
        Object.keys(f.nutrients).forEach(k => {
          const val = Number(f.nutrients[k]) || 0;
          totals[k] = (totals[k] || 0) + val;
        });
      }
    });
    
    return totals;
  }, [activeFoodLogs, todayStr]);

  const toggleAction = (id: string) => {
    setActions(actions.map(act => act.id === id ? { ...act, completed: !act.completed, updated_at: Date.now() } : act));
  };

  const toggleBenefit = (id: string) => {
    setDailyBenefits(dailyBenefits.map(ben => ben.id === id ? { ...ben, completed: !ben.completed, updated_at: Date.now() } : ben));
  };

  const deleteBenefit = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDailyBenefits(dailyBenefits.filter(ben => ben.id !== id));
  };

  // Target values (Default or from report)
  const parseTarget = (val: any, fallback: number) => {
    if (val === null || val === undefined) return fallback;
    const cleanStr = String(val).replace(/,/g, '');
    const matches = cleanStr.match(/\d+(\.\d+)?/g);
    if (!matches || matches.length === 0) return fallback;
    const parsed = parseFloat(matches[0]);
    return isNaN(parsed) ? fallback : parsed;
  };

  const fallbackUnits: { [key: string]: string } = {
    calories: 'kcal',
    protein: 'g',
    totalFat: 'g',
    saturatedFat: 'g',
    unsaturatedFat: 'g',
    omega3: 'g',
    carbohydrates: 'g',
    addedSugar: 'g',
    totalFibre: 'g',
    solubleFibre: 'g',
    sodium: 'mg',
    potassium: 'mg',
    magnesium: 'mg',
    calcium: 'mg',
    iron: 'mg',
    zinc: 'mg',
    selenium: 'mcg',
    iodine: 'mcg',
    phosphorus: 'mg',
    vitaminD: 'IU',
    vitaminB12: 'mcg',
    folate: 'mcg',
    vitaminC: 'mg',
    vitaminE: 'mg',
    vitaminK: 'mcg',
    vitaminA: 'mcg',
    vitaminB6: 'mg',
    thiamine: 'mg',
    riboflavin: 'mg',
    niacin: 'mg',
    steps: 'steps'
  };

  const parseUnit = (val: any, fallbackUnit: string) => {
    if (val === null || val === undefined) return fallbackUnit;
    const valStr = String(val).trim();
    const unitMatch = valStr.match(/(kcal|mcg|mg|g|IU|steps)/i);
    return unitMatch ? unitMatch[0] : fallbackUnit;
  };

  const getDecimalPlaces = (num: number): number => {
    const str = String(num);
    const dotIndex = str.indexOf('.');
    return dotIndex === -1 ? 0 : str.length - dotIndex - 1;
  };

  const getRollingBreakdown = React.useCallback((key: string, baseTarget: number) => {
    if (!rollingEnabled) return null;
    
    const numPrevDays = rollingDays - 1;
    if (numPrevDays <= 0) return null;
    let totalPrevIntake = 0;
    
    for (let d = 1; d <= numPrevDays; d++) {
      const parts = todayStr.split('-');
      const todayDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      const prevDate = new Date(todayDate);
      prevDate.setDate(todayDate.getDate() - d);
      
      const yyyy = prevDate.getFullYear();
      const mm = String(prevDate.getMonth() + 1).padStart(2, '0');
      const dd = String(prevDate.getDate()).padStart(2, '0');
      const targetDateStr = `${yyyy}-${mm}-${dd}`;
      
      const dayFoods = activeFoodLogs.filter(f => toYYYYMMDD(f.date) === targetDateStr);
      if (dayFoods.length > 0) {
        const dayTotal = dayFoods.reduce((acc, curr) => {
          return acc + extractNutrientValue(curr.nutrients, key);
        }, 0);
        totalPrevIntake += dayTotal;
      } else {
        totalPrevIntake += baseTarget;
      }
    }
    const totalPrevTarget = numPrevDays * baseTarget;
    const deficit = totalPrevTarget - totalPrevIntake;
    
    const maxAdjustment = baseTarget * (rollingAllowance / 100);
    const adjustment = Math.max(-maxAdjustment, Math.min(maxAdjustment, deficit));
    const adjustedValue = baseTarget + adjustment;
    
    const decimals = getDecimalPlaces(baseTarget);
    const factor = Math.pow(10, decimals);
    
    return {
      totalPrevTarget: Math.ceil(totalPrevTarget * factor) / factor,
      totalPrevIntake: Math.ceil(totalPrevIntake * factor) / factor,
      maxAdjustment: Math.ceil(maxAdjustment * factor) / factor,
      adjustment: Math.ceil(adjustment * factor) / factor,
      adjustedValue: Math.ceil(adjustedValue * factor) / factor,
      numPrevDays
    };
  }, [rollingEnabled, rollingDays, rollingAllowance, todayStr, foodLogs]);

  const getAdjustedTarget = React.useCallback((key: string, baseTarget: number): number => {
    const breakdown = getRollingBreakdown(key, baseTarget);
    if (!breakdown) return baseTarget;
    return breakdown.adjustedValue;
  }, [getRollingBreakdown]);

  const topMonitoredKeys = React.useMemo(() => {
    return getTopTargetNutrientKeys(report, profile);
  }, [profile?.topNutrientsToMonitor, report]);

  const topWeeklyNutrientKeys = React.useMemo(() => {
    const rawKeys: string[] = [];
    const pushKey = (raw: any) => {
      const k = typeof raw === 'string' ? raw : (raw?.nutrientKey || raw?.key);
      if (!k) return;
      const canon = canonicalNutrientKey(k);
      if (canon && !rawKeys.includes(canon)) rawKeys.push(canon);
    };
    const rawWeekly = report?.topWeeklyNutrientTargets || report?.weeklyNutrientTargets || [];
    if (Array.isArray(rawWeekly)) {
      rawWeekly.forEach(pushKey);
    } else if (typeof rawWeekly === 'object' && rawWeekly !== null) {
      Object.keys(rawWeekly).forEach(pushKey);
    }
    if (Array.isArray(report?.topNutrientTargets)) {
      report.topNutrientTargets.forEach((k: any) => {
        const strKey = typeof k === 'string' ? k : (k?.nutrientKey || k?.key);
        if (strKey && isAdditionalNutrient(strKey)) pushKey(strKey);
      });
    }
    const cats = report?.healthBaselineCategories || (report as any)?.riskCategories || [];
    if (Array.isArray(cats)) {
      cats.forEach((cat: any) => {
        if (Array.isArray(cat.nutrientTargets) || Array.isArray(cat.priorityNutrientTargets)) {
          (cat.priorityNutrientTargets || cat.nutrientTargets).forEach(pushKey);
        }
      });
    }
    const topSlugs = new Set(topMonitoredKeys.map(nutrientKeySlug));
    const additionalOnly = rawKeys.filter(isAdditionalNutrient);
    const set = new Set<string>();
    additionalOnly.forEach(k => {
      if (!topSlugs.has(nutrientKeySlug(k))) set.add(k);
    });
    return Array.from(set);
  }, [report, topMonitoredKeys]);

  const additionalNutrientKeys = React.useMemo(() => {
    const keys: string[] = [];
    const genObj = report?.generalNutrientTargets || {};
    if (Array.isArray(genObj)) {
      genObj.forEach((item: any) => {
        const k = typeof item === 'string' ? item : (item?.nutrientKey || item?.key);
        if (k && !keys.includes(k) && !topMonitoredKeys.includes(k) && !topWeeklyNutrientKeys.includes(k)) {
          keys.push(k);
        }
      });
    } else if (typeof genObj === 'object' && genObj !== null) {
      Object.keys(genObj).forEach(k => {
        if (!keys.includes(k) && !topMonitoredKeys.includes(k) && !topWeeklyNutrientKeys.includes(k)) {
          keys.push(k);
        }
      });
    }
    if (report?.dailyNutrientTargets) {
      Object.keys(report.dailyNutrientTargets).forEach(k => {
        if (k !== 'steps' && !keys.includes(k) && !topMonitoredKeys.includes(k) && !topWeeklyNutrientKeys.includes(k)) {
          keys.push(k);
        }
      });
    }
    return keys;
  }, [report, topMonitoredKeys, topWeeklyNutrientKeys]);

  const baseCaloriesTarget = report && report.dailyNutrientTargets ? parseTarget(report.dailyNutrientTargets.calories, 1700) : 1800;
  const baseSatFatTarget = report && report.dailyNutrientTargets ? parseTarget(report.dailyNutrientTargets.saturatedFat, 15) : 15;
  const baseSodiumTarget = report && report.dailyNutrientTargets ? parseTarget(report.dailyNutrientTargets.sodium, 1200) : 1200;
  const baseProteinTarget = report && report.dailyNutrientTargets ? parseTarget(report.dailyNutrientTargets.protein, 90) : 90;

  const formatValue = (val: number) => {
    if (val >= 10) return Math.ceil(val);
    return Math.ceil(val * 10) / 10;
  };

  const activeTargets = {
    calories: formatValue(Number(timeframeTotals.calories || 0)),
    caloriesTarget: getAdjustedTarget('calories', baseCaloriesTarget),
    satFat: formatValue(Number(timeframeTotals.saturatedFat || 0)),
    satFatTarget: getAdjustedTarget('saturatedFat', baseSatFatTarget),
    sodium: formatValue(Number(timeframeTotals.sodium || 0)),
    sodiumTarget: getAdjustedTarget('sodium', baseSodiumTarget),
    protein: formatValue(Number(timeframeTotals.protein || 0)),
    proteinTarget: getAdjustedTarget('protein', baseProteinTarget),
  };

  // Compliance calculations (Last 7 days/30 days mock score + live factor)
  const completedActionsCount = actions.filter(a => a.completed).length;
  const completedBenefitsCount = dailyBenefits.filter(b => b.completed).length;
  
  // Real live index score derived from checks
  const rawScore = 65 + (completedActionsCount * 6) + (completedBenefitsCount * 4) - (activeTargets.satFat > activeTargets.satFatTarget ? 8 : 0);
  const complianceScore7Day = Math.min(100, rawScore);
  const complianceScore30Day = Math.min(100, Math.round(rawScore * 0.95));

  const distinctDaysOfData = new Set(activeFoodLogs.map(l => l.date)).size;

  const missingProfilePoints: string[] = [];
  if (profile.age === undefined || profile.age === null || String(profile.age).trim() === '') missingProfilePoints.push(t.age);
  if (profile.ethnicity === undefined || profile.ethnicity === null || String(profile.ethnicity).trim() === '' || String(profile.ethnicity).toLowerCase() === 'unknown') missingProfilePoints.push(t.ethnicity);
  if (profile.weight === undefined || profile.weight === null || String(profile.weight).trim() === '') missingProfilePoints.push(t.weight);
  if (profile.height === undefined || profile.height === null || String(profile.height).trim() === '') missingProfilePoints.push(t.height);

  const getMissingDataStatus = () => {
    const basicInfoMissing = [t.age, t.ethnicity, t.weight, t.height].filter(f => missingProfilePoints.includes(f));
    const missing = [];
    if (basicInfoMissing.length > 0) missing.push(t.basicProfileInfoHint);
    if (activeFoodLogs.length === 0) missing.push(t.someFoodLogsHint);
    if (Object.keys(biomarkers).length === 0) missing.push(t.medicalBiomarkersHint);
    return missing;
  };

  const getDynamicNextStep = () => {
    if (report?.mostImportantNextStep) {
      return report.mostImportantNextStep;
    }
    const missing = getMissingDataStatus();
    if (missing.length > 0) {
      return interpolate(t.getPersonalizedRecs, { missing: missing.join(', ') });
    }
    return "You have provided enough information. Please go to Insights and run a health analysis!";
  };

  const emailSuffix = React.useMemo(() => {
    return profile?.email ? `_${profile.email.toLowerCase().trim()}` : '_guest';
  }, [profile?.email]);

  const lookupTargetRaw = React.useCallback((key: string) => {
    return lookupByNutrientKey(report?.dailyNutrientTargets, key)
      ?? lookupByNutrientKey((report as any)?.generalNutrientTargets, key)
      ?? lookupByNutrientKey(defaultNutrientTargets, key);
  }, [report]);

  const getNutrientSortRank = React.useCallback((key: string) => {
    const reportTargetRaw = lookupTargetRaw(key);
    const baseTarget = parseTarget(reportTargetRaw, 0);
    const adjustedTarget = getAdjustedTarget(key, baseTarget);
    // Use the X days AVG for sorting as requested
    const actualRaw = getAverageIntake(key, rollingDays);
    const pct = adjustedTarget > 0 ? (actualRaw / adjustedTarget) : 0;
    const isLimit = isLimitNutrient(key);

    let tier = 2; // Default Tier 2: Under target / limit (least under target to most under target)
    if (isLimit && pct > 1) {
      tier = 1; // Tier 1: Limit nutrient completely over limit (highest % over limit first)
    } else if (!isLimit && pct > 1) {
      tier = 3; // Tier 3: Target nutrient (e.g. protein) already over target / goal met (goes last)
    }

    return { tier, pct };
  }, [lookupTargetRaw, getAdjustedTarget, getAverageIntake, rollingDays]);

  const sortNutrientKeys = React.useCallback((keys: string[]) => {
    return [...keys].sort((a, b) => {
      const getRank = (key: string) => {
        const reportTargetRaw = lookupTargetRaw(key);
        const baseTarget = parseTarget(reportTargetRaw, 0);
        const adjustedTarget = getAdjustedTarget(key, baseTarget);
        const actualRaw = getAverageIntake(key, rollingDays) || 0;
        const pct = (adjustedTarget && adjustedTarget > 0) ? (actualRaw / adjustedTarget) : 0;
        const isLimit = isLimitNutrient(key);

        let tier = 2; 
        if (isLimit && pct > 1) {
          tier = 1; 
        } else if (!isLimit && pct > 1) {
          tier = 3; 
        }
        return { tier, pct: isNaN(pct) ? 0 : pct };
      };

      const infoA = getRank(a);
      const infoB = getRank(b);

      if (infoA.tier !== infoB.tier) {
        return infoA.tier - infoB.tier;
      }
      return infoB.pct - infoA.pct;
    });
  }, [lookupTargetRaw, getAdjustedTarget, getAverageIntake, rollingDays, parseTarget]);

  const [googleSteps, setGoogleSteps] = React.useState<number | null>(null);
  const [googleStepsAverage, setGoogleStepsAverage] = React.useState<number | null>(null);
  const [lastActiveDaySteps, setLastActiveDaySteps] = React.useState<number | null>(null);
  const [lastActiveDayTimestamp, setLastActiveDayTimestamp] = React.useState<string | null>(null);

  React.useEffect(() => {
    const gs = localStorage.getItem(`googleSteps${emailSuffix}`);
    setGoogleSteps(gs ? parseInt(gs, 10) : null);
    
    const gsa = localStorage.getItem(`googleStepsAverage${emailSuffix}`);
    setGoogleStepsAverage(gsa ? parseInt(gsa, 10) : null);
    
    const lads = localStorage.getItem(`lastActiveDaySteps${emailSuffix}`);
    setLastActiveDaySteps(lads ? parseInt(lads, 10) : null);
    
    setLastActiveDayTimestamp(localStorage.getItem(`lastActiveDayTimestamp${emailSuffix}`));
  }, [emailSuffix]);

  const currentStepsValue = React.useMemo(() => {
    const days = parseInt(viewTimeframe, 10);
    if (days <= 1) {
      return googleSteps || 0;
    }
    const historyStr = localStorage.getItem(`googleStepsHistory${emailSuffix}`);
    if (historyStr) {
      try {
        const history: { date: string; value: number }[] = JSON.parse(historyStr);
        const parts = todayStr.split('-');
        const todayDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        const targetDates = new Set<string>();
        for (let i = 0; i < days; i++) {
          const d = new Date(todayDate);
          d.setDate(todayDate.getDate() - i);
          const yyyy = d.getFullYear();
          const mm = String(d.getMonth() + 1).padStart(2, '0');
          const dd = String(d.getDate()).padStart(2, '0');
          targetDates.add(`${yyyy}-${mm}-${dd}`);
        }
        const matches = history.filter(h => targetDates.has(h.date));
        if (matches.length > 0) {
          const total = matches.reduce((sum, h) => sum + h.value, 0);
          return Math.round(total / days);
        }
      } catch (e) {
        console.warn(e);
      }
    }
    return googleStepsAverage || 0;
  }, [viewTimeframe, googleSteps, googleStepsAverage, todayStr, emailSuffix]);

  React.useEffect(() => {
    const handleGoogleUpdate = () => {
      const gs = localStorage.getItem(`googleSteps${emailSuffix}`);
      setGoogleSteps(gs ? parseInt(gs, 10) : null);
      
      const gsa = localStorage.getItem(`googleStepsAverage${emailSuffix}`);
      setGoogleStepsAverage(gsa ? parseInt(gsa, 10) : null);
      
      const lads = localStorage.getItem(`lastActiveDaySteps${emailSuffix}`);
      setLastActiveDaySteps(lads ? parseInt(lads, 10) : null);
      
      setLastActiveDayTimestamp(localStorage.getItem(`lastActiveDayTimestamp${emailSuffix}`));
    };
    
    window.addEventListener('googleStepsUpdated', handleGoogleUpdate);
    return () => window.removeEventListener('googleStepsUpdated', handleGoogleUpdate);
  }, [emailSuffix]);

  const [profileLoadTimeout, setProfileLoadTimeout] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      setProfileLoadTimeout(true);
    }, 4000);
    return () => clearTimeout(timer);
  }, []);

  const hasNoData = activeFoodLogs.length === 0 && activeHistory.length === 0;

  if (hasNoData) {
    if (!profileLoadTimeout && (isLoadingProfile || syncState === 'syncing')) {
      return (
        <div id="empty-state-loading-container" className="space-y-6 pb-40 animation-fade-in max-w-md mx-auto px-4 mt-4 font-sans text-theme-text">
          <div className="text-center py-8 space-y-3">
            <div className="w-16 h-16 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 rounded-3xl flex items-center justify-center mx-auto shadow-inner">
              <Sparkles className="w-8 h-8 text-indigo-500 animate-pulse" />
            </div>
            <div className="space-y-1">
              <h2 id="empty-state-title" className="text-xl font-extrabold tracking-tight text-theme-text">
                {t.welcomeHealthPortal}
              </h2>
              <p className="text-xs text-theme-text-secondary max-w-sm mx-auto leading-relaxed">
                {t.welcomeLoadingDesc}
              </p>
            </div>
          </div>

          <div id="empty-state-loading-card" className="p-6 bg-theme-bg-card rounded-2xl border border-slate-150 dark:border-slate-800 shadow-sm text-center space-y-4">
            <div className="w-12 h-12 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 rounded-2xl flex items-center justify-center mx-auto shadow-inner">
              <Loader className="w-6 h-6 animate-spin" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-theme-text">
                {t.loadingProfile}
              </h3>
              <p className="text-xs text-theme-text-secondary leading-normal max-w-xs mx-auto">
                {t.loadingProfileDesc}
              </p>
            </div>
            <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
              <div className="bg-indigo-600 h-full w-2/3 rounded-full animate-pulse mx-auto"></div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-6 pb-40 animation-fade-in max-w-md mx-auto px-4 mt-4 font-sans text-theme-text">
        <div className="text-center py-8 space-y-3">
          <div className="w-16 h-16 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 rounded-3xl flex items-center justify-center mx-auto shadow-inner">
            <Sparkles className="w-8 h-8" />
          </div>
          <div className="space-y-1">
            <h2 id="empty-state-title" className="text-xl font-extrabold tracking-tight text-theme-text">
              {t.welcomeHealthPortal}
            </h2>
            <p className="text-xs text-theme-text-secondary max-w-sm mx-auto leading-relaxed">
              {t.dashboardReadyDesc}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {/* Option 1: Complete Profile */}
          <div id="empty-state-profile-card" className="p-5 bg-theme-bg-card rounded-2xl border border-slate-150 dark:border-slate-800 shadow-sm space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2.5 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 rounded-xl shrink-0">
                <Settings className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-theme-text">
                  {t.completeYourProfile}
                </h3>
                <p className="text-xs text-theme-text-secondary leading-normal">
                  {t.completeProfileDesc}
                </p>
              </div>
            </div>
            <button
              id="empty-state-profile-btn"
              onClick={() => {
                document.getElementById('avatar-edit-btn')?.click();
              }}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm active:scale-95 cursor-pointer"
            >
              {t.configureProfile}
            </button>
          </div>

          {/* Option 2: Log Food */}
          <div id="empty-state-food-card" className="p-5 bg-theme-bg-card rounded-2xl border border-slate-150 dark:border-slate-800 shadow-sm space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 rounded-xl shrink-0">
                <Heart className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-theme-text">
                  {t.logFoodOrMeal}
                </h3>
                <p className="text-xs text-theme-text-secondary leading-normal">
                  {t.logFoodOrMealDesc}
                </p>
              </div>
            </div>
            <button
              id="empty-state-food-btn"
              onClick={() => {
                const foodFab = document.getElementById('fab-food-btn');
                if (foodFab) {
                  foodFab.click();
                } else {
                  onNavigateToTab('food');
                }
              }}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm active:scale-95 cursor-pointer"
            >
              {t.addFirstFoodLog}
            </button>
          </div>

          {/* TEMP DEBUG: Supabase pull check — remove once data-loss issue is resolved */}
          <div id="empty-state-debug-card" className="p-5 bg-theme-bg-card rounded-2xl border border-dashed border-amber-400/60 shadow-sm space-y-3">
            <h3 className="text-xs font-bold text-amber-500">Debug: Check Supabase Data</h3>
            <p className="text-xs text-theme-text-secondary leading-normal">
              If you expected to see existing data here, tap this to check what the server actually finds in Supabase.
            </p>
            <button
              id="empty-state-debug-btn"
              onClick={runSupabasePullDebugCheck}
              disabled={debugLoading}
              className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold transition-all shadow-sm active:scale-95 cursor-pointer disabled:opacity-60"
            >
              {debugLoading ? 'Checking...' : 'Run Debug Check'}
            </button>
            {debugResult && (
              <pre className="text-[10px] leading-tight whitespace-pre-wrap break-words bg-black/80 text-emerald-300 p-3 rounded-lg max-h-80 overflow-y-auto">
                {JSON.stringify(debugResult, null, 2)}
              </pre>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-40 animation-fade-in max-w-md mx-auto px-4 mt-4 font-sans text-theme-text">
      
      {/* Combined Biomarker Telemetry & Flagged Review Warning Banner */}
      {(flaggedTelemetryErrors.length > 0 || flaggedBiomarkers.length > 0) && (() => {
        const allFlaggedKeys = Array.from(new Set([
          ...flaggedTelemetryErrors.map(e => e.key),
          ...flaggedBiomarkers.map(b => b.key)
        ]));

        return (
          <div id="flagged-biomarkers-banner" className="p-4 bg-amber-500/10 dark:bg-amber-950/40 border-2 border-amber-500/30 dark:border-amber-700/80 rounded-2xl space-y-3 shadow-md">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300 font-bold text-sm font-display">
                <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 animate-pulse" />
                <span>
                  {flaggedTelemetryErrors.length > 0
                    ? t.telemetryErrorsDetected
                    : flaggedBiomarkers.length === 1
                    ? t.biomarkerFlaggedReviewOne
                    : t.biomarkerFlaggedReviewMany.replace('{count}', String(flaggedBiomarkers.length))}
                </span>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 bg-amber-500/20 text-amber-700 dark:text-amber-300 rounded-full font-bold shrink-0">
                {allFlaggedKeys.length > 1 ? t.issuesCount.replace('{count}', String(allFlaggedKeys.length)) : t.issueCountOne}
              </span>
            </div>

            <p className="text-xs text-amber-900/90 dark:text-amber-200/90 leading-relaxed">
              {flaggedTelemetryErrors.length > 0 ? (
                <>
                  {t.telemetryBannerBody}
                </>
              ) : (
                <>
                  {t.flaggedValueMixupBody} <strong className="font-semibold underline">{flaggedBiomarkers.map(b => b.def.name).join(', ')}</strong>
                </>
              )}
            </p>

            {/* Issue Details Chips (Interactive) */}
            <div className="flex flex-col sm:flex-row flex-wrap gap-2 pt-1">
              {flaggedTelemetryErrors.map(err => (
                <button
                  key={err.key}
                  type="button"
                  onClick={() => {
                    setSelectedErrorKeys(new Set([err.key]));
                    setShowTelemetryModal(true);
                  }}
                  className="px-2.5 py-1.5 bg-amber-100/80 hover:bg-amber-200/80 dark:bg-amber-950/50 dark:hover:bg-amber-900/60 border border-amber-300/40 dark:border-amber-700/50 rounded-lg text-xs font-medium text-amber-900 dark:text-amber-200 flex flex-col gap-1 text-left transition-all cursor-pointer shadow-2xs active:scale-98"
                >
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-bold">{err.name}:</span>
                    <span className="font-mono text-[11px] text-amber-700 dark:text-amber-300">{err.samples.map((s: string) => displayIssueChrome(profile.language, s)).join(' → ')}</span>
                    {err.badgeLabel && (
                      <span className="text-[10px] bg-rose-200/80 dark:bg-rose-900/60 text-rose-800 dark:text-rose-200 px-1.5 py-0.5 rounded font-bold">
                        {displayIssueChrome(profile.language, err.badgeLabel)}
                      </span>
                    )}
                  </div>
                  {err.preciseCause && (
                    <div className="text-[11px] text-rose-800 dark:text-rose-300 font-normal leading-tight">
                      {err.preciseCause}
                    </div>
                  )}
                </button>
              ))}
              {flaggedBiomarkers.filter(b => !flaggedTelemetryErrors.some(t => t.key === b.key)).map(b => (
                <button
                  key={b.key}
                  type="button"
                  onClick={() => {
                    setSelectedErrorKeys(new Set([b.key]));
                    setShowTelemetryModal(true);
                  }}
                  className="px-2.5 py-1 bg-amber-100/80 hover:bg-amber-200/80 dark:bg-amber-950/50 dark:hover:bg-amber-900/60 border border-amber-300/40 dark:border-amber-700/50 rounded-lg text-xs font-medium text-amber-900 dark:text-amber-200 flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs active:scale-98"
                >
                  <span className="font-bold">{b.def.name || b.key}:</span>
                  <span className="font-mono text-[11px] text-amber-700 dark:text-amber-300">Flagged for Review</span>
                </button>
              ))}
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-amber-500/20">
              <button
                type="button"
                onClick={() => {
                  setSelectedErrorKeys(new Set(flaggedTelemetryErrors.map(e => e.key)));
                  setShowTelemetryModal(true);
                }}
                className="px-3.5 py-2 bg-white dark:bg-slate-800 hover:bg-amber-50 dark:hover:bg-slate-700 text-amber-800 dark:text-amber-300 border border-amber-300/80 dark:border-amber-700/60 rounded-xl text-xs font-bold transition-all shadow-xs active:scale-95 cursor-pointer flex items-center gap-1.5"
              >
                <Edit2 className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                <span>{t.manageEditAllIssues.replace('{count}', String(allFlaggedKeys.length))}</span>
              </button>
            </div>
          </div>
        );
      })()}

      {/* Daily Recommendation */}
      <div id="primary-action-card" className="p-2">
        <div className="flex items-center justify-between bg-theme-bg-card p-4 rounded-2xl border border-theme-border shadow-sm">
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-theme-text flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-500" />
              {t.dailyRecommendation}
            </h3>
            <p className="text-xs text-theme-text-secondary">
              {t.dailyRecommendationDesc}
            </p>
          </div>
          <button
            onClick={() => setIsDailyRecommendationChatOpen(true)}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-md active:scale-95 cursor-pointer whitespace-nowrap"
          >
            {t.whatsUpToday}
          </button>
        </div>
      </div>

      {/* Nutrition Allowance Tracker Dashboard (MOVED UP just above Health Status & BMI) */}
      <div id="dashboard-nutrition-targets" className="space-y-4">
        <div className="flex justify-between items-center pb-2 border-b border-theme-border/50">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-theme-text text-sm flex items-center gap-1.5">
              <Heart className="w-4 h-4 text-indigo-600" />
              {t.topTargets}
            </h3>
            {/* Quick Timeframe Switcher */}
            <div className="flex items-center bg-slate-100 dark:bg-slate-800/80 rounded-lg p-0.5 border border-slate-200 dark:border-slate-700/60">
              <button
                type="button"
                onClick={() => setViewTimeframe('1')}
                className={`px-2 py-0.5 text-[10px] font-bold rounded-md transition-colors cursor-pointer ${
                  viewTimeframe === '1'
                    ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-xs'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                {t.viewTimeframeToday || 'Today'}
              </button>
              <button
                type="button"
                onClick={() => setViewTimeframe('7')}
                className={`px-2 py-0.5 text-[10px] font-bold rounded-md transition-colors cursor-pointer ${
                  viewTimeframe === '7'
                    ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-xs'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                {t.rolling7Day || 'Rolling 7-Day'}
              </button>
            </div>
          </div>
          <span className="text-[10px] font-mono text-slate-400 flex items-center gap-1">
            <Calendar className="w-3 h-3" /> {viewTimeframe === '1' ? todayStr : (t.rolling7Day || 'Rolling 7-Day')}
          </span>
        </div>

        {/* Live progress bars comparing actual todaysTotals vs targets */}
        <div className="space-y-4">
          {/* Dynamic Top Monitored Nutrient Bars */}
          {(() => {
            const sortedKeys = sortNutrientKeys(topMonitoredKeys).filter(k => canonicalNutrientKey(k) !== 'steps');

            return sortedKeys.map((key) => {
              const reportTargetRaw = lookupTargetRaw(key);
            const baseTarget = parseTarget(reportTargetRaw, 0);
            const adjustedTarget = getAdjustedTarget(key, baseTarget);
            const actualRaw = extractNutrientValue(timeframeTotals, key);
            const actual = formatValue(actualRaw);
            const unit = parseUnit(reportTargetRaw, fallbackUnits[canonicalNutrientKey(key)] || fallbackUnits[key] || 'g');

            const nutDef = nutrientDefinitions.find(n => n.key === canonicalNutrientKey(key));
            const label = displayNutrientName(profile.language, key) || nutDef?.labels?.en || key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());

            const isLimit = isLimitNutrient(key);
            const isOver = isNutrientOverLimit(key, actualRaw, adjustedTarget);
            const isMet = isNutrientGoalMet(key, actualRaw, adjustedTarget);

            return (
              <div key={key} className="space-y-1">
                <div className="flex justify-between text-xs font-semibold">
                  <span className="text-theme-neutral flex items-center gap-1.5">
                    <span>{label}</span>
                    {getAverageIntake(key, rollingDays) > 0 && (() => {
                      const avg = getAverageIntake(key, rollingDays);
                      const isAvgOver = adjustedTarget > 0 && avg > adjustedTarget;
                      const pctAbove = isAvgOver ? ((avg - adjustedTarget) / adjustedTarget) * 100 : 0;
                      let textColor = "text-slate-400 dark:text-slate-500 font-normal";
                      let overText = "";
                      
                      if (isAvgOver) {
                        textColor = isLimit ? "text-rose-600 dark:text-rose-500 font-bold" : "text-emerald-600 dark:text-emerald-500 font-bold";
                        overText = interpolate(t.avgPercentOverSuffix, { pct: pctAbove.toFixed(0) });
                      }
                      
                      return (
                        <span className={`text-[10px] ${textColor}`}>
                          · {interpolate(t.avgAmount, { value: formatValue(avg), unit })}{overText}
                        </span>
                      );
                    })()}
                  </span>
                  {isOver ? (
                    <span className="text-rose-500 font-bold font-mono">
                      {interpolate(t.overDailyAmount, { amount: formatValue(actual - adjustedTarget), unit, target: adjustedTarget })}
                    </span>
                  ) : isMet ? (
                    <span className="text-emerald-500 font-bold font-mono">
                      {actual}{unit} / {adjustedTarget}{unit}
                    </span>
                  ) : (
                    <span className="text-slate-500 font-mono">
                      {actual}{unit} / {adjustedTarget}{unit}
                    </span>
                  )}
                </div>
                
                
                <div className="relative h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex">
                  {/* Base daily bar */}
                  <div 
                    className={`h-full rounded-full transition-all duration-500 ${isLimit && isOver ? 'bg-indigo-600' : isMet ? 'bg-emerald-500' : 'bg-indigo-600'}`} 
                    style={{ width: `${adjustedTarget > 0 ? Math.min(100, (actualRaw / adjustedTarget) * 100) : 0}%` }}
                  />
                  
                  {/* Daily wrap-around (if actual > target) */}
                  {actualRaw > adjustedTarget && (
                    <div 
                      className={`absolute left-0 top-0 h-full rounded-full transition-all duration-500 ${isLimit ? 'bg-rose-500' : 'bg-emerald-400 opacity-75'}`} 
                      style={{ width: `${Math.min(100, ((actualRaw - adjustedTarget) / adjustedTarget) * 100)}%` }}
                    />
                  )}
                  
                  {/* Average wrap-around and indicator */}
                  {(() => {
                     const avg = getAverageIntake(key, rollingDays);
                     if (avg === 0 || adjustedTarget === 0) return null;
                     
                     if (avg > adjustedTarget) {
                       const pctOverage = Math.min(100, ((avg - adjustedTarget) / adjustedTarget) * 100);
                       if (isLimit) {
                         return (
                           <div 
                             className="absolute top-0 bottom-0 bg-rose-500/30 z-10 border-r-[3px] border-rose-600 shadow-xs"
                             style={{ left: 0, width: `${pctOverage}%` }}
                             title={interpolate(t.nDayAverageOver, { days: rollingDays, value: formatValue(avg), unit, pct: pctOverage.toFixed(0) })}
                           />
                         );
                       } else {
                         return (
                           <div 
                             className="absolute top-0 bottom-0 bg-emerald-500/30 z-10 border-r-[3px] border-emerald-600 shadow-xs"
                             style={{ left: 0, width: `${pctOverage}%` }}
                             title={interpolate(t.nDayAverageOver, { days: rollingDays, value: formatValue(avg), unit, pct: pctOverage.toFixed(0) })}
                           />
                         );
                       }
                     } else {
                       const pct = Math.min(100, (avg / adjustedTarget) * 100);
                       return (
                         <div 
                           className="absolute top-0 bottom-0 w-[3px] bg-amber-400 z-10 shadow-xs"
                           style={{ left: `${pct}%` }}
                           title={interpolate(t.nDayAverage, { days: rollingDays, value: formatValue(avg), unit })}
                         />
                       );
                     }
                  })()}
                </div>
              </div>
            );
          });
        })()}

          {/* Steps Bar */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs font-semibold">
              <span className="text-theme-neutral flex items-center gap-1">
                <span>{t.stepsLabel}</span>
                {googleStepsAverage !== null && (
                  <span className="text-[10px] text-slate-400 font-normal">
                    {interpolate(t.sevenDayAvgParen, { n: googleStepsAverage.toLocaleString() })}
                  </span>
                )}
              </span>
              <span className={`font-mono ${currentStepsValue >= (parseTarget(report?.dailyNutrientTargets?.steps, 3000)) ? 'text-emerald-500 font-bold' : 'text-slate-500'}`}>
                {interpolate(t.stepsProgress, { actual: currentStepsValue, target: parseTarget(report?.dailyNutrientTargets?.steps, 3000) })}
              </span>
            </div>
            <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
              <div 
                className={`h-full rounded-full transition-all duration-500 ${currentStepsValue >= (parseTarget(report?.dailyNutrientTargets?.steps, 3000)) ? 'bg-emerald-500' : 'bg-indigo-600'}`} 
                style={{ width: `${Math.min(100, (currentStepsValue / (parseTarget(report?.dailyNutrientTargets?.steps, 3000))) * 100)}%` }}
              />
            </div>
            {currentStepsValue === 0 && lastActiveDaySteps && (
              <p className="text-[10px] text-slate-400 italic">
                {interpolate(t.todayZeroStepsLastActive, { n: lastActiveDaySteps.toLocaleString(), when: lastActiveDayTimestamp })}
              </p>
            )}
          </div>
        </div>

        {/* Weekly Targets Section (Top Weekly Nutrient Targets x7 on 7-day rolling basis) */}
        {topWeeklyNutrientKeys.length > 0 && (
          <div id="dashboard-weekly-targets" className="space-y-4 pt-4 border-t border-theme-border/50">
            <div className="flex justify-between items-center pb-2 border-b border-theme-border/50">
              <h3 className="font-bold text-theme-text text-sm flex items-center gap-2">
                <Calendar className="w-4 h-4 text-indigo-600" />
                {t.weeklyTargets}
              </h3>
              <span className="text-[10px] font-mono text-slate-400 flex items-center gap-1">
                {t.rolling7Day}
              </span>
            </div>

            <div className="space-y-3">
              {sortNutrientKeys(topWeeklyNutrientKeys).map((key) => {
                const reportTargetRaw = lookupTargetRaw(key);
                const baseDailyTarget = parseTarget(reportTargetRaw, 0);
                const weeklyTarget = baseDailyTarget * 7;
                const actual7dRaw = extractNutrientValue(rolling7DayTotals, key);
                const actual7d = formatValue(actual7dRaw);
                const unit = parseUnit(reportTargetRaw, fallbackUnits[canonicalNutrientKey(key)] || fallbackUnits[key] || 'mg');

                const nutDef = nutrientDefinitions.find(n => n.key === canonicalNutrientKey(key));
                const label = displayNutrientName(profile.language, key) || nutDef?.labels?.en || key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());

                const isLimit = isLimitNutrient(key);
                const isOver = isNutrientOverLimit(key, actual7dRaw, weeklyTarget);
                const isMet = isNutrientGoalMet(key, actual7dRaw, weeklyTarget);

                const pct = weeklyTarget > 0 ? (actual7dRaw / weeklyTarget) * 100 : 0;

                return (
                  <div key={key} className="space-y-1">
                    <div className="flex justify-between text-xs font-semibold">
                      <span className="text-theme-neutral">{label}</span>
                      {isOver ? (
                        <span className="text-rose-500 font-bold font-mono">
                          {interpolate(t.overWeeklyAmount, { amount: formatValue(actual7dRaw - weeklyTarget), unit, target: weeklyTarget })}
                        </span>
                      ) : isMet ? (
                        <span className="text-emerald-500 font-bold font-mono">
                          {actual7d} / {weeklyTarget}{unit} {t.perWeek}
                        </span>
                      ) : (
                        <span className="text-slate-500 font-mono">
                          {actual7d} / {weeklyTarget}{unit} {t.perWeek}
                        </span>
                      )}
                    </div>
                    
                <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex">
                  {isOver ? (
                    <>
                      <div 
                        className="h-full bg-indigo-600 transition-all duration-500" 
                        style={{ width: `${(weeklyTarget / actual7dRaw) * 100}%` }}
                      />
                      <div 
                        className="h-full bg-rose-500 transition-all duration-500" 
                        style={{ width: `${((actual7dRaw - weeklyTarget) / actual7dRaw) * 100}%` }}
                      />
                    </>
                  ) : (
                    <div 
                      className={`h-full rounded-full transition-all duration-500 ${isMet ? 'bg-emerald-500' : 'bg-indigo-600'}`} 
                      style={{ width: `${weeklyTarget > 0 ? Math.min(100, pct) : 0}%` }}
                    />
                  )}
                </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Expandable Targets Section */}
        {true && (
          <div>
            <div className="flex items-center justify-between pt-2 border-t border-theme-border/30 mt-3">
              <button
                onClick={() => setShowAllTargets(!showAllTargets)}
                className="flex items-center gap-1 text-xs text-slate-400 hover:text-indigo-600 font-semibold cursor-pointer"
              >
                <span>{showAllTargets ? t.showLessTargets : t.expandTargets}</span>
                {showAllTargets ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              
              <button
                onClick={() => setIsSettingsModalOpen(true)}
                className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 font-semibold cursor-pointer"
              >
                <Settings className="w-3.5 h-3.5" />
                <span>{t.settings}</span>
              </button>
            </div>

            {showAllTargets && (() => {
              const topSlugs = new Set([...topMonitoredKeys, ...topWeeklyNutrientKeys].map(nutrientKeySlug));
              const rawRemaining = Object.entries(report?.dailyNutrientTargets || defaultNutrientTargets).filter(([key]) => nutrientKeySlug(key) !== 'steps' && !topSlugs.has(nutrientKeySlug(key)));
              const sortedRemainingKeys = sortNutrientKeys([...new Set(rawRemaining.map(([k]) => canonicalNutrientKey(k)))]);
              const remainingEntries = sortedRemainingKeys.map(k => {
                const item = rawRemaining.find(([rk]) => nutrientKeySlug(rk) === nutrientKeySlug(k));
                return item ? [canonicalNutrientKey(item[0]), item[1]] : [k, lookupTargetRaw(k)];
              });
              const coreTargets = remainingEntries.filter(([key]) => isCoreNutrient(key));
              const additionalTargets = remainingEntries.filter(([key]) => !isCoreNutrient(key));

              const renderTarget = ([key, val]: [string, any]) => {
                  const baseTarget = parseTarget(val, 0);
                  const unit = parseUnit(val, fallbackUnits[canonicalNutrientKey(key)] || fallbackUnits[key] || 'g');
                  const actual = extractNutrientValue(timeframeTotals, key);
                  const adjustedTarget = getAdjustedTarget(key, baseTarget);
                  
                  const pct = adjustedTarget > 0 ? (actual / adjustedTarget) * 100 : 0;
                  
                  const isLimit = isLimitNutrient(key);
                  const isOver = isNutrientOverLimit(key, actual, adjustedTarget);
                  
                  let barColor = 'bg-indigo-600';
                  if (isLimit) {
                    barColor = isOver ? 'bg-rose-500' : 'bg-emerald-500';
                  } else {
                    barColor = isNutrientGoalMet(key, actual, adjustedTarget) ? 'bg-emerald-500' : 'bg-indigo-600';
                  }

                  const formattedActual = formatValue(actual);

                  return (
                    <div key={key} className="flex flex-col py-2 border-b border-theme-border/50 space-y-1">
                      <div className="flex justify-between items-start text-[10px] leading-tight">
                        <span className="text-theme-text-secondary font-bold capitalize truncate max-w-[80px]">
                          {displayNutrientName(profile.language, key) || key.replace(/([A-Z])/g, ' $1').trim()}
                        </span>
                        <span className="text-slate-400 dark:text-slate-500 font-semibold font-mono text-[9px] whitespace-nowrap">
                          {formattedActual}/{adjustedTarget}{unit}
                        </span>
                      </div>
                      <div className="h-1.5 bg-slate-100 dark:bg-slate-800/80 rounded-full overflow-hidden">
                        <div 
                          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                          style={{ width: `${Math.min(100, pct)}%` }}
                        />
                      </div>
                    </div>
                  );
              };

              return (
                <div className="mt-4 space-y-4 animation-slide-down">
                  {coreTargets.length > 0 && (
                    <div>
                      <h4 className="text-[10px] font-bold text-theme-neutral mb-1 border-b border-theme-border/50 pb-1">{t.coreNutrients}</h4>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        {coreTargets.map(renderTarget)}
                      </div>
                    </div>
                  )}
                  {additionalTargets.length > 0 && (
                    <div>
                      <h4 className="text-[10px] font-bold text-theme-neutral mb-1 border-b border-theme-border/50 pb-1">{t.additionalNutrients}</h4>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        {additionalTargets.map(renderTarget)}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* Settings Modal */}
      {isSettingsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-sm bg-theme-bg-card border border-theme-border rounded-3xl p-6 shadow-xl space-y-5 max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="flex justify-between items-center pb-2 border-b border-theme-border/50">
              <h3 className="font-bold text-theme-text text-sm flex items-center gap-2">
                <Settings className="w-4 h-4 text-indigo-600" />
                {t.targetBudgetSettings}
              </h3>
              <button
                onClick={() => setIsSettingsModalOpen(false)}
                className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-850 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Explanation card */}
            <div className="p-3 bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-500/10 rounded-2xl text-xs text-indigo-950 dark:text-indigo-200/90 leading-relaxed space-y-2">
              <span className="font-bold block text-indigo-900 dark:text-indigo-300">{t.howRollingBudgetWorks}</span>
              {(() => {
                const calBD = getRollingBreakdown('calories', baseCaloriesTarget);
                const proBD = getRollingBreakdown('protein', baseProteinTarget);
                const fatBD = getRollingBreakdown('saturatedFat', baseSatFatTarget);
                
                if (!calBD || !proBD || !fatBD) return <p>Adjusts your target today based on your previous days' averages.</p>;
                
                return (
                  <div className="space-y-2">
                    <div className="grid grid-cols-1 gap-1.5 text-[10px] font-mono">
                      <div className="flex flex-col">
                        <span className="font-bold">Calories:</span>
                        <span className="text-indigo-600 dark:text-indigo-400">({calBD.totalPrevIntake} kcal / {calBD.numPrevDays} days) ± {rollingAllowance}% allowance = {calBD.adjustedValue} kcal</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="font-bold">Protein:</span>
                        <span className="text-indigo-600 dark:text-indigo-400">({proBD.totalPrevIntake} g / {proBD.numPrevDays} days) ± {rollingAllowance}% allowance = {proBD.adjustedValue} g</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="font-bold">Sat. Fat:</span>
                        <span className="text-indigo-600 dark:text-indigo-400">({fatBD.totalPrevIntake} g / {fatBD.numPrevDays} days) ± {rollingAllowance}% allowance = {fatBD.adjustedValue} g</span>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Form Fields */}
            <div className="space-y-4">
              {/* Toggle Average Indicator */}
              <div className="flex items-center justify-between p-1">
                <div className="space-y-0.5">
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200">Show {rollingDays}-Day Average</span>
                  <p className="text-[10px] text-slate-400">Display average indicator in top nutrient bars</p>
                </div>
                <button
                  onClick={() => setShowAverageInBar(!showAverageInBar)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${
                    showAverageInBar ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-slate-800'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      showAverageInBar ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
              
              {/* Toggle */}
              <div className="flex items-center justify-between p-1">
                <div className="space-y-0.5">
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200">{t.enableRollingTarget}</span>
                  <p className="text-[10px] text-slate-400">{t.adaptTargetsHistoryDesc}</p>
                </div>
                <button
                  onClick={() => setRollingEnabled(!rollingEnabled)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${
                    rollingEnabled ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-slate-800'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      rollingEnabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {rollingEnabled && (
                <>
                  {/* Rolling Days */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs font-bold text-theme-text">
                      <span>{t.rollingTimeframe}</span>
                      <span className="text-indigo-650 dark:text-indigo-400 font-mono">{rollingDays} Days</span>
                    </div>
                    <input
                      type="range"
                      min="2"
                      max="30"
                      value={rollingDays}
                      onChange={(e) => setRollingDays(parseInt(e.target.value))}
                      className="w-full accent-indigo-600 cursor-pointer"
                    />
                    <p className="text-[9px] text-slate-400">Uses the last {rollingDays - 1} logged days to calibrate today's target and sets the timeframe for the average indicator.</p>
                  </div>

                  {/* Authorization Limit % */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs font-bold text-theme-text">
                      <span>{t.maximumAdjustmentLimit}</span>
                      <span className="text-indigo-650 dark:text-indigo-400 font-mono">{rollingAllowance}%</span>
                    </div>
                    <input
                      type="range"
                      min="5"
                      max="100"
                      step="5"
                      value={rollingAllowance}
                      onChange={(e) => setRollingAllowance(parseInt(e.target.value))}
                      className="w-full accent-indigo-600 cursor-pointer"
                    />
                    <p className="text-[9px] text-slate-400">Cap the target fluctuation to a maximum of ±{rollingAllowance}% of the base budget.</p>
                  </div>
                </>
              )}

              {/* Targets Section */}
              <div className="space-y-3 border-t border-theme-border/50 pt-3">
                <button
                  onClick={() => setIsTargetsExpanded(!isTargetsExpanded)}
                  className="flex items-center justify-between w-full text-xs font-bold text-theme-text cursor-pointer"
                >
                  <span>{t.editNutrientTargets}</span>
                  <ChevronDown className={`w-4 h-4 transition-transform ${isTargetsExpanded ? 'rotate-180' : ''}`} />
                </button>
                                {isTargetsExpanded && (
                  <div className="grid grid-cols-2 gap-3 pt-2 max-h-[300px] overflow-y-auto pr-1">
                    {[{"key":"calories","label":"Calories","unit":"kcal","default":1800},{"key":"protein","label":"Protein","unit":"g","default":70},{"key":"carbohydrates","label":"Carbs","unit":"g","default":200},{"key":"totalFat","label":"Total Fat","unit":"g","default":60},{"key":"saturatedFat","label":"Sat. Fat","unit":"g","default":20},{"key":"unsaturatedFat","label":"Unsat. Fat","unit":"g","default":40},{"key":"omega3","label":"Omega 3","unit":"g","default":1.1},{"key":"addedSugar","label":"Added Sugar","unit":"g","default":25},{"key":"totalFibre","label":"Fibre","unit":"g","default":25},{"key":"solubleFibre","label":"Soluble Fibre","unit":"g","default":5},{"key":"sodium","label":"Sodium","unit":"mg","default":1500},{"key":"potassium","label":"Potassium","unit":"mg","default":3500},{"key":"magnesium","label":"Magnesium","unit":"mg","default":310},{"key":"calcium","label":"Calcium","unit":"mg","default":1000},{"key":"iron","label":"Iron","unit":"mg","default":18},{"key":"zinc","label":"Zinc","unit":"mg","default":8},{"key":"selenium","label":"Selenium","unit":"mcg","default":55},{"key":"iodine","label":"Iodine","unit":"mcg","default":150},{"key":"phosphorus","label":"Phosphorus","unit":"mg","default":700},{"key":"vitaminD","label":"Vitamin D","unit":"IU","default":600},{"key":"vitaminB12","label":"Vitamin B12","unit":"mcg","default":2.4},{"key":"folate","label":"Folate","unit":"mcg","default":400},{"key":"vitaminC","label":"Vitamin C","unit":"mg","default":75},{"key":"vitaminE","label":"Vitamin E","unit":"mg","default":15},{"key":"vitaminK","label":"Vitamin K","unit":"mcg","default":90},{"key":"vitaminA","label":"Vitamin A","unit":"mcg","default":700},{"key":"vitaminB6","label":"Vitamin B6","unit":"mg","default":1.3},{"key":"thiamine","label":"Thiamine","unit":"mg","default":1.1},{"key":"riboflavin","label":"Riboflavin","unit":"mg","default":1.1},{"key":"niacin","label":"Niacin","unit":"mg","default":14},{"key":"steps","label":"Steps","unit":"steps","default":3000}].map(t => (
                      <div className="space-y-1" key={t.key}>
                        <label className="text-[10px] font-bold text-slate-500">{t.label} ({t.unit})</label>
                        <input 
                          type="number"
                          value={parseTarget((report?.dailyNutrientTargets as any)?.[t.key] || defaultNutrientTargets[t.key], t.default)}
                          onChange={(e) => {
                             if (onUpdateReport) {
                               const currentTargets = report?.dailyNutrientTargets || defaultNutrientTargets;
                               const updatedReport = report ? {
                                 ...report,
                                 dailyNutrientTargets: {
                                   ...currentTargets,
                                   [t.key]: `${e.target.value} ${t.unit}`
                                 }
                               } : {
                                 id: "custom-report",
                                 created_at: new Date().toISOString(),
                                 healthBaselineCategories: [],
                                 overallSummary: "Custom daily nutrient targets",
                                 recommendations: [],
                                 mostImportantNextStep: "Maintain a healthy routine",
                                 dailyNutrientTargets: {
                                   ...currentTargets,
                                   [t.key]: `${e.target.value} ${t.unit}`
                                 }
                               };
                               onUpdateReport(updatedReport);
                             }
                          }}
                          className="w-full bg-theme-bg/45 border border-slate-150 dark:border-slate-800 rounded-lg px-2 py-1 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
              
              {/* View Timeframe Selection */}
              <div className="space-y-1.5 border-t border-theme-border/50 pt-3">
                <div className="flex justify-between text-xs font-bold text-theme-text">
                  <span>{t.displayViewTimeframe}</span>
                  <span className="text-indigo-650 dark:text-indigo-400 font-mono">
                    {viewTimeframe === '1' ? t.viewTimeframeToday : interpolate(t.lastNDaysShort, { days: viewTimeframe })}
                  </span>
                </div>
                <select
                  value={viewTimeframe}
                  onChange={(e) => setViewTimeframe(e.target.value)}
                  className="w-full bg-theme-bg/45 border border-slate-150 dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none cursor-pointer"
                >
                  <option value="1">{t.last1DayToday}</option>
                  <option value="7">{t.lastNDays.replace('{days}', '7')}</option>
                  <option value="14">{t.lastNDays.replace('{days}', '14')}</option>
                  <option value="30">{t.lastNDays.replace('{days}', '30')}</option>
                </select>
                <p className="text-[9px] text-slate-400">{t.averageDailyIntakeHint}</p>
              </div>
            </div>

            {/* Footer / Actions */}
            <div className="pt-2">
              <button
                onClick={() => setIsSettingsModalOpen(false)}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-2xl text-xs transition-colors cursor-pointer"
              >
                {t.saveSettings}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Food Ideas Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-theme-text flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-500" />
            {t.foodIdeas}
          </h3>
          <button
            onClick={() => setIsFoodIdeaChatOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900 rounded-lg text-xs font-bold transition-colors cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5" /> {t.askAgent}
          </button>
        </div>

        {foodIdeas.length > 0 && (
          <div className="space-y-2">
            {foodIdeas.map(idea => (
              <div key={idea.id} className="border border-theme-border rounded-xl overflow-hidden">
                <button
                  onClick={() => setExpandedKey(expandedKey === idea.id ? null : idea.id)}
                  className="w-full flex items-center justify-between py-3 border-b border-theme-border/50 last:border-0 text-left hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-colors cursor-pointer"
                >
                  <span className="font-bold text-sm text-slate-800 dark:text-slate-200">{idea.name}</span>
                  {expandedKey === idea.id ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                </button>
                {expandedKey === idea.id && (
                  <div className="py-4 space-y-4 animation-fade-in text-xs">
                    <p className="text-theme-text-secondary leading-relaxed font-medium">{idea.benefitExplanation}</p>
                    
                     {idea.locationLink && (
                      <div className="space-y-3">
                        <div className="flex items-center flex-wrap gap-x-3 gap-y-1.5">
                          <a href={idea.locationLink} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400 font-bold hover:underline">
                            <MapPin className="w-3.5 h-3.5" /> {idea.placeName || "Find Nearby"}
                          </a>
                          {idea.distanceKm !== undefined && (
                            <span className="text-[10px] bg-slate-200/60 dark:bg-slate-800 text-theme-text-secondary px-1.5 py-0.5 rounded font-semibold border border-slate-300/30">
                              {idea.distanceKm} km away
                            </span>
                          )}
                          {idea.estimatedBudget && (
                            <span className="text-[10px] bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 rounded font-bold border border-emerald-100/50 dark:border-emerald-900/30">
                              Est: {idea.estimatedBudget}
                            </span>
                          )}
                          {idea.openingHours && (
                            <span className="text-[10px] flex items-center gap-1 bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded font-bold border border-amber-200/50 dark:border-amber-900/40">
                              <Clock className="w-3 h-3" /> {idea.openingHours}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-1">
                      {idea.tags.map((tag, idx) => (
                        <span key={idx} className="bg-white dark:bg-slate-800 text-theme-text-secondary px-2 py-0.5 rounded text-[10px] font-bold border border-theme-border">
                          {tag}
                        </span>
                      ))}
                    </div>
                    <button
                      onClick={() => {
                        const newIdeas = foodIdeas.filter(i => i.id !== idea.id);
                        setFoodIdeas(newIdeas);
                      }}
                      className="text-rose-600 hover:text-rose-700 font-bold mt-2 block w-full text-center py-2 bg-rose-50 dark:bg-rose-950/20 hover:bg-rose-100 dark:hover:bg-rose-900/40 rounded-lg transition-colors cursor-pointer text-xs"
                    >
                      {t.removeIdea}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>



      {/* Health status to improve (Previously Health & BMI Summary) */}
      <div id="health-summary-section" className="space-y-5">
        <div className="flex justify-between items-center pb-2 border-b border-theme-border/50">
          <h3 className="font-bold text-theme-text text-sm flex items-center gap-2 font-display">
            <Heart className="w-4.5 h-4.5 text-indigo-600" />
            {t.healthStatusToImprove}
          </h3>
          {problematicBiomarkers.length > 0 && (
            <button
              onClick={() => {
                const textToCopy = problematicBiomarkers.map(b => {
                  const rating = getBiomarkerStatusLabel(b.key, b.status, profile.customBiomarkers?.[b.key], b.value, profile);
                  const calibration = getAgentCalibration(b.key);
                  const insight = calibration?.specificRiskContext || calibration?.description || b.def.benefitRisk || '';
                  return `${b.def.name}: ${b.value} ${b.def.unit || ''} (${rating})\n${insight}`.trim();
                }).join('\n\n');
                navigator.clipboard.writeText(textToCopy);
                alert(t.copiedToClipboard);
              }}
              className="text-xs font-bold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 flex items-center gap-1.5 transition-colors bg-slate-100 dark:bg-slate-800/50 px-2.5 py-1.5 rounded-lg"
            >
              <Copy className="w-3.5 h-3.5" />
              {t.copyAll}
            </button>
          )}
        </div>

        {/* Problematic Biomarkers list (rendered in 2 columns as expandable tabs/cards) */}
        <div>
          {problematicBiomarkers.length > 0 ? (
            <div className="space-y-4">
              {(() => {
                const groups: Record<string, typeof problematicBiomarkers> = {};
                problematicBiomarkers.forEach(b => {
                  const meta = getBiomarkerMetadata(b.key, profile.customBiomarkers?.[b.key] || b.def);
                  const cat = (meta.riskCategories && meta.riskCategories.length > 0) ? meta.riskCategories[0] : 'Uncategorized';
                  if (!groups[cat]) groups[cat] = [];
                  groups[cat].push(b);
                });

                return Object.entries(groups).map(([category, items]) => {
                  const chunks: typeof problematicBiomarkers[] = [];
                  for (let i = 0; i < items.length; i += 2) {
                    chunks.push(items.slice(i, i + 2));
                  }
                  
                  const baselineCat = report?.healthBaselineCategories?.find((c: any) => 
                    c.categoryName?.toLowerCase() === category.toLowerCase() || 
                    category.toLowerCase().includes(c.categoryName?.toLowerCase()) || 
                    c.categoryName?.toLowerCase().includes(category.toLowerCase())
                  );

                  return (
                    <div key={category} className="space-y-4 mb-6 last:mb-0">
                      {baselineCat ? (
                        <details className="group border-b border-theme-border pb-2">
                          <summary className="cursor-pointer flex items-center justify-between text-[10px] font-bold text-slate-500 uppercase tracking-wider pl-1 list-none select-none hover:text-slate-800 dark:hover:text-slate-300 transition-colors" style={{ listStyle: 'none' }}>
                            <div className="flex items-center gap-1.5">
                              <Sparkles className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                              <span>{displayCategoryLabel(profile.language, category)}</span>
                            </div>
                            <ChevronDown className="w-3.5 h-3.5 text-slate-400 group-open:-rotate-180 transition-transform shrink-0" />
                          </summary>
                          <div className="mt-3 p-4 bg-theme-bg-card rounded-xl border border-theme-border/50 space-y-3 normal-case font-normal text-xs">
                            <div>
                              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">{t.analysisHeading}</span>
                              <p className="text-sm text-theme-neutral leading-relaxed">{baselineCat.targetTrajectory || baselineCat.analysis}</p>
                            </div>
                            {baselineCat.nutrientTargets && baselineCat.nutrientTargets.length > 0 && (
                              <div>
                                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">{t.nutrientTargets}</span>
                                <ul className="list-disc list-inside text-sm text-theme-neutral space-y-1">
                                  {baselineCat.nutrientTargets.map((nt: any, idx: number) => (
                                    <li key={idx}><strong>{nt.nutrientKey}</strong>: {nt.targetValue} <span className="text-xs text-slate-500 block ml-4">{nt.rationale}</span></li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {baselineCat.dailyActivities && baselineCat.dailyActivities.length > 0 && (
                              <div>
                                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">{t.dailyActivities}</span>
                                <ul className="list-disc list-inside text-sm text-theme-neutral space-y-1">
                                  {baselineCat.dailyActivities.map((da: any, idx: number) => (
                                    <li key={idx}><strong>{da.activity}</strong>{da.target ? `: ${da.target}` : ''}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        </details>
                      ) : (
                        <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider pl-1 border-b border-theme-border pb-2">{displayCategoryLabel(profile.language, category)}</h4>
                      )}

                      <div className="space-y-4">
                        {chunks.map((chunk, chunkIdx) => {
                          const expandedInChunk = chunk.find(b => expandedKey === b.key);
                          return (
                            <div key={chunkIdx} className="space-y-3">
                              <div className="grid grid-cols-2 gap-3">
                                {chunk.map((b) => {
                                  const statusLabel = getBiomarkerStatusLabel(b.key, b.status, profile.customBiomarkers?.[b.key], b.value, profile);
                                  const colorClass = getBiomarkerColor(statusLabel || b.status);
                                  const isExpanded = expandedKey === b.key;
                                  return (
                                    <button
                                      key={b.key}
                                      id={`biomarker-card-${b.key}`}
                                      onClick={() => setExpandedKey(isExpanded ? null : b.key)}
                                      className={`p-3 text-left rounded-2xl border transition-all duration-200 cursor-pointer flex flex-col justify-between h-24 ${
                                        isExpanded
                                          ? 'bg-indigo-50/50 dark:bg-indigo-950/20 border-indigo-500 shadow-sm ring-1 ring-indigo-500'
                                          : 'bg-theme-bg border-theme-border/20 hover:bg-slate-100/50 dark:hover:bg-slate-800/30'
                                      }`}
                                    >
                                      <div className="min-w-0 w-full">
                                        <div className="flex items-center gap-1.5 min-w-0 w-full">
                                          <span className="font-size-body-small font-bold text-slate-800 dark:text-slate-200 truncate block">
                                            {b.def.name}
                                          </span>
                                          {b.key === 'bmi' && hasBmiAlert && (
                                            <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 animate-pulse" />
                                          )}
                                        </div>
                                      </div>

                                      <div className="flex items-baseline justify-between mt-auto w-full">
                                        <span className={`font-size-key-metric font-black font-sans leading-none tracking-tight ${colorClass}`}>
                                          {hideSensitive ? '***' : b.value}
                                        </span>
                                        <span className={`font-size-subtitle-small font-bold uppercase tracking-tight ${colorClass}`}>
                                          {displayStatusLabel(profile.language, statusLabel)}
                                        </span>
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>

                              {expandedInChunk && (() => {
                                const expStatusLabel = getBiomarkerStatusLabel(expandedInChunk.key, expandedInChunk.status, profile.customBiomarkers?.[expandedInChunk.key], expandedInChunk.value, profile);
                                const expColorClass = getBiomarkerColor(expStatusLabel || expandedInChunk.status);
                                return (
                                  <div id={`biomarker-expanded-${expandedInChunk.key}`} className="overflow-hidden animation-fade-in mt-1">
                                    <div className="py-4 border-b border-theme-border/30 flex items-center justify-between">
                                      <div>
                                        <div className="flex items-center gap-1.5">
                                          <span className="font-size-body-small font-bold text-slate-800 dark:text-slate-200">
                                            {expandedInChunk.def.name}
                                          </span>
                                          <span className="font-size-xs font-mono text-slate-400">({expandedInChunk.def.unit})</span>
                                        </div>
                                        <p className="font-size-body-small text-theme-text-secondary mt-0.5 font-medium">
                                          {t.normalRangeLabel} {expandedInChunk.def.normalRange}
                                        </p>
                                        {(() => {
                                          const customOpt = profile.customBiomarkers?.[expandedInChunk.key]?.optimalValue;
                                          const agentCal = getAgentCalibration(expandedInChunk.key);
                                          const optVal = customOpt || (agentCal ? formatOptimalTargetValue(agentCal) : null);
                                          if (optVal && optVal.trim() && optVal.trim() !== expandedInChunk.def.normalRange) {
                                            return (
                                              <p className="font-size-body-small text-emerald-600 dark:text-emerald-400 mt-0.5 font-bold flex items-center gap-1">
                                                <span>{t.optimalTargetLabel}</span>
                                                <span>{optVal}</span>
                                              </p>
                                            );
                                          }
                                          return null;
                                        })()}
                                      </div>
                                      <div className="flex flex-col items-end">
                                        <span className={`font-size-subtitle font-black font-sans ${expColorClass}`}>
                                          {hideSensitive ? '***' : expandedInChunk.value}
                                        </span>
                                        <span className={`font-size-xs font-black px-1.5 py-0.5 rounded-full uppercase tracking-wider ${expColorClass} bg-current/10`}>
                                          {expStatusLabel}
                                        </span>
                                      </div>
                                    </div>

                                    <BiomarkerExpandedSection
                                      def={expandedInChunk.def}
                                      profile={profile}
                                      biomarkerHistory={activeHistory}
                                      biomarkers={resolvedBiomarkers}
                                      onEditBiomarkerLog={onEditBiomarkerLog}
                                      onDeleteBiomarkerLog={onDeleteBiomarkerLog}
                                      onDeleteBiomarkerFromLog={onDeleteBiomarkerFromLog}
                                      onOpenAiReview={(key) => {
                                        if (onOpenAgentChat) {
                                          const def = expandedInChunk?.def || getBiomarkerDef(key);
                                          onOpenAgentChat('biomarker_review', { 
                                            biomarkerKey: key, 
                                            prefillMessage: buildBiomarkerReviewPrefill(key, def, resolvedBiomarkers, profile) 
                                          });
                                        }
                                      }}
                                      onApplyCalculation={onApplyCalculation}
                                      hasPendingAlert={expandedInChunk.key === 'bmi' ? hasBmiAlert : false}
                                      onDismissAlert={expandedInChunk.key === 'bmi' ? onDismissBmiAlert : undefined}
                                      hideSensitive={hideSensitive}
                                    />
                                  </div>
                                );
                              })()}
                            </div>
                  );
                })}
              </div>
            </div>
          );
        });
      })()}
            </div>
          ) : (
            <div className="p-4 rounded-2xl border border-dashed border-theme-border text-center">
              <p className="text-xs text-slate-400 font-medium">{t.allBiomarkersNormal}</p>
            </div>
          )}
        </div>
      </div>

      {/* Target Compliance score meters */}
      {distinctDaysOfData >= 7 && (
        <div id="compliance-card" className="grid grid-cols-2 gap-4">
          <div className="border-r border-theme-border/50 pr-2 flex flex-col justify-between">
            <span className="text-[10px] font-bold tracking-wider uppercase text-slate-400">{t.compliance7Day}</span>
            <div className="flex items-baseline gap-1 mt-1">
              <span id="score-7d-text" className="text-3xl font-black font-sans text-indigo-600">{complianceScore7Day}%</span>
              <span className="text-xs text-slate-400 font-medium">{t.onTarget}</span>
            </div>
            <p className="text-[10px] text-theme-text-secondary mt-2 leading-tight">
              {complianceScore7Day >= 80 ? 'Excellent cardiovascular protection benefits.' : 'Steady effort will lower vascular risk markers.'}
            </p>
          </div>
          <div className="pl-1 flex flex-col justify-between">
            <span className="text-[10px] font-bold tracking-wider uppercase text-slate-400">{t.compliance30Day}</span>
            <div className="flex items-baseline gap-1 mt-1">
              <span id="score-30d-text" className="text-3xl font-black font-sans text-indigo-700">{complianceScore30Day}%</span>
              <span className="text-xs text-slate-400 font-medium">{t.overall}</span>
            </div>
            <p className="text-[10px] text-theme-text-secondary mt-2 leading-tight">
              Consistency reduces future atherosclerosis risks significantly.
            </p>
          </div>
        </div>
      )}

      {/* Clinical Action Steps checklist */}
      <div id="actions-checklist-section" className="space-y-4">
        <div>
          <h3 className="font-bold text-theme-text text-sm flex items-center justify-between">
            <span>{t.clinicalActionRecommendations}</span>
            {actions.length > 0 && (
              <span className="text-[10px] font-semibold text-theme-text-secondary bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
                {actions.filter(a => a.completed).length}/{actions.length} {t.completed}
              </span>
            )}
          </h3>
          <p className="text-xs text-theme-text-secondary mt-1 font-medium">
            {t.clinicalActionDesc}
          </p>
        </div>

        <div className="space-y-3">
          {actions.length === 0 ? (
            <div className="p-4 rounded-2xl border border-dashed border-theme-border text-center text-xs text-slate-400">
              {t.noActiveClinicalRecommendations}
            </div>
          ) : (
            visibleActions.map((act) => {
              const parsed = parseActionDetails(act);
              const dynamicTag = getDynamicTimeTag(parsed.minMonths, parsed.maxMonths, parsed.addedTimestamp);
              const isExpanded = expandedActionIds.has(act.id);

              return (
                <div 
                  key={act.id} 
                  id={`action-item-${act.id}`}
                  className={`p-3.5 rounded-2xl border transition-all ${
                    act.completed 
                      ? 'bg-slate-50/50 dark:bg-slate-800/10 border-theme-border/40 opacity-75' 
                      : dynamicTag.status === 'overdue'
                        ? 'bg-rose-50/20 border-rose-200/60 dark:bg-rose-950/20 dark:border-rose-900/40'
                        : dynamicTag.status === 'due_soon'
                          ? 'bg-amber-50/20 border-amber-200/60 dark:bg-amber-950/20 dark:border-amber-900/40'
                          : 'bg-theme-bg-card/60 border-slate-200/70 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  {/* Collapsed Header View */}
                  <div className="flex items-start gap-3">
                    <button 
                      type="button"
                      onClick={(e) => { e.stopPropagation(); toggleAction(act.id); }}
                      className="flex-shrink-0 mt-0.5 text-slate-400 dark:text-slate-500 hover:scale-110 transition-transform cursor-pointer"
                      title={act.completed ? t.markAsIncomplete : t.markAsCompleted}
                    >
                      {act.completed ? (
                        <CheckCircle2 className="w-5 h-5 text-indigo-600 fill-indigo-600/10" />
                      ) : (
                        <Circle className="w-5 h-5 hover:text-indigo-600" />
                      )}
                    </button>

                    <div 
                      onClick={() => toggleExpandAction(act.id)}
                      className="flex-1 min-w-0 cursor-pointer space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className={`text-xs font-bold leading-snug block ${act.completed ? 'line-through text-slate-400 dark:text-slate-500' : 'text-theme-text'}`}>
                          {parsed.title}
                        </span>
                        <button 
                          type="button"
                          className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5 rounded transition-colors flex-shrink-0"
                          aria-label={isExpanded ? t.collapseDetails : t.expandDetails}
                        >
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                      </div>

                      {/* Tag list: Test tag first, then Time tag */}
                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 border border-teal-200/80 dark:border-teal-800/60">
                          <FlaskConical className="w-3 h-3 text-teal-600 dark:text-teal-400" />
                          <span>{displayClinicalType(profile.language, parsed.testName)}</span>
                        </span>

                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border ${
                          dynamicTag.status === 'overdue'
                            ? 'bg-rose-100 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-800'
                            : dynamicTag.status === 'due_soon'
                              ? 'bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-200 border-amber-300 dark:border-amber-800'
                              : 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-800/60'
                        }`}>
                          <Clock className="w-3 h-3" />
                          <span>{displayTimeTag(profile.language, dynamicTag.label)}</span>
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Expanded Detail View */}
                  {isExpanded && (
                    <div className="mt-3 pt-3 border-t border-theme-border/80 space-y-2.5 text-xs animate-fadeIn">
                      <p className="text-xs text-theme-text-secondary leading-relaxed font-medium">
                        {act.explanation}
                      </p>

                      {parsed.currentValueStr && (
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Baseline Reading:</span>
                          <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded text-[11px] font-mono font-bold text-slate-800 dark:text-slate-200">
                            {parsed.currentValueStr}
                          </span>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                          act.priority === 'high' 
                            ? 'bg-rose-100 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300' 
                            : act.priority === 'medium'
                              ? 'bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-200'
                              : 'bg-slate-100 dark:bg-slate-800 text-theme-text-secondary'
                        }`}>
                          {(act.priority || 'medium').toUpperCase()} PRIORITY
                        </span>

                        <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded text-[10px] font-bold uppercase tracking-wider text-theme-text-secondary">
                          {act.type === 'doctor' ? 'Medical Consultation' : act.type === 'test' ? 'Diagnostic Test' : 'Lifestyle Modification'}
                        </span>

                        <span className="text-[10px] text-slate-400 font-medium">
                          Added {new Date(parsed.addedTimestamp).toLocaleDateString()}
                        </span>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (onOpenAgentChat) {
                              onOpenAgentChat('agent1', { prefillMessage: `Add test results for ${parsed.testName || parsed.title}` });
                            } else if (onNavigateToTab) {
                              onNavigateToTab('medical');
                            }
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white transition-all shadow-xs cursor-pointer ml-auto"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>{t.addYourResults}</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* View More / Show Less Button */}
        {sortedActions.length > 7 && (
          <button
            type="button"
            onClick={() => setShowAllActions(!showAllActions)}
            className="w-full py-2.5 px-4 rounded-xl border border-theme-border text-theme-text-secondary font-semibold text-xs hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <span>{showAllActions ? 'Show Less' : `View More (${sortedActions.length - 7} remaining)`}</span>
            {showAllActions ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        )}
      </div>

      {/* Daily Benefit tasks checkoff */}
      <div id="benefits-checklist-section" className="space-y-4">
        <div>
          <h3 className="font-bold text-theme-text text-sm">
            {t.dailyBenefits}
          </h3>
          <p className="text-xs text-theme-text-secondary mt-1 font-medium">
            {t.dailyBenefitsDesc}
          </p>
        </div>

         <div className="space-y-2.5">
          {dailyBenefits.map((ben) => (
            <div
              key={ben.id}
              id={`benefit-item-${ben.id}`}
              onClick={() => toggleBenefit(ben.id)}
              className="flex items-center justify-between py-3 border-b border-theme-border/50 last:border-0 cursor-pointer transition-all group"
            >
              <div className="flex items-center gap-3">
                <button className="text-slate-400 dark:text-slate-500 cursor-pointer">
                  {ben.completed ? (
                    <CheckCircle2 className="w-5 h-5 text-indigo-600 fill-indigo-600/10" />
                  ) : (
                    <Circle className="w-5 h-5 hover:text-indigo-600" />
                  )}
                </button>
                <span className={`text-xs font-semibold ${ben.completed ? 'line-through text-slate-400 dark:text-slate-500' : 'text-slate-700 dark:text-slate-200'}`}>
                  {ben.activity || (ben as any).label}
                </span>
              </div>
              
              <button
                onClick={(e) => deleteBenefit(ben.id, e)}
                className="text-slate-400 hover:text-rose-500 p-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/30 opacity-60 md:opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all cursor-pointer flex-shrink-0"
                title={t.deleteBenefitItem}
                aria-label={t.deleteBenefitItem}
              >
                <Trash2 className="w-3.8 h-3.8" />
              </button>
            </div>
          ))}
        </div>
      </div>



      {/* Google Health UI moved to Profile settings */}

      
      

      {/* Food Idea Agent Modal */}
      <React.Suspense fallback={null}>
        {isFoodIdeaChatOpen && (
          <LogChat 
            type="food_idea"
            isOpen={isFoodIdeaChatOpen}
            onClose={() => setIsFoodIdeaChatOpen(false)}
            profile={profile}
            foodLogs={activeFoodLogs}
            biomarkers={biomarkers}
            biomarkerHistory={activeHistory}
            selectedModelId={selectedModelId}
            onChangeModelId={onChangeModelId}
            onLogFoodIdeas={(ideas) => {
              setFoodIdeas([...foodIdeas, ...ideas]);
              setIsFoodIdeaChatOpen(false);
            }}
          />
        )}

        {isDailyRecommendationChatOpen && (
          <LogChat 
            type="daily_recommendation"
            isOpen={isDailyRecommendationChatOpen}
            onClose={() => setIsDailyRecommendationChatOpen(false)}
            profile={profile}
            foodLogs={activeFoodLogs}
            biomarkers={biomarkers}
            biomarkerHistory={activeHistory}
            report={report}
            actions={actions}
            googleSteps={googleSteps}
            selectedModelId={selectedModelId}
            onChangeModelId={onChangeModelId}
            autoSendMessage={t.whatsUpTodayAction}
          />
        )}
      </React.Suspense>

      {/* Flagged Biomarkers & Telemetry Error Management Modal */}
      {showTelemetryModal && (() => {
        const autoFixableCount = flaggedTelemetryErrors.filter(e => e.proposedAutoFix?.canAutoFix).length;
        const aiReviewCount = flaggedTelemetryErrors.filter(e => !e.proposedAutoFix?.canAutoFix).length;

        const filteredErrors = flaggedTelemetryErrors.filter(e => {
          if (telemetryFilterTab === 'auto_fix') return e.proposedAutoFix?.canAutoFix;
          if (telemetryFilterTab === 'ai_review') return !e.proposedAutoFix?.canAutoFix;
          return true;
        });

        const selectedAutoFixableCount = flaggedTelemetryErrors.filter(e => selectedErrorKeys.has(e.key) && e.proposedAutoFix?.canAutoFix).length;

        let totalSelectedOutlierReadingsCount = 0;
        const selectedKeysList = Array.from(selectedErrorKeys);
        (activeHistory || []).forEach(log => {
          if (!log.biomarkers) return;
          selectedKeysList.forEach(k => {
            const matchingKey = Object.keys(log.biomarkers).find(bk => {
              const canBk = getMappedBiomarkerKey(bk) || bk;
              return canBk === k || canBk.toLowerCase().replace(/[\s_]/g, '') === k.toLowerCase().replace(/[\s_]/g, '') || bk.toLowerCase().replace(/[\s_]/g, '') === k.toLowerCase().replace(/[\s_]/g, '');
            });
            if (matchingKey && log.biomarkers[matchingKey] !== undefined) {
              const val = log.biomarkers[matchingKey];
              const num = typeof val === 'number' ? val : parseFloat(String(val));
              const custom = profile.customBiomarkers?.[k];
              const def = allDefinitions.find(d => d.key === k) || biomarkerDefinitions.find(d => d.key === k);
              const range = (custom?.normalRange && custom.normalRange !== 'Unknown' && custom.normalRange !== 'unset' && custom.normalRange !== 'n/a' && custom.normalRange !== '-') ? custom.normalRange : def?.normalRange;
              if (!isNaN(num) && isBiomarkerValueImprobable(k, num, range)) {
                totalSelectedOutlierReadingsCount++;
              }
            }
          });
        });

        const handleAutoFixBiomarker = (err: any) => {
          if (!err.proposedAutoFix?.canAutoFix) return;
          const mult = err.proposedAutoFix.proposedMultiplier;
          const custom = profile.customBiomarkers?.[err.key];
          const def = allDefinitions.find(d => d.key === err.key) || biomarkerDefinitions.find(d => d.key === err.key);
          const range = (custom?.normalRange && custom.normalRange !== 'Unknown' && custom.normalRange !== 'unset' && custom.normalRange !== 'n/a' && custom.normalRange !== '-') ? custom.normalRange : (def?.normalRange || custom?.normalRange);

          const updatesToApply: { id: string; key: string; value: number }[] = [];
          (activeHistory || []).forEach(log => {
            if (!log.biomarkers || !log.id) return;
            const rawKey = Object.keys(log.biomarkers).find(k => {
              const canBk = getMappedBiomarkerKey(k) || k;
              return canBk === err.key || canBk.toLowerCase().replace(/[\s_]/g, '') === err.key.toLowerCase().replace(/[\s_]/g, '') || k.toLowerCase().replace(/[\s_]/g, '') === err.key.toLowerCase().replace(/[\s_]/g, '');
            }) || err.key;
            const rawVal = log.biomarkers[rawKey];
            if (rawVal === undefined || rawVal === null) return;
            const num = typeof rawVal === 'number' ? rawVal : parseFloat(String(rawVal));
            if (!isNaN(num) && isBiomarkerValueImprobable(err.key, num, range)) {
              let converted = num * mult;
              if (converted >= 100) converted = Math.round(converted);
              else if (converted >= 10) converted = parseFloat(converted.toFixed(1));
              else converted = parseFloat(converted.toFixed(3));
              updatesToApply.push({ id: log.id, key: rawKey, value: converted });
            }
          });

          if (updatesToApply.length === 0) return;
          if (onBatchEditBiomarkersInLogs) {
            onBatchEditBiomarkersInLogs(updatesToApply);
          } else {
            updatesToApply.forEach(u => onEditBiomarkerLog(u.id, u.key, u.value));
          }

          setAppliedToastMessage(`⚡ Applied auto-fix to ${updatesToApply.length} reading(s) for ${err.name}`);
          setTimeout(() => setAppliedToastMessage(null), 3500);
        };

        const handleAutoFixAllSelected = () => {
          const keys = Array.from(selectedErrorKeys);
          const targetErrors = flaggedTelemetryErrors.filter(e => keys.includes(e.key) && e.proposedAutoFix?.canAutoFix);
          if (targetErrors.length === 0) return;

          const updatesToApply: { id: string; key: string; value: number }[] = [];
          targetErrors.forEach(err => {
            const mult = err.proposedAutoFix!.proposedMultiplier;
            const custom = profile.customBiomarkers?.[err.key];
            const def = allDefinitions.find(d => d.key === err.key) || biomarkerDefinitions.find(d => d.key === err.key);
            const range = (custom?.normalRange && custom.normalRange !== 'Unknown' && custom.normalRange !== 'unset' && custom.normalRange !== 'n/a' && custom.normalRange !== '-') ? custom.normalRange : (def?.normalRange || custom?.normalRange);

            (activeHistory || []).forEach(log => {
              if (!log.biomarkers || !log.id) return;
              const rawKey = Object.keys(log.biomarkers).find(k => {
                const canBk = getMappedBiomarkerKey(k) || k;
                return canBk === err.key || canBk.toLowerCase().replace(/[\s_]/g, '') === err.key.toLowerCase().replace(/[\s_]/g, '') || k.toLowerCase().replace(/[\s_]/g, '') === err.key.toLowerCase().replace(/[\s_]/g, '');
              }) || err.key;
              const rawVal = log.biomarkers[rawKey];
              if (rawVal === undefined || rawVal === null) return;
              const num = typeof rawVal === 'number' ? rawVal : parseFloat(String(rawVal));
              if (!isNaN(num) && isBiomarkerValueImprobable(err.key, num, range)) {
                let converted = num * mult;
                if (converted >= 100) converted = Math.round(converted);
                else if (converted >= 10) converted = parseFloat(converted.toFixed(1));
                else converted = parseFloat(converted.toFixed(3));
                updatesToApply.push({ id: log.id, key: rawKey, value: converted });
              }
            });
          });

          if (updatesToApply.length === 0) return;
          if (onBatchEditBiomarkersInLogs) {
            onBatchEditBiomarkersInLogs(updatesToApply);
          } else {
            updatesToApply.forEach(u => onEditBiomarkerLog(u.id, u.key, u.value));
          }

          setAppliedToastMessage(`⚡ Batch converted ${updatesToApply.length} reading(s) across ${targetErrors.length} biomarker(s)!`);
          setTimeout(() => setAppliedToastMessage(null), 3500);
        };

        return (
          <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex flex-col p-0 overflow-hidden animate-in fade-in duration-200">
            <div className="bg-theme-bg-card rounded-none w-full h-full flex flex-col shadow-2xl overflow-hidden">
              
              {/* Header */}
              <div className="p-4 sm:p-6 border-b border-theme-border flex items-center justify-between gap-4 bg-slate-50/80 dark:bg-slate-900/60 shrink-0">
                <h2 className="font-bold text-slate-900 dark:text-white text-lg sm:text-xl font-display">
                  Flagged Telemetry & Outlier Errors
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    setShowTelemetryModal(false);
                    setEditingLogState(null);
                    if (pendingAgentTrigger && onOpenAgentChat) {
                      onOpenAgentChat(pendingAgentTrigger.agentType, pendingAgentTrigger.options);
                    }
                  }}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-2 rounded-xl hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
                  title="Close"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              {/* Success Notification Banner */}
              {appliedToastMessage && (
                <div className="px-5 py-2.5 bg-emerald-500 text-white text-xs font-bold flex items-center justify-between shadow-sm animate-in slide-in-from-top duration-200 shrink-0">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-100" />
                    <span>{appliedToastMessage}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAppliedToastMessage(null)}
                    className="text-white/80 hover:text-white cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* Filter Tabs & Selection Toolbar */}
              <div className="px-4 sm:px-6 py-2.5 bg-slate-100/70 dark:bg-slate-900/80 border-b border-theme-border flex items-center justify-between gap-3 text-xs shrink-0">
                {/* Left: Filter Tabs */}
                <FilterPills<'all' | 'auto_fix' | 'ai_review'>
                  items={[
                    { id: 'all', label: t.categoryAll, activeColorClass: 'bg-amber-500 text-white shadow-xs' },
                    { id: 'auto_fix', label: t.autoFixable, activeColorClass: 'bg-emerald-600 text-white shadow-xs' },
                    { id: 'ai_review', label: t.needsAiReview, activeColorClass: 'bg-indigo-600 text-white shadow-xs' },
                  ]}
                  activeId={telemetryFilterTab}
                  onChange={setTelemetryFilterTab}
                  ariaLabel={t.filterOptions}
                />

                {/* Right: Master Checkbox & Selection Stats */}
                <div className="flex items-center shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      const visibleKeys = filteredErrors.map(e => e.key);
                      const allVisibleSelected = visibleKeys.every(k => selectedErrorKeys.has(k));
                      if (allVisibleSelected) {
                        setSelectedErrorKeys(prev => {
                          const next = new Set(prev);
                          visibleKeys.forEach(k => next.delete(k));
                          return next;
                        });
                      } else {
                        setSelectedErrorKeys(prev => {
                          const next = new Set(prev);
                          visibleKeys.forEach(k => next.add(k));
                          return next;
                        });
                      }
                    }}
                    className="flex items-center gap-1.5 font-bold text-slate-700 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer text-xs"
                  >
                    {filteredErrors.length > 0 && filteredErrors.every(e => selectedErrorKeys.has(e.key)) ? (
                      <CheckSquare className="w-4 h-4 text-emerald-600" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-400" />
                    )}
                    <span>
                      {filteredErrors.length > 0 && filteredErrors.every(e => selectedErrorKeys.has(e.key))
                        ? "Deselect All"
                        : "Select All"}
                    </span>
                  </button>
                </div>
              </div>

              {/* Scrollable List of Flagged Cards */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
                {filteredErrors.length === 0 ? (
                  <div className="py-16 text-center text-slate-400 space-y-3">
                    <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
                    <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
                      No biomarker issues matching the selected filter!
                    </p>
                  </div>
                ) : (
                  filteredErrors.map(err => {
                    const isSelected = selectedErrorKeys.has(err.key);
                    const custom = profile.customBiomarkers?.[err.key];
                    const def = allDefinitions.find(d => d.key === err.key) || biomarkerDefinitions.find(d => d.key === err.key);
                    const range = (custom?.normalRange && custom.normalRange !== 'Unknown' && custom.normalRange !== 'unset' && custom.normalRange !== 'n/a' && custom.normalRange !== '-') ? custom.normalRange : (def?.normalRange || custom?.normalRange);
                    const unit = err.unit || custom?.unit || def?.unit || '';

                    // Find all matching historical logs for this biomarker
                    const itemLogs = (activeHistory || []).filter(h => {
                      if (!h.biomarkers) return false;
                      return Object.keys(h.biomarkers).some(k => k.toLowerCase() === err.key.toLowerCase() || k.toLowerCase().replace(/[\s_]/g, '') === err.key.toLowerCase().replace(/[\s_]/g, ''));
                    }).sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));

                    return (
                      <div
                        key={err.key}
                        className={`p-5 rounded-2xl border transition-all shadow-xs ${
                          isSelected
                            ? "bg-amber-50/50 dark:bg-amber-950/25 border-amber-300 dark:border-amber-700/80 shadow-md"
                            : "bg-white dark:bg-slate-800/70 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
                        }`}
                      >
                        {/* Top Header of Card */}
                        <div className="flex items-start justify-between gap-4 flex-wrap sm:flex-nowrap">
                          <div className="flex items-start gap-3">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedErrorKeys(prev => {
                                  const next = new Set(prev);
                                  if (next.has(err.key)) next.delete(err.key);
                                  else next.add(err.key);
                                  return next;
                                });
                              }}
                              className="mt-1 text-slate-400 hover:text-indigo-600 cursor-pointer shrink-0"
                            >
                              {isSelected ? (
                                <CheckSquare className="w-5 h-5 text-emerald-600" />
                              ) : (
                                <Square className="w-5 h-5 text-slate-400" />
                              )}
                            </button>
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-bold text-slate-900 dark:text-white text-base font-display">
                                  {err.name}
                                </span>
                                <span className="text-[11px] font-mono bg-slate-100 dark:bg-slate-800 text-slate-500 px-2 py-0.5 rounded-md font-semibold">
                                  {err.key}
                                </span>
                                {unit && (
                                  <span className="text-[11px] font-mono bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60 px-2 py-0.5 rounded-md font-bold">
                                    {unit}
                                  </span>
                                )}
                                {range && (
                                  <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono bg-slate-100/70 dark:bg-slate-800/60 px-2 py-0.5 rounded-md">
                                    Ref Range: <strong>{range}</strong>
                                  </span>
                                )}
                              </div>
                              {err.badgeLabel && (
                                <div className="mt-1.5">
                                  <span className="text-[11px] bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 px-2.5 py-0.5 rounded-full font-bold border border-rose-200 dark:border-rose-800/60 inline-flex items-center gap-1">
                                    <AlertTriangle className="w-3 h-3 text-rose-600 dark:text-rose-400" />
                                    <span>{displayIssueChrome(profile.language, err.badgeLabel)}</span>
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>


                        </div>

                        {/* Precise Diagnostic Cause */}
                        {err.preciseCause && (
                          <div className="mt-2.5 p-3 rounded-xl bg-rose-50/70 dark:bg-rose-950/25 border border-rose-200/80 dark:border-rose-900/40 text-xs text-rose-900 dark:text-rose-200 leading-relaxed ml-8">
                            <strong className="font-semibold block mb-0.5">Diagnostic Finding:</strong>
                            {err.preciseCause}
                          </div>
                        )}

                        {/* Automated Fix Proposal Box */}
                        {err.proposedAutoFix?.canAutoFix ? (
                          <div className="mt-3 ml-8 p-3.5 rounded-xl bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/30 border border-emerald-300 dark:border-emerald-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-2">
                                <Zap className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                <span className="font-bold text-xs text-emerald-900 dark:text-emerald-200">
                                  ⚡ Deterministic Auto-Fix Available
                                </span>
                              </div>
                              <p className="text-xs text-emerald-800 dark:text-emerald-300 pl-6">
                                {err.proposedAutoFix.fixLabel} (Multiplier: <code className="font-mono font-bold bg-emerald-100 dark:bg-emerald-900/60 px-1 py-0.2 rounded">×{err.proposedAutoFix.proposedMultiplier}</code>) • <span className="font-semibold text-emerald-950 dark:text-emerald-100">Proposed New Value: <span className="line-through opacity-70">{err.value}</span> → <strong className="font-bold text-emerald-700 dark:text-emerald-300">{err.proposedAutoFix.proposedValue} {unit}</strong></span>
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleAutoFixBiomarker(err)}
                              className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs active:scale-95 cursor-pointer flex items-center gap-1.5 shrink-0 self-start sm:self-center"
                            >
                              <Zap className="w-3.5 h-3.5 text-emerald-200" />
                              <span>⚡ Apply Auto-Fix to All Logs</span>
                            </button>
                          </div>
                        ) : (
                          <div className="mt-3 ml-8 p-3 rounded-xl bg-slate-100/80 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 text-xs">
                            <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                              <BrainCircuit className="w-4 h-4 text-indigo-500 shrink-0" />
                              <span>{err.proposedAutoFix?.reason || 'Discrepancy is non-standard and requires clinical AI Review'}</span>
                            </div>
                          </div>
                        )}

                        {/* Log Readings Table / List */}
                        <div className="mt-4 ml-8 space-y-2">
                          <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-slate-400">
                            <span>Recorded History Entries ({itemLogs.length}):</span>
                            <span className="hidden sm:inline">Click pencil to edit inline or trash to delete</span>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
                            {itemLogs.map((log: any) => {
                              const rawKey = Object.keys(log.biomarkers || {}).find(k => k.toLowerCase() === err.key.toLowerCase() || k.toLowerCase().replace(/[\s_]/g, '') === err.key.toLowerCase().replace(/[\s_]/g, '')) || err.key;
                              const rawVal = log.biomarkers?.[rawKey];
                              const num = typeof rawVal === 'number' ? rawVal : parseFloat(String(rawVal));
                              const isOutlier = isBiomarkerValueImprobable(err.key, num, range);
                              const isEditing = editingLogState?.logId === log.id && editingLogState?.key === rawKey;
                              const entryKey = `${log.id || log.date}_${rawKey}`;
                              const isSavingThis = savingActionKeys[entryKey];
                              const isSavedThis = savedActionKeys.has(entryKey);
                              const isConfirmingDelete = confirmDeleteEntryKey === entryKey;

                              let previewConverted: number | null = null;
                              if (isOutlier && err.proposedAutoFix?.canAutoFix && !isNaN(num)) {
                                const mult = err.proposedAutoFix.proposedMultiplier;
                                let c = num * mult;
                                if (c >= 100) previewConverted = Math.round(c);
                                else if (c >= 10) previewConverted = parseFloat(c.toFixed(1));
                                else previewConverted = parseFloat(c.toFixed(2));
                              }

                              return (
                                <div
                                  key={entryKey}
                                  className={`p-3 rounded-xl border flex items-center justify-between gap-3 text-xs transition-all ${
                                    isOutlier
                                      ? "bg-rose-50/80 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900/40 text-rose-900 dark:text-rose-200 font-medium shadow-2xs"
                                      : "bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300"
                                  }`}
                                >
                                  <div className="flex items-center gap-2 min-w-0 flex-wrap sm:flex-nowrap">
                                    <span className="text-[10px] font-mono text-slate-500 bg-slate-200/50 dark:bg-slate-800/80 px-1.5 py-0.5 rounded shrink-0">
                                      {log.date}
                                    </span>
                                    {isEditing ? (
                                      <input
                                        type="text"
                                        value={editingLogVal}
                                        onChange={(e) => setEditingLogVal(e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') {
                                            const numVal = parseFloat(editingLogVal);
                                            markKeySaving(entryKey, 'Saving...');
                                            onEditBiomarkerLog(log.id, rawKey, isNaN(numVal) ? editingLogVal : numVal);
                                            setEditingLogState(null);
                                            setTimeout(() => {
                                              markKeySaved(entryKey);
                                            }, 350);
                                          }
                                        }}
                                        className="w-20 px-2 py-0.5 bg-white dark:bg-slate-800 border border-indigo-400 rounded text-xs font-mono font-bold"
                                        autoFocus
                                      />
                                    ) : (
                                      <span className="font-mono font-bold text-xs text-slate-900 dark:text-white whitespace-nowrap shrink-0">
                                        {rawVal} {unit}
                                      </span>
                                    )}
                                    {isOutlier && !isEditing && (
                                      <span className="text-[9px] bg-rose-200 dark:bg-rose-900 text-rose-800 dark:text-rose-100 px-1.5 py-0.5 rounded font-bold uppercase tracking-wide shrink-0">
                                        Outlier
                                      </span>
                                    )}
                                  </div>

                                  <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                                    {isSavingThis ? (
                                      <div className="flex items-center gap-1 text-[11px] text-indigo-600 dark:text-indigo-400 font-semibold shrink-0 animate-pulse">
                                        <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-500" />
                                        <span>{isSavingThis}</span>
                                      </div>
                                    ) : isSavedThis ? (
                                      <div className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-bold shrink-0 animate-in fade-in duration-150">
                                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                                        <span>Saved!</span>
                                      </div>
                                    ) : isConfirmingDelete ? (
                                      <div className="flex items-center gap-1 shrink-0 animate-in fade-in duration-150">
                                        <span className="text-[10px] font-bold text-rose-600 dark:text-rose-400">Delete?</span>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setConfirmDeleteEntryKey(null);
                                            markKeySaving(entryKey, 'Deleting...');
                                            if (onDeleteBiomarkerFromLog) {
                                              onDeleteBiomarkerFromLog(log.id, rawKey);
                                            }
                                            setTimeout(() => {
                                              markKeySaved(entryKey);
                                              setAppliedToastMessage(`🗑️ Deleted ${err.name} reading on ${log.date}`);
                                              setTimeout(() => setAppliedToastMessage(null), 3000);
                                            }, 350);
                                          }}
                                          className="px-2 py-0.5 bg-rose-600 hover:bg-rose-700 text-white rounded text-[10px] font-bold shadow-2xs cursor-pointer transition-all"
                                        >
                                          Yes, Delete
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setConfirmDeleteEntryKey(null)}
                                          className="px-1.5 py-0.5 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 rounded text-[10px] font-medium cursor-pointer transition-all"
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    ) : isEditing ? (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const numVal = parseFloat(editingLogVal);
                                            markKeySaving(entryKey, 'Saving...');
                                            onEditBiomarkerLog(log.id, rawKey, isNaN(numVal) ? editingLogVal : numVal);
                                            setEditingLogState(null);
                                            setTimeout(() => {
                                              markKeySaved(entryKey);
                                            }, 350);
                                          }}
                                          className="p-1 text-emerald-600 hover:bg-emerald-100 dark:hover:bg-emerald-950/60 rounded cursor-pointer"
                                          title="Save value"
                                        >
                                          <Check className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setEditingLogState(null)}
                                          className="p-1 text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 rounded cursor-pointer"
                                          title="Cancel"
                                        >
                                          <X className="w-3.5 h-3.5" />
                                        </button>
                                      </>
                                    ) : (
                                      <>
                                        {isOutlier && err.proposedAutoFix?.canAutoFix && previewConverted !== null && (
                                          <button
                                            type="button"
                                            onClick={() => {
                                              markKeySaving(entryKey, 'Converting...');
                                              onEditBiomarkerLog(log.id, rawKey, previewConverted!);
                                              setTimeout(() => {
                                                markKeySaved(entryKey);
                                                setAppliedToastMessage(`⚡ Converted ${rawVal} → ${previewConverted} ${unit}`);
                                                setTimeout(() => setAppliedToastMessage(null), 3000);
                                              }, 350);
                                            }}
                                            className="px-2 py-0.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-md text-[10px] font-bold cursor-pointer transition-all flex items-center gap-1 shadow-2xs shrink-0"
                                            title={`Auto-fix ${rawVal} to ${previewConverted} ${unit}`}
                                          >
                                            <Zap className="w-2.5 h-2.5" />
                                            <span>Fix (→ {previewConverted})</span>
                                          </button>
                                        )}
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setConfirmDeleteEntryKey(null);
                                            setEditingLogState({ logId: log.id, date: log.date, key: rawKey, val: rawVal });
                                            setEditingLogVal(String(rawVal));
                                          }}
                                          className="p-1 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 rounded hover:bg-slate-200/50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                                          title="Edit reading value"
                                        >
                                          <Edit2 className="w-3.5 h-3.5" />
                                        </button>
                                        {onDeleteBiomarkerFromLog && (
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setEditingLogState(null);
                                              setConfirmDeleteEntryKey(entryKey);
                                            }}
                                            className="p-1 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
                                            title="Delete reading from log"
                                          >
                                            <Trash2 className="w-3.5 h-3.5" />
                                          </button>
                                        )}
                                      </>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Bottom Sticky Action Toolbar */}
              <div className="p-4 sm:p-5 border-t border-theme-border bg-slate-50/90 dark:bg-slate-900/90 backdrop-blur flex flex-col sm:flex-row items-center justify-end gap-3 shrink-0">

                <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto justify-end">
                  {selectedAutoFixableCount > 0 && (
                    <button
                      type="button"
                      disabled={savingActionKeys['batch_autofix'] !== undefined}
                      onClick={() => {
                        markKeySaving('batch_autofix', 'Converting...');
                        handleAutoFixAllSelected();
                        setTimeout(() => {
                          markKeySaved('batch_autofix');
                        }, 400);
                      }}
                      className="px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl text-xs font-bold transition-all shadow-md active:scale-95 cursor-pointer flex items-center gap-1.5 disabled:opacity-75"
                    >
                      {savingActionKeys['batch_autofix'] ? (
                        <>
                          <Loader2 className="w-4 h-4 text-emerald-200 animate-spin" />
                          <span>Converting...</span>
                        </>
                      ) : savedActionKeys.has('batch_autofix') ? (
                        <>
                          <Check className="w-4 h-4 text-white" />
                          <span>Saved!</span>
                        </>
                      ) : (
                        <>
                          <Zap className="w-4 h-4 text-emerald-200" />
                          <span>⚡ Auto-Fix Selected ({selectedAutoFixableCount})</span>
                        </>
                      )}
                    </button>
                  )}

                  {onDeleteBiomarkerFromLog && (
                    confirmBatchDelete ? (
                      <div className="flex items-center gap-2 p-1 bg-rose-100/90 dark:bg-rose-950/90 border border-rose-300 dark:border-rose-800 rounded-xl animate-in fade-in duration-150">
                        <span className="text-xs font-bold text-rose-800 dark:text-rose-200 pl-2">
                          Delete {totalSelectedOutlierReadingsCount} outlier reading(s)?
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmBatchDelete(false);
                            markKeySaving('batch_delete', 'Deleting...');
                            const keys = Array.from(selectedErrorKeys);
                            const deletionsToDelete: { id: string; key: string }[] = [];
                            (activeHistory || []).forEach(log => {
                              if (!log.biomarkers || !log.id) return;
                              keys.forEach(k => {
                                const matchingKey = Object.keys(log.biomarkers).find(bk => {
                                  const canBk = getMappedBiomarkerKey(bk) || bk;
                                  return canBk === k || canBk.toLowerCase().replace(/[\s_]/g, '') === k.toLowerCase().replace(/[\s_]/g, '') || bk.toLowerCase().replace(/[\s_]/g, '') === k.toLowerCase().replace(/[\s_]/g, '');
                                });
                                if (matchingKey && log.biomarkers[matchingKey] !== undefined) {
                                  const val = log.biomarkers[matchingKey];
                                  const num = typeof val === 'number' ? val : parseFloat(String(val));
                                  const custom = profile.customBiomarkers?.[k];
                                  const def = allDefinitions.find(d => d.key === k) || biomarkerDefinitions.find(d => d.key === k);
                                  const range = (custom?.normalRange && custom.normalRange !== 'Unknown' && custom.normalRange !== 'unset' && custom.normalRange !== 'n/a' && custom.normalRange !== '-') ? custom.normalRange : def?.normalRange;
                                  if (isBiomarkerValueImprobable(k, num, range)) {
                                    deletionsToDelete.push({ id: log.id, key: matchingKey });
                                  }
                                }
                              });
                            });

                            if (deletionsToDelete.length > 0) {
                              if (onBatchDeleteBiomarkersFromLogs) {
                                onBatchDeleteBiomarkersFromLogs(deletionsToDelete);
                              } else if (onDeleteBiomarkerFromLog) {
                                deletionsToDelete.forEach(d => onDeleteBiomarkerFromLog(d.id, d.key));
                              }
                            }

                            setTimeout(() => {
                              markKeySaved('batch_delete');
                              setAppliedToastMessage(`🗑️ Deleted ${deletionsToDelete.length} outlier reading(s)`);
                              setTimeout(() => setAppliedToastMessage(null), 3500);
                            }, 400);
                          }}
                          className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold shadow-xs cursor-pointer transition-all"
                        >
                          Yes, Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmBatchDelete(false)}
                          className="px-2 py-1.5 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-semibold cursor-pointer transition-all"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={totalSelectedOutlierReadingsCount === 0 || savingActionKeys['batch_delete'] !== undefined}
                        onClick={() => setConfirmBatchDelete(true)}
                        className="px-3.5 py-2.5 bg-white dark:bg-slate-800 border border-rose-300 dark:border-rose-800/60 text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-xl text-xs font-bold transition-all shadow-xs disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
                      >
                        {savingActionKeys['batch_delete'] ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-500" />
                            <span>Deleting outliers...</span>
                          </>
                        ) : savedActionKeys.has('batch_delete') ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-500" />
                            <span>Deleted!</span>
                          </>
                        ) : (
                          <>
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Delete Outliers ({totalSelectedOutlierReadingsCount})</span>
                          </>
                        )}
                      </button>
                    )
                  )}

                  <button
                    type="button"
                    disabled={selectedErrorKeys.size === 0}
                    onClick={() => {
                      const keys = Array.from(selectedErrorKeys);
                      if (keys.length === 0) return;
                      setShowTelemetryModal(false);
                      if (onOpenAgentChat) {
                        const selectedErrors = flaggedTelemetryErrors.filter(e => keys.includes(e.key));
                        const names = selectedErrors.map(e => e.name).join(', ');
                        const prefillMessage = `Please review my flagged biomarkers: ${names}\n\n` +
                          selectedErrors.map(e => {
                            const autoInfo = e.proposedAutoFix?.canAutoFix
                              ? ` (Auto-Fix Available: ${e.proposedAutoFix.fixLabel})`
                              : ` (Needs AI Review: ${e.proposedAutoFix?.reason || 'Ambiguous scaling discrepancy'})`;
                            return `• ${e.name}: ${e.badgeLabel || 'Scaling/unit error'}${autoInfo}.\n  Diagnostic cause: ${e.preciseCause || e.reason}\n  Recent logs: ${e.samples.join(' → ')}`;
                          }).join('\n\n') +
                          `\n\nPlease analyze all these flagged biomarkers simultaneously, evaluate my full log history, and propose diagnostic insights or exact corrections.`;

                        onOpenAgentChat('biomarker_review', {
                          biomarkerKey: keys.length === 1 ? keys[0] : undefined,
                          dataReviewBatchKeys: keys,
                          prefillMessage
                        });
                      }
                    }}
                    className="px-4 py-2.5 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700 text-white rounded-xl text-xs font-bold transition-all shadow-md active:scale-95 disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
                  >
                    <BrainCircuit className="w-4 h-4 text-amber-200 animate-pulse" />
                    <span>Review ({selectedErrorKeys.size}) with AI Agent</span>
                  </button>


                </div>
              </div>

            </div>
          </div>
        );
      })()}
    </div>
  );
}
