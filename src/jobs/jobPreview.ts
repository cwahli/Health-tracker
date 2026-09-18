import { AgentJob, JobStatus } from './types';

export function isTurnInFlight(
  job: Pick<AgentJob, 'status' | 'inFlightTurnAt' | 'finishedAt'> & { currentTurn?: number }
): boolean {
  if (job.status === 'failed' || job.status === 'cancelled' || job.status === 'cancel_requested') {
    return false;
  }
  if (typeof job.inFlightTurnAt === 'number') {
    return !job.finishedAt || new Date(job.finishedAt).getTime() < job.inFlightTurnAt;
  }
  if (typeof job.currentTurn === 'number') {
    return job.status === 'queued' || job.status === 'running' || job.status === 'processing';
  }
  return job.status === 'queued' || job.status === 'running' || job.status === 'processing';
}

export function previewStatus(job: AgentJob): AgentJob['status'] {
  if (isTurnInFlight(job) && (job.status === 'succeeded' || job.status === 'awaiting_user')) {
    return 'running';
  }
  return job.status;
}

export function isEditJob(job: Pick<AgentJob, 'mode' | 'inputSnapshot' | 'messages'>): boolean {
  return (
    job.inputSnapshot?.mode === 'edit' ||
    job.mode === 'edit' ||
    job.mode === 'modify' ||
    !!(job.messages && job.messages.filter((m: any) => !m.isLive).length > 2)
  );
}

function isPreviewFailed(job: AgentJob, lastMsgContent?: string): boolean {
  const effectiveStatus = previewStatus(job);
  if (effectiveStatus === 'queued' || effectiveStatus === 'running' || effectiveStatus === 'processing') {
    return false;
  }
  if (effectiveStatus === 'failed' || effectiveStatus === 'cancelled' || effectiveStatus === 'cancel_requested') {
    return true;
  }
  if (effectiveStatus === 'succeeded') return false;
  return (
    !!job.error ||
    (typeof job.statusMessage === 'string' && /(?:timed out|analysis failed|server error)/i.test(job.statusMessage) && !/analysis complete/i.test(job.statusMessage)) ||
    (typeof job.result?.message === 'string' && /(?:timed out|analysis failed)/i.test(job.result.message)) ||
    (typeof job.result?.error === 'string' && !!job.result.error) ||
    (typeof lastMsgContent === 'string' && /(?:timed out|analysis failed|server error)/i.test(lastMsgContent) && !job.result?.pendingFoodLog && !job.result?.modificationCommand && !job.result?.extractedData)
  );
}

export function previewStatusLabel(
  job: AgentJob,
  opts?: { queuedAhead?: number; lastMsgContent?: string; dict?: Record<string, string> }
): string {
  const d = opts?.dict;
  const effectiveStatus = previewStatus(job);
  const edit = isEditJob(job);
  if (effectiveStatus === 'succeeded' && Array.isArray(job.result?.degradedStages) && (job.result.degradedStages.includes('diet') || job.result.degradedStages.includes('dietitian'))) {
    return d?.statusAiAdvicePending || 'AI advice pending';
  }
  if (isPreviewFailed(job, opts?.lastMsgContent)) {
    return d?.statusAnalysisFailed || d?.analysisFailed || 'Analysis failed';
  }
  const statusKey = effectiveStatus as JobStatus;
  switch (statusKey) {
    case 'queued': {
      if (edit) return d?.statusUpdatingMealQueued || 'Updating meal • Queued';
      const ahead = opts?.queuedAhead ?? 0;
      if (ahead > 0) {
        return d?.statusWaitingAhead
          ? d.statusWaitingAhead.replace('{count}', String(ahead))
          : `Waiting — ${ahead} ahead`;
      }
      return d?.statusUploadedQueued || 'Uploaded • Queued on server';
    }
    case 'running':
    case 'processing':
      if (edit) return d?.updatingMeal || 'Updating meal...';
      if (job.attemptCount && job.attemptCount > 1) {
        return (d?.retryingAttemptNofM || 'Retrying (attempt {n}/{max})...')
          .replace('{n}', String(job.attemptCount))
          .replace('{max}', String(job.maxAttempts || 3));
      }
      return d?.attemptOf
        ? d.attemptOf.replace('{current}', String(job.attemptCount || 1)).replace('{max}', String(job.maxAttempts || 3))
        : `Attempt ${job.attemptCount || 1} of ${job.maxAttempts || 3}`;
    case 'failed':
      return d?.statusAnalysisFailed || d?.analysisFailed || 'Analysis failed';
    case 'cancelled':
    case 'cancel_requested':
      return d?.statusAnalysisCancelled || 'Analysis cancelled';
    case 'awaiting_user':
      return d?.statusActionRequired || 'Action required';
    case 'succeeded':
      return d?.statusAnalysisCompleted || 'Analysis completed';
    default:
      return d?.statusProcessing || 'Processing...';
  }
}
