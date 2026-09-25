#!/usr/bin/env node
/**
 * ht-allowance-watch — free-lane allowance watcher (zero Grok).
 *
 * Ticket: tmp/ht-allowance-watch/TICKET.md (Part 1).
 * Repo copy: tools/telegram-provider-router/bin/ht-allowance-watch
 * (live: /home/box/bin/ht-allowance-watch; deployed by ht-ship).
 *
 * 1. Read <router>/state/free-lane-table.json
 *    (lanes + buckets, status, nextResetAt, cooldownUntil).
 * 2. Sleep until the soonest nextResetAt/cooldownUntil among depleted lanes
 *    (+60s). If none known, re-check every 30 min.
 * 3. At that time probe the lane cheaply (one tiny "reply OK" prompt):
 *      - OpenCode lanes:  opencode run -m <model> "reply OK" (60s timeout)
 *      - Cline lanes:     cline -m <model> "reply OK "      (90s timeout)
 *      - Token Harbor:    POST {TOKEN_HARBOR_BASE_URL}/chat/completions
 *      - Cloudflare:      POST /accounts/{acct}/ai/run/{model}
 *    Keys come from the router .env and are NEVER printed.
 * 4. Stamp the ledger (free-lane-table.json + session.json quota records) in the
 *    same shape as the router's markDepleted / syncFreeLaneTable so /allowance
 *    and /freemodel reflect it. Still limited with no vendor time → default TTL.
 * 5. When a lane flips to available: ONE Telegram ping to TELEGRAM_ALLOWED_USER_ID
 *    via TELEGRAM_BOT_TOKEN (Bot API sendMessage), rate-limited to max 1 per lane
 *    per reset window (state/allowance-watch-pings.json).
 *
 * Modes: --once (single sweep) · --daemon (loop) · --exit-on-available (exit 0,
 * lane name printed, as soon as any lane opens — wakes the PM).
 * Log: <logs>/ht-allowance-watch.log (HT_LOG_DIR / HT_AC_LOGS_DIR override).
 *
 * Env: HT_ROUTER_DIR (router dir), HT_WORKSPACE (repo checkout),
 *      HT_CORE_PATH (core override), HT_LOG_DIR / HT_AC_LOGS_DIR (log dir).
 *
 * The pure logic (sweep plan, countdown parse, probe→status, ledger stamps)
 * lives in the shared, unit-tested core:
 *   tools/telegram-provider-router/src/allowance-watch-core.cjs
 * (scripts/test-allowance-watch.mjs covers it; `npm test` in that tool dir).
 *
 * Does NOT start or restart any Telegram poller. Sends messages only.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const HOME = os.homedir();
const ROUTER_DIR = process.env.HT_ROUTER_DIR || path.join(HOME, ".config", "telegram-opencode", "router");
const WORKSPACE = process.env.HT_WORKSPACE || "/home/ubuntu/bot-host";
const REPO_CORE = path.join(WORKSPACE, "tools", "telegram-provider-router", "src", "allowance-watch-core.cjs");
const LIVE_CORE = path.join(ROUTER_DIR, "src", "allowance-watch-core.cjs");
const SHARED_STATE_DIR = process.env.FREE_LANES_SHARED_DIR || path.join(HOME, ".local", "state", "shared-free-lanes");

// ---- shared unit-tested core (repo first, live synced copy as fallback) ----
function loadCore() {
  for (const p of [process.env.HT_CORE_PATH, REPO_CORE, LIVE_CORE]) {
    if (p) { try { return require(p); } catch {} }
  }
  console.error("fatal: allowance-watch-core.cjs not found (repo or live router)");
  process.exit(1);
}
const core = loadCore();

const ENV_PATH = process.env.HT_ENV_PATH || path.join(ROUTER_DIR, ".env");
const TABLE_PATH = process.env.HT_TABLE_PATH || (fs.existsSync(path.join(SHARED_STATE_DIR, "free-lane-table.json")) ? path.join(SHARED_STATE_DIR, "free-lane-table.json") : path.join(ROUTER_DIR, "state", "free-lane-table.json"));
const SESSION_PATH = process.env.HT_SESSION_PATH || (fs.existsSync(path.join(SHARED_STATE_DIR, "session.json")) ? path.join(SHARED_STATE_DIR, "session.json") : path.join(ROUTER_DIR, "state", "session.json"));
const PING_PATH = process.env.HT_PING_PATH || path.join(SHARED_STATE_DIR, "allowance-watch-pings.json");
const LOG_PATH = path.join(process.env.HT_LOG_DIR || process.env.HT_AC_LOGS_DIR || SHARED_STATE_DIR, "ht-allowance-watch.log");
try { fs.mkdirSync(path.dirname(PING_PATH), { recursive: true }); } catch {}

const RATE_LIMIT_TTL_MS = Number(process.env.QUOTA_RATE_LIMIT_TTL_MS || core.RATE_LIMIT_TTL_MS);
const QUOTA_TTL_MS = Number(process.env.QUOTA_DEPLETED_TTL_MS || core.QUOTA_TTL_MS);
const NO_KNOWN_RESET_POLL_MS = 30 * 60 * 1000; // "If none known, re-check every 30 min"
const AFTER_RESET_GRACE_MS = 60 * 1000;        // sleep until soonest reset (+60s)
const PING_MAX_CHARS = 300;

// ---------- argv ----------
const ARGS = new Set(process.argv.slice(2));
const ONCE = ARGS.has("--once");
const DAEMON = ARGS.has("--daemon"); // default (no flags) = one sweep, like --once
const EXIT_ON_AVAILABLE = ARGS.has("--exit-on-available");
if (!ONCE && !DAEMON && ARGS.size && [...ARGS].some((a) => !a.startsWith("--"))) {
  console.error("usage: ht-allowance-watch [--once] [--daemon] [--exit-on-available]");
  process.exit(2);
}

// ---------- logging ----------
let logStreamOk = true;
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  try { console.log(line); } catch {}
  try {
    if (logStreamOk) {
      fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
      fs.appendFileSync(LOG_PATH, line + "\n");
    }
  } catch { logStreamOk = false; }
}

// ---------- tiny utils ----------
function readJson(p) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } }
function writeJsonAtomic(p, obj) {
  const tmp = `${p}.tmp.${process.pid}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
    fs.renameSync(tmp, p);
  } catch {
    try { fs.writeFileSync(p, JSON.stringify(obj, null, 2)); } catch {}
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
  }
}

/** Parse .env into a map. Values are secret: never log or echo them. */
function loadEnv() {
  const out = {};
  let raw = "";
  try { raw = fs.readFileSync(ENV_PATH, "utf8"); } catch { return out; }
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_0-9]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

