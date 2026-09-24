#!/usr/bin/env node
/**
 * One-shot repair of the free-lane quota ledger after the tool-allowance smoke
 * (2026-09-24) polluted session.quota[...].lastError with agent markdown and let a
 * 6h default TTL overwrite the real Cline Muse countdown.
 *
 * What it does (evidence-based; never invents a countdown):
 *   1. For every session.quota record whose lastError is documentation/status text
 *      (rendered pipe table, tool-allowance matrix, free-lane help):
 *        - if free-cap-probes/latest.json has an authoritative record for the same
 *          key (user-observed UI countdown), restore depletedUntil/countdownHint
 *          and replace lastError with a clean provenance line;
 *        - otherwise drop the record (a doc-noise mark with the default TTL is not
 *          a quota fact).
 *   2. Sync free-lane-table.json from the repaired session so the ledger matches
 *      /allowance (pref order untouched).
 *
 * Usage:
 *   node scripts/repair-allowance-state.mjs --dry-run
 *   node scripts/repair-allowance-state.mjs --state-dir /home/box/.config/telegram-opencode/router/state
 */
import { readFileSync, writeFileSync, existsSync, renameSync, unlinkSync } from "fs";
import { join } from "path";
import { isDocLikeQuotaNoise, isoZ, readJson, syncFreeLaneTableFromSession } from "../src/free-lane-table.js";

function arg(name, def = null) {
  const i = process.argv.findIndex((a) => a === `--${name}`);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) return process.argv[i + 1];
  const kv = process.argv.find((a) => a.startsWith(`--${name}=`));
  return kv ? kv.slice(name.length + 3) : def;
}
const DRY = process.argv.includes("--dry-run");
const stateDir = arg("state-dir") || process.env.TG_ROUTER_STATE_DIR || "/home/box/.config/telegram-opencode/router/state";
const sessionPath = join(stateDir, "session.json");
const tablePath = join(stateDir, "free-lane-table.json");
const probePath = join(stateDir, "free-cap-probes", "latest.json");

function writeJsonAtomic(path, obj) {
  const tmp = `${path}.tmp.${process.pid}`;
  try {
    writeFileSync(tmp, JSON.stringify(obj, null, 2));
    renameSync(tmp, path);
  } catch {
    try { writeFileSync(path, JSON.stringify(obj, null, 2)); } catch {}
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch {}
  }
}

const session = readJson(sessionPath);
if (!session) {
  console.error(`no session.json at ${sessionPath}`);
  process.exit(1);
}
const probe = readJson(probePath);
const authoritative = new Map();
for (const e of probe?.cline?.sessionQuota || []) {
  if (e?.key) authoritative.set(e.key, e);
}

const now = Date.now();
const changes = [];
session.quota = session.quota || {};
for (const [key, rec] of Object.entries(session.quota)) {
  if (!rec || !isDocLikeQuotaNoise(rec.lastError)) continue;
  const prev = { depletedUntil: isoZ(rec.depletedUntil), countdownParsed: !!rec.countdownParsed, lastError: String(rec.lastError || "").slice(0, 120) };
  const auth = authoritative.get(key) || null;
  const until = auth ? Date.parse(auth.depletedUntil) : NaN;
  if (auth && Number.isFinite(until) && until > now) {
    rec.depletedUntil = until;
    rec.countdownParsed = !!auth.countdownHint;
    if (auth.countdownHint) rec.countdownHint = auth.countdownHint;
    if (auth.depletedObservedAt) rec.depletedObservedAt = auth.depletedObservedAt;
    rec.lastError = `Repaired from ${auth.source || "user-observed UI"}: ${auth.lastError || "vendor free-limit countdown"}`;
    rec.repairedFrom = "free-cap-probes/latest.json";
    rec.repairedAt = isoZ(now);
    changes.push({ key, action: "restored authoritative countdown", prev, now: { depletedUntil: isoZ(until), countdownHint: rec.countdownHint } });
    continue;
  }
  delete session.quota[key];
  changes.push({ key, action: "dropped doc-noise mark (no authoritative countdown in probe ledger)", prev });
}

if (changes.length && !DRY) writeJsonAtomic(sessionPath, session);

const sync = syncFreeLaneTableFromSession({ tablePath, session, dryRun: DRY });

console.log(JSON.stringify({
  stateDir,
  dryRun: DRY,
  sessionChanges: changes,
  tableSync: { updated: sync.updated, reason: sync.reason || null, changes: sync.changes || [] },
}, null, 2));
