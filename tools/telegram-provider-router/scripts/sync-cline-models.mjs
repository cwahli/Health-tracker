#!/usr/bin/env node
/**
 * sync-cline-models — enroll Cline free models into the free-lane ledger.
 *
 *   node scripts/sync-cline-models.mjs --models cline-free/foo,bar --dry-run
 *   node scripts/sync-cline-models.mjs --models ... --apply [--table P] [--session P]
 *
 * The Cline CLI exposes no model catalog, so candidates come from the Cline
 * dashboard (comma list). Each candidate gets ONE cheap probe
 * (`cline -m <id> -c <workspace> "reply OK "`, 90s) and the ledger is
 * upserted from the result (see src/cline-model-sync.js for the rules).
 * Everything downstream is then automatic: ledger-driven /freemodel
 * candidates, watcher re-probes, shared-bucket failover.
 *
 * Safety: dry-run by default (prints the plan, probes included, writes
 * nothing). --apply backs up table+session (.bak-<stamp>) and writes
 * atomically (tmp+rename). Non-free-looking ids are refused unless
 * --include-paid (a probe IS a real run — never spend blindly). Never
 * deletes lanes, never reorders pref. Never prints secrets.
 *
 * Env: HT_ROUTER_DIR (ledger), HT_WORKSPACE (probe cwd).
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
    "usage: node scripts/sync-cline-models.mjs --models id1,id2 [--apply] [--table P] [--session P]\n" +
      "       [--timeout-ms N] [--include-paid]   (dry-run unless --apply)"
  );
  process.exit(fail ? 2 : 1);
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
  const modelsRaw = arg("--models", "");
  if (!modelsRaw) usage(true);
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
  const ids = [...new Set(String(modelsRaw).split(",").map((s) => s.trim()).filter(Boolean))];

  const lines = [];
  let changed = 0;
  for (const raw of ids) {
    const id = normalizeClineModelId(raw);
    if (!id) {
      lines.push(`- ${raw}: SKIP invalid id (want modelType/model)`);
      continue;
    }
    if (!/free/i.test(id) && !includePaid) {
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
    if (created) {
      target.label = target.label || prettifyClineLabel(id);
      tbl.lanes.push(target);
    }
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
  console.log(`\napplied ${changed} lane change(s). Backups: .bak-${stamp}`);
}

main().catch((e) => {
  console.error(`fatal: ${e.message || e}`);
  process.exit(1);
});
