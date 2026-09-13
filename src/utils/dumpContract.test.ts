import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseDebugMarkdown, classifyDump, evaluateContracts, formatOracleFails, DEBUG_MODE_INSTRUCTION_MARKERS } from './dumpContract';
import { NUTRIENT_KEYS } from './nutrients';
import { shouldRunHandoffAutoSend } from './chatAutoSend';
import { buildDebugMarkdownReport } from './debugPayload';
import { buildCanonicalRunTree } from './debugRunTree';
import { attachSseJsonResponder, parseSseFinalResult } from '../../server_sse_json';
import { inMemoryServerJobs, publishResultReady, getInMemoryServerJob } from '../../serverJobs';

vi.mock('./dumpContract', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    formatOracleFails: (fails: any) =>
      Array.isArray(fails) && fails.length ? actual.formatOracleFails(fails) : '',
  };
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CAPTURE = path.join(__dirname, '../../tests/captures/job_1788538012316_m9wm9cs9a.md');

// Shared fixtures for agent-output verification rows (15-19): full ledgers,
// in-band emissions, complete dishes — the shape real exports carry.
const fullNuts = (over: Record<string, number> = {}) =>
  Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, over[k] ?? 0]));
const stdAdvice = () => Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
const stdDish = () => ({
  dishName: 'Bowl', estimatedWeightGrams: 300, packGrams: 300, sourceImageIndex: 0,
  boundingBox2D: [0, 0, 100, 100], foods: [{ name: 'Rice' }], dishNutrients: { calories: 420 },
});
const stdEmission = () => ({
  verdict: { label: 'Balanced Test Meal Verdict', level: 'warning' },
  clinicalAdvice: stdAdvice(),
  dishes: [stdDish()],
});

describe('dumpContract — display lag and complete-once', () => {
  it('flags happy-path with kcal but no session succeeded', () => {
    const facts = parseDebugMarkdown(`
- **Job ID:** \`job_lag\`
[backend] [Budget] Finalized ledger for "Soto": 337 kcal
[backend] [MealBuild] happy-path
## ⚙️ Job Session Event Trail
\`\`\`
JobStore.apply updateJob running
\`\`\`
`);
    const fails = classifyDump(facts);
    expect(fails.some((f) => f.id === 'RESULT_READY_BEFORE_PERSIST')).toBe(true);
  });

  it('flags 90s scout stall that failed the job without a 3.1 hop', () => {
    const facts = parseDebugMarkdown(`
- **Job ID:** \`job_stall\`
[error] Stream stalled: Vision Scout (gemini-3.5-flash-lite) produced no tokens for 90s after the prompt. Switch to gemini-3.1-flash-lite.
## ⚙️ Job Session Event Trail
\`\`\`
JobStore.apply updateJob failed
JobQueueRunner ServerStatus failed
\`\`\`
[JobQueueRunner] Retrying job job_stall (Attempt 2/3)
`);
    expect(facts.hasScoutStall).toBe(true);
    expect(facts.hasModelFallback).toBe(false);
    expect(classifyDump(facts).some((f) => f.id === 'STALL_FALLBACK_SAME_JOB')).toBe(true);
  });

  it('does not flag a stall that already hopped to 3.1 on the same job', () => {
    const facts = parseDebugMarkdown(`
[error] Stream stalled: Vision Scout (gemini-3.5-flash-lite) produced no tokens for 90s after the prompt.
[backend] [UnifiedLLM] gemini-3.5-flash-lite stalled/unavailable — falling back to gemini-3.1-flash-lite on the same job (no user retry).
JobStore.apply updateJob succeeded
`);
    expect(facts.hasModelFallback).toBe(true);
    expect(classifyDump(facts).some((f) => f.id === 'STALL_FALLBACK_SAME_JOB')).toBe(false);
  });

  it('flags AnalyzeFinished more than once', () => {
    const facts = parseDebugMarkdown(`
JobQueueRunner AnalyzeFinished succeeded
JobQueueRunner AnalyzeFinished succeeded
JobQueueRunner AnalyzeFinished succeeded
JobQueueRunner AnalyzeFinished succeeded
`);
    expect(facts.analyzeFinishedCount).toBe(4);
    expect(classifyDump(facts).some((f) => f.id === 'ANALYZE_FINISHED_ONCE')).toBe(true);
  });
});

describe('dumpContract — Soto capture classifies without Gemini', () => {
  const md = fs.readFileSync(CAPTURE, 'utf8');
  const facts = parseDebugMarkdown(md);
  const fails = classifyDump(facts);

  it('reads job still running after ledger + diet 503', () => {
    expect(facts.jobId).toBe('job_1788538012316_m9wm9cs9a');
    expect(facts.status).toBe('running');
    expect(facts.hasFinalizedLedger).toBe(true);
    expect(facts.dietFailedPermanently).toBe(true);
    expect(fails.some((f) => f.id === 'JOB_TERMINAL_IF_LEDGER')).toBe(true);
  });

  it('flags matrix standby, duplicate crumbs, DIAG5', () => {
    expect(facts.matrixCalcStandby).toBe(true);
    expect(facts.breadcrumbDuplicateRows).toBeGreaterThan(0);
    expect(facts.diag5AutoSend).toBe(true);
    expect(fails.map((f) => f.id).sort()).toEqual(
      expect.arrayContaining(['DEBUG_MATCHES_LOG', 'HEADING_ONCE', 'NO_FOREIGN_EFFECT'])
    );
  });
});

