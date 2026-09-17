import { biomarkerDefinitions } from '../utils/biomarkers';

// Robust helper to extract potential biomarker names and values from raw clinical text
export function getInitialMarkersFromText(text: string): string[] {
  if (!text) return [];
  const lines = text.split(/[\n;\r]/);
  const markers: string[] = [];
  
  for (let line of lines) {
    line = line.trim();
    // Ignore lines that are too long, likely general conversation paragraphs
    if (!line || line.length > 120) continue;
    
    // Look for lines containing letters and at least one number
    const hasLetters = /[a-zA-Z]/.test(line);
    const hasNumbers = /\d/.test(line);
    
    if (hasLetters && hasNumbers) {
      const colonIndex = line.indexOf(':');
      const dashIndex = line.indexOf('-');
      let nameCandidate = '';
      
      if (colonIndex > 0) {
        nameCandidate = line.substring(0, colonIndex).trim();
      } else if (dashIndex > 0 && isNaN(Number(line.charAt(dashIndex - 1))) && isNaN(Number(line.charAt(dashIndex + 1)))) {
        nameCandidate = line.substring(0, dashIndex).trim();
      } else {
        const numberMatch = line.match(/\d/);
        if (numberMatch && numberMatch.index !== undefined && numberMatch.index > 0) {
          nameCandidate = line.substring(0, numberMatch.index).trim();
        }
      }
      
      const cleanName = nameCandidate.replace(/[^a-zA-Z0-9\s()]/g, '').trim();
      if (cleanName && cleanName.length > 2 && !cleanName.toLowerCase().includes('http') && !cleanName.toLowerCase().includes('date')) {
        markers.push(cleanName);
      }
    }
  }
  return Array.from(new Set(markers)); // unique list
}

export function getInitialMarkerDetails(text: string): { biomarker: string; value: string; unit: string; date: string }[] {
  const markerNames = getInitialMarkersFromText(text);
  if (markerNames.length === 0) return [];

  // Try to find a date in the overall text
  let detectedDate = '';
  const dateRegex = /\b(\d{4}-\d{2}-\d{2}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/;
  const dateMatch = text.match(dateRegex);
  if (dateMatch) {
    detectedDate = dateMatch[1];
  } else {
    detectedDate = new Date().toISOString().split('T')[0];
  }

  return markerNames.map(name => {
    // Search for the line containing this name to extract value and unit
    const lines = text.split(/[\n;\r]/);
    let value = 'N/A';
    let unit = '';

    for (let line of lines) {
      if (line.toLowerCase().includes(name.toLowerCase())) {
        // Try to extract numeric value from the rest of the line or the line itself
        const numericMatch = line.match(/[\s:]\+?(-?[\d.]+)/) || line.match(/([\d.]+)/);
        if (numericMatch) {
          value = numericMatch[1];
          // Try to extract unit following the number
          const afterNumber = line.substring(numericMatch.index! + numericMatch[0].length).trim();
          const unitMatch = afterNumber.match(/^([a-zA-Z\/%]+)/);
          if (unitMatch) {
            unit = unitMatch[1];
          }
          break;
        }
      }
    }

    return {
      biomarker: name,
      value,
      unit,
      date: detectedDate
    };
  });
}

export function generateSafeKey(name: string): string {
  if (!name) return '';
  const cleanName = name.split('(')[0].split('[')[0].trim();
  return cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}


export const resolveBiomarkerKey = (rawKey: string, rawName: string, profile: any) => {
  const cleanName = (n: string): string => n.split('(')[0].split('[')[0].trim();
  const cleaned = cleanName(String(rawName || rawKey));
  const safeKey = cleaned.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  let key = rawKey || safeKey;
  
  const currentCustoms = profile?.customBiomarkers || {};
  let targetKey = key;
  
  const stdMatch = !currentCustoms[key] ? biomarkerDefinitions.find(d => {
    const nameMatch = d.name.toLowerCase() === cleaned.toLowerCase() || d.key.toLowerCase() === cleaned.toLowerCase() || cleanName(d.name).toLowerCase() === cleaned.toLowerCase();
    return nameMatch;
  }) : null;
  
  if (stdMatch) {
    targetKey = stdMatch.key;
  } else {
    let existingKey = Object.keys(currentCustoms).find(k => {
      const nameMatch = cleanName(currentCustoms[k]?.name || '').toLowerCase() === cleaned.toLowerCase();
      const keyMatch = k.toLowerCase() === cleaned.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      return nameMatch || keyMatch;
    });
    if (existingKey) {
      targetKey = existingKey;
    }
  }
  return targetKey;
};

export function sanitizeUnitText(rawUnit: any): string {
  if (!rawUnit) return '';
  return String(rawUnit)
    .toLowerCase()
    .replace(/[\s]+/g, ' ')
    .replace(/²/g, '2')
    .replace(/³/g, '3')
    .replace(/percent/g, '%')
    .replace(/\^/g, '*')
    .replace(/^[a-z]*(?=10)/g, '')
    .replace(/[x×]/g, '')
    .replace(/units\/week/g, 'u/week')
    .replace(/ng\/ml/g, 'ug/l')
    .replace(/^\/[0-9]+$/g, 'score')
    .trim();
}
