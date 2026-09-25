#!/usr/bin/env node
/**
 * Smoke: /freemodel is a short header + unique buttons only.
 *
 *   cd tools/telegram-provider-router && node scripts/test-freemodel-buttons.mjs
 *
 * Covers the 2026-09-25 ticket HT-FREEMODEL-ZEN-FB-OFFER:
 *   - a shared OpenCode Zen cool-off marks ❌ on EVERY Zen freemodel button
 *     (muse/mimo/…), not only the lane that hit the limit (A)
 *   - Freebuff taps: GLM 5.3 Flash (0/hr) + MiMo 2.6 Flash (0/hr) + DeepSeek
 *     V4.1 Flash (5/hr), terminal-only on pick, ❌ only when depleted (B)
 *   - button labels are NOT padded with spaces: Telegram centers button text
 *     and has no align; the header says so honestly (D)
 *   - Cline lanes marked unavailable/ended in the ledger never look healthy (E)
 *
 * Also keeps the 2026-09-24 HT-FREEMODEL-BUTTONS-ONLY contract:
 *   - body has NO per-model text list (buttons only + a Total line)
 *   - Token Harbor chat + OpenCode `tokenharbor/…` collapse to ONE button
 *     (the OpenCode tools path wins)
 *
 * Runs src/index.js in import mode (TG_ROUTER_NO_START=1) with a throwaway
 * state dir, so the live session/quota/table and the single Telegram poller are
 * never touched. No network.
 */
import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL_DIR = join(HERE, "..");
const SRC = join(TOOL_DIR, "src", "index.js");

const MIN = 60 * 1000;
const now = Date.now();
const isoZ = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
// Real published Freebuff ids (GET /api/v1/freebuff/session -> freebucks.prices).
// xiaomi/mimo-v2.6-flash and deepseek-v4.1-flash are NOT published — they were
// fixtures from before the catalog existed.
const FB_MODEL = "deepseek/deepseek-v4-flash";
const FB_GLM = "z-ai/glm-5.3-flash";
const FB_MIMO = "mimo/mimo-v2.5";
const FB_BUNNY = "stealth/space-bunny-alpha";
const ZEN_UNTIL = now + 45 * MIN;

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

/** Free-lane table holding the Freebuff lane so depletion can be exercised. */
function buildTable({ freebuffDepleted = false, clineGlmUnavailable = false } = {}) {
  return {
    version: 3,
    updatedAt: isoZ(now),
    failover: "same-family first (skip depleted), then next available by pref #",
    buckets: {
      "freebuff-freebucks": { scope: "shared", resetRule: "shared daily Freebucks" },
      "cline-per-model": { scope: "per-model", resetRule: "per-model daily (Cline UI)" },
    },
    lanes: [
      lane(15, "glm-5.3-flash", "cline", "cline-free/glm-5.3-flash", "Cline GLM 5.3 Flash free", "cline-per-model", {
        ...(clineGlmUnavailable ? { status: "unavailable", notes: "GLM 5.3 free promo ended" } : {}),
      }),
      lane(17, "deepseek-v4-flash", "freebuff", FB_MODEL, "Freebuff DeepSeek v4 Flash", "freebuff-freebucks", {
        tg: false,
        notes: "terminal-only",
        ...(freebuffDepleted
          ? {
              status: "depleted",
              nextResetAt: isoZ(now + 3 * 60 * MIN),
              cooldownUntil: isoZ(now + 3 * 60 * MIN),
              nextReset: isoZ(now + 3 * 60 * MIN),
            }
          : {}),
      }),
    ],
  };
}

const FIXTURE_SESSION = {
  provider: "opencode",
  models: {
    opencode: "opencode/muse-spark-1.3-contributor-free",
    tokenharbor: "deepseek-v4.1-flash:free",
    freebuff: FB_MODEL,
  },
  quota: {},
};

