import { AgentJob } from './types';
import { translations } from '../utils/translations';

export function isEditJob(job: any): boolean {
  if (!job) return false;
  return (
    job.mode === 'edit' ||
    job.kind === 'edit' ||
    job.isEdit === true ||
    Boolean(job.editTargetId) ||
    Boolean(job.activeMeal)
  );
}

export function isTurnInFlight(job: any): boolean {
  if (!job) return false;
  return job.status === 'running' || job.status === 'queued' || job.status === 'processing';
}

export function previewStatus(job: any): string {
  if (!job) return 'idle';
  return job.status || 'idle';
}

export function previewStatusLabel(job: any, langOrOptions: any = 'en'): string {
  if (!job) return '';
  const isEdit = isEditJob(job);
  const lang = typeof langOrOptions === 'string' ? langOrOptions : 'en';
  const t = translations[lang] || translations.en;

  if (job.status === 'running' || job.status === 'queued' || job.status === 'processing') {
    if (isEdit) {
      return (t as any)?.updatingMeal || 'Updating meal...';
    }
    return (t as any)?.analyzingMeal || 'Analyzing meal...';
  }

  if (job.status === 'succeeded' || job.status === 'done') {
    return (t as any)?.analysisCompleted || 'Analysis completed';
  }

  if (job.status === 'failed') {
    return (t as any)?.analysisFailed || 'Analysis failed';
  }

  if (job.status === 'awaiting_user') {
    return (t as any)?.awaitingInput || 'Awaiting input';
  }

  return job.statusMessage || job.status || '';
}
