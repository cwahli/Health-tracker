/**
 * Dump oracles & Contract evaluation — inner loop for debug observability.
 * Evaluates contracts on CanonicalRunTree (primary) and DumpFacts (legacy markdown).
 * Classifies captures without calling Gemini or POST /loop.
 * Specification: docs/agent/domains/debug-contract.md (§1, §3, §4, §5, §9).
 */

import type {
  CanonicalRunTree,
  ContractEvaluation,
  DialogInventory,
  DispatchTrace,
  HandoffTrace,
} from './debugRunTree.js';
import { NUTRIENT_KEYS } from './nutrients.js';

export type DumpFacts = {
  jobId: string | null;
  status: string | null;
  hasFinalizedLedger: boolean;
  dietitianFailedPermanently: boolean;
  matrixCalcStandby: boolean;
  breadcrumbDuplicateRows: number;
  headingDup: string[];
  diag5AutoSend: boolean;
  ledgerKcal: number | null;
  hasHappyPath: boolean;
  sessionSucceeded: boolean;
  analyzeFinishedCount: number;
  hasScoutStall: boolean;
  hasModelFallback: boolean;
  sessionFailed: boolean;
  userRetried: boolean;
  dialogInventory?: DialogInventory | null;
  contractRows?: ContractEvaluation[];
};

export type OracleFail = {
  class: string;
  id: string;
  detail: string;
  file: string;
  doNot: string;
};

export function parseDebugMarkdown(md: string): DumpFacts {
  const text = String(md || '');
  let jobId = text.match(/\*\*Job ID:\*\*\s*`([^`]+)`/)?.[1] || null;

  if (!jobId) {
    const identitySection = text.match(/^##\s*Identity\s*\n([\s\S]*?)(?=\n##\s|$)/im)?.[1] || '';
    jobId = identitySection.match(/^\s*[-*]?\s*jobId:\s*`?([^`\r\n]+)`?\s*$/im)?.[1]?.trim() || null;
  }

  const status = text.match(/\*\*Status:\*\*\s*(\S+)/)?.[1] || null;
  const hasFinalizedLedger = /\[Budget\]\s*Finalized ledger/i.test(text);
  const dietitianFailedPermanently = /Dietitian Failed Permanently/i.test(text);
  const matrixCalcStandby = /\*\*5\.\s*Mathematical Calculation Engine\*\*[^\n]*Standby/i.test(text);
  const diag5AutoSend = /\[DIAG5\]\s*auto-send effect fired/i.test(text);
  const hasHappyPath = /\[MealBuild\]\s*happy-path/i.test(text);
  const sessionSucceeded = /AnalyzeFinished succeeded|result_ready|updateJob succeeded/i.test(text);
  const analyzeFinishedCount = (text.match(/AnalyzeFinished succeeded/g) || []).length;
  const hasScoutStall = /Stream stalled:.*produced no tokens for 90s/i.test(text);
  const hasModelFallback = /falling back to gemini-3\.1-flash-lite/i.test(text);
  const sessionFailed = /JobStore\.apply updateJob failed|JobQueueRunner ServerStatus failed/i.test(text);
  const userRetried = /Retrying job |\{"label":"Retry"\}|USER CONTINUATION/i.test(text);

  const kcalHits = [...text.matchAll(/(?:Calories:|Finalized ledger[^:\n]*:)\s*(\d+(?:\.\d+)?)\s*kcal/gi)];
  const ledgerKcal = kcalHits.length ? Number(kcalHits[kcalHits.length - 1][1]) : null;

  const headingCounts = new Map<string, number>();
  for (const line of text.split('\n')) {
    const h = line.match(/^##\s+(.+)$/);
    if (!h) continue;
    const key = h[1].replace(/\s+/g, ' ').trim();
    headingCounts.set(key, (headingCounts.get(key) || 0) + 1);
  }
  const headingDup = [...headingCounts.entries()].filter(([, n]) => n > 1).map(([k]) => k);

  let breadcrumbDuplicateRows = 0;
  const crumbSeen = new Set<string>();
  for (const line of text.split('\n')) {
    const row = line.match(/^\|\s*(\d{2}:\d{2}:\d{2})\s*\|\s*([^|]+)\|/);
    if (!row) continue;
    const k = line.replace(/\s+/g, ' ').trim();
    if (crumbSeen.has(k)) breadcrumbDuplicateRows += 1;
    else crumbSeen.add(k);
  }

  // Parse Dialog Inventory snapshot if present
  let dialogInventory: DialogInventory | null = null;
  const dialogSection = text.match(/## (?:🪟 )?Modal Snapshot[^\n]*\n([\s\S]*?)(?=\n## |\n---|$)/i);
  if (dialogSection) {
    const s = dialogSection[1];
    const openMatch = s.match(/- \*\*open:\*\*\s*(true|false)/i);
    const titleMatch = s.match(/- \*\*title:\*\*\s*"([^"]+)"/i);
    const onCardMatch = s.match(/- \*\*on_card:\*\*\s*(\{[^}]+\})/i);
    const visibleMatch = s.match(/- \*\*visible:\*\*\s*\[([^\]]*)\]/i);
    const hiddenMatch = s.match(/- \*\*hidden:\*\*\s*\[([^\]]*)\]/i);
    const composerMatch = s.match(/- \*\*composer:\*\*\s*(\{[^}]+\})/i);
    const expandMatch = s.match(/- \*\*expand:\*\*\s*(.+)/i);

    let on_card;
    try { if (onCardMatch) on_card = JSON.parse(onCardMatch[1]); } catch {}
    let composer;
    try { if (composerMatch) composer = JSON.parse(composerMatch[1]); } catch {}

    dialogInventory = {
      open: openMatch ? openMatch[1].toLowerCase() === 'true' : false,
      title: titleMatch ? titleMatch[1] : undefined,
      on_card,
      visible: visibleMatch && visibleMatch[1].trim() ? visibleMatch[1].split(',').map(v => v.trim()) : [],
      hidden: hiddenMatch && hiddenMatch[1].trim() ? hiddenMatch[1].split(',').map(v => v.trim()) : [],
      composer,
      expand: expandMatch ? expandMatch[1].trim() : undefined,
    };
  }

  return {
    jobId,
    status,
    hasFinalizedLedger,
    dietitianFailedPermanently,
    matrixCalcStandby,
    breadcrumbDuplicateRows,
    headingDup,
    diag5AutoSend,
    ledgerKcal,
    hasHappyPath,
    sessionSucceeded,
    analyzeFinishedCount,
    hasScoutStall,
    hasModelFallback,
    sessionFailed,
    userRetried,
    dialogInventory,
  };
}

/**
 * Evaluates the 13 contract laws from docs/agent/domains/debug-contract.md §9.
 * Operates deterministically directly on the CanonicalRunTree.
 */
