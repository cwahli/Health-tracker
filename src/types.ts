export interface UserProfile {
  nickname: string;
  photoUrl: string;
  email: string;
  age: number | '';
  ethnicity: string;
  weight: number | ''; // kg
  height: number | ''; // cm
  bloodType?: string;
  gender?: string;
  timezone?: string;
  language: 'en' | 'fr' | 'zh' | 'id';
  fontSize?: 'tiny' | 'small' | 'normal' | 'large' | 'xl' | 'xxl';
  fontSizeTitle?: 'tiny' | 'small' | 'normal' | 'large' | 'xl' | 'xxl' | '3xl' | '4xl';
  fontSizeSubtitle?: 'tiny' | 'small' | 'normal' | 'large' | 'xl' | 'xxl' | '3xl';
  fontSizeDescription?: 'tiny' | 'small' | 'normal' | 'large' | 'xl' | 'xxl';
  fontSizeBodySmall?: 'tiny' | 'small' | 'normal' | 'large';
  fontSizeSubtitleSmall?: 'tiny' | 'small' | 'normal' | 'large' | 'xl';
  fontSizeKeyMetric?: 'tiny' | 'small' | 'normal' | 'large' | 'xl' | 'xxl' | '3xl' | '4xl' | '5xl' | '6xl';
  fontSizeXS?: 'tiny' | 'small' | 'normal';
  fontSizeBody?: 'tiny' | 'small' | 'normal' | 'large' | 'xl';
  fontFamily?: string;
  fontMono?: string;
  themePalette?: {
    button?: string;
    background?: string;
    border?: string;
    warning?: string;
    caution?: string;
    success?: string;
    text?: string;
    textSecondary?: string;
    bgApp?: string;
    bgCard?: string;
    neutralSetting?: string;
  };
  customBiomarkers?: {
    [key: string]: {
      name: string;
      unit: string;
      normalRange: string;
      description: string;
      benefitRisk?: string;
    }
  };
  lastUpdatedAt?: number;
}

export interface NutrientBreakdown {
  calories: number;        // kcal
  protein: number;         // g
  totalFat: number;        // g
  saturatedFat: number;    // g
  unsaturatedFat: number;  // g
  omega3: number;          // g
  carbohydrates: number;   // g
  addedSugar: number;      // g
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

export interface FoodItemBreakdown {
  name: string;
  weightGrams: number;
  calories: number;
  saturatedFat: number;
  sodium: number;
}

export interface FoodLog {
  id: string;
  date: string; // ISO string or YYYY-MM-DD
  name: string;
  composition: string;
  weightGrams: number;
  quantity: string;
  benefits: string;
  risks: string;
  healthImpact: string;
  recommendation: 'good' | 'bad' | 'neutral';
  nutrients: NutrientBreakdown;
  imageUrl?: string;
  imageUrls?: string[];
  itemsBreakdown?: FoodItemBreakdown[];
}

export interface BiomarkerValue {
  id: string;
  name: string;
  value: number | string;
  unit: string;
  category: string;
  status: 'normal' | 'low' | 'high' | 'critical' | 'unknown';
  timestamp: string; // ISO string
}

export interface BiomarkerLog {
  id: string;
  date: string; // YYYY-MM-DD
  biomarkers: { [key: string]: number | string };
  note?: string;
  summary?: string;
}

export interface HealthAction {
  id: string;
  task: string;
  explanation: string;
  priority: 'high' | 'medium' | 'low';
  completed: boolean;
  type: 'doctor' | 'test' | 'lifestyle';
}

export interface DailyBenefit {
  id: string;
  activity: string;
  target: string;
  completed: boolean;
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
  mostImportantNextStep: string;
  actions: HealthAction[];
  dailyBenefits: DailyBenefit[];
  latestInsights: InsightArticle[];
  healthRiskForecast: HealthRiskForecast;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  imageUrl?: string;
  imageUrls?: string[];
  // parsed data for intermediate approval
  pendingFoodLog?: Partial<FoodLog>;
  pendingFoodIdeas?: FoodIdea[];
  pendingBiomarkers?: { [key: string]: number | string };
  pendingProfile?: Partial<UserProfile>;
  pendingDate?: string;
  pendingCustomBiomarkerDefs?: {
    [key: string]: {
      name: string;
      unit: string;
      normalRange: string;
      description: string;
    }
  };
  proposal?: {
    name: string;
    metric: string;
    value: string | number;
    range: string;
    description: string;
    benefitRisk: string;
  };
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
}

export interface QuotaData {
  date: string;
  reads: number;
  writes: number;
  deletes: number;
  imageCount?: number;
  imageStorageBytes?: number;
}
