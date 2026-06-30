import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Copy, Send, Check, AlertTriangle } from 'lucide-react';

interface FullScreenLogViewerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  logsText: string;
  onSendToAdmin?: () => Promise<void>;
  isSendingLogs?: boolean;
  logsSendStatus?: 'idle' | 'success' | 'error';
  onClearLogs?: () => void;
  eventsCount?: number;
}

export default function FullScreenLogViewer({
  isOpen,
  onClose,
  title,
  logsText,
  onSendToAdmin,
  isSendingLogs = false,
  logsSendStatus = 'idle',
  onClearLogs,
  eventsCount
}: FullScreenLogViewerProps) {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(logsText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy logs:', err);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-slate-950 flex flex-col animate-fade-in w-full h-full text-slate-200">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-800/60 flex items-center justify-between bg-slate-950">
        <div className="flex items-center gap-2.5">
          <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></span>
          <h2 className="text-xs font-bold text-slate-100 uppercase tracking-wider font-mono">
            {title}
          </h2>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-xl hover:bg-slate-800/80 text-slate-400 hover:text-slate-100 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Content Area - Truly fullscreen with 5px margins on the left/right */}
      <div className="flex-1 overflow-auto mx-[5px] py-4 font-mono text-xs text-slate-300 leading-relaxed select-all whitespace-pre-wrap bg-transparent">
        {logsText || <span className="text-slate-500 italic">No logs recorded yet.</span>}
      </div>

      {/* Footer Actions */}
      <div className="px-4 py-3 border-t border-slate-800/60 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-slate-950">
        <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider font-mono">
          {eventsCount !== undefined ? (
            <span>{eventsCount} events logged</span>
          ) : (
            <span>{logsText ? `${logsText.length} characters` : 'Empty log'}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onClearLogs && (
            <button
              onClick={onClearLogs}
              className="px-3 py-1.5 bg-rose-950/40 hover:bg-rose-900/40 border border-rose-950/25 text-rose-300 hover:text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
            >
              Clear Log
            </button>
          )}

          <button
            onClick={handleCopy}
            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-850 text-slate-200 hover:text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
          >
            {copied ? (
              <>
                <Check className="w-4 h-4 text-emerald-400" />
                <span>Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                <span>Copy Logs</span>
              </>
            )}
          </button>

          {onSendToAdmin && (
            <button
              onClick={onSendToAdmin}
              disabled={isSendingLogs || !logsText}
              className={`px-3 py-1.5 border rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                logsSendStatus === 'success'
                  ? 'bg-emerald-600 border-emerald-500 text-white'
                  : logsSendStatus === 'error'
                  ? 'bg-rose-650 border-rose-550 text-white'
                  : 'bg-indigo-600 border-indigo-500 text-white hover:bg-indigo-700'
              }`}
            >
              {isSendingLogs ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                  <span>Sending...</span>
                </>
              ) : logsSendStatus === 'success' ? (
                <>
                  <Check className="w-4 h-4" />
                  <span>Sent!</span>
                </>
              ) : logsSendStatus === 'error' ? (
                <>
                  <AlertTriangle className="w-4 h-4" />
                  <span>Failed!</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>Send to Admin</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  , document.body);
}
