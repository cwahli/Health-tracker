/**
 * Mid-journey golden checks. Pure. No I/O.
 *
 * Snapshot freezes scout dishes/components. Replay rebuilds each row's phase
 * from the latest log + foodLog. These fail automatically — the user does
 * not have to type them.
 *
 * Phases (identity):
 *   scouted → no_match → fallback → mismatch → broad_base → usda_live → catalog | label_truth
 *
 * Separate auto invariants (math / dietitian / shape / truth) sit beside identity.
 * Meal trial balance (scout → foundation → dietitian → table → narrative) is
 * a detector: imbalance stays red. See goldenLedger.ts.
 */

import { detectLedgerImbalances, ledgerImbalancesToInvariants, compileGoldenMeal } from './goldenLedger';

export type JourneyPhase =
  | 'scouted'
  | 'no_match'
  | 'fallback'
  | 'estimated'
  | 'mismatch'
  | 'broad_base'
  | 'usda_live'
  | 'catalog'
  | 'label_truth';

export type InvariantGroup = 'identity' | 'resolve' | 'math' | 'dietitian' | 'shape' | 'truth' | 'transport';

export type GoldenJourneyRow = {
  id: string;
  dish: string;
  query: string;
  scoutIndex: number | null;
  componentIndex: number | null;
  phase: JourneyPhase;
  source: string | null;
  matchId: string | null;
  matchName: string | null;
  identityPass: boolean;
  blockers: string[];
};

export type GoldenInvariant = {
  id: string;
  group: InvariantGroup;
  label: string;
  expected: string;
  actual: string;
  pass: boolean;
  signature?: string;
};

export const PHASE_LABEL: Record<JourneyPhase, string> = {
  scouted: 'Scouted only',
  no_match: 'No catalog / USDA match',
  fallback: 'Category fallback',
  estimated: 'Dish estimate',
  mismatch: 'Matched wrong food',
  broad_base: 'Needs broader basic food',
  usda_live: 'Live USDA/OFF (not catalog)',
  catalog: 'Catalog identity',
  label_truth: 'Printed / brand truth',
};

const STALE_STALL_RE = /stream stalled|no response from analysis engine|produced no tokens for 90s/i;

/** True when this log already reached a finished meal (label lock, receipt, dietitian). */
export function pipelineLooksComplete(logText: string): boolean {
  const log = String(logText || '');
  if (!log.trim()) return false;
  return (
    /\[Reconcile\] item="[^"]+" action=hard_lock/i.test(log) ||
    /\[Truth Direct Injection\]/i.test(log) ||
    /\[Budget\] item="[^"]+"[^\n]*source=label/i.test(log) ||
    /\[Food Log (?:Saved|Written|Ready)\]/i.test(log) ||
    /\[Dietitian Reality Check\]/i.test(log)
  );
}

export function jobLooksSucceeded(status?: string): boolean {
  return /^(succeeded|completed|success)$/i.test(String(status || ''));
}

/**
 * Drop leftover stall / scout-fail text from a prior attempt when this job
 * actually finished. Used by snapshot symptom + transport checks.
 */
export function sanitizeJobErrorText(errorText: string, logText: string, status?: string): string {
  const err = String(errorText || '').trim();
  if (!err) return '';
  const log = String(logText || '');
  const succeeded = jobLooksSucceeded(status);
  const complete = pipelineLooksComplete(log);
  if (STALE_STALL_RE.test(err) && (succeeded || complete)) return '';
  if (
    (succeeded || complete) &&
    /Vision Scout Failed/i.test(err) &&
    log.trim() &&
    !/Vision Scout Failed/i.test(log)
  ) {
    return '';
  }
  return err;
}

export function groupJourneyByDish(rows: GoldenJourneyRow[]): Array<{ dish: string; rows: GoldenJourneyRow[] }> {
  const groups: Array<{ dish: string; rows: GoldenJourneyRow[] }> = [];
  const index = new Map<string, number>();
  for (const row of rows) {
    const key = row.dish || '(unknown)';
    const i = index.get(key);
    if (i == null) {
      index.set(key, groups.length);
      groups.push({ dish: key, rows: [row] });
    } else {
      groups[i].rows.push(row);
    }
  }
  return groups;
}

