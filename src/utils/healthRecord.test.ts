import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  addColumn,
  appendEvent,
  applyCleanup,
  confirmPassedParts,
  deleteSourceAllowed,
  ingestDiaryRow,
  openDescribedPdfBatch,
  openPageBatch,
  parseFlatResultXml,
  parseProse,
  proposeCleanup,
  retireColumn,
  routePdfPage,
  stageGrid,
  totalLogEntryCount,
  trackedMarkerCount,
  verifyAgreement,
  verifyGrid,
  verifyProse,
  type Diary,
  type Marker,
  type PageRead,
  type PdfPageDescriptor,
  type StagedRow,
} from './healthRecord';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const fixture = (name: string) => readFileSync(path.join(root, 'tests/fixtures/health-record', name), 'utf8');

function row(partial: Partial<StagedRow> & Pick<StagedRow, 'printed'>): StagedRow {
  return {
    numericValue: null,
    textValue: null,
    unit: null,
    printedRange: null,
    when: null,
    kind: 'biomarker',
    cite: { fileId: 't', quote: partial.printed },
    ...partial,
  };
}

const marker = (partial: Partial<Marker> & Pick<Marker, 'id' | 'canonicalName'>): Marker => ({
  kind: 'biomarker',
  unit: null,
  riskCategories: ['Hematology'],
  aliases: [],
  sourceCodes: [],
  ...partial,
});

