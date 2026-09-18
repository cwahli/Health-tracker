/**
 * Pure profile helpers, moved verbatim out of `src/App.tsx` by Q-11.1.
 *
 * MOVE-ONLY: the bodies below are unchanged apart from import paths. No React, no hooks,
 * no network, no JobStore. If you need to change behaviour, do it in its own packet —
 * `scripts/assert-parity.mjs` exists to make behaviour loss visible.
 */
import { PRIMARY_NUTRIENTS } from './nutrients';
import { resolveInitialLanguage } from './syncUtils';
import { overlayFingerprint, recalibrateProfileOverlays } from './biomarkerLifecycle';

// B7.5 Silent Calibrator: re-run the demographic overlay whenever the
// fingerprint (ageBand|gender|ethnicity) changes — on every product path that
// writes a full profile, not just the Header edit form. Stamp-only (range
// recompute stays agent-side); no-op unless demographics are present + moved.
export function maybeRecalibrateDemographicOverlays(prevProfile: any, nextProfile: any): any {
  if (!prevProfile || !nextProfile) return nextProfile;
  if (nextProfile.age === undefined || nextProfile.gender === undefined || nextProfile.ethnicity === undefined) return nextProfile;
  if (overlayFingerprint(prevProfile) === overlayFingerprint(nextProfile)) return nextProfile;
  const { updatedCustomBiomarkers, recalibratedCount } = recalibrateProfileOverlays(nextProfile);
  if (recalibratedCount === 0) return nextProfile;
  return { ...nextProfile, customBiomarkers: updatedCustomBiomarkers };
}

// B7.4 Real Pending store: unknown printed names route here with dedup
// (printedName + date + rawValue). Never become catalog keys.
export function pushPendingObservation(existing: any[] | undefined, item: any): any[] {
  const list = Array.isArray(existing) ? [...existing] : [];
  const dup = list.some((p: any) =>
    String(p?.printedName || '').toLowerCase() === String(item?.printedName || '').toLowerCase() &&
    String(p?.date || '') === String(item?.date || '') &&
    String(p?.rawValue ?? '') === String(item?.rawValue ?? ''));
  if (!dup) {
    list.push({
      id: item.id || `pending_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      printedName: item.printedName || '',
      suggestedKey: item.suggestedKey || '',
      date: item.date || '',
      rawValue: item.rawValue ?? '',
      rawUnit: item.rawUnit || '',
      printedRange: item.printedRange || '',
      labFlag: item.labFlag || '',
      sourceJobId: item.sourceJobId || '',
      createdAt: item.createdAt || Date.now(),
    });
  }
  return list;
}

export function isDeepEqual(obj1: any, obj2: any): boolean {
  if (obj1 === obj2) return true;
  if (typeof obj1 !== 'object' || obj1 === null || typeof obj2 !== 'object' || obj2 === null) {
    return false;
  }
  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);

  // Filter out undefined and null values to avoid breaking equality checks on missing or null properties
  const activeKeys1 = keys1.filter(k => obj1[k] !== undefined && obj1[k] !== null);
  const activeKeys2 = keys2.filter(k => obj2[k] !== undefined && obj2[k] !== null);
  if (activeKeys1.length !== activeKeys2.length) return false;
  for (const key of activeKeys1) {
    if (!activeKeys2.includes(key)) return false;
    if (!isDeepEqual(obj1[key], obj2[key])) return false;
  }
  return true;
}

export function sanitizeProfile(incomingProfile: any, activeEmail?: string): any {
  const defaultEmail = (activeEmail || 'cwah.liu@gmail.com').toLowerCase().trim();
  if (!incomingProfile) {
    const isCwahEmpty = defaultEmail.includes('cwah.liu') || defaultEmail.includes('chiwah.liu') || defaultEmail.includes('john@mail') || defaultEmail.includes('john@gmail');
    if (!isCwahEmpty) return null;
    return {
      nickname: 'C. Liu',
      photoUrl: '',
      email: 'cwah.liu@gmail.com',
      age: 28,
      ethnicity: 'Chinese',
      weight: 70,
      height: 175,
      gender: 'Male',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      language: resolveInitialLanguage(),
      userType: 'Admin',
      topNutrientsToMonitor: PRIMARY_NUTRIENTS
    };
  }
  const emailLower = (incomingProfile.email || activeEmail || '').toLowerCase().trim();
  const nick = (incomingProfile.nickname || '').toLowerCase();
  const isCwah =
    emailLower.includes('cwah.liu') ||
    emailLower.includes('chiwah.liu') ||
    emailLower.includes('john@mail') ||
    emailLower.includes('john@gmail') ||
    nick.includes('john doe');
  if (isCwah) {
    return {
      ...incomingProfile,
      email: 'cwah.liu@gmail.com',
      nickname: (!incomingProfile.nickname || nick.includes('john doe')) ? 'C. Liu' : incomingProfile.nickname,
      age: incomingProfile.age ?? 28,
      ethnicity: (incomingProfile.ethnicity === 'Unknown' || !incomingProfile.ethnicity || incomingProfile.ethnicity === 'Caucasian')
        ? 'Chinese'
        : incomingProfile.ethnicity,
      weight: incomingProfile.weight ?? 70,
      height: incomingProfile.height ?? 175,
      gender: (incomingProfile.gender === 'Unknown' || !incomingProfile.gender) ? 'Male' : incomingProfile.gender,
      userType: 'Admin'
    };
  }
  return incomingProfile;
}
