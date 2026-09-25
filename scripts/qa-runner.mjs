#!/usr/bin/env node
/**
 * scripts/qa-runner.mjs
 * 
 * Autonomous QA Journey Runner for Health-tracker.
 * Executes specific end-to-end user journeys (meal, biomarker, onboarding)
 * using headless Chromium, automatically capturing screenshots and structured
 * bug diagnostic reports on failure.
 *
 * V-30.3 ticket mode: reads a card's packet, runs its repro command/criteria,
 * uploads the §4.6 evidence bundle to R2 (repro.txt, run.log, before.png,
 * expected.md, result.json — keys only, never host paths), and writes the
 * verdict through `bugctl repro`. Exit 0 from the command = defect reproduced
 * (confirmed); non-zero = not reproducible (failed). It never fixes, dispatches,
 * or posts verify.
 * 
 * Usage:
 *   node scripts/qa-runner.mjs --journey=meal [--url=http://localhost:3000] [--save-bug]
 *   node scripts/qa-runner.mjs --ticket=<#n> [--command="<shell>"] [--url=...] [--by=qa_meal]
 */

import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const BUGCTL = path.join(REPO_ROOT, 'scripts', 'bugctl.mjs');

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
const baseUrl = getArg('url', process.env.PLAYWRIGHT_TEST_BASE_URL || 'https://health-tracking.duckdns.org');
const outputDir = getArg('output-dir', path.join(process.cwd(), 'qa-evidence'));
const ticket = getArg('ticket', null);
const reproCommand = getArg('command', null);
const byActor = getArg('by', 'qa_meal');

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
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

    const demoBtn = page.locator('#demo-login-btn');
    const homeTab = page.locator('#nav-tab-home');

    // Wait for the app to hydrate or show login screen
    let authResolved = false;
    for (let attempt = 0; attempt < 25; attempt++) {
      if (await homeTab.isVisible().catch(() => false)) {
        authResolved = true;
        break;
      }
      if (await demoBtn.isVisible().catch(() => false)) {
        console.log('[QA Runner] Logging in via Demo Account...');
        await demoBtn.click();
        await homeTab.waitFor({ state: 'attached', timeout: 25000 }).catch(() => {});
        authResolved = true;
        break;
      }
      await page.waitForTimeout(1000);
    }

    if (!authResolved) {
      console.log('[QA Runner] Waiting additional 10s for initial hydration...');
      await Promise.race([
        homeTab.waitFor({ state: 'attached', timeout: 10000 }).catch(() => {}),
        demoBtn.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {})
      ]);
      if (await demoBtn.isVisible().catch(() => false)) {
        console.log('[QA Runner] Logging in via Demo Account after delay...');
        await demoBtn.click();
        await homeTab.waitFor({ state: 'attached', timeout: 25000 }).catch(() => {});
      }
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

// ---------------------------------------------------------------------------
// V-30.3 ticket mode — reproduce a card, upload the §4.6 bundle, post verdict
// ---------------------------------------------------------------------------

/** Load KEY=VALUE lines from a dotenv file into process.env without overriding. */
function loadEnvFile(file) {
  try {
    if (!fs.existsSync(file)) return;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      const key = m[1];
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      if (process.env[key] === undefined && val) process.env[key] = val;
    }
  } catch { /* env file unreadable — caller decides */ }
}

/** Upload one artifact to R2 under bugs/<tag_id>/<ts>-<kind>.<ext>; returns the key or null. */
async function uploadR2Key(key, body, contentType) {
  if (process.env.CLOUDFLARE_R2_ACCESS_KEY_ID === undefined) {
    loadEnvFile(path.join(REPO_ROOT, '.env'));
    loadEnvFile(path.join(os.homedir(), '.hermes', '.env'));
  }
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
  if (!account || !accessKeyId || !secretAccessKey) return null;
  try {
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${account}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
    await s3.send(new PutObjectCommand({
      Bucket: process.env.CLOUDFLARE_R2_BUCKET_NAME || 'health-tracker-photos',
      Key: key,
      Body: body,
      ContentType: contentType,
    }));
    return key;
  } catch (e) {
    console.warn(`[QA Runner] R2 upload failed for ${key}: ${e.message}`);
    return null;
  }
}

