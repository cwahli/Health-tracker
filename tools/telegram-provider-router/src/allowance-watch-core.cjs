"use strict";
/**
 * allowance-watch-core.cjs — shared core for the ht-allowance-watch ticket
 * (tmp/ht-allowance-watch/TICKET.md).
 *
 * Consumers:
 *   - /home/box/bin/ht-allowance-watch (node, CJS) — require()s this file
 *   - /home/box/bin/ht-watch (bash)                — calls it via `node -e`
 *   - tools/telegram-provider-router/scripts/test-allowance-watch.mjs
 *
 * Pure logic + ledger JSON shapes only: no network, no child processes
 * (CLI probes take an injectable spawnSync), no reads of the live ledger
 * unless the caller passes it in. Kept dependency-free so the live router
 * copy (~/.config/telegram-opencode/router/src/, synced by ht-ship) and the
 * repo copy behave identically.
 */

const RATE_LIMIT_TTL_MS = 45 * 60 * 1000; // default cool-off when vendor gives no countdown
const QUOTA_TTL_MS = 6 * 3600 * 1000;     // default when allowance/period empty

function parseMs(v) { const t = Date.parse(v); return Number.isFinite(t) ? t : NaN; }

function isoZ(ms) {
  const t = Number(ms);
  if (!Number.isFinite(t)) return "";
  try { return new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z"); } catch { return ""; }
}

/** Parse vendor countdown: ISO stamp or "try again in Xh Ym" style. */
function parseCountdownHint(text) {
  const s = String(text || "");
  const iso = s.match(/(20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2}))/);
  if (iso) {
    const until = parseMs(iso[1]);
    if (Number.isFinite(until) && until > Date.now()) return { until, hint: iso[1], countdownParsed: true };
  }
  const verb = s.search(/try\s+again|retry|available\s+in|resets?\s+in|come\s+back\s+in/i);
  if (verb >= 0) {
    let ms = 0; let found = false;
    const chunk = s.slice(verb, verb + 120);
    for (const m of chunk.matchAll(/(\d+)\s*(d|h|m|s)\b/gi)) {
      const n = Number(m[1]); const u = m[2].toLowerCase();
      if (!Number.isFinite(n)) continue;
      found = true;
      ms += n * (u === "d" ? 86400000 : u === "h" ? 3600000 : u === "m" ? 60000 : 1000);
    }
    if (found && ms > 0) {
      const until = Date.now() + ms;
      return { until, hint: chunk.trim().slice(0, 80), countdownParsed: true };
    }
  }
  return { until: 0, hint: "", countdownParsed: false };
}

/** Next 00:00 UTC strictly after `now` (the daily free-allowance reset used by
 *  Cloudflare Workers AI neurons and most per-day free tiers). */
function nextMidnightUtc(now = Date.now()) {
  const d = new Date(Number(now));
  if (!Number.isFinite(d.getTime())) return NaN;
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime() + 86400000;
}

/**
 * Cloudflare Workers AI error 4006 = the DAILY neurons allowance is fully used
 * ("you have used up your daily free allocation of 10,000 neurons", seen in
 * /workspace/logs 2026-09-25). It resets at the next 00:00 UTC — NOT the 45 m
 * rate-limit TTL the watcher kept re-stamping (ADDENDUM 2026-09-25 #4).
 */
function isCloudflareDailyExhausted(text) {
  const s = String(text || "");
  return /code"?\s*[:=]?\s*4006|daily\s+free\s+allocation|daily\s+neurons?\s+allowance/i.test(s);
}

/**
 * Depletion until-time + kind from vendor limit text (one policy for every
 * stamper — ht-allowance-watch probe output, ht-watch pane/log capture):
 *   - Cloudflare 4006 daily exhaustion        → next 00:00 UTC (allowance-empty)
 *   - vendor countdown (ISO or "in Xh Ym")    → that time (rate-limit only when
 *     it is a short RPM burst, not a period countdown)
 *   - rate-limit text without a countdown     → now + RATE_LIMIT_TTL_MS (45 m)
 *   - anything else                           → now + QUOTA_TTL_MS (6 h)
 */
