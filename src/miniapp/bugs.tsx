import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BugBoard } from '../components/bug-board/BugBoard';
import { useBugBoard } from '../components/bug-board/useBugBoard';
import '../index.css';

declare global {
  interface Window {
    Telegram?: any;
  }
}

/**
 * Telegram mini-app entry for the shared bug board (packet bug-board-miniapp,
 * Node 4). Renders the exact same BugBoard + useBugBoard as the site modal —
 * no fork, no second formatter. Auth is Telegram initData only: no
 * Firebase/Google code is imported here (see the client import boundary
 * test). The server-side initData exchange lives in the gateway (Node 5).
 */
function telegramChrome() {
  try {
    const tg = window.Telegram?.WebApp;
    if (!tg) return;
    if (tg.ready) tg.ready();
    if (tg.expand) tg.expand();
  } catch {
    /* dev browser without Telegram — board still renders */
  }
}

function BugsMiniApp() {
  const board = useBugBoard({ isOpen: true, language: 'en' });
  return (
    <BugBoard
      {...board}
      onClose={() => window.Telegram?.WebApp?.close?.()}
      language="en"
    />
  );
}

telegramChrome();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BugsMiniApp />
  </StrictMode>
);
