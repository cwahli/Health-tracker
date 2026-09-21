import { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signOut as fbSignOut } from 'firebase/auth';
import { auth } from '../firebase';
import { supabase, isSupabaseConfigured, cleanupAuthUrlParams } from '../utils/supabaseClient';
import { clearCachedAppData } from '../utils/storageUtils';
import { JobStore } from '../jobs/JobStore';
import { UserProfile } from '../types';

/**
 * Q-11.2 — auth & session, moved out of `src/App.tsx` (move-only).
 *
 * Owns: the bootstrap effect (Supabase session restore + Firebase `onAuthStateChanged` +
 * timeout fallback), `getEffectiveUser`, `handleLogin` and `handleSignOut` with its cache
 * clearing. Bodies are unchanged; only the call names differ, and each one is documented
 * below so nothing silently changes meaning.
 *
 * Deliberately *not* moved yet: `isAuthChecking` state (the data loader `loadUserData`
 * writes it in two places and stays in `App.tsx` until Q-11.5) and `loadUserData` itself
 * (passed in as `onUser`). A previous attempt at this file deleted the whole auth chain
 * instead of moving it, which is why `scripts/assert-parity.mjs` now guards the entry
 * points by name.
 */
export interface UseAuthSessionOptions {
  /** Current profile, read fresh on every render (sign-out needs the email to clear caches). */
  profile: UserProfile;
  /** Auth-screen gate flag, owned by App.tsx until the data loader moves. */
  isAuthChecking: boolean;
  setIsAuthChecking: (value: boolean) => void;
  /** Marks the initial data load as finished (`setIsInitialDataLoading(false)`). */
  onAuthResolved: () => void;
  /** The app's existing data loader, called with the signed-in identity. */
  onUser: (
    uid: string,
    email: string,
    displayName?: string,
    photoURL?: string,
    language?: string,
  ) => Promise<void> | void;
  /** Clears every session-scoped React state (profile, logs, biomarkers, actions, report, syncState). */
  clearSessionState: () => void;
  /** Applies a profile produced by login (`setProfile` + `setSyncState('local')`). */
  applyLoginProfile: (profile: UserProfile) => void;
}

export interface UseAuthSessionReturn {
  getEffectiveUser: () => { uid: string; email: string; displayName: string } | null;
  handleLogin: (loggedProfile: UserProfile) => Promise<void>;
  handleSignOut: () => Promise<void>;
}

