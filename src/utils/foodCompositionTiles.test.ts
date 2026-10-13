import { describe, it, expect } from 'vitest';
import {
  compositionTileItems,
  mapDisplayedScoutItems,
  resolveTileImageIndex,
  uniqueCropTiles,
} from './foodCompositionTiles';

/** Evidence-job shape: 7 foods + flattened sauce/sides (not this meal's FDC names). */
function plateWithPromotedSides() {
  return [
    { name: 'Vanilla Soft Serve', scoutIndex: 0, sourceImageIndex: 0, boundingBox2D: [10, 10, 200, 200] },
    { name: 'Crispy Drumstick', scoutIndex: 1, sourceImageIndex: 1, boundingBox2D: [20, 20, 300, 300] },
    { name: 'Fish Cake Skewer', scoutIndex: 2, sourceImageIndex: 2 },
    { name: 'Acme Citrus Vitamin Drink', scoutIndex: 3, sourceImageIndex: 3, chainName: 'Acme' },
    {
      name: 'Seitan Steak Plate',
      scoutIndex: 4,
      sourceImageIndex: 0,
      boundingBox2D: null,
      componentsDetailList: [
        { name: 'Green Pepper Sauce' },
        { name: 'Sweet Potato Wedges' },
        { name: 'Garden Vegetables' },
      ],
    },
    { name: 'Jasmine Iced Tea', scoutIndex: 5, sourceImageIndex: 0 },
    { name: 'Tempeh Satay', scoutIndex: 6, sourceImageIndex: 5 },
    { name: 'Green Pepper Sauce', role: 'component', isFlattenedComponent: true, sourceImageIndex: 0, boundingBox2D: null },
    { name: 'Sweet Potato Wedges', isFlattenedComponent: true, sourceImageIndex: 0, boundingBox2D: null },
    { name: 'Garden Vegetables', role: 'component', sourceImageIndex: 0, boundingBox2D: null },
    { name: 'Chili Oil', role: 'component', sourceImageIndex: 0, boundingBox2D: null },
  ];
}

describe('foodCompositionTiles F-8.6', () => {
  it('maps 7 FoodItems and drops promoted sauce/side rows', () => {
    const tiles = mapDisplayedScoutItems(plateWithPromotedSides(), []);
    expect(tiles).toHaveLength(7);
    const names = tiles.map((t) => t.originalName || t.keyword);
    expect(names).toContain('Seitan Steak Plate');
    expect(names).not.toContain('Green Pepper Sauce');
    expect(names).not.toContain('Sweet Potato Wedges');
    expect(names).not.toContain('Garden Vegetables');
    expect(names).not.toContain('Chili Oil');
  });

  it('does not steal photo 0 onto later tiles when every crop is image 0 / null box', () => {
    const tiles = mapDisplayedScoutItems(plateWithPromotedSides(), []);
    const drink = tiles.find((t) => /citrus/i.test(t.originalName));
    const steak = tiles.find((t) => /seitan/i.test(t.originalName));
    const tea = tiles.find((t) => /tea/i.test(t.originalName));
    expect(resolveTileImageIndex(drink, 6)).toBe(3);
    expect(resolveTileImageIndex(steak, 6)).toBe(0);
    expect(resolveTileImageIndex(tea, 6)).toBe(0);
    const samePlate = tiles.filter((t) => resolveTileImageIndex(t, 6) === 0);
    expect(samePlate.length).toBeGreaterThan(1);
    expect(tiles.map((t, i) => resolveTileImageIndex(t, 6))).not.toEqual(tiles.map((_, i) => i));
  });

  it('identity-replace without an index does not steal image 0 from a cropped sibling', () => {
    const items = [
      { name: 'Cropped Bowl', scoutIndex: 0, sourceImageIndex: 2, boundingBox2D: [1, 2, 3, 4] },
      { name: 'Text Added Seitan', scoutIndex: 1, sourceImageIndex: null },
    ];
    const tiles = mapDisplayedScoutItems(items, []);
    expect(resolveTileImageIndex(tiles[0], 4)).toBe(2);
    expect(resolveTileImageIndex(tiles[1], 4)).toBe(0);
    expect(tiles[1].sourceImageIndex).not.toBe(2);
  });

  it('compositionTileItems treats role=component as hidden', () => {
    expect(compositionTileItems([
      { name: 'Rice', role: 'food' },
      { name: 'Soy', role: 'component' },
    ]).map((x) => x.name)).toEqual(['Rice']);
  });

  it('uniqueCropTiles merges items sharing one identical crop, keeps distinct crops apart', () => {
    const items = [
      { name: 'SilverQueen', scoutIndex: 0, sourceImageIndex: 0, boundingBox2D: [0, 0, 1000, 500] },
      { name: 'Magnum', scoutIndex: 1, sourceImageIndex: 0, boundingBox2D: [0, 600, 1000, 1000] },
      { name: 'Kinder', scoutIndex: 2, sourceImageIndex: 0, boundingBox2D: [0, 600, 1000, 1000] },
      { name: 'Polo Choc', scoutIndex: 3, sourceImageIndex: 1, boundingBox2D: [0, 0, 1000, 1000] },
      { name: 'Polo Cheese', scoutIndex: 4, sourceImageIndex: 1, boundingBox2D: [0, 0, 1000, 1000] },
    ];
    const tiles = uniqueCropTiles(items);
    expect(tiles).toHaveLength(3);
    expect(tiles[0].memberIndices).toEqual([0]);
    expect(tiles[1].memberIndices).toEqual([1, 2]);
    expect(tiles[2].memberIndices).toEqual([3, 4]);
    expect(tiles[1].representativeIndex).toBe(1);
  });

  it('uniqueCropTiles treats a missing box as the full photo of its image', () => {
    const tiles = uniqueCropTiles([
      { name: 'A', scoutIndex: 0, sourceImageIndex: 1 },
      { name: 'B', scoutIndex: 1, sourceImageIndex: 1, boundingBox2D: [0, 0, 1000, 1000] },
    ]);
    expect(tiles).toHaveLength(1);
    expect(tiles[0].memberIndices).toEqual([0, 1]);
  });

  it('uniqueCropTiles keeps same box on different photos apart', () => {
    const tiles = uniqueCropTiles([
      { name: 'A', scoutIndex: 0, sourceImageIndex: 0, boundingBox2D: [0, 0, 1000, 1000] },
      { name: 'B', scoutIndex: 1, sourceImageIndex: 1, boundingBox2D: [0, 0, 1000, 1000] },
    ]);
    expect(tiles).toHaveLength(2);
  });
});
