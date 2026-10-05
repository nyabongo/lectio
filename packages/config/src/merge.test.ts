import { describe, expect, it } from 'vitest';

import { deepFreeze, deepMerge, isPlainObject } from './merge.ts';

describe('isPlainObject', () => {
  it('accepts objects only', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject('x')).toBe(false);
  });
});

describe('deepMerge', () => {
  it('merges objects key by key and replaces arrays and scalars', () => {
    const base = { a: { b: 1, c: [1, 2] }, d: 'x' };
    const override = { a: { c: [3] }, e: true };
    expect(deepMerge(base, override)).toEqual({ a: { b: 1, c: [3] }, d: 'x', e: true });
  });

  it('keeps the base for undefined and replaces an object with a scalar', () => {
    expect(deepMerge({ a: 1 }, undefined)).toEqual({ a: 1 });
    expect(deepMerge({ a: { b: 1 } }, { a: 5 })).toEqual({ a: 5 });
    expect(deepMerge(undefined, undefined)).toBeUndefined();
  });

  it('does not modify or share structure with its inputs', () => {
    const base = { a: { b: [1] } };
    const override = { c: { d: [2] } };
    const merged = deepMerge(base, override) as { a: { b: number[] }; c: { d: number[] } };
    merged.a.b.push(9);
    merged.c.d.push(9);
    expect(base).toEqual({ a: { b: [1] } });
    expect(override).toEqual({ c: { d: [2] } });
  });

  it('keeps a __proto__ key as an own property instead of changing the prototype', () => {
    const override: unknown = JSON.parse('{"__proto__": {"polluted": true}}');
    const merged = deepMerge({}, override) as Record<string, unknown>;
    expect(Object.keys(merged)).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('does not read inherited keys from the base', () => {
    expect(deepMerge({}, { toString: { a: 1 } })).toEqual({ toString: { a: 1 } });
  });
});

describe('deepFreeze', () => {
  it('freezes nested objects and arrays', () => {
    const value = deepFreeze({ a: { b: [1, { c: 2 }] } });
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.a)).toBe(true);
    expect(Object.isFrozen(value.a.b)).toBe(true);
    expect(Object.isFrozen(value.a.b[1])).toBe(true);
  });

  it('passes primitives and frozen values through', () => {
    expect(deepFreeze(3)).toBe(3);
    expect(deepFreeze(null)).toBeNull();
    const frozen = Object.freeze({ a: 1 });
    expect(deepFreeze(frozen)).toBe(frozen);
  });
});
