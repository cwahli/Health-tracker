import fs from 'node:fs';
import path from 'node:path';
import { expect, type Page, type Locator } from '@playwright/test';

export const CREDS_FILE = path.resolve('/tmp/sari-e2e-creds.json');

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
    await indoClickable.click().catch(() => {});
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
      await submitBtn.click();
      await page.waitForTimeout(3000);

      const bypass = page.locator('#auth-bypass-verify-btn, #auth-simulate-verify-btn');
      if (await bypass.isVisible({ timeout: 3000 }).catch(() => false)) {
        await bypass.click().catch(() => {});
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
    await modeSwitch.click();
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

  await page.locator('#auth-submit-btn').click();
  await submitWait;

  const bypass = page.locator('#auth-bypass-verify-btn, #auth-simulate-verify-btn');
  if (await bypass.isVisible({ timeout: 5000 }).catch(() => false)) {
    await bypass.click().catch(() => {});
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
      await emptyBtn.click();
    } else if (await avatarBtn.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      await avatarBtn.first().click();
    } else {
      const healthTab = first(page, ['#nav-tab-health', 'button:has-text("Health")', 'button:has-text("Kesehatan")']);
      if (await healthTab.isVisible().catch(() => false)) {
        await healthTab.click().catch(() => {});
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
    await saveBtn.click();
    await expect(profileModal).toBeHidden({ timeout: 15000 }).catch(() => {});
  }

  return { height: heightVal, weight: weightVal };
}

export async function openFoodChat(page: Page) {
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

export async function openCompareMode(page: Page) {
  const quickActionBtn = first(page, [
    'button[title="Open quick actions"]',
    'button[title*="quick" i]',
    'button.w-14.h-14',
    '[aria-label*="quick" i]',
    'button:has-text("Open Quick Actions")',
  ]);
  await quickActionBtn.waitFor({ state: 'visible', timeout: 30000 });
  await quickActionBtn.click();

  const compareBtn = first(page, [
    '#quick-action-compare-meal',
    'button:has-text("Compare")',
    'button:has-text("Bandingkan")',
    'button:has-text("Bandingkan Makanan")',
  ]);
  await compareBtn.waitFor({ state: 'visible', timeout: 15000 });
  await compareBtn.click();

  const input = page.locator('#food-chat-input');
  await expect(input).toBeVisible({ timeout: 30000 });
}

export async function openFrontDesk(page: Page): Promise<Locator> {
  const deskTab = first(page, [
    '#nav-tab-desk',
    '#nav-tab-receptionist',
    'button:has-text("Desk")',
    'button:has-text("Front Desk")',
    'button:has-text("Meja Depan")',
    'button:has-text("Resepsionis")',
  ]);

  if (await deskTab.isVisible({ timeout: 3000 }).catch(() => false)) {
    await deskTab.click();
  } else {
    // Check quick actions for receptionist / coach
    const quickActionBtn = first(page, [
      'button[title="Open quick actions"]',
      'button.w-14.h-14',
      '[aria-label*="quick" i]',
    ]);
    if (await quickActionBtn.isVisible().catch(() => false)) {
      await quickActionBtn.click();
      const deskAction = first(page, [
        '#quick-action-receptionist',
        'button:has-text("Front Desk")',
        'button:has-text("Receptionist")',
        'button:has-text("Coach")',
        'button:has-text("Konsultasi")',
      ]);
      if (await deskAction.isVisible({ timeout: 3000 }).catch(() => false)) {
        await deskAction.click();
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

export async function submitFoodChatMessageWithPhotos(page: Page, text: string, photoPaths: string[] = []) {
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
  await sendBtn.click();

  const analyzing = page.getByText(/Updating|Analyzing|Menganalisis|Memperbarui/i).first();
  await analyzing.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  await expect(analyzing).toBeHidden({ timeout: 240000 }).catch(() => {});

  const confirmBtn = first(page, [
    'button:has-text("Confirm portions")',
    'button:has-text("Select Portion")',
    'button:has-text("Pilih Porsi")',
    'button:has-text("Instant Update")',
    'button:has-text("Agent Review")',
    'button:has-text("Lanjutkan")',
    'button:has-text("Konfirmasi")',
    'button:has-text("Simpan")',
  ]);
  if (await confirmBtn.isVisible({ timeout: 6000 }).catch(() => false)) {
    await confirmBtn.click().catch(() => {});
    await expect(analyzing).toBeHidden({ timeout: 120000 }).catch(() => {});
  }
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
  if (await deleteBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
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
    console.log('[indo-helpers] Meal cleanup executed.');
  }
}
