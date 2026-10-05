import type { BookCode } from './books.ts';

/**
 * A position in a book. `v` is absent for whole-chapter segments (`Ps 23`).
 * `part` is a sub-verse letter as printed in the lectionary (`20c`, `16a`);
 * keys drop it, formatters keep it. Esther's lettered chapters A–F are stored
 * as `c` 101–106 (see `greek-esther.ts`); keys and formatters write the letter.
 */
export interface Point {
  readonly c: number;
  readonly v?: number;
  readonly part?: string;
}

/** An inclusive range; a single verse or chapter has `start` equal to `end`. */
export interface Segment {
  readonly start: Point;
  readonly end: Point;
}

/** A parsed reference: one book, one or more segments in the order written. */
export interface Ref {
  readonly book: BookCode;
  readonly segments: readonly Segment[];
}
