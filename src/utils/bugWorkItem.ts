/**
 * Q-6 work item: one card for snap / auto / golden.
 * NOW = Bug field + remaining + current evidence + ALL burns.
 * Commits = loop history. Agent iteration ≠ a new food/medical job.
 */

import { isHumanCheckLine } from './bugTapeReview';

export const BURN_BUDGET = 2;

export type BugQueueStatus = 'ready' | 'in_progress' | 'blocked' | 'done';

export type BugAttempt = {
  at: string;
  actor: string;
  hyp: string;
  file: string;
  test: string;
  result: string;
  burned: boolean;
  note?: string;
  /** Exact remaining-line text this attempt was for. */
  line?: string;
  /** Fix committed + deployed (moves card to verifying when no verify yet). */
  applied?: boolean;
};

export type RemainingLinePhoto = {
  text: string;
  comment?: string;
  photo_urls?: string[];
  source?: string;
};

export type BugEvidence = {
  job_id?: string | null;
  report_id?: string | null;
  debug_url?: string | null;
  photo_urls?: string[];
  r2_prefix?: string | null;
  browser_log?: string | null;
  last_actions?: string | null;
  error_status?: string | null;
  hold?: boolean;
  scout_url?: string | null;
  fixture_query?: string | null;
  expected_dishes?: string[];
  /** Per remaining-line pins. Card-level photo_urls stay. */
  line_photos?: RemainingLinePhoto[];
};

export type BugCommit = {
  id: string;
  at: string;
  actor: string;
  kind: 'snap' | 'auto' | 'agent' | 'retest' | 'note';
  summary: string;
  evidence?: BugEvidence | null;
  attempt?: BugAttempt | null;
};

export type BugSurface = 'food' | 'home' | 'health' | 'other';
export type BugSource = 'web_snap' | 'tg_qa' | 'auto_file' | 'golden_red' | 'human';
export type BugAssignee =
  | 'bug_ticket'
  | 'qa_meal'
  | 'qa_biomarker'
  | 'qa_onboarding'
  | 'orchestrator'
  | 'human';

export type BugDefect = {
  component: string;
  observed: string;
  expected: string;
  criteria: string;
};

export type BugReproStatus = 'not_needed' | 'needed' | 'confirmed' | 'failed' | 'ambiguous';

export type BugRepro = {
  status: BugReproStatus;
  command?: string;
  params?: Record<string, unknown>;
  run_log?: string;
  before?: string;
  after?: string;
  expected?: string;
  actual?: string;
  exit_code?: number;
  by?: string;
  at?: string;
};

export type BugPlan = {
  hypothesis: string;
  files: string[];
  approach?: string;
  gates: string[];
  risks?: string[];
  blocked_by?: string[];
  by?: string;
  at?: string;
};

export type BugVerify = {
  method: 'named_test' | 'journey' | 'manual';
  command: string;
  result: 'green' | 'red';
  evidence: string[];
  by?: string;
  at?: string;
};

export type BugReplyTo = {
  chat_id?: string | number;
  thread_id?: string | number;
  profile?: string;
};

export type BugCurationEvent = {
  id: string;
  at: string;
  actor: string;
  op: 'review' | 'edit' | 'rewrite' | 'handoff' | 'archive' | 'supersede';
  reason: string;
  from_revision: number;
  to_revision: number;
  before_hash: string;
  after_hash: string;
};

export type BugHandoff = {
  from: 'bug_ticket';
  to: 'orchestrator';
  revision: number;
  at: string;
  packet_hash: string;
  status: 'ready' | 'consumed' | 'invalidated';
};

export type BugWorkItem = {
  public_n: number;
  bug: string;
  class?: string;
  fingerprint?: string;
  occurrences: number;
  queue: BugQueueStatus;
  remaining: string[];
  parked: string[];
  done: string[];
  burns: BugAttempt[];
  commits: BugCommit[];
  current_evidence: BugEvidence | null;
  hold_refs: string[];
  unmatched?: boolean;
  /** Stable Checks roster for this card. Replay only flips pass/fail. */
  checks?: PinnedTapeCheck[];
  /** V-30.1 ticket fields — all optional so old cards hydrate unchanged. */
  surface?: BugSurface;
  source?: BugSource;
  idem_key?: string;
  defect?: BugDefect;
  repro?: BugRepro;
  /** BOT-21: Multi-verdict history on a card (evaluated by evaluateReproVerdicts). */
  repro_verdicts?: BugRepro[];
  plan?: BugPlan;
  verify?: BugVerify;
  assignee?: BugAssignee;
  reply_to?: BugReplyTo;
  blocked_by?: string[];
  duplicate_of?: string;
  blocked_reason?: string;
  revision?: number;
  curation_events?: BugCurationEvent[];
  handoff?: BugHandoff;
  archived_at?: string;
  archive_reason?: string;
  /** Derived S-C-lite state (projected by bugState(); never agent-set). */
  state?: string;
};