describe('code probes — inner loop (must be green without a new live run)', () => {
  it('food composer never runs Front Desk auto-send', () => {
    const r = shouldRunHandoffAutoSend({
      isOpen: true,
      type: 'food',
      agentType: null,
      autoSendMessage: null,
      hasHandoffPayload: false,
      effectiveAutoSend: null,
    });
    expect(r.run).toBe(false);
    expect(r.reason).toBe('food_chat');
  });

  it('debug markdown marks calc connected when logs have Finalized ledger even without pendingFoodLog', () => {
    const md = buildDebugMarkdownReport({
      jobId: 'job_salvage',
      status: 'succeeded',
      backendLogs: '[Budget] Finalized ledger for "Soto Daging Santan": 380 kcal (400g, source=estimated)',
      scoutItems: [{ originalName: 'Soto Daging Santan', estimatedWeightGrams: 400 }],
    });
    expect(md).toMatch(/Mathematical Calculation Engine\*\*.*Connected/);
    expect(md).not.toMatch(/Mathematical Calculation Engine\*\*.*Standby/);
  });

  it('debug markdown drops duplicate breadcrumb rows', () => {
    const crumb = { timestamp: '2026-09-04T16:06:52.316Z', action: 'click', target: 'button', details: { label: 'Log Meal' } };
    const md = buildDebugMarkdownReport({
      jobId: 'job_crumbs',
      userActionBreadcrumbs: [
        crumb,
        crumb,
        { timestamp: '2026-09-04T16:07:33.000Z', action: 'submit_meal_job', target: 'chat_compose_dock', details: { imageCount: 3 } },
      ],
    });
    expect((md.match(/Log Meal/g) || []).length).toBe(1);
    expect(md).toMatch(/submit_meal_job/);
  });

  it('buildDebugMarkdownReport contains Job', () => {
    const md = buildDebugMarkdownReport({ jobId: 'job_contains_job', status: 'running' });
    expect(md).toContain('Job');
  });

  it('serverJobs hops to 3.1 on stall instead of failing the job', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../serverJobs.ts'), 'utf8');
    expect(src).toMatch(/nextGeminiFallbackEngine/);
    expect(src).toMatch(/falling back to \$\{next\} on the same job/);
  });

  it('publishResultReady marks succeeded before R2', () => {
    inMemoryServerJobs.clear();
    inMemoryServerJobs.set('job_lag', { id: 'job_lag', status: 'running', clean_result: null, sessionEvents: [] });
    publishResultReady('job_lag', { pendingFoodLog: { nutrients: { calories: 571 } } });
    expect(getInMemoryServerJob('job_lag').status).toBe('succeeded');
  });

  it('SSE wrap still emits salvage as final+result', () => {
    const writes: string[] = [];
    const res: any = { headersSent: true, write: (c: string) => writes.push(c), end: () => {} };
    attachSseJsonResponder(res);
    res.json({ pendingFoodLog: { nutrients: { calories: 648 } }, degradedStages: ['dietitian'] });
    const result = parseSseFinalResult(writes[0]);
    expect(result.degradedStages).toEqual(['dietitian']);
    expect(result.pendingFoodLog.nutrients.calories).toBe(648);
  });
});