export function evaluateContracts(tree: CanonicalRunTree): ContractEvaluation[] {
  const evals: ContractEvaluation[] = [];
  const logs = tree.backendLogs || '';
  const isFoodPack = tree.pack === 'food';

  // 1. SSE {final,result}
  const isSucceeded = tree.status === 'succeeded' ||
    tree.sessionEvents.some(e => /AnalyzeFinished succeeded|result_ready|updateJob succeeded/i.test(typeof e === 'string' ? e : e?.message || e?.status || ''));
  const hasLedger = Boolean(tree.pendingFoodLog) || /\[Budget\]\s*Finalized ledger/i.test(logs);
  const hasExtracted = Boolean(tree.extractedData);
  const hasLedgerEquiv = hasLedger || (tree.pack === 'medical' && hasExtracted);

  if (isSucceeded) {
    evals.push({
      law: 'SSE {final,result}',
      layer: 'process',
      fault: 'none',
      result: 'PASS',
      actual: 'Final result emitted; job succeeded',
    });
  } else if (tree.status === 'failed') {
    const hasSalvage = /salvage/i.test(logs) || Boolean(tree.pendingFoodLog);
    if (hasSalvage) {
      evals.push({
        law: 'SSE {final,result}',
        layer: 'process',
        fault: 'none',
        result: 'PASS',
        actual: 'Salvage final result emitted despite failure',
      });
    } else {
      evals.push({
        law: 'SSE {final,result}',
        layer: 'process',
        fault: 'MISSING',
        result: 'FAIL',
        actual: 'Job terminated with failure without final result',
      });
    }
  } else if (hasLedgerEquiv && /running|queued|processing/i.test(tree.status)) {
    evals.push({
      law: 'SSE {final,result}',
      layer: 'process',
      fault: 'WRONG_TIME',
      result: 'FAIL',
      actual: `Final result computed but status remained ${tree.status}`,
    });
  } else {
    evals.push({
      law: 'SSE {final,result}',
      layer: 'process',
      fault: 'none',
      result: 'PASS',
      actual: `Status: ${tree.status}`,
    });
  }

  // 2. AnalyzeFinished count = 1 (food-only)
  if (!isFoodPack) {
    evals.push({
      law: 'AnalyzeFinished count = 1',
      layer: 'process',
      fault: 'none',
      result: 'n/a',
      actual: `Food-only law (pack=${tree.pack})`,
    });
  } else {
    let afCount = 0;
    for (const e of tree.sessionEvents) {
      const text = typeof e === 'string' ? e : `${e.status || ''} ${e.message || ''}`;
      if (/AnalyzeFinished succeeded/i.test(text)) afCount++;
    }
    if (afCount === 0 && logs) {
      afCount = (logs.match(/AnalyzeFinished succeeded/g) || []).length;
    }

    if (afCount > 1) {
      evals.push({
        law: 'AnalyzeFinished count = 1',
        layer: 'process',
        fault: 'DUPLICATE',
        result: 'FAIL',
        actual: `AnalyzeFinished succeeded x${afCount} (upsert storm)`,
      });
    } else if (afCount === 1 || isSucceeded) {
      evals.push({
        law: 'AnalyzeFinished count = 1',
        layer: 'process',
        fault: 'none',
        result: 'PASS',
        actual: 'AnalyzeFinished count = 1',
      });
    } else {
      evals.push({
        law: 'AnalyzeFinished count = 1',
        layer: 'process',
        fault: 'none',
        result: 'n/a',
        actual: 'Job has not completed AnalyzeFinished',
      });
    }
  }

  // 3. Stall/503/quota -> 3.1 hop, same job
  const hasStall = /Stream stalled:.*produced no tokens for 90s|HTTP\s*503\b|status(?:Code)?":?\s*503\b|503 Service Unavailable|RESOURCE_EXHAUSTED|\bquota\s*exceeded\b/i.test(logs) ||
    tree.console.some(c => /Stream stalled|\b(?:HTTP\s*503|status 503|RESOURCE_EXHAUSTED|quota exceeded)\b/i.test(c)) ||
    tree.network.some(n => /\b503\b/i.test(n) && !/\b(?:200|201|204)\b/i.test(n) && /error|failed/i.test(n));
  const hasFallback = /falling back to gemini-3\.1-flash-lite/i.test(logs) ||
    tree.dispatches.some(d => d.model?.includes('3.1'));

  if (!hasStall) {
    evals.push({
      law: 'Stall/503/quota -> 3.1 hop, same job',
      layer: 'process',
      fault: 'none',
      result: 'n/a',
      actual: 'No stall or 503 encountered',
    });
  } else if (hasFallback) {
    evals.push({
      law: 'Stall/503/quota -> 3.1 hop, same job',
      layer: 'process',
      fault: 'none',
      result: 'PASS',
      actual: 'Hopped to gemini-3.1-flash-lite fallback on same job',
    });
  } else {
    evals.push({
      law: 'Stall/503/quota -> 3.1 hop, same job',
      layer: 'process',
      fault: 'MISSING',
      result: 'FAIL',
      actual: 'Stalled without hopping to gemini-3.1-flash-lite on same job',
    });
  }

  // 4. Submit JSON running
  const submitQueued = /Submit JSON queued|status=queued/i.test(logs);
  if (submitQueued) {
    evals.push({
      law: 'Submit JSON running',
      layer: 'process',
      fault: 'WRONG_TIME',
      result: 'FAIL',
      actual: 'Submit JSON returned queued instead of running',
    });
  } else {
    evals.push({
      law: 'Submit JSON running',
      layer: 'process',
      fault: 'none',
      result: 'PASS',
      actual: 'Submit transitioned directly to running',
    });
  }

  // 5. pendingFoodLog -> succeeded before R2 (food-only)
  if (!isFoodPack) {
    evals.push({
      law: 'pendingFoodLog -> succeeded before R2',
      layer: 'process',
      fault: 'none',
      result: 'n/a',
      actual: `Food-only law (pack=${tree.pack})`,
    });
  } else if (hasLedger && !isSucceeded && /running|queued|processing/i.test(tree.status)) {
    evals.push({
      law: 'pendingFoodLog -> succeeded before R2',
      layer: 'process',
      fault: 'WRONG_TIME',
      result: 'FAIL',
      actual: `Ledger finalized but status remained ${tree.status} (persist lag)`,
    });
  } else if (hasLedger && isSucceeded) {
    evals.push({
      law: 'pendingFoodLog -> succeeded before R2',
      layer: 'process',
      fault: 'none',
      result: 'PASS',
      actual: 'Succeeded immediately upon finalized food log',
    });
  } else {
    evals.push({
      law: 'pendingFoodLog -> succeeded before R2',
      layer: 'process',
      fault: 'none',
      result: 'n/a',
      actual: 'No finalized food log in this run',
    });
  }

  // 6. Retry hidden if succeeded or kcal in logs
  if (!tree.dialogInventory) {
    evals.push({
      law: 'Retry hidden if succeeded or kcal in logs',
      layer: 'ui',
      fault: 'none',
      result: 'n/a',
      actual: 'No dialog inventory captured',
    });
  } else {
    const isCompleted = isSucceeded || hasLedger;
    const retryVisible = Boolean(tree.dialogInventory.visible?.some(v => /retry/i.test(v)));
    if (isCompleted && retryVisible) {
      evals.push({
        law: 'Retry hidden if succeeded or kcal in logs',
        layer: 'ui',
        fault: 'WRONG_TIME',
        result: 'FAIL',
        actual: 'Retry button visible while job is succeeded or ledger has kcal',
      });
    } else {
      evals.push({
        law: 'Retry hidden if succeeded or kcal in logs',
        layer: 'ui',
        fault: 'none',
        result: 'PASS',
        actual: retryVisible ? 'Retry visible on unfinished/failed run' : 'Retry hidden on completed run',
      });
    }
  }

  // 7. Attempt 1/3 hidden if succeeded
  if (!tree.dialogInventory) {
    evals.push({
      law: 'Attempt 1/3 hidden if succeeded',
      layer: 'ui',
      fault: 'none',
      result: 'n/a',
      actual: 'No dialog inventory captured',
    });
  } else {
    const attemptVisible = Boolean(tree.dialogInventory.visible?.some(v => /Attempt \d/i.test(v)));
    if (isSucceeded && attemptVisible) {
      evals.push({
        law: 'Attempt 1/3 hidden if succeeded',
        layer: 'ui',
        fault: 'WRONG_TIME',
        result: 'FAIL',
        actual: 'Attempt 1/3 indicator visible after job succeeded',
      });
    } else {
      evals.push({
        law: 'Attempt 1/3 hidden if succeeded',
        layer: 'ui',
        fault: 'none',
        result: 'PASS',
        actual: attemptVisible ? 'Attempt indicator visible during active retry' : 'Attempt indicator hidden',
      });
    }
  }

  // 8. Dialog on_card kcal = ledger (food-only)
  if (!isFoodPack) {
    evals.push({
      law: 'Dialog on_card kcal = ledger',
      layer: 'ui',
      fault: 'none',
      result: 'n/a',
      actual: `Food-only law (pack=${tree.pack})`,
    });
  } else if (!tree.dialogInventory?.on_card || tree.dialogInventory.on_card.kcal == null) {
    evals.push({
      law: 'Dialog on_card kcal = ledger',
      layer: 'ui',
      fault: 'none',
      result: 'n/a',
      actual: 'No on_card macros in dialog inventory',
    });
  } else {
    const cardKcal = Number(tree.dialogInventory.on_card.kcal);
    const kcalHits = [...logs.matchAll(/(?:Calories:|Finalized ledger[^:\n]*:)\s*(\d+(?:\.\d+)?)\s*kcal/gi)];
    const ledgerKcal = tree.pendingFoodLog?.nutrients?.calories ?? (kcalHits.length ? Number(kcalHits[kcalHits.length - 1][1]) : null);
    if (ledgerKcal == null) {
      evals.push({
        law: 'Dialog on_card kcal = ledger',
        layer: 'ui',
        fault: 'none',
        result: 'n/a',
        actual: `Card shows ${cardKcal} kcal; no ledger kcal found to compare`,
      });
    } else if (Math.abs(cardKcal - ledgerKcal) > 1) {
      evals.push({
        law: 'Dialog on_card kcal = ledger',
        layer: 'ui',
        fault: 'WRONG_TIME',
        result: 'FAIL',
        actual: `Dialog card shows ${cardKcal} kcal but ledger has ${ledgerKcal} kcal`,
      });
    } else {
      evals.push({
        law: 'Dialog on_card kcal = ledger',
        layer: 'ui',
        fault: 'none',
        result: 'PASS',
        actual: `Dialog card matches ledger (${cardKcal} kcal)`,
      });
    }
  }

  // 9. Composer controls count = 1
  if (!tree.dialogInventory?.composer) {
    evals.push({
      law: 'Composer controls count = 1',
      layer: 'ui',
      fault: 'none',
      result: 'n/a',
      actual: 'No composer inventory captured',
    });
  } else {
    const composer = tree.dialogInventory.composer;
    const duplicates = Object.entries(composer).filter(([_, c]) => typeof c === 'number' && c > 1);
    const missing = Object.entries(composer).filter(([_, c]) => typeof c === 'number' && c === 0);
    if (duplicates.length > 0) {
      evals.push({
        law: 'Composer controls count = 1',
        layer: 'ui',
        fault: 'DUPLICATE',
        result: 'FAIL',
        actual: `Duplicate composer controls: ${duplicates.map(([k, c]) => `${k} x${c}`).join(', ')}`,
      });
    } else if (missing.length > 0 && tree.dialogInventory.open) {
      evals.push({
        law: 'Composer controls count = 1',
        layer: 'ui',
        fault: 'MISSING',
        result: 'FAIL',
        actual: `Missing composer controls: ${missing.map(([k]) => k).join(', ')}`,
      });
    } else {
      evals.push({
        law: 'Composer controls count = 1',
        layer: 'ui',
        fault: 'none',
        result: 'PASS',
        actual: 'All composer controls count = 1',
      });
    }
  }

  // 10. DIAG5 off on food
  const isFood = tree.pack === 'food';
  const diag5Fired = /\[DIAG5\]\s*auto-send effect fired/i.test(logs) ||
    tree.sessionEvents.some(e => /\[DIAG5\]/i.test(typeof e === 'string' ? e : e?.message || ''));

  if (!isFood) {
    evals.push({
      law: 'DIAG5 off on food',
      layer: 'process',
      fault: 'none',
      result: 'n/a',
      actual: `Not a food chat job (pack=${tree.pack})`,
    });
  } else if (diag5Fired) {
    evals.push({
      law: 'DIAG5 off on food',
      layer: 'process',
      fault: 'WRONG_PLACE',
      result: 'FAIL',
      actual: 'DIAG5 auto-send effect fired on food chat',
    });
  } else {
    evals.push({
      law: 'DIAG5 off on food',
      layer: 'process',
      fault: 'none',
      result: 'PASS',
      actual: 'DIAG5 auto-send remained off for food chat',
    });
  }

  // 11. Matrix calc matches ledger (food-only)
  if (!isFoodPack) {
    evals.push({
      law: 'Matrix calc matches ledger',
      layer: 'content',
      fault: 'none',
      result: 'n/a',
      actual: `Food-only law (pack=${tree.pack})`,
    });
  } else {
    const matrixStandby = /\*\*5\.\s*Mathematical Calculation Engine\*\*[^\n]*Standby/i.test(logs);
    if (hasLedger && matrixStandby) {
      evals.push({
        law: 'Matrix calc matches ledger',
        layer: 'content',
        fault: 'MISSING',
        result: 'FAIL',
        actual: 'Pipeline matrix math Standby while logs have Finalized ledger',
      });
    } else {
      evals.push({
        law: 'Matrix calc matches ledger',
        layer: 'content',
        fault: 'none',
        result: 'PASS',
        actual: hasLedger ? 'Matrix connected and matches ledger' : 'No meal ledger required',
      });
    }
  }

  // 12. Each dispatch has model + latency_ms
  if (!tree.dispatches || tree.dispatches.length === 0) {
    evals.push({
      law: 'Each dispatch has model + latency_ms',
      layer: 'process',
      fault: 'none',
      result: 'n/a',
      actual: 'No dispatches recorded in this run',
    });
  } else {
    const invalid = tree.dispatches.filter(d => !d.model || d.latency_ms == null);
    if (invalid.length > 0) {
      evals.push({
        law: 'Each dispatch has model + latency_ms',
        layer: 'process',
        fault: 'MISSING',
        result: 'FAIL',
        actual: `${invalid.length} dispatch(es) missing model or latency_ms (${invalid.map(d => d.id).join(', ')})`,
      });
    } else {
      evals.push({
        law: 'Each dispatch has model + latency_ms',
        layer: 'process',
        fault: 'none',
        result: 'PASS',
        actual: `All ${tree.dispatches.length} dispatch(es) contain model and latency_ms`,
      });
    }
  }

  // 13. Handoff from/to + same jobId if transfer
  const transferImplied =
    tree.pack === 'receptionist' &&
    (/ready_for_handoff|handoff to (?:the )?specialist|handoff to (?:Health Coach|medical|food)/i.test(logs) ||
      tree.dispatches.some((d) => /fd→|handoff/i.test(d.id)));
  if (!tree.handoffs || tree.handoffs.length === 0) {
    if (transferImplied) {
      evals.push({
        law: 'Handoff from/to + same jobId if transfer',
        layer: 'process',
        fault: 'MISSING',
        result: 'FAIL',
        actual: 'Receptionist transfer implied but specialist handoff record is missing',
      });
    } else {
      evals.push({
        law: 'Handoff from/to + same jobId if transfer',
        layer: 'process',
        fault: 'none',
        result: 'n/a',
        actual: 'No agent handoffs in this run',
      });
    }
  } else {
    const invalid = tree.handoffs.filter(h => !h.from || !h.to || (h.jobId && h.jobId !== tree.jobId));
    if (invalid.length > 0) {
      evals.push({
        law: 'Handoff from/to + same jobId if transfer',
        layer: 'process',
        fault: 'MISSING',
        result: 'FAIL',
        actual: `${invalid.length} handoff(s) invalid or mismatched jobId (${invalid.map(h => `${h.from}->${h.to}`).join(', ')})`,
      });
    } else {
      evals.push({
        law: 'Handoff from/to + same jobId if transfer',
        layer: 'process',
        fault: 'none',
        result: 'PASS',
        actual: `All ${tree.handoffs.length} handoff(s) contain valid from/to with matching jobId`,
      });
    }
  }

  // 14. Meal scout tape belongs on food pack (WRONG_PLACE on medical / receptionist)
  if (!isFoodPack) {
    const hasScoutTape = Boolean(tree.scoutItems?.length) ||
      Boolean(tree.pendingFoodLog) ||
      tree.dispatches.some((d) => d.agent === 'scout' || /\/scout$/i.test(d.id || '')) ||
      /\[Vision Scout\]|\[Budget\]\s*Finalized ledger/i.test(logs);
    if (hasScoutTape) {
      evals.push({
        law: 'Meal scout tape off non-food pack',
        layer: 'process',
        fault: 'WRONG_PLACE',
        result: 'FAIL',
        actual: `Meal scout/ledger tape present on pack=${tree.pack}`,
      });
    } else {
      evals.push({
        law: 'Meal scout tape off non-food pack',
        layer: 'process',
        fault: 'none',
        result: 'PASS',
        actual: `No meal scout tape on pack=${tree.pack}`,
      });
    }
  }

  // 15-19. Agent-output verification (food pack): nutrients, verdict/advice,
  // dish completeness, multi-turn split visibility, mode instruction chunk.
  // DEBUG_MODE_INSTRUCTION_MARKERS is the customisation point: a new agent or
  // mode registers its required instruction markers here — no code changes
  // needed elsewhere. Non-food packs are n/a until their chunks are mapped.
  const foodEvals = evaluateFoodAgentOutput(tree, isFoodPack);
  evals.push(...foodEvals);
  evals.push(...evaluateJourneyAndBiomarker(tree));

  return evals;
}