export type PinnedTapeCheck = {
  id: string;
  label: string;
  pass: boolean;
  group?: string;
  status?: string;
};

export const CLASS_SEVERITY: Record<string, number> = {
  APPLY_MISS: 10,
  DISH_DROP: 20,
  FALSE_FRIEND: 30,
  OPENING_WRONG: 40,
  SILENT_REPAIR: 50,
  CALL_BUDGET: 60,
  INFRA_LATENCY: 65,
  F_1: 70,
  IDENTITY_FALSE_FRIEND: 80,
  CLONE_UI: 90,
  UNMATCHED: 900,
};

export function emptyWorkItem(partial?: Partial<BugWorkItem>): BugWorkItem {
  return {
    public_n: 0,
    bug: '',
    occurrences: 1,
    queue: 'ready',
    remaining: [],
    parked: [],
    done: [],
    burns: [],
    commits: [],
    current_evidence: null,
    hold_refs: [],
    unmatched: false,
    checks: [],
    ...partial,
  };
}

/** Snap note / title → Bug field. Never wipe an existing Bug string. */
export function prefillBug(existing: string | undefined, snapText: string): string {
  const cur = (existing || '').trim();
  if (cur) return cur;
  return String(snapText || '').trim();
}

/** ISO week key so 5 meals in one week merge; next week is a new fingerprint. */
export function isoWeekKey(at?: string | Date): string {
  const d = at ? new Date(at) : new Date();
  if (Number.isNaN(d.getTime())) return 'unknown';
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function fingerprint(cls: string, queryOrKey: string, at?: string | Date): string {
  const c = String(cls || 'other').trim().toUpperCase().replace(/\s+/g, '_');
  const q = String(queryOrKey || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 80);
  return `${c}|${q || 'unknown'}|${isoWeekKey(at)}`;
}

export function isBurned(burns: BugAttempt[], hyp: string, file: string, test: string): boolean {
  const h = norm(hyp);
  const f = norm(file);
  const t = norm(test);
  return (burns || []).some((b) => {
    if (!b.burned) return false;
    if (h && norm(b.hyp) === h) return true;
    if (f && t && norm(b.file) === f && norm(b.test) === t) return true;
    return false;
  });
}

function norm(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function hydrateWorkItem(tag: any): BugWorkItem {
  const raw = tag?.work_item;
  const parsed: Partial<BugWorkItem> =
    raw && typeof raw === 'object' ? raw : typeof raw === 'string' ? safeJson(raw) : {};
  const bug = prefillBug(parsed.bug, tag?.bug_text || tag?.identified_problems || tag?.title || '');
  const status = mapLegacyStatus(tag?.status, parsed.queue);
  return emptyWorkItem({
    ...parsed,
    public_n: Number(parsed.public_n || tag?.public_n || 0),
    bug,
    queue: status,
    occurrences: Number(parsed.occurrences || tag?.linked_count || 1) || 1,
    burns: Array.isArray(parsed.burns) ? parsed.burns : [],
    commits: Array.isArray(parsed.commits) ? parsed.commits : [],
    remaining: Array.isArray(parsed.remaining) ? parsed.remaining.map(String) : [],
    done: Array.isArray(parsed.done) ? parsed.done.map(String) : [],
    parked: Array.isArray(parsed.parked) ? parsed.parked.map(String) : [],
    checks: Array.isArray(parsed.checks) ? parsed.checks : [],
    repro_verdicts: Array.isArray(parsed.repro_verdicts)
      ? parsed.repro_verdicts
      : Array.isArray(tag?.repro_verdicts)
        ? tag.repro_verdicts
        : undefined,
  });
}

/** Legacy queue projection — input to bugState() (V-30.1: exported, not replaced). */
export function mapLegacyStatus(legacy?: string, queue?: BugQueueStatus): BugQueueStatus {
  // Green tick writes status=fixed. That wins over a stale work_item.queue of ready.
  if (legacy === 'fixed' || legacy === 'ignored') return 'done';
  if (queue === 'blocked' || queue === 'done' || queue === 'in_progress' || queue === 'ready') return queue;
  if (legacy === 'in_progress') return 'in_progress';
  return 'ready';
}

function safeJson(s: string): Partial<BugWorkItem> {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

export function getLastActionedDate(tag: any, hydrate: (t: any) => BugWorkItem = hydrateWorkItem as any): Date | null {
  if (!tag) return null;
  const item = hydrate(tag);
  let maxTime = 0;

  const datesToCheck: (string | number | undefined | null)[] = [
    tag?.updated_at,
    tag?.created_at,
    tag?.last_commit?.at,
    tag?.updatedAt,
    tag?.createdAt,
  ];

  if (Array.isArray(item.commits)) {
    for (const c of item.commits) {
      if (c?.at) datesToCheck.push(c.at);
      if (c?.attempt?.at) datesToCheck.push(c.attempt.at);
    }
  }

  if (Array.isArray(item.burns)) {
    for (const b of item.burns) {
      if (b?.at) datesToCheck.push(b.at);
    }
  }

  if (Array.isArray(tag?.commits)) {
    for (const c of tag.commits) {
      if (c?.at) datesToCheck.push(c.at);
      if (c?.attempt?.at) datesToCheck.push(c.attempt.at);
    }
  }

  for (const d of datesToCheck) {
    if (!d) continue;
    const t = new Date(d).getTime();
    if (!isNaN(t) && t > maxTime) {
      maxTime = t;
    }
  }

  return maxTime > 0 ? new Date(maxTime) : null;
}

export function sortByLastActioned<T>(
  tags: T[],
  hydrate: (t: T) => BugWorkItem = hydrateWorkItem as any
): T[] {
  return [...tags].sort((a, b) => {
    const da = getLastActionedDate(a, hydrate)?.getTime() || 0;
    const db = getLastActionedDate(b, hydrate)?.getTime() || 0;
    return db - da; // Descending: newest / most recently actioned first
  });
}

export function formatLastActioned(date: Date | null): string {
  if (!date) return 'No actions';

  const now = new Date();
  const diffMs = Math.max(0, now.getTime() - date.getTime());
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  let relative = '';
  if (diffMins < 1) relative = 'just now';
  else if (diffMins < 60) relative = `${diffMins}m ago`;
  else if (diffHours < 24) relative = `${diffHours}h ago`;
  else relative = `${diffDays}d ago`;

  const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const timeStr = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });

  return `${relative} (${dateStr} ${timeStr})`;
}

export function sortReadyQueue<T extends { created_at?: string }>(
  tags: T[],
  hydrate: (t: T) => BugWorkItem = hydrateWorkItem as any
): T[] {
  const ready = tags.filter((t) => hydrate(t).queue === 'ready');
  return ready.sort((a, b) => {
    const wa = hydrate(a);
    const wb = hydrate(b);
    if (wb.occurrences !== wa.occurrences) return wb.occurrences - wa.occurrences;
    const sa = CLASS_SEVERITY[wa.class || ''] ?? 500;
    const sb = CLASS_SEVERITY[wb.class || ''] ?? 500;
    if (sa !== sb) return sa - sb;
    return String(a.created_at || '').localeCompare(String(b.created_at || ''));
  });
}

/** Current card: in-progress with remaining, else first ready. `work bug`. */
export function pickContinueTag<T extends { created_at?: string }>(
  tags: T[],
  hydrate: (t: T) => BugWorkItem = hydrateWorkItem as any
): T | null {
  const working = (tags || [])
    .map((t) => ({ t, w: hydrate(t) }))
    .filter((row) => row.w.queue === 'in_progress' && row.w.remaining.length > 0);
  if (working.length) {
    working.sort((a, b) => {
      const at = lastCommit(a.w)?.at || '';
      const bt = lastCommit(b.w)?.at || '';
      return bt.localeCompare(at);
    });
    return working[0].t;
  }
  return sortReadyQueue(tags, hydrate)[0] || null;
}

/** Named card: `work 11` / `work #11`. */
export function pickTagByPublicN<T>(
  tags: T[],
  n: number,
  hydrate: (t: T) => BugWorkItem = hydrateWorkItem as any
): T | null {
  const want = Number(n);
  if (!want) return null;
  const hit = (tags || []).find((t) => hydrate(t).public_n === want);
  return hit || null;
}

/** Following card, not the current in-progress one. `next bug`. */
export function pickNextOtherTag<T extends { created_at?: string }>(
  tags: T[],
  hydrate: (t: T) => BugWorkItem = hydrateWorkItem as any
): T | null {
  const current = pickContinueTag(tags, hydrate);
  const ready = sortReadyQueue(tags, hydrate);
  if (current) {
    const curId = (current as { id?: string }).id;
    const other = ready.find((t) => (t as { id?: string }).id !== curId);
    return other || null;
  }
  return ready[0] || null;
}

export function pickQueueTag<T extends { created_at?: string }>(
  tags: T[],
  opts: { mode?: string | null; n?: string | number | null } = {},
  hydrate: (t: T) => BugWorkItem = hydrateWorkItem as any
): T | null {
  const n = Number(opts.n);
  if (n > 0) return pickTagByPublicN(tags, n, hydrate);
  if (String(opts.mode || '').toLowerCase() === 'next') return pickNextOtherTag(tags, hydrate);
  return pickContinueTag(tags, hydrate);
}

export function publicId(item: BugWorkItem, tagId?: string): string {
  if (item.public_n > 0) return `#${item.public_n}`;
  return `#${String(tagId || 'bug').slice(0, 8)}`;
}

export function assignPublicN(item: BugWorkItem, used: number[]): BugWorkItem {
  if (item.public_n > 0) return item;
  const max = used.reduce((m, n) => Math.max(m, n), 0);
  return { ...item, public_n: max + 1 };
}

/** Oldest unnumbered cards get the next integers. Existing #n are never reused. */
export function assignMissingPublicNs(tags: any[]): Array<{ id: string; item: BugWorkItem }> {
  const used = (tags || []).map((t) => hydrateWorkItem(t).public_n).filter((n) => n > 0);
  const need = (tags || [])
    .filter((t) => t?.id && !hydrateWorkItem(t).public_n)
    .slice()
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  const acc = [...used];
  const out: Array<{ id: string; item: BugWorkItem }> = [];
  for (const t of need) {
    const item = assignPublicN(hydrateWorkItem(t), acc);
    acc.push(item.public_n);
    out.push({ id: t.id, item });
  }
  return out;
}

export function lastCommit(item: BugWorkItem): BugCommit | null {
  const list = item.commits || [];
  return list.length ? list[list.length - 1] : null;
}

export function matchRemainingLine(remaining: string[], line?: string | null): string | null {
  const n = norm(line || '');
  if (!n) return null;
  const list = remaining || [];
  const exact = list.find((r) => norm(r) === n);
  if (exact) return exact;
  const hits = list.filter((r) => norm(r).includes(n) || n.includes(norm(r)));
  return hits.length === 1 ? hits[0] : null;
}

export function inferLineClass(text: string, fallback?: string): string {
  const s = String(text || '').toLowerCase();
  if (/curator|pick_existing|quarantine/.test(s)) return 'OPENING_WRONG';
  if (/collision|sibling|171711|same (canonical )?id|berries share/.test(s)) return 'FALSE_FRIEND';
  if (/fallback|gherkin|skew|kcal\/?100/.test(s)) return 'FALSE_FRIEND';
  if (/drop|red onion|missing from components|component drop/.test(s)) return 'DISH_DROP';
  if (/micro|zeros|micronutrient/.test(s)) return 'OPENING_WRONG';
  const fb = String(fallback || '').trim();
  return fb || 'FALSE_FRIEND';
}

export function fileHintForLine(text: string, cls: string): string {
  const s = String(text || '').toLowerCase();
  if (/curator|pick_existing|quarantine/.test(s)) return 'agents/foodResolverInstructions.ts';
  if (/collision|sibling|berry|171711/.test(s)) return 'server_food_db.ts (lookupCanonicalBaseFood only)';
  if (/gherkin|fallback|skew/.test(s)) return 'server_food_catalog.ts';
  if (/onion|drop|garnish/.test(s)) return 'server_vision_scout.ts';
  if (/micro|zeros/.test(s)) return 'server_nutrient_aggregation.ts';
  if (cls === 'DISH_DROP') return 'server_vision_scout.ts';
  if (cls === 'OPENING_WRONG') return 'agents/foodResolverInstructions.ts';
  return 'one file at the broken layer — not CANONICAL_BASE_FOODS includes()';
}

const PAINT_PASS_RE =
  /food_aliases|expected\.json|\/loop|canonical_mixed_berries|mixed_fruit_cup_canonical|cobb_salad_canonical|populated micronutrient|enrich(?:ed)? canonical|lookupcanonicalbasefood includes|canonical_base_foods includes/i;

/** Honor-system `result=pass` is how picnic lines got painted. Refuse before remaining moves. */
export function rejectAttemptPass(
  attempt: {
    hyp: string;
    file: string;
    test: string;
    result: string;
    burned?: boolean;
    note?: string;
    line?: string;
  },
  item: BugWorkItem
): string | null {
  if (attempt.burned) return null;
  if (!/green|pass/i.test(String(attempt.result || ''))) return null;
  const test = String(attempt.test || '').trim();
  if (!test) return 'weak_test';
  if (/^[\w./-]+\.test\.(ts|tsx|js)$/i.test(test)) return 'weak_test';
  if (PAINT_PASS_RE.test(`${attempt.hyp || ''} ${attempt.note || ''} ${attempt.file || ''} ${test}`)) {
    return 'paint';
  }
  const corpus = [...(item.remaining || []), ...(item.done || []), attempt.line || ''].join(' ');
  const fdcs = test.match(/\b\d{5,8}\b/g) || [];
  if (fdcs.some((n) => corpus.includes(n))) return 'paint_fdc';
  const matched = matchRemainingLine(item.remaining, attempt.line);
  if (matched) {
    const hinted = fileHintForLine(matched, inferLineClass(matched, item.class)).match(
      /([\w.-]+\.(?:ts|tsx|js|mjs))/
    );
    const file = String(attempt.file || '');
    if (hinted && file && !file.includes(hinted[1])) return 'wrong_file';
  }
  return null;
}

function attemptTouchesLine(attempt: BugAttempt, line: string): boolean {
  if (!attempt?.line) return false;
  return !!matchRemainingLine([line], attempt.line);
}

function isLineStrike(attempt: BugAttempt): boolean {
  return !!attempt.burned || /^refused:/.test(String(attempt.result || ''));
}

export function lineStrikeCount(
  item: BugWorkItem,
  line: string,
  extra?: BugAttempt
): number {
  const rows: BugAttempt[] = [];
  for (const b of item.burns || []) {
    if (attemptTouchesLine(b, line)) rows.push(b);
  }
  for (const c of item.commits || []) {
    const a = c?.attempt;
    if (!a || !attemptTouchesLine(a, line)) continue;
    if (!rows.some((r) => r.hyp === a.hyp && r.file === a.file && r.test === a.test && r.at === a.at)) {
      rows.push(a);
    }
  }
  if (extra && attemptTouchesLine(extra, line)) rows.push(extra);
  return rows.filter(isLineStrike).length;
}

export const DRAIN_CARD_INSTRUCTION =
  'Drain automatic tape checks on this card. Work continue.active_line only (one class, one file, named vitest on a NEW food). POST /attempts then GET /api/bugs/next — remaining is re-scored from the tape, not from claimed pass. If continue.stop=false, immediately work the new active_line. After class tests, POST /api/bugs/<tag_id>/reanalyze (catalog restage then one skipScout; same card). stop=true means auto checks are green or blocked: human review only. Two misses park that line. Do not work visual/UI remaining (human).';

export function applyAttempt(
  item: BugWorkItem,
  attempt: {
    at?: string;
    actor?: string;
    hyp: string;
    file: string;
    test: string;
    result: string;
    burned?: boolean;
    note?: string;
    line?: string;
  }
): { item: BugWorkItem; rejected?: string; advanced_line?: string | null; parked_line?: string | null } {
  if (item.queue === 'done') return { item, rejected: 'card_done' };
  if (isBurned(item.burns, attempt.hyp, attempt.file, attempt.test)) {
    return { item, rejected: 'already_burned' };
  }
  const paint = rejectAttemptPass(attempt, item);
  const remainingBefore = item.remaining.slice();
  const matched = matchRemainingLine(remainingBefore, attempt.line);
  const passed = !paint && !attempt.burned && /green|pass/.test(String(attempt.result));
  let strikeLine = matched;
  if (!strikeLine && !passed && remainingBefore.length === 1) strikeLine = remainingBefore[0];
  const row: BugAttempt = {
    at: attempt.at || new Date().toISOString(),
    actor: attempt.actor || 'agent',
    hyp: attempt.hyp,
    file: attempt.file,
    test: attempt.test,
    result: paint ? `refused:${paint}` : attempt.result,
    burned: !!attempt.burned,
    note: attempt.note,
    line: attempt.line ? String(attempt.line) : strikeLine || undefined,
  };
  const burns = row.burned ? [...item.burns, row] : item.burns;
  let remaining = remainingBefore;
  let done = item.done.slice();
  let parked = item.parked.slice();
  let parked_line: string | null = null;
  if (matched && passed) {
    remaining = remainingBefore.filter((r) => r !== matched);
    if (!done.some((d) => norm(d) === norm(matched))) done.push(matched);
  } else if (strikeLine && !passed && lineStrikeCount(item, strikeLine, row) >= BURN_BUDGET) {
    remaining = remainingBefore.filter((r) => r !== strikeLine);
    if (!parked.some((p) => norm(p) === norm(strikeLine))) parked.push(strikeLine);
    parked_line = strikeLine;
  }
  const commit: BugCommit = {
    id: `c${item.commits.length + 1}`,
    at: row.at,
    actor: row.actor,
    kind: 'agent',
    summary: parked_line
      ? `parked: ${parked_line}`
      : paint
        ? `refused ${paint}: ${matched || row.hyp}`
        : row.burned
          ? `burn: ${row.hyp}`
          : matched && passed
            ? `done: ${matched}`
            : `attempt: ${row.hyp}`,
    evidence: item.current_evidence,
    attempt: row,
  };
  let queue: BugQueueStatus = item.queue;
  if (passed && remainingBefore.length === 0) queue = 'done';
  else if (queue !== 'blocked') queue = 'in_progress';
  return {
    item: {
      ...item,
      remaining,
      done,
      parked,
      burns,
      commits: [...item.commits, commit],
      queue,
    },
    rejected: paint || undefined,
    advanced_line: matched && passed ? matched : null,
    parked_line,
  };
}

/** Merge snap remaining texts + per-line photo pointers. Remaining stays string[]. */
export function applySnapRemaining(
  item: BugWorkItem,
  opts: { remaining?: string[]; remaining_lines?: RemainingLinePhoto[]; symptom?: string }
): BugWorkItem {
  const incoming = (opts.remaining || []).map((s) => String(s).trim()).filter(Boolean);
  let remaining = item.remaining.slice();
  if (incoming.length) {
    for (const r of incoming) {
      if (!remaining.some((x) => x.toLowerCase() === r.toLowerCase())) remaining.push(r);
    }
  } else if (!remaining.length && opts.symptom) {
    remaining = [String(opts.symptom).slice(0, 300)];
  }
  const lines = (opts.remaining_lines || [])
    .map((l) => ({
      text: String(l?.text || '').trim(),
      comment: l?.comment ? String(l.comment) : undefined,
      photo_urls: Array.isArray(l?.photo_urls) ? l.photo_urls.map(String).filter(Boolean) : [],
      source: l?.source ? String(l.source) : undefined,
    }))
    .filter((l) => l.text);
  let evidence = item.current_evidence;
  if (lines.length) {
    evidence = {
      ...(evidence || {}),
      line_photos: [...(evidence?.line_photos || []), ...lines],
    };
  }

  const checks = (item.checks || []).slice();
  for (const r of remaining) {
    if (!checks.some((c) => remainingOverlap(c.label, r))) {
      checks.push({
        id: `user_${norm(r).slice(0, 32).replace(/\s+/g, '_')}`,
        label: r,
        pass: false,
        status: 'fail',
        group: 'user',
      });
    }
  }

  return { ...item, remaining, checks, current_evidence: evidence };
}

function remainingOverlap(a: string, b: string): boolean {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 12 && nb.includes(na)) return true;
  if (nb.length >= 12 && na.includes(nb)) return true;
  return false;
}

