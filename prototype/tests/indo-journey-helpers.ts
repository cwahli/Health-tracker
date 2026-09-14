import fs from 'node:fs';
import path from 'node:path';
import { expect, type Page, type Locator } from '@playwright/test';
import { classifyDump, formatOracleFails } from '../../src/utils/dumpContract.js';

export const CREDS_FILE = path.resolve('/tmp/sari-e2e-creds.json');
export const LIVE_DEBUG_DIR = path.resolve(process.cwd(), 'golden/journeys/_live_debug');

export const SARI_PERSONA = {
  name: 'Sari Hartono',
  nickname: 'Sari',
  gender: 'Female',
  age: '18',
  height: '140',
  weight: '40',
  targetCalories: 1350,
  lang: 'id',
};

export const first = (page: Page, selectors: string[]): Locator =>
  selectors.map((sel) => page.locator(sel)).reduce((loc, next) => loc.or(next)).first();

export async function fieldAfterLabel(modal: Locator, labelRe: RegExp): Promise<Locator> {
  const label = modal.locator('label').filter({ hasText: labelRe }).first();
  await expect(label, `label matching ${labelRe}`).toBeVisible({ timeout: 15000 });
  return label.locator('xpath=following-sibling::*[1]');
}

export function saveSharedCreds(email: string, pass: string) {
  try {
    fs.writeFileSync(CREDS_FILE, JSON.stringify({ email, pass, time: Date.now() }), 'utf-8');
    console.log(`[indo-helpers] Saved shared creds to ${CREDS_FILE}: ${email}`);
  } catch (err) {
    console.warn('[indo-helpers] Failed to write shared creds:', err);
  }
}

export function loadSharedCreds(): { email: string; pass: string } | null {
  try {
    if (fs.existsSync(CREDS_FILE)) {
      const data = JSON.parse(fs.readFileSync(CREDS_FILE, 'utf-8'));
      if (data && data.email && data.pass) {
        return { email: data.email, pass: data.pass };
      }
    }
  } catch (err) {
    console.warn('[indo-helpers] Failed to read shared creds:', err);
  }
  return null;
}

export async function switchAuthLanguageToIndonesian(page: Page): Promise<boolean> {
  // 1. Check clickable button or link containing "Bahasa Indonesia"
  const indoClickable = first(page, [
    'button:has-text("Bahasa Indonesia")',
    'button:has-text("Indonesia")',
    '[role="button"]:has-text("Bahasa Indonesia")',
    'span:has-text("Bahasa Indonesia")',
    'a:has-text("Bahasa Indonesia")',
    'div:has-text("Bahasa Indonesia")',
  ]);
  if (await indoClickable.isVisible({ timeout: 2000 }).catch(() => false)) {
    await indoClickable.click({ timeout: 2000 }).catch(() => {});
    console.log('[indo-helpers] Clicked Bahasa Indonesia language selector');
    await page.waitForTimeout(500);
    return true;
  }

  // 2. Try select dropdown
  const authLang = page.locator('#auth-card select, select[name="language"], select').first();
  if (await authLang.isVisible({ timeout: 2000 }).catch(() => false)) {
    try {
      await authLang.selectOption('id');
      console.log('[indo-helpers] Selected language code: id');
      return true;
    } catch {
      try {
        await authLang.selectOption({ label: /Bahasa Indonesia|Indonesia/i });
        console.log('[indo-helpers] Selected language label: Bahasa Indonesia');
        return true;
      } catch (e) {
        console.warn('[indo-helpers] Select dropdown language switch failed:', e);
      }
    }
  }
  return false;
}

export async function checkAuthI18nKeys(page: Page) {
  const card = page.locator('#auth-card, main, body').first();
  const text = (await card.innerText({ timeout: 10000 }).catch(() => '')) || '';
  const rawKeyPattern = /\b(auth\.[a-z0-9_.]+|error\.[a-z0-9_.]+|Sign In Title|Email Label|Password Label)\b/i;
  const match = text.match(rawKeyPattern);
  return { hasRawKey: !!match, rawKey: match ? match[0] : null, cardText: text };
}

