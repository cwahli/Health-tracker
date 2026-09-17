import { useState, useEffect } from 'react';
import { JobStore } from '../jobs/JobStore';
import { AgentJob } from '../jobs/types';

export function useJob(jobId: string | null) {
  const [job, setJob] = useState<AgentJob | undefined>(undefined);

  useEffect(() => {
    if (!jobId) {
      setJob(undefined);
      return;
    }

    const update = () => {
      const live = JobStore.getJob(jobId);
      setJob(live ? { ...live } : undefined);
    };

    update();
    const unsubscribe = JobStore.subscribe(update);
    return () => {
      unsubscribe();
    };
  }, [jobId]);

  return {
    job,
    progressPercent: job?.progressPercent || 0,
    statusMessage: job?.statusMessage || '',
  };
}