/** Honor-system Done is not meal-green. Tape auto-spot remaining comes back; matching Done rows move with it. */
export function restoreRemainingFromAutoSpot(
  item: BugWorkItem,
  hits: Array<{ text?: string; parked?: boolean }>
): BugWorkItem {
  const texts = (hits || [])
    .filter((h) => h && !h.parked && String(h.text || '').trim() && !/scouted only/i.test(String(h.text)))
    .map((h) => String(h.text).trim());
  if (!texts.length) return item;
  let remaining = item.remaining.slice();
  let done = item.done.slice();
  for (const t of texts) {
    const doneHit = done.find((d) => remainingOverlap(d, t));
    if (doneHit) {
      done = done.filter((d) => d !== doneHit);
      if (!remaining.some((r) => remainingOverlap(r, doneHit))) remaining.push(doneHit);
      continue;
    }
    if (!remaining.some((r) => remainingOverlap(r, t))) remaining.push(t);
  }
  return {
    ...item,
    remaining,
    done,
    queue: remaining.length ? 'in_progress' : item.queue,
  };
}

export function collectAttempts(item: BugWorkItem): BugAttempt[] {
  const all: BugAttempt[] = [...(item.burns || [])];
  for (const c of item.commits || []) {
    const a = c?.attempt;
    if (!a) continue;
    if (!all.some((x) => x.hyp === a.hyp && x.file === a.file && x.test === a.test && x.at === a.at)) {
      all.push(a);
    }
  }
  return all;
}

