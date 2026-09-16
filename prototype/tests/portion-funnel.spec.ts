import { test, expect } from '@playwright/test';
import {
  detectPortionAmbiguity,
  detectPackNetWeightGrams,
  resolveItemQuantities,
} from '../../server_portion_clarify';

/**
 * S-10 PORTION_FUNNEL — stubbed portion-clarify journey (no live Gemini):
 * - awaiting_user job with a portionClarify payload renders the picker with options.
 * - Picking the photo estimate + Confirm retires the picker locally (Path A,
 *   no agent resubmit) without page errors.
 */
test.describe('S-10: Portion funnel clarify journey', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const navTab = page.locator('#nav-tab-home');
    const demoBtn = page.locator('#demo-login-btn');

    await Promise.race([
      navTab.waitFor({ state: 'attached', timeout: 20000 }).catch(() => {}),
      demoBtn.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {}),
    ]);

    if (await demoBtn.isVisible().catch(() => false)) {
      await demoBtn.click();
    }

    await navTab.waitFor({ state: 'attached', timeout: 20000 });
  });

  test('picker appears on clarify, confirm retires it locally', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(String(err?.message || err)));

    let activeJobId = '';
    await page.route('**/api/jobs/submit', async (route) => {
      let postData: any = {};
      try {
        postData = JSON.parse(route.request().postData() || '{}');
      } catch (e) {}
      activeJobId = postData.jobId || 'job_stub_clarify_1';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, jobId: activeJobId, status: 'running', message: 'Job submitted successfully' }),
      });
    });

    const clarifyPayload = {
      promptMessage: 'How much of “Indomaret Kacang Kulit” did you eat? (Label is per 100g — pick a portion so we don’t guess.)',
      items: [
        {
          scoutIndex: 2,
          name: 'Indomaret Kacang Kulit',
          estimatedWeightGrams: 100,
          packGrams: 110,
          labelServingGrams: 100,
          options: [
            { id: 'photo_100', label: 'Portion in dish (100g)', weightGrams: 100 },
            { id: 'pack_110', label: 'Whole pack (110g)', weightGrams: 110 },
            { id: 'panel_100', label: '100g (nutrition panel basis)', weightGrams: 100 },
          ],
          reason: 'Package weight (110g) differs from estimated portion (100g) — confirm how much you ate',
        },
      ],
      scoutItems: [],
    };

    await page.route('**/api/jobs/status*', async (route) => {
      const url = new URL(route.request().url());
      const reqJobId = url.searchParams.get('jobId') || activeJobId || 'job_stub_clarify_1';
      const nowIso = new Date().toISOString();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          jobs: [
            {
              id: reqJobId,
              status: 'awaiting_user',
              created_at: nowIso,
              updated_at: nowIso,
              clean_result: {
                pendingFoodLog: {
                  name: 'Indomaret Kacang Kulit',
                  weightGrams: 100,
                  nutrients: { calories: 607, protein: 8.9, carbohydrates: 28.6, totalFat: 46.4 },
                  itemsBreakdown: [],
                },
                portionClarify: clarifyPayload,
              },
            },
          ],
        }),
      });
    });

    // Open Log Meal chat dialog (same affordances as dialog-inventory).
    const quickActionBtn = page.locator('button[title="Open quick actions"], button.w-14.h-14').first();
    await quickActionBtn.waitFor({ state: 'visible', timeout: 10000 });
    await quickActionBtn.click();

    const logMealBtn = page.getByRole('button', { name: /Log Meal/i }).first();
    await logMealBtn.waitFor({ state: 'visible', timeout: 5000 });
    await logMealBtn.click();

    const textInputs = page.locator('textarea, input[placeholder*="eat" i], input[placeholder*="message" i]').first();
    await expect(textInputs).toBeVisible({ timeout: 10000 });
    await textInputs.fill('kacang kulit');

    const sendBtn = page.locator('button[type="submit"], button:has(svg.lucide-arrow-up), button:has(svg.lucide-send)').first();
    await sendBtn.click();

    // Submit closes the dialog (onJobEnqueued); the Food tab job card offers
    // Select Portion once the stubbed awaiting_user poll lands. Reopen the
    // meal dialog through it — the real user journey.
    const selectPortionBtn = page.getByRole('button', { name: /Select Portion/i }).first();
    await expect(selectPortionBtn).toBeVisible({ timeout: 20000 });
    await selectPortionBtn.click();

    // Picker renders with the stubbed options.
    const prompt = page.getByText(/How much of.*Kacang Kulit/i).first();
    await expect(prompt).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: /Whole pack \(110g\)/ }).first()).toBeVisible({ timeout: 5000 });

    // Pick the photo estimate (within tolerance → local Path A, no resubmit).
    await page.getByRole('button', { name: /Portion in dish \(100g\)/ }).first().click();
    await page.getByRole('button', { name: /Confirm portions \(Instant Update\)/ }).first().click();

    // Picker retires; no crash.
    await expect(prompt).not.toBeVisible({ timeout: 10000 });
    expect(pageErrors).toEqual([]);
  });
});

