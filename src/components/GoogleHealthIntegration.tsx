import React, { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';

export default function GoogleHealthIntegration() {
  const [googleSteps, setGoogleSteps] = useState<number | null>(null);
  const [healthApiStatus, setHealthApiStatus] = useState<string>('');

  useEffect(() => {
    const saved = localStorage.getItem('googleSteps');
    if (saved) setGoogleSteps(parseInt(saved, 10));
    
    const handleUpdate = () => {
      const updated = localStorage.getItem('googleSteps');
      if (updated) setGoogleSteps(parseInt(updated, 10));
      else setGoogleSteps(null);
    };
    window.addEventListener('googleStepsUpdated', handleUpdate);

    // Auto-fetch steps if token exists
    const token = localStorage.getItem('ghealth_access_token');
    if (token) {
       fetchSteps(token);
    }

    return () => window.removeEventListener('googleStepsUpdated', handleUpdate);
  }, []);

  const fetchSteps = async (accessToken?: string, isRetry = false) => {
    try {
      if (!isRetry) setHealthApiStatus("Syncing steps...");
      const token = accessToken || localStorage.getItem('ghealth_access_token');
      if (!token) throw new Error("No access token found.");

      const localNow = new Date();
      const localStartOfToday = new Date(localNow.getFullYear(), localNow.getMonth(), localNow.getDate(), 0, 0, 0, 0).getTime();
      const localEndOfToday = localNow.getTime();

      const res = await fetch('/api/health-connect/steps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          access_token: token, 
          startTimeMillis: localStartOfToday,
          endTimeMillis: localEndOfToday
        })
      });
      
      const stepsData = await res.json();
      
      if (!res.ok) {
        if (res.status === 401 || (stepsData.error && String(stepsData.error).includes('invalid_token'))) {
          if (!isRetry) {
            const refreshToken = localStorage.getItem('ghealth_refresh_token');
            if (refreshToken) {
              setHealthApiStatus("Refreshing token...");
              const refreshRes = await fetch('/api/health-connect/refresh', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refresh_token: refreshToken })
              });
              const refreshData = await refreshRes.json();
              if (refreshRes.ok && refreshData.access_token) {
                localStorage.setItem('ghealth_access_token', refreshData.access_token);
                if (refreshData.refresh_token) {
                  localStorage.setItem('ghealth_refresh_token', refreshData.refresh_token);
                }
                return fetchSteps(refreshData.access_token, true);
              }
            }
          }
          // If retry failed or no refresh token, log out
          localStorage.removeItem('ghealth_access_token');
          throw new Error("Session expired. Please reconnect.");
        }
        throw new Error(stepsData.error || "Failed to fetch steps from Google Fit");
      }

      if (stepsData.steps !== undefined) {
        setGoogleSteps(stepsData.steps);
        localStorage.setItem('googleSteps', String(stepsData.steps));
        window.dispatchEvent(new Event('googleStepsUpdated'));
        if (stepsData.sevenDayAverage !== undefined) {
          localStorage.setItem('googleStepsAverage', String(stepsData.sevenDayAverage));
        }
        if (stepsData.lastActiveDaySteps !== undefined) {
          localStorage.setItem('lastActiveDaySteps', String(stepsData.lastActiveDaySteps));
        }
        if (stepsData.lastActiveDayTimestamp !== undefined) {
          localStorage.setItem('lastActiveDayTimestamp', stepsData.lastActiveDayTimestamp);
        }
        if (stepsData.history) {
          localStorage.setItem('googleStepsHistory', JSON.stringify(stepsData.history));
        }
        setHealthApiStatus("Successfully connected and synced steps!");
      }
    } catch (e: any) {
      setHealthApiStatus(`Sync error: ${e.message || e}`);
    }
  };

  const connectGoogleHealth = async () => {
    let pollTimer: any = null;
    let messageListener: any = null;

    const cleanup = () => {
      if (pollTimer) clearInterval(pollTimer);
      if (messageListener) window.removeEventListener('message', messageListener);
    };

    const fetchStepsWithToken = async (tokens: any) => {
      localStorage.setItem('ghealth_access_token', tokens.access_token);
      if (tokens.refresh_token) {
        localStorage.setItem('ghealth_refresh_token', tokens.refresh_token);
      }
      await fetchSteps(tokens.access_token);
      cleanup();
    };

    try {
      localStorage.removeItem('ghealth_auth_status');
      localStorage.removeItem('ghealth_tokens');

      setHealthApiStatus("Initiating OAuth consent flow...");
      const res = await fetch('/api/health-connect/url');
      const data = await res.json();
      
      const authWindow = window.open(data.url, 'google_health', 'width=600,height=700');
      
      messageListener = async (event: MessageEvent) => {
        if (event.data?.type === 'GHEALTH_AUTH_SUCCESS') {
          const tokens = event.data.tokens;
          if (tokens && tokens.access_token) {
            await fetchStepsWithToken(tokens);
          } else {
            setHealthApiStatus("Failed: No access token found in redirect payload.");
          }
        }
      };
      
      window.addEventListener('message', messageListener);

      pollTimer = setInterval(async () => {
        const status = localStorage.getItem('ghealth_auth_status');
        if (status === 'SUCCESS') {
          localStorage.removeItem('ghealth_auth_status');
          const tokensStr = localStorage.getItem('ghealth_tokens');
          localStorage.removeItem('ghealth_tokens');
          if (tokensStr) {
            try {
              const tokens = JSON.parse(tokensStr);
              if (tokens && tokens.access_token) {
                await fetchStepsWithToken(tokens);
              }
            } catch (e) {
              console.error("Failed to parse polled tokens:", e);
            }
          }
        }
        if (authWindow && authWindow.closed) {
          setTimeout(() => cleanup(), 1000);
        }
      }, 1000);
    } catch (e: any) {
      setHealthApiStatus(`Failed to initiate connection: ${e.message}`);
    }
  };

  return (
    <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Google Health</h3>
          <p className="text-xs text-slate-500">
            {googleSteps !== null 
              ? `Connected and syncing daily steps` 
              : 'Connect to track your daily steps'}
          </p>
        </div>
        {googleSteps === null ? (
          <button
            onClick={connectGoogleHealth}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
          >
            Connect
          </button>
        ) : (
          <div className="flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-950/20 px-3 py-1.5 rounded-xl border border-emerald-500/20">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">Connected</span>
          </div>
        )}
      </div>

      {googleSteps !== null && (
        <div className="space-y-3 mt-4">
          <div className="flex items-center justify-between bg-emerald-50/40 dark:bg-emerald-950/10 border border-emerald-500/10 p-3 rounded-xl">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Today's Steps:</span>
            <div className="flex items-center gap-2">
              <span className="text-base font-black text-emerald-600 dark:text-emerald-400 font-sans">{googleSteps}</span>
              <button
                onClick={() => fetchSteps()}
                className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-all cursor-pointer text-slate-400 hover:text-indigo-600"
                title="Refresh Steps"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          
          <div className="flex gap-2">
            <button
              onClick={() => {
                setGoogleSteps(null);
                localStorage.removeItem('googleSteps');
                localStorage.removeItem('ghealth_access_token');
                setHealthApiStatus("");
                window.dispatchEvent(new Event('googleStepsUpdated'));
              }}
              className="w-full py-2 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/10 dark:hover:bg-rose-950/20 text-rose-600 dark:text-rose-400 rounded-xl text-xs font-bold transition-all cursor-pointer border border-rose-100 dark:border-rose-900/30"
            >
              Disconnect
            </button>
          </div>
        </div>
      )}

      {healthApiStatus && !healthApiStatus.includes("Successfully connected") && (
        <div className="text-[11px] font-mono leading-relaxed bg-slate-50 dark:bg-slate-950/40 p-3 rounded-xl border border-slate-200/60 dark:border-slate-800/60 text-slate-500 mt-2">
          {healthApiStatus}
        </div>
      )}
    </div>
  );
}
