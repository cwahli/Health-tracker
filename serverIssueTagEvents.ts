/**
 * The one write-side signal for issue_tags, fired from the D1 layer itself.
 *
 * Measured 2026-09-30: `/api/bug-tracker/overview` cached its whole payload
 * for 20s and busted it from exactly three hand-placed `overviewCache = null`
 * statements, all inside serverIssueBacklog.ts. Every write that goes through
 * serverBugSnapshot.ts — the agent posting an attempt, a verify, a curation, a
 * handoff, the auto-file that mints a new card — left the cache warm, so the
 * board could show a stale COUNT for 20 seconds after the store changed. That is
 * the same class of defect as the two row sets: a second surface with its own
 * idea of the truth.
 *
 * The fix is structural rather than another hand-placed null. Every D1 write
 * against issue_tags goes through d1Query(), so that is where the signal is
 * emitted — one place, and a future agent's new write route is covered by
 * existing rather than by remembering. Listeners are notified synchronously and
 * must not throw: a subscriber's failure must not fail a write that already
 * landed in the database.
 *
 * Deliberately write-only. A read that finds a warm cache may serve it; nothing
 * about a SELECT can change what a reader should see.
 */

export type IssueTagsWriteListener = (info: { sql: string; params: any[] }) => void;

const listeners = new Set<IssueTagsWriteListener>();

/** True for a statement that can change what a bug-card reader would return. */
export function mutatesIssueTags(sql: string): boolean {
  const s = String(sql || '').toUpperCase();
  if (!s.includes('ISSUE_TAGS')) return false;
  return (
    s.includes('INSERT') ||
    s.includes('UPDATE') ||
    s.includes('DELETE') ||
    s.includes('REPLACE')
  );
}

export function onIssueTagsWrite(fn: IssueTagsWriteListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Called by server_d1.d1Query. Never throws; never rejects a write. */
export function notifyIssueTagsWrite(sql: string, params: any[]): void {
  if (!mutatesIssueTags(sql)) return;
  for (const fn of [...listeners]) {
    try {
      fn({ sql: String(sql), params: Array.isArray(params) ? params : [] });
    } catch (err) {
      console.warn('[issue-tags] write listener failed (write itself is fine):', (err as any)?.message || err);
    }
  }
}

export function issueTagWriteListenerCount(): number {
  return listeners.size;
}
