import React from 'react';
import { X, Sparkles } from 'lucide-react';

export interface DedupeBiomarkerLogsModalProps {
  isOpen: boolean;
  onClose: () => void;
  [key: string]: any;
}

export default function DedupeBiomarkerLogsModal({
  isOpen,
  onClose
}: DedupeBiomarkerLogsModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-2xl relative">
        <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800 mb-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Deduplicate Biomarker Logs
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
          Scan and merge identical or overlapping biomarker entries across your history timeline.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
