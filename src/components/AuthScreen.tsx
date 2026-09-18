import React, { useState } from 'react';
import { Activity, Sparkles, Mail, Lock, User, AlertCircle, ArrowRight, CheckCircle2 } from 'lucide-react';
import { UserProfile } from '../types';

export interface AuthScreenProps {
  onLoginDemo: (demoType?: 'average' | 'empty' | 'complex') => void;
  onLoginSuccess?: (profile: UserProfile, token?: string) => void;
  language?: string;
  onLanguageChange?: (lang: string) => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({
  onLoginDemo,
  onLoginSuccess,
  language = 'en',
  onLanguageChange,
}) => {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [selectedDemoType, setSelectedDemoType] = useState<'average' | 'empty' | 'complex'>('average');
  const [currentLang, setCurrentLang] = useState<string>(language || 'en');
  
  // Form fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  // Verification UI state
  const [isVerificationPending, setIsVerificationPending] = useState(false);

  const isId = currentLang === 'id';

  const handleLangChange = (newLang: string) => {
    setCurrentLang(newLang);
    if (onLanguageChange) {
      onLanguageChange(newLang);
    }
  };

  const handleDemoClick = () => {
    onLoginDemo(selectedDemoType);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setErrorMessage(isId ? 'Harap masukkan alamat email' : 'Please enter an email address');
      return;
    }
    if (!password) {
      setErrorMessage(isId ? 'Harap masukkan kata sandi' : 'Please enter a password');
      return;
    }

    setIsLoading(true);

    try {
      if (mode === 'signin') {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: cleanEmail, password }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || (isId ? 'Gagal masuk' : 'Login failed'));
        }

