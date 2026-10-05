import { getBook, isBookCode } from './books.ts';
import type { Book } from './books.ts';
import { RefError } from './errors.ts';
import { chapterLabel, isLetteredChapter } from './greek-esther.ts';
import type { Point, Ref, Segment } from './types.ts';

const PART = /^[a-g]{1,7}$/;

function pointLabel(book: Book, point: Point): string {
  const chapter = chapterLabel(book.code, point.c);
  return point.v === undefined ? chapter : `${chapter}:${point.v}${point.part ?? ''}`;
}

function checkNumber(n: number, what: string, input: string | undefined): void {
  if (n === 0) throw new RefError('ZERO', `${what} numbers start at 1, got 0`, input);
  if (!Number.isSafeInteger(n) || n < 0) throw new RefError('INVALID_REF', `${what} must be a positive integer`, input);
}

function checkPoint(point: Point, input: string | undefined): void {
  checkNumber(point.c, 'Chapter', input);
  if (point.v !== undefined) checkNumber(point.v, 'Verse', input);
  if (point.part === undefined) return;
  if (point.v === undefined) {
    throw new RefError('PART_ON_CHAPTER', `A whole chapter (${point.c}) cannot carry a sub-verse letter`, input);
  }
  if (!PART.test(point.part)) {
    throw new RefError('INVALID_REF', `Sub-verse letters must be a run of the letters a–g, got "${point.part}"`, input);
  }
}

/** Throws a {@link RefError} unless the segment is well formed for the book. */
export function checkSegment(book: Book, segment: Segment, input?: string): void {
  const { start, end } = segment;
  checkPoint(start, input);
  checkPoint(end, input);
  if ((start.v === undefined) !== (end.v === undefined)) {
    throw new RefError(
      'MIXED_RANGE',
      `A range cannot run from ${pointLabel(book, start)} to ${pointLabel(book, end)}: both ends must be whole chapters or both verses`,
      input,
    );
  }
  if (isLetteredChapter(book.code, start.c) !== isLetteredChapter(book.code, end.c)) {
    throw new RefError(
      'MIXED_RANGE',
      `A range cannot run from ${pointLabel(book, start)} to ${pointLabel(book, end)}: Esther's lettered chapters (A–F) and numbered chapters are cited separately`,
      input,
    );
  }
  if (book.singleChapter && (start.c !== 1 || end.c !== 1 || start.v === undefined)) {
    throw new RefError('SINGLE_CHAPTER', `${book.name} has a single chapter; cite it by verse`, input);
  }
  const sameVerse = end.c === start.c && end.v === start.v;
  const descending =
    end.c < start.c ||
    (end.c === start.c && (end.v ?? 0) < (start.v ?? 0)) ||
    (sameVerse && start.part !== undefined && end.part !== undefined && end.part < start.part);
  if (descending) {
    throw new RefError(
      'DESCENDING',
      `The range ends at ${pointLabel(book, end)}, before its start at ${pointLabel(book, start)}`,
      input,
    );
  }
}

/** Throws a {@link RefError} unless `ref` is well formed; returns its book. */
export function checkRef(ref: Ref, input?: string): Book {
  if (!isBookCode(ref.book)) throw new RefError('INVALID_REF', `Unknown book code "${String(ref.book)}"`, input);
  const book = getBook(ref.book);
  if (ref.segments.length === 0) throw new RefError('INVALID_REF', 'A reference needs at least one segment', input);
  for (const segment of ref.segments) checkSegment(book, segment, input);
  return book;
}
