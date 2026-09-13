const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src/utils/translations.ts');
let content = fs.readFileSync(file, 'utf8');

const enKeys = `
  "adviceProbioticSugar": "{grams}g of sugar in this probiotic drink. The gut benefits are great, but mind your total daily sugar.",
  "adviceSolidProtein": "{grams}g of clean protein. Excellent for muscle repair and satiety.",
  "adviceHighSugar": "{grams}g of sugar is quite high for a single meal. Try to balance the rest of your day.",
  "adviceNeutral": "",
  "adviceLoggedBalanced": "Logged {name}. Looks balanced.",
  "balancedMealFallbackName": "Balanced Meal",
  "apMealPosition": "This meal is {kcal} kcal, representing {pct}% of your daily target.",
  "apNutSugar": "sugar",
  "apNutSatFat": "saturated fat",
  "apOverLimit": "You are over the limit for {nutrient}.",
  "apRestOfDay": "For the rest of the day, focus on lighter meals.",
  "apProteinSteer": "Try to hit your remaining {protein}g of protein.",
  "apTransFatWarn": "Contains {grams}g of trans fat. Best to avoid.",
  "verdictHighGlycemicSugar": "High Glycemic Sugar",
  "verdictElevatedSatFat": "Elevated Saturated Fat",
  "verdictLeanMuscle": "Lean Muscle Support",
  "verdictGutMicrobiome": "Gut Microbiome",
  "verdictSupportsMetabolicEnergy": "Supports Metabolic Energy",
  "verdictPortionControl": "Portion Control",
  "messageScaledPortion": "Scaled to {grams}g.",
  "cookingMethodUnknown": "Unknown cooking method",
  "ledgerLoggedMeal": "Logged {name} {paren}",
  "apNoSugar": "no sugar",
  "auditTitleMissingUnit": "Missing Unit",
`;

const idKeys = `
  "adviceProbioticSugar": "{grams}g gula dalam minuman probiotik ini. Baik untuk usus, namun perhatikan total harian.",
  "adviceSolidProtein": "{grams}g protein bersih. Sangat baik untuk perbaikan otot.",
  "adviceHighSugar": "{grams}g gula cukup tinggi. Cobalah menyeimbangkan sisa hari Anda.",
  "adviceNeutral": "",
  "adviceLoggedBalanced": "Mencatat {name}. Terlihat seimbang.",
  "balancedMealFallbackName": "Makanan Seimbang",
  "apMealPosition": "Makanan ini {kcal} kkal, mewakili {pct}% dari target harian Anda.",
  "apNutSugar": "gula",
  "apNutSatFat": "lemak jenuh",
  "apOverLimit": "Anda melebihi batas untuk {nutrient}.",
  "apRestOfDay": "Untuk sisa hari ini, fokuslah pada makanan yang lebih ringan.",
  "apProteinSteer": "Cobalah untuk mencapai sisa protein {protein}g Anda.",
  "apTransFatWarn": "Mengandung {grams}g lemak trans. Sebaiknya dihindari.",
  "verdictHighGlycemicSugar": "Gula Glikemik Tinggi",
  "verdictElevatedSatFat": "Lemak Jenuh Tinggi",
  "verdictLeanMuscle": "Dukungan Otot",
  "verdictGutMicrobiome": "Mikrobioma Usus",
  "verdictSupportsMetabolicEnergy": "Mendukung Energi Metabolik",
  "verdictPortionControl": "Kontrol Porsi",
  "messageScaledPortion": "Disesuaikan menjadi {grams}g.",
  "cookingMethodUnknown": "Metode memasak tidak diketahui",
  "ledgerLoggedMeal": "{name} dicatat {paren}",
  "apNoSugar": "tanpa gula",
  "auditTitleMissingUnit": "Unit Tidak Spesifik atau Hilang",
`;

content = content.replace('en: {', 'en: {\n' + enKeys);
content = content.replace('id: {', 'id: {\n' + idKeys);

fs.writeFileSync(file, content, 'utf8');
console.log('Injected missing keys');
