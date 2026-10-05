import { describe, expect, it } from 'vitest';

import * as refs from './index.ts';
import {
  GREEK_ESTHER_LETTERS,
  chapterLabel,
  chapterLetter,
  comparePoints,
  isLetteredChapter,
  letteredChapter,
  readChapter,
  readingOrder,
} from './greek-esther.ts';
import type { GreekEstherLetter } from './greek-esther.ts';
import type { Point } from './types.ts';

describe('Greek Esther lettered chapters (L-049)', () => {
  it('stores A–F as chapters 101–106', () => {
    expect(GREEK_ESTHER_LETTERS.map(letteredChapter)).toEqual([101, 102, 103, 104, 105, 106]);
    expect(GREEK_ESTHER_LETTERS.map((letter) => chapterLetter('EST', letteredChapter(letter)))).toEqual([
      ...GREEK_ESTHER_LETTERS,
    ]);
  });

  it('only gives Esther lettered chapters', () => {
    expect(chapterLetter('EST', 103)).toBe('C');
    expect(chapterLetter('EST', 100)).toBeUndefined();
    expect(chapterLetter('EST', 107)).toBeUndefined();
    expect(chapterLetter('EST', 4)).toBeUndefined();
    expect(chapterLetter('PS', 103)).toBeUndefined();
    expect(isLetteredChapter('EST', 101)).toBe(true);
    expect(isLetteredChapter('EST', 10)).toBe(false);
    expect(isLetteredChapter('PS', 101)).toBe(false);
  });

  it('writes the letter for lettered chapters and the number otherwise', () => {
    expect(chapterLabel('EST', 106)).toBe('F');
    expect(chapterLabel('EST', 10)).toBe('10');
    expect(chapterLabel('PS', 103)).toBe('103');
  });

  it('reads written chapters', () => {
    expect(readChapter('EST', 'C')).toBe(103);
    expect(readChapter('EST', 'c')).toBe(103);
    expect(readChapter('EST', '4')).toBe(4);
    expect(readChapter('EST', '100')).toBe(100);
    expect(readChapter('EST', '107')).toBe(107);
    expect(readChapter('PS', '103')).toBe(103);
    expect(readChapter('PS', 'C')).toBeUndefined();
    expect(readChapter('EST', 'G')).toBeUndefined();
    expect(readChapter('EST', 'CD')).toBeUndefined();
    expect(readChapter('EST', '')).toBeUndefined();
  });

  it("refuses Esther's stand-in numbers written as numbers", () => {
    for (const text of ['101', '103', '106']) expect(readChapter('EST', text)).toBeUndefined();
  });

  it('sorts Esther in the NABRE reading order, the additions inside the Hebrew text', () => {
    const at = (c: number | GreekEstherLetter, v?: number): Point => ({
      c: typeof c === 'number' ? c : letteredChapter(c),
      ...(v === undefined ? {} : { v }),
    });
    const reading = [
      at('A', 1),
      at('A', 17),
      at(1),
      at(1, 1),
      at(3, 13),
      at('B', 1),
      at('B', 7),
      at(3, 14),
      at(4, 17),
      at('C', 1),
      at('C', 30),
      at('D'),
      at('D', 16),
      at(5, 3),
      at(8, 12),
      at('E', 24),
      at(8, 13),
      at(10, 3),
      at('F', 1),
      at('F', 11),
    ];
    const shuffled = [...reading].reverse();
    expect(shuffled.sort((a, b) => comparePoints('EST', a, b))).toEqual(reading);
    expect(comparePoints('EST', at('C', 2), { c: letteredChapter('C'), v: 2, part: 'a' })).toBe(0);
    expect(readingOrder('EST', at('D', 3))).toEqual([4, 17, 2, 3]);
    expect(readingOrder('EST', at(5))).toEqual([5, 0, 0, 0]);
  });

  it('sorts other books by chapter and verse, 103 being a chapter like any other', () => {
    expect(comparePoints('PS', { c: 103, v: 1 }, { c: 4 })).toBeGreaterThan(0);
    expect(comparePoints('PS', { c: 23, v: 2 }, { c: 23, v: 10 })).toBeLessThan(0);
    expect(readingOrder('PS', { c: 103, v: 1 })).toEqual([103, 1, 0, 0]);
  });

  it('is exported from the package entry point', () => {
    expect(refs.letteredChapter).toBe(letteredChapter);
    expect(refs.chapterLabel).toBe(chapterLabel);
    expect(refs.GREEK_ESTHER_LETTERS).toBe(GREEK_ESTHER_LETTERS);
  });
});
