/**
 * tmux-session-mem.mjs — per-tmux-session memory accounting.
 *
 * The shell's terminal picker shows one row per TUI; the RSS summed over a
 * session's pane trees is the number behind each row's memory readout. RSS
 * overcounts shared pages, so every figure is an upper bound — honest for
 * "which session is worth killing", never a billing number.
 *
 * Pure parsers (unit-tested) plus one injected-seam collector. Best-effort:
 * any failure resolves to {}, and the status endpoint then renders as if
 * memory were unknown (rows as today, no number).
 */
import { execFile as defaultExecFile } from 'node:child_process';
import { readFile as defaultReadFile } from 'node:fs/promises';

/**
 * `tmux list-sessions -F '#{session_name}'` → [name]. Skips blanks.
 */
export function parseSessionNames(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const name = line.trim();
    if (name) out.push(name);
  }
  return out;
}

/**
 * Live tmux session names, best-effort ([] on any failure). The kill
 * endpoint validates its target against this same listing in the same tick,
 * so the name is allowlisted, never free-form.
 */
export async function listTmuxNames({ execFile = defaultExecFile, timeoutMs = 5000 } = {}) {
  try {
    return parseSessionNames(
      await runCmd(execFile, 'tmux', ['list-sessions', '-F', '#{session_name}'], timeoutMs),
    );
  } catch {
    return [];
  }
}

/**
 * Every live tmux session with its tree memory + idle age:
 * `[{ name, memMiB?, idleMs? }]`. Three spawns, one tick, best-effort ([] on
 * any failure). Unknown figures are omitted, never zeroed.
 */
