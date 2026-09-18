import { NutrientBreakdown } from '../types';

export interface NutrientMeta {
  key: keyof NutrientBreakdown;
  category: 'macro' | 'mineral' | 'vitamin';
  unit: string;
  labels: { [lang: string]: string };
}

export const nutrientDefinitions: NutrientMeta[] = [
  // 1. Energy
  { key: 'calories', category: 'macro', unit: 'kcal', labels: { en: 'Calories', fr: 'Calories', zh: '卡路里', id: 'Kalori' } },

  // 2. Fat & Lipids
  { key: 'totalFat', category: 'macro', unit: 'g', labels: { en: 'Total Fat', fr: 'Lipides Totaux', zh: '总脂肪', id: 'Lemak Total' } },
  { key: 'saturatedFat', category: 'macro', unit: 'g', labels: { en: 'Saturated Fat', fr: 'Acides Gras Saturés', zh: '饱和脂肪', id: 'Lemak Jenuh' } },
  { key: 'transFat', category: 'macro', unit: 'g', labels: { en: 'Trans Fat', fr: 'Acides Gras Trans', zh: '反式脂肪', id: 'Lemak Trans' } },
  { key: 'unsaturatedFat', category: 'macro', unit: 'g', labels: { en: 'Unsaturated Fat', fr: 'Acides Gras Insaturés', zh: '不饱和脂肪', id: 'Lemak Tak Jenuh' } },
  { key: 'omega3', category: 'macro', unit: 'g', labels: { en: 'Omega-3', fr: 'Oméga-3', zh: 'Omega-3 脂肪酸', id: 'Omega-3' } },

  // 3. Carbohydrates, Fiber, Sugars
  { key: 'carbohydrates', category: 'macro', unit: 'g', labels: { en: 'Carbohydrates', fr: 'Glucides', zh: '碳水化合物', id: 'Karbohidrat' } },
  { key: 'totalFibre', category: 'macro', unit: 'g', labels: { en: 'Total Fibre', fr: 'Fibres Totales', zh: '膳食纤维总量', id: 'Serat Total' } },
  { key: 'solubleFibre', category: 'macro', unit: 'g', labels: { en: 'Soluble Fibre', fr: 'Fibres Solubles', zh: '可溶性膳食纤维', id: 'Serat Larut' } },
  { key: 'sugar', category: 'macro', unit: 'g', labels: { en: 'Total Sugar', fr: 'Sucre Total', zh: '总糖量', id: 'Gula Total' } },
  { key: 'addedSugar', category: 'macro', unit: 'g', labels: { en: 'Added Sugar', fr: 'Sucres Ajoutés', zh: '添加糖', id: 'Gula Tambahan' } },

  // 4. Protein
  { key: 'protein', category: 'macro', unit: 'g', labels: { en: 'Protein', fr: 'Protéines', zh: '蛋白质', id: 'Protein' } },

  // 5. Sodium / Salt & Minerals
  { key: 'sodium', category: 'mineral', unit: 'mg', labels: { en: 'Sodium', fr: 'Sodium', zh: '钠', id: 'Natrium' } },
  { key: 'salt' as any, category: 'mineral', unit: 'g', labels: { en: 'Salt', fr: 'Sel', zh: '盐', id: 'Garam' } },

  // 6. Minerals & Trace Elements
  { key: 'potassium', category: 'mineral', unit: 'mg', labels: { en: 'Potassium', fr: 'Potassium', zh: '钾', id: 'Kalium' } },
  { key: 'magnesium', category: 'mineral', unit: 'mg', labels: { en: 'Magnesium', fr: 'Magnésium', zh: '镁', id: 'Magnesium' } },
  { key: 'calcium', category: 'mineral', unit: 'mg', labels: { en: 'Calcium', fr: 'Calcium', zh: '钙', id: 'Kalsium' } },
  { key: 'iron', category: 'mineral', unit: 'mg', labels: { en: 'Iron', fr: 'Fer', zh: '铁', id: 'Zat Besi' } },
  { key: 'zinc', category: 'mineral', unit: 'mg', labels: { en: 'Zinc', fr: 'Zinc', zh: '锌', id: 'Seng' } },
  { key: 'selenium', category: 'mineral', unit: 'mcg', labels: { en: 'Selenium', fr: 'Sélénium', zh: '硒', id: 'Selenium' } },
  { key: 'iodine', category: 'mineral', unit: 'mcg', labels: { en: 'Iodine', fr: 'Iode', zh: '碘', id: 'Yodium' } },
  { key: 'phosphorus', category: 'mineral', unit: 'mg', labels: { en: 'Phosphorus', fr: 'Phosphore', zh: '磷', id: 'Fosfor' } },

  // Vitamins
  { key: 'vitaminD', category: 'vitamin', unit: 'IU', labels: { en: 'Vitamin D', fr: 'Vitamine D', zh: '维生素 D', id: 'Vitamin D' } },
  { key: 'vitaminB12', category: 'vitamin', unit: 'mcg', labels: { en: 'Vitamin B12', fr: 'Vitamine B12', zh: '维生素 B12', id: 'Vitamin B12' } },
  { key: 'folate', category: 'vitamin', unit: 'mcg', labels: { en: 'Folate (B9)', fr: 'Folate (B9)', zh: '叶酸 (B9)', id: 'Folat (B9)' } },
  { key: 'vitaminC', category: 'vitamin', unit: 'mg', labels: { en: 'Vitamin C', fr: 'Vitamine C', zh: '维生素 C', id: 'Vitamin C' } },
  { key: 'vitaminE', category: 'vitamin', unit: 'mg', labels: { en: 'Vitamin E', fr: 'Vitamine E', zh: '维生素 E', id: 'Vitamin E' } },
  { key: 'vitaminK', category: 'vitamin', unit: 'mcg', labels: { en: 'Vitamin K', fr: 'Vitamine K', zh: '维生素 K', id: 'Vitamin K' } },
  { key: 'vitaminA', category: 'vitamin', unit: 'mcg', labels: { en: 'Vitamin A', fr: 'Vitamine A', zh: '维生素 A', id: 'Vitamin A' } },
  { key: 'vitaminB6', category: 'vitamin', unit: 'mg', labels: { en: 'Vitamin B6', fr: 'Vitamine B6', zh: '维生素 B6', id: 'Vitamin B6' } },
  { key: 'thiamine', category: 'vitamin', unit: 'mg', labels: { en: 'Thiamine (B1)', fr: 'Thiamine (B1)', zh: '硫胺素 (B1)', id: 'Tiamin (B1)' } },
  { key: 'riboflavin', category: 'vitamin', unit: 'mg', labels: { en: 'Riboflavin (B2)', fr: 'Riboflavine (B2)', zh: '核黄素 (B2)', id: 'Riboflavin (B2)' } },
  { key: 'niacin', category: 'vitamin', unit: 'mg', labels: { en: 'Niacin (B3)', fr: 'Niacine (B3)', zh: '烟酸 (B3)', id: 'Niasin (B3)' } },
];

