import React from 'react';
import { ErrorBoundary } from './ErrorBoundary';
import { lazyWithRetry } from '../utils/lazyWithRetry';
import { JobStore } from '../jobs/JobStore';
import { saveLocalSnapshot, loadLocalSnapshots, deleteLocalSnapshot } from '../utils/storageUtils';
import { applyModificationCommands, overlayFingerprint, resolveAgentDestination, shouldRunCalibrator, attachObservationMeta, enrichReviewModificationCommands, collectCatalogUnitMap, cleanupInventedBiomarkerCatalog, routeExtractedObservations, approvePendingObservation } from '../utils/biomarkerLifecycle';
import { extractFallbackModifications } from './chat-cards/BiomarkerReviewCard';
import { toYYYYMMDD } from '../utils/dateUtils';
import { getMappedBiomarkerKey, biomarkerDefinitions, selfHealCustomBiomarkerDefinitions } from '../utils/biomarkers';
import { pushPendingObservation, maybeRecalibrateDemographicOverlays } from '../utils/appProfileUtils';
import { formatOptimalTargetValue } from '../utils/agentCalibration';
import { isCoreNutrient, isAdditionalNutrient } from '../utils/nutrients';
import { translations } from '../utils/translations';
import type { HealthAction } from '../types';
import type { AppViewProps } from './AppShell';

const LogChat = lazyWithRetry(() => import('./LogChat'));

