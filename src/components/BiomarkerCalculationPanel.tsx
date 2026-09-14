import React, { useState } from 'react';
import { UserProfile } from '../types';
import { Calculator, Check, Shield, ChevronDown, ChevronUp } from 'lucide-react';
import { isAsianEthnicity, getBmiThresholds, getIdealBmiTarget } from '../utils/biomarkers';
import { evaluateRangeBracketMatch } from '../utils/agentCalibration';
import { calculateMifflinStJeor } from '../utils/clinicalCalculators';

interface BiomarkerCalculationPanelProps {
  language?: string;
  biomarkerKey: string;
  profile: UserProfile;
  currentValue?: number | string;
  onApplyRecommendations?: (updates: {
    targetCalories?: number;
    targetWeight?: number;
    addedBenefit?: string;
    descriptionExplain?: string;
  }) => void;
  hasPendingAlert?: boolean;
  onDismissAlert?: () => void;
  onEditBiomarkerDef?: (key: string, normalRange: string, unit: string) => void;
}

const getBmiPercentage = (bmi: number, normalMax: number, overweightMax: number): number => {
  if (bmi < 18.5) {
    const ratio = (bmi - 10) / (18.5 - 10);
    return Math.min(35, Math.max(5, 5 + ratio * 30));
  } else if (bmi <= normalMax) {
    const ratio = (bmi - 18.5) / (normalMax - 18.5);
    return 35 + ratio * 30;
  } else if (bmi <= overweightMax) {
    const ratio = (bmi - normalMax) / (overweightMax - normalMax);
    return 65 + ratio * 15;
  } else {
    const ratio = (bmi - overweightMax) / (35 - overweightMax);
    return Math.min(95, 80 + ratio * 15);
  }
};

import { getAgentCalibration } from '../utils/agentCalibration';
import { translations } from '../utils/translations';
import { displayEthnicityOption, displayStatusLabel, interpolate } from '../utils/i18n';

