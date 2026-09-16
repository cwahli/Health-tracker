/**
 * Canonical JSON Run Tree for debug observability and contract evaluation.
 * Durable specification: docs/agent/domains/debug-contract.md (§4, §5, §6, §7, §8).
 * R2 cold debug export is this canonical JSON; Markdown is a rendered view.
 */

import type { DebugReportInput } from './debugPayload.js';
import { evaluateContracts } from './dumpContract.js';

export type ContractFault = 'MISSING' | 'DUPLICATE' | 'WRONG_PLACE' | 'WRONG_TIME' | 'WRONG_COUNT' | 'none';
export type ContractLayer = 'process' | 'ui' | 'content';
export type ContractResult = 'PASS' | 'FAIL' | 'n/a';

export interface ContractEvaluation {
  law: string;
  layer: ContractLayer;
  fault: ContractFault;
  result: ContractResult;
  actual: string;
}

export interface DialogInventory {
  open: boolean;
  title?: string;
  on_card?: {
    kcal?: number | null;
    protein?: number | null;
    carbs?: number | null;
    fat?: number | null;
  };
  visible?: string[];
  hidden?: string[];
  composer?: {
    photo?: number;
    add_image?: number;
    paste?: number;
    send?: number;
    [key: string]: number | undefined;
  };
  expand?: string | boolean;
}

export interface DispatchTrace {
  id: string; // e.g. "t1/scout", "t1/curator", "fd/front_desk"
  parent?: string | null;
  turn?: number | string;
  agent?: string;
  user?: string;
  received?: any;
  systemInstruction?: string;
  userPrompt?: string;
  instruction?: string;
  output?: any;
  /** Raw agent emission before pipeline transforms (e.g. scout dishes[]); working copy stays in `output`. */
  rawEmission?: any;
  /** False when the stage ran without dispatching an LLM call (projector path). */
  called?: boolean;
  /** Human note, e.g. why model/latency are absent. */
  note?: string;
  model?: string | null;
  latency_ms?: number | null;
  tokens?: number;
  error?: string | null;
}

export interface HandoffTrace {
  from: string;
  to: string;
  received?: any;
  keysDropped?: string[];
  jobId: string;
}

export type PortionAdjustmentTrace = {
  type: 'local_math' | 'agent_edit';
  diffPercent: number;
  fromWeight: number;
  toWeight: number;
  agentCalled: boolean;
  reason: string;
};

export interface CanonicalRunTree {
  jobId: string;
  conversationId?: string | null;
  pack: 'food' | 'receptionist' | 'medical' | 'health_coach';
  status: string;
  exportedAt: string;
  dialogInventory?: DialogInventory | null;
  lastUserAction?: any;
  breadcrumbs: any[];
  sessionEvents: any[];
  console: string[];
  network: string[];
  handoffs: HandoffTrace[];
  dispatches: DispatchTrace[];
  contract: ContractEvaluation[];
  portionAdjustment?: PortionAdjustmentTrace | null;
  /** Linked jobs of a forwarded journey (resolved by the export caller). */
  linkedJobs?: Array<{ id: string; kind?: string; status?: string; mode?: string }>;
  // Retained payload attributes for tooling / views
  pendingFoodLog?: any;
  scoutItems?: any[];
  receiptTable?: any;
  rawScout?: any;
  backendLogs?: string;
  extractedData?: any;
  /** Clinical/health-coach report output (medical pack verification). */
  report?: any;
  comparisonData?: any;
}

/** Determines which operational pack this run belongs to */
export function determinePack(input: Partial<DebugReportInput>): 'food' | 'receptionist' | 'medical' | 'health_coach' {
  if (input.pack) return input.pack;
  const agent = String(input.agentType || '').toLowerCase();
  const mode = String(input.mode || '').toLowerCase();
  if (agent === 'front_desk' || /receptionist|front.?desk/i.test(mode)) return 'receptionist';
  if (agent === 'medical' || input.ingestTrace || /biomarker|lab/i.test(mode)) return 'medical';
  if (agent === 'health_coach' || input.report || /health_coach/i.test(mode)) return 'health_coach';
  return 'food';
}

/**
 * Single diet agent: food runs have no narrator or second agent — the scout leg is
 * the only dispatch.
 */
export function isCompareRunTree(input: Partial<DebugReportInput>, dispatchList: Array<{ agent?: string; received?: any }> = []): boolean {
  const mode = String((input as any)?.mode || '').toLowerCase();
  if (mode === 'compare' || mode === 'evaluation' || mode === 'compare_menu' || mode === 'compare_shelf') return true;
  if ((input as any)?.comparisonData || (input as any)?.result?.comparison || (input as any)?.comparison) return true;
  return dispatchList.some(
    (d) => d?.agent === 'scout' && ['compare', 'evaluation', 'compare_menu', 'compare_shelf'].includes(String(d?.received?.mode || '').toLowerCase())
  );
}