/**
 * Mode → required instruction-chunk markers shown in the export.
 * Later agents/modes add one entry: { modes, label, markers }.
 */
export const DEBUG_MODE_INSTRUCTION_MARKERS: Array<{
  modes: string[];
  label: string;
  markers: string[];
}> = [
  {
    modes: ['evaluation', 'compare', 'compare_menu', 'compare_shelf'],
    label: 'Mode D compare',
    // Live compare path (buildScoutComparePrompt + scoutOnlyCompareInstruction)
    // never emits the old ACTIVE TASK line — that marker only exists in the
    // meal-path builder. Match the string the dispatched instruction holds.
    markers: ['evaluating competing food options (Mode D)'],
  },
  {
    modes: ['modify', 'edit'],
    label: 'Edit patch',
    markers: ['TARGETED DISH UPDATE ONLY'],
  },
  {
    modes: ['receptionist', 'front_desk', 'frontdesk', 'general_receptionist'],
    label: 'Front Desk triage',
    markers: ['You are the Receptionist and Onboarding AI Specialist'],
  },
  {
    modes: ['medical', 'biomarker', 'biomarker_review', 'lab'],
    label: 'Medical lab review',
    markers: ['You are an expert clinical laboratory AI'],
  },
  {
    modes: ['health_coach', 'healthcoach', 'health_baseline'],
    label: 'Health coach',
    markers: ['You are a clinical AI Health Coach'],
  },
  {
    modes: ['*'],
    label: 'Meal scout',
    markers: ['QUANTITY & MULTIPACKS'],
  },
];

