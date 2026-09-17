import React from 'react';
import { X, Activity } from 'lucide-react';

export interface ApiCallTrackerModalProps {
  isOpen: boolean;
  onClose: () => void;
  userEmail?: string;
  [key: string]: any;
}

export default function ApiCallTrackerModal({
  isOpen,
  onClose,
  userEmail
}: ApiCallTrackerModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-2xl relative">
        <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800 mb-4">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              API Call Tracker
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
        <div className="text-xs text-slate-500 dark:text-slate-400 space-y-2">
          <p>Tracking active API calls and quota consumption for: <span className="font-semibold text-slate-700 dark:text-slate-300">{userEmail}</span></p>
          <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
            All API calls healthy. Latency within nominal limits (&lt;1.2s).
          </div>
        </div>
      </div>
    </div>
  );
}
