#!/usr/bin/env node
/**
 * Free-lane allowance table: JSON -> qa-evidence/build-table.py -> HTML (CLI).
 *
 * Ticket: "Wire TG allowance table via free-lane JSON + telegram-tables".
 * Data source is the free-lane ledger (state/free-lane-table.json) overlaid with
 * the live session quota (state/session.json) — NOT scripts/tool-allowance.mjs.
 *
 * Usage:
 *   node scripts/render-free-lane-table.mjs                 # repo default table
 *   node scripts/render-free-lane-table.mjs --state-dir /home/box/.config/telegram-opencode/router/state
 *   node scripts/render-free-lane-table.mjs --sync --print-media
 *   node scripts/render-free-lane-table.mjs --table X.json --session Y.json --out-html /tmp/a.html
 *
 * Output: writes <state-dir>/tables/free-lane-table.{json,html} and prints the
 * absolute HTML path (plus the `MEDIA:` line with --print-media).
 */
import { existsSync } from "fs";
import { dirname, join } from "path";
import {
  DEFAULT_TABLE_PATH,
  allowanceTableReplyText,
  renderFreeLaneTableHtml,
  readJson,
  syncFreeLaneTableFromSession,
} from "../src/free-lane-table.js";

function arg(name, def = null) {
  const i = process.argv.findIndex((a) => a === `--${name}`);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) return process.argv[i + 1];
  const kv = process.argv.find((a) => a.startsWith(`--${name}=`));
  return kv ? kv.slice(name.length + 3) : def;
}
const has = (name) => process.argv.includes(`--${name}`);

const stateDir = arg("state-dir") || process.env.TG_ROUTER_STATE_DIR || dirname(DEFAULT_TABLE_PATH);
const tablePath = arg("table") || join(stateDir, "free-lane-table.json");
const sessionPath = arg("session") || join(stateDir, "session.json");
const outDir = arg("out-dir") || join(stateDir, "tables");
const outHtml = arg("out-html") || null;
const outJson = arg("out-json") || null;

if (!existsSync(tablePath)) {
  console.error(`no free-lane table at ${tablePath}`);
  process.exit(1);
}

if (has("sync")) {
  const session = readJson(sessionPath) || {};
  const sync = syncFreeLaneTableFromSession({ tablePath, session, dryRun: has("dry-run") });
  console.log(`sync: ${sync.updated ? `updated (${(sync.changes || []).length} lane change(s))` : `no change (${sync.reason})`}`);
  for (const c of sync.changes || []) console.log(`  · pref ${c.pref} ${c.lane}: ${c.from} → ${c.to}`);
}

const render = renderFreeLaneTableHtml({ tablePath, sessionPath, outDir, outHtml, outJson });
console.log(`renderer: ${render.renderer}`);
console.log(`json:     ${render.jsonPath}`);
console.log(`html:     ${render.htmlPath}`);
console.log(`rows:     ${render.lanes} lanes, ${render.buckets} buckets`);
if (render.pyError) console.log(`note:     ${render.pyError}`);
if (has("json")) console.log(JSON.stringify(render.model, null, 2));
if (has("print-media")) console.log(`\n${allowanceTableReplyText(render)}`);