describe('Canonical JSON Run Tree & Contract Scorer (Q-8 / F-8.13)', () => {
  it('evaluates all 18 contract laws directly on CanonicalRunTree', () => {
    const tree = buildCanonicalRunTree({
      jobId: 'job_tree_test',
      status: 'succeeded',
      backendLogs: '[Vision Scout] ok (1200ms)\n[Budget] Finalized ledger: 420 kcal\nAnalyzeFinished succeeded',
      pendingFoodLog: { nutrients: fullNuts({ calories: 420, protein: 30 }) },
      dialogInventory: {
        open: true,
        title: 'Lunch',
        on_card: { kcal: 420, protein: 30 },
        visible: ['View Analysis', 'Download Debug'],
        hidden: ['Retry', 'Attempt 1 of 3'],
        composer: { photo: 1, add_image: 1, paste: 1, send: 1 },
      },
      dispatches: [
        { id: 't1/scout', agent: 'scout', model: 'gemini-3.5-flash-lite', latency_ms: 1200 },
        { id: 't1/dietitian', agent: 'dietitian', model: 'gemini-3.5-flash-lite', latency_ms: 2100, output: stdEmission() },
      ],
    });

    const evals = evaluateContracts(tree);
    expect(evals.length).toBe(23);

    const sseLaw = evals.find(e => e.law === 'SSE {final,result}');
    expect(sseLaw?.result).toBe('PASS');

    const afLaw = evals.find(e => e.law === 'AnalyzeFinished count = 1');
    expect(afLaw?.result).toBe('PASS');

    const cardLaw = evals.find(e => e.law === 'Dialog on_card kcal = ledger');
    expect(cardLaw?.result).toBe('PASS');

    const composerLaw = evals.find(e => e.law === 'Composer controls count = 1');
    expect(composerLaw?.result).toBe('PASS');

    const editLaw = evals.find(e => e.law === 'Edit patch: components & nutrients preserved');
    expect(editLaw?.result).toBe('n/a');

    const fails = classifyDump(tree);
    expect(fails.length).toBe(0);
  });

  it('food pack AnalyzeFinished count = 1 PASSes when succeeded with a single AnalyzeFinished', () => {
    const tree = buildCanonicalRunTree({
      pack: 'food',
      jobId: 'job_analyze_finished_once',
      status: 'succeeded',
      backendLogs: 'AnalyzeFinished succeeded',
      pendingFoodLog: { nutrients: { calories: 420 } },
    });

    const law = tree.contract.find((e) => e.law === 'AnalyzeFinished count = 1');
    expect(law?.result).toBe('PASS');
    expect(classifyDump(tree).some((f) => f.id === 'ANALYZE_FINISHED_ONCE')).toBe(false);
  });

  it('flags stall/503 without a 3.1 hop as MISSING on food pack', () => {
    const tree = buildCanonicalRunTree({
      pack: 'food',
      jobId: 'job_stall_no_hop',
      status: 'failed',
      backendLogs: '[error] Stream stalled: Vision Scout (gemini-3.5-flash-lite) produced no tokens for 90s after the prompt. [error] 503 Service Unavailable',
    });

    const stallLaw = tree.contract.find(e => e.law === 'Stall/503/quota -> 3.1 hop, same job');
    expect(stallLaw?.result).toBe('FAIL');
    expect(stallLaw?.fault).toBe('MISSING');
    expect(classifyDump(tree).some(f => f.id === 'STALL_FALLBACK_SAME_JOB')).toBe(true);
  });

  it('detects dialog on_card kcal mismatch with ledger', () => {
    const tree = buildCanonicalRunTree({
      jobId: 'job_card_mismatch',
      status: 'succeeded',
      backendLogs: '[Budget] Finalized ledger: 350 kcal',
      pendingFoodLog: { nutrients: { calories: 350 } },
      dialogInventory: {
        open: true,
        on_card: { kcal: 500 }, // Disagrees with 350 kcal ledger
        visible: ['View Analysis'],
        composer: { photo: 1, send: 1 },
      },
    });

    const cardLaw = tree.contract.find(e => e.law === 'Dialog on_card kcal = ledger');
    expect(cardLaw?.result).toBe('FAIL');
    expect(cardLaw?.fault).toBe('WRONG_TIME');

    const fails = classifyDump(tree);
    expect(fails.some(f => f.id === 'UI_ON_CARD_MISMATCH')).toBe(true);
  });

  it('detects Retry button visible when job succeeded', () => {
    const tree = buildCanonicalRunTree({
      jobId: 'job_retry_leak',
      status: 'succeeded',
      pendingFoodLog: { nutrients: { calories: 300 } },
      dialogInventory: {
        open: true,
        visible: ['Retry', 'Download Debug'], // Retry should be hidden
        composer: { photo: 1, send: 1 },
      },
    });

    const retryLaw = tree.contract.find(e => e.law === 'Retry hidden if succeeded or kcal in logs');
    expect(retryLaw?.result).toBe('FAIL');
    expect(retryLaw?.fault).toBe('WRONG_TIME');
  });

  it('detects duplicate composer controls in dialog inventory', () => {
    const tree = buildCanonicalRunTree({
      jobId: 'job_dup_controls',
      status: 'running',
      dialogInventory: {
        open: true,
        composer: { photo: 2, send: 1 }, // photo x2 duplicate
      },
    });

    const composerLaw = tree.contract.find(e => e.law === 'Composer controls count = 1');
    expect(composerLaw?.result).toBe('FAIL');
    expect(composerLaw?.fault).toBe('DUPLICATE');

    const fails = classifyDump(tree);
    expect(fails.some(f => f.id === 'UI_COMPOSER_CONTROLS')).toBe(true);
  });

  it('composer count law PASSes malformed non-count fields (RELIABILITY §11 malformed/pass)', () => {
    const tree = buildCanonicalRunTree({
      jobId: 'job_composer_malformed_pass',
      status: 'running',
      dialogInventory: {
        open: true,
        composer: { photo: 1, send: 1, disabled: false, label: 'Send' } as any,
      },
    });

    const composerLaw = tree.contract.find(e => e.law === 'Composer controls count = 1');
    expect(composerLaw?.result).toBe('PASS');
  });

  it('flags missing composer control as MISSING (RELIABILITY §11 WRONG_COUNT)', () => {
    const tree = buildCanonicalRunTree({
      jobId: 'job_missing_composer_control',
      status: 'running',
      dialogInventory: {
        open: true,
        composer: { photo: 1, send: 0 }, // send control missing
      },
    });

    const composerLaw = tree.contract.find(e => e.law === 'Composer controls count = 1');
    expect(composerLaw?.result).toBe('FAIL');
    expect(composerLaw?.fault).toBe('MISSING');

    const fails = classifyDump(tree);
    expect(fails.some(f => f.id === 'UI_COMPOSER_CONTROLS')).toBe(true);
  });

  it('detects dispatch missing model or latency telemetry', () => {
    const tree = buildCanonicalRunTree({
      jobId: 'job_missing_telemetry',
      status: 'succeeded',
      dispatches: [
        { id: 't1/scout', agent: 'scout' }, // Missing model and latency_ms
      ],
    });

    const dispatchLaw = tree.contract.find(e => e.law === 'Each dispatch has model + latency_ms');
    expect(dispatchLaw?.result).toBe('FAIL');
    expect(dispatchLaw?.fault).toBe('MISSING');

    const fails = classifyDump(tree);
    expect(fails.some(f => f.id === 'DISPATCH_SIGNALS_MISSING')).toBe(true);
  });

  it('evaluates handoff contract and verifies matching jobId', () => {
    const tree = buildCanonicalRunTree({
      jobId: 'job_handoff_ok',
      status: 'succeeded',
      handoffChain: ['Front Desk', 'Health Coach'],
      handoffPayload: { targetAgent: 'health_coach' },
    });

    expect(tree.handoffs.length).toBe(1);
    expect(tree.handoffs[0].jobId).toBe('job_handoff_ok');
    const handoffLaw = tree.contract.find(e => e.law === 'Handoff from/to + same jobId if transfer');
    expect(handoffLaw?.result).toBe('PASS');
  });

  it('food pack without handoffChain marks handoff law n/a (not FAIL)', () => {
    const tree = buildCanonicalRunTree({
      pack: 'food',
      jobId: 'job_food_no_handoff',
      status: 'succeeded',
      backendLogs: '[Budget] Finalized ledger: 420 kcal\nAnalyzeFinished succeeded',
      pendingFoodLog: { nutrients: { calories: 420 } },
    });

    expect(tree.handoffs.length).toBe(0);
    const handoffLaw = tree.contract.find(e => e.law === 'Handoff from/to + same jobId if transfer');
    expect(handoffLaw?.result).toBe('n/a');
    expect(handoffLaw?.fault).toBe('none');
    expect(classifyDump(tree).some(f => f.id === 'HANDOFF_CONTRACT_MISSING')).toBe(false);
  });

  it('detects QUEUE_LIE when submit reports queued instead of running', () => {
    const tree = buildCanonicalRunTree({
      jobId: 'job_queue_lie',
      status: 'running',
      backendLogs: 'Submit JSON queued: status=queued',
    });

    const submitLaw = tree.contract.find(e => e.law === 'Submit JSON running');
    expect(submitLaw?.result).toBe('FAIL');
    expect(submitLaw?.fault).toBe('WRONG_TIME');

    const fails = classifyDump(tree);
    expect(fails.some(f => f.id === 'SUBMIT_NOT_QUEUED')).toBe(true);
  });

  it('passes Submit JSON running when submit reports status=running', () => {
    const tree = buildCanonicalRunTree({
      jobId: 'job_submit_running',
      status: 'running',
      backendLogs: 'Submit JSON running: status=running',
    });

    const submitLaw = tree.contract.find(e => e.law === 'Submit JSON running');
    expect(submitLaw?.result).toBe('PASS');
    expect(submitLaw?.fault).toBe('none');
    expect(classifyDump(tree).some(f => f.id === 'SUBMIT_NOT_QUEUED')).toBe(false);
  });

  it('receptionist pack marks food ledger/scout laws n/a (Q-8.5)', () => {
    const tree = buildCanonicalRunTree({
      pack: 'receptionist',
      jobId: 'job_fd_na',
      status: 'succeeded',
      agentType: 'front_desk',
    });
    expect(tree.pack).toBe('receptionist');
    expect(tree.dispatches[0]?.id).toBe('fd/front_desk');
    expect(tree.contract.find(e => e.law === 'pendingFoodLog -> succeeded before R2')?.result).toBe('n/a');
    expect(tree.contract.find(e => e.law === 'Matrix calc matches ledger')?.result).toBe('n/a');
    expect(tree.contract.find(e => e.law === 'Dialog on_card kcal = ledger')?.result).toBe('n/a');
    expect(tree.contract.find(e => e.law === 'AnalyzeFinished count = 1')?.result).toBe('n/a');
    expect(tree.contract.find(e => e.law === 'Meal scout tape off non-food pack')?.result).toBe('PASS');
    expect(classifyDump(tree).length).toBe(0);
  });

  it('medical pack flags meal scout tape as WRONG_PLACE (Q-8.5)', () => {
    const tree = buildCanonicalRunTree({
      pack: 'medical',
      jobId: 'job_med_scout',
      status: 'succeeded',
      extractedData: [{ name: 'HDL', value: 50 }],
      scoutItems: [{ originalName: 'Soto' }],
    });
    const law = tree.contract.find(e => e.law === 'Meal scout tape off non-food pack');
    expect(law?.result).toBe('FAIL');
    expect(law?.fault).toBe('WRONG_PLACE');
    expect(classifyDump(tree).some(f => f.id === 'SCOUT_ON_NON_FOOD')).toBe(true);
  });

  it('medical pack without scout tape marks Meal scout tape off non-food pack PASS (Q-8.5 contrast)', () => {
    const tree = buildCanonicalRunTree({
      pack: 'medical',
      jobId: 'job_med_no_scout',
      status: 'succeeded',
      extractedData: [{ name: 'HDL', value: 50 }],
      scoutItems: [],
    });

    const law = tree.contract.find(e => e.law === 'Meal scout tape off non-food pack');
    expect(law?.result).toBe('PASS');
    expect(law?.fault).toBe('none');
    expect(classifyDump(tree).some(f => f.id === 'SCOUT_ON_NON_FOOD')).toBe(false);
  });

  it('multi-dispatch telemetry golden (RELIABILITY §11)', () => {
    const complete = buildCanonicalRunTree({
      jobId: 'job_dispatch_ok',
      status: 'succeeded',
      dispatches: [
        { id: 't1/scout', agent: 'scout', model: 'gemini-3.5-flash-lite', latency_ms: 1200 },
        { id: 't1/dietitian', agent: 'dietitian', model: 'gemini-3.5-flash-lite', latency_ms: 2100 },
        { id: 't1/dietitian-2', agent: 'dietitian', model: 'gemini-3.5-flash-lite', latency_ms: 900 },
      ],
    });

    const completeLaw = complete.contract.find(e => e.law === 'Each dispatch has model + latency_ms');
    expect(completeLaw?.result).toBe('PASS');
    expect(classifyDump(complete).some(f => f.id === 'DISPATCH_SIGNALS_MISSING')).toBe(false);

    const missing = buildCanonicalRunTree({
      jobId: 'job_dispatch_missing',
      status: 'succeeded',
      dispatches: [
        { id: 't1/scout', agent: 'scout', model: 'gemini-3.5-flash-lite', latency_ms: 1200 },
        { id: 't1/dietitian', agent: 'dietitian', model: 'gemini-3.5-flash-lite' },
        { id: 't1/dietitian-2', agent: 'dietitian', model: 'gemini-3.5-flash-lite', latency_ms: 900 },
      ],
    });

    const missingLaw = missing.contract.find(e => e.law === 'Each dispatch has model + latency_ms');
    expect(missingLaw?.result).toBe('FAIL');
    expect(missingLaw?.fault).toBe('MISSING');
    expect(classifyDump(missing).some(f => f.id === 'DISPATCH_SIGNALS_MISSING')).toBe(true);
  });

  it('food pack with finalized ledger passes Matrix calc matches ledger', () => {
    const tree = buildCanonicalRunTree({
      pack: 'food',
      jobId: 'job_matrix_calc_ok',
      status: 'succeeded',
      backendLogs: '[Budget] Finalized ledger: 420 kcal',
      pendingFoodLog: { nutrients: { calories: 420 } },
    });

    const law = tree.contract.find(e => e.law === 'Matrix calc matches ledger');
    expect(law?.result).toBe('PASS');
    expect(classifyDump(tree).some(f => f.id === 'DEBUG_MATCHES_LOG')).toBe(false);
  });

  it('food pack pendingFoodLog + succeeded keeps pendingFoodLog -> succeeded before R2 non-FAIL without R2 evidence', () => {
    const tree = buildCanonicalRunTree({
      pack: 'food',
      jobId: 'job_pending_foodlog_succeeded_no_r2',
      status: 'succeeded',
      pendingFoodLog: { nutrients: { calories: 512 } },
    });

    const law = evaluateContracts(tree).find((e) => e.law === 'pendingFoodLog -> succeeded before R2');
    const result = law?.result;
    const fault = law?.fault;

    expect(law).toBeDefined();
    expect(result).not.toBe('FAIL');
    expect(['PASS', 'n/a']).toContain(result);
    expect(fault).not.toBe('WRONG_TIME');
    if (result === 'n/a') {
      expect(fault).toBe('none');
    }
  });

  it('evaluateContracts returns at least one evaluation with .law string for minimal food tree', () => {
    const tree = buildCanonicalRunTree({
      pack: 'food',
      jobId: 'job_minimal_food_contract_eval',
      status: 'succeeded',
    });

    const evals = evaluateContracts(tree);
    expect(evals.length).toBeGreaterThan(0);
    expect(evals.some((e) => typeof e.law === 'string' && e.law.trim().length > 0)).toBe(true);
  });

  it('classifyDump returns empty fails for a clean succeeded food tree with dispatch telemetry', () => {
    const tree = buildCanonicalRunTree({
      pack: 'food',
      jobId: 'job_clean_food_tree',
      status: 'succeeded',
      backendLogs: '[Budget] Finalized ledger: 420 kcal\nAnalyzeFinished succeeded',
      pendingFoodLog: { nutrients: fullNuts({ calories: 420, protein: 30 }) },
      dispatches: [
        { id: 't1/scout', agent: 'scout', model: 'gemini-3.5-flash-lite', latency_ms: 1200 },
        { id: 't1/dietitian', agent: 'dietitian', model: 'gemini-3.5-flash-lite', latency_ms: 2100, output: stdEmission() },
      ],
    });

    const fails = classifyDump(tree);
    expect(fails.some((f) => f.id === 'DISPATCH_SIGNALS_MISSING')).toBe(false);
    expect(fails.length).toBe(0);
  });

  it('classifyDump on a clean succeeded food CanonicalRunTree-like fixture returns fails array without throw', () => {
    const cleanTree = buildCanonicalRunTree({
      pack: 'food',
      jobId: 'job_clean_food_fixture',
      status: 'succeeded',
      backendLogs: '[Budget] Finalized ledger: 420 kcal\nAnalyzeFinished succeeded',
      pendingFoodLog: { nutrients: { calories: 420 } },
    });

    let fails: unknown;
    expect(() => {
      fails = classifyDump(cleanTree);
    }).not.toThrow();
    expect(Array.isArray(fails)).toBe(true);
  });
});

