/**
 * Whether this job is actually on the server (photos + worker),
 * so the user can close the tab and resume on another signed-in device.
 */
export function isJobSafeToLeave(job: {
  serverSubmittedAt?: number | string;
  status?: string;
  statusMessage?: string | null;
} | null | undefined): boolean {
  if (!job) return false;
  if (/delayed|retrying submit|image conversion|keep this tab/i.test(String(job.statusMessage || ''))) {
    return false;
  }
  // Only a successful /api/jobs/submit for THIS run. A leftover https photo
  // from the previous meal on the same chat job is not enough.
  return !!job.serverSubmittedAt;
}
