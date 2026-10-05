import { err, ok } from '@lectio/shared';
import type { Result } from '@lectio/shared';

import { findBook } from './books.ts';
import type { Book } from './books.ts';
import { RefError } from './errors.ts';
import type { Point, Ref, Segment } from './types.ts';
import { checkSegment } from './validate.ts';

/** Hyphen, non-breaking hyphen, figure/en/em dashes, horizontal bar, minus and their full-width forms. */
const DASHES = /[‐-―−﹘﹣－]/g;

/** Book name (optionally numbered: `1 Cor`, `1Cor`, `I Cor`, `First Corinthians`), then the passage. */
const HEAD = /^((?:[1-3]\s*|(?:i{1,3}|first|second|third)\s+)?[a-z][a-z.'’ ]*?)\s*(\d.*)?$/is;

/** One comma- or semicolon-separated part: `20c`, `1-16a`, `20:1-16`, `9-12:8`, `11:9-12:8`. */
const PART = /^(\d{1,3})(?:[:.](\d{1,3}))?([a-z]{0,2})(?:-(\d{1,3})(?:[:.](\d{1,3}))?([a-z]{0,2}))?$/;

function num(text: string | undefined): number | undefined {
  return text === undefined ? undefined : Number(text);
}

function point(c: number, v: number | undefined, part: string | undefined): Point {
  return { c, ...(v === undefined ? {} : { v }), ...(part ? { part } : {}) };
}

/**
 * Reads one part. `verseChapter` is the chapter a bare number belongs to when
 * it means a verse: chapter 1 in one-chapter books, the current chapter after
 * a comma; otherwise a bare number is a chapter.
 */
function parsePart(text: string, verseChapter: number | undefined, input: string): Segment {
  const match = PART.exec(text);
  if (!match) throw new RefError('MALFORMED', `Cannot read "${text}" as chapter and verses`, input);
  const [, a, b, partA, c, d, partC] = match;
  const first = Number(a);
  const second = num(b);
  const after = num(c);
  const afterVerse = num(d);
  let start: Point;
  if (second !== undefined) start = point(first, second, partA);
  else if (verseChapter !== undefined) start = point(verseChapter, first, partA);
  else start = point(first, undefined, partA);

  let end: Point;
  if (after === undefined) end = start;
  else if (afterVerse !== undefined) end = point(after, afterVerse, partC);
  else if (start.v === undefined) end = point(after, undefined, partC);
  else end = point(start.c, after, partC);
  return { start, end };
}

function parsePassage(book: Book, passage: string, input: string): Segment[] {
  if (/\bor\b/i.test(passage)) {
    throw new RefError('ALTERNATIVES', 'The reference offers alternatives ("or"); parse each one separately', input);
  }
  const text = passage
    .toLowerCase()
    .replace(DASHES, '-')
    .replace(/\s+and\s+/g, ',')
    .replace(/\s+/g, '');
  const tokens = text.split(/([,;])/);
  const segments: Segment[] = [];
  let chapter: number | undefined;
  for (const [i, token] of tokens.entries()) {
    if (i % 2 === 1) continue;
    const verseChapter = book.singleChapter ? 1 : tokens[i - 1] === ',' ? chapter : undefined;
    const segment = parsePart(token, verseChapter, input);
    checkSegment(book, segment, input);
    segments.push(segment);
    chapter = segment.end.v === undefined ? undefined : segment.end.c;
  }
  return segments;
}

/**
 * Parses a lectionary-style reference such as `Phil 1:20c-24, 27a`,
 * `Ps 145:2-3, 8-9, 17-18`, `Eccl 11:9—12:8`, `Jude 17, 20b-25` or `Ps 23`.
 *
 * - After a comma (or `and`) a bare number is a verse in the current chapter;
 *   after a semicolon, or after a whole chapter, it is a chapter.
 * - Hyphens, en dashes and em dashes all mark ranges; `:` or `.` separates
 *   chapter and verse.
 * - In one-chapter books (Ob, Phlm, 2 Jn, 3 Jn, Jude) bare numbers are verses.
 *
 * Does not check that the verses exist (L-006). Throws a {@link RefError}.
 */
export function parseRef(input: string): Ref {
  if (input.trim() === '') throw new RefError('EMPTY', 'The reference is empty');
  const head = HEAD.exec(input.trim());
  const name = head?.[1];
  if (head === null || name === undefined) {
    throw new RefError('UNKNOWN_BOOK', 'A reference must start with a book name', input);
  }
  const book = findBook(name);
  if (!book) throw new RefError('UNKNOWN_BOOK', `Unknown book "${name.trim()}"`, input);
  const passage = head[2];
  if (passage === undefined) {
    throw new RefError('MISSING_PASSAGE', `"${name.trim()}" needs a chapter or verse after it`, input);
  }
  return { book: book.code, segments: parsePassage(book, passage, input) };
}

/** {@link parseRef} without exceptions. */
export function tryParseRef(input: string): Result<Ref, RefError> {
  try {
    return ok(parseRef(input));
  } catch (error) {
    // parseRef only throws RefError.
    return err(error as RefError);
  }
}
