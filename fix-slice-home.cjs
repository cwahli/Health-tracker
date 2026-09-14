const fs = require('fs');
const file = 'src/components/HomeTab.tsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(/activeJobs\.slice\(\)/g, '(activeJobs || []).slice()');
fs.writeFileSync(file, content);
