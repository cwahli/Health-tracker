/** On-demand handoff among the four record agents. Not a pipeline. */

export type MeshAgent = 'front_desk' | 'data_entry' | 'health_baseline' | 'agent7';

export interface MeshHandoff {
  fromAgent: MeshAgent;
  toAgent: MeshAgent;
  reason: string;
  payload: unknown;
  returnToCaller: true;
}

const MESH: MeshAgent[] = ['front_desk', 'data_entry', 'health_baseline', 'agent7'];

export function aliasStoredAgent(id: string): string {
  if (id === 'medical' || id === 'biomarker_review' || id === 'data_review') return 'data_entry';
  if (id === 'agent4' || id === 'health_coach') return 'health_baseline';
  if (id === 'agent5' || id === 'literature') return 'agent7';
  return id;
}

export function handoff(fromAgent: MeshAgent, toAgent: MeshAgent, reason: string, payload: unknown): MeshHandoff | null {
  if (!MESH.includes(fromAgent) || !MESH.includes(toAgent)) return null;
  if (fromAgent === toAgent) return null;
  return { fromAgent, toAgent, reason, payload, returnToCaller: true };
}

export function coachReply(allowanceKcal: number, tests: string[]): {
  allowanceKcal: number;
  activity: string[];
  testPlan: string[];
} {
  return { allowanceKcal, activity: [], testPlan: tests };
}
