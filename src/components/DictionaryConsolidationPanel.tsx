import React, { Dispatch, SetStateAction } from 'react';
import LLMSelector from './LLMSelector';
import { BrainCircuit, Send, CheckSquare, Save, Check, Edit2, FileCode } from 'lucide-react';
import { biomarkerDefinitions } from '../utils/biomarkers';
import { UserProfile, BiomarkerLog } from '../types';

export interface DictionaryConsolidationPanelProps {
  profile: UserProfile;
  biomarkerHistory: BiomarkerLog[];
  nameConsolidationModel: string;
  setNameConsolidationModel: (id: string) => void;
  setShowConsolidationInstructions: Dispatch<SetStateAction<boolean>>;
  consolidationYaml: string;
  consolidationGroups: any[];
  consolidationLoading: boolean;
  consolidationLiveThought: string;
  consolidationInput: string;
  setConsolidationInput: Dispatch<SetStateAction<string>>;
  consolidationMessages: any[];
  setConsolidationMessages: Dispatch<SetStateAction<any[]>>;
  groupEdits: any;
  setGroupEdits: Dispatch<any>;
  setShowOnlyReduced: Dispatch<SetStateAction<boolean>>;
  showOnlyReduced: boolean;
  reducedGroupsCount: number;
  totalOriginalBiomarkersInConsolidation: any;
  totalMasterBiomarkersInConsolidation: number;
  totalBiomarkersReduced: number;
  selectedKeys: string[];
  editingGroupIdx: number;
  setEditingGroupIdx: Dispatch<SetStateAction<number>>;
  setViewingLogsKey: Dispatch<SetStateAction<{ key: string; name: string; }>>;
  handleRunConsolidationAgent: (isManualClick?: boolean, keysOverride?: string[]) => Promise<void>;
  handleApplyConsolidation: () => Promise<void>;
}

/**
 * Q-13 (move-only): moved verbatim out of BiomarkerDictionaryModal.tsx.
 * The JSX below is byte-identical to the region it replaces; only this component
 * boundary and the prop plumbing are new.
 */
export default function DictionaryConsolidationPanel({
  profile,
  biomarkerHistory,
  nameConsolidationModel,
  setNameConsolidationModel,
  setShowConsolidationInstructions,
  consolidationYaml,
  consolidationGroups,
  consolidationLoading,
  consolidationLiveThought,
  consolidationInput,
  setConsolidationInput,
  consolidationMessages,
  setConsolidationMessages,
  groupEdits,
  setGroupEdits,
  setShowOnlyReduced,
  showOnlyReduced,
  reducedGroupsCount,
  totalOriginalBiomarkersInConsolidation,
  totalMasterBiomarkersInConsolidation,
  totalBiomarkersReduced,
  selectedKeys,
  editingGroupIdx,
  setEditingGroupIdx,
  setViewingLogsKey,
  handleRunConsolidationAgent,
  handleApplyConsolidation,
}: DictionaryConsolidationPanelProps) {
  return (
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
  );
}