// ---- fixtures before importing the router (loadState reads the state dir) ----
const stateDir = mkdtempSync(join(tmpdir(), "ht-freemodel-buttons-"));
const TABLE_PATH = join(stateDir, "free-lane-table.json");
const SESSION_PATH = join(stateDir, "session.json");
writeFileSync(TABLE_PATH, JSON.stringify(buildTable(), null, 2));
writeFileSync(SESSION_PATH, JSON.stringify(FIXTURE_SESSION, null, 2));

process.env.TG_ROUTER_NO_START = "1";
process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "123:TEST";
process.env.TELEGRAM_USER_ID = process.env.TELEGRAM_USER_ID || "1";
process.env.TG_ROUTER_STATE_DIR = stateDir;
process.env.TOKEN_HARBOR_API_KEY = "";

let mod;
try {
  mod = await import(pathToFileURL(SRC).href);
} catch (e) {
  console.error(`Cannot import the router module: ${e.message}`);
  console.error("If this is a missing dependency, run: npm install  (inside tools/telegram-provider-router)");
  process.exit(2);
}

const {
  FREEMODEL_HEADER,
  FREEMODEL_BUTTON_WIDTH,
  leftishButtonLabel,
  dedupeFreemodelItems,
  buildFreemodelReply,
  applyFreeModelPick,
  probeFreebuffFree,
  freeModelDepletion,
  allFreeLanesDepletedMessage,
  availableClineKnownLanes,
} = mod;

let failed = 0;
const check = (name, cond, extra = "") => {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failed += 1;
    console.error(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
  }
};
const flatten = (keyboard) =>
  (keyboard?.inline_keyboard || [])
    .flat()
    .filter(Boolean)
    .map((b) => ({ text: b.text, data: b.callback_data }));

console.log(`freemodel buttons (state dir: ${stateDir})`);

// ---- L) label helper: cap only, NO fake space pad ---------------------------
check("L1 labels are not right-padded (Telegram centers text; pad was fake align)", leftishButtonLabel("hi", 10) === "hi", JSON.stringify(leftishButtonLabel("hi", 10)));
check("L2 default cap is the Telegram 64-char button limit", FREEMODEL_BUTTON_WIDTH === 64, String(FREEMODEL_BUTTON_WIDTH));
check("L3 labels never exceed the 64-char Telegram cap", leftishButtonLabel("x".repeat(120)).length === 64, String(leftishButtonLabel("x".repeat(120)).length));

// ---- probe fixtures (no network) -------------------------------------------
const TH_TOOLS = { id: "tokenharbor/mimo-v2.6-flash:free", label: "mimo v2.6 flash free (th)" };
const TH_CHAT = { id: "mimo-v2.6-flash:free", label: "mimo v2.6 flash free" };
const results = () => [
  ["opencode", { ok: true, reason: "", items: [
    { id: "opencode/muse-spark-1.3-contributor-free", label: "muse spark 1.3 free" },
    { id: "opencode/mimo-v2.6-flash-free", label: "mimo v2.6 flash free" },
    { id: "opencode/space-bunny-free", label: "Space Bunny" },
    { id: "cloudflare/@cf/qwen/qwen3.8-27b", label: "cf qwen3.8 27b" },
    TH_TOOLS,
  ] }],
  ["cline", { ok: false, reason: "Cline not signed in", items: [] }],
  ["tokenharbor", { ok: true, reason: "", items: [
    TH_CHAT,
    { id: "deepseek-v4.1-flash:free", label: "deepseek v4.1 flash free" },
  ] }],
  ["freebuff", { ok: true, reason: "", items: [
    { id: FB_BUNNY, label: "Space bunny alpha · free · 0 FB" },
    { id: FB_GLM, label: "Glm 5.3 flash · 5 FB" },
    { id: FB_MIMO, label: "Mimo 2.5 · 10 FB" },
    { id: FB_MODEL, label: "Deepseek v4 flash · 15 FB" },
  ] }],
  ["commandcode", { ok: false, reason: "Command Code signed in but out of credits", items: [] }],
];

