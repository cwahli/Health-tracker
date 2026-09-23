const { readFileSync } = require('fs');
const d = JSON.parse(readFileSync('debug4.json'));
console.log(Object.keys(d));