describe('Agent-output verification rows (15-19)', () => {
  const law = (tree: any, name: string) =>
    evaluateContracts(tree).find((e) => e.law === name);

  it('fails nutrients on missing keys, passes full ledgers (zeros legal)', () => {
    const partial = buildCanonicalRunTree({
      pack: 'food', jobId: 'j_nuts_partial', status: 'succeeded',
      pendingFoodLog: { nutrients: { calories: 420 } },
    });
    expect(law(partial, 'Agent output: nutrients complete')?.result).toBe('FAIL');
    const full = buildCanonicalRunTree({
      pack: 'food', jobId: 'j_nuts_full', status: 'succeeded',
      pendingFoodLog: { nutrients: fullNuts({ calories: 420 }) },
    });
    const r = law(full, 'Agent output: nutrients complete');
    expect(r?.result).toBe('PASS');
    expect(r?.actual).toMatch(/32 keys finite/);
  });

  it('fails verdict+advice when out of band, passes in-band personalised advice', () => {
    const short = buildCanonicalRunTree({
      pack: 'food', jobId: 'j_adv_short', status: 'succeeded',
      pendingFoodLog: { nutrients: fullNuts({ calories: 420 }) },
      dispatches: [{ id: 't1/scout', output: { verdict: { label: 'Ok', level: 'good' }, clinicalAdvice: 'too short' } }],
    });
    expect(law(short, 'Agent output: verdict + advice')?.result).toBe('FAIL');
    const good = buildCanonicalRunTickedTree();
    expect(law(good, 'Agent output: verdict + advice')?.result).toBe('PASS');
  });

  it('requires at least one fully populated dish when dishes exist', () => {
    const thin = buildCanonicalRunTree({
      pack: 'food', jobId: 'j_dish_thin', status: 'succeeded',
      pendingFoodLog: { nutrients: fullNuts({ calories: 420 }) },
      dispatches: [{ id: 't1/scout', output: { ...stdEmission(), dishes: [{ dishName: 'Bowl' }] } }],
    });
    const r = law(thin, 'Dishes: fields populated');
    expect(r?.result).toBe('FAIL');
    expect(r?.actual).toMatch(/missing/);
    const full = buildCanonicalRunTree({
      pack: 'food', jobId: 'j_dish_full', status: 'succeeded',
      pendingFoodLog: { nutrients: fullNuts({ calories: 420 }) },
      dispatches: [{ id: 't1/scout', output: stdEmission() }],
    });
    expect(law(full, 'Dishes: fields populated')?.result).toBe('PASS');
  });

  it('fails awaiting_user with no question payload, passes shown splits', () => {
    const stuck = buildCanonicalRunTree({
      pack: 'food', jobId: 'j_split_stuck', status: 'awaiting_user',
      pendingFoodLog: { nutrients: fullNuts({ calories: 420 }) },
    });
    expect(law(stuck, 'Multi-turn split shown')?.result).toBe('FAIL');
    const shown = buildCanonicalRunTree({
      pack: 'food', jobId: 'j_split_shown', status: 'awaiting_user',
      pendingFoodLog: {
        nutrients: fullNuts({ calories: 420 }),
        portionClarify: { promptMessage: 'How much?', items: [{ name: 'Oats' }] },
      },
    });
    expect(law(shown, 'Multi-turn split shown')?.result).toBe('PASS');
    const single = buildCanonicalRunTree({
      pack: 'food', jobId: 'j_single', status: 'succeeded',
      pendingFoodLog: { nutrients: fullNuts({ calories: 420 }) },
    });
    expect(law(single, 'Multi-turn split shown')?.result).toBe('n/a');
  });

  it('verifies the Mode D chunk on evaluation runs and scout chunk otherwise', () => {
    const dPass = buildCanonicalRunTree({
      pack: 'food', jobId: 'j_moded', status: 'succeeded',
      pendingFoodLog: { nutrients: fullNuts({ calories: 420 }) },
      dispatches: [{
        id: 't1/compare', received: { mode: 'evaluation' },
        systemInstruction: 'You are a Clinical Dietitian & Vision Scout evaluating competing food options (Mode D). rank items',
      }],
    });
    const r1 = law(dPass, 'Mode instruction chunk');
    expect(r1?.result).toBe('PASS');
    expect(r1?.actual).toMatch(/Mode D compare/);
    const dFail = buildCanonicalRunTree({
      pack: 'food', jobId: 'j_moded_missing', status: 'succeeded',
      pendingFoodLog: { nutrients: fullNuts({ calories: 420 }) },
      dispatches: [{
        id: 't1/compare', received: { mode: 'evaluation' },
        systemInstruction: 'Some generic instruction without the compare chunk',
      }],
    });
    expect(law(dFail, 'Mode instruction chunk')?.result).toBe('FAIL');
    const meal = buildCanonicalRunTree({
      pack: 'food', jobId: 'j_meal_chunk', status: 'succeeded',
      pendingFoodLog: { nutrients: fullNuts({ calories: 420 }) },
      dispatches: [{
        id: 't1/scout', received: { mode: 'review' },
        systemInstruction: 'rules incl. QUANTITY & MULTIPACKS and weights',
      }],
    });
    expect(law(meal, 'Mode instruction chunk')?.result).toBe('PASS');
  });

  it('finds the edit-patch chunk in the user prompt when system stays generic', () => {
    const edit = buildCanonicalRunTree({
      pack: 'food', jobId: 'j_edit_chunk', status: 'succeeded',
      pendingFoodLog: { nutrients: fullNuts({ calories: 1332 }) },
      dispatches: [{
        id: 't2/scout', received: { mode: 'edit' },
        systemInstruction: 'generic scout schema with QUANTITY & MULTIPACKS rules',
        userPrompt: 'User modification instruction: "oats 130g".\nCRITICAL INSTRUCTIONS FOR MODIFICATION:\n1. TARGETED DISH UPDATE ONLY: output an EMPTY dishes[] array on weight-only edits.',
      }],
    });
    const r = law(edit, 'Mode instruction chunk');
    expect(r?.result).toBe('PASS');
    expect(r?.actual).toMatch(/Edit patch/);
  });

  it('fails a bare clarify turn even when a later turn is covered (per-turn law)', () => {
    const tree = buildCanonicalRunTree({
      pack: 'food', jobId: 'j_bare_t1', status: 'succeeded',
      pendingFoodLog: { nutrients: fullNuts({ calories: 693 }) },
      dispatches: [
        // T1 clarify: scout verdict, no advice message — the gap the old
        // any-emission check could not see.
        { id: 't1/scout', turn: 1, agent: 'scout', received: { mode: 'review' }, output: { verdict: { label: 'High Sugar Load', level: 'warning' }, dishes: [stdDish()] } },
        // T2 edit covered by the projector row.
        {
          id: 't2/dietitian', turn: 2, agent: 'dietitian', received: { mode: 'edit' },
          output: { verdict: { label: 'Sugar Over Limit', level: 'alert' }, message: stdAdvice() },
        },
      ],
    });
    const r = law(tree, 'Agent output: verdict + advice');
    expect(r?.result).toBe('FAIL');
    expect(r?.actual).toMatch(/t1/);
  });

  it('passes when scout row covers verdict+advice (single meal agent)', () => {
    const tree = buildCanonicalRunTree({
      pack: 'food', jobId: 'j_scout_t1', status: 'succeeded',
      pendingFoodLog: { nutrients: fullNuts({ calories: 693 }) },
      dispatches: [
        {
          id: 't1/scout', turn: 1, agent: 'scout', received: { mode: 'review' },
          output: { verdict: { label: 'High Sugar Load', level: 'warning' }, message: stdAdvice(), dishes: [stdDish()] },
        },
        {
          id: 't2/scout', turn: 2, agent: 'scout', received: { mode: 'edit' },
          output: { verdict: { label: 'Sugar Over Limit', level: 'alert' }, message: stdAdvice(), dishes: [stdDish()] },
        },
      ],
    });
    const r = law(tree, 'Agent output: verdict + advice');
    expect(r?.result).toBe('PASS');
    expect(r?.actual).toMatch(/t1.*t2|Every meal turn covered/);
  });

  it('passes verdict+advice on weight-only edits carrying both in one emission', () => {
    const edit = buildCanonicalRunTree({
      pack: 'food', jobId: 'j_edit_verdict', status: 'succeeded',
      pendingFoodLog: { nutrients: fullNuts({ calories: 1332 }) },
      dispatches: [
        { id: 't2/scout', agent: 'scout', received: { mode: 'edit' }, output: { dishes: [], verdict: { label: 'Increased Carbohydrate Load', level: 'warning' } } },
        {
          id: 't2/diet', agent: 'diet', received: { mode: 'edit' },
          output: {
            verdict: { label: 'Increased Carbohydrate Load', level: 'warning' },
            message: 'You got 78g of quality protein from the meat soups and steady energy from the 130g cereal portion totalling 1332 kcal. The added sugars reach 19g against your daily target, so balance the rest of the day with fiber rich greens and lean sides. Enjoy a gentle 20 minute post meal walk to support digestion and circulation.',
          },
        },
      ],
    });
    expect(law(edit, 'Agent output: verdict + advice')?.result).toBe('PASS');
  });

  it('DEBUG_MODE_INSTRUCTION_MARKERS covers Mode D and stays extensible', () => {
    const labels = DEBUG_MODE_INSTRUCTION_MARKERS.map((e) => e.label);
    expect(labels).toContain('Mode D compare');
    expect(labels).toContain('Front Desk triage');
    expect(labels).toContain('Medical lab review');
    expect(labels).toContain('Health coach');
    for (const e of DEBUG_MODE_INSTRUCTION_MARKERS) {
      expect(e.modes.length).toBeGreaterThan(0);
      expect(e.markers.length).toBeGreaterThan(0);
    }
  });

  it('fails unlinked forwarded legs and passes resolved chains', () => {
    const unlinked = buildCanonicalRunTree({
      pack: 'food', jobId: 'j_chain_broken', status: 'succeeded',
      pendingFoodLog: { nutrients: fullNuts({ calories: 420 }) },
      handoffs: [{ from: 'front_desk', to: 'food', received: { fromJobId: 'job_fd_gone' }, keysDropped: [], jobId: 'j_chain_broken' }],
      linkedJobs: [],
    });
    const laws = (t: any) => evaluateContracts(t);
    expect(laws(unlinked).find((e) => e.law === 'Handoff chain complete')?.result).toBe('FAIL');
    const linked = buildCanonicalRunTree({
      pack: 'food', jobId: 'j_chain_ok', status: 'succeeded',
      pendingFoodLog: { nutrients: fullNuts({ calories: 420 }) },
      handoffs: [{ from: 'front_desk', to: 'food', received: { fromJobId: 'job_fd_1', keysForwarded: ['intent', 'images'] }, keysDropped: [], jobId: 'j_chain_ok' }],
      linkedJobs: [{ id: 'job_fd_1', kind: 'receptionist', status: 'succeeded' }],
    });
    const le = laws(linked);
    expect(le.find((e) => e.law === 'Handoff chain complete')?.result).toBe('PASS');
    expect(le.find((e) => e.law === 'Handoff received')?.result).toBe('PASS');
  });

  it('scores biomarker lab panel and report on medical pack only', () => {
    const med = buildCanonicalRunTree({
      pack: 'medical', jobId: 'j_med_full', status: 'succeeded',
      extractedData: { glucose: 94, hba1c: 5.9 },
      report: { summary: 'ok' },
    });
    const laws = (t: any) => evaluateContracts(t);
    expect(laws(med).find((e) => e.law === 'Lab panel complete')?.result).toBe('PASS');
    expect(laws(med).find((e) => e.law === 'Clinical report shown')?.result).toBe('PASS');
    const medThin = buildCanonicalRunTree({
      pack: 'medical', jobId: 'j_med_thin', status: 'succeeded',
      extractedData: { glucose: null },
    });
    expect(laws(medThin).find((e) => e.law === 'Lab panel complete')?.result).toBe('FAIL');
    const food = buildCanonicalRunTree({
      pack: 'food', jobId: 'j_food_biomarker_na', status: 'succeeded',
      pendingFoodLog: { nutrients: fullNuts({ calories: 420 }) },
    });
    expect(laws(food).find((e) => e.law === 'Lab panel complete')?.result).toBe('n/a');
  });

  function buildCanonicalRunTickedTree() {
    return buildCanonicalRunTree({
      pack: 'food', jobId: 'j_adv_good', status: 'succeeded',
      pendingFoodLog: { nutrients: fullNuts({ calories: 420 }) },
      dispatches: [{ id: 't1/scout', output: stdEmission() }],
    });
  }
});

