export type MatchKind = "alias" | "key" | "none";
export type WriteTarget = "observation" | "pending";

export interface IntakeRow {
  id: string;
  printed: string;
  value: number;
  unit: string;
  date: string;
}

export interface LogPoint {
  date: string;
  value: number;
  unit: string;
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
  date: string;
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
  match: MatchKind;
  key: string | null;
  writeTarget: WriteTarget;
  medicalInsight?: string;
  customRangeOverlay?: string | null;
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
}