export async function ensureSariAccount(page: Page, opts: { forceFresh?: boolean } = {}) {
  const HOME_SELECTORS = [
    '#nav-tab-home',
    'button:has-text("Beranda")',
    'button:has-text("Home")',
    '[role="tab"]:has-text("Beranda")',
    '#dashboard-nutrition-targets',
  ];

  try {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch {
    await page.goto('/', { waitUntil: 'load', timeout: 60000 });
  }

  await switchAuthLanguageToIndonesian(page);

  const homeTab = first(page, HOME_SELECTORS);
  if (!opts.forceFresh && (await homeTab.isVisible({ timeout: 3000 }).catch(() => false))) {
    console.log('[indo-helpers] Already authenticated into app');
    return { created: false, returning: true, email: 'session@existing' };
  }

  const stored = !opts.forceFresh ? loadSharedCreds() : null;
  const password = 'TestPass123!';

  // Attempt login with stored credentials if available
  if (stored && !opts.forceFresh) {
    const emailInput = page.locator('#auth-email-input');
    const passInput = page.locator('#auth-password-input');
    const submitBtn = page.locator('#auth-submit-btn');

    if (await emailInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log(`[indo-helpers] Attempting login with stored Sari creds: ${stored.email}`);
      await emailInput.fill(stored.email);
      await passInput.fill(stored.pass);
      await submitBtn.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(3000);

      const bypass = page.locator('#auth-bypass-verify-btn, #auth-simulate-verify-btn');
      if (await bypass.isVisible({ timeout: 3000 }).catch(() => false)) {
        await bypass.click({ timeout: 2000 }).catch(() => {});
      }

      if (await homeTab.isVisible({ timeout: 15000 }).catch(() => false)) {
        console.log('[indo-helpers] Returning session restored successfully.');
        return { created: false, returning: true, email: stored.email };
      }
    }
  }

  // Otherwise, create fresh user
  const email = `sari.pw.${Date.now()}.${Math.floor(Math.random() * 1000)}@example.com`;
  console.log(`[indo-helpers] Creating fresh user: ${email}`);

  // Switch to Sign Up mode
  const modeSwitch = page.locator('#auth-mode-switch-btn');
  if (await modeSwitch.isVisible({ timeout: 10000 }).catch(() => false)) {
    await modeSwitch.click({ timeout: 3000 }).catch(() => {});
    console.log('[indo-helpers] Clicked auth mode switch to signup');
  }

  const nickInput = page.locator('#auth-nickname-input');
  if (await nickInput.isVisible({ timeout: 10000 }).catch(() => false)) {
    await nickInput.fill(SARI_PERSONA.nickname);
  }

  const emailInput = page.locator('#auth-email-input');
  const passInput = page.locator('#auth-password-input');
  await emailInput.fill(email);
  await passInput.fill(password);

  const submitWait = page.waitForResponse(
    (r) => r.url().includes('/api/auth/signup') && r.request().method() === 'POST',
    { timeout: 60000 },
  ).catch(() => null);

  await page.locator('#auth-submit-btn').click({ timeout: 5000 }).catch(() => {});
  await submitWait;

  const bypass = page.locator('#auth-bypass-verify-btn, #auth-simulate-verify-btn');
  if (await bypass.isVisible({ timeout: 5000 }).catch(() => false)) {
    await bypass.click({ timeout: 2000 }).catch(() => {});
  }

  await homeTab.waitFor({ state: 'attached', timeout: 45000 });
  saveSharedCreds(email, password);

  return { created: true, returning: false, email };
}

export async function openAndFillSariProfile(page: Page) {
  const profileModal = page.locator('#profile-edit-modal');

  // Try opening profile modal if not visible
  if (!(await profileModal.isVisible().catch(() => false))) {
    const emptyBtn = page.locator('#empty-state-profile-btn');
    const avatarBtn = page.locator('#avatar-edit-btn, button[aria-label*="profile" i], button[aria-label*="profil" i]');

    if (await emptyBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await emptyBtn.click({ timeout: 3000 }).catch(() => {});
    } else if (await avatarBtn.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      await avatarBtn.first().click({ timeout: 3000 }).catch(() => {});
    } else {
      const healthTab = first(page, ['#nav-tab-health', 'button:has-text("Health")', 'button:has-text("Kesehatan")']);
      if (await healthTab.isVisible().catch(() => false)) {
        await healthTab.click({ timeout: 3000 }).catch(() => {});
      }
    }
  }

  await expect(profileModal).toBeVisible({ timeout: 20000 });

  const langSel = profileModal.locator('#lang-selector, select[name="language"]').first();
  if (await langSel.isVisible({ timeout: 3000 }).catch(() => false)) {
    await langSel.selectOption('id').catch(() => {});
  }

  let heightVal = SARI_PERSONA.height;
  let weightVal = SARI_PERSONA.weight;

  try {
    const ageInput = await fieldAfterLabel(profileModal, /^(Age|Usia)$/i);
    await ageInput.fill(SARI_PERSONA.age);
    const weightInput = await fieldAfterLabel(profileModal, /Weight|Berat/i);
    await weightInput.fill(SARI_PERSONA.weight);
    weightVal = await weightInput.inputValue();

    const heightInput = await fieldAfterLabel(profileModal, /Height|Tinggi/i);
    await heightInput.fill(SARI_PERSONA.height);
    heightVal = await heightInput.inputValue();

    const genderSel = await fieldAfterLabel(profileModal, /Gender|Jenis\s*Kelamin|Sex/i);
    await genderSel.selectOption({ label: /Female|Perempuan/i }).catch(async () => {
      await genderSel.selectOption('Female');
    });

    const ethSel = await fieldAfterLabel(profileModal, /Ethnicity|Etnis|Suku/i).catch(() => null);
    if (ethSel && (await ethSel.isVisible().catch(() => false))) {
      await ethSel.selectOption('Southeast Asian').catch(() => {});
    }

    const nickInput = await fieldAfterLabel(profileModal, /Nickname|Nama\s*panggilan|Nama/i).catch(() => null);
    if (nickInput && (await nickInput.isVisible().catch(() => false))) {
      await nickInput.fill(SARI_PERSONA.name);
    }
  } catch (e) {
    console.warn('[indo-helpers] fieldAfterLabel fallback to generic inputs:', e);
    const inputs = profileModal.locator('input[type="number"], input[type="text"]');
    const count = await inputs.count();
    for (let i = 0; i < count; i++) {
      const ph = (await inputs.nth(i).getAttribute('placeholder')) || '';
      if (/age|usia/i.test(ph)) await inputs.nth(i).fill(SARI_PERSONA.age);
      if (/weight|berat/i.test(ph)) {
        await inputs.nth(i).fill(SARI_PERSONA.weight);
        weightVal = await inputs.nth(i).inputValue();
      }
      if (/height|tinggi/i.test(ph)) {
        await inputs.nth(i).fill(SARI_PERSONA.height);
        heightVal = await inputs.nth(i).inputValue();
      }
    }
  }

  const saveBtn = profileModal.locator('#profile-save-btn, button:has-text("Save"), button:has-text("Simpan")').first();
  if (await saveBtn.isVisible().catch(() => false)) {
    await saveBtn.click({ timeout: 3000 }).catch(() => {});
    await expect(profileModal).toBeHidden({ timeout: 15000 }).catch(() => {});
  }

  return { height: heightVal, weight: weightVal };
}

export async function openFoodChat(page: Page) {
  const foodTab = first(page, ['#nav-tab-food', 'button:has-text("Food")', '[role="tab"]:has-text("Food")']);
  if (await foodTab.isVisible().catch(() => false)) {
    await foodTab.click({ timeout: 3000 }).catch(() => {});
  }

  const quickActionBtn = first(page, [
    'button[title="Open quick actions"]',
    'button[title*="quick" i]',
    'button.w-14.h-14',
    '[aria-label*="quick" i]',
    'button:has-text("Open Quick Actions")',
  ]);
  if (await quickActionBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await quickActionBtn.click({ timeout: 3000 }).catch(() => {});
  }

  const logMealBtn = first(page, [
    'button:has-text("Catat Makanan")',
    'button:has-text("Log meal")',
    'button:has-text("Log Meal")',
    'button:has-text("Catat")',
  ]);
  if (await logMealBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await logMealBtn.click({ timeout: 3000 }).catch(() => {});
  }

  const input = page.locator('#food-chat-input');
  await expect(input).toBeVisible({ timeout: 30000 });
  await expect(input).toBeEnabled({ timeout: 15000 });
}

export async function openCompareMode(page: Page) {
  const quickActionBtn = first(page, [
    'button[title="Open quick actions"]',
    'button[title*="quick" i]',
    'button.w-14.h-14',
    '[aria-label*="quick" i]',
    'button:has-text("Open Quick Actions")',
  ]);
  if (await quickActionBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await quickActionBtn.click({ timeout: 3000 }).catch(() => {});
  }

  const compareBtn = first(page, [
    '#quick-action-compare-meal',
    'button:has-text("Compare")',
    'button:has-text("Bandingkan")',
    'button:has-text("Bandingkan Makanan")',
  ]);
  if (await compareBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await compareBtn.click({ timeout: 3000 }).catch(() => {});
  }

  const input = page.locator('#food-chat-input');
  await expect(input).toBeVisible({ timeout: 30000 });
}

export async function openFrontDesk(page: Page): Promise<Locator> {
  // Press Escape to dismiss any lingering quick action backdrop or dialog
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(300);

  const deskTab = first(page, [
    '#nav-tab-desk',
    '#nav-tab-receptionist',
    'button:has-text("Desk")',
    'button:has-text("Front Desk")',
    'button:has-text("Meja Depan")',
    'button:has-text("Resepsionis")',
  ]);

  if (await deskTab.isVisible({ timeout: 2000 }).catch(() => false)) {
    await deskTab.click({ timeout: 3000 }).catch(() => {});
  } else {
    // Check quick actions for receptionist / coach
    const quickActionBtn = first(page, [
      'button[title="Open quick actions"]',
      'button.w-14.h-14',
      '[aria-label*="quick" i]',
    ]);
    if (await quickActionBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await quickActionBtn.click({ timeout: 2000 }).catch(() => {});
      const deskAction = first(page, [
        '#quick-action-receptionist',
        'button:has-text("Front Desk")',
        'button:has-text("Receptionist")',
        'button:has-text("Coach")',
        'button:has-text("Konsultasi")',
      ]);
      if (await deskAction.isVisible({ timeout: 2000 }).catch(() => false)) {
        await deskAction.click({ timeout: 2000 }).catch(() => {});
      }
    }
  }

  const deskInput = first(page, [
    '#receptionist-chat-input',
    '#desk-chat-input',
    '#food-chat-input',
    'textarea[placeholder*="tanya" i]',
    'input[placeholder*="tanya" i]',
    'textarea',
    'input[type="text"]',
  ]);
  return deskInput;
}

export type SubmitResult = {
  jobId: string | null;
};

export async function submitFoodChatMessageWithPhotos(
  page: Page,
  text: string,
  photoPaths: string[] = []
): Promise<SubmitResult> {
  const input = page.locator('#food-chat-input');
  const sendBtn = page.locator('#food-chat-send-btn');
  const fileInput = page.locator('input[type="file"]').first();

  if (photoPaths.length > 0) {
    const existing = photoPaths.filter((p) => fs.existsSync(p));
    if (existing.length > 0) {
      await fileInput.setInputFiles(existing).catch((e) => {
        console.warn('[indo-helpers] Failed to attach files:', e);
      });
      console.log(`[indo-helpers] Attached ${existing.length} photo(s)`);
    }
  }

  if (text) {
    await input.click({ timeout: 10000 });
    await input.fill(text);
  }

  await expect(sendBtn).toBeEnabled({ timeout: 20000 });

  // Listen for job submission network response to capture the real jobId
  let capturedJobId: string | null = null;
  const submitPromise = page
    .waitForResponse(
      (r) =>
        (r.url().includes('/api/jobs/') || r.url().includes('/api/food/') || r.url().includes('/api/chat/')) &&
        r.request().method() === 'POST',
      { timeout: 35000 }
    )
    .then(async (res) => {
      try {
        const body = await res.json();
        const id = body?.jobId || body?.job?.id || body?.id || body?.clean_result?.jobId;
        if (id) {
          capturedJobId = String(id);
          console.log(`[indo-helpers] Captured submitted jobId from response: ${capturedJobId}`);
        }
      } catch {}
    })
    .catch(() => null);

  await sendBtn.click();
  await submitPromise;

  // If response didn't give jobId, inspect DOM for data-job-id attribute
  if (!capturedJobId) {
    const jobElement = page.locator('[data-job-id]').last();
    if (await jobElement.isVisible({ timeout: 8000 }).catch(() => false)) {
      capturedJobId = await jobElement.getAttribute('data-job-id').catch(() => null);
      if (capturedJobId) {
        console.log(`[indo-helpers] Captured jobId from DOM data-job-id: ${capturedJobId}`);
      }
    }
  }

  // 1) Wait past transient starting states ("Starting cloud food analysis", "5%", "Memperbarui", "Menganalisis")
  const analyzing = page.getByText(/Starting cloud|Menganalisis|Analyzing|Updating|Memperbarui/i).first();
  await analyzing.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});

  // 2) Never pass while in progress; wait for analysis indicator to hide (up to 8 minutes)
  await expect(analyzing).toBeHidden({ timeout: 480000 });

  // 3) Handle portion confirmation step or active retry steps if required
  const retryBanner = page.getByText(/Attempt \d of \d|Retrying|Memulai ulang/i).first();
  if (await retryBanner.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log('[indo-helpers] Retry banner detected, waiting for completion...');
    await expect(retryBanner).toBeHidden({ timeout: 240000 }).catch(() => {});
  }

  const optionChip = first(page, [
    '[data-testid*="clarify-option"]',
    '[data-testid*="portion-option"]',
    'button.rounded-full:has-text("1")',
    'button:has-text("Sedang")',
    'button:has-text("Normal")',
    'button:has-text("Porsi Standar")',
    'button:has-text("Standar")',
  ]);
  if (await optionChip.isVisible({ timeout: 2000 }).catch(() => false)) {
    await optionChip.click().catch(() => {});
    await page.waitForTimeout(500);
  }

  const confirmBtn = first(page, [
    'button:has-text("Confirm portions")',
    'button:has-text("Select Portion")',
    'button:has-text("Pilih Porsi")',
    'button:has-text("Porsi Standar")',
    'button:has-text("Standard portion")',
    'button:has-text("Standard")',
    'button:has-text("Standar")',
    'button:has-text("1 Porsi")',
    'button:has-text("Instant Update")',
    'button:has-text("Agent Review")',
    'button:has-text("Lanjutkan")',
    'button:has-text("Konfirmasi")',
    'button:has-text("Confirm")',
    'button:has-text("Simpan")',
    'button:has-text("Ya")',
    'button:has-text("Tetap")',
    'button:has-text("Gunakan")',
    '[data-testid*="confirm"]',
    '[data-testid*="portion"]',
    '[data-testid*="clarify"]',
  ]);
  if (await confirmBtn.isVisible({ timeout: 6000 }).catch(() => false)) {
    await confirmBtn.click().catch(() => {});
    await expect(analyzing).toBeHidden({ timeout: 180000 }).catch(() => {});
  }

  // If still no jobId, try one more time from latest completed message or DOM element
  if (!capturedJobId) {
    const jobElement = page.locator('[data-job-id]').last();
    capturedJobId = await jobElement.getAttribute('data-job-id').catch(() => null);
  }

  return { jobId: capturedJobId };
}

