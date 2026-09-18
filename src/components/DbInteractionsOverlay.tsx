import React from 'react';
import { createPortal } from 'react-dom';
import { lazyWithRetry } from '../utils/lazyWithRetry';
import { GIT_COMMIT_HASH, GIT_COMMIT_TIME } from '../git-version.generated';
import { BugSnapshotSettingsToggle } from './BugSnapshotFab';
import type { DbInteraction, FoodLog, UserProfile } from '../types';
import {
  Activity, Archive, Bug, ChevronRight, Cloud, CloudLightning, Copy, Database,
  Image as ImageIcon, Loader, RefreshCw, RotateCcw, ShieldCheck, Terminal, Trash2, User, Users, X,
} from 'lucide-react';

const GoogleHealthIntegration = lazyWithRetry(() => import('./GoogleHealthIntegration'));
const UserManagementTab = lazyWithRetry(() => import('./UserManagementTab'));
const BackupRestoreTab = lazyWithRetry(() => import('./BackupRestoreTab'));
const FoodCatalogAdminTab = lazyWithRetry(() => import('./FoodCatalogAdminTab').then(m => ({ default: m.FoodCatalogAdminTab })));
const PhotoStorageAdminTab = lazyWithRetry(() => import('./PhotoStorageAdminTab').then(m => ({ default: m.PhotoStorageAdminTab })));

export interface DbInteractionsOverlayProps {
  actions: any[];
  activeAdminTab: 'sync' | 'users' | 'backup' | 'catalog' | 'storage';
  autoSyncDisabled: boolean;
  biomarkerHistory: any[];
  biomarkers: any;
  catalogSyncStatus: any;
  dailyBenefits: any[];
  dbInteractions: DbInteraction[];
  dbOverlayViewMode: 'admin' | 'user';
  debugMode: boolean;
  foodLogs: FoodLog[];
  getSyncLabel: (path: string) => string;
  handleCopySyncFeed: () => Promise<void>;
  handleToggleAutoSync: (disabled: boolean) => void;
  handleToggleDebugMode: (enabled: boolean) => void;
  isAdmin: boolean;
  now: number;
  onCloudSync: () => Promise<void>;
  onOpenUndo: () => void;
  onSaveAndSync: (profile: any, foodLogs: any[], biomarkers: any, biomarkerHistory: any[], actions: any[], dailyBenefits: any[], report: any, specificUpdate?: any) => Promise<void>;
  profile: UserProfile;
  report: any;
  selectedSyncCategory: 'food' | 'biomarker' | 'core' | null;
  setActiveAdminTab: (v: 'sync' | 'users' | 'backup' | 'catalog' | 'storage') => void;
  setBiomarkerHistory: (b: any[]) => void;
  setDbOverlayViewMode: (v: 'admin' | 'user') => void;
  setFoodLogs: (f: FoodLog[]) => void;
  setIsTrackerOpen: (v: boolean) => void;
  setSelectedSyncCategory: (v: 'food' | 'biomarker' | 'core' | null) => void;
  setShowAgentLogs: (v: boolean) => void;
  setShowBugTracker: (v: boolean) => void;
  setShowDbInteractionsOverlay: (v: boolean) => void;
  setShowDedupeBiomarkerLogs: (v: boolean) => void;
  setShowNutritionDataBrowser: (v: boolean) => void;
  setShowSyncDiagnostics: (v: boolean) => void;
  showDbInteractionsOverlay: boolean;
  syncState: 'synced' | 'syncing' | 'local' | 'conflict';
  t: Record<string, string>;
}

/**
 * Q-11.12 (move-only): the `#db-interactions-overlay` portal, moved verbatim out of
 * Header.tsx. The markup, handlers and conditionals are unchanged; only the
 * enclosing component boundary and the prop plumbing are new. The region is kept
 * byte-identical, including the `showDbInteractionsOverlay &&` guard inside the
 * fragment, so React's rendering behaviour (false renders nothing) is unchanged.
 */
