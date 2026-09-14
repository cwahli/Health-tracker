export function getAgentCalibration(biomarkerKey: string) {
  try {
    const saved = localStorage.getItem('batch_analysis_results');
    if (saved) {
      const parsed = JSON.parse(saved);
      const batchKeys = Object.keys(parsed).sort((a, b) => Number(b) - Number(a));
      for (const bk of batchKeys) {
        const batch = parsed[bk];
        if (batch && Array.isArray(batch.reviewedBiomarkers)) {
          const found = batch.reviewedBiomarkers.find((bm: any) => bm.key === biomarkerKey);
          if (found) return found;
        }
      }
    }
  } catch (e) {
    console.error(e);
  }
  return null;
}

export function getAllAgentCalibrations(): Record<string, { specificRiskContext?: string; description?: string }> {
  const out: Record<string, { specificRiskContext?: string; description?: string }> = {};
  try {
    const saved = localStorage.getItem('batch_analysis_results');
    if (saved) {
      const parsed = JSON.parse(saved);
      const batchKeys = Object.keys(parsed).sort((a, b) => Number(a) - Number(b));
      for (const bk of batchKeys) {
        const batch = parsed[bk];
        if (batch && Array.isArray(batch.reviewedBiomarkers)) {
          batch.reviewedBiomarkers.forEach((bm: any) => {
            if (bm && bm.key && (bm.specificRiskContext || bm.description)) {
              out[bm.key] = { specificRiskContext: bm.specificRiskContext, description: bm.description };
            }
          });
        }
      }
    }
  } catch (e) {
    console.error(e);
  }
  return out;
}

// PERF: full-record variant of getAgentCalibration() for callers that need to
// look up MANY biomarker keys in the same render pass (e.g. rendering a list
// of biomarker cards). getAgentCalibration() re-reads + re-JSON.parses
// localStorage on every single call, which is fine for a one-off lookup but
// becomes a major main-thread bottleneck when called once per rendered item
// in a list. Callers should call this ONCE per render, then do O(1) lookups
// against the returned map (`records[key]`) instead of calling
// getAgentCalibration() per item. Keeps the same "most recent batch wins"
// precedence as getAgentCalibration(), and preserves the FULL bm object
// (including fields like optimalValue/unit that getAllAgentCalibrations()
// above does not carry).
export function getAllAgentCalibrationRecords(): Record<string, any> {
  const out: Record<string, any> = {};
  try {
    const saved = localStorage.getItem('batch_analysis_results');
    if (saved) {
      const parsed = JSON.parse(saved);
      const batchKeys = Object.keys(parsed).sort((a, b) => Number(a) - Number(b));
      for (const bk of batchKeys) {
        const batch = parsed[bk];
        if (batch && Array.isArray(batch.reviewedBiomarkers)) {
          batch.reviewedBiomarkers.forEach((bm: any) => {
            if (bm && bm.key) {
              out[bm.key] = bm;
            }
          });
        }
      }
    }
  } catch (e) {
    console.error(e);
  }
  return out;
}

export function formatOptimalTargetValue(bm: any): string {
  if (!bm) return '';
  const rawOpt = bm.optimalValue;
  const unit = (typeof bm.unit === 'string' && bm.unit.trim()) ? bm.unit.trim() : '';
  const unitSuffix = unit ? ` ${unit}` : '';

  if (rawOpt && typeof rawOpt === 'string' && rawOpt.trim() !== '') {
    const trimmed = rawOpt.trim();
    // If it's already a single value like "21.0 kg/m2", "21.0", "< 3.5", etc. (not a range "18.5 - 22.9" or "18.5-22.9")
    const isRange = trimmed.includes(' - ') || /\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?/.test(trimmed);
    if (!isRange) {
      return (trimmed.toLowerCase().includes(unit.toLowerCase()) || !unit) ? trimmed : `${trimmed}${unitSuffix}`;
    }
  }

  // If rawOpt is a range string or missing, compute the target midpoint from range
  const rangeStr = (typeof rawOpt === 'string' && rawOpt) || bm.profileAdjustedNormalRange || bm.normalRange || '';
  const numbers = rangeStr.match(/(\d+(?:\.\d+)?)/g);
  
  if (numbers && numbers.length >= 2) {
    const low = parseFloat(numbers[0]);
    const high = parseFloat(numbers[1]);
    if (!isNaN(low) && !isNaN(high) && high > low) {
      const mid = ((low + high) / 2);
      const formattedMid = Number.isInteger(mid) ? mid.toFixed(0) : mid.toFixed(1);
      return `${formattedMid}${unitSuffix}`;
    }
  } else if (numbers && numbers.length === 1) {
    const num = parseFloat(numbers[0]);
    if (!isNaN(num)) {
      if (rangeStr.includes('<')) {
        const target = (num * 0.85);
        const formatted = Number.isInteger(target) ? target.toFixed(0) : target.toFixed(1);
        return `< ${formatted}${unitSuffix}`;
      } else if (rangeStr.includes('>')) {
        const target = (num * 1.15);
        const formatted = Number.isInteger(target) ? target.toFixed(0) : target.toFixed(1);
        return `> ${formatted}${unitSuffix}`;
      }
    }
  }

  return rawOpt || rangeStr || '';
}

