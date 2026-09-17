import { buildAgent1BatchRows } from './agentResultRowsBatch';
import { buildBiomarkerReviewRows } from './agentResultRowsFallback';

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
  if (agentType === 'biomarker_review') {
    return buildBiomarkerReviewRows(args);
  }
  return null;
}
