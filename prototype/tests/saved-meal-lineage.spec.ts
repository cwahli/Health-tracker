import { test, expect } from '@playwright/test';

/**
 * Saved-meal lineage (parent/child restages, propagation, re-review).
 *
 * Deterministic and hermetic: /api/food/search, /api/sync and (for the
 * re-review test) /api/jobs/* are stubbed. No live Gemini calls.
 * Conventions mirrored from saved-meal-reuse.spec.ts and staged-tray.spec.ts.
 */

const PIXEL_A = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const richRow = (overrides: any = {}) => ({
  type: 'previous_meal',
  id: 'lin_seed_1',
  name: 'Lineage Oat Bowl',
  portionGrams: 130,
  weightGrams: 130,
  calories: 150,
  protein: 5,
  nutrients: { calories: 150, protein: 5, carbohydrates: 27 },
  dbSource: 'label',
  rawNutritionLabel: { servingSize: '100g', calories: '150' },
  imageUrl: PIXEL_A,
  imageUrls: [PIXEL_A],
  ...overrides,
});

const rowFor = (page: any, name: string) =>
  page
    .getByText(name, { exact: true })
    .locator('xpath=ancestor::div[.//button[contains(normalize-space(.),"Add")]][1]');

async function login(page: any) {
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
  await page.route('**/api/sync/**', async (route: any) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, ok: true }) });
  });
  await page.route('**/api/jobs/status*', async (route: any) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobs: [] }) });
  });
}

async function openComposer(page: any) {
  const quickActionBtn = page.locator('button[title="Open quick actions"], button.w-14.h-14').first();
  await quickActionBtn.waitFor({ state: 'visible', timeout: 10000 });
  await quickActionBtn.click();
  await page.getByRole('button', { name: /Log Meal/i }).first().click();
  await expect(page.locator('#food-chat-input')).toBeVisible({ timeout: 10000 });
}

async function stageTop(page: any, name: string) {
  await rowFor(page, name).getByRole('button', { name: /add/i }).click();
  await expect(page.getByText('STAGED ITEMS')).toBeVisible({ timeout: 15000 });
}

async function saveStaged(page: any, name: string) {
  await page.locator('#food-chat-send-btn').click();
  await expect(page.getByText(new RegExp(`Here is the nutrition breakdown for.*${name}`, 'i')).first()).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: /log this/i }).first().click();
  await expect(page.getByText('Saved to History')).toBeVisible({ timeout: 20000 });
}

async function readLogs(page: any): Promise<any[]> {
  return page.evaluate(() => {
    const out: any[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) || '';
      if (!k.startsWith('health_app_data_')) continue;
      try {
        out.push(...(JSON.parse(localStorage.getItem(k) || '{}').foodLogs || []));
      } catch { /* ignore */ }
    }
    return out;
  });
}

async function waitLog(page: any, pred: (l: any) => boolean): Promise<any> {
  let found: any = null;
  await expect.poll(async () => {
    const logs = await readLogs(page);
    found = logs.find(pred);
    return found ? found.id : null;
  }, { timeout: 15000 }).toBeTruthy();
  return found;
}

async function searchStub(page: any, results: any[]) {
  await page.route('**/api/food/search*', async (route: any) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results }) });
  });
}

const brandRow = (overrides: any = {}) => ({
  food_id: 'brand_oat_1',
  dish_name: 'Lineage Oat Bowl',
  chain_name: 'Lineage Kitchen',
  imageUrl: PIXEL_A,
  serving_grams: 130,
  nutrients: { calories: 150, protein: 5, carbohydrates: 27 },
  ...overrides,
});

async function gotoHistory(page: any) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await login(page);
  await page.locator('#nav-tab-food').click();
}

