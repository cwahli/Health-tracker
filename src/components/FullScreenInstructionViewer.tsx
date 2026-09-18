import React from 'react';
import { X } from 'lucide-react';

export interface FullScreenInstructionViewerProps {
  isOpen: boolean;
  onClose: () => void;
  agentType?: string;
  profile?: any;
  biomarkerHistory?: any[];
  agentPrompt?: string;
  outOfRangeBiomarkers?: any[];
  remainingAllowance?: any;
  activeMeal?: any;
  location?: any;
  recentMeals?: any[];
  budget?: any;
  [key: string]: any;
}

export function FullScreenInstructionViewer({
  isOpen,
  onClose,
  agentType = '',
  agentPrompt
}: FullScreenInstructionViewerProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
      <div className="w-full max-w-3xl max-h-[85vh] flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-800">
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
            Agent Instructions: {agentType}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 text-xs font-mono bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 whitespace-pre-wrap">
          {agentPrompt || 'No system instruction loaded.'}
        </div>
      </div>
    </div>
  );
}

export default FullScreenInstructionViewer;
