import { getAgentRequestLogs } from '../utils/agentLogsTracker';
import React, { useState, useEffect } from 'react';

import { UserProfile, DbInteraction, QuotaData, FoodLog } from '../types';
import { translations } from '../utils/translations';
import { interpolate } from '../utils/i18n';

import { CloudLightning, CloudCheck, RefreshCw, Check, User } from 'lucide-react';
import { auth } from '../firebase';

import { lazyWithRetry } from '../utils/lazyWithRetry';
const GoogleHealthIntegration = lazyWithRetry(() => import('./GoogleHealthIntegration'));
const FullScreenLogViewer = lazyWithRetry(() => import('./FullScreenLogViewer'));
const ApiCallTrackerModal = lazyWithRetry(() => import('./ApiCallTrackerModal'));
const SyncDiagnosticsModal = lazyWithRetry(() => import('./SyncDiagnosticsModal'));
const DedupeBiomarkerLogsModal = lazyWithRetry(() => import('./DedupeBiomarkerLogsModal'));
const NutritionDataBrowserModal = lazyWithRetry(() => import('./NutritionDataBrowserModal'));
const BugTrackerModal = lazyWithRetry(() => import('./BugTrackerModal'));
import BugSnapshotFab from './BugSnapshotFab';
import ProfileModal from './ProfileModal';
import DbInteractionsOverlay from './DbInteractionsOverlay';
import ThemeCustomizerScreen from './ThemeCustomizerScreen';
import { useThemeCustomizer } from '../hooks/useThemeCustomizer';
const AllAnalysesModal = lazyWithRetry(() => import('./AllAnalysesModal').then(m => ({ default: m.AllAnalysesModal })));
const UserManagementTab = lazyWithRetry(() => import('./UserManagementTab'));
const BackupRestoreTab = lazyWithRetry(() => import('./BackupRestoreTab'));
const FoodCatalogAdminTab = lazyWithRetry(() => import('./FoodCatalogAdminTab').then(m => ({ default: m.FoodCatalogAdminTab })));
const PhotoStorageAdminTab = lazyWithRetry(() => import('./PhotoStorageAdminTab').then(m => ({ default: m.PhotoStorageAdminTab })));
import { X, Database, Loader } from 'lucide-react';
import { JobStore, isJobBlank } from '../jobs/JobStore';

import { checkQuotaFlag } from '../utils/firestoreUtils';

const ColorPickerField = ({ label, value, onChange }: { label: string, value: string, onChange: (v: string) => void }) => (
  <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-2xl gap-2">
    <div className="min-w-0 text-left">
      <span className="block text-xs font-bold text-slate-800 dark:text-slate-200">{label}</span>
    </div>
    <div className="flex items-center gap-2">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-20 text-xs px-2 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md font-mono text-slate-700 dark:text-slate-300"
      />
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-8 h-8 rounded cursor-pointer overflow-hidden bg-transparent shrink-0"
        style={{ padding: 0, border: 'none' }}
      />
    </div>
  </div>
);

interface HeaderProps {
  profile: UserProfile;
  setProfile: (p: UserProfile | ((prev: UserProfile) => UserProfile) | any) => void;
  onSaveProfile?: (p: UserProfile) => Promise<void>;
  hideSensitive: boolean;
  setHideSensitive: (h: boolean) => void;
  syncState: 'synced' | 'syncing' | 'local' | 'conflict';
  onSignOut: () => void;
  onCloudSync?: () => Promise<void>;
  onForcePush?: () => Promise<void>;
  /** Profile + biomarkers + all food logs (base64 images stripped). */
  onForcePushWithFoods?: () => Promise<void>;
  onForcePull?: () => Promise<void>;
  dbInteractions?: DbInteraction[];
  quota?: QuotaData;
  foodLogs?: FoodLog[];
  setFoodLogs?: (f: FoodLog[]) => void;
  biomarkerHistory?: any[];
  setBiomarkerHistory?: (b: any[]) => void;
  activeTab?: string;
  autoSyncDisabled?: boolean;
  onChangeAutoSyncDisabled?: (disabled: boolean) => void;
  biomarkers?: any;
  actions?: any[];
  dailyBenefits?: any[];
  report?: any;
  onSaveAndSync?: (profile: any, foodLogs: any[], biomarkers: any, biomarkerHistory: any[], actions: any[], dailyBenefits: any[], report: any, specificUpdate?: any) => Promise<void>;
  onOpenFrontDesk?: () => void;
  onOpenUndo?: () => void;
  onNavigateTab?: (tab: string) => void;
  /** Job currently open in the food/medical unified modal */
  viewingJobId?: string | null;
  onViewJob?: (jobId: string) => void;
}