const DISH_REQUIRED_FIELDS = [
  'dishName', 'estimatedWeightGrams', 'sourceImageIndex', 'boundingBox2D', 'foods', 'dishNutrients',
];

function dishCompleteness(dish: any): string[] {
  const missing: string[] = [];
  if (!dish || typeof dish !== 'object') return [...DISH_REQUIRED_FIELDS, '(no dish)'];
  if (!dish.dishName) missing.push('dishName');
  if (!Number.isFinite(Number(dish.estimatedWeightGrams))) missing.push('estimatedWeightGrams');
  if (!Number.isInteger(dish.sourceImageIndex)) missing.push('sourceImageIndex');
  if (!Array.isArray(dish.boundingBox2D) || dish.boundingBox2D.length !== 4) missing.push('boundingBox2D');
  if (!Array.isArray(dish.foods) || dish.foods.length === 0) missing.push('foods');
  if (!dish.dishNutrients || typeof dish.dishNutrients !== 'object') missing.push('dishNutrients');
  return missing;
}

function evaluateJourneyAndBiomarker(tree: CanonicalRunTree): ContractEvaluation[] {
  const out: ContractEvaluation[] = [];
  const pass = (law: string, actual: string) =>
    out.push({ law, layer: 'content', fault: 'none', result: 'PASS', actual });
  const fail = (law: string, actual: string) =>
    out.push({ law, layer: 'content', fault: 'MISSING', result: 'FAIL', actual });
  const na = (law: string, actual: string) =>
    out.push({ law, layer: 'content', fault: 'none', result: 'n/a', actual });
  const isFoodPack = tree.pack === 'food';

  // 20. Handoff chain complete (all packs): forwarded legs must resolve
  // their parent job; dropped payload keys fail.
  {
    const hs = tree.handoffs || [];
    if (hs.length === 0) {
      out.push({ law: 'Handoff chain complete', layer: 'process', fault: 'none', result: 'n/a', actual: 'No handoffs in this run' });
    } else {
      const linkedIds = new Set((tree.linkedJobs || []).map((j) => j.id));
      const dropped = hs.filter((h) => Array.isArray(h.keysDropped) && h.keysDropped.length > 0);
      const unlinked = hs.filter((h) => {
        const fromId = (h.received as any)?.fromJobId;
        return fromId && !linkedIds.has(fromId) && fromId !== tree.jobId;
      });
      if (dropped.length > 0) {
        out.push({ law: 'Handoff chain complete', layer: 'process', fault: 'MISSING', result: 'FAIL', actual: `Keys dropped in transfer: ${dropped.map((h) => `${h.from}->${h.to} (${h.keysDropped!.join(',')})`).join('; ')}` });
      } else if (unlinked.length > 0) {
        out.push({ law: 'Handoff chain complete', layer: 'process', fault: 'MISSING', result: 'FAIL', actual: `Parent job(s) unresolvable: ${unlinked.map((h) => (h.received as any)?.fromJobId).join(', ')}` });
      } else {
        out.push({ law: 'Handoff chain complete', layer: 'process', fault: 'none', result: 'PASS', actual: `${hs.length} handoff(s) linked (${hs.map((h) => `${h.from}->${h.to}`).join(', ')})` });
      }
    }
  }

  // 21. Handoff received (food legs of a forwarded journey).
  {
    const foodHandoff = (tree.handoffs || []).find((h) => String(h.to || '').toLowerCase() === 'food');
    if (!foodHandoff && tree.pack !== 'food') {
      out.push({ law: 'Handoff received', layer: 'content', fault: 'none', result: 'n/a', actual: `No food handoff in this run (pack=${tree.pack})` });
    } else if (!foodHandoff) {
      out.push({ law: 'Handoff received', layer: 'content', fault: 'none', result: 'n/a', actual: 'Direct food log, no forwarded handoff' });
    } else {
      const keys = (foodHandoff.received as any)?.keysForwarded;
      if (Array.isArray(keys) && keys.length > 0) {
        out.push({ law: 'Handoff received', layer: 'content', fault: 'none', result: 'PASS', actual: `Payload keys carried: ${keys.join(', ')}` });
      } else {
        out.push({ law: 'Handoff received', layer: 'content', fault: 'MISSING', result: 'FAIL', actual: 'Food leg has no received payload keys recorded' });
      }
    }
  }

  // 22-23. Biomarker pack: lab panel + clinical report (mirrors nutrients/verdict).
  if (tree.pack !== 'medical') {
    out.push({ law: 'Lab panel complete', layer: 'content', fault: 'none', result: 'n/a', actual: `Medical-only law (pack=${tree.pack})` });
    out.push({ law: 'Clinical report shown', layer: 'content', fault: 'none', result: 'n/a', actual: `Medical-only law (pack=${tree.pack})` });
  } else {
    const panel = tree.extractedData;
    if (!panel || typeof panel !== 'object' || Object.keys(panel).length === 0) {
      out.push({ law: 'Lab panel complete', layer: 'content', fault: 'none', result: 'n/a', actual: 'No extracted panel in this run' });
    } else {
      const bad = Object.entries(panel).filter(([, v]) => v == null || (typeof v === 'number' && !Number.isFinite(v)));
      if (bad.length === 0) {
        out.push({ law: 'Lab panel complete', layer: 'content', fault: 'none', result: 'PASS', actual: `${Object.keys(panel).length} analyte(s) extracted` });
      } else {
        out.push({ law: 'Lab panel complete', layer: 'content', fault: 'MISSING', result: 'FAIL', actual: `Non-computed analytes: ${bad.map(([k]) => k).join(', ')}` });
      }
    }
    const report = (tree as any).report;
    if (report && (typeof report === 'object' ? Object.keys(report).length > 0 : String(report).trim().length > 0)) {
      out.push({ law: 'Clinical report shown', layer: 'content', fault: 'none', result: 'PASS', actual: 'Clinical report present' });
    } else {
      out.push({ law: 'Clinical report shown', layer: 'content', fault: 'none', result: 'n/a', actual: 'No report in this run' });
    }
  }


  return out;
}

