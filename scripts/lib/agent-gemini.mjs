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
 * auto-retried — it burns the shared 15/min bucket), same single 404 fallback
 * to gemini-2.5-flash. Transport differs on purpose: the live site uses the
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
    return `Gemini model not found — the vendor model list may be stale, pick again from /freemodel${short ? ` (${short})` : ''}.`;
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
        'The /freemodel picker works without it; runs do not.',
    );
  }
  const apiModel = geminiModelId(model);
  if (!apiModel) {
    return fail(`Unknown gemini model: ${model}. Use /freemodel to pick from the list.`);
  }
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
  let fellBack = '';
  let attempt = await post(apiModel);
  if (attempt.transportError) return fail(attempt.transportError);
  // Live-site parity: one 404 hop to gemini-2.5-flash (callUnifiedLLMInternal).
  if (!attempt.res.ok && Number(attempt.res.status) === 404 && apiModel !== GEMINI_FALLBACK_MODEL) {
    console.warn(`[agent-gemini] Model "${apiModel}" 404 — falling back to "${GEMINI_FALLBACK_MODEL}" (live-site parity).`);
    fellBack = ` (answered by fallback ${GEMINI_FALLBACK_MODEL})`;
    attempt = await post(GEMINI_FALLBACK_MODEL);
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
    stderr: fellBack ? `fallback:${GEMINI_FALLBACK_MODEL}` : '',
    usage: { cost: 0, tokens: total ? { total } : null },
  };
}
