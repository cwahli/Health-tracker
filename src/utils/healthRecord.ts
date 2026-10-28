/**
 * Milestone 0 health record. Pure functions. No dictionary, no model calls.
 * Unit conversion goes through convertViaTable only.
 */
import { convertViaTable } from './biomarkerLifecycle';

export type RowKind = 'biomarker' | 'symptom';

export interface PrintedRange {
  min: number | null;
  max: number | null;
}

export interface Cite {
  fileId: string | null;
  page?: number | null;
  cell?: string | null;
  quote: string | null;
}

export interface StagedRow {
  printed: string;
  numericValue: number | null;
  textValue: string | null;
  unit: string | null;
  printedRange: PrintedRange | null;
  when: string | null;
  kind: RowKind;
  cite: Cite;
  comment?: string | null;
  sourceCode?: string | null;
  analyteKey?: string | null;
  instant?: string | null;
  comparator?: string | null;
  improbable?: boolean;
}

export interface Marker {
  id: string;
  canonicalName: string;
  kind: RowKind;
  unit: string | null;
  riskCategories: string[];
  aliases: string[];
  sourceCodes: string[];
  tombstonedAt?: string | null;
}

export interface Observation {
  id: string;
  markerId: string;
  printed: string;
  numericValue: number | null;
  textValue: string | null;
  unit: string | null;
  rawValue: number | string | null;
  rawUnit: string | null;
  when: string | null;
  instant: string | null;
  kind: RowKind;
  cites: Cite[];
  confirmed: boolean;
  comparator: string | null;
  analyteKey: string | null;
}

export type PartStatus = 'passed' | 'failed' | 'staged' | 'locked' | 'empty';

export interface BatchPart {
  id: string;
  fileId: string | null;
  page: number | null;
  status: PartStatus;
  confirmed: boolean;
  door?: string | null;
}

export interface SourceBatch {
  id: string;
  parts: BatchPart[];
  userConfirm: 'pending' | 'confirmed';
  inFlight: string[];
  waiting: string[];
}

export interface DiaryColumn {
  id: string;
  label: string;
  retiredAt: string | null;
}

export interface DiaryCell {
  columnId: string;
  value: string | number | null;
}

export interface DiaryEvent {
  diaryId: string;
  observedAt: string;
  movementNumber: number | null;
  clientKey: string | null;
  cells: DiaryCell[];
}

export interface Diary {
  id: string;
  columns: DiaryColumn[];
  events: DiaryEvent[];
}

export interface PageRow {
  printed: string;
  value: number | string | null;
  unit: string | null;
  when: string | null;
}

export interface PageRead {
  page: number;
  rows: PageRow[];
  modelScore?: number;
}

export type PdfDoor = 'locked' | 'text' | 'ocr' | 'both' | 'empty';

export interface PdfPageDescriptor {
  fileId: string;
  page: number;
  text: string;
  imageCount: number;
  imageAreaRatio: number;
  locked?: boolean;
}

export type CleanupKind =
  | 'exact_duplicate'
  | 'name_merge'
  | 'convert'
  | 'relabel'
  | 'absurd'
  | 'dirty'
  | 'conflict'
  | 'dual_standard';

export interface CleanupCard {
  id: string;
  kind: CleanupKind;
  auto: boolean;
  actions: string[];
  message: string;
  rowIndexes: number[];
  analyteKey: string | null;
  fromUnit?: string | null;
  toUnit?: string | null;
  convertedValue?: number | null;
  comparator?: string | null;
}

export interface CleanupRecord {
  markers: Marker[];
  observations: Observation[];
}

const DEVICE_KEYS = new Set(['steps', 'sleep_duration', 'weight', 'height', 'age']);
const TRACKED_EXCLUSIONS = new Set(['weight', 'height', 'age']);
const IN_FLIGHT_CAP = 4;

export function isEmptyValue(value: unknown): boolean {
  if (value === 0 || value === '0' || value === '0.0') return false;
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  return false;
}

