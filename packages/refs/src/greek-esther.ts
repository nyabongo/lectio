import type { BookCode } from './books.ts';
import type { Point } from './types.ts';

/**
 * Greek Esther (L-049). The NABRE prints the Greek additions to Esther as
 * lettered chapters A–F (A before 1:1, B after 3:13, C after 4:17, D in place
 * of 5:1-2, E after 8:12, F after 10:3); the Vulgate and Douay-Rheims print
 * them as 10:4–16:24. Lectionary references use the letters: `Est C:12, 14-16, 23-25`.
 *
 * A `Point` keeps a numeric chapter, so a lettered chapter is stored as a
 * chapter number outside Esther's ten: A is 101, B 102, … F 106. Only Esther
 * has lettered chapters; keys and formatters write the letter (`EST.C.12`,
 * `Est C:12`), and neither the parser, `fromKey` nor {@link readChapter} reads
 * `103` as `C`.
 *
 * Order: compared by `c`, the stand-in numbers put every addition after
 * chapter 10. The NABRE prints them inside the Hebrew text, so code that sorts
 * Esther passages in reading order uses {@link comparePoints} (or
 * {@link readingOrder}), never `c` and `v` alone.
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
 * its stand-in number. `undefined` for a letter in another book, for Esther's stand-in numbers
 * written as numbers (`103` is not `C`) and for anything else.
 */
export function readChapter(book: BookCode, text: string): number | undefined {
  if (/^\d+$/.test(text)) {
    const chapter = Number(text);
    return isLetteredChapter(book, chapter) ? undefined : chapter;
  }
  const index = GREEK_ESTHER_LETTERS.indexOf(text.toUpperCase() as GreekEstherLetter);
  return book === 'EST' && index >= 0 ? BASE + index + 1 : undefined;
}

/**
 * Where each lettered chapter stands in the NABRE's Esther: after Hebrew verse `[c, v]`, and
 * second when two additions follow the same verse. A comes before 1:1; D takes the place of
 * 5:1-2, so it follows C (after 4:17) and comes before 5:3.
 */
const PLACE: Readonly<Record<GreekEstherLetter, readonly [number, number, number]>> = {
  A: [0, 0, 1],
  B: [3, 13, 1],
  C: [4, 17, 1],
  D: [4, 17, 2],
  E: [8, 12, 1],
  F: [10, 3, 1],
};

/**
 * A point's position in reading order, as a tuple to compare element by element: the Hebrew
 * chapter and verse, then the addition's place after that verse (0 for the Hebrew text itself),
 * then its verse. A whole chapter sits at its verse 0.
 */
export function readingOrder(book: BookCode, point: Point): readonly [number, number, number, number] {
  const letter = chapterLetter(book, point.c);
  const v = point.v ?? 0;
  if (letter === undefined) return [point.c, v, 0, 0];
  const [c, after, place] = PLACE[letter];
  return [c, after, place, v];
}

/**
 * Compares two points of `book` in reading order (negative when `a` comes first). In Esther the
 * lettered chapters fall inside the Hebrew text as the NABRE prints them: A, 1, 2, 3:1-13, B,
 * 3:14-15, 4, C, D, 5:3-14, 6, 7, 8:1-12, E, 8:13-17, 9, 10:1-3, F. Sub-verse parts are ignored.
 */
export function comparePoints(book: BookCode, a: Point, b: Point): number {
  const x = readingOrder(book, a);
  const y = readingOrder(book, b);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return (x[i] as number) - (y[i] as number);
  return 0;
}
