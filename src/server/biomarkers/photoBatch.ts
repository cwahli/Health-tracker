/**
 * Photo and PDF door for the live medical pipeline.
 * One page is read twice. At most four pages run at once.
 * A text PDF page stays on the text door. The model text is not a verify flag.
 */
import {
  PHOTO_PROMPT_A,
  PHOTO_PROMPT_B,
  READ_MODEL,
  TIE_BREAK_MODEL,
  enterPhotos,
  enterTextDoors,
} from '../../utils/dataEntry.js';
import { describePdfBytes } from '../../utils/openPdfBytes.js';
import { routePdfPage, verifyAgreement, type PageRead } from '../../utils/healthRecord.js';
import type { IntakeRow } from './schema.js';

export const PAGE_CAP = 4;

export type PageReadJob = {
  page: number;
  prompt: string;
  model: string;
  mime: string;
  data: string;
};

export type ReadPage = (job: PageReadJob) => Promise<PageRead>;

type VisionJob = { page: number; mime: string; data: string };

function decodeAttachment(input: string): { mime: string; base64: string; bytes: Uint8Array } {
  let mime = 'image/jpeg';
  let base64 = input;
  if (input.startsWith('data:')) {
    const comma = input.indexOf(',');
    mime = input.slice(5, comma).split(';')[0] || 'application/octet-stream';
    base64 = input.slice(comma + 1);
  }
  const bytes = Uint8Array.from(Buffer.from(base64, 'base64'));
  if (Buffer.from(bytes.subarray(0, 5)).toString('latin1').startsWith('%PDF')) mime = 'application/pdf';
  return { mime, base64, bytes };
}

export function pageReadFromModelText(page: number, raw: string): PageRead {
  let parsed: { rows?: unknown } = {};
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    parsed = {};
  }
  const rows = Array.isArray(parsed.rows) ? parsed.rows : [];
  return {
    page,
    rows: rows.map((row: any) => {
      const value = row?.value;
      let kept: number | string | null = null;
      if (typeof value === 'number' && Number.isFinite(value)) kept = value;
      else if (typeof value === 'string') {
        const trimmed = value.trim();
        if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) kept = Number(trimmed);
        else if (trimmed) kept = trimmed;
      }
      return {
        printed: String(row?.printed ?? ''),
        value: kept,
        unit: row?.unit == null || row.unit === '' ? null : String(row.unit),
        when: row?.when || row?.date || null,
      };
    }),
  };
}

function asIntake(id: string, printed: string, value: number | string | null, unit: string | null, when: string | null): IntakeRow | null {
  if (!printed || typeof value !== 'number' || !Number.isFinite(value)) return null;
  return {
    id,
    printed,
    value,
    unit: unit || '',
    date: when || '',
  };
}

function dedupe(rows: IntakeRow[]): IntakeRow[] {
  const seen = new Set<string>();
  const out: IntakeRow[] = [];
  for (const row of rows) {
    const key = JSON.stringify([row.printed, row.value, row.unit, row.date]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

async function mapPool<T, R>(items: T[], cap: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(cap, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return out;
}

function failedRead(page: number, model: string): PageRead {
  return {
    page,
    rows: [{ printed: `read-failed-${model}-${page}-${Math.random()}`, value: null, unit: null, when: null }],
  };
}

async function readVisionPage(job: VisionJob, readPage: ReadPage): Promise<{ page: number; readA: PageRead; readB: PageRead; tie?: PageRead }> {
  const call = async (prompt: string, model: string): Promise<PageRead> => {
    try {
      const read = await readPage({
        page: job.page,
        prompt: `${prompt}\nRead page ${job.page} only.`,
        model,
        mime: job.mime,
        data: job.data,
      });
      return { ...read, page: job.page };
    } catch {
      return failedRead(job.page, model);
    }
  };
  const readA = await call(PHOTO_PROMPT_A, READ_MODEL);
  const readB = await call(PHOTO_PROMPT_B, READ_MODEL);
  const tie = verifyAgreement(readA, readB).passed ? undefined : await call(PHOTO_PROMPT_A, TIE_BREAK_MODEL);
  return { page: job.page, readA, readB, tie };
}

function agreedRows(page: { page: number; readA: PageRead; readB: PageRead; tie?: PageRead }): PageRead | null {
  if (verifyAgreement(page.readA, page.readB).passed) return page.readA;
  if (page.tie && verifyAgreement(page.readA, page.tie).passed) return page.tie;
  return null;
}

export async function extractLabAttachments(
  imagesBase64: string[],
  readPage: ReadPage,
): Promise<{ rows: IntakeRow[]; visionCalls: number }> {
  const vision: VisionJob[] = [];
  const textRows: IntakeRow[] = [];
  let pageSeq = 0;
  let visionCalls = 0;

  imagesBase64.forEach((raw, fileIndex) => {
    const file = decodeAttachment(raw);
    if (file.mime === 'application/pdf') {
      const fileId = `pdf-${fileIndex + 1}`;
      for (const page of describePdfBytes(fileId, file.bytes)) {
        pageSeq += 1;
        const door = routePdfPage(page).door;
        if (door === 'text' || door === 'both') {
          const entered = enterTextDoors({ prose: page.text });
          if (entered.gridOk) {
            entered.rows.forEach((row, index) => {
              const intake = asIntake(`${fileId}-p${page.page}-${index}`, row.printed, row.numericValue, row.unit, row.when);
              if (intake) textRows.push(intake);
            });
          }
        }
        if (door === 'ocr' || door === 'both') {
          vision.push({ page: pageSeq, mime: 'application/pdf', data: file.base64 });
        }
      }
      return;
    }
    pageSeq += 1;
    vision.push({ page: pageSeq, mime: file.mime || 'image/jpeg', data: file.base64 });
  });

  const countingRead: ReadPage = async (job) => {
    visionCalls += 1;
    return readPage(job);
  };
  const reads = await mapPool(vision, PAGE_CAP, (job) => readVisionPage(job, countingRead));
  const confirmed = new Set(
    (reads.length ? enterPhotos(reads).batch.parts : [])
      .filter((part) => part.confirmed)
      .map((part) => part.page || 0),
  );
  const photoRows: IntakeRow[] = [];
  for (const page of reads) {
    if (!confirmed.has(page.page)) continue;
    const agreed = agreedRows(page);
    if (!agreed) continue;
    agreed.rows.forEach((row, index) => {
      const intake = asIntake(`photo-p${page.page}-${index}`, row.printed, row.value, row.unit, row.when);
      if (intake) photoRows.push(intake);
    });
  }
  return { rows: dedupe([...textRows, ...photoRows]), visionCalls };
}
