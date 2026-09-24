import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  PROFILES,
  BUDGETS,
  lineCount,
  composeSoul,
  checkSoul,
  writeSouls,
  soulTarget,
} from '../scripts/lib/soul-compose.mjs';

const BOTS = path.join(__dirname, '..', 'bots');

describe('budgets', () => {
  it('locks the budget constants', () => {
    expect(BUDGETS).toEqual({ base: 12, capabilities: 4, override: 16, total: 34 });
  });

  it('counts lines without the trailing newline', () => {
    expect(lineCount('a\nb\n')).toBe(2);
    expect(lineCount('a')).toBe(1);
  });

  it('every repo profile composes within budget', () => {
    expect(checkSoul(null, { dir: BOTS })).toEqual({ ok: true, violations: [] });
  });
});

describe('composeSoul', () => {
  it('layers base, capability lines, then override in order', () => {
    const text = composeSoul('orchestrator', { dir: BOTS });
    const baseIdx = text.indexOf('Three laws every bot obeys');
    const capIdx = text.indexOf('You preload only the orchestrator-dispatcher skill.');
    const overIdx = text.indexOf('# Orchestrator');
    expect(baseIdx).toBeGreaterThanOrEqual(0);
    expect(capIdx).toBeGreaterThan(baseIdx);
    expect(overIdx).toBeGreaterThan(capIdx);
  });

  it('omits the capability layer cleanly when empty', () => {
    const text = composeSoul('default', { dir: BOTS });
    expect(text).toContain('Three laws every bot obeys');
    expect(text).toContain('# Health-tracker default bot');
    expect(text).not.toContain('\n\n\n');
  });

  it('rejects unknown profiles', () => {
    expect(() => composeSoul('nope', { dir: BOTS })).toThrow(/unknown profile/);
  });

  it('reports every budget violation instead of writing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soulbad-'));
    fs.writeFileSync(path.join(dir, 'soul.md'), `${'x\n'.repeat(13)}`);
    fs.writeFileSync(path.join(dir, 'soul-capabilities.json'), JSON.stringify({ profiles: { default: [] } }));
    fs.writeFileSync(path.join(dir, 'soul.default.md'), '# D\nbody\n');
    const res = checkSoul('default', { dir });
    expect(res.ok).toBe(false);
    expect(res.violations.join(' ')).toMatch(/base 13 lines exceeds 12/);
  });
});

describe('writeSouls', () => {
  let home;
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'soulhome-'));
  });

  it('writes the global soul and every profile soul', () => {
    const written = writeSouls({ home, dir: BOTS });
    expect(written.length).toBe(PROFILES.length);
    expect(fs.readFileSync(soulTarget('default', home), 'utf8'))
      .toBe(composeSoul('default', { dir: BOTS }));
    expect(fs.readFileSync(soulTarget('qa_meal', home), 'utf8'))
      .toContain('Write four lines: page, observed, expected, screenshot path.');
  });

  it('refuses to write when any profile is over budget', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soulbad-'));
    fs.writeFileSync(path.join(dir, 'soul.md'), '# base\n');
    fs.writeFileSync(path.join(dir, 'soul-capabilities.json'), JSON.stringify({ profiles: { default: [] } }));
    fs.writeFileSync(path.join(dir, 'soul.default.md'), `${'x\n'.repeat(17)}`);
    expect(() => writeSouls({ home, dir })).toThrow(/budget violated/);
    expect(fs.existsSync(soulTarget('default', home))).toBe(false);
  });
});
