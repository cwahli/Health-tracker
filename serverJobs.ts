import { uploadPhotoToR2, uploadPhotosToR2, uploadDebugPayloadToR2 } from './src/utils/r2Storage';
import { supabase, isSupabaseConfigured } from './src/utils/supabaseClient';
import { supabaseAdmin, isSupabaseConfigured as isSupabaseAdminConfigured } from './supabaseAdmin';
import { remainingQuotaCooldownMs } from './server_gemini_retry.js';
import { extractMostRecentImageDate } from './src/utils/dateUtils';

export interface ServerJobPayload {
  jobId: string;
  idempotencyKey?: string;
  userId?: string;
  kind: string;
  mode: string;
  text?: string;
  images?: string[]; // base64 or data URLs
  imageUrls?: string[];
  imageDates?: any[];
  history?: any[];
  userProfile?: any;
  engine?: string;
  biomarkersNeedingImprovement?: any[];
  remainingAllowance?: any;
  activeMeal?: any;
  foodLogs?: any[];
  userSelectedMode?: string;
  activeScoutItems?: any[];
  agentType?: string;
  biomarkerKey?: string;
  biomarkers?: { [key: string]: number | string };
  biomarkerHistory?: any[];
  dataReviewBatchKeys?: string[];
  portionChoices?: any;
  skipScout?: boolean;
  scoutContentType?: 'ambiguous' | 'branded_single' | 'whole_food' | 'recipe';
  resolvedDbCandidates?: any[];
  priorLogsUrl?: string;
  photoUrl?: string;
  requestId?: string;
  clientConsoleLogs?: string[];
  networkErrors?: string[];
  userActionBreadcrumbs?: any[];
  lastUserAction?: any;
}

export const inMemoryServerJobs = new Map<string, any>();
export const recentSubmissionsMap = new Map<string, { jobId: string; timestamp: number; status: string }>();

// Per-user in-flight lock: tracks the single job currently running/queued for a user.
// This is what actually prevents "double call" duplicate submissions. The client
// generates a fresh jobId (and a fresh client-supplied idempotencyKey, which embeds
// that jobId) on every send until the first response lands, so the content/time-bucket
// fingerprint check below never catches a rapid double-click — it only ever compares a
// key against itself. This lock is content-independent and userId-scoped instead.
export const activeUserJobLocks = new Map<string, { jobId: string; timestamp: number }>();
const USER_LOCK_MAX_AGE_MS = 5 * 60 * 1000; // safety valve: auto-clear if a job never reaches a terminal status

export function releaseUserJobLock(userId: string, jobId: string) {
  const lock = activeUserJobLocks.get(userId);
  if (lock && lock.jobId === jobId) {
    activeUserJobLocks.delete(userId);
  }
}

// Clean up old idempotency entries periodically (> 60s)
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of recentSubmissionsMap.entries()) {
      if (now - entry.timestamp > 60000) {
        recentSubmissionsMap.delete(key);
      }
    }
  }, 30000);
}

export async function checkOrRegisterIdempotentSubmission(payload: ServerJobPayload): Promise<{ isDuplicate: boolean; jobId: string; status?: string }> {
  const userId = payload.userId || 'anonymous';
  const rawText = (payload.text || '').trim().toLowerCase();
  const imgCount = (payload.images?.length || 0) + (payload.imageUrls?.length || 0);
  const modeKey = payload.userSelectedMode || payload.mode || 'review';

  const isRetry = !!(payload as any).isRetry || payload.mode === 'retry';

  // 0. In-flight lock (userId-scoped, content-independent): if this user already has an
  // active job that hasn't reached a terminal status, block ANY new jobId for them until
  // it finishes. A resubmission that reuses the SAME jobId (e.g. a portion-confirm resume)
  // is allowed through since it's a continuation, not a duplicate.
  const existingLock = activeUserJobLocks.get(userId);
  if (existingLock && existingLock.jobId !== payload.jobId && !isRetry) {
    const lockedMemJob = inMemoryServerJobs.get(existingLock.jobId);
    const lockedStatus = lockedMemJob?.status;
    const lockIsStale = (Date.now() - existingLock.timestamp) > USER_LOCK_MAX_AGE_MS;
    const lockedJobStillActive = lockedStatus === 'running' || lockedStatus === 'queued' || (!lockedMemJob && !lockIsStale);
    if (lockedJobStillActive && !lockIsStale) {
      console.log(`[ServerJobs Idempotency] Blocked duplicate submission for userId="${userId}" — job "${existingLock.jobId}" is still ${lockedStatus || 'in flight'}.`);
      return { isDuplicate: true, jobId: existingLock.jobId, status: lockedStatus || 'running' };
    }
    activeUserJobLocks.delete(userId);
  }

  // Explicit idempotencyKey or content fingerprint key (12s window)
  const key = payload.idempotencyKey || `${userId}:${rawText}:${imgCount}:${modeKey}:${Math.floor(Date.now() / 12000)}`;

  const existing = recentSubmissionsMap.get(key);
  if (existing && (Date.now() - existing.timestamp < 12000) && !isRetry) {
    const memJob = inMemoryServerJobs.get(existing.jobId);
    const currentStatus = memJob?.status || existing.status || 'queued';
    if (currentStatus === 'running' || currentStatus === 'queued') {
      console.log(`[ServerJobs Idempotency] Blocked duplicate submission key="${key}". Reusing active jobId="${existing.jobId}" (status="${currentStatus}")`);
      return { isDuplicate: true, jobId: existing.jobId, status: currentStatus };
    }
  }

  recentSubmissionsMap.set(key, {
    jobId: payload.jobId,
    timestamp: Date.now(),
    status: 'queued'
  });

  activeUserJobLocks.set(userId, { jobId: payload.jobId, timestamp: Date.now() });

  return { isDuplicate: false, jobId: payload.jobId };
}

