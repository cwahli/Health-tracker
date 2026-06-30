import React, { useState, useMemo } from 'react';
import { UserProfile, BiomarkerLog, ChatMessage } from '../types';
import { translations } from '../utils/translations';
import { ShieldAlert, ClipboardList, Trash2, ChevronDown, ChevronUp, LineChart as LineChartIcon, BrainCircuit, AlertCircle } from 'lucide-react';
import { biomarkerDefinitions, getBiomarkerStatus, getBiomarkerColor, getBiomarkerStatusLabel, BiomarkerDefinition, isAsianEthnicity, getPhysiologicalBucket, getBiomarkerMetadata } from '../utils/biomarkers';
import ReviewBiomarkerModal from './ReviewBiomarkerModal';
import { BiomarkerExpandedSection } from './BiomarkerExpandedSection';
import CombineBiomarkersModal from './CombineBiomarkersModal';

interface MedicalHistoryTabProps {
  profile: UserProfile;
  biomarkers: { [key: string]: number | string };
  biomarkerHistory: BiomarkerLog[];
  hideSensitive: boolean;
  onDeleteBiomarkerLog: (id: string) => void;
  onEditBiomarkerLog: (id: string, key: string, value: string | number, newDate?: string) => void;
  onLogMedical?: (biomarkers: { [key: string]: number | string }, profileUpdates?: Partial<UserProfile>, date?: string, entries?: { date: string | null; biomarkers: { [key: string]: number | string } }[]) => void;
  onCombineBiomarkers?: (
    targetKey: string,
    targetDef: { name: string; unit: string; normalRange: string; description: string },
    mergedLogs: { date: string; value: number | string }[],
    sourceKeysToDelete: string[]
  ) => void;
  onApplyCalculation?: (updates: {
    targetCalories?: number;
    targetWeight?: number;
    addedBenefit?: string;
    descriptionExplain?: string;
  }) => void;
  selectedModelId: string;
  onChangeModelId: (id: string) => void;
  hasBmiAlert?: boolean;
  onDismissBmiAlert?: () => void;
}

