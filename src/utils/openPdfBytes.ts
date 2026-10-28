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
  const texts: string[] = [];
  const tj = /\(((?:\\.|[^\\)])*)\)\s*Tj/g;
  let match: RegExpExecArray | null;
  while ((match = tj.exec(body))) texts.push(pdfLiteral(match[1]));
  const arrays = /\[([\s\S]*?)\]\s*TJ/g;
  while ((match = arrays.exec(body))) {
    const inner = /\(((?:\\.|[^\\)])*)\)/g;
    let part: RegExpExecArray | null;
    while ((part = inner.exec(match[1]))) texts.push(pdfLiteral(part[1]));
  }
  return texts.join(' ').replace(/\s+/g, ' ').trim();
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

function referencedImageCount(dict: string, objects: Map<number, string>): number {
  const ids = [...dict.matchAll(/(\d+)\s+\d+\s+R/g)].map((item) => Number(item[1]));
  const bodies = [dict, ...ids.map((id) => objects.get(id) || '')];
  return bodies.reduce((sum, body) => sum + (body.match(/\/Subtype\s*\/Image/g) || []).length, 0);
}

function pageRatio(text: string, imageCount: number): number {
  if (imageCount === 0) return 0;
  return text ? 0.25 : 1;
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

export function describePdfBytes(fileId: string, bytes: Uint8Array): PdfPageDescriptor[] {
  const raw = new TextDecoder('latin1').decode(bytes);
  if (!raw.includes('%PDF')) {
    return [{ fileId, page: 1, text: '', imageCount: 0, imageAreaRatio: 0 }];
  }
  if (/\/Encrypt\b/.test(raw)) {
    return [{ fileId, page: 1, text: '', imageCount: 0, imageAreaRatio: 0, locked: true }];
  }
  const visible = raw.replace(/\/Filter\s*\/FlateDecode[\s\S]*?endstream/g, '');
  const objects = pdfObjects(visible);
  const pageDicts = orderedPageBodies(objects);
  if (pageDicts.length === 0) {
    const text = textOperators(visible);
    const imageCount = (visible.match(/\/Subtype\s*\/Image/g) || []).length;
    return [{ fileId, page: 1, text, imageCount, imageAreaRatio: pageRatio(text, imageCount) }];
  }
  const useContents = pageDicts.some((dict) => contentIds(dict).length > 0);
  const looseText = textOperators(visible);
  const pages = pageDicts.map((dict, index) => {
    const text = useContents
      ? contentIds(dict).map((id) => textOperators(objects.get(id) || '')).join(' ').replace(/\s+/g, ' ').trim()
      : index === 0 ? looseText : '';
    const imageCount = referencedImageCount(dict, objects);
    return { text, imageCount };
  });
  if (!pages.some((page) => page.imageCount > 0)) {
    const looseImages = (visible.match(/\/Subtype\s*\/Image/g) || []).length;
    pages[0].imageCount = looseImages;
  }
  return pages.map((page, index) => ({
    fileId,
    page: index + 1,
    text: page.text,
    imageCount: page.imageCount,
    imageAreaRatio: pageRatio(page.text, page.imageCount),
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
