/**
 * Which bug-list rows the default human list shows.
 *
 * The board's active filter keeps a card when cardDiscipline().open is true
 * (src/utils/bugCardDisposition.ts). GET /api/bugs/list stays the full store
 * so the parity check still sees every status. This predicate is for the
 * Telegram text only.
 *
 * Hidden: state done or fixed, queue done, and declined statuses. A green
 * journey stays state verifying and stays visible. A commit on main without
 * named_test or manual green does not hide a card.
 */

const DECLINED = new Set([
  'ignored',
  'wont_fix',
  'wontfix',
  'dismissed',
  'rejected',
  'duplicate',
  'invalid',
]);

function token(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function isOpenBugRow(row) {
  if (!row || typeof row !== 'object') return false;
  const state = token(row.state);
  const queue = token(row.queue);
  const status = token(row.status);
  if (DECLINED.has(state) || DECLINED.has(status)) return false;
  if (state === 'done' || state === 'fixed' || queue === 'done') return false;
  return true;
}

export function openBugRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return list
    .filter(isOpenBugRow)
    .sort((a, b) => Number(a?.public_n ?? 0) - Number(b?.public_n ?? 0));
}
