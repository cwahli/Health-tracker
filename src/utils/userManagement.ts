import { UserProfile } from '../types';

export interface AdminSettings {
  defaultCredits: number;
  maintenanceMode: boolean;
  allowGuestMode: boolean;
  modelOverrides?: Record<string, string>;
  apiBudgetLimit?: number;
  flashLiteCost: number;
  standardCost: number;
  quotaDemo: number;
  quotaStandard: number;
  quotaAdmin: number;
  [key: string]: any;
}

const DEFAULT_ADMIN_SETTINGS: AdminSettings = {
  defaultCredits: 100,
  maintenanceMode: false,
  allowGuestMode: true,
  modelOverrides: {},
  apiBudgetLimit: 50,
  // Fallback credit/quota configuration. These are only used until an admin
  // explicitly saves values via the User Management tab, and as a safety net
  // if a device's stored settings are ever missing/corrupted (see
  // creditManager.ts, which also falls back to these same numbers).
  flashLiteCost: 1,
  standardCost: 20,
  quotaDemo: 20,
  quotaStandard: 100,
  quotaAdmin: 500,
};

const USERS_STORAGE_KEY = 'health_app_all_users';
const SETTINGS_STORAGE_KEY = 'health_app_admin_settings';

export function getAllLocalUsers(): UserProfile[] {
  try {
    const raw = localStorage.getItem(USERS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (err) {
    console.warn('[userManagement] Failed to read local users:', err);
  }
  return [];
}

export async function updateUserProfile(profileOrEmail: UserProfile | string, maybeProfile?: UserProfile): Promise<void> {
  const profile = typeof profileOrEmail === 'string' ? maybeProfile : profileOrEmail;
  const email = typeof profileOrEmail === 'string' ? profileOrEmail : profile?.email;
  if (!profile || !email) return;
  const users = getAllLocalUsers();
  const existingIdx = users.findIndex(u => u.email.toLowerCase() === email.toLowerCase());
  if (existingIdx >= 0) {
    users[existingIdx] = { ...users[existingIdx], ...profile };
  } else {
    users.push({ ...profile, email });
  }
  try {
    localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users));
  } catch (err) {
    console.warn('[userManagement] Failed to save updated user profile:', err);
  }
}

export function getAdminSettings(): AdminSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) {
      return { ...DEFAULT_ADMIN_SETTINGS, ...JSON.parse(raw) };
    }
  } catch (err) {
    console.warn('[userManagement] Failed to read admin settings:', err);
  }
  return { ...DEFAULT_ADMIN_SETTINGS };
}

export function saveAdminSettings(settings: AdminSettings): void {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch (err) {
    console.warn('[userManagement] Failed to save admin settings:', err);
  }
}
