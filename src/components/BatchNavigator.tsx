import React from 'react';
import { t, interpolate } from '../utils/i18n';

interface BatchNavigatorProps {
  currentIndex: number;              // 0-based index into the batch list
  totalBatches: number;              // known, fixed count for this use case
  itemsInCurrentBatch: number;       // for the "X-Y of Z" label
  totalItems: number;                // sum across all batches, for the label
  startItemNumber: number;           // 1-based start of current batch's range
  endItemNumber: number;             // 1-based end of current batch's range
  isCurrentApproved: boolean;
  canGoNext: boolean;
  canGoPrev: boolean;
  isLastBatch: boolean;
  batchSizeValue?: string;
  onChangeBatchSize?: (val: string) => void;
  onPrev: () => void;
  onNext: () => void;
  onApproveCurrent: () => void;
  onApproveAll?: () => void;         // only rendered when isLastBatch is true
  approveCurrentLabel?: string;      // default t(batchApprove)
  approveAllLabel?: string;          // default t(batchApproveAll)
  language?: unknown;
  children: React.ReactNode;         // the step-specific content for the current batch
}

export const BatchNavigator: React.FC<BatchNavigatorProps> = ({
  currentIndex, totalBatches, itemsInCurrentBatch, totalItems,
  startItemNumber, endItemNumber, isCurrentApproved,
  canGoNext, canGoPrev, isLastBatch,
  batchSizeValue, onChangeBatchSize,
  onPrev, onNext, onApproveCurrent, onApproveAll,
  approveCurrentLabel, approveAllLabel, language,
  children
}) => {
  const approveCurrentText = approveCurrentLabel ?? t(language, 'batchApprove');
  const approveAllText = approveAllLabel ?? t(language, 'batchApproveAll');
  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-theme-border/60 pb-3">
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            {interpolate(t(language, 'batchOf'), { i: currentIndex + 1, total: totalBatches })}
          </span>
          <span className="text-[10px] text-slate-500">
            {interpolate(t(language, 'batchRange'), { start: startItemNumber, end: endItemNumber, total: totalItems })}
          </span>
        </div>
        {onChangeBatchSize && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-medium text-slate-500">{t(language, 'batchPerPage')}</span>
            <input
              type="number"
              min="1"
              max="100"
              value={batchSizeValue}
              onChange={(e) => onChangeBatchSize(e.target.value)}
              className="w-16 text-[10px] font-bold bg-slate-50 dark:bg-slate-900 border border-slate-250 dark:border-slate-800 rounded-lg px-2 py-1 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        )}
      </div>

      <div>{children}</div>

      <div className="flex items-center justify-between gap-2 pt-3 border-t border-theme-border/60">
        <button
          onClick={onPrev}
          disabled={!canGoPrev}
          className="px-3 py-1.5 text-[11px] font-bold rounded-lg border border-theme-border disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          {t(language, 'batchPrev')}
        </button>

        <div className="flex items-center gap-2">
          <button
            onClick={onApproveCurrent}
            disabled={isCurrentApproved}
            className="px-3 py-1.5 text-[11px] font-bold rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 disabled:opacity-50 hover:bg-emerald-200 dark:hover:bg-emerald-900/50 transition-colors"
          >
            {isCurrentApproved ? t(language, 'batchApproved') : approveCurrentText}
          </button>
          {isLastBatch && onApproveAll && (
            <button
              onClick={onApproveAll}
              className="px-3 py-1.5 text-[11px] font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
            >
              {approveAllText}
            </button>
          )}
        </div>

        <button
          onClick={onNext}
          disabled={!canGoNext}
          className="px-3 py-1.5 text-[11px] font-bold rounded-lg border border-theme-border disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          {t(language, 'batchNext')}
        </button>
      </div>
    </div>
  );
};