// ---- D) dedupe --------------------------------------------------------------
const deduped = dedupeFreemodelItems(results());
const thRoutes = [];
for (const [key, res] of deduped) {
  for (const item of res.items) {
    if (key === "tokenharbor" || String(item.id).startsWith("tokenharbor/")) thRoutes.push({ key, id: item.id });
  }
}
check("D1 TH chat + OpenCode TH twin collapse to one row", thRoutes.length === 2, JSON.stringify(thRoutes));
check("D2 the surviving MiMo TH row is the OpenCode tools path", thRoutes.some((r) => r.key === "opencode" && r.id === TH_TOOLS.id), JSON.stringify(thRoutes));
check("D3 the chat-only MiMo TH twin is dropped", !thRoutes.some((r) => r.key === "tokenharbor" && r.id === TH_CHAT.id), JSON.stringify(thRoutes));
check("D4 distinct TH models are NOT collapsed", thRoutes.some((r) => r.id === "deepseek-v4.1-flash:free"), JSON.stringify(thRoutes));

// ---- B) body + keyboard -----------------------------------------------------
const reply = buildFreemodelReply(results(), now);
const buttons = flatten(reply.keyboard);
const bodyLines = reply.text.split("\n");
// Derived, not hardcoded: the Freebuff tap count follows the ledger/catalog,
// which changes as Cline/Freebuff publish models. Pin the invariant (every
// deduped lane is counted once) instead of a magic number.
const EXPECTED_LANES = results().reduce((n, [, res]) => n + (res?.ok ? res.items.length : 0), 0) - 1; // -1: TH twin deduped
check("B1 total counts every deduped lane exactly once", reply.total === EXPECTED_LANES, `total=${reply.total} expected=${EXPECTED_LANES}`);
check("B2 body has no per-model text lines (no backticked model ids)", !reply.text.includes("`"), reply.text);
check("B3 body has no per-model dump (no muse/mimo/deepseek id text)", !/muse-spark|mimo-v2\.6|deepseek-v4/i.test(reply.text), reply.text);
check("B4 body has a single Total line", bodyLines.filter((l) => /^Total: /.test(l)).length === 1, reply.text);
check("B5 header is short (<= 6 lines before Total)", FREEMODEL_HEADER.length <= 6, String(FREEMODEL_HEADER.length));
check("B6 'Not available' is one footer line for Cline + Command Code", bodyLines.filter((l) => /^Not available: /.test(l)).length === 1 && /Cline/.test(reply.text) && /Command Code/.test(reply.text), reply.text);
check("B7 no provider section headers remain in the body", !bodyLines.some((l) => /^(OpenCode|Cline|Token Harbor|Freebuff)$/.test(l.trim())), reply.text);

// ---- K) buttons -------------------------------------------------------------
check("K1 one button per deduped lane plus Cancel", buttons.length === EXPECTED_LANES + 1, `${buttons.length} vs ${EXPECTED_LANES + 1}`);
check("K2 every label is unique (no TH twin duplicate)", new Set(buttons.map((b) => b.text)).size === buttons.length, JSON.stringify(buttons.map((b) => b.text)));
check("K3 labels are NOT space-padded", buttons.every((b) => b.text === b.text.trimEnd()), JSON.stringify(buttons.map((b) => JSON.stringify(b.text))));
check("K4 Freebuff taps are price-ordered, cheapest (0 FB) first", (() => {
  const fb = buttons.map((b) => b.text.trimEnd()).filter((l) => l.startsWith("Freebuff: "));
  const expected = results().find(([k]) => k === "freebuff")[1].items.map((i) => `Freebuff: ${i.label}`);
  return JSON.stringify(fb) === JSON.stringify(expected) && /free · 0 FB/.test(fb[0] || "");
})(), JSON.stringify(buttons.map((b) => b.text.trimEnd())));
check("K5 the surviving TH button is tagged as the tools path", buttons.some((b) => /^TH tools: /.test(b.text.trimEnd())), JSON.stringify(buttons.map((b) => b.text.trimEnd())));
check("K6 Cancel is present", buttons.some((b) => /^Cancel/.test(b.text.trimEnd())), JSON.stringify(buttons.map((b) => b.text.trimEnd())));
check("K7 every Freebuff tap has a walk-map callback", zenButtonsFree(buttons) === results().find(([k]) => k === "freebuff")[1].items.length, String(zenButtonsFree(buttons)));
check("K8 Space Bunny appears in the /freemodel button list", buttons.some((b) => b.text.trimEnd() === "OpenCode: Space Bunny"), JSON.stringify(buttons.map((b) => b.text.trimEnd())));
function zenButtonsFree(bs) {
  return bs.filter((b) => b.text.trimEnd().startsWith("Freebuff: ") && /^fm/.test(b.data)).length;
}

