import React from 'react';
import { X, Bug } from 'lucide-react';

export interface BugTrackerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onViewJob?: (jobId: string) => void;
  [key: string]: any;
}

export default function BugTrackerModal({
  isOpen,
  onClose
}: BugTrackerModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-2xl relative">
        <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800 mb-4">
          <div className="flex items-center gap-2">
            <Bug className="w-5 h-5 text-rose-500" />
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Bug Queue & Issue Tracker
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
        <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-xl text-xs text-slate-600 dark:text-slate-300">
          No pending unresolved high-priority bugs reported.
        </div>
      </div>
    </div>
  );
}
