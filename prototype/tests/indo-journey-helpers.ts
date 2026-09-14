import fs from 'node:fs';
import path from 'node:path';
import { expect, type Page, type Locator } from '@playwright/test';
import { classifyDump, formatOracleFails } from '../../src/utils/dumpContract.js';

export const CREDS_FILE = path.resolve('/tmp/sari-e2e-creds.json');
export const LIVE_DEBUG_DIR = path.resolve(process.cwd(), 'golden/scorecard/current/debug');
export const LIVE_A11Y_DIR = path.resolve(process.cwd(), 'golden/scorecard/current/a11y');

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

// Gate I18N-A11Y constants per golden/scorecard/instruction/i18n/GATE_I18N_A11Y_TREE.md
const TITLE_CASE_PLACEHOLDER_REGEX = /\b[A-Z][A-Za-z0-9]*(?: [A-Z][A-Za-z0-9]*)* (Title|Desc|Label)\b/;

const KNOWN_BAD_CHROME_STRINGS = [
  'Chat Placeholder',
  'Agent Food Welcome',
  'Data Used By Agent',
  'Empty History',
  'Manual Entry',
  'Weight Label',
  'Nutrient Label',
  'Total Label',
  'Ingredients Label',
  'Welcome Health Portal',
  'Dashboard Ready Desc',
  'Sign In Title',
  'Email Label',
  'Password Label',
  'OR DIVIDER',
];

const FORBIDDEN_ENGLISH_CHROME_VERBS_REGEXES = [
  /\bLog Meal\b/i,
  /\bCompare\b/i,
  /\bHealth Info\b/i,
  /\bFood History\b/i,
  /\bView Analysis\b/i,
  /\bSave Log\b/i,
  /\bView Status\b/i,
  /\bView More\b/i,
  /\bLog This Food\b/i,
  /\bFlag issue\b/i,
  /\bAdjust portion\b/i,
  /\bAI Estimated\b/i,
  /\bAnalysis completed\b/i,
  /\bAnalyzing Meal Photo\b/i,
  /\bSelect Photo Source\b/i,
  /\bSolid Food\b/i,
];

// Allowlisted machine nutrient codes, technical units, emails, proper nouns
const ALLOWLIST_EXACT_OR_PATTERN = [
  /^(calories|protein|totalFat|carbs|carbohydrates|saturatedFat|transFat|cholesterol|sodium|dietaryFiber|sugars|potassium|calcium|iron)$/i,
  /^(kcal|g|mg|mcg|%|kg|cm)$/i,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/,
  /\bjob_[0-9a-z_]+\b/i,
  /\b(?:Google|Facebook|Gemini|Render)\b/i,
  /\bUnduh Log Debug\b/i,
];

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

/**
 * Gate I18N-A11Y: Strict accessibility-tree scan enforcing Indonesian localization.
 */
