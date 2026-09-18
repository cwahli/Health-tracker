import { UserProfile, PendingObservation } from '../types';

export function isDeepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!isDeepEqual(a[key], b[key])) return false;
  }
  return true;
}

export function createDefaultProfile(): UserProfile {
  return {
    name: 'Demo User',
    email: 'demo@healthcockpit.com',
    age: 35,
    gender: 'male',
    ethnicity: '',
    weight: 70,
    height: 175,
    bmi: 22.9,
    language: 'en',
    theme: 'system',
    userType: 'Demo',
    targetCalories: 2000,
    topTargetNutrientKeys: ['protein', 'saturatedFat', 'sodium', 'fiber'],
    customBiomarkers: {},
    customRanges: {},
    pendingObservations: [],
    agentCredits: {
      total: 100,
      used: 0,
      available: 100
    }
  };
}

export function sanitizeProfile(raw?: Partial<UserProfile> | null): UserProfile {
  const base = createDefaultProfile();
  if (!raw || typeof raw !== 'object') return base;

  const sanitized: UserProfile = {
    ...base,
    ...raw,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : base.name,
    email: typeof raw.email === 'string' && raw.email.trim() ? raw.email.trim() : base.email,
    age: typeof raw.age === 'number' && !isNaN(raw.age) ? raw.age : (Number(raw.age) || base.age),
    gender: raw.gender === 'female' || raw.gender === 'male' ? raw.gender : base.gender,
    ethnicity: typeof raw.ethnicity === 'string' ? raw.ethnicity : '',
    weight: typeof raw.weight === 'number' && !isNaN(raw.weight) ? raw.weight : (Number(raw.weight) || base.weight),
    height: typeof raw.height === 'number' && !isNaN(raw.height) ? raw.height : (Number(raw.height) || base.height),
    language: raw.language === 'id' ? 'id' : 'en',
    theme: raw.theme === 'dark' || raw.theme === 'light' ? raw.theme : 'system',
    userType: raw.userType || base.userType,
    topTargetNutrientKeys: Array.isArray(raw.topTargetNutrientKeys) ? raw.topTargetNutrientKeys : base.topTargetNutrientKeys,
    customBiomarkers: raw.customBiomarkers && typeof raw.customBiomarkers === 'object' ? raw.customBiomarkers : {},
    customRanges: raw.customRanges && typeof raw.customRanges === 'object' ? raw.customRanges : {},
    pendingObservations: Array.isArray(raw.pendingObservations) ? [...raw.pendingObservations] : [],
    agentCredits: raw.agentCredits && typeof raw.agentCredits === 'object' ? raw.agentCredits : base.agentCredits,
  };

  // Re-calculate BMI if valid weight & height
  if (sanitized.weight > 0 && sanitized.height > 0) {
    const hMeters = sanitized.height / 100;
    sanitized.bmi = Number((sanitized.weight / (hMeters * hMeters)).toFixed(1));
  }

  return sanitized;
}

export function pushPendingObservation(profile: UserProfile, observation: PendingObservation): UserProfile {
  const current = Array.isArray(profile.pendingObservations) ? profile.pendingObservations : [];
  return {
    ...profile,
    pendingObservations: [...current, observation]
  };
}
