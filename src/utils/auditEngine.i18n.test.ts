import { describe, it, expect } from 'vitest';
import { runGeneralizedBiomarkerAudit } from './biomarkerAuditEngine';

const customBiomarkers = {
  test_marker_x: { name: 'Test Marker X', unit: '', normalRange: 'Unknown' }
};

describe('runGeneralizedBiomarkerAudit language', () => {
  it('keeps English fallback titles by default', () => {
    const report = runGeneralizedBiomarkerAudit(customBiomarkers, []);
    const item = report.items.find(i => i.key === 'test_marker_x');
    expect(item?.corruptedUnitProposal?.issueTitle).toContain('Missing Unit');
  });

  it('writes fallback titles in Indonesian for id', () => {
    const report = runGeneralizedBiomarkerAudit(customBiomarkers, [], {}, {}, 'id');
    const item = report.items.find(i => i.key === 'test_marker_x');
    expect(item?.corruptedUnitProposal?.issueTitle).toContain('Unit Tidak Spesifik atau Hilang');
    expect(item?.corruptedUnitProposal?.suggestedFix).toContain('Standarkan unit');
    expect(item?.corruptedUnitProposal?.issueTitle).not.toContain('Unspecified');
  });
});
