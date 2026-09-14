/**
 * F-8.10 shard 26 — mode response payloads, extracted verbatim from
 * runFoodAnalyze. Pure res.json body shaping; routing, streaming, and the
 * res.json calls themselves stay in the pipeline.
 */

export function buildDiscussionResponse(args: {
  rawParsed: any;
  agentInstructions?: any;
  apiCalls: any;
  dispatches?: any[];
}): Record<string, any> {
  const { rawParsed, agentInstructions, apiCalls, dispatches } = args;
  return {
    mode: "discussion",
    mealAgentScratchpad: rawParsed._internalReasoning,
    dietitianScratchpad: rawParsed._internalReasoning,
    text: rawParsed.message || "Here is the details on this meal composition.",
    message: rawParsed.message || "Here is the details on this meal composition.",
    data: null,
    agentInstructions,
    dispatches,
    apiCalls
  };
}

export function buildEvaluationResponse(args: {
  rawParsed: any;
  scoutInternalReasoning: any;
  rawScoutData: any;
  comparisonData: any;
  comparisonSet: any;
  scoutItems: any;
  scoutContentType: any;
  diningEnvironment: any;
  agentInstructions?: any;
  apiCalls: any;
  dispatches?: any[];
}): Record<string, any> {
  const {
    rawParsed, scoutInternalReasoning, rawScoutData, comparisonData, comparisonSet,
    scoutItems, scoutContentType, diningEnvironment, agentInstructions, apiCalls, dispatches,
  } = args;
  return {
    mode: "evaluation",
    mealAgentScratchpad: rawParsed._internalReasoning,
    dietitianScratchpad: rawParsed._internalReasoning,
    scoutInternalReasoning,
    rawScout: rawScoutData,
    comparison: comparisonData,
    comparisonSet,
    items: scoutItems,
    scoutItems,
    scoutContentType,
    diningEnvironment,
    agentInstructions,
    dispatches,
    message: rawParsed.message,
    text: rawParsed.message,
    apiCalls
  };
}

export function buildNewLogResponse(args: {
  rawParsed: any;
  parsedData: any;
  pendingFoodLog: any;
  mealBuild: any;
  gate: any;
  scoutInternalReasoning: any;
  rawScoutData: any;
  scoutContentType: any;
  diningEnvironment: any;
  agentInstructions?: any;
  scoutItems: any;
  apiCalls: any;
  dispatches?: any[];
  portionClarify?: any;
}): Record<string, any> {
  const {
    rawParsed, parsedData, pendingFoodLog, mealBuild, gate, scoutInternalReasoning,
    rawScoutData, scoutContentType, diningEnvironment, agentInstructions, scoutItems, apiCalls,
    dispatches, portionClarify,
  } = args;
  return {
    mode: "new_log",
    mealAgentScratchpad: rawParsed._internalReasoning,
    dietitianScratchpad: rawParsed._internalReasoning,
    scoutInternalReasoning,
    rawScout: rawScoutData,
    scoutContentType,
    diningEnvironment,
    text: rawParsed.message || `I have analyzed the food: **${parsedData.name}** (${parsedData.quantity}).`,
    message: rawParsed.message || `I have analyzed the food: **${parsedData.name}** (${parsedData.quantity}).`,
    data: pendingFoodLog || parsedData,
    pendingFoodLog: pendingFoodLog || parsedData,
    mealBuild,
    savable: gate.savable,
    gate,
    agentInstructions,
    scoutItems,
    dispatches,
    apiCalls,
    portionClarify: portionClarify || null,
    // Split turn: a present payload pauses the job to awaiting_user in the
    // submit stream (serverJobs checks finalData.needsPortionClarify).
    needsPortionClarify: portionClarify ? true : undefined,
  };
}

export function buildModifyNoMealResponse(args: {
  rawParsed: any;
  apiCalls: any;
}): Record<string, any> {
  const { rawParsed, apiCalls } = args;
  return {
    text: rawParsed.message || "I couldn't modify the meal because there's no active meal currently logged. Please log a meal first!",
    message: rawParsed.message || "I couldn't modify the meal because there's no active meal currently logged. Please log a meal first!",
    data: null,
    apiCalls
  };
}

export function buildModifyResponse(args: {
  rawParsed: any;
  finalMessage: string;
  pendingFoodLog: any;
  activeMeal: any;
  mealBuild: any;
  gate: any;
  editApplied: boolean;
  agentInstructions?: any;
  scoutItems: any;
  rawScoutData?: any;
  dispatches?: any[];
  apiCalls: any;
}): Record<string, any> {
  const {
    rawParsed, finalMessage, pendingFoodLog, activeMeal, mealBuild, gate,
    editApplied, agentInstructions, scoutItems, rawScoutData, dispatches, apiCalls,
  } = args;
  return {
    mode: "modify",
    mealAgentScratchpad: rawParsed._internalReasoning,
    dietitianScratchpad: rawParsed._internalReasoning,
    rawScout: rawScoutData,
    text: finalMessage,
    message: finalMessage,
    data: pendingFoodLog || activeMeal,
    pendingFoodLog: pendingFoodLog || activeMeal,
    mealBuild,
    savable: gate.savable,
    gate,
    editApplied,
    agentInstructions,
    scoutItems,
    dispatches,
    apiCalls
  };
}

export function buildDegradeResponse(args: {
  payloadData: any;
  degradedMeal: any;
  visionScoutItems: any;
  scoutContentType: any;
  agentInstructions?: any;
  apiCalls: any;
  dispatches?: any[];
  portionClarify?: any;
}): Record<string, any> {
  const {
    payloadData, degradedMeal, visionScoutItems, scoutContentType, agentInstructions, apiCalls, dispatches, portionClarify,
  } = args;
  const degradeMessage = "Nutrients logged based on core databases, but AI clinical advice is currently unavailable.";
  return {
    mode: "new_log",
    data: payloadData,
    pendingFoodLog: payloadData,
    mealBuild: degradedMeal,
    degradedStages: degradedMeal.degradedStages,
    scoutItems: visionScoutItems,
    scoutContentType,
    text: degradeMessage,
    message: degradeMessage,
    portionClarify: portionClarify || null,
    needsPortionClarify: portionClarify ? true : undefined,
    agentInstructions,
    dispatches,
    apiCalls
  };
}
