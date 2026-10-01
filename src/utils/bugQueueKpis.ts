/**
 * Queue dashboard KPIs. Overview must include this week's done tags
 * or "Done this week" stays 0 after the green tick hides them from to_fix.
 *
 * Every "is this done?" question is answered by cardDiscipline()
 * (src/utils/bugCardDisposition.ts), which is also what draws the row badge.
 * They used to answer independently, and disagreed: a card with
 * `status = 'ignored'` counted as done here while its badge said "fixed",
 * because `tagIsFixed` folded 'ignored' into done and the badge did not
 * (measured 2026-09-30). One rule, one answer, one place to add a status.
 */
import { getLastActionedDate, hydrateWorkItem } from './bugWorkItem';
import { cardDiscipline } from './bugCardDisposition';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @deprecated Kept as a name because call sites read better with it, but it
 * now means "not open work" — declined and fixed alike. Use
 * `cardDiscipline(t).open` when the difference matters, and it does whenever
 * something is counting completions rather than counting backlog.
 */
export function tagIsFixed(tag: any): boolean {
  return !cardDiscipline(tag).open;
}

/** True only for a genuine completion. A declined card is not one. */
export function tagIsGenuinelyFixed(tag: any): boolean {
  return cardDiscipline(tag).done;
}

export function tagResolvedAt(tag: any): Date | null {
  if (tag?.resolved_at) {
    const d = new Date(tag.resolved_at);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (!cardDiscipline(tag).done) return null;
  return getLastActionedDate(tag);
}

export function isDoneThisWeek(tag: any, now: Date = new Date(), days = 7): boolean {
  if (!tagIsGenuinelyFixed(tag)) return false;
  const at = tagResolvedAt(tag);
  if (!at) return true;
  return now.getTime() - at.getTime() <= days * DAY_MS;
}

export type BugQueueKpis = {
  ready: number;
  blocked: number;
  open: number;
  doneThisWeek: number;
  doneAll: number;
  /** Cards a person decided are not work. Not backlog, not completions. */
  declined: number;
};

export function queueKpis(tags: any[], now: Date = new Date()): BugQueueKpis {
  const list = Array.isArray(tags) ? tags : [];
  const open = list.filter((t) => cardDiscipline(t).open);
  return {
    ready: open.filter((t) => hydrateWorkItem(t).queue === 'ready').length,
    blocked: open.filter((t) => cardDiscipline(t).disposition === 'stuck').length,
    open: open.length,
    // A declined card is not a completion. Counting it here is what made the
    // board claim fixed work nobody did.
    doneThisWeek: list.filter((t) => isDoneThisWeek(t, now)).length,
    doneAll: list.filter((t) => cardDiscipline(t).done).length,
    declined: list.filter((t) => cardDiscipline(t).declined).length,
  };
}
