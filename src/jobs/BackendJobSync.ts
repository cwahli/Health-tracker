import { auth, db } from '../firebase';
import { doc, setDoc, getDocs, collection, deleteDoc } from 'firebase/firestore';
import { supabase, isSupabaseConfigured } from '../utils/supabaseClient';
import { sanitizeForFirestore } from '../utils/firestoreUtils';
import { JobStore, isStalePriorTurn, mealSnapshotKey } from './JobStore';
import { AgentJob } from './types';
import { toPendingFoodLog } from '../mealBuild/adapters';

// [FreeTier] thin clean_result - direct client Supabase calls disabled in favor of D1 backend routes
let isDirectClientSupabaseDisabled = true;

const backendDeleteTried = new Set<string>();

function forgetDeletedOnBackend(jobId: string, userId: string) {
  if (!jobId || backendDeleteTried.has(jobId)) return;
  backendDeleteTried.add(jobId);
  deleteJobFromBackend(jobId, userId).catch(() => {});
}

async function fetchAndPopulateR2Job(jobId: string) {
  try {
    const baseUrl = typeof window !== 'undefined' ? '' : 'http://localhost:3000';
    const r2Controller = new AbortController();
    const r2TimeoutId = setTimeout(() => r2Controller.abort(), 20000);
    let r: Response;
    try {
      r = await fetch(`${baseUrl}/api/jobs/status?jobId=${jobId}&full=true`, { signal: r2Controller.signal });
    } finally {
      clearTimeout(r2TimeoutId);
    }
    if (r.ok) {
      const contentType = r.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const fetchedWrapper = await r.json();
        if (fetchedWrapper && fetchedWrapper.jobs && fetchedWrapper.jobs.length > 0) {
          const backendJob = fetchedWrapper.jobs[0];
          if (backendJob && backendJob.clean_result && !backendJob.clean_result.is_r2) {
            const existing = JobStore.getJob(jobId);
            const updatedResult = backendJob.clean_result;
            const pendingFoodLog = updatedResult.pendingFoodLog || (updatedResult.mealBuild ? toPendingFoodLog(updatedResult.mealBuild) : null) || updatedResult.data;
            const messageText = updatedResult.message || updatedResult.text || pendingFoodLog?.message || 'Analysis complete.';

            let updatedMessages = existing?.messages;
            let assistantMsg: any = undefined;
            if (existing?.messages && existing.messages.length > 0) {
              const nonLive = existing.messages.filter((m: any) => !m.isLive);
              const lastNonLive = nonLive[nonLive.length - 1];
              const isNewTurn = lastNonLive && lastNonLive.role === 'user';
              assistantMsg = {
                id: isNewTurn ? `msg_assistant_${jobId}_${Date.now()}` : `msg_assistant_${jobId}`,
                role: 'assistant',
                content: messageText,
                timestamp: new Date().toISOString(),
                isLive: false,
                agentType: existing.kind === 'medical' ? 'agent1' : 'food',
                pendingFoodLog: pendingFoodLog || undefined,
                data: {
                  jobId,
                  pendingFoodLog: pendingFoodLog || undefined,
                  photoUrl: backendJob.photo_url || updatedResult.photoUrl || existing.photoUrl,
                  debugUrl: backendJob.debug_url || updatedResult.debugUrl || existing.debugUrl,
                  scoutItems: updatedResult.scoutItems || [],
                  mode: backendJob.mode || updatedResult.mode || 'review',
                  agentResult: {
                    backendLogs: updatedResult.backendLogs || '',
                    globalLiveLogs: updatedResult.backendLogs || '',
                    dietitianAnswer: messageText,
                    scoutItems: updatedResult.scoutItems || [],
                  },
                },
              };
            }

            JobStore.apply({
              type: 'PollerPayload',
              id: jobId,
              status: backendJob.status || 'succeeded',
              result: updatedResult,
              messages: assistantMsg ? [assistantMsg] : undefined,
              currentTurn: backendJob.current_turn,
            });
          }
        }
      }
    }
  } catch (err) {
    console.warn(`[SupabaseJobSync] Async R2 fetch via backend failed for ${jobId}:`, err);
  }
}

