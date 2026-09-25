import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const matrixPath = path.join(process.cwd(), 'public', 'capability-matrix.html');
const matrix = fs.readFileSync(matrixPath, 'utf8');

function matrixClasses() {
  return Array.from(matrix.matchAll(/data-capability-class="([^"]+)"/g), (match) => match[1]);
}

describe('capability matrix', () => {
  it('uses the five registry classes in registry order', () => {
    expect(matrixClasses()).toEqual(['hermes', 'vps', 'mobile', 'grok_tg', 'collab']);
  });

  it('does not retain legacy class headers', () => {
    expect(matrix).not.toMatch(/<th[^>]*>\s*(?:OpenCode|Android|Chat)\s*<\/th>/i);
  });

  it('identifies the registry as its source', () => {
    expect(matrix).toContain('bots/capabilities.json');
  });
});
