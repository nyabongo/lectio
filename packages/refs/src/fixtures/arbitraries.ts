/** fast-check generators for well-formed references (test-only; excluded from coverage). */
import fc from 'fast-check';

import { BOOKS } from '../books.ts';
import type { Point, Ref, Segment } from '../types.ts';

const number = fc.integer({ min: 1, max: 150 });
const part = fc.option(fc.constantFrom('a', 'b', 'c', 'ab', 'abc', 'bcd', 'abcd', 'g'), { nil: undefined });
const orderedFrom = (values: fc.Arbitrary<number>): fc.Arbitrary<[number, number]> =>
  fc.tuple(values, values).map(([a, b]): [number, number] => (a <= b ? [a, b] : [b, a]));
const ordered = orderedFrom(number);
/** Esther's chapters 101-106 stand for the lettered chapters A-F, which a range never mixes with numbered ones. */
const LETTERED = fc.integer({ min: 101, max: 106 });
const NUMBERED_ESTHER = number.filter((c) => c < 101 || c > 106);

function point(c: number, v?: number, p?: string): Point {
  return { c, ...(v === undefined ? {} : { v }), ...(p === undefined ? {} : { part: p }) };
}

function segment(
  singleChapter: boolean,
  chapter: fc.Arbitrary<number> = singleChapter ? fc.constant(1) : number,
): fc.Arbitrary<Segment> {
  const verse = fc.tuple(chapter, number, part).map(([c, v, p]) => {
    const at = point(c, v, p);
    return { start: at, end: at };
  });
  const verses = fc
    .tuple(chapter, ordered, part, part)
    // Within one verse the letters must not run backwards (`3b-3a`).
    .map(([c, [from, to], p, q]) =>
      from === to && p !== undefined && q !== undefined && q < p
        ? { start: point(c, from, q), end: point(c, to, p) }
        : { start: point(c, from, p), end: point(c, to, q) },
    );
  if (singleChapter) return fc.oneof(verse, verses);
  const chapters = orderedFrom(chapter).map(([from, to]) => ({ start: point(from), end: point(to) }));
  const cross = fc
    .tuple(
      orderedFrom(chapter).filter(([a, b]) => a !== b),
      number,
      number,
      part,
      part,
    )
    .map(([[from, to], v, w, p, q]) => ({ start: point(from, v, p), end: point(to, w, q) }));
  return fc.oneof(verse, verses, chapters, cross);
}

/** Any well-formed reference, sub-verse letters included. */
export const refArbitrary: fc.Arbitrary<Ref> = fc
  .constantFrom(...BOOKS)
  .chain((book) =>
    fc
      .array(
        book.code === 'EST'
          ? fc.oneof(segment(false, NUMBERED_ESTHER), segment(false, LETTERED))
          : segment(book.singleChapter),
        { minLength: 1, maxLength: 4 },
      )
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