function depletionUntilFromText(text, now = Date.now()) {
  const s = String(text || "");
  if (isCloudflareDailyExhausted(s)) return { until: nextMidnightUtc(now), kind: "allowance-empty", hint: "" };
  const cd = parseCountdownHint(s);
  if (cd.countdownParsed && cd.until > now) {
    const rl = isRateLimitText(s) && !/try\s+again\s+in\s+\d/i.test(s);
    return { until: cd.until, kind: rl ? "rate-limit" : "allowance-empty", hint: cd.hint };
  }
  const rl = isRateLimitText(s);
  return { until: now + (rl ? RATE_LIMIT_TTL_MS : QUOTA_TTL_MS), kind: rl ? "rate-limit" : "limit-unknown", hint: "" };
}

/** Short-window rate limit (re-probe soon) vs period/allowance empty (long TTL). */
function isRateLimitText(s) {
  const t = String(s || "");
  return /rate\s*limit\s*exceeded|rate[-\s]?limited|too\s+many\s+requests|\b429\b/i.test(t)
    && !/rolling\s+7-day|period'?s\s+free\s+allowance/i.test(t);
}

function isQuotaText(s) {
  return /rate\s*limit|429|quota|exceeded|free\s+allowance|insufficient|allowance|too\s+many\s+requests|try\s+again|free\s+usage\s+limit|daily\s+free\s+(model\s+)?(usage\s+)?limit|limit\s+reached/i
    .test(String(s || ""));
}

/** Shared bucket id for a lane, or null for per-model (mirrors free-lane-table.js). */
function sharedBucketIdFor(lane) {
  const b = String((lane && lane.bucket) || "");
  if (!b || /per-model/i.test(b)) return null;
  return b;
}

function quotaKeyFor(lane) {
  const bid = sharedBucketIdFor(lane);
  if (bid) return { key: `bucket:${bid}`, shared: true, bucketId: bid };
  return { key: `${lane.provider}/${lane.model}`, shared: false, bucketId: null };
}

/**
 * Sweep plan: which depleted lanes are due now and when the next wake-up is.
 * "Soonest nextResetAt/cooldownUntil among depleted lanes" (+ grace handled by
 * the caller). Lanes with no known time only affect `hasUnknown`.
 */
function computeSweepPlan(tbl, now = Date.now()) {
  const lanes = Array.isArray(tbl && tbl.lanes) ? tbl.lanes : [];
  const dueAtFor = (lane) => {
    const cands = [parseMs(lane.nextResetAt), parseMs(lane.cooldownUntil)].filter(Number.isFinite);
    return cands.length ? Math.min(...cands) : NaN;
  };
  const depleted = lanes.filter((l) => l && l.status === "depleted");
  const due = depleted.filter((l) => Number.isFinite(dueAtFor(l)) && dueAtFor(l) <= now);
  const withTime = depleted.filter((l) => Number.isFinite(dueAtFor(l)));
  const soonest = withTime.length ? Math.min(...withTime.map(dueAtFor)) : NaN;
  return { now, lanes, depleted, due, soonest, hasUnknown: depleted.length > withTime.length };
}

/** Which cheap probe applies to a lane. */
function pickProbeKind(lane) {
  const provider = String((lane && lane.provider) || "").toLowerCase();
  const model = String((lane && lane.model) || "");
  if (provider === "freebuff") return { kind: "skip", why: "freebuff is terminal-only (no cheap probe)" };
  if (provider === "tokenharbor") return { kind: "tokenharbor" };
  if (provider === "cloudflare" || model.includes("@cf/") || model.startsWith("cloudflare/")) return { kind: "cloudflare" };
  if (provider === "cline") return { kind: "cline" };
  if (provider === "opencode") return { kind: "opencode" };
  return { kind: "skip", why: `no probe for provider ${provider || "?"}` };
}

