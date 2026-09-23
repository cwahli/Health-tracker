import { Router } from 'express';
import { verifyFirebaseIdToken } from './server_auth.js';
import { uploadBase64ToR2, uploadDebugPayloadToR2Direct } from './server_routes_r2.js';
import { isD1Configured } from './server_d1.js';
import { d1UpsertJob, d1DeleteJob, d1ListJobs, d1GetJob, d1UpdateJob } from './server_db_d1.js';
import { d1Query } from './server_d1.js';

export const jobsRouter = Router();

/**
 * Express router for /api/jobs/* operations
 */
jobsRouter.post('/api/jobs/upsert', async (req, res) => {
  const diag4Start = Date.now();
  try {
    const authData = await verifyFirebaseIdToken(req);
    console.log('[FreeTier] requireAuth jobs-upsert');

    const { payload } = req.body;
    if (!payload || !payload.id || !payload.user_id) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const payloadSize = JSON.stringify(payload).length;
    console.log(`[DIAG4] /api/jobs/upsert starting for job ${payload.id}, payload size ${payloadSize} bytes`);

    if (isD1Configured()) {
      const d1Res = await d1UpsertJob(payload);
      console.log(`[DIAG4] /api/jobs/upsert d1UpsertJob finished for job ${payload.id} in ${Date.now() - diag4Start}ms`);
      if (!d1Res.success) {
        console.error('Failed to upsert job to D1 via server:', d1Res.error);
        return res.status(500).json({ error: d1Res.error });
      }
    }
    
    res.json({ success: true });
  } catch (err) {
    console.error(`[DIAG4] /api/jobs/upsert failed after ${Date.now() - diag4Start}ms:`, err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

jobsRouter.post('/api/jobs/delete', async (req, res) => {
  const { jobId } = req.body || {};
  if (!jobId) {
    return res.status(400).json({ error: 'jobId is required' });
  }
  // Q-6.6: diary/job delete must not prune R2 debug while a work item holds this job.
  // This route only drops the agent_jobs row — R2 keys stay. Do not add DeleteObject here.
  try {
    const auth = await verifyFirebaseIdToken(req).catch(() => null);
    if (!auth) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const { deleteInMemoryServerJob } = await import('./serverJobs.js');
    deleteInMemoryServerJob(String(jobId));
  } catch (memErr: any) {
    console.warn('[jobs/delete] in-memory delete skipped:', memErr?.message || memErr);
  }
  try {
    if (isD1Configured()) {
      await d1DeleteJob(String(jobId));
    }
  } catch (dbErr: any) {
    console.warn('[jobs/delete] db delete skipped:', dbErr?.message || dbErr);
  }
  res.json({ success: true });
});

jobsRouter.post('/api/jobs/submit', async (req, res) => {
  try {
    const { jobId, userId, kind, mode, text, history, userProfile, engine, biomarkersNeedingImprovement, remainingAllowance, activeMeal, foodLogs, userSelectedMode, activeScoutItems } = req.body;
    let { images, imageUrls } = req.body;
    if (!jobId) {
      return res.status(400).json({ error: 'jobId is required' });
    }

    if (images && Array.isArray(images) && images.length > 0) {
      imageUrls = Array.isArray(imageUrls) ? [...imageUrls] : [];
      // Parallel uploads: sequential awaits stalled submits for 30s+ on slow
      // routes (each PUT pays full latency). Order + fallback preserved.
      const uploaded = await Promise.all(images.map(async (img: any, i: number) => {
        if (typeof img === 'string' && img.startsWith('data:image/')) {
          console.log(`[POST /api/jobs/submit] Uploading image ${i} to R2 for job ${jobId}...`);
          try {
            const r2Url = await uploadBase64ToR2(jobId, img, i);
            return (r2Url && (r2Url.startsWith('http') || r2Url.startsWith('/photos/'))) ? r2Url : img;
          } catch (e) {
            console.error(`[POST /api/jobs/submit] Failed to upload image ${i} to R2`, e);
            return img;
          }
        }
        return null;
      }));
      for (const url of uploaded) {
        if (url) imageUrls.push(url);
      }
    }

    const { checkOrRegisterIdempotentSubmission, submitServerJob } = await import('./serverJobs.js');

    const idempResult = await checkOrRegisterIdempotentSubmission({
      ...req.body,
      jobId,
      userId: userId || 'anonymous',
      kind,
      mode,
      text,
      images,
      imageUrls
    });

    if (idempResult.isDuplicate) {
      return res.json({
        success: true,
        jobId: idempResult.jobId,
        status: idempResult.status || 'queued',
        duplicatePrevented: true,
        message: 'Duplicate submission blocked by idempotency lock; reusing existing job.'
      });
    }

    await submitServerJob({
      ...req.body,
      jobId,
      userId: userId || 'anonymous',
    });
    res.json({
      success: true,
      jobId,
      status: 'running',
      // B-sync: durable R2 URLs for the image(s) just uploaded above, so the client
      // can replace the stripped "Image reference preserved" placeholder in the
      // persisted chat message with a URL that resolves on other devices too.
      imageUrls: Array.isArray(imageUrls) && imageUrls.length > 0 ? imageUrls : undefined,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to submit job to cloud' });
  }
});

jobsRouter.get('/api/jobs/status', async (req, res) => {
  try {
    const { jobId, userId } = req.query;
    const { getInMemoryServerJob, listInMemoryServerJobs } = await import('./serverJobs.js');

    if (jobId) {
      let memJob = getInMemoryServerJob(String(jobId));
      if (memJob) {
        if (req.query.full === 'true' && memJob.clean_result && (memJob.clean_result as any).is_r2) {
          try {
            const { fetchJobResultFromR2 } = await import('./src/utils/r2Storage.js');
            const fullResult = await fetchJobResultFromR2(String(jobId));
            if (fullResult) {
              memJob = { ...memJob, clean_result: fullResult };
            }
          } catch (e) {
            console.error(`[JobsStatus] Failed to transparently fetch R2 clean_result for memJob ${jobId}:`, e);
          }
        }
        return res.json({ jobs: [memJob] });
      }
    }

    if (isD1Configured()) {
      try {
        const isFull = req.query.full === 'true';
        const rawLimit = req.query.limit != null ? parseInt(String(req.query.limit), 10) : 20;
        const safeLimit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 20;
        const data = await d1ListJobs({
          jobId: jobId ? String(jobId) : undefined,
          userId: userId ? String(userId) : undefined,
          isFull,
          limit: safeLimit
        });

        if (data && data.length > 0) {
          const now = Date.now();
          const staleThresholdMs = 300000;
          const processedJobs = await Promise.all(data.map(async (job: any) => {
            if (job.clean_result && typeof job.clean_result === 'object' && job.clean_result.is_r2) {
              try {
                const { fetchJobResultFromR2 } = await import('./src/utils/r2Storage.js');
                const r2Promise = fetchJobResultFromR2(job.id);
                const r2Timeout = new Promise<null>((resolve) =>
                  setTimeout(() => resolve(null), 5000)
                );
                const fullResult = await Promise.race([r2Promise, r2Timeout]);
                if (fullResult) {
                  job.clean_result = fullResult;
                }
              } catch (r2FetchErr) {
                console.error(`[JobsStatus] Failed to transparently fetch R2 clean_result for ${job.id}:`, r2FetchErr);
              }
            }

            if (job.status === 'running' && job.updated_at) {
              const updatedAtTime = new Date(job.updated_at).getTime();
              if (now - updatedAtTime > staleThresholdMs) {
                console.warn(`[JobsStatus] Auto-failing stale running job ${job.id} (updated ${Math.round((now - updatedAtTime) / 1000)}s ago)`);
                const failedJob = {
                  ...job,
                  status: 'failed',
                  status_message: 'Analysis timed out on server (>3 min). Tap Retry to try again.',
                  updated_at: new Date().toISOString()
                };
                void d1UpdateJob(job.id, {
                  status: 'failed',
                  status_message: 'Analysis timed out on server (>3 min). Tap Retry to try again.'
                });
                return failedJob;
              }
            }
            return job;
          }));

          return res.json({ jobs: processedJobs });
        } else {
          if (jobId) {
            const memJob = getInMemoryServerJob(String(jobId));
            return res.json({ jobs: memJob ? [memJob] : [] });
          }
          const memJobs = listInMemoryServerJobs(userId ? String(userId) : undefined);
          return res.json({ jobs: memJobs });
        }
      } catch (d1Err) {
        console.warn('[JobsStatus] D1 query failed or timed out, falling back to in-memory store:', d1Err);
      }
    }

    if (jobId) {
      const memJob = getInMemoryServerJob(String(jobId));
      return res.json({ jobs: memJob ? [memJob] : [] });
    }
    return res.json({ jobs: listInMemoryServerJobs(userId ? String(userId) : undefined) });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch job status' });
  }
});

jobsRouter.all('/api/jobs/debug', async (req, res) => {
  try {
    const jobId = req.body?.jobId || req.query.jobId;
    const userId = req.body?.userId || req.query.userId;
    const format = req.body?.format || req.query.format;
    const clientSessionEvents = Array.isArray(req.body?.clientSessionEvents) ? req.body.clientSessionEvents : [];
    const clientConsoleLogs = Array.isArray(req.body?.clientConsoleLogs) ? req.body.clientConsoleLogs : [];
    const networkErrors = Array.isArray(req.body?.networkErrors) ? req.body.networkErrors : [];
    const userActionBreadcrumbs = Array.isArray(req.body?.userActionBreadcrumbs) ? req.body.userActionBreadcrumbs : [];
    const lastUserAction = req.body?.lastUserAction;
    const dialogInventory = req.body?.dialogInventory;
    const dispatches = Array.isArray(req.body?.dispatches) ? req.body.dispatches : undefined;

    if (!jobId) {
      return res.status(400).json({ error: 'jobId parameter is required' });
    }

    const cleanJobId = String(jobId).trim();
    const rawJobId = cleanJobId.replace(/^(?:clarify_|timeout_)/, '');
    const { getInMemoryServerJob } = await import('./serverJobs.js');
    let job: any = getInMemoryServerJob(cleanJobId) || getInMemoryServerJob(rawJobId);

    if (!job) {
      if (isD1Configured()) {
        try {
          job = await d1GetJob(cleanJobId) || await d1GetJob(rawJobId);
        } catch (d1Err) {
          console.warn('[JobsDebug] D1 lookup error:', d1Err);
        }
      }
    }

    let debugPayload = null;
    const { fetchDebugPayloadFromR2Direct, fetchLogsFromR2Direct } = await import('./server_routes_r2.js');

    try {
      debugPayload = await fetchDebugPayloadFromR2Direct(cleanJobId, userId ? String(userId) : undefined);
    } catch (r2Err) {
      console.warn('[JobsDebug] R2 direct debug payload fetch failed:', r2Err);
    }

    if (!debugPayload && job?.debug_url) {
      try {
        const response = await fetch(job.debug_url);
        if (response.ok) {
          debugPayload = await response.json();
        }
      } catch (err) {
        console.warn('Failed to fetch from debug_url, using DB fallback:', err);
      }
    }

    if (!debugPayload) {
      if (!job) {
        if (req.body?.dialogInventory || req.body?.result || req.body?.dispatches || req.body?.clientSessionEvents) {
          debugPayload = {
            jobId: cleanJobId,
            status: req.body?.status || (cleanJobId.includes('timeout') ? 'failed' : 'unknown'),
            result: req.body?.result || {},
            pendingFoodLog: req.body?.pendingFoodLog || req.body?.result?.pendingFoodLog,
            dialogInventory: req.body?.dialogInventory,
            dispatches: req.body?.dispatches,
            backendLogs: req.body?.backendLogs || '',
            sessionEvents: req.body?.clientSessionEvents || [],
            source: 'client-payload',
          };
        } else {
          if (format === 'markdown' || format === 'md') {
            res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="debug-${cleanJobId}.md"`);
            return res.send(`# Diagnostic Log: ${cleanJobId}\n\n- **Status**: Local/Offline entry\n- **Details**: No server execution trace found in remote storage for ID \`${cleanJobId}\`.\n- **Generated At**: ${new Date().toISOString()}\n`);
          }
          return res.status(404).json({ error: 'Job or debug payload not found', jobId: cleanJobId });
        }
      } else {
        const accumulated = Array.isArray(job.accumulatedLogs) ? job.accumulatedLogs.join('\n') : (Array.isArray(job.turn1Logs) ? job.turn1Logs.join('\n') : '');
        debugPayload = {
        jobId: job.id,
        userId: job.user_id,
        kind: job.kind,
        mode: job.mode,
        status: job.status,
        photoUrl: job.photo_url,
        debugUrl: job.debug_url,
        result: job.clean_result,
        dialogInventory: job.clean_result?.dialogInventory || (job as any).dialogInventory,
        dispatches: job.clean_result?.dispatches || (job as any).dispatches,
        sessionEvents: job.clean_result?.sessionEvents || (job as any).sessionEvents,
        lastUserAction: job.clean_result?.lastUserAction || (job as any).lastUserAction,
        userActionBreadcrumbs: job.clean_result?.userActionBreadcrumbs || (job as any).userActionBreadcrumbs,
        clientConsoleLogs: job.clean_result?.clientConsoleLogs || (job as any).clientConsoleLogs,
        networkErrors: job.clean_result?.networkErrors || (job as any).networkErrors,
        conversationHistory: job.clean_result?.conversationHistory || (job as any).conversationHistory,
        backendLogsUrl: job.clean_result?.backendLogsUrl || undefined,
        backendLogs: job.clean_result?.backendLogs || accumulated || '',
        createdAt: job.created_at,
        updatedAt: job.updated_at,
        source: 'server-job'
      };
    }
  }

    if (!debugPayload.backendLogs || String(debugPayload.backendLogs).startsWith('[Logs stored in R2') || String(debugPayload.backendLogs).startsWith('http')) {
      try {
        const logsFromR2 = await fetchLogsFromR2Direct(cleanJobId);
        if (logsFromR2) {
          debugPayload.backendLogs = logsFromR2;
        }
      } catch (logFetchErr) {
        console.warn(`[JobsDebug] Failed to fetch full logs from R2 for ${cleanJobId}:`, logFetchErr);
      }
    }

    if ((!debugPayload.backendLogs || String(debugPayload.backendLogs).startsWith('[Logs stored in R2')) && job && Array.isArray(job.accumulatedLogs)) {
      debugPayload.backendLogs = job.accumulatedLogs.join('\n');
    }

    const clientProvidedLogs = typeof req.body?.backendLogs === 'string'
      ? req.body.backendLogs
      : (typeof req.body?.priorLogs === 'string' ? req.body.priorLogs : '');

    if (clientProvidedLogs) {
      if (!debugPayload.backendLogs || String(debugPayload.backendLogs).startsWith('[Logs stored in R2')) {
        debugPayload.backendLogs = clientProvidedLogs;
      } else if (!debugPayload.backendLogs.includes(clientProvidedLogs.slice(0, 80))) {
        debugPayload.backendLogs = `${clientProvidedLogs}\n\n--- SERVER EXECUTION LOGS ---\n${debugPayload.backendLogs}`;
      }
    }

    let memJobForMerge: any = null;
    try {
      const { getInMemoryServerJob: getMem } = await import('./serverJobs.js');
      memJobForMerge = getMem(cleanJobId) || getMem(rawJobId);
    } catch { /* best-effort */ }

    // Merge server session events with client session events
    const serverSessionEvents = Array.isArray(debugPayload.sessionEvents)
      ? debugPayload.sessionEvents
      : (Array.isArray(debugPayload.result?.sessionEvents) ? debugPayload.result.sessionEvents : []);
    const memJobEvents = Array.isArray(memJobForMerge?.sessionEvents)
      ? memJobForMerge.sessionEvents
      : (Array.isArray((job as any)?.sessionEvents) ? (job as any).sessionEvents : []);
    const rawMergedEvents = [...serverSessionEvents, ...memJobEvents, ...clientSessionEvents];
    const seenEventKeys = new Set<string>();
    const uniqueSessionEvents: any[] = [];
    rawMergedEvents.sort((a, b) => (new Date(a.ts || 0).getTime()) - (new Date(b.ts || 0).getTime()));
    for (const ev of rawMergedEvents) {
      const key = `${ev.ts}_${ev.writer}_${ev.action}_${ev.status}`;
      if (!seenEventKeys.has(key)) {
        seenEventKeys.add(key);
        uniqueSessionEvents.push(ev);
      }
    }

    // Merge console logs, network errors, breadcrumbs
    const serverConsoleLogs = Array.isArray(debugPayload.clientConsoleLogs)
      ? debugPayload.clientConsoleLogs
      : (Array.isArray(debugPayload.result?.clientConsoleLogs) ? debugPayload.result.clientConsoleLogs : []);
    const mergedConsoleLogs = Array.from(new Set([...serverConsoleLogs, ...clientConsoleLogs]));

    const serverNetworkErrors = Array.isArray(debugPayload.networkErrors)
      ? debugPayload.networkErrors
      : (Array.isArray(debugPayload.result?.networkErrors) ? debugPayload.result.networkErrors : []);
    const mergedNetworkErrors = Array.from(new Set([...serverNetworkErrors, ...networkErrors]));

    const serverBreadcrumbs = Array.isArray(debugPayload.userActionBreadcrumbs)
      ? debugPayload.userActionBreadcrumbs
      : (Array.isArray(debugPayload.result?.userActionBreadcrumbs) ? debugPayload.result.userActionBreadcrumbs : []);
    const mergedBreadcrumbs = [...serverBreadcrumbs, ...userActionBreadcrumbs];

    const effectiveLastUserAction = lastUserAction || debugPayload.lastUserAction || debugPayload.result?.lastUserAction;
    // Merge order: live client body first, then the in-memory job (persisted from
    // earlier POSTs — see below), then the stored payload / cold copy.
    const effectiveDialogInventory = dialogInventory
      || (memJobForMerge as any)?.dialogInventory
      || (memJobForMerge as any)?.clean_result?.dialogInventory
      || debugPayload.dialogInventory
      || debugPayload.result?.dialogInventory;
    // Dispatch completeness: a multi-turn job accumulates one dispatch per turn
    // (t1/scout, t2/scout, t2/diet). The in-memory job's own `dispatches` field
    // can be the *preserved* (turn-1-only) list, so picking it first silently
    // dropped the edit turn in the export. Prefer the longest list across every
    // source (client body, in-memory, stored result, cold payload).
    const dispatchCandidates = [
      dispatches,
      (memJobForMerge as any)?.clean_result?.dispatches,
      (memJobForMerge as any)?.dispatches,
      (job as any)?.clean_result?.dispatches,
      (job as any)?.dispatches,
      debugPayload.dispatches,
      debugPayload.result?.dispatches,
    ].filter((d): d is any[] => Array.isArray(d) && d.length > 0);
    const effectiveDispatches = dispatchCandidates.length > 0
      ? dispatchCandidates.reduce((best, cur) => (cur.length > best.length ? cur : best), dispatchCandidates[0])
      : undefined;

    // Debug-export fix: the client builds the dialog inventory at download time
    // and POSTs it here, but it was only merged into this response — a later
    // GET export (no body) saw null again. Persist it onto the in-memory job
    // and its clean_result so every subsequent export carries it.
    if (effectiveDialogInventory && typeof effectiveDialogInventory === 'object') {
      try {
        const memJob = memJobForMerge;
        if (memJob) {
          (memJob as any).dialogInventory = effectiveDialogInventory;
          const cr = (memJob as any).clean_result;
          if (cr && typeof cr === 'object') {
            (cr as any).dialogInventory = effectiveDialogInventory;
          }
        }
        const targetUserId = userId || debugPayload?.userId || (memJob as any)?.user_id;
        if (targetUserId) {
          debugPayload.dialogInventory = effectiveDialogInventory;
          void uploadDebugPayloadToR2Direct(cleanJobId, debugPayload, targetUserId).catch((e: any) =>
            console.warn('[JobsDebug] Background update of debug payload to R2 failed:', e)
          );
        }
      } catch { /* persistence is best-effort; the merged response below still carries it */ }
    }

    const { stripHeavyImages, buildDebugMarkdownReport } = await import('./src/utils/debugPayload.js');
    const { buildCanonicalRunTree } = await import('./src/utils/debugRunTree.js');
    const safePayload = stripHeavyImages(debugPayload);

    const effectivePreviousAttempts = (Array.isArray(req.body?.previousAttempts) && req.body.previousAttempts.length > 0)
      ? req.body.previousAttempts
      : ((memJobForMerge as any)?.previousAttempts
        || (memJobForMerge as any)?.clean_result?.previousAttempts
        || debugPayload.previousAttempts
        || debugPayload.result?.previousAttempts
        || []);

    const reportInput = {
      jobId: cleanJobId,
      status: safePayload.status || (job as any)?.status || 'unknown',
      mode: safePayload.mode,
      agentType: safePayload.result?.agentType || safePayload.inputSnapshot?.agentType,
      message: safePayload.result?.message || safePayload.result?.text,
      backendLogs: safePayload.backendLogs,
      pendingFoodLog: safePayload.result?.pendingFoodLog || null,
      scoutItems: safePayload.result?.scoutItems || safePayload.result?.pendingFoodLog?.dishes || safePayload.result?.dishes,
      scoutInternalReasoning: safePayload.result?.scoutInternalReasoning || safePayload.result?.scoutReasoning || safePayload.result?.internalReasoning,
      rawScout: safePayload.result?.rawScout || safePayload.result?.scoutResult,
      comparisonData: safePayload.result?.comparison || safePayload.result?.comparisonData || safePayload.result?.clean_result?.comparison || safePayload.comparisonData,
      patientContext: safePayload.result?.patientContext || safePayload.patientContext,
      scoutContentType: safePayload.result?.scoutContentType || safePayload.result?.visionScoutContentType,
      diningEnvironment: safePayload.result?.diningEnvironment || safePayload.result?.pendingFoodLog?.diningEnvironment,
      receiptTable: safePayload.result?.receiptTable || safePayload.result?.pendingFoodLog?.receiptTable,
      error: safePayload.error,
      debugUrl: safePayload.debugUrl,
      photoUrl: safePayload.photoUrl,
      // Debug-completeness fix: the stored job result carries `imageUrls` /
      // `photoUrls` (all photos uploaded for this job, including a follow-up
      // clarification photo on an edit turn). This export previously forwarded
      // only `photoUrl` (images[0]), so a create+edit run showed one photo and
      // turn 2 read as text-only. Forward the full list, falling back to the
      // message/pendingFoodLog images.
      photoUrls: (() => {
        const candidates = [
          safePayload.result?.pendingFoodLog?.imageUrls,
          safePayload.result?.photoUrls,
          safePayload.result?.imageUrls,
          safePayload.result?.clean_result?.photoUrls,
          safePayload.result?.clean_result?.imageUrls,
          (safePayload as any)?.clean_result?.photoUrls,
          (safePayload as any)?.clean_result?.imageUrls,
          (safePayload as any)?.photoUrls,
          (safePayload as any)?.imageUrls,
          safePayload.photoUrl ? [safePayload.photoUrl] : undefined,
        ];
        // Union in priority order; the first source that already holds every
        // photo wins, otherwise append the rest so no attached photo is lost.
        const seen = new Set<string>();
        const merged: string[] = [];
        for (const c of candidates) {
          if (!Array.isArray(c)) continue;
          for (const u of c) {
            const s = typeof u === 'string' ? u : '';
            if (!s || seen.has(s)) continue;
            seen.add(s);
            merged.push(s);
          }
        }
        return merged.length > 0 ? merged : undefined;
      })(),
      lastUserAction: effectiveLastUserAction,
      sessionEvents: uniqueSessionEvents,
      userActionBreadcrumbs: mergedBreadcrumbs,
      clientConsoleLogs: mergedConsoleLogs,
      networkErrors: mergedNetworkErrors,
      usdaSearchResults: safePayload.result?.usdaSearchResults,
      brandSearchResults: safePayload.result?.brandSearchResults,
      comprehensiveNutrients: safePayload.result?.comprehensiveNutrients || safePayload.result?.pendingFoodLog?.nutrients,
      stageLedger: safePayload.result?.stageLedger,
      historyLog: safePayload.result?.historyLog,
      ingestTrace: safePayload.result?.ingestTrace,
      report: safePayload.result?.report,
      conversationHistory: safePayload.conversationHistory || safePayload.result?.conversationHistory,
      handoffChain: safePayload.result?.handoffChain || safePayload.handoffChain,
      handoffPayload: safePayload.result?.handoffPayload || safePayload.handoffPayload,
      agentPayload: safePayload.inputSnapshot || safePayload.result?.inputSnapshot || safePayload.payload,
      agentInstructions: safePayload.result?.agentInstructions || safePayload.agentInstructions,
      dialogInventory: effectiveDialogInventory,
      dispatches: effectiveDispatches,
      previousAttempts: effectivePreviousAttempts,
    };

    if (format === 'markdown' || format === 'md') {
      const mdReport = buildDebugMarkdownReport(reportInput);
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="debug-${cleanJobId}.md"`);
      return res.send(mdReport);
    }

    const runTree = buildCanonicalRunTree(reportInput);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="debug-${cleanJobId}.json"`);
    return res.json(runTree);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch debug payload' });
  }
});

jobsRouter.post(['/api/jobs/prune-debug-logs', '/api/debug-logs/prune'], async (req, res) => {
  try {
    const { userId, maxRetention } = req.body || {};
    const effectiveRetention = typeof maxRetention === 'number' && maxRetention > 0 ? maxRetention : 10;
    const { pruneUserDebugLogs } = await import('./src/server/debugLogRetention.js');

    if (userId) {
      const result = await pruneUserDebugLogs(String(userId), { maxRetention: effectiveRetention });
      return res.json(result);
    }

    // If no specific userId, query distinct firebase_uids from D1.
    const foodRes = await d1Query<{ firebase_uid: string }>(`SELECT DISTINCT firebase_uid FROM food_logs`);
    const uids = Array.from(new Set((foodRes.results || []).map((f: any) => f.firebase_uid).filter(Boolean)));

    let totalPruned = 0;
    let totalKept = 0;
    let totalProtected = 0;
    const userResults: Record<string, any> = {};

    for (const uid of uids) {
      const resForUser = await pruneUserDebugLogs(uid, { maxRetention: effectiveRetention });
      totalPruned += resForUser.prunedCount;
      totalKept += resForUser.keptCount;
      totalProtected += resForUser.bugProtectedCount;
      userResults[uid] = resForUser;
    }

    return res.json({
      success: true,
      maxRetention: effectiveRetention,
      usersCount: uids.length,
      totalPruned,
      totalKept,
      totalProtected,
      userResults,
    });
  } catch (err: any) {
    console.error('[API] /api/debug-logs/prune error:', err);
    res.status(500).json({ error: err?.message || 'Failed to prune debug logs' });
  }
});

jobsRouter.get('/api/debug-logs/protected-refs', async (_req, res) => {
  try {
    // D-2 BLOCKED: the bug-tracker tables (issue_tags/issue_backlog/golden_cases)
    // have no D1 table yet. getBugTrackerProtectedRefs() returns an empty set
    // without a Supabase client, which is the correct degradation until the D1
    // schema packet lands (no 402 is emitted).
    const { getBugTrackerProtectedRefs } = await import('./src/server/debugLogRetention.js');
    const refs = await getBugTrackerProtectedRefs(null);
    return res.json({ refs: Array.from(refs) });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to get protected refs' });
  }
});

// READ-ONLY DIAGNOSTIC — inspects the per-user in-flight job lock plus in-memory and
// D1 job state for a given uid. Added to investigate a bug where jobs across
// unrelated features (e.g. biomarker "Start" and food logging) appear to queue behind
// each other and get stuck for several minutes. Defaults to the cwah uid so it can be
// hit directly from a mobile browser with no params. Does not mutate any state.
jobsRouter.get('/api/debug/job-lock-check', async (req, res) => {
  try {
    const uid = String(req.query.uid || 'hiJun2hTdDTk2igwerun2LKvwb42');

    const {
      activeUserJobLocks,
      recentSubmissionsMap,
      listInMemoryServerJobs,
    } = await import('./serverJobs.js');

    const lock = activeUserJobLocks.get(uid) || null;
    const lockAgeMs = lock ? Date.now() - lock.timestamp : null;

    const memJobs = listInMemoryServerJobs(uid).map((j: any) => ({
      id: j.id,
      kind: j.kind,
      mode: j.mode,
      status: j.status,
      status_message: j.status_message,
      progress_percent: j.progress_percent,
      updated_at: j.updated_at,
      ageMsSinceUpdate: j.updated_at ? Date.now() - new Date(j.updated_at).getTime() : null,
    }));

    const recentSubmissions: any[] = [];
    for (const [key, entry] of recentSubmissionsMap.entries()) {
      if (key.startsWith(uid + ':') || entry.jobId?.includes(uid)) {
        recentSubmissions.push({ key, ...entry, ageMsSinceSubmit: Date.now() - entry.timestamp });
      }
    }

    let dbJobs: any[] = [];
    let dbError: string | null = null;
    if (isD1Configured()) {
      try {
        dbJobs = await d1ListJobs({ userId: uid, limit: 10 });
      } catch (dErr: any) {
        dbError = dErr?.message || String(dErr);
      }
    }

    res.json({
      queriedUid: uid,
      lock: lock ? { jobId: lock.jobId, ageMs: lockAgeMs, ageSeconds: Math.round((lockAgeMs || 0) / 1000) } : null,
      inMemoryJobsForUser: memJobs,
      recentSubmissionsForUser: recentSubmissions,
      db: { rows: dbJobs, error: dbError },
      supabase: { rows: dbJobs, error: dbError },
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || String(err), stack: err?.stack });
  }
});

// AUDIT-ONLY search over food_logs (Food History source of truth).
// The meal-audit fetcher historically searched only agent_jobs
// (ORDER BY updated_at DESC LIMIT 20), so Saved/Tracked meals visible in
// FoodHistoryTab (food_logs) were invisible to the bot.
// Unauthenticated like /api/jobs/status; returns lightweight metadata only.
jobsRouter.get('/api/audit/food-search', async (req, res) => {
  try {
    if (!isD1Configured()) return res.json({ foods: [] });
    const q = String((req.query as any).q || '').trim();
    const uidParam = (req.query as any).uid != null ? String((req.query as any).uid).trim() : '';
    const rawLim = (req.query as any).limit != null ? parseInt(String((req.query as any).limit), 10) : 20;
    const limit = Number.isFinite(rawLim) ? Math.min(Math.max(rawLim, 1), 50) : 20;
    const tokens: string[] = q.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((t: string) => t.length >= 2);
    let uidFilter: string[] | null = null;
    if (uidParam) {
      const s = new Set<string>([uidParam]);
      const lc = uidParam.toLowerCase();
      const isCwah = lc.includes('cwah_liu') || lc.includes('chiwah_liu') || lc.includes('cwah.liu') || lc.includes('chiwah.liu') || uidParam === 'hiJun2hTdDTk2igwerun2LKvwb42';
      if (isCwah) {
        for (const a of ['hiJun2hTdDTk2igwerun2LKvwb42', 'cwah.liu@gmail.com', 'chiwah.liu@gmail.com', 'admin_cwah_liu_gmail_com', 'admin_chiwah_liu_gmail_com']) s.add(a);
      }
      uidFilter = Array.from(s);
    }
    const where: string[] = [];
    const params: any[] = [];
    if (uidFilter) {
      where.push('firebase_uid IN (' + uidFilter.map(() => '?').join(', ') + ')');
      params.push(...uidFilter);
    }
    for (const t of tokens) {
      where.push('lower(name) LIKE ?');
      params.push('%' + t + '%');
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const sql = 'SELECT id, firebase_uid, date, name, calories, weight_grams, quantity, debug_url, source_meal_id, image_urls, updated_at FROM food_logs ' + whereSql + ' ORDER BY updated_at DESC LIMIT ?';
    params.push(limit);
    const r = await d1Query<any>(sql, params);
    const foods = (r.results || []).map((row: any) => {
      let imageUrls: any = [];
      try { imageUrls = JSON.parse(row.image_urls || '[]'); } catch { imageUrls = []; }
      return { ...row, image_urls: Array.isArray(imageUrls) ? imageUrls.slice(0, 4) : [] };
    });
    return res.json({ foods, count: foods.length, tokens });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'food-search failed' });
  }
});
