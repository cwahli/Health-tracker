/**
 * Uncompressed PDF text-layer opener. No pdf.js, no Tesseract, no model call.
 * A locked file stays locked. A scan with no text operators stays an OCR door.
 */
import { inflateRawSync, inflateSync } from 'node:zlib';
import { enterDescribedPdfs } from './dataEntry';
import type { PdfPageDescriptor, SourceBatch } from './healthRecord';
import { routePdfPage } from './healthRecord';

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

function valueAfter(body: string, key: string): string | null {
  const match = new RegExp(`\\/${key}(?![A-Za-z0-9])\\s*`).exec(body);
  return match ? body.slice(match.index + match[0].length) : null;
}

function readPdfValue(rest: string): { kind: 'ref'; id: number } | { kind: 'dict'; body: string } | null {
  const ref = /^(\d+)\s+\d+\s+R/.exec(rest);
  if (ref) return { kind: 'ref', id: Number(ref[1]) };
  if (!rest.startsWith('<<')) return null;
  let depth = 0;
  for (let i = 0; i < rest.length - 1; i += 1) {
    if (rest[i] === '<' && rest[i + 1] === '<') {
      depth += 1;
      i += 1;
      continue;
    }
    if (rest[i] === '>' && rest[i + 1] === '>') {
      depth -= 1;
      i += 1;
      if (depth === 0) return { kind: 'dict', body: rest.slice(0, i + 1) };
    }
  }
  return null;
}

function resolveKey(body: string, key: string, rawDicts: Map<number, string>, objects: Map<number, string>): string | null {
  const rest = valueAfter(body, key);
  if (rest == null) return null;
  const value = readPdfValue(rest);
  if (!value) return null;
  if (value.kind === 'dict') return value.body;
  return rawDicts.get(value.id) || objects.get(value.id) || null;
}

function referencedImageCount(dict: string, objects: Map<number, string>, rawDicts: Map<number, string>): number {
  const resources = resolveKey(dict, 'Resources', rawDicts, objects);
  if (!resources) return 0;
  const xobjects = resolveKey(resources, 'XObject', rawDicts, objects);
  if (!xobjects) return 0;
  const isImage = (id: number) => {
    const visible = objects.get(id) || '';
    const rawDict = rawDicts.get(id) || '';
    // The Flate strip deletes /Subtype when it sits after /Filter. The raw dict still has it.
    return /\/Subtype\s*\/Image/.test(visible) || /\/Subtype\s*\/Image/.test(rawDict);
  };
  const images = new Set<number>();
  for (const item of xobjects.matchAll(/(\d+)\s+\d+\s+R/g)) {
    const id = Number(item[1]);
    if (isImage(id)) images.add(id);
  }
  return (xobjects.match(/\/Subtype\s*\/Image/g) || []).length + images.size;
}

function isPageDict(body: string): boolean {
  return /\/Type\s*\/Page(?!s)/.test(body);
}

/** Page-tree order. Object order is only the fallback when Kids is missing. */
function orderedPageIds(objects: Map<number, string>): number[] {
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
  return ordered;
}

function orderedPageBodies(objects: Map<number, string>): string[] {
  return orderedPageIds(objects).map((id) => objects.get(id) || '');
}

/** Object ids whose stream dict carries a /Filter. Those bytes are not text we can read. */
function inflateFlate(data: Buffer): string {
  const opts = { maxOutputLength: 1_000_000 };
  try {
    return inflateSync(data, opts).toString('latin1');
  } catch {
    try {
      return inflateRawSync(data, opts).toString('latin1');
    } catch {
      return '';
    }
  }
}

/**
 * The integer stored in `N gen obj`, read from that object's body.
 * Digits inside a later stream are not another object.
 */
