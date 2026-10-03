/**
 * fleet-table-image.mjs — render the /status_all council table as a PNG.
 *
 * Telegram text has no grid rendering, so the readable table ships as a
 * photo (sent with the title as caption). The SVG builder is pure and fully
 * tested; only the final raster step needs `sharp`, and it is lazily
 * imported so a host without it still sends the text table.
 */

import { formatTokens } from './commands.mjs';
import { parseModelRef } from './freemodels.mjs';

const FONT = 'DejaVu Sans Mono, monospace';
const FS = 22;
const PAD_X = 14;
const PAD_Y = 12;
const ROW_H = 36;
const TITLE_H = 40;
const HEADER_H = 36;

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function toolOf(model) {
  if (!model) return '—';
  try {
    return parseModelRef(model).surface || '—';
  } catch {
    return '—';
  }
}

export function usageOf(row) {
  if (!row?.totals) return '—';
  const spend = Number(row.totals.cost) || 0;
  return `${row.totals.runs} runs · ${formatTokens(row.totals.tokens)}${spend > 0 ? ` · $${spend.toFixed(spend < 0.01 ? 5 : 4)}` : ''}`;
}

function sessionOf(row) {
  if (row.sessionId) {
    const s = String(row.sessionId);
    return s.length > 14 ? `${s.slice(0, 12)}…` : s;
  }
  if (row.foreignSession) return 'other project';
  return '—';
}

/** Columns for the image table: key, header, value fn, max chars. */
export function fleetTableColumns() {
  return [
    { key: 'bot', head: 'Agent', max: 10, value: (r) => String(r.id || '—') },
    { key: 'role', head: 'Role', max: 16, value: (r) => String(r.role || '—') },
    { key: 'model', head: 'Model', max: 40, value: (r) => String(r.model || '—') },
    { key: 'tool', head: 'Tool', max: 10, value: (r) => toolOf(r.model) },
    { key: 'session', head: 'Session', max: 14, value: sessionOf },
    { key: 'task', head: 'Task', max: 8, value: (r) => String(r.task || '—') },
    { key: 'usage', head: 'Usage', max: 24, value: usageOf },
  ];
}

function fit(s, max) {
  const t = String(s ?? '');
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * Pure SVG table. Widths come from the column maxima (monospace, so one
 * width fits all rows); values are clipped with … rather than overflowing.
 */
export function renderFleetTableSvg(rows, { title = '' } = {}) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r.enabled !== false);
  const cols = fleetTableColumns();
  const cw = 0.62 * FS;
  const widths = cols.map((c) => Math.ceil((c.max + 2) * cw) + PAD_X * 2);
  const W = Math.ceil(widths.reduce((a, b) => a + b, 0)) + 2;
  const H = TITLE_H + HEADER_H + list.length * ROW_H + PAD_Y * 2 + 2;
  const xs = [];
  {
    let x = 1;
    for (const w of widths) {
      xs.push(x);
      x += w;
    }
  }
  const yTitle = PAD_Y + 26;
  const yHead = PAD_Y + TITLE_H + 24;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="${esc(FONT)}" font-size="${FS}">`;
  s += `<rect x="0" y="0" width="${W}" height="${H}" fill="#0f172a"/>`;
  s += `<text x="${PAD_X}" y="${yTitle}" fill="#e2e8f0" font-weight="bold">${esc(title)}</text>`;
  cols.forEach((c, i) => {
    s += `<text x="${xs[i] + PAD_X}" y="${yHead}" fill="#94a3b8" font-weight="bold">${esc(c.head)}</text>`;
  });
  s += `<line x1="1" y1="${PAD_Y + TITLE_H + HEADER_H - 6}" x2="${W - 1}" y2="${PAD_Y + TITLE_H + HEADER_H - 6}" stroke="#334155" stroke-width="2"/>`;
  list.forEach((r, ri) => {
    const y = PAD_Y + TITLE_H + HEADER_H + ri * ROW_H + 24;
    const dim = String(r.task) === 'off';
    const fill = dim ? '#64748b' : '#e2e8f0';
    cols.forEach((c, i) => {
      s += `<text x="${xs[i] + PAD_X}" y="${y}" fill="${fill}">${esc(fit(c.value(r), c.max))}</text>`;
    });
  });
  s += '</svg>';
  return { svg: s, width: W, height: H };
}

/** Rasterize the table. Returns null when sharp is unavailable. */
export async function renderFleetTablePng(rows, opts = {}) {
  let sharp;
  try {
    ({ default: sharp } = await import('sharp'));
  } catch {
    return null;
  }
  const { svg } = renderFleetTableSvg(rows, opts);
  return sharp(Buffer.from(svg), { density: 160 }).png().toBuffer();
}
