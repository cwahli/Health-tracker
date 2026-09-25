/**
 * Tool-allowance ping engine (pure, no I/O, no provider calls).
 *
 * Consumed by `scripts/probe-tool-allowance.mjs` (CLI) so the active-ping
 * behaviour stays unit-testable without spawning a real CLI. Vocabulary is
 * deliberately shared with `scripts/lib/agent-opencode.mjs`
 * (`isQuotaOrLimitError`, `parseRetryAfter`, `extractLogError`) and the
 * free-lane ledger (`scripts/lib/free-lanes.mjs`) so a ping verdict means the
 * same thing in both ledgers — BOT-24 point 6 (allowance consistency).
 *
 * Verdicts:
 *   alive        — the tool produced text and no quota/limit error
 *   depleted     — quota/limit error proof (stamp both ledgers)
 *   inconclusive — no text, no quota proof; ledger untouched (never deplete
 *                  without vendor proof, mirrors probe-free-lanes.mjs)
 */
import { isQuotaOrLimitError, parseRetryAfter } from './agent-opencode.mjs';

export const PING_VERDICTS = ['alive', 'depleted', 'inconclusive'];

/** "Reply with exactly: ok" — minimal prompt, early-killed on first text. */
export const PING_PROMPT = 'Reply with exactly: ok';

/**
 * Map a tool-allowance report-result status to a lane verdict. Same idea as
 * classifyPingResult but for passive (observed) failures reported by
 * run-coding-dispatch.sh, so both entry points stamp consistent shapes.
 */
export function statusToVerdict(status) {
  switch (String(status || '')) {
    case 'success': return 'alive';
    case 'rate_limited':
    case 'low_allowance':
    case 'depleted': return 'depleted';
    default: return 'inconclusive';
  }
}

/**
 * Classify one run result (runOpencode / runCline shape: { code, finalText,
 * lastError, stderr }). `filteredError` should already be small=true-filtered
 * via extractLogError when the caller has stderr (cosmetic title-agent
 * failures never deplete a tool).
 */
export function classifyPingResult({ finalText = '', lastError = '', filteredError = null, code = 0 } = {}) {
  const text = String(finalText || '').trim();
  const err = String(filteredError != null ? filteredError : lastError || '').trim();
  if (text && !isQuotaOrLimitError(err)) {
    return { verdict: 'alive', reason: 'first text received, no quota error', retryHint: '', code };
  }
  if (isQuotaOrLimitError(err)) {
    return {
      verdict: 'depleted',
      reason: err.slice(0, 300),
      retryHint: parseRetryAfter(err),
      code,
    };
  }
  const note = /timed out after|aborted/i.test(err)
    ? 'timeout/abort — never auto-retried (re-running just waits again)'
    : 'no text and no quota proof';
  return { verdict: 'inconclusive', reason: `${note}${err ? `: ${err.slice(0, 200)}` : ''}`, retryHint: '', code };
}

/**
 * Inverse of parseRetryAfter for stamping: turn "Retry in ~3h 20m." back into
 * an absolute reset epoch. Returns null when the hint carries no usable time
 * (caller then applies its own default TTL).
 */
export function parseRetryHintMs(hint, now = Date.now()) {
  const s = String(hint || '');
  const h = s.match(/~\s*(\d+)\s*h/);
  const m = s.match(/~\s*(?:\d+\s*h\s*)?(\d+)\s*m/);
  if (!h && !m) return null;
  const ms = ((h ? Number(h[1]) : 0) * 3600 + (m ? Number(m[1]) : 0) * 60) * 1000;
  return ms > 0 ? now + ms : null;
}

/**
 * Ping targets from a tool-allowance state: installed tools that are not
 * already known-depleted/unavailable and not in cooldown. Burning quota on a
 * lane the ledger already proves dead is waste; skip those and let
 * refreshCooldowns bring them back. `now` is injectable for tests.
 */
export function pickPingTargets(state, { tool = null, now = Date.now() } = {}) {
  const tools = (state && state.tools) || {};
  const out = [];
  for (const [key, t] of Object.entries(tools)) {
    if (tool && key !== tool) continue;
    const status = String(t.status || '');
    if (status === 'unavailable' || status === 'not_installed') continue;
    const cooldown = t.cooldown_until && new Date(t.cooldown_until).getTime() > now;
    if (cooldown || status === 'depleted') continue;
    out.push({
      tool: key,
      name: t.name || key,
      defaultModel: t.default_model || null,
      priority: Number(t.priority) || 99,
    });
  }
  return out.sort((a, b) => a.priority - b.priority);
}

/** Free-lane route a tool's default model maps to (for the lane ledger stamp). */
export function laneRouteForTool(entry) {
  const model = String(entry?.defaultModel || '').trim();
  if (!model || model.startsWith('grok') || model.startsWith('gemini')) return null;
  return { provider: 'opencode', model };
}

/**
 * Summary rows for both ledgers from classified ping results
 * (`{ tool, ...classifyPingResult() }`). Pure: the CLI decides what to stamp.
 */
export function buildPingSummary(results, { now = Date.now(), defaultTtlMs = 6 * 3600 * 1000 } = {}) {
  const rows = [];
  for (const r of results || []) {
    const base = {
      tool: r.tool,
      verdict: r.verdict,
      reason: r.reason || '',
      retryHint: r.retryHint || '',
      checkedAt: new Date(now).toISOString(),
    };
    if (r.verdict === 'depleted') {
      base.resetAt = new Date(parseRetryHintMs(r.retryHint, now) || now + defaultTtlMs).toISOString();
      base.resetIn = r.retryHint || 'default TTL (no vendor countdown)';
    }
    rows.push(base);
  }
  const counts = { alive: 0, depleted: 0, inconclusive: 0 };
  for (const row of rows) counts[row.verdict] = (counts[row.verdict] || 0) + 1;
  return { counts, rows, checkedAt: new Date(now).toISOString() };
}