function objectInteger(raw: string, id: number, gen: number): number | null {
  const re = /(\d+)\s+(\d+)\s+obj/g;
  let match: RegExpExecArray | null;
  let value: number | null = null;
  while ((match = re.exec(raw))) {
    const after = match.index + match[0].length;
    const endobj = raw.indexOf('endobj', after);
    if (endobj < 0) break;
    let bodyEnd = endobj;
    let stop = endobj + 'endobj'.length;
    const streamAt = raw.indexOf('stream', after);
    if (streamAt >= 0 && streamAt < endobj) {
      const endstream = raw.indexOf('endstream', streamAt);
      if (endstream >= 0) {
        const realEnd = raw.indexOf('endobj', endstream);
        if (realEnd >= 0) {
          bodyEnd = streamAt;
          stop = realEnd + 'endobj'.length;
        }
      }
    }
    if (Number(match[1]) === id && Number(match[2]) === gen) {
      const num = /^\s*(\d+)/.exec(raw.slice(after, bodyEnd));
      value = num ? Number(num[1]) : null;
    }
    re.lastIndex = stop;
  }
  return value;
}

/** Direct `/Length 24`, or `/Length 8 0 R` resolved to object 8. Never the object id itself. */
function declaredLength(dict: string, raw: string): number | null {
  const indirect = /\/Length\s+(\d+)\s+(\d+)\s+R/.exec(dict);
  if (indirect) return objectInteger(raw, Number(indirect[1]), Number(indirect[2]));
  const direct = /\/Length\s+(\d+)(?!\s+\d)/.exec(dict);
  return direct ? Number(direct[1]) : null;
}

/** Inflate one FlateDecode content stream. Uses /Length so a trailing byte is not stripped. */
function flatePayload(bytes: Uint8Array, id: number): string {
  // latin1 here is byte-preserving. TextDecoder('latin1') is windows-1252 and corrupts zlib bytes.
  const raw = Buffer.from(bytes).toString('latin1');
  const header = new RegExp(`${id}\\s+\\d+\\s+obj((?:(?!endobj)[\\s\\S])*?)stream\\r?\\n`).exec(raw);
  if (!header || !/FlateDecode/.test(header[1])) return '';
  const start = header.index + header[0].length;
  const length = declaredLength(header[1], raw);
  const end = length != null ? start + length : raw.indexOf('endstream', start);
  const capped = Math.min(end, bytes.length);
  if (capped <= start) return '';
  return inflateFlate(Buffer.from(bytes.subarray(start, capped)));
}

function compressedStreamIds(raw: string): Set<number> {
  const ids = new Set<number>();
  const re = /(\d+)\s+\d+\s+obj([\s\S]*?)(?:stream|endobj)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) {
    if (/\/Filter\b/.test(match[2])) ids.add(Number(match[1]));
  }
  return ids;
}

function thumbRefs(raw: string): Set<string> {
  const refs = new Set<string>();
  for (const item of raw.matchAll(/\/Thumb\s+(\d+)\s+(\d+)\s+R/g)) refs.add(`${item[1]} ${item[2]}`);
  return refs;
}

function withoutThumbSubtypes(visible: string, thumbs: Set<string>): string {
  if (thumbs.size === 0) return visible;
  return visible.replace(/(\d+)\s+(\d+)\s+obj[\s\S]*?endobj/g, (block, id: string, gen: string) => (
    thumbs.has(`${id} ${gen}`) ? block.replace(/\/Subtype\s*\/Image/g, '') : block
  ));
}

function looseImageCount(visible: string, thumbs: Set<string>): number {
  const body = thumbs.size === 0 ? visible : withoutThumbSubtypes(visible, thumbs);
  return (body.match(/\/Subtype\s*\/Image/g) || []).length;
}