test.describe('saved-meal lineage', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('L1: restaged child card carries the Saved meal tag', async ({ page }) => {
    await searchStub(page, [richRow()]);
    await openComposer(page);
    await page.locator('#food-chat-input').fill('lineage oat');
    await stageTop(page, 'Lineage Oat Bowl');
    await saveStaged(page, 'Lineage Oat Bowl');

    const child = await waitLog(page, (l: any) => l.name === 'Lineage Oat Bowl' && l.sourceMealId === 'lin_seed_1');
    expect(child).toBeTruthy();

    await gotoHistory(page);
    const card = page.locator(`#food-log-item-${child.id}`);
    await expect(card).toBeVisible({ timeout: 15000 });
    // The Saved meal tag now lives on the small composition thumbnail, so the
    // card must be expanded before the tag is present.
    await card.locator('h3').click();
    await expect(card.getByRole('button', { name: /saved meal/i })).toBeVisible({ timeout: 15000 });
  });

  test('L2: tag click opens the master card', async ({ page }) => {
    // Phase 1: save a FRESH master (brand tag → parentless log).
    await searchStub(page, [brandRow()]);
    await openComposer(page);
    await page.locator('#food-chat-input').fill('lineage');
    await stageTop(page, 'Lineage Oat Bowl');
    await saveStaged(page, 'Lineage Oat Bowl');

    let logs = await readLogs(page);
    const master = await waitLog(page, (l: any) => l.name === 'Lineage Oat Bowl' && !l.sourceMealId);
    expect(master?.id).toBeTruthy();

    // Phase 2: restage the saved master itself (same id → true child).
    await searchStub(page, [{ type: 'previous_meal', id: master.id, name: 'Lineage Oat Bowl', portionGrams: 130, weightGrams: 130 }]);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await login(page);
    await openComposer(page);
    await page.locator('#food-chat-input').fill('lineage');
    await stageTop(page, 'Lineage Oat Bowl');
    await saveStaged(page, 'Lineage Oat Bowl');

    logs = await readLogs(page);
    const child = await waitLog(page, (l: any) => l.id !== master.id && l.sourceMealId === master.id);
    expect(child).toBeTruthy();

    await gotoHistory(page);
    const childCard = page.locator(`#food-log-item-${child.id}`);
    await expect(childCard).toBeVisible({ timeout: 15000 });
    // Tag sits on the small composition thumbnail; expand the card first.
    await childCard.locator('h3').click();
    await childCard.getByRole('button', { name: /saved meal/i }).click();
    const masterCard = page.locator(`#food-log-item-${master.id}`);
    await expect(masterCard).toHaveClass(/ring-2/, { timeout: 15000 });
  });

  test('L3: master edit propagates the name to children', async ({ page }) => {
    // Phase 1: save a FRESH master (brand tag → parentless log).
    await searchStub(page, [brandRow()]);
    await openComposer(page);
    await page.locator('#food-chat-input').fill('lineage');
    await stageTop(page, 'Lineage Oat Bowl');
    await saveStaged(page, 'Lineage Oat Bowl');

    let logs = await readLogs(page);
    const master = await waitLog(page, (l: any) => l.name === 'Lineage Oat Bowl' && !l.sourceMealId);
    await searchStub(page, [{ type: 'previous_meal', id: master.id, name: 'Lineage Oat Bowl', portionGrams: 130 }]);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await login(page);
    await openComposer(page);
    await page.locator('#food-chat-input').fill('lineage');
    await stageTop(page, 'Lineage Oat Bowl');
    await saveStaged(page, 'Lineage Oat Bowl');

    logs = await readLogs(page);
    const childBefore = await waitLog(page, (l: any) => l.id !== master.id && l.sourceMealId === master.id);
    const childUpdatedAt = childBefore.updated_at;

    await gotoHistory(page);
    const masterCard = page.locator(`#food-log-item-${master.id}`);
    await expect(masterCard).toBeVisible({ timeout: 15000 });
    await masterCard.locator('button[title="Edit Food Log"]').click();
    await masterCard.locator('input[type="text"]').first().fill('Lineage Oat Bowl v2');
    await masterCard.locator('button[title="Save All Changes"]').click();

    await expect.poll(async () => {
      const all = await readLogs(page);
      return all.find((l: any) => l.id === childBefore.id)?.name;
    }, { timeout: 15000 }).toBe('Lineage Oat Bowl v2');
    const after = (await readLogs(page)).find((l: any) => l.id === childBefore.id);
    expect(after.updated_at).not.toBe(childUpdatedAt);
  });

  test('L4: mixed tray keeps per-item parents without a log parent', async ({ page }) => {
    await searchStub(page, [
      richRow({ id: 'lin_oat', name: 'Lineage Oat Bowl' }),
      richRow({ id: 'lin_rice', name: 'Lineage Rice Bowl', calories: 200, nutrients: { calories: 200 } }),
      { food_id: 'b1', dish_name: 'Fresh Banana', imageUrl: PIXEL_A, serving_grams: 100 },
    ]);
    await openComposer(page);
    await page.locator('#food-chat-input').fill('lineage');
    await stageTop(page, 'Lineage Oat Bowl');
    // Staging clears the dropdown — re-query for each further item.
    await page.locator('#food-chat-input').fill('lineage');
    await stageTop(page, 'Lineage Rice Bowl');
    await page.locator('#food-chat-input').fill('fresh');
    await stageTop(page, 'Fresh Banana');
    await saveStaged(page, 'Lineage Oat Bowl');

    const mixed = await waitLog(
      page,
      (l: any) => (l.name || '').includes('+') && (l.itemsBreakdown || []).length === 3,
    );
    expect(mixed).toBeTruthy();
    expect(mixed.sourceMealId).toBeUndefined();
    expect(mixed.itemsBreakdown.map((i: any) => i.parentMealId || null)).toEqual(['lin_oat', 'lin_rice', null]);
  });

  test('L5: review re-analyzes into the same log id', async ({ page }) => {
    await searchStub(page, [richRow({ id: 'lin_rev_seed', name: 'Lineage Review Oat' })]);
    await openComposer(page);
    await page.locator('#food-chat-input').fill('lineage review');
    await stageTop(page, 'Lineage Review Oat');
    await saveStaged(page, 'Lineage Review Oat');

    let logs = await readLogs(page);
    const original = await waitLog(page, (l: any) => l.name === 'Lineage Review Oat');
    expect(original?.id).toBeTruthy();

    await gotoHistory(page);
    const card = page.locator(`#food-log-item-${original.id}`);
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.locator('button[title="Edit Food Log"]').click();
    await card.locator('button[title="Review"]').click();

    await expect(page.locator('#food-chat-input')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#food-chat-input')).toHaveValue(/Lineage Review Oat/, { timeout: 15000 });
    // Seeded photos arrive as composer previews; drop them so the restage
    // below takes the deterministic instant-composite path (the agent inbox
    // save carrying the same id is covered by resolveInboxSaveId unit tests).
    const thumbs = page.locator('img[alt="Preview thumbnail"]');
    await expect(thumbs.first()).toBeVisible({ timeout: 15000 });
    while ((await thumbs.count()) > 0) {
      await thumbs.first().locator('xpath=../button').click();
    }

    // Restage the same meal as a thin row and save via the instant composite
    // path: the review-session override must keep the reviewed log id, so the
    // record updates instead of duplicating. A non-matching query keeps the
    // local twin out of the dropdown so the thin API row is staged for sure.
    await searchStub(page, [{ type: 'previous_meal', id: original.id, name: 'Lineage Review Oat', portionGrams: 130, weightGrams: 130, calories: 777, nutrients: { calories: 777 } }]);
    await page.locator('#food-chat-input').fill('');
    await page.locator('#food-chat-input').fill('xyz123q');
    await stageTop(page, 'Lineage Review Oat');
    await page.locator('#food-chat-send-btn').click();
    await expect(page.getByText(/Here is the nutrition breakdown for.*Lineage Review Oat/i).first()).toBeVisible({ timeout: 20000 });
    await page.getByRole('button', { name: /log this/i }).first().click();
    await expect(page.getByText('Saved to History')).toBeVisible({ timeout: 20000 });

    await expect.poll(async () => {
      const all = await readLogs(page);
      return all.find((l: any) => l.id === original.id)?.nutrients?.calories;
    }, { timeout: 20000 }).toBe(777);
    logs = await readLogs(page);
    expect(logs.filter((l: any) => l.id === original.id)).toHaveLength(1);
  });

  test('L6: dead tile photos degrade to letter, never stock', async ({ page }) => {
    await searchStub(page, [
      { type: 'previous_meal', id: 'lin_dead', name: 'Dead Oat Tile', imageUrl: 'https://127.0.0.1:9/dead.jpg', portionGrams: 130, calories: 100, nutrients: { calories: 100 } },
    ]);
    await openComposer(page);
    await page.locator('#food-chat-input').fill('dead oat');
    await stageTop(page, 'Dead Oat Tile');
    await page.locator('#food-chat-send-btn').click();
    const card = page
      .getByText(/Here is the nutrition breakdown for.*Dead Oat Tile/i)
      .last()
      .locator('xpath=ancestor::div[contains(@class,"space-y-2.5")][1]');
    await expect(card.getByText(/Here is the nutrition breakdown for/i).first()).toBeVisible({ timeout: 20000 });
    await expect(card.locator('img[src*="unsplash"]')).toHaveCount(0);
    await expect(card.locator('div:text-is("D")').first()).toBeVisible({ timeout: 15000 });
  });
});
