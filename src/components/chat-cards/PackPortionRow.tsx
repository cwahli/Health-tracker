import React, { useState, useEffect } from 'react';
import { translations } from '../../utils/translations';

interface PackPortionRowProps {
  foodName: string;
  packGrams: number;
  currentWeight: number;
  dishWeight?: number;
  onScaleWeight?: (newWeight: number) => void;
  onConfirmPortion?: () => void;
  portionAccepted?: boolean;
  darkTheme?: boolean;
  language?: string;
}

export const PackPortionRow: React.FC<PackPortionRowProps> = ({
  foodName,
  packGrams,
  currentWeight,
  dishWeight,
  onScaleWeight,
  onConfirmPortion,
  portionAccepted = false,
  darkTheme = false,
  language = 'en',
}) => {
  const t = translations[language || 'en'] || translations.en;
  const [isAccepted, setIsAccepted] = useState(portionAccepted);
  const [isDismissed, setIsDismissed] = useState(false);
  const [isCustomOpen, setIsCustomOpen] = useState(false);
  const [customInputGrams, setCustomInputGrams] = useState(String(currentWeight));

  useEffect(() => {
    setCustomInputGrams(String(currentWeight));
    if (portionAccepted) {
      setIsAccepted(true);
    }
  }, [currentWeight, packGrams, portionAccepted]);

  // Hide the dropdown if packGrams and currentWeight are identical
  if (isDismissed || !packGrams || packGrams <= 0 || packGrams === currentWeight) {
    return null;
  }

  const handleAccept = () => {
    setIsAccepted(true);
    if (onConfirmPortion) {
      onConfirmPortion();
    }
    setTimeout(() => {
      setIsDismissed(true);
    }, 5000);
  };

  const handleApplyCustom = () => {
    const g = parseFloat(customInputGrams);
    if (!isNaN(g) && g > 0) {
      if (onScaleWeight) onScaleWeight(g);
    }
    setIsCustomOpen(false);
  };

  // Build portion choices (deduplicated and sorted by weight)
  const rawOpts = [currentWeight, packGrams];
  if (dishWeight && dishWeight > 0) {
    rawOpts.push(dishWeight);
  }
  const uniqueWeights = Array.from(new Set(rawOpts.filter(w => typeof w === 'number' && w > 0))).sort((a, b) => a - b);
  const options = uniqueWeights.map(w => ({ label: `${w}g`, value: w }));

  // If there's only one option (packGrams === currentWeight and no different dishWeight)
  // then the dropdown is unnecessary, hide the row entirely to reduce noise.
  if (options.length <= 1) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 p-2 mb-2.5 rounded-lg bg-indigo-50/80 dark:bg-indigo-950/40 border border-indigo-200/80 dark:border-indigo-800/60 text-slate-700 dark:text-slate-200 text-xs font-sans">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="font-semibold text-slate-800 dark:text-slate-100">{foodName}</span>
        <span className="px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 font-bold text-[10px] border border-indigo-200 dark:border-indigo-800">
          [{packGrams}g]
        </span>
        <span className="text-slate-500 dark:text-slate-400 font-normal">{t.thenPortion || 'then portion'}</span>

        {isCustomOpen ? (
          <div className="inline-flex items-center gap-1">
            <input
              type="number"
              min="1"
              step="1"
              autoFocus
              value={customInputGrams}
              onChange={(e) => setCustomInputGrams(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleApplyCustom();
                } else if (e.key === 'Escape') {
                  setIsCustomOpen(false);
                }
              }}
              className="w-16 px-1.5 py-0.5 text-[11px] font-mono font-bold rounded border border-indigo-500 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
            <span className="text-[10px] text-slate-500">g</span>
            <button
              type="button"
              onClick={handleApplyCustom}
              className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer"
            >
              ✓
            </button>
            <button
              type="button"
              onClick={() => setIsCustomOpen(false)}
              className="px-1 py-0.5 rounded text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
            >
              ✕
            </button>
          </div>
        ) : (
          <select
            value={String(currentWeight)}
            onChange={(e) => {
              const val = e.target.value;
              if (val === 'custom') {
                setIsCustomOpen(true);
              } else {
                const g = parseFloat(val);
                if (!isNaN(g) && g > 0 && onScaleWeight) {
                  onScaleWeight(g);
                }
              }
            }}
            className="px-2 py-0.5 rounded-md text-[11px] font-bold border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
          >
            {options.map((opt, oIdx) => (
              <option key={oIdx} value={opt.value}>
                {opt.label}
              </option>
            ))}
            <option value="custom">{t.customEllipsis || 'Custom...'}</option>
          </select>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        {isAccepted ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-700/60 px-2 py-0.5 rounded-md transition-all">
            ✓ {t.acceptedBadge || 'Accepted'}
          </span>
        ) : (
          <button
            type="button"
            onClick={handleAccept}
            className="px-2.5 py-1 rounded-md text-[10px] font-bold bg-emerald-700 hover:bg-emerald-800 text-white shadow-sm transition-all cursor-pointer"
          >
            {t.acceptPortion || 'Accept'}
          </button>
        )}
      </div>
    </div>
  );
};