function pagesFromContents(fileId: string, visible: string, raw: string, bytes: Uint8Array): PdfPageDescriptor[] | null {
  const objects = pdfObjects(visible);
  const pageDicts = orderedPageBodies(objects);
  const compressed = compressedStreamIds(raw);
  const dicts = rawDicts(raw);
  if (!pageDicts.some((dict) => contentIds(dict).length > 0)) return null;
  const pages = pageDicts.map((dict) => {
    const ids = contentIds(dict);
    const pieces: string[] = [];
    let unreadable = false;
    for (const id of ids) {
      const plain = textOperators(objects.get(id) || '');
      if (plain) {
        pieces.push(plain);
        continue;
      }
      if (!compressed.has(id)) continue;
      const inflated = textOperators(flatePayload(bytes, id));
      if (inflated) pieces.push(inflated);
      else unreadable = true;
    }
    const text = pieces.join(' ').replace(/\s+/g, ' ').trim();
    let imageCount = referencedImageCount(dict, objects, dicts);
    if (unreadable) imageCount = Math.max(imageCount, 1);
    return { text, imageCount };
  });
  if (!pages.some((page) => page.imageCount > 0)) {
    pages[0].imageCount = looseImageCount(visible, thumbRefs(raw));
  }
  return pages.map((page, index) => ({
    fileId,
    page: index + 1,
    text: page.text,
    imageCount: page.imageCount,
    imageAreaRatio: page.imageCount === 0 ? 0 : page.text ? 0.25 : 1,
  }));
}

type StreamObject = { id: number; dict: string; streamStart: number; streamEnd: number };

/** Classic objects only. A match inside a stream is not an object. */
function streamObjects(raw: string): StreamObject[] {
  const found: StreamObject[] = [];
  const re = /(\d+)\s+(\d+)\s+obj/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) {
    const after = match.index + match[0].length;
    const endobj = raw.indexOf('endobj', after);
    if (endobj < 0) break;
    let bodyEnd = endobj;
    let stop = endobj + 'endobj'.length;
    let streamStart = -1;
    let streamEnd = -1;
    const streamAt = raw.indexOf('stream', after);
    if (streamAt >= 0 && streamAt < endobj) {
      const endstream = raw.indexOf('endstream', streamAt);
      if (endstream >= 0) {
        const realEnd = raw.indexOf('endobj', endstream);
        if (realEnd >= 0) {
          bodyEnd = streamAt;
          stop = realEnd + 'endobj'.length;
          streamStart = streamAt + 'stream'.length;
          if (raw[streamStart] === '\r' && raw[streamStart + 1] === '\n') streamStart += 2;
          else if (raw[streamStart] === '\n') streamStart += 1;
          streamEnd = endstream;
        }
      }
    }
    found.push({ id: Number(match[1]), dict: raw.slice(after, bodyEnd), streamStart, streamEnd });
    re.lastIndex = stop;
  }
  return found;
}

function objectsInStream(decoded: string, count: number, first: number): Array<{ id: number; value: string }> {
  const nums = decoded.slice(0, first).match(/\d+/g);
  if (!nums || nums.length < count * 2) return [];
  const pairs: Array<{ id: number; offset: number }> = [];
  for (let i = 0; i < count; i += 1) pairs.push({ id: Number(nums[i * 2]), offset: Number(nums[i * 2 + 1]) });
  const ordered = [...pairs].sort((a, b) => a.offset - b.offset);
  return ordered.map((pair, index) => {
    const start = first + pair.offset;
    const end = index + 1 < ordered.length ? first + ordered[index + 1].offset : decoded.length;
    return { id: pair.id, value: decoded.slice(start, end).trim() };
  });
}

/**
 * PDF 1.5 stores page dictionaries inside a FlateDecode /ObjStm.
 * Append those objects in classic form. A second call finds them already written and stops.
 */
