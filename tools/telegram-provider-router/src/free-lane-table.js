#!/usr/bin/env node
/**
 * Free-lane allowance table: authoritative model + Telegram HTML renderer.
 *
 * Ticket (2026-09-24 smoke): the "show the allowance result as a table" ask must
 * come from the free-lane ledger (`state/free-lane-table.json`) plus the live
 * session quota, and be delivered with the telegram-tables convention
 * (JSON -> `qa-evidence/build-table.py` -> HTML -> `MEDIA:<abs-path.html>`).
 * It is NOT `scripts/tool-allowance.mjs` (that is the CLI install/capability
 * matrix for OpenCode / Cline / Grok Build / Antigravity).
 *
 * Shared by:
 *   - src/index.js                       (/allowance table + free-form shortcut)
 *   - scripts/render-free-lane-table.mjs (JSON -> HTML CLI)
 *   - scripts/repair-allowance-state.mjs (one-shot live drift repair)
 *   - scripts/test-allowance-table.mjs   (unit tests)
 *
 * No Telegram and no provider calls happen here: pure file reads plus one
 * python3 render. Safe to import from tests (point TG_ROUTER_STATE_DIR at a
 * throwaway dir; nothing here touches the live box unless asked to).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, unlinkSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
/** Default live table: <router>/state/free-lane-table.json (mirrors src/index.js). */
export const DEFAULT_TABLE_PATH = join(HERE, "..", "state", "free-lane-table.json");
export const LANES_HEADING = "Lanes (pref order)";
export const LANE_COLUMNS = ["Pref", "Lane", "Provider", "Status", "Next reset (UTC)", "Cooldown", "Notes"];

export function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function isoZ(ms) {
  const t = Number(ms);
  if (!Number.isFinite(t)) return "";
  try {
    return new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");
  } catch {
    return "";
  }
}

/**
 * Documentation/status text (rendered markdown table, tool-allowance matrix,
 * free-lane help) that mentions "limit"/"depleted" without being a vendor quota
 * failure. Mirrors looksLikeHelpOrStatusDoc in src/index.js so this module and
 * the CLI refuse to treat docs as an authoritative quota signal.
 */
export function isDocLikeQuotaNoise(msg) {
  const s = String(msg || "");
  if (!s.trim()) return false;
  if (
    /tool-allowance|tool\s+allowance|\|\s*Tool\s*\|\s*Installed|Success\s*\/\s*Fail|\bGrok\s+Build\b|Antigravity/i.test(s)
  ) {
    return true;
  }
  // Any rendered markdown pipe table (header + `|---|---|` separator).
  return /\|\s*-{2,}\s*\|/.test(s) && /^\s*\|.*\|\s*$/m.test(s);
}

