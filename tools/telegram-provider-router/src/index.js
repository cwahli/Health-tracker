#!/usr/bin/env node
/**
 * Unified Telegram router: one bot, /switch across backends.
 * Never run alongside another getUpdates poller on the same token.
 */
import "dotenv/config";
import { Bot, GrammyError, HttpError, InlineKeyboard, InputFile } from "grammy";
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, openSync, closeSync, renameSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawn, execSync } from "child_process";
// Single-source working-headline framework: vendored mirror of
// scripts/lib/tg-progress.mjs (see scripts/sync-router-vendor.mjs).
// Change the status line in the canonical file, never here.
import { formatTokenCount, formatWorkingHeadline, ctxLimitFor } from "./tg-progress.vendor.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const STATE_PATH = join(ROOT, "state", "session.json");
// A) Single-poller lock: pidfile + lock live under the router dir.
const RUN_DIR = join(ROOT, "run");
const LOCK_PATH = join(RUN_DIR, "router.lock");
const PID_PATH = join(RUN_DIR, "router.pid");
const LEGACY_PID_PATHS = ["/tmp/tg-router.pid"];

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED = String(process.env.TELEGRAM_USER_ID || process.env.TELEGRAM_ALLOWED_USER_ID || "").trim();
const OC_URL = (process.env.OPENCODE_SERVER_URL || process.env.OPENCODE_BASE_URL || "http://127.0.0.1:4096").replace(/\/$/, "");
const TH_URL = (process.env.TOKEN_HARBOR_BASE_URL || "https://tokenharbor.ai/v1").replace(/\/$/, "");
const TH_KEY = process.env.TOKEN_HARBOR_API_KEY || "";
const WORKSPACE = process.env.WORKSPACE || "/workspace";
// Long agent runs: wait until OpenCode goes idle. Only abort on idle (no progress) or absolute max.
// OPENCODE_TIMEOUT_MS kept as alias for idle window (old 210s hard cut-off removed).
const OC_IDLE_MS = Number(process.env.OPENCODE_IDLE_MS || process.env.OPENCODE_TIMEOUT_MS || 900000);
const OC_MAX_MS = Number(process.env.OPENCODE_MAX_MS || 7200000);
const OC_PROGRESS_MS = Number(process.env.OPENCODE_PROGRESS_MS || 30000);
// Min gap between Telegram edits when activity fingerprint changes (compact thought stream).
const OC_PROGRESS_MIN_MS = Number(process.env.OPENCODE_PROGRESS_MIN_MS || 15000);
const OC_TIMEOUT_MS = OC_IDLE_MS; // legacy name used in busy replies
const BUSY_WATCHDOG_MS = Number(process.env.BUSY_WATCHDOG_MS || 30000);
const BUSY_ORPHAN_GRACE_MS = Number(process.env.BUSY_ORPHAN_GRACE_MS || 45000);
const BUSY_STALE_IDLE_CHECKS = Number(process.env.BUSY_STALE_IDLE_CHECKS || 2);
// B) Cline Telegram timeout: default >= 20 minutes so long runs are not orphaned.
const CLINE_TIMEOUT_MS = Number(process.env.CLINE_TIMEOUT_MS || 1200000);
// A) 409 self-heal: exit (don't spin as a second poller) after N consecutive 409s.
const MAX_CONSECUTIVE_409 = Number(process.env.ROUTER_MAX_409 || 3);
const RETRY_409_MS = Number(process.env.ROUTER_409_RETRY_MS || 45000);
let consecutive409 = 0;
// In-memory Cline child PID for the active dispatch (also persisted to state.clinePid).
let activeClinePid = null;
const OC_DIR_QS = `?directory=${encodeURIComponent(WORKSPACE)}`;
// Status pings answered locally from router state (no OpenCode call).
const STATUS_PING_RE =
  /\b(are you (still |currently )?working|still working|are you done|are you finished|what are you doing|what('s| is) the (status|progress)|how('s| is) it going|progress\??|status\??)\b/i;

if (!TOKEN || !ALLOWED) {
  console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_USER_ID");
  process.exit(1);
}

const PROVIDERS = {
  opencode: {
    label: "OpenCode",
    freeModels: [
      "opencode/muse-spark-1.3-contributor-free",
      "opencode/muse-spark-1.2-contributor-free",
      "opencode/mimo-v2.6-flash-free",
      "opencode/big-pickle",
      "cloudflare/@cf/qwen/qwen3.8-27b",
      "cloudflare/@cf/zai-org/glm-4.7-flash",
    ],
  },
  cline: {
    label: "Cline",
    freeModels: [
      "cline-free/muse-spark-1.3-contributor",
      "cline-free/deepseek-v4.1-flash",
      "cline-free/glm-5.3-flash",
    ],
  },
  tokenharbor: {
    label: "Token Harbor",
    freeModels: [
      "deepseek-v4.1-flash:free",
      "deepseek-v4-flash:free",
      "mimo-v2.5:free",
      "mimo-v2.6-flash:free",
      "qwen3.8-flash:free",
    ],
  },
  freebuff: {
    label: "Freebuff",
    freeModels: [
      "deepseek/deepseek-v4-flash",
      "xiaomi/mimo-v2-flash",
    ],
  },
  commandcode: {
    label: "Command Code",
    freeModels: [
      "poolside/laguna-s-2.1-free",
      "inclusionai/ling-3.0-flash-sante:free",
      "deepseek/deepseek-v4.1-flash",
    ],
  },
};

const PROVIDER_ALIASES = {
  cmd: "commandcode",
  "command-code": "commandcode",
  command_code: "commandcode",
  cc: "commandcode",
  th: "tokenharbor",
  harbor: "tokenharbor",
  oc: "opencode",
  fb: "freebuff",
};

