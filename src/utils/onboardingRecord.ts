/** Empty-profile doors. Voice stays on the existing handoff_specialist tool. */

export type OnboardingDoor = 'paste' | 'attach' | 'speak';

export function onboardingDoors(profileEmpty: boolean): Array<{
  id: OnboardingDoor;
  commitsThrough: 'data_entry';
  voiceTool: 'handoff_specialist' | null;
}> {
  if (!profileEmpty) return [];
  return [
    { id: 'paste', commitsThrough: 'data_entry', voiceTool: null },
    { id: 'attach', commitsThrough: 'data_entry', voiceTool: null },
    { id: 'speak', commitsThrough: 'data_entry', voiceTool: 'handoff_specialist' },
  ];
}

export function commitOnboarding(door: OnboardingDoor, text: string): {
  agent: 'data_entry';
  dictionary: false;
  clinicalChain: false;
  text: string;
  socket: '/api/gemini/live-ws' | null;
} {
  return {
    agent: 'data_entry',
    dictionary: false,
    clinicalChain: false,
    text,
    socket: door === 'speak' ? '/api/gemini/live-ws' : null,
  };
}
