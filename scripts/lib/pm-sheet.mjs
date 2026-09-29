/**
 * pm-sheet.mjs — responsibility 3 of the PM role: the ongoing-projects sheet.
 *
 * THE GOVERNED WRITER, NOT A NEW ONE
 * ----------------------------------
 * A PM that opened its own Google client would be a second write path with its
 * own credential handling, its own retry story and its own way of being wrong.
 * So this file adds no client. It reuses the two halves the fleet already has:
 *
 *   - `google-writer.mjs`'s `writerFor()` — the honest readiness gate ("is there
 *     an identity on this host at all?"), and
 *   - `google-store.mjs`'s `appendRows()` — the only Sheets write shape in the
 *     repo, append-only.
 *
 * Between them sits `store-spool.mjs`, which is the reason a chat turn never
 * waits on Google. The PM spools its rows and flushes them; a Google outage
 * delays the sheet, it does not fail the cycle and it does not lose the row.
 *
 * OUTSIDE THE PROJECT FOLDERS
 * ---------------------------
 * The sheet is found by a configured **id** (`GOOGLE_PM_SHEET_ID`), never by
 * name, and the PM never creates it. That is what keeps it outside the project
 * folders: there is no `parents: [...]` call anywhere on this path, so a fleet
 * view can never land inside one project's Drive tree and start reading as that
 * project's private log. Finding by id is also the rule `google-writer.mjs`
 * already states for the turn log — a renamed sheet cannot silently split the
 * view in two.
 *
 * It deliberately does NOT use `googleReady()`: that gate also demands a
 * `GOOGLE_FOLDER_<project>`, which a fleet-wide view has no business needing.
 * Readiness here is "an identity exists AND the sheet id is configured", and the
 * exact commands only the operator can run are returned when it is not.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { identityFromEnv, redact, appendRows } from './google-store.mjs';
import { writerFor } from './google-writer.mjs';
import { spoolItem, flushSpool, readItems } from './store-spool.mjs';

/** The tab every PM row lands on. */
export const PM_TAB = 'ongoing_projects';

/** The row layout, in order. `sheetRow` is the only writer, so it cannot drift. */
export const SHEET_COLUMNS = [
  'at',
  'key',
  'kind',
  'id',
  'state',
  'blocked',
  'stall_reason',
  'rung',
  'attempts',
  'owner',
  'source',
];

