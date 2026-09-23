import fs from 'fs';
const data = JSON.parse(fs.readFileSync('debug4.json', 'utf-8'));
console.log(JSON.stringify(data.scoutItems[0], null, 2));
