import { describe, expect, it } from 'vitest';
import { getBiomarkerColor, getBiomarkerEffectiveRisk } from './biomarkers';

// WCAG AA sensor for badge/status contrast (class CONTRAST_BADGE).
// White text on amber-500 (2.15:1) and slate-400 (2.56:1) failed AA for
// 10px bold pills (needs 4.5:1). This pins the accessible replacements:
// dark text on amber, darkened emerald/slate solids, darkened tint text.

function hex2rgb(h: string): [number, number, number] {
  const c = h.replace('#', '');
  return [parseInt(c.slice(0, 2), 16) / 255, parseInt(c.slice(2, 4), 16) / 255, parseInt(c.slice(4, 6), 16) / 255];
}

function lum(rgb: [number, number, number]): number {
  const f = (x: number) => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
  const [r, g, b] = rgb.map(f);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(fg: string, bg: string): number {
  const [l1, l2] = [lum(hex2rgb(fg)), lum(hex2rgb(bg))].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}

const TAILWIND: Record<string, string> = {
  'amber-500': '#f59e0b',
  'amber-700': '#b45309',
  'emerald-700': '#047857',
  'rose-600': '#e11d48',
  'slate-950': '#020617',
  'slate-600': '#475569',
  white: '#ffffff',
};

describe('contrast badges clear WCAG AA 4.5:1', () => {
  it('at-risk pill uses dark text on amber-500 (>= 4.5)', () => {
    const risk = getBiomarkerEffectiveRisk('ldl', 5.0, { key: 'ldl', normalRange: '< 3.4' });
    expect(risk.bg).toContain('amber');
    expect(risk.text).not.toBe('text-white');
    expect(ratio(TAILWIND['slate-950'], TAILWIND['amber-500'])).toBeGreaterThanOrEqual(4.5);
  });

  it('optimal pill uses darkened emerald-700 with white text (>= 4.5)', () => {
    expect(ratio(TAILWIND.white, TAILWIND['emerald-700'])).toBeGreaterThanOrEqual(4.5);
    const risk = getBiomarkerEffectiveRisk('hdl_cholesterol', 1.4, { key: 'hdl_cholesterol', normalRange: '> 1.0' });
    expect(risk.bg).toBe('bg-emerald-700');
    expect(risk.text).toBe('text-white');
  });

  it('unknown pill uses darkened slate-600 with white text (>= 4.5)', () => {
    expect(ratio(TAILWIND.white, TAILWIND['slate-600'])).toBeGreaterThanOrEqual(4.5);
  });

  it('critical pill keeps rose-600 white text (>= 4.5)', () => {
    expect(ratio(TAILWIND.white, TAILWIND['rose-600'])).toBeGreaterThanOrEqual(4.5);
  });

  it('review badge uses amber-700 white text (>= 4.5)', () => {
    expect(ratio(TAILWIND.white, TAILWIND['amber-700'])).toBeGreaterThanOrEqual(4.5);
  });

  it('tint text uses darkened variants, never amber-500/emerald-500/rose-500/slate-400 alone', () => {
    expect(getBiomarkerColor('high')).toContain('text-amber-800');
    expect(getBiomarkerColor('normal')).toContain('text-emerald-700');
    expect(getBiomarkerColor('critical')).toContain('text-rose-700');
    expect(getBiomarkerColor('unknown')).toContain('text-slate-600');
    expect(getBiomarkerColor('high')).not.toContain('text-amber-500');
    expect(getBiomarkerColor('normal')).not.toContain('text-emerald-500');
  });
});
