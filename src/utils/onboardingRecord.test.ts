import { describe, expect, it } from 'vitest';
import { commitOnboarding, onboardingDoors } from './onboardingRecord';

describe('onboarding record', () => {
  it('a blank profile offers paste, attach, and speak, all through data_entry', () => {
    const doors = onboardingDoors(true);
    expect(doors.map((door) => door.id)).toEqual(['paste', 'attach', 'speak']);
    expect(doors.every((door) => door.commitsThrough === 'data_entry')).toBe(true);
    expect(doors.find((door) => door.id === 'speak')?.voiceTool).toBe('handoff_specialist');
    expect(onboardingDoors(false)).toEqual([]);
  });

  it('a number and a sleep sentence skip the dictionary and the clinical chain', () => {
    const number = commitOnboarding('paste', 'HDL 50');
    const sleep = commitOnboarding('speak', 'I slept badly');
    expect(number.agent).toBe('data_entry');
    expect(number.dictionary).toBe(false);
    expect(sleep.clinicalChain).toBe(false);
    expect(sleep.socket).toBe('/api/gemini/live-ws');
    expect(number.text).toBe('HDL 50');
    expect(sleep.text).toBe('I slept badly');
  });
});
