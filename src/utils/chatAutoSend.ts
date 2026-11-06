/** Front Desk / specialist auto-send. Must never run on a food composer. */
export function shouldRunHandoffAutoSend(opts: {
  isOpen: boolean;
  type?: string | null;
  agentType?: string | null;
  autoSendMessage?: string | null;
  hasHandoffPayload?: boolean;
  effectiveAutoSend?: string | null;
}): { run: boolean; reason: string } {
  if (!opts.isOpen) return { run: false, reason: 'closed' };
  const type = String(opts.type || '');
  if (type === 'food' || type === 'food_compare' || type === 'food_log') {
    return { run: false, reason: 'food_chat' };
  }
  const send = opts.effectiveAutoSend ?? opts.autoSendMessage ?? null;
  if (!send) return { run: false, reason: 'no_payload' };
  const agent = String(opts.agentType || '');
  if (['agent1', 'agent2', 'agent3', 'agent4', 'agent5', 'agent7'].includes(agent)) {
    return { run: false, reason: 'excluded_agent' };
  }
  if (agent === 'data_review' || agent === 'biomarker_review') {
    return { run: false, reason: 'prefill_only' };
  }
  if (type === 'medical' || type === 'front_desk' || agent === 'health_baseline' || agent === 'medical') {
    return { run: true, reason: 'handoff' };
  }
  return { run: false, reason: 'not_handoff_surface' };
}
