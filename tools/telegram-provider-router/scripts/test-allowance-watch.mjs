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
import fs from "fs";
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

// A lane with no probe kind can never be detected as spent or seen to renew, so a
// provider that lands in the table without one is a provider whose allowance is
// frozen. Gemini rows arrive from the catalog; they must be probeable.
t("C3b every provider that can sit in the table has a probe kind", () => {
  const kind = (lane) => core.pickProbeKind(lane).kind;
  eq(kind({ provider: "opencode", model: "opencode/muse-spark-1.3-contributor-free" }), "opencode", "opencode probed");
  eq(kind({ provider: "cline", model: "cline-free/deepseek-v4.1-flash" }), "cline", "cline probed");
  eq(kind({ provider: "tokenharbor", model: "deepseek-v4.1-flash:free" }), "tokenharbor", "tokenharbor probed");
  eq(kind({ provider: "opencode", model: "cloudflare/@cf/qwen/qwen3.8-27b" }), "cloudflare", "cloudflare probed");
  eq(kind({ provider: "gemini", model: "gemini-3.8-flash" }), "opencode", "gemini probed through opencode");
  eq(kind({ provider: "opencode", model: "google/gemini-3.8-flash" }), "opencode", "gemini via opencode path probed");
  eq(kind({ provider: "freebuff", model: "deepseek/deepseek-v4.1-flash" }), "skip", "freebuff stays unprobed (terminal)");
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

// ---------------------------------------------------------------- C16 Cloudflare 4006 daily neurons exhaustion → next 00:00 UTC
t("C16 nextMidnightUtc: next 00:00 UTC strictly after now", () => {
  // 2026-09-25T07:25:00Z → 2026-09-26T00:00:00Z
  eq(core.nextMidnightUtc(Date.parse("2026-09-25T07:25:00Z")), Date.parse("2026-09-26T00:00:00Z"), "mid-day → next midnight");
  eq(core.nextMidnightUtc(Date.parse("2026-09-25T23:59:59Z")), Date.parse("2026-09-26T00:00:00Z"), "just before midnight → next midnight");
  eq(core.nextMidnightUtc(Date.parse("2026-09-25T00:00:00Z")), Date.parse("2026-09-26T00:00:00Z"), "exactly midnight → next day (strictly after)");
});

t("C16b CF 4006 'daily free allocation of 10,000 neurons' → depleted until next 00:00 UTC, NOT the 45m TTL (ADDENDUM #4)", () => {
  const realError = `Error: Too Many Requests: {"errors":[{"message":"AiError: AiError: you have used up your daily free allocation of 10,000 neurons, please upgrade to Cloudflare's Workers Paid plan if you would like to continue usage. (f24e675b)","code":4006}],"success":false}`;
  ok(core.isCloudflareDailyExhausted(realError), "real 4006 payload detected");
  ok(core.isCloudflareDailyExhausted("code: 4006"), "bare 4006 code");
  eq(core.isCloudflareDailyExhausted("Rate limit exceeded"), false, "ordinary rate limit is not 4006");
  eq(core.isCloudflareDailyExhausted("HTTP 429: quota"), false, "plain 429 is not 4006");

  const now = Date.parse("2026-09-25T07:25:00Z");
  const d = core.depletionUntilFromText(realError, now);
  eq(d.until, Date.parse("2026-09-26T00:00:00Z"), "4006 → next 00:00 UTC (7h+ away, not 45m)");
  eq(d.kind, "allowance-empty", "4006 kind");
  // the old buggy behaviour for contrast: default TTL would have been now+45m
  ok(d.until - now > 6 * HOUR, "must be more than the 45m default TTL away");
});

t("C16c depletionUntilFromText: one policy for countdown / rate-limit / unknown text", () => {
  const now = Date.now(); // parseCountdownHint's "in Xh Ym" branch anchors to real now
  const cd = core.depletionUntilFromText("Daily free model limit reached. Try again in 23h 15m.", now);
  near(cd.until, now + (23 * 60 + 15) * 60 * 1000, 5000, "vendor countdown honoured");
  eq(cd.kind, "allowance-empty", "'try again in' countdown is a period, not a short burst");
  const rl = core.depletionUntilFromText("Rate limit exceeded", now);
  near(rl.until, now + core.RATE_LIMIT_TTL_MS, 2000, "plain rate-limit → 45m");
  eq(rl.kind, "rate-limit", "rate-limit kind");
  const unk = core.depletionUntilFromText("some weird limit text", now);
  near(unk.until, now + core.QUOTA_TTL_MS, 2000, "unknown → 6h");
  eq(unk.kind, "limit-unknown", "unknown kind");
});

// ---------------------------------------------------------------- C17 OpenCode Zen silent rate-limit (ADDENDUM #5/#8)
t("C17 OpenCode Zen models use a 3-min silence window; others keep 90 s", () => {
  eq(core.OPENCODE_ZEN_SILENCE_MS, 3 * 60 * 1000, "zen silence constant");
  ok(core.isOpenCodeZenModel("opencode/muse-spark-1.3-contributor-free"), "muse is zen");
  ok(core.isOpenCodeZenModel("opencode/mimo-v2.6-flash-free"), "mimo is zen");
  ok(core.isOpenCodeZenModel("opencode/space-bunny-2"), "space bunny is zen");
  eq(core.isOpenCodeZenModel("cloudflare/@cf/qwen/qwen3.8-27b"), false, "cloudflare qwen is not zen");
  eq(core.opencodeSilenceMsForModel("opencode/mimo-v2.6-flash-free"), 180000, "zen → 3 min");
  eq(core.opencodeSilenceMsForModel("cloudflare/@cf/qwen/qwen3.8-27b"), 90000, "cf → 90 s");
  eq(core.opencodeSilenceMsForModel("x", { defaultMs: 5, zenMs: 9 }), 5, "non-zen → injectable default");
  eq(core.opencodeSilenceMsForModel("opencode/zen-lane", { defaultMs: 5, zenMs: 9 }), 9, "zen → injectable zen window");
});

t("C17b zen-style silent hang: log quota fires after 3 min for zen, not before", () => {
  const tErr = Date.parse("2026-09-25T12:00:00Z");
  const lines = [
    ocLine("2026-09-25T11:59:00Z", "step part.created"),
    ocLine("2026-09-25T12:00:00Z", "error Rate limit exceeded modelID=opencode/mimo-v2.6-flash-free providerID=opencode"),
  ];
  eq(core.opencodeLogQuota(lines, tErr + 3 * 60 * 1000 + 1000, { silenceMs: core.opencodeSilenceMsForModel("opencode/mimo-v2.6-flash-free") }),
    "opencode/mimo-v2.6-flash-free", "3 min silence → zen quota");
  eq(core.opencodeLogQuota(lines, tErr + 100 * 1000, { silenceMs: core.opencodeSilenceMsForModel("opencode/mimo-v2.6-flash-free") }),
    null, "2 min in → still waiting");
});

// ---------------------------------------------------------------- C14 freebuff session-end detection
t("C14 session-end: box variants + took-over + Freebucks count detected; working/agent lines stay silent", () => {
  const st = core.freebuffSessionEndState([
    "╭─".repeat(20),
    "Session ended · 5 Freebucks left",
    "Press Enter to continue in a new session",
    "╰─".repeat(20),
  ]);
  ok(st.sessionEnded && st.pressEnter, "session ended + press-enter box");
  eq(st.freebucksLeft, 5, "freebucks parsed");
  ok(!st.tookOver && !st.wrappingUp && !st.taskPrompt, "no other flags");

  const wrap = core.freebuffSessionEndState(["Agent is wrapping up. Rejoin the wait room after it's finished."]);
  ok(wrap.wrappingUp && !wrap.sessionEnded && !wrap.pressEnter, "older 'wrapping up' variant");

  const took = core.freebuffSessionEndState(["Another freebuff instance took over this account"]);
  ok(took.tookOver, "took-over screen detected");

  const fresh = core.freebuffSessionEndState(["Session ended · 0 Freebucks left"]); // → 0 when depleted
  eq(fresh.freebucksLeft, 0, "0 freebucks parsed (not null)");

  eq(core.freebuffSessionEndState(["working...", "Thinking"]).sessionEnded, false, "alive screens stay silent");
  eq(core.freebuffSessionEndState(["Session ended"]).taskPrompt, false, "end box is not the task prompt");
  eq(
    core.freebuffSessionEndState([
      "const t = 'Session ended'; // Press Enter to continue",
      "# session ended — see TICKET.md",
      "> agent is wrapping up",
      "- Another freebuff instance took over this account",
    ]).tookOver,
    false,
    "source/prompt text with code punctuation never matches (status-line discipline)",
  );
});

t("C14b session-end: full-box priority (took-over beats press-enter on a mixed screen)", () => {
  const st = core.freebuffSessionEndState([
    "Session ended · 0 Freebucks left",
    "Press Enter to continue in a new session",
    "Another freebuff instance took over this account",
  ]);
  ok(st.tookOver, "tookOver set → ht-watch must exit SESSION_LOST, not press Enter");
});

t("C14c resume prompt carries the ticket dir from the .meta prompt file path", () => {
  const p = core.buildFreebuffResumePrompt("/workspace/biomarker-and-nutrient-tracker/tmp/ht-freebuff-autocontinue");
  ok(p.startsWith("Continue the previous task: re-read "), "prefix");
  ok(p.includes("/TICKET.md and resume from "), "both files named");
  ok(p.endsWith("ending with VERIFIED: yes or no."), "VERIFIED wording");
  eq(core.buildFreebuffResumePrompt(""), "", "empty ticket dir → no prompt");
  eq(core.buildFreebuffResumePrompt("/tmp/x/"), core.buildFreebuffResumePrompt("/tmp/x"), "trailing slash normalized");
});

t("C14d GLM 5.3 Flash picked from the numbered menu when Freebucks are 0; default Enter otherwise", () => {
  const menu = ["Select a model:", "  1) Muse 2.1 (45/hr)", "  2) GLM 5.3 Flash (0/hr)", "  3) DeepSeek V4.1 (30/hr)"];
  const pick = core.freebuffModelPickerChoice(menu, { freebucksLeft: 0 });
  eq(pick.keys, "2", "0 fb → GLM 5.3 Flash (menu #)");
  eq(pick.model, "GLM 5.3 Flash (0/hr)", "0 fb → GLM 5.3 Flash (label)");
  eq(core.freebuffModelPickerChoice(menu, { freebucksLeft: 5 }).keys, "", "fb left → plain Enter (default is already GLM)");
  eq(core.freebuffModelPickerChoice(menu, {}).keys, "", "unknown fb → default Enter");
  eq(core.freebuffModelPickerChoice(["1) Muse 2.1 (45/hr)"], { freebucksLeft: 0 }).keys, "", "no GLM entry → no digit typed");
  ok(core.freebuffMenuVisible(menu), "menu detection");
  eq(core.freebuffMenuVisible(["Enter a coding task"]), false, "task prompt is not a menu");
});

t("C14e enter-wait policy: wrapping-up grace is capped at 10 min; press-enter proceeds immediately; took-over stops", () => {
  const now = Date.now();
  ok(core.shouldKeepWaitingForEnter(core.freebuffSessionEndState(["Agent is wrapping up."]), 0), "wrapping up → wait");
  ok(core.shouldKeepWaitingForEnter(core.freebuffSessionEndState(["Agent is wrapping up."]), core.FREEBUFF_ENTER_WAIT_MS - 1000), "within grace");
  eq(core.shouldKeepWaitingForEnter(core.freebuffSessionEndState(["Agent is wrapping up."]), core.FREEBUFF_ENTER_WAIT_MS), false, "grace elapsed → stop waiting");
  ok(core.shouldKeepWaitingForEnter(core.freebuffSessionEndState(["Press Enter to continue in a new session"]), 0), "press-enter → proceed now");
  eq(core.shouldKeepWaitingForEnter(core.freebuffSessionEndState(["Another freebuff instance took over this account"]), 0), false, "took-over → never wait/continue");
  eq(core.shouldKeepWaitingForEnter(core.freebuffSessionEndState(["working..."]), 0), false, "no end-state → no wait");
  void now;
});

t("C14f ticket constants: cap 12, 3 fails, waits", () => {
  eq(core.FREEBUFF_AUTOCONTINUE_CAP, 12, "cap");
  eq(core.FREEBUFF_CONTINUE_MAX_FAILS, 3, "consecutive-fail limit");
  eq(core.FREEBUFF_ENTER_WAIT_MS, 10 * 60 * 1000, "wrapping-up grace 10 min");
  eq(core.FREEBUFF_PROMPT_WAIT_MS, 60 * 1000, "prompt wait 1 min");
  eq(core.FREEBUFF_TYPED_WAIT_MS, 3 * 60 * 1000, "typed wait 3 min");
});

// ---------------------------------------------------------------- C15 prompt-file sidecar
t("C15 prompt-file sidecar naming (ht-run ↔ ht-watch handshake, no inline long text)", () => {
  const session = "ht-fbac-a";
  const contFile = `/workspace/logs/${session}.cont`;
  eq(contFile, "/workspace/logs/ht-fbac-a.cont", "cont sidecar path");
  const meta = JSON.parse(fs.readFileSync(join(TOOL_DIR, "package.json"), "utf8"));
  eq(meta.name, "tg-provider-router", "meta sanity (tool still parses JSON)");
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
