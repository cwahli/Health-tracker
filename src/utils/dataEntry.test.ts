import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cleanupEntry,
  enterDescribedPdfs,
  enterPhotos,
  enterTextDoors,
  flagsSleepAsLabError,
  promptsDiffer,
  READ_MODEL,
  sourceCanBeDeleted,
  stageOnR2,
  TIE_BREAK_MODEL,
} from './dataEntry';
import { routeIncomingRecord } from './frontDeskRouting';
import type { Marker, PageRead, PdfPageDescriptor, StagedRow } from './healthRecord';

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
  });
});
