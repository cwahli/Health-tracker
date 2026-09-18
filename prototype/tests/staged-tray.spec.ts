import { test, expect } from '@playwright/test';

/**
 * Track T — Staged-meal compose tray, Tier 2 stubbed (no live Gemini).
 * Each item's test must pass for that item to be COMPLETE (see plan/ROADMAP.md Track T).
 */

const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test.describe('Track T: staged tray', () => {
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

    // Quiet background job polling so assertions only see test-driven traffic.
    await page.route('**/api/jobs/status*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ jobs: [] }),
      });
    });

    // Open the Log Meal food composer.
    const quickActionBtn = page.locator('button[title="Open quick actions"], button.w-14.h-14').first();
    await quickActionBtn.waitFor({ state: 'visible', timeout: 10000 });
    await quickActionBtn.click();

    const logMealBtn = page.getByRole('button', { name: /Log Meal/i }).first();
    await logMealBtn.waitFor({ state: 'visible', timeout: 5000 });
    await logMealBtn.click();

    const composer = page.locator('#food-chat-input');
    await expect(composer).toBeVisible({ timeout: 10000 });
  });

  test('T-1: real photo shown, dead URL falls back to letter, no synthesized-guess image', async ({ page }) => {
    // Deterministic failures for the dead host (no real network dependency).
    await page.route(/127\.0\.0\.1.*/, async (route) => {
      await route.abort('failed');
    });

    const requested: string[] = [];
    page.on('request', (req) => {
      requested.push(req.url());
    });

    await page.route('**/api/food/search*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          results: [
            { type: 'previous_meal', id: 'pm_photo', name: 'Oat Photo Porridge', imageUrl: PIXEL, portionGrams: 130 },
            { type: 'previous_meal', id: 'pm_dead', name: 'Oat Dead Porridge', imageUrl: 'https://127.0.0.1:9/dead.jpg', portionGrams: 280 },
            { type: 'previous_meal', id: 'pm_bare', name: 'Oat Bare Porridge', portionGrams: 210 },
          ],
        }),
      });
    });

    await page.locator('#food-chat-input').fill('oat porridge');

    // Scope to the Matches row: nearest ancestor div that also holds the row's Add button.
    const rowFor = (name: string) =>
      page
        .getByText(name, { exact: true })
        .locator('xpath=ancestor::div[.//button[contains(normalize-space(.),"Add")]][1]');
    const rowPhoto = rowFor('Oat Photo Porridge');
    const rowDead = rowFor('Oat Dead Porridge');
    const rowBare = rowFor('Oat Bare Porridge');

    // Real stored photo renders as an image.
    await expect(rowPhoto.locator('img').first()).toBeVisible({ timeout: 15000 });

    // Dead URL resolves to the letter tile, never a broken-image icon.
    await expect(rowDead.getByText('O', { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(rowDead.locator('img')).toHaveCount(0);

    // No stored photo: letter tile, and no synthesized /photos/<id>.jpg guess is ever requested.
    await expect(rowBare.getByText('O', { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(rowBare.locator('img')).toHaveCount(0);
    expect(requested.filter((u) => u.includes('pm_bare'))).toEqual([]);
  });

  test('T-2: gram inputs keep readable text color in dark mode', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.route('**/api/food/search*', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            results: [
              { food_id: 'b1', dish_name: 'Oat Brand Cereal', imageUrl: PIXEL, serving_grams: 100 },
              { type: 'previous_meal', id: 'pm2', name: 'Oat Morning Porridge', portionGrams: 280 },
            ],
          }),
        });
      });

      await page.locator('#food-chat-input').fill('oat');

      const brandInput = page.locator('#tag-portion-b1');
      const prevInput = page.locator('#prev-portion-pm2');
      await expect(brandInput).toBeVisible({ timeout: 15000 });
      await expect(prevInput).toBeVisible({ timeout: 15000 });
      // Text must be light in dark mode (pre-fix it computed to rgb(0,0,0) on dark slate).
      const lightnessOf = (selector: string) =>
        page.locator(selector).evaluate((el) => {
          const color = getComputedStyle(el as HTMLInputElement).color;
          const oklch = color.match(/oklch\(\s*([\d.]+)/);
          if (oklch) return Number(oklch[1]);
          const m = (color.match(/[\d.]+/g) || []).map(Number);
          const [r, g, b] = [m[0] || 0, m[1] || 0, m[2] || 0].map((v) => {
            v /= 255;
            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
          });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        });
      expect(await lightnessOf('#tag-portion-b1')).toBeGreaterThanOrEqual(0.5);
      expect(await lightnessOf('#prev-portion-pm2')).toBeGreaterThanOrEqual(0.5);
    });

  test('T-3: tray gram field clears mid-edit and clamps on blur', async ({ page }) => {
    await page.route('**/api/food/search*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          results: [
            { type: 'previous_meal', id: 'pm3', name: 'Oat Tray Porridge', portionGrams: 130 },
          ],
        }),
      });
    });

    await page.locator('#food-chat-input').fill('oat');
    const row = page
      .getByText('Oat Tray Porridge', { exact: true })
      .locator('xpath=ancestor::div[.//button[contains(normalize-space(.),"Add")]][1]');
    await row.getByRole('button', { name: /add/i }).click();

    const tray = page
      .getByText('STAGED ITEMS')
      .locator('xpath=ancestor::div[.//input[@type="number"]][1]');
    const gramInput = tray.locator('input[type="number"]');
    await expect(gramInput).toBeVisible({ timeout: 15000 });
    await expect(gramInput).toHaveValue('130');

    // Clearing must stick (pre-fix it snapped straight back to 1).
    await gramInput.fill('');
    await expect(gramInput).toHaveValue('');

    // 0 is allowed mid-edit.
    await gramInput.fill('0');
    await expect(gramInput).toHaveValue('0');

    // Blur clamps to >= 1g.
    await page.locator('#food-chat-input').click();
    await expect(gramInput).toHaveValue('1');
  });

  test('T-4: add stages without mirroring into chat box', async ({ page }) => {
    await page.route('**/api/food/search*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          results: [
            { type: 'previous_meal', id: 'pm4', name: 'Oat Single Porridge', portionGrams: 130 },
          ],
        }),
      });
    });

    const composer = page.locator('#food-chat-input');
    await composer.fill('oat');
    const row = page
      .getByText('Oat Single Porridge', { exact: true })
      .locator('xpath=ancestor::div[.//button[contains(normalize-space(.),"Add")]][1]');
    await row.getByRole('button', { name: /add/i }).click();

    // Tray confirms the staged item (single place of confirmation).
    await expect(page.getByText('STAGED ITEMS')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Oat Single Porridge', { exact: true }).first()).toBeVisible();

    // Chat box must NOT echo the bracket tag (residue-only query is cleared).
    await expect(composer).toHaveValue('');
  });

  test('T-5: staged-only submit composes instantly', async ({ page }) => {
    await page.route('**/api/food/search*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          results: [
            { type: 'previous_meal', id: 'pm5', name: 'Oat Submit Porridge', portionGrams: 130, calories: 150, protein: 5, carbohydrates: 27, totalFat: 3 },
          ],
        }),
      });
    });

    const composer = page.locator('#food-chat-input');
    await composer.fill('oat');
    const row = page
      .getByText('Oat Submit Porridge', { exact: true })
      .locator('xpath=ancestor::div[.//button[contains(normalize-space(.),"Add")]][1]');
    await row.getByRole('button', { name: /add/i }).click();
    await expect(page.getByText('STAGED ITEMS')).toBeVisible({ timeout: 15000 });

    await page.locator('#food-chat-send-btn').click();

    // Instant composite path: breakdown card appears, tray clears.
    await expect(page.getByText(/Here is the nutrition breakdown for.*Oat Submit Porridge/i).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('STAGED ITEMS')).toHaveCount(0);
  });

  test('T-5: staged plus genuine question still routes to agent', async ({ page }) => {
    let submitCalled = false;
    await page.route('**/api/jobs/submit', async (route) => {
      submitCalled = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, jobId: 'job_stub_t5', status: 'running' }),
      });
    });

    await page.route('**/api/food/search*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          results: [
            { type: 'previous_meal', id: 'pm6', name: 'Oat Question Porridge', portionGrams: 130 },
          ],
        }),
      });
    });

    const composer = page.locator('#food-chat-input');
    await composer.fill('oat');
    const row = page
      .getByText('Oat Question Porridge', { exact: true })
      .locator('xpath=ancestor::div[.//button[contains(normalize-space(.),"Add")]][1]');
    await row.getByRole('button', { name: /add/i }).click();
    await expect(page.getByText('STAGED ITEMS')).toBeVisible({ timeout: 15000 });

    // A genuine question is preserved and takes the agent path, not composite.
    await composer.fill('is this healthy');
    await page.locator('#food-chat-send-btn').click();
    await page.waitForTimeout(3000);
    expect(submitCalled).toBe(true);
    await expect(page.getByText(/Here is the nutrition breakdown for/i)).toHaveCount(0);
  });

  test('T-6: composite card gallery shows every staged image', async ({ page }) => {
    const px1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const px2 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/w8AAwMCAO+ip1sAAAAASUVORK5CYII=';
    await page.route('**/api/food/search*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          results: [
            { type: 'previous_meal', id: 'pm9', name: 'Oat Gallery Porridge', portionGrams: 130, calories: 150, imageUrl: px1, imageUrls: [px1, px2] },
          ],
        }),
      });
    });

    await page.locator('#food-chat-input').fill('oat');
    const row = page
      .getByText('Oat Gallery Porridge', { exact: true })
      .locator('xpath=ancestor::div[.//button[contains(normalize-space(.),"Add")]][1]');
    await row.getByRole('button', { name: /add/i }).click();
    await expect(page.getByText('STAGED ITEMS')).toBeVisible({ timeout: 15000 });

    await page.locator('#food-chat-send-btn').click();
    await expect(page.getByText(/Here is the nutrition breakdown for.*Oat Gallery Porridge/i).first()).toBeVisible({ timeout: 15000 });

    // Preview (first) and full second image both render in the card gallery.
    await expect(page.locator(`img[src="${px1}"]`).first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator(`img[src="${px2}"]`).first()).toBeVisible({ timeout: 15000 });
  });

  test('T-7: restaged OCR meal shows label badge with no agent call', async ({ page }) => {
    const apiPosts: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('/api/')) apiPosts.push(req.url());
    });

    await page.route('**/api/food/search*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          results: [
            {
              type: 'previous_meal', id: 'pm10', name: 'Oat OCR Porridge', portionGrams: 100,
              calories: 150, protein: 5, carbohydrates: 27, totalFat: 3,
              dbSource: 'label',
              rawNutritionLabel: { servingSize: '100g', calories: '150' },
              labelNutrientsPerServing: { calories: 150, protein: 5 },
            },
          ],
        }),
      });
    });

    await page.locator('#food-chat-input').fill('oat');
    const row = page
      .getByText('Oat OCR Porridge', { exact: true })
      .locator('xpath=ancestor::div[.//button[contains(normalize-space(.),"Add")]][1]');
    await row.getByRole('button', { name: /add/i }).click();
    await expect(page.getByText('STAGED ITEMS')).toBeVisible({ timeout: 15000 });

    await page.locator('#food-chat-send-btn').click();
    await expect(page.getByText(/Here is the nutrition breakdown for.*Oat OCR Porridge/i).first()).toBeVisible({ timeout: 15000 });

    // Open the item tile label view and expect the OCR badge from the original meal — no agent involved.
    const tile = page.locator('span.text-\\[10px\\]', { has: page.getByText('Oat OCR Porridge', { exact: true }) });
    await tile.getByText('Oat OCR Porridge', { exact: true }).click();
    await expect(page.getByText('Nutrition Facts (OCR Label)').first()).toBeVisible({ timeout: 15000 });
    expect(apiPosts).toEqual([]);
  });
});
