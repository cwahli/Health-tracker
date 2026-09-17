import { MealBuild } from '../mealBuild/types';

export type JobStatus = 'draft' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancel_requested' | 'cancelled' | 'awaiting_user' | 'processing';
export type ErrorClass = 'permanent' | 'transient' | 'retriable_from_checkpoint';
export type JobKind = 'food_log' | 'food_compare' | 'front_desk' | 'medical' | string;

export interface AgentJob {
  id: string;
  viewed?: boolean;
  kind: JobKind;
  mode?: string;
  /** Forwarded journeys: id of the job this one was handed off from (e.g. Front Desk → food). */
  parentJobId?: string | null;
  /** What the parent handoff carried (for receipt verification + debug linkage). */
  handoffSummary?: {
    fromJobId: string;
    targetAgent: string;
    intent?: string;
    keysForwarded: string[];
  } | null;
  lockedModeFamily?: string;
  status: JobStatus;
  stepIndex: number;
  stepTotal: number;
  stepKey?: string;
  progressPercent: number;
  statusMessage?: string;
  messages: any[];
  inputSnapshot: {
    text: string;
    imageRefs: string[];
    profile?: any;
    modelId?: string;
    imageDates?: any[];
    [key: string]: any;
  };
  checkpoint?: any;
  mealBuild?: MealBuild;
  resumeStage?: string;
  liveThoughts?: {
    scout?: string;
    diet?: string;
    /** Backcompat: pre-rename stored jobs carry dietitian. */
    dietitian?: string;
    backendLogs?: string;
    dbSearchLog?: string;
    activeStage?: string;
    globalLiveLogs?: string;
  };
  savedToLog?: boolean;
  clean_result?: any;
  result?: any;
  error?: {
    class: ErrorClass;
    message: string;
    scoutItems?: any[];
    scoutContentType?: string;
    portionClarify?: any;
  };
  requestId?: string;
  attemptByStep: Record<string, number>;
  attemptCount?: number;
  maxAttempts?: number;
  creditReserved?: number;
  creditSettled?: boolean;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  photoUrl?: string;
  debugUrl?: string;
  retryNotBefore?: string;
  serverSubmittedAt?: number; // ISO date string
  /** Client is already POSTing /api/jobs/submit — runner must not submit a second analyze. */
  clientSubmitPending?: boolean;
  /** Epoch ms when the current edit/analyze turn started. Preview stays in processing until a later finishedAt. */
  inFlightTurnAt?: number;
  /** Session turn. Increments on every submit. Incoming rows with a smaller turn are ignored. */
  currentTurn?: number;
  lastProgressAt?: string;
  abortController?: AbortController;
  cancelReason?: string;
  /** Session-scoped JobStore.apply/JobQueueRunner event trail for this job
   * (client-recorded). Persisted alongside job.result so it survives into
   * the server-side debug export. */
  sessionEvents?: Array<{ ts: number; writer: string; turn?: number; status?: string; resultKey?: string; action: string }>;
  backendLogs?: string;
  dispatches?: any[];
  previousAttempts?: any[];
  priorLogs?: string | string[];
}

/* 'awaiting_user' */
