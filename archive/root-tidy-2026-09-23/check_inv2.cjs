const fs = require('fs');
const d = JSON.parse(fs.readFileSync('debug4.json'));
console.log(d.tape.invariants.filter(i => !i.pass));
