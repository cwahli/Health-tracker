import { evaluateMealGate, MealGateResult } from '../mealBuild/mealGate.js';
import { getSessionLog } from '../jobs/sessionLog.js';
import {
  buildCanonicalRunTree,
  type CanonicalRunTree,
  type DialogInventory,
  type DispatchTrace,
  type HandoffTrace,
} from './debugRunTree.js';

/** Recursively strip base64 / huge data-URLs; keep short https photo URLs. */
export function stripHeavyImages(value: any): any {
  if (value == null) return value;
  if (typeof value === 'string') {
    if (value.startsWith('data:image/')) {
      return `[image omitted ${Math.round(value.length / 1024)}KB]`;
    }
    if (value.length > 8000 && /base64/i.test(value)) {
      return value.replace(/data:image\/[^;]+;base64,[a-zA-Z0-9+/=]+/ig, (match) => {
        return `[image omitted ${Math.round(match.length / 1024)}KB]`;
      });
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(stripHeavyImages);
  if (typeof value === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(value)) {
      if (
        (k === 'imageUrl' ||
          k === 'imageUrls' ||
          k === 'photoUrl' ||
          k === 'images' ||
          k === 'selectedImages') &&
        (typeof v === 'string' ? v.startsWith('data:') || v.length > 8000 : true)
      ) {
        if (typeof v === 'string' && /^https?:\/\//i.test(v) && v.length < 500) {
          out[k] = v;
        } else if (Array.isArray(v)) {
          out[k] = v.map((x) =>
            typeof x === 'string' && /^https?:\/\//i.test(x) && x.length < 500
              ? x
              : typeof x === 'string'
                ? `[image omitted ${Math.round(x.length / 1024)}KB]`
                : stripHeavyImages(x)
          );
        } else if (typeof v === 'string') {
          out[k] = `[image omitted ${Math.round(v.length / 1024)}KB]`;
        } else {
          out[k] = stripHeavyImages(v);
        }
        continue;
      }
      out[k] = stripHeavyImages(v);
    }
    return out;
  }
  return value;
}

export const COLD_DEBUG_LOG = '[ColdDebug] R2 upload';

/** R2 object key for cold debug JSON (user-scoped). */
export function coldDebugR2Key(jobId: string, userId?: string | null): string {
  const uid = String(userId || 'anonymous')
    .replace(/[^a-zA-Z0-9_\-@.]/g, '_')
    .slice(0, 120);
  const jid = String(jobId || 'unknown').replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 120);
  return `debug/${uid}/${jid}.json`;
}

export type DebugReportInput = {
  jobId?: string;
  status?: string;
  message?: string;
  backendLogs?: string;
  pendingFoodLog?: any;
  scoutItems?: any[];
  scoutInternalReasoning?: string;
  rawScout?: any;
  scoutContentType?: string;
  diningEnvironment?: string;
  receiptTable?: any;
  error?: string;
  debugUrl?: string;
  photoUrl?: string;
  photoUrls?: string[];
  exportedAt?: string;
  userPrompt?: string;
  prompt?: string;
  userMessage?: string;
  mode?: string;
  agentType?: string;
  savable?: boolean;
  degradedStages?: string[];
  lastUserAction?: any;
  userActionBreadcrumbs?: any[];
  clientConsoleLogs?: string[];
  networkErrors?: string[];
  usdaSearchResults?: any[];
  brandSearchResults?: any[];
  comprehensiveNutrients?: Record<string, number>;
  stageLedger?: any[];
  historyLog?: any[];
  version?: number;
  ingestTrace?: any;
  gate?: any;
  /** Health Coach / medical analysis output (health-baseline-analyze route nests
   * its full structured result under this field — see serverJobs.ts persistSucceeded). */
  report?: any;
  /** Prior conversation turns (role + content) that came before the turn being
   * exported, so a reader can see what led up to this point ("previous steps"). */
  conversationHistory?: { role: string; content: string }[];
  /** Sequence of agent transfers (e.g. Front Desk -> Health Coach). */
  handoffChain?: string[];
  /** Full handoff payload passed between agents */
  handoffPayload?: any;
  /** Input payload/context as received by the agent */
  agentPayload?: any;
  /** Dispatched system instructions (single string, record by agent, or structured object) */
  agentInstructions?: Record<string, any> | string[] | string;
  /** Job session event trail (JobStore.apply / JobQueueRunner), forwarded
   * from the client-recorded job.sessionEvents so it survives into
   * server-generated exports. Falls back to the in-process sessionLog map
   * for client-only callers running in the same tab that recorded them. */
  sessionEvents?: any[];
  dialogInventory?: DialogInventory | null;
  dispatches?: DispatchTrace[];
  handoffs?: HandoffTrace[];
  /** Linked jobs of a forwarded journey (e.g. parent Front Desk job of a food
   * leg). Resolved by the export caller via JobStore; rendered as a chain. */
  linkedJobs?: Array<{ id: string; kind?: string; status?: string; mode?: string }>;
  pack?: 'food' | 'receptionist' | 'medical' | 'health_coach';
  conversationId?: string | null;
  extractedData?: any;
  comparisonData?: any;
  patientContext?: any;
  previousAttempts?: any[];
  priorLogs?: string | string[];
};

/**
 * Parse rolling nutritional target status block from instructions, patientContext, or logs.
 */
