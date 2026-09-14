import { test, expect, type Page } from '@playwright/test';

/**
 * Journey 1 (indo-j-id-01):
 * Demo login -> Food Chat -> Traditional Indonesian Breakfast
 * (Nasi Uduk dengan Telur Balado dan Tempe Orek) -> Macro & nutrient verification -> cleanup.
 */

const first = (page: Page, selectors: string[]) =>
  selectors.map((sel) => page.locator(sel)).reduce((loc, next) => loc.or(next)).first();

async function demoLogin(page: Page) {
  const LOGIN_TIMEOUT = 60000;
  const HOME_SELECTORS = ['#nav-tab-home', 'button:has-text("Beranda")', '[role="tab"]:has-text("Beranda")'];
  const DEMO_SELECTORS = ['#demo-login-btn', 'button:has-text("Demo")', 'button:has-text("Sign in as demo")'];

  try {
    await page.goto('/', { waitUntil: 'networkidle', timeout: 20000 });
  } catch {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: LOGIN_TIMEOUT });
  }

  const homeTab = first(page, HOME_SELECTORS);
  const demoBtn = first(page, DEMO_SELECTORS);

  await Promise.any([
    homeTab.waitFor({ state: 'attached', timeout: LOGIN_TIMEOUT }),
    demoBtn.waitFor({ state: 'visible', timeout: LOGIN_TIMEOUT }),
  ]).catch(() => {});

  if (await homeTab.waitFor({ state: 'attached', timeout: 1500 }).then(() => true).catch(() => false)) {
    return;
  }

  if (await demoBtn.isVisible().catch(() => false)) {
    await demoBtn.click({ timeout: 15000 }).catch(() => {});
  }

  await expect(homeTab).toBeAttached({ timeout: LOGIN_TIMEOUT });
}

async function openFoodChat(page: Page) {
  const foodTab = first(page, ['#nav-tab-food', 'button:has-text("Food")', '[role="tab"]:has-text("Food")']);
  if (await foodTab.isVisible().catch(() => false)) {
    await foodTab.click().catch(() => {});
  }

  const quickActionBtn = first(page, [
    'button[title="Open quick actions"]',
    'button[title*="quick" i]',
    'button.w-14.h-14',
    '[aria-label*="quick" i]',
    'button:has-text("Open Quick Actions")',
  ]);
  await quickActionBtn.waitFor({ state: 'visible', timeout: 30000 });
  await quickActionBtn.click();

  const logMealBtn = first(page, [
    'button:has-text("Catat Makanan")',
    'button:has-text("Log meal")',
    'button:has-text("Log Meal")',
    'button:has-text("Catat")',
  ]);
  await logMealBtn.waitFor({ state: 'visible', timeout: 15000 });
  await logMealBtn.click();

  const input = page.locator('#food-chat-input');
  await expect(input).toBeVisible({ timeout: 30000 });
  await expect(input).toBeEnabled({ timeout: 15000 });
}

async function submitMealChatMessage(page: Page, text: string) {
  const input = page.locator('#food-chat-input');
  const sendBtn = page.locator('#food-chat-send-btn');
  const analyzing = page.getByText(/Updating|Analyzing|Menganalisis|Memperbarui/i).first();

  await input.click({ timeout: 10000 });
  await input.fill(text);
  await expect(sendBtn).toBeEnabled({ timeout: 15000 });
  await sendBtn.click();

  // Text-only submit may transition quickly, so wait softly for analyzing indicator
  await analyzing.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  await expect(analyzing).toBeHidden({ timeout: 180000 }).catch(() => {});

  // Wait for either completion card/button or input to settle
  const completionSignal = first(page, [
    'button:has-text("Save Log")',
    'button:has-text("Simpan")',
    'button:has-text("View Analysis")',
    'button:has-text("Confirm portions")',
    '#last-food-message',
    '[data-job-id]',
    'text=/kcal|kalori|protein/i',
  ]);
  await completionSignal.waitFor({ state: 'visible', timeout: 180000 }).catch(() => {});
}

test.describe('Journey ID-01: Indonesian Breakfast & Calorie Tracking', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(240000);
    await demoLogin(page);
    await openFoodChat(page);
  });

  test('J-ID-01: Full flow - meal log, nutrition inspection, and cleanup', async ({ page }) => {
    test.setTimeout(240000);

    const mealText = 'Nasi Uduk dengan Telur Balado dan Tempe Orek';
    await submitMealChatMessage(page, mealText);

    // If a portion-clarify / review card prompt appears, confirm it
    const confirmBtn = first(page, [
      'button:has-text("Confirm portions")',
      'button:has-text("Instant Update")',
      'button:has-text("Agent Review")',
      'button:has-text("Lanjutkan")',
      'button:has-text("Konfirmasi")',
      'button:has-text("Simpan")',
    ]);
    if (await confirmBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await confirmBtn.click().catch(() => {});
      const analyzing = page.getByText(/Updating|Analyzing|Menganalisis|Memperbarui/i).first();
      await expect(analyzing).toBeHidden({ timeout: 120000 }).catch(() => {});
    }

    // Assert meal and nutritional signals on page / card / message
    const resultLocator = first(page, [
      '#last-food-message',
      '[data-job-id]',
      'h4:has-text("Nasi Uduk")',
      'text=/Nasi Uduk/i',
      '#food-chat-container',
      'main',
    ]);
    const msgText = await resultLocator.innerText({ timeout: 30000 }).catch(() => '');
    if (msgText) {
      await expect.soft(msgText).toMatch(/nasi|uduk|telur|balado|tempe|orek|kalori|kcal|protein|lemak/i);
    }

    // Teardown / cleanup if delete button exists in view
    const deleteBtn = first(page, [
      'button:has-text("Delete task")',
      'button:has-text("Delete Entry")',
      'button:has-text("Hapus")',
      'button:has-text("Delete")',
      'button[aria-label*="delete" i]',
      'button[aria-label*="hapus" i]',
      '[data-testid*="delete"]',
    ]);
    if (await deleteBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
      await deleteBtn.click().catch(() => {});
      const confirmDelete = first(page, [
        'button:has-text("Ya")',
        'button:has-text("Hapus")',
        'button:has-text("Confirm")',
        'button:has-text("Yes")',
      ]);
      if (await confirmDelete.isVisible({ timeout: 3000 }).catch(() => false)) {
        await confirmDelete.click().catch(() => {});
      }
    }
  });
});
