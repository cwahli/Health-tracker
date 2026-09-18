import { toYYYYMMDD } from "../utils/dateUtils";
import React, { useState } from 'react';
import { ResponsiveContainer, LineChart, XAxis, YAxis, Tooltip, ReferenceLine, Line } from 'recharts';
import { BrainCircuit, LineChart as LineChartIcon, Trash2 } from 'lucide-react';
import { BiomarkerLog, UserProfile } from '../types';
import { BiomarkerDefinition, getBiomarkerStatus, isAsianEthnicity } from '../utils/biomarkers';
import { generateDynamicInsight } from '../utils/biomarkerInsights';
import { reverseStandardizeUnit, formatNormalRange, CONVERSION_FACTORS, standardizeUnit } from '../utils/unitConversion';
import BiomarkerCalculationPanel from './BiomarkerCalculationPanel';
import { getAgentCalibration, formatOptimalTargetValue } from '../utils/agentCalibration';
import { getBiomarkerRangeSourceInfo } from '../utils/biomarkerLifecycle';
import { translations } from '../utils/translations';

interface BiomarkerExpandedSectionProps {
  language?: string;
  def: BiomarkerDefinition;
  profile: UserProfile;
  biomarkerHistory: BiomarkerLog[];
  biomarkers: { [key: string]: number | string };
  onEditBiomarkerLog?: (id: string, key: string, value: string | number, newDate?: string) => void;
  onDeleteBiomarkerLog?: (id: string) => void;
  onDeleteBiomarkerFromLog?: (id: string, key: string) => void;
  onDeleteBiomarker?: (key: string) => void;
  onOpenAiReview: (key: string) => void;
  onCombineBiomarker?: (key: string) => void;
  onApplyCalculation?: (updates: {
    targetCalories?: number;
    targetWeight?: number;
    addedBenefit?: string;
    descriptionExplain?: string;
  }) => void;
  hasPendingAlert?: boolean;
  onDismissAlert?: () => void;
  hideSensitive: boolean;
  onEditBiomarkerDef?: (key: string, normalRange: string, unit: string) => void;
  onFlagNotUsedLocal?: (key: string) => void;
}