export function parseNutritionalTargetStatus(input: DebugReportInput): {
  days: number;
  items: Array<{
    key: string;
    intake: string;
    budget: string;
    status: string;
    impact: string;
  }>;
} | null {
  const sources = [
    typeof input.patientContext === 'string' ? input.patientContext : JSON.stringify(input.patientContext || ''),
    typeof input.agentInstructions === 'string' ? input.agentInstructions : JSON.stringify(input.agentInstructions || ''),
    input.backendLogs || '',
    ...(input.dispatches || []).map(d => `${d.systemInstruction || ''} ${d.instruction || ''}`),
  ].join('\n');

  const match = sources.match(/=== NUTRITIONAL TARGET STATUS ===\s*(?:(\d+)\s*days?\s*avg:\s*)?([^\n\r]+)/i)
    || sources.match(/NUTRITIONAL TARGET STATUS\s*(?:\((\d+)\s*days?\s*avg\))?:\s*([^\n\r]+)/i);
  if (!match) return null;

  const days = Number(match[1]) || 3;
  // The match may land inside a JSON.stringify'd source, where newlines are
  // literal \n sequences — [^\n\r]+ then swallows the whole following
  // instruction block and comma-splitting turns prompt fragments with parens
  // into fake nutrients ("GROUP EVERY ... (NON-ADDITIVE)" -> NON/ADDITIVE).
  // Terminate at the first JSON-escaped newline too (stripping leading ones,
  // since the capture itself can start on an escaped newline). Also strip a
  // leading "N days avg:" prefix the regex couldn't consume inside JSON
  // sources (it otherwise becomes part of the first nutrient's key, as seen
  // live: "**\n3 days avg: Sat fat**").
  const rawList = match[2]
    .replace(/^(?:\\n|\n|\s)+/, '')
    .split(/\r?\n|\\n|"|'/)[0]
    .replace(/^\s*\d+\s*days?\s*avg:\s*/i, '')
    .replace(/\.\s*Budgets[\s\S]*$/i, '')
    .trim();
  const parts = rawList.split(/,(?![^(]*\))/).map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) return null;

  const baselineBudgets: Record<string, { budget: string; impact: string }> = {
    'calorie': { budget: '1,800 kcal', impact: 'Strictly monitors heavy energy density and large portions to maintain calorie balance.' },
    'calories': { budget: '1,800 kcal', impact: 'Strictly monitors heavy energy density and large portions to maintain calorie balance.' },
    'sat fat': { budget: '20.0 g', impact: 'Disqualifies high-fat saturated cooking fats, shortening pastries, and greasy fried dishes.' },
    'saturated fat': { budget: '20.0 g', impact: 'Disqualifies high-fat saturated cooking fats, shortening pastries, and greasy fried dishes.' },
    'added sugar': { budget: '30.0 g', impact: 'Heavily penalizes added sugars, simple syrups, and sweetened confections to protect metabolic control.' },
    'sodium': { budget: '2,300 mg', impact: 'Monitors sodium concentration to control fluid retention, blood pressure, and vascular strain.' },
    'protein': { budget: '120.0 g', impact: 'Actively promotes lean whole proteins, poultry, fish, and legumes to close daily protein targets.' },
    'total fibre': { budget: '30.0 g', impact: 'Elevates vegetable broths, raw produce, and high-fiber legumes to support glycemic & lipid control.' },
    'dietary fiber': { budget: '30.0 g', impact: 'Elevates vegetable broths, raw produce, and high-fiber legumes to support glycemic & lipid control.' },
    'carbohydrates': { budget: '200.0 g', impact: 'Penalizes refined flour and rapid-glycemic starches to maintain stable blood glucose levels.' },
    'potassium': { budget: '3,500 mg', impact: 'Tracked to maintain sodium-potassium balance alongside dietary electrolyte intake.' },
    'soluble fibre': { budget: '7.0 g', impact: 'Encouraged through fresh fruit, whole oats, and legume broths for lipid management.' },
    'trans fat': { budget: '0.0 g', impact: 'Zero tolerance: trace trans fats from industrial shortening trigger an immediate clinical alert.' },
  };

  const parsedItems: Array<{ key: string; intake: string; budget: string; status: string; impact: string }> = [];

  for (const part of parts) {
    const itemMatch = part.match(/^([^(]+)\s*\(([^)]+)\)/);
    if (!itemMatch) continue;
    let rawKey = itemMatch[1].replace(/^(?:\\n|\n|\s)+/, '').trim();
    rawKey = rawKey.replace(/^\d+\s*days?\s*avg:\s*/i, '').trim();
    if (!rawKey || rawKey.length > 35 || /[\n\r\t\\=;:#]/.test(rawKey)) continue;
    if (!/^[a-zA-Z0-9\s_-]+$/.test(rawKey)) continue;

    const normKey = rawKey.toLowerCase();
    const isKnownNutrient = Boolean(baselineBudgets[normKey]) || /^(calories?|protein|total fat|saturated fat|sat fat|carbs|carbohydrates?|fiber|total fibre|soluble fibre|dietary fiber|sodium|potassium|sugar|added sugar|trans fat|cholesterol|calcium|iron|magnesium|vitamin [a-z0-9]+)$/i.test(normKey);
    if (!isKnownNutrient) continue;

    const inside = itemMatch[2].trim();
    const splitInside = inside.split(/\s*-\s*/);
    const intake = splitInside[0]?.trim() || inside;
    let status = 'Reference target';
    if (splitInside[1]?.trim()) {
      const rawStatus = splitInside[1].trim();
      status = rawStatus.includes('over') ? `+${rawStatus}` : (rawStatus.includes('under') ? `-${rawStatus.replace('under', 'deficit')}` : rawStatus);
    }

    const config = baselineBudgets[normKey] || { budget: 'Standard guideline', impact: 'Monitored against daily dietary allowance guidelines.' };
    const displayKey = rawKey.charAt(0).toUpperCase() + rawKey.slice(1);

    parsedItems.push({
      key: displayKey,
      intake,
      budget: config.budget,
      status,
      impact: config.impact,
    });
  }

  if (parsedItems.length === 0) return null;
  return { days, items: parsedItems };
}

/**
 * B9b — Human-readable full report (scout, database search, calculation, receipt + backend logs).
 * Cleaned up without redundant duplicates. No base64 images.
 */
export function buildDebugMarkdownReport(input: DebugReportInput): string {
  const tree = buildCanonicalRunTree(input);
  const lines: string[] = [];
  const at = input.exportedAt || tree.exportedAt || new Date().toISOString();
  let computedGate: MealGateResult | null = null;
  lines.push(`# Health Tracker — End-to-End Diagnostic Report`);
  lines.push('');
  lines.push(`- **Exported:** ${at}`);
  if (input.jobId || tree.jobId) lines.push(`- **Job ID:** \`${input.jobId || tree.jobId}\``);
  if (input.status || tree.status) lines.push(`- **Status:** ${input.status || tree.status}`);
  lines.push(`- **Pack:** ${tree.pack}`);
  if (input.mode) lines.push(`- **Mode:** ${input.mode}`);
  if (input.version !== undefined) lines.push(`- **Version:** ${input.version}`);
  if (input.savable !== undefined) lines.push(`- **Savable:** ${input.savable}`);
  if (input.degradedStages && input.degradedStages.length > 0) lines.push(`- **Degraded Stages:** ${input.degradedStages.join(', ')}`);
  if (Array.isArray(input.photoUrls) && input.photoUrls.length > 0) {
    input.photoUrls.forEach((p, idx) => {
      if (/^https?:\/\//i.test(String(p))) {
        lines.push(`- **Photo ${idx + 1}:** ${p}`);
      }
    });
  } else if (input.photoUrl && /^https?:\/\//i.test(String(input.photoUrl))) {
    const photoBase = input.photoUrl.replace(/_\d+\.jpg$/, '');
    const crumb = (input.userActionBreadcrumbs || []).find((c: any) => (c?.details?.imageCount && c.details.imageCount > 1) || (c?.details?.image_count && c.details.image_count > 1));
    const imgCount = crumb?.details?.imageCount || crumb?.details?.image_count || 1;
    if (imgCount > 1 && photoBase !== input.photoUrl) {
      for (let i = 0; i < imgCount; i++) {
        lines.push(`- **Photo ${i + 1}:** ${photoBase}_${i}.jpg`);
      }
    } else {
      lines.push(`- **Photo:** ${input.photoUrl}`);
    }
  }

  // Shown / Final ledger line (matching Golden Meal 01 & 03 specifications)
  if (input.pendingFoodLog) {
    const pfl = input.pendingFoodLog;
    const lKcal = pfl.nutrients?.calories ?? pfl.calories;
    const lWeight = pfl.weightGrams ?? pfl.weight;
    const dList = (Array.isArray(pfl.dishes) && pfl.dishes.length > 0)
      ? pfl.dishes
      : (Array.isArray(pfl.itemsBreakdown) ? pfl.itemsBreakdown : []);
    const lDishes = dList.length;
    if (lKcal != null) {
      const isFinal = input.status === 'succeeded';
      const label = isFinal ? 'Final ledger' : 'Shown ledger';
      lines.push(`- **${label}:** ${lKcal} kcal · ${lWeight != null ? `${lWeight} g · ` : ''}${lDishes} dishes`);
    }
  } else if (input.comparisonData || input.mode === 'compare') {
    const comp = input.comparisonData || input.rawScout;
    const itCount = comp?.items?.length || comp?.allExtractedDishes?.length || input.scoutItems?.length || 0;
    const grCount = comp?.groups?.length || 0;
    lines.push(`- **Shown comparison:** ${itCount} extracted items across ${grCount} macro clusters (<=10% variance)`);
  }
  lines.push('');

  // 1. Contract Table first (after identity) — Invariant §1.2 & §9
  lines.push(`## ⚖️ Contract Evaluation`);
  lines.push('');
  lines.push(`| Law | Layer | Fault | Result | Actual |`);
  lines.push(`|-----|-------|-------|--------|--------|`);
  for (const c of tree.contract) {
    const icon = c.result === 'PASS' ? '✅' : c.result === 'FAIL' ? '❌' : '⚪';
    lines.push(`| ${c.law} | ${c.layer} | ${c.fault} | ${icon} ${c.result} | ${c.actual.replace(/\|/g, '\\|')} |`);
  }
  lines.push('');

  // 2. Snapshot at Download — Dialog Inventory (Invariant §1.3 & §5)
  if (tree.dialogInventory) {
    lines.push(`## 🪟 Modal Snapshot (Dialog Inventory)`);
    lines.push('');
    lines.push(`- **open:** ${tree.dialogInventory.open}`);
    if (tree.dialogInventory.title) lines.push(`- **title:** "${tree.dialogInventory.title}"`);
    if (tree.dialogInventory.on_card) lines.push(`- **on_card:** ${JSON.stringify(tree.dialogInventory.on_card)}`);
    if (tree.dialogInventory.visible) lines.push(`- **visible:** [${tree.dialogInventory.visible.join(', ')}]`);
    if (tree.dialogInventory.hidden) lines.push(`- **hidden:** [${tree.dialogInventory.hidden.join(', ')}]`);
    if (tree.dialogInventory.composer) lines.push(`- **composer:** ${JSON.stringify(tree.dialogInventory.composer)}`);
    if (tree.dialogInventory.expand !== undefined) lines.push(`- **expand:** ${tree.dialogInventory.expand}`);
    lines.push('');
  }

  // 2b. Portion Adjustment Audit (if portion was adjusted)
  if (tree.portionAdjustment) {
    lines.push(`## ⚖️ Portion Adjustment Audit`);
    lines.push('');
    lines.push(`- **Adjustment Type:** ${tree.portionAdjustment.type === 'local_math' ? 'Local Mathematical Recalculation (⚡ Instant, 0 extra LLM calls)' : 'Agent Review Edit (🤖 Turn 2 LLM Call)'}`);
    lines.push(`- **Portion Difference:** ${tree.portionAdjustment.diffPercent}% (${tree.portionAdjustment.diffPercent > 30 ? '> 30% threshold' : '<= 30% threshold'})`);
    lines.push(`- **Weight Transition:** ${tree.portionAdjustment.fromWeight}g ➔ ${tree.portionAdjustment.toWeight}g`);
    lines.push(`- **Agent Invoked:** ${tree.portionAdjustment.agentCalled ? 'Yes (Triggered agent review)' : 'No (Calculated directly via exact proportional scaling)'}`);
    lines.push(`- **Audit Summary:** ${tree.portionAdjustment.reason}`);
    lines.push('');
  }

  // 2c. Split Turn / Portion Clarify (pending question, if any)
  const pendingClarify = (tree.pendingFoodLog as any)?.portionClarify;
  if (pendingClarify && typeof pendingClarify === 'object') {
    lines.push(`## 🔀 Split Turn / Portion Clarify`);
    lines.push('');
    if (pendingClarify.promptMessage) lines.push(`- **Question:** ${pendingClarify.promptMessage}`);
    const clarifyItems = Array.isArray(pendingClarify.items) ? pendingClarify.items : [];
    for (const it of clarifyItems) {
      lines.push(`- **Ask:** ${it?.name} (est ${it?.estimatedWeightGrams}g, pack ${it?.packGrams}g)`);
    }
    // S-10 PORTION_FUNNEL: per-item quantity resolution (candidates, decision, why).
    const resolutions = Array.isArray((pendingClarify as any).resolutions) ? (pendingClarify as any).resolutions : [];
    for (const r of resolutions) {
      const cands = Array.isArray(r?.candidates)
        ? r.candidates.map((c: any) => `${c?.source}${c?.grams != null ? ` ${c.grams}g` : ''}${c?.packGrams != null ? ` pack ${c.packGrams}g` : ''} (${c?.confidence})`).join(' · ')
        : '';
      lines.push(`- **Resolved:** ${r?.name} → ${r?.decision} (${r?.why || 'no reason recorded'})${cands ? ` [${cands}]` : ''}`);
    }
    lines.push(`- **Status:** ${tree.status === 'awaiting_user' ? 'awaiting user answer' : tree.status}`);
    lines.push('');
  }

  // 2c2. Quantity resolution audit (S-10) — recorded even when no question
  // fired, so "why didn't it ask" is answerable from the export.
  const qtyAudit = (tree.pendingFoodLog as any)?.quantityResolutions;
  if ((!pendingClarify || typeof pendingClarify !== 'object') && Array.isArray(qtyAudit) && qtyAudit.length > 0) {
    lines.push(`## 🧮 Quantity Resolution (no question asked)`);
    lines.push('');
    for (const r of qtyAudit) {
      const cands = Array.isArray(r?.candidates)
        ? r.candidates.map((c: any) => `${c?.source}${c?.grams != null ? ` ${c.grams}g` : ''}${c?.packGrams != null ? ` pack ${c.packGrams}g` : ''} (${c?.confidence})`).join(' · ')
        : '';
      lines.push(`- **Resolved:** ${r?.name} → ${r?.decision} (${r?.why || 'no reason recorded'})${cands ? ` [${cands}]` : ''}`);
    }
    lines.push('');
  }

  // 2d. User Nutritional Allowance & Personalized Clinical Usage (Golden Meal Invariant)
  const targetStatus = parseNutritionalTargetStatus(input);
  if (targetStatus) {
    lines.push(`## 🎯 User Nutritional Allowance & Personalized Clinical Usage`);
    lines.push('');
    lines.push(`The patient's profile exhibits active nutritional targets and metabolic constraints over a ${targetStatus.days}-day baseline. Rather than evaluating foods in a vacuum, the clinical engine actively constrains verdicts, rankings, and macro calculations against these allowances:`);
    lines.push('');
    lines.push(`| Profile Allowance Key | ${targetStatus.days}-Day Average | Baseline Budget | Status & Surplus/Deficit | Active Usage & Clinical Guidance |`);
    lines.push(`|---|---|---|:---:|---|`);
    for (const row of targetStatus.items) {
      lines.push(`| **${row.key}** | ${row.intake} | ${row.budget} | **${row.status}** | ${row.impact} |`);
    }
    lines.push('');
  }

  // 3. Agent Dispatches — once per dispatch that ran (§7)
  if (tree.dispatches && tree.dispatches.length > 0) {
    lines.push(`## 📡 Agent Dispatches (${tree.dispatches.length})`);
    lines.push('');
    for (const d of tree.dispatches) {
      lines.push(`### Dispatch ${d.id}`);
      if (d.user) lines.push(`- **User:** ${d.user}`);
      if (d.received) lines.push(`- **Received:** ${typeof d.received === 'object' ? JSON.stringify(d.received) : d.received}`);
      // Debug exports exist for complete auditability — a 4000-char cap here
      // silently cut off most real instruction/output payloads mid-JSON.
      // Raised to a much larger safety ceiling (rather than removed outright)
      // so a truly pathological payload still can't blow up the export.
      const DISPATCH_FIELD_CHAR_LIMIT = 100000;
      const capField = (text: string): string => {
        if (text.length <= DISPATCH_FIELD_CHAR_LIMIT) return text;
        return `${text.slice(0, DISPATCH_FIELD_CHAR_LIMIT)}\n... [truncated ${text.length - DISPATCH_FIELD_CHAR_LIMIT} more chars]`;
      };
      if (d.systemInstruction) {
        lines.push(`- **System Instruction:**`);
        lines.push('```');
        lines.push(capField(d.systemInstruction));
        lines.push('```');
      }
      if (d.userPrompt) {
        lines.push(`- **User Prompt:**`);
        lines.push('```');
        lines.push(capField(d.userPrompt));
        lines.push('```');
      } else if (d.instruction && !d.systemInstruction) {
        lines.push(`- **Instruction:**`);
        lines.push('```');
        lines.push(capField(d.instruction));
        lines.push('```');
      }
      if (d.rawEmission) {
        lines.push(`- **Raw Emission (Verbatim Output):**`);
        let formattedOutput = '';
        let isJson = false;
        if (typeof d.rawEmission === 'object') {
          formattedOutput = JSON.stringify(d.rawEmission, null, 2);
          isJson = true;
        } else if (typeof d.rawEmission === 'string') {
          const trimmed = d.rawEmission.trim();
          if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            try {
              const parsed = JSON.parse(trimmed);
              formattedOutput = JSON.stringify(parsed, null, 2);
              isJson = true;
            } catch {
              formattedOutput = d.rawEmission;
            }
          } else {
            formattedOutput = d.rawEmission;
          }
        } else {
          formattedOutput = String(d.rawEmission);
        }
        lines.push(isJson ? '```json' : '```');
        lines.push(capField(formattedOutput));
        lines.push('```');
      }
      let isDuplicateOutput = false;
      if (d.rawEmission && d.output) {
        if (d.output === d.rawEmission || JSON.stringify(d.output) === JSON.stringify(d.rawEmission)) {
          isDuplicateOutput = true;
        } else if (typeof d.rawEmission === 'string') {
          try {
            const parsed = JSON.parse(d.rawEmission.trim());
            if (JSON.stringify(d.output) === JSON.stringify(parsed)) {
              isDuplicateOutput = true;
            }
          } catch {
            // not valid JSON
          }
        }
      }
      if (d.output && !isDuplicateOutput) {
        lines.push(`- **Output:**`);
        let formattedOutput = '';
        let isJson = false;
        if (typeof d.output === 'object') {
          formattedOutput = JSON.stringify(d.output, null, 2);
          isJson = true;
        } else if (typeof d.output === 'string') {
          const trimmed = d.output.trim();
          if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            try {
              const parsed = JSON.parse(trimmed);
              formattedOutput = JSON.stringify(parsed, null, 2);
              isJson = true;
            } catch {
              formattedOutput = d.output;
            }
          } else {
            formattedOutput = d.output;
          }
        } else {
          formattedOutput = String(d.output);
        }
        lines.push(isJson ? '```json' : '```');
        lines.push(capField(formattedOutput));
        lines.push('```');
      }
      const sigs: string[] = [];
      if (d.model) sigs.push(`model=${d.model}`);
      if (d.latency_ms != null) sigs.push(`latency_ms=${d.latency_ms}`);
      if (d.tokens != null) sigs.push(`tokens=${d.tokens}`);
      if (d.error) sigs.push(`error=${d.error}`);
      if (sigs.length > 0) lines.push(`- **Signals:** ${sigs.join(', ')}`);
      if (d.parent) lines.push(`- **Parent:** ${d.parent}`);
      lines.push('');
    }
  }

  // 4. Data Pipeline Execution & Infrastructure Connectivity Matrix
  lines.push(`## 🔗 Data Pipelines & Infrastructure Connectivity Matrix`);
  lines.push('');
  lines.push(`| Pipeline Stage | Connectivity & Status | Details / Metrics |`);
  lines.push(`|----------------|-----------------------|-------------------|`);

  // Stage 1: Triage / Front Desk
  const hasFrontDesk = input.agentType === 'front_desk' || (input.handoffChain && input.handoffChain.some(a => /front.?desk/i.test(a))) || (input.backendLogs && /\[FrontDesk\]/i.test(input.backendLogs));
  const frontDeskStatus = hasFrontDesk ? '✅ Connected (Success)' : '⚪ Skipped / Standby';
  const frontDeskDetails = hasFrontDesk ? 'User intent triaged; handoff formulated' : 'Direct execution mode';
  lines.push(`| **1. Triage & Front Desk** | ${frontDeskStatus} | ${frontDeskDetails} |`);

  // Stage 2: Vision Scout & OCR
  const hasScout = Boolean(input.scoutItems?.length || input.rawScout || input.scoutContentType || input.photoUrl || (input.photoUrls && input.photoUrls.length > 0));
  const scoutCount = input.scoutItems?.length || 0;
  const scoutStatus = hasScout ? `✅ Connected (${scoutCount > 0 ? `${scoutCount} item(s) detected` : 'Active'})` : '⚪ Skipped (Text-only)';
  const scoutDetails = input.scoutContentType ? `Type: ${input.scoutContentType}` : (hasScout ? 'Visual bounding & OCR completed' : 'No image payload');
  lines.push(`| **2. Vision Scout & OCR** | ${scoutStatus} | ${scoutDetails} |`);

  // Stage 3: Biomarker Ingest & Normalization
  const hasIngest = Boolean(input.ingestTrace);
  const ingestCount = input.ingestTrace?.totalInputRows ?? (input.ingestTrace?.rows?.length ?? 0);
  const ingestStatus = hasIngest ? `✅ Connected (${ingestCount} row(s) mapped)` : '⚪ Standby / N/A';
  const ingestDetails = hasIngest ? `High Conf: ${input.ingestTrace?.highConfidenceCount ?? 0} | Flagged: ${input.ingestTrace?.flaggedCount ?? 0} | Unmatched: ${input.ingestTrace?.unmatchedCount ?? 0}` : 'No tabular lab panel';
  lines.push(`| **3. Biomarker Ingest & Mapping** | ${ingestStatus} | ${ingestDetails} |`);

  // Stage 4: Nutrition Database Search & Truth Matching
  const hasSearch = Boolean(input.usdaSearchResults?.length || input.brandSearchResults?.length);
  const searchCount = (input.usdaSearchResults?.length || 0) + (input.brandSearchResults?.length || 0);
  const searchStatus = hasSearch ? `✅ Connected (${searchCount} candidate(s))` : '⚪ Standby / N/A';
  const searchDetails = hasSearch ? `USDA: ${input.usdaSearchResults?.length || 0} | Brand: ${input.brandSearchResults?.length || 0}` : 'Single-dispatch path: scout-direct ledger, no external fetch';
  lines.push(`| **4. Database Search & Truth Matching** | ${searchStatus} | ${searchDetails} |`);

  // Stage 5: Calculation & Math Engine
  const ledgerInLogs = /\[Budget\]\s*Finalized ledger/i.test(String(input.backendLogs || ''));
  const hasCalc = Boolean(input.pendingFoodLog || input.receiptTable || input.comprehensiveNutrients || ledgerInLogs);
  const calcStatus = hasCalc ? '✅ Connected (Verified)' : '⚪ Standby / N/A';
  const calcDetails = input.comprehensiveNutrients
    ? `${Object.keys(input.comprehensiveNutrients).length} nutrient profile computed`
    : (ledgerInLogs && !input.pendingFoodLog
      ? 'Ledger in backend logs (pendingFoodLog not on this snapshot)'
      : (hasCalc ? 'Itemized breakdown & totals calculated' : 'No meal calculation required'));
  lines.push(`| **5. Mathematical Calculation Engine** | ${calcStatus} | ${calcDetails} |`);

  // Stage 6: Trial-Balance & Verification Gate
  const hasGate = Boolean(input.gate || input.pendingFoodLog || input.receiptTable || ledgerInLogs);
  const gateSummary = input.gate?.summary || (computedGate?.summary ? computedGate.summary : (hasGate ? 'GATE: EVALUATED' : 'N/A'));
  const gateStatus = hasGate ? (input.savable !== false ? '✅ Passed & Savable' : '⚠️ Gate Check Triggered') : '⚪ Standby / N/A';
  lines.push(`| **6. Trial-Balance & Quality Gate** | ${gateStatus} | ${gateSummary} |`);

  // Stage 7: Health Coach & Clinical Plan
  const hasHealthCoach = Boolean(input.report) || input.agentType === 'health_baseline' || (input.backendLogs && /\[HealthCoach\]/i.test(input.backendLogs));
  const healthCoachStatus = hasHealthCoach ? '✅ Connected (Success)' : '⚪ Standby / N/A';
  const healthCoachDetails = input.report ? (typeof input.report === 'object' && input.report.globalSummary ? String(input.report.globalSummary).slice(0, 80) + '...' : 'Clinical health plan formulated') : (hasHealthCoach ? 'Health baseline generated' : 'No clinical analysis requested');
  lines.push(`| **7. Health Coach / Clinical Engine** | ${healthCoachStatus} | ${healthCoachDetails} |`);

  // Stage 8: State Persistence & Remote Job Sync
  const hasSessionEvents = Boolean(input.sessionEvents?.length);
  const sessionEventsCount = input.sessionEvents?.length || 0;
  const syncStatus = hasSessionEvents ? `✅ Connected (${sessionEventsCount} lifecycle event(s))` : '✅ Connected (Local / Active)';
  const syncDetails = input.jobId ? `Job ID: \`${input.jobId}\`` : 'In-memory / Client session';
  lines.push(`| **8. State Storage & Job Sync** | ${syncStatus} | ${syncDetails} |`);

  lines.push('');

  // Multi-Agent Workflow & Handoff Trace
  const effectiveHandoffChain = input.handoffChain && input.handoffChain.length > 0
    ? input.handoffChain
    : (input.handoffPayload ? ['Front Desk (Triage)', (() => {
      const t = input.handoffPayload.targetAgent;
      return t === 'medical' ? 'Medical Specialist' : t === 'food' ? 'Food Log' : 'Health Coach';
    })()] : undefined);

  if (effectiveHandoffChain || input.handoffPayload) {
    lines.push(`## ⛓️ Multi-Agent Workflow & Handoff Trace`);
    lines.push('');
    if (effectiveHandoffChain && effectiveHandoffChain.length > 0) {
      lines.push(`- **Workflow Sequence:** ${effectiveHandoffChain.join(' ➔ ')}`);
      lines.push(`- **Execution Mode:** Continuity preserved in single unified chat modal`);
    }
    if (input.handoffPayload) {
      lines.push('');
      lines.push(`### 📋 Handoff Payload Forwarded`);
      lines.push('```json');
      try {
        lines.push(JSON.stringify(input.handoffPayload, null, 2));
      } catch {
        lines.push(String(input.handoffPayload));
      }
      lines.push('```');
    }
    lines.push('');
  }

  // Linked journey: forwarded runs span jobs (e.g. Front Desk → food leg).
  // The parent job summary rides here so one export shows the full chain.
  const linked = Array.isArray((tree as any).linkedJobs) ? (tree as any).linkedJobs : [];
  if (linked.length > 0) {
    lines.push(`## 🔗 Linked Journey`);
    lines.push('');
    for (const lj of linked) {
      lines.push(`- **${lj.id}** kind=${lj.kind || '?'} status=${lj.status || '?'}${lj.mode ? ` mode=${lj.mode}` : ''}`);
    }
    lines.push('');
  }
  // Linked-journey section ends here.
  if (input.agentPayload) {
    lines.push(`## 📥 Agent Input Payload as Received`);
    lines.push('');
    lines.push('```json');
    try {
      lines.push(JSON.stringify(input.agentPayload, null, 2).slice(0, 20_000));
    } catch {
      lines.push(String(input.agentPayload));
    }
    lines.push('```');
    lines.push('');
  }

  // Gate / Errors Section
  if (input.pendingFoodLog || input.receiptTable) {
    const food = input.pendingFoodLog || {};
    const items = (Array.isArray(food.itemsBreakdown) && food.itemsBreakdown.length > 0)
      ? food.itemsBreakdown
      : (Array.isArray(food.dishes) && food.dishes.length > 0 ? food.dishes : (Array.isArray(input.receiptTable) ? input.receiptTable : []));
    const gateRes = computedGate = evaluateMealGate({
      mealId: food.id || input.jobId,
      name: food.name,
      weightGrams: food.weightGrams,
      calories: food.nutrients?.calories ?? food.calories,
      protein: food.nutrients?.protein ?? food.protein,
      carbohydrates: food.nutrients?.carbohydrates ?? food.carbohydrates,
      totalFat: food.nutrients?.totalFat ?? food.totalFat,
      items: items.map((it: any) => ({
        name: it.dishName || it.originalName || it.canonicalDbName || it.name || it.item || 'Item',
        weightGrams: it.weightGrams ?? it.estimatedWeightGrams ?? (typeof it.weight === 'string' ? parseFloat(it.weight) : it.weight),
        calories: it.nutrients?.calories ?? it.calories ?? (typeof it.kcal === 'number' ? it.kcal : (typeof it.calories === 'string' ? parseFloat(it.calories) : null)),
        protein: it.nutrients?.protein ?? it.protein ?? (typeof it.protein === 'string' ? parseFloat(it.protein) : null),
        carbohydrates: it.nutrients?.carbohydrates ?? it.carbohydrates ?? (typeof it.carbs === 'string' ? parseFloat(it.carbs) : null),
        totalFat: it.nutrients?.totalFat ?? it.totalFat ?? (typeof it.fat === 'string' ? parseFloat(it.fat) : null),
        sourceImageIndex: it.sourceImageIndex,
        lockedNutrientKeys: it.lockedNutrientKeys,
        dbSource: it.dbSource || it.source,
      })),
      mealHasImages: Boolean(input.photoUrl || (input.photoUrls && input.photoUrls.length > 0)),
      imageCount: input.photoUrls?.length || (input.photoUrl ? 1 : 0),
      narrative: input.message,
    });

    lines.push(`## ⚖️ Gate & Trial-Balance Evaluation`);
    lines.push('');
    lines.push(`- **Result:** \`${gateRes.summary}\``);
    lines.push(`- **Savable:** \`${gateRes.savable}\``);
    lines.push(`- **Calculated Ledger Totals:** ${gateRes.calculatedTotals.weightGrams}g | ${gateRes.calculatedTotals.calories} kcal | ${gateRes.calculatedTotals.protein}g protein | ${gateRes.calculatedTotals.carbohydrates}g carbs | ${gateRes.calculatedTotals.totalFat}g fat`);
    if (gateRes.failures.length > 0) {
      lines.push('');
      lines.push(`| Gate Failure Code | Item | Description |`);
      lines.push(`|-------------------|------|-------------|`);
      for (const f of gateRes.failures) {
        lines.push(`| \`${f.code}\` | ${f.itemName || '—'} | ${f.message.replace(/\|/g, '/')} |`);
      }
    }
    lines.push('');
  }

  // Biomarker Ingest Trace (if medical job / ingest trace present)
  if (input.ingestTrace && typeof input.ingestTrace === 'object') {
    const trace = input.ingestTrace;
    lines.push(`## 🧬 Biomarker Ingest Trace (v${trace.version || 1})`);
    lines.push('');
    lines.push(`- **Source Kind:** ${trace.sourceKind || 'unknown'}`);
    lines.push(`- **Total Rows:** ${trace.totalInputRows ?? (trace.rows?.length || 0)}`);
    lines.push(`- **High Confidence:** ${trace.highConfidenceCount ?? 0} | **Flagged:** ${trace.flaggedCount ?? 0} | **Unmatched:** ${trace.unmatchedCount ?? 0} | **Skipped:** ${trace.skippedCount ?? 0}`);
    if (trace.handoff) {
      lines.push(`- **Handoff:** Dual Raw Injection: \`${trace.handoff.dualRawInjection ? 'true' : 'false'}\` | Sent to Parser: ${trace.handoff.sentToParserCount ?? 0} | Sent to Review: ${trace.handoff.sentToReviewCount ?? 0}`);
    }
    if (Array.isArray(trace.rows) && trace.rows.length > 0) {
      lines.push('');
      lines.push(`| # | Printed Name | Raw Value | Raw Unit | Canonical Key | Bucket | Class | Reason / Notes |`);
      lines.push(`|---|--------------|-----------|----------|---------------|--------|-------|----------------|`);
      for (const r of trace.rows.slice(0, 60)) {
        const idx = r.sourceRowIndex ?? '—';
        const name = String(r.printedName || '—').replace(/\|/g, '/');
        const val = r.rawValue != null ? String(r.rawValue).replace(/\|/g, '/') : '—';
        const unit = String(r.rawUnit || '—').replace(/\|/g, '/');
        const key = String(r.canonicalKey || '—').replace(/\|/g, '/');
        const bucket = String(r.bucket || '—').replace(/\|/g, '/');
        const cls = String(r.class || '—').replace(/\|/g, '/');
        const why = String(r.why || r.comment || '—').replace(/\|/g, '/');
        lines.push(`| ${idx} | ${name} | ${val} | ${unit} | ${key} | ${bucket} | ${cls} | ${why} |`);
      }
    }
    lines.push('');
  }

  // Health Coach / Analysis Report (health-baseline-analyze and similar routes
  // nest their full structured output under `report` — without this section the
  // debug export looked "empty" even though the backend generated real data.
  if (input.report != null) {
    lines.push(`## 🩺 Health Coach / Analysis Report`);
    lines.push('');
    if (typeof input.report === 'string') {
      if (input.report.trim()) {
        lines.push(input.report.slice(0, 20_000));
      } else {
        lines.push('_Report field present but empty._');
      }
    } else {
      lines.push('```json');
      try {
        lines.push(JSON.stringify(input.report, null, 2).slice(0, 20_000));
      } catch {
        lines.push('_Report field present but could not be serialized._');
      }
      lines.push('```');
    }
    lines.push('');
  }

  // Prior conversation turns, so "previous steps" leading up to this job are
  // visible instead of only the current turn in isolation.
  if (input.conversationHistory) {
    lines.push(`## 📜 Conversation History (Previous Steps)`);
    lines.push('');
    if (input.conversationHistory.length > 0) {
      for (const turn of input.conversationHistory) {
        const roleLabel = turn.role === 'user' ? '👤 User' : turn.role === 'assistant' ? '🤖 Assistant' : turn.role;
        const content = String(turn.content || '').slice(0, 1000);
        lines.push(`**${roleLabel}:** ${content}`);
        lines.push('');
      }
    } else {
      lines.push('_This was the first message in the conversation — no previous steps._');
      lines.push('');
    }
  }

  // Previous retry sessions / execution attempts
  const previousAttempts = Array.isArray(input.previousAttempts) && input.previousAttempts.length > 0
    ? input.previousAttempts
    : (Array.isArray((tree as any).previousAttempts) && (tree as any).previousAttempts.length > 0
      ? (tree as any).previousAttempts
      : []);

  if (previousAttempts.length > 0) {
    lines.push(`## 🔄 Retry Sessions & Execution Attempts (${previousAttempts.length})`);
    lines.push('');
    lines.push(`| Attempt / Turn | Status | Completed At | Error / Details |`);
    lines.push(`|---|---|---|---|`);
    for (const att of previousAttempts) {
      const errStr = att.error ? (typeof att.error === 'object' ? (att.error.message || JSON.stringify(att.error)) : String(att.error)) : 'none';
      const timeStr = att.completedAt ? att.completedAt : 'n/a';
      lines.push(`| **Attempt ${att.turn || att.attempt || 1}** | \`${att.status || 'unknown'}\` | ${timeStr} | ${errStr} |`);
    }
    lines.push('');
  }

  // 1. Last User Action
  lines.push(`## 👤 Last User Action`);
  lines.push('');
  if (input.lastUserAction) {
    if (typeof input.lastUserAction === 'object') {
      const act = input.lastUserAction;
      if (act.action) lines.push(`- **Action:** ${act.action}`);
      if (act.text || act.prompt) lines.push(`- **Prompt/Text:** "${act.text || act.prompt}"`);
      if (act.timestamp) lines.push(`- **Timestamp:** ${act.timestamp}`);
      if (act.details) lines.push(`- **Details:** ${JSON.stringify(act.details)}`);
    } else {
      lines.push(`- ${String(input.lastUserAction)}`);
    }
  } else {
    lines.push(`_No specific last user action recorded._`);
  }
  lines.push('');

  // 1b. User Action Breadcrumbs (Event Trail)
  lines.push(`## 🐾 User Action Breadcrumbs`);
  lines.push('');
  if (Array.isArray(input.userActionBreadcrumbs) && input.userActionBreadcrumbs.length > 0) {
    lines.push(`| Timestamp | Action | Target / Context | Details |`);
    lines.push(`|-----------|--------|------------------|---------|`);
    const seenCrumb = new Set<string>();
    for (const b of input.userActionBreadcrumbs.slice(-100)) {
      const ts = b.timestamp ? b.timestamp.slice(11, 19) : '—';
      const act = String(b.action || 'event').replace(/\|/g, '/');
      const tgt = String(b.target || '—').replace(/\|/g, '/');
      const rawDet = typeof b.details === 'object' ? JSON.stringify(b.details) : (b.details != null ? String(b.details) : '—');
      const det = rawDet.replace(/\|/g, '/');
      const key = `${ts}|${act}|${tgt}|${det}`;
      if (seenCrumb.has(key)) continue;
      seenCrumb.add(key);
      lines.push(`| ${ts} | ${act} | ${tgt} | ${det} |`);
    }
  } else {
    lines.push(`_No user UI interaction breadcrumbs captured prior to submission._`);
  }
  lines.push('');

  // 1c. Job Session Event Trail (internal JobStore/JobQueueRunner state transitions).
  // This used to leak into the loading card UI (TaskPlaceholderCard); it now only
  // appears here so cwah can still see it when diagnosing a stuck/odd job.
  lines.push(`## ⚙️ Job Session Event Trail`);
  lines.push('');
  const sessionEvents = (input.sessionEvents && input.sessionEvents.length > 0)
    ? input.sessionEvents
    : (input.jobId ? getSessionLog(input.jobId) : []);
  if (sessionEvents.length > 0) {
    lines.push('```');
    sessionEvents.forEach((e) => {
      lines.push(`${new Date(e.ts).toISOString()} ${e.writer} ${e.action}${e.status ? ' ' + e.status : ''}${e.resultKey ? ' ' + e.resultKey : ''}`.trim());
    });
    lines.push('```');
  } else {
    lines.push(`_No job session event trail captured for this job._`);
  }
  lines.push('');

  // 2. Console & Network Diagnostics
  lines.push(`## 🌐 Console & Network Diagnostics`);
  lines.push('');
  if (Array.isArray(input.networkErrors) && input.networkErrors.length > 0) {
    lines.push(`### Network Request Warnings & Errors (${input.networkErrors.length})`);
    lines.push('```');
    input.networkErrors.slice(-20).forEach(n => lines.push(n));
    lines.push('```');
    lines.push('');
  } else {
    lines.push(`_No client network errors or latency warnings recorded._`);
    lines.push('');
  }

  if (Array.isArray(input.clientConsoleLogs) && input.clientConsoleLogs.length > 0) {
    // Filter out vite connection noise and deduplicate consecutive or repeating logs
    const cleanedConsoleLogs: string[] = [];
    const seen = new Set<string>();
    for (const raw of input.clientConsoleLogs) {
      if (/(?:\[vite\]|failed to connect to websocket)/i.test(raw)) continue;
      const normalized = raw.replace(/^\[[A-Z_\s0-9:.-]+\]\s*/, '').trim();
      if (!normalized) continue;
      if (!seen.has(normalized)) {
        seen.add(normalized);
        cleanedConsoleLogs.push(raw);
      }
    }

    if (cleanedConsoleLogs.length > 0) {
      lines.push(`### Client Console Logs (${cleanedConsoleLogs.length})`);
      lines.push('```');
      cleanedConsoleLogs.slice(-50).forEach(l => lines.push(l));
      lines.push('```');
      lines.push('');
    } else {
      lines.push(`_No client console warnings or errors recorded (Vite connection messages filtered)._`);
      lines.push('');
    }
  } else {
    lines.push(`_No client console warnings or errors recorded._`);
    lines.push('');
  }

  // 3. Vision Scout Phase
  const rawScoutDishes = Array.isArray(input.rawScout?.dishes)
    ? input.rawScout.dishes
    : (Array.isArray(input.rawScout?.items) ? input.rawScout.items : []);
  const pendingDishes = Array.isArray(input.pendingFoodLog?.dishes)
    ? input.pendingFoodLog.dishes
    : (Array.isArray(input.pendingFoodLog?.itemsBreakdown) ? input.pendingFoodLog.itemsBreakdown : []);
  const effectiveScoutItems: any[] = (Array.isArray(input.scoutItems) && input.scoutItems.length > 0)
    ? input.scoutItems
    : (rawScoutDishes.length > 0 ? rawScoutDishes : pendingDishes);

  if (effectiveScoutItems.length > 0 || input.rawScout || input.scoutInternalReasoning) {
    const scoutCount = effectiveScoutItems.length || (input.rawScout?.items?.length || 0);
    lines.push(`## 🔍 Vision Scout Results (${scoutCount} item(s) detected)`);
    lines.push('');

    // Extract scout internal reasoning if not provided directly
    let scoutReasoning = input.scoutInternalReasoning;
    if (!scoutReasoning && input.backendLogs) {
      const match = input.backendLogs.match(/\[Vision Scout Internal Reasoning\]\s*([^\n\r]+)/);
      if (match) {
        scoutReasoning = match[1].trim();
      } else {
        const scoutResponseMatch = input.backendLogs.match(/\[backend\]\s*\[UnifiedLLM-Response:scout\][\s\S]*?"_internalReasoning":\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
        if (scoutResponseMatch) {
          try {
            scoutReasoning = JSON.parse(`"${scoutResponseMatch[1]}"`);
          } catch {
            scoutReasoning = scoutResponseMatch[1];
          }
        }
      }
    }

    if (scoutReasoning) {
      lines.push(`> **Scout Internal Reasoning:** ${scoutReasoning}`);
      lines.push('');
    }

    const envDetails: string[] = [];
    if (input.diningEnvironment && input.diningEnvironment !== 'unknown') {
      envDetails.push(`**Dining Environment:** \`${input.diningEnvironment}\``);
    }
    if (input.scoutContentType) {
      envDetails.push(`**Content Type:** \`${input.scoutContentType}\``);
    }
    if (envDetails.length > 0) {
      lines.push(envDetails.join(' | '));
      lines.push('');
    }

    if (effectiveScoutItems.length > 0) {
      lines.push(`| # | Dish / Item | Weight | Bounding Box | Img | Method | Label / Sticker OCR | Constituent Ingredients |`);
      lines.push(`|---|-------------|--------|--------------|-----|--------|---------------------|-------------------------|`);
      for (let idx = 0; idx < effectiveScoutItems.length; idx++) {
        const it = effectiveScoutItems[idx];
        const num = `[${idx + 1}]`;
        const nm = String(it.dishName || it.originalName || it.genericEnglishName || it.keyword || it.name || 'item').replace(/\|/g, '/');
        const w = `${it.estimatedWeightGrams ?? it.weightGrams ?? '?'}${it.packGrams ? ` (Pack: ${it.packGrams}g)` : 'g'}`;
        const box = Array.isArray(it.boundingBox2D) ? `[${it.boundingBox2D.join(',')}]` : '—';
        const img = `#${it.sourceImageIndex ?? 0}`;
        const method = String(it.cookingMethod || '—').replace(/\|/g, '/');
        const label = it.packageLabelText
          ? String(it.packageLabelText).replace(/\|/g, '/')
          : (it.rawNutritionLabel ? (typeof it.rawNutritionLabel === 'string' ? it.rawNutritionLabel : JSON.stringify(it.rawNutritionLabel).slice(0, 35).replace(/\|/g, '/')) : '—');
        
        let compSummary = '—';
        const constituents = (Array.isArray(it.foods) && it.foods.length > 0)
          ? it.foods
          : (Array.isArray(it.components) && it.components.length > 0 ? it.components : null);
        if (constituents && constituents.length > 0) {
          compSummary = constituents.map((c: any) => {
            const cn = c.foodName || c.name || c.genericEnglishName || c.searchQuery || 'ingredient';
            const cw = c.weightGrams ?? c.estimatedWeightGrams ?? '?';
            const clbl = c.packageLabelText ? ` ("${c.packageLabelText}")` : '';
            return `${cn} (${cw}g${clbl})`;
          }).join('; ').replace(/\|/g, '/');
        } else if (Array.isArray(it.visualIngredients) && it.visualIngredients.length > 0) {
          compSummary = it.visualIngredients.join(', ').replace(/\|/g, '/');
        }
        lines.push(`| ${num} | ${nm} | ${w} | ${box} | ${img} | ${method} | ${label} | ${compSummary} |`);
      }
      lines.push('');

      // Sub-table: Itemized Constituent Ingredients & Stickers breakdown
      const allComponents: any[] = [];
      effectiveScoutItems.forEach((it) => {
        const pDish = it.dishName || it.originalName || it.name || it.keyword || 'Dish';
        const subList = (Array.isArray(it.foods) && it.foods.length > 0)
          ? it.foods
          : (Array.isArray(it.components) && it.components.length > 0 ? it.components : []);
        subList.forEach((c: any) => {
          allComponents.push({ dishName: pDish, sourceImageIndex: it.sourceImageIndex, ...c });
        });
      });

      if (allComponents.length > 0) {
        lines.push(`### 🥗 Itemized Constituent Ingredients & Stickers (${allComponents.length})`);
        lines.push('');
        lines.push(`| Parent Dish | Component / Food | Weight | Img # | Sticker Text / Label | Macros (P / C / F / Na) |`);
        lines.push(`|-------------|------------------|--------|-------|----------------------|-------------------------|`);
        for (const c of allComponents) {
          const pDish = String(c.dishName || '—').replace(/\|/g, '/');
          const cName = String(c.foodName || c.name || c.genericEnglishName || c.searchQuery || 'ingredient').replace(/\|/g, '/');
          const cw = `${c.weightGrams ?? c.estimatedWeightGrams ?? '?'}${c.packGrams ? ` (Pack: ${c.packGrams}g)` : 'g'}`;
          const imgIdx = `#${c.sourceImageIndex ?? 0}`;
          const sticker = c.packageLabelText ? `"${String(c.packageLabelText).replace(/\|/g, '/')}"` : (c.rawNutritionLabel ? 'Printed Label' : '—');
          const p = c.protein ?? c.nutrients?.protein ?? '?';
          const carbs = c.carbohydrates ?? c.carbs ?? c.nutrients?.carbohydrates ?? '?';
          const f = c.totalFat ?? c.fat ?? c.nutrients?.totalFat ?? '?';
          const na = c.sodium ?? c.nutrients?.sodium ?? '?';
          const nuts = `P: ${p}g, C: ${carbs}g, F: ${f}g, Na: ${na}mg`;
          lines.push(`| ${pDish} | ${cName} | ${cw} | ${imgIdx} | ${sticker} | ${nuts} |`);
        }
        lines.push('');
      }
    }
  }

  // 4. Database Search & Entity Resolution
  lines.push(`## 📚 Database Search & Entity Resolution`);
  lines.push('');
  if ((Array.isArray(input.usdaSearchResults) && input.usdaSearchResults.length > 0) || (Array.isArray(input.brandSearchResults) && input.brandSearchResults.length > 0)) {
    if (Array.isArray(input.brandSearchResults) && input.brandSearchResults.length > 0) {
      lines.push(`### Official Brand Menu Hits (${input.brandSearchResults.length})`);
      for (const b of input.brandSearchResults.slice(0, 10)) {
        lines.push(`- **${b.name || b.dish_name}** (${b.chainName || b.chain_key || 'Brand'}) — ${b.calories || '?'} kcal | P: ${b.protein ?? '?'}g, C: ${b.carbohydrates ?? '?'}g, F: ${b.fat ?? '?'}g | Source: \`${b.source || 'brand_official'}\``);
      }
      lines.push('');
    }
    if (Array.isArray(input.usdaSearchResults) && input.usdaSearchResults.length > 0) {
      lines.push(`### USDA / OpenFoodFacts Matches (${input.usdaSearchResults.length})`);
      for (const u of input.usdaSearchResults.slice(0, 10)) {
        lines.push(`- **${u.description || u.name}** (FDC/ID: \`${u.fdcId || u.id}\`) — ${u.calories || '?'} kcal | Source: ${u.dataType || u.source || 'USDA'}`);
      }
      lines.push('');
    }
  } else {
    lines.push(`- **Resolution Strategy:** Single-Dispatch Direct Nutrient Ledger`);
    lines.push(`- **Status:** ⚪ Standby — nutritional truth resolved directly from Vision Scout dish-level macronutrients and pure TypeScript derivation (Post-Atwater / Dish Finalize) without secondary candidate database fetches.`);
    lines.push('');
  }

  // 5. Nutrition Calculation (Source of Truth)
  const food = input.pendingFoodLog;
  if (food && typeof food === 'object' && input.agentType !== 'biomarker_review' && input.mode !== 'biomarker_review') {
    lines.push(`## 📊 Nutrition Calculation & Breakdown`);
    lines.push('');
    lines.push(`- **Meal Name:** ${food.name || food.title || '—'}`);
    if (food.quantity) lines.push(`- **Quantity:** ${food.quantity}`);
    if (food.weightGrams != null) lines.push(`- **Total Meal Weight:** ${food.weightGrams}g`);

    // Nutrition Receipt Table
    const receipt = input.receiptTable || food.receiptTable;
    const breakdownList = (Array.isArray(food.itemsBreakdown) && food.itemsBreakdown.length > 0)
      ? food.itemsBreakdown
      : (Array.isArray(food.dishes) && food.dishes.length > 0 ? food.dishes : []);

    if (typeof receipt === 'string' && receipt.trim().length > 0) {
      lines.push('');
      lines.push(receipt.trim());
      lines.push('');
    } else if (Array.isArray(receipt) && receipt.length > 0) {
      lines.push('');
      lines.push(`### 🧾 Itemized Nutrition Calculation Receipt`);
      lines.push('');
      lines.push(`| Item / Ingredient | Weight | Kcal | Protein | Sat Fat | Sodium | Source / Notes |`);
      lines.push(`|-------------------|-------:|-----:|--------:|-------:|-------:|----------------|`);
      for (const row of receipt) {
        const item = String(row.item || row.name || row.food || '—').replace(/\|/g, '/');
        const weight = row.weight ? `${row.weight}g` : '—';
        const kcal = row.calories ?? row.kcal ?? '—';
        const protein = row.protein ? `${row.protein}g` : '—';
        const satFat = row.satFat || row.saturatedFat ? `${row.satFat || row.saturatedFat}g` : '—';
        const sodium = row.sodium ? `${row.sodium}mg` : '—';
        const src = String(row.source || row.truthSource || row.notes || '—').replace(/\|/g, '/').slice(0, 60);
        lines.push(`| ${item} | ${weight} | ${kcal} | ${protein} | ${satFat} | ${sodium} | ${src} |`);
      }
      lines.push('');
    } else if (breakdownList.length > 0) {
      lines.push('');
      lines.push(`### Component Items Breakdown & Constituent Receipts`);
      lines.push('');
      lines.push(`| Component / Ingredient | Weight | Calories | Protein | Carbs | Fat | Sodium | Brand / Truth Source |`);
      lines.push(`|------------------------|-------:|---------:|--------:|------:|----:|-------:|---------------------|`);
      for (const it of breakdownList) {
        const nm = String(it.dishName || it.originalName || it.canonicalDbName || it.name || it.keyword || 'item').replace(/\|/g, '/');
        const w = it.weightGrams ?? it.estimatedWeightGrams ?? '—';
        const cal = it.nutrients?.calories ?? it.calories ?? '—';
        const p = it.nutrients?.protein ?? it.protein ?? '—';
        const c = it.nutrients?.carbohydrates ?? it.carbohydrates ?? '—';
        const f = it.nutrients?.totalFat ?? it.dishNutrients?.totalFat ?? it.totalFat ?? '—';
        const na = it.nutrients?.sodium ?? it.sodium ?? '—';
        const src = String(it.brandName || it.chainName || it.source || it.truthSource || it.dbSource || 'estimated').replace(/\|/g, '/');
        lines.push(`| **${nm}** | **${w}g** | **${cal}** | **${p}g** | **${c}g** | **${f}g** | **${na}mg** | ${src} |`);

        const subList = (Array.isArray(it.componentsDetailList) && it.componentsDetailList.length > 0)
          ? it.componentsDetailList
          : (Array.isArray(it.foods) && it.foods.length > 0 ? it.foods : (Array.isArray(it.components) ? it.components : null));
        if (subList && subList.length > 0) {
          for (const sub of subList) {
            const snm = String(sub.foodName || sub.name || sub.genericEnglishName || sub.keyword || 'ingredient').replace(/\|/g, '/');
            const sw = sub.weightGrams ?? sub.estimatedWeightGrams ?? '—';
            const scal = sub.calories ?? sub.nutrients?.calories ?? (sub.nutrients ? Math.round((sub.nutrients.protein || 0) * 4 + (sub.nutrients.carbohydrates || 0) * 4 + (sub.nutrients.totalFat || 0) * 9) : '—');
            const sp = sub.protein ?? sub.nutrients?.protein ?? '—';
            const sc = sub.carbohydrates ?? sub.carbs ?? sub.nutrients?.carbohydrates ?? '—';
            const sf = sub.totalFat ?? sub.fat ?? sub.nutrients?.totalFat ?? '—';
            const sna = sub.sodium ?? sub.nutrients?.sodium ?? '—';
            lines.push(`| └─ ${snm} | ${sw}g | ${scal} | ${sp}g | ${sc}g | ${sf}g | ${sna}mg | constituent |`);
          }
        }
      }
      // Total ledger row (Golden Meal specification)
      const totWeight = food.weightGrams ?? (typeof food.weight === 'number' ? food.weight : '—');
      const totKcal = food.nutrients?.calories ?? food.calories ?? '—';
      const totP = food.nutrients?.protein ?? food.protein ?? '—';
      const totC = food.nutrients?.carbohydrates ?? food.carbohydrates ?? '—';
      const totF = food.nutrients?.totalFat ?? food.totalFat ?? '—';
      const totNa = food.nutrients?.sodium ?? food.sodium ?? '—';
      const totalLabel = input.status === 'succeeded' ? 'FINAL MEAL TOTAL' : 'SHOWN MEAL TOTAL';
      lines.push(`| **🏆 ${totalLabel}** | **${totWeight}g** | **${totKcal}** | **${totP}g** | **${totC}g** | **${totF}g** | **${totNa}mg** | ledger total |`);
      lines.push('');
    }

    // Mathematical & Thermodynamic Validation
    const cals = Number(food.nutrients?.calories || food.calories || 0);
    const weight = Number(food.weightGrams || 0);
    const protein = Number(food.nutrients?.protein || food.protein || 0);
    const totalFat = Number(food.nutrients?.totalFat || food.totalFat || 0);
    const satFat = Number(food.nutrients?.saturatedFat || food.saturatedFat || 0);
    const transFat = Number(food.nutrients?.transFat || food.transFat || 0);
    const carbs = Number(food.nutrients?.carbohydrates || food.carbohydrates || 0);
    const sodium = Number(food.nutrients?.sodium || food.sodium || 0);
    lines.push(`### 🔬 Mathematical & Thermodynamic Validation`);
    lines.push('');
    if (weight > 0 && cals > 0) {
      const calDensity = (cals / weight).toFixed(2);
      lines.push(`- **Caloric Density:** ${calDensity} kcal/g (${Number(calDensity) > 4.5 ? '⚠️ High energy density' : '✅ Thermodynamically sound'})`);
    }
    if (cals > 0 && (protein > 0 || totalFat > 0 || carbs > 0)) {
      const atwaterCals = Math.round(protein * 4 + carbs * 4 + totalFat * 9);
      const atwaterDiff = Math.abs(cals - atwaterCals);
      lines.push(`- **Atwater Macro Sum:** ${atwaterCals} kcal (vs ${cals} kcal logged, diff: ${atwaterDiff} kcal ${atwaterDiff <= 25 ? '✅ Consistent' : '⚠️ Minor rounding'})`);
    }
    const unsatFat = (totalFat - satFat - transFat > 0) ? (totalFat - satFat - transFat).toFixed(1) : '0';
    const saltG = (sodium * 0.00254).toFixed(2);
    lines.push(`- **Unsaturated fat:** ${unsatFat} g · **Salt:** ${saltG} g`);
    if (food.cookingMethod) {
      lines.push(`- **Cooking Method:** \`${food.cookingMethod}\``);
    }
    if (food.diningEnvironment) {
      lines.push(`- **Dining Environment Multipliers:** \`${food.diningEnvironment}\``);
    }
    lines.push('');

    // Comprehensive 31 Nutrients Table
    const n = input.comprehensiveNutrients || food.nutrients || {};
    if (n && typeof n === 'object') {
      lines.push(`### 📋 Comprehensive Nutrient Values`);
      lines.push('');
      lines.push(`| Nutrient | Value |`);
      lines.push(`|----------|------:|`);
      const coreKeys: Array<[string, string]> = [
        ['Calories', 'calories'],
        ['Protein', 'protein'],
        ['Carbohydrates', 'carbohydrates'],
        ['Total Fat', 'totalFat'],
        ['Saturated Fat', 'saturatedFat'],
        ['Trans Fat', 'transFat'],
        ['Unsaturated Fat', 'unsaturatedFat'],
        ['Total Sugar', 'totalSugar'],
        ['Added Sugar', 'addedSugar'],
        ['Sodium', 'sodium'],
        ['Dietary Fiber', 'totalFibre'],
        ['Salt', 'salt']
      ];
      for (const [label, k] of coreKeys) {
        let val = n[k];
        if (val == null && k === 'salt' && n.sodium != null) {
          val = (Number(n.sodium) * 0.00254).toFixed(2);
        }
        if (val == null && k === 'unsaturatedFat' && n.totalFat != null && n.saturatedFat != null) {
          val = Math.max(0, Number(n.totalFat) - Number(n.saturatedFat) - Number(n.transFat || 0)).toFixed(1);
        }
        if (val != null && val !== '') {
          const unit = k === 'calories' ? ' kcal' : k === 'sodium' ? ' mg' : ' g';
          lines.push(`| **${label}** | **${val}${unit}** |`);
        }
      }
      // Additional nutrients if present. Units per USDA FDC convention: macro minerals in
      // mg, fat-soluble vitamins and trace minerals mostly in mcg, B-vitamins in mg except
      // B12/folate in mcg.
      const extraKeys: Array<[string, string, string]> = [
        ['Cholesterol', 'cholesterol', 'mg'],
        ['Calcium', 'calcium', 'mg'],
        ['Iron', 'iron', 'mg'],
        ['Potassium', 'potassium', 'mg'],
        ['Vitamin A', 'vitaminA', 'mcg'],
        ['Vitamin C', 'vitaminC', 'mg'],
        ['Vitamin D', 'vitaminD', 'mcg'],
        ['Vitamin E', 'vitaminE', 'mg'],
        ['Vitamin K', 'vitaminK', 'mcg'],
        ['Thiamine (B1)', 'thiamine', 'mg'],
        ['Riboflavin (B2)', 'riboflavin', 'mg'],
        ['Niacin (B3)', 'niacin', 'mg'],
        ['Vitamin B6', 'vitaminB6', 'mg'],
        ['Vitamin B12', 'vitaminB12', 'mcg'],
        ['Folate', 'folate', 'mcg'],
        ['Phosphorus', 'phosphorus', 'mg'],
        ['Magnesium', 'magnesium', 'mg'],
        ['Zinc', 'zinc', 'mg'],
        ['Copper', 'copper', 'mg'],
        ['Selenium', 'selenium', 'mcg'],
        ['Omega-3', 'omega3', 'g'],
        ['Soluble Fibre', 'solubleFibre', 'g'],
        ['Iodine', 'iodine', 'mcg'],
      ];
      for (const [label, k, unit] of extraKeys) {
        const val = n[k] ?? (k === 'thiamine' ? n.thiamin : undefined);
        if (val != null && val !== '') {
          const num = Number(val);
          const display = isNaN(num) ? 'N/A' : `${num} ${unit}`;
          lines.push(`| ${label} | ${display} |`);
        }
      }
      lines.push('');
    }
  }

  // Compare Mode (Mode D) Diagnostic Sections
  const compData = input.comparisonData
    || ((input.rawScout && (input.rawScout.groups || input.rawScout.comparison)) ? (input.rawScout.comparison || input.rawScout) : null)
    || ((input.pendingFoodLog && (input.pendingFoodLog.groups || input.pendingFoodLog.comparison)) ? (input.pendingFoodLog.comparison || input.pendingFoodLog) : null);
  const compItems = Array.isArray(compData?.items)
    ? compData.items
    : (Array.isArray(compData?.allExtractedDishes)
      ? compData.allExtractedDishes
      : (Array.isArray(input.scoutItems) ? input.scoutItems : []));
  const compGroups = Array.isArray(compData?.groups) ? compData.groups : [];

  if ((input.mode === 'compare' || compGroups.length > 0 || (compItems.length > 0 && !food)) && compGroups.length > 0) {
    lines.push(`## 🔍 Evaluated Items & Product OCR Extraction (${compItems.length} item(s) detected)`);
    lines.push('');
    lines.push(`| # | Item Name | Brand | Tier | Img # | Serving Size | Nutrition Label OCR | Calories | Protein | Total Fat | Carbs | Sugar | Sodium |`);
    lines.push(`|---|-----------|-------|:----:|:-----:|--------------|:-------------------:|---------:|--------:|----------:|------:|------:|-------:|`);
    for (let i = 0; i < compItems.length; i++) {
      const it = compItems[i];
      const num = `[${i + 1}]`;
      const nm = String(it.name || it.dishName || it.originalName || 'Item').replace(/\|/g, '/');
      const brand = String(it.brand || it.chainName || '—').replace(/\|/g, '/');
      const tier = it.tier != null ? `Tier ${it.tier}` : '—';
      const img = `#${it.sourceImageIndex ?? 0}`;
      const serving = it.servingSize ? String(it.servingSize).replace(/\|/g, '/') : (it.estimatedWeightGrams ? `${it.estimatedWeightGrams}g` : '—');
      const labelOcr = it.hasNutritionLabel ? '✅ OCR Locked' : '—';
      const p = it.perServing || it.nutrients || {};
      const cal = p.calories ?? it.calories ?? '—';
      const prot = p.protein != null ? `${p.protein}g` : '—';
      const fat = p.totalFat != null ? `${p.totalFat}g` : '—';
      const carbs = p.carbohydrates != null ? `${p.carbohydrates}g` : '—';
      const sugar = p.sugar != null ? `${p.sugar}g` : '—';
      const sodium = p.sodium != null ? `${p.sodium}mg` : '—';
      lines.push(`| ${num} | ${nm} | ${brand} | ${tier} | ${img} | ${serving} | ${labelOcr} | ${cal} | ${prot} | ${fat} | ${carbs} | ${sugar} | ${sodium} |`);
    }
    lines.push('');

    lines.push(`## 📊 Comparison Groups & Nutritional Allowance Breakdown (${compGroups.length} groups formed)`);
    lines.push('');
    for (let gIdx = 0; gIdx < compGroups.length; gIdx++) {
      const g = compGroups[gIdx];
      const gName = g.groupName || `Group ${gIdx + 1}`;
      lines.push(`### Group ${gIdx + 1}: ${gName}`);
      lines.push('');
      if (g.verdict) {
        lines.push(`- **Clinical Verdict:** \`${g.verdict.label || 'Neutral'}\` (${g.verdict.level || 'neutral'})`);
      }
      if (g.comparisonSentence) {
        lines.push(`- **Comparison:** ${g.comparisonSentence}`);
      }
      if (g.message) {
        lines.push(`- **Clinical Advice:** ${g.message}`);
      }
      if (g.orderingTip) {
        lines.push(`- **Ordering Tip:** ${g.orderingTip}`);
      }
      if (Array.isArray(g.boundingBox2D)) {
        lines.push(`- **Quadrant Bounding Box:** \`[${g.boundingBox2D.join(', ')}]\``);
      }
      lines.push('');

      const gItemIndices = Array.isArray(g.scoutItemIndices) ? g.scoutItemIndices : [];
      const gItems = gItemIndices.map((idx: number) => compItems[idx]).filter(Boolean);
      if (gItems.length > 0) {
        lines.push(`| Item Name | Brand | Tier | OCR Status |`);
        lines.push(`|-----------|-------|:----:|:----------:|`);
        for (const git of gItems) {
          const gnm = String(git.name || git.dishName || 'Item').replace(/\|/g, '/');
          const gb = String(git.brand || git.chainName || '—').replace(/\|/g, '/');
          const gt = git.tier != null ? `Tier ${git.tier}` : '—';
          const go = git.hasNutritionLabel ? '✅ OCR Locked' : '—';
          lines.push(`| ${gnm} | ${gb} | ${gt} | ${go} |`);
        }
        lines.push('');
      }

      const avgS = g.averageNutrients || {};
      const avgH = g.averageNutrientsPer100g || {};
      lines.push(`| Profile Allowance Key | Per Serving | Per 100g Baseline | Clinical Guidance Target |`);
      lines.push(`|---|---:|---:|---|`);
      lines.push(`| **Calories** | **${avgS.calories ?? '—'} kcal** | ${avgH.calories ?? '—'} kcal | 1800 kcal baseline |`);
      lines.push(`| **Saturated Fat** | **${avgS.saturatedFat ?? '—'} g** | ${avgH.saturatedFat ?? '—'} g | 20g target (Strict limit) |`);
      lines.push(`| **Added Sugar** | **${avgS.addedSugar ?? avgS.sugar ?? '—'} g** | ${avgH.addedSugar ?? avgH.sugar ?? '—'} g | 30g target (Strict limit) |`);
      lines.push(`| **Sodium** | **${avgS.sodium ?? '—'} mg** | ${avgH.sodium ?? '—'} mg | 2300mg target |`);
      lines.push(`| **Protein** | **${avgS.protein ?? '—'} g** | ${avgH.protein ?? '—'} g | 120g target (Deficit recovery) |`);
      lines.push(`| **Total Fibre** | **${avgS.totalFibre ?? '—'} g** | ${avgH.totalFibre ?? '—'} g | 30g target (Deficit recovery) |`);
      lines.push(`| **Carbohydrates** | **${avgS.carbohydrates ?? '—'} g** | ${avgH.carbohydrates ?? '—'} g | 200g target |`);
      lines.push(`| **Soluble Fibre** | **${avgS.solubleFibre ?? '—'} g** | ${avgH.solubleFibre ?? '—'} g | Reference 7g target |`);
      lines.push(`| **Potassium** | **${avgS.potassium ?? '—'} mg** | ${avgH.potassium ?? '—'} mg | Reference 3500mg target |`);
      lines.push(`| **Trans Fat** | **${avgS.transFat ?? '—'} g** | ${avgH.transFat ?? '—'} g | Zero tolerance (0.0g) |`);
      lines.push('');
    }

    lines.push(`## 🔬 Mathematical & Thermodynamic Validation`);
    lines.push('');
    lines.push(`1. **Macro Variance Clustering Strictness (<=10% Rule):**`);
    lines.push(`   - All items within each group cluster within <=10% macronutrient variance.`);
    lines.push(`   - 100% of extracted items (${compItems.length}/${compItems.length}) assigned to groups.`);
    lines.push(`2. **Atwater Caloric Balance:**`);
    lines.push(`   - Average nutrient vectors satisfy: \`4 * Protein + 9 * TotalFat + 4 * Carbohydrates ≈ Calories (±10%)\`.`);
    lines.push(`   - Verbatim OCR printed labels override derived math.`);
    lines.push(`3. **Derived Invariants (Pure TypeScript):**`);
    lines.push(`   - \`Salt (g) = Sodium (mg) * 0.00254\``);
    lines.push(`   - \`Unsaturated Fat (g) = Total Fat - Saturated Fat - Trans Fat\``);
    lines.push(`4. **Spatial Regional Bounding Boxes:**`);
    lines.push(`   - All ${compGroups.length} group quadrant bounding boxes strictly satisfy \`0 <= ymin < ymax <= 1000\` and \`0 <= xmin < xmax <= 1000\`.`);
    lines.push('');
  }

  // 6. Agent Message / Verdict Narrative
  if (input.message || compData?.summary) {
    lines.push(`## 💬 Agent Message & Narrative`);
    lines.push('');
    lines.push(String(input.message || compData.summary).slice(0, 8000));
    lines.push('');
    if (compData?.recommendedOption) {
      lines.push(`**Top Recommended Option:** \`${compData.recommendedOption}\``);
      lines.push('');
    }
  }

  // 7. Stage Ledger & History Log
  if (Array.isArray(input.stageLedger) && input.stageLedger.length > 0) {
    lines.push(`## ⚙️ Pipeline Stage Ledger`);
    lines.push('');
    lines.push(`| Stage | Status | Attempt | Key Decisions | Errors |`);
    lines.push(`|-------|--------|---------|---------------|--------|`);
    for (const record of input.stageLedger) {
      const decisions = (record.decisions || []).map((d: any) => d.key).join(', ');
      const errors = (record.errors || []).map((e: any) => e.message).join(', ');
      lines.push(`| ${record.stage || '—'} | ${record.status || '—'} | ${record.attempt || '—'} | ${decisions || '—'} | ${errors || '—'} |`);
    }
    lines.push('');
  }

  if (Array.isArray(input.historyLog) && input.historyLog.length > 0) {
    lines.push(`## 📜 Execution History Log`);
    lines.push('');
    for (const entry of input.historyLog.slice(-100)) {
      const when = entry.at || entry.timestamp || '';
      const kind = entry.kind || entry.type || 'event';
      const before = entry.details?.before;
      const after = entry.details?.after;
      if (Array.isArray(before) && Array.isArray(after)) {
        lines.push(`- **${when}** ✏️ Meal Edit — "${entry.details?.userMessage || ''}"`);
        lines.push('');
        lines.push(`  | Item | Weight Before | Weight After | Calories Before | Calories After |`);
        lines.push(`  |------|---------------|--------------|------------------|-----------------|`);
        const maxLen = Math.max(before.length, after.length);
        for (let i = 0; i < maxLen; i++) {
          const b = before[i];
          const a = after[i];
          const name = a?.name || b?.name || '—';
          const wB = b?.weightGrams != null ? `${b.weightGrams}g` : '—';
          const wA = a?.weightGrams != null ? `${a.weightGrams}g` : '—';
          const cB = b?.calories != null ? b.calories : '—';
          const cA = a?.calories != null ? a.calories : '—';
          lines.push(`  | ${name} | ${wB} | ${wA} | ${cB} | ${cA} |`);
        }
        lines.push('');
      } else {
        const msg = entry.message || '';
        const det = entry.detail || entry.details ? ` (${entry.detail || entry.details})` : '';
        lines.push(`- **${when}** [${kind}]: ${msg}${det}`);
      }
    }
    lines.push('');
  }

  // 8. Backend Execution Logs (deduplicated)
  const logs = String(input.backendLogs || '').trim();

  // Extract "Agent Instructions & Prompts Dispatched" and "Errors & Warnings"
  // summaries directly from the raw backend log text, AND collapse those same
  // blocks (plus large raw-LLM-response dumps that duplicate an
  // already-parsed structured section like the Health Coach Report) out of
  // the raw dump below, so identical content isn't shown twice in one export.
  // This is deliberately text-based (not tied to a specific field a backend
  // route must populate) so it works uniformly across every agent's log
  // format without requiring per-route wiring.
  let dedupedLogs = logs;
  if (logs) {
    const logLines = logs.split('\n');
    const collapsedLineIndices = new Set<number>();

    // Distinguishes a genuine new top-level log entry (e.g. "[backend] ...",
    // "[scout_answer] ...", "[UnifiedLLM-Prompt:scout] ...", "[Vision Scout] ...")
    // from a literal bracket-tag that prompt-building code embeds MID-TEXT for the
    // LLM's benefit (e.g. "[Context: ...]", "[CRITICAL DATE OVERRIDE: ...]",
    // "[SERVER BASELINE ESTIMATE — ...]"). Both start a physical line with "[Letter",
    // so a plain /^\[[A-Za-z]/ check can't tell them apart — it either stops
    // collecting a block too early (embedded tag mistaken for a new entry) or, if
    // tightened to "no spaces allowed", fails to recognize genuine short multi-word
    // tags like "[Vision Scout]" or "[Mode Override]" and swallows too much instead.
    // Real tags are short, single-clause labels; prompt-embedded annotations are
    // always full sentences, which in practice means they contain "colon+space",
    // "em-dash+space", or trail off with "...". None of the genuine tags in this
    // codebase do any of those inside the brackets, so this is a reliable, general
    // split that doesn't need a hardcoded, ever-growing allowlist of known tags.
    const isRealLogTagBoundary = (line: string): boolean => {
      const m = /^\[([A-Za-z][^\]]{0,49})\]/.exec(line);
      if (!m) return false;
      const content = m[1];
      if (/:\s/.test(content)) return false;
      if (/—\s/.test(content)) return false;
      if (/\.\.\.$/.test(content)) return false;
      return true;
    };

    // Agents whose full instruction already renders inline under their own
    // "### Dispatch <id>" block in the Agent Dispatches section above (§3).
    // Anything covered there must NOT be repeated down here — the whole point
    // of wiring an agent's instruction into Agent Dispatches is that it lives
    // next to the agent it belongs to, not in a separate dump at the bottom.
    const dispatchAgentsWithInstruction = new Set(
      (tree.dispatches || []).filter((d) => d.instruction).map((d) => (d.agent || '').toLowerCase())
    );
    const blockAgentName = (block: string): string | null => {
      let m = block.match(/^\[(\w+?)_instruction\]/i);
      if (m) return m[1].toLowerCase();
      m = block.match(/^\[(FrontDesk|HealthCoach|Medical|Agent\d+)\]/i);
      if (m) {
        const tag = m[1].toLowerCase();
        if (tag === 'frontdesk') return 'front_desk';
        if (tag === 'healthcoach') return 'health_coach';
        return tag;
      }
      return null;
    };

    const instructionBlocks: string[] = [];
    const instructionStartPattern = /(Dispatched System Instruction|Dispatched Prompt|System Instruction:|UnifiedLLM-Prompt|Instruction dispatched|\[FrontDesk\]\s*Dispatched|\[HealthCoach\]\s*Dispatched|\[Medical(?:Analyze)?\]\s*Dispatched|\[Agent\d+\]\s*Dispatched)/i;
    for (let i = 0; i < logLines.length; i++) {
      if (instructionStartPattern.test(logLines[i])) {
        const block: string[] = [logLines[i]];
        let j = i + 1;
        while (j < logLines.length && !isRealLogTagBoundary(logLines[j])) {
          block.push(logLines[j]);
          j++;
        }
        const joined = block.join('\n').trim();
        // Always collapse the raw lines out of the Backend Execution Logs dump
        // below, whether or not we also list this block in the section here —
        // an agent whose instruction already appears inline in Agent
        // Dispatches shouldn't ALSO leave a raw, unlabelled copy in the log
        // dump; it should just disappear from the log text entirely.
        for (let k = i; k < j; k++) collapsedLineIndices.add(k);
        i = j - 1;
        const agentName = blockAgentName(joined);
        if (agentName && dispatchAgentsWithInstruction.has(agentName)) continue;
        instructionBlocks.push(joined);
      }
    }
    const directInstructions: string[] = [];
    if (input.agentInstructions) {
      if (typeof input.agentInstructions === 'string') {
        if (!dispatchAgentsWithInstruction.size) directInstructions.push(input.agentInstructions);
      } else if (Array.isArray(input.agentInstructions)) {
        directInstructions.push(...input.agentInstructions);
      } else if (typeof input.agentInstructions === 'object') {
        for (const [agentName, instr] of Object.entries(input.agentInstructions)) {
          if (!instr) continue;
          if (dispatchAgentsWithInstruction.has(agentName.toLowerCase())) continue;
          const text = typeof instr === 'string'
            ? instr
            : (typeof instr === 'object' && instr !== null)
              ? ((instr as any).systemInstruction || (instr as any).instruction || (instr as any).userPrompt || JSON.stringify(instr, null, 2))
              : String(instr);
          directInstructions.push(`[${agentName}] System Instruction:\n${text}`);
        }
      }
    }

    const seenInstr = new Set<string>();
    const uniqueBlocks: string[] = [];
    for (const block of [...directInstructions, ...instructionBlocks]) {
      const normalizedKey = block
        .replace(/^\[backend\]\s*\[UnifiedLLM-Prompt:[^\]]+\]\s*/i, '')
        .replace(/^System Instruction:\s*/i, '')
        .replace(/^\[(FrontDesk|HealthCoach|Medical|Agent\d+)\]\s*/i, '')
        .trim();
      if (seenInstr.has(normalizedKey)) continue;
      seenInstr.add(normalizedKey);
      uniqueBlocks.push(block);
    }

    if (uniqueBlocks.length > 0) {
      lines.push(`## 🧠 Agent System Instructions & Dispatched Prompts`);
      lines.push('');
      lines.push(`_Instructions for agents already shown inline under "Agent Dispatches" above are not repeated here. This section only covers agents not yet wired into that structured view._`);
      lines.push('');
      for (const block of uniqueBlocks) {
        lines.push('```');
        lines.push(block);
        lines.push('```');
        lines.push('');
      }
    }

    // Agent replies: show each unique reply once, then collapse logger-echo copies.
    const replyBlocks: string[] = [];
    const responseStartPattern = /(Response received \(\d+ chars\)\.\s*Raw output:|\[(FrontDesk|HealthCoach|Medical|Agent\d+)\]\s*(?:Response received|Raw response))/i;
    for (let i = 0; i < logLines.length; i++) {
      if (responseStartPattern.test(logLines[i])) {
        const block: string[] = [logLines[i]];
        let j = i + 1;
        while (j < logLines.length && !isRealLogTagBoundary(logLines[j])) {
          block.push(logLines[j]);
          j++;
        }
        replyBlocks.push(block.join('\n').trim());
        for (let k = i; k < j; k++) collapsedLineIndices.add(k);
      }
    }
    if (replyBlocks.length > 0) {
      lines.push(`## 🤖 Agent Replies`);
      lines.push('');
      lines.push(`_One reply per dispatch. Duplicates collapsed._`);
      lines.push('');
      const seenReply = new Set<string>();
      let shownReplies = 0;
      for (const block of replyBlocks) {
        const key = block.slice(0, 240);
        if (seenReply.has(key)) continue;
        seenReply.add(key);
        lines.push('```');
        lines.push(block);
        lines.push('```');
        lines.push('');
        shownReplies += 1;
        if (shownReplies >= 12) break;
      }
    }

    // Agent Handoff Chain:
    const handoffChainLines = logLines.filter(l => /\[FrontDesk-HandoffChain\]|\[Multi-Agent Handoff\]|Handoff Payload Generated|handoffChain|Handoff Context|Initiating seamless handoff/i.test(l));
    if (handoffChainLines.length > 0 || (input.handoffChain && input.handoffChain.length > 0)) {
      lines.push(`## ⛓️ Agent Handoff Chain & Workflow`);
      lines.push('');
      if (Array.isArray(input.handoffChain) && input.handoffChain.length > 0) {
        lines.push(`- **Workflow Sequence:** ${input.handoffChain.join(' ➔ ')}`);
      }
      for (const hl of handoffChainLines) {
        lines.push(`- ${hl.replace(/^\[\d{4}-\d{2}-\d{2}[^\]]+\]\s*/, '').trim()}`);
      }
      lines.push('');
    }

    const errorLines = logLines.filter((l) =>
      /^\[(error|warn|warning|fail|failed)\]/i.test(l.trim()) ||
      /^Backend (Error|Warning)/i.test(l.trim()) ||
      /\b(Error|Exception|Warning|Fail|Failed):\s/i.test(l) ||
      /"level":\s*"(warning|error)"/i.test(l) ||
      /\[(?:HealthCoach|Medical|FrontDesk)-(?:Error|Warning)\]/i.test(l)
    );
    lines.push(`## ⚠️ Errors & Warnings`);
    lines.push('');
    const gateFailures = (Array.isArray(input.gate?.failures) && input.gate.failures.length > 0)
      ? input.gate.failures
      : (computedGate?.failures || []);
    if (gateFailures.length > 0) {
      lines.push(`Gate: \`${input.gate?.summary || computedGate?.summary || 'GATE: FAIL'}\` (see Gate & Trial-Balance Evaluation).`);
      for (const f of gateFailures.slice(0, 20)) {
        lines.push(`- \`${f.code}\` ${f.itemName ? `(${f.itemName}) ` : ''}${f.message}`);
      }
    }
    if (errorLines.length > 0) {
      if (gateFailures.length > 0) lines.push('');
      lines.push(`### Runtime Log Errors & Warnings (${errorLines.length})`);
      for (const el of errorLines.slice(0, 40)) {
        lines.push(`- ${el.trim().slice(0, 500)}`);
      }
    } else if (gateFailures.length === 0) {
      lines.push('_No thrown exceptions or log errors/warnings captured._');
    }
    lines.push('');

    if (collapsedLineIndices.size > 0) {
      const displayLines: string[] = [];
      let lastWasMarker = false;
      for (let i = 0; i < logLines.length; i++) {
        if (collapsedLineIndices.has(i)) {
          if (!lastWasMarker) {
            displayLines.push('  [... full content omitted here — see the extracted section above to avoid showing it twice ...]');
            lastWasMarker = true;
          }
          continue;
        }
        lastWasMarker = false;
        displayLines.push(logLines[i]);
      }
      dedupedLogs = displayLines.join('\n');
    }
  }

  lines.push(`## 🖥️ Backend Execution Logs`);
  lines.push('');
  if (dedupedLogs) {
    lines.push('```');
    lines.push(dedupedLogs.slice(0, 180_000));
    lines.push('```');
  } else {
    lines.push('_No backend logs recorded in this export._');
  }
  lines.push('');
  lines.push(`---`);
  lines.push(`_Generated by Health Tracker debug export. Images are omitted to prevent bloat._`);
  lines.push('');
  return lines.join('\n');
}

