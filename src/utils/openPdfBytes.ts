/**
 * Uncompressed PDF text-layer opener. No pdf.js, no Tesseract, no model call.
 * A locked file stays locked. A scan with no text operators stays an OCR door.
 */
import { enterDescribedPdfs } from './dataEntry';
import type { PdfPageDescriptor, SourceBatch } from './healthRecord';

function pdfLiteral(body: string): string {
  return body.replace(/\\([()\\nrt])/g, (_match, ch: string) => {
    if (ch === 'n') return '\n';
    if (ch === 'r') return '\r';
    if (ch === 't') return '\t';
    return ch;
  });
}

function textOperators(body: string): string {
  if (/\/Filter\s*\/FlateDecode/.test(body)) return '';
  const found: string[] = [];
  const show = /\(((?:\\.|[^\\)])*)\)\s*Tj/g;
  let hit: RegExpExecArray | null;
  while ((hit = show.exec(body))) found.push(pdfLiteral(hit[1]));
  const groups = /\[([\s\S]*?)\]\s*TJ/g;
  while ((hit = groups.exec(body))) {
    const piece = /\(((?:\\.|[^\\)])*)\)/g;
    let one: RegExpExecArray | null;
    while ((one = piece.exec(hit[1]))) found.push(pdfLiteral(one[1]));
  }
  return found.join(' ').replace(/\s+/g, ' ').trim();
}

function pdfObjects(raw: string): Map<number, string> {
  const objects = new Map<number, string>();
  const re = /(\d+)\s+\d+\s+obj([\s\S]*?)endobj/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) objects.set(Number(match[1]), match[2]);
  return objects;
}

function contentIds(dict: string): number[] {
  const array = dict.match(/\/Contents\s*\[([^\]]*)\]/);
  const source = array ? array[1] : '';
  if (array) {
    return [...source.matchAll(/(\d+)\s+\d+\s+R/g)].map((item) => Number(item[1]));
  }
  const one = dict.match(/\/Contents\s+(\d+)\s+\d+\s+R/);
  return one ? [Number(one[1])] : [];
}

function rawDicts(raw: string): Map<number, string> {
  const dicts = new Map<number, string>();
  const re = /(\d+)\s+\d+\s+obj([\s\S]*?)(?:stream|endobj)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) dicts.set(Number(match[1]), match[2]);
  return dicts;
}

function referencedImageCount(dict: string, objects: Map<number, string>, rawDicts: Map<number, string>): number {
  const ids = [...dict.matchAll(/(\d+)\s+\d+\s+R/g)].map((item) => Number(item[1]));
  const seen = new Set<number>();
  for (const id of ids) {
    const visible = objects.get(id) || '';
    const rawDict = rawDicts.get(id) || '';
    // The Flate strip deletes /Subtype when it sits after /Filter. The raw dict still has it.
    if (/\/Subtype\s*\/Image/.test(visible) || /\/Subtype\s*\/Image/.test(rawDict)) seen.add(id);
  }
  return (dict.match(/\/Subtype\s*\/Image/g) || []).length + seen.size;
}

function isPageDict(body: string): boolean {
  return /\/Type\s*\/Page(?!s)/.test(body);
}

/** Page-tree order. Object order is only the fallback when Kids is missing. */
function orderedPageBodies(objects: Map<number, string>): string[] {
  const pageIds = [...objects.entries()].filter(([, body]) => isPageDict(body)).map(([id]) => id);
  const pageSet = new Set(pageIds);
  const ordered: number[] = [];
  const seen = new Set<number>();
  const visit = (id: number) => {
    if (seen.has(id)) return;
    const body = objects.get(id);
    if (!body) return;
    seen.add(id);
    if (pageSet.has(id)) {
      ordered.push(id);
      return;
    }
    const kids = body.match(/\/Kids\s*\[([^\]]*)\]/);
    if (!kids) return;
    for (const item of kids[1].matchAll(/(\d+)\s+\d+\s+R/g)) visit(Number(item[1]));
  };
  for (const [id, body] of objects) {
    if (seen.has(id)) continue;
    if (!/\/Type\s*\/(?:Pages|Catalog)\b/.test(body)) continue;
    const pagesRef = body.match(/\/Pages\s+(\d+)\s+\d+\s+R/);
    if (pagesRef) visit(Number(pagesRef[1]));
    const kids = body.match(/\/Kids\s*\[([^\]]*)\]/);
    if (kids) {
      for (const item of kids[1].matchAll(/(\d+)\s+\d+\s+R/g)) visit(Number(item[1]));
    }
  }
  for (const id of pageIds) if (!seen.has(id)) ordered.push(id);
  return ordered.map((id) => objects.get(id) || '');
}

