import type { Dispatch, SetStateAction } from 'react';
import type {
  BiomarkerLog,
  DailyBenefit,
  DbInteraction,
  FoodIdea,
  FoodLog,
  HealthAction,
  QuotaData,
  RecommendationReport,
  UserProfile,
} from '../types';
import type { AppSyncState, ProfileDbChangeChecker } from '../hooks/useAppProfile';
import type { JobRuntimeAgentType } from '../hooks/useJobRuntime';

/** Typed chrome props for AppShell / AppTabs / AppModals. Extra keys allowed for IIFE locals. */
export interface AppViewProps {
  actions: HealthAction[];
  activeAgentType: JobRuntimeAgentType;
  activeDataReviewBatchIdx: number | string | null;
  activeDataReviewBatchKeys: string[];
  activeDataReviewCurrentBatch: number;
  activeDataReviewEstimatedTotalMarkers: number | null;
  activeDataReviewExtractedYaml: any[];
  activeFrontDeskJobId: string | null;
  activeHandoffPayload: any;
  activeJobId: string | null;
  activeReviewBiomarkerKey: string | undefined;
  activeTab: 'home' | 'insights' | 'health' | 'food' | 'medical' | 'trends';
  autoSyncDisabled: boolean;
  batchSize: number;
  biomarkerHistory: BiomarkerLog[];
  biomarkers: { [key: string]: number | string };
  calibratingAgentType: string | null;
  calibratingBatchIdx: number | null;
  checkForDbChanges: ProfileDbChangeChecker;
  conflictData: any;
  dailyBenefits: DailyBenefit[];
  dataReviewSharedState: any;
  dbInteractions: DbInteraction[];
  dismissedBmiAlerts: { [key: string]: boolean };
  draftReport: RecommendationReport | null;
  foodIdeas: FoodIdea[];
  foodLogs: FoodLog[];
  handleAcceptReport: (...args: any[]) => any;
  handleAgentAnalysisSaved: (...args: any[]) => any;
  handleApplyCalculation: (...args: any[]) => any;
  handleBatchCombineBiomarkers: (...args: any[]) => any;
  handleBatchConsolidate: (...args: any[]) => any;
  handleBatchDeleteBiomarkersFromLogs: (...args: any[]) => any;
  handleBatchEditBiomarkersInLogs: (...args: any[]) => any;
  handleCombineBiomarkers: (...args: any[]) => any;
  handleDeleteAnalysis: (...args: any[]) => any;
  handleDeleteBiomarker: (...args: any[]) => any;
  handleDeleteBiomarkerFromLog: (...args: any[]) => any;
  handleDeleteBiomarkerLog: (...args: any[]) => any;
  handleDeleteEmptyBiomarkers: (...args: any[]) => any;
  handleDeleteFoodLog: (...args: any[]) => any;
  handleDeleteMultipleBiomarkers: (...args: any[]) => any;
  handleDismissBmiAlert: (...args: any[]) => any;
  handleEditBiomarkerLog: (...args: any[]) => any;
  handleFetchMoreFoods: (page: number) => Promise<void>;
  handleFlagNotUsedGlobal: (...args: any[]) => any;
  handleFlagNotUsedLocal: (...args: any[]) => any;
  handleGenerateReport: (...args: any[]) => any;
  handleLogFood: (...args: any[]) => any;
  handleLogMedical: (...args: any[]) => any;
  handleLogin: (profile: UserProfile) => Promise<void> | void;
  handleOpenJob: (jobId: string) => void;
  handleRejectReport: (...args: any[]) => any;
  handleResolveConflict: (...args: any[]) => any;
  handleRestoreNotUsedGlobal: (...args: any[]) => any;
  handleRestoreNotUsedLocal: (...args: any[]) => any;
  handleRestoreSnapshot: (...args: any[]) => any;
  handleSignOut: () => Promise<void> | void;
  handleStandardizeBiomarkerUnits: (...args: any[]) => any;
  handleToggleAutoSyncDisabled: (...args: any[]) => any;
  handleUpdateFoodLog: (...args: any[]) => any;
  healthSubTab: 'biomarker' | 'insight';
  hideSensitive: boolean;
  initiallyExpandedFoodId: string | null;
  isAuthChecking: boolean;
  isConflictModalOpen: boolean;
  isFirestoreQuotaExceeded: boolean;
  isFloatingOpen: boolean;
  isFoodChatOpen: boolean;
  isFrontDeskOpen: boolean;
  isGenerating: boolean;
  isInitialDataLoading: boolean;
  isManualFoodLogOpen: boolean;
  isMedicalChatOpen: boolean;
  logBmiIfProfileWeightHeightChanged: any;
  manualFoodLogError: string | null;
  prefillMessage: string | null;
  profile: UserProfile | null;
  quota: QuotaData;
  report: RecommendationReport | null;
  saveAndSync: (...args: any[]) => Promise<any>;
  selectedModelId: string;
  setActions: Dispatch<SetStateAction<HealthAction[]>>;
  setActiveAgentType: Dispatch<SetStateAction<JobRuntimeAgentType>>;
  setActiveDataReviewBatchIdx: Dispatch<SetStateAction<number | string | null>>;
  setActiveDataReviewBatchKeys: Dispatch<SetStateAction<string[]>>;
  setActiveDataReviewCurrentBatch: Dispatch<SetStateAction<number>>;
  setActiveDataReviewEstimatedTotalMarkers: Dispatch<SetStateAction<number | null>>;
  setActiveDataReviewExtractedYaml: Dispatch<SetStateAction<any[]>>;
  setActiveFrontDeskJobId: Dispatch<SetStateAction<string | null>>;
  setActiveHandoffPayload: Dispatch<SetStateAction<any>>;
  setActiveJobId: Dispatch<SetStateAction<string | null>>;
  setActiveReviewBiomarkerKey: Dispatch<SetStateAction<string | undefined>>;
  setActiveTab: (tab: 'home' | 'insights' | 'health' | 'food' | 'medical' | 'trends') => void;
  setBatchSize: Dispatch<SetStateAction<number>>;
  setBiomarkerHistory: (val: BiomarkerLog[] | ((prev: BiomarkerLog[]) => BiomarkerLog[])) => void;
  setBiomarkers: Dispatch<SetStateAction<{ [key: string]: number | string }>>;
  setCalibratingAgentType: Dispatch<SetStateAction<string | null>>;
  setCalibratingBatchIdx: Dispatch<SetStateAction<number | null>>;
  setDailyBenefits: Dispatch<SetStateAction<DailyBenefit[]>>;
  setDataReviewSharedState: Dispatch<SetStateAction<any>>;
  setFoodIdeas: Dispatch<SetStateAction<FoodIdea[]>>;
  setFoodLogs: (val: FoodLog[] | ((prev: FoodLog[]) => FoodLog[])) => void;
  setHealthSubTab: Dispatch<SetStateAction<'biomarker' | 'insight'>>;
  setHideSensitive: (hide: boolean) => void;
  setInitiallyExpandedFoodId: Dispatch<SetStateAction<string | null>>;
  setIsConflictModalOpen: Dispatch<SetStateAction<boolean>>;
  setIsEditingFoodLog: Dispatch<SetStateAction<boolean>>;
  setIsFloatingOpen: Dispatch<SetStateAction<boolean>>;
  setIsFrontDeskOpen: Dispatch<SetStateAction<boolean>>;
  setIsManualFoodLogOpen: Dispatch<SetStateAction<boolean>>;
  setIsMedicalChatOpen: Dispatch<SetStateAction<boolean>>;
  setLastSnapshotLabel: Dispatch<SetStateAction<string | null>>;
  setManualFoodLogError: Dispatch<SetStateAction<string | null>>;
  setPrefillMessage: Dispatch<SetStateAction<string | null>>;
  setProfile: Dispatch<SetStateAction<UserProfile | null>>;
  setReport: Dispatch<SetStateAction<RecommendationReport | null>>;
  setSelectedModelId: Dispatch<SetStateAction<string>>;
  setShowSnapshotPanel: Dispatch<SetStateAction<boolean>>;
  setSnapshots: Dispatch<SetStateAction<any[]>>;
  setSyncFailedWarning: Dispatch<SetStateAction<string | null>>;
  showSnapshotPanel: boolean;
  snapshots: any[];
  syncFailedWarning: string | null;
  syncState: AppSyncState;
  totalFoodsCount: number | undefined;
  [extra: string]: any;
}

export default AppViewProps;
