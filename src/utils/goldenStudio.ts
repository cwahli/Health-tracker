import type { GoldenOutcome, GoldenScoreboard } from './goldenScoreboard.js';

export interface StudioRedClassification {
  kind: string;
  next: string;
  youDo: string;
  note?: string;
}

export function classifyStudioRed(idOrOutcome: any, labelOrNothing?: string, extra?: any): StudioRedClassification {
  const text = (
    typeof idOrOutcome === 'string'
      ? `${idOrOutcome} ${labelOrNothing || ''} ${extra || ''}`
      : `${idOrOutcome?.id || ''} ${idOrOutcome?.label || ''} ${labelOrNothing || ''} ${extra || ''}`
  ).toLowerCase();

  if (text.includes('powerade') || text.includes('never_match') || text.includes('false_friend')) {
    return {
      kind: 'FALSE_FRIEND',
      next: 'Add negative constraint / brand guard in catalog matching',
      youDo: 'Inspect catalog bind rule and verify negative alias list',
      note: 'Avoid bind to false friend beverage/food',
    };
  }
  if (text.includes('scale') || text.includes('density') || text.includes('caloric') || text.includes('reality check')) {
    return {
      kind: 'DENSITY_SCALE',
      next: 'Refine caloric density bounds / scout portion priors',
      youDo: 'Check density bounds in dietitian reality check',
    };
  }
  if (text.includes('fallback') || text.includes('category')) {
    return {
      kind: 'RESOLVER_FALLBACK',
      next: 'Improve catalog resolution or provide verified nutrition facts',
      youDo: 'Add canonical catalog entry or alias',
    };
  }
  if (text.includes('receipt') || text.includes('repair')) {
    return {
      kind: 'RECEIPT_INVARIANT',
      next: 'Balance dish components against receipt line sum',
      youDo: 'Verify item kcal sum vs receipt soft budget',
    };
  }
  if (text.includes('anchor') || text.includes('weight')) {
    return {
      kind: 'WEIGHT_ANCHOR',
      next: 'Preserve specific user weight anchor without overwrite',
      youDo: 'Check user text explicit gram parsing',
    };
  }
  return {
    kind: 'GENERAL_RED',
    next: 'Review log trace and invariants',
    youDo: 'Investigate pipeline failure',
  };
}

export function loopRedClass(idOrOutcome: any, labelOrNothing?: string): string {
  return classifyStudioRed(idOrOutcome, labelOrNothing).kind;
}

export interface StudioLoopPlan {
  mayLoop: boolean;
  studioMayClaim: string;
  instructions: string;
  promoteGreen?: boolean;
  next?: string;
  youDo?: string;
  kind?: string;
  note?: string;
}

export function studioLoopPlan(
  outcomes: GoldenOutcome[],
  optsOrExtra?: { mealMisses?: string[]; replayMode?: string } | any,
  thirdArg?: any
): StudioLoopPlan {
  const reds = (outcomes || []).filter((o) => o.enabled !== false && !o.pass);
  const misses = (optsOrExtra && Array.isArray(optsOrExtra.mealMisses)) ? optsOrExtra.mealMisses : [];
  if (reds.length === 0 && misses.length === 0) {
    return {
      mayLoop: false,
      studioMayClaim: 'complete',
      promoteGreen: true,
      instructions: 'All checks green · Ready for commit',
      next: 'COMPLETE',
      youDo: 'Commit changes',
      kind: 'GREEN',
    };
  }

  const primaryRed = reds[0];
  const classified = primaryRed ? classifyStudioRed(primaryRed.id, primaryRed.label) : null;

  return {
    mayLoop: true,
    studioMayClaim: 'in_progress',
    promoteGreen: false,
    instructions: `Fix ${reds.length} remaining red checks${misses.length ? ` and ${misses.length} meal misses` : ''}`,
    next: classified?.next || 'Re-run tape or inspect logs',
    youDo: classified?.youDo || 'Investigate failing checks',
    kind: classified?.kind || 'GENERAL_RED',
    note: classified?.note,
  };
}

export interface GoldenChecklistItem {
  id: string;
  label: string;
  pass: boolean;
  status: 'not_fixed' | 'need_analyze' | 'accept' | 'fixed';
  expected?: any;
  actual?: any;
  youDo?: string;
  source?: string;
  group?: string;
}

export function buildGoldenChecklist(board: GoldenScoreboard): GoldenChecklistItem[] {
  const outcomes = board?.outcomes || [];
  return outcomes.map((o) => {
    let status: 'not_fixed' | 'need_analyze' | 'accept' | 'fixed' = o.pass ? 'fixed' : 'not_fixed';
    if (!o.pass) {
      if (o.kind === 'accept') status = 'accept';
      else if (o.kind === 'need_analyze' || String(o.id).includes('analyze')) status = 'need_analyze';
    }
    const classified = classifyStudioRed(o.id, o.label);
    return {
      id: o.id,
      label: o.label,
      pass: o.pass,
      status,
      expected: o.expected,
      actual: o.actual,
      youDo: classified.youDo,
      source: o.source,
      group: (o as any).group || o.kind || 'check',
    };
  });
}

export function formatGoldenShare(golden: any): string {
  if (!golden) return '';
  const title = golden.title || golden.name || 'Golden Case';
  const status = golden.all_green ? 'ALL GREEN' : `${golden.fail_count || 0} failing`;
  const checks = Array.isArray(golden.pending)
    ? golden.pending.map((p: any) => `- [${p.group || 'check'}] ${p.label}`).join('\n')
    : '';
  const meals = Array.isArray(golden.mealLines)
    ? golden.mealLines.map((m: any) => `- ${m.name}: expected ${m.expected}, current ${m.current} (${m.status})`).join('\n')
    : '';
  return `Golden Case: ${title} (${status})\nPass: ${golden.pass_count || 0}, Fail: ${golden.fail_count || 0}\nID: ${golden.id}\n\nChecks:\n${checks}\n\nMeals:\n${meals}`;
}

export function replayTapeBanner(tape: any): string {
  if (!tape) return '';
  const jobId = tape.jobId || tape.id || 'N/A';
  return `Replaying tape for job ${jobId} (deterministic local restage)`;
}
