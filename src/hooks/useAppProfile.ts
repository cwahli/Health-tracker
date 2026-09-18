import { useState, useEffect, useCallback } from 'react';
import { UserProfile } from '../types';
import { sanitizeProfile, createDefaultProfile } from '../utils/appProfileUtils';
import { getStorageKey, clearCachedAppData } from '../utils/storageUtils';
import { JobStore } from '../jobs/JobStore';
import { signOut as firebaseSignOut } from 'firebase/auth';
import { auth } from '../firebase';

const STORAGE_LAST_ACTIVE_EMAIL = 'last_active_email';
const STORAGE_DEMO_TYPE = 'demo_profile_type';
const STORAGE_DEMO_FRESH = 'demo_fresh_login';
const SENSITIVE_STORAGE_KEY = 'hide_sensitive';

export interface UseAppProfileReturn {
  profile: UserProfile | null;
  setProfile: React.Dispatch<React.SetStateAction<UserProfile | null>>;
  saveProfile: (nextProfile: UserProfile) => Promise<void>;
  hideSensitive: boolean;
  setHideSensitive: (hide: boolean) => void;
  isLoadingProfile: boolean;
  loginAsDemo: (demoType?: 'average' | 'empty' | 'complex') => void;
  signOut: () => void;
}

export function useAppProfile(): UseAppProfileReturn {
  const [profile, setProfile] = useState<UserProfile | null>(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const lastActiveEmail = localStorage.getItem(STORAGE_LAST_ACTIVE_EMAIL);
        if (!lastActiveEmail) {
          return null;
        }
        if (lastActiveEmail === 'demo@healthcockpit.com') {
          const demoType = (localStorage.getItem(STORAGE_DEMO_TYPE) as any) || 'average';
          const demo = createDefaultProfile();
          if (demoType === 'empty') {
            demo.pendingObservations = [];
            demo.customBiomarkers = {};
          }
          return demo;
        }
        const storageKey = getStorageKey(lastActiveEmail);
        const stored = localStorage.getItem(storageKey);
        if (stored) {
          return sanitizeProfile(JSON.parse(stored));
        }
        return sanitizeProfile({ email: lastActiveEmail, name: lastActiveEmail.split('@')[0] });
      } catch {
        // parsing failed fallback
      }
    }
    return null;
  });

  const [hideSensitive, setHideSensitiveState] = useState<boolean>(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      return localStorage.getItem(SENSITIVE_STORAGE_KEY) === 'true';
    }
    return false;
  });

  const [isLoadingProfile, setIsLoadingProfile] = useState(false);

  // Sync to storage on state change
  useEffect(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      if (profile && profile.email) {
        try {
          const storageKey = getStorageKey(profile.email);
          localStorage.setItem(storageKey, JSON.stringify(profile));
          localStorage.setItem(STORAGE_LAST_ACTIVE_EMAIL, profile.email);
        } catch {
          // quota exceeded or private mode
        }
      }
    }
  }, [profile]);

  const setHideSensitive = useCallback((hide: boolean) => {
    setHideSensitiveState(hide);
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem(SENSITIVE_STORAGE_KEY, String(hide));
    }
  }, []);

  const saveProfile = useCallback(async (nextProfile: UserProfile) => {
    setIsLoadingProfile(true);
    const sanitized = sanitizeProfile(nextProfile);
    setProfile(sanitized);

    // Save to storage
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const storageKey = getStorageKey(sanitized.email);
        localStorage.setItem(storageKey, JSON.stringify(sanitized));
        localStorage.setItem(STORAGE_LAST_ACTIVE_EMAIL, sanitized.email);
      } catch {}
    }

    // Attempt server sync if endpoint available
    try {
      await fetch('/api/profile/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: sanitized }),
      });
    } catch {
      // offline fallback is safe
    } finally {
      setIsLoadingProfile(false);
    }
  }, []);

  const loginAsDemo = useCallback((demoType: 'average' | 'empty' | 'complex' = 'average') => {
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem(STORAGE_LAST_ACTIVE_EMAIL, 'demo@healthcockpit.com');
      localStorage.setItem(STORAGE_DEMO_TYPE, demoType);
      localStorage.setItem(STORAGE_DEMO_FRESH, '1');
    }
    const demo = createDefaultProfile();
    demo.name = 'Demo User';
    demo.email = 'demo@healthcockpit.com';
    demo.userType = 'Demo';
    if (demoType === 'empty') {
      demo.pendingObservations = [];
      demo.customBiomarkers = {};
    }
    setProfile(demo);
  }, []);

  const signOut = useCallback(() => {
    const activeEmail =
      profile?.email ||
      (typeof window !== 'undefined' ? localStorage.getItem(STORAGE_LAST_ACTIVE_EMAIL) : null);

    try {
      firebaseSignOut(auth).catch(() => {});
    } catch {}

    try {
      JobStore.resetAllJobs();
    } catch {}

    if (activeEmail) {
      try {
        clearCachedAppData(activeEmail);
      } catch {}
    }

    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.removeItem(STORAGE_LAST_ACTIVE_EMAIL);
      localStorage.removeItem(STORAGE_DEMO_TYPE);
      localStorage.removeItem(STORAGE_DEMO_FRESH);
      localStorage.removeItem('auth_token');
      sessionStorage.clear();
    }

    setProfile(null);
  }, [profile]);

  return {
    profile,
    setProfile,
    saveProfile,
    hideSensitive,
    setHideSensitive,
    isLoadingProfile,
    loginAsDemo,
    signOut,
  };
}

export default useAppProfile;
