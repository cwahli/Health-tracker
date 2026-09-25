import { describe, it, expect } from 'vitest';

import { toSqlValue, extraUniqueColsFromDdl, chunkRows } from './d1-supabase-recovery.mjs';

describe('toSqlValue', () => {
  it('passes primitives through and nulls stay null', () => {
    expect(toSqlValue('x')).toBe('x');
    expect(toSqlValue(5)).toBe(5);
    expect(toSqlValue(null)).toBeNull();
    expect(toSqlValue(undefined)).toBeNull();
  });

  it('maps booleans to 1/0 (D1 has no boolean type)', () => {
    expect(toSqlValue(true)).toBe(1);
    expect(toSqlValue(false)).toBe(0);
  });

  it('stringifies objects/arrays to JSON (never "[object Object]")', () => {
    expect(toSqlValue({ calories: 717 })).toBe('{"calories":717}');
    expect(toSqlValue([{ a: 1 }])).toBe('[{"a":1}]');
  });
});

describe('extraUniqueColsFromDdl', () => {
  it('finds the real food_items UNIQUE col and never the PK', () => {
    const ddl = `CREATE TABLE food_items (\n  food_id TEXT PRIMARY KEY,\n  food_key TEXT NOT NULL UNIQUE,\n  display_name TEXT NOT NULL,\n  nutrients_per_100g TEXT DEFAULT '{}'\n, basis_type TEXT DEFAULT 'per_100g')`;
    expect(extraUniqueColsFromDdl(ddl, 'food_id')).toEqual(['food_key']);
  });

  it('returns empty when there are no extra UNIQUE cols', () => {
    expect(extraUniqueColsFromDdl('CREATE TABLE t (id TEXT PRIMARY KEY, a TEXT)', 'id')).toEqual([]);
    expect(extraUniqueColsFromDdl('', 'id')).toEqual([]);
  });
});

describe('chunkRows', () => {
  const row = () => ({ id: 'x'.repeat(50), a: 'y'.repeat(50), b: 'z'.repeat(50) });

  it('respects the parameter ceiling (rows*cols <= 90)', () => {
    const chunks = chunkRows([row(), row(), row(), row()], 3);
    for (const c of chunks) expect(c.length * 3).toBeLessThanOrEqual(90);
  });

  it('keeps a huge single row in its own chunk', () => {
    const big = { id: 'a'.repeat(70_000), a: 'b', b: 'c' };
    const chunks = chunkRows([big], 3);
    expect(chunks.length).toBe(1);
    expect(chunks[0].length).toBe(1);
  });

  it('splits by byte size so blob tables do not blow the statement limit', () => {
    const rows = Array.from({ length: 50 }, () => ({ id: 'x'.repeat(30), a: 'y'.repeat(30), b: 'z'.repeat(30) }));
    const chunks = chunkRows(rows, 3);
    expect(chunks.length).toBeGreaterThan(1);
    const flat = chunks.flat();
    expect(flat).toHaveLength(50);
  });
});
