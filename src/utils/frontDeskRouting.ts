/**
 * Front Desk orchestrator routing.
 *
 * Specialists stay independently callable (Health tab, FAB). When Front Desk
 * hands off, the same specialist is appended as a named turn in the Front Desk
 * thread — it is not rewritten to Health Coach.
 */

export type FrontDeskSpecialist = 'health_baseline' | 'medical' | 'food' | 'food_idea' | 'food_compare' | 'agent7' | 'agent4';

const STUB_UTTERANCE =
  /^(i want|i'd like|i would like|help|please help|hello|hi|hey|ok|okay|yes|yeah|yep|no|hmm+|um+|uh+|apa|halo)\.?$/i;

const COACH_INTENTS = new Set(['weight_loss', 'muscle_gain', 'health_improvement']);
const MEDICAL_INTENTS = new Set(['biomarker_review', 'add_health_data']);
const COACH_AGENTS = new Set(['health_coach', 'coach', 'fitness_specialist']);
const MEDICAL_AGENTS = new Set(['medical', 'biomarker_review', 'biomarker_specialist']);
const RECEPTIONIST_AGENTS = new Set(['general_receptionist', 'unknown']);

export function isUnderspecifiedUtterance(msg?: string | null): boolean {
  const t = String(msg || '').trim();
  if (!t) return true;
  if (STUB_UTTERANCE.test(t)) return true;
  if (t.length < 8 && !/(weight|healthy|lab|biomarker|meal|eat|cholesterol|plan|improve|test)/i.test(t)) {
    return true;
  }
  return false;
}

export function isRoutableSpecialistIntent(intent?: string | null, targetAgent?: string | null): boolean {
  const agent = String(targetAgent || '');
  const intentKey = String(intent || '');
  if (RECEPTIONIST_AGENTS.has(agent) || agent === 'general_receptionist') return false;
  if (intentKey === 'profile_update' || intentKey === 'general_inquiry' || intentKey === 'unknown') return false;
  // Vague wellness stays at Front Desk until the user names a specialist job.
  if (intentKey === 'general_wellness') return false;
  if (agent === 'agent4' || intentKey === 'test_planning') return true;
  if (agent === 'agent7' || intentKey === 'literature_review') return true;
  if (agent === 'food_compare' || intentKey === 'compare_meal') return true;
  if (COACH_INTENTS.has(intentKey) && (COACH_AGENTS.has(agent) || !agent)) return true;
  if (MEDICAL_INTENTS.has(intentKey) && (MEDICAL_AGENTS.has(agent) || !agent)) return true;
  if (intentKey === 'meal_logging') return true;
  if (COACH_AGENTS.has(agent) && COACH_INTENTS.has(intentKey)) return true;
  if (MEDICAL_AGENTS.has(agent)) return true;
  if (agent === 'nutritionist') return true;
  return false;
}

export function mapFrontDeskSpecialist(
  targetAgent?: string | null,
  intent?: string | null
): FrontDeskSpecialist | null {
  const agent = String(targetAgent || '');
  const intentKey = String(intent || '');
  if (!agent && !intentKey) return null;
  if (agent === 'general_receptionist' || RECEPTIONIST_AGENTS.has(agent)) return null;
  if (agent === 'agent4' || intentKey === 'test_planning') return 'agent4';
  if (agent === 'agent7' || intentKey === 'literature_review') return 'agent7';
  if (agent === 'food_compare' || intentKey === 'compare_meal') return 'food_compare';
  if (MEDICAL_AGENTS.has(agent) || MEDICAL_INTENTS.has(intentKey)) return 'medical';
  if (intentKey === 'meal_logging') return 'food';
  if (agent === 'nutritionist') return 'food_idea';
  if (COACH_AGENTS.has(agent) || COACH_INTENTS.has(intentKey)) return 'health_baseline';
  return null;
}

/** A file, a photo batch, a PDF, or a sleep sentence goes to data entry. */
export function routeIncomingRecord(input: {
  text?: string;
  fileCount?: number;
  photoCount?: number;
  pdfCount?: number;
}): 'data_entry' | null {
  const text = (input.text || '').trim();
  if (/slept badly/i.test(text)) return 'data_entry';
  if ((input.fileCount || 0) > 0 || (input.photoCount || 0) > 0 || (input.pdfCount || 0) > 0) return 'data_entry';
  if (text) return 'data_entry';
  return null;
}

export function specialistDisplayName(target: FrontDeskSpecialist | string): string {
  if (target === 'medical' || target === 'biomarker_review') return 'Medical Lab Specialist';
  if (target === 'food') return 'Food & Nutrition Agent';
  if (target === 'food_idea') return 'Culinary Ideation Agent';
  if (target === 'agent4') return 'Test Planner Agent';
  if (target === 'agent7') return 'Literature Consensus Agent';
  if (target === 'food_compare') return 'Meal Comparison Agent';
  return 'Health Coach';
}
