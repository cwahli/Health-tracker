/**
 * The pure half of the free-lane check (`scripts/probe-free-lanes.mjs`).
 *
 * The check itself is a script with side effects — it prints, it pings a vendor,
 * it stamps the ledger — so the two decisions worth a sensor could not be tested
 * where they lived. Those two decisions are:
 *
 *   1. which lanes a burn ping may target, and
 *   2. how one lane is pinged.
 *
 * (2) matters because the answer is not "always through OpenCode": a Cline lane
 * pinged through the OpenCode CLI is answered `model not found` / `Invalid model
 * reference`, which the runner reports as a *connection* failure and the check
 * prints as an inconclusive ping — so a lane that answers perfectly well looked
 * like a broken lane, and the lane operators care most about (Cline's Muse Spark
 * free) was never actually checked.
 */

import { liveRecForLane } from './free-lanes.mjs';

/** How a lane is pinged: its own CLI, or nothing at all. */
export function probeKindForLane(lane) {
  const provider = String(lane?.provider || '').toLowerCase();
  // Terminal-only: there is no chat burn path, so there is nothing to ping.
  if (provider === 'freebuff') return 'skip';
  // Cline has its own CLI (`cline -m <model> -c <workspace> <prompt>`) and its
  // model ids are not OpenCode ids, so it can never go through `runOpencode`.
  if (provider === 'cline') return 'cline';
  return 'opencode';
}

/** The model token that lane's CLI expects, not the routing ref. */
export function probeModelForLane(lane) {
  const model = String(lane?.model || '');
  if (probeKindForLane(lane) === 'cline') {
    // `-m` takes a MODEL. `cline-free/muse-spark-1.3-contributor` is one, and the
    // surface prefix a legacy ref carries (`cline:`, `cline/`) is not.
    return model.replace(/^cline[:/]/i, '');
  }
  const provider = String(lane?.provider || 'opencode');
  // OpenCode wants `provider/model`; a lane whose model already repeats its own
  // vendor dir must not be doubled (`opencode/opencode/…`).
  return `${provider}/${model}`.replace(/^opencode\/opencode\//, 'opencode/');
}

/**
 * Which lanes a burn ping may target.
 *
 * `skipCline` is the daily-cap escape hatch: Cline's free cap is per model per
 * day, so a run that must not spend a unit can hold Cline out. It is OFF by
 * default — a lane no check ever pings is a lane whose allowance nothing knows,
 * and that is how Muse Spark free answered on Cline while the check skipped
 * Cline outright (operator report, 2026-10-07).
 */
export function selectBurnTargets(
  lanes,
  { lane = null, first = false, all = false, now = Date.now(), isDepleted = () => false, skipCline = false } = {},
) {
  const list = (Array.isArray(lanes) ? lanes : []).filter(Boolean);
  const held = (l) => skipCline && String(l?.provider || '').toLowerCase() === 'cline';

  // An explicitly named lane is honoured as named; the caller's own guard is what
  // refuses to ping it (so the message can say why, not just "not found").
  if (lane !== null && lane !== undefined && lane !== '') {
    const found = list.find((l) => Number(l?.pref) === Number(lane)) || null;
    if (!found) return { targets: [], error: `no pref lane ${lane}` };
    return { targets: [found], error: null };
  }

  if (all) return { targets: list.filter((l) => l?.tg !== false && !held(l)), error: null };

  if (!first) return { targets: [], error: 'burn mode needs --lane N, --first-available, or --all-burn' };

  const ordered = [...list].sort((a, b) => (Number(a?.pref) || 0) - (Number(b?.pref) || 0));
  const next = ordered.find((l) => {
    if (l?.tg === false) return false;
    if (held(l)) return false;
    if (String(l?.status || '').toLowerCase() === 'depleted' && l?.nextResetAt && Date.parse(l.nextResetAt) > now) return false;
    if (isDepleted(l)) return false;
    return true;
  });
  return { targets: next ? [next] : [], error: null };
}

/**
 * WHY a lane reads empty, and whether that "empty" is proof or a guess.
 *
 * `projectLanes` merges every hold into one `depleted` flag, so a lane whose bar
 * was measured empty and a lane that is dark because a blanket error got the 6h
 * default TTL look identical on screen. They are not the same claim. The vendor
 * tells us which one we are looking at, and the writer already stores it:
 *
 *   kind: 'allowance-empty'  the vendor said the allowance is gone (countdown parsed)
 *   kind: 'rate-limit'       a 429 — a real, measured limit
 *   kind: 'limit-unknown'    neither, with no countdown: the DEFAULT TTL was applied
 *
 * Only the last one is unproven, and only it is worth re-pinging: a lane held by
 * a `limit-unknown` stamp may be perfectly usable (the file was reading a quote
 * of a limit message, a cosmetic sub-agent failed, or a sibling on the same shared
 * bar tripped it), while nothing but a vendor countdown could have produced the
 * other two.
 *
 * `key` is the exact record that holds the lane — a per-lane key, or the shared
 * `bucket:…` bar. That distinction is the answer to "why is MiMo empty when Muse
 * was the one that failed": on the OpenCode Zen free pool one bar is shared by
 * muse/mimo/ling/nemotron/space-bunny, so the bucket key holds all of them.
 */
export function holdEvidence(lane, session, { now = Date.now() } = {}) {
  const hit = liveRecForLane(lane, session || {}, now);
  if (!hit) return null;
  const rec = hit.rec || {};
  const kind = String(rec.kind || 'limit-unknown');
  const countdownParsed = Boolean(rec.countdownParsed);
  const shared = /^bucket:/.test(String(hit.key || ''));
  return {
    held: true,
    // A parsed countdown, an allowance-empty answer or a real rate limit is the
    // vendor measuring the bar. Everything else is our own default TTL.
    proven: countdownParsed || kind === 'allowance-empty' || kind === 'rate-limit',
    kind,
    countdownParsed,
    key: hit.key || null,
    shared,
    bucket: shared ? String(hit.key).slice('bucket:'.length) : (lane?.bucket || null),
    heldBy: rec.hitBy || null,
    observedAt: rec.depletedObservedAt || null,
    until: Number(rec.depletedUntil) || null,
    lastError: String(rec.lastError || '').slice(0, 120),
  };
}

/**
 * The held lanes worth re-pinging to falsify, in preference order.
 *
 * Unproven holds by default — the ones a ping can actually settle. A proven hold
 * is excluded because re-pinging it costs quota to re-learn something the vendor
 * already told us; `includeProven` is for a full audit, not for routine use.
 */
export function recheckTargets(lanes, session, { now = Date.now(), includeProven = false } = {}) {
  const held = [];
  for (const lane of Array.isArray(lanes) ? lanes : []) {
    if (!lane || lane.tg === false) continue;
    const evidence = holdEvidence(lane, session, { now });
    if (!evidence) continue;
    if (!evidence.proven || includeProven) held.push({ lane, evidence });
  }
  return held.sort((a, b) => (Number(a.lane.pref) || 0) - (Number(b.lane.pref) || 0));
}
