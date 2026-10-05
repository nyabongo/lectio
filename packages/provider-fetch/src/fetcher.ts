/**
 * `LiveSourceFetcher`: the live {@link SourceFetcher}. Not registered in `createProviders`; the content gates (L-031)
 * and the research runner (L-038) inject it at the edge (ADR 0005).
 */
import type { Clock, FetchOptions, SourceFetcher } from '@lectio/providers';
import { systemClock } from '@lectio/providers';

import { defaultSourceCacheDir, SourceCache } from './cache.ts';
import { HttpClient } from './http.ts';
import type { HttpOptions } from './http.ts';
import { RobotsCache } from './robots.ts';
import { contentKind, decodeBody, htmlToText, reportedContentType, tidyText } from './text.ts';
import type { LiveFetchedSource } from './types.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

const ACCEPT = 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8';

export interface LiveSourceFetcherOptions extends HttpOptions {
  /** Stamps `retrievedAt` and ages the caches. Default: the system clock. */
  readonly clock?: Clock;
  /**
   * The on-disk page cache directory, or `false` for none. Default: `<repo>/.cache/sources`
   * (see {@link defaultSourceCacheDir}).
   */
  readonly cacheDir?: string | false;
  /** How long a cached page is reused. Default 24 h. */
  readonly cacheTtlMs?: number;
  /** Respect robots.txt. Default true. */
  readonly robots?: boolean;
  /** How long an origin's robots.txt is reused (in memory). Default 24 h. */
  readonly robotsTtlMs?: number;
}

/**
 * Fetches public source pages as LectioBot: one User-Agent, a timeout per attempt (default 20 s), retries with
 * backoff for 408/429/5xx and network failures, redirects followed (each hop checked against robots.txt), the body
 * decoded with its charset, HTML reduced to its main text, PDFs and other binary bodies flagged `unsupported`,
 * successful pages cached on disk, and `archivedUrl` tried when the page is missing, failing, disallowed by
 * robots.txt or unreachable.
 */
export class LiveSourceFetcher implements SourceFetcher {
  readonly #http: HttpClient;
  readonly #clock: Clock;
  readonly #cache: SourceCache | undefined;
  readonly #robots: RobotsCache | undefined;

  constructor(options: LiveSourceFetcherOptions = {}) {
    this.#http = new HttpClient(options, 20_000);
    this.#clock = options.clock ?? systemClock;
    const cacheDir = options.cacheDir ?? defaultSourceCacheDir(process.env, process.cwd());
    this.#cache = cacheDir === false ? undefined : new SourceCache(cacheDir, options.cacheTtlMs ?? DAY_MS, this.#clock);
    this.#robots =
      options.robots === false ? undefined : new RobotsCache(this.#http, this.#clock, options.robotsTtlMs ?? DAY_MS);
  }

  async fetch(url: string, options: FetchOptions = {}): Promise<LiveFetchedSource> {
    let page: LiveFetchedSource | undefined;
    let failure: unknown;
    try {
      page = await this.#fetchOne(url);
      if (page.status < 400) return page;
    } catch (error) {
      failure = error;
    }
    if (options.archivedUrl !== undefined) {
      try {
        const archived = await this.#fetchOne(options.archivedUrl);
        if (archived.status < 400) return { ...archived, fromArchive: true };
      } catch {
        // The archive failed too: report the page's own result below.
      }
    }
    if (page !== undefined) return page;
    throw failure;
  }

  async #fetchOne(url: string): Promise<LiveFetchedSource> {
    const cached = await this.#cache?.get(url);
    if (cached !== undefined) return cached;
    const robots = this.#robots;
    const result = await this.#http.get(url, {
      accept: ACCEPT,
      ...(robots && { beforeRequest: (next: URL) => robots.check(next) }),
    });
    const header = result.headers.get('content-type');
    const kind = contentKind(header ?? '', result.body);
    const contentType = reportedContentType(header, kind);
    const base = {
      status: result.status,
      contentType,
      retrievedAt: this.#clock.now().toISOString(),
      finalUrl: result.url,
      fromArchive: false,
    };
    let page: LiveFetchedSource;
    if (kind === 'pdf' || kind === 'binary') {
      page = { ...base, text: '', unsupported: kind };
    } else {
      const decoded = decodeBody(result.body, contentType, kind);
      page = { ...base, text: kind === 'html' ? htmlToText(decoded) : tidyText(decoded) };
    }
    if (page.status < 400) await this.#cache?.put(url, page);
    return page;
  }
}
