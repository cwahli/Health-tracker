import fs from 'fs';
const data = JSON.parse(fs.readFileSync('debug4.json', 'utf-8'));
for (const key of Object.keys(data)) {
  if (Array.isArray(data[key])) {
    const fallbackItem = data[key].find((i: any) => JSON.stringify(i).includes("fallback"));
    if (fallbackItem) console.log(`Found in ${key}:`, fallbackItem);
  }
}
