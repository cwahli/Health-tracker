/**
 * Seven biomarker agents in one modal.
 * Ids stay for storage; `task` selects the instruction pack.
 * Opposite write-laws must never share one prompt.
 */

export const CANONICAL_SEVEN = [
  'front_desk',
  'agent1',
  'biomarker_review',
  'catalog_clean',
  'data_review',
  'health_baseline',
  'agent4',
] as const;

export type CanonicalBiomarkerAgent = (typeof CANONICAL_SEVEN)[number];

export type BiomarkerAgentTask =
  | 'route'
  | 'lab_extract'
  | 'symptom_diary'
  | 'fix'
  | 'compare'
  | 'units'
  | 'category'
  | 'aliases'
  | 'default_range'
  | 'overlay'
  | 'targets'
  | 'today'
  | 'gaps'
  | 'literature';

/** Retired chat destinations → canonical owner. */
export const RETIRED_AGENT_REDIRECT: Record<string, string> = {
  medical_extract: 'agent1',
  medical: 'agent1',
  lab_extract: 'agent1',
  agent1_step1: 'agent1',
  agent2: 'catalog_clean',
  agent3: 'catalog_clean',
  medical_categorise: 'catalog_clean',
  name_consolidation: 'catalog_clean',
  consolidate_names: 'catalog_clean',
  standardize_units: 'catalog_clean',
  standardize: 'catalog_clean',
  calibrate_ranges: 'catalog_clean',
  agent5: 'data_review',
  daily_recommendation: 'health_baseline',
  agent6: 'health_baseline',
  agent7: 'agent4',
  data_accuracy: 'biomarker_review',
};

export const DEFAULT_TASK: Record<string, BiomarkerAgentTask> = {
  front_desk: 'route',
  agent1: 'lab_extract',
  biomarker_review: 'fix',
  catalog_clean: 'category',
  data_review: 'overlay',
  health_baseline: 'targets',
  agent4: 'gaps',
};

export const TASK_FOR_ALIAS: Record<string, BiomarkerAgentTask> = {
  lab_extract: 'lab_extract',
  symptom_diary: 'symptom_diary',
  agent2: 'category',
  medical_categorise: 'category',
  agent3: 'aliases',
  name_consolidation: 'aliases',
  consolidate_names: 'aliases',
  standardize_units: 'units',
  standardize: 'units',
  calibrate_ranges: 'default_range',
  data_accuracy: 'compare',
  daily_recommendation: 'today',
  agent6: 'targets',
  agent7: 'literature',
  agent5: 'overlay',
};

/** Packs whose write-laws oppose each other — never concatenate. */
export const OPPOSITE_PACK_PAIRS: Array<[string, string]> = [
  ['agent1:lab_extract', 'biomarker_review:fix'],
  ['agent1:lab_extract', 'data_review:overlay'],
  ['agent1:lab_extract', 'catalog_clean:units'],
  ['biomarker_review:fix', 'data_review:overlay'],
  ['catalog_clean:units', 'biomarker_review:fix'],
  ['catalog_clean:default_range', 'data_review:overlay'],
  ['catalog_clean:category', 'agent1:lab_extract'],
];

export interface SelectedBiomarkerPack {
  agentType: string;
  task: BiomarkerAgentTask;
  packId: string;
}

export function selectBiomarkerAgentPack(
  agentType: string | null | undefined,
  task?: string | null
): SelectedBiomarkerPack | null {
  if (!agentType) return null;
  const canonical = RETIRED_AGENT_REDIRECT[agentType] || agentType;
  const resolvedTask = (task as BiomarkerAgentTask)
    || TASK_FOR_ALIAS[agentType]
    || DEFAULT_TASK[canonical]
    || 'fix';
  return {
    agentType: canonical,
    task: resolvedTask,
    packId: `${canonical}:${resolvedTask}`,
  };
}

export function packsAreConcatenated(packIds: string[]): boolean {
  const set = new Set(packIds);
  return OPPOSITE_PACK_PAIRS.some(([a, b]) => set.has(a) && set.has(b));
}

export function catalogEndpointForTask(task: BiomarkerAgentTask): string | null {
  switch (task) {
    case 'units':
      return '/api/gemini/standardize-units';
    case 'category':
      return '/api/gemini/medical-categorise';
    case 'aliases':
      return '/api/gemini/consolidate-names';
    case 'default_range':
      return '/api/gemini/calibrate-reference-ranges';
    default:
      return null;
  }
}