export default function AppModals(p: AppViewProps) {
  const {
    actions,
    activeAgentType,
    activeDataReviewBatchIdx,
    activeDataReviewBatchKeys,
    activeDataReviewCurrentBatch,
    activeDataReviewEstimatedTotalMarkers,
    activeDataReviewExtractedYaml,
    activeFrontDeskJobId,
    activeHandoffPayload,
    activeJobId,
    activeReviewBiomarkerKey,
    activeTab,
    already,
    apply,
    autoSyncDisabled,
    batchSize,
    biomarkerHistory,
    biomarkers,
    bundle,
    calibratingAgentType,
    calibratingBatchIdx,
    changed,
    checkForDbChanges,
    cleaned,
    conflictData,
    current,
    dailyBenefits,
    dataReviewSharedState,
    dbInteractions,
    deletedCustomBiomarkerKeys,
    dismissedBmiAlerts,
    draftReport,
    exceeded,
    existing,
    existingLogIndex,
    existingPending,
    fallback,
    finalValue,
    fingerprint,
    foodIdeas,
    foodLogs,
    gender,
    handleAcceptReport,
    handleAgentAnalysisSaved,
    handleApplyCalculation,
    handleBatchCombineBiomarkers,
    handleBatchConsolidate,
    handleBatchDeleteBiomarkersFromLogs,
    handleBatchEditBiomarkersInLogs,
    handleCombineBiomarkers,
    handleDeleteAnalysis,
    handleDeleteBiomarker,
    handleDeleteBiomarkerFromLog,
    handleDeleteBiomarkerLog,
    handleDeleteEmptyBiomarkers,
    handleDeleteFoodLog,
    handleDeleteMultipleBiomarkers,
    handleDismissBmiAlert,
    handleEditBiomarkerLog,
    handleFetchMoreFoods,
    handleFlagNotUsedGlobal,
    handleFlagNotUsedLocal,
    handleGenerateReport,
    handleLogFood,
    handleLogMedical,
    handleLogin,
    handleOpenJob,
    handleRejectReport,
    handleResolveConflict,
    handleRestoreNotUsedGlobal,
    handleRestoreNotUsedLocal,
    handleRestoreSnapshot,
    handleSignOut,
    handleStandardizeBiomarkerUnits,
    handleToggleAutoSyncDisabled,
    handleUpdateFoodLog,
    hasChanges,
    healthSubTab,
    hideSensitive,
    idx,
    initiallyExpandedFoodId,
    isAuthChecking,
    isBuiltIn,
    isConflictModalOpen,
    isFirestoreQuotaExceeded,
    isFloatingOpen,
    isFoodChatOpen,
    isFrontDeskOpen,
    isGenerating,
    isInitialDataLoading,
    isManualFoodLogOpen,
    isMedicalChatOpen,
    item,
    key,
    log,
    logBmiIfProfileWeightHeightChanged,
    manualFoodLogError,
    mapped,
    mappedKey,
    newBiomarkers,
    newLog,
    nextProfile,
    now,
    op,
    parsed,
    prefillMessage,
    profile,
    quota,
    recomputedBiomarkers,
    report,
    response,
    saveAndSync,
    saved,
    selectedModelId,
    setActions,
    setActiveAgentType,
    setActiveDataReviewBatchIdx,
    setActiveDataReviewBatchKeys,
    setActiveDataReviewCurrentBatch,
    setActiveDataReviewEstimatedTotalMarkers,
    setActiveDataReviewExtractedYaml,
    setActiveFrontDeskJobId,
    setActiveHandoffPayload,
    setActiveJobId,
    setActiveReviewBiomarkerKey,
    setActiveTab,
    setBatchSize,
    setBiomarkerHistory,
    setBiomarkers,
    setCalibratingAgentType,
    setCalibratingBatchIdx,
    setDailyBenefits,
    setDataReviewSharedState,
    setFoodIdeas,
    setFoodLogs,
    setHealthSubTab,
    setHideSensitive,
    setInitiallyExpandedFoodId,
    setIsConflictModalOpen,
    setIsEditingFoodLog,
    setIsFloatingOpen,
    setIsFrontDeskOpen,
    setIsManualFoodLogOpen,
    setIsMedicalChatOpen,
    setLastSnapshotLabel,
    setManualFoodLogError,
    setPrefillMessage,
    setProfile,
    setReport,
    setSelectedModelId,
    setShowSnapshotPanel,
    setSnapshots,
    setSyncFailedWarning,
    showSnapshotPanel,
    snapshots,
    syncFailedWarning,
    syncState,
    target,
    totalFoodsCount,
    unitMatch,
    updatedBiomarkers,
    updatedHistory,
    updatedProfile,
    updatedReport,
    val,
    values
  } = p;
  return (
    <>
      {/* Slide-over interactive dialogs */}
      
      {(() => {
        const handleOpenAgentFromFrontDesk = (
          agentType: 'agent1' | 'agent2' | 'agent3' | 'agent4' | 'agent5' | 'agent7' | 'data_review' | 'health_baseline' | 'medical' | 'food' | 'food_idea' | null,
          options?: { prefillMessage?: string; autoSendMessage?: string; handoffPayload?: any; updatedProfile?: any; sourceJobId?: string }
        ) => {
          console.log(`[DIAG7] handleOpenAgentFromFrontDesk called: agentType=${agentType}, hasHandoffPayload=${!!options?.handoffPayload}, hasAutoSendMessage=${!!options?.autoSendMessage}`);
          if (options?.updatedProfile) {
            const nextProf = { ...profile, ...options.updatedProfile };
            setProfile(nextProf);
            saveAndSync(nextProf, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'profile' });
          }

          // Health Coach / medical passed from Front Desk stay in that thread.
          if (agentType === 'health_baseline' || (agentType as string) === 'health_coach' || agentType === 'medical') {
            return;
          }

          if (agentType === 'food' || (agentType as string) === 'food_log') {
            setIsFrontDeskOpen(false);
            const foodJobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const handoffKeys = options?.handoffPayload && typeof options.handoffPayload === 'object'
              ? Object.keys(options.handoffPayload)
              : [];
            JobStore.createJob({
              id: foodJobId,
              kind: 'food_log',
              lockedModeFamily: 'A',
              status: 'draft',
              parentJobId: options?.sourceJobId || null,
              handoffSummary: options?.sourceJobId ? {
                fromJobId: options.sourceJobId,
                targetAgent: 'food',
                intent: options?.handoffPayload?.intent,
                keysForwarded: handoffKeys,
              } : null,
              inputSnapshot: { text: options?.autoSendMessage || options?.prefillMessage || '', imageRefs: [], parentJobId: options?.sourceJobId || null }
            });
            setActiveJobId(foodJobId);
            return;
          }

          setIsFrontDeskOpen(false);
          const target = resolveAgentDestination(agentType) as any;
          setActiveAgentType(target);
          const msgToSend = options?.autoSendMessage || options?.prefillMessage || null;
          setPrefillMessage(msgToSend);
          console.log(`[DIAG7] handleOpenAgentFromFrontDesk: setting activeHandoffPayload to ${options?.handoffPayload ? 'REAL PAYLOAD' : 'null'}`);
          setActiveHandoffPayload(options?.handoffPayload || null);
          setActiveDataReviewBatchIdx(null);
          setActiveDataReviewBatchKeys([]);
          setActiveDataReviewExtractedYaml([]);
          setActiveDataReviewCurrentBatch(1);
          setActiveDataReviewEstimatedTotalMarkers(null);
          setIsMedicalChatOpen(true);
        };

        const handleAgentFinish = async (agentType: string, agentResult: any, extraActions?: HealthAction[]) => {
          // ─── SNAPSHOT BEFORE ANY CHANGE (FIX-8) ──────────────────────────
          const snapLabel = `Before ${agentType} approval (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })})`;
          await saveLocalSnapshot(snapLabel, profile?.email, {
            profile,
            foodLogs,
            biomarkers,
            biomarkerHistory,
            actions,
            dailyBenefits,
            report
          });
          if (profile?.email) {
            setSnapshots(await loadLocalSnapshots(profile.email));
          }
          setLastSnapshotLabel(snapLabel);
          // ───────────────────────────────────────────────────────────────
          const isPartialApply = !!(agentResult?.forceApplyNow) && !!(agentResult?.hasMoreMarkers || agentResult?.hasMore || agentResult?.needsContinuation || agentResult?.status === 'needs_continuation');
          if (!isPartialApply) {
            setIsMedicalChatOpen(false);
            if (agentType !== 'health_baseline' && (agentType as string) !== 'health_coach') {
              setIsFrontDeskOpen(false);
            }
          }
          setCalibratingAgentType(agentType);
          const updatedProfile = { ...profile };
          
          let currentHistory = [...biomarkerHistory];
          let currentReport = report ? { ...report } : null;
          let currentDailyBenefits = [...dailyBenefits];
          let currentActions = [...actions];

          // Review: apply modificationCommand (dated) and/or flat corrections
          if ((agentType as string) === 'biomarker_review') {
            let candidate = agentResult;
            if (typeof candidate === 'string') {
              try {
                candidate = JSON.parse(candidate.replace(/```(?:json)?/gi, '').trim());
              } catch (e) {}
            }

            const rawCmds = Array.isArray(candidate?.modificationCommand)
              ? candidate.modificationCommand
              : (Array.isArray(candidate?.result?.modificationCommand)
                ? candidate.result.modificationCommand
                : (Array.isArray(candidate?.agentResult?.modificationCommand)
                  ? candidate.agentResult.modificationCommand
                  : (Array.isArray((candidate as any)?.clean_result?.modificationCommand)
                    ? (candidate as any).clean_result.modificationCommand
                    : (Array.isArray((candidate as any)?.data?.modificationCommand)
                      ? (candidate as any).data.modificationCommand
                      : (Array.isArray((candidate as any)?.data?.agentResult?.modificationCommand)
                        ? (candidate as any).data.agentResult.modificationCommand
                        : [])))));

            const unitMap = collectCatalogUnitMap(updatedProfile);
            let commands = enrichReviewModificationCommands(
              rawCmds,
              currentHistory || [],
              unitMap
            );

            if (commands.length === 0 && (candidate?.reply || candidate?.text || candidate?.initialRawText || (typeof candidate === 'string' ? candidate : ''))) {
              commands = extractFallbackModifications(candidate?.reply || candidate?.text || candidate?.initialRawText || (typeof candidate === 'string' ? candidate : '') || '', currentHistory || [], updatedProfile);
              if (commands.length > 0) {
                commands = enrichReviewModificationCommands(commands, currentHistory || [], unitMap);
              }
            }

            const unselected = Array.isArray(candidate?.unselectedRowKeys) ? candidate.unselectedRowKeys : [];
            if (unselected.length > 0) {
              commands = commands.filter((cmd: any) => !unselected.includes(cmd.keyName || cmd.key || cmd.biomarker));
            }

            const { history: afterCommands, applied } = applyModificationCommands(currentHistory, commands, unitMap);
            currentHistory = afterCommands;

            const corrections: Record<string, any> = agentResult?.corrections || agentResult?.biomarkerCorrections || {};
            if (Object.keys(corrections).length > 0) {
              const correctionDate = agentResult?.date || new Date().toISOString().split('T')[0];
              const existingIdx = currentHistory.findIndex((h: any) => toYYYYMMDD(h.date) === toYYYYMMDD(correctionDate));
              if (existingIdx >= 0) {
                currentHistory[existingIdx] = {
                  ...currentHistory[existingIdx],
                  biomarkers: { ...currentHistory[existingIdx].biomarkers, ...corrections }
                };
              } else {
                currentHistory.push({
                  id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                  date: correctionDate,
                  biomarkers: corrections,
                  note: "Corrected by Review"
                });
              }
            }

            const proposal = agentResult?.proposal;
            if (proposal && (proposal.range || proposal.metric || proposal.rangeBrackets)) {
              const rawKey = agentResult.biomarkerKey || proposal.key || proposal.name || commands[0]?.keyName || '';
              const overlayKey = getMappedBiomarkerKey(String(rawKey)) || String(rawKey).toLowerCase().replace(/[^a-z0-9]/g, '_');
              if (overlayKey) {
                if (!updatedProfile.customBiomarkers) updatedProfile.customBiomarkers = {};
                const prev = (updatedProfile.customBiomarkers[overlayKey] || {}) as any;
                updatedProfile.customBiomarkers[overlayKey] = {
                  ...prev,
                  name: proposal.name || prev.name || overlayKey,
                  unit: proposal.metric || prev.unit,
                  profileAdjustedNormalRange: proposal.range || prev.profileAdjustedNormalRange,
                  description: proposal.description || prev.description || '',
                  rangeBrackets: proposal.rangeBrackets || prev.rangeBrackets,
                  structuredRanges: proposal.rangeBrackets ? [{
                    targetGender: 'Any',
                    targetEthnicity: 'Any',
                    range: {
                      type: 'bracket',
                      brackets: proposal.rangeBrackets.map((b: any) => ({
                        min: b.min !== undefined ? b.min : null,
                        max: b.max !== undefined ? b.max : null,
                        alias: b.label,
                        severity: b.severity
                      }))
                    }
                  }] : prev.structuredRanges,
                  overlayFingerprint: overlayFingerprint(updatedProfile),
                };
              }
            }

            if (applied > 0 || Object.keys(corrections).length > 0 || commands.length > 0) {
              const recomputed: { [key: string]: number | string } = {};
              [...currentHistory]
                .filter((b: any) => b.sync_state !== 'delete')
                .sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date)))
                .forEach((log) => {
                  Object.entries(log.biomarkers || {}).forEach(([k, v]) => {
                    recomputed[k] = v as string | number;
                  });
                });
              setBiomarkers(recomputed);
              setBiomarkerHistory(currentHistory);
              await saveAndSync(updatedProfile, foodLogs, recomputed, currentHistory, actions, dailyBenefits, report, {
                type: 'biomarkerLogsBatch',
                targetIds: currentHistory.map((h: any) => h.id)
              });
            }

            if (activeJobId) {
              await JobStore.deleteJob(activeJobId);
              setActiveJobId(null);
            }
            setIsMedicalChatOpen(false);
            setIsFrontDeskOpen(false);
            setActiveAgentType(null);
            setCalibratingAgentType(null);
            return;
          }
          
          if ((agentType as string) === 'medical_analyze') {
            const filledRows = agentResult?.filledRows || [];
            
            const updatedCustoms = { ...(updatedProfile.customBiomarkers || {}) };
            const existingPending = Array.isArray(updatedProfile.pendingObservations) ? [...updatedProfile.pendingObservations] : [];
            const newLogsToInsert: any[] = [];
            
            const recomputed: { [key: string]: number | string } = {};
            
            filledRows.forEach((row: any) => {
                if (row.newCatalogDraft && row.writeTarget === 'pending') {
                    const key = row.newCatalogDraft.suggestedKey || `custom_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
                    
                    if (row.logs && row.logs.length > 0) {
                        row.logs.forEach((log: any) => {
                            existingPending.push({
                                id: `pending_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                                printedName: row.printed || row.newCatalogDraft.name || 'Unknown',
                                suggestedKey: key,
                                date: log.date || new Date().toISOString().split('T')[0],
                                rawValue: log.value,
                                rawUnit: row.newCatalogDraft.unit || row.unit || '',
                                printedRange: row.newCatalogDraft.normalRange || row.printedRange || '',
                                createdAt: Date.now()
                            });
                        });
                    }
                } else if (row.writeTarget === 'observation' && row.key) {
                    const mappedKey = row.key;
                    if (row.logs && row.logs.length > 0) {
                        row.logs.forEach((log: any) => {
                            const dateStr = log.date || new Date().toISOString().split('T')[0];
                            const existingIdx = currentHistory.findIndex((h: any) => toYYYYMMDD(h.date) === toYYYYMMDD(dateStr));
                            if (existingIdx >= 0) {
                                currentHistory[existingIdx] = {
                                    ...currentHistory[existingIdx],
                                    biomarkers: { ...currentHistory[existingIdx].biomarkers, [mappedKey]: log.value }
                                };
                                attachObservationMeta(currentHistory[existingIdx], mappedKey, {
                                    unit: row.unit,
                                    printedRange: row.printedRange,
                                    rawValue: log.value
                                });
                            } else {
                                const newLog: any = {
                                    id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                                    date: dateStr,
                                    biomarkers: { [mappedKey]: log.value },
                                    note: log.comment || `Extracted observation for ${mappedKey}`
                                };
                                attachObservationMeta(newLog, mappedKey, {
                                    unit: row.unit,
                                    printedRange: row.printedRange,
                                    rawValue: log.value
                                });
                                currentHistory.push(newLog);
                            }
                        });
                    }
                }
            });
            
            if (newLogsToInsert.length > 0) {
                currentHistory.push(...newLogsToInsert);
            }
            
            currentHistory.sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));
            
            currentHistory.filter(b => b.sync_state !== 'delete').forEach(log => {
                Object.entries(log.biomarkers || {}).forEach(([k, v]) => {
                    recomputed[k] = v as string | number;
                });
            });
            
            updatedProfile.customBiomarkers = updatedCustoms;
            if (existingPending.length > 0) {
              updatedProfile.pendingObservations = existingPending;
            }
            setBiomarkers(recomputed);
            setBiomarkerHistory(currentHistory);
            
            await saveAndSync(updatedProfile, foodLogs, recomputed, currentHistory, actions, dailyBenefits, report, {
                type: 'biomarkerLogsBatch',
                targetIds: currentHistory.map((h: any) => h.id)
            });
            
            setIsMedicalChatOpen(false);
            setIsFrontDeskOpen(false);
            setActiveAgentType(null);
            setCalibratingAgentType(null);
            return;
          }

          if (agentType === 'agent1' || agentType === 'medical_extract') {
            const batchIdx = agentResult.batchIdx;
            if (batchIdx !== undefined && batchIdx !== null) {
              const savedResults = localStorage.getItem('agent1_batch_results');
              let results: any = {};
              try {
                if (savedResults) results = JSON.parse(savedResults);
              } catch (e) {}
              const minimalResult = { ...agentResult };
              delete minimalResult.agentPrompt;
              results[batchIdx] = minimalResult;
              try { localStorage.setItem('agent1_batch_results', JSON.stringify(results)); } catch(e){ console.warn("Quota exceeded agent1"); }

              const jsonText = agentResult.extractedData || agentResult;
              let parsedRows: any[] = [];
              if (typeof jsonText === 'string' && jsonText.trim() !== '') {
                try {
                  const cleanText = jsonText.replace(/```(?:yaml|json)?/gi, '').trim();
                  const parsed = JSON.parse(cleanText);
                  parsedRows = Array.isArray(parsed) ? parsed : (parsed?.biomarkers || []);
                } catch (e) {
                  console.error("Failed to parse approved agent1 YAML", e);
                }
              } else if (Array.isArray(jsonText)) {
                parsedRows = jsonText;
              }
              const unselected = agentResult.unselectedRowKeys || [];
              if (unselected.length > 0) {
                 parsedRows = parsedRows.filter(row => {
                   const key = String(row.biomarker || row.name || row.key || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
                   return !unselected.includes(key);
                 });
              }

              const updatedCustoms = { ...(updatedProfile.customBiomarkers || {}) };
              let hHistory = biomarkerHistory ? biomarkerHistory.map((h: any) => ({
                ...h,
                biomarkers: { ...h.biomarkers }
              })) : [];

              const deletedKeysToSync: string[] = [];
              if (agentResult?.batchBiomarkers && Array.isArray(agentResult.batchBiomarkers)) {
                agentResult.batchBiomarkers.forEach((raw: any) => {
                  const rawKey = raw.key;
                  if (!rawKey) return;

                  let bestParsedIdx = -1;
                  let bestScore = -1;
                  parsedRows.forEach((parsed: any, idx: number) => {
                    if (parsed.originalName) {
                      const cleanRawName = raw.name.toLowerCase().replace(/[^a-z0-9]/g, '');
                      const cleanParsedOrigName = parsed.originalName.toLowerCase().replace(/[^a-z0-9]/g, '');
                      if (cleanRawName === cleanParsedOrigName || parsed.originalName === raw.name) {
                        bestParsedIdx = idx;
                      }
                    }
                    const parsedKey = (parsed.key || parsed.biomarker || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
                    const parsedName = (parsed.name || parsed.biomarker || '').toLowerCase();
                    const explanation = (parsed.explanation || parsed.changeReason || parsed.description || '').toLowerCase();
                    
                    let score = 0;
                    const cleanRawKey = rawKey.toLowerCase().replace(/[^a-z0-9]/g, '');
                    const cleanParsedKey = parsedKey.toLowerCase().replace(/[^a-z0-9]/g, '');
                    
                    if (cleanRawKey === cleanParsedKey) {
                      score += 100;
                    } else if (cleanParsedKey.length >= 4 && cleanRawKey.length >= 4 && (cleanRawKey.includes(cleanParsedKey) || cleanParsedKey.includes(cleanRawKey))) {
                      score += 40;
                    }
                    if (explanation.includes(rawKey.toLowerCase())) {
                      score += 80;
                    }
                    if (score > bestScore && score >= 40) {
                      bestScore = score;
                      bestParsedIdx = idx;
                    }
                  });

                  if (bestParsedIdx !== -1) {
                    const parsedRow = parsedRows[bestParsedIdx];
                    const stdKey = (parsedRow.standardizedName || parsedRow.key || parsedRow.name || parsedRow.biomarker || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
                    const action = String(parsedRow.Action || parsedRow.action || '').toLowerCase();
                    
                    if (action.includes('delete')) {
                      hHistory.forEach((log: any) => {
                        if (log.biomarkers && log.biomarkers[rawKey] !== undefined) {
                          delete log.biomarkers[rawKey];
                        }
                      });
                      if (updatedCustoms[rawKey]) {
                        delete updatedCustoms[rawKey];
                        deletedKeysToSync.push(rawKey);
                      }
                    } else if (stdKey && stdKey !== rawKey) {
                      hHistory.forEach((log: any) => {
                        if (log.biomarkers && log.biomarkers[rawKey] !== undefined) {
                          const val = log.biomarkers[rawKey];
                          delete log.biomarkers[rawKey];
                          log.biomarkers[stdKey] = val;
                        }
                      });
                      if (updatedCustoms[rawKey]) {
                        updatedCustoms[stdKey] = {
                          ...updatedCustoms[rawKey],
                          name: parsedRow.name || parsedRow.standardizedName || updatedCustoms[rawKey].name
                        };
                        delete updatedCustoms[rawKey];
                        deletedKeysToSync.push(rawKey);
                      }
                    }
                  }
                });
              }

              parsedRows.forEach((row: any) => {
                const action = String(row.Action || row.action || '').toLowerCase();
                const key = String(row.standardizedName || row.key || row.name || row.biomarker || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
                if (!key || action.includes('delete')) return;

                const isBuiltIn = biomarkerDefinitions.some(d => d.key === key);
                let finalUnit = (row.unit || '').replace(/µ/g, 'u').trim();
                let finalRange = (row.referenceRange || row.normalRange || '').replace(/µ/g, 'u');

                if (!updatedCustoms[key]) {
                  if (!isBuiltIn) {
                    updatedCustoms[key] = {
                      name: row.name || row.standardizedName || row.biomarker || key,
                      unit: finalUnit,
                      normalRange: finalRange || 'Unknown',
                      description: row.description || '',
                      riskCategories: row.riskCategories || [],
                      standardMedicalGrouping: row.standardMedicalGrouping || 'Other',
                      potentialMedicalConditions: row.potentialMedicalConditions || [],
                      needsApproval: false,
                      catalogApproved: true
                    };
                  }
                }

                if (row.value !== undefined && row.value !== null && row.value !== '') {
                  const finalValue = isNaN(Number(row.value)) ? row.value : parseFloat(String(row.value));
                  const standardDate = String(row.date || new Date().toISOString().split('T')[0]).split('T')[0].trim();

                  let existingLogIndex = hHistory.findIndex((h: any) => {
                    if (!h.date) return false;
                    return String(h.date).split('T')[0].trim() === standardDate;
                  });

                  if (existingLogIndex >= 0) {
                    hHistory[existingLogIndex].biomarkers[key] = finalValue;
                  } else {
                    hHistory.push({
                      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                      date: standardDate,
                      biomarkers: { [key]: finalValue },
                      note: "Extracted by Clinical Data Parser"
                    });
                  }
                }
              });

              hHistory.sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));

              const recomputedBiomarkers: { [key: string]: number | string } = {};
              [...hHistory].filter(b => b.sync_state !== 'delete' && !(profile?.deletedBiomarkerLogIds?.[b.id] && (profile?.deletedBiomarkerLogIds?.[b.id] || 0) >= (b.updated_at || 0))).sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date))).forEach(log => {
                Object.entries(log.biomarkers).forEach(([k, v]) => {
                  recomputedBiomarkers[k] = v as string | number;
                });
              });
              
              if (deletedKeysToSync.length > 0) {
                updatedProfile.deletedCustomBiomarkerKeys = { ...(updatedProfile.deletedCustomBiomarkerKeys || {}) };
                deletedKeysToSync.forEach(k => { updatedProfile.deletedCustomBiomarkerKeys![k] = Date.now(); });
              }

              updatedProfile.customBiomarkers = updatedCustoms;
              currentHistory = hHistory;

              const savedApproved = localStorage.getItem('approved_agent1_batches');
              let approved: any = {};
              try {
                if (savedApproved) approved = JSON.parse(savedApproved);
              } catch (e) {}
              approved[batchIdx] = true;
              try { localStorage.setItem('approved_agent1_batches', JSON.stringify(approved)); } catch(e){ console.warn("Quota exceeded approved_agent1"); }

              setBiomarkers(recomputedBiomarkers);
            } else {
              updatedProfile.agentTriageSummary = "Data extraction completed.";
              
              const jsonText = agentResult.extractedData || agentResult;
              const entries: any[] = [];
              const isString = typeof jsonText === 'string';

              if (isString) {
                try {
                  const cleanedText = (jsonText as string).replace(/```(?:yaml|yml)?/gi, '').trim();
                  const parsed = JSON.parse(cleanedText);
                  const rawList = Array.isArray(parsed) 
                    ? parsed 
                    : (parsed?.biomarkers || parsed?.entries || parsed?.data || []);
                  if (Array.isArray(rawList)) {
                    rawList.forEach((item: any) => {
                      if (item && typeof item === 'object') {
                        const bName = item.biomarker || item.name || item.key;
                        const bDate = item.date || item.timestamp;
                        const bVal = (item.numeric_value !== undefined && item.numeric_value !== null)
                          ? item.numeric_value
                          : (item.qualitative_value !== undefined && item.qualitative_value !== null)
                            ? item.qualitative_value
                            : (item.value !== undefined ? item.value : item.val);
                        if (bName && bDate && bVal !== undefined && bVal !== null && bVal !== '') {
                          entries.push({
                            biomarker: String(bName),
                            displayName: item.display_name ? String(item.display_name) : '',
                            date: String(bDate),
                            value: isNaN(Number(bVal)) ? bVal : parseFloat(String(bVal)),
                            unit: item.unit ? String(item.unit) : '',
                            referenceRange: item.referenceRange || item.range || ''
                          });
                        }
                      }
                    });
                  }
                } catch (e) {
                  console.warn("Standard YAML parser in App.tsx failed, falling back to regex", e);
                }

                if (entries.length === 0) {
                  const lines = (jsonText as string).split('\n');
                  let currentEntry: any = {};
                  
                  for (let line of lines) {
                    line = line.trim();
                    if (line.startsWith('-') || line.startsWith('biomarker:')) {
                      if (currentEntry.biomarker) entries.push(currentEntry);
                      currentEntry = {};
                    }
                    const bioMatch = line.match(/(?:-\s+)?biomarker:\s*(.*)/i);
                    if (bioMatch) { currentEntry.biomarker = bioMatch[1].replace(/['"]/g, '').trim(); continue; }
                    const dateMatch = line.match(/date:\s*([\d-]+)/i);
                    if (dateMatch) { currentEntry.date = dateMatch[1].trim(); continue; }
                    const valMatch = line.match(/value:\s*(.*)/i);
                    if (valMatch) { 
                      const rawVal = valMatch[1].replace(/['"]/g, '').trim(); 
                      currentEntry.value = isNaN(Number(rawVal)) ? rawVal : parseFloat(rawVal);
                      continue; 
                    }
                    const unitMatch = line.match(/unit:\s*(.*)/i);
                    if (unitMatch) { currentEntry.unit = unitMatch[1].replace(/['"]/g, '').trim(); continue; }
                    const rangeMatch = line.match(/referenceRange:\s*(.*)/i);
                    if (rangeMatch) { currentEntry.referenceRange = rangeMatch[1].replace(/['"]/g, '').trim(); continue; }
                  }
                  if (currentEntry.biomarker) entries.push(currentEntry);
                }
              }

              const seenEntryKeys = new Set<string>();
              const filteredEntries = entries.filter(entry => {
                const raw1 = String(entry.biomarker || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
                const key1 = getMappedBiomarkerKey(raw1) || raw1;
                const dKey = String(entry.date || '').split('T')[0].trim();
                const valKey = String(entry.value ?? '');
                const dedupeKey = `${key1}|${dKey}|${valKey}`;
                if (seenEntryKeys.has(dedupeKey)) return false;
                seenEntryKeys.add(dedupeKey);
                return true;
              });
              
              filteredEntries.forEach(entry => {
                const rawSlug = String(entry.biomarker || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
                const bioName = getMappedBiomarkerKey(rawSlug) || rawSlug;
                const isBuiltIn = biomarkerDefinitions.some((d) => d.key === bioName);
                let finalValue = entry.value;
                let finalUnit = (entry.unit || '').replace(/µ/g, 'u').trim();
                let finalRange = (entry.referenceRange || '').replace(/µ/g, 'u');

                if (/^(n\/a|na|-|--|nil|none)$/i.test(finalUnit)) {
                  finalUnit = '';
                }

                if (bioName === 'audit_c_total_score' || bioName.startsWith('audit_') || bioName.endsWith('_score')) {
                  if (/mmhg/i.test(finalUnit)) {
                    finalUnit = 'score';
                  }
                }

                const standardDate = String(entry.date).split('T')[0].trim();

                const matchDate = (d1: string, d2: string) => {
                  if (!d1 || !d2) return false;
                  return String(d1).split('T')[0].trim() === String(d2).split('T')[0].trim();
                };

                let existingLogIndex = currentHistory.findIndex(h => matchDate(h.date, standardDate));
                if (existingLogIndex >= 0) {
                  currentHistory[existingLogIndex].biomarkers[bioName] = finalValue;
                  attachObservationMeta(currentHistory[existingLogIndex], bioName, {
                    unit: finalUnit,
                    printedRange: finalRange,
                    rawValue: finalValue,
                  });
                  if (bioName === 'blood_pressure' && typeof finalValue === 'string') {
                    const bpMatch = finalValue.match(/(\d+)\s*\/\s*(\d+)/);
                    if (bpMatch) {
                      const s = parseInt(bpMatch[1], 10);
                      const d = parseInt(bpMatch[2], 10);
                      currentHistory[existingLogIndex].biomarkers['systolic_blood_pressure'] = s;
                      attachObservationMeta(currentHistory[existingLogIndex], 'systolic_blood_pressure', { unit: 'mmHg', rawValue: s, printedRange: '< 120' });
                      currentHistory[existingLogIndex].biomarkers['diastolic_blood_pressure'] = d;
                      attachObservationMeta(currentHistory[existingLogIndex], 'diastolic_blood_pressure', { unit: 'mmHg', rawValue: d, printedRange: '< 80' });
                    }
                  }
                } else {
                  const newLog: any = {
                    id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                    date: standardDate,
                    biomarkers: { [bioName]: finalValue },
                    note: "Extracted from Clinical PDF / Image"
                  };
                  attachObservationMeta(newLog, bioName, {
                    unit: finalUnit,
                    printedRange: finalRange,
                    rawValue: finalValue,
                  });
                  if (bioName === 'blood_pressure' && typeof finalValue === 'string') {
                    const bpMatch = finalValue.match(/(\d+)\s*\/\s*(\d+)/);
                    if (bpMatch) {
                      const s = parseInt(bpMatch[1], 10);
                      const d = parseInt(bpMatch[2], 10);
                      newLog.biomarkers['systolic_blood_pressure'] = s;
                      attachObservationMeta(newLog, 'systolic_blood_pressure', { unit: 'mmHg', rawValue: s, printedRange: '< 120' });
                      newLog.biomarkers['diastolic_blood_pressure'] = d;
                      attachObservationMeta(newLog, 'diastolic_blood_pressure', { unit: 'mmHg', rawValue: d, printedRange: '< 80' });
                    }
                  }
                  currentHistory.push(newLog);
                }

                if (!updatedProfile.customBiomarkers) {
                  updatedProfile.customBiomarkers = {};
                }

                const mapping = agentResult.bucketMapping || {};
                let mapData: any = null;
                if (mapping && typeof mapping === 'object') {
                  const matchKey = Object.keys(mapping).find(k => 
                    k.toLowerCase().replace(/[^a-z0-9]/g, '_') === bioName
                  );
                  if (matchKey) {
                    mapData = mapping[matchKey];
                  }
                }

                if (!updatedProfile.customBiomarkers[bioName]) {
                  if (!isBuiltIn) {
                    // B7.4: unknown names route to the Pending store, never catalog keys.
                    updatedProfile.pendingObservations = pushPendingObservation(updatedProfile.pendingObservations, {
                      printedName: entry.displayName || entry.biomarker,
                      suggestedKey: bioName,
                      date: standardDate,
                      rawValue: finalValue,
                      rawUnit: finalUnit,
                      printedRange: finalRange,
                    });
                  } else if (shouldRunCalibrator(bioName, updatedProfile)) {
                    updatedProfile.customBiomarkers[bioName] = {
                      name: entry.displayName || entry.biomarker,
                      catalogApproved: true,
                      calibrationDue: true,
                    } as any;
                  }
                } else {
                  const currentName = updatedProfile.customBiomarkers[bioName].name;
                  if (entry.displayName && (!currentName || currentName === bioName || currentName === entry.biomarker)) {
                    updatedProfile.customBiomarkers[bioName].name = entry.displayName;
                  }
                  if (finalUnit && !updatedProfile.customBiomarkers[bioName].unit) {
                    updatedProfile.customBiomarkers[bioName].unit = finalUnit;
                  }
                  if (finalRange && (!updatedProfile.customBiomarkers[bioName].normalRange || updatedProfile.customBiomarkers[bioName].normalRange === 'Unknown')) {
                    updatedProfile.customBiomarkers[bioName].normalRange = finalRange;
                  }
                  if (mapData) {
                    if (mapData.riskCategories) updatedProfile.customBiomarkers[bioName].riskCategories = mapData.riskCategories;
                    if (mapData.standardMedicalGrouping) updatedProfile.customBiomarkers[bioName].standardMedicalGrouping = mapData.standardMedicalGrouping;
                    if (mapData.potentialMedicalConditions) updatedProfile.customBiomarkers[bioName].potentialMedicalConditions = mapData.potentialMedicalConditions;
                  }
                }
              });
              
              currentHistory.sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));
              setBiomarkerHistory(currentHistory);
              
              const recomputedBiomarkers: { [key: string]: number | string } = {};
              [...currentHistory].filter(b => b.sync_state !== 'delete' && !(profile?.deletedBiomarkerLogIds?.[b.id] && (profile?.deletedBiomarkerLogIds?.[b.id] || 0) >= (b.updated_at || 0))).sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date))).forEach(log => {
                Object.entries(log.biomarkers).forEach(([k, v]) => {
                  recomputedBiomarkers[k] = v as string | number;
                });
              });
              setBiomarkers(recomputedBiomarkers);
            }
          } else if (agentType === 'agent2') {
             updatedProfile.agentTriageSummary = "Biomarker categories mapped.";
             const mapping = agentResult.bucketMapping || agentResult;
             if (mapping && typeof mapping === 'object') {
               if (!updatedProfile.customBiomarkers) updatedProfile.customBiomarkers = {};
               Object.entries(mapping).forEach(([bioName, mapData]: [string, any]) => {
                 const key = bioName.toLowerCase().replace(/[^a-z0-9]/g, '_');
                 const existingDef = updatedProfile.customBiomarkers![key] || {
                   name: bioName, unit: '', normalRange: 'Unknown', description: ''
                 };
                 updatedProfile.customBiomarkers![key] = {
                   ...existingDef,
                   riskCategories: mapData.riskCategories || [],
                   standardMedicalGrouping: mapData.standardMedicalGrouping || 'Other',
                   potentialMedicalConditions: mapData.potentialMedicalConditions || []
                 };
               });
             }
          } else if (agentType === 'data_review') {
            const batchIdx = agentResult.batchIdx !== undefined && agentResult.batchIdx !== null 
              ? agentResult.batchIdx 
              : activeDataReviewBatchIdx;
            
            const updatedCustoms = { ...(updatedProfile.customBiomarkers || {}) };
            
            if (Array.isArray(agentResult.reviewedBiomarkers)) {
              agentResult.reviewedBiomarkers.forEach((bm: any) => {
                const existing = (updatedCustoms[bm.key] || {}) as any;
                const optVal = formatOptimalTargetValue(bm);

                updatedCustoms[bm.key] = {
                  ...existing,
                  name: bm.name || existing.name,
                  unit: existing.unit || bm.unit,
                  optimalValue: optVal,
                  normalRange: existing.normalRange || '',
                  profileAdjustedNormalRange: bm.profileAdjustedNormalRange || existing.profileAdjustedNormalRange || '',
                  description: bm.description || existing.description || '',
                  riskCategories: (existing.riskCategories && existing.riskCategories.length > 0) ? existing.riskCategories : (bm.riskCategories || []),
                  standardMedicalGrouping: (existing.standardMedicalGrouping && existing.standardMedicalGrouping !== 'Other') ? existing.standardMedicalGrouping : (bm.standardMedicalGrouping || 'Other'),
                  potentialMedicalConditions: bm.potentialMedicalConditions || existing.potentialMedicalConditions || [],
                  specificRiskContext: bm.specificRiskContext || existing.specificRiskContext || '',
                  status: bm.status || existing.status || 'Healthy',
                  rangeBrackets: bm.rangeBrackets || existing.rangeBrackets || [],
                  overlayFingerprint: overlayFingerprint(updatedProfile),
                } as any;
              });

              const recomputedBiomarkers: { [key: string]: number | string } = {};
              [...currentHistory]
                .filter(b => b.sync_state !== 'delete' && !(profile?.deletedBiomarkerLogIds?.[b.id] && (profile?.deletedBiomarkerLogIds?.[b.id] || 0) >= (b.updated_at || 0)))
                .sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date)))
                .forEach(log => {
                  Object.entries(log.biomarkers).forEach(([k, v]) => {
                    recomputedBiomarkers[k] = v as string | number;
                  });
                });
              setBiomarkers(recomputedBiomarkers);
            }
            
            updatedProfile.customBiomarkers = updatedCustoms;
            
            if (batchIdx !== undefined && batchIdx !== null) {
              const saved = localStorage.getItem('approved_data_review_batches');
              let approved: any = {};
              try {
                if (saved) approved = JSON.parse(saved);
              } catch (e) {}
              approved[batchIdx] = true;
              try { localStorage.setItem('approved_data_review_batches', JSON.stringify(approved)); } catch(e){ console.warn("Quota exceeded approved_data"); }
              
              const savedResults = localStorage.getItem('batch_analysis_results');
              let results: any = {};
              try {
                if (savedResults) results = JSON.parse(savedResults);
              } catch (e) {}
              const minimalResult = { ...agentResult };
              delete minimalResult.agentPrompt;
              results[batchIdx] = minimalResult;
              try { localStorage.setItem('batch_analysis_results', JSON.stringify(results)); } catch(e){ console.warn("Quota exceeded batch_analysis"); }

              try {
                const keysToMoveSaved = localStorage.getItem(`batch_${batchIdx}_missing_keys_to_move`);
                if (keysToMoveSaved) {
                  const keysToMove: string[] = JSON.parse(keysToMoveSaved);
                  if (Array.isArray(keysToMove) && keysToMove.length > 0) {
                    const batchesSaved = localStorage.getItem('biomarker_batches_custom');
                    if (batchesSaved) {
                      let currentBatches: string[][] = JSON.parse(batchesSaved);
                      const sizeSaved = localStorage.getItem('biomarker_batch_size');
                      const batchSizeNum = sizeSaved ? Number(sizeSaved) : 20;

                      keysToMove.forEach(key => {
                        if (currentBatches[batchIdx]) {
                          currentBatches[batchIdx] = currentBatches[batchIdx].filter(k => k !== key);
                        }

                        let placed = false;
                        for (let i = batchIdx + 1; i < currentBatches.length; i++) {
                          if (!approved[i] && !results[i] && currentBatches[i].length < batchSizeNum) {
                            currentBatches[i].push(key);
                            placed = true;
                            break;
                          }
                        }

                        if (!placed) {
                          let lastBatch = currentBatches[currentBatches.length - 1];
                          if (!lastBatch || lastBatch.length >= batchSizeNum || approved[currentBatches.length - 1] || results[currentBatches.length - 1]) {
                            currentBatches.push([key]);
                          } else {
                            lastBatch.push(key);
                          }
                        }
                      });

                      localStorage.setItem('biomarker_batches_custom', JSON.stringify(currentBatches));
                    }
                  }
                  localStorage.removeItem(`batch_${batchIdx}_missing_keys_to_move`);
                }
              } catch (e) {
                console.error("Error moving missing biomarkers on clinical calibration finish:", e);
              }
            }
          } else if (agentType === 'health_baseline') {
             setIsMedicalChatOpen(false);
             const data = agentResult?.report || agentResult || {};
             const unselected = new Set(agentResult.unselectedRowKeys || []);
             const riskCategories = Array.isArray(data.riskCategories) ? data.riskCategories : [];
             const acceptedCategories = riskCategories.filter((_: any, idx: number) => !unselected.has(idx));
             
             const globalNutrientTargets = Array.isArray(data.nutrientTargets) ? data.nutrientTargets : (Array.isArray(data.topNutrientTargets) ? data.topNutrientTargets : []);
             const globalDailyActivities = Array.isArray(data.dailyActivities) ? data.dailyActivities : [];
             const generalNutrientTargets = data.generalNutrientTargets || {};

             if (!currentReport) {
               currentReport = {
                 timestamp: new Date().toISOString(),
                 dailyNutrientTargets: {},
                 mostImportantNextStep: '',
                 actions: [],
                 dailyBenefits: [],
                 latestInsights: [],
                 healthRiskForecast: { year5: '', year10: '', year20: '', optimized5: '', optimized10: '', optimized20: '' }
               };
             }

             let newDailyNutrientTargets = { ...(currentReport.dailyNutrientTargets || {}) };

             Object.entries(generalNutrientTargets).forEach(([key, val]) => {
               newDailyNutrientTargets[key] = String(val);
             });

             const justifiedNutrientKeys = new Set();
             const justifiedActivities = new Set();

             acceptedCategories.forEach((cat) => {
               if (Array.isArray(cat.nutrientTargets)) {
                 cat.nutrientTargets.forEach((nt) => {
                   if (nt.nutrientKey) {
                     justifiedNutrientKeys.add(nt.nutrientKey.toLowerCase().trim());
                   }
                 });
               }
               if (Array.isArray(cat.dailyActivities)) {
                 cat.dailyActivities.forEach((da) => {
                   if (da.activity) {
                     justifiedActivities.add(da.activity.toLowerCase().trim());
                   }
                 });
               }
             });

             globalNutrientTargets.forEach((nt: any) => {
               if (nt.nutrientKey && nt.targetValue) {
                 newDailyNutrientTargets[nt.nutrientKey] = nt.targetValue;
               }
             });

             globalDailyActivities.forEach((da: any) => {
               if (da.activity && da.target && justifiedActivities.has(da.activity.toLowerCase().trim())) {
                 const isStepActivity = /\bsteps?\b/i.test(da.activity) || /\bwalk(ing)?\b/i.test(da.activity);
                 if (isStepActivity) {
                   const stepsMatch = String(da.target).match(/[\d,]+/);
                   if (stepsMatch) {
                     newDailyNutrientTargets.steps = stepsMatch[0].replace(/,/g, '');
                   }
                 } else {
                   currentDailyBenefits.push({
                     id: `db_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                     activity: da.activity,
                     target: da.target,
                     completed: false
                   });
                 }
               }
             });

             acceptedCategories.forEach((cat: any) => {
               if (Array.isArray(cat.nutrientTargets)) {
                 cat.nutrientTargets.forEach((nt: any) => {
                   if (nt.nutrientKey && nt.targetValue) {
                     newDailyNutrientTargets[nt.nutrientKey] = nt.targetValue;
                   }
                 });
               }
               if (Array.isArray(cat.dailyActivities)) {
                 cat.dailyActivities.forEach((da: any) => {
                   if (da.activity && da.target) {
                     const isStepActivity = /\bsteps?\b/i.test(da.activity) || /\bwalk(ing)?\b/i.test(da.activity);
                     if (isStepActivity) {
                       const stepsMatch = String(da.target).match(/[\d,]+/);
                       if (stepsMatch) {
                         newDailyNutrientTargets.steps = stepsMatch[0].replace(/,/g, '');
                       }
                     } else {
                       currentDailyBenefits.push({
                         id: `db_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                         activity: da.activity,
                         target: da.target,
                         completed: false
                       });
                     }
                   }
                 });
               }
             });

             currentReport.dailyNutrientTargets = newDailyNutrientTargets;

             const recommendedKeysSet = new Set<string>();
             if (Array.isArray(data.topNutrientTargets)) {
               data.topNutrientTargets.forEach((nt: any) => {
                 const k = typeof nt === 'string' ? nt : (nt?.nutrientKey || nt?.key);
                 if (k) recommendedKeysSet.add(k);
               });
             }
             const rawWeeklyData = data.topWeeklyNutrientTargets || data.weeklyNutrientTargets;
             if (Array.isArray(rawWeeklyData)) {
               rawWeeklyData.forEach((nt: any) => {
                 const k = typeof nt === 'string' ? nt : (nt?.nutrientKey || nt?.key);
                 if (k) recommendedKeysSet.add(k);
               });
             } else if (typeof rawWeeklyData === 'object' && rawWeeklyData !== null) {
               Object.keys(rawWeeklyData).forEach(k => recommendedKeysSet.add(k));
             }
             acceptedCategories.forEach((cat: any) => {
               if (Array.isArray(cat.nutrientTargets)) {
                 cat.nutrientTargets.forEach((nt: any) => {
                   const k = nt?.nutrientKey || nt?.key;
                   if (k) recommendedKeysSet.add(k);
                 });
               }
             });

             const topCoreKeys = Array.from(recommendedKeysSet).filter(isCoreNutrient);
             const topWeeklyKeys = Array.from(recommendedKeysSet).filter(isAdditionalNutrient);

             currentReport.topNutrientTargets = topCoreKeys;
             currentReport.topWeeklyNutrientTargets = topWeeklyKeys;

             if (currentReport.topNutrientTargets.length > 0) {
               updatedProfile.topNutrientsToMonitor = currentReport.topNutrientTargets;
             }
             currentReport.generalNutrientTargets = data.generalNutrientTargets;
             currentReport.nutrientRankingRationale = data.nutrientRankingRationale;
             currentReport.healthBaselineCategories = acceptedCategories;
             
             setReport(currentReport);
             setDailyBenefits(currentDailyBenefits);
          }
          
          setProfile(updatedProfile);
          try {
            const searchType = (agentType as string) === 'medical_extract' ? 'agent1' : agentType;
            const latestAnalysis = (updatedProfile.agentAnalyses || [])
              .filter(a => a.agentType === searchType || (searchType === 'agent1' && a.agentType === 'medical_extract'))
              .sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)))[0];
            
            if (latestAnalysis) {
              try {
                const savedIds = localStorage.getItem('approvedAnalysisIds');
                let approvedIds: any = {};
                if (savedIds) approvedIds = JSON.parse(savedIds);
                approvedIds[searchType] = latestAnalysis.id;
                localStorage.setItem('approvedAnalysisIds', JSON.stringify(approvedIds));
              } catch (e) {
                console.warn("Failed to auto-approve analysis in localStorage", e);
              }
            }

            await saveAndSync(updatedProfile, foodLogs, biomarkers, currentHistory, currentActions, currentDailyBenefits, currentReport || report);
          } finally {
            setCalibratingBatchIdx(null);
            setCalibratingAgentType(null);
            
            const isBatch = agentType === 'data_review';
            if (isBatch) {
              const batchIdx = agentResult?.batchIdx !== undefined && agentResult?.batchIdx !== null 
                ? agentResult.batchIdx 
                : activeDataReviewBatchIdx;
              if (batchIdx !== undefined && batchIdx !== null) {
                setTimeout(() => {
                  const element = document.getElementById(`batch-card-${batchIdx}`);
                  if (element) {
                    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }
                }, 150);
              }
            } else {
              const getStepIndexForAgent = (aType: string) => {
                if (aType === 'agent1' || aType === 'medical_extract') return 1;
                if (aType === 'data_review') return 2;
                if (aType === 'health_baseline') return 3;
                if (aType === 'agent4') return 4;
                if (aType === 'agent7') return 5;
                return -1;
              };
              const stepIdx = getStepIndexForAgent(agentType);
              if (stepIdx !== -1) {
                setTimeout(() => {
                  const element = document.getElementById(`accordion-step-${stepIdx}`);
                  if (element) {
                    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }
                }, 150);
              }
            }
          }
        };

        return (
          <React.Suspense fallback={
            isFrontDeskOpen ? (
              <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4 animation-fade-in font-sans">
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-2xl flex flex-col items-center gap-3 animate-pulse max-w-xs w-full">
                  <div className="w-10 h-10 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                    <span className="w-5 h-5 border-2 border-emerald-600 dark:border-emerald-400 border-t-transparent rounded-full animate-spin" />
                  </div>
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">{(translations[profile?.language] || translations.en).openingFrontDesk || 'Opening Front Desk...'}</p>
                </div>
              </div>
            ) : null
          }>
            <ErrorBoundary>{isFrontDeskOpen && <LogChat type="front_desk"
            jobId={activeFrontDeskJobId}
            onJobCreated={setActiveFrontDeskJobId}
            profile={profile}
            isOpen={isFrontDeskOpen}
            onOpenAgentFromFrontDesk={handleOpenAgentFromFrontDesk}
            selectedModelId={selectedModelId}
            onChangeModelId={setSelectedModelId}
            onJobEnqueued={(id, kind) => {
              setActiveTab(kind === 'food' ? 'food' : 'medical');
              // Unified modal behaviour: close the dialog when processing starts.
              // Job + dispatches persist in JobStore; progress is visible in tasks/history.
              setIsFrontDeskOpen(false);
            }}
            onClose={() => setIsFrontDeskOpen(false)}
            biomarkers={biomarkers}
            biomarkerHistory={biomarkerHistory}
            foodLogs={foodLogs}
            report={report}
            actions={actions}
            onLogMedical={handleLogMedical}
            onLogFood={handleLogFood}
            onAgentAnalysisSaved={handleAgentAnalysisSaved}
            onAgentFinish={handleAgentFinish}
            onSaveProfile={async (updatedP) => {
              // B7.5: agent-returned profiles can carry new demographics.
              const recalibratedP = maybeRecalibrateDemographicOverlays(profile, updatedP);
              setProfile(recalibratedP);
              await saveAndSync(recalibratedP, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'profile' });
            }}
            onAddBiomarkerLogs={async (logs) => {
              let updatedBiomarkers = { ...biomarkers };
              let updatedHistory = [...biomarkerHistory];
              let hasCustomUpdates = false;
              const customBiomarkers = { ...(profile?.customBiomarkers || {}) };

              logs.forEach(log => {
                const key = getMappedBiomarkerKey(log.biomarker) || log.biomarker;
                updatedBiomarkers[key] = log.value;
                const day = log.date || new Date().toISOString().split('T')[0];
                const sourceId = log.sourceReportId;
                const idx = updatedHistory.findIndex((h) =>
                  toYYYYMMDD(h.date) === toYYYYMMDD(day)
                  && (!sourceId || !h.sourceReportId || h.sourceReportId === sourceId)
                );
                if (idx >= 0 && (!sourceId || !updatedHistory[idx].sourceReportId || updatedHistory[idx].sourceReportId === sourceId)) {
                  updatedHistory[idx] = {
                    ...updatedHistory[idx],
                    biomarkers: { ...updatedHistory[idx].biomarkers, [key]: log.value },
                    sync_state: 'update',
                    updated_at: Date.now(),
                  };
                  attachObservationMeta(updatedHistory[idx], key, { unit: log.unit, rawValue: log.value });
                } else {
                  const row = {
                    id: `bm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    biomarkers: { [key]: log.value },
                    date: day,
                    sourceReportId: sourceId,
                  };
                  attachObservationMeta(row, key, { unit: log.unit, rawValue: log.value });
                  updatedHistory.push(row);
                }

              });

              const { updatedCustoms, hasChanges } = selfHealCustomBiomarkerDefinitions(
                logs.map(l => ({ key: l.biomarker, unit: l.unit, normalRange: l.normalRange })),
                profile?.customBiomarkers
              );
              let targetProfile = profile;
              if (hasChanges && profile) {
                targetProfile = { ...profile, customBiomarkers: updatedCustoms };
                setProfile(targetProfile);
              }

              setBiomarkers(updatedBiomarkers);
              setBiomarkerHistory(updatedHistory);
              await saveAndSync(targetProfile, foodLogs, updatedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLogsBatch', targetIds: updatedHistory.slice(-logs.length).map(l => l.id) });
            }}

          />}</ErrorBoundary>
          </React.Suspense>
        );
      })()}
      <React.Suspense fallback={null}>
        <ErrorBoundary>{isFoodChatOpen && <LogChat type="food"
        profile={profile}
        isOpen={isFoodChatOpen}
        jobId={activeJobId}
        selectedModelId={selectedModelId}
        onChangeModelId={setSelectedModelId}
        onJobEnqueued={(id, kind) => {
          // Unified modal behaviour: close the dialog when processing starts.
          // activeJobId is cleared so the derived dialog closes; the job itself
          // stays in JobStore (follow-up edits reopen it; dispatches accumulate).
          // Restores aca09c4; multi-turn regressed it by keeping the job open.
          setActiveJobId(null);
          setActiveTab('food');
        }}
        onClose={async () => {
          try {
            if (activeJobId) {
              const job = JobStore.getJob(activeJobId);
              if (job && job.status === 'draft') {
                await JobStore.deleteJob(activeJobId);
              }
            }
          } catch (err) {
            console.error('[FoodChat onClose] Draft cleanup failed, closing modal anyway:', err);
          } finally {
            setActiveJobId(null);
            setActiveTab('food');
          }
        }}
        onLogFood={handleLogFood}
        biomarkers={biomarkers}
        biomarkerHistory={biomarkerHistory}
        foodLogs={foodLogs}
        report={report}
        isFirestoreQuotaExceeded={isFirestoreQuotaExceeded}
        onSaveProfile={async (updatedP) => {
          // B7.5: agent-returned profiles can carry new demographics.
          const recalibratedP = maybeRecalibrateDemographicOverlays(profile, updatedP);
          setProfile(recalibratedP);
          await saveAndSync(recalibratedP, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'profile' });
        }}
        onGoToManualEdit={(errorMsg) => {
          setActiveJobId(null);
          setActiveTab('food');
          if (errorMsg) {
            setManualFoodLogError(errorMsg);
          }
          setIsManualFoodLogOpen(true);
        }}
      />}</ErrorBoundary>
      </React.Suspense>
      <React.Suspense fallback={
        isMedicalChatOpen ? (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4 animation-fade-in font-sans">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-2xl flex flex-col items-center gap-3 animate-pulse max-w-xs w-full">
              <div className="w-10 h-10 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                <span className="w-5 h-5 border-2 border-indigo-600 dark:border-indigo-400 border-t-transparent rounded-full animate-spin" />
              </div>
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">Opening Health Coach...</p>
            </div>
          </div>
        ) : null
      }>
        <ErrorBoundary>{isMedicalChatOpen && <LogChat key={`medical_${activeAgentType || 'general'}`}
        type="medical"
        profile={profile}
        isOpen={isMedicalChatOpen}
        jobId={activeJobId}
        selectedModelId={selectedModelId}
        onChangeModelId={setSelectedModelId}
        onJobEnqueued={(id, kind) => {
          setActiveTab('health');
          setHealthSubTab('biomarker');
          // Unified modal behaviour: hide the dialog when processing starts.
          // Agent/job state is preserved (unlike onClose); reopening resumes the thread.
          setIsMedicalChatOpen(false);
        }}
        onClose={() => {
          console.log(`[DIAG7] Medical modal onClose fired - clearing activeHandoffPayload`, new Error('trace').stack);
          setIsMedicalChatOpen(false);
          setActiveAgentType(null);
          setPrefillMessage(null);
          setActiveHandoffPayload(null);
          setActiveDataReviewBatchIdx(null);
          setActiveJobId(null);
          setActiveTab('health');
          setHealthSubTab('biomarker');
        }}
        autoSendMessage={prefillMessage}
        handoffPayload={activeHandoffPayload}
        onLogMedical={handleLogMedical}
        biomarkers={biomarkers}
        biomarkerHistory={biomarkerHistory}
        foodLogs={foodLogs}
        report={report}
        actions={actions}
        isFirestoreQuotaExceeded={isFirestoreQuotaExceeded}
        onSaveProfile={async (updatedP) => {
          // B7.5: agent-returned profiles can carry new demographics.
          const recalibratedP = maybeRecalibrateDemographicOverlays(profile, updatedP);
          setProfile(recalibratedP);
          await saveAndSync(recalibratedP, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'profile' });
        }}
        agentType={activeAgentType}
        reviewBiomarkerKey={activeReviewBiomarkerKey}
        dataReviewBatchIdx={activeDataReviewBatchIdx}
        dataReviewBatchKeys={activeDataReviewBatchKeys}
        extractedData={activeDataReviewExtractedYaml}
        currentBatch={activeDataReviewCurrentBatch}
        estimatedTotalMarkers={activeDataReviewEstimatedTotalMarkers}
        batchSize={batchSize}
        dataReviewSharedState={dataReviewSharedState}
        onDataReviewBatchChange={(idx) => {
          setActiveDataReviewBatchIdx(idx);
          const sharedBatches = dataReviewSharedState?.batches || [];
          if (idx === 'custom') {
            setActiveDataReviewBatchKeys(dataReviewSharedState?.customDataReviewBatchKeys || []);
          } else {
            setActiveDataReviewBatchKeys(sharedBatches[idx as number] || []);
          }
        }}
        onAgentAnalysisSaved={handleAgentAnalysisSaved}
        onAgentFinish={async (agentType, agentResult, extraActions?: HealthAction[]) => {
          // ─── SNAPSHOT BEFORE ANY CHANGE (FIX-8) ──────────────────────────
          const snapLabel = `Before ${agentType} approval (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })})`;
          await saveLocalSnapshot(snapLabel, profile?.email, {
            profile,
            foodLogs,
            biomarkers,
            biomarkerHistory,
            actions,
            dailyBenefits,
            report
          });
          if (profile?.email) {
            setSnapshots(await loadLocalSnapshots(profile.email));
          }
          setLastSnapshotLabel(snapLabel);
          // ───────────────────────────────────────────────────────────────
          const isPartialApply = !!(agentResult?.forceApplyNow) && !!(agentResult?.hasMoreMarkers || agentResult?.hasMore || agentResult?.needsContinuation || agentResult?.status === 'needs_continuation');
          if (!isPartialApply) {
            setIsMedicalChatOpen(false);
          }
          setCalibratingAgentType(agentType);
          const updatedProfile = { ...profile };
          
          let currentHistory = [...biomarkerHistory];
          let currentReport = report ? { ...report } : null;
          let currentDailyBenefits = [...dailyBenefits];
          let currentActions = [...actions];

          // Review: apply modificationCommand (dated) and/or flat corrections
          if ((agentType as string) === 'biomarker_review') {
            let candidate = agentResult;
            if (typeof candidate === 'string') {
              try {
                candidate = JSON.parse(candidate.replace(/```(?:json)?/gi, '').trim());
              } catch (e) {}
            }

            const rawCmds = Array.isArray(candidate?.modificationCommand)
              ? candidate.modificationCommand
              : (Array.isArray(candidate?.result?.modificationCommand)
                ? candidate.result.modificationCommand
                : (Array.isArray(candidate?.agentResult?.modificationCommand)
                  ? candidate.agentResult.modificationCommand
                  : (Array.isArray((candidate as any)?.clean_result?.modificationCommand)
                    ? (candidate as any).clean_result.modificationCommand
                    : (Array.isArray((candidate as any)?.data?.modificationCommand)
                      ? (candidate as any).data.modificationCommand
                      : (Array.isArray((candidate as any)?.data?.agentResult?.modificationCommand)
                        ? (candidate as any).data.agentResult.modificationCommand
                        : [])))));

            const unitMap = collectCatalogUnitMap(updatedProfile);
            let commands = enrichReviewModificationCommands(
              rawCmds,
              currentHistory || [],
              unitMap
            );

            if (commands.length === 0 && (candidate?.reply || candidate?.text || candidate?.initialRawText || (typeof candidate === 'string' ? candidate : ''))) {
              commands = extractFallbackModifications(candidate?.reply || candidate?.text || candidate?.initialRawText || (typeof candidate === 'string' ? candidate : '') || '', currentHistory || [], updatedProfile);
              if (commands.length > 0) {
                commands = enrichReviewModificationCommands(commands, currentHistory || [], unitMap);
              }
            }

            const unselected = Array.isArray(candidate?.unselectedRowKeys) ? candidate.unselectedRowKeys : [];
            if (unselected.length > 0) {
              commands = commands.filter((cmd: any) => !unselected.includes(cmd.keyName || cmd.key || cmd.biomarker));
            }

            const { history: afterCommands, applied } = applyModificationCommands(currentHistory, commands, unitMap);
            currentHistory = afterCommands;

            const corrections: Record<string, any> = agentResult?.corrections || agentResult?.biomarkerCorrections || {};
            if (Object.keys(corrections).length > 0) {
              const correctionDate = agentResult?.date || new Date().toISOString().split('T')[0];
              const existingIdx = currentHistory.findIndex((h: any) => toYYYYMMDD(h.date) === toYYYYMMDD(correctionDate));
              if (existingIdx >= 0) {
                currentHistory[existingIdx] = {
                  ...currentHistory[existingIdx],
                  biomarkers: { ...currentHistory[existingIdx].biomarkers, ...corrections }
                };
              } else {
                currentHistory.push({
                  id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                  date: correctionDate,
                  biomarkers: corrections,
                  note: "Corrected by Review"
                });
              }
            }

            const proposal = agentResult?.proposal;
            if (proposal && (proposal.range || proposal.metric || proposal.rangeBrackets)) {
              const rawKey = agentResult.biomarkerKey || proposal.key || proposal.name || commands[0]?.keyName || '';
              const overlayKey = getMappedBiomarkerKey(String(rawKey)) || String(rawKey).toLowerCase().replace(/[^a-z0-9]/g, '_');
              if (overlayKey) {
                if (!updatedProfile.customBiomarkers) updatedProfile.customBiomarkers = {};
                const prev = (updatedProfile.customBiomarkers[overlayKey] || {}) as any;
                updatedProfile.customBiomarkers[overlayKey] = {
                  ...prev,
                  name: proposal.name || prev.name || overlayKey,
                  unit: proposal.metric || prev.unit,
                  profileAdjustedNormalRange: proposal.range || prev.profileAdjustedNormalRange,
                  description: proposal.description || prev.description || '',
                  rangeBrackets: proposal.rangeBrackets || prev.rangeBrackets,
                  structuredRanges: proposal.rangeBrackets ? [{
                    targetGender: 'Any',
                    targetEthnicity: 'Any',
                    range: {
                      type: 'bracket',
                      brackets: proposal.rangeBrackets.map((b: any) => ({
                        min: b.min !== undefined ? b.min : null,
                        max: b.max !== undefined ? b.max : null,
                        alias: b.label,
                        severity: b.severity
                      }))
                    }
                  }] : prev.structuredRanges,
                  overlayFingerprint: overlayFingerprint(updatedProfile),
                };
              }
            }

            if (applied > 0 || Object.keys(corrections).length > 0 || commands.length > 0) {
              const recomputed: { [key: string]: number | string } = {};
              [...currentHistory]
                .filter((b: any) => b.sync_state !== 'delete')
                .sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date)))
                .forEach((log) => {
                  Object.entries(log.biomarkers || {}).forEach(([k, v]) => {
                    recomputed[k] = v as string | number;
                  });
                });
              setBiomarkers(recomputed);
              setBiomarkerHistory(currentHistory);
              await saveAndSync(updatedProfile, foodLogs, recomputed, currentHistory, actions, dailyBenefits, report, {
                type: 'biomarkerLogsBatch',
                targetIds: currentHistory.map((h: any) => h.id)
              });
            }

            if (activeJobId) {
              await JobStore.deleteJob(activeJobId);
              setActiveJobId(null);
            }
            setIsMedicalChatOpen(false);
            setActiveAgentType(null);
            setCalibratingAgentType(null);
            return;
          }
          
          if ((agentType as string) === 'medical_analyze') {
            const filledRows = agentResult?.filledRows || [];
            
            // We want to construct exactly what the frontend expects for updates:
            // 1. Update Custom Biomarkers (draft catalogs and custom ranges)
            // 2. Append/Update Logs in History
            
            const updatedCustoms = { ...(updatedProfile.customBiomarkers || {}) };
            const existingPending = Array.isArray(updatedProfile.pendingObservations) ? [...updatedProfile.pendingObservations] : [];
            const newLogsToInsert = [];
            
            const recomputed: { [key: string]: number | string } = {};
            
            filledRows.forEach((row: any) => {
                if (row.newCatalogDraft && row.writeTarget === 'pending') {
                    // It's a Miss! Create a pending draft custom biomarker
                    const key = row.newCatalogDraft.suggestedKey || `custom_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
                    
                    if (row.logs && row.logs.length > 0) {
                        row.logs.forEach((log: any) => {
                            existingPending.push({
                                id: `pending_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                                printedName: row.printed || row.newCatalogDraft.name || 'Unknown',
                                suggestedKey: key,
                                date: log.date || new Date().toISOString().split('T')[0],
                                rawValue: log.value,
                                rawUnit: row.newCatalogDraft.unit || row.unit || '',
                                printedRange: row.newCatalogDraft.normalRange || row.printedRange || '',
                                createdAt: Date.now()
                            });
                        });
                    }
                } else if (row.writeTarget === 'observation' && row.key) {
                    // It's a Hit!
                    const key = row.key;
                    
                    if (row.customRangeOverlay) {
                        const existing = updatedCustoms[key] || { name: row.printed, unit: row.unit, normalRange: '', description: '' };
                        updatedCustoms[key] = {
                            ...existing,
                            profileAdjustedNormalRange: row.customRangeOverlay
                        };
                    }
                    
                    if (row.logs && row.logs.length > 0) {
                        row.logs.forEach((log: any) => {
                            let existingLogIndex = currentHistory.findIndex((h: any) => h.date && String(h.date).split('T')[0] === log.date);
                            if (existingLogIndex >= 0) {
                                currentHistory[existingLogIndex].biomarkers[key] = log.value;
                            } else {
                                newLogsToInsert.push({
                                    id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                                    date: log.date,
                                    biomarkers: { [key]: log.value },
                                    note: log.comment || `Extracted ${row.printed}`
                                });
                            }
                        });
                    }
                }
            });
            
            updatedProfile.customBiomarkers = updatedCustoms;
            if (existingPending.length > 0) {
              updatedProfile.pendingObservations = existingPending;
            }
            currentHistory = [...currentHistory, ...newLogsToInsert];
            
            currentHistory
                .filter((b: any) => b.sync_state !== 'delete')
                .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
                .forEach((log) => {
                    Object.entries(log.biomarkers || {}).forEach(([k, v]) => {
                        recomputed[k] = v as string | number;
                    });
                });
                
            setBiomarkers(recomputed);
            setBiomarkerHistory(currentHistory);
            
            await saveAndSync(updatedProfile, foodLogs, recomputed, currentHistory, actions, dailyBenefits, report, {
                type: 'biomarkerLogsBatch',
                targetIds: currentHistory.map((h: any) => h.id)
            });
            
            if (activeJobId) {
                await JobStore.deleteJob(activeJobId);
                setActiveJobId(null);
            }
            // Do NOT close chat, let user see the response.
            // setIsMedicalChatOpen(false);
            setActiveAgentType(null);
            setCalibratingAgentType(null);
            return;
          }

          if ((agentType as string) === 'agent1' || (agentType as string) === 'medical_extract') {
            // A flat Step-1 extraction result always carries its own extractedData.
            // Only defer to the (unrelated) Standardize Biomarkers global batch state
            // when this result clearly isn't a flat extraction — otherwise a stale
            // activeDataReviewBatchIdx from that other feature can hijack a normal
            // extraction commit and silently drop the data.
            const isFlatExtractionResult = !!(agentResult && agentResult.extractedData !== undefined && agentResult.extractedData !== null);
            const batchIdx = agentResult.batchIdx !== undefined && agentResult.batchIdx !== null 
              ? agentResult.batchIdx 
              : (isFlatExtractionResult ? null : activeDataReviewBatchIdx);
            if (batchIdx !== undefined && batchIdx !== null) {
              // This is the batch-by-batch Data Cleaning!
              // Store the raw YAML/JSON returned under agent1_batch_results
              const savedResults = localStorage.getItem('agent1_batch_results');
              let results: any = {};
              try {
                if (savedResults) results = JSON.parse(savedResults);
              } catch (e) {}
              
              const minimalResult = { ...agentResult };
              delete minimalResult.agentPrompt;
              results[batchIdx] = minimalResult;
              try { localStorage.setItem('agent1_batch_results', JSON.stringify(results)); } catch(e){ console.warn("Quota exceeded agent1"); }

              // AUTOMATICALLY APPROVE THE BATCH NOW TO PREVENT DOUBLE CLICK!
              // Parse the cleaned YAML
              const jsonText = agentResult.extractedData || agentResult;
              let parsedRows: any[] = [];
              if (typeof jsonText === 'string' && jsonText.trim() !== '') {
                try {
                  const cleanText = jsonText.replace(/```(?:yaml|json)?/gi, '').trim();
                  const parsed = JSON.parse(cleanText);
                  parsedRows = Array.isArray(parsed) ? parsed : (parsed?.biomarkers || []);
                } catch (e) {
                  console.error("Failed to parse approved agent1 YAML", e);
                }
              } else if (Array.isArray(jsonText)) {
                parsedRows = jsonText;
              }
              const unselected = agentResult.unselectedRowKeys || [];
              if (unselected.length > 0) {
                 parsedRows = parsedRows.filter(row => {
                   const key = String(row.biomarker || row.name || row.key || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
                   return !unselected.includes(key);
                 });
              }

              // Save customBiomarkers to user profile and history
              const updatedCustoms = { ...(updatedProfile.customBiomarkers || {}) };
              let hHistory = biomarkerHistory ? biomarkerHistory.map((h: any) => ({
                ...h,
                biomarkers: { ...h.biomarkers }
              })) : [];

              const deletedKeysToSync: string[] = [];
              // 1. Identify which unstandardized raw keys were mapped to what standardized keys and migrate/delete
              if (agentResult?.batchBiomarkers && Array.isArray(agentResult.batchBiomarkers)) {
                agentResult.batchBiomarkers.forEach((raw: any) => {
                  const rawKey = raw.key;
                  if (!rawKey) return;

                  // Find best matched parsed row in the parsedRows output
                  let bestParsedIdx = -1;
                  let bestScore = -1;
                  parsedRows.forEach((parsed: any, idx: number) => {
                    if (parsed.originalName) {
                      const cleanRawName = raw.name.toLowerCase().replace(/[^a-z0-9]/g, '');
                      const cleanParsedOrigName = parsed.originalName.toLowerCase().replace(/[^a-z0-9]/g, '');
                      if (cleanRawName === cleanParsedOrigName || parsed.originalName === raw.name) {
                        bestParsedIdx = idx;
                      }
                    }
                    if (parsed.originalName) {
                      const cleanRawName = raw.name.toLowerCase().replace(/[^a-z0-9]/g, '');
                      const cleanParsedOrigName = parsed.originalName.toLowerCase().replace(/[^a-z0-9]/g, '');
                      if (cleanRawName === cleanParsedOrigName || parsed.originalName === raw.name) {
                        bestParsedIdx = idx;
                        return;
                      }
                    }
                    const parsedKey = (parsed.key || parsed.biomarker || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
                    const parsedName = (parsed.name || parsed.biomarker || '').toLowerCase();
                    const explanation = (parsed.explanation || parsed.changeReason || parsed.description || '').toLowerCase();
                    
                    let score = 0;
                    const cleanRawKey = rawKey.toLowerCase().replace(/[^a-z0-9]/g, '');
                    const cleanParsedKey = parsedKey.toLowerCase().replace(/[^a-z0-9]/g, '');
                    
                    if (cleanRawKey === cleanParsedKey) {
                      score += 100;
                    } else if (cleanParsedKey.length >= 4 && cleanRawKey.length >= 4 && (cleanRawKey.includes(cleanParsedKey) || cleanParsedKey.includes(cleanRawKey))) {
                      score += 40;
                    }
                    if (explanation.includes(rawKey.toLowerCase())) {
                      score += 80;
                    }
                    if (score > bestScore && score >= 40) {
                      bestScore = score;
                      bestParsedIdx = idx;
                    }
                  });

                  if (bestParsedIdx !== -1) {
                    const parsedRow = parsedRows[bestParsedIdx];
                    const stdKey = (parsedRow.standardizedName || parsedRow.key || parsedRow.name || parsedRow.biomarker || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
                    const action = String(parsedRow.Action || parsedRow.action || '').toLowerCase();
                    
                    if (action.includes('delete')) {
                      hHistory.forEach((log: any) => {
                        if (log.biomarkers && log.biomarkers[rawKey] !== undefined) {
                          delete log.biomarkers[rawKey];
                        }
                      });
                      delete updatedCustoms[rawKey];
                      deletedKeysToSync.push(rawKey);
                    } else if (stdKey && rawKey !== stdKey) {
                      // Migrate existing values from rawKey to stdKey across all historical logs, then delete rawKey
                      hHistory.forEach((log: any) => {
                        if (log.biomarkers && log.biomarkers[rawKey] !== undefined) {
                          const valueToMigrate = log.biomarkers[rawKey];
                          log.biomarkers[stdKey] = valueToMigrate;
                          delete log.biomarkers[rawKey];
                        }
                      });

                      // Delete from customBiomarkers list
                      delete updatedCustoms[rawKey];
                      deletedKeysToSync.push(rawKey);
                    }
                  } else {
                    // No confident match found — leave this key untouched (FIX-7B).
                    // Do NOT delete data that wasn't explicitly handled in this batch's output.
                    console.log(`[Agent Approval] No confident match for raw key "${rawKey}" — skipping deletion.`);
                  }
                });
              }

              // 2. Apply newly cleaned/standardized readings from parsedRows
              parsedRows.forEach((row: any) => {
                const key = row.key || (row.name || row.biomarker || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
                if (!key) return;

                const name = row.name || row.biomarker || 'Unknown';
                const unit = row.metric || row.unit || '';

                // Update customBiomarker definition
                const existing: any = updatedCustoms[key] || {};
                updatedCustoms[key] = {
                  ...existing,
                  name,
                  unit,
                  riskCategories: (existing.riskCategories && existing.riskCategories.length > 0) ? existing.riskCategories : (row.riskCategories || []),
                  standardMedicalGrouping: (existing.standardMedicalGrouping && existing.standardMedicalGrouping !== 'Other') ? existing.standardMedicalGrouping : (row.standardMedicalGrouping || 'Other'),
                  potentialMedicalConditions: row.potentialMedicalConditions || existing.potentialMedicalConditions || []
                } as any;

                // Extract and write the actual numeric or qualitative reading value to hHistory
                const rawVal = row.numeric_value !== undefined && row.numeric_value !== null && row.numeric_value !== ''
                  ? row.numeric_value
                  : (row.value !== undefined ? row.value : row.qualitative_value);
                
                const entryDate = row.date;
                if (!entryDate || typeof entryDate !== 'string') {
                  return; // Skip writing to history without a verified lab report date
                }
                const standardDate = String(entryDate).split('T')[0].trim();

                if (rawVal !== undefined && rawVal !== null && rawVal !== '') {
                  const valNum = Number(rawVal);
                  const finalValue = isNaN(valNum) ? rawVal : valNum;

                  let existingLogIndex = hHistory.findIndex((h: any) => {
                    if (!h.date) return false;
                    return String(h.date).split('T')[0].trim() === standardDate;
                  });

                  if (existingLogIndex >= 0) {
                    hHistory[existingLogIndex].biomarkers[key] = finalValue;
                  } else {
                    hHistory.push({
                      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                      date: standardDate,
                      biomarkers: { [key]: finalValue },
                      note: "Extracted by Clinical Data Parser"
                    });
                  }
                }
              });

              hHistory.sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));

              // Recompute biomarkers list
              const recomputedBiomarkers: { [key: string]: number | string } = {};
              [...hHistory].filter(b => b.sync_state !== 'delete' && !(profile?.deletedBiomarkerLogIds?.[b.id] && (profile?.deletedBiomarkerLogIds?.[b.id] || 0) >= (b.updated_at || 0))).sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date))).forEach(log => {
                Object.entries(log.biomarkers).forEach(([k, v]) => {
                  recomputedBiomarkers[k] = v as string | number;
                });
              });
              
              if (deletedKeysToSync.length > 0) {
                updatedProfile.deletedCustomBiomarkerKeys = { ...(updatedProfile.deletedCustomBiomarkerKeys || {}) };
                deletedKeysToSync.forEach(k => { updatedProfile.deletedCustomBiomarkerKeys![k] = Date.now(); });
              }

              updatedProfile.customBiomarkers = updatedCustoms;
              currentHistory = hHistory;

              // Mark as approved in localStorage
              const savedApproved = localStorage.getItem('approved_agent1_batches');
              let approved: any = {};
              try {
                if (savedApproved) approved = JSON.parse(savedApproved);
              } catch (e) {}
              approved[batchIdx] = true;
              try { localStorage.setItem('approved_agent1_batches', JSON.stringify(approved)); } catch(e){ console.warn("Quota exceeded approved_agent1"); }

              // Update React States
              setBiomarkers(recomputedBiomarkers);
            } else {
              updatedProfile.agentTriageSummary = "Data extraction completed.";
              
              // Parse extractedData and merge into biomarkerHistory
              const jsonText = agentResult.extractedData || agentResult;
              const entries: any[] = [];
              const isString = typeof jsonText === 'string';

              if (isString) {
                try {
                  const cleanedText = (jsonText as string).replace(/```(?:yaml|yml)?/gi, '').trim();
                  const parsed = JSON.parse(cleanedText);
                  const rawList = Array.isArray(parsed) 
                    ? parsed 
                    : (parsed?.biomarkers || parsed?.entries || parsed?.data || []);
                  if (Array.isArray(rawList)) {
                    rawList.forEach((item: any) => {
                      if (item && typeof item === 'object') {
                        const bName = item.biomarker || item.name || item.key;
                        const bDate = item.date || item.timestamp;
                        const bVal = (item.numeric_value !== undefined && item.numeric_value !== null)
                          ? item.numeric_value
                          : (item.qualitative_value !== undefined && item.qualitative_value !== null)
                            ? item.qualitative_value
                            : (item.value !== undefined ? item.value : item.val);
                        if (bName && bDate && bVal !== undefined && bVal !== null && bVal !== '') {
                          entries.push({
                            biomarker: String(bName),
                            displayName: item.display_name ? String(item.display_name) : '',
                            date: String(bDate),
                            value: isNaN(Number(bVal)) ? bVal : parseFloat(String(bVal)),
                            unit: item.unit ? String(item.unit) : '',
                            referenceRange: item.referenceRange || item.range || ''
                          });
                        }
                      }
                    });
                  }
                } catch (e) {
                  console.warn("Standard YAML parser in App.tsx failed, falling back to regex", e);
                }

                if (entries.length === 0) {
                  const lines = (jsonText as string).split('\n');
                  let currentEntry: any = {};
                  
                  for (let line of lines) {
                    line = line.trim();
                    if (line.startsWith('-') || line.startsWith('biomarker:')) {
                      if (currentEntry.biomarker) entries.push(currentEntry);
                      currentEntry = {};
                    }
                    const bioMatch = line.match(/(?:-\s+)?biomarker:\s*(.*)/i);
                    if (bioMatch) { currentEntry.biomarker = bioMatch[1].replace(/['"]/g, '').trim(); continue; }
                    const dateMatch = line.match(/date:\s*([\d-]+)/i);
                    if (dateMatch) { currentEntry.date = dateMatch[1].trim(); continue; }
                    const valMatch = line.match(/value:\s*(.*)/i);
                    if (valMatch) { 
                      const rawVal = valMatch[1].replace(/['"]/g, '').trim(); 
                      currentEntry.value = isNaN(Number(rawVal)) ? rawVal : parseFloat(rawVal);
                      continue; 
                    }
                    const unitMatch = line.match(/unit:\s*(.*)/i);
                    if (unitMatch) { currentEntry.unit = unitMatch[1].replace(/['"]/g, '').trim(); continue; }
                    const refMatch = line.match(/referenceRange:\s*(.*)/i);
                    if (refMatch) { currentEntry.referenceRange = refMatch[1].replace(/['"]/g, '').trim(); continue; }
                  }
                  if (currentEntry.biomarker) entries.push(currentEntry);
                }
              } else if (Array.isArray(jsonText)) {
                jsonText.forEach((item: any) => {
                  if (item && typeof item === 'object') {
                    const bName = item.biomarker || item.name || item.key;
                    const bDate = item.date || item.timestamp;
                    const bVal = item.value !== undefined ? item.value : (item.val !== undefined ? item.val : item.numeric_value);
                    if (bName && bDate) {
                      entries.push({
                        biomarker: String(bName),
                        displayName: item.display_name ? String(item.display_name) : '',
                        date: String(bDate),
                        value: isNaN(Number(bVal)) ? bVal : parseFloat(String(bVal)),
                        unit: (item.unit || item.metric) ? String(item.unit || item.metric) : '',
                        referenceRange: item.referenceRange || item.range || item.normalRange || ''
                      });
                    }
                  }
                });
              } else if (jsonText && typeof jsonText === 'object') {
                const possibleArray = jsonText.extractedBiomarkers || jsonText.biomarkers || jsonText.entries || jsonText.extracted || jsonText.data || jsonText.metrics || jsonText.results || jsonText.calibratedBiomarkers;
                let listToUse: any[] = [];
                if (Array.isArray(possibleArray)) {
                  listToUse = possibleArray;
                } else {
                  const arrays = Object.values(jsonText).filter(v => Array.isArray(v));
                  if (arrays.length > 0) {
                    listToUse = arrays[0] as any[];
                  }
                }
                listToUse.forEach((item: any) => {
                  if (item && typeof item === 'object') {
                    const bName = item.biomarker || item.name || item.key;
                    const bDate = item.date || item.timestamp;
                    const bVal = item.value !== undefined ? item.value : (item.val !== undefined ? item.val : item.numeric_value);
                    if (bName && bDate) {
                      entries.push({
                        biomarker: String(bName),
                        displayName: item.display_name ? String(item.display_name) : '',
                        date: String(bDate),
                        value: isNaN(Number(bVal)) ? bVal : parseFloat(String(bVal)),
                        unit: (item.unit || item.metric) ? String(item.unit || item.metric) : '',
                        referenceRange: item.referenceRange || item.range || item.normalRange || ''
                      });
                    }
                  }
                });
              }

              // Filter out any unselected entries, and any flagged "Not Used" in either store, to respect user selections
              const unselected = agentResult.unselectedRowKeys || [];
              const scopeKeys = Array.isArray(agentResult.scopeKeys) ? agentResult.scopeKeys : null;
              const isFlaggedNotUsed = (key1: string, key2: string): boolean => {
                const maps = [profile?.notUsedBiomarkers, profile?.notUsedInMedicalHistory];
                return maps.some(m => !!m && (!!m[key1] || !!m[key2] || Object.keys(m).some(nok => nok.toLowerCase() === key1)));
              };
              const seenEntryKeys = new Set<string>();
              const filteredEntries = entries.filter(entry => {
                const key1 = String(entry.biomarker || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
                const key2 = String(entry.biomarker || '').toLowerCase().trim();
                if (unselected.includes(key1) || unselected.includes(key2)) return false;
                if (isFlaggedNotUsed(key1, key2)) return false;
                if (scopeKeys && !scopeKeys.includes(key1) && !scopeKeys.includes(key2)) return false;
                
                // Exact-match deduplication on (biomarker, date, value)
                const dKey = String(entry.date || '').split('T')[0].trim();
                const valKey = String(entry.value ?? '');
                const dedupeKey = `${key1}|${dKey}|${valKey}`;
                if (seenEntryKeys.has(dedupeKey)) return false;
                seenEntryKeys.add(dedupeKey);
                return true;
              });
              
              filteredEntries.forEach(entry => {
                const rawSlug = String(entry.biomarker || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
                const bioName = getMappedBiomarkerKey(rawSlug) || rawSlug;
                const isBuiltIn = biomarkerDefinitions.some((d) => d.key === bioName);
                let finalValue = entry.value;
                let finalUnit = (entry.unit || '').replace(/µ/g, 'u').trim();
                let finalRange = (entry.referenceRange || '').replace(/µ/g, 'u');

                // Sanitize dimensionless units
                if (/^(n\/a|na|-|--|nil|none)$/i.test(finalUnit)) {
                  finalUnit = '';
                }

                // Guard AUDIT-C score unit bleed
                if (bioName === 'audit_c_total_score' || bioName.startsWith('audit_') || bioName.endsWith('_score')) {
                  if (/mmhg/i.test(finalUnit)) {
                    finalUnit = 'score';
                  }
                }

                // No math middleware: raw values only
                const standardDate = String(entry.date).split('T')[0].trim();

                const matchDate = (d1: string, d2: string) => {
                  if (!d1 || !d2) return false;
                  return String(d1).split('T')[0].trim() === String(d2).split('T')[0].trim();
                };

                let existingLogIndex = currentHistory.findIndex(h => matchDate(h.date, standardDate));
                if (existingLogIndex >= 0) {
                  currentHistory[existingLogIndex].biomarkers[bioName] = finalValue;
                  attachObservationMeta(currentHistory[existingLogIndex], bioName, {
                    unit: finalUnit,
                    printedRange: finalRange,
                    rawValue: finalValue,
                  });
                  // If composite blood pressure, also store separate systolic & diastolic
                  if (bioName === 'blood_pressure' && typeof finalValue === 'string') {
                    const bpMatch = finalValue.match(/(\d+)\s*\/\s*(\d+)/);
                    if (bpMatch) {
                      const s = parseInt(bpMatch[1], 10);
                      const d = parseInt(bpMatch[2], 10);
                      currentHistory[existingLogIndex].biomarkers['systolic_blood_pressure'] = s;
                      attachObservationMeta(currentHistory[existingLogIndex], 'systolic_blood_pressure', { unit: 'mmHg', rawValue: s, printedRange: '< 120' });
                      currentHistory[existingLogIndex].biomarkers['diastolic_blood_pressure'] = d;
                      attachObservationMeta(currentHistory[existingLogIndex], 'diastolic_blood_pressure', { unit: 'mmHg', rawValue: d, printedRange: '< 80' });
                    }
                  }
                } else {
                  const newLog: any = {
                    id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                    date: standardDate,
                    biomarkers: { [bioName]: finalValue },
                    note: "Extracted by Clinical Data Parser"
                  };
                  attachObservationMeta(newLog, bioName, {
                    unit: finalUnit,
                    printedRange: finalRange,
                    rawValue: finalValue,
                  });
                  if (bioName === 'blood_pressure' && typeof finalValue === 'string') {
                    const bpMatch = finalValue.match(/(\d+)\s*\/\s*(\d+)/);
                    if (bpMatch) {
                      const s = parseInt(bpMatch[1], 10);
                      const d = parseInt(bpMatch[2], 10);
                      newLog.biomarkers['systolic_blood_pressure'] = s;
                      attachObservationMeta(newLog, 'systolic_blood_pressure', { unit: 'mmHg', rawValue: s, printedRange: '< 120' });
                      newLog.biomarkers['diastolic_blood_pressure'] = d;
                      attachObservationMeta(newLog, 'diastolic_blood_pressure', { unit: 'mmHg', rawValue: d, printedRange: '< 80' });
                    }
                  }
                  currentHistory.push(newLog);
                }
                
                if (!updatedProfile.customBiomarkers) updatedProfile.customBiomarkers = {};
                const mapping = agentResult?.bucketMapping;
                let mapData = null;
                if (mapping && typeof mapping === 'object') {
                  const matchKey = Object.keys(mapping).find(k => 
                    k.toLowerCase() === bioName.toLowerCase() || 
                    k.toLowerCase() === entry.biomarker.toLowerCase() ||
                    k.toLowerCase().replace(/[^a-z0-9]/g, '_') === bioName
                  );
                  if (matchKey) {
                    mapData = mapping[matchKey];
                  }
                }

                if (!updatedProfile.customBiomarkers[bioName]) {
                  // Built-in / alias-mapped keys already live in the catalog. Do not invent
                  // a custom overlay (or a pending-approval row) for every extracted line.
                  if (!isBuiltIn) {
                    // B7.4: unknown names route to the Pending store, never catalog keys.
                    updatedProfile.pendingObservations = pushPendingObservation(updatedProfile.pendingObservations, {
                      printedName: entry.displayName || entry.biomarker,
                      suggestedKey: bioName,
                      date: standardDate,
                      rawValue: finalValue,
                      rawUnit: finalUnit,
                      printedRange: finalRange,
                    });
                  } else if (shouldRunCalibrator(bioName, updatedProfile)) {
                    updatedProfile.customBiomarkers[bioName] = {
                      name: entry.displayName || entry.biomarker,
                      catalogApproved: true,
                      calibrationDue: true,
                    } as any;
                  }
                } else {
                  // Upgrade a previously-registered raw-key name to a proper display name once one arrives,
                  // but never overwrite a name that's already something other than the raw key (e.g. user-edited).
                  const currentName = updatedProfile.customBiomarkers[bioName].name;
                  if (entry.displayName && (!currentName || currentName === bioName || currentName === entry.biomarker)) {
                    updatedProfile.customBiomarkers[bioName].name = entry.displayName;
                  }
                  if (finalUnit && !updatedProfile.customBiomarkers[bioName].unit) {
                    updatedProfile.customBiomarkers[bioName].unit = finalUnit;
                  }
                  if (finalRange && (!updatedProfile.customBiomarkers[bioName].normalRange || updatedProfile.customBiomarkers[bioName].normalRange === 'Unknown')) {
                    updatedProfile.customBiomarkers[bioName].normalRange = finalRange;
                  }
                  if (mapData) {
                    if (mapData.riskCategories) updatedProfile.customBiomarkers[bioName].riskCategories = mapData.riskCategories;
                    if (mapData.standardMedicalGrouping) updatedProfile.customBiomarkers[bioName].standardMedicalGrouping = mapData.standardMedicalGrouping;
                    if (mapData.potentialMedicalConditions) updatedProfile.customBiomarkers[bioName].potentialMedicalConditions = mapData.potentialMedicalConditions;
                  }
                }
              });
              
              currentHistory.sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));
              setBiomarkerHistory(currentHistory);
              
              const recomputedBiomarkers: { [key: string]: number | string } = {};
              [...currentHistory].filter(b => b.sync_state !== 'delete' && !(profile?.deletedBiomarkerLogIds?.[b.id] && (profile?.deletedBiomarkerLogIds?.[b.id] || 0) >= (b.updated_at || 0))).sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date))).forEach(log => {
                Object.entries(log.biomarkers).forEach(([k, v]) => {
                  recomputedBiomarkers[k] = v as string | number;
                });
              });
              setBiomarkers(recomputedBiomarkers);
            }
          } else if (agentType === 'agent2') {
             // Agent 2: Clinical Ontologist (Mapping)
             updatedProfile.agentTriageSummary = "Biomarker categories mapped.";
             const mapping = agentResult.bucketMapping || agentResult;
             if (mapping && typeof mapping === 'object') {
               if (!updatedProfile.customBiomarkers) updatedProfile.customBiomarkers = {};
               Object.entries(mapping).forEach(([bioName, mapData]: [string, any]) => {
                 const key = bioName.toLowerCase().replace(/[^a-z0-9]/g, '_');
                 const existingDef = updatedProfile.customBiomarkers![key] || {
                   name: bioName, unit: '', normalRange: 'Unknown', description: ''
                 };
                 updatedProfile.customBiomarkers![key] = {
                   ...existingDef,
                   riskCategories: mapData.riskCategories || existingDef.riskCategories,
                   standardMedicalGrouping: mapData.standardMedicalGrouping || existingDef.standardMedicalGrouping,
                   potentialMedicalConditions: mapData.potentialMedicalConditions || existingDef.potentialMedicalConditions
                 };
               });
             }
          } else if (agentType === 'agent3') {
             // Agent 3: Clinical Data Coordinator (Assembly)
             updatedProfile.agentTriageSummary = agentResult.text || "Data assembled into buckets.";
          } else if (agentType === 'agent4') {
            const sumVal = agentResult.summary || agentResult.primaryDiagnosis || agentResult.text;
            updatedProfile.agentDiagnosticSummary = typeof sumVal === 'string'
              ? sumVal
              : (sumVal?.primaryDiagnosis || sumVal?.summary || (sumVal ? JSON.stringify(sumVal) : 'Health planning audit complete.'));
            updatedProfile.agent2TimelineProjections = agentResult.timelineProjections || (typeof agentResult.summary === 'object' ? agentResult.summary?.timelineProjections : undefined);
            const gaps = Array.isArray(agentResult.testingGaps) ? agentResult.testingGaps : agentResult.recommendedTests;
            updatedProfile.agent2GapTasks = Array.isArray(gaps) ? gaps.map((t: any) => `${t.testName || t.name || 'Test'}: ${t.reason || ''}`) : undefined;
            const newAcceptedActions = extraActions || agentResult?.acceptedActions;
            if (Array.isArray(newAcceptedActions)) {
              currentActions = [...newAcceptedActions];
              setActions(currentActions);
            }
          } else if (agentType === 'agent5') {
            updatedProfile.agentContextualizerSummary = agentResult.message;
          } else if (agentType === 'agent7') {
            updatedProfile.agentLiteratureSummary = agentResult.message;
          } else if (agentType === 'data_review') {
            const batchIdx = agentResult.batchIdx !== undefined && agentResult.batchIdx !== null ? agentResult.batchIdx : activeDataReviewBatchIdx;
            if (batchIdx !== undefined && batchIdx !== null) {
              setCalibratingBatchIdx(Number(batchIdx));
            }
            setIsMedicalChatOpen(false);

            const updatedCustoms = { ...(updatedProfile.customBiomarkers || {}) };
            
            if (agentResult.reviewedBiomarkers && Array.isArray(agentResult.reviewedBiomarkers)) {
              agentResult.reviewedBiomarkers.forEach((bm: any) => {
                const existing = (updatedCustoms[bm.key] || {}) as any;
                const optVal = formatOptimalTargetValue(bm);

                updatedCustoms[bm.key] = {
                  ...existing,
                  name: bm.name || existing.name,
                  unit: existing.unit || bm.unit,
                  optimalValue: optVal,
                  normalRange: existing.normalRange || '',
                  profileAdjustedNormalRange: bm.profileAdjustedNormalRange || existing.profileAdjustedNormalRange || '',
                  description: bm.description || existing.description || '',
                  riskCategories: (existing.riskCategories && existing.riskCategories.length > 0) ? existing.riskCategories : (bm.riskCategories || []),
                  standardMedicalGrouping: (existing.standardMedicalGrouping && existing.standardMedicalGrouping !== 'Other') ? existing.standardMedicalGrouping : (bm.standardMedicalGrouping || 'Other'),
                  potentialMedicalConditions: bm.potentialMedicalConditions || existing.potentialMedicalConditions || [],
                  specificRiskContext: bm.specificRiskContext || existing.specificRiskContext || '',
                  status: bm.status || existing.status || 'Healthy',
                  rangeBrackets: bm.rangeBrackets || existing.rangeBrackets || [],
                  overlayFingerprint: overlayFingerprint(updatedProfile),
                } as any;
                // Overlay only — Review is the sole number writer.
              });

              // Recompute current biomarkers state based on history
              const recomputedBiomarkers: { [key: string]: number | string } = {};
              [...currentHistory]
                .filter(b => b.sync_state !== 'delete' && !(profile?.deletedBiomarkerLogIds?.[b.id] && (profile?.deletedBiomarkerLogIds?.[b.id] || 0) >= (b.updated_at || 0)))
                .sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date)))
                .forEach(log => {
                  Object.entries(log.biomarkers).forEach(([k, v]) => {
                    recomputedBiomarkers[k] = v as string | number;
                  });
                });
              setBiomarkers(recomputedBiomarkers);
            }
            
            updatedProfile.customBiomarkers = updatedCustoms;
            
            if (batchIdx !== undefined && batchIdx !== null) {
              const saved = localStorage.getItem('approved_data_review_batches');
              let approved: any = {};
              try {
                if (saved) approved = JSON.parse(saved);
              } catch (e) {}
              approved[batchIdx] = true;
              try { localStorage.setItem('approved_data_review_batches', JSON.stringify(approved)); } catch(e){ console.warn("Quota exceeded approved_data"); }
              
              // Also store the analysis result so the InsightsTab can display the result immediately!
              const savedResults = localStorage.getItem('batch_analysis_results');
              let results: any = {};
              try {
                if (savedResults) results = JSON.parse(savedResults);
              } catch (e) {}
              const minimalResult = { ...agentResult };
              delete minimalResult.agentPrompt;
              results[batchIdx] = minimalResult;
              try { localStorage.setItem('batch_analysis_results', JSON.stringify(results)); } catch(e){ console.warn("Quota exceeded batch_analysis"); }

              // Perform missing biomarker movement if any keys are marked to move
              try {
                const keysToMoveSaved = localStorage.getItem(`batch_${batchIdx}_missing_keys_to_move`);
                if (keysToMoveSaved) {
                  const keysToMove: string[] = JSON.parse(keysToMoveSaved);
                  if (Array.isArray(keysToMove) && keysToMove.length > 0) {
                    const batchesSaved = localStorage.getItem('biomarker_batches_custom');
                    if (batchesSaved) {
                      let currentBatches: string[][] = JSON.parse(batchesSaved);
                      const sizeSaved = localStorage.getItem('biomarker_batch_size');
                      const batchSizeNum = sizeSaved ? Number(sizeSaved) : 20;

                      keysToMove.forEach(key => {
                        // Remove from current batch
                        if (currentBatches[batchIdx]) {
                          currentBatches[batchIdx] = currentBatches[batchIdx].filter(k => k !== key);
                        }

                        // Place in first subsequent unapproved/uncalibrated batch with space
                        let placed = false;
                        for (let i = batchIdx + 1; i < currentBatches.length; i++) {
                          if (!approved[i] && !results[i] && currentBatches[i].length < batchSizeNum) {
                            currentBatches[i].push(key);
                            placed = true;
                            break;
                          }
                        }

                        if (!placed) {
                          for (let i = batchIdx + 1; i < currentBatches.length; i++) {
                            if (!approved[i] && !results[i]) {
                              currentBatches[i].push(key);
                              placed = true;
                              break;
                            }
                          }
                        }

                        if (!placed) {
                          currentBatches.push([key]);
                        }
                      });

                      // Clean up empty batches
                      currentBatches = currentBatches.filter((batch, idx) => 
                        batch.length > 0 || idx === 0 || approved[idx] || results[idx]
                      );

                      localStorage.setItem('biomarker_batches_custom', JSON.stringify(currentBatches));
                    }
                  }
                  // Clear the missing keys list for this batch since they are now moved
                  localStorage.removeItem(`batch_${batchIdx}_missing_keys_to_move`);
                }
              } catch (e) {
                console.error("Error moving missing biomarkers on clinical calibration finish:", e);
              }
            }
          } else if (agentType === 'health_baseline') {
             setIsMedicalChatOpen(false);
             const data = agentResult?.report || agentResult || {};
             const unselected = new Set(agentResult.unselectedRowKeys || []);
             const riskCategories = Array.isArray(data.riskCategories) ? data.riskCategories : [];
             const acceptedCategories = riskCategories.filter((_: any, idx: number) => !unselected.has(idx));
             
             const globalNutrientTargets = Array.isArray(data.nutrientTargets) ? data.nutrientTargets : (Array.isArray(data.topNutrientTargets) ? data.topNutrientTargets : []);
             const globalDailyActivities = Array.isArray(data.dailyActivities) ? data.dailyActivities : [];
             const generalNutrientTargets = data.generalNutrientTargets || {};

             if (!currentReport) {
               currentReport = {
                 timestamp: new Date().toISOString(),
                 dailyNutrientTargets: {},
                 mostImportantNextStep: '',
                 actions: [],
                 dailyBenefits: [],
                 latestInsights: [],
                 healthRiskForecast: { year5: '', year10: '', year20: '', optimized5: '', optimized10: '', optimized20: '' }
               };
             }

             let newDailyNutrientTargets = { ...(currentReport.dailyNutrientTargets || {}) };

             Object.entries(generalNutrientTargets).forEach(([key, val]) => {
               newDailyNutrientTargets[key] = String(val);
             });

             // Extract justified nutrient keys and activities from accepted categories
             const justifiedNutrientKeys = new Set();
             const justifiedActivities = new Set();

             acceptedCategories.forEach((cat) => {
               if (Array.isArray(cat.nutrientTargets)) {
                 cat.nutrientTargets.forEach((nt) => {
                   if (nt.nutrientKey) {
                     justifiedNutrientKeys.add(nt.nutrientKey.toLowerCase().trim());
                   }
                 });
               }
               if (Array.isArray(cat.dailyActivities)) {
                 cat.dailyActivities.forEach((da) => {
                   if (da.activity) {
                     justifiedActivities.add(da.activity.toLowerCase().trim());
                   }
                 });
               }
             });

             globalNutrientTargets.forEach((nt: any) => {
               if (nt.nutrientKey && nt.targetValue) {
                 newDailyNutrientTargets[nt.nutrientKey] = nt.targetValue;
               }
             });

             globalDailyActivities.forEach((da: any) => {
               if (da.activity && da.target && justifiedActivities.has(da.activity.toLowerCase().trim())) {
                 const isStepActivity = /\bsteps?\b/i.test(da.activity) || /\bwalk(ing)?\b/i.test(da.activity);
                 if (isStepActivity) {
                   const stepsMatch = String(da.target).match(/[\d,]+/);
                   if (stepsMatch) {
                     newDailyNutrientTargets.steps = stepsMatch[0].replace(/,/g, '');
                   }
                 } else {
                   currentDailyBenefits.push({
                     id: `db_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                     activity: da.activity,
                     target: da.target,
                     completed: false
                   });
                 }
               }
             });

             acceptedCategories.forEach((cat: any) => {
               if (Array.isArray(cat.nutrientTargets)) {
                 cat.nutrientTargets.forEach((nt: any) => {
                   if (nt.nutrientKey && nt.targetValue) {
                     newDailyNutrientTargets[nt.nutrientKey] = nt.targetValue;
                   }
                 });
               }
               if (Array.isArray(cat.dailyActivities)) {
                 cat.dailyActivities.forEach((da: any) => {
                   if (da.activity && da.target) {
                     const isStepActivity = /\bsteps?\b/i.test(da.activity) || /\bwalk(ing)?\b/i.test(da.activity);
                     if (isStepActivity) {
                       const stepsMatch = String(da.target).match(/[\d,]+/);
                       if (stepsMatch) {
                         newDailyNutrientTargets.steps = stepsMatch[0].replace(/,/g, '');
                       }
                     } else {
                       currentDailyBenefits.push({
                         id: `db_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                         activity: da.activity,
                         target: da.target,
                         completed: false
                       });
                     }
                   }
                 });
               }
             });

             currentReport.dailyNutrientTargets = newDailyNutrientTargets;

             const recommendedKeysSet = new Set<string>();
             if (Array.isArray(data.topNutrientTargets)) {
               data.topNutrientTargets.forEach((nt: any) => {
                 const k = typeof nt === 'string' ? nt : (nt?.nutrientKey || nt?.key);
                 if (k) recommendedKeysSet.add(k);
               });
             }
             const rawWeeklyData = data.topWeeklyNutrientTargets || data.weeklyNutrientTargets;
             if (Array.isArray(rawWeeklyData)) {
               rawWeeklyData.forEach((nt: any) => {
                 const k = typeof nt === 'string' ? nt : (nt?.nutrientKey || nt?.key);
                 if (k) recommendedKeysSet.add(k);
               });
             } else if (typeof rawWeeklyData === 'object' && rawWeeklyData !== null) {
               Object.keys(rawWeeklyData).forEach(k => recommendedKeysSet.add(k));
             }
             acceptedCategories.forEach((cat: any) => {
               if (Array.isArray(cat.nutrientTargets)) {
                 cat.nutrientTargets.forEach((nt: any) => {
                   const k = nt?.nutrientKey || nt?.key;
                   if (k) recommendedKeysSet.add(k);
                 });
               }
             });

             const topCoreKeys = Array.from(recommendedKeysSet).filter(isCoreNutrient);
             const topWeeklyKeys = Array.from(recommendedKeysSet).filter(isAdditionalNutrient);

             currentReport.topNutrientTargets = topCoreKeys;
             currentReport.topWeeklyNutrientTargets = topWeeklyKeys;

             if (currentReport.topNutrientTargets.length > 0) {
               updatedProfile.topNutrientsToMonitor = currentReport.topNutrientTargets;
             }
             currentReport.generalNutrientTargets = data.generalNutrientTargets;
             currentReport.nutrientRankingRationale = data.nutrientRankingRationale;
             currentReport.healthBaselineCategories = acceptedCategories;
             
             setReport(currentReport);
             setDailyBenefits(currentDailyBenefits);
          }
          
          setProfile(updatedProfile);
          try {
            // Auto-approve the step if it's one of the main agent types
            const searchType = (agentType as string) === 'medical_extract' ? 'agent1' : agentType;
            const latestAnalysis = (updatedProfile.agentAnalyses || [])
              .filter(a => a.agentType === searchType || (searchType === 'agent1' && a.agentType === 'medical_extract'))
              .sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)))[0];
            
            if (latestAnalysis) {
              try {
                const savedIds = localStorage.getItem('approvedAnalysisIds');
                let approvedIds: any = {};
                if (savedIds) approvedIds = JSON.parse(savedIds);
                approvedIds[searchType] = latestAnalysis.id;
                localStorage.setItem('approvedAnalysisIds', JSON.stringify(approvedIds));
              } catch (e) {
                console.warn("Failed to auto-approve analysis in localStorage", e);
              }
            }

            await saveAndSync(updatedProfile, foodLogs, biomarkers, currentHistory, currentActions, currentDailyBenefits, currentReport || report);
          } finally {
            setCalibratingBatchIdx(null);
            setCalibratingAgentType(null);
            
            const isBatch = agentType === 'data_review';
            if (isBatch) {
              const batchIdx = agentResult?.batchIdx !== undefined && agentResult?.batchIdx !== null 
                ? agentResult.batchIdx 
                : activeDataReviewBatchIdx;
              if (batchIdx !== undefined && batchIdx !== null) {
                setTimeout(() => {
                  const element = document.getElementById(`batch-card-${batchIdx}`);
                  if (element) {
                    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }
                }, 150);
              }
            } else {
              const getStepIndexForAgent = (aType: string) => {
                if (aType === 'agent1' || aType === 'medical_extract') return 1;
                if (aType === 'data_review') return 2;
                if (aType === 'health_baseline') return 3;
                if (aType === 'agent4') return 4;
                if (aType === 'agent7') return 5;
                return -1;
              };
              const stepIdx = getStepIndexForAgent(agentType);
              if (stepIdx !== -1) {
                setTimeout(() => {
                  const element = document.getElementById(`accordion-step-${stepIdx}`);
                  if (element) {
                    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }
                }, 150);
              }
            }
          }
        }}
      />}</ErrorBoundary>
      </React.Suspense>

 

      {/* Snapshot/Undo Panel */}
      {showSnapshotPanel && (
        <div className="fixed inset-0 z-[200] flex items-end justify-center bg-black/50" onClick={() => setShowSnapshotPanel(false)}>
          <div className="bg-theme-bg-card rounded-t-2xl w-full max-w-lg p-5 pb-8 shadow-2xl animate-slide-up" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-theme-text flex items-center gap-2">
                <span>🕐</span> Restore a Snapshot
              </h2>
              <button onClick={() => setShowSnapshotPanel(false)} className="text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
            </div>
            <p className="text-[12px] text-slate-500 mb-4 bg-slate-100 dark:bg-slate-800 p-2 rounded">
              💡 Note: Image data is not included in undo snapshots to save space. 
              Images will need to be re-attached if you undo a food log.
            </p>
            {snapshots.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-6">No snapshots yet. Snapshots are created automatically before each agent approval.</p>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {snapshots.map((snap: any) => (
                  <div key={snap.id} className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/50 border border-theme-border rounded-xl px-4 py-3">
                    <div>
                      <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">{snap.label}</p>
                      <p className="text-[10px] text-slate-400">{new Date(snap.timestamp).toLocaleString()}</p>
                      <p className="text-[10px] text-slate-400 mt-1">
                        {snap.data?.biomarkerHistory?.length ?? 0} biomarker logs · {snap.data?.foodLogs?.length ?? 0} food logs
                      </p>
                    </div>
                    <div className="flex gap-2 ml-4">
                      <button
                        onClick={() => handleRestoreSnapshot(snap)}
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer"
                      >
                        Restore
                      </button>
                      <button
                        onClick={async () => {
                          await deleteLocalSnapshot(profile?.email, snap.id);
                          setSnapshots(await loadLocalSnapshots(profile?.email));
                        }}
                        className="px-3 py-1.5 bg-red-50 hover:bg-red-100 dark:bg-red-950/30 text-red-600 dark:text-red-400 text-xs font-bold rounded-lg transition-colors cursor-pointer"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[10px] text-slate-400 text-center mt-4">Snapshots are stored locally on this device only. Up to 5 are kept.</p>
          </div>
        </div>
      )}

    </>
  );
}
