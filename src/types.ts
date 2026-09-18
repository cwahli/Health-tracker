/**
 * Core type declarations and domain models for the health & nutrition platform.
 * 
 * Reconstructed under Q-11 parity guard to eliminate `any` aliases while
 * maintaining comprehensive structural contracts across all domains.
 */

// ============================================================================
// 1. User & Identity Models
// ============================================================================

export interface UserTargetBreakdown {
  calories?: number;
  protein?: number;
  totalFat?: number;
  saturatedFat?: number;
  carbohydrates?: number;
  totalFibre?: number;
  solubleFibre?: number;
  addedSugar?: number;
  sodium?: number;
  potassium?: number;
  [key: string]: number | undefined;
}

export interface PrioritizedCondition {
  id?: string;
  name: string;
  priority?: number;
  severity?: string;
  biomarkers?: { key: string; name?: string; target?: string | number }[];
  biomarkerKeys?: string[];
  dietaryRecommendations?: string[];
  [key: string]: any;
}

export interface CustomBiomarkerDef {
  key: string;
  name: string;
  unit: string;
  normalRange?: string;
  standardMedicalGrouping?: string;
  riskCategories?: string[];
  catalogApproved?: boolean;
  notes?: string;
  [key: string]: any;
}

export interface UserProfile {
  uid?: string;
  name?: string;
  email?: string;
  age?: number;
  gender?: 'male' | 'female' | 'other' | string;
  ethnicity?: string;
  heightCm?: number;
  weightKg?: number;
  language?: string;
  accountType?: string;
  credits?: number;
  targets?: UserTargetBreakdown;
  topTargetNutrientKeys?: string[];
  topNutrientsToMonitor?: string[];
  conditions?: string[];
  prioritizedConditions?: PrioritizedCondition[];
  medications?: string[];
  customBiomarkers?: Record<string, CustomBiomarkerDef>;
  pendingObservations?: PendingObservation[];
  preferences?: Record<string, any>;
  [key: string]: any;
}

// ============================================================================
// 2. Nutrition & Food Domain
// ============================================================================

export interface NutrientBreakdown {
  calories?: number;
  protein?: number;
  totalFat?: number;
  saturatedFat?: number;
  transFat?: number;
  unsaturatedFat?: number;
  omega3?: number;
  carbohydrates?: number;
  sugar?: number;
  addedSugar?: number;
  totalFibre?: number;
  solubleFibre?: number;
  sodium?: number;
  potassium?: number;
  magnesium?: number;
  calcium?: number;
  iron?: number;
  zinc?: number;
  selenium?: number;
  iodine?: number;
  phosphorus?: number;
  vitaminD?: number;
  vitaminB12?: number;
  folate?: number;
  vitaminC?: number;
  vitaminE?: number;
  vitaminK?: number;
  vitaminA?: number;
  vitaminB6?: number;
  thiamine?: number;
  riboflavin?: number;
  niacin?: number;
  [key: string]: number | undefined;
}

export interface NutrientTarget {
  key: string;
  name: string;
  targetValue: number;
  unit: string;
  isMaximum?: boolean;
  tolerance?: number;
}

export interface NutrientDef {
  key: string;
  name: string;
  unit: string;
  category?: 'macro' | 'mineral' | 'vitamin' | string;
  labels?: Record<string, string>;
}

export interface PhysicalFormClassification {
  physicalForm: string;
  primaryCategory: string;
  matchedTokens?: string[];
  explanation?: string;
  [key: string]: any;
}

export interface FoodItemBreakdown {
  name: string;
  canonicalDbName?: string;
  originalLocalName?: string;
  weightGrams?: number;
  calories?: number;
  protein?: number;
  totalFat?: number;
  saturatedFat?: number;
  carbohydrates?: number;
  totalFibre?: number;
  sugar?: number;
  sodium?: number;
  potassium?: number;
  physicalFormClassification?: PhysicalFormClassification;
  nutrients?: NutrientBreakdown;
  confidence?: number;
  scoutIndex?: number;
  [key: string]: any;
}

export interface FoodLog {
  id: string;
  name: string;
  date: string;
  time?: string;
  mealType?: 'breakfast' | 'lunch' | 'dinner' | 'snack' | string;
  calories?: number;
  nutrients?: NutrientBreakdown;
  items?: FoodItemBreakdown[];
  imageUrl?: string;
  imageUrls?: string[];
  photoUrl?: string;
  notes?: string;
  verified?: boolean;
  createdAt?: string | number;
  updatedAt?: string | number;
  [key: string]: any;
}

export interface FoodIdea {
  id?: string;
  title: string;
  description?: string;
  mealType?: string;
  tags?: string[];
  nutrients?: NutrientBreakdown;
  ingredients?: string[];
  prepTimeMinutes?: number;
  [key: string]: any;
}

export interface ComparisonSet {
  id?: string;
  title?: string;
  items?: any[];
  groups?: any[];
  verdict?: string;
  timestamp?: number;
  [key: string]: any;
}

// ============================================================================
// 3. Biomarker Domain
// ============================================================================

export type Severity = 'optimal' | 'normal' | 'warning' | 'critical' | 'low' | 'high' | string;

export interface SimpleRange {
  min?: number;
  max?: number;
  unit?: string;
}

