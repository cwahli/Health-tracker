import React from 'react';
import { NutrientPieChart } from './NutrientPieChart';
import { getNutrientColor, nutrientDefinitions } from '../utils/nutrition';
import { displayNutrientName } from '../utils/i18n';
import { getTopTargetNutrientKeys, extractNutrientValue } from '../utils/nutrients';

export interface NutrientTargetRowProps {
  nutrients?: Record<string, any> | null;
  report?: any;
  profile?: any;
  allowanceObj?: any;
  activeFoodLogs?: any[];
  logDate?: string;
  logId?: string;
  consumedBeforeMap?: Record<string, number>;
  className?: string;
  wrap?: boolean;
  sortByPercentage?: boolean;
}

const fallbackUnits: Record<string, string> = {
  calories: 'kcal',
  saturatedFat: 'g',
  sodium: 'mg',
  addedSugar: 'g',
  solubleFibre: 'g',
  protein: 'g',
  carbohydrates: 'g',
  totalFat: 'g',
  totalFibre: 'g',
  potassium: 'mg'
};

const defaultTargets: Record<string, number> = {
  calories: 2000,
  saturatedFat: 15,
  sodium: 1500,
  addedSugar: 25,
  solubleFibre: 10,
  protein: 70,
  carbohydrates: 200,
  totalFat: 60,
  totalFibre: 25,
  potassium: 3500
};

function parseTarget(val: any, fallback: number): number {
  if (val === null || val === undefined) return fallback;
  const cleanStr = String(val).replace(/,/g, '');
  const matches = cleanStr.match(/\d+(\.\d+)?/g);
  if (!matches || matches.length === 0) return fallback;
  const parsed = parseFloat(matches[0]);
  return isNaN(parsed) ? fallback : parsed;
}

function formatValue(val: number): string {
  if (isNaN(val)) return '0';
  if (val >= 100) return String(Math.round(val));
  if (val >= 10) return val.toFixed(1);
  return val.toFixed(2);
}

export const NutrientTargetRow: React.FC<NutrientTargetRowProps> = ({
  nutrients,
  report,
  profile,
  allowanceObj,
  activeFoodLogs,
  logDate,
  logId,
  consumedBeforeMap,
  className = '',
  wrap = false,
  sortByPercentage = true
}) => {
  const topKeys = React.useMemo(() => {
    return getTopTargetNutrientKeys(report, profile);
  }, [report, profile]);

  const items = React.useMemo(() => {
    if (!topKeys || topKeys.length === 0) return [];

    let logsBefore: any[] = [];
    let dayLogs: any[] = [];
    if (activeFoodLogs && logDate) {
      dayLogs = activeFoodLogs.filter(f => f.date === logDate);
      const dayLogsChronological = [...dayLogs].sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')));
      if (logId) {
        const currentIndex = dayLogsChronological.findIndex(f => f.id === logId);
        logsBefore = currentIndex !== -1 ? dayLogsChronological.slice(0, currentIndex) : [];
      } else {
        logsBefore = dayLogsChronological;
      }
    }

    const rendered = topKeys.map((rawKey: string) => {
      const key = String(rawKey);
      const lowerKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      const nutrientDef = nutrientDefinitions.find(n => n.key.toLowerCase().replace(/[^a-z0-9]/g, '') === lowerKey);
      const lookupKey = nutrientDef?.key || key;

      // Allowance
      const targetValRaw =
        allowanceObj?.[`${lookupKey}Target`] ??
        allowanceObj?.[`${key}Target`] ??
        (report?.dailyNutrientTargets as any)?.[lookupKey] ??
        (report?.dailyNutrientTargets as any)?.[key] ??
        profile?.targets?.[lookupKey] ??
        profile?.targets?.[key] ??
        defaultTargets[lookupKey] ??
        defaultTargets[key] ??
        1000;
      const allowance = parseTarget(targetValRaw, defaultTargets[lookupKey] || 1000);

      // Consumed before
      let consumedBefore = 0;
      if (consumedBeforeMap && (consumedBeforeMap[lookupKey] !== undefined || consumedBeforeMap[key] !== undefined)) {
        consumedBefore = Number(consumedBeforeMap[lookupKey] ?? consumedBeforeMap[key]) || 0;
      } else if (logsBefore.length > 0) {
        consumedBefore = logsBefore.reduce((acc, curr) => {
          return acc + extractNutrientValue(curr.nutrients, lookupKey);
        }, 0);
      } else if (allowanceObj) {
        if (lookupKey === 'saturatedFat' || key === 'saturatedFat') {
          consumedBefore = Number(allowanceObj.saturatedFatLogged ?? allowanceObj.satFatLogged ?? 0);
        } else {
          consumedBefore = Number(allowanceObj[`${lookupKey}Logged`] ?? allowanceObj[`${key}Logged`] ?? 0);
        }
      }

      // In meal value
      const inMealVal = extractNutrientValue(nutrients, lookupKey);

      // Day total & percentage
      const dayTotal = logsBefore.length > 0 || dayLogs.length > 0
        ? dayLogs.reduce((acc, curr) => acc + extractNutrientValue(curr.nutrients, lookupKey), 0)
        : (consumedBefore + inMealVal);

      const pct = allowance > 0 ? (dayTotal / allowance) : 0;
      const mealPct = allowance > 0 ? (inMealVal / allowance) : 0;

      const unit = nutrientDef?.unit || fallbackUnits[lookupKey] || fallbackUnits[key] || 'g';
      const labelColor = getNutrientColor(lookupKey);
      const displayName = nutrientDef
        ? displayNutrientName(profile?.language || 'en', lookupKey, { short: true })
        : key.replace(/([A-Z])/g, ' $1').trim();

      return {
        key,
        lookupKey,
        nutrientDef,
        allowance,
        consumedBefore,
        inMealVal,
        pct: pct > 0 ? pct : mealPct,
        unit,
        labelColor,
        displayName
      };
    });

    if (sortByPercentage) {
      return [...rendered].sort((a, b) => b.pct - a.pct);
    }
    return rendered;
  }, [topKeys, nutrients, report, profile, allowanceObj, activeFoodLogs, logDate, logId, consumedBeforeMap, sortByPercentage]);

  if (items.length === 0) return null;

  return (
    <div
      data-testid="nutrient-target-row"
      className={`flex items-center gap-3 overflow-x-auto py-1 scrollbar-none max-w-full text-left ${wrap ? 'flex-wrap' : 'flex-nowrap'} ${className}`}
    >
      {items.map(({ key, lookupKey, allowance, consumedBefore, inMealVal, unit, labelColor, displayName }) => (
        <div key={key} className="flex items-center gap-1.5 shrink-0" data-testid={`nutrient-target-item-${key}`}>
          <NutrientPieChart
            allowance={allowance}
            alreadyConsumed={consumedBefore}
            mealValue={inMealVal}
            nutrientKey={lookupKey}
            size="sm"
          />
          <span className="text-[11px] font-extrabold whitespace-nowrap" style={{ color: labelColor }}>
            {displayName}: {formatValue(inMealVal)} {unit}
          </span>
        </div>
      ))}
    </div>
  );
};
