#!/usr/bin/env node
/**
 * sync-cline-models — enroll Cline free models into the free-lane ledger.
 *
 *   node scripts/sync-cline-models.mjs --models cline-free/foo,bar --dry-run
 *   node scripts/sync-cline-models.mjs --models ... --apply [--table P] [--session P]
 *
 * The Cline CLI exposes no model catalog command, but its TUI reads one:
 * GET /api/v1/ai/cline/recommended-models (bearer = accessToken in
 * ~/.cline/data/settings/providers.json). `--catalog` uses it, so
 * "which free models exist" is answered automatically:
 *
 *   node scripts/sync-cline-models.mjs --catalog --dry-run
 *   node scripts/sync-cline-models.mjs --catalog --apply
 *   node scripts/sync-cline-models.mjs --models cline-free/foo,bar --apply
 *
 * Each candidate gets ONE cheap probe (`cline -m <id> -c <workspace>
 * "reply OK "`, 90s) and the ledger is upserted from the result (see
 * src/cline-model-sync.js for the rules). Free-ness comes from the CATALOG in
 * --catalog mode (ids need not contain "free": `stealth/space-bunny-alpha` is
 * a free lane); the name-based guard applies only to manual --models ids.
 * Everything downstream is then automatic: ledger-driven /freemodel
 * candidates, watcher re-probes, shared-bucket failover.
 *
 * Safety: dry-run by default (prints the plan, probes included, writes
 * nothing). --apply backs up table+session (.bak-<stamp>) and writes
 * atomically (tmp+rename). Never deletes lanes, never reorders pref. Never
 * prints secrets.
 *
 * Env: HT_ROUTER_DIR (ledger), HT_WORKSPACE (probe cwd),
 *      CLINE_ACCESS_TOKEN (else read from providers.json).
 */
import { createRequire } from "module";
import { spawnSync } from "child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, renameSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import {
  normalizeClineModelId,
  planLaneUpsert,
  prettifyClineLabel,
  freeModelIdsFromCatalog,
  looksFreeId,
  CLINE_CATALOG_URL,
} from "../src/cline-model-sync.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL_DIR = join(HERE, "..");
const require = createRequire(import.meta.url);
const core = require(join(TOOL_DIR, "src", "allowance-watch-core.cjs"));

const ROUTER_DIR = process.env.HT_ROUTER_DIR || join(homedir(), ".config", "telegram-opencode", "router");
const WORKSPACE = process.env.HT_WORKSPACE || "/workspace/biomarker-and-nutrient-tracker";

function arg(name, def = null) {
  const i = process.argv.indexOf(name);
  if (i < 0) return def;
  return process.argv[i + 1] ?? def;
}
const has = (name) => process.argv.includes(name);

function usage(fail = false) {
  console.error(
    "usage: node scripts/sync-cline-models.mjs --catalog [--apply]\n" +
      "       node scripts/sync-cline-models.mjs --models id1,id2 [--apply]\n" +
      "       [--table P] [--session P] [--timeout-ms N] [--include-paid]\n" +
      "  (dry-run unless --apply)  --catalog reads the live free-model catalog"
  );
  process.exit(fail ? 2 : 1);
}

/** Cline access token: env override, else the CLI's own settings file. */
function clineToken() {
  const envTok = process.env.CLINE_ACCESS_TOKEN;
  if (envTok) return envTok;
  for (const p of [
    process.env.CLINE_SETTINGS_PATH,
    join(homedir(), ".cline", "data", "settings", "providers.json"),
  ]) {
    if (!p) continue;
    const d = readJson(p);
    const a = d?.providers?.cline?.settings?.auth;
    if (a?.accessToken || a?.token) return a.accessToken || a.token;
  }
  return "";
}

/** Live free-model catalog (the same source the TUI model selector reads). */
async function fetchFreeCatalog() {
  const token = clineToken();
  if (!token) throw new Error("no Cline access token (set CLINE_ACCESS_TOKEN)");
  const r = await fetch(CLINE_CATALOG_URL, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`catalog HTTP ${r.status}`);
  return freeModelIdsFromCatalog(await r.json());
}

function readJson(p) {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}
function writeAtomic(p, obj) {
  const tmp = `${p}.tmp.${process.pid}`;
  try {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(tmp, JSON.stringify(obj, null, 2));
    renameSync(tmp, p);
  } catch {
    writeFileSync(p, JSON.stringify(obj, null, 2));
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {}
  }
}
const isoZ = (ms) => {
  try {
    return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
  } catch {
    return "";
  }
};

