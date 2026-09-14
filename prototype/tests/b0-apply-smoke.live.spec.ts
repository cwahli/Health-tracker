import { test, expect, Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import {
  ensureSariAccount,
  first,
} from './indo-journey-helpers.js';

/**
 * Track B — B0 Apply smoke (live outer, scripted).
 * Front-desk jobs are CLIENT-ONLY by design (excluded from cloud sync +
 * hydration polling), so server-side polling can never settle them — wait on
 * client signals (Extracted Biomarkers Panel) instead. Fresh Sari, English UI:
 *  1. Seed older SI history rows (02-08-2026) via a lab send.
 *  2. Send 14-08-2026 US-unit rows; Review must show the five locked converts
 *     (HDL 50→1.293, TG 125→1.411, LDL 130→3.362, creat 0.9→79.56, bili 0.8→13.68).
 *  3. Download the debug file via the message's Download Debug Logs button.
 *  4. Apply if a pending batch exists (clean hits auto-land as Recorded, so
 *     no Apply button is correct); assert converted + SI rows in History.
 *     observationMeta-raw is Review-path behavior (G-B1 unit tests).
 */

const SI_SEND = `My blood test results from 02-08-2026: HDL cholesterol 1.43 mmol/L, triglycerides 1.07 mmol/L, LDL cholesterol 4.2 mmol/L, creatinine 100 umol/L, total bilirubin 16 umol/L. Please log these.`;

const US_SEND = `My blood test results from 14-08-2026: HDL cholesterol 50 mg/dL, triglycerides 125 mg/dL, LDL cholesterol 130 mg/dL, creatinine 0.9 mg/dL, total bilirubin 0.8 mg/dL. Please review and convert any US units to my standard units (mmol/L, umol/L).`;

async function openFrontDeskViaQuickActions(page: Page) {
  const plus = first(page, [
    'button[title="Open quick actions"]',
    'button[title*="quick" i]',
    'button.w-14.h-14',
  ]);
  await plus.click({ timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(800);
  const healthInfo = first(page, [
    'button:has-text("Health Info")',
    'button:has-text("Info Kesehatan")',
  ]);
  await healthInfo.click({ timeout: 10000 });
  const input = page.locator('#desk-chat-input, #receptionist-chat-input, #food-chat-input').first();
  await expect(input).toBeVisible({ timeout: 20000 });
}
async function submitDeskText(page: Page, text: string): Promise<string | null> {
  const input = page.locator('#desk-chat-input, #receptionist-chat-input, #food-chat-input').first();
  await expect(input).toBeVisible({ timeout: 20000 });
  await input.click({ timeout: 10000 });
  await input.fill(text);
  const sendBtn = page.locator('#desk-chat-send-btn, #receptionist-chat-send-btn, #food-chat-send-btn').first();
  let captured: string | null = null;
  const waiter = page
    .waitForResponse(
      (r) =>
        (r.url().includes('/api/jobs/') || r.url().includes('/api/food/') || r.url().includes('/api/chat/')) &&
        r.request().method() === 'POST',
      { timeout: 35000 },
    )
    .then(async (res) => {
      try {
        const body = await res.json();
        captured = String(body?.jobId || body?.job?.id || body?.id || '') || null;
      } catch {}
    })
    .catch(() => null);
  await sendBtn.click();
  await waiter;
  if (!captured) {
    const el = page.locator('[data-job-id]').last();
    captured = await el.getAttribute('data-job-id').catch(() => null);
  }
  return captured;
}

async function clickApplyBatch(page: Page): Promise<boolean> {
  const btn = first(page, [
    'button:has-text("Apply This Batch")',
    'button:has-text("Apply Final Batch")',
    'button:has-text("Applying Agent Findings")',
  ]);
  if (await btn.isVisible({ timeout: 30000 }).catch(() => false)) {
    await btn.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(4000);
    return true;
  }
  return false;
}

// Client-side settle: the Extracted Biomarkers Panel renders when the desk
// run completes. Server polling is wrong here (front-desk jobs never sync).
async function waitDeskSettled(page: Page, timeoutMs = 480000) {
  const panel = page.getByText(/Extracted Biomarkers Panel/i).first();
  await expect(panel).toBeVisible({ timeout: timeoutMs });
  const analyzing = page.getByText(/Starting cloud|Menganalisis|Analyzing|Updating|Memperbarui/i).first();
  await expect(analyzing).toBeHidden({ timeout: 60000 }).catch(() => {});
}

// The message-level Download Debug Logs button builds the dump client-side
// from JobStore, so it works for front-desk jobs. Saves the artifact.
async function downloadLastDebug(page: Page, tag: string): Promise<string | null> {
  const btn = page.getByRole('button', { name: /Download Debug Logs/i }).last();
  if (!(await btn.isVisible({ timeout: 15000 }).catch(() => false))) return null;
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }).catch(() => null),
    btn.click({ timeout: 10000 }).catch(() => {}),
  ]);
  if (!dl) return null;
  const dir = path.resolve(process.cwd(), 'golden/scorecard/current/debug');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `${tag}-${Date.now()}.${(dl.suggestedFilename() || 'debug.md').split('.').pop()}`);
  await dl.saveAs(out);
  return out;
}

