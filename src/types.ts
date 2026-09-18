export type Severity = 'Normal' | 'Borderline at risk' | 'At risk' | 'Critical' | string;
export interface RangeConfig {
  type?: 'simple' | 'bracket' | string;
  conditions?: any[];
  brackets?: any[];
  filters?: any;
  range?: any;
}
export interface CustomRangeFilter {
  gender?: string;
  minAge?: number | '';
  maxAge?: number | '';
  ethnicity?: string;
}
export interface SimpleRange {
  type?: 'simple' | string;
  conditions?: any[];
}
export interface BracketRange {
  type?: 'bracket' | string;
  brackets?: any[];
}
export interface CustomRangeDef {
  id?: string;
  key?: string;
  name?: string;
  type?: string;
  conditions?: any[];
  brackets?: any[];
  filters?: CustomRangeFilter;
  range?: RangeConfig | any;
}
export interface AgentAnalysis {
  id?: string;
  timestamp?: string;
  agentId?: string;
  summary?: string;
  date?: string;
  result?: any;
  archived?: boolean;
  agentType?: string;
}
export interface PendingObservation {
  id?: string;
  printedName: string;
  suggestedKey?: string;
  date: string;
  rawValue: number | string;
  rawUnit?: string;
  sourceJobId?: string;
  printedRange?: string;
  labFlag?: string;
  createdAt?: number;
}

export interface UserProfile {
  uid?: string;
  email?: string;
  nickname?: string;
  photoUrl?: string;
  age?: any;
  gender?: string;
  ethnicity?: string;
  height?: any;
  weight?: any;
  bloodType?: string;
  language?: string;
  timezone?: string;
  unitPreference?: string;
  targetCalories?: any;
  targetCarbs?: any;
  targetFats?: any;
  targetFibre?: any;
  targetProtein?: any;
  targetSaturatedFat?: any;
  targetSodium?: any;
  targetSugar?: any;
  topNutrientsToMonitor?: string[];
  
