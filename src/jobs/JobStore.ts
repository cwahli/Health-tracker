import { AgentJob } from './types';
import { recordSessionEvent } from './sessionLog';
import { JobEvent, eventToPatch } from './jobEvents';
import { mergeFoodEditMessages, shouldMergeFoodEditTurn } from './mergeFoodEditMessages';
import { ImageStore } from './ImageStore';
import { MealBuild } from '../mealBuild/types';
import { rebaseUserEdit } from '../mealBuild/consolidate';
import { deleteJobFromBackend, scheduleCoalescedJobUpsert } from './BackendJobSync';

type Listener = () => void;

function serializeJobs(jobs: AgentJob[]): string {
  return JSON.stringify(jobs, (key, value) => {
    if (key === 'abortController') return undefined;
    if (typeof value === 'string' && (value.startsWith('data:image/') || (value.length > 50000 && value.includes('base64')))) {
      return 'Image reference preserved';
    }
    return value;
  });
}

export function isJobBlank(job: Partial<AgentJob> | undefined | null): boolean {
  if (!job) return true;
  // Draft jobs are unsubmitted client-side composer states, not background AI analysis tasks
  if (job.status === 'draft') return true;

  const hasText = !!(
    job.inputSnapshot?.text &&
    job.inputSnapshot.text.trim() &&
    job.inputSnapshot.text.trim() !== 'Analyze this meal photo.'
  );

  const hasImage = !!(
    job.photoUrl ||
    job.debugUrl ||
    job.inputSnapshot?.hasImage ||
    (job.inputSnapshot?.imageRefs && job.inputSnapshot.imageRefs.length > 0) ||
    (job.inputSnapshot?.imageUrls && job.inputSnapshot.imageUrls.length > 0)
  );

  const pendingLog =
    job.result?.pendingFoodLog ||
    job.result?.clean_result?.pendingFoodLog ||
    job.result?.raw?.data ||
    job.result?.data ||
    job.result?.foodData ||
    job.result?.mealBuild?.content ||
    job.mealBuild?.content ||
    job.messages?.slice().reverse().find((m: any) => m.pendingFoodLog)?.pendingFoodLog ||
    job.messages?.slice().reverse().find((m: any) => m.data?.pendingFoodLog)?.data?.pendingFoodLog;

  const hasFoodData = !!(
    pendingLog?.foodName ||
    pendingLog?.name ||
    pendingLog?.title ||
    pendingLog?.summary ||
    (pendingLog?.items && pendingLog.items.length > 0) ||
    (pendingLog?.itemsBreakdown && pendingLog.itemsBreakdown.length > 0) ||
    (pendingLog?.calories && pendingLog.calories > 0) ||
    (job.result?.items && job.result.items.length > 0) ||
    (job.result?.scoutItems && job.result.scoutItems.length > 0) ||
    (job.mealBuild?.items && job.mealBuild.items.length > 0) ||
    (job.mealBuild?.content?.name && job.mealBuild.content.name !== 'Meal')
  );

  const hasMedicalData = !!(
    (job.result?.biomarkers && Object.keys(job.result.biomarkers).length > 0) ||
    job.result?.extractedData ||
    job.result?.doctorSummary
  );

  const hasSummary = !!(
    job.result?.summary ||
    job.result?.doctorSummary ||
    (typeof job.result?.text === 'string' && job.result.text.trim().length > 0) ||
    (typeof job.result?.message === 'string' && job.result.message.trim().length > 0)
  );

  const hasResult = hasFoodData || hasMedicalData || hasSummary;
  const isActivelyProcessing =
    job.status === 'queued' ||
    job.status === 'running' ||
    job.status === 'processing' ||
    job.status === 'awaiting_user';

  const hasMeaningfulMessages = !!(
    job.messages &&
    job.messages.length > 0 &&
    job.messages.some((m: any) => m.content?.trim() || m.pendingFoodLog || m.data?.pendingFoodLog)
  );

  const hasError = !!job.error?.message;

  // If it has NO input AND NO result AND is NOT actively processing AND has NO error AND has NO meaningful messages -> it's blank
  if (!hasText && !hasImage && !hasResult && !isActivelyProcessing && !hasError && !hasMeaningfulMessages) {
    return true;
  }

  // If status is 'succeeded' or 'cancelled' but it has zero food/medical result and zero text/image input -> it's a blank phantom job
  if ((job.status === 'succeeded' || job.status === 'cancelled') && !hasText && !hasImage && !hasResult) {
    // If it has meaningful messages, it's not a phantom job
    if (hasMeaningfulMessages) {
      return false;
    }
    return true;
  }

  return false;
}

