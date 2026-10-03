/**
 * fleet-status-html.mjs — the /status_all council table through the
 * `telegram-tables` skill pipeline (scripts/skills/common/telegram-tables):
 * data-only JSON -> qa-evidence/build-table.py -> sortable HTML grid, sent as
 * the chat document. Telegram text has no grid rendering and the skill
 * forbids hand-written HTML for wide tables, so this module writes data only;
 * the previous inline grid survives solely as the built-in fallback when the
 * builder is unavailable. The monospace text table in fleet-status.mjs is the
 * final fallback when even a document cannot be sent.
 *
 * Pure data building plus one child process (the builder, same pattern as
 * renderFreeLaneTableHtml). No DOM, no browser, no native modules.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { formatTokens } from './commands.mjs';
import { resolveBuildTablePy } from './free-lanes.mjs';
import { parseModelRef } from './freemodels.mjs';
import { usageCell } from './fleet-status.mjs';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function toolOf(model) {
  if (!model) return '—';
  try {
    return parseModelRef(model).surface || '—';
  } catch {
    return '—';
  }
}

function sessionOf(row) {
  if (row.sessionId) return String(row.sessionId);
  if (row.foreignSession) return 'other project';
  return '—';
}

export const FLEET_STATUS_COLUMNS = ['Agent', 'Role', 'Model', 'Tool', 'Session', 'Task', 'Usage'];

/**
 * Skill-pipeline input: title, preamble lines, one table with positional rows
 * matching `columns`, and notes. Data only — the builder owns all markup.
 */
export function buildFleetStatusTableJson(rows, { title = '', subtitle = '' } = {}) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r.enabled !== false);
  const off = (Array.isArray(rows) ? rows : []).filter((r) => r.enabled === false);
  const tableRows = list.map((r) => [
    r.id || '—',
    r.role || '—',
    r.model || '—',
    toolOf(r.model),
    sessionOf(r),
    r.task || '—',
    usageCell(r),
  ]);
  const notes = [];
  if (off.length) notes.push(`off: ${off.map((r) => r.id).join(', ')}`);
  notes.push('Usage is this chat only; — means the seat has not run here yet. Ask it something, then re-run /status_all.');
  return {
    title: title || 'Fleet status',
    preamble: subtitle ? [subtitle] : [],
    tables: [
      {
        heading: '',
        columns: [...FLEET_STATUS_COLUMNS],
        align: ['l', 'l', 'l', 'l', 'l', 'l', 'r'],
        rows: tableRows,
        intro: [],
        outro: [],
      },
    ],
    notes,
  };
}

const TH = 'padding:10px 16px;color:#94a3b8;font-size:12px;text-align:left;border-bottom:1px solid #334155;background:#16213a;white-space:nowrap';
const TD = 'padding:10px 16px;color:#e2e8f0;font-size:13px;vertical-align:top;word-break:break-word';

/**
 * Built-in fallback only: the previous inline grid, kept so a missing builder
 * still ships a readable document. Anything that changes table *content* goes
 * in buildFleetStatusTableJson, never here.
 */
function fallbackGrid(rows, { title = '', subtitle = '' } = {}) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r.enabled !== false);
  const off = (Array.isArray(rows) ? rows : []).filter((r) => r.enabled === false);
  const cells = list.map((r) => [
    r.id || '—',
    r.role || '—',
    r.model || '—',
    toolOf(r.model),
    sessionOf(r),
    r.task || '—',
    usageCell(r),
  ]);
  const trs = cells
    .map(
      (c, i) =>
        `<tr>${c.map((v) => `<td style="${TD}${i === 0 ? '' : ';border-top:1px solid #26314d'}">${esc(v)}</td>`).join('')}</tr>`,
    )
    .join('');
  const offLine = off.length
    ? `<div style="font-size:12px;color:#94a3b8;margin-top:14px">off: ${esc(off.map((r) => r.id).join(', '))}</div>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#0f172a;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">` +
    `<div style="padding:28px 32px">` +
    `<div style="font-size:20px;font-weight:700;color:#f8fafc">${esc(title)}</div>` +
    (subtitle ? `<div style="font-size:12px;color:#94a3b8;margin-top:6px">${esc(subtitle)}</div>` : '') +
    `<div style="margin-top:22px;border:1px solid #334155;border-radius:10px;background:#1e293b;overflow:hidden">` +
    `<table style="border-collapse:collapse;width:100%">${'<thead><tr>' + FLEET_STATUS_COLUMNS.map((h) => `<th style="${TH}">${esc(h)}</th>`).join('') + '</tr></thead>'}<tbody>${trs}</tbody></table>` +
    `</div>${offLine}</div></body></html>`;
}

/**
 * Write the skill-pipeline document pair and return their paths.
 *
 * `buildTablePy`: undefined locates qa-evidence/build-table.py (same lookup
 * the allowance table uses); a string forces that builder when present;
 * null forces the built-in fallback (for sensors). Returns
 * `{ htmlPath, jsonPath, model, renderer }` where renderer is
 * `qa-evidence/build-table.py` or `builtin-grid-fallback`.
 */
export function writeFleetStatusDoc(rows, { title = '', subtitle = '', dir = null, buildTablePy = undefined } = {}) {
  const model = buildFleetStatusTableJson(rows, { title, subtitle });
  const outDir = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-status-'));
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, 'fleet-status.json');
  const htmlPath = path.join(outDir, 'fleet-status.html');
  fs.writeFileSync(jsonPath, JSON.stringify(model, null, 2));
  const py =
    buildTablePy === undefined
      ? resolveBuildTablePy(null)
      : buildTablePy && fs.existsSync(buildTablePy)
        ? buildTablePy
        : null;
  if (py) {
    try {
      execFileSync('python3', [py, jsonPath, htmlPath], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 });
      if (fs.existsSync(htmlPath)) {
        return { htmlPath, jsonPath, model, renderer: 'qa-evidence/build-table.py' };
      }
    } catch {}
  }
  fs.writeFileSync(htmlPath, fallbackGrid(rows, { title, subtitle }));
  return { htmlPath, jsonPath, model, renderer: 'builtin-grid-fallback' };
}
