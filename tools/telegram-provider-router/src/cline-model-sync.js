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
  const found = lanes.findIndex((l) => tail(l?.model) === tail(id));
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
