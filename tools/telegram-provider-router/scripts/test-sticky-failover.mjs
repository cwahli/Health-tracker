#!/usr/bin/env node
/**
 * Smoke: a depleted sticky free lane must auto-fail over through the editable
 * preference table (same family first, then next ✅ by pref #) instead of
 * Stop-hanging — and when every lane is depleted it must say so clearly.
 *
 *   cd tools/telegram-provider-router && node scripts/test-sticky-failover.mjs
 *
 * Runs src/index.js in import mode (TG_ROUTER_NO_START=1) with
 * TG_ROUTER_STATE_DIR pointed at a throwaway dir, so the live session/quota/table
 * (and the single Telegram poller) are never touched. No network, no polling.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL_DIR = join(HERE, "..");
const SRC = join(TOOL_DIR, "src", "index.js");
const MOD = join(TOOL_DIR, "src", "free-lane-table.js");

const MIN = 60 * 1000;
const now = Date.now();
const STICKY_UNTIL = now + 45 * MIN; // OpenCode Zen shared bucket
const CF_UNTIL = now + 2 * 60 * MIN; // if the CF lanes are also emptied
const isoZ = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

const STICKY_MODEL = "opencode/mimo-v2.6-flash-free";

const lane = (pref, family, provider, model, label, bucket, extra = {}) => ({
  pref,
  family,
  provider,
  model,
  label,
  bucket,
  tg: true,
  status: "available",
  resetRule: "rolling / rate-limit",
  nextReset: "unknown until a limit response (then countdown)",
  nextResetAt: null,
  cooldownLeft: "-",
  cooldownUntil: null,
  lastPingAt: null,
  lastPingNote: "",
  ...extra,
});

const depleted = (until) => ({ status: "depleted", nextResetAt: isoZ(until), cooldownUntil: isoZ(until), nextReset: isoZ(until) });

/**
 * The 2026-09-24 repro: sticky = opencode/mimo-v2.6-flash-free, every
 * mimo/zen lane empty, next ✅ lanes are Cloudflare #10/#11. `emptyCf` flips
 * #10/#11 to depleted to exercise the all-depleted Stop message.
 */
function buildTable({ emptyCf = false } = {}) {
  return {
    version: 3,
    updatedAt: isoZ(now),
    failover: "same-family first (skip depleted), then next available by pref #",
    buckets: {
      "opencode-zen-free": { scope: "shared", resetRule: "rolling / rate-limit (shared)" },
      "cloudflare-neurons": { scope: "shared", resetRule: "10k neurons/day (UTC)" },
      "freebuff-freebucks": { scope: "shared", resetRule: "shared daily Freebucks" },
    },
    lanes: [
      lane(1, "muse-spark-1.3", "opencode", "opencode/muse-spark-1.3-contributor-free", "OpenCode Muse Spark 1.3 free", "opencode-zen-free", depleted(STICKY_UNTIL)),
      lane(2, "muse-spark-1.3", "cline", "cline-free/muse-spark-1.3-contributor", "Cline Muse Spark 1.3 contributor free", "cline-per-model", depleted(STICKY_UNTIL)),
      lane(3, "mimo-v2.6-flash", "opencode", STICKY_MODEL, "OpenCode MiMo V2.6 Flash free", "opencode-zen-free", depleted(STICKY_UNTIL)),
      lane(8, "mimo-v2.6-flash", "opencode", "opencode/tokenharbor/mimo-v2.6-flash:free", "OpenCode Token Harbor MiMo V2.6 free", "tokenharbor-free", depleted(STICKY_UNTIL)),
      lane(9, "mimo-v2.6-flash", "tokenharbor", "mimo-v2.6-flash:free", "Token Harbor chat MiMo V2.6 free", "tokenharbor-free", depleted(STICKY_UNTIL)),
      lane(10, "qwen3.8-27b", "opencode", "cloudflare/@cf/qwen/qwen3.8-27b", "Cloudflare Qwen 3.8 27B", "cloudflare-neurons", emptyCf ? depleted(CF_UNTIL) : {}),
      lane(11, "glm-4.7-flash", "opencode", "cloudflare/@cf/zai-org/glm-4.7-flash", "Cloudflare GLM 4.7 Flash", "cloudflare-neurons", emptyCf ? depleted(CF_UNTIL) : {}),
      lane(17, "deepseek-v4.1-flash", "freebuff", "deepseek/deepseek-v4.1-flash", "Freebuff DeepSeek V4.1 Flash", "freebuff-freebucks", { tg: false, notes: "terminal-only" }),
    ],
  };
}

