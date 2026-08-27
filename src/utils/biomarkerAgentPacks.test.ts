import { describe, expect, it } from 'vitest';
import {
  CANONICAL_SEVEN,
  applyAgentType,
  liveChatAgentType,
  packsAreConcatenated,
  reviewChunkSize,
  selectBiomarkerAgentPack,
  specialistChunkSize,
  wireBiomarkerRequest,
} from './biomarkerAgentPacks';

describe('selectBiomarkerAgentPack', () => {
  it('maps n=1 add/fix onto Review', () => {
    const pack = selectBiomarkerAgentPack('biomarker_review');
    expect(pack?.agentType).toBe('biomarker_review');
    expect(pack?.task).toBe('fix');
    expect(pack?.packId).toBe('biomarker_review:fix');
  });

  it('maps leftover extract onto Lab Parser', () => {
    const pack = selectBiomarkerAgentPack('medical_extract');
    expect(pack?.agentType).toBe('agent1');
    expect(pack?.task).toBe('lab_extract');
  });

  it('maps overlay-stale onto Range Calibrator', () => {
    const pack = selectBiomarkerAgentPack('agent5');
    expect(pack?.agentType).toBe('data_review');
    expect(pack?.task).toBe('overlay');
  });

  it('maps hygiene specialists onto Catalog Cleaner one task', () => {
    expect(selectBiomarkerAgentPack('catalog_clean')?.packId).toBe('catalog_clean:category');
    expect(selectBiomarkerAgentPack('agent2')?.packId).toBe('catalog_clean:category');
    expect(selectBiomarkerAgentPack('agent3')?.packId).toBe('catalog_clean:aliases');
    expect(selectBiomarkerAgentPack('standardize_units')?.packId).toBe('catalog_clean:units');
    expect(selectBiomarkerAgentPack('calibrate_ranges')?.packId).toBe('catalog_clean:default_range');
  });

  it('folds Daily Actions and literature onto Coach / Planner modes', () => {
    expect(selectBiomarkerAgentPack('daily_recommendation')?.packId).toBe('health_baseline:today');
    expect(selectBiomarkerAgentPack('agent7')?.packId).toBe('agent4:literature');
    expect(selectBiomarkerAgentPack('data_accuracy')?.packId).toBe('biomarker_review:compare');
  });

  it('keeps the picker at seven canonical ids', () => {
    expect(CANONICAL_SEVEN).toEqual([
      'front_desk',
      'agent1',
      'biomarker_review',
      'catalog_clean',
      'data_review',
      'health_baseline',
      'agent4',
    ]);
  });
});

describe('packsAreConcatenated', () => {
  it('forbids Parser extract concatenated with Review convert or Calibrator overlay', () => {
    expect(packsAreConcatenated(['agent1:lab_extract', 'biomarker_review:fix'])).toBe(true);
    expect(packsAreConcatenated(['agent1:lab_extract', 'data_review:overlay'])).toBe(true);
    expect(packsAreConcatenated(['catalog_clean:default_range', 'data_review:overlay'])).toBe(true);
  });

  it('allows a single pack per run', () => {
    expect(packsAreConcatenated(['biomarker_review:fix'])).toBe(false);
    expect(packsAreConcatenated(['catalog_clean:units', 'catalog_clean:units'])).toBe(false);
  });
});

describe('liveChatAgentType / wireBiomarkerRequest', () => {
  it('keeps Literature on the agent7 medical-analyze pack', () => {
    expect(liveChatAgentType('agent7')).toBe('agent7');
    expect(wireBiomarkerRequest('agent7')?.endpoint).toBe('/api/gemini/medical-analyze');
    expect(applyAgentType('agent7')).toBe('agent7');
  });

  it('keeps Catalog category/aliases on agent2/agent3 analyze packs', () => {
    expect(liveChatAgentType('agent2')).toBe('agent2');
    expect(liveChatAgentType('agent3')).toBe('agent3');
    expect(liveChatAgentType('catalog_clean')).toBe('agent2');
    expect(liveChatAgentType('catalog_clean', 'category')).toBe('agent2');
  });

  it('sends units and default_range to catalog REST endpoints', () => {
    expect(wireBiomarkerRequest('standardize_units')?.endpoint).toBe('/api/gemini/standardize-units');
    expect(wireBiomarkerRequest('calibrate_ranges')?.endpoint).toBe('/api/gemini/calibrate-reference-ranges');
    expect(wireBiomarkerRequest('catalog_clean', 'units')?.usesSelectedBiomarkers).toBe(true);
  });

  it('routes Review compare to data-accuracy and Coach today to daily-recommendation', () => {
    expect(wireBiomarkerRequest('data_accuracy')?.endpoint).toBe('/api/gemini/data-accuracy');
    expect(wireBiomarkerRequest('daily_recommendation')?.endpoint).toBe('/api/gemini/daily-recommendation-chat');
    expect(liveChatAgentType('data_accuracy')).toBe('biomarker_review');
  });

  it('does not send Front Desk, Parser, or Calibrator to a dead id', () => {
    expect(liveChatAgentType('front_desk')).toBe('front_desk');
    expect(liveChatAgentType('medical_extract')).toBe('agent1');
    expect(liveChatAgentType('agent5')).toBe('data_review');
    expect(liveChatAgentType(null)).toBe(null);
  });
});

describe('chunk sizes', () => {
  it('caps Review at 1–5', () => {
    expect(reviewChunkSize(1)).toBe(1);
    expect(reviewChunkSize(12)).toBe(5);
  });

  it('uses ~20 for specialist leftovers', () => {
    expect(specialistChunkSize()).toBe(20);
  });
});
