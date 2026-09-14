const fs = require('fs');
const file = 'src/components/LogChat.tsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(/newMsgs\.slice\(/g, '(newMsgs || []).slice(');
content = content.replace(/messages\.slice\(/g, '(messages || []).slice(');
content = content.replace(/markerKeysList\.slice\(/g, '(markerKeysList || []).slice(');
content = content.replace(/currentMem\.workHistoryLog\.slice\(/g, '(currentMem.workHistoryLog || []).slice(');
content = content.replace(/foodLogs\?\.slice\(/g, '(foodLogs || []).slice(');
fs.writeFileSync(file, content);
