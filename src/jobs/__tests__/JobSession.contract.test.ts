import { describe, it, expect } from 'vitest';
import { previewStatusLabel, previewStatus, isEditJob, isTurnInFlight } from '../jobPreview';

describe('JobSession Contract', () => {
  it('correctly labels in-flight turns as Updating meal or Analyzing meal', () => {
    const editJob = {
      id: 'job-1',
      status: 'running',
      mode: 'edit',
      activeMeal: { name: 'Unsweetened green tea', calories: 0 },
    };
    expect(isEditJob(editJob)).toBe(true);
    expect(isTurnInFlight(editJob)).toBe(true);
    expect(previewStatusLabel(editJob)).toContain('Updating meal');

    const doneJob = {
      id: 'job-2',
      status: 'succeeded',
      mode: 'analyze',
    };
    expect(previewStatusLabel(doneJob)).toContain('Analysis completed');
  });
});
