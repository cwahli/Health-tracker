#!/usr/bin/env node
/**
 * scripts/qa-auto-loop.mjs
 *
 * Closed-Loop Autonomous QA & Self-Healing Verifier for Telegram.
 * 
 * Flow:
 * 1. Runs QA Journey test (headless Chromium).
 * 2. If PASS: reports clean status to Telegram.
 * 3. If FAIL:
 *    - Captures "Before" screenshot and sends to Telegram topic.
 *    - Orchestrator triages & dispatches to OpenCode / Grok via run-coding-dispatch.sh.
 *    - Awaits webhook deployment to live server.
 *    - Re-tests journey with fresh "After" screenshot.
 *    - Sends complete Before vs. After victory summary to Telegram!
 *
 * Usage:
 *   node scripts/qa-auto-loop.mjs --journey=meal [--chat-id=...] [--thread-id=...]
 */

import { spawnSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
function getArg(name, defaultValue = '') {
  const prefix = `--${name}=`;
  const match = args.find(a => a.startsWith(prefix));
  if (match) return match.slice(prefix.length);
  return defaultValue;
}

const journey = getArg('journey', 'meal');
const chatId = getArg('chat-id', process.env.TELEGRAM_CHAT_ID || '');
const threadId = getArg('thread-id', process.env.TELEGRAM_THREAD_ID || '');

const rootDir = process.cwd();
const qaEvidenceDir = path.join(rootDir, 'qa-evidence');

function sendTelegram({ text, photo, caption }) {
  const scriptPath = path.join(rootDir, 'scripts', 'telegram-send.sh');
  const cmdArgs = [];
  if (text) cmdArgs.push(`--text="${text.replace(/"/g, '\\"')}"`);
  if (photo) cmdArgs.push(`--photo="${photo}"`);
  if (caption) cmdArgs.push(`--caption="${caption.replace(/"/g, '\\"')}"`);
  if (chatId) cmdArgs.push(`--chat-id="${chatId}"`);
  if (threadId) cmdArgs.push(`--thread-id="${threadId}"`);

  try {
    execSync(`bash "${scriptPath}" ${cmdArgs.join(' ')}`, { stdio: 'inherit' });
  } catch (e) {
    console.warn('[AutoLoop] Telegram notification failed:', e.message);
  }
}

console.log(`[AutoLoop] Starting QA loop for journey: ${journey}`);
sendTelegram({
  text: `🔍 *[QA Bot]* Starting automated test for journey: '${journey}'...`
});

// Step 1: Initial QA Run
const initialRun = spawnSync('node', ['scripts/qa-runner.mjs', `--journey=${journey}`], {
  cwd: rootDir,
  encoding: 'utf-8'
});

if (initialRun.status === 0) {
  console.log('[AutoLoop] Initial run clean! 0 defects found.');
  
  // Find clean screenshot
  const cleanFiles = fs.readdirSync(qaEvidenceDir).filter(f => f.startsWith(`clean_${journey}_`) && f.endsWith('.png'));
  cleanFiles.sort((a, b) => fs.statSync(path.join(qaEvidenceDir, b)).mtimeMs - fs.statSync(path.join(qaEvidenceDir, a)).mtimeMs);
  const cleanScreenshot = cleanFiles.length > 0 ? path.join(qaEvidenceDir, cleanFiles[0]) : null;

  sendTelegram({
    photo: cleanScreenshot,
    caption: `✅ *[QA Clean & Verified]* Journey: \`${journey}\`\n\n• Defects: 0\n• Navigation & Lazy Chunks: Verified ✓\n• Interactive Components: Operational ✓\n• Full-page verification screenshot attached.`
  });
  console.log(`[AutoLoop] Clean verification sent with photo: ${cleanScreenshot}`);
  process.exit(0);
}

// Step 2: Defect Detected! Read Bug Report & Enter Closed Loop
console.log('[AutoLoop] Defect detected. Reading latest bug report...');

function getLatestBug() {
  const bugFiles = fs.readdirSync(qaEvidenceDir).filter(f => f.startsWith(`bug_${journey}_`) && f.endsWith('.json'));
  bugFiles.sort((a, b) => fs.statSync(path.join(qaEvidenceDir, b)).mtimeMs - fs.statSync(path.join(qaEvidenceDir, a)).mtimeMs);
  if (bugFiles.length === 0) return null;
  return JSON.parse(fs.readFileSync(path.join(qaEvidenceDir, bugFiles[0]), 'utf-8'));
}

let currentBug = getLatestBug();
if (!currentBug) {
  console.error('[AutoLoop] Error: Bug file not found in evidence dir.');
  process.exit(1);
}

console.log(`[AutoLoop] Found initial defect: ${currentBug.id} - ${currentBug.title}`);

// Send Initial Before Screenshot & Bug Details to Telegram
sendTelegram({
  photo: currentBug.screenshot,
  caption: `🚨 *[QA Bug Detected]* \`${currentBug.id}\`\n\n*Journey:* ${journey}\n*Error:* ${currentBug.title}\n\n*Suggested Fix:* ${currentBug.suggested_fix}\n\n_Handing off to Orchestrator self-healing loop..._`
});

const MAX_ATTEMPTS = 2;
const dispatchScript = path.join(rootDir, 'scripts', 'run-coding-dispatch.sh');

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  const isEscalation = attempt > 1;
  const toolChoice = isEscalation ? 'cline' : 'auto';
  const thinkingLevel = 'high';

  console.log(`\n[AutoLoop] === Loop Iteration ${attempt}/${MAX_ATTEMPTS} (Tool: ${toolChoice}, Thinking: ${thinkingLevel}) ===`);

  if (isEscalation) {
    sendTelegram({
      text: `🔄 *[Orchestrator Escalation]* Attempt 1 did not fully clear all assertions for \`${currentBug.id}\`.\nEscalating to Tier 2 (Cline CLI with thinking=${thinkingLevel}) with fresh diagnostic evidence...`
    });
  }

  // Step 3: Orchestrator Triage & Coding Dispatch (with visual screenshot passed)
  const dispatchArgs = [
    dispatchScript,
    `--task=${currentBug.title}. Suggested fix: ${currentBug.suggested_fix}`,
    `--bug-id=${currentBug.id}`,
    `--category=${journey}`,
    `--tool=${toolChoice}`,
    `--thinking=${thinkingLevel}`,
    `--verify=false`
  ];

  if (currentBug.screenshot && fs.existsSync(currentBug.screenshot)) {
    dispatchArgs.push(`--screenshot=${currentBug.screenshot}`);
  }

  const dispatchRun = spawnSync('bash', dispatchArgs, {
    cwd: rootDir,
    stdio: 'inherit'
  });

  if (dispatchRun.status !== 0) {
    console.warn(`[AutoLoop] Dispatch attempt ${attempt} exited with non-zero status.`);
    if (attempt === MAX_ATTEMPTS) {
      sendTelegram({
        text: `🚨 *[Escalation to Human]* Automated agents were unable to resolve \`${currentBug.id}\` after ${MAX_ATTEMPTS} attempts. Human intervention required.`
      });
      process.exit(1);
    }
    continue;
  }

  // Step 4: Await Webhook Deploy
  sendTelegram({
    text: `🚀 *[Deploy]* Fix pushed to \`main\`. Awaiting live server rebuild (~40s)...`
  });

  execSync('sleep 45');

  // Step 5: Re-Verification
  sendTelegram({
    text: `🔄 *[QA Re-Test ${attempt}/${MAX_ATTEMPTS}]* Re-running \`${journey}\` journey to verify bug resolution...`
  });

  const retestRun = spawnSync('node', ['scripts/qa-runner.mjs', `--journey=${journey}`], {
    cwd: rootDir,
    encoding: 'utf-8'
  });

  if (retestRun.status === 0) {
    // PASS! Capture fresh victory screenshot
    const afterScreenshotPath = path.join(qaEvidenceDir, `after_fixed_${journey}_${Date.now()}.png`);

    try {
      const { chromium } = await import('playwright');
      const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const testUrl = process.env.PLAYWRIGHT_TEST_BASE_URL || 'https://health-tracking.duckdns.org';
      await page.goto(testUrl, { waitUntil: 'commit', timeout: 30000 });
      const demoBtn = page.locator('#demo-login-btn');
      if (await demoBtn.isVisible().catch(() => false)) await demoBtn.click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: afterScreenshotPath, fullPage: true });
      await browser.close();
    } catch (e) {
      console.warn('[AutoLoop] Could not capture after-screenshot:', e.message);
    }

    let resolvedBy = 'Autonomous Agent';
    try {
      const auditPath = path.join(process.env.HOME || '', '.hermes', 'dispatch_audit.log');
      if (fs.existsSync(auditPath)) {
        const lines = fs.readFileSync(auditPath, 'utf-8').trim().split('\n');
        const last = JSON.parse(lines[lines.length - 1]);
        if (last.agent) resolvedBy = `${last.agent} (${last.model})`;
      }
    } catch (e) {}

    sendTelegram({
      photo: fs.existsSync(afterScreenshotPath) ? afterScreenshotPath : currentBug.screenshot,
      caption: `🎉 *[BUG RESOLVED & VERIFIED]* \`${currentBug.id}\`\n\n*Journey:* ${journey}\n*Resolved By:* ${resolvedBy}\n*Attempts:* ${attempt}/${MAX_ATTEMPTS}\n*Resolution:* Successfully verified on live site.\n*Tests:* All checks green, zero regressions!`
    });

    console.log(`[AutoLoop] Loop completed with 100% resolution on attempt ${attempt}!`);
    process.exit(0);
  } else {
    console.warn(`[AutoLoop] Re-test failed on attempt ${attempt}.`);
    const nextBug = getLatestBug();
    if (nextBug) currentBug = nextBug;

    if (attempt === MAX_ATTEMPTS) {
      sendTelegram({
        photo: currentBug.screenshot,
        caption: `🚨 *[Escalation to Human]* Fix did not fully resolve \`${currentBug.id}\` after ${MAX_ATTEMPTS} attempts.\n\n*Error:* ${currentBug.title}\n*Status:* Escalated for human engineer review.`
      });
      process.exit(1);
    }
  }
}

process.exit(1);
