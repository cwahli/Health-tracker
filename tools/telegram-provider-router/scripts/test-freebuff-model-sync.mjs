#!/usr/bin/env node
/**
 * Unit tests for the Freebuff catalog sync (src/freebuff-model-sync.js) and the
 * price/label rules the router renders.
 *
 *   cd tools/telegram-provider-router && node scripts/test-freebuff-model-sync.mjs
 *
 * Guards the corrections found on live data 2026-09-25:
 * - the Freebucks POOL (/api/v1/freebuff/session) is not the wallet
 *   (/api/v1/usage) — the wallet read 0 and made Freebuff look empty;
 * - only stealth/space-bunny-alpha is 0 FB (GLM 5.3 is 5; xiaomi/mimo-v2.6-flash
 *   is not published; deepseek-v4.1-flash is not published);
 * - plan-required ids are never offered as free lanes; stale ids are reported,
 *   never silently deleted; existing lane status is preserved.
 * Pure logic — no network, no CLI, no ledger writes.
 */
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL_DIR = join(HERE, "..");
const mod = await import(pathToFileURL(join(TOOL_DIR, "src", "freebuff-model-sync.js")).href);
const { parseFreebuffCatalog, defaultFreebuffModelId, freebuffModelLabel, planFreebuffUpserts, FREEBUFF_BUCKET } = mod;

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

// Real 2026-09-25 /api/v1/freebuff/session payload (trimmed to what we read).
const SESSION = {
  status: "none",
  accessTier: "limited",
  countryBlockReason: "recent_limited_country",
  freebucks: {
    balance: 10,
    daily: { limit: 25, spent: 15, remaining: 10, resetAt: "2026-09-25T17:00:00.000Z", resetTimeZone: "Asia/Jakarta" },
    wallet: { balance: 0, monthlyBonus: 0 },
    prices: {
      "stealth/space-bunny-alpha": 0,
      "z-ai/glm-5.3-flash": 5,
      "upstage/solar-mini4": 5,
      "crof/kimi-k3-eco": 5,
      "mimo/mimo-v2.5": 10,
      "upstage/solar-pro4": 10,
      "deepseek/deepseek-v4-flash": 15,
      "meta/muse-spark-1.3-contributor": 15,
      "openai/gpt-6-luna": 20,
      "google/gemini-3.8-flash": 80,
    },
    priceNotices: { "upstage/solar-pro4": "Limited-time trial" },
    planRequiredModelIds: ["openai/gpt-6-luna", "google/gemini-3.8-flash"],
    offPeak: { "deepseek/deepseek-v4-flash": { startHourUtc: 22, endHourUtc: 6, price: 10, regularPrice: 15 } },
  },
  rateLimitsByModel: {
    "deepseek/deepseek-v4-flash": { limit: 6, resetAt: "2026-09-26T07:00:00.000Z" },
    "mimo/mimo-v2.5": { limit: 6, resetAt: "2026-09-26T07:00:00.000Z" },
  },
};

await t("catalog parse: pool comes from freebucks.daily, NOT the wallet", () => {
  const c = parseFreebuffCatalog(SESSION);
  eq(c.pool.dailyRemaining, 10, "pool remaining");
  eq(c.pool.dailyLimit, 25, "pool limit");
  eq(c.pool.walletBalance, 0, "wallet is separate and 0");
  ok(c.pool.resetAt, "pool resetAt present");
  eq(c.accessTier, "limited", "tier");
  eq(c.countryBlockReason, "recent_limited_country", "country note kept");
});

await t("catalog parse: price, caps, notices, plan-required attached per model", () => {
  const c = parseFreebuffCatalog(SESSION);
  const by = Object.fromEntries(c.models.map((m) => [m.id, m]));
  eq(by["stealth/space-bunny-alpha"].priceFreebucks, 0, "space bunny is 0 FB");
  eq(by["z-ai/glm-5.3-flash"].priceFreebucks, 5, "GLM 5.3 is 5 FB (not 0)");
  eq(by["upstage/solar-pro4"].notice, "Limited-time trial", "notice");
  eq(by["deepseek/deepseek-v4-flash"].dailyLimit, 6, "daily cap");
  eq(by["deepseek/deepseek-v4-flash"].offPeak.price, 10, "off-peak price");
  eq(by["openai/gpt-6-luna"].planRequired, true, "gpt-6 needs a plan");
  eq(by["google/gemini-3.8-flash"].planRequired, true, "gemini needs a plan");
  eq(c.models[0].id, "stealth/space-bunny-alpha", "cheapest (0 FB) sorts first");
});

