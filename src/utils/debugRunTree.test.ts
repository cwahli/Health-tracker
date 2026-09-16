import { describe, it, expect } from 'vitest';
import {
  parseUnifiedUsageLines,
  parseUnifiedTimingLines,
  hasCallEvidence,
  determinePack,
  tagJobId,
  extractDispatches,
  extractHandoffs,
  extractPortionAdjustment,
  buildCanonicalRunTree,
  deduplicateBreadcrumbs,
  deduplicateSessionEvents,
  isCompareRunTree,
} from './debugRunTree';

const JOB = 'job_test_123';

describe('determinePack', () => {
  it('infers the operational pack from domain signals', () => {
    expect(determinePack({ agentType: 'scout', mode: 'new_log' })).toBe('food');
    expect(determinePack({ agentType: 'front_desk', mode: 'receptionist' })).toBe('receptionist');
    expect(determinePack({ agentType: 'medical', mode: 'biomarker_review', ingestTrace: {} })).toBe('medical');
    expect(determinePack({ agentType: 'health_coach', mode: 'health_coach', report: {} })).toBe('health_coach');
  });

  it('determinePack returns health_coach when input signals coach/plan (or documents actual label)', () => {
    expect(determinePack({ agentType: 'health_coach', mode: 'plan' })).toBe('health_coach');
    // Actual label: a bare coach/plan mode string is not currently a health_coach signal.
    expect(determinePack({ mode: 'coach/plan' })).toBe('food');
  });
});

