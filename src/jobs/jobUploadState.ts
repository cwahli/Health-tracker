export function isJobSafeToLeave(job: any): boolean {
  if (!job) return true;
  // If the job already has an uploaded photoUrl or has progressed beyond initial client stage
  if (job.photoUrl || job.status === 'running' || job.status === 'succeeded' || job.status === 'failed') {
    return true;
  }
  if (!job.images || job.images.length === 0) {
    return true;
  }
  return false;
}
