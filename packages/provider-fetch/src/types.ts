import type { FetchedSource } from '@lectio/providers';

/** Why a live fetch has no text: a PDF, or another body that is not text (images, archives, …). */
export type UnsupportedContent = 'pdf' | 'binary';

/** A {@link FetchedSource} with what only a live fetch can tell. */
export interface LiveFetchedSource extends FetchedSource {
  /** Set when the body is not text Lectio can read; `text` is then `''`. */
  readonly unsupported?: UnsupportedContent;
}
