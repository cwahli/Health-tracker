/**
 * Milestone 2 data-entry. Pure. No Gemini call in this file.
 * Confirmed rows stay in the milestone 0 record. This file does not write the log table.
 */
import {
  applyCleanup,
  confirmPassedParts,
  deleteSourceAllowed,
  openDescribedPdfBatch,
  openPageBatch,
  parseFlatResultXml,
  parseProse,
  proposeCleanup,
  routePdfPage,
  skipsLaboratoryRatio,
  editObservation,
  stageGrid,
  trackedMarkerCount,
  verifyAgreement,
  verifyGrid,
  verifyProse,
  type CleanupCard,
  type Marker,
  type PageRead,
  type PdfPageDescriptor,
  type Observation,
  type SourceBatch,
  type StagedRow,
} from './healthRecord';

export const READ_MODEL = 'gemini-3.5-flash-lite';
export const TIE_BREAK_MODEL = 'gemini-2.5-flash';
export const PHOTO_PROMPT_A = 'List every printed row: name, value, unit, when. Do not score the page.';
export const PHOTO_PROMPT_B = 'Transcribe the visible rows again, one tuple per row, including the printed unit.';

export function stageOnR2(batchId: string, files: Array<{ fileId: string }>): {
  writesLogTable: false;
  objects: Array<{ key: string }>;
} {
  return {
    writesLogTable: false,
    objects: files.map((file) => ({ key: `health-record/${batchId}/${file.fileId}` })),
  };
}

export function promptsDiffer(): boolean {
  const prompts = [PHOTO_PROMPT_A, PHOTO_PROMPT_B];
  return new Set(prompts).size === prompts.length;
}

export function enterPhotos(pages: Array<{ page: number; readA: PageRead; readB: PageRead; tie?: PageRead }>): {
  batch: SourceBatch;
  visionCalls: number;
  tieBreakModel: string | null;
  countablePages: number[];
} {
  let visionCalls = 0;
  let tieBreakModel: string | null = null;
  const resolved = pages.map((page) => {
    visionCalls += 2;
    if (verifyAgreement(page.readA, page.readB).passed) return page;
    visionCalls += 1;
    tieBreakModel = TIE_BREAK_MODEL;
    if (page.tie && verifyAgreement(page.readA, page.tie).passed) {
      return { ...page, readB: page.tie };
    }
    return page;
  });
  const batch = confirmPassedParts(openPageBatch(resolved));
  const countablePages = batch.parts.filter((part) => part.confirmed).map((part) => part.page || 0);
  return { batch, visionCalls, tieBreakModel, countablePages };
}

export function enterDescribedPdfs(files: Array<{ fileId: string; pages: PdfPageDescriptor[] }>): {
  batch: SourceBatch;
  visionCalls: number;
  doors: string[];
} {
  let visionCalls = 0;
  for (const file of files) {
    for (const page of file.pages) {
      const door = routePdfPage(page).door;
      if (door === 'ocr' || door === 'both') visionCalls += 2;
    }
  }
  const batch = openDescribedPdfBatch(files);
  return { batch, visionCalls, doors: batch.parts.map((part) => part.door || '') };
}

export function enterTextDoors(input: { gridCsv?: string; prose?: string; xml?: string }): {
  rows: StagedRow[];
  visionCalls: number;
  gridOk: boolean;
} {
  const rows: StagedRow[] = [];
  let gridOk = true;
  if (input.gridCsv) {
    const staged = stageGrid(input.gridCsv);
    rows.push(...staged);
    gridOk = verifyGrid(input.gridCsv, staged, []).ok;
  }
  if (input.prose) {
    const staged = parseProse(input.prose);
    rows.push(...staged);
    if (!verifyProse(input.prose, staged).ok) gridOk = false;
  }
  if (input.xml) rows.push(...parseFlatResultXml(input.xml));
  return { rows, visionCalls: 0, gridOk };
}

export function cleanupEntry(rows: StagedRow[], markers: Marker[], preferUnit?: string, decision: 'confirm' | 'reject' | 'pending' = 'pending'): {
  cards: CleanupCard[];
  observationsConfirmed: boolean;
  tracked: number;
  rawKept: number | null;
  numericValue: number | null;
  observationCount: number;
} {
  const cards = proposeCleanup(rows, markers, preferUnit);
  const card = cards.find((item) => item.kind === 'convert' || item.kind === 'name_merge' || item.kind === 'exact_duplicate') || cards[0];
  if (!card || decision === 'pending') {
    return {
      cards,
      observationsConfirmed: false,
      tracked: trackedMarkerCount({}),
      rawKept: rows[0]?.numericValue ?? null,
      numericValue: rows[0]?.numericValue ?? null,
      observationCount: rows.length,
    };
  }
  const applied = applyCleanup(card, rows, markers, decision);
  const confirmed = applied.observations.some((item) => item.confirmed);
  const changed = applied.observations[card.rowIndexes[0]];
  const raw = changed?.rawValue ?? rows[0]?.numericValue ?? null;
  const keys: Record<string, number> = {};
  for (const item of applied.observations) {
    if (item.confirmed && item.numericValue != null) keys[item.markerId || item.id] = item.numericValue;
  }
  return {
    cards,
    observationsConfirmed: confirmed,
    tracked: trackedMarkerCount({ current: keys }),
    rawKept: typeof raw === 'number' ? raw : rows[0]?.numericValue ?? null,
    numericValue: changed?.numericValue ?? null,
    observationCount: applied.observations.length,
  };
}

export function flagsSleepAsLabError(key: string): boolean {
  return !skipsLaboratoryRatio(key);
}

export function sourceCanBeDeleted(batch: SourceBatch): boolean {
  return deleteSourceAllowed(batch);
}

export function agentEditsObservation(observations: Observation[], id: string, value: number | string): Observation[] {
  return editObservation(observations, id, value);
}

export function historyEditsObservation(observations: Observation[], id: string, value: number | string): Observation[] {
  return editObservation(observations, id, value);
}