export function evaluateRangeBracketMatch(
  br: { name?: string; range?: string; lowerBound?: number; upperBound?: number; label?: string; min?: number; max?: number; severity?: string },
  userValue: any,
  status?: string,
  allBrackets?: any[]
): { isMatched: boolean; isOptimal: boolean; colorScheme: 'emerald' | 'rose' | 'amber' | 'slate' } {
  if (!br) return { isMatched: false, isOptimal: false, colorScheme: 'slate' };

  const brName = (br.name || br.label || '').toLowerCase();
  const brSeverity = (br.severity || '').toLowerCase();
  const isOptimal = (brName.includes('optimal') && !brName.includes('sub-optimal')) || brName.includes('healthy') || brName.includes('target') || brName.includes('normal') || brSeverity === 'normal' || brSeverity === 'optimal';
  const isActionZone = brName.includes('action zone') || brName.includes('sub-optimal') || brName.includes('mildly decreased');
  const isHigh = brName.includes('elevated') || brName.includes('high') || brName.includes('critical') || brName.includes('overweight') || brName.includes('at risk') || brSeverity === 'high' || brSeverity === 'critical';
  const isLow = brName.includes('low') || brName.includes('underweight') || brName.includes('decreased') || brSeverity === 'low';

  const strVal = userValue !== undefined && userValue !== null ? String(userValue).trim() : '';
  const numVal = parseFloat(strVal);
  const isNumeric = !isNaN(numVal) && !/^(positive|negative|normal|detected|not detected)$/i.test(strVal);

  let isMatched = false;

  if (isNumeric) {
    if (br.min !== undefined || br.max !== undefined) {
      isMatched = true;
      if (br.min !== null && br.min !== undefined && numVal < br.min) isMatched = false;
      if (br.max !== null && br.max !== undefined && numVal > br.max) isMatched = false;
    } else {
      const rangeStr = br.range || (br.lowerBound !== undefined ? `${br.lowerBound}-${br.upperBound}` : '');
      if (rangeStr) {
      const gteMatch = rangeStr.match(/>=\s*(\d+(?:\.\d+)?)/);
      const gtMatch = !gteMatch && rangeStr.match(/>\s*(\d+(?:\.\d+)?)/);
      const lteMatch = rangeStr.match(/<=\s*(\d+(?:\.\d+)?)/);
      const ltMatch = !lteMatch && rangeStr.match(/<\s*(\d+(?:\.\d+)?)/);
      const rangeBoundsMatch = rangeStr.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/);

      if (gteMatch) {
        const threshold = parseFloat(gteMatch[1]);
        if (!isNaN(threshold) && numVal >= threshold) isMatched = true;
      } else if (gtMatch) {
        const threshold = parseFloat(gtMatch[1]);
        if (!isNaN(threshold) && numVal > threshold) isMatched = true;
      } else if (lteMatch) {
        const threshold = parseFloat(lteMatch[1]);
        if (!isNaN(threshold) && numVal <= threshold) isMatched = true;
      } else if (ltMatch) {
        const threshold = parseFloat(ltMatch[1]);
        if (!isNaN(threshold) && numVal < threshold) isMatched = true;
      } else if (rangeBoundsMatch) {
        const low = parseFloat(rangeBoundsMatch[1]);
        const high = parseFloat(rangeBoundsMatch[2]);
        if (!isNaN(low) && !isNaN(high) && numVal >= low && numVal <= high) isMatched = true;
      }
    }
    }
  } else if (strVal) {
    const rangeStr = (br.range || '').toLowerCase();
    if (rangeStr.includes(strVal.toLowerCase()) || brName.includes(strVal.toLowerCase())) {
      isMatched = true;
    }
  }

  if (!isMatched && status && Array.isArray(allBrackets) && allBrackets.length > 0) {
    const isAtRiskStatus = status.toLowerCase().includes('risk') || status.toLowerCase().includes('high');
    const isActionZoneStatus = status.toLowerCase().includes('action zone') || status.toLowerCase().includes('sub-optimal');
    const isOptimalStatus = !isAtRiskStatus && !isActionZoneStatus;

    if (isAtRiskStatus && !isOptimal && !isActionZone) {
      if (isHigh && numVal > 0) {
        const optB = allBrackets.find((b: any) => (b.name || '').toLowerCase().includes('optimal') || (b.name || '').toLowerCase().includes('healthy'));
        if (optB && optB.range) {
          const numbers = optB.range.match(/(\d+(?:\.\d+)?)/g);
          if (numbers && numbers.length >= 2) {
            const highBound = parseFloat(numbers[1]);
            if (!isNaN(highBound) && numVal > highBound) isMatched = true;
          }
        }
      } else if (isLow && numVal > 0) {
        const optB = allBrackets.find((b: any) => (b.name || '').toLowerCase().includes('optimal') || (b.name || '').toLowerCase().includes('healthy'));
        if (optB && optB.range) {
          const numbers = optB.range.match(/(\d+(?:\.\d+)?)/g);
          if (numbers && numbers.length >= 1) {
            const lowBound = parseFloat(numbers[0]);
            if (!isNaN(lowBound) && numVal < lowBound) isMatched = true;
          }
        }
      }
    } else if (isActionZoneStatus && isActionZone) {
      isMatched = true;
    } else if (isOptimalStatus && isOptimal) {
      isMatched = true;
    }
  }

  let colorScheme: 'emerald' | 'rose' | 'amber' | 'slate' = 'slate';
  if (isMatched) {
    if (isOptimal) colorScheme = 'emerald';
    else if (isActionZone) colorScheme = 'amber';
    else if (isHigh) colorScheme = 'rose';
    else if (isLow) colorScheme = 'amber';
    else colorScheme = 'rose';
  }

  return { isMatched, isOptimal, colorScheme };
}