/** Deduplicate breadcrumbs by timestamp/action/target key to keep traces compact */
export function deduplicateBreadcrumbs(crumbs: any[]): any[] {
  if (!Array.isArray(crumbs)) return [];
  const seen = new Set<string>();
  const out: any[] = [];
  for (const c of crumbs) {
    if (!c) continue;
    const key = typeof c === 'string'
      ? c.trim()
      : `${c.timestamp || ''}|${c.action || ''}|${c.target || ''}|${JSON.stringify(c.details || {})}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/** Deduplicate session events by status/message/timestamp key */
export function deduplicateSessionEvents(events: any[]): any[] {
  if (!Array.isArray(events)) return [];
  const seen = new Set<string>();
  const out: any[] = [];
  for (const e of events) {
    if (!e) continue;
    const key = typeof e === 'string'
      ? e.trim()
      : `${e.timestamp || ''}|${e.status || ''}|${e.message || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

/** Per-stage token usage parsed from `[UnifiedLLM-Usage:stage]` backend lines */
export interface TokenUsage {
  stage: string;
  input: number;
  output: number;
  total: number;
}

/** Parse `[UnifiedLLM-Usage:scout] prompt=812 completion=96 total=908` lines (last per stage wins) */
export function parseUnifiedUsageLines(logs: string): TokenUsage[] {
  const out = new Map<string, TokenUsage>();
  if (!logs || typeof logs !== 'string') return [];
  const re = /\[UnifiedLLM-Usage:([^\]]+)\]\s*prompt=(\d+)\s+completion=(\d+)\s+total=(\d+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(logs)) !== null) {
    const stage = (m[1] || '').trim().toLowerCase() || 'unknown';
    out.set(stage, {
      stage,
      input: Number(m[2]) || 0,
      output: Number(m[3]) || 0,
      total: Number(m[4]) || 0,
    });
  }
  return [...out.values()];
}

/** Parse `[UnifiedLLM-Timing:stage] ms=5231` lines (last per stage wins) */
export function parseUnifiedTimingLines(logs: string): { stage: string; ms: number }[] {
  const out = new Map<string, number>();
  if (!logs || typeof logs !== 'string') return [];
  const re = /\[UnifiedLLM-Timing:([^\]]+)\]\s*ms=(\d+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(logs)) !== null) {
    out.set((m[1] || '').trim().toLowerCase(), Number(m[2]) || 0);
  }
  return [...out.entries()].map(([stage, ms]) => ({ stage, ms }));
}

/** Parse ALL `[UnifiedLLM-Usage:stage]` lines in log order (per-turn assignment).
 *  The last-wins parser above collapses multi-turn runs onto the final turn's
 *  numbers (t1 showing t2's tokens/latency). Index by turn, fall back to last. */
export function parseUnifiedUsageAll(logs: string): TokenUsage[] {
  const out: TokenUsage[] = [];
  if (!logs || typeof logs !== 'string') return out;
  const re = /\[UnifiedLLM-Usage:([^\]]+)\]\s*prompt=(\d+)\s+completion=(\d+)\s+total=(\d+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(logs)) !== null) {
    out.push({
      stage: (m[1] || '').trim().toLowerCase() || 'unknown',
      input: Number(m[2]) || 0,
      output: Number(m[3]) || 0,
      total: Number(m[4]) || 0,
    });
  }
  return out;
}

/** Parse ALL `[UnifiedLLM-Timing:stage]` lines in log order (per-turn assignment). */
export function parseUnifiedTimingAll(logs: string): { stage: string; ms: number }[] {
  const out: { stage: string; ms: number }[] = [];
  if (!logs || typeof logs !== 'string') return out;
  const re = /\[UnifiedLLM-Timing:([^\]]+)\]\s*ms=(\d+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(logs)) !== null) {
    out.push({ stage: (m[1] || '').trim().toLowerCase(), ms: Number(m[2]) || 0 });
  }
  return out;
}

/** True when the logs prove the stage dispatched an LLM call (not a projector run).
 *  Only call-time lines count: the pipeline also logs instruction/answer lines
 *  on skip paths, so those are deliberately NOT evidence. `[scout_answer]` is
 *  kept as legacy evidence: old exports predate usage/timing lines and scout
 *  always calls. (The dietitian agent is removed; its stages never call.) */
export function hasCallEvidence(logs: string, stage: 'scout' | 'resolver' | 'curator'): boolean {
  if (!logs || typeof logs !== 'string') return false;
  const tag = `\\[UnifiedLLM:${stage}\\]|\\[UnifiedLLM-Prompt:${stage}\\]|\\[UnifiedLLM-Usage:${stage}\\]|\\[UnifiedLLM-Timing:${stage}\\]|\\[UnifiedLLM-Response:${stage}\\]`;
  if (stage === 'scout') {
    return new RegExp(`${tag}|\\[scout_answer\\]|\\[Vision Scout\\] Retrying`).test(logs);
  }
  return new RegExp(`${tag}|\\[UnifiedLLM:(?:food_)?resolver\\]|\\[UnifiedLLM-Usage:(?:food_)?resolver\\]|\\[UnifiedLLM-Timing:(?:food_)?resolver\\]|\\[UnifiedLLM:curator\\]|\\[UnifiedLLM-Usage:curator\\]|\\[UnifiedLLM-Timing:curator\\]|food_resolver|Food Resolver agent|curator|brandCurator|\\[curator_answer\\]`).test(logs);
}

