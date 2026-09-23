import fs from 'fs';
const data = JSON.parse(fs.readFileSync('debug_real.json', 'utf8'));
const logs = data.backendLogs || '';
console.log(logs.split('\n').filter(l => l.includes('[Narrator]')).join('\n'));