export function triesMatchingLine(attempts: BugAttempt[], line: string): BugAttempt[] {
  const needle = String(line || '').trim();
  if (!needle) return [];
  return (attempts || []).filter((a) => {
    if (a.line) return remainingOverlap(a.line, needle);
    return false;
  });
}

export function formatTriedAttempt(a: BugAttempt): string {
  if (a.burned) {
    return `${a.hyp} | ${a.file} | ${a.test} | ${a.result || 'burned'} | DO NOT RETRY`;
  }
  const statusText = a.result ? ` | [${a.result}]` : '';
  const noteText = a.note ? ` (${a.note})` : '';
  const lineText = a.line ? ` · line: ${a.line}` : '';
  return `${a.hyp} | ${a.file} | ${a.test}${statusText}${noteText}${lineText}`;
}

export function linePhotosForText(evidence: BugEvidence | null | undefined, text: string): RemainingLinePhoto | undefined {
  const needle = String(text || '').trim().toLowerCase();
  if (!needle || !evidence?.line_photos?.length) return undefined;
  return evidence.line_photos.find((l) => {
    const t = String(l.text || '').trim().toLowerCase();
    return t === needle || needle.startsWith(t) || t.startsWith(needle.split(' — ')[0]);
  });
}

export function appendEvidenceCommit(
  item: BugWorkItem,
  opts: { actor: string; kind: BugCommit['kind']; summary: string; evidence: BugEvidence; remaining?: string[] }
): BugWorkItem {
  const commit: BugCommit = {
    id: `c${item.commits.length + 1}`,
    at: new Date().toISOString(),
    actor: opts.actor,
    kind: opts.kind,
    summary: opts.summary,
    evidence: opts.evidence,
  };
  const hold = [...new Set([...(item.hold_refs || []), opts.evidence.job_id, opts.evidence.debug_url].filter(Boolean))] as string[];
  const queue: BugQueueStatus = item.queue === 'done' ? 'ready' : item.queue;
  return {
    ...item,
    queue,
    occurrences: item.occurrences + (item.commits.length ? 1 : 0),
    current_evidence: opts.evidence,
    commits: [...item.commits, commit],
    remaining: opts.remaining || item.remaining,
    hold_refs: hold,
  };
}

