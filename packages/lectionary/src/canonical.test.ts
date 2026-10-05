import { parseRef, RefError } from '@lectio/refs';
import { describe, expect, it } from 'vitest';

import {
  canonicalRef,
  formatCanonical,
  hasLetters,
  parsePrinted,
  refKey,
  singlePsalmNumber,
  stripLetters,
  verseSet,
} from './canonical.ts';

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

  it('reads a dual psalm number as the Hebrew one, the larger of the two', () => {
    expect(singlePsalmNumber('Psalm 66 (67)')).toBe('Psalm 67');
    expect(singlePsalmNumber('Psalm 103 (102): 1-2, 3-4, 17-18a')).toBe('Psalm 103: 1-2, 3-4, 17-18a');
    expect(singlePsalmNumber('Ps 71(72):1-2')).toBe('Ps 72:1-2');
    expect(singlePsalmNumber('Psalms 9 (10)')).toBe('Psalms 10');
    expect(singlePsalmNumber('Psalm 87: 1-2')).toBe('Psalm 87: 1-2');
    expect(singlePsalmNumber('Isaiah 12 (13)')).toBe('Isaiah 12 (13)');
    expect(canonicalRef('Psalm 66 (67)')).toBe('Ps 67');
    // A key is only ever made from a ref that parses as it is.
    expect(() => refKey('Psalm 103 (102): 1-2')).toThrow(RefError);
    expect(parsePrinted('Psalm 71 (72): 1-2').segments[0]?.start).toEqual({ c: 72, v: 1 });
  });

  it('gives equal values for keys that cover the same verses', () => {
    expect(verseSet('PS.100.1-2_100.3_100.4_100.5')).toBe(verseSet('PS.100.1-5'));
    expect(verseSet('PS.96.1-2_96.2-3')).toBe(verseSet('PS.96.1-3'));
    expect(verseSet('1JN.1.5-10_2.1-2')).toBe(verseSet('1JN.1.5-2.2'));
    expect(verseSet('IS.8.23_9.1-3')).toBe(verseSet('IS.8.23-9.3'));
    expect(verseSet('PS.23')).toBe(verseSet('PS.23.1-6'));
    expect(verseSet('PS.100.1-4')).not.toBe(verseSet('PS.100.1-5'));
    expect(verseSet('PS.100.1-5')).not.toBe(verseSet('PS.101.1-5'));
    expect(verseSet('PS.100.1-5')).toBe('PS 100001,100002,100003,100004,100005');
  });

  it('keeps a key it cannot count as its own value', () => {
    // A whole chapter the versification does not know cannot be counted.
    expect(verseSet('PS.151')).toBe('PS.151');
    expect(verseSet('not a key')).toBe('not a key');
  });
});
