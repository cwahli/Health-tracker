import { JobStore } from './JobStore';
import { AgentJob } from './types';
import { uploadPhotoToR2, uploadPhotosToR2, uploadDebugPayloadToR2 } from '../utils/r2Storage';
import { upsertJobToSupabase } from './SupabaseJobSync';
import { ImageStore } from './ImageStore';
import { auth } from '../firebase';
import { getSessionLog } from './sessionLog';

export type JobExecutor = (job: AgentJob, abortSignal: AbortSignal) => Promise<void>;



class JobQueueRunnerImpl {
  private isRunning = false;
  private loopGeneration = 0;
  private inFlightIds = new Set<string>();
  private consecutiveFailures = 0;
  private circuitBreakerPaused = false;
  private executor: JobExecutor = async (job, signal) => {
    throw new Error('Default local executor is disabled. Jobs are processed server-side.');
  };

  private resolveSleep: (() => void) | null = null;

  private handleVisibilityChange = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      this.wake();
    }
  };

  setExecutor(executor: JobExecutor) {
    this.executor = executor;
  }

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    const gen = ++this.loopGeneration;
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
    this.loop(gen);
  }

  stop() {
    this.isRunning = false;
    this.loopGeneration++;
    this.circuitBreakerPaused = false;
    this.consecutiveFailures = 0;
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
  }

  wake() {
    if (this.resolveSleep) {
      const r = this.resolveSleep;
      this.resolveSleep = null;
      r();
    }
  }

  private async loop(gen: number) {
    while (this.isRunning && this.loopGeneration === gen) {
      if (this.circuitBreakerPaused) {
        await this.sleep(5000);
        continue;
      }

      const queue = JobStore.getQueue();
      const now = new Date();

      const jobToRun = queue.find((job) => {
        if (this.inFlightIds.has(job.id)) return false;
        const retryOk = !job.retryNotBefore || new Date(job.retryNotBefore) <= now;
        if (!retryOk) return false;
        // Do not pick up jobs where the client UI is actively performing the network submit right now.
        // Doing so prematurely polls /api/jobs/status and reads stale status from a completed prior turn.
        // Fall back to runner-owned submit only if client submission timed out (>20s).
        if (job.clientSubmitPending) {
          const submitAgeMs = Date.now() - new Date(job.updatedAt || job.createdAt).getTime();
          if (submitAgeMs < 20000) {
            return false;
          }
        }
        return true;
      });

      if (!jobToRun) {
        await this.sleep(1000);
        continue;
      }

      await this.runJob(jobToRun);
    }
  }

  private async runJob(job: AgentJob) {
    if (this.inFlightIds.has(job.id)) return;
    this.inFlightIds.add(job.id);
    const controller = new AbortController();
    JobStore.apply({ id: job.id, type: 'ServerStatus',
      status: 'running',
      startedAt: new Date().toISOString(),
      abortController: controller,
    });

    try {
      await this.executor(job, controller.signal);
      
      const currentJobState = JobStore.getJob(job.id);
      if (currentJobState?.status === 'awaiting_user') {
        this.consecutiveFailures = 0;
        return;
      }
      if (currentJobState?.status === 'failed' || currentJobState?.status === 'cancelled') {
        if (currentJobState.status === 'failed') {
          this.consecutiveFailures++;
        } else {
          this.consecutiveFailures = 0;
        }
        return;
      }
      if (currentJobState?.status === 'succeeded' && currentJobState.result?.pendingFoodLog) {
        this.consecutiveFailures = 0;
        return;
      }

      JobStore.apply({ id: job.id, type: 'AnalyzeFinished',
        status: 'succeeded',
        error: undefined,
        finishedAt: new Date().toISOString(),
        progressPercent: 100,
        retryNotBefore: undefined,
      });
      this.consecutiveFailures = 0;

      // Hybrid Cloud Storage (R3): Upload photo and debug payload to Cloudflare R2 & upsert clean result to Supabase
      const updatedJob = JobStore.getJob(job.id) || job;
      let photoUrl: string | undefined = updatedJob.result?.photoUrl;
      let debugUrl: string | undefined = updatedJob.result?.debugUrl;

      const isServerOwned = (job.kind === 'food_log' || job.kind === 'food_compare') && (photoUrl || debugUrl || updatedJob.result?.pendingFoodLog);

      let photoUrls: string[] = updatedJob.result?.photoUrls || (photoUrl ? [photoUrl] : []);

      try {
        if ((!photoUrl || photoUrls.length === 0) && !isServerOwned) {
          const images = await ImageStore.getImages(job.id);
          if (images && images.length > 0) {
            const formattedImages: string[] = [];
            for (const img of images) {
              if (typeof img === 'string') {
                formattedImages.push(img);
              } else if ((img as any) instanceof Blob || (img as any) instanceof File) {
                formattedImages.push(URL.createObjectURL(img));
              }
            }
            if (formattedImages.length > 0) {
              photoUrls = await uploadPhotosToR2(job.id, formattedImages);
              photoUrl = photoUrls[0] || '';
            }
          }
        }

        // Capture ephemeral, browser-session-only debug context (session events,
        // console logs, network errors, breadcrumbs, conversation-so-far) while it
        // is still live in this tab. Previously this data was only ever read at
        // *download* time from window.__clientConsoleLogs / getSessionLog(), so a
        // job re-opened in a later session (after a reload) produced an
        // effectively-empty debug export even though the job itself succeeded.
        // Persisting it here, at job-completion time, makes it durable.
        const w = typeof window !== 'undefined' ? (window as any) : {};
        const conversationHistory = Array.isArray(updatedJob.messages)
          ? updatedJob.messages
              .filter((m: any) => !m.isLive)
              .map((m: any) => ({ role: m.role, content: String(m.content || '').slice(0, 1000) }))
          : undefined;
        const debugContext = {
          sessionEvents: getSessionLog(job.id),
          clientConsoleLogs: w.__clientConsoleLogs || [],
          networkErrors: w.__clientNetworkErrors || [],
          userActionBreadcrumbs: w.__userActionBreadcrumbs || [],
          conversationHistory,
        };

        if (!debugUrl && updatedJob.result && !isServerOwned) {
          const debugData = {
            jobId: job.id,
            liveThoughts: updatedJob.liveThoughts,
            statusMessage: updatedJob.statusMessage,
            messages: updatedJob.messages,
            result: updatedJob.result,
            ...debugContext,
          };
          debugUrl = await uploadDebugPayloadToR2(job.id, debugData);
        }

        let strippedResult = undefined;
        if (updatedJob.result) {
          strippedResult = { ...updatedJob.result };
          if (strippedResult.raw) delete strippedResult.raw;
          if (strippedResult.data?.raw) delete strippedResult.data.raw;
        }

        const cleanResult = strippedResult ? {
          ...strippedResult,
          photoUrl: photoUrl || strippedResult.photoUrl,
          photoUrls: photoUrls.length > 0 ? photoUrls : (strippedResult.photoUrls || (photoUrl ? [photoUrl] : [])),
          debugUrl: debugUrl || strippedResult.debugUrl,
          mealBuild: strippedResult.mealBuild, // ensure mealBuild is persisted
          // Q: same rationale as debugData above — without this, the Supabase
          // fallback path in /api/jobs/debug (used whenever the R2 debugUrl fetch
          // fails) has no session context to fall back to either.
          ...(!isServerOwned ? debugContext : {}),
        } : undefined;

        if (cleanResult) {
          JobStore.apply({ id: job.id, type: 'AnalyzeFinished',
            result: cleanResult,
          });
        }

        await upsertJobToSupabase(updatedJob, auth.currentUser?.uid || 'anonymous', photoUrl, debugUrl, cleanResult);
      } catch (r3Err) {
        console.warn('[JobQueueRunner] R3 hybrid storage post-processing warning:', r3Err);
      }
    } catch (error: any) {
      if (error.message === 'AbortError') {
        JobStore.apply({ id: job.id, type: 'AnalyzeFailed',
          status: 'cancelled',
          finishedAt: new Date().toISOString(),
          error: undefined,
        });
      } else {
        const AGENT_DELAYED_RETRY = false; // flag default off to avoid stacked 60s/300s retries
        const currentStep = job.stepKey || 'default';
        const currentAttempts = (job.attemptByStep?.[currentStep] || 0) + 1;
        const isTransient = error.class === 'transient';

        if (isTransient && currentAttempts < 3) {
          const delaySeconds = 3;
          const retryTime = new Date(Date.now() + delaySeconds * 1000);

          JobStore.apply({ id: job.id, type: 'ServerStatus',
            status: 'queued',
            attemptByStep: {
              ...(job.attemptByStep || {}),
              [currentStep]: currentAttempts,
            },
            retryNotBefore: retryTime.toISOString(),
            statusMessage: `Rate limit / transient error (${error.message || 'Retrying'}). Auto-retrying in ${delaySeconds}s (attempt ${currentAttempts + 1}/3)...`,
          });
        } else {
          JobStore.apply({ id: job.id, type: 'AnalyzeFailed',
            status: 'failed',
            finishedAt: new Date().toISOString(),
            error: {
              class: error.class || 'permanent',
              message: error.message || 'Unknown error',
              scoutItems: error.scoutItems,
              scoutContentType: error.scoutContentType,
              portionClarify: error.portionClarify,
            },
          });
          
          if (error.class === 'permanent' || error.class === undefined) {
            this.consecutiveFailures++;
            if (this.consecutiveFailures >= 3) {
              this.circuitBreakerPaused = true;
              // Stub: unpause after 30 seconds
              setTimeout(() => {
                this.circuitBreakerPaused = false;
                this.consecutiveFailures = 0;
              }, 30000);
            }
          }
        }
      }
    } finally {
      this.inFlightIds.delete(job.id);
      // Clear the abort controller to prevent memory leaks
      JobStore.apply({ type: 'ServerStatus', id: job.id, abortController: undefined } as any);
    }
  }

  private sleep(ms: number) {
    return new Promise<void>((resolve) => {
      this.resolveSleep = resolve;
      setTimeout(() => {
        if (this.resolveSleep === resolve) {
          this.resolveSleep = null;
        }
        resolve();
      }, ms);
    });
  }
}

export const JobQueueRunner = new JobQueueRunnerImpl();

/* Cold R2 upload on fail uploadDebugPayloadToR2 status: 'failed' uploadDebugPayloadToR2 */
