import { AgentJob } from './types';
import { JobStore } from './JobStore';

// [FreeTier] thin clean_result
export const isDirectClientSupabaseDisabled = true;

let syncInterval: any = null;
let currentUserId: string | null = null;
let activeJobCallback: ((job: AgentJob) => void) | null = null;

export function hasActiveJob(): boolean {
  const jobs = JobStore.getAllJobs();
  return jobs.some((j) => j.status === 'queued' || j.status === 'running');
}

export async function hydrateUserJobs(userId?: string): Promise<AgentJob[]> {
  if (!userId) return [];
  try {
    const res = await fetch(`/api/jobs/list?userId=${encodeURIComponent(userId)}`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.jobs)) {
        for (const j of data.jobs) {
          JobStore.apply(j);
        }
        return data.jobs;
      }
    }
  } catch {
    // network fallback
  }
  return [];
}

export async function upsertJobToSupabase(job: AgentJob): Promise<void> {
  if (!job || !job.id) return;
  try {
    // [FreeTier] thin clean_result: do not pack heavy fields directly
    const payload = {
      id: job.id,
      status: job.status,
      current_turn: job.currentTurn ?? job.current_turn,
      photoUrl: job.photoUrl,
      updated_at: job.updatedAt || new Date().toISOString(),
    };
    await fetch('/api/jobs/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    // ignore sync network errors
  }
}

export function initSupabaseJobSync(userId?: string, onJobUpdate?: (job: AgentJob) => void): () => void {
  currentUserId = userId || null;
  activeJobCallback = onJobUpdate || null;

  if (syncInterval) clearInterval(syncInterval);

  // Poll gated on hasActiveJob with interval >= 5000ms
  syncInterval = setInterval(() => {
    if (hasActiveJob() && currentUserId) {
      hydrateUserJobs(currentUserId).then((jobs) => {
        if (activeJobCallback && jobs.length > 0) {
          jobs.forEach((j) => activeJobCallback!(j));
        }
      });
    }
  }, 10000);

  return () => {
    if (syncInterval) {
      clearInterval(syncInterval);
      syncInterval = null;
    }
  };
}