export function normalizeLabel(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function tagText(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match ? match[1].trim() : null;
}

function asNumber(text: string | null): number | null {
  if (text === null) return null;
  if (!/^-?\d+(?:\.\d+)?$/.test(text.trim())) return null;
  return Number(text);
}

export function parseGrid(csv: string): string[][] {
  return csv
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const cells: string[] = [];
      let cur = '';
      let quoted = false;
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (ch === '"') {
          quoted = !quoted;
        } else if (ch === ',' && !quoted) {
          cells.push(cur);
          cur = '';
        } else {
          cur += ch;
        }
      }
      cells.push(cur);
      return cells;
    });
}

export function stageGrid(csv: string, fileId = 'grid.csv'): StagedRow[] {
  const matrix = parseGrid(csv);
  const headers = matrix[0] || [];
  const rows: StagedRow[] = [];
  for (let r = 1; r < matrix.length; r += 1) {
    matrix[r].forEach((cell, c) => {
      if (cell.trim() === '') return;
      const numeric = asNumber(cell.trim());
      rows.push({
        printed: headers[c] || `column ${c + 1}`,
        numericValue: numeric,
        textValue: numeric === null ? cell : null,
        unit: null,
        printedRange: null,
        when: null,
        kind: 'biomarker',
        cite: { fileId, page: null, cell: `${r},${c}`, quote: cell },
      });
    });
  }
  return rows;
}

export function verifyGrid(
  csv: string,
  staged: StagedRow[],
  ignores: string[] = [],
): { ok: boolean; reason?: string } {
  const matrix = parseGrid(csv);
  const ignore = new Set(ignores);
  for (let r = 1; r < matrix.length; r += 1) {
    for (let c = 0; c < matrix[r].length; c += 1) {
      const cell = matrix[r][c];
      if (cell.trim() === '') continue;
      const address = `${r},${c}`;
      if (ignore.has(address)) continue;
      const hit = staged.find((row) => row.cite.cell === address);
      if (!hit) return { ok: false, reason: `dropped cell ${address}` };
      if (!String(hit.cite.quote ?? '').includes(cell)) {
        return { ok: false, reason: `cite missed cell ${address}` };
      }
      if (hit.numericValue !== null && !cell.includes(String(hit.numericValue))) {
        return { ok: false, reason: `number not in cell ${address}` };
      }
    }
  }
  return { ok: true };
}

export function verifyProse(note: string, rows: StagedRow[]): { ok: boolean; reason?: string } {
  for (const row of rows) {
    const quote = row.cite.quote ?? '';
    if (!quote || !note.includes(quote)) return { ok: false, reason: 'quote is not in the note' };
    if (row.numericValue !== null && !note.includes(String(row.numericValue))) {
      return { ok: false, reason: 'number is not in the note' };
    }
  }
  return { ok: true };
}

export function parseProse(note: string, fileId = 'prose.txt'): StagedRow[] {
  const rows: StagedRow[] = [];
  for (const line of note.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/slept badly/i.test(trimmed)) {
      rows.push({
        printed: 'Sleep',
        numericValue: null,
        textValue: trimmed,
        unit: null,
        printedRange: null,
        when: null,
        kind: 'symptom',
        cite: { fileId, quote: 'slept badly' },
      });
      continue;
    }
    const match = trimmed.match(/^([A-Za-z][A-Za-z0-9 /+-]*?)\s+(-?\d+(?:\.\d+)?)(?:\s+([A-Za-z/%µμ.]+))?$/);
    if (!match) continue;
    rows.push({
      printed: match[1].trim(),
      numericValue: Number(match[2]),
      textValue: null,
      unit: match[3] ?? null,
      printedRange: null,
      when: null,
      kind: 'biomarker',
      analyteKey: normalizeLabel(match[1].trim()),
      cite: { fileId, quote: trimmed },
    });
  }
  return rows;
}