test.describe('S-10: live debug-file regression cases (real funnel, no stubs)', () => {
  /**
   * Case 1 — debug-job_1789171414373: photo-only log, scout est 28g on a
   * 180g "Berat Bersih" pack, label without serving fields. Shipped silent
   * (28g locked, no question). The funnel must ASK.
   */
  test('case-1 silent 28g pack item now asks', () => {
    const items = [
      {
        scoutIndex: 0,
        originalName: 'Kacang Kulit',
        keyword: 'Kacang Kulit',
        estimatedWeightGrams: 28,
        source: 'visual',
        packageLabelText: 'Indomaret Kacang Kulit Berat Bersih 180 g',
        rawNutritionLabel: { calories: 170, protein: 2.5, sodium: 135 },
      },
      {
        scoutIndex: 1,
        originalName: 'Fried Chicken Drumstick',
        keyword: 'Fried Chicken Drumstick',
        estimatedWeightGrams: 120,
        source: 'visual',
      },
      {
        scoutIndex: 2,
        originalName: 'Larutan Cap Kaki Tiga Cooltopia Melon Orange',
        keyword: 'Larutan Cap Kaki Tiga Cooltopia Melon Orange',
        estimatedWeightGrams: 320,
        packGrams: 320,
        source: 'visual',
      },
    ];

    // Root cause of the shipped silence: the old detector had no sticker-text
    // cue, so with no packGrams FIELD it found no pack and bailed on the
    // visual early-return. The cue now derives the pack from the OCR text.
    expect(detectPackNetWeightGrams(items[0])).toBe(180);
    expect(detectPortionAmbiguity(items[0], 0)).not.toBeNull();

    const funnel = resolveItemQuantities(items, { userText: '' });
    expect(funnel.clarifyItems.length).toBe(1);
    expect(funnel.clarifyItems[0].name).toMatch(/kacang/i);
    const weights = funnel.clarifyItems[0].options.map((o) => o.weightGrams);
    expect(weights).toContain(28);
    expect(weights).toContain(90);
    const res = funnel.resolutions.find((r) => r.scoutIndex === 0);
    expect(res?.decision).toBe('ask');

    // Siblings stay silent: chicken has no pack divergence, the 320ml drink
    // equals its single-serve pack (CORE LAW) — no over-asking.
    expect(funnel.clarifyItems.some((i) => i.scoutIndex === 1)).toBe(false);
    expect(funnel.clarifyItems.some((i) => i.scoutIndex === 2)).toBe(false);
  });

  /**
   * Case 2 — debug-job_1789171484121: user said "I had 100g of kacang",
   * scout est 100g on the 180g pack. Shipped a REDUNDANT question.
   * The funnel must stay silent and adopt the stated 100g.
   */
  test('case-2 stated 100g matching est stays silent', () => {
    const items = [
      {
        scoutIndex: 0,
        originalName: 'Fried Chicken Drumstick',
        keyword: 'Fried Chicken Drumstick',
        estimatedWeightGrams: 100,
        source: 'visual',
      },
      {
        scoutIndex: 1,
        originalName: 'Cooltopia Melon Orange Drink',
        keyword: 'Cooltopia Melon Orange',
        estimatedWeightGrams: 320,
        packGrams: 320,
        source: 'visual',
      },
      {
        scoutIndex: 2,
        originalName: 'Indomaret Kacang Kulit',
        keyword: 'Indomaret Kacang Kulit',
        estimatedWeightGrams: 100,
        source: 'visual',
        packageLabelText: 'Berat Bersih: 180 g',
      },
    ];

    // The detector still fires on these grams WITHOUT user context (it never
    // sees user text) — the shipped bug was asking DESPITE the stated 100g.
    // The funnel suppresses it.
    expect(detectPortionAmbiguity(items[2], 2)).not.toBeNull();

    const funnel = resolveItemQuantities(items, { userText: 'I had 100g of kacang' });
    expect(funnel.clarifyItems.length).toBe(0);
    const res = funnel.resolutions.find((r) => r.scoutIndex === 2);
    expect(res?.decision).toBe('accept-stated');
    expect(funnel.items[2].estimatedWeightGrams).toBe(100);
    expect(funnel.items[2].statedGramsAdopted).toBe(true);
  });

  /**
   * Case 3 — debug-job_1789201936859 (live repro of case 1): est "28"
   * (string, as the scout emits), sticker-only pack evidence, no user text.
   * Must ASK with the live option set.
   */
  test('case-3 live 28g repro asks with pack halves', () => {
    const items = [
      {
        scoutIndex: 0,
        originalName: 'Indomaret Kacang Kulit',
        keyword: 'Indomaret Kacang Kulit',
        estimatedWeightGrams: '28',
        source: 'visual',
        packageLabelText: 'Kacang Kulit Berat Bersih 180 g',
        rawNutritionLabel: { calories: 170, protein: 3.6, sodium: 0 },
      },
    ];
    const funnel = resolveItemQuantities(items, {});
    expect(funnel.clarifyItems.length).toBe(1);
    const weights = funnel.clarifyItems[0].options.map((o) => o.weightGrams);
    expect(weights).toEqual(expect.arrayContaining([28, 90, 45, 100]));
  });
});