function evaluateFoodAgentOutput(tree: CanonicalRunTree, isFoodPack: boolean): ContractEvaluation[] {
  const out: ContractEvaluation[] = [];
  const pass = (law: string, actual: string) =>
    out.push({ law, layer: 'content', fault: 'none', result: 'PASS', actual });
  const fail = (law: string, actual: string) =>
    out.push({ law, layer: 'content', fault: 'MISSING', result: 'FAIL', actual });
  const na = (law: string, actual: string) =>
    out.push({ law, layer: 'content', fault: 'none', result: 'n/a', actual });
  if (!isFoodPack) {
    na('Agent output: nutrients complete', `Food-only law (pack=${tree.pack})`);
    na('Agent output: verdict + advice', `Food-only law (pack=${tree.pack})`);
    na('Dishes: fields populated', `Food-only law (pack=${tree.pack})`);
    na('Multi-turn split shown', `Food-only law (pack=${tree.pack})`);
    na('Mode instruction chunk', `Food-only law (pack=${tree.pack})`);
    na('Edit patch: components & nutrients preserved', `Food-only law (pack=${tree.pack})`);
    return out;
  }

  // 15. Nutrients: every key present with a finite number. Zeros are legal
  // computed values (e.g. transFat 0) — they are counted, never failed.
  const ledgerNuts = tree.pendingFoodLog?.nutrients;
  if (!ledgerNuts || typeof ledgerNuts !== 'object') {
    na('Agent output: nutrients complete', 'No finalized ledger in this run');
  } else {
    const bad = NUTRIENT_KEYS.filter(
      (k) => !Number.isFinite(Number((ledgerNuts as any)[k]))
    );
    const zeros = NUTRIENT_KEYS.filter((k) => Number((ledgerNuts as any)[k]) === 0).length;
    if (bad.length === 0) {
      pass('Agent output: nutrients complete', `All ${NUTRIENT_KEYS.length} keys finite (${zeros} legal zeros)`);
    } else {
      fail('Agent output: nutrients complete', `Non-computed keys: ${bad.join(', ')}`);
    }
  }

  // 16. Verdict + advice, PER TURN. Every turn that showed the patient a
  // meal message must have a recorded dispatch carrying verdict label/level
  // + advice text — the old any-emission check passed runs whose clarify
  // turn had no advice row at all. Turns are grouped by `turn`, falling back
  // to the tN id prefix; rows with no determinable turn are ignored (legacy
  // and synthetic rows carry none). Discussion/evaluation turns show no meal
  // card and are skipped. Agent-agnostic: scout, narrator, or projector rows
  // all count — there is no dietitian agent.
  const NON_MEAL_TURN_MODES = new Set(['discussion', 'evaluation', 'compare', 'compare_menu', 'compare_shelf']);
  const turnOf = (d: any): number | null => {
    if (Number.isInteger(d?.turn) && (d.turn as number) > 0) return d.turn as number;
    const m = /^t(\d+)\b/i.exec(String(d?.id || ''));
    return m ? Number(m[1]) : null;
  };
  const adviceTextOf = (o: any): string => String(o?.clinicalAdvice || o?.message || '');
  const adviceWordsOf = (o: any): number => adviceTextOf(o).trim().split(/\s+/).filter(Boolean).length;
  const coversTurn = (o: any): boolean => {
    if (!o || typeof o !== 'object') return false;
    if (!o?.verdict?.label || !o?.verdict?.level) return false;
    const w = adviceWordsOf(o);
    return w >= 35 && w <= 70;
  };
  const turnGroups = new Map<number, any[]>();
  for (const d of tree.dispatches || []) {
    const t = turnOf(d);
    if (t == null) continue;
    if (!turnGroups.has(t)) turnGroups.set(t, []);
    turnGroups.get(t)!.push(d);
  }
  const mealTurns = [...turnGroups.entries()].filter(([, rows]) =>
    rows.some((d) => !NON_MEAL_TURN_MODES.has(String(d?.received?.mode || 'new_log').toLowerCase()))
  );
  if (mealTurns.length === 0) {
    na('Agent output: verdict + advice', 'No turn-attributed meal dispatches in this run');
  } else {
    const bare = mealTurns
      .filter(([, rows]) => {
        const emissions = rows.map((d) => d?.rawEmission || d?.output).filter((o) => o && typeof o === 'object');
        return !emissions.some(coversTurn);
      })
      .map(([t, rows]) => `t${t} (rows: ${rows.map((d: any) => d?.id || '?').join(', ')})`);
    if (bare.length === 0) {
      const detail = mealTurns.map(([t, rows]) => {
        const emissions = rows.map((d) => d?.rawEmission || d?.output).filter((o) => o && typeof o === 'object');
        const good = emissions.find(coversTurn);
        const w = adviceWordsOf(good);
        const figures = (adviceTextOf(good).match(/\d+(\.\d+)?\s*(kcal|g|mg|%)/gi) || []).length;
        return `t${t}: "${good.verdict.label}" [${good.verdict.level}], ${w} words, ${figures} figure(s)`;
      }).join('; ');
      pass('Agent output: verdict + advice', `Every meal turn covered — ${detail}`);
    } else {
      fail('Agent output: verdict + advice', `Turn(s) with no verdict+advice row: ${bare.join('; ')}`);
    }
  }

  // 17. Dishes: at least one fully populated dish in any agent emission.
  const dishEmissions = (tree.dispatches || [])
    .map((d) => d?.rawEmission || d?.output)
    .filter((o) => o && typeof o === 'object');
  const allDishes = dishEmissions.flatMap((o) => (Array.isArray(o?.dishes) ? o.dishes : []));
  if (allDishes.length === 0) {
    na('Dishes: fields populated', 'No dishes in any agent emission');
  } else {
    const full = allDishes.filter((d) => dishCompleteness(d).length === 0);
    if (full.length > 0) {
      pass('Dishes: fields populated', `${full.length}/${allDishes.length} dish(es) fully populated (${full.map((d: any) => d.dishName).slice(0, 5).join(', ')})`);
    } else {
      const sample = dishCompleteness(allDishes[0]).join(', ');
      fail('Dishes: fields populated', `0/${allDishes.length} complete; first dish missing: ${sample}`);
    }
  }

  // 18. Multi-turn split: if the run paused or carries a portion question,
  // the export must show it; single-turn runs are n/a.
  const clarifyPayload =
    tree.pendingFoodLog?.portionClarify ||
    dishEmissions.map((o) => o?.portionClarify).find((p) => p && typeof p === 'object');
  const hasSecondTurn = (tree.dispatches || []).some(
    (d) => Number(d?.turn) > 1 || /^t[2-9]\b/i.test(String(d?.id || ''))
  );
  const splitState = tree.status === 'awaiting_user' || Boolean(clarifyPayload) || hasSecondTurn;
  if (!splitState) {
    na('Multi-turn split shown', 'Single-turn run, no split state');
  } else if (!clarifyPayload && tree.status === 'awaiting_user') {
    fail('Multi-turn split shown', 'Paused awaiting_user with no portion-question payload captured');
  } else if (clarifyPayload) {
    const items = Array.isArray((clarifyPayload as any).items) ? (clarifyPayload as any).items.length : 0;
    pass('Multi-turn split shown', `Portion question captured (${items} item(s))${hasSecondTurn ? '; second turn dispatched' : ''}`);
  } else {
    pass('Multi-turn split shown', 'Second turn dispatched');
  }

  // 19. Mode instruction chunk: every mode present in the run must show its
  // chunk (customise via DEBUG_MODE_INSTRUCTION_MARKERS). Unknown modes fall
  // back to the '*' scout entry. Scan the full dispatched text per dispatch
  // (system + instruction + user prompt): on edit turns the TARGETED DISH
  // UPDATE ONLY block rides in the user prompt while systemInstruction stays
  // the generic scout schema — first-nonempty field selection hid it and
  // failed every weight-only edit.
  const instructions = (tree.dispatches || [])
    .map((d) => [d?.systemInstruction, d?.instruction, d?.userPrompt].filter((s) => typeof s === 'string' && s.length > 0).join('\n'))
    .filter(Boolean);
  if (instructions.length === 0) {
    na('Mode instruction chunk', 'No instructions captured in this run');
  } else {
    const modesPresent = new Set(
      (tree.dispatches || []).map((d) => String(d?.received?.mode || 'new_log').toLowerCase())
    );
    const specific = DEBUG_MODE_INSTRUCTION_MARKERS.filter(
      (e) => !e.modes.includes('*') && e.modes.some((m) => modesPresent.has(m.toLowerCase()))
    );
    const required = specific.length > 0
      ? specific
      : DEBUG_MODE_INSTRUCTION_MARKERS.filter((e) => e.modes.includes('*'));
    const missing: string[] = [];
    for (const entry of required) {
      for (const m of entry.markers) {
        if (!instructions.some((s) => s.includes(m))) missing.push(`${entry.label}: ${m}`);
      }
    }
    if (missing.length === 0) {
      pass('Mode instruction chunk', `${required.map((e) => e.label).join(' + ')} chunk(s) shown for mode(s)=${[...modesPresent].join(',')}`);
    } else {
      fail('Mode instruction chunk', `Missing chunk(s): ${missing.join('; ')}`);
    }
  }

  // 20. Edit patch: components & nutrients preserved.
  // When an edit or modification turn has occurred, verify:
  // (a) No component wipeout (e.g. composite dish reduced to single ingredient without deletion instruction)
  // (b) Full nutrients populated for edited/new items
  // (c) Untouched dishes preserved
  // Single-turn create runs evaluate to n/a.
  const editDispatches = (tree.dispatches || []).filter(
    (d) => Number(d?.turn) > 1 ||
      /^t[2-9]\b/i.test(String(d?.id || '')) ||
      String(d?.received?.mode || '').toLowerCase() === 'edit' ||
      String(d?.received?.mode || '').toLowerCase() === 'modify' ||
      /User modification instruction/i.test(d?.userPrompt || d?.instruction || '')
  );
  const isEditRun = editDispatches.length > 0 ||
    /\[MealEdit\]|applyMealEdits|diffScoutToEditCommands/i.test(tree.backendLogs || '') ||
    tree.breadcrumbs.some((b) => /edit_meal|modify|patch_ledger/i.test(b.action || ''));

  if (!isEditRun) {
    na('Edit patch: components & nutrients preserved', 'Single-turn create, no edit turns');
  } else {
    const pfl = tree.pendingFoodLog;
    const dishes: any[] = Array.isArray(pfl?.dishes) && pfl.dishes.length > 0
      ? pfl.dishes
      : (Array.isArray(pfl?.itemsBreakdown) && pfl.itemsBreakdown.length > 0
        ? pfl.itemsBreakdown
        : (Array.isArray(pfl?.items) ? pfl.items : []));

    const collapsedDishes = dishes.filter((d) => {
      const foods = Array.isArray(d?.foods) ? d.foods : (Array.isArray(d?.components) ? d.components : []);
      const isComposite = /hotpot|platter|plate|sizzling|curry|combo|bowl|soup|stew/i.test(d?.name || d?.dishName || '');
      return isComposite && foods.length === 1 && (Number(d?.weightGrams || d?.estimatedWeightGrams) || 0) < 150;
    });

    const dishesWithEmptyNutrients = dishes.filter((d) => {
      const nuts = d?.nutrients || d?.dishNutrients;
      const cal = nuts?.calories ?? d?.calories;
      const pro = nuts?.protein ?? d?.protein;
      return !Number.isFinite(Number(cal)) || !Number.isFinite(Number(pro));
    });

    if (dishes.length === 0 && !/remove_item|deleted all/i.test(tree.backendLogs || '')) {
      fail('Edit patch: components & nutrients preserved', 'No dishes remaining after edit');
    } else if (collapsedDishes.length > 0) {
      const names = collapsedDishes.map((d) => d?.name || d?.dishName).join(', ');
      fail('Edit patch: components & nutrients preserved', `Component wipeout detected: ${names} collapsed to single ingredient`);
    } else if (dishesWithEmptyNutrients.length > 0) {
      const names = dishesWithEmptyNutrients.map((d) => d?.name || d?.dishName).join(', ');
      fail('Edit patch: components & nutrients preserved', `Dishes with missing nutrients: ${names}`);
    } else {
      const totalComps = dishes.reduce((acc, d) => acc + (Array.isArray(d?.foods) ? d.foods.length : (Array.isArray(d?.components) ? d.components.length : 1)), 0);
      pass('Edit patch: components & nutrients preserved', `${dishes.length} dish(es) with ${totalComps} component(s) preserved with full nutrients`);
    }
  }

  return out;
}