/**
 * Probe result → status for CLI probes (opencode/cline). spawnSyncFn is
 * injectable so tests can stub lanes without touching vendors.
 */
function probeCli(spawnSyncFn, bin, args, timeoutMs, { cwd } = {}) {
  let res;
  try {
    res = spawnSyncFn(bin, args, { timeout: timeoutMs, encoding: "utf8", cwd });
  } catch (e) {
    return { status: "uncertain", output: `spawn failed: ${e.message || e}` };
  }
  const out = `${res.stdout || ""}\n${res.stderr || ""}`.trim();
  if (res.error && res.error.code === "ENOENT") return { status: "uncertain", output: `${bin}: not installed` };
  if (isQuotaText(out)) return { status: "depleted", output: out.slice(-600) };
  const okExit = res.status === 0 || (out && !res.error);
  if (okExit && out) return { status: "available", output: out.slice(-600) };
  if (res.error || res.status === null) return { status: "uncertain", output: `timeout/signal: ${out.slice(-300) || (res.error && res.error.code) || "killed"}` };
  return { status: "uncertain", output: `exit ${res.status}: ${out.slice(-400)}` };
}

/**
 * Stamp lanes (whole shared bucket when bucketId is set) as depleted, in the
 * same JSON shape as the router's markDepleted auto-capture, so /allowance and
 * /freemodel reflect it. Mutates tbl + session in place.
 */
function stampDepleted(tbl, session, lanes, bucketId, { until, hint, kind, lastError, source }) {
  const nowIso = isoZ(Date.now());
  const untilIso = isoZ(until);
  const label = `${untilIso} (${hint ? `from vendor countdown ${hint.slice(0, 60)}` : "default TTL, no countdown in vendor text"})`;
  const rateLimited = kind === "rate-limit";
  const rec = {
    depletedUntil: until,
    lastError: String(lastError || "probe: still limited").slice(0, 300),
    scope: bucketId ? "shared" : "per-model",
    depletedObservedAt: nowIso,
    countdownParsed: !!hint,
    kind: rateLimited ? "rate-limit" : (hint ? "allowance-empty" : "limit-unknown"),
  };
  if (hint) rec.countdownHint = hint;
  if (bucketId) {
    rec.bucket = bucketId;
    rec.hitBy = String((lanes[0] && lanes[0].model) || "").includes("/")
      ? String(lanes[0].model)
      : `${(lanes[0] && lanes[0].provider) || "?"}/${(lanes[0] && lanes[0].model) || "?"}`;
  }
  if (!session.quota) session.quota = {};
  session.quota[bucketId ? `bucket:${bucketId}` : `${lanes[0].provider}/${lanes[0].model}`] = rec;

  for (const lane of lanes) {
    lane.status = "depleted";
    lane.depletedObservedAt = nowIso;
    lane.nextResetAt = untilIso;
    lane.cooldownUntil = untilIso;
    lane.nextReset = label;
    lane.cooldownLeft = "until reset";
    if (hint) { lane.countdownHint = hint; } else if ("countdownHint" in lane) { delete lane.countdownHint; }
    lane.lastPingAt = nowIso;
    lane.lastPingNote = source || "ht-allowance-watch probe";
  }
  if (bucketId && tbl.buckets && tbl.buckets[bucketId]) {
    tbl.buckets[bucketId].nextResetAt = untilIso;
    tbl.buckets[bucketId].nextResetLabel = label;
  }
  return { untilIso, label };
}

/**
 * Flip lanes back to available after a successful probe and clear live session
 * quota records so the overlay cannot resurrect "depleted".
 */
