/** Prototype schema — strictly reflects docs/agent/domains/biomarkers.md and plan/BIOMARKER_FILL_TEMPLATE_CASES.md */

export type MatchKind = "key" | "alias" | "none";
export type WriteTarget = "observation" | "pending";

export interface LogPoint {
  date: string;
  value: number;
  unit?: string;
  comment?: string | null;
}

export interface IntakeRow {
  id: string;
  printed: string;
  value: number;
  unit: string;
  date: string;
  printedRange?: string;
  optimalValue?: string | number | null;
}

export interface CatalogSnapshot {
  key: string;
  name: string;
  unit: string;
  normalRange: string;
  description: string;
  riskCategories: string[];
  aliases: string[];
  customRangePopulation: string;
  notUsed: boolean;
}

export interface NewCatalogDraft {
  suggestedKey: string;
  name: string;
  unit: string;
  aliases: string[];
  normalRange: string;
  description: string;
  riskCategories: string[];
}

export interface DictionaryCorrection {
  field: string;
  correctedValue: string;
  reason: string;
}

/** Filled template row — dictionary slots locked on hits. */
export interface BiomarkerTemplate {
  id: string;
  printed: string;
  match: MatchKind;
  writeTarget: WriteTarget;
  // dictionary
  biomarkerName: string;
  key: string | null;
  alias: string[];
  normalRange: string;
  unit: string;
  description: string;
  riskCategories: string[];
  notUsed: boolean;
  customRangePopulation: string;
  printedRange?: string;
  assignedRange?: string;
  optimalValue?: string | number | null;
  existingInsight?: string | null;
  existingCustomRange?: string | null;
  editReason?: string | null;
  dictionaryCorrection?: DictionaryCorrection | null;
  // user
  customRangeOverlay: string | null;
  medicalInsight: string;
  historicalLogs: LogPoint[];
  currentEvaluationStatus: string;
  newCatalogDraft: NewCatalogDraft | null;
}

export interface ClassifiedRow {
  id: string;
  printed: string;
  value: number;
  unit: string;
  rawValue?: number;
  rawUnit?: string;
  date: string;
  printedRange?: string;
  assignedRange?: string;
  optimalValue?: string | number | null;
  existingInsight?: string | null;
  existingCustomRange?: string | null;
  mappedKey: string;
  match: MatchKind;
  writeTarget: WriteTarget;
  catalog: CatalogSnapshot | null;
  template: BiomarkerTemplate;
}

export interface FillRow {
  id: string;
  op: "add";
  printed: string;
  value: number;
  unit: string;
  date: string;
  printedRange?: string;
  assignedRange?: string;
  optimalValue?: string | number | null;
  editReason?: string | null;
  dictionaryCorrection?: DictionaryCorrection | null;
  match: MatchKind;
  key: string | null;
  writeTarget: WriteTarget;
  medicalInsight?: string;
  customRangeOverlay?: string | null;
  logs?: LogPoint[];
  newCatalogDraft: NewCatalogDraft | null;
}

export interface ExpectedRow {
  printed: string;
  value: number;
  unit: string;
  key: string | null;
  match: string;
  writeTarget: WriteTarget;
  draftSuggestedKey?: string;
  expectStatus?: string;
}

export interface ExpectedFile {
  id: string;
  date: string;
  expectRowCount: number;
  expectKnown: number;
  expectUnknown: number;
  rows: ExpectedRow[];
}

export interface CaseFile {
  id: string;
  message: string;
  date: string;
  batchSize?: number;
  images?: string[];
  rows: IntakeRow[];
  history?: Record<string, LogPoint[]>;
}

export interface ProfileFixture {
  age: number;
  gender: string;
  ethnicity: string;
  heightCm?: number;
  weightKg?: number;
  unitPreference?: string;
  language?: string;
  optimalValues?: Record<string, string | number>;
  existingInsights?: Record<string, string>;
  existingCustomRanges?: Record<string, string>;
}
