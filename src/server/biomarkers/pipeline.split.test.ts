import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');

describe('pipeline catalog split', () => {
  it('does not keep a catalog hit or miss batch', () => {
    const pipeline = readFileSync(path.join(root, 'src/server/biomarkers/pipeline.ts'), 'utf8');
    const instruction = readFileSync(path.join(root, 'src/server/biomarkers/instruction.ts'), 'utf8');
    expect(pipeline).toContain('writeTarget: "observation"');
    expect(pipeline).toContain('const misses: any[] = []');
    expect(pipeline).not.toContain('catalog hits');
    expect(instruction).not.toContain('writeTarget="pending"');
  });
});
