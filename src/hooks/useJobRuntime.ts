/**
 * Q-11.3c - the job runtime, moved out of `src/App.tsx` (move-only).
 *
 * Owns what used to be the shell's mount effect: the `JobQueueRunner` executor and lifecycle,
 * the `/api/jobs/status` poll loop, the golden-ingest idle watcher, the `JobStore`
 * credit-settlement subscriber and the `window.JobStore` / `window.setActiveJobId` globals.
 * It also owns the `activeJobId` state and `handleOpenJob` the shell renders from.
 *
 * Deliberate non-changes, so a later pass does not "fix" them by accident:
 * - the effect keeps its original `[]` dependency array, so `profile` (retry status messages)
 *   and `actions` / `dailyBenefits` / `report` (the settlement persist call) are the values
 *   captured at mount - exactly what this code did while it lived in `App.tsx`.
 * - `saveAndSync` arrives through `saveAndSyncRef` (Q-11.3b): it is declared ~2,300 lines after
 *   the subscriber mounts, so a direct call would be a render-time TDZ error.
 * - `visibilityAwareSleep` and `extractPendingFoodLogFromCleanResult` moved with their only
 *   caller; they stay module-private and their comments are unchanged.
 */
import { useEffect, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { auth } from '../firebase';
import { JobStore, isStalePriorTurn } from '../jobs/JobStore';
import { JobQueueRunner } from '../jobs/JobQueueRunner';
import { ImageStore } from '../jobs/ImageStore';
import { refundCredits } from '../jobs/credits';
import { getSessionLog } from '../jobs/sessionLog';
import { mergeFoodEditMessages, shouldMergeFoodEditTurn } from '../jobs/mergeFoodEditMessages';
import { saveAgentRequestLog } from '../utils/agentLogsTracker';
import { translations } from '../utils/translations';
import { compressImage } from '../utils/imageCompressor';
import { collectCatalogUnitMap, enrichReviewModificationCommands } from '../utils/biomarkerLifecycle';
import { isCompareOnlyResult } from '../utils/compareMealLogGuard';
import { toPendingFoodLog } from '../mealBuild/adapters';
import type { BiomarkerLog, DailyBenefit, FoodLog, HealthAction, RecommendationReport, UserProfile } from '../types';

/** The agent-type union the medical chat dialog keys off (was `App.tsx` state). */
export type JobRuntimeAgentType =
  | 'agent1' | 'agent2' | 'agent3' | 'agent4' | 'agent5'
  | 'health_baseline' | 'agent7' | 'data_review' | 'biomarker_review'
  | null;

/**
 * `saveAndSync` as the credit-settlement subscriber sees it. The ref is injected (Q-11.3b) and
 * the hook only forwards the call, so the return type stays open (`unknown`, awaited).
 */
export type JobRuntimePersist = (
  currProfile: UserProfile | null,
  currFoods: FoodLog[],
  currBiomarkers: { [key: string]: number | string },
  currBioHistory: BiomarkerLog[],
  currActions: HealthAction[],
  currBenefits: DailyBenefit[],
  currReport: RecommendationReport | null,
  specificUpdate?: { type: string },
) => unknown;

export interface UseJobRuntimeOptions {
  /** Current profile, read at mount by the executor's retry status messages ([] deps). */
  profile: UserProfile | null;
  /** Latest-value refs the background runner reads without stale closures. */
  profileRef: MutableRefObject<UserProfile | null>;
  foodLogsRef: MutableRefObject<FoodLog[]>;
  biomarkersRef: MutableRefObject<{ [key: string]: number | string }>;
  biomarkerHistoryRef: MutableRefObject<BiomarkerLog[]>;
  /** The app persist call, injected by reference (Q-11.3b). */
  saveAndSyncRef: MutableRefObject<JobRuntimePersist | null>;
  /** Mount-time snapshot handed to the settlement persist call, as before the move. */
  actions: HealthAction[];
  dailyBenefits: DailyBenefit[];
  report: RecommendationReport | null;
  setProfile: Dispatch<SetStateAction<UserProfile | null>>;
  /** Dialog setters `handleOpenJob` drives; hoisted above the hook site in Q-11.3a. */
  setIsMedicalChatOpen: Dispatch<SetStateAction<boolean>>;
  setIsFrontDeskOpen: Dispatch<SetStateAction<boolean>>;
  setActiveFrontDeskJobId: Dispatch<SetStateAction<string | null>>;
  setActiveAgentType: Dispatch<SetStateAction<JobRuntimeAgentType>>;
  setActiveReviewBiomarkerKey: Dispatch<SetStateAction<string | undefined>>;
}

export interface UseJobRuntimeReturn {
  activeJobId: string | null;
  setActiveJobId: Dispatch<SetStateAction<string | null>>;
  handleOpenJob: (jobId: string) => void;
}

// Mobile/background tabs throttle or fully suspend plain setTimeout timers, so a job-status
// poll loop using a flat `setTimeout(ms)` can silently stall for minutes after the tab is
// backgrounded (screen lock, app switch) even though the server finished the job seconds in.
// This resolves early the moment the tab regains visibility, in addition to the normal delay,
// so polling catches up immediately on foreground instead of waiting for the next throttled tick.
function visibilityAwareSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisible);
      }
      resolve();
    };
    const onVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        finish();
      }
    };
    const timeoutId = setTimeout(finish, ms);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisible);
    }
  });
}

