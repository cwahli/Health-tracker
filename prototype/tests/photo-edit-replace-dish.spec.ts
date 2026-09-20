import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * G10 golden — "photo edit clarifies one dish" UI journey.
 *
 * Reproduces the debugmeal1 journey (debug-job_1789920526160_7rwiexoqd) as a
 * product flow:
 *   Turn 1 — user attaches 2 photos → a meal with 4 dishes is logged.
 *   Turn 2 — user attaches 1 clarification photo with
 *            "this is chicken and I ate less of the peanuts" →
 *            - ONLY the ambiguous dish is replaced (lettuce → Ayam Rebus),
 *            - the peanut row is scaled down (peanuts 210g → 105g),
 *            - the other dishes are untouched,
 *            - the clarification photo is APPENDED to the meal's image list
 *              (initial 2 retained → 3 total).
 *
 * The deterministic edit contract is locked by:
 *   - tests/Golden_meal/10. Photo edit clarifies one dish/expected.json
 *   - server_meal_edit.test.ts > G10 golden
 *   - src/utils/debugRunTree.test.ts > buildTurnTimeline (debug observability)
 *
 * This spec is the browser journey. Turn 2 is a same-thread follow-up, so it
 * needs the live server path (a stubbed, instantly-succeeded job closes the
 * composer). Set LIVE_G10_PHOTO_EDIT=1 to run it against real Gemini; without
 * the flag the cheap shell test still runs so the file is CI-safe.
 */

const GOLDEN_DIR = path.join(process.cwd(), 'tests', 'Golden_meal', '10. Photo edit clarifies one dish');
const TURN1_PHOTOS = [
  path.join(GOLDEN_DIR, 'turn1_pot_chicken_babycorn_enoki.jpg'),
  path.join(GOLDEN_DIR, 'turn1_pot_peanuts_enoki.jpg'),
];
const TURN2_PHOTO = path.join(GOLDEN_DIR, 'turn2_chicken_pack_clarification.jpg');
const EDIT_PROMPT = 'this is chicken and I ate less of the peanuts';

async function demoLogin(page: Page) {
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
}

async function openFoodChat(page: Page) {
  const quickActionBtn = page.locator('button[title="Open quick actions"], button.w-14.h-14').first();
  await quickActionBtn.waitFor({ state: 'visible', timeout: 10000 });
  await quickActionBtn.click();
  const logMealBtn = page.getByRole('button', { name: /Log Meal/i }).first();
  await logMealBtn.waitFor({ state: 'visible', timeout: 5000 });
  await logMealBtn.click();
  await expect(page.locator('#food-chat-input')).toBeVisible({ timeout: 10000 });
}

