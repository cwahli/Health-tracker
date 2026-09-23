import fs from 'fs';
const data = JSON.parse(fs.readFileSync('debug_real.json', 'utf8'));
console.log(JSON.stringify(data.dispatches || data.result?.dispatches, null, 2));
