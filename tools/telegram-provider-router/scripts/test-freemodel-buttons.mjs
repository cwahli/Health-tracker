#!/usr/bin/env node
/**
 * Smoke: /freemodel is a short header + unique left-padded buttons only.
 *
 *   cd tools/telegram-provider-router && node scripts/test-freemodel-buttons.mjs
 *
 * Covers the 2026-09-25 ticket HT-FREEMODEL-BUTTONS-ONLY:
 *   - body has NO per-model text list (buttons only + a Total line)
 *   - Token Harbor chat + OpenCode `tokenharbor/…` collapse to ONE button
 *     (the OpenCode tools path wins)
 *   - Freebuff is a visible tap when signed in, and selecting it replies with
 *     terminal-only instructions instead of a hard error
 *   - every button label is right-padded so clients render closer to the left
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
const FB_MODEL = "deepseek/deepseek-v4.1-flash";

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
function buildTable({ freebuffDepleted = false } = {}) {
  return {
    version: 3,
    updatedAt: isoZ(now),
    failover: "same-family first (skip depleted), then next available by pref #",
    buckets: {
      "freebuff-freebucks": { scope: "shared", resetRule: "shared daily Freebucks" },
    },
    lanes: [
      lane(17, "deepseek-v4.1-flash", "freebuff", FB_MODEL, "Freebuff DeepSeek V4.1 Flash", "freebuff-freebucks", {
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
writeFileSync(TABLE_PATH, JSON.stringify(buildTable(), null, 2));
writeFileSync(join(stateDir, "session.json"), JSON.stringify(FIXTURE_SESSION, null, 2));

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

// ---- L) left-pad helper -----------------------------------------------------
check("L1 short labels are right-padded to the button width", leftishButtonLabel("hi", 10) === "hi        ", JSON.stringify(leftishButtonLabel("hi", 10)));
check("L2 labels are padded to FREEMODEL_BUTTON_WIDTH by default", leftishButtonLabel("OpenCode: x").length === FREEMODEL_BUTTON_WIDTH, String(leftishButtonLabel("OpenCode: x").length));
check("L3 labels never exceed the 64-char Telegram cap", leftishButtonLabel("x".repeat(120), 38).length === 38, String(leftishButtonLabel("x".repeat(120), 38).length));

// ---- probe fixtures (no network) -------------------------------------------
const TH_TOOLS = { id: "tokenharbor/mimo-v2.6-flash:free", label: "mimo v2.6 flash free (th)" };
const TH_CHAT = { id: "mimo-v2.6-flash:free", label: "mimo v2.6 flash free" };
const results = () => [
  ["opencode", { ok: true, reason: "", items: [
    { id: "opencode/muse-spark-1.3-contributor-free", label: "muse spark 1.3 free" },
    { id: "cloudflare/@cf/qwen/qwen3.8-27b", label: "cf qwen3.8 27b" },
    TH_TOOLS,
  ] }],
  ["cline", { ok: false, reason: "Cline not signed in", items: [] }],
  ["tokenharbor", { ok: true, reason: "", items: [
    TH_CHAT,
    { id: "deepseek-v4.1-flash:free", label: "deepseek v4.1 flash free" },
  ] }],
  ["freebuff", { ok: true, reason: "", items: [{ id: FB_MODEL, label: "DeepSeek V4.1 Flash" }] }],
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
const dedupedTH = deduped.find(([k]) => k === "tokenharbor")[1];
check("D5 the OpenCode-only TH item stays in its own result group", deduped.find(([k]) => k === "opencode")[1].items.some((i) => i.id === TH_TOOLS.id));
check("D6 the chat twin is removed from the tokenharbor group", dedupedTH.items.length === 1 && dedupedTH.items[0].id === "deepseek-v4.1-flash:free", JSON.stringify(dedupedTH.items));

// ---- B) body + keyboard -----------------------------------------------------
const reply = buildFreemodelReply(results(), now);
const buttons = flatten(reply.keyboard);
const bodyLines = reply.text.split("\n");
check("B1 total counts deduped buttons (3 OC + 1 TH + 1 Freebuff)", reply.total === 5, String(reply.total));
check("B2 body has no per-model text lines (no backticked model ids)", !reply.text.includes("`"), reply.text);
check("B3 body has no per-model dump (no muse/mimo/deepseek id text)", !/muse-spark|mimo-v2\.6|deepseek-v4/i.test(reply.text), reply.text);
check("B4 body has a single Total line", bodyLines.filter((l) => /^Total: /.test(l)).length === 1, reply.text);
check("B5 header is short (<= 6 lines before Total)", FREEMODEL_HEADER.length <= 6, String(FREEMODEL_HEADER.length));
check("B6 'Not available' is one footer line for Cline + Command Code", bodyLines.filter((l) => /^Not available: /.test(l)).length === 1 && /Cline/.test(reply.text) && /Command Code/.test(reply.text), reply.text);
check("B7 no provider section headers remain in the body", !bodyLines.some((l) => /^(OpenCode|Cline|Token Harbor|Freebuff)$/.test(l.trim())), reply.text);
const notAvail = bodyLines.find((l) => /^Not available: /.test(l)) || "";
check("B8 a dedupe-merged provider is not reported as Not available", !notAvail.includes("Token Harbor"), reply.text);

// ---- K) buttons -------------------------------------------------------------
check("K1 one button per deduped lane plus Cancel", buttons.length === 6, String(buttons.length));
check("K2 every label is padded to the shared width", buttons.every((b) => b.text.length === FREEMODEL_BUTTON_WIDTH), JSON.stringify(buttons.map((b) => b.text.length)));
check("K3 labels are right-padded (no trailing-cap overflow)", buttons.every((b) => b.text === b.text.trimEnd().padEnd(FREEMODEL_BUTTON_WIDTH)));
const labels = buttons.map((b) => b.text.trimEnd());
check("K4 button labels are unique (no TH twin duplicate)", new Set(labels).size === labels.length, JSON.stringify(labels));
check("K5 the Freebuff button is visible when signed in", labels.some((l) => /^Freebuff: DeepSeek V4\.1 Flash$/.test(l)), JSON.stringify(labels));
check("K6 the surviving TH button is tagged as the tools path", labels.some((l) => /^TH tools: /.test(l)), JSON.stringify(labels));
check("K7 Cancel is present and left-padded", labels.some((l) => /^Cancel/.test(l)), JSON.stringify(labels));
check("K8 freebuff callback data is wired to the walk map", buttons.some((b) => /^fm/.test(b.data) && labels[buttons.indexOf(b)].startsWith("Freebuff")), JSON.stringify(buttons.map((b) => b.data)));

// ---- X) freebuff depletion mark --------------------------------------------
check("X1 freebuff lane starts available (no ❌)", freeModelDepletion("freebuff", FB_MODEL, now) === null);
writeFileSync(TABLE_PATH, JSON.stringify(buildTable({ freebuffDepleted: true }), null, 2));
const depReply = buildFreemodelReply(results(), now);
const depButtons = flatten(depReply.keyboard).map((b) => b.text.trimEnd());
check("X2 a depleted Freebuff lane is marked ❌ and stays tappable", depButtons.some((l) => /^❌ Freebuff: /.test(l)), JSON.stringify(depButtons));
check("X3 depletion is reflected in the Total line", depReply.text.split("\n").includes("Total: 5 · 1 depleted ❌"), depReply.text);
writeFileSync(TABLE_PATH, JSON.stringify(buildTable(), null, 2));

// ---- S) selection: Freebuff = terminal-only reply, never a hard error -------
let pickMsg = "";
let pickErr = null;
try {
  pickMsg = applyFreeModelPick("freebuff", FB_MODEL);
} catch (e) {
  pickErr = e;
}
check("S1 selecting Freebuff does not throw", !pickErr, pickErr?.message);
check("S2 the reply says terminal-only (no Telegram chat)", /terminal-only/i.test(pickMsg) && /no Telegram chat lane/i.test(pickMsg), pickMsg);
check("S3 the reply names the model id (DeepSeek V4.1 Flash)", pickMsg.includes(FB_MODEL) && /DeepSeek V4\.1 Flash/i.test(pickMsg), pickMsg);
check("S4 the reply tells the user how to run it on the box", /`freebuff`/.test(pickMsg), pickMsg);
check("S5 the active Telegram route is not switched", /still go to OpenCode/.test(pickMsg) && /Nothing was switched/.test(pickMsg), pickMsg);

// ---- P) probeFreebuffFree signed-in seam ------------------------------------
const credsDir = mkdtempSync(join(tmpdir(), "ht-freebuff-creds-"));
const goodCreds = join(credsDir, "credentials.json");
writeFileSync(goodCreds, JSON.stringify({ default: { authToken: "test-not-a-real-secret" } }, null, 2));
const signedProbe = await probeFreebuffFree(goodCreds);
check("P1 signed-in probe returns ok with the DeepSeek V4.1 Flash item", signedProbe.ok === true && signedProbe.items.length === 1 && signedProbe.items[0].id === FB_MODEL, JSON.stringify(signedProbe));
const unsignedProbe = await probeFreebuffFree(join(credsDir, "missing.json"));
check("P2 unsigned probe returns ok:false with a sign-in reason (footer line)", unsignedProbe.ok === false && unsignedProbe.items.length === 0 && /sign/i.test(unsignedProbe.reason), JSON.stringify(unsignedProbe));

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
check("F2 freemodelReply keyboard is unique + padded", flatten(e2e.keyboard).every((b) => b.text.length === FREEMODEL_BUTTON_WIDTH), JSON.stringify(flatten(e2e.keyboard).map((b) => b.text)));

mkdirSync(stateDir, { recursive: true });
if (failed) {
  console.error(`\nFAIL: ${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nPASS freemodel-buttons: short header + unique left-padded buttons, Freebuff terminal-only tap");
