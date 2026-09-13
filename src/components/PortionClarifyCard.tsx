import React, { useState } from 'react';
import { translations } from '../utils/translations';

export type PortionOption = { id: string; label: string; weightGrams: number };
export type PortionClarifyItem = {
  scoutIndex: number;
  name: string;
  estimatedWeightGrams: number;
  labelServingGrams: number | null;
  options: PortionOption[];
  reason?: string;
};
export type PortionClarifyPayload = {
  promptMessage: string;
  items: PortionClarifyItem[];
};

type Props = {
  portionClarify: PortionClarifyPayload;
  onConfirm: (choices: Record<string, number>) => void;
  disabled?: boolean;
  language?: string;
};

/**
 * B1 — Ask how much of a multi-serve pack the user ate before diet runs.
 */
export function PortionClarifyCard({ portionClarify, onConfirm, disabled, language = 'en' }: Props) {
  const t = translations[language || 'en'] || translations.en;
  const items = portionClarify?.items || [];
  const [selected, setSelected] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    items.forEach((it) => {
      const key = String(it.scoutIndex);
      const packDefault = (it as any).packGrams;
      const match =
        (Number.isFinite(packDefault) && it.options.find((o) => o.weightGrams === packDefault)) ||
        it.options.find((o) => o.weightGrams === it.estimatedWeightGrams) || it.options[0];
      if (match) init[key] = match.weightGrams;
    });
    return init;
  });
  // Tracks which specific OPTION (by id) is selected per item, not just its weight.
  // Two distinct options can legitimately share the same weightGrams value (e.g. a
  // "Whole pack of N" total colliding with a "1 unit" weight), so comparing by weight
  // alone highlighted both buttons at once. Comparing by id keeps exactly one active.
  const [selectedOptionId, setSelectedOptionId] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    items.forEach((it) => {
      const key = String(it.scoutIndex);
      const packDefault = (it as any).packGrams;
      const match =
        (Number.isFinite(packDefault) && it.options.find((o) => o.weightGrams === packDefault)) ||
        it.options.find((o) => o.weightGrams === it.estimatedWeightGrams) || it.options[0];
      if (match) init[key] = match.id;
    });
    return init;
  });
  const [customOpen, setCustomOpen] = useState<Record<string, boolean>>({});
  const [customVal, setCustomVal] = useState<Record<string, string>>({});

  if (!items.length) return null;

  const packDefaultOf = (it: any) =>
    Number.isFinite(it?.packGrams) && it.packGrams > 0 ? it.packGrams : it.estimatedWeightGrams;
  const isAnyOverThreshold = items.some((it) => {
    const key = String(it.scoutIndex);
    const chosen = selected[key] || packDefaultOf(it);
    const base = packDefaultOf(it) || 100;
    return Math.abs(chosen - base) / base > 0.30;
  });

  return (
    <div className="mt-3 rounded-2xl border border-indigo-200 dark:border-indigo-800/60 bg-indigo-50/60 dark:bg-indigo-950/30 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
          {portionClarify.promptMessage}
        </p>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300">
          Serving size check
        </span>
      </div>
      {items.map((it) => {
        const key = String(it.scoutIndex);
        const chosen = selected[key] || packDefaultOf(it);
        const base = packDefaultOf(it) || 100;
        const diffRatio = Math.abs(chosen - base) / base;
        const diffPct = Math.round(diffRatio * 100);
        const isItemOver = diffRatio > 0.30;

        return (
          <div key={key} className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold text-indigo-700 dark:text-indigo-300 uppercase tracking-wide">
                {it.name}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Estimated: <span className="font-semibold text-slate-700 dark:text-slate-200">{it.estimatedWeightGrams}g</span>
              </div>
            </div>
            {it.reason && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400">{it.reason}</p>
            )}
            <div className="flex flex-wrap gap-2">
              {it.options.map((opt) => {
                const active = selectedOptionId[key] === opt.id && !customOpen[key];
                return (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      setCustomOpen((p) => ({ ...p, [key]: false }));
                      setSelected((p) => ({ ...p, [key]: opt.weightGrams }));
                      setSelectedOptionId((p) => ({ ...p, [key]: opt.id }));
                    }}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                      active
                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                        : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-indigo-400'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
              <button
                type="button"
                disabled={disabled}
                onClick={() => setCustomOpen((p) => ({ ...p, [key]: true }))}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer whitespace-nowrap ${
                  customOpen[key]
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                    : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-indigo-400'
                }`}
              >
                {t.customGrams || 'Custom (g)'}
              </button>
            </div>
            {customOpen[key] && (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={2000}
                  placeholder={t.gramsPlaceholder || 'grams'}
                  value={customVal[key] || ''}
                  onChange={(e) => {
                    setCustomVal((p) => ({ ...p, [key]: e.target.value }));
                    const n = parseFloat(e.target.value);
                    if (n > 0) setSelected((p) => ({ ...p, [key]: Math.round(n) }));
                  }}
                  className="w-28 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">g</span>
              </div>
            )}
            <div className="text-[11px] pt-0.5">
              {diffPct === 0 ? (
                <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                  ✓ Matches estimated portion ({it.estimatedWeightGrams}g)
                </span>
              ) : !isItemOver ? (
                <span className="text-blue-600 dark:text-blue-400 font-medium">
                  ⚡ {chosen > base ? `+${diffPct}%` : `-${diffPct}%`} difference (≤ 30%): instant local recalculation without extra agent call
                </span>
              ) : (
                <span className="text-amber-600 dark:text-amber-400 font-medium">
                  🤖 {chosen > base ? `+${diffPct}%` : `-${diffPct}%`} difference (&gt; 30%): triggers an agent review to re-evaluate verdict and advice
                </span>
              )}
            </div>
          </div>
        );
      })}
      <button
        type="button"
        disabled={
          disabled ||
          items.some((it) => !(selected[String(it.scoutIndex)] > 0))
        }
        onClick={() => onConfirm(selected)}
        className="w-full sm:w-auto px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-bold cursor-pointer shadow-md transition-colors"
      >
        {isAnyOverThreshold
          ? (t.continueWithAgentReview || 'Confirm portions (Agent Review)')
          : (t.continueWithInstantPortions || 'Confirm portions (Instant Update)')}
      </button>
    </div>
  );
}

export default PortionClarifyCard;

