/**
 * agent-gemini.mjs — shared Gemini API lane.
 *
 * One provider module, usable from every agent runner (bot-host today;
 * collab-bot and tools/telegram-provider-router can import runGemini instead
 * of growing their own Gemini client). The model catalog lives in
 * scripts/lib/freemodels.mjs (GEMINI_MODELS) next to CLINE_FREE_MODELS so the
 * /freemodel picker, /model validation, and this runner validate one list.
 *
 * Live-site parity (server.ts getGeminiApiKey / callUnifiedLLM /
 * server_gemini_retry.ts): same key chain, same quota vocabulary (429 is never
 * auto-retried on the same model — it burns the same bucket), same single 404
 * fallback to gemini-2.5-flash, the same one-extra-try rule for a 503-class
 * "UNAVAILABLE / high demand" answer (withGeminiRetry), and the same
 * fail-the-model-not-the-job hop when the chosen engine stalls, stays
 * unavailable, or is out of quota (nextGeminiFallbackEngine). Transport differs on purpose: the live site uses the
 * @google/genai SDK, but its deps (google-auth-library) are not installed in
 * the bot runtimes (VPS bot-host / phone / collab), so this lane speaks the
 * first-party OpenAI-compatible REST endpoint with plain fetch (zero deps).
 * Behaviour, not mechanism, is what callers depend on.
 *
 * Single-shot answers only — no tools, no session resume, no plan mode, no
 * variants. The result shape matches runOpencode/runCline
 * ({ code, sessionID, finalText, lastError, stderr, usage }) so callers can
 * swap lanes without re-wiring renderers or totals.
 *
 * Key distribution (key added later — everything below works without it):
 *   VPS bot-host  ~/.config/bot-host/common.env      (systemd EnvironmentFile, all bots)
 *   phone device  ~/.config/opencode-bot/<id>.env    (sourced by ~/start-*.sh)
 *   collab        ~/.config/opencode-bot/collab.env
 *   router        tools/telegram-provider-router/.env (own host)
 * Without GEMINI_API_KEY, runGemini returns an actionable auth error and never
 * throws. The `/freemodel` picker does not advertise standalone `gemini:` lanes;
 * keyed Gemini models are offered through the local OpenCode tool when the
 * host has the credential and the OpenCode catalog exposes them.
 */
import { GEMINI_MODELS, parseModelRef } from './freemodels.mjs';

export const GEMINI_API_URL =
  'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
export const GEMINI_DEFAULT_TIMEOUT_MS = 300000;

/** Fallback the live site uses when a model 404s (one hop, like callUnifiedLLMInternal). */
export const GEMINI_FALLBACK_MODEL = 'gemini-2.5-flash';

/**
 * Live-site parity, failover half (server_gemini_retry.ts
 * nextGeminiFallbackEngine): when the chosen engine stalls or stays
 * UNAVAILABLE, the live site fails the *model*, not the job — one hop to its
 * lite engine, never a second hop, and never on a quota error. The target is
 * the live site's own default engine (DEFAULT_GEMINI_ENGINE). Measured on the
 * VPS 2026-10-02: the health room's 2.8k-char prompt hung past 120 s on
 * gemini-3.7-flash — twice — while gemini-3.5-flash-lite answered the same
 * prompt in 958 ms. Without the hop the room gets its fallback line for a
 * question the lane could answer.
 */
export const GEMINI_STALL_FALLBACK_MODEL = 'gemini/gemini-3.5-flash-lite';

/**
 * Live-site parity, retry half (server_gemini_retry.ts withGeminiRetry): a
 * 503-class transient — the provider answering "UNAVAILABLE / high demand" —
 * gets exactly one extra try after a short wait. A 429 is never retried: it
 * burns the shared 15/min bucket, which a retry only makes worse. This is not
 * theoretical: on 2026-10-02 the health room on the VPS drew a 503 from
 * gemini-3.7-flash on the first try and the second answered — the difference
 * between a real answer and the room's fallback line.
 */
export const GEMINI_RETRY_DELAY_MS = 2000;

/** One more try is warranted for 502/503/504 or an UNAVAILABLE/high-demand body. Quota beats everything. */
export function isGeminiTransient(status, body) {
  const code = Number(status) || 0;
  if (code === 429) return false;
  if (code === 502 || code === 503 || code === 504) return true;
  const text = typeof body === 'string' ? body : JSON.stringify(body || {});
  return /unavailable|high demand/i.test(text);
}

/**
 * The provider's quota answer (429 / RESOURCE_EXHAUSTED / "exceeded your
 * current quota"). Distinct from isGeminiTransient on purpose: quota is never
 * a reason to try the *same* model again (it burns the same bucket), but it is
 * the live site's own reason to fail the *model* — server_gemini_retry.ts
 * noteGeminiQuota + nextGeminiFallbackEngine, whose cooldown text tells the
 * operator the other engine "has a separate quota".
 */
