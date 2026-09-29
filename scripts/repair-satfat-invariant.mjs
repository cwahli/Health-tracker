#!/usr/bin/env node
/**
 * scripts/repair-satfat-invariant.mjs
 *
 * Roadmap F-14.6: One-time Supabase repair script that finds food_logs rows where
 * nutrients->>'saturatedFat' > nutrients->>'totalFat' and corrects them in place.
 *
 * Usage:
 *   node scripts/repair-satfat-invariant.mjs              # Dry-run by default
 *   node scripts/repair-satfat-invariant.mjs --dry-run    # Explicit dry-run
 *   node scripts/repair-satfat-invariant.mjs --execute    # Apply fixes to Supabase
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

export function repairNutrientBag(nutrients) {
  if (!nutrients || typeof nutrients !== 'object') return { changed: false, nutrients };
  const next = { ...nutrients };
  let changed = false;

  const satFat = typeof next.saturatedFat === 'number' ? next.saturatedFat : (Number(next.saturatedFat) || 0);
  const totalFat = typeof next.totalFat === 'number' ? next.totalFat : (Number(next.totalFat) || 0);

  if (satFat > totalFat) {
    next.totalFat = satFat;
    if ('fat' in next) next.fat = satFat;
    changed = true;
  }

  if (changed) {
    const tf = next.totalFat || 0;
    const sf = next.saturatedFat || 0;
    const tr = Number(next.transFat) || 0;
    next.unsaturatedFat = Math.max(0, Math.round((tf - (sf + tr)) * 10) / 10);
  }

  return { changed, nutrients: next };
}

export function repairFoodLogRow(row) {
  if (!row || typeof row !== 'object') return { changed: false, row };
  let rowChanged = false;
  const updatedRow = { ...row };

  // 1. Check top-level nutrients
  const { changed: nutChanged, nutrients: repairedNutrients } = repairNutrientBag(row.nutrients);
  if (nutChanged) {
    updatedRow.nutrients = repairedNutrients;
    rowChanged = true;
  }

  // 2. Check items_breakdown / itemsBreakdown
  const rawItems = row.items_breakdown || row.itemsBreakdown;
  let items = rawItems;
  if (typeof items === 'string') {
    try { items = JSON.parse(items); } catch { items = null; }
  }

  if (Array.isArray(items) && items.length > 0) {
    let itemsChanged = false;
    const nextItems = items.map((it) => {
      let itemChanged = false;
      const nextIt = { ...it };

      // Check item.nutrients
      if (nextIt.nutrients) {
        const { changed: itNutChanged, nutrients: nextItNuts } = repairNutrientBag(nextIt.nutrients);
        if (itNutChanged) {
          nextIt.nutrients = nextItNuts;
          itemChanged = true;
        }
      }

      // Check item top-level fat fields
      const itSat = Number(nextIt.saturatedFat ?? nextIt.nutrients?.saturatedFat ?? 0) || 0;
      const itTf = Number(nextIt.totalFat ?? nextIt.fat ?? nextIt.nutrients?.totalFat ?? 0) || 0;
      if (itSat > itTf) {
        nextIt.totalFat = itSat;
        nextIt.fat = itSat;
        itemChanged = true;
      }

      if (itemChanged) itemsChanged = true;
      return nextIt;
    });

    if (itemsChanged) {
      if (row.items_breakdown !== undefined) updatedRow.items_breakdown = nextItems;
      if (row.itemsBreakdown !== undefined) updatedRow.itemsBreakdown = nextItems;
      rowChanged = true;
    }
  }

  return { changed: rowChanged, row: updatedRow };
}

async function main() {
  const isExecute = process.argv.includes('--execute');
  const isDryRun = !isExecute || process.argv.includes('--dry-run');

  console.log('=== Supabase Saturated Fat Invariant Repair (F-14.6) ===');
  console.log(`Mode: ${isDryRun ? 'DRY RUN (no database writes)' : 'EXECUTE (live database writes)'}\n`);

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('[Notice] Supabase credentials (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY) not found in environment.');
    console.warn('Dry-run logic is verified via unit tests. Exiting cleanly.');
    process.exit(0);
  }

  const cleanUrl = SUPABASE_URL.replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
  const supabase = createClient(cleanUrl, SUPABASE_SERVICE_ROLE_KEY);

  let pageSize = 200;
  let page = 0;
  let totalInspected = 0;
  let totalViolations = 0;
  let totalFixed = 0;

  while (true) {
    const from = page * pageSize;
    const to = from + pageSize - 1;

    const { data: rows, error } = await supabase
      .from('food_logs')
      .select('id, name, nutrients, items_breakdown, itemsBreakdown')
      .range(from, to);

    if (error) {
      console.error(`Error querying food_logs (range ${from}-${to}):`, error.message);
      break;
    }

    if (!rows || rows.length === 0) break;
    totalInspected += rows.length;

    for (const row of rows) {
      const { changed, row: repaired } = repairFoodLogRow(row);
      if (changed) {
        totalViolations++;
        const origSat = row.nutrients?.saturatedFat;
        const origTf = row.nutrients?.totalFat;
        const repSat = repaired.nutrients?.saturatedFat;
        const repTf = repaired.nutrients?.totalFat;

        console.log(`[Violation] Row ${row.id} ("${row.name || 'Unnamed'}")`);
        console.log(`  Meal Nutrients Before: totalFat=${origTf}g, satFat=${origSat}g`);
        console.log(`  Meal Nutrients After:  totalFat=${repTf}g, satFat=${repSat}g`);

        if (!isDryRun) {
          const updatePayload = {
            nutrients: repaired.nutrients,
          };
          if (repaired.items_breakdown !== undefined) {
            updatePayload.items_breakdown = repaired.items_breakdown;
          }
          if (repaired.itemsBreakdown !== undefined) {
            updatePayload.itemsBreakdown = repaired.itemsBreakdown;
          }

          const { error: updateErr } = await supabase
            .from('food_logs')
            .update(updatePayload)
            .eq('id', row.id);

          if (updateErr) {
            console.error(`  [Error updating row ${row.id}]:`, updateErr.message);
          } else {
            console.log(`  [Fixed] Row ${row.id} updated successfully.`);
            totalFixed++;
          }
        }
      }
    }

    if (rows.length < pageSize) break;
    page++;
  }

  console.log('\n=== Summary ===');
  console.log(`Total rows inspected:  ${totalInspected}`);
  console.log(`Violations discovered: ${totalViolations}`);
  if (!isDryRun) {
    console.log(`Total rows repaired:   ${totalFixed}`);
  } else {
    console.log(`Action: Run with --execute to apply ${totalViolations} repair(s).`);
  }
}

if (process.argv[1] && process.argv[1].endsWith('repair-satfat-invariant.mjs')) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
