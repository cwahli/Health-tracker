/**
 * turn-store.mjs — what a real bot turn hands to the Google store.
 *
 * This is the seam between a chat turn and the store, and it is deliberately thin:
 * a turn **spools** and returns. It never awaits Google, never retries, and never
 * throws into the message path. The flush is a separate concern
 * (`flushTurns`) that runs on a timer, on demand from `/store`, or from the
 * scorecard.
 *
 * The row shape is the store's contract with the fleet: one line per turn, in the
 * order it happened, never edited afterwards. If a column is not known it is left
 * empty rather than guessed — an invented token count or a "0" that means "not
 * measured" is worse than a blank cell, because a blank cell can be asked about.
 */

import { objectName } from './google-store.mjs';
import { flushSpool, pruneFlushed, readItems, spoolItem, spoolDir } from './store-spool.mjs';

export const ROW_HEADER = ['at', 'bot', 'location', 'chat', 'project', 'role', 'model', 'lane', 'outcome', 'ms', 'note'];

/** The row for one turn, in ROW_HEADER order. Unknown values stay empty. */
export function turnRow(t) {
  return [
    t.at || new Date().toISOString(),
    t.bot || '',
    t.location || '',
    t.chat === undefined || t.chat === null ? '' : String(t.chat),
    t.project || '',
    t.role || '',
    t.model || '',
    t.lane || '',
    t.outcome || '',
    Number.isFinite(t.ms) ? String(Math.round(t.ms)) : '',
    String(t.note || '').slice(0, 200),
  ];
}

/** The turn log as markdown, for the Drive side. Same facts, readable by a human. */
export function turnMarkdown(t) {
  const lines = [
    `# Turn ${t.at || '(no time)'}`,
    '',
    '| field | value |',
    '| --- | --- |',
    `| bot | ${t.bot || ''} |`,
    `| location | ${t.location || ''} |`,
    `| chat | ${t.chat ?? ''} |`,
    `| project | ${t.project || ''} |`,
    `| role | ${t.role || ''} |`,
    `| model | ${t.model || ''} |`,
    `| lane | ${t.lane || ''} |`,
    `| outcome | ${t.outcome || ''} |`,
    `| duration | ${Number.isFinite(t.ms) ? `${Math.round(t.ms)} ms` : ''} |`,
  ];
  if (t.prompt) lines.push('', '## Prompt', '', '```', String(t.prompt).slice(0, 2000), '```');
  if (t.answer) lines.push('', '## Answer', '', '```', String(t.answer).slice(0, 4000), '```');
  if (t.note) lines.push('', `> ${t.note}`);
  return `${lines.join('\n')}\n`;
}

/**
 * Record a finished turn. Returns what was spooled, and cannot throw: a store that
 * is misconfigured must not cost the chat its answer, it must show up as a red row
 * in `/store` instead.
 */
export function recordTurn(turn, { home } = {}) {
  const bot = turn.bot || 'unknown';
  const at = turn.at || new Date().toISOString();
  const name = objectName({
    at,
    location: turn.location,
    chat: turn.chat,
    turnId: turn.turnId || `${bot}-${Date.now().toString(36)}`,
    slug: 'turn',
  });
  const out = { ok: true, name, spooled: [] };
  try {
    out.spooled.push({ kind: 'sheet-row', name, ...spoolItem(bot, { kind: 'sheet-row', at, project: turn.project, tab: 'turn_log', values: turnRow({ ...turn, at }) }, { home, at }) });
  } catch (err) {
    out.ok = false;
    out.error = `sheet row not spooled: ${err.message}`;
  }
  try {
    out.spooled.push({ kind: 'drive-object', name, ...spoolItem(bot, { kind: 'drive-object', at, project: turn.project, name: `${name}.md`, mimeType: 'text/markdown', content: turnMarkdown({ ...turn, at }) }, { home, at }) });
  } catch (err) {
    out.ok = false;
    out.error = `${out.error ? `${out.error}; ` : ''}drive object not spooled: ${err.message}`;
  }
  return out;
}

export function pendingTurns(bot, { home } = {}) {
  return readItems(bot, { home });
}

export function storeStatus(bot, { home } = {}) {
  const pending = readItems(bot, { home });
  const byKind = {};
  for (const i of pending) byKind[i.kind] = (byKind[i.kind] || 0) + 1;
  return { dir: spoolDir(bot, { home }), pending: pending.length, byKind, oldest: pending[0]?.at || '' };
}

/**
 * Flush this bot's spool. `deps` is injected so the whole path is testable with no
 * network: the caller supplies `upload` and `append`.
 */
export async function flushTurns(bot, deps, { home, limit = 50 } = {}) {
  const { upload, append, onEvent } = deps;
  const send = async (item) => {
    if (item.kind === 'sheet-row') {
      const r = await append(item);
      if (onEvent) onEvent({ kind: 'sheet-row', ok: r.ok !== false, detail: r.error || r.range || '' });
      return r;
    }
    if (item.kind === 'drive-object') {
      const r = await upload(item);
      if (onEvent) onEvent({ kind: 'drive-object', ok: r.ok !== false, detail: r.error || r.id || '' });
      return r;
    }
    return { ok: true, skipped: item.kind };
  };
  const report = await flushSpool(bot, send, { home, limit });
  if (report.failed === 0) pruneFlushed(bot, { home });
  return report;
}
