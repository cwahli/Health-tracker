import { test, expect, type Page } from '@playwright/test';

/**
 * D-EX-13 — class-based dark mode: `dark:` variants must follow `<html class="dark">`,
 * not the OS media query.
 *
 * The app always renders `<html class="dark">` (see index.html), but Tailwind v4
 * resolves `dark:` variants off `prefers-color-scheme` unless the stylesheet
 * declares `@custom-variant dark (&:where(.dark, .dark *))`. Pre-fix, on a
 * light-preference system the app header (`bg-white dark:bg-slate-900`) computed
 * to white with illegible light text. The light-scheme test below FAILS pre-fix
 * and passes post-fix; that is the regression lock.
 *
 * No form submissions, no account creation, no chat messages — demo login only.
 */

const VIEWPORT = { width: 390, height: 844 };
const DEMO_LOGIN = '#demo-login-btn';
const NAV_HOME = '#nav-tab-home';
const AUTH_CARD = '#auth-card';

/** Relative luminance (rgb) or lightness (oklch) of the header background. Dark < 0.5 <= light. */
async function headerLightness(page: Page): Promise<number> {
  const header = page.locator('header').first();
  await expect(header).toBeVisible({ timeout: 30000 });
  return header.evaluate((el) => {
    const color = getComputedStyle(el).backgroundColor;
    const oklch = color.match(/oklch\(\s*([\d.]+)/);
    if (oklch) return Number(oklch[1]);
    const m = (color.match(/[\d.]+/g) || []).map(Number);
    const [r, g, b] = [m[0] || 0, m[1] || 0, m[2] || 0].map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  });
}

async function settleAndAssertDarkHeader(page: Page, shot: string) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await Promise.race([
    page.locator(AUTH_CARD).waitFor({ state: 'visible', timeout: 30000 }).catch(() => {}),
    page.locator(NAV_HOME).waitFor({ state: 'attached', timeout: 30000 }).catch(() => {}),
  ]);

  const hasDarkClass = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  expect(hasDarkClass, 'expected <html> to carry class "dark"').toBe(true);

  if (await page.locator(DEMO_LOGIN).isVisible().catch(() => false)) {
    await page.locator(DEMO_LOGIN).click();
    await page.locator(NAV_HOME).waitFor({ state: 'attached', timeout: 30000 });
  }

  expect(await headerLightness(page), 'header background must be dark (html.dark, not OS scheme)').toBeLessThan(
    0.5,
  );
  await page.screenshot({ path: `test-results/${shot}` }).catch(() => {});
}

test.describe('theme dark follows html.dark', () => {
  test('dark scheme: header renders dark and stays dark after demo login', async ({ browser }) => {
    const context = await browser.newContext({ viewport: VIEWPORT, colorScheme: 'dark' });
    const page = await context.newPage();
    try {
      await settleAndAssertDarkHeader(page, 'theme-dark-dark-scheme.png');
    } finally {
      await context.close();
    }
  });

  test('light scheme: header still renders dark (regression lock for D-EX-13)', async ({ browser }) => {
    const context = await browser.newContext({ viewport: VIEWPORT, colorScheme: 'light' });
    const page = await context.newPage();
    try {
      await settleAndAssertDarkHeader(page, 'theme-dark-light-scheme.png');
    } finally {
      await context.close();
    }
  });
});
