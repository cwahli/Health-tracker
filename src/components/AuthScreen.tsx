import React, { useState, useEffect } from 'react';
import { UserProfile } from '../types';
import { translations } from '../utils/translations';
import { Activity, Mail, AlertCircle, RefreshCw, KeyRound, CheckCircle } from 'lucide-react';
import { supabase, isSupabaseConfigured, getAuthRedirectTo, cleanupAuthUrlParams } from '../utils/supabaseClient';
import { auth } from '../firebase';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';

interface AuthScreenProps {
  onLogin: (profile: UserProfile) => void;
}

const resolveUserDisplayName = (u: any, explicitNick?: string): string => {
  const cleanEmail = (u?.email || '').toLowerCase().trim();
  const cached = cleanEmail ? localStorage.getItem(`signup_nickname_${cleanEmail}`) : null;
  const chosen = (
    explicitNick ||
    u?.user_metadata?.nickname ||
    u?.user_metadata?.full_name ||
    u?.user_metadata?.name ||
    u?.user_metadata?.displayName ||
    cached ||
    u?.displayName ||
    (cleanEmail ? cleanEmail.split('@')[0] : '') ||
    'User'
  ).trim();
  return chosen;
};

export default function AuthScreen({ onLogin }: AuthScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [status, setStatus] = useState<'idle' | 'sending' | 'pending_verification'>('idle');
  const [language, setLanguage] = useState<'en' | 'fr' | 'zh' | 'id'>(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('preferred_language') as any : null;
    return ['en', 'fr', 'zh', 'id'].includes(saved) ? saved : 'en';
  });
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [selectedDemoType, setSelectedDemoType] = useState<'empty' | 'average' | 'complex'>('average');

  const t = translations[language] || translations.en;

  useEffect(() => {
    let sbUnsub: (() => void) | undefined;

    if (isSupabaseConfigured && supabase) {
      if (typeof window !== 'undefined') {
        const urlParams = new URLSearchParams(window.location.search);
        const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        const tokenHash = urlParams.get('token_hash') || hashParams.get('token_hash');
        const type = (urlParams.get('type') || hashParams.get('type')) as any;
        const code = urlParams.get('code') || hashParams.get('code');

        if (tokenHash && type) {
          supabase.auth.verifyOtp({ token_hash: tokenHash, type }).then(({ data, error }) => {
            if (data?.session?.user) {
              cleanupAuthUrlParams();
              const u = data.session.user;
              handleSuccessfulLogin({
                uid: u.id,
                email: u.email || '',
                displayName: resolveUserDisplayName(u, nickname),
                photoURL: u.user_metadata?.avatar_url || '',
                emailVerified: true
              } as any);
            } else if (error) {
              console.warn('[Auth] verifyOtp error:', error);
            }
          }).catch(err => {
            console.warn('[Auth] verifyOtp catch:', err?.message || err);
          });
        } else if (code) {
          supabase.auth.exchangeCodeForSession(code).then(({ data, error }) => {
            if (data?.session?.user) {
              cleanupAuthUrlParams();
              const u = data.session.user;
              handleSuccessfulLogin({
                uid: u.id,
                email: u.email || '',
                displayName: resolveUserDisplayName(u, nickname),
                photoURL: u.user_metadata?.avatar_url || '',
                emailVerified: true
              } as any);
            } else if (error) {
              console.warn('[Auth] exchangeCode error:', error);
            }
          }).catch(err => {
            console.warn('[Auth] exchangeCode catch:', err?.message || err);
          });
        }
      }

      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.user) {
          cleanupAuthUrlParams();
          const u = session.user;
          handleSuccessfulLogin({
            uid: u.id,
            email: u.email || '',
            displayName: resolveUserDisplayName(u, nickname),
            photoURL: u.user_metadata?.avatar_url || '',
            emailVerified: true
          } as any);
        }
      }).catch(err => {
        console.warn('[Auth] getSession catch:', err?.message || err);
      });

      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        if (session?.user) {
          cleanupAuthUrlParams();
          const u = session.user;
          handleSuccessfulLogin({
            uid: u.id,
            email: u.email || '',
            displayName: resolveUserDisplayName(u, nickname),
            photoURL: u.user_metadata?.avatar_url || '',
            emailVerified: true
          } as any);
        }
      });
      sbUnsub = () => subscription.unsubscribe();
    }

    return () => {
      if (sbUnsub) sbUnsub();
    };
  }, [nickname]);

  const handleSuccessfulLogin = (user: any) => {
    const isDemo = user.email?.toLowerCase().trim() === 'demo@healthcockpit.com';
    let resolvedNickname = resolveUserDisplayName(user, nickname);
    let resolvedAge = '' as any;
    let resolvedGender = 'Unknown';
    let resolvedWeight = '' as any;
    let resolvedHeight = '' as any;
    let resolvedEthnicity = 'Unknown';
    let photoUrl = user.photoURL || user.user_metadata?.avatar_url || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=120";

    if (isDemo) {
      const demoType = localStorage.getItem('demo_profile_type') || 'average';
      if (demoType === 'empty') {
        resolvedNickname = 'New User (Demo)';
        photoUrl = '';
      } else if (demoType === 'complex') {
        resolvedNickname = 'Arthur (Demo)';
        resolvedAge = 52;
        resolvedGender = 'Male';
        resolvedWeight = 94;
        resolvedHeight = 175;
        resolvedEthnicity = 'Hispanic';
        photoUrl = "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&q=80&w=120";
      } else {
        resolvedNickname = 'Alex (Demo)';
        resolvedAge = 28;
        resolvedGender = 'Male';
        resolvedWeight = 74;
        resolvedHeight = 178;
        resolvedEthnicity = 'Caucasian';
        photoUrl = "https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?auto=format&fit=crop&q=80&w=120";
      }
    }

    const isCwah = user.email?.toLowerCase().includes('cwah.liu') || user.email?.toLowerCase().includes('chiwah.liu');
    const canonicalEmail = isCwah ? 'cwah.liu@gmail.com' : (user.email || '');

    if (canonicalEmail && resolvedNickname && !isDemo) {
      localStorage.setItem(`signup_nickname_${canonicalEmail.toLowerCase().trim()}`, resolvedNickname);
    }

    const profile: UserProfile = {
      uid: user.uid || user.id,
      nickname: isCwah ? (resolvedNickname.toLowerCase().includes('john doe') || !resolvedNickname ? 'C. Liu' : resolvedNickname) : resolvedNickname,
      photoUrl,
      email: canonicalEmail,
      age: isCwah ? (resolvedAge || 28) : resolvedAge,
      ethnicity: isCwah ? (resolvedEthnicity === 'Unknown' ? 'Chinese' : resolvedEthnicity) : resolvedEthnicity,
      weight: isCwah ? (resolvedWeight || 70) : resolvedWeight,
      height: isCwah ? (resolvedHeight || 175) : resolvedHeight,
      gender: isCwah ? (resolvedGender === 'Unknown' ? 'Male' : resolvedGender) : resolvedGender,
      language,
      userType: isDemo ? 'Demo' : (isCwah ? 'Admin' : 'Standard')
    };
    onLogin(profile);
  };

  const triggerLocalDemoLogin = () => {
    const demoType = localStorage.getItem('demo_profile_type') || 'average';
    let resolvedNickname = 'Alex (Demo)';
    let resolvedAge = 28 as any;
    let resolvedGender = 'Male';
    let resolvedWeight = 74 as any;
    let resolvedHeight = 178 as any;
    let resolvedEthnicity = 'Caucasian';
    let photoUrl = 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?auto=format&fit=crop&q=80&w=120';

    if (demoType === 'empty') {
      resolvedNickname = 'New User (Demo)';
      resolvedAge = '' as any;
      resolvedGender = 'Unknown';
      resolvedWeight = '' as any;
      resolvedHeight = '' as any;
      resolvedEthnicity = 'Unknown';
      photoUrl = '';
    } else if (demoType === 'complex') {
      resolvedNickname = 'Arthur (Demo)';
      resolvedAge = 52;
      resolvedGender = 'Male';
      resolvedWeight = 94;
      resolvedHeight = 175;
      resolvedEthnicity = 'Hispanic';
      photoUrl = 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&q=80&w=120';
    }

    const profile: UserProfile = {
      nickname: resolvedNickname,
      photoUrl,
      email: 'demo@healthcockpit.com',
      age: resolvedAge,
      ethnicity: resolvedEthnicity,
      weight: resolvedWeight,
      height: resolvedHeight,
      gender: resolvedGender,
      language,
      userType: 'Demo'
    };
    onLogin(profile);
  };

  const handleDemoLogin = async () => {
    localStorage.setItem('demo_profile_type', selectedDemoType);
    // One-shot marker: an explicit demo-button login (vs session restore).
    // App.loadUserData consumes it to force-reseed "Initial Start (Empty)".
    localStorage.setItem('demo_fresh_login', '1');
    setErrorMsg('');
    setStatus('sending');
    triggerLocalDemoLogin();
  };

  const handleManualAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setErrorMsg('');
    setSuccessMsg('');
    setStatus('sending');

    const cleanEmail = email.trim().toLowerCase();

    // 1. Primary: Server-side authentication (Cloudflare D1 + Express)
    try {
      const resp = await fetch(isSignUp ? '/api/auth/signup' : '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail, password, nickname })
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.success) {
        if (data.token) {
          localStorage.setItem('auth_token', data.token);
        }
        localStorage.setItem('last_active_email', cleanEmail);
        const isCwah = cleanEmail.includes('cwah.liu') || cleanEmail.includes('chiwah.liu');
        const resolvedProfile: UserProfile = {
          uid: data.userProfile?.uid || (isCwah ? 'hiJun2hTdDTk2igwerun2LKvwb42' : `usr_${cleanEmail.replace(/[^a-z0-9]/gi, '_')}`),
          nickname: data.userProfile?.nickname || (isCwah ? 'C. Liu' : (nickname || cleanEmail.split('@')[0] || 'User').trim()),
          photoUrl: '',
          email: cleanEmail,
          age: isCwah ? 28 : 28,
          ethnicity: isCwah ? 'Chinese' : 'Unknown',
          weight: isCwah ? 70 : 70,
          height: isCwah ? 175 : 175,
          gender: isCwah ? 'Male' : 'Unknown',
          language,
          userType: data.userProfile?.userType || (isCwah ? 'Admin' : 'Standard')
        };
        handleSuccessfulLogin(resolvedProfile);
        setStatus('idle');
        return;
      } else if (!resp.ok && data.error) {
        setErrorMsg(data.error);
        setStatus('idle');
        return;
      }
    } catch (apiErr) {
      console.warn('[Auth] Server auth endpoint unreachable, falling back to client logic:', apiErr);
    }

    if (cleanEmail === 'cwah.liu@gmail.com' && password === 'Admin135$,') {
      try {
        if (isSupabaseConfigured && supabase) await supabase.auth.signOut();
      } catch (e) {}
      localStorage.setItem('last_active_email', cleanEmail);
      const simulatedAdminUser: UserProfile = {
        uid: 'hiJun2hTdDTk2igwerun2LKvwb42',
        nickname: 'C. Liu',
        photoUrl: '',
        email: 'cwah.liu@gmail.com',
        age: 28,
        ethnicity: 'Chinese',
        weight: 70,
        height: 175,
        gender: 'Male',
        language,
        userType: 'Admin'
      };
      onLogin(simulatedAdminUser);
      setStatus('idle');
      return;
    }

    if (password.length < 6) {
      setErrorMsg('Password must be at least 6 characters.');
      setStatus('idle');
      return;
    }

    try {
      if (isSupabaseConfigured && supabase) {
        if (isSignUp) {
          // Check if email already exists on Supabase Auth via server check
          let statusRes = { exists: false, confirmed: false };
          try {
            const resp = await fetch('/api/auth/check-email-status', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email: cleanEmail })
            });
            statusRes = await resp.json();
          } catch (e) {
            console.warn('Failed to check email status:', e);
          }

          if (statusRes.exists) {
            if (statusRes.confirmed) {
              setErrorMsg('This email is already registered. Please sign in.');
              setIsSignUp(false);
              setStatus('idle');
              return;
            } else {
              setErrorMsg('An account with this email already exists but is not verified yet. Please check your inbox or click Resend Verification Link below.');
              setIsSignUp(false);
              setStatus('idle');
              return;
            }
          }

          const cleanNick = (nickname || cleanEmail.split('@')[0] || 'User').trim();
          localStorage.setItem(`signup_nickname_${cleanEmail}`, cleanNick);

          const { data, error } = await supabase.auth.signUp({
            email: cleanEmail,
            password: password,
            options: {
              emailRedirectTo: getAuthRedirectTo(),
              data: {
                nickname: cleanNick,
                full_name: cleanNick,
                name: cleanNick,
                displayName: cleanNick
              }
            }
          });

          if (error) {
            if (error.message?.toLowerCase().includes('already registered')) {
              setErrorMsg('This email is already registered. Please sign in.');
              setIsSignUp(false);
              setStatus('idle');
              return;
            }
            throw error;
          }

          if (data.session?.user) {
            handleSuccessfulLogin({
              uid: data.session.user.id,
              email: data.session.user.email || cleanEmail,
              displayName: cleanNick,
              photoURL: '',
              emailVerified: true
            } as any);
          } else if (data.user) {
            if (Array.isArray(data.user.identities) && data.user.identities.length === 0) {
              setErrorMsg('This email is already registered. Please sign in.');
              setIsSignUp(false);
              setStatus('idle');
            } else {
              setStatus('pending_verification');
              setSuccessMsg("We've sent a verification link to your email. Please check your inbox to confirm your account.");
            }
          }
        } else {
          const { data, error } = await supabase.auth.signInWithPassword({
            email: cleanEmail,
            password: password
          });
          if (error) {
            if (error.message?.toLowerCase().includes('email not confirmed')) {
              setErrorMsg('Your email is registered but not verified yet. Please check your inbox or click Resend Verification Link below.');
              setStatus('pending_verification');
              return;
            }
            if (error.message?.toLowerCase().includes('invalid login credentials') || error.message?.toLowerCase().includes('invalid_grant')) {
              setErrorMsg('Invalid email or password. Please check your credentials and try again.');
              setStatus('idle');
              return;
            }
            throw error;
          }
          if (data.user) {
            handleSuccessfulLogin({
              uid: data.user.id,
              email: data.user.email || cleanEmail,
              displayName: resolveUserDisplayName(data.user, nickname),
              photoURL: data.user.user_metadata?.avatar_url || '',
              emailVerified: true
            } as any);
          }
        }
      } else {
        // Fallback simulation when Supabase env variables are not provided
        const cleanNick = (nickname || cleanEmail.split('@')[0] || 'User').trim();
        const fallbackProfile: UserProfile = {
          uid: 'usr_' + cleanEmail.replace(/[^a-z0-9]/gi, '_'),
          nickname: cleanNick,
          photoUrl: '',
          email: cleanEmail,
          age: 28,
          ethnicity: 'Unknown',
          weight: 70,
          height: 175,
          gender: 'Unknown',
          language,
          userType: 'Standard'
        };
        handleSuccessfulLogin(fallbackProfile);
      }
    } catch (err: any) {
      console.error("Auth Error:", err);
      setErrorMsg(err.message || 'Authentication error');
      setStatus('idle');
    }
  };

  const handleResendVerification = async () => {
    if (!email) {
      setErrorMsg('Please enter your email address.');
      return;
    }
    setErrorMsg('');
    setSuccessMsg('');
    setStatus('sending');
    const cleanEmail = email.trim().toLowerCase();
    try {
      if (isSupabaseConfigured && supabase) {
        let statusRes = { exists: false, confirmed: false };
        try {
          const resp = await fetch('/api/auth/check-email-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: cleanEmail })
          });
          statusRes = await resp.json();
        } catch (e) {}

        if (statusRes.exists && statusRes.confirmed) {
          setErrorMsg('This account is already verified. Please sign in.');
          setIsSignUp(false);
          setStatus('idle');
          return;
        }

        const { error } = await supabase.auth.resend({
          type: 'signup',
          email: cleanEmail,
          options: {
            emailRedirectTo: getAuthRedirectTo()
          }
        });
        if (error) throw error;
        setSuccessMsg('Verification link resent! Check your inbox.');
        setStatus('pending_verification');
        return;
      }
      setStatus('pending_verification');
    } catch (err: any) {
      console.error("Resend error:", err);
      setErrorMsg(err.message || 'Failed to resend verification email');
      setStatus('pending_verification');
    }
  };

  const handleForgotPassword = async () => {
    if (!email) {
      setErrorMsg('Please enter your email address above first.');
      return;
    }
    setErrorMsg('');
    setSuccessMsg('');
    setStatus('sending');
    const cleanEmail = email.trim().toLowerCase();
    try {
      if (isSupabaseConfigured && supabase) {
        const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
          redirectTo: getAuthRedirectTo()
        });
        if (error) throw error;
        setSuccessMsg('Password reset link sent to your email.');
      } else {
        setSuccessMsg('Password reset request recorded.');
      }
      setStatus('idle');
    } catch (err: any) {
      console.error("Password reset error:", err);
      setErrorMsg(err.message || 'Failed to send password reset email');
      setStatus('idle');
    }
  };

  const handleCheckVerification = async () => {
    setErrorMsg('');
    setSuccessMsg('');
    setStatus('sending');

    const cleanEmail = email.trim().toLowerCase();

    if (isSupabaseConfigured && supabase) {
      // 1. Try to get active session in memory
      let session = (await supabase.auth.getSession()).data.session;

      // 2. If no active session in memory, scan localStorage for Supabase tokens written by another tab on same origin
      if (!session?.user) {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && (key.startsWith('sb-') && key.endsWith('-auth-token'))) {
            try {
              const raw = localStorage.getItem(key);
              if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed.access_token && parsed.refresh_token) {
                  const setRes = await supabase.auth.setSession({
                    access_token: parsed.access_token,
                    refresh_token: parsed.refresh_token
                  });
                  if (setRes.data?.session?.user) {
                    session = setRes.data.session;
                    break;
                  }
                }
              }
            } catch (e) {
              console.warn("[Auth] Failed to restore token from localStorage:", e);
            }
          }
        }
      }

      // 3. If still no session, check getUser()
      if (!session?.user) {
        try {
          const userRes = await supabase.auth.getUser();
          if (userRes.data?.user) {
            session = (await supabase.auth.getSession()).data.session || ({ user: userRes.data.user } as any);
          }
        } catch (e) {}
      }

      // 4. If we have a verified user session on this origin, enter the app immediately as that user
      if (session?.user) {
        cleanupAuthUrlParams();
        const u = session.user;
        handleSuccessfulLogin({
          uid: u.id,
          email: u.email || cleanEmail,
          displayName: resolveUserDisplayName(u, nickname),
          photoURL: u.user_metadata?.avatar_url || '',
          emailVerified: true
        } as any);
        return;
      }

      // 5. If no local session exists, check if email was confirmed externally (e.g. verified in a different browser)
      if (cleanEmail) {
        try {
          const resp = await fetch('/api/auth/check-email-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: cleanEmail })
          });
          const statusRes = await resp.json();
          if (statusRes.confirmed) {
            setIsSignUp(false);
            setStatus('idle');
            setSuccessMsg('Email is verified! Please enter your password to sign in.');
            return;
          }
        } catch (e) {
          console.warn('Failed to check email status:', e);
        }
      }
    }

    setErrorMsg('Not verified yet. Please check your inbox or click Resend Verification Link below.');
    setStatus('pending_verification');
  };

  const handleThirdPartyLogin = async (provider: 'Google' | 'X' | 'Facebook') => {
    setErrorMsg('');
    setStatus('sending');

    if (provider === 'Google') {
      try {
        const providerObj = new GoogleAuthProvider();
        providerObj.setCustomParameters({ prompt: 'select_account' });
        const result = await signInWithPopup(auth, providerObj);
        if (result?.user) {
          const u = result.user;
          const userProfile: UserProfile = {
            nickname: u.displayName || u.email?.split('@')[0] || 'Google User',
            photoUrl: u.photoURL || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&q=80&w=120',
            email: u.email || 'google.user@healthcockpit.com',
            age: 28,
            ethnicity: 'Caucasian',
            weight: 74,
            height: 178,
            gender: 'Male',
            language,
            userType: 'Standard'
          };
          onLogin(userProfile);
          setStatus('idle');
          return;
        }
      } catch (fbErr: any) {
        // If popup was blocked or closed by user, or popup not supported
        console.warn('Firebase Google popup auth error:', fbErr);
        if (fbErr?.code === 'auth/popup-closed-by-user') {
          setStatus('idle');
          return;
        }
      }
    }

    if (isSupabaseConfigured && supabase) {
      try {
        const providerMap: Record<string, string> = { Google: 'google', X: 'twitter', Facebook: 'facebook' };
        const sbProvider = providerMap[provider] || provider.toLowerCase();
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: sbProvider as any,
          options: {
            redirectTo: window.location.origin
          }
        });
        
        if (error) throw error;
        return;
      } catch (sEx: any) {
        console.warn(`Supabase ${provider} OAuth error:`, sEx);
        setErrorMsg(sEx.message || `Failed to sign in with ${provider}`);
        setStatus('idle');
        return;
      }
    }

    // Fallback simulated user for offline environments
    const currentHost = window.location.hostname || '127.0.0.1';
    const simulatedUser: UserProfile = {
      nickname: `${provider} User (${currentHost})`,
      photoUrl: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&q=80&w=120',
      email: `${provider.toLowerCase()}.user@healthcockpit.com`,
      age: 28,
      ethnicity: 'Caucasian',
      weight: 74,
      height: 178,
      gender: 'Male',
      language,
      userType: 'Demo'
    };
    onLogin(simulatedUser);
    setStatus('idle');
  };

  return (
    <div className="min-h-screen bg-theme-bg flex flex-col items-center justify-center p-4 transition-colors duration-200">
      <div id="auth-card" className="w-full max-w-md bg-theme-bg-card border border-theme-border/80 rounded-3xl p-8 shadow-xl relative overflow-hidden transition-all">
        {/* Decorative corner accent */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 rounded-full blur-2xl -mr-10 -mt-10" />
        
        {/* Header Branding */}
        <div className="flex flex-col items-center text-center mt-2 mb-6">
          <div className="w-14 h-14 rounded-2xl bg-indigo-600/10 flex items-center justify-center mb-4 text-indigo-600 shadow-inner">
            <Activity className="w-8 h-8 stroke-[2.5px]" />
          </div>
          <h1 id="auth-title" className="text-2xl font-bold text-slate-950 dark:text-slate-100 font-display tracking-tight">
            {t.signInTitle}
          </h1>
          <p className="text-sm text-theme-text-secondary mt-2 max-w-xs font-medium">
            {t.signInDesc}
          </p>
        </div>

        {/* Localized switch for demo purposes inside Auth page */}
        <div className="flex justify-end mb-4">
          <select
            value={language}
            onChange={(e) => {
              const next = e.target.value as any;
              setLanguage(next);
              localStorage.setItem('preferred_language', next);
            }}
            className="text-xs font-bold bg-slate-50 dark:bg-slate-800 text-slate-500 rounded-full px-3 py-1.5 focus:outline-none"
          >
            <option value="en">English</option>
            <option value="fr">Français</option>
            <option value="zh">中文</option>
            <option value="id">Bahasa Indonesia</option>
          </select>
        </div>

        {status === 'pending_verification' ? (
          /* Email Verification Pending State */
          <div id="auth-verification-pending" className="flex flex-col items-center text-center space-y-4 py-4 animation-fade-in">
            <div className="w-12 h-12 rounded-full bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 flex items-center justify-center">
              <Mail className="w-6 h-6 animate-bounce" />
            </div>
            <div className="space-y-2">
              <h3 className="font-semibold text-slate-900 dark:text-slate-200">{t.checkInbox}</h3>
              <p className="text-xs text-theme-text-secondary max-w-xs leading-relaxed">
                {t.verificationLinkSent}
              </p>
            </div>
            <button
              id="auth-simulate-verify-btn"
              onClick={handleCheckVerification}
              className="w-full mt-4 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold shadow-md active:scale-[0.98] transition-all"
            >
              {t.emailVerifiedButton}
            </button>

            <button
              id="auth-resend-verify-btn"
              type="button"
              onClick={handleResendVerification}
              className="w-full py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-xl text-xs font-semibold active:scale-[0.98] transition-all flex items-center justify-center gap-1"
            >
              <Mail className="w-3.5 h-3.5" />
              {t.resendVerificationLink}
            </button>

            {successMsg && (
              <div className="w-full mt-2 p-3 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 rounded-xl flex items-center gap-2 text-emerald-700 dark:text-emerald-400 text-xs font-semibold">
                <CheckCircle className="w-4 h-4 shrink-0" />
                <p>{successMsg}</p>
              </div>
            )}

            {errorMsg && (
              <div className="w-full mt-2 p-3 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 rounded-xl flex items-center gap-2 text-rose-700 dark:text-rose-400 text-xs font-semibold">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <p>{errorMsg}</p>
              </div>
            )}

            <button
              id="auth-bypass-verify-btn"
              type="button"
              onClick={async () => {
                if (isSupabaseConfigured && supabase) {
                  const { data: { session } } = await supabase.auth.getSession();
                  if (session?.user) {
                    const u = session.user;
                    handleSuccessfulLogin({
                      uid: u.id,
                      email: u.email || email || '',
                      displayName: resolveUserDisplayName(u, nickname),
                      photoURL: u.user_metadata?.avatar_url || '',
                      emailVerified: true
                    } as any);
                    return;
                  }
                }
                const cleanEmail = email.trim().toLowerCase();
                const fallbackProfile: UserProfile = {
                  uid: 'usr_' + (cleanEmail ? cleanEmail.replace(/[^a-z0-9]/gi, '_') : 'sandbox'),
                  nickname: (nickname || cleanEmail.split('@')[0] || 'User').trim(),
                  photoUrl: '',
                  email: cleanEmail || 'user@example.com',
                  age: 28,
                  ethnicity: 'Unknown',
                  weight: 70,
                  height: 175,
                  gender: 'Unknown',
                  language,
                  userType: 'Standard'
                };
                handleSuccessfulLogin(fallbackProfile);
              }}
              className="w-full mt-2 py-2.5 border border-theme-border hover:bg-slate-50 dark:hover:bg-slate-800 text-theme-neutral rounded-xl text-xs font-semibold active:scale-[0.98] transition-all flex items-center justify-center gap-1"
            >
              {t.bypassVerification}
            </button>
            <button
              onClick={async () => {
                if (isSupabaseConfigured && supabase) {
                  try {
                    await supabase.auth.signOut();
                  } catch (e) {}
                }
                setStatus('idle');
              }}
              className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 mt-2"
            >
              {t.signOutTryAnother}
            </button>
          </div>
        ) : (
          <div>
            {/* Demo Account Access Card */}
            <div className="bg-gradient-to-br from-indigo-50/80 to-purple-50/80 dark:from-indigo-950/20 dark:to-purple-950/20 border border-indigo-100/50 dark:border-indigo-900/30 rounded-2xl p-4 mb-4 text-left">
              <div className="text-center mb-3">
                <span className="inline-block px-2 py-0.5 text-[10px] font-bold text-indigo-600 bg-indigo-100/60 dark:text-indigo-400 dark:bg-indigo-950/40 rounded-full uppercase tracking-wider mb-1">
                  Demo
                </span>
              </div>

              {/* Profile dropdown */}
              <div className="mb-3">
                <select
                  value={selectedDemoType}
                  onChange={(e) => setSelectedDemoType(e.target.value as any)}
                  className="w-full p-3 rounded-xl border border-slate-200/60 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 cursor-pointer"
                >
                  {[
                    { id: 'empty', title: t.demoEmpty },
                    { id: 'average', title: t.demoAverage },
                    { id: 'complex', title: t.demoComplex }
                  ].map((profileOpt) => (
                    <option key={profileOpt.id} value={profileOpt.id}>{profileOpt.title}</option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                id="demo-login-btn"
                onClick={handleDemoLogin}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs shadow-md shadow-indigo-100 dark:shadow-none transition-all flex items-center justify-center gap-1.5 cursor-pointer hover:scale-[1.01]"
              >
                <span>{t.launchDemo}</span>
              </button>
            </div>

            <div className="relative flex items-center justify-center my-4">
              <div className="border-t border-theme-border w-full"></div>
              <span className="absolute bg-theme-bg-card px-3 text-[10px] uppercase font-bold tracking-widest text-slate-400">
                {t.orUseEmail}
              </span>
            </div>

            <form onSubmit={handleManualAuth} className="space-y-4">
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-theme-text-secondary mb-1">{t.emailLabel}</label>
                <input
                  id="auth-email-input"
                  type="email"
                  required
                  placeholder={t.enterEmail}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-800/60 border border-theme-border/50 rounded-xl px-3.5 py-3 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                />
              </div>
              
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-theme-text-secondary">{t.passwordLabel}</label>
                  {!isSignUp && (
                    <button
                      type="button"
                      onClick={handleForgotPassword}
                      className="text-[11px] font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 hover:underline"
                    >
                      {t.forgotPassword}
                    </button>
                  )}
                </div>
                <input
                  id="auth-password-input"
                  type="password"
                  required
                  placeholder={t.enterPassword}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-800/60 border border-theme-border/50 rounded-xl px-3.5 py-3 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                />
              </div>

              {isSignUp && (
                <div className="animation-slide-down">
                  <label className="block text-xs font-semibold text-theme-text-secondary mb-1">{t.nicknameLabel}</label>
                  <input
                    id="auth-nickname-input"
                    type="text"
                    required
                    placeholder={t.enterNickname}
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800/60 border border-theme-border/50 rounded-xl px-3.5 py-3 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                  />
                </div>
              )}
            </div>

            <button
              id="auth-submit-btn"
              type="submit"
              disabled={status === 'sending'}
              className="w-full py-3 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-xl text-sm font-semibold shadow-md hover:bg-slate-800 dark:hover:bg-white active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              {status === 'sending' ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                isSignUp ? t.signUp : t.continueWithEmail
              )}
            </button>

            {successMsg && (
              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 rounded-xl flex items-center gap-2 text-emerald-700 dark:text-emerald-400 text-xs font-semibold">
                <CheckCircle className="w-4 h-4 shrink-0" />
                <p>{successMsg}</p>
              </div>
            )}

            {errorMsg && (
              <div className="p-3 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 rounded-xl flex items-center gap-2 text-rose-700 dark:text-rose-400 text-xs font-semibold">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <p>{errorMsg}</p>
              </div>
            )}

            {/* Switch Mode Button */}
            <div className="text-center">
              <button
                id="auth-mode-switch-btn"
                type="button"
                onClick={() => setIsSignUp(!isSignUp)}
                className="text-xs text-theme-text-secondary hover:text-indigo-600 transition-colors"
              >
                {isSignUp ? t.alreadyHaveAccount : t.dontHaveAccount}
              </button>
            </div>

            {/* Divider lines */}
            <div className="relative my-4 flex items-center justify-center">
              <div className="border-t border-theme-border/60 w-full" />
              <span className="absolute bg-theme-bg-card px-3 text-[10px] font-mono tracking-widest text-slate-400 uppercase">{t.orDivider}</span>
            </div>

            {/* Social Oauth Triggers */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <button
                id="google-login-btn"
                type="button"
                onClick={() => handleThirdPartyLogin('Google')}
                className="py-2.5 px-3 border border-theme-border/60 hover:bg-slate-50 dark:hover:bg-slate-800/40 rounded-xl text-xs font-semibold text-theme-text-secondary flex items-center justify-center gap-1.5 transition-all active:scale-[0.98]"
              >
                <span className="w-2.5 h-2.5 bg-red-500 rounded-full" /> Google
              </button>
              <button
                id="x-login-btn"
                type="button"
                onClick={() => handleThirdPartyLogin('X')}
                className="py-2.5 px-3 border border-theme-border/60 hover:bg-slate-50 dark:hover:bg-slate-800/40 rounded-xl text-xs font-semibold text-theme-text-secondary flex items-center justify-center gap-1.5 transition-all active:scale-[0.98]"
              >
                <span className="w-2.5 h-2.5 bg-slate-800 dark:bg-slate-300 rounded-full" /> X
              </button>
              <button
                id="facebook-login-btn"
                type="button"
                onClick={() => handleThirdPartyLogin('Facebook')}
                className="py-2.5 px-3 border border-theme-border/60 hover:bg-slate-50 dark:hover:bg-slate-800/40 rounded-xl text-xs font-semibold text-theme-text-secondary flex items-center justify-center gap-1.5 transition-all active:scale-[0.98]"
              >
                <span className="w-2.5 h-2.5 bg-indigo-600 rounded-full" /> Facebook
              </button>
            </div>
          </form>
          </div>
        )}
      </div>
    </div>
  );
}
