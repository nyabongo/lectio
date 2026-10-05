import type { BookCode } from './books.ts';
import { RefError } from './errors.ts';
import type { Ref } from './types.ts';
import { checkRef } from './validate.ts';

/** Number of verses in a chapter, or `undefined` if the chapter does not exist. L-006 provides one. */
export type VerseCountLookup = (book: BookCode, chapter: number) => number | undefined;

export interface VerseId {
  readonly book: BookCode;
  readonly c: number;
  readonly v: number;
}

/**
 * Lists every verse a reference covers, in reading order, each verse once
 * (lectionary psalms repeat verses: `Ps 96:1-2, 2-3`). Sub-verse letters are
 * ignored. The lookup is consulted only for whole chapters and for ranges
 * that cross a chapter; it is not used to check that verses exist (L-006).
 * Throws a {@link RefError} with code `UNKNOWN_CHAPTER` when the lookup has no answer.
 */
export function enumerateVerses(ref: Ref, verseCount: VerseCountLookup): VerseId[] {
  checkRef(ref);
  const { book } = ref;
  const count = (c: number): number => {
    const n = verseCount(book, c);
    if (n === undefined) throw new RefError('UNKNOWN_CHAPTER', `No verse count for ${book} ${c}`);
    return n;
  };
  const seen = new Set<string>();
  const verses: VerseId[] = [];
  const add = (c: number, from: number, to: number): void => {
    for (let v = from; v <= to; v++) {
      const id = `${c}.${v}`;
      if (seen.has(id)) continue;
      seen.add(id);
      verses.push({ book, c, v });
    }
  };
  for (const { start, end } of ref.segments) {
    for (let c = start.c; c <= end.c; c++) {
      const from = c === start.c ? (start.v ?? 1) : 1;
      const to = c === end.c && end.v !== undefined ? end.v : count(c);
      add(c, from, to);
    }
  }
  return verses;
}
