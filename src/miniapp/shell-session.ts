/**
 * Shell session-map helpers (pure, unit-tested in shell-session.test.ts).
 *
 * The terminal picker's rows are keyed `tty:<bot>` for ttyd terminals and
 * `<sessionId>` for bare VM opencode sessions, while `/api/ttys/status`
 * reports bare bot names for ttyd rows. The mapping lives here — one rule,
 * tested — so the dropdown cannot drift from it row by row.
 */

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

export type TtyStatusRow = { id?: string; bot: string; live: boolean; memMiB?: number };

/**
 * Fold `/api/ttys/status` rows into the picker's live + memory maps.
 * Keyed rows (bare sessions) paint only their own id — a live bare session
 * must not paint the shared `vm` bot row. Unkeyed rows are ttyd terminals,
 * whose picker id is `tty:<bot>`, so they paint both keys (the bare bot key
 * keeps older lookups working).
 */
export function statusKeyMaps(rows: TtyStatusRow[]): { live: Record<string, boolean>; mem: Record<string, number> } {
  const live: Record<string, boolean> = {};
  const mem: Record<string, number> = {};
  for (const row of rows || []) {
    if (!row || typeof row.bot !== 'string') continue;
    const id = typeof row.id === 'string' && row.id ? row.id : '';
    const keys = id ? [id] : [row.bot, `tty:${row.bot}`];
    for (const k of keys) {
      live[k] = row.live === true;
      if (typeof row.memMiB === 'number' && row.memMiB > 0) mem[k] = row.memMiB;
    }
  }
  return { live, mem };
}
