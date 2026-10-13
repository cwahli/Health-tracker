/**
 * Shell tab-URL helpers (pure, unit-tested in shell-nav.test.ts).
 *
 * One rule owns every write: the URL's ?tab= must name the visible tab,
 * because refresh boots from the query. The drawer complicates it — opening
 * the drawer pushes a history entry so system-Back closes it, and picking an
 * entry consumes that push with history.back(), which lands on the
 * PRE-drawer URL (stale ?tab=). The pop handler must therefore re-assert the
 * current tab right after closing, through this same helper: without it a
 * drawer visit shows the new tab but refreshes into the old one (live
 * 2026-10-11: Hotels always refreshed back into the Terminal).
 */
export function tabUrl(search: string, tabId: string, bot: string): string {
  const q = new URLSearchParams(search || '');
  q.set('tab', tabId);
  if (bot) q.set('bot', bot);
  return `?${q.toString()}`;
}

/**
 * Memory readout for the terminal picker (MiB in, `412 MB` / `2.0 GB` out).
 * Non-positive or non-finite input renders as '' — the row shows no number
 * rather than a zero, because dormant and bare rows carry no measurement.
 */
export function formatMem(mib: number): string {
  if (!Number.isFinite(mib) || mib <= 0) return '';
  if (mib < 1024) return `${Math.round(mib)} MB`;
  return `${(mib / 1024).toFixed(1)} GB`;
}