export const MASTER_NUTRIENT_COLORS: { [key: string]: string } = {
  // Core macros & energy
  calories: 'var(--color-nutrient-calories, rgb(249, 115, 22))',       // Orange
  saturatedFat: 'var(--color-nutrient-saturatedFat, rgb(234, 179, 8))',    // Amber/Yellow
  transFat: 'rgb(185, 28, 28)',        // Dark Red
  unsaturatedFat: 'rgb(132, 204, 22)', // Lime
  totalFat: 'var(--color-nutrient-totalFat, rgb(168, 85, 247))',       // Purple
  sodium: 'var(--color-nutrient-sodium, rgb(34, 197, 94))',          // Emerald/Green
  sugar: 'rgb(244, 114, 182)',         // Light Pink/Rose
  addedSugar: 'rgb(239, 68, 68)',      // Bright Red
  protein: 'var(--color-nutrient-protein, rgb(59, 130, 246))',        // Blue
  carbohydrates: 'var(--color-nutrient-carbohydrates, rgb(6, 182, 212))',   // Cyan
  totalFibre: 'rgb(16, 185, 129)',     // Forest Green
  solubleFibre: 'rgb(236, 72, 153)',   // Vibrant Pink
  omega3: 'rgb(20, 184, 166)',         // Vibrant Teal
  
  // Minerals
  potassium: 'rgb(139, 92, 246)',      // Violet
  magnesium: 'rgb(244, 63, 94)',       // Rose
  calcium: 'rgb(14, 165, 233)',        // Sky Blue
  iron: 'rgb(217, 70, 239)',           // Magenta
  zinc: 'rgb(217, 119, 6)',            // Dark Amber
  selenium: 'rgb(234, 88, 12)',        // Deep Orange
  iodine: 'rgb(109, 40, 217)',         // Indigo
  phosphorus: 'rgb(74, 222, 128)',     // Light Green
  
  // Vitamins
  vitaminD: 'rgb(250, 204, 21)',       // Bright Yellow
  vitaminB12: 'rgb(192, 38, 211)',     // Fuchsia
  folate: 'rgb(251, 113, 133)',        // Coral
  vitaminC: 'rgb(251, 146, 60)',       // Light Orange
  vitaminE: 'rgb(180, 83, 9)',         // Warm Brown
  vitaminK: 'rgb(21, 128, 61)',        // Dark Green
  vitaminA: 'rgb(225, 29, 72)',        // Crimson
  vitaminB6: 'rgb(147, 51, 234)',      // Royal Purple
  thiamine: 'rgb(45, 212, 191)',       // Turquoise
  riboflavin: 'rgb(163, 230, 53)',     // Electric Lime
  niacin: 'rgb(129, 140, 248)'         // Periwinkle
};

