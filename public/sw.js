self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Intercept same-origin module, script, and style requests
  // Do NOT intercept API routes, SSE streams, or external URLs
  if (
    url.origin === self.location.origin &&
    !url.pathname.startsWith('/api/')
  ) {
    // Let navigation requests pass through with standard network fetch
    if (event.request.mode === 'navigate') {
      return;
    }

    event.respondWith((async () => {
      let attempts = 0;
      const maxAttempts = 3;
      while (attempts < maxAttempts) {
        attempts++;
        try {
          const response = await fetch(event.request.clone());
          // If rate limited by cloud proxy (429) or transient 503, retry with backoff
          if ((response.status === 429 || response.status === 503) && attempts < maxAttempts) {
            const delay = 50 * Math.pow(1.8, attempts) + Math.random() * 40;
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }
          return response;
        } catch (err) {
          if (attempts < maxAttempts) {
            const delay = 60 * Math.pow(1.8, attempts);
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }
          break;
        }
      }
      try {
        return await fetch(event.request);
      } catch (finalErr) {
        return new Response('Network error occurred. Please reload.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain' },
        });
      }
    })());
  }
});
