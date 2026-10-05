import { describe, expect, it } from 'vitest';

import * as refs from './index.ts';
import {
  GREEK_ESTHER_LETTERS,
  chapterLabel,
  chapterLetter,
  isLetteredChapter,
  letteredChapter,
  readChapter,
} from './greek-esther.ts';

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
    expect(readChapter('PS', '103')).toBe(103);
    expect(readChapter('PS', 'C')).toBeUndefined();
    expect(readChapter('EST', 'G')).toBeUndefined();
    expect(readChapter('EST', 'CD')).toBeUndefined();
    expect(readChapter('EST', '')).toBeUndefined();
  });

  it('is exported from the package entry point', () => {
    expect(refs.letteredChapter).toBe(letteredChapter);
    expect(refs.chapterLabel).toBe(chapterLabel);
    expect(refs.GREEK_ESTHER_LETTERS).toBe(GREEK_ESTHER_LETTERS);
  });
});
