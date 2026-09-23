const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src/utils/translations.ts');
let content = fs.readFileSync(file, 'utf8');

const enKeys = `
  "compilerNotFound": "Item '{name}' not found.",
  "compilerMultipleMatch": "Found multiple items matching \\"{name}\\".",
`;

const idKeys = `
  "compilerNotFound": "Item '{name}' tidak ditemukan.",
  "compilerMultipleMatch": "Found multiple items matching \\"{name}\\".",
`;

function replaceOrAdd(text, keysString, blockStart) {
  return text.replace(blockStart, blockStart + '\n' + keysString);
}

content = replaceOrAdd(content, enKeys, 'en: {');
content = replaceOrAdd(content, idKeys, 'id: {');

fs.writeFileSync(file, content, 'utf8');
console.log('Injected fixes 4');