/** Normalize a free-model id into a family key for cross-provider failover. */
function isGreetingOnly(text) {
  const t = String(text || "").trim().toLowerCase().replace(/[!.,\s]+/g, " ").trim();
  return ["hi", "hello", "hey", "yo", "hi there", "hello there", "good morning", "good evening", "good afternoon"].includes(t);
}
function isClineGreetingOnly(text) {
  const t = String(text || "").trim();
  if (t.length > 300) return false;
  return /^\s*(hi\b.*i.?m cline|hello\b.*i.?m cline|hey\b.*cline|hi there.*cline)/i.test(t) ||
    (/cline/i.test(t) && /how can i help|what can i (do|help)|how may i/i.test(t) && t.length < 300);
}
function freeFamilyKey(modelId) {
  let s = String(modelId || "").toLowerCase();
  s = s.replace(/^opencode\//, "").replace(/^cline-free\//, "").replace(/^cline\//, "");
  s = s.replace(/^tokenharbor\//, "").replace(/^freebuff\//, "").replace(/^cloudflare\//, "");
  s = s.replace(/:free$/, "").replace(/-free$/, "");
  s = s.replace(/-contributor(?:-free)?$/, "");
  s = s.replace(/^deepseek\//, "").replace(/^xiaomi\//, "").replace(/^glm-/, "glm-");
  // Collapse common aliases
  s = s.replace(/deepseek-v4\.1-flash.*/, "deepseek-v4.1-flash");
  s = s.replace(/deepseek-v4-flash.*/, "deepseek-v4-flash");
  s = s.replace(/muse-spark-1\.3.*/, "muse-spark-1.3");
  s = s.replace(/muse-spark-1\.2.*/, "muse-spark-1.2");
  s = s.replace(/mimo-v2\.6-flash.*/, "mimo-v2.6-flash");
  s = s.replace(/mimo-v2\.5.*/, "mimo-v2.5");
  s = s.replace(/qwen3\.8-flash.*/, "qwen3.8-flash");
  s = s.replace(/qwen3\.8-27b.*/, "qwen3.8-27b");
  s = s.replace(/@cf\/qwen\/qwen3\.8-27b.*/, "qwen3.8-27b");
  s = s.replace(/glm-4\.7-flash.*/, "glm-4.7-flash");
  s = s.replace(/@cf\/zai-org\/glm-4\.7-flash.*/, "glm-4.7-flash");
  s = s.replace(/glm-5\.3-flash.*/, "glm-5.3-flash");
  s = s.replace(/^cloudflare\//, "");
  return s;
}

/**
 * Ordered failover chain: same free model family across providers.
 * Prefer OpenCode+TokenHarbor (tools) before chat-only Token Harbor.
 */
const FREE_FAMILIES = {
  "deepseek-v4.1-flash": [
    { provider: "opencode", model: "tokenharbor/deepseek-v4.1-flash:free" },
    { provider: "cline", model: "cline-free/deepseek-v4.1-flash" },
    { provider: "tokenharbor", model: "deepseek-v4.1-flash:free" },
  ],
  "deepseek-v4-flash": [
    { provider: "opencode", model: "tokenharbor/deepseek-v4-flash:free" },
    { provider: "tokenharbor", model: "deepseek-v4-flash:free" },
  ],
  "muse-spark-1.3": [
    { provider: "opencode", model: "opencode/muse-spark-1.3-contributor-free" },
    { provider: "cline", model: "cline-free/muse-spark-1.3-contributor" },
  ],
  "muse-spark-1.2": [
    { provider: "opencode", model: "opencode/muse-spark-1.2-contributor-free" },
  ],
  "mimo-v2.6-flash": [
    { provider: "opencode", model: "opencode/mimo-v2.6-flash-free" },
    { provider: "opencode", model: "tokenharbor/mimo-v2.6-flash:free" },
    { provider: "tokenharbor", model: "mimo-v2.6-flash:free" },
  ],
  "mimo-v2.5": [
    { provider: "opencode", model: "tokenharbor/mimo-v2.5:free" },
    { provider: "tokenharbor", model: "mimo-v2.5:free" },
  ],
  "qwen3.8-flash": [
    { provider: "opencode", model: "tokenharbor/qwen3.8-flash:free" },
    { provider: "tokenharbor", model: "qwen3.8-flash:free" },
  ],
  "qwen3.8-27b": [
    { provider: "opencode", model: "cloudflare/@cf/qwen/qwen3.8-27b" },
  ],
  "glm-4.7-flash": [
    { provider: "opencode", model: "cloudflare/@cf/zai-org/glm-4.7-flash" },
  ],
  "glm-5.3-flash": [
    { provider: "cline", model: "cline-free/glm-5.3-flash" },
  ],
};

function isCfNeuronExhaustedError(msg) {
  const s = String(msg || "");
  return /daily free allocation|10,?000 neuron|used up your daily free|neurons? (?:limit|quota|allocation)/i.test(s);
}

function markCfNeuronsExhausted(reason = "daily free allocation") {
  const led = loadCfNeuronLedger();
  led.day = utcDayKey();
  led.used = Math.max(led.used || 0, CF_NEURON_DAY);
  led.exhausted = true;
  led.exhaustedReason = String(reason).slice(0, 200);
  led.updatedAt = new Date().toISOString();
  saveCfNeuronLedger(led);
  return led;
}

function isQuotaOrLimitError(msg) {
  const s = String(msg || "");
  if (isCfNeuronExhaustedError(s)) {
    try { markCfNeuronsExhausted(s); } catch {}
  }
  return /quota|rate.?limit|429\b|402\b|4006\b|insufficient|out of credits|no credits|usage limit|free.?limit|exhausted|freebuck|free.?usage|payment required|exceeded|throttl|capacity|limit reached|daily.?cap|FreeUsageLimit|credit.?balance|neuron|workers ai|too many requests/i.test(s);
}

function looksLikeHardFailure(reply) {
  const s = String(reply || "");
  if (isQuotaOrLimitError(s)) return true;
  return /^(Cline error:|Token Harbor \d{3}|Token Harbor API key|Freebuff backend|Command Code error:|Command Code is signed|Stopped:|Unknown provider)/i.test(s);
}

function currentRoute() {
  const provider = state.provider;
  const model = state.models?.[provider];
  return { provider, model };
}

function nextFailoverRoutes(fromProvider, fromModel) {
  const family = freeFamilyKey(fromModel);
  const chain = FREE_FAMILIES[family] || [];
  if (!chain.length) return [];
  // Find current index (match provider+model loosely)
  let idx = chain.findIndex(
    (r) => r.provider === fromProvider && freeFamilyKey(r.model) === family &&
      (r.model === fromModel || r.model.endsWith(fromModel) || fromModel.endsWith(r.model.replace(/^[^/]+\//, "")))
  );
  if (idx < 0) {
    // Not on chain — start from beginning, skip identical provider+model
    return chain.filter((r) => !(r.provider === fromProvider && r.model === fromModel));
  }
  return chain.slice(idx + 1);
}

function applyRoute(provider, model, { note } = {}) {
  if (!PROVIDERS[provider]) throw new Error(`Unknown provider: ${provider}`);
  state.provider = provider;
  state.models[provider] = model;
  // Keep Token Harbor chat model in sync when selecting OpenCode+TH
  if (provider === "opencode" && String(model).startsWith("tokenharbor/")) {
    state.models.tokenharbor = String(model).slice("tokenharbor/".length);
  }
  saveState(state);
  return note || null;
}


function loadState() {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  if (!existsSync(STATE_PATH)) {
    return {
      provider: "opencode",
      models: {
        opencode: "opencode/muse-spark-1.3-contributor-free",
        cline: "cline-free/muse-spark-1.3-contributor",
        tokenharbor: "deepseek-v4.1-flash:free",
        freebuff: "deepseek/deepseek-v4-flash",
        commandcode: "poolside/laguna-s-2.1-free",
      },
      sessions: {},
      busy: false,
      busySince: null,
      lastUserText: null,
      lastReplyPreview: null,
      lastError: null,
      lastChatId: null,
      thinking: { cline: "" },
      // B) tracked Cline child PID (SIGTERM->SIGKILL on timeout/unlock).
      clinePid: null,
      // D) progress honesty: last text we actually started handling vs last seen.
      lastReceivedText: null,
      // E) light quota memory: quota["provider/model"] = { depletedUntil, lastError }.
      quota: {},
    };
  }
  const s = JSON.parse(readFileSync(STATE_PATH, "utf8"));
  // Backfill tracking fields for older state files.
  if (typeof s.busy !== "boolean") s.busy = false;
  if (!("busySince" in s)) s.busySince = null;
  if (!("lastUserText" in s)) s.lastUserText = null;
  if (!("lastReplyPreview" in s)) s.lastReplyPreview = null;
  if (!("lastError" in s)) s.lastError = null;
  if (!("lastChatId" in s)) s.lastChatId = null;
  if (!("clinePid" in s)) s.clinePid = null;
  if (!("lastReceivedText" in s)) s.lastReceivedText = null;
  if (!s.quota || typeof s.quota !== "object") s.quota = {};
  if (!s.sessions) s.sessions = {};
  if (!s.models) s.models = {};
  if (!s.models.commandcode) s.models.commandcode = "poolside/laguna-s-2.1-free";
  if (s.models.cline === "cline/muse-spark-1.3-contributor") {
    s.models.cline = "cline-free/muse-spark-1.3-contributor";
  }
  // Backfill thinking map: "" (unset) = CLI provider default. Explicit levels persist.
  if (!s.thinking || typeof s.thinking !== "object") s.thinking = { cline: "" };
  if (typeof s.thinking.cline !== "string") s.thinking.cline = "";
  s.thinking.cline = s.thinking.cline.trim().toLowerCase();
  if (!["", "none", "low", "medium", "high", "xhigh"].includes(s.thinking.cline)) {
    s.thinking.cline = "";
  }
  return s;
}

const CLINE_THINK_LEVELS = ["none", "low", "medium", "high", "xhigh"];

function normalizeClineThinking(v) {
  const s = String(v || "").trim().toLowerCase();
  return CLINE_THINK_LEVELS.includes(s) ? s : "";
}

/** Effective Cline thinking level: "" (unset) means CLI provider default. */
function clineThinkingLevel() {
  return normalizeClineThinking(state?.thinking?.cline);
}

/** Display value for status/cards: explicit level or "default" when unset. */
function clineThinkingDisplay() {
  return clineThinkingLevel() || "default";
}

function saveState(s) {
  // Atomic write: never leave a half-written session.json.
  const tmp = STATE_PATH + `.tmp.${process.pid}`;
  try {
    writeFileSync(tmp, JSON.stringify(s, null, 2));
    renameSync(tmp, STATE_PATH);
  } catch {
    try { writeFileSync(STATE_PATH, JSON.stringify(s, null, 2)); } catch {}
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch {}
  }
}

// ---- A) single-poller lock helpers ----
function pidAlive(pid) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) return false;
  try { process.kill(n, 0); return true; } catch { return false; }
}

function readPidFile(p) {
  try {
    if (!existsSync(p)) return null;
    const raw = String(readFileSync(p, "utf8")).trim().split(/\s+/)[0];
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch { return null; }
}

let lockFd = null;
let lockHolder = null;
function lockHeldByOther() {
  // Non-blocking probe: exit!=0 means someone holds an exclusive flock.
  try {
    execSync(`flock -n "${LOCK_PATH}" -c true`, { stdio: "ignore" });
    return false;
  } catch {
    return true;
  }
}
function acquireSinglePollerLock() {
  mkdirSync(RUN_DIR, { recursive: true });
  try { lockFd = openSync(LOCK_PATH, "w"); closeSync(lockFd); lockFd = null; } catch {}
  // Stale pidfile: remove and take over.
  const existing = readPidFile(PID_PATH);
  if (existing && existing !== process.pid) {
    if (pidAlive(existing) && lockHeldByOther()) {
      console.log(`another router owns the token (pid ${existing} alive); exiting`);
      process.exit(0);
    }
    console.log(
      existing && pidAlive(existing)
        ? `pidfile ${PID_PATH} (pid ${existing}) is stale vs flock; taking over`
        : `removing stale pidfile ${PID_PATH} (pid ${existing} dead)`
    );
    try { unlinkSync(PID_PATH); } catch {}
  }
  for (const legacy of LEGACY_PID_PATHS) {
    try {
      if (existsSync(legacy)) {
        const lp = readPidFile(legacy);
        if (lp == null || !pidAlive(lp)) { try { unlinkSync(legacy); } catch {} }
      }
    } catch {}
  }
  const cleanupPid = () => {
    // Only remove the pidfile if WE wrote it. The stale-pidfile test above
    // deletes the file before we write, so a missing file means "not ours".
    try { if (readPidFile(PID_PATH) === process.pid) unlinkSync(PID_PATH); } catch {}
  };
  const refreshPid = () => {
    try { writeFileSync(PID_PATH, String(process.pid) + "\n"); } catch {}
  };
  if (process.env.TG_ROUTER_LOCKED === "1") {
    // Launched under an outer `flock -n run/router.lock` holder (see restart
    // doc below): the launcher owns the lock for our lifetime.
    try { writeFileSync(PID_PATH, String(process.pid) + "\n"); } catch {}
    process.on("exit", cleanupPid);
    return;
  }
  // Self-managed lock: hold an exclusive flock on LOCK_PATH for our whole
  // lifetime via a double-fork daemon holder. No child of US survives our
  // exit (daemon re-parents to init), and the holder exits if WE die
  // (it polls our PID). flock(2) releases on holder exit, so kill -9 of the
  // router still frees the lock within ~2s; second starters exit 0 meanwhile.
  if (lockHeldByOther()) {
    console.log("another router owns the token (flock held); exiting");
    process.exit(0);
  }
  // Daemon holder: setsid'd `flock -n LOCK sleep` owns the lock for our
  // lifetime. $! is the flock pid itself. A tiny waiter reaps it when WE die
  // so no orphan holds the lock (plus our exit handler kills it directly).
  const me = process.pid;
  let holderPid = null;
  try {
    const out = execSync(
      `setsid flock -n "${LOCK_PATH}" sleep 100000000 & echo $!`,
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    );
    { const n = Number(String(out || "").trim().split(/\s+/)[0]); holderPid = (Number.isFinite(n) && n > 0) ? n : null; }
  } catch {
    holderPid = null;
  }
  const holderAlive = () => holderPid != null && pidAlive(holderPid);
  // Watcher: when WE exit, SIGTERM the holder so the lock frees at once.
  // (Fires on clean exit; kill -9 of us still frees via holder's own ppoll.)
  try {
    const w = spawn("sh", ["-c", `while kill -0 ${me} 2>/dev/null; do sleep 1; done; kill ${'"$HOLDER"'} 2>/dev/null`], { detached: true, stdio: "ignore", env: { ...process.env, HOLDER: String(holderPid) } });
    w.unref?.();
  } catch {}
  // Grace wait: if the daemon died at once, the lock is held by another
  // router -> exit 0 (never two long-pollers).
  {
    const end = Date.now() + 500;
    while (Date.now() < end) {
      if (holderAlive()) break;
    }
    if (!holderAlive()) {
      console.log("another router owns the token (flock held); exiting");
      process.exit(0);
    }
  }
  try { lockHolder = { pid: holderPid }; } catch {}
  refreshPid();
  // Re-assert our pidfile periodically: a stale-cleanup probe from a second
  // starter must never leave us pidfile-less (it only deletes dead PIDs, but
  // belt & braces against races).
  try { setInterval(refreshPid, 5000).unref?.(); } catch {}
  const onExit = () => {
    process._tgRouterExiting = true;
    try { if (holderPid != null && pidAlive(holderPid)) process.kill(holderPid, "SIGTERM"); } catch {}
    cleanupPid();
  };
  process.on("exit", onExit);
  try { process.on("SIGTERM", () => process.exit(0)); } catch {}
  try { process.on("SIGINT", () => process.exit(0)); } catch {}
}

// ---- E) light quota memory (allowance-bucket aware) ----
// Some vendors give ONE shared free pool (OpenCode Zen free, Token Harbor
// :free rolling bar, Cloudflare neurons/day). A quota error on any member of a
// shared bucket means every member is unavailable until reset, so we key the
// memory by bucket instead of by route. Cline free stays per-model (separate
// per-model daily caps), so it keeps the old `provider/model` key.
const FREE_ALLOWANCE_BUCKETS = [
  {
    id: "opencode-zen-free",
    scope: "shared",
    label: "OpenCode Zen free",
    resetHint: "rolling / rate-limit",
    // Membership list (kept for future server-pickup; Space Bunny is not
    // advertised on /freemodel until the running server exposes it).
    members: [
      "muse-spark-1.3-contributor-free",
      "muse-spark-1.2-contributor-free",
      "mimo-v2.6-flash-free",
      "ling-3.0-flash-fin-free",
      "nemotron-3-ultra-free",
      "nemotron-3.5-lightning-free",
      "space-bunny-free",
    ],
    match: (p, m) =>
      p === "opencode" &&
      !/^tokenharbor\//i.test(m) &&
      !/^cloudflare\//i.test(m) &&
      !/@cf\//i.test(m) &&
      (/-free$/i.test(m) || /(muse|mimo|ling|nemotron|space-?bunny)/i.test(m)),
  },
  {
    id: "tokenharbor-free",
    scope: "shared",
    label: "Token Harbor free",
    resetHint: "rolling ~7-day value bar",
    members: [
      "deepseek-v4.1-flash:free",
      "deepseek-v4-flash:free",
      "mimo-v2.5:free",
      "mimo-v2.6-flash:free",
      "qwen3.8-flash:free",
    ],
    match: (p, m) => p === "tokenharbor" || /^tokenharbor\//i.test(m) || /:free$/i.test(m),
  },
  {
    id: "cloudflare-neurons",
    scope: "shared",
    label: "Cloudflare neurons",
    resetHint: "00:00 UTC (10k/day)",
    members: ["@cf/qwen/qwen3.8-27b", "@cf/zai-org/glm-4.7-flash"],
    match: (p, m) => p === "cloudflare" || /^cloudflare\//i.test(m) || /@cf\//i.test(m),
  },
  {
    id: "cline-free",
    scope: "per-model",
    label: "Cline free",
    resetHint: "Cline UI daily",
    match: (p, m) => p === "cline" || /^cline-free\//i.test(m) || /^cline\//i.test(m),
  },
  {
    id: "freebuff-freebucks",
    scope: "shared",
    label: "Freebuff Freebucks",
    resetHint: "Freebuff UI daily",
    match: (p) => p === "freebuff",
  },
];

function resolveAllowanceBucket(provider, model) {
  const p = String(provider || "");
  const m = String(model || "");
  for (const b of FREE_ALLOWANCE_BUCKETS) {
    try { if (b.match(p, m)) return b; } catch {}
  }
  return null;
}

function bucketKey(bucketId) { return `bucket:${bucketId}`; }
function bucketLive(bucket) {
  try {
    const rec = state.quota?.[bucketKey(bucket.id)];
    if (!rec) return null;
    if (Date.now() > Number(rec.depletedUntil || 0)) return null;
    return rec;
  } catch { return null; }
}
/** Short model name for bucket membership lists. */
function bucketMemberShort(m) {
  return String(m || "")
    .replace(/^.*\//, "")
    .replace(/:free$/i, "")
    .replace(/-contributor-free$/i, "")
    .replace(/-contributor$/i, "")
    .replace(/-free$/i, "");
}

const QUOTA_TTL_MS = Number(process.env.QUOTA_DEPLETED_TTL_MS || 6 * 3600 * 1000);
function quotaKey(provider, model) { return `${provider}/${model || ""}`; }

/** Resolve the memory key: shared buckets collapse to one entry, per-model keeps route key. */
function quotaRecordKey(provider, model) {
  const bucket = resolveAllowanceBucket(provider, model);
  if (bucket && bucket.scope === "shared") return { key: bucketKey(bucket.id), bucket, shared: true };
  return { key: quotaKey(provider, model), bucket, shared: false };
}

/** Parse "try again in 3h 20m" / "until 2026-…Z" hints. 0 = none found. */
function parseDepletedUntil(errText) {
  const s = String(errText || "");
  const iso = s.match(/(20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)/);
  if (iso) {
    const t = Date.parse(iso[1]);
    if (Number.isFinite(t) && t > Date.now()) return t;
  }
  const hm = s.match(/in\s+(\d+)\s*h(?:ours?|rs?)?\s*(\d+)?\s*m/i);
  if (hm) return Date.now() + (Number(hm[1]) * 3600 + Number(hm[2] || 0) * 60) * 1000;
  const hOnly = s.match(/in\s+(\d+)\s*h(?:ours?|rs?)?\b/i);
  if (hOnly) return Date.now() + Number(hOnly[1]) * 3600 * 1000;
  const mOnly = s.match(/in\s+(\d+)\s*m(?:in(?:utes?)?)?\b/i);
  if (mOnly) return Date.now() + Number(mOnly[1]) * 60 * 1000;
  const sOnly = s.match(/in\s+(\d+)\s*s(?:ec(?:onds?)?)?\b/i);
  if (sOnly) return Date.now() + Number(sOnly[1]) * 1000;
  return 0;
}
function markDepleted(provider, model, errText) {
  try {
    const { key, bucket, shared } = quotaRecordKey(provider, model);
    const parsed = parseDepletedUntil(errText);
    const rec = {
      depletedUntil: parsed || Date.now() + QUOTA_TTL_MS,
      lastError: String(errText || "").slice(0, 300),
      scope: shared ? "shared" : "per-model",
    };
    if (shared) {
      rec.bucket = bucket.id;
      rec.hitBy = String(model || "").includes("/") ? String(model) : quotaKey(provider, model);
    }
    state.quota[key] = rec;
    saveState(state);
    if (shared) {
      return {
        key,
        bucketId: bucket.id,
        label: bucket.label,
        sharedNote:
          `${bucket.label} [shared] — a quota/limit here means every ${bucket.label} ` +
          `model fails until reset (${bucket.resetHint}).`,
      };
    }
    return { key, bucketId: bucket?.id || null, label: bucket?.label || null, sharedNote: "" };
  } catch { return null; }
}

function isDepleted(provider, model) {
  try {
    const { key } = quotaRecordKey(provider, model);
    const rec = state.quota?.[key];
    if (!rec) return false;
    if (Date.now() > Number(rec.depletedUntil || 0)) {
      delete state.quota[key];
      saveState(state);
      return false;
    }
    return true;
  } catch { return false; }
}

function quotaLines() {
  const out = [];
  for (const [k, v] of Object.entries(state.quota || {})) {
    if (!v) continue;
    if (Date.now() > Number(v.depletedUntil || 0)) continue;
    const who = v.hitBy ? ` (hit by ${v.hitBy})` : "";
    out.push(`${k}${who} depleted until ${new Date(v.depletedUntil).toISOString()}`);
  }
  return out;
}

/** Render the "Buckets" section of /allowance (structure is honest even when counts are unknown). */
function allowanceBucketSection() {
  const lines = ["Buckets"];
  for (const b of FREE_ALLOWANCE_BUCKETS) {
    if (b.id === "cloudflare-neurons") {
      let extra = " unknown";
      try {
        const led = loadCfNeuronLedger();
        const used = Number(led.used) || 0;
        const left = Math.max(0, CF_NEURON_DAY - used);
        extra = led.exhausted
          ? ` ${used.toFixed(0)}/${CF_NEURON_DAY} · DAILY CAP HIT`
          : ` est ${used.toFixed(0)}/${CF_NEURON_DAY} · ~${left.toFixed(0)} left`;
      } catch {}
      lines.push(`· ${b.label} [shared 10k/UTC] —${extra} · reset ${b.resetHint}`);
      continue;
    }
    if (b.id === "freebuff-freebucks") {
      lines.push(
        `· ${b.label} [shared] — ${freebuffCredsOk() ? "signed in" : "not signed in"} · UI only / terminal · reset ${b.resetHint}`
      );
      continue;
    }
    if (b.scope === "per-model") {
      lines.push(`· ${b.label} [per-model] · reset ${b.resetHint}`);
      for (const m of PROVIDERS.cline?.freeModels || []) {
        const rec = state.quota?.[quotaKey("cline", m)];
        const live = rec && Date.now() <= Number(rec.depletedUntil || 0) ? rec : null;
        lines.push(
          `    – ${bucketMemberShort(m)} : ${live ? `depleted until ${new Date(live.depletedUntil).toISOString()}` : "OK / unknown"}`
        );
      }
      continue;
    }
    // shared bucket
    const rec = bucketLive(b);
    const members = (b.members || []).map(bucketMemberShort).join(", ");
    if (rec) {
      lines.push(
        `· ${b.label} [shared] — DEPLETED until ${new Date(rec.depletedUntil).toISOString()}` +
          `${rec.hitBy ? ` (hit by ${rec.hitBy})` : ""}` +
          `${members ? ` · affects: ${members}` : ""}`
      );
    } else {
      const extra =
        b.id === "tokenharbor-free"
          ? "unknown remaining (dashboard only)"
          : `unknown remaining (${b.resetHint})`;
      lines.push(`· ${b.label} [shared] — ${extra} · OK`);
    }
  }
  return lines;
}

// ---- B) orphan-safe child teardown ----
function killPidTree(pid, why) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) return false;
  let ok = false;
  const sig = (p, s) => { try { process.kill(p, s); ok = true; } catch {} };
  sig(-n, "SIGTERM"); sig(n, "SIGTERM");
  try { execSync(`pkill -TERM -P ${n} 2>/dev/null || true`, { stdio: "ignore" }); } catch {}
  setTimeout(() => {
    if (!pidAlive(n)) return;
    sig(-n, "SIGKILL"); sig(n, "SIGKILL");
    try { execSync(`pkill -KILL -P ${n} 2>/dev/null || true`, { stdio: "ignore" }); } catch {}
  }, 3000).unref?.();
  if (why) console.log(`killPidTree(${n}, ${why}) signalled`);
  return ok;
}
function reapClineChild(why) {
  const pids = new Set();
  if (Number(activeClinePid) > 0) pids.add(Number(activeClinePid));
  if (Number(state.clinePid) > 0) pids.add(Number(state.clinePid));
  let any = false;
  for (const p of pids) any = killPidTree(p, why || "reap cline") || any;
  activeClinePid = null;
  if (state.clinePid) { state.clinePid = null; try { saveState(state); } catch {} }
  return any;
}
function clearClineTracking() {
  activeClinePid = null;
  if (state.clinePid) { state.clinePid = null; try { saveState(state); } catch {} }
}

let state = loadState();
/** True only while this process is awaiting dispatch() for a user message. */
let dispatchActive = false;
let busyIdleStreak = 0;

function busyKeyboard() {
  return new InlineKeyboard()
    .text("Cancel & unlock", "busy_unlock")
    .text("Status", "busy_status")
    .row()
    .text("New session", "busy_new");
}

async function clearBusyLock(reason, { abort = false, notify = false } = {}) {
  const wasBusy = state.busy;
  // B) /unlock (and watchdog/orphan clears) must reap orphaned cline children.
  try { reapClineChild(`clearBusyLock:${reason}`); } catch {}
  const sid = state.sessions?.opencode;
  const preview = state.lastReplyPreview;
  const task = state.lastUserText;
  if (abort && sid) {
    try {
      await ocAbort(sid);
    } catch (e) {
      console.log("clearBusyLock abort failed:", e.message || e);
    }
  }
  state.busy = false;
  state.busySince = null;
  saveState(state);
  busyIdleStreak = 0;
  console.log(`busy lock cleared (${reason}); wasBusy=${wasBusy}`);
  if (notify && wasBusy && state.lastChatId) {
    const note =
      `Unlocked myself (${reason}).\n` +
      `Task was: ${(task || "(unknown)").slice(0, 200)}\n` +
      (preview ? `Last draft: ${String(preview).slice(0, 400)}\n` : "") +
      `Send your next message, or /new for a fresh session.`;
    bot.api.sendMessage(state.lastChatId, note).catch(() => {});
  }
  return wasBusy;
}

function gate(ctx) {
  const id = String(ctx.from?.id || "");
  if (id !== ALLOWED) {
    ctx.reply("Unauthorized.").catch(() => {});
    return false;
  }
  return true;
}

async function oc(path, opts = {}) {
  const timeoutMs = opts.timeoutMs || 60000;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const { timeoutMs: _t, ...fetchOpts } = opts;
    const r = await fetch(`${OC_URL}${path}`, {
      ...fetchOpts,
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    });
    const text = await r.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    if (!r.ok) throw new Error(`OpenCode ${r.status}: ${typeof body === "string" ? body.slice(0, 200) : JSON.stringify(body ?? "").slice(0, 200)}`);
    return body;
  } catch (e) {
    if (e?.name === "AbortError") throw new Error(`OpenCode timeout after ${timeoutMs / 1000}s`);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

async function ocAbort(sid) {
  try {
    await oc(`/session/${sid}/abort${OC_DIR_QS}`, { method: "POST", body: "{}", timeoutMs: 15000 });
  } catch {
    /* best effort */
  }
}

async function ensureOcSession() {
  const sid = state.sessions.opencode;
  if (sid) {
    try {
      const info = await oc(`/session/${sid}${OC_DIR_QS}`, { timeoutMs: 15000 });
      // Pin session directory to WORKSPACE; stale /workspace sessions are dropped.
      if (info && info.directory === WORKSPACE) return sid;
      console.log(`sticky session dir mismatch (${info?.directory} != ${WORKSPACE}); recreating`);
    } catch {
      /* recreate */
    }
  }
  const created = await oc(`/session${OC_DIR_QS}`, {
    method: "POST",
    body: "{}",
    timeoutMs: 30000,
  });
  state.sessions.opencode = created.id;
  saveState(state);
  return created.id;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Keep Telegram's top "…" typing indicator alive (expires ~5s). */
function startTypingPulse(api, chatId) {
  let stopped = false;
  const loop = (async () => {
    while (!stopped) {
      await api.sendChatAction(chatId, "typing").catch(() => {});
      await sleep(4000);
    }
  })();
  return () => {
    stopped = true;
  };
}

function ocModelBody() {
  const model = state.models.opencode;
  return model.includes("/")
    ? { providerID: model.split("/")[0], modelID: model.split("/").slice(1).join("/") }
    : { providerID: "opencode", modelID: model };
}

async function ocSessionStatus(sid) {
  const all = await oc(`/session/status${OC_DIR_QS}`, { timeoutMs: 10000 });
  return (all && all[sid]) || { type: "idle" };
}

async function ocMessageList(sid, limit = 40) {
  const q = `${OC_DIR_QS}&limit=${limit}`.replace("?&", "?");
  const msgs = await oc(`/session/${sid}/message${q}`, { timeoutMs: 30000 });
  return Array.isArray(msgs) ? msgs : [];
}

function messageCreated(m) {
  return m?.info?.time?.created || m?.time?.created || 0;
}

function messageId(m) {
  return m?.info?.id || m?.id || "";
}

function messageRole(m) {
  return m?.info?.role || m?.role || "";
}


async function summarizeOcProgress(sid, sinceCreated = 0) {
  const st = await ocSessionStatus(sid).catch(() => ({ type: "unknown" }));
  const msgs = await ocMessageList(sid, 80).catch(() => []);

  function scan(windowMsgs) {
    const toolCounts = {};
    const toolLines = [];
    let latestTodos = null;
    const textSnips = [];
    let assistantTurns = 0;
    let lastTool = null;
    let filesTouched = [];
    let lastErrorTool = null;

    for (const m of windowMsgs) {
      const role = messageRole(m);
      const parts = m.parts || m.info?.parts || [];
      if (role === "assistant") assistantTurns += 1;
      for (const p of parts) {
        if (role === "assistant" && p.type === "text" && p.text && String(p.text).trim()) {
          textSnips.push(String(p.text).trim());
        }
        if (p.type !== "tool" || !p.tool) continue;
        const name = p.tool;
        toolCounts[name] = (toolCounts[name] || 0) + 1;
        const stt = p.state || {};
        const status = stt.status || "unknown";
        let detail = "";
        const input = stt.input || {};
        if (name === "bash" && input.command) detail = String(input.command).replace(/\s+/g, " ").slice(0, 90);
        else if (input.file_path || input.path || input.filePath) {
          detail = String(input.file_path || input.path || input.filePath).slice(0, 90);
          if (status === "completed" || status === "done") filesTouched.push(detail);
        } else if (input.pattern || input.glob) {
          detail = String(input.pattern || input.glob).slice(0, 90);
        } else if (stt.title) detail = String(stt.title).slice(0, 90);
        const line = `${name} (${status})${detail ? `: ${detail}` : ""}`;
        lastTool = line;
        toolLines.push(line);
        if (status === "error") lastErrorTool = line + (stt.error ? ` — ${String(stt.error).slice(0, 120)}` : "");

        if (name === "todowrite" || name === "todoread" || name === "todo") {
          let todos = stt.metadata?.todos;
          if (!todos && typeof stt.output === "string") {
            try {
              const parsed = JSON.parse(stt.output);
              todos = Array.isArray(parsed) ? parsed : parsed?.todos;
            } catch {
              /* ignore */
            }
          }
          if (!todos && Array.isArray(stt.output)) todos = stt.output;
          if (Array.isArray(todos) && todos.length) latestTodos = todos;
        }
      }
    }
    return { toolCounts, toolLines, latestTodos, textSnips, assistantTurns, lastTool, filesTouched, lastErrorTool };
  }

  let recent = sinceCreated
    ? msgs.filter((m) => messageCreated(m) >= sinceCreated - 2000)
    : msgs.slice(-30);
  let scanned = scan(recent);
  let usedFallback = false;
  // Empty hung turn (common after abort): fall back to last real assistant work in session.
  if (!scanned.toolLines.length && !scanned.textSnips.length) {
    scanned = scan(msgs.slice(-40));
    usedFallback = true;
  }

  const {
    toolCounts,
    toolLines,
    latestTodos,
    textSnips,
    assistantTurns,
    lastTool,
    filesTouched,
    lastErrorTool,
  } = scanned;

  const lines = [];
  lines.push("Summary");
  if (usedFallback) {
    lines.push("(This stop caught an empty/hung turn — showing the last real OpenCode work instead.)");
  }

  // Plain result line
  const wrote = [...new Set(filesTouched.filter((f) => /\.(html|ts|tsx|js|mjs|css|md)$/i.test(f) || f.includes("/public/")))].slice(-6);
  if (textSnips.length) {
    const last = textSnips[textSnips.length - 1].replace(/\s+/g, " ").slice(0, 400);
    lines.push(`Result: ${last}`);
  } else if (wrote.length) {
    lines.push(`Result: changed files (${wrote.join(", ")}) but no finished reply text yet.`);
  } else if (toolLines.length) {
    lines.push("Result: ran tools but never wrote a finished answer.");
  } else {
    lines.push("Result: no useful work recorded for this turn.");
  }

  if (wrote.length) {
    lines.push("Files touched:");
    for (const f of wrote) lines.push(`  - ${f}`);
  }
  if (lastErrorTool) lines.push(`Blocked by: ${lastErrorTool}`);

  lines.push(`Session status: ${st.type || "unknown"}`);
  lines.push(`Assistant turns scanned: ${assistantTurns}`);
  const countStr = Object.entries(toolCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}×${v}`)
    .join(", ");
  lines.push(`Tools: ${countStr || "(none yet)"}`);
  if (lastTool) lines.push(`Last tool: ${lastTool}`);

  if (latestTodos) {
    const done = latestTodos.filter((t) => t.status === "completed" || t.status === "done").length;
    lines.push(`Todos: ${done}/${latestTodos.length} done`);
    for (const t of latestTodos.slice(0, 8)) {
      const mark = t.status === "completed" || t.status === "done" ? "✓" : t.status === "in_progress" ? "…" : "·";
      lines.push(`  ${mark} ${String(t.content || t.title || "").slice(0, 100)}`);
    }
    if (latestTodos.length > 8) lines.push(`  … +${latestTodos.length - 8} more`);
  }

  if (toolLines.length) {
    lines.push("Recent steps:");
    for (const line of toolLines.slice(-8)) lines.push(`  - ${line}`);
  }

  return lines.join("\n");
}

async function attachOcProgress(sid, sinceCreated, err) {
  let summary = "";
  try {
    summary = await summarizeOcProgress(sid, sinceCreated);
  } catch (e) {
    summary = `(could not read progress: ${e.message || e})`;
  }
  const base = err?.message || String(err);
  if (base.includes("Work so far:")) throw err instanceof Error ? err : new Error(base);
  const wrapped = new Error(`${base}\n\nWork so far:\n${summary}`);
  wrapped.cause = err;
  throw wrapped;
}

function ocToolDetail(p, maxLen = 70) {
  const stt = p.state || {};
  const input = stt.input || {};
  let detail = "";
  if (p.tool === "bash" && input.command) detail = String(input.command).replace(/\s+/g, " ");
  else if (input.file_path || input.path || input.filePath) {
    detail = String(input.file_path || input.path || input.filePath);
  } else if (input.pattern || input.glob) detail = String(input.pattern || input.glob);
  else if (stt.title) detail = String(stt.title);
  return detail.replace(/\s+/g, " ").trim().slice(0, maxLen);
}

function ocToolMark(status) {
  if (status === "completed" || status === "done") return "✓";
  if (status === "running" || status === "pending") return "…";
  if (status === "error") return "✗";
  return "·";
}

async function ocLastActivityLine(sid, sinceCreated = 0) {
  try {
    const msgs = await ocMessageList(sid, 20);
    const recent = sinceCreated
      ? msgs.filter((m) => messageCreated(m) >= sinceCreated - 2000)
      : msgs;
    for (let i = recent.length - 1; i >= 0; i--) {
      const parts = recent[i].parts || [];
      for (let j = parts.length - 1; j >= 0; j--) {
        const p = parts[j];
        if (p.type === "tool" && p.tool) {
          const stt = p.state || {};
          const detail = ocToolDetail(p, 60);
          return `${p.tool}${stt.status ? `/${stt.status}` : ""}${detail ? `: ${detail}` : ""}`;
        }
        if (p.type === "text" && p.text && String(p.text).trim()) {
          return `text: ${String(p.text).trim().replace(/\s+/g, " ").slice(0, 70)}`;
        }
        if (p.type === "reasoning" && p.text && String(p.text).trim()) {
          return `think: ${String(p.text).trim().replace(/\s+/g, " ").slice(0, 70)}`;
        }
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Compact live stream for Telegram: narrations + recent tools (Muse reasoning text is often empty/encrypted). */
async function ocCompactProgressCard(sid, sinceCreated, { label, detail, elapsedSec } = {}) {
  const head = await headlineFromLive(sid, {
    elapsedSec: elapsedSec || 0,
    detail: detail || "working",
  }).catch(() =>
    formatWorkingHeadline({
      providerLabel: label || PROVIDERS[state.provider]?.label || "OpenCode",
      modelLabel: prettyFreeLabel(state.provider, state.models?.[state.provider] || ""),
      elapsedSec: elapsedSec || 0,
      detail: detail || "working",
    })
  );
  const lines = [head];
  try {
    const msgs = await ocMessageList(sid, 40);
    const recent = sinceCreated
      ? msgs.filter((m) => messageCreated(m) >= sinceCreated - 2000)
      : msgs.slice(-25);

    const thoughts = [];
    const tools = [];
    let todos = null;
    for (const m of recent) {
      if (messageRole(m) !== "assistant") continue;
      for (const p of m.parts || []) {
        if (p.type === "reasoning" && p.text && String(p.text).trim()) {
          thoughts.push(String(p.text).trim().replace(/\s+/g, " "));
        } else if (p.type === "text" && p.text && String(p.text).trim()) {
          thoughts.push(String(p.text).trim().replace(/\s+/g, " "));
        } else if (p.type === "tool" && p.tool) {
          const stt = p.state || {};
          const mark = ocToolMark(stt.status);
          const detail = ocToolDetail(p, 72);
          tools.push(`${mark} ${p.tool}${detail ? ` ${detail}` : ""}`);
          if (p.tool === "todowrite" || p.tool === "todoread" || p.tool === "todo") {
            let list = stt.metadata?.todos;
            if (!list && typeof stt.output === "string") {
              try {
                const parsed = JSON.parse(stt.output);
                list = Array.isArray(parsed) ? parsed : parsed?.todos;
              } catch {
                /* ignore */
              }
            }
            if (Array.isArray(list) && list.length) todos = list;
          }
        }
      }
    }

    if (thoughts.length) {
      const last = thoughts[thoughts.length - 1].slice(0, 280);
      lines.push("");
      lines.push(`💭 ${last}`);
    }
    if (tools.length) {
      lines.push("");
      lines.push("🔧 Recent:");
      for (const t of tools.slice(-5)) lines.push(`· ${t}`);
    } else if (!thoughts.length) {
      lines.push("");
      lines.push("(waiting on model / first tool…)");
    }
    if (todos) {
      const done = todos.filter((t) => t.status === "completed" || t.status === "done").length;
      lines.push("");
      lines.push(`☑️ Todos ${done}/${todos.length}:`);
      for (const t of todos.slice(0, 5)) {
        const mark = ocToolMark(t.status === "in_progress" ? "running" : t.status);
        lines.push(`${mark} ${String(t.content || t.title || "").slice(0, 90)}`);
      }
    }
  } catch (e) {
    const fallback = await ocLastActivityLine(sid, sinceCreated).catch(() => null);
    if (fallback) {
      lines.push("");
      lines.push(`Last: ${fallback}`);
    } else {
      lines.push("");
      lines.push(`(progress read failed: ${String(e.message || e).slice(0, 80)})`);
    }
  }
  return lines.join("\n").slice(0, 3500);
}

async function waitOcIdle(sid, { onProgress, onTyping, label = "OpenCode", sinceCreated = 0 } = {}) {
  const started = Date.now();
  let lastProgressAt = 0;
  let lastActivityAt = Date.now();
  let lastFp = "";
  let sawBusy = false;
  for (;;) {
    const st = await ocSessionStatus(sid);
    let fp = st.type || "unknown";
    try {
      const info = await oc(`/session/${sid}${OC_DIR_QS}`, { timeoutMs: 10000 });
      fp += `|${info?.time?.updated || 0}|${info?.tokens?.output || 0}|${info?.tokens?.input || 0}`;
    } catch {
      /* ignore */
    }
    if (st.type === "busy" || st.type === "retry") sawBusy = true;

    // ROOT FIX: OpenCode free-tier "retry" can sit for 15m–2h. Fail fast + let dispatch failover.
    if (st.type === "retry") {
      const msg = String(st.message || st.error || "");
      const reason = String(st.action?.reason || st.reason || "");
      const freeTier =
        /free_tier_limit|free usage exceeded|subscribe to go|free limit reached/i.test(msg) ||
        /free_tier_limit/i.test(reason);
      if (freeTier) {
        await ocAbort(sid).catch(() => {});
        throw new Error(
          `Free usage exceeded (free_tier_limit): ${msg.slice(0, 160) || reason || "subscribe to Go"}`
        );
      }
      // Non-quota retries: don't wait forever
      if (Date.now() - started > 45000) {
        await ocAbort(sid).catch(() => {});
        throw new Error(`OpenCode retry timed out after 45s: ${msg.slice(0, 160)}`);
      }
    }


    const elapsedSec = Math.round((Date.now() - started) / 1000);
    const activityChanged = fp !== lastFp;
    // Compact thought/tool stream: periodic, or sooner when activity fingerprint moves.
    const duePeriodic = Date.now() - lastProgressAt >= OC_PROGRESS_MS;
    const dueActivity =
      activityChanged && lastProgressAt > 0 && Date.now() - lastProgressAt >= OC_PROGRESS_MIN_MS;
    const dueFirst = lastProgressAt === 0 && elapsedSec >= 3;
    if (onProgress && (duePeriodic || dueActivity || dueFirst)) {
      lastProgressAt = Date.now();
      const detail =
        st.type === "retry"
          ? `retry: ${(st.message || "waiting").slice(0, 120)}`
          : st.type || "working";
      const card = await ocCompactProgressCard(sid, sinceCreated, {
        label,
        detail,
        elapsedSec,
      }).catch(async () => {
        const activity = await ocLastActivityLine(sid, sinceCreated);
        const extra = activity ? `\nLast: ${activity}` : "";
        return `⏳ ${label} still working (${detail}, ${elapsedSec}s)…${extra}`;
      });
      await Promise.resolve(onProgress(card)).catch(() => {});
    }
    if (activityChanged) {
      lastFp = fp;
      lastActivityAt = Date.now();
    }

    if (Date.now() - started > OC_MAX_MS) {
      await ocAbort(sid);
      throw new Error(`OpenCode exceeded max runtime (${Math.round(OC_MAX_MS / 60000)} min)`);
    }
    if (Date.now() - lastActivityAt > OC_IDLE_MS) {
      await ocAbort(sid);
      throw new Error(
        `OpenCode idle timeout after ${Math.round(OC_IDLE_MS / 60000)} min with no progress (still ${st.type || "?"})`
      );
    }

    if (st.type === "idle") {
      // Prefer seeing busy→idle so we don't race the initial accept.
      if (sawBusy || elapsedSec >= 8) return;
    }
    if (onTyping) await Promise.resolve(onTyping()).catch(() => {});
    await sleep(3000);
  }
}

async function extractLatestAssistantSince(sid, sinceCreated, excludeIds) {
  const msgs = await ocMessageList(sid, 50);
  const assistants = msgs
    .filter((m) => messageRole(m) === "assistant")
    .filter((m) => messageCreated(m) >= sinceCreated - 1000)
    .filter((m) => !excludeIds.has(messageId(m)));
  // Prefer completed turns; fall back to newest.
  const completed = assistants.filter((m) => m?.info?.time?.completed || m?.time?.completed);
  const pick = (completed.length ? completed : assistants).sort(
    (a, b) => messageCreated(b) - messageCreated(a)
  )[0];
  if (!pick) return "(OpenCode finished with no assistant text)";
  if (pick.info?.error || pick.error) {
    const err = pick.info?.error || pick.error;
    const msg = err?.message || err?.name || JSON.stringify(err).slice(0, 300);
    throw new Error(`OpenCode message error: ${msg}`);
  }
  return extractOcText(pick);
}

async function runOpenCode(prompt, { onProgress, onTyping } = {}) {
  const sid = await ensureOcSession();
  const modelBody = ocModelBody();
  const body = {
    parts: [{ type: "text", text: prompt }],
    model: modelBody,
  };

  // Clear orphan busy from a prior Telegram hard-timeout so we can start cleanly.
  try {
    const st0 = await ocSessionStatus(sid);
    if (st0.type === "busy" || st0.type === "retry") {
      if (onProgress) await Promise.resolve(onProgress("OpenCode was still busy — aborting leftover turn…"));
      await ocAbort(sid);
      await waitOcIdle(sid, { onProgress, onTyping, label: "OpenCode (clearing)" });
    }
  } catch (e) {
    // If clearing fails, still try to submit; prompt_async may reject.
    console.error("pre-clear busy failed:", e.message || e);
  }

  const before = await ocMessageList(sid, 20);
  const excludeIds = new Set(before.map(messageId).filter(Boolean));
  const sinceCreated = Date.now();

  // Async prompt: returns immediately; we poll until idle.
  try {
    await oc(`/session/${sid}/prompt_async${OC_DIR_QS}`, {
      method: "POST",
      body: JSON.stringify(body),
      timeoutMs: 30000,
    });
  } catch (e) {
    // Fallback to sync message endpoint with long HTTP timeout (= max runtime).
    if (onProgress) await Promise.resolve(onProgress("Async prompt unavailable — using long sync wait…"));
    try {
      const result = await oc(`/session/${sid}/message${OC_DIR_QS}`, {
        method: "POST",
        body: JSON.stringify(body),
        timeoutMs: OC_MAX_MS,
      });
      return extractOcText(result);
    } catch (e2) {
      await ocAbort(sid);
      await attachOcProgress(sid, sinceCreated, e2);
    }
  }

  if (onProgress) {
    const sid0 = state.sessions?.opencode;
    const head = sid0
      ? await headlineFromLive(sid0, { elapsedSec: 0, detail: "working" }).catch(() => headlineFromState(0, "working"))
      : headlineFromState(0, "working");
    await Promise.resolve(onProgress(head));
  }
  try {
    await waitOcIdle(sid, { onProgress, onTyping, sinceCreated });
    const text = await extractLatestAssistantSince(sid, sinceCreated, excludeIds);
    try {
      const mid = state.models?.opencode || "";
      if (String(mid).includes("cloudflare/") || String(mid).includes("@cf/")) {
        const live = await fetchOpenCodeLiveStatus(sid).catch(() => null);
        if (live && !live.error) {
          recordCfNeuronEstimate(mid, live.tokens?.input || live.used || 0, live.tokens?.output || 0);
        }
      }
    } catch (e) {
      console.error("cf neuron ledger:", e.message || e);
    }
    return text;
  } catch (e) {
    await attachOcProgress(sid, sinceCreated, e);
  }
}

function extractOcText(result) {
  if (!result) return "(empty OpenCode reply)";
  if (typeof result === "string") return result;
  // Common shapes: array of messages, or { parts }, or { info, parts }
  const parts = result.parts || result.message?.parts || [];
  if (Array.isArray(parts) && parts.length) {
    const texts = parts.filter((p) => p.type === "text" && p.text).map((p) => p.text);
    if (texts.length) return texts.join("\n");
  }
  if (Array.isArray(result)) {
    for (let i = result.length - 1; i >= 0; i--) {
      const m = result[i];
      if (m.role === "assistant" || m.info?.role === "assistant") {
        const p = m.parts || [];
        const t = p.filter((x) => x.type === "text").map((x) => x.text).join("\n");
        if (t) return t;
      }
    }
  }
  return JSON.stringify(result).slice(0, 3500);
}

function runCmd(cmd, args, { cwd, env, timeoutMs = 180000, trackClinePid = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      detached: true,
      env: {
        ...process.env,
        ...env,
        PATH: `/home/box/.local/bin:/home/box/.local/n/bin:${(env && env.PATH) || process.env.PATH || ""}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    // B) Track the cline PID so timeout/unlock can SIGTERM->SIGKILL the tree.
    if (trackClinePid && child.pid) {
      activeClinePid = child.pid;
      state.clinePid = child.pid;
      try { saveState(state); } catch {}
    }
    let out = "";
    let err = "";
    let settled = false;
    const done = (fn, v) => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      fn(v);
    };
    const t = setTimeout(() => {
      // B) Never report timeout while leaving the child alive: kill the tree.
      const pid = child.pid;
      try { if (trackClinePid && pid) killPidTree(pid, "runCmd timeout"); }
      catch {}
      try { child.kill("SIGTERM"); } catch {}
      setTimeout(() => { try { if (pidAlive(pid)) child.kill("SIGKILL"); } catch {} }, 3000).unref?.();
      if (trackClinePid) clearClineTracking();
      done(reject, new Error(`Timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      out += d.toString();
      if (out.length > 200000) out = out.slice(-100000);
    });
    child.stderr.on("data", (d) => {
      err += d.toString();
      if (err.length > 50000) err = err.slice(-25000);
    });
    child.on("error", (e) => {
      if (trackClinePid) clearClineTracking();
      done(reject, new Error(e.code === "ENOENT" ? `Command not found: ${cmd}` : (e.message || String(e))));
    });
    child.on("close", (code) => {
      if (trackClinePid) clearClineTracking();
      if (code !== 0 && !out.trim()) {
        done(reject, new Error(err.slice(0, 1500) || `exit ${code}`));
      } else {
        done(resolve, out.trim() || err.trim() || `(exit ${code})`);
      }
    });
  });
}

async function runCline(prompt) {
  let model = String(state.models.cline || "").replace(/^cline\//, "");
  // Cline CLI treats single-token prompts (no whitespace) as "unquoted commands"
  // and rejects them — e.g. plain "Hi". Ensure at least one space so argv is accepted.
  let q = String(prompt ?? "");
  if (q.trim() && !/\s/.test(q)) q = `${q} `;
  // Flag order per `cline --help`: -m, -c, --thinking, --json, prompt last.
  const think = clineThinkingLevel();
  const args = ["-m", model, "-c", WORKSPACE];
  if (think) args.push("--thinking", think);
  args.push("--json", q);
  console.log(`runCline argv: cline ${args.map((a) => (a === q ? "<prompt>" : a)).join(" ")}`);
  const stripAnsi = (s) => String(s || "").replace(/\x1b\[[0-9;]*m/g, "").replace(/\[\d+m/g, "");
  try {
    // B) Telegram timeout default >= 20 min (CLINE_TIMEOUT_MS); PID tracked+reaped.
    const out = await runCmd("cline", args, { timeoutMs: CLINE_TIMEOUT_MS, trackClinePid: true });
    const lines = out.split("\n").filter(Boolean);
    // Prefer terminal run_result / done event text
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const row = JSON.parse(lines[i]);
        const textOut =
          row.text ||
          row.message ||
          row.content ||
          row?.event?.text ||
          row?.event?.event?.text ||
          null;
        if (textOut && (row.type === "run_result" || row.finishReason || row?.event?.type === "done" || row.type === "agent_event")) {
          return String(textOut);
        }
        if (textOut && i === lines.length - 1) return String(textOut);
      } catch {
        /* continue */
      }
    }
    return stripAnsi(out).slice(0, 4000);
  } catch (e) {
    return `Cline error: ${stripAnsi(e.message)}`;
  }
}

async function runTokenHarbor(prompt) {
  if (!TH_KEY) return "Token Harbor API key missing on this box.";
  const model = state.models.tokenharbor;
  const r = await fetch(`${TH_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TH_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "You are a coding assistant for the biomarker/health tracker repo. Be concise and actionable.",
        },
        { role: "user", content: prompt },
      ],
    }),
  });
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return `Token Harbor raw: ${text.slice(0, 800)}`;
  }
  if (!r.ok) return `Token Harbor ${r.status}: ${JSON.stringify(data).slice(0, 800)}`;
  return data.choices?.[0]?.message?.content || JSON.stringify(data).slice(0, 1500);
}

async function runFreebuff(prompt, opts = {}) {
  const onProgress = opts.onProgress;
  const model = state.models.freebuff;
  const started = Date.now();
  const pulse = setInterval(() => {
    if (!onProgress) return;
    const sec = Math.round((Date.now() - started) / 1000);
    Promise.resolve(
      onProgress(`⏳ Freebuff ${prettyFreeLabel("freebuff", model)} working… ${sec}s\n\n(CLI has no Telegram chat mode — checking…)`)
    ).catch(() => {});
  }, 5000);
  try {
    // Freebuff CLI is interactive (login / TUI). There is no stable non-interactive
    // `chat -m` for Telegram. Try a few known shapes, then explain clearly.
    const attempts = [
      ["freebuff", ["--help"]],
    ];
    let help = "";
    try {
      help = await runCmd("freebuff", ["--help"], { cwd: WORKSPACE, timeoutMs: 15000 });
    } catch (e) {
      return (
        `Freebuff CLI error: ${e.message}\n` +
        "Use /freemodel and pick OpenCode Muse or Token Harbor for Telegram chat."
      );
    }
    if (!/login/i.test(help) && /chat/i.test(help)) {
      // unexpected newer CLI with chat — try it
      try {
        const out = await runCmd(
          "freebuff",
          ["chat", "-m", model, String(prompt)],
          { cwd: WORKSPACE, timeoutMs: 120000 }
        );
        return out.slice(0, 4000);
      } catch (e) {
        return `Freebuff chat failed: ${e.message}`;
      }
    }
    return (
      "Freebuff is signed in on this box, but its CLI is interactive-only (no Telegram one-shot chat).\n" +
      `Selected model: \`${model}\`\n\n` +
      "For Telegram, use /freemodel → OpenCode Muse, Token Harbor, or Cline.\n" +
      "Keep Freebuff for terminal coding sessions."
    );
  } finally {
    clearInterval(pulse);
  }
}


async function runCommandCode(prompt) {
  const model = state.models.commandcode || "poolside/laguna-s-2.1-free";
  const env = {
    ...process.env,
    PATH: `/home/box/.local/n/bin:/home/box/.local/bin:${process.env.PATH || ""}`,
  };
  const args = ["-p", prompt, "-m", model, "--no-session", "-t"];
  try {
    const out = await runCmd("command-code", args, { cwd: WORKSPACE, env, timeoutMs: 240000 });
    return out.slice(0, 4000) || "(empty Command Code reply)";
  } catch (e) {
    const msg = String(e.message || e);
    if (/insufficient credits|purchase more credits/i.test(msg)) {
      return (
        "Command Code is signed in, but this account has no credits left " +
        "(even free-tagged models are blocked until you add credits at https://commandcode.ai/billing). " +
        `Model: ${model}`
      );
    }
    return `Command Code error: ${msg.slice(0, 1500)}`;
  }
}

async function dispatchOnce(prompt, opts = {}) {
  const p = state.provider;
  if (p === "opencode") return runOpenCode(prompt, opts);
  if (p === "cline") return runCline(prompt);
  if (p === "tokenharbor") return runTokenHarbor(prompt);
  if (p === "freebuff") return runFreebuff(prompt, opts);
  if (p === "commandcode") return runCommandCode(prompt);
  return `Unknown provider: ${p}`;
}

async function dispatch(prompt, opts = {}) {
  const onProgress = opts.onProgress;
  const tried = [];
  const start = currentRoute();
  let routes = [{ provider: start.provider, model: start.model }, ...nextFailoverRoutes(start.provider, start.model)];
  // De-dupe
  const seen = new Set();
  routes = routes.filter((r) => {
    const k = `${r.provider}::${r.model}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  // E) Skip routes known-depleted until depletedUntil passes.
  routes = routes.filter((r) => !isDepleted(r.provider, r.model));
  if (!routes.length) routes = [{ provider: start.provider, model: start.model }];

  let lastReply = null;
  let lastErr = null;
  // Optional light: surface a shared-bucket note when failover was caused by a
  // shared free pool (e.g. OpenCode Zen free / Cloudflare neurons).
  let lastSharedNote = "";
  for (let i = 0; i < routes.length; i++) {
    const route = routes[i];
    if (i > 0) {
      applyRoute(route.provider, route.model);
      if (onProgress) {
        const base = `Quota/limit on prior free lane — switching to ${PROVIDERS[route.provider]?.label || route.provider}: ${route.model}`;
        await Promise.resolve(onProgress(lastSharedNote ? `${lastSharedNote}\n${base}` : base));
      }
    } else if (state.provider !== route.provider || state.models[route.provider] !== route.model) {
      applyRoute(route.provider, route.model);
    }
    tried.push(`${route.provider}/${route.model}`);
    try {
      const reply = await dispatchOnce(prompt, opts);
      lastReply = reply;
      if (!looksLikeHardFailure(reply)) {
        if (i > 0) {
          const wasGreetingOnly = isGreetingOnly(prompt) && !state.lastUserText;
          // C) Re-dispatched reply on the new lane; prefix with banner.
          // If the user message was only a greeting with no prior task, a
          // short welcome on the new lane is acceptable — but only then.
          const body = String(reply || "");
          if (wasGreetingOnly && isClineGreetingOnly(body)) return body;
          if (isClineGreetingOnly(body) && !wasGreetingOnly) {
            // New lane answered the real task with just a greeting: surface
            // it with the banner + task echo so the user sees re-dispatch
            // happened instead of a dropped prompt.
            const note =
              `⚡ Auto-switched free lane after quota/limit.\n` +
              `Now: ${PROVIDERS[route.provider]?.label || route.provider} · \`${route.model}\`\n` +
              `Tried: ${tried.join(" → ")}\n` +
              `Re-ran your task on the new lane, but it only returned a greeting — please resend or try /freemodel.\n` +
              `Your task was: ${(prompt || "").slice(0, 500)}\n\n`;
            return note + body;
          }
          const note =
            `⚡ Auto-switched free lane after quota/limit.\n` +
            `Now: ${PROVIDERS[route.provider]?.label || route.provider} · \`${route.model}\`\n` +
            `Tried: ${tried.join(" → ")}\n\n`;
          // C) Failover re-dispatch: `reply` IS the same user prompt re-run on
          // the new lane (dispatchOnce(prompt) above), not a fresh greeting.
          return note + body;
        }
        return reply;
      }
      // Soft failure string from provider — only failover on quota-ish errors
      if (!isQuotaOrLimitError(reply) && i === 0) return reply;
      // E) Remember rolling-period / free-allowance depletion for this route.
      try {
        const info = markDepleted(route.provider, route.model, reply);
        if (info?.sharedNote) lastSharedNote = info.sharedNote;
      } catch {}
      lastErr = reply;
      continue;
    } catch (e) {
      lastErr = e.message || String(e);
      if (!isQuotaOrLimitError(lastErr) && i === 0) throw e;
      // E) Remember thrown quota errors too.
      try {
        const info = markDepleted(route.provider, route.model, lastErr);
        if (info?.sharedNote) lastSharedNote = info.sharedNote;
      } catch {}
      // else try next
    }
  }
  if (lastReply != null) return lastReply;
  throw new Error(lastErr || "All free-lane failover routes failed");
}

function busyElapsed() {
  if (!state.busy || !state.busySince) return null;
  const s = Math.max(0, Math.round((Date.now() - Date.parse(state.busySince)) / 1000));
  return s;
}

function isStatusPing(text) {
  return STATUS_PING_RE.test(text || "");
}

function statusPingReply() {
  const elapsed = busyElapsed();
  if (state.busy) {
    return (
      `Yes — still working.\n` +
      `Task: ${(state.lastUserText || "(unknown)").slice(0, 300)}\n` +
      `Started: ${state.busySince || "?"}${elapsed != null ? ` (${elapsed}s ago)` : ""}\n` +
      `Session: ${state.sessions.opencode || "(none)"}\n` +
      `If this looks stuck: /unlock or tap Cancel on the Busy message.`
    );
  }
  return (
    `Idle — not currently running a task.\n` +
    `Last handled: ${(state.lastUserText || "(none)").slice(0, 300)}\n` +
    (state.lastReceivedText && state.lastReceivedText !== state.lastUserText
      ? `Last received: ${(state.lastReceivedText || "").slice(0, 300)}\n`
      : "") +
    `Last reply: ${(state.lastReplyPreview || "(none)").slice(0, 300)}\n` +
    (state.lastError ? `Last error: ${String(state.lastError).slice(0, 300)}\n` : "") +
    `Session: ${state.sessions.opencode || "(none)"}`
  );
}

/** Working headline lives in ./tg-progress.vendor.mjs (single source). */

function headlineFromState(elapsedSec = 0, detail = "working") {
  const p = state.provider;
  const providerLabel = PROVIDERS[p]?.label || p;
  const modelId = state.models?.[p] || "";
  const modelLabel = prettyFreeLabel(p, modelId);
  const thinking = p === "cline" ? clineThinkingDisplay() : "";
  return formatWorkingHeadline({
    providerLabel,
    modelLabel,
    thinking,
    elapsedSec,
    detail,
  });
}

async function headlineFromLive(sid, { elapsedSec = 0, detail = "working" } = {}) {
  const providerLabel = PROVIDERS[state.provider]?.label || state.provider;
  const modelId = state.models?.[state.provider] || "";
  let modelLabel = prettyFreeLabel(state.provider, modelId);
  let thinking = "";
  let used = null;
  let ctxLimit = null;
  let pct = null;
  if (state.provider === "cline") {
    thinking = clineThinkingDisplay();
  }
  if (state.provider === "opencode" && sid) {
    const live = await fetchOpenCodeLiveStatus(sid).catch(() => null);
    if (live && !live.error) {
      modelLabel =
        prettyFreeLabel("opencode", live.modelID || modelId) ||
        String(live.modelName || modelLabel).toLowerCase();
      thinking = live.thinking || "";
      used = live.used;
      ctxLimit = live.ctxLimit;
      pct = live.pct;
    }
  }
  return formatWorkingHeadline({
    providerLabel,
    modelLabel,
    thinking,
    elapsedSec,
    used,
    ctxLimit,
    pct,
    detail,
  });
}


async function fetchOpenCodeModelMeta(providerID, modelID) {
  try {
    const prov = await oc(`/provider`, { timeoutMs: 10000 });
    const all = prov.all || prov.providers || [];
    const p = all.find((x) => x.id === providerID) || all.find((x) => x.id === "opencode");
    const models = p?.models || {};
    return models[modelID] || models[`${providerID}/${modelID}`] || null;
  } catch {
    return null;
  }
}

function resolveCtxLimit(providerID, modelID, meta) {
  const fromMeta = Number(meta?.limit?.context) || 0;
  if (fromMeta > 0) return fromMeta;
  const id = String(modelID || "");
  const full = id.includes("/") ? id : `${providerID}/${id}`;
  // Single-source limits table lives in the vendored tg-progress framework.
  return (
    ctxLimitFor(id) ||
    ctxLimitFor(full) ||
    ctxLimitFor(`${providerID}/${id}`) ||
    null
  );
}

/** Prefer last completed assistant turn tokens — session.tokens are lifetime cumulatives. */
async function fetchLastAssistantContextUsed(sid) {
  try {
    const msgs = await oc(`/session/${sid}/message${OC_DIR_QS}`, { timeoutMs: 20000 });
    if (!Array.isArray(msgs)) return null;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const info = msgs[i]?.info || msgs[i];
      if (info?.role !== "assistant") continue;
      const t = info.tokens || {};
      const cache = t.cache || {};
      const total = Number(t.total) || 0;
      const inn = Number(t.input) || 0;
      const cacheRead = Number(cache.read) || 0;
      // Prefer total; else input (+ cache read if present). Skip empty in-flight msgs.
      const used = total > 0 ? total : inn + cacheRead;
      if (used > 0) return { used, tokens: t, messageID: info.id || null };
    }
  } catch (e) {
    console.error("last-assistant context:", e.message || e);
  }
  return null;
}