// ---- D) header honesty ------------------------------------------------------
const header = FREEMODEL_HEADER.join("\n");
check("H1 header admits Telegram centers button text (no API align)", /Telegram centers button text \(no API align\)/.test(header), header);
check("H2 header no longer implies a left-align pad", !/left/i.test(header), header);
check("H3 header keeps the depleted/auto-failover contract", /Depleted lanes are marked/i.test(header) && /auto-failover announces switches/i.test(header), header);

// ---- X) freebuff depletion mark --------------------------------------------
check("X1 freebuff lanes start available (no ❌)", freeModelDepletion("freebuff", FB_MODEL, now) === null && freeModelDepletion("freebuff", FB_GLM, now) === null, "");
writeFileSync(TABLE_PATH, JSON.stringify(buildTable({ freebuffDepleted: true }), null, 2));
const depReply = buildFreemodelReply(results(), now);
const depButtons = flatten(depReply.keyboard).map((b) => b.text.trimEnd());
check("X2 a depleted Freebuff lane is marked ❌ and stays tappable", depButtons.some((l) => /^❌ Freebuff: /.test(l)), JSON.stringify(depButtons));
check("X3 depletion is reflected in the Total line", new RegExp(`Total: ${EXPECTED_LANES} · 1 depleted ❌`).test(depReply.text), depReply.text);
writeFileSync(TABLE_PATH, JSON.stringify(buildTable(), null, 2));

// ---- S) selection: Freebuff = terminal-only reply, never a hard error -------
for (const [tag, mid, nameRe] of [
  ["GLM", FB_GLM, /Glm 5\.3 flash/i],
  ["MiMo", FB_MIMO, /Mimo v?2\.5/i],
  ["DeepSeek", FB_MODEL, /Deepseek v4 flash/i],
]) {
  let pickMsg = "";
  let pickErr = null;
  try {
    pickMsg = applyFreeModelPick("freebuff", mid);
  } catch (e) {
    pickErr = e;
  }
  check(`S1-${tag} selecting Freebuff ${mid} does not throw`, !pickErr, pickErr?.message);
  check(`S2-${tag} the reply says terminal-only (no Telegram chat lane)`, /terminal-only/i.test(pickMsg) && /no Telegram chat lane/i.test(pickMsg), pickMsg);
  check(`S3-${tag} the reply names the chosen model id + label`, pickMsg.includes(mid) && nameRe.test(pickMsg), pickMsg);
  check(`S4-${tag} the reply tells the user how to run it on the box`, /`freebuff`/.test(pickMsg), pickMsg);
  check(`S5-${tag} the active Telegram route is not switched`, /Nothing was switched/.test(pickMsg) && /still go to/.test(pickMsg), pickMsg);
}