export function isInFlightJobStatus(status: AgentJob['status'] | undefined): boolean {
  return status === 'queued' || status === 'running' || status === 'processing';
}

export function mealSnapshotKey(result: any): string {
  const log = result?.pendingFoodLog || result?.foodData || result?.data || result;
  if (!log || typeof log !== 'object') return '';
  const cal = Number(log.nutrients?.calories ?? log.calories ?? '');
  const name = String(log.name || log.foodName || '').toLowerCase().trim();
  const items = (log.itemsBreakdown || log.items || [])
    .map((it: any) => `${String(it?.name || it?.canonicalDbName || '').toLowerCase().trim()}:${Number(it?.nutrients?.calories ?? it?.calories ?? 0)}`)
    .join('|');
  const msg = String(log.message || result?.message || result?.text || '').slice(0, 80);
  return `${name}|${cal}|${items}|${msg}`;
}

/** True when a succeeded/awaiting_user row is from the previous turn of an in-flight edit. */
export function isStalePriorTurn(
  existing: Pick<AgentJob, 'status' | 'serverSubmittedAt' | 'clientSubmitPending' | 'inFlightTurnAt' | 'finishedAt'> | null | undefined,
  incomingStatus: string,
  incomingUpdatedAt?: string
): boolean {
  if (!existing) return false;
  if (existing.status === 'succeeded' && incomingStatus === 'awaiting_user') {
    return true;
  }
  const turnInFlight =
    typeof existing.inFlightTurnAt === 'number' &&
    (!existing.finishedAt || new Date(existing.finishedAt).getTime() < existing.inFlightTurnAt);
  const localInFlight = isInFlightJobStatus(existing.status) || !!existing.clientSubmitPending || turnInFlight;
  if (!localInFlight) return false;
  if (incomingStatus !== 'succeeded' && incomingStatus !== 'awaiting_user') return false;
  const submittedAt = existing.inFlightTurnAt || existing.serverSubmittedAt || 0;
  if (submittedAt <= 0) return false;
  const rowUpdatedMs = incomingUpdatedAt ? new Date(incomingUpdatedAt).getTime() : 0;
  if (!rowUpdatedMs) return false;
  return rowUpdatedMs < submittedAt - 2500;
}

class JobStoreImpl {
  private jobs: Map<string, AgentJob> = new Map();
  private deletedJobIds: Set<string> = new Set();
  private listeners: Set<Listener> = new Set();
  private maxQueued = 5;

  constructor() {
    this.loadJobs();
    // Cleanup orphaned images from past sessions (Phase 3 TTL)
    setTimeout(() => {
      this.cleanupOldJobs();
    }, 1000);
  }

  isJobDeleted(id: string): boolean {
    return this.deletedJobIds.has(id);
  }

  private loadJobs() {
    try {
      if (typeof localStorage === 'undefined') return;
      const storedDeleted = localStorage.getItem('jobstore_deleted_ids');
      if (storedDeleted) {
        try {
          const parsed = JSON.parse(storedDeleted) as string[];
          if (Array.isArray(parsed)) {
            this.deletedJobIds = new Set(parsed);
          }
        } catch (e) {
          console.warn('Error loading deleted job IDs:', e);
        }
      }

      const stored = localStorage.getItem('jobstore_jobs');
      if (stored) {
        const parsed = JSON.parse(stored) as AgentJob[];
        for (const job of parsed) {
          delete job.abortController;
          // Draft jobs are ephemeral composer sessions and should not be restored as persistent background jobs
          if (job.status === 'draft') {
            continue;
          }
          if (isJobBlank(job)) {
            continue;
          }
          if (job.status === 'running') {
            const hasServerJob = !!(job.result?.jobId || job.requestId);
            if (!hasServerJob) {
              job.status = 'cancelled';
              job.finishedAt = new Date().toISOString();
              job.cancelReason = 'Analysis interrupted by browser reload';
            }
          }
          if (!this.deletedJobIds.has(job.id)) {
            this.jobs.set(job.id, job);
          }
        }
      }
    } catch (e) {
      console.warn('Error loading jobs from localStorage:', e);
    }
  }

