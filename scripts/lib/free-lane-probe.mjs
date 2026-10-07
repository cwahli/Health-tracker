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
