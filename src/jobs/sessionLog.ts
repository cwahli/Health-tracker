const sessionLogsMap = new Map<string, any[]>();

export function getSessionLog(jobId: string): any[] {
  return sessionLogsMap.get(jobId) || [];
}

export function appendSessionLog(jobId: string, log: any): void {
  const list = sessionLogsMap.get(jobId) || [];
  list.push(log);
  sessionLogsMap.set(jobId, list);
}

export function setSessionLog(jobId: string, logs: any[]): void {
  sessionLogsMap.set(jobId, logs);
}

export function clearSessionLogs(): void {
  sessionLogsMap.clear();
}
