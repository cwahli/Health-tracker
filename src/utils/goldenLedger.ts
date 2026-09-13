export interface LedgerBook {
  id: string;
  label: string;
  kcal: number;
}

export interface LedgerImbalance {
  id: string;
  label: string;
  signal?: string;
  classHint?: string;
}

export function extractLedgerBooks(opts: {
  logText?: string;
  foodLog?: any;
  scout?: any[];
}): LedgerBook[] {
  const books: LedgerBook[] = [];
  const logText = opts.logText || '';

  // 1. Scout opening
  if (opts.scout && Array.isArray(opts.scout) && opts.scout.length > 0) {
    let scoutKcal = 0;
    for (const s of opts.scout) {
      if (s.rawNutritionLabel && s.rawNutritionLabel.calories) {
        const match = String(s.rawNutritionLabel.calories).match(/(\d+(?:\.\d+)?)/);
        if (match) {
          scoutKcal += parseFloat(match[1]);
        }
      } else if (typeof s.estimatedCalories === 'number') {
        scoutKcal += s.estimatedCalories;
      }
    }
    books.push({
      id: 'scout_est',
      label: 'Scout Opening Estimate',
      kcal: Math.round(scoutKcal * 10) / 10,
    });
  }

  // 2. Foundation books from logs
  if (logText) {
    const foundationRegex = /(?:\[backend\]\s*)?\[Foundation\]\s+item="([^"]+)"\s+kcal=(\d+(?:\.\d+)?)/g;
    let foundationKcal = 0;
    let fCount = 0;
    let match: RegExpExecArray | null;
    while ((match = foundationRegex.exec(logText)) !== null) {
      foundationKcal += parseFloat(match[2]);
      fCount++;
    }
    if (fCount > 0) {
      books.push({
        id: 'foundation',
        label: 'Foundation',
        kcal: Math.round(foundationKcal * 10) / 10,
      });
    }

    // 3. Reconcile books from logs
    // Check if items have reconcile
    const reconcileRegex = /(?:\[backend\]\s*)?\[Reconcile\]\s+item="([^"]+)"\s+action=([a-z_]+)\s+foundation=(\d+(?:\.\d+)?)\s+budget=(\d+(?:\.\d+)?)\s+final=(\d+(?:\.\d+)?)/g;
    const itemReconciles = new Map<string, number>();
    while ((match = reconcileRegex.exec(logText)) !== null) {
      const item = match[1];
      const finalKcal = parseFloat(match[5]);
      itemReconciles.set(item, finalKcal);
    }
    // Refused silent scale overrides final
    const refusedRegex = /(?:\[backend\]\s*)?\[Reconcile\]\s+refused silent scale for "([^"]+)"\s+—\s+keep foundation=(\d+(?:\.\d+)?)/g;
    while ((match = refusedRegex.exec(logText)) !== null) {
      const item = match[1];
      const foundKcal = parseFloat(match[2]);
      itemReconciles.set(item, foundKcal);
    }

    if (itemReconciles.size > 0) {
      let reconcileKcal = 0;
      for (const kcal of itemReconciles.values()) {
        reconcileKcal += kcal;
      }
      books.push({
        id: 'reconcile',
        label: 'Reconcile',
        kcal: Math.round(reconcileKcal * 10) / 10,
      });
    }

    // 4. Dietitian payload
    const macroTotalsMatch = logText.match(/macroTotals\s*=\s*\{[^}]*"calories"\s*:\s*(\d+(?:\.\d+)?)/);
    if (macroTotalsMatch) {
      books.push({
        id: 'dietitian_payload',
        label: 'Dietitian Payload',
        kcal: Math.round(parseFloat(macroTotalsMatch[1]) * 10) / 10,
      });
    }
  }

  // 5. Saved table from foodLog
  let savedKcal = opts.foodLog?.nutrients?.calories ?? opts.foodLog?.calories;
  if (savedKcal == null && Array.isArray(opts.foodLog?.itemsBreakdown)) {
    const sum = opts.foodLog.itemsBreakdown.reduce((acc: number, it: any) => acc + (Number(it.calories) || 0), 0);
    if (sum > 0) savedKcal = sum;
  }
  if (savedKcal != null) {
    books.push({
      id: 'saved_table',
      label: 'Saved Table',
      kcal: Math.round(Number(savedKcal) * 10) / 10,
    });
  }

  return books;
}

