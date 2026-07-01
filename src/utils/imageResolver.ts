import { FoodLog } from '../types';

/**
 * Resolves a potentially referenced image string.
 * If the string starts with "ref:", it finds the primary food log in the log array
 * and extracts its real, non-referenced image URL.
 */
export function resolveFoodImage(img: string | undefined, foodLogs: FoodLog[]): string | undefined {
  if (!img) return undefined;
  if (!img.startsWith('ref:')) return img;
  
  const primaryId = img.replace('ref:', '');
  const primaryLog = foodLogs.find(f => f.id === primaryId);
  if (primaryLog) {
    // Return primaryLog's image. If that is also a ref, resolve it recursively
    const baseImg = primaryLog.imageUrl;
    if (baseImg) {
      if (!baseImg.startsWith('ref:')) {
        return baseImg;
      } else {
        // Simple 1-level recursion to prevent infinite loops
        const nextId = baseImg.replace('ref:', '');
        const nextLog = foodLogs.find(f => f.id === nextId);
        if (nextLog && nextLog.imageUrl && !nextLog.imageUrl.startsWith('ref:')) {
          return nextLog.imageUrl;
        }
      }
    }
    // Fallback to first URL in imageUrls
    const firstUrl = primaryLog.imageUrls?.[0];
    if (firstUrl && !firstUrl.startsWith('ref:')) {
      return firstUrl;
    }
  }
  return undefined;
}

/**
 * Resolves an array of potentially referenced image strings.
 */
export function resolveFoodImages(imgs: string[] | undefined, foodLogs: FoodLog[]): string[] {
  if (!imgs || imgs.length === 0) return [];
  
  const resolved = imgs.map(img => resolveFoodImage(img, foodLogs)).filter((u): u is string => !!u);
  return resolved;
}
