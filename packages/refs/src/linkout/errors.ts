export type LinkoutErrorCode =
  /** `linkout.provider` names no entry of `linkout.providers`. */
  | 'UNKNOWN_PROVIDER'
  /** The active provider entry has `enabled: false`. */
  | 'DISABLED_PROVIDER'
  /** The entry sets both or neither of `builtin` and `template`, or names an unknown builtin. */
  | 'INVALID_PROVIDER'
  /** `versification` is not one of the L-006 schemes. */
  | 'UNKNOWN_VERSIFICATION'
  /** A template token other than the documented ones. */
  | 'UNKNOWN_TOKEN'
  /** A template uses `{date}` but no valid `YYYY-MM-DD` date was given. */
  | 'INVALID_DATE'
  /** The filled template is not an `https://` URL. */
  | 'INVALID_URL';

/** Every failure of the link-out builder: a stable `code` and a human `message`. */
export class LinkoutError extends Error {
  override readonly name = 'LinkoutError';
  readonly code: LinkoutErrorCode;

  constructor(code: LinkoutErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
