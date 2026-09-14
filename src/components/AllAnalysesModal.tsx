import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  Check, CheckCircle2, Clock, Loader2, X, Trash2, Save, Eye,
  Utensils, Stethoscope, RotateCcw, Search, Filter, Sparkles,
  ChevronDown, ChevronUp, FileText, Activity, CheckCheck,
  AlertCircle, AlertTriangle, Scale, Layers
} from 'lucide-react';
import { JobStore, isJobBlank } from '../jobs/JobStore';
import { AgentJob } from '../jobs/types';
import { UserProfile, FoodLog } from '../types';
import { ImageStore } from '../jobs/ImageStore';
import { JobQueueRunner } from '../jobs/JobQueueRunner';
import { ZoomableImage } from './ZoomableImage';
import { normalizeMealImageUrl } from '../utils/foodImageSources';
import { getCurrentDateInTimezone } from '../utils/dateUtils';

interface AllAnalysesModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: UserProfile;
  foodLogs?: FoodLog[];
  setFoodLogs?: (f: FoodLog[]) => void;
  biomarkerHistory?: any[];
  setBiomarkerHistory?: (b: any[]) => void;
  biomarkers?: any;
  actions?: any[];
  dailyBenefits?: any[];
  report?: any;
  onSaveAndSync?: (
    profile: any,
    foodLogs: any[],
    biomarkers: any,
    biomarkerHistory: any[],
    actions: any[],
    dailyBenefits: any[],
    report: any,
    specificUpdate?: any
  ) => Promise<void>;
  onNavigateTab?: (tab: string) => void;
  onViewJob?: (jobId: string) => void;
}