describe('deduplicateBreadcrumbs', () => {
  it('collapses identical consecutive breadcrumbs and keeps order of first occurrences', () => {
    const clickSave = {
      timestamp: '2025-09-06T00:00:00Z',
      action: 'click',
      target: 'save-button',
      details: { label: 'Save' },
    };
    const inputName = {
      timestamp: '2025-09-06T00:00:01Z',
      action: 'input',
      target: 'meal-name',
      details: { value: 'Nasi Goreng' },
    };
    const clickExport = {
      timestamp: '2025-09-06T00:00:02Z',
      action: 'click',
      target: 'export-button',
      details: { label: 'Export' },
    };

    const result = deduplicateBreadcrumbs([
      clickSave,
      { ...clickSave },
      inputName,
      { ...inputName },
      clickExport,
    ]);

    expect(result).toEqual([clickSave, inputName, clickExport]);
  });

  it('handles empty input and preserves a single breadcrumb by identity', () => {
    expect(deduplicateBreadcrumbs([])).toEqual([]);
    const single = {
      timestamp: '2025-09-06T00:00:00Z',
      action: 'click',
      target: 'save-button',
      details: { label: 'Save' },
    };
    const result = deduplicateBreadcrumbs([single]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(single);
  });

  it('returns an array for duplicate object breadcrumbs', () => {
    expect(Array.isArray(deduplicateBreadcrumbs([{ id: 1 }, { id: 1 }]))).toBe(true);
  });
});

it('deduplicateSessionEvents collapses duplicate event ids keeping first', () => {
  const first = {
    id: 'e1',
    timestamp: '2025-09-06T00:00:00Z',
    status: 'sync',
    message: 'started',
  };
  const duplicate = { ...first };
  const second = {
    id: 'e2',
    timestamp: '2025-09-06T00:00:01Z',
    status: 'sync',
    message: 'done',
  };

  expect(deduplicateSessionEvents([first, duplicate, second])).toEqual([first, second]);
});

it('buildCanonicalRunTree minimal input has jobId and pack fields', () => {
  const tree = buildCanonicalRunTree({ jobId: 'job_minimal', pack: 'food' } as any);
  expect(tree).toMatchObject({ jobId: 'job_minimal', pack: 'food' });
});

it('compare runs emit scout only — no narrator backfill (single-agent compare)', () => {
  // Live shape (debug-job_1789204750819): the export showed a synthetic
  // t1/narrator with meal-framed projector text. No narrator exists on
  // compare runs, so none may be constructed at export time either.
  const tree = buildCanonicalRunTree(foodInput({
    mode: 'compare',
    pendingFoodLog: undefined,
    dispatches: [{
      id: 't1/scout',
      parent: null,
      turn: 1,
      agent: 'scout',
      user: 'Analyze this meal photo.',
      received: { mode: 'compare' },
      systemInstruction: 'You are a Clinical Dietitian & Vision Scout evaluating competing food options (Mode D).',
      userPrompt: 'List all visible dishes.',
      model: 'gemini-3.5-flash-lite',
      latency_ms: 54482,
    }],
    comparisonData: { comparisonTitle: 'Shelf', groups: [{ groupName: 'Tier 1' }] },
    result: {
      message: 'This shelf contains cooling waters and juices. Given your targets, opt for cooling waters while avoiding sugary juices.',
      comparison: { groups: [{ groupName: 'Tier 1' }] },
    },
  }) as any);
  const agents = tree.dispatches.map((d: any) => d.agent);
  expect(agents).toContain('scout');
  expect(agents).not.toContain('narrator');
  expect(agents).not.toContain('dietitian');
  expect(isCompareRunTree({ mode: 'compare' } as any)).toBe(true);
  expect(isCompareRunTree({ mode: 'new_log' } as any)).toBe(false);
});

it('compare filter drops legacy dietitian AND new diet dispatches (backcompat)', () => {
  const tree = buildCanonicalRunTree(foodInput({
    mode: 'compare',
    pendingFoodLog: undefined,
    dispatches: [
      { id: 't1/scout', parent: null, turn: 1, agent: 'scout', user: '', received: {}, systemInstruction: '', userPrompt: '', model: 'm', latency_ms: 1 },
      { id: 't1/dietitian', parent: null, turn: 1, agent: 'dietitian', user: '', received: {}, systemInstruction: '', userPrompt: '', model: 'm', latency_ms: 1 },
      { id: 't1/diet', parent: null, turn: 1, agent: 'diet', user: '', received: {}, systemInstruction: '', userPrompt: '', model: 'm', latency_ms: 1 },
    ],
    result: { message: 'x' },
  }) as any);
  const agents = tree.dispatches.map((d: any) => d.agent);
  expect(agents).toContain('scout');
  expect(agents).not.toContain('dietitian');
  expect(agents).not.toContain('diet');
});

function foodInput(over: any = {}) {
  return {
    jobId: JOB,
    status: 'succeeded',
    lastUserAction: { details: { prompt: 'steak' } },
    backendLogs: [
      '[UnifiedLLM] Calling gemini-3.5-flash-lite',
      '[Vision Scout] done in 1500ms',
      '[UnifiedLLM-Usage:scout] prompt=812 completion=96 total=908',
      '[Budget] Finalized ledger',
      'Food Resolver agent',
      '[UnifiedLLM-Usage:food_resolver] prompt=500 completion=50 total=550',
      '[UnifiedLLM-Timing:food_resolver] ms=1200',
    ].join('\n'),
    scoutItems: [{ keyword: 'Steak', name: 'Steak' }],
    pendingFoodLog: { id: 'meal_1', nutrients: { calories: 398 } },
    rawScout: { dishes: [{ dishName: 'Steak', foods: [{ foodName: 'Steak' }] }], _internalReasoning: 'saw steak' },
    clientConsoleLogs: ['[LOG] hello'],
    networkErrors: ['[NET POST 400] https://x.test/auth'],
    ...over,
  };
}

describe('parseUnifiedUsageLines', () => {
  it('parseUnifiedUsageLines with two stages returns length 2', () => {
    const logs =
      '[UnifiedLLM-Usage:scout] prompt=812 completion=96 total=908\n' +
      '[UnifiedLLM-Usage:food_resolver] prompt=500 completion=50 total=550';
    expect(parseUnifiedUsageLines(logs)).toHaveLength(2);
  });
});

describe('tagJobId', () => {
  it('prefixes or embeds jobId into a log line idempotently', () => {
    const plain = '[LOG] hello';
    const taggedOnce = tagJobId(plain, JOB);
    const taggedTwice = tagJobId(taggedOnce, JOB);

    expect(taggedOnce).toBe(`[${JOB}] ${plain}`);
    expect(taggedTwice).toBe(taggedOnce);

    const embedded = `[LOG] [${JOB}] already inside`;
    expect(tagJobId(embedded, JOB)).toBe(embedded);

    expect(tagJobId('', JOB)).toBe('');
    expect(tagJobId('   ', JOB)).toBe('   ');
    expect(tagJobId('hello', 'unknown')).toBe('hello');
  });
});

describe('extractDispatches (food)', () => {
  it('attaches tokens per stage and prefers raw scout output over processed items', () => {
    const d = extractDispatches(foodInput());
    const scout = d.find(x => x.agent === 'scout')!;
    const resolver = d.find(x => x.agent === 'curator' || x.agent === 'resolver')!;
    expect(scout.tokens).toBe(908);
    expect(scout.rawEmission).toEqual(foodInput().rawScout);
    // "Output:" in the Agent Dispatches card must show the exact raw LLM
    // response (rawScout), not the fully-processed/merged scoutItems list —
    // showing the processed list here is what caused "raw and processed
    // mixed up" in the Sept 5 debug export. rawScout is preferred whenever
    // it's present; scoutItems remains a fallback for older logs/paths that
    // never captured a raw emission.
    expect(scout.output).toEqual(foodInput().rawScout);
    expect(resolver).toBeDefined();
    expect(resolver.tokens).toBe(550);
    expect(resolver.latency_ms).toBe(1200);
    expect(resolver.called).toBe(true);
  });
  it('leaves tokens undefined when no usage lines exist', () => {
    const d = extractDispatches(foodInput({ backendLogs: '[Vision Scout] done' }));
    expect(d.find(x => x.agent === 'scout')!.tokens).toBeUndefined();
  });
  it('prefers measured timing over regex/default latency', () => {
    const d = extractDispatches(foodInput({
      backendLogs: '[Vision Scout] done in 1500ms\n[UnifiedLLM-Timing:scout] ms=5231\n[Budget] Finalized ledger',
    }));
    expect(d.find(x => x.agent === 'scout')!.latency_ms).toBe(5231);
  });
  it('omits resolver when no gap resolution occurred', () => {
    const d = extractDispatches(foodInput({
      backendLogs: '[Vision Scout] done\n[Budget] Finalized ledger',
    }));
    expect(d.find(x => x.agent === 'curator' || x.agent === 'resolver')).toBeUndefined();
  });

  it('returns scout only with length 1 for food with only scout logs and no prior dispatches', () => {
    const d = extractDispatches(foodInput({
      backendLogs: '[Vision Scout] done\n[Budget] Finalized ledger',
      dispatches: [],
    }));
    expect(d.length).toBe(1);
    expect(d[0].agent).toBe('scout');
    expect(d[0].id).toBe('t1/scout');
    expect(d.some(x => x.agent === 'curator' || x.agent === 'resolver')).toBe(false);
  });

  it('builds scout and optional resolver from logs when prior dispatches is empty, without inventing edit turns', () => {
    const d = extractDispatches(foodInput({ dispatches: [] }));
    expect(d.some(x => x.agent === 'scout')).toBe(true);
    expect(d.some(x => x.agent === 'curator' || x.agent === 'resolver')).toBe(true);
    expect(d.map(x => x.id)).toEqual(['t1/scout', 't1/curator']);
    expect(d.some(x => /^t[23]\//.test(x.id))).toBe(false);
  });
});

describe('hasCallEvidence', () => {
  it('hasCallEvidence scout true for production Analyze/Scout marker and false for empty logs', () => {
    expect(hasCallEvidence('[UnifiedLLM-Prompt:scout] User Prompt:\nAnalyze this meal photo.', 'scout')).toBe(true);
    expect(hasCallEvidence('', 'scout')).toBe(false);
  });
  it('hasCallEvidence dual-accepts resolver and curator evidence', () => {
    expect(hasCallEvidence('[UnifiedLLM:curator]', 'curator')).toBe(true);
    expect(hasCallEvidence('Food Resolver agent', 'curator')).toBe(true);
    expect(hasCallEvidence('[UnifiedLLM-Prompt:curator]', 'resolver')).toBe(true);
    expect(hasCallEvidence('[curator_answer]', 'resolver')).toBe(true);
    expect(hasCallEvidence('', 'curator')).toBe(false);
  });
});

describe('parseUnifiedTimingLines', () => {
  it('returns [] for empty input and parses one timing line into stage and ms', () => {
    expect(parseUnifiedTimingLines('')).toEqual([]);
    expect(parseUnifiedTimingLines('[UnifiedLLM-Timing:scout] ms=5231'))
      .toEqual([{ stage: 'scout', ms: 5231 }]);
  });
});

describe('buildCanonicalRunTree jobId tagging', () => {
  it('tags console, network and backend lines with the job id', () => {
    const tree = buildCanonicalRunTree(foodInput());
    expect(tree.console).toEqual([`[${JOB}] [LOG] hello`]);
    expect(tree.network).toEqual([`[${JOB}] [NET POST 400] https://x.test/auth`]);
    const lines = String((tree as any).backendLogs).split('\n');
    expect(lines[0]).toBe(`[${JOB}] [UnifiedLLM] Calling gemini-3.5-flash-lite`);
    expect(tree.dispatches.find(x => x.agent === 'scout')!.tokens).toBe(908);
  });

  it('tags network lines with jobId when clientNetworkLogs provided', () => {
    const clientNetworkLogs = ['[NET GET 200] https://x.test/api'];
    const tree = buildCanonicalRunTree(foodInput({
      clientNetworkLogs,
      networkErrors: clientNetworkLogs,
    }));
    expect(tree.network).toContain(`[${JOB}] [NET GET 200] https://x.test/api`);
  });

  it('preserves and enriches pre-existing multi-turn dispatches array', () => {
    const multiTurnInput = foodInput({
      dispatches: [
        {
          id: 't1/scout',
          turn: 1,
          agent: 'scout',
          user: 'Analyze this meal photo.',
          received: { mode: 'new_log' },
          systemInstruction: 'Scout Sys 1',
          userPrompt: 'Scout Usr 1',
          output: { dishes: [{ dishName: 'Nasi Goreng' }] },
          rawEmission: { dishes: [{ dishName: 'Nasi Goreng' }] },
        },
        {
          id: 't2/scout',
          turn: 2,
          agent: 'scout',
          user: 'The tea is unsweetened',
          received: { mode: 'edit', userMessage: 'The tea is unsweetened' },
          systemInstruction: 'Scout Sys 2',
          userPrompt: 'User modification instruction: "The tea is unsweetened"',
          output: { dishes: [{ dishName: 'Nasi Goreng' }, { dishName: 'Teh Tawar' }] },
          rawEmission: { dishes: [{ dishName: 'Nasi Goreng' }, { dishName: 'Teh Tawar' }] },
        },
      ],
    });
    const d = extractDispatches(multiTurnInput);
    expect(d.length).toBe(3); // 2 scout turns + 1 resolver from logs
    expect(d[0].id).toBe('t1/scout');
    expect(d[0].user).toBe('Analyze this meal photo.');
    expect(d[1].id).toBe('t2/scout');
    expect(d[1].user).toBe('The tea is unsweetened');
    expect(d[1].rawEmission).toBeDefined();
  });

  it('extractDispatches with prior dispatches length 2 keeps both after enrichment', () => {
    const d = extractDispatches(foodInput({
      rawScout: undefined,
      backendLogs: [
        '[UnifiedLLM] Calling gemini-3.5-flash-lite',
        '[UnifiedLLM-Usage:scout] prompt=812 completion=96 total=908',
        '[UnifiedLLM-Timing:scout] ms=5231',
        '[Budget] Finalized ledger',
      ].join('\n'),
      dispatches: [
        {
          id: 't1/scout',
          turn: 1,
          agent: 'scout',
          user: 'Analyze this meal photo.',
          received: { mode: 'new_log', photoCount: 1 },
        },
        {
          id: 't2/scout',
          turn: 2,
          agent: 'scout',
          user: 'The tea is unsweetened',
          received: { mode: 'edit', userMessage: 'The tea is unsweetened' },
        },
      ],
    }));

    expect(d).toHaveLength(2);
    expect(d.map(x => x.id)).toEqual(['t1/scout', 't2/scout']);
    expect(d.map(x => x.user)).toEqual([
      'Analyze this meal photo.',
      'The tea is unsweetened',
    ]);
    expect(d[0].tokens).toBe(908);
    expect(d[1].tokens).toBe(908);
    expect(d[0].latency_ms).toBe(5231);
    expect(d[1].latency_ms).toBe(5231);
    expect(d[0].model).toBe('gemini-3.5-flash-lite');
    expect(d[1].model).toBe('gemini-3.5-flash-lite');
  });

  it('assigns per-turn usage/timing lines to the matching turn (t1 keeps t1 numbers)', () => {
    const d = extractDispatches(foodInput({
      rawScout: undefined,
      backendLogs: [
        '[UnifiedLLM] Calling gemini-3.5-flash-lite',
        '[UnifiedLLM-Usage:scout] prompt=2539 completion=1250 total=3789',
        '[UnifiedLLM-Timing:scout] ms=9431',
        '[UnifiedLLM-Usage:scout] prompt=3116 completion=1617 total=4733',
        '[UnifiedLLM-Timing:scout] ms=6711',
        '[Budget] Finalized ledger',
      ].join('\n'),
      dispatches: [
        {
          id: 't1/scout',
          turn: 1,
          agent: 'scout',
          user: 'Analyze this meal photo.',
          received: { mode: 'new_log', photoCount: 1 },
        },
        {
          id: 't2/scout',
          turn: 2,
          agent: 'scout',
          user: 'the drink is unsweetened',
          received: { mode: 'edit', userMessage: 'the drink is unsweetened' },
        },
      ],
    }));

    expect(d).toHaveLength(2);
    expect(d[0].tokens).toBe(3789);
    expect(d[0].latency_ms).toBe(9431);
    expect(d[1].tokens).toBe(4733);
    expect(d[1].latency_ms).toBe(6711);
  });

  it('keeps three scout turns when prior dispatches array has length 3', () => {
    const input = foodInput({
      rawScout: undefined,
      dispatches: [
        {
          id: 't1/scout',
          turn: 1,
          agent: 'scout',
          user: 'Analyze this meal photo.',
          received: { mode: 'new_log', photoCount: 1 },
          systemInstruction: 'Scout Sys 1',
          userPrompt: 'Scout Usr 1',
          output: { dishes: [{ dishName: 'Nasi Goreng' }] },
          rawEmission: { dishes: [{ dishName: 'Nasi Goreng' }] },
        },
        {
          id: 't2/scout',
          turn: 2,
          agent: 'scout',
          user: 'The tea is unsweetened',
          received: { mode: 'edit', userMessage: 'The tea is unsweetened' },
          systemInstruction: 'Scout Sys 2',
          userPrompt: 'User modification instruction: "The tea is unsweetened"',
          output: { dishes: [{ dishName: 'Nasi Goreng' }, { dishName: 'Teh Tawar' }] },
          rawEmission: { dishes: [{ dishName: 'Nasi Goreng' }, { dishName: 'Teh Tawar' }] },
        },
        {
          id: 't3/scout',
          turn: 3,
          agent: 'scout',
          user: 'Change fried fish to 150g',
          received: { mode: 'edit', userMessage: 'Change fried fish to 150g' },
          systemInstruction: 'Scout Sys 3',
          userPrompt: 'User modification instruction: "Change fried fish to 150g"',
          output: { dishes: [{ dishName: 'Nasi Goreng' }, { dishName: 'Teh Tawar' }, { dishName: 'Fried Fish' }] },
          rawEmission: { dishes: [{ dishName: 'Nasi Goreng' }, { dishName: 'Teh Tawar' }, { dishName: 'Fried Fish' }] },
        },
      ],
    });

    const d = extractDispatches(input);
    const scouts = d.filter(x => x.agent === 'scout');

    expect(scouts.length).toBeGreaterThanOrEqual(3);
    expect(scouts.slice(0, 3).map(x => x.id)).toEqual(['t1/scout', 't2/scout', 't3/scout']);
    expect(scouts.slice(0, 3).map(x => x.user)).toEqual([
      'Analyze this meal photo.',
      'The tea is unsweetened',
      'Change fried fish to 150g',
    ]);
    expect(new Set(scouts.slice(0, 3).map(x => x.user)).size).toBe(3);
  });

  it('locks three scout turns with distinct users when prior dispatches length is 3', () => {
    const t1User = 'Analyze this meal photo.';
    const t2User = 'The tea is unsweetened';
    const t3User = 'Change fried fish to 150g';

    const input = foodInput({
      rawScout: undefined,
      dispatches: [
        {
          id: 't1/scout',
          turn: 1,
          agent: 'scout',
          user: t1User,
          received: { mode: 'new_log', photoCount: 1 },
        },
        {
          id: 't2/scout',
          turn: 2,
          agent: 'scout',
          user: t2User,
          received: { mode: 'edit', userMessage: t2User },
        },
        {
          id: 't3/scout',
          turn: 3,
          agent: 'scout',
          user: t3User,
          received: { mode: 'edit', userMessage: t3User },
        },
      ],
    });

    const d = extractDispatches(input);
    const scouts = d.filter(x => x.agent === 'scout');

    expect(d.length).toBeGreaterThanOrEqual(3);
    expect(scouts.length).toBe(3);
    expect(d.slice(0, 3).map(x => x.id)).toEqual(['t1/scout', 't2/scout', 't3/scout']);
    expect(scouts.map(x => x.user)).toEqual([t1User, t2User, t3User]);
    expect(new Set(scouts.map(x => x.user)).size).toBe(3);
  });

  it('filters out UI debug download button text from dispatch user prompt', () => {
    const inputWithButtonUser = foodInput({
      lastUserAction: { action: 'debug_download', details: { prompt: 'Download Debug Logs' } },
      dispatches: [
        {
          id: 't1/scout',
          turn: 1,
          agent: 'scout',
          user: 'Download Debug Logs',
          received: { userMessage: 'Analyze this meal photo.' },
        },
      ],
    });
    const d = extractDispatches(inputWithButtonUser);
    expect(d[0].user).toBe('Analyze this meal photo.');
  });

  it('golden: add_item missing newItemName uses itemName', () => {
    const d = extractDispatches(foodInput({
      lastUserAction: { action: 'add_item', details: { newItemName: undefined, itemName: 'Apple' } },
      message: undefined,
      photoUrl: undefined,
      photoUrls: [],
    }));

    expect(d.find((x) => x.agent === 'scout')?.user).toBe('Apple');
  });


  it('preserves jobId tagging and distinct multi-turn dispatch users', () => {
    const t1User = 'Analyze this meal photo.';
    const t2User = 'The tea is unsweetened';
    const t3User = 'Change fried fish to 150g';

    const tree = buildCanonicalRunTree(foodInput({
      rawScout: undefined,
      dispatches: [
        {
          id: 't1/scout',
          turn: 1,
          agent: 'scout',
          user: t1User,
          received: { mode: 'new_log', photoCount: 1 },
        },
        {
          id: 't2/scout',
          turn: 2,
          agent: 'scout',
          user: t2User,
          received: { mode: 'edit', userMessage: t2User },
        },
        {
          id: 't3/scout',
          turn: 3,
          agent: 'scout',
          user: t3User,
          received: { mode: 'edit', userMessage: t3User },
        },
      ],
    }));

    expect(tree.console).toEqual([`[${JOB}] [LOG] hello`]);
    expect(String(tree.backendLogs)).toContain(`[${JOB}] [UnifiedLLM] Calling gemini-3.5-flash-lite`);
    expect(tree.dispatches.slice(0, 3).map(x => x.user)).toEqual([t1User, t2User, t3User]);
    expect(new Set(tree.dispatches.slice(0, 3).map(x => x.user)).size).toBe(3);
  });

  it('builds a medical dispatch and tags console lines for the medical pack', () => {
    const tree = buildCanonicalRunTree(foodInput({
      pack: 'medical',
      message: 'Review my lab results',
      extractedData: { hba1c: 6.1 },
      clientConsoleLogs: ['[LOG] medical payload'],
    }));

    expect(tree.pack).toBe('medical');
    expect(tree.console).toEqual([`[${JOB}] [LOG] medical payload`]);
    expect(tree.dispatches).toHaveLength(1);
    expect(tree.dispatches[0].agent).toBe('medical');
    expect(tree.dispatches[0].id).toBe('t1/medical');
    expect(tree.dispatches.some(d => d.agent === 'scout')).toBe(false);
  });

  it('does not emit scout for medical pack even when scout artifacts are present', () => {
    const tree = buildCanonicalRunTree(foodInput({
      pack: 'medical',
      agentType: 'medical',
      scoutItems: [{ keyword: 'Steak', name: 'Steak' }],
      rawScout: { dishes: [{ dishName: 'Steak', foods: [{ foodName: 'Steak' }] }] },
    }));

    expect(tree.pack).toBe('medical');
    expect(tree.dispatches).toHaveLength(1);
    expect(tree.dispatches[0].agent).toBe('medical');
    expect(tree.dispatches.some(d => d.agent === 'scout')).toBe(false);
  });

  it('builds a health coach dispatch for the health_coach pack, not scout', () => {
    const tree = buildCanonicalRunTree(foodInput({
      pack: 'health_coach',
      message: 'Review my weekly habits',
    }));

    expect(tree.pack).toBe('health_coach');
    expect(tree.dispatches).toHaveLength(1);
    expect(tree.dispatches[0].id).toBe('t1/health_coach');
    expect(tree.dispatches[0].agent).toBe('health_coach');
    expect(tree.dispatches.some(d => d.agent === 'scout')).toBe(false);
  });
});

describe('extractHandoffs', () => {
  it('returns traces with matching jobId from breadcrumb/session fixtures and [] for empty input', () => {
    const traces = extractHandoffs(
      {
        jobId: JOB,
        userActionBreadcrumbs: [
          { timestamp: '2025-09-06T00:00:00Z', action: 'handoff', target: 'health_coach' },
        ],
        sessionEvents: [
          { timestamp: '2025-09-06T00:00:00Z', status: 'handoff', message: 'front_desk -> health_coach' },
        ],
        handoffChain: ['front_desk', 'health_coach'],
        handoffPayload: { source: 'breadcrumb/session fixtures' },
      } as any,
      JOB
    );

    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({
      from: 'front_desk',
      to: 'health_coach',
      jobId: JOB,
      received: { source: 'breadcrumb/session fixtures' },
      keysDropped: [],
    });
    expect(extractHandoffs({} as any, JOB)).toEqual([]);
  });
});

describe('extractPortionAdjustment', () => {
  it('extracts local_math adjustment when portion diff is <= 30%', () => {
    const input: any = {
      pendingFoodLog: {
        weightGrams: 360,
        initialWeightGrams: 400,
        portionAdjustment: {
          type: 'local_math',
          diffPercent: 10,
          fromWeight: 400,
          toWeight: 360,
          agentCalled: false,
          reason: 'Portion change of 10% (<= 30%) recalculated locally without extra agent call.',
        },
      },
    };

    const adj = extractPortionAdjustment(input);
    expect(adj).not.toBeNull();
    expect(adj?.type).toBe('local_math');
    expect(adj?.diffPercent).toBe(10);
    expect(adj?.fromWeight).toBe(400);
    expect(adj?.toWeight).toBe(360);
    expect(adj?.agentCalled).toBe(false);

    const tree = buildCanonicalRunTree(input);
    expect(tree.portionAdjustment).toEqual(adj);
  });

  it('extracts agent_edit adjustment when portion diff is > 30%', () => {
    const input: any = {
      pendingFoodLog: {
        weightGrams: 600,
        initialWeightGrams: 400,
        portionAdjustment: {
          type: 'agent_edit',
          diffPercent: 50,
          fromWeight: 400,
          toWeight: 600,
          agentCalled: true,
          reason: 'Portion change of 50% (> 30%) triggered an agent review edit.',
        },
      },
    };

    const adj = extractPortionAdjustment(input);
    expect(adj).not.toBeNull();
    expect(adj?.type).toBe('agent_edit');
    expect(adj?.diffPercent).toBe(50);
    expect(adj?.fromWeight).toBe(400);
    expect(adj?.toWeight).toBe(600);
    expect(adj?.agentCalled).toBe(true);
  });

  it('extracts portion adjustment from breadcrumbs fallback if not on pendingFoodLog', () => {
    const input: any = {
      userActionBreadcrumbs: [
        {
          action: 'portion_adjust_local',
          details: {
            fromWeight: 500,
            toWeight: 600,
            diffPercent: 20,
            agentCalled: false,
          },
        },
      ],
    };

    const adj = extractPortionAdjustment(input);
    expect(adj).not.toBeNull();
    expect(adj?.type).toBe('local_math');
    expect(adj?.diffPercent).toBe(20);
    expect(adj?.fromWeight).toBe(500);
    expect(adj?.toWeight).toBe(600);
    expect(adj?.agentCalled).toBe(false);
  });
});

describe('retry sessions & stalled stream dispatches', () => {
  it('extracts stalled Vision Scout and fallback dispatches from logs with 90s latency and respective models', () => {
    const logs = [
      '[UnifiedLLM] Calling gemini-3.5-flash-lite',
      '[UnifiedLLM-Prompt:scout] System Instruction:',
      'You are Vision Scout.',
      '[UnifiedLLM-Prompt:scout] User Prompt:',
      'Analyze this meal photo.',
      '[error] Stream stalled: Vision Scout (gemini-3.5-flash-lite) produced no tokens for 90s. Aborting.',
      'Switch to gemini-3.1-flash-lite after error: Stream stalled',
      '[UnifiedLLM] Calling gemini-3.1-flash-lite',
      '[error] Stream stalled: Vision Scout (gemini-3.1-flash-lite) produced no tokens for 90s. Aborting.',
    ].join('\n');

    const d = extractDispatches({
      jobId: 'job_stall_test',
      status: 'failed',
      backendLogs: logs,
      photoUrl: 'https://example.com/meal.jpg',
    });

    expect(d).toHaveLength(2);
    expect(d[0].id).toBe('t1/scout');
    expect(d[0].model).toBe('gemini-3.5-flash-lite');
    expect(d[0].latency_ms).toBe(90000);
    expect(d[0].error).toContain('Stream stalled: Vision Scout (gemini-3.5-flash-lite)');

    expect(d[1].id).toBe('t1/scout-fallback');
    expect(d[1].model).toBe('gemini-3.1-flash-lite');
    expect(d[1].latency_ms).toBe(90000);
    expect(d[1].error).toContain('Stream stalled: Vision Scout (gemini-3.1-flash-lite)');
    expect(d[1].received?.fallbackFrom).toBe('t1/scout');
  });

  it('extracts multi-turn dispatches from continuation session logs', () => {
    const logs = [
      '[UnifiedLLM-Prompt:scout] System Instruction:',
      'You are Vision Scout.',
      '[UnifiedLLM-Prompt:scout] User Prompt:',
      'Analyze this meal photo.',
      '[Vision Scout] done in 2100ms',
      '',
      '--- RETRY / CONTINUATION (TURN 2) ---',
      '',
      '[UnifiedLLM-Prompt:scout] System Instruction:',
      'You are Vision Scout.',
      '[UnifiedLLM-Prompt:scout] User Prompt:',
      'User modification instruction: "The tea is unsweetened"',
      '[Vision Scout] done in 1800ms',
    ].join('\n');

    const d = extractDispatches({
      jobId: 'job_cont_test',
      status: 'succeeded',
      backendLogs: logs,
      photoUrl: 'https://example.com/meal.jpg',
    });

    expect(d.length).toBeGreaterThanOrEqual(2);
    expect(d[0].id).toBe('t1/scout');
    expect(d[0].turn).toBe(1);
    expect(d[0].user).toBe('Analyze this meal photo.');

    expect(d[1].id).toBe('t2/scout');
    expect(d[1].turn).toBe(2);
    expect(d[1].user).toBe('The tea is unsweetened');
  });

  it('merges prior attempt dispatches into tree dispatches when previousAttempts is provided', () => {
    const input = {
      jobId: 'job_prev_attempts_merge',
      status: 'succeeded',
      backendLogs: '[Vision Scout] done in 1200ms',
      previousAttempts: [
        {
          turn: 1,
          status: 'failed',
          dispatches: [
            {
              id: 't1/scout',
              agent: 'scout',
              turn: 1,
              model: 'gemini-3.5-flash-lite',
              latency_ms: 90000,
              error: 'Stream stalled',
            },
          ],
        },
      ],
      dispatches: [
        {
          id: 't2/scout',
          agent: 'scout',
          turn: 2,
          model: 'gemini-3.5-flash-lite',
          latency_ms: 2500,
        },
      ],
    };

    const tree = buildCanonicalRunTree(input);
    expect(tree.previousAttempts).toHaveLength(1);
    expect(tree.dispatches.some(d => d.id === 't1/scout')).toBe(true);
    expect(tree.dispatches.some(d => d.id === 't2/scout')).toBe(true);
  });
});