// ---- P) probeFreebuffFree signed-in seam ------------------------------------
const credsDir = mkdtempSync(join(tmpdir(), "ht-freebuff-creds-"));
const goodCreds = join(credsDir, "credentials.json");
writeFileSync(goodCreds, JSON.stringify({ default: { authToken: "test-not-a-real-secret" } }, null, 2));
const signedProbe = await probeFreebuffFree(goodCreds);
check("P1 signed-in probe offers catalog lanes, cheapest (0 FB) first", signedProbe.ok === true && signedProbe.items.length >= 3 && signedProbe.items[0].id === FB_BUNNY, JSON.stringify(signedProbe));
check("P1b no unpublished Freebuff id is offered", !signedProbe.items.some((i) => /xiaomi\//.test(i.id) || /v4\.1-flash/.test(i.id)), JSON.stringify(signedProbe.items.map((i) => i.id)));
check("P2 labels carry true Freebucks prices (no 0/hr lies)", signedProbe.items[0].label.includes("free · 0 FB") && signedProbe.items.some((i) => /· 5 FB$/.test(i.label)) && !signedProbe.items.some((i) => /0\/hr/.test(i.label)), JSON.stringify(signedProbe.items.map((i) => i.label)));
const unsignedProbe = await probeFreebuffFree(join(credsDir, "missing.json"));
check("P3 unsigned probe returns ok:false with a sign-in reason (footer line)", unsignedProbe.ok === false && unsignedProbe.items.length === 0 && /sign/i.test(unsignedProbe.reason), JSON.stringify(unsignedProbe));

// ---- C) all-TG-depleted Stop offers Freebuff terminal -----------------------
const stopMsg = allFreeLanesDepletedMessage("opencode", "opencode/mimo-v2.6-flash-free");
const fbSignedIn = mod.freebuffCredsOk();
check("C1 the all-depleted Stop says Telegram chat lanes are empty", /All free Telegram chat lanes are depleted/i.test(stopMsg), stopMsg);
check("C2 the Stop offers Freebuff terminal work (signed-in variant names real, priced models)",
  fbSignedIn
    ? /Freebuff is still usable in the terminal/i.test(stopMsg)
      && /free · 0 FB/.test(stopMsg)                       // cheapest lane named, priced
      && /· [0-9]+ FB/.test(stopMsg)                        // real Freebucks prices
      && !/0\/hr/.test(stopMsg)                             // no stale "0/hr" claim
      && !/xiaomi\//.test(stopMsg) && !/v4\.1-flash/.test(stopMsg) // no unpublished ids
    : /Freebuff.*terminal/i.test(stopMsg) && /not signed in/i.test(stopMsg),
  stopMsg);
check("C3 the Stop does not claim everything is dead", !/everything is dead/i.test(stopMsg), stopMsg);
check("C4 the Stop keeps the reset hint contract (soonest reset or /allowance)", /Soonest Reset in:|Check \/allowance/.test(stopMsg), stopMsg);

// ---- B7) Freebuff taps come from the ledger with TRUE prices -----------------
// Live corrections 2026-09-25: only stealth/space-bunny-alpha is 0 Freebucks
// (GLM 5.3 is 5), and xiaomi/mimo-v2.6-flash / deepseek-v4.1-flash are not in
// the published catalog at all. The old hardcoded 3 taps lied about all of it.
const fbTable = { lanes: [
  { pref: 21, provider: "freebuff", model: "stealth/space-bunny-alpha", bucket: "freebuff-freebucks", status: "available", priceFreebucks: 0 },
  { pref: 24, provider: "freebuff", model: "z-ai/glm-5.3-flash", bucket: "freebuff-freebucks", status: "available", priceFreebucks: 5 },
  { pref: 27, provider: "freebuff", model: "deepseek/deepseek-v4-flash", bucket: "freebuff-freebucks", status: "available", priceFreebucks: 15 },
  { pref: 30, provider: "freebuff", model: "openai/gpt-6-luna", bucket: "freebuff-freebucks", status: "available", priceFreebucks: 20, planRequired: true },
  { pref: 17, provider: "freebuff", model: "deepseek/deepseek-v4.1-flash", bucket: "freebuff-freebucks", status: "unavailable" },
] };
const fbLanes = mod.availableFreebuffLanes(fbTable);
check("B7 ledger Freebuff lanes are offered", fbLanes.some((k) => k.id === "stealth/space-bunny-alpha") && fbLanes.some((k) => k.id === "z-ai/glm-5.3-flash"), JSON.stringify(fbLanes.map((k) => k.id)));
check("B7b 0-FB lane sorts first and is labelled free", fbLanes[0].id === "stealth/space-bunny-alpha" && /free · 0 FB/.test(fbLanes[0].label), JSON.stringify(fbLanes[0]));
check("B7c price is in the label, no 0/hr claim", fbLanes.find((k) => k.id === "z-ai/glm-5.3-flash").label === "Glm 5.3 flash · 5 FB", JSON.stringify(fbLanes.find((k) => k.id === "z-ai/glm-5.3-flash").label));
check("B7d plan-required model never offered", !fbLanes.some((k) => k.id === "openai/gpt-6-luna"), "plan-required leaked");
check("B7e unpublished/unavailable id not offered", !fbLanes.some((k) => k.id === "deepseek/deepseek-v4.1-flash"), "stale id leaked");
check("B7f no xiaomi/mimo-v2.6-flash (never published)", !fbLanes.some((k) => /xiaomi/.test(k.id)), "phantom mimo offered");
check("B7g default freebuff model is the 0-FB lane", mod.FREEBUFF_DEFAULT_MODEL === "stealth/space-bunny-alpha", mod.FREEBUFF_DEFAULT_MODEL);

// ---- E) unavailable Cline GLM never looks healthy ---------------------------
writeFileSync(TABLE_PATH, JSON.stringify(buildTable({ clineGlmUnavailable: true }), null, 2));
const lanesWithGlmDown = mod.availableClineKnownLanes();
check("E1 an unavailable/ended Cline GLM lane is dropped from the probe", !lanesWithGlmDown.some((k) => k.id === "cline-free/glm-5.3-flash") && lanesWithGlmDown.some((k) => k.id === "cline-free/deepseek-v4.1-flash"), JSON.stringify(lanesWithGlmDown));
check("E2 a healthy ledger keeps GLM in the probe list", mod.availableClineKnownLanes(buildTable({ clineGlmUnavailable: false })).some((k) => k.id === "cline-free/glm-5.3-flash"), JSON.stringify(mod.availableClineKnownLanes(buildTable({ clineGlmUnavailable: false }))));
const endedTable = buildTable({ clineGlmUnavailable: false });
endedTable.lanes.find((l) => l.model === "cline-free/glm-5.3-flash").status = "ended";
check("E3 'ended' is treated like 'unavailable'", !mod.availableClineKnownLanes(endedTable).some((k) => k.id === "cline-free/glm-5.3-flash"), JSON.stringify(mod.availableClineKnownLanes(endedTable)));
writeFileSync(TABLE_PATH, JSON.stringify(buildTable(), null, 2));

// ---- E4) button labels never leak the modelType prefix -----------------------
// Live defect 2026-09-25: the Cline free lane `stealth/space-bunny-alpha`
// rendered as "stealth/space bunny alpha free" because the label helper only
// stripped `cline-free/`. Free ids are not all cline-free typed.
check("E4 label strips cline-free/ prefix", mod.prettifyClineLaneLabel("cline-free/deepseek-v4.1-flash") === "deepseek v4.1 flash free", mod.prettifyClineLaneLabel("cline-free/deepseek-v4.1-flash"));
check("E4b label strips a NON-cline-free modelType (stealth/)", mod.prettifyClineLaneLabel("stealth/space-bunny-alpha") === "space bunny alpha free", mod.prettifyClineLaneLabel("stealth/space-bunny-alpha"));
check("E4c no label ever contains a slash", ["stealth/space-bunny-alpha", "cline-free/muse-spark-1.3-contributor", "cline-free/gemini-3.8-flash"].every((id) => !mod.prettifyClineLaneLabel(id).includes("/")), "slash leaked");
check("E4d contributor suffix trimmed", mod.prettifyClineLaneLabel("cline-free/muse-spark-1.3-contributor") === "muse spark 1.3 free", mod.prettifyClineLaneLabel("cline-free/muse-spark-1.3-contributor"));

// ---- E5) a ledger-enrolled Cline lane (any type) becomes a /freemodel button --
const enrolled = buildTable();
enrolled.lanes.push({ pref: 18, provider: "cline", model: "stealth/space-bunny-alpha", bucket: "cline-per-model", status: "available" });
const enrolledItems = mod.availableClineKnownLanes(enrolled);
check("E5 enrolled stealth/ lane appears as a candidate", enrolledItems.some((k) => k.id === "stealth/space-bunny-alpha"), JSON.stringify(enrolledItems.map((k) => k.id)));
check("E5b its label has no modelType leak", enrolledItems.find((k) => k.id === "stealth/space-bunny-alpha").label === "space bunny alpha free", JSON.stringify(enrolledItems.find((k) => k.id === "stealth/space-bunny-alpha")));
enrolled.lanes.find((l) => l.model === "stealth/space-bunny-alpha").status = "unavailable";
check("E5c an enrolled lane marked unavailable is dropped", !mod.availableClineKnownLanes(enrolled).some((k) => k.id === "stealth/space-bunny-alpha"), "unavailable lane still offered");

// ---- F) freemodelReply imported end-to-end uses the injected probes ---------
const e2e = await mod.freemodelReply(null, {
  probes: {
    opencode: results()[0][1],
    cline: results()[1][1],
    tokenharbor: results()[2][1],
    freebuff: results()[3][1],
    commandcode: results()[4][1],
  },
});
check("F1 freemodelReply accepts an injected probe set (no network)", typeof e2e.text === "string" && e2e.text.length > 0 && !e2e.text.includes("`"), e2e.text);
check("F2 freemodelReply buttons are unique and unpadded", (() => {
  const ls = flatten(e2e.keyboard).map((b) => b.text);
  return new Set(ls).size === ls.length && ls.every((l) => l === l.trimEnd());
})(), JSON.stringify(flatten(e2e.keyboard).map((b) => b.text)));

// ---- A) Zen shared cool-off marks EVERY Zen button ❌ ------------------------
// Real repro (2026-09-24): MiMo hits a vendor limit -> markDepleted stamps the
// shared `bucket:opencode-zen-free` record -> every OpenCode Zen freemodel
// button (muse/mimo/…) must show ❌ even with no per-model quota rows left.
mod.markDepleted("opencode", "opencode/mimo-v2.6-flash-free", "AI_APICallError: Rate limit exceeded. Please try again later.");
const zenReply = buildFreemodelReply(results(), now + 1000);
const zenButtons = flatten(zenReply.keyboard).map((b) => ({ label: b.text.trimEnd(), data: b.data }));
const zenMarked = zenButtons.filter((b) => /^❌ /.test(b.label) && /(muse spark 1\.3|mimo v2\.6 flash free$|Space Bunny$)/.test(b.label.replace(/^❌ /, "")));
check("Z1 the Zen cool-off marks the OpenCode muse button ❌", zenMarked.some((b) => /muse spark 1\.3/.test(b.label)), JSON.stringify(zenButtons.map((b) => b.label)));
check("Z2 the Zen cool-off marks the OpenCode mimo button ❌ (the tapped lane)", zenMarked.some((b) => /mimo v2\.6 flash free$/.test(b.label)), JSON.stringify(zenButtons.map((b) => b.label)));
check("Z3 the Zen cool-off marks the OpenCode Space Bunny button ❌", zenMarked.some((b) => /Space Bunny$/.test(b.label)), JSON.stringify(zenButtons.map((b) => b.label)));
check("Z4 freeModelDepletion resolves Space Bunny to the shared bucket", Boolean(freeModelDepletion("opencode", "opencode/space-bunny-free", now + 1000)), JSON.stringify(freeModelDepletion("opencode", "opencode/space-bunny-free", now + 1000)));
check("Z5 non-Zen lanes are not marked by the Zen bucket (TH tools mimo stays clean)", !zenButtons.some((b) => /^❌ .*(qwen|TH tools|Token Harbor|Freebuff)/.test(b.label)), JSON.stringify(zenButtons.map((b) => b.label)));
// Derived: total follows the deduped lane count, depleted follows the Zen bucket.
check("Z6 the Total line counts the Zen-depleted buttons", new RegExp(`Total: ${EXPECTED_LANES} · 3 depleted ❌`).test(zenReply.text), zenReply.text);

mkdirSync(stateDir, { recursive: true });
if (failed) {
  console.error(`\nFAIL: ${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nPASS freemodel-buttons: Zen ❌ on every Zen button, 3 Freebuff taps (terminal-only), honest header, no fake pad");