export type BugNow = {
  public_id: string;
  bug: string;
  class?: string;
  remaining: string[];
  done: string[];
  parked: string[];
  current_evidence: BugEvidence | null;
  tried: string[];
  burns_used: string;
  queue: BugQueueStatus;
  do_not: string[];
  checks?: PinnedTapeCheck[];
};

export function buildNow(tag: any): BugNow {
  const item = hydrateWorkItem(tag);
  const burned = item.burns.filter((b) => b.burned);

  const allAttempts = collectAttempts(item);
  const triedStrings = allAttempts.map(formatTriedAttempt);

  return {
    public_id: publicId(item, tag?.id),
    bug: item.bug,
    class: item.class,
    remaining: item.remaining,
    done: item.done,
    parked: item.parked,
    current_evidence: item.current_evidence,
    tried: triedStrings,
    burns_used: `${burned.length}/${BURN_BUDGET}`,
    queue: item.queue,
    checks: item.checks || [],
    do_not: [
      'POST /api/golden/cases/:id/loop',
      'edit expected.json to paint green',
      'retry any line in tried',
      'mark done from chat without the predicted test flipping',
      'POST result=pass when test is a filename, names this meal’s FDC, or file ≠ File hint',
    ],
  };
}

export type BugContinueJob = {
  say: string;
  stop: boolean;
  tag_id: string;
  public_id: string;
  title: string;
  active_line: string | null;
  remaining: string[];
  remaining_after: string[];
  done: string[];
  class_hint: string;
  file_hint: string;
  predicted_test: string;
  job_id: string | null;
  debug_url: string | null;
  photo: string | null;
  comment: string;
  tried: string[];
  burns_used: string;
  queue: BugQueueStatus;
  last_loop: string;
  how_to_end: string;
  do_not: string[];
  next_if_pass: string | null;
  keep_going: boolean;
  drain: boolean;
  parked: string[];
  line_strikes: string;
  instruction: string;
};