// ---------- probes (fetch-based HTTP probes stay local; CLI probes use core) ----------
async function probeTokenHarbor(env, model) {
  const base = String(env.TOKEN_HARBOR_BASE_URL || "https://tokenharbor.ai/v1").replace(/\/$/, "");
  const key = env.TOKEN_HARBOR_API_KEY || env.TOKENHARBOR_API_KEY || "";
  if (!key) return { status: "uncertain", output: "no Token Harbor key on router" };
  try {
    const r = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "user", content: "reply OK" }], max_tokens: 5 }),
      signal: AbortSignal.timeout(45000),
    });
    const bodyText = await r.text();
    if (r.status === 200) return { status: "available", output: bodyText.slice(0, 200) };
    if (r.status === 429 || r.status === 402) return { status: "depleted", output: `HTTP ${r.status}: ${bodyText.slice(0, 400)}` };
    return { status: "uncertain", output: `HTTP ${r.status}: ${bodyText.slice(0, 200)}` };
  } catch (e) {
    return { status: "uncertain", output: `fetch failed: ${String(e.message || e).slice(0, 200)}` };
  }
}

async function probeCloudflare(env, laneModel) {
  const tok = env.CLOUDFLARE_WORKERS_AI_API_TOKEN || "";
  const acct = env.CLOUDFLARE_ACCOUNT_ID || "";
  if (!tok || !acct) return { status: "uncertain", output: "no CF token/account on router" };
  const modelId = String(laneModel).replace(/^cloudflare\//, "");
  try {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acct}/ai/run/${modelId}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "reply OK" }], max_tokens: 5 }),
      signal: AbortSignal.timeout(45000),
    });
    const bodyText = await r.text();
    if (r.status === 200) return { status: "available", output: bodyText.slice(0, 200) };
    if (r.status === 429 || r.status === 402) return { status: "depleted", output: `HTTP ${r.status}: ${bodyText.slice(0, 400)}` };
    return { status: "uncertain", output: `HTTP ${r.status}: ${bodyText.slice(0, 200)}` };
  } catch (e) {
    return { status: "uncertain", output: `fetch failed: ${String(e.message || e).slice(0, 200)}` };
  }
}

