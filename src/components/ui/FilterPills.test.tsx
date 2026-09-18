import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FilterPills } from './FilterPills';

describe('FilterPills UI Primitive', () => {
  const items = [
    { id: 'all', label: 'All Items', count: 12 },
    { id: 'active', label: 'Active', count: 5, activeColorClass: 'bg-emerald-600 text-white' },
    { id: 'flagged', label: 'Flagged', count: 2, activeColorClass: 'bg-rose-600 text-white' },
  ];

  it('renders all pill items with labels and counts', () => {
    const html = renderToStaticMarkup(
      <FilterPills items={items} activeId="all" onChange={() => {}} />
    );
    expect(html).toContain('All Items');
    expect(html).toContain('Active');
    expect(html).toContain('Flagged');
    expect(html).toContain('12');
    expect(html).toContain('5');
    expect(html).toContain('2');
  });

  it('marks active pill with aria-selected="true"', () => {
    const html = renderToStaticMarkup(
      <FilterPills items={items} activeId="active" onChange={() => {}} />
    );
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('data-testid="filter-pill-active"');
    expect(html).toContain('bg-emerald-600');
  });
});