async function main() {
  const catalogMode = has("--catalog");
  const modelsRaw = arg("--models", "");
  if (!catalogMode && !modelsRaw) usage(true);
  const apply = has("--apply");
  const tablePath = arg("--table", join(ROUTER_DIR, "state", "free-lane-table.json"));
  const sessionPath = arg("--session", join(ROUTER_DIR, "state", "session.json"));
  const timeoutMs = Number(arg("--timeout-ms", "90000")) || 90000;
  const includePaid = has("--include-paid");

  const tbl = readJson(tablePath);
  if (!tbl || !Array.isArray(tbl.lanes)) {
    console.error(`ABORT: no readable lane table at ${tablePath}`);
    process.exit(1);
  }
  const session = readJson(sessionPath) || {};
  const nowIso = isoZ(Date.now());
  // Catalog mode trusts the published free set (ids need not say "free");
  // manual mode keeps the name guard so a typo can't spend a paid run.
  let candidates;
  if (catalogMode) {
    candidates = await fetchFreeCatalog();
    console.log(`catalog: ${candidates.length} free model(s) published by Cline`);
  } else {
    candidates = [...new Set(String(modelsRaw).split(",").map((s) => s.trim()).filter(Boolean))].map((id) => ({
      id,
      name: id,
    }));
  }

  const lines = [];
  let changed = 0;
  let labelFixed = 0;
  for (const cand of candidates) {
    const raw = cand.id;
    const id = normalizeClineModelId(raw);
    if (!id) {
      lines.push(`- ${raw}: SKIP invalid id (want modelType/model)`);
      continue;
    }
    if (!catalogMode && !looksFreeId(id) && !includePaid) {
      lines.push(`- ${id}: SKIP not free-looking (pass --include-paid to probe a paid id)`);
      continue;
    }
    const short = id.replace(/^cline\//, "");
    const res = core.probeCli(spawnSync, "cline", ["-m", short, "-c", WORKSPACE, "reply OK "], timeoutMs, {
      cwd: WORKSPACE,
    });
    const plan = planLaneUpsert(tbl, { model: id, probe: res });
    if (plan.action.startsWith("skip")) {
      lines.push(`- ${id}: SKIP ${plan.reason}`);
      continue;
    }
    const created = plan.action === "new";
    const target = created ? plan.lane : tbl.lanes[plan.index];
    const desc = created ? `NEW pref ${plan.lane.pref}` : `UPDATE pref ${target.pref}`;
    // Normalize the label on every enrollment, not just new lanes: older rows
    // carried router-era text ("Cline Muse Spark 1.3 contributor free") while
    // freshly enrolled rows used the short form — /allowance then showed two
    // different naming styles for the same provider.
    const niceLabel = cand.name && !/free/i.test(cand.name) ? `${cand.name} free` : prettifyClineLabel(id);
    if (target.label !== niceLabel) {
      target.label = niceLabel;
      labelFixed++;
      changed++;
    }
    if (res.status === "available") {
      Object.assign(target, {
        status: "available",
        nextResetAt: null,
        cooldownUntil: null,
        cooldownLeft: "-",
        nextReset: "per-model daily cap",
        lastPingAt: nowIso,
        lastPingNote: "sync-cline-models enroll: OK",
      });
      if (created) tbl.lanes.push(target);
      lines.push(`- ${id}: ${created ? "ENROLL" : "FLIP→available"} (${desc})`);
      changed++;
      continue;
    }
    // depleted: one policy via the shared core (countdown honoured, else TTLs)
    const dep = core.depletionUntilFromText(res.output);
    if (created) tbl.lanes.push(target);
    core.stampDepleted(tbl, session, [target], null, {
      until: dep.until,
      hint: dep.hint || core.parseCountdownHint(res.output).hint,
      kind: dep.kind,
      lastError: res.output,
      source: "sync-cline-models enroll: still limited",
    });
    lines.push(`- ${id}: ${created ? "ENROLL" : "STAMP"} depleted until ${core.isoZ(dep.until)} (${desc})`);
    changed++;
    continue;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  for (const l of lines) console.log(l);
  if (!apply) {
    console.log(`\ndry-run: ${changed} lane change(s) planned, nothing written. Re-run with --apply.`);
    return;
  }
  if (!changed) {
    console.log("\n--apply: nothing to write.");
    return;
  }
  try {
    if (existsSync(tablePath)) copyFileSync(tablePath, `${tablePath}.bak-${stamp}`);
    if (existsSync(sessionPath)) copyFileSync(sessionPath, `${sessionPath}.bak-${stamp}`);
  } catch (e) {
    console.error(`ABORT: backup failed (${e.message}) — nothing written`);
    process.exit(1);
  }
  tbl.updatedAt = nowIso;
  writeAtomic(tablePath, tbl);
  writeAtomic(sessionPath, session);
  console.log(
    `\napplied ${changed} lane change(s)${labelFixed ? ` (${labelFixed} label normalized)` : ""}. Backups: .bak-${stamp}`
  );
}

main().catch((e) => {
  console.error(`fatal: ${e.message || e}`);
  process.exit(1);
});
