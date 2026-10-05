export type RefErrorCode =
  /** The input was empty or only whitespace. */
  | 'EMPTY'
  /** No book matches the name. */
  | 'UNKNOWN_BOOK'
  /** A book with no chapter or verse after it. */
  | 'MISSING_PASSAGE'
  /** The chapter/verse part could not be read. */
  | 'MALFORMED'
  /** The input offers alternatives (`… or …`); split them before parsing. */
  | 'ALTERNATIVES'
  /** A chapter or verse number of 0. */
  | 'ZERO'
  /** A range whose end comes before its start. */
  | 'DESCENDING'
  /** A chapter other than 1 in a one-chapter book, or a whole-chapter segment there. */
  | 'SINGLE_CHAPTER'
  /** A sub-verse letter on a whole chapter (`Ps 23a`). */
  | 'PART_ON_CHAPTER'
  /** A range mixing a whole chapter and a verse (`Is 40-41:5`). */
  | 'MIXED_RANGE'
  /** A string that is not a canonical passage key. */
  | 'INVALID_KEY'
  /** A `Ref` object that breaks the shape rules (bad numbers, unknown book, no segments). */
  | 'INVALID_REF'
  /** The verse-count lookup had no answer for a chapter `enumerateVerses` needed. */
  | 'UNKNOWN_CHAPTER';

/** Every failure in this package: a stable `code` for programs and a human `message`. */
export class RefError extends Error {
  override readonly name = 'RefError';
  readonly code: RefErrorCode;
  /** The string or key that failed, when there is one. */
  readonly input: string | undefined;

  constructor(code: RefErrorCode, message: string, input?: string) {
    super(input === undefined ? message : `${message} (in "${input}")`);
    this.code = code;
    this.input = input;
  }
}
