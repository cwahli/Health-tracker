import React, { useState, useRef } from 'react';
import { AgentCardProps } from './types';
import { ErrorBoundary } from '../ErrorBoundary';
import { AGENT_REGISTRY } from '../../utils/agentConfig';
import { CheckCircle, XCircle, Activity, Target, Calendar, Check, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { AgentThoughtBox, getNutrientColor } from './FoodCard';
import { isCoreNutrient, isAdditionalNutrient } from '../../utils/nutrients';
import { translations } from '../../utils/translations';
import { displayStatusLabel, interpolate } from '../../utils/i18n';

export const HealthBaselineCard: React.FC<AgentCardProps> = ({
  language, msg,
  onAgentFinish,
  setLoggedMessageIds,
  loggedMessageIds,
  onDeleteMessage
}) => {
  const t = translations[language || "en"] || translations.en;
  const initialReport = msg.data?.agentResult?.report || msg.data?.agentResult || {};
  const initialHasReport = Array.isArray(initialReport.riskCategories) && initialReport.riskCategories.length > 0;

  const [unselectedKeys, setUnselectedKeys] = useState<Set<number>>(new Set());
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [hasStarted, setHasStarted] = useState(initialHasReport);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  if (msg.agentType !== 'health_baseline') return null;

  const agentConfig = AGENT_REGISTRY[msg.agentType];
  const report = msg.data?.agentResult?.report || msg.data?.agentResult || {};

  const riskCategories = Array.isArray(report.riskCategories) ? report.riskCategories : [];
  const biomarkerTargets = Array.isArray(report.biomarkerTargets) ? report.biomarkerTargets : [];

  const rawTopTargets = Array.isArray(report.topNutrientTargets) ? report.topNutrientTargets : [];
  const rawTopWeekly = report.topWeeklyNutrientTargets || report.weeklyNutrientTargets || [];
  const categoryTargets = riskCategories.flatMap((cat: any) => Array.isArray(cat.nutrientTargets) ? cat.nutrientTargets : []);

  // Collect ALL recommended nutrient target items from agent
  const recommendedItems: any[] = [];
  const seenRecommendedKeys = new Set<string>();

  const processItem = (item: any) => {
    const rawKey = typeof item === 'string' ? item : (item?.nutrientKey || item?.key || '');
    if (!rawKey) return;
    const cleanKey = String(rawKey).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!cleanKey || seenRecommendedKeys.has(cleanKey)) return;
    seenRecommendedKeys.add(cleanKey);
    const val = typeof item === 'object' ? (item.targetValue || item.target || '') : (report.dailyNutrientTargets?.[rawKey] || '');
    const rat = typeof item === 'object' ? (item.rationale || item.reasoning || '') : '';
    recommendedItems.push({
      nutrientKey: rawKey,
      targetValue: val,
      rationale: rat
    });
  };

  if (Array.isArray(rawTopTargets)) rawTopTargets.forEach(processItem);
  if (Array.isArray(rawTopWeekly)) rawTopWeekly.forEach(processItem);
  else if (typeof rawTopWeekly === 'object' && rawTopWeekly !== null) {
    Object.entries(rawTopWeekly).forEach(([rawKey, val]) => {
      const valStr = typeof val === 'object' && val !== null ? (val as any).targetValue || (val as any).target || '' : String(val);
      const ratStr = typeof val === 'object' && val !== null ? (val as any).rationale || '' : '';
      processItem({ nutrientKey: rawKey, targetValue: valStr, rationale: ratStr });
    });
  }
  categoryTargets.forEach(processItem);

  // Split recommended targets strictly by Core vs Additional
  const topNutrientTargetsList = recommendedItems.filter(item => isCoreNutrient(item.nutrientKey));
  const topWeeklyNutrientTargetsList = recommendedItems.filter(item => isAdditionalNutrient(item.nutrientKey));

  // Collect Additional Nutrient Targets (remaining general baseline targets)
  const seenAdditionalKeys = new Set<string>();
  const additionalNutrientTargetsList: any[] = [];
  const generalTargetsObj = report.generalNutrientTargets || {};

  const addAdditionalTarget = (rawKey: string, valStr?: string, ratStr?: string) => {
    const cleanKey = String(rawKey).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!cleanKey || seenRecommendedKeys.has(cleanKey) || seenAdditionalKeys.has(cleanKey)) return;
    seenAdditionalKeys.add(cleanKey);
    additionalNutrientTargetsList.push({
      nutrientKey: rawKey,
      targetValue: valStr || '',
      rationale: ratStr || ''
    });
  };

  if (Array.isArray(generalTargetsObj)) {
    generalTargetsObj.forEach((item: any) => {
      const rawKey = typeof item === 'string' ? item : (item?.nutrientKey || item?.key || '');
      const val = typeof item === 'object' ? (item.targetValue || item.target || '') : String(item);
      const rat = typeof item === 'object' ? (item.rationale || item.reasoning || '') : '';
      addAdditionalTarget(rawKey, val, rat);
    });
  } else if (typeof generalTargetsObj === 'object' && generalTargetsObj !== null) {
    Object.entries(generalTargetsObj).forEach(([rawKey, val]) => {
      const valStr = typeof val === 'object' && val !== null ? (val as any).targetValue || (val as any).target || '' : String(val);
      const ratStr = typeof val === 'object' && val !== null ? (val as any).rationale || '' : '';
      addAdditionalTarget(rawKey, valStr, ratStr);
    });
  }

  if (report.dailyNutrientTargets) {
    Object.entries(report.dailyNutrientTargets).forEach(([rawKey, val]) => {
      addAdditionalTarget(rawKey, String(val), '');
    });
  }


  const dailyActivities = Array.isArray(report.dailyActivities) ? report.dailyActivities : [];
  const globalSummary = report.globalSummary || '';
  const scratchpad = report._internalReasoning || '';
  const timelineToOptimal = report.timelineToOptimal || '';

  let displayScratchpad = scratchpad;
  if (globalSummary) {
    const normSummary = globalSummary.trim();
    if (msg.content) {
      const idx = msg.content.indexOf(normSummary);
      if (idx !== -1) {
        msg.content = (msg.content.slice(0, idx) + msg.content.slice(idx + normSummary.length)).trim();
      } else {
        const lowerContent = msg.content.toLowerCase();
        const lowerSummary = normSummary.toLowerCase();
        const idxLower = lowerContent.indexOf(lowerSummary);
        if (idxLower !== -1) {
          msg.content = (msg.content.slice(0, idxLower) + msg.content.slice(idxLower + lowerSummary.length)).trim();
        }
      }
    }
    if (displayScratchpad) {
      const idx = displayScratchpad.indexOf(normSummary);
      if (idx !== -1) {
        displayScratchpad = (displayScratchpad.slice(0, idx) + displayScratchpad.slice(idx + normSummary.length)).trim();
      } else {
        const lowerScratch = displayScratchpad.toLowerCase();
        const lowerSummary = normSummary.toLowerCase();
        const idxLower = lowerScratch.indexOf(lowerSummary);
        if (idxLower !== -1) {
          displayScratchpad = (displayScratchpad.slice(0, idxLower) + displayScratchpad.slice(idxLower + lowerSummary.length)).trim();
        }
      }
    }
  }

  const isHandled = (loggedMessageIds || []).includes(msg.id);

  const scrollToCard = (index: number) => {
    const container = scrollContainerRef.current;
    if (container) {
      const children = container.children;
      if (children && children[index]) {
        (children[index] as HTMLElement).scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
          inline: 'center'
        });
        setCurrentCardIndex(index);
      }
    }
  };

  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const children = container.children;
    if (!children || children.length === 0) return;
    
    let closestIndex = 0;
    let minDistance = Infinity;
    const containerCenter = container.getBoundingClientRect().left + container.clientWidth / 2;
    
    for (let i = 0; i < children.length; i++) {
      const childRect = children[i].getBoundingClientRect();
      const childCenter = childRect.left + childRect.width / 2;
      const distance = Math.abs(containerCenter - childCenter);
      if (distance < minDistance) {
        minDistance = distance;
        closestIndex = i;
      }
    }
    setCurrentCardIndex(closestIndex);
  };

  const toggleSelection = (idx: number) => {
    setUnselectedKeys(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const handleApply = async (unselected: number[]) => {
    if (onAgentFinish) {
      if (msg.data && msg.data.agentResult) {
         msg.data.agentResult.unselectedRowKeys = unselected;
      }
      await onAgentFinish(msg.agentType!, msg.data?.agentResult);
      setLoggedMessageIds?.(prev => [...prev, msg.id]);
    }
  };

  const handleDismiss = () => {
    if (onDeleteMessage) {
      onDeleteMessage(msg.id);
    } else {
      setLoggedMessageIds?.(prev => [...prev, msg.id]);
    }
  };

  return (
    <ErrorBoundary>
        <div className="space-y-6">
          <div className="flex items-center space-x-2">
            <Activity className="w-5 h-5 text-indigo-500" />
            <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
              {agentConfig?.displayName || t.healthCoach}
            </h2>
          </div>
          
          {timelineToOptimal && (
            <div className="py-4 space-y-3">
              <div className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider flex items-center space-x-1.5">
                <Calendar className="w-4 h-4" />
                <span>{t.timelineToOptimal}</span>
              </div>
              <p className="text-sm text-slate-800 dark:text-slate-200 leading-relaxed font-medium">{timelineToOptimal}</p>
            </div>
          )}

          {displayScratchpad && (
            <AgentThoughtBox dietScratchpad={displayScratchpad} isLive={false} hasImage={false} />
          )}

          <div 
            ref={scrollContainerRef}
            onScroll={handleScroll}
            className="flex overflow-x-auto space-x-4 pb-4 snap-x snap-mandatory [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
          >
            {riskCategories.map((category: any, idx: number) => {
              const isSelected = !unselectedKeys.has(idx);
              const mappedBiomarkerTargets = Array.isArray(category.biomarkerTargets) ? category.biomarkerTargets : [];

              return (
                <div 
                  key={idx} 
                  className={`w-[75%] snap-center shrink-0 transition-all duration-200 ${
                    isSelected 
                      ? 'opacity-100' 
                      : 'opacity-40'
                  } ${idx !== riskCategories.length - 1 ? 'border-r border-slate-800 pr-4' : ''}`}
                >
                  <div className="py-3 flex justify-between items-center">
                    <div className="flex items-center space-x-3">
                      <div className="flex-shrink-0">
                        <div className={`w-2.5 h-2.5 rounded-full ${
                          category.level === 'high' ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]' :
                          category.level === 'medium' ? 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]' :
                          'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]'
                        }`} />
                      </div>
                      <div>
                        <h4 className="text-base font-semibold text-theme-text">
                          {category.categoryName}
                        </h4>
                        <div className="text-xs font-medium text-slate-500 capitalize">
                          {displayStatusLabel(language, category.level)}{t.riskStr}
                        </div>
                      </div>
                    </div>
                    {!isHandled && (
                      <button
                        onClick={() => toggleSelection(idx)}
                        className={`p-2 rounded-xl flex items-center space-x-1.5 transition-colors ${
                          isSelected 
                            ? 'text-emerald-600 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-400' 
                            : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        {isSelected ? (
                          <><CheckCircle className="w-4 h-4" /><span className="text-xs font-medium hidden sm:inline">{t.included}</span></>
                        ) : (
                          <><XCircle className="w-4 h-4" /><span className="text-xs font-medium hidden sm:inline">{t.excluded}</span></>
                        )}
                      </button>
                    )}
                  </div>

                  <div className="py-2 space-y-5">
                    <div className="space-y-2">
                      <div className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">{t.analysisStr}</div>
                      <p className="text-sm text-theme-neutral leading-relaxed">
                        {category.targetTrajectory || category.description || category.analysis}
                      </p>
                    </div>

                    {(category.nutrientTargets?.length > 0 || category.dailyActivities?.length > 0) && (
                      <div className="space-y-5">
                          {category.nutrientTargets?.length > 0 && (
                          <div className="space-y-3">
                              <div className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">{t.nutrientTargets}</div>
                              <div className="grid gap-2">
                                {category.nutrientTargets.map((nt: any, i: number) => (
                                  <div key={i} className="py-2 flex flex-col space-y-1">
                                    <div className="flex justify-between items-center">
                                      <span className="text-sm font-medium text-slate-800 dark:text-slate-200 capitalize">{nt.nutrientKey}</span>
                                      <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{nt.targetValue}</span>
                                    </div>
                                    {(nt.rationale || nt.reasoning) && <div className="text-xs text-slate-500 leading-relaxed">{nt.rationale || nt.reasoning}</div>}
                                  </div>
                                ))}
                              </div>
                          </div>
                          )}
                          {category.dailyActivities?.length > 0 && (
                          <div className="space-y-3">
                              <div className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">{t.dailyActivities}</div>
                              <ul className="space-y-2 list-disc list-inside text-sm text-theme-neutral">
                                {category.dailyActivities.map((da: any, i: number) => (
                                  <li key={i} className="py-1">
                                    <span className="font-medium text-slate-700 dark:text-slate-300">{da.activity}</span>
                                    {da.target && <span className="text-slate-500 ml-1">({da.target})</span>}
                                  </li>
                                ))}
                              </ul>
                          </div>
                          )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {riskCategories.length > 1 && (
            <div className="flex items-center justify-between py-2">
              <button
                type="button"
                onClick={() => scrollToCard(Math.max(0, currentCardIndex - 1))}
                disabled={currentCardIndex === 0}
                className="p-1.5 rounded-xl border border-theme-border bg-theme-bg-card text-theme-text-secondary disabled:opacity-30 disabled:pointer-events-none hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center justify-center shadow-sm"
                aria-label={t.previousCategory}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <div className="flex items-center space-x-3">
                <div className="flex space-x-1.5">
                  {riskCategories.map((_, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => scrollToCard(idx)}
                      className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${
                        currentCardIndex === idx 
                          ? 'w-4 bg-indigo-600 dark:bg-indigo-500' 
                          : 'bg-slate-300 dark:bg-slate-700 hover:bg-slate-400'
                      }`}
                      aria-label={interpolate(t.goToCategoryN, { n: idx + 1 })}
                    />
                  ))}
                </div>
                <span className="text-xs font-mono text-slate-500 dark:text-slate-450 font-medium">
                  {currentCardIndex + 1} / {riskCategories.length}
                </span>
              </div>

              <button
                type="button"
                onClick={() => scrollToCard(Math.min(riskCategories.length - 1, currentCardIndex + 1))}
                disabled={currentCardIndex === riskCategories.length - 1}
                className="p-1.5 rounded-xl border border-theme-border bg-theme-bg-card text-theme-text-secondary disabled:opacity-30 disabled:pointer-events-none hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center justify-center shadow-sm"
                aria-label={t.nextCategory}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Global Targets & Activities */}
          {(topNutrientTargetsList.length > 0 || topWeeklyNutrientTargetsList.length > 0 || additionalNutrientTargetsList.length > 0 || dailyActivities.length > 0) && (
            <div className="py-4 space-y-6">
              
              
              {topNutrientTargetsList.length > 0 && (
                <div className="space-y-3 pt-2">
                  <div className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">{t.topNutrientTargets}</div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {topNutrientTargetsList.map((nt: any, i: number) => (
                      <div key={i} className="py-2">
                        <div className="flex justify-between items-start mb-1.5">
                          <span className="text-sm font-semibold text-theme-text capitalize flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full inline-block flex-shrink-0" style={{ backgroundColor: getNutrientColor(nt.nutrientKey) }} />
                            {nt.nutrientKey}
                          </span>
                          <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400 ml-2 text-right">{nt.targetValue}</span>
                        </div>
                        {(nt.rationale || nt.reasoning) && <div className="text-xs text-slate-500 leading-relaxed">{nt.rationale || nt.reasoning}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {topWeeklyNutrientTargetsList.length > 0 && (
                <div className="space-y-3 pt-2">
                  <div className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">{t.topWeeklyNutrientTargets}</div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {topWeeklyNutrientTargetsList.map((nt: any, i: number) => (
                      <div key={i} className="py-2">
                        <div className="flex justify-between items-start mb-1.5">
                          <span className="text-sm font-semibold text-theme-text capitalize flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full inline-block flex-shrink-0" style={{ backgroundColor: getNutrientColor(nt.nutrientKey) }} />
                            {nt.nutrientKey}
                          </span>
                          <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400 ml-2 text-right">{nt.targetValue}</span>
                        </div>
                        {(nt.rationale || nt.reasoning) && <div className="text-xs text-slate-500 leading-relaxed">{nt.rationale || nt.reasoning}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {additionalNutrientTargetsList.length > 0 && (
                <div className="space-y-3 pt-2">
                  <div className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">{t.additionalNutrientTargets}</div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {additionalNutrientTargetsList.map((nt: any, i: number) => (
                      <div key={i} className="py-2">
                        <div className="flex justify-between items-start mb-1.5">
                          <span className="text-sm font-semibold text-theme-text capitalize flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full inline-block flex-shrink-0" style={{ backgroundColor: getNutrientColor(nt.nutrientKey) }} />
                            {nt.nutrientKey}
                          </span>
                          <span className="text-sm font-bold text-theme-text-secondary ml-2 text-right">{nt.targetValue}</span>
                        </div>
                        {(nt.rationale || nt.reasoning) && <div className="text-xs text-slate-500 leading-relaxed">{nt.rationale || nt.reasoning}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {dailyActivities.length > 0 && (
                <div className="space-y-3 pt-2">
                  <div className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center space-x-1.5">
                    <Activity className="w-3.5 h-3.5" />
                    <span>{t.dailyActivities}</span>
                  </div>
                  <div className="space-y-2">
                    {dailyActivities.map((da: any, i: number) => (
                      <div key={i} className="flex justify-between items-center py-2">
                        <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{da.activity}</span>
                        <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400 ml-3 text-right">{da.target}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {!isHandled && onAgentFinish && riskCategories.length > 0 && (
            <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
              <button
                onClick={() => handleApply(Array.from(unselectedKeys))}
                className="w-full sm:w-auto flex-1 flex items-center justify-center space-x-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-3 rounded-2xl text-sm font-bold shadow-md shadow-indigo-600/10 transition-all active:scale-[0.98]"
              >
                <Check className="w-4 h-4" />
                <span>{t.acceptSelected}</span>
              </button>
              
              <button
                onClick={() => handleApply([])}
                className="w-full sm:w-auto flex-1 flex items-center justify-center space-x-2 bg-white dark:bg-slate-800 border border-theme-border hover:bg-slate-50 dark:hover:bg-slate-700/50 text-theme-neutral px-5 py-3 rounded-2xl text-sm font-bold shadow-sm transition-all active:scale-[0.98]"
              >
                <CheckCircle className="w-4 h-4" />
                <span>{t.acceptAll}</span>
              </button>

              <button
                onClick={handleDismiss}
                className="w-full sm:w-auto p-3 flex items-center justify-center text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 border border-transparent hover:border-red-100 dark:hover:border-red-500/20 rounded-2xl transition-all active:scale-[0.98]"
                title={t.deleteDismiss}
              >
                <Trash2 className="w-5 h-5" />
                <span className="ml-2 sm:hidden font-bold text-sm">{t.deleteAnalysis}</span>
              </button>
            </div>
          )}

          {isHandled && onAgentFinish && (
            <div className="flex items-center justify-center space-x-2 p-3 bg-slate-50 dark:bg-slate-800/30 border border-theme-border/50 rounded-2xl">
              <CheckCircle className="w-4 h-4 text-emerald-500" />
              <span className="text-sm font-semibold text-theme-text-secondary">{t.analysisHandled}</span>
            </div>
          )}
        </div>
    </ErrorBoundary>
  );
};
