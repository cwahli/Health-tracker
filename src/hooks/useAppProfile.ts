import { useState, useEffect, useCallback } from 'react';
import { UserProfile } from '../types';
import { sanitizeProfile, createDefaultProfile } from '../utils/appProfileUtils';

const PROFILE_STORAGE_KEY = 'user_profile';
const SENSITIVE_STORAGE_KEY = 'hide_sensitive';

export interface UseAppProfileReturn {
  profile: UserProfile;
  setProfile: React.Dispatch<React.SetStateAction<UserProfile>>;
  saveProfile: (nextProfile: UserProfile) => Promise<void>;
  hideSensitive: boolean;
  setHideSensitive: (hide: boolean) => void;
  isLoadingProfile: boolean;
  loginAsDemo: () => void;
  signOut: () => void;
}

export function useAppProfile(): UseAppProfileReturn {
  const [profile, setProfile] = useState<UserProfile>(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const stored = localStorage.getItem(PROFILE_STORAGE_KEY);
        if (stored) {
          return sanitizeProfile(JSON.parse(stored));
        }
      } catch {
        // parsing failed fallback
      }
    }
    return createDefaultProfile();
  });

  const [hideSensitive, setHideSensitiveState] = useState<boolean>(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      return localStorage.getItem(SENSITIVE_STORAGE_KEY) === 'true';
    }
    return false;
  });

  const [isLoadingProfile, setIsLoadingProfile] = useState(false);

  // Sync to localStorage on state change
  useEffect(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
      } catch {
        // quota exceeded or private mode
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

    // Save to localStorage
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(sanitized));
      } catch {}
    }

    // Attempt server sync if endpoint available
    try {
      await fetch('/api/profile/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: sanitized })
      });
    } catch {
      // offline fallback is safe
    } finally {
      setIsLoadingProfile(false);
    }
  }, []);

  const loginAsDemo = useCallback(() => {
    const demo = createDefaultProfile();
    setProfile(demo);
  }, []);

  const signOut = useCallback(() => {
    const defaultProfile = createDefaultProfile();
    setProfile(defaultProfile);
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.removeItem(PROFILE_STORAGE_KEY);
      sessionStorage.clear();
    }
  }, []);

  return {
    profile,
    setProfile,
    saveProfile,
    hideSensitive,
    setHideSensitive,
    isLoadingProfile,
    loginAsDemo,
    signOut
  };
}
