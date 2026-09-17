import { buildAgent1BatchRows } from './agentResultRowsBatch';

export interface AgentResultRowsArgs {
  agentResult: any;
  agentType: string;
  profile: any;
  biomarkerHistory: any[];
  initialRawText: string;
  precedingAgent1Result: any;
  parsedRows: any[];
  mergedInfo: Record<string, { isMerged: boolean; mergedFrom: string[] }>;
}

export function buildAgentResultRows(args: AgentResultRowsArgs): any[] | null {
  const { agentType, agentResult } = args;
  if (
    agentType === 'agent1' &&
    agentResult?.batchBiomarkers &&
    Array.isArray(agentResult.batchBiomarkers) &&
    agentResult.batchBiomarkers.length > 0
  ) {
    return buildAgent1BatchRows(args);
  }
  return null;
}