export function detectLedgerImbalances(opts: {
  logText?: string;
  foodLog?: any;
  scout?: any[];
}): LedgerImbalance[] {
  const imbalances: LedgerImbalance[] = [];
  const logText = opts.logText || '';
  const books = extractLedgerBooks(opts);

  const payloadBook = books.find((b) => b.id === 'dietitian_payload');
  const tableBook = books.find((b) => b.id === 'saved_table');
  const scoutBook = books.find((b) => b.id === 'scout_est');
  const foundationBook = books.find((b) => b.id === 'foundation');
  const reconcileBook = books.find((b) => b.id === 'reconcile');

  // Check Dietitian payload vs saved table
  if (payloadBook && tableBook && Math.abs(payloadBook.kcal - tableBook.kcal) > 5) {
    imbalances.push({
      id: 'ledger_dietitian_payload_vs_saved_table',
      label: `Dietitian payload (${payloadBook.kcal} kcal) != Saved Table (${tableBook.kcal} kcal)`,
      signal: 'dietitian',
      classHint: 'DISH_DROP',
    });
  }

  // Check Scout vs Saved table
  if (scoutBook && tableBook && Math.abs(scoutBook.kcal - tableBook.kcal) > 5) {
    imbalances.push({
      id: 'ledger_scout_est_vs_saved_table',
      label: `Scout Opening (${scoutBook.kcal} kcal) != Saved Table (${tableBook.kcal} kcal)`,
      signal: 'scout',
      classHint: 'OPENING_DRIFT',
    });
  }

  // Check Foundation vs Reconcile
  if (foundationBook && reconcileBook && Math.abs(foundationBook.kcal - reconcileBook.kcal) > 5) {
    imbalances.push({
      id: 'ledger_foundation_vs_reconcile',
      label: `Foundation (${foundationBook.kcal} kcal) != Reconcile (${reconcileBook.kcal} kcal)`,
      signal: 'backend',
      classHint: 'RECONCILE_DRIFT',
    });
  }

  // Check ReceiptInvariant REPAIRED
  if (logText.includes('[ReceiptInvariant] REPAIRED')) {
    imbalances.push({
      id: 'ledger_receipt_repaired',
      label: 'Receipt invariant repaired rows to item',
      signal: 'backend',
      classHint: 'SILENT_REPAIR',
    });
  }

  // Check Reconcile Scale
  if (logText.includes('action=scale')) {
    imbalances.push({
      id: 'ledger_reconcile_scale',
      label: 'Reconcile scaled item nutrients',
      signal: 'backend',
      classHint: 'SILENT_REPAIR',
    });
  }

  // Check Dietitian Rewrite
  if (
    logText.includes('[Dietitian Reality Check]') &&
    logText.includes('Reality check adjusted') &&
    !logText.includes('Heuristic checks skipped')
  ) {
    imbalances.push({
      id: 'ledger_dietitian_rewrite',
      label: 'Dietitian reality check adjusted nutrients',
      signal: 'dietitian',
      classHint: 'SILENT_REPAIR',
    });
  }

  return imbalances;
}

export function compileGoldenMeal(opts: {
  logText?: string;
  foodLog?: any;
  scout?: any[];
  replayMode?: string;
}): { mayPromote: boolean; compiler: string; imbalances: LedgerImbalance[]; books: LedgerBook[] } {
  if (opts.replayMode === 'catalog') {
    return {
      mayPromote: false,
      compiler: 'unbalanced',
      imbalances: [{ id: 'catalog_replay', label: 'Catalog replay cannot promote' }],
      books: [],
    };
  }

  const books = extractLedgerBooks(opts);
  const imbalances = detectLedgerImbalances(opts);
  const isUnbalanced = imbalances.length > 0;

  return {
    mayPromote: !isUnbalanced,
    compiler: isUnbalanced ? 'unbalanced' : 'balanced',
    imbalances,
    books,
  };
}

export function formatLedgerBrief(opts: any): string {
  const books = extractLedgerBooks(opts);
  return books.map((b) => `${b.label}: ${b.kcal} kcal`).join(' | ');
}

export function ledgerImbalancesToInvariants(imbalances: LedgerImbalance[]): any[] {
  return imbalances.map((imb) => ({
    id: imb.id,
    label: imb.label,
    source: imb.signal || 'ledger',
    passed: false,
  }));
}