export function getInMemoryServerJob(jobId: string) {
  return inMemoryServerJobs.get(jobId) || null;
}

export function listInMemoryServerJobs(userId?: string) {
  const jobs = Array.from(inMemoryServerJobs.values());
  if (userId) {
    return jobs.filter(j => j.user_id === userId);
  }
  return jobs;
}

export function deleteInMemoryServerJob(jobId: string) {
  inMemoryServerJobs.delete(jobId);
}

export async function recoverInterruptedServerJobs(): Promise<number> {
  console.log('[ServerJobs Worker] Checking for interrupted server jobs to recover...');
  let recoveredCount = 0;

  try {
    // 1. Check in-memory running jobs
    for (const [id, job] of inMemoryServerJobs.entries()) {
      if (job.status === 'running' || job.status === 'pending') {
        console.log(`[ServerJobs Worker] Recovering in-memory job ${id}...`);
        job.status_message = 'Resuming analysis after process restart...';
        job.updated_at = new Date().toISOString();
        recoveredCount++;
        // Re-trigger execution
        submitServerJob({
          jobId: id,
          userId: job.user_id,
          kind: job.kind,
          mode: job.mode,
          text: job.inputSnapshot?.message,
          imageUrls: job.photo_url ? [job.photo_url] : [],
        }).catch(e => console.error(`[ServerJobs Worker] Error resuming job ${id}:`, e));
      }
    }

    // 2. Check Supabase running jobs if configured
    if (isSupabaseConfigured && isSupabaseAdminConfigured) {
      const { data: stuckJobs, error } = await supabaseAdmin
        .from('agent_jobs')
        .select('id, user_id, kind, mode, status, progress_percent, status_message, photo_url, updated_at, clean_result')
        .in('status', ['running', 'pending']);

      if (error) {
        console.error('[ServerJobs Worker] Failed to query stuck jobs from Supabase:', error);
      } else if (stuckJobs && stuckJobs.length > 0) {
        for (const dbJob of stuckJobs) {
          if (!inMemoryServerJobs.has(dbJob.id)) {
            console.log(`[ServerJobs Worker] Recovering Supabase job ${dbJob.id}...`);
            inMemoryServerJobs.set(dbJob.id, {
              ...dbJob,
              status: 'running',
              status_message: 'Resuming analysis after process restart...',
              updated_at: new Date().toISOString()
            });
            recoveredCount++;

            submitServerJob({
              jobId: dbJob.id,
              userId: dbJob.user_id,
              kind: dbJob.kind,
              mode: dbJob.mode,
              text: (dbJob as any).input_snapshot?.message || dbJob.clean_result?.text || '',
              imageUrls: dbJob.photo_url ? [dbJob.photo_url] : [],
              activeMeal: dbJob.clean_result?.mealBuild || dbJob.clean_result?.pendingFoodLog
            }).catch(e => console.error(`[ServerJobs Worker] Error resuming Supabase job ${dbJob.id}:`, e));
          }
        }
      }
    }
  } catch (err) {
    console.error('[ServerJobs Worker] Recovery loop encountered error:', err);
  }

  return recoveredCount;
}