async function fetchOpenCodeLiveStatus(sid) {
  if (!sid) return null;
  try {
    const info = await oc(`/session/${sid}${OC_DIR_QS}`, { timeoutMs: 15000 });
    if (!info || typeof info !== "object") return null;
    const model = info.model || {};
    const providerID = model.providerID || "opencode";
    const modelID = model.id || "";
    const meta = await fetchOpenCodeModelMeta(providerID, modelID);
    let ctxLimit = resolveCtxLimit(providerID, modelID, meta);
    const tok = info.tokens || {};
    const cache = tok.cache || {};
    // Session counters are lifetime cumulatives (can be millions) — not current context.
    const sessionUsed = (Number(tok.input) || 0) + (Number(cache.read) || 0);
    const last = await fetchLastAssistantContextUsed(sid);
    let used = last?.used ?? null;
    let tokensOut = last?.tokens || tok;
    // If last turn missing, only trust sessionUsed when it fits the window.
    if (used == null) {
      if (ctxLimit && sessionUsed > 0 && sessionUsed <= ctxLimit * 1.05) used = sessionUsed;
      else if (!ctxLimit && sessionUsed > 0 && sessionUsed < 500_000) used = sessionUsed;
      else used = null; // hide misleading multi-million totals
    }
    // Still absurd vs known window? hide rather than lie.
    if (used != null && ctxLimit && used > ctxLimit * 1.25) used = null;
    const pct = used != null && ctxLimit ? Math.min(100, (used / ctxLimit) * 100) : null;
    const thinking = model.variant || "default";
    const modelName = meta?.name || modelID || state.models.opencode;
    return {
      title: info.title || info.slug || "",
      agent: info.agent || "?",
      modelName,
      modelID,
      providerID,
      thinking,
      tokens: tokensOut,
      used,
      ctxLimit,
      pct,
      cost: info.cost,
      directory: info.directory,
      version: info.version,
    };
  } catch (e) {
    return { error: String(e.message || e).slice(0, 180) };
  }
}