function stampAvailable(tbl, session, lanes, bucketId, { source } = {}) {
  const nowIso = isoZ(Date.now());
  const clearedKeys = [];
  for (const lane of lanes) {
    lane.status = "available";
    lane.nextResetAt = null;
    lane.cooldownUntil = null;
    lane.cooldownLeft = "-";
    lane.nextReset = lane.resetRule || ((tbl.buckets && tbl.buckets[bucketId] && tbl.buckets[bucketId].resetRule) || "bucket reset rule");
    lane.lastPingAt = nowIso;
    lane.lastPingNote = source || "ht-allowance-watch probe: OK";
  }
  if (session.quota) {
    const keys = [];
    if (bucketId) keys.push(`bucket:${bucketId}`);
    for (const lane of lanes) keys.push(`${lane.provider}/${lane.model}`);
    for (const k of keys) {
      if (k in session.quota) { delete session.quota[k]; clearedKeys.push(k); }
    }
  }
  if (bucketId && tbl.buckets && tbl.buckets[bucketId]) {
    if (tbl.buckets[bucketId].nextResetAt) {
      tbl.buckets[bucketId].nextResetAt = null;
      tbl.buckets[bucketId].nextResetLabel = tbl.buckets[bucketId].resetRule || "available";
    }
  }
  return { clearedKeys };
}

// ---------------------------------------------------------------------------
// ht-watch per-tool quota detection. These match tool STATUS lines/logs only —
// never arbitrary pane text — so "429" inside source files / code being read
// cannot false-positive (that FP happened 2026-09-24 ~22:0x; see HARD RULES).
// ---------------------------------------------------------------------------

/**
 * OpenCode current-run quota from opencode.log lines: latest "Rate limit
 * exceeded"-ish line with no later attempt started and >= silenceMs of silence
 * (OpenCode hangs silently on quota), and not older than maxAgeMs.
 *
 * "Later activity" only counts a new attempt (message=stream, "llm runtime
 * selected", "step …"): benign post-run noise (git snapshot "cleanup failed"
 * WARNs etc.) must not suppress a real final quota error.
 * opts.finished=true skips the silence wait (run already exited — ht-run's
 * "=== <session> finished" marker); the no-later-attempt + maxAge rules still
 * apply. Returns the modelID from the log ("" when absent) or null = not quota.
 */