  private saveDeletedJobIds() {
    try {
      if (typeof localStorage === 'undefined') return;
      const arr = Array.from(this.deletedJobIds).slice(-500);
      localStorage.setItem('jobstore_deleted_ids', JSON.stringify(arr));
    } catch {
      // Silently catch quota errors
    }
  }

  private saveJobs() {
    try {
      if (typeof localStorage === 'undefined') return;
      const allJobs = Array.from(this.jobs.values());
      let json = serializeJobs(allJobs);

      try {
        localStorage.setItem('jobstore_jobs', json);
        return;
      } catch (quotaError) {
        // Separate active vs completed jobs
        const activeJobs = allJobs.filter(j => j.status === 'queued' || j.status === 'running' || j.status === 'draft');
        const finishedJobs = allJobs
          .filter(j => j.status === 'succeeded' || j.status === 'failed' || j.status === 'cancelled')
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        // Keep at most 2 most recent finished jobs when quota is tight and strip heavy logs/messages
        const keptFinished = finishedJobs.slice(0, 2).map(j => ({
          ...j,
          liveThoughts: undefined,
          messages: j.messages ? j.messages.slice(-2) : []
        }));
        const keptJobs = [...activeJobs, ...keptFinished];

        // Purge pruned jobs from in-memory map and ImageStore
        const keptIds = new Set(keptJobs.map(j => j.id));
        for (const [id] of this.jobs) {
          if (!keptIds.has(id)) {
            this.jobs.delete(id);
            ImageStore.purgeImages(id).catch(() => {});
          }
        }

        try {
          json = serializeJobs(keptJobs);
          localStorage.setItem('jobstore_jobs', json);
        } catch {
          // If still exceeding, save minimal job records with only core fields
          const minimalJobs = keptJobs.map(j => ({
            id: j.id,
            kind: j.kind,
            mode: j.mode,
            status: j.status,
            progressPercent: j.progressPercent,
            createdAt: j.createdAt,
            finishedAt: j.finishedAt
          }));
          try {
            localStorage.setItem('jobstore_jobs', JSON.stringify(minimalJobs));
          } catch {
            // Silently retain in-memory state if localStorage is completely filled
          }
        }
      }
    } catch {
      // Silently catch unexpected errors
    }
  }

  private async cleanupOldJobs() {
    const now = Date.now();
    const maxAgeMs = 24 * 60 * 60 * 1000; // 24 hours for succeeded jobs
    const failedMaxAgeMs = 2 * 60 * 60 * 1000; // 2 hours for failed/cancelled jobs
    const finishedJobs: AgentJob[] = [];

    for (const job of this.jobs.values()) {
      if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') {
        finishedJobs.push(job);
      }
    }

    // Sort by createdAt descending
    finishedJobs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const jobsToDelete: string[] = [];

    // Delete any lingering blank jobs or stale drafts
    for (const job of this.jobs.values()) {
      if (isJobBlank(job)) {
        jobsToDelete.push(job.id);
      }
    }

    // Delete jobs older than 24 hours OR beyond the 15 most recent finished jobs
    finishedJobs.forEach((job, index) => {
      const createdAtTime = new Date(job.createdAt).getTime();
      const isFailed = job.status === 'failed' || job.status === 'cancelled';
      const isExpired = now - createdAtTime > (isFailed ? failedMaxAgeMs : maxAgeMs);
      const isExcess = index >= 15;
      if (isExpired || isExcess) {
        jobsToDelete.push(job.id);
      }
    });

