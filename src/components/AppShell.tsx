import React, { useState, useRef, useEffect } from 'react';
import { UserProfile, FoodLog, BiomarkerLog, DbInteraction, QuotaData } from '../types';
import Header from './Header';
import { getDynamicStyles } from './AppDynamicStyles';
import {
  Home,
  Activity,
  Utensils,
  TrendingUp,
  Lightbulb,
  Plus,
  MessageSquare,
  Sparkles,
  Stethoscope,
  X
} from 'lucide-react';

export interface AppShellProps {
  children: React.ReactNode;
  activeTab: 'home' | 'insights' | 'food' | 'medical' | 'trends';
  onNavigateTab: (tab: 'home' | 'insights' | 'food' | 'medical' | 'trends') => void;
  profile: UserProfile;
  setProfile: (p: UserProfile | ((prev: UserProfile) => UserProfile) | any) => void;
  onSaveProfile?: (p: UserProfile) => Promise<void>;
  hideSensitive: boolean;
  setHideSensitive: (h: boolean) => void;
  syncState: 'synced' | 'syncing' | 'local' | 'conflict';
  onSignOut: () => void;
  onCloudSync?: () => Promise<void>;
  onForcePush?: () => Promise<void>;
  onForcePushWithFoods?: () => Promise<void>;
  onForcePull?: () => Promise<void>;
  dbInteractions?: DbInteraction[];
  quota?: QuotaData;
  foodLogs?: FoodLog[];
  setFoodLogs?: (f: FoodLog[]) => void;
  biomarkerHistory?: BiomarkerLog[];
  setBiomarkerHistory?: (b: any[]) => void;
  onOpenFrontDesk: () => void;
  onLogMeal: () => void;
  onLogMedical: () => void;
  viewingJobId?: string | null;
  onViewJob?: (jobId: string) => void;
  isLoggedIn: boolean;
  onLoginDemo: () => void;
}