        if (data.userProfile && onLoginSuccess) {
          onLoginSuccess(data.userProfile, data.token);
        } else {
          onLoginDemo(selectedDemoType);
        }
      } else {
        // Sign up
        const res = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: cleanEmail,
            password,
            nickname: nickname.trim() || cleanEmail.split('@')[0],
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || (isId ? 'Pendaftaran gagal' : 'Registration failed'));
        }

        // Show verification prompt or complete
        setIsVerificationPending(true);
        if (data.userProfile && onLoginSuccess) {
          onLoginSuccess(data.userProfile, data.token);
        }
      }
    } catch (err: any) {
      setErrorMessage(err?.message || (isId ? 'Terjadi kesalahan autentikasi' : 'Authentication error occurred'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleBypassVerify = () => {
    setIsVerificationPending(false);
    if (onLoginSuccess) {
      onLoginSuccess({
        name: nickname.trim() || 'User',
        email: email.trim().toLowerCase() || 'user@example.com',
        age: 30,
        gender: 'female',
        ethnicity: '',
        weight: 60,
        height: 165,
        bmi: 22.0,
        language: currentLang as 'en' | 'id',
        theme: 'system',
        userType: 'Standard',
        targetCalories: 2000,
        topTargetNutrientKeys: ['protein', 'saturatedFat', 'sodium', 'fiber'],
        customBiomarkers: {},
        customRanges: {},
        pendingObservations: [],
        agentCredits: { total: 100, used: 0, available: 100 },
      });
    } else {
      onLoginDemo('average');
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 selection:bg-indigo-500 selection:text-white">
      <div
        id="auth-card"
        className="max-w-md w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 shadow-xl text-left"
      >
        {/* Top Header & Language Selector */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-50 dark:bg-indigo-950/60 rounded-xl flex items-center justify-center text-indigo-600 dark:text-indigo-400">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold tracking-tight text-slate-900 dark:text-white">
                Health Cockpit
              </h2>
            </div>
          </div>

          <div className="flex items-center">
            <select
              aria-label="Select language"
              value={currentLang}
              onChange={(e) => handleLangChange(e.target.value)}
              className="text-xs bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg px-2.5 py-1.5 border border-slate-200 dark:border-slate-700 cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="en">English</option>
              <option value="fr">Français</option>
              <option value="zh">中文</option>
              <option value="id">Bahasa Indonesia</option>
            </select>
          </div>
        </div>

        {/* Heading */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            {mode === 'signin'
              ? (isId ? 'Masuk' : 'Sign in')
              : (isId ? 'Daftar' : 'Sign up')}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {mode === 'signin'
              ? (isId
                  ? 'Masuk untuk terus memantau kesehatan Anda.'
                  : 'Sign in to continue tracking your health.')
              : (isId
                  ? 'Buat akun untuk memulai pemantauan kesehatan Anda.'
                  : 'Create an account to start tracking your health.')}
          </p>
        </div>

        {/* Demo Section */}
        <div className="mb-6 bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/50 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-indigo-700 dark:text-indigo-300">
              <Sparkles className="w-4 h-4" />
              <span>Demo</span>
            </div>
            <select
              aria-label="Demo profile type"
              value={selectedDemoType}
              onChange={(e) => setSelectedDemoType(e.target.value as any)}
              className="text-xs bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg px-2 py-1 border border-indigo-200 dark:border-indigo-800/80 cursor-pointer focus:outline-none"
            >
              <option value="empty">Demo Empty</option>
              <option value="average">Demo Average</option>
              <option value="complex">Demo Complex</option>
            </select>
          </div>

          <button
            id="demo-login-btn"
            type="button"
            onClick={handleDemoClick}
            className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-sm rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          >
            <span>{isId ? 'Masuk dengan Akun Demo' : 'Launch demo'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        {/* Divider */}
        <div className="relative flex py-2 items-center mb-5">
          <div className="flex-grow border-t border-slate-200 dark:border-slate-800"></div>
          <span className="flex-shrink mx-3 text-xs text-slate-400 dark:text-slate-500">
            {isId ? 'atau gunakan email' : 'or use email'}
          </span>
          <div className="flex-grow border-t border-slate-200 dark:border-slate-800"></div>
        </div>

        {/* Verification Pending UI */}
        {isVerificationPending && (
          <div
            id="auth-verification-pending"
            className="mb-5 p-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 text-amber-800 dark:text-amber-300 text-xs"
          >
            <div className="flex items-center gap-2 font-semibold mb-2">
              <CheckCircle2 className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              <span>{isId ? 'Verifikasi Email Dikirim' : 'Verification Email Sent'}</span>
            </div>
            <p className="mb-3 text-slate-600 dark:text-slate-300">
              {isId
                ? 'Kami telah mengirimkan tautan verifikasi ke email Anda. Untuk pengujian instan, Anda dapat melewati langkah ini.'
                : 'A confirmation link was sent. For prototype testing, you can bypass or simulate verification below.'}
            </p>
            <div className="flex gap-2">
              <button
                id="auth-bypass-verify-btn"
                type="button"
                onClick={handleBypassVerify}
                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-medium cursor-pointer"
              >
                {isId ? 'Lewati Verifikasi' : 'Bypass verification'}
              </button>
              <button
                id="auth-simulate-verify-btn"
                type="button"
                onClick={handleBypassVerify}
                className="px-3 py-1.5 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 text-slate-800 dark:text-slate-200 rounded-lg font-medium cursor-pointer"
              >
                {isId ? 'Simulasi' : 'Simulate'}
              </button>
            </div>
          </div>
        )}

        {/* Error Alert */}
        {errorMessage && (
          <div className="mb-4 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 text-rose-600 dark:text-rose-400 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Email & Password Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'signup' && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                {isId ? 'Nama Panggilan' : 'Nickname'}
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <User className="w-4 h-4" />
                </div>
                <input
                  id="auth-nickname-input"
                  type="text"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder={isId ? 'Nama Anda' : 'Your name or nickname'}
                  className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-white"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              Email
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <Mail className="w-4 h-4" />
              </div>
              <input
                id="auth-email-input"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={isId ? 'nama@contoh.com' : 'Enter email'}
                className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-white"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                {isId ? 'Kata Sandi' : 'Password'}
              </label>
              {mode === 'signin' && (
                <button
                  type="button"
                  onClick={() => alert(isId ? 'Fitur reset sandi: silakan gunakan akun demo atau daftar baru.' : 'Password reset: please use demo account or register new.')}
                  className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                >
                  {isId ? 'Lupa kata sandi?' : 'Forgot password?'}
                </button>
              )}
            </div>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <Lock className="w-4 h-4" />
              </div>
              <input
                id="auth-password-input"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isId ? 'Kata sandi minimal 6 karakter' : 'Enter password'}
                className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-white"
              />
            </div>
          </div>

          <button
            id="auth-submit-btn"
            type="submit"
            disabled={isLoading}
            className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 dark:bg-indigo-600 dark:hover:bg-indigo-700 text-white font-semibold text-sm rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
          >
            {isLoading ? (
              <span className="inline-block animate-spin mr-1">⏳</span>
            ) : null}
            <span>
              {mode === 'signin'
                ? (isId ? 'Lanjutkan dengan email' : 'Continue with email')
                : (isId ? 'Buat Akun' : 'Create account')}
            </span>
          </button>
        </form>

        {/* Mode Switcher */}
        <div className="mt-5 text-center">
          <button
            id="auth-mode-switch-btn"
            type="button"
            onClick={() => {
              setMode(mode === 'signin' ? 'signup' : 'signin');
              setErrorMessage(null);
            }}
            className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline font-medium cursor-pointer"
          >
            {mode === 'signin'
              ? (isId ? 'Belum punya akun? Daftar' : "Don't have an account? Sign up")
              : (isId ? 'Sudah punya akun? Masuk' : 'Already have an account? Sign in')}
          </button>
        </div>

        {/* Social logins */}
        <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800 text-center">
          <span className="text-xs text-slate-400 dark:text-slate-500 block mb-3">
            {isId ? 'atau masuk dengan' : 'or'}
          </span>
          <div className="flex justify-center gap-2">
            <button
              type="button"
              onClick={handleDemoClick}
              className="px-3 py-1.5 text-xs bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg font-medium cursor-pointer"
            >
              Google
            </button>
            <button
              type="button"
              onClick={handleDemoClick}
              className="px-3 py-1.5 text-xs bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg font-medium cursor-pointer"
            >
              X
            </button>
            <button
              type="button"
              onClick={handleDemoClick}
              className="px-3 py-1.5 text-xs bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg font-medium cursor-pointer"
            >
              Facebook
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthScreen;
