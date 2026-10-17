import React from 'react';
import { getNutrientColor, nutrientDefinitions } from '../utils/nutrition';
import { displayNutrientName } from '../utils/i18n';
import { extractNutrientValue } from '../utils/nutrients';

export interface MealAllowanceRingsProps {
  nutrients?: Record<string, any> | null;
  report?: any;
  profile?: any;
  allowanceObj?: any;
  activeFoodLogs?: any[];
  logDate?: string;
  logId?: string;
  className?: string;
}

export interface AllowanceRing {
  key: string;
  name: string;
  /** Day total in display units (g, or g converted from mg for sodium). */
  value: number;
  /** Daily allowance in display units. */
  max: number;
  unit: string;
  /** Day total / allowance, uncapped (over = >1). */
  pct: number;
  color: string;
}

const RING_KEYS = ['saturatedFat', 'sodium', 'calories'] as const;

/** App-default daily allowances, mirroring NutrientTargetRow's table for these keys. */
const RING_DEFAULTS: Record<string, number> = {
  calories: 2000,
  saturatedFat: 15,
  sodium: 1500,
};

function parseTarget(val: any, fallback: number): number {
  if (val === null || val === undefined) return fallback;
  const cleanStr = String(val).replace(/,/g, '');
  const matches = cleanStr.match(/\d+(\.\d+)?/g);
  if (!matches || matches.length === 0) return fallback;
  const parsed = parseFloat(matches[0]);
  return isNaN(parsed) ? fallback : parsed;
}

/** Sodium is stored in mg but reads in grams (2.75g, not 2750mg). */
const toDisplay = (key: string, raw: number): { value: number; max: number; unit: string } => {
  if (key === 'sodium') {
    return { value: raw / 1000, max: 0, unit: 'g' };
  }
  return { value: raw, max: 0, unit: key === 'calories' ? 'kcal' : 'g' };
};

export function formatRingNumber(val: number): string {
  if (!isFinite(val)) return '0';
  if (val >= 100) return String(Math.round(val));
  if (val >= 10) return String(Number(val.toFixed(1)));
  return String(Number(val.toFixed(2)));
}

export function computeMealAllowanceRings(input: {
  nutrients?: Record<string, any> | null;
  report?: any;
  profile?: any;
  allowanceObj?: any;
  activeFoodLogs?: any[];
  logDate?: string;
  logId?: string;
}): AllowanceRing[] {
  const { nutrients, report, profile, allowanceObj, activeFoodLogs, logDate } = input;
  const lang = profile?.language || 'en';
  return (RING_KEYS as readonly string[]).map((key) => {
    const allowance = parseTarget(
      allowanceObj?.[`${key}Target`] ??
        (report?.dailyNutrientTargets as any)?.[key] ??
        profile?.targets?.[key] ??
        RING_DEFAULTS[key] ??
        1000,
      RING_DEFAULTS[key] ?? 1000,
    );
    let dayTotal = extractNutrientValue(nutrients, key);
    if (activeFoodLogs && logDate) {
      const dayLogs = activeFoodLogs.filter((f) => f && f.date === logDate);
      if (dayLogs.length > 0) {
        dayTotal = dayLogs.reduce((acc, curr) => acc + extractNutrientValue(curr.nutrients, key), 0);
      }
    }
    const shown = toDisplay(key, dayTotal);
    const maxShown = key === 'sodium' ? allowance / 1000 : allowance;
    const nutrientDef = nutrientDefinitions.find((n) => n.key === key);
    const name = nutrientDef
      ? displayNutrientName(lang, key, { short: true })
      : key.replace(/([A-Z])/g, ' $1').trim();
    return {
      key,
      name,
      value: shown.value,
      max: maxShown,
      unit: shown.unit,
      pct: maxShown > 0 ? dayTotal / allowance : 0,
      color: getNutrientColor(key),
    };
  });
}

const RING_SIZE = 96;
const RING_STROKE = 10;
const RING_R = (RING_SIZE - RING_STROKE) / 2 - 2;
const RING_C = 2 * Math.PI * RING_R;

export const MealAllowanceRings: React.FC<MealAllowanceRingsProps> = ({
  nutrients,
  report,
  profile,
  allowanceObj,
  activeFoodLogs,
  logDate,
  logId,
  className = '',
}) => {
  const rings = React.useMemo(
    () =>
      computeMealAllowanceRings({ nutrients, report, profile, allowanceObj, activeFoodLogs, logDate, logId }),
    [nutrients, report, profile, allowanceObj, activeFoodLogs, logDate, logId],
  );
  return (
    <div data-testid="meal-allowance-rings" className={`flex items-center gap-3 max-w-full ${className}`}>
      {rings.map((ring) => {
        const frac = Math.max(0, Math.min(1, ring.pct));
        const over = ring.pct > 1;
        return (
          <div key={ring.key} data-testid={`allowance-ring-${ring.key}`} className="flex-1 min-w-0 text-center" role="img"
            aria-label={`${ring.name} ${formatRingNumber(ring.value)} of ${formatRingNumber(ring.max)}${ring.unit}`}>
            <svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} className="mx-auto block">
              <circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_R} fill="none"
                stroke="rgba(148,163,184,0.25)" strokeWidth={RING_STROKE} />
              <circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_R} fill="none"
                stroke={ring.color} strokeWidth={RING_STROKE}
                strokeDasharray={`${(frac * RING_C).toFixed(1)} ${RING_C.toFixed(1)}`}
                strokeLinecap="butt" transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`} />
              <text x="50%" y="42%" textAnchor="middle" dominantBaseline="central" fontSize="17" fontWeight="700" fill="currentColor">
                {formatRingNumber(ring.value)}{ring.unit === 'kcal' ? '' : ring.unit}
              </text>
              <text x="50%" y="70%" textAnchor="middle" fontSize="12.5" fill="currentColor" opacity="0.75">
                / {formatRingNumber(ring.max)}{ring.unit}
              </text>
            </svg>
            <div className="text-sm font-semibold mt-1 truncate" style={{ color: over ? ring.color : undefined }}>
              {ring.name}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default MealAllowanceRings;
