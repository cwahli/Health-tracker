cat << 'INNER_EOF' > patch.cjs
const fs = require('fs');
let content = fs.readFileSync('prototype/biomarkers/instruction.ts', 'utf8');

content = content.replace(
  'Otherwise provide 1 single ideal target value without inequalities or ranges (e.g. "33 mmol/mol", "80 umol/L", "95 mL/min/1.73m2"; note 60 for eGFR is naive CKD G2, correct it).',
  'Otherwise provide 1 single ideal target value without inequalities or ranges (e.g. "33 mmol/mol", "80 umol/L", "95 mL/min/1.73m2"; note 60 for eGFR is naive CKD G2, correct it). NEVER output a range with a dash like "20 - 41".'
);

fs.writeFileSync('prototype/biomarkers/instruction.ts', content);

INNER_EOF
node patch.cjs
