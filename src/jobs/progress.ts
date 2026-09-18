export function getProgressPercent(job: any): number {
  if (!job) return 0;
  if (typeof job.progress_percent === 'number') return job.progress_percent;
  if (job.status === 'succeeded' || job.status === 'done') return 100;
  if (job.status === 'running') return 50;
  if (job.status === 'queued') return 10;
  return 0;
}

export function getStepCeiling(stage: string): number {
  switch (stage) {
    case 'upload': return 20;
    case 'scout': return 50;
    case 'dietitian': return 80;
    case 'finalize': return 95;
    default: return 100;
  }
}
