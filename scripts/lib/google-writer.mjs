/**
 * google-writer.mjs — the flush half of the store: spool item → Google call.
 *
 * Split from `turn-store.mjs` on purpose. The spool and the row shape are pure and
 * testable with no credential; this file is the only place that turns a spooled
 * item into an API call, so the governed write path is one short, readable file
 * rather than something spread across the bot.
 *
 * It holds the laws the plan cares about, because laws that live only in a design
 * document are not laws:
 *   - the sheet is found by id, never by name, so a renamed sheet cannot silently
 *     split the turn log in two
 *   - rows are appended, never written over
 *   - a Drive object is written once, under the content-addressed name the spool
 *     already carries, so a re-send after a crash is idempotent
 *   - a write that Google refuses is reported, never retried into a duplicate
 */

import { SCOPES, accessToken, appendRows, createFile, forgetToken, folderFor, googleReady, identityFromEnv, listFolder, MIME } from './google-store.mjs';

/** The spreadsheet the turn log appends to. Configured, not discovered. */
export function turnLogSheetId(env = process.env) {
  return String(env.GOOGLE_TURN_LOG_SHEET_ID || '').trim().replace(/^["']|["']$/g, '');
}

export async function writerFor(env = process.env, { force = false } = {}) {
  const ready = googleReady(env);
  if (!ready.ready) return { ok: false, reason: ready.reason, kind: ready.kind || 'none' };
  const tok = await accessToken(identityFromEnv(env), { force, scopes: Object.values(SCOPES) });
  if (!tok.ok) return { ok: false, reason: tok.error || 'token grant failed', kind: ready.kind };
  return { ok: true, kind: ready.kind, account: ready.email, token: tok.token };
}

/**
 * Create the turn-log spreadsheet inside the project folder, once.
 * `spreadsheets.create` cannot set a parent, so the file is created through Drive
 * and the tab renamed — see createSheet in google-store.
 */
export async function ensureTurnLog(env, writer, { createSheet, title = 'fleet-turn-log' } = {}) {
  const existing = turnLogSheetId(env);
  if (existing) return { ok: true, id: existing, created: false };
  if (!writer.ok) return { ok: false, reason: writer.reason };
  const folder = folderFor(googleReady(env), 'health-tracker');
  if (!folder) return { ok: false, reason: 'no Google folder enrolled for health-tracker' };
  const made = await createSheet(folder, `${title}-${new Date().toISOString().slice(0, 7)}`, { tabName: 'turn_log' }, writer.token);
  if (!made.ok) return { ok: false, reason: made.error || 'could not create the turn log' };
  return { ok: true, id: made.spreadsheetId, created: true, tab: made.tab, warning: made.tabWarning || '' };
}

/** The two writes the spool knows how to perform. */
export function makeSends(writer, env = process.env) {
  const folder = folderFor(googleReady(env), 'health-tracker');
  const sheetId = turnLogSheetId(env);
  return {
    async upload(item) {
      if (!folder) return { ok: false, error: 'no Google folder enrolled for this project' };
      return createFile(folder, item.name, { mimeType: item.mimeType || MIME.md, content: item.content || '' }, writer.token);
    },
    async append(item) {
      if (!sheetId) return { ok: false, error: 'GOOGLE_TURN_LOG_SHEET_ID is not set (run with --create-sheet)' };
      return appendRows(sheetId, item.tab || 'turn_log', [item.values], writer.token);
    },
  };
}

export { forgetToken, listFolder };
