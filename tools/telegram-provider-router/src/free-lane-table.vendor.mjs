// === VENDORED FROM scripts/lib/free-lanes.mjs — DO NOT EDIT ===
// Mirrored by scripts/sync-router-vendor.mjs. Edit the canonical file, not this copy.

/**
 * Free-lane allowance table: CANONICAL shared model + Telegram HTML renderer.
 *
 * Single-source for every bot (bot-host family, mobile, collab, Grok TG router).
 * Edit here, then run `node scripts/sync-router-vendor.mjs` — the router holds
 * only `src/free-lane-table.vendor.mjs` (byte-identical mirror, checked by
 * `scripts/check-capability-propagation.mjs`). Never edit the vendor by hand.
 *
 * Ticket (2026-09-24 smoke): the "show the allowance result as a table" ask must
 * come from the free-lane ledger (`state/free-lane-table.json`) plus the live
 * session quota, and be delivered with the telegram-tables convention
 * (JSON -> `qa-evidence/build-table.py` -> HTML -> `MEDIA:<abs-path.html>`).
 * It is NOT `scripts/tool-allowance.mjs` (that is the CLI install/capability
 * matrix for OpenCode / Cline / Grok Build / Antigravity).
 *
 * Shared by:
 *   - tools/telegram-provider-router/src/index.js (via vendor mirror)
 *   - tools/telegram-provider-router/scripts/render-free-lane-table.mjs
 *   - tools/telegram-provider-router/scripts/repair-allowance-state.mjs
 *   - scripts/bot-host.mjs (/allowance + /freemodel depletion filter)
 *   - scripts/collab-bot.mjs (same, via shared helpers below)
 *
 * No Telegram and no provider calls happen here: pure file reads plus one
 * python3 render. Safe to import from tests (point TG_ROUTER_STATE_DIR at a
 * throwaway dir; nothing here touches the live box unless asked to).
 */
import { catalogScore, tierForModel, benchmarkLabel } from './free-catalogs.mjs';
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, unlinkSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";
import { laneSetup } from './setup-gaps.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
/**
 * No box default in canonical — callers must pass explicit tablePath.
 * The TG router wrapper (`src/free-lane-table.js`) provides its own
 * DEFAULT_TABLE_PATH; bot-host/collab resolve via candidateRouterStateDirs().
 */
export const DEFAULT_TABLE_PATH = null;
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
export function bucketKeyFor(lane) {
  const b = String(lane?.bucket || "");
  if (!b || /per-model/i.test(b)) return null;
  return `bucket:${b}`;
}

/**
 * A transport failure, not a quota decision. These say nothing about whether
 * the provider will accept the next request, so they get their own short
 * cooldown instead of the 6h quota default. Same ENOTFOUND/ECONNREFUSED
 * vocabulary the Node fetch and CLI layers produce.
 */
/**
 * Transport failure, not a quota decision.
 *
 * Two vocabularies, because two surfaces report this differently and the live
 * proof on 2026-09-25 showed the gap: the Cline CLI said
 * "Cannot connect to API: Unable to connect ... (ConnectionRefused)" and the
 * OpenCode CLI said "HttpClientError: Transport error (GET https://...)".
 * Neither contains an errno, and a cooldown keyed only on errnos never fired.
 * So: the errno set, plus the human wording those CLIs actually emit.
 */
const CONNECTION_ERRNO_RE =
  /econnrefused|econnreset|etimedout|eai_again|enotfound|epipe|ehostunreach|enetunreach|ePROTO|econnaborted/i;
const CONNECTION_WORDING_RE =
  /connection\s?refused|connection\s?reset|connection\s?timed\s?out|unable to connect|cannot connect|transport error|socket hang up|fetch failed|network error|network request failed|getaddrinfo|temporary failure in name resolution|proxy|tunnel|ssl|wrong version number/i;

export function isConnectionFailure(msg) {
  const text = String(msg || "");
  return CONNECTION_ERRNO_RE.test(text) || CONNECTION_WORDING_RE.test(text);
}

/**
 * Token Harbor's free allowance is one shared, rolling ~7-day value bar, not a
 * per-model daily cap. That is the Grok router's model and the table says so on
 * every Token Harbor row (`resetRule: "rolling ~7-day value bar"`), with all six
 * rows sharing the `tokenharbor-free` bucket so one empty bar empties all of them.
 *
 * When the bar is spent the vendor answers `402` with "balance is at $0" and no
 * countdown. The generic fallback stamped 6 hours, which is a guess borrowed from
 * a daily provider: on a weekly bar it re-probed four times a day against an
 * allowance that will not refill until the week turns over, and the row showed a
 * confident "6h" that was never true. Cloudflare's daily bar already had a case
 * of its own; this is the same treatment for the weekly one.
 */
export const TOKEN_HARBOR_WEEKLY_BAR_MS = 7 * 24 * 60 * 60 * 1000;

/** A Token Harbor value-bar exhaustion: 402, or the balance wording it returns. */
export function isTokenHarborBarExhausted(msg) {
  const text = String(msg || "");
  // Token Harbor must be named in the text. A bare 402 means "payment required"
  // to whichever provider sent it, and treating every 402 as a weekly bar would
  // hand a 7-day cooldown to providers whose allowance is not weekly at all. The
  // vendor's own body names it: "Your Token Harbor balance is at $0".
  if (!/token\s*harbor/i.test(text)) return false;
  return /\b402\b/.test(text) || /balance[^.]{0,40}\$?0\b/i.test(text);
}

/** How long a connection failure keeps a lane out of the walk. */
export const CONNECTION_FAILED_COOLDOWN_MS = 10 * 60 * 1000;

