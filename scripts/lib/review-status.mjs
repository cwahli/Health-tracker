/**
 * review-status.mjs — State module for the /review Telegram Mini App.
 *
 * Responsibility:
 * 1. Read tab 'current' from the PM spreadsheet and project the rows whose
 *    Status is `review` (set by the agent when work is ready for human eyes).
 * 2. Resolve each item's proof screenshots from Drive folder "Work done"
 *    (one subfolder per ticket key, possibly several images).
 * 3. Human verdicts, written back to the sheet through the one Google client
 *    (`google-store.mjs`): approve moves the row to `archive_done` with
 *    Status Done, comment appends stamped feedback to "What's left to do"
 *    (incorrect proof) or "Original request" (extra feature).
 *
 * The fleet projection stays strictly read-only; this module is the review
 * queue's governed writer, and the only writer that edits sheet cells in place.
 */

import { loadHostEnv, identityFromEnv, accessToken, readTab, appendRows, updateValues, deleteSheetRows, getSheet, listFolder, downloadFile } from './google-store.mjs';
import { pmSheetId } from './pm-sheet.mjs';

export const REVIEW_TAB = 'current';
export const ARCHIVE_TAB = 'archive_done';
export const REVIEW_STATUS = 'review';
export const FALLBACK_SHEET_ID = '10oPI9AsHaKpb9xRR8XcTm6JyH1gYyykUFBNqeqg2SM0';
/** Drive folder "Work done" — one subfolder per ticket key holds proof shots. */
export const PROOF_DRIVE_FOLDER = '1G7dhvqRy7iOmRg7AfN9a6g8cbIhz14yS';

export const REVIEW_CACHE_TTL_MS = 15000;
export const REVIEW_FOLDER_CACHE_TTL_MS = 60000;
export const REVIEW_COMMENT_MAX = 2000;

const _deps = { readTab, appendRows, updateValues, deleteSheetRows, getSheet, listFolder, downloadFile, loadHostEnv, identityFromEnv, accessToken, pmSheetId };

let reviewCache = { cachedAt: 0, rows: [] };
let proofFolderCache = { cachedAt: 0, map: new Map() };

/** True when a Status cell means "awaiting human review". */
export function isReviewStatus(status) {
  return String(status || '').trim().toLowerCase() === REVIEW_STATUS;
}

/** Header row is the first of the top five rows containing a `key` cell. */
export function findHeaderIndex(rows) {
  const top = (Array.isArray(rows) ? rows : []).slice(0, 5);
  return top.findIndex((r) => Array.isArray(r) && r.some((c) => String(c || '').trim().toLowerCase() === 'key'));
}

