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
});
