export interface ReflectionEvaluation {
  needsCropReQuery: boolean;
  confidenceScore: number;
  reason?: string;
  targetedCropPrompt?: string;
}

export interface ReflectionCropQuery {
  query: string;
  action: 'crop_requery';
  scoutIndex?: number;
  prompt: string;
}

/**
 * Bi-directional Agent Reflection Loop
 * For ambiguous ingredients with low confidence (<60%), allow the Food Resolver / orchestrator
 * to issue a targeted crop re-query to the Vision Scout before falling back to category defaults.
 */
export function evaluateResolverConfidence(
  gap: {
    query: string;
    candidates?: Array<{ id: string; name: string; score?: number }>;
    confidenceScore?: number;
    chosenFdcId?: string | null;
  }
): ReflectionEvaluation {
  let confidenceScore = gap.confidenceScore ?? 1.0;

  // Calculate heuristic match score if no explicit score is given
  if (gap.confidenceScore === undefined) {
    if (!gap.chosenFdcId || !gap.candidates || gap.candidates.length === 0) {
      confidenceScore = 0.2;
    } else {
      const topCand = gap.candidates.find(c => c.id === gap.chosenFdcId) || gap.candidates[0];
      const qTokens = gap.query.toLowerCase().split(/\s+/).filter(Boolean);
      const cName = (topCand.name || '').toLowerCase();
      
      let matchedCount = 0;
      for (const t of qTokens) {
        if (cName.includes(t)) matchedCount++;
      }
      confidenceScore = qTokens.length > 0 ? matchedCount / qTokens.length : 0.5;
    }
  }

  const isLowConfidence = confidenceScore < 0.6;

  if (isLowConfidence) {
    const prompt = `Focus crop re-query on "${gap.query}" to inspect surface texture, sauce sheen, visible garnishes, or packaging text before category fallback.`;
    return {
      needsCropReQuery: true,
      confidenceScore,
      reason: `Low match confidence (${(confidenceScore * 100).toFixed(0)}% < 60%) for query "${gap.query}"`,
      targetedCropPrompt: prompt
    };
  }

  return {
    needsCropReQuery: false,
    confidenceScore
  };
}

export function buildVisionCropReQuery(query: string, scoutIndex?: number): ReflectionCropQuery {
  return {
    query,
    action: 'crop_requery',
    scoutIndex,
    prompt: `Focus crop re-query on "${query}" to inspect surface texture, sauce sheen, visible garnishes, or packaging text.`
  };
}