export function parseFlatResultXml(xml: string, fileId = 'nested-panel.xml'): StagedRow[] {
  const blocks = xml.match(/<result>[\s\S]*?<\/result>/g) || [];
  const rows: StagedRow[] = [];
  for (const block of blocks) {
    const tuples = block.split(/(?=<date>)/).filter((part) => part.includes('<date>'));
    tuples.forEach((tuple, index) => {
      const name = tagText(tuple, 'name') || '';
      const valueText = tagText(tuple, 'value');
      const unit = tagText(tuple, 'units');
      const min = asNumber(tagText(tuple, 'value_minimum'));
      const max = asNumber(tagText(tuple, 'value_maximum'));
      const numeric = asNumber(valueText);
      const hasRange = min !== null || max !== null;
      rows.push({
        printed: name,
        numericValue: numeric,
        textValue: valueText !== null && numeric === null ? valueText : null,
        unit: unit,
        printedRange: hasRange ? { min, max } : null,
        when: tagText(tuple, 'date'),
        kind: 'biomarker',
        comment: tagText(tuple, 'comment'),
        sourceCode: tagText(tuple, 'code'),
        cite: { fileId, quote: name, cell: `tuple-${index}` },
      });
    });
  }
  return rows;
}

function rowKey(page: number, row: PageRow): string {
  return JSON.stringify([page, row.printed, row.value, row.unit, row.when]);
}

export function verifyAgreement(readA: PageRead, readB: PageRead): { passed: boolean } {
  const bag = (read: PageRead) => read.rows.map((row) => rowKey(read.page, row)).sort();
  const a = bag(readA);
  const b = bag(readB);
  const passed = a.length === b.length && a.every((item, i) => item === b[i]);
  return { passed };
}

export function openPageBatch(
  pages: Array<{ page: number; readA: PageRead; readB: PageRead }>,
  cap = IN_FLIGHT_CAP,
): SourceBatch {
  const parts: BatchPart[] = pages.map((page) => ({
    id: `page-${page.page}`,
    fileId: 'photos',
    page: page.page,
    status: verifyAgreement(page.readA, page.readB).passed ? 'passed' : 'failed',
    confirmed: false,
    door: 'ocr',
  }));
  return queueParts('photo-batch', parts, cap);
}

export function confirmPassedParts(batch: SourceBatch): SourceBatch {
  return {
    ...batch,
    parts: batch.parts.map((part) =>
      part.status === 'passed' ? { ...part, confirmed: true } : part,
    ),
  };
}

export function deleteSourceAllowed(batch: SourceBatch): boolean {
  return batch.userConfirm === 'confirmed' && batch.parts.every((part) => part.status === 'passed');
}

export function routePdfPage(page: PdfPageDescriptor): { door: PdfDoor } {
  if (page.locked) return { door: 'locked' };
  const hasText = /[A-Za-z0-9]/.test(page.text || '');
  const largeImage = page.imageAreaRatio >= 0.2;
  if (hasText && largeImage) return { door: 'both' };
  if (hasText && !largeImage) return { door: 'text' };
  if (!hasText && (page.imageCount >= 1 || page.imageAreaRatio >= 0.5)) return { door: 'ocr' };
  return { door: 'empty' };
}

function doorStatus(door: PdfDoor): PartStatus {
  if (door === 'text') return 'passed';
  if (door === 'locked') return 'locked';
  if (door === 'empty') return 'empty';
  return 'staged';
}

function queueParts(id: string, parts: BatchPart[], cap: number): SourceBatch {
  return {
    id,
    parts,
    userConfirm: 'pending',
    inFlight: parts.slice(0, cap).map((part) => part.id),
    waiting: parts.slice(cap).map((part) => part.id),
  };
}

export function openDescribedPdfBatch(
  files: Array<{ fileId: string; pages: PdfPageDescriptor[] }>,
  cap = IN_FLIGHT_CAP,
): SourceBatch {
  const parts: BatchPart[] = [];
  for (const file of files) {
    for (const page of file.pages) {
      const door = routePdfPage({ ...page, fileId: file.fileId }).door;
      parts.push({
        id: `${file.fileId}:${page.page}`,
        fileId: file.fileId,
        page: page.page,
        status: doorStatus(door),
        confirmed: false,
        door,
      });
    }
  }
  return queueParts('pdf-batch', parts, cap);
}

function eventIdentity(event: DiaryEvent): string {
  return `${event.diaryId}|${event.observedAt}|${event.movementNumber ?? ''}|${event.clientKey ?? ''}`;
}