export function processJobRows(rows: any[], userId: string = 'anonymous'): void {
  if (!rows || !Array.isArray(rows)) return;

  for (const row of rows) {
    if (!row || !row.id || JobStore.isJobDeleted(row.id)) {
      if (row && row.id && JobStore.isJobDeleted(row.id)) {
        forgetDeletedOnBackend(row.id, userId);
      }
      continue;
    }
    const existing = JobStore.getJob(row.id);
    const cleanRes = row.clean_result || undefined;
    const photoUrl = row.photo_url || cleanRes?.photoUrl;
    const debugUrl = row.debug_url || cleanRes?.debugUrl;
    if (cleanRes) {
      if (photoUrl) cleanRes.photoUrl = photoUrl;
      if (debugUrl) cleanRes.debugUrl = debugUrl;
    }

    if (!existing) {
      const cleanResObj = cleanRes || {};
      let initialMessages: any[] = [];
      if (row.status === 'awaiting_user' && cleanResObj) {
        const clarifyMsg = cleanResObj.message || row.status_message || 'Confirm how much you ate';
        const clarifyFoodLog = cleanResObj.pendingFoodLog || cleanResObj.data || (cleanResObj.mealBuild ? toPendingFoodLog(cleanResObj.mealBuild) : null);
        const clarifyLogWith = clarifyFoodLog ? { ...clarifyFoodLog, portionClarify: cleanResObj.portionClarify } : undefined;
        initialMessages = [{
          id: `msg_assistant_clarify_${row.id}`,
          role: 'assistant',
          content: clarifyMsg,
          timestamp: new Date().toISOString(),
          isLive: false,
          agentType: 'food',
          pendingFoodLog: clarifyLogWith,
          data: {
            needsPortionClarify: true,
            portionClarify: cleanResObj.portionClarify,
            pendingFoodLog: clarifyLogWith,
            scoutItems: cleanResObj.scoutItems || [],
            photoUrl: row.photo_url || cleanResObj.photoUrl,
            debugUrl: row.debug_url || cleanResObj.debugUrl,
            agentResult: {
              backendLogs: cleanResObj.backendLogs || '',
              globalLiveLogs: cleanResObj.backendLogs || '',
              scoutItems: cleanResObj.scoutItems || [],
              activeStage: 'portion_clarify',
            },
          },
        }];
      }
      JobStore.createJob({
        id: row.id,
        kind: row.kind || 'food_log',
        mode: row.mode || 'review',
        status: row.status,
        progressPercent: row.progress_percent || 0,
        statusMessage: row.status_message || '',
        error: row.status === 'failed' ? { class: 'permanent', message: row.status_message || cleanRes?.message || 'Analysis failed on server' } : undefined,
        messages: cleanRes?.messages || initialMessages,
        result: cleanRes,
        mealBuild: cleanRes?.mealBuild,
        photoUrl: photoUrl || row.photo_url || cleanRes?.photoUrl,
        debugUrl: debugUrl || row.debug_url || cleanRes?.debugUrl,
        inputSnapshot: {
          text: row.raw_text || cleanRes?.raw_text || '',
          hasImage: !!(photoUrl || row.photo_url || cleanRes?.photoUrl)
        },
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
        serverSubmittedAt: Date.now(),
      } as any);

      if (cleanRes && cleanRes.is_r2) {
        fetchAndPopulateR2Job(row.id);
      }
    } else {
      if (isStalePriorTurn(existing, row.status, row.updated_at)) {
        console.log(`[SupabaseJobSync] Skipping stale prior-turn polled row for job ${row.id}`);
        continue;
      }

      // Preserve the current result while an edit is processing so the stale
      // first-pass clean_result still sitting on the server row cannot clobber
      // the local meal. Status is still allowed to move to queued/running so
      // the preview can show the processing/edit state.
      const isEditInFlight =
        (existing.status === 'queued' || existing.status === 'running' || existing.status === 'processing' || existing.clientSubmitPending) &&
        (row.status === 'queued' || row.status === 'running');
      const updatePayload: any = {
        status: row.status,
        progressPercent: row.progress_percent,
        statusMessage: row.status_message || (isEditInFlight ? 'Updating meal...' : undefined),
        serverSubmittedAt: existing.serverSubmittedAt || Date.now(),
        error: row.status === 'failed'
          ? { class: 'permanent', message: row.status_message || cleanRes?.message || existing.error?.message || 'Analysis failed on server' }
          : row.status === 'succeeded'
            ? undefined
            : existing.error,
        result: isEditInFlight
          ? existing.result
          : ((cleanRes && !cleanRes.is_r2) ? cleanRes : existing.result),
        mealBuild: isEditInFlight
          ? existing.mealBuild
          : (cleanRes?.mealBuild || existing.mealBuild),
        photoUrl: photoUrl || row.photo_url || cleanRes?.photoUrl || existing.photoUrl,
        debugUrl: debugUrl || row.debug_url || cleanRes?.debugUrl || existing.debugUrl
      };
      if (photoUrl || row.photo_url || cleanRes?.photoUrl) {
        updatePayload.inputSnapshot = {
          ...(existing.inputSnapshot || {}),
          hasImage: true
        };
      }
      if (row.status === 'awaiting_user' && cleanRes && (!existing.messages || existing.messages.length === 0)) {
        const clarifyMsg = cleanRes.message || row.status_message || 'Confirm how much you ate';
        const clarifyFoodLog = cleanRes.pendingFoodLog || cleanRes.data || (cleanRes.mealBuild ? toPendingFoodLog(cleanRes.mealBuild) : null);
        const clarifyLogWith = clarifyFoodLog ? { ...clarifyFoodLog, portionClarify: cleanRes.portionClarify } : undefined;
        updatePayload.messages = [{
          id: `msg_assistant_clarify_${row.id}`,
          role: 'assistant',
          content: clarifyMsg,
          timestamp: new Date().toISOString(),
          isLive: false,
          agentType: 'food',
          pendingFoodLog: clarifyLogWith,
          data: {
            needsPortionClarify: true,
            portionClarify: cleanRes.portionClarify,
            pendingFoodLog: clarifyLogWith,
            scoutItems: cleanRes.scoutItems || [],
            photoUrl: row.photo_url || cleanRes.photoUrl,
            debugUrl: row.debug_url || cleanRes.debugUrl,
            agentResult: {
              backendLogs: cleanRes.backendLogs || '',
              globalLiveLogs: cleanRes.backendLogs || '',
              scoutItems: cleanRes.scoutItems || [],
              activeStage: 'portion_clarify',
            },
          },
        }];
      }
      if ((row.status === 'succeeded' || row.status === 'awaiting_user' || row.status === 'failed') && existing.inFlightTurnAt) {
        const incomingKey = mealSnapshotKey(cleanRes);
        const existingKey = mealSnapshotKey(existing.result);
        if (row.status === 'failed' || (incomingKey && incomingKey !== existingKey)) {
          updatePayload.inFlightTurnAt = undefined;
          updatePayload.finishedAt = new Date().toISOString();
        }
      }
      JobStore.apply({ type: 'RealtimeRow', id: row.id, ...updatePayload } as any);

      if (cleanRes && cleanRes.is_r2 && !isEditInFlight) {
        fetchAndPopulateR2Job(row.id);
      }
    }
  }
}

