import { deductAgentCredits, getAvailableCredits } from '../utils/creditManager';
import { AgentJob } from './types';
import { UserProfile } from '../types';

export function reserveCredits(profile: UserProfile, modelId: string): { reserved: number; updatedProfile: UserProfile } {
  const before = getAvailableCredits(profile).total;
  const updatedProfile = deductAgentCredits(profile, modelId);
  const after = getAvailableCredits(updatedProfile).total;
  const reserved = before - after;
  return { reserved, updatedProfile };
}

export function settleCredits(job: AgentJob) {
  job.creditSettled = true;
}

export function refundCredits(job: AgentJob, profile: UserProfile): UserProfile {
  if (job.creditReserved && !job.creditSettled) {
    const updated = { ...profile };
    if (updated.agentCredits) {
      updated.agentCredits = {
        ...updated.agentCredits,
        remaining: (updated.agentCredits.remaining || 0) + job.creditReserved,
      };
    }
    return updated;
  }
  return profile;
}