export async function assertIdChromeA11yTree(
  page: Page,
  options: { journeyId: string; surface: string }
): Promise<{ snapshotTree: string; artifactPath: string }> {
  const { journeyId, surface } = options;
  console.log(`[Gate I18N-A11Y] Capturing ariaSnapshot for ${journeyId} - ${surface}...`);

  const root = page.locator('#root, body').first();
  let ariaText = '';
  try {
    if (typeof (root as any).ariaSnapshot === 'function') {
      ariaText = await (root as any).ariaSnapshot();
    }
  } catch (e) {
    console.warn('[Gate I18N-A11Y] ariaSnapshot failed, falling back to DOM walk:', e);
  }

  if (!ariaText || !ariaText.trim()) {
    ariaText = await page.evaluate(() => {
      const rootEl = document.querySelector('#root') || document.body;
      const bits: string[] = [];
      const walk = (el: Element) => {
        const role = el.getAttribute('role') || el.tagName.toLowerCase();
        const name =
          el.getAttribute('aria-label') ||
          el.getAttribute('title') ||
          el.getAttribute('placeholder') ||
          '';
        let direct = '';
        el.childNodes.forEach((n) => {
          if (n.nodeType === Node.TEXT_NODE && n.textContent?.trim()) direct += ' ' + n.textContent.trim();
        });
        const label = (name || direct).trim();
        if (label) bits.push(`[${role}] ${label}`);
        Array.from(el.children).forEach(walk);
      };
      walk(rootEl);
      return bits.join('\n');
    }).catch(() => '');
  }

  const lines = ariaText.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim().length > 0);
  const violations: string[] = [];

  const checkText = (text: string, roleHint: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (ALLOWLIST_EXACT_OR_PATTERN.some((pattern) => pattern.test(trimmed))) return;

    const titleCaseMatch = trimmed.match(TITLE_CASE_PLACEHOLDER_REGEX);
    if (titleCaseMatch) {
      violations.push(`Placeholder token detected in [${roleHint}]: "${trimmed}" (match: "${titleCaseMatch[0]}")`);
      return;
    }
    for (const bad of KNOWN_BAD_CHROME_STRINGS) {
      if (trimmed.includes(bad)) {
        violations.push(`Known bad chrome string "${bad}" detected in [${roleHint}]: "${trimmed}"`);
      }
    }
    for (const verbRe of FORBIDDEN_ENGLISH_CHROME_VERBS_REGEXES) {
      if (verbRe.test(trimmed)) {
        violations.push(`Forbidden English chrome verb /${verbRe.source}/ found in [${roleHint}]: "${trimmed}"`);
      }
    }
    const rawKeyMatch = trimmed.match(/\b([a-z0-9_]+\.[a-z0-9_.]+)\b/i);
    if (rawKeyMatch && /^[a-zA-Z_]/.test(rawKeyMatch[0]) && /[a-zA-Z]/.test(rawKeyMatch[0]) && !trimmed.includes('@') && !trimmed.includes('.com') && !trimmed.includes('.jpg')) {
      violations.push(`Raw translation key pattern "${rawKeyMatch[0]}" detected in [${roleHint}]: "${trimmed}"`);
    }
  };

  for (const line of lines) {
    const quoted = [...line.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    const roleMatch = line.match(/^\s*-\s*([a-zA-Z0-9_-]+)/);
    const roleHint = roleMatch ? roleMatch[1] : 'node';
    if (quoted.length) {
      for (const q of quoted) checkText(q, roleHint);
    } else {
      const stripped = line.replace(/^\s*-\s*/, '').replace(/^[a-zA-Z0-9_-]+:\s*/, '').trim();
      if (stripped) checkText(stripped, roleHint);
    }
  }

  fs.mkdirSync(LIVE_A11Y_DIR, { recursive: true });
  const filename = `${journeyId}-${surface}.txt`;
  const artifactPath = path.join(LIVE_A11Y_DIR, filename);
  fs.writeFileSync(artifactPath, lines.join('\n'), 'utf-8');
  console.log(`[Gate I18N-A11Y] Saved accessibility artifact: ${artifactPath} (${lines.length} lines)`);

  expect(
    violations,
    `Gate I18N-A11Y Violation on surface "${surface}" in ${journeyId}. Evidence saved to ${artifactPath}.\nViolations:\n${violations.join('\n')}`
  ).toEqual([]);

  return { snapshotTree: ariaText, artifactPath };
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

  const email = `sari.pw.${Date.now()}.${Math.floor(Math.random() * 1000)}@example.com`;
  console.log(`[indo-helpers] Creating fresh user: ${email}`);

  const modeSwitch = first(page, [
    '#auth-mode-switch-btn',
    'button:has-text("Don\'t have an account?")',
  ]);
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

  // Track L L-1: meal agents read profile.language — auth chrome "Bahasa Indonesia" alone is not enough.
  const langSel = profileModal.locator('#lang-selector, select[name="language"], select[id*="lang" i]').first();
  if (await langSel.isVisible({ timeout: 3000 }).catch(() => false)) {
    await langSel.selectOption('id').catch(async () => {
      await langSel.selectOption({ label: /Bahasa Indonesia|Indonesia/i }).catch(() => {});
    });
    const chosen = await langSel.inputValue().catch(() => '');
    console.log(`[indo-helpers] Profile language selector value after set: ${chosen || 'UNKNOWN'}`);
  } else {
    console.warn('[indo-helpers] Profile language selector not found — meal agents may default to English');
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

    const nickInput = await fieldAfterLabel(profileModal, /Nickname|Nama/i).catch(() => null);
    if (nickInput && (await nickInput.isVisible().catch(() => false))) {
      await nickInput.fill(SARI_PERSONA.nickname);
    }
  } catch (err) {
    console.warn('[indo-helpers] Optional profile field filling error:', err);
  }

  const saveBtn = profileModal.locator('button[type="submit"], button:has-text("Simpan"), button:has-text("Save")').first();
  if (await saveBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await saveBtn.click({ timeout: 3000 }).catch(() => {});
    await profileModal.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
  }

  const persistedLang = await page.evaluate(() => {
    try {
      for (const k of Object.keys(localStorage)) {
        const raw = localStorage.getItem(k);
        if (!raw || raw.length > 500000) continue;
        if (!/language|"lang"/i.test(raw)) continue;
        try {
          const obj = JSON.parse(raw);
          const walk = (v) => {
            if (!v || typeof v !== 'object') return null;
            if (typeof v.language === 'string') return v.language;
            if (typeof v.lang === 'string') return v.lang;
            if (v.profile) {
              const p = walk(v.profile);
              if (p) return p;
            }
            if (v.userProfile) {
              const p = walk(v.userProfile);
              if (p) return p;
            }
            return null;
          };
          const hit = walk(obj);
          if (hit) return hit;
        } catch {}
      }
    } catch {}
    return null;
  }).catch(() => null);
  console.log(`[indo-helpers] Persisted profile language after save: ${persistedLang || 'UNKNOWN'}`);

  return { height: heightVal, weight: weightVal, language: persistedLang };
}