const R2_CONTENT_TYPES = {
  'repro.txt': 'text/plain; charset=utf-8',
  'run.log': 'text/plain; charset=utf-8',
  'expected.md': 'text/markdown; charset=utf-8',
  'result.json': 'application/json',
  'before.png': 'image/png',
};

/** Best-effort evidence screenshot: load the app (demo login if offered), full-page shot. */
async function captureBefore(filePath) {
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    });
    const page = await context.newPage();
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const demoBtn = page.locator('#demo-login-btn');
    const homeTab = page.locator('#nav-tab-home');
    for (let i = 0; i < 20; i++) {
      if (await homeTab.isVisible().catch(() => false)) break;
      if (await demoBtn.isVisible().catch(() => false)) {
        await demoBtn.click().catch(() => {});
        await homeTab.waitFor({ state: 'attached', timeout: 25000 }).catch(() => {});
        break;
      }
      await page.waitForTimeout(1000);
    }
    await page.waitForTimeout(1500);
    await page.screenshot({ path: filePath, fullPage: true });
    return true;
  } catch (e) {
    console.warn(`[QA Runner] before.png capture failed: ${e.message}`);
    return false;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

/** Resolve a card id (#n or tag id) to its packet JSON via bugctl. No chat, no memory — disk/API only. */
function loadPacket(idRaw) {
  const res = spawnSync(process.execPath, [BUGCTL, 'packet', '--id', idRaw, '--json'], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    timeout: 60000,
  });
  try {
    const parsed = JSON.parse(res.stdout || '');
    if (parsed && !parsed.error) return parsed;
    return { error: parsed?.error || `packet lookup failed (exit ${res.status})` };
  } catch {
    return { error: `packet lookup failed: ${(res.stderr || res.stdout || '').slice(0, 300)}` };
  }
}

