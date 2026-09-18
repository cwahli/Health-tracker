import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2, XCircle, Eye, CheckCircle2 } from 'lucide-react';
import { JobStore } from '../jobs/JobStore';
import { AgentJob } from '../jobs/types';
import { isJobSafeToLeave } from '../jobs/jobUploadState';

interface BackgroundTasksStatusProps {
  onViewJob: (jobId: string) => void;
}

export default function BackgroundTasksStatus({ onViewJob }: BackgroundTasksStatusProps) {
  const [activeJobs, setActiveJobs] = useState<AgentJob[]>([]);

  useEffect(() => {
    const update = () => {
      const all = JobStore.getAllJobs();
      const active = all.filter(j => j.status === 'queued' || j.status === 'running');
      setActiveJobs(active);
    };
    update();
    const unsubscribe = JobStore.subscribe(update);
    return () => {
      unsubscribe();
    };
  }, []);

  if (activeJobs.length === 0) return null;

  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 w-full max-w-sm px-4 pointer-events-none">
      <AnimatePresence>
        {activeJobs.map((job) => {
          const isRunning = job.status === 'running';
          return (
            <motion.div
              key={job.id}
              initial={{ opacity: 0, y: 50, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-slate-200 dark:border-slate-800 p-3.5 rounded-2xl shadow-xl pointer-events-auto flex items-center justify-between gap-3 mb-2"
              id={`bg-task-indicator-${job.id}`}
            >
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <Loader2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400 animate-spin flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      {isRunning ? 'Running' : 'Queued'}
                    </span>
                    {job.progressPercent > 0 && (
                      <span className="text-[10px] font-mono font-bold text-indigo-600 dark:text-indigo-400">
                        {job.progressPercent}%
                      </span>
                    )}
                  </div>
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 truncate mt-0.5">
                    {job.statusMessage || (job.kind === 'medical' ? 'Analyzing biomarkers...' : 'Analyzing meal photo...')}
                  </p>
                  {isJobSafeToLeave(job) ? (
                    <p className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1 mt-0.5">
                      <CheckCircle2 className="w-3 h-3 flex-shrink-0 text-emerald-500" />
                      <span>Uploaded • Safe to close browser</span>
                    </p>
                  ) : (
                    <p className="text-[10px] font-medium text-amber-600 dark:text-amber-400 mt-0.5">
                      Uploading… keep this tab open
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  onClick={() => onViewJob(job.id)}
                  className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-slate-50 dark:hover:bg-slate-850 rounded-lg transition-all cursor-pointer"
                  title="View Status"
                  id={`btn-view-status-${job.id}`}
                >
                  <Eye className="w-4 h-4" />
                </button>
                <button
                  onClick={() => JobStore.updateJob(job.id, { status: 'cancelled' })}
                  className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-slate-50 dark:hover:bg-slate-850 rounded-lg transition-all cursor-pointer"
                  title="Cancel Task"
                  id={`btn-cancel-task-${job.id}`}
                >
                  <XCircle className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
