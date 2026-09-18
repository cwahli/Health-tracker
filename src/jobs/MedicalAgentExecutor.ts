import { JobStore } from './JobStore';
import { appendSessionLog } from './sessionLog';

export async function executeMedicalAgent(jobId: string, payload: any): Promise<any> {
  const job = JobStore.getJob(jobId);
  if (!job) return null;

  JobStore.updateJob(jobId, { status: 'running' });
  appendSessionLog(jobId, { writer: 'MedicalAgentExecutor', status: 'running', message: 'start' });

  try {
    const res = await fetch('/api/medical/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();
    JobStore.updateJob(jobId, {
      status: 'succeeded',
      result: data,
      clean_result: data,
    });

    appendSessionLog(jobId, { writer: 'MedicalAgentExecutor', status: 'succeeded', message: 'result_ready' });
    return data;
  } catch (err: any) {
    JobStore.updateJob(jobId, {
      status: 'failed',
      error: err?.message || 'Medical agent execution failed',
    });
    throw err;
  }
}