/** Zero-based column index → A1 letters (A..Z, AA..). */
export function colLetter(index) {
  let n = Number(index);
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** One sheet row → one review item, projected by header name. */
export function mapReviewRow(vals, header, rowNumber) {
  const get = (name) => {
    const c = header.indexOf(String(name).toLowerCase());
    return c >= 0 && vals[c] !== undefined ? String(vals[c]) : '';
  };
  return {
    row: rowNumber,
    key: get('key'),
    ref: get('ref'),
    originalRequest: get('Original request'),
    workDone: get('Work done so far'),
    whatsLeft: get("What's left to do"),
    owner: get('Owner'),
    status: get('Status'),
    proof: get('Completion proof'),
    gate: get('Completion gate'),
    lastActivity: get('last_activity'),
  };
}

/** `[human 3 Oct]` — UK day + short month, the stamp on appended feedback. */
export function formatHumanStamp(now = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' }).format(new Date(now));
  return `[human ${parts}]`;
}

/** `14:10 - 3 oct (UK)` — the sheet's own last_activity shape, for updates. */
export function formatLastActivity(now = Date.now()) {
  const dtf = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short', timeZone: 'Europe/London', hour12: false });
  const parts = Object.fromEntries(dtf.formatToParts(new Date(now)).map((p) => [p.type, p.value]));
  return `${parts.hour}:${parts.minute} - ${parts.day} ${String(parts.month || '').toLowerCase()} (UK)`;
}

/**
 * Build the archive row in the archive tab's own header order. Status becomes
 * Done, state becomes done, archived_at records the verdict moment; every
 * other named field carries over from the current row.
 */
export function buildArchiveRow(archiveHeader, fields, nowIso) {
  const lower = archiveHeader.map((h) => String(h || '').trim().toLowerCase());
  const carry = {
    'ref': fields.ref || '',
    'original request': fields.originalRequest || '',
    'work done so far': fields.workDone || '',
    "what's left to do": fields.whatsLeft || '',
    'owner': fields.owner || '',
    'status': 'Done',
    'completion proof': fields.proof || '',
    'completion gate': fields.gate || '',
    'id': '',
    'key': fields.key || '',
    'kind': '',
    'state': 'done',
    'blocked': '',
    'stall_reason': '',
    'rung': '',
    'attempts': '',
    'source': 'review-miniapp',
    'agent_branch': '',
    'session': '',
    'tree': '',
    'agent_live': '',
    'github': '',
    'last_activity': nowIso,
    'built_at': '',
    'archived_at': nowIso,
    'session id': '',
  };
  return lower.map((h) => (h in carry ? carry[h] : ''));
}

/** Sheet + token for the review queue; mirrors the fleet read path's identity. */
export async function getReviewContext({ env = process.env, root = null, deps = _deps } = {}) {
  try {
    const { env: hostEnv } = deps.loadHostEnv('vm', env, { apply: false });
    const mergedEnv = { ...env, ...hostEnv };
    const sheetId = deps.pmSheetId(mergedEnv) || FALLBACK_SHEET_ID;
    const id = deps.identityFromEnv(mergedEnv);
    if (!sheetId || !id.ok) return { ok: false, reason: id?.error || id?.reason || 'no Google identity on this host' };
    const token = await deps.accessToken(id);
    if (!token.ok || !token.token) return { ok: false, reason: token.error || 'token grant failed' };
    return { ok: true, sheetId, token: token.token, env: mergedEnv };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) };
  }
}

/** Raw `current` rows with 1-based sheet row numbers. */
export async function readCurrentRows(ctx, { refresh = false, range = `${REVIEW_TAB}!A1:Z1000`, deps = _deps } = {}) {
  const now = Date.now();
  if (!refresh && reviewCache.cachedAt && now - reviewCache.cachedAt < REVIEW_CACHE_TTL_MS && reviewCache.rows.length) {
    return { ok: true, ...headerSplit(reviewCache.rows), cached: true };
  }
  const tabRes = await deps.readTab(ctx.sheetId, REVIEW_TAB, ctx.token, { range });
  if (!tabRes.ok || !Array.isArray(tabRes.json?.values) || !tabRes.json.values.length) {
    if (reviewCache.rows.length) return { ok: true, ...headerSplit(reviewCache.rows), cached: true, stale: true };
    return { ok: false, reason: tabRes?.error || 'sheet read failed' };
  }
  reviewCache = { cachedAt: now, rows: tabRes.json.values };
  return { ok: true, ...headerSplit(tabRes.json.values), cached: false };
}

function headerSplit(values) {
  const headerIdx = findHeaderIndex(values);
  if (headerIdx < 0) return { headerIdx: -1, header: [], numbered: [] };
  const header = values[headerIdx].map((h) => String(h || '').trim().toLowerCase());
  const numbered = [];
  for (let i = headerIdx + 1; i < values.length; i += 1) {
    const vals = values[i];
    if (!Array.isArray(vals) || !vals.some(Boolean)) continue;
    numbered.push({ rowNumber: i + 1, vals });
  }
  return { headerIdx, header, numbered };
}

