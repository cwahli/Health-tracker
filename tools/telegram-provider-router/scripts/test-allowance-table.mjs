#!/usr/bin/env node
/**
 * Unit tests for the TG allowance-table wiring:
 * free-lane JSON + live session quota -> qa-evidence/build-table.py -> HTML -> MEDIA:.
 * Ticket: "Wire TG allowance table via free-lane JSON + telegram-tables".
 *
 *   cd tools/telegram-provider-router && node scripts/test-allowance-table.mjs
 *
 * Runs src/index.js in import mode (TG_ROUTER_NO_START=1) with
 * TG_ROUTER_STATE_DIR pointed at a throwaway dir, so the live session/quota/table
 * are never touched and no Telegram polling or lock starts.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join, dirname, isAbsolute } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL_DIR = join(HERE, "..");
const REPO_ROOT = join(TOOL_DIR, "..", "..");
const SRC = join(TOOL_DIR, "src", "index.js");
const MOD = join(TOOL_DIR, "src", "free-lane-table.js");
const HOUR = 3600 * 1000;

// ---- fixtures (state dir before import: loadState() reads session.json) ----
const stateDir = mkdtempSync(join(tmpdir(), "ht-allowance-table-"));
const TABLE_PATH = join(stateDir, "free-lane-table.json");
const SESSION_PATH = join(stateDir, "session.json");

const UNTIL = Date.now() + 5 * HOUR + 15 * 60 * 1000; // live session truth
const STALE = Date.now() + 6 * HOUR;                  // wrong "default TTL" stamp in the table
const UNTIL_ISO = new Date(UNTIL).toISOString().replace(/\.\d{3}Z$/, "Z"); // isoZ() form

const TOOL_MARKDOWN =
  "Here is the current allowance result as a table:\n\n### Tool Allowance & Availability\n\n" +
  "| Tool | Installed | Status | Allowance | Success / Fail | Cooldown | Notes |\n" +
  "|------|-----------|--------|-----------|----------------|----------|-------|\n" +
  "| **OpenCode** (`opencode`) | ✅ true | `available` | `high` | 0 / 0 | none | Default: `deepseek-v4.1-flash` |\n" +
  "| **Cline CLI** (`cline`) | ✅ true | `available` | `high` | 0 / 0 | none | Thinking: `high` / `low` |\n" +
  "| **Grok Build CLI** (`grok`) | ✅ true | `available` | `high` | 0 / 0 | none |";

const lane = (pref, family, provider, model, label, bucket, extra = {}) => ({
  pref, family, provider, model, label, bucket, tg: true,
  status: "available", resetRule: "rolling / rate-limit",
  nextReset: "unknown until a limit response (then countdown)",
  nextResetAt: null, cooldownLeft: "-", cooldownUntil: null,
  lastPingAt: null, lastPingNote: "", ...extra,
});

const FIXTURE_TABLE = {
  version: 3,
  updatedAt: "2026-09-24T12:16:39.752Z",
  failover: "same-family first (skip depleted), then next available by pref #",
  buckets: {
    "opencode-zen-free": { resetRule: "rolling / rate-limit (shared)", nextResetLabel: "unknown until a limit response", nextResetAt: null },
    "cline-per-model": { resetRule: "per-model daily", nextResetLabel: "Cline UI daily", nextResetAt: null },
    "freebuff-freebucks": { resetRule: "shared daily Freebucks", nextResetLabel: "Freebuff UI daily", nextResetAt: null },
  },
  lanes: [
    lane(1, "muse-spark-1.3", "opencode", "opencode/muse-spark-1.3-contributor-free", "OpenCode Muse Spark 1.3 free", "opencode-zen-free"),
    lane(2, "muse-spark-1.3", "cline", "cline-free/muse-spark-1.3-contributor", "Cline Muse Spark 1.3 contributor free", "cline-per-model", {
      status: "depleted",
      resetRule: "per-model daily/rolling window; reset = depletedObservedAt + vendor countdown",
      nextReset: "stale default TTL (drifted)",
      nextResetAt: new Date(STALE).toISOString(),
      cooldownUntil: new Date(STALE).toISOString(),
      note: "REAL Cline daily free limit (user UI: Try again in 23h 15m).",
    }),
    lane(3, "mimo-v2.6-flash", "opencode", "opencode/mimo-v2.6-flash-free", "OpenCode MiMo V2.6 Flash free", "opencode-zen-free"),
    lane(17, "deepseek-v4.1-flash", "freebuff", "deepseek/deepseek-v4.1-flash", "Freebuff DeepSeek V4.1 Flash", "freebuff-freebucks", {
      tg: false,
      resetRule: "shared daily Freebucks (Freebuff UI)",
      nextReset: "Freebuff UI daily",
    }),
  ],
};

const FIXTURE_SESSION = {
  provider: "cline",
  models: { cline: "cline-free/muse-spark-1.3-contributor", opencode: "opencode/muse-spark-1.3-contributor-free" },
  quota: {
    "cline/cline-free/muse-spark-1.3-contributor": {
      depletedUntil: UNTIL,
      countdownParsed: true,
      countdownHint: "23h 15m",
      scope: "per-model",
      depletedObservedAt: new Date(Date.now() - HOUR).toISOString(),
      lastError: "Daily free model limit reached. Try again in 23h 15m.",
    },
    // Polluted mark from the smoke: doc-noise must never deplete a lane.
    "bucket:freebuff-freebucks": {
      depletedUntil: Date.now() + 3 * HOUR,
      countdownParsed: false,
      scope: "shared",
      lastError: TOOL_MARKDOWN,
    },
  },
};

writeFileSync(TABLE_PATH, JSON.stringify(FIXTURE_TABLE, null, 2));
writeFileSync(SESSION_PATH, JSON.stringify(FIXTURE_SESSION, null, 2));

// ---- import mode env (must be set before importing the router) ----
process.env.TG_ROUTER_NO_START = "1";
process.env.TELEGRAM_BOT_TOKEN = "123:TEST";
process.env.TELEGRAM_USER_ID = "1";
process.env.TG_ROUTER_STATE_DIR = stateDir;
process.env.WORKSPACE = REPO_ROOT; // lets resolveBuildTablePy find qa-evidence/build-table.py
delete process.env.TG_BUILD_TABLE_PY;

// ---- load the router (helpers) + the free-lane table module ----
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
const { isQuotaOrLimitError, looksLikeHelpOrStatusDoc, wantsAllowanceTable, markDepleted, allowanceTableReply, FREE_LANE_TABLE_PATH, STATE_PATH } = mod;
const {
  buildFreeLaneTableModel,
  renderFreeLaneTableHtml,
  syncFreeLaneTableFromSession,
  activeRouteAdvice,
  formatCompactAllowanceChat,
  dedupeTokenHarborLanes,
  planCodeForLane,
  readJson,
} = flt;

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
function eq(actual, expected, what) {
  if (actual !== expected) throw new Error(`${what}: expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
}
function ok(cond, what) {
  if (!cond) throw new Error(what);
}
const isoZ = (ms) => new Date(Number(ms)).toISOString().replace(/\.\d{3}Z$/, "Z");

const table = readJson(TABLE_PATH);
const session = readJson(SESSION_PATH);
console.log(`\nAllowance table wiring (state dir: ${stateDir})`);

t("W1 state paths follow TG_ROUTER_STATE_DIR (tests never touch the live box)", () => {
  eq(FREE_LANE_TABLE_PATH, TABLE_PATH, "FREE_LANE_TABLE_PATH");
  eq(STATE_PATH, SESSION_PATH, "STATE_PATH");
});

t("W2 model exposes pref# / lane / provider / status / nextResetAt / cooldown / notes", () => {
  const m = buildFreeLaneTableModel(table, session);
  const cols = m.tables[0].columns;
  eq(cols.join("|"), "Pref|Lane|Provider|Status|Next reset (UTC)|Cooldown|Notes", "columns");
  for (const row of m.tables[0].rows) eq(row.length, cols.length, `row width for pref ${row[0]}`);
});

t("W3 live session quota overrides the stale table stamp (table == /allowance)", () => {
  const m = buildFreeLaneTableModel(table, session);
  const row = m.tables[0].rows.find((r) => r[0] === "2");
  ok(row, "pref 2 row");
  eq(row[1], "Cline Muse Spark 1.3 contributor free", "lane label");
  eq(row[2], "cline", "provider");
  eq(row[3], "depleted", "status");
  eq(row[4], UNTIL_ISO, "nextResetAt == session.quota depletedUntil");
  eq(row[5], "until reset", "cooldown");
  if (!/ACTIVE \(depleted\)/.test(row[6])) throw new Error(`active route not flagged: ${row[6]}`);
  if (Date.parse(row[4]) === Date.parse(new Date(STALE).toISOString())) throw new Error("stale default-TTL stamp leaked into the table");
});

t("W4 doc-noise session record never depletes a lane", () => {
  const m = buildFreeLaneTableModel(table, session);
  const row = m.tables[0].rows.find((r) => r[0] === "17");
  eq(row[3], "available", "freebuff status");
  eq(row[4], "Freebuff UI daily", "freebuff next reset");
});

t("W5 active-route advice names the next available same-family lane", () => {
  const a = activeRouteAdvice(table, session);
  eq(a.depleted, true, "depleted");
  eq(a.live.key, "cline/cline-free/muse-spark-1.3-contributor", "live quota key");
  eq(a.active.pref, 2, "active lane pref");
  eq(a.sameFamily.pref, 1, "same-family next lane");
  if (!a.lines.some((l) => /DEPLETED, resets/.test(l))) throw new Error(`no DEPLETED line: ${a.lines.join(" / ")}`);
  if (!a.lines.some((l) => /Next available \(same family/.test(l))) throw new Error(`no next-available line: ${a.lines.join(" / ")}`);
});


t("W6 renderer writes JSON + HTML at absolute paths with the required columns", () => {
  const r = renderFreeLaneTableHtml({ tablePath: TABLE_PATH, sessionPath: SESSION_PATH, outDir: join(stateDir, "tables") });
  ok(isAbsolute(r.htmlPath) && isAbsolute(r.jsonPath), "absolute paths");
  ok(existsSync(r.htmlPath), `html exists: ${r.htmlPath}`);
  ok(existsSync(r.jsonPath), `json exists: ${r.jsonPath}`);
  const html = readFileSync(r.htmlPath, "utf8");
  for (const need of ["Pref", "Status", "Next reset (UTC)", "Cooldown", "Notes", "Cline Muse Spark 1.3 contributor free"]) {
    if (!html.includes(need)) throw new Error(`html missing ${JSON.stringify(need)} (renderer=${r.renderer})`);
  }
  ok(/build-table\.py|builtin-grid-fallback/.test(r.renderer), `renderer=${r.renderer}`);
});

t("W7 built-in grid fallback still delivers a readable table page", () => {
  const r = renderFreeLaneTableHtml({
    tablePath: TABLE_PATH,
    sessionPath: SESSION_PATH,
    outDir: join(stateDir, "fallback"),
    buildTablePy: "/nonexistent/build-table.py",
  });
  eq(r.renderer, "builtin-grid-fallback", "renderer");
  const html = readFileSync(r.htmlPath, "utf8");
  if (!html.includes("st-table") || !html.includes("OpenCode MiMo V2.6 Flash free")) throw new Error("fallback grid missing table/lane");
});

t("W8 /allowance table reply is a MEDIA: line to an existing .html (no CLI matrix)", () => {
  const reply = allowanceTableReply();
  const m = reply.match(/^MEDIA:(.+)$/m);
  if (!m) throw new Error(`no MEDIA line in reply: ${reply.slice(0, 200)}`);
  const p = m[1].trim();
  if (!isAbsolute(p)) throw new Error(`MEDIA path not absolute: ${p}`);
  if (!/\.html$/.test(p)) throw new Error(`MEDIA path not .html: ${p}`);
  ok(existsSync(p), `MEDIA file exists: ${p}`);
  if (/Antigravity|Grok\s+Build|\|\s*Tool\s*\|/i.test(reply)) throw new Error("reply mentions the CLI install matrix");
  if (!/\d+ lanes, \d+ buckets/.test(reply)) throw new Error(`caption missing lane/bucket count: ${reply}`);
  const html = readFileSync(p, "utf8");
  if (/Antigravity|Grok\s+Build/i.test(html)) throw new Error("rendered HTML mentions the CLI install matrix");
  if (!/Cline Muse Spark 1\.3 contributor free/.test(html)) throw new Error("rendered HTML missing the depleted lane row");
});

t("W9 free-form table ask routes locally; normal text does not", () => {
  eq(wantsAllowanceTable("can you show the allowance result as a table"), true, "smoke ask");
  eq(wantsAllowanceTable("show the free-lane allowance as html"), true, "html ask");
  eq(wantsAllowanceTable("allowance as a table"), true, "bare ask");
  eq(wantsAllowanceTable("please summarize server.ts"), false, "normal task");
  eq(wantsAllowanceTable("the allowance is fine, continue"), false, "allowance without table");
  eq(wantsAllowanceTable("add a table to the allowance docs and wire it"), false, "coding task stays with the agent");
});

t("W10 tool-allowance markdown / pipe tables are never quota errors", () => {
  eq(looksLikeHelpOrStatusDoc(TOOL_MARKDOWN), true, "looksLikeHelpOrStatusDoc");
  eq(isQuotaOrLimitError(TOOL_MARKDOWN), false, "isQuotaOrLimitError");
});

t("W11 markDepleted refuses doc-like text (session quota untouched)", () => {
  const info = markDepleted("cline", "cline-free/glm-5.3-flash", TOOL_MARKDOWN);
  eq(info, null, "markDepleted return");
  const s = readJson(SESSION_PATH);
  eq(s.quota["cline/cline-free/glm-5.3-flash"], undefined, "no polluted record written");
});


t("W12 sync persists session truth into free-lane-table.json, pref order intact", () => {
  const before = readJson(TABLE_PATH).lanes.map((l) => `${l.pref}:${l.provider}/${l.model}`).join("|");
  const sync = syncFreeLaneTableFromSession({ tablePath: TABLE_PATH, session });
  eq(sync.updated, true, "updated");
  const after = readJson(TABLE_PATH);
  const l2 = after.lanes.find((l) => l.pref === 2);
  eq(l2.nextResetAt, UNTIL_ISO, "persisted nextResetAt");
  eq(l2.cooldownUntil, UNTIL_ISO, "persisted cooldownUntil");
  ok(/from vendor countdown 23h 15m/.test(l2.nextReset || ""), `label: ${l2.nextReset}`);
  eq(after.lanes.map((l) => `${l.pref}:${l.provider}/${l.model}`).join("|"), before, "pref order");
  const again = syncFreeLaneTableFromSession({ tablePath: TABLE_PATH, session });
  eq(again.updated, false, "second sync is a no-op");
});

t("W13 doc-noise session record keeps the ledger's depleted truth (no healthy pretence)", () => {
  const t2 = readJson(TABLE_PATH); // after W12 sync, pref 2 carries the corrected stamp
  const session2 = JSON.parse(JSON.stringify(session));
  session2.quota["cline/cline-free/muse-spark-1.3-contributor"] = {
    depletedUntil: Date.now() + 6 * HOUR, // bogus default TTL written by the polluting mark
    countdownParsed: false,
    lastError: TOOL_MARKDOWN,
  };
  const a = activeRouteAdvice(t2, session2);
  eq(a.depleted, true, "depleted");
  eq(a.live, null, "polluted session record skipped");
  eq(isoZ(a.until), UNTIL_ISO, "until comes from the ledger file, not the polluted session record");
  if (a.lines.some((l) => /available \(no live quota record\)/.test(l))) throw new Error("pretended the depleted route was healthy");
});

// ---- HT-ALLOWANCE-TH-DEDUPE: TH + OC-TH are the same free bar ----
const EMPTY_SESSION = { provider: "", models: {}, quota: {} };
// Two lanes for the SAME model: OpenCode+tools path and chat-only Token Harbor.
const TH_TOOLS_LANE = lane(8, "deepseek-v4.1-flash", "opencode", "tokenharbor/deepseek-v4.1-flash:free", "OpenCode Token Harbor DeepSeek V4.1 Flash free", "tokenharbor-free");
const TH_CHAT_LANE = lane(9, "deepseek-v4.1-flash", "tokenharbor", "deepseek-v4.1-flash:free", "Token Harbor chat DeepSeek V4.1 Flash free", "tokenharbor-free");
const TH_ONLY_TABLE = {
  version: 3,
  updatedAt: "2026-09-24T12:16:39.752Z",
  failover: "same-family first (skip depleted), then next available by pref #",
  buckets: { "tokenharbor-free": { scope: "shared", resetRule: "rolling ~7-day value bar", nextResetAt: null, nextResetLabel: "unknown" } },
  lanes: [TH_TOOLS_LANE, TH_CHAT_LANE],
};

t("W14 planCodeForLane maps BOTH Token Harbor paths to TH (no OC-TH)", () => {
  eq(planCodeForLane(TH_TOOLS_LANE), "TH", "opencode tokenharbor lane");
  eq(planCodeForLane(TH_CHAT_LANE), "TH", "chat-only tokenharbor lane");
  ok(!/OC-TH/.test(formatCompactAllowanceChat(TH_ONLY_TABLE, EMPTY_SESSION)), "compact text still says OC-TH");
});

t("W15 dedupeTokenHarborLanes keeps one row and prefers the OpenCode tools lane", () => {
  const a = dedupeTokenHarborLanes(TH_ONLY_TABLE.lanes);
  eq(a.length, 1, "one TH row");
  eq(a[0].provider, "opencode", "kept provider");
  eq(a[0].model, "tokenharbor/deepseek-v4.1-flash:free", "kept model");
  eq(a[0].pref, 8, "kept pref");
  // Order-independent: chat-only first must still be replaced by the tools lane.
  const b = dedupeTokenHarborLanes([TH_CHAT_LANE, TH_TOOLS_LANE]);
  eq(b.length, 1, "one TH row (reversed)");
  eq(b[0].provider, "opencode", "reversed order still keeps the tools lane");
});

t("W16 compact /allowance shows DeepSeek V4.1 once as TH (no OC-TH)", () => {
  const text = formatCompactAllowanceChat(TH_ONLY_TABLE, EMPTY_SESSION);
  ok(!/OC-TH/.test(text), `OC-TH present:\n${text}`);
  // Count table rows only (the "Next up:" summary may repeat the name).
  const rows = text.split("\n").filter((l) => /^[✅❌] <code>/.test(l));
  const thRows = rows.filter((l) => /DeepSeek V4\.1/.test(l));
  eq(thRows.length, 1, `DeepSeek V4.1 table rows = ${JSON.stringify(thRows)}`);
  ok(/DeepSeek V4\.1\s+TH\s/.test(thRows[0] || ""), `row not labeled TH: ${thRows[0]}`);
});

t("W17 HTML allowance model also lists Token Harbor once (display-only dedupe)", () => {
  const m = buildFreeLaneTableModel(TH_ONLY_TABLE, EMPTY_SESSION);
  const dsRows = m.tables[0].rows.filter((r) => /DeepSeek V4\.1/.test(r[1]));
  eq(dsRows.length, 1, `HTML lane rows for DeepSeek V4.1 = ${JSON.stringify(dsRows)}`);
  eq(dsRows[0][2], "opencode", "kept the OpenCode tools lane in HTML");
  // Ledger itself is untouched: both lanes still exist for failover.
  eq(TH_ONLY_TABLE.lanes.length, 2, "failover lanes preserved");
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

