import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const insights = readFileSync(path.join(root, 'src/components/InsightsTab.tsx'), 'utf8');

describe('insights offer', () => {
  it('offers add-health-data, the coach, and literature', () => {
    expect(insights).toContain(".filter((step) => step.id === 'add_health_data' || step.id === 'health_baseline' || step.id === 'agent7')");
    expect(insights).toContain('const onDemand = step.id === \'health_baseline\' || step.id === \'agent7\'');
  });

  it('does not open the dictionary modal', () => {
    expect(insights).toContain('false && showDictionaryModal');
    expect(insights).not.toContain('setShowDictionaryModal(true)');
  });
});
