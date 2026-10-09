/**
 * META-1 P1 — shared Telegram auth for the meta shell.
 *
 * Single-source rule: the HMAC/token primitives live in
 * `scripts/tui-gateway.mjs` and are RE-EXPORTED here, never duplicated.
 * A second validator is how the `hash mismatch` outage happened
 * (`TUI_TG_AUTH_TRAIL.md`: old exclusion shipped in dev copies).
 *
 * This module adds only NEW, caller-free helpers for the meta shell:
 * tab-bound deep-links (`?bot=&tab=`) and the external Google OAuth
 * handshake (Google refuses embedded WebViews, so OAuth leaves the app
 * via `openLink` and returns to `https://app…/oauth/callback`).
 *
 * P1 scope: no callers yet. Zero behavior change by construction.
 * P3+ rewire: gateway + bot-host import from here instead of inlining.
 */

export {
  validateInitData,
  issueToken,
  verifyToken,
  COOKIE_NAME,
  MAX_AGE_SEC,
  SKEW_SEC,
} from '../tui-gateway.mjs';

/** Normal tabs: 24h window (planner/dashboard). The TUI shell keeps 5m. */
export const TAB_MAX_AGE_SEC = 24 * 60 * 60;

/**
 * Build the canonical meta deep-link. `bot` is REQUIRED: the gateway HMAC
 * is per-bot, and `?tab=` alone must never validate (cross-bot reuse).
 */
export function metaLink(gatewayUrl, botId, tab) {
  const base = String(gatewayUrl || '').replace(/\/+$/, '');
  return `${base}/?bot=${encodeURIComponent(botId)}&tab=${encodeURIComponent(tab)}`;
}

/**
 * Parse + validate a meta deep-link query. Returns { bot, tab } or null.
 * `tab` must be a registry id the caller resolves; unknown tabs are null
 * (never defaulted — a wrong tab is a wrong door).
 */
export function parseMetaQuery(search, knownTabs) {
  try {
    const q = new URLSearchParams(String(search || '').replace(/^\?/, ''));
    const bot = (q.get('bot') || '').trim();
    const tab = (q.get('tab') || '').trim();
    if (!bot || !tab) return null;
    if (Array.isArray(knownTabs) && !knownTabs.includes(tab)) return null;
    return { bot, tab };
  } catch {
    return null;
  }
}

/**
 * Google OAuth start URL (PKCE, external browser). `state` MUST be the
 * caller's short-lived `htk` so the callback can bind `google_sub` to the
 * Telegram user without trusting the browser round-trip. Redirect is always
 * the https callback — never `tg://` (Google/Telegram cannot return there).
 */
export function googleAuthUrl({ authorizeEndpoint, clientId, redirectUri, scopes = [], state }) {
  const q = new URLSearchParams({
    client_id: String(clientId || ''),
    redirect_uri: String(redirectUri || ''),
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    scope: scopes.join(' '),
    state: String(state || ''),
  });
  return `${String(authorizeEndpoint || '').replace(/\/+$/, '')}?${q.toString()}`;
}
