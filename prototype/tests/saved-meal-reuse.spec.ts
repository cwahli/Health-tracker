import { test, expect } from '@playwright/test';
import { mapPreviousMealRow } from '../../server_food_previous_meal';

/**
 * Saved-meal reuse must arrive intact.
 *
 * Regression for: a meal logged from a saved meal (history) rendered its
 * composition with pictures, nutrition values and the OCR provenance all
 * missing. The search row is what the card renders from, so this drives the
 * REAL server projection (`mapPreviousMealRow`) over a stored food_logs row and
 * asserts the card the user sees.
 */

const PIXEL_A = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PIXEL_B = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/w8AAwMCAO+ip1sAAAAASUVORK5CYII=';

/** A composite save as it lands in food_logs: evidence lives on item 0. */
const storedRow = {
  id: 'food_oat_9',
  name: 'Mr. Oat Quick Cook Oatmeal',
  date: '2026-09-19',
  weight_grams: 130,
  calories: 0,
  nutrients: {},
  image_urls: [PIXEL_A, PIXEL_B],
  items_breakdown: [
    {
      id: 'food_oat_9_i0',
      name: 'Mr. Oat Quick Cook Oatmeal',
      weight: '130g',
      weightGrams: 130,
      calories: 498,
      protein: 16.4,
      carbohydrates: 97.5,
      totalFat: 7.8,
      saturatedFat: 1.4,
      totalFibre: 13.4,
      sodium: 3,
      imageUrl: PIXEL_A,
      dbSource: 'label',
      rawNutritionLabel: { servingSize: '130g', calories: '498' },
      labelNutrientsPerServing: { calories: 498, protein: 16.4 },
    },
  ],
};

