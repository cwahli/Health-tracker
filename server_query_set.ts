export function buildFoodSearchQuerySet(scoutItems: any[]): string[] {
  const rawQueries: string[] = [];

  if (!scoutItems || !Array.isArray(scoutItems)) return [];

  scoutItems.forEach((it: any) => {
    const hasMultipleComponents = Array.isArray(it.components) && it.components.length >= 2;
    const isBrandItem = !!it.chainName || (it.originalName && /\b(mcdonald|starbucks|yolk|pret|co-op|tesco|sainsbury|waitrose|brand|official)\b/i.test(it.originalName));

    if (isBrandItem) {
      if (it.queriesToSearch && Array.isArray(it.queriesToSearch)) {
        rawQueries.push(...it.queriesToSearch);
      } else if (it.originalName) {
        if (it.chainName && !it.originalName.toLowerCase().includes(it.chainName.toLowerCase())) {
          rawQueries.push(`${it.chainName} ${it.originalName}`);
        }
        rawQueries.push(it.originalName);
      }
    } else if (!hasMultipleComponents) {
      if (it.queriesToSearch && Array.isArray(it.queriesToSearch)) {
        rawQueries.push(...it.queriesToSearch);
      }
      if (it.genericEnglishName) rawQueries.push(it.genericEnglishName);
      if (it.originalName) rawQueries.push(it.originalName);
      if (it.keyword && it.keyword !== it.originalName) rawQueries.push(it.keyword);
    }

    if (it.components && Array.isArray(it.components)) {
      it.components.forEach((c: any) => {
        const q = typeof c === 'string' ? c : c.searchQuery || c.name || c.keyword;
        if (q) rawQueries.push(q);
      });
    }

    // Additional checks to add common unlisted sauces if visual ingredients hint at them
    const combined = [
      it.originalName, it.keyword, it.originalLocalName, it.canonicalDbName, it.name,
      ...(it.visualIngredients || []),
      ...(it.components ? it.components.map((c: any) => typeof c === 'string' ? c : c.name || c.searchQuery || c.keyword) : [])
    ].filter(Boolean).join(' ').toLowerCase();

    if (combined.includes('mayo') || combined.includes('mayonnaise')) {
      rawQueries.push('mayonnaise');
    }
    if (combined.includes('black pepper sauce') || combined.includes('pepper sauce')) {
      rawQueries.push('black pepper sauce');
    }
  });

  const queryKeyMap = new Map<string, string>();
  for (const rawQ of rawQueries) {
    if (!rawQ) continue;
    let q = String(rawQ).trim();
    // Synonym collapse and query hygiene
    q = q.replace(/\bgarlic mayo\b/ig, 'mayonnaise');
    // Basic normalization for dedup
    const key = q.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!key) continue;
    // Discard paraphrases like "... ingredients"
    if (q.toLowerCase().endsWith('ingredients')) continue;
    
    if (!queryKeyMap.has(key) || q.length < queryKeyMap.get(key)!.length) {
      queryKeyMap.set(key, q);
    }
  }

  return Array.from(queryKeyMap.values());
}
