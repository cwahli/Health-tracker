export const LABEL_STOPWORDS = [
  'nutrition',
  'facts',
  'ingredients',
  'serving',
  'size',
  'daily',
  'value',
  'contains',
  'label',
  'table',
];

export function isUsableBoundingBox(box: any): boolean {
  if (!box || !Array.isArray(box) || box.length !== 4) return false;
  return box.some((v) => typeof v === 'number' && v > 0);
}

export function isDummyFullFrameBox(box: any): boolean {
  if (!isUsableBoundingBox(box)) return true;
  return box[0] === 0 && box[1] === 0 && (box[2] === 1000 || box[2] === 1) && (box[3] === 1000 || box[3] === 1);
}

export function sliceParentBoxByWeights(parentBox: any, items: any[]): any[] {
  if (!isUsableBoundingBox(parentBox) || !Array.isArray(items) || items.length === 0) {
    return items.map((i) => i.boundingBox2D || parentBox);
  }
  const totalWeight = items.reduce((sum, item) => sum + (item.weightGrams || 100), 0) || 1;
  let currentY = parentBox[0];
  const totalH = parentBox[2] - parentBox[0];

  return items.map((item) => {
    const frac = (item.weightGrams || 100) / totalWeight;
    const h = totalH * frac;
    const box = [currentY, parentBox[1], currentY + h, parentBox[3]];
    currentY += h;
    return box;
  });
}

export function boxForUnrolledFood(
  itemBox: any,
  parentBox: any,
  weights: number[] = [],
  index: number = 0
): any {
  if (isUsableBoundingBox(itemBox)) return itemBox;
  if (!isUsableBoundingBox(parentBox)) return [0, 0, 1000, 1000];

  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const prefix = weights.slice(0, index).reduce((a, b) => a + b, 0);
  const frac = (weights[index] || 100) / total;

  const yMin = parentBox[0] + (parentBox[2] - parentBox[0]) * (prefix / total);
  const yMax = yMin + (parentBox[2] - parentBox[0]) * frac;
  return [yMin, parentBox[1], yMax, parentBox[3]];
}

export function canMergeScoutLabelIntoFood(labelItem: any, foodItem: any): boolean {
  if (!labelItem || !foodItem) return false;
  return true;
}

export function mergeScoutItems(items: any[]): any[] {
  return items;
}

export function clusterSpatialCompositeDishes(items: any[], _addDebugLog?: any, _isCompareMode?: boolean): any[] {
  return items;
}

export function validateOrFallback(
  schema: any,
  parsed: any,
  _raw: string,
  _stage: string,
  fallback: any,
  addDebugLog?: (msg: string) => void
): any {
  if (!parsed || typeof parsed !== 'object') {
    if (addDebugLog) addDebugLog(`[validateOrFallback] Invalid json shape, using fallback`);
    return fallback;
  }
  const result = schema.safeParse(parsed);
  if (result.success) {
    return result.data;
  }
  if (addDebugLog) {
    addDebugLog(`[validateOrFallback] Schema validation warning: ${result.error.message.slice(0, 100)}`);
  }
  return { ...fallback, ...parsed };
}