/** The spreadsheet id, configured not discovered. */
export function pmSheetId(env = process.env) {
  return String(env.GOOGLE_PM_SHEET_ID || '').trim().replace(/^["']|["']$/g, '');
}

/** Where the "header already written" marker lives, owned by this module alone. */
export function headerMarkerPath(botId, { home = os.homedir() } = {}) {
  const id = String(botId || 'vm').trim() || 'vm';
  return path.join(home, '.local', 'state', 'bot-host', id, 'pm-sheet-header.json');
}

/** The header row, once per host. */
export function headerRow() {
  return SHEET_COLUMNS.slice();
}

/** One fleet item (plus its ladder position) → one row, in column order. */
export function sheetRow(item, { at = new Date().toISOString(), rung = '', attempts = 0 } = {}) {
  const cell = (v) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').slice(0, 240);
  return [
    cell(at),
    cell(item.key),
    cell(item.kind),
    cell(item.id),
    cell(item.state),
    item.blocked ? 'yes' : 'no',
    cell(item.stallReason),
    cell(rung),
    String(Number(attempts) || 0),
    cell(item.owner),
    cell(item.source),
  ];
}

/** Rows for a whole fleet, with each item's ladder position. */
export function sheetRows(fleet, { at = new Date().toISOString(), ladderOf = () => ({}) } = {}) {
  return (fleet?.items || []).map((item) => {
    const pos = ladderOf(item) || {};
    return { item, values: sheetRow(item, { at, rung: pos.rung || '', attempts: pos.attempts || 0 }) };
  });
}

/**
 * Can this host write the sheet, and what is missing if not.
 *
 * `hostCommands` is the part that matters: everything listed there needs the
 * operator's phone, their Google consent, or root on the host. The PM prints
 * them instead of pretending it can do them.
 */
export function sheetReadiness(env = process.env) {
  const who = identityFromEnv(env);
  const sheetId = pmSheetId(env);
  const hostCommands = [];
  if (!who.ok) {
    hostCommands.push('node scripts/google-authorize.mjs   # one-time consent, in a browser on the operator\'s machine');
  }
  if (!sheetId) {
    hostCommands.push("printf 'GOOGLE_PM_SHEET_ID=%s\\n' '<spreadsheet-id>' >> ~/.config/bot-host/common.env");
    hostCommands.push('systemctl --user restart bot-host@vm   # so the bot host picks the id up');
  }
  if (who.ok && sheetId) return { ready: true, reason: '', kind: who.kind, account: who.email || '', sheetId, hostCommands: [] };
  const reason = !who.ok
    ? `no Google identity on this host — ${who.reason}`
    : 'GOOGLE_PM_SHEET_ID is not set (the sheet is found by id, never by name)';
  return { ready: false, reason, kind: who.kind || 'none', account: who.email || '', sheetId, hostCommands };
}

/** Spool one row (or the header) through the store's durability boundary. */
export function spoolSheetRow(botId, values, { home = os.homedir(), at = Date.now(), tab = PM_TAB } = {}) {
  return spoolItem(botId, { kind: 'pm-project-row', tab, values, at: new Date(at).toISOString() }, { home, at });
}

/**
 * Spool this cycle's rows, seeding the header on the first cycle this host runs.
 *
 * The header goes through the same spool as the rows so it cannot arrive out of
 * order, and the marker is written only after the header is spooled — a crash in
 * between costs one duplicate header line, which is cheaper than a sheet with no
 * header at all.
 */
export function spoolFleetRows(botId, fleet, { home = os.homedir(), at = Date.now(), ladderOf } = {}) {
  const rows = sheetRows(fleet, { at: new Date(at).toISOString(), ladderOf });
  const marker = headerMarkerPath(botId, { home });
  let header = false;
  if (!fs.existsSync(marker)) {
    spoolSheetRow(botId, headerRow(), { home, at });
    try {
      fs.mkdirSync(path.dirname(marker), { recursive: true, mode: 0o700 });
      fs.writeFileSync(marker, JSON.stringify({ writtenAt: new Date(at).toISOString() }) + '\n', { mode: 0o600 });
    } catch {
      // A marker we cannot write means a possible duplicate header next cycle.
    }
    header = true;
  }
  for (const row of rows) spoolSheetRow(botId, row.values, { home, at });
  return { spooled: rows.length, header, values: rows.map((r) => r.values) };
}

/**
 * The spool's `send` for PM rows: one append on the configured sheet id.
 *
 * `flushSpool` hands each item to this function, so the PM reuses the spool's
 * cursor semantics (a row is only marked flushed once Google confirmed it)
 * without adding a second queue.
 */
export function sheetSend(writer, env = process.env, { appendRows: append = appendRows } = {}) {
  const sheetId = pmSheetId(env);
  return async (item) => {
    if (!sheetId) return { ok: false, error: 'GOOGLE_PM_SHEET_ID is not set (the sheet is found by id, never by name)' };
    if (!writer || !writer.token) return { ok: false, error: 'no Google token on the writer (google-authorize first)' };
    const res = await append(sheetId, item.tab || PM_TAB, [item.values], writer.token);
    if (res && res.ok) return { ok: true };
    return { ok: false, error: redact(res?.error || `HTTP ${res?.status || '?'}`) };
  };
}

/**
 * Flush the PM spool. Refuses honestly when the host has no identity or no sheet
 * id — the rows stay queued either way, so a later cycle with credentials sends
 * them rather than dropping them.
 */
export async function flushSheet(botId, {
  env = process.env,
  home = os.homedir(),
  limit = 50,
  writer = null,
  recipient = null,
} = {}) {
  const readiness = sheetReadiness(env);
  if (!readiness.ready && !recipient) {
    const queued = readItems(botId, { home });
    return { ok: false, reason: readiness.reason, hostCommands: readiness.hostCommands, sent: 0, failed: 0, queued: queued.length };
  }
  let w = writer;
  if (!w) w = await writerFor(env, { force: true });
  if (!w.ok) {
    const queued = readItems(botId, { home });
    return { ok: false, reason: w.reason || 'the store is not ready', hostCommands: sheetReadiness(env).hostCommands, sent: 0, failed: 0, queued: queued.length };
  }
  const report = await flushSpool(botId, recipient || sheetSend(w, env), { home, limit, accept: (item) => item.kind === 'pm-project-row' });
  return {
    ok: report.failed === 0,
    reason: report.firstError || '',
    hostCommands: [],
    sent: report.sent,
    failed: report.failed,
    queued: report.remaining,
    kind: w.kind,
    account: w.account || '',
  };
}

/** A one-line summary of a flush for the chat. */
export function renderFlush(flush) {
  if (flush.ok) {
    return `📊 sheet: ${flush.sent} row(s) sent${flush.queued ? `, ${flush.queued} still queued` : ''}.`;
  }
  const lines = [`📊 sheet: nothing sent — ${redact(flush.reason || 'unknown')}`];
  if (flush.queued) lines.push(`• ${flush.queued} row(s) are spooled and will send once this is fixed (nothing is lost).`);
  if (flush.hostCommands?.length) {
    lines.push('• Only you can do this:');
    for (const cmd of flush.hostCommands) lines.push(`  \`${cmd}\``);
  }
  return lines.join('\n');
}
