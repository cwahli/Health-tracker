// === VENDORED FROM scripts/lib/tg-progress.mjs — DO NOT EDIT ===
// Mirrored by scripts/sync-router-vendor.mjs. Edit the canonical file, not this copy.

// Shared working-headline formatter for bot-host progress messages.
//
// Ports the Grok TG router's formatWorkingHeadline
// (tools/telegram-provider-router/src/index.js) into the shared lib so every
// bot-host agent shows the same line: provider + model + thinking + status +
// elapsed + context usage, e.g.
//   ⏳ Cline muse spark 1.3 contributor free (high) working… 50s - 210k (30%)
// Fixes land here, not per agent (Case H ladder, plan/RELIABILITY.md §14.6).

export function formatTokenCount(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return String(v);
}

/** Known context windows for free-lane models (single copy — the Grok TG
 *  router vendors this file, see scripts/sync-router-vendor.mjs). */
export const KNOWN_CTX_LIMITS = {
  'glm-4.7-free': 131072,
  'opencode/glm-4.7-free': 131072,
  'glm-4.7-flash': 131072,
  '@cf/zai-org/glm-4.7-flash': 131072,
  'cloudflare/@cf/zai-org/glm-4.7-flash': 131072,
  'qwen3-38b': 262144,
  'opencode/qwen3-38b': 262144,
  '@cf/qwen/qwen3.8-27b': 262144,
  'cloudflare/@cf/qwen/qwen3.8-27b': 262144,
};

export function ctxLimitFor(model) {
  if (!model) return null;
  const key = String(model).toLowerCase();
  if (KNOWN_CTX_LIMITS[key] != null) return KNOWN_CTX_LIMITS[key];
  for (const [k, v] of Object.entries(KNOWN_CTX_LIMITS)) {
    if (key.includes(k)) return v;
  }
  return null;
}

export function formatWorkingHeadline({
  providerLabel = 'OpenCode',
  modelLabel = '',
  thinking = '',
  elapsedSec = 0,
  used = null,
  ctxLimit = null,
  pct = null,
  detail = 'working',
} = {}) {
  const modelBit = modelLabel ? ` ${modelLabel}` : '';
  const thinkBit =
    thinking && thinking !== 'default' && thinking !== 'none' ? ` (${thinking})` : '';
  const timeBit = `${Math.max(0, Math.round(Number(elapsedSec) || 0))}s`;
  let ctxBit = '';
  // pct may be supplied live (router session status); otherwise derive it
  // from used/limit when the limit is known (bot-host step totals).
  let p = pct == null ? null : Number(pct);
  if (!Number.isFinite(p)) p = null;
  if (used != null && Number.isFinite(Number(used))) {
    ctxBit = ` - ${formatTokenCount(used)}`;
    const limit = Number(ctxLimit) || null;
    if (limit) ctxBit += `/${formatTokenCount(limit)}`;
    if (p == null && limit) p = (Number(used) / limit) * 100;
    if (p != null) ctxBit += ` (${p.toFixed(0)}%)`;
  } else {
    p = null;
  }
  const warn =
    p != null && p >= 75
      ? '\n⚠️ Context high — /compact if answers get lost or slow'
      : p != null && p >= 60
        ? '\n💡 Context warming up — /compact when you want a fresh window'
        : '';
  const verb = detail && detail !== 'working' && detail !== 'busy' ? detail : 'working';
  return `⏳ ${providerLabel}${modelBit}${thinkBit} ${verb}… ${timeBit}${ctxBit}${warn}`;
}