export default function MedicalHistoryTab({
  profile,
  biomarkers,
  biomarkerHistory,
  hideSensitive,
  onDeleteBiomarkerLog,
  onEditBiomarkerLog,
  onLogMedical,
  onCombineBiomarkers,
  onApplyCalculation,
  selectedModelId,
  onChangeModelId,
  hasBmiAlert,
  onDismissBmiAlert,
}: MedicalHistoryTabProps) {
  const t = translations[profile.language] || translations.en;
  const [viewType, setViewType] = useState<'risk' | 'condition' | 'practice'>('practice');
  const [selectedSubCategory, setSelectedSubCategory] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'risk' | 'name'>('risk');
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [editDate, setEditDate] = useState<string>('');
  const [reviewingBiomarkerKey, setReviewingBiomarkerKey] = useState<string | null>(null);
  const [combineBiomarkerKey, setCombineBiomarkerKey] = useState<string | null>(null);
  const [flashingKey, setFlashingKey] = useState<string | null>(null);
  const [reviewHistories, setReviewHistories] = useState<{[key: string]: ChatMessage[]}>({});

  // Important/highlighted biomarkers for user cardiovascular/kidney health
  const highlightKeys = ['ldl', 'apob', 'hba1c', 'egfr', 'hscrp'];

  // Combine definitions with dynamic ones from `biomarkers` object and profile.customBiomarkers
  const allDefinitions = useMemo(() => {
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
    
    // First, merge from profile.customBiomarkers
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
              en: 'A measure of body fat based on height and weight.'
            };
          } else {
            existing.normalRange = def.normalRange || existing.normalRange;
            existing.unit = def.unit || existing.unit;
            if (def.description) {
              existing.descriptions = { ...existing.descriptions, en: def.description };
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

    Object.keys(biomarkers).forEach(key => {
      if (key === 'weight' || key === 'height' || key === 'age') return;
      if (!combined.find(d => d.key === key)) {
        combined.push({
          key,
          name: key.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
          category: 'other',
          unit: '',
          normalRange: 'Unknown',
          descriptions: {
            en: ''
          }
        });
      }
    });
    const withMetadata = combined.map(def => {
      const customDef = profile.customBiomarkers?.[def.key];
      const meta = getBiomarkerMetadata(def.key, customDef);
      return {
        ...def,
        riskCategories: meta.riskCategories,
        standardMedicalGrouping: meta.standardMedicalGrouping,
        potentialMedicalConditions: meta.potentialMedicalConditions
      };
    });
    return withMetadata;
  }, [biomarkers, profile.customBiomarkers, profile.ethnicity, profile.gender, profile.height]);

  // Dynamic list of subcategories based on current viewType
  const subCategories = useMemo(() => {
    if (viewType === 'risk') {
      const allRisks = new Set<string>();
      allDefinitions.forEach(def => {
        def.riskCategories?.forEach(r => {
          if (r) allRisks.add(r);
        });
      });
      return ['all', ...Array.from(allRisks).sort()];
    } else if (viewType === 'condition') {
      const allConditions = new Set<string>();
      allDefinitions.forEach(def => {
        def.potentialMedicalConditions?.forEach(c => {
          if (c) allConditions.add(c);
        });
      });
      return ['all', ...Array.from(allConditions).sort()];
    } else {
      const allPractices = new Set<string>();
      allDefinitions.forEach(def => {
        if (def.standardMedicalGrouping) {
          allPractices.add(def.standardMedicalGrouping);
        }
      });
      return ['all', ...Array.from(allPractices).sort()];
    }
  }, [allDefinitions, viewType]);

  const filteredBiomarkers = useMemo(() => {
    let filtered = allDefinitions.filter(def => {
      if (selectedSubCategory === 'all') return true;
      if (viewType === 'risk') {
        return def.riskCategories?.includes(selectedSubCategory);
      } else if (viewType === 'condition') {
        return def.potentialMedicalConditions?.includes(selectedSubCategory);
      } else {
        return def.standardMedicalGrouping === selectedSubCategory;
      }
    });

    if (sortBy === 'name') {
      filtered.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      // Sort by importance: critical > high/low > normal > unknown > no data
      const getSeverityScore = (key: string) => {
        const val = biomarkers[key];
        if (val === undefined) return -1;
        
        const def = allDefinitions.find(d => d.key === key);
        const status = getBiomarkerStatus(key, val, def?.normalRange);
        
        if (status === 'critical') return 4;
        if (status === 'high' || status === 'low') return 3;
        if (status === 'normal') return 2;
        return 1; // unknown
      };

      const getLatestDate = (key: string) => {
        const logs = biomarkerHistory.filter(h => h.biomarkers[key] !== undefined);
        if (logs.length === 0) return '0000-00-00';
        return logs.map(h => h.date).sort().reverse()[0];
      };

      filtered.sort((a, b) => {
        const scoreA = getSeverityScore(a.key);
        const scoreB = getSeverityScore(b.key);
        
        if (scoreA !== scoreB) return scoreB - scoreA; // higher severity first
        
        // Secondary sort: Latest date
        const dateA = getLatestDate(a.key);
        const dateB = getLatestDate(b.key);
        if (dateA !== dateB) return dateB.localeCompare(dateA);
        
        return a.name.localeCompare(b.name);
      });
    }

    return filtered;
  }, [allDefinitions, viewType, selectedSubCategory, sortBy, biomarkerHistory, biomarkers]);

  return (
    <div className="space-y-5 pb-24 animation-fade-in max-w-md mx-auto px-4 mt-4 font-sans text-slate-900">
      
      {/* View Selection Controls */}
      <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 rounded-2xl p-4 space-y-3 shadow-sm">
        <div className="grid grid-cols-2 gap-3">
          {/* View Selection */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase tracking-wider font-bold text-slate-400">
              Select View
            </label>
            <select
              value={viewType}
              onChange={(e) => {
                setViewType(e.target.value as any);
                setSelectedSubCategory('all');
              }}
              className="w-full px-3 py-2 text-xs font-semibold bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-750 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:outline-none transition-all cursor-pointer shadow-sm"
            >
              <option value="risk">By Risk Categories</option>
              <option value="condition">By Medical Conditions</option>
              <option value="practice">By Medical Practice</option>
            </select>
          </div>

          {/* Sort Selection */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase tracking-wider font-bold text-slate-400">
              Sort By
            </label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="w-full px-3 py-2 text-xs font-semibold bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-750 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:outline-none transition-all cursor-pointer shadow-sm"
            >
              <option value="risk">Risk Level</option>
              <option value="name">Name</option>
            </select>
          </div>
        </div>

        {/* Dynamic Category/Group Filter */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] uppercase tracking-wider font-bold text-slate-400">
            {viewType === 'risk' && 'Filter Risk Category'}
            {viewType === 'condition' && 'Filter Medical Condition'}
            {viewType === 'practice' && 'Filter Medical Practice'}
          </label>
          <select
            value={selectedSubCategory}
            onChange={(e) => setSelectedSubCategory(e.target.value)}
            className="w-full px-3 py-2 text-xs font-semibold bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-750 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:outline-none transition-all cursor-pointer shadow-sm"
          >
            <option value="all">
              All {viewType === 'risk' && 'Risk Categories'}
              {viewType === 'condition' && 'Medical Conditions'}
              {viewType === 'practice' && 'Medical Practices'}
            </option>
            {subCategories.filter(cat => cat !== 'all').map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Biomarkers Directory list */}
      <div id="biomarkers-directory" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 rounded-[32px] overflow-hidden shadow-sm">
        <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
          {filteredBiomarkers.map((def) => {
            const val = biomarkers[def.key];
            const hasVal = val !== undefined;
            const status = hasVal ? getBiomarkerStatus(def.key, val, def.normalRange) : 'unknown';
            const colorClass = getBiomarkerColor(status);
            const isExpanded = expandedKey === def.key;

            return (
              <div 
                key={def.key} 
                id={`biomarker-card-${def.key}`} 
                className={`flex flex-col transition-all duration-1000 ${
                  flashingKey === def.key 
                    ? 'bg-indigo-50/70 dark:bg-indigo-950/30 ring-2 ring-indigo-500/50 dark:ring-indigo-400/50 rounded-2xl overflow-hidden' 
                    : ''
                }`}
              >
                <div
                  onClick={() => setExpandedKey(isExpanded ? null : def.key)}
                  className={`flex items-center justify-between p-4 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/30 ${isExpanded ? 'bg-slate-50 dark:bg-slate-800/30' : ''}`}
                >
                  <div className="min-w-0 flex-1 pr-3">
                    <div className="flex items-center gap-1.5">
                      <span className="font-size-body-small font-bold text-slate-800 dark:text-slate-200 truncate">
                        {def.name}
                      </span>
                      {def.key === 'bmi' && hasBmiAlert && (
                        <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 animate-pulse" />
                      )}
                      <span className="font-size-xs font-mono text-slate-400">({def.unit})</span>
                    </div>
                    <p className="font-size-body-small text-slate-400 truncate mt-0.5">
                      Normal range: {def.normalRange}
                    </p>
                    
                    {/* Associated Metadata Badges */}
                    <div className="flex flex-wrap gap-1 mt-1.5 max-w-full overflow-hidden">
                      {def.riskCategories && def.riskCategories.length > 0 && def.riskCategories.map((cat: string, i: number) => (
                        <span key={`risk-${i}`} className="px-1.5 py-0.5 text-[9px] font-bold bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 rounded-md border border-rose-100 dark:border-rose-900/40 whitespace-nowrap">
                          {cat}
                        </span>
                      ))}
                      {def.potentialMedicalConditions && def.potentialMedicalConditions.length > 0 && def.potentialMedicalConditions.map((cond: string, i: number) => (
                        <span key={`cond-${i}`} className="px-1.5 py-0.5 text-[9px] font-bold bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 rounded-md border border-amber-100 dark:border-amber-900/40 whitespace-nowrap">
                          {cond}
                        </span>
                      ))}
                      {def.standardMedicalGrouping && (
                        <span className="px-1.5 py-0.5 text-[9px] font-medium bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 rounded-md border border-slate-100 dark:border-slate-800/40 whitespace-nowrap">
                          {def.standardMedicalGrouping}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="text-right flex items-center gap-3">
                    <div className="flex flex-col items-end">
                      <span className={`font-size-subtitle font-bold font-sans ${hasVal ? colorClass : 'text-slate-300'}`}>
                        {hasVal ? (hideSensitive ? '***' : val) : 'Unset'}
                      </span>
                      {hasVal && (
                        <span className={`font-size-subtitle-small font-bold uppercase tracking-wider ${colorClass}`}>
                          {getBiomarkerStatusLabel(def.key, status)}
                        </span>
                      )}
                    </div>
                    <div className="text-slate-400">
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </div>
                  </div>
                </div>
                
                {isExpanded && (
                  <BiomarkerExpandedSection
                    def={def}
                    profile={profile}
                    biomarkerHistory={biomarkerHistory}
                    biomarkers={biomarkers}
                    onEditBiomarkerLog={onEditBiomarkerLog}
                    onDeleteBiomarkerLog={onDeleteBiomarkerLog}
                    onOpenAiReview={setReviewingBiomarkerKey}
                    onCombineBiomarker={setCombineBiomarkerKey}
                    onApplyCalculation={onApplyCalculation}
                    hasPendingAlert={def.key === 'bmi' ? hasBmiAlert : false}
                    onDismissAlert={def.key === 'bmi' ? onDismissBmiAlert : undefined}
                    hideSensitive={hideSensitive}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
      
      {reviewingBiomarkerKey && (
        <ReviewBiomarkerModal
          profile={profile}
          isOpen={true}
          biomarkerKey={reviewingBiomarkerKey}
          currentValue={biomarkers[reviewingBiomarkerKey]}
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
              onLogMedical({ [key]: val }, profileUpdates, new Date().toISOString().split('T')[0]);
              
              // Close modal
              setReviewingBiomarkerKey(null);

              // Scroll and flash
              setExpandedKey(key);
              setFlashingKey(key);

              setTimeout(() => {
                const element = document.getElementById(`biomarker-card-${key}`);
                if (element) {
                  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
              }, 400);

              setTimeout(() => {
                setFlashingKey(null);
              }, 4000);
            }
          }}
          selectedModelId={selectedModelId}
          onChangeModelId={onChangeModelId}
        />
      )}

      {combineBiomarkerKey && onCombineBiomarkers && (
        <CombineBiomarkersModal
          profile={profile}
          isOpen={true}
          initialKey={combineBiomarkerKey}
          biomarkers={biomarkers}
          biomarkerHistory={biomarkerHistory}
          allDefinitions={allDefinitions}
          onClose={() => setCombineBiomarkerKey(null)}
          onSaveCombine={onCombineBiomarkers}
        />
      )}
    </div>
  );
}
