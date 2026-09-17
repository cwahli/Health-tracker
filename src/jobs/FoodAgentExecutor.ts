import { JobStore } from './JobStore';
import { projectDietitianInput } from '../mealBuild/projectors';
import { appendSessionLog } from './sessionLog';

export async function executeFoodAgent(jobId: string, payload: any): Promise<any> {
  const job = JobStore.getJob(jobId);
  if (!job) return null;

  JobStore.updateJob(jobId, { status: 'running' });
  appendSessionLog(jobId, { writer: 'FoodAgentExecutor', status: 'running', message: 'start' });

  try {
    // Project dietitian input if relevant
    const projected = projectDietitianInput(payload, payload?.userProfile);
    const res = await fetch('/api/food/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, projected }),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();
    const mealBuild = data?.mealBuild || data?.result?.mealBuild;

    JobStore.updateJob(jobId, {
      status: 'succeeded',
      result: data,
      clean_result: data,
      mealBuild,
    });

    appendSessionLog(jobId, { writer: 'FoodAgentExecutor', status: 'succeeded', message: 'result_ready' });
    return data;
  } catch (err: any) {
    JobStore.updateJob(jobId, {
      status: 'failed',
      error: err?.message || 'Food agent execution failed',
    });
    throw err;
  }
}