function expandObjectStreams(bytes: Uint8Array): Uint8Array {
  const raw = Buffer.from(bytes).toString('latin1');
  const objects = streamObjects(raw);
  const classic = new Set(objects.filter((item) => !/\/Type\s*\/ObjStm\b/.test(item.dict)).map((item) => item.id));
  const extras: Buffer[] = [];
  for (const item of objects) {
    if (!/\/Type\s*\/ObjStm\b/.test(item.dict) || item.streamStart < 0) continue;
    const count = Number((/\/N\s+(\d+)/.exec(item.dict) || [])[1]);
    const first = Number((/\/First\s+(\d+)/.exec(item.dict) || [])[1]);
    if (!count || !Number.isFinite(first)) continue;
    const length = declaredLength(item.dict, raw);
    const streamEnd = length != null ? Math.min(item.streamStart + length, item.streamEnd) : item.streamEnd;
    if (streamEnd <= item.streamStart) continue;
    const payload = Buffer.from(bytes.subarray(item.streamStart, streamEnd));
    const decoded = /FlateDecode/.test(item.dict) ? inflateFlate(payload) : payload.toString('latin1');
    if (!decoded) continue;
    for (const entry of objectsInStream(decoded, count, first)) {
      if (!entry.value || classic.has(entry.id)) continue;
      classic.add(entry.id);
      extras.push(Buffer.from(`${entry.id} 0 obj\n${entry.value}\nendobj\n`, 'latin1'));
    }
  }
  if (extras.length === 0) return bytes;
  return Buffer.concat([Buffer.from(bytes), Buffer.from('\n'), ...extras]);
}

export function describePdfBytes(fileId: string, bytes: Uint8Array): PdfPageDescriptor[] {
  bytes = expandObjectStreams(bytes);
  const raw = new TextDecoder('latin1').decode(bytes);
  if (!raw.includes('%PDF')) {
    return [{ fileId, page: 1, text: '', imageCount: 0, imageAreaRatio: 0 }];
  }
  if (/\/Encrypt\b/.test(raw)) {
    return [{ fileId, page: 1, text: '', imageCount: 0, imageAreaRatio: 0, locked: true }];
  }
  const visible = raw.replace(/\/Filter\s*\/FlateDecode[\s\S]*?endstream/g, '');
  const perPage = pagesFromContents(fileId, visible, raw, bytes);
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
  const thumbs = thumbRefs(raw);
  if (thumbs.size > 0) {
    const imageCount = (withoutThumbSubtypes(visible, thumbs).match(/\/Subtype\s*\/Image/g) || []).length;
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

type ObjSlice = {
  dictStart: number;
  dictEnd: number;
  streamStart: number;
  streamEnd: number;
};

/** Byte offsets for classic `N gen obj` bodies. Object streams are not expanded. */
function indexObjects(bytes: Uint8Array): Map<number, ObjSlice> {
  const raw = Buffer.from(bytes).toString('latin1');
  const found = new Map<number, ObjSlice>();
  const re = /(\d+)\s+(\d+)\s+obj/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) {
    const id = Number(match[1]);
    const after = match.index + match[0].length;
    const endobj = raw.indexOf('endobj', after);
    if (endobj < 0) break;
    let dictEnd = endobj;
    let streamStart = -1;
    let streamEnd = -1;
    let end = endobj + 'endobj'.length;
    const streamRel = raw.indexOf('stream', after);
    if (streamRel >= 0 && streamRel < endobj) {
      const endstream = raw.indexOf('endstream', streamRel);
      if (endstream >= 0) {
        const realEndobj = raw.indexOf('endobj', endstream);
        if (realEndobj >= 0) end = realEndobj + 'endobj'.length;
        dictEnd = streamRel;
        streamStart = streamRel + 'stream'.length;
        if (raw[streamStart] === '\r' && raw[streamStart + 1] === '\n') streamStart += 2;
        else if (raw[streamStart] === '\n') streamStart += 1;
        streamEnd = endstream;
      }
    }
    found.set(id, { dictStart: after, dictEnd, streamStart, streamEnd });
    re.lastIndex = end;
  }
  return found;
}

function skipTreeRefs(dict: string): string {
  return dict
    .replace(/\/Parent\s+\d+\s+\d+\s+R/g, '')
    .replace(/\/Prev\s+\d+\s+\d+\s+R/g, '')
    .replace(/\/Next\s+\d+\s+\d+\s+R/g, '')
    .replace(/\/Thumb\s+\d+\s+\d+\s+R/g, '');
}

function followRefs(dict: string, slices: Map<number, ObjSlice>, raw: string): number[] {
  const ids: number[] = [];
  for (const item of skipTreeRefs(dict).matchAll(/(\d+)\s+\d+\s+R/g)) {
    const id = Number(item[1]);
    const target = slices.get(id);
    if (!target) continue;
    const body = raw.slice(target.dictStart, target.dictEnd);
    if (/\/Type\s*\/Page(?!s)/.test(body)) continue;
    if (/\/Type\s*\/Pages\b/.test(body)) continue;
    if (/\/Type\s*\/Catalog\b/.test(body)) continue;
    ids.push(id);
  }
  return ids;
}

function streamSlice(raw: string, bytes: Uint8Array, slice: ObjSlice): Buffer | null {
  if (slice.streamStart < 0 || slice.streamEnd < slice.streamStart) return null;
  const dict = raw.slice(slice.dictStart, slice.dictEnd);
  const direct = /\/Length\s+(\d+)(?!\s+\d)/.exec(dict);
  let end = slice.streamEnd;
  if (direct) {
    const byLength = slice.streamStart + Number(direct[1]);
    if (byLength > slice.streamStart && byLength <= slice.streamEnd) end = byLength;
  }
  return Buffer.from(bytes.subarray(slice.streamStart, end));
}

const INHERITED_PAGE_KEYS = ['Resources', 'MediaBox', 'CropBox', 'Rotate', 'BleedBox', 'TrimBox', 'ArtBox'];

function dictHasKey(dict: string, key: string): boolean {
  return new RegExp(`\\/${key}(?![A-Za-z0-9])`).test(dict);
}

function valueText(dict: string, key: string): string | null {
  const rest = valueAfter(dict, key);
  if (rest == null) return null;
  const ref = /^(\d+)\s+\d+\s+R/.exec(rest);
  if (ref) return ref[0];
  if (rest.startsWith('<<')) {
    const parsed = readPdfValue(rest);
    return parsed && parsed.kind === 'dict' ? parsed.body : null;
  }
  if (!rest.startsWith('[')) {
    const name = /^\/[A-Za-z0-9]+/.exec(rest);
    if (name) return name[0];
    const num = /^-?\d+(?:\.\d+)?/.exec(rest);
    return num ? num[0] : null;
  }
  let depth = 0;
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === '[') depth += 1;
    else if (rest[i] === ']') {
      depth -= 1;
      if (depth === 0) return rest.slice(0, i + 1);
    }
  }
  return null;
}

