import { trackApiCall, setActiveQueryId, generateQueryId } from '../utils/apiTracker';
import { UniversalModal } from './UniversalModal';
import { toYYYYMMDD } from "../utils/dateUtils";
import React, { useState, useMemo, useRef, useEffect, useCallback, Suspense } from 'react';
import { lazyWithRetry } from '../utils/lazyWithRetry';
import { UserProfile, BiomarkerLog } from '../types';
import { biomarkerDefinitions, BIOMARKER_GROUPING_OPTIONS, getBiomarkerMetadata, getMergedBiomarkerDef, isPendingCatalogApproval, isBiomarkerNeedingReview, findDuplicateOrExistingBiomarker, detectFlaggedTelemetryErrors, isBiomarkerValueImprobable, computeBiomarkerTelemetryMultiplier } from '../utils/biomarkers';
import { X, CheckCircle, Check, AlertCircle, Edit2, Loader, Save, ArrowRight, CheckSquare, Square, MessageSquare, Send, ChevronLeft, ChevronDown, FileCode, Merge, Copy, Upload, Trash, Paperclip, Calendar, Info, Terminal, BrainCircuit, Clock, Zap, Sliders, Bot } from 'lucide-react';
import BiomarkerRangeBuilder, { parseNormalRangeStr } from './BiomarkerRangeBuilder';
import CombineBiomarkersModal from './CombineBiomarkersModal';
import LLMSelector from './LLMSelector';
import FullScreenInstructionViewer from './FullScreenInstructionViewer';
const FullScreenLogViewer = lazyWithRetry(() => import('./FullScreenLogViewer'));
import NotUsedBiomarkersModal from './NotUsedBiomarkersModal';
import { BiomarkerAuditModal } from './BiomarkerAuditModal';
import { saveAgentRequestLog } from '../utils/agentLogsTracker';
import { t, interpolate, displayBiomarkerName } from '../utils/i18n';
import { getDuplicateAliasGroups } from '../utils/biomarkerAuditEngine';

interface BiomarkerDictionaryModalProps {
  profile: UserProfile;
  biomarkers: { [key: string]: number | string };
  biomarkerHistory: BiomarkerLog[];
  onClose: () => void;
  onUpdateProfile: (updates: Partial<UserProfile>) => void;
  onFlagNotUsed?: (key: string) => void;
  onRestoreNotUsedGlobal?: (key: string) => void;
  onOpenNotUsedScreen?: (tab?: string) => void;
  onBatchCombineBiomarkers?: (combinations: {targetKey: string, targetDef: any, mergedLogs: any[], sourceKeysToDelete: string[]}[]) => Promise<void>;
  onCombineBiomarkers: (
    targetKey: string,
    targetDef: { name: string; unit: string; normalRange: string; description: string; standardMedicalGrouping?: string; riskCategories?: string[]; benefitRisk?: string },
    mergedLogs: { date: string; value: number | string }[],
    sourceKeysToDelete: string[]
  ) => void;
  onBatchConsolidate?: (mapping: { [key: string]: string }) => void;
  onStandardizeUnits?: (updates: { [key: string]: any }, logValueCorrections?: { logId?: string; date: string; key: string; newValue: number }[]) => Promise<void>;
  initialSearchQuery?: string;
  onLogMedical?: (biomarkers: { [key: string]: number | string }, profileUpdates?: Partial<UserProfile>, date?: string, entries?: any, modificationCommand?: any, skipClose?: boolean) => void;
  onAgentAnalysisSaved?: (agentType: string, agentResult: any, existingId?: string) => Promise<string | void>;
  onReviewWithAgent?: (keys: string[]) => void;
  onDeleteAnalysis?: (id: string) => Promise<void>;
  onDeleteBiomarker?: (key: string) => void;
  onDeleteMultipleBiomarkers?: (keys: string[]) => void;
  selectedModelId?: string;
  onChangeModelId?: (id: string) => void;
}

