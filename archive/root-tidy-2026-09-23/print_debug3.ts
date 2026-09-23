import fs from 'fs';
const data = JSON.parse(fs.readFileSync('debug3.json', 'utf8'));
const dispatches = data.dispatches || data.result?.dispatches || [];
console.log(JSON.stringify(dispatches.map(d => ({id: d.id, agent: d.agent, turn: d.turn})), null, 2));