export default function BiomarkerCalculationPanel({
  biomarkerKey,
  profile,
  currentValue,
  onApplyRecommendations,
  hasPendingAlert,
  onDismissAlert,
  onEditBiomarkerDef,
  baseDescription,
  language,
}: BiomarkerCalculationPanelProps & { baseDescription?: string }) {
  const t = translations[language || "en"] || translations.en;
  const lang = language || "en";
  const isBmi = biomarkerKey === 'bmi';

  // Profile fields with defaults
  const weight = profile.weight || 70;
  const height = profile.height || 170;
  const age = profile.age || 30;
  const gender = (profile.gender || 'male').toLowerCase();
  const ethnicity = (profile.ethnicity || '').toLowerCase();

  const isAsianUser = isAsianEthnicity(ethnicity);
  const [isDetailsExpanded, setIsDetailsExpanded] = useState(!!hasPendingAlert);
  const [applied, setApplied] = useState(false);
  const [isEditingRange, setIsEditingRange] = useState(false);
  const [editRangeValue, setEditRangeValue] = useState(profile.customBiomarkers?.[biomarkerKey]?.normalRange || '');

  const agentCalibration = React.useMemo(() => {
    return getAgentCalibration(biomarkerKey);
  }, [biomarkerKey]);

  // Auto-expand show logic if alert is active
  React.useEffect(() => {
    if (hasPendingAlert) {
      setIsDetailsExpanded(true);
    }
  }, [hasPendingAlert]);

  // 1. Calculations for BMI via unified Clinical Calculator Engine
  const currentBmiNum = typeof currentValue === 'number' 
    ? currentValue 
    : typeof currentValue === 'string' 
      ? parseFloat(currentValue) 
      : weight / Math.pow(height / 100, 2);

  const roundedBmi = Math.round(currentBmiNum * 10) / 10;

  const isMale = gender.startsWith('m');
  const genderDisplay = isMale ? t.male : (gender.startsWith('f') || gender.startsWith('w')) ? t.female : (profile.gender || t.notSet);
  const mifflinResult = calculateMifflinStJeor(profile, { weight, height, age, gender, ethnicity });
  const { normalMax, overweightMax, targetBmi, targetWeight, estimatedCalories, bmr: bmrBase } = mifflinResult.values as any;
  const limits = { underweight: 18.5, normal: normalMax, overweight: overweightMax, obese: overweightMax };

  const diagnostic = mifflinResult.diagnosticSummary || '';
  const diagnosticColor = mifflinResult.statusColor || 'text-emerald-500';

  const handleApply = () => {
    if (onApplyRecommendations) {
      const descriptionExplain = interpolate(t.targetCaloriesMifflinExplain, {
        bmr: bmrBase,
        targetWeight,
        targetBmi,
        standard: isAsianUser ? t.asianStandard : t.globalStandard,
      });
      onApplyRecommendations({
        targetCalories: estimatedCalories,
        targetWeight,
        addedBenefit: t.walking30MinADay,
        descriptionExplain,
      });
      setApplied(true);
      if (onDismissAlert) {
        onDismissAlert();
      }
      setTimeout(() => setApplied(false), 3000);
    }
  };

  const handleKeepAsIs = () => {
    if (onDismissAlert) {
      onDismissAlert();
    }
  };

  // If not BMI, we show a clean generic customizable calculation details panel
  if (!isBmi) {
    return (
      <div className="mt-4 p-4 bg-slate-50 dark:bg-slate-900/40 border border-slate-150 dark:border-slate-800 rounded-2xl space-y-3">
        <div>
            {agentCalibration ? (
              <div className="space-y-3 text-left">
                {/* Calibrated Range Brackets */}
                {agentCalibration.rangeBrackets && agentCalibration.rangeBrackets.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <span className="block text-[8.5px] text-slate-400 font-bold uppercase tracking-wider">
                      {t.referenceRangeThresholds}{agentCalibration.specificRiskContext?.toLowerCase().includes('asian') ? t.adjustedForAsianPopulation : ''}
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {agentCalibration.rangeBrackets.map((br: any, brIdx: number) => {
                        const { isMatched, isOptimal, colorScheme } = evaluateRangeBracketMatch(br, currentValue, agentCalibration.status, agentCalibration.rangeBrackets);
                        
                        let bgClass = 'bg-slate-50 dark:bg-slate-900/40 border-theme-border/60 text-slate-400 opacity-70';
                        if (isMatched) {
                          if (colorScheme === 'emerald') {
                            bgClass = 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-400 dark:border-emerald-600 text-emerald-800 dark:text-emerald-200 font-bold ring-2 ring-emerald-500/30';
                          } else if (colorScheme === 'rose') {
                            bgClass = 'bg-rose-50 dark:bg-rose-950/40 border-rose-400 dark:border-rose-600 text-rose-800 dark:text-rose-200 font-bold ring-2 ring-rose-500/30';
                          } else if (colorScheme === 'amber') {
                            bgClass = 'bg-amber-50 dark:bg-amber-950/40 border-amber-400 dark:border-amber-600 text-amber-800 dark:text-amber-200 font-bold ring-2 ring-amber-500/30';
                          }
                        } else if (isOptimal) {
                          bgClass = 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200/30 text-emerald-600/80 dark:text-emerald-400/80';
                        }
                        
                        return (
                          <div key={brIdx} className={`p-1.5 rounded-lg border text-center transition-all ${bgClass}`}>
                            <span className="block text-[8px] font-bold uppercase opacity-90 truncate" title={br.name}>
                              {isOptimal ? '🎯 ' : ''}{br.name}{isMatched ? ' ✓' : ''}
                            </span>
                            <span className="font-mono font-bold text-[10px]">{br.range}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                
                <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-normal pt-1 border-t border-theme-border/60">
                  {interpolate(t.usesCalibratedRanges, { range: agentCalibration.profileAdjustedNormalRange })}
                </p>
              </div>
            ) : (
          <div className="text-[11px] text-theme-text-secondary leading-relaxed">
            <p className="mb-1">{t.staticReferenceDesc}</p>
            {isEditingRange ? (
              <div className="flex items-center gap-2 mt-2">
                <input 
                  type="text" 
                  value={editRangeValue} 
                  onChange={(e) => setEditRangeValue(e.target.value)}
                  placeholder={t.rangeExamplePlaceholder}
                  className="form-input-styled text-xs font-mono py-1 px-2 w-48"
                />
                <button 
                  onClick={() => {
                    if (onEditBiomarkerDef) {
                      onEditBiomarkerDef(biomarkerKey, editRangeValue, profile.customBiomarkers?.[biomarkerKey]?.unit || '');
                    }
                    setIsEditingRange(false);
                  }}
                  className="px-2 py-1 bg-indigo-600 text-white rounded text-[10px] font-bold"
                >
                  {t.save}
                </button>
                <button 
                  onClick={() => setIsEditingRange(false)}
                  className="px-2 py-1 bg-slate-200 dark:bg-slate-700 text-theme-text-secondary rounded text-[10px] font-bold"
                >
                  {t.cancel}
                </button>
              </div>
            ) : (
              <p className="flex items-center gap-2 mt-1">
                {t.customNormalRangeLabel}{' '}
                <strong className="text-theme-neutral font-mono">{profile.customBiomarkers?.[biomarkerKey]?.normalRange || t.standardReference}</strong>
                {onEditBiomarkerDef && (
                  <button 
                    onClick={() => {
                      setEditRangeValue(profile.customBiomarkers?.[biomarkerKey]?.normalRange || '');
                      setIsEditingRange(true);
                    }}
                    className="text-indigo-500 hover:text-indigo-600 dark:hover:text-indigo-400 text-[10px] font-bold uppercase tracking-wider"
                  >
                    {t.edit}
                  </button>
                )}
              </p>
            )}
          </div>
        )}
        </div>

        {isDetailsExpanded && (
          <div className="mt-3 pt-3 border-t border-slate-200/50 dark:border-slate-800/50 space-y-2 text-[11px] text-theme-text-secondary font-mono leading-relaxed">
            <p>{t.biomarkerKeyLabel} <span className="text-theme-neutral">{biomarkerKey}</span></p>
            {agentCalibration ? (
              <>
                <p>{t.calibrationSourceAI}</p>
                <p>{t.diagnosticRuleStrategy}</p>
              </>
            ) : (
              <>
                <p>{t.ruleStrategyStandard}</p>
                <p className="text-[10px] text-slate-400 font-sans leading-normal pt-1">
                  {t.clinicalResearchersCustomize}
                </p>
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  const currentPercent = Math.min(95, Math.max(5, getBmiPercentage(roundedBmi, normalMax, overweightMax)));
  const targetPercent = Math.min(95, Math.max(5, getBmiPercentage(targetBmi, normalMax, overweightMax)));
  const targetIsLeft = targetPercent < currentPercent;

  return (
    <div className="mt-4 bg-slate-50 dark:bg-slate-900/40 border border-slate-150 dark:border-slate-800 rounded-2xl p-4 space-y-4 font-sans">
      {/* Visual Slider Gauge - "The only thing to be visible is the 'diagnostic range (BMI)'" */}
      <div className="space-y-2 pt-10">
        <div className="relative h-6 bg-slate-100 dark:bg-slate-950 rounded-full flex font-mono text-[9px] font-bold text-white text-center">
          <div className="h-full bg-sky-500/85 flex items-center justify-center rounded-l-full" style={{ width: '35%' }}>
            &lt;18.5
          </div>
          <div className="h-full bg-emerald-500/85 flex items-center justify-center border-l border-white/20" style={{ width: isAsianUser ? '20%' : '30%' }}>
            {t.normal}
          </div>
          <div className="h-full bg-amber-500/85 flex items-center justify-center border-l border-white/20" style={{ width: isAsianUser ? '15%' : '15%' }}>
            {t.statusOverweight}
          </div>
          <div className="h-full bg-rose-500/85 flex items-center justify-center border-l border-white/20 rounded-r-full" style={{ width: isAsianUser ? '30%' : '20%' }}>
            {t.statusObese}
          </div>

          {/* Current Weight dotted line and label (left aligned if on right, right aligned if on left) */}
          <div
            className="absolute -top-7 bottom-0 w-0.5 border-l-2 border-dotted border-indigo-500 dark:border-indigo-400 z-20"
            style={{ left: `${currentPercent}%` }}
          >
            <div className={`absolute top-0 bg-indigo-600/95 dark:bg-indigo-500/95 text-white text-[8px] px-1.5 py-0.5 rounded-md font-sans font-black whitespace-nowrap shadow-md ${targetIsLeft ? 'left-1.5 text-left' : 'right-1.5 text-right'}`}>
              {interpolate(t.currentWeightKg, { weight })}
            </div>
          </div>

          {/* Target Weight dotted line and label (right aligned if on left, left aligned if on right) */}
          <div
            className="absolute -top-7 bottom-0 w-0.5 border-l-2 border-dotted border-indigo-500 dark:border-indigo-400 z-20"
            style={{ left: `${targetPercent}%` }}
          >
            <div className={`absolute top-0 bg-indigo-600/95 dark:bg-indigo-500/95 text-white text-[8px] px-1.5 py-0.5 rounded-md font-sans font-black whitespace-nowrap shadow-md ${targetIsLeft ? 'right-1.5 text-right' : 'left-1.5 text-left'}`}>
              {interpolate(t.targetWeightKg, { weight: targetWeight })}
            </div>
          </div>
        </div>
      </div>

      {/* Show Logic Button */}
      <div className="flex justify-end pt-1">
        <button
          onClick={() => setIsDetailsExpanded(!isDetailsExpanded)}
          className="text-indigo-600 dark:text-indigo-400 hover:underline text-[11px] flex items-center gap-0.5 font-semibold cursor-pointer"
        >
          <span>{isDetailsExpanded ? t.hideLogicDetails : t.showLogicDetails}</span>
          {isDetailsExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
      </div>

      {/* Collapsible Container containing plain-text calculations, action buttons, and disclaimer */}
      {isDetailsExpanded && (
        <div className="space-y-4 animation-fade-in">
          {/* AI Calibrated Insights for BMI if available */}
          {agentCalibration && (
            <div className="space-y-2 text-[11px]">
              {agentCalibration.specificRiskContext && (
                <div className="text-theme-text font-medium leading-relaxed bg-white dark:bg-slate-950 p-3 rounded-xl border border-slate-150 dark:border-slate-800">
                  {agentCalibration.specificRiskContext}
                </div>
              )}
              <p className="text-theme-text font-medium leading-relaxed bg-white dark:bg-slate-950 p-3 rounded-xl border border-slate-150 dark:border-slate-800">
                {agentCalibration.description}
              </p>
            </div>
          )}

          {/* Warning Banner if there is a pending profile update */}
          {hasPendingAlert && (
            <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-150 dark:border-amber-900/30 rounded-xl text-xs font-semibold text-amber-800 dark:text-amber-400">
              {t.profileChangedApplyRecs}
            </div>
          )}

          <div className="p-3.5 bg-white dark:bg-slate-950 border border-slate-150 dark:border-slate-800 rounded-xl space-y-3 text-xs font-mono leading-relaxed text-theme-text-secondary">
            <div className="space-y-1.5 border-b border-theme-border pb-2.5">
              <span className="block text-[10px] font-extrabold uppercase text-slate-400 font-sans">{t.plainLogicCalculations}</span>
              <p>{t.matchedProfileEthnicity} <span className="text-slate-800 dark:text-white font-semibold">{displayEthnicityOption(lang, profile.ethnicity) || t.notSet}</span></p>
              <p>{t.matchedProfileGender} <span className="text-slate-800 dark:text-white font-semibold">{genderDisplay}</span></p>
              <p>{t.activeDiagnosticStandard} <span className="text-slate-800 dark:text-white font-semibold">{interpolate(isAsianUser ? t.asianBracketDetail : t.globalBracketDetail, { normalMax, overweightMax })}</span></p>
              <p>{t.flaggedStatusProfile} <span className="text-amber-600 font-bold">{diagnostic === 'Missing height or weight in profile' ? t.missingHeightWeightProfile : displayStatusLabel(lang, diagnostic)}</span></p>
            </div>

            <div className="space-y-1">
              <span className="block text-[10px] font-extrabold uppercase text-slate-400 font-sans">{t.mifflinStJeorDetails}</span>
              <p>{interpolate(t.bmrEquationLine, { weight, height, age, yo: t.yearsOldAbbrev, genderAdj: isMale ? '+ 5' : '- 161' })}</p>
              <p>{interpolate(t.baseBmrLine, { bmr: bmrBase })}</p>
              <p>{interpolate(t.activeTdeeLine, { tdee: Math.round(bmrBase * 1.375) })}</p>
              <p>{t.deficitCalorieTarget} <strong className="text-indigo-600 dark:text-indigo-400">{estimatedCalories} kcal / day</strong></p>
            </div>
          </div>

          {/* Action buttons (Apply/Keep As Is depending on alert status) */}
          {hasPendingAlert ? (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handleKeepAsIs}
                className="py-2.5 rounded-xl text-xs font-bold bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-750 text-theme-neutral transition-all cursor-pointer flex items-center justify-center gap-1.5"
              >
                {t.keepAsIs}
              </button>
              <button
                type="button"
                onClick={handleApply}
                className="py-2.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-md shadow-indigo-600/10"
              >
                <Check className="w-4 h-4" />
                <span>{t.applyRecommendations}</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleApply}
              className={`w-full py-2.5 rounded-xl text-xs font-bold shadow-md flex items-center justify-center gap-1.5 transition-all cursor-pointer ${applied ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/10' : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-600/10'}`}
            >
              {applied ? (
                <>
                  <Check className="w-4 h-4" />
                  <span>{t.appliedTargetGoals}</span>
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  <span>{t.applyRecommendedTargets}</span>
                </>
              )}
            </button>
          )}

          {/* Benefits checklist notes */}
          <div className="text-[10px] text-slate-400 dark:text-slate-500 flex items-center justify-center gap-1 pt-1 font-sans">
            <Shield className="w-3.5 h-3.5 text-emerald-500" />
            <span>{interpolate(t.applyAddsWalking, { activity: `"${t.walking30MinADay}"` })}</span>
          </div>
        </div>
      )}
    </div>
  );
}