    for (const id of jobsToDelete) {
      this.jobs.delete(id);
      await ImageStore.purgeImages(id);
    }

    if (jobsToDelete.length > 0) {
      this.saveJobs();
      this.notify();
    }

    // Also purge orphaned images from ImageStore older than 24 hours
    await ImageStore.purgeAllOldImages(maxAgeMs);
  }

  createJob(params: Partial<AgentJob> & { id: string }): AgentJob {
    if (params.id && this.deletedJobIds.has(params.id)) {
      // Do not recreate or resurrect a deleted job
      return { id: params.id, status: 'cancelled', ...params } as AgentJob;
    }
    const job: AgentJob = {
      kind: 'food_log',
      status: 'draft',
      stepIndex: 0,
      stepTotal: 1,
      progressPercent: 0,
      messages: [],
      inputSnapshot: { text: '', imageRefs: [] },
      attemptByStep: {},
      attemptCount: params.attemptCount || 1,
      maxAttempts: params.maxAttempts || 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...params,
      id: params.id,
    };
    job.sessionEvents = recordSessionEvent(job.id, {
      writer: 'JobStore.apply' as any,
      status: job.status,
      action: 'createJob',
    });
    this.jobs.set(job.id, job);
    this.saveJobs();
    this.notify();
    return job;
  }

  
  apply(event: JobEvent) {
    let writer = 'JobStore.apply';
    switch (event.type) {
      case 'SubmitStarted': writer = 'LogChat.submit'; break;
      case 'ServerStatus': writer = 'JobQueueRunner'; break;
      case 'AnalyzeFinished': writer = 'JobQueueRunner'; break;
      case 'AnalyzeFailed': writer = 'JobQueueRunner'; break;
      case 'PollerPayload': writer = 'poller'; break;
      case 'RealtimeRow': writer = 'realtime'; break;
    }
    const patch = eventToPatch(event);
    
    const job = this.jobs.get(event.id);
    if (job && patch.messages && patch.messages.length === 1 && (event.type === 'AnalyzeFinished' || event.type === 'PollerPayload' || event.type === 'RealtimeRow')) {
      const isNewTurn = !!job.inFlightTurnAt;
      const nonLive = (job.messages || []).filter((m: any) => !m.isLive);
      const assistantMsg = patch.messages[0];
      
      if (shouldMergeFoodEditTurn({
        isMedicalJob: job.kind === 'medical',
        mode: job.mode || patch.mode,
        inputMode: (job.inputSnapshot as any)?.mode,
        cleanMode: patch.result?.mode || job.mode,
        messages: nonLive,
      })) {
        patch.messages = mergeFoodEditMessages(nonLive, assistantMsg);
      } else {
        const lastUserIdx = nonLive.map((m: any) => m.role).lastIndexOf('user');
        const lastAsstIdx = nonLive.map((m: any) => m.role).lastIndexOf('assistant');
        // If an assistant message exists for this turn (after the latest user prompt), update it in place
        if (lastAsstIdx !== -1 && (lastUserIdx === -1 || lastAsstIdx > lastUserIdx)) {
          nonLive[lastAsstIdx] = assistantMsg;
          patch.messages = [...nonLive];
        } else {
          patch.messages = [...nonLive, assistantMsg];
        }
      }
    }
    
    this.commit(event.id, patch, writer, event.type);
  }

  updateJob(id: string, patch: Partial<AgentJob>) {
    this.commit(id, patch, 'JobStore.apply', 'updateJob');
  }

  private commit(id: string, patch: Partial<AgentJob>, writer: string, eventType?: string) {

    if (this.deletedJobIds.has(id)) {
      if (this.jobs.has(id)) {
        this.jobs.delete(id);
        this.saveJobs();
        this.notify();
      }
      return;
    }
    const job = this.jobs.get(id);
    if (!job) return;

    const incomingTurn = (patch as any).currentTurn ?? (patch as any).current_turn;
    if (typeof incomingTurn === 'number' && typeof job.currentTurn === 'number' && incomingTurn < job.currentTurn) {
      delete patch.status;
      delete patch.result;
      delete patch.messages;
      delete patch.finishedAt;
      delete patch.statusMessage;
      delete patch.inFlightTurnAt;
      delete patch.currentTurn;
      delete (patch as any).current_turn;
    }

    if (patch.status === 'queued') {
      const queuedCount = this.getQueue().length;
      if (job.status !== 'queued' && queuedCount >= this.maxQueued) {
        throw new Error('maxQueued limit reached');
      }
    }

    // Stale poll/sync can report queued/running for a job that already finished.
    // Block that downgrade, except when the client is starting a new turn (edit
    // submit or retry). Do NOT force succeeded just because a prior-turn
    // pendingFoodLog is still on the job — that is the edit-in-flight case, and
    // forcing succeeded is what left the preview stuck on "Analysis completed".
    const isExplicitNewTurn =
      patch.clientSubmitPending === true ||
      job.clientSubmitPending === true ||
      (typeof patch.attemptCount === 'number' && patch.attemptCount > (job.attemptCount || 0)) ||
      !!(patch.inputSnapshot?.text && patch.inputSnapshot.text !== job.inputSnapshot?.text);
    if ((patch.status === 'queued' || patch.status === 'running' || patch.status === 'processing' || patch.status === 'awaiting_user') && !isExplicitNewTurn) {
      if (job.status === 'succeeded') {
        delete patch.status;
      } else if (job.status === 'awaiting_user' && patch.status !== 'awaiting_user') {
        delete patch.status;
      }
    }
    // Submit .then() writes queued after the runner already flipped running.
    // That made the card say "Queued on server" for the whole Gemini run.
    if (patch.status === 'queued' && (job.status === 'running' || job.status === 'processing')) {
      delete patch.status;
    }

    // While an edit turn is in flight, ignore succeeded echoes of the SAME meal
    // (the prior analysis). A *new* job has no existing meal key — do not treat
    // a thin realtime succeeded (no result payload) as a prior-turn echo, or the
    // card stays on "Attempt 1 of 3" after analyze already finished.
    if (job.inFlightTurnAt && (patch.status === 'succeeded' || patch.status === 'awaiting_user')) {
      const incomingKey = mealSnapshotKey(patch.result);
      const existingKey = mealSnapshotKey(job.result);
      const incomingUpdatedMs = patch.updatedAt ? new Date(patch.updatedAt).getTime() : 0;
      const isPriorEcho =
        eventType !== 'AnalyzeFinished' &&
        !!existingKey &&
        (!patch.result || (incomingKey !== '' && incomingKey === existingKey)) &&
        (!incomingUpdatedMs || incomingUpdatedMs < job.inFlightTurnAt);
      if (isPriorEcho) {
        delete patch.status;
        delete patch.result;
        delete patch.messages;
        delete patch.finishedAt;
        delete patch.inFlightTurnAt;
        delete patch.statusMessage;
      }
    }

    // Realtime/poller `failed` from a prior attempt must not wipe an in-flight retry.
    // Local executor fails have no older updatedAt and still apply.
    if (
      patch.status === 'failed' &&
      (job.clientSubmitPending || job.inFlightTurnAt) &&
      isInFlightJobStatus(job.status)
    ) {
      const submittedAt = job.inFlightTurnAt || job.serverSubmittedAt || 0;
      const incomingUpdatedMs = patch.updatedAt ? new Date(patch.updatedAt).getTime() : 0;
      if (incomingUpdatedMs && submittedAt && incomingUpdatedMs < submittedAt - 2500) {
        delete patch.status;
        delete patch.error;
        delete patch.finishedAt;
        delete patch.inFlightTurnAt;
      }
    }

    const nextStatus = patch.status !== undefined ? patch.status : job.status;
    const alreadySucceededWithMeal = job.status === 'succeeded' && !!job.result?.pendingFoodLog;
    const isPollHeartbeat =
      (eventType === 'updateJob' || eventType === 'PollerPayload') &&
      nextStatus === job.status &&
      (job.status === 'running' || job.status === 'queued' || job.status === 'processing');

    if (
      (nextStatus === 'succeeded' || nextStatus === 'failed' || nextStatus === 'cancelled' || nextStatus === 'awaiting_user') &&
      patch.status === nextStatus
    ) {
      if (patch.inFlightTurnAt === undefined) patch.inFlightTurnAt = undefined;
      if (!patch.finishedAt && !job.finishedAt) patch.finishedAt = new Date().toISOString();
    }

    Object.assign(job, { ...patch, updatedAt: new Date().toISOString() });

    const eventAction = eventType
      ? `${eventType}`
      : (job.status === 'succeeded' ? 'completed' : 'accepted');

    if (!isPollHeartbeat) {
      job.sessionEvents = recordSessionEvent(id, {
        writer: writer as any,
        status: job.status,
        action: eventAction,
      });
    }

    this.saveJobs();
    this.notify();

    // Do not push a succeeded snapshot to the cloud while an edit turn is still
    // in flight — that overwrite is what made the server look "done" with the
    // old 660 kcal meal and stopped the preview from showing processing.
    const turnStillInFlight =
      typeof job.inFlightTurnAt === 'number' &&
      (!job.finishedAt || new Date(job.finishedAt).getTime() < job.inFlightTurnAt);
    if (
      !alreadySucceededWithMeal &&
      !turnStillInFlight &&
      (patch.status === 'succeeded' || patch.status === 'awaiting_user' || (job.status === 'succeeded' && patch.result))
    ) {
      // Coalesced: completion applies AnalyzeFinished 2-3x within ms and
      // every event re-applies — collapsing bursts to active+trailing.
      scheduleCoalescedJobUpsert(job);
    }
  }

  async deleteJob(id: string) {
    if (id) {
      this.deletedJobIds.add(id);
      this.saveDeletedJobIds();
    }
    if (this.jobs.has(id)) {
      this.jobs.delete(id);
      this.saveJobs();
      this.notify();
    } else {
      this.notify();
    }
    // Draft cleanup auto-purges associated ImageStore entries
    await ImageStore.purgeImages(id);
    // Asynchronously delete job from backend / Supabase
    deleteJobFromBackend(id).catch((err) => console.warn('Failed to dispatch backend job deletion:', err));
  }

  rebaseJobMealEdit(
    id: string,
    localUserPatch: Partial<MealBuild>,
    serverMeal: MealBuild
  ): { rebasedMeal: MealBuild; success: boolean } {
    const existingJob = this.getJob(id);
    const currentAttempt = (existingJob?.mealBuild?.stageLedger?.filter((s) => s.actor === 'user')?.length || 0) + 1;
    const result = rebaseUserEdit(serverMeal, localUserPatch, currentAttempt);
    if (existingJob) {
      this.updateJob(id, {
        mealBuild: result.rebasedMeal,
        result: {
          ...(existingJob.result || {}),
          mealBuild: result.rebasedMeal,
        },
      });
    }
    return result;
  }

  getJob(id: string): AgentJob | undefined {
    if (this.deletedJobIds.has(id)) return undefined;
    return this.jobs.get(id);
  }

  getAllJobs(): AgentJob[] {
    return Array.from(this.jobs.values())
      .filter((j) => !this.deletedJobIds.has(j.id))
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  getQueue(): AgentJob[] {
    return this.getAllJobs().filter((j) => {
      if (j.status === 'queued' || j.status === 'running' || j.status === 'processing') {
        return true;
      }
      return false;
    });
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  clearForTests() {
    this.jobs.clear();
    this.deletedJobIds.clear();
    this.listeners.clear();
  }

  /** Clears all cached job threads (fresh demo login, sign-out). Keeps listeners; notifies once. */
  resetAllJobs() {
    this.jobs.clear();
    this.deletedJobIds.clear();
    this.saveJobs();
    this.saveDeletedJobIds();
    this.notify();
  }

  private notify() {
    this.listeners.forEach((l) => l());
  }
}

export const JobStore = new JobStoreImpl();
