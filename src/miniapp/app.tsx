import { StrictMode, useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { enabledMiniApps, miniAppById, type MiniAppDef } from './miniapp-registry';
import { tabUrl } from './shell-nav';
import { statusKeyMaps, lookForRow, sortByMem, activityKeyMaps, type RowLook, type TmuxEntry, type ActivityBadge, type ActivityEntry } from './shell-session';
import { BugBoard } from '../components/bug-board/BugBoard';
import { useBugBoard } from '../components/bug-board/useBugBoard';
import '../index.css';

declare global {
  interface Window {
    Telegram?: any;
  }
}

/**
 * META-1 P2 — meta shell entry. Burger nav over `miniapp-registry.ts`.
 *
 * - `?bot=` is required (per-bot HMAC door); `?tab=` selects the tab.
 * - `bugs` renders the shared board in place (same component + hook as the
 *   site modal and the standalone entry — no fork).
 * - `tty` navigates to the existing terminal route, preserving the query
 *   (token rides `location.search`, same pattern as fleet proof URLs).
 * - Other `native` tabs link to their standalone gateway pages until P3
 *   migrates them (no stub data, no second formatter).
 * - `external` opens via `openLink` on tap only — never an iframe.
 * - No Firebase/Google/server-only imports (client boundary).
 */

function tg() {
  try {
    return window.Telegram?.WebApp ?? null;
  } catch {
    return null;
  }
}

/**
 * The telegram-web-app.js script defines window.Telegram.WebApp even in a
 * plain browser (empty initData), so object presence alone is not proof of
 * a Telegram client. Require live initData or the native bridge instead —
 * otherwise a real browser is misread as Telegram and never sees login.
 */
function inTelegramClient(): boolean {
  try {
    const w = window as any;
    if (w?.Telegram?.WebApp?.initData) return true;
    return !!w?.TelegramWebviewProxy;
  } catch {
    return false;
  }
}

function telegramChrome() {
  const t = tg();
  if (!t) return;
  try {
    if (t.ready) t.ready();
    if (t.expand) t.expand();
    if (t.disableVerticalSwipes) t.disableVerticalSwipes();
    // Fresh shell owns no back action — hide a stale one (e.g. after
    // history.back() from an external tab). Drawer/exit flows show it.
    if (t.BackButton?.hide) t.BackButton.hide();
  } catch {
    /* dev browser without Telegram — shell still renders */
  }
}

import { isRefusalText } from './frame-refusal';

function currentQuery(): string {
  try {
    return window.location.search || '';
  } catch {
    return '';
  }
}

function setQueryToken(token: string) {
  try {
    const q = new URLSearchParams(window.location.search || '');
    q.set('token', token);
    window.history.replaceState(null, '', `?${q.toString()}`);
  } catch {
    /* history unavailable — retry rides the old query and fails honestly */
  }
}

/**
 * The 900s page token dies while tabs stay open (and initData is
 * single-use), so a 401 is usually just an old token, not a dead backend.
 * Renew once through /app/token (grace-bound, absolute cliff enforced
 * server-side) and retry the caller once.
 */
async function renewToken(): Promise<boolean> {
  try {
    const res = await fetch('/app/token' + currentQuery());
    const body = await res.json().catch(() => null);
    if (res.ok && body && body.ok && typeof body.token === 'string' && body.token) {
      setQueryToken(body.token);
      return true;
    }
  } catch {
    /* falls through to false */
  }
  return false;
}

async function fetchLive(path: string): Promise<Response> {
  const res = await fetch(path + currentQuery());
  if (res.status === 401 && (await renewToken())) {
    return fetch(path + currentQuery());
  }
  return res;
}

function queryToken(): string {
  try {
    return new URLSearchParams(window.location.search || '').get('token') || '';
  } catch {
    return '';
  }
}

function tgInitData(): string {
  try {
    return tg()?.initData || '';
  } catch {
    return '';
  }
}

/** Shell frames every tab (no shell bar: each tab hosts its own in-header
 * burger, which postMessages the shell to open the drawer), each door getting
 * exactly what it accepts: fleet/review ?token=, terminal ?token= (`/`
 * deep-link 302s to this bot's ttyd page), forge ?initData=, web ?token= on its host,
 * tgtg the bag app's own initData door via the URL hash (telegram-web-app.js
 * reads tgWebAppData from its own window's hash; the bag validator checks
 * HMAC + user only, its Lax cookie is same-site across our hosts). */
function absoluteBase(route: string): string | null {
  try {
    const u = new URL(route);
    return u.origin + u.pathname;
  } catch {
    return null;
  }
}

function frameSrc(def: MiniAppDef, bot: string): string | null {
  if (def.id === 'bugs') return null;
  if (def.kind === 'tty') {
    const tok = queryToken();
    return tok ? `/?bot=${encodeURIComponent(bot)}&token=${encodeURIComponent(tok)}` : null;
  }
  if (def.id === 'fleet' || def.id === 'review') {
    const tok = queryToken();
    const base = def.id === 'fleet' ? '/fleet/app' : '/review/app';
    return tok ? `${base}?token=${encodeURIComponent(tok)}` : null;
  }
  if (def.id === 'forge') {
    const init = tgInitData();
    return init ? `/forge/?initData=${encodeURIComponent(init)}` : null;
  }
  if (def.id !== 'web' && def.id !== 'tgtg' && def.id !== 'hotels' && def.id !== 'tax' && def.id !== 'agenda') return null;
  const base = absoluteBase(def.route);
  if (!base) return null;
  // Agenda sections ride the same host with a section query (?tab=hostels /
  // tax / agenda); absoluteBase drops it, so re-attach it after the token.
  const section = (() => {
    try {
      const s = new URL(def.route).search;
      return s ? `&${s.slice(1)}` : '';
    } catch {
      return '';
    }
  })();
  if (def.id === 'web' || def.id === 'hotels' || def.id === 'tax' || def.id === 'agenda') {
    const tok = queryToken();
    return tok ? `${base}?token=${encodeURIComponent(tok)}${section}` : null;
  }
  const init = tgInitData();
  if (init) {
    const t = tg();
    const ver = t?.version ? String(t.version) : '8.0';
    const plat = t?.platform ? String(t.platform) : 'unknown';
    return `${base}#tgWebAppData=${encodeURIComponent(init)}&tgWebAppVersion=${encodeURIComponent(ver)}&tgWebAppPlatform=${encodeURIComponent(plat)}`;
  }
  // Real browser (Firebase session): no initData exists. The gateway door
  // admits the frame on ?token= — the page plus its same-origin /api calls
  // (Referer fallback) — and presents the bag viewer credential upstream
  // itself for Firebase sessions, so the tab loads directly, no 2nd click.
  const tok = queryToken();
  return tok ? `${base}?token=${encodeURIComponent(tok)}` : null;
}

function Frame({ src, title }: { src: string; title: string }) {
  return (
    <iframe
      src={src}
      title={title}
      allow="clipboard-read; clipboard-write"
      style={{ flex: '1 1 auto', minHeight: 0, width: '100%', border: 0, background: '#0b1220' }}
    />
  );
}

/** One ☰ trigger per framed tab — except ExternalFrame, which pairs the
 * drawer ☰ with a ⋮ for tab-local actions (Reload, full-screen); everything
 * else lives inside the popup, so normally the only permanent chrome is the
 * trigger itself (+ the tab's own picker, if it has one). The backdrop
 * closes on any outside tap. */
function MenuButton({ children, glyph }: { children: (close: () => void) => ReactNode; glyph?: string }) {
  const [menu, setMenu] = useState(false);
  const close = () => setMenu(false);
  const mark = glyph || '☰';
  return (
    <span style={{ position: 'relative', flex: '0 0 auto' }}>
      <button type="button" aria-label={mark === '☰' ? 'Menu' : 'Actions'} title={mark === '☰' ? 'Menu' : 'Actions'} onClick={() => setMenu((v) => !v)}
        style={{ width: 28, height: 28, borderRadius: 8, background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', fontSize: 15, cursor: 'pointer' }}>
        {mark}
      </button>
      {menu && (
        <>
          <span role="presentation" onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 78 }} />
          <span style={{ position: 'absolute', left: 0, top: 'calc(100% + 6px)', zIndex: 79, minWidth: 230, maxWidth: '78vw', maxHeight: '70dvh', overflowY: 'auto', background: '#0f172a', border: '1px solid #334155', borderRadius: 12, padding: 6, display: 'flex', flexDirection: 'column', gap: 2, overscrollBehavior: 'none' }}>
            {children(close)}
          </span>
        </>
      )}
    </span>
  );
}

const menuItemStyle: Record<string, string | number> = { display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', background: 'none', border: 0, borderRadius: 8, color: '#e2e8f0', fontSize: 13, cursor: 'pointer' };

function MenuDivider() {
  return <span style={{ height: 1, background: '#1e293b', margin: '4px 2px' }} />;
}

/** Cross-host tabs (bags, web, agenda sections) frame their own app with its
 * own door. The left ☰ opens the Mini Apps drawer directly (same as every
 * tab); tab actions (Reload, full-screen) live under ⋮. A spinner covers
 * the frame until its own load event: the serve SPA ships a large bundle, so
 * without it the tab reads as a dead blank page while it loads (live report
 * 2026-10-10). */
function ExternalFrame({ src, def, onMenu }: { src: string; def: MiniAppDef; onMenu: () => void }) {
  const [loaded, setLoaded] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => { setLoaded(false); }, [src]);
  return (
    <>
      <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderBottom: '1px solid #1e293b', background: '#0b1220' }}>
        <button type="button" aria-label="Menu" title="Mini Apps" onClick={onMenu}
          style={{ width: 28, height: 28, borderRadius: 8, background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', fontSize: 15, cursor: 'pointer', flex: '0 0 auto' }}>
          ☰
        </button>
        <span style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 600, flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{def.title}</span>
        <MenuButton glyph="⋮">
          {(close) => (
            <>
              <button type="button" onClick={() => { setLoaded(false); setReloadKey((n) => n + 1); close(); }} style={menuItemStyle}>Reload</button>
              <button type="button" onClick={() => { window.location.href = src; }} style={menuItemStyle}>Open {def.title} full-screen ↗</button>
            </>
          )}
        </MenuButton>
      </div>
      <div style={{ flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
        {!loaded && (
          <div style={{ flex: '1 1 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, background: '#0b1220', color: '#94a3b8', fontSize: 13 }}>
            <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="9" fill="none" stroke="#334155" strokeWidth="3" />
              <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="#7dd3fc" strokeWidth="3" strokeLinecap="round">
                <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite" />
              </path>
            </svg>
            <span>Loading {def.title}…</span>
          </div>
        )}
        <iframe
          key={reloadKey}
          src={src}
          title={def.title as string}
          onLoad={() => setLoaded(true)}
          allow="clipboard-read; clipboard-write"
          style={{ flex: '1 1 auto', minHeight: 0, width: '100%', border: 0, background: '#0b1220', display: loaded ? undefined : 'none' }}
        />
      </div>
    </>
  );
}

function readQuery(): { bot: string; tab: string } {
  try {
    const q = new URLSearchParams(window.location.search || '');
    return { bot: q.get('bot') || '', tab: q.get('tab') || '' };
  } catch {
    return { bot: '', tab: '' };
  }
}

/**
 * Last-visited tab, so a fresh entry (bare domain, bookmark, relaunch)
 * returns to the previous page instead of a hardcoded one. Same hint shape
 * as the fbauth marker: localStorage, validated, never trusted blindly —
 * a disabled/unknown id falls back to the default. The explicit ?tab=
 * query always wins over this.
 */
function readLastTab(): string {
  try {
    const id = window.localStorage.getItem('miniapp:lastTab') || '';
    if (id && miniAppById(id)?.enabled) return id;
  } catch {
    /* storage unavailable — fall through to the default */
  }
  return '';
}

function writeLastTab(id: string) {
  try {
    window.localStorage.setItem('miniapp:lastTab', id);
  } catch {
    /* private mode — tab state stays in memory */
  }
}

// Public Firebase client config (same project as the website:
// health-tracker-b04dd). Client keys are public by design; the check
// happens server-side on the ID token.
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDZg5M8omX-VLax-s-Ti3KdiThMO9AkdNM',
  authDomain: 'health-tracker-b04dd.firebaseapp.com',
  projectId: 'health-tracker-b04dd',
};

/**
 * The login marker lives in localStorage (survives tab close + browser
 * restart) with sessionStorage as a legacy fallback: sessionStorage alone
 * forced a Google sign-in on every fresh tab even with a live Firebase
 * user + live gateway cookie. The marker is only a hint — the gateway
 * cookie (and the silent Firebase re-exchange below) is the real session.
 */
function readFbMarker(): boolean {
  try {
    if (window.localStorage.getItem('fbauth') === '1') return true;
  } catch {
    /* storage unavailable — fall through to sessionStorage */
  }
  try {
    return window.sessionStorage.getItem('fbauth') === '1';
  } catch {
    return false;
  }
}

function writeFbMarker() {
  try {
    window.localStorage.setItem('fbauth', '1');
  } catch {
    /* private mode — sessionStorage below still holds the hint */
  }
  try {
    window.sessionStorage.setItem('fbauth', '1');
  } catch {
    /* private mode — cookie still holds the session */
  }
}

function clearFbMarker() {
  try {
    window.localStorage.removeItem('fbauth');
  } catch {
    /* already gone */
  }
  try {
    window.sessionStorage.removeItem('fbauth');
  } catch {
    /* already gone */
  }
}

/**
 * Silent re-login from the Firebase persisted user (LOCAL persistence
 * survives tab close + browser restart for months). Exchanges a fresh ID
 * token for the gateway cookie without any popup — so a returning browser
 * never sees the Google button when it is already signed in. Returns true
 * when the session was restored.
 */
async function restoreFirebaseSession(): Promise<boolean> {
  try {
    const app = await import('firebase/app');
    const authMod = await import('firebase/auth');
    const fbApp = app.getApps().length
      ? app.getApps()[0]
      : app.initializeApp(FIREBASE_CONFIG);
    const auth = authMod.getAuth(fbApp);
    try {
      await authMod.setPersistence(auth, authMod.browserLocalPersistence);
    } catch {
      /* persistence already set or unavailable — continue with default */
    }
    const user = auth.currentUser || await new Promise<unknown>((resolve) => {
      let done = false;
      const finish = (u: unknown) => { if (!done) { done = true; resolve(u); } };
      try {
        const unsub = authMod.onAuthStateChanged(auth, (u) => { try { unsub(); } catch { /* noop */ } finish(u); });
        setTimeout(() => finish(null), 3000);
      } catch {
        finish(null);
      }
    });
    if (!user) return false;
    const idToken = await (user as { getIdToken: () => Promise<string> }).getIdToken();
    const res = await fetch('/app/auth/firebase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });
    const body = await res.json().catch(() => null);
    if (res.ok && body && body.ok) {
      writeFbMarker();
      return true;
    }
  } catch {
    /* no persisted user or exchange failed — fall through to the button */
  }
  return false;
}

/**
 * Browser login (META-1): a real browser has no Telegram initData, but
 * Google sign-in works there — same Firebase project as the website, so
 * the same account. The ID token is exchanged server-side for the gateway
 * cookie; only a non-sensitive marker stays in localStorage.
 */
function BrowserLogin({ onDone }: { onDone: () => void }) {
  const [state, setState] = useState<'restoring' | 'idle' | 'working' | 'error'>('restoring');
  useEffect(() => {
    let dead = false;
    // Already signed in (Firebase persisted user)? Restore the gateway
    // session silently — no popup, no click.
    restoreFirebaseSession().then((ok) => {
      if (dead) return;
      if (ok) onDone();
      else setState('idle');
    });
    return () => { dead = true; };
  }, []);
  const login = async () => {
    if (state === 'working') return;
    setState('working');
    try {
      const app = await import('firebase/app');
      const authMod = await import('firebase/auth');
      const fbApp = app.getApps().length
        ? app.getApps()[0]
        : app.initializeApp(FIREBASE_CONFIG);
      const auth = authMod.getAuth(fbApp);
      try {
        await authMod.setPersistence(auth, authMod.browserLocalPersistence);
      } catch {
        /* persistence already set or unavailable — continue with default */
      }
      const cred = await authMod.signInWithPopup(auth, new authMod.GoogleAuthProvider());
      const idToken = await cred.user.getIdToken();
      const res = await fetch('/app/auth/firebase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });
      const body = await res.json().catch(() => null);
      if (res.ok && body && body.ok) {
        writeFbMarker();
        onDone();
        return;
      }
      setState('error');
    } catch {
      setState('error');
    }
  };
  return (
    <div style={{ padding: 24, textAlign: 'center' }}>
      <h2 style={{ margin: '0 0 8px' }}>Mini Apps</h2>
      <p style={{ opacity: 0.7 }}>
        You opened this in a browser. Sign in with the same Google account
        you use on the Health Tracker website.
      </p>
      {state === 'restoring' ? (
        <p style={{ opacity: 0.7 }}>Signing you back in…</p>
      ) : (
        <button type="button" onClick={login} disabled={state === 'working'}>
          {state === 'working' ? 'Signing in…' : 'Continue with Google'}
        </button>
      )}
      {state === 'error' && (
        <p style={{ opacity: 0.7 }}>Sign-in failed — try again.</p>
      )}
    </div>
  );
}

function resolveDef(tab: string): MiniAppDef {
  const list = enabledMiniApps();
  const hit = tab ? miniAppById(tab) : undefined;
  if (hit && hit.enabled) return hit;
  return list[0];
}

function openInGateway(route: string) {
  window.location.href = route + (window.location.search || '');
}

/**
 * P3.8 — the webview must not fail silently. Same-origin targets are
 * pre-flighted against the registry `health` endpoint (8s cap) before
 * navigating: a dead backend renders an honest offline card naming it,
 * never a blank page. Absolute URLs skip the check (cross-origin fetch
 * cannot read the answer) and navigate directly.
 */
function GoButton({ def, target, label, health }: { def: MiniAppDef; target: string; label: string; health?: string }) {
  const [state, setState] = useState<'idle' | 'checking' | 'offline'>('idle');
  const go = () => {
    if (state === 'checking') return;
    const check = health !== undefined ? health : def.health || '';
    if (!check.startsWith('/')) {
      // Absolute target (another host/app): navigate bare, in-WebView so the
      // Telegram session (and its initData for the target's own door) stays.
      // The gateway query token is NOT forwarded cross-host. Best-effort
      // BackButton → history.back(); the bot menu button always returns.
      try {
        const t = tg();
        if (t?.BackButton?.show) t.BackButton.show();
        if (t?.BackButton?.onClick) t.BackButton.onClick(() => window.history.back());
      } catch {
        /* older clients — menu button is the way back */
      }
      window.location.href = target;
      return;
    }
    setState('checking');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    fetchLive(check)
      .then((res) => {
        clearTimeout(timer);
        if (res.ok) openInGateway(target);
        else setState('offline');
      })
      .catch(() => {
        clearTimeout(timer);
        setState('offline');
      });
  };
  return (
    <div>
      <button type="button" onClick={go} disabled={state === 'checking'}>
        {state === 'checking' ? 'Checking…' : label}
      </button>
      {state === 'offline' && (
        <p style={{ opacity: 0.7 }}>
          {def.title} is not answering right now (session already refreshed).
          Tap again to retry.
        </p>
      )}
    </div>
  );
}

function BugsTab({ onMenu }: { onMenu: () => void }) {
  const board = useBugBoard({ isOpen: true, language: 'en' });
  return (
    <BugBoard
      {...board}
      onClose={() => tg()?.close?.()}
      language="en"
      embedded
      onMenu={onMenu}
    />
  );
}

function PendingTab({ def, onMenu }: { def: MiniAppDef; onMenu: () => void }) {
  return (
    <div style={{ padding: 24, textAlign: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 8, margin: '0 0 8px' }}>
        <button type="button" aria-label="Menu" onClick={onMenu}
          style={{ width: 32, height: 32, borderRadius: 8, background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', fontSize: 16, cursor: 'pointer' }}>
          ☰
        </button>
        <h2 style={{ margin: 0 }}>{def.title}</h2>
      </div>
      <p style={{ opacity: 0.7 }}>
        This app opens on its own page below — same Telegram session,
        same door. Use the bot&apos;s menu button (bottom-left) to come
        back here.
      </p>
      <GoButton def={def} target={def.route} label={`Open ${def.title}`} />
    </div>
  );
}

function TtyTab({ def, onMenu }: { def: MiniAppDef; onMenu: () => void }) {
  return (
    <div style={{ padding: 24, textAlign: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 8, margin: '0 0 8px' }}>
        <button type="button" aria-label="Menu" onClick={onMenu}
          style={{ width: 32, height: 32, borderRadius: 8, background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', fontSize: 16, cursor: 'pointer' }}>
          ☰
        </button>
        <h2 style={{ margin: 0 }}>{def.title}</h2>
      </div>
      <p style={{ opacity: 0.7 }}>
        A real terminal attaches to this chat&apos;s session. It opens on the
        gateway landing (`/` keeps the bot + token query) so the socket token
        flow stays exactly as today.
      </p>
      <GoButton def={def} target="/" health="/" label="Open the terminal" />
    </div>
  );
}

type TtyRoute = {
  bot: string; path: string;
  // Picker identity: ttyd rows are `tty:<bot>`, bare VM opencode sessions
  // are `opencode:<sessionId>` (several share bot `vm`, so bot alone is not
  // a key). Session rows carry no ttyd path — the frame opens `url`, the
  // public web UI root, instead. All fields optional so older gateways'
  // `{bot, path}` rows keep rendering.
  id?: string; kind?: string; sessionId?: string; title?: string;
  agent?: string; status?: string; updatedAt?: string | null; url?: string;
  // Precomputed subline for synthetic rows (the box aggregate).
  detail?: string;
  // Resident memory of the live tmux tree, MiB, and idle age in ms. Present
  // only on live tty rows from a new gateway; dormant rows, bare sessions
  // and old gateways carry nothing, and the UI renders no number rather
  // than a zero.
  memMiB?: number; idleMs?: number;
};

/** Stable picker key: the row id, falling back to bot for older gateways. */
function ttyRowId(r: TtyRoute): string {
  return (r && typeof r.id === 'string' && r.id) || r.bot;
}

/** Dot language for the session dropdown: green = active, red = idle kill
 * candidate, grey = dormant. The red needs no legend hunt — its row always
 * carries the idle age beside it. */
const DOT_COLOR = { live: '#4ade80', idle: '#f87171', dormant: '#475569' } as const;
const DOT_TITLE = {
  live: 'session live',
  idle: 'session idle — kill candidate',
  dormant: 'session dormant',
} as const;

/** The session dropdown: the trigger shows the current bot with its live
 * dot, and the panel lists every served bot with its own liveness plus
 * View/Kill — the server info used to live behind a second floating
 * burger, now it lives here. The ☰ burger is only ever the Mini Apps nav.
 */
function SessionMenu({ routes, picked, pickedLabel, open, live, mem, idle, act, killMsg, onView, onToggleOpen, onKill, onRefresh }: {
  routes: TtyRoute[] | null; picked: string; pickedLabel: string; open: boolean; live: Record<string, boolean>; mem: Record<string, number>; idle: Record<string, number>; act: Record<string, ActivityBadge>; killMsg: string;
  onView: (id: string) => void; onToggleOpen: () => void; onKill: (bot: string) => void; onRefresh: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const pickedRoute = (routes || []).find((r) => ttyRowId(r) === picked);
  // Badges key `tty:<bot>` for served bots and `ses:<id12>` for bare
  // opencode sessions being worked — a bare row badges when its session
  // matches, so an attached turn is visible on the session itself.
  const actForRow = (rid: string, r?: TtyRoute): ActivityBadge | undefined =>
    act[rid] ?? (r?.kind === 'opencode' && r.sessionId ? act[`ses:${r.sessionId.slice(0, 12)}`] : undefined);
  const pickedLook: RowLook = pickedRoute && picked !== ''
    ? lookForRow(pickedRoute, { live: live[picked] === true, memMiB: mem[picked], idleMs: idle[picked], act: actForRow(picked, pickedRoute) }, Date.now())
    : { dot: 'dormant', memText: '', stateText: '' };
  const pickedState = /^(idle|working|held)/.test(pickedLook.stateText) ? ` · ${pickedLook.stateText}` : '';
  const pickedExtra = `${pickedLook.memText ? ` · ${pickedLook.memText}` : ''}${pickedState}`;
  return (
    <span style={{ position: 'relative', flex: '1 1 auto', minWidth: 0 }}>
      <button type="button" aria-label="Session" title="Sessions" disabled={!routes} onClick={() => setMenu((v) => !v)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 8, padding: '4px 8px', fontSize: 13, cursor: 'pointer' }}>
        <span title={DOT_TITLE[pickedLook.dot]}
          style={{ width: 8, height: 8, borderRadius: 4, background: DOT_COLOR[pickedLook.dot], flex: '0 0 auto' }} />
        <span style={{ flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>
          {routes === null ? 'Loading…' : pickedLabel}{routes === null ? '' : pickedExtra}
        </span>
        <span style={{ color: '#94a3b8' }}>▾</span>
      </button>
      {menu && (
        <>
          <span role="presentation" onClick={() => setMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 78 }} />
          <span style={{ position: 'absolute', left: 0, top: 'calc(100% + 6px)', zIndex: 79, minWidth: 230, maxWidth: '78vw', maxHeight: '70dvh', overflowY: 'auto', background: '#0f172a', border: '1px solid #334155', borderRadius: 12, padding: 6, display: 'flex', flexDirection: 'column', gap: 2, overscrollBehavior: 'none' }}>
            <button type="button" onClick={() => { onToggleOpen(); setMenu(false); }} style={menuItemStyle}>
              {open ? `Close ${pickedLabel}` : `Open ${pickedLabel}`}
            </button>
            <MenuDivider />
            {(routes || []).map((r) => {
              const rid = ttyRowId(r);
              const watching = rid === picked && open;
              const look = lookForRow(r, { live: live[rid] === true, memMiB: mem[rid], idleMs: idle[rid], act: actForRow(rid, r) }, Date.now());
              // Bare VM sessions share bot `vm` and have no tmux to kill:
              // they show their title + model, and View opens the web UI.
              // Raw tmux rows have no route to view — Kill by session name.
              const isSession = r.kind === 'opencode';
              const isTmux = r.kind === 'tmux';
              const isBox = r.kind === 'box';
              // Memory rides the main line where it can be read; the subline
              // explains the dot — tty rows only when red, bare rows always —
              // plus any working/held badge, which is the whole point of it.
              const showSub = isSession
                ? look.stateText !== ''
                : look.dot === 'idle' || look.stateText.startsWith('working') || look.stateText.startsWith('held');
              return (
                <span key={rid}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8, fontSize: 13, color: '#e2e8f0', background: watching ? '#1e293b' : 'none' }}>
                  <span title={DOT_TITLE[look.dot]}
                    style={{ width: 8, height: 8, borderRadius: 4, background: DOT_COLOR[look.dot], flex: '0 0 auto' }} />
                  <span style={{ flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {isSession ? (r.title || r.sessionId || r.bot) : (r.bot === 'vmsession' ? 'VM session' : r.bot)}
                    {look.memText ? ` · ${look.memText}` : ''}
                    {showSub ? (
                      <span style={{ display: 'block', fontSize: 11, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {isSession && r.agent ? `${r.agent} · ` : ''}{look.stateText}
                      </span>
                    ) : null}
                  </span>
                  {watching || isTmux || isBox ? (
                    watching ? <span style={{ color: '#7dd3fc' }}>watching</span> : null
                  ) : (
                    <button type="button" onClick={() => { onView(rid); setMenu(false); }}
                      style={{ background: 'none', border: 0, color: '#7dd3fc', fontSize: 13, cursor: 'pointer', padding: '2px 4px' }}>
                      View
                    </button>
                  )}
                  {isSession || isBox ? null : (
                    <button type="button" onClick={() => onKill(isTmux ? rid : r.bot)}
                      style={{ background: 'none', border: 0, color: '#f0abfc', fontSize: 13, cursor: 'pointer', padding: '2px 4px' }}>
                      Kill
                    </button>
                  )}
                </span>
              );
            })}
            <button type="button" onClick={onRefresh}
              style={{ ...menuItemStyle, color: '#94a3b8' }}>↻ Refresh sessions</button>
            {killMsg && (
              <span style={{ fontSize: 12, color: '#94a3b8', padding: '6px 10px' }}>{killMsg}</span>
            )}
          </span>
        </>
      )}
    </span>
  );
}

/**
 * Terminal tab. One tab, every session: a compact in-flow picker switches
 * between the gateway's ttyd routes (Telegram keeps its single terminal —
 * TG tokens open exactly their own bot's route by design, so no picker
 * there). Frames are same-origin, so a refused/dead route reads back its
 * honest JSON instead of a blank page, with a retry.
 */
function TerminalTab({ def, bot, inTelegram, onMenu, onAuthDead }: { def: MiniAppDef; bot: string; inTelegram: boolean; onMenu: () => void; onAuthDead: () => void }) {
  const [routes, setRoutes] = useState<TtyRoute[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [picked, setPicked] = useState('');
  const [epoch, setEpoch] = useState(0);
  const [offline, setOffline] = useState('');
  // The frame loads directly (no second click), but stays mounted only
  // while open: Close unmounts it without killing anything, Kill frees the
  // backend session's RAM (next Open re-attaches and resumes it).
  const [open, setOpen] = useState(true);
  const [killMsg, setKillMsg] = useState('');
  // Per-bot liveness (green = tmux session alive). Refreshed with the list
  // and after every kill, so each row's Kill targets exactly that bot.
  // mem/idle mirror it: resident MiB and idle age per row key, present only
  // when the gateway reported them (live tty rows on a new gateway; never
  // dormant/bare rows).
  const [live, setLive] = useState<Record<string, boolean>>({});
  const [mem, setMem] = useState<Record<string, number>>({});
  const [idle, setIdle] = useState<Record<string, number>>({});
  const [act, setAct] = useState<Record<string, ActivityBadge>>({});
  // Raw tmux tracking rows (routeless sessions only): view-less, Kill by
  // session name. Refreshed with the status call, same as the maps above.
  const [tmuxRows, setTmuxRows] = useState<TtyRoute[]>([]);
  // The reconciling remainder: PSS outside every tmux tree. Informational
  // only — no View (nothing to attach), no Kill (nothing to target).
  const [boxRow, setBoxRow] = useState<TtyRoute | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  const deadRef = useRef(false);
  const loadTtys = async () => {
    setLoadError('');
    let res: Response | null = null;
    try {
      res = await fetchLive('/api/ttys');
    } catch {
      res = null;
    }
    if (deadRef.current) return;
    if (res && res.status === 401) {
      // Session dead past renewal (cookie gone, stale marker/token left):
      // back to Google sign-in, not an empty picker. Runs on mount and on
      // every session switch, so no path strands.
      onAuthDead();
      return;
    }
    const body = res ? await res.json().catch(() => null) : null;
    if (deadRef.current) return;
    if (!body || body.ok !== true || !Array.isArray(body.ttys)) {
      setLoadError('Could not load sessions.');
      setRoutes([]);
      return;
    }
    const list = body.ttys as TtyRoute[];
    setRoutes(list);
    setPicked((cur) => {
      if (cur && list.some((r) => ttyRowId(r) === cur)) return cur;
      const web = list.find((r) => r.bot === 'web');
      return web ? ttyRowId(web) : (list[0] ? ttyRowId(list[0]) : '');
    });
  };

  const loadStatus = async () => {
    let res: Response | null = null;
    try {
      res = await fetchLive('/api/ttys/status');
    } catch {
      res = null;
    }
    if (deadRef.current) return;
    const body = res ? await res.json().catch(() => null) : null;
    if (deadRef.current) return;
    if (!body || body.ok !== true || !Array.isArray(body.status)) return;
    // Keying lives in statusKeyMaps: bare rows paint only their own id (a
    // live bare session is not a live VM tmux session), ttyd rows paint
    // their tty:<bot> picker id too, or their dot never lights. Routeless
    // tmux entries become view-less tracking rows keyed tmux:<name>.
    const rawTmux = Array.isArray((body as { tmux?: unknown }).tmux)
      ? (body as { tmux?: TmuxEntry[] }).tmux as TmuxEntry[]
      : [];
    const maps = statusKeyMaps(body.status as { id?: string; bot: string; live: boolean; memMiB?: number; idleMs?: number }[], rawTmux);
    // Working/held badges ride the same refresh: a headless turn is the one
    // you cannot see otherwise. Unknown shape degrades to no badges.
    const rawActivity = Array.isArray((body as { activity?: unknown }).activity)
      ? (body as { activity?: ActivityEntry[] }).activity as ActivityEntry[]
      : [];
    const box = (body as { box?: { otherMiB?: number; otherProcs?: number } }).box;
    const boxOk = box && typeof box.otherMiB === 'number' && box.otherMiB > 0;
    setLive(maps.live);
    setMem(boxOk ? { ...maps.mem, 'box:other': box.otherMiB as number } : maps.mem);
    setIdle(maps.idle);
    setAct(activityKeyMaps(rawActivity).act);
    if (boxOk) {
      const n = typeof box.otherProcs === 'number' ? box.otherProcs : 0;
      setBoxRow({
        bot: 'other processes', path: '', id: 'box:other', kind: 'box',
        detail: `${n} process${n === 1 ? '' : 'es'} outside tmux`,
      });
    } else {
      setBoxRow(null);
    }
    setTmuxRows(rawTmux
      .filter((e) => e && !e.route && typeof e.name === 'string' && e.name)
      .map((e) => ({ bot: e.name, path: '', id: `tmux:${e.name}`, kind: 'tmux' })));
  };

  useEffect(() => {
    if (inTelegram) return;
    deadRef.current = false;
    loadTtys();
    loadStatus();
    return () => { deadRef.current = true; };
  }, [inTelegram, reloadKey]);

  if (inTelegram) {
    const tok = queryToken();
    const landing = tok ? `/?bot=${encodeURIComponent(bot)}&token=${encodeURIComponent(tok)}` : null;
    if (!landing) return <TtyTab def={def} onMenu={onMenu} />;
    // Same left burger as every other tab: opens the shell drawer, no
    // detour, no fullscreen. The frame below stays untouched.
    return (
      <div style={{ flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderBottom: '1px solid #1e293b', background: '#0b1220' }}>
          <button type="button" aria-label="Menu" onClick={onMenu}
            style={{ width: 28, height: 28, borderRadius: 8, background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', fontSize: 15, cursor: 'pointer', flex: '0 0 auto' }}>
            ☰
          </button>
          <span style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 600 }}>{def.title}</span>
        </div>
        <Frame key={`tg:${epoch}`} title={def.title as string} src={landing} />
      </div>
    );
  }

  // Heaviest first so kill candidates surface; unmeasured rows (bare
  // sessions with no backend here) keep their order at the bottom.
  const displayRoutes = routes
    ? sortByMem([...routes, ...tmuxRows, ...(boxRow ? [boxRow] : [])], mem)
    : routes;
  const pickedRoute = (displayRoutes || []).find((r) => ttyRowId(r) === picked);
  const pickedLabel = pickedRoute
    ? (pickedRoute.kind === 'opencode'
      ? (pickedRoute.title || pickedRoute.sessionId || picked)
      : (pickedRoute.bot === 'vmsession' ? 'VM session' : pickedRoute.bot))
    : (picked || 'No sessions');
  const tok = queryToken();
  // ttyd rows open their served path; bare VM sessions go through the shared
  // viewer (viewSession above) and only fall back to the public web UI root
  // here when the viewer is not configured — the SPA owns the session route,
  // so the picker does not guess it.
  const pickedBase = pickedRoute ? (pickedRoute.url || pickedRoute.path) : '';
  const src = pickedRoute && tok && pickedBase ? `${pickedBase}?token=${encodeURIComponent(tok)}` : null;

  // Points the shared session viewer at a bare VM session and views it as a
  // real attached TUI (the Terminal tab stays TUI-only; the Web tab stays the
  // opencode web UI). Falls back to the web UI root when the viewer is not
  // configured or the session moved on.
  const viewSession = async (r: TtyRoute) => {
    const rowId = ttyRowId(r);
    let viewerId = '';
    try {
      const res = await fetch('/api/ttys/view' + currentQuery(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: rowId }),
      });
      const body = await res.json().catch(() => null);
      if (res.ok && body && body.ok === true && typeof body.path === 'string' && body.path) {
        viewerId = (typeof body.id === 'string' && body.id) || `tty:${String(body.bot || 'vmsession')}`;
      }
    } catch { /* fall through to the web UI root below */ }
    setPicked(viewerId || rowId);
    setOffline('');
    setKillMsg('');
    setOpen(true);
    renewToken().then((ok) => { setEpoch((n) => n + 1); if (!ok) checkFrame(); loadTtys(); loadStatus(); });
  };

  // Views one ttyd terminal: selects it and (re)mounts the frame.
  const viewBot = (id: string) => {
    setPicked(id);
    setOffline('');
    setKillMsg('');
    setOpen(true);
    renewToken().then((ok) => { setEpoch((n) => n + 1); if (!ok) checkFrame(); loadTtys(); loadStatus(); });
  };

  // Views one session: ttyd rows open their own terminal, bare VM sessions
  // go through the shared viewer above. Raw tmux and box rows have no route
  // to view (they render no View button), so reaching here is a no-op.
  const viewRow = (rid: string) => {
    const row = (displayRoutes || []).find((r) => ttyRowId(r) === rid);
    if (!row || row.kind === 'tmux' || row.kind === 'box') return;
    if (row.kind === 'opencode') { void viewSession(row); return; }
    viewBot(rid);
  };

  // Frees exactly one backend's RAM (operator only). A bot's attach script
  // recreates its tmux session on next open, resuming the same agent
  // session — memory freed, conversation kept, other bots untouched. A raw
  // tmux session is gone for good: the server only kills names from its own
  // fresh listing, never free-form.
  const killSession = async (id: string) => {
    const isTmux = id.startsWith('tmux:');
    const name = isTmux ? id.slice('tmux:'.length) : id;
    if (!name) {
      setKillMsg('Could not stop it.');
      return;
    }
    setKillMsg(`Stopping ${name}…`);
    const send = () => fetch('/api/ttys/kill' + currentQuery(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(isTmux ? { tmux: name } : { bot: id }),
    });
    let res: Response | null = null;
    try {
      res = await send();
    } catch {
      res = null;
    }
    if (res && res.status === 401 && (await renewToken())) {
      try {
        res = await send();
      } catch {
        res = null;
      }
    }
    const body = res ? await res.json().catch(() => null) : null;
    if (res && res.status === 403) {
      setKillMsg('Operator only — Kill needs the operator sign-in.');
      return;
    }
    if (!body || body.ok !== true) {
      setKillMsg(`Could not stop ${name}.`);
      return;
    }
    if (!isTmux) {
      if (id === picked) setOpen(false);
      const pickedRow = (displayRoutes || []).find((r) => ttyRowId(r) === picked);
      if (pickedRow && id === pickedRow.bot) setOpen(false);
    }
    setKillMsg(body.killed
      ? (isTmux ? `Stopped ${name} — memory freed.` : `Stopped ${name} — memory freed. View restarts it.`)
      : `No live ${name} session — nothing was running.`);
    loadStatus();
  };

  // The refusal JSON can arrive after onLoad fires, so an empty read
  // resolves nothing — only a refusal sets the strip, only terminal HTML
  // clears it. Scheduled 3x per frame birth below.
  const checkFrame = () => {
    try {
      const text = (frameRef.current?.contentDocument?.body?.innerText || '').trim();
      if (!text) return;
      // Chrome pretty-prints served JSON (newlines/spaces) — the shared
      // refusal detector strips whitespace before matching.
      if (isRefusalText(text)) {
        let msg = 'terminal refused';
        try { msg = (JSON.parse(text) as { error?: string }).error || msg; } catch { /* raw text */ }
        setOffline(msg);
      } else {
        setOffline('');
      }
    } catch {
      /* cross-origin or unreadable — leave the strip as-is */
    }
  };

  return (
    <div style={{ flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', overscrollBehavior: 'none' }}>
      <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderBottom: '1px solid #1e293b', background: '#0b1220' }}>
        <button type="button" aria-label="Menu" title="Mini Apps" onClick={onMenu}
          style={{ width: 28, height: 28, borderRadius: 8, background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', fontSize: 15, cursor: 'pointer', flex: '0 0 auto' }}>
          ☰
        </button>
        <SessionMenu
          routes={displayRoutes}
          picked={picked}
          pickedLabel={pickedLabel}
          open={open}
          live={live}
          mem={mem}
          idle={idle}
          act={act}
          killMsg={killMsg}
          onView={viewRow}
          onToggleOpen={() => {
            if (open) {
              setOpen(false);
            } else {
              setKillMsg('');
              setOffline('');
              setOpen(true);
              setEpoch((n) => n + 1);
            }
          }}
          onKill={killSession}
          onRefresh={() => { loadTtys(); loadStatus(); }}
        />
        {loadError && (
          <span style={{ fontSize: 12, color: '#f0abfc' }}>
            {loadError}{' '}
            <button type="button" onClick={() => { setRoutes(null); setReloadKey((n) => n + 1); }}
              style={{ background: 'none', border: 0, color: '#7dd3fc', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}>
              Retry
            </button>
          </span>
        )}
        {offline && (
          <span style={{ fontSize: 12, color: '#f0abfc' }}>
            {offline}{' '}
            <button type="button" onClick={() => { setOffline(''); setEpoch((n) => n + 1); }}
              style={{ background: 'none', border: 0, color: '#7dd3fc', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}>
              Retry
            </button>
          </span>
        )}
      </div>
      {src && open ? (
        <iframe
          ref={frameRef}
          key={`${picked}:${epoch}`}
          src={src}
          title={def.title as string}
          allow="clipboard-read; clipboard-write"
          onLoad={() => { [1500, 4000, 8000].forEach((ms) => setTimeout(checkFrame, ms)); }}
          style={{ flex: '1 1 auto', minHeight: 0, width: '100%', border: 0, background: '#0b1220', overscrollBehavior: 'none' }}
        />
      ) : open ? (
        <div style={{ padding: 24, textAlign: 'center', opacity: 0.7 }}>Preparing session…</div>
      ) : (
        <div style={{ padding: 24, textAlign: 'center', opacity: 0.7 }}>
          Terminal closed{killMsg ? '' : ' — Open loads it only when needed'}.
        </div>
      )}
    </div>
  );
}

function Shell() {
  const [query] = useState(readQuery);
  const [tab, setTab] = useState(() => resolveDef(readQuery().tab || readLastTab() || 'tui').id);
  const [drawer, setDrawer] = useState(false);
  // Bumped whenever the page token is (re)minted after first render, so
  // iframe tabs reload with a live credential instead of 401-polling.
  const [queryEpoch, setQueryEpoch] = useState(0);
  const [fbAuthed, setFbAuthed] = useState(() => readFbMarker());
  // Dead-session trip: set alongside setFbAuthed(false) so recovery always
  // re-renders, even when fbAuthed is already false (token-only deep link).
  const [authDeadTrip, setAuthDeadTrip] = useState(false);
  const apps = enabledMiniApps();
  const def = resolveDef(tab);
  // Inside Telegram the initData door owns auth (?bot= required). Outside
  // (plain browser) the Firebase Google branch owns it instead, and the
  // session runs as bot 'web' (the Firebase exchange mints exactly that).
  const inTelegram = inTelegramClient();
  const authed = !authDeadTrip && (inTelegram || fbAuthed || !!queryToken());
  const bot = query.bot || (!inTelegram && fbAuthed ? 'web' : '');

  // Back (button or swipe) closes the drawer instead of leaving the page:
  // opening the drawer pushes one history entry, popping it only closes the
  // drawer — the page itself never changes. Telegram owns back itself (its
  // BackButton above), so this is browser-only.
  const menuPushed = useRef(false);
  // Latest tab/bot for the pop handler below: consuming the pushed drawer
  // entry with history.back() lands on the PRE-drawer URL (stale ?tab=),
  // so the pop re-asserts the current tab — otherwise a drawer visit shows
  // the new tab but refreshes into the old one (live 2026-10-11).
  const navRef = useRef({ tab: '', bot: '' });
  useEffect(() => {
    if (!drawer || inTelegram || menuPushed.current) return;
    try {
      window.history.pushState({ shellMenu: true }, '', window.location.href);
      menuPushed.current = true;
    } catch {
      /* history unavailable — backdrop and × still close */
    }
  }, [drawer, inTelegram]);
  useEffect(() => {
    const onPop = () => {
      menuPushed.current = false;
      setDrawer(false);
      try {
        const n = navRef.current;
        if (n.tab) window.history.replaceState(null, '', tabUrl(window.location.search || '', n.tab, n.bot));
      } catch {
        /* history unavailable — tab state stays in memory */
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  // Every drawer exit funnels here so the pushed entry is consumed: plain
  // setDrawer(false) would strand it and the next back-press would pop a
  // dead entry instead of doing nothing.
  const closeDrawer = () => {
    if (menuPushed.current) {
      menuPushed.current = false;
      try {
        window.history.back();
        return;
      } catch {
        /* fall through to a plain close */
      }
    }
    setDrawer(false);
  };

  useEffect(() => {
    telegramChrome();
    // Frames need ?token= in their own query. Cookie-only sessions (fresh
    // browser login, swallowed query) mint one here so tabs open live.
    try {
      const q = new URLSearchParams(window.location.search || '');
      if (!q.get('token')) {
        renewToken().then((ok) => {
          if (ok) setQueryEpoch((n) => n + 1);
        });
      }
    } catch {
      /* history unavailable — tabs report honestly when refused */
    }
  }, []);

  // Token frames carry ?token= in their own src, minted from the shell's
  // 900s page token. Renew on every switch to any token tab so the frame is
  // born live instead of 401ing inside an unreachable iframe — that hole
  // stranded the agenda sections past their first 15 minutes. initData tabs
  // (forge) re-forward top-level initData per frame — no renewal.
  // A refused renewal is a dead session (past grace/cliff), not a blip:
  // drop to sign-in now rather than mounting frames on a dead credential
  // that can only render refusal JSON (the Hotels "bad token" hole, live
  // 2026-10-11). Network errors stay silent — the tabs report honestly.
  // Telegram is skipped: its doors run on initData and the Google wall
  // would be wrong there.
  useEffect(() => {
    if (def.id === 'forge' || inTelegram) return;
    fetch('/app/token' + currentQuery())
      .then(async (res) => {
        if (res.status === 401) { handleAuthDead(); return; }
        const body = await res.json().catch(() => null);
        if (res.ok && body && body.ok && typeof body.token === 'string' && body.token) {
          setQueryToken(body.token);
          setQueryEpoch((n) => n + 1);
        }
      })
      .catch(() => { /* offline — leave the tabs to report honestly */ });
  }, [def.id]);

  useEffect(() => {
    document.title = `${def.title} — Mini App`;
    writeLastTab(def.id);
    navRef.current = { tab: def.id, bot };
    try {
      window.history.replaceState(null, '', tabUrl(window.location.search || '', def.id, bot));
    } catch {
      /* history unavailable — tab state stays in memory */
    }
  }, [def.id, bot]);

  useEffect(() => {
    const t = tg();
    if (!t?.BackButton) return;
    try {
      if (drawer) {
        t.BackButton.show?.();
        t.BackButton.onClick?.(() => setDrawer(false));
      } else {
        t.BackButton.hide?.();
      }
    } catch {
      /* older clients — drawer still closes via the header button */
    }
  }, [drawer]);

  // A 401 past renewal means the browser session is dead (900s cookie
  // gone, stale marker/token left): drop back to Google sign-in with a clean
  // slate instead of stranding tabs on empty states.
  const handleAuthDead = () => {
    try {
      clearFbMarker();
      const q = new URLSearchParams(window.location.search || '');
      q.delete('token');
      window.history.replaceState(null, '', `?${q.toString()}`);
    } catch {
      /* storage/history unavailable — the state flip below still logs out */
    }
    setFbAuthed(false);
    setAuthDeadTrip(true);
  };

  // Framed tabs host their own in-header burger (fleet/review/terminal/bag
  // page headers, BugBoard header): it postMessages the shell to open the
  // drawer. The shell renders no bar of its own, so nothing can overlap.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      try {
        if (e && e.data && (e.data as any).type === 'shell:menu') setDrawer(true);
      } catch {
        /* malformed message — ignore */
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  if (!authed) {
    return (
      <BrowserLogin
        onDone={() => {
          try {
            const q = new URLSearchParams(window.location.search || '');
            if (!q.get('bot')) {
              q.set('bot', 'web');
              window.history.replaceState(null, '', `?${q.toString()}`);
            }
          } catch {
            /* history unavailable — bot default below still applies */
          }
          setFbAuthed(true);
          // A sign-in (button or silent restore) recovers from a tripped
          // dead session — without this the wall stays up forever.
          setAuthDeadTrip(false);
          // The gateway cookie is brand new here but ?token= is absent, and
          // the mount/tab renew effects already ran while the wall was up
          // (no cookie then, tab unchanged since) — so nothing else will
          // mint it. Renew now or token tabs strand on "Preparing
          // session…" with a loaded picker and no frame.
          renewToken().then((ok) => { if (ok) setQueryEpoch((n) => n + 1); });
        }}
      />
    );
  }

  if (!bot && inTelegram) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        No bot — open this from a bot button in Telegram.
      </div>
    );
  }

  // No shell header bar: the burger lives inside each tab's own header
  // (BugBoard header, fleet/review mastheads, terminal chrome, bag topbar),
  // opening this drawer via postMessage — so it can neither cover tab
  // content nor be covered by it. Fallback cards carry an inline burger.
  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', overscrollBehavior: 'none' }}>
      {drawer && (
        <div role="presentation" onClick={closeDrawer}
          style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(2,6,23,0.6)' }}>
          <nav aria-label="Mini apps" onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(320px, 85vw)', height: '100%', background: '#0f172a', borderRight: '1px solid #334155', padding: '12px 0', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px 10px' }}>
              <button type="button" aria-label="Close menu" onClick={closeDrawer}
                style={{ width: 28, height: 28, borderRadius: 8, background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', fontSize: 15, cursor: 'pointer', flex: '0 0 auto' }}>
                ×
              </button>
              <span style={{ color: '#94a3b8', fontSize: 12 }}>Mini Apps</span>
            </div>
            {apps.map((a) => (
              <button key={a.id} type="button" onClick={() => { closeDrawer(); setTab(a.id); }}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', background: 'none', border: 0, color: '#e2e8f0', cursor: 'pointer', fontWeight: a.id === def.id ? 700 : 400 }}>
                {a.title}
              </button>
            ))}
          </nav>
        </div>
      )}
      <main style={{ flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', overscrollBehavior: 'none' }}>
        {def.id === 'bugs' ? (
          <BugsTab onMenu={() => setDrawer(true)} />
        ) : def.id === 'tui' ? (
          <TerminalTab def={def} bot={bot} inTelegram={inTelegram} onMenu={() => setDrawer(true)} onAuthDead={handleAuthDead} />
        ) : frameSrc(def, bot) ? (
          def.id === 'tgtg' || def.id === 'web' || def.id === 'hotels' || def.id === 'tax' || def.id === 'agenda' || def.id === 'forge' ? (
            <ExternalFrame key={`${def.id}:${queryEpoch}`} def={def} src={frameSrc(def, bot) as string} onMenu={() => setDrawer(true)} />
          ) : (
            <Frame key={`${def.id}:${queryEpoch}`} title={def.title as string} src={frameSrc(def, bot) as string} />
          )
        ) : (
          <PendingTab def={def} onMenu={() => setDrawer(true)} />
        )}
      </main>
    </div>
  );
}

// Pull-to-refresh lock for the shell document itself: a transcript drag is
// the same direction as the browser's reload gesture, so the outer page must
// never overscroll into a refresh. Runs everywhere, not just Telegram.
try {
  document.documentElement.style.overscrollBehavior = 'none';
  document.body.style.overscrollBehavior = 'none';
} catch {
  /* non-DOM render — nothing to lock */
}

telegramChrome();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Shell />
  </StrictMode>,
);
