export function shouldMergeFoodEditTurn(job: any): boolean {
  if (!job) return false;
  return job.mode === 'edit' || job.kind === 'edit' || Boolean(job.activeMeal);
}

export function mergeFoodEditMessages(existingMessages: any[] = [], incomingMessages: any[] = []): any[] {
  if (!Array.isArray(existingMessages)) existingMessages = [];
  if (!Array.isArray(incomingMessages)) incomingMessages = [];

  const map = new Map<string, any>();
  for (const m of existingMessages) {
    if (m && m.id) map.set(m.id, m);
  }
  for (const m of incomingMessages) {
    if (m && m.id) {
      const prev = map.get(m.id);
      map.set(m.id, { ...prev, ...m });
    }
  }

  const result: any[] = [];
  const addedIds = new Set<string>();
  for (const m of existingMessages) {
    if (m && m.id && map.has(m.id)) {
      result.push(map.get(m.id));
      addedIds.add(m.id);
    }
  }
  for (const m of incomingMessages) {
    if (m && m.id && !addedIds.has(m.id)) {
      result.push(map.get(m.id));
      addedIds.add(m.id);
    }
  }
  return result;
}
