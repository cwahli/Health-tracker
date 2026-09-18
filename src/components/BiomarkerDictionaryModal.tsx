import React, { useState } from 'react';
import { X, Search } from 'lucide-react';
import { biomarkerDefinitions } from '../utils/biomarkers';

export interface BiomarkerDictionaryModalProps {
  profile?: any;
  biomarkers?: any;
  biomarkerHistory?: any[];
  onClose: () => void;
  onReviewWithAgent?: (keys: string[]) => void;
  initialSearchQuery?: string;
  [key: string]: any;
}

export function BiomarkerDictionaryModal({
  onClose,
  initialSearchQuery = '',
  onReviewWithAgent
}: BiomarkerDictionaryModalProps) {
  const [query, setQuery] = useState(initialSearchQuery);

  const defs = Object.entries(biomarkerDefinitions || {}).filter(([key, def]: [string, any]) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return key.toLowerCase().includes(q) || (def?.name && def.name.toLowerCase().includes(q));
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl max-h-[85vh] flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-800">
          <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
            Biomarker Dictionary
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 border-b border-slate-200 dark:border-slate-800">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search biomarkers by name or code..."
              className="w-full pl-9 pr-4 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {defs.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              No biomarkers match your search.
            </div>
          ) : (
            defs.map(([key, def]: [string, any]) => (
              <div
                key={key}
                className="p-3 bg-slate-50 dark:bg-slate-850 rounded-xl border border-slate-200 dark:border-slate-750 flex items-center justify-between"
              >
                <div>
                  <div className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                    {def?.name || key}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {def?.category || 'General'} • Normal range: {def?.normalRange || def?.unit || '-'}
                  </div>
                </div>
                {onReviewWithAgent && (
                  <button
                    type="button"
                    onClick={() => onReviewWithAgent([key])}
                    className="text-xs px-2.5 py-1 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 rounded-lg hover:bg-indigo-100 font-medium"
                  >
                    Review
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default BiomarkerDictionaryModal;
