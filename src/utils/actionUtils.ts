import { HealthAction } from '../types';

export interface ParsedActionDetails {
  title: string;
  testName: string;
  timeframe: string;
  minMonths: number;
  maxMonths: number;
  addedTimestamp: number;
  currentValueStr?: string;
}

export interface DynamicTimeTag {
  label: string;
  status: 'normal' | 'due_soon' | 'overdue';
  remMax: number;
}

export function parseActionDetails(act: HealthAction): ParsedActionDetails {
  let addedTimestamp = act.createdAt;
  if (!addedTimestamp && act.id) {
    const match = act.id.match(/\d{12,13}/);
    if (match) {
      addedTimestamp = parseInt(match[0], 10);
    }
  }
  if (!addedTimestamp) {
    addedTimestamp = Date.now();
  }

  let testName = act.testName || '';
  let timeframe = act.timeframe || '';
  let title = act.task || '';
  let currentValueStr = '';

  // Extract [Test: ...] tag from task string if present
  const testMatch = title.match(/\[Test:\s*([^\]]+)\]/i);
  if (testMatch) {
    if (!testName) testName = testMatch[1].trim();
    title = title.replace(/\[Test:\s*[^\]]+\]/gi, '');
  }

  // Extract (Current: ...) value from task string if present
  const valMatch = title.match(/\(Current:\s*([^\)]+)\)/i);
  if (valMatch) {
    currentValueStr = valMatch[1].trim();
    title = title.replace(/\(Current:\s*[^\)]+\)/gi, '');
  }

  // Extract timeframe like " - In 3-6 months" or " (3-6 months)" or " (Within 3 months)" or " (3 months)"
  const timeframeMatch = title.match(/(?:-\s*|\()\s*(?:In|Within\s+)?(\d+(?:-\d+)?\s*(?:months?|years?)|Immediate|As scheduled|This month)\s*\)?/i);
  if (timeframeMatch) {
    if (!timeframe) timeframe = timeframeMatch[1].trim();
    title = title.replace(/(?:-\s*|\()\s*(?:In|Within\s+)?(?:\d+(?:-\d+)?\s*(?:months?|years?)|Immediate|As scheduled|This month)\s*\)?/gi, '');
  }

  // Clean embedded timeframe parens inside testName if present
  if (testName) {
    testName = testName.replace(/\s*\(\s*(?:In|Within|At)?\s*(?:\d+(?:-\d+)?\s*(?:months?|years?|weeks?|days?)|Immediate|As scheduled|This month)\s*\)/gi, '').trim();
    testName = testName.replace(/\s*-\s*(?:In|Within|At)?\s*(?:\d+(?:-\d+)?\s*(?:months?|years?|weeks?|days?)|Immediate|As scheduled|This month)$/gi, '').trim();
    testName = testName.replace(/\s+(?:In|Within|At)?\s*(?:\d+(?:-\d+)?\s*(?:months?|years?|weeks?|days?)|Immediate|As scheduled|This month)$/gi, '').trim();
  }

  title = title.trim().replace(/^Retest\s+Retest/i, 'Retest').replace(/[-:]\s*$/, '').trim();

  // If testName is still empty, derive a clear tag based on title or type
  if (!testName) {
    const lowerTitle = title.toLowerCase();
    if (act.type === 'doctor' || lowerTitle.includes('physician') || lowerTitle.includes('consult')) {
      testName = 'Physician Consultation';
    } else if (lowerTitle.includes('fasting blood panel')) {
      testName = 'Fasting Blood Panel';
    } else if (lowerTitle.includes('retest')) {
      const cleanName = title.replace(/^Retest\s+/i, '').trim();
      testName = cleanName ? `${cleanName} Panel` : 'Biomarker Retest';
    } else if (lowerTitle.includes('diagnostic test:')) {
      testName = title.split(/diagnostic test:/i)[1]?.trim() || 'Diagnostic Test';
    } else {
      testName = 'Clinical Test';
    }
  }

  if (!timeframe) {
    timeframe = '3-6 months';
  }

  let minMonths = 3;
  let maxMonths = 6;

  const rangeMatch = timeframe.match(/(\d+)\s*-\s*(\d+)\s*(months?|years?)/i);
  if (rangeMatch) {
    const isYear = rangeMatch[3].toLowerCase().startsWith('year');
    const mult = isYear ? 12 : 1;
    minMonths = parseInt(rangeMatch[1], 10) * mult;
    maxMonths = parseInt(rangeMatch[2], 10) * mult;
  } else {
    const singleMatch = timeframe.match(/(\d+)\s*(months?|years?)/i);
    if (singleMatch) {
      const isYear = singleMatch[2].toLowerCase().startsWith('year');
      const mult = isYear ? 12 : 1;
      const num = parseInt(singleMatch[1], 10) * mult;
      minMonths = num;
      maxMonths = num;
    } else if (/immediate|this month/i.test(timeframe)) {
      minMonths = 0;
      maxMonths = 0;
    }
  }

  return {
    title,
    testName,
    timeframe,
    minMonths,
    maxMonths,
    addedTimestamp,
    currentValueStr
  };
}

export function getDynamicTimeTag(minMonths: number, maxMonths: number, addedTimestamp: number): DynamicTimeTag {
  const added = new Date(addedTimestamp);
  const now = new Date();
  const yearDiff = now.getFullYear() - added.getFullYear();
  const monthDiff = now.getMonth() - added.getMonth();
  const totalMonths = yearDiff * 12 + monthDiff;
  const dayDiff = (now.getDate() - added.getDate()) / 30;
  const elapsed = Math.max(0, Math.floor(totalMonths + dayDiff));

  const remMin = minMonths - elapsed;
  const remMax = maxMonths - elapsed;

  if (remMax < 0) {
    const overdue = Math.abs(remMax);
    if (overdue === 0) {
      return { label: 'Due this month', status: 'due_soon', remMax };
    }
    return {
      label: overdue === 1 ? 'Due since 1 month' : `Due since ${overdue} months`,
      status: 'overdue',
      remMax
    };
  }

  if (remMax === 0) {
    return { label: 'Due this month', status: 'due_soon', remMax };
  }

  if (remMax === 1) {
    return { label: 'This month', status: 'due_soon', remMax };
  }

  if (remMin > 0 && remMin !== remMax) {
    return { label: `in ${remMin}-${remMax} months`, status: 'normal', remMax };
  }

  return { label: `in ${remMax} months`, status: 'normal', remMax };
}

export function sortActionsByDueDate(actions: HealthAction[]): HealthAction[] {
  return [...actions].sort((a, b) => {
    if (a.completed !== b.completed) {
      return a.completed ? 1 : -1;
    }
    // Sort by priority first: high (0) > medium (1) > low (2)
    const prioWeight: Record<string, number> = { high: 0, medium: 1, low: 2 };
    const prioA = prioWeight[a.priority || 'medium'] ?? 1;
    const prioB = prioWeight[b.priority || 'medium'] ?? 1;

    if (prioA !== prioB) {
      return prioA - prioB;
    }

    // Then sort by due date (soonest due first)
    const parsedA = parseActionDetails(a);
    const parsedB = parseActionDetails(b);
    const tagA = getDynamicTimeTag(parsedA.minMonths, parsedA.maxMonths, parsedA.addedTimestamp);
    const tagB = getDynamicTimeTag(parsedB.minMonths, parsedB.maxMonths, parsedB.addedTimestamp);

    return tagA.remMax - tagB.remMax;
  });
}
