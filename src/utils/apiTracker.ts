import { getAuth } from 'firebase/auth';
export interface ApiCallEvent {
  timestamp: string;
  type: 'gemini' | 'usda' | 'brave' | 'unsplash' | 'wikipedia' | 'firebase_read' | 'firebase_write' | 'firebase_delete' | 'supabase_read' | 'supabase_write' | 'supabase_delete';
  label: string;
  queryId: string;
  userEmail: string;
  syncStatus?: 'local' | 'synced';
}
let currentQueryId = "init_" + Date.now();
export const generateQueryId = () => {
  return "session_" + Math.random().toString(36).substring(2, 10) + "_" + Date.now();
};
export const setActiveQueryId = (id: string | null) => {
  currentQueryId = id || "main_" + Date.now();
};
export const getActiveQueryId = () => currentQueryId;
export const trackApiCall = (
  type: ApiCallEvent['type'],
  label: string,
  userEmail: string = 'anonymous'
) => {
  let resolvedEmail = userEmail;
  if (resolvedEmail === 'anonymous') {
    try {
      const auth = getAuth();
      if (auth.currentUser?.email) {
        resolvedEmail = auth.currentUser.email;
      }
    } catch (e) {
      // Auth may not be initialized yet
    }
  }
  const event: ApiCallEvent = {
    timestamp: new Date().toISOString(),
    type,
    label,
    queryId: currentQueryId,
    userEmail: resolvedEmail,
    syncStatus: 'local'
  };
  
  try {
    const existing = localStorage.getItem('local_api_events');
    const events: ApiCallEvent[] = existing ? JSON.parse(existing) : [];
    events.push(event);
    if (events.length > 2000) events.shift();
    localStorage.setItem('local_api_events', JSON.stringify(events));
    // Dispatch a custom event so that components can listen and re-render in real time
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('local_api_event_added', { detail: event }));
    }
  } catch (e) {
    console.warn("Could not save api event", e);
  }
};
// Global Fetch Interceptor to automatically track server-side API/Agent calls
export const initializeFetchInterceptor = () => {
  if (typeof window === 'undefined' || (window as any).__fetch_interceptor_active) return;
  (window as any).__fetch_interceptor_active = true;
  const originalFetch = window.fetch;
  
  const wrappedFetch = async function(input: RequestInfo | URL, init?: RequestInit) {
    const response = await originalFetch(input, init);
    const url = typeof input === 'string' 
      ? input 
      : (input instanceof URL 
          ? input.toString() 
          : (input && typeof input === 'object' && 'url' in input ? (input as any).url : ''));
    
    if (url.includes('/api/gemini/')) {
      try {
        const cloned = response.clone();
        const text = await cloned.text().catch(() => "");
        let data: any = null;
        if (text) {
          try {
            data = JSON.parse(text);
          } catch (e) {}
        }
        if (data && Array.isArray(data.apiCalls)) {
          data.apiCalls.forEach((call: any) => {
            if (call.type && call.label) {
              trackApiCall(call.type, call.label);
            }
          });
        } else if (
          !url.includes('/api/gemini/debug-logs') &&
          !url.includes('/api/gemini/clear-debug-logs') &&
          !url.includes('/api/gemini/send-logs') &&
          !url.includes('/api/golden/')
        ) {
          // Fallback tracking if the server endpoint did not return an explicit apiCalls metadata array
          let type: ApiCallEvent['type'] = 'gemini';
          let label = 'Gemini Agent call';
          if (url.includes('/food-analyze')) {
            label = 'Food Nutrition Agent';
          } else if (url.includes('/food-idea')) {
            label = 'Food Idea Agent';
          } else if (url.includes('/daily-recommendation-chat')) {
            label = 'Daily Recommendation Agent';
          } else if (url.includes('/health-baseline-analyze')) {
            label = 'Health Coach';
          } else if (url.includes('/medical-analyze')) {
            label = 'Medical History Agent';
          } else if (url.includes('/food-image-search')) {
            type = 'brave';
            label = 'Brave Image Search (fallback)';
          }
          trackApiCall(type, label);
        }
      } catch (e) {
        // Not a JSON response or failed to parse
      }
    }
    return response;
  };
  try {
    Object.defineProperty(window, 'fetch', {
      value: wrappedFetch,
      configurable: true,
      writable: true
    });
  } catch (e) {
    try {
      window.fetch = wrappedFetch as any;
    } catch (e2) {
      console.warn('Could not install global fetch interceptor:', e2);
    }
  }
};