export function AllAnalysesModal({
  isOpen,
  onClose,
  profile,
  foodLogs = [],
  setFoodLogs,
  biomarkerHistory = [],
  setBiomarkerHistory,
  biomarkers,
  actions,
  dailyBenefits,
  report,
  onSaveAndSync,
  onNavigateTab,
  onViewJob
}: AllAnalysesModalProps) {
  const [jobs, setJobs] = useState<AgentJob[]>([]);
  const [activeTab, setActiveTab] = useState<'all' | 'ready' | 'active' | 'completed'>('all');
  const [kindFilter, setKindFilter] = useState<'all' | 'food' | 'medical' | 'other'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [savingJobIds, setSavingJobIds] = useState<Record<string, boolean>>({});
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [expandedLogIds, setExpandedLogIds] = useState<Record<string, boolean>>({});
  const [previewImage, setPreviewImage] = useState<{ src: string; foodName?: string } | null>(null);
  const [deletingJobIds, setDeletingJobIds] = useState<Record<string, boolean>>({});
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  // Subscribe to JobStore updates
  useEffect(() => {
    if (!isOpen) return;
    const updateJobs = () => {
      const all = JobStore.getAllJobs();
      const valid = all.filter(j => !isJobBlank(j));

      // Asynchronously prune any orphaned blank/draft jobs from the store
      const blank = all.filter(j => isJobBlank(j));
      if (blank.length > 0) {
        blank.forEach(b => {
          JobStore.deleteJob(b.id).catch(() => {});
        });
      }

      // Sort newest first
      setJobs([...valid].sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()));
    };
    updateJobs();
    const unsubscribe = JobStore.subscribe(updateJobs);
    return () => {
      unsubscribe();
    };
  }, [isOpen]);

  // ESC key to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Show auto-dismissing toast notification
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Group job metrics
  const readyJobs = useMemo(() => {
    return jobs.filter(j => !isJobBlank(j) && j.status === 'succeeded' && !j.result?.savedToHistory && !j.viewed && !j.result?.viewed && !j.savedToLog);
  }, [jobs]);

  const activeJobs = useMemo(() => {
    return jobs.filter(j => !isJobBlank(j) && (j.status === 'running' || j.status === 'queued' || j.status === 'processing' || j.status === 'awaiting_user'));
  }, [jobs]);

  const completedJobs = useMemo(() => {
    return jobs.filter(j => !isJobBlank(j) && j.status === 'succeeded' && (j.result?.savedToHistory || j.viewed || j.result?.viewed || j.savedToLog));
  }, [jobs]);

  // Filter jobs based on active tab, kind filter, and search text
  const filteredJobs = useMemo(() => {
    return jobs.filter(job => {
      if (isJobBlank(job)) return false;

      // Tab filter
      if (activeTab === 'ready') {
        const isReady = job.status === 'succeeded' && !job.result?.savedToHistory && !job.viewed && !job.result?.viewed && !job.savedToLog;
        if (!isReady) return false;
      } else if (activeTab === 'active') {
        const isActive = job.status === 'running' || job.status === 'queued' || job.status === 'processing' || job.status === 'awaiting_user';
        if (!isActive) return false;
      } else if (activeTab === 'completed') {
        const isDone = job.status === 'succeeded' && (job.result?.savedToHistory || job.viewed || job.result?.viewed || job.savedToLog);
        if (!isDone) return false;
      }

      // Kind filter
      const isMedical = job.kind === 'medical';
      const isFood = job.kind === 'food_log' || job.kind === 'food' || job.kind === 'food_compare' || !job.kind;
      if (kindFilter === 'food' && !isFood) return false;
      if (kindFilter === 'medical' && !isMedical) return false;
      if (kindFilter === 'other' && (isFood || isMedical)) return false;

      // Search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const pendingFoodLog = getPendingFoodLog(job);
        const textToSearch = [
          job.id,
          job.kind,
          job.status,
          job.statusMessage,
          job.inputSnapshot?.text,
          pendingFoodLog?.foodName,
          pendingFoodLog?.name,
          pendingFoodLog?.summary,
          job.result?.summary,
          job.result?.doctorSummary,
          job.result?.rawText
        ].filter(Boolean).join(' ').toLowerCase();

        if (!textToSearch.includes(query)) return false;
      }

      return true;
    });
  }, [jobs, activeTab, kindFilter, searchQuery]);

  // Helper to extract pending food log from job result
  function getPendingFoodLog(job: AgentJob): any {
    return (
      job.result?.pendingFoodLog ||
      job.result?.clean_result?.pendingFoodLog ||
      job.result?.raw?.data ||
      job.result?.data ||
      job.result?.foodData ||
      job.result?.mealBuild?.content ||
      job.mealBuild?.content ||
      (job.result?.items ? job.result : null) ||
      job.messages?.slice().reverse().find((m: any) => m.pendingFoodLog)?.pendingFoodLog ||
      job.messages?.slice().reverse().find((m: any) => m.data?.pendingFoodLog)?.data?.pendingFoodLog ||
      null
    );
  }

  // Resolve best photo URL for job
  function getJobPhotoUrl(job: AgentJob): string | null {
    const pendingLog = getPendingFoodLog(job);
    const directUrl =
      job.photoUrl ||
      job.result?.photoUrl ||
      job.result?.clean_result?.photoUrl ||
      (job.result as any)?.data?.photoUrl ||
      pendingLog?.imageUrl ||
      (pendingLog?.imageUrls && pendingLog.imageUrls[0]) ||
      job.inputSnapshot?.imageRefs?.[0] ||
      null;

    return directUrl ? normalizeMealImageUrl(directUrl) || directUrl : null;
  }

  // Save a food job or medical job to user history
  const handleSaveJobToHistory = async (job: AgentJob) => {
    if (savingJobIds[job.id]) return;
    setSavingJobIds(prev => ({ ...prev, [job.id]: true }));

    try {
      if (job.kind === 'medical') {
        // Save medical biomarkers
        const filledBiomarkers = job.result?.filledRows ? Object.fromEntries(job.result.filledRows.filter((r: any) => r.key && r.value !== undefined && r.value !== null).map((r: any) => [r.key, r.value])) : {};
        const biomarkersToSave = Object.keys(filledBiomarkers).length > 0 ? filledBiomarkers : (job.result?.biomarkers || job.result?.extractedData?.biomarkers || {});
        const summary = job.result?.summary || job.result?.doctorSummary || 'Medical record analysis';
        const date = job.result?.date || new Date().toISOString().split('T')[0];

        const newBioLog = {
          id: `bio_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          date,
          biomarkers: biomarkersToSave,
          summary,
          sourceReportId: job.id,
          sync_state: 'synced',
          updated_at: Date.now()
        };

        if (setBiomarkerHistory && biomarkerHistory) {
          const updated = [newBioLog, ...biomarkerHistory.filter((b: any) => b.id !== newBioLog.id)];
          setBiomarkerHistory(updated);
          if (onSaveAndSync) {
            await onSaveAndSync(profile, foodLogs, biomarkers, updated, actions, dailyBenefits, report, { type: 'biomarkerLogsBatch' });
          }
        }
        showToast('Medical record saved to history!');
      } else {
        // Save food log
        const pendingLog = getPendingFoodLog(job);
        let photoUrl = getJobPhotoUrl(job);

        // Try getting images from ImageStore if base64 needed
        if (!photoUrl) {
          try {
            const rawImages = await ImageStore.getImages(job.id);
            if (rawImages && rawImages.length > 0) {
              const firstImg = rawImages[0];
              if (typeof firstImg === 'string') photoUrl = firstImg;
            }
          } catch (e) {
            console.warn('[AllAnalysesModal] ImageStore fetch failed:', e);
          }
        }

        const foodName = pendingLog?.name || pendingLog?.foodName || pendingLog?.mealName || job.inputSnapshot?.text || 'Logged Meal';
        const fallbackDate = profile?.timezone ? getCurrentDateInTimezone(profile.timezone) : new Date().toISOString().split('T')[0];
        const newLog: FoodLog = {
          id: pendingLog?.id || `food_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          date: pendingLog?.date || fallbackDate,
          name: foodName,
          composition: pendingLog?.composition || '',
          weightGrams: pendingLog?.weightGrams || 0,
          quantity: pendingLog?.quantity || '1 serving',
          description: pendingLog?.summary || pendingLog?.description || job.result?.summary || '',
          nutrients: pendingLog?.nutrients || {},
          imageUrl: photoUrl || '',
          imageUrls: photoUrl ? [photoUrl] : [],
          sync_state: 'synced',
          updated_at: Date.now()
        };

        if (setFoodLogs && foodLogs) {
          const updatedFoods = [newLog, ...foodLogs.filter(f => f.id !== newLog.id)];
          setFoodLogs(updatedFoods);
          if (onSaveAndSync) {
            await onSaveAndSync(profile, updatedFoods, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'foodLog', targetId: newLog.id });
          }
        }
        showToast(`Saved "${foodName}" to food log!`);
      }

      // Mark job as saved and viewed
      JobStore.updateJob(job.id, {
        savedToLog: true,
        viewed: true,
        result: {
          ...(job.result || {}),
          savedToHistory: true,
          viewed: true
        }
      });
    } catch (err) {
      console.error('[AllAnalysesModal] Error saving job:', err);
      showToast('Failed to save analysis. Please try again.');
    } finally {
      setSavingJobIds(prev => ({ ...prev, [job.id]: false }));
    }
  };

  // Bulk action: Save all ready jobs
  const handleSaveAllReady = async () => {
    if (readyJobs.length === 0) return;
    let count = 0;
    for (const job of readyJobs) {
      await handleSaveJobToHistory(job);
      count++;
    }
    showToast(`Successfully saved all ${count} ready analyses!`);
  };

  // Bulk action: Mark all as read
  const handleMarkAllRead = () => {
    readyJobs.forEach(job => {
      JobStore.updateJob(job.id, {
        viewed: true,
        result: {
          ...(job.result || {}),
          viewed: true
        }
      });
    });
    showToast('Marked all ready analyses as read.');
  };

  // View job in main tab
  const handleNavigateToJob = (job: AgentJob) => {
    const isMedical = job.kind === 'medical';
    const targetTab = isMedical ? 'medical' : 'food';

    onClose();
    if (onNavigateTab) {
      onNavigateTab(targetTab);
    }
    if (onViewJob) {
      onViewJob(job.id);
    }

    setTimeout(() => {
      const el = document.getElementById(`job-${job.id}`) || document.getElementById(`task-card-${job.id}`) || document.getElementById(`food-log-${job.id}`) || document.getElementById(`food-log-item-${job.id}`) || document.getElementById(`food-log-item-${(job.result as any)?.pendingFoodLog?.id}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 200);
  };

  // Delete job from store
  const handleDeleteJob = async (jobId: string) => {
    setDeletingJobIds(prev => ({ ...prev, [jobId]: true }));
    await JobStore.deleteJob(jobId);
    setDeletingJobIds(prev => ({ ...prev, [jobId]: false }));
  };

  const handleDeleteAllJobs = async () => {
    setIsDeletingAll(true);
    const jobIds = jobs.map(j => j.id);
    for (const id of jobIds) {
      await JobStore.deleteJob(id);
    }
    setIsDeletingAll(false);
  };

  // Retry failed job
  const handleRetryJob = (job: AgentJob) => {
    JobStore.updateJob(job.id, {
      status: 'queued',
      progressPercent: 0,
      statusMessage: 'Queued for retry...',
      error: undefined
    });
    JobQueueRunner.wake();
    showToast('Re-queued job for analysis retry!');
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[99999] bg-slate-950/95 backdrop-blur-2xl text-slate-100 flex flex-col overflow-hidden animate-fade-in font-sans">
      {/* Top Header Navigation Bar */}
      <div className="sticky top-0 z-20 bg-slate-900/90 border-b border-slate-800/80 px-4 sm:px-8 py-4 backdrop-blur-md flex flex-wrap items-center justify-between gap-4 shadow-xl">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2.5 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 text-indigo-400">
            <Layers className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg sm:text-xl font-black tracking-tight text-white">All AI Analyses & Tasks</h2>
              <span className="text-xs px-2.5 py-0.5 rounded-full font-mono font-bold bg-slate-800 text-slate-300 border border-slate-700">
                {jobs.length} total
              </span>
            </div>
            
          </div>
        </div>

        {/* Header Action Controls */}
        <div className="flex items-center gap-2.5 flex-wrap">
          {readyJobs.length > 0 && (
            <button
              onClick={handleSaveAllReady}
              className="px-3.5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-950/50 border border-emerald-400/40 transition-all flex items-center gap-1.5 cursor-pointer active:scale-95"
              title="Save all unsaved completed analyses to your history"
            >
              <CheckCheck className="w-4 h-4" />
              <span>Save All Ready ({readyJobs.length})</span>
            </button>
          )}

          {readyJobs.length > 0 && (
            <button
              onClick={handleMarkAllRead}
              className="px-3 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-all flex items-center gap-1.5 cursor-pointer"
              title="Mark ready badge as read"
            >
              <Check className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Mark Read</span>
            </button>
          )}

          {jobs.length > 0 && (
            <button
              onClick={handleDeleteAllJobs}
              disabled={isDeletingAll}
              className="p-2.5 rounded-2xl bg-slate-800 hover:bg-rose-900/40 text-slate-400 hover:text-rose-400 border border-slate-700 hover:border-rose-900/50 transition-all cursor-pointer disabled:opacity-50 flex items-center gap-2"
              title="Delete all analyses"
            >
              {isDeletingAll ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                  <span className="text-xs font-bold text-slate-300 pr-1">Deleting...</span>
                </>
              ) : (
                <Trash2 className="w-5 h-5" />
              )}
            </button>
          )}

          <button
            onClick={onClose}
            className="p-2.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-all cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Toast Banner */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="absolute top-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-2xl bg-indigo-600 text-white font-semibold text-xs shadow-2xl border border-indigo-400/40 flex items-center gap-2"
          >
            <Sparkles className="w-4 h-4 text-amber-300 animate-spin" />
            <span>{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Filter & Metric Bar */}
      <div className="bg-slate-900/50 border-b border-slate-800/60 px-4 sm:px-8 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
        {/* Tab Selection */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
          <button
            onClick={() => setActiveTab('all')}
            className={`px-3.5 py-1.5 rounded-xl font-bold transition-all cursor-pointer flex items-center gap-1.5 shrink-0 ${
              activeTab === 'all'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'bg-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <span>All</span>
            <span className="opacity-75 font-mono text-[10px]">({jobs.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('ready')}
            className={`px-3.5 py-1.5 rounded-xl font-bold transition-all cursor-pointer flex items-center gap-1.5 shrink-0 ${
              activeTab === 'ready'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/40'
                : 'bg-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Ready</span>
            <span className="font-mono text-[10px]">({readyJobs.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('active')}
            className={`px-3.5 py-1.5 rounded-xl font-bold transition-all cursor-pointer flex items-center gap-1.5 shrink-0 ${
              activeTab === 'active'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'bg-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            {activeJobs.length > 0 && <Loader2 className="w-3 h-3 animate-spin text-indigo-300" />}
            <span>In Progress</span>
            <span className="font-mono text-[10px]">({activeJobs.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('completed')}
            className={`px-3.5 py-1.5 rounded-xl font-bold transition-all cursor-pointer flex items-center gap-1.5 shrink-0 ${
              activeTab === 'completed'
                ? 'bg-slate-700 text-white shadow-md'
                : 'bg-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <span>Saved & History</span>
            <span className="font-mono text-[10px]">({completedJobs.length})</span>
          </button>
        </div>

        {/* Kind Filters & Search Bar */}
        <div className="flex items-center gap-2 flex-1 max-w-md justify-end">
          {/* Category Dropdown */}
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as any)}
            className="px-2.5 py-1.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 text-xs font-medium cursor-pointer focus:outline-none focus:border-indigo-500"
          >
            <option value="all">All Types</option>
            <option value="food">🥗 Food & Nutrition</option>
            <option value="medical">🩺 Medical & Labs</option>
            <option value="other">📊 Other Analyses</option>
          </select>

          {/* Search Bar */}
          <div className="relative flex-1 min-w-[140px]">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search analysis..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-slate-800/90 border border-slate-700 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Analysis Cards Grid Container */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-8 scrollbar-thin scrollbar-thumb-slate-800">
        {filteredJobs.length === 0 ? (
          <div className="h-full min-h-[350px] flex flex-col items-center justify-center text-center p-8 text-slate-400">
            <div className="p-4 rounded-3xl bg-slate-900 border border-slate-800 mb-3 text-slate-500">
              <Search className="w-10 h-10 opacity-60" />
            </div>
            <h3 className="text-base font-bold text-slate-200">No matching analyses found</h3>
            <p className="text-xs text-slate-500 max-w-sm mt-1">
              {searchQuery
                ? `No results match "${searchQuery}". Try clearing your search query or switching tabs.`
                : activeTab === 'ready'
                ? 'You have no unsaved ready analyses at the moment.'
                : 'No analysis tasks are available under this filter.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 max-w-7xl mx-auto pb-16">
            {filteredJobs.map(job => (
              <AnalysisCard
                key={job.id}
                job={job}
                onSave={() => handleSaveJobToHistory(job)}
                isSaving={!!savingJobIds[job.id]}
                onViewInLog={() => handleNavigateToJob(job)}
                onDelete={() => handleDeleteJob(job.id)}
                isDeleting={!!deletingJobIds[job.id]}
                onRetry={() => handleRetryJob(job)}
                isExpanded={!!expandedLogIds[job.id]}
                onToggleExpand={() =>
                  setExpandedLogIds(prev => ({ ...prev, [job.id]: !prev[job.id] }))
                }
                onPreviewImage={(src, name) => setPreviewImage({ src, foodName: name })}
              />
            ))}
          </div>
        )}
      </div>

      {/* Full-screen Zoomable Image Modal when clicking a thumbnail */}
      {previewImage && (
        <ZoomableImage
          src={previewImage.src}
          foodName={previewImage.foodName}
          language={profile.language}
          onClose={() => setPreviewImage(null)}
        />
      )}

      
    </div>,
    document.body
  );
}

// Sub-component: Individual Analysis Card
interface AnalysisCardProps {
  job: AgentJob;
  onSave: () => void;
  isSaving: boolean;
  onViewInLog: () => void;
  onDelete: () => void;
  isDeleting?: boolean;
  onRetry: () => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onPreviewImage: (src: string, foodName?: string) => void;
}

function AnalysisCard({
  job,
  onSave,
  isSaving,
  onViewInLog,
  onDelete,
  isDeleting,
  onRetry,
  isExpanded,
  onToggleExpand,
  onPreviewImage
}: AnalysisCardProps) {
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const isMedical = job.kind === 'medical';
  const isFood = job.kind === 'food_log' || job.kind === 'food' || job.kind === 'food_compare' || !job.kind;
  
  const isReady = job.status === 'succeeded' && !job.result?.savedToHistory && !job.viewed && !job.result?.viewed && !job.savedToLog;
  const isSaved = job.status === 'succeeded' && (job.result?.savedToHistory || job.viewed || job.result?.viewed || job.savedToLog);
  const isRunning = job.status === 'running' || job.status === 'processing';
  const isQueued = job.status === 'queued';
  const isFailed = job.status === 'failed';

  // Extract analysis details
  const pendingFoodLog = (
    job.result?.pendingFoodLog ||
    job.result?.clean_result?.pendingFoodLog ||
    job.result?.raw?.data ||
    job.result?.data ||
    job.result?.foodData ||
    job.result?.mealBuild?.content ||
    job.mealBuild?.content ||
    (job.result?.items ? job.result : null) ||
    job.messages?.slice().reverse().find((m: any) => m.pendingFoodLog)?.pendingFoodLog ||
    job.messages?.slice().reverse().find((m: any) => m.data?.pendingFoodLog)?.data?.pendingFoodLog ||
    null
  );

  const foodName =
    pendingFoodLog?.foodName ||
    pendingFoodLog?.name ||
    pendingFoodLog?.title ||
    (job.mealBuild?.items?.length ? job.mealBuild.items.map((i: any) => i.name || i).join(', ') : null) ||
    (job.result?.items?.length ? job.result.items.map((i: any) => i.name || i).join(', ') : null) ||
    job.inputSnapshot?.text ||
    (isMedical ? 'Medical Document Analysis' : 'Meal Analysis');
  const mealType = pendingFoodLog?.mealType || 'snack';
  const calories = pendingFoodLog?.calories || 0;
  const nutrients = pendingFoodLog?.nutrients || {};
  const items = pendingFoodLog?.items || job.result?.items || [];
  const summary = pendingFoodLog?.summary || job.result?.summary || job.result?.doctorSummary || job.statusMessage || '';
  
  // Photo preview
  const photoUrl =
    job.photoUrl ||
    job.result?.photoUrl ||
    job.result?.clean_result?.photoUrl ||
    pendingFoodLog?.imageUrl ||
    (pendingFoodLog?.imageUrls && pendingFoodLog.imageUrls[0]) ||
    job.inputSnapshot?.imageRefs?.[0] ||
    null;

  const normalizedPhoto = photoUrl ? normalizeMealImageUrl(photoUrl) || photoUrl : null;

  // Format date
  const createdDateLabel = job.createdAt
    ? new Date(job.createdAt).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    : 'Recent';

  return (
    <div
      className={`rounded-3xl border transition-all flex flex-col justify-between overflow-hidden shadow-lg ${
        isReady
          ? 'bg-gradient-to-b from-slate-900 via-slate-900 to-emerald-950/20 border-emerald-500/50 shadow-emerald-950/20 ring-1 ring-emerald-500/30'
          : isRunning
          ? 'bg-slate-900/90 border-indigo-500/50 ring-1 ring-indigo-500/30'
          : isFailed
          ? 'bg-slate-900/90 border-rose-500/40'
          : 'bg-slate-900/80 border-slate-800'
      }`}
    >
      {/* Card Header & Status */}
      <div className="p-4 border-b border-slate-800/80 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {isMedical ? (
            <span className="p-1.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-400">
              <Stethoscope className="w-4 h-4" />
            </span>
          ) : (
            <span className="p-1.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
              <Utensils className="w-4 h-4" />
            </span>
          )}
          <span className="text-xs font-bold text-slate-300 truncate">
            {isMedical ? 'Medical Record' : 'Food Analysis'}
          </span>
        </div>

        {/* Status Badge */}
        <div>
          {isReady ? (
            <span className="px-2.5 py-1 rounded-full text-[10px] font-black bg-emerald-500/20 text-emerald-300 border border-emerald-400/50 flex items-center gap-1 animate-pulse">
              <Check className="w-3 h-3" /> Ready
            </span>
          ) : isSaved ? (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-400 border border-slate-700 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-slate-400" /> Saved
            </span>
          ) : isRunning ? (
            <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-400/40 flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin text-indigo-400" />
              {job.progressPercent > 0 ? `${job.progressPercent}%` : 'Analyzing'}
            </span>
          ) : isQueued ? (
            <span className="px-2.5 py-1 rounded-full text-[10px] font-medium bg-amber-500/20 text-amber-300 border border-amber-400/40 flex items-center gap-1">
              <Clock className="w-3 h-3" /> Queued
            </span>
          ) : isFailed ? (
            <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-400/40 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> Failed
            </span>
          ) : null}
        </div>
      </div>

      {/* Card Body */}
      <div className="p-4 space-y-3 flex-1">
        {/* Photo Thumbnail if available */}
        {normalizedPhoto && (
          <div
            onClick={() => onPreviewImage(normalizedPhoto, foodName)}
            className="relative h-36 w-full rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 group cursor-pointer"
          >
            <img
              src={normalizedPhoto}
              alt={foodName}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              referrerPolicy="no-referrer"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent opacity-60 group-hover:opacity-40 transition-opacity" />
            <span className="absolute bottom-2 right-2 text-[10px] font-bold px-2 py-1 rounded-lg bg-slate-900/90 text-slate-200 border border-slate-700 backdrop-blur-md flex items-center gap-1">
              <Eye className="w-3 h-3 text-indigo-400" /> Expand
            </span>
          </div>
        )}

        {/* Title & Metadata */}
        <div>
          <h4 className="text-sm font-black text-white leading-tight capitalize">{foodName}</h4>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] font-mono text-slate-400">{createdDateLabel}</span>
            {mealType && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 border border-slate-700/60 capitalize">
                {mealType}
              </span>
            )}
          </div>
        </div>

        {/* Calories & Key Nutrients Summary (for Food) */}
        {isFood && calories > 0 && (
          <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between text-xs font-mono">
            <div>
              <span className="text-slate-400 text-[10px] block font-sans font-medium uppercase">Calories</span>
              <span className="text-emerald-400 font-bold text-sm">{calories} kcal</span>
            </div>
            {nutrients.protein !== undefined && (
              <div className="text-right">
                <span className="text-slate-400 text-[10px] block font-sans font-medium uppercase">Protein</span>
                <span className="text-slate-200 font-semibold">{nutrients.protein}g</span>
              </div>
            )}
            {nutrients.carbs !== undefined && (
              <div className="text-right">
                <span className="text-slate-400 text-[10px] block font-sans font-medium uppercase">Carbs</span>
                <span className="text-slate-200 font-semibold">{nutrients.carbs}g</span>
              </div>
            )}
            {nutrients.fat !== undefined && (
              <div className="text-right">
                <span className="text-slate-400 text-[10px] block font-sans font-medium uppercase">Fat</span>
                <span className="text-slate-200 font-semibold">{nutrients.fat}g</span>
              </div>
            )}
          </div>
        )}

        {/* Items Breakdown list */}
        {items && items.length > 0 && (
          <div className="space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Items Analyzed</span>
            <div className="space-y-1">
              {items.slice(0, 3).map((item: any, idx: number) => (
                <div key={idx} className="text-xs px-2.5 py-1 rounded-lg bg-slate-800/60 border border-slate-800 flex items-center justify-between">
                  <span className="text-slate-200 font-medium truncate">{item.name || item.foodName}</span>
                  {item.calories ? (
                    <span className="text-[10px] font-mono text-emerald-400 shrink-0 ml-2">{item.calories} kcal</span>
                  ) : null}
                </div>
              ))}
              {items.length > 3 && (
                <span className="text-[10px] text-slate-500 italic block">+{items.length - 3} more items</span>
              )}
            </div>
          </div>
        )}

        {/* Summary text */}
        {summary && (
          <p className="text-xs text-slate-300 line-clamp-3 leading-relaxed bg-slate-950/40 p-2.5 rounded-xl border border-slate-800/60">
            {summary}
          </p>
        )}

        {/* Error message if failed */}
        {isFailed && job.error?.message && (
          <div className="p-2.5 rounded-xl bg-rose-950/40 border border-rose-800/60 text-xs text-rose-300 space-y-1">
            <div className="flex items-center gap-1.5 font-bold">
              <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
              <span>Analysis Error</span>
            </div>
            <p className="text-[11px] opacity-90">{job.error.message}</p>
          </div>
        )}

        {/* Collapsible Technical Execution Logs */}
        <div>
          <button
            onClick={onToggleExpand}
            className="text-[10px] font-semibold text-slate-400 hover:text-slate-200 flex items-center gap-1 transition-colors pt-1 cursor-pointer"
          >
            {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            <span>{isExpanded ? 'Hide Technical Details' : 'View AI Technical Details'}</span>
          </button>

          {isExpanded && (
            <div className="mt-2 p-2.5 rounded-xl bg-slate-950 border border-slate-800 font-mono text-[10px] text-slate-400 space-y-1">
              <div><span className="text-slate-500">Job ID:</span> {job.id}</div>
              <div><span className="text-slate-500">Kind:</span> {job.kind}</div>
              <div><span className="text-slate-500">Status:</span> {job.status}</div>
              {job.inputSnapshot?.text && (
                <div><span className="text-slate-500">Prompt:</span> {job.inputSnapshot.text}</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Card Action Bar */}
      <div className="p-3 bg-slate-950/70 border-t border-slate-800/80 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button
            onClick={onViewInLog}
            className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition-colors flex items-center gap-1 cursor-pointer"
            title="Jump to this analysis in log"
          >
            <Eye className="w-3.5 h-3.5 text-indigo-400" />
            <span>View</span>
          </button>

          {isDeleting ? (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-xl bg-slate-900 border border-slate-800">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-500" />
              <span className="text-[10px] font-bold text-slate-400">Deleting..</span>
            </div>
          ) : isConfirmingDelete ? (
            <div className="flex items-center gap-1 bg-rose-950/40 rounded-xl px-1 border border-rose-900/50">
              <button
                onClick={onDelete}
                className="px-2 py-1 text-[10px] font-bold text-rose-400 hover:text-rose-300 transition-colors cursor-pointer"
              >
                Confirm
              </button>
              <div className="w-[1px] h-3 bg-rose-900/50" />
              <button
                onClick={() => setIsConfirmingDelete(false)}
                className="px-2 py-1 text-[10px] font-bold text-slate-400 hover:text-slate-300 transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setIsConfirmingDelete(true)}
              className="p-1.5 rounded-xl text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition-colors cursor-pointer"
              title="Delete analysis task"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>

        <div>
          {isReady ? (
            <button
              onClick={onSave}
              disabled={isSaving}
              className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold border border-emerald-400/40 shadow-lg shadow-emerald-950/50 transition-all flex items-center gap-1.5 cursor-pointer active:scale-95 disabled:opacity-50"
            >
              {isSaving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              <span>Save to History</span>
            </button>
          ) : isFailed ? (
            <button
              onClick={onRetry}
              className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Retry</span>
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
