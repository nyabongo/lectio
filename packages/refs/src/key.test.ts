import { describe, expect, it } from 'vitest';

import { isFilenameSafe } from './fixtures/arbitraries.ts';
import { KEY_PATTERN, RefError, fromKey, isKey, parseRef, toKey } from './index.ts';
import type { Ref } from './index.ts';

describe('toKey', () => {
  it.each([
    ['Mt 20:1-16a', 'MT.20.1-16'],
    ['Phil 1:20c-24, 27a', 'PHIL.1.20-24_1.27'],
    ['Ps 145:2-3, 8-9, 17-18', 'PS.145.2-3_145.8-9_145.17-18'],
    ['Eccl 11:9—12:8', 'ECCL.11.9-12.8'],
    ['Ps 23', 'PS.23'],
    ['Is 40-41', 'IS.40-41'],
  ])('keys %s as %s', (input, key) => {
    const result = toKey(parseRef(input));
    expect(result).toBe(key);
    expect(result).toMatch(KEY_PATTERN);
    expect(isFilenameSafe(result)).toBe(true);
  });

  it('gives the same key with and without sub-verse letters', () => {
    expect(toKey(parseRef('Mt 20:1-16a'))).toBe(toKey(parseRef('Mt 20:1-16')));
  });

  it('collapses a range whose ends differ only in letters', () => {
    expect(toKey(parseRef('Mt 5:3a-3b'))).toBe('MT.5.3');
  });

  it('rejects malformed refs', () => {
    expect(() => toKey({ book: 'MT', segments: [] })).toThrow(RefError);
  });
});

describe('fromKey', () => {
  it('reads keys back', () => {
    expect(fromKey('PHIL.1.20-24_1.27')).toEqual({
      book: 'PHIL',
      segments: [
        { start: { c: 1, v: 20 }, end: { c: 1, v: 24 } },
        { start: { c: 1, v: 27 }, end: { c: 1, v: 27 } },
      ],
    });
    expect(fromKey('ECCL.11.9-12.8').segments).toEqual([{ start: { c: 11, v: 9 }, end: { c: 12, v: 8 } }]);
    expect(fromKey('IS.40-41').segments).toEqual([{ start: { c: 40 }, end: { c: 41 } }]);
    expect(fromKey('PS.23').segments).toEqual([{ start: { c: 23 }, end: { c: 23 } }]);
    expect(fromKey('JUDE.1.17_1.20-25').book).toBe('JUDE');
  });

  it.each([
    ['MT', 'it must start with a book code and a dot'],
    ['MT.', 'cannot read segment ""'],
    ['XX.1.1', 'it must start with a book code and a dot'],
    ['mt.1.1', 'it must start with a book code and a dot'],
    ['MT.1.1__1.2', 'cannot read segment ""'],
    ['MT.1.1_', 'cannot read segment ""'],
    ['MT.1.a', 'cannot read segment "1.a"'],
    ['MT.01.1', 'the canonical spelling is "MT.1.1"'],
    ['MT.20.1-1', 'the canonical spelling is "MT.20.1"'],
    ['MT.1.2-1.5', 'the canonical spelling is "MT.1.2-5"'],
    ['IS.40-40', 'the canonical spelling is "IS.40"'],
    ['MT.20.5-3', 'The range ends at 20:3'],
    ['MT.0.1', 'numbers start at 1'],
    ['MT.1-2.3', 'both ends must be whole chapters or both verses'],
    ['JUDE.2.1', 'single chapter'],
    ['JUDE.1', 'single chapter'],
  ])('rejects %s', (key, reason) => {
    expect(isKey(key)).toBe(false);
    expect(() => fromKey(key)).toThrow(reason);
    try {
      fromKey(key);
    } catch (error) {
      expect((error as RefError).code).toBe('INVALID_KEY');
    }
  });

  it('accepts canonical keys', () => {
    expect(isKey('MT.20.1-16')).toBe(true);
  });
});

describe('key file-name safety', () => {
  const ref: Ref = parseRef('1 Cor 15:35-37, 42-49');

  it('uses only A-Z, 0-9, dot, hyphen and underscore', () => {
    expect(toKey(ref)).toMatch(/^[A-Z0-9._-]+$/);
  });

  it('never starts with a Windows reserved device name', () => {
    expect(isFilenameSafe('CON.1.1')).toBe(false);
    expect(isFilenameSafe('lpt1.txt')).toBe(false);
    expect(isFilenameSafe('a/b')).toBe(false);
    expect(isFilenameSafe('x.')).toBe(false);
    expect(isFilenameSafe(toKey(ref))).toBe(true);
  });
});