const MUSE_MODEL = "opencode/muse-spark-1.3-contributor-free";
const CF_QWEN = "cloudflare/@cf/qwen/qwen3.8-27b";

const FIXTURE_SESSION = {
  provider: "opencode",
  models: { opencode: MUSE_MODEL, cline: "cline-free/muse-spark-1.3-contributor", tokenharbor: "mimo-v2.5:free", freebuff: "deepseek/deepseek-v4.1-flash" },
  quota: {
    "opencode/opencode/mimo-v2.6-flash-free": { depletedUntil: STICKY_UNTIL, countdownParsed: false, scope: "shared", lastError: "Rate limit exceeded" },
    "bucket:opencode-zen-free": { depletedUntil: STICKY_UNTIL, countdownParsed: false, scope: "shared", lastError: "Rate limit exceeded" },
    "opencode/opencode/tokenharbor/mimo-v2.6-flash:free": { depletedUntil: STICKY_UNTIL, countdownParsed: false, scope: "shared", lastError: "Rate limit exceeded" },
    "tokenharbor/mimo-v2.6-flash:free": { depletedUntil: STICKY_UNTIL, countdownParsed: false, scope: "shared", lastError: "Rate limit exceeded" },
  },
};

// ---- fixtures must exist before importing the router (loadState reads them) ----
const stateDir = mkdtempSync(join(tmpdir(), "ht-sticky-failover-"));
const TABLE_PATH = join(stateDir, "free-lane-table.json");
const SESSION_PATH = join(stateDir, "session.json");
writeFileSync(TABLE_PATH, JSON.stringify(buildTable(), null, 2));
writeFileSync(SESSION_PATH, JSON.stringify(FIXTURE_SESSION, null, 2));

// ---- import mode env (no poller, no live state) ----
process.env.TG_ROUTER_NO_START = "1";
process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "123:TEST";
process.env.TELEGRAM_USER_ID = process.env.TELEGRAM_USER_ID || "1";
process.env.TG_ROUTER_STATE_DIR = stateDir;
process.env.QUOTA_DEPLETED_TTL_MS = "";

let mod;
let flt;
try {
  mod = await import(pathToFileURL(SRC).href);
  flt = await import(pathToFileURL(MOD).href);
} catch (e) {
  console.error(`Cannot import a router module: ${e.message}`);
  console.error("If this is a missing dependency, run: npm install  (inside tools/telegram-provider-router)");
  process.exit(2);
}
const {
  buildDispatchRoutes,
  buildDispatchPlan,
  stickyRouteSkipped,
  formatAutoSwitchBanner,
  shouldSuppressAutoSwitchBanner,
  nextFailoverRoutes,
  allFreeLanesDepletedMessage,
  isQuotaOrLimitError,
  isGreetingOnly,
  freeModelDepletion,
  formatFreeLine,
  FREEMODEL_HEADER,
  applyFreeModelPick,
  dispatch,
} = mod;
const { nextAvailableRoutes, soonestResetAmongDepleted } = flt;

let failed = 0;
const check = (name, cond, extra = "") => {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
  }
};

console.log(`Sticky failover (state dir: ${stateDir})`);
const table = JSON.parse(readFileSync(TABLE_PATH, "utf8"));

