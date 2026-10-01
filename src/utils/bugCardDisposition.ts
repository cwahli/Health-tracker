/**
 * What a card IS, for the board. One function, one vocabulary.
 *
 * Measured 2026-09-30, on the board that had just been changed to show every
 * status instead of `status IN ('to_fix','in_progress','fixed')`: a card with
 * `status = 'ignored'` was counted as DONE by the KPIs (`doneAll: 2`) while its
 * own badge rendered the word "fixed". A card nobody fixed, presented as fixed,
 * sitting in a list the user reads as their open work. Nothing was wrong with
 * the store — two surfaces had each derived "is this done?" from a different
 * rule, and `ignored` was in one and not the other.
 *
 * The classes a card can be in, and why each one matters:
 *
 *   declined  status ignored/wont_fix/dismissed. Deliberately not work. It is
 *             NOT done — claiming otherwise inflates the fixed count with cards
 *             that were thrown away, which is the same class of lie as a
 *             duplicated #n.
 *   fixed     closed by a green named_test / human check, or the green tick
 *             (status=fixed). Genuinely done.
 *   stuck     blocked_reason, queue=blocked, or out of burn budget.
 *   review    an agent posted the last thing; a human owes the reply.
 *   to_do     remaining work, no agent activity.
 *   untouched no work posted yet.
 *
 * Every surface derives from this: the row badge, the KPI tiles, the status
 * filter, and the select's counts. Adding a status means adding it HERE, and
 * the board's four numbers and its badge cannot fall out of step again.
 */

import { BURN_BUDGET, hydrateWorkItem } from './bugWorkItem';

export type CardDisposition =
  | 'declined'
  | 'fixed'
  | 'stuck'
  | 'review'
  | 'to_do'
  | 'untouched';

export type CardDiscipline = {
  disposition: CardDisposition;
  /** Counts as work someone still owes. `declined` and `fixed` do not. */
  open: boolean;
  /** Counts as a genuine completion. `declined` does not. */
  done: boolean;
  /** Statuses that mean "a person decided this is not work". */
  declined: boolean;
  /** Filter key used by the board's status filter. */
  filter: 'active' | 'done' | 'stuck' | 'all';
};

/**
 * Statuses that record a decision NOT to work on this. They come from three
 * places over the store's life: the green tick's siblings in the UI, the
 * purge-done query (`status IN ('fixed','ignored')`), and the agent vocabulary.
 * Anything not in here and not `fixed` is treated as open work, which is the
 * safe direction to be wrong in: an unrecognised status shows as work rather
 * than vanishing.
 */
export const DECLINED_STATUSES = new Set(['ignored', 'wont_fix', 'wontfix', 'dismissed', 'rejected', 'duplicate', 'invalid']);

export const CLOSED_STATUSES = new Set(['fixed']);

/** Case-insensitive membership, because D1 TEXT columns are not typed. */
const has = (set: Set<string>, value: unknown) => set.has(String(value ?? '').trim().toLowerCase());

export function isDeclinedStatus(status: unknown): boolean {
  return has(DECLINED_STATUSES, status);
}

export function isFixedStatus(status: unknown): boolean {
  return has(CLOSED_STATUSES, status);
}

/** The single source of truth. `hydrate` is injected only for tests. */
export function cardDiscipline(tag: any, hydrate: (t: any) => any = hydrateWorkItem): CardDiscipline {
  const status = String(tag?.status ?? '').trim();
  const item = hydrate(tag);
  const queue = String(item?.queue ?? '');
  const burns = Array.isArray(item?.burns) ? item.burns.filter((b: any) => b?.burned).length : 0;
  const commits = Array.isArray(item?.commits) ? item.commits : [];
  const remaining = Array.isArray(item?.remaining) ? item.remaining : [];

  // Declined is checked FIRST. A declined card may carry a stale work_item
  // (queue=ready) from before the decision, and "did we decide not to?" is a
  // stronger fact than whatever the work_item still claims.
  if (isDeclinedStatus(status)) {
    return { disposition: 'declined', open: false, done: false, declined: true, filter: 'done' };
  }
  if (queue === 'done' || isFixedStatus(status)) {
    return { disposition: 'fixed', open: false, done: true, declined: false, filter: 'done' };
  }
  if (queue === 'blocked' || burns >= BURN_BUDGET || item?.blocked_reason) {
    return { disposition: 'stuck', open: true, done: false, declined: false, filter: 'stuck' };
  }
  const last = commits.length ? commits[commits.length - 1] : null;
  const agentActed = commits.some((c: any) => c?.kind === 'agent' || c?.actor !== 'you');
  if (last && (last.kind === 'agent' || last.actor !== 'you')) {
    return { disposition: 'review', open: true, done: false, declined: false, filter: 'active' };
  }
  if (agentActed || remaining.length > 0) {
    return { disposition: 'to_do', open: true, done: false, declined: false, filter: 'active' };
  }
  return { disposition: 'untouched', open: true, done: false, declined: false, filter: 'active' };
}

/** True when the card counts as open work. Replaces the old `tagIsFixed` shape. */
export function isCardOpen(tag: any, hydrate: (t: any) => any = hydrateWorkItem): boolean {
  return cardDiscipline(tag, hydrate).open;
}

/**
 * A human-readable label for the row badge. `ignored` must never read "fixed":
 * the whole point of `declined` existing is that the word on the card matches
 * the decision that was made about it.
 */
export function dispositionLabel(disposition: CardDisposition, t?: (key: string, fallback: string) => string): string {
  const tr = t || ((_k: string, fallback: string) => fallback);
  switch (disposition) {
    case 'declined':
      return tr('bugCardDeclined', 'declined');
    case 'fixed':
      return tr('bugCardFixed', 'fixed');
    case 'stuck':
      return tr('bugCardStuck', 'stuck');
    case 'review':
      return tr('bugCardHumanToDo', 'human to do');
    case 'to_do':
      return tr('bugCardAgentToDo', 'agent to do');
    case 'untouched':
    default:
      return tr('bugCardUnactioned', 'un-actioned');
  }
}
