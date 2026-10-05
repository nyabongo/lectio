import { getBook } from '../books.ts';
import type { Ref } from '../types.ts';

/** Base of the drbo.org chapter pages (public-domain Douay-Rheims, Challoner revision). */
export const DRBO_BASE = 'https://www.drbo.org/chapter/';

/**
 * The drbo.org page of one chapter: the two-digit Douay-Rheims book number
 * followed by the three-digit chapter, `https://www.drbo.org/chapter/47020.htm`
 * for Matthew 20. Book numbers follow the Clementine Vulgate order
 * (`Book.douayRheims.number`); the chapter must already be in Vulgate numbering.
 */
export function drboChapterUrl(book: Ref['book'], chapter: number): string {
  const number = String(getBook(book).douayRheims.number).padStart(2, '0');
  return `${DRBO_BASE}${number}${String(chapter).padStart(3, '0')}.htm`;
}

/** The drbo.org page of the first chapter of a reference given in Vulgate numbering. */
export function drboUrl(ref: Ref): string {
  return drboChapterUrl(ref.book, firstChapter(ref));
}

/** The chapter a reference starts in (its first segment, as written). */
export function firstChapter(ref: Ref): number {
  // checkRef guarantees at least one segment before this is called.
  return (ref.segments[0] as Ref['segments'][number]).start.c;
}
