import React from 'react';
import { lazyWithRetry } from '../utils/lazyWithRetry';
import { ErrorBoundary } from './ErrorBoundary';
import { Activity, Sparkles } from 'lucide-react';
import { translations } from '../utils/translations';
import { hasBmiPendingAlert } from '../utils/biomarkers';
import { maybeRecalibrateDemographicOverlays } from '../utils/appProfileUtils';
import { resolveAgentDestination } from '../utils/biomarkerLifecycle';
import type { SanitizeProposal } from '../utils/dataSanitize';
import type { AppViewProps } from './AppViewProps';

const HomeTab = lazyWithRetry(() => import('./HomeTab'));
const InsightsTab = lazyWithRetry(() => import('./InsightsTab'));
const FoodHistoryTab = lazyWithRetry(() => import('./FoodHistoryTab'));
const MedicalHistoryTab = lazyWithRetry(() => import('./MedicalHistoryTab'));
const TrendsTab = lazyWithRetry(() => import('./TrendsTab'));

export default function AppTabs(p: AppViewProps) {
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
    onReviewMeal,
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
        {activeTab === 'home' && (
          <HomeTab
            profile={profile}
            foodLogs={foodLogs}
            biomarkers={biomarkers}
            biomarkerHistory={biomarkerHistory}
            actions={actions}
            onViewJob={handleOpenJob}
            onLogFood={handleLogFood}
            isLoadingProfile={isInitialDataLoading || syncState === 'syncing'}
            syncState={syncState}
            setActions={async (act) => {
              setActions(act);
              await saveAndSync(profile, foodLogs, biomarkers, biomarkerHistory, act, dailyBenefits, report, { type: 'actions' });
            }}
            dailyBenefits={dailyBenefits}
            setDailyBenefits={async (ben) => {
              const deleted = dailyBenefits.filter(old => !ben.some(n => n.id === old.id));
              let updatedProfile = { ...profile };
              if (deleted.length > 0) {
                updatedProfile = { ...profile, deletedDailyBenefitIds: { ...(profile.deletedDailyBenefitIds || {}) } };
                deleted.forEach(d => { updatedProfile.deletedDailyBenefitIds![d.id] = Date.now(); });
                setProfile(updatedProfile);
              }
              setDailyBenefits(ben);
              await saveAndSync(updatedProfile, foodLogs, biomarkers, biomarkerHistory, actions, ben, report, { type: 'dailyBenefits' });
            }}
            foodIdeas={foodIdeas}
            setFoodIdeas={async (ideas) => {
              setFoodIdeas(ideas);
              await saveAndSync(profile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'foodIdeas' }, ideas);
            }}
            report={report}
            onNavigateToTab={setActiveTab}
            onEditBiomarkerLog={handleEditBiomarkerLog}
            onDeleteBiomarkerLog={handleDeleteBiomarkerLog}
            onDeleteBiomarkerFromLog={handleDeleteBiomarkerFromLog}
            onBatchDeleteBiomarkersFromLogs={handleBatchDeleteBiomarkersFromLogs}
            onBatchEditBiomarkersInLogs={handleBatchEditBiomarkersInLogs}
            onLogMedical={handleLogMedical}
            onOpenAgentChat={(agentType, options) => {
              setActiveAgentType(agentType);
              setPrefillMessage(options?.prefillMessage || null);
              setActiveReviewBiomarkerKey(options?.biomarkerKey);
              if (options?.dataReviewBatchIdx !== undefined) setActiveDataReviewBatchIdx(options.dataReviewBatchIdx);
              if (options?.dataReviewBatchKeys) setActiveDataReviewBatchKeys(options.dataReviewBatchKeys);
              setIsMedicalChatOpen(true);
            }}
            hideSensitive={hideSensitive}
            selectedModelId={selectedModelId}
            onChangeModelId={setSelectedModelId}
            hasBmiAlert={profile ? hasBmiPendingAlert(profile, dismissedBmiAlerts, report) : false}
            onDismissBmiAlert={handleDismissBmiAlert}
            onApplyCalculation={handleApplyCalculation}
            onUpdateReport={async (updatedReport) => {
              setReport(updatedReport);
              await saveAndSync(profile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, updatedReport, { type: 'report' });
            }}
          />
        )}
        {activeTab === 'food' && (
          <ErrorBoundary>
          <FoodHistoryTab
            profile={profile}
            foodLogs={foodLogs}
            totalFoodsCount={totalFoodsCount}
            onFetchMoreFoods={handleFetchMoreFoods}
            onUpdateFoodLog={handleUpdateFoodLog}
            onDeleteFoodLog={handleDeleteFoodLog}
            onReplaceFoodLogs={async (foods) => {
              setFoodLogs(foods);
              await saveAndSync(profile, foods, biomarkers, biomarkerHistory, actions, dailyBenefits, report, {
                type: 'food',
              } as any);
            }}
            onLogFood={handleLogFood}
            onReviewMeal={onReviewMeal}
            onEditingActiveChange={setIsEditingFoodLog}
            isManualEntryOpen={isManualFoodLogOpen}
            onManualEntryOpenChange={setIsManualFoodLogOpen}
            manualEntryAlert={manualFoodLogError}
            onClearManualEntryAlert={() => setManualFoodLogError(null)}
            report={report}
            initiallyExpandedFoodId={initiallyExpandedFoodId}
            onClearInitiallyExpandedFoodId={() => setInitiallyExpandedFoodId(null)}
            onViewJob={handleOpenJob}
          />
          </ErrorBoundary>
        )}
        {(activeTab === 'health' || activeTab === 'insights' || activeTab === 'medical') && (
          <div className="max-w-md mx-auto">
            {/* Tablet Sub-tab Toggle Bar */}
            <div className="px-3 pt-3">
              <div className="bg-slate-200/90 dark:bg-slate-800/90 p-1 rounded-2xl flex items-center shadow-sm max-w-xs mx-auto mb-2 border border-theme-border/60 backdrop-blur-md">
                <button
                  onClick={() => setHealthSubTab('biomarker')}
                  className={`flex-1 py-1.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                    healthSubTab === 'biomarker'
                      ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Activity className="w-3.5 h-3.5 stroke-[2.5]" />
                  {(translations[profile.language] || translations.en).biomarkerTab || 'Biomarker'}
                </button>
                <button
                  onClick={() => setHealthSubTab('insight')}
                  className={`flex-1 py-1.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                    healthSubTab === 'insight'
                      ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5 stroke-[2.5]" />
                  {(translations[profile.language] || translations.en).insightTab || 'Insight'}
                </button>
              </div>
            </div>

            {healthSubTab === 'biomarker' ? (
              <MedicalHistoryTab
                profile={profile}
                biomarkers={biomarkers}
                biomarkerHistory={biomarkerHistory}
                foodLogs={foodLogs}
                hideSensitive={hideSensitive}
                onViewJob={handleOpenJob}
                onApplyDataSanitize={async (selected: SanitizeProposal[]) => {
                  const { applyDataSanitizePlan: applyPlan, buildDataSanitizePlan } = await import('../utils/dataSanitize');
                  const plan = buildDataSanitizePlan({
                    profile,
                    biomarkers,
                    biomarkerHistory,
                    foodLogs,
                  });
                  const result = applyPlan(plan, new Set(selected.map((s) => s.id)), {
                    profile,
                    biomarkers,
                    biomarkerHistory,
                    foodLogs,
                  });
                  // B7.5: no-op unless sanitize shifted demographics (guarded).
                  const nextProfile = maybeRecalibrateDemographicOverlays(profile, { ...profile, ...result.profileUpdates });
                  setProfile(nextProfile);
                  setFoodLogs(result.foodLogs);
                  setBiomarkerHistory(result.biomarkerHistory);
                  setBiomarkers(result.biomarkers);
                  await saveAndSync(
                    nextProfile,
                    result.foodLogs,
                    result.biomarkers,
                    result.biomarkerHistory,
                    actions,
                    dailyBenefits,
                    report
                  );
                  console.log(`[DataSanitize] Applied ${result.applied} proposals`);
                }}
                onDeleteEmptyBiomarkers={handleDeleteEmptyBiomarkers}
                onUpdateProfile={async (updates) => {
                  let updatedProfile = maybeRecalibrateDemographicOverlays(profile, { ...profile, ...updates });
                  // B7.5: Demographic Overlay Auto-Calibrator
                  setProfile(updatedProfile);
                  await saveAndSync(updatedProfile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'profile' });
                }}
                onEditBiomarkerLog={handleEditBiomarkerLog}
                onLogMedical={handleLogMedical}
                onDeleteBiomarker={handleDeleteBiomarker}
                onFlagNotUsed={handleFlagNotUsedGlobal}
                onFlagNotUsedLocal={handleFlagNotUsedLocal}
                onRestoreNotUsedLocal={handleRestoreNotUsedLocal}
                onRestoreNotUsedGlobal={handleRestoreNotUsedGlobal}
                onDeleteMultipleBiomarkers={handleDeleteMultipleBiomarkers}
                onDeleteBiomarkerLog={handleDeleteBiomarkerLog}
                onDeleteBiomarkerFromLog={handleDeleteBiomarkerFromLog}
                onStandardizeUnits={handleStandardizeBiomarkerUnits}
                onCombineBiomarkers={handleCombineBiomarkers}
                onBatchCombineBiomarkers={handleBatchCombineBiomarkers}
                onBatchConsolidate={handleBatchConsolidate}
                onReviewWithAgent={(keys) => {
                  const userIdentifier = profile?.email?.toLowerCase().replace(/[^a-z0-9]/g, '_') || 'guest';
                  localStorage.setItem(`agent1_custom_batch_keys_${userIdentifier}`, JSON.stringify(keys));
                  sessionStorage.setItem('auto_open_custom_batch_modal', 'true');
                  setActiveTab('insights');
                }}
                onOpenAgentChat={(agentType, options) => {
                  setActiveAgentType(agentType);
                  setPrefillMessage(options?.prefillMessage || null);
                  setActiveReviewBiomarkerKey(options?.biomarkerKey);
                  if (options?.dataReviewBatchIdx !== undefined) setActiveDataReviewBatchIdx(options.dataReviewBatchIdx);
                  if (options?.dataReviewBatchKeys) setActiveDataReviewBatchKeys(options.dataReviewBatchKeys);
                  setIsMedicalChatOpen(true);
                }}
                onApplyCalculation={handleApplyCalculation}
                selectedModelId={selectedModelId}
                onChangeModelId={setSelectedModelId}
                hasBmiAlert={profile ? hasBmiPendingAlert(profile, dismissedBmiAlerts, report) : false}
                onDismissBmiAlert={handleDismissBmiAlert}
                onAgentAnalysisSaved={handleAgentAnalysisSaved}
                onDeleteAnalysis={handleDeleteAnalysis}
              />
            ) : (
              <InsightsTab
                profile={profile}
                foodLogs={foodLogs}
                biomarkers={biomarkers}
                biomarkerHistory={biomarkerHistory}
                onDataReviewStateChange={setDataReviewSharedState}
                onDeleteBiomarker={handleDeleteBiomarker}
                onFlagNotUsed={handleFlagNotUsedGlobal}
                onRestoreNotUsedGlobal={handleRestoreNotUsedGlobal}
                onDeleteMultipleBiomarkers={handleDeleteMultipleBiomarkers}
                calibratingBatchIdx={calibratingBatchIdx}
                calibratingAgentType={calibratingAgentType}
                report={report}
                draftReport={draftReport}
                onAcceptReport={handleAcceptReport}
                onRejectReport={handleRejectReport}
                selectedModelId={selectedModelId}
                onChangeModelId={setSelectedModelId}
                onGenerateReport={handleGenerateReport}
                isGenerating={isGenerating}
                onNavigateToTab={setActiveTab as any}
                onOpenMedicalChat={() => {
                  setActiveAgentType(null);
                  setPrefillMessage(null);
                  setActiveReviewBiomarkerKey(undefined);
                  setIsMedicalChatOpen(true);
                }}
                onUpdateProfile={async (updatedProfile) => {
                  setProfile(updatedProfile);
                  await saveAndSync(updatedProfile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report);
                }}
                onUpdateHistory={async (updatedHistory, newBiomarkers, updatedProfileArg) => {
                  setBiomarkerHistory(updatedHistory);
                  setBiomarkers(newBiomarkers);
                  if (updatedProfileArg) setProfile(updatedProfileArg);
                  await saveAndSync(updatedProfileArg || profile, foodLogs, newBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'profile' });
                }}
                onLogMedical={handleLogMedical}
                batchSize={batchSize}
                onChangeBatchSize={(size) => {
                  setBatchSize(size);
                  try {
                    localStorage.setItem('biomarker_batch_size', size.toString());
                  } catch (e) {}
                }}
                onOpenAgentChat={(agentType: 'agent1' | 'agent2' | 'agent3' | 'agent4' | 'agent5' | 'health_baseline' | 'agent7' | 'data_review' | 'biomarker_review', options?: {
                  biomarkerKey?: string; 
                  prefillMessage?: string; 
                  dataReviewBatchIdx?: number | string; 
                  dataReviewBatchKeys?: string[];
                  extractedData?: any[];
                  currentBatch?: number;
                  estimatedTotalMarkers?: number | null;
                }) => {
                  setActiveAgentType(resolveAgentDestination(agentType) as any);
                  setPrefillMessage(options?.prefillMessage || null);
                  setActiveReviewBiomarkerKey(options?.biomarkerKey);
                  setActiveDataReviewBatchIdx(options?.dataReviewBatchIdx !== undefined ? options.dataReviewBatchIdx : null);
                  setActiveDataReviewBatchKeys(options?.dataReviewBatchKeys || []);
                  setActiveDataReviewExtractedYaml(options?.extractedData || []);
                  setActiveDataReviewCurrentBatch(options?.currentBatch || 1);
                  setActiveDataReviewEstimatedTotalMarkers(options?.estimatedTotalMarkers !== undefined ? options.estimatedTotalMarkers : null);
                  setIsMedicalChatOpen(true);
                }}
                onDeleteAnalysis={handleDeleteAnalysis}
                onArchiveAnalysis={async (id) => {
                  if (profile.agentAnalyses) {
                    const updatedProfile = {
                      ...profile,
                      agentAnalyses: profile.agentAnalyses.map(a => a.id === id ? { ...a, archived: true } : a)
                    };
                    setProfile(updatedProfile);
                    await saveAndSync(updatedProfile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'analysis', targetId: id });
                  }
                }}
                onAgentAnalysisSaved={handleAgentAnalysisSaved}
                onOpenFrontDesk={() => setIsFrontDeskOpen(true)}
              />
            )}
          </div>
        )}
        {activeTab === 'trends' && (
          <ErrorBoundary>
          <TrendsTab
            profile={profile}
            foodLogs={foodLogs}
            biomarkerHistory={biomarkerHistory}
            hideSensitive={hideSensitive}
            report={report}
            onSelectFood={(id) => {
              setInitiallyExpandedFoodId(id);
              setActiveTab('food');
            }}
          />
          </ErrorBoundary>
        )}
    </>
  );
}
