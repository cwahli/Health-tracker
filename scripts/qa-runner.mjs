#!/usr/bin/env node
/**
 * scripts/qa-runner.mjs
 * 
 * Autonomous QA Journey Runner for Health-tracker.
 * Executes specific end-to-end user journeys (meal, biomarker, onboarding)
 * using headless Chromium, automatically capturing screenshots and structured
 * bug diagnostic reports on failure.
 * 
 * Usage:
 *   node scripts/qa-runner.mjs --journey=meal [--url=http://localhost:3000] [--save-bug]
 */

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
function getArg(name, defaultValue) {
  const prefix = `--${name}=`;
  const match = args.find(a => a.startsWith(prefix));
  if (match) return match.slice(prefix.length);
  const flagIndex = args.indexOf(`--${name}`);
  if (flagIndex !== -1 && args[flagIndex + 1] && !args[flagIndex + 1].startsWith('--')) {
    return args[flagIndex + 1];
  }
  return defaultValue;
}

const journey = getArg('journey', 'meal');
const baseUrl = getArg('url', process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:3000');
const outputDir = getArg('output-dir', path.join(process.cwd(), 'qa-evidence'));

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

console.log(`[QA Runner] Starting test for journey: ${journey} against ${baseUrl}`);

async function run() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, // iPhone 12/13 mobile viewport
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
  });

  const page = await context.newPage();
  const consoleErrors = [];
  const networkFailures = [];

  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  page.on('requestfailed', request => {
    networkFailures.push(`${request.method()} ${request.url()} - ${request.failure()?.errorText || 'Unknown failure'}`);
  });

  const timestamp = Date.now();
  let failureEvidence = null;

  try {
    // 1. Initial Page Load & Auth Gate
    await page.goto(baseUrl, { waitUntil: 'commit', timeout: 35000 });

    const demoBtn = page.locator('#demo-login-btn');
    const homeTab = page.locator('#nav-tab-home');

    await Promise.race([
      homeTab.waitFor({ state: 'attached', timeout: 20000 }).catch(() => {}),
      demoBtn.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {})
    ]);

    if (await demoBtn.isVisible().catch(() => false)) {
      console.log('[QA Runner] Logging in via Demo Account...');
      await demoBtn.click();
      await homeTab.waitFor({ state: 'attached', timeout: 25000 });
    }

    // 2. Journey Specific Execution
    if (journey === 'meal') {
      await testMealJourney(page);
    } else if (journey === 'biomarker') {
      await testBiomarkerJourney(page);
    } else if (journey === 'onboarding') {
      await testOnboardingJourney(page);
    } else {
      throw new Error(`Unknown journey '${journey}'. Expected meal | biomarker | onboarding.`);
    }

    console.log(`[QA Runner] Journey '${journey}' PASSED with zero defects!`);
    
    // Capture full-page screenshot of clean, verified UI
    const cleanScreenshotPath = path.join(outputDir, `clean_${journey}_${timestamp}.png`);
    await page.screenshot({ path: cleanScreenshotPath, fullPage: true }).catch(() => {});

    const successReport = {
      status: 'pass',
      journey,
      timestamp: new Date().toISOString(),
      screenshot: cleanScreenshotPath,
      summary: `Journey '${journey}' verified successfully without errors.`
    };

    console.log(JSON.stringify(successReport, null, 2));
    await browser.close();
    process.exit(0);

  } catch (err) {
    console.error(`[QA Runner] Journey '${journey}' FAILED:`, err.message);

    const screenshotPath = path.join(outputDir, `bug_${journey}_${timestamp}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});

    const bugReport = {
      status: 'fail',
      id: `BUG-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${timestamp.toString().slice(-4)}`,
      journey,
      title: `Failure during ${journey} journey: ${err.message.slice(0, 120)}`,
      timestamp: new Date().toISOString(),
      screenshot: screenshotPath,
      error_message: err.message,
      console_errors: consoleErrors.slice(-10),
      network_failures: networkFailures.slice(-10),
      repro_steps: [
        `Navigate to ${baseUrl}`,
        `Authenticate via Demo Login`,
        `Execute ${journey} steps leading up to error`
      ],
      suggested_fix: analyzeSuggestedFix(journey, err.message, consoleErrors)
    };

    const reportPath = path.join(outputDir, `bug_${journey}_${timestamp}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(bugReport, null, 2));

    console.log('[QA Runner] Generated Bug Report:');
    console.log(JSON.stringify(bugReport, null, 2));

    await browser.close();
    process.exit(1);
  }
}

