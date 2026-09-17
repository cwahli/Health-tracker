import { describe, it, expect } from 'vitest';
import { isJobSafeToLeave } from '../jobUploadState';

describe('jobUploadState', () => {
  it('identifies safe-to-leave states', () => {
    expect(isJobSafeToLeave({ status: 'running' })).toBe(true);
    expect(isJobSafeToLeave({ photoUrl: 'https://r2.example.com/photo.jpg' })).toBe(true);
    expect(isJobSafeToLeave({ images: ['data:image/jpeg;base64,...'], status: 'queued' })).toBe(false);
  });
});
