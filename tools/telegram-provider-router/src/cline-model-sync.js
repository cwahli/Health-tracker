#!/usr/bin/env node
/**
 * Cline free-lane enrollment helpers (pure logic; the CLI lives in
 * scripts/sync-cline-models.mjs).
 *
 * Why this exists: the Cline CLI (0.0.195) exposes NO model catalog —
 * no list command, `config` needs a TTY, bogus `-m` ids fail server-side
 * without listing alternatives, the hub has no catalog endpoint, and nothing
 * is cached under ~/.cline. So fully automatic discovery is impossible;
 * enrollment is explicit (`--models` from the Cline dashboard), and everything
 * downstream is automatic (ledger-driven /freemodel candidates, watcher
 * re-probes, shared-bucket failover).
 *
 * Rules (all covered by scripts/test-cline-model-sync.mjs):
 * - IDs are `modelType/model` (CLI format). A bare name gets `cline-free/`.
 *   Anything else is skipped as invalid-format — never enrolled.
 * - DEAD lanes never enroll: "promotion ended" / "no longer available" /
 *   "invalid model format" in probe output means the id is dead, NOT
 *   depleted. (core.probeCli would otherwise read validation-error output
 *   with a clean exit as AVAILABLE — this guard runs first.)
 * - Upsert only: match by tail-normalized model (strip provider prefix +
 *   :free/-free, same as ht-watch). Existing lanes keep their pref;
 *   new lanes get maxPref+1 on bucket `cline-per-model` (per-model daily
 *   caps). Nothing is ever deleted, pref order never re-sorted, non-cline
 *   lanes never touched.
 * - Uncertain probes change nothing (no false depletion, no false revival).
 */
export const CLINE_BUCKET = "cline-per-model";
export const CLINE_FREE_PREFIX = "cline-free/";

/** Dead-model vendor text: the id is gone, not limited. "" = alive/unknown. */
export function isClineDeadModel(output) {
  return /promotion ended|no longer available|invalid model format|model not found|unknown model/i.test(
    String(output || "")
  );
}

/**
 * Free-model ids from the CLI's own recommended-models catalog
 * (GET https://api.cline.bot/api/v1/ai/cline/recommended-models, bearer =
 * ~/.cline/data/settings/providers.json accessToken).
 *
 * This is the discovery source the TUI reads — the one place Cline publishes
 * its free set, so "which free models exist" is answered without scraping the
 * screen. Trust the CATALOG, not the id text: free ids do NOT have to contain
 * "free" (e.g. `stealth/space-bunny-alpha` is a free lane), which is why the
 * name-based guard only applies to manually supplied ids.
 */
export const CLINE_CATALOG_URL = "https://api.cline.bot/api/v1/ai/cline/recommended-models";

export function freeModelIdsFromCatalog(payload) {
  const free = Array.isArray(payload?.free) ? payload.free : [];
  const out = [];
  const seen = new Set();
  for (const m of free) {
    const id = normalizeClineModelId(m?.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: String(m?.name || id), description: String(m?.description || "").slice(0, 120) });
  }
  return out;
}

/** Manual ids only: refuse anything not obviously free (a probe is a real run). */
export function looksFreeId(id) {
  return /free/i.test(String(id || ""));
}

/** Normalize a user-supplied id to lane form, or "" when invalid. */
export function normalizeClineModelId(raw) {
  const m = String(raw || "").trim();
  if (!m) return "";
  const full = m.includes("/") ? m : `${CLINE_FREE_PREFIX}${m}`;
  if (!/^[^/\s]+\/[^/\s]+$/.test(full)) return "";
  return full;
}

const tail = (x) =>
  String(x || "")
    .replace(/^[^/]+\//, "")
    .replace(/:free$/i, "")
    .replace(/-free$/i, "");

/** Human label from a lane id ("cline-free/foo-bar" → "foo bar free"). */
export function prettifyClineLabel(model) {
  return tail(model)
    .replace(/-contributor$/i, "")
    .replace(/[-_]+/g, " ")
    .trim()
    .replace(/\s+free$/i, "")
    .concat(" free");
}

/**
 * Plan one upsert against the table. Returns {action, index, lane}:
 *   new    → index -1, lane = fresh object the caller pushes on success
 *   update → index into table.lanes, lane = live reference the caller edits
 *   skip-* → index -1, lane null, with reason
 * Only planLaneUpsert-transitions mutate; the planner itself is pure
 * (it never writes the table — the caller's apply step does).
 */
export function planLaneUpsert(table, { model, probe }) {
  const id = normalizeClineModelId(model);
  if (!id) return { action: "skip-invalid", index: -1, lane: null, reason: `invalid id ${JSON.stringify(String(model))}` };
  const out = String(probe?.output || "");
  if (isClineDeadModel(out)) return { action: "skip-dead", index: -1, lane: null, reason: `${id}: promotion ended / unknown` };
  const lanes = Array.isArray(table?.lanes) ? table.lanes : [];
  // Provider-scoped match: `cline-free/mimo-v2.6-flash` and
  // `tokenharbor/mimo-v2.6-flash:free` share a tail but are different lanes
  // with separate buckets. A tail-only match let a Cline probe overwrite the
  // Token Harbor lane's status (caught by dry-run 2026-09-25).
  const found = lanes.findIndex(
    (l) => String(l?.provider || "").toLowerCase() === "cline" && tail(l?.model) === tail(id)
  );
  if (probe?.status === "uncertain") {
    return { action: "skip-uncertain", index: found, lane: found >= 0 ? lanes[found] : null, reason: `${id}: probe uncertain, status kept` };
  }
  if (probe?.status !== "available" && probe?.status !== "depleted") {
    return { action: "skip-uncertain", index: found, lane: found >= 0 ? lanes[found] : null, reason: `${id}: no probe result, status kept` };
  }
  if (found >= 0) return { action: "update", index: found, lane: lanes[found], probe };
  const maxPref = lanes.reduce((m, l) => Math.max(m, Number(l?.pref) || 0), 0);
  return {
    action: "new",
    index: -1,
    lane: {
      pref: maxPref + 1,
      provider: "cline",
      model: id,
      bucket: CLINE_BUCKET,
      label: prettifyClineLabel(id),
      family: tail(id),
      status: "available",
      nextResetAt: null,
      cooldownUntil: null,
    },
    probe,
  };
}
