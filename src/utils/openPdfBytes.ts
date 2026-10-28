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

export function describePdfBytes(fileId: string, bytes: Uint8Array): PdfPageDescriptor[] {
  const raw = new TextDecoder('latin1').decode(bytes);
  if (!raw.includes('%PDF')) {
    return [{ fileId, page: 1, text: '', imageCount: 0, imageAreaRatio: 0 }];
  }
  if (/\/Encrypt\b/.test(raw)) {
    return [{ fileId, page: 1, text: '', imageCount: 0, imageAreaRatio: 0, locked: true }];
  }
  const visible = raw.replace(/\/Filter\s*\/FlateDecode[\s\S]*?endstream/g, '');
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