const getSessionId = (): string => {
  if (typeof window === 'undefined') return 'global';
  let id = sessionStorage.getItem('app_session_id');
  if (!id) {
    id = `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    sessionStorage.setItem('app_session_id', id);
  }
  return id;
};

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'model';
  content: string;
  suggestedMapping?: { [key: string]: string };
}

const ensureCustomRanges = (
  _key: string,
  _normalRangeStr: string,
  existingCustomRanges: any[]
): any[] => {
  // One-click catalog range fill removed: never invent ethnicity overrides (they became "< 0 U/L").
  return Array.isArray(existingCustomRanges) ? existingCustomRanges : [];
};

export const autoCalibrateBiomarkerDef = (key: string, builtInDef?: any, customDef?: any) => {
  const merged = getMergedBiomarkerDef(key, builtInDef, customDef);
  const kLower = key.toLowerCase();
  
  // Name
  let name = merged.name || key;
  if (!name || name === key) {
    name = key.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  // Unit inference
  let unit = merged.unit || '';
  if (!unit || unit.trim() === '' || unit === 'Unknown') {
    if (builtInDef?.unit && builtInDef.unit !== 'Unknown') unit = builtInDef.unit;
    else if (kLower.includes('glucose') || kLower.includes('cholesterol') || kLower.includes('triglycerides') || kLower.includes('ldl') || kLower.includes('hdl') || kLower.includes('creatinine') || kLower.includes('bilirubin') || kLower.includes('urea') || kLower.includes('calcium') || kLower.includes('uric')) unit = 'mmol/L';
    else if (kLower.includes('hba1c') || kLower.includes('percentage') || kLower.includes('ratio')) unit = '%';
    else if (kLower.includes('pressure') || kLower.includes('systolic') || kLower.includes('diastolic')) unit = 'mmHg';
    else if (kLower.includes('heart') || kLower.includes('pulse') || kLower.includes('rate') || kLower.includes('bpm')) unit = 'bpm';
    else if (kLower.includes('weight') || kLower.includes('mass')) unit = 'kg';
    else if (kLower.includes('height')) unit = 'cm';
    else if (kLower.includes('drinking') || kLower.includes('audit') || kLower.includes('frequency') || kLower.includes('score') || kLower.includes('scale') || kLower.includes('index') || kLower.includes('count') || kLower.includes('hdss')) unit = 'score';
    else if (kLower.includes('ast') || kLower.includes('alt') || kLower.includes('alp') || kLower.includes('ggt')) unit = 'U/L';
    else if (kLower.includes('hemoglobin') || kLower.includes('protein') || kLower.includes('albumin')) unit = 'g/dL';
    else unit = 'units';
  }

  // Normal Range inference
  let normalRange = merged.normalRange || '';
  if (!normalRange || normalRange.trim() === '' || normalRange === 'Unknown') {
    if (builtInDef?.normalRange && builtInDef.normalRange !== 'Unknown') normalRange = builtInDef.normalRange;
    else if (kLower.includes('fasting_glucose') || kLower.includes('glucose')) normalRange = '3.9 - 5.6';
    else if (kLower.includes('hba1c')) normalRange = '< 5.7';
    else if (kLower.includes('total_cholesterol')) normalRange = '< 5.2';
    else if (kLower.includes('ldl')) normalRange = '< 3.4';
    else if (kLower.includes('hdl')) normalRange = '> 1.0';
    else if (kLower.includes('triglycerides')) normalRange = '< 1.7';
    else if (kLower.includes('systolic')) normalRange = '< 120';
    else if (kLower.includes('diastolic')) normalRange = '< 80';
    else if (kLower.includes('heart_rate') || kLower.includes('pulse')) normalRange = '60 - 100';
    else if (kLower.includes('drinking') || kLower.includes('audit')) normalRange = '0 - 4';
    else normalRange = 'Normal';
  }

  // Standard Medical Grouping
  let standardMedicalGrouping = merged.standardMedicalGrouping;
  if (!standardMedicalGrouping || standardMedicalGrouping.trim() === '' || standardMedicalGrouping === 'Other' || standardMedicalGrouping === 'By Medical Practice') {
    if (builtInDef?.standardMedicalGrouping && builtInDef.standardMedicalGrouping !== 'By Medical Practice' && builtInDef.standardMedicalGrouping !== 'Other') {
      standardMedicalGrouping = builtInDef.standardMedicalGrouping;
    } else if (kLower.includes('glucose') || kLower.includes('hba1c') || kLower.includes('insulin') || kLower.includes('lipid') || kLower.includes('cholesterol') || kLower.includes('triglyceride')) {
      standardMedicalGrouping = 'Metabolism & Diabetes';
    } else if (kLower.includes('pressure') || kLower.includes('heart') || kLower.includes('cardio') || kLower.includes('pulse')) {
      standardMedicalGrouping = 'Cardiovascular & Blood Pressure';
    } else if (kLower.includes('drinking') || kLower.includes('audit') || kLower.includes('sleep') || kLower.includes('smoke') || kLower.includes('diet') || kLower.includes('exercise')) {
      standardMedicalGrouping = 'Lifestyle & Preventive Health';
    } else if (kLower.includes('alt') || kLower.includes('ast') || kLower.includes('liver') || kLower.includes('bilirubin')) {
      standardMedicalGrouping = 'Liver Function';
    } else if (kLower.includes('kidney') || kLower.includes('creatinine') || kLower.includes('egfr') || kLower.includes('bun')) {
      standardMedicalGrouping = 'Renal & Kidney Function';
    } else if (kLower.includes('hemorrhoid') || kLower.includes('gastro') || kLower.includes('bowel') || kLower.includes('stool') || kLower.includes('gut') || kLower.includes('digest')) {
      standardMedicalGrouping = 'Gastrointestinal & Digestive Health';
    } else if (kLower.includes('symptom') || kLower.includes('score') || kLower.includes('scale') || kLower.includes('index') || kLower.includes('assessment')) {
      standardMedicalGrouping = 'Clinical Scores & Symptoms';
    } else {
      standardMedicalGrouping = 'General Health';
    }
  }

  // Risk Categories
  let riskCategories = merged.riskCategories;
  if (!Array.isArray(riskCategories) || riskCategories.length === 0 || riskCategories.includes('Uncategorized')) {
    if (builtInDef?.riskCategories && builtInDef.riskCategories.length > 0 && !builtInDef.riskCategories.includes('Uncategorized')) {
      riskCategories = builtInDef.riskCategories;
    } else if (kLower.includes('hemorrhoid') || kLower.includes('gastro') || kLower.includes('digest')) {
      riskCategories = ['Gastrointestinal Health'];
    } else {
      riskCategories = ['General Health'];
    }
  }

  // Potential Medical Conditions
  let potentialMedicalConditions = merged.potentialMedicalConditions;
  if (!Array.isArray(potentialMedicalConditions) || potentialMedicalConditions.length === 0) {
    if (builtInDef?.potentialMedicalConditions && builtInDef.potentialMedicalConditions.length > 0) {
      potentialMedicalConditions = builtInDef.potentialMedicalConditions;
    } else if (kLower.includes('hemorrhoid')) {
      potentialMedicalConditions = ['Hemorrhoidal Disease'];
    } else {
      potentialMedicalConditions = ['General Wellness'];
    }
  }

  return {
    name,
    unit,
    normalRange,
    standardMedicalGrouping,
    riskCategories,
    potentialMedicalConditions
  };
};


const DictionaryItem = React.memo(({
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

export default function BiomarkerDictionaryModal({
  profile,
  biomarkers,
  biomarkerHistory,
  onClose,
  onUpdateProfile,
  onFlagNotUsed,
  onRestoreNotUsedGlobal,
  onOpenNotUsedScreen,
  onCombineBiomarkers,
  onBatchCombineBiomarkers,
  onBatchConsolidate,
  onStandardizeUnits,
  initialSearchQuery,
  onLogMedical,
  onAgentAnalysisSaved,
  onReviewWithAgent,
  onDeleteAnalysis,
  onDeleteBiomarker,
  onDeleteMultipleBiomarkers,
  selectedModelId,
  onChangeModelId
}: BiomarkerDictionaryModalProps) {
  const [isProcessing, setIsProcessing] = useState<string | null>(null);
  const allTelemetryFlags = useMemo(() => {
    return detectFlaggedTelemetryErrors(biomarkers || {}, profile, biomarkerHistory || [], biomarkerDefinitions);
  }, [biomarkers, profile, biomarkerHistory]);
  const telemetryFlagMap = useMemo(() => {
    const map = new Map<string, any>();
    allTelemetryFlags.forEach(f => map.set(f.key, f));
    return map;
  }, [allTelemetryFlags]);
  useEffect(() => {
    const qid = generateQueryId();
    setActiveQueryId(qid);
    return () => {
      setActiveQueryId(null);
    };
  }, []);
  const [editMode, setEditMode] = useState<string | null>(null);
  const [showCombineModal, setShowCombineModal] = useState(false);
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [auditInitialTab, setAuditInitialTab] = useState<'overview' | 'corrupted_units' | 'duplicates' | 'missing_metadata' | 'conflicts' | 'clean'>('overview');
  const [auditInitialFocusKey, setAuditInitialFocusKey] = useState<string | null>(null);

  const handleOpenAuditForBiomarker = (key: string, tab: 'overview' | 'corrupted_units' | 'duplicates' | 'missing_metadata' | 'conflicts' | 'clean' = 'corrupted_units') => {
    setAuditInitialTab(tab);
    setAuditInitialFocusKey(key);
    setShowAuditModal(true);
  };
  const [isMedicalCategorisationMode, setIsMedicalCategorisationMode] = useState<boolean>(() => {
    try { return localStorage.getItem('dict_is_medical_categorisation_mode') === 'true'; } catch (e) {} return false;
  });
  const [isRangeCalibrationMode, setIsRangeCalibrationMode] = useState<boolean>(() => {
    try { return localStorage.getItem('dict_is_range_calibration_mode') === 'true'; } catch (e) {} return false;
  });
  const [editName, setEditName] = useState('');

  // Inline confirmation states (iframe safety)
  const [showResetChatConfirm, setShowResetChatConfirm] = useState(false);
  const [showDiscardResultsConfirm, setShowDiscardResultsConfirm] = useState(false);
  const [showDeleteSelectedConfirm, setShowDeleteSelectedConfirm] = useState(false);
  const [showDiscardSessionConfirm, setShowDiscardSessionConfirm] = useState(false);
  const [showAgentLogs, setShowAgentLogs] = useState(false);
  const [showNotUsedModal, setShowNotUsedModal] = useState(false);
  const [confirmDeleteLogId, setConfirmDeleteLogId] = useState<string | null>(null);

  // Data Accuracy Agent States
  const [isDataAccuracyMode, setIsDataAccuracyMode] = useState(false);
  const [dataAccuracyMessages, setDataAccuracyMessages] = useState<any[]>(() => {
    try {
      const saved = localStorage.getItem('data_accuracy_messages');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return [
      {
        id: 'acc_msg_init',
        role: 'assistant',
        content: 'Hello! I am the Data Accuracy Agent, your cleaning specialist. 🧪\n\nShare any new biomarker readings, laboratory results, or logs by **typing them down** or **uploading files/images**.\n\nI will compare your input with your existing database definitions and latest logs to highlight any differences in **Name, Unit, Value, Date, and Comments**, and generate an interactive table so you can choose which information to keep.',
        timestamp: new Date().toISOString()
      }
    ];
  });
  const [dataAccuracyInput, setDataAccuracyInput] = useState('');
  const [dataAccuracyLoading, setDataAccuracyLoading] = useState(false);
  const [accuracyUploadedFiles, setAccuracyUploadedFiles] = useState<{ name: string; type: string; base64?: string; text?: string }[]>([]);
  const [accuracyComparisonResults, setAccuracyComparisonResults] = useState<any[] | null>(() => {
    try {
      const saved = localStorage.getItem('data_accuracy_comparison_results');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return null;
  });
  const [accuracySelectedFields, setAccuracySelectedFields] = useState<{ 
    [biomarkerKey: string]: { 
      name: 'current' | 'shared'; 
      unit: 'current' | 'shared'; 
      value: 'current' | 'shared'; 
      date: 'current' | 'shared'; 
      comments: 'current' | 'shared'; 
      selected: boolean;
    } 
  }>(() => {
    try {
      const saved = localStorage.getItem('data_accuracy_selected_fields');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return {};
  });
  const [selectedLogFixKeys, setSelectedLogFixKeys] = useState<{ [logKey: string]: boolean }>({});

  // Automatically persist Data Accuracy Agent States
  useEffect(() => {
    if (dataAccuracyMessages && dataAccuracyMessages.length > 1) {
      localStorage.setItem('data_accuracy_messages', JSON.stringify(dataAccuracyMessages));
    } else {
      localStorage.removeItem('data_accuracy_messages');
    }
  }, [dataAccuracyMessages]);

  useEffect(() => {
    if (accuracyComparisonResults) {
      localStorage.setItem('data_accuracy_comparison_results', JSON.stringify(accuracyComparisonResults));
    } else {
      localStorage.removeItem('data_accuracy_comparison_results');
    }
  }, [accuracyComparisonResults]);

  useEffect(() => {
    if (accuracySelectedFields && Object.keys(accuracySelectedFields).length > 0) {
      localStorage.setItem('data_accuracy_selected_fields', JSON.stringify(accuracySelectedFields));
    } else {
      localStorage.removeItem('data_accuracy_selected_fields');
    }
  }, [accuracySelectedFields]);

  const fileInputRef2 = useRef<HTMLInputElement>(null);

  // Model Selection states
  const activeModel = selectedModelId || 'gemini-3.5-flash-lite';
  const [standardizeModel, setStandardizeModelRaw] = useState<string>(activeModel);
  const [medicalCategoriseModel, setMedicalCategoriseModelRaw] = useState<string>(activeModel);
  const [calibrateRangesModel, setCalibrateRangesModelRaw] = useState<string>(activeModel);
  const [dataAccuracyModel, setDataAccuracyModelRaw] = useState<string>(activeModel);
  const [nameConsolidationModel, setNameConsolidationModelRaw] = useState<string>(activeModel);

  useEffect(() => {
    if (selectedModelId) {
      setStandardizeModelRaw(selectedModelId);
      setMedicalCategoriseModelRaw(selectedModelId);
      setCalibrateRangesModelRaw(selectedModelId);
      setDataAccuracyModelRaw(selectedModelId);
      setNameConsolidationModelRaw(selectedModelId);
    }
  }, [selectedModelId]);

  const handleUpdateModel = (newModelId: string, setter: (val: string) => void) => {
    setter(newModelId);
    if (onChangeModelId) {
      onChangeModelId(newModelId);
    }
  };

  const setStandardizeModel = (id: string) => handleUpdateModel(id, setStandardizeModelRaw);
  const setMedicalCategoriseModel = (id: string) => handleUpdateModel(id, setMedicalCategoriseModelRaw);
  const setCalibrateRangesModel = (id: string) => handleUpdateModel(id, setCalibrateRangesModelRaw);
  const setDataAccuracyModel = (id: string) => handleUpdateModel(id, setDataAccuracyModelRaw);
  const setNameConsolidationModel = (id: string) => handleUpdateModel(id, setNameConsolidationModelRaw);

  // Instruction View states
  const [showStandardizeInstructions, setShowStandardizeInstructions] = useState<boolean>(false);
  const [showMedicalInstructions, setShowMedicalInstructions] = useState<boolean>(false);
  const [showCalibrateInstructions, setShowCalibrateInstructions] = useState<boolean>(false);
  const [showDataAccuracyInstructions, setShowDataAccuracyInstructions] = useState<boolean>(false);
  const [showConsolidationInstructions, setShowConsolidationInstructions] = useState<boolean>(false);

  // Clinical Unit Standardization Agent States
  const [isAgentMode, setIsAgentMode] = useState(false);
  const [targetMetric, setTargetMetric] = useState<'si' | 'us'>(() => (profile.unitPreference?.toLowerCase() as 'si' | 'us') || 'si');
  const [agentLoading, setAgentLoading] = useState(false);
  const [standardizationYaml, setStandardizationYaml] = useState<string | null>(() => {
    try { return localStorage.getItem('dict_standardization_yaml'); } catch (e) {} return null;
  });
  const [standardizationSummary, setStandardizationSummary] = useState<any[] | null>(() => {
    try {
      const saved = localStorage.getItem('dict_standardization_summary');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return null;
  });

  // Name Consolidation Agent States
  const [isNameConsolidationMode, setIsNameConsolidationMode] = useState<boolean>(false);
  const [consolidationYaml, setConsolidationYaml] = useState<string | null>(() => {
    try { return localStorage.getItem('dict_consolidation_yaml'); } catch (e) {} return null;
  });
  const [consolidationGroups, setConsolidationGroups] = useState<any[] | null>(() => {
    try {
      const saved = localStorage.getItem('dict_consolidation_groups');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return null;
  });
  const [consolidationLoading, setConsolidationLoading] = useState<boolean>(false);
  const [consolidationLiveThought, setConsolidationLiveThought] = useState<string>('');
  const [consolidationInput, setConsolidationInput] = useState<string>('');
  const [consolidationMessages, setConsolidationMessages] = useState<any[]>([]);
  const [groupEdits, setGroupEdits] = useState<any>({});
  const [showOnlyReduced, setShowOnlyReduced] = useState<boolean>(false);
  const reducedGroupsCount = useMemo(() => {
    if (!consolidationGroups || !Array.isArray(consolidationGroups)) return 0;
    return consolidationGroups.filter(group => {
      const keysList = Array.isArray(group.keys) ? group.keys : (Array.isArray(group.aliases) ? group.aliases : (group.biomarkers || []).map((b: any) => b.key));
      return keysList.length > 1;
    }).length;
  }, [consolidationGroups]);

  useEffect(() => {
    localStorage.setItem('dict_is_medical_categorisation_mode', isMedicalCategorisationMode ? 'true' : 'false');
  }, [isMedicalCategorisationMode]);

  useEffect(() => {
    localStorage.setItem('dict_is_range_calibration_mode', isRangeCalibrationMode ? 'true' : 'false');
  }, [isRangeCalibrationMode]);

  useEffect(() => {
    if (standardizationYaml) {
      localStorage.setItem('dict_standardization_yaml', standardizationYaml);
    } else {
      localStorage.removeItem('dict_standardization_yaml');
    }
    if (standardizationSummary) {
      localStorage.setItem('dict_standardization_summary', JSON.stringify(standardizationSummary));
    } else {
      localStorage.removeItem('dict_standardization_summary');
    }
  }, [standardizationYaml, standardizationSummary]);

  useEffect(() => {
    if (consolidationYaml) {
      localStorage.setItem('dict_consolidation_yaml', consolidationYaml);
    } else {
      localStorage.removeItem('dict_consolidation_yaml');
    }
    if (consolidationGroups) {
      localStorage.setItem('dict_consolidation_groups', JSON.stringify(consolidationGroups));
    } else {
      localStorage.removeItem('dict_consolidation_groups');
    }
  }, [consolidationYaml, consolidationGroups]);

  // Computed statistics for Name Consolidation Agent
  const totalOriginalBiomarkersInConsolidation = useMemo(() => {
    if (!consolidationGroups || !Array.isArray(consolidationGroups)) return 0;
    return consolidationGroups.reduce((acc, group, idx) => {
      const keysList = Array.isArray(group.keys) ? group.keys : (Array.isArray(group.aliases) ? group.aliases : (group.biomarkers || []));
      const edits = groupEdits[idx];
      const excludedCount = edits ? Object.values(edits.excludedKeys || {}).filter(Boolean).length : 0;
      return acc + Math.max(0, keysList.length - excludedCount);
    }, 0);
  }, [consolidationGroups, groupEdits]);

  const totalMasterBiomarkersInConsolidation = consolidationGroups ? consolidationGroups.length : 0;
  const totalBiomarkersReduced = Math.max(0, totalOriginalBiomarkersInConsolidation - totalMasterBiomarkersInConsolidation);

  // Selection states
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery || "");
  const [filterOption, setFilterOption] = useState<'all' | 'overrides' | 'missing_units'>('all');
  const [filterTag, setFilterTag] = useState<string | null>(null);
  
  // Chat States
  const [isChatMode, setIsChatMode] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Batch paste state
  const [isBatchPasteMode, setIsBatchPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [parsedMapping, setParsedMapping] = useState<{ [key: string]: string } | null>(null);

  // Debug Export State
  const [copiedDebugInfo, setCopiedDebugInfo] = useState(false);

  const handleCopyDebugInfo = async () => {
    const customBio = profile.customBiomarkers || {};
    const deletedKeys = profile.deletedCustomBiomarkerKeys;

    const historyKeySet = new Set<string>();
    if (Array.isArray(biomarkerHistory)) {
      biomarkerHistory.forEach(log => {
        if (log && log.biomarkers && typeof log.biomarkers === 'object') {
          Object.keys(log.biomarkers).forEach(k => {
            if (k) historyKeySet.add(k);
          });
        }
      });
    }
    const historyKeysNotInDictionary = Array.from(historyKeySet).filter(
      k => !(k in customBio)
    );

    const emptyDictionaryEntries = Object.entries(customBio).filter(
      ([key, val]: [string, any]) => {
        const name = val?.name;
        return !name || (typeof name === 'string' && name.trim() === '') || name === key;
      }
    );

    const debugData = {
      allCustomBiomarkers: profile.customBiomarkers,
      deletedKeys: deletedKeys,
      historyKeysNotInDictionary,
      emptyDictionaryEntries
    };

    try {
      await navigator.clipboard.writeText(JSON.stringify(debugData, null, 2));
      setCopiedDebugInfo(true);
      setTimeout(() => {
        setCopiedDebugInfo(false);
      }, 2000);
    } catch (err) {
      console.error("Failed to copy debug info to clipboard:", err);
    }
  };

  useEffect(() => {
    const pendingKeysStr = localStorage.getItem('consolidation_pending_keys');
    const pendingNote = localStorage.getItem('consolidation_pending_note');
    if (pendingKeysStr) {
      try {
        const keys = JSON.parse(pendingKeysStr);
        if (Array.isArray(keys) && keys.length > 0) {
          setSelectedKeys(keys);
          setIsNameConsolidationMode(true);
          if (pendingNote) {
            setConsolidationInput(pendingNote);
          }
        }
      } catch (e) {
        console.error('Failed to parse pending consolidation keys:', e);
      }
      localStorage.removeItem('consolidation_pending_keys');
      localStorage.removeItem('consolidation_pending_note');
    }
  }, []);

  const builtInKeys = biomarkerDefinitions.map(d => d.key);
  const customKeys = Object.keys(profile.customBiomarkers || {});

  const duplicateGroups = useMemo(() => {
    return getDuplicateAliasGroups(
      profile?.customBiomarkers || {},
      biomarkerHistory || [],
      biomarkers || {},
      profile?.deletedCustomBiomarkerKeys || {}
    );
  }, [profile?.customBiomarkers, profile?.deletedCustomBiomarkerKeys, biomarkerHistory, biomarkers]);

  const aliasKeysToHide = useMemo(() => {
    const keys = new Set<string>();
    duplicateGroups.forEach(g => {
      g.candidateAliases.forEach(a => keys.add(a));
    });
    return keys;
  }, [duplicateGroups]);
  
  const isUsefulBiomarkerValue = (val: any) => {
    return val !== undefined && val !== null && val !== '' && !Number.isNaN(val) && !(typeof val === 'string' && val.trim() === '');
  };

  // Pre-indexed log history map for O(1) item log lookup
  const historyLogsByKey = useMemo(() => {
    const map = new Map<string, any[]>();
    (biomarkerHistory || []).forEach((h: any) => {
      if (!h.biomarkers) return;
      Object.entries(h.biomarkers).forEach(([k, val]) => {
        if (isUsefulBiomarkerValue(val)) {
          const entry = {
            date: h.date,
            value: val,
            unit: (h as any).units?.[k] || (h as any).unit,
            normalRange: (h as any).normalRanges?.[k] || (h as any).normalRange
          };
          const kLower = k.toLowerCase();
          
          if (!map.has(k)) map.set(k, []);
          map.get(k)!.push(entry);

          if (kLower !== k) {
            if (!map.has(kLower)) map.set(kLower, []);
            map.get(kLower)!.push(entry);
          }
        }
      });
    });
    return map;
  }, [biomarkerHistory]);

  const aliasMap = useMemo(() => {
    const map = new Map<string, string[]>();
    duplicateGroups?.forEach((g: any) => {
      if (g.suggestedMasterKey && Array.isArray(g.candidateAliases)) {
        map.set(g.suggestedMasterKey.toLowerCase(), g.candidateAliases);
      }
    });
    return map;
  }, [duplicateGroups]);

  const collectItemLogs = useCallback((k: string) => {
    const kLower = k.toLowerCase();
    const directLogs = historyLogsByKey.get(k) || historyLogsByKey.get(kLower) || [];
    const aliases = aliasMap.get(kLower) || [];
    if (aliases.length === 0) {
      return directLogs;
    }
    
    // Combine logs if aliases exist
    const seenDates = new Set<string>();
    const result: any[] = [];
    
    directLogs.forEach(l => {
      seenDates.add(l.date);
      result.push(l);
    });

    for (const alias of aliases) {
      const aliasLogs = historyLogsByKey.get(alias) || historyLogsByKey.get(alias.toLowerCase()) || [];
      aliasLogs.forEach(l => {
        if (!seenDates.has(l.date)) {
          seenDates.add(l.date);
          result.push(l);
        }
      });
    }

    return result;
  }, [historyLogsByKey, aliasMap]);

  const [visibleApprovedCount, setVisibleApprovedCount] = useState<number>(40);

  // Reset visible approved count on query or filter change
  useEffect(() => {
    setVisibleApprovedCount(40);
  }, [searchQuery, filterOption, filterTag]);

  const historyKeys = useMemo(() => {
    const keys = new Set<string>();
    // Keys tombstoned via combine/delete must never resurface in the visible dictionary,
    // even when stale cloud history logs still carry the old alias key.
    const tombstoned = profile?.deletedCustomBiomarkerKeys || {};
    Object.entries(biomarkers || {}).forEach(([k, v]) => {
      if (isUsefulBiomarkerValue(v) && !tombstoned[k]) keys.add(k);
    });
    biomarkerHistory.forEach(log => {
      if (log.biomarkers) {
        Object.entries(log.biomarkers).forEach(([k, v]) => {
          if (isUsefulBiomarkerValue(v) && !tombstoned[k]) keys.add(k);
        });
      }
    });
    return Array.from(keys);
  }, [biomarkerHistory, biomarkers, profile?.deletedCustomBiomarkerKeys]);

  const hasActualOverride = React.useCallback((key: string): boolean => {
    const builtIn = biomarkerDefinitions.find((d: any) => d.key === key);

    // A built-in definition can ship its own structured/custom range data
    // (e.g. HbA1c's clinical thresholds) even when the user has never
    // touched profile.customBiomarkers for this key. Surface those too,
    // instead of guessing from a hardcoded key list.
    if (builtIn?.customRanges && builtIn.customRanges.length > 0) return true;
    if (builtIn?.structuredRanges && builtIn.structuredRanges.length > 0) return true;

    const custom = profile.customBiomarkers?.[key];
    if (!custom) return false;

    if (!builtIn) {
      // Truly custom biomarker is always considered custom
      return true;
    }

    // 1. Check for demographic-specific ranges
    if (custom.customRanges && custom.customRanges.length > 0) return true;

    // 2. Check for structured range overrides
    if (custom.structuredRanges && custom.structuredRanges.length > 0) return true;

    // 3. Check for custom range builder configuration
    if (custom.rangeConfig && Object.keys(custom.rangeConfig).length > 0) return true;

    // 4. Check for customized name
    if (custom.name && custom.name.trim() !== builtIn.name.trim()) return true;

    // 5. Check for customized unit
    const norm = (str: string) => (str || '').toLowerCase().trim().replace(/\s+/g, '');
    if (custom.unit && norm(custom.unit) !== norm(builtIn.unit)) return true;

    // 6. Check for customized flat normal range
    if (custom.normalRange && norm(custom.normalRange) !== norm(builtIn.normalRange)) return true;

    // 7. Check for customized description
    if (custom.description && custom.description.trim() !== (builtIn.descriptions?.en || '').trim()) return true;

    // 8. Check for customized medical grouping
    const standardGrouping = getBiomarkerMetadata(key).standardMedicalGrouping;
    if (custom.standardMedicalGrouping && custom.standardMedicalGrouping.trim().toLowerCase() !== standardGrouping.trim().toLowerCase()) return true;

    return false;
  }, [profile.customBiomarkers]);

  const isKeyNotUsed = useCallback((k: string) => {
    if (!profile?.notUsedBiomarkers) return false;
    if (profile.notUsedBiomarkers[k]) return true;
    const kLower = k.toLowerCase();
    return Object.keys(profile.notUsedBiomarkers).some(nok => nok.toLowerCase() === kLower);
  }, [profile?.notUsedBiomarkers]);

  const notUsedCount = useMemo(() => {
    return Object.keys(profile?.notUsedBiomarkers || {}).length;
  }, [profile?.notUsedBiomarkers]);

  const filterFn = (k: string) => {
    if (isKeyNotUsed(k)) return false;
    const q = searchQuery.toLowerCase();
    const custom = profile.customBiomarkers?.[k];
    const stdDef = biomarkerDefinitions.find((d: any) => d.key === k || (Array.isArray(d.aliases) && d.aliases.some((a: string) => a.toLowerCase() === k.toLowerCase())));
    const def = getMergedBiomarkerDef(k, stdDef, custom);
    
    if (filterOption === 'missing_units') {
      const unit = def?.unit || '';
      const range = def?.normalRange || '';
      const missingUnit = !unit || unit.trim() === '';
      const missingRange = !range || range.trim() === '' || range === 'Unknown';
      if (!missingUnit && !missingRange) return false;
    } else if (filterOption === 'overrides') {
      if (!hasActualOverride(k)) return false;
    }

    if (filterTag) {
      const meta = getBiomarkerMetadata(k, def);
      const tagLower = filterTag.toLowerCase();
      const hasTag = meta.standardMedicalGrouping?.toLowerCase() === tagLower ||
        meta.riskCategories?.some((r: string) => r.toLowerCase() === tagLower) ||
        meta.potentialMedicalConditions?.some((c: string) => c.toLowerCase() === tagLower) ||
        (def as any)?.category?.toLowerCase() === tagLower;
        
      if (!hasTag) return false;
    }

    if (!q) return true;
    if (!def) return k.toLowerCase().includes(q);
    const meta = getBiomarkerMetadata(k, def);
    const hasTagMatch = meta.standardMedicalGrouping?.toLowerCase().includes(q) ||
        meta.riskCategories?.some((r: string) => r.toLowerCase().includes(q)) ||
        meta.potentialMedicalConditions?.some((c: string) => c.toLowerCase().includes(q)) ||
        (def as any)?.category?.toLowerCase().includes(q);
    return k.toLowerCase().includes(q) || (def.name || '').toLowerCase().includes(q) || hasTagMatch;
  };

  const telemetryFlaggedKeySet = useMemo(() => new Set(telemetryFlagMap.keys()), [telemetryFlagMap]);
  const checkKeyNeedsApproval = (k: string) => isBiomarkerNeedingReview(k, profile, biomarkerHistory, biomarkers, biomarkerDefinitions, telemetryFlaggedKeySet);

  const allApprovedKeysUnfiltered = useMemo(() => {
    const keys = new Set<string>();
    
    // Check all known keys (built-in, custom, and history)
    const allKnown = new Set([...builtInKeys, ...customKeys, ...historyKeys]);
    
    allKnown.forEach(k => {
      if (isKeyNotUsed(k)) return;
      if (filterOption !== 'missing_units' && checkKeyNeedsApproval(k)) {
        return;
      }
      keys.add(k);
    });
    
    // If no search query and not filtering missing_units, only show approved keys that are actively used (in history or customized)
    const result = Array.from(keys);
    if (searchQuery.trim() === '' && filterOption !== 'missing_units') {
      return result.filter(k => historyKeys.includes(k) || customKeys.includes(k));
    }
    return result;
  }, [builtInKeys, customKeys, historyKeys, profile.customBiomarkers, searchQuery, biomarkerHistory, filterOption, isKeyNotUsed]);

  const missingUnitsCount = useMemo(() => {
    let count = 0;
    const allKnown = new Set([...historyKeys, ...customKeys, ...builtInKeys]);
    allKnown.forEach(k => {
      if (isKeyNotUsed(k)) return;
      const builtIn = biomarkerDefinitions.find((d: any) => d.key === k || (Array.isArray(d.aliases) && d.aliases.some((a: string) => a.toLowerCase() === k)));
      const custom = profile.customBiomarkers?.[k];
      const itemLogs = collectItemLogs(k);
      const combined = getMergedBiomarkerDef(k, builtIn, custom, itemLogs);
      const missingUnit = !combined.unit || combined.unit.trim() === '';
      const missingRange = !combined.normalRange || combined.normalRange.trim() === '' || combined.normalRange === 'Unknown';
      if (missingUnit || missingRange) count++;
    });
    return count;
  }, [historyKeys, customKeys, builtInKeys, profile.customBiomarkers, biomarkerHistory, isKeyNotUsed]);

  const allApprovedKeys = useMemo(() => {
    return allApprovedKeysUnfiltered.filter(filterFn).filter(k => !aliasKeysToHide.has(k));
  }, [allApprovedKeysUnfiltered, searchQuery, profile.customBiomarkers, filterOption, filterTag, aliasKeysToHide]);

  const toApproveKeys = useMemo(() => {
    if (filterOption === 'missing_units') return [];
    const keys = new Set([...historyKeys, ...customKeys]);
    return Array.from(keys).filter(k => checkKeyNeedsApproval(k)).filter(filterFn).filter(k => !aliasKeysToHide.has(k));
  }, [historyKeys, customKeys, searchQuery, profile.customBiomarkers, filterOption, biomarkerHistory, filterTag, aliasKeysToHide]);

  const { allGroupings, allRisks, allConditions } = useMemo(() => {
    const groupings = new Set<string>();
    const risks = new Set<string>();
    const conditions = new Set<string>();
    
    // Check built-in and history/custom
    const allKnownKeys = new Set([...builtInKeys, ...customKeys, ...historyKeys]);
    allKnownKeys.forEach(k => {
      if (isKeyNotUsed(k)) return;
      const def = profile.customBiomarkers?.[k] || biomarkerDefinitions.find((b: any) => b.key === k);
      if (def?.standardMedicalGrouping) groupings.add(def.standardMedicalGrouping);
      if (def?.riskCategories) def.riskCategories.forEach((r: string) => risks.add(r));
      if (def?.potentialMedicalConditions) def.potentialMedicalConditions.forEach((c: string) => conditions.add(c));
    });
    return {
      allGroupings: Array.from(groupings).sort(),
      allRisks: Array.from(risks).sort(),
      allConditions: Array.from(conditions).sort()
    };
  }, [builtInKeys, customKeys, historyKeys, profile.customBiomarkers, isKeyNotUsed]);

  


  const allAvailableKeys = useMemo(() => {
    return [...toApproveKeys, ...allApprovedKeys].filter(k => !aliasKeysToHide.has(k));
  }, [toApproveKeys, allApprovedKeys, aliasKeysToHide]);

  const totalUniqueCount = useMemo(() => {
    const keys = new Set<string>();
    [...historyKeys, ...customKeys].forEach(k => {
      if (!isKeyNotUsed(k) && !aliasKeysToHide.has(k)) {
        keys.add(k);
      }
    });
    return keys.size;
  }, [historyKeys, customKeys, isKeyNotUsed, aliasKeysToHide]);

  const pendingBiomarkersCount = toApproveKeys.length;

  const keysNeedingCategory = useMemo(() => {
    return toApproveKeys.filter(k => {
      const builtIn = biomarkerDefinitions.find((d: any) => d.key === k || (Array.isArray(d.aliases) && d.aliases.some((a: string) => a.toLowerCase() === k)));
      const custom = profile.customBiomarkers?.[k];
      const itemLogs = collectItemLogs(k);
      const def = getMergedBiomarkerDef(k, builtIn, custom, itemLogs);
      return !def.standardMedicalGrouping || def.standardMedicalGrouping.trim() === '' || def.standardMedicalGrouping === 'Other' || !Array.isArray(def.riskCategories) || def.riskCategories.length === 0 || def.riskCategories.includes('Uncategorized');
    });
  }, [toApproveKeys, profile.customBiomarkers, biomarkerHistory]);

  const keysNeedingUnit = useMemo(() => {
    return toApproveKeys.filter(k => {
      const builtIn = biomarkerDefinitions.find((d: any) => d.key === k || (Array.isArray(d.aliases) && d.aliases.some((a: string) => a.toLowerCase() === k)));
      const custom = profile.customBiomarkers?.[k];
      const itemLogs = collectItemLogs(k);
      const def = getMergedBiomarkerDef(k, builtIn, custom, itemLogs);
      return !def.unit || def.unit.trim() === '';
    });
  }, [toApproveKeys, profile.customBiomarkers, biomarkerHistory]);

  const handleBulkReviewCategories = () => {
    setSelectedKeys(keysNeedingCategory);
    setIsMedicalCategorisationMode(true);
    setIsRangeCalibrationMode(false);
    setIsAgentMode(true);
    setIsDataAccuracyMode(false);
    setIsNameConsolidationMode(false);
    setIsChatMode(false);
    setStandardizationYaml(null);
    setStandardizationSummary(null);
    handleRunStandardizationAgent(keysNeedingCategory, 'categorise');
  };

  const handleBulkStandardizeUnits = () => {
    const keysToStandardize = (keysNeedingUnit.length > 0 ? keysNeedingUnit : (selectedKeys.length > 0 ? selectedKeys : historyKeys));
    setSelectedKeys(keysToStandardize);
    setIsMedicalCategorisationMode(false);
    setIsRangeCalibrationMode(false);
    setIsAgentMode(true);
    setIsDataAccuracyMode(false);
    setIsNameConsolidationMode(false);
    setIsChatMode(false);
    setStandardizationYaml(null);
    setStandardizationSummary(null);
    handleRunStandardizationAgent(keysToStandardize, 'standardize');
  };

  const handleBulkCalibrateRanges = (keysToCalibrate?: string[]) => {
    const keys = (keysToCalibrate && keysToCalibrate.length > 0) 
      ? keysToCalibrate 
      : (selectedKeys.length > 0 ? selectedKeys : historyKeys);
    setSelectedKeys(keys);
    setIsRangeCalibrationMode(true);
    setIsMedicalCategorisationMode(false);
    setIsAgentMode(true);
    setIsDataAccuracyMode(false);
    setIsNameConsolidationMode(false);
    setIsChatMode(false);
    setStandardizationYaml(null);
    setStandardizationSummary(null);
    handleRunStandardizationAgent(keys, 'calibrate');
  };

  const handleBulkConsolidateNames = () => {
    setSelectedKeys(toApproveKeys);
    setIsNameConsolidationMode(true);
    setIsAgentMode(false);
    setIsMedicalCategorisationMode(false);
    setIsDataAccuracyMode(false);
    setIsChatMode(false);
    setConsolidationYaml(null);
    setConsolidationGroups(null);
    handleRunConsolidationAgent(true, toApproveKeys);
  };

  // Handle single Route Agent logic (legacy, but we can make it start a chat for that single key!)
  const handleRouteBiomarker = (key: string) => {
    setSelectedKeys([key]);
    startChatWithKeys([key]);
  };

  const startChatWithKeys = (keysToRoute: string[]) => {
    if (keysToRoute.length === 0) return;
    setIsChatMode(true);
    
    // Create initial message
    const listString = keysToRoute.map(k => {
      const customDef = profile.customBiomarkers?.[k];
      return `"${customDef?.name || k}" (key: ${k})`;
    }).join(', ');

    const initialMessage: ChatMessage = {
      id: `welcome_${Date.now()}`,
      role: 'assistant',
      content: `Hello! I am your Clinical Ontology and Database Route Agent. I see we have selected **${keysToRoute.length}** biomarker(s) to route and consolidate:
      
${keysToRoute.map(k => `• **${profile.customBiomarkers?.[k]?.name || k}** (\`${k}\`)`).join('\n')}

I can analyze these, compare them with our database keys, and find standard mappings or define new standard entities. How would you like to proceed? You can ask me questions, or click **"Request Suggestions"** to have me automatically map them for you!`
    };

    setChatMessages([initialMessage]);
  };

  const handleSendChat = async (overridePrompt?: string) => {
    const textToSend = overridePrompt || chatInput;
    if (!textToSend.trim() || isChatLoading) return;

    const userMsg: ChatMessage = { id: `user_${Date.now()}`, role: 'user', content: textToSend };
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput('');
    setIsChatLoading(true);

    try {
      const selectedBiomarkerDetails = selectedKeys.map(k => {
        const customDef = profile.customBiomarkers?.[k];
        return {
          key: k,
          name: customDef?.name || k,
          unit: customDef?.unit || '',
          description: customDef?.description || ''
        };
      });

      const nextMessages = [...chatMessages, userMsg].map(m => ({
        role: m.role,
        content: m.content
      }));

      const res = await fetch('/api/gemini/route-chat', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Session-ID': generateQueryId()
        },
        body: JSON.stringify({
          messages: nextMessages,
          selectedBiomarkers: selectedBiomarkerDetails,
          allApprovedKeys
        })
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        let errMsg = `Failed to chat with route agent (${res.status})`;
        try {
          const errJson = JSON.parse(errText);
          if (errJson && errJson.error) errMsg = errJson.error;
        } catch {
          if (errText && errText.trim() && !errText.includes('<!doctype')) errMsg = errText.trim().slice(0, 150);
        }
        throw new Error(errMsg);
      }
      const resText = await res.text();
      let result: any = {};
      try {
        result = JSON.parse(resText);
      } catch {
        throw new Error("Server returned an invalid non-JSON response.");
      }

      setChatMessages(prev => [...prev, {
        id: `assistant_${Date.now()}`,
        role: 'model',
        content: result.text,
        suggestedMapping: result.suggestedMapping
      }]);
    } catch (e: any) {
      console.error(e);
      setChatMessages(prev => [...prev, {
        id: `error_${Date.now()}`,
        role: 'model',
        content: `Error communicating with Route Agent: ${e.message || "Unknown error"}. Please check your connection and try again.`
      }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  // Scroll chat to bottom
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, isChatLoading]);

  // Apply a specific suggestion mapping
  const handleApplySuggestedMapping = (mapping: { [key: string]: string }) => {
    if (!onBatchConsolidate) return;
    try {
      onBatchConsolidate(mapping);
      alert(t(profile.language, 'dictAlertConsolidated'));
      setIsChatMode(false);
      setSelectedKeys([]);
    } catch (e) {
      console.error(e);
      alert(t(profile.language, 'dictAlertMappingError'));
    }
  };

  // Data Accuracy Agent Helper Functions
  const handleAccuracyFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files ? Array.from(e.target.files) : [];
    if (fileList.length === 0) return;

    fileList.forEach((file: any) => {
      const reader = new FileReader();
      if (file.type.startsWith('image/')) {
        reader.onloadend = () => {
          setAccuracyUploadedFiles(prev => [...prev, {
            name: file.name,
            type: file.type,
            base64: reader.result as string
          }]);
        };
        reader.readAsDataURL(file);
      } else {
        reader.onloadend = () => {
          setAccuracyUploadedFiles(prev => [...prev, {
            name: file.name,
            type: file.type,
            text: reader.result as string
          }]);
        };
        reader.readAsText(file);
      }
    });

    e.target.value = '';
  };

  const removeAccuracyFile = (idx: number) => {
    setAccuracyUploadedFiles(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSendDataAccuracy = async () => {
    const text = dataAccuracyInput.trim();
    const attachedFiles = [...accuracyUploadedFiles];
    if (!text && attachedFiles.length === 0) return;

    setDataAccuracyInput('');
    setAccuracyUploadedFiles([]);

    const fileNames = attachedFiles.map(f => f.name).join(', ');
    const displayContent = text + (attachedFiles.length > 0 ? `\n[Attached files: ${fileNames}]` : '');

    const userMsg = {
      id: `acc_msg_${Date.now()}`,
      role: 'user',
      content: displayContent,
      timestamp: new Date().toISOString()
    };

    const updatedMessages = [...dataAccuracyMessages, userMsg];
    setDataAccuracyMessages(updatedMessages);
    setDataAccuracyLoading(true);

    try {
      const currentCustomBiomarkers = profile.customBiomarkers || {};
      const latestValues: { [key: string]: { value: any; date: string; note: string; logId: string; }[] } = {};
      const sortedHistory = [...biomarkerHistory].sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));
      
      const allKnownKeys = selectedKeys.length > 0
        ? new Set<string>(selectedKeys)
        : new Set<string>([
            ...biomarkerDefinitions.map(d => d.key),
            ...Object.keys(currentCustomBiomarkers)
          ]);

      allKnownKeys.forEach((key: string) => {
        const matchingLogs = sortedHistory.filter(h => h.biomarkers && h.biomarkers[key] !== undefined);
        if (matchingLogs.length > 0) {
          latestValues[key] = matchingLogs.map(matchingLog => {
            const testDetail = matchingLog.tests?.find(t => t.key === key);
            return {
              value: matchingLog.biomarkers[key],
              date: matchingLog.date,
              note: testDetail?.doctorComment || matchingLog.note || '',
              logId: matchingLog.id
            };
          });
        }
      });

      const filteredCustomBiomarkers: { [key: string]: any } = {};
      if (selectedKeys.length > 0) {
        selectedKeys.forEach(k => {
          if (currentCustomBiomarkers[k]) {
            filteredCustomBiomarkers[k] = currentCustomBiomarkers[k];
          }
        });
      } else {
        Object.assign(filteredCustomBiomarkers, currentCustomBiomarkers);
      }

      const currentState = {
        customBiomarkers: filteredCustomBiomarkers,
        historyValues: latestValues
      };

      const imagesForAPI = attachedFiles
        .filter(f => f.base64)
        .map(f => f.base64!);

      let promptText = text;
      attachedFiles.forEach(f => {
        if (f.text) {
          promptText += `\n\n--- Content of file: ${f.name} ---\n${f.text}\n--- End of file ---`;
        }
      });

      trackApiCall('gemini', `Data Accuracy`);
      const response = await fetch('/api/gemini/data-accuracy', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Session-ID': generateQueryId()
        },
        body: JSON.stringify({
          inputText: promptText,
          currentState,
          images: imagesForAPI,
          currentLocalTime: new Date().toLocaleDateString(),
          engine: dataAccuracyModel,
          customSystemInstruction: localStorage.getItem('custom_system_instruction_data_accuracy') || undefined
        })
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        let errMsg = `Data accuracy check error (${response.status}): ${response.statusText}`;
        try {
          const errJson = JSON.parse(errText);
          if (errJson && errJson.error) errMsg = errJson.error;
        } catch {
          if (errText && errText.trim() && !errText.includes('<!doctype')) errMsg = errText.trim().slice(0, 150);
        }
        throw new Error(errMsg);
      }

      const resText = await response.text();
      let result: any = {};
      try {
        result = JSON.parse(resText);
      } catch {
        throw new Error("Server returned an invalid non-JSON response.");
      }
      const sessionId = generateQueryId();

      // Capture and save agent debug logs for this request
      try {
        const logsRes = await fetch(`/api/gemini/debug-logs?sessionId=${sessionId}`);
        if (logsRes.ok) {
          const logsText = await logsRes.text().catch(() => "");
          const logsData = logsText ? JSON.parse(logsText) : null;
          if (logsData && logsData.logs && logsData.logs.length > 0) {
            saveAgentRequestLog({
              id: sessionId,
              timestamp: new Date().toISOString(),
              summary: `[Accuracy] Checked accuracy of ${selectedKeys.length || 'all'} biomarker(s)`,
              logs: logsData.logs
            });
          }
        }
      } catch (e) {
        console.warn("Could not save agent request logs", e);
      }

      // Save the agent payload/analysis results to the user profile's log history (agentAnalyses)
      const newAnalysis = {
        id: `analysis_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        agentType: 'data_accuracy',
        date: new Date().toISOString(),
        result: {
          inputText: promptText,
          explanation: result.explanation || '',
          comparisonResults: result.comparisonResults || []
        }
      };
      
      if (onAgentAnalysisSaved) {
        await onAgentAnalysisSaved('data_accuracy', {
          inputText: promptText,
          explanation: result.explanation || '',
          comparisonResults: result.comparisonResults || []
        });
      } else {
        const currentAnalyses = profile.agentAnalyses || [];
        onUpdateProfile({
          agentAnalyses: [...currentAnalyses, newAnalysis]
        });
      }

      const agentMsg = {
        id: `acc_msg_${Date.now() + 1}`,
        role: 'assistant',
        content: result.explanation || "I have analyzed the provided biomarker details and compared them with your database.",
        timestamp: new Date().toISOString()
      };

      setDataAccuracyMessages(prev => [...prev, agentMsg]);

      if (result.comparisonResults && Array.isArray(result.comparisonResults) && result.comparisonResults.length > 0) {
        setAccuracyComparisonResults(result.comparisonResults);

        const initialSelectedFields: any = {};
        result.comparisonResults.forEach((item: any) => {
          initialSelectedFields[item.key] = {
            name: item.name.status === 'different' ? 'shared' : 'current',
            unit: item.unit.status === 'different' ? 'shared' : 'current',
            value: item.value.status === 'different' ? 'shared' : 'current',
            date: item.date.status === 'different' ? 'shared' : 'current',
            comments: item.comments.status === 'different' ? 'shared' : 'current',
            selected: true
          };
        });
        setAccuracySelectedFields(initialSelectedFields);
      }

    } catch (err: any) {
      console.error("[Data Accuracy Agent Error]:", err);
      const errorMsg = {
        id: `acc_msg_${Date.now() + 1}`,
        role: 'assistant',
        content: `Sorry, I encountered an error while processing and comparing your data: ${err.message}. Please check your connection and try again.`,
        timestamp: new Date().toISOString()
      };
      setDataAccuracyMessages(prev => [...prev, errorMsg]);
    } finally {
      setDataAccuracyLoading(false);
    }
  };

  const applySelectedAccuracyUpdates = async () => {
    if (!accuracyComparisonResults) return;

    const selectedUpdates = accuracyComparisonResults.filter(item => accuracySelectedFields[item.id]?.selected);
    if (selectedUpdates.length === 0) {
      alert(t(profile.language, 'dictAlertSelectUpdate'));
      return;
    }

    const newCustomBiomarkers = { ...profile.customBiomarkers };
    const entriesByDate: { [date: string]: { biomarkers: { [key: string]: number | string }; tests: any[] } } = {};

    selectedUpdates.forEach(item => {
      const fieldSelects = accuracySelectedFields[item.id];
      
      const targetName = fieldSelects.name === 'shared' ? item.name.shared : item.name.current;
      const targetUnit = fieldSelects.unit === 'shared' ? item.unit.shared : item.unit.current;

      const builtIn = biomarkerDefinitions.find(d => d.key === item.key);
      const custom = profile.customBiomarkers?.[item.key];
      const combinedDef = { ...builtIn, ...custom };

      newCustomBiomarkers[item.key] = {
        ...combinedDef,
        name: targetName && targetName !== 'N/A' ? targetName : (combinedDef.name || item.key),
        unit: targetUnit && targetUnit !== 'N/A' ? targetUnit : (combinedDef.unit || '')
      };

      const targetValue = fieldSelects.value === 'shared' ? item.value.shared : item.value.current;
      const targetDate = fieldSelects.date === 'shared' ? item.date.shared : item.date.current;
      const targetComment = fieldSelects.comments === 'shared' ? item.comments.shared : item.comments.current;

      let finalDate = targetDate && targetDate !== 'N/A' ? targetDate : new Date().toISOString().split('T')[0];
      if (finalDate.includes('/')) {
        try {
          const parsedD = new Date(finalDate);
          if (!isNaN(parsedD.getTime())) {
            finalDate = parsedD.toISOString().split('T')[0];
          }
        } catch (_) {}
      }

      if (targetValue !== undefined && targetValue !== 'N/A') {
        if (!entriesByDate[finalDate]) {
          entriesByDate[finalDate] = {
            biomarkers: {},
            tests: []
          };
        }

        entriesByDate[finalDate].biomarkers[item.key] = targetValue;

        entriesByDate[finalDate].tests.push({
          key: item.key,
          originalTestName: targetName,
          valueNumeric: typeof targetValue === 'number' ? targetValue : parseFloat(String(targetValue)) || null,
          valueString: typeof targetValue === 'string' ? targetValue : String(targetValue),
          unit: targetUnit,
          doctorComment: targetComment && targetComment !== 'N/A' ? targetComment : undefined
        });
      }
    });

    const entriesToLog = Object.entries(entriesByDate).map(([date, data]) => ({
      date,
      biomarkers: data.biomarkers,
      tests: data.tests
    }));

    try {
      if (onLogMedical) {
        await onLogMedical({}, { customBiomarkers: newCustomBiomarkers }, undefined, entriesToLog, undefined, true);
        
        const successMsg = {
          id: `acc_msg_success_${Date.now()}`,
          role: 'assistant',
          content: interpolate(t(profile.language, 'dictChatAccuracyApplied'), { n: selectedUpdates.length }),
          timestamp: new Date().toISOString()
        };
        setDataAccuracyMessages(prev => [...prev, successMsg]);
        setAccuracyComparisonResults(null);
      } else {
        onUpdateProfile({ customBiomarkers: newCustomBiomarkers });
        alert(t(profile.language, 'dictAlertDictUpdated'));
      }
    } catch (err: any) {
      console.error("Failed to apply accuracy updates:", err);
      alert(interpolate(t(profile.language, 'dictAlertApplyUpdates'), { msg: err.message }));
    }
  };

  // Scroll accuracy chat to bottom
  const accuracyChatEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (accuracyChatEndRef.current) {
      accuracyChatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [dataAccuracyMessages, dataAccuracyLoading]);

  // Toggle checkbox helper
  const handleToggleSelect = (key: string) => {
    setSelectedKeys(prev => {
      if (prev.includes(key)) {
        return prev.filter(k => k !== key);
      } else {
        return [...prev, key];
      }
    });
  };

  // Select all helper
  const handleToggleSelectAll = (keysList: string[]) => {
    const allSelected = keysList.every(k => selectedKeys.includes(k));
    if (allSelected) {
      // Unselect all of these
      setSelectedKeys(prev => prev.filter(k => !keysList.includes(k)));
    } else {
      // Select all of these
      setSelectedKeys(prev => Array.from(new Set([...prev, ...keysList])));
    }
  };

  // Validate pasted batch JSON
  const handlePasteChange = (text: string) => {
    setPasteText(text);
    if (!text.trim()) {
      setParsedMapping(null);
      setPasteError(null);
      return;
    }
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed !== 'object' || parsed === null) {
        throw new Error("Pasted content must be a JSON Object or Array.");
      }
      setParsedMapping(parsed);
      setPasteError(null);
    } catch (e: any) {
      setParsedMapping(null);
      setPasteError(e.message || "Invalid JSON format.");
    }
  };

  // Apply batch consolidation
  const handleApplyBatchConsolidate = () => {
    if (!parsedMapping) return;
    try {
      let isMapping = false;
      let isUpdate = false;
      const updatesToApply: any = {};
      const mappingToApply: any = {};

      if (Array.isArray(parsedMapping)) {
        isUpdate = true;
        parsedMapping.forEach((item: any) => {
          if (item.key) {
            updatesToApply[item.key] = { ...item };
            delete updatesToApply[item.key].key;
          }
        });
      } else {
        Object.entries(parsedMapping).forEach(([k, v]: [string, any]) => {
          if (typeof v === 'string') {
            isMapping = true;
            mappingToApply[k] = v;
          } else if (typeof v === 'object' && v !== null) {
            isUpdate = true;
            updatesToApply[k] = v;
          }
        });
      }

      if (isMapping && onBatchConsolidate) {
        onBatchConsolidate(mappingToApply);
      }
      
      if (isUpdate) {
        const newCustoms = { ...(profile.customBiomarkers || {}) };
        Object.entries(updatesToApply).forEach(([k, v]: [string, any]) => {
          newCustoms[k] = { ...(newCustoms[k] || {}), ...v };
        });
        onUpdateProfile({ customBiomarkers: newCustoms });
      }

      alert(t(profile.language, 'dictAlertBatchDone'));
      setIsBatchPasteMode(false);
      setPasteText('');
      setParsedMapping(null);
    } catch (e: any) {
      alert(interpolate(t(profile.language, 'dictAlertOpFailed'), { msg: e.message }));
    }
  };

  // Run Clinical Unit Standardization / Categorisation / Range Calibration Agent
  const handleRunStandardizationAgent = async (keysOverride?: string[], modeOverride?: 'categorise' | 'standardize' | 'calibrate') => {
    const currentMode = modeOverride || (isRangeCalibrationMode ? 'calibrate' : isMedicalCategorisationMode ? 'categorise' : 'standardize');
    const isCalibrate = currentMode === 'calibrate';
    const isCategorise = currentMode === 'categorise';
    const keysToUse = (keysOverride && keysOverride.length > 0) ? keysOverride : selectedKeys;
    if (keysToUse.length === 0) return;
    setAgentLoading(true);
    setStandardizationYaml(null);
    setStandardizationSummary(null);

    try {
      const selectedBiomarkerDetails = keysToUse.map(k => {
        const customDef = profile.customBiomarkers?.[k] || biomarkerDefinitions.find((b: any) => b.key === k);
        const rawLogs = collectItemLogs(k);
        const sampleLogs = rawLogs.map((l: any) => ({
          date: l.date,
          value: l.value !== undefined ? l.value : l.val,
          logId: l.logId || l.id
        })).sort((a: any, b: any) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));
        return {
          key: k,
          name: customDef?.name || k,
          currentUnit: customDef?.unit || '',
          currentRange: customDef?.normalRange || '',
          currentGrouping: customDef?.standardMedicalGrouping || '',
          description: (customDef as any)?.description || '',
          sampleLogs: sampleLogs.slice(0, 8)
        };
      });

      // Get session ID for telemetry / backend logging isolation
      const sessionId = generateQueryId();

      const endpoint = isCalibrate 
        ? '/api/gemini/calibrate-reference-ranges' 
        : (isCategorise ? '/api/gemini/medical-categorise' : '/api/gemini/standardize-units');
      const agentKey = isCalibrate ? 'calibrate_ranges' : (isCategorise ? 'medical_categorise' : 'standardize');
      const chosenEngine = isCalibrate ? calibrateRangesModel : (isCategorise ? medicalCategoriseModel : standardizeModel);

      trackApiCall('gemini', `${endpoint}`);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Session-ID': sessionId
        },
        body: JSON.stringify({
          selectedBiomarkers: selectedBiomarkerDetails,
          metricSystem: targetMetric,
          unitPreference: targetMetric === 'us' ? 'US' : (profile.unitPreference || 'SI'),
          engine: chosenEngine,
          customSystemInstruction: localStorage.getItem(`custom_system_instruction_${agentKey}`) || undefined
        })
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        let errMsg = isCalibrate 
          ? `Reference range calibration error (${res.status})` 
          : (isCategorise ? `Medical categorisation error (${res.status})` : `Standardization error (${res.status})`);
        try {
          const errJson = JSON.parse(errText);
          if (errJson && errJson.error) errMsg = errJson.error;
        } catch {
          if (errText && errText.trim() && !errText.includes('<!doctype')) errMsg = errText.trim().slice(0, 150);
        }
        throw new Error(errMsg);
      }

      const resText = await res.text();
      let data: any = {};
      try {
        data = JSON.parse(resText);
      } catch {
        throw new Error("Server returned an invalid non-JSON response.");
      }
      
      let jsonData: any = null;
      try {
        if (data && typeof data.jsonResponse === 'object' && data.jsonResponse !== null) {
          jsonData = data.jsonResponse;
        } else if (data && typeof data.jsonResponse === 'string') {
          let rawText = data.jsonResponse.replace(/```(?:json)?/gi, '').replace(/```/gi, '').trim();
          jsonData = JSON.parse(rawText);
        } else if (data && typeof data === 'object' && !data.error) {
          jsonData = data;
        }
      } catch (error) {
        console.error("Failed to parse agent JSON output:", error);
      }
      setStandardizationYaml(jsonData ? JSON.stringify(jsonData, null, 2) : null);
      
      let parsed: any[] = [];
      if (Array.isArray(jsonData)) {
        parsed = jsonData;
      } else if (jsonData && typeof jsonData === 'object') {
        parsed = jsonData.calibratedBiomarkers || jsonData.mappedBiomarkers || jsonData.categorisedBiomarkers || [];
      }

      // If agent returned empty array or parsing failed, fallback gracefully to selected keys
      if (parsed.length === 0 && keysToUse.length > 0) {
        parsed = keysToUse.map(k => ({
          originalKey: k,
          standardizedUnit: profile.customBiomarkers?.[k]?.unit || biomarkerDefinitions.find((b: any) => b.key === k)?.unit || '',
          conversionFactor: 1,
          valueMultiplier: 1,
          confidence: 'medium',
          notes: 'Standardized using active profile definition'
        }));
      }

      const initialSelectedLogFixes: { [key: string]: boolean } = {};

      // Normalize key + unit field name & robust categorisation/range fallbacks
      parsed = parsed.map((item: any) => {
        const itemKey = item.originalKey || item.key;
        const customDef = profile.customBiomarkers?.[itemKey] || biomarkerDefinitions.find((b: any) => b.key === itemKey);
        const builtInDef = biomarkerDefinitions.find((b: any) => b.key === itemKey || (Array.isArray(b.aliases) && b.aliases.some((a: string) => a.toLowerCase() === itemKey.toLowerCase())));
        const itemName = item.name || customDef?.name || builtInDef?.name || itemKey;
        const rawRange = item.normalRange !== undefined ? item.normalRange : (customDef as any)?.normalRange;
        const range = (rawRange && rawRange !== 'Unknown' && rawRange !== 'unset' && rawRange !== 'n/a' && rawRange !== '-') ? rawRange : builtInDef?.normalRange;
        
        let grouping = item.standardMedicalGrouping;
        if (!grouping || grouping === 'N/A' || grouping.trim() === '') {
          grouping = (customDef?.standardMedicalGrouping && customDef.standardMedicalGrouping !== 'By Medical Practice' && customDef.standardMedicalGrouping !== 'Other')
            ? customDef.standardMedicalGrouping
            : (itemKey.toLowerCase().includes('audit') || itemKey.toLowerCase().includes('score') ? 'Behavioral & Mental Health' : 'Screenings & Assessments');
        }

        let risks = item.riskCategories;
        if (typeof risks === 'string') {
          try { risks = JSON.parse(risks); } catch (e) { risks = risks.split(',').map((s: string) => s.trim()); }
        }
        if (!Array.isArray(risks) || risks.length === 0) {
          risks = customDef?.riskCategories && customDef.riskCategories.length > 0 ? customDef.riskCategories : ["Screenings"];
        }

        let conds = item.potentialMedicalConditions;
        if (typeof conds === 'string') {
          try { conds = JSON.parse(conds); } catch (e) { conds = conds.split(',').map((s: string) => s.trim()); }
        }
        if (!Array.isArray(conds) || conds.length === 0) {
          conds = customDef?.potentialMedicalConditions && customDef.potentialMedicalConditions.length > 0 ? customDef.potentialMedicalConditions : ["General Health Assessment"];
        }

        // Programmatic batch calculation of affected historical logs using agent's valueMultiplier / telemetry multiplier
        let multiplier = typeof item.valueMultiplier === 'number' && item.valueMultiplier > 0 ? item.valueMultiplier : 1;
        let adjustmentReason = item.valueAdjustmentReason;

        // Hybrid Intelligence: if the agent returned multiplier 1, check if telemetry detection finds an obvious scale mismatch
        const rawItemLogs = collectItemLogs(itemKey);
        if (multiplier === 1 && rawItemLogs.length > 0) {
          const outlierEntry = rawItemLogs.find((l: any) => {
            const val = l.value !== undefined ? l.value : l.val;
            const num = typeof val === 'number' ? val : parseFloat(String(val));
            return !isNaN(num) && isBiomarkerValueImprobable(itemKey, num, range);
          });
          if (outlierEntry) {
            const rawVal = outlierEntry.value !== undefined ? outlierEntry.value : outlierEntry.val;
            const telemetryFix = computeBiomarkerTelemetryMultiplier(itemKey, rawVal, range, profile.language);
            if (telemetryFix) {
              multiplier = telemetryFix.multiplier;
              adjustmentReason = telemetryFix.reason;
            }
          }
        }

        const isUnitConversion = Boolean(
          item.standardizedUnit &&
          customDef?.unit &&
          item.standardizedUnit.toLowerCase() !== String(customDef.unit).toLowerCase() &&
          item.conversionFactor &&
          item.conversionFactor !== 1
        );

        const affectedLogs: any[] = [];
        if (multiplier !== 1 && Array.isArray(biomarkerHistory)) {
          biomarkerHistory.forEach(log => {
            if (!log.biomarkers) return;
            const matchingKey = Object.keys(log.biomarkers).find(k => k.toLowerCase() === itemKey.toLowerCase());
            if (matchingKey && log.biomarkers[matchingKey] !== undefined && log.biomarkers[matchingKey] !== null && log.biomarkers[matchingKey] !== '') {
              const rawVal = log.biomarkers[matchingKey];
              const numVal = typeof rawVal === 'number' ? rawVal : parseFloat(String(rawVal));
              if (!isNaN(numVal)) {
                const isOutlier = isBiomarkerValueImprobable(itemKey, numVal, range);

                // If it's a global unit conversion (e.g. lbs -> kg), convert all logs.
                // If unit is unchanged, ONLY outlier entries need the scale multiplier!
                if (isUnitConversion || isOutlier) {
                  let convertedVal = numVal * multiplier;
                  if (Number.isFinite(convertedVal)) {
                    if (convertedVal >= 100) convertedVal = Math.round(convertedVal);
                    else if (convertedVal >= 10) convertedVal = parseFloat(convertedVal.toFixed(1));
                    else convertedVal = parseFloat(convertedVal.toFixed(3));
                  }
                  const logKey = log.id || `${itemKey}_${log.date}`;
                  initialSelectedLogFixes[logKey] = true;
                  affectedLogs.push({
                    logId: log.id,
                    date: log.date,
                    key: matchingKey,
                    oldValue: rawVal,
                    newValue: convertedVal,
                    isClearlyErroneous: isOutlier
                  });
                }
              }
            }
          });
        }

        return {
          ...item,
          key: itemKey,
          name: itemName,
          unit: item.standardizedUnit !== undefined ? item.standardizedUnit : item.unit,
          isUnitConversion,
          affectedLogs,
          valueMultiplier: multiplier,
          valueAdjustmentReason: adjustmentReason,
          normalRange: range,
          minRange: item.minRange !== undefined ? item.minRange : (customDef as any)?.minRange,
          maxRange: item.maxRange !== undefined ? item.maxRange : (customDef as any)?.maxRange,
          optimalRange: item.optimalRange !== undefined ? item.optimalRange : (customDef as any)?.optimalRange,
          optimalMin: item.optimalMin !== undefined ? item.optimalMin : (customDef as any)?.optimalMin,
          optimalMax: item.optimalMax !== undefined ? item.optimalMax : (customDef as any)?.optimalMax,
          notes: item.notes || (customDef as any)?.notes,
          description: item.description || (customDef as any)?.description || (customDef as any)?.descriptions?.en,
          descriptions: item.descriptions || (customDef as any)?.descriptions || (item.description ? { en: item.description } : undefined),
          standardMedicalGrouping: grouping,
          riskCategories: risks,
          potentialMedicalConditions: conds
        };
      });

      setSelectedLogFixKeys(initialSelectedLogFixes);
      setStandardizationSummary(parsed);

      // Capture and save agent debug logs for this request
      try {
        const logsRes = await fetch(`/api/gemini/debug-logs?sessionId=${sessionId}`);
        if (logsRes.ok) {
          const logsText = await logsRes.text().catch(() => "");
          const logsData = logsText ? JSON.parse(logsText) : null;
          if (logsData && logsData.logs && logsData.logs.length > 0) {
            const summaryText = isCalibrate
              ? `[Range Calibration] Calibrated ${selectedKeys.length} biomarker(s)`
              : isCategorise 
                ? `[Categorisation] Processed ${selectedKeys.length} biomarker(s)`
                : `[Standardization] Standardized ${selectedKeys.length} biomarker(s)`;
            saveAgentRequestLog({
              id: sessionId,
              timestamp: new Date().toISOString(),
              summary: summaryText,
              logs: logsData.logs
            });
          }
        }
      } catch (e) {
        console.warn("Could not save agent request logs", e);
      }

      // Persist the agent call/result so it survives modal close and appears in agent history
      const agentTypeForLog = isCalibrate ? 'calibrate_ranges' : (isCategorise ? 'medical_categorise' : 'standardize_units');
      const newAnalysis = {
        id: `analysis_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        agentType: agentTypeForLog,
        date: new Date().toISOString(),
        result: {
          selectedBiomarkers: selectedBiomarkerDetails,
          mappedBiomarkers: parsed
        }
      };
      if (onAgentAnalysisSaved) {
        await onAgentAnalysisSaved(agentTypeForLog, newAnalysis.result);
      } else {
        const currentAnalyses = profile.agentAnalyses || [];
        onUpdateProfile({
          agentAnalyses: [...currentAnalyses, newAnalysis]
        });
      }
    } catch (error: any) {
      console.error(error);
      alert(interpolate(t(profile.language, 'dictAlertAgentError'), { msg: error.message }));
    } finally {
      setAgentLoading(false);
    }
  };

  // Approve & Apply Agent Standardization / Medical Categorisation / Range Calibration
  const handleApplyStandardization = async () => {
    if (!standardizationSummary || !onStandardizeUnits) return;
    setAgentLoading(true);
    try {
      // MUST match canonical 8 risk domains
      const allowedRisks = [
        "Cardiovascular", "Metabolic", "Liver", "Kidney", "Hematology",
        "Immunological", "Endocrine", "Screenings & Wellness"
      ];
      const updatesToApply: any = {};
      standardizationSummary.forEach((item: any) => {
        const originalKey = item.originalKey || item.key;
        const targetKey = item.key || item.originalKey;
        if (!targetKey && !originalKey) return;
        const applyKey = originalKey || targetKey;

        updatesToApply[applyKey] = {
          name: item.name || applyKey,
          originalKey: originalKey || applyKey,
        };
        if (targetKey && originalKey && targetKey !== originalKey) {
          updatesToApply[applyKey].newKey = targetKey;
        }

        if (item.unit !== undefined && item.unit !== null && String(item.unit).trim() !== '') {
          updatesToApply[applyKey].unit = item.unit;
        }
        if (item.normalRange !== undefined && item.normalRange !== null && String(item.normalRange).trim() !== '') {
          updatesToApply[applyKey].normalRange = item.normalRange;
        }
        if (item.minRange !== undefined && item.minRange !== null) {
          updatesToApply[applyKey].minRange = item.minRange;
        }
        if (item.maxRange !== undefined && item.maxRange !== null) {
          updatesToApply[applyKey].maxRange = item.maxRange;
        }
        if (item.optimalRange !== undefined && item.optimalRange !== null && String(item.optimalRange).trim() !== '') {
          updatesToApply[applyKey].optimalRange = item.optimalRange;
        }
        if (item.optimalMin !== undefined && item.optimalMin !== null) {
          updatesToApply[applyKey].optimalMin = item.optimalMin;
        }
        if (item.optimalMax !== undefined && item.optimalMax !== null) {
          updatesToApply[applyKey].optimalMax = item.optimalMax;
        }
        if (item.notes !== undefined && item.notes !== null && String(item.notes).trim() !== '') {
          updatesToApply[applyKey].notes = item.notes;
        }
        if (item.rangeConfig) {
          updatesToApply[applyKey].rangeConfig = item.rangeConfig;
        }
        if (item.customRanges) {
          updatesToApply[applyKey].customRanges = item.customRanges;
        }

        // Synthesize rangeBrackets if missing so the audit engine immediately marks the range fully calibrated
        if (item.rangeBrackets && Array.isArray(item.rangeBrackets) && item.rangeBrackets.length > 0) {
          updatesToApply[applyKey].rangeBrackets = item.rangeBrackets;
        } else if (item.normalRange && String(item.normalRange).trim() !== '') {
          const normStr = String(item.normalRange).trim();
          const unitStr = item.unit ? ` ${item.unit}` : '';
          const brackets: any[] = [];
          if (item.minRange !== undefined && item.minRange !== null && item.maxRange !== undefined && item.maxRange !== null) {
            brackets.push({ label: 'Low', range: `< ${item.minRange}${unitStr}`, interpretation: 'Below normal range' });
            brackets.push({ label: 'Normal', range: `${item.minRange} - ${item.maxRange}${unitStr}`, interpretation: 'Normal physiological range' });
            brackets.push({ label: 'High', range: `> ${item.maxRange}${unitStr}`, interpretation: 'Above normal range' });
          } else {
            brackets.push({ label: 'Normal', range: `${normStr}${unitStr}`, interpretation: 'Standard reference interval' });
          }
          if (item.optimalRange) {
            brackets.push({ label: 'Optimal', range: `${item.optimalRange}${unitStr}`, interpretation: 'Target optimal range' });
          }
          updatesToApply[applyKey].rangeBrackets = brackets;
        }
        if (item.instrumentScale !== undefined && item.instrumentScale !== null && String(item.instrumentScale).trim() !== '') {
          updatesToApply[applyKey].instrumentScale = item.instrumentScale;
        }
        if (item.dataType !== undefined && item.dataType !== null && String(item.dataType).trim() !== '') {
          updatesToApply[applyKey].dataType = item.dataType;
        }
        if (item.potentialDuplicateOf !== undefined && item.potentialDuplicateOf !== null && String(item.potentialDuplicateOf).trim() !== '') {
          const dupVal = String(item.potentialDuplicateOf).trim().toLowerCase();
          const targetKey = applyKey.trim().toLowerCase();
          if (dupVal !== targetKey && dupVal !== 'null' && dupVal !== 'none' && dupVal !== '') {
            updatesToApply[applyKey].potentialDuplicateOf = item.potentialDuplicateOf;
          }
        }
        if (item.standardMedicalGrouping !== undefined && item.standardMedicalGrouping !== null && String(item.standardMedicalGrouping).trim() !== '') {
          updatesToApply[applyKey].standardMedicalGrouping = item.standardMedicalGrouping;
          // Synchronize legacy/organ category with standardMedicalGrouping
          const groupLow = item.standardMedicalGrouping.toLowerCase();
          if (groupLow.includes('cardio')) updatesToApply[applyKey].category = 'heart';
          else if (groupLow.includes('liver') || groupLow.includes('hepatic')) updatesToApply[applyKey].category = 'liver';
          else if (groupLow.includes('kidney') || groupLow.includes('renal')) updatesToApply[applyKey].category = 'kidneys';
          else if (groupLow.includes('hematolog') || groupLow.includes('blood')) updatesToApply[applyKey].category = 'hematology';
          else if (groupLow.includes('metabolic') || groupLow.includes('sugar') || groupLow.includes('lipid')) updatesToApply[applyKey].category = 'metabolic';
          else if (groupLow.includes('endocrine') || groupLow.includes('thyroid') || groupLow.includes('hormone')) updatesToApply[applyKey].category = 'endocrinology';
          else if (groupLow.includes('biometric') || groupLow.includes('anthropometric')) updatesToApply[applyKey].category = 'biometrics';
          else updatesToApply[applyKey].category = groupLow.replace(/[^a-z0-9_]/g, '_');
        } else if (item.category) {
          updatesToApply[applyKey].category = item.category;
        }

        updatesToApply[applyKey].needsApproval = false;
        updatesToApply[applyKey].catalogApproved = true;

        if (item.riskCategories !== undefined) {
          try {
            updatesToApply[applyKey].riskCategories = Array.isArray(item.riskCategories)
              ? item.riskCategories
              : JSON.parse(item.riskCategories);
          } catch (e) {
            updatesToApply[applyKey].riskCategories = typeof item.riskCategories === 'string'
              ? item.riskCategories.split(',').map((s: string) => s.trim())
              : [];
          }
        } else if (isMedicalCategorisationMode || isRangeCalibrationMode) {
          const existing = profile.customBiomarkers?.[applyKey]?.riskCategories;
          updatesToApply[applyKey].riskCategories = Array.isArray(existing) && existing.length > 0 ? existing : ['Screenings & Wellness'];
        }
        if ((isMedicalCategorisationMode || isRangeCalibrationMode) && Array.isArray(updatesToApply[applyKey].riskCategories)) {
          const canonical = updatesToApply[applyKey].riskCategories.map((r: string) => {
            const low = (r || '').toLowerCase();
            if (low.includes('cardio') || low.includes('heart') || low.includes('lipid')) return 'Cardiovascular';
            if (low.includes('metabol') || low.includes('sugar') || low.includes('glycem') || low.includes('beta-cell')) return 'Metabolic';
            if (low.includes('liver') || low.includes('hepatic')) return 'Liver';
            if (low.includes('kidney') || low.includes('renal')) return 'Kidney';
            if (low.includes('hematolog') || low.includes('blood')) return 'Hematology';
            if (low.includes('immuno') || low.includes('inflam') || low.includes('respirat')) return 'Immunological';
            if (low.includes('endocrine') || low.includes('thyroid') || low.includes('hormone')) return 'Endocrine';
            return 'Screenings & Wellness';
          });
          updatesToApply[applyKey].riskCategories = Array.from(new Set(canonical));
        }

        if (item.potentialMedicalConditions !== undefined) {
          try {
            updatesToApply[applyKey].potentialMedicalConditions = Array.isArray(item.potentialMedicalConditions)
              ? item.potentialMedicalConditions
              : JSON.parse(item.potentialMedicalConditions);
          } catch (e) {
            updatesToApply[applyKey].potentialMedicalConditions = typeof item.potentialMedicalConditions === 'string'
              ? item.potentialMedicalConditions.split(',').map((s: string) => s.trim())
              : [];
          }
        } else if (isMedicalCategorisationMode || isRangeCalibrationMode) {
          const existing = profile.customBiomarkers?.[applyKey]?.potentialMedicalConditions;
          updatesToApply[applyKey].potentialMedicalConditions = Array.isArray(existing) && existing.length > 0
            ? existing
            : ['General Health Assessment'];
        }

        if (item.description || item.descriptions) {
          if (item.description) updatesToApply[applyKey].description = item.description;
          if (item.descriptions) updatesToApply[applyKey].descriptions = item.descriptions;
        } else {
          const customBiomarkerAny = profile.customBiomarkers?.[applyKey] as any;
          const existingDesc = customBiomarkerAny?.description || customBiomarkerAny?.descriptions?.en;
          const fallbackDesc = existingDesc || `${item.name || applyKey} clinical assessment metric`;
          updatesToApply[applyKey].description = fallbackDesc;
          updatesToApply[applyKey].descriptions = { en: fallbackDesc };
        }
      });

      const logValueCorrections: { logId?: string; date: string; key: string; newValue: number }[] = [];
      standardizationSummary.forEach((item: any) => {
        if (Array.isArray(item.affectedLogs)) {
          item.affectedLogs.forEach((log: any) => {
            const logKey = log.logId || `${item.key}_${log.date}`;
            if (selectedLogFixKeys[logKey]) {
              logValueCorrections.push({
                logId: log.logId,
                date: log.date,
                key: log.key || item.key,
                newValue: log.newValue
              });
            }
          });
        }
      });

      await onStandardizeUnits(updatesToApply, logValueCorrections);
      
      // Clean up localStorage agent states
      try {
        localStorage.removeItem('dict_standardization_yaml');
        localStorage.removeItem('dict_standardization_summary');
      } catch (e) {}

      setIsAgentMode(false);
      setIsRangeCalibrationMode(false);
      setIsMedicalCategorisationMode(false);
      setSelectedKeys([]);
      setStandardizationYaml(null);
      setStandardizationSummary(null);
    } catch (e: any) {
      console.error(e);
      alert(interpolate(t(profile.language, 'dictAlertApplyError'), { msg: e.message }));
    } finally {
      setAgentLoading(false);
    }
  };

  const [editingGroupIdx, setEditingGroupIdx] = useState<number | null>(null);
  const [viewingLogsKey, setViewingLogsKey] = useState<{ key: string; name: string } | null>(null);





  // Run Name Consolidation Agent (Chat Interface)
  const handleRunConsolidationAgent = async (isManualClick = false, keysOverride?: string[]) => {
    const keysToUse = (keysOverride && keysOverride.length > 0) ? keysOverride : selectedKeys;
    if (keysToUse.length === 0) return;
    
    let userMsg = null;
    const text = consolidationInput.trim();
    if (text || isManualClick) {
      userMsg = {
        role: 'user',
        content: text || "Please identify the duplicates from the provided list and consolidate them.",
        timestamp: new Date().toISOString()
      };
      setConsolidationMessages(prev => [...prev, userMsg]);
    }
    
    setConsolidationInput('');
    setConsolidationLoading(true);
    setConsolidationYaml(null);
    setConsolidationGroups(null);
    setConsolidationLiveThought('');

    try {
      // Exclude keys already auto-detected as alias candidates by the deterministic audit engine.
      // These are handled by the engine's auto-apply flow and should not be re-suggested by the AI.
      const engineDetectedAliases = new Set<string>();
      duplicateGroups.forEach(g => {
        g.candidateAliases.forEach(a => engineDetectedAliases.add(a));
        // Also exclude the master key from the consolidated cluster if it has no other alias
        // (the AI shouldn't re-deduplicate what the engine has already grouped)
        if (g.candidateAliases.length > 0) engineDetectedAliases.add(g.suggestedMasterKey);
      });

      const selectedBiomarkerDetails = keysToUse
        .filter(k => !engineDetectedAliases.has(k))
        .map(k => {
          const customDef: any = profile.customBiomarkers?.[k] || biomarkerDefinitions.find((b: any) => b.key === k);
          const log = biomarkerHistory.find(h => h.biomarkers && h.biomarkers[k] !== undefined);
          const value = log ? log.biomarkers[k] : '';
          return {
            key: k,
            name: customDef?.name || k,
            unit: customDef?.unit || '',
            value: value
          };
        });

      // The reference set the agent compares candidates against: every already-approved
      // key (built-in + custom biomarkers that don't have needsApproval), excluding
      // whatever is currently in this batch so it's not comparing items against themselves.
      const selectedKeySet = new Set(selectedKeys);
      const approvedCustomEntries = Object.entries(profile.customBiomarkers || {})
        .filter(([k, v]: [string, any]) => !v?.needsApproval && !selectedKeySet.has(k))
        .map(([k, v]: [string, any]) => ({ key: k, name: v?.name || k }));
      const existingKeysList = [
        ...biomarkerDefinitions
          .filter((d: any) => !selectedKeySet.has(d.key))
          .map((d: any) => ({ key: d.key, name: d.name })),
        ...approvedCustomEntries
      ];

      const sessionId = generateQueryId();

      trackApiCall('gemini', `Consolidate Names`);
      const res = await fetch('/api/gemini/consolidate-names?stream=true', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Session-ID': sessionId
        },
        body: JSON.stringify({
          inputText: userMsg?.content,
          selectedBiomarkers: selectedBiomarkerDetails,
          existingKeys: existingKeysList,
          engine: nameConsolidationModel,
          customSystemInstruction: localStorage.getItem('custom_system_instruction_consolidate_names') || undefined
        })
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        let errMsg = `Name consolidation error (${res.status})`;
        try {
          const errJson = JSON.parse(errText);
          if (errJson && errJson.error) errMsg = errJson.error;
        } catch {
          if (errText && errText.trim() && !errText.includes('<!doctype')) errMsg = errText.trim().slice(0, 150);
        }
        throw new Error(errMsg);
      }

      let data: any = {};
      const contentType = res.headers.get("content-type");
      if (contentType && contentType.includes("text/event-stream")) {
        const reader = res.body?.getReader();
        if (!reader) throw new Error("No stream reader available");
        const decoder = new TextDecoder();
        let accumulatedText = "";
        let lineBuffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          lineBuffer += decoder.decode(value, { stream: true });
          let separatorIdx: number;
          while ((separatorIdx = lineBuffer.indexOf("\n\n")) !== -1) {
            const ev = lineBuffer.substring(0, separatorIdx);
            lineBuffer = lineBuffer.substring(separatorIdx + 2);
            if (ev.startsWith("data: ")) {
              try {
                const chunkData = JSON.parse(ev.slice(6));
                if (chunkData.error) {
                  throw new Error(chunkData.error);
                }
                if (chunkData.chunk) {
                  accumulatedText += chunkData.chunk;
                  const match = accumulatedText.match(/\"scratchpad\"\s*:\s*\"([^]*?)(\"|$)/);
                  if (match) {
                    setConsolidationLiveThought(match[1].replace(/\\n/g, "\n").replace(/\\"/g, "\""));
                  }
                } else if (chunkData.thought) {
                  setConsolidationLiveThought(prev => (prev || "") + chunkData.thought);
                } else if (chunkData.final) {
                  data = chunkData.result;
                }
              } catch (e: any) {
                if (e.message && !e.message.includes("Unexpected token") && !e.message.includes("JSON")) {
                  throw e;
                }
                /* ignore malformed events */
              }
            }
          }
        }
      } else {
        const resText = await res.text();
        try {
          data = JSON.parse(resText);
        } catch {
          data = {};
        }
      }
      
      let parsedData;
      try {
        let rawText = typeof data === 'string' 
          ? data 
          : JSON.stringify(data);

        // Strip potential markdown wrappers (the silent killer of JSON.parse)
        rawText = rawText.replace(/```(?:json)?/gi, '').replace(/```/gi, '').trim();

        // Safely parse the cleaned string
        parsedData = JSON.parse(rawText);
        
      } catch (error) {
        console.error("Failed to parse agent JSON output:", error);
      }
      const dataToUse = parsedData || data;
      const parsed = dataToUse.consolidatedGroups || dataToUse.groups || [];
      setConsolidationYaml(JSON.stringify(parsed, null, 2));
      setConsolidationGroups(parsed);

      // Seed the edit form with the agent's own suggestions (canonical name, key, and a
      // sensible master record) so the reviewer sees pre-filled fields instead of blanks.
      // Unit/range/description are looked up locally from selectedBiomarkerDetails rather
      // than trusted from the agent, consistent with this app's zero-hallucination rule for
      // biomarker metadata.
      const seededEdits: typeof groupEdits = {};
      parsed.forEach((group: any, idx: number) => {
        const groupKeys = Array.isArray(group.keys) ? group.keys : [];
        const aliasNames: string[] = Array.isArray(group.aliases) ? group.aliases : [];
        const masterName = aliasNames[0];
        let masterKey = groupKeys[0] || '';
        if (!masterKey && masterName) {
          masterKey = Object.keys(profile.customBiomarkers || {}).find(k => profile.customBiomarkers[k].name === masterName) || 
                      biomarkerDefinitions.find(d => d.name === masterName)?.key || '';
        }
        const masterDetail = selectedBiomarkerDetails.find(d => d.name === masterName) || selectedBiomarkerDetails[0];
        const isExisting = !!group.isExistingKey && !!group.existingMasterKey;
        const targetKeyForLookup = isExisting ? group.existingMasterKey : (masterKey || aliasNames[0] || '');
        const def: any = profile.customBiomarkers?.[targetKeyForLookup] || biomarkerDefinitions.find((d: any) => d.key === targetKeyForLookup) || {};

        seededEdits[idx] = {
          recommendedClinicalName: group.Name || group.canonicalName || '',
          // When merging into an already-approved key, the target key is that existing
          // key verbatim — never a newly invented one.
          recommendedUniqueKey: isExisting ? group.existingMasterKey : (group.recommendedKey || ''),
          masterKey: targetKeyForLookup,
          excludedKeys: {},
          unit: def.unit || '',
          normalRange: def.normalRange || def.range || '',
          description: def.description || '',
          mergeInfo: {}
        };
      });
      setGroupEdits(seededEdits);

      // Capture and save agent debug logs for this request
      try {
        const logsRes = await fetch(`/api/gemini/debug-logs?sessionId=${sessionId}`);
        if (logsRes.ok) {
          const logsText = await logsRes.text().catch(() => "");
          const logsData = logsText ? JSON.parse(logsText) : null;
          if (logsData && logsData.logs && logsData.logs.length > 0) {
            saveAgentRequestLog({
              id: sessionId,
              timestamp: new Date().toISOString(),
              summary: `[Consolidation] Consolidated ${selectedKeys.length} biomarker(s)`,
              logs: logsData.logs
            });
          }
        }
      } catch (e) {
        console.warn("Could not save agent request logs", e);
      }

      const newAnalysis = {
        id: `analysis_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        agentType: 'name_consolidation',
        date: new Date().toISOString(),
        result: {
          inputText: userMsg?.content || "Auto-Consolidation",
          explanation: data.explanation || '',
          groups: parsed
        }
      };

      if (onAgentAnalysisSaved) {
        await onAgentAnalysisSaved('name_consolidation', newAnalysis.result);
      } else {
        const currentAnalyses = profile.agentAnalyses || [];
        onUpdateProfile({
          agentAnalyses: [...currentAnalyses, newAnalysis]
        });
      }

      if (data.explanation) {
        setConsolidationMessages(prev => [...prev, {
          role: 'agent',
          content: data.explanation,
          timestamp: new Date().toISOString()
        }]);
      }
    } catch (error: any) {
      console.error(error);
      alert(interpolate(t(profile.language, 'dictAlertConsolidateError'), { msg: error.message }));
      setConsolidationMessages(prev => [...prev, {
        role: 'agent',
        content: interpolate(t(profile.language, 'dictChatConsolidateError'), { msg: error.message }),
        isError: true,
        timestamp: new Date().toISOString()
      }]);
    } finally {
      setConsolidationLoading(false);
    }
  };

  // Approve & Combine Name Consolidation Results
  const handleApplyConsolidation = async () => {
    if (!consolidationGroups || !onCombineBiomarkers) return;
    setConsolidationLoading(true);
    try {
      const combinationsToApply: {targetKey: string, targetDef: any, mergedLogs: any[], sourceKeysToDelete: string[]}[] = [];
      
      for (let idx = 0; idx < consolidationGroups.length; idx++) {
        const group = consolidationGroups[idx];
        const edits: any = groupEdits[idx];
        if (!edits) continue;

        const targetKey = edits.recommendedUniqueKey;
        const targetName = edits.recommendedClinicalName;

        const keysList = Array.isArray(group.keys) ? group.keys : (Array.isArray(group.aliases) ? group.aliases : (group.biomarkers || []).map((b: any) => b.key));
        const groupBiomarkers = keysList.map((k: string) => {
          const def: any = profile.customBiomarkers?.[k] || biomarkerDefinitions.find((d: any) => d.key === k) || {};
          return {
            key: k,
            name: def.name || k,
            unit: def.unit || '',
            range: def.normalRange || def.range || '',
            description: def.description || '',
            medicalGrouping: def.standardMedicalGrouping || def.medicalGrouping || ''
          };
        });
        const includedBiomarkers = groupBiomarkers.filter((b: any) => !edits.excludedKeys[b.key]);
        if (includedBiomarkers.length === 0) continue;

        const keyExists = !!(biomarkerDefinitions.find((d: any) => d.key === targetKey) || profile.customBiomarkers?.[targetKey]);
        
        // Skip if new biomarker but user unchecked the "add" toggle
        if (!keyExists && (edits as any).addNewBiomarker === false) {
          continue;
        }

        const origMasterDef = profile.customBiomarkers?.[targetKey] || biomarkerDefinitions.find((def: any) => def.key === targetKey) || {} as any;
        
        let finalUnit = edits.unit !== undefined ? edits.unit : (origMasterDef.unit || '');
        let finalRange = edits.normalRange !== undefined ? edits.normalRange : (origMasterDef.normalRange || origMasterDef.range || '');
        let finalDescription = edits.description !== undefined ? edits.description : (origMasterDef.description || '');

        // If key doesn't exist, use the fallback values of the chosen master key if they haven't been edited
        if (!keyExists) {
          const masterBio = includedBiomarkers.find((b: any) => b.key === edits.masterKey) || includedBiomarkers[0];
          const masterDef = profile.customBiomarkers?.[masterBio.key] || biomarkerDefinitions.find((def: any) => def.key === masterBio.key) || {} as any;
          if (edits.unit === undefined) {
            finalUnit = masterDef.unit || masterBio?.unit || '';
          }
          if (edits.normalRange === undefined) {
            finalRange = masterDef.normalRange || masterDef.range || masterBio?.range || '';
          }
          if (edits.description === undefined) {
            finalDescription = masterDef.description || masterBio?.description || '';
          }
        }

        // Additive merge logic: append differing, checked metadata from candidates
        const mergeInfo = edits.mergeInfo || {};
        includedBiomarkers.forEach((b) => {
          const aliasMerge = mergeInfo[b.key] || {};
          
          if (b.key !== targetKey) {
            // merge unit
            if (aliasMerge.unit && b.unit && b.unit !== finalUnit) {
              if (!finalUnit.includes(b.unit)) {
                finalUnit = finalUnit ? `${finalUnit} | ${b.unit}` : b.unit;
              }
            }
            // merge range
            if (aliasMerge.range && b.range && b.range !== finalRange) {
              if (!finalRange.includes(b.range)) {
                finalRange = finalRange ? `${finalRange} | ${b.range}` : b.range;
              }
            }
            // merge description
            if (aliasMerge.description && b.description && b.description !== finalDescription) {
              if (!finalDescription.includes(b.description)) {
                finalDescription = finalDescription ? `${finalDescription} | ${b.description}` : b.description;
              }
            }
          }
        });

        const targetDef = {
          name: targetName,
          unit: finalUnit,
          normalRange: finalRange,
          description: finalDescription,
          standardMedicalGrouping: origMasterDef.standardMedicalGrouping || origMasterDef.medicalGrouping || '',
          riskCategories: origMasterDef.riskCategories || [],
          potentialMedicalConditions: origMasterDef.potentialMedicalConditions || [],
          rangeConfig: origMasterDef.rangeConfig,
          customRanges: origMasterDef.customRanges
        };

        const sourceKeysToDelete = includedBiomarkers.map((b: any) => b.key).filter((k: string) => k !== targetKey);

        const mergedLogsMap: { [date: string]: { value: string | number, originalLogId?: string } } = {};

        biomarkerHistory.forEach((log) => {
          let valueFound: string | number | null = null;
          let originalLogId = log.id;

          if (log.biomarkers[edits.masterKey] !== undefined) {
            valueFound = log.biomarkers[edits.masterKey];
          } else {
            for (const b of includedBiomarkers) {
              if (log.biomarkers[b.key] !== undefined) {
                valueFound = log.biomarkers[b.key];
                break;
              }
            }
          }

          if (valueFound !== null && valueFound !== undefined && valueFound !== '') {
            if (mergedLogsMap[log.date]) {
              // Same date already logged, duplicate removed.
            } else {
              mergedLogsMap[log.date] = {
                value: valueFound,
                originalLogId
              };
            }
          }
        });

        const mergedLogs = Object.entries(mergedLogsMap).map(([date, data]) => ({
          date,
          value: data.value,
          originalLogId: data.originalLogId
        }));

        combinationsToApply.push({ targetKey, targetDef, mergedLogs, sourceKeysToDelete });
      }

      if (onBatchCombineBiomarkers && combinationsToApply.length > 0) {
        await onBatchCombineBiomarkers(combinationsToApply);
      } else if (combinationsToApply.length > 0) {
        for (const combo of combinationsToApply) {
          await onCombineBiomarkers(combo.targetKey, combo.targetDef, combo.mergedLogs, combo.sourceKeysToDelete);
        }
      }

      setIsNameConsolidationMode(false);
      setSelectedKeys([]);
      setConsolidationYaml(null);
      setConsolidationGroups(null);
    } catch (e: any) {
      console.error(e);
      alert(interpolate(t(profile.language, 'dictAlertConsolidateApplyError'), { msg: e.message }));
    } finally {
      setConsolidationLoading(false);
    }
  };

  const handleAutoFixAllPending = () => {
    const updatedCustom = { ...(profile.customBiomarkers || {}) };
    toApproveKeys.forEach(key => {
      const builtIn = biomarkerDefinitions.find((b: any) => b.key === key || (Array.isArray(b.aliases) && b.aliases.some((a: string) => a.toLowerCase() === key.toLowerCase())));
      const custom = profile.customBiomarkers?.[key];
      const calibrated = autoCalibrateBiomarkerDef(key, builtIn, custom);
      
      updatedCustom[key] = {
        ...profile.customBiomarkers?.[key],
        ...calibrated,
        updatedAt: Date.now()
      };
      delete updatedCustom[key].needsApproval;
      updatedCustom[key].catalogApproved = true;
    });

    onUpdateProfile({ customBiomarkers: updatedCustom });
  };

  const handleAutoFixSelected = () => {
    const updatedCustom = { ...(profile.customBiomarkers || {}) };
    selectedKeys.forEach(key => {
      const builtIn = biomarkerDefinitions.find((b: any) => b.key === key || (Array.isArray(b.aliases) && b.aliases.some((a: string) => a.toLowerCase() === key.toLowerCase())));
      const custom = profile.customBiomarkers?.[key];
      const calibrated = autoCalibrateBiomarkerDef(key, builtIn, custom);
      
      updatedCustom[key] = {
        ...profile.customBiomarkers?.[key],
        ...calibrated,
        updatedAt: Date.now()
      };
      delete updatedCustom[key].needsApproval;
      updatedCustom[key].catalogApproved = true;
    });

    onUpdateProfile({ customBiomarkers: updatedCustom });
    setSelectedKeys([]);
  };

  const handleManualRename = (key: string) => {
    if (!editName.trim()) return;
    const def = profile.customBiomarkers?.[key];
    if (def) {
      onUpdateProfile({
        customBiomarkers: {
          ...profile.customBiomarkers,
          [key]: {
            ...def,
            name: editName.trim()
          }
        }
      });
    }
    setEditMode(null);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-0">
      <div className="bg-theme-bg-card w-full h-full flex flex-col overflow-hidden">
        {/* MODAL HEADER */}
        <div className="p-4 sm:p-5 border-b border-theme-border flex justify-between items-center bg-slate-50 dark:bg-slate-900">
          <div className="flex items-center gap-3">
            {(isChatMode || isAgentMode || isDataAccuracyMode || isNameConsolidationMode) && (
              <button 
                onClick={() => {
                  setIsChatMode(false);
                  setIsAgentMode(false);
                  setIsDataAccuracyMode(false);
                  setIsNameConsolidationMode(false);
                }} 
                className="p-1 hover:bg-slate-200 dark:hover:bg-slate-800 rounded transition-colors text-slate-500 cursor-pointer"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
            )}
            <div>
              <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 font-sans tracking-tight">
                {isChatMode 
                  ? "Route Agent Chat" 
                  : isAgentMode 
                    ? (isRangeCalibrationMode ? "Clinical Reference Range Calibration Agent" : isMedicalCategorisationMode ? "Clinical Categorisation Agent" : "Clinical Unit Standardization Agent") 
                    : isDataAccuracyMode 
                      ? "Data Accuracy Agent" 
                      : isNameConsolidationMode 
                        ? "Name Consolidation Agent" 
                        : isBatchPasteMode 
                          ? "Batch Consolidation" 
                          : "Biomarker Dictionary"}
              </h2>
              <p className="text-xs text-theme-text-secondary">
                {isChatMode 
                  ? `Discussing standard mappings for ${selectedKeys.length} selected biomarkers` 
                  : isAgentMode
                    ? (isRangeCalibrationMode 
                        ? `Calibrate population reference intervals, optimal ranges, and units for ${selectedKeys.length} selected biomarkers`
                        : isMedicalCategorisationMode 
                          ? `Determine medical groupings and risk categories for ${selectedKeys.length} selected biomarkers` 
                          : `Standardize units and convert ranges for ${selectedKeys.length} selected biomarkers`)
                    : isDataAccuracyMode
                      ? "Analyze and resolve data discrepancies across dictionary definitions and logs"
                      : isNameConsolidationMode
                        ? (consolidationGroups && consolidationGroups.length > 0
                            ? `Consolidating ${totalOriginalBiomarkersInConsolidation} biomarkers into ${totalMasterBiomarkersInConsolidation} master group${totalMasterBiomarkersInConsolidation === 1 ? '' : 's'} (${totalBiomarkersReduced} duplicate${totalBiomarkersReduced === 1 ? '' : 's'} reduced)`
                            : `Consolidate and group ${selectedKeys.length} biomarkers with duplicate or similar names`)
                        : isBatchPasteMode 
                          ? "Paste a JSON configuration file to automatically map and aggregate history logs"
                          : `Standardize, route, or batch-consolidate your custom biomarkers (Total: ${totalUniqueCount})`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopyDebugInfo}
              className="px-2.5 py-1 text-xs text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors font-medium cursor-pointer"
              title="Copy Debug Info"
            >
              {copiedDebugInfo ? "Copied!" : "Copy Debug Info"}
            </button>
            <button
              type="button"
              onClick={() => setShowAgentLogs(true)}
              className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-full transition-colors text-indigo-600 dark:text-indigo-400 cursor-pointer"
              title="AI Agent Diagnostic Log History"
            >
              <Terminal className="w-5 h-5" />
            </button>
            <button onClick={onClose} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-full transition-colors text-theme-text-secondary cursor-pointer">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* DATA ACCURACY MODE LAYOUT */}
        {isDataAccuracyMode ? (
          <div className="flex-1 flex flex-col overflow-y-auto bg-theme-bg">
            {/* Top side: Chat agent thread */}
            <div className={`flex flex-col shrink-0 ${accuracyComparisonResults ? 'h-[400px] border-b border-theme-border' : 'h-full'}`}>
              {/* Data Accuracy Engine Settings */}
              <div className="bg-theme-bg-card border-b border-theme-border p-3 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between shrink-0">
                <div className="w-full sm:w-56">
                  <LLMSelector
                    selectedModelId={dataAccuracyModel}
                    onChangeModelId={setDataAccuracyModel}
                    label="Data Accuracy Engine"
                  />
                </div>
                <div className="flex items-center gap-3 shrink-0 self-center">
                  <button
                    type="button"
                    onClick={() => setShowDataAccuracyInstructions(true)}
                    className="text-xs text-indigo-600 dark:text-indigo-400 font-bold hover:underline cursor-pointer flex items-center gap-1"
                  >
                    <span>ℹ️ View Programmed Agent Instructions &rarr;</span>
                  </button>
                  {dataAccuracyMessages.length > 1 && (
                    showResetChatConfirm ? (
                      <div className="flex items-center gap-1.5 ml-2 border-l border-theme-border pl-3">
                        <span className="text-[10px] text-rose-500 font-bold">Clear chat?</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setDataAccuracyMessages([
                              {
                                id: 'acc_msg_init',
                                role: 'assistant',
                                content: 'Hello! I am the Data Accuracy Agent, your cleaning specialist. 🧪\n\nShare any new biomarker readings, laboratory results, or logs by **typing them down** or **uploading files/images**.\n\nI will compare your input with your existing database definitions and latest logs to highlight any differences in **Name, Unit, Value, Date, and Comments**, and generate an interactive table so you can choose which information to keep.',
                                timestamp: new Date().toISOString()
                              }
                            ]);
                            setAccuracyComparisonResults(null);
                            setAccuracySelectedFields({});
                            setAccuracyUploadedFiles([]);
                            setDataAccuracyInput('');
                            localStorage.removeItem('data_accuracy_messages');
                            localStorage.removeItem('data_accuracy_comparison_results');
                            localStorage.removeItem('data_accuracy_selected_fields');
                            setShowResetChatConfirm(false);
                          }}
                          className="bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-bold px-1.5 py-0.5 rounded cursor-pointer"
                        >
                          Yes
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setShowResetChatConfirm(false);
                          }}
                          className="text-slate-500 hover:text-slate-700 text-[10px] font-bold cursor-pointer"
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setShowResetChatConfirm(true);
                        }}
                        className="text-xs text-rose-600 dark:text-rose-400 font-bold hover:underline cursor-pointer flex items-center gap-1 ml-2 border-l border-theme-border pl-3"
                      >
                        <span>🗑️ Reset Chat</span>
                      </button>
                    )
                  )}
                </div>
              </div>

              {/* Optional selected biomarkers filter reminder */}
              <div className="bg-theme-bg-card border-b border-theme-border p-2.5 flex flex-wrap gap-1.5 max-h-20 overflow-y-auto shrink-0 text-xs font-medium">
                <span className="text-slate-500 font-bold self-center mr-1">Ontology Scope:</span>
                {selectedKeys.length > 0 ? (
                  selectedKeys.map(k => (
                    <span key={k} className="inline-flex items-center gap-1 bg-indigo-50 dark:bg-indigo-950/45 border border-indigo-100 dark:border-indigo-900/60 text-indigo-700 dark:text-indigo-400 px-1.5 py-0.5 rounded-md font-semibold">
                      {profile.customBiomarkers?.[k]?.name || k}
                    </span>
                  ))
                ) : (
                  <span className="text-slate-400 italic">All available custom & standard biomarkers</span>
                )}
              </div>

              {/* Chat Thread messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {dataAccuracyMessages.map((msg, idx) => (
                      <div key={msg.id || idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[85%] rounded-2xl p-4 shadow-sm ${
                          msg.role === 'user'
                            ? 'bg-indigo-600 text-white rounded-br-none'
                            : 'bg-theme-bg-card border border-theme-border text-slate-800 dark:text-slate-200 rounded-bl-none'
                        }`}>
                          <div className="text-xs font-semibold opacity-70 mb-1">
                            {msg.role === 'user' ? 'You' : 'Data Accuracy Agent'}
                          </div>
                          <div className="text-sm leading-relaxed whitespace-pre-wrap select-text">
                            {msg.content}
                          </div>
                        </div>
                      </div>
                    ))}
                    {dataAccuracyLoading && (
                      <div className="flex justify-start">
                        <div className="bg-theme-bg-card border border-theme-border rounded-2xl p-4 shadow-sm flex items-center gap-2 text-slate-500">
                          <Loader className="w-4 h-4 animate-spin text-indigo-500" />
                          <span className="text-xs font-medium">Comparing and checking logs for differences...</span>
                        </div>
                      </div>
                    )}
                    <div ref={accuracyChatEndRef} />
                  </div>

                  {/* Chat Input form area */}
                  <div className="bg-theme-bg-card border-t border-slate-150 dark:border-slate-800 p-3 shrink-0 flex flex-col">
                    {/* Uploaded Files Tag Area */}
                    {accuracyUploadedFiles.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-2.5">
                        {accuracyUploadedFiles.map((f, i) => (
                          <span key={i} className="inline-flex items-center gap-1.5 bg-indigo-50 dark:bg-indigo-950/45 border border-indigo-100 dark:border-indigo-900/60 text-indigo-700 dark:text-indigo-400 px-2 py-0.5 rounded-md text-xs font-semibold">
                            <Paperclip className="w-3 h-3 text-indigo-500" />
                            <span className="max-w-[120px] truncate" title={f.name}>{f.name}</span>
                            <button onClick={() => removeAccuracyFile(i)} className="text-rose-500 hover:text-rose-700 font-bold ml-0.5">×</button>
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="flex gap-2">
                      <button
                        onClick={() => fileInputRef2.current?.click()}
                        className="p-2.5 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-theme-text-secondary border border-theme-border rounded-xl transition-colors shrink-0"
                        title="Upload lab report files, data text, or images"
                      >
                        <Paperclip className="w-4.5 h-4.5" />
                      </button>
                      <input
                        type="file"
                        ref={fileInputRef2}
                        onChange={handleAccuracyFileSelect}
                        accept="image/*,.txt,.csv"
                        multiple
                        className="hidden"
                      />
                      <input
                        type="text"
                        value={dataAccuracyInput}
                        onChange={e => setDataAccuracyInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleSendDataAccuracy()}
                        placeholder="Enter biomarker info (e.g. HbA1c 5.8% on 2026-07-01)..."
                        className="flex-1 bg-theme-bg border border-theme-border rounded-xl px-4 py-2 text-sm outline-none focus:border-indigo-500 dark:focus:border-indigo-500 text-slate-800 dark:text-slate-200 font-medium"
                      />
                      <button
                        onClick={handleSendDataAccuracy}
                        disabled={dataAccuracyLoading || (!dataAccuracyInput.trim() && accuracyUploadedFiles.length === 0)}
                        className="p-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition-colors disabled:opacity-50 shrink-0"
                      >
                        <Send className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
            </div>

            {/* Bottom side: Interactive Comparison Panel */}
            {accuracyComparisonResults && (
              <div className="w-full flex flex-col bg-theme-bg-card shrink-0 min-h-[500px]">
                <div className="p-5 border-b border-theme-border flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50 sticky top-0 z-10 backdrop-blur">
                  <div>
                    <h3 className="text-sm font-bold text-theme-text flex items-center gap-1.5">
                      <CheckSquare className="w-4 h-4 text-emerald-500" />
                      Data Resolution Panel
                    </h3>
                    <p className="text-[11px] text-theme-text-secondary mt-0.5">Compare and resolve differences. Select what to keep.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {showDiscardResultsConfirm ? (
                      <div className="flex items-center gap-1.5 bg-rose-50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/30 rounded-lg p-1">
                        <span className="text-[10px] text-rose-600 dark:text-rose-400 font-bold px-1.5">Discard results?</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setAccuracyComparisonResults(null);
                            setAccuracySelectedFields({});
                            localStorage.removeItem('data_accuracy_comparison_results');
                            localStorage.removeItem('data_accuracy_selected_fields');
                            setShowDiscardResultsConfirm(false);
                          }}
                          className="px-2 py-1 bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-bold rounded transition-colors cursor-pointer"
                        >
                          Yes, Clear
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setShowDiscardResultsConfirm(false);
                          }}
                          className="px-2 py-1 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 text-[10px] font-bold transition-colors cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setShowDiscardResultsConfirm(true);
                        }}
                        className="px-3 py-2 border border-theme-border hover:bg-slate-50 dark:hover:bg-slate-800 text-theme-text-secondary text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                      >
                        <Trash className="w-3.5 h-3.5 text-rose-500" />
                        <span>Discard Results</span>
                      </button>
                    )}
                    <button
                      onClick={applySelectedAccuracyUpdates}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 shadow-md shadow-emerald-600/10 cursor-pointer"
                    >
                      <Save className="w-3.5 h-3.5" />
                      Apply Updates ({accuracyComparisonResults.filter(item => accuracySelectedFields[item.id]?.selected).length})
                    </button>
                  </div>
                </div>

                <div className="p-5 space-y-5">
                  {Object.entries(accuracyComparisonResults.reduce((acc: any, curr: any) => {
                    if (!acc[curr.key]) acc[curr.key] = [];
                    acc[curr.key].push(curr);
                    return acc;
                  }, {})).map(([bKey, items]: [string, any]) => (
                    <div key={bKey} className="border border-theme-border rounded-xl overflow-hidden shadow-sm bg-theme-bg-card">
                      <div className="p-3 bg-slate-100 dark:bg-slate-800/80 border-b border-theme-border flex items-center justify-between">
                        <div className="flex flex-col text-left">
                          <span className="text-sm font-bold text-slate-800 dark:text-slate-100">{items[0]?.name?.current !== 'N/A' ? items[0]?.name?.current : bKey}</span>
                          <span className="text-[10px] text-slate-500 font-mono">key: {bKey}</span>
                        </div>
                        <span className="px-2 py-1 bg-theme-bg-card rounded-md text-[10px] font-bold text-slate-500 shadow-sm border border-theme-border">
                          {items.length} Log(s)
                        </span>
                      </div>
                      <div className="divide-y divide-slate-100 dark:divide-slate-800/50">
                      {items.map((item: any, idx: number) => {
                        const selects = accuracySelectedFields[item.id] || {
                      name: 'current', unit: 'current', value: 'current', date: 'current', comments: 'current', selected: true
                    };
                    const isRowSelected = selects.selected;

                    return (
                      <div key={item.id} className={`border rounded-xl overflow-hidden transition-all duration-200 ${
                        isRowSelected 
                          ? 'border-indigo-100 dark:border-indigo-950 bg-indigo-50/10 dark:bg-indigo-950/5 shadow-sm' 
                          : 'border-slate-150 dark:border-slate-800 opacity-60'
                      }`}>
                        {/* Header */}
                        <div className="p-3 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-150 dark:border-slate-800 flex items-center justify-between">
                          <label className="flex items-center gap-2 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={isRowSelected}
                              onChange={(e) => {
                                setAccuracySelectedFields(prev => ({
                                  ...prev,
                                  [item.id]: {
                                    ...prev[item.id],
                                    selected: e.target.checked
                                  }
                                }));
                              }}
                              className="w-4 h-4 text-indigo-600 border-slate-300 dark:border-slate-700 rounded focus:ring-indigo-500"
                            />
                            <div className="flex flex-col text-left">
                              <span className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                                {item.name.current !== 'N/A' ? item.name.current : item.key}
                              </span>
                              <span className="text-[10px] text-slate-500 font-mono">key: {item.key}</span>
                            </div>
                          </label>

                          <div className="flex items-center gap-1.5">
                            {item.matched ? (
                              <span className="bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">
                                Matched Key
                              </span>
                            ) : (
                              <span className="bg-amber-50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">
                                New Key Suggested
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Details Grid (only rendered if selected) */}
                        {isRowSelected && (
                          <div className="p-3 space-y-3 overflow-x-auto max-w-full">
                            <table className="w-full min-w-[550px] text-xs font-medium text-theme-text-secondary border-collapse">
                              <thead>
                                <tr className="border-b border-theme-border/80 text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
                                  <th className="pb-1.5 text-left font-bold w-1/5">Field</th>
                                  <th className="pb-1.5 text-left font-bold w-2/5">Database Moment</th>
                                  <th className="pb-1.5 text-left font-bold w-2/5">Shared Value</th>
                                  <th className="pb-1.5 text-center font-bold w-[100px]">Result</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-50 dark:divide-slate-800/30">
                                {/* Name */}
                                {idx === 0 && <tr className="py-2">
                                  <td className="py-2.5 font-bold text-slate-500 text-left">Biomarker Name</td>
                                  <td className="py-2.5 text-left">
                                    <button
                                      onClick={() => setAccuracySelectedFields(prev => ({ ...prev, [item.id]: { ...prev[item.id], name: 'current' } }))}
                                      className={`px-2 py-1.5 rounded-lg text-left w-11/12 border transition-all cursor-pointer ${
                                        selects.name === 'current' 
                                          ? 'border-indigo-200 dark:border-indigo-900 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-bold ring-2 ring-indigo-500/20' 
                                          : 'border-theme-border bg-theme-bg-card hover:bg-slate-50 text-slate-500'
                                      }`}
                                    >
                                      <div className="flex items-center gap-1.5">
                                        <div className={`w-3 h-3 rounded-full flex-shrink-0 flex items-center justify-center border ${selects.name === 'current' ? 'border-indigo-500 bg-indigo-500 text-white' : 'border-slate-300'}`}>
                                          {selects.name === 'current' && <span className="text-[8px]">✓</span>}
                                        </div>
                                        <span className="truncate">{item.name.current}</span>
                                      </div>
                                    </button>
                                  </td>
                                  <td className="py-2.5 text-left">
                                    <button
                                      onClick={() => setAccuracySelectedFields(prev => ({ ...prev, [item.id]: { ...prev[item.id], name: 'shared' } }))}
                                      className={`px-2 py-1.5 rounded-lg text-left w-11/12 border transition-all cursor-pointer ${
                                        selects.name === 'shared' 
                                          ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-bold ring-2 ring-emerald-500/20' 
                                          : 'border-theme-border bg-theme-bg-card hover:bg-slate-50 text-slate-500'
                                      }`}
                                    >
                                      <div className="flex items-center gap-1.5">
                                        <div className={`w-3 h-3 rounded-full flex-shrink-0 flex items-center justify-center border ${selects.name === 'shared' ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300'}`}>
                                          {selects.name === 'shared' && <span className="text-[8px]">✓</span>}
                                        </div>
                                        <span className="truncate">{item.name.shared}</span>
                                      </div>
                                    </button>
                                  </td>
                                  <td className="py-2.5 text-center">
                                    {item.name.status === 'same' ? (
                                      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/20 px-2 py-0.5 rounded-full font-bold">
                                        Same
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 text-[10px] text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/20 px-2 py-0.5 rounded-full font-bold">
                                        Different
                                      </span>
                                    )}
                                  </td>
                                </tr>}

                                {/* Unit */}
                                {idx === 0 && <tr className="py-2">
                                  <td className="py-2.5 font-bold text-slate-500 text-left">Unit</td>
                                  <td className="py-2.5 text-left">
                                    <button
                                      onClick={() => setAccuracySelectedFields(prev => ({ ...prev, [item.id]: { ...prev[item.id], unit: 'current' } }))}
                                      className={`px-2 py-1.5 rounded-lg text-left w-11/12 border transition-all cursor-pointer ${
                                        selects.unit === 'current' 
                                          ? 'border-indigo-200 dark:border-indigo-900 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-bold ring-2 ring-indigo-500/20' 
                                          : 'border-theme-border bg-theme-bg-card hover:bg-slate-50 text-slate-500'
                                      }`}
                                    >
                                      <div className="flex items-center gap-1.5">
                                        <div className={`w-3 h-3 rounded-full flex-shrink-0 flex items-center justify-center border ${selects.unit === 'current' ? 'border-indigo-500 bg-indigo-500 text-white' : 'border-slate-300'}`}>
                                          {selects.unit === 'current' && <span className="text-[8px]">✓</span>}
                                        </div>
                                        <span className="font-mono">{item.unit.current || 'None'}</span>
                                      </div>
                                    </button>
                                  </td>
                                  <td className="py-2.5 text-left">
                                    <button
                                      onClick={() => setAccuracySelectedFields(prev => ({ ...prev, [item.id]: { ...prev[item.id], unit: 'shared' } }))}
                                      className={`px-2 py-1.5 rounded-lg text-left w-11/12 border transition-all cursor-pointer ${
                                        selects.unit === 'shared' 
                                          ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-bold ring-2 ring-emerald-500/20' 
                                          : 'border-theme-border bg-theme-bg-card hover:bg-slate-50 text-slate-500'
                                      }`}
                                    >
                                      <div className="flex items-center gap-1.5">
                                        <div className={`w-3 h-3 rounded-full flex-shrink-0 flex items-center justify-center border ${selects.unit === 'shared' ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300'}`}>
                                          {selects.unit === 'shared' && <span className="text-[8px]">✓</span>}
                                        </div>
                                        <span className="font-mono">{item.unit.shared || 'None'}</span>
                                      </div>
                                    </button>
                                  </td>
                                  <td className="py-2.5 text-center">
                                    {item.unit.status === 'same' ? (
                                      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/20 px-2 py-0.5 rounded-full font-bold">
                                        Same
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 text-[10px] text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/20 px-2 py-0.5 rounded-full font-bold">
                                        Different
                                      </span>
                                    )}
                                  </td>
                                </tr>}

                                {/* Value */}
                                <tr className="py-2">
                                  <td className="py-2.5 font-bold text-slate-500 text-left">Value</td>
                                  <td className="py-2.5 text-left">
                                    <button
                                      onClick={() => setAccuracySelectedFields(prev => ({ ...prev, [item.id]: { ...prev[item.id], value: 'current' } }))}
                                      className={`px-2 py-1.5 rounded-lg text-left w-11/12 border transition-all cursor-pointer ${
                                        selects.value === 'current' 
                                          ? 'border-indigo-200 dark:border-indigo-900 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-bold ring-2 ring-indigo-500/20' 
                                          : 'border-theme-border bg-theme-bg-card hover:bg-slate-50 text-slate-500'
                                      }`}
                                    >
                                      <div className="flex items-center gap-1.5">
                                        <div className={`w-3 h-3 rounded-full flex-shrink-0 flex items-center justify-center border ${selects.value === 'current' ? 'border-indigo-500 bg-indigo-500 text-white' : 'border-slate-300'}`}>
                                          {selects.value === 'current' && <span className="text-[8px]">✓</span>}
                                        </div>
                                        <span className="font-bold">{item.value.current}</span>
                                      </div>
                                    </button>
                                  </td>
                                  <td className="py-2.5 text-left">
                                    <button
                                      onClick={() => setAccuracySelectedFields(prev => ({ ...prev, [item.id]: { ...prev[item.id], value: 'shared' } }))}
                                      className={`px-2 py-1.5 rounded-lg text-left w-11/12 border transition-all cursor-pointer ${
                                        selects.value === 'shared' 
                                          ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-bold ring-2 ring-emerald-500/20' 
                                          : 'border-theme-border bg-theme-bg-card hover:bg-slate-50 text-slate-500'
                                      }`}
                                    >
                                      <div className="flex items-center gap-1.5">
                                        <div className={`w-3 h-3 rounded-full flex-shrink-0 flex items-center justify-center border ${selects.value === 'shared' ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300'}`}>
                                          {selects.value === 'shared' && <span className="text-[8px]">✓</span>}
                                        </div>
                                        <span className="font-bold">{item.value.shared}</span>
                                      </div>
                                    </button>
                                  </td>
                                  <td className="py-2.5 text-center">
                                    {item.value.status === 'same' ? (
                                      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/20 px-2 py-0.5 rounded-full font-bold">
                                        Same
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 text-[10px] text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/20 px-2 py-0.5 rounded-full font-bold">
                                        Different
                                      </span>
                                    )}
                                  </td>
                                </tr>

                                {/* Date */}
                                <tr className="py-2">
                                  <td className="py-2.5 font-bold text-slate-500 text-left">Date</td>
                                  <td className="py-2.5 text-left">
                                    <button
                                      onClick={() => setAccuracySelectedFields(prev => ({ ...prev, [item.id]: { ...prev[item.id], date: 'current' } }))}
                                      className={`px-2 py-1.5 rounded-lg text-left w-11/12 border transition-all cursor-pointer ${
                                        selects.date === 'current' 
                                          ? 'border-indigo-200 dark:border-indigo-900 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-bold ring-2 ring-indigo-500/20' 
                                          : 'border-theme-border bg-theme-bg-card hover:bg-slate-50 text-slate-500'
                                      }`}
                                    >
                                      <div className="flex items-center gap-1.5">
                                        <div className={`w-3 h-3 rounded-full flex-shrink-0 flex items-center justify-center border ${selects.date === 'current' ? 'border-indigo-500 bg-indigo-500 text-white' : 'border-slate-300'}`}>
                                          {selects.date === 'current' && <span className="text-[8px]">✓</span>}
                                        </div>
                                        <span className="font-semibold">{item.date.current}</span>
                                      </div>
                                    </button>
                                  </td>
                                  <td className="py-2.5 text-left">
                                    <button
                                      onClick={() => setAccuracySelectedFields(prev => ({ ...prev, [item.id]: { ...prev[item.id], date: 'shared' } }))}
                                      className={`px-2 py-1.5 rounded-lg text-left w-11/12 border transition-all cursor-pointer ${
                                        selects.date === 'shared' 
                                          ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-bold ring-2 ring-emerald-500/20' 
                                          : 'border-theme-border bg-theme-bg-card hover:bg-slate-50 text-slate-500'
                                      }`}
                                    >
                                      <div className="flex items-center gap-1.5">
                                        <div className={`w-3 h-3 rounded-full flex-shrink-0 flex items-center justify-center border ${selects.date === 'shared' ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300'}`}>
                                          {selects.date === 'shared' && <span className="text-[8px]">✓</span>}
                                        </div>
                                        <span className="font-semibold">{item.date.shared}</span>
                                      </div>
                                    </button>
                                  </td>
                                  <td className="py-2.5 text-center">
                                    {item.date.status === 'same' ? (
                                      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/20 px-2 py-0.5 rounded-full font-bold">
                                        Same
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 text-[10px] text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/20 px-2 py-0.5 rounded-full font-bold">
                                        Different
                                      </span>
                                    )}
                                  </td>
                                </tr>

                                {/* Comments */}
                                <tr className="py-2">
                                  <td className="py-2.5 font-bold text-slate-500 text-left">Comments</td>
                                  <td className="py-2.5 text-left">
                                    <button
                                      onClick={() => setAccuracySelectedFields(prev => ({ ...prev, [item.id]: { ...prev[item.id], comments: 'current' } }))}
                                      className={`px-2 py-1.5 rounded-lg text-left w-11/12 border transition-all cursor-pointer ${
                                        selects.comments === 'current' 
                                          ? 'border-indigo-200 dark:border-indigo-900 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-bold ring-2 ring-indigo-500/20' 
                                          : 'border-theme-border bg-theme-bg-card hover:bg-slate-50 text-slate-500'
                                      }`}
                                    >
                                      <div className="flex items-start gap-1.5">
                                        <div className={`w-3 h-3 rounded-full flex-shrink-0 flex items-center justify-center border mt-0.5 ${selects.comments === 'current' ? 'border-indigo-500 bg-indigo-500 text-white' : 'border-slate-300'}`}>
                                          {selects.comments === 'current' && <span className="text-[8px]">✓</span>}
                                        </div>
                                        <span className="text-[10px] leading-relaxed block max-h-12 overflow-y-auto w-full break-words text-left">{item.comments.current || 'No current comments'}</span>
                                      </div>
                                    </button>
                                  </td>
                                  <td className="py-2.5 text-left">
                                    <button
                                      onClick={() => setAccuracySelectedFields(prev => ({ ...prev, [item.id]: { ...prev[item.id], comments: 'shared' } }))}
                                      className={`px-2 py-1.5 rounded-lg text-left w-11/12 border transition-all cursor-pointer ${
                                        selects.comments === 'shared' 
                                          ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-bold ring-2 ring-emerald-500/20' 
                                          : 'border-theme-border bg-theme-bg-card hover:bg-slate-50 text-slate-500'
                                      }`}
                                    >
                                      <div className="flex items-start gap-1.5">
                                        <div className={`w-3 h-3 rounded-full flex-shrink-0 flex items-center justify-center border mt-0.5 ${selects.comments === 'shared' ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300'}`}>
                                          {selects.comments === 'shared' && <span className="text-[8px]">✓</span>}
                                        </div>
                                        <span className="text-[10px] leading-relaxed block max-h-12 overflow-y-auto w-full break-words text-left">{item.comments.shared || 'No comment provided'}</span>
                                      </div>
                                    </button>
                                  </td>
                                  <td className="py-2.5 text-center">
                                    {item.comments.status === 'same' ? (
                                      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/20 px-2 py-0.5 rounded-full font-bold">
                                        Same
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 text-[10px] text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/20 px-2 py-0.5 rounded-full font-bold">
                                        Different
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  </div>
                  </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : isNameConsolidationMode ? (
          <div className="flex-1 flex flex-col overflow-y-auto bg-theme-bg">
            {/* Top side: Chat thread */}
            <div className={`flex flex-col shrink-0 ${consolidationGroups ? 'h-[400px] border-b border-theme-border' : 'h-full'}`}>
              {/* Settings Panel */}
              <div className="bg-theme-bg-card border-b border-theme-border p-3 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between shrink-0">
                <div className="w-full sm:w-56">
                  <LLMSelector
                    selectedModelId={nameConsolidationModel}
                    onChangeModelId={setNameConsolidationModel}
                    label="Consolidation Engine"
                  />
                </div>
                <div className="flex items-center gap-3 shrink-0 self-center">
                  <button
                    type="button"
                    onClick={() => setShowConsolidationInstructions(true)}
                    className="text-xs text-indigo-600 dark:text-indigo-400 font-bold hover:underline cursor-pointer flex items-center gap-1"
                  >
                    <span>ℹ️ View Programmed Agent Instructions &rarr;</span>
                  </button>
                  {consolidationMessages.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setConsolidationMessages([])}
                      className="text-xs text-rose-500 font-bold hover:underline cursor-pointer flex items-center gap-1 border-l border-theme-border pl-3 ml-2"
                    >
                      Clear Chat
                    </button>
                  )}
                </div>
              </div>

              {/* Chat Thread */}
              <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 bg-slate-50 dark:bg-slate-900/50">
                {consolidationMessages.length === 0 ? (
                  <div className="m-auto max-w-sm text-center">
                    <div className="w-16 h-16 bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-sm">
                      <BrainCircuit className="w-8 h-8" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-2 font-sans tracking-tight">Name Consolidation Agent</h3>
                    <p className="text-sm text-theme-text-secondary">
                      Select biomarkers you want to consolidate. I will analyze their names, standard medical groupings, units, and ranges to find duplicates and automatically group them.
                    </p>
                    <div className="mt-4 p-3 bg-theme-bg-card rounded-xl border border-theme-border text-xs text-theme-text-secondary text-left">
                      <div className="font-bold text-theme-neutral mb-2">Selected Biomarkers ({selectedKeys.length}):</div>
                      <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                        {selectedKeys.length === 0 ? (
                          <span className="italic text-slate-400">No biomarkers selected. Select them from the list.</span>
                        ) : (
                          selectedKeys.map(k => {
                            const def = profile.customBiomarkers?.[k] || biomarkerDefinitions.find((b: any) => b.key === k);
                            return (
                              <span key={k} className="inline-flex items-center gap-1 bg-slate-100 dark:bg-slate-800 border border-theme-border text-theme-neutral px-2 py-0.5 rounded-md">
                                {def?.name || k}
                              </span>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    {consolidationMessages.map((msg, idx) => (
                      <div key={idx} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        {msg.role === 'agent' && (
                          <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center shrink-0">
                            <BrainCircuit className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                          </div>
                        )}
                        <div className={`max-w-[85%] rounded-2xl p-4 ${
                          msg.role === 'user' 
                            ? 'bg-indigo-600 text-white shadow-md' 
                            : msg.isError
                              ? 'bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-400'
                              : 'bg-theme-bg-card border border-theme-border text-slate-800 dark:text-slate-200 shadow-sm'
                        }`}>
                          <div className="whitespace-pre-wrap text-[13px] leading-relaxed font-sans">{msg.content}</div>
                          {msg.timestamp && (
                            <div className={`text-[10px] mt-2 ${msg.role === 'user' ? 'text-indigo-200' : 'text-slate-400'}`}>
                              {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    {consolidationLoading && (
                      <div className="flex gap-3 justify-start">
                        <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center shrink-0">
                          <BrainCircuit className="w-4 h-4 text-indigo-600 dark:text-indigo-400 animate-pulse" />
                        </div>
                        <div className="bg-theme-bg-card border border-theme-border rounded-2xl p-4 shadow-sm flex flex-col gap-2 max-w-[85%]">
                          <div className="flex items-center gap-2">
                            <div className="flex space-x-1">
                              <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                              <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                              <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce"></div>
                            </div>
                            <span className="text-[13px] text-slate-500 font-medium ml-2">
                              {consolidationLiveThought ? 'Consolidating...' : 'Analyzing biomarkers...'}
                            </span>
                          </div>
                          {consolidationLiveThought && (
                            <div className="text-[11px] text-slate-500 font-mono whitespace-pre-wrap border-t border-theme-border pt-2 mt-1">
                              {consolidationLiveThought}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Chat Input */}
              <div className="p-3 bg-theme-bg-card border-t border-theme-border flex flex-col gap-3">
                {consolidationMessages.length > 0 && selectedKeys.length > 0 && (
                  <div className="text-xs text-theme-text-secondary text-left">
                    <div className="font-bold text-theme-neutral mb-1.5 flex items-center justify-between">
                      <span>Biomarkers to Consolidate ({selectedKeys.length})</span>
                    </div>
                    <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                      {selectedKeys.map(k => {
                        const def = profile.customBiomarkers?.[k] || biomarkerDefinitions.find((b: any) => b.key === k);
                        return (
                          <span key={k} className="inline-flex items-center gap-1 bg-slate-100 dark:bg-slate-800 border border-theme-border text-theme-neutral px-2 py-0.5 rounded-md text-[10px] leading-tight">
                            {def?.name || k}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  <div className="relative w-full">
                    <input
                      type="text"
                      className="w-full bg-theme-bg border border-theme-border rounded-xl pl-4 pr-12 py-3 text-[13px] text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500"
                      placeholder="Ask the agent to group specific items or hit Start..."
                      value={consolidationInput}
                      onChange={e => setConsolidationInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleRunConsolidationAgent()}
                      disabled={consolidationLoading}
                    />
                    <button
                      type="button"
                      onClick={() => handleRunConsolidationAgent()}
                      disabled={consolidationLoading || (!consolidationInput.trim() && selectedKeys.length === 0)}
                      className="absolute right-2 top-2 bottom-2 aspect-square flex items-center justify-center bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRunConsolidationAgent(true)}
                    disabled={consolidationLoading || selectedKeys.length === 0}
                    className="w-full py-2.5 rounded-xl bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 hover:bg-violet-200 dark:hover:bg-violet-900/50 transition-colors disabled:opacity-50 font-bold text-sm flex items-center justify-center gap-2"
                  >
                    <BrainCircuit className="w-4 h-4" />
                    Start
                  </button>
                </div>
              </div>
            </div>

            {/* Bottom side: Consolidation Data */}
            {consolidationGroups && (
              <div className="w-full flex flex-col bg-theme-bg/20 relative shadow-inner shrink-0 min-h-[500px]">
                <div className="p-4 bg-theme-bg-card border-b border-theme-border shrink-0 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-slate-800 dark:text-slate-100 text-sm flex items-center gap-2">
                        <CheckSquare className="w-4 h-4 text-emerald-500" />
                        Consolidation Groups
                      </h3>
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-300 border border-violet-200 dark:border-violet-800/50">
                        <span>{totalOriginalBiomarkersInConsolidation}</span>
                        <span className="text-violet-400 dark:text-violet-500">→</span>
                        <span>{totalMasterBiomarkersInConsolidation} master</span>
                        {totalBiomarkersReduced > 0 && (
                          <span className="text-emerald-600 dark:text-emerald-400 font-bold text-[11px] ml-0.5">
                            ({totalBiomarkersReduced} reduced)
                          </span>
                        )}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                      Consolidating <strong className="text-slate-700 dark:text-slate-200">{totalOriginalBiomarkersInConsolidation}</strong> biomarkers into <strong className="text-slate-700 dark:text-slate-200">{totalMasterBiomarkersInConsolidation}</strong> master groups (reduced from {totalOriginalBiomarkersInConsolidation} to {totalMasterBiomarkersInConsolidation}). Review and approve groups to combine historical records.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0 self-end sm:self-auto">
                    {reducedGroupsCount > 0 && (
                      <button
                        onClick={() => setShowOnlyReduced(!showOnlyReduced)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border flex items-center gap-1.5 transition-all cursor-pointer ${
                          showOnlyReduced
                            ? 'bg-violet-100 border-violet-300 text-violet-800 dark:bg-violet-950/60 dark:border-violet-800 dark:text-violet-300 font-bold shadow-sm'
                            : 'bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        <span className={`w-2 h-2 rounded-full ${showOnlyReduced ? 'bg-violet-500 animate-pulse' : 'bg-slate-400'}`} />
                        {showOnlyReduced ? `Showing Only ${reducedGroupsCount} Reduced` : `Show Reduced Only (${reducedGroupsCount})`}
                      </button>
                    )}
                    <button
                      onClick={handleApplyConsolidation}
                      disabled={consolidationLoading}
                      className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-md flex items-center gap-1 transition-all disabled:opacity-50 shrink-0 cursor-pointer"
                    >
                      {consolidationLoading ? <div className="w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                      {consolidationLoading ? 'Applying...' : 'Approve & Apply'}
                    </button>
                  </div>
                </div>
                
                <div className="flex-1 overflow-y-auto p-4 space-y-6">
                  {consolidationGroups
                    .map((group, groupIdx) => ({ group, groupIdx }))
                    .filter(({ group }) => {
                      if (!showOnlyReduced) return true;
                      const keysList = Array.isArray(group.keys) ? group.keys : (Array.isArray(group.aliases) ? group.aliases : (group.biomarkers || []).map((b: any) => b.key));
                      return keysList.length > 1;
                    })
                    .map(({ group, groupIdx }) => {
                      const edits = groupEdits[groupIdx] || {
                        recommendedClinicalName: '',
                        recommendedUniqueKey: '',
                        masterKey: '',
                        excludedKeys: {},
                        mergeInfo: {}
                      };

                      const targetKey = edits.recommendedUniqueKey;
                      const existingDef: any = biomarkerDefinitions.find((d: any) => d.key === targetKey) || profile.customBiomarkers?.[targetKey];
                      const keyExists = !!existingDef;

                      const keysList = Array.isArray(group.keys) ? group.keys : (Array.isArray(group.aliases) ? group.aliases : (group.biomarkers || []).map((b: any) => b.key));
                      const groupBiomarkers = keysList.map((k: string) => {
                        const def: any = profile.customBiomarkers?.[k] || biomarkerDefinitions.find((d: any) => d.key === k) || {};
                        return {
                          key: k,
                          name: def.name || k,
                          unit: def.unit || '',
                          range: def.normalRange || def.range || '',
                          description: def.description || '',
                          medicalGrouping: def.standardMedicalGrouping || def.medicalGrouping || ''
                        };
                      });

                      const hasReducedDuplicates = keysList.length > 1;

                      return (
                        <div 
                          key={groupIdx} 
                          className={`bg-theme-bg-card border rounded-xl shadow-sm overflow-hidden p-5 space-y-5 transition-all ${
                            hasReducedDuplicates
                              ? 'border-violet-200 dark:border-violet-900/60 shadow-md ring-1 ring-violet-500/10'
                              : 'border-theme-border'
                          }`}
                        >
                          
                          {/* Status badge */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 flex-wrap">
                              {!keyExists && (
                                <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800/40">
                                  New Biomarker — Suggesting as a new key
                                </span>
                              )}
                              {hasReducedDuplicates && (
                                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full bg-violet-100 text-violet-800 dark:bg-violet-950/50 dark:text-violet-300 border border-violet-200 dark:border-violet-800/60 shadow-sm">
                                  <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse" />
                                  Reduced Duplicates ({keysList.length} items merged)
                                </span>
                              )}
                            </div>

                          {/* If the key does not exist, show "Add as new biomarker" toggle */}
                          {!keyExists && (
                            <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-theme-neutral">
                              <input
                                type="checkbox"
                                checked={(edits as any).addNewBiomarker !== false}
                                className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                                onChange={(e) => {
                                  setGroupEdits({
                                    ...groupEdits,
                                    [groupIdx]: {
                                      ...edits,
                                      addNewBiomarker: e.target.checked
                                    }
                                  });
                                }}
                              />
                              Add as new biomarker
                            </label>
                          )}
                        </div>

                        {/* RATIONALE COMMENT */}
                        {group.rationale && (
                          <div className="p-3 bg-theme-bg/40 rounded-lg border border-theme-border/40 text-xs text-theme-text-secondary">
                            <span className="font-bold text-theme-neutral">Rationale: </span>
                            {group.rationale}
                          </div>
                        )}

                        {/* UNIFIED DISPLAY TABLES */}
                        {(() => {
                          const isEditingThis = editingGroupIdx === groupIdx;
                          const nameVal = edits.recommendedClinicalName || (existingDef ? (existingDef.name || targetKey) : '');
                          const keyVal = targetKey;
                          const unitVal = edits.unit !== undefined ? edits.unit : (existingDef ? (existingDef.unit || '') : '');
                          const rangeVal = edits.normalRange !== undefined ? edits.normalRange : (existingDef ? (existingDef.normalRange || existingDef.range || '') : '');
                          const descVal = edits.description !== undefined ? edits.description : (existingDef ? (existingDef.description || '') : '');

                          return (
                            <div className="space-y-4">
                              {/* MASTER BIOMARKER TABLE */}
                              <div className={`border rounded-xl overflow-x-auto max-w-full ${
                                keyExists 
                                  ? 'border-emerald-100 dark:border-emerald-900/30 bg-emerald-50/5 dark:bg-emerald-950/5' 
                                  : 'border-indigo-100 dark:border-indigo-900/30 bg-indigo-50/5 dark:bg-indigo-950/5'
                              }`}>
                                <div className={`px-4 py-2 text-[11px] font-bold border-b flex justify-between items-center ${
                                  keyExists 
                                    ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-400 border-emerald-100 dark:border-emerald-900/30' 
                                    : 'bg-indigo-500/10 text-indigo-800 dark:text-indigo-400 border-indigo-100 dark:border-indigo-900/30'
                                }`}>
                                  <span>{keyExists ? 'EXISTING MASTER BIOMARKER' : 'PROPOSED NEW MASTER BIOMARKER'}: {targetKey}</span>
                                  <span className={`text-[10px] font-normal ${keyExists ? 'text-emerald-600' : 'text-indigo-600'}`}>
                                    {keyExists ? 'Authority Definition' : 'Proposed Definition'}
                                  </span>
                                </div>
                                <table className="w-full min-w-[650px] text-left border-collapse text-xs">
                                  <thead>
                                    <tr className="bg-slate-50/50 dark:bg-slate-950/20 text-[10px] font-bold text-slate-500 uppercase border-b border-theme-border/30">
                                      <th className="py-2 px-4 w-1/3">Name</th>
                                      <th className="py-2 px-4 w-12 text-center">Unit</th>
                                      <th className="py-2 px-4 w-1/4">Normal Range</th>
                                      <th className="py-2 px-4">Description</th>
                                      <th className="py-2 px-4 w-16 text-center">Logs</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    <tr className={`border-b border-theme-border/20 ${isEditingThis ? 'bg-slate-50/50 dark:bg-slate-950/20' : ''}`}>
                                      <td className="py-3 px-4">
                                        {isEditingThis ? (
                                          <div className="space-y-3">
                                            <div>
                                              <label className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block mb-0.5">Biomarker Name</label>
                                              <input
                                                type="text"
                                                className="w-full text-xs font-semibold bg-theme-bg-card border border-theme-border rounded px-2 py-1 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-indigo-500"
                                                value={nameVal}
                                                onChange={(e) => {
                                                  setGroupEdits({
                                                    ...groupEdits,
                                                    [groupIdx]: {
                                                      ...edits,
                                                      recommendedClinicalName: e.target.value
                                                    }
                                                  });
                                                }}
                                              />
                                            </div>
                                            <div>
                                              <label className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block mb-0.5">Unique Key</label>
                                              <input
                                                type="text"
                                                className="w-full text-xs font-mono bg-theme-bg-card border border-theme-border rounded px-2 py-1 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-indigo-500"
                                                value={keyVal}
                                                onChange={(e) => {
                                                  setGroupEdits({
                                                    ...groupEdits,
                                                    [groupIdx]: {
                                                      ...edits,
                                                      recommendedUniqueKey: e.target.value
                                                    }
                                                  });
                                                }}
                                              />
                                            </div>
                                            <div className="flex items-center gap-2 pt-1">
                                              <button
                                                onClick={() => setEditingGroupIdx(null)}
                                                className="px-2 py-1 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/50 rounded text-[10px] font-bold flex items-center gap-1 hover:bg-emerald-100 transition-colors"
                                              >
                                                <Check className="w-3.5 h-3.5" /> Save
                                              </button>
                                              <button
                                                onClick={() => setEditingGroupIdx(null)}
                                                className="px-2 py-1 bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 rounded text-[10px] font-bold hover:bg-slate-200 transition-colors"
                                              >
                                                Cancel
                                              </button>
                                            </div>
                                          </div>
                                        ) : (
                                          <div>
                                            <div className="flex items-center gap-2 group/title">
                                              <span className="font-semibold text-slate-800 dark:text-slate-200 text-sm">
                                                {nameVal || 'Unnamed'}
                                              </span>
                                              <button
                                                onClick={() => setEditingGroupIdx(groupIdx)}
                                                className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                                                title="Edit Master Details"
                                              >
                                                <Edit2 className="w-3.5 h-3.5" />
                                              </button>
                                            </div>
                                            <div className="font-mono text-xs text-theme-text-secondary mt-1">
                                              {keyVal}
                                            </div>
                                            
                                            {/* Existing aliases list */}
                                            <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-2">
                                              <span className="font-bold text-theme-text-secondary">Existing Aliases: </span>
                                              {existingDef && existingDef.aliases && existingDef.aliases.length > 0 ? (
                                                <span className="italic font-mono bg-slate-100 dark:bg-slate-800/50 px-1 py-0.5 rounded text-[10px] text-theme-text-secondary">
                                                  {existingDef.aliases.join(', ')}
                                                </span>
                                              ) : (
                                                <span className="italic text-slate-400">None</span>
                                              )}
                                            </div>
                                          </div>
                                        )}
                                      </td>
                                      
                                      {/* Unit Cell */}
                                      <td className="py-2.5 px-4 font-mono text-center text-theme-text-secondary">
                                        {isEditingThis ? (
                                          <input
                                            type="text"
                                            className="w-full text-xs font-mono bg-theme-bg-card border border-theme-border rounded px-2 py-1 text-center text-slate-800 dark:text-slate-100 focus:outline-none focus:border-indigo-500"
                                            value={unitVal}
                                            onChange={(e) => {
                                              setGroupEdits({
                                                ...groupEdits,
                                                [groupIdx]: {
                                                  ...edits,
                                                  unit: e.target.value
                                                }
                                              });
                                            }}
                                          />
                                        ) : (
                                          unitVal || '-'
                                        )}
                                      </td>

                                      {/* Range Cell */}
                                      <td className="py-2.5 px-4 font-mono text-theme-text-secondary whitespace-pre-wrap">
                                        {isEditingThis ? (
                                          <input
                                            type="text"
                                            className="w-full text-xs font-mono bg-theme-bg-card border border-theme-border rounded px-2 py-1 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-indigo-500"
                                            value={rangeVal}
                                            onChange={(e) => {
                                              setGroupEdits({
                                                ...groupEdits,
                                                [groupIdx]: {
                                                  ...edits,
                                                  normalRange: e.target.value
                                                }
                                              });
                                            }}
                                          />
                                        ) : (
                                          rangeVal || '-'
                                        )}
                                      </td>

                                      {/* Description Cell */}
                                      <td className="py-2.5 px-4 text-theme-text-secondary">
                                        {isEditingThis ? (
                                          <textarea
                                            className="w-full text-xs bg-theme-bg-card border border-theme-border rounded px-2 py-1 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-indigo-500 min-h-[60px]"
                                            value={descVal}
                                            onChange={(e) => {
                                              setGroupEdits({
                                                ...groupEdits,
                                                [groupIdx]: {
                                                  ...edits,
                                                  description: e.target.value
                                                }
                                              });
                                            }}
                                          />
                                        ) : (
                                          descVal || '-'
                                        )}
                                      </td>

                                      {/* Logs Cell */}
                                      <td 
                                        onClick={() => setViewingLogsKey({ key: keyVal, name: nameVal || keyVal })}
                                        className="py-2.5 px-4 text-center font-bold text-theme-neutral cursor-pointer hover:bg-emerald-500/10 dark:hover:bg-emerald-500/20 underline decoration-dotted transition-all"
                                        title="Click to view history logs"
                                      >
                                        {biomarkerHistory.filter((h: any) => h.biomarkers && h.biomarkers[keyVal] !== undefined).length}
                                      </td>
                                    </tr>
                                  </tbody>
                                </table>
                              </div>

                              {/* ALIASES TABLE */}
                              <div className="border border-theme-border rounded-xl overflow-x-auto max-w-full bg-theme-bg-card">
                                <div className="px-4 py-2 bg-theme-bg text-[11px] font-bold text-theme-neutral border-b border-theme-border flex justify-between items-center">
                                  <span>CANDIDATE ALIASES TO CONSOLIDATE</span>
                                  <span className="text-[10px] text-slate-500 font-normal">Check different info to append it</span>
                                </div>
                                <table className="w-full min-w-[650px] text-left border-collapse text-xs">
                                  <thead>
                                    <tr className="bg-slate-50/50 dark:bg-slate-950/20 text-[10px] font-bold text-slate-500 uppercase border-b border-theme-border">
                                      <th className="py-2 px-4 w-1/4">name</th>
                                      <th className="py-2 px-4 w-1/5">Unit info</th>
                                      <th className="py-2 px-4 w-1/5">Range info</th>
                                      <th className="py-2 px-4 w-1/5">Description info</th>
                                      <th className="py-2 px-4 w-16 text-center">Logs</th>
                                      <th className="py-2 px-4 w-16 text-center">Include</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {groupBiomarkers.map((b: any, bIdx: number) => {
                                      // Calculate same vs different
                                      const masterUnit = unitVal === '-' ? '' : unitVal;
                                      const masterRange = rangeVal === '-' ? '' : rangeVal;
                                      const masterDesc = descVal === '-' ? '' : descVal;

                                      const isUnitSame = !b.unit || b.unit === masterUnit;
                                      const isRangeSame = !b.range || b.range === masterRange;
                                      const isDescSame = !b.description || b.description === masterDesc;

                                      const mergeInfo = edits.mergeInfo || {};
                                      const aliasMerge = mergeInfo[b.key] || {};
                                      const isExcluded = !!edits.excludedKeys?.[b.key];
                                      const isIncluded = !isExcluded;

                                      return (
                                        <tr key={bIdx} className={`border-b border-theme-border/30 font-medium transition-opacity ${isExcluded ? 'opacity-50' : ''}`}>
                                          <td className="py-3 px-4">
                                            <div className="font-semibold text-slate-800 dark:text-slate-200">{b.name}</div>
                                            <div className="font-mono text-[10px] text-slate-400 mt-0.5">{b.key}</div>
                                          </td>
                                          
                                          {/* Unit col */}
                                          <td className="py-3 px-4">
                                            {isUnitSame ? (
                                              <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                                                <Check className="w-4 h-4 shrink-0" />
                                                <span className="text-[11px] font-mono">{b.unit || 'Empty'}</span>
                                              </div>
                                            ) : (
                                              <label className="flex items-center gap-2 cursor-pointer bg-theme-bg p-1.5 rounded-lg border border-theme-border">
                                                <input
                                                  type="checkbox"
                                                  checked={!!aliasMerge.unit}
                                                  className="w-3.5 h-3.5 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                                                  onChange={(e) => {
                                                    const newMergeInfo = { ...mergeInfo };
                                                    newMergeInfo[b.key] = {
                                                      ...aliasMerge,
                                                      unit: e.target.checked
                                                    };
                                                    setGroupEdits({
                                                      ...groupEdits,
                                                      [groupIdx]: {
                                                        ...edits,
                                                        mergeInfo: newMergeInfo
                                                      }
                                                    });
                                                  }}
                                                />
                                                <span className="text-[11px] font-mono font-medium text-theme-neutral" title="Add unit to master">
                                                  {b.unit}
                                                </span>
                                              </label>
                                            )}
                                          </td>

                                          {/* Range col */}
                                          <td className="py-3 px-4">
                                            {isRangeSame ? (
                                              <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                                                <Check className="w-4 h-4 shrink-0" />
                                                <span className="text-[11px] font-mono truncate max-w-[120px]" title={b.range}>{b.range || 'Empty'}</span>
                                              </div>
                                            ) : (
                                              <label className="flex items-center gap-2 cursor-pointer bg-theme-bg p-1.5 rounded-lg border border-theme-border">
                                                <input
                                                  type="checkbox"
                                                  checked={!!aliasMerge.range}
                                                  className="w-3.5 h-3.5 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                                                  onChange={(e) => {
                                                    const newMergeInfo = { ...mergeInfo };
                                                    newMergeInfo[b.key] = {
                                                      ...aliasMerge,
                                                      range: e.target.checked
                                                    };
                                                    setGroupEdits({
                                                      ...groupEdits,
                                                      [groupIdx]: {
                                                        ...edits,
                                                        mergeInfo: newMergeInfo
                                                      }
                                                    });
                                                  }}
                                                />
                                                <span className="text-[10px] text-theme-neutral truncate max-w-[120px]" title="Add range to master">
                                                  {b.range}
                                                </span>
                                              </label>
                                            )}
                                          </td>

                                          {/* Description col */}
                                          <td className="py-3 px-4">
                                            {isDescSame ? (
                                              <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                                                <Check className="w-4 h-4 shrink-0" />
                                                <span className="text-[11px] truncate max-w-[150px]" title={b.description}>{b.description || 'Empty'}</span>
                                              </div>
                                            ) : (
                                              <label className="flex items-center gap-2 cursor-pointer bg-theme-bg p-1.5 rounded-lg border border-theme-border">
                                                <input
                                                  type="checkbox"
                                                  checked={!!aliasMerge.description}
                                                  className="w-3.5 h-3.5 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                                                  onChange={(e) => {
                                                    const newMergeInfo = { ...mergeInfo };
                                                    newMergeInfo[b.key] = {
                                                      ...aliasMerge,
                                                      description: e.target.checked
                                                    };
                                                    setGroupEdits({
                                                      ...groupEdits,
                                                      [groupIdx]: {
                                                        ...edits,
                                                        mergeInfo: newMergeInfo
                                                      }
                                                    });
                                                  }}
                                                />
                                                <span className="text-[10px] text-theme-neutral truncate max-w-[150px]" title="Add description to master">
                                                  {b.description}
                                                </span>
                                              </label>
                                            )}
                                          </td>

                                          {/* Logs col */}
                                          <td 
                                            onClick={() => setViewingLogsKey({ key: b.key, name: b.name })}
                                            className="py-3 px-4 text-center font-medium text-theme-text-secondary cursor-pointer hover:bg-indigo-500/10 dark:hover:bg-indigo-500/20 underline decoration-dotted transition-all"
                                            title="Click to view history logs"
                                          >
                                            {biomarkerHistory.filter((h: any) => h.biomarkers && h.biomarkers[b.key] !== undefined).length}
                                          </td>

                                          {/* Include / Exclude Checkbox */}
                                          <td className="py-3 px-4 text-center">
                                            <input
                                              type="checkbox"
                                              checked={isIncluded}
                                              className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                                              onChange={(e) => {
                                                const newExcluded = { ...(edits.excludedKeys || {}) };
                                                if (e.target.checked) {
                                                  delete newExcluded[b.key];
                                                } else {
                                                  newExcluded[b.key] = true;
                                                }
                                                setGroupEdits({
                                                  ...groupEdits,
                                                  [groupIdx]: {
                                                    ...edits,
                                                    excludedKeys: newExcluded
                                                  }
                                                });
                                              }}
                                            />
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })}
                  <div className="mt-8 bg-slate-900 rounded-xl overflow-hidden shadow-inner">
                    <div className="p-2 bg-slate-950 border-b border-slate-800 flex items-center justify-between text-slate-400 text-[10px] font-mono">
                      <span className="flex items-center gap-1.5"><FileCode className="w-3.5 h-3.5" /> RAW JSON</span>
                    </div>
                    <div className="p-4 text-slate-300 font-mono text-[11px] whitespace-pre-wrap select-all">
                      {consolidationYaml}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : isChatMode ? (
          <div className="flex-1 flex flex-col overflow-hidden bg-theme-bg">
            {/* Selected Biomarkers Panel */}
            <div className="bg-theme-bg-card border-b border-theme-border p-3 flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
              <span className="text-xs font-bold text-slate-500 self-center mr-1">Selected:</span>
              {selectedKeys.map(k => {
                const def = profile.customBiomarkers?.[k];
                return (
                  <span key={k} className="inline-flex items-center gap-1 bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-100 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 rounded-full text-xs font-medium">
                    {def?.name || k}
                    <button onClick={() => handleToggleSelect(k)} className="text-indigo-400 hover:text-indigo-600 font-bold ml-0.5">×</button>
                  </span>
                );
              })}
              {selectedKeys.length === 0 && (
                <span className="text-xs text-amber-500 font-medium">No biomarkers selected. Click back to select some.</span>
              )}
            </div>

            {/* Messages Stream */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {chatMessages.map((msg, index) => (
                <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-2xl p-4 shadow-sm ${
                    msg.role === 'user' 
                      ? 'bg-indigo-600 text-white rounded-br-none' 
                      : 'bg-theme-bg-card border border-theme-border text-slate-800 dark:text-slate-200 rounded-bl-none'
                  }`}>
                    <div className="text-xs font-semibold opacity-70 mb-1">
                      {msg.role === 'user' ? 'You' : 'Route Agent'}
                    </div>
                    <div className="text-sm leading-relaxed whitespace-pre-wrap select-text">
                      {msg.content}
                    </div>

                    {/* Render Suggestion Card inside chat thread */}
                    {msg.suggestedMapping && Object.keys(msg.suggestedMapping).length > 0 && (
                      <div className="mt-4 p-3 bg-indigo-50 dark:bg-slate-800/80 border border-indigo-100 dark:border-slate-700 rounded-xl">
                        <div className="text-xs font-bold text-indigo-700 dark:text-indigo-400 flex items-center gap-1 mb-2">
                          <CheckCircle className="w-3.5 h-3.5" />
                          Recommended Database Consolidation:
                        </div>
                        <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                          {Object.entries(msg.suggestedMapping).map(([src, tgt]) => (
                            <div key={src} className="flex items-center justify-between text-xs font-mono py-1 border-b border-indigo-50/50 dark:border-slate-700/50">
                              {(() => {
                                const sourceDef = profile.customBiomarkers?.[src] || biomarkerDefinitions.find(d => d.key === src);
                                const latestVal = biomarkers[src] !== undefined ? biomarkers[src] : 'N/A';
                                return (
                                  <div className="flex flex-col items-start max-w-[45%] text-left">
                                    <span className="text-rose-500 dark:text-rose-400 truncate w-full" title={src}>{sourceDef?.name || src}</span>
                                    <div className="flex items-center gap-1 mt-0.5">
                                      {latestVal !== 'N/A' && <span className="text-[9px] font-bold text-slate-500 bg-slate-100 dark:bg-slate-800/80 px-1 rounded">Val: {latestVal}</span>}
                                      {sourceDef?.unit && <span className="text-[9px] text-slate-400 font-mono">{sourceDef.unit}</span>}
                                    </div>
                                    <span className="text-[8px] text-slate-400 truncate w-full opacity-70 mt-0.5" title={src}>{src}</span>
                                  </div>
                                );
                              })()}
                              <span className="text-slate-400">→</span>
                              {(() => {
                                const tgtKey = String(tgt); const targetDef = profile.customBiomarkers?.[tgtKey] || biomarkerDefinitions.find(d => d.key === tgtKey);
                                const latestVal = biomarkers[tgtKey] !== undefined ? biomarkers[tgtKey] : 'N/A';
                                return (
                                  <div className="flex flex-col items-end max-w-[45%] text-right">
                                    <span className="text-emerald-500 dark:text-emerald-400 truncate w-full" title={tgtKey}>{src === tgtKey ? 'Approve as New Standard' : (targetDef?.name || tgtKey)}</span>
                                    {src !== tgtKey && (
                                      <div className="flex items-center gap-1 mt-0.5 justify-end">
                                        {latestVal !== 'N/A' && <span className="text-[9px] font-bold text-slate-500 bg-slate-100 dark:bg-slate-800/80 px-1 rounded">Val: {latestVal}</span>}
                                        {targetDef?.unit && <span className="text-[9px] text-slate-400 font-mono">{targetDef.unit}</span>}
                                      </div>
                                    )}
                                    <span className="text-[8px] text-slate-400 truncate w-full opacity-70 mt-0.5 text-right" title={tgtKey}>{tgtKey}</span>
                                  </div>
                                );
                              })()}
                            </div>
                          ))}
                        </div>
                        <button
                          onClick={() => handleApplySuggestedMapping(msg.suggestedMapping!)}
                          className="mt-3 w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5 shadow-sm"
                        >
                          <CheckSquare className="w-4 h-4" />
                          Confirm & Apply Consolidation
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {isChatLoading && (
                <div className="flex justify-start">
                  <div className="bg-theme-bg-card border border-theme-border rounded-2xl p-4 shadow-sm flex items-center gap-2 text-slate-500">
                    <Loader className="w-4 h-4 animate-spin text-indigo-500" />
                    <span className="text-xs font-medium">Route Agent is analyzing ontology mappings...</span>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input Form */}
            <div className="bg-theme-bg-card p-4 border-t border-theme-border flex gap-2">
              <button
                onClick={() => handleSendChat("Please analyze the chosen biomarkers, map them to existing master keys if synonyms exist, or propose new standard snake_case keys if missing, and output the recommended mappings in your suggestedMapping JSON block.")}
                disabled={isChatLoading || selectedKeys.length === 0}
                className="px-4 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:hover:bg-emerald-900/30 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-800 text-xs font-bold rounded-xl transition-colors shrink-0"
              >
                Request Suggestions
              </button>
              <input
                type="text"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSendChat()}
                placeholder="Ask route agent or instruct how you want them mapped..."
                className="flex-1 bg-theme-bg border border-theme-border rounded-xl px-4 py-2 text-sm outline-none focus:border-indigo-500 dark:focus:border-indigo-500"
              />
              <button
                onClick={() => handleSendChat()}
                disabled={isChatLoading || !chatInput.trim()}
                className="p-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition-colors disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : isAgentMode ? (
          /* CLINICAL UNIT STANDARDIZATION AGENT MODE LAYOUT */
          <div className="flex-1 flex flex-col overflow-hidden bg-theme-bg">
            {/* Selected Biomarkers Panel */}
            <div className="bg-theme-bg-card border-b border-theme-border p-3 flex flex-wrap gap-1.5 max-h-24 overflow-y-auto shrink-0">
              <span className="text-xs font-bold text-slate-500 self-center mr-1">Selected Biomarkers:</span>
              {selectedKeys.map(k => {
                const def = profile.customBiomarkers?.[k] || biomarkerDefinitions.find((b: any) => b.key === k);
                return (
                  <span key={k} className="inline-flex items-center gap-1 bg-violet-50 dark:bg-violet-900/30 border border-violet-100 dark:border-violet-800 text-violet-700 dark:text-violet-300 px-2 py-0.5 rounded-full text-xs font-medium">
                    {def?.name || k} ({def?.unit || 'No Unit'})
                    <button onClick={() => handleToggleSelect(k)} className="text-violet-400 hover:text-violet-600 font-bold ml-0.5">×</button>
                  </span>
                );
              })}
              {selectedKeys.length === 0 && (
                <span className="text-xs text-amber-500 font-medium">No biomarkers selected. Close agent to return.</span>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              {/* Agent Engine & Instructions Controls */}
              <div className="bg-theme-bg-card border border-theme-border rounded-2xl p-4 shadow-sm flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
                <div className="w-full sm:w-64">
                  <LLMSelector
                    selectedModelId={isRangeCalibrationMode ? calibrateRangesModel : (isMedicalCategorisationMode ? medicalCategoriseModel : standardizeModel)}
                    onChangeModelId={isRangeCalibrationMode ? setCalibrateRangesModel : (isMedicalCategorisationMode ? setMedicalCategoriseModel : setStandardizeModel)}
                    label={isRangeCalibrationMode ? "Calibration Engine" : (isMedicalCategorisationMode ? "Categorization Engine" : "Standardization Engine")}
                  />
                </div>
                <div className="flex items-center gap-3 shrink-0 self-center">
                  <button
                    type="button"
                    onClick={() => isRangeCalibrationMode ? setShowCalibrateInstructions(true) : (isMedicalCategorisationMode ? setShowMedicalInstructions(true) : setShowStandardizeInstructions(true))}
                    className="text-xs text-indigo-600 dark:text-indigo-400 font-bold hover:underline cursor-pointer flex items-center gap-1.5"
                  >
                    <span>ℹ️ View Programmed Agent Instructions &rarr;</span>
                  </button>
                </div>
              </div>

              {/* Metric Selection controls */}
              <div className="bg-theme-bg-card border border-theme-border rounded-2xl p-5 shadow-sm space-y-4">
                {!isMedicalCategorisationMode && (
                  <>
                    <div>
                      <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                        <CheckSquare className="w-4 h-4 text-violet-500" />
                        Step 1: Choose Target Metric System
                      </h3>
                      <p className="text-xs text-theme-text-secondary mt-1">
                        Select whether the agent should target the International System of Units (SI/Metric) or US Customary units for reference ranges and standardized units.
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <button
                        type="button"
                        onClick={() => setTargetMetric('si')}
                        className={`p-4 rounded-xl border text-left transition-all ${
                          targetMetric === 'si'
                            ? 'border-violet-500 bg-violet-50/50 dark:bg-violet-950/20 ring-2 ring-violet-500/20'
                            : 'border-theme-border hover:bg-slate-50 dark:hover:bg-slate-800/50'
                        }`}
                      >
                        <div className="font-bold text-sm text-slate-800 dark:text-slate-100 flex items-center justify-between">
                          <span>SI System (Metric)</span>
                          {targetMetric === 'si' && <CheckCircle className="w-4 h-4 text-violet-500" />}
                        </div>
                        <p className="text-[11px] text-theme-text-secondary mt-1">
                          Uses standard metric units (e.g., mmol/L for glucose, g/L for protein, pmol/L for hormones). Standard in global clinical research.
                        </p>
                      </button>

                      <button
                        type="button"
                        onClick={() => setTargetMetric('us')}
                        className={`p-4 rounded-xl border text-left transition-all ${
                          targetMetric === 'us'
                            ? 'border-violet-500 bg-violet-50/50 dark:bg-violet-950/20 ring-2 ring-violet-500/20'
                            : 'border-theme-border hover:bg-slate-50 dark:hover:bg-slate-800/50'
                        }`}
                      >
                        <div className="font-bold text-sm text-slate-800 dark:text-slate-100 flex items-center justify-between">
                          <span>US Customary System</span>
                          {targetMetric === 'us' && <CheckCircle className="w-4 h-4 text-violet-500" />}
                        </div>
                        <p className="text-[11px] text-theme-text-secondary mt-1">
                          Uses standard United States clinical units (e.g., mg/dL for glucose, g/dL for protein, pg/mL for hormones).
                        </p>
                      </button>
                    </div>
                  </>
                )}

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => handleRunStandardizationAgent()}
                    disabled={agentLoading || selectedKeys.length === 0}
                    className="w-full py-3 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-md shadow-indigo-600/10 disabled:opacity-50"
                  >
                    {agentLoading ? (
                      <>
                        <Loader className="w-4 h-4 animate-spin" />
                        {isRangeCalibrationMode 
                          ? 'Agent Working in JSON to Calibrate Reference Ranges...' 
                          : (isMedicalCategorisationMode ? 'Agent Working in JSON to Add Categorisations...' : 'Agent Working in JSON to Add Standardized Units...')}
                      </>
                    ) : (
                      <>
                        <ArrowRight className="w-4 h-4" />
                        {isRangeCalibrationMode 
                          ? 'Run Reference Range Calibration Agent' 
                          : (isMedicalCategorisationMode ? 'Run Clinical Categorisation Agent' : 'Run Clinical Unit Standardization Agent')}
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Loader block for agent operations */}
              {agentLoading && (
                <div className="p-8 bg-theme-bg-card border border-theme-border rounded-2xl flex flex-col items-center justify-center text-center space-y-4 shadow-sm">
                  <Loader className="w-8 h-8 animate-spin text-violet-500" />
                  <div>
                    <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                      {isMedicalCategorisationMode ? 'Categorising Biomarkers...' : 'Standardizing Biomarker Definitions...'}
                    </h4>
                    <p className="text-xs text-theme-text-secondary mt-1 max-w-md">
                      {isMedicalCategorisationMode
                        ? 'The clinical AI agent is analyzing the biomarkers to assign medical groupings and risk categories, outputting validated JSON configuration objects.'
                        : `The clinical AI agent is parsing the selected biomarkers, researching reference units for ${targetMetric.toUpperCase()}, and outputting clean, validated JSON configuration objects with suggested ranges.`}
                    </p>
                  </div>
                </div>
              )}

              {/* Agent suggestions and validation blocks */}
              {standardizationYaml && (
                <div className="space-y-6">
                  {/* Generated RAW YAML display block */}
                  <div className="bg-theme-bg-card border border-theme-border rounded-2xl p-5 shadow-sm space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-theme-neutral font-mono flex items-center gap-1.5">
                        <FileCode className="w-4 h-4 text-violet-500" />
                        AGENT_METADATA_SPECIFICATION.JSON
                      </h4>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(standardizationYaml || "");
                          alert(t(profile.language, 'dictAlertJsonCopied'));
                        }}
                        className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <Copy className="w-3 h-3" /> {t(profile.language, 'dictCopyJson')}
                      </button>
                    </div>
                    <pre className="p-4 bg-slate-950 text-slate-100 rounded-xl text-[11px] font-mono leading-relaxed overflow-x-auto max-h-48 border border-slate-800 select-text">
                      {standardizationYaml}
                    </pre>
                  </div>

                  {/* Aesthetic Comparison Table and Approval summary */}
                  {standardizationSummary && (
                    <div className="bg-theme-bg-card border border-theme-border rounded-2xl p-5 shadow-sm space-y-4">
                      <div>
                        <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                          <CheckCircle className="w-4 h-4 text-emerald-500" />
                          {isRangeCalibrationMode 
                            ? "Step 2: Review Proposed Reference Ranges & Units" 
                            : (isMedicalCategorisationMode ? "Step 2: Review Proposed Categorisations" : "Step 2: Review Proposed Standardizations")}
                        </h4>
                        <p className="text-xs text-theme-text-secondary mt-1">
                          {isRangeCalibrationMode
                            ? "Review standard population reference intervals, optimal ranges, standardized units, and clinical classifications computed by the Reference Range Calibration Agent."
                            : isMedicalCategorisationMode 
                              ? "Review the physiological groupings and risk categories computed by the clinical categorisation agent. If approved, these will be applied to your active biomarker dictionary." 
                              : "Review the units and reference ranges computed by the clinical standardization agent. If approved, these will be applied to your active biomarker dictionary."}
                        </p>
                      </div>

                      {standardizationSummary.length === 0 ? (
                        <div className="p-8 text-center bg-emerald-50/50 dark:bg-emerald-950/20 border border-dashed border-emerald-200 dark:border-emerald-800/60 rounded-xl space-y-3">
                          <CheckCircle className="w-8 h-8 text-emerald-500 mx-auto" />
                          <p className="text-sm font-bold text-slate-800 dark:text-slate-100">All Selected Biomarkers are Already Complete!</p>
                          <p className="text-xs text-theme-text-secondary max-w-md mx-auto">
                            The agent confirmed that all selected biomarkers already match the recommended parameters. No adjustments needed.
                          </p>
                          <div className="pt-2 flex justify-center">
                            <button
                              type="button"
                              onClick={() => {
                                setStandardizationYaml(null);
                                setStandardizationSummary(null);
                              }}
                              className="px-4 py-2 bg-white dark:bg-slate-800 border border-theme-border text-theme-neutral rounded-lg text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-sm"
                            >
                              Reset & Go Back
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="border border-theme-border rounded-xl overflow-x-auto max-w-full">
                            <table className="w-full min-w-[750px] text-left border-collapse text-xs">
                              <thead>
                                <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-theme-border text-slate-700 dark:text-slate-200 font-semibold">
                                  <th className="p-3 min-w-[130px]">Biomarker</th>
                                  {isRangeCalibrationMode ? (
                                    <>
                                      <th className="p-3 min-w-[100px]">Unit</th>
                                      <th className="p-3 min-w-[160px]">Normal Range</th>
                                      <th className="p-3 min-w-[140px]">Optimal Range</th>
                                      <th className="p-3 min-w-[150px]">Medical Area & Risks</th>
                                      <th className="p-3 min-w-[200px]">Clinical Guidelines & Notes</th>
                                    </>
                                  ) : isMedicalCategorisationMode ? (
                                    <>
                                      <th className="p-3 min-w-[140px]">Medical Practice</th>
                                      <th className="p-3 min-w-[160px]">Risk Categories</th>
                                      <th className="p-3 min-w-[160px]">Conditions</th>
                                    </>
                                  ) : (
                                    <th className="p-3 min-w-[160px]">Proposed Unit</th>
                                  )}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50 text-theme-text-secondary">
                                {standardizationSummary.map((item: any, idx: number) => {
                                  const originalDef = profile.customBiomarkers?.[item.key] || biomarkerDefinitions.find((b: any) => b.key === item.key);
                                  
                                  let parsedRisks = item.riskCategories;
                                  if (typeof parsedRisks === 'string') {
                                    try { parsedRisks = JSON.parse(parsedRisks); } catch (e) { parsedRisks = parsedRisks.split(',').map((s: string) => s.trim()); }
                                  }
                                  let parsedConds = item.potentialMedicalConditions;
                                  if (typeof parsedConds === 'string') {
                                    try { parsedConds = JSON.parse(parsedConds); } catch (e) { parsedConds = parsedConds.split(',').map((s: string) => s.trim()); }
                                  }
                                  
                                  return (
                                    <React.Fragment key={idx}>
                                      <tr className="hover:bg-slate-50/50 dark:hover:bg-slate-800/20">
                                        <td className="p-3 font-medium min-w-[140px]">
                                          <div className="font-bold text-slate-800 dark:text-slate-100">{item.name || item.key}</div>
                                          <div className="text-[10px] text-slate-400 font-mono">{item.key}</div>
                                          {item.potentialDuplicateOf && 
                                            String(item.potentialDuplicateOf).trim().toLowerCase() !== String(item.key || '').trim().toLowerCase() && 
                                            String(item.potentialDuplicateOf).trim().toLowerCase() !== String(item.name || '').trim().toLowerCase() && (
                                            <div className="mt-1 flex items-center gap-1 text-[10px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded border border-amber-200 dark:border-amber-800/60 font-sans">
                                              <span>⚠️ Potential duplicate of <span className="font-mono font-bold">{item.potentialDuplicateOf}</span> — will be flagged for Duplicate & Alias Group</span>
                                            </div>
                                          )}
                                        </td>
                                      {isRangeCalibrationMode ? (
                                        <>
                                          <td className="p-3 font-mono">
                                            <div className="flex flex-col gap-0.5">
                                              {originalDef?.unit && originalDef.unit !== item.unit && (
                                                <span className="text-slate-400 line-through text-[10px] font-mono">{originalDef.unit}</span>
                                              )}
                                              <span className="text-emerald-600 dark:text-emerald-400 font-bold">{item.unit || 'score'}</span>
                                            </div>
                                          </td>
                                          <td className="p-3">
                                            <div className="flex flex-col gap-0.5">
                                              {originalDef?.normalRange && originalDef.normalRange !== item.normalRange && (
                                                <span className="text-slate-400 line-through text-[10px]">{originalDef.normalRange}</span>
                                              )}
                                              <span className="text-emerald-700 dark:text-emerald-300 font-bold bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
                                                {item.normalRange || (item.minRange !== undefined && item.maxRange !== undefined ? `${item.minRange} - ${item.maxRange}` : 'Standard')}
                                              </span>
                                              {item.dataType === 'qualitative' || item.unit === 'qualitative' ? (
                                                <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-mono font-medium">
                                                  Qualitative (Negative / Positive)
                                                </span>
                                              ) : item.dataType === 'composite' || item.key === 'blood_pressure' ? (
                                                <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                                                  Systolic: 90 - 120 | Diastolic: 60 - 80 mmHg
                                                </span>
                                              ) : item.instrumentScale ? (
                                                <span className="text-[10px] text-amber-600 dark:text-amber-400 font-mono font-medium">
                                                  Scale: {item.instrumentScale} points
                                                </span>
                                              ) : (item.minRange !== null && item.minRange !== undefined || item.maxRange !== null && item.maxRange !== undefined) ? (
                                                <span className="text-[10px] text-slate-400 font-mono">
                                                  Min: {item.minRange ?? '—'} | Max: {item.maxRange ?? '—'}
                                                </span>
                                              ) : null}
                                            </div>
                                          </td>
                                          <td className="p-3">
                                            {item.optimalRange ? (
                                              <span className="text-indigo-700 dark:text-indigo-300 font-medium bg-indigo-50 dark:bg-indigo-950/40 px-2 py-0.5 rounded border border-indigo-200 dark:border-indigo-800 text-[11px]">
                                                {item.optimalRange}
                                              </span>
                                            ) : (
                                              <span className="text-slate-400 text-[11px]">—</span>
                                            )}
                                          </td>
                                          <td className="p-3">
                                            <div className="flex flex-col gap-1">
                                              <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300">{item.standardMedicalGrouping}</span>
                                              <div className="flex flex-wrap gap-1">
                                                {(Array.isArray(parsedRisks) ? parsedRisks : []).slice(0, 3).map((r: string, i: number) => (
                                                  <span key={i} className="px-1.5 py-0.2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded text-[9px]">{r}</span>
                                                ))}
                                              </div>
                                            </div>
                                          </td>
                                          <td className="p-3 text-[11px] text-slate-600 dark:text-slate-300 min-w-[240px]">
                                            <p className="whitespace-normal leading-relaxed text-slate-700 dark:text-slate-200 break-words">{item.notes || 'Evidence-based population reference interval.'}</p>
                                          </td>
                                        </>
                                      ) : isMedicalCategorisationMode ? (
                                        <>
                                          <td className="p-3">
                                            <div className="flex flex-col gap-1">
                                              {originalDef?.standardMedicalGrouping && originalDef.standardMedicalGrouping !== item.standardMedicalGrouping && originalDef.standardMedicalGrouping !== 'By Medical Practice' && (
                                                <span className="text-slate-400 line-through text-[10px]">{originalDef.standardMedicalGrouping}</span>
                                              )}
                                              <span className="text-emerald-600 dark:text-emerald-400 font-bold">{item.standardMedicalGrouping}</span>
                                            </div>
                                          </td>
                                          <td className="p-3">
                                            <div className="flex flex-wrap gap-1">
                                              {/* Show deleted risk categories */}
                                              {(originalDef?.riskCategories || []).filter((r: string) => !(Array.isArray(parsedRisks) ? parsedRisks : []).includes(r)).map((r: string, i: number) => (
                                                <span key={"del-"+i} className="px-1.5 py-0.5 border border-red-200 dark:border-red-900/30 text-slate-400 line-through rounded text-[10px]">{r}</span>
                                              ))}
                                              {(Array.isArray(parsedRisks) ? parsedRisks : []).map((r: string, i: number) => (
                                                <span key={i} className="px-1.5 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded text-[10px]">{r}</span>
                                              ))}
                                            </div>
                                          </td>
                                          <td className="p-3">
                                            <div className="flex flex-wrap gap-1">
                                              {/* Show deleted conditions */}
                                              {(originalDef?.potentialMedicalConditions || []).filter((c: string) => !(Array.isArray(parsedConds) ? parsedConds : []).includes(c)).map((c: string, i: number) => (
                                                <span key={"del-"+i} className="px-1.5 py-0.5 border border-indigo-200 dark:border-indigo-900/30 text-slate-400 line-through rounded text-[10px]">{c}</span>
                                              ))}
                                              {(Array.isArray(parsedConds) ? parsedConds : []).map((c: string, i: number) => (
                                                <span key={i} className="px-1.5 py-0.5 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 rounded text-[10px]">{c}</span>
                                              ))}
                                            </div>
                                          </td>
                                        </>
                                      ) : (
                                        <td className="p-3 font-mono">
                                          <div className="flex items-center gap-1.5">
                                            {originalDef?.unit && originalDef.unit.trim().toLowerCase() !== (item.unit || '').trim().toLowerCase() ? (
                                              <>
                                                <span className="text-slate-400 line-through text-[10px]">{originalDef.unit}</span>
                                                <span className="text-slate-500">→</span>
                                                <span className="text-emerald-600 dark:text-emerald-400 font-bold">{item.unit}</span>
                                              </>
                                            ) : (
                                              <span className="text-emerald-600 dark:text-emerald-400 font-bold bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800 text-[11px]">
                                                {item.unit || 'Standard'} (Verified)
                                              </span>
                                            )}
                                          </div>
                                        </td>
                                      )}
                                    </tr>

                                    {/* Sub-row for batch log value conversions */}
                                    {!isRangeCalibrationMode && !isMedicalCategorisationMode && item.affectedLogs && item.affectedLogs.length > 0 && (
                                      <tr key={`logs-${idx}`} className="bg-amber-50/40 dark:bg-amber-950/20 border-b border-amber-200/50 dark:border-amber-900/30">
                                        <td colSpan={2} className="p-3 pl-6">
                                          <div className="space-y-2">
                                            <div className="flex items-center justify-between text-xs">
                                              <div className="flex items-center gap-1.5 font-bold text-amber-900 dark:text-amber-200">
                                                <span>🔄 {item.isUnitConversion ? "Batch Unit Conversion" : "Outlier Reading Correction"} ({item.valueAdjustmentReason || `Scale ×${item.valueMultiplier}`}):</span>
                                                <span className="text-[10px] bg-amber-200 dark:bg-amber-900 text-amber-900 dark:text-amber-100 px-1.5 py-0.5 rounded-full font-mono font-bold">
                                                  {item.affectedLogs.filter((l: any) => selectedLogFixKeys[l.logId || `${item.key}_${l.date}`]).length} / {item.affectedLogs.length} selected
                                                </span>
                                              </div>
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  const allSelected = item.affectedLogs.every((l: any) => selectedLogFixKeys[l.logId || `${item.key}_${l.date}`]);
                                                  setSelectedLogFixKeys(prev => {
                                                    const next = { ...prev };
                                                    item.affectedLogs.forEach((l: any) => {
                                                      next[l.logId || `${item.key}_${l.date}`] = !allSelected;
                                                    });
                                                    return next;
                                                  });
                                                }}
                                                className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                                              >
                                                {item.affectedLogs.every((l: any) => selectedLogFixKeys[l.logId || `${item.key}_${l.date}`]) ? "Deselect All Logs" : "Select All Logs"}
                                              </button>
                                            </div>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                                              {item.affectedLogs.map((log: any, logIdx: number) => {
                                                const logKey = log.logId || `${item.key}_${log.date}`;
                                                const isChecked = !!selectedLogFixKeys[logKey];
                                                return (
                                                  <label
                                                    key={logIdx}
                                                    className={`flex items-center gap-2 p-2 rounded-lg border text-xs cursor-pointer transition-colors ${
                                                      isChecked
                                                        ? 'bg-amber-100/70 dark:bg-amber-900/40 border-amber-300 dark:border-amber-700 text-slate-800 dark:text-slate-100'
                                                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-500 opacity-60'
                                                    }`}
                                                  >
                                                    <input
                                                      type="checkbox"
                                                      checked={isChecked}
                                                      onChange={() => {
                                                        setSelectedLogFixKeys(prev => ({
                                                          ...prev,
                                                          [logKey]: !prev[logKey]
                                                        }));
                                                      }}
                                                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer shrink-0"
                                                    />
                                                    <div className="flex-1 min-w-0 font-mono text-[11px]">
                                                      <div className="font-bold text-slate-700 dark:text-slate-300 truncate">{log.date}</div>
                                                      <div className="flex items-center gap-1">
                                                        <span className="line-through text-slate-400">{log.oldValue}</span>
                                                        <span className="text-slate-500">→</span>
                                                        <span className="font-bold text-emerald-600 dark:text-emerald-400">{log.newValue} {item.unit}</span>
                                                      </div>
                                                    </div>
                                                    {log.isClearlyErroneous && (
                                                      <span className="text-[9px] bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 font-bold px-1.5 py-0.5 rounded shrink-0">
                                                        Outlier
                                                      </span>
                                                    )}
                                                  </label>
                                                );
                                              })}
                                            </div>
                                          </div>
                                        </td>
                                      </tr>
                                    )}
                                  </React.Fragment>
                                );
                              })}
                              </tbody>
                            </table>
                          </div>

                          {/* Approval and application controls */}
                          <div className="flex gap-3 pt-2">
                            <button
                              type="button"
                              onClick={() => {
                                setStandardizationYaml(null);
                                setStandardizationSummary(null);
                              }}
                              className="flex-1 py-3 bg-white dark:bg-slate-800 border border-theme-border text-theme-neutral rounded-xl text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-sm"
                            >
                              Reset Configuration
                            </button>
                            <button
                              type="button"
                              disabled={agentLoading}
                              onClick={handleApplyStandardization}
                              className="flex-1 py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-1.5 shadow-md shadow-emerald-600/10 disabled:opacity-60 cursor-pointer"
                            >
                              {agentLoading ? (
                                <>
                                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                  <span>Applying Changes...</span>
                                </>
                              ) : (
                                <>
                                  <CheckCircle className="w-4 h-4" />
                                  <span>
                                    {isRangeCalibrationMode 
                                      ? "Approve & Apply Range Calibrations" 
                                      : (isMedicalCategorisationMode ? "Approve & Apply Categorisation" : "Approve & Apply Unit Standardization")}
                                  </span>
                                </>
                              )}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : isBatchPasteMode ? (
          /* BATCH CONSOLIDATION MODE LAYOUT */
          <div className="flex-1 p-5 overflow-y-auto space-y-5 bg-theme-bg">
            <div className="bg-theme-bg-card border border-theme-border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <FileCode className="w-4 h-4 text-indigo-500" />
                  Batch Consolidate (JSON)
                </h3>
              </div>
              <p className="text-xs text-theme-text-secondary">
                Paste a JSON object to merge biomarkers or update their definitions.
              </p>
              
              <details className="text-xs border border-theme-border rounded-lg bg-theme-bg overflow-hidden">
                <summary className="font-bold text-theme-neutral p-3 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors select-none">
                  Key Reference & Format Guide
                </summary>
                <div className="p-3 border-t border-theme-border space-y-3 text-theme-text-secondary">
                  <p><strong>Option 1: Merge Historical Logs</strong><br/>
                  Map a source term to a target snake_case key to combine their logs.</p>
                  <pre className="bg-slate-100 dark:bg-slate-900 p-2 rounded border border-theme-border font-mono text-[10px]">
{`{
  "HbA1c": "hba1c",
  "0": "hba1c"
}`}
                  </pre>
                  
                  <p><strong>Option 2: Batch Update (Array)</strong><br/>
                  Pass a list of objects with the <code>key</code> property to update multiple biomarkers at once.</p>
                  <pre className="bg-slate-100 dark:bg-slate-900 p-2 rounded border border-theme-border font-mono text-[10px]">{JSON.stringify([
  {
    "key": "hba1c",
    "name": "HbA1c",
    "unit": "mmol/mol",
    "normalRange": "20 - 41"
  }
], null, 2)}
                  </pre>
                  
                  <p className="mt-3"><strong>Option 3: Dictionary Map</strong><br/>
                  Update multiple properties using the biomarker key as the property name.</p>
                  <pre className="bg-slate-100 dark:bg-slate-900 p-2 rounded border border-theme-border font-mono text-[10px]">{JSON.stringify({
  "hba1c": {
    "name": "HbA1c",
    "unit": "mmol/mol",
    "normalRange": "20 - 41"
  }
}, null, 2)}
                  </pre>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div>
                      <strong>Supported Keys:</strong>
                      <ul className="list-disc pl-4 mt-1 space-y-1 text-[10px]">
                        <li><code>name</code> (string)</li>
                        <li><code>unit</code> (string)</li>
                        <li><code>normalRange</code> (string)</li>
                        <li><code>description</code> (string)</li>
                      </ul>
                    </div>
                    <div>
                      <ul className="list-disc pl-4 mt-5 space-y-1 text-[10px]">
                        <li><code>standardMedicalGrouping</code> (string)</li>
                        <li><code>riskCategories</code> (array of strings)</li>
                        <li><code>potentialMedicalConditions</code> (array of strings)</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </details>
              
              <textarea
                value={pasteText}
                onChange={e => handlePasteChange(e.target.value)}
                rows={10}
                placeholder={`{\n  "HbA1c": "hba1c",\n  "hba1c": {\n    "normalRange": "20 - 41"\n  }\n}`}
                className="w-full bg-theme-bg border border-theme-border rounded-xl p-3 font-mono text-xs outline-none focus:ring-2 focus:ring-indigo-500/20"
              />

              {pasteError && (
                <div className="p-3 bg-rose-50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/30 rounded-lg text-rose-600 dark:text-rose-400 text-xs font-medium flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4" /> {pasteError}
                </div>
              )}

              {parsedMapping && (
                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/30 rounded-lg text-emerald-700 dark:text-emerald-400 text-xs">
                  <div className="font-bold flex items-center gap-1.5 mb-2">
                    <CheckCircle className="w-4 h-4 text-emerald-500" /> JSON parsed successfully! Found {Object.keys(parsedMapping).length} mappings:
                  </div>
                  <div className="max-h-48 overflow-y-auto pr-1 space-y-1 font-mono text-[11px]">
                    {Array.isArray(parsedMapping) ? parsedMapping.slice(0, 10).map((item, idx) => (
                      <div key={idx} className="flex flex-col border-b border-emerald-100/30 py-1 gap-0.5">
                        <span className="font-bold text-emerald-800 dark:text-emerald-300">Target Key: {item.key || 'Missing key!'}</span>
                        <div className="flex flex-col pl-2 border-l border-emerald-200/50">
                          {Object.entries(item).filter(([k]) => k !== 'key').map(([k, v]) => (
                            <span key={k} className="truncate"><span className="opacity-70">{k}:</span> {JSON.stringify(v)}</span>
                          ))}
                        </div>
                      </div>
                    )) : Object.entries(parsedMapping).slice(0, 10).map(([src, tgt]) => (
                      <div key={src} className="flex justify-between border-b border-emerald-100/30 py-0.5">
                        <span className="truncate max-w-[48%]">{src}</span>
                        <span className="text-emerald-500">→</span>
                        <span className="truncate max-w-[48%]">
                          {typeof tgt === 'string' ? tgt : <pre className="inline text-[9px] bg-emerald-100/50 dark:bg-emerald-900/50 p-0.5 rounded">{JSON.stringify(tgt)}</pre>}
                        </span>
                      </div>
                    ))}
                    {Object.keys(parsedMapping).length > 10 && (
                      <div className="text-center text-slate-400 font-sans text-[10px] mt-1">
                        ...and {Object.keys(parsedMapping).length - 10} more mappings
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setIsBatchPasteMode(false)}
                className="px-4 py-2 border border-theme-border text-theme-text-secondary rounded-xl text-xs font-bold hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleApplyBatchConsolidate}
                disabled={!parsedMapping}
                className="px-5 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center gap-1.5 shadow-sm"
              >
                <CheckCircle className="w-4 h-4" />
                Run Batch Consolidation
              </button>
            </div>
          </div>
        ) : (
          /* STANDARD DICTIONARY LISTS */
          <div className="flex-1 flex flex-col overflow-hidden">
            
            {/* Top Batch and Selection Controls */}
            <div className="bg-slate-50 dark:bg-slate-900/50 p-3 border-b border-theme-border flex flex-wrap gap-2 justify-between items-center">
              <div className="flex items-center gap-2 flex-wrap">
                <input 
                  type="text" 
                  placeholder="Search biomarkers..." 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-theme-border rounded-lg text-xs outline-none focus:border-indigo-500 w-48 text-slate-700 dark:text-slate-200"
                />
                <select
                  value={filterOption}
                  onChange={(e) => setFilterOption(e.target.value as any)}
                  className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-theme-border rounded-lg text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:border-indigo-500 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  <option value="all">All Approved ({allApprovedKeysUnfiltered.length})</option>
                  <option value="overrides">Custom Overrides ({allApprovedKeysUnfiltered.filter(hasActualOverride).length})</option>
                  <option value="missing_units">Missing Units ({missingUnitsCount})</option>
                </select>
                {notUsedCount > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (onOpenNotUsedScreen) onOpenNotUsedScreen('dictionary');
                      setShowNotUsedModal(true);
                    }}
                    className="px-2.5 py-1.5 bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900 border border-amber-300 dark:border-amber-800/80 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shrink-0"
                  >
                    <span>Not used ({notUsedCount})</span>
                  </button>
                )}
                <select
                  value={filterTag || ""}
                  onChange={(e) => setFilterTag(e.target.value || null)}
                  className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-theme-border rounded-lg text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:border-indigo-500 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  <option value="">All Tags</option>
                  <optgroup label="Medical Practice">
                    {Array.from(allGroupings).sort().map(g => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Risk Categories">
                    {Array.from(allRisks).sort().map(r => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Conditions">
                    {Array.from(allConditions).sort().map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </optgroup>
                </select>
                <button
                  onClick={() => setShowAuditModal(true)}
                  className="px-3 py-1.5 bg-gradient-to-r from-amber-500 to-indigo-600 hover:from-amber-600 hover:to-indigo-700 text-white rounded-lg text-xs font-bold shadow-sm flex items-center gap-1 transition-all cursor-pointer"
                  title="Run generalized structural & quality audit on all biomarkers"
                >
                  <Zap className="w-3.5 h-3.5 text-amber-200" />
                  Check Biomarkers
                </button>
                <button
                  onClick={() => setIsBatchPasteMode(true)}
                  className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-theme-border rounded-lg text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors flex items-center gap-1"
                >
                  <FileCode className="w-3.5 h-3.5 text-indigo-500" />
                  Batch Consolidate
                </button>
                <button
                  onClick={() => {
                    const filteredKeysToCopy = selectedKeys.length > 0 ? selectedKeys : Array.from(new Set([...toApproveKeys, ...allApprovedKeys]));
                    const textContent = filteredKeysToCopy.map(k => {
                      const d = (profile.customBiomarkers?.[k] || biomarkerDefinitions.find(bd => bd.key === k) || { name: k, unit: '', normalRange: undefined }) as any;
                      const unit = d.unit || '';
                      const range = d.normalRange || 'N/A';
                      
                      const logsForBiomarker = biomarkerHistory
                        .filter(log => log.biomarkers[k] !== undefined)
                        .sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));
                        
                      let logString = '';
                      if (logsForBiomarker.length > 0) {
                        logString = logsForBiomarker.map(log => `  - [${log.date}] ${log.biomarkers[k]} ${unit}`).join('\n');
                      } else {
                        const latestValue = biomarkers[k] !== undefined ? biomarkers[k] : 'N/A';
                        logString = `  - [Latest Value] ${latestValue} ${unit}`;
                      }
                      
                      return `Biomarker: ${d.name || k} (${k})\nReference Range: ${range} ${unit}\nUnit: ${unit}\nLogged History:\n${logString}`;
                    }).join('\n\n========================================\n\n');
                    
                    navigator.clipboard.writeText(textContent);
                    alert(interpolate(t(profile.language, 'dictAlertCopiedN'), { n: filteredKeysToCopy.length }));
                  }}
                  className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-theme-border rounded-lg text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors flex items-center gap-1"
                >
                  <Copy className="w-3.5 h-3.5 text-slate-500" />
                  {t(profile.language, 'dictCopyAll')}
                </button>
              </div>

              {(filterTag || searchQuery.trim() !== '' || filterOption !== 'all') && (
                <div className="flex flex-wrap items-center gap-2 p-2.5 bg-indigo-50/80 dark:bg-indigo-950/40 border border-indigo-200/60 dark:border-indigo-800/50 rounded-xl text-xs text-indigo-900 dark:text-indigo-200 mb-2 animation-fade-in">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">Active Filters:</span>
                  {filterTag && (
                    <span className="px-2 py-0.5 bg-indigo-100 dark:bg-indigo-900/60 border border-indigo-300/60 dark:border-indigo-700/60 rounded-md font-bold flex items-center gap-1">
                      Tag: {filterTag}
                      <button type="button" onClick={() => setFilterTag(null)} className="hover:text-rose-500 font-bold ml-1 cursor-pointer">✕</button>
                    </span>
                  )}
                  {searchQuery.trim() !== '' && (
                    <span className="px-2 py-0.5 bg-indigo-100 dark:bg-indigo-900/60 border border-indigo-300/60 dark:border-indigo-700/60 rounded-md font-bold flex items-center gap-1">
                      Search: "{searchQuery}"
                      <button type="button" onClick={() => setSearchQuery('')} className="hover:text-rose-500 font-bold ml-1 cursor-pointer">✕</button>
                    </span>
                  )}
                  {filterOption === 'missing_units' && (
                    <span className="px-2 py-0.5 bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-800/80 rounded-md font-bold flex items-center gap-1">
                      Missing Units / Ranges
                      <button type="button" onClick={() => setFilterOption('all')} className="hover:text-rose-500 font-bold ml-1 cursor-pointer">✕</button>
                    </span>
                  )}
                  {filterOption === 'overrides' && (
                    <span className="px-2 py-0.5 bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800/80 rounded-md font-bold flex items-center gap-1">
                      Custom Overrides
                      <button type="button" onClick={() => setFilterOption('all')} className="hover:text-rose-500 font-bold ml-1 cursor-pointer">✕</button>
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setFilterTag(null);
                      setSearchQuery('');
                      setFilterOption('all');
                    }}
                    className="ml-auto px-2.5 py-1 text-[11px] font-bold bg-white dark:bg-slate-800 border border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 rounded-lg hover:bg-indigo-50 dark:hover:bg-slate-700 transition-colors cursor-pointer shadow-xs"
                  >
                    Reset Filters (Show All)
                  </button>
                </div>
              )}

              {selectedKeys.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 animation-fade-in pb-2 w-full">
                  <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 shrink-0">{selectedKeys.length} selected</span>

                  <button
                    onClick={() => setShowCombineModal(true)}
                    className="shrink-0 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold flex items-center gap-1 shadow-sm"
                  >
                    <Merge className="w-3.5 h-3.5" />
                    Combine Selected
                  </button>
                  <button
                    onClick={() => startChatWithKeys(selectedKeys)}
                    className="shrink-0 px-3 py-1.5 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-900/30 rounded-lg text-xs font-bold flex items-center gap-1 shadow-sm"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    Route Selected
                  </button>
                  {showDeleteSelectedConfirm ? (
                    <div className="flex items-center gap-1.5 bg-rose-50 dark:bg-rose-900/20 border border-rose-100 dark:border-rose-900/40 rounded-lg p-1.5 shrink-0">
                      <span className="text-[10px] text-rose-600 dark:text-rose-400 font-bold px-1">Delete {selectedKeys.length} items?</span>
                      <button
                        onClick={() => {
                          const newCustomBiomarkers = { ...profile.customBiomarkers };
                          selectedKeys.forEach(k => {
                            delete newCustomBiomarkers[k];
                          });
                          if (onDeleteMultipleBiomarkers) {
                             onDeleteMultipleBiomarkers(selectedKeys);
                          } else if (onDeleteBiomarker) {
                             selectedKeys.forEach(k => onDeleteBiomarker(k));
                          } else {
                             onUpdateProfile({ customBiomarkers: newCustomBiomarkers });
                          }
                          setSelectedKeys([]);
                          setShowDeleteSelectedConfirm(false);
                        }}
                        className="px-2 py-1 bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-bold rounded transition-colors cursor-pointer"
                      >
                        Yes, Delete
                      </button>
                      <button
                        onClick={() => setShowDeleteSelectedConfirm(false)}
                        className="px-2 py-1 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 text-[10px] font-bold transition-colors cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowDeleteSelectedConfirm(true)}
                      className="shrink-0 px-3 py-1.5 bg-rose-50 text-rose-600 hover:bg-rose-100 dark:bg-rose-900/20 dark:hover:bg-rose-900/40 rounded-lg text-xs font-bold transition-colors"
                    >
                      Delete Selected
                    </button>
                  )}
                  <button
                    onClick={() => setSelectedKeys([])}
                    className="shrink-0 px-2 py-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs font-medium"
                  >
                    Deselect
                  </button>
                </div>
              )}
            </div>

            {/* List Panels scroll container */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-6">
              
              {/* ACTIVE AGENT SESSIONS REMINDER BANNERS */}
              {(!isAgentMode && !isDataAccuracyMode && !isNameConsolidationMode && !isChatMode) && (
                <div className="space-y-3 mb-4">
                  {/* Categorisation / Standardization Agent Results */}
                  {standardizationSummary && standardizationSummary.length > 0 && (
                    <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 rounded-xl p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-emerald-100 dark:bg-emerald-900/50 rounded-lg text-emerald-700 dark:text-emerald-300">
                          <CheckCircle className="w-4 h-4" />
                        </div>
                        <div>
                          <p className="text-xs font-bold text-emerald-900 dark:text-emerald-200">
                            {isMedicalCategorisationMode ? "Unapplied Clinical Categorisations Available" : "Unapplied Unit Standardizations Available"}
                          </p>
                          <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
                            {standardizationSummary.length} biomarker recommendation(s) generated by the agent are ready for your review.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                        <button
                          type="button"
                          onClick={() => {
                            setStandardizationYaml(null);
                            setStandardizationSummary(null);
                          }}
                          className="px-2.5 py-1.5 text-xs font-semibold text-slate-400 hover:text-rose-500 transition-colors cursor-pointer"
                        >
                          Clear Results
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setIsAgentMode(true);
                          }}
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-all cursor-pointer shadow-xs flex items-center gap-1"
                        >
                          Open Agent Results &rarr;
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Name Consolidation Results */}
                  {consolidationGroups && consolidationGroups.length > 0 && (
                    <div className="bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800/60 rounded-xl p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-violet-100 dark:bg-violet-900/50 rounded-lg text-violet-700 dark:text-violet-300">
                          <BrainCircuit className="w-4 h-4" />
                        </div>
                        <div>
                          <p className="text-xs font-bold text-violet-900 dark:text-violet-200">Name Consolidation Results Available</p>
                          <p className="text-[11px] text-violet-700 dark:text-violet-400">
                            {totalBiomarkersReduced === 0
                              ? "No duplicate names found among the reviewed biomarkers."
                              : `${consolidationGroups.length} proposed master group(s) ready — reducing ${totalOriginalBiomarkersInConsolidation} biomarkers down to ${totalMasterBiomarkersInConsolidation} (${totalBiomarkersReduced} duplicate${totalBiomarkersReduced === 1 ? '' : 's'} reduced).`}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                        <button
                          type="button"
                          onClick={() => {
                            setConsolidationYaml(null);
                            setConsolidationGroups(null);
                          }}
                          className="px-2.5 py-1.5 text-xs font-semibold text-slate-400 hover:text-rose-500 transition-colors cursor-pointer"
                        >
                          {totalBiomarkersReduced === 0 ? "Dismiss" : "Clear Results"}
                        </button>
                        {totalBiomarkersReduced > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setIsNameConsolidationMode(true);
                            }}
                            className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-xs font-bold transition-all cursor-pointer shadow-xs flex items-center gap-1"
                          >
                            Open Consolidation &rarr;
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Route Agent Chat Session */}
                  {chatMessages.length > 1 && (
                    <div className="bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-slate-200 dark:bg-slate-700 rounded-lg text-slate-700 dark:text-slate-200">
                          <MessageSquare className="w-4 h-4" />
                        </div>
                        <div>
                          <p className="text-xs font-bold text-slate-800 dark:text-slate-200">Route Agent Chat Session</p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            {chatMessages.length} message(s) in active ontology discussion.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                        <button
                          type="button"
                          onClick={() => {
                            setChatMessages([]);
                          }}
                          className="px-2.5 py-1.5 text-xs font-semibold text-slate-400 hover:text-rose-500 transition-colors cursor-pointer"
                        >
                          Clear Chat
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setIsChatMode(true);
                          }}
                          className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-xs font-bold transition-all cursor-pointer shadow-xs flex items-center gap-1"
                        >
                          Open Chat &rarr;
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Data Accuracy Session */}
                  {dataAccuracyMessages.length > 1 && (
                    <div className="bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/50 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm animate-in fade-in slide-in-from-top-2 duration-300">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-indigo-100 dark:bg-indigo-900/50 rounded-lg text-indigo-700 dark:text-indigo-300">
                          <span className="text-sm">🧪</span>
                        </div>
                        <div>
                          <p className="text-xs font-bold text-indigo-800 dark:text-indigo-300">Active Cleaning Session in Progress</p>
                          <p className="text-[11px] text-indigo-600 dark:text-indigo-400">You have an ongoing data accuracy review session with the agent.</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                        {showDiscardSessionConfirm ? (
                          <div className="flex items-center gap-1.5 bg-rose-50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/30 rounded-lg p-1">
                            <span className="text-[10px] text-rose-600 dark:text-rose-400 font-bold px-1.5">Discard session?</span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setDataAccuracyMessages([
                                  {
                                    id: 'acc_msg_init',
                                    role: 'assistant',
                                    content: 'Hello! I am the Data Accuracy Agent, your cleaning specialist. 🧪\n\nShare any new biomarker readings, laboratory results, or logs by **typing them down** or **uploading files/images**.\n\nI will compare your input with your existing database definitions and latest logs to highlight any differences in **Name, Unit, Value, Date, and Comments**, and generate an interactive table so you can choose which information to keep.',
                                    timestamp: new Date().toISOString()
                                  }
                                ]);
                                setAccuracyComparisonResults(null);
                                setAccuracySelectedFields({});
                                setAccuracyUploadedFiles([]);
                                setDataAccuracyInput('');
                                localStorage.removeItem('data_accuracy_messages');
                                localStorage.removeItem('data_accuracy_comparison_results');
                                localStorage.removeItem('data_accuracy_selected_fields');
                                setShowDiscardSessionConfirm(false);
                              }}
                              className="px-2 py-1 bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-bold rounded transition-colors cursor-pointer"
                            >
                              Discard
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setShowDiscardSessionConfirm(false);
                              }}
                              className="px-2 py-1 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 text-[10px] font-bold transition-colors cursor-pointer"
                            >
                              Keep
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setShowDiscardSessionConfirm(true);
                            }}
                            className="px-2.5 py-1.5 text-xs font-semibold text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 transition-colors cursor-pointer"
                          >
                            Discard
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setIsDataAccuracyMode(true);
                            setIsChatMode(false);
                            setIsAgentMode(false);
                            setIsMedicalCategorisationMode(false);
                          }}
                          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-all cursor-pointer shadow-sm shadow-indigo-600/10"
                        >
                          Resume Agent &rarr;
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* TO BE APPROVED PANEL */}
              {toApproveKeys.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                      <Clock className="w-4 h-4 text-amber-500 animate-pulse" />
                      Biomarkers To Review ({toApproveKeys.length})
                      <span className="text-[10px] bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 font-bold px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                        Needing Review or Approval
                      </span>
                    </h3>
                    {toApproveKeys.length > 0 && (
                      <div className="flex items-center gap-3">
                        <button 
                          onClick={() => handleToggleSelectAll(toApproveKeys)}
                          className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                        >
                          {toApproveKeys.every(k => selectedKeys.includes(k)) ? "Deselect All" : "Select All"}
                        </button>
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-theme-text-secondary mb-4">
                    These biomarkers are pending approval, have missing reference ranges, or have recently logged values that fall outside physiological bounds (indicating possible unit scaling errors).
                  </p>
                  <div className="space-y-2">
                    {toApproveKeys.map(key => {
                      const builtIn = biomarkerDefinitions.find((b: any) => b.key === key || (Array.isArray(b.aliases) && b.aliases.some((a: string) => a.toLowerCase() === key.toLowerCase())));
                      const custom = profile.customBiomarkers?.[key];
                      const isSelected = selectedKeys.includes(key);
                      const itemLogs = collectItemLogs(key).sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));
                      const combined = getMergedBiomarkerDef(key, builtIn, custom, itemLogs);
                      const logsCount = itemLogs.length;

                      const missingParts: string[] = [];
                      if (custom?.needsApproval || profile.customBiomarkers?.[key]?.needsApproval) {
                        missingParts.push('Extracted entry pending clinical verification');
                      }
                      if (!combined.name || combined.name.trim() === '') {
                        missingParts.push('Missing biomarker display name');
                      }
                      if (!combined.unit || combined.unit.trim() === '') {
                        missingParts.push('Missing measurement unit');
                      }
                      if (!combined.normalRange || combined.normalRange.trim() === '' || combined.normalRange === 'Unknown') {
                        missingParts.push('Missing reference range');
                      }
                      if (!combined.standardMedicalGrouping || combined.standardMedicalGrouping.trim() === '' || combined.standardMedicalGrouping === 'By Medical Practice') {
                        missingParts.push('Missing medical practice grouping');
                      }
                      if (!Array.isArray(combined.riskCategories) || combined.riskCategories.length === 0 || combined.riskCategories.includes('Uncategorized')) {
                        missingParts.push('Missing risk categories');
                      }
                      if (!Array.isArray(combined.potentialMedicalConditions) || combined.potentialMedicalConditions.length === 0) {
                        missingParts.push('Missing associated medical conditions');
                      }

                      const computedReason = missingParts.length > 0 
                        ? `Needs approval due to: ${missingParts.join('; ')}.`
                        : 'Pending final user review before adding to active standardized dictionary.';
                      return (
                        <DictionaryItem
                          approvalReason={computedReason}
                          key={key}
                          itemKey={key}
                          builtInDef={builtIn}
                          customDef={custom}
                          logsCount={logsCount}
                          isSelected={isSelected}
                          telemetryFlag={telemetryFlagMap.get(key)}
                          onOpenAudit={(tab) => handleOpenAuditForBiomarker(key, tab)}
                          onTagClick={setFilterTag}
                          onFlagNotUsed={onFlagNotUsed}
                          allGroupings={allGroupings}
                          allRisks={allRisks}
                          allConditions={allConditions}
                          itemLogs={itemLogs}
                          onToggleSelect={() => handleToggleSelect(key)}

                          onSave={(updates) => {
                            const { newKey, ...restUpdates } = updates;
                            const newCustomBiomarkers = { ...profile.customBiomarkers };
                            let updatedHistory = [...biomarkerHistory];
                            const editedAt = Date.now();

                            if (newKey && newKey !== key) {
                               // Key was renamed
                               newCustomBiomarkers[newKey] = { ...combined, ...restUpdates, name: restUpdates.name || newKey, updatedAt: editedAt };
                               delete newCustomBiomarkers[newKey].needsApproval;
                               delete newCustomBiomarkers[key];
                               
                               // Need to update history directly via combining or propagating
                               onCombineBiomarkers(
                                 newKey, 
                                 newCustomBiomarkers[newKey], 
                                 updatedHistory.map(h => {
                                   if (h.biomarkers[key] !== undefined) {
                                     return { date: h.date, value: h.biomarkers[key] };
                                   }
                                   return null;
                                 }).filter(Boolean) as any[],
                                 [key]
                                );
                               return; // combineBiomarkers saves the profile
                            } else {
                               newCustomBiomarkers[key] = { ...combined, ...restUpdates, updatedAt: editedAt };
                               delete newCustomBiomarkers[key].needsApproval;
                            }

                            onUpdateProfile({
                              customBiomarkers: newCustomBiomarkers
                            });
                          }}
                          onRouteAgent={() => handleRouteBiomarker(key)}
                          isProcessing={isProcessing === key}
                        />
                      );
                    })}
                  </div>
                </div>
              )}

              {/* APPROVED DICTIONARY PANEL */}
              {allApprovedKeys.length > 0 ? (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-indigo-500" />
                      {filterOption === 'overrides' && `Custom Overrides (${allApprovedKeys.length})`}
                      {filterOption === 'missing_units' && `Missing Units / Ranges (${allApprovedKeys.length})`}
                      {filterOption === 'all' && `Approved Biomarkers (${allApprovedKeys.length})`}
                    </h3>
                    <button 
                      onClick={() => handleToggleSelectAll(allApprovedKeys)}
                      className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                      {allApprovedKeys.every(k => selectedKeys.includes(k)) ? "Deselect All" : "Select All"}
                    </button>
                  </div>
                  <p className="text-xs text-theme-text-secondary mb-3">
                    {filterOption === 'overrides' && "These approved biomarkers have custom reference ranges or demographic-specific overrides defined."}
                    {filterOption === 'missing_units' && "These approved biomarkers are missing units of measurement or normal reference ranges. Select or update them to maintain clean data records."}
                    {filterOption === 'all' && "These approved biomarkers are mapped to your profile. You can select them to consolidate multiple biomarkers using Route Agent, or edit their normal ranges and properties."}
                  </p>
                  <div className="space-y-2">
                    {allApprovedKeys.slice(0, visibleApprovedCount).map(key => {
                      const builtIn = biomarkerDefinitions.find((d: any) => d.key === key || (Array.isArray(d.aliases) && d.aliases.some((a: string) => a.toLowerCase() === key.toLowerCase())));
                      const custom = profile.customBiomarkers?.[key];
                      const isSelected = selectedKeys.includes(key);
                      const itemLogs = collectItemLogs(key);
                      const logsCount = itemLogs.length;
                      return (
                        <DictionaryItem
                          key={key}
                          itemKey={key}
                          builtInDef={builtIn}
                          customDef={custom}
                          logsCount={logsCount}
                          isSelected={isSelected}
                          telemetryFlag={telemetryFlagMap.get(key)}
                          onOpenAudit={(tab) => handleOpenAuditForBiomarker(key, tab)}
                          onTagClick={setFilterTag}
                          onFlagNotUsed={onFlagNotUsed}
                          allGroupings={allGroupings}
                          allRisks={allRisks}
                          allConditions={allConditions}
                          itemLogs={itemLogs}
                          onToggleSelect={() => handleToggleSelect(key)}

                          onSave={(updates) => {
                            const combined = { ...builtIn, ...custom };
                            const { newKey, ...restUpdates } = updates;
                            const newCustomBiomarkers = { ...profile.customBiomarkers };
                            const editedAt = Date.now();
                              
                            if (newKey && newKey !== key) {
                               newCustomBiomarkers[newKey] = { ...combined, ...restUpdates, name: restUpdates.name || newKey, updatedAt: editedAt };
                               delete newCustomBiomarkers[newKey].needsApproval;
                               if (!builtIn) { delete newCustomBiomarkers[key]; }
                                 
                               let updatedHistory = [...biomarkerHistory];
                               onCombineBiomarkers(
                                 newKey, 
                                 newCustomBiomarkers[newKey], 
                                 updatedHistory.map(h => {
                                   if (h.biomarkers[key] !== undefined) {
                                     return { date: h.date, value: h.biomarkers[key] };
                                   }
                                   return null;
                                 }).filter(Boolean) as any[],
                                 [key]
                                );
                               return;
                            } else {
                               newCustomBiomarkers[key] = { ...combined, ...restUpdates, updatedAt: editedAt };
                               delete newCustomBiomarkers[key].needsApproval;
                            }

                            onUpdateProfile({
                              customBiomarkers: newCustomBiomarkers
                            });
                          }}
                          onRouteAgent={() => handleRouteBiomarker(key)}
                          isProcessing={isProcessing === key}
                        />
                      );
                    })}
                  </div>
                  {visibleApprovedCount < allApprovedKeys.length && (
                    <div className="pt-3 pb-1 text-center">
                      <button
                        type="button"
                        onClick={() => setVisibleApprovedCount(prev => prev + 50)}
                        className="px-4 py-2 bg-indigo-50 dark:bg-indigo-950/50 hover:bg-indigo-100 dark:hover:bg-indigo-900 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
                      >
                        Load More Biomarkers ({allApprovedKeys.length - visibleApprovedCount} remaining)
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8 text-slate-400 dark:text-slate-500 text-xs">
                  No biomarkers found matching the filter options.
                  {searchQuery && (
                    <div className="mt-4">
                      <button
                        onClick={() => {
                          const dupMatch = findDuplicateOrExistingBiomarker(searchQuery, profile, biomarkerHistory);
                          if (dupMatch) {
                            if (dupMatch.isNotUsed) {
                              const proceed = window.confirm(
                                `"${searchQuery}" matches an existing biomarker "${dupMatch.matchedName}" in your Not-Used list.\n\nWould you like to restore it to your active dictionary instead of creating a duplicate?`
                              );
                              if (proceed) {
                                if (onRestoreNotUsedGlobal) {
                                  onRestoreNotUsedGlobal(dupMatch.matchedKey);
                                } else {
                                  const currentNotUsed = { ...(profile.notUsedBiomarkers || {}) };
                                  delete currentNotUsed[dupMatch.matchedKey];
                                  onUpdateProfile({
                                    notUsedBiomarkers: currentNotUsed
                                  });
                                }
                                setSearchQuery('');
                                return;
                              }
                            } else {
                              alert(
                                `A matching biomarker "${dupMatch.matchedName}" (Key: ${dupMatch.matchedKey}) already exists in your dictionary (${dupMatch.reason}).\n\nDirecting to existing biomarker entry.`
                              );
                              setSearchQuery(dupMatch.matchedName);
                              return;
                            }
                          }

                          const newKey = searchQuery.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
                          const newCustomBiomarkers = { ...profile.customBiomarkers };
                          newCustomBiomarkers[newKey] = {
                            name: searchQuery.includes('_') 
                              ? searchQuery.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
                              : searchQuery,
                            unit: '',
                            normalRange: '',
                            description: '',
                            standardMedicalGrouping: 'By Medical Practice',
                            riskCategories: [],
                            potentialMedicalConditions: [],
                            needsApproval: true
                          };
                          onUpdateProfile({ customBiomarkers: newCustomBiomarkers });
                          setSearchQuery('');
                        }}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-all shadow-sm shadow-indigo-600/10 cursor-pointer"
                      >
                        Create New Biomarker: "{searchQuery}"
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      {showCombineModal && (
        <CombineBiomarkersModal
          profile={profile}
          isOpen={showCombineModal}
          onClose={() => {
            setShowCombineModal(false);
            setSelectedKeys([]);
          }}
          initialSelectedKeys={selectedKeys}
          biomarkers={biomarkers}
          biomarkerHistory={biomarkerHistory}
          allDefinitions={biomarkerDefinitions}
          onSaveCombine={(targetKey, targetDef, mergedLogs, sourceKeysToDelete) => {
            onCombineBiomarkers(targetKey, targetDef, mergedLogs, sourceKeysToDelete);
            setShowCombineModal(false);
            setSelectedKeys([]);
          }}
        />
      )}
      <FullScreenInstructionViewer
        isOpen={showStandardizeInstructions}
        onClose={() => setShowStandardizeInstructions(false)}
        agentType="standardize"
        profile={profile}
      />
      <FullScreenInstructionViewer
        isOpen={showMedicalInstructions}
        onClose={() => setShowMedicalInstructions(false)}
        agentType="medical_categorise"
        profile={profile}
      />
      <FullScreenInstructionViewer
        isOpen={showCalibrateInstructions}
        onClose={() => setShowCalibrateInstructions(false)}
        agentType="calibrate_ranges"
        profile={profile}
      />
      <FullScreenInstructionViewer
        isOpen={showDataAccuracyInstructions}
        onClose={() => setShowDataAccuracyInstructions(false)}
        agentType="data_accuracy"
        profile={profile}
      />
      <FullScreenInstructionViewer
        isOpen={showConsolidationInstructions}
        onClose={() => setShowConsolidationInstructions(false)}
        agentType="consolidate_names"
        profile={profile}
      />

      {/* CLICKABLE LOG HISTORY VIEWER MODAL OVERLAY */}
      {viewingLogsKey && (() => {
        const key = viewingLogsKey.key;
        const name = viewingLogsKey.name;
        const itemLogs = collectItemLogs(key).sort((a: any, b: any) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));
        
        return (
          <UniversalModal
            isOpen={true}
            onClose={() => setViewingLogsKey(null)}
            title={`${displayBiomarkerName(profile.language, key, name)} (${interpolate(t(profile.language, 'dictKeyLabel'), { key })})`}
            actions={
              <button
                onClick={() => setViewingLogsKey(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-theme-neutral rounded-lg text-xs font-semibold transition-colors"
              >
                {t(profile.language, 'dictCloseLogs')}
              </button>
            }
          >
            <div className="space-y-4">
              {itemLogs.length === 0 ? (
                <div className="text-center py-12 text-slate-400 dark:text-slate-500 text-xs">
                  {t(profile.language, 'dictNoLogs')}
                </div>
              ) : (
                <div className="border border-theme-border/80 rounded-xl overflow-x-auto max-w-full shadow-sm">
                  <table className="w-full min-w-[320px] text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50/55 dark:bg-slate-950/40 text-[10px] font-bold text-slate-500 uppercase border-b border-slate-150 dark:border-slate-800">
                        <th className="py-2.5 px-4">Date</th>
                        <th className="py-2.5 px-4 text-right">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {itemLogs.map((log: any, idx: number) => (
                        <tr key={idx} className="border-b border-theme-border/30 hover:bg-slate-50/50 dark:hover:bg-slate-950/20 font-medium">
                          <td className="py-2.5 px-4 font-mono text-theme-text-secondary">
                            {log.date}
                          </td>
                          <td className="py-2.5 px-4 text-right font-bold text-slate-800 dark:text-slate-200 font-mono">
                            {log.value}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </UniversalModal>
        );
      })()}

      {/* AI AGENT DIAGNOSTIC LOG HISTORY UNIFIED MODAL */}
      {showAgentLogs && (
        <Suspense fallback={null}>
          <FullScreenLogViewer
            isOpen={showAgentLogs}
            onClose={() => setShowAgentLogs(false)}
            title="AI Agent Diagnostic Log History"
            logsText=""
          />
        </Suspense>
      )}

      {/* NOT USED BIOMARKERS MODAL */}
      <NotUsedBiomarkersModal
        isOpen={showNotUsedModal}
        onClose={() => setShowNotUsedModal(false)}
        flaggedKeys={Object.keys(profile?.notUsedBiomarkers || {})}
        getDisplayName={(k) => profile?.customBiomarkers?.[k]?.name || biomarkerDefinitions.find((b: any) => b.key === k || (Array.isArray(b.aliases) && b.aliases.some((a: string) => a.toLowerCase() === k.toLowerCase())))?.name || k}
        onRestore={(k) => {
          if (onRestoreNotUsedGlobal) onRestoreNotUsedGlobal(k);
        }}
      />

      {/* BIOMARKER HEALTH & QUALITY AUDIT MODAL */}
      {showAuditModal && (
        <BiomarkerAuditModal
          isOpen={showAuditModal}
          onClose={() => {
            setShowAuditModal(false);
            setAuditInitialFocusKey(null);
          }}
          initialTab={auditInitialTab}
          initialFocusKey={auditInitialFocusKey}
          profile={profile}
          biomarkers={biomarkers}
          biomarkerHistory={biomarkerHistory}
          onUpdateProfile={onUpdateProfile}
          onDeleteBiomarker={onDeleteBiomarker}
          onCombineBiomarkers={onCombineBiomarkers}
          onBatchCombineBiomarkers={onBatchCombineBiomarkers}
          onLaunchNameConsolidation={(keys) => {
            setSelectedKeys(keys);
            setIsNameConsolidationMode(true);
            setIsAgentMode(false);
            setIsMedicalCategorisationMode(false);
            setIsDataAccuracyMode(false);
            setIsChatMode(false);
            handleRunConsolidationAgent(true, keys);
          }}
          onLaunchUnitStandardization={(keys) => {
            setSelectedKeys(keys);
            setIsRangeCalibrationMode(false);
            setIsMedicalCategorisationMode(false);
            setIsNameConsolidationMode(false);
            setIsDataAccuracyMode(false);
            setIsChatMode(false);
            setIsAgentMode(true);
            setStandardizationYaml(null);
            setStandardizationSummary(null);
            handleRunStandardizationAgent(keys, 'standardize');
          }}
          onLaunchMedicalCategorisation={(keys) => {
            setSelectedKeys(keys);
            setIsMedicalCategorisationMode(true);
            setIsRangeCalibrationMode(false);
            setIsNameConsolidationMode(false);
            setIsDataAccuracyMode(false);
            setIsChatMode(false);
            setIsAgentMode(true);
            setStandardizationYaml(null);
            setStandardizationSummary(null);
            handleRunStandardizationAgent(keys, 'categorise');
          }}
          onLaunchRangeCalibrator={(keys) => {
            setSelectedKeys(keys);
            setIsRangeCalibrationMode(true);
            setIsMedicalCategorisationMode(false);
            setIsNameConsolidationMode(false);
            setIsDataAccuracyMode(false);
            setIsChatMode(false);
            setIsAgentMode(true);
            setStandardizationYaml(null);
            setStandardizationSummary(null);
            handleRunStandardizationAgent(keys, 'calibrate');
          }}
          onSelectBiomarkerKeys={(keys) => {
            setSelectedKeys(keys);
          }}
        />
      )}


    </div>
  );
}