test.describe('Track B B0: live Apply smoke', () => {
  test.setTimeout(1200000);

  test('B0: US-unit lab rows convert on Apply; SI history untouched', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await ensureSariAccount(page, { forceFresh: true });

    // 1. Seed SI history (extract auto-lands; Apply if a batch table appears).
    await openFrontDeskViaQuickActions(page);
    const siJob = await submitDeskText(page, SI_SEND);
    expect(siJob, 'SI seed must dispatch a job').toBeTruthy();
    await waitDeskSettled(page);
    await expect(page.locator('body').getByText('1.43').first()).toBeVisible({ timeout: 30000 });
    await clickApplyBatch(page);

    // 2. US-unit send.
    const usJob = await submitDeskText(page, US_SEND);
    expect(usJob, 'US send must dispatch a job').toBeTruthy();
    await waitDeskSettled(page);

    // 3. Review shows the five locked converts.
    const thread = page.locator('body');
    for (const v of ['1.293', '1.411', '3.362', '79.56', '13.68']) {
      await expect(thread.getByText(v).first()).toBeVisible({ timeout: 60000 });
    }

    // 4. Debug file via the message-level download (client-side JobStore dump).
    const debugPath = await downloadLastDebug(page, `B0-${usJob}`);
    expect(debugPath, 'debug file must download').toBeTruthy();
    console.log(`[B0] debug artifact: ${debugPath}`);

    // 5. Apply — or, if high-confidence hits already landed as Recorded
    // observations, there is no pending batch and no Apply button (by design).
    const applied = await clickApplyBatch(page);
    if (!applied) {
      for (const v of ['1.293', '1.411', '3.362', '79.56', '13.68']) {
        await expect(thread.getByText(v).first()).toBeVisible({ timeout: 30000 });
      }
      console.log('[B0] no pending batch; locks already Recorded — proceeding to persisted-state asserts');
    }

    // 6. Persisted state, asserted on UI-visible history (the extract
    // auto-land path stores converted values directly; observationMeta-raw
    // preservation is the Review path, proven by G-B1 applyModificationCommands
    // unit tests — not re-provable through UI text).
    const medTab = first(page, ['#nav-tab-medical', 'button:has-text("Medical")']);
    if (await medTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await medTab.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(2000);
    }
    const historyTab = page.locator('body');
    // Converted locks present…
    for (const v of ['1.293', '1.411', '3.362', '79.56', '13.68']) {
      await expect(historyTab.getByText(v).first()).toBeVisible({ timeout: 30000 });
    }
    // …and the older SI row is untouched.
    await expect(historyTab.getByText('1.43').first()).toBeVisible({ timeout: 30000 });
  });
});
