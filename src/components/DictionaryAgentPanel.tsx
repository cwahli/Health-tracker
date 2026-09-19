import React, { Dispatch, SetStateAction } from 'react';
import { biomarkerDefinitions } from '../utils/biomarkers';
import LLMSelector from './LLMSelector';
import { CheckSquare, CheckCircle, Loader, ArrowRight, FileCode, Copy } from 'lucide-react';
import { t } from '../utils/i18n';
import { UserProfile } from '../types';

export interface DictionaryAgentPanelProps {
  profile: UserProfile;
  isMedicalCategorisationMode: boolean;
  isRangeCalibrationMode: boolean;
  selectedLogFixKeys: { [logKey: string]: boolean; };
  setSelectedLogFixKeys: Dispatch<SetStateAction<{ [logKey: string]: boolean; }>>;
  standardizeModel: string;
  medicalCategoriseModel: string;
  calibrateRangesModel: string;
  setStandardizeModel: (id: string) => void;
  setMedicalCategoriseModel: (id: string) => void;
  setCalibrateRangesModel: (id: string) => void;
  setShowStandardizeInstructions: Dispatch<SetStateAction<boolean>>;
  setShowMedicalInstructions: Dispatch<SetStateAction<boolean>>;
  setShowCalibrateInstructions: Dispatch<SetStateAction<boolean>>;
  setTargetMetric: Dispatch<SetStateAction<"si" | "us">>;
  targetMetric: "si" | "us";
  agentLoading: boolean;
  standardizationYaml: string;
  setStandardizationYaml: Dispatch<SetStateAction<string>>;
  standardizationSummary: any[];
  setStandardizationSummary: Dispatch<SetStateAction<any[]>>;
  selectedKeys: string[];
  handleToggleSelect: (key: string) => void;
  handleRunStandardizationAgent: (keysOverride?: string[], modeOverride?: "categorise" | "standardize" | "calibrate") => Promise<void>;
  handleApplyStandardization: () => Promise<void>;
}

/**
 * Q-13 (move-only): moved verbatim out of BiomarkerDictionaryModal.tsx.
 * The JSX below is byte-identical to the region it replaces; only this component
 * boundary and the prop plumbing are new.
 */
export default function DictionaryAgentPanel({
  profile,
  isMedicalCategorisationMode,
  isRangeCalibrationMode,
  selectedLogFixKeys,
  setSelectedLogFixKeys,
  standardizeModel,
  medicalCategoriseModel,
  calibrateRangesModel,
  setStandardizeModel,
  setMedicalCategoriseModel,
  setCalibrateRangesModel,
  setShowStandardizeInstructions,
  setShowMedicalInstructions,
  setShowCalibrateInstructions,
  setTargetMetric,
  targetMetric,
  agentLoading,
  standardizationYaml,
  setStandardizationYaml,
  standardizationSummary,
  setStandardizationSummary,
  selectedKeys,
  handleToggleSelect,
  handleRunStandardizationAgent,
  handleApplyStandardization,
}: DictionaryAgentPanelProps) {
  return (
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
  );
}
