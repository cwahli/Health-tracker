export { scoutSystemInstruction } from '../server_vision_scout.js';

export function buildVisualScoutPrompt(message: string, imageCount: number, isCompareMode: boolean = false): string {
  const cleanMsg = (message || '').replace(/\[+[^\]]+\]+/g, '').replace(/\s+/g, ' ').trim();
  const normalizedWords = cleanMsg.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?'"“”]/g, '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const genericTokens = new Set(['i', 'had', 'have', 'ate', 'eaten', 'and', 'with', 'all', 'the', 'food', 'foods', 'dish', 'dishes', 'item', 'items', 'in', 'picture', 'pictures', 'photo', 'photos', 'image', 'images', 'log', 'meal', 'scan', 'analyze', 'this', 'that', 'for', 'my']);
  const isGeneric = !cleanMsg || normalizedWords.length === 0 || normalizedWords.every(w => genericTokens.has(w));
  const multiImageRule = imageCount > 1 
    ? " Audit every image independently and extract distinct food items seen across ALL images. Do not stop after analyzing a label."
    : "";
  let baseInstruction = `Analyze the provided ${imageCount > 1 ? imageCount + ' meal images' : 'meal image'}. Inspect all visible prepared dishes, cooking pots, grocery packages, and barcode labels. Read any visible OCR text on cups, wrappers, menus, menu boards, counter displays, and order screens to identify fast-food brands or commercial chains. When such text shows a PRINTED energy or nutrient value for an item (e.g. '1558 kJ/371 kcal', '370 kcal per serving', 'per 100g'), that printed value is LABEL TRUTH: transcribe it verbatim into the dish's rawNutritionLabel and anchor the dish nutrients to it. Never estimate from standard nutrition tables in place of a printed value that is legible in the image; printed values outrank your estimate, and standard tables are only a fallback for items whose label you cannot read. Ingest all visible foods and packages completely into dishes and constituent foods.${multiImageRule}`;

  if (isCompareMode) {
    baseInstruction += "\n\n=== ACTIVE TASK: PRODUCT EVALUATION & COMPARISON ===\nEvaluate each item independently. Do NOT merge distinct products into a single meal.";
  }

  if (isGeneric) {
    return `${baseInstruction} Extract all physical dishes and constituent foods into the hierarchical schema with weightGrams, packGrams, and nutrients.`;
  }
  return `${baseInstruction} User note: "${cleanMsg}". If the user note explicitly mentions additional foods consumed, you MUST extract them as well, even if not visible in the images. Extract all physical dishes and constituent foods into the hierarchical schema with weightGrams, packGrams, and nutrients.`;
}

/**
 * Special-case patient block for the scout system instruction. Returns ''
 * when there is nothing at risk so the base prompt is untouched (L12
 * net-zero). Budgets are NOT repeated here — the NUTRITIONAL TARGET STATUS
 * block (7-day averages) carries them. Shapes verdict/advice only — never
 * identity or weights.
 */
export function buildScoutPersonalizationBlock(args: {
  biomarkersNeedingImprovement?: any[] | null;
}): string {
  const risks = (args.biomarkersNeedingImprovement || [])
    .map((b: any) => {
      const name = typeof b === 'string' ? b.split(' is ')[0] : (b?.name || b?.key || b?.biomarker || '');
      const dir = typeof b === 'string' ? (b.match(/\bis\s+(high|low|critical)\b/i)?.[1].toLowerCase() || '') : (b?.direction || b?.trend || '');
      return name ? `${String(name).trim()}${dir ? ` (${dir})` : ''}` : '';
    })
    .filter(Boolean)
    .slice(0, 5);
  if (risks.length === 0) return '';
  return `- PATIENT CONTEXT (special case — shapes verdict/advice only, never identity or weights): at-risk: ${risks.join('; ')}. Budgets: see NUTRITIONAL TARGET STATUS below. Pair praise for positive nutrient targets with plain alerts on any dish or nutrient working against those numbers.`;
}

export function parseBracketedFoodItems(message: string): Array<{
  originalName: string;
  foodName: string;
  keyword: string;
  estimatedWeightGrams: number;
  source: string;
  isBracketPreExtracted: boolean;
  dishName: string;
  cookingMethod: string;
  visualIngredients: any[];
}> {
  if (!message) return [];
  const matches = message.matchAll(/\[+([^\]]+)\]+/g);
  const items = [];
  for (const m of matches) {
    const raw = (m[1] || '').trim();
    if (!raw) continue;
    let name = raw;
    let weight = 100;
    const weightMatch = raw.match(/(?:^|\s+)(\d+(?:\.\d+)?)\s*(?:g|grams?|ml)?\s*$/i);
    if (weightMatch) {
      weight = parseFloat(weightMatch[1]);
      name = raw.slice(0, weightMatch.index).trim();
      if (!name) name = raw;
    }
    items.push({
      originalName: name,
      foodName: name,
      keyword: name,
      estimatedWeightGrams: weight,
      source: 'bracket_pre_extracted',
      isBracketPreExtracted: true,
      dishName: name,
      cookingMethod: 'raw',
      visualIngredients: []
    });
  }
  return items;
}