/** Does a free-lane lane describe this provider+model route? (mirrors src/index.js) */
export function laneMatchesRoute(lane, provider, model) {
  try {
    if (!lane) return false;
    const lp = String(lane.provider || "");
    const p = String(provider || "");
    if (lp && p && lp !== p) return false;
    const lm = String(lane.model || "");
    const m = String(model || "");
    if (!lm || !m) return false;
    if (lm === m) return true;
    const tail = (x) => String(x).replace(/^[^/]+\//, "").replace(/:free$/i, "");
    return tail(lm) === tail(m);
  } catch {
    return false;
  }
}

/** Live (not expired) quota record, or null. */
export function liveQuotaRec(rec, now = Date.now()) {
  if (!rec) return null;
  const until = Number(rec.depletedUntil || 0);
  return until > now ? rec : null;
}

/** A record whose lastError is doc-noise is a polluted mark, not a quota fact. */
export function recIsAuthoritative(rec) {
  if (!rec) return false;
  return !isDocLikeQuotaNoise(rec.lastError);
}

/** Shared buckets use `bucket:<id>`; per-model buckets keep the route key. */
function bucketKeyFor(lane) {
  const b = String(lane?.bucket || "");
  if (!b || /per-model/i.test(b)) return null;
  return `bucket:${b}`;
}

/**
 * Live session quota record for a lane: per-model route key first, then the
 * shared bucket key. Polluted (doc-noise) records are skipped so a help-matrix
 * mark can never show up as a depleted lane.
 */
export function liveRecForLane(lane, session, now = Date.now()) {
  const keys = [];
  if (lane?.provider && lane?.model) keys.push(`${lane.provider}/${lane.model}`);
  const bk = bucketKeyFor(lane);
  if (bk) keys.push(bk);
  for (const k of keys) {
    const rec = session?.quota?.[k];
    if (liveQuotaRec(rec, now) && recIsAuthoritative(rec)) return { key: k, rec };
  }
  return null;
}

/** Human reset label (UTC ISO + Jakarta clock), mirrors src/index.js resetHumanLabel. */
export function defaultResetLabel(untilMs, hint) {
  const iso = isoZ(untilMs);
  let wib = "";
  try {
    wib = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Jakarta",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(untilMs));
  } catch {}
  const why = hint ? `from vendor countdown ${hint}` : "default TTL, no countdown in vendor text";
  return `${iso} (${why})${wib ? ` / ${wib} WIB` : ""}`;
}

/** Stamp a lane as depleted from a live quota record. Mutates + returns lane. */
export function applyDepletedToLane(lane, rec, { source = "session quota", now = Date.now(), labelFn = defaultResetLabel } = {}) {
  const until = Number(rec.depletedUntil || 0);
  const iso = isoZ(until);
  const hint = rec.countdownHint || "";
  lane.status = "depleted";
  lane.nextResetAt = iso;
  lane.cooldownUntil = iso;
  lane.cooldownLeft = "until reset";
  lane.nextReset = labelFn(until, hint);
  if (hint) lane.countdownHint = hint;
  lane.depletedObservedAt = rec.depletedObservedAt || lane.depletedObservedAt || isoZ(now);
  lane.lastPingAt = lane.lastPingAt || lane.depletedObservedAt;
  lane.lastPingNote = lane.lastPingNote || `synced from ${source}`;
  return lane;
}

/**
 * Overlay the authoritative live quota (session.quota) onto a copy of the table
 * so a rendered table can never disagree with `/allowance`. Pure: no file I/O.
 */
export function overlayLiveQuota(table, session, { now = Date.now(), labelFn = defaultResetLabel } = {}) {
  const t = JSON.parse(JSON.stringify(table || {}));
  const lanes = Array.isArray(t.lanes) ? t.lanes : [];
  for (const lane of lanes) {
    const hit = liveRecForLane(lane, session, now);
    if (hit) {
      applyDepletedToLane(lane, hit.rec, { source: `session.quota[${hit.key}]`, now, labelFn });
      continue;
    }
    // No live record: a stale depleted stamp with a past reset has reset.
    if (lane.status === "depleted" && lane.nextResetAt && Date.parse(lane.nextResetAt) <= now) {
      lane.status = "available";
      lane.nextReset = lane.resetRule || t.buckets?.[lane.bucket]?.resetRule || "bucket reset rule";
      lane.nextResetAt = null;
      lane.cooldownUntil = null;
      lane.cooldownLeft = "-";
    }
  }
  for (const [id, bucket] of Object.entries(t.buckets || {})) {
    const rec = liveQuotaRec(session?.quota?.[`bucket:${id}`], now);
    if (rec && recIsAuthoritative(rec)) {
      bucket.nextResetAt = isoZ(rec.depletedUntil);
      bucket.nextResetLabel = labelFn(Number(rec.depletedUntil), rec.countdownHint || "");
    }
  }
  return t;
}

/** Persist the live-quota overlay into the table file (pref order untouched). */
export function syncFreeLaneTableFromSession({ tablePath, session, now = Date.now(), labelFn = defaultResetLabel, dryRun = false } = {}) {
  const tbl = readJson(tablePath);
  if (!tbl) return { updated: false, reason: `no free-lane table at ${tablePath}` };
  const before = JSON.stringify({ lanes: tbl.lanes, buckets: tbl.buckets });
  const next = overlayLiveQuota(tbl, session, { now, labelFn });
  const after = JSON.stringify({ lanes: next.lanes, buckets: next.buckets });
  if (before === after) return { updated: false, reason: "already in sync" };
  const changes = [];
  for (const lane of next.lanes || []) {
    const prev = (tbl.lanes || []).find((l) => l.pref === lane.pref);
    if (prev && (prev.status !== lane.status || prev.nextResetAt !== lane.nextResetAt)) {
      changes.push({
        pref: lane.pref,
        lane: lane.label || lane.model,
        from: prev.nextResetAt || prev.status,
        to: lane.nextResetAt || lane.status,
        status: lane.status,
      });
    }
  }
  if (!dryRun) {
    next.updatedAt = isoZ(now);
    const tmp = `${tablePath}.tmp.${process.pid}`;
    try {
      writeFileSync(tmp, JSON.stringify(next, null, 2));
      renameSync(tmp, tablePath);
    } catch {
      try { writeFileSync(tablePath, JSON.stringify(next, null, 2)); } catch {}
      try { if (existsSync(tmp)) unlinkSync(tmp); } catch {}
    }
  }
  return { updated: true, changes, table: next };
}


/**
 * Active-route honesty: when the sticky route is depleted, say so and name the
 * next available same-family lane (then next available by pref #). Never
 * pretends a depleted lane is healthy.
 */
export function activeRouteAdvice(table, session, { now = Date.now(), labelFn = defaultResetLabel } = {}) {
  const t = overlayLiveQuota(table, session, { now, labelFn });
  const lanes = [...(t.lanes || [])].sort((a, b) => (Number(a.pref) || 0) - (Number(b.pref) || 0));
  const provider = session?.provider || "";
  const model = session?.models?.[provider] || "";
  const active = lanes.find((l) => laneMatchesRoute(l, provider, model)) || null;
  const live = active ? liveRecForLane(active, session, now) : null;
  // Fall back to the ledger's own depleted stamp: a doc-noise session record must
  // not turn a really-depleted sticky route into a healthy one.
  const laneUntil = active?.nextResetAt ? Date.parse(active.nextResetAt) : NaN;
  const depleted = !!(active && (live || (active.status === "depleted" && Number.isFinite(laneUntil) && laneUntil > now)));
  const until = live ? Number(live.rec.depletedUntil) : laneUntil;
  const source = live ? `session.quota[${live.key}]` : "free-lane-table.json";
  const available = lanes.filter((l) => l.status !== "depleted" && l.tg !== false && !(active && l.pref === active.pref));
  const sameFamily = available.find((l) => l.family && active?.family && l.family === active.family) || null;
  const byPref = available[0] || null;
  const lines = [];
  if (active && depleted) {
    const hint = live?.rec?.countdownHint || active.countdownHint || "";
    lines.push(`Active route: ${provider} · \`${model}\` — DEPLETED, resets ${labelFn(until, hint)} [source: ${source}].`);
    if (sameFamily) {
      lines.push(`Next available (same family \`${active.family}\`): \`${sameFamily.model}\` (pref ${sameFamily.pref}).`);
    }
    if (byPref && (!sameFamily || byPref.pref !== sameFamily.pref)) {
      lines.push(`Then by pref #: \`${byPref.model}\` (pref ${byPref.pref}).`);
    }
  } else if (active) {
    lines.push(`Active route: ${provider} · \`${model}\` — available (no live quota record).`);
  } else {
    lines.push(`Active route: ${provider} · \`${model}\` — not a mapped free lane.`);
  }
  return { active, live, sameFamily, byPref, depleted, until, source, lines };
}

function laneNote(lane, { isActive = false, depleted = false } = {}) {
  const base = String(lane.note || lane.notes || "").trim();
  const flags = [];
  if (isActive) flags.push(depleted ? "ACTIVE (depleted)" : "ACTIVE");
  return flags.length ? `${base ? base + " · " : ""}${flags.join(" · ")}` : base;
}

/** Build the qa-evidence/build-table.py input model (pure). */

/**
 * Preference-list failover routes for dispatch.
 * Order: remaining same-family (skip depleted / unavailable / non-TG), then
 * other available lanes by editable pref #. Never returns the sticky route
 * itself. Used so a depleted sticky walks to CF Qwen / CF GLM / … instead of
 * hanging on Stop.
 */
export function nextAvailableRoutes(table, session, {
  fromProvider,
  fromModel,
  now = Date.now(),
  includeNonTg = false,
  labelFn = defaultResetLabel,
} = {}) {
  const t = overlayLiveQuota(table, session, { now, labelFn });
  const lanes = [...(t.lanes || [])].sort((a, b) => (Number(a.pref) || 0) - (Number(b.pref) || 0));
  const active = lanes.find((l) => laneMatchesRoute(l, fromProvider, fromModel)) || null;
  const usable = lanes.filter((l) => {
    if (!l || (active && l.pref === active.pref)) return false;
    if (l.status === "depleted" || l.status === "unavailable" || l.status === "ended") return false;
    if (!includeNonTg && l.tg === false) return false;
    if (!laneIsUsable(l)) return false;
    const live = liveRecForLane(l, session, now);
    if (live) return false;
    return true;
  });
  const family = active?.family || null;
  const sameFamily = usable.filter((l) => family && l.family === family);
  const rest = usable.filter((l) => !(family && l.family === family));
  const ordered = [...sameFamily, ...rest];
  const out = [];
  const seen = new Set();
  for (const l of ordered) {
    const provider = String(l.provider || "");
    const model = String(l.model || "");
    if (!provider || !model) continue;
    const k = `${provider}::${model}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ provider, model, pref: l.pref, family: l.family || null, label: l.label || model });
  }
  return out;
}

/** Soonest Reset-in among depleted TG lanes (for all-depleted Stop message). */
export function soonestResetAmongDepleted(table, session, { now = Date.now(), labelFn = defaultResetLabel } = {}) {
  const t = overlayLiveQuota(table, session, { now, labelFn });
  const depleted = [...(t.lanes || [])].filter((l) => l && l.tg !== false && l.status === "depleted");
  let best = null;
  for (const l of depleted) {
    const until = l.nextResetAt ? Date.parse(l.nextResetAt) : NaN;
    if (!Number.isFinite(until)) continue;
    if (!best || until < best.until) best = { until, lane: l, label: labelFn(until, l.countdownHint) };
  }
  return best;
}

export function buildFreeLaneTableModel(table, session, { now = Date.now(), labelFn = defaultResetLabel } = {}) {
  const t = overlayLiveQuota(table, session, { now, labelFn });
  const lanes = [...(t.lanes || [])].sort((a, b) => (Number(a.pref) || 0) - (Number(b.pref) || 0));
  const advice = activeRouteAdvice(t, session, { now, labelFn });
  const activePref = advice.active?.pref ?? null;
  const laneRows = lanes.map((l) => [
    String(l.pref ?? ""),
    String(l.label || l.model || ""),
    String(l.provider || ""),
    String(l.status || "unknown"),
    l.nextResetAt ? isoZ(Date.parse(l.nextResetAt)) : String(l.nextReset || "-"),
    String(l.cooldownLeft || "-"),
    laneNote(l, { isActive: l.pref === activePref, depleted: l.status === "depleted" }),
  ]);
  const bucketRows = Object.entries(t.buckets || {}).map(([id, b]) => {
    const rec = liveQuotaRec(session?.quota?.[`bucket:${id}`], now);
    return [
      id,
      String(b.scope || (/per-model/i.test(id) ? "per-model" : "shared")),
      String(b.resetRule || "-"),
      b.nextResetAt ? isoZ(Date.parse(b.nextResetAt)) : String(b.nextResetLabel || "-"),
      rec ? "depleted" : "available",
    ];
  });
  return {
    title: "Free-lane allowance — Telegram provider router",
    preamble: [
      `Source: \`free-lane-table.json\` + live \`session.quota\` (${isoZ(now)}).`,
      `This is the **free-lane failover ledger** — not the CLI \`tool-allowance.mjs\` install matrix.`,
      `Failover: ${t.failover || "same-family first (skip depleted), then next available by pref #"}.`,
      ...advice.lines,
    ],
    tables: [
      { heading: LANES_HEADING, columns: LANE_COLUMNS, align: ["r", "l", "l", "c", "l", "l", "l"], rows: laneRows },
      { heading: "Buckets", columns: ["Bucket", "Scope", "Reset rule", "Next reset", "State"], align: ["l", "c", "l", "l", "c"], rows: bucketRows },
    ],
    notes: [
      "Status legend: `available` = no live quota record; `depleted` = vendor limit hit (cooldown until reset); `pending-expose` = not yet catalogued by the live OpenCode server.",
      "`cooldown` is `-` unless the lane is depleted. Live quota comes from session state, so the table always matches `/allowance`.",
      "Ping policy: hourly ledger/state read (not a burn ping); live burn ping only when status is uncertain or the user asked.",
      `Table stamp: ${t.updatedAt || "unknown"}${t.version ? ` (v${t.version})` : ""}.`,
    ],
  };
}