function parentObjectId(dict: string): number | null {
  const match = /\/Parent\s+(\d+)\s+\d+\s+R/.exec(dict);
  return match ? Number(match[1]) : null;
}

/** Page attributes that PDF stores on a parent /Pages node. Copied onto this page only. */
function withInherited(pageDict: string, slices: Map<number, ObjSlice>, raw: string): string {
  const extras: string[] = [];
  const seen = new Set<number>();
  let current = parentObjectId(pageDict);
  while (current != null && slices.has(current) && !seen.has(current)) {
    seen.add(current);
    const slice = slices.get(current);
    if (!slice) break;
    const dict = raw.slice(slice.dictStart, slice.dictEnd);
    if (!/\/Type\s*\/Pages\b/.test(dict)) break;
    for (const key of INHERITED_PAGE_KEYS) {
      if (dictHasKey(pageDict, key) || extras.some((item) => item.startsWith(`/${key} `))) continue;
      const value = valueText(dict, key);
      if (value) extras.push(`/${key} ${value}`);
    }
    current = parentObjectId(dict);
  }
  if (extras.length === 0) return pageDict;
  const at = pageDict.indexOf('<<');
  if (at < 0) return pageDict;
  return `${pageDict.slice(0, at + 2)} ${extras.join(' ')}${pageDict.slice(at + 2)}`;
}

