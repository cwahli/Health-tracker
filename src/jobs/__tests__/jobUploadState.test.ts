import { describe, it, expect } from 'vitest';
import { isJobSafeToLeave } from '../jobUploadState';

describe('isJobSafeToLeave', () => {
  it('is false until the server has accepted the job', () => {
    expect(isJobSafeToLeave({ statusMessage: 'Analyzing your meal...' })).toBe(false);
    expect(
      isJobSafeToLeave({ statusMessage: 'Connection delayed; background runner retrying submit...' })
    ).toBe(false);
  });

  it('is true after submit sets serverSubmittedAt', () => {
    expect(isJobSafeToLeave({ serverSubmittedAt: Date.now(), statusMessage: 'Analyzing on server...' })).toBe(
      true
    );
  });

  it('does not treat a leftover https photo from a previous meal as uploaded', () => {
    expect(isJobSafeToLeave({ photoUrl: 'https://cdn.example/photo.jpg' } as any)).toBe(false);
  });
});
