import { describe, it, expect } from 'vitest';
import {
  stripHeavyImages,
  buildDebugMarkdownReport,
  debugReportFromJobMsg,
  coldDebugR2Key,
  COLD_DEBUG_LOG,
} from './debugPayload';
import { buildCanonicalRunTree } from './debugRunTree';

describe('debugPayload', () => {
  it('buildDebugMarkdownReport includes a Split Turn section when a portion question is pending', () => {
    const md = buildDebugMarkdownReport({
      jobId: 'job_split_pending',
      status: 'awaiting_user',
      pack: 'food',
      pendingFoodLog: {
        nutrients: { calories: 700 },
        portionClarify: {
          promptMessage: 'How much of "Oats" did you eat?',
          items: [{ name: 'Oats', estimatedWeightGrams: 35, packGrams: 805 }],
        },
      },
    });

    expect(md).toContain('## 🔀 Split Turn / Portion Clarify');
    expect(md).toContain('How much of "Oats" did you eat?');
    expect(md).toContain('Oats (est 35g, pack 805g)');
    expect(md).toContain('awaiting user answer');
  });

  it('buildDebugMarkdownReport includes Identity heading', () => {
    const md = buildDebugMarkdownReport({
      jobId: 'job_identity_heading',
      status: 'succeeded',
      pack: 'food',
    });

    expect(md).toMatch(/^# Health Tracker .* Report$/m);
    expect(md).toContain('**Job ID:** `job_identity_heading`');
    expect(md).toContain('**Status:** succeeded');
    expect(md).toContain('**Pack:** food');
  });

  it('buildDebugMarkdownReport includes a Dispatches or similar heading when dispatches provided', () => {
    const md = buildDebugMarkdownReport({
      jobId: 'job_dispatch_heading',
      status: 'succeeded',
      message: 'Dispatch heading check',
      dispatches: [{ id: 't1/scout', agent: 'scout' }],
    });

    expect(md).toMatch(/## 📡 Agent Dispatches|Dispatches/i);
  });

  it('passes through nullish and primitive values without throwing', () => {
    expect(() => stripHeavyImages(null)).not.toThrow();
    expect(() => stripHeavyImages(undefined)).not.toThrow();
    expect(stripHeavyImages(null)).toBeNull();
    expect(stripHeavyImages(undefined)).toBeUndefined();
    expect(stripHeavyImages(42)).toBe(42);
  });

  it('strips base64 images and keeps https urls', () => {
    const heavy = 'data:image/jpeg;base64,' + 'A'.repeat(9000);
    const out = stripHeavyImages({
      photoUrl: heavy,
      keep: 'https://cdn.example.com/photos/x.jpg',
      nested: { imageUrl: heavy },
    });
    expect(String(out.photoUrl)).toMatch(/image omitted/);
    expect(out.keep).toContain('https://');
    expect(String(out.nested.imageUrl)).toMatch(/image omitted/);
  });

  it('stripHeavyImages on shallow object with imageBase64 long string redacts it; sibling keys preserved', () => {
    const heavy = 'data:image/png;base64,' + 'A'.repeat(9000);
    const out = stripHeavyImages({
      imageBase64: heavy,
      title: 'Meal photo',
      count: 42,
    });

    expect(String(out.imageBase64)).toMatch(/image omitted/);
    expect(out.title).toBe('Meal photo');
    expect(out.count).toBe(42);
  });

  it('leaves non-image strings and numbers untouched', () => {
    const input = {
      message: 'plain text',
      count: 42,
      nested: { label: 'hello', value: 0 },
    };
    expect(stripHeavyImages(input)).toEqual(input);
  });

  it('handles Buffer-like non-image objects without throwing', () => {
    const input = { type: 'Buffer', data: [1, 2] };
    expect(() => stripHeavyImages(input)).not.toThrow();
    expect(stripHeavyImages(input)).toEqual(input);
  });

  it('recurses into arrays, omits base64 photoUrl, and keeps https photoUrl', () => {
    const base64 = 'data:image/png;base64,' + 'B'.repeat(9000);
    const out = stripHeavyImages({
      items: [
        { photoUrl: base64 },
        { photoUrl: 'https://cdn.example.com/photos/ok.jpg' },
      ],
    });

    expect(String(out.items[0].photoUrl)).toMatch(/image omitted/);
    expect(out.items[1].photoUrl).toContain('https://');
  });

  it('builds markdown report with macros and logs, no base64', () => {
    const md = buildDebugMarkdownReport({
      jobId: 'job_1',
      status: 'succeeded',
      message: 'Looks like a solid meal.',
      backendLogs: '[Vision Scout] ok\n[Budget] mode=A',
      pendingFoodLog: {
        name: 'Co-op beef + yogurt',
        weightGrams: 315,
        nutrients: { calories: 461, protein: 42 },
        itemsBreakdown: [{ originalName: 'Beef topside', weightGrams: 100, nutrients: { calories: 148 } }],
        receiptTable: [{ item: 'Beef', source: 'LABEL', notes: 'printed' }],
      },
      scoutItems: [{ originalName: 'Beef', estimatedWeightGrams: 100 }],
    });
    expect(md).toMatch(/# Health Tracker — (End-to-End Diagnostic|Analysis) Report/);
    expect(md).toContain('job_1');
    expect(md).toContain('Co-op beef + yogurt');
    expect(md).toMatch(/Gate & Trial-Balance Evaluation/);
    expect(md).toMatch(/Calories/);
    expect(md).toContain('[Vision Scout] ok');
    expect(md).toMatch(/Backend (Execution )?Logs/i);
    expect(md).not.toMatch(/data:image/);
  });

  it('cold key is user-scoped', () => {
    expect(coldDebugR2Key('job_abc', 'user_1')).toBe('debug/user_1/job_abc.json');
    expect(COLD_DEBUG_LOG).toContain('ColdDebug');
  });

  it('coldDebugR2Key includes both jobId and userId when provided, and jobId when userId is omitted', () => {
    expect(coldDebugR2Key('abc', 'user1')).toContain('abc');
    expect(coldDebugR2Key('abc', 'user1')).toContain('user1');
    expect(coldDebugR2Key('abc')).toContain('abc');
  });

  it('coldDebugR2Key locks debug prefix, jobId inclusion, and stable null/undefined userId', () => {
    const key = coldDebugR2Key('job_shape_1', 'user_shape');
    expect(key.startsWith('debug/')).toBe(true);
    expect(key).toContain('job_shape_1');
    expect(key).toBe('debug/user_shape/job_shape_1.json');

    expect(() => coldDebugR2Key('job_shape_1', null)).not.toThrow();
    expect(() => coldDebugR2Key('job_shape_1', undefined)).not.toThrow();
    expect(coldDebugR2Key('job_shape_1', null)).toBe('debug/anonymous/job_shape_1.json');
    expect(coldDebugR2Key('job_shape_1', undefined)).toBe(coldDebugR2Key('job_shape_1', null));
  });

  it('coldDebugR2Key returns a stable unknown jobId key for empty jobId', () => {
    expect(coldDebugR2Key('', 'user_1')).toBe('debug/user_1/unknown.json');
    expect(coldDebugR2Key('')).toBe('debug/anonymous/unknown.json');
  });

  it('coldDebugR2Key sanitizes weird characters in jobId/userId to underscore-safe path segments', () => {
    const key = coldDebugR2Key('job/../weird?id', 'user/../weird@email');
    expect(key).toBe('debug/user_.._weird@email/job____weird_id.json');
  });

  it('coldDebugR2Key never returns a leading slash, never doubles slashes, and always ends in .json', () => {
    const keys = [
      coldDebugR2Key('job_1', 'user_1'),
      coldDebugR2Key('/job/../weird?id', '/user/../weird@email'),
      coldDebugR2Key('//job//1', '//user//1'),
      coldDebugR2Key('job/../..', 'user/../..'),
      coldDebugR2Key('', ''),
      coldDebugR2Key('unknown', null),
      coldDebugR2Key('unknown', undefined),
    ];

    for (const key of keys) {
      expect(key.startsWith('/')).toBe(false);
      expect(key).not.toContain('//');
      expect(key.endsWith('.json')).toBe(true);
      expect(key).toMatch(/^debug\/[^/]+\/[^/]+\.json$/);
    }
  });

  it('markdown dispatch heading matches canonical tree.dispatches length after enrichment', () => {
    const input = {
      jobId: 'job_dispatch_parity',
      status: 'succeeded',
      message: 'Parity check',
      dispatches: [
        { id: 't1/scout', agent: 'scout' },
        { id: 't2/scout', agent: 'scout' },
        { id: 't3/scout', agent: 'scout' },
      ],
    };

    const tree = buildCanonicalRunTree(input);
    const md = buildDebugMarkdownReport(input);
    const heading = md.match(/## 📡 Agent Dispatches \((\d+)\)/);

    expect(heading).not.toBeNull();
    expect(Number(heading![1])).toBe(tree.dispatches.length);
    expect(tree.dispatches.length).toBe(3);
  });

  it('renders exactly one per-dispatch heading for each of 3 prior dispatches', () => {
    const input = {
      jobId: 'job_dispatch_heading_parity',
      status: 'succeeded',
      message: 'Heading parity',
      dispatches: [
        { id: 't1/scout', agent: 'scout' },
        { id: 't2/scout', agent: 'scout' },
        { id: 't3/scout', agent: 'scout' },
      ],
    };

    const tree = buildCanonicalRunTree(input);
    const md = buildDebugMarkdownReport(input);
    const headings = md.match(/^### Dispatch /gm) || [];

    expect(tree.dispatches.length).toBe(3);
    expect(headings.length).toBe(tree.dispatches.length);
  });

  it('locks cold debug JSON path triple parity for three dispatches', () => {
    const input = {
      jobId: 'job_cold_debug_triple_parity',
      status: 'succeeded',
      message: 'Triple parity',
      dispatches: [
        { id: 't1/scout', agent: 'scout' },
        { id: 't2/scout', agent: 'scout' },
        { id: 't3/scout', agent: 'scout' },
      ],
    };

    const tree = buildCanonicalRunTree(input);
    const md = buildDebugMarkdownReport(input);
    const heading = md.match(/## 📡 Agent Dispatches \((\d+)\)/);
    const dispatchHeadings = md.match(/^### Dispatch /gm) || [];

    expect(heading).not.toBeNull();
    expect(Number(heading![1])).toBe(3);
    expect(dispatchHeadings.length).toBe(3);
    expect(tree.dispatches.length).toBe(3);
  });

  it('uses tree.dispatches.length for heading when empty prior dispatches and logs invent scout only', () => {
    const input = {
      jobId: 'job_empty_dispatches_invented_scout',
      status: 'succeeded',
      message: 'Invented scout parity',
      dispatches: [],
      backendLogs: '[Vision Scout] ok\n[UnifiedLLM-Prompt:scout] System Instruction:\nYou are scout.',
    };

    const tree = buildCanonicalRunTree(input);
    const md = buildDebugMarkdownReport(input);
    const heading = md.match(/## 📡 Agent Dispatches \((\d+)\)/);
    const dispatchHeadings = md.match(/^### Dispatch /gm) || [];

    expect(tree.dispatches.length).toBe(1);
    expect(heading).not.toBeNull();
    expect(Number(heading![1])).toBe(tree.dispatches.length);
    expect(dispatchHeadings.length).toBe(tree.dispatches.length);
  });

  it('renders vision scout internal reasoning, bounding boxes, and sticker labels', () => {
    const md = buildDebugMarkdownReport({
      jobId: 'job_scout_test',
      status: 'succeeded',
      message: 'Scout test',
      scoutInternalReasoning: 'Observed 3 raw grocery ingredients with price stickers: Cumi, Ikan, and Telur.',
      diningEnvironment: 'grocery_raw_items',
      scoutContentType: 'raw_grocery',
      scoutItems: [
        {
          originalName: 'Cumi Bangka',
          estimatedWeightGrams: 200,
          boundingBox2D: [120, 50, 450, 480],
          sourceImageIndex: 0,
          cookingMethod: 'raw',
          packageLabelText: 'CUMI BANGKA - Berat 0.200',
          components: [
            {
              name: 'Cumi Bangka',
              weightGrams: 200,
              packageLabelText: 'CUMI BANGKA - Berat 0.200',
              sourceImageIndex: 0,
              protein: 32,
              carbohydrates: 0,
              totalFat: 2.8,
              sodium: 88,
            },
          ],
        },
      ],
      rawScout: {
        _internalReasoning: 'Observed 3 raw grocery ingredients',
        dishes: [{ name: 'Cumi Bangka', estimatedWeightGrams: 200 }],
      },
    });

    expect(md).toContain('Vision Scout Results (1 item(s) detected)');
    expect(md).toContain('Scout Internal Reasoning:');
    expect(md).toContain('Observed 3 raw grocery ingredients with price stickers');
    expect(md).toContain('grocery_raw_items');
    expect(md).toContain('[120,50,450,480]');
    expect(md).toContain('CUMI BANGKA - Berat 0.200');
    expect(md).toContain('Itemized Constituent Ingredients & Stickers');
    expect(md).toContain('Raw Emission (Verbatim Output)');
  });

  it('gate failures are the Errors section — not a "no errors found" grep', () => {
    const md = buildDebugMarkdownReport({
      jobId: 'job_gate',
      status: 'succeeded',
      message: 'Looks fine.',
      backendLogs: '[Vision Scout] ok',
      pendingFoodLog: {
        name: 'Pan-Seared Tempeh Bowl',
        nutrients: { calories: 0, protein: 22, carbohydrates: 5, totalFat: 8 },
        itemsBreakdown: [{
          originalName: 'Pan-Seared Tempeh',
          weightGrams: 150,
          calories: 0,
          protein: 22,
          carbohydrates: 5,
          totalFat: 8,
        }],
      },
    });
    expect(md).toMatch(/ZERO_KCAL_WITH_MACROS/);
    expect(md).toMatch(/GATE: FAIL/);
    expect(md).not.toMatch(/No errors found/i);
    expect(md).not.toMatch(/No errors or warnings found in the backend logs/i);
  });

  it('does not paste the same system instruction twice', () => {
    const md = buildDebugMarkdownReport({
      jobId: 'job_dup',
      backendLogs: [
        'Dispatched System Instruction',
        'YOU ARE THE DIETITIAN UNIQUE_TOKEN_XYZ',
        '[Budget] Finalized ledger',
        'Dispatched System Instruction',
        'YOU ARE THE DIETITIAN UNIQUE_TOKEN_XYZ',
      ].join('\n'),
    });
    const matches = md.match(/UNIQUE_TOKEN_XYZ/g) || [];
    expect(matches.length).toBe(1);
  });

  it('shows scout schema once per dispatch and keeps a second distinct dispatch', () => {
    const scoutSchema = '"responseSchema": { "type": "OBJECT", "properties": { "items": {} } } SCOUT_SCHEMA_TOKEN';
    const dietitianInstr = 'YOU ARE THE DIETITIAN DIETITIAN_DISPATCH_TOKEN';
    const md = buildDebugMarkdownReport({
      jobId: 'job_f85',
      backendLogs: [
        'Dispatched System Instruction',
        scoutSchema,
        '[Vision Scout] ok',
        'Dispatched System Instruction',
        scoutSchema,
        '[Budget] Finalized ledger 1',
        'Dispatched System Instruction',
        dietitianInstr,
        '[Budget] Finalized ledger 2',
      ].join('\n'),
    });
    expect((md.match(/SCOUT_SCHEMA_TOKEN/g) || []).length).toBe(1);
    expect(md).toContain('DIETITIAN_DISPATCH_TOKEN');
    expect((md.match(/Finalized ledger/g) || []).length).toBe(2);
  });

  it('shows each agent reply once and keeps a second distinct reply', () => {
    const md = buildDebugMarkdownReport({
      jobId: 'job_replies',
      backendLogs: [
        'Response received (12 chars). Raw output:',
        '{"ok":true,"token":"SCOUT_REPLY_TOKEN"}',
        '[Vision Scout] ok',
        'Response received (12 chars). Raw output:',
        '{"ok":true,"token":"SCOUT_REPLY_TOKEN"}',
        '[Budget] ledger',
        'Response received (20 chars). Raw output:',
        '{"ok":true,"token":"DIETITIAN_REPLY_TOKEN"}',
      ].join('\n'),
    });
    expect(md).toMatch(/Agent Replies/);
    expect((md.match(/SCOUT_REPLY_TOKEN/g) || []).length).toBe(1);
    expect(md).toContain('DIETITIAN_REPLY_TOKEN');
  });

  it('renders Contract Table first immediately after report header', () => {
    const md = buildDebugMarkdownReport({
      jobId: 'job_order_test',
      status: 'succeeded',
      backendLogs: '[Budget] Finalized ledger: 520 kcal',
      pendingFoodLog: { nutrients: { calories: 520 } },
    });

    const contractIndex = md.indexOf('## ⚖️ Contract Evaluation');
    const matrixIndex = md.indexOf('## 🔗 Data Pipelines & Infrastructure Connectivity Matrix');

    expect(contractIndex).toBeGreaterThan(0);
    expect(matrixIndex).toBeGreaterThan(0);
    expect(contractIndex).toBeLessThan(matrixIndex);
  });

  it('renders Modal Snapshot (Dialog Inventory) when present in input', () => {
    const md = buildDebugMarkdownReport({
      jobId: 'job_modal_test',
      status: 'succeeded',
      dialogInventory: {
        open: true,
        title: 'Nasi Goreng',
        on_card: { kcal: 550, protein: 25, carbs: 70, fat: 18 },
        visible: ['View Analysis', 'Download Debug'],
        hidden: ['Retry', 'Attempt 1 of 3'],
        composer: { photo: 1, send: 1 },
        expand: false,
      },
    });

    expect(md).toContain('## 🪟 Modal Snapshot (Dialog Inventory)');
    expect(md).toContain('- **open:** true');
    expect(md).toContain('- **title:** "Nasi Goreng"');
    expect(md).toContain('"kcal":550');
    expect(md).toContain('[View Analysis, Download Debug]');
    expect(md).toContain('[Retry, Attempt 1 of 3]');
  });

  it('carries rawScout and dialogInventory from job result into the report input', () => {
    const rawScout = { dishes: [{ dishName: 'Steak', foods: [{ foodName: 'Steak' }] }], _internalReasoning: 'saw steak' };
    const input = debugReportFromJobMsg(
      { id: 'job_raw', result: { rawScout, dialogInventory: { open: false } } },
      {}
    );
    expect(input.rawScout).toEqual(rawScout);
    expect(input.dialogInventory).toEqual({ open: false });
  });

  it('renders complete Scout received payload (System Instruction, User Prompt, Received) and emitted Raw Emission in markdown', () => {
    const md = buildDebugMarkdownReport({
      jobId: 'job_scout_full_audit',
      status: 'succeeded',
      agentInstructions: {
        scout: {
          systemInstruction: 'You are the Vision Scout. Output strict JSON with schema dishes[].',
          userPrompt: 'Analyze the provided meal image. Ingest all visible foods.',
        },
      },
      rawScout: {
        _internalReasoning: 'Observed grilled salmon with asparagus.',
        dishes: [
          {
            dishName: 'Grilled Salmon',
            estimatedWeightGrams: 180,
            foods: [{ foodName: 'Salmon Fillet', weightGrams: 180 }],
          },
        ],
      },
      photoUrls: ['https://example.com/photo1.jpg'],
      message: 'Logged from dinner',
    });

    expect(md).toContain('### Dispatch t1/scout');
    expect(md).toContain('- **System Instruction:**');
    expect(md).toContain('You are the Vision Scout. Output strict JSON with schema dishes[].');
    expect(md).toContain('- **User Prompt:**');
    expect(md).toContain('Analyze the provided meal image. Ingest all visible foods.');
    expect(md).toContain('- **Received:**');
    expect(md).toContain('"photoCount":1');
    expect(md).toContain('https://example.com/photo1.jpg');
    expect(md).toContain('- **Raw Emission (Verbatim Output):**');
    expect(md).toContain('Grilled Salmon');
    expect(md).toContain('Observed grilled salmon with asparagus.');
  });

  it('does not invent food scout dispatches for receptionist pack', () => {
    const md = buildDebugMarkdownReport({
      jobId: 'job_receptionist_no_scout',
      status: 'succeeded',
      pack: 'receptionist',
      agentType: 'front_desk',
      message: 'Please schedule my lab review.',
      backendLogs: '[Vision Scout] should not create food dispatch\n[UnifiedLLM-Prompt:scout] System Instruction:\nfood scout',
    });

    expect(md).toContain('### Dispatch fd/front_desk');
    expect(md).not.toMatch(/### Dispatch t\d+\/scout/);
    expect(md).not.toContain('### Dispatch t1/resolver');
  });

  it('uses a medical dispatch heading for medical pack instead of scout', () => {
    const md = buildDebugMarkdownReport({
      jobId: 'job_medical_pack_dispatch',
      status: 'succeeded',
      pack: 'medical',
      agentType: 'medical',
      message: 'Review my lab panel.',
      dispatches: [{ id: 't1/medical', agent: 'medical' }],
      backendLogs: '[UnifiedLLM-Prompt:scout] System Instruction:\nfood scout',
    });

    const dispatchHeadings = md.match(/^### Dispatch .*$/gm) || [];
    expect(dispatchHeadings.some((h) => /medical/i.test(h))).toBe(true);
    expect(dispatchHeadings.every((h) => !/scout/i.test(h))).toBe(true);
  });

  it('maps minimal job-like input into markdown DebugReportInput fields', () => {
    const input = debugReportFromJobMsg({ id: 'job_minimal', status: 'succeeded' }, {});
    expect(input.jobId).toBeTruthy();
    expect(input.jobId).toBe('job_minimal');
    expect(input.status).toBe('succeeded');
  });

  it('debugReportFromJobMsg returns jobId j1 for succeeded job with msg stub', () => {
    const input = debugReportFromJobMsg({ id: 'j1', status: 'succeeded' }, {});
    expect(input.jobId).toBe('j1');
  });

  it('includes jobId in markdown for minimal DebugReportInput', () => {
    const jobId = 'job_minimal_debug_markdown';
    const md = buildDebugMarkdownReport({ jobId });
    expect(md).toContain(jobId);
  });

  it('renders identity/jobId heading with zero dispatches and empty food without crashing', () => {
    const md = buildDebugMarkdownReport({
      jobId: 'job_zero_dispatch_empty_food',
      status: 'succeeded',
      dispatches: [],
      pendingFoodLog: {},
    });

    expect(md).toContain('# Health Tracker —');
    expect(md).toContain('**Job ID:** `job_zero_dispatch_empty_food`');
    expect(md).not.toContain('## 📡 Agent Dispatches');
  });

  it('includes Contract table section heading when canonical run tree produces contract evals', () => {
    const input = {
      jobId: 'job_contract_evals_heading',
      status: 'succeeded',
      backendLogs: '[Budget] Finalized ledger: 520 kcal',
      pendingFoodLog: {
        name: 'Chicken Rice',
        nutrients: { calories: 520 },
      },
    };

    const tree = buildCanonicalRunTree(input);
    const md = buildDebugMarkdownReport(input);

    expect(tree.contract.length).toBeGreaterThan(0);
    expect(md).toContain('## ⚖️ Contract Evaluation');
  });

  it('recursively strips nested heavy image fields while preserving non-image data', () => {
    const heavy = `data:image/png;base64,${'A'.repeat(9000)}`;
    const out = stripHeavyImages({
      nested: {
        imageBase64: heavy,
        photoDataUrl: heavy,
        ok: true,
        arr: [{ dataUrl: heavy }],
      },
    });

    expect(out.nested.ok).toBe(true);
    expect(out.nested.arr).toHaveLength(1);
    expect(String(out.nested.imageBase64)).toMatch(/image omitted/);
    expect(String(out.nested.photoDataUrl)).toMatch(/image omitted/);
    expect(String(out.nested.arr[0].dataUrl)).toMatch(/image omitted/);
    expect(JSON.stringify(out)).not.toContain('AAAA');
  });

  it('extractDispatches empty => []', () => {
    const tree = buildCanonicalRunTree({
      jobId: 'job_extract_dispatches_empty',
      dispatches: [],
    });
    expect(tree.dispatches).toEqual([]);
  });

  it('renders all sections and derivations matching Golden Meal specifications for meal logs', () => {
    const md = buildDebugMarkdownReport({
      jobId: 'job_golden_parity_meal01',
      status: 'awaiting_user',
      pack: 'food',
      mode: 'new_log',
      patientContext: '=== NUTRITIONAL TARGET STATUS ===\n3 days avg: Sat fat (27.7g - 38% over), Calorie (2500kcal - 39% over), Sodium (3000mg - 30% over), Protein (100g - 17% under), Carbohydrates (263.3g - 32% over), Total Fibre (22.3g - 26% under), Potassium (2100mg), Soluble Fibre (3.5g), Added Sugar (45g - 50% over), Trans Fat (0.1g)',
      pendingFoodLog: {
        name: 'Sop Daging Sapi + Oatmeal',
        weightGrams: 1785,
        nutrients: {
          calories: 4240.6,
          protein: 125,
          carbohydrates: 637.4,
          totalFat: 116,
          saturatedFat: 20.2,
          transFat: 0.1,
          addedSugar: 39,
          sodium: 925,
          totalFibre: 76,
          omega3: 2.5,
          solubleFibre: 24.5,
          iodine: 8,
          thiamine: 4.83,
        },
        dishes: [
          {
            dishName: 'Sop Daging Sapi',
            estimatedWeightGrams: 450,
            cookingMethod: 'boiled',
            sourceImageIndex: 1,
            boundingBox2D: [80, 120, 920, 880],
            nutrients: { calories: 194, protein: 24, carbohydrates: 10, totalFat: 5.5, sodium: 480 },
            foods: [
              {
                foodName: 'Daging Sapi',
                weightGrams: 80,
                nutrients: { protein: 20.6, saturatedFat: 2, totalFat: 4.8, sodium: 60, carbohydrates: 0 },
              },
              {
                foodName: 'Wortel',
                weightGrams: 50,
                nutrients: { protein: 0.5, saturatedFat: 0, totalFat: 0.2, sodium: 35, carbohydrates: 4.8 },
              },
            ],
          },
          {
            dishName: 'Oatmeal',
            estimatedWeightGrams: 35,
            packGrams: 805,
            packageLabelText: 'Takaran Saji 35 g, 23 sajian per Kemasan',
            sourceImageIndex: 0,
            nutrients: { calories: 3450, protein: 92, carbohydrates: 500, totalFat: 90, sodium: 0 },
            foods: [
              {
                foodName: 'Oatmeal',
                weightGrams: 35,
                packGrams: 805,
                packageLabelText: 'Takaran Saji 35 g, 23 sajian per Kemasan',
                nutrients: { protein: 4, saturatedFat: 0.5, totalFat: 4, sodium: 0, carbohydrates: 23 },
              },
            ],
          },
        ],
      },
    });

    // 1. Header ledger line
    expect(md).toContain('- **Shown ledger:** 4240.6 kcal · 1785 g · 2 dishes');

    // 2. Personalized clinical usage table
    expect(md).toContain('## 🎯 User Nutritional Allowance & Personalized Clinical Usage');
    expect(md).toContain('| Profile Allowance Key | 3-Day Average | Baseline Budget | Status & Surplus/Deficit | Active Usage & Clinical Guidance |');
    expect(md).toContain('| **Calorie** | 2500kcal | 1,800 kcal | **+39% over** |');
    expect(md).toContain('| **Sat fat** | 27.7g | 20.0 g | **+38% over** |');

    // 3. Vision Scout with constituent ingredients
    expect(md).toContain('## 🔍 Vision Scout Results (2 item(s) detected)');
    expect(md).toContain('Daging Sapi (80g); Wortel (50g)');
    expect(md).toContain('### 🥗 Itemized Constituent Ingredients & Stickers (3)');
    expect(md).toContain('| Sop Daging Sapi | Daging Sapi | 80g | #1 | — | P: 20.6g, C: 0g, F: 4.8g, Na: 60mg |');

    // 4. Component items breakdown & constituent receipts
    expect(md).toContain('### Component Items Breakdown & Constituent Receipts');
    expect(md).toContain('| **Sop Daging Sapi** | **450g** | **194** | **24g** | **10g** | **5.5g** | **480mg** |');
    expect(md).toContain('| └─ Daging Sapi | 80g |');
    expect(md).toContain('| **🏆 SHOWN MEAL TOTAL** | **1785g** | **4240.6** | **125g** | **637.4g** | **116g** | **925mg** | ledger total |');

    // 5. Mathematical & thermodynamic validations
    expect(md).toContain('### 🔬 Mathematical & Thermodynamic Validation');
    expect(md).toContain('- **Caloric Density:** 2.38 kcal/g');
    expect(md).toContain('- **Unsaturated fat:** 95.7 g · **Salt:** 2.35 g');

    // 6. Comprehensive nutrient values
    expect(md).toContain('### 📋 Comprehensive Nutrient Values');
    expect(md).toContain('| Omega-3 | 2.5 g |');
    expect(md).toContain('| Soluble Fibre | 24.5 g |');
    expect(md).toContain('| Iodine | 8 mcg |');
    expect(md).toContain('| Thiamine (B1) | 4.83 mg |');
  });

  it('renders Mode D comparison sections matching Golden Meal 03 specifications', () => {
    const md = buildDebugMarkdownReport({
      jobId: 'job_golden_parity_meal03_compare',
      status: 'succeeded',
      pack: 'food',
      mode: 'compare',
      comparisonData: {
        summary: 'Comparing 2 bakery options. Whole wheat provides superior fiber.',
        recommendedOption: 'Whole Wheat Loaf',
        items: [
          {
            name: 'Whole Wheat Loaf',
            brand: 'SayBread',
            tier: 1,
            sourceImageIndex: 0,
            servingSize: '1 slice (40g)',
            hasNutritionLabel: true,
            perServing: { calories: 100, protein: 4, totalFat: 1.5, carbohydrates: 18, sugar: 2, sodium: 150 },
          },
          {
            name: 'Chocolate Croissant',
            brand: 'SayBread',
            tier: 4,
            sourceImageIndex: 0,
            servingSize: '1 piece (80g)',
            hasNutritionLabel: true,
            perServing: { calories: 340, protein: 5, totalFat: 19, carbohydrates: 38, sugar: 15, sodium: 320 },
          },
        ],
        groups: [
          {
            groupName: 'Lean Whole Grains vs Sweet Pastries',
            verdict: { label: 'Prefer High Fiber Grain', level: 'good' },
            comparisonSentence: 'Whole wheat loaf delivers 4x the dietary fiber with 1/10th the saturated fat.',
            message: 'Whole wheat loaf fits your active calorie target.',
            orderingTip: 'Request untoasted or without added margarine spread.',
            boundingBox2D: [100, 150, 800, 850],
            scoutItemIndices: [0, 1],
            averageNutrients: { calories: 220, protein: 4.5, saturatedFat: 5, addedSugar: 8.5, sodium: 235 },
            averageNutrientsPer100g: { calories: 275, protein: 5.6, saturatedFat: 6.25, addedSugar: 10.6, sodium: 293 },
          },
        ],
      },
    });

    // 1. Header line for comparison
    expect(md).toContain('- **Shown comparison:** 2 extracted items across 1 macro clusters (<=10% variance)');

    // 2. Evaluated items table
    expect(md).toContain('## 🔍 Evaluated Items & Product OCR Extraction (2 item(s) detected)');
    expect(md).toContain('| [1] | Whole Wheat Loaf | SayBread | Tier 1 | #0 | 1 slice (40g) | ✅ OCR Locked | 100 | 4g | 1.5g | 18g | 2g | 150mg |');
    expect(md).toContain('| [2] | Chocolate Croissant | SayBread | Tier 4 | #0 | 1 piece (80g) | ✅ OCR Locked | 340 | 5g | 19g | 38g | 15g | 320mg |');

    // 3. Comparison groups breakdown
    expect(md).toContain('## 📊 Comparison Groups & Nutritional Allowance Breakdown (1 groups formed)');
    expect(md).toContain('### Group 1: Lean Whole Grains vs Sweet Pastries');
    expect(md).toContain('- **Clinical Verdict:** `Prefer High Fiber Grain` (good)');
    expect(md).toContain('- **Comparison:** Whole wheat loaf delivers 4x the dietary fiber with 1/10th the saturated fat.');
    expect(md).toContain('- **Clinical Advice:** Whole wheat loaf fits your active calorie target.');
    expect(md).toContain('- **Ordering Tip:** Request untoasted or without added margarine spread.');
    expect(md).toContain('- **Quadrant Bounding Box:** `[100, 150, 800, 850]`');

    // 4. Mathematical validation
    expect(md).toContain('## 🔬 Mathematical & Thermodynamic Validation');
    expect(md).toContain('1. **Macro Variance Clustering Strictness (<=10% Rule):**');
    expect(md).toContain('3. **Derived Invariants (Pure TypeScript):**');

    // 5. Recommendation narrative
    expect(md).toContain('**Top Recommended Option:** `Whole Wheat Loaf`');
  });

  it('allowance table stops at JSON-escaped newlines (no prompt-fragment rows)', () => {
    // Live failure shape (debug-job_1789202906586): patientContext arrives as
    // an object, so the TARGET STATUS match lands in JSON.stringify output
    // where newlines are literal \n — the capture used to swallow the whole
    // following instruction block and comma-split it into fake nutrients.
    const md = buildDebugMarkdownReport({
      jobId: 'job_allowance_cut',
      status: 'succeeded',
      pack: 'food',
      mode: 'new_log',
      patientContext: {
        targetBlock: '=== NUTRITIONAL TARGET STATUS ===\n3 days avg: Sat fat (27.7g - 38% over), Calorie (2500kcal - 39% over), Trans Fat (0.1g)\n\nYou are a Clinical Dietitian.\nGROUP EVERY EXTRACTED DISH INTO NUTRITIONAL CLUSTERS WITH <=10% MACRO VARIANCE.\n1. EVALUATION ONLY (NON-ADDITIVE): items are mutually exclusive choices.',
      },
    });
    expect(md).toContain('| **Calorie** | 2500kcal |');
    expect(md).toContain('| **Sat fat** | 27.7g |');
    expect(md).not.toContain('GROUP EVERY');
    expect(md).not.toContain('EVALUATION ONLY');
    expect(md).not.toContain('NON-ADDITIVE');
  });
});

