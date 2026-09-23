import fs from 'fs';
const data = JSON.parse(fs.readFileSync('debug_real.json', 'utf8'));
console.log('Status:', data.status);
console.log('Keys:', Object.keys(data));
console.log('Result keys:', data.result ? Object.keys(data.result) : null);
