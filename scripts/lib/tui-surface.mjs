/**
 * Which tool the /tui terminal launches, and what it is allowed to claim.
 *
 * One decision, three consumers: bot-host writes it into `tui-open.json` and
 * names the tool in the reply, `tui-attach.sh` builds the launch argv from it,
 * and the sensors pin it. It used to live only in the shell script, hardcoded to
 * OpenCode, so a chat that had switched to Cline with `/freemodel` opened an
 * OpenCode TUI on a stale opencode session id — a different agent on a different
 * thread from the one answering in Telegram.
 *
 * The honesty split is the point of this file:
 *
 * - `opencode` — a background server serialises turns, so the bot and the
 *   terminal are two clients of ONE session. `sharedSession: true`.
 * - `cline`    — no headless resume. Measured on 3.0.65, re-verified on 3.0.68 2026-10-04: `cline --id <id> --json`
 *   answers "JSON output mode requires a prompt argument or piped stdin
 *   (interactive mode is unsupported)" and `cline --id <id>` without a TTY
 *   answers "interactive mode requires a TTY". `-i` is the only mode that
 *   accepts `--id`, so the terminal can resume the LAST Cline thread and
 *   nothing after it. `sharedSession: false` — a turn must never be advertised
 *   as visible in a terminal that cannot see it.
 * - `gemini`   — an API-only lane with no screen at all. `terminal: false`; a
 *   scraped PTY with a badge is not a terminal.
 */

import fs from 'node:fs';
import path from 'node:path';

import { CLINE_SESSION_ID_RE, clineSessionsDir, listClineSessionIds } from './agent-cline.mjs';
import { laneFor } from './lane-contract.mjs';

export const TUI_SURFACES = {
  opencode: { surface: 'opencode', tool: 'OpenCode', label: 'opencode TUI', terminal: true, sharedSession: true },
  cline: { surface: 'cline', tool: 'Cline', label: 'Cline TUI', terminal: true, sharedSession: false },
  gemini: { surface: 'gemini', tool: 'Gemini', label: 'Gemini', terminal: false, sharedSession: false },
};

export const DEFAULT_TUI_SURFACE = 'opencode';

/** The surface a model ref names. Anything unrecognised is the default lane. */
export function surfaceForModel(model) {
  const raw = String(model || '').trim().toLowerCase();
  if (raw.startsWith('cline:')) return 'cline';
  if (raw.startsWith('gemini:')) return 'gemini';
  return DEFAULT_TUI_SURFACE;
}

/**
 * Accepts either a model ref (`cline:cline-free/x`) or a bare surface name
 * (`cline`). Two sources feed the attach script — the chat's live `prefs.json`
 * model and the `surface` snapshot bot-host wrote into `tui-open.json` — and
 * they are spelled differently.
 */
export function normalizeSurface(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (TUI_SURFACES[raw]) return raw;
  return surfaceForModel(raw);
}

export function tuiSurfaceFor(model) {
  return { ...(TUI_SURFACES[normalizeSurface(model)] || TUI_SURFACES[DEFAULT_TUI_SURFACE]) };
}

/** A session id of the shape the named tool actually issues. */
export function sessionIdMatchesSurface(id, surface) {
  const raw = String(id || '').trim();
  if (!raw) return false;
  return surface === 'cline' ? CLINE_SESSION_ID_RE.test(raw) : /^ses_/.test(raw);
}

function quote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

/**
 * argv for the terminal.
 *
 * `resolveOpencodeBin` / `resolveClineBin` are injected so the argv can be
 * pinned without either binary existing on the box running the tests.
 *
 * Returns argv (never a shell string) plus the honest one-liner for the banner.
 * An unknown or non-terminal surface yields `null` argv — the caller must refuse
 * rather than fall back to OpenCode, because a silent fallback is the exact bug
 * this module exists to remove.
 */
export function resolveTuiLaunch({
  surface = DEFAULT_TUI_SURFACE,
  model = '',
  sessionId = '',
  workspace = '',
  opencodeBin = 'opencode',
  clineBin = 'cline',
  resolveOpencode = (v) => v,
  resolveCline = (v) => v,
} = {}) {
  const known = TUI_SURFACES[surface];
  if (!known) return { argv: null, ...TUI_SURFACES[DEFAULT_TUI_SURFACE], reason: `unknown surface "${surface}"` };
  if (!known.terminal) return { argv: null, ...known, reason: `${known.tool} has no terminal` };

  if (surface === 'cline') {
    // The lane contract already records cline as degraded on `resume`; this is
    // the one place that is not a defect, because an interactive process is
    // exactly what accepts a session id.
    laneFor('cline');
    // `cline:` is this repo's surface prefix, not cline's own spelling — the
    // CLI wants `cline-free/deepseek-v4.1-flash`, and handing it the prefixed
    // form fails the same way an unknown model does.
    const clineModel = String(model).trim().replace(/^cline:/i, '');
    const args = [resolveCline(clineBin), '-i'];
    if (clineModel) args.push('-P', 'cline', '-m', clineModel);
    if (workspace) args.push('-c', workspace);
    if (sessionId) args.push('--id', String(sessionId));
    return {
      argv: args,
      ...known,
      note: sessionId
        ? `resumed onto Cline session ${sessionId}`
        : 'a fresh Cline session — no Cline thread has been recorded for this chat yet',
    };
  }

  const args = [resolveOpencode(opencodeBin)];
  if (sessionId) args.push('--session', String(sessionId));
  return {
    argv: args,
    ...known,
    note: sessionId ? `attached to opencode session ${sessionId}` : 'a fresh opencode session',
  };
}

/** argv joined into one shell-safe command line, for tmux's new-session. */
export function tuiLaunchCommand(launch) {
  if (!launch?.argv?.length) return '';
  return launch.argv.map(quote).join(' ');
}

/**
 * The newest Cline session recorded for this workspace, or '' when there is
 * none. Used to give a Cline terminal something to resume before the chat's next
 * turn has written `cline-sessions.json`, so the screen is the conversation the
 * user last had rather than an empty prompt.
 */
export function latestClineSessionId({ workspace = '', dir = clineSessionsDir(), readMeta } = {}) {
  const ids = listClineSessionIds(dir);
  if (!ids.length) return '';
  const dated = [];
  for (const id of ids) {
    const meta = readMeta ? readMeta(id, dir) : readClineSessionMeta(id, dir);
    if (!meta) continue;
    if (workspace && meta.cwd && meta.cwd !== workspace) continue;
    dated.push({ id, started: Date.parse(meta.started_at || '') || 0 });
  }
  if (!dated.length) return '';
  dated.sort((a, b) => b.started - a.started);
  return dated[0].id;
}

function readClineSessionMeta(id, dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, id, `${id}.json`), 'utf8'));
  } catch {
    return null;
  }
}