describe('health record milestone 0', () => {
  it('grid drops a cell and fails', () => {
    const csv = fixture('grid.csv');
    const staged = stageGrid(csv).filter((item) => item.cite.cell !== '1,2');
    expect(verifyGrid(csv, staged).ok).toBe(false);
  });

  it('grid rejects a number that is not in the cell', () => {
    const csv = fixture('grid.csv');
    const staged = stageGrid(csv).map((item) =>
      item.cite.cell === '1,1' ? { ...item, numericValue: 4, cite: { ...item.cite, quote: '3' } } : item,
    );
    expect(verifyGrid(csv, staged).ok).toBe(false);
    expect(verifyGrid(csv, stageGrid(csv)).ok).toBe(true);
  });

  it('prose rejects an invented number', () => {
    const note = fixture('prose.txt');
    const invented = row({ printed: 'HDL', numericValue: 999, cite: { fileId: 'prose.txt', quote: '999' } });
    expect(verifyProse(note, [invented]).ok).toBe(false);
  });

  it('prose keeps a non-numeric symptom sentence', () => {
    const note = fixture('prose.txt');
    const parsed = parseProse(note);
    const sleep = parsed.find((item) => item.kind === 'symptom');
    expect(sleep?.textValue).toMatch(/slept badly/i);
    expect(sleep?.numericValue).toBeNull();
    expect(verifyProse(note, parsed).ok).toBe(true);
  });

  it('flat result keeps every sibling tuple', () => {
    const parsed = parseFlatResultXml(fixture('nested-panel.xml'));
    expect(parsed.map((item) => item.printed)).toEqual(['Panel header', 'Alpha', 'Beta', 'Gamma']);
  });

  it('panel header without a value is not a number', () => {
    const header = parseFlatResultXml(fixture('nested-panel.xml'))[0];
    expect(header.numericValue).toBeNull();
    expect(header.comment).toBe('Panel comment');
    expect(parseFlatResultXml(fixture('nested-panel.xml'))[1].comment).toBe('Alpha comment');
  });

  it('printed range stays on the row', () => {
    const alpha = parseFlatResultXml(fixture('nested-panel.xml'))[1];
    expect(alpha.printedRange).toEqual({ min: 0.8, max: 2 });
  });

  it('unitless synthetic row keeps a null unit', () => {
    const gamma = parseFlatResultXml(fixture('nested-panel.xml'))[3];
    expect(gamma.numericValue).toBe(1.4);
    expect(gamma.unit).toBeNull();
    expect(gamma.printedRange).toEqual({ min: 0.8, max: 2 });
  });

  it('xml zero value stays numeric', () => {
    const beta = parseFlatResultXml(fixture('nested-panel.xml'))[2];
    expect(beta.numericValue).toBe(0);
  });

  const pages = JSON.parse(fixture('pages-10.json')).pages as Array<{
    page: number;
    modelScore: number;
    rows: PageRead['rows'];
    dropped?: PageRead['rows'][number];
  }>;
  const photoPages = pages.map((page) => {
    const readA: PageRead = { page: page.page, rows: page.rows, modelScore: page.modelScore };
    const readB: PageRead = {
      page: page.page,
      rows: page.dropped ? page.rows.filter((item) => item.printed !== page.dropped?.printed) : page.rows,
      modelScore: page.modelScore,
    };
    return { page: page.page, readA, readB };
  });

  it('ten pages share one batch', () => {
    const batch = openPageBatch(photoPages);
    expect(batch.id).toBeTruthy();
    expect(new Set(batch.parts.map(() => batch.id)).size).toBe(1);
    expect(batch.parts).toHaveLength(10);
    expect(batch.inFlight).toHaveLength(4);
    expect(batch.waiting).toHaveLength(6);
  });

  it('disagreed page stays uncounted', () => {
    const batch = confirmPassedParts(openPageBatch(photoPages));
    const failed = batch.parts.find((part) => part.page === 7);
    expect(failed?.status).toBe('failed');
    expect(failed?.confirmed).toBe(false);
    const counted = batch.parts.filter((part) => part.confirmed).length;
    expect(counted).toBe(9);
  });

  it('agreed pages can confirm while one page failed', () => {
    const batch = confirmPassedParts(openPageBatch(photoPages));
    expect(batch.parts.filter((part) => part.page !== 7).every((part) => part.confirmed)).toBe(true);
    expect(batch.parts.find((part) => part.page === 7)?.confirmed).toBe(false);
  });

  it('model score cannot mark verify passed', () => {
    const page = photoPages.find((item) => item.page === 7)!;
    expect(page.readA.modelScore).toBe(100);
    expect(verifyAgreement(page.readA, page.readB).passed).toBe(false);
  });

  it('source delete needs every part passed and user confirm', () => {
    const batch = openPageBatch(photoPages);
    expect(deleteSourceAllowed(batch)).toBe(false);
    expect(deleteSourceAllowed({ ...batch, userConfirm: 'confirmed' })).toBe(false);
    const cleared = {
      ...batch,
      userConfirm: 'confirmed' as const,
      parts: batch.parts.map((part) => ({ ...part, status: 'passed' as const })),
    };
    expect(deleteSourceAllowed(cleared)).toBe(true);
  });

  const diary = JSON.parse(fixture('symptom-diary.json')) as Diary;

  it('append keeps earlier diary logs', () => {
    const next = appendEvent(diary, {
      diaryId: diary.id,
      observedAt: '2024-06-08T08:00:00',
      movementNumber: 1,
      clientKey: null,
      cells: [{ columnId: 'col-9', value: 2 }],
    });
    expect(next.events).toHaveLength(2);
    expect(next.events[0].observedAt).toBe(diary.events[0].observedAt);
  });

  it('same movement key does not double', () => {
    const again = appendEvent(diary, { ...diary.events[0], cells: [{ columnId: 'col-9', value: 1 }] });
    expect(again.events).toHaveLength(1);
    expect(again.events[0].cells[0].value).toBe(1);
  });

  it('added column does not shift old cells', () => {
    const next = addColumn(diary, 'Sitz bath');
    expect(next.columns).toHaveLength(18);
    expect(next.events[0].cells.map((cell) => cell.columnId)).toEqual(['col-9', 'col-10']);
  });

  it('retired column stays on old logs and is absent from new logs', () => {
    const withVolume = appendEvent(diary, {
      ...diary.events[0],
      cells: [...diary.events[0].cells, { columnId: 'col-3', value: 'large' }],
    });
    const retired = retireColumn(withVolume, 'col-3', '2024-06-02');
    const ingested = ingestDiaryRow(retired, {
      observedAt: '2024-06-03T08:00:00',
      movementNumber: 1,
      clientKey: null,
      headers: [{ label: 'Anal pain', value: 1 }],
    });
    expect(retired.events[0].cells.some((cell) => cell.columnId === 'col-3')).toBe(true);
    expect(ingested.diary.events[1].cells.some((cell) => cell.columnId === 'col-3')).toBe(false);
    expect(retired.columns.find((column) => column.id === 'col-3')?.retiredAt).toBe('2024-06-02');
  });

  it('unknown header is proposed and known cells still save', () => {
    const ingested = ingestDiaryRow(diary, {
      observedAt: '2024-06-04T08:00:00',
      movementNumber: 1,
      clientKey: null,
      headers: [
        { label: 'Anal pain', value: 2 },
        { label: 'Sit-bath relief', value: 'yes' },
      ],
    });
    expect(ingested.proposed).toEqual(['Sit-bath relief']);
    expect(ingested.diary.columns).toHaveLength(17);
    expect(ingested.diary.events[1].cells).toEqual([{ columnId: 'col-9', value: 2 }]);
  });

  it('fewer columns do not shift the rest', () => {
    const ingested = ingestDiaryRow(diary, {
      observedAt: '2024-06-05T08:00:00',
      movementNumber: 1,
      clientKey: null,
      headers: [
        { label: 'Anal pain', value: 4 },
        { label: 'Notes', value: 'shorter row' },
      ],
    });
    const cells = ingested.diary.events[1].cells;
    expect(cells.map((cell) => cell.columnId)).toEqual(['col-9', 'col-17']);
    expect(cells[1].value).toBe('shorter row');
  });

  it('two symptom events on one day both remain', () => {
    const first = appendEvent(diary, {
      diaryId: diary.id,
      observedAt: '2024-06-01T09:00:00',
      movementNumber: 2,
      clientKey: null,
      cells: [{ columnId: 'col-9', value: 3 }],
    });
    const sameDay = first.events.filter((event) => event.observedAt.startsWith('2024-06-01'));
    expect(sameDay).toHaveLength(2);
  });

  it('zero pain is stored', () => {
    const pain = diary.events[0].cells.find((cell) => cell.columnId === 'col-9');
    expect(pain?.value).toBe(0);
  });

  it('tracked count matches the history sheet rules', () => {
    const count = trackedMarkerCount({
      current: { ldl: 1, empty: '' },
      history: [
        { biomarkers: { hdl: 50, weight: 80 } },
        { biomarkers: { trig: 125, hidden: 1 } },
      ],
      notUsed: ['hidden'],
    });
    expect(count).toBe(3);
  });

  it('total log entries count events not columns', () => {
    const historySum = [{ biomarkers: { hdl: 50, weight: 80 } }, { biomarkers: { trig: 125, hidden: 1 } }].reduce(
      (sum, row) => sum + Object.keys(row.biomarkers).length,
      0,
    );
    expect(totalLogEntryCount({
      history: [
        { biomarkers: { hdl: 50, weight: 80 } },
        { biomarkers: { trig: 125, hidden: 1 } },
      ],
      symptomEvents: [{ cells: diary.events[0].cells, confirmed: true }],
    })).toBe(historySum + 1);
    expect(diary.events[0].cells.length).toBeGreaterThan(1);
  });

  it('fixtures have no personal name', () => {
    const names = ['grid.csv', 'prose.txt', 'nested-panel.xml', 'pages-10.json', 'pdf-pages.json', 'symptom-diary.json', 'README.md'];
    const blob = names.map((name) => fixture(name)).join('\n');
    expect(blob).not.toMatch(/date_of_birth|Evergreen|chiwah/i);
  });

  const dup = (value: number, quote: string): StagedRow => row({
    printed: 'HDL',
    numericValue: value,
    unit: 'mg/dL',
    when: '2024-01-02T00:00:00',
    instant: '2024-01-02T00:00:00',
    analyteKey: 'hdl',
    cite: { fileId: 'a', quote },
  });

  it('exact duplicate keeps one value and two cites', () => {
    const rows = [dup(50, 'a'), dup(50, 'b')];
    const card = proposeCleanup(rows).find((item) => item.kind === 'exact_duplicate');
    expect(card?.auto).toBe(true);
    const applied = applyCleanup(card!, rows, [], 'auto');
    expect(applied.observations).toHaveLength(1);
    expect(applied.observations[0].numericValue).toBe(50);
    expect(applied.observations[0].cites).toHaveLength(2);
  });

  it('same instant with a different value is a conflict', () => {
    const rows = [dup(50, 'a'), dup(48, 'b')];
    const card = proposeCleanup(rows).find((item) => item.kind === 'conflict');
    expect(card).toBeTruthy();
    expect(card?.auto).toBe(false);
    const applied = applyCleanup(card!, rows, [], 'confirm');
    expect(applied.observations).toHaveLength(2);
  });

  it('second name stays untracked until confirm', () => {
    const source = readFileSync(path.join(root, 'src/utils/healthRecord.ts'), 'utf8');
    expect(source).not.toMatch(/getMappedBiomarkerKey|getDuplicateAliasGroups/);
    const markers = [marker({ id: 'hb', canonicalName: 'Hemoglobin', sourceCodes: ['HB'] })];
    const incoming = row({ printed: 'Hb estimation', sourceCode: 'HB', numericValue: 13, unit: 'g/dL' });
    const card = proposeCleanup([incoming], markers).find((item) => item.kind === 'name_merge');
    expect(card?.auto).toBe(false);
    const tracked = trackedMarkerCount({ current: { ldl: 1, hdl: 2, trig: 3 } });
    expect(tracked).toBe(3);
    expect(applyCleanup(card!, [incoming], markers, 'auto').observations[0].confirmed).toBe(false);
  });

  it('rejected name becomes its own marker', () => {
    const markers = [marker({ id: 'hb', canonicalName: 'Hemoglobin', sourceCodes: ['HB'] })];
    const incoming = row({ printed: 'Hb estimation', sourceCode: 'HB', numericValue: 13 });
    const card = proposeCleanup([incoming], markers).find((item) => item.kind === 'name_merge')!;
    const applied = applyCleanup(card, [incoming], markers, 'reject');
    expect(applied.markers.map((item) => item.canonicalName)).toContain('Hb estimation');
    expect(applied.observations[0].markerId).not.toBe('hb');
  });

  it('hdl mg/dl converts only after confirm and keeps raw 50', () => {
    const incoming = row({ printed: 'HDL', numericValue: 50, unit: 'mg/dL', analyteKey: 'hdl' });
    const card = proposeCleanup([incoming], [], 'mmol/L').find((item) => item.kind === 'convert')!;
    expect(card.auto).toBe(false);
    expect(card.convertedValue).toBe(1.293);
    const before = applyCleanup(card, [incoming], [], 'reject');
    expect(before.observations[0].numericValue).toBe(50);
    const after = applyCleanup(card, [incoming], [], 'confirm');
    expect(after.observations[0].numericValue).toBe(1.293);
    expect(after.observations[0].rawValue).toBe(50);
  });

  it('unknown unit pair does not change the number', () => {
    const incoming = row({ printed: 'Widget', numericValue: 3, unit: 'widget', analyteKey: 'widget' });
    const card = proposeCleanup([incoming], [], 'other').find((item) => item.message === 'no conversion')!;
    expect(card.actions).not.toContain('convert');
    const applied = applyCleanup(card, [incoming], [], 'confirm');
    expect(applied.observations[0].numericValue).toBe(3);
  });

  it('relabel does not change the number', () => {
    const incoming = row({ printed: 'Widget', numericValue: 3, unit: 'widget', analyteKey: 'widget' });
    const card = proposeCleanup([incoming], [], 'other').find((item) => item.kind === 'relabel')!;
    const applied = applyCleanup(card, [incoming], [], 'confirm');
    expect(applied.observations[0].numericValue).toBe(3);
    expect(applied.observations[0].unit).toBe('other');
    expect(applied.observations[0].rawValue).toBe(3);
  });

  it('convert and relabel are not on the same card', () => {
    const hdl = proposeCleanup([row({ printed: 'HDL', numericValue: 50, unit: 'mg/dL', analyteKey: 'hdl' })], [], 'mmol/L');
    const convert = hdl.find((item) => item.kind === 'convert')!;
    expect(convert.actions.includes('convert') && convert.actions.includes('relabel')).toBe(false);
    const unknown = proposeCleanup([row({ printed: 'Widget', numericValue: 3, unit: 'widget', analyteKey: 'widget' })], [], 'other');
    const relabel = unknown.find((item) => item.kind === 'relabel')!;
    expect(relabel.actions.includes('convert')).toBe(false);
  });

  it('printed range outlier proposes and does not write', () => {
    const incoming = row({
      printed: 'HDL',
      numericValue: 50,
      unit: 'mg/dL',
      analyteKey: 'hdl',
      printedRange: { min: 1, max: 2 },
    });
    const before = incoming.numericValue;
    const card = proposeCleanup([incoming]).find((item) => item.kind === 'absurd');
    expect(card?.auto).toBe(false);
    expect(incoming.numericValue).toBe(before);
  });

  it('sleep duration is not an absurd lab', () => {
    const incoming = row({
      printed: 'Sleep',
      numericValue: 99,
      unit: 'h',
      analyteKey: 'sleep_duration',
      printedRange: { min: 0, max: 1 },
      improbable: true,
    });
    expect(proposeCleanup([incoming]).some((item) => item.kind === 'absurd')).toBe(false);
  });

  it('inequality and positive stay text', () => {
    const rows = [
      row({ printed: 'CRP', textValue: '<0.1', kind: 'biomarker' }),
      row({ printed: 'Blood', textValue: 'Positive', kind: 'biomarker' }),
    ];
    const cards = proposeCleanup(rows).filter((item) => item.kind === 'dirty');
    expect(cards).toHaveLength(2);
    expect(rows[0].textValue).toBe('<0.1');
    expect(rows[1].textValue).toBe('Positive');
    expect(rows[0].numericValue).toBeNull();
  });

  it('zero stays a number', () => {
    const incoming = row({ printed: 'Pain', numericValue: 0, kind: 'biomarker' });
    expect(proposeCleanup([incoming]).some((item) => item.kind === 'dirty')).toBe(false);
    expect(incoming.numericValue).toBe(0);
  });

  it('same day units that convert to one value propose one observation', () => {
    const rows = [
      row({ printed: 'HbA1c', numericValue: 6, unit: '%', when: '2024-01-02', analyteKey: 'hba1c', cite: { fileId: 'a', quote: '6' } }),
      row({ printed: 'HbA1c', numericValue: 42, unit: 'mmol/mol', when: '2024-01-02', analyteKey: 'hba1c', cite: { fileId: 'b', quote: '42' } }),
    ];
    const card = proposeCleanup(rows).find((item) => item.kind === 'dual_standard');
    expect(card?.auto).toBe(false);
    expect(applyCleanup(card!, rows, [], 'reject').observations).toHaveLength(2);
  });

  it('hba1c pair counts as one log entry', () => {
    const rows = [
      row({ printed: 'HbA1c', numericValue: 6, unit: '%', when: '2024-01-02', analyteKey: 'hba1c', cite: { fileId: 'a', quote: '6' } }),
      row({ printed: 'HbA1c', numericValue: 42, unit: 'mmol/mol', when: '2024-01-02', analyteKey: 'hba1c', cite: { fileId: 'b', quote: '42' } }),
    ];
    const card = proposeCleanup(rows).find((item) => item.kind === 'dual_standard')!;
    const applied = applyCleanup(card, rows, [], 'confirm');
    expect(applied.observations).toHaveLength(1);
    expect(applied.observations[0].cites).toHaveLength(2);
  });

  it('same day units that do not match stay two observations', () => {
    const rows = [
      row({ printed: 'HbA1c', numericValue: 6, unit: '%', when: '2024-01-02', analyteKey: 'hba1c' }),
      row({ printed: 'HbA1c', numericValue: 50, unit: 'mmol/mol', when: '2024-01-02', analyteKey: 'hba1c' }),
    ];
    const card = proposeCleanup(rows).find((item) => item.kind === 'conflict');
    expect(card).toBeTruthy();
    expect(applyCleanup(card!, rows, [], 'confirm').observations).toHaveLength(2);
  });

  it('comparator stays beside the raw text', () => {
    const incoming = row({ printed: 'CRP', textValue: '<0.1' });
    const card = proposeCleanup([incoming]).find((item) => item.kind === 'dirty');
    expect(card?.comparator).toBe('<');
    expect(incoming.textValue).toBe('<0.1');
  });

  it('blood pressure pair stays one text value', () => {
    const incoming = row({ printed: 'BP', textValue: '120/80' });
    expect(proposeCleanup([incoming]).some((item) => item.kind === 'dirty')).toBe(true);
    expect(incoming.textValue).toBe('120/80');
    expect(incoming.numericValue).toBeNull();
  });

  const pdf = JSON.parse(fixture('pdf-pages.json')) as {
    files: Array<{ fileId: string; pages: Array<Omit<PdfPageDescriptor, 'fileId'> & { page: number }> }>;
  };
  const described = (ids: string[]) =>
    pdf.files
      .filter((file) => ids.includes(file.fileId))
      .map((file) => ({
        fileId: file.fileId,
        pages: file.pages.map((page) => ({ ...page, fileId: file.fileId })),
      }));

  it('one pdf and two pdfs share one batch', () => {
    const one = openDescribedPdfBatch(described(['file-a']));
    const two = openDescribedPdfBatch(described(['file-a', 'file-b']));
    expect(new Set(one.parts.map((part) => one.id)).size).toBe(1);
    expect(new Set(two.parts.map((part) => two.id)).size).toBe(1);
    expect(two.parts.map((part) => part.fileId)).toEqual(['file-a', 'file-a', 'file-a', 'file-b', 'file-b']);
  });

  it('text page uses the text door', () => {
    const page = described(['file-a'])[0].pages[0];
    expect(routePdfPage(page).door).toBe('text');
  });

  it('scan page uses ocr', () => {
    const page = described(['file-a'])[0].pages[1];
    expect(routePdfPage(page).door).toBe('ocr');
  });

  it('embedded screenshot is ocr beside the text', () => {
    const page = described(['file-a'])[0].pages[2];
    expect(routePdfPage(page).door).toBe('both');
  });

  it('text and ocr of the same number stay one observation', () => {
    const shared = row({ printed: 'HDL', numericValue: 50, unit: 'mg/dL', when: '2024-01-02T00:00:00', instant: '2024-01-02T00:00:00', analyteKey: 'hdl' });
    const card = proposeCleanup([
      { ...shared, cite: { fileId: 'file-a', page: 3, quote: 'HDL 50' } },
      { ...shared, cite: { fileId: 'file-a', page: 3, quote: 'HDL 50' } },
    ]).find((item) => item.kind === 'exact_duplicate')!;
    const applied = applyCleanup(card, [
      { ...shared, cite: { fileId: 'file-a', page: 3, quote: 'HDL 50' } },
      { ...shared, cite: { fileId: 'file-a', page: 3, quote: 'HDL 50' } },
    ], [], 'auto');
    expect(applied.observations).toHaveLength(1);
    expect(applied.observations[0].cites).toHaveLength(2);
  });

  it('locked pdf stays staged', () => {
    const batch = openDescribedPdfBatch(described(['file-a', 'file-c']));
    const locked = batch.parts.find((part) => part.fileId === 'file-c');
    expect(locked?.status).toBe('locked');
    expect(locked?.door).toBe('locked');
    const confirmed = confirmPassedParts(batch);
    expect(confirmed.parts.find((part) => part.fileId === 'file-a' && part.page === 1)?.confirmed).toBe(true);
    expect(confirmed.parts.find((part) => part.fileId === 'file-c')?.confirmed).toBe(false);
    expect(deleteSourceAllowed({ ...confirmed, userConfirm: 'confirmed' })).toBe(false);
  });

  it('small logo does not force ocr', () => {
    const page = described(['file-b'])[0].pages[0];
    expect(routePdfPage(page).door).toBe('text');
  });

  it('empty pdf page stays staged', () => {
    const batch = openDescribedPdfBatch(described(['file-b']));
    const empty = batch.parts.find((part) => part.page === 2);
    expect(empty?.door).toBe('empty');
    expect(empty?.status).not.toBe('passed');
    expect(deleteSourceAllowed({ ...batch, userConfirm: 'confirmed' })).toBe(false);
  });

  it('pdf pages use the same in-flight queue', () => {
    const batch = openDescribedPdfBatch(described(['file-a', 'file-b']));
    expect(batch.parts).toHaveLength(5);
    expect(batch.inFlight).toHaveLength(4);
    expect(batch.waiting).toHaveLength(1);
  });
});
