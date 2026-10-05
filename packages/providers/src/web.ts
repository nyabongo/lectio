import { readFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';

import type { Clock } from './clock.ts';
import { FakeClock } from './clock.ts';
import { sha256Hex } from './hash.ts';

// ---------------------------------------------------------------------------
// Interfaces

export interface WebSearchQuery {
  readonly query: string;
  /** Default 5. */
  readonly maxResults?: number;
}

export interface WebSearchResult {
  readonly url: string;
  readonly title: string;
  readonly snippet: string;
}

/** A plain web search (used outside the LLM's own server-side search tool). */
export interface WebSearch {
  search(query: WebSearchQuery): Promise<readonly WebSearchResult[]>;
}

export interface FetchedSource {
  /** HTTP status. A missing page is a 404 result, not an exception. */
  readonly status: number;
  /** Main text of the page (HTML reduced to text by live fetchers); `''` when there is none. */
  readonly text: string;
  readonly contentType: string;
  /** ISO instant the page was retrieved. */
  readonly retrievedAt: string;
  /** The URL the text came from, after redirects or the archive fallback. Absent means the requested URL. */
  readonly finalUrl?: string;
  /** True when the page itself failed and the text came from `archivedUrl`. */
  readonly fromArchive?: boolean;
}

export interface FetchOptions {
  /** Fallback (for example a Wayback Machine URL) tried when the page is missing or failing (status >= 400). */
  readonly archivedUrl?: string;
}

/** Fetches a source page. Network failures reject with `ProviderError`; HTTP errors resolve with their status. */
export interface SourceFetcher {
  fetch(url: string, options?: FetchOptions): Promise<FetchedSource>;
}

// ---------------------------------------------------------------------------
// Fakes

export interface FakeWebSearchOptions {
  /** Canned results per exact query. Unknown queries get deterministic example.org results. */
  readonly results?: Readonly<Record<string, readonly WebSearchResult[]>>;
}

/** Deterministic web search: canned results, otherwise results derived from the query hash. */
export class FakeWebSearch implements WebSearch {
  readonly queries: WebSearchQuery[] = [];
  readonly #results: Readonly<Record<string, readonly WebSearchResult[]>>;

  constructor(options: FakeWebSearchOptions = {}) {
    this.#results = options.results ?? {};
  }

  async search(query: WebSearchQuery): Promise<readonly WebSearchResult[]> {
    this.queries.push(query);
    const max = query.maxResults ?? 5;
    const canned = this.#results[query.query];
    if (canned) return canned.slice(0, max);
    const hash = sha256Hex(query.query);
    return Array.from({ length: Math.min(max, 3) }, (_, i) => ({
      url: `https://example.org/search/${hash.slice(0, 12)}/${i + 1}`,
      title: `Fake result ${i + 1} for "${query.query}"`,
      snippet: `Deterministic fake snippet ${hash.slice(i * 4, i * 4 + 8)}.`,
    }));
  }
}

/** A canned page for the in-memory fetcher, or one entry of a fixture directory's `index.json`. */
export interface FakeSourcePage {
  readonly status?: number;
  readonly contentType?: string;
  /** Inline text. */
  readonly text?: string;
  /** File holding the text, relative to the fixture directory (fixture directory fetcher only). */
  readonly file?: string;
  /** Simulates a redirect: the URL reported as `finalUrl`. */
  readonly finalUrl?: string;
}

interface LoadedPage {
  readonly page: FakeSourcePage;
  readonly text: string;
}

const ok = (loaded: LoadedPage | undefined): loaded is LoadedPage =>
  loaded !== undefined && (loaded.page.status ?? 200) < 400;

/**
 * Shared fake behaviour: unknown URLs are 404s, and a missing or failing page falls back
 * to `archivedUrl` when that page is available.
 */
async function fetchFake(
  url: string,
  options: FetchOptions,
  clock: Clock,
  load: (url: string) => Promise<LoadedPage | undefined>,
): Promise<FetchedSource> {
  const retrievedAt = clock.now().toISOString();
  const result = (requested: string, { page, text }: LoadedPage, fromArchive: boolean): FetchedSource => ({
    status: page.status ?? 200,
    text,
    contentType: page.contentType ?? 'text/html; charset=utf-8',
    retrievedAt,
    finalUrl: page.finalUrl ?? requested,
    fromArchive,
  });
  const found = await load(url);
  if (ok(found)) return result(url, found, false);
  if (options.archivedUrl !== undefined) {
    const archived = await load(options.archivedUrl);
    if (ok(archived)) return result(options.archivedUrl, archived, true);
  }
  if (found) return result(url, found, false);
  return { status: 404, text: '', contentType: 'text/plain', retrievedAt, finalUrl: url, fromArchive: false };
}

/** Pages from memory. Unknown URLs are 404s. */
export class MemorySourceFetcher implements SourceFetcher {
  readonly fetched: string[] = [];
  readonly #pages: Map<string, FakeSourcePage>;
  readonly #clock: Clock;

  constructor(pages: Readonly<Record<string, FakeSourcePage>> = {}, clock: Clock = new FakeClock()) {
    this.#pages = new Map(Object.entries(pages));
    this.#clock = clock;
  }

  /** Adds or replaces a page. */
  set(url: string, page: FakeSourcePage): this {
    this.#pages.set(url, page);
    return this;
  }

  async fetch(url: string, options: FetchOptions = {}): Promise<FetchedSource> {
    this.fetched.push(url);
    return fetchFake(url, options, this.#clock, async (u) => {
      const page = this.#pages.get(u);
      return page && { page, text: page.text ?? '' };
    });
  }
}

/**
 * Pages from a fixture directory: `<dir>/index.json` maps each URL to a
 * {@link FakeSourcePage} whose `file` (relative to `dir`) holds the text.
 * Unknown URLs are 404s. Fixtures hold commentary or public-domain text only, never
 * a translation's reading text (ADR 0003).
 */
export class FixtureSourceFetcher implements SourceFetcher {
  readonly fetched: string[] = [];
  readonly #dir: string;
  readonly #clock: Clock;
  #index: Promise<Readonly<Record<string, FakeSourcePage>>> | undefined;

  constructor(dir: string, clock: Clock = new FakeClock()) {
    this.#dir = dir;
    this.#clock = clock;
  }

  async fetch(url: string, options: FetchOptions = {}): Promise<FetchedSource> {
    this.fetched.push(url);
    const index = await this.#loadIndex();
    return fetchFake(url, options, this.#clock, async (u) => {
      const page = index[u];
      if (!page) return undefined;
      if (page.file === undefined) return { page, text: page.text ?? '' };
      if (isAbsolute(page.file) || relative(this.#dir, join(this.#dir, page.file)).startsWith('..')) {
        throw new RangeError(`fixture file escapes the fixture directory: ${page.file}`);
      }
      return { page, text: await readFile(join(this.#dir, page.file), 'utf8') };
    });
  }

  /** Reads `index.json` once; a failed read is retried on the next fetch instead of being cached. */
  async #loadIndex(): Promise<Readonly<Record<string, FakeSourcePage>>> {
    this.#index ??= readFile(join(this.#dir, 'index.json'), 'utf8').then(
      (raw) => JSON.parse(raw) as Record<string, FakeSourcePage>,
    );
    try {
      return await this.#index;
    } catch (error) {
      this.#index = undefined;
      throw error;
    }
  }
}