const inFlightHydrations = new Map<string, Promise<void>>();

export async function hydrateUserJobs(userId: string = 'anonymous', isFull: boolean = true): Promise<void> {
  const effectiveUserId = (userId && userId !== 'anonymous') ? userId : (auth.currentUser?.uid || 'anonymous');
  const cacheKey = `${effectiveUserId}:${isFull}`;
  const existing = inFlightHydrations.get(cacheKey);
  if (existing) {
    return existing;
  }

  const runHydrate = async (): Promise<void> => {
    let loadedRows: any[] = [];
    let serverHydrationSucceeded = false;

  // 1. Try server route /api/jobs/status
  try {
    const controller = new AbortController();
    // Slow routes (cold boot, R2/Supabase latency) routinely exceed 10s —
    // aborting early causes retry storms and stuck "uploading" UI. One shot,
    // so allow a full window.
    const timeoutId = setTimeout(() => controller.abort(), 25000);
    try {
      const res = await fetch(`/api/jobs/status?userId=${encodeURIComponent(effectiveUserId)}&full=${isFull}`, { signal: controller.signal });
      if (res.ok) {
        serverHydrationSucceeded = true;
        const contentType = res.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const { jobs } = await res.json();
          if (Array.isArray(jobs) && jobs.length > 0) {
            loadedRows = jobs;
          }
        }
      }
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (e: any) {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      console.debug('[SupabaseJobSync] User offline, skipping job hydration');
      return;
    }
    console.debug('[SupabaseJobSync] Server /api/jobs/status deferred:', e?.message || e);
  }

  // 2. Direct Supabase Client fallback - only when server route failed AND direct REST is not disabled
  if (!serverHydrationSucceeded && loadedRows.length === 0 && isSupabaseConfigured && supabase && !isDirectClientSupabaseDisabled && effectiveUserId !== 'anonymous') {
    try {
      const { data, error, status } = await supabase
        .from('agent_jobs')
        .select('*')
        .eq('user_id', effectiveUserId)
        .order('updated_at', { ascending: false })
        .limit(20);
      if (status === 401 || (error && (error.message?.includes('401') || (error as any).code === 'PGRST301'))) {
        isDirectClientSupabaseDisabled = true;
        console.debug('[SupabaseJobSync] Direct Supabase REST disabled (unauthorized 401), deferring to server endpoint');
      } else if (!error && Array.isArray(data) && data.length > 0) {
        loadedRows = data;
      }
    } catch (sbErr: any) {
      if (sbErr?.status === 401 || sbErr?.message?.includes('401')) {
        isDirectClientSupabaseDisabled = true;
      }
      console.debug('[SupabaseJobSync] Direct Supabase hydrate error:', sbErr);
    }
  }

  // 3. Firebase Firestore mirror fallback (cross-network guarantee)
  if (!serverHydrationSucceeded && loadedRows.length === 0 && effectiveUserId !== 'anonymous' && db) {
    try {
      const snapshot = await getDocs(collection(db, 'users', effectiveUserId, 'inbox_jobs'));
      const fsRows: any[] = [];
      snapshot.forEach(docSnap => {
        if (docSnap.exists()) {
          fsRows.push(docSnap.data());
        }
      });
      if (fsRows.length > 0) {
        loadedRows = fsRows;
      }
    } catch (fsErr) {
      console.debug('[SupabaseJobSync] Firestore inbox_jobs hydrate error:', fsErr);
    }
  }

  if (loadedRows.length > 0) {
    processJobRows(loadedRows, effectiveUserId);
  }
  };

  const promise = runHydrate().finally(() => {
    inFlightHydrations.delete(cacheKey);
  });
  inFlightHydrations.set(cacheKey, promise);
  return promise;
}