async function statusText() {
  const p = state.provider;
  const elapsed = busyElapsed();
  const lines = [
    `Provider: ${PROVIDERS[p]?.label || p} (\`${p}\`)`,
    `Model: \`${state.models[p]}\``,
    `Workspace: \`${WORKSPACE}\``,
    `Busy: ${state.busy ? `yes since ${state.busySince} (${elapsed}s)` : "no"}`,
  ];

  if (p === "opencode") {
    const sid = state.sessions.opencode || "(none)";
    lines.push(`Session: \`${sid}\``);
    const live = await fetchOpenCodeLiveStatus(state.sessions.opencode);
    if (live?.error) {
      lines.push(`OpenCode: unavailable (${live.error})`);
    } else if (live) {
      lines.push(`Agent: ${live.agent}`);
      lines.push(`OpenCode model: ${live.modelName}`);
      lines.push(`Thinking: ${live.thinking}`);
      if (live.pct != null) {
        lines.push(
          `Context: ${formatTokenCount(live.used)} / ${formatTokenCount(live.ctxLimit)} (${live.pct.toFixed(1)}%)`
        );
      } else {
        lines.push(`Context used: ${formatTokenCount(live.used)} tokens`);
      }
      const tok = live.tokens || {};
      const cache = tok.cache || {};
      lines.push(
        `Tokens: in ${formatTokenCount(tok.input)} · out ${formatTokenCount(tok.output)} · reasoning ${formatTokenCount(tok.reasoning)} · cache read ${formatTokenCount(cache.read)}`
      );
      if (live.cost != null) lines.push(`Cost: ${live.cost}`);
      if (live.title) lines.push(`Title: ${live.title}`);
      if (live.directory) lines.push(`Dir: \`${live.directory}\``);
    } else {
      lines.push("OpenCode: no live session yet");
    }
  } else if (p === "cline") {
    lines.push(`Thinking: ${clineThinkingDisplay()}`);
    lines.push(`Session: ${state.sessions.opencode || "(none)"} (OpenCode sticky)`);
    lines.push(`Note: live usage details are shown when provider is opencode.`);
  } else {
    lines.push(`Session: ${state.sessions.opencode || "(none)"} (OpenCode sticky)`);
    lines.push(`Note: live usage/thinking details are shown when provider is opencode.`);
  }

  lines.push(`Last handled: ${(state.lastUserText || "(none)").slice(0, 200)}`);
  if (state.lastReceivedText && state.lastReceivedText !== state.lastUserText) {
    lines.push(`Last received: ${(state.lastReceivedText || "").slice(0, 200)}`);
  }
  lines.push(`Last reply: ${(state.lastReplyPreview || "(none)").slice(0, 200)}`);
  if (state.lastError) lines.push(`Last error: ${String(state.lastError).slice(0, 200)}`);
  return lines.join("\n");
}

