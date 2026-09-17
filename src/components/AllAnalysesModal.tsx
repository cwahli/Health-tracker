import React from 'react';
import { X, FileText } from 'lucide-react';

export interface AllAnalysesModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile?: any;
  [key: string]: any;
}

export function AllAnalysesModal({
  isOpen,
  onClose,
  profile
}: AllAnalysesModalProps) {
  if (!isOpen) return null;

  const analyses = profile?.agentAnalyses || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl max-h-[80vh] flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-2xl relative">
        <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800 mb-4">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Agent Analyses History
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
        <div className="flex-1 overflow-y-auto space-y-3 text-xs">
          {analyses.length === 0 ? (
            <p className="text-slate-500 py-6 text-center">No saved agent analyses yet.</p>
          ) : (
            analyses.map((a: any, idx: number) => (
              <div key={idx} className="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
                <div className="font-semibold text-slate-900 dark:text-slate-100">{a.title || `Analysis #${idx + 1}`}</div>
                <div className="text-slate-500 text-[11px]">{a.date || ''}</div>
                {a.summary && <p className="mt-1 text-slate-600 dark:text-slate-300">{a.summary}</p>}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default AllAnalysesModal;
