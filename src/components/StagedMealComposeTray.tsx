import React from 'react';
import { Utensils, X } from 'lucide-react';
import { FoodLog } from '../types';
import PreviousMealThumbnail from './PreviousMealThumbnail';
import { collectSavedMealImageUrls } from '../utils/foodImageSources';
import { parseTrayGramInput, normalizeTrayGrams } from '../utils/compositeFoodCalculation';

export interface StagedMealComposeTrayProps {
  explicitFoodTags: any[];
  activeFoodLogs: FoodLog[];
  t: any;
  setExplicitFoodTags: React.Dispatch<React.SetStateAction<any[]>>;
  setStagedQuery: React.Dispatch<React.SetStateAction<string>>;
}

export const StagedMealComposeTray: React.FC<StagedMealComposeTrayProps> = ({
  explicitFoodTags,
  activeFoodLogs,
  t,
  setExplicitFoodTags,
  setStagedQuery,
}) => {
  if (!explicitFoodTags || explicitFoodTags.length === 0) return null;

  return (
    <div className="flex items-center gap-2 overflow-x-auto py-1.5 px-2.5 bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/50 rounded-xl">
      <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider shrink-0 flex items-center gap-1">
        <Utensils className="w-3 h-3" />
        {t.stagedItems || "Staged Items"}:
      </span>
      <div className="flex items-center gap-1.5 min-w-0">
        {explicitFoodTags.map((tag, tIdx) => {
          const thumbSrc = collectSavedMealImageUrls(tag, activeFoodLogs, { allowSynthesized: false })[0];
          return (
            <div key={tag.dbId || tIdx} className="flex items-center gap-1.5 bg-white dark:bg-slate-800 border border-indigo-200 dark:border-indigo-800/60 rounded-lg px-2 py-1 shadow-sm shrink-0">
              {thumbSrc ? (
                <PreviousMealThumbnail
                  src={thumbSrc}
                  alt={tag.name}
                  fallbackLabel={tag.name}
                />
              ) : (
                <div className="w-5 h-5 rounded bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center text-[10px] font-bold text-indigo-600 dark:text-indigo-400">
                  {(tag.name || 'F').charAt(0).toUpperCase()}
                </div>
              )}
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 max-w-[120px] truncate">
                {tag.name}
              </span>
              <div className="flex items-center gap-0.5 bg-slate-100 dark:bg-slate-700/50 px-1.5 py-0.5 rounded">
                <input
                  type="number"
                  value={tag.weightGrams ?? ''}
                  onChange={(e) => {
                    const parsed = parseTrayGramInput(e.target.value);
                    setExplicitFoodTags(prev => prev.map((item, i) => i === tIdx ? { ...item, weightGrams: parsed } : item));
                  }}
                  onBlur={() => {
                    setExplicitFoodTags(prev => prev.map((item, i) => i === tIdx ? { ...item, weightGrams: normalizeTrayGrams(item.weightGrams) } : item));
                  }}
                  className="w-10 text-[10px] text-center font-mono bg-transparent text-slate-800 dark:text-white focus:outline-none"
                  min="1"
                />
                <span className="text-[9px] text-slate-500 dark:text-slate-400 font-mono">g</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setExplicitFoodTags(prev => {
                    const next = prev.filter((_, i) => i !== tIdx);
                    if (next.length === 0) setStagedQuery('');
                    return next;
                  });
                }}
                className="p-0.5 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-rose-500 rounded transition-colors"
                title="Remove item"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default StagedMealComposeTray;
