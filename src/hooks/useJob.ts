import { useState, useEffect } from 'react';
import { JobStore } from '../jobs/JobStore';
import { AgentJob } from '../jobs/types';

export function useJob(jobId?: string | null): { job: AgentJob | undefined } {
  const [job, setJob] = useState<AgentJob | undefined>(() => (jobId ? JobStore.getJob(jobId) : undefined));

  useEffect(() => {
    if (!jobId) {
      setJob(undefined);
      return;
    }
    const update = () => {
      const current = JobStore.getJob(jobId);
      setJob(current ? { ...current } : undefined);
    };
    update();
    const unsub = JobStore.subscribe(update);
    return unsub;
  }, [jobId]);

  return { job };
}