export function isGeminiQuota(status, body) {
  const code = Number(status) || 0;
  if (code === 429) return true;
  const text = typeof body === 'string' ? body : JSON.stringify(body || {});
  return /quota|rate.?limit|too many requests|resource exhausted|free.?limit|exhausted/i.test(text);
}

/**
 * Whether another engine is worth one try: transient (stall/unavailable) or
 * quota. Quota is included because each engine has its own bucket — the room's
 * default model being out of quota says nothing about the lite engine.
 */
export function isGeminiHopWorthy(status, body) {
  return isGeminiTransient(status, body) || isGeminiQuota(status, body);
}

function pickKey(scope) {
  if (!scope || typeof scope !== 'object') return '';
  const list = String(scope.GEMINI_API_KEYS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const name of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'API_KEY']) {
    const value = scope[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return list[0] || '';
}

/**
 * The key that is in *this* env map, and nothing else.
 *
 * `resolveGeminiKey` deliberately falls back to the process env (a caller that
 * was handed a partial map should still find the host's credential). A
 * readiness check is the opposite question — "does THIS host have a key?" — so
 * it asks this one: an explicit empty env must read as empty rather than
 * silently picking up a key from somewhere else.
 */
export function geminiKeyIn(env) {
  return pickKey(env);
}

/**
 * Key chain mirrors the live site's getGeminiApiKey (server.ts):
 * GEMINI_API_KEY -> GOOGLE_API_KEY -> API_KEY -> GEMINI_API_KEYS[0].
 * Empty string when unset — callers report it, never crash on it.
 */
export function resolveGeminiKey(env = process.env) {
  return pickKey(env) || pickKey(process.env);
}

/**
 * Validate a `gemini:` ref (or bare `gemini/<id>`) against the catalog and
 * return the vendor model id (provider prefix stripped). Null when unknown.
 */
export function geminiModelId(ref) {
  const parsed = parseModelRef(ref);
  const id = parsed.surface === 'gemini' ? parsed.id : String(ref ?? '').trim();
  if (!GEMINI_MODELS.includes(id)) return null;
  return id.replace(/^gemini\//, '');
}

/**
 * Provider HTTP failure -> one human-actionable line. Vocabulary is aligned
 * with isQuotaOrLimitError (scripts/lib/agent-opencode.mjs) and the provider
 * router's quota matcher so a future failover chain classifies Gemini lanes
 * the same way as every other lane.
 */
export function mapGeminiError({ status, body, message } = {}) {
  const text = [body, message].filter(Boolean).join(' ').slice(0, 500);
  const short = text.slice(0, 200);
  const code = Number(status) || 0;
  if (
    code === 401 ||
    code === 403 ||
    /invalid api key|api key.*invalid|api key not valid|API_KEY_INVALID|authentication|unauthorized|permission denied/i.test(text)
  ) {
    return `Gemini API rejected the credentials (auth failed)${short ? ` (${short})` : ''}. Set GEMINI_API_KEY on this host.`;
  }
  if (
    code === 429 ||
    /quota|rate.?limit|too many requests|resource exhausted|free.?limit|exhausted/i.test(text)
  ) {
    return `Gemini quota or rate limit reached${short ? ` (${short})` : ''}.`;
  }
  if (code === 404 || /model not found|not_found|did you mean/i.test(text)) {
    return `Gemini model not found — the vendor model list may be stale, pick again from /model_free${short ? ` (${short})` : ''}.`;
  }
  if (code >= 500 || /overloaded|internal|unavailable|timeout|timed out/i.test(text)) {
    return `Gemini provider error${short ? `: ${short}` : ''}.`;
  }
  return short ? `Gemini error: ${short}` : 'Gemini error: unknown error';
}

export async function runGemini({
  prompt,
  model,
  system,
  timeoutMs = GEMINI_DEFAULT_TIMEOUT_MS,
  env,
  fetchImpl = fetch,
  retryDelayMs = GEMINI_RETRY_DELAY_MS,
  fallbackModel = GEMINI_STALL_FALLBACK_MODEL,
} = {}) {
  const fail = (lastError, code = -1) => ({
    code,
    sessionID: null,
    finalText: '',
    lastError,
    stderr: '',
    usage: { cost: 0, tokens: null },
  });
  const text = String(prompt ?? '').trim();
  if (!text) return fail('Gemini run needs a non-empty prompt.');
  const key = resolveGeminiKey(env);
  if (!key) {
    return fail(
      'Gemini API key missing: set GEMINI_API_KEY on this host ' +
        '(VPS ~/.config/bot-host/common.env, phone ~/.config/opencode-bot/<id>.env). ' +
        'The /model_free picker works without it; runs do not.',
    );
  }
  const apiModel = geminiModelId(model);
  if (!apiModel) {
    return fail(`Unknown gemini model: ${model}. Use /model_free to pick from the list.`);
  }
  // Unknown or empty disables the hop; a caller on the lite engine itself
  // never hops to itself.
  const stallFallback = geminiModelId(fallbackModel);
  const systemText = String(system ?? '').trim();
  const messages = systemText ? [{ role: 'system', content: systemText }] : [];
  messages.push({ role: 'user', content: text });
  const post = async (vendorModel) => {
    let res;
    try {
      res = await fetchImpl(GEMINI_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: vendorModel, messages }),
        signal: timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined,
      });
    } catch (err) {
      const msg = String(err?.message || err || 'fetch failed');
      if (/timed out|timeout|abort/i.test(msg)) {
        return { transportError: `Gemini run timed out after ${Math.round(timeoutMs / 1000)}s.` };
      }
      return { transportError: `Gemini transport error: ${msg.slice(0, 200)}` };
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { res, data };
  };
  // One extra try when the provider is transiently unavailable — never for
  // quota, never for a real error. The wait is injectable so a sensor does
  // not sleep for the live two seconds.
  const postTryingTransientOnce = async (vendorModel) => {
    let attempt = await post(vendorModel);
    if (
      !attempt.transportError &&
      attempt.res &&
      !attempt.res.ok &&
      isGeminiTransient(attempt.res.status, attempt.data)
    ) {
      console.warn(`[agent-gemini] "${vendorModel}" answered ${attempt.res.status} (transient) — one retry in ${Math.round(retryDelayMs / 1000)}s (live-site parity).`);
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      attempt = await post(vendorModel);
    }
    return attempt;
  };
  let fellBack = '';
  let triedModel = apiModel;
  let attempt = await postTryingTransientOnce(triedModel);
  // One hop when the primary stalls, stays unavailable, or is out of quota —
  // the live site's nextGeminiFallbackEngine rule: fail the model, not the
  // job. Quota is a hop reason, not a retry reason: a 429 on the primary is
  // never re-asked on the primary (same bucket), but the other engine has its
  // own. Never a second hop, and never when the primary already is the
  // fallback.
  if (
    stallFallback &&
    stallFallback !== triedModel &&
    (attempt.transportError || (!attempt.res?.ok && isGeminiHopWorthy(attempt.res?.status, attempt.data)))
  ) {
    const why = attempt.transportError
      ? 'stalled'
      : isGeminiQuota(attempt.res.status, attempt.data)
        ? `answered ${attempt.res.status} (out of quota)`
        : `answered ${attempt.res.status} (unavailable)`;
    console.warn(`[agent-gemini] "${triedModel}" ${why} — one hop to "${stallFallback}" (live-site parity).`);
    triedModel = stallFallback;
    attempt = await postTryingTransientOnce(triedModel);
    if (!attempt.transportError && attempt.res?.ok) fellBack = triedModel;
  }
  if (attempt.transportError) return fail(attempt.transportError);
  // Live-site parity: one 404 hop to gemini-2.5-flash (callUnifiedLLMInternal).
  if (!attempt.res.ok && Number(attempt.res.status) === 404 && triedModel !== GEMINI_FALLBACK_MODEL) {
    console.warn(`[agent-gemini] Model "${triedModel}" 404 — falling back to "${GEMINI_FALLBACK_MODEL}" (live-site parity).`);
    triedModel = GEMINI_FALLBACK_MODEL;
    attempt = await postTryingTransientOnce(triedModel);
    if (!attempt.transportError && attempt.res?.ok) fellBack = triedModel;
    if (attempt.transportError) return fail(attempt.transportError);
  }
  const { res, data } = attempt;
  if (!res.ok) {
    const body = typeof data === 'string' ? data : JSON.stringify(data || {});
    return fail(mapGeminiError({ status: res.status, body }), Number(res.status) || -1);
  }
  const rawContent = data?.choices?.[0]?.message?.content;
  const finalText = (
    Array.isArray(rawContent)
      ? rawContent.map((part) => (typeof part === 'string' ? part : part?.text || '')).join('')
      : String(rawContent || '')
  ).trim();
  if (!finalText) {
    const detail = JSON.stringify(data || {}).slice(0, 200);
    return fail(`Gemini returned no text${detail && detail !== '{}' ? ` (${detail})` : ''}.`, 0);
  }
  const total = Number(data?.usage?.total_tokens) || 0;
  return {
    code: 0,
    sessionID: null,
    finalText,
    lastError: null,
    stderr: fellBack ? `fallback:${fellBack}` : '',
    usage: { cost: 0, tokens: total ? { total } : null },
  };
}