async function probeLane(env, lane) {
  const kind = core.pickProbeKind(lane);
  if (kind.kind === "skip") return { status: "uncertain", output: kind.why, kind: "skip" };
  if (kind.kind === "opencode") {
    const r = core.probeCli(spawnSync, "opencode", ["run", "-m", lane.model, "reply OK"], 60000, { cwd: WORKSPACE });
    return { ...r, kind: "opencode" };
  }
  if (kind.kind === "cline") {
    // Cline CLI rejects single-token prompts as "unquoted commands" — trailing space.
    const r = core.probeCli(spawnSync, "cline", ["-m", String(lane.model).replace(/^cline\//, ""), "-c", WORKSPACE, "reply OK "], 90000, { cwd: WORKSPACE });
    return { ...r, kind: "cline" };
  }
  if (kind.kind === "tokenharbor") {
    const r = await probeTokenHarbor(env, lane.model);
    return { ...r, kind: "tokenharbor" };
  }
  if (kind.kind === "cloudflare") {
    const r = await probeCloudflare(env, lane.model);
    return { ...r, kind: "cloudflare" };
  }
  return { status: "uncertain", output: "unreachable", kind: "skip" };
}

// ---------- telegram ping (sendMessage only; never a second poller) ----------
async function sendTelegramPing(env, lane) {
  const token = env.TELEGRAM_BOT_TOKEN || "";
  const chatId = env.TELEGRAM_ALLOWED_USER_ID || env.TELEGRAM_USER_ID || "";
  if (!token || !chatId) { log("ping: missing TELEGRAM_BOT_TOKEN / TELEGRAM_ALLOWED_USER_ID — skipped"); return false; }
  const text = `✅ ${lane.label || lane.model} is available again`.slice(0, PING_MAX_CHARS);
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_notification: false }),
      signal: AbortSignal.timeout(20000),
    });
    const body = await r.json().catch(() => ({}));
    if (r.ok && body.ok) { log(`ping sent for ${lane.provider}/${lane.model}`); return true; }
    log(`ping failed for ${lane.provider}/${lane.model}: HTTP ${r.status} ${String(body.description || "").slice(0, 120)}`);
    return false;
  } catch (e) {
    log(`ping failed for ${lane.provider}/${lane.model}: ${String(e.message || e).slice(0, 120)}`);
    return false;
  }
}

/** Rate-limit pings: max 1 per lane per reset window. Window id = the nextResetAt that just cleared. */
function pingWindowAllowed(state, laneKey, windowId) {
  const e = state[laneKey];
  return !(e && e.window === windowId);
}
function pingWindowMark(state, laneKey, windowId) {
  state[laneKey] = { window: windowId, sentAt: core.isoZ(Date.now()) };
}

// ---------- sweep ----------
/**
 * One sweep: probe every due lane (shared buckets: probe the first due member,
 * stamp the whole bucket), write the ledger, ping flips. Returns summary.
 */
