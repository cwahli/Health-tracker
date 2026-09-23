const fs = require('fs');

const sets = [1, 2, 3, 4, 5, 6];
let report = "# Target-Aware Grouping Debug Results\n\n";

for (const s of sets) {
  const file = `prototype/meallog/compare/debug_runs/compare_set${s}_scout_compare_debug.json`;
  if (!fs.existsSync(file)) continue;
  
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  report += `## Set ${s}: ${data.comparisonTitle}\n`;
  report += `**Total Items Extracted:** ${data.items ? data.items.length : 0}\n\n`;
  
  if (data.groups) {
    data.groups.forEach((g, idx) => {
      report += `### Rank ${idx + 1}: ${g.groupName} [${(g.verdict?.level || g.level || '').toUpperCase()}]\n`;
      report += `- **Message:** ${g.message || g.verdict?.clinicalMessage || g.verdict?.message}\n`;
      const n = g.averageNutrients || {};
      report += `- **Nutrients:** ${n.calories} kcal | S.Fat: ${n.saturatedFat}g | Sugar (Added): ${n.addedSugar || n.sugar}g | Na: ${n.sodium}mg | Fibre: ${n.totalFibre}g | Prot: ${n.protein}g | Carbs: ${n.carbohydrates}g\n\n`;
    });
  }
}

fs.writeFileSync('targeted_debug_report.md', report);
