import { describe, it, expect, vi } from 'vitest';
import { resolvePhotoForBrandItem } from '../../../serverBrandMenu.js';

describe('server_brand_image_linking', () => {
  const photoA = 'https://r2.example.com/photos/sha256_latte.jpg';
  const photoB = 'https://r2.example.com/photos/sha256_sandwich.jpg';
  const photoC = 'https://r2.example.com/photos/sha256_muffin.jpg';

  it('links single photo regardless of sourceImageIndex', () => {
    const resolved = resolvePhotoForBrandItem([photoA], undefined);
    expect(resolved).toBe(photoA);

    const resolvedWithIndex = resolvePhotoForBrandItem([photoA], 0);
    expect(resolvedWithIndex).toBe(photoA);
  });

  it('disambiguates multiple photos using sourceImageIndex', () => {
    const photos = [photoA, photoB, photoC];

    // Dish 0 (latte) -> photo 0
    expect(resolvePhotoForBrandItem(photos, 0)).toBe(photoA);

    // Dish 1 (sandwich) -> photo 1
    expect(resolvePhotoForBrandItem(photos, 1)).toBe(photoB);

    // Dish 2 (muffin) -> photo 2
    expect(resolvePhotoForBrandItem(photos, 2)).toBe(photoC);
  });

  it('avoids false cross-assignment when multiple photos exist and index is omitted or invalid', () => {
    const photos = [photoA, photoB];

    // Missing index with multiple photos -> null to prevent cross-contamination
    expect(resolvePhotoForBrandItem(photos, undefined)).toBeNull();
    expect(resolvePhotoForBrandItem(photos, null)).toBeNull();

    // Out of bounds index -> null
    expect(resolvePhotoForBrandItem(photos, 5)).toBeNull();
    expect(resolvePhotoForBrandItem(photos, -1)).toBeNull();
  });

  it('rejects empty, truncated, or data: base64 photos', () => {
    expect(resolvePhotoForBrandItem([], 0)).toBeNull();
    expect(resolvePhotoForBrandItem(['data:image/jpeg;base64,...'], 0)).toBeNull();
    expect(resolvePhotoForBrandItem(['[base64_image_data_truncated]'], 0)).toBeNull();
  });
});
