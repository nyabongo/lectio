/**
 * Canonical spelling of a `ref`: the `@lectio/refs` short form with ASCII hyphens and no
 * sub-verse letters, e.g. `Phil 1:20-24, 27` for the printed `Philippians 1:20c-24, 27a`.
 * Every `ref` in the data is written this way, so equal passages have equal strings.
 */
import { chapterLength, enumerateVerses, formatRef, fromKey, parseRef, toKey } from '@lectio/refs';
import type { Point, Ref } from '@lectio/refs';

/** `Psalm 66 (67)`, `Psalm 103 (102): 1-2`: a psalm cited with both its Vulgate and its Hebrew number. */
const DUAL_PSALM = /^(Psalms?|Ps)\.?\s+(\d{1,3})\s*\((\d{1,3})\)/;

/**
 * A printed citation with a dual psalm number reduced to the Hebrew one, which is the larger of the
 * two (the Vulgate joins Hebrew 9-10 and 114-115, so it is behind or equal from Psalm 10 to 147):
 * `Psalm 66 (67)` → `Psalm 67`, `Psalm 103 (102): 1-2` → `Psalm 103: 1-2`. Anything else is unchanged.
 */
export function singlePsalmNumber(printed: string): string {
  return printed.replace(
    DUAL_PSALM,
    (_, word: string, a: string, b: string) => `${word} ${String(Math.max(Number(a), Number(b)))}`,
  );
}

/** Parses a printed citation, accepting a dual psalm number ({@link singlePsalmNumber}). Throws a `RefError`. */
export function parsePrinted(printed: string): Ref {
  return parseRef(singlePsalmNumber(printed));
}

function plain({ c, v }: Point): Point {
  return v === undefined ? { c } : { c, v };
}

/** The reference without sub-verse letters. */
export function stripLetters(ref: Ref): Ref {
  return { book: ref.book, segments: ref.segments.map(({ start, end }) => ({ start: plain(start), end: plain(end) })) };
}

/** True when any point of the reference carries a sub-verse letter. */
export function hasLetters(ref: Ref): boolean {
  return ref.segments.some(({ start, end }) => start.part !== undefined || end.part !== undefined);
}

/** Formats a parsed reference canonically (letters dropped). */
export function formatCanonical(ref: Ref): string {
  return formatRef(stripLetters(ref)).replace(/–/g, '-');
}

/**
 * Turns a printed citation (`Philippians 1:20c-24, 27a`, `Psalm 122: 1-2, 3-4`, `Psalm 66 (67)`) into a
 * canonical `ref`. Throws a `RefError` when it does not parse.
 */
export function canonicalRef(printed: string): string {
  return formatCanonical(parsePrinted(printed));
}

/**
 * The passage key of a `ref` (`Phil 1:20-24, 27` → `PHIL.1.20-24_1.27`), letters dropped. Strict: a
 * dual psalm number does not parse, so a printed form the calendar could not show is never taken
 * for the ref. Throws a `RefError`.
 */
export function refKey(ref: string): string {
  return toKey(stripLetters(parseRef(ref)));
}

/**
 * The set of verses a passage key covers, as a string that is equal for equal sets: `PS.100.1-2_100.3`
 * and `PS.100.1-3` give the same value, and so do repeated verses (`PS.96.1-2_96.2-3`). Whole chapters
 * and ranges across chapters are counted with the canonical chapter lengths; a key that cannot be
 * counted that way (a chapter the versification does not know) is its own value.
 */
export function verseSet(key: string): string {
  try {
    const ref = fromKey(key);
    const verses = enumerateVerses(ref, (book, chapter) => chapterLength(book, chapter))
      .map(({ c, v }) => c * 1000 + v)
      .sort((a, b) => a - b);
    return `${ref.book} ${verses.join(',')}`;
  } catch {
    return key;
  }
}
