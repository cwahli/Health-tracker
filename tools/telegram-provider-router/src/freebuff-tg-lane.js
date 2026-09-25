#!/usr/bin/env node
/**
 * Freebuff Telegram lane (EXPERIMENTAL, off by default).
 *
 * Ticket: TG-CLINE-FREEBUFF-LONGTERM follow-up — "Freebuff is terminal-only"
 * today because the CLI (0.0.195) is TUI/`login` only: no `chat -m` one-shot,
 * and the HTTP `POST /api/v1/chat/completions` answers "No runId found".
 *
 * Correction 2026-09-25: the Freebucks pool is NOT 0. The earlier "0 until
 * 2026-10-16" came from `/api/v1/usage`, which is the WALLET/subscription
 * balance in account credit — a different currency. The pool the picker
 * spends lives at `/api/v1/freebuff/session` (10 of 25 left that day, resets
 * 17:00 Asia/Jakarta). This lane now reads the pool, and only
 * `stealth/space-bunny-alpha` is 0 FB.
 *
 * What this module does: drive ONE Freebuff CLI session in tmux per Telegram
 * request (same mechanics as ht-run/ht-watch, but owned by the router
 * process), with guards that make it safe to leave wired in:
 *
 *   1. ENABLED only when `FREEBUFF_TG_LANE=1` (default off → old text).
 *   2. YIELDS to a live human CLI session: the account supports a single
 *      Freebuff instance; starting a second takes over and kills the first.
 *      When the instance-owner pid is alive, the lane refuses with an honest
 *      message and never spawns.
 *   3. SINGLE-FLIGHT: one poller process = one lane mutex. A second
 *      concurrent Telegram message gets an honest busy verdict, never a
 *      second session.
 *   4. BALANCE pre-check (read-only usage call, token never logged): 0
 *      balance + non-0/hr model → honest empty message WITHOUT spawning a
 *      session. 0/hr picker entries (GLM 5.3 / MiMo 2.6) may proceed.
 *   5. ALWAYS cleans up: the tmux session is killed in `finally`, the mutex
 *      released in `finally`, every terminal exit is a short verdict.
 *
 * Turn boundary (the hard part — the TUI has no reply-done signal):
 * after typing the prompt, wait for `working...`/`Thinking` to appear, then
 * for it to disappear AND the pane to stay unchanged for QUIET_MS. The reply
 * is the pane text added since the prompt was typed, minus TUI chrome lines.
 * Best-effort and documented as such; covered by stub tests, NOT yet proven
 * against the live vendor (needs funded balance + idle account).
 *
 * Pure + injectable: `exec` (argv → {stdout,code}), `sleep`, `now`,
 * `fetchFn`, fs paths. No network/child processes under test — the unit
 * suite drives a scripted fake instead (never start a real second freebuff;
 * HARD RULES).
 */
import { execFile } from "child_process";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export const FREEBUFF_TG_LANE_ENV = "FREEBUFF_TG_LANE";
export const FREEBUFF_OWNER_FILE = "freebuff-instance-owner.json";
export const FREEBUFF_SESSION_URL = "https://www.codebuff.com/api/v1/freebuff/session";
/**
 * 0-cost picker entries. Corrected 2026-09-25 from the published price list
 * (`GET /api/v1/freebuff/session` → freebucks.prices): only
 * `stealth/space-bunny-alpha` is 0 FB. GLM 5.3 Flash costs 5 and MiMo 2.6 is
 * not even published — the old list called both "0/hr", which was wrong.
 */
export const ZERO_HR_HINTS = [/space-?bunny/i, /0\s*(fb|\/hr)/i];

/** Gate: explicit opt-in only. Default off preserves terminal-only behaviour. */
export function freebuffLaneEnabled(env = process.env) {
  return String(env?.[FREEBUFF_TG_LANE_ENV] || "") === "1";
}

export function defaultCredsPath(env = process.env) {
  return env?.FREEBUFF_CREDS_PATH || join(homedir(), ".config", "manicode", "credentials.json");
}

export function defaultOwnerPath(env = process.env) {
  return env?.FREEBUFF_OWNER_PATH || join(homedir(), ".config", "manicode", FREEBUFF_OWNER_FILE);
}

/** 0/hr picker entries bill nothing while running (balance-0 may proceed). */
export function isZeroHrModel(model) {
  const m = String(model || "");
  if (/0\s*(fb|\/hr)/i.test(m)) return true;
  return ZERO_HR_HINTS.some((re) => re.test(m));
}

