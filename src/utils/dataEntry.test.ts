import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  agentEditsObservation,
  cleanupEntry,
  enterDescribedPdfs,
  enterPhotos,
  enterTextDoors,
  historyEditsObservation,
  flagsSleepAsLabError,
  promptsDiffer,
  READ_MODEL,
  sourceCanBeDeleted,
  stageOnR2,
  TIE_BREAK_MODEL,
} from './dataEntry';
import { routeIncomingRecord } from './frontDeskRouting';
import type { Marker, Observation, PageRead, PdfPageDescriptor, StagedRow } from './healthRecord';
import { openPdfBytes } from './openPdfBytes';
import { withoutPracticeTags } from './healthRecord';

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

describe('data entry', () => {
  it('routes a file, a pdf batch, and a sleep sentence to data_entry', () => {
    expect(routeIncomingRecord({ fileCount: 1 })).toBe('data_entry');
    expect(routeIncomingRecord({ pdfCount: 2 })).toBe('data_entry');
    expect(routeIncomingRecord({ photoCount: 10 })).toBe('data_entry');
    expect(routeIncomingRecord({ text: 'I slept badly' })).toBe('data_entry');
  });

  it('grid, prose, and nested panel make zero model calls', () => {
    const entered = enterTextDoors({
      gridCsv: fixture('grid.csv'),
      prose: fixture('prose.txt'),
      xml: fixture('nested-panel.xml'),
    });
    expect(entered.visionCalls).toBe(0);
    expect(entered.gridOk).toBe(true);
    expect(entered.rows.some((item) => item.kind === 'symptom')).toBe(true);
    expect(entered.rows.length).toBeGreaterThan(3);
  });

  it('page 7 stays uncounted and a disagreed page uses the flash tie-break once', () => {
    const pages = JSON.parse(fixture('pages-10.json')).pages as Array<{
      page: number;
      rows: PageRead['rows'];
      dropped?: PageRead['rows'][number];
    }>;
    const pairs = pages.map((page) => ({
      page: page.page,
      readA: { page: page.page, rows: page.rows },
      readB: {
        page: page.page,
        rows: page.dropped ? page.rows.filter((item) => item.printed !== page.dropped?.printed) : page.rows,
      },
    }));
    const entered = enterPhotos(pairs);
    expect(entered.countablePages).not.toContain(7);
    expect(entered.countablePages).toHaveLength(9);
    expect(entered.tieBreakModel).toBe(TIE_BREAK_MODEL);
    expect(entered.tieBreakModel).not.toBe('gemini-2.5-pro');
    expect(READ_MODEL).toBe('gemini-3.5-flash-lite');
    expect(promptsDiffer()).toBe(true);
    expect(sourceCanBeDeleted({ ...entered.batch, userConfirm: 'confirmed' })).toBe(false);
  });

  it('a second name stays untracked until confirm', () => {
    const markers: Marker[] = [{
      id: 'hb',
      canonicalName: 'Hemoglobin',
      aliases: [],
      kind: 'biomarker',
      unit: 'g/dL',
      riskCategories: ['Hematology'],
      sourceCodes: ['HB'],
    }];
    const incoming = row({ printed: 'Hb estimation', sourceCode: 'HB', numericValue: 13, unit: 'g/dL' });
    const pending = cleanupEntry([incoming], markers);
    expect(pending.cards.some((card) => card.kind === 'name_merge')).toBe(true);
    expect(pending.observationsConfirmed).toBe(false);
    expect(pending.tracked).toBe(0);
  });

  it('HDL converts only after confirm and keeps the raw 50', () => {
    const incoming = row({ printed: 'HDL', numericValue: 50, unit: 'mg/dL', analyteKey: 'hdl' });
    const pending = cleanupEntry([incoming], [], 'mmol/L');
    expect(pending.numericValue).toBe(50);
    const confirmed = cleanupEntry([incoming], [], 'mmol/L', 'confirm');
    expect(confirmed.numericValue).toBe(1.293);
    expect(confirmed.rawKept).toBe(50);
  });

  it('an unknown unit pair does not change the number', () => {
    const incoming = row({ printed: 'Widget', numericValue: 3, unit: 'widget', analyteKey: 'widget' });
    const confirmed = cleanupEntry([incoming], [], 'other', 'confirm');
    expect(confirmed.numericValue).toBe(3);
  });

  it('sleep is not a lab error and bytes are not written to biomarker_logs', () => {
    expect(flagsSleepAsLabError('sleep_duration')).toBe(false);
    expect(flagsSleepAsLabError('hdl')).toBe(true);
    const staged = stageOnR2('batch-1', [{ fileId: 'a.pdf' }]);
    expect(staged.writesLogTable).toBe(false);
    expect(staged.objects[0].key).toBe('health-record/batch-1/a.pdf');
  });

  it('a text page makes no vision call and a scan stays uncounted', () => {
    const files = JSON.parse(fixture('pdf-pages.json')).files as Array<{ fileId: string; pages: PdfPageDescriptor[] }>;
    const textOnly = enterDescribedPdfs([files[1]]);
    expect(textOnly.visionCalls).toBe(0);
    expect(textOnly.doors[0]).toBe('text');
    const scan = enterDescribedPdfs([{ fileId: 'scan', pages: [files[0].pages[1]] }]);
    expect(scan.visionCalls).toBe(2);
    expect(scan.batch.parts[0].status).not.toBe('passed');
    const one = enterDescribedPdfs([files[0]]);
    const two = enterDescribedPdfs([files[0], files[1]]);
    expect(new Set(one.batch.parts.map((part) => one.batch.id)).size).toBe(1);
    expect(new Set(two.batch.parts.map((part) => two.batch.id)).size).toBe(1);
  });

  it('an embedded screenshot collapses to one observation', () => {
    const files = JSON.parse(fixture('pdf-pages.json')).files as Array<{ fileId: string; pages: PdfPageDescriptor[] }>;
    const both = enterDescribedPdfs([{ fileId: 'file-a', pages: [files[0].pages[2]] }]);
    expect(both.doors).toEqual(['both']);
    expect(both.visionCalls).toBe(2);
    const cite = { fileId: 'file-a', page: 3, quote: 'HDL 50' };
    const a = row({ printed: 'HDL', numericValue: 50, unit: 'mg/dL', when: '2024-01-01', cite });
    const b = row({ printed: 'HDL', numericValue: 50, unit: 'mg/dL', when: '2024-01-01', cite: { ...cite, quote: 'HDL 50 image' } });
    const collapsed = cleanupEntry([a, b], [], undefined, 'confirm');
    expect(collapsed.cards[0].kind).toBe('exact_duplicate');
    expect(collapsed.observationCount).toBe(1);
  });

  it('does not call parseLabImages', () => {
    const src = readFileSync(path.join(root, 'src/utils/dataEntry.ts'), 'utf8');
    expect(src).not.toContain('parseLabImages');
    expect(src).not.toContain('biomarker_logs');
    const opener = readFileSync(path.join(root, 'src/utils/openPdfBytes.ts'), 'utf8');
    expect(opener).not.toContain('pdfjs');
    expect(opener).not.toContain('tesseract');
  });

  it('opens a text-layer pdf without a model and keeps a locked file locked', () => {
    const textPdf = new TextEncoder().encode(
      '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/Contents 4 0 R>>endobj\n4 0 obj<</Length 24>>stream\nBT (HDL 50 mg/dL) Tj ET\nendstream\nendobj\n%%EOF',
    );
    const opened = openPdfBytes('lab.pdf', textPdf);
    expect(opened.pages[0].text).toContain('HDL 50');
    expect(opened.batch.parts[0].door).toBe('text');
    expect(opened.visionCalls).toBe(0);
    const bothPdf = new TextEncoder().encode(
      '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/Contents 4 0 R/Resources<</XObject<</Im0 5 0 R>>>>>>endobj\n4 0 obj<</Length 16>>stream\nBT (HDL 50) Tj ET\nendstream\nendobj\n5 0 obj<</Type/XObject/Subtype/Image/Width 20/Height 20>>endobj\n%%EOF',
    );
    const both = openPdfBytes('scan.pdf', bothPdf);
    expect(both.batch.parts[0].door).toBe('both');
    expect(both.visionCalls).toBe(2);
    const locked = openPdfBytes('locked.pdf', new TextEncoder().encode('%PDF-1.4\n1 0 obj<</Encrypt 2 0 R>>endobj\n%%EOF'));
    expect(locked.batch.parts[0].door).toBe('locked');
    expect(locked.visionCalls).toBe(0);
    const twoPages = new TextEncoder().encode(
      '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 2/Kids[3 0 R 4 0 R]>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/Contents 5 0 R>>endobj\n4 0 obj<</Type/Page/Parent 2 0 R/Contents 6 0 R>>endobj\n5 0 obj<</Length 24>>stream\nBT (HDL 50 mg/dL) Tj ET\nendstream\nendobj\n6 0 obj<</Length 24>>stream\nBT (LDL 130 mg/dL) Tj ET\nendstream\nendobj\n%%EOF',
    );
    const openedPages = openPdfBytes('two.pdf', twoPages);
    expect(openedPages.pages.map((page) => page.text)).toEqual(['HDL 50 mg/dL', 'LDL 130 mg/dL']);
    expect(openedPages.batch.parts.map((part) => part.door)).toEqual(['text', 'text']);
    expect(openedPages.visionCalls).toBe(0);
    const reversed = new TextEncoder().encode(
      '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 2/Kids[4 0 R 3 0 R]>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/Contents 6 0 R>>endobj\n4 0 obj<</Type/Page/Parent 2 0 R/Contents 5 0 R>>endobj\n5 0 obj<</Length 24>>stream\nBT (HDL 50 mg/dL) Tj ET\nendstream\nendobj\n6 0 obj<</Length 24>>stream\nBT (LDL 130 mg/dL) Tj ET\nendstream\nendobj\n%%EOF',
    );
    const openedReversed = openPdfBytes('reversed.pdf', reversed);
    expect(openedReversed.pages.map((page) => page.text)).toEqual(['HDL 50 mg/dL', 'LDL 130 mg/dL']);
  });

  it('a history cell edit and the agent edit the same observation', () => {
    const start: Observation[] = [{
      id: 'obs-1',
      markerId: 'hdl',
      printed: 'HDL',
      numericValue: 50,
      textValue: null,
      unit: 'mg/dL',
      rawValue: 50,
      rawUnit: 'mg/dL',
      when: null,
      instant: null,
      kind: 'biomarker',
      cites: [],
      confirmed: true,
      comparator: null,
      analyteKey: 'hdl',
    }];
    const fromHistory = historyEditsObservation(start, 'obs-1', 1.293);
    const fromAgent = agentEditsObservation(start, 'obs-1', 1.293);
    expect(fromHistory).toEqual(fromAgent);
    expect(fromHistory[0].numericValue).toBe(1.293);
    expect(fromHistory[0].rawValue).toBe(50);
  });

  it('a new marker row drops practice and condition tags', () => {
    const rowTags = withoutPracticeTags({
      name: 'HDL',
      standardMedicalGrouping: 'By Medical Practice',
      potentialMedicalConditions: ['x'],
    });
    expect(rowTags).toEqual({ name: 'HDL' });
  });
});