export default function DbInteractionsOverlay({
  actions,
  activeAdminTab,
  autoSyncDisabled,
  biomarkerHistory,
  biomarkers,
  catalogSyncStatus,
  dailyBenefits,
  dbInteractions,
  dbOverlayViewMode,
  debugMode,
  foodLogs,
  getSyncLabel,
  handleCopySyncFeed,
  handleToggleAutoSync,
  handleToggleDebugMode,
  isAdmin,
  now,
  onCloudSync,
  onOpenUndo,
  onSaveAndSync,
  profile,
  report,
  selectedSyncCategory,
  setActiveAdminTab,
  setBiomarkerHistory,
  setDbOverlayViewMode,
  setFoodLogs,
  setIsTrackerOpen,
  setSelectedSyncCategory,
  setShowAgentLogs,
  setShowBugTracker,
  setShowDbInteractionsOverlay,
  setShowDedupeBiomarkerLogs,
  setShowNutritionDataBrowser,
  setShowSyncDiagnostics,
  showDbInteractionsOverlay,
  syncState,
  t,
}: DbInteractionsOverlayProps) {
  return (
    <>
      {showDbInteractionsOverlay && createPortal((
        <div id="db-interactions-overlay" className="fixed inset-0 z-[9999] bg-slate-900/75 backdrop-blur-md flex items-center justify-center p-0">
          <div className="bg-white dark:bg-slate-900 w-full h-full shadow-2xl overflow-hidden flex flex-col animation-fade-in text-slate-850 dark:text-slate-100">
            {/* Header */}
            <div className="px-4 sm:px-6 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0 bg-white dark:bg-slate-900">
              <div className="flex items-center gap-2.5 shrink-0">
                <ShieldCheck className="w-5 h-5 text-indigo-600 shrink-0" />
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-theme-text leading-none">Settings</h2>
                  <span className="text-[10px] sm:text-xs font-normal text-slate-400 block mt-0.5 font-mono">
                    {GIT_COMMIT_HASH} · {(() => {
                      const commitMs = new Date(GIT_COMMIT_TIME).getTime();
                      const diffMs = Date.now() - commitMs;
                      const diffMin = Math.floor(diffMs / 60_000);
                      const diffHr = Math.floor(diffMin / 60);
                      const diffDay = Math.floor(diffHr / 24);
                      if (diffMin < 1) return 'just now';
                      if (diffMin < 60) return `updated ${diffMin} min ago`;
                      if (diffHr < 24) return `updated ${diffHr}h ago`;
                      return `updated ${diffDay}d ago`;
                    })()}
                  </span>
                </div>
              </div>
              
              {/* Horizontal Scrollable admin buttons */}
              <div className="flex-1 flex items-center justify-end gap-2 overflow-x-auto py-1 px-0.5 min-w-0">
                {dbOverlayViewMode === 'admin' && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => setShowAgentLogs(true)}
                      className="p-1.5 rounded-lg text-indigo-600 bg-indigo-50 dark:text-indigo-400 dark:bg-indigo-900/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors cursor-pointer flex items-center gap-1 text-xs font-bold"
                      title="View AI Agent Logs"
                    >
                      <Terminal className="w-4 h-4" /> <span className="hidden md:inline">View AI Logs</span>
                    </button>
                    <button
                      onClick={() => setIsTrackerOpen(true)}
                      className="p-1.5 rounded-lg text-emerald-600 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-900/30 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition-colors cursor-pointer flex items-center gap-1 text-xs font-bold"
                      title="View API call stats"
                    >
                      <Cloud className="w-4 h-4" /> <span className="hidden md:inline">API Calls</span>
                    </button>
                    <button
                      onClick={() => setShowNutritionDataBrowser(true)}
                      className="p-1.5 rounded-lg text-violet-600 bg-violet-50 dark:text-violet-400 dark:bg-violet-900/30 hover:bg-violet-100 dark:hover:bg-violet-900/50 transition-colors cursor-pointer flex items-center gap-1 text-xs font-bold"
                      title="Nutrition data browser — chains, base cache, unfetched, issues"
                    >
                      <Database className="w-4 h-4" /> <span className="hidden md:inline">Nutrition DB</span>
                    </button>
                    <button
                      onClick={() => setShowBugTracker(true)}
                      className="p-1.5 rounded-lg text-rose-600 bg-rose-50 dark:text-rose-400 dark:bg-rose-900/30 hover:bg-rose-100 dark:hover:bg-rose-900/50 transition-colors cursor-pointer flex items-center gap-1 text-xs font-bold"
                      title="Bug tracker — shared fix tags across all reports"
                    >
                      <Bug className="w-4 h-4" /> <span className="hidden md:inline">Bug Tracker</span>
                    </button>
                  </div>
                )}
                {onCloudSync && (
                  <button
                    onClick={() => {
                      if (onCloudSync && syncState !== 'syncing') onCloudSync();
                    }}
                    className={`p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer flex items-center gap-1 text-xs font-bold shrink-0 ${
                      syncState === 'syncing' ? 'text-amber-500' : 'text-slate-600 dark:text-slate-300'
                    }`}
                    title={syncState === 'syncing' ? (t.syncing || 'Syncing...') : (t.syncNow || 'Sync Now')}
                  >
                    <RefreshCw className={`w-4 h-4 ${syncState === 'syncing' ? 'text-amber-500 animate-spin' : ''}`} />
                    <span className="hidden md:inline">{syncState === 'syncing' ? (t.syncing || 'Syncing...') : (t.syncNow || 'Sync Now')}</span>
                  </button>
                )}
              </div>

              <div className="shrink-0 flex items-center">
                <button
                  onClick={() => setShowDbInteractionsOverlay(false)}
                  className="p-2 rounded-xl text-slate-500 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer shrink-0 ml-1 flex items-center justify-center font-bold"
                  title="Close Settings"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Content area */}
            <div className="p-6 overflow-y-auto space-y-6 text-left flex-1">
              
              {/* Initiative K: bug snapshot kill-switch (admin) */}
              {isAdmin && (
                <BugSnapshotSettingsToggle />
              )}

              {/* Undo & Snapshots Control inside Settings */}
              {onOpenUndo && (
                <div className="p-3.5 bg-amber-50/70 dark:bg-amber-950/25 border border-amber-200/80 dark:border-amber-800/50 rounded-2xl flex items-center justify-between shadow-xs">
                  <div>
                    <h4 className="text-xs font-bold text-amber-900 dark:text-amber-200 flex items-center gap-1.5 uppercase tracking-wider">
                      <RotateCcw className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                      <span>System Undo & Snapshots</span>
                    </h4>
                    <p className="text-[11px] text-amber-800/80 dark:text-amber-300/80 mt-0.5">
                      Restore previous profile state and biomarker snapshot history.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowDbInteractionsOverlay(false);
                      if (onOpenUndo) onOpenUndo();
                    }}
                    className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 active:scale-95 text-white rounded-xl text-xs font-bold shadow-sm transition-all cursor-pointer flex items-center gap-1.5 shrink-0"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Undo / Restore</span>
                  </button>
                </div>
              )}
              
              {dbOverlayViewMode === 'admin' && (
                <div className="flex border-b border-slate-200 dark:border-slate-800 pb-px gap-6 mb-4">
                  <button
                    type="button"
                    onClick={() => setActiveAdminTab('sync')}
                    className={`pb-3 text-xs font-bold transition-all border-b-2 relative cursor-pointer ${
                      activeAdminTab === 'sync'
                        ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                        : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                    }`}
                  >
                    Sync & Telemetry
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveAdminTab('backup')}
                    className={`pb-3 text-xs font-bold transition-all border-b-2 relative cursor-pointer flex items-center gap-1.5 ${
                      activeAdminTab === 'backup'
                        ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                        : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                    }`}
                  >
                    <Archive className="w-4 h-4" />
                    Backup
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveAdminTab('users')}
                    className={`pb-3 text-xs font-bold transition-all border-b-2 relative cursor-pointer flex items-center gap-1.5 ${
                      activeAdminTab === 'users'
                        ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                        : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                    }`}
                  >
                    <Users className="w-4 h-4" />
                    User Management & Quotas
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveAdminTab('catalog')}
                    className={`pb-3 text-xs font-bold transition-all border-b-2 relative cursor-pointer flex items-center gap-1.5 ${
                      activeAdminTab === 'catalog'
                        ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                        : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                    }`}
                  >
                    <Database className="w-4 h-4 text-orange-500" />
                    Food & Venues Catalog
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveAdminTab('storage')}
                    className={`pb-3 text-xs font-bold transition-all border-b-2 relative cursor-pointer flex items-center gap-1.5 ${
                      activeAdminTab === 'storage'
                        ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                        : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                    }`}
                  >
                    <ImageIcon className="w-4 h-4 text-purple-500" />
                    Photo Storage
                  </button>
                </div>
              )}

              {dbOverlayViewMode === 'admin' && activeAdminTab === 'catalog' ? (
                <div className="max-h-[75vh] overflow-y-auto p-4">
                  <React.Suspense fallback={<div className="p-4 flex items-center justify-center"><Loader className="w-5 h-5 animate-spin text-slate-400" /></div>}>
                    <FoodCatalogAdminTab />
                  </React.Suspense>
                </div>
              ) : dbOverlayViewMode === 'admin' && activeAdminTab === 'storage' ? (
                <div className="max-h-[75vh] overflow-y-auto p-4">
                  <React.Suspense fallback={<div className="p-4 flex items-center justify-center"><Loader className="w-5 h-5 animate-spin text-slate-400" /></div>}>
                    <PhotoStorageAdminTab />
                  </React.Suspense>
                </div>
              ) : dbOverlayViewMode === 'admin' && activeAdminTab === 'users' ? (
                <React.Suspense fallback={null}>
                  <UserManagementTab />
                </React.Suspense>
              ) : dbOverlayViewMode === 'admin' && activeAdminTab === 'backup' ? (
                <div className="space-y-6 max-h-[75vh] overflow-y-auto pb-8">
                  <React.Suspense fallback={null}>
                  <BackupRestoreTab 
                     profile={profile} 
                     foodLogs={foodLogs || []} 
                     biomarkerHistory={biomarkerHistory || []} 
                     setFoodLogs={setFoodLogs || (() => {})} 
                     setBiomarkerHistory={setBiomarkerHistory || (() => {})} 
                     onSaveAndSync={onSaveAndSync}
                     biomarkers={biomarkers}
                     actions={actions}
                     dailyBenefits={dailyBenefits}
                     report={report}
                  />
                  </React.Suspense>
                  <div className="p-4 bg-slate-800/50 rounded-xl border border-slate-700/50 mx-4 mt-4">
                    <h3 className="text-lg font-semibold text-white flex items-center gap-2 mb-2">
                      <Cloud className="w-5 h-5 text-indigo-400" />
                      Google Workspace Integration
                    </h3>
                    <p className="text-sm text-slate-400 mb-4">
                      Connect your Google account to enable Google Drive backup and sync capabilities for your health data.
                    </p>
                    <React.Suspense fallback={<div className="p-2 flex items-center justify-center"><Loader className="w-4 h-4 animate-spin text-slate-400" /></div>}>
                      <GoogleHealthIntegration profile={profile} />
                    </React.Suspense>
                  </div>
                </div>
              ) : (
                <>
              {/* List of transactions - MOVED TO TOP */}
              <div className="space-y-2 mb-6">
                <div className="flex items-center justify-between">
                  <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Sync Transaction Activity Feed
                  </span>
                  <div className="flex items-center gap-2">
                    {profile?.email?.toLowerCase().trim() === 'cwah.liu@gmail.com' && (
                      <button
                        onClick={() => setShowSyncDiagnostics(true)}
                        className="flex items-center gap-1 text-[10px] font-semibold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 px-2 py-0.5 rounded-full hover:bg-rose-100 dark:hover:bg-rose-950/50 transition-colors"
                        title="View / Download full Sync Diagnostics JSON"
                      >
                        <Terminal className="w-3 h-3" /> Diagnostics
                      </button>
                    )}
                    <button
                      onClick={handleCopySyncFeed}
                      className="flex items-center gap-1 text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/30 px-2 py-0.5 rounded-full"
                      title="Copy full sync feed as text"
                    >
                      <Copy className="w-3 h-3" /> Copy
                    </button>
                    <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
                      {dbInteractions.length} Total Logs
                    </span>
                  </div>
                </div>

                {dbInteractions.length === 0 ? (
                  <div className="text-center py-8 text-xs text-slate-450 bg-slate-50 dark:bg-slate-850 rounded-2xl border border-dashed border-slate-250 dark:border-slate-800">
                    No active transactions logged in this session yet. Tapping sync or updating your records will populate this feed.
                  </div>
                ) : (
                  <div className="border border-slate-150 dark:border-slate-800/80 rounded-2xl overflow-hidden max-h-60 overflow-y-auto overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs min-w-[500px]">
                      <thead>
                        <tr className="bg-slate-900 dark:bg-slate-950 border-b border-slate-800 text-[10px] font-bold text-white uppercase tracking-wider">
                          <th className="p-3">Time / Type</th>
                          <th className="p-3">Path & Payload</th>
                          <th className="p-3 text-right">Size</th>
                          <th className="p-3 text-center">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {dbInteractions.map((op) => (
                          <tr key={op.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-850/20">
                            <td className="p-3">
                              <span className="block font-mono text-[10px] text-slate-400">{op.timestamp}</span>
                              <span className={`inline-block text-[9px] font-bold px-1.5 py-0.2 rounded-md ${
                                op.type === 'upload' ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/25 dark:text-indigo-400' :
                                op.type === 'download' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/25 dark:text-emerald-400' :
                                op.type === 'delete' ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/25 dark:text-rose-400' :
                                'bg-amber-50 text-amber-600 dark:bg-amber-950/25 dark:text-amber-400'
                              }`}>
                                {op.type.toUpperCase()}
                              </span>
                            </td>
                            <td className="p-3 font-mono max-w-[180px]" title={op.path}>
                              <span className="block text-[9px] font-bold text-slate-500 mb-0.5">{op.database === 'Supabase' ? 'Supabase' : 'Firebase'}</span>
                              <span className="block text-[10px] font-semibold text-slate-700 dark:text-slate-200 truncate">{getSyncLabel(op.path)}</span>
                              <span className="block text-[8px] text-slate-450 dark:text-slate-550 truncate">{op.path}</span>
                            </td>
                            <td className="p-3 text-right font-mono text-slate-650 dark:text-slate-350">
                              {op.sizeBytes > 0 ? `${op.sizeBytes} B` : '-'}
                            </td>
                            <td className="p-3 text-center">
                              <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                op.status === 'completed' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400' :
                                op.status === 'pending' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-400 animate-pulse' :
                                'bg-rose-100 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400'
                              }`}>
                                {op.status} {op.status === 'pending' && op.startTimeMs ? `(${Math.floor((now - op.startTimeMs) / 1000)}s)` : ''}
                              </span>
                              {op.status === 'pending' && op.startTimeMs && now - op.startTimeMs > 5000 && (
                                <span className="block text-[9px] text-amber-600 dark:text-amber-500 mt-1" title="Waiting for server acknowledgment or offline sync queue">
                                  Waiting for connection...
                                </span>
                              )}
                              {op.errorMessage && (
                                <span className="block text-[9px] text-rose-500 mt-1 text-left max-w-[120px] truncate" title={op.errorMessage}>
                                  {op.errorMessage}
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

                  {/* Cloud Sync Mode Strategy Select Card */}
                  <div className="p-5 bg-indigo-50/30 dark:bg-slate-800/40 border border-indigo-100/40 dark:border-slate-800 rounded-2xl space-y-3.5">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-theme-text flex items-center gap-1.5">
                      <Cloud className="w-4.5 h-4.5 text-indigo-500" />
                      <span>Cloud Sync Mode</span>
                    </h3>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider h-fit shrink-0 ${
                    autoSyncDisabled 
                      ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/30 dark:text-amber-400' 
                      : 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/30 dark:text-indigo-400'
                  }`}>
                    {autoSyncDisabled ? 'Manual (Local-Only)' : 'Automatic'}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => handleToggleAutoSync(false)}
                    className={`p-3.5 rounded-xl border text-xs font-bold text-center transition-all flex flex-col items-center justify-center gap-2 cursor-pointer hover:scale-[1.01] ${
                      !autoSyncDisabled
                        ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm font-extrabold'
                        : 'bg-white hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-850 text-slate-750 dark:text-slate-300 border-slate-200 dark:border-slate-800'
                    }`}
                  >
                    <RefreshCw className={`w-4 h-4 ${(!autoSyncDisabled || syncState === 'syncing') ? 'animate-spin' : ''}`} />
                    <span>Auto Sync</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleToggleAutoSync(true)}
                    className={`p-3.5 rounded-xl border text-xs font-bold text-center transition-all flex flex-col items-center justify-center gap-2 cursor-pointer hover:scale-[1.01] ${
                      autoSyncDisabled
                        ? 'bg-amber-500 border-amber-500 text-white shadow-sm font-extrabold'
                        : 'bg-white hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-850 text-slate-750 dark:text-slate-300 border-slate-200 dark:border-slate-800'
                    }`}
                  >
                    <CloudLightning className="w-4 h-4" />
                    <span>Manual Sync Only</span>
                  </button>
                </div>

                {autoSyncDisabled && (
                  <div className="p-3 bg-amber-50/40 dark:bg-amber-950/15 border border-amber-200/20 rounded-xl flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse flex-shrink-0"></span>
                    <p className="text-[10px] text-amber-800 dark:text-amber-400 leading-normal font-medium">
                      Saving Firestore writes! Tap <strong>"Sync Now"</strong> or the Cloud icon in the header whenever you want to upload changes.
                    </p>
                  </div>
                )}
              </div>



              {/* Sync Diagnostics (cwah-only): view/copy/download the Supabase debug snapshot in-app */}
              {profile?.email?.toLowerCase().trim() === 'cwah.liu@gmail.com' && (
                <button
                  type="button"
                  onClick={() => setShowSyncDiagnostics(true)}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-2xl border border-slate-200/60 dark:border-slate-800 bg-slate-100 dark:bg-slate-850 text-xs font-bold text-slate-600 dark:text-slate-300"
                >
                  <Terminal className="w-4 h-4" />
                  Sync Diagnostics
                </button>
              )}

              {/* Dedupe Biomarker Logs (cwah-only): run the duplicate-row cleanup in-app instead of curl */}
              {profile?.email?.toLowerCase().trim() === 'cwah.liu@gmail.com' && (
                <button
                  type="button"
                  onClick={() => setShowDedupeBiomarkerLogs(true)}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-2xl border border-slate-200/60 dark:border-slate-800 bg-slate-100 dark:bg-slate-850 text-xs font-bold text-slate-600 dark:text-slate-300"
                >
                  <Trash2 className="w-4 h-4" />
                  Dedupe Biomarker Logs
                </button>
              )}

              {/* Admin / User View Toggle */}
              {profile?.email?.toLowerCase().trim() === 'cwah.liu@gmail.com' && (
                <div className="flex bg-slate-100 dark:bg-slate-850 p-1 rounded-2xl border border-slate-200/60 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => {
                      setDbOverlayViewMode('user');
                      localStorage.setItem('health_cockpit_admin_mode', 'user');
                    }}
                    className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                      dbOverlayViewMode === 'user'
                        ? 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 shadow-md border border-slate-200/20'
                        : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                    }`}
                  >
                    <User className="w-4 h-4" />
                    User View
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDbOverlayViewMode('admin');
                      localStorage.setItem('health_cockpit_admin_mode', 'admin');
                    }}
                    className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                      dbOverlayViewMode === 'admin'
                        ? 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 shadow-md border border-slate-200/20'
                        : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                    }`}
                  >
                    <ShieldCheck className="w-4 h-4" />
                    Admin View
                  </button>
                </div>
              )}



              {/* Interaction statistics row */}
              {dbOverlayViewMode === 'admin' && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-4 bg-indigo-50/40 dark:bg-indigo-950/20 border border-indigo-100/30 rounded-2xl relative overflow-hidden">
                    <div className="absolute inset-0 bg-indigo-600/5 dark:bg-indigo-400/5 w-full" style={{ width: `${Math.max(2, (dbInteractions.filter(i => i.type === 'upload' && i.status === 'completed').reduce((sum, i) => sum + i.sizeBytes, 0) / Math.max(1, dbInteractions.filter(i => i.type === 'upload').reduce((sum, i) => sum + i.sizeBytes, 0))) * 100)}%` }} />
                    <span className="block text-[10px] font-bold text-slate-400 dark:text-slate-550 uppercase tracking-wider mb-1">Upload Pipeline</span>
                    <div className="flex items-end justify-between">
                      <span className="text-lg font-mono font-semibold text-slate-900 dark:text-slate-100 relative z-10">
                        {(dbInteractions.filter(i => i.type === 'upload' && i.status === 'completed').reduce((sum, i) => sum + i.sizeBytes, 0) / 1024).toFixed(2)} KB
                      </span>
                      <span className="text-[10px] font-bold text-indigo-600 bg-indigo-100 dark:bg-indigo-900/40 px-1.5 py-0.5 rounded relative z-10">
                        {dbInteractions.filter(i => i.type === 'upload' && i.status === 'pending').length} pending
                      </span>
                    </div>
                    <span className="block text-[10px] text-slate-500 mt-1.5 font-medium relative z-10 truncate">
                      <strong className="text-slate-700 dark:text-slate-300">{(dbInteractions.filter(i => i.type === 'upload' && i.status === 'completed').reduce((sum, i) => sum + i.sizeBytes, 0) / 1024).toFixed(2)} KB</strong> achieved / {(dbInteractions.filter(i => i.type === 'upload').reduce((sum, i) => sum + i.sizeBytes, 0) / 1024).toFixed(2)} KB needed
                    </span>
                  </div>
                  
                  <div className="p-4 bg-emerald-50/40 dark:bg-emerald-950/20 border border-emerald-100/30 rounded-2xl relative overflow-hidden">
                    <div className="absolute inset-0 bg-emerald-600/5 dark:bg-emerald-400/5 w-full" style={{ width: `${Math.max(2, (dbInteractions.filter(i => i.type === 'download' && i.status === 'completed').reduce((sum, i) => sum + (i.sizeBytes || 1024), 0) / Math.max(1, dbInteractions.filter(i => i.type === 'download').reduce((sum, i) => sum + (i.sizeBytes || 1024), 0))) * 100)}%` }} />
                    <span className="block text-[10px] font-bold text-slate-400 dark:text-slate-550 uppercase tracking-wider mb-1">Download Pipeline</span>
                    <div className="flex items-end justify-between">
                      <span className="text-lg font-mono font-semibold text-slate-900 dark:text-slate-100 relative z-10">
                        {(dbInteractions.filter(i => i.type === 'download' && i.status === 'completed').reduce((sum, i) => sum + i.sizeBytes, 0) / 1024).toFixed(2)} KB
                      </span>
                      <span className="text-[10px] font-bold text-emerald-600 bg-emerald-100 dark:bg-emerald-900/40 px-1.5 py-0.5 rounded relative z-10">
                        {dbInteractions.filter(i => i.type === 'download' && i.status === 'pending').length} pending
                      </span>
                    </div>
                    <span className="block text-[10px] text-slate-500 mt-1.5 font-medium relative z-10 truncate">
                      <strong className="text-slate-700 dark:text-slate-300">{(dbInteractions.filter(i => i.type === 'download' && i.status === 'completed').length)}</strong> achieved / {dbInteractions.filter(i => i.type === 'download').length} needed
                    </span>
                  </div>
                </div>
              )}

              {/* Images Quota */}
              {dbOverlayViewMode === 'admin' && (
                <div className="p-4 bg-indigo-50/40 dark:bg-indigo-950/20 border border-indigo-100/30 rounded-2xl">
                  <span className="block text-[10px] font-bold text-slate-400 dark:text-slate-550 uppercase tracking-wider mb-1">Database Images (5GB Limit)</span>
                  <div className="flex items-end justify-between">
                    <span className="text-lg font-mono font-semibold text-slate-900 dark:text-slate-100 relative z-10">
                      {foodLogs.reduce((acc, log) => acc + (log.imageUrls?.length || 0) + (log.imageUrl ? 1 : 0), 0)} Images
                    </span>
                    <span className="text-xs font-bold text-indigo-600 bg-indigo-100 dark:bg-indigo-900/40 px-1.5 py-0.5 rounded relative z-10">
                      {(foodLogs.reduce((acc, log) => acc + (log.imageUrl ? log.imageUrl.length : 0) + (log.imageUrls ? log.imageUrls.reduce((sum, img) => sum + img.length, 0) : 0), 0) / (1024 * 1024)).toFixed(2)} MB
                    </span>
                  </div>
                </div>
              )}

              {/* API & Agent Call Tracker section */}
              {dbOverlayViewMode === 'admin' && (
                <button
                  type="button"
                  onClick={() => setIsTrackerOpen(true)}
                  className="w-full text-left p-4 bg-emerald-50/50 hover:bg-emerald-50 dark:bg-emerald-950/20 dark:hover:bg-emerald-950/30 border border-emerald-200/60 dark:border-emerald-800/60 rounded-2xl transition-all cursor-pointer group flex items-center justify-between"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <Activity className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-100">
                        API & Agent Call Tracker
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 block pl-6">
                      View real-time LLM API handshakes, token usage, latency & call logs
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-xs font-bold text-emerald-600 dark:text-emerald-400 group-hover:translate-x-0.5 transition-transform">
                    <span>Open Tracker</span>
                    <ChevronRight className="w-4 h-4" />
                  </div>
                </button>
              )}

              {/* AI Agent Live thinking / Debug Logs section */}
              {dbOverlayViewMode === 'admin' && (
                <div className="p-4 bg-slate-50 dark:bg-slate-900/40 border border-slate-150 dark:border-slate-800 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <span className="block text-[10px] font-bold text-slate-400 dark:text-slate-550 uppercase tracking-wider">
                        🔬 AI Agent Live thinking Process
                      </span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                        View real-time LLM API handshakes & timeouts
                      </span>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer select-none">
                      <input 
                        type="checkbox" 
                        className="sr-only peer" 
                        checked={debugMode}
                        onChange={(e) => handleToggleDebugMode(e.target.checked)}
                      />
                      <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-750 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-indigo-600"></div>
                    </label>
                  </div>
                </div>
              )}

                </>
              )}
            </div>

            {/* Footer: Interactive Fail-Proof Granular Sync Dashboard */}
            <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900/60 border-t border-slate-100 dark:border-slate-800 flex flex-col gap-4">
              <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
                <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {/* Food & Venues */}
                  <div 
                    onClick={() => setSelectedSyncCategory(selectedSyncCategory === 'food' ? null : 'food')}
                    className={`bg-white dark:bg-slate-800 border ${selectedSyncCategory === 'food' ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-slate-200 dark:border-slate-700'} p-2.5 rounded-xl flex flex-col justify-center cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-all`}
                  >
                    <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1 flex items-center justify-between">
                      <span className="flex items-center gap-1">🍔 Food & Venues</span>
                    </span>
                    <div className="flex items-center gap-2">
                      {(() => {
                        const total = (foodLogs || []).length;
                        // new/update = pushed to Cloudflare D1 this session via pushLogsToServer
                        // Only 'delete' tombstones awaiting server propagation are truly unresolved
                        const synced = (foodLogs || []).filter(f => !f?.sync_state || f?.sync_state === 'synced' || f?.sync_state === 'new' || f?.sync_state === 'update').length;
                        const percent = total > 0 ? Math.round((synced / total) * 100) : 100;
                        const pendingCount = total - synced;
                        const openDeferredGaps = catalogSyncStatus?.open_deferred_gaps || 0;
                        const syncFailures = catalogSyncStatus?.sync_failures || 0;
                        const hasCatalogIssues = openDeferredGaps > 0 || syncFailures > 0;
                        const isFullyGreen = percent === 100 && !hasCatalogIssues;

                        return (
                          <span className={`text-xs font-semibold ${isFullyGreen ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-500'}`}>
                            {percent}%{' '}
                            <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500 ml-1">
                              {percent === 100 ? `${total} logs` : `${pendingCount} pending`}
                              {catalogSyncStatus?.food_items && (
                                <span className="ml-1 font-semibold text-indigo-500 dark:text-indigo-400">
                                  ({catalogSyncStatus.food_items.active} active / {catalogSyncStatus.food_items.candidate} candidates / gaps:{openDeferredGaps} / fails:{syncFailures})
                                </span>
                              )}
                            </span>
                          </span>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Biomarkers */}
                  <div 
                    onClick={() => setSelectedSyncCategory(selectedSyncCategory === 'biomarker' ? null : 'biomarker')}
                    className={`bg-white dark:bg-slate-800 border ${selectedSyncCategory === 'biomarker' ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-slate-200 dark:border-slate-700'} p-2.5 rounded-xl flex flex-col justify-center cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-all`}
                  >
                    <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1 flex items-center justify-between">
                      <span className="flex items-center gap-1">🩸 Biomarkers</span>
                    </span>
                    <div className="flex items-center gap-2">
                      {(() => {
                        const total = (biomarkerHistory || []).length;
                        const synced = (biomarkerHistory || []).filter(b => !b?.sync_state || b?.sync_state === 'synced' || b?.sync_state === 'new' || b?.sync_state === 'update').length;
                        const percent = total > 0 ? Math.round((synced / total) * 100) : 100;
                        const pendingCount = total - synced;
                        const pendingFiles = (biomarkerHistory || [])
                          .filter(b => b?.sync_state && b?.sync_state !== 'synced' && b?.sync_state !== 'new' && b?.sync_state !== 'update')
                          .slice(0, 3)
                          .map(b => (b?.id || 'unknown').slice(0, 20))
                          .join(', ');
                        
                        return (
                          <span className={`text-xs font-semibold ${percent === 100 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-500'}`}>
                            {percent}%{' '}
                            <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500 ml-1">
                              {percent === 100 ? `${total} logs` : `${pendingCount} pending (${pendingFiles}${pendingCount > 3 ? '...' : ''})`}
                            </span>
                          </span>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Website / App */}
                  <div 
                    onClick={() => setSelectedSyncCategory(selectedSyncCategory === 'core' ? null : 'core')}
                    className={`bg-white dark:bg-slate-800 border ${selectedSyncCategory === 'core' ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-slate-200 dark:border-slate-700'} p-2.5 rounded-xl flex flex-col justify-center cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-all`}
                  >
                    <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1 flex items-center justify-between">
                      <span className="flex items-center gap-1">🌐 Core Data</span>
                    </span>
                    <div className="flex items-center gap-2">
                      {(() => {
                        const isPending = syncState === 'local' && localStorage.getItem('firestore_quota_exceeded') !== 'true';
                        const percent = isPending ? 98 : 100;
                        return (
                          <span className={`text-xs font-semibold ${percent === 100 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-500'}`}>
                            {percent}%{' '}
                            <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500 ml-1">
                              {percent === 100 ? `1` : `2 pending (profile, metadata)`}
                            </span>
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => setShowDbInteractionsOverlay(false)}
                  className="px-5 py-2 h-fit bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-2xl shadow-sm cursor-pointer transition-all shrink-0"
                >
                  Close Logs
                </button>
              </div>

              {/* Dynamic Sync Details Table */}
              {selectedSyncCategory && (
                <div className="mt-2 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm">
                  <div className="px-4 py-2 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                      {selectedSyncCategory === 'food' ? 'Food & Venues' : selectedSyncCategory === 'biomarker' ? 'Biomarker Logs' : 'Core Data (Website/App)'} Sync Details
                    </span>
                    <button onClick={() => setSelectedSyncCategory(null)} className="text-slate-400 hover:text-slate-600 p-1 rounded hover:bg-slate-200/50">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="max-h-[250px] overflow-y-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50/50 dark:bg-slate-900/20 text-[10px] font-bold text-slate-500 dark:text-slate-450 uppercase tracking-wider border-b border-slate-200 dark:border-slate-700">
                          <th className="px-4 py-2">ID / File</th>
                          <th className="px-4 py-2">Cloudflare D1 (Authority)</th>
                          <th className="px-4 py-2">Local Storage</th>
                        </tr>
                      </thead>
                      <tbody className="text-xs divide-y divide-slate-100 dark:divide-slate-800">
                        {selectedSyncCategory === 'core' && (
                          <>
                            <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                              <td className="px-4 py-2.5 font-mono text-[10px] text-slate-600 dark:text-slate-300">profile.json</td>
                              <td className="px-4 py-2.5"><span className="text-emerald-600 dark:text-emerald-400 font-semibold text-[10px] bg-emerald-50 dark:bg-emerald-900/30 px-1.5 py-0.5 rounded">Synced</span></td>
                              <td className="px-4 py-2.5"><span className="text-emerald-600 dark:text-emerald-400 font-semibold text-[10px] bg-emerald-50 dark:bg-emerald-900/30 px-1.5 py-0.5 rounded">Synced</span></td>
                            </tr>
                            <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                              <td className="px-4 py-2.5 font-mono text-[10px] text-slate-600 dark:text-slate-300">metadata.json</td>
                              <td className="px-4 py-2.5"><span className="text-emerald-600 dark:text-emerald-400 font-semibold text-[10px] bg-emerald-50 dark:bg-emerald-900/30 px-1.5 py-0.5 rounded">Synced</span></td>
                              <td className="px-4 py-2.5"><span className="text-emerald-600 dark:text-emerald-400 font-semibold text-[10px] bg-emerald-50 dark:bg-emerald-900/30 px-1.5 py-0.5 rounded">Synced</span></td>
                            </tr>
                          </>
                        )}
                        {(selectedSyncCategory === 'food' ? (foodLogs || []) : selectedSyncCategory === 'biomarker' ? (biomarkerHistory || []) : [])
                          .sort((a, b) => {
                            const aPending = a.sync_state && a.sync_state !== 'synced';
                            const bPending = b.sync_state && b.sync_state !== 'synced';
                            return (aPending === bPending) ? 0 : aPending ? -1 : 1; // Pending first
                          })
                          .map((log: any) => {
                            const isSynced = !log.sync_state || log.sync_state === 'synced' || log.sync_state === 'new' || log.sync_state === 'update';
                            return (
                              <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                <td className="px-4 py-2.5 font-mono text-[10px] text-slate-600 dark:text-slate-300 truncate max-w-[200px]">
                                  {log.name ? `${log.name} (${log.id || log.date})` : (log.id || log.date)}
                                </td>
                                <td className="px-4 py-2.5">
                                  {isSynced ? (
                                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold text-[10px] bg-emerald-50 dark:bg-emerald-900/30 px-1.5 py-0.5 rounded">Synced</span>
                                  ) : (
                                    <span className="text-amber-500 font-semibold text-[10px] bg-amber-50 dark:bg-amber-950/30 px-1.5 py-0.5 rounded animate-pulse">Pending ({log.sync_state})</span>
                                  )}
                                </td>
                                <td className="px-4 py-2.5">
                                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold text-[10px] bg-emerald-50 dark:bg-emerald-900/30 px-1.5 py-0.5 rounded">Saved locally</span>
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                  {selectedSyncCategory === 'food' && catalogSyncStatus && (
                    <div className="p-3 bg-slate-50/80 dark:bg-slate-900/40 border-t border-slate-200 dark:border-slate-700 text-xs flex flex-col gap-2">
                      <div className="font-bold text-slate-700 dark:text-slate-200 text-[11px] flex items-center justify-between">
                        <span>Food Catalog Telemetry</span>
                        <span className="text-[10px] font-mono text-slate-500">Active: {catalogSyncStatus.food_items?.active || 0} | Candidates: {catalogSyncStatus.food_items?.candidate || 0} | Gaps: {catalogSyncStatus.open_deferred_gaps || 0}</span>
                      </div>
                      {catalogSyncStatus.latest_sync_events && catalogSyncStatus.latest_sync_events.length > 0 && (
                        <div className="flex flex-col gap-1">
                          <span className="text-[10px] font-semibold text-slate-400 uppercase">Recent Catalog Events:</span>
                          {catalogSyncStatus.latest_sync_events.slice(0, 5).map((evt: any, i: number) => (
                            <div key={i} className="text-[10px] font-mono flex items-center justify-between text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 px-2 py-1 rounded border border-slate-200 dark:border-slate-700">
                              <span>{evt.event_type}</span>
                              <span className="text-[9px] text-slate-400">{evt.created_at ? new Date(evt.created_at).toLocaleTimeString() : 'just now'}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      ), document.body)}
    </>
  );
}