function extractPendingFoodLogFromCleanResult(cleanResult: any, photoUrl?: string): any {
  if (!cleanResult) return null;
  // Mode D boundary: a compare result is never a meal — its items are
  // mutually exclusive candidates. Fabricating a log here produced a
  // 19-name &-joined title, doubled composition rows, and a "Log This Food"
  // button that would log compared products as consumed.
  if (isCompareOnlyResult(cleanResult)) return null;
  let log: any = null;
  const isEditResult = cleanResult.mode === 'modify' || cleanResult.mode === 'edit';

  if (isEditResult && cleanResult.pendingFoodLog) {
    log = cleanResult.pendingFoodLog;
  } else if (isEditResult && cleanResult.foodData) {
    log = cleanResult.foodData;
  } else if (cleanResult.mealBuild) {
    log = toPendingFoodLog(cleanResult.mealBuild);
  } else if (cleanResult.pendingFoodLog) {
    log = cleanResult.pendingFoodLog;
  } else if (cleanResult.foodData) {
    log = cleanResult.foodData;
  } else if (cleanResult.data && typeof cleanResult.data === 'object' && (cleanResult.data.itemsBreakdown || cleanResult.data.name || cleanResult.data.nutrients)) {
    log = cleanResult.data;
  } else {
    const items = cleanResult.scoutItems || cleanResult.itemsBreakdown || cleanResult.items || [];
    if (items.length > 0 || cleanResult.name || cleanResult.title) {
      log = {
        itemsBreakdown: items,
        items: items,
        nutrients: cleanResult.nutrients || {},
        name: cleanResult.name || cleanResult.title || 'Meal',
        title: cleanResult.name || cleanResult.title || 'Meal',
        message: cleanResult.message || cleanResult.text || cleanResult.description || '',
        healthImpact: cleanResult.healthImpact || cleanResult.data?.healthImpact || '',
        composition: cleanResult.composition || cleanResult.data?.composition || '',
        benefits: cleanResult.benefits || [],
        risks: cleanResult.risks || [],
        recommendation: cleanResult.recommendation || '',
        verdict: cleanResult.verdict || '',
        receiptTable: cleanResult.receiptTable,
        weightGrams: cleanResult.weightGrams,
        quantity: cleanResult.quantity
      };
    }
  }
  if (log) {
    log.message = log.message || cleanResult.message || cleanResult.text || cleanResult.description || cleanResult.data?.description || '';
    log.healthImpact = log.healthImpact || cleanResult.healthImpact || cleanResult.data?.healthImpact || '';
    log.composition = log.composition || cleanResult.composition || cleanResult.data?.composition || '';
    log.verdict = log.verdict || cleanResult.verdict || cleanResult.data?.verdict || '';
    log.imageUrls = log.imageUrls?.length ? log.imageUrls : (cleanResult.imageUrls || (photoUrl ? [photoUrl] : []));
    log.photoUrl = log.photoUrl || photoUrl || cleanResult.photoUrl;
    return log;
  }
  return null;
}

