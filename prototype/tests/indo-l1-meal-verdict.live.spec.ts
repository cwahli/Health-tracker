import path from 'node:path';
import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import {
  ensureSariAccount,
  openAndFillSariProfile,
  openFoodChat,
  submitFoodChatMessageWithPhotos,
  cleanupLatestMeal,
  switchAuthLanguageToIndonesian,
  assertDebugContractGreen,
  assertIndonesianMealVerdict,
} from './indo-journey-helpers.js';

/**
 * Track L — L-1 Live Indonesian meal-log proof.
 * One meal on id UI: verdict/advice Indonesian, not English
 * "Supports Sustained Metabolic Energy". Food names may stay English.
 */
test.describe('Track L L-1: Indonesian meal verdict proof', () => {
  test.setTimeout(600000);

  test('L-1: id meal log has Indonesian verdict/advice (not English fallback)', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await switchAuthLanguageToIndonesian(page);
    await ensureSariAccount(page, { forceFresh: false });
    const profileData = await openAndFillSariProfile(page);
    expect(
      profileData.language === 'id' || profileData.language === 'id-ID',
      `L-1 requires persisted profile.language=id (got ${profileData.language})`,
    ).toBeTruthy();

    const photos = [
      path.resolve(process.cwd(), 'golden/meal/Meal_01/photo_01.jpg'),
      path.resolve(process.cwd(), 'golden/meal/Meal_04_log/08_oats_label/photos/08_rolled_oats_1.jpg'),
    ].filter((p) => fs.existsSync(p));
    expect(photos.length, 'need one meal photo fixture').toBeGreaterThan(0);

    await openFoodChat(page);
    const mealText = 'Nasi goreng telur — satu porsi untuk makan siang';
    const submitResult = await submitFoodChatMessageWithPhotos(page, mealText, [photos[0]]);
    expect(submitResult.jobId, 'L-1 must capture a real jobId from dispatch').toBeTruthy();

    const { jsonReport } = await assertDebugContractGreen(page, submitResult.jobId!, 'L-1');
    expect(jsonReport, 'debug dump required').toBeTruthy();
    assertIndonesianMealVerdict(jsonReport, 'L-1');
    await cleanupLatestMeal(page);
  });
});
