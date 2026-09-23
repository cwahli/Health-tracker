const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src/utils/translations.ts');
let content = fs.readFileSync(file, 'utf8');

const enKeys = `
  "auditFixMissingUnit": "Standardize unit",
  "ledgerMacros": "{p}g protein, {c}g carbs, {f}g fat",
  "ledgerLoggedMeal": "Logged {name} ({paren}).",
  "apOverLimit": "You are {mult}x over the limit for {nutrient}.",
`;

const idKeys = `
  "auditFixMissingUnit": "Standarkan unit",
  "ledgerMacros": "{p}g protein, {c}g karbohidrat, {f}g lemak",
  "ledgerLoggedMeal": "{name} dicatat ({paren}).",
  "apOverLimit": "Anda {mult}x melebihi batas untuk {nutrient}.",
`;

// Replace existing keys if they exist, or append them
function replaceOrAdd(text, keysString, blockStart) {
  // We can just append right after the block start since it's a JS object
  return text.replace(blockStart, blockStart + '\n' + keysString);
}

content = replaceOrAdd(content, enKeys, 'en: {');
content = replaceOrAdd(content, idKeys, 'id: {');

fs.writeFileSync(file, content, 'utf8');
console.log('Injected fixes 2');
