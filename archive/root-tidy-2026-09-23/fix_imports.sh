sed -i "1i import { sanitizeDishTitle } from './server_pure_helpers.js';" server_food_analyze_run_precalc.ts
sed -i "1i import { isUsableWebNutritionHit } from './server_matching_engine.js';" server_food_analyze_run_precalc.ts