export function useJobRuntime(options: UseJobRuntimeOptions): UseJobRuntimeReturn {
  // Read once per render, exactly like the shell body did before the move. The mount effect
  // below keeps its `[]` deps, so the values it closes over are the mount-render ones.
  const {
    profile,
    profileRef,
    foodLogsRef,
    biomarkersRef,
    biomarkerHistoryRef,
    saveAndSyncRef,
    actions,
    dailyBenefits,
    report,
    setProfile,
    setIsMedicalChatOpen,
    setIsFrontDeskOpen,
    setActiveFrontDeskJobId,
    setActiveAgentType,
    setActiveReviewBiomarkerKey,
  } = options;

  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  useEffect(() => {
    // Configure executor for background queue runner
    JobQueueRunner.setExecutor(async (job, abortSignal) => {
      let attempts = 0;
      const maxAttempts = 3; // Initial + 2 retries
      let lastError = null;

      while (attempts < maxAttempts) {
        attempts++;
        const currentJob = JobStore.getJob(job.id);
        const effectiveAttempt = Math.max(attempts, currentJob?.attemptCount || 1);
        JobStore.updateJob(job.id, {
          attemptCount: effectiveAttempt,
          maxAttempts: maxAttempts
        });
        if (effectiveAttempt > 1) {
          console.log(`[JobQueueRunner] Retrying job ${job.id} (Attempt ${effectiveAttempt}/${maxAttempts})`);
          JobStore.updateJob(job.id, {
            statusMessage: ((translations[profile?.language] || translations.en).retryingAttemptNofM || 'Retrying (attempt {n}/{max})...').replace('{n}', String(effectiveAttempt)).replace('{max}', String(maxAttempts))
          });
        }

        try {
          if (abortSignal.aborted) {
            throw new Error('AbortError');
          }

          // Durable jobs execute on server via /api/jobs/submit
          if (job.kind === 'food_log' || job.kind === 'food_compare' || job.kind === 'medical') {
            const latestForSubmit = JobStore.getJob(job.id) || job;
            const isRetryAttempt = effectiveAttempt > 1 || job.status === 'failed' || !!job.error || /retry|retrying|failed/i.test(latestForSubmit.statusMessage || '');
            const clientOwnsSubmit = !isRetryAttempt && !!latestForSubmit.clientSubmitPending
              && !String(latestForSubmit.statusMessage || '').includes('background runner retrying submit');
            // Ensure job is submitted to server for retries or new jobs not yet pushed
            const needsServerSubmit = !clientOwnsSubmit && (
              isRetryAttempt ||
              !latestForSubmit.serverSubmittedAt ||
              !!latestForSubmit.resumeStage
            );
            if (needsServerSubmit) {
              console.log(`[JobQueueRunner] Submitting job ${job.id} to server (Attempt ${effectiveAttempt}/${maxAttempts}, isRetry=${isRetryAttempt})...`);
              let stringImages = [];
              try {
                const rawImages = (await ImageStore.getImages(job.id)) || [];
                stringImages = await Promise.all(
                  rawImages.map(async (img: any) => {
                    try {
                      return await compressImage(img, 1600, 1600, 0.85);
                    } catch {
                      if (typeof img === 'string') return img;
                      if (img && typeof img === 'object') {
                        const blob = img instanceof Blob ? img : new Blob([img], { type: img.type || 'image/jpeg' });
                        return new Promise((resolve) => {
                          const reader = new FileReader();
                          reader.onload = () => resolve(reader.result);
                          reader.onerror = () => resolve('');
                          reader.readAsDataURL(blob);
                        });
                      }
                      return '';
                    }
                  })
                );
              } catch(e) {}
              
              let submitOk = false;
              let lastSubmitErr: any = null;
              const submitTimeoutMs = 60000;
              for (let sAttempt = 1; sAttempt <= 3; sAttempt++) {
                const sCtrl = new AbortController();
                const sTimer = setTimeout(() => sCtrl.abort(), submitTimeoutMs);
                const sStart = Date.now();
                try {
                  const w = typeof window !== 'undefined' ? (window as any) : {};
                  const submitSessionEvents = getSessionLog(job.id).length > 0
                    ? getSessionLog(job.id)
                    : (job.sessionEvents || latestForSubmit.sessionEvents || undefined);
                  const submitPriorLogs = latestForSubmit.backendLogs || job.backendLogs || (latestForSubmit as any).clean_result?.backendLogs || (job as any).clean_result?.backendLogs || undefined;
                  const submitDispatches = latestForSubmit.dispatches || job.dispatches || (latestForSubmit as any).clean_result?.dispatches || (job as any).clean_result?.dispatches || undefined;

                  const res = await fetch('/api/jobs/submit', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal: sCtrl.signal,
                    body: JSON.stringify({
                      jobId: job.id,
                      userId: auth.currentUser?.uid || 'anonymous',
                      kind: job.kind,
                      mode: job.mode,
                      text: job.inputSnapshot?.text || '',
                      images: stringImages.filter(Boolean),
                      history: job.messages || [],
                      userProfile: profileRef.current,
                      isRetry: isRetryAttempt,
                      attempt: effectiveAttempt,
                      sessionEvents: submitSessionEvents,
                      clientConsoleLogs: w.__clientConsoleLogs || [],
                      networkErrors: w.__clientNetworkErrors || [],
                      userActionBreadcrumbs: w.__userActionBreadcrumbs || [],
                      lastUserAction: w.__lastUserAction || null,
                      priorLogs: submitPriorLogs,
                      dispatches: submitDispatches,
                      ...job.inputSnapshot
                    })
                  });
                  if (res.ok) {
                    clearTimeout(sTimer);
                    console.log(`[JobQueueRunner] Submit ok for job ${job.id} (attempt ${sAttempt}/3, ${Date.now() - sStart}ms).`);
                    // M-FIX2: A 200 here does not guarantee THIS job was actually queued.
                    // The server's per-user in-flight lock can silently redirect a new
                    // submission onto an older, unrelated, still-running job and return
                    // duplicatePrevented:true with that OLDER job's id. Previously this
                    // was indistinguishable from a real success, so the client polled a
                    // jobId the server never created and only found out 3 minutes later
                    // via the generic timeout message, with no real analysis ever run.
                    let resBody: any = null;
                    try { resBody = await res.clone().json(); } catch { /* non-JSON body, treat as normal success */ }
                    if (resBody && resBody.duplicatePrevented) {
                      console.log(`[JobQueueRunner] Submission for job ${job.id} was handled idempotently by server (status=${resBody.status || 'active'}). Polling job status.`);
                      submitOk = true;
                      break;
                    }
                    submitOk = true;
                    break;
                  }
                  if (res.status >= 500 && sAttempt < 3) {
                    clearTimeout(sTimer);
                    console.warn(`[JobQueueRunner] Submit HTTP ${res.status} for job ${job.id} (attempt ${sAttempt}/3) — retrying.`);
                    await new Promise(r => setTimeout(r, 500 * sAttempt));
                    continue;
                  }
                  const errTxt = await res.text().catch(() => '');
                  clearTimeout(sTimer);
                  throw new Error(`HTTP ${res.status}${errTxt ? ': ' + errTxt.slice(0, 200) : ''}`);
                } catch (sErr: any) {
                  clearTimeout(sTimer);
                  const timedOut = sErr?.name === 'AbortError';
                  lastSubmitErr = timedOut
                    ? new Error(`Submit timed out after ${submitTimeoutMs}ms (attempt ${sAttempt}/3)`)
                    : sErr;
                  console.warn(`[JobQueueRunner] Submit ${timedOut ? 'timed out' : 'failed'} for job ${job.id} (attempt ${sAttempt}/3):`, lastSubmitErr?.message || lastSubmitErr);
                  if (sAttempt < 3) {
                    await new Promise(r => setTimeout(r, 500 * sAttempt));
                  }
                }
              }

              if (!submitOk) {
                throw lastSubmitErr || new Error('Failed to submit job to server after 3 attempts');
              }

              JobStore.apply({
                type: 'ServerStatus',
                id: job.id,
                status: (JobStore.getJob(job.id)?.status || 'running') as any,
                serverSubmittedAt: Date.now(),
                resumeStage: undefined,
              });
            }

            // Safety guard: if client is actively performing the network submit, wait briefly
            // for it to complete so we don't read stale prior-turn status from the server.
            let clientSubmitWait = 0;
            while (JobStore.getJob(job.id)?.clientSubmitPending && clientSubmitWait < 30) {
              if (abortSignal.aborted) throw new Error('AbortError');
              await new Promise(r => setTimeout(r, 500));
              clientSubmitWait++;
            }

            console.log(`[JobQueueRunner] Job ${job.id} is server-owned. Polling /api/jobs/status...`);
            let done = false;
            const pollStartTime = Date.now();
            const maxPollTimeMs = 5 * 60 * 1000; // Extended 5 minute timeout window (was 3 min; large multi-item edits can exceed 3 min)
            let r2RetryCount = 0;

            while (!done && (Date.now() - pollStartTime) < maxPollTimeMs) {
              if (abortSignal.aborted) {
                throw new Error('AbortError');
              }

              let serverJob: any = null;
              try {
                if (typeof navigator !== 'undefined' && !navigator.onLine) {
                  await new Promise(r => setTimeout(r, 2000));
                  continue;
                }
                const statusController = new AbortController();
                const timeoutId = setTimeout(() => statusController.abort(), 20000);
                let statusRes: Response;
                try {
                  statusRes = await fetch(`/api/jobs/status?jobId=${job.id}&userId=${auth.currentUser?.uid || 'anonymous'}`, { signal: statusController.signal });
                } finally {
                  clearTimeout(timeoutId);
                }
                if (statusRes.ok) {
                  const contentType = statusRes.headers.get('content-type');
                  if (contentType && contentType.includes('application/json')) {
                    const { jobs } = await statusRes.json();
                    serverJob = jobs && jobs[0];
                  }
                }
              } catch (pollErr: any) {
                const isFetchErr = pollErr && (pollErr.name === 'TypeError' || pollErr.name === 'AbortError' || (pollErr.message && (pollErr.message.includes('Failed to fetch') || pollErr.message.includes('aborted'))));
                if (isFetchErr) {
                  console.debug('[JobQueueRunner] Network poll pending:', pollErr.message || pollErr);
                } else {
                  console.warn('[JobQueueRunner] Error polling status:', pollErr);
                }
                await new Promise(r => setTimeout(r, 2000));
                continue;
              }

              if (serverJob) {
                const latestForPoll = JobStore.getJob(job.id) || job;
                if (isStalePriorTurn(latestForPoll, serverJob.status, serverJob.updated_at)) {
                  console.log(`[JobQueueRunner] Ignoring stale prior-turn status (${serverJob.status}) for job ${job.id}, waiting for server...`);
                  await new Promise(r => setTimeout(r, 800));
                  continue;
                }

                let progressVal = serverJob.progress_percent || 5;
                let statusMsg = serverJob.status_message || 'Analyzing on server...';

                // F-9.5: poller writes status via apply. Do not send currentTurn.
                JobStore.apply({
                  type: 'PollerPayload',
                  id: job.id,
                  status: serverJob.status,
                  statusMessage: statusMsg,
                  progressPercent: progressVal,
                });

                if (serverJob.status === 'awaiting_user' || serverJob.status === 'succeeded' || serverJob.status === 'failed') {
                  if (serverJob.clean_result === undefined || (serverJob.clean_result && (serverJob.clean_result as any).is_r2)) {
                     // NOTE: Do NOT reuse any locally cached JobStore result here. The same
                     // jobId is reused across edit turns, so a cached result from a PRIOR
                     // turn could be mistaken for the current turn's result and silently
                     // overwrite the fresh edit with stale data. Always fetch the
                     // authoritative full result from the server for this poll cycle instead.
                     try {
                        const fullRes = await fetch(`/api/jobs/status?jobId=${job.id}&userId=${auth.currentUser?.uid || 'anonymous'}&full=true`);
                        if (fullRes.ok) {
                           const contentType = fullRes.headers.get('content-type');
                           if (contentType && contentType.includes('application/json')) {
                             const fullData = await fullRes.json();
                             serverJob = fullData.jobs?.[0] || serverJob;
                           }
                        }
                     } catch(e) {}
                  }

                  // Direct R2 fallback fetch from client if server failed/delayed transparent R2 fetching
                  if (serverJob.clean_result && (serverJob.clean_result as any).is_r2 && (serverJob.clean_result as any).r2_url) {
                     try {
                        const directRes = await fetch((serverJob.clean_result as any).r2_url);
                        if (directRes.ok) {
                           const directData = await directRes.json();
                           if (directData && !directData.is_r2) {
                              serverJob.clean_result = directData;
                           }
                        }
                     } catch (directErr) {
                        console.warn('[JobQueueRunner] Failed to fetch clean_result directly from R2 URL:', directErr);
                     }
                  }

                  // If after trying to fetch the full payload it is still a stub,
                  // DO NOT finalize the state yet. Skip this cycle and let it retry/poll again (max 5 attempts).
                  if ((serverJob.status === 'succeeded' || serverJob.status === 'awaiting_user') && serverJob.clean_result && (serverJob.clean_result as any).is_r2) {
                     r2RetryCount++;
                     if (r2RetryCount > 5) {
                        console.warn(`[JobQueueRunner] Job ${job.id} is ${serverJob.status} but full result from R2 timed out after 5 retries. Falling back to simple status message.`);
                        serverJob.clean_result = {
                           message: serverJob.status_message || 'Analysis complete',
                           text: serverJob.status_message || 'Analysis complete',
                           scoutItems: [],
                           pendingFoodLog: {
                              name: 'Meal',
                              nutrients: { calories: 0, protein: 0, carbohydrates: 0, fat: 0 }
                           }
                        };
                     } else {
                        console.warn(`[JobQueueRunner] Job ${job.id} is ${serverJob.status} but full result from R2 is not yet ready. Retrying (${r2RetryCount}/5)...`);
                        await new Promise(r => setTimeout(r, 2000));
                        continue;
                     }
                  }
                }

                if (serverJob.status === 'awaiting_user') {
                  const cleanResult = serverJob.clean_result || {};
                  const clarifyMsg =
                    cleanResult.message ||
                    serverJob.status_message ||
                    'Confirm how much you ate';

                  // Save diagnostic logs to log history page for portion clarify step
                  const reqId = serverJob.request_id || job.requestId || job.id;
                  const rawLogs = cleanResult.agentResult?.backendLogs || cleanResult.backendLogs || serverJob.status_message || '';
                  const logsList = (typeof rawLogs === 'string' && rawLogs.trim().length > 0)
                    ? rawLogs.split('\n').filter(Boolean).map(line => ({ timestamp: new Date().toISOString(), message: line }))
                    : [{ timestamp: new Date().toISOString(), message: `[portion_clarify] ${clarifyMsg}` }];
                  saveAgentRequestLog({
                    id: reqId,
                    timestamp: new Date().toISOString(),
                    summary: `Awaiting Portion Selection: ${job.inputSnapshot?.text || 'Meal Photo'}`,
                    logs: logsList
                  });

                  // B6c — short status strip while full clarify question stays in the assistant bubble
                  const portionStatusMsg = (translations[profileRef.current?.language] || translations.en).waitingForPortionChoice || 'Waiting for portion choice';
                  const latestJobState = JobStore.getJob(job.id) || job;
                  const nonLiveMsgs = (latestJobState.messages || job.messages || []).filter((m) => !m.isLive && m.id !== `msg_assistant_clarify_${job.id}`);
                    const clarifiedScoutList = (Array.isArray(cleanResult.scoutItems) && cleanResult.scoutItems.length > 0)
                      ? cleanResult.scoutItems
                      : (Array.isArray(cleanResult.portionClarify?.scoutItems) ? cleanResult.portionClarify.scoutItems : []);
                    const clarifyAssistant = {
                      id: `msg_assistant_clarify_${job.id}`,
                      role: 'assistant',
                      content: clarifyMsg,
                      timestamp: new Date().toISOString(),
                      isLive: false,
                      agentType: 'food',
                      data: {
                        needsPortionClarify: true,
                        portionClarify: cleanResult.portionClarify,
                        scoutItems: clarifiedScoutList,
                        photoUrl: serverJob.photo_url || cleanResult.photoUrl,
                        debugUrl: serverJob.debug_url || cleanResult.debugUrl,
                        agentResult: {
                          backendLogs: cleanResult.agentResult?.backendLogs || cleanResult.backendLogs || '',
                          globalLiveLogs: cleanResult.agentResult?.backendLogs || cleanResult.backendLogs || '',
                          scoutItems: clarifiedScoutList,
                          activeStage: 'portion_clarify',
                        },
                      },
                    };
                  JobStore.apply({
                    type: 'PollerPayload',
                    id: job.id,
                    status: 'awaiting_user',
                    statusMessage: portionStatusMsg,
                    progressPercent: serverJob.progress_percent || 45,
                    result: cleanResult,
                    messages: [...nonLiveMsgs, clarifyAssistant],
                    photoUrl: serverJob.photo_url || cleanResult.photoUrl,
                    debugUrl: serverJob.debug_url || cleanResult.debugUrl,
                    // Fix: without clearing this, isTurnInFlight() in jobPreview.ts stays true
                    // forever (job.finishedAt is never set for awaiting_user turns), which makes
                    // previewStatus() permanently override the card's displayed status back to
                    // 'running' even though job.status is correctly 'awaiting_user'. That froze
                    // the card on "Updating meal..." and hid the portion-select dialog.
                    inFlightTurnAt: undefined,
                  });
                  done = true;
                  return;
                }

                if (serverJob.status === 'succeeded') {
                  const cleanResult = serverJob.clean_result || {};
                  const pendingFoodLog = extractPendingFoodLogFromCleanResult(cleanResult, serverJob.photo_url);
                  const messageText =
                    cleanResult.message ||
                    cleanResult.reply ||
                    cleanResult.text ||
                    pendingFoodLog?.message ||
                    'Analysis complete.';
                  const snapAgentType = (job.inputSnapshot as any)?.agentType;
                  const isMedicalJob = job.kind === 'medical';
                  const isReviewJob = isMedicalJob && (snapAgentType === 'biomarker_review' || cleanResult.agentType === 'biomarker_review');
                  const rawCmds = cleanResult.modificationCommand || cleanResult.agentResult?.modificationCommand;
                  const reviewCmds = rawCmds
                    ? (isReviewJob
                        ? enrichReviewModificationCommands(
                            Array.isArray(rawCmds) ? rawCmds : [],
                            (job.inputSnapshot as any)?.biomarkerHistory || [],
                            collectCatalogUnitMap(profileRef.current)
                          )
                        : (Array.isArray(rawCmds) ? rawCmds : null))
                    : null;
                  const agentResult = {
                    scoutScratchpad: (cleanResult.dietScratchpad || cleanResult.dietitianScratchpad) ? undefined : cleanResult.scoutScratchpad,
                    dietScratchpad: cleanResult.dietScratchpad || cleanResult.dietitianScratchpad || '',
                    backendLogs: cleanResult.backendLogs || '',
                    globalLiveLogs: cleanResult.backendLogs || '',
                    dietAnswer: cleanResult.message || cleanResult.text || '',
                    scoutItems: cleanResult.scoutItems,
                    // Mode D boundary (App.tsx poller finalize): the whitelist
                    // used to drop `comparison`, so group cards never rendered
                    // on the server-owned polling path. Copy it through.
                    comparison: cleanResult.comparison,
                    // FIX: server.ts's medical-analyze responses (agent1_step1, agent1,
                    // biomarker_review, data_review) are flat top-level objects — they
                    // never set a nested "agentResult" key. The spread below was always
                    // a no-op for medical jobs, so extractedData (and the batch-continue
                    // fields) never reached the message, and AgentResultTable — which
                    // reads agentResult.extractedData — had nothing to render.
                    extractedData: cleanResult.extractedData,
                    hasMoreMarkers: cleanResult.hasMoreMarkers,
                    estimatedTotalMarkers: cleanResult.estimatedTotalMarkers,
                    unmappedTests: cleanResult.unmappedTests,
                    ...(cleanResult.agentResult || {}),
                    modificationCommand: reviewCmds,
                    proposal: cleanResult.proposal || cleanResult.agentResult?.proposal || null,
                    reply: cleanResult.reply || cleanResult.text || cleanResult.message,
                    // Range Calibrator (data_review) fix: AgentResultTable reads
                    // agentResult.reviewedBiomarkers directly, and the profile-update
                    // handler (agentType === 'data_review') reads it too to write
                    // calibrated ranges into customBiomarkers. Neither worked because
                    // this whitelist never copied it from cleanResult.
                    reviewedBiomarkers: cleanResult.reviewedBiomarkers || cleanResult.agentResult?.reviewedBiomarkers || undefined,
                    extremeDivergences: cleanResult.extremeDivergences || cleanResult.agentResult?.extremeDivergences || undefined,
                    // Health Coach fix: cleanResult.report is populated by serverJobs.ts
                    // for the health-baseline-analyze agent, but this object's whitelist
                    // never copied it over, so HealthBaselineCard always received an
                    // empty report even though the backend and job layers both had it.
                    report: cleanResult.report || cleanResult.agentResult?.report || undefined,
                    batchIdx: cleanResult.batchIdx !== undefined ? cleanResult.batchIdx : (cleanResult.agentResult?.batchIdx !== undefined ? cleanResult.agentResult.batchIdx : undefined),
                  };

                  const rawAgentType = snapAgentType || cleanResult.agentType || (isMedicalJob ? 'agent1' : 'food');
                  const normalizedAgentType = isMedicalJob
                    ? ((rawAgentType === 'agent1_step1' || rawAgentType === 'medical' || rawAgentType === 'medical_extract' || String(rawAgentType).startsWith('agent1_step')) ? 'agent1' : rawAgentType)
                    : 'food';

                  const latestJobState = JobStore.getJob(job.id) || job;
                  const nonLiveMsgs = (latestJobState.messages || job.messages || []).filter((m) => !m.isLive);
                  const lastNonLiveMsg = nonLiveMsgs[nonLiveMsgs.length - 1];
                  const isNewTurnResponse = lastNonLiveMsg && lastNonLiveMsg.role === 'user';
                  const hasExistingAssistantMsg = !isNewTurnResponse && nonLiveMsgs.some((m) => m.id === `msg_assistant_${job.id}`);
                  const assistantMsgId = isNewTurnResponse
                    ? `msg_assistant_${job.id}_${Date.now()}`
                    : `msg_assistant_${job.id}`;

                  const isEditRefinement = !isMedicalJob && (cleanResult.mode === 'modify' || serverJob.mode === 'modify' || job.mode === 'edit' || (latestJobState.inputSnapshot as any)?.mode === 'edit');
                  const assistantMsg = {
                    id: assistantMsgId,
                    role: 'assistant',
                    content: messageText,
                    timestamp: new Date().toISOString(),
                    isLive: false,
                    agentType: isMedicalJob ? normalizedAgentType : 'food',
                    agentTypeStep: rawAgentType,
                    modificationCommand: reviewCmds,
                    pendingFoodLog,
                    data: {
                      jobId: job.id,
                      pendingFoodLog,
                      hasImage: !!(serverJob.photo_url || pendingFoodLog?.imageUrl || (job.inputSnapshot as any)?.hasImage),
                      photoUrl: serverJob.photo_url || cleanResult.photoUrl,
                      debugUrl: serverJob.debug_url || cleanResult.debugUrl,
                      scoutItems: cleanResult.scoutItems || [],
                      mode: cleanResult.mode || serverJob.mode || (job.kind === 'food_compare' ? 'compare' : 'review'),
                      // Mode D: carry the comparison through (groups render
                      // from data.comparison; the LogChat direct path sets it,
                      // the poller path used to drop it).
                      comparison: cleanResult.comparison || (cleanResult.groups ? cleanResult : undefined),
                      agentResult,
                    },
                  };
                  let updatedMessages: any[];
                  if (shouldMergeFoodEditTurn({
                    isMedicalJob,
                    mode: latestJobState.mode || job.mode,
                    inputMode: (latestJobState.inputSnapshot as any)?.mode,
                    cleanMode: cleanResult.mode || serverJob.mode,
                    messages: nonLiveMsgs,
                  })) {
                    updatedMessages = mergeFoodEditMessages(nonLiveMsgs, assistantMsg);
                  } else if (isNewTurnResponse) {
                    updatedMessages = [...nonLiveMsgs, assistantMsg];
                  } else if (hasExistingAssistantMsg) {
                    updatedMessages = nonLiveMsgs.map((m) => (m.id === `msg_assistant_${job.id}` ? assistantMsg : m));
                  } else {
                    updatedMessages = [...nonLiveMsgs, assistantMsg];
                  }
                  JobStore.apply({
                    type: 'AnalyzeFinished',
                    id: job.id,
                    status: 'succeeded',
                    inFlightTurnAt: undefined,
                    result: {
                      ...cleanResult,
                      pendingFoodLog,
                      photoUrl: serverJob.photo_url || cleanResult.photoUrl,
                      debugUrl: serverJob.debug_url || cleanResult.debugUrl,
                      modificationCommand: reviewCmds,
                      proposal: cleanResult.proposal,
                      reply: cleanResult.reply || cleanResult.text,
                      agentType: isMedicalJob ? normalizedAgentType : cleanResult.agentType,
                      agentTypeStep: rawAgentType,
                      agentResult,
                      extractedData: cleanResult.extractedData,
                    },
                    messages: updatedMessages,
                    mealBuild: cleanResult.mealBuild || latestJobState.mealBuild || job.mealBuild,
                    progressPercent: 100,
                    statusMessage: 'Analysis complete',
                    finishedAt: new Date().toISOString(),
                  });

                  // Automatically save the edited food log back to the UI state and sync it
                  if (isEditRefinement && pendingFoodLog) {
                    console.log(`[JobQueueRunner] Auto-saving edited food log ${pendingFoodLog.id} from job ${job.id}`);
                    window.dispatchEvent(new CustomEvent('food-log-auto-update', { detail: { log: pendingFoodLog } }));
                  }

                  // Save diagnostic logs to log history page
                  const reqId = serverJob.request_id || job.requestId || job.id;
                  const summary = pendingFoodLog?.name || messageText || 'Food Analysis';
                  const rawLogs = cleanResult.backendLogs || '';
                  let logsList: { timestamp: string; message: string }[] = [];
                  if (typeof rawLogs === 'string' && rawLogs.trim().length > 0) {
                    logsList = rawLogs.split('\n').filter(Boolean).map(line => ({
                      timestamp: new Date().toISOString(),
                      message: line
                    }));
                  }
                  fetch(`/api/gemini/debug-logs?sessionId=server-job-${reqId}`)
                    .then(res => res.ok ? res.json() : null)
                    .then(data => {
                      if (data && Array.isArray(data.logs) && data.logs.length > 0) {
                        logsList = data.logs;
                      }
                      saveAgentRequestLog({
                        id: reqId,
                        timestamp: new Date().toISOString(),
                        summary,
                        logs: logsList.length > 0 ? logsList : [{ timestamp: new Date().toISOString(), message: `[food_agent] Completed analysis for ${summary}` }]
                      });
                    })
                    .catch(() => {
                      saveAgentRequestLog({
                        id: reqId,
                        timestamp: new Date().toISOString(),
                        summary,
                        logs: logsList.length > 0 ? logsList : [{ timestamp: new Date().toISOString(), message: `[food_agent] Completed analysis for ${summary}` }]
                      });
                    });

                  done = true;
                  return; // Done!
                } else if (serverJob.status === 'failed') {
                  const reqId = serverJob.request_id || job.requestId || job.id;
                  const failMsg = serverJob.status_message || 'Analysis failed on server.';
                  const cleanResult = serverJob.clean_result || {};
                  const rawLogs = cleanResult.backendLogs || failMsg;
                  const logsList = (typeof rawLogs === 'string' && rawLogs.trim().length > 0
                    ? rawLogs.split('\n').filter(Boolean).map(line => ({ timestamp: new Date().toISOString(), message: line }))
                    : [{ timestamp: new Date().toISOString(), message: `[error] ${failMsg}` }]);

                  saveAgentRequestLog({
                    id: reqId,
                    timestamp: new Date().toISOString(),
                    summary: `Failed: ${job.kind || 'Food Log'}`,
                    logs: logsList
                  });

                  // Keep a non-live assistant bubble + full logs so the run doesn't "vanish"
                  const pendingFoodLog = extractPendingFoodLogFromCleanResult(cleanResult, serverJob.photo_url);
                  const latestJobState = JobStore.getJob(job.id) || job;
                  const nonLiveMsgs = (latestJobState.messages || job.messages || []).filter((m) => !m.isLive);
                  const failAssistant = {
                    id: `msg_assistant_fail_${job.id}`,
                    role: 'assistant',
                    content: failMsg + (pendingFoodLog ? '\n\n(Partial result was preserved — open debug or retry.)' : ''),
                    timestamp: new Date().toISOString(),
                    isLive: false,
                    agentType: 'food',
                    pendingFoodLog: pendingFoodLog || undefined,
                    data: {
                      pendingFoodLog: pendingFoodLog || undefined,
                      debugUrl: serverJob.debug_url || cleanResult.debugUrl,
                      photoUrl: serverJob.photo_url || cleanResult.photoUrl,
                      scoutItems: cleanResult.scoutItems || [],
                      agentResult: {
                        backendLogs: typeof rawLogs === 'string' ? rawLogs : failMsg,
                        globalLiveLogs: typeof rawLogs === 'string' ? rawLogs : failMsg,
                      },
                    },
                  };

                  JobStore.apply({
                    type: 'AnalyzeFailed',
                    id: job.id,
                    status: 'failed',
                    statusMessage: failMsg,
                    finishedAt: new Date().toISOString(),
                    error: { class: 'transient', message: failMsg },
                    result: { ...cleanResult, pendingFoodLog, backendLogs: rawLogs },
                    messages: [...nonLiveMsgs, failAssistant],
                    debugUrl: serverJob.debug_url || cleanResult.debugUrl,
                  });
                  done = true;
                  return;
                }
              }

              await visibilityAwareSleep(2000);
            }

            if (!done) {
              // Last-chance poll: server may have succeeded after client poll window
              const reqId = job.requestId || job.id;
              let lateJob: any = null;
              try {
                const lateController = new AbortController();
                const timeoutId = setTimeout(() => lateController.abort(), 6000);
                let lateRes: Response;
                try {
                  lateRes = await fetch(`/api/jobs/status?jobId=${job.id}&userId=${auth.currentUser?.uid || 'anonymous'}&full=true`, { signal: lateController.signal });
                } finally {
                  clearTimeout(timeoutId);
                }
                if (lateRes.ok) {
                  const contentType = lateRes.headers.get('content-type');
                  if (contentType && contentType.includes('application/json')) {
                    const { jobs } = await lateRes.json();
                    lateJob = jobs && jobs[0];
                  }
                }
              } catch (_) { /* ignore */ }

              if (lateJob?.status === 'succeeded' && lateJob.clean_result) {
                const cleanResult = lateJob.clean_result || {};
                const pendingFoodLog = extractPendingFoodLogFromCleanResult(cleanResult, lateJob?.photo_url);
                const messageText = cleanResult.message || cleanResult.text || pendingFoodLog?.message || 'Analysis complete.';
                const latestJobState = JobStore.getJob(job.id) || job;
                const nonLiveMsgs = (latestJobState.messages || job.messages || []).filter((m) => !m.isLive);
                const lastNonLiveMsg = nonLiveMsgs[nonLiveMsgs.length - 1];
                const isNewTurnResponse = lastNonLiveMsg && lastNonLiveMsg.role === 'user';
                const assistantMsgId = isNewTurnResponse
                  ? `msg_assistant_${job.id}_${Date.now()}`
                  : `msg_assistant_${job.id}`;
                const assistantMsg = {
                  id: assistantMsgId,
                  role: 'assistant',
                  content: messageText,
                  timestamp: new Date().toISOString(),
                  isLive: false,
                  agentType: 'food',
                  pendingFoodLog,
                  data: {
                    pendingFoodLog,
                    photoUrl: lateJob.photo_url || cleanResult.photoUrl,
                    debugUrl: lateJob.debug_url || cleanResult.debugUrl,
                    scoutItems: cleanResult.scoutItems || [],
                    agentResult: {
                      backendLogs: cleanResult.backendLogs || '',
                      globalLiveLogs: cleanResult.backendLogs || '',
                      dietAnswer: messageText,
                    },
                  },
                };
                JobStore.apply({
                  type: 'AnalyzeFinished',
                  id: job.id,
                  status: 'succeeded',
                  result: { ...cleanResult, pendingFoodLog },
                  messages: [...nonLiveMsgs, assistantMsg],
                  mealBuild: cleanResult.mealBuild || latestJobState.mealBuild || job.mealBuild,
                  progressPercent: 100,
                  statusMessage: 'Analysis complete (recovered after poll window)',
                  finishedAt: new Date().toISOString(),
                });
                const rawLogs = cleanResult.backendLogs || '';
                const logsList = typeof rawLogs === 'string' && rawLogs.trim()
                  ? rawLogs.split('\n').filter(Boolean).map((line: string) => ({ timestamp: new Date().toISOString(), message: line }))
                  : [{ timestamp: new Date().toISOString(), message: `[food_agent] Recovered late success for ${pendingFoodLog?.name || job.id}` }];
                saveAgentRequestLog({
                  id: reqId,
                  timestamp: new Date().toISOString(),
                  summary: pendingFoodLog?.name || messageText || 'Food Analysis',
                  logs: logsList,
                });
                return;
              }

              if (lateJob?.status === 'failed' && lateJob.clean_result?.backendLogs) {
                const cleanResult = lateJob.clean_result || {};
                const failMsg = lateJob.status_message || 'Analysis failed on server.';
                const rawLogs = cleanResult.backendLogs || failMsg;
                const logsList = String(rawLogs).split('\n').filter(Boolean).map((line: string) => ({
                  timestamp: new Date().toISOString(),
                  message: line,
                }));
                saveAgentRequestLog({
                  id: reqId,
                  timestamp: new Date().toISOString(),
                  summary: `Failed: ${job.kind || 'Food Log'}`,
                  logs: logsList,
                });
                const latestJobState = JobStore.getJob(job.id) || job;
                const nonLiveMsgs = (latestJobState.messages || job.messages || []).filter((m) => !m.isLive);
                JobStore.apply({
                  type: 'AnalyzeFailed',
                  id: job.id,
                  status: 'failed',
                  statusMessage: failMsg,
                  finishedAt: new Date().toISOString(),
                  error: { class: 'transient', message: failMsg },
                  result: cleanResult,
                  messages: [
                    ...nonLiveMsgs,
                    {
                      id: `msg_assistant_fail_${job.id}`,
                      role: 'assistant',
                      content: failMsg,
                      timestamp: new Date().toISOString(),
                      isLive: false,
                      agentType: 'food',
                      data: {
                        agentResult: { backendLogs: rawLogs, globalLiveLogs: rawLogs },
                        debugUrl: lateJob.debug_url || cleanResult.debugUrl,
                      },
                    },
                  ],
                });
                return;
              }

              const timeoutMsg = 'Analysis timed out after 3 minutes. Tap Retry to try again.';
              const liveLogs =
                job.liveThoughts?.backendLogs ||
                job.liveThoughts?.globalLiveLogs ||
                '';
              saveAgentRequestLog({
                id: reqId,
                timestamp: new Date().toISOString(),
                summary: `Timed Out: ${job.kind || 'Food Log'}`,
                logs: liveLogs
                  ? String(liveLogs).split('\n').filter(Boolean).map((line: string) => ({
                      timestamp: new Date().toISOString(),
                      message: line,
                    })).concat([{ timestamp: new Date().toISOString(), message: `[error] ${timeoutMsg}` }])
                  : [{ timestamp: new Date().toISOString(), message: `[error] ${timeoutMsg}` }],
              });

              const latestTimeoutJobState = JobStore.getJob(job.id) || job;
              const nonLiveMsgsTimeout = (latestTimeoutJobState.messages || job.messages || []).filter((m) => !m.isLive);
              JobStore.apply({
                type: 'AnalyzeFailed',
                id: job.id,
                status: 'failed',
                statusMessage: timeoutMsg,
                finishedAt: new Date().toISOString(),
                error: { class: 'transient', message: timeoutMsg },
                result: {
                  backendLogs: liveLogs || timeoutMsg,
                  message: timeoutMsg,
                },
                messages: [
                  ...nonLiveMsgsTimeout,
                  {
                    id: `msg_assistant_timeout_${job.id}`,
                    role: 'assistant',
                    content: timeoutMsg,
                    timestamp: new Date().toISOString(),
                    isLive: false,
                    agentType: 'food',
                    data: {
                      jobId: job.id,
                      agentResult: {
                        backendLogs: liveLogs || timeoutMsg,
                        globalLiveLogs: liveLogs || timeoutMsg,
                      },
                    },
                  },
                ],
              });
            }
            return;
          }

        } catch (error: any) {
          lastError = error;
          if (error.message === 'AbortError') {
            throw error;
          }

          // Check if error is transient / retriable_from_checkpoint
          const isTransient = error.class === 'transient';
          const isRetriableCheckpoint = error.class === 'retriable_from_checkpoint';

          // On error with checkpoint: merge into job.checkpoint before retry
          if (error.checkpoint) {
            const currentJob = JobStore.getJob(job.id);
            JobStore.updateJob(job.id, {
              checkpoint: {
                ...(currentJob?.checkpoint || {}),
                ...error.checkpoint
              }
            });
          }

          const currentJob = JobStore.getJob(job.id);
          const hasCheckpoint = !!(currentJob?.checkpoint || error.checkpoint);
          let canRetry = isTransient || isRetriableCheckpoint;

          // If it's retriable_from_checkpoint but we have no checkpoint, we treat as transient (full retry),
          // but on subsequent attempts, if we STILL don't have a checkpoint, we should fail.
          if (isRetriableCheckpoint && !hasCheckpoint) {
            if (attempts >= 2) { // Already retried once and still no checkpoint
              canRetry = false;
            }
          }

          if (!canRetry || attempts >= maxAttempts) {
            // Permanent error or attempts exhausted - fail immediately
            console.log(`[Job] Failing job ${job.id} due to non-retryable error: ${error.message} (class=${error.class})`);
            throw error;
          }

          // Retry policy v1: immediate only, max 3 total attempts (1 + 2), transient/checkpoint only.
          console.log(`[Job] retry attempt=${attempts}/3 class=${error.class || 'transient'} jobId=${job.id}`);
          JobStore.updateJob(job.id, {
            statusMessage: ((translations[profile?.language] || translations.en).retryingAttemptNofM || 'Retrying (attempt {n}/{max})...').replace('{n}', String(attempts + 1)).replace('{max}', String(maxAttempts))
          });
        }
      }
    });

    JobQueueRunner.start();
    let stopGoldenIngest: (() => void) | null = null;
    let ingestIdleHandle: any = null;
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      ingestIdleHandle = (window as any).requestIdleCallback(() => {
        import('../utils/goldenIngestClient').then(({ startGoldenIngestWatcher }) => {
          stopGoldenIngest = startGoldenIngestWatcher();
        });
      }, { timeout: 4000 });
    } else {
      ingestIdleHandle = setTimeout(() => {
        import('../utils/goldenIngestClient').then(({ startGoldenIngestWatcher }) => {
          stopGoldenIngest = startGoldenIngestWatcher();
        });
      }, 2500);
    }

    // Subscribe to JobStore to handle automated credit refund when a job transitions to failed/cancelled
    const unsubscribeJobStore = JobStore.subscribe(async () => {
      const allJobs = JobStore.getAllJobs();
      let profileUpdated = false;
      let newProfile = profileRef.current ? { ...profileRef.current } : null;

      for (const job of allJobs) {
        if ((job.status === 'failed' || job.status === 'cancelled') && job.creditReserved && !job.creditSettled) {
          if (newProfile) {
            newProfile = refundCredits(job, newProfile);
            JobStore.updateJob(job.id, { creditSettled: true });
            profileUpdated = true;
          }
        } else if (job.status === 'succeeded' && job.creditReserved && !job.creditSettled) {
          JobStore.updateJob(job.id, { creditSettled: true });
        }
      }

      if (profileUpdated && newProfile) {
        setProfile(newProfile);
        await saveAndSyncRef.current?.(newProfile, foodLogsRef.current, biomarkersRef.current, biomarkerHistoryRef.current, actions, dailyBenefits, report, { type: 'profile' });
      }
      if (typeof window !== 'undefined') {
        (window as any).JobStore = JobStore;
      }
    });

    if (typeof window !== 'undefined') {
      (window as any).JobStore = JobStore;
      (window as any).setActiveJobId = setActiveJobId;
    }

    return () => {
      if (ingestIdleHandle != null) {
        if (typeof window !== 'undefined' && 'cancelIdleCallback' in window && typeof ingestIdleHandle === 'number') {
          (window as any).cancelIdleCallback(ingestIdleHandle);
        } else {
          clearTimeout(ingestIdleHandle);
        }
      }
      JobQueueRunner.stop();
      if (stopGoldenIngest) stopGoldenIngest();
      unsubscribeJobStore();
    };
  }, []);

  const handleOpenJob = (jobId: string) => {
    setActiveJobId(jobId);
    const job = JobStore.getJob(jobId);
    if (job && job.kind === 'medical') {
      const jobAgentType = (job.inputSnapshot as any)?.agentType || (job.result as any)?.agentType || (job.result?.report ? 'health_baseline' : null);
      if (jobAgentType && jobAgentType !== 'agent1_step1') {
        const validTypes = ['agent1','agent2','agent3','agent4','agent5','health_baseline','agent7','data_review','biomarker_review'] as const;
        const matched = validTypes.find(t => t === jobAgentType);
        if (matched) {
          setActiveAgentType(matched);
        }
      }
      if ((job.inputSnapshot as any)?.reviewBiomarkerKey) {
        setActiveReviewBiomarkerKey((job.inputSnapshot as any).reviewBiomarkerKey);
      }
      setIsMedicalChatOpen(true);
    } else if (job && job.kind === 'front_desk') {
      setActiveFrontDeskJobId(jobId);
      setIsFrontDeskOpen(true);
    }
  };

  return { activeJobId, setActiveJobId, handleOpenJob };
}