async function sweep(env, { doWrite = true } = {}) {
  const tbl = readJson(TABLE_PATH);
  if (!tbl) { const s = { error: `no readable table at ${TABLE_PATH}` }; log(s.error); return s; }
  const session = readJson(SESSION_PATH) || {};
  const pings = readJson(PING_PATH) || {};
  const plan = core.computeSweepPlan(tbl);
  const lines = [];
  let probed = 0, flips = 0, restamps = 0;
  const probedBuckets = new Set();

  // Probe budget order: due lanes by pref. Shared buckets: first due member only.
  const dueLanes = [...plan.due].sort((a, b) => (Number(a.pref) || 0) - (Number(b.pref) || 0));
  for (const lane of dueLanes) {
    const bid = core.sharedBucketIdFor(lane);
    if (bid && probedBuckets.has(bid)) continue; // one probe covers the shared bucket
    const laneKey = `${lane.provider}/${lane.model}`;
    const windowId = String(lane.nextResetAt || lane.cooldownUntil || "");
    // Skip if this exact reset window was already probed (1 per lane per window).
    const pe = pings.probes && pings.probes[laneKey];
    if (pe && pe.window === windowId) {
      if (bid) probedBuckets.add(bid);
      lines.push(`  #${lane.pref} ${laneKey}: already probed this reset window — skipped (1 probe/lane/window)`);
      continue;
    }

    probed++;
    const before = lane.status;
    const res = await probeLane(env, lane);
    let outcome = "";
    if (res.status === "available") {
      const lanesOfBucket = bid ? plan.lanes.filter((l) => core.sharedBucketIdFor(l) === bid) : [lane];
      const windowCleared = String(lane.nextResetAt || "");
      const { clearedKeys } = core.stampAvailable(tbl, session, lanesOfBucket, bid, { source: "ht-allowance-watch probe: OK" });
      flips++;
      outcome = `AVAILABLE (cleared ${clearedKeys.length || "no"} quota rec)`;
      const pingKey = `${lane.provider}/${lane.model}`;
      if (pingWindowAllowed(pings, pingKey, windowCleared)) {
        const sent = await sendTelegramPing(env, lane);
        if (sent) pingWindowMark(pings, pingKey, windowCleared);
      } else {
        lines.push(`  #${lane.pref} ${laneKey}: ping suppressed (already pinged for reset ${windowCleared})`);
      }
      // Notify --exit-on-available watchers with the lane name.
      lines.push(`  #${lane.pref} ${laneKey}: ${before} → ${outcome} [probe ${res.kind}]`);
      if (EXIT_ON_AVAILABLE) { plan.openedLane = laneKey; }
    } else if (res.status === "depleted") {
      // ADDENDUM 2026-09-25 #4: one re-stamp policy from the vendor text via the
      // shared core — Cloudflare 4006 ("used up your daily free allocation of
      // 10,000 neurons") means the DAILY neurons allowance is empty and resets
      // at the next 00:00 UTC, NOT the 45m rate-limit TTL this watcher used to
      // re-stamp every sweep. Vendor countdowns are still honoured; plain
      // rate-limit text keeps the 45m TTL; unknown stays 6h.
      const dep = core.depletionUntilFromText(res.output);
      const until = dep.until;
      const kind = dep.kind;
      const cd = core.parseCountdownHint(res.output);
      const lanesOfBucket = bid ? plan.lanes.filter((l) => core.sharedBucketIdFor(l) === bid) : [lane];
      const st = core.stampDepleted(tbl, session, lanesOfBucket, bid, { until, hint: cd.hint, kind, lastError: res.output, source: `ht-allowance-watch probe (${res.kind}): still limited` });
      restamps++;
      const cfDaily = core.isCloudflareDailyExhausted(res.output);
      outcome = `still DEPLETED, re-stamped until ${st.untilIso}${cfDaily ? " (CF 4006 daily neurons → next 00:00 UTC)" : cd.hint ? ` (hint: ${cd.hint.slice(0, 40)})` : " (default TTL)"}`;
      lines.push(`  #${lane.pref} ${laneKey}: ${outcome} [probe ${res.kind}]`);
    } else {
      // Uncertain (hang/timeout/no key): treat as still limited with no vendor
      // time — re-stamp with the existing default TTL and go back to sleep (2).
      const until = Date.now() + RATE_LIMIT_TTL_MS;
      const lanesOfBucket = bid ? plan.lanes.filter((l) => core.sharedBucketIdFor(l) === bid) : [lane];
      const st = core.stampDepleted(tbl, session, lanesOfBucket, bid, {
        until, hint: "", kind: "unknown",
        lastError: `probe uncertain: ${String(res.output).slice(0, 200)}`,
        source: `ht-allowance-watch probe (${res.kind}): uncertain → default TTL`,
      });
      restamps++;
      outcome = `uncertain → re-stamped default TTL until ${st.untilIso} (${String(res.output).slice(0, 60)})`;
      lines.push(`  #${lane.pref} ${laneKey}: ${outcome}`);
    }
    if (bid) probedBuckets.add(bid);
    if (!pings.probes) pings.probes = {};
    pings.probes[laneKey] = { window: windowId, probedAt: core.isoZ(Date.now()), result: res.status };
    if (res.status === "available" && bid) { pings.probes[laneKey].window = "cleared"; }
  }

  if (doWrite && (probed > 0)) {
    tbl.updatedAt = core.isoZ(Date.now());
    writeJsonAtomic(TABLE_PATH, tbl);
    writeJsonAtomic(SESSION_PATH, session);
    writeJsonAtomic(PING_PATH, pings);
  } else if (probed > 0) {
    writeJsonAtomic(PING_PATH, pings);
  }

  const summary = {
    due: plan.due.length,
    depleted: plan.depleted.length,
    probed,
    flips,
    restamps,
    openedLane: plan.openedLane || null,
    soonestResetAt: Number.isFinite(plan.soonest) ? core.isoZ(plan.soonest) : null,
    lines,
  };
  log(`sweep: ${plan.due.length} due / ${plan.depleted.length} depleted / ${plan.lanes.length} lanes — probed ${probed}, flips ${flips}, re-stamps ${restamps}${plan.openedLane ? ` — OPENED: ${plan.openedLane}` : ""}`);
  for (const l of lines) log(l);
  return summary;
}

