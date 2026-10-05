import { parseRef, RefError } from '@lectio/refs';
import { describe, expect, it } from 'vitest';

import { canonicalRef, formatCanonical, hasLetters, refKey, stripLetters } from './canonical.ts';

describe('canonical refs', () => {
  it('drops letters and writes the short form with ASCII hyphens', () => {
    expect(canonicalRef('Philippians 1:20c-24, 27a')).toBe('Phil 1:20-24, 27');
    expect(canonicalRef('Psalm 122: 1-2, 3-4, 4-5')).toBe('Ps 122:1-2, 3-4, 4-5');
    expect(canonicalRef('Ecclesiastes 11:9—12:8')).toBe('Eccl 11:9-12:8');
    expect(canonicalRef('Ps 23')).toBe('Ps 23');
  });

  it('throws a RefError for an unreadable citation', () => {
    expect(() => canonicalRef('Nowhere 1:1')).toThrow(RefError);
  });

  it('detects letters at either end of a segment', () => {
    expect(hasLetters(parseRef('Mt 20:1-16a'))).toBe(true);
    expect(hasLetters(parseRef('Phil 1:20c-24'))).toBe(true);
    expect(hasLetters(parseRef('Mt 20:1-16'))).toBe(false);
    expect(hasLetters(stripLetters(parseRef('Mt 20:1b-16a')))).toBe(false);
  });

  it('formats a parsed ref and keys a ref string', () => {
    expect(formatCanonical(parseRef('Mt 20:1-16a'))).toBe('Mt 20:1-16');
    expect(refKey('Phil 1:20-24, 27')).toBe('PHIL.1.20-24_1.27');
    expect(refKey('Ps 145:2-3, 8-9, 17-18')).toBe('PS.145.2-3_145.8-9_145.17-18');
  });
});
