import { describe, it, expect } from 'vitest';
import { resolveFoodImage, resolveFoodImages } from './imageResolver';
import { FoodLog } from '../types';

describe('imageResolver Contract & Deduplication', () => {
  const dummyLogs: FoodLog[] = [
    {
      id: 'food_123',
      name: 'Oatmeal',
      date: '2026-09-17',
      composition: 'Oats, milk',
      weightGrams: 200,
      quantity: '1 bowl',
      nutrients: { calories: 300 },
      imageUrl: '/photos/food_123.jpg',
      imageUrls: ['/photos/food_123.jpg'],
    } as any,
    {
      id: 'food_chained',
      name: 'Chained Oatmeal',
      date: '2026-09-17',
      composition: 'Oats, milk',
      weightGrams: 200,
      quantity: '1 bowl',
      nutrients: { calories: 300 },
      imageUrl: 'ref:food_123',
      imageUrls: ['ref:food_123'],
    } as any
  ];

  it('resolves direct image URLs without change', () => {
    expect(resolveFoodImage('/photos/direct.jpg', dummyLogs)).toBe('/photos/direct.jpg');
    expect(resolveFoodImage('https://images.example.com/meal.png', dummyLogs)).toBe('https://images.example.com/meal.png');
  });

  it('resolves ref: to an existing food log', () => {
    expect(resolveFoodImage('ref:food_123', dummyLogs)).toBe('/photos/food_123.jpg');
  });

  it('resolves chained ref: across multiple logs', () => {
    expect(resolveFoodImage('ref:food_chained', dummyLogs)).toBe('/photos/food_123.jpg');
  });

  it('resolves ref:brand_* to /photos/brand_*.jpg fallback', () => {
    expect(resolveFoodImage('ref:brand_pret_egg_sandwich', dummyLogs)).toBe('/photos/brand_pret_egg_sandwich.jpg');
  });

  it('resolves direct CAS /photos/ paths when prefixed with ref:', () => {
    expect(resolveFoodImage('ref:/photos/sha256_abcd1234ef.jpg', dummyLogs)).toBe('/photos/sha256_abcd1234ef.jpg');
  });

  it('resolves an array of images and removes duplicates', () => {
    const images = [
      '/photos/direct.jpg',
      'ref:food_123',
      '/photos/direct.jpg',
      'ref:food_chained',
      'ref:brand_test_item'
    ];
    const resolved = resolveFoodImages(images, dummyLogs);
    // /photos/direct.jpg appears twice in input, /photos/food_123.jpg appears via direct and chained
    expect(resolved).toEqual([
      '/photos/direct.jpg',
      '/photos/food_123.jpg',
      '/photos/brand_test_item.jpg'
    ]);
  });

  it('ignores placeholder [image_removed_for_snapshot]', () => {
    expect(resolveFoodImage('[image_removed_for_snapshot]', dummyLogs)).toBeUndefined();
    expect(resolveFoodImages(['[image_removed_for_snapshot]'], dummyLogs)).toEqual([]);
  });
});
