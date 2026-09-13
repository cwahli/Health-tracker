import {
  PHASE_LABEL,
  groupJourneyByDish,
  snapshotVisibleInvariants,
  sanitizeJobErrorText,
  buildJourney,
  buildAutoInvariants,
  journeyPhaseCounts,
  type GoldenJourneyRow,
  type GoldenInvariant,
} from './goldenJourney.js';
import { autoSpotFood } from './bugAutoSpot.js';
import { compileGoldenMeal } from './goldenLedger.js';

export {
  PHASE_LABEL,
  groupJourneyByDish,
  snapshotVisibleInvariants,
  sanitizeJobErrorText,
  type GoldenJourneyRow,
  type GoldenInvariant,
};

export interface GoldenMealLine {
  name: string;
  weightGrams?: number | null;
  calories?: number | null;
  protein?: number | null;
  carbohydrates?: number | null;
  totalFat?: number | null;
  sodium?: number | null;
  scored?: boolean;
}

export interface GoldenOutcome {
  id: string;
  kind?: string;
  label: string;
  expected?: any;
  actual?: any;
  pass: boolean;
  source: 'parser' | 'user' | 'auto' | 'journey';
  enabled?: boolean;
  signature?: string;
  query?: string;
  note?: string;
}

export interface GoldenAttempt {
  n?: number;
  actor?: string;
  kind?: string;
  summary?: string;
  timestamp?: string;
  at?: string;
  tried?: string;
  learned?: string;
  next?: string;
  createdNewIssue?: string | boolean;
  replaySummary?: string;
  [key: string]: any;
}

export interface GoldenScoreboard {
  outcomes: GoldenOutcome[];
  meal?: { pass: boolean; misses: string[] };
  summary: { passCount: number; failCount: number; allPass: boolean; allGreen: boolean; score: number };
  journey?: GoldenJourneyRow[];
  invariants?: GoldenInvariant[];
  ledger?: any;
  autoSpot?: any;
  replayMode?: string;
  tensions?: Array<{ note: string }>;
  scout?: any;
  mealLines?: GoldenMealLine[];
  foodLog?: any;
  [key: string]: any;
}

