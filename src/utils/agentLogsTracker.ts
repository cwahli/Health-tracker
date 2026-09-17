export interface AgentLogEntry {
  timestamp: string;
  message: string;
}

export interface AgentRequestLog {
  id: string;
  timestamp: string;
  summary: string;
  logs: AgentLogEntry[];
}

export const saveAgentRequestLog = (requestLog: AgentRequestLog) => {
  if (!requestLog || !requestLog.id) return;

  // Strip large base64 image data before saving to stay within localStorage quota
  const sanitized: AgentRequestLog = {
    ...requestLog,
    logs: (requestLog.logs || []).map(log => {
      const msgStr = typeof log.message === 'string' ? log.message : String(log.message || '');
      return {
        ...log,
        message: msgStr.replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]{200,}/g, '[image data stripped]')
      };
    })
  };
  let existing = getAgentRequestLogs();
  
  const existingIndex = existing.findIndex(r => r.id === sanitized.id);
  if (existingIndex !== -1) {
    const oldLogs = existing[existingIndex].logs || [];
    const newLogs = sanitized.logs || [];
    const mergedLogs = [...oldLogs];
    
    for (const log of newLogs) {
      if (!oldLogs.some(ol => ol.message === log.message && ol.timestamp === log.timestamp)) {
        mergedLogs.push(log);
      }
    }
    
    // We want to keep the original summary if the new summary is "Awaiting Portion Selection" and we have a better one.
    // Actually, if we just keep the new summary it's fine, but wait: when phase 2 finishes, the summary is "{"3":100}". We want the original meal name or "Analyze this meal photo."
    // Let's prefer the old summary if the new summary is just a JSON string or short.
    let finalSummary = sanitized.summary;
    if (finalSummary.startsWith('{') || finalSummary.startsWith('Awaiting Portion')) {
       finalSummary = existing[existingIndex].summary;
       if (sanitized.summary.startsWith('Awaiting')) {
         finalSummary = finalSummary + ' (Awaiting Portion)';
       }
    }

    existing[existingIndex] = {
      ...sanitized,
      summary: finalSummary,
      logs: mergedLogs
    };
  } else {
    existing.unshift(sanitized);
  }
  
  // Keep up to 15 requests
  const HOT_LOG_CAP = 5;
  if (existing.length > HOT_LOG_CAP) {
    existing = existing.slice(0, HOT_LOG_CAP);
  }

  try {
    localStorage.setItem('agent_request_logs', JSON.stringify(existing));
  } catch (error) {
    console.warn("[Storage Quota Exceeded] Attempting to save fewer logs...");
    // Fallback: keep fewer logs
    try {
      if (existing.length > 5) {
        existing.length = 5;
        localStorage.setItem('agent_request_logs', JSON.stringify(existing));
      }
    } catch (innerErr) {
      try {
        existing.length = 2;
        localStorage.setItem('agent_request_logs', JSON.stringify(existing));
      } catch (lastErr) {
        console.error("Could not save agent request log to localStorage due to storage constraints.", lastErr);
      }
    }
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('agent_logs_updated'));
  }
};

export const getAgentRequestLogs = (): AgentRequestLog[] => {
  try {
    const data = localStorage.getItem('agent_request_logs');
    return data ? JSON.parse(data) : [];
  } catch (e) {
    return [];
  }
};

export const deleteAgentRequestLog = (id: string) => {
  const existing = getAgentRequestLogs();
  const updated = existing.filter(r => r.id !== id);
  localStorage.setItem('agent_request_logs', JSON.stringify(updated));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('agent_logs_updated'));
  }
};
