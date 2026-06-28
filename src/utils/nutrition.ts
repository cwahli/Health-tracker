import { NutrientBreakdown } from '../types';

export interface NutrientMeta {
  key: keyof NutrientBreakdown;
  category: 'macro' | 'mineral' | 'vitamin';
  unit: string;
  labels: { [lang: string]: string };
}

export const nutrientDefinitions: NutrientMeta[] = [
  // Macronutrients
  { key: 'calories', category: 'macro', unit: 'kcal', labels: { en: 'Calories', fr: 'Calories', zh: '卡路里', id: 'Kalori' } },
  { key: 'protein', category: 'macro', unit: 'g', labels: { en: 'Protein', fr: 'Protéines', zh: '蛋白质', id: 'Protein' } },
  { key: 'totalFat', category: 'macro', unit: 'g', labels: { en: 'Total Fat', fr: 'Lipides Totaux', zh: '总脂肪', id: 'Lemak Total' } },
  { key: 'saturatedFat', category: 'macro', unit: 'g', labels: { en: 'Saturated Fat', fr: 'Acides Gras Saturés', zh: '饱和脂肪', id: 'Lemak Jenuh' } },
  { key: 'unsaturatedFat', category: 'macro', unit: 'g', labels: { en: 'Unsaturated Fat', fr: 'Acides Gras Insaturés', zh: '不饱和脂肪', id: 'Lemak Tak Jenuh' } },
  { key: 'omega3', category: 'macro', unit: 'g', labels: { en: 'Omega-3', fr: 'Oméga-3', zh: 'Omega-3 脂肪酸', id: 'Omega-3' } },
  { key: 'carbohydrates', category: 'macro', unit: 'g', labels: { en: 'Carbohydrates', fr: 'Glucides', zh: '碳水化合物', id: 'Karbohidrat' } },
  { key: 'addedSugar', category: 'macro', unit: 'g', labels: { en: 'Added Sugar', fr: 'Sucres Ajoutés', zh: '添加糖', id: 'Gula Tambahan' } },
  { key: 'totalFibre', category: 'macro', unit: 'g', labels: { en: 'Total Fibre', fr: 'Fibres Totales', zh: '膳食纤维总量', id: 'Serat Total' } },
  { key: 'solubleFibre', category: 'macro', unit: 'g', labels: { en: 'Soluble Fibre', fr: 'Fibres Solubles', zh: '可溶性膳食纤维', id: 'Serat Larut' } },

  // Minerals
  { key: 'sodium', category: 'mineral', unit: 'mg', labels: { en: 'Sodium', fr: 'Sodium', zh: '钠', id: 'Natrium' } },
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

export const emptyNutrients = (): NutrientBreakdown => ({
  calories: 0,
  protein: 0,
  totalFat: 0,
  saturatedFat: 0,
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
