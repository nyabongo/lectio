/** fast-check generators for well-formed references (test-only; excluded from coverage). */
import fc from 'fast-check';

import { BOOKS } from '../books.ts';
import type { Point, Ref, Segment } from '../types.ts';

const number = fc.integer({ min: 1, max: 150 });
const part = fc.option(fc.constantFrom('a', 'b', 'c', 'ab'), { nil: undefined });
const ordered = fc.tuple(number, number).map(([a, b]): [number, number] => (a <= b ? [a, b] : [b, a]));
const strictlyOrdered = ordered.filter(([a, b]) => a !== b);

function point(c: number, v?: number, p?: string): Point {
  return { c, ...(v === undefined ? {} : { v }), ...(p === undefined ? {} : { part: p }) };
}

function segment(singleChapter: boolean): fc.Arbitrary<Segment> {
  const chapter = singleChapter ? fc.constant(1) : number;
  const verse = fc.tuple(chapter, number, part).map(([c, v, p]) => {
    const at = point(c, v, p);
    return { start: at, end: at };
  });
  const verses = fc
    .tuple(chapter, ordered, part, part)
    .map(([c, [from, to], p, q]) => ({ start: point(c, from, p), end: point(c, to, q) }));
  if (singleChapter) return fc.oneof(verse, verses);
  const chapters = ordered.map(([from, to]) => ({ start: point(from), end: point(to) }));
  const cross = fc
    .tuple(strictlyOrdered, number, number, part, part)
    .map(([[from, to], v, w, p, q]) => ({ start: point(from, v, p), end: point(to, w, q) }));
  return fc.oneof(verse, verses, chapters, cross);
}

/** Any well-formed reference, sub-verse letters included. */
export const refArbitrary: fc.Arbitrary<Ref> = fc
  .constantFrom(...BOOKS)
  .chain((book) =>
    fc
      .array(segment(book.singleChapter), { minLength: 1, maxLength: 4 })
      .map((segments): Ref => ({ book: book.code, segments })),
  );

/** The reference with every sub-verse letter removed (what a key keeps). */
export function stripParts(ref: Ref): Ref {
  const strip = ({ c, v }: Point): Point => (v === undefined ? { c } : { c, v });
  return { book: ref.book, segments: ref.segments.map(({ start, end }) => ({ start: strip(start), end: strip(end) })) };
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/** True when `name` is a safe file name on Windows, macOS and Linux. */
export function isFilenameSafe(name: string): boolean {
  const stem = name.split('.')[0] ?? '';
  return (
    /^[A-Za-z0-9._-]+$/.test(name) &&
    name.length <= 200 &&
    !WINDOWS_RESERVED.test(stem) &&
    !name.endsWith('.') &&
    !name.startsWith('.') &&
    !name.startsWith('-')
  );
}
