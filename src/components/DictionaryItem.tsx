import React, { useMemo, useState } from 'react';
import { getMergedBiomarkerDef } from '../utils/biomarkers';
import { autoCalibrateBiomarkerDef } from '../utils/biomarkerAutoCalibrate';
import { CheckSquare, Square, Save, Edit2, AlertCircle, Sliders, Bot } from 'lucide-react';
import BiomarkerRangeBuilder from './BiomarkerRangeBuilder';

/** Q-13 (move-only): moved verbatim out of BiomarkerDictionaryModal.tsx. */
// Q-13 (move-only): private to DictionaryItem — moved verbatim with it.
const ensureCustomRanges = (
  _key: string,
  _normalRangeStr: string,
  existingCustomRanges: any[]
): any[] => {
  // One-click catalog range fill removed: never invent ethnicity overrides (they became "< 0 U/L").
  return Array.isArray(existingCustomRanges) ? existingCustomRanges : [];
};

export const DictionaryItem = React.memo(({
  approvalReason,
  itemKey,
  builtInDef,
  customDef,
  logsCount,
  isSelected,
  allGroupings,
  allRisks,
  allConditions,
  itemLogs,
  onToggleSelect,
  onSave,

  onRouteAgent,
  onOpenAudit,
  onTagClick,
  onFlagNotUsed,
  isProcessing,
  telemetryFlag
}: {
  approvalReason?: string;
  itemKey: string;
  builtInDef?: any;
  customDef?: any;
  logsCount: number;
  isSelected: boolean;
  allGroupings: string[];
  allRisks: string[];
  allConditions: string[];
  itemLogs?: any[];
  onToggleSelect: () => void;
  onSave: (updates: any) => void;

  onRouteAgent?: () => void;
  onOpenAudit?: (tab?: 'overview' | 'corrupted_units' | 'duplicates' | 'missing_metadata' | 'conflicts' | 'clean') => void;
  onTagClick?: (tag: string) => void;
  onFlagNotUsed?: (key: string) => void;
  isProcessing?: boolean;
  telemetryFlag?: any;
  key?: string | number;
}) => {
  const def = useMemo(() => getMergedBiomarkerDef(itemKey, builtInDef, customDef, itemLogs), [itemKey, builtInDef, customDef, itemLogs]);
  const missingGrouping = !def.standardMedicalGrouping || def.standardMedicalGrouping.trim() === '' || def.standardMedicalGrouping === 'Other' || def.standardMedicalGrouping === 'By Medical Practice';
  const missingRisk = !Array.isArray(def.riskCategories) || def.riskCategories.length === 0 || def.riskCategories.includes('Uncategorized');
  const hasMissingCategory = missingGrouping || missingRisk;

  const initialName = def.name || itemKey;
  const initialUnit = def.unit || '';
  const initialNormalRange = def.normalRange || '';
  const initialGrouping = def.standardMedicalGrouping || '';
  const initialRisk = Array.isArray(def.riskCategories) ? def.riskCategories.join(', ') : (def.riskCategories || '');
  const initialConditions = Array.isArray(def.potentialMedicalConditions) ? def.potentialMedicalConditions.join(', ') : (def.potentialMedicalConditions || '');
  const displayCustomRanges = customDef?.customRanges || ensureCustomRanges(itemKey, initialNormalRange, builtInDef?.customRanges || []);
  const [isEditing, setIsEditing] = useState(false);
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(false);

  const handleStartEdit = () => {
    setEditState({
      key: itemKey,
      name: initialName,
      unit: initialUnit,
      normalRange: initialNormalRange,
      rangeConfig: customDef?.rangeConfig || builtInDef?.rangeConfig,
      customRanges: ensureCustomRanges(itemKey, initialNormalRange, customDef?.customRanges || builtInDef?.customRanges || []),
      standardMedicalGrouping: initialGrouping,
      riskCategories: initialRisk,
      potentialMedicalConditions: initialConditions
    });
    setIsEditing(true);
  };

  const missingUnit = !initialUnit || initialUnit.trim() === '';
  const missingRange = !initialNormalRange || initialNormalRange.trim() === '' || initialNormalRange === 'Unknown';
  const hasCalibrationIssues = approvalReason || missingUnit || missingRange || hasMissingCategory || telemetryFlag;

  let issueTitle = "Action Required";
  const issueTypes = [];
  if (missingUnit) issueTypes.push("Unit");
  if (missingRange) issueTypes.push("Range");
  if (hasMissingCategory) issueTypes.push("Category");
  
  if (telemetryFlag) {
    issueTitle = telemetryFlag.issueTitle || "Scale / Unit Discrepancy";
  } else if (issueTypes.length > 0) {
    issueTitle = `Missing Metadata (${issueTypes.join(", ")})`;
  } else if (approvalReason) {
    issueTitle = "Pending Agent Review";
  }

  const handleAutoCalibrateAndApprove = () => {
    const calibrated = autoCalibrateBiomarkerDef(itemKey, builtInDef, customDef);
    onSave({
      name: calibrated.name,
      unit: calibrated.unit,
      normalRange: calibrated.normalRange,
      standardMedicalGrouping: calibrated.standardMedicalGrouping,
      riskCategories: calibrated.riskCategories,
      potentialMedicalConditions: calibrated.potentialMedicalConditions
    });
  };

  const [editState, setEditState] = useState({
    key: itemKey,
    name: initialName,
    unit: initialUnit,
    normalRange: initialNormalRange,
    rangeConfig: customDef?.rangeConfig,
    customRanges: ensureCustomRanges(itemKey, initialNormalRange, customDef?.customRanges || builtInDef?.customRanges || []),
    standardMedicalGrouping: initialGrouping,
    riskCategories: initialRisk,
    potentialMedicalConditions: initialConditions
  });

  const handleNormalRangeChange = (val: string) => {
    let newRangeConfig = editState.rangeConfig;
    
    const bracketMatch = val.trim().match(/^([\d.]+)\s*-\s*([\d.]+)(?:\s+.*)?$/);
    if (bracketMatch) {
      const min = parseFloat(bracketMatch[1]);
      const max = parseFloat(bracketMatch[2]);
      if (!isNaN(min) && !isNaN(max)) {
        newRangeConfig = {
          type: 'bracket',
          brackets: [
            { min: null, max: min, alias: 'Low', severity: 'At risk' },
            { min: min, max: max, alias: 'Normal', severity: 'Normal' },
            { min: max, max: null, alias: 'Elevated', severity: 'At risk' }
          ]
        };
      }
    } else {
      const lessMatch = val.trim().match(/^(?:<|<=|under|less than|below)\s*([\d.]+)(?:\s+.*)?$/i);
      if (lessMatch) {
        const v = parseFloat(lessMatch[1]);
        if (!isNaN(v)) {
          newRangeConfig = {
            type: 'simple',
            conditions: [
              { operator: '<', value: v, alias: 'Normal', severity: 'Normal' },
              { operator: '>=', value: v, alias: 'Elevated', severity: 'At risk' }
            ]
          };
        }
      } else {
        const greaterMatch = val.trim().match(/^(?:>|>=|over|greater than|above)\s*([\d.]+)(?:\s+.*)?$/i);
        if (greaterMatch) {
          const v = parseFloat(greaterMatch[1]);
          if (!isNaN(v)) {
            newRangeConfig = {
              type: 'simple',
              conditions: [
                { operator: '>', value: v, alias: 'Normal', severity: 'Normal' },
                { operator: '<=', value: v, alias: 'Low', severity: 'At risk' }
              ]
            };
          }
        } else {
          const plainMatch = val.trim().match(/^([\d.]+)(?:\s+.*)?$/);
          if (plainMatch) {
            const v = parseFloat(plainMatch[1]);
            if (!isNaN(v)) {
              newRangeConfig = {
                type: 'simple',
                conditions: [
                  { operator: '<', value: v, alias: 'Normal', severity: 'Normal' },
                  { operator: '>=', value: v, alias: 'Elevated', severity: 'At risk' }
                ]
              };
            }
          }
        }
      }
    }
    
    setEditState({
      ...editState,
      normalRange: val,
      ...(newRangeConfig ? { rangeConfig: newRangeConfig } : {})
    });
  };

  const handleRangeConfigChange = (r: any, c: any) => {
    let newNormalRange = editState.normalRange;
    if (r) {
      if (r.type === 'bracket' && r.brackets && r.brackets.length > 0) {
        const normalBracket = r.brackets.find((b: any) => b.severity === 'Normal');
        if (normalBracket && normalBracket.min !== null && normalBracket.max !== null) {
          newNormalRange = `${normalBracket.min} - ${normalBracket.max}`;
        }
      } else if (r.type === 'simple' && r.conditions && r.conditions.length > 0) {
        const normalCond = r.conditions.find((c: any) => c.severity === 'Normal');
        if (normalCond) {
          newNormalRange = `${normalCond.operator} ${normalCond.value}`;
        }
      }
    }
    setEditState({ ...editState, rangeConfig: r, customRanges: c, normalRange: newNormalRange });
  };
  const handleSave = () => {
    onSave({
      newKey: editState.key !== itemKey ? editState.key : undefined,
      name: editState.name.trim(),
      unit: editState.unit.trim(),
      normalRange: editState.normalRange.trim(),
      rangeConfig: editState.rangeConfig,
      customRanges: editState.customRanges,
      standardMedicalGrouping: editState.standardMedicalGrouping,
      riskCategories: editState.riskCategories.split(',').map((s: string) => s.trim()).filter(Boolean),
      potentialMedicalConditions: editState.potentialMedicalConditions.split(',').map((s: string) => s.trim()).filter(Boolean),
    });
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditState({
      key: itemKey,
      name: initialName,
      unit: initialUnit,
      normalRange: initialNormalRange,
      rangeConfig: customDef?.rangeConfig,
      customRanges: customDef?.customRanges || [],
      standardMedicalGrouping: initialGrouping,
      riskCategories: initialRisk,
      potentialMedicalConditions: initialConditions
    });
    setIsEditing(false);
  };

  return (
    <div className={`flex flex-col p-3 border rounded-xl gap-3 transition-colors ${
      isSelected 
        ? 'bg-indigo-50/40 dark:bg-indigo-900/10 border-indigo-200 dark:border-indigo-900/30' 
        : 'bg-amber-50/20 dark:bg-amber-900/5 border-amber-100/60 dark:border-amber-900/20'
    }`}>
      <div className="flex items-start justify-between relative">
        <div className="flex items-start gap-2.5 flex-1 min-w-0">
          <button 
            onClick={onToggleSelect}
            className="p-1 mt-0.5 text-slate-400 hover:text-indigo-600 rounded transition-colors shrink-0 cursor-pointer"
          >
            {isSelected ? (
              <CheckSquare className="w-4 h-4 text-indigo-600" />
            ) : (
              <Square className="w-4 h-4" />
            )}
          </button>
          
          <div className="flex-1 min-w-0 pr-4">
            {isEditing ? (
              <div className="space-y-3 w-full">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase">Key (snake_case)</label>
                    <input 
                      type="text" 
                      className="w-full text-sm font-mono text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-950 border border-theme-border rounded px-2 py-1 outline-none focus:border-indigo-500"
                      value={editState.key}
                      onChange={e => setEditState({...editState, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '')})}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase">Name</label>
                    <input 
                      type="text" 
                      className="w-full text-sm font-bold text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-950 border border-theme-border rounded px-2 py-1 outline-none focus:border-indigo-500"
                      value={editState.name}
                      onChange={e => setEditState({...editState, name: e.target.value})}
                      autoFocus
                    />
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase">Unit</label>
                    
                    {(() => {
                      const standardUnits = ["kg/m2", "mg/dL", "mmol/L", "umol/L", "g/L", "g/dL", "%", "ng/mL", "pg/mL", "ug/dL", "nmol/L", "pmol/L", "U/L", "IU/L"];
                      const isCustom = !standardUnits.includes(editState.unit) && editState.unit !== '';
                      return (
                        <div className="flex flex-col gap-1">
                          <select 
                            className="w-full text-xs font-medium text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-950 border border-theme-border rounded px-2 py-1 outline-none focus:border-indigo-500"
                            value={isCustom ? "custom" : editState.unit}
                            onChange={e => {
                              if (e.target.value === "custom") {
                                setEditState({...editState, unit: " "}); // trigger custom input
                              } else {
                                setEditState({...editState, unit: e.target.value});
                              }
                            }}
                          >
                            <option value="">Select unit...</option>
                            {standardUnits.map(u => <option key={u} value={u}>{u}</option>)}
                            <option value="custom">Other (Custom)</option>
                          </select>
                          {isCustom && (
                            <input 
                              type="text" 
                              className="w-full mt-1 text-xs font-medium text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-950 border border-theme-border rounded px-2 py-1 outline-none focus:border-indigo-500"
                              value={editState.unit.trim()}
                              onChange={e => setEditState({...editState, unit: e.target.value})}
                              placeholder="Enter custom unit"
                              autoFocus
                            />
                          )}
                        </div>
                      );
                    })()}

                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase">Normal Range</label>
                    <input 
                      type="text" 
                      className="w-full text-xs font-medium text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-950 border border-theme-border rounded px-2 py-1 outline-none focus:border-indigo-500"
                      value={editState.normalRange}
                      onChange={e => handleNormalRangeChange(e.target.value)}
                    />
                  </div>
                </div>

                <div className="mt-3">
                  <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase">Range Configuration</label>
                  <BiomarkerRangeBuilder
                    rangeConfig={editState.rangeConfig}
                    customRanges={editState.customRanges}
                    normalRangeStr={editState.normalRange}
                    onChange={handleRangeConfigChange}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase">Medical Grouping</label>
                  <div className="flex gap-2 mb-1">
                    <select
                      className="flex-1 text-xs font-medium text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-950 border border-theme-border rounded px-2 py-1 outline-none focus:border-indigo-500"
                      value={allGroupings.includes(editState.standardMedicalGrouping) || !editState.standardMedicalGrouping ? editState.standardMedicalGrouping : 'custom'}
                      onChange={e => {
                        if (e.target.value !== 'custom') setEditState({...editState, standardMedicalGrouping: e.target.value});
                        else setEditState({...editState, standardMedicalGrouping: ''});
                      }}
                    >
                      <option value="">-- None --</option>
                      {allGroupings.map(g => (
                        <option key={g} value={g}>{g}</option>
                      ))}
                      <option value="custom">-- Custom --</option>
                    </select>
                    {(!allGroupings.includes(editState.standardMedicalGrouping) && editState.standardMedicalGrouping !== '') && (
                      <input 
                        type="text"
                        placeholder="Custom grouping"
                        className="flex-1 text-xs font-medium text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-950 border border-theme-border rounded px-2 py-1 outline-none focus:border-indigo-500"
                        value={editState.standardMedicalGrouping}
                        onChange={e => setEditState({...editState, standardMedicalGrouping: e.target.value})}
                      />
                    )}
                  </div>
                </div>

                <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase">Risk Categories</label>
                    <div className="flex flex-wrap gap-1 mb-1">
                      {allRisks.map(r => {
                        const active = editState.riskCategories.includes(r);
                        return (
                          <span 
                            key={r}
                            onClick={() => {
                              const arr = editState.riskCategories.split(',').map(s=>s.trim()).filter(Boolean);
                              if (active) setEditState({...editState, riskCategories: arr.filter(x=>x!==r).join(', ')});
                              else setEditState({...editState, riskCategories: [...arr, r].join(', ')});
                            }}
                            className={`cursor-pointer text-[9px] px-1.5 py-0.5 rounded-full border ${active ? 'bg-indigo-100 border-indigo-300 text-indigo-700 dark:bg-indigo-900/50 dark:border-indigo-700 dark:text-indigo-300' : 'bg-slate-50 border-slate-200 text-slate-500 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400'}`}
                          >
                            {r}
                          </span>
                        )
                      })}
                    </div>
                    <input 
                      type="text" 
                      className="w-full text-xs font-medium text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-950 border border-theme-border rounded px-2 py-1 outline-none focus:border-indigo-500"
                      value={editState.riskCategories}
                      onChange={e => setEditState({...editState, riskCategories: e.target.value})}
                      placeholder="Custom (comma sep)"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase">Medical Conditions</label>
                    <div className="flex flex-wrap gap-1 mb-1 max-h-16 overflow-y-auto">
                      {allConditions.map(c => {
                        const active = editState.potentialMedicalConditions.includes(c);
                        return (
                          <span 
                            key={c}
                            onClick={() => {
                              const arr = editState.potentialMedicalConditions.split(',').map(s=>s.trim()).filter(Boolean);
                              if (active) setEditState({...editState, potentialMedicalConditions: arr.filter(x=>x!==c).join(', ')});
                              else setEditState({...editState, potentialMedicalConditions: [...arr, c].join(', ')});
                            }}
                            className={`cursor-pointer text-[9px] px-1.5 py-0.5 rounded-full border ${active ? 'bg-indigo-100 border-indigo-300 text-indigo-700 dark:bg-indigo-900/50 dark:border-indigo-700 dark:text-indigo-300' : 'bg-slate-50 border-slate-200 text-slate-500 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400'}`}
                          >
                            {c}
                          </span>
                        )
                      })}
                    </div>
                    <input 
                      type="text" 
                      className="w-full text-xs font-medium text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-950 border border-theme-border rounded px-2 py-1 outline-none focus:border-indigo-500"
                      value={editState.potentialMedicalConditions}
                      onChange={e => setEditState({...editState, potentialMedicalConditions: e.target.value})}
                      placeholder="Custom (comma sep)"
                    />
                  </div>

                <div className="flex justify-end gap-2 mt-4">
                  <button 
                    onClick={handleCancel}
                    className="px-3 py-1.5 text-xs font-bold text-slate-500 hover:text-slate-700 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleSave}
                    className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded hover:bg-indigo-700 flex items-center gap-1 cursor-pointer"
                  >
                    <Save className="w-3.5 h-3.5" />
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2 flex-wrap">
                    {initialName}
                    <button onClick={handleStartEdit} className="text-slate-400 hover:text-indigo-500 cursor-pointer p-1" title="Edit biomarker definition">
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    {onFlagNotUsed && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onFlagNotUsed(itemKey);
                        }}
                        className="text-xs font-semibold text-slate-400 hover:text-rose-500 hover:underline cursor-pointer px-1 py-0.5 transition-colors"
                        title="Flag biomarker as Not Used"
                      >
                        Not used
                      </button>
                    )}
                  </div>

                </div>

                {/* Unified Calibration & Approval Banner */}
                {hasCalibrationIssues && (
                  <div className="mt-2.5 bg-amber-50/90 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/60 rounded-xl p-3 flex flex-col sm:flex-row sm:items-start justify-between gap-3 shadow-2xs">
                    <div className="flex items-start gap-2.5 text-xs text-amber-900 dark:text-amber-200 flex-1">
                      <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                      <div className="space-y-1 w-full">
                        <div className="font-bold flex items-center gap-1.5 text-amber-950 dark:text-amber-100">
                          {issueTitle}
                        </div>
                        {telemetryFlag?.preciseCause && (
                          <div className="text-xs text-rose-800 dark:text-rose-200 font-medium leading-relaxed bg-rose-50/80 dark:bg-rose-950/40 p-2 rounded-lg border border-rose-200/80 dark:border-rose-900/50">
                            {telemetryFlag.preciseCause}
                          </div>
                        )}
                        {telemetryFlag?.suggestedFix && (
                          <div className="text-[11px] text-amber-900/90 dark:text-amber-200/90 font-normal">
                            <span className="font-bold text-amber-950 dark:text-amber-100">Action:</span> {telemetryFlag.suggestedFix}
                          </div>
                        )}
                        <div className="flex flex-wrap gap-1 pt-0.5">
                          {missingUnit && <span className="px-1.5 py-0.5 text-[10px] bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-300 rounded font-bold">Missing Unit</span>}
                          {missingRange && <span className="px-1.5 py-0.5 text-[10px] bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300 rounded font-bold">Missing Range</span>}
                          {hasMissingCategory && <span className="px-1.5 py-0.5 text-[10px] bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300 rounded font-bold">Missing Category</span>}
                          {approvalReason && <span className="px-1.5 py-0.5 text-[10px] bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-300 rounded font-bold">Pending Review</span>}
                          {telemetryFlag && <span className="px-1.5 py-0.5 text-[10px] bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-300 rounded font-bold">{telemetryFlag.badgeLabel || "Scale / Unit Error"}</span>}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto pt-0.5">
                      {telemetryFlag && onOpenAudit && (
                        <button
                          type="button"
                          onClick={() => onOpenAudit('corrupted_units')}
                          className="px-2.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                          title="Open in Biomarker diagnostic to resolve corrupted unit"
                        >
                          <Sliders className="w-3.5 h-3.5" />
                          <span>Audit & Fix Unit</span>
                        </button>
                      )}
                      {onRouteAgent && (
                        <button
                          type="button"
                          onClick={onRouteAgent}
                          disabled={isProcessing}
                          className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs disabled:opacity-50"
                          title="Ask AI Agent to review and propose standard fixes"
                        >
                          <Bot className="w-3.5 h-3.5" />
                          <span>Fix with Agent</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleStartEdit}
                        className="px-2.5 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-xs font-semibold cursor-pointer"
                      >
                        Edit Details
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <span className="text-[10px] font-mono text-theme-text-secondary bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                    Key: {itemKey}
                  </span>
                  {logsCount > 0 && (
                    <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 px-1.5 py-0.5 rounded">
                      {logsCount} log{logsCount !== 1 ? 's' : ''}
                    </span>
                  )}
                  {initialGrouping && (
                    <span 
                      onClick={() => onTagClick && onTagClick(initialGrouping.trim())}
                      className={`text-[10px] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/30 px-1.5 py-0.5 rounded flex items-center gap-1 ${onTagClick ? 'cursor-pointer hover:bg-emerald-100 dark:hover:bg-emerald-900/30' : ''}`}
                    >
                      <span className="text-[8px] uppercase tracking-wider opacity-70">Medical Practice:</span>
                      {initialGrouping}
                    </span>
                  )}
                </div>
                
                <div className="mt-2.5 space-y-1 text-xs text-theme-text-secondary">
                  <div>
                    <span className="font-semibold text-theme-neutral">Unit:</span>{' '}
                    {initialUnit ? (
                      <span className="font-medium text-slate-800 dark:text-slate-200">{initialUnit}</span>
                    ) : (
                      <span className="text-rose-500 font-semibold italic">Not specified</span>
                    )}
                  </div>

                  <div>
                    <span className="font-semibold text-theme-neutral">Range:</span>{' '}
                    {initialNormalRange && initialNormalRange.trim() !== '' && initialNormalRange !== 'Unknown' ? (
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        {initialNormalRange}
                        {(customDef?.rangeConfig || displayCustomRanges?.length > 0) && (
                          <span className="ml-2 text-[10px] font-bold text-indigo-600 bg-indigo-50 dark:bg-indigo-900/30 px-1.5 py-0.5 rounded">
                            Structured Ranges Active
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-amber-600 dark:text-amber-400 font-semibold italic">Not specified</span>
                    )}
                  </div>
                </div>

                {/* Demographic Overrides List */}
                {displayCustomRanges && displayCustomRanges.length > 0 && (
                  <div className="mt-2.5 bg-slate-50 dark:bg-slate-900/40 rounded-lg p-2.5 border border-theme-border/80 space-y-1.5">
                    <div className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center gap-1">
                      <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full"></span>
                      Demographic Overrides ({displayCustomRanges.length})
                    </div>
                    <div className="divide-y divide-slate-100 dark:divide-slate-800/40">
                      {displayCustomRanges.map((cr: any, i: number) => {
                        const filterTexts: string[] = [];
                        if (cr.filters?.ethnicity) filterTexts.push(`Ethnicity: ${cr.filters.ethnicity.toUpperCase()}`);
                        if (cr.filters?.gender) filterTexts.push(`Gender: ${cr.filters.gender.toUpperCase()}`);
                        if (cr.filters?.minAge || cr.filters?.maxAge) {
                          filterTexts.push(`Age: ${cr.filters.minAge || '0'}-${cr.filters.maxAge || '∞'}`);
                        }
                        const filterLabel = filterTexts.length > 0 ? `[${filterTexts.join(', ')}]` : '[Global]';
                        
                        // Format range string
                        let rangeStr = '';
                        if (cr.range) {
                          if (cr.range.type === 'bracket') {
                            const normBracket = cr.range.brackets?.find((b: any) => b.severity === 'Normal' || b.alias === 'Normal');
                            if (normBracket) {
                              if (normBracket.min !== null && normBracket.max !== null) rangeStr = `${normBracket.min} - ${normBracket.max}`;
                              else if (normBracket.min !== null) rangeStr = `>= ${normBracket.min}`;
                              else if (normBracket.max !== null) rangeStr = `<= ${normBracket.max}`;
                            }
                          } else if (cr.range.type === 'simple') {
                            const normCond = cr.range.conditions?.find((c: any) => c.severity === 'Normal' || c.alias === 'Normal' || c.alias === 'Healthy');
                            if (normCond) {
                              rangeStr = `${normCond.operator} ${normCond.value}`;
                            }
                          }
                        }
                        if (!rangeStr) {
                          // Fallback to parsed string if range object format is simple
                          if (cr.name === 'Chinese Lipid Guidelines' && itemKey === 'total_cholesterol') rangeStr = '< 5.2';
                          else if (cr.name === 'Chinese Lipid Guidelines' && itemKey === 'ldl') rangeStr = '< 3.4';
                          else if (cr.name === 'Chinese Lipid Guidelines' && itemKey === 'hdl') rangeStr = '> 1.0';
                          else if (cr.name === 'Chinese Lipid Guidelines' && itemKey === 'triglycerides') rangeStr = '< 1.7';
                          else if (cr.name === 'Asian Diabetes Association Guidelines' && itemKey === 'hba1c') rangeStr = '< 5.7';
                          else if (cr.name === 'Asian Diabetes Association Guidelines' && itemKey === 'fasting_glucose') rangeStr = '< 5.6';
                          else rangeStr = initialNormalRange;
                        }
                        
                        return (
                          <div key={i} className="py-1 flex items-center justify-between text-[11px] gap-2 first:pt-0 last:pb-0">
                            <div className="flex flex-col gap-0.5">
                              <span className="font-semibold text-theme-neutral">{cr.name}</span>
                              <span className="text-[9px] text-slate-400 dark:text-slate-500 font-mono">{filterLabel}</span>
                            </div>
                            <div className="font-mono text-indigo-600 dark:text-indigo-400 bg-indigo-50/50 dark:bg-indigo-950/20 px-2 py-0.5 rounded border border-indigo-100/30 dark:border-indigo-900/20 font-bold">
                              {rangeStr} {initialUnit}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                
                {(initialRisk || initialConditions) && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {initialRisk && initialRisk.split(',').map((r: string, i: number) => (
                      <span 
                        key={i} 
                        onClick={() => onTagClick && onTagClick(r.trim())}
                        className={`text-[9px] font-bold px-1.5 py-0.5 bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400 rounded-full border border-red-100 dark:border-red-900/30 flex items-center gap-1 ${onTagClick ? 'cursor-pointer hover:bg-red-100 dark:hover:bg-red-900/40' : ''}`}
                      >
                        <span className="text-[7.5px] uppercase tracking-wider opacity-60">Risk:</span>
                        {r.trim()}
                      </span>
                    ))}
                    {initialConditions && initialConditions.split(',').map((c: string, i: number) => (
                      <span 
                        key={i} 
                        onClick={() => onTagClick && onTagClick(c.trim())}
                        className={`text-[9px] font-bold px-1.5 py-0.5 bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400 rounded-full border border-indigo-100 dark:border-indigo-900/30 flex items-center gap-1 ${onTagClick ? 'cursor-pointer hover:bg-indigo-100 dark:hover:bg-indigo-900/40' : ''}`}
                      >
                        <span className="text-[7.5px] uppercase tracking-wider opacity-60">Condition:</span>
                        {c.trim()}
                      </span>
                    ))}
                  </div>
                )}

                <div className="mt-2.5 pt-2 border-t border-theme-border/40">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs text-theme-text-secondary">
                      Latest Log: {itemLogs && itemLogs.length > 0 ? (
                        <>
                          <span className="font-bold text-slate-800 dark:text-slate-200">{itemLogs[0].value} {initialUnit}</span> <span className="text-[10px] text-slate-400 dark:text-slate-500">({itemLogs[0].date})</span>
                        </>
                      ) : (
                        <span className="font-bold text-slate-400 dark:text-slate-500 italic">Not used</span>
                      )}
                    </div>
                    {itemLogs && itemLogs.length > 1 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsHistoryExpanded(!isHistoryExpanded);
                        }}
                        className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-0.5 cursor-pointer"
                      >
                        {isHistoryExpanded ? "Hide History" : `History (${itemLogs.length})`}
                      </button>
                    )}
                  </div>
                  
                  {isHistoryExpanded && itemLogs && itemLogs.length > 1 && (
                    <div className="mt-2 space-y-1 bg-theme-bg/40 p-2 rounded-lg border border-theme-border max-h-32 overflow-y-auto">
                      {itemLogs.map((log: any, idx: number) => (
                        <div key={idx} className="flex justify-between items-center text-[11px] font-mono py-0.5 border-b border-slate-100/30 dark:border-slate-800/20 last:border-0 text-theme-text-secondary">
                          <span>{log.date}</span>
                          <span className="font-bold text-slate-800 dark:text-slate-200">{log.value} {initialUnit}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>


    </div>
  );
});
