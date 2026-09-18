export type SessionWriter =
  | 'LogChat.submit'
  | 'JobQueueRunner'
  | 'poller'
  | 'realtime'
  | 'r2'
  | 'JobStore.apply';

export type SessionAction = 'accepted' | 'ignored_stale_turn' | 'ignored_same_snapshot' | 'completed' | (string & {});

export interface SessionEvent {
  ts: number;
  writer: SessionWriter;
  turn?: number;
  status?: string;
  resultKey?: string;
  action: SessionAction;
}

const MAX = 150;
const logs = new Map<string, SessionEvent[]>();

export function recordSessionEvent(
  jobId: string,
  event: Omit<SessionEvent, 'ts'> & { ts?: number }
): SessionEvent[] {
  if (!jobId) return [];
  const existing = logs.get(jobId) || [];
  const now = event.ts ?? Date.now();
  const last = existing[existing.length - 1];
  if (
    last &&
    last.writer === event.writer &&
    last.action === event.action &&
    last.status === event.status &&
    last.resultKey === event.resultKey &&
    Math.abs(now - last.ts) < 15000
  ) {
    return existing;
  }
  const row: SessionEvent = { ts: now, ...event };
  const next = [...existing, row].slice(-MAX);
  logs.set(jobId, next);
  return next;
}

export function getSessionLog(jobId: string): SessionEvent[] {
  return logs.get(jobId) || [];
}

export function formatSessionLog(jobId: string): string {
  return getSessionLog(jobId)
    .map((e) => `${new Date(e.ts).toISOString()} ${e.writer} ${e.action} ${e.status || ''} ${e.resultKey || ''}`.trim())
    .join('\n');
}
