import React from 'react';
import { ChevronLeft, ChevronRight, Check } from 'lucide-react';

export interface BatchNavigatorProps {
  language?: string;
  currentIndex: number;
  totalBatches: number;
  itemsInCurrentBatch: number;
  totalItems: number;
  startItemNumber: number;
  endItemNumber: number;
  isCurrentApproved?: boolean;
  canGoPrev?: boolean;
  canGoNext?: boolean;
  isLastBatch?: boolean;
  onPrev?: () => void;
  onNext?: () => void;
  onApproveCurrent?: () => Promise<void> | void;
  children?: React.ReactNode;
}

export function BatchNavigator({
  language = 'en',
  currentIndex,
  totalBatches,
  itemsInCurrentBatch,
  totalItems,
  startItemNumber,
  endItemNumber,
  isCurrentApproved,
  canGoPrev,
  canGoNext,
  isLastBatch,
  onPrev,
  onNext,
  onApproveCurrent,
  children
}: BatchNavigatorProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2">
        <div className="text-xs text-slate-500 dark:text-slate-400">
          Batch <span className="font-semibold text-slate-800 dark:text-slate-200">{currentIndex + 1}</span> of {totalBatches}
          <span className="ml-2 text-[11px] text-slate-400">
            (Items {startItemNumber}–{endItemNumber} of {totalItems})
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!canGoPrev}
            onClick={onPrev}
            className="p-1 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-30 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            disabled={!canGoNext}
            onClick={onNext}
            className="p-1 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-30 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {children}

      {onApproveCurrent && !isCurrentApproved && (
        <div className="pt-2 flex justify-end">
          <button
            type="button"
            onClick={onApproveCurrent}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl transition-all"
          >
            <Check className="w-3.5 h-3.5" />
            Approve Batch
          </button>
        </div>
      )}
    </div>
  );
}

export default BatchNavigator;