export function buildContinueJob(tag: any, activeLine?: string | null): BugContinueJob {
  const item = hydrateWorkItem(tag);
  const id = String(tag?.id || '');
  const now = buildNow(tag);
  const remaining = item.remaining || [];
  const autoRemaining = remaining.filter((r) => !isHumanCheckLine(r));
  const unparked = autoRemaining.filter(
    (r) => !(item.parked || []).some((p) => matchRemainingLine([p], r))
  );
  const candidateList = unparked.length ? unparked : autoRemaining;
  const selected = unparked.length === 0
    ? null
    : matchRemainingLine(candidateList, activeLine) || candidateList[0] || null;
  const blocked = item.queue === 'blocked';
  const autoDoneOrParked = unparked.length === 0;
  const stop = blocked || item.queue === 'done' || autoDoneOrParked;
  const cls = selected ? inferLineClass(selected, item.class) : item.class || '';
  const total = (item.done || []).length + (item.parked || []).length + remaining.length;
  const idx = (item.done || []).length + (item.parked || []).length + 1;
  let say = `DRAIN ${now.public_id} ${idx}/${total || 1}: ${selected}. After POST, if stop=false immediately work continue.active_line. Do not wait for the human. Summary only when remaining is empty.`;
  if (item.queue === 'done') say = `STOP. ${now.public_id} is done. Do not edit.`;
  else if (blocked) say = `STOP. ${now.public_id} is blocked. Human Unblock before continue.`;
  else if (autoDoneOrParked) {
    const humanN = remaining.filter((r) => isHumanCheckLine(r)).length;
    const parkedN = (item.parked || []).length;
    say = humanN
      ? `STOP. ${now.public_id} automatic checks are ${parkedN ? 'parked/blocked' : 'green'}. Human review ${humanN} visual/UI line(s). Do not Promote.`
      : `STOP. ${now.public_id} automatic checks are ${parkedN ? 'parked/blocked' : 'green'}. Human Re-analyze then Mark fixed. Do not Promote.`;
  }
  const evidence = item.current_evidence;
  const linePhoto = selected ? linePhotosForText(evidence, selected) : null;
  const photo =
    linePhoto?.photo_urls?.[0] || evidence?.photo_urls?.[0] || null;
  return {
    say,
    stop,
    tag_id: id,
    public_id: now.public_id,
    title: String(tag?.title || ''),
    active_line: selected,
    remaining,
    remaining_after: selected ? remaining.filter((r) => r !== selected) : remaining,
    done: item.done || [],
    class_hint: cls,
    file_hint: selected ? fileHintForLine(selected, cls) : '',
    predicted_test:
      'Named vitest that fails on a NEW food of this class (not this meal’s FDC list, not expected.json).',
    job_id: evidence?.job_id || null,
    debug_url: evidence?.debug_url || evidence?.scout_url || null,
    photo,
    comment: linePhoto?.comment || '',
    tried: triesMatchingLine(collectAttempts(item), selected || '').map(formatTriedAttempt),
    burns_used: now.burns_used,
    queue: item.queue,
    last_loop: (() => {
      const last = lastCommit(item);
      if (!last) return 'none';
      return `${last.actor} · ${last.summary}${last.attempt ? ` · ${last.attempt.result} · ${last.attempt.file}` : ''}`;
    })(),
    how_to_end: `POST /api/bugs/${id}/attempts { line, hyp, file, test, result, burned, note } then immediately work continue.active_line if stop=false`,
    do_not: [
      'POST /api/golden/cases/:id/loop',
      'PATCH remaining to [] or queue=done from chat',
      'add CANONICAL_BASE_FOODS / lookupCanonicalBaseFood includes() for this meal’s dishes',
      'edit food_aliases or expected.json to paint green',
      'invent files (foodScoutResolver, foodBudgetReconcile, populateMicroNutrients)',
      'retry any line in tried marked DO NOT RETRY',
      'wait for the human between remaining lines',
      'summarize before continue.stop=true',
      'POST result=pass when test is a filename, names this meal’s FDC, or file ≠ File hint',
    ],
    next_if_pass: selected
      ? autoRemaining.filter((r) => r !== selected)[0] || null
      : autoRemaining[0] || null,
    keep_going: !stop,
    drain: true,
    parked: item.parked || [],
    line_strikes: selected ? `${lineStrikeCount(item, selected)}/${BURN_BUDGET}` : now.burns_used,
    instruction: DRAIN_CARD_INSTRUCTION,
  };
}