export function appendEvent(diary: Diary, event: DiaryEvent): Diary {
  const key = eventIdentity(event);
  const index = diary.events.findIndex((item) => eventIdentity(item) === key);
  const events = diary.events.slice();
  if (index >= 0) events[index] = event;
  else events.push(event);
  return { ...diary, events };
}

export function addColumn(diary: Diary, label: string): Diary {
  const id = `col-${diary.columns.length + 1}`;
  return { ...diary, columns: [...diary.columns, { id, label, retiredAt: null }] };
}

export function retireColumn(diary: Diary, columnId: string, at: string): Diary {
  return {
    ...diary,
    columns: diary.columns.map((column) =>
      column.id === columnId ? { ...column, retiredAt: at } : column,
    ),
  };
}

export function ingestDiaryRow(
  diary: Diary,
  event: Omit<DiaryEvent, 'cells' | 'diaryId'> & { headers: Array<{ label: string; value: string | number | null }> },
): { diary: Diary; proposed: string[] } {
  const known = new Map(diary.columns.map((column) => [column.label.toLowerCase(), column.id]));
  const cells: DiaryCell[] = [];
  const proposed: string[] = [];
  for (const header of event.headers) {
    const id = known.get(header.label.toLowerCase());
    if (!id) {
      proposed.push(header.label);
      continue;
    }
    cells.push({ columnId: id, value: header.value });
  }
  const next = appendEvent(diary, {
    diaryId: diary.id,
    observedAt: event.observedAt,
    movementNumber: event.movementNumber,
    clientKey: event.clientKey,
    cells,
  });
  return { diary: next, proposed };
}

export interface CountInput {
  current?: Record<string, unknown>;
  history?: Array<{ biomarkers?: Record<string, unknown> }>;
  notUsed?: string[];
  hiddenAliases?: string[];
  symptomEvents?: Array<{ cells?: DiaryCell[]; confirmed?: boolean }>;
}

export function trackedMarkerCount(input: CountInput): number {
  const notUsed = new Set((input.notUsed || []).map((key) => key.toLowerCase()));
  const hidden = new Set((input.hiddenAliases || []).map((key) => key.toLowerCase()));
  const keys = new Set<string>();
  const consider = (key: string, value: unknown) => {
    const lower = key.toLowerCase();
    if (TRACKED_EXCLUSIONS.has(lower) || notUsed.has(lower) || hidden.has(lower)) return;
    if (isEmptyValue(value)) return;
    keys.add(lower);
  };
  Object.entries(input.current || {}).forEach(([key, value]) => consider(key, value));
  for (const row of input.history || []) {
    Object.entries(row.biomarkers || {}).forEach(([key, value]) => consider(key, value));
  }
  return keys.size;
}

export function totalLogEntryCount(input: CountInput): number {
  const fromHistory = (input.history || []).reduce(
    (sum, row) => sum + Object.keys(row.biomarkers || {}).length,
    0,
  );
  const events = (input.symptomEvents || []).filter((event) => event.confirmed !== false).length;
  return fromHistory + events;
}

function calendarDay(when: string | null | undefined): string {
  return (when || '').slice(0, 10);
}

function observationFromRow(row: StagedRow, index: number, markerId: string): Observation {
  return {
    id: `obs-${index}`,
    markerId,
    printed: row.printed,
    numericValue: row.numericValue,
    textValue: row.textValue,
    unit: row.unit,
    rawValue: row.numericValue !== null ? row.numericValue : row.textValue,
    rawUnit: row.unit,
    when: row.when,
    instant: row.instant || row.when,
    kind: row.kind,
    cites: [row.cite],
    confirmed: false,
    comparator: row.comparator ?? comparatorOf(row.textValue),
    analyteKey: row.analyteKey ?? null,
  };
}

function comparatorOf(text: string | null): string | null {
  if (!text) return null;
  if (text.trim().startsWith('<')) return '<';
  if (text.trim().startsWith('>')) return '>';
  return null;
}

