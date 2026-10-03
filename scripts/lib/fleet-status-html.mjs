/**
 * fleet-status-html.mjs — render the /status_all council table as a styled
 * HTML document, in the same dark-slate visual language as the skill tables
 * (meal-qa card, allowance grid). Telegram text has no grid rendering, so
 * the readable table ships as a `.html` document (the /allowance table
 * pattern); the monospace text table in fleet-status.mjs is the fallback.
 *
 * Pure string building: no DOM, no browser, no native modules.
 */

import { formatTokens } from './commands.mjs';
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

const TH = 'padding:10px 16px;color:#94a3b8;font-size:12px;text-align:left;border-bottom:1px solid #334155;background:#16213a;white-space:nowrap';
const TD = 'padding:10px 16px;color:#e2e8f0;font-size:13px;vertical-align:top;word-break:break-word';
const TD_FIRST = `${TD};border-top:0`;
const TD_REST = `${TD};border-top:1px solid #26314d`;

/**
 * Full HTML document for the council table. `subtitle` names the shared
 * model+agent when the fleet is uniform, so the table stays narrow.
 */
export function renderFleetStatusHtml(rows, { title = '', subtitle = '' } = {}) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r.enabled !== false);
  const off = (Array.isArray(rows) ? rows : []).filter((r) => r.enabled === false);
  const heads = ['Agent', 'Role', 'Model', 'Tool', 'Session', 'Task', 'Usage'];
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
        `<tr>${c.map((v) => `<td style="${i === 0 ? TD_FIRST : TD_REST}">${esc(v)}</td>`).join('')}</tr>`,
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
    `<table style="border-collapse:collapse;width:100%">${'<thead><tr>' + heads.map((h) => `<th style="${TH}">${esc(h)}</th>`).join('') + '</tr></thead>'}<tbody>${trs}</tbody></table>` +
    `</div>${offLine}</div></body></html>`;
}