export function formatContinuePrompt(job: BugContinueJob): string {
  const standing = [
    'AGENTS.md L15 (bug queue). Triggers: work bug (current) / next bug (following card) / work 11 or work #11 (that card). Not a bare "continue" or "work".',
    'If you can GET http://127.0.0.1:3000/api/bugs/next (or localhost:3000), that JSON is the job.',
    'If you cannot (GitHub-only): this paste IS the job. Do not invent remaining from git.',
    DRAIN_CARD_INSTRUCTION,
    'Named vitest on a NEW food (it() sentence, not a filename, not this meal’s FDC). 409 paint/weak_test/paint_fdc/wrong_file = remaining stays; new hyp. Two misses park the line.',
    'Do not /loop, PATCH remaining [], queue=done, CANONICAL includes() for this meal, food_aliases, expected.json, invent files, Promote.',
  ].join('\n');

  const jobBlock = job.stop
    ? `stop=true. Do not write code. One summary to the human:\n${job.say}`
    : [
        job.say,
        '',
        `keep_going: ${job.keep_going}`,
        `Active line: ${job.active_line}`,
        `Class: ${job.class_hint}`,
        `File: ${job.file_hint}`,
        `Test: ${job.predicted_test}`,
        `Line strikes: ${job.line_strikes}`,
        `Photo: ${job.photo || 'none'}`,
        `Comment: ${job.comment || 'none'}`,
        `Tape: job_id=${job.job_id || 'none'} debug=${job.debug_url || 'none'}`,
        `Tried on this line only: ${job.tried.join(' · ') || 'none yet'}`,
        `Last loop: ${job.last_loop || 'none'}`,
        `Next remaining after POST: ${job.remaining_after.join(' · ') || 'none'}`,
        `Parked: ${job.parked.join(' · ') || 'none'}`,
      ].join('\n');

  return [
    standing,
    '',
    'THIS JOB',
    jobBlock,
    '',
    JSON.stringify(
      {
        say: job.say,
        stop: job.stop,
        keep_going: job.keep_going,
        drain: job.drain,
        tag_id: job.tag_id,
        public_id: job.public_id,
        active_line: job.active_line,
        class_hint: job.class_hint,
        file_hint: job.file_hint,
        how_to_end: job.how_to_end,
        next_if_pass: job.next_if_pass,
        instruction: job.instruction,
        do_not: job.do_not,
      },
      null,
      2
    ),
  ].join('\n');
}

export function buildStartPayload(tag: any, activeLine?: string | null): {
  say: string;
  now: BugNow;
  commits: BugCommit[];
  how_to_end: string;
  tag_id: string;
  instruction: string;
  continue: BugContinueJob;
} {
  const item = hydrateWorkItem(tag);
  const id = tag?.id || '';
  const cont = buildContinueJob({ ...tag, work_item: item, id }, activeLine);
  return {
    say: cont.stop && item.queue !== 'done' && !item.remaining.length ? cont.say : 'Next bug',
    tag_id: id,
    now: buildNow(tag),
    commits: item.commits,
    how_to_end: cont.how_to_end,
    instruction: DRAIN_CARD_INSTRUCTION,
    continue: cont,
  };
}
