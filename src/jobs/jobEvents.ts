import { AgentJob } from './types';

export type JobEvent = {
  result?: any;
  status?: any;
  error?: any;
  attemptCount?: number;
  maxAttempts?: number;
  resumeStage?: string;
  progressPercent?: number;
  clientSubmitPending?: boolean;
  photoUrl?: string;
  debugUrl?: string;
  mealBuild?: any;
  inFlightTurnAt?: number;
  attemptByStep?: any;
  abortController?: any;
  startedAt?: string;
  finishedAt?: string;
  retryNotBefore?: string;
  creditReserved?: number;
  creditSettled?: boolean;
  lockedModeFamily?: AgentJob['lockedModeFamily'];
  requestId?: string;
  serverSubmittedAt?: number;
  checkpoint?: any;
  statusMessage?: string;
  messages?: any[];
} & (
  | { type: 'SubmitStarted'; id: string; mode?: string; inputSnapshot?: any; messages?: any[]; statusMessage?: string; currentTurn?: number; clientSubmitPending?: boolean }
  | { type: 'ServerStatus'; id: string; status: AgentJob['status']; statusMessage?: string; messages?: any[] }
  | { type: 'PollerPayload'; id: string; status: AgentJob['status']; result?: any; messages?: any[]; currentTurn?: number; updatedAt?: string }
  | { type: 'RealtimeRow'; id: string; status: AgentJob['status']; result?: any; currentTurn?: number; updatedAt?: string; statusMessage?: string; progressPercent?: number }
  | { type: 'AnalyzeFinished'; id: string; result?: any; messages?: any[]; currentTurn?: number }
  | { type: 'AnalyzeFailed'; id: string; error: AgentJob['error'] }
);

export function eventToPatch(event: JobEvent): Partial<AgentJob> {
  const patch: Partial<AgentJob> = {};

  if ('mode' in event && event.mode !== undefined) patch.mode = event.mode;
  if ('inputSnapshot' in event && event.inputSnapshot !== undefined) patch.inputSnapshot = event.inputSnapshot;
  if ('messages' in event && event.messages !== undefined) patch.messages = event.messages;
  if ('statusMessage' in event && event.statusMessage !== undefined) patch.statusMessage = event.statusMessage;
  // F-9.5: App.tsx poller must not pass currentTurn. Other writers (realtime/sync) may.
  if ('currentTurn' in event && event.currentTurn !== undefined) patch.currentTurn = event.currentTurn;
  if ('clientSubmitPending' in event && event.clientSubmitPending !== undefined) patch.clientSubmitPending = event.clientSubmitPending;
  if ('status' in event && event.status !== undefined) patch.status = event.status;
  if ('result' in event && event.result !== undefined) patch.result = event.result;
  if ('updatedAt' in event && event.updatedAt !== undefined) patch.updatedAt = event.updatedAt;
  if ('progressPercent' in event && event.progressPercent !== undefined) patch.progressPercent = event.progressPercent;
  if ('error' in event && event.error !== undefined) patch.error = event.error;

  if ('photoUrl' in event && event.photoUrl !== undefined) patch.photoUrl = event.photoUrl;
  if ('debugUrl' in event && event.debugUrl !== undefined) patch.debugUrl = event.debugUrl;
  if ('mealBuild' in event && event.mealBuild !== undefined) patch.mealBuild = event.mealBuild;
  if ('inFlightTurnAt' in event) patch.inFlightTurnAt = event.inFlightTurnAt as any;
  if ('attemptByStep' in event && event.attemptByStep !== undefined) patch.attemptByStep = event.attemptByStep;
  if ('abortController' in event && event.abortController !== undefined) patch.abortController = event.abortController;
  if ('startedAt' in event && event.startedAt !== undefined) patch.startedAt = event.startedAt;
  if ('finishedAt' in event) patch.finishedAt = event.finishedAt;
  if ('retryNotBefore' in event) patch.retryNotBefore = event.retryNotBefore;
  if (event.attemptCount !== undefined) patch.attemptCount = event.attemptCount;
  if (event.maxAttempts !== undefined) (patch as any).maxAttempts = event.maxAttempts;
  if ('resumeStage' in event) patch.resumeStage = event.resumeStage;
  if (event.creditReserved !== undefined) patch.creditReserved = event.creditReserved;
  if (event.creditSettled !== undefined) patch.creditSettled = event.creditSettled;
  if (event.lockedModeFamily !== undefined) patch.lockedModeFamily = event.lockedModeFamily;
  if (event.requestId !== undefined) patch.requestId = event.requestId;
  if ('serverSubmittedAt' in event) patch.serverSubmittedAt = event.serverSubmittedAt as any;
  if (event.checkpoint !== undefined) (patch as any).checkpoint = event.checkpoint;
  if ('backendLogs' in event && (event as any).backendLogs !== undefined) (patch as any).backendLogs = (event as any).backendLogs;
  if ('dispatches' in event && (event as any).dispatches !== undefined) (patch as any).dispatches = (event as any).dispatches;
  if ('previousAttempts' in event && (event as any).previousAttempts !== undefined) (patch as any).previousAttempts = (event as any).previousAttempts;

  if (event.type === 'SubmitStarted' && patch.status === undefined) {
    patch.status = 'queued';
  }
  if (event.type === 'AnalyzeFailed' && patch.status === undefined) {
    patch.status = 'failed';
  }
  if (event.type === 'AnalyzeFinished' && patch.status === undefined) {
    patch.status = 'succeeded';
  }

  return patch;
}