  fontSize?: string;
  fontSizeTitle?: string;
  fontSizeSubtitle?: string;
  fontSizeDescription?: string;
  fontSizeBody?: string;
  fontSizeBodySmall?: string;
  fontSizeSubtitleSmall?: string;
  fontSizeKeyMetric?: string;
  fontSizeXS?: string;
  fontFamily?: string;
  fontMono?: string;
  marginScale?: 'compact' | 'normal' | 'relaxed';
  paddingScale?: 'compact' | 'normal' | 'relaxed';
  cornerRadius?: 'none' | 'small' | 'normal' | 'large' | 'pill';
  shadowScale?: 'none' | 'light' | 'normal' | 'heavy';
  themePresets?: any[];
  systemPresetOverrides?: { [presetName: string]: any };
  themeOverrides?: any[];
  customColors?: any[];
  customFonts?: any[];
  themePalette?: {
    button?: string;
    background?: string;
    border?: string;
    warning?: string;
    caution?: string;
    success?: string;
    text?: string;
    textSecondary?: string;
    textDarkPrimary?: string;
    textDarkSecondary?: string;
    textAccent?: string;
    textMuted?: string;
    textSuccess?: string;
    textError?: string;
    bgApp?: string;
    bgCard?: string;
    neutralSetting?: string;
    [key: string]: string | undefined;
  };
  customBiomarkers?: {
    [key: string]: {
      name: string;
      unit: string;
      normalRange: string;
      optimalValue?: string;
      profileAdjustedNormalRange?: string;
      specificRiskContext?: string;
      status?: string;
      userValue?: number | string;
      needsApproval?: boolean;
      rangeConfig?: RangeConfig;
      customRanges?: CustomRangeDef[];
      structuredRanges?: {
        id: string;
        name: string;
        min?: number | '';
        max?: number | '';
        isNormal?: boolean;
        targetGender?: string;
        targetAgeMin?: number | '';
        targetAgeMax?: number | '';
        targetEthnicity?: string;
        targetBiomarkerKey?: string;
        targetBiomarkerMin?: number | '';
        targetBiomarkerMax?: number | '';
      }[];
      description: string;
      benefitRisk?: string;
      riskCategories?: string[];
      standardMedicalGrouping?: string;
      potentialMedicalConditions?: string[];
      updatedAt?: number;
      /** Overlay fingerprint: ageBand|sex|ethnicity */
      overlayFingerprint?: string;
      sameAsCatalog?: boolean;
      catalogApproved?: boolean;
      rangeVariesBy?: ('age' | 'sex' | 'ethnicity')[];
      rangeBrackets?: { name?: string; label?: string; range?: string; min?: number | null; max?: number | null; severity?: number | string }[];
    }
  };
  lastUpdatedAt?: number;
  agentTriageSummary?: string;       // Agent 1 summary
  agentDiagnosticSummary?: string;   // Agent 2 summary
  agentContextualizerSummary?: string;// Agent 3 summary
  agentInterventionSummary?: string; // Agent 4 summary
  agentLiteratureSummary?: string;   // Agent 5 summary
  agentMemory?: any;                 // Persistent UserMemory across sessions
  agentAnalyses?: AgentAnalysis[];
  agent2TimelineProjections?: {
    year2: string;
    year5: string;
    year10: string;
  };
  agent2GapTasks?: string[];
  agent4Projections?: string[];
  deletedFoodLogIds?: Record<string, number>;
  deletedBiomarkerLogIds?: Record<string, number>;
  deletedCustomBiomarkerKeys?: Record<string, number>;
  deletedDailyBenefitIds?: Record<string, number>;
  notUsedBiomarkers?: Record<string, { flaggedAt: number }>;
  deletedNotUsedBiomarkerKeys?: Record<string, number>;
  notUsedInMedicalHistory?: Record<string, { flaggedAt: number }>;
  bmiAutoLogged?: boolean;
  pendingObservations?: PendingObservation[];
  approved_agent1_batches?: { [key: string]: boolean };
  approved_data_review_batches?: { [key: string]: boolean };
  userType?: 'Admin' | 'Demo' | 'Standard';
  agentCredits?: {
    totalUsed: number;
    dailyQuota: number;
    remaining: number;
    lastResetTime: string; // ISO String
    grantedCredits?: {
      amount: number;
      expiresAt: string; // ISO String duration
      grantedAt: string; // ISO String
    }[];
    modelUsage?: {
      [modelId: string]: number;
    };
  };
  metadata?: {
    legacyMigrated?: boolean;
    [key: string]: any;
  };
  lastLogin?: string;
}

export interface NutrientBreakdown {
  calories: number;        // kcal
  protein: number;         // g
  totalFat: number;        // g
  saturatedFat: number;    // g
  transFat?: number;       // g
  unsaturatedFat: number;  // g
  omega3: number;          // g
  carbohydrates: number;   // g
  sugar?: number;          // g, total sugar (natural + added)
  addedSugar?: number;     // g
  totalFibre: number;      // g
  solubleFibre: number;    // g
  sodium: number;          // mg
  potassium: number;       // mg
  magnesium: number;       // mg
  calcium: number;         // mg
  iron: number;            // mg
  zinc: number;            // mg
  selenium: number;        // mcg
  iodine: number;          // mcg
  phosphorus: number;      // mg
  vitaminD: number;        // IU
  vitaminB12: number;      // mcg
  folate: number;          // mcg
  vitaminC: number;        // mg
  vitaminE: number;        // mg
  vitaminK: number;        // mcg
  vitaminA: number;        // mcg
  vitaminB6: number;       // mg
  thiamine: number;        // mg
  riboflavin: number;      // mg
  niacin: number;          // mg
}

export interface PhysicalFormClassification {
  physicalForm: 'LIQUID_BEVERAGE' | 'SOLID_CHEESE_DAIRY' | 'VISCOUS_SAUCE' | 'SOLID_MEAT_FISH' | 'SOLID_GRAIN_BAKERY' | 'SOLID_FRUIT_VEG' | 'POWDER_OIL_FAT' | 'COMPOUND_MEAL' | 'UNKNOWN_SOLID';
  primaryCategory: string;
  matchedTokens: string[];
  explanation: string;
}

