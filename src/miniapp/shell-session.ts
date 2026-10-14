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

export type TtyStatusRow = { id?: string; bot: string; live: boolean; memMiB?: number; idleMs?: number };

/** One live tmux session from `/api/ttys/status`. `route` names the served
 * bot when the session is that bot's attach target, else null. */
export type TmuxEntry = { name: string; memMiB?: number; idleMs?: number; route: string | null };

/**
 * Fold `/api/ttys/status` rows into the picker's live + memory + idle maps.
 * Keyed rows (bare sessions) paint only their own id — a live bare session
 * must not paint the shared `vm` bot row. Unkeyed rows are ttyd terminals,
 * whose picker id is `tty:<bot>`, so they paint both keys (the bare bot key
 * keeps older lookups working). Routeless tmux entries paint `tmux:<name>`
 * tracking keys; routed ones are skipped — their tty row already carries it.
 */
export function statusKeyMaps(rows: TtyStatusRow[], tmux: TmuxEntry[] = []): {
  live: Record<string, boolean>;
  mem: Record<string, number>;
  idle: Record<string, number>;
} {
  const live: Record<string, boolean> = {};
  const mem: Record<string, number> = {};
  const idle: Record<string, number> = {};
  const paint = (k: string, memMiB?: number, idleMs?: number, isLive = true) => {
    live[k] = isLive;
    if (typeof memMiB === 'number' && memMiB > 0) mem[k] = memMiB;
    if (typeof idleMs === 'number' && idleMs >= 0) idle[k] = idleMs;
  };
  for (const row of rows || []) {
    if (!row || typeof row.bot !== 'string') continue;
    const id = typeof row.id === 'string' && row.id ? row.id : '';
    if (id) paint(id, row.memMiB, row.idleMs, row.live === true);
    else for (const k of [row.bot, `tty:${row.bot}`]) paint(k, row.memMiB, row.idleMs, row.live === true);
  }
  for (const e of tmux || []) {
    if (!e || typeof e.name !== 'string' || !e.name || e.route) continue;
    paint(`tmux:${e.name}`, e.memMiB, e.idleMs, true);
  }
  return { live, mem, idle };
}

/** Idle at or past this long paints red: the session is a kill candidate. */
export const TTY_IDLE_RED_MS = 15 * 60 * 1000;

/** Sort picker rows by memory, heaviest first; unmeasured rows keep their
 * input order at the bottom. Stable: equal keys never swap. */
export function sortByMem<T extends { bot: string; id?: string }>(
  rows: T[],
  mem: Record<string, number>,
): T[] {
  const keyOf = (r: T) => (typeof r.id === 'string' && r.id ? r.id : r.bot);
  const val = (r: T) => {
    const m = (mem || {})[keyOf(r)];
    return typeof m === 'number' && m > 0 ? m : -1;
  };
  return (rows || [])
    .map((r, i) => ({ r, i }))
    .sort((a, b) => val(b.r) - val(a.r) || a.i - b.i)
    .map((e) => e.r);
}