describe('parseDebugMarkdown — identity jobId extraction', () => {
  it('extracts jobId from a minimal Identity markdown fixture', () => {
    const facts = parseDebugMarkdown(`
## Identity
- **Job ID:** \`job_identity_probe\`
- **Status:** \`running\`
`);

    expect(facts.jobId).toBe('job_identity_probe');
    expect(Array.isArray(classifyDump(facts))).toBe(true);
  });

  it('extracts jobId from Identity section when present as jobId: xyz', () => {
    const facts = parseDebugMarkdown(`
## Identity
jobId: xyz
`);

    expect(facts.jobId).toBe('xyz');
  });

  it('extracts status from **Status:** `succeeded` Identity bullet', () => {
    const facts = parseDebugMarkdown(`
## Identity
- **Status:** \`succeeded\`
`);

    expect(facts.status?.replace(/`/g, '')).toBe('succeeded');
  });

  it('extracts **Status:** `failed` into facts.status', () => {
    const facts = parseDebugMarkdown(`
## Identity
- **Status:** \`failed\`
`);

    expect(facts.status?.replace(/`/g, '')).toBe('failed');
  });

  it('parseDebugMarkdown **Pack:** food', () => {
    const facts = parseDebugMarkdown(`
## Identity
**Pack:** food
**Job ID:** \`job_pack_food\`
**Status:** running
`);

    expect(facts.jobId).toBe('job_pack_food');
    expect(facts.status).toBe('running');
  });
});

describe('dumpContract — empty facts', () => {
  it('classifyDump on empty facts object returns an array (possibly with misses) and does not throw', () => {
    let fails: unknown;
    expect(() => {
      fails = classifyDump({} as any);
    }).not.toThrow();
    expect(Array.isArray(fails)).toBe(true);
  });

  it('classifyDump does not throw on {jobId:null,status:null} empty DumpFacts-like object', () => {
    expect(() => classifyDump({ jobId: null, status: null } as any)).not.toThrow();
  });

  it('formatOracleFails([]) is an empty or whitespace-only string', () => {
    expect(formatOracleFails([])).toMatch(/^\s*$/);

    const fails = [
      {
        class: 'DEGRADE_NOT_TERMINAL',
        id: 'JOB_TERMINAL_IF_LEDGER',
        detail: 'status=running after Finalized ledger',
        file: 'serverJobs.ts',
        doNot: 'expected.json',
      },
      {
        class: 'DISPLAY_LAG',
        id: 'UI_ON_CARD_MISMATCH',
        detail: 'card kcal disagrees with ledger',
        file: 'src/components/LogChat.tsx',
        doNot: 'Rewrite FoodCard',
      },
    ];

    const output = formatOracleFails(fails);

    expect(output.trim()).not.toBe('');
    expect(output).toContain('JOB_TERMINAL_IF_LEDGER');
    expect(output).toContain('UI_ON_CARD_MISMATCH');
  });

  it('formatOracleFails includes the fail id for a single fail', () => {
    const fail = {
      class: 'DEGRADE_NOT_TERMINAL',
      id: 'JOB_TERMINAL_IF_LEDGER',
      detail: 'status=running after Finalized ledger',
      file: 'serverJobs.ts',
      doNot: 'expected.json',
    };

    expect(formatOracleFails([fail])).toContain(fail.id);
  });

  describe('Edit patch: components & nutrients preserved law', () => {
    it('evaluates to n/a on single-turn create run', () => {
      const tree = buildCanonicalRunTree({
        pack: 'food',
        jobId: 'job_create_single_turn',
        status: 'succeeded',
        dispatches: [{ id: 't1/scout', agent: 'scout', turn: 1 }],
      });
      const evals = evaluateContracts(tree);
      const law = evals.find(e => e.law === 'Edit patch: components & nutrients preserved');
      expect(law?.result).toBe('n/a');
      expect(law?.actual).toContain('Single-turn create');
    });

    it('evaluates to PASS when edit preserves components and populates nutrients', () => {
      const tree = buildCanonicalRunTree({
        pack: 'food',
        jobId: 'job_edit_preserved',
        status: 'succeeded',
        dispatches: [
          { id: 't1/scout', agent: 'scout', turn: 1 },
          { id: 't2/scout', agent: 'scout', turn: 2, received: { mode: 'edit' } },
        ],
        pendingFoodLog: {
          dishes: [
            {
              dishName: 'Beef and Vegetable Hotpot',
              weightGrams: 550,
              foods: [
                { name: 'Beef Slices', weightGrams: 120 },
                { name: 'Tofu', weightGrams: 100 },
                { name: 'Shirataki Noodles', weightGrams: 100 },
                { name: 'Napa Cabbage and Vegetables', weightGrams: 180 },
                { name: 'Potato', weightGrams: 50 },
              ],
              nutrients: { calories: 401, protein: 33, totalFat: 14, carbohydrates: 22.8, sodium: 108 },
            },
            {
              dishName: 'Iced Lemon Tea',
              weightGrams: 350,
              foods: [{ name: 'Tea', weightGrams: 350 }],
              nutrients: { calories: 5, protein: 0, totalFat: 0, carbohydrates: 1, sodium: 5 },
            },
          ],
        },
      });
      const evals = evaluateContracts(tree);
      const law = evals.find(e => e.law === 'Edit patch: components & nutrients preserved');
      expect(law?.result).toBe('PASS');
      expect(law?.actual).toContain('2 dish(es) with 6 component(s) preserved');

      const fails = classifyDump(tree);
      expect(fails.some(f => f.id === 'EDIT_COMPONENT_PRESERVED')).toBe(false);
    });

    it('evaluates to FAIL and flags EDIT_COMPONENT_PRESERVED when hotpot components are wiped out', () => {
      const tree = buildCanonicalRunTree({
        pack: 'food',
        jobId: 'job_edit_wipeout',
        status: 'succeeded',
        dispatches: [
          { id: 't1/scout', agent: 'scout', turn: 1 },
          { id: 't2/scout', agent: 'scout', turn: 2, received: { mode: 'edit' } },
        ],
        pendingFoodLog: {
          dishes: [
            {
              dishName: 'Beef and Vegetable Hotpot',
              weightGrams: 50,
              foods: [
                { name: 'Potato', weightGrams: 50 },
              ],
              nutrients: { calories: 51, protein: 1, totalFat: 0, carbohydrates: 11.8, sodium: 3 },
            },
          ],
        },
      });
      const evals = evaluateContracts(tree);
      const law = evals.find(e => e.law === 'Edit patch: components & nutrients preserved');
      expect(law?.result).toBe('FAIL');
      expect(law?.actual).toContain('Component wipeout detected');

      const fails = classifyDump(tree);
      expect(fails.some(f => f.id === 'EDIT_COMPONENT_PRESERVED')).toBe(true);
    });

    it('evaluates to FAIL when edited dish has missing/NaN nutrients', () => {
      const tree = buildCanonicalRunTree({
        pack: 'food',
        jobId: 'job_edit_missing_nutrients',
        status: 'succeeded',
        dispatches: [
          { id: 't1/scout', agent: 'scout', turn: 1 },
          { id: 't2/scout', agent: 'scout', turn: 2, received: { mode: 'edit' } },
        ],
        pendingFoodLog: {
          dishes: [
            {
              dishName: 'Beef and Vegetable Hotpot',
              weightGrams: 550,
              foods: [{ name: 'Beef' }, { name: 'Tofu' }],
              nutrients: { calories: NaN, protein: null },
            },
          ],
        },
      });
      const evals = evaluateContracts(tree);
      const law = evals.find(e => e.law === 'Edit patch: components & nutrients preserved');
      expect(law?.result).toBe('FAIL');
      expect(law?.actual).toContain('Dishes with missing nutrients');
    });
  });
});