/** Snapshot UI: hide passing checks and titles already covered by the journey list. */
export function snapshotVisibleInvariants(
  invariants: GoldenInvariant[],
  journey: GoldenJourneyRow[]
): GoldenInvariant[] {
  const journeyHasFallback = journey.some((j) => j.phase === 'fallback');
  const redundant = new Set([
    'id_all_components_identified',
    'id_every_component_resolved',
    'id_scout_items_present',
  ]);
  const seen = new Set<string>();
  return invariants.filter((i) => {
    if (i.pass || !i.label) return false;
    if (redundant.has(i.id)) return false;
    if (i.id === 'res_no_category_fallback' && journeyHasFallback) return false;
    const k = i.label.replace(/\s+/g, ' ').trim().toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const FORBIDDEN_NAME = [
  /POWERADE/i,
  /Popsicle/i,
  /Snow cone/i,
  /Italian Ice/i,
  /Taro,?\s*leaves/i,
  /onion powder/i,
  /vegetarian falafel wrap ingredients/i,
  /Co-op Blueberry Granola Yogurt Pot/i,
  /Water,\s*bottled/i,
  /Instant Oatmeal/i,
  /Dark Choc Almond/i,
];

const DISH_LEVEL = /\b(wrap|bowl|pot|parfait|combo|sandwich|burger|pizza|platter|ingredients|meal kit)\b/i;
const GENERIC_QUERY_MAX_TOKENS = 3;

export function normalizeScoutItems(scout: any): any[] {
  if (!scout) return [];
  if (Array.isArray(scout)) return scout;
  if (Array.isArray(scout.items)) return scout.items;
  if (Array.isArray(scout.scoutItems)) return scout.scoutItems;
  return [];
}

export function extractFoodItems(foodLog: any): any[] {
  if (!foodLog) return [];
  const top = foodLog.dishes || foodLog.mealDishes || foodLog.topDishes;
  if (Array.isArray(top) && top.length) return top;
  const items = foodLog.itemsBreakdown || foodLog.items || foodLog.foodData?.itemsBreakdown || [];
  if (Array.isArray(items) && items.length) return items;
  const groups = foodLog.comparison || foodLog.foodData?.comparison;
  if (Array.isArray(groups) && groups.length) {
    return groups.map((g: any) => ({
      originalName: g.groupName || g.name,
      name: g.groupName || g.name,
      calories: g.averageNutrients?.calories ?? g.calories,
      weightGrams: g.weightGrams,
      nutrients: g.averageNutrients || {},
    }));
  }
  return [];
}

function slug(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);
}

function namesClose(a: string, b: string): boolean {
  const na = String(a || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const nb = String(b || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!na || !nb) return false;
  if (na === nb) return true;
  return na.includes(nb) || nb.includes(na);
}

function num(v: any): number | null {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : null;
}

function itemName(it: any): string {
  return String(it?.originalName || it?.name || it?.canonicalDbName || it?.keyword || it?.dish_name || '').trim();
}

function itemNutrients(it: any): Record<string, any> {
  return it?.nutrients && typeof it.nutrients === 'object' ? it.nutrients : it || {};
}

type Diagnostic = {
  dish: string;
  scoutIndex: number | null;
  componentIndex: number | null;
  query: string;
  canonical: string | null;
  source: string | null;
  matchId: string | null;
};

export function parseResolutionDiagnostics(logText: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  const re =
    /\[Component Resolution Diagnostic\] item="([^"]*)"\s*\(scoutIndex=(\d+)\)\s*component\[(\d+)\]\s*query="([^"]*)"\s*->\s*canonicalMatch=(\S+)\s*bestMatch\.source=(\S+)\s*bestMatch\.id=(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(logText))) {
    const canonicalRaw = m[5];
    const canonical =
      !canonicalRaw || canonicalRaw === 'none' || canonicalRaw === 'null' || canonicalRaw === '"no-fdcid"'
        ? null
        : canonicalRaw.replace(/^"|"$/g, '');
    const source = !m[6] || m[6] === 'null' ? null : m[6];
    const matchId = !m[7] || m[7] === 'null' ? null : m[7];
    out.push({
      dish: m[1],
      scoutIndex: Number(m[2]),
      componentIndex: Number(m[3]),
      query: m[4],
      canonical,
      source,
      matchId,
    });
  }
  return out;
}

function parseNamedBinds(logText: string): Array<{ query: string; name: string; id?: string }> {
  const binds: Array<{ query: string; name: string; id?: string }> = [];
  const hit = [...logText.matchAll(/HIT_UNIQUE for "([^"]+)"\s*->\s*([^\n]+)/g)];
  hit.forEach((m) => binds.push({ query: m[1], name: m[2].trim() }));
  const curator = [
    ...logText.matchAll(
      /Bound direct Curator query match id=(\S+) \("([^"]+)"\) for component "([^"]+)"/g
    ),
  ];
  curator.forEach((m) => binds.push({ query: m[3], name: m[2], id: m[1] }));
  const brand = [...logText.matchAll(/Matched stored brand item for "([^"]+)" -> "([^"]+)"/g)];
  brand.forEach((m) => binds.push({ query: m[1], name: m[2] }));
  const usdaWarn = [
    ...logText.matchAll(/Could not find verified USDA match for "([^"]+)"/g),
  ];
  usdaWarn.forEach((m) => binds.push({ query: m[1], name: '__no_usda__' }));
  return binds;
}

export function isForbiddenName(name: string): boolean {
  return FORBIDDEN_NAME.some((re) => re.test(name));
}

export const FORBIDDEN_FDC_IDS = new Set([
  '174113', // POWERADE mixed berry
  '2710321', // Popsicle
  '2710324',
  '2710318',
  '170544', // Taro leaves
  '171327', // onion powder
  '2710708', // bottled water
  '172991', // instant oatmeal raisin
]);

export function isForbiddenHit(id: string | null | undefined, name: string | null | undefined): boolean {
  if (id && FORBIDDEN_FDC_IDS.has(String(id))) return true;
  return isForbiddenName(String(name || ''));
}

export function needsBroaderBase(query: string, matchName: string, source: string | null): boolean {
  if (!matchName || matchName === '__no_usda__') return false;
  const q = query.toLowerCase();
  const n = matchName.toLowerCase();
  if (isForbiddenName(matchName)) return false; // that's mismatch, not broad
  const qTokens = q.split(/\s+/).filter(Boolean);
  if (source === 'brand_official' && qTokens.length <= GENERIC_QUERY_MAX_TOKENS && !/\b(coop|co-op|mcdonald|yolk|sainsbury|tesco|pret|starbucks)\b/i.test(q)) {
    if (DISH_LEVEL.test(n) && !DISH_LEVEL.test(q)) return true;
  }
  if (qTokens.length <= GENERIC_QUERY_MAX_TOKENS && DISH_LEVEL.test(n) && !DISH_LEVEL.test(q)) return true;
  return false;
}

function phaseFrom(diag: Diagnostic | undefined, matchName: string | null): JourneyPhase {
  if (!diag) return 'scouted';
  if (matchName && isForbiddenName(matchName)) return 'mismatch';
  if (diag.matchId && /^fallback_/i.test(diag.matchId)) return 'fallback';
  const src = (diag.source || '').toLowerCase();
  if (src === 'category_fallback') return 'fallback';
  if (src === 'estimated') return 'estimated';
  if (!src && !diag.canonical) return 'no_match';
  if (matchName && needsBroaderBase(diag.query, matchName, src)) return 'broad_base';
  if (src === 'label' || src === 'brand_official') return 'label_truth';
  if (src === 'internal_catalog' || src === 'canonical_dict' || src === 'usual_catalog' || src === 'canonical') {
    return 'catalog';
  }
  if (src === 'usda' || src === 'off') return 'usda_live';
  if (diag.canonical) return 'catalog';
  if (!src) return 'no_match';
  return 'usda_live';
}

function dbSourceToPhase(src: string, hasId: boolean): JourneyPhase | null {
  const s = String(src || '').toLowerCase();
  if (!s && !hasId) return null;
  if (s === 'label' || s === 'brand_official' || s === 'brand') return 'label_truth';
  if (
    s === 'internal_catalog' ||
    s === 'canonical_dict' ||
    s === 'usual_catalog' ||
    s === 'canonical' ||
    s === 'catalog'
  ) {
    return 'catalog';
  }
  if (s === 'category_fallback' || s === 'fallback') return 'fallback';
  if (s === 'estimated') return 'estimated';
  if (s === 'usda' || s === 'off' || s === 'usda_live') return 'usda_live';
  if (hasId) return 'catalog';
  return null;
}

function foodLogNodes(foodLog: any): any[] {
  const items = extractFoodItems(foodLog);
  const out: any[] = [];
  for (const it of items) {
    out.push(it);
    const comps = Array.isArray(it?.components) ? it.components : [];
    for (const c of comps) out.push(c);
  }
  return out;
}

/** When logs are a 403 pointer, the saved meal still knows catalog / USDA / fallback. */
function applyFoodLogPhases(rows: GoldenJourneyRow[], foodLog: any): void {
  const nodes = foodLogNodes(foodLog);
  if (!nodes.length) return;
  for (const row of rows) {
    if (row.phase !== 'scouted' && row.phase !== 'no_match') continue;
    const named = (n: any) => String(n?.name || n?.originalName || n?.searchQuery || n?.keyword || '');
    const hit = nodes.find((n) => namesClose(named(n), row.query));
    if (!hit) continue;
    const src = String(hit.dbSource || hit.source || hit.bestMatchDbSource || '');
    const id = hit.dbId || hit.fdcId || hit.canonicalMatch || null;
    const phase = dbSourceToPhase(src, Boolean(id && String(id) !== 'none'));
    if (!phase) continue;
    row.phase = phase;
    row.source = src || row.source;
    row.matchId = id ? String(id) : row.matchId;
    row.matchName = String(hit.name || hit.originalName || row.matchName || '');
  }
}

export function journeyResolvedCount(rows: GoldenJourneyRow[]): number {
  return journeyPhaseCounts(rows).bound;
}

/** Fallback is a bind, not a success. Bound = catalog/label or USDA. */
export function journeyPhaseCounts(rows: GoldenJourneyRow[]): {
  bound: number;
  catalog: number;
  usda: number;
  fallback: number;
  total: number;
} {
  const list = rows || [];
  const catalog = list.filter((j) => identityOk(j.phase)).length;
  const usda = list.filter((j) => j.phase === 'usda_live').length;
  const fallback = list.filter((j) => j.phase === 'fallback').length;
  return { bound: catalog + usda, catalog, usda, fallback, total: list.length };
}

export function identityOk(phase: JourneyPhase): boolean {
  return phase === 'catalog' || phase === 'label_truth' || phase === 'estimated';
}

export function buildJourney(input: { logText?: string; foodLog?: any; scout?: any }): GoldenJourneyRow[] {
  const log = String(input.logText || '');
  const scoutItems = normalizeScoutItems(input.scout);
  const diags = parseResolutionDiagnostics(log);
  const binds = parseNamedBinds(log);
  const rows: GoldenJourneyRow[] = [];
  const seen = new Set<string>();

  const pushRow = (partial: Omit<GoldenJourneyRow, 'identityPass' | 'blockers'> & { blockers?: string[] }) => {
    const key = `${partial.scoutIndex ?? 'x'}:${partial.componentIndex ?? 'x'}:${partial.query.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    const blockers = partial.blockers || [];
    rows.push({
      ...partial,
      blockers,
      identityPass: identityOk(partial.phase) && !blockers.includes('mismatch'),
    });
  };

  const matchNameFor = (query: string): string | null => {
    const hit = binds.find((b) => namesClose(b.query, query));
    return hit?.name || null;
  };

  const labelDishes = new Set(
    [...log.matchAll(/\[Reconcile\] item="([^"]+)" action=hard_lock/g)].map((m) => m[1].toLowerCase())
  );
  [...log.matchAll(/\[Truth Direct Injection\] "([^"]+)".*from label/g)].forEach((m) =>
    labelDishes.add(m[1].toLowerCase())
  );
  [...log.matchAll(/\[Budget\] item="([^"]+)"[^\n]*source=label/g)].forEach((m) =>
    labelDishes.add(m[1].toLowerCase())
  );
  const curatorPicks = new Map<string, string>();
  [...log.matchAll(/pick_existing for "([^"]+)"\s*->\s*(\S+)/g)].forEach((m) =>
    curatorPicks.set(m[1].toLowerCase(), m[2])
  );
  [...log.matchAll(/Resolved locally for "([^"]+)"\s*->\s*FDC\s+(\S+)/g)].forEach((m) =>
    curatorPicks.set(m[1].toLowerCase(), m[2])
  );

  if (scoutItems.length) {
    scoutItems.forEach((item, i) => {
      const dish = itemName(item) || `item ${i + 1}`;
      const comps = Array.isArray(item.components) && item.components.length
        ? item.components
        : [{ searchQuery: item.keyword || item.originalName || dish, volumePercentage: 100 }];
      comps.forEach((comp: any, cIdx: number) => {
        const query = String(comp.searchQuery || comp.name || comp.keyword || dish).trim();
        const diag =
          diags.find((d) => d.scoutIndex === i && d.componentIndex === cIdx) ||
          diags.find((d) => namesClose(d.query, query) && (d.scoutIndex === i || namesClose(d.dish, dish)));
        const matchName = matchNameFor(query);
        const compSource = (comp.dbSource || comp.source || '').toLowerCase();
        let phase = phaseFrom(diag, matchName);
        if (phase === 'scouted' && compSource) {
          if (compSource === 'estimated') phase = 'estimated';
          else if (compSource === 'category_fallback') phase = 'fallback';
        }
        const pickId = curatorPicks.get(query.toLowerCase());
        if (pickId && phase !== 'mismatch') {
          phase = 'catalog';
        } else if ((phase === 'scouted' || phase === 'no_match') && [...labelDishes].some((d) => namesClose(d, dish))) {
          phase = 'label_truth';
        }
        pushRow({
          id: `j_${i}_${cIdx}_${slug(query)}`,
          dish,
          query,
          scoutIndex: i,
          componentIndex: cIdx,
          phase,
          source: diag?.source || compSource || (pickId ? 'internal_catalog' : phase === 'label_truth' ? 'label' : null),
          matchId: diag?.matchId || comp.dbId || pickId || null,
          matchName,
        });
      });
    });
  }

  // Diagnostics for items the scout JSON missed (log-only replay)
  diags.forEach((d) => {
    const key = `${d.scoutIndex ?? 'x'}:${d.componentIndex ?? 'x'}:${d.query.toLowerCase()}`;
    if (seen.has(key)) return;
    const matchName = matchNameFor(d.query);
    pushRow({
      id: `j_log_${d.scoutIndex ?? 'x'}_${d.componentIndex ?? 'x'}_${slug(d.query)}`,
      dish: d.dish,
      query: d.query,
      scoutIndex: d.scoutIndex,
      componentIndex: d.componentIndex,
      phase: phaseFrom(d, matchName),
      source: d.source,
      matchId: d.matchId,
      matchName,
    });
  });

  applyFoodLogPhases(rows, input.foodLog);

  // Attach per-row math / dietitian blockers from the log
  const scaleItems = [...log.matchAll(/\[Reconcile\] item="([^"]+)" action=scale/g)].map((m) => m[1]);
  const dietitianItems = [
    ...log.matchAll(/\[Dietitian Reality Check\][^\n]*(?:Adjusted|Rescaled|Capped)[^\n]*"([^"]+)"/g),
    ...log.matchAll(/\[Dietitian Reality Check\][^\n]*"([^"]+)"[^\n]*(?:Adjusted|Rescaled|Capped)/g),
  ].map((m) => m[1]);
  const fallbackQueries = [
    ...log.matchAll(/Created category fallback for gap "([^"]+)"/g),
  ].map((m) => m[1]);
  const rejected = [...log.matchAll(/Relevance gate rejected "([^"]+)"[^\n]*for query "([^"]+)"/g)];

  for (const row of rows) {
    if (scaleItems.some((n) => namesClose(n, row.dish))) row.blockers.push('scaled');
    if (dietitianItems.some((n) => namesClose(n, row.dish) || namesClose(n, row.query))) {
      row.blockers.push('dietitian_adjusted');
    }
    if (fallbackQueries.some((q) => namesClose(q, row.query))) {
      // Leftover fallback after a catalog pick or printed label is noise, not identity.
      if (row.phase === 'catalog' || row.phase === 'label_truth') {
        /* keep identity; do not downgrade */
      } else {
        row.blockers.push('fallback');
        if (row.phase === 'scouted' || row.phase === 'no_match' || row.phase === 'usda_live') {
          row.phase = 'fallback';
        }
      }
    }
    if (rejected.some((m) => namesClose(m[2], row.query))) {
      row.blockers.push('relevance_rejected');
      if (row.phase === 'catalog' || row.phase === 'usda_live' || row.phase === 'label_truth') {
        row.phase = 'mismatch';
      }
    }
    if (row.matchName && isForbiddenName(row.matchName)) {
      row.phase = 'mismatch';
      row.blockers.push('mismatch');
    }
    row.identityPass = identityOk(row.phase) && !row.blockers.includes('mismatch');
  }

  return rows;
}

function nutrientFields(it: any): { calories: number | null; protein: number | null; carbohydrates: number | null; totalFat: number | null; sodium: number | null; weight: number | null } {
  const n = itemNutrients(it);
  return {
    calories: num(n.calories ?? it.calories ?? it.kcal),
    protein: num(n.protein ?? it.protein),
    carbohydrates: num(n.carbohydrates ?? n.carbs ?? it.carbohydrates ?? it.carbs),
    totalFat: num(n.totalFat ?? n.fat ?? it.totalFat ?? it.fat),
    sodium: num(n.sodium ?? it.sodium),
    weight: num(it.weightGrams ?? it.weight ?? it.estimatedWeightGrams ?? n.weightGrams),
  };
}

export function buildAutoInvariants(input: {
  logText?: string;
  foodLog?: any;
  scout?: any;
  journey?: GoldenJourneyRow[];
}): GoldenInvariant[] {
  const log = String(input.logText || '');
  const labelDishes = new Set(
    [...log.matchAll(/\[Reconcile\] item="([^"]+)" action=hard_lock/g)].map((m) => m[1].toLowerCase())
  );
  const foodItems = extractFoodItems(input.foodLog);
  const scoutItems = normalizeScoutItems(input.scout);
  const journey = input.journey || buildJourney(input);
  const inv: GoldenInvariant[] = [];

  const add = (row: GoldenInvariant) => inv.push(row);

  // --- Identity vs scout ---
  if (scoutItems.length) {
    const missing: string[] = [];
    scoutItems.forEach((s, i) => {
      const name = itemName(s) || `item ${i + 1}`;
      const found = foodItems.some((it, idx) => it.scoutIndex === i || namesClose(itemName(it), name) || idx === i);
      if (!found) missing.push(name);
    });
    add({
      id: 'id_scout_items_present',
      group: 'identity',
      label: 'Every scout dish is still in the final meal',
      expected: `${scoutItems.length} scout dishes`,
      actual: missing.length ? `missing: ${missing.join(', ')}` : `${foodItems.length} dishes present`,
      pass: missing.length === 0 && foodItems.length > 0,
    });

    if (foodItems.length > scoutItems.length + 1) {
      add({
        id: 'id_dietitian_invented_dishes',
        group: 'identity',
        label: 'Dietitian must not invent extra dishes',
        expected: `≤ ${scoutItems.length + 1} dishes`,
        actual: `${foodItems.length} dishes`,
        pass: false,
      });
    }

    const unexplained = journey.filter(
      (j) => j.phase === 'scouted' || j.phase === 'no_match' || j.phase === 'fallback'
    );
    add({
      id: 'id_every_component_resolved',
      group: 'resolve',
      label: 'Every scout component was resolved (diagnostic, catalog, or printed label)',
      expected: 'identity per component — fallback does not count',
      actual: unexplained.length
        ? `unresolved: ${unexplained.map((j) => `${j.query} (${j.phase})`).join(', ')}`
        : 'all components diagnosed',
      pass: unexplained.length === 0 && journey.length > 0,
    });
  }

  if (journey.length) {
    const unresolved = journey.filter((j) => !j.identityPass);
    add({
      id: 'id_all_components_identified',
      group: 'resolve',
      label: 'All scout components identified (catalog or printed/brand)',
      expected: 'every component catalog/label_truth',
      actual: unresolved.length
        ? unresolved.map((j) => `${j.query} → ${PHASE_LABEL[j.phase]}`).join('; ')
        : `${journey.length} identified`,
      pass: unresolved.length === 0,
    });
  }

  // --- Resolve / log ---
  if (/Created category fallback/i.test(log)) {
    const gaps = [...log.matchAll(/Created category fallback for gap "([^"]+)"/g)].map((m) => m[1]);
    const surviving = journey
      .filter((j) => j.phase === 'fallback')
      .map((j) => j.query)
      .filter(Boolean);
    const uniqueSurviving = [...new Set(surviving.length ? surviving : [])];
    // If the journey ended on catalog/label, leftover fallback log lines are not a current fail.
    if (uniqueSurviving.length || !journey.length) {
      const listed = uniqueSurviving.length ? uniqueSurviving : gaps;
      add({
        id: 'res_no_category_fallback',
        group: 'resolve',
        label:
          listed.length === 1
            ? `Category fallback used for "${listed[0]}"`
            : `Category fallback used for: ${listed.join(', ') || 'a gap food'}`,
        expected: 'absent',
        actual: listed.join(', ') || 'category fallback',
        pass: false,
        signature: '[Food Resolver Fallback] Created category fallback',
      });
    }
  }

  const weightHits = [
    ...log.matchAll(
      /\[User Explicit Weight Anchor\] User text specified ([\d.]+)g\/ml for "([^"]+)"/g
    ),
  ];
  const byDish = new Map<string, number[]>();
  weightHits.forEach((m) => {
    const name = m[2].toLowerCase();
    const list = byDish.get(name) || [];
    list.push(Number(m[1]));
    byDish.set(name, list);
  });
  byDish.forEach((weights, name) => {
    const uniq = [...new Set(weights)];
    if (uniq.length >= 2) {
      add({
        id: `id_weight_anchor_overwrite_${slug(name)}`,
        group: 'identity',
        label: `User weights ${uniq.join('g then ')}g were both applied to "${name}" — the later one overwrote the first`,
        expected: 'one explicit weight per dish',
        actual: uniq.join(' → '),
        pass: false,
        signature: '[User Explicit Weight Anchor]',
      });
    }
  });

  const labelMerges = [
    ...log.matchAll(/\[Label Merge\] Matched label "([^"]+)"[^\n]*->\s*"([^"]+)"/g),
  ];
  if (labelMerges.length) {
    add({
      id: 'id_label_merge_collapsed',
      group: 'identity',
      label: `Scout label "${labelMerges[0][1]}" was merged into "${labelMerges[0][2]}" — a separate food disappeared`,
      expected: 'one label per dish',
      actual: labelMerges.map((m) => `${m[1]} → ${m[2]}`).join('; '),
      pass: false,
      signature: '[Label Merge] Matched label',
    });
  }

  const truthMerge = [
    ...log.matchAll(
      /\[Truth Merge\] Database match calories \(([\d.]+)\) deviate too much from OCR label \(([\d.]+)\)/g
    ),
  ];
  if (truthMerge.length) {
    const dbKcal = Number(truthMerge[0][1]);
    const ocrKcal = Number(truthMerge[0][2]);
    const calOf = (it: any) =>
      Number(it?.calories ?? it?.nutrients?.calories ?? it?.estimatedCalories ?? NaN);
    const nameOf = (it: any) =>
      String(it?.originalName || it?.name || it?.keyword || '').toLowerCase();
    const keptPrinted = foodItems.some((it) => {
      const c = calOf(it);
      return Number.isFinite(c) && Math.abs(c - ocrKcal) <= 15;
    });
    const gluedOntoDryCured = foodItems.some((it) => {
      const n = nameOf(it);
      const c = calOf(it);
      return (
        Number.isFinite(c) &&
        Math.abs(c - ocrKcal) <= 15 &&
        /\b(serrano|iberico|ib[eé]rico|prosciutto|parma|speck|gran reserva|jam[oó]n)\b/.test(n)
      );
    });
    const pass = keptPrinted && !gluedOntoDryCured;
    add({
      id: 'res_truth_merge_db_mismatch',
      group: 'resolve',
      label: pass
        ? `Truth merge refused DB ${dbKcal} kcal vs printed ${ocrKcal} kcal — kept the label`
        : `DB match ${dbKcal} kcal rejected vs OCR label ${ocrKcal} kcal — search matched the wrong food`,
      expected: pass
        ? 'printed label kept; wrong DB hit refused'
        : 'DB candidate within label tolerance, or label kept on the right dish',
      actual: truthMerge.map((m) => `${m[1]} vs ${m[2]}`).join('; '),
      pass,
      signature: '[Truth Merge] Database match calories',
    });
  }

  const backfills = [
    ...log.matchAll(
      /\[Truth Data Backfill\] "([^"]+)": filled missing fields via ([^;]+); locked truth keys=\[([^\]]*)\]; estimated=\[([^\]]*)\]/g
    ),
  ];
  const PRIMARY_EST = new Set(['calories', 'protein', 'totalfat', 'carbohydrates', 'carbs', 'sodium']);
  backfills.forEach((m) => {
    const estimated = String(m[4] || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const primaryMissing = estimated.filter((f) => PRIMARY_EST.has(f.toLowerCase().replace(/\s+/g, '')));
    if (primaryMissing.length < 2) return;
    const via = String(m[2] || '');
    const locked = String(m[3] || '');
    const kcalLocked = /calories/i.test(locked);
    const derivedFromBase = /ingredient_decomposition|name_canonical/i.test(via);
    add({
      id: `truth_estimated_macros_${slug(m[1])}`,
      group: 'truth',
      label: kcalLocked && derivedFromBase
        ? `"${m[1]}": printed kcal locked; P/C/F derived from base food via ${via}`
        : `"${m[1]}": only [${locked || 'none'}] locked from label; estimated ${primaryMissing.join(', ')}`,
      expected: 'printed kcal + derived macros from catalog/base food',
      actual: `via ${via}`,
      pass: !!(kcalLocked && derivedFromBase),
      signature: '[Truth Data Backfill]',
    });
  });

  const brandHits = [
    ...log.matchAll(
      /\[Brand DB Match\] Found official restaurant\/brand menu item for "([^"]+)" -> "([^"]+)" \(([^)]+)\)/g
    ),
  ];
  const brandByTarget = new Map<string, string[]>();
  brandHits.forEach((m) => {
    const key = `${m[3]}::${m[2].toLowerCase()}`;
    const list = brandByTarget.get(key) || [];
    list.push(m[1]);
    brandByTarget.set(key, list);
  });
  brandByTarget.forEach((queries, key) => {
    const unique = [...new Set(queries.map((q) => q.toLowerCase()))];
    if (unique.length < 2) return;
    add({
      id: `res_dup_brand_${slug(key)}`,
      group: 'resolve',
      label: `Duplicate brand match: "${queries[0]}" and "${queries[1]}" both resolved to the same menu item`,
      expected: 'dedupe before curator',
      actual: queries.join(' + '),
      pass: false,
      signature: '[Brand DB Match]',
    });
  });
  if (/Failed to execute curator/i.test(log)) {
    add({
      id: 'res_curator_schema',
      group: 'resolve',
      label: 'Curator schema must parse',
      expected: 'absent',
      actual: 'Failed to execute curator',
      pass: false,
      signature: 'Failed to execute curator',
    });
  }
  if (/LLM hallucinated ID/i.test(log)) {
    add({
      id: 'res_curator_hallucinated_id',
      group: 'resolve',
      label: 'Curator must not hallucinate an FDC id',
      expected: 'absent',
      actual: 'LLM hallucinated ID',
      pass: false,
      signature: 'LLM hallucinated ID',
    });
  }
  if (/Could not find verified USDA match/i.test(log)) {
    const qs = [...log.matchAll(/Could not find verified USDA match for "([^"]+)"/g)].map((m) => m[1]);
    add({
      id: 'res_usda_miss',
      group: 'resolve',
      label: 'No USDA-not-found warning (use catalog / unknown)',
      expected: 'absent',
      actual: qs.join(', '),
      pass: false,
      signature: 'Could not find verified USDA match',
    });
  }
  if (/Blocked beverage candidate/i.test(log)) {
    add({
      id: 'res_yogurt_beverage',
      group: 'resolve',
      label: 'Yogurt / dairy must not be treated as a beverage',
      expected: 'absent',
      actual: 'Blocked beverage candidate',
      pass: false,
      signature: 'Blocked beverage candidate',
    });
  }

  // --- Math ---
  const scales = [...log.matchAll(/\[Reconcile\] item="([^"]+)" action=scale foundation=([\d.]+) budget=([\d.]+) final=([\d.]+) factor=([\d.]+)/g)];
  if (scales.length) {
    add({
      id: 'math_no_scout_scale',
      group: 'math',
      label: 'Must not scale foundation toward scout kcal',
      expected: 'action=keep',
      actual: scales.map((m) => `${m[1]} ×${m[5]}`).join('; '),
      pass: false,
      signature: 'action=scale',
    });
  }
  if (/ReceiptInvariant.*(?:FAIL|REPAIRED)/i.test(log)) {
    const fails = [...log.matchAll(/\[ReceiptInvariant\] FAIL item="([^"]+)" rowSum=([\d.]+) itemCal=([\d.]+)/g)];
    add({
      id: 'math_receipt_invariant',
      group: 'math',
      label: 'Receipt rows must match item calories (no repair)',
      expected: 'rowSum == itemCal',
      actual: fails.length ? fails.map((m) => `${m[1]} ${m[2]}≠${m[3]}`).join('; ') : 'REPAIRED',
      pass: false,
      signature: 'ReceiptInvariant',
    });
  }

  // Totals: item vs components, meal vs items
  let mealCal = 0;
  let mealP = 0;
  let mealC = 0;
  let mealF = 0;
  let zeroMacro = 0;
  let blankRequired = 0;
  let malformed = 0;
  let truthRewritten = 0;
  const zeroNames: string[] = [];
  const blankNames: string[] = [];
  const malformedNames: string[] = [];
  const truthNames: string[] = [];

  foodItems.forEach((it) => {
    const name = itemName(it) || '(unnamed)';
    const n = itemNutrients(it);
    const f = nutrientFields(it);
    const weight = f.weight ?? 0;

    if (!name || name === '(unnamed)') {
      blankRequired++;
      blankNames.push('unnamed item');
    }
    if (f.weight == null) {
      blankRequired++;
      blankNames.push(`${name} weight`);
    }
    if (!it.nutrients && f.calories == null) {
      blankRequired++;
      blankNames.push(`${name} nutrients`);
    }
    if (f.calories == null && weight > 0) {
      blankRequired++;
      blankNames.push(`${name} calories`);
    }

    const rawVals = [n.calories, n.protein, n.carbohydrates, n.totalFat, n.sodium, it.calories];
    if (rawVals.some((v) => typeof v === 'number' && !Number.isFinite(v))) {
      malformed++;
      malformedNames.push(`${name} non-finite`);
    }
    if (rawVals.some((v) => typeof v === 'string' && v.trim() !== '' && Number.isNaN(Number(v.replace?.(/[^\d.-]/g, '') ?? v)))) {
      malformed++;
      malformedNames.push(`${name} non-numeric string`);
    }

    if (weight >= 15 && (f.calories ?? 0) === 0 && (f.protein ?? 0) === 0 && (f.totalFat ?? 0) === 0 && (f.carbohydrates ?? 0) === 0) {
      zeroMacro++;
      zeroNames.push(name);
    }

    mealCal += f.calories ?? 0;
    mealP += f.protein ?? 0;
    mealC += f.carbohydrates ?? 0;
    mealF += f.totalFat ?? 0;

    const comps = it.componentsDetailList || it.components || [];
    if (Array.isArray(comps) && comps.length > 1 && f.calories != null) {
      const rowSum = comps.reduce((a: number, c: any) => a + (num(c.calories ?? c.nutrients?.calories) ?? 0), 0);
      if (rowSum > 0 && Math.abs(rowSum - f.calories) > 8) {
        add({
          id: `math_row_sum_${slug(name)}`,
          group: 'math',
          label: `Component kcal sum matches "${name}"`,
          expected: String(f.calories),
          actual: String(Math.round(rowSum * 10) / 10),
          pass: false,
        });
      }
    }

    const locked: string[] = it.lockedNutrientKeys || it.itemLockedKeys || [];
    const truth = it.truthNutrients || {};
    locked.forEach((k) => {
      const t = num(truth[k]);
      const cur = num(n[k] ?? it[k]);
      if (t != null && cur != null && Math.abs(t - cur) > 1.1) {
        truthRewritten++;
        truthNames.push(`${name}.${k} ${t}→${cur}`);
      }
      if (t == null && (n[k] === undefined || n[k] === null || n[k] === '')) {
        add({
          id: `shape_locked_blank_${slug(name)}_${k}`,
          group: 'shape',
          label: `Locked field ${k} on "${name}" must not be blank`,
          expected: 'numeric lock',
          actual: 'blank',
          pass: false,
        });
      }
    });

    const src = String(it.dbSource || it.bestMatchDbSource || '');
    if ((src === 'usda' || src === 'off' || src === 'internal_catalog' || src === 'brand_official') && !it.dbId && !it.bestMatchDbId) {
      add({
        id: `shape_dbid_blank_${slug(name)}`,
        group: 'shape',
        label: `"${name}" has source ${src} but blank dbId`,
        expected: 'dbId present',
        actual: 'blank',
        pass: false,
      });
    }
    if ((src === 'label' || src === 'brand_official') && !it.rawNutritionLabel && !it.labelNutrientsPerServing) {
      add({
        id: `shape_label_blank_${slug(name)}`,
        group: 'truth',
        label: `"${name}" is ${src} but has no label payload`,
        expected: 'rawNutritionLabel',
        actual: 'blank',
        pass: false,
      });
    }
    if (it.dbSource === 'estimated_override') {
      add({
        id: `diet_override_${slug(name)}`,
        group: 'dietitian',
        label: `Dietitian must not override "${name}" (estimated_override)`,
        expected: 'precalc stands',
        actual: it.overrideReason || 'estimated_override',
        pass: false,
        signature: 'estimated_override',
      });
    }
  });

  const topCal = num(input.foodLog?.calories ?? input.foodLog?.nutrients?.calories ?? input.foodLog?.foodData?.calories);
  if (foodItems.length && topCal != null && mealCal > 0 && Math.abs(topCal - mealCal) > Math.max(8, topCal * 0.03)) {
    add({
      id: 'math_meal_total_matches_items',
      group: 'math',
      label: 'Meal total calories match the sum of dishes',
      expected: String(Math.round(mealCal)),
      actual: String(topCal),
      pass: false,
    });
  }

  if (zeroMacro > 0) {
    add({
      id: 'math_no_zero_macro_items',
      group: 'math',
      label: 'No eaten item with all-zero macros',
      expected: '0 zero-macro items',
      actual: `${zeroMacro}: ${zeroNames.join(', ')}`,
      pass: false,
    });
  }
  if (blankRequired > 0) {
    add({
      id: 'shape_no_blank_required',
      group: 'shape',
      label: 'Required fields (name, weight, calories) must not be blank',
      expected: 'all filled',
      actual: blankNames.slice(0, 8).join('; '),
      pass: false,
    });
  }
  if (malformed > 0) {
    add({
      id: 'shape_no_malformed_numbers',
      group: 'shape',
      label: 'Nutrient fields must be finite numbers',
      expected: 'finite',
      actual: malformedNames.join('; '),
      pass: false,
    });
  }
  if (truthRewritten > 0) {
    add({
      id: 'truth_not_recalculated',
      group: 'truth',
      label: 'Locked / printed truth must not be recalculated',
      expected: 'truth == final',
      actual: truthNames.join('; '),
      pass: false,
    });
  }

  // --- Dietitian ---
  const dietAdj = [...log.matchAll(/\[Dietitian Reality Check\] ([^\n]+)/g)].map((m) => m[1]);
  const dietChanged = dietAdj.filter((l) => /Adjusted|Rescaled|Capped|Added /i.test(l));
  if (dietChanged.length) {
    add({
      id: 'diet_no_reality_rewrite',
      group: 'dietitian',
      label: 'Dietitian must not rewrite precalc composition',
      expected: 'heuristic skip / no adjust',
      actual: dietChanged.slice(0, 4).join(' | '),
      pass: false,
      signature: '[Dietitian Reality Check]',
    });
  }
  if (/Dietitian Failed Permanently/i.test(log)) {
    add({
      id: 'diet_did_not_fail',
      group: 'dietitian',
      label: 'Dietitian call must complete',
      expected: 'completed',
      actual: 'Failed Permanently',
      pass: false,
      signature: 'Dietitian Failed Permanently',
    });
  }
  if (/\[Atwater Check\].*rescale/i.test(log)) {
    add({
      id: 'math_no_atwater_rescale',
      group: 'math',
      label: 'No Atwater rescale of a composed item',
      expected: 'absent',
      actual: 'Atwater rescale',
      pass: false,
      signature: '[Atwater Check]',
    });
  }
  if (/Incomplete assembly/i.test(log)) {
    add({
      id: 'math_incomplete_assembly',
      group: 'math',
      label: 'Component mass must not collapse onto one filler',
      expected: 'absent',
      actual: 'Incomplete assembly',
      pass: false,
      signature: 'Incomplete assembly',
    });
  }

  if (!foodItems.length && scoutItems.length) {
    add({
      id: 'shape_empty_foodlog',
      group: 'shape',
      label: 'Final meal JSON must contain dishes',
      expected: 'itemsBreakdown',
      actual: 'empty',
      pass: false,
    });
  }

  if (foodItems.length > 0 || scoutItems.length > 0 || pipelineLooksComplete(log)) {
    const compile = compileGoldenMeal({
      logText: log,
      foodLog: input.foodLog,
      scout: input.scout,
    });
    const missingLogBooks = (compile.books || []).filter(
      (b) => b.kcal == null && (b.id === 'foundation' || b.id === 'reconcile' || b.id === 'dietitian_payload')
    );
    const drift = (compile.imbalances || [])[0];
    add({
      id: 'math_trial_balance',
      group: 'math',
      label:
        compile.compiler === 'green'
          ? 'Trial balance books agree'
          : missingLogBooks.length
            ? `Trial balance incomplete (${missingLogBooks.map((b) => b.id).join(', ')} not in log)`
            : `Trial balance drifted: ${drift?.label || 'books disagree'}`,
      expected: 'foundation, reconcile, dietitian payload, and saved table present and agree',
      actual: (compile.books || []).map((b) => `${b.id}=${b.kcal ?? '—'}`).join(', '),
      pass: compile.compiler === 'green',
      signature: 'trial_balance',
    });
  }

  return inv;
}

export function buildTransportInvariants(input: {
  logText?: string;
  errorText?: string;
  jobStatus?: string;
}): GoldenInvariant[] {
  const log = String(input.logText || '');
  const errorText = sanitizeJobErrorText(input.errorText || '', log, input.jobStatus);
  const blob = `${log}\n${errorText}`;
  const inv: GoldenInvariant[] = [];
  const add = (row: GoldenInvariant) => inv.push(row);

  // A finished meal's leftover stall / scout-fail must not look like a death.
  if (pipelineLooksComplete(log) || jobLooksSucceeded(input.jobStatus)) {
    return inv;
  }

  const scoutAttempts = [...blob.matchAll(/\[Vision Scout Attempt (\d+) Failed\]/g)].map((m) => Number(m[1]));
  const lastScoutAttempt = scoutAttempts.length ? Math.max(...scoutAttempts) : 0;
  const isQuota =
    /RESOURCE_EXHAUSTED|quota exceeded|GenerateRequestsPerMinute|429/i.test(blob) &&
    /quota|rate|RESOURCE_EXHAUSTED|exceeded your current quota/i.test(blob);
  const isUnavailable = /\b503\b|UNAVAILABLE|overloaded/i.test(blob) && !isQuota;
  const scoutWrappedImage =
    /Couldn't reliably read this image/i.test(blob) && (isQuota || isUnavailable || /429|503/.test(blob));
  const scoutDead = /Vision Scout Failed Permanently|Vision Scout Failed:/i.test(blob);
  const dietitianDead = /Dietitian Failed Permanently/i.test(blob);
  const offline = /Failed to fetch|navigator\.onLine|ERR_INTERNET_DISCONNECTED|NetworkError/i.test(blob);
  const aborted = /AbortError|browser closed|client disconnected/i.test(blob);
  const timedOut = /timed out after 150|timed out after 180|AbortError.*timeout|ETIMEDOUT/i.test(blob);
  const stalled = STALE_STALL_RE.test(blob);

  const model =
    (blob.match(/model:\s*"?(gemini-[a-z0-9.-]+)"?/i) || blob.match(/model:\s*(gemini-[a-z0-9.-]+)/i) || [])[1] ||
    (isQuota && /flash-lite/i.test(blob) ? 'gemini-3.5-flash-lite' : null);
  const retryAfter = (blob.match(/retry in ([\d.]+)\s*s/i) || blob.match(/retryDelay":\s*"(\d+)s"/i) || [])[1];
  const agent = scoutDead || /\[Vision Scout/i.test(blob) ? 'Vision Scout' : dietitianDead ? 'Dietitian' : /\[Curator/i.test(blob) ? 'Food Resolver / Curator' : null;

  if (scoutDead || isQuota || isUnavailable || offline || aborted || timedOut || stalled || scoutWrappedImage) {
    add({
      id: 'tr_stage_died',
      group: 'transport',
      label: `Died at ${agent || 'Vision Scout'}${model ? ` (${model})` : ''}`,
      expected: 'stage completes',
      actual: isQuota
        ? `QUOTA 429${retryAfter ? ` — Google said retry in ${retryAfter}s` : ''}`
        : stalled
          ? 'Scout silent 90s (quota/overload hang, not a bad photo)'
          : isUnavailable
            ? '503 UNAVAILABLE'
            : offline
              ? 'offline / Failed to fetch'
              : timedOut
                ? 'client/server timeout'
                : aborted
                  ? 'aborted / tab closed'
                  : 'agent failed',
      pass: false,
      signature: isQuota ? 'RESOURCE_EXHAUSTED' : agent || 'transport',
    });
  }

  if (isQuota) {
    add({
      id: 'tr_quota_429',
      group: 'transport',
      label: 'Gemini free-tier quota — not a bad photo, not Wi-Fi',
      expected: 'under RPM or different model',
      actual: `${model || 'gemini'} 429${retryAfter ? ` retry-after ${retryAfter}s` : ''}`,
      pass: false,
      signature: 'RESOURCE_EXHAUSTED',
    });
  }

  if (scoutWrappedImage) {
    add({
      id: 'tr_misleading_image_wrap',
      group: 'transport',
      label: 'Do not wrap quota/503 as “couldn’t read this image”',
      expected: 'surface 429/503 honestly',
      actual: 'Vision Scout Failed: Couldn\'t reliably read this image',
      pass: false,
      signature: "Couldn't reliably read this image",
    });
  }

  if (lastScoutAttempt >= 3 && (isQuota || /Waiting 3000ms before retry/i.test(blob))) {
    add({
      id: 'tr_retry_storm',
      group: 'transport',
      label: 'Scout retried faster than Retry-After (burns the same 15/min)',
      expected: 'wait ≥ Retry-After, then one retry',
      actual: `${lastScoutAttempt} scout attempts, 3s apart`,
      pass: false,
      signature: 'Retrying LLM call',
    });
  }

  if (dietitianDead && !scoutDead) {
    add({
      id: 'tr_dietitian_dead',
      group: 'transport',
      label: 'Dietitian agent failed',
      expected: 'dietitian completes',
      actual: 'Dietitian Failed Permanently',
      pass: false,
      signature: 'Dietitian Failed Permanently',
    });
  }

  return inv;
}

export function evaluateJourneyBoard(input: {
  logText?: string;
  foodLog?: any;
  scout?: any;
  errorText?: string;
  jobStatus?: string;
}): {
  journey: GoldenJourneyRow[];
  invariants: GoldenInvariant[];
} {
  const errorText = sanitizeJobErrorText(input.errorText || '', input.logText || '', input.jobStatus);
  const journey = buildJourney(input);
  const ledgerInv = ledgerImbalancesToInvariants(
    detectLedgerImbalances({ logText: input.logText, foodLog: input.foodLog, scout: input.scout })
  );
  const invariants = [
    ...buildTransportInvariants({ ...input, errorText }),
    ...buildAutoInvariants({ ...input, journey }),
    ...ledgerInv,
  ];
  return { journey, invariants };
}