function redact(err) {
  // Auth tokens must never reach chat/logs: keep only the shape of failures.
  const m = String(err?.message || err || "unknown error");
  return m.replace(/[A-Za-z0-9\-_]{20,}/g, "…").slice(0, 200);
}

function readJsonFile(p) {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Freebucks pool probe — READ-ONLY, from the same endpoint the TUI picker
 * renders (`/api/v1/freebuff/session`).
 *
 * Corrected 2026-09-25: this used to read `/api/v1/usage`, which reports the
 * WALLET/subscription balance in account credit (0 here, "resets 2026-10-16").
 * That is a different currency from the Freebucks the picker spends — the pool
 * was 10/25 the same day. Reading the wrong endpoint made the lane refuse
 * every model as "balance 0". There is deliberately NO fallback to /usage: on
 * an uncertain pool the lane refuses (never burns blindly).
 *
 * Returns {balance, resetAt, walletBalance} or {error}.
 */
export async function readFreebucksBalance({ fetchFn = globalThis.fetch, credsPath, env = process.env } = {}) {
  const creds = readJsonFile(credsPath || defaultCredsPath(env));
  const inner = (creds && (creds.default || creds)) || {};
  const token = inner.authToken || inner.token || inner.accessToken || "";
  if (!token) return { error: "not signed in" };
  try {
    // Single authed call. The token is used here and never logged, echoed,
    // or interpolated into any user-facing string (see redact()).
    const authed = await fetchFn(FREEBUFF_SESSION_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(20000),
    });
    if (!authed.ok) return { error: `session HTTP ${authed.status}` };
    const d = await authed.json().catch(() => ({}));
    const fb = d?.freebucks || {};
    const daily = fb.daily || {};
    const bal = Number(daily.remaining ?? fb.balance ?? NaN);
    if (!Number.isFinite(bal)) return { error: "session payload has no Freebucks pool" };
    return {
      balance: bal,
      resetAt: daily.resetAt || null,
      dailyLimit: Number(daily.limit) || 0,
      walletBalance: Number(fb.wallet?.balance) || 0,
      accessTier: String(d?.accessTier || "unknown"),
    };
  } catch (e) {
    return { error: redact(e) };
  }
}

/**
 * A live human CLI session owns the account (single instance per account).
 * Owner file: {instanceId, pid}. pidAlive defaults to signal-0 probe.
 */
export function humanSessionPid({ ownerPath, env = process.env, pidAlive } = {}) {
  const rec = readJsonFile(ownerPath || defaultOwnerPath(env));
  const pid = Number(rec?.pid || 0);
  if (!Number.isFinite(pid) || pid <= 0) return 0;
  try {
    if (pidAlive) return pidAlive(pid) ? pid : 0;
    process.kill(pid, 0);
    return pid;
  } catch {
    return 0;
  }
}

export function humanSessionActive(opts = {}) {
  return humanSessionPid(opts) > 0;
}

/**
 * Takeover policy. The account allows ONE Freebuff instance, so a Telegram run
 * either waits or closes the terminal session first.
 *   off  (default) — never close; yield to the human session.
 *   idle           — close the terminal session ONLY when it looks idle
 *                    (no working/Thinking marker, pane unchanged across the
 *                    sample window), then run. "Looks idle" is a bounded
 *                    heuristic, not proof: keep `off` while a long job runs.
 */
export function takeoverMode(env = process.env) {
  const m = String(env?.FREEBUFF_TG_TAKEOVER || "off").toLowerCase();
  return m === "idle" ? "idle" : "off";
}

// Active-work markers only. Deliberately NOT "coding": the Freebuff prompt
// screen always reads "Enter a coding task", so matching that word marked every
// idle session busy (caught by the takeover tests) and takeover never ran.
const BUSY_MARKER = /\bworking\b|\bThinking\b|\bApplying\b|\bReviewing\b|\bPlanning\b|\bStreaming\b/i;

