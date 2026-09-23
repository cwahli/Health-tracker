import { test, expect, type Page } from '@playwright/test';

/**
 * Golden Meal_04 case 12 — chat-modal saved-meal journey, LIVE.
 *
 * Demo shell always runs (open + login + chat affordances). The live journey
 * runs only with LIVE_MEAL12=1 (spends Gemini: 1 setup + 2 journey turns):
 *
 *   T0 setup:  "coconut juice 250ml" -> Apply (saved-meal precondition)
 *   T1 log:    photo + Big Mac brand chip + coconut previous_meal chip
 *              (tray edit 250->200g) + "unsweetened white coffee, small cup"
 *              -> 3 dishes (coffee 200g / burger 508 lock / coconut) -> Apply
 *   T2 edit:   remove coconut chip + "rolled oats" brand chip 40g +
 *              "add oats, drop the coconut" -> auto-promote edit ->
 *              oats added, coconut gone, exact column sums -> Apply
 *
 * Ground truth: golden/meal/Meal_04_log/12_chat_saved_meal/ (FINAL).
 * Scorecard: E2E inventory row meal12-chat-saved-meal.
 *
 * LIVE STATUS 2026-09-17: T0 + T1 GREEN live (chips, tray edit, photo,
 * note, 3 dishes, 508 lock, unsweetened reply, Save Log). T2 RED by design:
 * the sheet closes on submit and reopening starts a fresh thread, so the
 * follow-up goes out as mode review (no UI add/remove edit path exists);
 * review mode double-processes tag+text (phantom Oats Porridge estimate +
 * lock row) and mis-merges the per_100g lock (400 kcal @40 g). T2 goes
 * green when (a) a UI edit affordance / same-thread follow-up exists and
 * (b) the lock merge scales to tag weight. See correct_results.md § gaps.
 */

const first = (page: Page, selectors: string[]) =>
  selectors.map((sel) => page.locator(sel)).reduce((loc, next) => loc.or(next)).first();

const PHOTO = 'golden/meal/Meal_04_log/12_chat_saved_meal/photos/12_cup_white_coffee.jpg';
const baseURL = process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://127.0.0.1:3000';

async function demoLogin(page: Page) {
  const LOGIN_TIMEOUT = 45000;
  const HOME = ['#nav-tab-home'];
  const DEMO = ['#demo-login-btn', 'button:has-text("Demo")', 'button:has-text("Sign in as demo")'];
  try {
    await page.goto('/', { waitUntil: 'networkidle', timeout: 15000 });
  } catch {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: LOGIN_TIMEOUT });
  }
  const homeTab = first(page, HOME);
  const demoBtn = first(page, DEMO);
  await Promise.any([
    homeTab.waitFor({ state: 'attached', timeout: LOGIN_TIMEOUT }),
    demoBtn.waitFor({ state: 'visible', timeout: LOGIN_TIMEOUT }),
  ]).catch(() => {});
  const isHomeAttached = async () =>
    homeTab.waitFor({ state: 'attached', timeout: 1000 }).then(() => true).catch(() => false);
  if (await isHomeAttached()) {
    await expect(homeTab).toBeAttached({ timeout: LOGIN_TIMEOUT });
    return;
  }
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (await demoBtn.isVisible().catch(() => false)) {
      await demoBtn.click({ timeout: 10000 }).catch(() => {});
    }
    if (await homeTab.waitFor({ state: 'attached', timeout: 15000 }).then(() => true).catch(() => false)) {
      return;
    }
    if (attempt === 3) throw new Error('Demo login did not reach home tab after 3 attempts');
  }
  await expect(homeTab).toBeAttached({ timeout: LOGIN_TIMEOUT });
}

async function freshSignup(page: Page) {
  // Pristine backend identity for the live journey: the fixed demo account
  // accumulates jobs across runs, and stale demo seeds outrank the just-saved
  // meal in blank-draft adoption (live T2 attached demo_food_log_3).
  const ts = Date.now();
  await page.evaluate(() => localStorage.clear());
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('#auth-mode-switch-btn').click({ timeout: 10000 });
  await page.locator('#auth-nickname-input').fill('T2Live' + ts, { timeout: 10000 });
  await page.locator('#auth-email-input').fill('t2live' + ts + '@example.com');
  await page.locator('#auth-password-input').fill('LivePass123!');
  await page.locator('#auth-submit-btn').click();
  await page.waitForTimeout(5000);
  for (const id of ['#auth-bypass-verify-btn', '#auth-simulate-verify-btn']) {
    if (await page.locator(id).isVisible().catch(() => false)) {
      await page.locator(id).click().catch(() => {});
      await page.waitForTimeout(2000);
    }
  }
  await expect(page.locator('#nav-tab-home')).toBeAttached({ timeout: 45000 });
}