/** Locate qa-evidence/build-table.py (explicit arg -> env -> WORKSPACE -> cwd -> walk up). */
export function resolveBuildTablePy(explicit) {
  const cands = [];
  if (explicit) cands.push(explicit);
  if (process.env.TG_BUILD_TABLE_PY) cands.push(process.env.TG_BUILD_TABLE_PY);
  if (process.env.WORKSPACE) cands.push(join(process.env.WORKSPACE, "qa-evidence", "build-table.py"));
  cands.push(join(process.cwd(), "qa-evidence", "build-table.py"));
  let dir = HERE;
  for (let i = 0; i < 8; i++) {
    cands.push(join(dir, "qa-evidence", "build-table.py"));
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  for (const c of cands) {
    try { if (c && existsSync(c)) return c; } catch {}
  }
  return null;
}

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * Built-in grid used ONLY when python3/build-table.py is unavailable (e.g. a
 * host without markdown-it-py). Same layout contract as table_template.py:
 * one table per section, sticky header, sticky first column, click-to-sort that
 * degrades to a correct static layout when scripts are blocked.
 */
export function fallbackHtml(model) {
  const css = [
    "body{margin:0;padding:18px 0;background:#0f172a;color:#e2e8f0;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.55;-webkit-text-size-adjust:100%}",
    "h1{font-size:22px;margin:0 16px 8px;color:#f8fafc}",
    "h2{font-size:17px;color:#93c5fd;margin:28px 16px 8px;border-bottom:1px solid #334155;padding-bottom:6px}",
    "p{margin:6px 16px;font-size:13.5px;max-width:1100px}",
    "ul{margin:6px 16px 18px;font-size:13px}",
    ".st-scroll{margin:12px 0;max-height:80vh;overflow:auto;-webkit-overflow-scrolling:touch;border:1px solid #334155}",
    ".st-table{border-collapse:separate;border-spacing:0;background:#1e293b;font-size:13px;min-width:100%}",
    "th,td{padding:10px 12px;text-align:left;border-bottom:1px solid #334155;white-space:nowrap;vertical-align:top}",
    "thead th{position:sticky;top:0;z-index:6;background:#1d4ed8;color:#fff;font-size:11px;text-transform:uppercase;letter-spacing:.05em;cursor:pointer;user-select:none}",
    "tbody td:first-child,thead th:first-child{position:sticky;left:0;background:#1e293b;z-index:5}",
    "thead th:first-child{z-index:7;background:#1d4ed8}",
    "tbody tr:nth-child(even) td{background:#172033}",
    "tbody tr:nth-child(even) td:first-child{background:#172033}",
  ].join("\n");
  const parts = [];
  parts.push('<!doctype html><html lang="en"><head><meta charset="utf-8">');
  parts.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
  parts.push(`<title>${esc(model.title || "Table")}</title><style>${css}</style></head><body><div class="wrap">`);
  parts.push(`<h1>${esc(model.title || "Table")}</h1>`);
  for (const p of model.preamble || []) parts.push(`<p>${esc(p)}</p>`);
  for (const t of model.tables || []) {
    parts.push(`<h2>${esc(t.heading || "")}</h2>`);
    const head = (t.columns || []).map((c) => `<th>${esc(c)}</th>`).join("");
    const body = (t.rows || [])
      .map((r) => `<tr>${(r || []).map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`)
      .join("\n");
    parts.push(`<div class="st-scroll"><table class="st-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`);
  }
  if ((model.notes || []).length) {
    parts.push("<h2>Notes</h2><ul>");
    for (const n of model.notes) parts.push(`<li>${esc(n)}</li>`);
    parts.push("</ul>");
  }
  parts.push("</div>");
  parts.push(
    "<script>document.querySelectorAll('.st-table thead th').forEach(function(th,i){th.addEventListener('click',function(){var tb=th.closest('table').tBodies[0];var rows=Array.prototype.slice.call(tb.rows);var dir=th.dataset.dir==='asc'?'desc':'asc';th.dataset.dir=dir;rows.sort(function(a,b){var x=a.cells[i].textContent.trim(),y=b.cells[i].textContent.trim();var nx=parseFloat(x.replace(/[^0-9.+-]/g,'')),ny=parseFloat(y.replace(/[^0-9.+-]/g,''));var c=(!isNaN(nx)&&!isNaN(ny))?nx-ny:x.localeCompare(y);return dir==='asc'?c:-c;});rows.forEach(function(r){tb.appendChild(r);});});});</script>"
  );
  parts.push("</body></html>");
  return parts.join("\n");
}


/**
 * JSON -> build-table.py -> HTML, with a built-in grid fallback. Returns absolute
 * paths so the caller can emit `MEDIA:<htmlPath>` straight into Telegram.
 */
export function renderFreeLaneTableHtml({
  tablePath = DEFAULT_TABLE_PATH,
  sessionPath = null,
  outDir = null,
  outJson = null,
  outHtml = null,
  buildTablePy = null,
  labelFn = defaultResetLabel,
  now = Date.now(),
} = {}) {
  const table = readJson(tablePath);
  if (!table) throw new Error(`no free-lane table at ${tablePath}`);
  const sPath = sessionPath || join(dirname(tablePath), "session.json");
  const session = readJson(sPath) || {};
  const model = buildFreeLaneTableModel(table, session, { now, labelFn });
  const dir = outDir || join(dirname(tablePath), "tables");
  mkdirSync(dir, { recursive: true });
  const jsonPath = resolve(outJson || join(dir, "free-lane-table.json"));
  const htmlPath = resolve(outHtml || join(dir, "free-lane-table.html"));
  writeFileSync(jsonPath, JSON.stringify(model, null, 2));
  // Explicit buildTablePy is authoritative (missing -> built-in grid); otherwise
  // locate qa-evidence/build-table.py (env -> WORKSPACE -> cwd -> walk up).
  const py = buildTablePy ? (existsSync(buildTablePy) ? buildTablePy : null) : resolveBuildTablePy(null);
  let renderer = "builtin-grid-fallback";
  let pyError = null;
  if (py) {
    try {
      execFileSync("python3", [py, jsonPath, htmlPath], { stdio: ["ignore", "pipe", "pipe"], timeout: 30000 });
      if (existsSync(htmlPath)) renderer = "qa-evidence/build-table.py";
    } catch (e) {
      pyError = String(e.stderr || e.message || e).slice(0, 400);
    }
  } else {
    pyError = "qa-evidence/build-table.py not found";
  }
  if (renderer === "builtin-grid-fallback") writeFileSync(htmlPath, fallbackHtml(model));
  return {
    htmlPath,
    jsonPath,
    model,
    renderer,
    buildTablePy: py,
    pyError,
    lanes: (model.tables?.[0]?.rows || []).length,
    buckets: (model.tables?.[1]?.rows || []).length,
  };
}

/** One short caption + the MEDIA line for Telegram. */

/** Short reset clock for in-chat monospace (UTC). */
export function shortResetClock(isoOrMs, fallback = "—") {
  if (isoOrMs == null || isoOrMs === "") return fallback;
  const ms = typeof isoOrMs === "number" ? isoOrMs : Date.parse(isoOrMs);
  if (!Number.isFinite(ms)) return String(isoOrMs).slice(0, 24) || fallback;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(ms)) + "Z";
  } catch {
    return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
  }
}