export async function collectTmuxSessions({ execFile = defaultExecFile, readFile = defaultReadFile, timeoutMs = 5000, now = Date.now() } = {}) {
  try {
    const [sessOut, panesOut, ps] = await Promise.all([
      runCmd(execFile, 'tmux', ['list-sessions', '-F', '#{session_name} #{session_activity}'], timeoutMs),
      runCmd(execFile, 'tmux', ['list-panes', '-a', '-F', '#{session_name} #{pane_pid}'], timeoutMs),
      procMap({ execFile, readFile, timeoutMs }),
    ]);
    const activity = parseSessionActivity(sessOut, now);
    const panes = parsePaneLines(panesOut);
    const mem = sumSessionTrees(panes, ps);
    const names = new Set([...Object.keys(activity), ...Object.keys(panes)]);
    const out = [];
    for (const name of [...names].sort()) {
      const entry = { name };
      if (Number.isInteger(mem[name]) && mem[name] > 0) entry.memMiB = mem[name];
      if (Number.isFinite(activity[name])) entry.idleMs = activity[name];
      out.push(entry);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * PSS of everything OUTSIDE tmux pane trees: `{ mib, procs }`. Together
 * with the session inventory this reconciles against all-process PSS —
 * the remainder to `free` is kernel slab plus swapped-out pages, which live
 * in no process and are named, never forced. Best-effort ({} on failure).
 */
export async function collectUnattributedMem({ execFile = defaultExecFile, readFile = defaultReadFile, timeoutMs = 5000 } = {}) {
  try {
    const [panesOut, ps] = await Promise.all([
      runCmd(execFile, 'tmux', ['list-panes', '-a', '-F', '#{session_name} #{pane_pid}'], timeoutMs),
      procMap({ execFile, readFile, timeoutMs }),
    ]);
    const panes = parsePaneLines(panesOut);
    const children = new Map();
    for (const [pid, row] of Object.entries(ps)) {
      if (!children.has(row.ppid)) children.set(row.ppid, []);
      children.get(row.ppid).push(Number(pid));
    }
    const members = new Set();
    const stack = Object.values(panes).flat();
    while (stack.length) {
      const p = stack.pop();
      if (members.has(p)) continue;
      members.add(p);
      if (ps[p]) stack.push(...(children.get(p) || []));
    }
    let kb = 0;
    let procs = 0;
    for (const [pid, row] of Object.entries(ps)) {
      if (members.has(Number(pid))) continue;
      kb += typeof row.pssKb === 'number' ? row.pssKb : row.rssKb;
      procs += 1;
    }
    return kb > 0 ? { mib: Math.round(kb / 1024), procs } : {};
  } catch {
    return {};
  }
}
/**
 * `tmux list-panes -a -F '#{session_name} #{pane_pid}'` → { session: [pid] }.
 * Split on the LAST space: the pid is always the final token, so a session
 * name containing a space still parses. Malformed lines are skipped.
 */
export function parsePaneLines(text) {
  const out = {};
  for (const line of String(text || '').split('\n')) {
    const cut = line.lastIndexOf(' ');
    if (cut <= 0) continue;
    const session = line.slice(0, cut).trim();
    const pid = Number(line.slice(cut + 1).trim());
    if (!session || !Number.isInteger(pid) || pid <= 0) continue;
    (out[session] = out[session] || []).push(pid);
  }
  return out;
}

/**
 * `ps -eo pid,ppid,rss[,args]` → { pid: { ppid, rssKb, args } }. The header
 * and any malformed row are skipped (first token must be numeric). `args`
 * (when the caller asks ps for it) powers session→process attribution.
 */
export function parsePsLines(text) {
  const out = {};
  for (const line of String(text || '').split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3 || !/^\d+$/.test(parts[0] || '')) continue;
    if (!/^\d+$/.test(parts[1]) || !/^\d+$/.test(parts[2])) continue;
    out[Number(parts[0])] = {
      ppid: Number(parts[1]),
      rssKb: Number(parts[2]),
      args: parts.slice(3).join(' '),
    };
  }
  return out;
}

/**
 * Sum RSS (MiB, rounded) over each session's pane trees. A process reachable
 * from two sessions counts in both — shared pages are overcounted in RSS
 * already, so the figures stay comparable upper bounds. Sessions with no
 * matched process are omitted (unknown, not zero). Each row may carry
 * `pssKb` (from applyPss); it wins over `rssKb` wherever present.
 */
export function sumSessionTrees(panesBySession, psByPid) {
  const children = new Map();
  for (const [pid, row] of Object.entries(psByPid || {})) {
    if (!row || !Number.isInteger(row.ppid)) continue;
    if (!children.has(row.ppid)) children.set(row.ppid, []);
    children.get(row.ppid).push(Number(pid));
  }
  const out = {};
  for (const [session, roots] of Object.entries(panesBySession || {})) {
    let kb = 0;
    const seen = new Set();
    const stack = [...(Array.isArray(roots) ? roots : [])];
    while (stack.length) {
      const p = stack.pop();
      if (seen.has(p)) continue;
      seen.add(p);
      const row = (psByPid || {})[p];
      if (!row) continue;
      kb += typeof row.pssKb === 'number' ? row.pssKb : row.rssKb;
      const kids = children.get(p);
      if (kids) stack.push(...kids);
    }
    if (kb > 0) out[session] = Math.round(kb / 1024);
  }
  return out;
}

/**
 * Proportional Set Size per pid from `smaps_rollup` (shared pages split
 * among sharers, so per-session sums are additive instead of RSS's
 * double-count). Returns { pid: pssKb } for readable processes only —
 * callers fall back to RSS per process, tracked via `pssOk`.
 */
export async function pssForPids(pids, { readFile = defaultReadFile } = {}) {
  const out = {};
  await Promise.all((Array.isArray(pids) ? pids : []).map(async (pid) => {
    try {
      const text = await readFile(`/proc/${Number(pid)}/smaps_rollup`, 'utf8');
      const m = /^Pss:\s+(\d+)\s+kB/m.exec(String(text));
      if (m) out[Number(pid)] = Number(m[1]);
    } catch {
      /* unreadable (kernel thread, other user, vanished) — RSS fallback */
    }
  }));
  return out;
}

/** Attach `pssKb`/`pssOk` to a `parsePsLines` map. Pure; returns a new map. */
export function applyPss(psByPid, pssByPid) {
  const out = {};
  for (const [pid, row] of Object.entries(psByPid || {})) {
    const pssKb = (pssByPid || {})[pid];
    out[pid] = {
      ...row,
      pssKb: typeof pssKb === 'number' ? pssKb : row.rssKb,
      pssOk: typeof pssKb === 'number',
    };
  }
  return out;
}

/** One `ps` plus PSS enrichment — the shared root of the collectors below. */
async function procMap({ execFile = defaultExecFile, readFile = defaultReadFile, timeoutMs = 5000 } = {}) {
  const psOut = await runCmd(execFile, 'ps', ['-eo', 'pid,ppid,rss,args'], timeoutMs);
  const ps = parsePsLines(psOut);
  return applyPss(ps, await pssForPids(Object.keys(ps), { readFile }));
}

/**
 * Pids whose argv names a session id (bare-session backend candidates).
 * Pure over a `parsePsLines` map.
 */
export function matchSesPids(psByPid, sesId) {
  const sid = String(sesId || '').trim();
  if (!sid) return [];
  const out = [];
  for (const [pid, row] of Object.entries(psByPid || {})) {
    if (row && typeof row.args === 'string' && row.args.includes(sid)) out.push(Number(pid));
  }
  return out.sort((a, b) => a - b);
}

/**
 * Exclusive-backend memory per bare session: `{ sesId: { mib, shared } }`.
 * Roots are argv-matched CLI processes; `shared` is true when any root sits
 * inside a tmux pane tree (already counted there — attributing it again
 * would double-count). Best-effort ({} on any failure).
 */
export async function collectBareSessionMem({ sessions = [], execFile = defaultExecFile, readFile = defaultReadFile, timeoutMs = 5000 } = {}) {
  const wanted = (Array.isArray(sessions) ? sessions : []).map((s) => String(s || '').trim()).filter(Boolean);
  if (!wanted.length) return {};
  try {
    const [panesOut, ps] = await Promise.all([
      runCmd(execFile, 'tmux', ['list-panes', '-a', '-F', '#{session_name} #{pane_pid}'], timeoutMs),
      procMap({ execFile, readFile, timeoutMs }),
    ]);
    const panes = parsePaneLines(panesOut);
    const children = new Map();
    for (const [pid, row] of Object.entries(ps)) {
      if (!children.has(row.ppid)) children.set(row.ppid, []);
      children.get(row.ppid).push(Number(pid));
    }
    const treeMembers = new Set();
    {
      const stack = Object.values(panes).flat();
      while (stack.length) {
        const p = stack.pop();
        if (treeMembers.has(p)) continue;
        treeMembers.add(p);
        if (ps[p]) stack.push(...(children.get(p) || []));
      }
    }
    const sumTree = (roots) => {
      let kb = 0;
      const seen = new Set();
      const stack = [...roots];
      while (stack.length) {
        const p = stack.pop();
        if (seen.has(p)) continue;
        seen.add(p);
        const row = ps[p];
        if (!row) continue;
        kb += typeof row.pssKb === 'number' ? row.pssKb : row.rssKb;
        stack.push(...(children.get(p) || []));
      }
      return kb;
    };
    const out = {};
    for (const sid of wanted) {
      const roots = matchSesPids(ps, sid);
      if (!roots.length) continue;
      const kb = sumTree(roots);
      if (kb <= 0) continue;
      out[sid] = { mib: Math.round(kb / 1024), shared: roots.some((r) => treeMembers.has(r)) };
    }
    return out;
  } catch {
    return {};
  }
}

function runCmd(execFile, file, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeoutMs }, (err, stdout) => {
      if (err) reject(err);
      else resolve(String(stdout || ''));
    });
  });
}