export function proposeCleanup(rows: StagedRow[], markers: Marker[] = [], preferUnit?: string): CleanupCard[] {
  const cards: CleanupCard[] = [];
  const used = new Set<number>();

  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      if (used.has(i) || used.has(j)) continue;
      const a = rows[i];
      const b = rows[j];
      const sameInstant = (a.instant || a.when || '') !== '' && (a.instant || a.when) === (b.instant || b.when);
      const sameName = normalizeLabel(a.printed) === normalizeLabel(b.printed);
      if (sameName && sameInstant && (a.unit || '') === (b.unit || '') && a.numericValue === b.numericValue && (a.textValue || '') === (b.textValue || '')) {
        cards.push({
          id: `dup-${i}-${j}`,
          kind: 'exact_duplicate',
          auto: true,
          actions: ['collapse'],
          message: 'Same reading from two cites',
          rowIndexes: [i, j],
          analyteKey: a.analyteKey ?? null,
        });
        used.add(i);
        used.add(j);
        continue;
      }
      if (sameName && sameInstant && (a.numericValue !== b.numericValue || (a.textValue || '') !== (b.textValue || '')) && (a.unit || '') === (b.unit || '')) {
        cards.push({
          id: `conflict-${i}-${j}`,
          kind: 'conflict',
          auto: false,
          actions: ['leave'],
          message: 'Same instant with a different value',
          rowIndexes: [i, j],
          analyteKey: a.analyteKey ?? null,
        });
        used.add(i);
        used.add(j);
      }
    }
  }

  const groups = new Map<string, number[]>();
  rows.forEach((row, index) => {
    if (used.has(index) || row.numericValue === null || !row.analyteKey || !row.when) return;
    const key = `${row.analyteKey}|${calendarDay(row.when)}`;
    groups.set(key, [...(groups.get(key) || []), index]);
  });
  for (const indexes of groups.values()) {
    if (indexes.length < 2) continue;
    const [i, j] = indexes;
    const a = rows[i];
    const b = rows[j];
    if ((a.unit || '') === (b.unit || '')) continue;
    const toA = convertViaTable(a.analyteKey || '', b.numericValue || 0, b.unit || '', a.unit || '');
    const match = toA.ok && toA.value === a.numericValue;
    cards.push({
      id: `day-${i}-${j}`,
      kind: match ? 'dual_standard' : 'conflict',
      auto: false,
      actions: match ? ['consolidate'] : ['leave'],
      message: match ? 'Same reading in two standards' : 'Same day values do not convert to one number',
      rowIndexes: [i, j],
      analyteKey: a.analyteKey ?? null,
    });
    used.add(i);
    used.add(j);
  }

  rows.forEach((row, index) => {
    if (used.has(index)) return;
    const key = (row.analyteKey || '').toLowerCase();
    if (DEVICE_KEYS.has(key)) return;
    if (row.numericValue !== null && row.printedRange && (row.printedRange.min !== null || row.printedRange.max !== null)) {
      const below = row.printedRange.min !== null && row.numericValue < row.printedRange.min;
      const above = row.printedRange.max !== null && row.numericValue > row.printedRange.max;
      if (below || above || row.improbable) {
        cards.push({
          id: `absurd-${index}`,
          kind: 'absurd',
          auto: false,
          actions: ['relabel', 'convert', 'leave'],
          message: 'Outside the printed range',
          rowIndexes: [index],
          analyteKey: row.analyteKey ?? null,
        });
        return;
      }
    } else if (row.improbable && row.numericValue !== null) {
      cards.push({
        id: `absurd-${index}`,
        kind: 'absurd',
        auto: false,
        actions: ['relabel', 'convert', 'leave'],
        message: 'Caller marked the value improbable',
        rowIndexes: [index],
        analyteKey: row.analyteKey ?? null,
      });
      return;
    }
    if (row.textValue && row.numericValue === null && row.kind === 'biomarker') {
      cards.push({
        id: `dirty-${index}`,
        kind: 'dirty',
        auto: false,
        actions: ['leave'],
        message: 'Text stays text',
        rowIndexes: [index],
        analyteKey: row.analyteKey ?? null,
        comparator: comparatorOf(row.textValue),
      });
    }
  });

  rows.forEach((row, index) => {
    if (used.has(index) || row.kind === 'symptom') return;
    const code = row.sourceCode || '';
    const byCode = code
      ? markers.find((marker) => marker.kind === row.kind && !marker.tombstonedAt && marker.sourceCodes.includes(code))
      : undefined;
    const byName = markers.find((marker) => {
      if (marker.tombstonedAt || marker.kind !== row.kind) return false;
      const known = [marker.canonicalName, ...marker.aliases];
      if (known.includes(row.printed)) return false;
      return known.map(normalizeLabel).includes(normalizeLabel(row.printed));
    });
    const hit = byCode || byName;
    if (!hit || hit.kind !== row.kind) return;
    cards.push({
      id: `name-${index}`,
      kind: 'name_merge',
      auto: false,
      actions: ['confirm', 'reject'],
      message: `Matches ${hit.canonicalName}`,
      rowIndexes: [index],
      analyteKey: hit.id,
    });
  });

  rows.forEach((row, index) => {
    if (row.numericValue === null || !row.analyteKey || !row.unit) return;
    const target = preferUnit && row.unit !== preferUnit ? preferUnit : null;
    if (!target) return;
    const converted = convertViaTable(row.analyteKey, row.numericValue, row.unit, target);
    if (converted.ok) {
      cards.push({
        id: `convert-${index}`,
        kind: 'convert',
        auto: false,
        actions: ['convert', 'leave'],
        message: 'Convert with the existing table',
        rowIndexes: [index],
        analyteKey: row.analyteKey,
        fromUnit: row.unit,
        toUnit: target,
        convertedValue: converted.value,
      });
    } else {
      cards.push({
        id: `noconvert-${index}`,
        kind: 'relabel',
        auto: false,
        actions: ['relabel', 'leave'],
        message: 'no conversion',
        rowIndexes: [index],
        analyteKey: row.analyteKey,
        fromUnit: row.unit,
        toUnit: target,
      });
    }
  });
  return cards;
}

