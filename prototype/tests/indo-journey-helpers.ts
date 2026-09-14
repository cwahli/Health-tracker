import fs from 'node:fs';
import path from 'node:path';
import { expect, type Page, type Locator } from '@playwright/test';
import { classifyDump, formatOracleFails } from '../../src/utils/dumpContract.js';

export const CREDS_FILE = path.resolve('/tmp/sari-e2e-creds.json');
export const LIVE_DEBUG_DIR = path.resolve(process.cwd(), 'golden/journeys/_live_debug');
export const LIVE_A11Y_DIR = path.resolve(process.cwd(), 'golden/journeys/_live_a11y');

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

// Gate I18N-A11Y constants per golden/journeys/_drafts/GATE_I18N_A11Y_TREE.md
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

/**
 * Gate I18N-A11Y: Strict accessibility-tree scan enforcing Indonesian localization.
 * Primary: Playwright locator.ariaSnapshot() (page.accessibility removed in Playwright 1.62+).
 * Flattens snapshot text, dumps to golden/journeys/_live_a11y/J-ID-0X-<surface>.txt,
 * HARD-fails on placeholders / known bad chrome / forbidden English UI verbs.
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
    ariaText = await root.ariaSnapshot();
  } catch (e) {
    console.warn('[Gate I18N-A11Y] ariaSnapshot failed, falling back to innerText:', e);
    ariaText = await page.locator('body').innerText().catch(() => '');
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
    if (rawKeyMatch && !trimmed.includes('@') && !trimmed.includes('.com') && !trimmed.includes('.jpg')) {
      violations.push(`Raw translation key pattern "${rawKeyMatch[0]}" detected in [${roleHint}]: "${trimmed}"`);
    }
  };

  for (const line of lines) {
    // ariaSnapshot lines look like: `- button "Log Meal"` or `- text: Manual Entry`
    const quoted = [...line.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    const roleMatch = line.match(/^\s*-\s*([a-zA-Z0-9_-]+)/);
    const roleHint = roleMatch ? roleMatch[1] : 'node';
    if (quoted.length) {
      for (const q of quoted) checkText(q, roleHint);
    } else {
      // strip leading `- role:` / bullets
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
): Promise<{ snapshotTree: any; artifactPath: string }> {
  const { journeyId, surface } = options;
  console.log(`[Gate I18N-A11Y] Capturing accessibility snapshot for ${journeyId} - ${surface}...`);

  let snapshot: any = null;
  if ((page as any).accessibility && typeof (page as any).accessibility.snapshot === 'function') {
    try {
      snapshot = await (page as any).accessibility.snapshot({ interestingOnly: true });
    } catch (e) {
      console.warn(`[Gate I18N-A11Y] page.accessibility.snapshot error:`, e);
    }
  }

  // Fallback if page.accessibility is deprecated or unavailable in the environment
  if (!snapshot) {
    const fallbackTree = await page.evaluate(() => {
      function walk(el: Element): any {
        const role = el.getAttribute('role') || el.tagName.toLowerCase();
        const ariaLabel = el.getAttribute('aria-label') || '';
        const title = el.getAttribute('title') || '';
        const placeholder = el.getAttribute('placeholder') || '';
        let directText = '';
        el.childNodes.forEach((n) => {
          if (n.nodeType === Node.TEXT_NODE && n.textContent?.trim()) {
            directText += ' ' + n.textContent.trim();
          }
        });
        directText = directText.trim();
        const name = ariaLabel || title || placeholder || directText;

        const children: any[] = [];
        Array.from(el.children).forEach((child) => {
          const res = walk(child);
          if (res && (res.name || res.children.length > 0)) {
            children.push(res);
          }
        });

        return { role, name, children };
      }
      return walk(document.querySelector('#root') || document.body);
    }).catch(() => null);

    snapshot = fallbackTree || { role: 'WebArea', name: 'App', children: [] };
  }

  const lines: string[] = [];
  const violations: string[] = [];

  function traverse(node: any, depth = 0) {
    if (!node) return;
    const indent = '  '.repeat(depth);
    const role = node.role || 'node';
    const name = (node.name || '').trim();
    const value = node.value !== undefined ? String(node.value).trim() : '';
    const desc = (node.description || '').trim();

    const line = `${indent}[${role}] ${name}${value ? ` (value: "${value}")` : ''}${desc ? ` (desc: "${desc}")` : ''}`;
    lines.push(line);

    // Evaluate node texts
    const candidates = [name, value, desc].filter(Boolean);
    for (const text of candidates) {
      // 1. Skip technical allowlisted tokens
      const isAllowlisted = ALLOWLIST_EXACT_OR_PATTERN.some((pattern) => pattern.test(text.trim()));
      if (isAllowlisted) {
        continue;
      }

      // 2. Check for Title-Case Placeholders: "Something (Title|Desc|Label)"
      const titleCaseMatch = text.match(TITLE_CASE_PLACEHOLDER_REGEX);
      if (titleCaseMatch) {
        violations.push(`Placeholder token detected in [${role}]: "${text}" (match: "${titleCaseMatch[0]}")`);
        continue;
      }

      // 3. Check for known bad incident strings
      for (const bad of KNOWN_BAD_CHROME_STRINGS) {
        if (text.includes(bad)) {
          violations.push(`Known bad chrome string "${bad}" detected in [${role}]: "${text}"`);
        }
      }

      // 4. Check for forbidden English UI verbs
      for (const verbRe of FORBIDDEN_ENGLISH_CHROME_VERBS_REGEXES) {
        if (verbRe.test(text)) {
          // If the text is purely an English chrome verb, fail hard
          violations.push(`Forbidden English chrome verb "${verbRe.source}" found in [${role}]: "${text}"`);
        }
      }

      // 5. Check for raw dot notation translation keys: auth.*, table.header.*, etc.
      const rawKeyMatch = text.match(/\b([a-z0-9_]+\.[a-z0-9_.]+)\b/i);
      if (rawKeyMatch && !text.includes('@') && !text.includes('.com') && !text.includes('.jpg')) {
        violations.push(`Raw translation key pattern "${rawKeyMatch[0]}" detected in [${role}]: "${text}"`);
      }
    }

    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        traverse(child, depth + 1);
      }
    }
  }

  traverse(snapshot, 0);

  // Ensure output directory exists and persist artifact
  fs.mkdirSync(LIVE_A11Y_DIR, { recursive: true });
  const filename = `${journeyId}-${surface}.txt`;
  const artifactPath = path.join(LIVE_A11Y_DIR, filename);
  fs.writeFileSync(artifactPath, lines.join('\n'), 'utf-8');
  console.log(`[Gate I18N-A11Y] Saved accessibility artifact: ${artifactPath} (${lines.length} nodes)`);

  // Hard expect: zero violations allowed
  expect(
    violations,
    `Gate I18N-A11Y Violation on surface "${surface}" in ${journeyId}. Evidence saved to ${artifactPath}.\nViolations:\n${violations.join('\n')}`
  ).toEqual([]);

  return { snapshotTree: snapshot, artifactPath };
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

    const nickInput = await fieldAfterLabel(profileModal, /Nickname