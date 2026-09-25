#!/usr/bin/env node
/**
 * sync-freebuff-models — enroll the Freebuff model catalog into the free-lane ledger.
 *
 *   node scripts/sync-freebuff-models.mjs --catalog            # dry-run (default)
 *   node scripts/sync-freebuff-models.mjs --catalog --apply    # write it
 *
 * Source of truth: GET /api/v1/freebuff/session (the payload the TUI picker
 * renders): shared daily Freebucks pool, per-model price, plan-required ids,
 * per-model daily caps, off-peak windows, price notices. NO probe is run —
 * a Freebuff probe means a real interactive session on a single-session
 * account, so availability stays owned by the watcher; this sync owns catalog
 * facts (see src/freebuff-model-sync.js).
 *
 * Safety: dry-run by default. --apply backs up the table (.bak-<stamp>) and
 * writes atomically. Never deletes lanes: ids the catalog stopped publishing
 * are REPORTED as stale. Plan-required (paid) models are never offered as free
 * lanes. Never prints the token.
 *
 * Env: HT_ROUTER_DIR (ledger), CLINE_ACCESS_TOKEN not used — Freebuff token is
 * read from ~/.config/manicode/credentials.json (override: FREEBUFF_CREDS_PATH).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, renameSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import {
  parseFreebuffCatalog,
  planFreebuffUpserts,
  freebuffModelLabel,
  FREEBUFF_SESSION_URL,
} from "../src/freebuff-model-sync.js";

const ROUTER_DIR = process.env.HT_ROUTER_DIR || join(homedir(), ".config", "telegram-opencode", "router");
const has = (n) => process.argv.includes(n);
const arg = (n, d = null) => {
  const i = process.argv.indexOf(n);
  return i < 0 ? d : process.argv[i + 1] ?? d;
};

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

function freebuffToken() {
  if (process.env.FREEBUFF_ACCESS_TOKEN) return process.env.FREEBUFF_ACCESS_TOKEN;
  const p = process.env.FREEBUFF_CREDS_PATH || join(homedir(), ".config", "manicode", "credentials.json");
  const d = readJson(p);
  const inner = d?.default || d || {};
  return inner.authToken || inner.token || inner.accessToken || "";
}

async function fetchCatalog() {
  const token = freebuffToken();
  if (!token) throw new Error("no Freebuff token (set FREEBUFF_ACCESS_TOKEN)");
  const r = await fetch(FREEBUFF_SESSION_URL, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`session HTTP ${r.status}`);
  return parseFreebuffCatalog(await r.json());
}

async function main() {
  const apply = has("--apply");
  const tablePath = arg("--table", join(ROUTER_DIR, "state", "free-lane-table.json"));
  const catalog = await fetchCatalog();
  const tbl = readJson(tablePath);
  if (!tbl || !Array.isArray(tbl.lanes)) {
    console.error(`ABORT: no readable lane table at ${tablePath}`);
    process.exit(1);
  }

  console.log(
    `freebucks pool: ${catalog.pool.dailyRemaining}/${catalog.pool.dailyLimit} left today ` +
      `(spent ${catalog.pool.dailySpent}, resets ${catalog.pool.resetAt || "?"} ${catalog.pool.resetTimeZone || ""})` +
      ` · wallet ${catalog.pool.walletBalance} · tier ${catalog.accessTier}` +
      (catalog.countryBlockReason ? ` · country: ${catalog.countryBlockReason}` : "")
  );
  console.log(`catalog: ${catalog.models.length} priced model(s)\n`);

  const plan = planFreebuffUpserts(tbl, catalog);
  let changed = 0;
  for (const e of plan.enroll) {
    const target = e.created ? e.lane : tbl.lanes[e.index];
    const wantLabel = freebuffModelLabel(e.model);
    let dirty = false;
    if (target.label !== wantLabel) {
      target.label = wantLabel;
      dirty = true;
    }
    for (const k of ["priceFreebucks", "planRequired", "dailyLimit", "dailyResetAt"]) {
      if (target[k] !== e.model[k] && e.model[k] !== null) {
        target[k] = e.model[k];
        dirty = true;
      }
    }
    if (e.model.notice && target.priceNotice !== e.model.notice) {
      target.priceNotice = e.model.notice;
      dirty = true;
    }
    if (e.created) {
      tbl.lanes.push(target);
      changed++; // a NEW lane is itself a change (else --apply could skip the push)
    }
    if (dirty) changed++;
    console.log(
      `- ${target.model}: ${e.created ? "ENROLL" : "UPDATE"} · ${wantLabel}` +
        (e.model.dailyLimit ? ` · daily cap ${e.model.dailyLimit}` : "") +
        (dirty ? "" : " (no change)")
    );
  }
  for (const s of plan.skipped) console.log(`- ${s.id}: SKIP ${s.reason}`);
  for (const s of plan.stale) {
    if (s.needsFlag && s.index >= 0) {
      const lane = tbl.lanes[s.index];
      lane.catalogStale = true;
      lane.catalogStaleAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
      changed++;
    }
    console.log(`- ${s.id}: STALE pref ${s.pref} (${s.status}) — ${s.reason}; NOT auto-deleted`);
  }

  if (!apply) {
    console.log(`\ndry-run: ${changed} lane change(s) planned, nothing written. Re-run with --apply.`);
    return;
  }
  if (!changed) {
    console.log("\n--apply: nothing to write.");
    return;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  try {
    if (existsSync(tablePath)) copyFileSync(tablePath, `${tablePath}.bak-${stamp}`);
  } catch (e) {
    console.error(`ABORT: backup failed (${e.message}) — nothing written`);
    process.exit(1);
  }
  tbl.updatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  writeAtomic(tablePath, tbl);
  console.log(`\napplied ${changed} lane change(s). Backups: .bak-${stamp}`);
}

main().catch((e) => {
  console.error(`fatal: ${e.message || e}`);
  process.exit(1);
});
