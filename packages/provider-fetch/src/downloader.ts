/**
 * `LiveDownloader`: fetches the bytes of a pinned file (the corpus importers' upstream archives) with the same
 * User-Agent, timeout, retries and redirect handling as the source fetcher. It does not consult robots.txt: it
 * fetches one named file on request and does not crawl. It satisfies the corpus `Downloader` interface.
 */
import { ProviderError } from '@lectio/providers';
import type { ProviderErrorCode } from '@lectio/providers';

import { HttpClient } from './http.ts';
import type { HttpOptions } from './http.ts';

function codeFor(status: number): ProviderErrorCode {
  if (status === 404 || status === 410) return 'not-found';
  if (status === 429) return 'rate-limited';
  if (status >= 500) return 'unavailable';
  return 'invalid-request';
}

export class LiveDownloader {
  readonly #http: HttpClient;

  /** The default timeout per attempt is 5 minutes, enough for a large archive. */
  constructor(options: HttpOptions = {}) {
    this.#http = new HttpClient(options, 300_000);
  }

  /** The body of `url` after redirects. Rejects with a `ProviderError` on a network failure or a non-2xx status. */
  async fetchBytes(url: string): Promise<Uint8Array> {
    const result = await this.#http.get(url);
    if (result.status < 200 || result.status >= 300) {
      throw new ProviderError(codeFor(result.status), `GET ${url}: HTTP ${result.status}`);
    }
    return result.body;
  }
}