export async function submitServerJob(payload: ServerJobPayload): Promise<void> {
  const { jobId, userId = 'anonymous', kind, mode, text, images = [], imageUrls = [] } = payload;
  const dbKind = kind || 'food_log';
  const dbMode = mode || 'review';

  // Same jobId + two client POSTs (LogChat + JobQueueRunner race) used to start
  // two food-analyze streams and double every Gemini call. A new send after
  // succeeded / awaiting_user / failed is a real continuation and must proceed.
  const isRetryJob = !!(payload as any).isRetry || payload.mode === 'retry';
  const already = inMemoryServerJobs.get(jobId);
  if (already && (already.status === 'running' || already.status === 'queued') && !isRetryJob) {
    console.log(`[ServerJobs] Job ${jobId} already ${already.status} — skipping duplicate analyze.`);
    return;
  }

  let initialStatusMessage = dbKind === 'medical' ? 'Starting cloud medical analysis...' : 'Starting cloud food analysis...';
  if (payload.portionChoices && typeof payload.portionChoices === 'object' && Array.isArray(payload.activeScoutItems)) {
    const parts: string[] = [];
    Object.entries(payload.portionChoices).forEach(([key, value]) => {
      const idx = Number(key);
      const matchedItem = !isNaN(idx) ? payload.activeScoutItems[idx] : payload.activeScoutItems.find((i: any) => i.id === key || i.name === key || i.keyword === key);
      const itemName = matchedItem?.originalName || matchedItem?.name || matchedItem?.keyword || matchedItem?.description || 'Item';
      parts.push(`"${value}g portion" of ${itemName}`);
    });
    if (parts.length > 0) {
      initialStatusMessage = `Adjusting for ${parts.join(', ')}...`;
    } else {
      initialStatusMessage = 'Adjusting portion sizes...';
    }
  }

  // In-memory record for offline / Supabase-unconfigured environments
  const existingMemJob = inMemoryServerJobs.get(jobId);
  const turn1Logs: string[] = (existingMemJob?.turn1Logs && existingMemJob.turn1Logs.length > 0)
    ? existingMemJob.turn1Logs
    : ((existingMemJob?.accumulatedLogs && existingMemJob.accumulatedLogs.length > 0)
      ? existingMemJob.accumulatedLogs
      : []);

  const initialJobRecord = {
    id: jobId,
    user_id: userId,
    kind: dbKind,
    mode: dbMode,
    status: 'running',
    progress_percent: 5,
    status_message: initialStatusMessage,
    turn1Logs,
    accumulatedLogs: turn1Logs,
    photo_url: payload.photoUrl || existingMemJob?.photo_url || (imageUrls && imageUrls[0]) || null,
    updated_at: new Date().toISOString()
  };
  inMemoryServerJobs.set(jobId, initialJobRecord);

  // 1. Initial status write to Supabase (fire-and-forget: must never block the
  // /api/jobs/submit response, or a slow/unreachable Supabase call turns into
  // a platform-level 502 on the outer request instead of a clean in-app error)
  if (isSupabaseConfigured) {
    (async () => {
      try {
        const { turn1Logs, accumulatedLogs, ...dbRecord } = initialJobRecord;
        const { error } = await supabaseAdmin.from('agent_jobs').upsert(dbRecord, { onConflict: 'id' });
        if (error) {
          console.error('[ServerJobs] initial upsert failed:', error);
        }
      } catch (e: any) {
        console.error('[ServerJobs] initial upsert threw:', e);
      }
    })();
  }

  // 2. Asynchronous cloud execution (fire & forget on server process)
  setImmediate(async () => {
    let lastProgressUpdate = 0;
    const progressThrottleMs = 5000;
    let accumulatedLogs: string[] = turn1Logs.length > 0
      ? [...turn1Logs, '\n--- USER CONTINUATION (TURN 2) ---\n']
      : [];
    let photoUrl = imageUrls[0] || payload.photoUrl || existingMemJob?.photo_url || '';
    let photoUrls: string[] = imageUrls || [];
    let currentProgress = 5;
    let currentStatusMessage = 'Starting cloud food analysis...';
    let finalData: any = null;
    let persistSucceeded: ((finalPayload: any) => Promise<void>) | null = null;

    const updateSupabaseProgress = async (progress: number, message: string) => {
      currentProgress = progress;
      currentStatusMessage = message;
      const memJob = inMemoryServerJobs.get(jobId);
      if (memJob) {
        memJob.progress_percent = progress;
        memJob.status_message = message;
        memJob.photo_url = photoUrl || null;
        memJob.updated_at = new Date().toISOString();
      }
      const now = Date.now();
      if (now - lastProgressUpdate > progressThrottleMs) {
        lastProgressUpdate = now;
        if (isSupabaseConfigured) {
          try {
            await supabaseAdmin.from('agent_jobs').update({
              progress_percent: progress,
              status_message: message,
              photo_url: photoUrl || null,
              updated_at: new Date().toISOString()
            }).eq('id', jobId);
          } catch (e) {
            console.error('[ServerJobs] Failed to update progress:', e);
          }
        }
      }
    };

    try {
      // Step A: Upload ALL photos to Cloudflare R2 (was: only images[0])
      if (images.length > 0) {
        photoUrls = await uploadPhotosToR2(jobId, images);
        if (!photoUrl && photoUrls.length > 0) {
          photoUrl = photoUrls[0]; // keep legacy single-photo field populated for backward compatibility
        }
      }

      if (payload.portionChoices) {
        await updateSupabaseProgress(15, initialStatusMessage);
      } else {
        await updateSupabaseProgress(15, 'Vision Scout starting...');
      }

      // Prepare request body for loopback / in-process execution
      const port = process.env.PORT || 3000;
      const baseUrl = process.env.INTERNAL_BASE_URL || `http://127.0.0.1:${port}`;
      
      let finalMessage = text || '';
      let prebuiltIngestTrace: any = null;

      if (dbKind === 'medical' && !images && !photoUrls.length && !photoUrl && !imageUrls?.length) {
        const {
          lexTable,
          buildIngestBatch,
          shouldAbortTablePath,
          leftoverTextFromTrace,
        } = await import('./src/utils/biomarkerLifecycle.js');
        const parsedRows = lexTable(finalMessage);
        const multiColRows = parsedRows.filter(r => r.length > 1);
        if (multiColRows.length > 1) {
          const trace = buildIngestBatch(parsedRows, jobId);
          accumulatedLogs.push(`[System] Layer-1 lexer rows=${trace.totalInputRows} high=${trace.highConfidenceCount} flagged=${trace.flaggedCount} unmatched=${trace.unmatchedCount} skip=${trace.skippedCount}`);
          if (shouldAbortTablePath(trace)) {
             trace.abortedTablePath = true;
             accumulatedLogs.push('[System] Layer-1 aborted (0 high-confidence). Full text to Parser.');
          } else {
             prebuiltIngestTrace = trace;
             const leftover = leftoverTextFromTrace(trace);
             if (leftover) {
               finalMessage = leftover;
               accumulatedLogs.push(`[System] Layer-1 leftover ${trace.unmatchedCount} rows to Parser.`);
             } else {
               finalMessage = '';
             }
          }
        } else {
          accumulatedLogs.push(`[System] Layer-1 lexer did not see a multi-row table (lines=${parsedRows.length}).`);
        }
      }

      const bodyData = {
        message: finalMessage,
        images: images,
        imageUrls: photoUrls.length > 0 ? photoUrls : (photoUrl ? [photoUrl] : imageUrls),
        history: payload.history || [],
        userProfile: payload.userProfile || null,
        engine: payload.engine || 'gemini-3.5-flash-lite',
        biomarkersNeedingImprovement: payload.biomarkersNeedingImprovement || [],
        remainingAllowance: payload.remainingAllowance || null,
        activeMeal: payload.activeMeal || null,
        foodLogs: payload.foodLogs || [],
        userSelectedMode: payload.userSelectedMode || mode || 'review',
        activeScoutItems: payload.activeScoutItems || [],
        portionChoices: payload.portionChoices,
        skipScout: payload.skipScout,
        skipPortionClarify: (payload as any).skipPortionClarify,
        scoutContentType: payload.scoutContentType,
        agentType: payload.agentType,
        biomarkerKey: payload.biomarkerKey,
        biomarkers: payload.biomarkers || {},
        biomarkerHistory: payload.biomarkerHistory || [],
        dataReviewBatchKeys: payload.dataReviewBatchKeys || [],
        resolvedDbCandidates: payload.resolvedDbCandidates || [],
        imageDates: payload.imageDates || [],
        ingestTrace: prebuiltIngestTrace,
      };
      // Note: priorLogsUrl is kept in payload separately for log stitching in persistSucceeded.

      // Server background job worker invocation via loopback with AbortController timeout
      const controller = new AbortController();
      const globalTimeout = setTimeout(() => {
        controller.abort(new Error('Analysis request timed out after 180s.'));
      }, 180000);

      const engineLabel = String(payload.engine || bodyData.engine || 'gemini-3.5-flash-lite');
      let chunkTimer: NodeJS.Timeout | null = null;
      const stallMessage = `Stream stalled: Vision Scout (${engineLabel}) produced no tokens for 90s after the prompt. Gemini often hangs when free-tier quota is exhausted or the model is overloaded — not a bad photo. Switch to gemini-3.1-flash-lite.`;
      const resetChunkTimer = () => {
        if (chunkTimer) clearTimeout(chunkTimer);
        chunkTimer = setTimeout(() => {
          accumulatedLogs.push(`[error] ${stallMessage}`);
          controller.abort(new Error(stallMessage));
        }, 90000);
      };

      resetChunkTimer();

      const cooldownMs = remainingQuotaCooldownMs(engineLabel);
      if (cooldownMs > 0) {
        const sec = Math.ceil(cooldownMs / 1000);
        throw new Error(
          `Gemini free-tier quota on ${engineLabel} — cooldown ${sec}s. Switch to gemini-3.1-flash-lite (separate bucket). Not a bad photo.`
        );
      }

      let response: Response | null = null;
      if (prebuiltIngestTrace && !finalMessage && (!images || images.length === 0) && (!photoUrls || photoUrls.length === 0)) {
        accumulatedLogs.push(`[System] Intercepted table. 0 unmatched rows. Skipping LLM.`);
        
        const {
          stagedRowsToExtractedData,
          flaggedRowsToModificationCommands,
        } = await import('./src/utils/biomarkerLifecycle.js');
        const extracted = stagedRowsToExtractedData(prebuiltIngestTrace);
        const modificationCommand = flaggedRowsToModificationCommands(prebuiltIngestTrace);

        finalData = {
          extractedData: extracted,
          modificationCommand: modificationCommand.length > 0 ? modificationCommand : undefined,
          text: `I matched ${prebuiltIngestTrace.highConfidenceCount || 0} lab rows automatically${prebuiltIngestTrace.flaggedCount ? ` and flagged ${prebuiltIngestTrace.flaggedCount} for unit review` : ''}. Review the table and Apply.`,
          hasMoreMarkers: false,
          estimatedTotalMarkers: extracted.length,
          ingestTrace: prebuiltIngestTrace
        };
      } else {
        const endpoint = dbKind === 'medical' ? '/api/gemini/medical-analyze?stream=true' : '/api/gemini/food-analyze?stream=true';
        try {
        response = await fetch(`${baseUrl}${endpoint}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Session-ID': 'server-job-' + jobId
          },
          body: JSON.stringify(bodyData),
          signal: controller.signal
        });
      } catch (fetchErr: any) {
        try {
          response = await fetch(`http://localhost:${port}${endpoint}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Session-ID': 'server-job-' + jobId
            },
            body: JSON.stringify(bodyData),
            signal: controller.signal
          });
        } catch (retryErr: any) {
          if (chunkTimer) clearTimeout(chunkTimer);
          clearTimeout(globalTimeout);
          throw retryErr;
        }
      }

      if (!response.ok) {
        if (chunkTimer) clearTimeout(chunkTimer);
        clearTimeout(globalTimeout);
        throw new Error(`Local food-analyze failed with status ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        if (chunkTimer) clearTimeout(chunkTimer);
        clearTimeout(globalTimeout);
        throw new Error('Response body stream is not readable');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      finalData = null;

      try {
        while (true) {
          const { done, value } = await reader.read();
          resetChunkTimer();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;

            const rawData = trimmed.slice(6);
            if (!rawData) continue;

            try {
              const parsed = JSON.parse(rawData);
              if (parsed.error) {
                const errMsg = typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.error);
                accumulatedLogs.push(`[error] ${errMsg}`);
                throw new Error(errMsg);
              }
              if (parsed.type === 'log') {
                accumulatedLogs.push(`[${parsed.logType || 'info'}] ${parsed.message}`);
                
                if (parsed.logType === 'status') {
                  let prog = currentProgress;
                  const msg = parsed.message || '';
                  if (msg.toLowerCase().includes('scout')) {
                    prog = Math.max(prog, 30);
                  } else if (msg.toLowerCase().includes('database') || msg.toLowerCase().includes('usda') || msg.toLowerCase().includes('search')) {
                    prog = Math.max(prog, 50);
                  } else if (msg.toLowerCase().includes('dietitian') || msg.toLowerCase().includes('nutritionist')) {
                    prog = Math.max(prog, 70);
                  } else if (msg.toLowerCase().includes('final')) {
                    prog = Math.max(prog, 90);
                  }
                  await updateSupabaseProgress(prog, msg);
                }
              } else if ((parsed.final === true || parsed.type === 'done') && parsed.result) {
                finalData = parsed.result;
              }
            } catch (err: any) {
              if (err.message && !err.message.includes('JSON')) {
                throw err;
              }
              // ignore JSON parse error on incomplete chunks
            }
          }
        }

        if (buffer && buffer.trim()) {
          const remainingLines = buffer.split('\n');
          for (const line of remainingLines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('data: ')) {
              const rawData = trimmed.slice(6);
              if (rawData) {
                try {
                  const parsed = JSON.parse(rawData);
                  if ((parsed.final === true || parsed.type === 'done') && parsed.result) {
                    finalData = parsed.result;
                  }
                } catch {}
              }
            }
          }
        }
      } finally {
        if (chunkTimer) clearTimeout(chunkTimer);
        clearTimeout(globalTimeout);
      }
      } // CLOSE ELSE BLOCK

      if (!finalData) {
        const lastErr = [...accumulatedLogs].reverse().find(l => l.startsWith('[error]'));
        if (lastErr) {
          throw new Error(lastErr.replace(/^\[error\]\s*/, ''));
        }
        throw new Error('Stream finished but no final result data was received');
      }

      if (prebuiltIngestTrace && (dbKind === 'medical' || kind === 'medical')) {
        const { mergeStagedExtract } = await import('./src/utils/biomarkerLifecycle.js');
        finalData = mergeStagedExtract(finalData, prebuiltIngestTrace);
      }

      if (finalData.needsPortionClarify) {
        let logsUrl = '';
        try {
          const { uploadLogsToR2 } = await import('./src/utils/r2Storage');
          logsUrl = await uploadLogsToR2(jobId, accumulatedLogs.join('\n'));
        } catch (r2LogErr) {
          console.warn('[ServerJobs] Failed uploading portion clarify logs to R2:', r2LogErr);
        }

        finalData.backendLogsUrl = logsUrl || undefined;
        finalData.backendLogs = logsUrl ? `[Logs stored in R2: ${logsUrl}]` : accumulatedLogs.join('\n').slice(0, 5000);
        if (finalData.agentResult) {
          finalData.agentResult.backendLogsUrl = logsUrl || undefined;
          finalData.agentResult.backendLogs = finalData.backendLogs;
        }

        const memJob = inMemoryServerJobs.get(jobId);
        if (memJob) {
          memJob.status = 'awaiting_user';
          memJob.status_message = finalData.message || 'Please clarify portion sizes.';
          memJob.clean_result = finalData;
          memJob.turn1Logs = [...accumulatedLogs];
          memJob.accumulatedLogs = [...accumulatedLogs];
          memJob.photo_url = photoUrl || memJob.photo_url;
          memJob.updated_at = new Date().toISOString();
        }
        // Not actively in flight while paused for user input — release the lock so the
        // user isn't blocked from starting something else while this awaits their reply.
        releaseUserJobLock(userId, jobId);
        if (isSupabaseConfigured) {
          let lightweightFinalData = { ...finalData };
          try {
            const { uploadJobResultToR2 } = await import('./src/utils/r2Storage');
            const publicUrl = await uploadJobResultToR2(jobId, finalData);
            if (publicUrl) {
              lightweightFinalData = {
                is_r2: true,
                r2_url: publicUrl,
                backendLogsUrl: logsUrl || undefined,
                mode: finalData.mode || 'review',
                text: finalData.text || '',
                message: finalData.message || 'Please clarify portion sizes.',
                needsPortionClarify: true,
                portionClarify: finalData.portionClarify,
                scoutItems: finalData.scoutItems,
                agentResult: {
                  scoutItems: finalData.scoutItems,
                  activeStage: 'portion_clarify',
                },
              };
            }
          } catch (r2Err) {
            console.error('[ServerJobs] R2 save for portion clarify failed:', r2Err);
          }

          await supabaseAdmin.from('agent_jobs').update({
            status: 'awaiting_user',
            status_message: finalData.message || 'Please clarify portion sizes.',
            clean_result: lightweightFinalData, // contains lightweight R2 reference
            updated_at: new Date().toISOString()
          }).eq('id', jobId);
        }
        return;
      }

      // Helper to write successful outcome to Supabase
      persistSucceeded = async (finalPayload: any) => {
        const foodLog = finalPayload?.pendingFoodLog || finalPayload?.data || null;
        const pendingFoodLog = foodLog || (finalPayload?.name && finalPayload?.nutrients ? finalPayload : null);
        if (pendingFoodLog && typeof pendingFoodLog === 'object') {
          // Task 4 fix: verdict/message/description are top-level siblings on
          // finalPayload (from the dietitian LLM schema), not nested inside
          // pendingFoodLog/foodData. Without this they never reach the saved
          // FoodLog even though FoodHistoryTab already renders them.
          if (!pendingFoodLog.verdict && finalPayload?.verdict) {
            pendingFoodLog.verdict = finalPayload.verdict;
          }
          if (!pendingFoodLog.message && (finalPayload?.message || finalPayload?.text)) {
            pendingFoodLog.message = finalPayload.message || finalPayload.text;
          }
          if (!pendingFoodLog.description && finalPayload?.data?.description) {
            pendingFoodLog.description = finalPayload.data.description;
          }
          if (!pendingFoodLog.recommendation && finalPayload?.verdict?.level) {
            pendingFoodLog.recommendation = finalPayload.verdict.level;
          }
          if (!pendingFoodLog.date || pendingFoodLog.date === 'undefined' || String(pendingFoodLog.date).trim() === '') {
            const mostRecentDate = extractMostRecentImageDate(payload.imageDates || (finalPayload as any)?.imageDates);
            pendingFoodLog.date = mostRecentDate || new Date().toISOString().split('T')[0];
          }
          // Replace base64 strings with public R2 URL or remove them
          if (pendingFoodLog.imageUrl && String(pendingFoodLog.imageUrl).startsWith('data:')) {
            pendingFoodLog.imageUrl = photoUrl || '';
          }
          if (Array.isArray(pendingFoodLog.imageUrls)) {
            pendingFoodLog.imageUrls = pendingFoodLog.imageUrls.map((url: any, idx: number) => 
              String(url).startsWith('data:') ? (photoUrls[idx] || photoUrl || '') : url
            ).filter(Boolean);
          } else {
            pendingFoodLog.imageUrls = photoUrls.length > 0 ? photoUrls : (photoUrl ? [photoUrl] : []);
          }
          delete pendingFoodLog.imageBase64;
          delete pendingFoodLog.images;
        }

        let logsUrl = '';
        const rawLogsText = accumulatedLogs.join('\n');
        try {
          const { uploadLogsToR2 } = await import('./src/utils/r2Storage');
          logsUrl = await uploadLogsToR2(jobId, rawLogsText);
        } catch (r2LogErr) {
          console.warn('[ServerJobs] Failed uploading execution logs to R2:', r2LogErr);
        }

        // Task 7: Stitch turn-1 logs header so the full two-turn trace is visible in the log viewer.
        const priorLogsUrl: string = (payload as any).priorLogsUrl || '';
        const priorLogsNote = priorLogsUrl
          ? `[Turn 1 Scout + DB logs: ${priorLogsUrl}]\n--- TURN 2 (Portion Confirm) ---\n`
          : '';

        const cleanResult: any = {
          pendingFoodLog: pendingFoodLog,
          message: finalPayload?.message || finalPayload?.text || '',
          text: finalPayload?.text || finalPayload?.message || '',
          dietitianScratchpad: finalPayload?.dietitianScratchpad || '',
          mode: finalPayload?.mode || mode || 'review',
          comparison: finalPayload?.comparison || undefined,
          comparisonSet: finalPayload?.comparisonSet || undefined,
          scoutItems: finalPayload?.scoutItems || undefined,
          scoutContentType: finalPayload?.scoutContentType || undefined,
          photoUrl: photoUrl || undefined,
          debugUrl: undefined as string | undefined,
          backendLogsUrl: logsUrl || undefined,
          backendLogs: logsUrl ? `[Logs stored in R2: ${logsUrl}]` : priorLogsNote + rawLogsText.slice(0, 5000),
          mealBuild: finalPayload?.mealBuild,
          degradedStages: finalPayload?.degradedStages,
          lastUserAction: payload.lastUserAction || (text ? { action: 'chat_submit', prompt: text, timestamp: new Date().toISOString() } : undefined),
          modificationCommand: finalPayload?.modificationCommand || finalPayload?.agentResult?.modificationCommand || undefined,
          proposal: finalPayload?.proposal || finalPayload?.agentResult?.proposal || undefined,
          reply: finalPayload?.reply || finalPayload?.text || finalPayload?.agentResult?.reply || undefined,
          targetBiomarkerKey: finalPayload?.targetBiomarkerKey || finalPayload?.biomarkerKey || finalPayload?.agentResult?.targetBiomarkerKey || undefined,
          networkErrors: payload.networkErrors || [],
          userActionBreadcrumbs: payload.userActionBreadcrumbs || [],
          // M-FIX1: Medical/biomarker agents (agent1_step1 and friends) return these
          // fields directly on finalPayload. They were previously dropped here because
          // this cleanResult builder was written only for the food-log shape. Carrying
          // them through — both top-level and nested under agentResult — lets the
          // client's existing agentResult spread (src/App.tsx, succeeded-status handler)
          // pick them up without any client-side changes.
          agentType: finalPayload?.agentType || undefined,
          extractedData: finalPayload?.extractedData || undefined,
          hasMoreMarkers: finalPayload?.hasMoreMarkers || undefined,
          estimatedTotalMarkers: finalPayload?.estimatedTotalMarkers ?? undefined,
          unmappedTests: finalPayload?.unmappedTests || undefined,
          currentBatch: finalPayload?.currentBatch || undefined,
          ingestTrace: finalPayload?.ingestTrace || prebuiltIngestTrace || (dbKind === 'medical' || kind === 'medical' || finalPayload?.agentType ? {
            version: 1,
            jobId,
            sourceKind: 'prose',
            totalInputRows: Array.isArray(finalPayload?.extractedData) ? finalPayload.extractedData.length : (finalPayload?.isWrongDoor ? 1 : 0),
            highConfidenceCount: 0,
            flaggedCount: 0,
            unmatchedCount: Array.isArray(finalPayload?.extractedData) && !finalPayload?.isWrongDoor ? finalPayload.extractedData.length : 0,
            skippedCount: finalPayload?.isWrongDoor ? 1 : 0,
            rows: finalPayload?.isWrongDoor ? [{
              sourceRowIndex: 0,
              bucket: 'skip' as const,
              class: 'WRONG_DOOR' as const,
              comment: 'Detected food or non-medical input'
            }] : (Array.isArray(finalPayload?.extractedData) ? finalPayload.extractedData.map((item: any, idx: number) => ({
              sourceRowIndex: idx,
              printedName: item?.name || item?.biomarker || item?.keyName || '',
              rawValue: item?.value ?? item?.numeric_value ?? null,
              rawUnit: item?.unit || '',
              canonicalKey: item?.biomarker || undefined,
              bucket: 'unmatched' as const,
              class: 'COMPLETENESS' as const,
            })) : []),
            handoff: {
              dualRawInjection: false,
              sentToParserCount: Array.isArray(finalPayload?.extractedData) ? finalPayload.extractedData.length : 0,
              sentToReviewCount: 0,
            },
            createdAt: new Date().toISOString()
          } : undefined),
          agentResult: {
            extractedData: finalPayload?.extractedData || undefined,
            hasMoreMarkers: finalPayload?.hasMoreMarkers || undefined,
            estimatedTotalMarkers: finalPayload?.estimatedTotalMarkers ?? undefined,
            unmappedTests: finalPayload?.unmappedTests || undefined,
            currentBatch: finalPayload?.currentBatch || undefined,
            ingestTrace: finalPayload?.ingestTrace || prebuiltIngestTrace || (dbKind === 'medical' || kind === 'medical' || finalPayload?.agentType ? {
              version: 1,
              jobId,
              sourceKind: 'prose',
              totalInputRows: Array.isArray(finalPayload?.extractedData) ? finalPayload.extractedData.length : (finalPayload?.isWrongDoor ? 1 : 0),
              highConfidenceCount: 0,
              flaggedCount: 0,
              unmatchedCount: Array.isArray(finalPayload?.extractedData) && !finalPayload?.isWrongDoor ? finalPayload.extractedData.length : 0,
              skippedCount: finalPayload?.isWrongDoor ? 1 : 0,
              rows: finalPayload?.isWrongDoor ? [{
                sourceRowIndex: 0,
                bucket: 'skip' as const,
                class: 'WRONG_DOOR' as const,
                comment: 'Detected food or non-medical input'
              }] : (Array.isArray(finalPayload?.extractedData) ? finalPayload.extractedData.map((item: any, idx: number) => ({
                sourceRowIndex: idx,
                printedName: item?.name || item?.biomarker || item?.keyName || '',
                rawValue: item?.value ?? item?.numeric_value ?? null,
                rawUnit: item?.unit || '',
                canonicalKey: item?.biomarker || undefined,
                bucket: 'unmatched' as const,
                class: 'COMPLETENESS' as const,
              })) : []),
              handoff: {
                dualRawInjection: false,
                sentToParserCount: Array.isArray(finalPayload?.extractedData) ? finalPayload.extractedData.length : 0,
                sentToReviewCount: 0,
              },
              createdAt: new Date().toISOString()
            } : undefined),
            modificationCommand: finalPayload?.modificationCommand || finalPayload?.agentResult?.modificationCommand || undefined,
            proposal: finalPayload?.proposal || finalPayload?.agentResult?.proposal || undefined,
            reply: finalPayload?.reply || finalPayload?.text || finalPayload?.agentResult?.reply || undefined,
            targetBiomarkerKey: finalPayload?.targetBiomarkerKey || finalPayload?.biomarkerKey || finalPayload?.agentResult?.targetBiomarkerKey || undefined,
          },
        };

        try {
          const debugUrl = await uploadDebugPayloadToR2(jobId, {
            jobId,
            userId,
            kind,
            mode,
            text,
            photoUrl,
            result: cleanResult,
            backendLogsUrl: logsUrl || undefined,
            backendLogs: rawLogsText,
            completedAt: new Date().toISOString(),
            lastUserAction: cleanResult.lastUserAction,
            clientConsoleLogs: payload.clientConsoleLogs,
            networkErrors: payload.networkErrors,
            userActionBreadcrumbs: payload.userActionBreadcrumbs
          });
          if (debugUrl) {
            cleanResult.debugUrl = debugUrl;
            if (pendingFoodLog) {
              pendingFoodLog.debugUrl = debugUrl;
            }
          }
        } catch (r2Err) {
          console.warn('[ServerJobs] R2 debug upload failed (non-fatal):', r2Err);
        }

        const memJob = inMemoryServerJobs.get(jobId);
        if (memJob) {
          memJob.status = 'succeeded';
          memJob.progress_percent = 100;
          memJob.status_message = 'Analysis complete';
          memJob.photo_url = photoUrl || null;
          memJob.debug_url = cleanResult.debugUrl || null;
          memJob.clean_result = cleanResult;
          // Persist this turn's accumulated debug logs so a follow-up message on the same
          // jobId (e.g. a text correction) carries the full history forward instead of
          // starting from scratch. Previously this was only ever done on the
          // awaiting_user path, so any job that succeeded on its first turn silently lost
          // its logs the moment a second turn began.
          memJob.turn1Logs = [...accumulatedLogs];
          memJob.accumulatedLogs = [...accumulatedLogs];
          memJob.updated_at = new Date().toISOString();
        }
        releaseUserJobLock(userId, jobId);

        if (isSupabaseConfigured) {
          let lightweightResult = { ...cleanResult };
          try {
            const { uploadJobResultToR2 } = await import('./src/utils/r2Storage');
            const publicUrl = await uploadJobResultToR2(jobId, cleanResult);
            if (publicUrl) {
              lightweightResult = {
                is_r2: true,
                r2_url: publicUrl,
                backendLogsUrl: logsUrl || undefined,
                mode: cleanResult.mode || 'review',
                text: cleanResult.text || '',
                message: cleanResult.message || 'Analysis complete',
              };
            }
          } catch (r2Err) {
            console.error('[ServerJobs] R2 save for success failed:', r2Err);
          }

          await supabaseAdmin.from('agent_jobs').update({
            status: 'succeeded',
            progress_percent: 100,
            status_message: 'Analysis complete',
            photo_url: photoUrl || null,
            debug_url: cleanResult.debugUrl || null,
            clean_result: lightweightResult, // lightweight R2 reference in DB!
            updated_at: new Date().toISOString(),
          }).eq('id', jobId);
        }
      };

      if (persistSucceeded) {
        await persistSucceeded(finalData);
      }

    } catch (err: any) {
      console.error(`[ServerJobs] Job ${jobId} failed:`, err);
      const abortReason =
        err?.name === 'AbortError'
          ? String(err?.cause?.message || err?.message || 'Stream aborted')
          : err?.message || String(err);
      if (!accumulatedLogs.some((l) => l.includes(String(abortReason)))) {
        accumulatedLogs.push(`[error] Job execution failed: ${abortReason}`);
      }

      if (finalData && !finalData.error && !/timed out|failed|error/i.test(finalData.message || '')) {
        try {
          accumulatedLogs.push('[ServerJobs] Recovering: final result was present despite later error — marking succeeded.');
          if (persistSucceeded) {
            await persistSucceeded(finalData);
          }
          return;
        } catch (recoverErr: any) {
          console.error('[ServerJobs] Recover-as-success failed:', recoverErr);
        }
      }

      let logsUrl = '';
      const rawErrorLogs = accumulatedLogs.join('\n');
      try {
        const { uploadLogsToR2 } = await import('./src/utils/r2Storage');
        logsUrl = await uploadLogsToR2(jobId, rawErrorLogs);
      } catch (r2LogErr) {
        console.warn('[ServerJobs] Failed uploading error logs to R2:', r2LogErr);
      }

      const errorCleanResult: any = {
        message: abortReason || 'Server analysis failed or timed out',
        error: abortReason || 'Unknown error',
        backendLogsUrl: logsUrl || undefined,
        backendLogs: logsUrl ? `[Logs stored in R2: ${logsUrl}]` : rawErrorLogs.slice(0, 5000),
        photoUrl: photoUrl || undefined,
        scoutItems: finalData?.scoutItems,
      };
      if (finalData?.pendingFoodLog || finalData?.data) {
        errorCleanResult.pendingFoodLog = finalData.pendingFoodLog || finalData.data;
      }
      try {
        const debugUrl = await uploadDebugPayloadToR2(jobId, {
          jobId,
          userId,
          kind,
          mode,
          text,
          photoUrl,
          result: errorCleanResult,
          backendLogsUrl: logsUrl || undefined,
          backendLogs: rawErrorLogs,
          failedAt: new Date().toISOString(),
        });
        if (debugUrl) errorCleanResult.debugUrl = debugUrl;
      } catch (r2Fail) {
        console.warn('[ServerJobs] R2 debug upload on fail (non-fatal):', r2Fail);
      }

      const memJob = inMemoryServerJobs.get(jobId);
      if (memJob) {
        memJob.status = 'failed';
        memJob.status_message = abortReason || 'Server analysis failed';
        memJob.photo_url = photoUrl || null;
        memJob.clean_result = errorCleanResult;
        // Persist accumulated debug logs on failure too, so a retry/continuation on the
        // same jobId doesn't lose this turn's history (mirrors the succeeded-path fix).
        memJob.turn1Logs = [...accumulatedLogs];
        memJob.accumulatedLogs = [...accumulatedLogs];
        memJob.updated_at = new Date().toISOString();
      }
      releaseUserJobLock(userId, jobId);

      if (isSupabaseConfigured) {
        try {
          await supabaseAdmin.from('agent_jobs').update({
            status: 'failed',
            status_message: abortReason || 'Server analysis failed',
            photo_url: photoUrl || null,
            debug_url: errorCleanResult.debugUrl || null,
            clean_result: errorCleanResult,
            updated_at: new Date().toISOString(),
          }).eq('id', jobId);
        } catch (uErr) {
          console.error('[ServerJobs] Failed to update error state in Supabase:', uErr);
        }
      }
    }
  });
}