// S1) preference-table walk: depleted sticky + CF available -> CF Qwen first, sticky never returned.
const routes = nextAvailableRoutes(table, FIXTURE_SESSION, { fromProvider: "opencode", fromModel: STICKY_MODEL });
check("S1 nextAvailableRoutes returns a ✅ lane after a depleted sticky", routes.length > 0);
check("S2 first failover lane is CF Qwen 3.8 27B", routes[0] && routes[0].model === "cloudflare/@cf/qwen/qwen3.8-27b", routes[0]?.model);
check("S3 sticky lane is never in the failover list", !routes.some((r) => r.model === STICKY_MODEL));
check("S4 non-TG Freebuff lane is excluded by default", !routes.some((r) => r.provider === "freebuff"));

// S5) router helper agrees and dispatch planning does not Stop-throw.
const nfr = nextFailoverRoutes("opencode", STICKY_MODEL);
check("S5 nextFailoverRoutes matches the table walk", nfr.length > 0 && nfr[0].model === routes[0].model, nfr[0]?.model);
let planned = null;
let planErr = null;
try {
  planned = buildDispatchRoutes({ provider: "opencode", model: STICKY_MODEL });
} catch (e) {
  planErr = e;
}
check("S6 buildDispatchRoutes does not throw Stop when another ✅ lane exists", !planErr, planErr?.message);
check("S7 planned route list starts on CF Qwen, not the depleted sticky", planned?.[0]?.model === "cloudflare/@cf/qwen/qwen3.8-27b" && !planned.some((r) => r.model === STICKY_MODEL), planned?.[0]?.model);
check("S8 sticky 'Sticky OpenCode lane depleted…' counts as a quota error (catch-path failover)", isQuotaOrLimitError("Sticky OpenCode lane depleted until 2099-01-01T00:00:00.000Z: Rate limit exceeded"));

// S9) greeting-only prompts still move the sticky (short welcome on the new lane is OK).
check("S9 greeting-only 'hi' is detected (switch + welcome path)", isGreetingOnly("hi") === true);
check("S10 a real task is not treated as a greeting", isGreetingOnly("fix the failing test") === false);

// ---- TG-FREEMODEL-DEPLETE-BANNER ----

// F1/F2) shared Zen bucket deplete is visible per-model: Muse marked, CF available.
const museDep = freeModelDepletion("opencode", MUSE_MODEL);
check("F1 Muse is marked depleted via the shared Zen bucket (+ a Reset in)", Boolean(museDep) && /\S/.test(museDep.resetIn || ""), JSON.stringify(museDep));
const cfDep = freeModelDepletion("opencode", CF_QWEN);
check("F2 CF Qwen stays unmarked (no live CF quota record)", cfDep === null, JSON.stringify(cfDep));

// F3/F4) the /freemodel line formatter shows ❌ + Reset in on depleted only.
const museLine = formatFreeLine("opencode", MUSE_MODEL, null, museDep);
const cfLine = formatFreeLine("opencode", CF_QWEN, null, cfDep);
check("F3 depleted line is prefixed ❌ and shows Reset in", museLine.startsWith("❌ ") && /Reset in /.test(museLine), museLine);
check("F4 available line has no ❌ mark", !cfLine.startsWith("❌ "), cfLine);

// F5) header tells the user depleted lanes are marked + failover is announced.
const header = FREEMODEL_HEADER.join("\n");
check("F5 header says depleted lanes are marked", /Depleted lanes are marked/i.test(header), header);
check("F6 header says auto-failover announces switches", /auto-failover announces switches/i.test(header), header);

// F7/F8) picking a depleted lane keeps sticky but warns immediately.
const pickMsg = applyFreeModelPick("opencode", MUSE_MODEL);
check("F7 applyFreeModelPick on depleted Muse still applies the sticky", /Selected OpenCode/i.test(pickMsg) && /muse-spark-1\.3-contributor-free/.test(pickMsg), pickMsg);
check("F8 pick reply warns currently depleted + Reset in + auto-switch", /currently depleted/i.test(pickMsg) && /Reset in /.test(pickMsg) && /auto-switch/i.test(pickMsg), pickMsg);