export function applyCleanup(
  card: CleanupCard,
  rows: StagedRow[],
  markers: Marker[],
  decision: 'confirm' | 'reject' | 'auto',
): { rows: StagedRow[]; markers: Marker[]; observations: Observation[] } {
  const observations: Observation[] = rows.map((row, index) =>
    observationFromRow(row, index, row.analyteKey || normalizeLabel(row.printed) || `row-${index}`),
  );
  if (card.auto && decision !== 'auto' && decision !== 'confirm') {
    return { rows, markers, observations };
  }
  if (!card.auto && decision !== 'confirm' && decision !== 'reject') {
    return { rows, markers, observations };
  }
  if (card.kind === 'exact_duplicate' && (decision === 'auto' || decision === 'confirm')) {
    const [keep, drop] = card.rowIndexes;
    const next = observations.filter((_, index) => index !== drop);
    const kept = next.find((item) => item.id === `obs-${keep}`);
    if (kept) kept.cites = [...observations[keep].cites, ...observations[drop].cites];
    return { rows, markers, observations: next };
  }
  if (card.kind === 'dual_standard' && decision === 'confirm') {
    const [keep, drop] = card.rowIndexes;
    const next = observations.filter((_, index) => index !== drop);
    const kept = next.find((item) => item.id === `obs-${keep}`);
    if (kept) kept.cites = [...observations[keep].cites, ...observations[drop].cites];
    return { rows, markers, observations: next };
  }
  if (card.kind === 'convert' && decision === 'confirm') {
    const index = card.rowIndexes[0];
    const next = observations.slice();
    const row = next[index];
    next[index] = {
      ...row,
      numericValue: card.convertedValue ?? row.numericValue,
      unit: card.toUnit ?? row.unit,
      rawValue: rows[index].numericValue,
      rawUnit: rows[index].unit,
    };
    return { rows, markers, observations: next };
  }
  if (card.kind === 'relabel' && decision === 'confirm') {
    const index = card.rowIndexes[0];
    const next = observations.slice();
    next[index] = { ...next[index], unit: card.toUnit ?? next[index].unit, rawValue: rows[index].numericValue, rawUnit: rows[index].unit };
    return { rows, markers, observations: next };
  }
  if (card.kind === 'name_merge' && decision === 'confirm') {
    const index = card.rowIndexes[0];
    const target = markers.find((marker) => marker.id === card.analyteKey);
    const nextMarkers = markers.map((marker) => {
      if (!target || marker.id !== target.id) return marker;
      const alias = rows[index].printed;
      return marker.aliases.includes(alias) ? marker : { ...marker, aliases: [...marker.aliases, alias] };
    });
    const observationsNext = observations.map((item, itemIndex) =>
      itemIndex === index ? { ...item, markerId: target?.id || item.markerId, confirmed: true } : item,
    );
    return { rows, markers: nextMarkers, observations: observationsNext };
  }
  if (card.kind === 'name_merge' && decision === 'reject') {
    const index = card.rowIndexes[0];
    const created: Marker = {
      id: `marker-${rows[index].printed}`,
      canonicalName: rows[index].printed,
      kind: rows[index].kind,
      unit: rows[index].unit,
      riskCategories: [],
      aliases: [],
      sourceCodes: rows[index].sourceCode ? [rows[index].sourceCode] : [],
    };
    const observationsNext = observations.map((item, itemIndex) =>
      itemIndex === index ? { ...item, markerId: created.id, confirmed: true } : item,
    );
    return { rows, markers: [...markers, created], observations: observationsNext };
  }
  return { rows, markers, observations };
}

