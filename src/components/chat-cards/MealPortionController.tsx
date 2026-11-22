import React from 'react';
import { PortionDropdown } from './PortionDropdown';
import { translations } from '../../utils/translations';

interface MealPortionControllerProps {
  displayedScoutItems: any[];
  portionScale: number;
  portionAccepted: boolean;
  onScalePortion: (ratio: number) => void;
  onScaleSingleDish: (dishIdx: number, ratio: number) => void;
  onAcceptPortion: () => void;
  isSaved?: boolean;
  language?: string;
}

export function MealPortionController({
  displayedScoutItems,
  portionScale,
  portionAccepted,
  onScalePortion,
  onScaleSingleDish,
  onAcceptPortion,
  isSaved = false,
  language = 'en',
}: MealPortionControllerProps) {
  const t = translations[language || 'en'] || translations.en;
  // Helper to compute unscaled base weight (1.0 ratio weight) for each item
  const getItemBaseWeight = (item: any): number => {
    const currentW = Number(item.weightGrams) || Number(item.estimatedWeightGrams) || 0;
    const ratio = Number(item.portionRatio) || 1.0;
    return ratio > 0 ? Math.round(currentW / ratio) : currentW;
  };

  const baseMealWeightGrams = displayedScoutItems.reduce(
    (acc: number, item: any) => acc + getItemBaseWeight(item),
    0
  ) || (displayedScoutItems[0]?.totalMealWeightGrams || 0);

  const currentAppliedWeight = displayedScoutItems.reduce(
    (acc: number, item: any) => acc + (Number(item.weightGrams) || getItemBaseWeight(item)),
    0
  );

  const hasMultipleDishes = displayedScoutItems.length > 1;

  return (
    <div className="mt-3 p-3 rounded-xl bg-slate-900/95 border border-slate-700/80 shadow-lg text-left font-sans backdrop-blur-md">
      {/* Overall Meal Portion Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="flex items-start gap-2.5">
          <span className="text-base mt-0.5">⚖️</span>
          <div>
            <div className="text-xs font-bold text-slate-100 flex items-center gap-1.5 flex-wrap">
              <span>{t.totalMealPortion || 'Total Meal Portion:'}</span>
              <span className="text-indigo-400 font-extrabold bg-indigo-950/80 border border-indigo-700/60 px-2 py-0.5 rounded text-[11px]">
                {currentAppliedWeight > 0
                  ? `${currentAppliedWeight}g${hasMultipleDishes ? (t.acrossNDishes ? t.acrossNDishes.replace('{count}', String(displayedScoutItems.length)) : ` across ${displayedScoutItems.length} dishes`) : ''}`
                  : '0g'}
              </span>
              {portionAccepted && (
                <span className="text-[10px] text-emerald-400 font-semibold bg-emerald-950/60 border border-emerald-800/60 px-1.5 py-0.5 rounded">
                  ✓ {t.acceptedBadge || 'Accepted'}
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-300 mt-0.5 leading-tight">
              {hasMultipleDishes
                ? (t.scaleAllDishesTogether ? t.scaleAllDishesTogether.replace('{count}', String(displayedScoutItems.length)) : `Scale all ${displayedScoutItems.length} dishes together, or adjust each dish individually below:`)
                : (t.visualPortionEstimation || 'Visual portion estimation applied. Adjust quantity or accept:')}
            </p>
          </div>
        </div>

        {/* Dropdown & Accept controls for Total Meal */}
        <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
          <PortionDropdown
            baseWeight={baseMealWeightGrams}
            currentWeight={currentAppliedWeight}
            onScale={onScalePortion}
            darkTheme={true}
            language={language}
          />

          {!portionAccepted && (
            <button
              type="button"
              onClick={onAcceptPortion}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-700 hover:bg-emerald-800 text-white shadow-md transition-all cursor-pointer flex items-center justify-center"
            >
              ✓ {t.acceptPortion || 'Accept'}
            </button>
          )}
        </div>
      </div>

      {/* Per-Dish Portion Selectors (Visible directly on card whenever multiple dishes exist) */}
      {hasMultipleDishes && (
        <div className="mt-3 pt-2.5 border-t border-slate-700/70 flex flex-col gap-2">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-bold text-slate-200">🍽️ {t.dishPortionSizing || 'Dish Portion Sizing (Individual):'}</span>
            <span className="text-[10px] text-slate-400">{t.scaleEachDishIndependently || 'Scale each dish independently'}</span>
          </div>

          <div className="flex flex-col gap-1.5">
            {displayedScoutItems.map((dish: any, dIdx: number) => {
              const dishWeight = Number(dish.weightGrams) || Number(dish.estimatedWeightGrams) || 0;
              const dishBaseWeight = getItemBaseWeight(dish);
              const dishTitle = dish.originalName || dish.keyword || dish.name || `Dish ${dIdx + 1}`;

              return (
                <div
                  key={dIdx}
                  className="flex flex-row items-center justify-between gap-2 bg-slate-800/80 hover:bg-slate-800 px-3 py-2 rounded-lg border border-slate-700/60 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-2 h-2 rounded-full bg-indigo-400 shrink-0" />
                    <span className="text-xs font-semibold text-slate-100 truncate">
                      {dishTitle}
                    </span>
                    <span className="text-[11px] font-bold text-indigo-300 bg-indigo-950/70 border border-indigo-800/60 px-1.5 py-0.2 rounded shrink-0">
                      {dishWeight}g
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[10px] text-slate-400 font-normal hidden sm:inline">{t.weightLabel}:</span>
                    <PortionDropdown
                      baseWeight={dishBaseWeight}
                      currentWeight={dishWeight}
                      onScale={(ratio) => onScaleSingleDish(dIdx, ratio)}
                      darkTheme={true}
                      language={language}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

