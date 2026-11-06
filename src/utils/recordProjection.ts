/**
 * One projection over the date rows D1 already stores.
 * The SQL upsert, including the newer-than updated_at guard, stays in the database module.
 */
import {
  appendEvent,
  applyCleanup,
  deleteSourceAllowed,
  editObservation,
  normalizeLabel,
  openDescribedPdfBatch,
  openPageBatch,
  parseProse,
  projectHistoryScreen,
  proposeCleanup,
  retireColumn,
  sameDayLabsStay,
  stageGrid,
  type Diary,
  type DiaryCell,
  type DiaryEvent,
  type Observation,
  type PdfPageDescriptor,
  type SourceBatch,
  type StagedRow,
} from './healthRecord';

export const OBSERVATION_KEY = '__observations';
export const SYMPTOM_KEY = '__symptomEvents';

export interface ProjectionRow {
  id: string;
  date: string;
  biomarkers?: Record<string, unknown>;
  note?: string;
  summary?: string;
  tests?: unknown;
  updated_at?: string;
  firebase_uid?: string;
}

export function publicBiomarkerMap(biomarkers: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(biomarkers || {})) {
    if (!key.startsWith('__')) out[key] = value;
  }
  return out;
}

export function userMarkerKeys(profile: unknown): string[] {
  if (!profile || typeof profile !== 'object') return [];
  const record = profile as {
    customBiomarkers?: unknown;
    symptomDiaries?: Array<{ id?: string }>;
  };
  const keys = new Set<string>();
  const custom = record.customBiomarkers;
  if (Array.isArray(custom)) {
    for (const item of custom) {
      const key = (item as { key?: string })?.key;
      if (key) keys.add(key);
    }
  } else if (custom && typeof custom === 'object') {
    for (const key of Object.keys(custom)) keys.add(key);
  }
  for (const diary of record.symptomDiaries || []) {
    if (diary?.id) keys.add(diary.id);
  }
  return [...keys];
}

function observationsOf(row: ProjectionRow): Observation[] {
  const raw = row.biomarkers?.[OBSERVATION_KEY];
  return Array.isArray(raw) ? (raw as Observation[]) : [];
}

function symptomsOf(row: ProjectionRow): Array<{ cells?: DiaryCell[]; confirmed?: boolean }> {
  const raw = row.biomarkers?.[SYMPTOM_KEY];
  return Array.isArray(raw) ? raw : [];
}

function compatibilityMap(observations: Observation[]): Record<string, unknown> {
  const map: Record<string, unknown> = {};
  for (const item of observations) {
    if (!item.confirmed || item.kind === 'symptom') continue;
    if (item.numericValue === null || item.numericValue === undefined) {
      if (item.textValue) map[item.markerId] = item.textValue;
      continue;
    }
    map[item.markerId] = item.numericValue;
  }
  return map;
}

function stamp(row: ProjectionRow, observations: Observation[], symptoms: unknown[]): ProjectionRow {
  return {
    ...row,
    biomarkers: {
      ...compatibilityMap(observations),
      [OBSERVATION_KEY]: observations,
      [SYMPTOM_KEY]: symptoms,
    },
    updated_at: new Date().toISOString(),
  };
}

function ensureRow(rows: ProjectionRow[], date: string): { rows: ProjectionRow[]; index: number } {
  const index = rows.findIndex((row) => String(row.date).slice(0, 10) === date.slice(0, 10));
  if (index >= 0) return { rows, index };
  const next = rows.concat({ id: `bio_${date}`, date, biomarkers: {} });
  return { rows: next, index: next.length - 1 };
}

function readingObservation(printed: string, value: number | string, when: string, index: number): Observation {
  const numeric = typeof value === 'number' ? value : /^-?\d+(?:\.\d+)?$/.test(value) ? Number(value) : null;
  return {
    id: `obs-${normalizeLabel(printed)}-${when}-${index}`,
    markerId: normalizeLabel(printed) || 'marker',
    printed,
    numericValue: numeric,
    textValue: numeric === null ? String(value) : null,
    unit: null,
    rawValue: value,
    rawUnit: null,
    when,
    instant: when,
    kind: 'biomarker',
    cites: [],
    confirmed: true,
    comparator: null,
    analyteKey: normalizeLabel(printed),
  };
}

