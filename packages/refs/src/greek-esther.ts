import type { BookCode } from './books.ts';

/**
 * Greek Esther (L-049). The NABRE prints the Greek additions to Esther as
 * lettered chapters A–F (A before 1:1, B after 3:13, C after 4:17, D in place
 * of 5:1-2, E after 8:12, F after 10:3); the Vulgate and Douay-Rheims print
 * them as 10:4–16:24. Lectionary references use the letters: `Est C:12, 14-16, 23-25`.
 *
 * A `Point` keeps a numeric chapter, so a lettered chapter is stored as a
 * chapter number outside Esther's ten: A is 101, B 102, … F 106. Only Esther
 * has lettered chapters; keys and formatters write the letter (`EST.C.12`,
 * `Est C:12`) and the parser never reads `Est 103:12` as `Est C:12`.
 */
export const GREEK_ESTHER_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;

export type GreekEstherLetter = (typeof GREEK_ESTHER_LETTERS)[number];

const BASE = 100;

/** The chapter number that stands for a lettered chapter: `C` → 103. */
export function letteredChapter(letter: GreekEstherLetter): number {
  return BASE + GREEK_ESTHER_LETTERS.indexOf(letter) + 1;
}

/** The letter of a lettered Esther chapter number (`EST`, 103 → `C`), or `undefined` for any other chapter. */
export function chapterLetter(book: BookCode, chapter: number): GreekEstherLetter | undefined {
  return book === 'EST' ? GREEK_ESTHER_LETTERS[chapter - BASE - 1] : undefined;
}

/** True for the chapter numbers that stand for Esther's lettered chapters. */
export function isLetteredChapter(book: BookCode, chapter: number): boolean {
  return chapterLetter(book, chapter) !== undefined;
}

/** A chapter as written in references and keys: the letter for Esther A–F, the number otherwise. */
export function chapterLabel(book: BookCode, chapter: number): string {
  return chapterLetter(book, chapter) ?? String(chapter);
}

/**
 * The chapter number for a written chapter: a number as is, a letter A–F (any case) in Esther as
 * its stand-in number. `undefined` for a letter in another book or for anything else.
 */
export function readChapter(book: BookCode, text: string): number | undefined {
  if (/^\d+$/.test(text)) return Number(text);
  const index = GREEK_ESTHER_LETTERS.indexOf(text.toUpperCase() as GreekEstherLetter);
  return book === 'EST' && index >= 0 ? BASE + index + 1 : undefined;
}
