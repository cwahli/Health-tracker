import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { enabledMiniApps, miniAppById, type MiniAppDef } from './miniapp-registry';
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

/**
 * Same-gateway tabs render INSIDE the shell (burger stays put) via iframe.
 * Each door gets exactly what it accepts, nothing more:
 * - fleet/review/terminal: ?token= (their API doors read the query token)
 * - forge: ?initData= (its door takes initData header-or-query only)
 * The iframe has no Telegram bridge, so nothing here depends on it.
 */
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
  return null;
}

function Frame({ src, title }: { src: string; title: string }) {
  return (
    <iframe
      src={src}
      title={title}
      style={{ flex: '1 1 auto', minHeight: 0, width: '100%', border: 0, background: '#0b1220' }}
    />
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

// Public Firebase client config (same project as the website:
// health-tracker-b04dd). Client keys are public by design; the check
// happens server-side on the ID token.
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDZg5M8omX-VLax-s-Ti3KdiThMO9AkdNM',
  authDomain: 'health-tracker-b04dd.firebaseapp.com',
  projectId: 'health-tracker-b04dd',
};

/**
 * Browser login (META-1): a real browser has no Telegram initData, but
 * Google sign-in works there — same Firebase project as the website, so
 * the same account. The ID token is exchanged server-side for the gateway
 * cookie; only a non-sensitive marker stays in sessionStorage.
 */
function BrowserLogin({ onDone }: { onDone: () => void }) {
  const [state, setState] = useState<'idle' | 'working' | 'error'>('idle');
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
      const cred = await authMod.signInWithPopup(auth, new authMod.GoogleAuthProvider());
      const idToken = await cred.user.getIdToken();
      const res = await fetch('/app/auth/firebase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });
      const body = await res.json().catch(() => null);
      if (res.ok && body && body.ok) {
        try {
          window.sessionStorage.setItem('fbauth', '1');
        } catch {
          /* private mode — cookie still holds the session */
        }
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
      <button type="button" onClick={login} disabled={state === 'working'}>
        {state === 'working' ? 'Signing in…' : 'Continue with Google'}
      </button>
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
      // BackButton → history.back() so the phone can return; the bot's menu
      // button (bottom-left) always returns regardless.
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

function openExternal(def: MiniAppDef) {
  const t = tg();
  // External entries carry the absolute URL in `route` (no `url` field).
  const url = def.route;
  try {
    if (t?.openLink) {
      t.openLink(url);
      return;
    }
  } catch {
    /* fall through to plain navigation */
  }
  window.location.href = url;
}

function BugsTab() {
  const board = useBugBoard({ isOpen: true, language: 'en' });
  return (
    <BugBoard
      {...board}
      onClose={() => tg()?.close?.()}
      language="en"
      embedded
    />
  );
}

function PendingTab({ def }: { def: MiniAppDef }) {
  return (
    <div style={{ padding: 24, textAlign: 'center' }}>
      <h2 style={{ margin: '0 0 8px' }}>{def.title}</h2>
      <p style={{ opacity: 0.7 }}>
        This app opens on its own page below — same Telegram session,
        same door. Use the bot&apos;s menu button (bottom-left) to come
        back here.
      </p>
      <GoButton def={def} target={def.route} label={`Open ${def.title}`} />
    </div>
  );
}

function TtyTab({ def }: { def: MiniAppDef }) {
  return (
    <div style={{ padding: 24, textAlign: 'center' }}>
      <h2 style={{ margin: '0 0 8px' }}>{def.title}</h2>
      <p style={{ opacity: 0.7 }}>
        A real terminal attaches to this chat&apos;s session. It opens on the
        gateway landing (`/` keeps the bot + token query) so the socket token
        flow stays exactly as today.
      </p>
      <GoButton def={def} target="/" health="/" label="Open the terminal" />
    </div>
  );
}

function Shell() {
  const [query] = useState(readQuery);
  const [tab, setTab] = useState(() => resolveDef(readQuery().tab).id);
  const [drawer, setDrawer] = useState(false);
  // Bumped whenever the page token is (re)minted after first render, so
  // iframe tabs reload with a live credential instead of 401-polling.
  const [queryEpoch, setQueryEpoch] = useState(0);
  const [fbAuthed, setFbAuthed] = useState(() => {
    try {
      return window.sessionStorage.getItem('fbauth') === '1';
    } catch {
      return false;
    }
  });
  const apps = enabledMiniApps();
  const def = resolveDef(tab);
  // Inside Telegram the initData door owns auth (?bot= required). Outside
  // (plain browser) the Firebase Google branch owns it instead.
  const inTelegram = !!tg();

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

  useEffect(() => {
    document.title = `${def.title} — Mini App`;
    try {
      const q = new URLSearchParams(window.location.search || '');
      q.set('tab', def.id);
      if (query.bot) q.set('bot', query.bot);
      window.history.replaceState(null, '', `?${q.toString()}`);
    } catch {
      /* history unavailable — tab state stays in memory */
    }
  }, [def.id, query.bot]);

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

  if (!query.bot && inTelegram) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        No bot — open this from a bot button in Telegram.
      </div>
    );
  }

  if (!query.bot && !inTelegram && !fbAuthed) {
    return <BrowserLogin onDone={() => setFbAuthed(true)} />;
  }

  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <header
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '8px 12px', borderBottom: '1px solid #1e293b', flex: '0 0 auto',
        }}
      >
        <button type="button" aria-label="Menu" onClick={() => setDrawer((v) => !v)}>
          ☰
        </button>
        <strong>{def.title}</strong>
      </header>
      {drawer && (
        <nav aria-label="Mini apps">
          {apps.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                setDrawer(false);
                if (a.kind === 'external') {
                  openExternal(a);
                  return;
                }
                setTab(a.id);
              }}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '10px 12px',
                fontWeight: a.id === def.id ? 700 : 400,
              }}
            >
              {a.title}
            </button>
          ))}
        </nav>
      )}
      <main style={{ flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {def.id === 'bugs' ? (
          <BugsTab />
        ) : frameSrc(def, query.bot) ? (
          <Frame key={`${def.id}:${queryEpoch}`} title={def.title as string} src={frameSrc(def, query.bot) as string} />
        ) : def.kind === 'tty' ? (
          <TtyTab def={def} />
        ) : (
          <PendingTab def={def} />
        )}
      </main>
    </div>
  );
}

telegramChrome();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Shell />
  </StrictMode>,
);