/** Quota keys to stamp for a lane: route key always, plus shared bucket key. */
export function quotaKeysForLane(lane) {
  const keys = [];
  if (lane?.provider && lane?.model) keys.push(`${lane.provider}/${lane.model}`);
  const bk = bucketKeyFor(lane);
  if (bk && !keys.includes(bk)) keys.push(bk);
  return keys;
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

/**
 * Live session quota record for a /freemodel entry's own route candidates —
 * no table lane row required. A freshly stamped route (e.g. a catalog model
 * the pref-doc table never listed) must still read as depleted with its reset
 * clock instead of silently showing available.
 */
export function liveRecForRoutes(candidates, session, now = Date.now()) {
  for (const route of candidates || []) {
    const key = route?.provider && route?.model ? `${route.provider}/${route.model}` : null;
    if (!key) continue;
    const rec = session?.quota?.[key];
    if (liveQuotaRec(rec, now) && recIsAuthoritative(rec)) return { key, rec };
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

/**
 * The one projection every allowance surface reads.
 *
 * /allowance, /freemodel and the turn's lane choice used to answer three
 * different questions from the same ledger: /allowance listed table rows,
 * /freemodel listed discovered catalog models, and the turn walked a filtered
 * copy. A route could therefore be ❌ in one surface and selectable in another,
 * which is what the two bots' /allowance output showed. One projection, one
 * verdict per lane:
 *
 *   selectable  - a Telegram turn may use it right now
 *   terminalOnly- visible, never selectable (Freebuff and friends)
 *   ended       - a promotion finished; never offered again
 *   depleted    - stamped until resetAt
 *   reason      - human wording, so a surface never invents its own
 *
 * Quota stays per worker: the caller passes its own session. The lane CATALOG
 * is shared, the stamps are not.
 */
export function projectLanes(table, session, { now = Date.now(), labelFn = defaultResetLabel, location = "", readiness = null } = {}) {
  const t = overlayLiveQuota(table || {}, session || {}, { now, labelFn });
  // An ended lane stays VISIBLE with a verdict. Dropping it made a model the
  // user still remembers simply vanish from /allowance, and left /freemodel
  // with no row to say "this one is over". Every lane with a route is projected;
  // whether it may be used is the verdict, not its presence.
  const rows = [...(t.lanes || [])]
    .filter((l) => l && l.provider && l.model)
    .sort((a, b) => (Number(a.pref) || 0) - (Number(b.pref) || 0));
  return rows.map((lane) => {
    const provider = String(lane.provider || "");
    const model = String(lane.model || "");
    // A lane reached THROUGH opencode still belongs to the provider in its path:
    // `opencode/tokenharbor/deepseek-v4.1-flash:free` is a Token Harbor lane, not
    // an OpenCode one. Reading the lane's own provider field made those lanes
    // inherit opencode's readiness and its plan code, so a missing
    // TOKEN_HARBOR_API_KEY never blocked them and the table said OP where the
    // router's table says TH.
    const effectiveProvider = effectiveProviderOf(lane);
    const ref = toModelRefShim(provider, model);
    const status = String(lane.status || "").toLowerCase();
    const live = liveRecForLane(lane, session || {}, now);
    const until = live?.depletedUntil || (lane.nextResetAt ? Date.parse(lane.nextResetAt) : NaN);
    const resetAt = Number.isFinite(until) ? until : null;
    const terminalOnly = lane.tg === false;
    const ended = status === "ended" || laneIsEnded(lane);
    const depleted = Boolean(live) || status === "depleted";
    // A lane whose provider has no credential on this host cannot run, whatever
    // the table says. Saying "available" there is how seven lanes sat in the
    // table looking usable when none of them could be.
    const setup = readiness ? laneSetup(effectiveProvider, readiness) : { needsSetup: false, unknown: true, reason: null };
    let reason = "";
    if (ended) reason = "promotion ended, never offered again";
    else if (depleted) reason = `depleted until ${resetAt ? labelFn(resetAt, live?.countdownHint || lane.countdownHint) : "reset"}`;
    else if (setup.needsSetup) reason = setup.reason || 'provider not set up on this host';
    else if (terminalOnly) reason = "terminal only, not selectable from chat";
    else reason = "available";
    return {
      ref,
      lane,
      provider,
      model,
      pref: lane.pref,
      family: lane.family || null,
      bucket: lane.bucket || null,
      label: lane.label || model,
      plan: planCodeForLane(lane),
      effectiveProvider,
      location,
      ended,
      depleted,
      terminalOnly,
      needsSetup: Boolean(setup.needsSetup),
      setupUnknown: Boolean(setup.unknown),
      selectable: !ended && !depleted && !terminalOnly && !setup.needsSetup,
      resetAt,
      resetLabel: depleted && resetAt ? labelFn(resetAt, live?.countdownHint || lane.countdownHint) : null,
      reason,
    };
  });
}

// Only the providers setup-gaps knows about. A wider set here invented owners:
// a Freebuff lane whose model path contains `deepseek/` resolved to deepseek and
// rendered as plan code "DE".
const PROVIDER_ALIASES = new Set([
  'tokenharbor', 'cloudflare', 'freebuff', 'opencode', 'cline', 'gemini',
]);

/** The provider that actually serves a lane, from its model path. */
export function effectiveProviderOf(lane) {
  const own = String(lane?.provider || "").toLowerCase();
  const parts = String(lane?.model || "").toLowerCase().split("/");
  // A leading segment that merely repeats the lane's own provider is a prefix,
  // not the provider: `opencode/tokenharbor/x` is Token Harbor. Start past it.
  const start = parts[0] === own ? 1 : 0;
  for (const seg of parts.slice(start)) {
    if (PROVIDER_ALIASES.has(seg)) return seg;
  }
  return own;
}

/** toModelRef lives in freemodels; a local shim keeps this module standalone. */
function toModelRefShim(provider, model) {
  if (provider === "cline") return `cline:${model}`;
  if (provider === "gemini") return `gemini:${model}`;
  return model;
}

/**
 * Every lane a turn may actually use on this host, in preference order.
 *
 * The turn path used to walk a fixed two-entry list (the chat's model, then
 * the bot default) and retry a lane the ledger already knew was spent. This is
 * the list the walk should use: Telegram-selectable rows that are not
 * depleted, not ended, not unavailable, and not inside a live quota window.
 * Terminal-only rows (Freebuff) are never in it.
 *
 * @returns {{lanes: Array, skipped: Array}} skipped rows carry why, for the chat.
 */
export function usableTurnLanes(table, session, { now = Date.now(), labelFn = defaultResetLabel } = {}) {
  const t = overlayLiveQuota(table || {}, session || {}, { now, labelFn });
  const all = [...(t.lanes || [])].sort((a, b) => (Number(a.pref) || 0) - (Number(b.pref) || 0));
  const lanes = [];
  const skipped = [];
  for (const lane of all) {
    if (!lane) continue;
    const id = { provider: String(lane.provider || ""), model: String(lane.model || "") };
    const label = lane.label || id.model;
    if (lane.tg === false) {
      skipped.push({ ...id, label, why: "terminal-only, not selectable from chat" });
      continue;
    }
    if (String(lane.status || "").toLowerCase() === "ended") {
      skipped.push({ ...id, label, why: "lane ended, never offered again" });
      continue;
    }
    if (!laneIsUsable(lane)) {
      const until = lane.nextResetAt ? Date.parse(lane.nextResetAt) : NaN;
      skipped.push({
        ...id,
        label,
        why: lane.status === "depleted" ? "depleted" : `status ${lane.status}`,
        until: Number.isFinite(until) ? until : null,
        resetLabel: Number.isFinite(until) ? labelFn(until, lane.countdownHint) : null,
      });
      continue;
    }
    const live = liveRecForLane(lane, session || {}, now);
    if (live) {
      skipped.push({
        ...id,
        label,
        why: "depleted",
        until: live.depletedUntil || null,
        resetLabel: live.nextResetAt || (live.depletedUntil ? labelFn(live.depletedUntil, live.countdownHint) : null),
      });
      continue;
    }
    if (!id.provider || !id.model) continue;
    lanes.push({ ...id, pref: lane.pref, family: lane.family || null, label });
  }
  return { lanes, skipped };
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
  // Display-only TH dedupe so the HTML grid shows one row per Token Harbor model.
  const lanes = dedupeTokenHarborLanes(
    [...(t.lanes || [])].sort((a, b) => (Number(a.pref) || 0) - (Number(b.pref) || 0))
  );
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

/** Short plan code: CF / CL / OC / TH / FB. */
export function planCodeForLane(lane) {
  const provider = String(lane?.provider || "").toLowerCase();
  const model = String(lane?.model || "").toLowerCase();
  const bucket = String(lane?.bucket || "").toLowerCase();
  if (provider === "cloudflare" || model.includes("cloudflare/") || bucket.includes("cloudflare")) return "CF";
  if (provider === "cline" || model.startsWith("cline")) return "CL";
  if (provider === "freebuff" || bucket.includes("freebuff")) return "FB";
  // Token Harbor free bar = TH for both paths: the OpenCode `tokenharbor/…`
  // tools lane and the chat-only `provider: tokenharbor` lane are the same
  // shared `tokenharbor-free` bucket, so they share one public plan code.
  if (provider === "tokenharbor") return "TH";
  if (provider === "opencode" && (model.includes("tokenharbor/") || bucket.includes("tokenharbor"))) return "TH";
  // Gemini is keyed, not free-tier, but it is a lane with its own allowance: a
  // 429 or RESOURCE_EXHAUSTED is stamped and reset like any other. Labelling it
  // "OC" hid which provider the row belonged to, the same mistake the tokenharbor
  // rows above had.
  if (provider === "gemini" || model.includes("gemini-") || /^google\//.test(model)) return "GM";
  if (provider === "opencode" || provider.startsWith("opencode-")) return "OC";
  return (provider || "?").slice(0, 6).toUpperCase();
}

/** Does this lane belong to the shared `tokenharbor-free` bar? */
function isTokenHarborLane(lane) {
  const provider = String(lane?.provider || "").toLowerCase();
  const model = String(lane?.model || "").toLowerCase();
  const bucket = String(lane?.bucket || "").toLowerCase();
  return provider === "tokenharbor" || model.startsWith("tokenharbor/") || bucket.includes("tokenharbor");
}

/** Provider-agnostic display key for a Token Harbor lane (strip prefix + lowercase). */
function tokenHarborDisplayKey(lane) {
  return String(lane?.model || "").toLowerCase().replace(/^tokenharbor\//, "");
}

/** The OpenCode + `tokenharbor/…` lane (tools) is preferred over the chat-only lane. */
function lanePrefersTools(lane) {
  return String(lane?.provider || "").toLowerCase() === "opencode"
    || String(lane?.model || "").toLowerCase().startsWith("tokenharbor/");
}

/**
 * Display-only dedupe: TH and OC-TH are the same free bar, so render ONE `TH`
 * row per model. Prefers the OpenCode + `tokenharbor/…` lane (tools) when both
 * exist. The ledger keeps chat-only lanes for failover; this only changes what
 * `/allowance` shows.
 */
export function dedupeTokenHarborLanes(lanes) {
  const out = [];
  const byKey = new Map();
  for (const lane of lanes || []) {
    if (!isTokenHarborLane(lane)) {
      out.push(lane);
      continue;
    }
    const key = tokenHarborDisplayKey(lane);
    const kept = byKey.get(key);
    if (!kept) {
      byKey.set(key, lane);
      out.push(lane);
    } else if (lanePrefersTools(lane) && !lanePrefersTools(kept)) {
      out[out.indexOf(kept)] = lane;
      byKey.set(key, lane);
    }
  }
  return out;
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
    // "-free" is a suffix on the model id, not a word, and leaving it on ate four
    // of the columns the name had left. "ling-3.0-flash-fin-free" and
    // "ling-3.0-flash-free" then truncated to the same 16 columns and printed as
    // two identical rows, one of them untellable from the other.
    .replace(/-free$/i, "")
    .replace(/-free\b/i, "")
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
  // The cap is the table's name-column width, not a second number: a 20-char cap
  // in a 24-char column still cut "nemotron-3.5-lightning" to "nemotron-3.5-lightni".
  return s.length > MODEL_NAME_MAX ? s.slice(0, MODEL_NAME_MAX) : s;
}

function laneIsEnded(lane) {
  const st = String(lane?.status || "").toLowerCase();
  // status "ended" is how a finished promotion is recorded in the table; without
  // it here, /allowance kept listing a lane the walk refused to touch.
  if (st === "ended") return true;
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
export function dispWidth(s) {
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

export function escHtml(s) {
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
/** Stable identity for a lane across clones of the same table. */
export function laneKey(lane) {
  return `${String(lane?.provider || "")}/${String(lane?.model || "")}`;
}

/** The chat's own lane first when it is usable, then preference order. */
export function orderLikeWalk(lanes, currentModel) {
  const list = [...(lanes || [])];
  if (!currentModel) return list;
  const tail = String(currentModel);
  const key = (l) => `${String(l?.provider || "")}/${String(l?.model || "")}`;
  const alt = (l) => String(l?.model || "");
  // Match on the full route or the bare model id. A looser test (endsWith on
  // the model) matched the FIRST lane for every input, so the ranking never
  // moved anything.
  const at = list.findIndex((l) => key(l) === tail || alt(l) === tail || key(l) === `${l.provider}/${tail}`);
  if (at <= 0) return list;
  const [first] = list.splice(at, 1);
  return [first, ...list];
}

/**
 * The copy width every list line is finished to.
 *
 * 72 characters, with a `-` in the last cell: the dash is what makes the width
 * exact, because trailing spaces are trimmed by some clients and by Telegram's own
 * rendering, so a line padded only with spaces is not reliably 72 anywhere. The
 * dash is content, so the length holds.
 */
export const COPY_WIDTH = 72;

/** The mark column: ✅/❌ plus the space after it. */
const MARK_W = 2;

/**
 * Pad (or trim) to exactly n *characters* — the unit the keyboard counts in.
 * Column content is ASCII (short model names, plan codes, `12h 34`, `AA39.5`), so
 * characters and display cells are the same number inside a column; the only
 * width anomaly in the block is the ✅/❌ mark, and the two finishers below each
 * account for it in their own unit.
 */
function padChars(s, n) {
  const x = String(s ?? "");
  if (x.length > n) return x.slice(0, n);
  return x + " ".repeat(n - x.length);
}

/**
 * Pad (or trim) any line to exactly COPY_WIDTH characters, ending in a `-`.
 *
 * The outer fill counts *characters*, not display columns, because "72 char" is how
 * a reader counts and how Telegram sizes a button. The columns inside a row are
 * still padded by display width, so the names, plans and scores line up. The two
 * differ by one on a row carrying ✅, which occupies two columns and one character.
 */
export function fitCopy(line) {
  const raw = String(line ?? '');
  let out = '';
  let n = 0;
  for (const ch of raw) {
    if (n + 1 > COPY_WIDTH - 1) break;
    out += ch;
    n += 1;
  }
  out += " ".repeat(COPY_WIDTH - 1 - n);
  return `${out}-`;
}

/**
 * Pad (or trim) any line to exactly COPY_WIDTH *display cells*, for the
 * monospace table. fitCopy counts characters (the unit buttons need); a ✅/❌
 * mark is one character and two cells, so a character-exact table row renders
 * one cell too wide. A trailing dash is preserved as the terminator.
 */
export function fitCells(line) {
  const raw = String(line ?? "");
  let out = "";
  let w = 0;
  for (const ch of raw) {
    const cw = dispWidth(ch);
    if (w + cw > COPY_WIDTH - 1) break;
    out += ch;
    w += cw;
  }
  out += " ".repeat(COPY_WIDTH - 1 - w);
  return `${out}-`;
}

/**
 * The columns of a row, in the reader's order and widths: the name in 30, two
 * spaces, the plan in 2, THREE spaces, the reset in 15, two spaces, the
 * benchmark in 7. One builder for both surfaces, so neither can pick a different
 * order or a different width for the same column — that drift is how a button and
 * its own row stopped lining up.
 *
 * The gap after the plan code is three, not one: with a single space the reader
 * saw `OC 5h 36` and read the countdown as part of the plan. Columns start at
 * character 2 (name), 34 (plan), 39 (reset), 56 (benchmark), and the row is 63
 * characters before the finisher pads it to 72 with a dash last.
 */
export function colsCopy({ name = "", plan = "", resetIn = "—", score = "" } = {}) {
  return `${padChars(name, MODEL_NAME_MAX)}  ${padChars(plan, W_PLAN)}   ${padChars(resetIn, W_EXPIRY)}  ${padChars(score, W_SCORE)}`;
}

/**
 * One row as both surfaces print it: the mark, one space, then the columns.
 * Raw — no width finishing — because the keyboard counts characters and the table
 * counts cells, and only the mark (one character, two cells) tells them apart.
 * The monospace table finishes it in cells with fitCells. Buttons no longer
 * finish this line at all: the client fits rendered width, not characters, so a
 * button is rowWidth() — the same columns, padded by em instead of by count.
 */
export function rowCopy({ mark = " ", name = "", plan = "", score = "", resetIn = "—" } = {}) {
  return `${mark} ${colsCopy({ name, plan, resetIn, score })}`;
}

/**
 * A non-row button — a tier heading, or the Cancel row — on the same footing as
 * the rows: indented by the mark column so its text starts where a name starts,
 * and finished to the same COPY_WIDTH characters. A keyboard has no subheadings,
 * so these rows are where the split between groups is visible.
 */
export function headingCopy(text) {
  return fitCopy(`${" ".repeat(MARK_CHARS)}${text}`);
}

/**
 * Advance widths in em, for the font the Telegram client draws a button label
 * in. A button label is laid out in a *proportional* font and centred in its
 * row, and what the client fits — and middle-elides into `…` when the label
 * overruns — is rendered width, not characters: the same 72 characters measured
 * from 386px to 465px across one keyboard, a 414.6px row rendered whole while
 * the 418.4px row beside it lost its middle, and the one row that reads
 * correctly (the tier heading) landed at 409px. Character count is therefore
 * not a length on this surface; these advances are.
 *
 * Measured from the system font at 17px (UNIT_PX), the reference size; a client
 * drawing at another size scales both the label and this budget by the same
 * factor, so the numbers stay in em.
 */
export const ADV = {
  '\u0020': 0.2559,
  '!': 0.3235,
  '"': 0.4471,
  '#': 0.6765,
  '$': 0.6045,
  '%': 0.9412,
  '&': 0.7059,
  '\u0027': 0.2353,
  '(': 0.3564,
  ')': 0.3564,
  '*': 0.4471,
  '+': 0.6471,
  ',': 0.2706,
  '-': 0.4463,
  '.': 0.2715,
  '/': 0.2793,
  ':': 0.2706,
  ';': 0.2706,
  '<': 0.6471,
  '=': 0.6471,
  '>': 0.6471,
  '?': 0.5765,
  '@': 0.9706,
  '[': 0.3235,
  '\u005c': 0.6471,
  ']': 0.3235,
  '^': 0.6471,
  '_': 0.6045,
  '`': 0.4471,
  'a': 0.5264,
  'b': 0.5889,
  'c': 0.5342,
  'd': 0.5889,
  'e': 0.5459,
  'f': 0.3364,
  'g': 0.5840,
  'h': 0.5630,
  'i': 0.2217,
  'j': 0.2217,
  'k': 0.5176,
  'l': 0.2275,
  'm': 0.8447,
  'n': 0.5581,
  'o': 0.5654,
  'p': 0.5850,
  'q': 0.5850,
  'r': 0.3555,
  's': 0.4980,
  't': 0.3379,
  'u': 0.5581,
  'v': 0.5166,
  'w': 0.7490,
  'x': 0.4990,
  'y': 0.5176,
  'z': 0.4990,
  '{': 0.6045,
  '|': 0.2941,
  '}': 0.6045,
  '~': 0.6045,
  '\u00b7': 0.2715,
  '\u2013': 0.5294,
  '\u2014': 0.8486,
  '\u2022': 0.4706,
  '\u2026': 0.6059,
  '\u2705': 1.3529,
  '\u274c': 1.3529,
  'A': 0.6484,
  'B': 0.6318,
  'C': 0.6904,
  'D': 0.7012,
  'E': 0.6482,
  'F': 0.5469,
  'G': 0.7212,
  'H': 0.7168,
  'I': 0.2718,
  'J': 0.4465,
  'K': 0.6394,
  'L': 0.5425,
  'M': 0.8486,
  'N': 0.7088,
  'O': 0.7461,
  'P': 0.6176,
  'Q': 0.7461,
  'R': 0.6824,
  'S': 0.6118,
  'T': 0.6084,
  'U': 0.6941,
  'V': 0.6484,
  'W': 0.9529,
  'X': 0.6235,
  'Y': 0.6059,
  'Z': 0.5706,
  '0': 0.6045,
  '1': 0.4385,
  '2': 0.5781,
  '3': 0.6016,
  '4': 0.6182,
  '5': 0.5928,
  '6': 0.6113,
  '7': 0.5439,
  '8': 0.6133,
  '9': 0.6113
};

/** UNIT_PX: the size the advances above were measured at. */
export const UNIT_PX = 17;

/** Rendered width of a string, in em. Unknown glyphs cost the default 0.55em. */
export function widthUnits(s) {
  let u = 0;
  for (const ch of String(s ?? "")) u += ADV[ch] ?? 0.55;
  return u;
}

const SP = ADV[" "] ?? 0.2559;
const W_DASH = ADV["-"] ?? 0.4463;

/**
 * The button's column budgets, in em — the width each column occupies whatever
 * it holds, so the plan code, the countdown and the benchmark begin at the same
 * x on every row instead of wherever the previous column's letters happened to
 * end. They are the widest value each column has to carry: the mark is the
 * two-cell emoji, the name the longest shortModelName in the catalog, the plan
 * a two-letter code, the reset `1h 33`, the benchmark the number without its
 * `AA` prefix (the reader chose to drop the prefix from buttons; the table
 * keeps it under the column's own header).
 */
export const W_HEAD_UNITS = 12.1542; // mark(1.3529) + space + name(10.5454)
export const W_PLAN_UNITS = 1.5698;
export const W_EXPIRY_UNITS = 2.4605;
export const W_SCORE_UNITS = 2.0957;

/**
 * COPY_UNITS: every button renders exactly this wide — 24em, 408px at the
 * reference size. That is the tier heading the reader pointed at as correct
 * (409px) and it sits under the ~415px where the client starts eating the
 * middle of a label, so the whole keyboard shares one edge, end to end, and
 * nothing elides. The gate pins both ends of that window.
 */
export const COPY_UNITS = 24.0;

/** Where each column starts on a button, in em (mark + space + name, etc.). */
export const ROW_UNITS = {
  plan: W_HEAD_UNITS + 2 * SP,
  expiry: W_HEAD_UNITS + 2 * SP + W_PLAN_UNITS + 3 * SP,
  score: W_HEAD_UNITS + 2 * SP + W_PLAN_UNITS + 3 * SP + W_EXPIRY_UNITS + 2 * SP,
};

/** Pad a string with ASCII spaces until it is `n` em wide. */
export function padUnits(s, n) {
  let out = String(s ?? "");
  while (widthUnits(out) < n - 1e-9) out += " ";
  return out;
}

/**
 * Finish a line for a button: ASCII spaces up to (but never past) COPY_UNITS,
 * then the dash. Floors rather than rounds up, so a padded line can come out a
 * fraction under the budget but never over it — over is what the client elides.
 */
export function fitWidth(line) {
  const room = (COPY_UNITS - W_DASH - widthUnits(line)) / SP;
  const fill = Math.max(0, Math.floor(room + 1e-9));
  return `${line}${" ".repeat(fill)}-`;
}

/**
 * One button row, in the reader's order: mark, name, two spaces, plan, THREE
 * spaces, countdown, two spaces, benchmark — every column padded by rendered
 * width, the line finished by rendered width. The benchmark arrives as `AA48`
 * from benchmarkLabel() and loses the prefix here: the buttons have no header
 * row to hang it on, and those two glyphs are most of what pushed a row past
 * the client's cut-off. The monospace table keeps them.
 */
export function rowWidth({ mark = " ", name = "", plan = "", score = "", resetIn = "—" } = {}) {
  const bench = String(score).replace(/^AA/, "");
  const line = `${padUnits(`${mark} ${name}`, W_HEAD_UNITS)}  ${padUnits(plan, W_PLAN_UNITS)}   ${padUnits(resetIn, W_EXPIRY_UNITS)}  ${padUnits(bench, W_SCORE_UNITS)}`;
  return fitWidth(line);
}

/**
 * A non-row button — a tier heading or the Cancel row — at the same rendered
 * width as the rows, indented two spaces so its text starts where a mark does.
 */
export function headingWidth(text) {
  return fitWidth(`  ${text}`);
}

/**
 * The ledger table on its own: column header, rule, a subheading per tier group
 * with the group's count, and one line per row. Shared by /allowance and
 * /freemodel, which is what makes the two lists the same list rather than two
 * renderings that agree today.
 *
 * It is a monospace `<code>` block because that is the only left-aligned,
 * column-true rendering Telegram offers. An inline keyboard button cannot be
 * aligned: the Bot API has no alignment field and clients centre that text.
 */
export function allowanceTableLines(table, session, { now = Date.now(), labelFn = defaultResetLabel, rows = null, location = "", readiness = null } = {}) {
  return formatCompactAllowanceChat(table, session, { now, labelFn, rows, currentModel: "", location, readiness, tableOnly: true });
}

export function formatCompactAllowanceChat(table, session, { now = Date.now(), labelFn = defaultResetLabel, rows = null, currentModel = "", tableOnly = false } = {}) {
  const t = overlayLiveQuota(table, session, { now, labelFn });
  // TH + OC-TH are one row (display-only); failover still uses both lanes.
  const lanes = dedupeTokenHarborLanes([...(t.lanes || [])].filter(laneInAllowanceTable));
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
  // Ranking: the same order the turn walks. The chat's current lane first when
  // it is usable, then preference order — so the first row of the table is the
  // lane that will actually be used next, and "Next up" cannot disagree with it.
  const usableOrdered = rows
    ? orderLikeWalk(usable, currentModel)
    : usable;
  const ordered = rows ? [...usableOrdered, ...depleted] : [...usable, ...depleted];
  const advice = activeRouteAdvice(t, session, { now, labelFn });
  const W_MODEL = MODEL_NAME_MAX;
  // Shared column widths (W_PLAN/W_EXPIRY/W_SCORE) and order (name/plan/reset/
  // score): the header, the rows and the buttons all read the same numbers, so
  // no surface can drift into its own layout again.
  // One width for every line in the block, so it reads as a flush-left rectangle
  // with a straight right edge. Without it the rows end wherever their content ends
  // — "AA48   —" against "AA39.5 —" — and the eye reads the ragged edge as ragged
  // alignment even though every line starts in the same column.
  // The ✅/❌ mark is a column, not a decoration in front of one: two glyphs, then
  // the name, then the columns, and the whole line finished to COPY_WIDTH by
  // fitCopy so every line in the block is the same length and starts at the same
  // column. The same copy is what a /freemodel button carries, so the button and the
  // row say the same thing at the same width.
  const header = fitCells(`${" ".repeat(MARK_CELLS)}${colsCopy({ name: "Model", plan: "Plan", resetIn: "Reset in", score: "AA" })}-`);
  const sep = fitCells(`${" ".repeat(MARK_CELLS)}${"-".repeat(W_MODEL)}${"-".repeat(W_PLAN)}${"-".repeat(W_EXPIRY)}${"-".repeat(W_SCORE)}-`);
  const nl = "\n";
  // No <code> spans of its own: the whole message goes out inside one block, and a
  // nested span is escaped into visible "&lt;code&gt;" text.
  const lines = [header + nl + sep];
  // The rows are canonicalAllowanceLanes() — the same list /freemodel renders. This
  // loop used to walk the ordered table with only the Token Harbor pair collapsed,
  // so a vendor twin (`opencode/space-bunny-free` and `opencode-go/space-bunny-free`
  // are one model) printed twice here while /freemodel counted it once. One list.
  const blocked = [];
  const canonicalRows = canonicalAllowanceLanes({ table: t, lanes: ordered, session, now, labelFn });
  // Group once, render in that order. Rows are collected with their tier and the
  // block is emitted in one pass afterwards, so a subheading can never end up above
  // the wrong row — inserting headings by index shifts every later one.
  const tierGroups = groupRowsByTier(canonicalRows);
  const tierOfRow = new Map(tierGroups.flatMap((g) => g.rows.map((r) => [r, g.tier])));
  const rendered = [];
  for (const l of canonicalRows) {
    const verdict = rows ? rows.find((r) => laneKey(r.lane) === laneKey(l.lane)) || l : l;
    // A lane whose provider has no credential on this host cannot be counted,
    // so it leaves the table entirely rather than sitting in it as a mystery
    // row. It is listed underneath with the variable it needs.
    if (verdict?.needsSetup) {
      blocked.push(verdict);
      continue;
    }
    // The mark follows the projection when there is one. laneIsUsable() only knows
    // the table's own status, so a terminal-only lane — Freebuff — was ticked green
    // here while /freemodel, reading the same projection, marked it not usable. Two
    // commands, two verdicts for one row. The projection already carries the reason
    // ("terminal only, not selectable from chat").
    const ok = verdict ? verdict.selectable : laneIsUsable(l);
    const name = shortModelName(l);
    const plan = planCodeForLane(l);
    // The reset comes from the projection when there is one. laneResetAt() only
    // reads the table, and a per-worker stamp's reset lives in that worker's session
    // record — so a depleted row showed "❌" with "Reset in —", the mark without the
    // time, once the catalogue moved to the host's table.
    const resetIn = formatResetIn(verdict?.resetAt ?? laneResetAt(l, t), now);
    const score = benchmarkLabel(l.model || l) || "—";
    rendered.push({ tier: tierOfRow.get(l) || 'unlisted', line: fitCells(rowCopy({ mark: ok ? "✅" : "❌", name, plan, score, resetIn })) });
  }
  // One subheading per tier group, in the catalog's order, with the group's own
  // count in it. A group with no rows gets no heading, and /freemodel groups the
  // same way from the same helper, so the two lists read as one list.
  for (const g of tierGroups) {
    if (!g.rows.length) continue;
    const mine = rendered.filter((r) => r.tier === g.tier);
    if (!mine.length) continue;
    // Indented by the mark column so every line in the block starts at the same left
    // edge — a heading flush against column 0 while every row starts two glyphs in
    // reads as misalignment even though the columns are right.
    if (tierGroups.length > 1) lines.push(fitCells(`${" ".repeat(2)}${g.label} (${mine.length})`));
    for (const r of mine) lines.push(r.line);
  }
  // /freemodel embeds exactly these lines and nothing below them, so the two
  // commands cannot show different rows for the same ledger.
  if (tableOnly) return lines.join("\n");
  lines.push("");
  // "Next up" must be a lane the walk can actually choose. A terminal-only row
  // (Freebuff and friends) stays in the table so the user can see it, but it is
  // never the next lane: offering "Next up: FB (terminal)" sent the user looking
  // for a turn that can never run on it.
  const selectableIn = (l) => l.tg !== false && !rows?.find((r) => laneKey(r.lane) === laneKey(l))?.needsSetup;
  const firstUsable = (rows ? usableOrdered : usable).find(selectableIn) || null;
  if (firstUsable) {
    const u = firstUsable;
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
  // Token Harbor's free models share ONE rolling ~7-day value bar, which is what
  // the table's own resetRule says on every TH row and what the shared
  // `tokenharbor-free` bucket enforces. So an empty bar takes all the TH rows down
  // together and they return together — it is not five separate models running
  // out, and it needs no purchase to come back. Stated once, here, because the
  // rows alone look like five independent lanes.
  if ((t.lanes || []).some((l) => planCodeForLane(l) === "TH")) {
    lines.push("Token Harbor: one shared rolling ~7-day value bar — when it empties all TH rows go at once and return together.");
  }

  if (blocked.length) {
    lines.push("");
    lines.push("Not counted on this host (no credential — cannot run):");
    for (const r of blocked.slice(0, 8)) {
      lines.push("⏸ " + escHtml(shortModelName(r.lane)) + " · " + planCodeForLane(r.lane) + " — " + escHtml(String(r.reason || "provider not set up")));
    }
    const vars = [...new Set(blocked.map((r) => String(r.reason || "").replace(/^needs /, "")).filter(Boolean))];
    if (vars.length) lines.push("Missing: " + escHtml(vars.join(", ")) + " — /setup for the fix.");
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

// ---------------------------------------------------------------------------
// Shared bot-host helpers (canonical — every bot imports these, never a copy).
// The TG router vendors this file; bot-host/collab/mobile import it directly.
// ---------------------------------------------------------------------------

/** Candidate router state dirs, first hit wins. Explicit arg beats env. */
export function candidateRouterStateDirs(explicit) {
  const out = [];
  if (explicit) out.push(explicit);
  if (process.env.TG_ROUTER_STATE_DIR) out.push(process.env.TG_ROUTER_STATE_DIR);
  const home = process.env.HOME || process.env.USERPROFILE || "";
  if (home) out.push(join(home, ".config", "telegram-opencode", "router", "state"));
  // Repo checkout fallback: <repo>/tools/telegram-provider-router/state
  // (gitignored live state; docs pref used when absent — see below).
  try {
    let dir = HERE;
    for (let i = 0; i < 6; i++) {
      const cand = join(dir, "tools", "telegram-provider-router", "state");
      out.push(cand);
      const up = dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  } catch {}
  return [...new Set(out.filter(Boolean))];
}

/**
 * Drop a model when a newer one of the same family is present AND is not worse.
 *
 * The list carried every version the catalogue knows: DeepSeek V4 and V4.1 side by
 * side, Ling 2.6 beside 3.0, Muse Spark 1.2 beside 1.3, GLM 4.7 beside 5, MiniMax
 * M2.1/M2.5 beside M3. That is four near-identical choices where one is wanted, and
 * it makes the preference order mean less with every release.
 *
 * "Newer" alone is not a safe rule, and the scorecard's own numbers show why:
 * Nemotron 3.5 Lightning is a newer version than Nemotron 3 Ultra and scores 13
 * against 23. Version does not track capability, so a newer model only supersedes an
 * older one when it is at least as good. Where neither has a score, the newer one
 * wins — a tidier list is the point — and that is recorded as a guess rather than a
 * measurement. A "-preview" build is treated as earlier than the release it
 * previews, which is what it is.
 */
const VENDOR_SEGMENT = /^(?:opencode(?:-go)?|cline-free|tokenharbor|cloudflare|google|gemini|freebuff|cline)\//;

/** The model name without the surface it is reached through. */
function stripVendorName(model) {
  let m = String(model || '').toLowerCase();
  m = m.replace(VENDOR_SEGMENT, '');
  m = m.replace(/^opencode\//, ''); // "opencode/opencode/x" repeats it
  return m;
}

export function supersedeOlderVersions(lanes, { scoreOf = null } = {}) {
  const versionOf = (raw) => {
    const model = stripVendorName(raw);
    const m = model.match(/(\d+(?:[.-]\d+)*)/);
    if (!m) return [];
    const preview = /-preview|-rc|-beta/.test(model) ? [-1] : [];
    return [...m[1].split(/[.-]/).map((n) => Number(n) || 0), ...preview];
  };
  // The family is the model name, not the path it is reached by: DeepSeek V4 on
  // the OpenCode surface is the same family as DeepSeek V4.1 on Cline's, and the
  // first version of this rule kept the vendor segment and so failed to pair them.
  const familyOf = (model) => stripVendorName(model).split(/(\d+(?:[.-]\d+)*)/)[0].replace(/[-_.]+$/, '');
  const cmp = (a, b) => {
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const d = (a[i] || 0) - (b[i] || 0);
      if (d) return d < 0 ? -1 : 1;
    }
    return 0;
  };
  const score = (lane) => (typeof scoreOf === 'function' ? scoreOf(lane) : null);
  const val = (lane) => {
    const s = score(lane);
    return typeof s === 'number' && Number.isFinite(s) ? s : null;
  };
  const out = [];
  const dropped = [];
  for (const lane of lanes || []) {
    const id = String(lane?.model || '');
    const mine = versionOf(id);
    const family = familyOf(id);
    const rival = (lanes || []).find((other) => {
      if (other === lane) return false;
      if (familyOf(other?.model || '') !== family) return false;
      return cmp(versionOf(other?.model || ''), mine) > 0;
    });
    if (!rival) { out.push(lane); continue; }
    const a = val(lane);
    const b = val(rival);
    // A newer model supersedes an older one unless it is measurably worse.
    if (b !== null && a !== null && b < a) { out.push(lane); continue; }
    if (b === null && a !== null) { out.push(lane); continue; }
    dropped.push({ model: id, supersededBy: String(rival?.model || ''), basis: a === null || b === null ? 'newer, no comparable score' : `newer and not worse (${b} >= ${a})` });
  }
  return { lanes: out, dropped };
}

/**
 * Identity of a model for matching across surfaces: the vendor prefix is not part
 * of it, everything else is. `opencode/space-bunny-free` and
 * `opencode-go/space-bunny-free` are one model; `mimo-v2.5-free` and
 * `mimo-v2.5:free` are two. Normalising punctuation away as well would merge those
 * two and delete a real lane, so only the prefix goes.
 */
function modelKey(s) {
  // The LAST path segment, not the first. A ref can carry more than one vendor
  // segment — Freebuff's is `freebuff/deepseek/deepseek-v4.1-flash` — and stripping
  // only the first left the catalog entry and the ledger row as two different keys,
  // so the fold added a second Freebuff row and /allowance listed the same terminal
  // lane twice. Punctuation is still preserved, so `mimo-v2.5-free` (OpenCode) and
  // `mimo-v2.5:free` (Token Harbor) stay two models.
  const raw = String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
  const segs = raw.split("/").filter(Boolean);
  return segs.length ? segs[segs.length - 1] : raw;
}

/**
 * THE row list. Both /allowance and /freemodel render this, so they cannot
 * disagree about how many models there are or which ones are usable.
 *
 * It did not used to be shared: each command deduplicated on its own — the table
 * collapsed the Token Harbor pair for display, the catalog side collapsed vendor
 * twins and the two Gemini spellings — and two hand-rolled notions of "the same
 * model" drifted by one row for four rounds of fixes. One function, one list.
 *
 * The rules, all of them the router's: the Token Harbor tools path and the
 * chat-only path are one shared `tokenharbor-free` bar and appear once; a lane
 * whose provider has no credential on this host is not a row here (it is reported
 * as a gap instead, with the variable it needs); and identity is the plan code, so
 * `google/gemini-…` and `gemini:gemini-…` are one model, as are `opencode/x` and
 * `opencode-go/x`.
 */
/**
 * Score for the supersession rule, read from the catalog's Ranked picks.
 *
 * A newer version replaces an older one only when the catalog does not rank the
 * newer one lower. The rule used to be able to promote a newer model on version
 * alone, which is how a newer-but-worse model would have won; with the catalog
 * rank as the ordering, "not worse" is a fact about the catalog rather than an
 * assumption about versions.
 */
export function laneScoreFromCatalog(lane) {
  try {
    return catalogScore(lane?.model || '');
  } catch {
    return null;
  }
}

/**
 * The reader's column spec, as numbers — one place, because two numbers is how
 * a 20-char cap in a 24-char column came to cut "nemotron-3.5-lightning"
 * mid-word: name(30) + 2 + plan(2) + 3 + reset(15) + 2 + score(7).
 */
export const MODEL_NAME_MAX = 30;
export const W_PLAN = 2;
export const W_EXPIRY = 15;
export const W_SCORE = 7;
export const MARK_CHARS = 2;
export const MARK_CELLS = 3;

/**
 * The three tier groups, in the order both surfaces render them.
 *
 * `high` is the coding-agent-capable pool, `light` is the documented
 * docs/inventory pool, and `unlisted` is a model the catalog does not rank — kept
 * visible and never promoted into `high`, because an unmeasured model is not a
 * coding model. The tier itself comes from the catalog (see free-catalogs.mjs),
 * never from a table in this file.
 */
export const TIER_GROUPS = [
  { tier: 'high', label: 'Coding-agent capable' },
  { tier: 'unlisted', label: 'Not in the catalog' },
  { tier: 'light', label: 'Light · docs/inventory' },
];

/**
 * Group canonical rows by catalog tier, in TIER_GROUPS order, dropping empty
 * groups. Both /allowance and /freemodel call this, which is what keeps the two
 * lists in the same order with the same rows — the count parity they are checked
 * for is a consequence of sharing this, not of two implementations agreeing.
 */
export function groupRowsByTier(rows, { tierOf = null } = {}) {
  const catalogTierOf = (r) => tierForModel(r?.model || r?.lane?.model || '').tier || 'unlisted';
  const tier = typeof tierOf === 'function' ? tierOf : (r) => catalogTierOf(r);
  const buckets = new Map(TIER_GROUPS.map((g) => [g.tier, []]));
  for (const r of rows || []) {
    const t = tier(r);
    const key = buckets.has(t) ? t : 'unlisted';
    buckets.get(key).push(r);
  }
  return TIER_GROUPS.map((g) => ({ ...g, rows: buckets.get(g.tier) })).filter((g) => g.rows.length > 0);
}

export function canonicalAllowanceLanes({ table, lanes = null, session = null, readiness = null, now = Date.now(), location = "", scoreOf = laneScoreFromCatalog, supersede = true } = {}) {
  if (!table || !Array.isArray(table.lanes)) return [];
  const projection = projectLanes(table, session, { now, location, readiness });
  const byLane = new Map(projection.map((r) => [laneKey(r.lane), r]));
  const kept = [];
  const seen = new Set();
  // `lanes` lets the caller hand in its own order — /allowance promotes the chat's
  // own lane to the top before calling, and that promotion has to survive the
  // filtering and the dedupe, or the current lane stops being row one.
  const source = Array.isArray(lanes) && lanes.length ? lanes : table.lanes;
  // One version per family: a model is dropped when a newer one of the same family
  // is present and not worse, so the list is not four near-identical choices.
  const { lanes: current } = supersede
    ? supersedeOlderVersions(source.filter((l) => l && l.provider && l.model), { scoreOf })
    : { lanes: source.filter((l) => l && l.provider && l.model) };
  for (const lane of dedupeTokenHarborLanes(current)) {
    const verdict = byLane.get(laneKey(lane));
    if (verdict && verdict.needsSetup) continue;
    const model = modelKey(lane.model);
    const key = model ? `${planCodeForLane(lane)}|${model}` : `${laneKey(lane)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(verdict || { lane, ref: toModelRefShim(lane.provider, lane.model), provider: lane.provider, model: lane.model, label: lane.label || lane.model, plan: planCodeForLane(lane), selectable: true, depleted: false, ended: false, terminalOnly: lane.tg === false });
  }
  return kept;
}

/**
 * Add a ledger row for every catalogued model that has none.
 *
 * The two surfaces drew their rows from different places: /freemodel from the
 * catalog (buildFreeModelList) and /allowance from the ledger table. A model the
 * catalog knew but the table did not — every Gemini row, and any provider added
 * to the catalog after the table was last written — therefore appeared in one
 * list and not the other, and had no row for the watcher to stamp, so its
 * allowance could never be tracked. Live on 2026-09-25: /freemodel offered 43
 * models of which 38 had no ledger row at all, and /allowance showed no Gemini
 * whatsoever.
 *
 * So the catalog is folded into the table at read time. Rows are appended after
 * the existing ones, which is what puts a model with no balance or no credential
 * at the bottom of the list instead of dropping it: the projection's own verdicts
 * (`needsSetup`, `terminalOnly`, `depleted`) then decide the tick, and the
 * watcher can stamp these rows like any other.
 *
 * Existing rows are never rewritten and nothing is removed, so a stamp, a reset
 * time or a family's position cannot be lost by a catalog refresh.
 */
export function withCatalogLanes(table, entries = [], { now = Date.now() } = {}) {
  if (!table || !Array.isArray(table.lanes)) return { table, added: [] };
  const lanes = [...table.lanes];
  let nextPref = lanes.reduce((m, l) => Math.max(m, Number(l.pref) || 0), 0);
  const added = [];
  // The same model reaches the catalog under more than one surface prefix:
  // `opencode/space-bunny-free`, `opencode-go/space-bunny-free` and
  // `cline:cline-free/kat-coder-pro` all name a model the table may already carry
  // under its own path. Matching on provider+model therefore folded in a second
  // row for it and the table showed the same model twice under two plan codes, so
  // the model id is compared with the vendor prefix and the surface stripped.
  const known = new Set(lanes.map((l) => modelKey(l.model)).filter(Boolean));
  for (const entry of entries || []) {
    const ref = typeof entry === "string" ? entry : entry?.ref || "";
    if (!ref) continue;
    // A pending-signin placeholder is not a model; it is the absence of one, and
    // it is already reported as a gap by /setup.
    if (typeof entry === "object" && entry && (entry.status === "pending-signin" || /^pending:/.test(ref))) continue;
    for (const route of routeCandidates(ref)) {
      const key = modelKey(route.model);
      if (!key || known.has(key)) continue;
      known.add(key);
      nextPref += 1;
      const terminalOnly = typeof entry === "object" && entry ? entry.selectable === false : false;
      // The table's own labels are short human names ("Space Bunny", "MiMo V2.6"),
      // and the renderer sizes its columns from them. The catalog's label is written
      // for /freemodel, so the surface prefix and the "(free)" suffix come off:
      // `opencode:big pickle (free)` reads as `big pickle`, not `opencode/big-pic`.
      const rawLabel = (typeof entry === "object" && entry?.label) || "";
      const cleanLabel = rawLabel
        .replace(/^[a-z][a-z0-9-]*:\s*/i, "")
        .replace(/\s*\(free\)\s*$/i, "")
        .trim();
      const lane = {
        pref: nextPref,
        provider: route.provider,
        model: route.model,
        label: cleanLabel || shortModelName(route.model) || route.model,
        // `available` means "not known to be spent". The projection is what refuses
        // to offer it — a missing credential, a terminal-only tool or a live
        // depletion record each turn the row into its own honest verdict, and a
        // row stamped by the watcher flips this to `depleted` on its own.
        status: "available",
        ...(terminalOnly ? { tg: false } : {}),
        fromCatalog: true,
        addedAt: isoZ(now),
      };
      lanes.push(lane);
      added.push(lane);
    }
  }
  return { table: added.length ? { ...table, lanes } : table, added };
}

/**
 * Catalog entries for lane rows the catalog does not mention.
 *
 * withCatalogLanes goes one way — catalog into the table — and that is enough for
 * /allowance. It is not enough for /freemodel: a model that lives only in the
 * ledger, which is where the Token Harbor, Cloudflare and Freebuff rows come from
 * (they are not in the OpenCode models cache the catalog reads), had no entry and
 * so was never offered as a tap target even though /allowance listed it. Live on
 * 2026-09-25: five Token Harbor and Cloudflare rows were in the table and in
 * /allowance, and absent from /freemodel entirely.
 *
 * So the other direction is needed too, and the result is the union the user asked
 * for: every model either surface knows about, listed once.
 */
export function entriesFromLanes(table, entries = []) {
  if (!table || !Array.isArray(table.lanes)) return [];
  const known = new Set((entries || []).map((e) => modelKey(typeof e === "string" ? e : e?.ref || "")).filter(Boolean));
  const out = [];
  for (const lane of table.lanes) {
    if (!lane || !lane.model) continue;
    const key = modelKey(lane.model);
    if (!key || known.has(key)) continue;
    known.add(key);
    out.push({
      ref: toModelRefShim(lane.provider, lane.model),
      label: lane.label || lane.model,
      surface: lane.provider,
      tool: lane.provider,
      provider: effectiveProviderOf(lane),
      // A terminal-only tool stays visible with its verdict rather than being
      // offered as something to tap.
      selectable: lane.tg !== false,
      location: "",
      ...(lane.tg === false ? { note: "terminal-only" } : {}),
    });
  }
  return out;
}

/** Minimal table built from the repo pref doc when no live ledger exists. */
export function tableFromPreferenceDoc(prefDoc) {
  const lanes = Array.isArray(prefDoc?.lanes) ? prefDoc.lanes : [];
  return {
    version: prefDoc?.version ?? 3,
    failover: prefDoc?.failover || "same-family first (skip depleted), then next available by pref #",
    updatedAt: prefDoc?.updatedAt || null,
    buckets: {},
    lanes: lanes.map((l) => ({
      pref: l.pref,
      family: l.family || null,
      provider: l.provider || "",
      model: l.model || "",
      label: l.label || l.model || "",
      bucket: l.bucket || "",
      tg: l.tg !== false,
      resetRule: l.resetRule || "",
      notes: l.notes || l.note || "",
      status: "available",
      nextReset: l.resetRule || "-",
      nextResetAt: null,
      cooldownLeft: "-",
    })),
  };
}

/**
 * Load the free-lane ledger for a non-router bot. Never throws: returns
 * { table, session, tablePath, sessionPath, source }. Source is one of
 * `live-state`, `pref-doc-fallback`, or `empty` (no ledger found).
 */
export function loadFreeLaneLedger({ stateDir = null, tablePath = null, sessionPath = null, catalogEntries = null } = {}) {
  const dirs = candidateRouterStateDirs(stateDir);
  // The lane CATALOGUE is the host's, not a worker's. It is one table, owned by the
  // router state and stamped by the allowance watcher, and every bot on the host must
  // read that one — otherwise the bots drift apart and each shows a different list.
  // Live on 2026-09-25: vm's private copy had decayed to a 7-lane stub with no
  // updatedAt while vm2's still had 17, so the same command answered 43 rows on one
  // bot and 50 on the other.
  //
  // What IS per-worker is the quota session: which lanes this worker has spent. So
  // the table comes from the first host-wide directory that has one, and the session
  // always comes from the directory the caller named. A FREE_LANES_DIR proof still
  // works, because a stamp in the copy is read from the copy.
  const hostFirst = tablePath ? dirs : [...dirs.filter((d) => d !== stateDir), ...(stateDir ? [stateDir] : [])];
  for (const dir of hostFirst) {
    const tPath = tablePath || join(dir, "free-lane-table.json");
    const table = readJson(tPath);
    if (table && Array.isArray(table.lanes)) {
      // Fold the catalog in so /allowance shows the same rows /freemodel offers,
      // including models the table predates. Without this the two lists disagree
      // and a catalogued model has no row for the watcher to stamp.
      const merged = catalogEntries ? withCatalogLanes(table, catalogEntries).table : table;
      const sDir = stateDir || dir;
      const sPath = sessionPath || join(sDir, "session.json");
      return { table: merged, session: readSessionWithSharedQuota(sDir), tablePath: tPath, sessionPath: sPath, source: "live-state" };
    }
  }
  // Fallback: repo pref doc → all-available table so /allowance still shows order.
  try {
    let dir = HERE;
    for (let i = 0; i < 6; i++) {
      const prefPath = join(dir, "tools", "telegram-provider-router", "docs", "free-lane-preference.json");
      const pref = readJson(prefPath);
      if (pref && Array.isArray(pref.lanes)) {
        return { table: tableFromPreferenceDoc(pref), session: {}, tablePath: prefPath, sessionPath: null, source: "pref-doc-fallback" };
      }
      const alt = join(dir, "docs", "free-lane-preference.json");
      const pref2 = readJson(alt);
      if (pref2 && Array.isArray(pref2.lanes)) {
        return { table: tableFromPreferenceDoc(pref2), session: {}, tablePath: alt, sessionPath: null, source: "pref-doc-fallback" };
      }
      const up = dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  } catch {}
  return { table: null, session: {}, tablePath: null, sessionPath: null, source: "empty" };
}

/** `cline:...` / `gemini:...` / provider-prefixed refs → route candidates. */
function routeCandidates(ref) {
  const raw = String(ref ?? "").trim();
  if (!raw) return [];
  if (raw.startsWith("cline:")) return [{ provider: "cline", model: raw.slice("cline:".length) }];
  if (raw.startsWith("gemini:")) return [{ provider: "gemini", model: raw.slice("gemini:".length) }];
  if (raw.startsWith("opencode:")) return [{ provider: "opencode", model: raw.slice("opencode:".length) }];
  if (!raw.includes("/")) return [{ provider: "opencode", model: raw }];
  const [provider, ...rest] = raw.split("/");
  const candidates = [{ provider, model: raw }];
  if (provider === "tokenharbor" || provider === "cloudflare") candidates.push({ provider: "opencode", model: raw });
  if (provider === "opencode" && rest[0] === "tokenharbor") candidates.push({ provider: "tokenharbor", model: rest.slice(1).join("/") });
  return candidates;
}

export function freemodelRefToRoute(ref) {
  return routeCandidates(ref)[0] || { provider: "", model: "" };
}

/** True when this /freemodel entry is currently depleted in the shared ledger. */
export function isFreemodelEntryDepleted(entry, table, session, { now = Date.now() } = {}) {
  try {
    if (!table || !Array.isArray(table.lanes)) return false;
    const ref = typeof entry === "string" ? entry : entry?.ref || entry?.model || "";
    const candidates = routeCandidates(ref);
    if (!candidates.length || candidates.some((route) => route.provider === "gemini")) return false;
    // A stamped route with no table lane row still counts (route-key fallback).
    if (liveRecForRoutes(candidates, session, now)) return true;
    const lane = candidates.map((route) => table.lanes.find((l) => laneMatchesRoute(l, route.provider, route.model))).find(Boolean);
    if (!lane) return false;
    if (liveRecForLane(lane, session, now)) return true;
    if (lane.status === "depleted" && lane.nextResetAt && Date.parse(lane.nextResetAt) > now) return true;
    return false;
  } catch {
    return false;
  }
}

/** Annotate bot-host /freemodel entries with { depleted, resetIn, laneLabel }. */
export function annotateFreemodelEntries(entries, table, session, { now = Date.now(), location = "", readiness = null } = {}) {
  // One projection decides the verdict, so /freemodel cannot offer a lane that
  // /allowance is showing as ended, terminal-only or depleted.
  const projection = projectLanes(table, session, { now, location, readiness });
  const byRef = new Map(projection.map((r) => [r.ref, r]));
  return (entries || []).map((e) => {
    const ref = typeof e === "string" ? e : e?.ref || "";
    const lane = routeCandidates(ref)
      .map((route) => table?.lanes?.find((l) => laneMatchesRoute(l, route.provider, route.model)))
      .find(Boolean) || null;
    // The same model on two vendor prefixes is one ledger row, so a bullet that
    // names the second prefix must resolve to that row instead of reporting "no
    // ledger row" for a model whose allowance is right there in the table. Live on
    // 2026-09-25: `opencode-go:space-bunny-free` was listed with no ledger row
    // while `opencode:space bunny free` carried it.
    const twin = lane || (table?.lanes || []).find((l) => {
      const k = modelKey(routeCandidates(ref)[0]?.model || "");
      return k && modelKey(l.model) === k;
    }) || null;
    const refRoute = routeCandidates(ref)[0];
    // Match by model identity, not by string shape. A lane's ref is not always
    // spelled the way the catalog spells it — the Freebuff lane's projection ref is
    // `deepseek/deepseek-v4.1-flash` with no provider prefix at all, while the
    // catalog entry is `freebuff/deepseek/deepseek-v4.1-flash` — so an exact ref
    // lookup missed it and the row fell back to "available". That is how a
    // terminal-only lane came back tappable in /freemodel while /allowance marked
    // it not usable. Same model, one row, one verdict.
    const byModelIdentity = new Map(projection.map((r) => [modelKey(r.model), r]));
    const verdict = byRef.get(ref)
      || (twin ? byModelIdentity.get(modelKey(twin.model)) : null)
      || byModelIdentity.get(modelKey(refRoute?.model || ""))
      || projection.find((r) => r.provider === refRoute?.provider
        && String(r.model).replace(/^[^/]+\//, '') === String(refRoute?.model || '').replace(/^[^/]+\//, ''));
    const depleted = verdict ? verdict.depleted : isFreemodelEntryDepleted(e, table, session, { now });
    let resetIn = "-";
    try {
      const routeHit = liveRecForRoutes(routeCandidates(ref), session, now);
      const at = lane?.nextResetAt || lane?.cooldownUntil || routeHit?.rec?.depletedUntil || null;
      resetIn = depleted ? formatResetIn(at, now) : "-";
    } catch {}
    return {
      ...e,
      depleted,
      resetIn,
      laneLabel: (twin || lane)?.label || null,
      // the same three verdicts /allowance renders, on the same rows
      ended: Boolean(verdict?.ended),
      terminalOnly: Boolean(verdict?.terminalOnly),
      inLedger: Boolean(verdict),
      selectable: verdict ? verdict.selectable : !depleted,
      reason: verdict?.reason || (verdict ? '' : 'not in this ledger'),
    };
  });
}

/**
 * Compact /allowance text for bot-host/collab/mobile. Loads the shared ledger
 * (live router state → pref-doc fallback) and renders the same
 * `formatCompactAllowanceChat` the router uses, so every bot shows one table.
 * Pass the chat's effective provider/model so the `Active route` + `Next up`
 * lines are chat-aware (bot-host has no sticky session like the router).
 */
export function buildAllowanceTextForBots({ stateDir = null, provider = "", model = "", location = "", now = Date.now(), labelFn = defaultResetLabel, readiness = null, catalogEntries = null } = {}) {
  const { table, session, source } = loadFreeLaneLedger({ stateDir, catalogEntries });
  if (!table) {
    return "Allowance: no shared free-lane ledger found (router state + pref doc missing). Use /freemodel to list free models.";
  }
  try {
    const sess = provider && model
      ? { ...session, provider, models: { ...(session?.models || {}), [provider]: model } }
      : session;
    // Rendered from the same projection /freemodel and the turn's walk read, so
    // a lane cannot be ❌ here and selectable there. Rows the projection drops
    // (ended, or a terminal-only row that is not in the table) are not invented
    // back here.
    const projection = projectLanes(table, sess, { now, labelFn, location, readiness });
    // The same component the Grok router renders with, fed the projection. A
    // second renderer is how the columns drifted apart in the first place.
    const body = formatCompactAllowanceChat(table, sess, {
      now,
      labelFn,
      rows: projection.length ? projection : null,
      currentModel: provider && model ? `${provider}/${model}` : "",
    });
    // The Host line duplicated the location the caller already prints ("Free models
    // at vps"), and it sat in the proportional font directly above a monospace
    // block, so the two did not share a left edge. Inside the block, one line.
    const prefix = location ? `Host: ${location} · own provider credentials and quota\n` : '';
    // One code block for the whole message. Split it and the prose above the table
    // renders in the proportional font with a different left edge and a different
    // line width, which is what makes a message look raggedly aligned even when the
    // table inside it is not.
    const note = source === "pref-doc-fallback"
      ? `\n\n(note: per-bot ledger not yet stamped — pref order only until first quota hit)`
      : '';
    return `<code>${escHtml(prefix + body + note)}</code>`;
  } catch (e) {
    return `Allowance failed: ${String(e?.message || e).slice(0, 200)}`;
  }
}

// ---------------------------------------------------------------------------
// Per-bot ledger (consolidation of the Grok router's tracker into the main
// bot framework). Each bot-host bot keeps its OWN ledger under its own state
// dir — quota is per-account/host, so bot A must never read bot B's stamps.
// The router box keeps using TG_ROUTER_STATE_DIR; bot-host uses
// ~/.local/state/bot-host/<botId>/free-lanes (created + seeded on first use).
// ---------------------------------------------------------------------------

/**
 * Per-bot ledger dir for a bot-host bot id (created on demand).
 *
 * FREE_LANES_DIR points one process at a different directory. That exists so a
 * live proof can run against a COPY of the ledger and leave the user's real one
 * byte-identical, which plan/R14_1_AGENT_PLAN.md card 6 requires ("use a copy of
 * the ledger for the bot under test; the real user ledger mtime is unchanged
 * before and after").
 *
 * It names ONE directory for this process. It is deliberately not a shared
 * default across bots: cards 5 and 6 need one ledger per worker, and a
 * directory that every bot on the host writes to would make a phone run look
 * like a VM run.
 */
export function resolveBotLedgerDir(botId) {
  const home = process.env.HOME || process.env.USERPROFILE || osHomedirFallback();
  const override = String(process.env.FREE_LANES_DIR || "").trim();
  const dir = override || join(home, ".local", "state", "bot-host", String(botId || "default"), "free-lanes");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function osHomedirFallback() {
  try {
    return resolve(HERE, "..", "..");
  } catch {
    return ".";
  }
}

/** Repo pref-doc path (walk up from this file), or null. */
export function findPrefDocPath() {
  try {
    let dir = HERE;
    for (let i = 0; i < 6; i++) {
      const p = join(dir, "tools", "telegram-provider-router", "docs", "free-lane-preference.json");
      if (existsSync(p)) return p;
      const up = dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  } catch {}
  return null;
}

/**
 * Ensure a bot's own ledger exists (seed table from pref doc on first use).
 * Returns { tablePath, sessionPath, seeded }. Never throws.
 */
export function ensureBotLedger(botId) {
  const dir = resolveBotLedgerDir(botId);
  const tablePath = join(dir, "free-lane-table.json");
  const sessionPath = join(dir, "session.json");
  let seeded = false;
  try {
    if (!existsSync(tablePath)) {
      const prefPath = findPrefDocPath();
      const pref = prefPath ? readJson(prefPath) : null;
      if (pref && Array.isArray(pref.lanes)) {
        writeFileSync(tablePath, JSON.stringify(tableFromPreferenceDoc(pref), null, 2));
        seeded = true;
      }
    }
    if (!existsSync(sessionPath)) writeFileSync(sessionPath, JSON.stringify({ quota: {} }, null, 2));
  } catch {}
  return { dir, tablePath, sessionPath, seeded };
}

function writeJsonAtomic(filePath, obj) {
  const tmp = `${filePath}.tmp.${process.pid}`;
  try {
    writeFileSync(tmp, JSON.stringify(obj, null, 2));
    renameSync(tmp, filePath);
  } catch {
    try { writeFileSync(filePath, JSON.stringify(obj, null, 2)); } catch {}
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch {}
  }
}

/**
 * Stamp one quota failure into a bot's OWN ledger (the automation behind the
 * screenshot footer: "empty/rate-limit stamps Reset"). Refuses doc-noise and
 * empty errors so only real vendor quota proof depletes a lane. Writes
 * session.quota (route + shared-bucket keys) and overlays the table —
 * pref order untouched. Returns { stamped, keys } or { stamped: false, reason }.
 */
export function stampCooldown({ stateDir, provider, model, errText, kind = "connection-failed", ttlMs = CONNECTION_FAILED_COOLDOWN_MS, now = Date.now() } = {}) {
  return stampDepleted({
    stateDir,
    provider,
    model,
    errText,
    kind,
    depletedUntil: now + Math.max(1000, Number(ttlMs) || CONNECTION_FAILED_COOLDOWN_MS),
  });
}

/**
 * Providers whose quota belongs to the host's account, not to one bot.
 *
 * Cline, Gemini, Token Harbor and Cloudflare are all reached with one key for
 * this host — the same key for every bot-host bot — so their daily caps and rate
 * limits are host-wide. A depletion one bot hits is true for all of them. Live on
 * 2026-09-25: vm recorded Cline's real "Daily free limit reached" 429 and showed
 * the model ❌ with a reset, while vm2, on the same account and the same host,
 * showed it ✅ and would have walked into the same 429.
 *
 * OpenCode is deliberately NOT here. Its free lanes are per-chat stickies and its
 * per-model counters are what a bot earns by using them, so those stamps stay
 * per-bot. Freebuff is terminal-only and never walked.
 */
const HOST_ACCOUNT_PROVIDERS = new Set(["cline", "gemini", "tokenharbor", "cloudflare"]);

/** True when this route's quota is the host account's, shared by every bot. */
export function isHostAccountRoute(provider, model = "") {
  const p = String(provider || "").toLowerCase();
  if (HOST_ACCOUNT_PROVIDERS.has(p)) return true;
  if (p === "opencode") {
    const m = String(model || "").toLowerCase();
    return m.includes("tokenharbor/") || m.includes("cloudflare/") || m.includes("gemini");
  }
  return false;
}

/**
 * Host-shared quota dir, beside the per-bot ones.
 *
 * FREE_LANES_SHARED_DIR overrides it, for the same reason FREE_LANES_DIR exists:
 * a live proof must be able to run against copies and leave the real ledgers
 * byte-identical, and a test must never write to the host's shared state.
 */
export function resolveSharedLedgerDir() {
  const override = String(process.env.FREE_LANES_SHARED_DIR || "").trim();
  if (override) {
    mkdirSync(override, { recursive: true });
    return override;
  }
  const home = process.env.HOME || process.env.USERPROFILE || osHomedirFallback();
  const dir = join(home, ".local", "state", "bot-host", "shared-free-lanes");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * The session a bot should read: its own, plus the host account's stamps.
 *
 * The per-bot file stays the record of what that bot did; the shared file is the
 * record of what the account has left. A host-account key is taken from the shared
 * file when it is there, because that is the wider truth, and the bot's own copy is
 * kept for its own history.
 */
export function readSessionWithSharedQuota(stateDir) {
  const own = stateDir ? readJson(join(stateDir, "session.json")) || {} : {};
  if (!stateDir) return own;
  let shared = {};
  try {
    shared = readJson(join(resolveSharedLedgerDir(), "session.json")) || {};
  } catch {}
  const ownQuota = { ...(own.quota || {}) };
  const sharedQuota = shared.quota || {};
  if (!Object.keys(sharedQuota).length) return own;
  const quota = { ...ownQuota };
  for (const [key, rec] of Object.entries(sharedQuota)) {
    const route = routeCandidates(key.replace(/^bucket:/, ""))[0] || {};
    if (!isHostAccountRoute(route.provider, route.model)) continue;
    // The shared record is authoritative for a host account: it was written by
    // whichever bot actually hit the limit, and it describes all of them.
    quota[key] = { ...rec, sharedFrom: "host-account" };
  }
  return { ...own, quota };
}

export function stampDepleted({ stateDir, provider, model, errText, depletedUntil = null, countdownHint = "", kind = "limit-unknown", now = Date.now() } = {}) {
  try {
    const err = String(errText || "").slice(0, 300);
    if (!err || isDocLikeQuotaNoise(err)) return { stamped: false, reason: "refused: doc-noise or empty, not a provider limit" };
    if (!stateDir || !existsSync(join(stateDir, "free-lane-table.json"))) {
      return { stamped: false, reason: "no bot ledger (call ensureBotLedger first)" };
    }
    const tablePath = join(stateDir, "free-lane-table.json");
    const sessionPath = join(stateDir, "session.json");
    const table = readJson(tablePath);
    if (!table || !Array.isArray(table.lanes)) return { stamped: false, reason: "ledger table unreadable" };
    const lane = (table.lanes || []).find((l) => laneMatchesRoute(l, provider, model));
    const barEmpty = isTokenHarborBarExhausted(errText);
    const until = Number(depletedUntil) > now
      ? Number(depletedUntil)
      : now + (barEmpty ? TOKEN_HARBOR_WEEKLY_BAR_MS : 6 * 3600 * 1000);
    const session = readJson(sessionPath) || {};
    session.quota = session.quota || {};
    const keys = lane ? quotaKeysForLane(lane) : [`${provider}/${model}`].filter((k) => k !== "/");
    if (!keys.length) return { stamped: false, reason: "no quota key for route" };
    for (const key of keys) {
      session.quota[key] = {
        depletedUntil: until,
        lastError: err,
        scope: key.startsWith("bucket:") ? "shared" : "per-model",
        depletedObservedAt: isoZ(now),
        countdownParsed: Boolean(countdownHint),
        kind,
        ...(countdownHint ? { countdownHint } : {}),
      };
    }
    writeJsonAtomic(sessionPath, session);
    // A host account's limit is every bot's limit, so the stamp also goes to the
    // shared file. Without this the bot that did not hit the 429 keeps offering the
    // model, and the two lists disagree about a cap that is objectively the same.
    let shared = false;
    if (isHostAccountRoute(provider, model)) {
      try {
        const sharedDir = resolveSharedLedgerDir();
        const sharedPath = join(sharedDir, "session.json");
        const sharedSession = readJson(sharedPath) || {};
        sharedSession.quota = sharedSession.quota || {};
        for (const key of keys) sharedSession.quota[key] = session.quota[key];
        writeJsonAtomic(sharedPath, sharedSession);
        shared = true;
      } catch {}
    }
    const sync = syncFreeLaneTableFromSession({ tablePath, session, now });
    return { stamped: true, keys, shared, tableChanges: sync.changes || [] };
  } catch (e) {
    return { stamped: false, reason: String(e?.message || e).slice(0, 160) };
  }
}

