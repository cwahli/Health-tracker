import { useState, useEffect, useCallback } from 'react';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { auth } from '../firebase';
import { clearCachedAppData } from '../utils/storageUtils';
import { JobStore } from '../jobs/JobStore';
import { UserProfile } from '../types';
import { createDefaultProfile } from '../utils/appProfileUtils';

const STORAGE_LAST_ACTIVE_EMAIL = 'last_active_email';
const STORAGE_DEMO_TYPE = 'demo_profile_type';
const STORAGE_DEMO_FRESH = 'demo_fresh_login';

export interface UseAuthSessionOptions {
  onProfileHydrate?: (profile: UserProfile | null) => void;
}

export interface UseAuthSessionReturn {
  user: User | null;
  isAuthChecking: boolean;
  isLoggedIn: boolean;
  authError: string | null;
  loginAsDemo: (demoType?: 'average' | 'empty' | 'complex') => void;
  handleSignOut: () => Promise<void>;
  handleLoginSuccess: (profile: UserProfile, token?: string) => void;
}

export function useAuthSession(options?: UseAuthSessionOptions): UseAuthSessionReturn {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthChecking, setIsAuthChecking] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isDemoActive, setIsDemoActive] = useState<boolean>(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      return localStorage.getItem(STORAGE_LAST_ACTIVE_EMAIL) === 'demo@healthcockpit.com';
    }
    return false;
  });

  const onProfileHydrate = options?.onProfileHydrate;

  // Listen to Firebase Auth state
  useEffect(() => {
    let timer: any = null;

    // Safety timeout: don't block render indefinitely if Firebase Auth is unresponsive
    timer = setTimeout(() => {
      setIsAuthChecking(false);
    }, 4000);

    const unsubscribe = onAuthStateChanged(
      auth,
      (currentUser) => {
        if (timer) clearTimeout(timer);
        setUser(currentUser);
        setIsAuthChecking(false);

        if (currentUser && currentUser.email) {
          if (typeof window !== 'undefined' && window.localStorage) {
            localStorage.setItem(STORAGE_LAST_ACTIVE_EMAIL, currentUser.email);
          }
          if (onProfileHydrate) {
            const base = createDefaultProfile();
            onProfileHydrate({
              ...base,
              email: currentUser.email,
              name: currentUser.displayName || currentUser.email.split('@')[0],
              userType: 'Standard',
            });
          }
        }
      },
      (err) => {
        console.warn('[useAuthSession] onAuthStateChanged error:', err);
        if (timer) clearTimeout(timer);
        setIsAuthChecking(false);
        setAuthError(err?.message || 'Auth listener failed');
      }
    );

    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [onProfileHydrate]);

  // Demo entrance
  const loginAsDemo = useCallback((demoType: 'average' | 'empty' | 'complex' = 'average') => {
    setIsDemoActive(true);
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

    if (onProfileHydrate) {
      onProfileHydrate(demo);
    }
  }, [onProfileHydrate]);

  // Custom login / signup success
  const handleLoginSuccess = useCallback((userProfile: UserProfile, token?: string) => {
    setIsDemoActive(false);
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem(STORAGE_LAST_ACTIVE_EMAIL, userProfile.email);
      if (token) {
        localStorage.setItem('auth_token', token);
      }
    }
    if (onProfileHydrate) {
      onProfileHydrate(userProfile);
    }
  }, [onProfileHydrate]);

  // Sign out
  const handleSignOut = useCallback(async () => {
    const activeEmail =
      user?.email ||
      (typeof window !== 'undefined' ? localStorage.getItem(STORAGE_LAST_ACTIVE_EMAIL) : null);

    try {
      await signOut(auth);
    } catch (e) {
      console.warn('[useAuthSession] fbSignOut error:', e);
    }

    setUser(null);
    setIsDemoActive(false);

    // Clear user tokens & demo flags
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.removeItem(STORAGE_LAST_ACTIVE_EMAIL);
      localStorage.removeItem(STORAGE_DEMO_TYPE);
      localStorage.removeItem(STORAGE_DEMO_FRESH);
      localStorage.removeItem('auth_token');
      localStorage.removeItem('user_profile');
      sessionStorage.clear();
    }

    // Clear caches
    if (activeEmail) {
      try {
        await clearCachedAppData(activeEmail);
      } catch (e) {
        console.warn('[useAuthSession] clearCachedAppData error:', e);
      }
    }

    try {
      JobStore.resetAllJobs();
    } catch (e) {
      console.warn('[useAuthSession] JobStore.resetAllJobs error:', e);
    }

    if (onProfileHydrate) {
      onProfileHydrate(null);
    }
  }, [user, onProfileHydrate]);

  const isLoggedIn = Boolean((user && user.email) || isDemoActive);

  return {
    user,
    isAuthChecking,
    isLoggedIn,
    authError,
    loginAsDemo,
    handleSignOut,
    handleLoginSuccess,
  };
}

export default useAuthSession;