/** Object ids whose stream dict carries a /Filter. Those bytes are not text we can read. */
function compressedStreamIds(raw: string): Set<number> {
  const ids = new Set<number>();
  const re = /(\d+)\s+\d+\s+obj([\s\S]*?)(?:stream|endobj)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) {
    if (/\/Filter\b/.test(match[2])) ids.add(Number(match[1]));
  }
  return ids;
}

function pagesFromContents(fileId: string, visible: string, raw: string): PdfPageDescriptor[] | null {
  const objects = pdfObjects(visible);
  const pageDicts = orderedPageBodies(objects);
  const compressed = compressedStreamIds(raw);
  const dicts = rawDicts(raw);
  if (!pageDicts.some((dict) => contentIds(dict).length > 0)) return null;
  const pages = pageDicts.map((dict) => {
    const ids = contentIds(dict);
    const text = ids.map((id) => textOperators(objects.get(id) || '')).join(' ').replace(/\s+/g, ' ').trim();
    let imageCount = referencedImageCount(dict, objects, dicts);
    if (ids.some((id) => compressed.has(id))) imageCount = Math.max(imageCount, 1);
    return { text, imageCount };
  });
  if (!pages.some((page) => page.imageCount > 0)) {
    pages[0].imageCount = (visible.match(/\/Subtype\s*\/Image/g) || []).length;
  }
  return pages.map((page, index) => ({
    fileId,
    page: index + 1,
    text: page.text,
    imageCount: page.imageCount,
    imageAreaRatio: page.imageCount === 0 ? 0 : page.text ? 0.25 : 1,
  }));
}

export function describePdfBytes(fileId: string, bytes: Uint8Array): PdfPageDescriptor[] {
  const raw = new TextDecoder('latin1').decode(bytes);
  if (!raw.includes('%PDF')) {
    return [{ fileId, page: 1, text: '', imageCount: 0, imageAreaRatio: 0 }];
  }
  if (/\/Encrypt\b/.test(raw)) {
    return [{ fileId, page: 1, text: '', imageCount: 0, imageAreaRatio: 0, locked: true }];
  }
  const visible = raw.replace(/\/Filter\s*\/FlateDecode[\s\S]*?endstream/g, '');
  const perPage = pagesFromContents(fileId, visible, raw);
  if (perPage) return perPage;
  const texts: string[] = [];
  const tj = /\(((?:\\.|[^\\)])*)\)\s*Tj/g;
  let match: RegExpExecArray | null;
  while ((match = tj.exec(visible))) texts.push(pdfLiteral(match[1]));
  const arrays = /\[([\s\S]*?)\]\s*TJ/g;
  while ((match = arrays.exec(visible))) {
    const inner = /\(((?:\\.|[^\\)])*)\)/g;
    let part: RegExpExecArray | null;
    while ((part = inner.exec(match[1]))) texts.push(pdfLiteral(part[1]));
  }
  const text = texts.join(' ').replace(/\s+/g, ' ').trim();
  const imageCount = (visible.match(/\/Subtype\s*\/Image/g) || []).length;
  const imageAreaRatio = imageCount === 0 ? 0 : text ? 0.25 : 1;
  const pageCount = (visible.match(/\/Type\s*\/Page(?!s)/g) || []).length || 1;
  return Array.from({ length: pageCount }, (_unused, index) => ({
    fileId,
    page: index + 1,
    text: index === 0 ? text : '',
    imageCount: index === 0 ? imageCount : 0,
    imageAreaRatio: index === 0 ? imageAreaRatio : 0,
  }));
}

export function openPdfBytes(fileId: string, bytes: Uint8Array): {
  pages: PdfPageDescriptor[];
  batch: SourceBatch;
  visionCalls: number;
} {
  const pages = describePdfBytes(fileId, bytes);
  const entered = enterDescribedPdfs([{ fileId, pages }]);
  return { pages, batch: entered.batch, visionCalls: entered.visionCalls };
}
