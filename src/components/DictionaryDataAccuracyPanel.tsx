import React, { Dispatch, SetStateAction, RefObject, ChangeEvent } from 'react';
import LLMSelector from './LLMSelector';
import { Loader, Paperclip, Send, CheckSquare, Trash, Save } from 'lucide-react';
import { UserProfile } from '../types';

export interface DictionaryDataAccuracyPanelProps {
  profile: UserProfile;
  showResetChatConfirm: boolean;
  setShowResetChatConfirm: Dispatch<SetStateAction<boolean>>;
  showDiscardResultsConfirm: boolean;
  setShowDiscardResultsConfirm: Dispatch<SetStateAction<boolean>>;
  dataAccuracyMessages: any[];
  setDataAccuracyMessages: Dispatch<SetStateAction<any[]>>;
  setDataAccuracyInput: Dispatch<SetStateAction<string>>;
  dataAccuracyInput: string;
  dataAccuracyLoading: boolean;
  setAccuracyUploadedFiles: Dispatch<SetStateAction<{ name: string; type: string; base64?: string; text?: string; }[]>>;
  accuracyUploadedFiles: { name: string; type: string; base64?: string; text?: string; }[];
  accuracyComparisonResults: any[];
  setAccuracyComparisonResults: Dispatch<SetStateAction<any[]>>;
  setAccuracySelectedFields: Dispatch<SetStateAction<{ [biomarkerKey: string]: { name: "current" | "shared"; unit: "current" | "shared"; value: "current" | "shared"; date: "current" | "shared"; comments: "current" | "shared"; selected: boolean; }; }>>;
  accuracySelectedFields: { [biomarkerKey: string]: { name: "current" | "shared"; unit: "current" | "shared"; value: "current" | "shared"; date: "current" | "shared"; comments: "current" | "shared"; selected: boolean; }; };
  fileInputRef2: RefObject<HTMLInputElement>;
  dataAccuracyModel: string;
  setDataAccuracyModel: (id: string) => void;
  setShowDataAccuracyInstructions: Dispatch<SetStateAction<boolean>>;
  selectedKeys: string[];
  handleAccuracyFileSelect: (e: ChangeEvent<HTMLInputElement, Element>) => void;
  removeAccuracyFile: (idx: number) => void;
  handleSendDataAccuracy: () => Promise<void>;
  applySelectedAccuracyUpdates: () => Promise<void>;
  accuracyChatEndRef: RefObject<HTMLDivElement>;
}

/**
 * Q-13 (move-only): moved verbatim out of BiomarkerDictionaryModal.tsx.
 * The JSX below is byte-identical to the region it replaces; only this component
 * boundary and the prop plumbing are new.
 */
export default function DictionaryDataAccuracyPanel({
  profile,
  showResetChatConfirm,
  setShowResetChatConfirm,
  showDiscardResultsConfirm,
  setShowDiscardResultsConfirm,
  dataAccuracyMessages,
  setDataAccuracyMessages,
  setDataAccuracyInput,
  dataAccuracyInput,
  dataAccuracyLoading,
  setAccuracyUploadedFiles,
  accuracyUploadedFiles,
  accuracyComparisonResults,
  setAccuracyComparisonResults,
  setAccuracySelectedFields,
  accuracySelectedFields,
  fileInputRef2,
  dataAccuracyModel,
  setDataAccuracyModel,
  setShowDataAccuracyInstructions,
  selectedKeys,
  handleAccuracyFileSelect,
  removeAccuracyFile,
  handleSendDataAccuracy,
  applySelectedAccuracyUpdates,
  accuracyChatEndRef,
}: DictionaryDataAccuracyPanelProps) {
  return (
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
  );
}
