import { t } from './i18n.js';

export interface ResolvedVerdict {
  label: string;
  level: 'good' | 'warning' | 'alert' | 'neutral';
}

const GENERIC_LABELS = new Set(['good', 'bad', 'neutral', '[object object]', '']);

/**
 * Standardized resolver for food meal verdicts.
 * Ensures that food cards and logs always display a high-fidelity clinical verdict badge
 * rather than a generic word ('Good'), an empty badge, or a serialized '[object Object]'.
 */
export function resolveMealVerdict(meal: any, lang?: unknown): ResolvedVerdict | null {
  if (!meal || typeof meal !== 'object') return null;

  let raw = meal.verdict;

  // 1. If verdict is a string, attempt JSON parse or direct string usage
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        raw = JSON.parse(trimmed);
      } catch {
        raw = null;
      }
    } else if (!GENERIC_LABELS.has(trimmed.toLowerCase())) {
      raw = { label: trimmed, level: 'neutral' };
    } else {
      raw = null;
    }
  }

  // 2. If raw is now a valid object with a non-generic label, normalize and return
  if (raw && typeof raw === 'object' && raw.label) {
    const labelStr = String(raw.label).trim();
    if (!GENERIC_LABELS.has(labelStr.toLowerCase())) {
      let lvl = String(raw.level || '').toLowerCase();
      let normalizedLevel: 'good' | 'warning' | 'alert' | 'neutral' = 'neutral';
      if (['good', 'safe', 'healthy', 'best'].includes(lvl)) {
        normalizedLevel = 'good';
      } else if (['warning', 'caution', 'moderate', 'warn', 'yellow'].includes(lvl)) {
        normalizedLevel = 'warning';
      } else if (['alert', 'bad', 'avoid', 'danger', 'severe', 'fail', 'red'].includes(lvl)) {
        normalizedLevel = 'alert';
      }
      return { label: labelStr, level: normalizedLevel };
    }
  }

  // 3. Fallback: derive clinical verdict deterministically from nutrients & meal identity
  const n = meal.nutrients || {};
  const satFat = Number(n.saturatedFat ?? meal.saturated_fat ?? meal.saturatedFat ?? 0);
  const sugar = Number(n.addedSugar ?? n.sugar ?? meal.added_sugar ?? meal.addedSugar ?? 0);
  const sodium = Number(n.sodium ?? meal.sodium ?? 0);
  const protein = Number(n.protein ?? meal.protein ?? 0);
  const calories = Number(n.calories ?? meal.calories ?? 0);
  const name = String(meal.name || meal.title || '').toLowerCase();

  if (satFat >= 10) {
    return {
      label: t(lang, 'verdictElevatedSatFat'),
      level: 'warning',
    };
  }

  if (sugar >= 25) {
    return {
      label: t(lang, 'verdictHighGlycemicSugar'),
      level: 'warning',
    };
  }

  if (sodium >= 1200) {
    return {
      label: 'Elevated Sodium',
      level: 'warning',
    };
  }

  if (protein >= 25) {
    return {
      label: t(lang, 'verdictLeanMuscle'),
      level: 'good',
    };
  }

  if (/probiotic|fermented|yogurt|kefir|yakult/i.test(name)) {
    return {
      label: t(lang, 'verdictGutMicrobiome'),
      level: sugar >= 20 ? 'neutral' : 'good',
    };
  }

  if (calories > 0 || meal.name || meal.title) {
    return {
      label: t(lang, 'verdictSupportsMetabolicEnergy'),
      level: 'neutral',
    };
  }

  return null;
}