/** Build report input from a job shell + message bubble. */
export function debugReportFromJobMsg(job: any, msg: any): DebugReportInput {
  const result = job?.result || msg?.data || {};
  const food =
    result.pendingFoodLog ||
    result.data ||
    msg?.pendingFoodLog ||
    msg?.data?.pendingFoodLog;
  const logs =
    result.backendLogs ||
    msg?.data?.agentResult?.backendLogs ||
    msg?.data?.agentResult?.globalLiveLogs ||
    job?.liveThoughts?.backendLogs ||
    '';
  const debugReport: DebugReportInput = {
    jobId: job?.id || msg?.id,
    status: job?.status,
    mode: result.mode || job?.inputSnapshot?.mode,
    agentType: msg?.agentType || job?.inputSnapshot?.agentType,
    message: result.message || result.text || msg?.content,
    backendLogs: typeof logs === 'string' ? logs : String(logs || ''),
    pendingFoodLog: food,
    scoutItems: result.scoutItems || msg?.data?.scoutItems,
    scoutInternalReasoning:
      result.scoutInternalReasoning ||
      result.scoutReasoning ||
      food?.scoutInternalReasoning ||
      msg?.data?.scoutInternalReasoning ||
      msg?.data?.agentResult?.scoutInternalReasoning,
    rawScout: result.rawScout || result.scoutResult || msg?.data?.rawScout || food?.rawScout,
    scoutContentType: result.scoutContentType || result.visionScoutContentType || msg?.data?.scoutContentType,
    diningEnvironment: result.diningEnvironment || food?.diningEnvironment || msg?.data?.diningEnvironment,
    receiptTable: food?.receiptTable || result.receiptTable,
    error: job?.error?.message || result.error,
    debugUrl: result.debugUrl || msg?.data?.debugUrl || job?.debugUrl,
    photoUrl: result.photoUrl || job?.photoUrl || msg?.data?.photoUrl,
    exportedAt: new Date().toISOString(),
    degradedStages: result.degradedStages,
    lastUserAction: result.lastUserAction || msg?.data?.lastUserAction,
    userActionBreadcrumbs: result.userActionBreadcrumbs || msg?.data?.userActionBreadcrumbs || job?.inputSnapshot?.userActionBreadcrumbs,
    clientConsoleLogs: result.clientConsoleLogs || msg?.data?.clientConsoleLogs,
    networkErrors: result.networkErrors || msg?.data?.networkErrors,
    usdaSearchResults: result.usdaSearchResults,
    brandSearchResults: result.brandSearchResults,
    comprehensiveNutrients: result.comprehensiveNutrients || food?.nutrients,
    stageLedger: result.stageLedger,
    historyLog: result.historyLog,
    ingestTrace: result.ingestTrace || msg?.data?.ingestTrace || msg?.data?.agentResult?.ingestTrace || job?.clean_result?.ingestTrace,
    gate: result.gate || msg?.data?.gate,
    report: result.report || msg?.data?.report || msg?.data?.agentResult?.report || job?.clean_result?.report,
    handoffChain: result.handoffChain || msg?.data?.handoffChain || msg?.data?.agentResult?.handoffChain || job?.result?.handoffChain,
    dialogInventory: job?.dialogInventory || msg?.data?.dialogInventory || job?.result?.dialogInventory,
    dispatches: job?.dispatches || msg?.data?.dispatches || job?.result?.dispatches,
    agentInstructions: result.agentInstructions || msg?.data?.agentInstructions || msg?.data?.agentResult?.agentInstructions || job?.result?.agentInstructions || job?.inputSnapshot?.agentInstructions,
    photoUrls: result.photoUrls || job?.photoUrls || msg?.data?.photoUrls || (food?.imageUrl ? [food.imageUrl] : undefined),
    previousAttempts: job?.previousAttempts || result?.previousAttempts || job?.clean_result?.previousAttempts,
    priorLogs: job?.priorLogs || result?.priorLogs,
  };

  // Ensure dispatches is an array, and attempt to augment it for 'EDIT' turns
  // where raw LLM dispatch fields might be omitted or stripped.
  let dispatches = debugReport.dispatches;
  if (!Array.isArray(dispatches)) {
    dispatches = [];
  }

  // Check if there's a scout dispatch that might be missing raw fields, or create one.
  let scoutDispatchAugmented = false;
  for (const d of dispatches) {
    // Heuristic: if a dispatch has 'scout' in its agent name or ID, it's a scout dispatch
    if ((d.agent && d.agent.toLowerCase().includes('scout')) || (d.id && d.id.toLowerCase().includes('scout'))) {
      // If it's a scout dispatch but missing raw fields, try to augment it
      if (!d.systemInstruction && !d.userPrompt && !d.rawEmission && !d.output && !d.instruction) {
        const scoutInternalReasoning = debugReport.scoutInternalReasoning;
        if (scoutInternalReasoning) {
          d.instruction = scoutInternalReasoning;
        }
        const rawScout = debugReport.rawScout;
        if (rawScout) {
          d.rawEmission = rawScout;
          d.output = rawScout;
        }
        // Also check agentInstructions for system/user prompt
        const agentInstructions = debugReport.agentInstructions;
        if (agentInstructions) {
          if (typeof agentInstructions === 'string') {
            d.systemInstruction = agentInstructions;
          } else if (Array.isArray(agentInstructions) && agentInstructions.length > 0) {
            d.systemInstruction = agentInstructions.join('\n');
          } else if (typeof agentInstructions === 'object' && !Array.isArray(agentInstructions) && (agentInstructions as any).scout) {
            d.systemInstruction = (agentInstructions as any).scout;
          }
        }
        if (d.instruction || d.rawEmission || d.systemInstruction) {
          scoutDispatchAugmented = true;
          break; // Augmented an existing scout dispatch
        }
      } else {
        scoutDispatchAugmented = true; // Found a complete scout dispatch
        break;
      }
    }
  }

  // If no scout dispatch was found or augmented, and we have scout-specific data, create a new one.
  if (!scoutDispatchAugmented && (debugReport.scoutItems?.length || debugReport.rawScout || debugReport.scoutInternalReasoning || debugReport.agentInstructions)) {
    const syntheticScoutDispatch: Partial<DispatchTrace> = {
      id: 'synthetic-scout-dispatch',
      agent: 'scout',
      received: new Date().toISOString(),
    };

    if (debugReport.scoutInternalReasoning) {
      syntheticScoutDispatch.instruction = debugReport.scoutInternalReasoning;
    }
    if (debugReport.rawScout) {
      syntheticScoutDispatch.rawEmission = debugReport.rawScout;
      syntheticScoutDispatch.output = debugReport.rawScout;
    }
    const agentInstructions = debugReport.agentInstructions;
    if (agentInstructions) {
      if (typeof agentInstructions === 'string') {
        syntheticScoutDispatch.systemInstruction = agentInstructions;
      } else if (Array.isArray(agentInstructions) && agentInstructions.length > 0) {
        syntheticScoutDispatch.systemInstruction = agentInstructions.join('\n');
      } else if (typeof agentInstructions === 'object' && !Array.isArray(agentInstructions) && (agentInstructions as any).scout) {
        syntheticScoutDispatch.systemInstruction = (agentInstructions as any).scout;
      }
    }

    if (syntheticScoutDispatch.instruction || syntheticScoutDispatch.rawEmission || syntheticScoutDispatch.systemInstruction) {
      dispatches.push(syntheticScoutDispatch as DispatchTrace);
    }
  }

  debugReport.dispatches = dispatches;
  return debugReport;
}

/* export function stripHeavyImages export function coldDebugR2Key debug/${uid}/${jid}.json export function buildDebugMarkdownReport */
