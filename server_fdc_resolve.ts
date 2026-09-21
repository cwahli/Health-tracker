import { calculateGenericTokenCoverage, evaluateGenericModifierInversionPenalty, evaluateUniversalCategoryDisparity } from './server_matching_engine.js';
import { d1Query, isD1Configured } from './server_d1.js';
import { checkCategoryAndStateCompatibility } from './server_pure_helpers.js';

export function scoreCandidate(query: string, candidate: any): number {
  const cDesc = candidate.description || candidate.product_name || candidate.name || "";
  const compat = checkCategoryAndStateCompatibility(query, cDesc);
  if (!compat.compatible) {
    return -9999;
  }

  const qTokens = query.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
  const cName = cDesc.toLowerCase().replace(/[^a-z0-9\s]/g, '');
  const cTokens = cName.split(/\s+/).filter(Boolean);
  
  const tokenCov = calculateGenericTokenCoverage(qTokens, cTokens);
  let score = tokenCov.ratio * 100;
  
  // Exact match bonus
  if (query.toLowerCase() === (candidate.description || "").toLowerCase()) {
    score += 30;
  } else if (tokenCov.allMatched) {
    score += 15;
  }
  
  // Penalties
  const invPenalty = evaluateGenericModifierInversionPenalty(query, candidate.description || "");
  score -= invPenalty;
  
  const catPenalty = evaluateUniversalCategoryDisparity(query, candidate.description || "");
  score -= catPenalty;
  
  return score;
}

export function rankAndClassifyCandidates(query: string, candidates: any[], threshold: number = 70) {
  if (!candidates || candidates.length === 0) return { resolveClass: 'MISS', survivors: [], bestMatch: null };

  const scored = candidates.map(c => ({ candidate: c, score: scoreCandidate(query, c) }));
  scored.sort((a, b) => b.score - a.score);
  
  const survivors = scored.filter(s => s.score >= threshold);
  
  let resolveClass = 'MISS';
  if (survivors.length === 1) resolveClass = 'HIT_UNIQUE';
  else if (survivors.length >= 2) resolveClass = 'MULTI_MATCH';
  
  return { 
    resolveClass, 
    survivors, 
    bestMatch: survivors.length > 0 ? survivors[0].candidate : null 
  };
}

import { normalizeFoodKey } from './server_food_catalog.js';

export async function writeAliasIfHitUnique(resolveClass: string, query: string, bestMatch: any) {
  if (resolveClass === 'HIT_UNIQUE' && bestMatch) {
    const fdcId = bestMatch.fdcId || bestMatch.id || bestMatch.food_id;
    if (fdcId && query) {
      const aliasKey = normalizeFoodKey(query);
      if (!aliasKey) return;
      try {
        console.log(`[ResolveClass] HIT_UNIQUE for "${query}" (key: ${aliasKey}). Auto-aliasing to ${fdcId}.`);
        if (!isD1Configured()) return;
        await d1Query(
          `INSERT INTO food_aliases (alias_key, food_id, weight, source, hit_count) VALUES (?, ?, 1.0, 'hit_unique_auto_alias', 1)
           ON CONFLICT(alias_key) DO UPDATE SET food_id = excluded.food_id, source = excluded.source`,
          [aliasKey, String(fdcId)]
        );
      } catch (err) {
        console.warn(`[ResolveClass] Failed to write auto-alias for ${query}:`, err);
      }
    }
  }
}