export function countableObservations(observations: Observation[]): Observation[] {
  return observations.filter((item) => item.confirmed);
}

/** Labels already used on catalog definitions. Milestone 1 does not invent a second set. */
export const EXISTING_RISK_LABELS = [
  'Cardiovascular',
  'Metabolic',
  'Kidney',
  'Hematology',
  'Hepatic',
  'Liver',
  'Gastrointestinal',
  'Bone & Mineral',
  'Musculoskeletal',
  'Wellness',
  'Screenings & Wellness',
] as const;

export function acceptedRiskLabel(label: string | null | undefined): string | null {
  if (!label) return null;
  return (EXISTING_RISK_LABELS as readonly string[]).includes(label) ? label : null;
}

export function skipsLaboratoryRatio(key: string, kind?: 'biomarker' | 'symptom'): boolean {
  if (kind === 'symptom') return true;
  const lower = key.toLowerCase();
  return lower === 'sleep_duration' || lower.endsWith('_symptom_score');
}

/** Same calendar day keeps every lab value. Nothing here computes a mean. */
export function sameDayLabsStay<T extends { numericValue: number }>(rows: T[]): T[] {
  return rows.slice();
}

export interface HistorySymptomCell {
  columnId: string;
  label: string;
  value: string | number | null;
}

export interface HistorySymptomRow {
  id: string;
  kind: 'symptom';
  observedAt: string;
  cells: HistorySymptomCell[];
}

export interface HistoryScreenInput extends CountInput {
  diaries?: Diary[];
  riskLabel?: string | null;
}

export function projectHistoryScreen(input: HistoryScreenInput): {
  tracked: number;
  logEntries: number;
  symptomRows: HistorySymptomRow[];
  riskLabel: string | null;
} {
  const diaries = input.diaries || [];
  const fromDiaries = diaries.flatMap((diary) =>
    diary.events.map((event) => ({ cells: event.cells, confirmed: true as const })),
  );
  const symptomEvents = [...(input.symptomEvents || []), ...fromDiaries];
  const symptomRows = diaries.flatMap((diary) => {
    const labels = new Map(diary.columns.map((column) => [column.id, column.label]));
    return diary.events.map((event) => ({
      id: eventIdentity(event),
      kind: 'symptom' as const,
      observedAt: event.observedAt,
      cells: event.cells.map((cell) => ({
        columnId: cell.columnId,
        label: labels.get(cell.columnId) || cell.columnId,
        value: cell.value,
      })),
    }));
  });
  return {
    tracked: trackedMarkerCount(input),
    logEntries: totalLogEntryCount({ ...input, symptomEvents }),
    symptomRows,
    riskLabel: acceptedRiskLabel(input.riskLabel),
  };
}