export default function AppShell({
  children,
  activeTab,
  onNavigateTab,
  profile,
  setProfile,
  onSaveProfile,
  hideSensitive,
  setHideSensitive,
  syncState,
  onSignOut,
  onCloudSync,
  onForcePush,
  onForcePushWithFoods,
  onForcePull,
  dbInteractions = [],
  quota,
  foodLogs = [],
  setFoodLogs,
  biomarkerHistory = [],
  setBiomarkerHistory,
  onOpenFrontDesk,
  onLogMeal,
  onLogMedical,
  viewingJobId = null,
  onViewJob,
  isLoggedIn,
  onLoginDemo
}: AppShellProps) {
  const [isQuickActionOpen, setIsQuickActionOpen] = useState(false);
  const quickActionRef = useRef<HTMLDivElement>(null);
  const isId = profile?.language === 'id';
  const styles = getDynamicStyles(profile?.theme, true);

  // Close quick action popover on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (quickActionRef.current && !quickActionRef.current.contains(event.target as Node)) {
        setIsQuickActionOpen(false);
      }
    }
    if (isQuickActionOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isQuickActionOpen]);

  // If not logged in, render authentication / demo entrance screen
  if (!isLoggedIn) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
        <div className="max-w-md w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-8 shadow-xl text-center">
          <div className="w-16 h-16 bg-indigo-50 dark:bg-indigo-950/60 rounded-2xl flex items-center justify-center mx-auto mb-5 text-indigo-600 dark:text-indigo-400">
            <Activity className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight mb-2">
            Health Cockpit
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-8">
            {isId
              ? 'Asisten kesehatan, nutrisi, dan biomarker cerdas Anda.'
              : 'Your personalized clinical nutrition, biomarker, and health cockpit.'}
          </p>
          <button
            id="demo-login-btn"
            onClick={onLoginDemo}
            className="w-full py-3.5 px-5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-2xl shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <Sparkles className="w-5 h-5" />
            <span>{isId ? 'Masuk dengan Akun Demo' : 'Enter as Demo User'}</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.shellContainerStyle} className="relative antialiased selection:bg-indigo-500 selection:text-white">
      {/* Top Header */}
      <Header
        profile={profile}
        setProfile={setProfile}
        onSaveProfile={onSaveProfile}
        hideSensitive={hideSensitive}
        setHideSensitive={setHideSensitive}
        syncState={syncState}
        onSignOut={onSignOut}
        onCloudSync={onCloudSync}
        onForcePush={onForcePush}
        onForcePushWithFoods={onForcePushWithFoods}
        onForcePull={onForcePull}
        dbInteractions={dbInteractions}
        quota={quota}
        foodLogs={foodLogs}
        setFoodLogs={setFoodLogs}
        biomarkerHistory={biomarkerHistory}
        setBiomarkerHistory={setBiomarkerHistory}
        activeTab={activeTab}
        onOpenFrontDesk={onOpenFrontDesk}
        onNavigateTab={onNavigateTab}
        viewingJobId={viewingJobId}
        onViewJob={onViewJob}
      />

      {/* Main Tab Content */}
      <main id="app-main-content" className="w-full max-w-6xl mx-auto pb-24">
        {children}
      </main>

      {/* Floating Quick Action Button (FAB) & Menu */}
      <div ref={quickActionRef} className="fixed bottom-20 right-5 z-40">
        {isQuickActionOpen && (
          <div className="absolute bottom-16 right-0 mb-2 w-56 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl p-2 space-y-1 animate-in fade-in zoom-in-95 duration-150">
            <button
              onClick={() => {
                setIsQuickActionOpen(false);
                onOpenFrontDesk();
              }}
              title="Front Desk"
              aria-label="Health Info"
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-left text-sm font-medium text-slate-800 dark:text-slate-200 transition-colors cursor-pointer"
            >
              <div className="p-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
                <MessageSquare className="w-4 h-4" />
              </div>
              <div>
                <div>{isId ? 'Pusat Bantuan' : 'Front Desk'}</div>
                <div className="text-[11px] text-slate-400 font-normal">
                  {isId ? 'Health Coach & Tanya Jawab' : 'Health Coach & Inquiries'}
                </div>
              </div>
            </button>

            <button
              onClick={() => {
                setIsQuickActionOpen(false);
                onLogMeal();
              }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-left text-sm font-medium text-slate-800 dark:text-slate-200 transition-colors cursor-pointer"
            >
              <div className="p-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400">
                <Utensils className="w-4 h-4" />
              </div>
              <div>
                <div>{isId ? 'Catat Makanan' : 'Log Meal'}</div>
                <div className="text-[11px] text-slate-400 font-normal">
                  {isId ? 'Foto atau deskripsi' : 'Photo or text description'}
                </div>
              </div>
            </button>

            <button
              onClick={() => {
                setIsQuickActionOpen(false);
                onLogMedical();
              }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-left text-sm font-medium text-slate-800 dark:text-slate-200 transition-colors cursor-pointer"
            >
              <div className="p-1.5 rounded-lg bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400">
                <Stethoscope className="w-4 h-4" />
              </div>
              <div>
                <div>{isId ? 'Catat Lab/Biomarker' : 'Log Biomarkers'}</div>
                <div className="text-[11px] text-slate-400 font-normal">
                  {isId ? 'Upload hasil tes lab' : 'Upload lab document'}
                </div>
              </div>
            </button>
          </div>
        )}

        <button
          onClick={() => setIsQuickActionOpen(!isQuickActionOpen)}
          title="Open quick actions"
          aria-label="Open quick actions"
          className="w-14 h-14 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full shadow-lg hover:shadow-indigo-500/25 flex items-center justify-center transition-all duration-200 cursor-pointer focus:outline-none focus:ring-4 focus:ring-indigo-300 dark:focus:ring-indigo-900"
        >
          {isQuickActionOpen ? <X className="w-6 h-6" /> : <Plus className="w-6 h-6" />}
        </button>
      </div>

      {/* Bottom Sticky Navigation Bar */}
      <nav
        id="app-bottom-nav"
        className="fixed bottom-0 inset-x-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 safe-area-pb"
      >
        <div className="max-w-md mx-auto flex items-center justify-around h-16 px-2">
          <button
            id="nav-tab-home"
            onClick={() => onNavigateTab('home')}
            className={`flex flex-col items-center justify-center flex-1 h-full py-1 text-xs font-medium transition-colors cursor-pointer ${
              activeTab === 'home'
                ? 'text-indigo-600 dark:text-indigo-400'
                : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <Home className="w-5 h-5 mb-1" />
            <span>{isId ? 'Beranda' : 'Home'}</span>
          </button>

          <button
            id="nav-tab-health"
            onClick={() => onNavigateTab('medical')}
            className={`flex flex-col items-center justify-center flex-1 h-full py-1 text-xs font-medium transition-colors cursor-pointer ${
              activeTab === 'medical'
                ? 'text-indigo-600 dark:text-indigo-400'
                : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <Activity className="w-5 h-5 mb-1" />
            <span>{isId ? 'Kesehatan' : 'Health'}</span>
          </button>

          <button
            id="nav-tab-food"
            onClick={() => onNavigateTab('food')}
            className={`flex flex-col items-center justify-center flex-1 h-full py-1 text-xs font-medium transition-colors cursor-pointer ${
              activeTab === 'food'
                ? 'text-indigo-600 dark:text-indigo-400'
                : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <Utensils className="w-5 h-5 mb-1" />
            <span>{isId ? 'Makanan' : 'Food'}</span>
          </button>

          <button
            id="nav-tab-trends"
            onClick={() => onNavigateTab('trends')}
            className={`flex flex-col items-center justify-center flex-1 h-full py-1 text-xs font-medium transition-colors cursor-pointer ${
              activeTab === 'trends'
                ? 'text-indigo-600 dark:text-indigo-400'
                : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <TrendingUp className="w-5 h-5 mb-1" />
            <span>{isId ? 'Tren' : 'Trends'}</span>
          </button>

          <button
            id="nav-tab-insights"
            onClick={() => onNavigateTab('insights')}
            className={`flex flex-col items-center justify-center flex-1 h-full py-1 text-xs font-medium transition-colors cursor-pointer ${
              activeTab === 'insights'
                ? 'text-indigo-600 dark:text-indigo-400'
                : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <Lightbulb className="w-5 h-5 mb-1" />
            <span>{isId ? 'Wawasan' : 'Insights'}</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
