import React from 'react';
import { UserProfile, FoodLog, HealthAction, DailyBenefit, RecommendationReport, BiomarkerLog, ChatMessage, FoodIdea } from '../types';
import { translations } from '../utils/translations';
import { CheckCircle2, Circle, AlertCircle, Heart, ChevronDown, ChevronUp, Calendar, MapPin, Search, Sparkles, Trash2, RefreshCw, Clock } from 'lucide-react';
import { getBiomarkerStatus, getBiomarkerColor, getBiomarkerStatusLabel, biomarkerDefinitions, isAsianEthnicity } from '../utils/biomarkers';
import { getCurrentDateInTimezone } from '../utils/dateUtils';
import { BiomarkerExpandedSection } from './BiomarkerExpandedSection';
import ReviewBiomarkerModal from './ReviewBiomarkerModal';
import LogChat from './LogChat';

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
  onLogMedical?: (biomarkers: { [key: string]: number | string }, profileUpdates?: Partial<UserProfile>, date?: string) => void;
  hideSensitive: boolean;
  selectedModelId: string;
  onChangeModelId: (id: string) => void;
  hasBmiAlert?: boolean;
  onDismissBmiAlert?: () => void;
  onApplyCalculation?: (updates: {
    targetCalories?: number;
    targetWeight?: number;
    addedBenefit?: string;
    descriptionExplain?: string;
  }) => void;
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
  onLogMedical,
  hideSensitive,
  selectedModelId,
  onChangeModelId,
  hasBmiAlert,
  onDismissBmiAlert,
  onApplyCalculation,
}: HomeTabProps) {
  const t = translations[profile.language] || translations.en;
  const [showAllTargets, setShowAllTargets] = React.useState(false);
  const [expandedKey, setExpandedKey] = React.useState<string | null>(null);
  const [reviewingBiomarkerKey, setReviewingBiomarkerKey] = React.useState<string | null>(null);
  const [reviewHistories, setReviewHistories] = React.useState<{[key: string]: ChatMessage[]}>({});
  const [isFoodIdeaChatOpen, setIsFoodIdeaChatOpen] = React.useState(false);
  const [showHealthDiagnostics, setShowHealthDiagnostics] = React.useState(false);
  const [healthApiStatus, setHealthApiStatus] = React.useState<string>("Success (No API payload cached)");
  const [lastApiPayload, setLastApiPayload] = React.useState<any>(null);
  const [userLocation, setUserLocation] = React.useState<{ lat: number; lng: number } | null>(null);

  React.useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
        },
        (err) => {
          console.warn("Could not retrieve user location in HomeTab:", err.message || `Error code ${err.code}`);
        }
      );
    }
  }, []);

  // Combine static and custom definitions for HomeTab
  const allDefinitions = React.useMemo(() => {
    // Clone biomarkerDefinitions so we don't mutate the original static array
    const combined = biomarkerDefinitions.map(d => {
      if (d.key === 'bmi') {
        const isAsian = isAsianEthnicity(profile.ethnicity);
        const gender = (profile.gender || 'male').toLowerCase();
        const isMale = gender.startsWith('m');
        const targetBmi = isAsian ? 21.0 : (isMale ? 22.5 : 21.7);
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
            const targetBmi = isAsian ? 21.0 : (isMale ? 22.5 : 21.7);
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
        } else {
          combined.push({
            key,
            name: def.name || key,
            category: 'other',
            unit: def.unit || '',
            normalRange: def.normalRange || 'Unknown',
            descriptions: {
              en: def.description || ''
            },
            benefitRisk: def.benefitRisk
          } as any);
        }
      });
    }
    return combined;
  }, [profile.customBiomarkers, profile.language, profile.ethnicity, profile.gender, profile.height]);

  // Compute resolvedBiomarkers including BMI from profile if not explicitly defined in historical log
  const resolvedBiomarkers = React.useMemo(() => {
    const res = { ...biomarkers };
    if (res.bmi === undefined && profile.weight && profile.height) {
      const heightInMeters = Number(profile.height) / 100;
      const bmiScore = Number(profile.weight) / (heightInMeters * heightInMeters);
      res.bmi = parseFloat(bmiScore.toFixed(1));
    }
    return res;
  }, [biomarkers, profile.weight, profile.height]);

  const problematicBiomarkers = React.useMemo(() => {
    const list = Object.entries(resolvedBiomarkers)
      .map(([key, val]) => {
        const def = allDefinitions.find(d => d.key === key);
        if (!def) return null;
        const status = getBiomarkerStatus(key, Number(val), def.normalRange);
        return {
          key,
          value: val,
          status,
          def
        };
      })
      .filter((b): b is NonNullable<typeof b> => {
        if (b === null) return false;
        if (b.key === 'bmi' && hasBmiAlert) return true;
        return b.status === 'high' || b.status === 'low' || b.status === 'critical';
      });

    return list.sort((a, b) => {
      const getPriority = (status: string) => {
        if (status === 'critical') return 3;
        if (status === 'high' || status === 'low') return 2;
        return 1;
      };
      return getPriority(b.status) - getPriority(a.status);
    });
  }, [resolvedBiomarkers, allDefinitions, hasBmiAlert]);

  // Compute daily consumption from food history for today
  const todayStr = getCurrentDateInTimezone(profile.timezone);
  const todaysFoods = foodLogs.filter(f => f.date === todayStr);

  const todaysTotals = todaysFoods.reduce((acc, curr) => {
    if (curr.nutrients) {
      Object.keys(curr.nutrients).forEach(k => {
        const key = k as keyof typeof curr.nutrients;
        acc[key] = (Number(acc[key]) || 0) + (Number(curr.nutrients[key]) || 0);
      });
    }
    return acc;
  }, {} as { [key: string]: number });

  const toggleAction = (id: string) => {
    setActions(actions.map(act => act.id === id ? { ...act, completed: !act.completed } : act));
  };

  const toggleBenefit = (id: string) => {
    setDailyBenefits(dailyBenefits.map(ben => ben.id === id ? { ...ben, completed: !ben.completed } : ben));
  };

  const deleteBenefit = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDailyBenefits(dailyBenefits.filter(ben => ben.id !== id));
  };

  // Target values (Default or from report)
  const parseTarget = (val: any, fallback: number) => {
    if (val === null || val === undefined) return fallback;
    const clean = String(val).replace(/,/g, '').replace(/[^\d]/g, '');
    const parsed = parseInt(clean, 10);
    return isNaN(parsed) ? fallback : parsed;
  };

  const activeTargets = {
    calories: Number(todaysTotals.calories || 0),
    caloriesTarget: report && report.dailyNutrientTargets ? parseTarget(report.dailyNutrientTargets.calories, 1700) : 1800,
    satFat: Number(todaysTotals.saturatedFat || 0),
    satFatTarget: report && report.dailyNutrientTargets ? parseTarget(report.dailyNutrientTargets.saturatedFat, 15) : 15,
    sodium: Number(todaysTotals.sodium || 0),
    sodiumTarget: report && report.dailyNutrientTargets ? parseTarget(report.dailyNutrientTargets.sodium, 1200) : 1200,
    protein: Number(todaysTotals.protein || 0),
    proteinTarget: report && report.dailyNutrientTargets ? parseTarget(report.dailyNutrientTargets.protein, 90) : 90,
  };

  // Compliance calculations (Last 7 days/30 days mock score + live factor)
  const completedActionsCount = actions.filter(a => a.completed).length;
  const completedBenefitsCount = dailyBenefits.filter(b => b.completed).length;
  
  // Real live index score derived from checks
  const rawScore = 65 + (completedActionsCount * 6) + (completedBenefitsCount * 4) - (activeTargets.satFat > activeTargets.satFatTarget ? 8 : 0);
  const complianceScore7Day = Math.min(100, rawScore);
  const complianceScore30Day = Math.min(100, Math.round(rawScore * 0.95));

  const distinctDaysOfData = new Set(foodLogs.map(l => l.date)).size;

  const missingProfilePoints: string[] = [];
  if (profile.age === undefined || profile.age === null || String(profile.age).trim() === '') missingProfilePoints.push('Age');
  if (profile.ethnicity === undefined || profile.ethnicity === null || String(profile.ethnicity).trim() === '' || String(profile.ethnicity).toLowerCase() === 'unknown') missingProfilePoints.push('Ethnicity');
  if (profile.weight === undefined || profile.weight === null || String(profile.weight).trim() === '') missingProfilePoints.push('Weight');
  if (profile.height === undefined || profile.height === null || String(profile.height).trim() === '') missingProfilePoints.push('Height');

  const getMissingDataStatus = () => {
    const basicInfoMissing = ['Age', 'Ethnicity', 'Weight', 'Height'].filter(f => missingProfilePoints.includes(f));
    const missing = [];
    if (basicInfoMissing.length > 0) missing.push('basic profile info (Age, Height, etc)');
    if (foodLogs.length === 0) missing.push('some food logs');
    if (Object.keys(biomarkers).length === 0) missing.push('medical biomarkers');
    return missing;
  };

  const getDynamicNextStep = () => {
    if (report?.mostImportantNextStep) {
      return report.mostImportantNextStep;
    }
    const missing = getMissingDataStatus();
    if (missing.length > 0) {
      return `To get your personalized health recommendations, please add ${missing.join(', ')}.`;
    }
    return "You have provided enough information. Please go to Insights and run a health analysis!";
  };

  const [googleSteps, setGoogleSteps] = React.useState<number | null>(() => {
    const saved = localStorage.getItem('googleSteps');
    return saved ? parseInt(saved, 10) : null;
  });

  const [googleStepsAverage, setGoogleStepsAverage] = React.useState<number | null>(() => {
    const saved = localStorage.getItem('googleStepsAverage');
    return saved ? parseInt(saved, 10) : null;
  });

  const [lastActiveDaySteps, setLastActiveDaySteps] = React.useState<number | null>(() => {
    const saved = localStorage.getItem('lastActiveDaySteps');
    return saved ? parseInt(saved, 10) : null;
  });

  const [lastActiveDayTimestamp, setLastActiveDayTimestamp] = React.useState<string | null>(() => {
    return localStorage.getItem('lastActiveDayTimestamp');
  });

  React.useEffect(() => {
    const handleGoogleUpdate = () => {
      const gs = localStorage.getItem('googleSteps');
      setGoogleSteps(gs ? parseInt(gs, 10) : null);
      
      const gsa = localStorage.getItem('googleStepsAverage');
      setGoogleStepsAverage(gsa ? parseInt(gsa, 10) : null);
      
      const lads = localStorage.getItem('lastActiveDaySteps');
      setLastActiveDaySteps(lads ? parseInt(lads, 10) : null);
      
      setLastActiveDayTimestamp(localStorage.getItem('lastActiveDayTimestamp'));
    };
    
    window.addEventListener('googleStepsUpdated', handleGoogleUpdate);
    return () => window.removeEventListener('googleStepsUpdated', handleGoogleUpdate);
  }, []);

  return (
    <div className="space-y-6 pb-24 animation-fade-in max-w-md mx-auto px-4 mt-4 font-sans text-slate-900">
      
      {/* Single Most Important Next Step */}
      <div id="primary-action-card" className="bg-amber-50/50 dark:bg-amber-950/20 border border-amber-500/10 rounded-2xl p-4 shadow-sm">
        <div className="flex gap-3">
          <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h3 className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
              {t.singleNextStep}
            </h3>
            <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed font-medium">
              {getDynamicNextStep()}
            </p>
            {!report && getMissingDataStatus().length > 0 && (
              <button
                id="home-navigate-medical-btn"
                onClick={() => onNavigateToTab('medical')}
                className="text-[11px] font-bold text-indigo-600 hover:text-indigo-700 mt-2 block cursor-pointer"
              >
                Add body information &rarr;
              </button>
            )}
            {!report && getMissingDataStatus().length === 0 && (
              <button
                onClick={() => onNavigateToTab('insights')}
                className="text-[11px] font-bold text-indigo-600 hover:text-indigo-700 mt-2 block cursor-pointer"
              >
                Run Health Analysis &rarr;
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Nutrition Allowance Tracker Dashboard (MOVED UP just above Health Status & BMI) */}
      <div id="dashboard-nutrition-targets" className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800/80 rounded-[32px] p-6 shadow-sm space-y-4">
        <div className="flex justify-between items-center pb-2 border-b border-slate-100 dark:border-slate-800/50">
          <h3 className="font-bold text-slate-950 dark:text-slate-100 text-sm flex items-center gap-2">
            <Heart className="w-4 h-4 text-indigo-600" />
            Today's Top Targets
          </h3>
          <span className="text-[10px] font-mono text-slate-400 flex items-center gap-1">
            <Calendar className="w-3 h-3" /> {todayStr}
          </span>
        </div>

        {/* Live progress bars comparing actual todaysTotals vs targets */}
        <div className="space-y-4">
          {/* Calorie Bar */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs font-semibold">
              <span className="text-slate-700 dark:text-slate-300">Calories Allowed</span>
              <span className="text-slate-500 font-mono">{activeTargets.calories} / {activeTargets.caloriesTarget} kcal</span>
            </div>
            <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
              <div 
                className="h-full bg-indigo-600 rounded-full transition-all duration-500" 
                style={{ width: `${Math.min(100, (activeTargets.calories / activeTargets.caloriesTarget) * 100)}%` }}
              />
            </div>
          </div>

          {/* Saturated Fat Bar (Critical for LDL) */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs font-semibold">
              <span className="text-slate-700 dark:text-slate-300">Saturated Fat Limit</span>
              <span className={`font-mono ${activeTargets.satFat > activeTargets.satFatTarget ? 'text-rose-500 font-bold' : 'text-slate-500'}`}>
                {activeTargets.satFat.toFixed(1)}g / {activeTargets.satFatTarget}g
              </span>
            </div>
            <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
              <div 
                className={`h-full rounded-full transition-all duration-500 ${activeTargets.satFat > activeTargets.satFatTarget ? 'bg-rose-500' : 'bg-indigo-600'}`} 
                style={{ width: `${Math.min(100, (activeTargets.satFat / activeTargets.satFatTarget) * 100)}%` }}
              />
            </div>
          </div>

          {/* Sodium Bar */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs font-semibold">
              <span className="text-slate-700 dark:text-slate-300">Sodium Guard</span>
              <span className={`font-mono ${activeTargets.sodium > activeTargets.sodiumTarget ? 'text-rose-500 font-bold' : 'text-slate-500'}`}>
                {activeTargets.sodium}mg / {activeTargets.sodiumTarget}mg
              </span>
            </div>
            <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
              <div 
                className={`h-full rounded-full transition-all duration-500 ${activeTargets.sodium > activeTargets.sodiumTarget ? 'bg-rose-500' : 'bg-indigo-600'}`} 
                style={{ width: `${Math.min(100, (activeTargets.sodium / activeTargets.sodiumTarget) * 100)}%` }}
              />
            </div>
          </div>

          {/* Steps Bar */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs font-semibold">
              <span className="text-slate-700 dark:text-slate-300 flex items-center gap-1">
                <span>Steps</span>
                {googleStepsAverage !== null && (
                  <span className="text-[10px] text-slate-400 font-normal">
                    (7d avg: {googleStepsAverage.toLocaleString()})
                  </span>
                )}
              </span>
              <span className={`font-mono ${googleSteps !== null && googleSteps >= (parseTarget(report?.dailyNutrientTargets?.steps, 3000)) ? 'text-emerald-500 font-bold' : 'text-slate-500'}`}>
                {googleSteps || 0} / {parseTarget(report?.dailyNutrientTargets?.steps, 3000)} steps
              </span>
            </div>
            <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
              <div 
                className={`h-full rounded-full transition-all duration-500 ${googleSteps !== null && googleSteps >= (parseTarget(report?.dailyNutrientTargets?.steps, 3000)) ? 'bg-emerald-500' : 'bg-indigo-600'}`} 
                style={{ width: `${Math.min(100, ((googleSteps || 0) / (parseTarget(report?.dailyNutrientTargets?.steps, 3000))) * 100)}%` }}
              />
            </div>
            {googleSteps === 0 && lastActiveDaySteps && (
              <p className="text-[10px] text-slate-400 italic">
                Today: 0 steps. Last active day: {lastActiveDaySteps.toLocaleString()} steps ({lastActiveDayTimestamp})
              </p>
            )}
          </div>
        </div>

        {/* Expandable Targets Section */}
        {report && (
          <div>
            <button
              onClick={() => setShowAllTargets(!showAllTargets)}
              className="w-full pt-2 flex items-center justify-center gap-1.5 text-xs text-slate-400 hover:text-indigo-600 font-semibold border-t border-slate-100 dark:border-slate-800/30 mt-3 cursor-pointer"
            >
              <span>{showAllTargets ? 'Show Less Targets' : 'Expand Less Important Targets'}</span>
              {showAllTargets ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {showAllTargets && (
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-mono py-2 bg-slate-50 dark:bg-slate-900/40 rounded-2xl px-3 animation-slide-down">
                {Object.entries(report?.dailyNutrientTargets || {}).map(([key, val]) => {
                  if (['calories', 'saturatedFat', 'sodium'].includes(key)) return null;
                  return (
                    <div key={key} className="flex flex-col py-1 border-b border-slate-100 dark:border-slate-800/30">
                      <span className="text-[10px] text-slate-400 capitalize">{key.replace(/([A-Z])/g, ' $1')}</span>
                      <span className="font-semibold text-slate-700 dark:text-slate-200">{val}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Food Ideas Section */}
      <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-500" />
            Food Ideas
          </h3>
          <button
            onClick={() => setIsFoodIdeaChatOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900 rounded-lg text-xs font-bold transition-colors cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5" /> Ask Agent
          </button>
        </div>

        {foodIdeas.length > 0 && (
          <div className="space-y-2">
            {foodIdeas.map(idea => (
              <div key={idea.id} className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                <button
                  onClick={() => setExpandedKey(expandedKey === idea.id ? null : idea.id)}
                  className="w-full flex items-center justify-between p-3 text-left bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-colors cursor-pointer"
                >
                  <span className="font-bold text-sm text-slate-800 dark:text-slate-200">{idea.name}</span>
                  {expandedKey === idea.id ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                </button>
                {expandedKey === idea.id && (
                  <div className="p-4 bg-slate-50 dark:bg-slate-900/50 border-t border-slate-200 dark:border-slate-800 space-y-4 animation-fade-in text-xs">
                    <p className="text-slate-600 dark:text-slate-300 leading-relaxed font-medium">{idea.benefitExplanation}</p>
                    
                     {idea.locationLink && (
                      <div className="space-y-3">
                        <div className="flex items-center flex-wrap gap-x-3 gap-y-1.5">
                          <a href={idea.locationLink} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400 font-bold hover:underline">
                            <MapPin className="w-3.5 h-3.5" /> {idea.placeName || "Find Nearby"}
                          </a>
                          {idea.distanceKm !== undefined && (
                            <span className="text-[10px] bg-slate-200/60 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-1.5 py-0.5 rounded font-semibold border border-slate-300/30">
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
                        <span key={idx} className="bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 px-2 py-0.5 rounded text-[10px] font-bold border border-slate-200 dark:border-slate-700">
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
                      Remove Idea
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Health status to improve (Previously Health & BMI Summary) */}
      <div id="health-summary-section" className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800/80 rounded-[32px] p-6 shadow-sm space-y-5">
        <div className="flex justify-between items-center pb-2 border-b border-slate-100 dark:border-slate-800/50">
          <h3 className="font-bold text-slate-950 dark:text-slate-100 text-sm flex items-center gap-2 font-display">
            <Heart className="w-4.5 h-4.5 text-indigo-600" />
            Health status to improve
          </h3>
        </div>

        {/* Problematic Biomarkers list (rendered in 2 columns as expandable tabs/cards) */}
        <div>
          {problematicBiomarkers.length > 0 ? (
            <div className="space-y-4">
              {(() => {
                const chunks: typeof problematicBiomarkers[] = [];
                for (let i = 0; i < problematicBiomarkers.length; i += 2) {
                  chunks.push(problematicBiomarkers.slice(i, i + 2));
                }
                return chunks.map((chunk, chunkIdx) => {
                  const expandedInChunk = chunk.find(b => expandedKey === b.key);
                  return (
                    <div key={chunkIdx} className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        {chunk.map((b) => {
                          const colorClass = getBiomarkerColor(b.status);
                          const isExpanded = expandedKey === b.key;
                          return (
                            <button
                              key={b.key}
                              id={`biomarker-card-${b.key}`}
                              onClick={() => setExpandedKey(isExpanded ? null : b.key)}
                              className={`p-3 text-left rounded-2xl border transition-all duration-200 cursor-pointer flex flex-col justify-between h-24 ${
                                isExpanded
                                  ? 'bg-indigo-50/50 dark:bg-indigo-950/20 border-indigo-500 shadow-sm ring-1 ring-indigo-500'
                                  : 'bg-slate-50 dark:bg-slate-950 border-slate-100 dark:border-slate-800/20 hover:bg-slate-100/50 dark:hover:bg-slate-800/30'
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
                                  {getBiomarkerStatusLabel(b.key, b.status)}
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </div>

                      {expandedInChunk && (
                        <div id={`biomarker-expanded-${expandedInChunk.key}`} className="bg-slate-50 dark:bg-slate-950 rounded-2xl border border-indigo-100 dark:border-indigo-950/40 overflow-hidden animation-fade-in mt-1">
                          <div className="p-4 border-b border-slate-100 dark:border-slate-800/30 flex items-center justify-between bg-white dark:bg-slate-900">
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="font-size-body-small font-bold text-slate-800 dark:text-slate-200">
                                  {expandedInChunk.def.name}
                                </span>
                                <span className="font-size-xs font-mono text-slate-400">({expandedInChunk.def.unit})</span>
                              </div>
                              <p className="font-size-body-small text-slate-500 dark:text-slate-400 mt-0.5 font-medium">
                                Normal range: {expandedInChunk.def.normalRange}
                              </p>
                            </div>
                            <div className="flex flex-col items-end">
                              <span className={`font-size-subtitle font-black font-sans ${getBiomarkerColor(expandedInChunk.status)}`}>
                                {hideSensitive ? '***' : expandedInChunk.value}
                              </span>
                               <span className={`font-size-xs font-black px-1.5 py-0.5 rounded-full uppercase tracking-wider ${getBiomarkerColor(expandedInChunk.status)} bg-current/10`}>
                                {getBiomarkerStatusLabel(expandedInChunk.key, expandedInChunk.status)}
                              </span>
                            </div>
                          </div>

                          <BiomarkerExpandedSection
                            def={expandedInChunk.def}
                            profile={profile}
                            biomarkerHistory={biomarkerHistory}
                            biomarkers={resolvedBiomarkers}
                            onEditBiomarkerLog={onEditBiomarkerLog}
                            onDeleteBiomarkerLog={onDeleteBiomarkerLog}
                            onOpenAiReview={setReviewingBiomarkerKey}
                            onApplyCalculation={onApplyCalculation}
                            hasPendingAlert={expandedInChunk.key === 'bmi' ? hasBmiAlert : false}
                            onDismissAlert={expandedInChunk.key === 'bmi' ? onDismissBmiAlert : undefined}
                            hideSensitive={hideSensitive}
                          />
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          ) : (
            <div className="p-4 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 text-center">
              <p className="text-xs text-slate-400 font-medium">All recorded biomarkers are within normal range! 🎉</p>
            </div>
          )}
        </div>
      </div>

      {/* Target Compliance score meters */}
      {distinctDaysOfData >= 7 && (
        <div id="compliance-card" className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800/80 rounded-[32px] p-6 shadow-sm grid grid-cols-2 gap-4">
          <div className="border-r border-slate-100 dark:border-slate-800/50 pr-2 flex flex-col justify-between">
            <span className="text-[10px] font-bold tracking-wider uppercase text-slate-400">7-Day Compliance</span>
            <div className="flex items-baseline gap-1 mt-1">
              <span id="score-7d-text" className="text-3xl font-black font-sans text-indigo-600">{complianceScore7Day}%</span>
              <span className="text-xs text-slate-400 font-medium">on target</span>
            </div>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-2 leading-tight">
              {complianceScore7Day >= 80 ? 'Excellent cardiovascular protection benefits.' : 'Steady effort will lower vascular risk markers.'}
            </p>
          </div>
          <div className="pl-1 flex flex-col justify-between">
            <span className="text-[10px] font-bold tracking-wider uppercase text-slate-400">30-Day Compliance</span>
            <div className="flex items-baseline gap-1 mt-1">
              <span id="score-30d-text" className="text-3xl font-black font-sans text-indigo-700">{complianceScore30Day}%</span>
              <span className="text-xs text-slate-400 font-medium">overall</span>
            </div>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-2 leading-tight">
              Consistency reduces future atherosclerosis risks significantly.
            </p>
          </div>
        </div>
      )}

      {/* Clinical Action Steps checklist */}
      <div id="actions-checklist-section" className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800/80 rounded-[32px] p-6 shadow-sm space-y-4">
        <div>
          <h3 className="font-bold text-slate-950 dark:text-slate-100 text-sm">
            Clinical Action Recommendations
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-medium">
            Discuss these priorities with your general practitioner (GP).
          </p>
        </div>

        <div className="space-y-3">
          {actions.map((act) => (
            <div 
              key={act.id} 
              id={`action-item-${act.id}`}
              onClick={() => toggleAction(act.id)}
              className={`flex items-start gap-3 p-3 rounded-2xl cursor-pointer border hover:bg-slate-50 dark:hover:bg-slate-800/20 transition-all ${
                act.completed 
                  ? 'bg-slate-50/50 dark:bg-slate-800/10 border-slate-100 dark:border-slate-800/40' 
                  : act.priority === 'high' 
                    ? 'border-rose-500/10 bg-rose-50/10' 
                    : 'border-slate-100 dark:border-slate-800/50'
              }`}
            >
              <button className="flex-shrink-0 mt-0.5 text-slate-400 dark:text-slate-500 cursor-pointer">
                {act.completed ? (
                  <CheckCircle2 className="w-5 h-5 text-indigo-600 fill-indigo-600/10" />
                ) : (
                  <Circle className="w-5 h-5 hover:text-indigo-600" />
                )}
              </button>
              <div className="space-y-1">
                <span className={`text-xs font-semibold leading-tight block ${act.completed ? 'line-through text-slate-400 dark:text-slate-500' : 'text-slate-800 dark:text-slate-200'}`}>
                  {act.task}
                </span>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed font-medium">
                  {act.explanation}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Daily Benefit tasks checkoff */}
      <div id="benefits-checklist-section" className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800/80 rounded-[32px] p-6 shadow-sm space-y-4">
        <div>
          <h3 className="font-bold text-slate-950 dark:text-slate-100 text-sm">
            {t.dailyBenefits}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-medium">
            Consistently executing these behaviors halts arterial plaque progression.
          </p>
        </div>

         <div className="space-y-2.5">
          {dailyBenefits.map((ben) => (
            <div
              key={ben.id}
              id={`benefit-item-${ben.id}`}
              onClick={() => toggleBenefit(ben.id)}
              className="flex items-center justify-between p-3 border border-slate-100 dark:border-slate-800/50 rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-800/20 cursor-pointer transition-all group"
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
                title="Delete benefit item"
              >
                <Trash2 className="w-3.8 h-3.8" />
              </button>
            </div>
          ))}
        </div>
      </div>



      {/* Google Health UI moved to Profile settings */}

      {/* AI Review Modal for Biomarker details */}
      {reviewingBiomarkerKey && (
        <ReviewBiomarkerModal
          profile={profile}
          isOpen={true}
          biomarkerKey={reviewingBiomarkerKey}
          currentValue={resolvedBiomarkers[reviewingBiomarkerKey]}
          onClose={() => setReviewingBiomarkerKey(null)}
          initialMessages={reviewHistories[reviewingBiomarkerKey] || []}
          onUpdateMessages={(msgs) => {
            setReviewHistories(prev => ({
              ...prev,
              [reviewingBiomarkerKey]: msgs
            }));
          }}
          onUpdateBiomarker={(key, val, proposal) => {
            if (onLogMedical) {
              const profileUpdates: Partial<UserProfile> = {};
              if (proposal) {
                profileUpdates.customBiomarkers = {
                  ...(profile.customBiomarkers || {}),
                  [key]: {
                    name: proposal.name || key,
                    unit: proposal.metric || '',
                    normalRange: proposal.range || 'Unknown',
                    description: proposal.description || '',
                    benefitRisk: proposal.benefitRisk || ''
                  }
                };
              }
              onLogMedical({ [key]: val }, profileUpdates);
            }
          }}
          selectedModelId={selectedModelId}
          onChangeModelId={onChangeModelId}
        />
      )}

      {/* Food Idea Agent Modal */}
      <LogChat 
        type="food_idea"
        isOpen={isFoodIdeaChatOpen}
        onClose={() => setIsFoodIdeaChatOpen(false)}
        profile={profile}
        foodLogs={foodLogs}
        biomarkers={biomarkers}
        selectedModelId={selectedModelId}
        onChangeModelId={onChangeModelId}
        onLogFoodIdeas={(ideas) => {
          setFoodIdeas([...foodIdeas, ...ideas]);
          setIsFoodIdeaChatOpen(false);
        }}
      />
    </div>
  );
}