export const FALLBACK_NUTRIENT_COLOR_PALETTE = [
  'rgb(99, 102, 241)',   // indigo
  'rgb(236, 72, 153)',   // pink
  'rgb(168, 85, 247)',   // purple
  'rgb(20, 184, 166)',   // teal
  'rgb(245, 158, 11)',   // amber
  'rgb(14, 165, 233)',   // sky blue
  'rgb(132, 204, 22)',   // lime
  'rgb(244, 63, 94)',    // rose
  'rgb(161, 98, 7)',    // brown-amber
];

export const getFallbackNutrientColor = (key: string): string => {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = key.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % FALLBACK_NUTRIENT_COLOR_PALETTE.length;
  return FALLBACK_NUTRIENT_COLOR_PALETTE[index];
};

export const getNutrientColor = (key: string): string => {
  if (!key) return FALLBACK_NUTRIENT_COLOR_PALETTE[0];
  if (MASTER_NUTRIENT_COLORS[key]) return MASTER_NUTRIENT_COLORS[key];
  const lowerKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  const matchedEntry = Object.keys(MASTER_NUTRIENT_COLORS).find(
    k => k.toLowerCase().replace(/[^a-z0-9]/g, '') === lowerKey
  );
  if (matchedEntry) return MASTER_NUTRIENT_COLORS[matchedEntry];
  return getFallbackNutrientColor(key);
};

export const emptyNutrients = (): NutrientBreakdown => ({
  calories: 0,
  protein: 0,
  totalFat: 0,
  saturatedFat: 0,
  transFat: 0,
  unsaturatedFat: 0,
  omega3: 0,
  carbohydrates: 0,
  addedSugar: 0,
  totalFibre: 0,
  solubleFibre: 0,
  sodium: 0,
  potassium: 0,
  magnesium: 0,
  calcium: 0,
  iron: 0,
  zinc: 0,
  selenium: 0,
  iodine: 0,
  phosphorus: 0,
  vitaminD: 0,
  vitaminB12: 0,
  folate: 0,
  vitaminC: 0,
  vitaminE: 0,
  vitaminK: 0,
  vitaminA: 0,
  vitaminB6: 0,
  thiamine: 0,
  riboflavin: 0,
  niacin: 0,
});
