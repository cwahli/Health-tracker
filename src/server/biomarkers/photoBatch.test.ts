import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PHOTO_PROMPT_A, PHOTO_PROMPT_B, READ_MODEL, TIE_BREAK_MODEL } from '../../utils/dataEntry';
import type { PageRead } from '../../utils/healthRecord';
import { extractLabAttachments, pageReadFromModelText, splitJoinedLabText, type PageReadJob } from './photoBatch';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');

const textPdf = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/Contents 4 0 R>>endobj\n4 0 obj<</Length 24>>stream\nBT (HDL 50 mg/dL) Tj ET\nendstream\nendobj\n%%EOF',
).toString('base64');

const scanPdf = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Page>>endobj\n2 0 obj<</Subtype /Image>>endobj\n%%EOF',
).toString('base64');

const lockedPdf = Buffer.from('%PDF-1.4\n1 0 obj<</Encrypt 2 0 R>>endobj\n%%EOF').toString('base64');

function agree(job: PageReadJob, value = 50): PageRead {
  return { page: job.page, rows: [{ printed: 'HDL', value, unit: 'mg/dL', when: '2020-01-01' }] };
}

describe('lab photo and pdf doors', () => {
  it('does not send every image through parseLabImages', () => {
    const pipeline = readFileSync(path.join(root, 'src/server/biomarkers/pipeline.ts'), 'utf8');
    const batch = readFileSync(path.join(root, 'src/server/biomarkers/photoBatch.ts'), 'utf8');
    expect(pipeline).not.toContain('parseLabImages');
    expect(batch).not.toContain('parseLabImages');
    expect(pipeline).toContain('extractLabAttachments');
  });

  it('reads ten photos two times each and keeps four pages in flight', async () => {
    let active = 0;
    let max = 0;
    const images = Array.from({ length: 10 }, () => 'data:image/jpeg;base64,QQ==');
    const result = await extractLabAttachments(images, async (job) => {
      active += 1;
      max = Math.max(max, active);
      await Promise.resolve();
      active -= 1;
      return agree(job, job.page);
    });
    expect(max).toBeLessThanOrEqual(4);
    expect(result.visionCalls).toBe(20);
    expect(result.rows).toHaveLength(10);
    expect(result.rows.map((row) => row.value)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('keeps one row when two photos print the same tuple', async () => {
    const images = ['data:image/jpeg;base64,QQ==', 'data:image/jpeg;base64,Qg=='];
    const result = await extractLabAttachments(images, async (job) => agree(job));
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toEqual(expect.objectContaining({ printed: 'HDL', value: 50 }));
  });

  it('uses two different prompts and a tie-break model when the reads disagree', async () => {
    const calls: Array<{ prompt: string; model: string }> = [];
    const result = await extractLabAttachments(['data:image/jpeg;base64,QQ=='], async (job) => {
      calls.push({ prompt: job.prompt, model: job.model });
      if (job.model === TIE_BREAK_MODEL) return agree(job);
      if (job.prompt.startsWith(PHOTO_PROMPT_A)) return agree(job);
      return agree(job, 51);
    });
    expect(calls.map((call) => call.model)).toEqual([READ_MODEL, READ_MODEL, TIE_BREAK_MODEL]);
    expect(calls[0].prompt).toContain(PHOTO_PROMPT_A);
    expect(calls[1].prompt).toContain(PHOTO_PROMPT_B);
    expect(calls[0].prompt).not.toBe(calls[1].prompt);
    expect(result.rows).toEqual([
      expect.objectContaining({ printed: 'HDL', value: 50, unit: 'mg/dL' }),
    ]);
    expect(result.visionCalls).toBe(3);
  });

  it('reads a text pdf with no vision call', async () => {
    let calls = 0;
    const result = await extractLabAttachments([`data:application/pdf;base64,${textPdf}`], async (job) => {
      calls += 1;
      return agree(job, 1);
    });
    expect(calls).toBe(0);
    expect(result.visionCalls).toBe(0);
    expect(result.rows).toEqual([
      expect.objectContaining({ printed: 'HDL', value: 50, unit: 'mg/dL' }),
    ]);
  });

  it('queues a scan page and skips a locked pdf', async () => {
    const calls: string[] = [];
    const result = await extractLabAttachments(
      [`data:application/pdf;base64,${scanPdf}`, `data:application/pdf;base64,${lockedPdf}`],
      async (job) => {
        calls.push(job.mime);
        return agree(job);
      },
    );
    expect(calls).toEqual(['application/pdf', 'application/pdf']);
    expect(result.visionCalls).toBe(2);
    expect(result.rows).toHaveLength(1);
  });

  it('keeps a model verify flag from deciding the row', () => {
    const read = pageReadFromModelText(3, JSON.stringify({
      passed: true,
      verify: 'passed',
      rows: [
        { printed: 'HDL', value: 'Positive', unit: '' },
        { printed: 'LDL', value: '130', unit: 'mg/dL', when: '2020-01-02' },
        { printed: 'CRP', value: '<0.1', unit: 'mg/L' },
      ],
    }));
    expect(read.rows.map((row) => row.value)).toEqual(['Positive', 130, '<0.1']);
    expect(JSON.stringify(read)).not.toContain('passed');
  });

  it('splits several lab tuples that the pdf opener joined onto one line', async () => {
    const pdf = Buffer.from(
      '%PDF-1.4\n1 0 obj<</Type/Page/Contents 2 0 R>>endobj\n2 0 obj<</Length 80>>stream\nBT (Total cholesterol 200 mg/dL) Tj (HDL 50 mg/dL) Tj (LDL 130 mg/dL) Tj ET\nendstream\nendobj\n%%EOF',
    ).toString('base64');
    const result = await extractLabAttachments([`data:application/pdf;base64,${pdf}`], async (job) => agree(job));
    expect(result.visionCalls).toBe(0);
    expect(result.rows.map((row) => [row.printed, row.value, row.unit])).toEqual([
      ['Total cholesterol', 200, 'mg/dL'],
      ['HDL', 50, 'mg/dL'],
      ['LDL', 130, 'mg/dL'],
    ]);
    expect(splitJoinedLabText('HDL 50 mg/dL LDL 130')).toBe('HDL 50 mg/dL\nLDL 130');
    expect(splitJoinedLabText('Total cholesterol 200 mg/dL')).toBe('Total cholesterol 200 mg/dL');
  });

  it('keeps a printed range from the page read', async () => {
    const result = await extractLabAttachments(['data:image/jpeg;base64,QQ=='], async (job) => ({
      page: job.page,
      rows: [{ printed: 'HDL', value: 50, unit: 'mg/dL', when: '2020-01-01', printedRange: '40-60' }],
    }));
    expect(result.rows[0].printedRange).toBe('40-60');
  });

  it('drops a disagreed page and does not coerce text to zero', async () => {
    const result = await extractLabAttachments(['data:image/jpeg;base64,QQ=='], async (job) => {
      if (job.model === TIE_BREAK_MODEL) return { page: job.page, rows: [{ printed: 'HDL', value: 'Positive', unit: null, when: null }] };
      if (job.prompt.startsWith(PHOTO_PROMPT_A)) return { page: job.page, rows: [{ printed: 'HDL', value: 'Positive', unit: null, when: null }] };
      return { page: job.page, rows: [{ printed: 'HDL', value: 0, unit: null, when: null }] };
    });
    expect(result.rows).toEqual([]);
  });
});
