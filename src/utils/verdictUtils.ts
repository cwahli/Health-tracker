import { t } from './i18n';
import type { TranslationKey } from './translations';

export interface MealVerdict {
  label: string;
  level: 'good' | 'warning' | 'alert' | 'neutral' | string;
}

const CANONICAL_VERDICT_KEY_MAP: Record<string, TranslationKey> = {
  'high glycemic sugar': 'verdictHighGlycemicSugar',
  'elevated saturated fat': 'verdictElevatedSatFat',
  'lean muscle support': 'verdictLeanMuscle',
  'gut microbiome': 'verdictGutMicrobiome',
  'supports metabolic energy': 'verdictSupportsMetabolicEnergy',
  'portion control': 'verdictPortionControl',
};

/**
 * Resolves a structured meal verdict { label, level } from varied data payloads
 * such as FoodLog, chat messages, agentResult, or pendingFoodLog.
 */
export function resolveMealVerdict(source: any, lang?: unknown): MealVerdict | null {
  if (!source) return null;

  let rawVerdict: any = null;

  // Direct verdict property on source
  if (source.verdict !== undefined && source.verdict !== null) {
    rawVerdict = source.verdict;
  } else if (source.agentResult?.verdict) {
    rawVerdict = source.agentResult.verdict;
  } else if (source.pendingFoodLog?.verdict) {
    rawVerdict = source.pendingFoodLog.verdict;
  } else if (source.data?.agentResult?.verdict) {
    rawVerdict = source.data.agentResult.verdict;
  } else if (source.data?.pendingFoodLog?.verdict) {
    rawVerdict = source.data.pendingFoodLog.verdict;
  } else if (source.data?.verdict) {
    rawVerdict = source.data.verdict;
  } else if (source.output?.verdict) {
    rawVerdict = source.output.verdict;
  } else if (Array.isArray(source.dispatches)) {
    for (const d of source.dispatches) {
      if (d?.output?.verdict) {
        rawVerdict = d.output.verdict;
        break;
      }
    }
  } else if (Array.isArray(source.groups) && source.groups.length > 0 && source.groups[0]?.verdict) {
    rawVerdict = source.groups[0].verdict;
  }

  // Parse JSON string if necessary
  if (typeof rawVerdict === 'string') {
    const trimmed = rawVerdict.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        rawVerdict = JSON.parse(trimmed);
      } catch {
        rawVerdict = { label: trimmed };
      }
    } else {
      rawVerdict = { label: trimmed };
    }
  }

  let label = (rawVerdict && typeof rawVerdict === 'object' && rawVerdict.label)
    ? String(rawVerdict.label).trim()
    : (typeof rawVerdict === 'string' ? rawVerdict.trim() : '');

  let level = (rawVerdict && typeof rawVerdict === 'object' && rawVerdict.level)
    ? String(rawVerdict.level).trim().toLowerCase()
    : '';

  // Fallback to recommendation if no explicit verdict label is found
  if (!label) {
    const rec = source.recommendation ||
      source.pendingFoodLog?.recommendation ||
      source.data?.pendingFoodLog?.recommendation ||
      source.data?.recommendation ||
      source.agentResult?.recommendation;

    if (rec && typeof rec === 'string') {
      const recTrimmed = rec.trim();
      const recLower = recTrimmed.toLowerCase();
      if (recLower === 'good' || recLower === 'healthy' || recLower === 'safe') {
        level = level || 'good';
        label = t(lang, 'verdictSupportsMetabolicEnergy') || 'Supports Metabolic Energy';
      } else if (recLower === 'bad' || recLower === 'alert' || recLower === 'avoid' || recLower === 'danger') {
        level = level || 'alert';
        label = t(lang, 'verdictElevatedSatFat') || 'Elevated Saturated Fat';
      } else if (recLower === 'warning' || recLower === 'caution' || recLower === 'moderate') {
        level = level || 'warning';
        label = t(lang, 'verdictPortionControl') || 'Portion Control';
      } else if (recLower === 'neutral') {
        level = level || 'neutral';
        label = t(lang, 'verdictSupportsMetabolicEnergy') || 'Supports Evaluation';
      } else {
        label = recTrimmed;
      }
    }
  }

  if (!label) return null;

  // Infer level if not explicitly defined
  if (!level) {
    const lblLower = label.toLowerCase();
    if (
      lblLower.includes('alert') ||
      lblLower.includes('bad') ||
      lblLower.includes('high') ||
      lblLower.includes('excess') ||
      lblLower.includes('over limit') ||
      lblLower.includes('danger') ||
      lblLower.includes('severe')
    ) {
      level = 'alert';
    } else if (
      lblLower.includes('warning') ||
      lblLower.includes('caution') ||
      lblLower.includes('moderate') ||
      lblLower.includes('mindful') ||
      lblLower.includes('elevated')
    ) {
      level = 'warning';
    } else if (
      lblLower.includes('good') ||
      lblLower.includes('healthy') ||
      lblLower.includes('balanced') ||
      lblLower.includes('support') ||
      lblLower.includes('lean') ||
      lblLower.includes('optimal')
    ) {
      level = 'good';
    } else {
      level = 'neutral';
    }
  }

  // Localize standard English labels if a language preference is provided
  if (lang) {
    const key = CANONICAL_VERDICT_KEY_MAP[label.toLowerCase()];
    if (key) {
      const translated = t(lang, key);
      if (translated) {
        label = translated;
      }
    }
  }

  return { label, level };
}

/**
 * Returns Tailwind badge classes for a given verdict level/label.
 */
export function getVerdictColorClass(level?: string, label?: string): string {
  const lvl = String(level || '').toLowerCase();
  const lbl = String(label || '').toLowerCase();

  if (
    lvl === 'alert' ||
    lvl === 'bad' ||
    lvl === 'avoid' ||
    lvl === 'danger' ||
    lvl === 'severe' ||
    lbl.includes('bad') ||
    lbl.includes('high') ||
    lbl.includes('excess')
  ) {
    return 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300';
  }

  if (
    lvl === 'warning' ||
    lvl === 'caution' ||
    lvl === 'moderate' ||
    lbl.includes('moderate') ||
    lbl.includes('caution')
  ) {
    return 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300';
  }

  if (
    lvl === 'good' ||
    lvl === 'safe' ||
    lvl === 'healthy' ||
    lvl === 'best' ||
    lbl.includes('healthy') ||
    lbl.includes('balanced')
  ) {
    return 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300';
  }

  return 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300';
}