export function fetchJobsFromSupabase(userId?: string) {
  return hydrateUserJobs(userId);
}

export function initSupabaseJobSync(userId?: string): () => void {
  // Always hydrate initial jobs from server API / cloud on mount (deferred past first paint to avoid blocking TTI - R-9)
  let initialHydrateTimer: any = null;
  if (typeof requestIdleCallback !== 'undefined') {
    initialHydrateTimer = requestIdleCallback(() => { hydrateUserJobs(userId).catch(() => {}); }, { timeout: 3500 });
  } else {
    initialHydrateTimer = setTimeout(() => { hydrateUserJobs(userId).catch(() => {}); }, 2500);
  }

  // Fallback poll: the realtime channel below is a single WebSocket subscription with
  // no reconnect logic. On flaky mobile connections it can silently drop, leaving jobs
  // stuck at their last-seen progress forever even though the backend actually finished.
  // Re-hydrate from the server periodically so any job stuck in a non-terminal status
  // eventually catches up regardless of realtime channel health.
  const fallbackPollInterval = setInterval(() => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return;
    }
    
    const now = Date.now();
    let hasActiveJob = false;
    
    JobStore.getAllJobs().forEach((j: any) => {
      // Exclude front_desk jobs from triggering cloud hydration polling
      if (j.kind === 'front_desk' || (j.id && j.id.startsWith('job_frontdesk_'))) {
        return;
      }
      if (j.status === 'running' || j.status === 'pending') {
        const startedAt = Math.max(
          typeof j.serverSubmittedAt === 'number' ? j.serverSubmittedAt : new Date(j.serverSubmittedAt || 0).getTime(),
          typeof j.inFlightTurnAt === 'number' ? j.inFlightTurnAt : 0,
          new Date(j.updatedAt || 0).getTime(),
          new Date(j.createdAt || now).getTime()
        );
        if (now - startedAt > 10 * 60 * 1000) {
          JobStore.apply({ type: 'AnalyzeFailed', id: j.id, error: 'timeout' });
        } else {
          hasActiveJob = true;
        }
      }
    });

    if (hasActiveJob) {
      hydrateUserJobs(userId, false).catch(() => {});
    }
  }, 8000);

  if (!isSupabaseConfigured || !supabase || isDirectClientSupabaseDisabled) {
    console.log('[SupabaseJobSync] Supabase direct client/realtime disabled, relying on background polling');
    return () => {
      if (initialHydrateTimer != null) {
        if (typeof cancelIdleCallback !== 'undefined' && typeof initialHydrateTimer === 'number') {
          cancelIdleCallback(initialHydrateTimer);
        } else {
          clearTimeout(initialHydrateTimer);
        }
      }
      clearInterval(fallbackPollInterval);
    };
  }

  // Tracks the most recent `updated_at` timestamp successfully applied per job, so that
  // a slow/in-flight R2 fetch for an older update cannot overwrite a newer update that
  // finished (and was applied) first. Prevents out-of-order state application caused by
  // the unawaited async R2 fetch inside the realtime handler below.
  const lastAppliedUpdatedAt = new Map<string, string>();

  const channel = supabase.channel('public:agent_jobs')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'agent_jobs',
        filter: userId ? `user_id=eq.${userId}` : undefined,
      },
      (payload) => {
        if (payload.eventType === 'DELETE') {
          const oldRow = payload.old as any;
          if (oldRow && oldRow.id) {
            JobStore.deleteJob(oldRow.id);
          }
          return;
        }
        const row = payload.new as any;
        if (!row || !row.id || JobStore.isJobDeleted(row.id)) {
          if (row && row.id && JobStore.isJobDeleted(row.id)) {
            forgetDeletedOnBackend(row.id, userId || 'anonymous');
          }
          return;
        }

        const processRow = async () => {
          const rowUpdatedAt = row.updated_at || '';

          let cleanRes = row.clean_result;
          const existingJobForR2Check = JobStore.getJob(row.id);

          if (cleanRes && typeof cleanRes === 'object' && cleanRes.is_r2 && cleanRes.r2_url) {
            try {
              // Bypassing client-side CORS issues by fetching through our own backend proxy endpoint
              const baseUrl = typeof window !== 'undefined' ? '' : 'http://localhost:3000';
              const r2Controller = new AbortController();
              const r2TimeoutId = setTimeout(() => r2Controller.abort(), 6000);
              let r: Response;
              try {
                r = await fetch(`${baseUrl}/api/jobs/status?jobId=${row.id}&full=true`, { signal: r2Controller.signal });
              } finally {
                clearTimeout(r2TimeoutId);
              }
              if (r.ok) {
                const contentType = r.headers.get('content-type');
                if (contentType && contentType.includes('application/json')) {
                  const fetchedWrapper = await r.json();
                  if (fetchedWrapper && fetchedWrapper.jobs && fetchedWrapper.jobs.length > 0) {
                    // Our backend automatically unwraps the R2 result when fetching
                    const backendJob = fetchedWrapper.jobs[0];
                    if (backendJob && backendJob.clean_result) {
                      cleanRes = backendJob.clean_result;
                    }
                  }
                }
              }
            } catch (err) {
              console.warn('[SupabaseJobSync] Realtime R2 fetch via backend failed:', err);
            }
          }

          // Guard against out-of-order application: if a newer update for this job was
          // already applied while this row's (possibly slow) R2 fetch was in flight, skip
          // this stale write instead of overwriting the newer state.
          const alreadyApplied = lastAppliedUpdatedAt.get(row.id);
          if (alreadyApplied && rowUpdatedAt && alreadyApplied > rowUpdatedAt) {
            console.log(`[SupabaseJobSync] Skipping stale update for job ${row.id}`);
            return;
          }
          if (rowUpdatedAt) {
            lastAppliedUpdatedAt.set(row.id, rowUpdatedAt);
          }

          const existingJob = JobStore.getJob(row.id);
          if (isStalePriorTurn(existingJob, row.status, rowUpdatedAt)) {
            console.log(`[SupabaseJobSync] Skipping stale prior-turn realtime row for job ${row.id}`);
            return;
          }

          const updatedFields: any = {
            status: row.status,
            progressPercent: row.progress_percent,
            statusMessage: row.status_message || (existingJob?.inFlightTurnAt && (row.status === 'queued' || row.status === 'running') ? 'Updating meal...' : undefined),
          };
          if ((row.status === 'succeeded' || row.status === 'awaiting_user' || row.status === 'failed') && existingJob?.inFlightTurnAt) {
            const incomingKey = mealSnapshotKey(cleanRes);
            const existingKey = mealSnapshotKey(existingJob.result);
            if (row.status === 'failed' || (incomingKey && incomingKey !== existingKey)) {
              updatedFields.inFlightTurnAt = undefined;
              updatedFields.finishedAt = new Date().toISOString();
            }
          }

          if (cleanRes) {
            updatedFields.result = {
              ...(existingJob?.result || {}),
              ...cleanRes,
              photoUrl: row.photo_url || cleanRes.photoUrl || existingJob?.result?.photoUrl,
              debugUrl: row.debug_url || cleanRes.debugUrl || existingJob?.result?.debugUrl,
              mealBuild: cleanRes.mealBuild || existingJob?.result?.mealBuild,
            };
            if (cleanRes.mealBuild) {
              updatedFields.mealBuild = cleanRes.mealBuild;
            }
            if (row.photo_url || cleanRes.photoUrl) {
              updatedFields.photoUrl = row.photo_url || cleanRes.photoUrl;
            }
            if (row.debug_url || cleanRes.debugUrl) {
              updatedFields.debugUrl = row.debug_url || cleanRes.debugUrl;
            }
          }

          if (row.status === 'awaiting_user' && cleanRes) {
            const clarifyMsg = cleanRes.message || row.status_message || 'Confirm how much you ate';
            const nonLive = (existingJob?.messages || []).filter((m: any) => !m.isLive);
            const alreadyHasClarify = nonLive.some((m: any) => m.id === `msg_assistant_clarify_${row.id}`);
            if (!alreadyHasClarify) {
              updatedFields.messages = [
                ...nonLive,
                {
                  id: `msg_assistant_clarify_${row.id}`,
                  role: 'assistant',
                  content: clarifyMsg,
                  timestamp: new Date().toISOString(),
                  isLive: false,
                  agentType: 'food',
                  data: {
                    needsPortionClarify: true,
                    portionClarify: cleanRes.portionClarify,
                    scoutItems: cleanRes.scoutItems || [],
                    photoUrl: row.photo_url || cleanRes.photoUrl,
                    debugUrl: row.debug_url || cleanRes.debugUrl,
                    agentResult: {
                      backendLogs: cleanRes.backendLogs || '',
                      globalLiveLogs: cleanRes.backendLogs || '',
                      scoutItems: cleanRes.scoutItems || [],
                      activeStage: 'portion_clarify',
                    },
                  },
                },
              ];
            }
          }

          let assistantMsg: any = undefined;
          if (row.status === 'succeeded' && cleanRes && !cleanRes.is_r2) {
            const pendingFoodLog = cleanRes.pendingFoodLog || (cleanRes.mealBuild ? toPendingFoodLog(cleanRes.mealBuild) : null) || cleanRes.data;
            const messageText = cleanRes.message || cleanRes.text || pendingFoodLog?.message || 'Analysis complete.';
            if (existingJob?.messages && existingJob.messages.length > 0) {
              const nonLive = existingJob.messages.filter((m: any) => !m.isLive);
              const lastNonLive = nonLive[nonLive.length - 1];
              const isNewTurn = lastNonLive && lastNonLive.role === 'user';
              assistantMsg = {
                id: isNewTurn ? `msg_assistant_${row.id}_${Date.now()}` : `msg_assistant_${row.id}`,
                role: 'assistant',
                content: messageText,
                timestamp: new Date().toISOString(),
                isLive: false,
                agentType: existingJob.kind === 'medical' ? 'agent1' : 'food',
                pendingFoodLog: pendingFoodLog || undefined,
                data: {
                  jobId: row.id,
                  pendingFoodLog: pendingFoodLog || undefined,
                  photoUrl: row.photo_url || cleanRes.photoUrl || existingJob.photoUrl,
                  debugUrl: row.debug_url || cleanRes.debugUrl || existingJob.debugUrl,
                  scoutItems: cleanRes.scoutItems || [],
                  mode: row.mode || cleanRes.mode || 'review',
                  agentResult: {
                    backendLogs: cleanRes.backendLogs || '',
                    globalLiveLogs: cleanRes.backendLogs || '',
                    dietitianAnswer: messageText,
                    scoutItems: cleanRes.scoutItems || [],
                  },
                },
              };
            }
          }

          if (row.status === 'failed') {
            updatedFields.error = {
              class: 'permanent',
              message: row.status_message || 'Analysis failed on server',
            };
          }

          JobStore.apply({ type: 'RealtimeRow', id: row.id, ...updatedFields, messages: assistantMsg ? [assistantMsg] : undefined, currentTurn: row.current_turn } as any);
        };

        processRow().catch((err) => {
          console.error('[SupabaseJobSync] Error processing realtime row:', err);
        });
      }
    )
    .subscribe();

  return () => {
    if (initialHydrateTimer != null) {
      if (typeof cancelIdleCallback !== 'undefined' && typeof initialHydrateTimer === 'number') {
        cancelIdleCallback(initialHydrateTimer);
      } else {
        clearTimeout(initialHydrateTimer);
      }
    }
    clearInterval(fallbackPollInterval);
    try {
      supabase.removeChannel(channel).catch(() => {});
    } catch (_) {}
  };
}