/** Subfolder id per ticket key under "Work done" (60s cache). */
export async function proofFolderMap(ctx, { refresh = false, deps = _deps } = {}) {
  const now = Date.now();
  if (!refresh && proofFolderCache.cachedAt && now - proofFolderCache.cachedAt < REVIEW_FOLDER_CACHE_TTL_MS && proofFolderCache.map.size) {
    return { ok: true, map: proofFolderCache.map, cached: true };
  }
  const res = await deps.listFolder(PROOF_DRIVE_FOLDER, ctx.token, { pageSize: 100, fields: 'files(id,name,mimeType)' });
  if (!res.ok) return { ok: false, reason: res.error || 'proof folder list failed' };
  const map = new Map();
  for (const f of res.json?.files || []) {
    if (f?.mimeType === 'application/vnd.google-apps.folder' && f.name && f.id) map.set(f.name, f.id);
  }
  proofFolderCache = { cachedAt: now, map };
  return { ok: true, map, cached: false };
}

/** Image files inside one ticket's proof folder. */
export async function listProofImages(ctx, key, { deps = _deps } = {}) {
  const folders = await proofFolderMap(ctx, { deps });
  if (!folders.ok) return { ok: false, reason: folders.reason };
  const folderId = folders.map.get(String(key));
  if (!folderId) return { ok: true, images: [] };
  const res = await deps.listFolder(folderId, ctx.token, { pageSize: 100, fields: 'files(id,name,mimeType,modifiedTime)' });
  if (!res.ok) return { ok: false, reason: res.error || 'proof images list failed' };
  const images = (res.json?.files || [])
    .filter((f) => String(f?.mimeType || '').startsWith('image/') && f.id)
    .map((f) => ({ id: f.id, name: f.name || 'proof.png', mimeType: f.mimeType || 'image/png' }));
  return { ok: true, images, folderId };
}

/**
 * Every item awaiting human review: Status `review`, with proof images.
 * No Google identity → empty queue (the gateway still serves the shell).
 */
export async function getReviewItems({ env = process.env, root = null, refresh = false, deps = _deps } = {}) {
  const ctx = await getReviewContext({ env, root, deps });
  if (!ctx.ok) return { ok: true, google: false, items: [], reason: ctx.reason };
  const current = await readCurrentRows(ctx, { refresh, deps });
  if (!current.ok) return { ok: false, google: true, items: [], reason: current.reason };
  const items = [];
  for (const { rowNumber, vals } of current.numbered) {
    const item = mapReviewRow(vals, current.header, rowNumber);
    if (!item.key || !isReviewStatus(item.status)) continue;
    const proofs = await listProofImages(ctx, item.key, { deps });
    items.push({ ...item, proofs: proofs.ok ? proofs.images : [] });
  }
  return { ok: true, google: true, items };
}

/**
 * 👍 Approve: copy the row to `archive_done` (Status Done, archived_at set),
 * then delete it from `current` so it leaves the queue.
 */
export async function approveReviewItem(key, { env = process.env, deps = _deps, now = Date.now() } = {}) {
  const k = String(key || '').trim();
  if (!k) return { ok: false, error: 'missing key' };
  const ctx = await getReviewContext({ env, deps });
  if (!ctx.ok) return { ok: false, error: ctx.reason };
  const current = await readCurrentRows(ctx, { refresh: true, deps });
  if (!current.ok) return { ok: false, error: current.reason };
  const found = current.numbered.find(({ vals }) => {
    const item = mapReviewRow(vals, current.header, 0);
    return item.key === k;
  });
  if (!found) return { ok: false, error: 'item not found on current tab' };
  const fields = mapReviewRow(found.vals, current.header, found.rowNumber);
  if (!isReviewStatus(fields.status)) return { ok: false, error: `item is ${fields.status || 'not awaiting review'}, not review` };

  const nowIso = new Date(now).toISOString();
  const archRes = await deps.readTab(ctx.sheetId, ARCHIVE_TAB, ctx.token, { range: `${ARCHIVE_TAB}!1:1` });
  if (!archRes.ok || !Array.isArray(archRes.json?.values?.[0])) return { ok: false, error: archRes?.error || 'archive header read failed' };
  const archiveHeader = archRes.json.values[0].map((h) => String(h || ''));
  const appended = await deps.appendRows(ctx.sheetId, ARCHIVE_TAB, [buildArchiveRow(archiveHeader, fields, nowIso)], ctx.token);
  if (!appended.ok) return { ok: false, error: appended.error || 'archive append failed' };

  const meta = await deps.getSheet(ctx.sheetId, ctx.token);
  const tab = (meta.sheet?.sheets || []).find((s) => String(s?.properties?.title) === REVIEW_TAB);
  const gid = tab?.properties?.sheetId;
  if (gid === undefined || gid === null) return { ok: false, error: 'archived but current tab gid unresolved — row NOT deleted', archived: true };
  const deleted = await deps.deleteSheetRows(ctx.sheetId, gid, found.rowNumber - 1, found.rowNumber, ctx.token);
  if (!deleted.ok) return { ok: false, error: `archived but delete failed: ${deleted.error || 'unknown'}`, archived: true };
  reviewCache = { cachedAt: 0, rows: [] };
  return { ok: true, key: k };
}

