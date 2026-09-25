#!/usr/bin/env node
/**
 * Unit tests for Cline free-lane enrollment (src/cline-model-sync.js).
 *
 *   cd tools/telegram-provider-router && node scripts/test-cline-model-sync.mjs
 *
 * Covers the rules that keep enrollment honest: id normalization, DEAD-lane
 * refusal (promotion ended ≠ depleted), uncertain = no change, upsert keeps
 * pref, new lanes take maxPref+1, non-cline lanes untouched, no deletes.
 * Pure logic + the shared core's stamp; no Cline CLI, no network.
 */
import { createRequire } from "module";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL_DIR = join(HERE, "..");
const require = createRequire(import.meta.url);
const core = require(join(TOOL_DIR, "src", "allowance-watch-core.cjs"));
const mod = await import(pathToFileURL(join(TOOL_DIR, "src", "cline-model-sync.js")).href);
const { isClineDeadModel, normalizeClineModelId, prettifyClineLabel, planLaneUpsert, freeModelIdsFromCatalog, looksFreeId, CLINE_BUCKET } = mod;

let passed = 0;
const failures = [];
async function t(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  ✗ ${name}\n      ${e.message}`);
  }
}
function ok(c, m) {
  if (!c) throw new Error(m || "assertion failed");
}
function eq(a, b, m) {
  if (a !== b) throw new Error(`${m || "eq"}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
const table = () => ({
  buckets: {},
  lanes: [
    { pref: 2, provider: "cline", model: "cline-free/muse-spark-1.3-contributor", bucket: CLINE_BUCKET, status: "available" },
    { pref: 6, provider: "cline", model: "cline-free/deepseek-v4.1-flash", bucket: CLINE_BUCKET, status: "depleted" },
    { pref: 1, provider: "opencode", model: "opencode/muse-spark-1.3-contributor-free", bucket: "opencode-zen-free", status: "available" },
  ],
});
const probe = (status, output) => ({ status, output: String(output || "") });

await t("dead model text: promotion ended / unknown, not plain quota", () => {
  ok(isClineDeadModel("Free model promotion ended\nThe free promotion for this model has ended"), "promotion ended");
  ok(isClineDeadModel("no longer available"), "no longer available");
  ok(isClineDeadModel("error: invalid model format. Expected format: modelType/model"), "invalid format");
  ok(isClineDeadModel("model not found"), "model not found");
  eq(isClineDeadModel("Daily free model limit reached. Try again in 23h 15m"), false, "quota is NOT dead");
  eq(isClineDeadModel("Rate limit exceeded"), false, "429 is NOT dead");
  eq(isClineDeadModel("OK"), false, "ok is NOT dead");
});

await t("normalizeClineModelId: bare name gets cline-free/, invalid dropped", () => {
  eq(normalizeClineModelId("muse-spark-1.3-contributor"), "cline-free/muse-spark-1.3-contributor", "bare → prefixed");
  eq(normalizeClineModelId("cline-free/glm-5.3-flash"), "cline-free/glm-5.3-flash", "already full");
  eq(normalizeClineModelId(" a/b/c "), "", "two slashes → invalid");
  eq(normalizeClineModelId(""), "", "empty");
  eq(normalizeClineModelId("has space/name"), "", "whitespace in id → invalid");
});

await t("prettifyClineLabel strips provider + free suffix", () => {
  eq(prettifyClineLabel("cline-free/deepseek-v4.1-flash"), "deepseek v4.1 flash free", "label");
  eq(prettifyClineLabel("cline-free/muse-spark-1.3-contributor"), "muse spark 1.3 free", "contributor stripped");
});

await t("DEAD lane never enrolls (the promotion-ended class)", () => {
  const t0 = table();
  const p = planLaneUpsert(t0, { model: "cline-free/glm-5.3-flash", probe: probe("available", "Free model promotion ended") });
  eq(p.action, "skip-dead", "skip-dead even with clean exit");
  eq(p.index, -1, "no target");
  ok(!t0.lanes.some((l) => l.model === "cline-free/glm-5.3-flash"), "not added to table");
});

await t("uncertain probe changes nothing (no false depletion/revival)", () => {
  const t0 = table();
  const before = JSON.stringify(t0.lanes[1]);
  const p = planLaneUpsert(t0, { model: "deepseek-v4.1-flash", probe: probe("uncertain", "timeout") });
  eq(p.action, "skip-uncertain", "skip");
  eq(p.index, 1, "existing lane index found");
  eq(JSON.stringify(t0.lanes[1]), before, "lane untouched");
});

await t("existing lane upsert keeps pref and matches by tail", () => {
  const t0 = table();
  const p = planLaneUpsert(t0, { model: "muse-spark-1.3-contributor", probe: probe("available", "OK") });
  eq(p.action, "update", "update");
  eq(p.index, 0, "index 0 (tail match, no provider prefix in input)");
  eq(p.lane.pref, 2, "pref preserved");
  eq(t0.lanes.length, 3, "no new lane appended");
});

await t("new lane takes maxPref+1 on the per-model bucket", () => {
  const t0 = table();
  const p = planLaneUpsert(t0, { model: "newmodel-v9", probe: probe("available", "OK") });
  eq(p.action, "new", "new");
  eq(p.index, -1, "no existing index");
  eq(p.lane.pref, 7, "maxPref+1 (existing max 6)");
  eq(p.lane.provider, "cline", "provider");
  eq(p.lane.model, "cline-free/newmodel-v9", "normalized id");
  eq(p.lane.bucket, CLINE_BUCKET, "per-model bucket");
  eq(p.lane.status, "available", "starts available");
  eq(t0.lanes.length, 3, "planner does not mutate the table");
});

await t("enroll+depleted stamp: countdown honoured, ledger gets a live quota rec", () => {
  const t0 = table();
  const session = { quota: {} };
  const p = planLaneUpsert(t0, {
    model: "newmodel-v9",
    probe: probe("depleted", "Daily free model limit reached. Try again in 23h 15m"),
  });
  eq(p.action, "new", "new + depleted");
  t0.lanes.push(p.lane);
  const dep = core.depletionUntilFromText(probe("depleted", "Daily free model limit reached. Try again in 23h 15m").output);
  core.stampDepleted(t0, session, [p.lane], null, { until: dep.until, hint: dep.hint, kind: dep.kind, lastError: "x", source: "t" });
  eq(p.lane.status, "depleted", "lane depleted");
  ok(Date.parse(p.lane.nextResetAt) > Date.now() + 20 * 3600 * 1000, "reset ~23h out, not 45m");
  ok(session.quota["cline/cline-free/newmodel-v9"], "per-model session quota rec (siblings stay available)");
  const muse = t0.lanes[0];
  eq(muse.status, "available", "sibling lane untouched (per-model scope)");
});

await t("update+depleted on an existing lane keeps pref and siblings available", () => {
  const t0 = table();
  const session = { quota: {} };
  const p = planLaneUpsert(t0, { model: "muse-spark-1.3-contributor", probe: probe("depleted", "Rate limit exceeded") });
  eq(p.action, "update", "update");
  const dep = core.depletionUntilFromText("Rate limit exceeded");
  core.stampDepleted(t0, session, [p.lane], null, { until: dep.until, hint: "", kind: dep.kind, lastError: "Rate limit exceeded", source: "t" });
  eq(p.lane.pref, 2, "pref still 2");
  eq(p.lane.status, "depleted", "depleted");
  eq(t0.lanes[2].status, "available", "opencode lane never touched");
});

await t("cross-provider tail collision: a Cline id never matches the Token Harbor lane", () => {
  const t0 = table(); // pref 1 opencode muse, pref 6 cline deepseek
  t0.lanes.push({ pref: 5, provider: "tokenharbor", model: "tokenharbor/muse-spark-1.3-contributor:free", bucket: "tokenharbor-free", status: "depleted" });
  t0.lanes.push({ pref: 3, provider: "tokenharbor", model: "tokenharbor/deepseek-v4.1-flash:free", bucket: "tokenharbor-free", status: "depleted" });
  // Same tails, different provider: the Cline lane must win, TH untouched.
  const p1 = planLaneUpsert(t0, { model: "cline-free/muse-spark-1.3-contributor", probe: probe("available", "OK") });
  eq(p1.index, 0, "matched the Cline lane (pref 2), not TH pref 5");
  eq(p1.lane.provider, "cline", "provider cline");
  const p2 = planLaneUpsert(t0, { model: "cline-free/deepseek-v4.1-flash", probe: probe("available", "OK") });
  eq(p2.index, 1, "matched the Cline deepseek lane (pref 6), not TH pref 3");
  eq(p2.lane.provider, "cline", "provider cline");
  // A model only TH has must enroll as a NEW Cline lane, never hijack TH.
  const p3 = planLaneUpsert(t0, { model: "mimo-v2.6-flash", probe: probe("available", "OK") });
  eq(p3.action, "new", "new Cline lane");
  eq(p3.lane.provider, "cline", "provider cline");
  eq(t0.lanes.filter((l) => l.provider === "tokenharbor").length, 2, "TH lanes never removed/reused");
});

await t("catalog: free set parsed, ids kept verbatim (incl. non-'free' modelType)", () => {
  // Real 2026-09-25 payload shape. Note `stealth/space-bunny-alpha` is a FREE
  // lane whose modelType has no "free" — the catalog is the authority.
  const payload = {
    free: [
      { id: "stealth/space-bunny-alpha", name: "space-bunny-alpha", description: "Blazing-fast inference with 1M context" },
      { id: "cline-free/mimo-v2.6-flash", name: "Mimo V2.6 Flash" },
      { id: "cline-free/deepseek-v4.1-flash", name: "Deepseek-v4.1-Flash" },
      { id: "cline-free/gemini-3.8-flash", name: "Gemini 3.8 Flash" },
      { id: "cline-free/muse-spark-1.3-contributor", name: "Muse Spark 1.3 Contributor" },
    ],
    recommended: [{ id: "grok-4.7", name: "grok-4.7 NEW" }],
  };
  const out = freeModelIdsFromCatalog(payload);
  eq(out.length, 5, "5 free models");
  eq(out[0].id, "stealth/space-bunny-alpha", "non-'free' modelType kept verbatim");
  eq(out[3].id, "cline-free/gemini-3.8-flash", "gemini free id");
  ok(!out.some((m) => m.id === "grok-4.7"), "recommended (paid) list NOT enrolled");
  eq(freeModelIdsFromCatalog({}).length, 0, "empty payload → no candidates");
  eq(freeModelIdsFromCatalog(null).length, 0, "null payload → no candidates");
  eq(looksFreeId("stealth/space-bunny-alpha"), false, "name guard says not-free (hence catalog mode)");
  eq(looksFreeId("cline-free/gemini-3.8-flash"), true, "cline-free passes the manual guard");
});

console.log("");
if (failures.length) {
  console.log(`FAIL: ${failures.length} of ${passed + failures.length} checks failed`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`PASS: all ${passed} checks passed`);
process.exit(0);