test.describe('S-10: True Path B full-stack portion edit & contract parity', () => {
  test('Path B: >30% portion change submits to backend, eliminates stutter, syncs table macros, and satisfies Contract Law 15/16', async ({ request }) => {
    // 1. Send the Turn 2 portion change request to the real /api/jobs/submit endpoint
    const turn2Payload = {
      jobId: 'job_test_path_b_kacang_almond_' + Date.now(),
      mode: 'edit',
      userSelectedMode: 'edit',
      isResume: true,
      skipScout: true,
      portionChoices: { '0': 68 },
      text: 'Please update my meal portions: Kacang Almond: 27g ➔ 68g (+152%). Because the portion difference exceeds 30%, please review the nutritional calculation, macro distribution, and provide an updated clinical evaluation and verdict.',
      activeMeal: {
        id: 'meal_test_kacang_1',
        name: 'Kacang Almond',
        weightGrams: 27,
        calories: 180,
        nutrients: {
          calories: 180,
          protein: 8,
          carbohydrates: 3,
          totalFat: 15,
          saturatedFat: 1,
          sodium: 10,
        },
        itemsBreakdown: [
          {
            name: 'Kacang Almond',
            weightGrams: 27,
            calories: 180,
            nutrients: {
              calories: 180,
              protein: 8,
              carbohydrates: 3,
              totalFat: 15,
              saturatedFat: 1,
              sodium: 10,
            },
            foods: [
              {
                name: 'Kacang Almond',
                foodName: 'Kacang Almond',
                weightGrams: 27,
                nutrients: { protein: 8, carbohydrates: 3, totalFat: 15, saturatedFat: 1, sodium: 10 },
              },
            ],
          },
        ],
        scoutItems: [
          {
            scoutIndex: 0,
            name: 'Kacang Almond',
            keyword: 'Kacang Almond',
            estimatedWeightGrams: 27,
            packGrams: 67.5,
            nutrients: { protein: 8, carbohydrates: 3, totalFat: 15, saturatedFat: 1, sodium: 10 },
          },
        ],
      },
      activeScoutItems: [
        {
          scoutIndex: 0,
          name: 'Kacang Almond',
          keyword: 'Kacang Almond',
          estimatedWeightGrams: 27,
          packGrams: 67.5,
          nutrients: { protein: 8, carbohydrates: 3, totalFat: 15, saturatedFat: 1, sodium: 10 },
        },
      ],
      dispatches: [
        {
          id: 't1/scout',
          turn: 1,
          agent: 'scout',
          model: 'gemini-3.5-flash-lite',
          latency_ms: 1200,
          output: {
            verdict: { label: 'Heart-Healthy Fats with Clean Protein', level: 'good' },
            clinicalAdvice: 'These roasted almonds deliver 8g of plant protein and heart-healthy unsaturated fats that support your cholesterol profile. Although calorie-dense, staying within the 27g serving keeps your intake balanced without excess sodium. Pair them with hydration to support your daily metabolic goals.',
          },
        },
      ],
    };

    const submitRes = await request.post('/api/jobs/submit', { data: turn2Payload });
    expect(submitRes.ok()).toBeTruthy();

    // 2. Poll for job completion
    let jobResult: any = null;
    for (let i = 0; i < 20; i++) {
      const statusRes = await request.get(`/api/jobs/status?jobId=${turn2Payload.jobId}`);
      if (statusRes.ok()) {
        const body = await statusRes.json();
        const j = body.jobs?.find((item: any) => item.id === turn2Payload.jobId);
        if (j && (j.status === 'succeeded' || j.status === 'failed')) {
          jobResult = j;
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    expect(jobResult).toBeTruthy();
    expect(jobResult.status).toBe('succeeded');

    // 3. Contract Check: Agent output message & narrative must NOT stutter
    const narrative = jobResult.result?.text || jobResult.result?.message || jobResult.clean_result?.text || jobResult.clean_result?.message;
    expect(narrative).toBeTruthy();
    expect(narrative).not.toMatch(/Kacang Almond:\s*Kacang Almond/i);
    expect(narrative).toMatch(/^Kacang Almond 68g\./);

    // 4. Contract Law 15/16 Word Bounds: between 35 and 70 words
    const words = narrative.trim().split(/\s+/).filter(Boolean).length;
    expect(words).toBeGreaterThanOrEqual(35);
    expect(words).toBeLessThanOrEqual(70);

    // 5. Table Check: Receipt table constituent row must match the grand total (20.1g protein)
    const receiptTable = jobResult.result?.receiptTable || jobResult.result?.clean_result?.receiptTable || jobResult.clean_result?.pendingFoodLog?.receiptTable;
    if (receiptTable) {
      expect(receiptTable).not.toMatch(/\|\s*8g\s*\|\s*2\.5g/); // must NOT have unscaled 8g
      expect(receiptTable).toMatch(/20\.1g/);
    }

    // 6. Run tree & Contract validation via /api/jobs/debug
    const debugRes = await request.post('/api/jobs/debug', {
      data: {
        jobId: turn2Payload.jobId,
        format: 'json',
      },
    });
    if (debugRes.ok()) {
      const debugData = await debugRes.json();
      const verdictAdviceLaw = debugData.contract?.find((c: any) => c.law === 'Agent output: verdict + advice');
      if (verdictAdviceLaw && verdictAdviceLaw.result !== 'PASS') {
        console.error('verdictAdviceLaw diagnostic:', JSON.stringify(verdictAdviceLaw, null, 2));
        console.error('dispatches:', JSON.stringify(debugData.dispatches, null, 2));
      }
      if (verdictAdviceLaw) {
        expect(verdictAdviceLaw.result).toBe('PASS');
      }
    }
  });

  test('UI & Realtime Downgrade Protection: delayed awaiting_user event cannot downgrade succeeded job', async ({ page }) => {
    // Verify in the browser that a succeeded job ignores delayed awaiting_user poll
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const demoBtn = page.locator('#demo-login-btn');
    if (await demoBtn.isVisible().catch(() => false)) {
      await demoBtn.click();
    }
    await page.locator('#nav-tab-home').waitFor({ state: 'attached', timeout: 20000 });

    // Seed a succeeded job directly in client JobStore
    await page.evaluate(() => {
      const win = window as any;
      if (win.JobStore) {
        win.JobStore.createJob({
          id: 'job_race_test_1',
          kind: 'food',
          status: 'succeeded',
          inputSnapshot: { text: 'Kacang Almond' },
          result: {
            text: 'Kacang Almond 68g. 20g of clean protein.',
            portionClarifyAnswered: true,
            pendingFoodLog: { name: 'Kacang Almond', calories: 453 },
          },
        });
      }
    });

    // Simulate delayed poller/realtime event attempting to overwrite with awaiting_user
    await page.evaluate(() => {
      const win = window as any;
      if (win.JobStore) {
        win.JobStore.updateJob('job_race_test_1', { status: 'awaiting_user' });
      }
    });

    // Status MUST remain succeeded
    const finalStatus = await page.evaluate(() => {
      const win = window as any;
      return win.JobStore ? win.JobStore.getJob('job_race_test_1')?.status : null;
    });
    expect(finalStatus).toBe('succeeded');

    // Header MUST NOT show "1 queued"
    const queuedBadge = page.locator('text=/\\d+\\s+queued/i');
    await expect(queuedBadge).not.toBeVisible();
  });
});
