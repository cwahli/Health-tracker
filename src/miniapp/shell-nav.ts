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
