/**
 * Catalog replay — frozen scout, no Gemini.
 * Used by POST /api/golden/cases/:id/replay.
 */
import { lookupCanonicalBaseFood } from '../../server_food_db.js';
import {
  identityOk,
  isForbiddenHit,
  needsBroaderBase,
  normalizeScoutItems,
  type GoldenJourneyRow,
  type JourneyPhase,
} from './goldenJourney';

export type CatalogHit = {
  fdcId?: string | number | null;
  name?: string | null;
  foodType?: string | null;
};

function dishName(it: any, fallback: string): string {
  return String(it?.originalName || it?.name || it?.canonicalDbName || it?.keyword || fallback).trim();
}

function slug(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);
}

export function classifyCatalogHit(query: string, hit: CatalogHit | null | undefined): JourneyPhase {
  if (!hit || hit.fdcId == null && !hit.name) return 'no_match';
  const name = String(hit.name || '');
  const id = hit.fdcId != null ? String(hit.fdcId) : '';
  if (isForbiddenHit(id, name)) return 'mismatch';
  if (name && needsBroaderBase(query, name, 'internal_catalog')) return 'broad_base';
  return 'catalog';
}

export function replayScoutAgainstCatalog(
  scout: any,
  lookup: (q: string) => CatalogHit | null = lookupCanonicalBaseFood
): GoldenJourneyRow[] {
  const items = normalizeScoutItems(scout);
  const rows: GoldenJourneyRow[] = [];

  items.forEach((item, i) => {
    const dish = dishName(item, `item ${i + 1}`);
    const comps =
      Array.isArray(item.components) && item.components.length
        ? item.components
        : [{ searchQuery: item.keyword || item.originalName || dish, volumePercentage: 100 }];

    comps.forEach((comp: any, cIdx: number) => {
      const query = String(comp.searchQuery || comp.name || comp.keyword || dish).trim();
      const hit = lookup(query);
      const matchName = hit ? String(hit.name || hit.foodType || hit.fdcId || '') : null;
      const matchId = hit?.fdcId != null ? String(hit.fdcId) : null;
      const phase = classifyCatalogHit(query, hit);
      rows.push({
        id: `j_${i}_${cIdx}_${slug(query)}`,
        dish,
        query,
        scoutIndex: i,
        componentIndex: cIdx,
        phase,
        source: hit ? 'internal_catalog' : null,
        matchId,
        matchName,
        identityPass: identityOk(phase),
        blockers: phase === 'mismatch' ? ['mismatch'] : [],
      });
    });
  });

  return rows;
}

export function catalogReplayGreen(rows: GoldenJourneyRow[]): boolean {
  return rows.length > 0 && rows.every((r) => r.identityPass);
}

/** Catalog lookup is diagnostic. It must not write all_green / status onto the case. */
export function shouldPersistReplayGreen(mode: string): boolean {
  return mode !== 'catalog';
}