export function useAuthSession(options: UseAuthSessionOptions): UseAuthSessionReturn {
  const { profile, isAuthChecking, setIsAuthChecking, onAuthResolved, onUser, clearSessionState, applyLoginProfile } = options;

  // The bootstrap effect must subscribe once and still see fresh callbacks, so the
  // options it uses are read through refs instead of being effect dependencies.
  const onUserRef = useRef(onUser);
  const onAuthResolvedRef = useRef(onAuthResolved);
  const clearSessionStateRef = useRef(clearSessionState);
  onUserRef.current = onUser;
  onAuthResolvedRef.current = onAuthResolved;
  clearSessionStateRef.current = clearSessionState;

  useEffect(() => {
    let unsubs: (() => void)[] = [];
    let localRestoreTimer: ReturnType<typeof setTimeout> | null = null;

    // Durable local session. `last_active_email` is written on every successful
    // login (Firebase, D1 email/password, demo) and removed only by
    // `handleSignOut`, so its presence means "the user did not explicitly sign
    // out". Used as the fallback when Firebase reports no persisted session, so
    // closing and reopening the app does not bounce them back to the gate.
    const restoreLocalSession = async (): Promise<boolean> => {
      const lastEmail = (localStorage.getItem('last_active_email') || '').toLowerCase().trim();
      if (!lastEmail) return false;
      const uid = 'usr_' + lastEmail.replace(/[^a-z0-9]/gi, '_');
      await onUserRef.current(uid, lastEmail);
      return true;
    };

    const scheduleLocalRestore = () => {
      if (localRestoreTimer) return;
      localRestoreTimer = setTimeout(async () => {
        localRestoreTimer = null;
        if (auth.currentUser) return;
        clearTimeout(fallbackTimeout);
        try {
          const restored = await restoreLocalSession();
          if (!restored) {
            setIsAuthChecking(false);
            onAuthResolvedRef.current();
          }
        } catch (err) {
          console.error('[Auth] Local session restore failed:', err);
          setIsAuthChecking(false);
          onAuthResolvedRef.current();
        }
      }, 500);
    };

    const fallbackTimeout = setTimeout(() => {
      console.warn("Auth check timed out.");
      if (!localRestoreTimer && !auth.currentUser) {
        restoreLocalSession()
          .catch(() => {})
          .finally(() => {
            setIsAuthChecking(false);
            onAuthResolvedRef.current();
          });
      } else {
        setIsAuthChecking(false);
        onAuthResolvedRef.current();
      }
    }, 6000);

    const resolveSbNick = (u: any) => {
      const uEmail = (u?.email || '').toLowerCase().trim();
      const cached = uEmail ? localStorage.getItem(`signup_nickname_${uEmail}`) : null;
      return (
        u?.user_metadata?.nickname ||
        u?.user_metadata?.full_name ||
        u?.user_metadata?.name ||
        u?.user_metadata?.displayName ||
        cached ||
        (uEmail ? uEmail.split('@')[0] : '') ||
        'User'
      ).trim();
    };

    const initializeAuthAndData = async () => {
      // Step A: Process Supabase Auth callback params and check Supabase session
      if (isSupabaseConfigured && supabase) {
        if (typeof window !== 'undefined') {
          const urlParams = new URLSearchParams(window.location.search);
          const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
          const tokenHash = urlParams.get('token_hash') || hashParams.get('token_hash');
          const type = (urlParams.get('type') || hashParams.get('type')) as any;
          const code = urlParams.get('code') || hashParams.get('code');

          if (tokenHash && type) {
            try {
              await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
            } catch (err) {
              console.warn("[Auth] verifyOtp error:", err);
            }
            cleanupAuthUrlParams();
          } else if (code) {
            try {
              await supabase.auth.exchangeCodeForSession(code);
            } catch (err) {
              console.warn("[Auth] exchangeCodeForSession error:", err);
            }
            cleanupAuthUrlParams();
          }
        }

        // Listen for Supabase Auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
          clearTimeout(fallbackTimeout);
          if (session?.user) {
            cleanupAuthUrlParams();
            const u = session.user;
            await onUserRef.current(
              u.id,
              u.email || '',
              resolveSbNick(u),
              u.user_metadata?.avatar_url || ''
            );
          } else if (event === 'SIGNED_OUT' || !session) {
            clearSessionStateRef.current();
            setIsAuthChecking(false);
            onAuthResolvedRef.current();
          }
        });
        unsubs.push(() => subscription.unsubscribe());

        // Check active Supabase session
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user) {
            cleanupAuthUrlParams();
            const u = session.user;
            await onUserRef.current(
              u.id,
              u.email || '',
              resolveSbNick(u),
              u.user_metadata?.avatar_url || ''
            );
            clearTimeout(fallbackTimeout);
            return;
          }
        } catch (sbErr) {
          console.warn("[Auth] getSession error:", sbErr);
        }
      }

      // Listen for Firebase Auth events (supports Google Login via Firebase)
      const unsubscribeFb = onAuthStateChanged(auth, async (user) => {
        if (user) {
          clearTimeout(fallbackTimeout);
          if (localRestoreTimer) {
            clearTimeout(localRestoreTimer);
            localRestoreTimer = null;
          }
          try {
            await onUserRef.current(
              user.uid,
              user.email || '',
              user.displayName || '',
              user.photoURL || ''
            );
          } catch (err) {
            console.error('[Auth] Firebase session restore failed, using local session:', err);
            await restoreLocalSession();
          }
        } else if (!isSupabaseConfigured || !supabase) {
          // No persisted Firebase session. Fall back to the local session so a
          // restart keeps the user signed in unless they explicitly signed out.
          scheduleLocalRestore();
        }
      });
      unsubs.push(unsubscribeFb);

      if (!isSupabaseConfigured || !supabase) {
        // No Supabase source of truth exists in this build. When a local session
        // marker is present, keep the checking gate up until the listener above
        // resolves it, instead of flashing the sign-in screen.
        if (!localStorage.getItem('last_active_email')) {
          clearTimeout(fallbackTimeout);
          setIsAuthChecking(false);
        }
      }
      // When Supabase IS configured, do NOT force isAuthChecking to false here.
      // The initial getSession() call above can race with Supabase's own
      // session-restore-from-storage step and return an empty session before
      // the real one loads, which was causing the auth screen to flash
      // on-screen for a moment before flipping back to the logged-in view.
      // The onAuthStateChange listener registered above always fires once on
      // subscribe with the definitive state (either a session, which calls
      // loadUserData and sets isAuthChecking false itself, or no session,
      // which hits the "SIGNED_OUT || !session" branch and sets it false).
      // The 10s fallbackTimeout above remains as a safety net in case that
      // listener never fires for some reason.
    };

    initializeAuthAndData().catch(err => {
      console.error("[Auth] Initial auth setup failed:", err);
      setIsAuthChecking(false);
    });

    return () => {
      clearTimeout(fallbackTimeout);
      if (localRestoreTimer) clearTimeout(localRestoreTimer);
      unsubs.forEach(u => u());
    };
  }, []);

  const getEffectiveUser = () => {
    if (profile?.email) {
      const cleanEmail = profile.email.toLowerCase().trim();
      const uid = profile.uid || ('usr_' + cleanEmail.replace(/[^a-z0-9]/gi, '_'));
      return {
        uid,
        email: profile.email,
        displayName: profile.nickname || 'User'
      };
    }
    if (auth.currentUser) {
      return {
        uid: auth.currentUser.uid,
        email: auth.currentUser.email || '',
        displayName: auth.currentUser.displayName || ''
      };
    }
    return null;
  };

  // Sync Check on Login / Fetch user record if existing on server
  const handleLogin = async (loggedProfile: UserProfile) => {
    if (loggedProfile.language) {
      localStorage.setItem('preferred_language', loggedProfile.language);
    }
    applyLoginProfile(loggedProfile); // was: setProfile(loggedProfile) + setSyncState('local')
    if (loggedProfile.email) {
      localStorage.setItem('last_active_email', loggedProfile.email.toLowerCase().trim());
    }
    setIsAuthChecking(false);
    onAuthResolved(); // was: setIsInitialDataLoading(false)
    if (loggedProfile.email) {
      await onUser(
        loggedProfile.uid || 'user',
        loggedProfile.email,
        loggedProfile.nickname,
        loggedProfile.photoUrl,
        loggedProfile.language
      );
    }
  };

  const handleSignOut = async () => {
    try {
      // Clear all React state immediately so no glimpse of user data after sign-out
      clearSessionState();
      localStorage.removeItem('last_active_email');
      localStorage.removeItem('demo_profile_type');
      localStorage.removeItem('demo_fresh_login');
      sessionStorage.clear();
      // Clear IndexedDB + localStorage app cache so the next login starts clean
      // instead of resurrecting this user's stale state.
      try {
        await clearCachedAppData(profile?.email);
      } catch (e) {
        console.warn('Failed to clear cached app data on sign-out:', e);
      }
      JobStore.resetAllJobs();

      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && (key.includes('supabase.auth.token') || key.startsWith('sb-') || key.includes('auth-token'))) {
          localStorage.removeItem(key);
        }
      }

      if (isSupabaseConfigured && supabase) {
        try {
          await supabase.auth.signOut();
        } catch (sbErr) {
          console.warn("Failed to sign out from Supabase:", sbErr);
        }
      }
      await fbSignOut(auth);
    } catch (e) {
      console.error("Failed to sign out:", e);
    } finally {
      clearSessionState();
      setIsAuthChecking(false);
    }
  };

  // Kept for signature parity with the pre-move code: the auth gate reads this flag.
  void isAuthChecking;

  return { getEffectiveUser, handleLogin, handleSignOut };
}
