/**
 * Food-chat helper: consecutive assistant bubbles are often two patches of the
 * same meal card and should be merged. Front Desk threads are the opposite —
 * receptionist reply, handoff notice, and Health Coach card are three distinct
 * assistant turns and must stay 1:1 in the same modal.
 */
export function dedupeConsecutiveAssistantMessages<T extends { role?: string; data?: any }>(
  messages: T[],
  opts?: { enabled?: boolean }
): T[] {
  if (opts?.enabled === false) return messages.slice();
  const out: T[] = [];
  for (let i = 0; i < messages.length; i++) {
    const curr = messages[i];
    const prev = out[out.length - 1];
    if (prev && prev.role === 'assistant' && curr.role === 'assistant') {
      out[out.length - 1] = {
        ...prev,
        ...curr,
        data: {
          ...(prev.data || {}),
          ...(curr.data || {}),
          agentResult: {
            ...(prev.data?.agentResult || {}),
            ...(curr.data?.agentResult || {})
          }
        }
      };
    } else {
      out.push(curr);
    }
  }
  return out;
}

export function hasPortionClarifyPayload(m: any): boolean {
  return Boolean(m?.data?.portionClarify || m?.portionClarify || m?.pendingFoodLog?.portionClarify);
}

export function isPortionClarifyAnswered(m: any): boolean {
  return Boolean(m?.portionClarifyAnswered || m?.data?.portionClarifyAnswered);
}

/** First-pass picker is in this thread; hide the post-log Adjust-portion chip. */
export function threadHasUnansweredPortionClarify(
  messages: Array<{ data?: any; pendingFoodLog?: any; portionClarify?: any; portionClarifyAnswered?: any; [key: string]: any }>
): boolean {
  if (!Array.isArray(messages)) return false;
  return messages.some((m: any) => hasPortionClarifyPayload(m) && !isPortionClarifyAnswered(m));
}

/**
 * Drop answered portion-clarify question bubbles on rebuilds. Once the user
 * has confirmed portions, the question card must not resurrect: the answer
 * lives on in the updated meal card and the debug trace, not as a second
 * stale question above the edit. Only drops a clarify bubble when a LATER
 * message already carries the meal ledger (so an unanswered question, or
 * the only card, is never removed). Locally-answered bubbles (portionClarify
 * nulled at confirm time) are unaffected — they carry no payload to match.
 */
export function dropAnsweredClarifyMessages<T extends { role?: string; data?: any; pendingFoodLog?: any; portionClarify?: any; [key: string]: any }>(
  messages: T[],
  answered: boolean,
): T[] {
  if (!answered || !Array.isArray(messages) || messages.length === 0) return messages.slice();
  const hasMealLedger = (m: any): boolean => {
    const log = m?.pendingFoodLog || m?.data?.pendingFoodLog;
    return Boolean(log && (Array.isArray(log.itemsBreakdown) ? log.itemsBreakdown.length > 0 : true));
  };
  const hasClarifyPayload = (m: any): boolean => Boolean(
    m?.role === 'assistant' && hasPortionClarifyPayload(m)
  );
  const lastLedgerIdx = messages.map((m) => hasMealLedger(m)).lastIndexOf(true);
  if (lastLedgerIdx < 0) return messages.slice();
  return messages.filter((m, idx) => !(idx < lastLedgerIdx && hasClarifyPayload(m)));
}

export function firstPortionClarifyMessageIndex(messages: Array<{ data?: any; pendingFoodLog?: any; portionClarify?: any; [key: string]: any }>): number {
  if (!Array.isArray(messages)) return -1;
  return messages.findIndex((m: any) => hasPortionClarifyPayload(m));
}

/** Rebuilds must not add a second question card when one payload already exists. */
export function shouldInjectPortionClarifyMessage(
  messages: Array<{ data?: any; pendingFoodLog?: any; portionClarify?: any; [key: string]: any }>,
  answered: boolean,
): boolean {
  if (answered) return false;
  return firstPortionClarifyMessageIndex(messages) < 0;
}

/**
 * Confirm is a state change: strip the picker payload from every bubble so a
 * job rebuild cannot resurrect a second (or the same) question card.
 */
export function retirePortionClarifyPayloads<T extends { id?: string; data?: any; pendingFoodLog?: any; portionClarify?: any; needsPortionClarify?: any }>(
  messages: T[],
  answeredLog?: any,
  inPlaceMsgId?: string,
): T[] {
  if (!Array.isArray(messages)) return [];
  return messages.map((m: any) => {
    const had = m?.data?.portionClarify || m?.portionClarify || m?.pendingFoodLog?.portionClarify || m?.data?.needsPortionClarify || m?.needsPortionClarify;
    const isTarget = !!inPlaceMsgId && m?.id === inPlaceMsgId;
    if (!had && !isTarget) return m;
    const log = (isTarget && answeredLog) ? answeredLog : (m.pendingFoodLog || m.data?.pendingFoodLog);
    const cleanedLog = log ? { ...log, portionClarify: null } : log;
    return {
      ...m,
      pendingFoodLog: cleanedLog ?? m.pendingFoodLog,
      portionClarify: null,
      needsPortionClarify: false,
      portionClarifyAnswered: true,
      data: {
        ...(m.data || {}),
        pendingFoodLog: cleanedLog ?? m.data?.pendingFoodLog,
        portionClarify: null,
        needsPortionClarify: false,
        portionClarifyAnswered: true,
      },
    };
  });
}

/** A succeeded meal card must not keep a prior "Analysis timed out" bubble. */
export function dropStaleTimeoutMessages<T extends { role?: string; content?: any; data?: any; pendingFoodLog?: any }>(
  messages: T[],
): T[] {
  if (!Array.isArray(messages) || messages.length === 0) return messages.slice();
  const hasMealLedger = (m: any): boolean => {
    const log = m?.pendingFoodLog || m?.data?.pendingFoodLog;
    return Boolean(log && (Array.isArray(log.itemsBreakdown) ? log.itemsBreakdown.length > 0 : true));
  };
  const lastLedgerIdx = messages.map((m) => hasMealLedger(m)).lastIndexOf(true);
  if (lastLedgerIdx < 0) return messages.slice();
  return messages.filter((m: any, idx: number) => {
    if (idx >= lastLedgerIdx) return true;
    if (m?.role !== 'assistant') return true;
    const content = String(m?.content || m?.data?.agentResult?.message || '');
    return !/timed out/i.test(content);
  });
}
