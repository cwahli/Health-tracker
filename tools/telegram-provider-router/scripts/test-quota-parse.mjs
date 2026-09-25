#!/usr/bin/env node
/**
 * Unit tests for the TG provider-router free-lane quota capture fix.
 * Ticket: "TG free-lane quota countdown auto-capture (fix + sync table)".
 *
 *   cd tools/telegram-provider-router && node scripts/test-quota-parse.mjs
 *
 * Runs src/index.js in import mode (TG_ROUTER_NO_START=1) with
 * TG_ROUTER_STATE_DIR pointed at a throwaway dir, so the live session/quota state
 * is never touched and no Telegram polling / lock is started.
 */
import { mkdtempSync, copyFileSync, existsSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL_DIR = join(HERE, "..");
const SRC = join(TOOL_DIR, "src", "index.js");
const LIVE_TABLE = "/home/box/.config/telegram-opencode/router/state/free-lane-table.json";
const HOUR = 3600 * 1000;

// ---- import mode env (must be set before importing the router) ----
const stateDir = mkdtempSync(join(tmpdir(), "ht-quota-capture-"));
process.env.TG_ROUTER_NO_START = "1";
process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "123:TEST";
process.env.TELEGRAM_USER_ID = process.env.TELEGRAM_USER_ID || "1";
process.env.TG_ROUTER_STATE_DIR = stateDir;
process.env.QUOTA_DEPLETED_TTL_MS = ""; // "" → default 6h TTL inside the router

const TABLE_PATH = join(stateDir, "free-lane-table.json");
const SESSION_PATH = join(stateDir, "session.json");

/** Seed the temp table: real live table when readable, else a small fixture.
 *  Never hardcode today's reset times — only lane identity + schema. */
function seedTable() {
  if (existsSync(LIVE_TABLE)) {
    copyFileSync(LIVE_TABLE, TABLE_PATH);
    return { seededFrom: LIVE_TABLE, lanes: JSON.parse(readFileSync(TABLE_PATH, "utf8")).lanes.length };
  }
  const lane = (pref, provider, model, bucket) => ({
    pref, provider, model, bucket, label: model, family: model.replace(/^[^/]+\//, ""),
    status: "available", nextReset: "unknown until a limit response (then countdown)",
    nextResetAt: null, cooldownLeft: "-", cooldownUntil: null, lastPingAt: null, lastPingNote: "",
  });
  const tbl = {
    version: 3, updatedAt: null, failover: "same-family first (skip depleted), then next available by pref #",
    buckets: { "cline-per-model": {}, "opencode-zen-free": {} },
    lanes: [
      lane(2, "cline", "cline-free/muse-spark-1.3-contributor", "cline-per-model"),
      lane(3, "opencode", "opencode/mimo-v2.6-flash-free", "opencode-zen-free"),
      lane(15, "cline", "cline-free/glm-5.3-flash", "cline-per-model"),
    ],
  };
  writeFileSync(TABLE_PATH, JSON.stringify(tbl, null, 2));
  return { seededFrom: "fallback fixture", lanes: tbl.lanes.length };
}
const seeded = seedTable();

// ---- load the router helpers ----
let mod;
try {
  mod = await import(pathToFileURL(SRC).href);
} catch (e) {
  console.error(`Cannot import ${SRC}: ${e.message}`);
  console.error("If this is a missing dependency, run: npm install  (inside tools/telegram-provider-router)");
  process.exit(2);
}
const { isQuotaOrLimitError, looksLikeHelpOrStatusDoc, parseCountdownHint, parseDepletedUntil, markDepleted } = mod;

// ---- tiny harness ----
let passed = 0;
const failures = [];
function t(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  \u2717 ${name}\n      ${String(e.message || e).split("\n").join("\n      ")}`);
  }
}
function near(actual, expected, tolMs, what) {
  const d = Math.abs(actual - expected);
  if (!(d <= tolMs)) throw new Error(`${what}: expected ${new Date(expected).toISOString()} (±${tolMs}ms) but got ${new Date(actual).toISOString()} (off by ${d}ms)`);
}
function eq(actual, expected, what) {
  if (actual !== expected) throw new Error(`${what}: expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
}

// ---- fixtures ----
const CLINE_UI =
  "Daily free model limit reached. You've reached today's free usage limit for this model. " +
  "Try again in 23h 15m.";
const INFERENCE_CAP = "429 INFERENCE_CAP: free-lane capacity hit (rate limit exceeded). Try again in 1h 16m.";
const HELP_MARKDOWN =
  "In this workspace **free lane = ordered free-model failover chain** for Telegram coding.\n\n" +
  "Defined in `biomarker-and-nutrient-tracker/tools/telegram-provider-router/`:\n\n" +
  "* `docs/free-lane-preference.json` (v3, 17 lanes) \u2014 source of truth\n" +
  "* `docs/FREE_LANE_TABLE.md` \u2014 rendered `pref + status + reset + cooldown`\n" +
  "* `README.md` \u2192 `FREE_ALLOWANCE_BUCKETS` in `src/index.js`\n\n" +
  "Rule: **same-family first (skip depleted), then next available by `pref #`.**";
const PASSING_MENTION =
  "I read the context limit warning and trimmed the file; nothing is exhausted, the 23h 15m window is still open.";
const ALLOWANCE_BOARD =
  "Buckets\n" +
  "\u00b7 OpenCode Zen free [shared] \u2014 unknown remaining (rolling) \u00b7 OK\n" +
  "\u00b7 Cline free [per-model] \u00b7 reset Cline UI daily\n" +
  "    \u2013 muse-spark-1.3 : depleted until 2026-09-25T09:38:00.000Z\n" +
  "\u00b7 OpenCode Zen free [shared] \u2014 DEPLETED until 2026-09-25T09:38:00.000Z (hit by opencode/mimo) \u00b7 affects: mimo, muse";


// ---- D1: real Cline UI text with a 23h 15m countdown ----
console.log(`\nQuota detection + countdown parse (state dir: ${stateDir}, table seeded from: ${seeded.seededFrom}, lanes: ${seeded.lanes})`);

t("D1 Cline UI 'Try again in 23h 15m' is a quota error", () => {
  eq(isQuotaOrLimitError(CLINE_UI), true, "isQuotaOrLimitError(CLINE_UI)");
});
t("D1 Cline UI text parses to now + 23h15m (\u00b12s)", () => {
  const now = Date.now();
  const until = parseDepletedUntil(CLINE_UI);
  near(until, now + 23 * HOUR + 15 * 60 * 1000, 2000, "parseDepletedUntil(CLINE_UI)");
  const p = parseCountdownHint(CLINE_UI);
  eq(p.countdownParsed, true, "countdownParsed");
  eq(p.hint, "23h 15m", "countdownHint");
});

// ---- D2: help/status markdown must never look like a limit failure ----
t("D2 free-lane help markdown is NOT a quota error", () => {
  eq(looksLikeHelpOrStatusDoc(HELP_MARKDOWN), true, "looksLikeHelpOrStatusDoc(HELP_MARKDOWN)");
  eq(isQuotaOrLimitError(HELP_MARKDOWN), false, "isQuotaOrLimitError(HELP_MARKDOWN)");
});
t("D2 normal answer mentioning limit/exhausted is NOT a quota error", () => {
  eq(isQuotaOrLimitError(PASSING_MENTION), false, "isQuotaOrLimitError(PASSING_MENTION)");
});
t("D2 /allowance board listing depleted lanes is NOT a quota error", () => {
  eq(isQuotaOrLimitError(ALLOWANCE_BOARD), false, "isQuotaOrLimitError(ALLOWANCE_BOARD)");
});

// ---- D3: INFERENCE_CAP 429 ----
t("D3 INFERENCE_CAP 429 + 'Try again in 1h 16m' is a quota error and parses", () => {
  eq(isQuotaOrLimitError(INFERENCE_CAP), true, "isQuotaOrLimitError(INFERENCE_CAP)");
  const now = Date.now();
  near(parseDepletedUntil(INFERENCE_CAP), now + HOUR + 16 * 60 * 1000, 2000, "parseDepletedUntil(INFERENCE_CAP)");
  eq(parseCountdownHint(INFERENCE_CAP).hint, "1h 16m", "countdownHint");
});

// ---- B: countdown / ISO variants accepted by parseDepletedUntil ----
console.log("\nCountdown variants");
const VARIANTS = [
  ["try again in 23 hours 15 minutes", 23 * HOUR + 15 * 60 * 1000, "23h 15m"],
  ["Retry after 23h15m", 23 * HOUR + 15 * 60 * 1000, "23h 15m"],
  ["Rate limit reached; try again in 45m", 45 * 60 * 1000, "45m"],
  ["Freebuff: backend throttled, retry in 900s", 900 * 1000, "900s"],
  ["Quota exceeded, retry after 2d 4h", (2 * 24 + 4) * HOUR, "2d 4h"],
];
for (const [text, delta, hint] of VARIANTS) {
  t(`countdown "${text}" \u2192 ${hint}`, () => {
    const now = Date.now();
    near(parseDepletedUntil(text), now + delta, 2000, "parseDepletedUntil");
    eq(parseCountdownHint(text).hint, hint, "hint");
  });
}
t("ISO reset stamp with +00:00 offset is parsed exactly", () => {
  // Relative fixture: an absolute stamp rots the moment wall-clock passes it
  // (red after 2026-09-25T09:38Z with the old literal). +00:00 offset kept.
  const iso = new Date(Date.now() + HOUR).toISOString().replace(/Z$/, "+00:00");
  const p = parseCountdownHint(`Depleted until ${iso} (Cline UI)`);
  eq(p.countdownParsed, true, "countdownParsed");
  eq(p.until, Date.parse(iso), "until");
});
t("no countdown \u2192 countdownParsed false (caller uses default TTL)", () => {
  const p = parseCountdownHint("402 freebucks empty \u2014 no free usage left");
  eq(p.until, 0, "until");
  eq(p.countdownParsed, false, "countdownParsed");
});


// ---- C: markDepleted session + free-lane-table sync ----
console.log("\nmarkDepleted \u2192 session + free-lane-table sync");
const CLINE_MODEL = "cline-free/muse-spark-1.3-contributor";
const preOrderBefore = JSON.parse(readFileSync(TABLE_PATH, "utf8")).lanes.map((l) => `${l.pref}:${l.provider}/${l.model}`);

t("C1 help markdown never reaches markDepleted (router gate = false)", () => {
  eq(isQuotaOrLimitError(HELP_MARKDOWN), false, "gate");
});

let clineInfo = null;
t("C2 markDepleted(cline muse, real UI text) reports the parsed countdown", () => {
  const now = Date.now();
  clineInfo = markDepleted("cline", CLINE_MODEL, CLINE_UI);
  if (!clineInfo) throw new Error("markDepleted returned null");
  eq(clineInfo.countdownParsed, true, "countdownParsed");
  eq(clineInfo.countdownHint, "23h 15m", "countdownHint");
  near(clineInfo.depletedUntil, now + 23 * HOUR + 15 * 60 * 1000, 2000, "depletedUntil");
});

t("C3 session.quota has depletedUntil/scope/depletedObservedAt/countdownHint", () => {
  const s = JSON.parse(readFileSync(SESSION_PATH, "utf8"));
  const rec = s.quota[`cline/${CLINE_MODEL}`];
  if (!rec) throw new Error(`missing session.quota["cline/${CLINE_MODEL}"]`);
  eq(rec.scope, "per-model", "scope");
  eq(rec.countdownParsed, true, "countdownParsed");
  eq(rec.countdownHint, "23h 15m", "countdownHint");
  if (!/^\d{4}-\d{2}-\d{2}T/.test(rec.depletedObservedAt || "")) throw new Error(`depletedObservedAt not ISO: ${rec.depletedObservedAt}`);
  near(rec.depletedUntil, Date.now() + 23 * HOUR + 15 * 60 * 1000, 3000, "session depletedUntil");
  eq(Object.keys(s.quota).length, 1, "only the real limit hit recorded (help text marked nothing)");
});

t("C4 free-lane-table lane gets status/nextResetAt/cooldownUntil/note", () => {
  const tbl = JSON.parse(readFileSync(TABLE_PATH, "utf8"));
  const lane = tbl.lanes.find((l) => l.model === CLINE_MODEL);
  if (!lane) throw new Error(`no lane for ${CLINE_MODEL}`);
  eq(lane.status, "depleted", "status");
  eq(lane.cooldownUntil, lane.nextResetAt, "cooldownUntil == nextResetAt");
  near(Date.parse(lane.nextResetAt), Date.now() + 23 * HOUR + 15 * 60 * 1000, 3000, "nextResetAt");
  if (!/^\d{4}-\d{2}-\d{2}T/.test(lane.depletedObservedAt || "")) throw new Error(`depletedObservedAt not ISO: ${lane.depletedObservedAt}`);
  eq(lane.lastPingNote, "auto-capture from vendor limit text", "lastPingNote");
  if (!/from vendor countdown 23h 15m/.test(lane.nextReset || "")) throw new Error(`nextReset label missing countdown: ${lane.nextReset}`);
  if (!/WIB/.test(lane.nextReset || "")) throw new Error(`nextReset label missing WIB clock: ${lane.nextReset}`);
});

t("C5 pref order untouched by the table sync", () => {
  const after = JSON.parse(readFileSync(TABLE_PATH, "utf8")).lanes.map((l) => `${l.pref}:${l.provider}/${l.model}`);
  eq(after.join("|"), preOrderBefore.join("|"), "lane pref order");
});

t("C6 no-countdown error keeps the 6h default TTL and says so", () => {
  const now = Date.now();
  const info = markDepleted("cline", "cline-free/glm-5.3-flash", "402 payment required - no free credits left");
  if (!info) throw new Error("markDepleted returned null");
  eq(info.countdownParsed, false, "countdownParsed");
  near(info.depletedUntil, now + 6 * HOUR, 3000, "default TTL depletedUntil");
  const lane = JSON.parse(readFileSync(TABLE_PATH, "utf8")).lanes.find((l) => l.model === "cline-free/glm-5.3-flash");
  if (!lane) throw new Error("no lane for cline-free/glm-5.3-flash");
  eq(lane.status, "depleted", "status");
  if (!/default TTL/.test(lane.nextReset || "")) throw new Error(`nextReset should name the default TTL: ${lane.nextReset}`);
});

t("C7 shared bucket (OpenCode Zen) is marked + bucket nextResetAt synced", () => {
  const info = markDepleted("opencode", "opencode/mimo-v2.6-flash-free", INFERENCE_CAP);
  if (!info) throw new Error("markDepleted returned null");
  eq(info.key, "bucket:opencode-zen-free", "quota key");
  const tbl = JSON.parse(readFileSync(TABLE_PATH, "utf8"));
  const bucket = tbl.buckets?.["opencode-zen-free"];
  if (!bucket) throw new Error("no opencode-zen-free bucket in table");
  near(Date.parse(bucket.nextResetAt), Date.now() + HOUR + 16 * 60 * 1000, 3000, "bucket nextResetAt");
});

t("C8 live table is never written by the test (temp state dir only)", () => {
  if (!existsSync(LIVE_TABLE)) return; // no live table on this box
  const live = JSON.parse(readFileSync(LIVE_TABLE, "utf8"));
  const lane = live.lanes.find((l) => l.model === CLINE_MODEL);
  const tempLane = JSON.parse(readFileSync(TABLE_PATH, "utf8")).lanes.find((l) => l.model === CLINE_MODEL);
  if (lane.lastPingNote === "auto-capture from vendor limit text" && lane.nextReset === tempLane.nextReset) {
    throw new Error("live free-lane-table.json looks like it was written by this test");
  }
});

// ---- summary ----
console.log("");
if (failures.length) {
  console.log(`FAIL: ${failures.length} of ${passed + failures.length} checks failed`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`PASS: all ${passed} checks passed`);
process.exit(0);
