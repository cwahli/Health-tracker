/** Confirmed labs and symptom flags under Home Top targets. Staged pages stay off. */

export interface StripFact {
  label: string;
  confirmed: boolean;
  value?: number | string | null;
}

export function homeStrip(input: { facts: StripFact[] }): {
  lines: string[];
  mealPayload: { facts: string[]; stagedLabNumbers: number[] };
} {
  const lines = input.facts
    .filter((fact) => fact.confirmed)
    .map((fact) => (fact.value == null || fact.value === '' ? fact.label : `${fact.label}: ${fact.value}`));
  return { lines, mealPayload: { facts: lines, stagedLabNumbers: [] } };
}
