export function reserveCredits(profile: any, selectedModelId: string): { reserved: number; updatedProfile: any } {
  return { reserved: 1, updatedProfile: profile };
}

export function refundCredits(_userId?: string, _amount: number = 1): boolean {
  return true;
}
