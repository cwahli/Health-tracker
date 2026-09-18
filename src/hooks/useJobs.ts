import { useState, useEffect } from 'react';
import { JobStore } from '../jobs/JobStore';
import { AgentJob } from '../jobs/types';

export function useJobs() {
  const [jobs, setJobs] = useState<AgentJob[]>([]);
  const [queue, setQueue] = useState<AgentJob[]>([]);
  const [activeJob, setActiveJob] = useState<AgentJob | null>(null);

  useEffect(() => {
    const update = () => {
      const all = JobStore.getAllJobs();
      setJobs(all);
      setQueue(JobStore.getQueue());
      setActiveJob(all.find(j => j.status === 'running') || null);
    };

    update();
    const unsubscribe = JobStore.subscribe(update);
    return () => {
      unsubscribe();
    };
  }, []);

  return { jobs, queue, activeJob };
}
