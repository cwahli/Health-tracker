const fs = require('fs');
let content = fs.readFileSync('tests/golden_biomarker.test.ts', 'utf8');

// Replace all instances of `if (!fs.existsSync(...) return;` with a skipped test
content = content.replace(/if \(\!fs\.existsSync\(path\.resolve\(__dirname, 'Golden_biomarker'\)\)\) return;/g, 
  "if (!fs.existsSync(path.resolve(__dirname, 'Golden_biomarker'))) { it.skip('missing directory', () => {}); return; }");

fs.writeFileSync('tests/golden_biomarker.test.ts', content, 'utf8');
