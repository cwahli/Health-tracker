/** Confirmed diary lines for the Home strip and the meal debug payload. */
import { homeStrip, type StripFact } from './homeStrip';

export function confirmedRecordFacts(profile: unknown): StripFact[] {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return [];
  const diaries = (profile as { symptomDiaries?: unknown }).symptomDiaries;
  if (!Array.isArray(diaries)) return [];
  const facts: StripFact[] = [];
  for (const diary of diaries) {
    if (!diary || typeof diary !== 'object') continue;
    const id = String((diary as { id?: unknown }).id || 'record');
    const events = (diary as { events?: unknown }).events;
    if (!Array.isArray(events)) continue;
    for (const event of events) {
      if (!event || typeof event !== 'object') continue;
      const cells = (event as { cells?: unknown }).cells;
      const text = Array.isArray(cells)
        ? cells.map((cell) => `${(cell as { columnId?: unknown }).columnId ?? ''} ${(cell as { value?: unknown }).value ?? ''}`).join(' ')
        : '';
      const blob = `${id} ${text}`.toLowerCase();
      const confirmed = (event as { confirmed?: unknown }).confirmed !== false;
      let label = id;
      if (blob.includes('hemorrhoid')) label = 'hemorrhoid diary';
      else if (/poor sleep|slept badly/.test(blob)) label = 'poor sleep';
      facts.push({ label, confirmed });
    }
  }
  return facts;
}

export function mealRecordPayload(profile: unknown): { facts: string[]; stagedLabNumbers: number[] } {
  return homeStrip({ facts: confirmedRecordFacts(profile) }).mealPayload;
}
