/**
 * NUTRITIONAL TARGET STATUS — adaptive rolling average for the scout prompt.
 *
 * Averages each nutrient over the last 7 calendar days ending todayStr, but
 * counts ONLY days with logged values (a restart after a gap yields a 1-day
 * average, 2 logged days yield a 2-day average — empty days never dilute).
 * Percent over/under shows only when an explicit target exists for that key.
 */
export interface StatusDayLog {
  date?: string;
  nutrients?: Record<string, any> | null;
}

const STATUS_KEYS: Array<{ key: string; label: string; unit: string }> = [
  { key: 'saturatedFat', label: 'Sat fat', unit: 'g' },
  { key: 'calories', label: 'Calorie', unit: 'kcal' },
  { key: 'sodium', label: 'Sodium', unit: 'mg' },
  { key: 'protein', label: 'Protein', unit: 'g' },
  { key: 'carbohydrates', label: 'Carbohydrates', unit: 'g' },
  { key: 'totalFibre', label: 'Total Fibre', unit: 'g' },
  { key: 'potassium', label: 'Potassium', unit: 'mg' },
  { key: 'solubleFibre', label: 'Soluble Fibre', unit: 'g' },
  { key: 'addedSugar', label: 'Added Sugar', unit: 'g' },
  { key: 'transFat', label: 'Trans Fat', unit: 'g' },
];

function num(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtAvg(v: number): string {
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : String(r);
}

function shiftDate(todayStr: string, back: number): string {  const p = String(todayStr || '').split('-').map(Number);
  if (p.length !== 3 || p.some((n) => !Number.isFinite(n))) return '';
  const d = new Date(p[0], p[1] - 1, p[2]);
  d.setDate(d.getDate() - back);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function buildNutritionTargetStatus(args: {
  logs?: StatusDayLog[] | null;
  targets?: Record<string, any> | null;
  todayStr?: string;
}): string {
  const logs = Array.isArray(args.logs) ? args.logs : [];
  const todayStr = args.todayStr || '';
  if (!todayStr) return '';
  const targets = args.targets || {};

  const windowDates: string[] = [];
  for (let back = 0; back < 7; back++) {
    const ds = shiftDate(todayStr, back);
    if (ds) windowDates.push(ds);
  }
  if (windowDates.length === 0) return '';
  const inWindow = new Set(windowDates);

  const byDate = new Map<string, Record<string, number>>();
  for (const log of logs) {
    const ds = String(log?.date || '');
    if (!inWindow.has(ds)) continue;
    const agg = byDate.get(ds) || {};
    const nuts = log?.nutrients || {};
    for (const { key } of STATUS_KEYS) {
      agg[key] = (agg[key] || 0) + num(nuts[key]);
    }
    byDate.set(ds, agg);
  }
  const activeDays = [...byDate.entries()].filter(([, agg]) =>
    STATUS_KEYS.some(({ key }) => (agg[key] || 0) > 0)
  );
  if (activeDays.length === 0) return '';

  const n = activeDays.length;
  const sums: Record<string, number> = {};
  for (const { key } of STATUS_KEYS) sums[key] = 0;
  for (const [, agg] of activeDays) {
    for (const { key } of STATUS_KEYS) sums[key] += agg[key] || 0;
  }
  const items = STATUS_KEYS.map(({ key, label, unit }) => {
    const avg = sums[key] / n;
    const t = num(targets[key]);
    let suffix = '';
    if (t > 0) {
      const pct = Math.round(((avg - t) / t) * 100);
      suffix = pct > 0 ? ` - ${pct}% over` : pct < 0 ? ` - ${-pct}% under` : ' - on target';
    }
    return `${label} (${fmtAvg(avg)}${unit}${suffix})`;
  });
  return `=== NUTRITIONAL TARGET STATUS ===\n${n} days avg: ${items.join(', ')}`;
}

/**
 * Explicit daily targets only (no fallbacks): percent shows solely where the
 * user has a real target. Returns the 5 targetable keys present and finite.
 */
export function pickExplicitTargets(daily: any): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of ['calories', 'saturatedFat', 'sodium', 'protein', 'carbohydrates']) {
    const v = Number(daily?.[key]);
    if (Number.isFinite(v) && v > 0) out[key] = v;
  }
  return out;
}
