import React from 'react';
import { translations } from '../utils/translations';

export interface BiomarkerExpandedSectionProps {
  def: any;
  profile: any;
  language?: string;
  biomarkerHistory?: any[];
  biomarkers?: any;
  onOpenAiReview?: (key: string) => void;
  onCombineBiomarker?: () => void;
  onEditBiomarkerLog?: (id: string, key: string, value: string | number, newDate?: string) => void;
  onDeleteBiomarkerLog?: (id: string) => void;
  onDeleteBiomarkerFromLog?: (id: string, key: string) => void;
  onDeleteBiomarker?: (key: string) => void;
  onApplyCalculation?: (updates: any) => void;
  hasPendingAlert?: boolean;
  onDismissAlert?: () => void;
  hideSensitive?: boolean;
  onEditBiomarkerDef?: (key: string, range: any, unit: string) => void;
  onFlagNotUsedLocal?: (key: string, isNotUsed: boolean) => void;
}

export function BiomarkerExpandedSection({
  def,
  profile,
  language = 'en',
  biomarkerHistory = [],
  biomarkers = {},
  onOpenAiReview,
  hideSensitive
}: BiomarkerExpandedSectionProps) {
  const t = translations[language] || translations.en;
  const val = biomarkers[def?.key];

  return (
    <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 mt-2 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {def?.category || 'Biomarker'}
          </span>
          <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {def?.name || def?.key}
          </h4>
        </div>
        {onOpenAiReview && def?.key && (
          <button
            type="button"
            onClick={() => onOpenAiReview(def.key)}
            className="text-xs px-2.5 py-1 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 rounded-lg hover:bg-indigo-100 font-medium transition-colors cursor-pointer"
          >
            AI Review
          </button>
        )}
      </div>

      <div className="text-xs text-slate-600 dark:text-slate-300">
        <span className="font-medium">Current Value: </span>
        {hideSensitive ? '••••' : (val != null ? `${val} ${def?.unit || ''}` : 'No data recorded')}
      </div>

      {def?.description && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {def.description}
        </p>
      )}
    </div>
  );
}

export default BiomarkerExpandedSection;