async function compactOpenCodeSession() {
  const sid = await ensureOcSession();
  const model = state.models.opencode || "opencode/muse-spark-1.3-contributor-free";
  const providerID = model.includes("/") ? model.split("/")[0] : "opencode";
  const modelID = model.includes("/") ? model.split("/").slice(1).join("/") : model;
  // OpenCode compaction = session.summarize (v2 /compact is not available yet).
  await oc(`/session/${sid}/summarize${OC_DIR_QS}`, {
    method: "POST",
    body: JSON.stringify({ providerID, modelID }),
    timeoutMs: 180000,
  });
  const live = await fetchOpenCodeLiveStatus(sid);
  return { sid, live };
}



function prettyFreeLabel(providerKey, modelId) {
  let s = String(modelId || "");
  s = s
    .replace(/^opencode\//i, "")
    .replace(/^cloudflare\//i, "cf ")
    .replace(/^@cf\//i, "")
    .replace(/^cline-free\//i, "")
    .replace(/^cline\//i, "")
    .replace(/:free$/i, "")
    .replace(/-contributor-free(?:-high)?$/i, " free")
    .replace(/-free$/i, " free")
    .replace(/[_/]+/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  // Cline free lane always reads as free in the label.
  if (providerKey === "cline" && !/\bfree\b/.test(s)) s = `${s} free`;
  if (providerKey === "tokenharbor" && !/\bfree\b/.test(s)) s = `${s} free`;
  if (providerKey === "commandcode" && !/\bfree\b/.test(s) && /free/i.test(modelId)) {
    s = `${s} free`;
  }
  if (/qwen3\.8-27b|qwen3\.8 27b/i.test(modelId) || /qwen3\.8 27b/i.test(s)) {
    s = `${s} · burns ~5k neurons/turn`;
  } else if (/glm-4\.7-flash/i.test(modelId) || /glm 4\.7 flash/i.test(s)) {
    s = `${s} · cheaper CF neurons`;
  }
  return s;
}

function formatFreeLine(providerKey, modelId, displayName) {
  const label = displayName || prettyFreeLabel(providerKey, modelId);
  // Flush-left: no hanging indent (Telegram doesn't support CSS align).
  return `${providerKey}: ${label}\n\`${modelId}\``;
}

async function probeOpenCodeFree() {
  const out = [];
  try {
    const health = await fetch(`${OC_URL}/global/health`, { signal: AbortSignal.timeout(4000) });
    if (!health.ok) return { ok: false, reason: `OpenCode health ${health.status}`, items: [] };
    const r = await fetch(`${OC_URL}/provider`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return { ok: false, reason: `OpenCode /provider ${r.status}`, items: [] };
    const data = await r.json();
    const providers = data.all || data.providers || [];
    const oc = providers.find((p) => p.id === "opencode");
    if (!oc?.models) return { ok: false, reason: "OpenCode provider missing", items: [] };
    for (const [mid, meta] of Object.entries(oc.models)) {
      const name = (meta && meta.name) || mid;
      const idLow = mid.toLowerCase();
      const nameLow = String(name).toLowerCase();
      const tagged = idLow.includes("free") || nameLow.includes("free");
      // Only advertise clearly free-tagged OpenCode models (keeps Telegram under length limits).
      if (!tagged) continue;
      const fullId = mid.includes("/") ? mid : `opencode/${mid}`;
      out.push({
        id: fullId,
        label: prettyFreeLabel("opencode", fullId),
        display: name,
      });
    }
    // Cloudflare Workers AI free models (10k neurons/day) — no "free" tag in ids.
    const cf = providers.find((p) => p.id === "cloudflare");
    if (cf?.models) {
      for (const [mid, meta] of Object.entries(cf.models)) {
        const name = (meta && meta.name) || mid;
        const fullId = mid.startsWith("cloudflare/") ? mid : `cloudflare/${mid}`;
        if (out.some((x) => x.id === fullId)) continue;
        out.push({
          id: fullId,
          label: prettyFreeLabel("opencode", fullId) + " (cf)",
          display: name,
        });
      }
    }
    // Also surface Token Harbor free models hosted inside OpenCode (tools path).
    const th = providers.find((p) => p.id === "tokenharbor");
    if (th?.models) {
      for (const [mid, meta] of Object.entries(th.models)) {
        const name = (meta && meta.name) || mid;
        const idLow = String(mid).toLowerCase();
        if (!(idLow.includes("free") || idLow.includes(":free") || /free/i.test(name))) continue;
        const fullId = mid.includes("/") ? mid : `tokenharbor/${mid}`;
        if (out.some((x) => x.id === fullId)) continue;
        out.push({
          id: fullId,
          label: prettyFreeLabel("opencode", fullId) + " (th)",
          display: name,
        });
      }
    }
    out.sort((a, b) => a.label.localeCompare(b.label));
    return { ok: true, items: out };
  } catch (e) {
    return { ok: false, reason: String(e.message || e).slice(0, 200), items: [] };
  }
}

function clineAuthOk() {
  try {
    const p = "/home/box/.cline/data/settings/providers.json";
    if (!existsSync(p)) return false;
    const d = JSON.parse(readFileSync(p, "utf8"));
    const auth = d?.providers?.cline?.settings?.auth || {};
    return Boolean(auth.accessToken || auth.token || auth.refreshToken);
  } catch {
    return false;
  }
}
async function probeClineFree() {
  const known = [
    {
      id: "cline-free/muse-spark-1.3-contributor",
      label: "muse spark 1.3 free",
    },
    {
      id: "cline-free/deepseek-v4.1-flash",
      label: "deepseek v4.1 flash free",
    },
    // Used successfully on this box as free lane; keep only if auth+hub up.
    {
      id: "cline-free/glm-5.3-flash",
      label: "glm 5.3 flash free",
    },
  ];
  if (!clineAuthOk()) {
    return { ok: false, reason: "Cline not signed in", items: [] };
  }
  // Prefer live hub check via spawn sync without breaking ESM: use runCmd pattern via promisify later.
  // Lightweight TCP/http check on hub port.
  try {
    const r = await fetch("http://127.0.0.1:25463/hub", { signal: AbortSignal.timeout(2000) });
    // 404 still means daemon is listening
    if (!(r.status === 200 || r.status === 404 || r.status === 405)) {
      return { ok: false, reason: `Cline hub HTTP ${r.status}`, items: [] };
    }
  } catch (e) {
    return { ok: false, reason: "Cline hub not reachable", items: [] };
  }
  return {
    ok: true,
    items: known.map((k) => ({ id: k.id, label: k.label })),
  };
}

async function probeTokenHarborFree() {
  if (!TH_KEY) return { ok: false, reason: "Token Harbor API key missing", items: [] };
  try {
    const r = await fetch(`${TH_URL}/models`, {
      headers: { Authorization: `Bearer ${TH_KEY}` },
      signal: AbortSignal.timeout(12000),
    });
    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, reason: "Token Harbor models non-JSON", items: [] };
    }
    if (!r.ok) return { ok: false, reason: `Token Harbor ${r.status}`, items: [] };
    const items = [];
    for (const m of data.data || []) {
      const id = m.id || m.name;
      if (!id) continue;
      if (!String(id).includes(":free") && !/free/i.test(String(m.name || ""))) continue;
      items.push({ id, label: prettyFreeLabel("tokenharbor", id) });
    }
    items.sort((a, b) => a.label.localeCompare(b.label));
    return { ok: true, items };
  } catch (e) {
    return { ok: false, reason: String(e.message || e).slice(0, 200), items: [] };
  }
}

function freebuffCredsOk() {
  try {
    const p = "/home/box/.config/manicode/credentials.json";
    if (!existsSync(p)) return false;
    const d = JSON.parse(readFileSync(p, "utf8"));
    const inner = d.default || d;
    return Boolean(inner.authToken || inner.token || inner.accessToken);
  } catch {
    return false;
  }
}

async function probeFreebuffFree() {
  // Freebuff CLI is terminal/TUI only — never offer Telegram taps.
  const signed = freebuffCredsOk() ? "signed in" : "not signed in";
  return {
    ok: false,
    reason: `terminal only (${signed}) — no Telegram chat path yet`,
    items: [],
  };
}

async function probeCommandCodeFree() {
  // Keep /freemodel fast: this account is signed in but out of credits,
  // and free-tagged Command Code models are still blocked without credits.
  return {
    ok: false,
    reason: "Command Code signed in but out of credits (free-tagged models still blocked)",
    items: [],
  };
}

async function listAvailableFreeModels(filterProvider) {
  const want = filterProvider ? PROVIDER_ALIASES[filterProvider] || filterProvider : null;
  if (want && !PROVIDERS[want]) {
    return { error: `Unknown provider. Try: ${Object.keys(PROVIDERS).join(", ")}` };
  }
  const probes = [];
  const order = ["opencode", "cline", "tokenharbor", "freebuff", "commandcode"];
  for (const key of order) {
    if (want && key !== want) continue;
    probes.push(
      (async () => {
        if (key === "opencode") return [key, await probeOpenCodeFree()];
        if (key === "cline") return [key, await probeClineFree()];
        if (key === "tokenharbor") return [key, await probeTokenHarborFree()];
        if (key === "freebuff") return [key, await probeFreebuffFree()];
        if (key === "commandcode") return [key, await probeCommandCodeFree()];
        return [key, { ok: false, reason: "no probe", items: [] }];
      })()
    );
  }
  const results = await Promise.all(probes);
  return { results };
}

/** Short callback tokens for /freemodel buttons (Telegram callback_data ≤ 64 bytes). */
const freemodelPicks = new Map();
let freemodelPickSeq = 0;

function freemodelCallbackData(providerKey, modelId) {
  freemodelPickSeq = (freemodelPickSeq + 1) % 1_000_000;
  const token = `fm${freemodelPickSeq.toString(36)}`;
  freemodelPicks.set(token, { provider: providerKey, modelId });
  // Bound memory: drop oldest-ish by clearing when huge
  if (freemodelPicks.size > 500) {
    const entries = [...freemodelPicks.entries()].slice(-200);
    freemodelPicks.clear();
    for (const [k, v] of entries) freemodelPicks.set(k, v);
  }
  return token;
}

function applyFreeModelPick(providerKey, modelId) {
  if (!PROVIDERS[providerKey]) throw new Error(`Unknown provider: ${providerKey}`);
  if (providerKey === "freebuff") {
    throw new Error(
      "Freebuff is terminal-only (no Telegram chat). Pick OpenCode Muse, Token Harbor, or Cline."
    );
  }
  // Token Harbor free taps → OpenCode + tokenharbor/<id> so tools/files work.
  // Chat-only Token Harbor remains available via /switch tokenharbor.
  let destProvider = providerKey;
  let destModel = modelId;
  let viaNote = "";
  if (providerKey === "tokenharbor") {
    const mid = String(modelId).startsWith("tokenharbor/")
      ? String(modelId).slice("tokenharbor/".length)
      : String(modelId);
    destProvider = "opencode";
    destModel = `tokenharbor/${mid}`;
    state.models.tokenharbor = mid;
    viaNote = "\n(via OpenCode — tools enabled. /switch tokenharbor for chat-only.)";
  }
  applyRoute(destProvider, destModel);
  const nice = prettyFreeLabel(providerKey, modelId);
  return (
    `Selected ${PROVIDERS[providerKey].label}: ${nice}\n\`${destModel}\`` +
    viaNote +
    `\n\nPlain messages now go here.`
  );
}

async function freemodelReply(filterProvider) {
  const packed = await listAvailableFreeModels(filterProvider);
  if (packed.error) return { text: packed.error, keyboard: null };
  const lines = ["Available free models (live check):", "Tap a model to select, or Cancel to keep your current one.", "Token Harbor / Cloudflare taps use OpenCode (tools). Quota auto-fails over to the next free lane.", "Freebuff is terminal-only — not listed as a Telegram tap.", ""];
  const skipped = [];
  let total = 0;
  const kb = new InlineKeyboard();
  for (const [key, res] of packed.results) {
    const label = PROVIDERS[key]?.label || key;
    if (!res.ok || !res.items.length) {
      skipped.push(`• ${label}: ${res.reason || "none available"}`);
      continue;
    }
    lines.push(`${label}`);
    for (const item of res.items) {
      total += 1;
      lines.push(formatFreeLine(key, item.id, item.label));
      const btn = `${key}: ${item.label}`.slice(0, 64);
      kb.text(btn, freemodelCallbackData(key, item.id)).row();
    }
    lines.push("");
  }
  if (!total) {
    lines.push("No free models available right now.");
  } else {
    lines.push(`Total: ${total}`);
    lines.push("Or: /switch <provider> then /model <id>");
  }
  if (skipped.length) {
    lines.push("");
    lines.push("Not available:");
    lines.push(...skipped);
  }
  if (total) {
    kb.text("Cancel — keep current model", "fm_cancel").row();
  }
  return { text: lines.join("\n"), keyboard: total ? kb : null };
}




const CF_NEURON_DAY = 10000;
const CF_NEURON_LEDGER = join(ROOT, "state", "cf-neurons.json");
/** Rough Workers AI neuron rates (per 1M tokens) for local Telegram estimates. */
const CF_NEURON_RATES = {
  "@cf/qwen/qwen3.8-27b": { inPerM: 40909, outPerM: 290909 },
  "@cf/zai-org/glm-4.7-flash": { inPerM: 5500, outPerM: 36400 },
};

function utcDayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function loadCfNeuronLedger() {
  try {
    if (!existsSync(CF_NEURON_LEDGER)) return { day: utcDayKey(), used: 0, calls: 0 };
    const j = JSON.parse(readFileSync(CF_NEURON_LEDGER, "utf8"));
    if (j.day !== utcDayKey()) return { day: utcDayKey(), used: 0, calls: 0 };
    return { day: j.day, used: Number(j.used) || 0, calls: Number(j.calls) || 0 };
  } catch {
    return { day: utcDayKey(), used: 0, calls: 0 };
  }
}

function saveCfNeuronLedger(led) {
  mkdirSync(dirname(CF_NEURON_LEDGER), { recursive: true });
  writeFileSync(CF_NEURON_LEDGER, JSON.stringify(led, null, 2));
}

function estimateCfNeurons(modelId, inputTokens, outputTokens) {
  const id = String(modelId || "").replace(/^cloudflare\//, "");
  const rates = CF_NEURON_RATES[id] || CF_NEURON_RATES["@cf/qwen/qwen3.8-27b"];
  const inn = ((Number(inputTokens) || 0) / 1e6) * rates.inPerM;
  const out = ((Number(outputTokens) || 0) / 1e6) * rates.outPerM;
  return inn + out;
}

function recordCfNeuronEstimate(modelId, inputTokens, outputTokens) {
  if (!String(modelId || "").includes("cloudflare/") && !String(modelId || "").includes("@cf/")) return null;
  const add = estimateCfNeurons(modelId, inputTokens, outputTokens);
  if (!Number.isFinite(add) || add <= 0) return null;
  const led = loadCfNeuronLedger();
  led.used = Math.round((led.used + add) * 1000) / 1000;
  led.calls = (led.calls || 0) + 1;
  led.day = utcDayKey();
  led.updatedAt = new Date().toISOString();
  saveCfNeuronLedger(led);
  return led;
}

async function fetchCfNeuronsToday() {
  const tok = process.env.CLOUDFLARE_WORKERS_AI_API_TOKEN || "";
  const acct = process.env.CLOUDFLARE_ACCOUNT_ID || "";
  if (!tok || !acct) return { ok: false, reason: "no CF Workers AI token on router" };
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const query =
    "query($a:String!,$s:Time){viewer{accounts(filter:{accountTag:$a}){aiInferenceAdaptiveGroups(limit:1,filter:{datetimeHour_geq:$s}){sum{totalNeurons}count}}}}";
  try {
    const r = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { a: acct, s: start.toISOString() } }),
      signal: AbortSignal.timeout(12000),
    });
    const d = await r.json();
    if (d.errors?.length) {
      const msg = d.errors[0].message || "graphql error";
      const needsAnalytics = /not authorized|authz|permission/i.test(msg);
      return {
        ok: false,
        reason: needsAnalytics
          ? "token needs Account Analytics Read for live total"
          : msg.slice(0, 120),
      };
    }
    const g = d?.data?.viewer?.accounts?.[0]?.aiInferenceAdaptiveGroups?.[0];
    const used = Number(g?.sum?.totalNeurons) || 0;
    return { ok: true, used, count: g?.count || 0 };
  } catch (e) {
    return { ok: false, reason: String(e.message || e).slice(0, 120) };
  }
}


async function allowanceText() {
  const lines = ["Allowance (best-effort)", ""];
  // Buckets first: structure (shared vs per-model) is real even when the API
  // does not expose remaining counts, so estimates/failover stay honest.
  lines.push(...allowanceBucketSection());
  lines.push("");
  // Active route + failover family
  lines.push(`Active route: ${PROVIDERS[state.provider]?.label || state.provider} · \`${state.models[state.provider] || "?"}\``);
  const family = freeFamilyKey(state.models[state.provider]);
  const chain = FREE_FAMILIES[family] || [];
  if (chain.length) {
    lines.push(`Failover family: ${family}`);
    lines.push(chain.map((r) => `· ${r.provider}: \`${r.model}\``).join("\n"));
  } else {
    lines.push(`Failover family: (none mapped for ${family})`);
  }
  lines.push("");

  // OpenCode health + whether TH provider loaded
  try {
    const health = await fetch(`${OC_URL}/global/health`, { signal: AbortSignal.timeout(4000) });
    const h = health.ok ? await health.json() : null;
    lines.push(`OpenCode: ${health.ok ? `up (${h?.version || "?"})` : `HTTP ${health.status}`}`);
    const pr = await fetch(`${OC_URL}/provider`, { signal: AbortSignal.timeout(8000) });
    if (pr.ok) {
      const data = await pr.json();
      const providers = data.all || data.providers || [];
      const th = providers.find((p) => p.id === "tokenharbor");
      const n = th?.models ? Object.keys(th.models).length : 0;
      lines.push(`OpenCode←TokenHarbor models: ${n}`);
      const cf = providers.find((p) => p.id === "cloudflare");
      const ncf = cf?.models ? Object.keys(cf.models).length : 0;
      lines.push(`OpenCode←Cloudflare models: ${ncf}`);
    }
  } catch (e) {
    lines.push(`OpenCode: unreachable (${String(e.message || e).slice(0, 80)})`);
  }

  // Token Harbor — no public remaining-quota API
  if (TH_KEY) {
    try {
      const r = await fetch(`${TH_URL}/models`, {
        headers: { Authorization: `Bearer ${TH_KEY}` },
        signal: AbortSignal.timeout(12000),
      });
      lines.push(
        r.ok
          ? "Token Harbor: key OK · remaining free allowance = dashboard only (rolling ~7-day value bar)"
          : `Token Harbor: HTTP ${r.status}`
      );
    } catch (e) {
      lines.push(`Token Harbor: ${String(e.message || e).slice(0, 100)}`);
    }
  } else {
    lines.push("Token Harbor: no API key on this box");
  }
  // E) Light quota memory: depleted routes with depletedUntil lines.
  const ql = quotaLines();
  lines.push("");
  lines.push("Depleted routes (skipped until depletedUntil):");
  lines.push(ql.length ? ql.map((l) => `· ${l}`).join("\n") : "· (none)");

  // Cline
  lines.push(
    clineAuthOk()
      ? "Cline: signed in · free caps are per-model/day in Cline UI (no local remaining counter)"
      : "Cline: not signed in"
  );

  // Freebuff
  lines.push(
    freebuffCredsOk()
      ? "Freebuff: signed in · Freebucks = Freebuff UI (25/day Indo tier; no local remaining counter)"
      : "Freebuff: not signed in"
  );

  // Command Code
  lines.push("Command Code: credit balance in Command Code billing UI (free-tagged still needs credits here)");

  // Cloudflare Workers AI — 10k neurons/day free (UTC reset)
  lines.push("");
  lines.push("Cloudflare Workers AI (10k neurons/day, resets 00:00 UTC):");
  try {
    const live = await fetchCfNeuronsToday();
    const led = loadCfNeuronLedger();
    if (live.ok) {
      const left = Math.max(0, CF_NEURON_DAY - live.used);
      const pct = Math.min(100, (live.used / CF_NEURON_DAY) * 100);
      lines.push(
        `· Account today: ${live.used.toFixed(0)} / ${CF_NEURON_DAY} neurons (${pct.toFixed(0)}%) · ~${left.toFixed(0)} left`
      );
    } else {
      lines.push(`· Live account total: unavailable (${live.reason})`);
    }
    lines.push(
      `· Telegram/OpenCode estimate today: ${led.used.toFixed(0)} neurons across ${led.calls || 0} CF calls`
    );
    if (led.exhausted) {
      lines.push(
        "· Status: DAILY FREE CAP HIT — CF models unusable until 00:00 UTC. Switch to Muse / Token Harbor / Cline."
      );
    } else if (/qwen3\.8-27b/.test(String(state.models?.[state.provider] || state.models?.opencode || ""))) {
      lines.push(
        "· Note: CF Qwen 3.8 27B ~4–5k neurons per heavy agent turn (a fat session can empty 10k in 2 turns)."
      );
    }
    lines.push(
      "· Exact burn is `usage.neurons` per reply; GraphQL needs Account Analytics Read on the API token for the full account bar."
    );
  } catch (e) {
    lines.push(`· CF allowance: ${String(e.message || e).slice(0, 100)}`);
  }

  lines.push("");
  lines.push("Tip: quota errors auto-try the next lane in the family above.");
  lines.push("Dashboards: tokenharbor.ai · app.cline.bot · freebuff.ai · commandcode.ai · dash.cloudflare.com → AI → Workers AI");
  return lines.join("\n");
}

const bot = new Bot(TOKEN);

bot.command("start", async (ctx) => {
  if (!gate(ctx)) return;
  await ctx.reply(
    "Unified coding router ready.\n\n" +
      "/switch — pick provider\n" +
      "/model — list/set free model for active provider\n" +
      "/freemodel — tap to select a free model\n" +
      "/status — live provider status (usage, thinking, …)\n" +
      "/think [level] — show/set thinking effort (cline)\n" +
      "/allowance — remaining free-lane allowance (best-effort)\n" +
      "/compact — compact OpenCode session context\n" +
      "/new — new OpenCode session\n" +
      "/help — this\n\n" +
      await statusText()
  );
});

bot.command("help", async (ctx) => {
  if (!gate(ctx)) return;
  await ctx.reply(
    "Commands:\n" +
      "/switch [opencode|cline|tokenharbor|freebuff|commandcode]\n" +
      "/model [id] — list or set free model for active provider\n" +
      "/freemodel [provider] — tap to select a free model\n" +
      "/status — live usage/thinking (opencode) + Thinking level (cline)\n" +
      "/think [none|low|medium|high|xhigh] — show/set Cline thinking\n" +
      "/allowance — free-lane allowance snapshot\n" +
      "/compact — compact OpenCode context\n" +
      "/new — fresh OpenCode session\n" +
      "/unlock — cancel stuck work and unlock the bot\n" +
      "/help\n\n" +
      "Plain messages go to the active provider."
  );
});

bot.command("status", async (ctx) => {
  if (!gate(ctx)) return;
  const thinking = await ctx.reply("Checking status…");
  try {
    const body = await statusText();
    await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, body).catch(async () => {
      await ctx.reply(body);
    });
  } catch (e) {
    await ctx.reply(`status failed: ${String(e.message || e).slice(0, 400)}`);
  }
});

bot.command("allowance", async (ctx) => {
  if (!gate(ctx)) return;
  const thinking = await ctx.reply("Checking allowance…");
  try {
    const body = await allowanceText();
    await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, body).catch(async () => {
      await ctx.reply(body);
    });
  } catch (e) {
    await ctx.reply(`allowance failed: ${String(e.message || e).slice(0, 400)}`);
  }
});