async function runTicket() {
  const idRaw = String(ticket).replace(/^#/, '');
  console.log(`[QA Runner] ticket mode: #${idRaw} against ${baseUrl}`);

  const packet = loadPacket(idRaw);
  if (packet.error || !packet.defect) {
    console.error(`[QA Runner] cannot load packet for #${idRaw}: ${packet.error || 'packet has no defect — pack it first'}`);
    process.exit(2);
  }
  const tagId = String(packet.tag_id || idRaw);
  const publicN = packet.public_n || idRaw;

  const command = String(reproCommand || (packet.repro && packet.repro.command) || '').trim();
  if (!command) {
    console.error(`[QA Runner] card #${publicN} carries no repro command — pass --command="<shell>". Criteria: ${packet.defect.criteria}`);
    process.exit(2);
  }

  const ts = Date.now();
  const evDir = path.join(outputDir, 'repro', tagId);
  fs.mkdirSync(evDir, { recursive: true });
  const file = (name) => path.join(evDir, `${ts}-${name}`);

  // repro.txt — exact command + env + params (§4.6)
  fs.writeFileSync(file('repro.txt'), [
    `card: #${publicN} (${tagId})`,
    `title: ${packet.title || ''}`,
    `command: ${command}`,
    `cwd: ${process.cwd()}`,
    `url: ${baseUrl}`,
    `bug_api_base: ${process.env.BUG_API_BASE || 'http://127.0.0.1:3000'}`,
    `criteria: ${packet.defect.criteria}`,
    `at: ${new Date(ts).toISOString()}`,
    '',
  ].join('\n'));

  // expected.md — the card's expected state + criteria (§4.6)
  fs.writeFileSync(file('expected.md'), [
    '# Expected', '', String(packet.defect.expected || ''), '',
    '## Criteria', '', String(packet.defect.criteria || ''), '',
    '## Observed (report)', '', String(packet.defect.observed || ''), '',
  ].join('\n'));

  // Run the repro command: exit 0 = defect reproduced (confirmed), non-zero = failed.
  console.log(`[QA Runner] running: ${command}`);
  const t0 = Date.now();
  const run = spawnSync('bash', ['-lc', command], {
    encoding: 'utf8',
    timeout: 300000,
    cwd: process.cwd(),
    env: process.env,
  });
  const exitCode = run.status === null || run.status === undefined ? 124 : run.status;
  const runLogText = [
    `$ ${command}`,
    `exit_code: ${exitCode}`,
    `wall_ms: ${Date.now() - t0}`,
    `verdict_rule: exit 0 = reproduced (confirmed), non-zero = not reproducible (failed)`,
    '--- stdout + stderr ---',
    (run.stdout || '') + (run.stderr || ''),
    '',
  ].join('\n');
  fs.writeFileSync(file('run.log'), runLogText);

  const shotOk = await captureBefore(file('before.png'));
  const verdict = exitCode === 0 ? 'confirmed' : 'failed';
  console.log(`[QA Runner] verdict: ${verdict} (exit ${exitCode}, before.png ${shotOk ? 'captured' : 'MISSING'})`);

  // Upload the bundle — keys only, host paths are never evidence (§4.6).
  const prefix = `bugs/${tagId}/${ts}`;
  const kinds = ['repro.txt', 'run.log', 'expected.md', ...(shotOk ? ['before.png'] : [])];
  const keys = {};
  for (const kind of kinds) {
    const key = await uploadR2Key(`${prefix}-${kind}`, fs.readFileSync(file(kind)), R2_CONTENT_TYPES[kind]);
    if (key) keys[kind] = key;
  }
  const runLogKey = keys['run.log'];
  if (!runLogKey) {
    console.error(`[QA Runner] R2 upload unavailable (missing CLOUDFLARE_R2_* env) — verdict NOT posted: a host path is not evidence. Local bundle: ${evDir}`);
    process.exit(3);
  }

  const result = {
    card: `#${publicN}`,
    tag_id: tagId,
    title: packet.title || null,
    verdict,
    exit_code: exitCode,
    command,
    criteria: packet.defect.criteria,
    r2_prefix: prefix,
    artifacts: keys,
    screenshot: Boolean(shotOk),
    by: byActor,
    at: new Date().toISOString(),
  };
  fs.writeFileSync(file('result.json'), JSON.stringify(result, null, 2));
  const resultKey = await uploadR2Key(`${prefix}-result.json`, fs.readFileSync(file('result.json')), R2_CONTENT_TYPES['result.json']);
  if (resultKey) keys['result.json'] = resultKey;

  // Write the verdict through bugctl (which re-runs repro --check before POST).
  const postArgs = [
    BUGCTL, 'repro', '--id', idRaw,
    '--status', verdict,
    '--command', command,
    '--exit-code', String(exitCode),
    '--run-log', runLogKey,
    '--by', byActor,
    '--json',
  ];
  if (keys['before.png']) postArgs.push('--before', keys['before.png']);
  const post = spawnSync(process.execPath, postArgs, { encoding: 'utf8', cwd: REPO_ROOT, timeout: 60000 });
  process.stdout.write(post.stdout || '');
  if (post.stderr) process.stderr.write(post.stderr);
  if (post.status !== 0) {
    console.error(`[QA Runner] bugctl repro failed (exit ${post.status}) — verdict not persisted`);
    process.exit(post.status || 1);
  }

  // One reply line for the ticket room, then STOP (no fix, no dispatch, no verify).
  const line = verdict === 'confirmed'
    ? `reproduced #${publicN} — exit 0; run.log ${runLogKey}; before.png ${keys['before.png'] || 'n/a'}; result.json ${keys['result.json'] || `${prefix}-result.json (local)`}`
    : `not reproducible #${publicN} — exit ${exitCode}; run.log ${runLogKey}; result.json ${keys['result.json'] || `${prefix}-result.json (local)`}`;
  console.log(`[QA Runner] ${line}`);
  process.exit(0);
}

if (ticket) {
  runTicket().catch((e) => {
    console.error('[QA Runner] ticket run failed:', e.message);
    process.exit(1);
  });
} else {
  run();
}
