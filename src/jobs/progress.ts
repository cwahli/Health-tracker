export function getProgressPercent(stepKey: string): number {
  const weights: Record<string, number> = {
    queued: 0,
    starting: 5,
    upload_prepare: 10,
    scout: 35,
    db_search: 50,
    resolve: 60,
    dietitian: 80,
    finalize: 95,
  };

  if (weights[stepKey] !== undefined) {
    return weights[stepKey];
  }

  const order = ['queued', 'starting', 'upload_prepare', 'scout', 'db_search', 'resolve', 'dietitian', 'finalize'];
  let total = 0;
  for (const key of order) {
    total += weights[key] || 0;
    if (key === stepKey) {
      break;
    }
  }
  return total || 10;
}

export function getStepCeiling(stepKey: string): number {
  const stepCeilings: Record<string, number> = {
    queued: 0,
    starting: 15,
    upload_prepare: 25,
    scout: 50,
    db_search: 65,
    resolve: 75,
    dietitian: 92,
    finalize: 98,
  };
  return stepCeilings[stepKey] || 90;
}