// F9/F10/F11) deplete sticky + CF available: the FIRST dispatch (i===0) must
// announce the switch and banner the reply, even for a greeting-only "hi".
const plan = (() => { try { return buildDispatchPlan({ provider: "opencode", model: MUSE_MODEL }); } catch { return null; } })();
check("F9 plan routes to CF Qwen with stickySkipped=true", plan?.stickySkipped === true && plan?.routes?.[0]?.model === CF_QWEN, JSON.stringify(plan?.routes?.[0]));
check("F10 stickyRouteSkipped is true when the sticky lane is filtered", stickyRouteSkipped({ provider: "opencode", model: MUSE_MODEL }, plan?.routes || []) === true);
check("F11 banner always names Was sticky / Now / Tried", (() => {
  const b = formatAutoSwitchBanner({ start: { provider: "opencode", model: MUSE_MODEL }, route: { provider: "opencode", model: CF_QWEN }, tried: [`opencode/${CF_QWEN}`], depleteDriven: true });
  return /Was sticky:/.test(b) && /Now:/.test(b) && /Tried:/.test(b);
})());
check("F12 greeting 'hi' is NOT allowed to suppress a deplete banner", shouldSuppressAutoSwitchBanner({ prompt: "hi", body: "Hi there! I'm Cline, how can I help?", depleteDriven: true }) === false);
check("F13 non-deplete failover may still suppress a greeting-only welcome", shouldSuppressAutoSwitchBanner({ prompt: "hi", body: "Hi there! I'm Cline, how can I help?", depleteDriven: false }) === true);

const progress = [];
let firstReply = "";
try {
  firstReply = await dispatch("hi", {
    onProgress: (m) => progress.push(String(m)),
    dispatchOnce: async () => "Hi there! I'm Cline, how can I help?",
  });
} catch (e) {
  firstReply = `THREW: ${e.message}`;
}
check("F14 first dispatch (hi) on a deplete-skipped sticky includes the auto-switch banner", /⚡ Auto-switched free lane/.test(firstReply), firstReply);
check("F15 banner includes Was sticky with the Muse lane", /Was sticky:.*muse-spark-1\.3-contributor-free/.test(firstReply), firstReply);
check("F16 banner includes Now route = CF Qwen", /Now:.*cloudflare\/@cf\/qwen\/qwen3\.8-27b/.test(firstReply), firstReply);
check("F17 banner includes Tried", /Tried:/.test(firstReply), firstReply);
check("F18 onProgress announced the deplete auto-switch to CF Qwen", progress.some((m) => /depleted/.test(m) && /switching to OpenCode: cloudflare\/@cf\/qwen\/qwen3\.8-27b/.test(m)), progress.join(" | "));

// S11) every lane depleted -> empty plan + clear message with the soonest Reset in (no hang).
writeFileSync(TABLE_PATH, JSON.stringify(buildTable({ emptyCf: true }), null, 2));
const emptyTable = JSON.parse(readFileSync(TABLE_PATH, "utf8"));
const none = nextAvailableRoutes(emptyTable, FIXTURE_SESSION, { fromProvider: "opencode", fromModel: STICKY_MODEL });
check("S11 no ✅ route remains when every TG lane is depleted", none.length === 0);
check("S12 soonestResetAmongDepleted finds a reset hint", Boolean(soonestResetAmongDepleted(emptyTable, FIXTURE_SESSION)?.label));
let stopMsg = "";
try {
  buildDispatchRoutes({ provider: "opencode", model: STICKY_MODEL });
} catch (e) {
  stopMsg = e.message;
}
const msg = stopMsg || allFreeLanesDepletedMessage("opencode", STICKY_MODEL);
check("S13 all-depleted plan throws the clear message (not the raw vendor text)", /All free Telegram lanes are depleted/i.test(msg), msg);
check("S14 all-depleted message lists the soonest Reset in", /Soonest Reset in:/i.test(msg), msg);

if (failed) {
  console.error(`\nFAIL: ${failed} check(s) failed`);
  process.exit(1);
}
console.log(`\nPASS sticky-failover: ${nfr.map((r) => r.model).join(" → ")} (then clear all-depleted Stop)`);
if (!existsSync(SRC)) process.exit(2);
