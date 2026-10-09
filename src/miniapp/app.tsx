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
  } catch {
    /* dev browser without Telegram — shell still renders */
  }
}

function readQuery(): { bot: string; tab: string } {
  try {
    const q = new URLSearchParams(window.location.search || '');
    return { bot: q.get('bot') || '', tab: q.get('tab') || '' };
  } catch {
    return { bot: '', tab: '' };
  }
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
    />
  );
}

function PendingTab({ def }: { def: MiniAppDef }) {
  return (
    <div style={{ padding: 24, textAlign: 'center' }}>
      <h2 style={{ margin: '0 0 8px' }}>{def.title}</h2>
      <p style={{ opacity: 0.7 }}>
        Migrates into this shell in P3. Until then the standalone page below
        is the live view — same door, same data.
      </p>
      <button type="button" onClick={() => openInGateway(def.route)}>
        Open {def.title}
      </button>
    </div>
  );
}

function TtyTab({ def }: { def: MiniAppDef }) {
  return (
    <div style={{ padding: 24, textAlign: 'center' }}>
      <h2 style={{ margin: '0 0 8px' }}>{def.title}</h2>
      <p style={{ opacity: 0.7 }}>
        A real terminal attaches to this chat&apos;s session. It opens on its
        own route so the socket token flow stays exactly as today.
      </p>
      <button type="button" onClick={() => openInGateway(def.route)}>
        Open the terminal
      </button>
    </div>
  );
}

function Shell() {
  const [query] = useState(readQuery);
  const [tab, setTab] = useState(() => resolveDef(readQuery().tab).id);
  const [drawer, setDrawer] = useState(false);
  const apps = enabledMiniApps();
  const def = resolveDef(tab);

  useEffect(() => {
    telegramChrome();
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

  if (!query.bot) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        No bot — open this from a bot button in Telegram.
      </div>
    );
  }

  return (
    <div>
      <header
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '8px 12px', borderBottom: '1px solid #1e293b',
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
      <main>
        {def.id === 'bugs' ? (
          <BugsTab />
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
