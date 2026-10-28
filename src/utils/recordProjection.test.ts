import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyRecordAction,
  changeDiary,
  confirmCleanupOnRows,
  confirmSourceDecision,
  logIntoRows,
  projectRead,
  publicBiomarkerMap,
  sameDayValuesStay,
  stagePdfFiles,
  stagePhotoCount,
  userMarkerKeys,
  SYMPTOM_KEY,
} from './recordProjection';
import type { Diary, StagedRow } from './healthRecord';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

describe('record projection', () => {
  it('keeps a numeric map, a separate symptom list, and the milestone 0 counters', () => {
    const logged = logIntoRows([], {
      date: '2024-06-01',
      text: 'I slept badly',
      readings: { HDL: 50, CRP: 0 },
    });
    const view = projectRead(logged.rows);
    expect(view.labs[0].biomarkers.hdl).toBe(50);
    expect(view.labs[0].biomarkers.crp).toBe(0);
    expect(view.labs[0].biomarkers[SYMPTOM_KEY]).toBeUndefined();
    expect(view.symptomEvents).toHaveLength(1);
    expect(view.tracked).toBe(2);
    expect(view.logEntries).toBe(3);
    expect(publicBiomarkerMap(logged.rows[0].biomarkers).hdl).toBe(50);
  });

  it('does not average two same-day values', () => {
    const first = logIntoRows([], { date: '2024-06-01', readings: { HDL: 50 } });
    const second = logIntoRows(first.rows, { date: '2024-06-01', readings: { HDL: 60 } });
    expect(second.read.labs[0].biomarkers.hdl).toBe(60);
    expect(sameDayValuesStay([50, 60])).toEqual([50, 60]);
    const stored = second.rows[0].biomarkers?.__observations as Array<{ numericValue: number }>;
    expect(stored.map((item) => item.numericValue)).toEqual([50, 60]);
  });

  it('confirms a unit convert without dropping the raw value', () => {
    const staged: StagedRow[] = [{
      printed: 'HDL',
      numericValue: 50,
      textValue: null,
      unit: 'mg/dL',
      printedRange: null,
      when: '2024-06-01',
      kind: 'biomarker',
      analyteKey: 'hdl',
      cite: { fileId: 'lab', quote: 'HDL 50' },
    }];
    const cleaned = confirmCleanupOnRows([], {
      date: '2024-06-01',
      staged,
      preferUnit: 'mmol/L',
      decision: 'confirm',
    });
    expect(cleaned.numericValue).toBe(1.293);
    expect(cleaned.rawValue).toBe(50);
    expect(projectRead(cleaned.rows).labs[0].biomarkers.hdl).toBe(1.293);
  });

  it('stages ten photos and two pdfs as one batch each', () => {
    const photos = stagePhotoCount(10);
    expect(photos.id).toBe('photo-batch');
    expect(photos.parts).toHaveLength(10);
    expect(photos.inFlight).toHaveLength(4);
    expect(photos.waiting).toHaveLength(6);
    const pdfs = stagePdfFiles([
      { fileId: 'a', pages: [{ fileId: 'a', page: 1, text: 'HDL 50', imageCount: 0, imageAreaRatio: 0 }] },
      { fileId: 'b', pages: [{ fileId: 'b', page: 1, text: '', imageCount: 1, imageAreaRatio: 1 }] },
    ]);
    expect(pdfs.id).toBe('pdf-batch');
    expect(pdfs.parts).toHaveLength(2);
  });

  it('keeps a diary cell on its column id when a column is hidden', () => {
    const diary: Diary = {
      id: 'bowel',
      columns: [{ id: 'col-1', label: 'pain', retiredAt: null }],
      events: [],
    };
    const appended = changeDiary(diary, {
      append: {
        diaryId: 'bowel',
        observedAt: '2024-06-01',
        movementNumber: 1,
        clientKey: 'k',
        cells: [{ columnId: 'col-1', value: 1 }],
      },
    });
    const retired = changeDiary(appended, { retireColumnId: 'col-1', at: '2024-06-02' });
    expect(retired.events[0].cells[0].columnId).toBe('col-1');
    expect(retired.columns[0].retiredAt).toBe('2024-06-02');
  });

  it('allows source deletion only after confirmation and a full pass', () => {
    expect(confirmSourceDecision('pending', true)).toBe(false);
    expect(confirmSourceDecision('confirmed', false)).toBe(false);
    expect(confirmSourceDecision('confirmed', true)).toBe(true);
  });

  it('lists the user markers and does not import the dictionary mapper', () => {
    expect(userMarkerKeys({
      customBiomarkers: [{ key: 'omega3_index' }],
      symptomDiaries: [{ id: 'hemorrhoid' }],
    })).toEqual(['omega3_index', 'hemorrhoid']);
    const src = readFileSync(path.join(root, 'src/utils/recordProjection.ts'), 'utf8');
    expect(src).not.toContain('getMappedBiomarkerKey');
    expect(src).not.toContain('server_db_d1');
  });

  it('runs log, edit, and delete through one action', () => {
    const logged = applyRecordAction([], { action: 'log', date: '2024-06-01', readings: { HDL: 50 } });
    const rows = logged.rows as Array<{ biomarkers?: { __observations?: Array<{ id: string; rawValue: number }> } }>;
    const id = rows[0].biomarkers?.__observations?.[0].id || '';
    const edited = applyRecordAction(logged.rows as never, { action: 'edit', observation_id: id, value: 1.293 });
    const editedRows = edited.rows as typeof rows;
    expect(editedRows[0].biomarkers?.__observations?.[0].rawValue).toBe(50);
    const removed = applyRecordAction(edited.rows as never, { action: 'delete', observation_id: id });
    expect(removed.deletedIds).toEqual(['bio_2024-06-01']);
    expect(removed.rows).toEqual([]);
  });
});