function opencodeLogQuota(lines, now = Date.now(), { silenceMs = 90000, maxAgeMs = 6 * 3600 * 1000, finished = false } = {}) {
  let lastErr = -1; let lastErrModel = ""; let lastAttempt = -1;
  for (const line of lines) {
    const tsM = line.match(/timestamp=(\d{4}-\d{2}-\d{2}T[^\s]+)/);
    const ts = tsM ? Date.parse(tsM[1]) : NaN;
    const t = Number.isFinite(ts) ? ts : NaN;
    if (/message=(stream\b|"llm runtime selected"|"step )/.test(line) && Number.isFinite(t) && t > lastAttempt) lastAttempt = t;
    if (/Rate limit exceeded|free allowance|INFERENCE_CAP|too many requests/i.test(line)) {
      if (Number.isFinite(t) && t > lastErr) {
        lastErr = t;
        const m = line.match(/modelID=([^\s]+)/);
        lastErrModel = m ? m[1] : "";
      }
    }
  }
  if (lastErr < 0) return null;                // no quota line at all
  if (lastAttempt > lastErr) return null;      // a later attempt started: not stuck
  if (!finished && now - lastErr < silenceMs) return null; // wait silenceMs of silence first
  if (now - lastErr > maxAgeMs) return null;   // too old: not this run
  return lastErrModel || "";
}

/**
 * OpenCode Zen (Space Bunny / Muse, bucket opencode-zen-free) hangs SILENTLY on
 * a rate limit — no error line, no step, just no output (ADDENDUM 2026-09-25
 * #5/#8). For those models "no output for 3 min" IS the rate-limit signal;
 * Cloudflare-backed lanes keep the shorter 90 s log rule (they do log 429s).
 */
const OPENCODE_ZEN_SILENCE_MS = 3 * 60 * 1000;

function isOpenCodeZenModel(model) {
  return /muse|mimo|zen|space-?bunny/i.test(String(model || ""));
}

/** Silence window before an OpenCode lane reads as rate-limited. */
function opencodeSilenceMsForModel(model, { defaultMs = 90000, zenMs = OPENCODE_ZEN_SILENCE_MS } = {}) {
  return isOpenCodeZenModel(model) ? Number(zenMs) : Number(defaultMs);
}

/**
 * Cline quota line from this run's output. A line qualifies only when it is a
 * plain status line: no leading prompt/code-quote chars, no `=`, `(`, `->`,
 * `{` (code being read/pasted), and it matches a vendor quota phrase.
 * Returns the matched line(s) (max 2, joined) or "" = no quota.
 */
function matchClineQuotaLine(lines) {
  const exclude = /^[ \t]*[>#$-]|\(|\);|->|\{|=/;
  const phrase = /daily free (model )?(usage )?limit reached|you.?ve reached (today.s |your )?free usage limit|rate limit exceeded|too many requests|exceeded your current quota|insufficient[_ ]quota|quota (exceeded|exhausted)|free allowance/i;
  const arr = Array.isArray(lines) ? lines : String(lines || "").split(/\r?\n/);
  const hits = arr.filter((l) => !exclude.test(l) && phrase.test(l));
  return hits.slice(-2).join("\n");
}

/**
 * Freebuff Freebucks quota line ("out of Freebucks" family). "" = no quota.
 * Same status-line discipline as cline: code/prompt punctuation (=, (, {, ->,
 * leading >/#/$/-) never matches, so quoted source text cannot FP.
 */
function matchFreebuffQuotaLine(lines) {
  const exclude = /^[ \t]*[>#$-]|\(|\);|->|\{|=/;
  const phrase = /out of (free)?bucks|no freebucks left| 0 freebucks left|freebucks exhausted/i;
  const arr = Array.isArray(lines) ? lines : String(lines || "").split(/\r?\n/);
  return arr.filter((l) => !exclude.test(l) && phrase.test(l)).slice(-2).join("\n");
}

// ---------------------------------------------------------------------------
// Freebuff auto-continue (ticket tmp/ht-freebuff-autocontinue/TICKET.md).
// The session-end box is a TUI status box, so the same status-line discipline
// applies: quoted source text (this ticket's own wording, code, prompt files)
// must never read as an active session-end box.
// ---------------------------------------------------------------------------

const FREEBUFF_AUTOCONTINUE_CAP = 12;   // max auto-continues per job, then CONTINUE_CAP
const FREEBUFF_CONTINUE_MAX_FAILS = 3;  // consecutive failed continues, then SESSION_LOST
const FREEBUFF_ENTER_WAIT_MS = 10 * 60 * 1000; // "wrapping up" → "Press Enter" grace
const FREEBUFF_PROMPT_WAIT_MS = 60 * 1000;     // Enter pressed → "Enter a coding task"
const FREEBUFF_TYPED_WAIT_MS = 3 * 60 * 1000;  // resume prompt typed → "working..."

const FREEBUFF_STATUS_LINE_EXCLUDE = /^[ \t]*[>#$-]|\(|\);|->|\{|=/;

/**
 * Freebuff session-end state from pane lines. Booleans + Freebucks count
 * ("Session ended · N Freebucks left"). Pass the VISIBLE screen only (not
 * scrollback), so a stale box that already scrolled away cannot re-trigger.
 * Status-line discipline: prompt/code punctuation never matches.
 */
function freebuffSessionEndState(lines) {
  const arr = Array.isArray(lines) ? lines : String(lines || "").split(/\r?\n/);
  const st = {
    sessionEnded: false,
    pressEnter: false,
    wrappingUp: false,
    tookOver: false,
    taskPrompt: false,
    freebucksLeft: null,
  };
  for (const raw of arr) {
    if (!raw || !raw.trim()) continue;
    if (FREEBUFF_STATUS_LINE_EXCLUDE.test(raw)) continue;
    if (/another\s+freebuff\s+instance\s+took\s+over/i.test(raw)) st.tookOver = true;
    if (/session\s+ended/i.test(raw)) st.sessionEnded = true;
    if (/press\s+enter\s+to\s+continue/i.test(raw)) st.pressEnter = true;
    if (/wrapping\s+up/i.test(raw)) st.wrappingUp = true;
    if (/enter\s+a\s+coding\s+task/i.test(raw)) st.taskPrompt = true;
    const fb = raw.match(/(\d+)\s+freebucks\s+left/i);
    if (fb) st.freebucksLeft = Number(fb[1]);
  }
  return st;
}

/**
 * The resume prompt typed into the fresh session. ticketDir comes from the
 * session's .meta sidecar prompt file directory.
 */
function buildFreebuffResumePrompt(ticketDir) {
  const dir = String(ticketDir || "").replace(/\/+$/, "");
  if (!dir) return "";
  return "Continue the previous task: re-read " + dir + "/TICKET.md and resume from " + dir
    + "/PROGRESS.md. Write REPORT.md only when done, ending with VERIFIED: yes or no.";
}

/** A numbered model-picker menu line ("1) GLM 5.3 Flash (0/hr)"). */
const FREEBUFF_MENU_LINE = /^[ \t]*(\d{1,2})[.)][ \t]+(.+)$/;

function freebuffMenuVisible(lines) {
  const arr = Array.isArray(lines) ? lines : String(lines || "").split(/\r?\n/);
  return arr.some((l) => FREEBUFF_MENU_LINE.test(l));
}

/**
 * Model-picker choice for a continued session when Freebucks are 0: pick the
 * GLM 5.3 Flash entry (0/hr) by its menu number. Non-zero Freebucks → "" (the
 * default model is already GLM 5.3 Flash at 0/hr — plain Enter accepts it).
 * Menu lines are structurally distinct from code (anchored "N)"), so the
 * status-line exclude does not apply here.
 */
function freebuffModelPickerChoice(lines, { freebucksLeft = null } = {}) {
  if (freebucksLeft !== 0) return { keys: "", model: "" };
  const arr = Array.isArray(lines) ? lines : String(lines || "").split(/\r?\n/);
  for (const raw of arr) {
    if (!raw || !raw.trim()) continue;
    const m = raw.match(FREEBUFF_MENU_LINE);
    if (!m) continue;
    const label = m[2];
    if (/glm/i.test(label) && /5\.3/.test(label) && /flash/i.test(label)) {
      return { keys: m[1], model: label.trim().slice(0, 60) };
    }
  }
  return { keys: "", model: "" };
}

/**
 * Enter-wait policy: keep polling for "Press Enter to continue" while the
 * session-end box (or the older "wrapping up" variant) is pending and the
 * grace window (10 min) has not elapsed. state.pressEnter=true means proceed
 * now; a took-over screen is handled by the caller (never auto-continue).
 */
function shouldKeepWaitingForEnter(state, elapsedMs, { maxWaitMs = FREEBUFF_ENTER_WAIT_MS } = {}) {
  if (!state || typeof state !== "object") return false;
  if (state.pressEnter) return true;
  if (state.tookOver) return false;
  if (!state.sessionEnded && !state.wrappingUp) return false;
  return Number(elapsedMs) < Number(maxWaitMs);
}

const familyOf = (lane) => {
  const t = String((lane && lane.model) || "").toLowerCase();
  if (/muse/.test(t)) return "muse";
  if (/mimo/.test(t)) return "mimo";
  if (/deepseek/.test(t)) return "deepseek";
  if (/qwen/.test(t)) return "qwen";
  if (/glm/.test(t)) return "glm";
  if (/space-?bunny/.test(t)) return "spacebunny";
  return String((lane && lane.family) || "") || null;
};

const laneLiveQuota = (lane, quota, now) => {
  const keys = [];
  if (lane.provider && lane.model) keys.push(`${lane.provider}/${lane.model}`);
  const bid = sharedBucketIdFor(lane);
  if (bid) keys.push(`bucket:${bid}`);
  for (const k of keys) {
    const r = quota[k];
    if (r && Number(r.depletedUntil || 0) > now) return true;
  }
  return false;
};

/**
 * Best available lane model for a tool (ht-run auto-pick): skip
 * unavailable/ended, skip depleted lanes still inside their reset window,
 * skip lanes with a live session-quota record; lowest pref # wins.
 */
function pickModelForTool(tbl, session, tool, now = Date.now()) {
  if (!tbl || !Array.isArray(tbl.lanes)) return null;
  const want = String(tool || "").toLowerCase();
  const quota = (session && session.quota) || {};
  const usable = tbl.lanes
    .filter((l) => String((l && l.provider) || "").toLowerCase() === want)
    .filter((l) => {
      const st = String(l.status || "").toLowerCase();
      if (st === "unavailable" || st === "ended") return false;
      if (st === "depleted") {
        const at = parseMs(l.nextResetAt);
        if (!(Number.isFinite(at) && at <= now)) return false; // still cooling down
      }
      if (laneLiveQuota(l, quota, now)) return false;
      return true;
    })
    .sort((a, b) => (Number(a.pref) || 0) - (Number(b.pref) || 0));
  return usable[0] ? usable[0].model : null;
}

/**
 * Next lane for --auto-failover: same family on the wanted tool first, then
 * same family anywhere, then wanted tool by pref, then anything by pref with
 * freebuff last resort. Returns "provider|model" or null.
 */
function nextLane(tbl, session, wantTool, depletedModel, now = Date.now()) {
  if (!tbl || !Array.isArray(tbl.lanes)) return null;
  const quota = (session && session.quota) || {};
  const want = String(wantTool || "").toLowerCase();
  const dep = String(depletedModel || "");
  const depLane = tbl.lanes.find((l) => l && l.model === dep);
  const fam = depLane ? familyOf(depLane) : null;
  const usable = tbl.lanes.filter((l) => {
    if (!l) return false;
    const st = String(l.status || "").toLowerCase();
    if (st === "unavailable" || st === "ended") return false;
    if (st === "depleted") {
      const at = parseMs(l.nextResetAt);
      if (!(Number.isFinite(at) && at <= now)) return false;
    }
    if (laneLiveQuota(l, quota, now)) return false;
    return true;
  }).sort((a, b) => (Number(a.pref) || 0) - (Number(b.pref) || 0));
  const pick = (pred) => usable.find(pred);
  let out = null;
  if (fam) {
    out = pick((l) => String(l.provider || "").toLowerCase() === want && familyOf(l) === fam)
      || pick((l) => familyOf(l) === fam);
  }
  if (!out) out = pick((l) => String(l.provider || "").toLowerCase() === want);
  if (!out) out = pick((l) => String(l.provider || "").toLowerCase() !== "freebuff");
  if (!out) out = pick((l) => String(l.provider || "").toLowerCase() === "freebuff");
  return out ? `${String(out.provider || "").toLowerCase()}|${out.model}` : null;
}

module.exports = {
  RATE_LIMIT_TTL_MS,
  QUOTA_TTL_MS,
  parseMs,
  isoZ,
  parseCountdownHint,
  nextMidnightUtc,
  isCloudflareDailyExhausted,
  depletionUntilFromText,
  OPENCODE_ZEN_SILENCE_MS,
  isOpenCodeZenModel,
  opencodeSilenceMsForModel,
  isRateLimitText,
  isQuotaText,
  sharedBucketIdFor,
  quotaKeyFor,
  computeSweepPlan,
  pickProbeKind,
  probeCli,
  stampDepleted,
  stampAvailable,
  opencodeLogQuota,
  matchClineQuotaLine,
  matchFreebuffQuotaLine,
  pickModelForTool,
  nextLane,
  FREEBUFF_AUTOCONTINUE_CAP,
  FREEBUFF_CONTINUE_MAX_FAILS,
  FREEBUFF_ENTER_WAIT_MS,
  FREEBUFF_PROMPT_WAIT_MS,
  FREEBUFF_TYPED_WAIT_MS,
  freebuffSessionEndState,
  buildFreebuffResumePrompt,
  freebuffMenuVisible,
  freebuffModelPickerChoice,
  shouldKeepWaitingForEnter,
};