bot.command("compact", async (ctx) => {
  if (!gate(ctx)) return;
  if (state.provider !== "opencode") {
    await ctx.reply("/compact currently works on OpenCode. /switch opencode first.");
    return;
  }
  if (state.busy) {
    await ctx.reply("Busy — wait for the current task to finish before /compact.");
    return;
  }
  const thinking = await ctx.reply("Compacting OpenCode session…");
  try {
    state.busy = true;
    state.busySince = new Date().toISOString();
    saveState(state);
    const { sid, live } = await compactOpenCodeSession();
    state.busy = false;
    state.busySince = null;
    saveState(state);
    const lines = [`Compacted OpenCode session \`${sid}\`.`];
    if (live && !live.error) {
      if (live.pct != null) {
        lines.push(
          `Context now: ${formatTokenCount(live.used)} / ${formatTokenCount(live.ctxLimit)} (${live.pct.toFixed(1)}%)`
        );
      }
      lines.push(`Thinking: ${live.thinking}`);
      lines.push(`Agent: ${live.agent}`);
    }
    const body = lines.join("\n");
    await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, body).catch(async () => {
      await ctx.reply(body);
    });
  } catch (e) {
    state.busy = false;
    state.busySince = null;
    state.lastError = e.message;
    saveState(state);
    await ctx.api
      .editMessageText(ctx.chat.id, thinking.message_id, `compact failed: ${String(e.message || e).slice(0, 400)}`)
      .catch(async () => ctx.reply(`compact failed: ${String(e.message || e).slice(0, 400)}`));
  }
});

