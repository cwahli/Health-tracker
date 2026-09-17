export type JobStatus =
  | 'queued'
  | 'running'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  | 'cancelled'
  | 'cancel_requested'
  | 'idle'
  | 'pending'
  | 'done'
  | 'awaiting_user';

export interface AgentJob {
  id: string;
  kind?: string;
  mode?: string;
  status: JobStatus;
  currentTurn?: number;
  current_turn?: number;
  clean_result?: any;
  result?: any;
  createdAt?: string;
  created_at?: string;
  updatedAt?: string;
  updated_at?: string;
  finishedAt?: string | number;
  inFlightTurnAt?: number;
  statusMessage?: string;
  progress_percent?: number;
  error?: string | null;
  text?: string;
  images?: string[];
  imageUrls?: string[];
  photoUrl?: string;
  userProfile?: any;
  activeMeal?: any;
  mealBuild?: any;
  comparison?: any;
  comparisonSet?: any;
  clientSubmitPending?: boolean;
  sessionEvents?: any[];
  debug_url?: string | null;
  [key: string]: any;
}
