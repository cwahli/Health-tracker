import { NUTRIENT_KEYS } from './nutrientKeys';

export type NutrientKey = typeof NUTRIENT_KEYS[number];
export type NutrientMap = Partial<Record<NutrientKey, number>>;

export interface MealComponent {
  name: string;
  weightGrams?: number;
  calories?: number;
  nutrients?: NutrientMap;
  source?: string;
}

export interface MealFoodItem {
  itemId?: string;
  scoutIndex?: number;
  name?: string;
  canonicalDbName?: string;
  originalName?: string;
  originalLocalName?: string;
  keyword?: string;
  weightGrams?: number;
  estimatedWeightGrams?: number;
  estimatedCalories?: number;
  nutrients?: NutrientMap;
  nutrientStatus?: string;
  compositionStatus?: string;
  dbSource?: string;
  dbId?: string;
  cookingMethod?: string;
  visualIngredients?: string[];
  components?: any[]; // legacy
  componentsDetailList?: MealComponent[];
  hasComponents?: boolean;
  primaryBase100g?: any;
  primaryBaseMatchName?: string;
  primaryBaseWeightG?: number;
  labelNutrientsPerServing?: any;
  rawNutritionLabel?: any;
  lockedNutrientKeys?: string[];
  itemLockedKeys?: string[];
  truthNutrients?: any;
  cookingAdded?: any;
  ingredientsList?: string;
  chainName?: string;
  foodType?: string;
  warnings?: string[];
  confidenceRating?: number;
  confidenceComment?: string;
  physicalFormClassification?: string;
  matchReasonInfo?: string;
  diningEnvironment?: string;
  saucesDetailList?: any[];
  portionChoiceApplied?: any;
  fill?: any;
  [key: string]: any; // Index signature just in case
}

export interface MealContent {
  name?: string;
  description?: string;
  healthImpact?: string;
  benefits?: string[];
  risks?: string[];
  recommendation?: string;
  verdict?: string;
  message?: string;
  [key: string]: any;
}

export interface StageAuditRecord {
  stageKey: string;
  stage: string;
  attempt: number;
  timestamp: string;
  status: 'success' | 'error' | 'degraded';
  recovery?: string;
  actor?: string;
  message?: string;
}

export interface HistoryLogEntry {
  id: string;
  seq: number;
  timestamp: string;
  type: 'user_action' | 'stage_start' | 'stage_complete' | 'error';
  stage?: string;
  message?: string;
  details?: any;
}

export interface MealBuild {
  id: string;
  schemaVersion: 1;
  version: number;
  lastUpdatedBy?: string;
  lastUserAction?: string;
  historyLog?: HistoryLogEntry[];
  stageLimits?: Record<string, number>;
  mode: 'new_log' | 'edit' | 'compare_option';
  parentComparisonId?: string;
  items: MealFoodItem[];
  nutrients: NutrientMap;
  imageUrls?: string[];
  content?: MealContent;
  scoutSnapshot?: any;
  scoutContentType?: string;
  diningEnvironment?: string;
  cookingMethod?: string;
  scoutConfidence?: any;
  receiptTable?: any;
  dangerBadges?: any;
  biomarkerStatus?: any;
  savable?: boolean;
  lastCompletedStage?: string;
  degradedStages?: string[];
  stageLedger?: StageAuditRecord[];
  coldDebugUrl?: string;
  photoUrl?: string;
  portionClarify?: any;
  needsPortionClarify?: boolean;
  date?: string;
  weightGrams?: number;
  quantity?: number;
  basis_type?: string;
  composition?: string;
  message?: string;
  description?: string;
  healthImpact?: string;
  serving_grams?: number;
  updatedAt?: string;
  deletedItemIds?: string[];
  staleDietNarrative?: boolean;
  /** Backcompat: pre-rename stored meals carry staleDietitianNarrative. */
  staleDietitianNarrative?: boolean;
}

export interface ComparisonSet {
  id: string;
  schemaVersion: 1;
  version: number;
  mode: 'compare';
  optionMeals: MealBuild[];
  content?: any;
  isMenuScale?: boolean;
  stageLedger?: StageAuditRecord[];
  historyLog?: HistoryLogEntry[];
  selectedOptionMealId?: string;
  imageUrls?: string[];
  updatedAt?: string;
}
