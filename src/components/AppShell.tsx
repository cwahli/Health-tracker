import React from 'react';
import Header from './Header';
import BottomNav from './BottomNav';
import AuthScreen from './AuthScreen';
import ConflictResolutionModal from './ConflictResolutionModal';
import FloatingActionSheet from './FloatingActionSheet';
import { getDynamicStyles } from './AppDynamicStyles';
import { JobStore } from '../jobs/JobStore';
import { Loader, AlertTriangle, X, RefreshCw } from 'lucide-react';
import { getStorageKey, safeSaveToLocalStorage } from '../utils/storageUtils';
import { maybeRecalibrateDemographicOverlays } from '../utils/appProfileUtils';
import { auth } from '../firebase';
import { hasBmiPendingAlert, getProfileFingerprint } from '../utils/biomarkers';
import type { UserProfile } from '../types';
import AppTabs from './AppTabs';
import AppModals from './AppModals';

export type AppViewProps = Record<string, any>;

export default function AppShell(p: AppViewProps) {
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

  if (isAuthChecking) {
    return (
      <div className="min-h-screen bg-theme-bg flex flex-col items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3">
          <Loader className="w-8 h-8 text-indigo-600 animate-spin" />
          <p className="text-xs font-semibold text-slate-500 animate-pulse">Checking your health portal...</p>
        </div>
      </div>
    );
  }
  if (!profile) {
    return <AuthScreen onLogin={handleLogin} />;
  }
  const isMedicalTabFAB = ['medical', 'insights'].includes(activeTab);
  return (
    <div className="h-[100dvh] overflow-hidden bg-theme-bg flex flex-col transition-colors duration-200">
      <style dangerouslySetInnerHTML={{ __html: getDynamicStyles(profile) }} />
      {/* Header Profile Section */}
      <Header
        activeTab={activeTab}
        viewingJobId={activeJobId}
        onViewJob={handleOpenJob}
        onNavigateTab={(tab) => setActiveTab(tab as any)}
        biomarkerHistory={biomarkerHistory}
        setBiomarkerHistory={setBiomarkerHistory}
        setFoodLogs={setFoodLogs}
        profile={profile}
        onSaveAndSync={saveAndSync}
        biomarkers={biomarkers}
        actions={actions}
        dailyBenefits={dailyBenefits}
        report={report}
        onOpenFrontDesk={() => setIsFrontDeskOpen(true)}
        onOpenUndo={() => setShowSnapshotPanel(true)}
        setProfile={(pInput) => {
          setProfile((prevProfile) => {
            const resolved = typeof pInput === 'function' ? pInput(prevProfile!) : pInput;
            if (!resolved) return prevProfile;

            const now = Date.now();
            const updatedProfile: UserProfile = {
              ...resolved,
              lastUpdatedAt: now
            };

            if (updatedProfile.language) {
              localStorage.setItem('preferred_language', updatedProfile.language);
            }

            const bundle = {
              profile: updatedProfile,
              foodLogs,
              biomarkers,
              biomarkerHistory,
              actions,
              dailyBenefits,
              report
            };
            safeSaveToLocalStorage(getStorageKey(updatedProfile?.email || profile?.email || auth.currentUser?.email), bundle);
            saveAndSync(updatedProfile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'profile' });

            return updatedProfile;
          });
        }}
        onSaveProfile={async (p) => {
          // B7.5: fingerprint diff (ageBand|gender|ethnicity), not raw fields.
          let updatedProfile = maybeRecalibrateDemographicOverlays(profile, { ...p });
          if (updatedProfile.language) {
            localStorage.setItem('preferred_language', updatedProfile.language);
          }
          const { updatedHistory, updatedBiomarkers, changed } = logBmiIfProfileWeightHeightChanged(profile, updatedProfile, biomarkerHistory, biomarkers);
          setProfile(updatedProfile);
          if (changed) {
            setBiomarkerHistory(updatedHistory);
            setBiomarkers(updatedBiomarkers);
            await saveAndSync(updatedProfile, foodLogs, updatedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'profile' });
          } else {
            await saveAndSync(updatedProfile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'profile' });
          }
        }}
        hideSensitive={hideSensitive}
        setHideSensitive={setHideSensitive}
        syncState={syncState}
        onSignOut={handleSignOut}
        onCloudSync={() => checkForDbChanges(undefined, true)}
        onForcePush={() => saveAndSync(profile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'fullPush', cloudFoods: [], cloudBioHistory: [], forceOverwrite: true, includeFoods: false } as any)}
        onForcePushWithFoods={() => saveAndSync(profile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'fullPush', cloudFoods: [], cloudBioHistory: [], forceOverwrite: true, includeFoods: true } as any)}
        onForcePull={() => checkForDbChanges(undefined, true, true)}
        dbInteractions={dbInteractions}
        quota={quota}
        foodLogs={foodLogs}
        autoSyncDisabled={autoSyncDisabled}
        onChangeAutoSyncDisabled={handleToggleAutoSyncDisabled}
      />
      {syncFailedWarning && (
        <div className="px-5 py-2.5 bg-rose-600 text-white text-xs font-bold flex items-center justify-between shadow-sm animate-in slide-in-from-top duration-200 shrink-0 z-30">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-100 shrink-0" />
            <span>{syncFailedWarning}</span>
          </div>
          <button
            type="button"
            onClick={() => setSyncFailedWarning(null)}
            className="text-white/85 hover:text-white cursor-pointer ml-3 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {syncState === 'conflict' && conflictData && (
        <div className="bg-indigo-600 text-white py-2 px-4 shadow-md transition-all duration-300 relative overflow-hidden flex flex-col md:flex-row items-center justify-between gap-3 text-center md:text-left z-20 border-b border-indigo-700/30">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-1.5 rounded-lg shrink-0">
              <RefreshCw className="w-4 h-4 text-white animate-spin" />
            </div>
            <div>
              <p className="text-xs font-bold leading-normal text-left">
                Data Out of Sync / Conflict Detected
              </p>
              <p className="text-[10px] text-white/90 text-left">
                Your local device data and cloud database have both been modified separately. Click "Resolve Conflict" to choose which data to keep.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setIsConflictModalOpen(true);
              }}
              className="px-3 py-1 bg-white hover:bg-slate-100 text-indigo-700 font-bold text-[10px] rounded-lg transition-all shadow-sm shrink-0 cursor-pointer"
            >
              Resolve Conflict
            </button>
          </div>
        </div>
      )}
      <ConflictResolutionModal
        isOpen={isConflictModalOpen}
        onClose={() => setIsConflictModalOpen(false)}
        conflictData={conflictData}
        onResolve={handleResolveConflict}
      />
      {/* Main Viewport Container */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden" id="main-scroll-container">
        <React.Suspense fallback={(
          <div className="min-h-[50vh] flex items-center justify-center">
            <Loader className="w-6 h-6 text-indigo-600 animate-spin" />
          </div>
        )}>
        <AppTabs {...p} />
        </React.Suspense>
      </main>
      {/* Floating Action Sheet overlay for Quick Actions */}
      <FloatingActionSheet
        isOpen={isFloatingOpen}
        language={profile.language}
        onClose={() => setIsFloatingOpen(false)}
        onLogMeal={() => {
          const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          JobStore.createJob({
            id: jobId,
            kind: 'food_log',
            lockedModeFamily: 'A',
            status: 'draft',
          });
          setActiveJobId(jobId);
        }}
        onCompareMeal={() => {
          const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          JobStore.createJob({
            id: jobId,
            kind: 'food_compare',
            lockedModeFamily: 'D',
            status: 'draft',
          });
          setActiveJobId(jobId);
        }}
        onHealthInfo={() => {
          setIsFrontDeskOpen(true);
        }}
      />
      {/* Bottom Material Tab Bar (Icons only) */}
      <BottomNav
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        language={profile?.language || "en"}
        onPlusClick={() => setIsFloatingOpen(!isFloatingOpen)}
        isFloatingOpen={isFloatingOpen}
      />

      <AppModals {...p} />
    </div>
  );
}