export async function pollJobUntilTerminal(
  page: Page,
  jobId: string,
  timeoutMs: number = 480000,
  options: { allowAwaitingUser?: boolean } = {}
): Promise<any> {
  const { allowAwaitingUser = true } = options;
  const start = Date.now();
  console.log(`[indo-helpers] Polling job ${jobId} status until terminal (timeout ${Math.round(timeoutMs / 1000)}s)...`);

  let lastStatus = 'unknown';
  let payload: any = null;

  while (Date.now() - start < timeoutMs) {
    try {
      const resp = await page.request.get(`/api/jobs/status?jobId=${jobId}`);
      if (resp.ok()) {
        payload = await resp.json();
        const job = payload?.jobs?.[0] || payload?.job || payload;
        lastStatus = job?.status || lastStatus;
        if (lastStatus === 'succeeded' || lastStatus === 'failed') {
          console.log(`[indo-helpers] Job ${jobId} reached terminal status: ${lastStatus} in ${Math.round((Date.now() - start) / 1000)}s`);
          return job;
        }

        if (lastStatus === 'awaiting_user') {
          // Check if page has confirmation or portion buttons visible to advance the run
          const resumeBtn = first(page, [
            'button:has-text("Confirm portions")',
            'button:has-text("Select Portion")',
            'button:has-text("Pilih Porsi")',
            'button:has-text("Porsi Standar")',
            'button:has-text("Standard portion")',
            'button:has-text("Standard")',
            'button:has-text("Standar")',
            'button:has-text("1 Porsi")',
            'button:has-text("Instant Update")',
            'button:has-text("Agent Review")',
            'button:has-text("Lanjutkan")',
            'button:has-text("Konfirmasi")',
            'button:has-text("Confirm")',
            'button:has-text("Simpan")',
            'button:has-text("Ya")',
            '[data-testid*="confirm"]',
            '[data-testid*="portion"]',
          ]);
          if (await resumeBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
            console.log(`[indo-helpers] Job ${jobId} awaiting_user, clicking confirmation to complete...`);
            await resumeBtn.click({ timeout: 2000 }).catch(() => {});
            await page.waitForTimeout(2000);
          } else if (allowAwaitingUser && Date.now() - start > 15000) {
            console.log(`[indo-helpers] Job ${jobId} reached settled awaiting_user state (multi-turn clarify turn).`);
            return job;
          }
        }
      }
    } catch (e) {
      console.warn(`[indo-helpers] Polling error for ${jobId}:`, e);
    }
    await page.waitForTimeout(3000);
  }

  throw new Error(`Job ${jobId} did not reach terminal status within ${timeoutMs}ms (lastStatus: ${lastStatus})`);
}