async function openFoodChat(page: Page) {
  await first(page, ['button[title="Open quick actions"]', 'button.w-14.h-14', '[aria-label*="quick"]']).click();
  await first(page, ['button:has-text("Catat Makanan")', 'button:has-text("Log meal")', 'button:has-text("Log Meal")']).click();
  await expect(page.locator('#food-chat-input')).toBeVisible({ timeout: 15000 });
}

function bumpQuota(page: Page) {
  // Prefer Gemini 3.1 Flash Lite when 3.5 free-tier is exhausted (separate bucket).
  const script = () => {
    localStorage.setItem(
      'admin_agent_settings',
      JSON.stringify({ flashLiteCost: 1, standardCost: 1, quotaDemo: 500, quotaStandard: 500, quotaAdmin: 500 }),
    );
    localStorage.setItem('selectedModelId', 'gemini-3.1-flash-lite');
  };
  return page.addInitScript(script).then(() => page.evaluate(script).catch(() => {}));
}

async function waitJobSucceeded(page: Page, jobId: string, notBeforeMs: number) {
  const deadline = Date.now() + 300000;
  let sawRunning = false;
  while (Date.now() < deadline) {
    const res = await page.request.get(`${baseURL}/api/jobs/status?jobId=${jobId}&full=true`);
    const data = await res.json().catch(() => ({} as any));
    const job = (data?.jobs && data.jobs[0]) || data?.job || data;
    const status = job?.status;
    if (status === 'running' || status === 'queued') sawRunning = true;
    if ((sawRunning || status === 'succeeded') && (status === 'succeeded' || status === 'failed' || status === 'error')) {
      expect(status, `job ${jobId} terminal`).toBe('succeeded');
      return job;
    }
    await page.waitForTimeout(3000);
  }
  throw new Error(`Timed out waiting for job ${jobId}`);
}

async function sendAndAwaitJob(page: Page, jobIds: string[]) {
  // NOTE: the compose sheet closes on submit; the result lands in history
  // with Save Log / View Analysis cards. All result assertions go through
  // the job API (source of truth); UI assertions are soft.
  const submitWait = page.waitForResponse(
    (r) => r.url().includes('/api/jobs/submit') && r.request().method() === 'POST',
    { timeout: 120000 },
  );
  const clickedAt = Date.now();
  const send = page.locator('#food-chat-send-btn');
  await expect(send).toBeEnabled({ timeout: 15000 });
  await send.click();
  const submitRes = await submitWait;
  const body = await submitRes.json().catch(() => ({} as any));
  let submitReq: any = undefined;
  try {
    submitReq = submitRes.request().postDataJSON?.();
  } catch {}
  const jobId = String(body?.jobId || '');
  expect(jobId, 'submit returns jobId').toMatch(/^job_/);
  jobIds.push(jobId);
  const job = await waitJobSucceeded(page, jobId, clickedAt);
  return { jobId, job, submitReq };
}

const dishesOf = (job: any): any[] =>
  job?.result?.clean_result?.pendingFoodLog?.itemsBreakdown ||
  job?.clean_result?.pendingFoodLog?.itemsBreakdown ||
  [];

async function clickNewestSaveLog(page: Page, nameHint?: RegExp) {
  // Post-submit the sheet closes; history shows Save Log cards newest-first.
  // Prefer the Save Log on the card matching nameHint (dirty demo histories
  // often have older unsaved jobs above the one we just finished).
  let save;
  if (nameHint) {
    save = page
      .locator('div')
      .filter({ has: page.getByRole('heading', { name: nameHint }) })
      .filter({ has: page.getByRole('button', { name: /Save Log|Simpan Log/i }) })
      .getByRole('button', { name: /Save Log|Simpan Log/i })
      .first();
    // Fall back to first Save Log if the card structure does not nest cleanly.
    if (!(await save.isVisible().catch(() => false))) {
      save = page.getByRole('button', { name: /Save Log|Simpan Log/i }).first();
    }
  } else {
    save = page.getByRole('button', { name: /Save Log|Simpan Log/i }).first();
  }
  await expect(save, 'Save Log button').toBeVisible({ timeout: 30000 });
  await save.click();
  await page.waitForTimeout(4000);
}

