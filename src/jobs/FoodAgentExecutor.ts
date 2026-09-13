export interface FoodAgentExecutorInput {
  jobId: string;
  text: string;
  images?: string[];
  photoUrl?: string;
  mode: 'review' | 'compare' | 'edit';
  lockedModeFamily?: string | null;
  profile: any;
  modelId: string;
  requestId: string;
  checkpoint?: { scoutItems?: any[]; scoutContentType?: string };
  signal?: AbortSignal;
  activeScoutItems?: any;
  scoutContentType?: string;
  skipScout?: boolean;
  activeFoodLogs?: any[];
  outOfRangeBiomarkers?: any[];
  remainingAllowance?: any;
  dailyNutrientTargets?: any;
  topTargetNutrientKeys?: string[];
  report?: any;
  messages?: any[]; // Only what's needed for context
  portionChoices?: any;
  activeMeal?: any;
  explicitFoodTags?: any[];
}

export interface FoodAgentExecutorEvent {
  type: 'progress' | 'checkpoint' | 'partial' | 'done' | 'error';
  stepKey?: string;
  progressPercent?: number;
  statusMessage?: string;
  checkpoint?: any;
  partialText?: string;
  partialThoughts?: any;
  data?: any;
  errorClass?: 'permanent' | 'transient' | 'retriable_from_checkpoint';
  message?: string;
  portionClarify?: any;
}