export async function upsertJobToSupabase(
  job: AgentJob,
  userId: string = 'anonymous',
  photoUrl?: string,
  debugUrl?: string,
  cleanResult?: any
): Promise<void> {
  // Do not sync ephemeral front desk triage conversations to cloud agent_jobs table
  if (job.kind === 'front_desk' || (job.id && job.id.startsWith('job_frontdesk_'))) {
    return;
  }
  const effectiveUserId = (userId && userId !== 'anonymous') ? userId : (auth.currentUser?.uid || 'anonymous');
  try {
    let finalCleanResult = cleanResult || job.result || null;
    if (job.sessionEvents && job.sessionEvents.length > 0) {
      finalCleanResult = {
        ...(finalCleanResult || {}),
        sessionEvents: job.sessionEvents,
      };
    }
    if (job.mealBuild) {
      finalCleanResult = {
        ...(finalCleanResult || {}),
        mealBuild: undefined,
      };
    }

    if (job.messages && job.messages.length > 0) {
      finalCleanResult = {
        ...(finalCleanResult || {}),
        messages: job.messages.map((m: any) => {
          const stripped = { ...m };
          delete stripped.imageUrl;
          delete stripped.imageUrls;
          return stripped;
        })
      };
    }

    const payload = {
      id: job.id,
      user_id: effectiveUserId,
      kind: job.kind,
      mode: job.mode || 'review',
      status: job.status,
      progress_percent: job.progressPercent || 0,
      status_message: job.statusMessage || '',
      photo_url: photoUrl || job.photoUrl || job.result?.photoUrl || null,
      debug_url: debugUrl || job.result?.debugUrl || null,
      clean_result: finalCleanResult,
      updated_at: new Date().toISOString(),
    };
    
    // 1. Push through backend server endpoint
    let serverUpsertSuccess = false;
    const diag4Start = Date.now();
    console.log(`[DIAG4] upsertJobToSupabase: calling /api/jobs/upsert for job ${job.id}`);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      const res = await fetch('/api/jobs/upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(auth.currentUser ? { Authorization: `Bearer ${await auth.currentUser.getIdToken()}` } : {}) },
        body: JSON.stringify({ payload }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      console.log(`[DIAG4] upsertJobToSupabase: /api/jobs/upsert for job ${job.id} responded ${res.status} in ${Date.now() - diag4Start}ms`);
      if (res.ok) {
        serverUpsertSuccess = true;
      }
    } catch (backendErr: any) {
      console.debug(`[DIAG4] upsertJobToSupabase: /api/jobs/upsert for job ${job.id} failed/timed out after ${Date.now() - diag4Start}ms:`, backendErr?.message || backendErr);
      console.debug('[SupabaseJobSync] Backend /api/jobs/upsert not reachable, using direct cloud sync:', backendErr?.message || backendErr);
    }

    // 2. Direct Supabase Client fallback
    if (!serverUpsertSuccess && isSupabaseConfigured && supabase && !isDirectClientSupabaseDisabled) {
      try {
        const { error, status } = await supabase.from('agent_jobs').upsert(payload);
        if (status === 401 || (error && (error.message?.includes('401') || (error as any).code === 'PGRST301'))) {
          isDirectClientSupabaseDisabled = true;
          console.debug('[SupabaseJobSync] Direct Supabase upsert disabled (unauthorized 401), deferring to server endpoint');
        } else if (!error) {
          serverUpsertSuccess = true;
        }
      } catch (sbErr: any) {
        if (sbErr?.status === 401 || sbErr?.message?.includes('401')) {
          isDirectClientSupabaseDisabled = true;
        }
        console.debug('[SupabaseJobSync] Direct Supabase upsert fallback error:', sbErr);
      }
    }

    // 3. Firebase Firestore mirror — LAST-RESORT FALLBACK ONLY.
    // Only attempt this if both the backend push (Step 1) and the direct
    // Supabase client fallback (Step 2) failed to save the job. When either
    // already succeeded, writing to Firestore here is redundant and only
    // burns free-tier Firestore quota, so we skip it.
    if (!serverUpsertSuccess && effectiveUserId && effectiveUserId !== 'anonymous' && db) {
      const diag4FsStart = Date.now();
      console.log(`[DIAG4] upsertJobToSupabase: Step 1/2 failed, attempting Firestore mirror for job ${job.id}`);
      try {
        const cleanPayload = sanitizeForFirestore(payload);
        await Promise.race([
          setDoc(doc(db, 'users', effectiveUserId, 'inbox_jobs', payload.id), cleanPayload, { merge: true }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Firestore mirror write timed out after 8000ms')), 8000))
        ]);
        console.log(`[DIAG4] upsertJobToSupabase: Firestore mirror for job ${job.id} finished in ${Date.now() - diag4FsStart}ms`);
      } catch (fsErr) {
        console.debug(`[DIAG4] upsertJobToSupabase: Firestore mirror for job ${job.id} failed/timed out after ${Date.now() - diag4FsStart}ms:`, fsErr);
        console.debug('[SupabaseJobSync] Firestore inbox_jobs write skipped/failed:', fsErr);
      }
    }
  } catch (err: any) {
    const isFetchErr = err && (err.name === 'TypeError' || (err.message && err.message.includes('Failed to fetch')));
    if (isFetchErr) {
      console.debug('[SupabaseJobSync] Job upsert deferred (offline/network timeout):', err.message || err);
    } else {
      console.warn('[SupabaseJobSync] Failed to upsert job to backend/Supabase:', err);
    }
  }
}

/**
 * Upsert storm guard (DIAG4 flood): JobStore.apply fires on EVERY job event,
 * and completion applies AnalyzeFinished 2-3x within milliseconds — each used
 * to spawn a full upsert (photo payload, 0.3-6s). Bursts collapse to at most
 * one active + one trailing run, always ending on the LATEST snapshot.
 * Fire-and-forget like the JobStore call site; completion paths that need the
 * result keep calling upsertJobToSupabase directly.
 */
const coalescedUpsertState = new Map<string, { inflight: Promise<unknown> | null; pending: AgentJob | null }>();

export function scheduleCoalescedJobUpsert(job: AgentJob): void {
  if (!job || !job.id) return;
  let st = coalescedUpsertState.get(job.id);
  if (!st) {
    st = { inflight: null, pending: null };
    coalescedUpsertState.set(job.id, st);
  }
  st.pending = job;
  if (st.inflight) return;
  void runCoalescedUpsert(job.id);
}

async function runCoalescedUpsert(jobId: string): Promise<void> {
  const st = coalescedUpsertState.get(jobId);
  if (!st) return;
  while (st.pending) {
    const next = st.pending;
    st.pending = null;
    st.inflight = upsertJobToSupabase(next).catch(() => {});
    try {
      await st.inflight;
    } finally {
      st.inflight = null;
    }
  }
  coalescedUpsertState.delete(jobId);
}

export async function deleteJobFromBackend(
  jobId: string,
  userId: string = 'anonymous'
): Promise<void> {
  if (!jobId) return;
  const effectiveUserId = (userId && userId !== 'anonymous') ? userId : (auth.currentUser?.uid || 'anonymous');

  try {
    const baseUrl = typeof window !== 'undefined' ? '' : 'http://localhost:3000';
    await fetch(`${baseUrl}/api/jobs/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(auth.currentUser ? { Authorization: `Bearer ${await auth.currentUser.getIdToken()}` } : {}) },
      body: JSON.stringify({ jobId, userId: effectiveUserId }),
    }).catch(() => {});

    if (isSupabaseConfigured && supabase && !isDirectClientSupabaseDisabled) {
      try {
        await supabase.from('agent_jobs').delete().eq('id', jobId);
      } catch (_) {}
    }

    if (effectiveUserId && effectiveUserId !== 'anonymous' && db) {
      try {
        await deleteDoc(doc(db, 'users', effectiveUserId, 'inbox_jobs', jobId));
      } catch (_) {}
    }
  } catch (err: any) {
    const isFetchErr = err && (err.name === 'TypeError' || (err.message && err.message.includes('Failed to fetch')));
    if (isFetchErr) {
      console.debug('[SupabaseJobSync] Job delete deferred (offline/network timeout):', err.message || err);
    } else {
      console.warn('[SupabaseJobSync] Error deleting job from backend:', err);
    }
  }
}