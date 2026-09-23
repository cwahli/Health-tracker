import fs from 'fs';
const data = JSON.parse(fs.readFileSync('debug4.json', 'utf-8'));
const contract = data.contract.find((c: any) => c.law === "Every scout component was resolved (diagnostic, catalog, or printed label)");
console.log(contract);