export function mealLineNamesMatch(a: string, b: string, presenceOnly?: boolean): boolean {
  const normA = (a || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
  const normB = (b || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
  if (normA === normB) return true;
  if (!normA || !normB) return false;
  if (normA === 'ham') {
    if (normB.includes('serrano') && !normA.includes('serrano')) return false;
    if (normB.includes('reformed ham') || normB.includes('ham')) return true;
  }
  return normA.includes(normB) || normB.includes(normA);
}

export function parseKnownFails(logText: string): GoldenOutcome[] {
  const outcomes: GoldenOutcome[] = [];
  const text = logText || '';

  if (/POWERADE.*Mixed Berry/i.test(text)) {
    outcomes.push({
      id: 'never_powerade',
      kind: 'never_match',
      label: 'Never match Powerade for mixed berries',
      pass: false,
      source: 'parser',
      enabled: true,
      signature: 'POWERADE',
    });
  }
  if (/Popsicle.*no sugar added/i.test(text) && /component "sugar"/i.test(text)) {
    outcomes.push({
      id: 'never_popsicle',
      kind: 'never_match',
      label: 'Never bind Popsicle for sugar component',
      pass: false,
      source: 'parser',
      enabled: true,
      signature: 'Popsicle',
    });
  }
  if (/Co-op Blueberry Granola/i.test(text)) {
    outcomes.push({
      id: 'never_coop_granola',
      kind: 'never_match',
      label: 'Never bind Co-op Blueberry Granola for plain granola',
      pass: false,
      source: 'parser',
      enabled: true,
      signature: 'Co-op Blueberry Granola',
    });
  }
  if (/Food Resolver Fallback/i.test(text) && /category fallback/i.test(text)) {
    outcomes.push({
      id: 'log_category_fallback',
      kind: 'log_event',
      label: 'Category fallback used in resolver',
      pass: false,
      source: 'parser',
      enabled: true,
      signature: '[Food Resolver Fallback]',
    });
  }
  if (/ReceiptInvariant.*REPAIRED/i.test(text)) {
    outcomes.push({
      id: 'log_receipt_repair',
      kind: 'log_event',
      label: 'Receipt invariant repaired softBudget',
      pass: false,
      source: 'parser',
      enabled: true,
      signature: '[ReceiptInvariant] REPAIRED',
    });
  }
  if (/Dietitian Reality Check.*Rescaled/i.test(text) || /action=scale/i.test(text)) {
    outcomes.push({
      id: 'log_scout_scale',
      kind: 'log_event',
      label: 'Scout density scaled by reality check',
      pass: false,
      source: 'parser',
      enabled: true,
      signature: '[Reconcile] item=.*action=scale',
    });
  }

  return outcomes;
}

export function parseTensions(logText: string): Array<{ note: string }> {
  const tensions: Array<{ note: string }> = [];
  const text = logText || '';
  if (/scaled|action=scale/i.test(text)) {
    tensions.push({ note: 'Meal components were scaled' });
  }
  if (/ReceiptInvariant|Line sum|rowSum/i.test(text)) {
    tensions.push({ note: 'Line sum receipt tension observed' });
  }
  return tensions;
}

export function extractMealLines(foodLog: any): GoldenMealLine[] {
  if (!foodLog) return [];
  const items = Array.isArray(foodLog.itemsBreakdown)
    ? foodLog.itemsBreakdown
    : Array.isArray(foodLog.items)
    ? foodLog.items
    : [];
  if (items.length === 0 && foodLog.name) {
    return [
      {
        name: foodLog.name,
        calories: foodLog.calories ?? null,
        protein: foodLog.nutrients?.protein ?? null,
        carbohydrates: foodLog.nutrients?.carbohydrates ?? null,
        totalFat: foodLog.nutrients?.totalFat ?? null,
        sodium: foodLog.nutrients?.sodium ?? null,
        weightGrams: foodLog.weightGrams ?? foodLog.estimatedWeightGrams ?? null,
        scored: true,
      },
    ];
  }
  return items.map((it: any) => ({
    name: it.canonicalDbName || it.originalName || it.name || it.query || 'Dish',
    calories: it.calories ?? it.nutrients?.calories ?? null,
    protein: it.nutrients?.protein ?? it.protein ?? null,
    carbohydrates: it.nutrients?.carbohydrates ?? it.carbohydrates ?? null,
    totalFat: it.nutrients?.totalFat ?? it.totalFat ?? null,
    sodium: it.nutrients?.sodium ?? it.sodium ?? null,
    weightGrams: it.weightGrams ?? it.estimatedWeightGrams ?? null,
    scored: true,
  }));
}

export function isStaleCapturedStallSymptom(text: string): boolean {
  if (!text) return false;
  return /Stream stalled/i.test(text) && /\[Captured Meal Processing Issues\]/i.test(text);
}

export function stripStaleStallLines(text: string): string {
  if (!text) return '';
  return text
    .split('\n')
    .filter((line) => !/Stream stalled|\[Captured Meal Processing Issues\]|\[Job Error\]|\[Result Error\]/i.test(line))
    .join('\n')
    .trim();
}

export function extractCapturedMealProblems(job: any): string[] {
  if (!job) return [];
  const problems: string[] = [];
  const logText = job.result?.backendLogs || job.backendLogs || '';
  const isStalledInLog = /Stream stalled/i.test(logText);

  if (job.status === 'failed' && isStalledInLog) {
    problems.push('Stream stalled: No response from analysis engine within 90s.');
  }
  if (job.error?.message && !/Stream stalled/i.test(job.error.message)) {
    problems.push(job.error.message);
  }
  return problems;
}

export function evaluateLogOutcomes(outcomes: GoldenOutcome[], logText: string): GoldenOutcome[] {
  const text = logText || '';
  return outcomes.map((o) => {
    if (o.signature) {
      const regex = new RegExp(o.signature.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i');
      const found = regex.test(text);
      return {
        ...o,
        pass: !found,
        actual: found ? 'Detected in tape' : 'Cleared/Resolved',
      };
    }
    return o;
  });
}

export function evaluateMealLines(
  expected: GoldenMealLine[],
  actual: GoldenMealLine[]
): { pass: boolean; misses: string[] } {
  const misses: string[] = [];
  if (!expected || expected.length === 0) return { pass: true, misses: [] };

  for (const exp of expected) {
    if (!exp.scored) continue;
    // Find matching actual dish
    const matched = actual.find((act) => {
      const expN = (exp.name || '').toLowerCase();
      const actN = (act.name || '').toLowerCase();
      if (expN === actN) return true;
      if (expN === 'ham') {
        if (actN.includes('serrano') && !expN.includes('serrano')) return false;
        if (actN.includes('reformed ham') || actN.includes('ham')) return true;
      }
      return mealLineNamesMatch(expN, actN);
    });

    if (!matched) {
      if (exp.calories === null && exp.weightGrams === null) {
        misses.push(`Missing item "${exp.name}" (presence only)`);
      } else {
        misses.push(`Missing item "${exp.name}"`);
      }
      continue;
    }

    if (exp.calories !== null && exp.calories !== undefined) {
      const diff = Math.abs((matched.calories || 0) - exp.calories);
      const tol = Math.max(5, exp.calories * 0.1);
      if (diff > tol) {
        misses.push(`${exp.name} calories expected ${exp.calories}, got ${matched.calories}`);
      }
    }
    if (exp.protein !== null && exp.protein !== undefined) {
      const diff = Math.abs((matched.protein || 0) - exp.protein);
      const tol = Math.max(2, exp.protein * 0.15);
      if (diff > tol) {
        misses.push(`${exp.name} protein expected ${exp.protein}, got ${matched.protein}`);
      }
    }
  }

  return {
    pass: misses.length === 0,
    misses,
  };
}

export function retainGoldenOutcomes(
  prev: GoldenOutcome[],
  next: GoldenOutcome[],
  logText?: string
): GoldenOutcome[] {
  const text = logText || '';
  const result: GoldenOutcome[] = [...next];
  for (const p of prev) {
    if (!result.some((r) => r.id === p.id)) {
      if (p.signature && !text.includes(p.signature)) {
        result.push({ ...p, pass: true, actual: 'Cleared/Resolved' });
      } else {
        result.push(p);
      }
    }
  }
  return result;
}

export function deriveGoldenTitle(input: { foodLog?: any; scout?: any; jobId?: string; fallback?: string }): string {
  const foodLog = input.foodLog;
  const items = Array.isArray(foodLog?.itemsBreakdown)
    ? foodLog.itemsBreakdown
    : Array.isArray(foodLog?.items)
    ? foodLog.items
    : Array.isArray(input.scout?.items)
    ? input.scout.items
    : Array.isArray(input.scout)
    ? input.scout
    : [];
  if (items.length > 0) {
    const names = items
      .map((it: any) => it.originalName || it.name || it.canonicalDbName)
      .filter(Boolean);
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} + ${names[1]}`;
    if (names.length > 2) {
      return `${names[0]} + ${names[1]} + ${names.length - 2} more`;
    }
  }
  if (foodLog?.name) return foodLog.name;
  return input.fallback || `Golden ${input.jobId || 'run'}`;
}

export function goldenSlug(title: string, jobId?: string): string {
  const clean = (title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return clean || `golden-${(jobId || 'run').slice(0, 12)}`;
}

export function statsFromJourney(rows: any[]): { sampled: number; curator: number; catalog: number; usda: number } {
  let sampled = 0;
  let curator = 0;
  let catalog = 0;
  let usda = 0;
  for (const r of rows || []) {
    sampled++;
    const p = String(r.phase || '');
    if (r.source === 'label' || p.includes('label')) {
      curator++;
    } else if (r.source === 'internal_catalog' || p.includes('catalog')) {
      catalog++;
    } else if (r.source === 'usda' || p.includes('usda')) {
      usda++;
    }
  }
  return { sampled, curator, catalog, usda };
}

export function splitExtraIssueText(text: string): string[] {
  if (!text) return [];
  const chunks = text
    .split(/(?=[A-Z][a-zA-Z\s]+:\s+)/)
    .map((s) => s.trim())
    .filter(Boolean);
  return chunks.length > 0 ? chunks : [text.trim()];
}

export function journeyToOutcomes(
  journey: GoldenJourneyRow[],
  invariants?: GoldenInvariant[] | any[],
  opts?: { blockingOnly?: boolean } | any
): GoldenOutcome[] {
  const jOuts: GoldenOutcome[] = (journey || []).map((row, idx) => ({
    id: row.id || `journey_${idx}`,
    kind: 'journey',
    label: `${row.dish}: ${row.query} -> ${row.phase}`,
    expected: 'Pass invariant checks',
    actual: row.identityPass ? 'Pass' : row.blockers?.join(', ') || 'Fail',
    pass: Boolean(row.identityPass),
    source: 'journey',
    query: row.query,
    enabled: true,
  }));
  const invOuts: GoldenOutcome[] = (invariants || []).map((inv, idx) => ({
    id: inv.id || `inv_${idx}`,
    kind: inv.group || 'invariant',
    label: inv.label,
    expected: inv.expected,
    actual: inv.actual,
    pass: Boolean(inv.pass),
    source: 'auto',
    enabled: true,
  }));
  return [...jOuts, ...invOuts];
}

export function scoreboardSummary(
  outcomes: GoldenOutcome[],
  misses?: string[]
): {
  passCount: number;
  failCount: number;
  allPass: boolean;
  allGreen: boolean;
  score: number;
} {
  const enabled = (outcomes || []).filter((o) => o.enabled !== false);
  const passCount = enabled.filter((o) => o.pass).length;
  const missCount = Array.isArray(misses) ? misses.length : 0;
  const failCount = enabled.length - passCount + missCount;
  const allPass = failCount === 0;
  const total = enabled.length + missCount;
  const score = total > 0 ? Math.round((passCount / total) * 100) : 100;
  return { passCount, failCount, allPass, allGreen: allPass, score };
}

export function buildScoreboard(input: {
  logText?: string;
  errorText?: string;
  jobStatus?: string;
  foodLog?: any;
  scout?: any;
  extraIssues?: string[];
  expectedMeal?: GoldenMealLine[];
  outcomes?: GoldenOutcome[];
  [key: string]: any;
}): GoldenScoreboard {
  const logText = input.logText || '';
  const journey = buildJourney({ logText, foodLog: input.foodLog, scout: input.scout });
  const tensions = parseTensions(logText);
  let outcomes: GoldenOutcome[] = input.outcomes ? [...input.outcomes] : parseKnownFails(logText);

  // Auto invariants from journey and foodLog
  const autoInvariants = buildAutoInvariants({ logText, foodLog: input.foodLog, scout: input.scout, journey });
  for (const inv of autoInvariants) {
    if (!inv.pass) {
      outcomes.push({
        id: inv.id,
        kind: inv.group || 'invariant',
        label: inv.label,
        expected: inv.expected,
        actual: inv.actual,
        pass: inv.pass,
        source: 'auto',
        enabled: true,
      });
    }
  }

  // If identity ended on labels, remove leftover category fallback fails
  const hasLabelTruth = journey.some((j) => String(j.phase || '').includes('label'));
  if (hasLabelTruth) {
    outcomes = outcomes.filter((o) => o.id !== 'log_category_fallback');
  }

  // Weight anchor overwrite check
  if (/\[User Explicit Weight Anchor\].*Updating estimatedWeightGrams/i.test(logText)) {
    const lines = logText.split('\n').filter((l) => /\[User Explicit Weight Anchor\]/.test(l));
    if (lines.length > 1) {
      outcomes.push({
        id: 'anchor_overwrite',
        kind: 'anchor',
        label: 'Second user explicit weight anchor overwrote the first',
        pass: false,
        source: 'auto',
        enabled: true,
      });
    }
  }

  // Add extra issues if provided
  if (Array.isArray(input.extraIssues)) {
    for (const raw of input.extraIssues) {
      const parts = splitExtraIssueText(raw);
      for (const p of parts) {
        if (/Portion Weight|Empty Nutrition|Brand Guard/i.test(p) && outcomes.some((o) => o.id === 'anchor_overwrite')) {
          continue;
        }
        outcomes.push({
          id: `user_extra_${Math.random().toString(36).slice(2, 7)}`,
          kind: 'custom',
          label: p,
          expected: 'Issue resolved',
          actual: 'User flagged issue',
          pass: false,
          source: 'user',
          enabled: true,
        });
      }
    }
  }

  const mealLines = extractMealLines(input.foodLog);
  const meal = input.expectedMeal ? evaluateMealLines(input.expectedMeal, mealLines) : { pass: true, misses: [] };
  const summary = scoreboardSummary(outcomes, meal.misses);

  const autoSpotRes = autoSpotFood({ logText, foodLog: input.foodLog, scout: input.scout });
  const autoSpot = autoSpotRes?.remaining || [];
  const ledger = input.foodLog?.ledger || compileGoldenMeal({ logText, foodLog: input.foodLog, scout: input.scout });

  return {
    outcomes,
    meal,
    summary,
    journey,
    invariants: autoInvariants,
    ledger,
    autoSpot,
    replayMode: 'log',
    tensions,
    scout: input.scout,
    mealLines,
    foodLog: input.foodLog,
  };
}

export function scoreGoldenRun(input: {
  logText?: string;
  errorText?: string;
  jobStatus?: string;
  foodLog?: any;
  scout?: any;
  expectedMeal?: GoldenMealLine[];
  extraIssues?: string[];
  [key: string]: any;
}): {
  meal: { pass: boolean; misses: string[] };
  summary: { passCount: number; failCount: number; allPass: boolean; allGreen: boolean; score: number };
  board: GoldenScoreboard;
} {
  const board = buildScoreboard(input);
  return {
    meal: board.meal || { pass: true, misses: [] },
    summary: board.summary,
    board,
  };
}
