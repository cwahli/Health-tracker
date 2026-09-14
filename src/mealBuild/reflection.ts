export const reflection = {} as any;
export const evaluateResolverConfidence = (gap: any) => {
  if (gap?.confidenceScore < 0.6) {
    return { needsCropReQuery: true, confidenceScore: gap.confidenceScore, targetedCropPrompt: `Focus crop re-query on "${gap.query}"` };
  }
  return { needsCropReQuery: false, confidenceScore: gap?.confidenceScore, targetedCropPrompt: undefined };
};
export const buildVisionCropReQuery = (query: string, scoutIndex: number) => {
  return { query, action: 'crop_requery', scoutIndex, prompt: `Focus crop re-query on "${query}"` };
};