function rewriteDict(dict: string, idMap: Map<number, number>, parentId: number | null): string {
  let next = skipTreeRefs(dict).replace(/(\d+)\s+\d+\s+R/g, (_full, id: string) => {
    const mapped = idMap.get(Number(id));
    return mapped ? `${mapped} 0 R` : 'null';
  });
  if (parentId != null) {
    const at = next.indexOf('<<');
    if (at >= 0) next = `${next.slice(0, at + 2)} /Parent ${parentId} 0 R${next.slice(at + 2)}`;
  }
  return next;
}

function emitObject(id: number, dict: string, stream: Buffer | null): Buffer {
  const head = Buffer.from(`${id} 0 obj\n${dict.trim()}\n`, 'latin1');
  if (!stream) return Buffer.concat([head, Buffer.from('endobj\n', 'latin1')]);
  return Buffer.concat([
    head,
    Buffer.from('stream\n', 'latin1'),
    stream,
    Buffer.from('\nendstream\nendobj\n', 'latin1'),
  ]);
}

function buildPdf(parts: Buffer[]): Buffer {
  const header = Buffer.from('%PDF-1.4\n');
  const offsets: number[] = [0];
  let cursor = header.length;
  for (const part of parts) {
    offsets.push(cursor);
    cursor += part.length;
  }
  let xref = `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i += 1) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${cursor}\n%%EOF\n`;
  return Buffer.concat([header, ...parts, Buffer.from(xref + trailer)]);
}

/**
 * One page as its own PDF, for the vision door. Copies the page object and the
 * objects it references, including Resources and boxes inherited from a parent Pages node.
 * Does not render, and does not follow Kids or a thumbnail.
 * Returns null when the copy would not open the same door as the source page.
 */
export function pdfPageBytes(bytes: Uint8Array, pageNumber: number): Uint8Array | null {
  if (pageNumber < 1) return null;
  bytes = expandObjectStreams(bytes);
  const raw = Buffer.from(bytes).toString('latin1');
  const visible = raw.replace(/\/Filter\s*\/FlateDecode[\s\S]*?endstream/g, '');
  const pageId = orderedPageIds(pdfObjects(visible))[pageNumber - 1];
  const slices = indexObjects(bytes);
  const pageSlice = pageId ? slices.get(pageId) : undefined;
  if (!pageId || !pageSlice) return null;
  const pageDict = withInherited(raw.slice(pageSlice.dictStart, pageSlice.dictEnd), slices, raw);
  const keepOrder: number[] = [];
  const keep = new Set<number>();
  const queue = [pageId];
  while (queue.length) {
    const id = queue.shift();
    if (id == null || keep.has(id)) continue;
    const slice = slices.get(id);
    if (!slice) continue;
    keep.add(id);
    keepOrder.push(id);
    const dict = id === pageId ? pageDict : raw.slice(slice.dictStart, slice.dictEnd);
    for (const ref of followRefs(dict, slices, raw)) if (!keep.has(ref)) queue.push(ref);
  }
  const idMap = new Map<number, number>();
  keepOrder.forEach((old, index) => idMap.set(old, index + 3));
  const pageNew = idMap.get(pageId);
  if (!pageNew) return null;
  const parts = [
    emitObject(1, '<< /Type /Catalog /Pages 2 0 R >>', null),
    emitObject(2, `<< /Type /Pages /Count 1 /Kids [${pageNew} 0 R] >>`, null),
  ];
  for (const old of keepOrder) {
    const slice = slices.get(old);
    if (!slice) return null;
    const dict = old === pageId ? pageDict : raw.slice(slice.dictStart, slice.dictEnd);
    parts.push(emitObject(idMap.get(old) || 0, rewriteDict(dict, idMap, old === pageId ? 2 : null), streamSlice(raw, bytes, slice)));
  }
  const out = buildPdf(parts);
  const sourcePage = describePdfBytes('full', bytes)[pageNumber - 1];
  const splitPages = describePdfBytes('split', out);
  const splitPage = splitPages[0];
  if (!sourcePage || splitPages.length !== 1 || !splitPage) return null;
  if (routePdfPage(splitPage).door !== routePdfPage(sourcePage).door) return null;
  return out;
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
