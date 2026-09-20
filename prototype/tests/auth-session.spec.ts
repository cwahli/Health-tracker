import { test, expect, type Page } from '@playwright/test';

/**
 * Q-11 — auth & session smoke.
 *
 * Why this file exists: commit a14abea shipped a shell that rendered cleanly,
 * passed tsc/vitest/build, and still had no working auth. r3-smoke tolerated it
 * because its beforeEach accepts *either* `#demo-login-btn` *or* `#nav-tab-home`,
 * so a build with no reachable sign-in screen passed by accident.
 *
 * This spec asserts what the user actually needs:
 *   1. The app is never in the "neither" state — sign-in gate, or a signed-in
 *      shell showing a real identity.
 *   2. Sign Out really signs out: the session ends and the sign-in gate returns.
 *   3. Neither flow throws a page error.
 */

const AUTH_CARD = '#auth-card';
const DEMO_LOGIN = '#demo-login-btn';
const IDENTITY = '#avatar-edit-btn';
const NICKNAME = '#user-nickname-text';
const SIGN_OUT = '#profile-modal-bottom-signout-btn';
const NAV_HOME = '#nav-tab-home';

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

test.describe('Q-11 auth & session', () => {
  test('the app lands on the sign-in gate or a shell with a real identity', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await settle(page);

    const atGate = await page.locator(AUTH_CARD).isVisible().catch(() => false);
    const inShell = await page.locator(IDENTITY).isVisible().catch(() => false);

    expect(atGate || inShell, 'no sign-in screen and no signed-in shell: the auth gate is missing').toBe(true);

    if (inShell) {
      const nickname = (await page.locator(NICKNAME).first().innerText().catch(() => '')).trim();
      expect(nickname.length, 'header identity rendered empty').toBeGreaterThan(0);
      await expect(page.locator(NAV_HOME)).toBeAttached();
      // Untranslated keys leaked as visible copy in the regressed build.
      await expect(page.locator('header')).not.toContainText(/[A-Za-z]+ (Desc|Label|Alt)\b/);
    }

    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toHaveLength(0);
  });

  test('sign-out ends the session and returns to the sign-in gate', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await settle(page);
    test.skip(!(await signedIn(page)), 'could not reach a signed-in shell (no demo login available)');

    await page.locator(IDENTITY).click();
    const signOutBtn = page.locator(SIGN_OUT);
    await expect(signOutBtn).toBeVisible({ timeout: 10000 });
    await signOutBtn.click();

    await expect(page.locator(AUTH_CARD)).toBeVisible({ timeout: 30000 });
    await expect(page.locator(IDENTITY)).toBeHidden();
    await expect(page.locator(NAV_HOME)).toHaveCount(0);

    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toHaveLength(0);
  });

  test('Google sign-in never fabricates a login when the provider fails', async ({ page }) => {
    // Regression: the Google handler used to swallow every popup error and
    // silently sign the user in as `google.user@healthcockpit.com`. Blocking the
    // Firebase auth handler forces the failure path; the gate must stay put and
    // no fabricated `@healthcockpit.com` identity may appear.
    await page.route('**/__/auth/**', (route) => route.abort('failed'));
    await page.route('**/identitytoolkit.googleapis.com/**', (route) => route.abort('failed'));
    await page.route('**/securetoken.googleapis.com/**', (route) => route.abort('failed'));

    await settle(page);
    test.skip(!(await page.locator('#google-login-btn').isVisible().catch(() => false)), 'sign-in gate not reachable');

    await page.locator('#google-login-btn').click();
    await page.waitForTimeout(4000);

    // Still on the gate — not signed in as a fake account.
    await expect(page.locator(AUTH_CARD)).toBeVisible();
    await expect(page.locator(NAV_HOME)).toHaveCount(0);
    const body = await page.locator('body').innerText().catch(() => '');
    expect(body).not.toContain('google.user@healthcockpit.com');
    expect(body).not.toMatch(/Google User \(/i);
  });
});