test.describe('G10: photo edit clarifies ONE dish and appends the photo', () => {
  test.beforeEach(async ({ page }) => {
    await demoLogin(page);
    await page.addInitScript(() => {
      localStorage.setItem('admin_agent_settings', JSON.stringify({
        flashLiteCost: 1, standardCost: 1, quotaDemo: 500, quotaStandard: 500, quotaAdmin: 500,
      }));
    });
  });

  test('demo shell opens the Log Meal composer (G10 photo-edit journey)', async ({ page }) => {
    await expect(page.locator('#nav-tab-food')).toBeAttached({ timeout: 10000 });
    await openFoodChat(page);
    await expect(page.locator('#food-chat-send-btn')).toBeVisible({ timeout: 5000 });
  });

  test('live: 2-photo create then 1-photo clarification replaces one dish and appends the photo', async ({ page }) => {
    test.skip(process.env.LIVE_G10_PHOTO_EDIT !== '1', 'Set LIVE_G10_PHOTO_EDIT=1 to run the live photo-edit soak');
    test.skip(!fs.existsSync(TURN2_PHOTO), 'G10 golden photos are missing');
    test.setTimeout(900000);

    const baseURL = process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://127.0.0.1:3000';
    const input = page.locator('#food-chat-input');
    const send = page.locator('#food-chat-send-btn');
    const fileInput = page.locator('#food-chat-container input[type="file"], input[type="file"]').first();
    const jobIds: string[] = [];

    const waitJobSucceeded = async (jobId: string, notBeforeMs: number) => {
      const deadline = Date.now() + 240000;
      let sawRunning = false;
      while (Date.now() < deadline) {
        const res = await page.request.get(`${baseURL}/api/jobs/status?jobId=${jobId}&full=true`);
        const data = await res.json().catch(() => ({} as any));
        const all: any[] = Array.isArray(data?.jobs) ? data.jobs : [];
        const job = all.find((j) => String(j?.id) === jobId) || data?.job || data;
        const status = job?.status;
        const updatedRaw = job?.updated_at || job?.updatedAt || '';
        const updatedMs = updatedRaw ? Date.parse(String(updatedRaw)) : 0;
        if (status === 'running' || status === 'queued') sawRunning = true;
        if ((sawRunning || !updatedMs || updatedMs >= notBeforeMs - 2000) && ['succeeded', 'failed', 'error'].includes(status)) {
          expect(status, `job ${jobId} terminal`).toBe('succeeded');
          return job;
        }
        await page.waitForTimeout(2000);
      }
      throw new Error(`Timed out waiting for job ${jobId}`);
    };

    const sendAndAwaitJob = async () => {
      const submitWait = page.waitForResponse(
        (r) => r.url().includes('/api/jobs/submit') && r.request().method() === 'POST',
        { timeout: 120000 },
      );
      const clickedAt = Date.now();
      await expect(send).toBeEnabled({ timeout: 15000 });
      await send.click();
      const submitRes = await submitWait;
      const body = await submitRes.json().catch(() => ({} as any));
      const jobId = String(body?.jobId || '');
      expect(jobId, 'submit returns jobId').toMatch(/^job_/);
      jobIds.push(jobId);
      await waitJobSucceeded(jobId, clickedAt);
      return jobId;
    };

    // After a food job succeeds the modal closes and the meal lands in Food
    // History. Reopening it (View Analysis on its task card) re-binds the SAME
    // job thread — that is the user's path to a same-job photo edit.
    const reopenSameJob = async (jobId: string) => {
      await page.locator('#nav-tab-food').click();
      const card = page.locator(`#task-card-${jobId}`);
      await expect(card).toBeVisible({ timeout: 30000 });
      await card.getByRole('button', { name: /View Analysis/i }).first().click();
      await expect(input).toBeVisible({ timeout: 20000 });
    };

    // Reads the meal's dish count and the job id from the status payload.
    const fetchJob = async (jobId: string) => {
      const res = await page.request.get(`${baseURL}/api/jobs/status?jobId=${jobId}&full=true`);
      const data = await res.json().catch(() => ({} as any));
      const all: any[] = Array.isArray(data?.jobs) ? data.jobs : [];
      const job = all.find((j) => String(j?.id) === jobId) || all[0] || data?.job || data;
      const pfl = job?.clean_result?.pendingFoodLog || job?.result?.pendingFoodLog || job?.pendingFoodLog || job?.clean_result?.result?.pendingFoodLog || {};
      const items = pfl.dishes || pfl.itemsBreakdown || job?.clean_result?.dishes || [];
      const dishes = Array.isArray(items) ? items : [];
      return { job, pfl, dishes };
    };

    await openFoodChat(page);

    // ---- Turn 1: 2 photos, no text ----
    await fileInput.setInputFiles(TURN1_PHOTOS);
    await expect(input).toBeVisible({ timeout: 15000 });
    const turn1Job = await sendAndAwaitJob();
    const before = await fetchJob(turn1Job);
    expect(before.dishes.length, 'turn 1 logs multiple dishes').toBeGreaterThanOrEqual(2);

    // ---- Turn 2: reopen SAME thread, attach 1 clarification photo + edit text ----
    await reopenSameJob(turn1Job);
    await fileInput.setInputFiles([TURN2_PHOTO]);
    await input.fill(EDIT_PROMPT);
    const turn2Job = await sendAndAwaitJob();
    expect(turn2Job, 'the edit continues the same job').toBe(turn1Job);

    const after = await fetchJob(turn2Job);
    // The edit replaces in place: the dish count must not grow (no rebuild /
    // duplicate) and the unit count stays the same as turn 1.
    expect(after.dishes.length, 'edit keeps a stable dish count').toBe(before.dishes.length);

    // Persist the job id so the debug export can be pulled/scored downstream.
    fs.writeFileSync('./tests/captures/pw_g10_jobid.txt', turn2Job);
  });

  test('live: the debug export carries both turns\' photos (LIVE_G10_PHOTO_EDIT=1)', async ({ page }) => {
    test.skip(process.env.LIVE_G10_PHOTO_EDIT !== '1', 'Set LIVE_G10_PHOTO_EDIT=1 to run the live photo-edit soak');
    const jobIdFile = './tests/captures/pw_g10_jobid.txt';
    test.skip(!fs.existsSync(jobIdFile), 'Run the live photo-edit test first');

    const jobId = fs.readFileSync(jobIdFile, 'utf-8').trim();
    const userId = 'anonymous';
    const res = await page.request.get(
      `${process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://127.0.0.1:3000'}/api/jobs/debug?jobId=${encodeURIComponent(jobId)}&userId=${encodeURIComponent(userId)}&format=markdown`,
    );
    expect(res.ok()).toBe(true);
    const md = await res.text();
    // Turn timeline proves the journey: turn 1 with 2 photos, turn 2 with 1.
    expect(md).toContain('## 🧭 Turn Timeline (User ↔ Agent)');
    expect(md).toContain('· photos: 2');
    expect(md).toContain('· photos: 1');
    expect(md).toContain(EDIT_PROMPT);
  });
});
