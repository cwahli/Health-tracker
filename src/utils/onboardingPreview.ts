/** Blank-profile preview. This does not write the log table. */
import { parseProse, projectHistoryScreen } from './healthRecord';

export function previewOnboardingHistory(numberText: string, sleepText: string): {
  tracked: number;
  logEntries: number;
  showsNumber: boolean;
  showsSleep: boolean;
} {
  const labs = parseProse(numberText);
  const sleep = parseProse(sleepText);
  const current: Record<string, number> = {};
  for (const row of labs) {
    if (row.analyteKey && row.numericValue != null) current[row.analyteKey] = row.numericValue;
  }
  const screen = projectHistoryScreen({
    current,
    symptomEvents: sleep
      .filter((row) => row.kind === 'symptom')
      .map((row) => ({ cells: [{ columnId: 'note', value: row.textValue }], confirmed: true })),
  });
  return {
    tracked: screen.tracked,
    logEntries: screen.logEntries,
    showsNumber: screen.tracked >= 1,
    showsSleep: screen.logEntries >= 1,
  };
}