function isCanonicalRunTree(obj: any): obj is CanonicalRunTree {
  return obj && typeof obj === 'object' && Array.isArray(obj.contract) && 'pack' in obj;
}

export function classifyDump(factsOrTree: DumpFacts | CanonicalRunTree): OracleFail[] {
  const fails: OracleFail[] = [];

  if (!factsOrTree || typeof factsOrTree !== 'object') {
    return fails;
  }

  if (isCanonicalRunTree(factsOrTree)) {
    const tree = factsOrTree;
    const logs = tree.backendLogs || '';
    const hasFinalizedLedger = Boolean(tree.pendingFoodLog) || /\[Budget\]\s*Finalized ledger/i.test(logs);
    const dietitianFailedPermanently = /Dietitian Failed Permanently/i.test(logs);
    const hasExtracted = Boolean(tree.extractedData);
    const stillRunning = Boolean(tree.status && /running|queued|processing/i.test(tree.status));

    if (hasFinalizedLedger && dietitianFailedPermanently && stillRunning) {
      fails.push({
        class: 'DEGRADE_NOT_TERMINAL',
        id: 'JOB_TERMINAL_IF_LEDGER',
        detail: `status=${tree.status} after Finalized ledger + Dietitian Failed Permanently`,
        file: 'server_food_analyze_run.ts, server_sse_json.ts, serverJobs.ts persist',
        doNot: 'expected.json, ReceptionistCard, LogChat rewrite, FoodCard',
      });
    }
    if (tree.pack === 'medical' && hasExtracted && stillRunning) {
      fails.push({
        class: 'DEGRADE_NOT_TERMINAL',
        id: 'JOB_TERMINAL_IF_LEDGER',
        detail: `status=${tree.status} after extractedData present (medical salvage not terminal)`,
        file: 'serverJobs.ts publishResultReady, server_sse_json.ts',
        doNot: 'paint G-B1 all_green, live Gemini',
      });
    }

    // Map any failed contract evaluations directly to OracleFails
    for (const c of tree.contract) {
      if (c.result !== 'FAIL') continue;

      if (c.law === 'Matrix calc matches ledger') {
        fails.push({
          class: 'DEBUG_MISS',
          id: 'DEBUG_MATCHES_LOG',
          detail: c.actual,
          file: 'src/utils/debugPayload.ts',
          doNot: 'FoodCard layout, catalog aliases',
        });
      } else if (c.law === 'DIAG5 off on food') {
        fails.push({
          class: 'SIBLING_EFFECT',
          id: 'NO_FOREIGN_EFFECT',
          detail: c.actual,
          file: 'src/utils/chatAutoSend.ts, LogChat.tsx auto-send effect',
          doNot: 'server_food_analyze_run.ts, expected.json',
        });
      } else if (c.law === 'pendingFoodLog -> succeeded before R2') {
        fails.push({
          class: 'DISPLAY_LAG',
          id: 'RESULT_READY_BEFORE_PERSIST',
          detail: c.actual,
          file: 'serverJobs.ts publishResultReady, JobQueueRunner (complete once)',
          doNot: 'expected.json, FoodCard rewrite, live Gemini retry',
        });
      } else if (c.law === 'AnalyzeFinished count = 1') {
        fails.push({
          class: 'COMPLETE_ONCE',
          id: 'ANALYZE_FINISHED_ONCE',
          detail: c.actual,
          file: 'src/jobs/JobQueueRunner.ts inFlightIds + skip if already succeeded',
          doNot: 'POST /loop, extra persist',
        });
      } else if (c.law === 'Stall/503/quota -> 3.1 hop, same job') {
        fails.push({
          class: 'STALL_NO_FALLBACK',
          id: 'STALL_FALLBACK_SAME_JOB',
          detail: c.actual,
          file: 'server_gemini_retry.ts nextGeminiFallbackEngine, serverJobs.ts loopback retry',
          doNot: 'expected.json, live Gemini inner loop, POST /loop, FoodCard rewrite',
        });
      } else if (c.law === 'Dialog on_card kcal = ledger') {
        fails.push({
          class: 'DISPLAY_LAG',
          id: 'UI_ON_CARD_MISMATCH',
          detail: c.actual,
          file: 'src/components/LogChat.tsx, src/utils/debugPayload.ts',
          doNot: 'Rewrite FoodCard',
        });
      } else if (c.law === 'Composer controls count = 1') {
        fails.push({
          class: 'DEBUG_DUP',
          id: 'UI_COMPOSER_CONTROLS',
          detail: c.actual,
          file: 'src/components/LogChat.tsx',
          doNot: 'Delete controls',
        });
      } else if (c.law === 'Each dispatch has model + latency_ms') {
        fails.push({
          class: 'DEBUG_MISS',
          id: 'DISPATCH_SIGNALS_MISSING',
          detail: c.actual,
          file: 'src/utils/debugRunTree.ts, serverJobs.ts',
          doNot: 'Mock latencies',
        });
      } else if (c.law === 'Handoff from/to + same jobId if transfer') {
        fails.push({
          class: 'DEBUG_MISS',
          id: 'HANDOFF_CONTRACT_MISSING',
          detail: c.actual,
          file: 'src/utils/debugRunTree.ts, serverJobs.ts',
          doNot: 'Drop handoff context',
        });
      } else if (c.law === 'Submit JSON running') {
        fails.push({
          class: 'QUEUE_LIE',
          id: 'SUBMIT_NOT_QUEUED',
          detail: c.actual,
          file: 'src/components/LogChat.tsx, serverJobs.ts',
          doNot: 'Clobber running state',
        });
      } else if (c.law === 'SSE {final,result}' && c.fault === 'WRONG_TIME') {
        fails.push({
          class: 'DEGRADE_NOT_TERMINAL',
          id: 'JOB_TERMINAL_IF_LEDGER',
          detail: c.actual,
          file: 'server_food_analyze_run.ts, server_sse_json.ts, serverJobs.ts persist',
          doNot: 'expected.json, ReceptionistCard, LogChat rewrite, FoodCard',
        });
      } else if (c.law === 'Meal scout tape off non-food pack') {
        fails.push({
          class: 'WRONG_PLACE',
          id: 'SCOUT_ON_NON_FOOD',
          detail: c.actual,
          file: 'src/utils/debugRunTree.ts, src/utils/dumpContract.ts',
          doNot: 'Score food scout laws on medical/receptionist packs',
        });
      } else if (c.law === 'Edit patch: components & nutrients preserved') {
        fails.push({
          class: 'DISH_DROP',
          id: 'EDIT_COMPONENT_PRESERVED',
          detail: c.actual,
          file: 'server_edit_patch_ledger.ts, server_meal_edit.ts',
          doNot: 'Component wipeout, catalog alias hack',
        });
      }
    }

    return fails;
  }

  // Fallback for legacy DumpFacts (e.g. from historical captures)
  const facts = factsOrTree;
  if (facts.hasFinalizedLedger && facts.dietitianFailedPermanently && facts.status && /running|queued|processing/i.test(facts.status)) {
    fails.push({
      class: 'DEGRADE_NOT_TERMINAL',
      id: 'JOB_TERMINAL_IF_LEDGER',
      detail: `status=${facts.status} after Finalized ledger + Dietitian Failed Permanently`,
      file: 'server_food_analyze_run.ts, server_sse_json.ts, serverJobs.ts persist',
      doNot: 'expected.json, ReceptionistCard, LogChat rewrite, FoodCard',
    });
  }
  if (facts.hasFinalizedLedger && facts.matrixCalcStandby) {
    fails.push({
      class: 'DEBUG_MISS',
      id: 'DEBUG_MATCHES_LOG',
      detail: 'pipeline matrix math Standby while logs have Finalized ledger',
      file: 'src/utils/debugPayload.ts',
      doNot: 'FoodCard layout, catalog aliases',
    });
  }
  if (facts.breadcrumbDuplicateRows > 0) {
    fails.push({
      class: 'DEBUG_DUP',
      id: 'HEADING_ONCE',
      detail: `${facts.breadcrumbDuplicateRows} duplicate breadcrumb row(s)`,
      file: 'src/utils/debugPayload.ts',
      doNot: 'G1 expected.json',
    });
  }
  if (Array.isArray(facts.headingDup) && facts.headingDup.length) {
    fails.push({
      class: 'DEBUG_DUP',
      id: 'HEADING_ONCE',
      detail: `duplicate ## ${facts.headingDup.join(', ')}`,
      file: 'src/utils/debugPayload.ts',
      doNot: 'G1 expected.json',
    });
  }
  if (facts.diag5AutoSend) {
    fails.push({
      class: 'SIBLING_EFFECT',
      id: 'NO_FOREIGN_EFFECT',
      detail: 'DIAG5 auto-send fired (Front Desk handoff effect) on this food dump',
      file: 'src/utils/chatAutoSend.ts, LogChat.tsx auto-send effect',
      doNot: 'server_food_analyze_run.ts, expected.json',
    });
  }
  if (facts.hasHappyPath && (facts.hasFinalizedLedger || facts.ledgerKcal != null) && !facts.sessionSucceeded) {
    fails.push({
      class: 'DISPLAY_LAG',
      id: 'RESULT_READY_BEFORE_PERSIST',
      detail: `happy-path + ${facts.ledgerKcal} kcal in dump but session never succeeded — poller waited on R2/upsert`,
      file: 'serverJobs.ts publishResultReady, JobQueueRunner (complete once)',
      doNot: 'expected.json, FoodCard rewrite, live Gemini retry',
    });
  }
  if (facts.analyzeFinishedCount > 1) {
    fails.push({
      class: 'COMPLETE_ONCE',
      id: 'ANALYZE_FINISHED_ONCE',
      detail: `AnalyzeFinished succeeded x${facts.analyzeFinishedCount} (upsert storm)`,
      file: 'src/jobs/JobQueueRunner.ts inFlightIds + skip if already succeeded',
      doNot: 'POST /loop, extra persist',
    });
  }
  if (facts.hasScoutStall && !facts.hasModelFallback && (facts.sessionFailed || facts.userRetried || !facts.sessionSucceeded)) {
    fails.push({
      class: 'STALL_NO_FALLBACK',
      id: 'STALL_FALLBACK_SAME_JOB',
      detail: 'Vision Scout 90s stall failed the job / forced Retry — did not hop to gemini-3.1-flash-lite on the same job',
      file: 'server_gemini_retry.ts nextGeminiFallbackEngine, serverJobs.ts loopback retry',
      doNot: 'expected.json, live Gemini inner loop, POST /loop, FoodCard rewrite',
    });
  }
  return fails;
}

export function formatOracleFails(fails: OracleFail[]): string {
  if (!fails.length) return 'dump oracles: none (capture is not a classified red)\n';
  return fails
    .map(
      (f) =>
        `${f.id}  ${f.detail}\n  class: ${f.class}\n  file:  ${f.file}\n  do not: ${f.doNot}`
    )
    .join('\n\n');
}