export async function openFoodChat(page: Page) {
  const chatInput = page.locator('#food-chat-input');
  if (await chatInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    return chatInput;
  }

  const triggers = [
    '#quick-action-log-meal',
    '#quick-action-catat-makanan',
    'button:has-text("Catat Makanan")',
    'button:has-text("Log Meal")',
    '#food-chat-open-btn',
    'button[aria-label*="makanan" i]',
    'button[aria-label*="meal" i]',
  ];

  const quickActionBtn = first(page, [
    'button[title="Open quick actions"]',
    'button[title*="quick" i]',
    'button.w-14.h-14',
    '[aria-label*="quick" i]',
    'button:has-text("Open Quick Actions")',
  ]);

  if (await quickActionBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await quickActionBtn.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(500);
  }

  const trigger = first(page, triggers);
  if (await trigger.isVisible({ timeout: 3000 }).catch(() => false)) {
    await trigger.click({ timeout: 3000 }).catch(() => {});
  }

  await expect(chatInput).toBeVisible({ timeout: 20000 });
  return chatInput;
}

export async function openCompareMode(page: Page) {
  const compareInput = page.locator('#food-chat-input, #compare-input');
  const compareTriggers = [
    '#quick-action-compare',
    'button:has-text("Bandingkan Makanan")',
    'button:has-text("Bandingkan")',
    'button:has-text("Compare Food")',
    'button:has-text("Compare")',
    '#compare-mode-btn',
  ];

  const quickActionBtn = first(page, [
    'button[title="Open quick actions"]',
    'button[title*="quick" i]',
    'button.w-14.h-14',
    '[aria-label*="quick" i]',
    'button:has-text("Open Quick Actions")',
  ]);

  if (await quickActionBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await quickActionBtn.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(500);
  }

  const trigger = first(page, compareTriggers);
  if (await trigger.isVisible({ timeout: 3000 }).catch(() => false)) {
    await trigger.click({ timeout: 3000 }).catch(() => {});
  } else {
    await openFoodChat(page);
  }

  await expect(compareInput).toBeVisible({ timeout: 20000 });
  return compareInput;
}

export async function openFrontDesk(page: Page) {
  const deskInput = page.locator('#desk-chat-input, #receptionist-chat-input, #food-chat-input');
  if (await deskInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    return deskInput;
  }

  const deskTab = first(page, [
    '#nav-tab-desk',
    '#nav-tab-receptionist',
    'button:has-text("Meja Depan")',
    'button:has-text("Front Desk")',
    'button:has-text("Resepsionis")',
  ]);

  if (await deskTab.isVisible({ timeout: 3000 }).catch(() => false)) {
    await deskTab.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(1000);
  }

  return deskInput;
}

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

export async function pollFrontDeskSettled(
  page: Page,
  jobId: string,
  timeoutMs: number = 480000,
): Promise<any> {
  const start = Date.now();
  console.log(`[indo-helpers] Front-desk job ${jobId} is client-only; settling on client signals...`);
  const panel = page.getByText(/Extracted Biomarkers Panel|Biomarkers Panel/i).first();
  await expect(panel).toBeVisible({ timeout: timeoutMs });
  const analyzing = page.getByText(/Starting cloud|Menganalisis|Analyzing|Updating|Memperbarui/i).first();
  await expect(analyzing).toBeHidden({ timeout: 60000 }).catch(() => {});
  console.log(`[indo-helpers] Front-desk job ${jobId} settled client-side in ${Math.round((Date.now() - start) / 1000)}s`);
  return { id: jobId, kind: 'front_desk', status: 'succeeded', clientSettled: true };
}

