import { describe, it, expect } from 'vitest';
import { buildFoodSearchQuerySet } from './server_query_set.js';

describe('buildFoodSearchQuerySet', () => {
  it('should extract unique atomics for multi-component dishes', () => {
    const scoutItems = [
      {
        keyword: 'chicken avocado salad bowl',
        originalName: 'chicken avocado salad bowl',
        components: [
          { searchQuery: 'grilled chicken breast' },
          { searchQuery: 'avocado' },
          { searchQuery: 'mixed greens' }
        ]
      }
    ];
    
    const queries = buildFoodSearchQuerySet(scoutItems);
    expect(queries).toContain('grilled chicken breast');
    expect(queries).toContain('avocado');
    expect(queries).toContain('mixed greens');
    expect(queries).not.toContain('chicken avocado salad bowl');
  });

  it('should retain original queries for brand items even if multi-component', () => {
    const scoutItems = [
      {
        originalName: 'McDonalds Big Mac',
        chainName: 'McDonalds',
        queriesToSearch: ['McDonalds Big Mac'],
        components: [
          { searchQuery: 'beef patty' },
          { searchQuery: 'bun' }
        ]
      }
    ];

    const queries = buildFoodSearchQuerySet(scoutItems);
    expect(queries).toContain('McDonalds Big Mac');
  });

  it('prepends chainName to brand item queries when chainName is not already present in the name', () => {
    const scoutItems = [
      {
        originalName: 'Steak and Shoestring Potato Salad',
        chainName: 'Yolk',
        components: [
          { searchQuery: 'bavette steak' },
          { searchQuery: 'french fries' },
        ]
      }
    ];

    const queries = buildFoodSearchQuerySet(scoutItems);
    expect(queries).toContain('Yolk Steak and Shoestring Potato Salad');
  });
});
