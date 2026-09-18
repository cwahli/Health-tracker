import { AgentJob, JobStatus } from './types';

const STORAGE_KEY = 'jobstore_jobs';

class JobStoreClass {
  private jobs: Map<string, AgentJob> = new Map();
  private listeners: Set<() => void> = new Set();
  private initialized = false;

  constructor() {
    this.init();
  }

  private init() {
    if (this.initialized) return;
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            for (const j of parsed) {
              if (j && j.id) this.jobs.set(j.id, j);
            }
          } else if (typeof parsed === 'object') {
            for (const [k, v] of Object.entries(parsed)) {
              if (v && (v as any).id) this.jobs.set((v as any).id, v as AgentJob);
            }
          }
        }
      } catch {
        // localStorage parse error fallback
      }
    }
    this.initialized = true;
  }

  private persist() {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const obj: Record<string, AgentJob> = {};
        for (const [k, v] of this.jobs.entries()) {
          obj[k] = v;
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
      } catch {
        // ignore storage errors
      }
    }
  }

  private notify() {
    this.persist();
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // ignore listener errors
      }
    }
  }

  getAllJobs(): AgentJob[] {
    return Array.from(this.jobs.values());
  }

  getJob(id: string): AgentJob | undefined {
    return this.jobs.get(id);
  }

  get(id: string): AgentJob | undefined {
    return this.getJob(id);
  }

  getQueue(): AgentJob[] {
    return this.getAllJobs().filter((j) => j.status === 'queued' || j.status === 'running');
  }

  createJob(jobData: Partial<AgentJob> & { id: string }): AgentJob {
    const existing = this.jobs.get(jobData.id);
    const job: AgentJob = {
      id: jobData.id,
      status: jobData.status || 'queued',
      createdAt: jobData.createdAt || new Date().toISOString(),
      updatedAt: jobData.updatedAt || new Date().toISOString(),
      ...existing,
      ...jobData,
    };
    this.jobs.set(job.id, job);
    this.notify();
    return job;
  }

  updateJob(id: string, updates: Partial<AgentJob>): AgentJob | undefined {
    const current = this.jobs.get(id);
    if (!current) {
      return undefined;
    }

    // QUEUE_LIE invariant: running job is not clobbered back to queued by late client submit
    let targetStatus = updates.status !== undefined ? updates.status : current.status;
    if (current.status === 'running' && updates.status === 'queued') {
      targetStatus = 'running';
    }

    const updated: AgentJob = {
      ...current,
      ...updates,
      status: targetStatus,
      updatedAt: new Date().toISOString(),
    };

    this.jobs.set(id, updated);
    this.notify();
    return updated;
  }

  apply(eventOrJob: any): void {
    if (!eventOrJob) return;
    if (eventOrJob.type === 'ServerStatus' && eventOrJob.id) {
      const existing = this.jobs.get(eventOrJob.id);
      if (existing) {
        this.updateJob(eventOrJob.id, {
          status: eventOrJob.status || existing.status,
          clean_result: eventOrJob.clean_result !== undefined ? eventOrJob.clean_result : existing.clean_result,
          result: eventOrJob.result !== undefined ? eventOrJob.result : existing.result,
          error: eventOrJob.error !== undefined ? eventOrJob.error : existing.error,
          progress_percent: eventOrJob.progress_percent !== undefined ? eventOrJob.progress_percent : existing.progress_percent,
        });
      } else {
        this.createJob({
          id: eventOrJob.id,
          status: eventOrJob.status || 'running',
          clean_result: eventOrJob.clean_result,
          result: eventOrJob.result,
        });
      }
      return;
    }

    if (eventOrJob.id) {
      const existing = this.jobs.get(eventOrJob.id);
      if (existing) {
        this.updateJob(eventOrJob.id, eventOrJob);
      } else {
        this.createJob(eventOrJob);
      }
    }
  }

  removeJob(id: string): void {
    this.jobs.delete(id);
    this.notify();
  }

  remove(id: string): void {
    this.removeJob(id);
  }

  clear(): void {
    this.jobs.clear();
    this.notify();
  }

  resetAllJobs(): void {
    this.jobs.clear();
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {}
    }
    this.notify();
  }

  clearForTests(): void {
    this.jobs.clear();
    this.listeners.clear();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export const JobStore = new JobStoreClass();

export function isStalePriorTurn(job: any, turnOrStatus?: any, finishedAtOrTime?: any): boolean {
  if (!job) return false;
  if (!job.inFlightTurnAt) return false;

  if (finishedAtOrTime) {
    const finishedTs = typeof finishedAtOrTime === 'number' ? finishedAtOrTime : new Date(finishedAtOrTime).getTime();
    if (!isNaN(finishedTs) && finishedTs < job.inFlightTurnAt) {
      return true;
    }
  }
  return false;
}

export function isJobBlank(job: any): boolean {
  if (!job) return true;
  if (job.clean_result || job.result || job.activeMeal || job.mealBuild) return false;
  if (job.images && job.images.length > 0) return false;
  if (job.imageUrls && job.imageUrls.length > 0) return false;
  if (job.photoUrl) return false;
  if (job.text && job.text.trim().length > 0) return false;
  return true;
}
