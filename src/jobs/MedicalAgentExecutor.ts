export interface MedicalAgentExecutorInput {
  jobId: string;
  text: string;
  images?: string[];
  photoUrl?: string;
  agentType: string;
  profile: any;
  modelId: string;
  requestId: string;
  biomarkers: any;
  biomarkerHistory: any[];
  actions: any[];
  messages: any[];
  signal?: AbortSignal;
  numberOfBatches?: number;
  dataReviewBatchKeys?: string[];
  dataReviewBatchIdx?: number | string | null;
  estimatedTotalMarkers?: number | null;
  currentBatch?: number;
  extractedData?: any;
  filledRows?: any[];
  lastProcessedIndex?: number | null;
  bucketMapping?: string;
  reviewBiomarkerKey?: string;
  batchSize?: number;
}

export interface MedicalAgentExecutorEvent {
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
}

export async function* executeMedicalAgent(input: MedicalAgentExecutorInput): AsyncGenerator<MedicalAgentExecutorEvent, void, unknown> {
  const {
    jobId,
    text,
    images,
    photoUrl,
    agentType,
    profile,
    modelId,
    requestId,
    biomarkers,
    biomarkerHistory,
    actions,
    messages,
    signal,
    numberOfBatches,
    dataReviewBatchKeys,
    dataReviewBatchIdx,
    estimatedTotalMarkers,
    currentBatch,
    extractedData,
    filledRows,
    lastProcessedIndex,
    bucketMapping,
    reviewBiomarkerKey,
    batchSize
  } = input;

  // Build the request bodyData matching LogChat's expected structure
  const bodyData: any = {
    jobId,
    photoUrl: photoUrl,
    engine: modelId,
    agentType,
    message: text || '',
    numberOfBatches,
    extractedData,
    filledRows,
    lastProcessedIndex,
    bucketMapping,
    estimatedTotalMarkers,
    currentBatch,
    biomarkerKey: reviewBiomarkerKey,
    batchSize: batchSize || 50
  };

  if (profile) {
    const lightProfile = { ...profile };
    delete lightProfile.customBiomarkers;
    bodyData.userProfile = lightProfile;
    bodyData.agentDiagnosticSummary = profile.agentDiagnosticSummary || '';
    const catalogUnitByKey: Record<string, string> = {};
    Object.entries(profile.customBiomarkers || {}).forEach(([k, v]: [string, any]) => {
      if (v?.unit) catalogUnitByKey[k] = v.unit;
    });
    bodyData.catalogUnitByKey = catalogUnitByKey;
  }

  bodyData.biomarkers = biomarkers || {};
  bodyData.actions = actions || [];
  
  const deletedIds = profile?.deletedBiomarkerLogIds || {};
  bodyData.biomarkerHistory = (biomarkerHistory || []).filter(
    h => h.sync_state !== 'delete' && !deletedIds[h.id]
  );

  // Parse messages for history context if any
  if (messages && messages.length > 0) {
    bodyData.history = messages
      .filter(m => !m.id || !m.id.startsWith('welcome_'))
      .map(m => ({ role: m.role, content: m.content || '' }));
  }

  // Set up batchKeys and batchBiomarkers if needed (matching LogChat fallback / custom batch setup)
  if (dataReviewBatchKeys && dataReviewBatchKeys.length > 0) {
    bodyData.batchKeys = dataReviewBatchKeys;
    bodyData.dataReviewBatchKeys = dataReviewBatchKeys;
    bodyData.batchBiomarkers = dataReviewBatchKeys.map(k => {
      const customDef = profile?.customBiomarkers?.[k];
      const historyEntries: { date: string; value: any }[] = [];
      (biomarkerHistory || []).forEach((h: any) => {
        if (h.biomarkers && h.biomarkers[k] !== undefined && h.biomarkers[k] !== null && h.biomarkers[k] !== '') {
          historyEntries.push({ date: h.date || 'unknown', value: h.biomarkers[k] });
        }
      });
      const val = (biomarkers && biomarkers[k] !== undefined && biomarkers[k] !== null && biomarkers[k] !== '')
        ? biomarkers[k]
        : (historyEntries[0]?.value ?? '');
      return {
        key: k,
        name: customDef?.name || k,
        userValue: val,
        value: val,
        unit: customDef?.unit || '',
        normalRange: customDef?.normalRange || '',
        historicalEntries: historyEntries,
        historicalSummary: historyEntries.map(e => `${e.date}: ${e.value}`).join(' → ')
      };
    });
  }

  yield {
    type: 'progress',
    progressPercent: 10,
    statusMessage: `Initializing medical analyst (${agentType})...`
  };

  const response = await fetch('/api/gemini/medical-analyze', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-ID': requestId
    },
    body: JSON.stringify(bodyData),
    signal
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    const isTransient = response.status === 429 || response.status === 504 || response.status === 502 || response.status === 503;
    const err = new Error(isTransient ? (response.status === 429 ? 'Rate limit exceeded (429), retrying...' : `Server error (${response.status})`) : `Server returned ${response.status}: ${errText}`);
    (err as any).class = isTransient ? 'transient' : 'permanent';
    throw err;
  }

  const contentType = response.headers.get("content-type");
  let resData: any = {};

  if (contentType && contentType.includes("text/event-stream")) {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No stream reader available");
    const decoder = new TextDecoder();
    let accumulatedText = "";
    let accumulatedByStage = { scout: "", diet: "" };

    try {
      while (true) {
        if (signal?.aborted) {
          throw new Error('AbortError');
        }

        const { done, value } = await reader.read();
        if (done) break;

        const chunkStr = decoder.decode(value, { stream: true });
        const events = chunkStr.split("\n\n");

        for (const ev of events) {
          if (ev.startsWith("data: ")) {
            try {
              const data = JSON.parse(ev.slice(6));
              if (data.chunk) {
                accumulatedText += data.chunk;
                const stage = data.stage === 'scout' ? 'scout' : 'diet';
                accumulatedByStage[stage] += data.chunk;

                const scoutMatch = accumulatedByStage.scout.match(/"(?:scratchpad|_internalReasoning)"\s*:\s*"([^]*?)("|$)/);
                const dietMatch = accumulatedByStage.diet.match(/"(?:scratchpad|_internalReasoning)"\s*:\s*"([^]*?)("|$)/);

                const partialThoughts: any = {};
                if (scoutMatch) {
                  partialThoughts.scout = scoutMatch[1].replace(/\\n/g, "\n").replace(/\\\"/g, "\"");
                }
                if (dietMatch) {
                  partialThoughts.diet = dietMatch[1].replace(/\\n/g, "\n").replace(/\\\"/g, "\"");
                }

                yield {
                  type: 'partial',
                  partialText: accumulatedText,
                  partialThoughts
                };
              } else if (data.final) {
                resData = data.result;
              }
            } catch (e) {
              // Ignore parse errors on incomplete event boundaries
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  } else {
    const responseContentType = response.headers.get("content-type");
    if (responseContentType && responseContentType.includes("application/json")) {
      resData = await response.json();
    } else {
      const rawText = await response.text().catch(() => "");
      throw new Error(`Server returned a non-JSON response (${response.status}): ${rawText.substring(0, 150)}`);
    }
  }

  yield {
    type: 'done',
    data: resData
  };
}