const getSessionId = (): string => {
  if (typeof window === 'undefined') return 'global';
  let id = sessionStorage.getItem('app_session_id');
  if (!id) {
    id = `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    sessionStorage.setItem('app_session_id', id);
  }
  return id;
};

export default function Header({
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
  activeTab = 'home',
  autoSyncDisabled = false,
  onChangeAutoSyncDisabled,
  biomarkers,
  actions,
  dailyBenefits,
  report,
  onSaveAndSync,
  onOpenFrontDesk,
  onOpenUndo,
  onNavigateTab,
  viewingJobId = null,
  onViewJob,
}: HeaderProps) {
  const [jobs, setJobs] = useState(() => JobStore.getAllJobs());
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = JobStore.subscribe(() => {
      if (t) clearTimeout(t);
      t = setTimeout(() => setJobs(JobStore.getAllJobs()), 400);
    });
    return () => {
      unsubscribe();
      if (t) clearTimeout(t);
    };
  }, []);

  const [isEditing, setIsEditing] = useState(false);
  const [showAllAnalysesModal, setShowAllAnalysesModal] = useState(false);
  const [showDbInteractionsOverlay, setShowDbInteractionsOverlay] = useState(false);
  const [selectedSyncCategory, setSelectedSyncCategory] = useState<'food' | 'biomarker' | 'core' | null>(null);
  const [catalogSyncStatus, setCatalogSyncStatus] = useState<any>(null);

  useEffect(() => {
    if (showDbInteractionsOverlay) {
      fetch('/api/admin/food-catalog-sync-status')
        .then(res => res.ok ? res.json() : null)
        .then(data => data && setCatalogSyncStatus(data))
        .catch(() => {});
    }
  }, [showDbInteractionsOverlay]);
  const [dbOverlayViewMode, setDbOverlayViewMode] = useState<'admin' | 'user'>(() => {
    if (profile?.email?.toLowerCase().trim() !== 'cwah.liu@gmail.com') return 'user';
    const saved = localStorage.getItem('health_cockpit_admin_mode');
    if (saved) return saved as 'admin' | 'user';
    return 'admin';
  });
  const [activeAdminTab, setActiveAdminTab] = useState<'sync' | 'users' | 'backup' | 'catalog' | 'storage'>('sync');
  const [showAgentLogs, setShowAgentLogs] = useState(false);
  const [showApiTracker, setShowApiTracker] = useState(false);
  const [showNutritionDataBrowser, setShowNutritionDataBrowser] = useState(false);
  const [showBugTracker, setShowBugTracker] = useState(false);
  const [showSyncDiagnostics, setShowSyncDiagnostics] = useState(false);
  const [showDedupeBiomarkerLogs, setShowDedupeBiomarkerLogs] = useState(false);
  const [isTrackerOpen, setIsTrackerOpen] = useState(false);
  const [agentLogs, setAgentLogs] = useState<{ timestamp: string, message: string }[]>([]);
  const [isFetchingLogs, setIsFetchingLogs] = useState(false);
  const [now, setNow] = useState(Date.now());
  const t = translations[profile.language] || translations.en;

  const handleToggleAutoSync = (disabled: boolean) => {
    if (onChangeAutoSyncDisabled) {
      onChangeAutoSyncDisabled(disabled);
    }
  };

  
  // Q-11.12: theme customizer state/handlers live in hooks/useThemeCustomizer.ts (move-only).
  const theme = useThemeCustomizer({ profile, setProfile, onSaveProfile, t });
  const { setShowThemeScreen } = theme; // Header chrome still opens the screen from the profile modal

  // Derives a human-readable content label from a raw sync interaction path,
  // e.g. "users/abc123 (Actions)" -> "Actions", "users/abc123/reports/latest" -> "Report".
  // Display-only helper: does not affect any sync/write logic.
  const getSyncLabel = (path: string): string => {
    const parenMatch = path.match(/\(([^)]+)\)\s*$/);
    if (parenMatch) return parenMatch[1];
    const segments = path.split('/').filter(Boolean);
    const collectionMap: Record<string, string> = {
      foodLogs: 'Food Log',
      biomarkerHistory: 'Biomarker',
      reports: 'Report',
      agentAnalyses: 'Analysis',
      foodImages: 'Food Image',
      metadata: 'Dashboard'
    };
    for (let i = segments.length - 1; i >= 0; i--) {
      if (collectionMap[segments[i]]) return collectionMap[segments[i]];
    }
    return 'Profile / Full Sync';
  };

  const handleCopySyncFeed = async () => {
    const text = dbInteractions.map(op =>
      `[${op.timestamp}] ${op.type.toUpperCase()} | ${op.database === 'Supabase' ? 'Supabase' : 'Firebase'} | ${getSyncLabel(op.path)} | ${op.path} | ${op.sizeBytes > 0 ? op.sizeBytes + ' B' : '-'} | ${op.status}${op.errorMessage ? ' | Error: ' + op.errorMessage : ''}`
    ).join('\n');
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
    } catch (e) {
      console.error('Failed to copy sync feed:', e);
    }
  };

  useEffect(() => {
    if (!showAgentLogs) return;
    // Read from localStorage immediately on open — no polling needed
    const readLocalLogs = () => {
      const saved = getAgentRequestLogs();
      if (Array.isArray(saved) && saved.length > 0) {
        const flat = saved.flatMap((req: any) =>
          Array.isArray(req.logs)
            ? req.logs.map((l: any) => ({ timestamp: l.timestamp || req.timestamp, message: l.message }))
            : [{ timestamp: req.timestamp, message: req.summary || JSON.stringify(req) }]
        );
        if (flat.length > 0) { setAgentLogs(flat); return; }
      }
      // Fallback: one-shot server fetch (no polling interval)
      fetch('/api/gemini/debug-logs', { headers: { 'X-Session-ID': 'global' } })
        .then((r) => r.ok ? r.json() : null)
        .then((data) => { if (data?.logs) setAgentLogs(data.logs); })
        .catch(() => {});
    };
    readLocalLogs();
    // Re-read whenever new logs are saved (event fired inside saveAgentRequestLog)
    window.addEventListener('agent_logs_updated', readLocalLogs);
    return () => window.removeEventListener('agent_logs_updated', readLocalLogs);
  }, [showAgentLogs]);

  const handleClearAgentLogs = async () => {
    try {
      await fetch('/api/gemini/clear-debug-logs', { method: 'POST', headers: { 'X-Session-ID': 'global' } });
      setAgentLogs([]);
    } catch (e) {}
  };

  const [debugMode, setDebugMode] = useState(() => localStorage.getItem('agent_debug_mode') === 'true');
  const [serverStartTime, setServerStartTime] = useState<number | null>(null);

  // Keep track of last sync time in local state
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(() => {
    const email = profile?.email?.toLowerCase().trim() || 'guest';
    return localStorage.getItem(`ghealth_${email}_last_sync`);
  });

  // Whenever syncState changes to 'synced', update last sync time to now
  useEffect(() => {
    if (syncState === 'synced') {
      const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
      const email = profile?.email?.toLowerCase().trim() || 'guest';
      localStorage.setItem(`ghealth_${email}_last_sync`, nowStr);
      setLastSyncTime(nowStr);
    }
  }, [syncState, profile?.email]);

  useEffect(() => {
    const email = profile?.email?.toLowerCase().trim() || 'guest';
    setLastSyncTime(localStorage.getItem(`ghealth_${email}_last_sync`));
  }, [profile?.email]);

  const handleToggleDebugMode = (enabled: boolean) => {
    setDebugMode(enabled);
    localStorage.setItem('agent_debug_mode', enabled ? 'true' : 'false');
  };

  // Fetch real server start time
  useEffect(() => {
    fetch('/api/status')
      .then(r => {
        if (!r.ok) return null;
        return r.json().catch(() => null);
      })
      .then(d => {
        if (d && typeof d.startTime === 'number') {
          setServerStartTime(d.startTime);
        }
      })
      .catch(e => console.warn("Error fetching status:", e));
  }, []);

  useEffect(() => {
    let interval: any;
    if (showDbInteractionsOverlay) {
      interval = setInterval(() => setNow(Date.now()), 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [showDbInteractionsOverlay]);

  const isAdmin = profile?.userType === 'Admin' || profile?.email?.toLowerCase().trim() === 'cwah.liu@gmail.com';

  return (
    <>
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800/80 px-6 py-4 sticky top-0 z-40 shadow-sm transition-colors duration-200">
        <div className="max-w-md mx-auto flex items-center justify-between gap-3">
        {/* Profile Info Row */}
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <button 
            id="avatar-edit-btn"
            onClick={() => setIsEditing(!isEditing)} 
            className="relative w-12 h-12 rounded-full overflow-hidden border-2 border-indigo-500/20 flex-shrink-0 hover:scale-105 active:scale-95 transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            <img 
              src={profile.photoUrl || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=120"} 
              alt={t.userProfileAlt} 
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
            />
          </button>
          
          <div className="min-w-0 flex-1">
            <div className="flex flex-col justify-center">
              <div className="flex items-center gap-1.5">
                <span
                  id="user-nickname-text"
                  className={`font-semibold text-theme-text truncate text-base leading-tight ${isAdmin ? 'cursor-pointer hover:text-rose-500' : ''}`}
                  title={isAdmin ? 'Admin: open bug snapshot capture' : undefined}
                  onClick={() => {
                    if (!isAdmin) return;
                    try {
                      document.getElementById('bug-snapshot-fab')?.click();
                    } catch {
                      /* ignore */
                    }
                  }}
                >
                  {profile.nickname || (profile.email ? profile.email.split('@')[0] : 'User')}
                </span>
              </div>
              <span className="text-[10px] text-slate-400 capitalize font-medium mt-0.5 block tracking-wide">
                {activeTab === 'home' ? t.home : activeTab === 'health' ? t.health : activeTab === 'insights' ? t.insights : activeTab === 'food' ? t.foodHistory : activeTab === 'medical' ? t.medicalHistory : activeTab === 'trends' ? t.trends : activeTab}
              </span>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2.5">
          {(() => {
            const validJobs = jobs.filter(j => !isJobBlank(j));
            const runningJobs = validJobs.filter(j => j.status === 'running' || j.status === 'processing');
            const queuedJobs = validJobs.filter(j => j.status === 'queued' || j.status === 'awaiting_user');
            const succeededUnsavedJobs = validJobs.filter(j => j.status === 'succeeded' && !j.result?.savedToHistory && !j.viewed && !j.result?.viewed && !j.savedToLog);
            
            const runningCount = runningJobs.length;
            const queuedCount = queuedJobs.length;
            const readyCount = succeededUnsavedJobs.length;

            if (runningCount === 0 && queuedCount === 0 && readyCount === 0) return null;

            const activeRunning = runningJobs[0];
            const activeProgress = activeRunning?.progressPercent || 0;

            const handleBadgeClick = () => {
              setShowAllAnalysesModal(true);
            };

            return (
              <button 
                type="button"
                id="ready-jobs-badge-btn"
                onClick={handleBadgeClick}
                className={`text-[9px] px-2 py-0.5 rounded-full font-bold flex items-center gap-1 border cursor-pointer hover:opacity-90 transition-all ${
                  runningCount > 0 
                    ? 'bg-indigo-600 border-indigo-500 text-white animate-pulse' 
                    : queuedCount > 0
                    ? 'bg-amber-500 border-amber-400 text-white'
                    : 'bg-emerald-600 border-emerald-500 text-white'
                }`}
                title={
                  runningCount > 0 
                    ? interpolate(t.jobsActiveTooltip, { count: runningCount, percent: activeProgress })
                    : queuedCount > 0 
                    ? interpolate(t.jobsQueuedTooltip, { count: queuedCount })
                    : interpolate(t.jobsReadyTooltip, { count: readyCount })
                }
              >
                {runningCount > 0 ? (
                  <>
                    <Loader className="w-2.5 h-2.5 animate-spin" />
                    <span>{activeProgress > 0
                      ? interpolate(t.jobsActiveProgress, { count: runningCount, percent: activeProgress })
                      : interpolate(t.jobsActive, { count: runningCount })}</span>
                  </>
                ) : queuedCount > 0 ? (
                  <>
                    <span>{interpolate(t.jobsQueued, { count: queuedCount })}</span>
                  </>
                ) : (
                  <>
                    <Check className="w-2.5 h-2.5" />
                    <span>{interpolate(t.jobsReady, { count: readyCount })}</span>
                  </>
                )}
              </button>
            );
          })()}

          {/* Sync Status Icon Indicator (Click opens Settings) */}
          {(() => {
            const isAttentionNeeded = syncState === 'syncing' || dbInteractions.some(o => o.status === 'pending') || checkQuotaFlag();
            return (
              <button
                id="cloud-sync-btn"
                onClick={() => {
                  setDbOverlayViewMode('admin');
                  setShowDbInteractionsOverlay(true);
                }}
                className={`flex items-center p-2 rounded-xl transition-colors cursor-pointer relative ${
                  isAttentionNeeded 
                    ? 'text-amber-500 hover:bg-amber-500/10' 
                    : 'text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
                title={t.syncClickToOpen || "Settings"}
              >
                {syncState === 'syncing' && (
                  <RefreshCw className="w-5 h-5 text-amber-500 animate-spin" />
                )}
                {syncState === 'synced' && (
                  <CloudCheck className="w-5.5 h-5.5 text-slate-400 dark:text-slate-500" />
                )}
                {syncState === 'local' && (
                  checkQuotaFlag() ? (
                    <span title={t.firestoreQuotaExceeded}>
                      <CloudLightning className="w-5 h-5 text-amber-500 animate-pulse" />
                    </span>
                  ) : (
                    <CloudLightning className="w-5 h-5 text-slate-400 dark:text-slate-500" />
                  )
                )}
                {dbInteractions.some(o => o.status === 'pending') && (
                  <span className="absolute top-1 right-1 w-2 h-2 bg-amber-500 rounded-full animate-ping" />
                )}
              </button>
            );
          })()}
        </div>
      </div>
    
      <React.Suspense fallback={null}>
      {/* AI Agent Full Screen Logs */}
      <FullScreenLogViewer
        isOpen={showAgentLogs}
        onClose={() => setShowAgentLogs(false)}
        title="AI Agent Diagnostic Log History"
        logsText={agentLogs.map(l => `[${l.timestamp}] ${l.message}`).join('\n')}
        logsArray={agentLogs.map(l => `[${l.timestamp}]\n${l.message}`)}
        onClearLogs={handleClearAgentLogs}
        eventsCount={agentLogs.length}
      />
      <NutritionDataBrowserModal
        isOpen={showNutritionDataBrowser}
        onClose={() => setShowNutritionDataBrowser(false)}
        language={profile.language}
      />
      <BugTrackerModal
        isOpen={showBugTracker}
        onClose={() => setShowBugTracker(false)}
        onViewJob={onViewJob}
        language={profile.language}
      />
      <SyncDiagnosticsModal
        isOpen={showSyncDiagnostics}
        onClose={() => setShowSyncDiagnostics(false)}
      />
      <DedupeBiomarkerLogsModal
        isOpen={showDedupeBiomarkerLogs}
        onClose={() => setShowDedupeBiomarkerLogs(false)}
      />
      </React.Suspense>
      {isAdmin && (
        <BugSnapshotFab
          isAdmin={isAdmin}
          firebaseUid={auth.currentUser?.uid || null}
          activeTab={activeTab}
          viewingJobId={viewingJobId}
          biomarkerHistory={biomarkerHistory}
          biomarkers={biomarkers}
          profile={profile}
          getModalContext={() => {
            try {
              const jobs = JobStore.getAllJobs?.() || [];
              const fromModal = viewingJobId ? jobs.find((j) => j.id === viewingJobId) : null;
              const tab = String(activeTab || '').toLowerCase();
              const bioTab = ['home', 'health', 'medical', 'insights', 'trends', 'dictionary'].includes(tab);
              const foodTab = tab === 'food';
              const candidates = [...jobs]
                .filter((j) =>
                  j.kind !== 'bug_triage' &&
                  !String(j.id).startsWith('triage_') &&
                  !String(j.id).startsWith('bug_triage_')
                )
                .filter((j) => {
                  const k = String(j.kind || '').toLowerCase();
                  const isFood = k === 'food' || k.startsWith('food_');
                  const isMed = k.includes('medical') || k.includes('biomarker');
                  if (bioTab && !foodTab) return isMed;
                  if (foodTab) return isFood;
                  return true;
                })
                .sort((a, b) => String(b.id).localeCompare(String(a.id)));
              const active =
                fromModal ||
                candidates.find((j) => j.status === 'running' || j.status === 'awaiting_user') ||
                candidates.find((j) => j.status === 'succeeded' || j.status === 'failed') ||
                candidates[0];
              if (!active) {
                return {
                  activeTab,
                  jobsCount: jobs.length,
                  biomarkers,
                  biomarkerHistoryCount: Array.isArray(biomarkerHistory) ? biomarkerHistory.length : 0,
                  deletedBiomarkerLogIds: profile?.deletedBiomarkerLogIds || {},
                  deletedCustomBiomarkerKeys: profile?.deletedCustomBiomarkerKeys || {},
                  deletedNotUsedBiomarkerKeys: profile?.deletedNotUsedBiomarkerKeys || {},
                };
              }
              return {
                activeTab,
                jobId: active.id,
                kind: active.kind,
                mode: (active as any).mode || (active as any).inputSnapshot?.mode,
                status: active.status,
                progressPercent: active.progressPercent,
                result: active.result,
                pendingFoodLog: active.result?.pendingFoodLog || active.result?.data?.pendingFoodLog,
                backendLogs:
                  active.result?.backendLogs ||
                  active.liveThoughts?.backendLogs ||
                  undefined,
                pipelineErrors: active.result?.pipelineErrors,
                scoutItems: active.result?.scoutItems,
                photoUrl: active.photoUrl || active.result?.photoUrl,
                debugUrl: active.result?.debugUrl || active.debugUrl,
              };
            } catch {
              return { activeTab };
            }
          }}
        />
      )}
    </header>

      {/* Editing Dialog for Profile Parameters (Q-11.7: extracted to ProfileModal) */}
      {isEditing && (
        <ProfileModal
          profile={profile}
          setProfile={setProfile}
          onSaveProfile={onSaveProfile}
          hideSensitive={hideSensitive}
          setHideSensitive={setHideSensitive}
          onSignOut={onSignOut}
          onClose={() => setIsEditing(false)}
          onOpenTheme={() => {
            setIsEditing(false);
            setShowThemeScreen(true);
          }}
          onOpenAdmin={() => {
            setIsEditing(false);
            setDbOverlayViewMode('admin');
            setShowDbInteractionsOverlay(true);
          }}
        />
      )}

      {/* Theme Customizer Screen + inspector portals (Q-11.12: extracted to ThemeCustomizerScreen, move-only) */}
      <ThemeCustomizerScreen theme={theme} />

      {/* Database Interactions Live Sync Overlay (Q-11.12: extracted to DbInteractionsOverlay, move-only) */}
      <DbInteractionsOverlay
        actions={actions}
        activeAdminTab={activeAdminTab}
        autoSyncDisabled={autoSyncDisabled}
        biomarkerHistory={biomarkerHistory}
        biomarkers={biomarkers}
        catalogSyncStatus={catalogSyncStatus}
        dailyBenefits={dailyBenefits}
        dbInteractions={dbInteractions}
        dbOverlayViewMode={dbOverlayViewMode}
        debugMode={debugMode}
        foodLogs={foodLogs}
        getSyncLabel={getSyncLabel}
        handleCopySyncFeed={handleCopySyncFeed}
        handleToggleAutoSync={handleToggleAutoSync}
        handleToggleDebugMode={handleToggleDebugMode}
        isAdmin={isAdmin}
        now={now}
        onCloudSync={onCloudSync}
        onOpenUndo={onOpenUndo}
        onSaveAndSync={onSaveAndSync}
        profile={profile}
        report={report}
        selectedSyncCategory={selectedSyncCategory}
        setActiveAdminTab={setActiveAdminTab}
        setBiomarkerHistory={setBiomarkerHistory}
        setDbOverlayViewMode={setDbOverlayViewMode}
        setFoodLogs={setFoodLogs}
        setIsTrackerOpen={setIsTrackerOpen}
        setSelectedSyncCategory={setSelectedSyncCategory}
        setShowAgentLogs={setShowAgentLogs}
        setShowBugTracker={setShowBugTracker}
        setShowDbInteractionsOverlay={setShowDbInteractionsOverlay}
        setShowDedupeBiomarkerLogs={setShowDedupeBiomarkerLogs}
        setShowNutritionDataBrowser={setShowNutritionDataBrowser}
        setShowSyncDiagnostics={setShowSyncDiagnostics}
        showDbInteractionsOverlay={showDbInteractionsOverlay}
        syncState={syncState}
        t={t}
      />

      {isTrackerOpen && (
        <React.Suspense fallback={null}>
          <ApiCallTrackerModal
            isOpen={isTrackerOpen}
            onClose={() => setIsTrackerOpen(false)}
            userEmail={profile?.email || auth.currentUser?.email || 'guest'}
          />
        </React.Suspense>
      )}

      <React.Suspense fallback={null}>
      <NutritionDataBrowserModal
        isOpen={showNutritionDataBrowser}
        onClose={() => setShowNutritionDataBrowser(false)}
        language={profile.language}
      />

      <BugTrackerModal
        isOpen={showBugTracker}
        onClose={() => setShowBugTracker(false)}
        onViewJob={onViewJob}
        language={profile.language}
      />
      <SyncDiagnosticsModal
        isOpen={showSyncDiagnostics}
        onClose={() => setShowSyncDiagnostics(false)}
      />
      <DedupeBiomarkerLogsModal
        isOpen={showDedupeBiomarkerLogs}
        onClose={() => setShowDedupeBiomarkerLogs(false)}
      />
      <AllAnalysesModal
        isOpen={showAllAnalysesModal}
        onClose={() => setShowAllAnalysesModal(false)}
        profile={profile}
        foodLogs={foodLogs}
        setFoodLogs={setFoodLogs}
        biomarkerHistory={biomarkerHistory}
        setBiomarkerHistory={setBiomarkerHistory}
        biomarkers={biomarkers}
        actions={actions}
        dailyBenefits={dailyBenefits}
        report={report}
        onSaveAndSync={onSaveAndSync}
        onNavigateTab={onNavigateTab}
        onViewJob={onViewJob}
      />
      </React.Suspense>
    </>
  );
}