export interface FoodItemBreakdown {
  name: string;
  canonicalDbName?: string;
  originalLocalName?: string | null;
  weightGrams: number;
  calories: number;
  saturatedFat: number;
  sodium: number;
  dbSource?: string;
  dbId?: string | null;
  cookingMethod?: string | null;
  visualIngredients?: string[] | string | null;
  components?: string[] | string | null;
  confidenceRating?: 'Low' | 'Medium' | 'High';
  confidenceComment?: string;
  packGrams?: number | null;
  portionRatio?: number;
  portionAccepted?: boolean;
  portionDescription?: string;
  physicalFormClassification?: PhysicalFormClassification;
  matchReasonInfo?: {
    matchType?: string;
    physicalForm?: string;
    matchedKeywords?: string[];
    explanation?: string;
  };
  [key: string]: any;
}

export type SyncState = 'synced' | 'new' | 'update' | 'delete';

export interface FoodLog {
  id: string;
  date: string; // ISO string or YYYY-MM-DD
  name: string;
  composition: string;
  weightGrams: number;
  quantity: string;
  consumedAmount?: number;
  packGrams?: number | null;
  portionRatio?: number;
  portionAccepted?: boolean;
  portionDescription?: string;
  benefits?: string;
  risks?: string;
  healthImpact?: string;
  recommendation?: 'good' | 'bad' | 'neutral' | string;
  verdict?: { label?: string; level?: string };
  description?: string;
  message?: string;
  nutrients: NutrientBreakdown;
  imageUrl?: string;
  imageUrls?: string[];
  debugUrl?: string;
  itemsBreakdown?: FoodItemBreakdown[];
  scoutItems?: any[];
  chatTranscript?: { role: 'user' | 'assistant'; content: string; timestamp?: string }[];
  sync_state?: SyncState;
  updated_at?: number;
}

export interface BiomarkerValue {
  id: string;
  name: string;
  value: any;
  unit: string;
  category: string;
  status: 'normal' | 'low' | 'high' | 'critical' | 'unknown';
  timestamp: string; // ISO string
}

export interface ExtractedTestDetail {
  key: string;
  originalTestName?: string;
  valueNumeric?: number | null;
  valueString?: string | null;
  unit?: string;
  normalRange?: string;
  doctorComment?: string;
}

export interface BiomarkerLog {
  id: string;
  date: string; // YYYY-MM-DD
  biomarkers: { [key: string]: any };
  note?: string;
  summary?: string;
  tests?: ExtractedTestDetail[];
  sync_state?: SyncState;
  updated_at?: number;
  /** Same extract of the same report — upsert / same-day merge key */
  sourceReportId?: string;
  observationMeta?: {
    [key: string]: {
      rawUnit?: string;
      rawValue?: string | number;
      printedRange?: string;
      labFlag?: string;
    };
  };
}

export interface HealthAction {
  id: string;
  task: string;
  explanation: string;
  priority: 'high' | 'medium' | 'low';
  completed: boolean;
  type: 'doctor' | 'test' | 'lifestyle';
  testName?: string;
  timeframe?: string;
  createdAt?: number;
  updated_at?: number;
}

export interface DailyBenefit {
  id: string;
  activity: string;
  target: string;
  completed: boolean;
  updated_at?: number;
}

export interface InsightArticle {
  title: string;
  summary: string;
  link: string;
}

export interface HealthRiskForecast {
  year5: string;
  year10: string;
  year20: string;
  optimized5: string;
  optimized10: string;
  optimized20: string;
}

export interface FoodIdea {
  id: string;
  name: string;
  placeName?: string;
  address?: string;
  lat?: number;
  lng?: number;
  locationLink?: string;
  menuLink?: string;
  benefitExplanation: string;
  tags: string[];
  distanceKm?: number;
  estimatedBudget?: string;
  dishImageUrl?: string;
  openingHours?: string;
}

