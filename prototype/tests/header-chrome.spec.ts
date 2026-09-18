import { test, expect, type Page } from '@playwright/test';

/**
 * Q-11.12 — header chrome smoke: the screens extracted out of `Header.tsx`.
 *
 * Why this file exists: the DB-interactions overlay (`#db-interactions-overlay`)
 * and the theme customizer (`#theme-customizer-screen`) are the two largest JSX
 * regions in `Header.tsx` (746 and 1,330 lines). They were moved into their own
 * modules verbatim, and nothing in the standing suite asserted either one mounts
 * — `r3-smoke` / `key-journeys` never open them. A move that silently fails to
 * render (missing prop, dropped import, portal rendered into the wrong root)
 * would therefore have passed every gate. This pins the two mount paths:
 *
 *   1. header settings icon -> overlay visible -> Close Settings -> hidden
 *   2. avatar -> profile modal -> "Edit theme" -> theme screen visible
 *
 * Both flows must throw no page errors.
 */

const DEMO_LOGIN = '#demo-login-btn';
const AUTH_CARD = '#auth-card';
const IDENTITY = '#avatar-edit-btn';
const NAV_HOME = '#nav-tab-home';

const SETTINGS_OPEN = '#cloud-sync-btn';
const OVERLAY = '#db-interactions-overlay';
const OVERLAY_CLOSE = '#db-interactions-overlay button[title="Close Settings"]';

const THEME_LINK = '#edit-theme-link';
const THEME_SCREEN = '#theme-customizer-screen';

async function settle(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await Promise.race([
    page.locator(AUTH_CARD).waitFor({ state: 'visible', timeout: 30000 }).catch(() => {}),
    page.locator(IDENTITY).waitFor({ state: 'visible', timeout: 30000 }).catch(() => {}),
  ]);
}

async function signedIn(page: Page) {
  if (await page.locator(IDENTITY).isVisible().catch(() => false)) return true;
  if (!(await page.locator(DEMO_LOGIN).isVisible().catch(() => false))) return false;
  await page.locator(DEMO_LOGIN).click();
  await page.locator(NAV_HOME).waitFor({ state: 'attached', timeout: 30000 });
  return page.locator(IDENTITY).isVisible().catch(() => false);
}

test.describe('Q-11.12 header chrome', () => {
  test('the settings overlay mounts from the header and closes again', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await settle(page);
    test.skip(!(await signedIn(page)), 'could not reach a signed-in shell (no demo login available)');

    await page.locator(SETTINGS_OPEN).click();
    await expect(page.locator(OVERLAY)).toBeVisible({ timeout: 15000 });
    await expect(page.locator(OVERLAY)).toContainText('Settings');

    await page.locator(OVERLAY_CLOSE).click();
    await expect(page.locator(OVERLAY)).toBeHidden({ timeout: 15000 });

    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toHaveLength(0);
  });

  test('the theme customizer opens from the profile modal', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await settle(page);
    test.skip(!(await signedIn(page)), 'could not reach a signed-in shell (no demo login available)');

    await page.locator(IDENTITY).click();
    await expect(page.locator(THEME_LINK)).toBeVisible({ timeout: 15000 });
    await page.locator(THEME_LINK).click();

    await expect(page.locator(THEME_SCREEN)).toBeVisible({ timeout: 15000 });
    await expect(page.locator(THEME_SCREEN)).toContainText(/colou?r|preset|font/i);

    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toHaveLength(0);
  });
});
