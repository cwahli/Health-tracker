import { ANALYTE_CONVERSIONS, specForAnalyte } from './analyteConversions';

export interface ConversionFactor {
  from: string;
  to: string;
  multiplier: number;
  decimals?: number;
}

export const CONVERSION_FACTORS: Record<string, ConversionFactor> = {
  hdl: { from: 'mg/dL', to: 'mmol/L', multiplier: 0.02586, decimals: 2 },
  ldl: { from: 'mg/dL', to: 'mmol/L', multiplier: 0.02586, decimals: 2 },
  total_cholesterol: { from: 'mg/dL', to: 'mmol/L', multiplier: 0.02586, decimals: 2 },
  non_hdl_cholesterol: { from: 'mg/dL', to: 'mmol/L', multiplier: 0.02586, decimals: 2 },
  vldl: { from: 'mg/dL', to: 'mmol/L', multiplier: 0.02586, decimals: 2 },
  triglycerides: { from: 'mg/dL', to: 'mmol/L', multiplier: 0.01129, decimals: 2 },
  fasting_glucose: { from: 'mg/dL', to: 'mmol/L', multiplier: 0.0555, decimals: 2 },
  glucose: { from: 'mg/dL', to: 'mmol/L', multiplier: 0.0555, decimals: 2 },
  creatinine: { from: 'mg/dL', to: 'umol/L', multiplier: 88.4, decimals: 1 },
  total_bilirubin: { from: 'mg/dL', to: 'umol/L', multiplier: 17.1, decimals: 1 },
  direct_bilirubin: { from: 'mg/dL', to: 'umol/L', multiplier: 17.1, decimals: 1 },
  bilirubin: { from: 'mg/dL', to: 'umol/L', multiplier: 17.1, decimals: 1 },
  hemoglobin: { from: 'g/dL', to: 'g/L', multiplier: 10, decimals: 1 },
  mean_corpuscular_hemoglobin_concentration: { from: 'g/dL', to: 'g/L', multiplier: 10, decimals: 1 },
  mchc: { from: 'g/dL', to: 'g/L', multiplier: 10, decimals: 1 },
  hematocrit: { from: '%', to: 'L/L', multiplier: 0.01, decimals: 3 },
  albumin: { from: 'g/dL', to: 'g/L', multiplier: 10, decimals: 1 },
  serum_albumin: { from: 'g/dL', to: 'g/L', multiplier: 10, decimals: 1 },
  total_protein: { from: 'g/dL', to: 'g/L', multiplier: 10, decimals: 1 },
  serum_globulin: { from: 'g/dL', to: 'g/L', multiplier: 10, decimals: 1 },
  globulin: { from: 'g/dL', to: 'g/L', multiplier: 10, decimals: 1 },
  uric_acid: { from: 'mg/dL', to: 'umol/L', multiplier: 59.48, decimals: 1 },
  calcium: { from: 'mg/dL', to: 'mmol/L', multiplier: 0.2495, decimals: 2 },
  serum_calcium: { from: 'mg/dL', to: 'mmol/L', multiplier: 0.2495, decimals: 2 },
  serum_adjusted_calcium: { from: 'mg/dL', to: 'mmol/L', multiplier: 0.2495, decimals: 2 },
  serum_inorganic_phosphate: { from: 'mg/dL', to: 'mmol/L', multiplier: 0.3229, decimals: 2 },
  phosphate: { from: 'mg/dL', to: 'mmol/L', multiplier: 0.3229, decimals: 2 },
};

export function standardizeUnit(
  key: string,
  value: number | string,
  unit?: string
): { newValue: number | string; standardizedUnit: string } {
  if (value === '' || value === null || value === undefined) {
    return { newValue: value, standardizedUnit: unit || '' };
  }
  const num = typeof value === 'number' ? value : parseFloat(String(value));
  if (isNaN(num)) return { newValue: value, standardizedUnit: unit || '' };

  const normKey = key.toLowerCase();
  const conv = CONVERSION_FACTORS[normKey];
  const u = (unit || '').toLowerCase().trim();

  if (conv && u === conv.from.toLowerCase()) {
    const converted = num * conv.multiplier;
    const rounded = conv.decimals !== undefined ? Number(converted.toFixed(conv.decimals)) : converted;
    return { newValue: rounded, standardizedUnit: conv.to };
  }

  return { newValue: value, standardizedUnit: unit || '' };
}

export function reverseStandardizeUnit(
  key: string,
  value: number | string,
  targetUnit?: string
): { newValue: number | string; newUnit: string } {
  if (value === '' || value === null || value === undefined) {
    return { newValue: value, newUnit: targetUnit || '' };
  }
  const num = typeof value === 'number' ? value : parseFloat(String(value));
  if (isNaN(num)) return { newValue: value, newUnit: targetUnit || '' };

  const normKey = key.toLowerCase();
  const conv = CONVERSION_FACTORS[normKey];
  const target = (targetUnit || '').toLowerCase().trim();

  if (conv && (target === conv.to.toLowerCase() || target === conv.from.toLowerCase() || !target)) {
    const reversed = num / conv.multiplier;
    const rounded = Number(reversed.toFixed(conv.decimals !== undefined ? conv.decimals : 2));
    return { newValue: rounded, newUnit: conv.from };
  }

  return { newValue: num, newUnit: targetUnit || '' };
}

export function formatNormalRange(
  key: string,
  normalRange: string,
  currentUnit: string,
  targetPreference: 'SI' | 'US'
): string {
  if (!normalRange || !normalRange.trim()) return normalRange;
  const normKey = key.toLowerCase();
  const conv = CONVERSION_FACTORS[normKey];
  if (!conv) return normalRange;

  const match = normalRange.match(/^([\d.]+)\s*-\s*([\d.]+)$/);
  if (!match) return normalRange;

  const low = parseFloat(match[1]);
  const high = parseFloat(match[2]);
  if (isNaN(low) || isNaN(high)) return normalRange;

  if (targetPreference === 'US') {
    // Current is SI, convert bounds to US (from)
    const newLow = Number((low / conv.multiplier).toFixed(conv.decimals || 1));
    const newHigh = Number((high / conv.multiplier).toFixed(conv.decimals || 1));
    return `${newLow} - ${newHigh}`;
  } else {
    return normalRange;
  }
}