bot.command("switch", async (ctx) => {
  if (!gate(ctx)) return;
  let arg = (ctx.message?.text || "").split(/\s+/)[1]?.toLowerCase();
  if (arg && PROVIDER_ALIASES[arg]) arg = PROVIDER_ALIASES[arg];
  if (!arg) {
    await ctx.reply(
      "Providers:\n" +
        Object.entries(PROVIDERS)
          .map(([k, v]) => {
            const active = state.provider === k ? " ← active" : "";
            const note = k === "freebuff" ? " (terminal only — not for Telegram)" : "";
            return `• \`${k}\` — ${v.label}${note}${active}`;
          })
          .join("\n") +
        "\n\nUsage: /switch opencode"
    );
    return;
  }
  if (!PROVIDERS[arg]) {
    await ctx.reply(`Unknown provider. Try: ${Object.keys(PROVIDERS).join(", ")}`);
    return;
  }
  if (arg === "freebuff") {
    await ctx.reply(
      "Freebuff is terminal-only (interactive CLI) — Telegram can’t run it yet.\n" +
        "Use /freemodel for OpenCode Muse, Token Harbor, or Cline.\n" +
        "Keep Freebuff for desktop/terminal coding sessions."
    );
    return;
  }
  state.provider = arg;
  saveState(state);
  await ctx.reply(`Switched to ${PROVIDERS[arg].label}.\nModel: \`${state.models[arg]}\``);
});

bot.command("think", async (ctx) => {
  if (!gate(ctx)) return;
  const raw = String(ctx.message?.text || "").trim().split(/\s+/).slice(1).join(" ").trim();
  const level = raw.toLowerCase();
  const p = state.provider;
  if (!raw) {
    await ctx.reply(
      "Thinking effort:\n" +
        `Cline: \`${clineThinkingDisplay()}\` (levels: none|low|medium|high|xhigh)\n` +
        "OpenCode thinking is model-driven (see /status when on opencode)."
    );
    return;
  }
  if (!CLINE_THINK_LEVELS.includes(level)) {
    await ctx.reply("Unknown thinking level. Use: none|low|medium|high|xhigh\nUsage: /think high");
    return;
  }
  if (p !== "cline") {
    await ctx.reply(
      "Active provider is not Cline, so thinking stays with Cline for now.\n" +
        "`/switch cline` first, then /think " + level + " to apply it."
    );
    return;
  }
  if (!state.thinking || typeof state.thinking !== "object") state.thinking = { cline: "" };
  state.thinking.cline = level;
  saveState(state);
  await ctx.reply(`Cline thinking set to \`${level}\`. Applies as \`--thinking ${level}\` on the next run.`);
});

bot.command("model", async (ctx) => {
  if (!gate(ctx)) return;
  const parts = (ctx.message?.text || "").trim().split(/\s+/);
  const arg = parts.slice(1).join(" ").trim();
  const p = state.provider;
  const list = PROVIDERS[p].freeModels;
  if (!arg) {
    await ctx.reply(
      `Free models for ${PROVIDERS[p].label}:\n` +
        list.map((m) => `• \`${m}\`${state.models[p] === m ? " ← selected" : ""}`).join("\n") +
        `\n\nUsage: /model ${list[0]}`
    );
    return;
  }
  // Allow any id; warn if not in free list
  state.models[p] = arg;
  saveState(state);
  const note = list.includes(arg) ? "" : "\n(Not in the default free list — OK if you know the id.)";
  await ctx.reply(`Model set to \`${arg}\` on ${PROVIDERS[p].label}.${note}`);
});


bot.command("freemodel", async (ctx) => {
  if (!gate(ctx)) return;
  const arg = (ctx.message?.text || "").split(/\s+/)[1]?.toLowerCase();
  const thinking = await ctx.reply("Checking free models…");
  try {
    const { text, keyboard } = await freemodelReply(arg);
    let body = text;
    if (body.length > 3900) body = body.slice(0, 3900) + "\n…truncated";
    const opts = keyboard ? { reply_markup: keyboard } : {};
    await ctx.api
      .editMessageText(ctx.chat.id, thinking.message_id, body, opts)
      .catch(async () => {
        await ctx.reply(body, opts);
      });
  } catch (e) {
    await ctx.reply(`freemodel failed: ${String(e.message || e).slice(0, 500)}`);
  }
});

