import React, { useState, useRef, useEffect } from 'react';
import { UserProfile, FoodLog, BiomarkerLog, DbInteraction, QuotaData } from '../types';
import Header from './Header';
import AuthScreen from './AuthScreen';
import BottomNav from './BottomNav';
import { createDefaultProfile } from '../utils/appProfileUtils';
import { getDynamicStyles } from './AppDynamicStyles';
import {
  Plus,
  MessageSquare,
  Sparkles,
  Stethoscope,
  Scale,
  Utensils,
  X
} from 'lucide-react';

export interface AppShellProps {
  children: React.ReactNode;
  activeTab: 'home' | 'insights' | 'food' | 'medical' | 'trends';
  onNavigateTab: (tab: 'home' | 'insights' | 'food' | 'medical' | 'trends') => void;
  profile: UserProfile | null;
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
  onCompareMeal?: () => void;
  viewingJobId?: string | null;
  onViewJob?: (jobId: string) => void;
  isLoggedIn: boolean;
  onLoginDemo: (demoType?: any) => void;
  onLoginSuccess?: (profile: UserProfile, token?: string) => void;
  language?: string;
  onOpenChat?: () => void;
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
  onCompareMeal,
  viewingJobId = null,
  onViewJob,
  isLoggedIn,
  onLoginDemo,
  onLoginSuccess,
  language,
  onOpenChat
}: AppShellProps) {
  const [isQuickActionOpen, setIsQuickActionOpen] = useState(false);
  const quickActionRef = useRef<HTMLDivElement>(null);
  const isId = (language || profile?.language) === 'id';
  const effectiveProfile = profile || createDefaultProfile();
  const styles = getDynamicStyles(effectiveProfile?.theme, true);

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
      <AuthScreen
        onLoginDemo={onLoginDemo}
        onLoginSuccess={onLoginSuccess}
        language={language || profile?.language || 'en'}
      />
    );
  }

  return (
    <div style={styles.shellContainerStyle} className="relative antialiased selection:bg-indigo-500 selection:text-white">
      {/* Top Header */}
      <Header
        profile={effectiveProfile}
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
            <button
              onClick={() => {
                setIsQuickActionOpen(false);
                if (onCompareMeal) {
                  onCompareMeal();
                }
              }}
              id="quick-action-compare-meal"
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-left text-sm font-medium text-slate-800 dark:text-slate-200 transition-colors cursor-pointer"
            >
              <div className="p-1.5 rounded-lg bg-orange-50 dark:bg-orange-950/60 text-orange-600 dark:text-orange-400">
                <Scale className="w-4 h-4" />
              </div>
              <div>
                <div>{isId ? 'Bandingkan Makanan' : 'Compare Foods'}</div>
                <div className="text-[11px] text-slate-400 font-normal">
                  {isId ? 'Bandingkan 2 label/menu' : 'Compare menus or labels'}
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
      <BottomNav
        activeTab={activeTab}
        onNavigateTab={onNavigateTab}
        isId={isId}
      />
    </div>
  );
}
