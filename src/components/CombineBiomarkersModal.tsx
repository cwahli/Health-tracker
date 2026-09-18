import React, { useState } from 'react';
import { X, Merge } from 'lucide-react';

export interface CombineBiomarkersModalProps {
  profile?: any;
  isOpen: boolean;
  initialKey?: string;
  biomarkers?: any;
  biomarkerHistory?: any[];
  allDefinitions?: any[];
  onClose: () => void;
  onSaveCombine?: (sourceKey: string, targetKey: string) => void;
  onReviewWithAgent?: (keys: string[]) => void;
  [key: string]: any;
}

export function CombineBiomarkersModal({
  isOpen,
  initialKey = '',
  allDefinitions = [],
  onClose,
  onSaveCombine
}: CombineBiomarkersModalProps) {
  const [targetKey, setTargetKey] = useState('');

  if (!isOpen) return null;

  const handleCombine = () => {
    if (initialKey && targetKey && onSaveCombine) {
      onSaveCombine(initialKey, targetKey);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-2xl relative">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
        >
          <X className="w-5 h-5" />
        </button>

        <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2 mb-4">
          <Merge className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
          Combine Biomarkers
        </h3>

        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
          Merge historical readings from <span className="font-semibold text-slate-700 dark:text-slate-300">{initialKey}</span> into another standard marker.
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Select Target Marker
            </label>
            <select
              value={targetKey}
              onChange={(e) => setTargetKey(e.target.value)}
              className="w-full p-2.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">Choose a biomarker...</option>
              {allDefinitions.map((def: any) => (
                <option key={def.key} value={def.key}>
                  {def.name || def.key} ({def.key})
                </option>
              ))}
            </select>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!targetKey}
              onClick={handleCombine}
              className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium rounded-xl transition-all"
            >
              Combine
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CombineBiomarkersModal;