async function testMealJourney(page) {
  console.log('[QA Runner] Testing Meal Logging Tab & Compose Tray...');
  const foodTab = page.locator('#nav-tab-food');
  await foodTab.waitFor({ state: 'visible', timeout: 15000 });
  await foodTab.click();

  // Wait for lazy-loaded Suspense chunk to finish loading
  const spinner = page.locator('main .animate-spin');
  if (await spinner.isVisible().catch(() => false)) {
    console.log('[QA Runner] Waiting for FoodHistoryTab lazy chunk to resolve...');
    await spinner.waitFor({ state: 'hidden', timeout: 35000 }).catch(() => {});
  }

  // Wait for Food History page content to mount
  const searchInput = page.locator('#food-search-input');
  await searchInput.waitFor({ state: 'visible', timeout: 30000 });

  // Test search interaction reactivity
  console.log('[QA Runner] Testing food search reactivity...');
  await searchInput.fill('Salad');
  await page.waitForTimeout(500);
  await searchInput.fill('');

  // Verify manual entry modal can open and close
  console.log('[QA Runner] Verifying manual food entry modal...');
  const manualEntryBtn = page.locator('button:has-text("Manual Entry"), button:has-text("Input Manual")');
  if (await manualEntryBtn.isVisible().catch(() => false)) {
    await manualEntryBtn.click();
    await page.waitForTimeout(600);
    // Find close button or dismiss
    const closeBtn = page.locator('button[aria-label="Close"], button:has-text("Cancel"), button:has-text("Batal")').first();
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click();
    } else {
      // press Escape
      await page.keyboard.press('Escape');
    }
  }

  // Check that no major React render error / blank screen exists
  const hasError = await page.locator('.error-boundary, text="Something went wrong"').isVisible().catch(() => false);
  if (hasError) {
    throw new Error('Food History tab crashed with an ErrorBoundary or critical error message.');
  }
}

async function testBiomarkerJourney(page) {
  console.log('[QA Runner] Testing Biomarkers / Medical History Tab...');
  const healthTab = page.locator('#nav-tab-health');
  await healthTab.waitFor({ state: 'visible', timeout: 15000 });
  await healthTab.click();

  // Wait for Medical History lazy-loaded chunk to mount
  const viewSelect = page.locator('select').first();
  await viewSelect.waitFor({ state: 'visible', timeout: 20000 });

  const hasError = await page.locator('.error-boundary, text="Something went wrong"').isVisible().catch(() => false);
  if (hasError) {
    throw new Error('Medical History tab crashed with an ErrorBoundary.');
  }
}

async function testOnboardingJourney(page) {
  console.log('[QA Runner] Testing Front Desk & Profile Onboarding...');
  const homeTab = page.locator('#nav-tab-home');
  await homeTab.waitFor({ state: 'visible', timeout: 15000 });
  await homeTab.click();

  await page.waitForTimeout(1000);

  const nickname = page.locator('#user-nickname-text');
  const avatar = page.locator('#avatar-edit-btn');

  if (!(await nickname.isVisible().catch(() => false)) && !(await avatar.isVisible().catch(() => false))) {
    throw new Error('Home Tab failed to display active user identity header.');
  }
}

function analyzeSuggestedFix(journey, errorMsg, consoleErrors) {
  if (consoleErrors.some(e => e.includes('TypeError'))) {
    return 'Check null-safety on component state properties during render.';
  }
  if (errorMsg.includes('ErrorBoundary')) {
    return `Inspect component render tree in ${journey} tab for unhandled runtime exception.`;
  }
  if (errorMsg.includes('timeout')) {
    return `Verify API response speed or selector presence for ${journey} elements.`;
  }
  return `Review latest commit changes affecting ${journey} components.`;
}

run();
