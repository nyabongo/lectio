import { readFile } from 'node:fs/promises';
import { isAbsolute, join, normalize, sep } from 'node:path';

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
}

/** Fetches a source page. Network failures reject with `ProviderError`; HTTP errors resolve with their status. */
export interface SourceFetcher {
  fetch(url: string): Promise<FetchedSource>;
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
  /** Inline text (in-memory fetcher). */
  readonly text?: string;
  /** File holding the text, relative to the fixture directory (fixture directory fetcher). */
  readonly file?: string;
}

const NOT_FOUND = { status: 404, text: '', contentType: 'text/plain' } as const;

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

  async fetch(url: string): Promise<FetchedSource> {
    this.fetched.push(url);
    const page = this.#pages.get(url);
    const retrievedAt = this.#clock.now().toISOString();
    if (!page) return { ...NOT_FOUND, retrievedAt };
    return {
      status: page.status ?? 200,
      text: page.text ?? '',
      contentType: page.contentType ?? 'text/html; charset=utf-8',
      retrievedAt,
    };
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

  async fetch(url: string): Promise<FetchedSource> {
    this.fetched.push(url);
    this.#index ??= readFile(join(this.#dir, 'index.json'), 'utf8').then(
      (raw) => JSON.parse(raw) as Record<string, FakeSourcePage>,
    );
    const page = (await this.#index)[url];
    const retrievedAt = this.#clock.now().toISOString();
    if (!page) return { ...NOT_FOUND, retrievedAt };
    let text = page.text ?? '';
    if (page.file !== undefined) {
      const file = normalize(page.file);
      if (isAbsolute(file) || file.startsWith(`..${sep}`) || file === '..') {
        throw new RangeError(`fixture file escapes the fixture directory: ${page.file}`);
      }
      text = await readFile(join(this.#dir, file), 'utf8');
    }
    return {
      status: page.status ?? 200,
      text,
      contentType: page.contentType ?? 'text/html; charset=utf-8',
      retrievedAt,
    };
  }
}