export const BiomarkerExpandedSection: React.FC<BiomarkerExpandedSectionProps> = ({
  language, def,
  profile,
  biomarkerHistory,
  biomarkers,
  onEditBiomarkerLog,
  onDeleteBiomarkerLog,
  onDeleteBiomarkerFromLog,
  onDeleteBiomarker,
  onOpenAiReview,
  onCombineBiomarker,
  onApplyCalculation,
  hasPendingAlert,
  onDismissAlert,
  hideSensitive,
  onEditBiomarkerDef,
  onFlagNotUsedLocal,
}) => {
  const t = translations[language || "en"] || translations.en;
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isEditingDef, setIsEditingDef] = useState(false);
  const [editDefRange, setEditDefRange] = useState('');
  const [editDefUnit, setEditDefUnit] = useState('');
  const [editDate, setEditDate] = useState<string>('');

  const rawActiveLogsForBio = React.useMemo(() => {
    return biomarkerHistory.filter(h => {
      if (!h || h.sync_state === 'delete') return false;
      if (profile?.deletedBiomarkerLogIds?.[h.id] && (profile?.deletedBiomarkerLogIds?.[h.id] || 0) >= (h.updated_at || 0)) return false;
      return h.biomarkers && h.biomarkers[def.key] !== undefined;
    });
  }, [biomarkerHistory, def.key, profile?.deletedBiomarkerLogIds]);

  const historyData = React.useMemo(() => {
    const rawFiltered = rawActiveLogsForBio;

    const seenLogIds = new Set<string>();
    const seenDateValues = new Set<string>();
    const result: Array<{
      date: string;
      value: number;
      originalVal: number | string;
      unit: string;
      logId: string;
    }> = [];

    const sortedRaw = [...rawFiltered].sort((a, b) => {
      const dateCmp = toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date));
      if (dateCmp !== 0) return dateCmp;
      return (b.updated_at || 0) - (a.updated_at || 0);
    });

    for (const h of sortedRaw) {
      if (seenLogIds.has(h.id)) continue;
      seenLogIds.add(h.id);

      let rawVal = h.biomarkers[def.key];
      let val = typeof rawVal === 'string' ? parseFloat(rawVal) : Number(rawVal);
      let dispUnit = def.unit || '';

      if (profile?.unitPreference === 'US' && !isNaN(val)) {
        const reversed = reverseStandardizeUnit(def.key, val, dispUnit);
        dispUnit = reversed.newUnit || dispUnit;
        val = Number(reversed.newValue);
      }

      const dedupeKey = `${h.date}_${val}_${dispUnit}`;
      if (seenDateValues.has(dedupeKey)) continue;
      seenDateValues.add(dedupeKey);

      result.push({
        date: h.date,
        value: val,
        originalVal: rawVal,
        unit: dispUnit,
        logId: h.id
      });
    }

    return result.sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date)));
  }, [biomarkerHistory, def.key, def.unit, profile?.deletedBiomarkerLogIds, profile?.unitPreference]);

  const [isMoreDetailsExpanded, setIsMoreDetailsExpanded] = useState(false);

  const description = def.descriptions[profile.language as keyof typeof def.descriptions] || def.descriptions.en;
  const agentCalibration = React.useMemo(() => getAgentCalibration(def.key), [def.key]);

  // Derive optimal value target range for expanded view
  const optimalTargetValue = React.useMemo(() => {
    const customOpt = profile?.customBiomarkers?.[def.key]?.optimalValue;
    if (customOpt && customOpt.trim()) return customOpt.trim();
    if (agentCalibration) {
      const formatted = formatOptimalTargetValue(agentCalibration);
      if (formatted) return formatted;
    }
    if (agentCalibration?.profileAdjustedNormalRange) {
      return agentCalibration.profileAdjustedNormalRange;
    }
    return def.normalRange || 'Optimal range pending evaluation';
  }, [agentCalibration, def.normalRange, profile?.customBiomarkers, def.key]);

  const rangeSourceInfo = React.useMemo(() => {
    const rawLatestLog = biomarkerHistory
      .filter(h => h.biomarkers[def.key] !== undefined)
      .sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date)))
      .slice(-1)[0];
    return getBiomarkerRangeSourceInfo(def.key, def, profile, rawLatestLog, agentCalibration);
  }, [def.key, def, profile, biomarkerHistory, agentCalibration]);

  const latestLog = historyData[historyData.length - 1];
  const val = latestLog ? latestLog.originalVal : biomarkers[def.key];
  const status = val !== undefined ? getBiomarkerStatus(def.key, val, def.normalRange, def, profile) : 'unknown';

  const insightText = def.benefitRisk || agentCalibration?.specificRiskContext || generateDynamicInsight(def, profile, val, status);

  let normalMin: number | undefined;
  let normalMax: number | undefined;

  if (def.normalRange && def.normalRange !== 'Unknown' && def.normalRange !== 'Negative') {
    const parts = def.normalRange.replace(/[^0-9.-]/g, ' ').trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      if (!isNaN(parseFloat(parts[0]))) normalMin = parseFloat(parts[0]);
      if (!isNaN(parseFloat(parts[1]))) normalMax = parseFloat(parts[1]);
    } else if (parts.length === 1 && !isNaN(parseFloat(parts[0]))) {
      if (def.normalRange.includes('<') || def.normalRange.includes('under')) {
        normalMax = parseFloat(parts[0]);
      } else if (def.normalRange.includes('>') || def.normalRange.includes('over')) {
        normalMin = parseFloat(parts[0]);
      }
    }
  }

  const toInputDateFormat = (d: string) => {
    const pts = d.split('-');
    if (pts.length === 3) {
      if (pts[0].length === 4) return d; // already yyyy-mm-dd
      return `${pts[2]}-${pts[1]}-${pts[0]}`; // dd-mm-yyyy -> yyyy-mm-dd
    }
    return d;
  };

  const fromInputDateFormat = (d: string) => {
    const pts = d.split('-');
    if (pts.length === 3) {
      if (pts[2].length === 4) return d; // already dd-mm-yyyy
      return `${pts[2]}-${pts[1]}-${pts[0]}`; // yyyy-mm-dd -> dd-mm-yyyy
    }
    return d;
  };

  const handleSaveEdit = (logId: string) => {
    if (editValue && !isNaN(Number(editValue))) {
      const log = biomarkerHistory.find(h => h.id === logId);
      if (log && onEditBiomarkerLog) {
        const finalDate = editDate ? fromInputDateFormat(editDate) : log.date;
        let valueToSave: string | number = Number(editValue);
        
        if (profile.unitPreference === 'US') {
          // If preference is US, the user entered a US value. Convert it to standard (SI) before saving
          // We can use the imported standardizeUnit
          
          const conv = CONVERSION_FACTORS[def.key.toLowerCase()];
          if (conv) {
             
             const res = standardizeUnit(def.key, valueToSave, conv.from);
             valueToSave = res.newValue;
          }
        }
        
        onEditBiomarkerLog(logId, def.key, valueToSave, finalDate);
      }
    }
    setEditingLogId(null);
  };

  return (
    <div className="p-4 bg-slate-50 dark:bg-slate-800/40 border-t border-theme-border/60 text-sm space-y-4">
      {status === 'flagged' && (
        <div className="p-3 bg-purple-500/10 border border-purple-500/30 rounded-xl text-purple-900 dark:text-purple-200 text-xs flex items-center gap-2">
          <BrainCircuit className="w-4 h-4 text-purple-600 dark:text-purple-400 shrink-0" />
          <div>
            <p className="font-bold">⚠️ Flagged: Improbable Biomarker Value ({val} {def.unit})</p>
            <p className="text-[11px] opacity-90">This recorded value is outside expected physiological bounds for {def.name} (normal range: {def.normalRange}). Please review or update your entry in your history log below.</p>
          </div>
        </div>
      )}
      {/* Medical Insight block directly shown at the top of the expanded card */}
      <div className="p-4 bg-indigo-50/30 dark:bg-indigo-950/10 border border-indigo-100/50 dark:border-indigo-900/30 rounded-2xl">
        <div className="flex items-center gap-1.5 mb-2 text-indigo-600 dark:text-indigo-400 font-bold text-xs uppercase tracking-wider">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          <span>{t.medicalInsightLabel}</span>
        </div>
        <p className="text-slate-700 dark:text-slate-200 text-sm leading-relaxed font-medium">
          {insightText}
        </p>
      </div>

      {/* Optimal Target Value Card */}
      <div className="p-3.5 bg-emerald-50/70 dark:bg-emerald-950/20 border border-emerald-200/80 dark:border-emerald-800/50 rounded-2xl flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-500/15 dark:bg-emerald-500/20 rounded-xl text-emerald-600 dark:text-emerald-400 font-bold shrink-0">
            🎯
          </div>
          <div>
            <span className="block text-[10px] font-bold text-emerald-800/80 dark:text-emerald-300/80 uppercase tracking-wider">
              Optimal Target Value
            </span>
            <span className="text-xs font-extrabold text-emerald-950 dark:text-emerald-100 font-mono">
              {optimalTargetValue} {def.unit ? `(${def.unit})` : ''}
            </span>
          </div>
        </div>
        {val !== undefined && (
          <div className="text-right">
            <span className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider">Latest Value</span>
            <span className="text-xs font-bold font-mono text-slate-700 dark:text-slate-200">
              {val} {def.unit || ''}
            </span>
          </div>
        )}
      </div>

      {/* Reference Range & Source Attribution Card (B7.6) */}
      <div className="p-3.5 bg-slate-100/70 dark:bg-slate-900/50 border border-slate-200/80 dark:border-slate-800 rounded-2xl flex flex-wrap items-center justify-between gap-2 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-500/10 dark:bg-indigo-500/20 rounded-xl text-indigo-600 dark:text-indigo-400 font-bold shrink-0">
            📊
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Clinical Reference Range
              </span>
              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${rangeSourceInfo.badgeClass}`}>
                {rangeSourceInfo.sourceLabel}
              </span>
            </div>
            <span className="text-xs font-extrabold text-slate-900 dark:text-slate-100 font-mono">
              {rangeSourceInfo.sourceRange || def.normalRange || 'Standard'} {def.unit ? `(${def.unit})` : ''}
            </span>
          </div>
        </div>
      </div>

      {/* Clinical Risk Tags */
      ((def.riskCategories && def.riskCategories.length > 0) || (def.potentialMedicalConditions && def.potentialMedicalConditions.length > 0)) && (
        <div className="flex flex-wrap gap-1.5 px-1 py-0.5 mt-2">
          {def.riskCategories && def.riskCategories.length > 0 && def.riskCategories.map((catName: string, i: number) => (
            <span key={`risk-${i}`} className="px-1.5 py-0.5 text-[9px] font-bold bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 rounded-md border border-rose-100/60 dark:border-rose-900/40 whitespace-nowrap">
              {catName}
            </span>
          ))}
          {def.potentialMedicalConditions && def.potentialMedicalConditions.length > 0 && def.potentialMedicalConditions.map((cond: string, i: number) => (
            <span key={`cond-${i}`} className="px-1.5 py-0.5 text-[9px] font-bold bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 rounded-md border border-amber-100/60 dark:border-amber-900/40 whitespace-nowrap">
              {cond}
            </span>
          ))}
        </div>
      )}

      {/* Collapsible More Details Accordion */}
      <div className="border border-slate-200/60 dark:border-slate-800/60 rounded-xl overflow-hidden bg-theme-bg-card">
        <button
          onClick={() => setIsMoreDetailsExpanded(!isMoreDetailsExpanded)}
          className="w-full flex items-center justify-between p-3 bg-slate-50/50 dark:bg-slate-900/40 hover:bg-slate-100/50 dark:hover:bg-slate-850/45 cursor-pointer select-none transition-colors"
        >
          <span className="text-xs font-bold text-theme-neutral">
            More Details
          </span>
          <span className="text-slate-400">
            {isMoreDetailsExpanded ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="18 15 12 9 6 15"/></svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
            )}
          </span>
        </button>

        {isMoreDetailsExpanded && (
          <div className="p-4 border-t border-theme-border/40 space-y-4">
            {/* Description */}
            {description && (
              <div>
                <span className="block text-[10px] font-bold text-slate-450 uppercase tracking-wider mb-1">{t.descriptionLabel}</span>
                <p className="text-theme-text-secondary text-xs leading-relaxed font-medium font-sans">
                  {description}
                </p>
              </div>
            )}

            {/* Range / Calibration from Panel */}
            <div>
              <BiomarkerCalculationPanel
                biomarkerKey={def.key}
                profile={profile}
                currentValue={biomarkers[def.key]}
                baseDescription=""
                onApplyRecommendations={onApplyCalculation}
                hasPendingAlert={hasPendingAlert}
                onDismissAlert={onDismissAlert}
                onEditBiomarkerDef={onEditBiomarkerDef}
              />
            </div>



            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-theme-border/40">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenAiReview(def.key);
                }}
                className="flex-1 flex items-center justify-center gap-2 py-2 px-3 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400 font-bold text-xs rounded-xl border border-indigo-100 dark:border-indigo-800/50 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors cursor-pointer"
              >
                <BrainCircuit className="w-4 h-4" />
                Review with AI
              </button>
              {onCombineBiomarker && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCombineBiomarker(def.key);
                  }}
                  className="flex-1 flex items-center justify-center gap-2 py-2 px-3 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400 font-bold text-xs rounded-xl border border-indigo-100 dark:border-indigo-800/50 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors cursor-pointer"
                >
                  <svg className="w-4 h-4 text-indigo-600 dark:text-indigo-400" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15"></path>
                  </svg>
                  Combine
                </button>
              )}
              {onDeleteBiomarker && !showDeleteConfirm && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowDeleteConfirm(true);
                  }}
                  className="flex-1 flex items-center justify-center gap-2 py-2 px-3 bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-400 font-bold text-xs rounded-xl border border-rose-100 dark:border-rose-800/50 hover:bg-rose-100 dark:hover:bg-rose-900/40 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete
                </button>
              )}
              {onDeleteBiomarker && showDeleteConfirm && (
                <div className="flex-1 flex gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteBiomarker(def.key);
                      setShowDeleteConfirm(false);
                    }}
                    className="flex-1 py-2 px-3 bg-rose-600 text-white font-bold text-xs rounded-xl hover:bg-rose-700 transition-colors cursor-pointer"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowDeleteConfirm(false);
                    }}
                    className="flex-1 py-2 px-3 bg-slate-100 dark:bg-slate-800 text-theme-neutral font-bold text-xs rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {historyData.length > 1 && (
        <div className="mb-4">
          <h4 className="text-xs font-bold text-slate-500 mb-2 flex items-center gap-1.5 uppercase tracking-wider">
            <LineChartIcon className="w-3.5 h-3.5" /> Trend
          </h4>
          <div className="h-32 w-full bg-theme-bg-card rounded-xl p-2 border border-slate-200 dark:border-slate-750">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={historyData}>
                <XAxis dataKey="date" hide />
                <YAxis domain={['auto', 'auto']} hide />
                <Tooltip 
                  contentStyle={{ borderRadius: '8px', fontSize: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  labelStyle={{ fontWeight: 'bold', color: 'var(--color-slate-500)' }}
                />
                {normalMax !== undefined && <ReferenceLine y={normalMax} stroke="var(--color-rose-500)" strokeDasharray="3 3" />}
                {normalMin !== undefined && <ReferenceLine y={normalMin} stroke="var(--color-rose-500)" strokeDasharray="3 3" />}
                <Line type="monotone" dataKey="value" stroke="var(--color-indigo-600)" strokeWidth={2} dot={{ r: 4, fill: 'var(--color-indigo-600)' }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {historyData.length > 0 && (
        <div className="flex flex-col max-h-[300px]">
          {rawActiveLogsForBio.length > historyData.length && (
            <div className="mb-3 p-3 bg-amber-50 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800 rounded-xl flex items-center justify-between gap-3 shadow-2xs">
              <div className="flex items-center gap-2.5 text-xs text-amber-900 dark:text-amber-200 font-medium">
                <span className="p-1.5 bg-amber-200/80 dark:bg-amber-900/80 text-amber-900 dark:text-amber-200 rounded-lg text-sm shrink-0">⚠️</span>
                <div>
                  <div className="font-bold">{rawActiveLogsForBio.length - historyData.length} Duplicate Log{rawActiveLogsForBio.length - historyData.length > 1 ? 's' : ''} in Database</div>
                  <div className="text-[11px] text-amber-800/90 dark:text-amber-300/80">{rawActiveLogsForBio.length} total entries exist on same dates.</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onOpenAiReview(def.key)}
                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold shrink-0 transition-colors cursor-pointer shadow-xs"
              >
                Review & Delete
              </button>
            </div>
          )}
          <div className="flex items-center justify-between mb-2 shrink-0">
            <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t.historicalLogsLabel}</h4>
          </div>
          <div className="space-y-2 overflow-y-auto flex-1 pr-1 pb-1">
            {historyData.slice().reverse().map(h => {
              const fullLog = biomarkerHistory.find(log => log.id === h.logId);
              const testDetail = fullLog?.tests?.find(t => t.key === def.key);
              
              return (
                <div key={h.logId} className="flex flex-col bg-theme-bg-card px-3 py-2 rounded-lg border border-theme-border space-y-1.5">
                  <div className="flex items-center justify-between">
                    {editingLogId === h.logId ? (
                      <input 
                        type="date" 
                        value={editDate}
                        onChange={(e) => setEditDate(e.target.value)}
                        className="form-input-styled text-xs font-mono w-28 text-slate-800 dark:text-slate-100"
                      />
                    ) : (
                      <span className="text-xs font-mono font-semibold text-slate-700 dark:text-slate-300">{h.date}</span>
                    )}
                    <div className="flex items-center gap-3">
                      {editingLogId === h.logId ? (
                        <div className="flex items-center gap-2">
                          <input 
                            type="number" 
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            className="form-input-styled w-16 text-xs text-slate-800 dark:text-slate-100"
                          />
                          <button onClick={() => handleSaveEdit(h.logId)} className="text-indigo-600 font-bold text-xs cursor-pointer">{t.save}</button>
                          <button onClick={() => setEditingLogId(null)} className="text-slate-400 font-bold text-xs cursor-pointer">{t.cancel}</button>
                        </div>
                      ) : (
                        <>
                          <span className="text-sm font-bold text-slate-800 dark:text-slate-200">{hideSensitive ? '***' : h.value} {h.unit}</span>
                          <button 
                            onClick={(e) => { 
                              e.stopPropagation(); 
                              setEditValue(String(h.originalVal)); 
                              setEditDate(toInputDateFormat(h.date));
                              setEditingLogId(h.logId); 
                            }}
                            className="text-indigo-400 hover:text-indigo-600 cursor-pointer"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
                          </button>
                          {(onDeleteBiomarkerFromLog || onDeleteBiomarkerLog) && (
                            <button 
                              onClick={(e) => { 
                                e.stopPropagation(); 
                                if (onDeleteBiomarkerFromLog) {
                                  onDeleteBiomarkerFromLog(h.logId, def.key);
                                } else if (onDeleteBiomarkerLog) {
                                  onDeleteBiomarkerLog(h.logId);
                                }
                              }}
                              className="text-slate-400 hover:text-rose-500 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  
                  {/* Additional extracted test fields if present */}
                  {testDetail && (
                    <div className="text-[10px] space-y-1 text-theme-text-secondary pt-1 border-t border-theme-border/40">
                      {testDetail.originalTestName && testDetail.originalTestName !== def.name && (
                        <div>
                          <span className="font-medium">{t.originalNameLabel}</span> <span className="italic">{testDetail.originalTestName}</span>
                        </div>
                      )}
                      {testDetail.normalRange && (
                        <div>
                          <span className="font-medium">{t.extractedRangeLabel}</span> <span className="font-mono">{testDetail.normalRange}</span>
                        </div>
                      )}
                      {testDetail.doctorComment && (
                        <div className="bg-indigo-50/40 dark:bg-indigo-950/20 text-indigo-600 dark:text-indigo-400 p-1.5 rounded border border-indigo-100/30 mt-1 leading-relaxed">
                          <span className="font-bold uppercase text-[8px] tracking-wider block mb-0.5">{t.doctorLabCommentLabel}</span>
                          {testDetail.doctorComment}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {onFlagNotUsedLocal && (
        <div className="pt-3 mt-1 border-t border-theme-border/40 flex justify-end">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onFlagNotUsedLocal(def.key);
            }}
            className="text-[10px] font-semibold text-slate-400 hover:text-rose-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded px-1.5 py-1 cursor-pointer transition-colors"
            title="Hide from Medical History"
          >
            Not used
          </button>
        </div>
      )}
    </div>
  );
};