test.describe('saved-meal reuse renders evidence', () => {
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
    await page.route('**/api/jobs/status*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobs: [] }) });
    });
    await page.route('**/api/sync/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, ok: true }) });
    });
    // The server projection, not a hand-written stub, is what the card consumes.
    await page.route('**/api/food/search*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ results: [mapPreviousMealRow(storedRow)] }),
      });
    });
    const quickActionBtn = page.locator('button[title="Open quick actions"], button.w-14.h-14').first();
    await quickActionBtn.waitFor({ state: 'visible', timeout: 10000 });
    await quickActionBtn.click();
    await page.getByRole('button', { name: /Log Meal/i }).first().click();
    await expect(page.locator('#food-chat-input')).toBeVisible({ timeout: 10000 });
  });

  test('keeps pictures, nutrition values and the OCR badge', async ({ page }) => {
    await page.locator('#food-chat-input').fill('mr oat');

    const row = page
      .getByText('Mr. Oat Quick Cook Oatmeal', { exact: true })
      .locator('xpath=ancestor::div[.//button[contains(normalize-space(.),"Add")]][1]');
    await row.getByRole('button', { name: /add/i }).click();
    await expect(page.getByText('STAGED ITEMS')).toBeVisible({ timeout: 15000 });

    await page.locator('#food-chat-send-btn').click();

    const card = page
      .getByText(/Here is the nutrition breakdown for.*Mr\. Oat Quick Cook Oatmeal/i)
      .last()
      .locator('xpath=ancestor::div[contains(@class,"space-y-2.5")][1]');
    await expect(card.getByText(/Here is the nutrition breakdown for/i).first()).toBeVisible({ timeout: 20000 });

    // Nutrition values present and scaled to the 130 g portion.
    await expect(card.getByText(/Calories:\s*498/)).toBeVisible({ timeout: 15000 });
    await expect(card.getByText(/Protein:\s*16\.4/)).toBeVisible({ timeout: 15000 });

    // Pictures present.
    await expect(card.locator(`img[src="${PIXEL_A}"]`).first()).toBeVisible({ timeout: 15000 });

    // OCR provenance present on the item tile.
    const tile = card.locator('span.text-\\[10px\\]', {
      has: page.getByText('Mr. Oat Quick Cook Oatmeal', { exact: true }),
    });
    await tile.getByText('Mr. Oat Quick Cook Oatmeal', { exact: true }).click();
    await expect(page.getByText('Nutrition Facts (OCR Label)').first()).toBeVisible({ timeout: 15000 });
  });

  test('search tile resolves a ref: pointer to the primary photo', async ({ page }) => {
    // Phase 1: save the rich meal so a primary with real photos exists in logs.
    await page.locator('#food-chat-input').fill('mr oat');
    const stageRow = page
      .getByText('Mr. Oat Quick Cook Oatmeal', { exact: true })
      .locator('xpath=ancestor::div[.//button[contains(normalize-space(.),"Add")]][1]');
    await stageRow.getByRole('button', { name: /add/i }).click();
    await expect(page.getByText('STAGED ITEMS')).toBeVisible({ timeout: 15000 });
    await page.locator('#food-chat-send-btn').click();
    await expect(page.getByText(/Here is the nutrition breakdown for.*Mr\. Oat/i).first()).toBeVisible({ timeout: 20000 });
    await page.getByRole('button', { name: /log this/i }).first().click();
    await expect(page.getByText('Saved to History')).toBeVisible({ timeout: 20000 });

    const saved = await page.evaluate(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i) || '';
        if (!k.startsWith('health_app_data_')) continue;
        try {
          const b = JSON.parse(localStorage.getItem(k) || '{}');
          const f = (b.foodLogs || []).find(
            (x: any) => /oat/i.test(x?.name || '') && Array.isArray(x?.imageUrls) && x.imageUrls.length > 0,
          );
          if (f) return { id: f.id, imageUrls: f.imageUrls };
        } catch { /* ignore */ }
      }
      return null;
    });
    expect(saved?.id).toBeTruthy();

    // Phase 2: the server now returns a duplicate-pointer row (ref:), as
    // handleDuplicateFoodLog persists them. The tile must show the photo.
    await page.reload({ waitUntil: 'domcontentloaded' });
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
    await page.route('**/api/food/search*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          results: [
            {
              type: 'previous_meal',
              id: 'cloud-ref-1',
              name: 'Oat Ref Copy',
              portionGrams: 175,
              weightGrams: 175,
              imageUrl: `ref:${(saved as any).id}`,
              imageUrls: [`ref:${(saved as any).id}`],
            },
          ],
        }),
      });
    });
    const quickActionBtn = page.locator('button[title="Open quick actions"], button.w-14.h-14').first();
    await quickActionBtn.waitFor({ state: 'visible', timeout: 10000 });
    await quickActionBtn.click();
    await page.getByRole('button', { name: /Log Meal/i }).first().click();
    await expect(page.locator('#food-chat-input')).toBeVisible({ timeout: 10000 });
    await page.locator('#food-chat-input').fill('oat');

    const row = page
      .getByText('Oat Ref Copy', { exact: true })
      .locator('xpath=ancestor::div[.//button[contains(normalize-space(.),"Add")]][1]');
    await expect(row.getByRole('button', { name: /add/i })).toBeVisible({ timeout: 15000 });
    const thumb = row.locator('img').first();
    await expect(thumb).toBeVisible({ timeout: 15000 });
    expect(await thumb.getAttribute('src')).toContain('data:image');
  });

  test('search tile falls back to the letter tile for an unresolvable ref:', async ({ page }) => {
    // NOTE: beforeEach already opened the Log Meal composer — just override
    // search and type. Re-clicking quick actions would hit the open dialog.
    await page.route('**/api/food/search*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          results: [
            {
              type: 'previous_meal',
              id: 'cloud-ref-2',
              name: 'Oat Ref Copy',
              portionGrams: 280,
              weightGrams: 280,
              imageUrl: 'ref:food_gone_zzz',
              imageUrls: ['ref:food_gone_zzz'],
            },
          ],
        }),
      });
    });
    await expect(page.locator('#food-chat-input')).toBeVisible({ timeout: 10000 });
    await page.locator('#food-chat-input').fill('oat');

    const row = page
      .getByText('Oat Ref Copy', { exact: true })
      .locator('xpath=ancestor::div[.//button[contains(normalize-space(.),"Add")]][1]');
    await expect(row.getByRole('button', { name: /add/i })).toBeVisible({ timeout: 15000 });
    await expect(row.locator('img')).toHaveCount(0);
    await expect(row.locator('div.w-8.h-8', { hasText: 'O' })).toBeVisible({ timeout: 15000 });
  });
});