const extractScratchpadText = (accumulated: string) => {
  const match = accumulated.match(/["']_internalReasoning["']\s*:\s*"/i);
  if (!match || match.index === undefined) return "";
  
  const startQuoteIndex = match.index + match[0].length - 1;
  
  let text = "";
  let escaped = false;
  for (let i = startQuoteIndex + 1; i < accumulated.length; i++) {
    const char = accumulated[i];
    if (escaped) {
      if (char === 'n') text += '\n';
      else if (char === 't') text += '\t';
      else if (char === 'r') text += '\r';
      else text += char;
      escaped = false;
    } else if (char === '\\') {
      escaped = true;
    } else if (char === '"') {
      if (accumulated.length - i > 30) { 
         text += "\n\n[Building structured JSON items...]";
      }
      return text;
    } else {
      text += char;
    }
  }
  return text;
};

export async function* executeFoodAgent(input: FoodAgentExecutorInput): AsyncGenerator<FoodAgentExecutorEvent, void, unknown> {
  const { jobId, photoUrl, text, images, mode, profile, modelId, requestId, signal, activeFoodLogs, outOfRangeBiomarkers, remainingAllowance, messages } = input;

  // Build bodyData
  const bodyData: any = {
    jobId,
    message: text,
    image: images?.[0],
    images: images,
    engine: modelId,
    userSelectedMode: mode,
    skipScout: input.skipScout,
    scoutContentType: input.scoutContentType,
    activeScoutItems: input.activeScoutItems,
    explicitFoodTags: input.explicitFoodTags,
  };
  
  if (profile) {
    const lightProfile = { ...profile };
    delete lightProfile.customBiomarkers;
    bodyData.userProfile = lightProfile;
  }
  
  if (messages) {
    const revIdx = [...messages].reverse().findIndex(m => m.id && m.id.startsWith('welcome_'));
    const lastWelcomeIndex = revIdx >= 0 ? messages.length - 1 - revIdx : -1;
    const activeSessionIdx = lastWelcomeIndex >= 0 ? lastWelcomeIndex : 0;
    bodyData.history = messages.slice(activeSessionIdx).filter(m => !m.id || !m.id.startsWith('welcome_')).map(m => {
      let extra = "";
      if (m.role === 'assistant') {
        if (m.data?.pendingBiomarkers) extra += `\n[Extracted Biomarkers: ${JSON.stringify(m.data?.pendingBiomarkers)}]`;
        if (m.data?.pendingFoodLog) {
           extra += `\n[Extracted Food: ${m.data?.pendingFoodLog.name}, ${m.data?.pendingFoodLog.quantity}, ${m.data?.pendingFoodLog.nutrients?.calories || 0} kcal. (Full nutrient data omitted for brevity)]`;
        }
        if (m.pendingDate) extra += `\n[Extracted Date: ${m.pendingDate}]`;
        if (m.pendingProfile) extra += `\n[Extracted Profile: ${JSON.stringify(m.pendingProfile)}]`;
      }
      return { role: m.role, content: m.content + extra };
    });
    const lastFoodLogMsg = [...messages].reverse().find(m => m.data?.pendingFoodLog || m.pendingFoodLog);
    const lastFoodLog = lastFoodLogMsg?.data?.pendingFoodLog || lastFoodLogMsg?.pendingFoodLog;
    if (lastFoodLog) {
      try {
        const prunedMeal = JSON.parse(JSON.stringify(lastFoodLog));
        if (prunedMeal.itemsBreakdown) {
          prunedMeal.itemsBreakdown = prunedMeal.itemsBreakdown.map((item: any) => {
            const cleaned = { ...item };
            delete cleaned.labelNutrientsPerServing;
            return cleaned;
          });
        }
        bodyData.activeMeal = prunedMeal;
      } catch (e) {
        bodyData.activeMeal = lastFoodLog;
      }
    }
  }

  if (input.activeMeal) {
    bodyData.activeMeal = input.activeMeal;
  }

  if (activeFoodLogs) {
    bodyData.foodLogs = activeFoodLogs.slice(-60).map((f: any) => ({ name: f.name, date: f.date, nutrients: f.nutrients }));
  }
  if (outOfRangeBiomarkers) {
    bodyData.biomarkersNeedingImprovement = outOfRangeBiomarkers
      .filter((b: any) => b && b.status !== 'flagged')
      .map((b: any) => `${b.name} is ${b.status} (${b.value} ${b.unit})`);
  }
  if (remainingAllowance) {
    bodyData.remainingAllowance = remainingAllowance;
  }
  if ((input as any).dailyNutrientTargets) {
    bodyData.dailyNutrientTargets = (input as any).dailyNutrientTargets;
  }
  if ((input as any).topTargetNutrientKeys) {
    bodyData.topTargetNutrientKeys = (input as any).topTargetNutrientKeys;
  }
  if ((input as any).report) {
    bodyData.report = (input as any).report;
  }
  if (input.skipScout) {
    bodyData.skipScout = input.skipScout;
  }
  if (input.portionChoices) {
    bodyData.portionChoices = input.portionChoices;
  }
  if (input.activeScoutItems || input.checkpoint?.scoutItems) {
    bodyData.activeScoutItems = input.activeScoutItems || input.checkpoint?.scoutItems;
  }
  if ((input as any).dispatches || bodyData.activeMeal?.dispatches) {
    bodyData.dispatches = (input as any).dispatches || bodyData.activeMeal?.dispatches;
  }

  // Cleanup undefined
  if (photoUrl) bodyData.photoUrl = photoUrl;
  Object.keys(bodyData).forEach(key => {
    if (bodyData[key] === undefined) delete bodyData[key];
  });

  yield { type: 'progress', stepKey: 'starting', statusMessage: 'Starting analysis' };

  try {
    const fetchEndpoint = '/api/gemini/food-analyze?stream=true';
    const response = await fetch(fetchEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-ID': requestId
      },
      body: JSON.stringify(bodyData),
      signal
    });

    if (!response.ok) {
      const rawText = await response.text().catch(() => '');
      const isRateLimitedOrTimeout = response.status === 429 || response.status === 504 || response.status === 502 || response.status === 503 || rawText.trim().toLowerCase().startsWith('<!doctype');
      const errorClass = isRateLimitedOrTimeout ? 'transient' : 'permanent';
      yield { type: 'error', errorClass, message: isRateLimitedOrTimeout ? (response.status === 429 ? 'Rate limit exceeded (429), retrying...' : 'Server timeout') : 'Request failed: ' + response.status };
      return;
    }

    const contentType = response.headers.get("content-type");
    let resData: any = {};

    if (contentType && contentType.includes("text/event-stream")) {
      const reader = response.body?.getReader();
      if (!reader) {
        yield { type: 'error', errorClass: 'permanent', message: 'No stream reader available' };
        return;
      }

      const decoder = new TextDecoder();
      let accumulatedThoughts: any = { scout: '', dietitian: '', dbSearchLog: '', activeStage: '', backendLogs: '' };
      const accumulatedByStage: Record<string, string> = { scout: "", dietitian: "" };
      const scratchpadFullByStage: Record<string, string> = { scout: "", dietitian: "" };
      let dbSearchLogFull = "";
      let backendLogsFull = "";
      let lineBuffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunkStr = decoder.decode(value, { stream: true });
        lineBuffer += chunkStr;

        while (true) {
          let separatorIdx = lineBuffer.indexOf("\n\n");
          let separatorLen = 2;
          let altIdx = lineBuffer.indexOf("\r\n\r\n");
          if (altIdx !== -1 && (separatorIdx === -1 || altIdx < separatorIdx)) {
            separatorIdx = altIdx;
            separatorLen = 4;
          }
          if (separatorIdx === -1) break;
          
          const ev = lineBuffer.substring(0, separatorIdx).trim();
          lineBuffer = lineBuffer.substring(separatorIdx + separatorLen);

          if (ev.startsWith("data: ")) {
            try {
              const data = JSON.parse(ev.slice(6));
              
              if (data.type === 'status') {
                accumulatedThoughts.activeStage = data.stage;
                yield { type: 'partial', partialThoughts: { ...accumulatedThoughts } };
              } else if (data.type === 'log' || data.logType) {
                const logMsg = data.message || '';
                if (logMsg) {
                  const taggedLine = data.logType ? `[${data.logType}]${data.timestamp ? `[${data.timestamp}]` : ''} ${logMsg}` : logMsg;
                  backendLogsFull = (backendLogsFull ? backendLogsFull + '\n' : '') + taggedLine;
                  accumulatedThoughts.backendLogs = backendLogsFull;
                }
                const isDbLog = data.logType?.startsWith('db_') || logMsg.includes('[Database Search]') || logMsg.includes('[USDA]') || logMsg.includes('[OpenFoodFacts]');
                if (logMsg && isDbLog) {
                  dbSearchLogFull = (dbSearchLogFull ? dbSearchLogFull + "\n" : "") + logMsg;
                  accumulatedThoughts.dbSearchLog = dbSearchLogFull;
                }
                const logStage = data.stage || (data.logType?.startsWith('db_') ? 'db_search' : undefined);
                if (logStage && logStage !== 'scout') {
                  accumulatedThoughts.activeStage = logStage;
                }
                yield { type: 'partial', partialThoughts: { ...accumulatedThoughts } };
              } else if (data.chunk || data.thought || data.type === 'stream') {
                const stage: string = data.stage === 'scout' ? 'scout' : 'dietitian';
                const chunkText = data.chunk || data.thought || '';
                if (data.thought) {
                  scratchpadFullByStage[stage] += chunkText;
                  accumulatedThoughts[stage] = scratchpadFullByStage[stage];
                } else if (data.chunk) {
                  accumulatedByStage[stage] += data.chunk;
                  const text = extractScratchpadText(accumulatedByStage[stage]);
                  if (text) {
                    scratchpadFullByStage[stage] = text;
                    accumulatedThoughts[stage] = text;
                  }
                }
                yield { type: 'partial', partialThoughts: { ...accumulatedThoughts } };
              } else if (data.final) {
                resData = data.result;
              } else if (data.error) {
                resData.error = data.error;
              }
              
              if (data.type === 'scout_answer' || data.scoutItems || (data.result && data.result.scoutItems)) {
                const items = data.items || data.scoutItems || (data.result && data.result.scoutItems);
                if (items) {
                   yield { type: 'checkpoint', checkpoint: { scoutItems: items, scoutContentType: data.scoutContentType || (data.result && data.result.scoutContentType) } };
                }
              }
            } catch (e) {}
          }
        }
      }
      if (lineBuffer.startsWith("data: ")) {
        try {
          const data = JSON.parse(lineBuffer.slice(6));
          if (data.final) resData = data.result;
          else if (data.error) resData.error = data.error;
        } catch (e) {}
      }
      // Attach the accumulated logs to the final result so LogChat can save them
      if (!resData.agentResult) resData.agentResult = {};
      resData.agentResult.backendLogs = backendLogsFull;
      resData.agentResult.scoutScratchpad = scratchpadFullByStage.scout;
      resData.agentResult.dietitianScratchpad = scratchpadFullByStage.dietitian;
    } else if (contentType && contentType.includes("application/json")) {
       const rawText = await response.text().catch(() => "");
       resData = rawText ? JSON.parse(rawText) : {};
    } else {
       throw new Error(`Server returned a non-JSON response (${response.status})`);
    }

    if (resData.error) {
      const errLower = resData.error.toLowerCase();
      const isTransient = errLower.includes('timeout') || errLower.includes('quota') || errLower.includes('too many') || errLower.includes('429') || errLower.includes('rate') || errLower.includes('limit') || errLower.includes('exceeded') || errLower.includes('busy') || errLower.includes('overloaded') || errLower.includes('500') || errLower.includes('502') || errLower.includes('503') || errLower.includes('504');
      yield { type: 'error', errorClass: isTransient ? 'transient' : 'permanent', message: resData.error, checkpoint: resData.scoutItems ? { scoutItems: resData.scoutItems, scoutContentType: resData.scoutContentType } : undefined };
      return;
    }

    yield { type: 'done', data: resData };

  } catch (err: any) {
    if (err.name === 'AbortError') {
      yield { type: 'progress', statusMessage: 'Aborted' };
    } else {
      yield { type: 'error', errorClass: 'transient', message: err.message };
    }
  }
}
