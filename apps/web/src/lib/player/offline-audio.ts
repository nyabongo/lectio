/**
 * Narration files kept for offline listening (L-085). Every file the Listen page plays is saved in the Cache Storage
 * cache `lectio-data-audio`; the next time, it plays from that copy, with or without a network.
 *
 * The cache name starts with `OFFLINE_DATA_CACHE_PREFIX` (`lectio-data-`), so Settings → Clear offline data (L-057)
 * and the service worker's `clear-offline-data` message (L-061) remove it with the saved days, and keep the app shell.
 *
 * - Each file is downloaded once: the first play fetches it (CORS), stores it and plays the stored copy through an
 *   object URL. Narration files are small, so the wait is short, and a metered connection pays for one download.
 * - Where that fetch is refused (no CORS rule on the bucket, see docs/operator-handbook.md), fails or there is no
 *   Cache Storage, the element streams the URL itself and nothing is kept.
 * - The cache keeps at most `AUDIO_CACHE_LIMIT` files. Playing a kept file moves it to the end, and the least recently
 *   played ones are deleted first, so the cache never grows into the storage pressure that would make the browser
 *   evict the whole site (shell, saved days and settings with it).
 * - Object URLs are revoked when the next file plays.
 */
import { OFFLINE_DATA_CACHE_PREFIX } from '../settings.ts';

/** The cache narration files are kept in. */
export const AUDIO_CACHE = `${OFFLINE_DATA_CACHE_PREFIX}audio`;

/**
 * How many narration files the cache keeps: a few days of a typical queue (a day has a few dozen segments of a minute
 * or so), a few tens of megabytes.
 */
export const AUDIO_CACHE_LIMIT = 120;

/** The parts of a `Response` the store reads. */
export interface ResponseLike {
  readonly ok: boolean;
  blob(): Promise<Blob>;
  clone(): ResponseLike;
}

/** The parts of a `Cache` the store uses; `keys` lists entries in the order they were stored. */
export interface AudioCacheLike {
  match(url: string): Promise<ResponseLike | undefined>;
  put(url: string, response: ResponseLike): Promise<void>;
  keys(): Promise<readonly { readonly url: string }[]>;
  delete(request: { readonly url: string }): Promise<boolean>;
}

export interface OfflineAudioEnvironment {
  /** `globalThis.caches`, absent where there is no Cache Storage (or on an insecure origin). */
  readonly caches?: { open(name: string): Promise<AudioCacheLike> } | undefined;
  readonly fetch: (url: string) => Promise<ResponseLike>;
  readonly createObjectURL: (blob: Blob) => string;
  readonly revokeObjectURL: (url: string) => void;
  /** Defaults to `AUDIO_CACHE_LIMIT`. */
  readonly limit?: number;
}

export interface OfflineAudio {
  /**
   * The `src` for a narration file: an object URL of the kept copy (fetched and kept now if it was not), else the URL
   * itself when it cannot be kept.
   */
  source(url: string): Promise<string>;
}

export function createOfflineAudio(env: OfflineAudioEnvironment): OfflineAudio {
  const limit = env.limit ?? AUDIO_CACHE_LIMIT;
  let cache: Promise<AudioCacheLike | null> | null = null;
  let objectUrl: string | null = null;

  const open = (): Promise<AudioCacheLike | null> => {
    cache ??= env.caches === undefined ? Promise.resolve(null) : env.caches.open(AUDIO_CACHE).catch(() => null);
    return cache;
  };

  /** Deletes the least recently played files beyond the limit. */
  const trim = async (store: AudioCacheLike): Promise<void> => {
    const keys = await store.keys();
    for (const request of keys.slice(0, Math.max(0, keys.length - limit))) await store.delete(request);
  };

  const play = (blob: Blob): string => {
    objectUrl = env.createObjectURL(blob);
    return objectUrl;
  };

  /** The kept copy, moved to the end of the cache; `null` when there is none. */
  const kept = async (store: AudioCacheLike, url: string): Promise<Blob | null> => {
    const cached = await store.match(url);
    if (cached === undefined) return null;
    await store.put(url, cached.clone());
    return cached.blob();
  };

  /** Downloads `url` once and keeps it; `null` when it cannot be fetched or kept. */
  const keep = async (store: AudioCacheLike, url: string): Promise<Blob | null> => {
    const response = await env.fetch(url);
    if (!response.ok) return null;
    await store.put(url, response.clone());
    await trim(store);
    return response.blob();
  };

  return {
    async source(url) {
      if (objectUrl !== null) env.revokeObjectURL(objectUrl);
      objectUrl = null;
      const store = await open();
      if (store === null) return url;
      try {
        const blob = (await kept(store, url)) ?? (await keep(store, url));
        return blob === null ? url : play(blob);
      } catch {
        // A broken entry, a refused fetch or a full quota: stream from the URL instead.
        return url;
      }
    },
  };
}

/** The browser's Cache Storage, `fetch` and object URLs (CORS fetch, so the stored copy is readable). */
export function browserOfflineAudio(scope: typeof globalThis): OfflineAudio {
  const caches = (scope as { caches?: OfflineAudioEnvironment['caches'] }).caches;
  return createOfflineAudio({
    caches,
    fetch: (url) => scope.fetch(url, { mode: 'cors', credentials: 'omit' }),
    createObjectURL: (blob) => scope.URL.createObjectURL(blob),
    revokeObjectURL: (url) => scope.URL.revokeObjectURL(url),
  });
}