/** Prefix a log line with [jobId] unless blank or already tagged (contract §9: joinable lines) */
export function tagJobId(line: string, jobId: string): string {
  if (line == null) return line;
  const s = String(line);
  if (!s.trim() || !jobId || jobId === 'unknown') return s;
  if (s.includes(`[${jobId}]`)) return s;
  return `[${jobId}] ${s}`;
}

function resolveLastUserActionPrompt(action: any): string | undefined {
  if (!action || typeof action !== 'object') return undefined;

  const details = action.details && typeof action.details === 'object' ? action.details : {};
  const rawPrompt = details.prompt || action.prompt || details.label;
  if (typeof rawPrompt === 'string' && rawPrompt.trim()) {
    const trimmed = rawPrompt.trim();
    // Reject CSS class names, tailwind strings, and UI control artifacts
    if (
      /^(?:p-|m-|bg-|text-|rounded|flex|inline|w-|h-|border|shadow|cursor|hover:|dark:|gap-|items-|justify-|scale-)/.test(trimmed) ||
      trimmed.includes('rounded-full') ||
      trimmed.includes('bg-slate') ||
      trimmed.includes('bg-indigo') ||
      trimmed.includes('cursor-pointer') ||
      trimmed.includes('hover:scale') ||
      trimmed.includes('shadow-') ||
      trimmed === 'Download Debug Logs' ||
      trimmed === 'Flag issue' ||
      trimmed === 'Scroll to top'
    ) {
      return undefined;
    }
    return trimmed;
  }

  if (String(action.action || '').toLowerCase() === 'add_item') {
    const name = details.newItemName || details.itemName;
    if (typeof name === 'string' && name.trim()) return name.trim();
  }

  return undefined;
}

/** Extract or construct handoff records */
export function extractHandoffs(input: DebugReportInput, jobId: string): HandoffTrace[] {
  if (Array.isArray(input.handoffs) && input.handoffs.length > 0) {
    return input.handoffs;
  }
  const chain = input.handoffChain;
  if (Array.isArray(chain) && chain.length > 1) {
    const traces: HandoffTrace[] = [];
    for (let i = 0; i < chain.length - 1; i++) {
      traces.push({
        from: chain[i],
        to: chain[i + 1],
        received: input.handoffPayload,
        keysDropped: [],
        jobId,
      });
    }
    return traces;
  }
  return [];
}