export interface BracketRange {
  label: string;
  min?: number;
  max?: number;
  severity?: Severity;
  unit?: string;
  description?: string;
}

export interface CustomRangeFilter {
  ageMin?: number;
  ageMax?: number;
  sex?: 'male' | 'female' | 'all' | string;
  ethnicity?: string;
}

export interface CustomRangeDef {
  id?: string;
  key: string;
  name?: string;
  filter?: CustomRangeFilter;
  ranges?: BracketRange[];
  normalRange?: string;
  unit?: string;
  [key: string]: any;
}

export interface RangeConfig {
  biomarkerKey: string;
  ranges: BracketRange[];
  defaultUnit?: string;
  description?: string;
  [key: string]: any;
}

export interface BiomarkerLog {
  id?: string;
  date: string;
  biomarkers: Record<string, number | string>;
  notes?: string;
  tests?: any[];
  source?: string;
  createdAt?: string | number;
  [key: string]: any;
}

export interface BiomarkerEntry {
  biomarker: string;
  date: string;
  value: number | string;
  unit?: string;
  status?: string;
  referenceRange?: string;
  [key: string]: any;
}

export interface PendingObservation {
  id: string;
  printedName: string;
  suggestedKey: string;
  date: string;
  rawValue: string | number;
  rawUnit?: string;
  printedRange?: string;
  labFlag?: string;
  createdAt: number;
  status?: 'pending' | 'approved' | 'rejected';
  [key: string]: any;
}

export interface AnalyteConversionSpec {
  analyte: string;
  fromUnit: string;
  toUnit: string;
  factor: number;
  operation: 'multiply' | 'divide';
  notes?: string;
}

// ============================================================================
// 4. Ingestion, OCR & Trace Infrastructure
// ============================================================================

export type ClassId = string;

export interface IngestTraceRow {
  sourceRowIndex: number;
  bucket: 'skip' | 'high_confidence' | 'flagged' | 'unmatched';
  why?: string;
  printedName?: string;
  mappedKey?: string;
  rawValue?: string | number;
  parsedValue?: number;
  unit?: string;
  flag?: string;
  printedRange?: string;
  [key: string]: any;
}

export interface IngestTraceHandoff {
  dualRawInjection?: boolean;
  sentToParserCount?: number;
  sentToReviewCount?: number;
  [key: string]: any;
}

export interface IngestTrace {
  version: number;
  jobId?: string;
  sourceKind?: string;
  totalInputRows: number;
  highConfidenceCount: number;
  flaggedCount: number;
  unmatchedCount: number;
  skippedCount: number;
  rows: IngestTraceRow[];
  handoff: IngestTraceHandoff;
  [key: string]: any;
}

// ============================================================================
// 5. Health Actions, Reports & Benefits
// ============================================================================

export interface HealthAction {
  id?: string;
  title?: string;
  task?: string;
  explanation?: string;
  description?: string;
  category?: string;
  impact?: string;
  priority?: 'high' | 'medium' | 'low' | string;
  completed?: boolean;
  biomarkers?: string[];
  dueDate?: string;
  actionType?: string;
  type?: string;
  [key: string]: any;
}

export interface DailyBenefit {
  id?: string;
  title?: string;
  benefit?: string;
  explanation?: string;
  description?: string;
  category?: string;
  score?: number;
  icon?: string;
  biomarkersAffected?: string[];
  [key: string]: any;
}

export interface RecommendationReport {
  id?: string;
  date?: string;
  summary?: string;
  dailyNutrientTargets?: Record<string, number | string>;
  topTargetNutrientKeys?: string[];
  recommendations?: any[];
  actions?: HealthAction[];
  benefits?: DailyBenefit[];
  generatedAt?: string | number;
  [key: string]: any;
}

// ============================================================================
// 6. Chat, Agent & Job Messaging
// ============================================================================

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string | number;
  data?: any;
  isError?: boolean;
  agentUnavailable?: boolean;
  agentType?: string;
  [key: string]: any;
}

export interface SessionEvent {
  id?: string;
  sessionId: string;
  eventType: string;
  timestamp: number;
  payload?: any;
}

export interface UserActionBreadcrumb {
  timestamp: number;
  action: string;
  metadata?: Record<string, any>;
}

export interface AgentJobState {
  id: string;
  status: 'idle' | 'queued' | 'running' | 'processing' | 'succeeded' | 'failed' | 'cancelled' | 'draft' | 'cancel_requested';
  progress?: number;
  step?: string;
  result?: any;
  error?: string | null;
}

// ============================================================================
// 7. System, Quota & Database Auditing
// ============================================================================

export interface DbInteraction {
  id?: string;
  type: string;
  timestamp: string | number;
  collection?: string;
  docId?: string;
  success?: boolean;
  error?: string;
  details?: any;
  [key: string]: any;
}

export interface QuotaData {
  callsCount?: number;
  tokensCount?: number;
  resetDate?: string;
  limit?: number;
  isExceeded?: boolean;
  tier?: string;
  [key: string]: any;
}

export interface HistoryLogEntry {
  id: string;
  timestamp: string | number;
  type: string;
  data?: any;
  userUid?: string;
  [key: string]: any;
}
