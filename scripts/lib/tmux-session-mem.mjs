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
 * `ps -eo pid,ppid,rss` → { pid: { ppid, rssKb } }. The header and any
 * malformed row are skipped (first token must be numeric).
 */
export function parsePsLines(text) {
  const out = {};
  for (const line of String(text || '').split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3 || !/^\d+$/.test(parts[0] || '')) continue;
    if (!/^\d+$/.test(parts[1]) || !/^\d+$/.test(parts[2])) continue;
    out[Number(parts[0])] = { ppid: Number(parts[1]), rssKb: Number(parts[2]) };
  }
  return out;
}

/**
 * Sum RSS (MiB, rounded) over each session's pane trees. A process reachable
 * from two sessions counts in both — shared pages are overcounted in RSS
 * already, so the figures stay comparable upper bounds. Sessions with no
 * matched process are omitted (unknown, not zero).
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
      kb += row.rssKb;
      const kids = children.get(p);
      if (kids) stack.push(...kids);
    }
    if (kb > 0) out[session] = Math.round(kb / 1024);
  }
  return out;
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
 * One `tmux list-panes` + one `ps`, mapped onto the requested tmux session
 * names. `execFile` is injectable (same callback shape as node's) so tests
 * never spawn. Resolves {} on any failure or empty input.
 */
export async function collectSessionMem({ sessions = [], execFile = defaultExecFile, timeoutMs = 5000 } = {}) {
  const wanted = new Set((Array.isArray(sessions) ? sessions : []).filter(Boolean));
  if (!wanted.size) return {};
  try {
    const [panesOut, psOut] = await Promise.all([
      runCmd(execFile, 'tmux', ['list-panes', '-a', '-F', '#{session_name} #{pane_pid}'], timeoutMs),
      runCmd(execFile, 'ps', ['-eo', 'pid,ppid,rss'], timeoutMs),
    ]);
    const panes = parsePaneLines(panesOut);
    const ps = parsePsLines(psOut);
    const scoped = {};
    for (const s of wanted) {
      if (panes[s]) scoped[s] = panes[s];
    }
    return sumSessionTrees(scoped, ps);
  } catch {
    return {};
  }
}
