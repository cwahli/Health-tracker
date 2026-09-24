#!/usr/bin/env node
/**
 * Unit tests for the ht-allowance-watch shared core (allowance-watch-core.cjs).
 * Ticket: tmp/ht-allowance-watch/TICKET.md — "Add a small unit test for the
 * 'soonest reset' + 'probe result -> status' logic", plus the HARD RULES test:
 * ht-watch must NOT see QUOTA when the pane shows source text containing
 * quota words ("429" inside code being read false-positived on 2026-09-24).
 *
 *   cd tools/telegram-provider-router && node scripts/test-allowance-watch.mjs
 *
 * Pure-logic core: no network, no child processes, no live ledger writes.
 */
import { createRequire } from "module";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL_DIR = join(HERE, "..");
const require = createRequire(import.meta.url);
const core = require(join(TOOL_DIR, "src", "allowance-watch-core.cjs"));

// ---- tiny harness (same shape as the other router tests) ----
let passed = 0;
const failures = [];
function t(name, fn) {
  try { fn(); passed += 1; console.log(`  \u2713 ${name}`); }
  catch (e) { failures.push(name); console.log(`  \u2717 ${name}\n      ${e.message}`); }
}
function ok(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg || "eq"}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function near(a, b, tol, msg) { if (!(Math.abs(Number(a) - Number(b)) <= tol)) throw new Error(`${msg || "near"}: ${a} !~ ${b} (tol ${tol})`); }

