/**
 * Edit-intent classification + destructive-edit filtering.
 *
 * Live failure (job_1791044439374_4x4srekyi, 2026-10-03): the user typed
 * "This is incorrect check again" on a saved meal holding one item. The edit
 * prompt only offers replace|add|delete, the vision model picked `delete`, and
 * the pipeline applied it — emptying the meal, then attaching the empty meal as
 * `savable: true` with a "good" verdict.
 *
 * This module owns the RECHECK class: dissatisfaction with the analysis and no
 * explicit mutation request. The correct response is a fresh full read of the
 * photos, so any whole-dish removal the model invented on such a turn is
 * dropped before it can reach the executor. The companion "never ship an empty
 * meal" guard lives in server_meal_edit.ts (post-apply, on the real result).
 *
 * Pure TS, no I/O (L12: math lives here, not in the prompt).
 */

/** Explicit numeric weight/portion/count instruction. */
const WEIGHT_INTENT_RE =
  /\d+(\.\d+)?\s*(g\b|gr\b|grams?\b|ml\b|mls?\b|kg\b|oz\b|ounces?\b|lb\b|lbs\b|slice|pieces?|cups?|tbsp|tsp|servings?|packs?|cans?|bottles?|x\b|×)/i;

/** Verbs that explicitly ask for a mutation. Presence of any defeats RECHECK. */
const EXPLICIT_MUTATION_RE = new RegExp(
  [
    '\\b(remove|delete|drop|take\\s*out|take\\s*off|exclude|omit|eliminate|get\\s*rid\\s*of)',
    '\\b(add|include|put\\s*in|throw\\s*in|also\\s+(had|ate|drank))',
    '\\b(replace|swap|substitute|switch|change)',
    '\\b(only\\s+had|just\\s+had|nothing\\s+but)',
    "\\b(didn't\\s*(have|eat|drink)|did\\s*not\\s*(have|eat|drank)|no\\s+more|without)",
    '\\b(update|set|make\\s+it|scale|adjust|double|halve|half|reduce|increase|less|more)\\b',
  ].join('|'),
  'i'
);

/** Dissatisfaction with the result, or an explicit request to redo the read. */
const RECHECK_RE = new RegExp(
  [
    '\\b(incorrect|wrong|not\\s+right|not\\s+correct|mistake|error)',
    '\\b(off|miscalculated|mis-?calculated|under-?counted|over-?counted|miscalc)',
    '\\b(check|recheck|re-?check|verify|double\\s*check|look\\s*again|read\\s*again|scan\\s*again|go\\s*again)',
    '\\b(re-?analy[sz]e|redo|re-?do|try\\s*again|do\\s*it\\s+again|start\\s+over|one\\s+more\\s+time)',
    "\\b(doesn'?t\\s+(match|look\\s+right|seem\\s+right)|not\\s+what\\s+i|missing|missed|didn'?t\\s+(catch|get|see)|you\\s+(missed|got\\s+it\\s+wrong))",
    '\\b(why\\s+is|how\\s+come)\\b.*\\b(zero|nothing|empty)\\b',
  ].join('|'),
  'i'
);

/**
 * Actions that remove a whole dish. These are the dialects the model reaches for
 * when it has nothing better to do — including the scout's own `action: "delete"`
 * dish verb, which the edit diff turns into `remove_item`. Partial edits
 * (`remove_component`, a `split_item` with content) leave something behind and
 * are not treated as destructive here.
 */
const DESTRUCTIVE_ACTIONS = new Set(['remove_item', 'delete', 'remove', 'drop_dish', 'drop_item']);

export type EditIntentKind = 'recheck' | 'targeted' | 'none';

export interface EditIntent {
  kind: EditIntentKind;
  reason: string;
  /** True when the message names an item that exists in the meal. */
  namesTarget: boolean;
}

function itemNameBlob(it: any): string {
  const parts: string[] = [];
  const push = (v: any) => {
    if (typeof v === 'string' && v.trim()) parts.push(v.trim().toLowerCase());
  };
  push(it?.name);
  push(it?.canonicalDbName);
  push(it?.originalName);
  push(it?.keyword);
  for (const c of Array.isArray(it?.components) ? it.components : []) {
    push(c?.foodName);
    push(c?.name);
    push(c?.keyword);
  }
  for (const c of Array.isArray(it?.componentsDetailList) ? it.componentsDetailList : []) {
    push(c?.foodName);
    push(c?.name);
  }
  return parts.join(' ');
}

const GENERIC_NAME_TOKENS = new Set(['meal', 'food', 'item', 'dish', 'snack']);

function namesExistingItem(message: string, items: any[]): boolean {
  const msg = String(message || '').toLowerCase();
  if (!msg) return false;
  for (const it of Array.isArray(items) ? items : []) {
    for (const token of itemNameBlob(it).split(/[^a-z0-9]+/)) {
      if (token.length < 4) continue;
      if (GENERIC_NAME_TOKENS.has(token)) continue;
      if (msg.includes(token)) return true;
    }
  }
  return false;
}

/**
 * Classify a free-text follow-up on an existing meal.
 *
 * RECHECK only when the message expresses dissatisfaction/re-verification AND
 * asks for no explicit mutation. An explicit verb ("remove the beer", "only had
 * the rice", "make it 300g") always wins, so targeted edits are never rerouted.
 */
export function classifyEditIntent(args: { userMessage?: string | null; items?: any[] }): EditIntent {
  const msg = String(args?.userMessage || '').trim();
  const items = Array.isArray(args?.items) ? args.items : [];
  if (!msg) return { kind: 'none', reason: 'empty message', namesTarget: false };

  const namesTarget = namesExistingItem(msg, items);
  const hasExplicitMutation = EXPLICIT_MUTATION_RE.test(msg) || WEIGHT_INTENT_RE.test(msg);

  if (hasExplicitMutation) {
    return {
      kind: 'targeted',
      reason: namesTarget ? 'explicit mutation naming an item' : 'explicit mutation',
      namesTarget,
    };
  }
  if (RECHECK_RE.test(msg)) {
    return {
      kind: 'recheck',
      reason: namesTarget
        ? 'dissatisfaction naming an item but no explicit mutation'
        : 'dissatisfaction without a named target',
      namesTarget,
    };
  }
  return { kind: 'none', reason: 'no edit or recheck signal', namesTarget };
}

/**
 * Split off the whole-dish removals from a command list. Used to drop a
 * hallucinated delete on a RECHECK turn while keeping legitimate corrections
 * (set_weight / replace_identity / add_item) from the same diff.
 */
export function partitionDestructiveCommands(commands: any[]): { safe: any[]; destructive: any[] } {
  const safe: any[] = [];
  const destructive: any[] = [];
  for (const c of Array.isArray(commands) ? commands : []) {
    const a = String(c?.action || '').toLowerCase();
    if (DESTRUCTIVE_ACTIONS.has(a)) destructive.push(c);
    else safe.push(c);
  }
  return { safe, destructive };
}

/** One-line reason for the debug trail when a destructive command is dropped. */
export function describeDroppedCommand(command: any): string {
  const a = String(command?.action || '').toLowerCase();
  const t = command?.itemName || command?.targetItemName || command?.replacesDish || '(no target)';
  return `recheck guard: dropped "${a}" on "${t}" — a re-analysis request is never a deletion`;
}
