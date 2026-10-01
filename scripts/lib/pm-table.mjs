/**
 * pm-table.mjs — the PM's table surface, built the way Telegram can render.
 *
 * WHY A TABLE PATH AT ALL
 * -----------------------
 * Asked for "progress so far as a table", the seat hand-wrote wide pipe tables
 * inside ```text fences. Telegram has no table renderer, so those arrived
 * unaligned and unreadable — exactly what `skills/common/telegram-tables` exists
 * to prevent. The skill was available to the bot and the seat never mentioned
 * it, so the rule now lives where the PM reads it (the mandate) AND here, in
 * code that cannot be talked out of the shape.
 *
 * TWO PATHS, ONE RULE (the skill's, unchanged)
 * --------------------------------------------
 *   narrow (≤3 columns, ≤30 chars wide) -> padded monospace ```text fence,
 *     which the send path renders as <pre> and every client aligns.
 *   wide (anything else)                 -> JSON -> qa-evidence/build-table.py
 *     -> HTML grid -> `MEDIA:<abs path>`, a file that opens in Telegram's
 *     in-app browser with a sticky header and click-to-sort.
 *
 * Nothing is invented here: every cell comes from the fleet projection
 * (pm-fleet.mjs) and the sources block it already reports. A column that cannot
 * be filled is blank, and `droppedColumns` says so, because the skill's own
 * rule is that a wide table is never silently narrowed.
 *
 * `buildTablePy` and the grid fallback are injectable so the sensor drives every
 * branch without python3 or a browser.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { fallbackHtml, resolveBuildTablePy } from './free-lanes.mjs';
import { mdSafe } from './pm-fleet.mjs';

export const TABLE_MAX_COLS = 3;
export const TABLE_MAX_WIDTH = 30;

/** Item columns, in display order. `goal` is the original ask, not the id. */
export const ITEM_COLUMNS = ['id', 'kind', 'state', 'blocked', 'agent', 'goal'];

/** The rollup: three columns, so it can always be a phone-width fence. */
export const ROLLUP_COLUMNS = ['stream', 'count', 'status'];

function cell(v, max = 60) {
  return String(v ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\|/g, '/')
    .trim()
    .slice(0, max);
}

function titleOf(item) {
  if (item?.kind === 'spec') return String(item.title || item.goal || item.id || '');
  return String(item.title || item.id || '');
}

function goalOf(item) {
  return String(item.goal || item.title || item.id || '');
}

function agentOf(item) {
  // A live agent is named by its branch; a beat that exists but is stale says
  // "stale" rather than pretending the agent is still on it. No heartbeat at
  // all is blank — "not linked" is not "dead".
  if (!item?.branch) return '';
  if (item.live === true) return `${item.branch} (live)`;
  if (item.live === false) return `${item.branch} (stale)`;
  return item.branch;
}

/**
 * One row per fleet item, in the columns above. Exported so the sensor can pin
 * the shape without rendering.
 */
export function itemRows(fleet, { limit = 40 } = {}) {
  return (fleet?.items || []).slice(0, limit).map((it) => [
    cell(it.id, 24),
    cell(it.kind, 8),
    cell(it.state, 12),
    it.stallReason ? 'yes' : 'no',
    cell(agentOf(it), 28),
    cell(goalOf(it), 60),
  ]);
}

/** The three-row rollup: packets, cards, lanes, with their state mix. */
export function rollupRows(fleet) {
  const c = fleet?.counts || {};
  const items = fleet?.items || [];
  const mix = (kind) => {
    const byState = new Map();
    for (const it of items.filter((x) => x.kind === kind)) {
      const s = String(it.state || 'unknown');
      byState.set(s, (byState.get(s) || 0) + 1);
    }
    const out = [...byState.entries()].sort((a, b) => b[1] - a[1]).map(([s, n]) => `${n} ${s}`);
    return out.length ? out.join(' · ') : '—';
  };
  return [
    ['packets', String(c.specs ?? 0), mix('spec')],
    ['cards', String(c.cards ?? 0), mix('card')],
    ['lanes', String(c.lanes ?? 0), mix('lane')],
    ['total', String(c.total ?? 0), `${c.stalled ?? 0} stalled`],
  ];
}

/**
 * Padded monospace fence. Returns `{ fenced, wide }`: the skill's rule is that a
 * table past 3 columns or 30 characters must NOT be squeezed into this, so the
 * caller gets `wide: true` and must take the HTML path instead.
 */