/**
 * `tmux list-sessions -F '#{session_name} #{session_activity}'` →
 * { session: idleMs }. session_activity is the last pane-activity epoch
 * (seconds); idle clamps at 0 so a skewed clock never reports negative.
 * Malformed lines are skipped.
 */
export function parseSessionActivity(text, nowMs = Date.now()) {
  const out = {};
  for (const line of String(text || '').split('\n')) {
    const cut = line.lastIndexOf(' ');
    if (cut <= 0) continue;
    const session = line.slice(0, cut).trim();
    const at = Number(line.slice(cut + 1).trim());
    if (!session || !Number.isFinite(at) || at <= 0) continue;
    out[session] = Math.max(0, Math.round(nowMs - at * 1000));
  }
  return out;
}

/**
 * Idle age per tmux session, best-effort like collectSessionMem: one
 * `tmux list-sessions`, scoped to the wanted names, {} on any failure.
 */
export async function collectSessionIdle({ sessions = [], execFile = defaultExecFile, timeoutMs = 5000, now = Date.now() } = {}) {
  const wanted = new Set((Array.isArray(sessions) ? sessions : []).filter(Boolean));
  if (!wanted.size) return {};
  try {
    const out = await runCmd(execFile, 'tmux', ['list-sessions', '-F', '#{session_name} #{session_activity}'], timeoutMs);
    const all = parseSessionActivity(out, now);
    const scoped = {};
    for (const s of wanted) {
      if (Number.isFinite(all[s])) scoped[s] = all[s];
    }
    return scoped;
  } catch {
    return {};
  }
}

/**
 * One `tmux list-panes` + one `ps`, mapped onto the requested tmux session
 * names. `execFile` is injectable (same callback shape as node's) so tests
 * never spawn. Resolves {} on any failure or empty input.
 */
export async function collectSessionMem({ sessions = [], execFile = defaultExecFile, readFile = defaultReadFile, timeoutMs = 5000 } = {}) {
  const wanted = new Set((Array.isArray(sessions) ? sessions : []).filter(Boolean));
  if (!wanted.size) return {};
  try {
    const [panesOut, ps] = await Promise.all([
      runCmd(execFile, 'tmux', ['list-panes', '-a', '-F', '#{session_name} #{pane_pid}'], timeoutMs),
      procMap({ execFile, readFile, timeoutMs }),
    ]);
    const panes = parsePaneLines(panesOut);
    const scoped = {};
    for (const s of wanted) {
      if (panes[s]) scoped[s] = panes[s];
    }
    return sumSessionTrees(scoped, ps);
  } catch {
    return {};
  }
}