export interface RecommendationReport {
  timestamp: string;
  dailyNutrientTargets: { [key in keyof NutrientBreakdown]?: string } & { [key: string]: string | undefined };
  generalNutrientTargets?: any;
  weeklyNutrientTargets?: any;
  topWeeklyNutrientTargets?: any;
  mostImportantNextStep: string;
  actions: HealthAction[];
  dailyBenefits: DailyBenefit[];
  latestInsights: InsightArticle[];
  healthRiskForecast: HealthRiskForecast;
  healthBaselineCategories?: any[]; // Stores accepted risk-category analysis
  topNutrientTargets?: string[];
  nutrientRankingRationale?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  imageUrl?: string;
  imageUrls?: string[];
  agentUnavailable?: boolean;
  isError?: boolean;
  data?: Record<string, any>;
  pendingFoodLog?: any;
  pendingFoodIdeas?: any;
  pendingBiomarkers?: any;
  pendingBiomarkerEntries?: any;
  pendingCustomBiomarkerDefs?: any;
  proposal?: any;
  bucketMapping?: any;
  agentResult?: any;









  // parsed data for intermediate approval




  pendingProfile?: Partial<UserProfile>;
  pendingDate?: string;
  mode?: 'new_log' | 'discussion' | 'modify' | 'plan' | 'extract_chunk';
  status?: 'completed' | 'needs_continuation' | 'waiting_for_user';
  planningDetails?: {
    estimatedTotalMetrics: number | null;
    batchesRequired: number | null;
    maxMetricsPerBatch: number;
  };
  lastProcessedItem?: string | null;
  lastProcessedIndex?: number | null;
  modificationCommand?: {
    action: 'update_biomarker' | 'update_profile' | 'remove_biomarker';
    keyName: string;
    newValue?: string | number;
    date?: string;
  }[];


  agentType?: string | null;
  agentTypeStep?: string;
  extractedData?: string;
  isLive?: boolean;
  ingestTrace?: IngestTrace;
}

export type BiomarkerClassId =
  | 'IDENTITY_FALSE_FRIEND'
  | 'IDENTITY_PARALLEL_KEY'
  | 'CONFORMANCE_UNIT'
  | 'CONFORMANCE_SHAPE'
  | 'PLAUSIBILITY'
  | 'COMPLETENESS'
  | 'SILENT_REWRITE'
  | 'APPLY_MISS'
  | 'USE_SURFACE_LEAK'
  | 'WRONG_DOOR'
  | 'UPSERT_IDENTITY'
  | 'HALLUCINATED_KEY'
  | 'CURRENCY';

export type ClassId = BiomarkerClassId;

export interface IngestTraceRow {
  sourceRowIndex?: number;
  printedName?: string;
  rawValue?: number | string | null;
  rawUnit?: string;
  canonicalKey?: string;
  bucket?: 'high_confidence' | 'flagged' | 'unmatched' | 'skip';
  class?: ClassId;
  why?: string;
  date?: string | null;
  qualitativeValue?: string;
  printedRange?: string;
  comment?: string;
}

export interface IngestTrace {
  version: number;
  jobId?: string;
  sourceKind?: 'table' | 'prose' | 'image' | 'structured' | 'symptom';
  totalInputRows?: number;
  highConfidenceCount?: number;
  flaggedCount?: number;
  unmatchedCount?: number;
  skippedCount?: number;
  rows?: IngestTraceRow[];
  handoff?: {
    dualRawInjection?: boolean;
    sentToParserCount?: number;
    sentToReviewCount?: number;
  };
  abortedTablePath?: boolean;
  warnings?: string[];
  createdAt?: string;
}

export interface DbInteraction {
  id: string;
  timestamp: string;
  type: 'upload' | 'download' | 'delete' | 'sync';
  path: string;
  sizeBytes: number;
  status: 'pending' | 'completed' | 'failed';
  errorMessage?: string;
  startTimeMs: number;
  docCount?: number;
  database?: 'Firebase' | 'Supabase';
}

export interface QuotaData {
  date: string;
  reads: number;
  writes: number;
  deletes: number;
  imageCount?: number;
  imageStorageBytes?: number;
}

declare global {
  interface Window {
    sessionSyncTriggered?: boolean;
  }
}
