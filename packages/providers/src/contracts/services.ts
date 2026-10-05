import { describe, expect, it } from 'vitest';

import type { Clock } from '../clock.ts';
import { ProviderError } from '../errors.ts';
import type { ObjectStorage } from '../storage.ts';
import type { TtsFormat, TtsProvider } from '../tts.ts';
import type { SourceFetcher, WebSearch } from '../web.ts';

type Factory<T> = () => T | Promise<T>;

interface BaseOptions {
  /** Suite name suffix, for example `fake` or `azure (recorded)`. */
  readonly name?: string;
  /** Assert identical outputs from two fresh instances (fakes and recorded HTTP). */
  readonly deterministic?: boolean;
  readonly timeoutMs?: number;
}

const suffix = (options: BaseOptions): string => (options.name ? ` (${options.name})` : '');

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.catch((error: unknown) => error);
}

// ---------------------------------------------------------------------------

export function describeClockContract(factory: Factory<Clock>, options: BaseOptions = {}): void {
  describe(`Clock contract${suffix(options)}`, () => {
    it('returns valid, non-decreasing instants as fresh Date objects', async () => {
      const clock = await factory();
      const first = clock.now();
      const second = clock.now();
      expect(Number.isNaN(first.getTime())).toBe(false);
      expect(second.getTime()).toBeGreaterThanOrEqual(first.getTime());
      expect(second).not.toBe(first);
    });
  });
}

// ---------------------------------------------------------------------------

export function describeWebSearchContract(factory: Factory<WebSearch>, options: BaseOptions = {}): void {
  describe(`WebSearch contract${suffix(options)}`, () => {
    it('returns at most maxResults well-formed results', { timeout: options.timeoutMs }, async () => {
      const search = await factory();
      const results = await search.search({ query: 'history of the codex format', maxResults: 2 });
      expect(results.length).toBeLessThanOrEqual(2);
      for (const result of results) {
        expect(URL.canParse(result.url)).toBe(true);
        expect(typeof result.title).toBe('string');
        expect(typeof result.snippet).toBe('string');
      }
    });

    if (options.deterministic) {
      it('returns identical results across runs', async () => {
        const query = { query: 'papyrus manuscripts' };
        expect(await (await factory()).search(query)).toEqual(await (await factory()).search(query));
      });
    }
  });
}

// ---------------------------------------------------------------------------

export interface SourceFetcherSubject {
  readonly fetcher: SourceFetcher;
  /** A URL that resolves with status 200 and non-empty text. */
  readonly knownUrl: string;
  /** A URL that resolves with status 404. */
  readonly missingUrl: string;
}

export function describeSourceFetcherContract(factory: Factory<SourceFetcherSubject>, options: BaseOptions = {}): void {
  describe(`SourceFetcher contract${suffix(options)}`, () => {
    it('fetches a known page with text, content type and retrieval time', { timeout: options.timeoutMs }, async () => {
      const { fetcher, knownUrl } = await factory();
      const page = await fetcher.fetch(knownUrl);
      expect(page.status).toBe(200);
      expect(page.text.length).toBeGreaterThan(0);
      expect(page.contentType.length).toBeGreaterThan(0);
      expect(new Date(page.retrievedAt).toISOString()).toBe(page.retrievedAt);
      expect(page.finalUrl === undefined || URL.canParse(page.finalUrl)).toBe(true);
      expect(page.fromArchive).not.toBe(true);
    });

    it('falls back to the archived URL when the page is missing', { timeout: options.timeoutMs }, async () => {
      const { fetcher, knownUrl, missingUrl } = await factory();
      const page = await fetcher.fetch(missingUrl, { archivedUrl: knownUrl });
      expect(page.status).toBe(200);
      expect(page.text.length).toBeGreaterThan(0);
      expect(page.fromArchive).toBe(true);
      expect(page.finalUrl).toBe(knownUrl);
    });

    it('resolves a missing page with its status instead of throwing', { timeout: options.timeoutMs }, async () => {
      const { fetcher, missingUrl } = await factory();
      const page = await fetcher.fetch(missingUrl);
      expect(page.status).toBe(404);
      expect(typeof page.text).toBe('string');
    });

    if (options.deterministic) {
      it('returns identical pages across runs', async () => {
        const a = await factory();
        const b = await factory();
        expect(await b.fetcher.fetch(b.knownUrl)).toEqual(await a.fetcher.fetch(a.knownUrl));
      });
    }
  });
}

// ---------------------------------------------------------------------------

export interface TtsContractOptions extends BaseOptions {
  readonly voice: string;
  /** Default: the provider's first format. */
  readonly format?: TtsFormat;
}