/** tmux session that owns a pid, via the pane's tty. "" when not found. */
async function tmuxSessionForPid(exec, pid) {
  const tty = (await exec(["ps", "-o", "tty=", "-p", String(pid)])).stdout.trim();
  if (!tty) return "";
  const rows = (await exec(["tmux", "list-panes", "-a", "-F", "#{session_name}\t#{pane_tty}"])).stdout || "";
  for (const line of rows.split(/\r?\n/)) {
    const [session, paneTty] = line.split("\t");
    if (paneTty && paneTty.replace(/^\/dev\//, "") === tty.replace(/^\/dev\//, "")) return String(session || "");
  }
  return "";
}

/**
 * Is the human session busy? Two samples across `windowMs`: a pane that shows
 * work (or changes) is treated as in-use and is never closed.
 */
export async function assessHumanSession({ exec, sleep, pid, windowMs = 30000, pollMs = 5000 }) {
  const session = await tmuxSessionForPid(exec, pid);
  if (!session) return { session: "", busy: true, stable: false, reason: "session not in tmux (cannot prove idle)" };
  const first = (await exec(["tmux", "capture-pane", "-p", "-t", session])).stdout || "";
  if (BUSY_MARKER.test(first)) return { session, busy: true, stable: false, reason: "pane shows active work" };
  let waited = 0;
  while (waited < windowMs) {
    await sleep(pollMs);
    waited += pollMs;
    const next = (await exec(["tmux", "capture-pane", "-p", "-t", session])).stdout || "";
    if (next !== first) return { session, busy: true, stable: false, reason: "pane changed while sampling" };
  }
  return { session, busy: false, stable: true, reason: "pane idle" };
}

/**
 * Close the human session gracefully, then for real. Escape + Ctrl-C first so
 * the TUI can exit cleanly; SIGTERM, then SIGKILL as a last resort. Returns
 * what happened so the caller can report honestly.
 */
export async function closeHumanSession({ exec, sleep, pid, session, timeoutMs = 30000 }) {
  const out = { graceful: false, signalled: false, forced: false, closed: false };
  if (session) {
    try {
      await exec(["tmux", "send-keys", "-t", session, "Escape"]);
      await sleep(500);
      await exec(["tmux", "send-keys", "-t", session, "C-c"]);
      out.graceful = true;
    } catch {}
  }
  const alive = async () => {
    try {
      const r = await exec(["kill", "-0", String(pid)]);
      return Boolean(r) && r.code === 0;
    } catch {
      return false;
    }
  };
  const waitGone = async (ms) => {
    let waited = 0;
    while (waited < ms) {
      if (!(await alive())) return true;
      await sleep(1000);
      waited += 1000;
    }
    return !(await alive());
  };
  if (await waitGone(5000)) {
    out.closed = true;
    return out;
  }
  try {
    await exec(["kill", "-TERM", String(pid)]);
    out.signalled = true;
  } catch {}
  if (await waitGone(Math.max(5000, timeoutMs - 10000))) {
    out.closed = true;
    return out;
  }
  try {
    await exec(["kill", "-KILL", String(pid)]);
    out.forced = true;
  } catch {}
  out.closed = await waitGone(5000);
  return out;
}

// ---- single-flight mutex (one poller process) ----
let laneHeld = false;
/** tryAcquire: true = we own the lane; false = busy (caller reports honestly). */
export function tryAcquireLane() {
  if (laneHeld) return false;
  laneHeld = true;
  return true;
}
export function releaseLane() {
  laneHeld = false;
}
export function _laneHeldForTests() {
  return laneHeld;
}

// ---- tmux driving (injectable exec) ----
function defaultExec(argv, { timeoutMs = 15000 } = {}) {
  return new Promise((resolve) => {
    execFile(argv[0], argv.slice(1), { timeout: timeoutMs, encoding: "utf8" }, (err, stdout) => {
      resolve({ stdout: String(stdout || ""), code: err ? 1 : 0 });
    });
  });
}
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CHROME_LINE = /working\.\.\.|Thinking|Enter a coding task|Freebucks left|Session ended|Press Enter to continue|^[╭╰│─\s]*$/;
const ALIVE_LINE = /working\.\.\.|Thinking/;

/** Strip TUI chrome; keep candidate reply lines. */
export function stripChrome(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !CHROME_LINE.test(l));
}

/**
 * Numbered picker entry ("2) GLM 5.3 Flash (0/hr)") matching a model.
 *
 * Menu entries carry display names, not ids, so match on words from the model's
 * tail and require the best label to share at least TWO of them — a single
 * shared word ("Muse") would happily select the wrong model, and defaulting to
 * plain Enter is safer than typing a wrong digit. Returns "" when nothing
 * matches confidently (the caller then accepts the default model).
 */
export function pickerChoiceFor(lines, model) {
  const tokens = [...new Set(
    String(model || "")
      .replace(/^[^/]+\//, "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3)
  )];
  if (tokens.length < 2) return "";
  let best = { num: "", score: 0 };
  for (const raw of lines) {
    const mt = String(raw || "").match(/^[ \t]*(\d{1,2})[.)][ \t]+(.+)$/);
    if (!mt) continue;
    const label = mt[2].toLowerCase();
    const score = tokens.filter((t) => label.includes(t)).length;
    if (score > best.score) best = { num: mt[1], score };
  }
  return best.score >= 2 ? best.num : "";
}

async function waitFor(pollFn, { timeoutMs, pollMs, exec, sleep }) {
  const t0 = Date.now();
  for (;;) {
    const v = await pollFn();
    if (v) return v;
    if (Date.now() - t0 >= timeoutMs) return null;
    await sleep(pollMs);
  }
}

/**
 * Full lane run. All paths return {ok, text} user-facing; never throws.
 * NEVER call with a live human session active — checked inside, double-guard.
 */
export async function runFreebuffLane({
  prompt,
  model = "",
  session = `tg-fb-${Date.now().toString(36)}`,
  env = process.env,
  exec = defaultExec,
  sleep = defaultSleep,
  now = Date.now,
  fetchFn = globalThis.fetch,
  credsPath,
  ownerPath,
  workspace,
  onProgress,
  timeouts = {},
} = {}) {
  const T = {
    taskPromptMs: timeouts.taskPromptMs || 60000,
    workingAppearMs: timeouts.workingAppearMs || 120000,
    totalMs: timeouts.totalMs || 600000,
    pollMs: timeouts.pollMs || 2000,
    quietMs: timeouts.quietMs || 15000,
    takeoverIdleMs: timeouts.takeoverIdleMs ?? Number(env?.FREEBUFF_TG_TAKEOVER_IDLE_MS || 30000),
    takeoverPollMs: timeouts.takeoverPollMs ?? Number(env?.FREEBUFF_TG_TAKEOVER_POLL_MS || 5000),
  };
  const fail = (text) => ({ ok: false, text });
  if (!freebuffLaneEnabled(env)) return fail("Freebuff Telegram lane is off (FREEBUFF_TG_LANE=1 to enable).");
  if (!String(prompt || "").trim()) return fail("Empty prompt — nothing sent to Freebuff.");
  const run = async (argv, o) => exec(argv, o);
  const cap = async () => (await run(["tmux", "capture-pane", "-p", "-t", session])).stdout;
  const progress = (t) => {
    try {
      onProgress?.(t);
    } catch {}
  };

  if (!tryAcquireLane()) {
    return fail("Freebuff is busy with another Telegram request right now — try again in a minute. (One session per account; requests never overlap.)");
  }
  let started = false;
  try {
    const humanPid = humanSessionPid({ ownerPath, env });
    if (humanPid) {
      if (takeoverMode(env) !== "idle") {
        return fail(
          "Your terminal Freebuff session is active — Telegram yields to it (one session per account). " +
            "Close it, or set FREEBUFF_TG_TAKEOVER=idle to let Telegram close an IDLE session automatically."
        );
      }
      // takeover=idle: prove it looks idle before touching someone's session.
      const assess = await assessHumanSession({
        exec,
        sleep,
        pid: humanPid,
        windowMs: T.takeoverIdleMs,
        pollMs: T.takeoverPollMs,
      });
      if (assess.busy) {
        return fail(
          `Your terminal Freebuff session looks busy (${assess.reason}) — not closing it. ` +
            "Wait for it to go idle, or set FREEBUFF_TG_TAKEOVER=off to never close it."
        );
      }
      const closed = await closeHumanSession({ exec, sleep, pid: humanPid, session: assess.session, timeoutMs: 30000 });
      if (!closed.closed) {
        return fail("Could not close the idle terminal Freebuff session — not starting a second one. Close it and retry.");
      }
      progress(
        `Closed the idle terminal Freebuff session (${closed.forced ? "forced" : "graceful"}) to run your request.`
      );
    }
    const bal = await readFreebucksBalance({ fetchFn, credsPath, env });
    if (bal.error && bal.error !== "not signed in") {
      return fail(`Freebuff balance check failed (${bal.error}) — not starting a session. Terminal use is unaffected.`);
    }
    if (!bal.error && !(bal.balance > 0) && !isZeroHrModel(model)) {
      return fail(
        `Freebucks pool is empty${bal.resetAt ? ` (resets ${bal.resetAt})` : ""} — not starting a paid session from Telegram. ` +
          `Space Bunny Alpha is the only 0 FB model, or run \`freebuff\` in a terminal.`
      );
    }

    const cwd = workspace || env?.HT_WORKSPACE || `${homedir()}/src/Health-tracker`;
    await run(["tmux", "kill-session", "-t", session]);
    await run(["tmux", "new-session", "-d", "-s", session, "-x", "200", "-y", "50", `cd ${cwd} && freebuff --trust-agents; exec bash`]);
    started = true;
    const t0 = now();
    const remain = () => T.totalMs - (now() - t0);

    // 1. wait for the task prompt ("Enter a coding task"), accept default model
    const pane1 = await waitFor(async () => {
      const p = await cap();
      return /Enter a coding task/.test(p) ? p : null;
    }, { timeoutMs: Math.min(T.taskPromptMs, remain()), pollMs: T.pollMs, exec, sleep });
    if (!pane1) return fail("Freebuff did not reach the task prompt in time — session closed, nothing burned. Try again or use the terminal.");
    // Accept the default model, then check whether a picker menu appeared:
    // pick the requested 0/hr entry by its number, else plain Enter (default).
    await run(["tmux", "send-keys", "-t", session, "Enter"]);
    await sleep(2000);
    const afterEnter = await cap();
    const menuPick = pickerChoiceFor(afterEnter.split(/\r?\n/), model);
    if (menuPick) {
      await run(["tmux", "send-keys", "-t", session, menuPick]);
      await sleep(1000);
      await run(["tmux", "send-keys", "-t", session, "Enter"]);
      await sleep(2000);
    }
    // re-wait for a FRESH task prompt (stale pre-picker line must not count)
    const fresh = await waitFor(async () => {
      const p = await cap();
      if (/Enter a coding task/.test(p) && !/Session ended|Press Enter to continue/.test(p)) return p;
      return null;
    }, { timeoutMs: Math.min(30000, remain()), pollMs: T.pollMs, exec, sleep });
    if (!fresh) return fail("Freebuff model picker did not settle — session closed. Try again or use the terminal.");
    const before = fresh;

    // 2. type the prompt
    await run(["tmux", "send-keys", "-t", session, "-l", String(prompt)]);
    await run(["tmux", "send-keys", "-t", session, "Enter"]);
    progress(`Freebuff working… prompt sent${model ? ` (${model})` : ""}. Waiting for the reply (one session per account).`);

    // 3. working appears…
    const working = await waitFor(async () => (ALIVE_LINE.test(await cap()) ? true : null), {
      timeoutMs: Math.min(T.workingAppearMs, remain()), pollMs: T.pollMs, exec, sleep,
    });
    if (!working) return fail("Freebuff never showed activity after the prompt — session closed. The prompt was not processed; try again or use the terminal.");

    // 4. …then gone AND pane quiet
    let lastHash = "";
    let quietSince = 0;
    const done = await waitFor(async () => {
      const p = await cap();
      if (ALIVE_LINE.test(p)) {
        quietSince = 0;
        return null;
      }
      const h = `${p.length}:${p.slice(-200)}`;
      if (h !== lastHash) {
        lastHash = h;
        quietSince = now();
        return null;
      }
      return now() - quietSince >= T.quietMs ? p : null;
    }, { timeoutMs: Math.min(remain(), T.totalMs), pollMs: T.pollMs, exec, sleep });
    if (!done) return fail("Freebuff ran past the Telegram lane timeout — session closed to free the account. Check the terminal or retry with a smaller ask.");

    // 5. reply = new non-chrome lines since the prompt went in, minus the
    // echoed prompt line itself (TUI echoes what was typed).
    const strip = (t) => new Set(stripChrome(t));
    const seen = strip(before);
    const promptEcho = String(prompt || "").trim().replace(/\s+/g, " ");
    const freshLines = stripChrome(done).filter((l) => !seen.has(l) && l.replace(/\s+/g, " ") !== promptEcho);
    const reply = freshLines.join("\n").slice(0, 3500).trim();
    if (!reply) return fail("Freebuff finished but no reply text was captured — session closed. Try again or use the terminal for this one.");
    return { ok: true, text: reply };
  } catch (e) {
    return fail(`Freebuff lane error (${redact(e)}) — session closed. Terminal use is unaffected.`);
  } finally {
    if (started) {
      try {
        await exec(["tmux", "kill-session", "-t", session]);
      } catch {}
    }
    releaseLane();
  }
}