export async function assertDebugContractGreen(
  page: Page,
  jobId: string | null,
  journeyId: string,
  options: { quarantinedFailIds?: string[]; timeoutMs?: number; allowAwaitingUser?: boolean } = {}
) {
  const { quarantinedFailIds = [], timeoutMs = 480000, allowAwaitingUser = true } = options;

  console.log(`\n======================================================`);
  console.log(`[assertDebugContractGreen] Starting contract validation for ${journeyId} (jobId: ${jobId || 'UNKNOWN'})`);

  expect(jobId, `A valid jobId must be captured for ${journeyId} before debug evaluation`).toBeTruthy();
  const validJobId = jobId!;

  // 1) Poll job until terminal (succeeded or awaiting_user for clarify turn)
  const terminalJob = await pollJobUntilTerminal(page, validJobId, timeoutMs, { allowAwaitingUser });
  expect(
    ['succeeded', 'awaiting_user'],
    `Job ${validJobId} must reach settled terminal state (succeeded or awaiting_user), not stuck at starting/5% or failed`
  ).toContain(terminalJob?.status);

  // 2) Ensure output directory exists
  fs.mkdirSync(LIVE_DEBUG_DIR, { recursive: true });

  // 3) POST Render /api/jobs/debug { jobId, userId, format: 'json' }
  console.log(`[assertDebugContractGreen] Requesting JSON debug dump for ${validJobId}...`);
  const jsonResp = await page.request.post('/api/jobs/debug', {
    data: {
      jobId: validJobId,
      userId: 'anonymous',
      format: 'json',
    },
  });
  expect(jsonResp.status(), `POST /api/jobs/debug (json) must return 200 for ${validJobId}`).toBe(200);
  const jsonReport = await jsonResp.json();

  // 4) POST Render /api/jobs/debug { jobId, userId, format: 'markdown' }
  console.log(`[assertDebugContractGreen] Requesting Markdown debug dump for ${validJobId}...`);
  const mdResp = await page.request.post('/api/jobs/debug', {
    data: {
      jobId: validJobId,
      userId: 'anonymous',
      format: 'markdown',
    },
  });
  expect(mdResp.status(), `POST /api/jobs/debug (markdown) must return 200 for ${validJobId}`).toBe(200);
  const mdReport = await mdResp.text();

  // 5) Save debug files to golden/journeys/_live_debug/J-ID-0X-<jobId>.{json,md}
  const jsonPath = path.join(LIVE_DEBUG_DIR, `${journeyId}-${validJobId}.json`);
  const mdPath = path.join(LIVE_DEBUG_DIR, `${journeyId}-${validJobId}.md`);

  fs.writeFileSync(jsonPath, JSON.stringify(jsonReport, null, 2), 'utf-8');
  fs.writeFileSync(mdPath, mdReport, 'utf-8');
  console.log(`[assertDebugContractGreen] Saved debug artifacts:\n  - ${jsonPath}\n  - ${mdPath}`);

  // 6) classifyDump + formatOracleFails
  const classified = classifyDump(jsonReport);
  console.log(`[assertDebugContractGreen] classifyDump yielded ${classified.length} failure(s)`);

  const activeFails = classified.filter((f) => !quarantinedFailIds.includes(f.id));
  if (activeFails.length > 0) {
    const formatted = formatOracleFails(activeFails);
    console.error(`[assertDebugContractGreen] ORACLE CONTRACT FAILURES:\n${formatted}`);
  }

  // 7) HARD expect no unquarantined oracle failures
  expect(
    activeFails,
    `Dump contracts for ${journeyId} (${validJobId}) must pass. Oracle failures:\n${formatOracleFails(activeFails)}`
  ).toHaveLength(0);

  console.log(`[assertDebugContractGreen] SUCCESS: All contract laws evaluated GREEN for ${journeyId} (${validJobId})`);
  return { jsonReport, mdReport, classified };
}

export async function cleanupLatestMeal(page: Page) {
  const deleteBtn = first(page, [
    'button:has-text("Delete task")',
    'button:has-text("Delete Entry")',
    'button:has-text("Hapus")',
    'button:has-text("Delete")',
    'button[aria-label*="delete" i]',
    'button[aria-label*="hapus" i]',
    '[data-testid*="delete"]',
  ]);
  if (await deleteBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await deleteBtn.click({ timeout: 2000 }).catch(() => {});
    const confirmDelete = first(page, [
      'button:has-text("Ya")',
      'button:has-text("Hapus")',
      'button:has-text("Confirm")',
      'button:has-text("Yes")',
    ]);
    if (await confirmDelete.isVisible({ timeout: 2000 }).catch(() => false)) {
      await confirmDelete.click({ timeout: 2000 }).catch(() => {});
    }
    console.log('[indo-helpers] Meal cleanup executed.');
  }
}
