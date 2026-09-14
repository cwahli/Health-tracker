import React from 'react';
import { nutrientDefinitions } from '../../utils/nutrition';
import { formatNutrientDisplayValue } from '../../utils/nutrients';
import { translations } from '../../utils/translations';

export const ComprehensiveNutrientsTable: React.FC<{
  nutrients: Record<string, any>;
  language?: string;
  lockedNutrientKeys?: string[];
  basisType?: string;
  servingGrams?: number | string | null;
  onServingSizeChange?: (basisType: string, servingGrams: number | null) => void;
}> = ({ nutrients, language = 'en', lockedNutrientKeys, basisType, servingGrams, onServingSizeChange }) => {
  const t = translations[language] || translations.en;
  
  const [isEditing, setIsEditing] = React.useState(false);
  const [tempBasis, setTempBasis] = React.useState(basisType || 'per_dish');
  const [tempGrams, setTempGrams] = React.useState(servingGrams != null ? String(servingGrams) : '');

  React.useEffect(() => {
    setTempBasis(basisType || 'per_dish');
    setTempGrams(servingGrams != null ? String(servingGrams) : '');
  }, [basisType, servingGrams]);

  const handleSave = () => {
    if (onServingSizeChange) {
      onServingSizeChange(tempBasis, tempGrams === '' ? null : Number(tempGrams));
    }
    setIsEditing(false);
  };
  
  if (!nutrients || Object.keys(nutrients).length === 0) return null;

  const checkIsLocked = (nutKey: string) => {
    if (!lockedNutrientKeys || lockedNutrientKeys.length === 0) return true;
    const normLower = String(nutKey).toLowerCase();
    return lockedNutrientKeys.some((lk: string) => {
      const lkLower = String(lk).toLowerCase();
      return lkLower === normLower ||
        (normLower === 'carbohydrates' && (lkLower === 'carbohydrate' || lkLower === 'carbs' || lkLower === 'totalcarbohydrate')) ||
        (normLower === 'totalfat' && (lkLower === 'fat' || lkLower === 'totalfat')) ||
        (normLower === 'totalfibre' && (lkLower === 'fiber' || lkLower === 'fibre' || lkLower === 'totalfibre')) ||
        (normLower === 'calories' && (lkLower === 'energy' || lkLower === 'cals'));
    });
  };

  const coreKeys = [
    "calories", "protein", "carbohydrates", "totalFat", "saturatedFat", 
    "transFat", "sugar", "addedSugar", "sodium", "potassium", "totalFibre", "solubleFibre"
  ];

  const coreNutrients = nutrientDefinitions.filter(nut => coreKeys.includes(nut.key));
  const additionalNutrients = nutrientDefinitions.filter(nut => !coreKeys.includes(nut.key));

  const activeCore = coreNutrients.filter(nut => {
    const val = nutrients[nut.key];
    return val !== undefined && val !== null && val !== '' && val !== '—';
  });

  const activeAdditional = additionalNutrients.filter(nut => {
    const val = nutrients[nut.key];
    return val !== undefined && val !== null && val !== '' && val !== '—';
  });

  const displayBasis = basisType === 'per_100g'
    ? 'Per 100g'
    : (basisType === 'total' ? 'Combined Meal Total' : 'Per Dish / Portion');
  const displayServing = servingGrams ? `${servingGrams}g` : '';

  return (
    <div className="space-y-2 w-full mx-0">
      {(basisType || servingGrams || onServingSizeChange) && (
        <div className="px-1 text-[9px] text-slate-400 dark:text-slate-400 font-medium flex items-center flex-wrap gap-1">
          {isEditing ? (
            <div className="flex items-center gap-1 bg-slate-800/40 p-1 rounded border border-white/5" onClick={(e) => e.stopPropagation()}>
              <select
                value={tempBasis}
                onChange={(e) => setTempBasis(e.target.value)}
                className="bg-slate-900 border border-white/10 rounded px-1.5 py-0.5 text-[9px] text-white"
              >
                <option value="per_dish">Per Dish / Portion</option>
                <option value="per_100g">Per 100g</option>
              </select>
              <input
                type="number"
                value={tempGrams}
                onChange={(e) => setTempGrams(e.target.value)}
                placeholder="g/ml"
                className="w-12 bg-slate-900 border border-white/10 rounded px-1.5 py-0.5 text-[9px] text-white font-mono"
              />
              <button
                type="button"
                onClick={handleSave}
                className="px-1 py-0.5 bg-emerald-600 hover:bg-emerald-500 rounded text-white text-[8px] font-bold"
              >
                ✓
              </button>
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="px-1 py-0.5 bg-white/10 hover:bg-white/20 rounded text-white text-[8px]"
              >
                ✕
              </button>
            </div>
          ) : (
            <>
              <span>Serving Size:</span>
              <span className="text-slate-300 font-semibold">
                {basisType === 'per_100g' ? '100g' : (basisType === 'total' ? 'Combined Meal Total' : `1 dish${displayServing ? ` (${displayServing})` : ''}`)}
              </span>
              {onServingSizeChange && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsEditing(true);
                  }}
                  className="ml-1 px-1 py-0.5 rounded bg-white/5 hover:bg-white/15 text-indigo-300 text-[8px] flex items-center gap-0.5"
                >
                  ✏️ Edit
                </button>
              )}
            </>
          )}
        </div>
      )}
      
      <div className="space-y-2 w-full">
        {/* Core Nutrients Table */}
        {activeCore.length > 0 && (
          <div className="border-y border-theme-border/50 bg-theme-bg-card shadow-sm w-full overflow-hidden">
            <div className="px-3 py-1 bg-slate-50/5 dark:bg-slate-800/40 border-b border-theme-border/50 flex items-center justify-between">
              <span className="text-[9px] font-bold text-theme-text-secondary uppercase tracking-wider font-sans">
                📋 {t.coreNutrients11 || 'Core Nutrients'}
              </span>
            </div>
            <div className="overflow-x-auto w-full">
              <table className="w-full text-left border-collapse text-[10px]">
                <thead>
                  <tr className="border-b border-theme-border bg-slate-50/5 dark:bg-slate-800/20 text-theme-text-secondary font-bold">
                    {activeCore.map(nut => (
                      <th key={nut.key} className="p-1 px-2.5 text-center border-r border-theme-border/20 last:border-r-0 whitespace-nowrap">
                        {nut.labels[language] || nut.labels.en}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-white/5">
                    {activeCore.map(nut => {
                      const val = nutrients[nut.key];
                      const isLocked = checkIsLocked(nut.key);
                      return (
                        <td key={nut.key} className="p-1.5 px-2.5 text-center font-mono font-semibold text-slate-800 dark:text-slate-100 border-r border-theme-border/20 last:border-r-0 whitespace-nowrap">
                          <div className="flex items-center justify-center gap-0.5">
                            <span>{formatNutrientDisplayValue(val, nut.unit)}</span>
                            {!isLocked && (
                              <span className="text-amber-500 text-[8px]" title="Estimated by AI">⚠️</span>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Additional Nutrients Table */}
        {activeAdditional.length > 0 && (
          <div className="border-y border-theme-border/50 bg-theme-bg-card shadow-sm w-full overflow-hidden">
            <div className="px-3 py-1 bg-slate-50/5 dark:bg-slate-800/40 border-b border-theme-border/50 flex items-center justify-between">
              <span className="text-[9px] font-bold text-theme-text-secondary uppercase tracking-wider font-sans">
                🔬 {t.additionalNutrients20 || 'Additional Nutrients'}
              </span>
            </div>
            <div className="overflow-x-auto w-full">
              <table className="w-full text-left border-collapse text-[10px]">
                <thead>
                  <tr className="border-b border-theme-border bg-slate-50/5 dark:bg-slate-800/20 text-theme-text-secondary font-bold">
                    {activeAdditional.map(nut => (
                      <th key={nut.key} className="p-1 px-2.5 text-center border-r border-theme-border/20 last:border-r-0 whitespace-nowrap">
                        {nut.labels[language] || nut.labels.en}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-white/5">
                    {activeAdditional.map(nut => {
                      const val = nutrients[nut.key];
                      const isLocked = checkIsLocked(nut.key);
                      return (
                        <td key={nut.key} className="p-1.5 px-2.5 text-center font-mono font-semibold text-slate-800 dark:text-slate-100 border-r border-theme-border/20 last:border-r-0 whitespace-nowrap">
                          <div className="flex items-center justify-center gap-0.5">
                            <span>{formatNutrientDisplayValue(val, nut.unit)}</span>
                            {!isLocked && (
                              <span className="text-amber-500 text-[8px]" title="Estimated by AI">⚠️</span>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
