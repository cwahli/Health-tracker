import React, { useState } from 'react';
import { UserProfile } from '../types';
import { translations } from '../utils/translations';
import { Activity, Mail, Sparkles, AlertCircle, RefreshCw } from 'lucide-react';
import { auth, googleProvider } from '../firebase';
import { signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';

interface AuthScreenProps {
  onLogin: (profile: UserProfile) => void;
}

export default function AuthScreen({ onLogin }: AuthScreenProps) {
  const [email, setEmail] = useState('');
  const [nickname, setNickname] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [status, setStatus] = useState<'idle' | 'sending' | 'pending_verification'>('idle');
  const [language, setLanguage] = useState<'en' | 'fr' | 'zh' | 'id'>('en');

  const t = translations[language] || translations.en;

  const handleManualAuth = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setStatus('sending');
    // Simulate sending email verification link
    setTimeout(() => {
      setStatus('pending_verification');
    }, 1200);
  };

  const handleCompleteVerification = async () => {
    setStatus('sending');
    const normalizedEmail = email.trim().toLowerCase();
    const password = `HealthSync_${normalizedEmail.replace(/[^a-z0-9]/g, '')}_Secure2026!`;
    const resolvedNickname = nickname || normalizedEmail.split('@')[0];

    try {
      let userCredential;
      try {
        userCredential = await signInWithEmailAndPassword(auth, normalizedEmail, password);
      } catch (signInError: any) {
        if (
          signInError.code === 'auth/user-not-found' ||
          signInError.code === 'auth/invalid-credential' ||
          signInError.code === 'auth/wrong-password'
        ) {
          userCredential = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
        } else {
          throw signInError;
        }
      }

      const profile: UserProfile = {
        nickname: resolvedNickname,
        photoUrl: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=120",
        email: normalizedEmail,
        age: 30,
        ethnicity: 'Mixed',
        weight: 70,
        height: 170,
        language
      };
      onLogin(profile);
    } catch (err: any) {
      console.error("Auth Error:", err);
      // Fallback
      const profile: UserProfile = {
        nickname: resolvedNickname,
        photoUrl: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=120",
        email: normalizedEmail,
        age: 30,
        ethnicity: 'Mixed',
        weight: 70,
        height: 170,
        language
      };
      onLogin(profile);
    } finally {
      setStatus('idle');
    }
  };

  const handleDemoAccount = async () => {
    setStatus('sending');
    const demoEmail = 'john@mail.com';
    const password = `HealthSync_${demoEmail.replace(/[^a-z0-9]/g, '')}_Secure2026!`;

    try {
      let userCredential;
      try {
        userCredential = await signInWithEmailAndPassword(auth, demoEmail, password);
      } catch (signInError: any) {
        if (
          signInError.code === 'auth/user-not-found' ||
          signInError.code === 'auth/invalid-credential' ||
          signInError.code === 'auth/wrong-password'
        ) {
          userCredential = await createUserWithEmailAndPassword(auth, demoEmail, password);
        } else {
          throw signInError;
        }
      }

      const profile: UserProfile = {
        nickname: 'John doe',
        photoUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=120',
        email: demoEmail,
        age: 35,
        ethnicity: 'Caucasian',
        weight: 75,
        height: 178,
        language: 'en'
      };
      onLogin(profile);
    } catch (err: any) {
      console.error("Demo login Error:", err);
      const profile: UserProfile = {
        nickname: 'John doe',
        photoUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=120',
        email: demoEmail,
        age: 35,
        ethnicity: 'Caucasian',
        weight: 75,
        height: 178,
        language: 'en'
      };
      onLogin(profile);
    } finally {
      setStatus('idle');
    }
  };

  const handleThirdPartyLogin = async (provider: 'Google' | 'X') => {
    if (provider === 'Google') {
      try {
        setStatus('sending');
        const result = await signInWithPopup(auth, googleProvider);
        const user = result.user;
        const profile: UserProfile = {
          nickname: user.displayName || user.email?.split('@')[0] || 'User',
          photoUrl: user.photoURL || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&q=80&w=120',
          email: user.email || '',
          age: 35,
          ethnicity: 'Unknown',
          weight: 75,
          height: 178,
          language
        };
        onLogin(profile);
      } catch (err: any) {
        console.error("Google Sign-In Error:", err);
        alert("Google Sign-In failed: " + err.message);
      } finally {
        setStatus('idle');
      }
    } else {
      setStatus('sending');
      const xEmail = `user.x@healthsync.com`;
      const password = `HealthSync_userx_Secure2026!`;

      try {
        let userCredential;
        try {
          userCredential = await signInWithEmailAndPassword(auth, xEmail, password);
        } catch (signInError: any) {
          if (
            signInError.code === 'auth/user-not-found' ||
            signInError.code === 'auth/invalid-credential' ||
            signInError.code === 'auth/wrong-password'
          ) {
            userCredential = await createUserWithEmailAndPassword(auth, xEmail, password);
          } else {
            throw signInError;
          }
        }

        const profile: UserProfile = {
          nickname: 'X Practitioner',
          photoUrl: 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?auto=format&fit=crop&q=80&w=120',
          email: xEmail,
          age: 35,
          ethnicity: 'Caucasian',
          weight: 75,
          height: 178,
          language
        };
        onLogin(profile);
      } catch (err: any) {
        console.error("X login simulation error:", err);
        const profile: UserProfile = {
          nickname: 'X Practitioner',
          photoUrl: 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?auto=format&fit=crop&q=80&w=120',
          email: xEmail,
          age: 35,
          ethnicity: 'Caucasian',
          weight: 75,
          height: 178,
          language
        };
        onLogin(profile);
      } finally {
        setStatus('idle');
      }
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center p-4 transition-colors duration-200">
      <div id="auth-card" className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 rounded-[32px] p-8 shadow-xl relative overflow-hidden transition-all">
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
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 max-w-xs font-medium">
            {t.signInDesc}
          </p>
        </div>

        {/* Localized switch for demo purposes inside Auth page */}
        <div className="flex justify-end mb-4">
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as any)}
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
              <h3 className="font-semibold text-slate-900 dark:text-slate-200">Check your inbox</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs leading-relaxed">
                {t.verifyingEmail}
              </p>
            </div>
            <button
              id="auth-simulate-verify-btn"
              onClick={handleCompleteVerification}
              className="w-full mt-4 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold shadow-md active:scale-[0.98] transition-all"
            >
              {t.simulateVerify}
            </button>
          </div>
        ) : (
          /* Standard Sign In Form */
          <form onSubmit={handleManualAuth} className="space-y-4">
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">{t.emailLabel}</label>
                <input
                  id="auth-email-input"
                  type="email"
                  required
                  placeholder={t.enterEmail}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-xl px-3.5 py-3 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                />
              </div>

              {isSignUp && (
                <div className="animation-slide-down">
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">{t.nicknameLabel}</label>
                  <input
                    id="auth-nickname-input"
                    type="text"
                    required
                    placeholder={t.enterNickname}
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-xl px-3.5 py-3 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
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
                isSignUp ? 'Sign Up' : 'Continue with Email'
              )}
            </button>

            {/* Switch Mode Button */}
            <div className="text-center">
              <button
                id="auth-mode-switch-btn"
                type="button"
                onClick={() => setIsSignUp(!isSignUp)}
                className="text-xs text-slate-500 dark:text-slate-400 hover:text-indigo-600 transition-colors"
              >
                {isSignUp ? 'Already have an account? Sign In' : "Don't have an account? Sign Up"}
              </button>
            </div>

            {/* Divider lines */}
            <div className="relative my-4 flex items-center justify-center">
              <div className="border-t border-slate-200 dark:border-slate-800/60 w-full" />
              <span className="absolute bg-white dark:bg-slate-900 px-3 text-[10px] font-mono tracking-widest text-slate-400 uppercase">OR</span>
            </div>

            {/* Google / X Oauth Trigger Simulation */}
            <div className="grid grid-cols-2 gap-3">
              <button
                id="google-login-btn"
                type="button"
                onClick={() => handleThirdPartyLogin('Google')}
                className="py-2.5 px-3 border border-slate-200 dark:border-slate-700/60 hover:bg-slate-50 dark:hover:bg-slate-800/40 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 flex items-center justify-center gap-1.5 transition-all active:scale-[0.98]"
              >
                <span className="w-2.5 h-2.5 bg-red-500 rounded-full" /> {t.googleLogin}
              </button>
              <button
                id="x-login-btn"
                type="button"
                onClick={() => handleThirdPartyLogin('X')}
                className="py-2.5 px-3 border border-slate-200 dark:border-slate-700/60 hover:bg-slate-50 dark:hover:bg-slate-800/40 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 flex items-center justify-center gap-1.5 transition-all active:scale-[0.98]"
              >
                <span className="w-2.5 h-2.5 bg-slate-800 dark:bg-slate-300 rounded-full" /> {t.xLogin}
              </button>
            </div>

            {/* Quick Demo Login Option */}
            <button
              id="demo-login-btn"
              type="button"
              onClick={handleDemoAccount}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold tracking-wide uppercase shadow-lg shadow-indigo-600/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              <Sparkles className="w-4 h-4 animate-pulse" />
              {t.demoAccount}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
