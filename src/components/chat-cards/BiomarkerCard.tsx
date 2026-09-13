import * as React from 'react';
import { AgentCardProps } from './types';
import { Sparkles, Check, Plus } from 'lucide-react';
import { ErrorBoundary } from '../ErrorBoundary';
import { AgentResultTable } from '../AgentResultTable';
import { GenericAgentResultView } from '../AgentResultViews';
import { biomarkerDefinitions } from '../../utils/biomarkers';
import { AgentType, AGENT_REGISTRY } from '../../utils/agentConfig';
import { translations } from '../../utils/translations';
import { BiomarkerReviewCard } from './BiomarkerReviewCard';

export const BiomarkerCard: React.FC<AgentCardProps> = (props) => {
  const {
    language, msg, messages, idx, profile, biomarkerHistory, globalLiveLogs,
    handleAgent1Step, handleContinueExtractionChunk, setLoggedMessageIds,
    loggedMessageIds, onAgentFinish, handleSend, setActiveInstructionAgentType,
    setActiveInstructionPrompt, onLogMedical, isAnalyzing
  } = props;

  if (msg.agentType === 'biomarker_review') {
    return <BiomarkerReviewCard {...props} />;
  }
  const t = translations[language || "en"] || translations.en;
  const effectiveAgentResult = React.useMemo(() => {
    if (msg.data?.agentResult) return msg.data.agentResult;
    if (msg.agentResult) return msg.agentResult;
    if (msg.modificationCommand && Array.isArray(msg.modificationCommand) && msg.modificationCommand.length > 0) {
      return { modificationCommand: msg.modificationCommand, reply: msg.content };
    }
    return null;
  }, [msg.data?.agentResult, msg.agentResult, msg.modificationCommand, msg.content]);

  const hasValidAgentResult = React.useMemo(() => {
    if (msg.isLive) return false;
    if (!effectiveAgentResult) return false;
    const res = effectiveAgentResult;

    if (msg.agentType === 'agent4') {
      const rawSum = res.summary || res.primaryDiagnosis || res.text;
      const hasSummary = !!(typeof rawSum === 'string' ? rawSum.trim() : (rawSum && typeof rawSum === 'object'));
      const hasGaps = (Array.isArray(res.testingGaps) && res.testingGaps.length > 0) ||
                      (Array.isArray(res.recommendedTests) && res.recommendedTests.length > 0);
      const hasRetests = Array.isArray(res.retestBiomarkers) && res.retestBiomarkers.length > 0;
      return hasSummary || hasGaps || hasRetests;
    }

    const keys = Object.keys(res).filter(k => 
      k !== 'scoutScratchpad' && 
      k !== 'dietScratchpad' && 
      k !== 'dietitianScratchpad' && 
      k !== 'agentPrompt' && 
      k !== 'scoutInstruction' && 
      k !== 'dietInstruction' && 
      k !== 'dietitianInstruction'
    );
    return keys.length > 0;
  }, [msg.isLive, effectiveAgentResult, msg.agentType]);

  return (
    <>
      {/* Render Agent Result Blocks */}
                  {msg.agentType && hasValidAgentResult && (
                    <div className="bg-white dark:bg-slate-800 border border-theme-border rounded-2xl p-4 shadow-md space-y-4 animation-fade-in w-full max-w-full min-w-0 overflow-hidden">
                      <div className="flex items-center justify-between gap-1.5 pb-2 border-b border-theme-border/50">
                        <div className="flex items-center gap-1.5">
                          <Sparkles className="w-4 h-4 text-indigo-600" />
                          <h4 className="font-bold text-theme-text text-xs tracking-wider uppercase font-display">
                            {msg.agentType && AGENT_REGISTRY[msg.agentType as AgentType]?.displayName}
                          </h4>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const resolvedAgentType = msg.agentType;
                            setActiveInstructionAgentType(resolvedAgentType || 'agent1');
                            setActiveInstructionPrompt(msg.data?.agentResult?.agentPrompt || null);
                          }}
                          className="text-[9px] font-mono font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 px-1.5 py-0.5 rounded-md hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-colors"
                        >
                          View Agent Instruction
                        </button>
                      </div>

                      {/* Content details based on Agent type */}
                      {msg.agentType && (AGENT_REGISTRY[msg.agentType as AgentType]?.capabilities?.includes('biomarker_table_view') || msg.agentType === 'agent1' || msg.agentType === 'agent1_step1' || msg.agentType === 'medical' || msg.agentType === 'medical_extract' || msg.agentType === 'biomarker_review' || msg.agentType === 'data_review') && effectiveAgentResult && (
                        <ErrorBoundary>
                        <AgentResultTable
                          agentType={
                            msg.agentType === 'biomarker_review' ? 'biomarker_review' :
                            msg.agentTypeStep === 'agent1_step2' ? 'agent2' :
                            msg.agentTypeStep === 'agent1_step3' ? 'agent3' :
                            (msg.agentType === 'medical' || msg.agentType === 'medical_extract' || msg.agentType === 'agent1_step1' ? 'agent1' : msg.agentType) as any
                          }
                          agentResult={effectiveAgentResult}
                          profile={profile}
                          biomarkerHistory={biomarkerHistory || []}
                          isApplying={!!isAnalyzing}
                          liveStreamLogs={globalLiveLogs}
                          initialRawText={(() => {
                            const precedingUserMsg = messages
                              .slice(0, idx)
                              .reverse()
                              .find(m => m.role === 'user');
                            return precedingUserMsg?.content || '';
                          })()}
                          precedingAgent1Result={(() => {
                            const precedingStep1Msg = messages
                              .slice(0, idx)
                              .reverse()
                              .find(m => m.agentTypeStep === 'agent1_step1' || m.agentType === 'agent1');
                            return precedingStep1Msg?.agentResult;
                          })()}
                          // Step 2/3 (category mapping + assembly) are intentionally skipped for now:
                          // their output shape isn't consumed by the Medical History commit step yet,
                          // so routing through them silently drops data. Step 1 now commits directly
                          // via onApplyChanges below. Revisit this once Step 2/3 persistence is built.
                          onContinueToNextStep={undefined}
                          onApplyChanges={async (arg) => {
                            if (onAgentFinish) {
                              const isContinuation = !!(msg.data?.agentResult?.hasMoreMarkers || msg.data?.agentResult?.hasMore || msg.data?.agentResult?.needsContinuation || msg.data?.agentResult?.status === 'needs_continuation');
                              const acceptedActions = Array.isArray(arg) && arg.length > 0 && typeof arg[0] === 'object' && 'task' in arg[0] ? arg : undefined;
                              if (!acceptedActions && arg && Array.isArray(arg) && msg.data?.agentResult) {
                                if (msg.data && msg.data.agentResult) {
                                  msg.data.agentResult.unselectedRowKeys = arg;
                                  // scopeKeys was already stashed directly onto this same agentResult object
                                  // by AgentResultTable's Apply button, right before this callback fires.
                                }
                              }
                              const forceApplyNow = !!msg.data?.agentResult?.forceApplyNow;
                              if (msg.data?.agentResult) msg.data.agentResult.forceApplyNow = false;
                              // If there are scopeKeys stashed on the agentResult object, it means we are in the middle of paginated batch processing
                              const hasScopeKeys = !!msg.data?.agentResult?.scopeKeys;
                              if (isContinuation && !hasScopeKeys && !forceApplyNow) {
                                await handleContinueExtractionChunk(msg);
                              } else {
                                await onAgentFinish(msg.agentType === 'medical' ? 'agent1' : msg.agentType!, msg.data?.agentResult, acceptedActions);
                                if (!isContinuation || hasScopeKeys) {
                                  setLoggedMessageIds?.(prev => [...prev, msg.id]);
                                }
                              }
                            }
                          }}
                          onSendMessage={handleSend}
                        />
                        </ErrorBoundary>
                      )}

                      {msg.agentType && AGENT_REGISTRY[msg.agentType as AgentType]?.capabilities?.includes('insight_card_view') && msg.data?.agentResult && (
                        <div className="space-y-2">
                          <GenericAgentResultView rawResult={msg.data?.agentResult} />
                        </div>
                      )}

                      {/* Confirm Button */}
                      {msg.data?.agentResult && msg.agentType && !AGENT_REGISTRY[msg.agentType as AgentType]?.capabilities?.includes('biomarker_table_view') && (
                        <button
                          type="button"
                          onClick={async () => {
                            if (onAgentFinish) {
                              await onAgentFinish(msg.agentType!, msg.data?.agentResult);
                                setLoggedMessageIds?.(prev => [...prev, msg.id]);
                            }
                          }}
                          className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/10 flex items-center justify-center gap-1.5 transition-all cursor-pointer mt-3"
                        >
                          <Check className="w-4 h-4" />
                          Apply & Save Agent Findings
                        </button>
                      )}
                    </div>
                  )}

                  {/* Render extracted Pending Medical info */}
                  {msg.agentType === 'medical' && !(loggedMessageIds || []).includes(msg.id) && (((msg.data?.pendingBiomarkerEntries && Array.isArray(msg.data?.pendingBiomarkerEntries) && msg.data?.pendingBiomarkerEntries.length > 0) || (msg.data?.pendingBiomarkers && typeof msg.data?.pendingBiomarkers === 'object' && Object.keys(msg.data?.pendingBiomarkers).length > 0)) || (msg.pendingProfile && typeof msg.pendingProfile === 'object' && Object.keys(msg.pendingProfile).length > 0) || (msg.mode === 'modify' && msg.modificationCommand && Array.isArray(msg.modificationCommand) && msg.modificationCommand.length > 0)) && (
                    <div className="bg-white dark:bg-slate-800 border border-theme-border rounded-2xl p-4 shadow-md space-y-3 animation-fade-in w-full max-w-full min-w-0 overflow-hidden">
                      <div className="border-b border-theme-border/50 pb-2">
                        <h4 className="font-bold text-theme-text text-xs tracking-wider uppercase font-display">
                          {msg.mode === 'modify' ? t.proposedModifications : t.extractedInformation}
                        </h4>
                      </div>

                      <div className="space-y-4">
                        {msg.mode === 'modify' && msg.modificationCommand && Array.isArray(msg.modificationCommand) && msg.modificationCommand.length > 0 ? (
                          <div className="space-y-1">
                            {msg.modificationCommand.map((cmd, idx) => (
                              <div key={idx} className="flex items-center justify-between py-1 border-b border-slate-50 dark:border-slate-800/20 text-xs px-2">
                                <span className="text-theme-text-secondary font-medium">
                                  {cmd.action === 'remove_biomarker' ? t.removeAction : t.updateAction} {cmd.keyName} {cmd.date ? `(${cmd.date})` : ''}
                                </span>
                                <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                                  {cmd.action === 'remove_biomarker' ? t.deletedStatus : (typeof cmd.newValue === 'object' ? JSON.stringify(cmd.newValue) : String(cmd.newValue))}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <>
                            {msg.pendingProfile && Object.entries(msg.pendingProfile).filter(([k, v]) => typeof v !== 'object' && k !== 'customBiomarkers').length > 0 && (
                              <div className="space-y-1">
                                <h5 className="text-[10px] uppercase font-bold text-slate-500 mb-1">{t.profileUpdates}</h5>
                                {Object.entries(msg.pendingProfile)
                                  .filter(([key, val]) => typeof val !== 'object' && key !== 'customBiomarkers')
                                  .map(([key, val]) => (
                                  <div key={key} className="flex items-center justify-between py-1 border-b border-slate-50 dark:border-slate-800/20 text-xs">
                                    <span className="text-theme-text-secondary font-medium capitalize">
                                      {key}
                                    </span>
                                    <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                                      {String(val)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}

                            {msg.mode === 'plan' && msg.planningDetails && (
                              <div className="bg-indigo-50 dark:bg-indigo-900/20 p-3 rounded-xl border border-indigo-100 dark:border-indigo-800/30">
                                <h5 className="text-[10px] uppercase font-bold text-indigo-600 dark:text-indigo-400 mb-2">{t.extractionPlan}</h5>
                                <div className="space-y-1.5 text-xs text-indigo-800 dark:text-indigo-200">
                                  <div className="flex justify-between">
                                    <span>{t.estimatedMetrics}</span>
                                    <span className="font-mono font-bold">{msg.planningDetails.estimatedTotalMetrics || 'Unknown'}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span>{t.batchesRequired}</span>
                                    <span className="font-mono font-bold">{msg.planningDetails.batchesRequired || 'Unknown'}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span>{t.maxPerBatch}</span>
                                    <span className="font-mono font-bold">{msg.planningDetails.maxMetricsPerBatch}</span>
                                  </div>
                                </div>
                              </div>
                            )}

                            {(msg.data?.pendingBiomarkerEntries && Array.isArray(msg.data?.pendingBiomarkerEntries) && msg.data?.pendingBiomarkerEntries.length > 0) ? (
                              <AgentResultTable
                                agentType="medical_extract"
                                agentResult={msg.data?.pendingBiomarkerEntries}
                                profile={profile}
                                biomarkerHistory={biomarkerHistory}
                                onSendMessage={handleSend}
                                onApplyChanges={async (unselectedKeys) => {
                                  if (onLogMedical) {
                                    const isContinuation = !!(msg.status === 'needs_continuation' || msg.data?.agentResult?.status === 'needs_continuation' || msg.data?.agentResult?.hasMore || msg.data?.agentResult?.hasMoreMarkers || msg.data?.agentResult?.needsContinuation);
                                    
                                    // Filter pendingBiomarkers
                                    const filteredBiomarkers = { ...(msg.data?.pendingBiomarkers || {}) };
                                    if (Array.isArray(unselectedKeys)) {
                                      unselectedKeys.forEach(k => delete filteredBiomarkers[k]);
                                    }

                                    // Filter pendingBiomarkerEntries
                                    let filteredEntries = msg.data?.pendingBiomarkerEntries;
                                    if (Array.isArray(filteredEntries) && Array.isArray(unselectedKeys)) {
                                      filteredEntries = filteredEntries.map((entry: any) => {
                                        const newBiomarkers = { ...(entry.biomarkers || {}) };
                                        unselectedKeys.forEach(k => delete newBiomarkers[k]);
                                        const newTests = (entry.tests || []).filter((t: any) => !unselectedKeys.includes(t.key));
                                        newTests.forEach((t: any) => {
                                          newBiomarkers[t.key] = t.valueNumeric !== null && t.valueNumeric !== undefined ? t.valueNumeric : t.valueString;
                                        });
                                        return { ...entry, biomarkers: newBiomarkers, tests: newTests };
                                      }).filter((entry: any) => Object.keys(entry.biomarkers).length > 0);
                                    }
                                    
                                    onLogMedical(filteredBiomarkers, msg.pendingProfile || {}, msg.pendingDate, filteredEntries, msg.modificationCommand, isContinuation);
                                    setLoggedMessageIds?.(prev => [...prev, msg.id]);
                                    if (isContinuation) {
                                      if (handleContinueExtractionChunk) {
                                        await handleContinueExtractionChunk(msg);
                                      } else {
                                        handleSend("Proceed with extraction.");
                                      }
                                    }
                                  }
                                }}
                                onCancel={() => {
                                  setLoggedMessageIds?.(prev => [...prev, msg.id]);
                                  const isContinuation = !!(msg.status === 'needs_continuation' || msg.data?.agentResult?.status === 'needs_continuation' || msg.data?.agentResult?.hasMore || msg.data?.agentResult?.hasMoreMarkers || msg.data?.agentResult?.needsContinuation);
                                  if (isContinuation) {
                                    handleSend("Cancel extraction.");
                                  }
                                }}
                              />
                            ) : (
                              (msg.data?.pendingBiomarkers && typeof msg.data?.pendingBiomarkers === 'object' && Object.keys(msg.data?.pendingBiomarkers).length > 0 ? [{ date: msg.pendingDate || null, biomarkers: msg.data?.pendingBiomarkers }] : []).map((entry, idx) => (
                                <div key={idx} className="space-y-1">
                                  <div className="flex items-center justify-between py-1 bg-slate-50 dark:bg-slate-800/50 px-2 rounded-md mb-2">
                                    <span className="text-theme-text-secondary font-bold text-[10px] uppercase">{t.recordDate}</span>
                                    <span className="font-mono font-bold text-theme-neutral text-xs">{entry.date || t.unknownDate}</span>
                                  </div>
                                  {entry.biomarkers && typeof entry.biomarkers === 'object' && Object.entries(entry.biomarkers).map(([key, val]) => {
                                    const def = biomarkerDefinitions.find(d => d.key === key);
                                    const customDef = msg.pendingProfile?.customBiomarkers?.[key] || profile?.customBiomarkers?.[key];
                                    const name = def?.name || customDef?.name || key;
                                    const unit = def?.unit || customDef?.unit || '';
                                    return (
                                      <div key={key} className="flex items-center justify-between py-1 border-b border-slate-50 dark:border-slate-800/20 text-xs px-2">
                                        <span className="text-theme-text-secondary font-medium">
                                          {name}
                                        </span>
                                        <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                                          {String(val)} {String(val).includes(unit) ? "" : unit}
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              ))
                            )}
                          </>
                        )}
                      </div>

                      {msg.mode !== 'plan' && msg.mode !== 'discussion' && !(msg.data?.pendingBiomarkerEntries && Array.isArray(msg.data?.pendingBiomarkerEntries) && msg.data?.pendingBiomarkerEntries.length > 0) && (
                        <div className="pt-2 space-y-2">
                          <button
                            onClick={async () => {
                              if (onLogMedical) {
                                const isContinuation = !!(msg.status === 'needs_continuation' || msg.data?.agentResult?.status === 'needs_continuation' || msg.data?.agentResult?.hasMore || msg.data?.agentResult?.hasMoreMarkers || msg.data?.agentResult?.needsContinuation);
                                onLogMedical(msg.data?.pendingBiomarkers || {}, msg.pendingProfile || {}, msg.pendingDate, msg.data?.pendingBiomarkerEntries, msg.modificationCommand, isContinuation);
                                setLoggedMessageIds?.(prev => [...prev, msg.id]);
                                if (isContinuation) {
                                  if (handleContinueExtractionChunk) {
                                    await handleContinueExtractionChunk(msg);
                                  } else {
                                    handleSend("Proceed with extraction.");
                                  }
                                }
                              }
                            }}
                            className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/10 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                          >
                            <Plus className="w-4 h-4" />
                            {msg.mode === 'modify' ? t.applyModifications : (!!(msg.status === 'needs_continuation' || msg.data?.agentResult?.status === 'needs_continuation' || msg.data?.agentResult?.hasMore || msg.data?.agentResult?.hasMoreMarkers || msg.data?.agentResult?.needsContinuation)) ? t.saveAndContinueBatch : t.saveExtractedData}
                          </button>
                          
                          <button
                            onClick={() => {
                              setLoggedMessageIds?.(prev => [...prev, msg.id]);
                              const isContinuation = !!(msg.status === 'needs_continuation' || msg.data?.agentResult?.status === 'needs_continuation' || msg.data?.agentResult?.hasMore || msg.data?.agentResult?.hasMoreMarkers || msg.data?.agentResult?.needsContinuation);
                              if (isContinuation) {
                                handleSend("Cancel extraction.");
                              }
                            }}
                            className="w-full py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800/50 dark:hover:bg-slate-800 text-theme-text-secondary rounded-xl text-xs font-bold transition-all cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  )}

    </>
  );
};
