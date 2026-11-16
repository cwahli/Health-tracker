import React from 'react';

/**
 * Wraps React.lazy with automatic reload/retry behavior when dynamic module imports fail
 * (e.g. after a dev server restart, build deployment, or stale asset hash in browser cache).
 */
export function lazyWithRetry<T extends React.ComponentType<any>>(
  componentImport: () => Promise<{ default: T }>
): React.LazyExoticComponent<T> {
  return React.lazy(async () => {
    const pageHasBeenReloadedKey = 'vite_dynamic_import_reloaded';

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const component = await componentImport();
        if (typeof window !== 'undefined') {
          window.sessionStorage.removeItem(pageHasBeenReloadedKey);
        }
        return component;
      } catch (error: any) {
        console.warn(`[lazyWithRetry] Module import attempt ${attempt + 1} failed:`, error?.message || error);
        
        if (attempt < 2) {
          // Wait 300ms before retrying import
          await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        } else {
          // Attempt a one-time soft page reload if we haven't already
          if (typeof window !== 'undefined') {
            const hasReloaded = window.sessionStorage.getItem(pageHasBeenReloadedKey);
            if (!hasReloaded) {
              window.sessionStorage.setItem(pageHasBeenReloadedKey, 'true');
              window.location.reload();
              return new Promise(() => {}); // Wait for page reload
            }
            window.sessionStorage.removeItem(pageHasBeenReloadedKey);
          }

          // Fallback UI Component if module fetch remains unavailable
          const FallbackComponent: React.ComponentType<any> = (props: any) => (
            React.createElement('div', { className: 'p-4 m-2 rounded bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-300 text-sm text-center' },
              React.createElement('p', null, 'Component temporarily unavailable due to a network update.'),
              React.createElement('button', {
                type: 'button',
                onClick: () => {
                  if (typeof window !== 'undefined') {
                    window.sessionStorage.removeItem(pageHasBeenReloadedKey);
                    window.location.reload();
                  }
                },
                className: 'mt-2 px-3 py-1 bg-amber-700 text-white rounded text-xs hover:bg-amber-800 font-medium cursor-pointer'
              }, 'Reload App')
            )
          );
          return { default: FallbackComponent as unknown as T };
        }
      }
    }
    return new Promise(() => {});
  });
}