/** Estimated time until reset: `10h 23`, `1d 3h`, `now`, or `—`. */
export function formatResetIn(isoOrMs, now = Date.now()) {
  if (isoOrMs == null || isoOrMs === "") return "—";
  const ms = typeof isoOrMs === "number" ? isoOrMs : Date.parse(isoOrMs);
  if (!Number.isFinite(ms)) return "—";
  const left = ms - now;
  if (left <= 0) return "now";
  const totalMin = Math.max(0, Math.round(left / 60000));
  const d = Math.floor(totalMin / (60 * 24));
  const h = Math.floor((totalMin % (60 * 24)) / 60);
  const m = totalMin % 60;
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}` : `${h}h`;
  return `${m}m`;
}

/** Short plan code: CF / CL / OC / OC-TH / TH / FB. */
export function planCodeForLane(lane) {
  const provider = String(lane?.provider || "").toLowerCase();
  const model = String(lane?.model || "").toLowerCase();
  const bucket = String(lane?.bucket || "").toLowerCase();
  if (provider === "cloudflare" || model.includes("cloudflare/") || bucket.includes("cloudflare")) return "CF";
  if (provider === "cline" || model.startsWith("cline")) return "CL";
  if (provider === "freebuff" || bucket.includes("freebuff")) return "FB";
  if (provider === "tokenharbor") return "TH";
  if (provider === "opencode" && (model.includes("tokenharbor/") || bucket.includes("tokenharbor"))) return "OC-TH";
  if (provider === "opencode") return "OC";
  return (provider || "?").slice(0, 6).toUpperCase();
}

/** Compact model title for the chat table (no provider prefix). */
export function shortModelName(lane) {
  let s = String(lane?.label || lane?.model || "").trim();
  s = s
    .replace(/^OpenCode\s+Token\s+Harbor\s+/i, "")
    .replace(/^Token\s+Harbor\s+chat\s+/i, "")
    .replace(/^OpenCode\s+/i, "")
    .replace(/^Cline\s+/i, "")
    .replace(/^Cloudflare\s+/i, "")
    .replace(/^Freebuff\s+/i, "")
    .replace(/\s+contributor\s+/i, " Cont ")
    .replace(/\s+free\s*$/i, "")
    .replace(/\s+free\b/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const m = String(lane?.model || "");
  if (/qwen3\.?8-27b|qwen\/qwen3\.8-27b|@cf\/.*qwen3\.8-27b/i.test(m)) return "Qwen 3.8 27B";
  if (/qwen3\.?8-flash/i.test(m)) return "Qwen 3.8 Flash";
  if (/muse-spark-1\.3|muse-spark\/1\.3/i.test(m)) return /contributor|cont/i.test(m + s) ? "Muse 1.3 Cont" : "Muse 1.3";
  if (/muse-spark-1\.2/i.test(m)) return "Muse 1.2 Cont";
  if (/mimo-v2\.6|mimo\/v2\.6/i.test(m)) return "MiMo V2.6";
  if (/mimo-v2\.5/i.test(m)) return "MiMo V2.5";
  if (/space-bunny/i.test(m)) return "Space Bunny";
  if (/deepseek-v4\.1|deepseek\/deepseek-v4\.1/i.test(m)) return "DeepSeek V4.1";
  if (/deepseek-v4-flash|deepseek-v4(?!\.1)/i.test(m)) return "DeepSeek V4";
  if (/glm-4\.7/i.test(m)) return "GLM 4.7 Flash";
  if (/glm-5\.3/i.test(m)) return "GLM 5.3 Flash";
  return s.length > 20 ? s.slice(0, 20) : s;
}

function laneIsEnded(lane) {
  const st = String(lane?.status || "").toLowerCase();
  if (st === "unavailable") return true;
  const blob = `${lane?.note || ""} ${lane?.notes || ""} ${lane?.nextReset || ""} ${lane?.resetRule || ""}`;
  return /promotion\s+ended|ended\s+promotion|no longer free|free promotion ended/i.test(blob);
}

function laneIsUsable(lane) {
  const st = String(lane?.status || "").toLowerCase();
  return st === "available" || st === "ok" || st === "";
}

/** Include TG lanes plus Freebuff (terminal) so /allowance is a full usage map. */
function laneInAllowanceTable(lane) {
  if (!lane || laneIsEnded(lane)) return false;
  if (lane.tg !== false) return true;
  const provider = String(lane.provider || "").toLowerCase();
  const bucket = String(lane.bucket || "").toLowerCase();
  return provider === "freebuff" || bucket.includes("freebuff");
}

/** Display width for Telegram monospace (emoji ≈ 2 cells). */
function dispWidth(s) {
  let w = 0;
  for (const ch of String(s ?? "")) {
    const cp = ch.codePointAt(0);
    // ✅ ❌ and most emoji presentation
    if (cp === 0x2705 || cp === 0x274c || cp === 0x2714 || cp === 0x2716) w += 2;
    else if (cp > 0x1f000) w += 2;
    else if (cp >= 0x1100 && (
      cp <= 0x115f || cp === 0x2329 || cp === 0x232a ||
      (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe10 && cp <= 0xfe19) ||
      (cp >= 0xfe30 && cp <= 0xfe6f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6)
    )) w += 2;
    else w += 1;
  }
  return w;
}

function padDisp(s, n) {
  const x = String(s ?? "");
  const w = dispWidth(x);
  if (w >= n) {
    // trim by codepoints until width fits
    let out = "";
    let used = 0;
    for (const ch of x) {
      const cw = dispWidth(ch);
      if (used + cw > n) break;
      out += ch;
      used += cw;
    }
    return out + " ".repeat(Math.max(0, n - used));
  }
  return x + " ".repeat(n - w);
}

function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function laneResetAt(lane, table) {
  if (lane?.nextResetAt) return lane.nextResetAt;
  if (lane?.cooldownUntil) return lane.cooldownUntil;
  const b = table?.buckets?.[lane?.bucket];
  return b?.nextResetAt || null;
}

/**
 * In-chat Model | Plan | Usage | Reset in.
 * Telegram monospace breaks on emoji width, so ✅/❌ sit OUTSIDE <code> and the
 * three text columns stay fixed-width inside HTML <code> (parse_mode HTML).
 * Available first by pref; depleted by soonest reset. No ★. Freebuff included.
 */
export function formatCompactAllowanceChat(table, session, { now = Date.now(), labelFn = defaultResetLabel } = {}) {
  const t = overlayLiveQuota(table, session, { now, labelFn });
  const lanes = [...(t.lanes || [])].filter(laneInAllowanceTable);
  const usable = lanes
    .filter(laneIsUsable)
    .sort((a, b) => (Number(a.pref) || 0) - (Number(b.pref) || 0));
  const depleted = lanes
    .filter((l) => !laneIsUsable(l))
    .sort((a, b) => {
      const am = Date.parse(laneResetAt(a, t) || "") || Number.POSITIVE_INFINITY;
      const bm = Date.parse(laneResetAt(b, t) || "") || Number.POSITIVE_INFINITY;
      if (am !== bm) return am - bm;
      return (Number(a.pref) || 0) - (Number(b.pref) || 0);
    });
  const ordered = [...usable, ...depleted];
  const advice = activeRouteAdvice(t, session, { now, labelFn });
  const W_MODEL = 16;
  const W_PLAN = 6;
  const W_RESET = 8;
  const header = `${padDisp("Model", W_MODEL)}${padDisp("Plan", W_PLAN)}Reset in`;
  const sep = `${"-".repeat(W_MODEL)}${"-".repeat(W_PLAN)}${"-".repeat(W_RESET)}`;
  const nl = "\n";
  const lines = [
    "<code>" + escHtml(header) + nl + escHtml(sep) + "</code>",
  ];
  for (const l of ordered) {
    const ok = laneIsUsable(l);
    const name = shortModelName(l);
    const plan = planCodeForLane(l);
    const resetIn = formatResetIn(laneResetAt(l, t), now);
    const row = `${padDisp(name, W_MODEL)}${padDisp(plan, W_PLAN)}${resetIn}`;
    lines.push((ok ? "✅" : "❌") + " <code>" + escHtml(row) + "</code>");
  }
  lines.push("");
  if (usable[0]) {
    const u = usable[0];
    const term = u.tg === false ? " (terminal)" : "";
    lines.push(
      "Next up: " + escHtml(shortModelName(u)) + " · " + planCodeForLane(u) + term +
      " · <code>" + escHtml(u.model) + "</code>"
    );
  } else {
    lines.push("Next up: (no free lane available — use paid / wait for reset)");
  }
  if (advice.depleted && advice.active) {
    lines.push("Active sticky is empty — fail over to Next up (do not hang).");
  }
  const fb = usable.find((l) => String(l.provider || "").toLowerCase() === "freebuff" || String(l.bucket || "").toLowerCase().includes("freebuff"));
  if (fb) {
    lines.push("Freebuff: " + escHtml(shortModelName(fb)) + " ready (~1h Freebucks) — terminal only; use it promptly.");
  }
  lines.push("Auto-track: empty/rate-limit stamps Reset; refreshes from ledger + OpenCode log.");
  return lines.join(nl);
}

export function allowanceTableReplyText(render, { captionPrefix = "Free-lane allowance table" } = {}) {
  const lanes = render?.lanes ?? 0;
  const buckets = render?.buckets ?? 0;
  const p = render?.model?.preamble || [];
  const active = p.find((l) => l.startsWith("Active route:")) || "";
  return (
    `${captionPrefix} — ${lanes} lanes, ${buckets} buckets (free-lane-table.json + live session quota).\n` +
    `${active}\n` +
    `Tap a column header to sort. Free-lane ledger only.\n\n` +
    `MEDIA:${render.htmlPath}`
  );
}

