import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { initGlobalBreadcrumbListeners, initNetworkDiagnosticInterceptor } from './utils/breadcrumbTracker';

// Initialize global breadcrumb and network diagnostic tracking
initGlobalBreadcrumbListeners();
initNetworkDiagnosticInterceptor();

// Global diagnostic trackers
declare global {
  interface Window {
    __clientConsoleLogs?: string[];
    __clientNetworkErrors?: string[];
    __lastUserAction?: { action: string; prompt?: string; timestamp: string; details?: any };
  }
}

window.__clientConsoleLogs = window.__clientConsoleLogs || [];
window.__clientNetworkErrors = window.__clientNetworkErrors || [];

const isBenignError = (message?: string): boolean => {
  if (!message) return false;
  const msg = String(message).toLowerCase();
  return (
    msg.includes('websocket closed without opened') ||
    msg.includes('failed to connect to websocket') ||
    msg.includes('[vite] failed to connect') ||
    msg.includes('resizeobserver loop') ||
    msg.includes('aborterror') ||
    msg.includes('the user aborted a request') ||
    msg.includes('the operation was aborted') ||
    msg.includes('failed to fetch') ||
    msg.includes('load failed') ||
    msg.includes('network error') ||
    msg.includes('networkerror')
  );
};

window.addEventListener('error', (e) => {
  try {
    const rawMsg = e.message || e.error?.message || '';
    if (isBenignError(rawMsg)) {
      e.preventDefault();
      return;
    }
    fetch('/api/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: rawMsg, stack: e.error?.stack })
    }).catch(() => null);
  } catch (err) {}
});
window.addEventListener('unhandledrejection', (e) => {
  try {
    const rawMsg = e.reason?.message || String(e.reason) || '';
    if (isBenignError(rawMsg)) {
      e.preventDefault();
      return;
    }
    fetch('/api/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: rawMsg, stack: e.reason?.stack })
    }).catch(() => null);
  } catch (err) {}
});
const origError = console.error;
const origWarn = console.warn;
const origLog = console.log;
const origInfo = console.info;

const shouldIgnoreConsoleNoise = (msg: string): boolean => {
  const lower = msg.toLowerCase();
  return (
    lower.includes('[vite] connecting') ||
    lower.includes('[vite] connected') ||
    lower.includes('[vite] failed to connect to websocket')
  );
};

const pushClientLog = (prefix: string, rawMsg: string) => {
  if (!window.__clientConsoleLogs) return;
  if (shouldIgnoreConsoleNoise(rawMsg)) return;

  const jobIdTag = window.__activeJobId ? ` [${window.__activeJobId}]` : '';
  const entry = `[${prefix} ${new Date().toISOString()}]${jobIdTag} ${rawMsg}`;
  const last = window.__clientConsoleLogs[window.__clientConsoleLogs.length - 1];
  if (last && last.replace(/^\[[A-Z_\s0-9:.-]+\](?:\s*\[[^\]]+\])?\s*/, '') === rawMsg) {
    // Avoid spamming consecutive duplicates
    return;
  }
  window.__clientConsoleLogs.push(entry);
  if (window.__clientConsoleLogs.length > 500) window.__clientConsoleLogs.shift();
};

console.error = (...args: any[]) => {
  try {
    const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    pushClientLog('ERROR', msg);
  } catch (_) {}
  origError.apply(console, args);
};

console.warn = (...args: any[]) => {
  try {
    const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    pushClientLog('WARN', msg);
  } catch (_) {}
  origWarn.apply(console, args);
};

console.log = (...args: any[]) => {
  try {
    const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    pushClientLog('LOG', msg);
  } catch (_) {}
  origLog.apply(console, args);
};

console.info = (...args: any[]) => {
  try {
    const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    pushClientLog('INFO', msg);
  } catch (_) {}
  origInfo.apply(console, args);
};

window.addEventListener('unhandledrejection', (event) => {
  try {
    const reason = event.reason?.message || String(event.reason || '');
    pushClientLog('UNHANDLED PROMISE', reason);
  } catch (_) {}
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