export async function pollJobUntilTerminal(
  page: Page,
  jobId: string,
  timeoutMs: number = 480000,
  options: { allowAwaitingUser?: boolean } = {}
): Promise<any> {
  // Front-desk jobs are CLIENT-ONLY by design (excluded from cloud sync +
  // hydration polling in SupabaseJobSync): the server never knows
  // job_frontdesk_* ids, so server polling spins on 'unknown' forever.
  // Settle on client signals instead (B0 learning 2026-09-14).
  if (String(jobId || '').startsWith('job_frontdesk_')) {
    return pollFrontDeskSettled(page, jobId, timeoutMs);
  }
  const { allowAwaitingUser = true } = options;
  const start = Date.now();
  console.log(`[indo-helpers] Polling job ${jobId} status until terminal (timeout ${Math.round(timeoutMs / 1000)}s)...`);

  let lastStatus = 'unknown';
  let payload: any = null;
  let confirmClicks = 0;
  const maxConfirmClicks = 3;

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
          // Cap confirm clicks — broad "Standard"/"Confirm" selectors can match forever without advancing.
          if (allowAwaitingUser && (confirmClicks >= maxConfirmClicks || Date.now() - start > 45000)) {
            console.log(`[indo-helpers] Job ${jobId} settled awaiting_user after ${confirmClicks} confirm click(s).`);
            return job;
          }
          const resumeBtn = first(page, [
            'button:has-text("Confirm portions")',
            'button:has-text("Select Portion")',
            'button:has-text("Pilih Porsi")',
            'button:has-text("Porsi Standar")',
            'button:has-text("Standard portion")',
            'button:has-text("Konfirmasi Porsi")',
            'button:has-text("1 Porsi")',
            'button:has-text("Instant Update")',
            'button:has-text("Agent Review")',
            'button:has-text("Lanjutkan")',
            'button:has-text("Konfirmasi")',
            '[data-testid="confirm-portions-btn"]',
            '[data-testid*="confirm-portion"]',
            '[data-testid*="portion-confirm"]',
          ]);
          if (await resumeBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
            confirmClicks += 1;
            console.log(`[indo-helpers] Job ${jobId} awaiting_user, clicking confirmation (${confirmClicks}/${maxConfirmClicks})...`);
            await resumeBtn.click({ timeout: 2000 }).catch(() => {});
            await page.waitForTimeout(2500);
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

export function assertIndonesianMealVerdict(dump: any, journeyId = 'L-1') {
  const forbidden = [
    'Supports Sustained Metabolic Energy',
    'Supports Sustained Metabolic',
    'Metabolic Energy',
  ];
  const blobs: string[] = [];
  const walk = (v: any) => {
    if (v == null) return;
    if (typeof v === 'string') {
      blobs.push(v);
      return;
    }
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    if (typeof v === 'object') {
      for (const [k, val] of Object.entries(v)) {
        if (/verdict|clinicalAdvice|advice|message|medicalInsight|label/i.test(k)) walk(val);
        else if (k === 'dispatches' || k === 'turns' || k === 'output' || k === 'report') walk(val);
      }
    }
  };
  walk(dump);
  const joined = blobs.join('\n');
  for (const bad of forbidden) {
    if (joined.includes(bad)) {
      throw new Error(`[${journeyId} L-1] English fallback found in meal output: "${bad}"`);
    }
  }
  // Indonesian signal: common function words / medical phrasing (not food names).
  const idSignal = /(anda|Anda|kalori|kkal|protein|lemak|serat|porsi|tinggi|rendah|sebaiknya|disarankan|mengandung|untuk|dengan|dari|yang|ini|tersebut)/i;
  const adviceish = blobs.filter((s) => s.length > 40);
  const hasId = adviceish.some((s) => idSignal.test(s));
  if (!hasId) {
    throw new Error(
      `[${journeyId} L-1] No Indonesian verdict/advice signal in dump (advice-like blobs=${adviceish.length}). Sample: ${joined.slice(0, 240)}`,
    );
  }
  console.log(`[${journeyId} L-1] Indonesian meal verdict/advice OK (blobs=${blobs.length})`);
}

export async function cleanupLatestMeal(page: Page) {
  try {
    const deleteBtn = first(page, [
      'button[aria-label*="delete" i]',
      'button[aria-label*="hapus" i]',
      'button:has-text("Hapus")',
      'button:has-text("Delete")',
    ]);
    if (await deleteBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await deleteBtn.click({ timeout: 2000 }).catch(() => {});
    }
  } catch (err) {
    console.warn('[indo-helpers] Cleanup meal non-blocking error:', err);
  }
}
