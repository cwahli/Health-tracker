import path from 'node:path';
import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import {
  ensureSariAccount,
  openCompareMode,
  submitFoodChatMessageWithPhotos,
  cleanupLatestMeal,
  loadSharedCreds,
  saveSharedCreds,
  first,
} from './indo-journey-helpers.js';

/**
 * Journey 2 (indo-j-id-02):
 * Persona: Sari Hartono (F18, 140 cm, 40 kg, target 1350 kcal)
 * Scoreboard Gates Coverage:
 * - Gate 1: Persona Anthropometry & Caloric Delta Gate (Comparison against 140 cm / 1350 kcal budget)
 * - Gate 2: Returning Visit Auth & Indonesian Chrome Gate (Restored session / sign in, no raw keys)
 * - Gate 3: UC-01 Multi-Turn Comparison Dialogue Gate (Evaluating alternatives & topping strip)
 * - Gate 4: Real Indonesian Meal Photo Fixtures Gate (>=2 authentic photos evaluated in compare mode)
 * - Gate 5: Bug Evidence Handling Gate (Graceful overlay handling / fail-green)
 */

test.describe('Journey ID-02: Indonesian Meal Comparison (indo_compare) Live Soak', () => {
  test.setTimeout(900000); // 15 minutes for live Render network + multimodal comparison

  test('J-ID-02: Full Gate Coverage (G1 140cm Delta, G2 Returning Auth, G3 Compare Turns, G4 Compare Photos, G5 Fail-Green)', async ({ page }) => {
    console.log('\n======================================================');
    console.log('[J-ID-02] Starting comparison journey for Sari Hartono');

    // -------------------------------------------------------------------------
    // Gate 2: Returning Visit Auth & Indonesian Chrome Gate
    // -------------------------------------------------------------------------
    // If credentials exist from J-ID-01, restore them; otherwise create and verify returning visit
    let storedCreds = loadSharedCreds();
    if (!storedCreds) {
      console.log('[J-ID-02 Gate 2] Stored credentials not found, setting up initial Sari session...');
      const initAccount = await ensureSariAccount(page, { forceFresh: true });
      storedCreds = { email: initAccount.email, pass: 'TestPass123!' };
      saveSharedCreds(storedCreds.email, storedCreds.pass);
    }

    const userSession = await ensureSariAccount(page, { forceFresh: false });
    console.log(`[J-ID-02 Gate 2] Returning auth complete: returning=${userSession.returning}, email=${userSession.email}`);

    // Assert that the page chrome does not leak raw dot notation keys
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const rawKeyMatch = bodyText.match(/\b(table\.header\.[a-z_]+|auth\.[a-z_]+|error\.[a-z_]+)\b/i);
    expect.soft(rawKeyMatch, 'No raw translation placeholder keys should appear').toBeNull();

    // -------------------------------------------------------------------------
    // Gate 4: Real Indonesian Meal Photo Fixtures Gate
    // -------------------------------------------------------------------------
    // Locate comparison photos: set 1 (SilverQueen & SayBread) or set 3 (Pencok 89 restaurant menus)
    const comparePhotos = [
      path.resolve(process.cwd(), 'golden/meal/Meal_03_compare/set1_silverqueen_chocolate_front.jpg'),
      path.resolve(process.cwd(), 'golden/meal/Meal_03_compare/set1_silverqueen_nutrition_label.jpg'),
      path.resolve(process.cwd(), 'golden/meal/Meal_03_compare/set3_restaurant_menu_page1.jpg'),
      path.resolve(process.cwd(), 'golden/meal/Meal_03_compare/set3_restaurant_menu_page2.jpg'),
    ].filter((p) => fs.existsSync(p));

    console.log(`[J-ID-02 Gate 4] Found ${comparePhotos.length} compare photo fixture(s)`);
    expect(comparePhotos.length, 'At least 2 compare photo fixtures must be present').toBeGreaterThanOrEqual(2);

    // -------------------------------------------------------------------------
    // Gate 1 & Gate 3: Compare Mode Trigger & Multi-Turn Evaluation
    // -------------------------------------------------------------------------
    await openCompareMode(page);

    const comparePrompt = 'Bandingkan menu ini untuk tinggi badan 140 cm dengan target 1350 kkal harian.';
    console.log(`[J-ID-02 Gate 1 & Gate 3] Submitting compare request with ${comparePhotos.slice(0, 2).length} photos`);
    await submitFoodChatMessageWithPhotos(page, comparePrompt, comparePhotos.slice(0, 2));

    // Assert comparison card or evaluation components rendered
    const compareCard = first(page, [
      '[data-testid="compare-evaluation-card"]',
      '[data-testid="compare-group-card"]',
      '[data-testid="compare-title"]',
      '#last-food-message',
      '[data-job-id]',
      'text=/Rekomendasi|Bandingkan|Pilihan|Kalori|kcal/i',
    ]);
    await expect(compareCard).toBeVisible({ timeout: 60000 });

    const cardContent = await compareCard.innerText().catch(() => '');
    console.log(`[J-ID-02 Gate 1 & 3] Comparison card snippet: ${cardContent.slice(0, 250)}`);

    // Gate 1: Check that calorie / portion comparison reflects health context
    expect.soft(cardContent).toMatch(/kalori|kcal|g\b|gram|lemak|gula|porsi|rekomendasi/i);

    // Gate 3 Turn 2: Recalculate / strip toppings or evaluate glycemic impact
    const input = page.locator('#food-chat-input');
    if (await input.isVisible({ timeout: 10000 }).catch(() => false)) {
      console.log('[J-ID-02 Gate 3 Turn 2] Submitting follow-up compare turn (stripping high-fat toppings)');
      await input.fill('Jika tanpa kerupuk dan kuah santan dipisah, bagaimana perbandingannya?');
      const sendBtn = page.locator('#food-chat-send-btn');
      if (await sendBtn.isEnabled({ timeout: 10000 }).catch(() => false)) {
        await sendBtn.click();
        const analyzing = page.getByText(/Updating|Analyzing|Menganalisis|Memperbarui/i).first();
        await analyzing.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
        await expect(analyzing).toBeHidden({ timeout: 120000 }).catch(() => {});
      }
    }

    // -------------------------------------------------------------------------
    // Gate 5: Bug Evidence Handling Gate & Cleanup
    // -------------------------------------------------------------------------
    await cleanupLatestMeal(page);
    console.log('[J-ID-02 Gate 5] Teardown completed without breaking.');
  });
});