export function projectRead(rows: ProjectionRow[]) {
  const history = rows.map((row) => ({ biomarkers: publicBiomarkerMap(row.biomarkers) }));
  const symptomEvents = rows.flatMap(symptomsOf);
  const screen = projectHistoryScreen({ history, symptomEvents });
  return {
    labs: rows.map((row) => ({
      id: row.id,
      date: row.date,
      biomarkers: publicBiomarkerMap(row.biomarkers),
    })),
    symptomEvents,
    tracked: screen.tracked,
    logEntries: screen.logEntries,
  };
}

export function logIntoRows(
  rows: ProjectionRow[],
  input: { date: string; text?: string; gridCsv?: string; readings?: Record<string, number | string> },
): { rows: ProjectionRow[]; read: ReturnType<typeof projectRead> } {
  const found = ensureRow(rows.map((row) => ({ ...row, biomarkers: { ...(row.biomarkers || {}) } })), input.date);
  const working = found.rows;
  const row = working[found.index];
  let observations = observationsOf(row);
  let symptoms = symptomsOf(row);
  const staged: StagedRow[] = [];
  if (input.text) staged.push(...parseProse(input.text));
  if (input.gridCsv) staged.push(...stageGrid(input.gridCsv));
  for (const item of staged) {
    if (item.kind === 'symptom') {
      symptoms = symptoms.concat([{ cells: [{ columnId: 'note', value: item.textValue }], confirmed: true }]);
      continue;
    }
    if (item.numericValue === null) continue;
    observations = observations.concat([readingObservation(item.printed, item.numericValue, input.date, observations.length)]);
    if (item.unit) observations[observations.length - 1] = { ...observations[observations.length - 1], unit: item.unit, rawUnit: item.unit };
  }
  for (const [printed, value] of Object.entries(input.readings || {})) {
    observations = observations.concat([readingObservation(printed, value, input.date, observations.length)]);
  }
  working[found.index] = stamp(row, observations, symptoms);
  return { rows: working, read: projectRead(working) };
}

export function sameDayValuesStay(values: number[]): number[] {
  return sameDayLabsStay(values.map((numericValue) => ({ numericValue }))).map((item) => item.numericValue);
}

export function editInRows(rows: ProjectionRow[], observationId: string, value: number | string): ProjectionRow[] {
  return rows.map((row) => {
    const current = observationsOf(row);
    if (!current.some((item) => item.id === observationId)) return row;
    return stamp(row, editObservation(current, observationId, value), symptomsOf(row));
  });
}

export function deleteInRows(rows: ProjectionRow[], observationId: string): { rows: ProjectionRow[]; deletedIds: string[] } {
  const deletedIds: string[] = [];
  const next = rows.flatMap((row) => {
    const current = observationsOf(row);
    if (!current.some((item) => item.id === observationId)) return [row];
    const observations = current.filter((item) => item.id !== observationId);
    const symptoms = symptomsOf(row);
    if (observations.length === 0 && symptoms.length === 0 && Object.keys(publicBiomarkerMap(row.biomarkers)).length === 0) {
      deletedIds.push(row.id);
      return [];
    }
    const stamped = stamp(row, observations, symptoms);
    if (observations.length === 0 && symptoms.length === 0) {
      deletedIds.push(row.id);
      return [];
    }
    return [stamped];
  });
  return { rows: next, deletedIds };
}

export function confirmCleanupOnRows(
  rows: ProjectionRow[],
  input: { date: string; staged: StagedRow[]; preferUnit?: string; decision: 'confirm' | 'pending' },
): { rows: ProjectionRow[]; numericValue: number | null; rawValue: number | string | null; confirmed: boolean } {
  const cards = proposeCleanup(input.staged, [], input.preferUnit);
  const card = cards.find((item) => item.kind === 'convert') || cards[0];
  if (!card || input.decision !== 'confirm') {
    return { rows, numericValue: input.staged[0]?.numericValue ?? null, rawValue: input.staged[0]?.numericValue ?? null, confirmed: false };
  }
  const applied = applyCleanup(card, input.staged, [], 'confirm');
  const observations = applied.observations.map((item) => ({ ...item, confirmed: true }));
  const found = ensureRow(rows, input.date);
  const row = found.rows[found.index];
  found.rows[found.index] = stamp(row, observationsOf(row).concat(observations), symptomsOf(row));
  const changed = observations[card.rowIndexes[0]] || observations[0];
  return {
    rows: found.rows,
    numericValue: changed?.numericValue ?? null,
    rawValue: changed?.rawValue ?? null,
    confirmed: true,
  };
}

