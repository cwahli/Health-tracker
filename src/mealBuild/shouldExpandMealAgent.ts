/** TypeScript expand gate for F-10. Counts and OCR flags only — not a model status enum. */

export type MealExpandInput = {
  dishCount: number;
  imageCount: number;
  hasReceipt?: boolean;
  hasBarcode?: boolean;
};

/** True → spawn workers for remaining dishes. False → one Meal Agent dispatch. */
export function shouldExpandMealAgent(input: MealExpandInput): boolean {
  const dishes = Number(input.dishCount) || 0;
  const images = Number(input.imageCount) || 0;
  if (dishes >= 4) return true;
  if (images >= 3) return true;
  if (input.hasReceipt) return true;
  if (input.hasBarcode) return true;
  return false;
}
