import { JobStore } from './JobStore';
import { AgentJob } from './types';
import { appendSessionLog } from './sessionLog';

class JobQueueRunnerClass {
  private running = false;
  private queue: string[] = [];

  enqueue(jobId: string) {
    if (!this.queue.includes(jobId)) {
      this.queue.push(jobId);
    }
    this.processQueue();
  }

  start() {
    this.running = true;
    this.processQueue();
  }

  wake() {
    this.start();
  }

  stop() {
    this.running = false;
  }

  private async processQueue() {
    if (!this.running || this.queue.length === 0) return;
    const jobId = this.queue.shift();
    if (!jobId) return;

    const job = JobStore.getJob(jobId);
    if (!job || job.status === 'succeeded' || job.status === 'failed') {
      return;
    }

    try {
      JobStore.updateJob(jobId, { status: 'running' });
      appendSessionLog(jobId, { writer: 'JobQueueRunner', status: 'running', message: 'processing' });
      
      // If the job already has mealBuild or result from server
      if (job.result?.mealBuild) {
        JobStore.updateJob(jobId, {
          mealBuild: job.result.mealBuild,
          status: 'succeeded',
        });
      }
    } catch (err: any) {
      JobStore.updateJob(jobId, {
        status: 'failed',
        error: err?.message || 'Queue execution failed',
      });
    }
  }
}

export const JobQueueRunner = new JobQueueRunnerClass();