export function confirmSourceDecision(userConfirm: 'confirmed' | 'pending', everyPartPassed: boolean): boolean {
  const batch: SourceBatch = {
    id: 'source',
    userConfirm,
    parts: [{
      id: 'part-1',
      fileId: 'source',
      page: 1,
      status: everyPartPassed ? 'passed' : 'failed',
      confirmed: false,
    }],
    inFlight: [],
    waiting: [],
  };
  return deleteSourceAllowed(batch);
}

export function stagePhotoCount(count: number): SourceBatch {
  const pages = Array.from({ length: count }, (_unused, index) => {
    const page = index + 1;
    const read = { page, rows: [] as PageRows };
    return { page, readA: read, readB: { ...read, rows: [] } };
  });
  return openPageBatch(pages);
}

type PageRows = Array<{ printed: string; value: number | string | null; unit: string | null; when: string | null }>;

export function stagePdfFiles(files: Array<{ fileId: string; pages: PdfPageDescriptor[] }>): SourceBatch {
  return openDescribedPdfBatch(files);
}

export function changeDiary(diary: Diary, change: { append?: DiaryEvent; retireColumnId?: string; at?: string }): Diary {
  let next = change.append ? appendEvent(diary, change.append) : diary;
  if (change.retireColumnId) next = retireColumn(next, change.retireColumnId, change.at || '2024-06-02');
  return next;
}

export function applyRecordAction(rows: ProjectionRow[], args: Record<string, any>): Record<string, unknown> {
  const action = String(args.action || '');
  const date = String(args.date || '');
  if (action === 'log') {
    const logged = logIntoRows(rows, {
      date,
      text: typeof args.text === 'string' ? args.text : undefined,
      gridCsv: typeof args.grid === 'string' ? args.grid : undefined,
      readings: args.readings && typeof args.readings === 'object' ? args.readings : undefined,
    });
    const photos = typeof args.photoCount === 'number' ? stagePhotoCount(args.photoCount) : undefined;
    const pdfs = Array.isArray(args.pdfs) ? stagePdfFiles(args.pdfs) : undefined;
    const diary = args.diary ? changeDiary(args.diary, { append: args.diaryEvent, retireColumnId: args.retireColumnId, at: args.retiredAt }) : undefined;
    return { ...logged.read, rows: logged.rows, photos, pdfs, diary };
  }
  if (action === 'edit') {
    const next = editInRows(rows, String(args.observation_id || args.observationId || ''), args.value);
    return { ...projectRead(next), rows: next };
  }
  if (action === 'delete') {
    const removed = deleteInRows(rows, String(args.observation_id || args.observationId || ''));
    return { ...projectRead(removed.rows), rows: removed.rows, deletedIds: removed.deletedIds };
  }
  if (action === 'confirm_cleanup') {
    const staged = args.staged as StagedRow[] | undefined;
    const cleaned = confirmCleanupOnRows(rows, {
      date,
      staged: Array.isArray(staged) ? staged : [],
      preferUnit: args.preferUnit,
      decision: args.decision === 'confirm' ? 'confirm' : 'pending',
    });
    return { ...projectRead(cleaned.rows), rows: cleaned.rows, numericValue: cleaned.numericValue, rawValue: cleaned.rawValue, confirmed: cleaned.confirmed };
  }
  if (action === 'confirm_source') {
    return {
      ...projectRead(rows),
      rows,
      deleteSource: confirmSourceDecision(args.userConfirm === 'confirmed' ? 'confirmed' : 'pending', args.everyPartPassed === true),
    };
  }
  return { ...projectRead(rows), rows };
}
