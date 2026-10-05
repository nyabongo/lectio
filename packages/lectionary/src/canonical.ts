/**
 * Canonical spelling of a `ref`: the `@lectio/refs` short form with ASCII hyphens and no
 * sub-verse letters, e.g. `Phil 1:20-24, 27` for the printed `Philippians 1:20c-24, 27a`.
 * Every `ref` in the data is written this way, so equal passages have equal strings.
 */
import { formatRef, parseRef, toKey } from '@lectio/refs';
import type { Point, Ref } from '@lectio/refs';

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
 * Turns a printed citation (`Philippians 1:20c-24, 27a`, `Psalm 122: 1-2, 3-4`) into a canonical
 * `ref`. Throws a `RefError` when it does not parse.
 */
export function canonicalRef(printed: string): string {
  return formatCanonical(parseRef(printed));
}

/** The passage key of a `ref` (`Phil 1:20-24, 27` → `PHIL.1.20-24_1.27`). Throws a `RefError`. */
export function refKey(ref: string): string {
  return toKey(stripLetters(parseRef(ref)));
}
