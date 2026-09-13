export interface AnalyzeRunContext {
  req: any; res: any; isStream: boolean; hasSentHeaders: boolean; sessionId: string;
  initialLogCount: number; sendStreamEvent: (data: any) => void;
  sendLog: (type: string, stage: string, message: string, data?: any) => void;
  addDebugLog: (msg: string) => void; emitStageUsage: (stage: string) => void;
  takeUnifiedUsage: (stage: string) => any; takeUnifiedTiming: (stage: string) => number | null;
  callUnifiedLLM: any; message: string; imagePayloads: any[]; images: any[]; imageDates: any[];
  history: any[]; userProfile: any; engine: string; biomarkersNeedingImprovement: any;
  remainingAllowance: any; userId: string; activeMeal: any; customSystemInstruction: string;
  customVariableData: any; foodLogs: any[]; userSelectedMode: string;
  userExplicitlySelectedEditMode: boolean; isExplicitModify: boolean; isModifySession: boolean;
  hasActiveMealDocument: boolean; hasNoNewImages: boolean; compareOnly: boolean; compareItems: any[];
  visionScoutItems: any[]; visionScoutContentType: string; preCalculatedItems: any[];
  aggregatedNutrients: any; scoutInstructionForDebug: any; apiCalls: any[]; accumulatedDispatches: any[];
  databaseMatches: string; databaseMatchesArray: any[]; quarantinedIdsSet: Set<string>; dbMatchMap: Map<string, any>;
  scoutInternalReasoning: string | null; rawScoutData: any; scoutConfidenceRating: string;
  scoutConfidenceComment: string; scoutRecommendedMode: string | null; scoutCookingMethod: string;
  diningEnvironment: string; visionScoutRanAndReturnedItems: boolean; queriesToSearch: string[];
  scoutOriginalQueries: string[]; refineDecision: { skip: boolean; reason?: string };
  weightRefineIntent: { isRefine: boolean; weightGrams?: number }; isPureWeightModification: boolean;
  isWeightModification: boolean; portionClarify: any;
  effectiveActiveMeal: any; hasUploadedNewImages: boolean;
}