/** Extract or construct agent dispatches */
export function extractDispatches(input: DebugReportInput): DispatchTrace[] {
  const logs = input.backendLogs || '';
  const pack = determinePack(input);

  if (Array.isArray(input.dispatches) && input.dispatches.length > 0) {
    const usages = parseUnifiedUsageLines(logs);
    const timings = parseUnifiedTimingLines(logs);
    const allUsages = parseUnifiedUsageAll(logs);
    const allTimings = parseUnifiedTimingAll(logs);
    const modelMatch = logs.match(/Vision Scout \(([^)]+)\)|\[UnifiedLLM\] Calling (gemini-[^\s]+)/i);

    let enriched = input.dispatches.map((d, idx) => {
      const copy = { ...d };
      if (!copy.model) {
        copy.model = modelMatch ? (modelMatch[1] || modelMatch[2]) : 'gemini-3.5-flash-lite';
      }
      if (copy.tokens == null) {
        // Per-turn assignment: nth same-agent dispatch takes the nth same-stage
        // usage line; fewer lines than turns falls back to the last line.
        const cands = allUsages.filter(x => x.stage === copy.agent);
        const sameAgentIdx = input.dispatches!.slice(0, idx).filter(x => x.agent === copy.agent).length;
        const pick = cands[sameAgentIdx] ?? cands[cands.length - 1] ?? usages.find(x => x.stage === copy.agent);
        if (pick) copy.tokens = pick.total;
      }
      if (copy.latency_ms == null) {
        const cands = allTimings.filter(x => x.stage === copy.agent);
        const sameAgentIdx = input.dispatches!.slice(0, idx).filter(x => x.agent === copy.agent).length;
        const pick = cands[sameAgentIdx] ?? cands[cands.length - 1] ?? timings.find(x => x.stage === copy.agent);
        if (pick) copy.latency_ms = pick.ms;
      }
      const hasPhotos = Boolean(
        input.photoUrl ||
        (input.photoUrls && input.photoUrls.length > 0) ||
        (copy.received && (copy.received as any).photoCount > 0)
      );
      // Fix user prompt if it was accidentally a UI button label or CSS class
      if (!copy.user || copy.user === 'Download Debug Logs' || copy.user === 'Flag issue' || /^(?:p-|bg-|text-|rounded)/.test(copy.user)) {
        if (copy.received?.userMessage && !/^(?:p-|bg-|text-|rounded)/.test(copy.received.userMessage)) {
          copy.user = copy.received.userMessage;
        } else if (idx === 0) {
          if (hasPhotos) {
            copy.user = 'Analyze this meal photo.';
          } else {
            const actionPrompt = resolveLastUserActionPrompt(input.lastUserAction);
            if (actionPrompt) {
              copy.user = actionPrompt;
            } else if (input.userPrompt || input.prompt) {
              copy.user = input.userPrompt || input.prompt;
            } else if (input.message) {
              copy.user = input.message;
            }
          }
        }
      }
      if (copy.agent === 'scout' && !copy.systemInstruction && !copy.instruction) {
        copy.systemInstruction = '- QUANTITY & MULTIPACKS: Output \'weightGrams\' (consumed serving) and \'packGrams\' (container total). For unopened grocery multi-packs, set \'weightGrams\' to a single unit/serving size and \'packGrams\' to the container total.';
      }
      if (idx === input.dispatches.length - 1 && input.rawScout && !copy.rawEmission) {
        copy.rawEmission = input.rawScout;
      }
      if (idx === input.dispatches.length - 1 && input.rawScout && (!copy.output || copy.output === input.scoutItems)) {
        copy.output = input.rawScout;
      }
      return copy;
    });

    const hasCurator = Boolean(
      /food_resolver|Food Resolver|curator/i.test(logs) ||
      usages.some(u => u.stage === 'food_resolver' || u.stage === 'curator') ||
      timings.some(t => t.stage === 'food_resolver' || t.stage === 'curator')
    );
    if (hasCurator && !enriched.some(d => d.agent === 'curator' || d.agent === 'resolver')) {
      const u = usages.find(x => x.stage === 'curator' || x.stage === 'food_resolver');
      const t = timings.find(x => x.stage === 'curator' || x.stage === 'food_resolver');
      const rModelMatch = logs.match(/(?:Food Resolver|Curator).*?Calling (gemini-[^\s]+)|Calling (gemini-[^\s]+).*?(?:[Rr]esolver|[Cc]urator)/i);
      enriched.push({
        id: 't1/curator',
        parent: enriched[0]?.id || null,
        turn: 1,
        agent: 'curator',
        user: undefined,
        received: { gapItems: true },
        instruction: undefined,
        output: undefined,
        model: rModelMatch ? (rModelMatch[1] || rModelMatch[2]) : 'gemini-3.5-flash-lite',
        latency_ms: t ? t.ms : undefined,
        tokens: u ? u.total : undefined,
        called: true,
        error: input.error || null,
      });
    }

    if (pack === 'food') {
      if (isCompareRunTree(input, enriched)) {
        enriched = enriched.filter(d => d.agent !== 'narrator' && d.agent !== 'dietitian' && d.agent !== 'diet');
      }
      const hasScout = enriched.some(d => d.agent === 'scout');
      if (!hasScout) {
        let extractedSystemInstruction: string | undefined = undefined;
        let extractedUserPrompt: string | undefined = undefined;

        if (typeof input.agentInstructions === 'object' && !Array.isArray(input.agentInstructions)) {
          const s = (input.agentInstructions as any)?.scout;
          if (typeof s === 'object' && s) {
            if (s.systemInstruction) extractedSystemInstruction = s.systemInstruction;
            if (s.userPrompt) extractedUserPrompt = s.userPrompt;
          } else if (typeof s === 'string' && s.trim()) {
            extractedUserPrompt = s;
          }
        } else if (typeof input.agentInstructions === 'string' && input.agentInstructions.trim()) {
          extractedUserPrompt = input.agentInstructions;
        }

        if (!extractedSystemInstruction && logs) {
          const match = logs.match(/\[UnifiedLLM-Prompt:scout\] System Instruction:\n([\s\S]+?)(?=\n\[UnifiedLLM-Prompt:|\n\[scout_|\n\[dietitian_|\n\[Vision Scout\]|$)/);
          if (match) {
            extractedSystemInstruction = match[1].trim();
          } else {
            const altMatch = logs.match(/Vision Scout System Instruction \(config\.systemInstruction\):\s*"([\s\S]+?)"(?:\n\[|\n$|$)/);
            if (altMatch) extractedSystemInstruction = altMatch[1].trim();
          }
        }
        if (!extractedUserPrompt && logs) {
          const match = logs.match(/\[UnifiedLLM-Prompt:scout\] User Prompt:\n([\s\S]+?)(?=\n\[UnifiedLLM-Prompt:|\n\[scout_|\n\[dietitian_|\n\[Vision Scout\]|$)/);
          if (match) extractedUserPrompt = match[1].trim();
        }

        if (!extractedSystemInstruction) {
          if (isCompareRunTree(input, enriched)) {
            extractedSystemInstruction = 'You are a Clinical Dietitian & Vision Scout evaluating competing food options (Mode D).';
          } else {
            extractedSystemInstruction = "- QUANTITY & MULTIPACKS: Output 'weightGrams' (consumed serving) and 'packGrams' (container total). For unopened grocery multi-packs, set 'weightGrams' to a single unit/serving size and 'packGrams' to the container total.";
          }
        }

        const scoutTiming = timings.find(x => x.stage === 'scout');
        const scoutUsage = usages.find(x => x.stage === 'scout');
        const scoutEmission = input.rawScout || input.scoutItems || (input as any)?.result?.comparison || (input as any)?.comparisonData || undefined;
        const scoutDisp: DispatchTrace = {
          id: 't1/scout',
          parent: null,
          turn: 1,
          agent: 'scout',
          user: 'Analyze this meal photo.',
          received: {
            mode: isCompareRunTree(input, enriched) ? 'compare' : (input.mode || 'new_log'),
            photoCount: input.photoUrls?.length || (input.photoUrl ? 1 : 0),
          },
          systemInstruction: extractedSystemInstruction,
          userPrompt: extractedUserPrompt,
          instruction: [extractedSystemInstruction, extractedUserPrompt].filter(Boolean).join('\n\n'),
          output: scoutEmission,
          rawEmission: scoutEmission,
          model: modelMatch ? (modelMatch[1] || modelMatch[2]) : 'gemini-3.5-flash-lite',
          latency_ms: scoutTiming?.ms ?? 1500,
          tokens: scoutUsage?.total ?? undefined,
          error: null,
        };
        enriched.unshift(scoutDisp);
      }

      const turnSet = new Set(enriched.map(d => Number(d.turn) || 1));
      for (const t of turnSet) {
        const turnDispatches = enriched.filter(d => (Number(d.turn) || 1) === t);
        if (isCompareRunTree(input, enriched)) continue;
        const matchingScout = turnDispatches.find(d => d.agent === 'scout');
        if (matchingScout && (!matchingScout.rawEmission && !matchingScout.output)) {
          const pfl = input.pendingFoodLog || (input as any)?.result?.pendingFoodLog || (input as any)?.result;
          const verdict = pfl?.verdict || (input.receiptTable as any)?.verdict;
          const advice = pfl?.clinicalAdvice || pfl?.message || (input as any)?.result?.clinicalAdvice || (input as any)?.result?.message;
          const dishes = pfl?.dishes || (input.receiptTable as any)?.dishes || [];
          if (verdict || (advice && advice.length > 20) || dishes.length > 0) {
            const emission = {
              verdict: verdict || { label: 'Supports Metabolic Energy', level: 'neutral' },
              clinicalAdvice: advice || '',
              message: advice || '',
              dishes,
            };
            matchingScout.output = matchingScout.output || emission;
            matchingScout.rawEmission = matchingScout.rawEmission || emission;
          }
        }
      }
    }

    return enriched;
  }

  const dispatches: DispatchTrace[] = [];

  if (pack === 'receptionist') {
    const rawActionPrompt = resolveLastUserActionPrompt(input.lastUserAction);
    const userPrompt = rawActionPrompt || (input.message || undefined);
    dispatches.push({
      id: 'fd/front_desk',
      parent: null,
      turn: 1,
      agent: 'front_desk',
      user: userPrompt,
      received: input.agentPayload,
      instruction: typeof input.agentInstructions === 'string' ? input.agentInstructions : undefined,
      output: input.handoffPayload || input.message,
      model: 'gemini-3.5-flash-lite',
      latency_ms: 1200,
      tokens: undefined,
      error: null,
    });
    return dispatches;
  }

  if (pack === 'medical' || pack === 'health_coach') {
    const rawActionPrompt = resolveLastUserActionPrompt(input.lastUserAction);
    const userPrompt = rawActionPrompt || (input.message || undefined);
    dispatches.push({
      id: pack === 'medical' ? 't1/medical' : 't1/health_coach',
      parent: null,
      turn: 1,
      agent: pack,
      user: userPrompt,
      received: input.agentPayload || input.extractedData || input.ingestTrace,
      instruction: typeof input.agentInstructions === 'string' ? input.agentInstructions : undefined,
      output: input.extractedData || input.report || input.message,
      model: 'gemini-3.5-flash-lite',
      latency_ms: 1200,
      tokens: undefined,
      error: null,
    });
    return dispatches;
  }

  // Food pack dispatches
  const hasPhotos = Boolean(input.photoUrl || (input.photoUrls && input.photoUrls.length > 0));
  const rawActionPrompt = resolveLastUserActionPrompt(input.lastUserAction);
  const defaultUserPrompt = hasPhotos
    ? 'Analyze this meal photo.'
    : (rawActionPrompt || input.userPrompt || input.prompt || (input.mode === 'new_log' ? input.message : undefined));

  const hasScout = Boolean(
    input.scoutItems?.length ||
    input.rawScout ||
    /\[Vision Scout\]|\[UnifiedLLM-Prompt:scout\]/i.test(logs)
  );

  if (hasScout) {
    const modelMatch = logs.match(/Vision Scout \(([^)]+)\)|\[UnifiedLLM\] Calling (gemini-[^\s]+)/i);
    const latencyMatch = logs.match(/(?:Vision Scout|UnifiedLLM).*?(\d+(?:\.\d+)?)ms/i);
    const scoutUsages = parseUnifiedUsageAll(logs).filter(u => u.stage === 'scout');
    const scoutTimings = parseUnifiedTimingAll(logs).filter(t => t.stage === 'scout');

    // Check if there are multiple prompt sections in logs
    const promptSplitRegex = /\[UnifiedLLM-Prompt:scout\] System Instruction:\n/g;
    const matches = Array.from(logs.matchAll(promptSplitRegex));

    if (matches.length > 1) {
      // Multi-turn run detected in logs!
      for (let i = 0; i < matches.length; i++) {
        const turnNum = i + 1;
        const startIndex = matches[i].index!;
        const nextIndex = i + 1 < matches.length ? matches[i + 1].index! : logs.length;
        const turnLogSection = logs.slice(startIndex, nextIndex);

        let turnSysInst = '';
        let turnUserPrompt = '';
        const sysMatch = turnLogSection.match(/^([\s\S]+?)(?=\n\[UnifiedLLM-Prompt:scout\] User Prompt:|\n\[scout_|\n\[dietitian_|\n\[Vision Scout\]|$)/);
        if (sysMatch) turnSysInst = sysMatch[1].trim();
        const usrMatch = turnLogSection.match(/\[UnifiedLLM-Prompt:scout\] User Prompt:\n([\s\S]+?)(?=\n\[UnifiedLLM-Prompt:|\n\[scout_|\n\[dietitian_|\n\[Vision Scout\]|$)/);
        if (usrMatch) turnUserPrompt = usrMatch[1].trim();

        const fullInstruction = turnSysInst
          ? (turnUserPrompt ? `=== SYSTEM INSTRUCTION ===\n${turnSysInst}\n\n=== USER PROMPT ===\n${turnUserPrompt}` : turnSysInst)
          : turnUserPrompt;

        let turnUserText = turnNum === 1 ? defaultUserPrompt : undefined;
        if (turnNum > 1 && turnUserPrompt) {
          const modMatch = turnUserPrompt.match(/User modification instruction:\s*"([^"]+)"/i);
          if (modMatch) turnUserText = modMatch[1];
          else if (input.message && turnNum === matches.length) turnUserText = input.message;
        }

        dispatches.push({
          id: `t${turnNum}/scout`,
          parent: turnNum > 1 ? `t${turnNum - 1}/scout` : null,
          turn: turnNum,
          agent: 'scout',
          user: turnUserText,
          received: {
            turn: turnNum,
            mode: turnNum === 1 ? (input.mode || 'new_log') : 'edit',
            ...(turnNum === 1 ? { photoCount: input.photoUrls?.length || (input.photoUrl ? 1 : 0) } : {}),
            ...(turnUserText ? { userMessage: turnUserText } : {}),
          },
          systemInstruction: turnSysInst || undefined,
          userPrompt: turnUserPrompt || undefined,
          instruction: fullInstruction || undefined,
          output: turnNum === matches.length ? (input.rawScout || input.scoutItems) : undefined,
          rawEmission: turnNum === matches.length ? (input.rawScout || undefined) : undefined,
          model: modelMatch ? (modelMatch[1] || modelMatch[2]) : 'gemini-3.5-flash-lite',
          latency_ms: scoutTimings[i]?.ms ?? scoutTimings[scoutTimings.length - 1]?.ms ?? (latencyMatch ? Math.round(Number(latencyMatch[1])) : 1500),
          tokens: scoutUsages[i]?.total ?? scoutUsages[scoutUsages.length - 1]?.total ?? undefined,
          error: turnNum === matches.length ? (input.error || null) : null,
        });
      }
    } else {
      // Single-turn extraction
      let extractedSystemInstruction: string | undefined = undefined;
      let extractedUserPrompt: string | undefined = undefined;

      if (typeof input.agentInstructions === 'object' && !Array.isArray(input.agentInstructions)) {
        const s = (input.agentInstructions as any)?.scout;
        if (typeof s === 'object' && s) {
          if (s.systemInstruction) extractedSystemInstruction = s.systemInstruction;
          if (s.userPrompt) extractedUserPrompt = s.userPrompt;
        } else if (typeof s === 'string' && s.trim()) {
          extractedUserPrompt = s;
        }
      } else if (typeof input.agentInstructions === 'string' && input.agentInstructions.trim()) {
        extractedUserPrompt = input.agentInstructions;
      }

      if (!extractedSystemInstruction && logs) {
        const match = logs.match(/\[UnifiedLLM-Prompt:scout\] System Instruction:\n([\s\S]+?)(?=\n\[UnifiedLLM-Prompt:|\n\[scout_|\n\[dietitian_|\n\[Vision Scout\]|$)/);
        if (match) {
          extractedSystemInstruction = match[1].trim();
        } else {
          const altMatch = logs.match(/Vision Scout System Instruction \(config\.systemInstruction\):\s*"([\s\S]+?)"(?:\n\[|\n$|$)/);
          if (altMatch) extractedSystemInstruction = altMatch[1].trim();
        }
      }
      if (!extractedUserPrompt && logs) {
        const match = logs.match(/\[UnifiedLLM-Prompt:scout\] User Prompt:\n([\s\S]+?)(?=\n\[UnifiedLLM-Prompt:|\n\[scout_|\n\[dietitian_|\n\[Vision Scout\]|$)/);
        if (match) extractedUserPrompt = match[1].trim();
      }

      if (!extractedSystemInstruction) {
        extractedSystemInstruction = "- QUANTITY & MULTIPACKS: Output 'weightGrams' (consumed serving) and 'packGrams' (container total). For unopened grocery multi-packs, set 'weightGrams' to a single unit/serving size and 'packGrams' to the container total.";
      }

      const fullInstruction = extractedSystemInstruction
        ? (extractedUserPrompt ? `=== SYSTEM INSTRUCTION ===\n${extractedSystemInstruction}\n\n=== USER PROMPT ===\n${extractedUserPrompt}` : extractedSystemInstruction)
        : extractedUserPrompt;

      dispatches.push({
        id: 't1/scout',
        parent: null,
        turn: 1,
        agent: 'scout',
        user: defaultUserPrompt,
        received: {
          photoCount: input.photoUrls?.length || (input.photoUrl ? 1 : 0),
          ...(input.photoUrls?.length ? { photoUrls: input.photoUrls } : (input.photoUrl ? { photoUrl: input.photoUrl } : {})),
          ...(input.userPrompt ? { userMessage: input.userPrompt } : (input.userMessage ? { userMessage: input.userMessage } : (!hasPhotos && input.message ? { userMessage: input.message } : {}))),
          ...(input.mode ? { mode: input.mode } : {}),
          ...(input.diningEnvironment ? { diningEnvironment: input.diningEnvironment } : {}),
        },
        systemInstruction: extractedSystemInstruction,
        userPrompt: extractedUserPrompt,
        instruction: fullInstruction,
        output: input.rawScout || input.scoutItems,
        rawEmission: input.rawScout || undefined,
        model: modelMatch ? (modelMatch[1] || modelMatch[2]) : 'gemini-3.5-flash-lite',
        latency_ms: scoutTimings[0]?.ms || (latencyMatch ? Math.round(Number(latencyMatch[1])) : 1500),
        tokens: scoutUsages[0]?.total || undefined,
        error: input.error || null,
      });
    }
  }

  // Brand Curator (formerly Food Resolver): runs inside DB search / brand clean for gap items or catalog curation.
  // Evidence: streamed `curator` / `food_resolver` status lines or usage/timing.
  const hasCurator = Boolean(
    /food_resolver|Food Resolver|curator/i.test(logs) ||
    parseUnifiedUsageLines(logs).some(u => u.stage === 'curator' || u.stage === 'food_resolver') ||
    parseUnifiedTimingLines(logs).some(t => t.stage === 'curator' || t.stage === 'food_resolver')
  );

  if (hasCurator) {
    const usage = parseUnifiedUsageLines(logs).find(u => u.stage === 'curator' || u.stage === 'food_resolver');
    const timing = parseUnifiedTimingLines(logs).find(t => t.stage === 'curator' || t.stage === 'food_resolver');
    const modelMatch = logs.match(/(?:Food Resolver|Curator).*?Calling (gemini-[^\s]+)|Calling (gemini-[^\s]+).*?(?:[Rr]esolver|[Cc]urator)/i);
    dispatches.push({
      id: 't1/curator',
      parent: hasScout ? 't1/scout' : null,
      turn: 1,
      agent: 'curator',
      user: undefined,
      received: { gapItems: true },
      instruction: undefined,
      output: undefined,
      model: modelMatch ? (modelMatch[1] || modelMatch[2]) : 'gemini-3.5-flash-lite',
      latency_ms: timing ? timing.ms : undefined,
      tokens: usage ? usage.total : undefined,
      called: true,
      error: input.error || null,
    });
  }

  if (pack === 'food' && !isCompareRunTree(input, dispatches)) {
    const scoutDispatch = dispatches.find(d => d.agent === 'scout');
    if (scoutDispatch && (!scoutDispatch.rawEmission && !scoutDispatch.output)) {
      const pfl = input.pendingFoodLog || (input as any)?.result?.pendingFoodLog || (input as any)?.result;
      const verdict = pfl?.verdict || (input.receiptTable as any)?.verdict;
      const advice = pfl?.clinicalAdvice || pfl?.message || (input as any)?.result?.clinicalAdvice || (input as any)?.result?.message;
      const dishes = pfl?.dishes || (input.receiptTable as any)?.dishes || [];
      if (verdict || (advice && advice.length > 20) || dishes.length > 0) {
        const emission = {
          verdict: verdict || { label: 'Supports Metabolic Energy', level: 'neutral' },
          clinicalAdvice: advice || '',
          message: advice || '',
          dishes,
        };
        scoutDispatch.output = scoutDispatch.output || emission;
        scoutDispatch.rawEmission = scoutDispatch.rawEmission || emission;
      }
    }
  }

  return dispatches;
}

/** Extract portion adjustment traces from pendingFoodLog or user breadcrumbs */
export function extractPortionAdjustment(input: DebugReportInput): PortionAdjustmentTrace | null {
  // 1. Check pendingFoodLog explicit attribute or ratio
  const pfl = input.pendingFoodLog;
  if (pfl && typeof pfl === 'object') {
    if (pfl.portionAdjustment && typeof pfl.portionAdjustment === 'object') {
      return pfl.portionAdjustment;
    }
    if (typeof pfl.portionRatio === 'number' && Math.abs(pfl.portionRatio - 1.0) > 0.001) {
      const diffPct = Math.round(Math.abs(pfl.portionRatio - 1.0) * 100);
      const toW = Math.round(pfl.weightGrams || 0);
      const fromW = Math.round(pfl.initialWeightGrams || (pfl.portionRatio ? toW / pfl.portionRatio : toW));
      const agentCalled = diffPct > 30;
      return {
        type: agentCalled ? 'agent_edit' : 'local_math',
        diffPercent: diffPct,
        fromWeight: fromW,
        toWeight: toW,
        agentCalled,
        reason: agentCalled
          ? `Portion difference of ${diffPct}% (> 30%) triggered an agent review edit.`
          : `Portion difference of ${diffPct}% (<= 30%) recalculated locally without extra agent call.`,
      };
    }
  }

  // 2. Check breadcrumbs
  if (Array.isArray(input.userActionBreadcrumbs)) {
    for (let i = input.userActionBreadcrumbs.length - 1; i >= 0; i--) {
      const b = input.userActionBreadcrumbs[i];
      if (b && typeof b === 'object' && (b.action === 'portion_adjust_local' || b.action === 'portion_adjust_edit')) {
        const details = b.details || {};
        const agentCalled = b.action === 'portion_adjust_edit' || Boolean(details.agentCalled);
        const diffPct = details.diffPercent ?? Math.round((details.diffRatio ?? 0) * 100);
        return {
          type: agentCalled ? 'agent_edit' : 'local_math',
          diffPercent: diffPct,
          fromWeight: Math.round(details.fromWeight ?? 0),
          toWeight: Math.round(details.toWeight ?? 0),
          agentCalled,
          reason: agentCalled
            ? `Portion difference of ${diffPct}% (> 30%) triggered an agent review edit.`
            : `Portion difference of ${diffPct}% (<= 30%) recalculated locally without extra agent call.`,
        };
      }
    }
  }

  return null;
}

/**
 * Builds the canonical JSON run tree from raw debug report input.
 * Evaluates contract laws across process, ui, and content layers.
 */
export function buildCanonicalRunTree(input: DebugReportInput): CanonicalRunTree {
  const jobId = input.jobId || 'unknown';
  const pack = determinePack(input);
  const breadcrumbs = deduplicateBreadcrumbs(input.userActionBreadcrumbs || []);
  const sessionEvents = deduplicateSessionEvents(input.sessionEvents || []);
  const consoleLogs = (Array.isArray(input.clientConsoleLogs) ? input.clientConsoleLogs : [])
    .map(l => tagJobId(typeof l === 'string' ? l : JSON.stringify(l), jobId));
  const networkErrors = (Array.isArray(input.networkErrors) ? input.networkErrors : [])
    .map(l => tagJobId(typeof l === 'string' ? l : JSON.stringify(l), jobId));
  const handoffs = extractHandoffs(input, jobId);
  const dispatches = extractDispatches(input);
  const portionAdjustment = extractPortionAdjustment(input);

  const tree: CanonicalRunTree = {
    jobId,
    conversationId: input.conversationId || null,
    pack,
    status: input.status || 'unknown',
    exportedAt: input.exportedAt || new Date().toISOString(),
    dialogInventory: input.dialogInventory || null,
    lastUserAction: input.lastUserAction || null,
    breadcrumbs,
    sessionEvents,
    console: consoleLogs,
    network: networkErrors,
    handoffs,
    dispatches,
    contract: [],
    portionAdjustment,
    linkedJobs: Array.isArray(input.linkedJobs) ? input.linkedJobs : [],
    pendingFoodLog: input.pendingFoodLog,
    scoutItems: input.scoutItems,
    receiptTable: input.receiptTable,
    rawScout: input.rawScout,
    backendLogs: typeof input.backendLogs === 'string'
      ? input.backendLogs.split('\n').map(l => tagJobId(l, jobId)).join('\n')
      : input.backendLogs,
    extractedData: input.extractedData,
    report: (input as any).report,
    comparisonData: input.comparisonData || (input as any).result?.comparisonData || (input as any).result?.comparison || null,
  };

  // Evaluate contracts on the populated tree
  tree.contract = evaluateContracts(tree);

  return tree;
}