test.describe('Golden Meal_04 case 12 — chat saved-meal journey', () => {
  test.beforeEach(async ({ page }) => {
    await demoLogin(page);
    await bumpQuota(page);
  });

  test('demo shell: food chat opens with composer affordances', async ({ page }) => {
    await openFoodChat(page);
    await expect(page.locator('#food-chat-input')).toBeEnabled({ timeout: 5000 });
    await expect(page.locator('#food-chat-send-btn')).toBeAttached();
  });

  test('LIVE journey T0+T1+T2 when LIVE_MEAL12=1', async ({ page }) => {
    test.skip(process.env.LIVE_MEAL12 !== '1', 'Set LIVE_MEAL12=1 to run the case-12 live journey');
    test.setTimeout(1200000);
    const jobIds: string[] = [];
    // Fresh backend identity (see freshSignup): the fixed demo account
    // accumulates stale seeds across runs, which poison blank-draft adoption.
    await freshSignup(page);
    await bumpQuota(page);

    // ---- T0 setup: saved-meal precondition ----
    await openFoodChat(page);
    let input = page.locator('#food-chat-input');
    await input.click({ timeout: 15000 });
    await input.fill('coconut juice 250ml');
    const t0 = await sendAndAwaitJob(page, jobIds);
    const t0dishes = dishesOf(t0.job);
    expect(t0dishes.map((d: any) => d.name).join('|')).toMatch(/Coconut/i);
    await clickNewestSaveLog(page, /Coconut Juice/i);

    // ---- T1 log: photo + brand chip + saved-meal chip + tray edit + note ----
    // Prove T0 landed in previous_meal search before staging Big Mac.
    await openFoodChat(page);
    input = page.locator('#food-chat-input');
    let tray = page.locator('#food-chat-container');
    let cocoReady = false;
    for (let attempt = 1; attempt <= 3 && !cocoReady; attempt += 1) {
      await input.click({ timeout: 15000 });
      await input.fill('');
      await input.fill('coconut juice');
      cocoReady = await tray.getByText(/Coconut Juice/i).first().isVisible().catch(() => false);
      if (!cocoReady) {
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(1000);
        await clickNewestSaveLog(page, /Coconut Juice/i);
        await openFoodChat(page);
        input = page.locator('#food-chat-input');
        tray = page.locator('#food-chat-container');
      }
    }
    expect(cocoReady, 'T0 Coconut Juice searchable as previous_meal').toBe(true);
    await input.fill('');

    await tray.locator('input[type="file"]').first().setInputFiles(PHOTO);
    await input.click({ timeout: 15000 });
    await input.fill('big mac');
    await expect(tray.getByText('Big Mac').first()).toBeVisible({ timeout: 15000 });
    await tray.locator('button:has-text("Add")').first().click();
    await expect(tray.getByText(/Staged Items/i)).toBeVisible({ timeout: 10000 });

    await input.click({ timeout: 15000 });
    await input.fill('');
    await input.fill('coconut juice');
    const cocoHit = tray.getByText(/Coconut Juice/i).first();
    await expect(cocoHit).toBeVisible({ timeout: 20000 });
    // The previous_meal row's Add (brand row already staged away).
    await tray.locator('button:has-text("Add")').first().click();
    // In-tray portion edit 250 -> 200 (updates bracket text too).
    const weightInputs = tray.locator('input[type="number"]');
    await expect(weightInputs.nth(1)).toBeVisible({ timeout: 10000 });
    await weightInputs.nth(1).fill('200');

    await input.click({ timeout: 15000 });
    await input.fill(
      '[Big Mac] [215g] [Coconut Juice] [200g] unsweetened white coffee, small cup',
    );
    const t1 = await sendAndAwaitJob(page, jobIds);
    // Submit contract: 1 photo + both tags (brand + previous_meal).
    expect(t1.submitReq?.images?.length ?? 0).toBeGreaterThanOrEqual(1);
    const tagSources = (t1.submitReq?.explicitFoodTags || []).map((t: any) => t.source).sort();
    expect(tagSources).toEqual(['catalog_tag', 'previous_meal']);

    const t1dishes = dishesOf(t1.job);
    expect(t1dishes).toHaveLength(3);
    const names1 = t1dishes.map((d: any) => d.name);
    expect(names1.join('|')).toMatch(/Coffee/i);
    expect(names1).toContain('Big Mac');
    expect(names1).toContain('Coconut Juice');
    const burger = t1dishes.find((d: any) => d.name === 'Big Mac');
    expect(burger?.calories).toBe(508); // McDonald's UK label lock
    expect(burger?.weightGrams).toBe(215);
    const coco = t1dishes.find((d: any) => d.name === 'Coconut Juice');
    expect(coco?.weightGrams).toBe(200); // tray edit honored
    const reply1 = JSON.stringify(
      t1.job?.clean_result?.message ||
        t1.job?.result?.message ||
        t1.job?.result?.clean_result?.message ||
        t1.job?.result?.reply ||
        '',
    );
    expect(reply1).toMatch(/unsweetened|sugar/i);
    await clickNewestSaveLog(page, /Big Mac/i);

    // ---- T2 edit: drop coconut, add oats (same session auto-promotes edit) ----
    await openFoodChat(page);
    input = page.locator('#food-chat-input');
    const tray2 = page.locator('#food-chat-container');
    await input.click({ timeout: 15000 });
    await input.fill('rolled oats');
    await expect(tray2.getByText(/Rolled Oats/i).first()).toBeVisible({ timeout: 15000 });
    await tray2.locator('button:has-text("Add")').first().click();
    await input.click({ timeout: 15000 });
    await input.fill('[Mr Oat Rolled Oats] [40g] add oats, drop the coconut');
    const t2 = await sendAndAwaitJob(page, jobIds);
    // NOTE: fresh sends default to mode review (auto-promote only fires inside
    // an already-succeeded job); the journey requirement is outcome-based.
    console.log('T2 submit mode=' + t2.submitReq?.mode);

    const t2dishes = dishesOf(t2.job);
    const names2 = t2dishes.map((d: any) => d.name);
    expect(names2).toContain('Mr Oat Rolled Oats');
    expect(names2).toContain('Big Mac');
    expect(names2.join('|')).not.toMatch(/Coconut/i);
    expect(t2dishes).toHaveLength(3);
    // Exact ledger math: column sums equal meal totals.
    const pending = t2.job?.result?.clean_result?.pendingFoodLog || t2.job?.clean_result?.pendingFoodLog || {};
    const totals = pending.nutrients || {};
    const col = (k: string) => t2dishes.reduce((s: number, d: any) => s + (d?.nutrients?.[k] ?? d?.[k] ?? 0), 0);
    // Prefer server meal totals when present; otherwise require finite column sums.
    if (typeof totals.calories === 'number') {
      expect(col('calories')).toBeCloseTo(totals.calories, 0);
      expect(col('protein')).toBeCloseTo(totals.protein, 0);
      expect(col('sodium')).toBeCloseTo(totals.sodium, 0);
    } else {
      expect(col('calories')).toBeGreaterThan(0);
      expect(col('protein')).toBeGreaterThan(0);
    }
    const oats = t2dishes.find((d: any) => d.name === 'Mr Oat Rolled Oats');
    expect(oats?.weightGrams).toBe(40);
    // Edit mode persists onto the log directly (history shows Edit/Delete, not
    // Save Log), so a final Save click is only needed when the card is unsaved.
    const t2save = page.getByRole('button', { name: /Save Log|Simpan Log/i }).first();
    if (await t2save.isVisible().catch(() => false)) {
      await t2save.click();
      await page.waitForTimeout(4000);
    }
    await expect(page.getByRole('heading', { name: /Mr Oat Rolled Oats/i }).first()).toBeVisible({ timeout: 30000 });

    const fs = await import('node:fs');
    fs.writeFileSync('./tests/captures/pw_meal12_jobids.json', JSON.stringify(jobIds, null, 2));
  });
});
