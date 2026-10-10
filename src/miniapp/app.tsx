import { StrictMode, useEffect, useRef, useState } from 'react';
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
  if (def.id !== 'web' && def.id !== 'tgtg') return null;
  const base = absoluteBase(def.route);
  if (!base) return null;
  if (def.id === 'web') {
    const tok = queryToken();
    return tok ? `${base}?token=${encodeURIComponent(tok)}` : null;
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

/** Cross-host tabs (bags, web) frame their own app with its own door, so the
 * burger never unloads. The full-screen link is the honest escape hatch. */
function ExternalFrame({ src, def }: { src: string; def: MiniAppDef }) {
  return (
    <>
      <Frame src={src} title={def.title as string} />
      <div style={{ flex: '0 0 auto', textAlign: 'center', padding: '4px 8px', borderTop: '1px solid #1e293b' }}>
        <button
          type="button"
          onClick={() => { window.location.href = src; }}
          style={{ background: 'none', border: 0, color: '#7dd3fc', fontSize: 12, cursor: 'pointer' }}
        >
          Blank page? Open {def.title} full-screen ↗
        </button>
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, margin: '0 0 8px' }}>
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, margin: '0 0 8px' }}>
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

type TtyRoute = { bot: string; path: string };

/**
 * Terminal tab. One tab, every session: a compact in-flow picker switches
 * between the gateway's ttyd routes (Telegram keeps its single terminal —
 * TG tokens open exactly their own bot's route by design, so no picker
 * there). Frames are same-origin, so a refused/dead route reads back its
 * honest JSON instead of a blank page, with a retry.
 */
function TerminalTab({ def, bot, inTelegram, onMenu }: { def: MiniAppDef; bot: string; inTelegram: boolean; onMenu: () => void }) {
  const [routes, setRoutes] = useState<TtyRoute[] | null>(null);
  const [picked, setPicked] = useState('');
  const [epoch, setEpoch] = useState(0);
  const [offline, setOffline] = useState('');
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    if (inTelegram) return;
    let dead = false;
    fetchLive('/api/ttys').then(async (res) => {
      const body = await res.json().catch(() => null);
      if (dead) return;
      const list = body && body.ok && Array.isArray(body.ttys) ? body.ttys as TtyRoute[] : [];
      setRoutes(list);
      setPicked((cur) => cur || (list.some((r) => r.bot === 'web') ? 'web' : (list[0]?.bot || '')));
    }).catch(() => { if (!dead) setRoutes([]); });
    return () => { dead = true; };
  }, [inTelegram]);

  if (inTelegram) {
    const tok = queryToken();
    const landing = tok ? `/?bot=${encodeURIComponent(bot)}&token=${encodeURIComponent(tok)}` : null;
    if (!landing) return <TtyTab def={def} onMenu={onMenu} />;
    return <Frame key={`tg:${epoch}`} title={def.title as string} src={landing} />;
  }

  const pickedRoute = (routes || []).find((r) => r.bot === picked);
  const tok = queryToken();
  const src = pickedRoute && tok ? `${pickedRoute.path}?token=${encodeURIComponent(tok)}` : null;

  const checkFrame = () => {
    try {
      const text = frameRef.current?.contentDocument?.body?.innerText || '';
      if (text.trim().startsWith('{"ok":false')) {
        let msg = 'terminal refused';
        try { msg = (JSON.parse(text) as { error?: string }).error || msg; } catch { /* raw text */ }
        setOffline(msg);
      } else {
        setOffline('');
      }
    } catch {
      setOffline('');
    }
  };

  return (
    <div style={{ flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderBottom: '1px solid #1e293b', background: '#0b1220' }}>
        <label htmlFor="tty-session" style={{ fontSize: 12, color: '#94a3b8' }}>Session</label>
        <select
          id="tty-session"
          value={picked}
          disabled={!routes}
          onChange={(e) => {
            setPicked(e.target.value);
            setOffline('');
            renewToken().then((ok) => { setEpoch((n) => n + 1); if (!ok) checkFrame(); });
          }}
          style={{ background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 8, padding: '4px 8px', fontSize: 13 }}
        >
          {routes === null && <option value="">Loading…</option>}
          {routes !== null && routes.length === 0 && <option value="">No sessions</option>}
          {(routes || []).map((r) => (
            <option key={r.bot} value={r.bot}>{r.bot}</option>
          ))}
        </select>
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
      {src ? (
        <iframe
          ref={frameRef}
          key={`${picked}:${epoch}`}
          src={src}
          title={def.title as string}
          allow="clipboard-read; clipboard-write"
          onLoad={() => setTimeout(checkFrame, 1500)}
          style={{ flex: '1 1 auto', minHeight: 0, width: '100%', border: 0, background: '#0b1220' }}
        />
      ) : (
        <div style={{ padding: 24, textAlign: 'center', opacity: 0.7 }}>Preparing session…</div>
      )}
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
  // (plain browser) the Firebase Google branch owns it instead, and the
  // session runs as bot 'web' (the Firebase exchange mints exactly that).
  const inTelegram = inTelegramClient();
  const authed = inTelegram || fbAuthed || !!queryToken();
  const bot = query.bot || (!inTelegram && fbAuthed ? 'web' : '');

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
  // 900s page token. Renew on every switch to a token tab so the frame is
  // born live instead of 401ing inside an unreachable iframe. initData tabs
  // (bags, forge) re-forward top-level initData per frame — no renewal.
  useEffect(() => {
    if (def.id === 'fleet' || def.id === 'review' || def.id === 'tui' || def.id === 'web') {
      renewToken().then((ok) => {
        if (ok) setQueryEpoch((n) => n + 1);
      });
    }
  }, [def.id]);

  useEffect(() => {
    document.title = `${def.title} — Mini App`;
    try {
      const q = new URLSearchParams(window.location.search || '');
      q.set('tab', def.id);
      if (bot) q.set('bot', bot);
      window.history.replaceState(null, '', `?${q.toString()}`);
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
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
      {drawer && (
        <div role="presentation" onClick={() => setDrawer(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(2,6,23,0.6)' }}>
          <nav aria-label="Mini apps" onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(320px, 85vw)', height: '100%', background: '#0f172a', borderRight: '1px solid #334155', padding: '12px 0', overflowY: 'auto' }}>
            <div style={{ padding: '4px 12px 10px', color: '#94a3b8', fontSize: 12 }}>Mini Apps</div>
            {apps.map((a) => (
              <button key={a.id} type="button" onClick={() => { setDrawer(false); setTab(a.id); }}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', background: 'none', border: 0, color: '#e2e8f0', cursor: 'pointer', fontWeight: a.id === def.id ? 700 : 400 }}>
                {a.title}
              </button>
            ))}
          </nav>
        </div>
      )}
      <main style={{ flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {def.id === 'bugs' ? (
          <BugsTab onMenu={() => setDrawer(true)} />
        ) : def.id === 'tui' ? (
          <TerminalTab def={def} bot={bot} inTelegram={inTelegram} onMenu={() => setDrawer(true)} />
        ) : frameSrc(def, bot) ? (
          def.id === 'tgtg' || def.id === 'web' ? (
            <ExternalFrame key={`${def.id}:${queryEpoch}`} def={def} src={frameSrc(def, bot) as string} />
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

telegramChrome();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Shell />
  </StrictMode>,
);
