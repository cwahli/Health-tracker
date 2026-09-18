import { useState, useEffect, useRef, useCallback } from 'react';
import { JobStore } from '../jobs/JobStore';
import { AgentJob } from '../jobs/types';

export interface UseJobPollerReturn {
  allJobs: AgentJob[];
  activeJobId: string | null;
  activeJob: AgentJob | undefined;
  setActiveJobId: (id: string | null) => void;
  isPolling: boolean;
  clearCompletedJobs: () => void;
}

export function useJobPoller(): UseJobPollerReturn {
  const [allJobs, setAllJobs] = useState<AgentJob[]>(() => JobStore.getAllJobs());
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Subscribe to JobStore updates
  useEffect(() => {
    const unsubscribe = JobStore.subscribe(() => {
      setAllJobs(JobStore.getAllJobs());
    });
    return () => {
      unsubscribe();
    };
  }, []);

  const activeJob = activeJobId ? JobStore.getJob(activeJobId) : undefined;

  // Background poller for active job
  const pollActiveJob = useCallback(async (jobId: string) => {
    try {
      const res = await fetch(`/api/jobs/status?jobId=${encodeURIComponent(jobId)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.jobs && Array.isArray(data.jobs)) {
          const serverJob = data.jobs.find((j: any) => j.id === jobId);
          if (serverJob) {
            JobStore.apply({
              type: 'ServerStatus',
              id: serverJob.id,
              status: serverJob.status,
              clean_result: serverJob.clean_result,
              result: serverJob.result || serverJob.clean_result,
              error: serverJob.error,
              steps: serverJob.steps,
              updatedAt: serverJob.updated_at
            });

            // Stop polling if job reached terminal status
            if (['succeeded', 'failed', 'cancelled'].includes(serverJob.status)) {
              setIsPolling(false);
              return;
            }
          }
        }
      }
    } catch {
      // transient network error, retry next tick
    }

    // Schedule next poll if still active
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    pollTimerRef.current = setTimeout(() => {
      pollActiveJob(jobId);
    }, 1200);
  }, []);

  useEffect(() => {
    if (!activeJobId) {
      setIsPolling(false);
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      return;
    }

    const job = JobStore.getJob(activeJobId);
    if (!job || ['succeeded', 'failed', 'cancelled'].includes(job.status)) {
      setIsPolling(false);
      return;
    }

    setIsPolling(true);
    pollActiveJob(activeJobId);

    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [activeJobId, pollActiveJob]);

  const clearCompletedJobs = useCallback(() => {
    const queue = JobStore.getQueue();
    // Keep only active queue jobs
    setAllJobs(queue);
  }, []);

  return {
    allJobs,
    activeJobId,
    activeJob,
    setActiveJobId,
    isPolling,
    clearCompletedJobs
  };
}
