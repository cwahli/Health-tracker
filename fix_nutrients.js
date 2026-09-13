const fs = require('fs');
let code = fs.readFileSync('src/utils/nutrients.ts', 'utf8');
code = code.replace(/export function canonicalNutrientKey[\s\S]*/g, '');
fs.writeFileSync('src/utils/nutrients.ts', code);