await t("default lane is the 0-FB model, never a plan-required one", () => {
  const c = parseFreebuffCatalog(SESSION);
  eq(defaultFreebuffModelId(c), "stealth/space-bunny-alpha", "0-FB default");
  const allPaid = parseFreebuffCatalog({ freebucks: { prices: { "openai/gpt-6-luna": 20 }, planRequiredModelIds: ["openai/gpt-6-luna"] } });
  eq(defaultFreebuffModelId(allPaid), "", "no usable default when all need a plan");
});

await t("labels show the true price; only 0 reads as free", () => {
  eq(freebuffModelLabel({ id: "stealth/space-bunny-alpha", priceFreebucks: 0 }), "Space bunny alpha · free · 0 FB", "0 FB");
  eq(freebuffModelLabel({ id: "z-ai/glm-5.3-flash", priceFreebucks: 5 }), "Glm 5.3 flash · 5 FB", "5 FB");
  eq(
    freebuffModelLabel({ id: "upstage/solar-pro4", priceFreebucks: 10, notice: "Limited-time trial" }),
    "Solar pro4 · 10 FB · Limited-time trial",
    "notice appended"
  );
  ok(!/0\/hr/.test(freebuffModelLabel({ id: "z-ai/glm-5.3-flash", priceFreebucks: 5 })), "no 0/hr lie");
});

await t("plan: new lanes enrolled with price+cap, plan-required skipped, status untouched", () => {
  const table = { lanes: [{ pref: 17, provider: "freebuff", model: "deepseek/deepseek-v4.1-flash", bucket: FREEBUFF_BUCKET, status: "available" }] };
  const c = parseFreebuffCatalog(SESSION);
  const p = planFreebuffUpserts(table, c);
  const ids = p.enroll.map((e) => e.lane.model);
  ok(!ids.includes("openai/gpt-6-luna"), "plan-required never enrolled");
  ok(!ids.includes("google/gemini-3.8-flash"), "plan-required never enrolled (2)");
  eq(p.skipped.length, 2, "two skips reported");
  const bunny = p.enroll.find((e) => e.lane.model === "stealth/space-bunny-alpha");
  eq(bunny.lane.priceFreebucks, 0, "price stored on lane");
  eq(bunny.lane.status, "available", "new lane available");
  eq(bunny.lane.bucket, FREEBUFF_BUCKET, "shared Freebucks bucket");
  const ds = p.enroll.find((e) => e.lane.model === "deepseek/deepseek-v4-flash");
  eq(ds.lane.dailyLimit, 6, "daily cap stored");
  eq(table.lanes.length, 1, "planner does not mutate the table");
});

await t("plan: existing lane updates in place, keeps pref AND status (watcher owns availability)", () => {
  const table = {
    lanes: [
      { pref: 24, provider: "freebuff", model: "z-ai/glm-5.3-flash", bucket: FREEBUFF_BUCKET, status: "depleted", nextResetAt: "2099-01-01T00:00:00Z" },
    ],
  };
  const c = parseFreebuffCatalog(SESSION);
  const p = planFreebuffUpserts(table, c);
  const e = p.enroll.find((x) => x.lane.model === "z-ai/glm-5.3-flash");
  eq(e.action, "update", "update not new");
  eq(e.lane.pref, 24, "pref preserved");
  eq(e.lane.status, "depleted", "depleted status NOT reset by a catalog sync");
  eq(table.lanes.length, 1, "no duplicate lane");
});

await t("plan: unpublished ids reported STALE, never deleted", () => {
  const table = {
    lanes: [
      { pref: 17, provider: "freebuff", model: "deepseek/deepseek-v4.1-flash", status: "available" },
      { pref: 18, provider: "freebuff", model: "xiaomi/mimo-v2.6-flash", status: "available" },
    ],
  };
  const c = parseFreebuffCatalog(SESSION);
  const p = planFreebuffUpserts(table, c);
  eq(p.stale.length, 2, "both unpublished ids reported");
  ok(p.stale.some((s) => s.id === "xiaomi/mimo-v2.6-flash"), "mimo v2.6 flash stale");
  ok(p.stale.every((s) => typeof s.pref === "number"), "stale rows carry pref for the operator");
  eq(table.lanes.length, 2, "planner never removes lanes");
});

console.log("");
if (failures.length) {
  console.log(`FAIL: ${failures.length} of ${passed + failures.length} checks failed`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`PASS: all ${passed} checks passed`);
process.exit(0);
