#!/usr/bin/env node
/**
 * Freebuff model catalog helpers (pure logic; the CLI lives in
 * scripts/sync-freebuff-models.mjs).
 *
 * Source of truth: GET https://www.codebuff.com/api/v1/freebuff/session with the
 * Freebuff auth token (~/.config/manicode/credentials.json → default.authToken).
 * That payload is the same one the TUI picker renders, and it carries the whole
 * picture: the shared daily Freebucks pool, per-model price, plan-required ids,
 * per-model daily caps, off-peak windows and price-change notices.
 *
 * Why this file exists (corrections found 2026-09-25):
 * - `/api/v1/usage` reports the WALLET/subscription balance (0, next reset
 *   2026-10-16). That is NOT the Freebucks pool the picker spends. The pool
 *   lived at /api/v1/freebuff/session (10 of 25 left that day). Reading the
 *   wrong one made Freebuff look empty for a month.
 * - Only `stealth/space-bunny-alpha` costs 0 Freebucks. Everything else is
 *   metered (5–80), so "0/hr" on a 5-FB model was a lie in the UI.
 * - `xiaomi/mimo-v2.6-flash` and `deepseek/deepseek-v4.1-flash` are NOT in the
 *   catalog (real ids: mimo/mimo-v2.5, mimo/mimo-v2.6-pro, deepseek/deepseek-v4-flash).
 *
 * Rules (covered by scripts/test-freebuff-model-sync.mjs):
 * - Upsert only, never delete; unknown/plan-required ids are reported, not enrolled.
 * - A catalog id that vanished from the published price list is reported as
 *   STALE (operator decides; we never silently drop a lane).
 * - Existing lane status is preserved (the watcher owns availability; this sync
 *   owns catalog facts: price, plan-required, caps, notices).
 */
export const FREEBUFF_SESSION_URL = "https://www.codebuff.com/api/v1/freebuff/session";
export const FREEBUFF_BUCKET = "freebuff-freebucks";

/** Parse the session payload into pool + per-model facts. */
export function parseFreebuffCatalog(payload) {
  const fb = payload?.freebucks || {};
  const prices = fb.prices && typeof fb.prices === "object" ? fb.prices : {};
  const planRequired = new Set(Array.isArray(fb.planRequiredModelIds) ? fb.planRequiredModelIds : []);
  const notices = fb.priceNotices && typeof fb.priceNotices === "object" ? fb.priceNotices : {};
  const limits = payload?.rateLimitsByModel && typeof payload.rateLimitsByModel === "object" ? payload.rateLimitsByModel : {};

  const models = Object.entries(prices)
    .map(([id, price]) => {
      const lim = limits[id] || null;
      return {
        id,
        priceFreebucks: Number(price) || 0,
        planRequired: planRequired.has(id),
        dailyLimit: lim && Number.isFinite(Number(lim.limit)) ? Number(lim.limit) : null,
        dailyResetAt: lim?.resetAt || null,
        notice: notices[id] || "",
        offPeak: fb.offPeak?.[id] ? { ...fb.offPeak[id] } : null,
      };
    })
    .sort((a, b) => a.priceFreebucks - b.priceFreebucks || a.id.localeCompare(b.id));

  return {
    accessTier: String(payload?.accessTier || "unknown"),
    countryBlockReason: String(payload?.countryBlockReason || ""),
    pool: {
      balance: Number(fb.balance ?? fb.daily?.remaining ?? 0) || 0,
      dailyLimit: Number(fb.daily?.limit ?? 0) || 0,
      dailySpent: Number(fb.daily?.spent ?? 0) || 0,
      dailyRemaining: Number(fb.daily?.remaining ?? 0) || 0,
      resetAt: fb.daily?.resetAt || null,
      resetTimeZone: fb.daily?.resetTimeZone || null,
      walletBalance: Number(fb.wallet?.balance ?? 0) || 0,
    },
    models,
  };
}

/** Cheapest non-plan-required model — the default lane (prefers the 0-FB one). */
export function defaultFreebuffModelId(catalog) {
  const usable = (catalog?.models || []).filter((m) => !m.planRequired);
  return usable.length ? usable[0].id : "";
}

/** "GLM 5.3 Flash · 5 FB" (0 FB reads as free; notices appended when present). */
export function freebuffModelLabel(model) {
  const name = String(model?.id || "")
    .replace(/^[^/]+\//, "")
    .replace(/-/g, " ")
    .replace(/\bv(\d)/gi, "v$1")
    .trim();
  const pretty = name.charAt(0).toUpperCase() + name.slice(1);
  const price = Number(model?.priceFreebucks || 0);
  const tag = price === 0 ? "free · 0 FB" : `${price} FB`;
  const notice = model?.notice ? ` · ${model.notice}` : "";
  return `${pretty} · ${tag}${notice}`;
}

/**
 * Plan upserts against the lane table. Never mutates: returns one entry per
 * catalog model plus stale/plan-required reports.
 */
export function planFreebuffUpserts(table, catalog) {
  const lanes = Array.isArray(table?.lanes) ? table.lanes : [];
  const fbLanes = lanes.filter((l) => String(l?.provider || "").toLowerCase() === "freebuff");
  const catalogIds = new Set((catalog?.models || []).map((m) => m.id));
  const maxPref = lanes.reduce((m, l) => Math.max(m, Number(l?.pref) || 0), 0);

  const enroll = [];
  const skipped = [];
  for (const m of catalog?.models || []) {
    if (m.planRequired) {
      skipped.push({ id: m.id, reason: "requires a paid Freebuff plan" });
      continue;
    }
    const existing = fbLanes.find((l) => String(l.model) === m.id);
    if (existing) {
      enroll.push({ action: "update", index: lanes.indexOf(existing), lane: existing, model: m, created: false });
    } else {
      enroll.push({
        action: "new",
        index: -1,
        created: true,
        model: m,
        lane: {
          pref: maxPref + enroll.filter((e) => e.created).length + 1,
          provider: "freebuff",
          model: m.id,
          bucket: FREEBUFF_BUCKET,
          label: freebuffModelLabel(m),
          family: String(m.id).replace(/^[^/]+\//, ""),
          status: "available",
          nextResetAt: null,
          cooldownUntil: null,
          priceFreebucks: m.priceFreebucks,
          planRequired: false,
          dailyLimit: m.dailyLimit,
          dailyResetAt: m.dailyResetAt,
        },
      });
    }
  }
  // Lanes the catalog no longer publishes (xiaomi/mimo-v2.6-flash,
  // deepseek/deepseek-v4.1-flash, ...) — reported and flagged by the CALLER
  // (this planner never mutates). The flag matters: without it an unpublished
  // lane still marked `available` in the ledger would keep showing up as a
  // /freemodel tap for a model the vendor dropped.
  const stale = fbLanes
    .filter((l) => !catalogIds.has(String(l.model)))
    .map((l) => ({
      id: String(l.model),
      index: lanes.indexOf(l),
      pref: l.pref,
      status: l.status,
      needsFlag: !l.catalogStale,
      reason: "not in published catalog (flag, never delete)",
    }));
  return { enroll, skipped, stale, pool: catalog?.pool || null };
}