export function fenceTable(headers, rows, { maxCols = TABLE_MAX_COLS, maxWidth = TABLE_MAX_WIDTH } = {}) {
  const head = (headers || []).map((h) => cell(h, 24));
  const body = (rows || []).map((r) => (r || []).map((v) => cell(v)));
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((r) => String(r[i] ?? '').length), 1));
  const total = widths.reduce((a, b) => a + b + 2, 1);
  const wide = head.length > maxCols || total > maxWidth;
  const pad = (cells) => cells.map((v, i) => String(v ?? '').padEnd(widths[i])).join('  ').trimEnd();
  const fenced = ['```text', pad(head), ...body.map(pad), '```'].join('\n');
  return { fenced, wide, totalWidth: total, columns: head.length };
}

/** The narrow answer: the rollup only, which is what fits a phone bubble. */
export function renderRollupTable(fleet, opts = {}) {
  const { fenced } = fenceTable(ROLLUP_COLUMNS, rollupRows(fleet), opts);
  return fenced;
}

/**
 * The full table model for the builder. `droppedColumns` is filled when the
 * available columns were trimmed (the skill forbids doing that quietly).
 */
export function fleetTableModel(fleet, { sources = null, tmux = null, limit = 40, droppedColumns = [] } = {}) {
  const s = sources || {};
  const preamble = [
    'Read-only projection of the records that already exist — packet frontmatter, `bugctl list --json`, the run ledger, agent heartbeats, `tmux ls`. No board of the PM own was created and nothing was written.',
  ];
  const notes = [
    `packets: ${cell(s.specsOk ? s.specsDir : s.specsReason, 70) || '—'}`,
    `tickets: ${cell(s.tickets, 30) || '—'}${s.ticketsError ? ` (${cell(s.ticketsError, 40)})` : ''} — ${s.ticketsCount ?? 0} row(s)`,
    `ledger: ${s.ledgerRows ?? 0} row(s) · heartbeats: ${s.beats ?? 0}`,
    tmux
      ? (tmux.ok
          ? `deployed (tmux): ${tmux.sessions.length} session(s) — ${tmux.sessions.map((t) => `${t.name}${t.attached ? ' (viewed)' : ''}`).join(', ') || '—'}`
          : `deployed (tmux): unavailable (${cell(tmux.error, 40)})`)
      : 'deployed (tmux): not read',
  ];
  if (droppedColumns.length) notes.push(`columns dropped to fit: ${droppedColumns.join(', ')}`);
  return {
    title: 'Project Manager — progress so far',
    preamble,
    tables: [
      { heading: 'Fleet rollup', columns: ROLLUP_COLUMNS, align: ['l', 'r', 'l'], rows: rollupRows(fleet) },
      { heading: `Items (${Math.min((fleet?.items || []).length, limit)})`, columns: ITEM_COLUMNS, align: ['l', 'l', 'l', 'c', 'l', 'l'], rows: itemRows(fleet, { limit }) },
    ],
    notes,
  };
}

/**
 * Build the wide table: JSON -> build-table.py -> HTML. Returns the model, the
 * absolute html path, and which renderer produced it — the fallback grid is a
 * real answer, so it is named, never silent.
 */
export function buildFleetTableHtml(model, {
  outDir = null,
  label = 'pm-fleet',
  buildTablePy = null,
  python = 'python3',
  now = Date.now(),
} = {}) {
  const dir = outDir || path.join(os.tmpdir(), 'bot-host-pm-tables', String(label));
  fs.mkdirSync(dir, { recursive: true });
  const jsonPath = path.resolve(path.join(dir, `${label}.json`));
  const htmlPath = path.resolve(path.join(dir, `${label}.html`));
  fs.writeFileSync(jsonPath, JSON.stringify(model, null, 2));
  const py = buildTablePy ? (fs.existsSync(buildTablePy) ? buildTablePy : null) : resolveBuildTablePy(null);
  let renderer = 'builtin-grid-fallback';
  let pyError = '';
  if (py) {
    try {
      execFileSync(python, [py, jsonPath, htmlPath], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 });
      if (fs.existsSync(htmlPath)) renderer = 'qa-evidence/build-table.py';
    } catch (e) {
      pyError = String(e.stderr || e.message || e).slice(0, 300);
    }
  } else {
    pyError = 'qa-evidence/build-table.py not found';
  }
  if (renderer === 'builtin-grid-fallback') fs.writeFileSync(htmlPath, fallbackHtml(model));
  return { jsonPath, htmlPath, renderer, pyError, builtAt: now };
}

/** One caption plus the `MEDIA:` line, which the send path extracts. */
export function renderFleetTableCaption({ htmlPath, renderer = '', itemCount = 0, chatWidthSafe = false } = {}) {
  return [
    `📊 *Project Manager — progress so far* (${itemCount} item(s))`,
    renderer && renderer !== 'qa-evidence/build-table.py'
      ? `_grid rendered in-chat by the built-in fallback (${mdSafe(renderer)})_`
      : '_full table opens in chat, sortable columns_',
    chatWidthSafe ? '' : null,
    `MEDIA:${htmlPath}`,
  ]
    .filter((l) => l !== null)
    .join('\n');
}
