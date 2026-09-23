const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src/utils/translations.ts');
let content = fs.readFileSync(file, 'utf8');

const enKeys = `
  "auditFixNeedsReview": "Needs AI Review",
`;

const idKeys = `
  "auditFixNeedsReview": "Perlu Tinjauan AI",
`;

function replaceOrAdd(text, keysString, blockStart) {
  return text.replace(blockStart, blockStart + '\n' + keysString);
}

content = replaceOrAdd(content, enKeys, 'en: {');
content = replaceOrAdd(content, idKeys, 'id: {');

fs.writeFileSync(file, content, 'utf8');
console.log('Injected fixes 3');
