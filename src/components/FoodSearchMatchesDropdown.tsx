import React from 'react';
import { Plus } from 'lucide-react';
import { FoodLog } from '../types';
import PreviousMealThumbnail from './PreviousMealThumbnail';
import { collectSavedMealImageUrls } from '../utils/foodImageSources';
import { hydratePreviousMealTag } from '../utils/compositeFoodCalculation';
import { extractAutocompleteQuery, stripSearchResidue } from '../utils/bracketPortionParser';
import { resolveFoodImage } from '../utils/imageResolver';

export interface FoodSearchMatchesDropdownProps {
  catalogMatches: any[];
  matchingPreviousLogs: any[];
  explicitFoodTags: any[];
  activeFoodLogs: FoodLog[];
  activeSearchTerms: string;
  inputText: string;
  tagPortionPreFill: number | null;
  t: any;
  setExplicitFoodTags: React.Dispatch<React.SetStateAction<any[]>>;
  setStagedQuery: React.Dispatch<React.SetStateAction<string>>;
  setInputText: React.Dispatch<React.SetStateAction<string>>;
  setCatalogMatches: React.Dispatch<React.SetStateAction<any[]>>;
  setActiveSearchTerms: React.Dispatch<React.SetStateAction<string>>;
}

export const FoodSearchMatchesDropdown: React.FC<FoodSearchMatchesDropdownProps> = ({
  catalogMatches,
  matchingPreviousLogs,
  explicitFoodTags,
  activeFoodLogs,
  activeSearchTerms,
  inputText,
  tagPortionPreFill,
  t,
  setExplicitFoodTags,
  setStagedQuery,
  setInputText,
  setCatalogMatches,
  setActiveSearchTerms,
}) => {
  const seen = new Set<string>();
  const combinedMatches: any[] = [];
  const addMatch = (m: any, listType: 'brand' | 'previous_meal') => {
    const idKey = String(m.id || m.food_id || m.name || m.dish_name || '').toLowerCase().trim();
    if (!idKey || seen.has(idKey)) return;
    seen.add(idKey);
    combinedMatches.push({ ...m, _listType: listType });
  };
  catalogMatches.forEach(m => addMatch(m, m.type === 'previous_meal' ? 'previous_meal' : 'brand'));
  matchingPreviousLogs.forEach(m => addMatch(m, 'previous_meal'));

  const filteredMatches = combinedMatches.filter(m => !explicitFoodTags.some(tag => tag.dbId === (m._listType === 'brand' ? (m.food_id || m.id) : (m.id || m.food_id))));
  if (filteredMatches.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 mx-3 bg-white dark:bg-slate-800 border border-theme-border/80 rounded-2xl shadow-2xl overflow-hidden max-h-48 overflow-y-auto z-50 animate-fade-in font-sans">
      <div className="px-3 py-1.5 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-700/50 flex justify-between items-center">
        <span className="text-[11px] font-bold text-theme-text-secondary">{t.matches || "Matches"}</span>
        <span className="text-[9px] text-slate-400">{t.clickAddToInline || "Click Add to inline"}</span>
      </div>
      <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
        {filteredMatches.map((item, idx) => {
          const itemName = item.name || item.dish_name || '';
          // T-8: API rows are thin — hydrate nutrients/OCR/images from the full local log.
          const hydratedItem = item._listType === 'previous_meal' ? hydratePreviousMealTag(item, activeFoodLogs) : item;
          const savedImgs = collectSavedMealImageUrls(hydratedItem, activeFoodLogs, { allowSynthesized: false });
          const thumbSrc = savedImgs[0] || '';
          return (
            <div key={item._listType === 'brand' ? (item.food_id || idx) : (item.id || idx)} className="p-2.5 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors">
              <div className="flex items-center gap-2.5 min-w-0">
                {item._listType === 'previous_meal' ? (
                  thumbSrc ? (
                    <PreviousMealThumbnail
                      src={resolveFoodImage(thumbSrc, activeFoodLogs) || thumbSrc}
                      alt={itemName}
                      fallbackLabel={itemName}
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 flex items-center justify-center text-indigo-500 font-bold text-xs shrink-0">
                      {itemName.charAt(0).toUpperCase()}
                    </div>
                  )
                ) : (
                  (item.imageUrl || item.image_url) ? (
                    <PreviousMealThumbnail
                      src={item.imageUrl || item.image_url}
                      alt={item.dish_name}
                      fallbackLabel={item.chain_name || item.dish_name}
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center text-emerald-600 dark:text-emerald-400 font-bold text-xs shrink-0">
                      {(item.chain_name || item.dish_name || 'B').charAt(0).toUpperCase()}
                    </div>
                  )
                )}
                <div className="min-w-0 flex flex-col">
                  <div className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">
                    {item._listType === 'brand' ? item.dish_name : itemName}
                  </div>
                  <div className="text-[10px] text-theme-text-secondary truncate mt-0.5">
                    {item._listType === 'brand' ? item.chain_name : (
                      <span className="bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300 px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider inline-block mr-1">
                        {t.previousMeal || "Previous Meal"}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {item._listType === 'brand' ? (
                  <>
                    <input 
                      type="number" 
                      defaultValue={item.serving_grams || tagPortionPreFill || 100}
                      id={`tag-portion-${item.food_id || idx}`}
                      className="w-12 px-1 py-1 text-xs border rounded bg-white dark:bg-slate-700 text-slate-800 dark:text-white text-center font-mono" 
                    />
                    <span className="text-xs text-slate-500">g</span>
                  </>
                ) : (
                  <>
                    <input 
                      type="number" 
                      defaultValue={item.portionGrams || item.weightGrams || item.weight_grams || 100}
                      id={`prev-portion-${item.id || idx}`}
                      className="w-12 px-1 py-1 text-xs border rounded bg-white dark:bg-slate-700 text-slate-800 dark:text-white text-center font-mono" 
                    />
                    <span className="text-xs text-slate-500">g</span>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (item._listType === 'brand') {
                      const inputEl = document.getElementById(`tag-portion-${item.food_id || idx}`) as HTMLInputElement;
                      const w = Number(inputEl?.value) || item.serving_grams || tagPortionPreFill || 100;
                      setExplicitFoodTags(prev => [...prev, { 
                        dbId: item.food_id, 
                        name: item.dish_name, 
                        weightGrams: Number(w), 
                        source: 'catalog_tag',
                        imageUrl: item.imageUrl || item.image_url,
                        item 
                      }]);
                    } else {
                      const inputEl = document.getElementById(`prev-portion-${item.id || idx}`) as HTMLInputElement;
                      const w = Number(inputEl?.value) || item.portionGrams || item.weightGrams || item.weight_grams || 100;
                      setExplicitFoodTags(prev => [...prev, { 
                        dbId: hydratedItem.id || hydratedItem.food_id, 
                        name: itemName, 
                        source: 'previous_meal', 
                        originalLog: { ...hydratedItem, imageUrl: thumbSrc || hydratedItem.imageUrl, imageUrls: savedImgs },
                        imageUrl: thumbSrc || undefined,
                        weightGrams: Number(w)
                      }]);
                    }
                    // T-5/T-8: snapshot the query this staging consumed and clear
                    // residue-only text so submit routes the tray via the
                    // composite path. Falls back to deriving the query from
                    // text because local rows can precede API results.
                    // Accumulate across multi-item trays so earlier queries
                    // are still treated as residue on submit.
                    const consumedQuery = activeSearchTerms || extractAutocompleteQuery(inputText);
                    if (consumedQuery) {
                      setStagedQuery(prev => (prev && prev.includes(consumedQuery) ? prev : [prev, consumedQuery].filter(Boolean).join(' ').trim()));
                    }
                    setInputText(prev => stripSearchResidue(prev, consumedQuery));
                    setCatalogMatches([]);
                    setActiveSearchTerms('');
                  }}
                  className="px-3 py-1.5 bg-indigo-50 dark:bg-indigo-500/10 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 text-xs font-bold rounded-lg transition-colors flex items-center gap-1 shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {t.addInline || "Add"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default FoodSearchMatchesDropdown;