export function describeTtsContract(factory: Factory<TtsProvider>, options: TtsContractOptions): void {
  const text = 'Lectio contract test: a short sentence of commentary.';
  describe(`TtsProvider contract${suffix(options)}`, () => {
    it('synthesizes audio in the requested format', { timeout: options.timeoutMs }, async () => {
      const tts = await factory();
      const format = options.format ?? (tts.formats[0] as TtsFormat);
      expect(tts.formats).toContain(format);
      const result = await tts.synthesize({ text, voice: options.voice, format });
      expect(result.format).toBe(format);
      expect(result.contentType).toMatch(/^audio\//);
      expect(result.audio.length).toBeGreaterThan(0);
      expect(result.durationMs).toBeGreaterThan(0);
      expect(result.characters).toBe([...text].length);
    });

    it('rejects empty text as invalid', { timeout: options.timeoutMs }, async () => {
      const tts = await factory();
      const format = options.format ?? (tts.formats[0] as TtsFormat);
      const error = await rejection(tts.synthesize({ text: '  ', voice: options.voice, format }));
      expect(error).toBeInstanceOf(ProviderError);
      expect((error as ProviderError).code).toBe('invalid-request');
    });

    if (options.deterministic) {
      it('produces identical bytes across runs', async () => {
        const run = async (): Promise<Uint8Array> => {
          const tts = await factory();
          const format = options.format ?? (tts.formats[0] as TtsFormat);
          return (await tts.synthesize({ text, voice: options.voice, format })).audio;
        };
        expect(Buffer.from(await run()).equals(Buffer.from(await run()))).toBe(true);
      });
    }
  });
}

// ---------------------------------------------------------------------------

export interface StorageContractOptions extends BaseOptions {
  /** Key prefix for this run, so live runs do not collide (default `contract/`). */
  readonly prefix?: string;
}

export function describeObjectStorageContract(
  factory: Factory<ObjectStorage>,
  options: StorageContractOptions = {},
): void {
  const prefix = options.prefix ?? 'contract/';
  describe(`ObjectStorage contract${suffix(options)}`, () => {
    it('round-trips bytes and metadata', { timeout: options.timeoutMs }, async () => {
      const storage = await factory();
      const key = `${prefix}audio/abc123.wav`;
      const body = Uint8Array.from([82, 73, 70, 70, 0, 1, 2, 3]);
      const info = await storage.put(key, body, {
        contentType: 'audio/wav',
        cacheControl: 'public, max-age=31536000, immutable',
      });
      expect(info).toMatchObject({ key, size: body.length, contentType: 'audio/wav' });
      expect(info.etag.length).toBeGreaterThan(0);
      expect(await storage.head(key)).toEqual(info);
      const stored = await storage.get(key);
      expect(stored && Buffer.from(stored.body).equals(Buffer.from(body))).toBe(true);
      expect(stored?.info).toEqual(info);
    });

    it('stores strings as UTF-8 and replaces on put', { timeout: options.timeoutMs }, async () => {
      const storage = await factory();
      const key = `${prefix}manifest.json`;
      await storage.put(key, '{"v":1}', { contentType: 'application/json', cacheControl: 'no-cache' });
      const second = await storage.put(key, '{"v":"ü"}', { contentType: 'application/json' });
      expect(second.size).toBe(new TextEncoder().encode('{"v":"ü"}').length);
      const stored = await storage.get(key);
      expect(new TextDecoder().decode(stored?.body)).toBe('{"v":"ü"}');
    });

    it('stores a key and a key below it side by side', { timeout: options.timeoutMs }, async () => {
      const storage = await factory();
      await storage.put(`${prefix}nested`, 'parent', { contentType: 'text/plain' });
      await storage.put(`${prefix}nested/child`, 'child', { contentType: 'text/plain' });
      expect(new TextDecoder().decode((await storage.get(`${prefix}nested`))?.body)).toBe('parent');
      expect(new TextDecoder().decode((await storage.get(`${prefix}nested/child`))?.body)).toBe('child');
    });

    it('returns null for missing keys', { timeout: options.timeoutMs }, async () => {
      const storage = await factory();
      expect(await storage.head(`${prefix}missing`)).toBeNull();
      expect(await storage.get(`${prefix}missing`)).toBeNull();
    });

    it('lists by prefix, sorted by key', { timeout: options.timeoutMs }, async () => {
      const storage = await factory();
      for (const name of ['b/2', 'a/1', 'b/1']) {
        await storage.put(`${prefix}list/${name}`, name, { contentType: 'text/plain' });
      }
      const keys = (await storage.list(`${prefix}list/b/`)).map((info) => info.key);
      expect(keys).toEqual([`${prefix}list/b/1`, `${prefix}list/b/2`]);
    });

    it('rejects keys that escape the bucket', { timeout: options.timeoutMs }, async () => {
      const storage = await factory();
      const error = await rejection(storage.put('../outside', 'x', { contentType: 'text/plain' }));
      expect(error).toBeInstanceOf(ProviderError);
      expect((error as ProviderError).code).toBe('invalid-request');
    });
  });
}
