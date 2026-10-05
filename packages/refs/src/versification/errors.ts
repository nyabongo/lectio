export type VersificationErrorCode =
  /** A scheme name other than `original`, `vulgate`, `lxx` or `english`. */
  | 'UNKNOWN_SCHEME'
  /** The verse or reference does not exist in the scheme it was given in. */
  | 'UNKNOWN_VERSE'
  /** The verse exists but the target scheme has nothing that corresponds to it. */
  | 'NO_COUNTERPART'
  /**
   * A verse of Greek Esther's additions (NABRE lettered chapters A–F, Vulgate
   * 10:4–16:24) mapped to a scheme with no verse numbers for them: `lxx`
   * (Rahlfs letters them, 4:17k; use `greekEstherLxx`) or `english`.
   */
  | 'UNSUPPORTED_GREEK_ESTHER'
  /** A reference whose verses would land in more than one book of the target scheme. */
  | 'CROSSES_BOOKS';

/** Every failure of the versification functions: a stable `code` and a human `message`. */
export class VersificationError extends Error {
  override readonly name = 'VersificationError';
  readonly code: VersificationErrorCode;

  constructor(code: VersificationErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
