import React, { useState } from 'react';
import { X, Copy, Check } from 'lucide-react';

export interface FullScreenLogViewerProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  logsText?: string;
  logsArray?: string[];
  [key: string]: any;
}

export function FullScreenLogViewer({
  isOpen,
  onClose,
  title = 'Diagnostic Logs',
  logsText = '',
  logsArray = []
}: FullScreenLogViewerProps) {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const content = logsText || (logsArray.length > 0 ? logsArray.join('\n\n') : 'No logs available.');

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
      <div className="w-full max-w-4xl max-h-[85vh] flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-800">
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
            {title}
          </h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-xs font-medium rounded-lg text-slate-700 dark:text-slate-300"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied' : 'Copy Logs'}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 text-xs font-mono bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 whitespace-pre-wrap">
          {content}
        </div>
      </div>
    </div>
  );
}

export default FullScreenLogViewer;