bot.callbackQuery(/^fm/, async (ctx) => {
  if (!gate(ctx)) {
    await ctx.answerCallbackQuery({ text: "Not allowed", show_alert: true }).catch(() => {});
    return;
  }
  const token = ctx.callbackQuery.data || "";
  if (token === "fm_cancel") {
    await ctx.answerCallbackQuery({ text: "No change" }).catch(() => {});
    try {
      await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
    } catch {}
    await ctx.reply("Cancelled — model unchanged.\n" + (await statusText()));
    return;
  }
  const pick = freemodelPicks.get(token);
  if (!pick) {
    await ctx.answerCallbackQuery({
      text: "That button expired — run /freemodel again",
      show_alert: true,
    }).catch(() => {});
    return;
  }
  try {
    const msg = applyFreeModelPick(pick.provider, pick.modelId);
    await ctx.answerCallbackQuery({ text: "Selected" }).catch(() => {});
    await ctx.reply(msg);
  } catch (e) {
    await ctx.answerCallbackQuery({
      text: String(e.message || e).slice(0, 180),
      show_alert: true,
    }).catch(() => {});
  }
});


bot.command("unlock", async (ctx) => {
  if (!gate(ctx)) return;
  const was = await clearBusyLock("user /unlock", { abort: true, notify: false });
  dispatchActive = false;
  await ctx.reply(
    was
      ? "Unlocked. OpenCode turn aborted if it was still running. Send your next message, or /new for a fresh session."
      : "Already idle — nothing to unlock."
  );
});

bot.callbackQuery(/^busy_/, async (ctx) => {
  if (!gate(ctx)) {
    await ctx.answerCallbackQuery({ text: "Not allowed", show_alert: true }).catch(() => {});
    return;
  }
  const data = ctx.callbackQuery.data || "";
  if (data === "busy_unlock") {
    await clearBusyLock("user Cancel button", { abort: true, notify: false });
    dispatchActive = false;
    await ctx.answerCallbackQuery({ text: "Unlocked" }).catch(() => {});
    try {
      await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
    } catch {}
    await ctx.reply("Cancelled & unlocked. Send your next message, or /new for a fresh session.");
    return;
  }
  if (data === "busy_status") {
    await ctx.answerCallbackQuery({ text: "Status" }).catch(() => {});
    await ctx.reply(await statusText()).catch(() => {});
    return;
  }
  if (data === "busy_new") {
    await clearBusyLock("user New from busy", { abort: true, notify: false });
    dispatchActive = false;
    await ctx.answerCallbackQuery({ text: "Resetting…" }).catch(() => {});
    // Reuse /new logic by invoking the same path
    if (state.provider !== "opencode") {
      await ctx.reply("Unlocked. Switch to opencode first for /new, or just send a new prompt.");
      return;
    }
    const old = state.sessions.opencode;
    if (old) await ocAbort(old);
    state.lastUserText = null;
    state.lastReplyPreview = null;
    state.lastError = null;
    try {
      const created = await oc(`/session${OC_DIR_QS}`, {
        method: "POST",
        body: "{}",
        timeoutMs: 30000,
      });
      state.sessions.opencode = created.id;
      saveState(state);
      await ctx.reply(`New OpenCode session: \`${created.id}\`\nWorkspace: \`${WORKSPACE}\``);
    } catch (e) {
      state.lastError = e.message;
      saveState(state);
      await ctx.reply(`Unlocked, but new session failed: ${e.message}`);
    }
  }
});

bot.command("new", async (ctx) => {
  if (!gate(ctx)) return;
  if (state.provider !== "opencode") {
    await ctx.reply("/new currently resets the OpenCode session. Switch to opencode first, or just send a new prompt on Cline/Token Harbor.");
    return;
  }
  // Reset busy + last-task tracking, then create a fresh WORKSPACE-pinned session.
  const old = state.sessions.opencode;
  if (old) await ocAbort(old);
  state.busy = false;
  state.busySince = null;
  state.lastUserText = null;
  state.lastReplyPreview = null;
  state.lastError = null;
  try {
    const created = await oc(`/session${OC_DIR_QS}`, {
      method: "POST",
      body: "{}",
      timeoutMs: 30000,
    });
    state.sessions.opencode = created.id;
    saveState(state);
    await ctx.reply(`New OpenCode session: \`${created.id}\`\nWorkspace: \`${WORKSPACE}\``);
  } catch (e) {
    state.lastError = e.message;
    saveState(state);
    await ctx.reply(`Failed to create session: ${e.message}`);
  }
});

bot.on("message:text", async (ctx) => {
  if (!gate(ctx)) return;
  const text = ctx.message.text;
  if (text.startsWith("/")) return; // other commands
  // D) Record every received text immediately; lastUserText only advances when
  // dispatch actually starts, so 409 storms can't leave a stale "Last task".
  state.lastReceivedText = text.slice(0, 1000);
  saveState(state);
  // 1) Status pings answered locally — never call OpenCode while busy or idle.
  if (isStatusPing(text)) {
    await ctx.reply(statusPingReply()).catch(() => {});
    return;
  }
  // 2) Single-flight: refuse parallel work while busy.
  if (state.busy) {
    // Self-heal: lock with no in-process dispatch is an orphan (restart / crashed waiter).
    if (!dispatchActive) {
      await clearBusyLock("orphan lock on message", { abort: true, notify: false });
    } else {
      const elapsed = busyElapsed();
      await ctx.reply(
        `Busy — still working on your last task, not starting a parallel one.\n` +
          `Task: ${(state.lastUserText || "(unknown)").slice(0, 300)}\n` +
          `Started: ${state.busySince || "?"}${elapsed != null ? ` (${elapsed}s ago)` : ""}\n` +
          `Tap Cancel & unlock if it looks stuck. Long OpenCode runs stay open until idle (progress every ~${Math.round(OC_PROGRESS_MS / 1000)}s).`,
        { reply_markup: busyKeyboard() }
      ).catch(() => {});
      return;
    }
  }
  state.busy = true;
  state.busySince = new Date().toISOString();
  state.lastUserText = text.slice(0, 1000);
  state.lastChatId = ctx.chat.id;
  state.lastError = null;
  dispatchActive = true;
  saveState(state);
  const stopTyping = startTypingPulse(ctx.api, ctx.chat.id);
  const opener =
    state.provider === "opencode" && state.sessions?.opencode
      ? await headlineFromLive(state.sessions.opencode, { elapsedSec: 0, detail: "working" }).catch(() =>
          headlineFromState(0, "working")
        )
      : headlineFromState(0, "working");
  const thinking = await ctx.reply(opener);
  const workStarted = Date.now();
  // Non-OpenCode providers don't emit tool progress — keep the card clock + typing alive.
  const genericPulse =
    state.provider === "opencode"
      ? null
      : setInterval(() => {
          const sec = Math.round((Date.now() - workStarted) / 1000);
          const card = headlineFromState(sec, "working");
          ctx.api.sendChatAction(ctx.chat.id, "typing").catch(() => {});
          ctx.api.editMessageText(ctx.chat.id, thinking.message_id, card.slice(0, 3500)).catch(() => {});
        }, 5000);
  try {
    const reply = await dispatch(text, {

      onProgress: async (msg) => {
        await ctx.api.sendChatAction(ctx.chat.id, "typing").catch(() => {});
        await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, String(msg).slice(0, 3500)).catch(() => {});
      },
      onTyping: async () => {
        await ctx.api.sendChatAction(ctx.chat.id, "typing").catch(() => {});
      },
    });
    state.busy = false;
    state.busySince = null;
    state.lastReplyPreview = String(reply || "(empty)").slice(0, 500);
    saveState(state);
    await deliverReply(ctx, thinking, reply || "(empty)");
  } catch (e) {
    state.busy = false;
    state.busySince = null;
    state.lastError = e.message;
    saveState(state);
    const report = `Stopped: ${e.message}`;
    await deliverReply(ctx, thinking, report);
  } finally {
    dispatchActive = false;
    if (genericPulse) clearInterval(genericPulse);
    stopTyping();
  }
});


function extractMedia(text) {
  const lines = String(text ?? "").split("\n");
  const media = [];
  const kept = [];
  for (const line of lines) {
    const match = line.match(/^\s*MEDIA:(.+?)\s*$/);
    if (match) {
      const file = match[1].trim();
      if (file) media.push(file);
      continue;
    }
    kept.push(line);
  }
  const cleaned = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { text: cleaned, media };
}

async function deliverReply(ctx, thinking, reply) {
  const { text, media } = extractMedia(reply || "");
  const body = text || (media.length ? "(see attached)" : "(empty)");
  const chunks = chunkTelegram(body);
  await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, chunks[0]).catch(async () => {
    await ctx.reply(chunks[0]);
  });
  for (let i = 1; i < chunks.length; i++) {
    await ctx.reply(chunks[i]);
  }
  for (const filePath of media) {
    if (!existsSync(filePath)) {
      await ctx.reply(`(missing media: ${filePath})`).catch(() => {});
      continue;
    }
    const lower = filePath.toLowerCase();
    const file = new InputFile(filePath);
    try {
      if (/\.(png|jpe?g|gif|webp)$/.test(lower)) {
        await ctx.api.sendPhoto(ctx.chat.id, file);
      } else {
        await ctx.api.sendDocument(ctx.chat.id, file);
      }
    } catch (e) {
      await ctx.reply(`(failed to send ${filePath}: ${String(e.message || e).slice(0, 200)})`).catch(() => {});
    }
  }
}

function chunkTelegram(s, max = 3900) {
  if (s.length <= max) return [s];
  const out = [];
  let i = 0;
  while (i < s.length) {
    out.push(s.slice(i, i + max));
    i += max;
  }
  return out.slice(0, 8);
}

bot.catch((err) => {
  const e = err.error;
  if (e instanceof GrammyError) console.error("Grammy:", e.description);
  else if (e instanceof HttpError) console.error("HTTP:", e);
  else console.error(e);
});

const BOT_COMMANDS = [
  { command: "start", description: "Router ready + current status" },
  { command: "help", description: "List all commands" },
  { command: "status", description: "Live status: usage %, thinking, model" },
  { command: "think", description: "Show/set thinking effort (cline: none|low|medium|high|xhigh)" },
  { command: "allowance", description: "Free-lane allowance snapshot (best-effort)" },
  { command: "compact", description: "Compact OpenCode session context" },
  { command: "switch", description: "Switch provider (opencode, cline, …)" },
  { command: "model", description: "List or set model for active provider" },
  { command: "freemodel", description: "Tap to pick an available free model" },
  { command: "unlock", description: "Cancel stuck work and unlock the bot" },
  { command: "new", description: "New OpenCode session" },
];

async function registerBotCommands() {
  await bot.api.setMyCommands(BOT_COMMANDS);
  await bot.api.setMyCommands(BOT_COMMANDS, { scope: { type: "all_private_chats" } });
  console.log("bot commands registered:", BOT_COMMANDS.map((c) => c.command).join(", "));
}


async function busyWatchdogTick() {
  if (!state.busy) {
    busyIdleStreak = 0;
    // B) Even when not busy, reap a leaked cline child (Telegram timeout orphan).
    try {
      if (Number(state.clinePid) > 0 || Number(activeClinePid) > 0) reapClineChild("watchdog idle reap");
    } catch {}
    return;
  }
  // Orphan: disk/memory says busy but this process is not awaiting dispatch.
  if (!dispatchActive) {
    const elapsedMs = state.busySince ? Date.now() - Date.parse(state.busySince) : 0;
    if (elapsedMs >= BUSY_ORPHAN_GRACE_MS) {
      await clearBusyLock("watchdog orphan (no active dispatch)", { abort: true, notify: true });
    }
    return;
  }
  // Live dispatch: if OpenCode already idle for several checks, waiter is wedged — unlock.
  const sid = state.sessions?.opencode;
  if (!sid || state.provider !== "opencode") {
    busyIdleStreak = 0;
    return;
  }
  try {
    const st = await ocSessionStatus(sid);
    const t = st?.type || "unknown";
    if (t === "idle" || t === "unknown") {
      busyIdleStreak += 1;
    } else {
      busyIdleStreak = 0;
    }
    if (busyIdleStreak >= BUSY_STALE_IDLE_CHECKS) {
      await clearBusyLock("watchdog: OpenCode idle but Telegram still busy", {
        abort: false,
        notify: true,
      });
      dispatchActive = false;
    }
  } catch (e) {
    console.log("busyWatchdog status failed:", e.message || e);
  }
}
setInterval(() => {
  busyWatchdogTick().catch((e) => console.log("busyWatchdog error:", e.message || e));
}, BUSY_WATCHDOG_MS);

console.log(`tg-provider-router starting; allowlist=${ALLOWED}; default=${state.provider}`);
// A) Single-poller lock: exit 0 if another router owns the token (stale pid cleaned).
acquireSinglePollerLock();
console.log(`single-poller lock ok: pidfile=${PID_PATH} lock=${LOCK_PATH}`);
// Crash/restart mid-wait leaves sticky busy with nobody awaiting the turn.
// Always clear the Telegram lock; abort leftover OpenCode work so the next message can start.
if (state.busy) {
  const sid = state.sessions?.opencode;
  console.log("startup: sticky busy=true; aborting leftover OpenCode turn and clearing lock…");
  Promise.resolve()
    .then(async () => {
      if (!sid) return;
      try {
        const st = await ocSessionStatus(sid);
        const t = st?.type || "unknown";
        if (t === "busy" || t === "retry") {
          console.log(`startup: OpenCode was ${t}; aborting session ${sid}`);
          await ocAbort(sid);
        }
      } catch (e) {
        console.log("startup: OpenCode status/abort failed:", e.message || e);
      }
    })
    .finally(() => {
      state.busy = false;
      state.busySince = null;
      saveState(state);
      console.log("startup: cleared sticky busy");
    });
}
// B) Reap any cline child persisted from a crashed run before polling.
try { reapClineChild("startup reap"); } catch {}
registerBotCommands().catch((e) => console.error("setMyCommands failed:", e.message || e));

async function startPollingWithRetry() {
  // A) Optional one-shot drain is OK, but never leave two long-pollers running.
  // On 409: exit after MAX_CONSECUTIVE_409 so a second poller never spins forever.
  for (;;) {
    try {
      await bot.start({
        onStart: (info) => {
          consecutive409 = 0;
          console.log(`@{${info.username}} polling`);
        },
      });
      // bot.start resolves only when stopped
      console.log("polling stopped; restarting in 5s");
      await new Promise((r) => setTimeout(r, 5000));
    } catch (e) {
      const msg = String(e?.description || e?.message || e);
      console.error("polling error:", msg);
      if (/409|Conflict/i.test(msg)) {
        consecutive409 += 1;
        if (consecutive409 >= MAX_CONSECUTIVE_409) {
          console.error(
            `409 conflict x${consecutive409}: another getUpdates poller holds this token; ` +
            `not spinning as a second poller — exiting. Restart doc: pkill -f 'node src/index.js' then start ONE under: flock -n run/router.lock node src/index.js`
          );
          try {
            await bot.stop();
          } catch {}
          process.exit(0);
        }
        console.error(`409 conflict: another getUpdates poller holds this token; retrying in ${Math.round(RETRY_409_MS / 1000)}s (${consecutive409}/${MAX_CONSECUTIVE_409})`);
        await new Promise((r) => setTimeout(r, RETRY_409_MS));
        continue;
      }
      consecutive409 = 0;
      await new Promise((r) => setTimeout(r, 10000));
    }
  }
}
startPollingWithRetry();
