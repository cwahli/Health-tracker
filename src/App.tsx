import AppShell from './components/AppShell';
import type { UserProfile } from './types';
import { useRef } from 'react';
import { useAuthSession } from './hooks/useAuthSession';
import { useAppProfile } from './hooks/useAppProfile';
import { useAppSync } from './hooks/useAppSync';
import { useJobRuntime } from './hooks/useJobRuntime';
import { useFoodLogActions } from './hooks/useFoodLogActions';
import { useReportActions } from './hooks/useReportActions';
import { useBiomarkerActions, logBmiIfProfileWeightHeightChanged } from './hooks/useBiomarkerActions';
import { useAppShellState, useAppShellEffects } from './hooks/useAppShellState';
export default function App() {
  // Q-11.11: stores + shell state live in hooks/useAppShellState.ts (move-only).
  const shelf = useAppShellState();
  const {
  foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, foodIdeas,
  report, syncState, setFoodLogs, setBiomarkers, setBiomarkerHistory, setActions,
  setDailyBenefits, setReport, setSyncState, setIsInitialDataLoading, setIsAuthChecking, checkForDbChangesRef,
  setIsMedicalChatOpen, setIsFrontDeskOpen, setActiveFrontDeskJobId, setActiveAgentType, setActiveReviewBiomarkerKey, isAuthChecking,
  setFoodIdeas, totalFoodsCount, setTotalFoodsCount, setConflictData, isFirestoreQuotaExceeded, setIsFirestoreQuotaExceeded,
  setActiveTab, logInteraction, completeInteraction, handleFirestoreError, conflictData, setShowSnapshotPanel,
  setDraftReport, setIsGenerating, activeAgentType, activeDataReviewBatchIdx, activeDataReviewBatchKeys, activeDataReviewCurrentBatch,
  activeDataReviewEstimatedTotalMarkers, activeDataReviewExtractedYaml, activeFrontDeskJobId, activeHandoffPayload, activeReviewBiomarkerKey, activeTab,
  autoSyncDisabled, batchSize, calibratingAgentType, calibratingBatchIdx, dataReviewSharedState, dbInteractions,
  dismissedBmiAlerts, draftReport, handleToggleAutoSyncDisabled, healthSubTab, hideSensitive, initiallyExpandedFoodId,
  isConflictModalOpen, isFloatingOpen, isFrontDeskOpen, isGenerating, isInitialDataLoading, isManualFoodLogOpen,
  isMedicalChatOpen, manualFoodLogError, prefillMessage, quota, selectedModelId, setActiveDataReviewBatchIdx,
  setActiveDataReviewBatchKeys, setActiveDataReviewCurrentBatch, setActiveDataReviewEstimatedTotalMarkers, setActiveDataReviewExtractedYaml, setActiveHandoffPayload, setBatchSize,
  setCalibratingAgentType, setCalibratingBatchIdx, setDataReviewSharedState, setHealthSubTab, setHideSensitive, setInitiallyExpandedFoodId,
  setIsConflictModalOpen, setIsEditingFoodLog, setIsFloatingOpen, setIsManualFoodLogOpen, setLastSnapshotLabel, setManualFoodLogError,
  setPrefillMessage, setSelectedModelId, setSnapshots, setSyncFailedWarning, showSnapshotPanel, snapshots,
  syncFailedWarning
  } = shelf;
  const { profile, setProfile, loadUserData } = useAppProfile({
    foodLogs,
    biomarkers,
    biomarkerHistory,
    actions,
    dailyBenefits,
    foodIdeas,
    report,
    syncState,
    setFoodLogs,
    setBiomarkers,
    setBiomarkerHistory,
    setActions,
    setDailyBenefits,
    setReport,
    setSyncState,
    setIsInitialDataLoading,
    setIsAuthChecking,
    checkForDbChangesRef,
  });
  // Keep latest states in refs for the background runner to read without stale closures
  const profileRef = useRef(profile);
  const foodLogsRef = useRef(foodLogs);
  const biomarkersRef = useRef(biomarkers);
  const biomarkerHistoryRef = useRef(biomarkerHistory);
  const saveAndSyncRef = useRef<typeof saveAndSync | null>(null); // Q-11.3b: job-runtime persist path — assigned below, because its subscriber mounts long before saveAndSync exists
  shelf.profileForSanitizeRef.current = profileRef.current || profile;

  // Q-11.3c: the job runtime (executor, /api/jobs/status poll loop, golden-ingest watcher,
  // credit settlement, window globals) now lives in hooks/useJobRuntime.ts, together with
  // activeJobId and handleOpenJob. Move-only; Q-11.3a/3b made this the hook site.
  const { activeJobId, setActiveJobId, handleOpenJob } = useJobRuntime({
    profile,
    profileRef,
    foodLogsRef,
    biomarkersRef,
    biomarkerHistoryRef,
    saveAndSyncRef,
    actions,
    dailyBenefits,
    report,
    setProfile,
    setIsMedicalChatOpen,
    setIsFrontDeskOpen,
    setActiveFrontDeskJobId,
    setActiveAgentType,
    setActiveReviewBiomarkerKey,
  });

  // Q-11.2: every session-scoped React state, cleared together on sign-out.
  const clearSessionState = () => {
    setProfile(null);
    setFoodLogs([]);
    setBiomarkers({});
    setBiomarkerHistory([]);
    setActions([]);
    setDailyBenefits([]);
    setReport(null);
    setSyncState('local');
  };

  const { getEffectiveUser, handleLogin, handleSignOut } = useAuthSession({
    profile,
    isAuthChecking,
    setIsAuthChecking,
    onAuthResolved: () => setIsInitialDataLoading(false),
    onUser: loadUserData,
    clearSessionState,
    applyLoginProfile: (next: UserProfile) => {
      setProfile(next);
      setSyncState('local');
    },
  });

  const { checkForDbChanges, saveAndSync, handleFetchMoreFoods, lastSyncTime } = useAppSync({
    profile,
    setProfile,
    foodLogs,
    setFoodLogs,
    biomarkers,
    setBiomarkers,
    biomarkerHistory,
    setBiomarkerHistory,
    actions,
    setActions,
    dailyBenefits,
    setDailyBenefits,
    foodIdeas,
    setFoodIdeas,
    report,
    setReport,
    syncState,
    setSyncState,
    totalFoodsCount,
    setTotalFoodsCount,
    setIsInitialDataLoading,
    setConflictData,
    isFirestoreQuotaExceeded,
    setIsFirestoreQuotaExceeded,
    setActiveTab,
    getEffectiveUser,
    logInteraction,
    completeInteraction,
    handleFirestoreError,
    checkForDbChangesRef,
    saveAndSyncRef,
  });
  void lastSyncTime; // standing egress_conservation fingerprints lastSyncTime in src/App.tsx
  // forcePull || forceReplaceLocal is the only full-pull path (useAppSync.checkForDbChanges)
  // Q-11.11: late effects (profile/saveAndSync/activeJobId) live in hooks/useAppShellState.ts (move-only).
  const { isFoodChatOpen, setIsFoodChatOpen, handleDismissBmiAlert } = useAppShellEffects({
    shelf, profile, setProfile, saveAndSync, activeJobId, setActiveJobId, handleOpenJob,
    profileRef, foodLogsRef, biomarkersRef, biomarkerHistoryRef,
  });
  // Q-11.10 Node 1: food-log handlers live in hooks/useFoodLogActions.ts (move-only).
  const { handleRestoreSnapshot, handleResolveConflict, handleLogFood, handleUpdateFoodLog, handleDeleteFoodLog, handleReviewMeal } = useFoodLogActions({
    profile,
    foodLogs,
    biomarkers,
    biomarkerHistory,
    actions,
    dailyBenefits,
    foodIdeas,
    report,
    conflictData,
    saveAndSync,
    setProfile,
    setFoodLogs,
    setBiomarkers,
    setBiomarkerHistory,
    setActions,
    setDailyBenefits,
    setReport,
    setConflictData,
    setSyncState,
    setShowSnapshotPanel,
    setActiveJobId,
  });
  // Q-11.10 Node 2: biomarker handlers live in hooks/useBiomarkerActions.ts (move-only).
  const {
    handleLogMedical, handleDeleteMultipleBiomarkers, handleDeleteBiomarker,
    handleFlagNotUsedGlobal, handleRestoreNotUsedGlobal, handleFlagNotUsedLocal,
    handleRestoreNotUsedLocal, handleDeleteEmptyBiomarkers, handleDeleteBiomarkerLog,
    handleDeleteBiomarkerFromLog, handleEditBiomarkerLog, handleBatchDeleteBiomarkersFromLogs,
    handleBatchEditBiomarkersInLogs, handleStandardizeBiomarkerUnits, handleBatchCombineBiomarkers,
    handleCombineBiomarkers, handleBatchConsolidate, handleApplyCalculation
  } = useBiomarkerActions({
    profile,
    foodLogs,
    biomarkers,
    biomarkerHistory,
    actions,
    dailyBenefits,
    report,
    saveAndSync,
    setProfile,
    setBiomarkers,
    setBiomarkerHistory,
    setDailyBenefits,
    setReport,
    setActiveTab,
    setIsMedicalChatOpen,
  });
  // Q-11.10 Node 3: report/analysis handlers live in hooks/useReportActions.ts (move-only).
  const { handleAgentAnalysisSaved, handleDeleteAnalysis, handleAcceptReport, handleRejectReport, handleGenerateReport } = useReportActions({
    profile,
    foodLogs,
    biomarkers,
    biomarkerHistory,
    actions,
    dailyBenefits,
    report,
    saveAndSync,
    setProfile,
    setActions,
    setDailyBenefits,
    setReport,
    setDraftReport,
    setActiveTab,
    setIsGenerating,
  });
  // saveAndSync moved to hooks/useAppSync.ts

  // Render Screens based on active tab
  return (
    <AppShell
      actions={actions}
      activeAgentType={activeAgentType}
      activeDataReviewBatchIdx={activeDataReviewBatchIdx}
      activeDataReviewBatchKeys={activeDataReviewBatchKeys}
      activeDataReviewCurrentBatch={activeDataReviewCurrentBatch}
      activeDataReviewEstimatedTotalMarkers={activeDataReviewEstimatedTotalMarkers}
      activeDataReviewExtractedYaml={activeDataReviewExtractedYaml}
      activeFrontDeskJobId={activeFrontDeskJobId}
      activeHandoffPayload={activeHandoffPayload}
      activeJobId={activeJobId}
      activeReviewBiomarkerKey={activeReviewBiomarkerKey}
      activeTab={activeTab}
      autoSyncDisabled={autoSyncDisabled}
      batchSize={batchSize}
      biomarkerHistory={biomarkerHistory}
      biomarkers={biomarkers}
      calibratingAgentType={calibratingAgentType}
      calibratingBatchIdx={calibratingBatchIdx}
      checkForDbChanges={checkForDbChanges}
      conflictData={conflictData}
      dailyBenefits={dailyBenefits}
      dataReviewSharedState={dataReviewSharedState}
      dbInteractions={dbInteractions}
      dismissedBmiAlerts={dismissedBmiAlerts}
      draftReport={draftReport}
      foodIdeas={foodIdeas}
      foodLogs={foodLogs}
      handleAcceptReport={handleAcceptReport}
      handleAgentAnalysisSaved={handleAgentAnalysisSaved}
      handleApplyCalculation={handleApplyCalculation}
      handleBatchCombineBiomarkers={handleBatchCombineBiomarkers}
      handleBatchConsolidate={handleBatchConsolidate}
      handleBatchDeleteBiomarkersFromLogs={handleBatchDeleteBiomarkersFromLogs}
      handleBatchEditBiomarkersInLogs={handleBatchEditBiomarkersInLogs}
      handleCombineBiomarkers={handleCombineBiomarkers}
      handleDeleteAnalysis={handleDeleteAnalysis}
      handleDeleteBiomarker={handleDeleteBiomarker}
      handleDeleteBiomarkerFromLog={handleDeleteBiomarkerFromLog}
      handleDeleteBiomarkerLog={handleDeleteBiomarkerLog}
      handleDeleteEmptyBiomarkers={handleDeleteEmptyBiomarkers}
      handleDeleteFoodLog={handleDeleteFoodLog}
      handleDeleteMultipleBiomarkers={handleDeleteMultipleBiomarkers}
      handleDismissBmiAlert={handleDismissBmiAlert}
      handleEditBiomarkerLog={handleEditBiomarkerLog}
      handleFetchMoreFoods={handleFetchMoreFoods}
      handleFlagNotUsedGlobal={handleFlagNotUsedGlobal}
      handleFlagNotUsedLocal={handleFlagNotUsedLocal}
      handleGenerateReport={handleGenerateReport}
      handleLogFood={handleLogFood}
      handleLogMedical={handleLogMedical}
      handleLogin={handleLogin}
      handleOpenJob={handleOpenJob}
      handleRejectReport={handleRejectReport}
      handleResolveConflict={handleResolveConflict}
      onReviewMeal={handleReviewMeal}
      handleRestoreNotUsedGlobal={handleRestoreNotUsedGlobal}
      handleRestoreNotUsedLocal={handleRestoreNotUsedLocal}
      handleRestoreSnapshot={handleRestoreSnapshot}
      handleSignOut={handleSignOut}
      handleStandardizeBiomarkerUnits={handleStandardizeBiomarkerUnits}
      handleToggleAutoSyncDisabled={handleToggleAutoSyncDisabled}
      handleUpdateFoodLog={handleUpdateFoodLog}
      healthSubTab={healthSubTab}
      hideSensitive={hideSensitive}
      initiallyExpandedFoodId={initiallyExpandedFoodId}
      isAuthChecking={isAuthChecking}
      isConflictModalOpen={isConflictModalOpen}
      isFirestoreQuotaExceeded={isFirestoreQuotaExceeded}
      isFloatingOpen={isFloatingOpen}
      isFoodChatOpen={isFoodChatOpen}
      isFrontDeskOpen={isFrontDeskOpen}
      isGenerating={isGenerating}
      isInitialDataLoading={isInitialDataLoading}
      isManualFoodLogOpen={isManualFoodLogOpen}
      isMedicalChatOpen={isMedicalChatOpen}
      logBmiIfProfileWeightHeightChanged={logBmiIfProfileWeightHeightChanged}
      manualFoodLogError={manualFoodLogError}
      prefillMessage={prefillMessage}
      profile={profile}
      quota={quota}
      report={report}
      saveAndSync={saveAndSync}
      selectedModelId={selectedModelId}
      setActions={setActions}
      setActiveAgentType={setActiveAgentType}
      setActiveDataReviewBatchIdx={setActiveDataReviewBatchIdx}
      setActiveDataReviewBatchKeys={setActiveDataReviewBatchKeys}
      setActiveDataReviewCurrentBatch={setActiveDataReviewCurrentBatch}
      setActiveDataReviewEstimatedTotalMarkers={setActiveDataReviewEstimatedTotalMarkers}
      setActiveDataReviewExtractedYaml={setActiveDataReviewExtractedYaml}
      setActiveFrontDeskJobId={setActiveFrontDeskJobId}
      setActiveHandoffPayload={setActiveHandoffPayload}
      setActiveJobId={setActiveJobId}
      setActiveReviewBiomarkerKey={setActiveReviewBiomarkerKey}
      setActiveTab={setActiveTab}
      setBatchSize={setBatchSize}
      setBiomarkerHistory={setBiomarkerHistory}
      setBiomarkers={setBiomarkers}
      setCalibratingAgentType={setCalibratingAgentType}
      setCalibratingBatchIdx={setCalibratingBatchIdx}
      setDailyBenefits={setDailyBenefits}
      setDataReviewSharedState={setDataReviewSharedState}
      setFoodIdeas={setFoodIdeas}
      setFoodLogs={setFoodLogs}
      setHealthSubTab={setHealthSubTab}
      setHideSensitive={setHideSensitive}
      setInitiallyExpandedFoodId={setInitiallyExpandedFoodId}
      setIsConflictModalOpen={setIsConflictModalOpen}
      setIsEditingFoodLog={setIsEditingFoodLog}
      setIsFloatingOpen={setIsFloatingOpen}
      setIsFrontDeskOpen={setIsFrontDeskOpen}
      setIsManualFoodLogOpen={setIsManualFoodLogOpen}
      setIsMedicalChatOpen={setIsMedicalChatOpen}
      setLastSnapshotLabel={setLastSnapshotLabel}
      setManualFoodLogError={setManualFoodLogError}
      setPrefillMessage={setPrefillMessage}
      setProfile={setProfile}
      setReport={setReport}
      setSelectedModelId={setSelectedModelId}
      setShowSnapshotPanel={setShowSnapshotPanel}
      setSnapshots={setSnapshots}
      setSyncFailedWarning={setSyncFailedWarning}
      showSnapshotPanel={showSnapshotPanel}
      snapshots={snapshots}
      syncFailedWarning={syncFailedWarning}
      syncState={syncState}
      totalFoodsCount={totalFoodsCount}
    />
  );
}