/**
 * 💬 Comment: append stamped human feedback to "What's left to do"
 * (incorrect proof) or "Original request" (extra feature), and refresh
 * last_activity so the queue order stays honest.
 */
export async function commentReviewItem(key, text, target, { env = process.env, deps = _deps, now = Date.now() } = {}) {
  const k = String(key || '').trim();
  const body = String(text || '').trim();
  if (!k) return { ok: false, error: 'missing key' };
  if (!body) return { ok: false, error: 'empty comment' };
  if (body.length > REVIEW_COMMENT_MAX) return { ok: false, error: `comment over ${REVIEW_COMMENT_MAX} chars` };
  const colName = target === 'left' ? "what's left to do" : target === 'original' ? 'original request' : '';
  if (!colName) return { ok: false, error: 'target must be left or original' };

  const ctx = await getReviewContext({ env, deps });
  if (!ctx.ok) return { ok: false, error: ctx.reason };
  const current = await readCurrentRows(ctx, { refresh: true, deps });
  if (!current.ok) return { ok: false, error: current.reason };
  const found = current.numbered.find(({ vals }) => mapReviewRow(vals, current.header, 0).key === k);
  if (!found) return { ok: false, error: 'item not found on current tab' };
  const fields = mapReviewRow(found.vals, current.header, found.rowNumber);
  if (!isReviewStatus(fields.status)) return { ok: false, error: `item is ${fields.status || 'not awaiting review'}, not review` };

  const colIdx = current.header.indexOf(colName);
  const actIdx = current.header.indexOf('last_activity');
  if (colIdx < 0) return { ok: false, error: `column ${colName} missing` };
  const stamped = `${formatHumanStamp(now)} ${body}`;
  const existing = colName === "what's left to do" ? fields.whatsLeft : fields.originalRequest;
  const merged = existing ? `${existing}\n${stamped}` : stamped;
  const wrote = await deps.updateValues(ctx.sheetId, `${REVIEW_TAB}!${colLetter(colIdx)}${found.rowNumber}`, [[merged]], ctx.token);
  if (!wrote.ok) return { ok: false, error: wrote.error || 'comment write failed' };
  if (actIdx >= 0) {
    await deps.updateValues(ctx.sheetId, `${REVIEW_TAB}!${colLetter(actIdx)}${found.rowNumber}`, [[formatLastActivity(now)]], ctx.token);
  }
  reviewCache = { cachedAt: 0, rows: [] };
  return { ok: true, key: k, target, stamped };
}

/** Verify a Drive file id belongs to a ticket's proof folder (anti-open-proxy). */
export async function verifyProofFile(ctx, key, fileId, { deps = _deps } = {}) {
  const listed = await listProofImages(ctx, key, { deps });
  if (!listed.ok) return listed;
  const hit = listed.images.find((im) => im.id === String(fileId));
  if (!hit) return { ok: false, error: 'file is not a proof image of this item' };
  return { ok: true, file: hit, folderId: listed.folderId };
}

/** Clear in-memory caches (for sensor testing). */
export function resetReviewState() {
  reviewCache = { cachedAt: 0, rows: [] };
  proofFolderCache = { cachedAt: 0, map: new Map() };
}