const HOUR = 3600 * 1000;
const lane = (pref, provider, model, bucket, extra = {}) => ({
  pref, provider, model, bucket, label: model,
  family: String(model).replace(/^[^/]+\//, ""),
  status: "available", nextResetAt: null, cooldownUntil: null, ...extra,
});

// ---------------------------------------------------------------- C1/C2 sweep plan
t("C1 sweep plan: due = depleted lanes whose reset/cooldown has passed, soonest = min", () => {
  const now = 1_800_000_000_000;
  const tbl = {
    lanes: [
      lane(1, "opencode", "a", "opencode-zen-free", { status: "depleted", nextResetAt: core.isoZ(now - 1000), cooldownUntil: core.isoZ(now - 1000) }),
      lane(2, "opencode", "b", "opencode-zen-free", { status: "depleted", nextResetAt: core.isoZ(now + HOUR) }),
      lane(3, "cline", "c", "cline-per-model", { status: "depleted", nextResetAt: null, cooldownUntil: null }),
      lane(4, "opencode", "d", "opencode-zen-free"), // available
    ],
  };
  const p = core.computeSweepPlan(tbl, now);
  eq(p.due.length, 1, "due count");
  eq(p.due[0].model, "a", "due lane");
  near(p.soonest, now - 1000, 1, "soonest is the passed reset");
  ok(p.hasUnknown, "lane without known time counts as unknown");
  eq(p.depleted.length, 3, "depleted count");
});

t("C2 sweep plan: uses min(nextResetAt, cooldownUntil) per lane; none due when all future", () => {
  const now = 1_800_000_000_000;
  const tbl = {
    lanes: [
      lane(1, "opencode", "a", "opencode-zen-free", { status: "depleted", nextResetAt: core.isoZ(now + 2 * HOUR), cooldownUntil: core.isoZ(now + HOUR) }),
      lane(2, "cline", "c", "cline-per-model", { status: "depleted", nextResetAt: core.isoZ(now + 3 * HOUR) }),
    ],
  };
  const p = core.computeSweepPlan(tbl, now);
  eq(p.due.length, 0, "nothing due");
  near(p.soonest, now + HOUR, 1, "soonest honours the earlier of reset/cooldown");
  ok(!p.hasUnknown, "no unknown-time lanes");
});

// ---------------------------------------------------------------- C3 probe -> status
t("C3 probeCli maps vendor output to available/depleted/uncertain", () => {
  const okSpawn = () => ({ status: 0, stdout: "OK", stderr: "" });
  eq(core.probeCli(okSpawn, "opencode", [], 1000).status, "available", "OK reply → available");

  const rl = () => ({ status: 1, stdout: "Error: Rate limit exceeded, try again later", stderr: "" });
  eq(core.probeCli(rl, "opencode", [], 1000).status, "depleted", "Rate limit exceeded → depleted");

  const q429 = () => ({ status: 1, stdout: "429 Too Many Requests", stderr: "" });
  eq(core.probeCli(q429, "cline", [], 1000).status, "depleted", "429 → depleted");

  const hang = () => ({ status: null, error: { code: "ETIMEDOUT" }, stdout: "", stderr: "" });
  eq(core.probeCli(hang, "opencode", [], 1000).status, "uncertain", "timeout → uncertain (re-stamp default TTL)");

  const missing = () => ({ status: null, error: { code: "ENOENT" }, stdout: "", stderr: "" });
  eq(core.probeCli(missing, "cline", [], 1000).status, "uncertain", "binary missing → uncertain");

  const silent = () => ({ status: 0, stdout: "", stderr: "" });
  eq(core.probeCli(silent, "opencode", [], 1000).status, "uncertain", "no output → uncertain");
});

// ---------------------------------------------------------------- C4/C5 parsing
t("C4 countdown parse: 'Try again in 23h 15m' and future ISO stamps", () => {
  const cd = core.parseCountdownHint("Daily free model limit reached. Try again in 23h 15m.");
  ok(cd.countdownParsed, "countdown parsed");
  near(cd.until - Date.now(), (23 * 60 + 15) * 60 * 1000, 5000, "23h 15m");
  const iso = core.parseCountdownHint(`depleted until 2027-01-02T03:04:05Z`);
  ok(iso.countdownParsed, "ISO parsed");
  eq(iso.until, Date.parse("2027-01-02T03:04:05Z"), "ISO until");
  eq(core.parseCountdownHint("all good").until, 0, "no countdown → 0");
});

t("C5 rate-limit vs allowance text classification", () => {
  eq(core.isRateLimitText("Rate limit exceeded"), true, "rate limit → short TTL");
  eq(core.isRateLimitText("429 Too Many Requests"), true, "429 → short TTL");
  eq(core.isRateLimitText("next rolling 7-day period starts on 29 Sep"), false, "7-day period → not short TTL");
  eq(core.isQuotaText("You've reached today's free usage limit"), true, "quota text detected");
});

// ---------------------------------------------------------------- C6/C7 ledger stamps
t("C6 stampDepleted marks shared bucket lanes + session quota in router shape", () => {
  const now = Date.now();
  const tbl = { buckets: { "opencode-zen-free": { resetRule: "rolling" } }, lanes: [
    lane(1, "opencode", "opencode/muse-free", "opencode-zen-free"),
    lane(2, "opencode", "opencode/mimo-free", "opencode-zen-free"),
  ] };
  const session = { quota: {} };
  const lanes = tbl.lanes;
  const info = core.stampDepleted(tbl, session, lanes, "opencode-zen-free", {
    until: now + 45 * 60 * 1000, hint: "", kind: "rate-limit", lastError: "Rate limit exceeded", source: "test",
  });
  const rec = session.quota["bucket:opencode-zen-free"];
  ok(rec, "session quota record under bucket key");
  eq(rec.scope, "shared", "scope");
  eq(rec.kind, "rate-limit", "kind");
  near(rec.depletedUntil, now + 45 * 60 * 1000, 1, "depletedUntil");
  for (const l of lanes) {
    eq(l.status, "depleted", `lane ${l.model} status`);
    eq(l.nextResetAt, info.untilIso, `lane ${l.model} nextResetAt`);
    eq(l.cooldownUntil, info.untilIso, `lane ${l.model} cooldownUntil`);
  }
  eq(tbl.buckets["opencode-zen-free"].nextResetAt, info.untilIso, "bucket nextResetAt synced");
  eq(tbl.lanes[0].lastPingNote, "test", "source recorded");
});

t("C6b stampDepleted without countdown uses default TTL and clears stale hint", () => {
  const tbl = { buckets: {}, lanes: [lane(1, "cline", "cline-free/x", "cline-per-model", { countdownHint: "1h 0m" })] };
  const session = {};
  const info = core.stampDepleted(tbl, session, tbl.lanes, null, { until: Date.now() + core.QUOTA_TTL_MS, hint: "", kind: "quota", lastError: "limit", source: "t" });
  eq(session.quota["cline/cline-free/x"].kind, "limit-unknown", "unknown kind without hint");
  eq(tbl.lanes[0].countdownHint, undefined, "stale hint removed");
  near(Date.parse(info.untilIso), Date.now() + core.QUOTA_TTL_MS, 2000, "default 6h TTL");
});

t("C7 stampAvailable flips lanes and clears live quota records so overlay cannot resurrect", () => {
  const tbl = { buckets: { "opencode-zen-free": { nextResetAt: "2027-01-01T00:00:00Z" } }, lanes: [
    lane(1, "opencode", "opencode/muse-free", "opencode-zen-free", { status: "depleted", nextResetAt: "2027-01-01T00:00:00Z", cooldownUntil: "2027-01-01T00:00:00Z" }),
    lane(2, "opencode", "opencode/mimo-free", "opencode-zen-free", { status: "depleted", nextResetAt: "2027-01-01T00:00:00Z" }),
  ] };
  const session = { quota: { "bucket:opencode-zen-free": { depletedUntil: Date.now() + HOUR }, "opencode/opencode/muse-free": { depletedUntil: Date.now() + HOUR }, "other/key": { depletedUntil: 1 } } };
  const { clearedKeys } = core.stampAvailable(tbl, session, tbl.lanes, "opencode-zen-free", { source: "probe OK" });
  ok(clearedKeys.includes("bucket:opencode-zen-free"), "bucket rec cleared");
  ok(clearedKeys.includes("opencode/opencode/muse-free"), "per-model rec cleared");
  ok("other/key" in session.quota, "unrelated rec kept");
  for (const l of tbl.lanes) { eq(l.status, "available", `lane ${l.model} available`); eq(l.nextResetAt, null, "reset cleared"); }
  eq(tbl.buckets["opencode-zen-free"].nextResetAt, null, "bucket reset cleared");
});

// ---------------------------------------------------------------- C8 HARD RULES: no source-text FPs
t("C8 cline matcher: source/prompt lines containing 429 or quota words do NOT match (HARD RULES)", () => {
  const sourceLines = [
    "const retryAfter = 429;",                     // code with =
    "if (status == 429) { backoff(); }",           // parens/braces
    "x = fetchQuota(429);",                        // parens
    "return a->rate_limit_exceeded;",              // ->
    "- [ ] handle 429 too many requests",          // bullet list item
    "> Error: Rate limit exceeded in docs.md",     // quoted paste
    "# rate limit exceeded",                       // markdown heading
    "$ curl -H 'X: 429' example.com",              // shell line
    "func tooManyRequests() {}",                   // code, word inside identifier
    "  src/index.js:42: if (res.status === 429)",  // file:line context
  ];
  eq(core.matchClineQuotaLine(sourceLines), "", "none of the source/prompt lines may match");
});

t("C8b cline matcher: real vendor status lines DO match", () => {
  const hits = core.matchClineQuotaLine([
    "Working…",
    "Daily free model limit reached. Try again in 23h 15m",
    "Rate limit exceeded",
  ]);
  ok(hits.includes("Daily free model limit reached"), "daily-limit line matches");
  ok(hits.includes("Rate limit exceeded"), "plain rate-limit line matches");
});

t("C8c freebuff matcher: Freebucks quota matches, working/Thinking/code does not", () => {
  ok(core.matchFreebuffQuotaLine(["You're out of Freebucks for today"]).includes("out of Freebucks"), "quota line");
  eq(core.matchFreebuffQuotaLine(["working...", "Thinking", "12 Freebucks left", "const x = 'out of freebucks' in docs"]), "", "alive lines and code stay silent");
});

// ---------------------------------------------------------------- C10 opencode log rule
const ocLine = (iso, body) => `2026-09-24T00:00:00.000Z [info] timestamp=${iso} ${body}`;
t("C10 opencode log quota: stuck after silence window → model returned", () => {
  const tErr = Date.parse("2026-09-24T12:00:00Z");
  const lines = [
    ocLine("2026-09-24T11:59:00Z", "step part.created"),
    ocLine("2026-09-24T12:00:00Z", "error Rate limit exceeded modelID=opencode/muse-spark-1.3-contributor-free providerID=opencode"),
  ];
  eq(core.opencodeLogQuota(lines, tErr + 91000), "opencode/muse-spark-1.3-contributor-free", "90s silence → quota");
  eq(core.opencodeLogQuota(lines, tErr + 10000), null, "within 90s silence → not yet");
});

t("C10b opencode log quota: later attempt after the limit line → not stuck (hang rule)", () => {
  const lines = [
    ocLine("2026-09-24T12:00:00Z", "error Rate limit exceeded modelID=opencode/muse-free"),
    ocLine("2026-09-24T12:01:00Z", "message=\"step part.updated\" agent=build"),
  ];
  eq(core.opencodeLogQuota(lines, Date.parse("2026-09-24T12:05:00Z")), null, "later step suppresses quota");
});

t("C10d opencode log quota: real-world 'AI_APICallError: Too Many Requests' error line matches", () => {
  const lines = [
    ocLine("2026-09-24T22:12:04.201Z", "level=ERROR run=f1 message=\"stream error\" providerID=cloudflare modelID=@cf/qwen/qwen3.8-27b error.error=\"AI_APICallError: Too Many Requests\""),
  ];
  eq(core.opencodeLogQuota(lines, Date.parse("2026-09-24T22:14:00Z")), "@cf/qwen/qwen3.8-27b", "Too Many Requests line → quota with modelID");
});

t("C10e benign post-run log lines (cleanup WARN) do not suppress a final quota error", () => {
  const lines = [
    ocLine("2026-09-24T22:12:38.986Z", "level=ERROR run=f1 message=\"stream error\" providerID=cloudflare modelID=@cf/qwen/qwen3.8-27b error.error=\"AI_APICallError: Too Many Requests\""),
    ocLine("2026-09-24T22:13:00.416Z", "level=WARN run=f1 message=\"cleanup failed\" exitCode=128 stderr=\"fatal: not a git repository…\""),
  ];
  eq(core.opencodeLogQuota(lines, Date.parse("2026-09-24T22:15:00Z")), "@cf/qwen/qwen3.8-27b", "cleanup WARN is not an attempt — quota stands");
  eq(core.opencodeLogQuota(lines, Date.parse("2026-09-24T22:12:39.5Z")), null, "still respects silence wait while running");
});

t("C10f finished run skips the silence wait (ht-run 'finished' marker case)", () => {
  const lines = [
    ocLine("2026-09-24T22:12:38.986Z", "level=ERROR run=f1 message=\"stream error\" providerID=cloudflare modelID=@cf/qwen/qwen3.8-27b error.error=\"AI_APICallError: Too Many Requests\""),
  ];
  eq(core.opencodeLogQuota(lines, Date.parse("2026-09-24T22:12:39.5Z"), { finished: true }), "@cf/qwen/qwen3.8-27b", "finished → no silence wait");
  eq(core.opencodeLogQuota(lines, Date.parse("2026-09-24T22:12:39.5Z")), null, "without finished → silence wait applies");
});

t("C10c opencode log quota: no quota lines or stale-only lines → null", () => {
  eq(core.opencodeLogQuota([ocLine("2026-09-24T01:00:00Z", "step ok")], Date.parse("2026-09-24T12:00:00Z")), null, "no quota lines");
  const stale = [ocLine("2026-09-24T01:00:00Z", "error Rate limit exceeded modelID=opencode/muse-free")];
  eq(core.opencodeLogQuota(stale, Date.parse("2026-09-24T12:00:00Z")), null, "older than 6h → ignore");
});

// ---------------------------------------------------------------- C11/C12 lane pick + failover
t("C11 pickModelForTool: skips cooling-down and live-quota'd lanes, lowest pref wins", () => {
  const now = Date.now();
  const tbl = { lanes: [
    lane(1, "opencode", "opencode/a", "opencode-zen-free", { status: "depleted", nextResetAt: core.isoZ(now + HOUR) }),
    lane(2, "opencode", "opencode/b", "opencode-zen-free", { status: "depleted", nextResetAt: core.isoZ(now - 1000) }),
    lane(3, "opencode", "opencode/c", "opencode-zen-free"),
    lane(4, "opencode", "opencode/d", "opencode-zen-free", { status: "unavailable" }),
  ] };
  const session = { quota: { "bucket:opencode-zen-free": { depletedUntil: now + HOUR } } };
  eq(core.pickModelForTool(tbl, session, "opencode", now), null, "shared bucket live quota blocks all opencode lanes");
  const tbl2 = { lanes: tbl.lanes };
  eq(core.pickModelForTool(tbl2, { quota: {} }, "opencode", now), "opencode/b", "cool-down-expired lane beats later pref");
});

t("C12 nextLane failover order: same family → same family other tool → pref → freebuff last", () => {
  const now = Date.now();
  const lanes = [
    lane(1, "opencode", "opencode/muse-free", "opencode-zen-free"),
    lane(2, "cline", "cline-free/muse-free", "cline-per-model", { status: "depleted", nextResetAt: core.isoZ(now + 2 * HOUR) }),
    lane(3, "tokenharbor", "deepseek-v4.1-flash:free", "tokenharbor-free"),
    lane(4, "freebuff", "deepseek/deepseek-v4.1-flash", "freebuff-freebucks"),
  ];
  eq(core.nextLane({ lanes }, {}, "cline", "cline-free/muse-free", now), "opencode|opencode/muse-free", "same family (muse) first");
  const lanes2 = [
    lane(1, "opencode", "opencode/muse-free", "opencode-zen-free", { status: "depleted", nextResetAt: core.isoZ(now + HOUR) }),
    lane(2, "cline", "cline-free/muse-free", "cline-per-model", { status: "depleted", nextResetAt: core.isoZ(now + 2 * HOUR) }),
    lane(3, "tokenharbor", "deepseek-v4.1-flash:free", "tokenharbor-free"),
    lane(4, "freebuff", "deepseek/deepseek-v4.1-flash", "freebuff-freebucks"),
  ];
  eq(core.nextLane({ lanes: lanes2 }, {}, "cline", "cline-free/muse-free", now), "tokenharbor|deepseek-v4.1-flash:free", "family gone → pref, non-freebuff before freebuff");
  const lanes3 = [
    lane(1, "opencode", "opencode/muse-free", "opencode-zen-free", { status: "depleted", nextResetAt: core.isoZ(now + HOUR) }),
    lane(4, "freebuff", "deepseek/deepseek-v4.1-flash", "freebuff-freebucks"),
  ];
  eq(core.nextLane({ lanes: lanes3 }, {}, "opencode", "opencode/muse-free", now), "freebuff|deepseek/deepseek-v4.1-flash", "freebuff is the last resort");
  eq(core.nextLane({ lanes: lanes3 }, { quota: { "bucket:freebuff-freebucks": { depletedUntil: now + HOUR } } }, "opencode", "opencode/muse-free", now), null, "all depleted → null (FAILOVER_EXHAUSTED)");
});

t("C13 core is dependency-free and test loads the repo copy only", () => {
  eq(join(TOOL_DIR, "src", "allowance-watch-core.cjs").endsWith("src/allowance-watch-core.cjs"), true, "repo copy path");
  eq(typeof core.computeSweepPlan, "function", "exports present");
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
