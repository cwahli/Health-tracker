/**
 * Merge an edit-turn assistant result into the existing meal card, in place.
 * Appending a second assistant message with pendingFoodLog is what produced
 * two identical "Sweet Iced Tea / 660 kcal" cards after "the tea is unsweetened".
 * Appending the old text under the new ("--- Update:") is the same bug in one
 * bubble: the card renders the fresh ledger message on top plus the stale
 * pre-edit narrative below. Edits therefore REPLACE the card content with the
 * latest message; history stays in job dispatches / debug export, not the bubble.
 */
export function mergeFoodEditMessages(nonLiveMsgs: any[], assistantMsg: any): any[] {
  if (!Array.isArray(nonLiveMsgs) || nonLiveMsgs.length === 0) {
    return assistantMsg ? [assistantMsg] : [];
  }

  let priorIdx = -1;
  for (let i = nonLiveMsgs.length - 1; i >= 0; i--) {
    const m = nonLiveMsgs[i];
    if (m && m.role === 'assistant' && (m.data?.pendingFoodLog || m.pendingFoodLog)) {
      priorIdx = i;
      break;
    }
  }

  if (priorIdx < 0) {
    return [...nonLiveMsgs, assistantMsg];
  }

  const priorMsg = nonLiveMsgs[priorIdx];
  const pendingFoodLog = assistantMsg?.pendingFoodLog || assistantMsg?.data?.pendingFoodLog;
  const messageText = assistantMsg?.content;

  // In-place update: the card shows the latest turn only. Never append the
  // stale pre-edit narrative below the fresh message (that duplication is
  // what "--- Update:" produced on portion edits: post-edit advice on top,
  // pre-edit 855 kcal advice below, same table twice via desc + content).
  const mergedContent = messageText || priorMsg.content || '';

  const mergedMsg = {
    ...priorMsg,
    content: mergedContent,
    data: {
      ...priorMsg.data,
      ...(assistantMsg?.data || {}),
      mode: assistantMsg?.data?.mode || priorMsg.data?.mode || 'modify',
      scoutItems:
        (assistantMsg?.data?.scoutItems && assistantMsg.data.scoutItems.length > 0)
          ? assistantMsg.data.scoutItems
          : priorMsg.data?.scoutItems,
      pendingFoodLog: {
        ...(priorMsg.data?.pendingFoodLog || priorMsg.pendingFoodLog || {}),
        ...(pendingFoodLog || {}),
        message: messageText || pendingFoodLog?.message || priorMsg.data?.pendingFoodLog?.message || '',
        imageUrls:
          (pendingFoodLog?.imageUrls && pendingFoodLog.imageUrls.length > 0)
            ? pendingFoodLog.imageUrls
            : (priorMsg.data?.pendingFoodLog?.imageUrls || priorMsg.pendingFoodLog?.imageUrls || []),
        imageUrl:
          pendingFoodLog?.imageUrl ||
          priorMsg.data?.pendingFoodLog?.imageUrl ||
          priorMsg.pendingFoodLog?.imageUrl ||
          undefined,
      },
      agentResult: assistantMsg?.data?.agentResult || priorMsg.data?.agentResult,
    },
    pendingFoodLog: {
      ...(priorMsg.pendingFoodLog || {}),
      ...(pendingFoodLog || {}),
    },
  };

  return [
    ...nonLiveMsgs.slice(0, priorIdx),
    mergedMsg,
    ...nonLiveMsgs.slice(priorIdx + 1).map((m: any) => ({
      ...m,
      pendingFoodLog: undefined,
      data: m.data ? { ...m.data, pendingFoodLog: undefined } : undefined,
    })),
  ];
}

export function shouldMergeFoodEditTurn(opts: {
  isMedicalJob?: boolean;
  mode?: string;
  inputMode?: string;
  cleanMode?: string;
  messages: any[];
}): boolean {
  if (opts.isMedicalJob) return false;
  const mode = String(opts.mode || opts.inputMode || opts.cleanMode || '').toLowerCase();
  if (mode === 'edit' || mode === 'modify') return true;
  const msgs = opts.messages || [];
  const last = msgs[msgs.length - 1];
  const hasPriorFoodCard = msgs.some((m: any) => m?.role === 'assistant' && (m.data?.pendingFoodLog || m.pendingFoodLog));
  return !!(hasPriorFoodCard && last && last.role === 'user');
}
