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

export function setupErrorLogger() {
  window.addEventListener('error', (event) => {
    const rawMsg = event.message || event.error?.message || '';
    if (isBenignError(rawMsg)) {
      event.preventDefault();
      return;
    }
    fetch('/api/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: rawMsg, stack: event.error?.stack })
    }).catch(() => {});
  });
  window.addEventListener('unhandledrejection', (event) => {
    const rawMsg = event.reason?.message || String(event.reason) || '';
    if (isBenignError(rawMsg)) {
      event.preventDefault();
      return;
    }
    fetch('/api/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: rawMsg, stack: event.reason?.stack })
    }).catch(() => {});
  });
}
