/**
 * Durable session credentials (class SILENT_AUTH_LOSS).
 *
 * The bug this file exists to prevent, measured on the live site (2026-11-16):
 * the app treats a stored `last_active_email` as "signed in", so a phone whose
 * `auth_token` expired or vanished restores a local session with **no
 * credential**. `/api/sync/supabase-pull` then answers 401, no
 * `totalFoodsCount` ever arrives, and Food History renders
 * `loaded rows / 15` pages — "Page 1 Of 3" for a 451-meal account. Nothing was
 * logged, nothing was shown: a silent, misleading history.
 *
 * Three rules here:
 *   1. A session token must be *usable* (not empty, not past `exp`) before it is
 *      sent, so a stale token never turns into a mystery 401.
 *   2. When the access token is expired, a long-lived refresh token (issued at
 *      login, `htr.…`) buys a new one from `POST /api/auth/refresh` without
 *      asking the user for their password again.
 *   3. When the credential is genuinely gone, say so — `auth_session_expired`
 *      fires so the shell can show a banner + CTA instead of pretending the
 *      history is short.
 *
 * This module is framework-free on purpose: `syncUtils`, `useAuthSession` and
 * the auth screen all share it, and the sensor tests exercise it directly.
 */

export const AUTH_TOKEN_KEY = 'auth_token';
export const REFRESH_TOKEN_KEY = 'refresh_token';
/** One-shot breadcrumb so a re-sign-in screen can prefill the address. */
export const EXPIRED_EMAIL_KEY = 'auth_expired_email';

export type RefreshOutcome =
  | { status: 'ok'; token: string }
  | { status: 'invalid' }
  | { status: 'network' }
  | { status: 'none' };

const storage = (): Storage | null => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
};

const b64UrlDecode = (value: string): string => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  const raw = padded + pad;
  if (typeof atob === 'function') return atob(raw);
  // Node test environment fallback (Buffer is not available in the browser realm).
  return (globalThis as any).Buffer ? (globalThis as any).Buffer.from(raw, 'base64').toString('utf8') : '';
};

/** Decoded payload of an app session token (`htk.…`), signature NOT checked. */
export function decodeSessionToken(token: string | null | undefined): { exp?: number; uid?: string; email?: string } | null {
  if (!token || !token.startsWith('htk.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = JSON.parse(b64UrlDecode(parts[1]));
    if (!json || typeof json !== 'object') return null;
    return json;
  } catch {
    return null;
  }
}

/**
 * Whether a stored access token can still be sent. A token that is past its
 * `exp` (or within `skewMs`) is not usable: sending it guarantees a 401.
 * Unparseable tokens count as unusable so they get refreshed instead of
 * bouncing off the server forever.
 */
export function isSessionTokenUsable(token: string | null | undefined, options: { nowMs?: number; skewMs?: number } = {}): boolean {
  const payload = decodeSessionToken(token);
  if (!payload || typeof payload.exp !== 'number') return false;
  const nowMs = options.nowMs ?? Date.now();
  const skewMs = options.skewMs ?? 60_000;
  return payload.exp * 1000 - skewMs > nowMs;
}

export function getRefreshToken(): string | null {
  const s = storage();
  const token = s?.getItem(REFRESH_TOKEN_KEY) || null;
  return token && token.startsWith('htr.') ? token : null;
}

/** Persist whatever the server handed back at login/refresh. */
export function storeSessionCredentials(tokens: { token?: string | null; refreshToken?: string | null }): void {
  const s = storage();
  if (!s) return;
  try {
    if (tokens.token) s.setItem(AUTH_TOKEN_KEY, tokens.token);
    if (tokens.refreshToken) s.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
  } catch {
    /* quota — best effort, sync will report the failure */
  }
}

/** Drop credentials after a definitive rejection. Never called on a network error. */
export function clearSessionCredentials(): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(AUTH_TOKEN_KEY);
    s.removeItem(REFRESH_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

/** Remember who to prefill on the sign-in screen after a hard expiry. */
export function rememberExpiredEmail(email?: string | null): void {
  const s = storage();
  if (!s) return;
  const clean = (email || '').toLowerCase().trim();
  if (!clean) return;
  try {
    s.setItem(EXPIRED_EMAIL_KEY, clean);
  } catch {
    /* ignore */
  }
}

/** Read-and-clear the expired-session breadcrumb (the sign-in screen uses it once). */
export function takeExpiredEmail(): string {
  const s = storage();
  if (!s) return '';
  try {
    const value = s.getItem(EXPIRED_EMAIL_KEY) || '';
    if (value) s.removeItem(EXPIRED_EMAIL_KEY);
    return value;
  } catch {
    return '';
  }
}

const listeners = new Set<(detail: { email?: string }) => void>();

/**
 * Subscribe to hard session expiry. Fired only when the credential is
 * definitively rejected (400/401), never on a transient network failure.
 */
export function onSessionExpired(listener: (detail: { email?: string }) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitSessionExpired(email?: string): void {
  rememberExpiredEmail(email);
  for (const listener of Array.from(listeners)) {
    try {
      listener({ email });
    } catch {
      /* one bad listener must not stop the rest */
    }
  }
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('auth_session_expired', { detail: { email } }));
    }
  } catch {
    /* ignore */
  }
}

/** Single-flight so a screen that fires five pulls at once buys one new token. */
let inflightRefresh: Promise<RefreshOutcome> | null = null;

/**
 * Exchange the stored refresh token for a fresh 30-day session token.
 * `invalid` means the server rejected the credential (sign in again);
 * `network` means we could not ask (keep the session, retry later).
 */
export async function refreshSession(options: { force?: boolean } = {}): Promise<RefreshOutcome> {
  if (inflightRefresh) return inflightRefresh;
  const refreshToken = getRefreshToken();
  if (!refreshToken) return { status: 'none' };
  if (!options.force) {
    const current = storage()?.getItem(AUTH_TOKEN_KEY) || null;
    if (isSessionTokenUsable(current)) return { status: 'ok', token: current as string };
  }
  inflightRefresh = (async (): Promise<RefreshOutcome> => {
    try {
      const resp = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (resp.status === 400 || resp.status === 401 || resp.status === 403) {
        clearSessionCredentials();
        return { status: 'invalid' };
      }
      if (!resp.ok) return { status: 'network' };
      const data = await resp.json().catch(() => null);
      if (data && data.success && typeof data.token === 'string' && data.token) {
        storeSessionCredentials({ token: data.token, refreshToken: data.refreshToken });
        return { status: 'ok', token: data.token };
      }
      return { status: 'network' };
    } catch {
      return { status: 'network' };
    } finally {
      inflightRefresh = null;
    }
  })();
  return inflightRefresh;
}

/** Test-only: drop the memoized in-flight refresh. */
export function __resetSessionRefreshState(): void {
  inflightRefresh = null;
  listeners.clear();
}