function sleepMsFor(summary) {
  // Sleep until soonest nextResetAt/cooldownUntil among depleted lanes (+60s);
  // if none known, re-check every 30 min.
  if (summary.soonestResetAt) {
    const t = Date.parse(summary.soonestResetAt) + AFTER_RESET_GRACE_MS - Date.now();
    return Math.max(60 * 1000, Math.min(NO_KNOWN_RESET_POLL_MS, t));
  }
  return NO_KNOWN_RESET_POLL_MS;
}

async function main() {
  log(`ht-allowance-watch starting (mode: ${ONCE ? "once" : DAEMON ? "daemon" : "once"}${EXIT_ON_AVAILABLE ? ", exit-on-available" : ""})`);
  const env = loadEnv();
  if (ONCE || !DAEMON) {
    const summary = await sweep(env);
    if (summary.openedLane) {
      console.log(`AVAILABLE: ${summary.openedLane}`);
      process.exit(0);
    }
    if (summary.error) process.exit(1);
    process.exit(0);
  }
  // daemon
  for (;;) {
    const summary = await sweep(env);
    if (EXIT_ON_AVAILABLE && summary.openedLane) {
      console.log(`AVAILABLE: ${summary.openedLane}`);
      process.exit(0);
    }
    const ms = sleepMsFor(summary);
    log(`sleeping ${Math.round(ms / 1000)}s until next probe window`);
    await new Promise((r) => setTimeout(r, ms));
  }
}

main().catch((e) => { log(`fatal: ${e.stack || e.message || e}`); process.exit(1); });