export function reviewChunkSize(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(Math.max(Math.floor(n), 1), 5);
}

export function specialistChunkSize(): number {
  return 20;
}

export interface WiredBiomarkerRequest {
  endpoint: string;
  wireAgentType: string;
  pack: SelectedBiomarkerPack;
  usesSelectedBiomarkers: boolean;
}

/**
 * Id + endpoint LogChat / medical-analyze actually understand.
 * Canonical names are for the picker; this is the live wire so nothing 404s or hits the wrong pack.
 */
export function liveChatAgentType(agentType: string | null | undefined, task?: string | null): string | null {
  const wired = wireBiomarkerRequest(agentType, task);
  return wired?.wireAgentType ?? null;
}

export function wireBiomarkerRequest(
  agentType: string | null | undefined,
  task?: string | null
): WiredBiomarkerRequest | null {
  const pack = selectBiomarkerAgentPack(agentType, task);
  if (!pack) return null;

  switch (pack.packId) {
    case 'front_desk:route':
      return { endpoint: '/api/gemini/front-desk', wireAgentType: 'front_desk', pack, usesSelectedBiomarkers: false };
    case 'agent1:lab_extract':
    case 'agent1:symptom_diary':
      return { endpoint: '/api/gemini/medical-analyze', wireAgentType: 'agent1', pack, usesSelectedBiomarkers: false };
    case 'biomarker_review:fix':
      return { endpoint: '/api/gemini/medical-analyze', wireAgentType: 'biomarker_review', pack, usesSelectedBiomarkers: false };
    case 'biomarker_review:compare':
      return { endpoint: '/api/gemini/data-accuracy', wireAgentType: 'biomarker_review', pack, usesSelectedBiomarkers: false };
    case 'catalog_clean:units':
      return { endpoint: '/api/gemini/standardize-units', wireAgentType: 'catalog_clean', pack, usesSelectedBiomarkers: true };
    case 'catalog_clean:category':
      return { endpoint: '/api/gemini/medical-analyze', wireAgentType: 'agent2', pack, usesSelectedBiomarkers: false };
    case 'catalog_clean:aliases':
      return { endpoint: '/api/gemini/medical-analyze', wireAgentType: 'agent3', pack, usesSelectedBiomarkers: false };
    case 'catalog_clean:default_range':
      return { endpoint: '/api/gemini/calibrate-reference-ranges', wireAgentType: 'catalog_clean', pack, usesSelectedBiomarkers: true };
    case 'data_review:overlay':
      return { endpoint: '/api/gemini/medical-analyze', wireAgentType: 'data_review', pack, usesSelectedBiomarkers: false };
    case 'health_baseline:targets':
      return { endpoint: '/api/gemini/health-baseline-analyze', wireAgentType: 'health_baseline', pack, usesSelectedBiomarkers: false };
    case 'health_baseline:today':
      return { endpoint: '/api/gemini/daily-recommendation-chat', wireAgentType: 'health_baseline', pack, usesSelectedBiomarkers: false };
    case 'agent4:gaps':
      return { endpoint: '/api/gemini/medical-analyze', wireAgentType: 'agent4', pack, usesSelectedBiomarkers: false };
    case 'agent4:literature':
      return { endpoint: '/api/gemini/medical-analyze', wireAgentType: 'agent7', pack, usesSelectedBiomarkers: false };
    default:
      return { endpoint: '/api/gemini/medical-analyze', wireAgentType: pack.agentType, pack, usesSelectedBiomarkers: false };
  }
}

/** Apply-hub id so onAgentFinish does not drop catalog / literature / coach results. */
export function applyAgentType(agentType: string | null | undefined, task?: string | null): string | null {
  const pack = selectBiomarkerAgentPack(agentType, task);
  if (!pack) return agentType || null;
  if (pack.agentType === 'catalog_clean' && pack.task === 'category') return 'agent2';
  if (pack.agentType === 'catalog_clean' && pack.task === 'aliases') return 'agent3';
  if (pack.agentType === 'agent4' && pack.task === 'literature') return 'agent7';
  if (pack.agentType === 'data_review') return 'data_review';
  return pack.agentType;
}