/** Duration readout for idle rows (`5m` / `2h` / `3d`); '' when unmeasurable. */
export function formatIdle(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export type PickerRow = {
  kind?: string;
  bot: string;
  agent?: string;
  status?: string;
  updatedAt?: string | null;
  /** Precomputed subline for synthetic rows (the box aggregate). */
  detail?: string;
};

export type RowLook = {
  /** live = green, idle = red kill candidate, dormant = grey. */
  dot: 'live' | 'idle' | 'dormant';
  /** `412 MB` / `2.0 GB`, or '' — rendered on the row's main line. */
  memText: string;
  /** `live`, `idle 2h`, `working cline just now`, `held grok`, or '' —
   * rendered under the main line. */
  stateText: string;
};

/** One live bot-turn activity from `/api/ttys/status` (see activity-hub). */
export type ActivityEntry = {
  chat: string;
  sessionId8: string;
  bots: string[];
  lane: string;
  host: string;
  state: 'working' | 'held' | 'idle';
  elapsedMs: number | null;
};

/** The badge a picker row shows for a working/held turn. Idle badges nothing. */
export type ActivityBadge = {
  state: 'working' | 'held';
  lane: string;
  elapsedMs: number | null;
  host: string;
};

/**
 * Fold activity rows into the picker's badge map. Keys: `tty:<bot>` for
 * every bot on the row, plus `ses:<sessionId8>` so bare `opencode:` rows
 * badge when their session is being worked. Working wins over held; ties
 * keep the longest elapsed. Idle rows badge nothing — the row's own
 * live/idle/memory already says it.
 */
export function activityKeyMaps(activity: ActivityEntry[] = []): {
  act: Record<string, ActivityBadge>;
} {
  const act: Record<string, ActivityBadge> = {};
  const rank: Record<string, number> = { working: 0, held: 1, idle: 2 };
  const consider = (k: string, e: ActivityEntry) => {
    if (e.state !== 'working' && e.state !== 'held') return;
    const cur = act[k];
    const r = rank[e.state] ?? 3;
    const badge: ActivityBadge = {
      state: e.state,
      lane: String(e.lane || ''),
      elapsedMs: typeof e.elapsedMs === 'number' ? e.elapsedMs : null,
      host: String(e.host || ''),
    };
    if (!cur) {
      act[k] = badge;
      return;
    }
    const cr = rank[cur.state] ?? 3;
    if (r < cr || (r === cr && (badge.elapsedMs ?? -1) > (cur.elapsedMs ?? -1))) {
      act[k] = badge;
    }
  };
  for (const e of activity || []) {
    if (!e || typeof e !== 'object') continue;
    for (const b of e.bots || []) {
      if (typeof b === 'string' && b) consider(`tty:${b}`, e);
    }
    if (typeof e.sessionId8 === 'string' && e.sessionId8) consider(`ses:${e.sessionId8}`, e);
  }
  return { act };
}

/**
 * One rule for what a picker row shows. ttyd rows read the status maps;
 * bare sessions read their own `status`/`updatedAt` (the server sends no
 * memory or tmux idle for rows with no backend here).
 */
export function lookForRow(
  r: PickerRow,
  maps: { live: boolean; memMiB?: number; idleMs?: number; act?: ActivityBadge },
  nowMs: number,
): RowLook {
  const noMem: RowLook = { dot: 'dormant', memText: '', stateText: '' };
  if (!r) return noMem;
  // A working/held turn badges its row even with no live pane: headless
  // turns are exactly the ones you cannot see otherwise.
  const act = maps.act && (maps.act.state === 'working' || maps.act.state === 'held') ? maps.act : null;
  const actText = !act
    ? ''
    : act.state === 'working'
      ? `working${act.lane ? ` ${act.lane}` : ''}${act.elapsedMs != null ? ` ${formatIdle(act.elapsedMs)}` : ''}`
      : `held${act.host ? ` ${act.host}` : ''}`;
  if (r.kind === 'opencode') {
    if (act) return { dot: act.state === 'working' ? 'live' : 'idle', memText: '', stateText: actText };
    if (String(r.status || '').toLowerCase() === 'idle') {
      let dur = '';
      const t = r.updatedAt ? Date.parse(r.updatedAt) : NaN;
      if (Number.isFinite(t)) dur = ` ${formatIdle(nowMs - t)}`;
      return { dot: 'idle', memText: '', stateText: `idle${dur}` };
    }
    return {
      dot: maps.live ? 'live' : 'dormant',
      memText: '',
      stateText: String(r.status || ''),
    };
  }
  const memText =
    typeof maps.memMiB === 'number' && maps.memMiB > 0 ? formatMem(maps.memMiB) : '';
  if (r.kind === 'box') {
    return { dot: 'live', memText, stateText: r.detail || 'outside tmux' };
  }
  if (!maps.live) {
    // Badges show on dormant panes too — with the dormant dot kept honest:
    // the pane is down, the turn is not. The hold is actionable
    // (`/location vps`) whether or not a terminal is open.
    if (act && act.state === 'working') return { dot: 'dormant', memText, stateText: actText };
    if (act && act.state === 'held') return { dot: 'dormant', memText, stateText: actText };
    return noMem;
  }
  if (act && act.state === 'working') return { dot: 'live', memText, stateText: actText };
  if (act && act.state === 'held') return { dot: 'live', memText, stateText: actText };
  const idleMs = typeof maps.idleMs === 'number' ? maps.idleMs : -1;
  if (idleMs >= TTY_IDLE_RED_MS) {
    return { dot: 'idle', memText, stateText: `idle ${formatIdle(idleMs)}` };
  }
  return { dot: 'live', memText, stateText: 'live' };
}
