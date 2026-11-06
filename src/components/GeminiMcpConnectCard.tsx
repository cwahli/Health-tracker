import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Link2, ShieldOff } from 'lucide-react';
import { interpolate } from '../utils/i18n';
import { CANONICAL_MCP_URL, geminiMcpText } from '../utils/geminiMcpCopy';

export interface GeminiMcpPanelProps {
  language?: string;
  mcpUrl: string;
  clientId?: string;
  clientSecret?: string;
  activeSessions: number;
  notice?: string;
  busy?: boolean;
  signedIn: boolean;
  onCopy: (value: string, which: 'url' | 'id' | 'secret') => void;
  copied?: 'url' | 'id' | 'secret' | null;
  onCreate: () => void;
  onRevoke: () => void;
}

export function GeminiMcpConnectPanel({
  language,
  mcpUrl,
  clientId,
  clientSecret,
  activeSessions,
  notice,
  busy,
  signedIn,
  onCopy,
  copied,
  onCreate,
  onRevoke,
}: GeminiMcpPanelProps) {
  const text = geminiMcpText(language);
  const [armRevoke, setArmRevoke] = useState(false);

  return (
    <section id="gemini-mcp-connect" className="col-span-2 bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700/60 rounded-2xl p-3.5 mt-2 text-left">
      <div className="flex items-center gap-2 mb-1">
        <Link2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
        <h3 className="text-xs font-bold text-slate-800 dark:text-slate-100">{text.title}</h3>
      </div>
      <p className="text-[11px] text-slate-600 dark:text-slate-400 mb-2">{text.description}</p>
      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider" htmlFor="gemini-mcp-url">{text.urlLabel}</label>
      <div className="flex items-center gap-2 mt-1 mb-2">
        <input id="gemini-mcp-url" readOnly value={mcpUrl} className="flex-1 min-w-0 text-[11px] font-mono bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-slate-700 dark:text-slate-200" />
        <button type="button" id="gemini-mcp-copy-url" onClick={() => onCopy(mcpUrl, 'url')} className="text-[11px] font-semibold px-2 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-100">
          <Copy className="w-3 h-3 inline mr-1" />{copied === 'url' ? text.copied : text.copy}
        </button>
      </div>
      <p className="text-[10px] text-slate-500 mb-2">{interpolate(text.activeSessions, { count: activeSessions })}</p>
      {clientId && (
        <div className="mb-2">
          <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">{text.clientId}</span>
          <div className="flex items-center gap-2 mt-1">
            <code id="gemini-mcp-client-id" className="flex-1 min-w-0 text-[11px] font-mono break-all">{clientId}</code>
            <button type="button" id="gemini-mcp-copy-client-id" onClick={() => onCopy(clientId, 'id')} className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-slate-200 dark:bg-slate-700">{copied === 'id' ? text.copied : text.copy}</button>
          </div>
        </div>
      )}
      {clientSecret && (
        <div className="mb-2">
          <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">{text.clientSecret}</span>
          <div className="flex items-center gap-2 mt-1">
            <code id="gemini-mcp-client-secret" className="flex-1 min-w-0 text-[11px] font-mono break-all">{clientSecret}</code>
            <button type="button" id="gemini-mcp-copy-secret" onClick={() => onCopy(clientSecret, 'secret')} className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-slate-200 dark:bg-slate-700">{copied === 'secret' ? text.copied : text.copy}</button>
          </div>
          <p className="text-[10px] text-amber-700 dark:text-amber-300 mt-1">{text.secretOnce}</p>
        </div>
      )}
      {notice && <p id="gemini-mcp-notice" className="text-[11px] text-slate-600 dark:text-slate-300 mb-2">{notice}</p>}
      {!signedIn && <p className="text-[11px] text-rose-600 mb-2">{text.needSignIn}</p>}
      <div className="flex gap-2">
        <button type="button" id="gemini-mcp-create" disabled={!signedIn || busy} onClick={onCreate} className="flex-1 text-[11px] font-bold py-2 rounded-xl bg-indigo-600 text-white disabled:opacity-50">
          {busy ? text.creating : text.create}
        </button>
        <button
          type="button"
          id="gemini-mcp-revoke"
          disabled={!signedIn || busy}
          onClick={() => {
            if (!armRevoke) {
              setArmRevoke(true);
              return;
            }
            setArmRevoke(false);
            onRevoke();
          }}
          className="flex-1 text-[11px] font-bold py-2 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 disabled:opacity-50"
        >
          <ShieldOff className="w-3 h-3 inline mr-1" />{armRevoke ? text.revokeConfirm : text.revoke}
        </button>
      </div>
    </section>
  );
}

async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* fall through */
  }
  return false;
}

function authToken(): string {
  try {
    return localStorage.getItem('auth_token') || '';
  } catch {
    return '';
  }
}

export default function GeminiMcpConnectCard({ language }: { language?: string }) {
  const text = geminiMcpText(language);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [mcpUrl, setMcpUrl] = useState(CANONICAL_MCP_URL);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [activeSessions, setActiveSessions] = useState(0);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<'url' | 'id' | 'secret' | null>(null);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    const anchor = document.getElementById('profile-modal-bottom-signout-btn');
    const slotParent = anchor?.parentElement?.parentElement;
    if (!slotParent || !anchor?.parentElement) return;
    const el = document.createElement('div');
    slotParent.insertBefore(el, anchor.parentElement);
    setHost(el);
    return () => {
      el.remove();
    };
  }, []);

  useEffect(() => {
    const token = authToken();
    setSignedIn(Boolean(token));
    if (!token) return;
    let cancelled = false;
    fetch('/api/mcp/settings', { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        if (typeof data.mcp_url === 'string') setMcpUrl(data.mcp_url);
        if (typeof data.active_sessions === 'number') setActiveSessions(data.active_sessions);
        const active = Array.isArray(data.clients) ? data.clients.find((c: { revoked?: boolean; client_id?: string }) => c && !c.revoked && c.client_id) : null;
        if (active?.client_id) setClientId(active.client_id);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const call = async (path: string) => {
    const token = authToken();
    if (!token) {
      setSignedIn(false);
      setNotice(text.needSignIn);
      return null;
    }
    setBusy(true);
    setNotice('');
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: '{}',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice(text.error);
        return null;
      }
      return data;
    } catch {
      setNotice(text.error);
      return null;
    } finally {
      setBusy(false);
    }
  };

  if (!host) return null;

  return createPortal(
    <GeminiMcpConnectPanel
      language={language}
      mcpUrl={mcpUrl}
      clientId={clientId}
      clientSecret={clientSecret}
      activeSessions={activeSessions}
      notice={notice}
      busy={busy}
      signedIn={signedIn}
      copied={copied}
      onCopy={(value, which) => {
        void copyText(value).then((ok) => {
          if (ok) setCopied(which);
        });
      }}
      onCreate={() => {
        void call('/api/mcp/settings/client').then((data) => {
          if (!data?.client_id || !data?.client_secret) return;
          setClientId(data.client_id);
          setClientSecret(data.client_secret);
          if (typeof data.mcp_url === 'string') setMcpUrl(data.mcp_url);
          setNotice(text.replaced);
        });
      }}
      onRevoke={() => {
        void call('/api/mcp/settings/revoke').then((data) => {
          if (!data) return;
          setClientSecret('');
          setClientId('');
          setActiveSessions(0);
          setNotice(text.revoked);
        });
      }}
    />,
    host,
  );
}
